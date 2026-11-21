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
// after that only what a transcript gained is read, since they only grow. In the same
// pass, a Claude transcript's `hc run` calls: the helpers that conversation started.
//
// Which conversation started which (treefacts.js: link()): the launcher's ledger
// ~/.herdr/resume/parents (herdr-ws-resume writes it), those `hc run` calls matched to
// the conversation whose first prompt is the task, and the agents' own sub-agents:
// Claude's <session>/subagents/agent-<id>.jsonl with its .meta.json beside it (only
// those two are read, and the transcript only stat'ed), Antigravity's
// parent_conversation_id, OpenCode's parent_id and Codex's thread_spawn source. A row
// another started has `parent` (its key) and `helper` ({ name, preset }) or, for a
// sub-agent, `readonly` and `sub` ({ type }). The helpers of a conversation listed are
// listed with it, whatever folder they ran in.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { claudeHead, claudeTail, piFacts, codexRow, opencodeRow, grokFacts, agyFacts, agyCwd, agyRow, clean, samePrompt, inside, PROVIDERS, titleOf, ago, COMPACTION, compactionOf, contextAtEnd } from "./histfacts.js";
import { hcRunCalls, ledgerOf, link, promptEnd, subRow, codexParentOf } from "./treefacts.js";

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
try { const c = JSON.parse(fs.readFileSync(cacheFile, "utf8")); if (c.v === 5) cache = c.files ?? {}; } catch { cache = {}; }
const kept = {};
let dirty = false;
// read(old) gets what was kept before; a `_k` it returns (compactions()) is kept beside the row.
function cached(file, st, read) {
  const old = cache[file];
  // A copy each time: link() writes on the rows, and that mustn't be kept.
  if (old && old.m === st.mtimeMs && old.s === st.size) { kept[file] = old; return old.row ? { ...old.row } : null; }
  let row = null;
  try { row = read(old); } catch { row = null; }
  const k = row?._k ?? null;
  if (row) delete row._k;
  kept[file] = k ? { m: st.mtimeMs, s: st.size, row, k } : { m: st.mtimeMs, s: st.size, row };
  dirty = true;
  return row ? { ...row } : null;
}

