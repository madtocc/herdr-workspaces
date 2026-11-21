#!/usr/bin/env node
// ws-history's reader: the conversations your agents saved on this computer,
// newest first, as JSON. The History screen runs it (Node 20.6 or newer); you can too:
//
//   node scan.js                 JSON: { sessions: [...], counts, notes }
//   node scan.js --list          a table to read
//   node scan.js --days 365      how far back (default 90)
//   node scan.js --limit 500     at most this many whose folder is still there (default 1200)
//   node scan.js --headless      also runs nobody typed into (claude -p)
//   node scan.js --in <folder>   only what ran in that folder or below (repeat it for more)
//
// It only reads. Where it looks, each agent's own store:
//   Claude Code  ~/.claude/projects/<folder>/<session>.jsonl
//   Codex        ~/.codex/state_<n>.sqlite (its threads table)
//   Pi           ~/.pi/agent/sessions/<folder>/<time>_<session>.jsonl
//   Grok         ~/.grok/sessions/<folder>/<session>/summary.json
//   OpenCode     ~/.local/share/opencode/opencode.db (its session table)
//   Antigravity  ~/.gemini/antigravity-cli/conversation_summaries.db (less any the Agents
//                list's Wipe is still finishing: ~/.herdr/cache/agy-wiped.json), each one's
//                brain/<id>/.system_generated/logs/transcript.jsonl, and for where it
//                ran, the launcher's ~/.herdr/agy/*/*/AGENTS.md and its cache/last_conversations.json
// and two of the launcher's own notes, so a conversation is resumed as it was started
// and one that's open is gone to instead: ~/.herdr/resume/<core>/<terminal>.session
// (which terminal holds which Claude or Antigravity conversation) and
// ~/.herdr/resume/started (the command each one was started with).
//
// A transcript can be many megabytes, so only its first and last pieces are read,
// and what they said is kept in ~/.herdr/cache/history/index.json until the file changes.
// Its compactions (Claude, Pi, Antigravity) are looked for in the whole file, once:
// after that only what a transcript gained is read, since they only grow.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { claudeHead, claudeTail, piFacts, codexRow, opencodeRow, grokFacts, agyFacts, agyCwd, agyRow, clean, samePrompt, inside, PROVIDERS, titleOf, ago, COMPACTION, compactionOf, contextAtEnd } from "./histfacts.js";

// node:sqlite says it's experimental on every import; nobody reads that here.
process.removeAllListeners("warning");
process.on("warning", () => {});

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const days = Math.max(1, Number(value("--days", 90)) || 90);
const limit = Math.max(1, Number(value("--limit", 1200)) || 1200);
const now = Date.now();
const since = now - days * 86400e3;
// --in <folder>, any number of times: a workspace's folders.
const within = args.flatMap((a, i) => (a === "--in" && args[i + 1] ? [args[i + 1].replace(/\/+$/, "") || "/"] : []));
const wanted = (cwd) => !within.length || within.some((dir) => inside(cwd, dir));
const notes = [];

const HEAD = 64 << 10, MORE = 1 << 20, TAIL = 128 << 10;

function piece(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n).toString("utf8");
}
const readdir = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const stat = (file) => { try { return fs.statSync(file); } catch { return null; } };

// What a file said the last time it was read, while it hasn't changed since.
const cacheFile = path.join(HOME, ".herdr", "cache", "history", "index.json");
let cache = {};
try { const c = JSON.parse(fs.readFileSync(cacheFile, "utf8")); if (c.v === 4) cache = c.files ?? {}; } catch { cache = {}; }
const kept = {};
let dirty = false;
// read(old) gets what was kept before; a `_k` it returns (compactions()) is kept beside the row.
function cached(file, st, read) {
  const old = cache[file];
  if (old && old.m === st.mtimeMs && old.s === st.size) { kept[file] = old; return old.row; }
  let row = null;
  try { row = read(old); } catch { row = null; }
  const k = row?._k ?? null;
  if (row) delete row._k;
  kept[file] = k ? { m: st.mtimeMs, s: st.size, row, k } : { m: st.mtimeMs, s: st.size, row };
  dirty = true;
  return row;
}

// Every compaction in a transcript: { n, list (the newest KEEP), off (read up to) }.
// When the file only grew since `old` read it, it reads on from there.
const CHUNK = 8 << 20, KEEP = 20;
function compactions(file, st, provider, old) {
  const needle = Buffer.from(COMPACTION[provider]);
  const prev = old?.k && old.k.off <= st.size ? old.k : { n: 0, list: [], off: 0 };
  const out = { n: prev.n, list: [...prev.list], off: prev.off };
  const fd = fs.openSync(file, "r");
  try {
    let pos = prev.off, carry = Buffer.alloc(0);
    while (pos < st.size) {
      const len = Math.min(CHUNK, st.size - pos);
      const buf = Buffer.alloc(len);
      const got = fs.readSync(fd, buf, 0, len, pos);
      if (got <= 0) break;
      pos += got;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, got)]) : buf.subarray(0, got);
      const nl = data.lastIndexOf(10);
      if (nl < 0) { carry = data; continue; }
      // Only whole lines: the rest waits for the next piece (or the next read).
      for (let i = data.indexOf(needle); i >= 0 && i < nl; i = data.indexOf(needle, i)) {
        const from = data.lastIndexOf(10, i) + 1, to = data.indexOf(10, i);
        const c = compactionOf(provider, data.toString("utf8", from, to));
        if (c) { out.n += 1; out.list.push(c); if (out.list.length > KEEP) out.list.shift(); }
        i = to + 1;
      }
      carry = data.subarray(nl + 1);
      out.off = pos - carry.length;
    }
  } finally { fs.closeSync(fd); }
  return out;
}
// What a row says about them: how many, the newest KEEP, and what's in the context at the end.
const compactFields = (k, tail) => ({ compactions: k.n, compacted: k.list, context: contextAtEnd(tail, k.list[k.list.length - 1]), _k: k });

// --- Claude Code ---
function claudeRow(file, st, id, old) {
  const fd = fs.openSync(file, "r");
  try {
    let text = piece(fd, 0, Math.min(HEAD, st.size));
    let head = claudeHead(text);
    // The desktop app writes big lines before the first prompt: look further once.
    if ((!head.cwd || !head.first) && st.size > HEAD) { text = piece(fd, 0, Math.min(MORE, st.size)); head = claudeHead(text); }
    const tail = claudeTail(st.size <= text.length ? text : piece(fd, Math.max(0, st.size - TAIL), TAIL));
    if (!head.cwd || head.side) return null;
    if (!head.first && !tail.title && !tail.last) return null; // opened and closed with nothing asked
    return {
      provider: "claude", id, cwd: head.cwd, title: clean(tail.title, 120), first: clean(head.first, 240),
      last: samePrompt(head.first, tail.last) ? "" : clean(tail.last, 240),
      model: tail.model ?? "", branch: head.branch ?? "", started: head.started ?? st.birthtimeMs, updated: tail.ended ?? st.mtimeMs,
      via: head.entry === "claude-desktop" ? "app" : "", headless: head.entry === "sdk-cli",
      ...compactFields(compactions(file, st, "claude", old), tail),
    };
  } finally { fs.closeSync(fd); }
}
function scanClaude(out) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude"), "projects");
  for (const d of readdir(root)) {
    if (!d.isDirectory()) continue;
    for (const f of readdir(path.join(root, d.name))) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const file = path.join(root, d.name, f.name);
      const st = stat(file);
      if (!st || st.mtimeMs < since) continue;
      const row = cached(file, st, (old) => claudeRow(file, st, f.name.slice(0, -6), old));
      if (row && (!row.headless || flag("--headless"))) out.push(row);
    }
  }
}