// Every compaction in a transcript: { n, list (the newest KEEP), off (read up to) }, and
// for Claude its `hc run` calls (`calls`, the newest CALLS; treefacts.js hcRunCalls()).
// When the file only grew since `old` read it, it reads on from there.
const CHUNK = 8 << 20, KEEP = 20, CALLS = 100;
const HC_RUN = Buffer.from("hc run"), ASSISTANT = '"type":"assistant"';
function compactions(file, st, provider, old) {
  const needle = Buffer.from(COMPACTION[provider]);
  const calls = provider === "claude";
  const prev = old?.k && old.k.off <= st.size ? old.k : { n: 0, list: [], off: 0 };
  const out = { n: prev.n, list: [...prev.list], off: prev.off, ...(calls ? { calls: [...(prev.calls ?? [])] } : {}) };
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
      // An assistant's line that runs `hc run`: the helpers it started.
      if (calls) {
        for (let i = data.indexOf(HC_RUN); i >= 0 && i < nl; i = data.indexOf(HC_RUN, i)) {
          const from = data.lastIndexOf(10, i) + 1, to = data.indexOf(10, i);
          const line = data.toString("utf8", from, to);
          if (line.includes(ASSISTANT)) for (const c of hcRunCalls(line)) { out.calls.push(c); if (out.calls.length > CALLS) out.calls.shift(); }
          i = to + 1;
        }
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
      provider: "claude", id, file, cwd: head.cwd, title: clean(tail.title, 120), first: clean(head.first, 240), firstEnd: promptEnd(head.first),
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
    const entries = readdir(path.join(root, d.name));
    const folders = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    for (const f of entries) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const file = path.join(root, d.name, f.name);
      const st = stat(file);
      if (!st || st.mtimeMs < since) continue;
      const id = f.name.slice(0, -6);
      const row = cached(file, st, (old) => claudeRow(file, st, id, old));
      if (!row || (row.headless && !flag("--headless"))) continue;
      // Its hc run calls, kept once in the cache beside the compactions (link() reads them).
      row.calls = kept[file]?.k?.calls ?? [];
      out.push(row);
      if (folders.has(id)) claudeSubs(path.join(root, d.name, id, "subagents"), row, out);
    }
  }
}
// Its own sub-agents (the Agent tool): agent-<id>.jsonl, only stat'ed, and the small
// agent-<id>.meta.json beside it ({ agentType, description }).
function claudeSubs(dir, parent, out) {
  for (const f of readdir(dir)) {
    if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
    const file = path.join(dir, f.name);
    const st = stat(file);
    if (!st || st.mtimeMs < since) continue;
    const row = cached(file, st, () => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(`${file.slice(0, -6)}.meta.json`, "utf8")) ?? {}; } catch { meta = {}; }
      const id = f.name.slice(0, -6);
      // Without its .meta.json: "sub-agent" and its id, short.
      return subRow("claude", id, `claude/${parent.id}`, { title: meta.description || `sub-agent ${id.replace(/^agent-/, "").slice(0, 8)}`, type: meta.agentType, cwd: parent.cwd, started: st.birthtimeMs, updated: st.mtimeMs });
    });
    if (row) out.push({ ...row, cwd: parent.cwd });
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
      provider: "pi", id, file, cwd: facts.cwd, title: clean(facts.name, 120), first: clean(facts.first, 240), firstEnd: promptEnd(facts.first),
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
  for (const r of rows) {
    const parent = codexParentOf(r.source);
    if (parent) {
      out.push(subRow("codex", String(r.id), `codex/${parent}`, { title: r.title || r.first_user_message, type: r.agent_role || r.agent_nickname || "", cwd: r.cwd,
        started: Number(r.created_at_ms) || Number(r.created_at) * 1000 || 0, updated: Number(r.updated_at_ms) || Number(r.updated_at) * 1000 || 0 }));
      continue;
    }
    const row = codexRow(r);
    if (row) out.push(row);
  }
}
async function scanOpencode(out) {
  const file = path.join(process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share"), "opencode", "opencode.db");
  if (!stat(file)) return;
  const rows = await sqlite(file, `select id, parent_id, directory, title, model, time_created, time_updated, time_archived from session where time_updated >= ${Math.floor(since)} order by time_updated desc limit ${limit}`);
  if (!rows) return notes.push("OpenCode's conversations couldn't be read: that needs Node 22.13 or newer, or the sqlite3 program.");
  for (const r of rows) {
    if (r.parent_id && !r.time_archived) {
      out.push(subRow("opencode", String(r.id), `opencode/${r.parent_id}`, { title: r.title, cwd: r.directory, started: Number(r.time_created) || 0, updated: Number(r.time_updated) || 0 }));
      continue;
    }
    const row = opencodeRow(r);
    if (row && (row.title || row.first)) out.push(row);
  }
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
    if (!/^[0-9A-Za-z-]+$/.test(String(r.conversation_id)) || wiped.has(String(r.conversation_id))) continue;
    let uris = [];
    try { uris = JSON.parse(r.workspace_uris || "[]"); } catch { uris = []; }
    const cwd = agyCwd(uris, agyDir, readRules, lastIn.get(r.conversation_id));
    // A sub-agent's: under its parent, read-only, its transcript not read.
    if (r.parent_conversation_id || Number(r.nesting_depth) > 0) {
      if (!/^[0-9A-Za-z-]+$/.test(String(r.parent_conversation_id ?? ""))) continue;
      const updated = Date.parse(String(r.last_modified_time ?? "").replace(" ", "T")) || 0;
      out.push(subRow("antigravity", String(r.conversation_id), `antigravity/${r.parent_conversation_id}`, { title: r.title || r.preview, cwd: cwd ?? "", started: updated, updated }));
      continue;
    }
    const log = path.join(home, "brain", r.conversation_id, ".system_generated", "logs", "transcript.jsonl");
    const st = stat(log);
    const facts = st ? cached(log, st, (old) => {
      const fd = fs.openSync(log, "r");
      let f;
      try { f = agyFacts(piece(fd, 0, Math.min(HEAD, st.size)), st.size > HEAD ? piece(fd, Math.max(0, st.size - TAIL), TAIL) : ""); } finally { fs.closeSync(fd); }
      return { ...f, ...compactFields(compactions(log, st, "antigravity", old), f) };
    }) : null;
    const row = agyRow(r, facts ?? {}, cwd);
    if (row && facts) Object.assign(row, { compactions: facts.compactions, compacted: facts.compacted, context: facts.context, firstEnd: promptEnd(facts.first) });
    if (row && st) row.file = log;
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

// Who started whom (treefacts.js link()), with the launcher's ledger; folders compared
// by where they really are (/tmp is /private/tmp on macOS).
const reals = new Map();
const real = (p) => { if (!reals.has(p)) { let r = p; try { r = fs.realpathSync(p); } catch { /* gone */ } reals.set(p, r); } return reals.get(p); };
let ledger = { sessions: [], starts: [] };
try { ledger = ledgerOf(fs.readFileSync(path.join(process.env.HERDR_WS_RESUME_DIR || path.join(HOME, ".herdr", "resume"), "parents"), "utf8")); } catch { /* none yet */ }
link(sessions, ledger, (a, b) => Boolean(a && b) && (a === b || real(a) === real(b)));

// A folder that's gone (a removed worktree, a deleted scratch folder) can't be resumed
// in: those don't count toward the limit, so they never crowd out the ones that can.
// Up to a third as many again are listed, from the same stretch of time. Sub-agents
// and helpers come with the conversation that started them, wherever they ran.
const there = new Map();
const gone = (cwd) => { if (!cwd) return false; if (!there.has(cwd)) there.set(cwd, Boolean(stat(cwd)?.isDirectory())); return !there.get(cwd); };
const all = sessions.filter((s) => !s.readonly && s.updated >= since && wanted(s.cwd)).sort((a, b) => b.updated - a.updated);
const live = all.filter((s) => !gone(s.cwd)).slice(0, limit);
const oldest = live.length === limit ? live[live.length - 1].updated : 0;
const lost = all.filter((s) => gone(s.cwd) && s.updated >= oldest).slice(0, Math.ceil(limit / 3));
const keyOf = (s) => `${s.provider}/${s.id}`;
const picked = new Map([...live, ...lost].map((s) => [keyOf(s), s]));
const under = new Map();
for (const s of sessions) if (s.parent) { if (!under.has(s.parent)) under.set(s.parent, []); under.get(s.parent).push(s); }
for (const list = [...picked.values()]; list.length;) {
  for (const c of under.get(keyOf(list.pop())) ?? []) if (!picked.has(keyOf(c))) { picked.set(keyOf(c), c); list.push(c); }
}
const known = new Map(sessions.map((s) => [keyOf(s), s]));
const rows = [...picked.values()].sort((a, b) => b.updated - a.updated).map((s) => {
  const { headless: _h, calls: _c, ...row } = s;
  if (!s.readonly && (s.provider === "claude" || s.provider === "antigravity")) {
    if (open.has(s.id)) row.terminal = open.get(s.id);
    if (started.has(s.id)) row.words = started.get(s.id);
  }
  // Its parent, when it was read but isn't listed (another folder): what it's called.
  if (s.parent && !picked.has(s.parent) && known.has(s.parent)) row.parentTitle = titleOf(known.get(s.parent));
  if (gone(s.cwd)) row.gone = true;
  return row;
});

if (dirty || Object.keys(kept).length !== Object.keys(cache).length) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(`${cacheFile}.${process.pid}.tmp`, JSON.stringify({ v: 5, files: kept }));
    fs.renameSync(`${cacheFile}.${process.pid}.tmp`, cacheFile);
  } catch { /* the next read parses them again */ }
}

const counts = {};
for (const s of rows) if (!s.readonly) counts[s.provider] = (counts[s.provider] ?? 0) + 1;

if (flag("--list")) {
  const tilde = (p) => (HOME && (p === HOME || p.startsWith(HOME + "/")) ? "~" + p.slice(HOME.length) : p);
  for (const s of rows) console.log([ago(s.updated, now).padStart(4), (PROVIDERS[s.provider]?.name ?? s.provider).padEnd(11), clean(tilde(s.cwd), 44).padEnd(44), titleOf(s)].join("  "));
  for (const n of notes) console.error(n);
} else {
  // core: the herdr-core whose notes were read (the Wipe dialog reads Pi's stats notes there).
  process.stdout.write(JSON.stringify({ v: 1, at: now, days, sessions: rows, counts, notes, core: process.env.HC_SESSION || "default" }));
}