// --- Pi ---
function piRow(file, st, old) {
  const fd = fs.openSync(file, "r");
  try {
    let text = piece(fd, 0, Math.min(HEAD, st.size));
    let facts = piFacts(text);
    // Its instructions come first and can be long.
    if (!facts.first && st.size > HEAD) { text = piece(fd, 0, Math.min(MORE, st.size)); facts = piFacts(text); }
    if (st.size > text.length) facts = piFacts(text, piece(fd, Math.max(0, st.size - TAIL), TAIL));
    const id = facts.id ?? /_([0-9a-f-]{8,})\.jsonl$/.exec(file)?.[1];
    if (!id || !facts.cwd || !facts.first) return null;
    return {
      provider: "pi", id, file, cwd: facts.cwd, title: clean(facts.name, 120), first: clean(facts.first, 240),
      last: samePrompt(facts.first, facts.last) ? "" : clean(facts.last, 240), model: facts.model ?? "", branch: "",
      started: facts.started ?? st.birthtimeMs, updated: facts.ended ?? st.mtimeMs, via: "",
      ...compactFields(compactions(file, st, "pi", old), facts),
    };
  } finally { fs.closeSync(fd); }
}
function scanPi(out) {
  const root = path.join(process.env.PI_CODING_AGENT_DIR || path.join(HOME, ".pi", "agent"), "sessions");
  for (const d of readdir(root)) {
    if (!d.isDirectory()) continue;
    for (const f of readdir(path.join(root, d.name))) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const file = path.join(root, d.name, f.name);
      const st = stat(file);
      if (!st || st.mtimeMs < since) continue;
      const row = cached(file, st, (old) => piRow(file, st, old));
      if (row) out.push(row);
    }
  }
}

// --- Grok ---
function scanGrok(out) {
  const root = path.join(process.env.GROK_HOME || path.join(HOME, ".grok"), "sessions");
  for (const d of readdir(root)) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    let prompts = null; // session id -> the first thing asked in it
    for (const s of readdir(dir)) {
      if (!s.isDirectory()) continue;
      const file = path.join(dir, s.name, "summary.json");
      const st = stat(file);
      if (!st || st.mtimeMs < since) continue;
      const row = cached(file, st, () => {
        if (!prompts) {
          prompts = new Map();
          try {
            for (const l of fs.readFileSync(path.join(dir, "prompt_history.jsonl"), "utf8").split("\n")) {
              if (!l) continue;
              const o = JSON.parse(l);
              if (o.session_id && o.prompt && !o.is_bash && !prompts.has(o.session_id)) prompts.set(o.session_id, o.prompt);
            }
          } catch { /* no prompts kept for this folder */ }
        }
        const r = grokFacts(fs.readFileSync(file, "utf8"), prompts.get(s.name) ?? "");
        return r && (r.title || r.first) ? r : null;
      });
      if (row) out.push(row);
    }
  }
}

// --- the two that keep a database ---
async function sqlite(file, sql) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
  } catch { /* an older Node, or it couldn't open: the sqlite3 program next */ }
  try {
    const text = execFileSync("sqlite3", ["-readonly", "-json", file, sql], { encoding: "utf8", maxBuffer: 256 << 20, timeout: 20000, stdio: ["ignore", "pipe", "ignore"] });
    return text.trim() ? JSON.parse(text) : [];
  } catch { return null; }
}
async function scanCodex(out) {
  const home = process.env.CODEX_HOME || path.join(HOME, ".codex");
  // state_<n>.sqlite: the highest n is the one Codex uses now.
  const dbs = readdir(home).map((f) => /^state_(\d+)\.sqlite$/.exec(f.name)).filter(Boolean).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!dbs.length) return;
  const rows = await sqlite(path.join(home, dbs[0][0]), `select * from threads where archived = 0 and updated_at >= ${Math.floor(since / 1000)} order by updated_at desc limit ${limit * 2}`);
  if (!rows) return notes.push("Codex's conversations couldn't be read: that needs Node 22.13 or newer, or the sqlite3 program.");
  for (const r of rows) { const row = codexRow(r); if (row) out.push(row); }
}
async function scanOpencode(out) {
  const file = path.join(process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share"), "opencode", "opencode.db");
  if (!stat(file)) return;
  const rows = await sqlite(file, `select id, parent_id, directory, title, model, time_created, time_updated, time_archived from session where time_updated >= ${Math.floor(since)} order by time_updated desc limit ${limit}`);
  if (!rows) return notes.push("OpenCode's conversations couldn't be read: that needs Node 22.13 or newer, or the sqlite3 program.");
  for (const r of rows) { const row = opencodeRow(r); if (row && (row.title || row.first)) out.push(row); }
}

// --- Antigravity ---
async function scanAntigravity(out) {
  const home = path.join(HOME, ".gemini", "antigravity-cli");
  const file = path.join(home, "conversation_summaries.db");
  if (!stat(file)) return;
  const stamp = (t) => new Date(t).toISOString().replace("T", " ").replace("Z", "");
  const rows = await sqlite(file, `select conversation_id, title, preview, last_modified_time, workspace_uris, parent_conversation_id, nesting_depth from conversation_summaries where last_modified_time >= '${stamp(since)}' order by last_modified_time desc limit ${limit * 2}`);
  if (!rows) return notes.push("Antigravity's conversations couldn't be read: that needs Node 22.13 or newer, or the sqlite3 program.");
  const agyDir = path.join(HOME, ".herdr", "agy");
  const rules = new Map();
  const readRules = (dir) => {
    if (!rules.has(dir)) { try { rules.set(dir, fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8").slice(-4096)); } catch { rules.set(dir, null); } }
    return rules.get(dir);
  };
  // The folder each conversation was last open in, as Antigravity keeps it (folder -> id).
  const lastIn = new Map();
  try { for (const [dir, id] of Object.entries(JSON.parse(fs.readFileSync(path.join(home, "cache", "last_conversations.json"), "utf8")))) lastIn.set(id, dir); } catch { /* none kept */ }
  // Wiped from the Agents list and not finished yet (ws-agents/agywipe.js: it waits for
  // every Antigravity to close, and looks once more after): left out meanwhile, with
  // its sub-agents' conversations.
  const wiped = new Set();
  try {
    const ids = JSON.parse(fs.readFileSync(path.join(HOME, ".herdr", "cache", "agy-wiped.json"), "utf8")).ids;
    if (ids && typeof ids === "object") {
      for (const [id, e] of Object.entries(ids)) {
        wiped.add(id);
        if (Array.isArray(e?.tree)) for (const t of e.tree) wiped.add(String(t));
      }
    }
  } catch { /* none */ }
  for (const r of rows) {
    if (r.parent_conversation_id || Number(r.nesting_depth) > 0 || !/^[0-9A-Za-z-]+$/.test(String(r.conversation_id))) continue;
    if (wiped.has(String(r.conversation_id))) continue;
    let uris = [];
    try { uris = JSON.parse(r.workspace_uris || "[]"); } catch { uris = []; }
    const cwd = agyCwd(uris, agyDir, readRules, lastIn.get(r.conversation_id));
    const log = path.join(home, "brain", r.conversation_id, ".system_generated", "logs", "transcript.jsonl");
    const st = stat(log);
    const facts = st ? cached(log, st, (old) => {
      const fd = fs.openSync(log, "r");
      let f;
      try { f = agyFacts(piece(fd, 0, Math.min(HEAD, st.size)), st.size > HEAD ? piece(fd, Math.max(0, st.size - TAIL), TAIL) : ""); } finally { fs.closeSync(fd); }
      return { ...f, ...compactFields(compactions(log, st, "antigravity", old), f) };
    }) : null;
    const row = agyRow(r, facts ?? {}, cwd);
    if (row && facts) Object.assign(row, { compactions: facts.compactions, compacted: facts.compacted, context: facts.context });
    if (row && (!row.headless || flag("--headless"))) out.push(row);
  }
}

// --- the launcher's notes ---
// Which terminal holds which Claude session now, on the core this Herdr uses (the
// default one unless HC_SESSION names another), where addresses are bare.
function openNotes() {
  const map = new Map();
  const dir = path.join(process.env.HERDR_WS_RESUME_DIR || path.join(HOME, ".herdr", "resume"), process.env.HC_SESSION || "default");
  for (const f of readdir(dir)) {
    if (!f.name.endsWith(".session")) continue;
    try { const id = fs.readFileSync(path.join(dir, f.name), "utf8").split("\n")[0].trim(); if (id) map.set(id, f.name.slice(0, -8)); } catch { /* gone meanwhile */ }
  }
  return map;
}
// The command each Claude session was started with: the last one noted wins.
function startNotes() {
  const map = new Map();
  try {
    for (const l of fs.readFileSync(path.join(process.env.HERDR_WS_RESUME_DIR || path.join(HOME, ".herdr", "resume"), "started"), "utf8").split("\n")) {
      const i = l.indexOf("\t");
      if (i > 0) map.set(l.slice(0, i), l.slice(i + 1));
    }
  } catch { /* nothing noted yet */ }
  return map;
}

const sessions = [];
const safely = async (name, fn) => { try { await fn(sessions); } catch (e) { notes.push(`${name}: ${String(e?.message ?? e)}`); } };
await safely("Claude Code", scanClaude);
await safely("Pi", scanPi);
await safely("Grok", scanGrok);
await safely("Codex", scanCodex);
await safely("OpenCode", scanOpencode);
await safely("Antigravity", scanAntigravity);

const open = openNotes(), started = startNotes();
// A folder that's gone (a removed worktree, a deleted scratch folder) can't be resumed
// in: those don't count toward the limit, so they never crowd out the ones that can.
// Up to a third as many again are listed, from the same stretch of time.
const there = new Map();
const gone = (cwd) => { if (!there.has(cwd)) there.set(cwd, Boolean(stat(cwd)?.isDirectory())); return !there.get(cwd); };
const all = sessions.filter((s) => s.updated >= since && wanted(s.cwd)).sort((a, b) => b.updated - a.updated);
const live = all.filter((s) => !gone(s.cwd)).slice(0, limit);
const oldest = live.length === limit ? live[live.length - 1].updated : 0;
const lost = all.filter((s) => gone(s.cwd) && s.updated >= oldest).slice(0, Math.ceil(limit / 3));
const rows = [...live, ...lost].sort((a, b) => b.updated - a.updated).map((s) => {
  const { headless: _h, ...row } = s;
  if (s.provider === "claude" || s.provider === "antigravity") {
    if (open.has(s.id)) row.terminal = open.get(s.id);
    if (started.has(s.id)) row.words = started.get(s.id);
  }
  if (gone(s.cwd)) row.gone = true;
  return row;
});

if (dirty || Object.keys(kept).length !== Object.keys(cache).length) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(`${cacheFile}.${process.pid}.tmp`, JSON.stringify({ v: 4, files: kept }));
    fs.renameSync(`${cacheFile}.${process.pid}.tmp`, cacheFile);
  } catch { /* the next read parses them again */ }
}

const counts = {};
for (const s of rows) counts[s.provider] = (counts[s.provider] ?? 0) + 1;

if (flag("--list")) {
  const tilde = (p) => (HOME && (p === HOME || p.startsWith(HOME + "/")) ? "~" + p.slice(HOME.length) : p);
  for (const s of rows) console.log([ago(s.updated, now).padStart(4), (PROVIDERS[s.provider]?.name ?? s.provider).padEnd(11), clean(tilde(s.cwd), 44).padEnd(44), titleOf(s)].join("  "));
  for (const n of notes) console.error(n);
} else {
  process.stdout.write(JSON.stringify({ v: 1, at: now, days, sessions: rows, counts, notes }));
}
