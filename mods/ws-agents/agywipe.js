// Wipes one Antigravity conversation, for the Agents list's experimental Wipe (main.js:
// doWipeAgy()): takes it and its sub-agents' conversations out of Antigravity's own
// lists, checks they're gone, then moves their files into the wipe's backup folder
// (you move that folder to the Trash once you're sure). Node (22.13 or newer, for
// node:sqlite), as stats.js; pbfacts.js holds the edits and rules themselves.
//
//   node agywipe.js check   <home> <antigravity dir> <id> [<pid>]
//       changes nothing; prints what a wipe would take ({ root, tree, subs, title,
//       preview, last, files, listed, running, family, confirm, problems }). <pid>: the
//       agent's own process; its family (process group and children) isn't "another".
//   node agywipe.js wipe    <home> <antigravity dir> <id> [<pid> [<family pids,…>]]
//       waits for those to end, checks again, then wipes: prints { state: done | pending
//       | failed | refused, … }
//   node agywipe.js pending <home>
//       finishes what's pending (main.js asks every minute); prints { cleaned, failed,
//       gaveUp, left, entries, running }
//   node agywipe.js restore <home> <backup dir>
//       puts back what the wipe took out of the lists, and its files
//
// Antigravity lists a conversation in jetbox_summaries_proto.pb (a protobuf map from id
// to summary, top-level field 1 = { 1: id, 2: summary }; it rebuilds its database from
// this file on every start), conversation_summaries.db (conversation_summaries,
// conversations_fts, conversation_parents), cache/last_conversations.json (folder ->
// id), cache/conversation_metadata.json ({ conversations: { id: … } }) and history.jsonl
// (the prompts typed, with their conversationId). Its own files are brain/<id>/,
// conversations/<id>.db, presence/<id>.lock and annotations/<id>.pbtxt. Its logs
// (log/cli-*.log) mention it too; they're left.
//
// An interactive Antigravity keeps the summaries in memory and writes them back, so
// while one runs (or when ps can't say) nothing is changed: the conversation goes into
// ~/.herdr/cache/agy-wiped.json (History hides what's there) and `pending` does the wipe
// once none runs, then looks once more a minute later. One run at a time (the lock
// ~/.herdr/cache/agy-wipe.lock). A wipe has one backup folder,
// ~/.herdr/trash/antigravity-<id>-<time>/, kept across retries: each pass gets a folder
// of its own there (the first the folder itself, then pass-<n>) holding copies of what it
// edits (the database as one consistent file, VACUUM INTO) and what it removes
// (removed.json, written before each edit; the rows also as rows.sql); manifest.json
// lists the passes and where each file went; files/ holds the conversation's files.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ID, pbDrop, pbAppend, pbKeys, mentions, jsonDrop, jsonInsert, jsonlDrop, jsonlInsert, treeOf, filesOf, pendingNext, TRIES,
  psRows, agyKind, familyOf, otherAgents, passFolder } from "./pbfacts.js";

// node:sqlite says it's experimental on every load; nobody reads that here.
process.removeAllListeners("warning");

// The process list comes from ps (HERDR_WS_PS: another program, for testing).
const PS = process.env.HERDR_WS_PS || "ps";
// HERDR_WS_STOP_AT=<step>: the process ends there, as a crash would (for testing).
const stopAt = (step) => { if (process.env.HERDR_WS_STOP_AT === step) process.exit(9); };
const PB = "jetbox_summaries_proto.pb";
const DB = "conversation_summaries.db";
const LAST = "cache/last_conversations.json";
const META = "cache/conversation_metadata.json";
const HIST = "history.jsonl";
const CACHES = [
  [LAST, [], (_k, v, tree) => typeof v === "string" && tree.has(v)],
  [META, ["conversations"], (k, _v, tree) => tree.has(k)],
];
const TABLES = { conversation_summaries: ["conversation_id"], conversations_fts: ["conversation_id"], conversation_parents: ["conversation_id", "parent_id"] };
const MAX_TREE = 25; // conversations under one root a wipe takes at once
const WAIT_MS = 15000; // for the agent's own processes to end

const say = (o) => process.stdout.write(JSON.stringify(o));
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const errText = (e) => String(e?.message ?? e);

// Where things are for one home (given by the app, never guessed from $HOME).
function places(home) {
  if (!home || !path.isAbsolute(home)) throw new Error("no home folder given");
  const h = path.resolve(home);
  return {
    home: h,
    agy: path.join(h, ".gemini", "antigravity-cli"),
    cache: path.join(h, ".herdr", "cache"),
    pending: path.join(h, ".herdr", "cache", "agy-wiped.json"),
    lock: path.join(h, ".herdr", "cache", "agy-wipe.lock"),
    trash: path.join(h, ".herdr", "trash"),
  };
}

// Antigravity's folder, which must be the one under this home.
function agyDir(w, dir) {
  if (!dir || path.resolve(dir) !== w.agy) throw new Error(`not Antigravity's folder (${w.agy})`);
  if (!fs.existsSync(path.join(w.agy, DB))) throw new Error(`Antigravity's database isn't there (${DB})`);
  return w.agy;
}
// A backup folder this wrote: ~/.herdr/trash/antigravity-…
const isBackup = (w, p) => typeof p === "string" && path.dirname(path.resolve(p)) === w.trash && path.basename(p).startsWith("antigravity-");

function sqlite() {
  const s = process.getBuiltinModule?.("node:sqlite");
  if (!s?.DatabaseSync) throw new Error("this needs Node 22.13 or newer (node:sqlite)");
  return s;
}
function openDb(dir, readOnly) {
  const db = new (sqlite().DatabaseSync)(path.join(dir, DB), readOnly ? { readOnly: true } : {});
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
// The tables Antigravity's database has, each with its columns.
function tablesOf(db) {
  const out = new Map();
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    if (!Object.hasOwn(TABLES, name)) continue;
    out.set(name, new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name)));
  }
  return out;
}

// --- processes ---

// The process table ([{ pid, ppid, pgid, comm, args }]). Throws when ps doesn't answer:
// then nobody can say whether Antigravity runs, and every caller takes that as "it may".
function table() {
  const run = (args) => {
    try { return execFileSync(PS, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000, maxBuffer: 32 << 20 }); } catch (e) {
      throw new Error(`ps didn't answer (${e.code ?? `exit ${e.status}`})`);
    }
  };
  const rows = psRows(run(["-axo", "pid=,ppid=,pgid=,comm="]), run(["-axww", "-o", "pid=,args="]));
  if (!rows.length) throw new Error("ps listed no processes");
  return rows;
}
const tableOrNull = () => { try { return table(); } catch { return null; } };
// Processes that have one of the files open (lsof), when lsof is there.
function holders(files) {
  const there = files.filter(exists);
  if (!there.length) return [];
  try { return execFileSync("lsof", ["-t", "--", ...there], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).split("\n").map((l) => l.trim()).filter(Boolean); } catch (e) {
    return String(e?.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  }
}

// --- files ---

// Replaces a file (the one a link points to, if it's a link): written beside it, flushed
// to disk, renamed over it, then the folder flushed, keeping its mode. `same` (optional)
// is checked just before the rename and stops it when it says the file changed.
function replaceFile(file, data, same) {
  const real = fs.realpathSync(file);
  const mode = fs.statSync(real).mode & 0o777;
  const tmp = `${real}.herdr-${process.pid}`;
  let fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (same && !same()) throw new Error(`${path.basename(file)} changed while it was being edited`);
    fs.renameSync(tmp, real);
  } catch (e) {
    if (fd != null) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch { /* gone */ }
    throw e;
  }
  syncDir(path.dirname(real));
}
function syncDir(dir) {
  try { const d = fs.openSync(dir, "r"); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch { /* not every system flushes a folder */ }
}
const stamp = (file) => { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}:${s.ino}`; };
// Writes a file of ours and flushes it, through a temporary name, so it's whole or old.
function writeOwn(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  syncDir(path.dirname(file));
}
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
// Leftovers of a run that was stopped (name-<pid> temporary files), ten minutes old.
function sweep(dir, re) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!re.test(n)) continue;
    try { if (Date.now() - fs.statSync(path.join(dir, n)).mtimeMs > 10 * 60000) fs.unlinkSync(path.join(dir, n)); } catch { /* gone */ }
  }
}

// The lock around every run that edits: a folder (mkdir either makes it or doesn't),
// with its owner. One whose owner is gone, or ten minutes old, is taken over, but only
// when ps can say so: when it can't, the lock stays.
function lock(w, waitMs) {
  fs.mkdirSync(path.dirname(w.lock), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(w.lock);
      writeOwn(path.join(w.lock, "owner"), JSON.stringify({ pid: process.pid, at: Date.now() }));
      return () => fs.rmSync(w.lock, { recursive: true, force: true });
    } catch (e) { if (e.code !== "EEXIST") throw e; }
    let since = Date.now();
    try { since = fs.statSync(w.lock).mtimeMs; } catch { continue; }
    const owner = readJson(path.join(w.lock, "owner"));
    const rows = tableOrNull();
    if (rows) {
      const gone = owner?.pid ? !rows.some((r) => r.pid === String(owner.pid)) : Date.now() - since > 30000;
      if (gone || Date.now() - (owner?.at ?? since) > 10 * 60000) { fs.rmSync(w.lock, { recursive: true, force: true }); continue; }
    }
    if (Date.now() >= until) return null;
    sleep(200);
  }
}

// --- the pending list ---
function readPending(w) {
  let raw;
  try { raw = fs.readFileSync(w.pending, "utf8"); } catch { return {}; }
  try {
    const ids = JSON.parse(raw)?.ids;
    if (ids && typeof ids === "object" && !Array.isArray(ids)) return ids;
  } catch { /* below */ }
  // Unreadable: kept aside, not lost.
  fs.renameSync(w.pending, `${w.pending}.bad-${Date.now()}`);
  return {};
}
function writePending(w, ids) {
  fs.mkdirSync(path.dirname(w.pending), { recursive: true });
  if (!Object.keys(ids).length) { try { fs.unlinkSync(w.pending); } catch { /* none */ } return; }
  writeOwn(w.pending, JSON.stringify({ ids }, null, 2));
}
// What's wrong with a pending entry (null: one this wrote, its backup folder there).
function entryProblem(w, root, e) {
  const ok = ID.test(root) && e && typeof e === "object" && Array.isArray(e.tree) && e.tree.length && e.tree.every((t) => ID.test(t))
    && e.tree.includes(root) && path.resolve(String(e.dir ?? "")) === w.agy && isBackup(w, e.backup);
  if (!ok) return "its entry in the pending list isn't one this wrote";
  return fs.existsSync(e.backup) ? null : `its backup folder ${e.backup} is gone, so nothing more was changed`;
}
const goodEntry = (w, root, e) => !entryProblem(w, root, e);

// --- what a wipe would take ---

// What in the lists still names one of the ids, or names it in a way the edits don't
// know (then they'd leave it): store -> a few words. Read from each store as it is now.
function blockers(dir, set) {
  const out = {};
  const pbFile = path.join(dir, PB);
  if (exists(pbFile)) {
    try {
      const { out: rest } = pbDrop(fs.readFileSync(pbFile), set);
      if ([...set].some((t) => mentions(rest, t))) out[PB] = "mentions it outside the entries this knows how to remove";
    } catch (e) { out[PB] = `can't be read (${errText(e)})`; }
  }
  for (const [name, keys, match] of CACHES) {
    let s;
    try { s = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    try {
      const rest = jsonDrop(s, keys, (k, v) => match(k, v, set)).text;
      if ([...set].some((t) => rest.includes(t))) out[name] = "mentions it outside the entries this knows how to remove";
    } catch (e) { out[name] = `can't be edited safely (${errText(e)})`; }
  }
  try {
    const rest = jsonlDrop(fs.readFileSync(path.join(dir, HIST), "utf8"), set).text;
    if ([...set].some((t) => rest.includes(t))) out[HIST] = "mentions it outside the lines this knows how to remove";
  } catch { /* none */ }
  return out;
}

// The conversation's tree and facts, and what stands in the way, changing nothing.
function inspect(w, dirArg, id, pid, mine = []) {
  if (!ID.test(id ?? "")) throw new Error("not a conversation id");
  const dir = agyDir(w, dirArg);
  const problems = [];
  const db = openDb(dir, true);
  let root, tree, rows = [], related = [], dbRows = 0;
  try {
    const tables = tablesOf(db);
    for (const [t, cols] of tables) for (const c of TABLES[t]) if (!cols.has(c)) problems.push(`Antigravity's database has a layout this doesn't know (${t} has no ${c})`);
    const sums = tables.get("conversation_summaries");
    if (!sums) problems.push("Antigravity's database has no conversation_summaries table");
    const links = [];
    if (sums?.has("parent_conversation_id")) links.push(...db.prepare("SELECT conversation_id AS id, parent_conversation_id AS parent FROM conversation_summaries WHERE parent_conversation_id <> ''").all());
    if (tables.get("conversation_parents")?.has("parent_id")) links.push(...db.prepare("SELECT conversation_id AS id, parent_id AS parent FROM conversation_parents").all());
    ({ root, tree } = treeOf(links.map((l) => ({ id: String(l.id), parent: String(l.parent) })), id));
    if (!ID.test(root) || tree.some((t) => !ID.test(t))) throw new Error("its conversation tree holds an id that isn't one");
    if (sums?.has("conversation_id")) {
      const get = db.prepare("SELECT * FROM conversation_summaries WHERE conversation_id = ?");
      rows = tree.map((t) => get.get(t)).filter(Boolean);
      dbRows = rows.length;
      // Sub-agents one level under their parent, as Antigravity numbers them.
      if (sums.has("nesting_depth") && sums.has("parent_conversation_id")) {
        const depth = new Map(rows.map((r) => [String(r.conversation_id), Number(r.nesting_depth)]));
        for (const r of rows) {
          const up = String(r.parent_conversation_id || "");
          if (up && depth.has(up) && Number(r.nesting_depth) !== depth.get(up) + 1) problems.push("its sub-agent links disagree (nesting_depth)");
        }
      }
      // Battles (one prompt run by several agents, one winning) link conversations this doesn't know how to take apart.
      if (sums.has("battle_id") && sums.has("winning_conversation_id")) {
        const set = new Set(tree);
        const battles = [...new Set(rows.map((r) => String(r.battle_id || "")).filter(Boolean))];
        for (const b of battles) related.push(...db.prepare("SELECT conversation_id AS id FROM conversation_summaries WHERE battle_id = ?").all(b).map((r) => String(r.id)));
        for (const r of rows) if (r.winning_conversation_id) related.push(String(r.winning_conversation_id));
        const marks = tree.map(() => "?").join(", ");
        related.push(...db.prepare(`SELECT conversation_id AS id FROM conversation_summaries WHERE winning_conversation_id IN (${marks})`).all(...tree).map((r) => String(r.id)));
        related = [...new Set(related)].filter((r) => !set.has(r));
        if (related.length) problems.push(`it's linked to other conversations (${related.slice(0, 3).join(", ")}${related.length > 3 ? ", …" : ""}) as one prompt run several ways, which this doesn't know how to wipe`);
      }
    }
  } finally { db.close(); }
  if (tree.length > MAX_TREE) problems.push(`it has ${tree.length} conversations under one root, more than a wipe takes at once (${MAX_TREE})`);
  const set = new Set(tree);
  const listed = { pb: 0, db: dbRows, cache: 0, history: 0 };
  try { listed.pb = pbKeys(fs.readFileSync(path.join(dir, PB))).filter((k) => set.has(k)).length; } catch { /* in blockers */ }
  for (const [name, keys, match] of CACHES) {
    try { listed.cache += jsonDrop(fs.readFileSync(path.join(dir, name), "utf8"), keys, (k, v) => match(k, v, set)).removed.length; } catch { /* in blockers */ }
  }
  try { listed.history = jsonlDrop(fs.readFileSync(path.join(dir, HIST), "utf8"), set).removed.length; } catch { /* none */ }
  for (const [name, why] of Object.entries(blockers(dir, set))) problems.push(`${name} ${why}`);
  const files = tree.flatMap((t) => filesOf(dir, t)).filter(exists);
  if (!problems.length && !files.length && !Object.values(listed).some(Boolean)) problems.push("Antigravity doesn't list this conversation and it has no files: there's nothing to wipe");
  // Another Antigravity with it open would write it back, and its files with it. The
  // agent's own processes (its group and children) don't count.
  const procs = tableOrNull();
  const family = [...new Set([...(procs && pid ? familyOf(procs, pid) : []), ...mine])];
  const others = procs ? otherAgents(procs, family) : null;
  if (procs) {
    const open = new Set(procs.filter((p) => agyKind(p.comm, p.args) && !family.includes(p.pid) && tree.some((t) => p.args.includes(t))).map((p) => p.pid));
    for (const h of holders(tree.map((t) => `${dir}/presence/${t}.lock`))) if (!family.includes(h) && h !== String(process.pid)) open.add(h);
    if (open.size) problems.push(`it's open in another Antigravity too (process ${[...open].join(", ")}): close that one first`);
  }
  try {
    fs.mkdirSync(w.trash, { recursive: true });
    const probe = path.join(w.trash, `.probe-${process.pid}`);
    writeOwn(probe, "");
    fs.unlinkSync(probe);
  } catch (e) { problems.push(`the backup folder ${w.trash} can't be written (${e.code ?? e.message})`); }
  const byId = new Map(rows.map((r) => [String(r.conversation_id), r]));
  const row = byId.get(root);
  // A wipe of more than the note's own conversation asks twice (main.js).
  const confirm = [];
  if (root !== id) confirm.push("note");
  if (tree.length > 1) confirm.push("tree");
  return {
    id, root, tree, dir,
    title: String(row?.title ?? ""), preview: String(row?.preview ?? ""), last: lastActive(row),
    subs: tree.filter((t) => t !== root).slice(0, 3).map((t) => ({ id: t, title: String(byId.get(t)?.title || byId.get(t)?.preview || "") })),
    files, listed, running: others ? others.length : null, family, confirm, problems,
  };
}
// When it was last used (ms), from its row's times (0001-01-01 means never).
function lastActive(row) {
  const t = [row?.last_user_input_time, row?.last_modified_time].map((v) => Date.parse(String(v ?? "").replace(" ", "T"))).filter((v) => v > Date.UTC(1971, 0));
  return t.length ? Math.max(...t) : null;
}

// --- a pass: back up, edit, check, move ---

// A database value for JSON (blobs and big integers don't go as they are) and back.
const enc = (v) => (v instanceof Uint8Array ? { $b64: Buffer.from(v).toString("base64") } : typeof v === "bigint" ? { $int: String(v) } : v);
const dec = (v) => (v && typeof v === "object" ? (v.$b64 != null ? Buffer.from(v.$b64, "base64") : v.$int != null ? BigInt(v.$int) : v) : v);
const quote = (n) => `"${String(n).replace(/"/g, '""')}"`;
function sqlValue(v) {
  if (v == null) return "NULL";
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}
const insertSql = (table, row) => `INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(", ")}) VALUES (${Object.values(row).map(sqlValue).join(", ")});`;

function manifest(e, change) {
  const file = path.join(e.backup, "manifest.json");
  const old = readJson(file) ?? {};
  const m = { ...old, dir: e.dir, id: e.id, root: e.root, tree: e.tree, title: e.title, at: e.at, passes: old.passes ?? [], trashed: old.trashed ?? [] };
  change?.(m);
  writeOwn(file, JSON.stringify(m, null, 2));
  return m;
}

// One pass over the lists for the entry's tree, in a folder of its own: what it'll
// remove is saved before each edit (removed.json), so a pass stopped anywhere leaves a
// record of everything it took out. { n, changed, removed: counts }; a failure carries
// `changed`.
function pass(w, e) {
  const dir = e.dir;
  const set = new Set(e.tree);
  const { n, dir: sub } = passFolder(fs.readdirSync(e.backup));
  const into = sub ? path.join(e.backup, sub) : e.backup;
  if (sub) fs.mkdirSync(into, { mode: 0o700 });
  const removed = { pb: [], db: {}, cache: {}, history: [] };
  const changed = [];
  const save = () => {
    writeOwn(path.join(into, "removed.json"), JSON.stringify({
      pass: n,
      pb: removed.pb.map((r) => ({ id: r.id, b64: Buffer.from(r.bytes).toString("base64") })),
      db: Object.fromEntries(Object.entries(removed.db).map(([t, rows]) => [t, rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, enc(v)])))])),
      cache: removed.cache, history: removed.history,
    }, null, 1));
    writeOwn(path.join(into, "rows.sql"), Object.entries(removed.db).flatMap(([t, rows]) => rows.map((r) => insertSql(t, r))).join("\n") + "\n");
  };
  // Started: this folder is this pass's from now on.
  save();
  manifest(e, (m) => { m.passes.push({ n, at: Date.now(), state: "started" }); });
  try {
    // Copies first (never over an earlier one): the summary file and caches as they
    // are, the database as one file.
    fs.mkdirSync(path.join(into, "cache"), { recursive: true });
    for (const f of [PB, LAST, META, HIST]) if (exists(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(into, f), fs.constants.COPYFILE_EXCL);
    const db = openDb(dir, false);
    try {
      db.prepare("VACUUM INTO ?").run(path.join(into, DB));
      fs.chmodSync(path.join(into, DB), 0o600);
      // The database's rows go in one transaction, open (so the database is ours) before
      // the summary file changes: a locked database changes nothing.
      const tables = tablesOf(db);
      db.exec("BEGIN IMMEDIATE");
      try {
        const ids = [...set];
        const marks = ids.map(() => "?").join(", ");
        const plan = [];
        for (const [t, cols] of tables) {
          const where = cols.has("parent_id") ? `conversation_id IN (${marks}) OR parent_id IN (${marks})` : `conversation_id IN (${marks})`;
          const args = cols.has("parent_id") ? [...ids, ...ids] : ids;
          const sel = db.prepare(`SELECT * FROM ${quote(t)} WHERE ${where}`);
          sel.setReadBigInts(true);
          const rows = sel.all(...args).map((r) => ({ ...r }));
          if (rows.length) { removed.db[t] = rows; plan.push([t, where, args]); }
        }
        const pbFile = path.join(dir, PB);
        let pbNext = null;
        const before = exists(pbFile) ? stamp(pbFile) : null;
        if (before) {
          const r = pbDrop(fs.readFileSync(pbFile), set);
          if (r.removed.length) { removed.pb = r.removed; pbNext = r.out; }
        }
        // Saved before anything changes.
        save();
        for (const [t, where, args] of plan) db.prepare(`DELETE FROM ${quote(t)} WHERE ${where}`).run(...args);
        if (pbNext) {
          replaceFile(pbFile, pbNext, () => stamp(pbFile) === before);
          changed.push("pb");
        }
        stopAt("after-pb");
        db.exec("COMMIT");
        if (plan.length) changed.push("db");
        stopAt("after-commit");
      } catch (err) {
        try { db.exec("ROLLBACK"); } catch { /* not open */ }
        throw err;
      }
    } finally { db.close(); }
    // The caches and the prompt history, edited as text, each saved before it changes.
    for (const [name, keys, match] of CACHES) {
      const file = path.join(dir, name);
      let s;
      try { s = fs.readFileSync(file, "utf8"); } catch { continue; }
      const r = jsonDrop(s, keys, (k, v) => match(k, v, set));
      if (!r.removed.length) continue;
      removed.cache[name] = r.removed;
      save();
      replaceFile(file, r.text);
      changed.push(name);
    }
    const hist = path.join(dir, HIST);
    if (exists(hist)) {
      const r = jsonlDrop(fs.readFileSync(hist, "utf8"), set);
      if (r.removed.length) {
        removed.history = r.removed;
        save();
        replaceFile(hist, r.text);
        changed.push(HIST);
      }
    }
  } catch (err) {
    err.changed = changed;
    err.n = n;
    throw err;
  }
  return { n, changed, removed: { pb: removed.pb.length, rows: Object.values(removed.db).reduce((s, r) => s + r.length, 0), cache: Object.values(removed.cache).reduce((s, r) => s + r.length, 0), history: removed.history.length } };
}

// What still lists any of the ids, read again from each store: by the edits' own
// matchers and, for every store, the id anywhere in its text (store -> n, -1 unreadable).
function leftIn(dir, set) {
  const left = {};
  const pbFile = path.join(dir, PB);
  if (exists(pbFile)) {
    try {
      const data = fs.readFileSync(pbFile);
      const n = pbKeys(data).filter((k) => set.has(k)).length;
      if (n || [...set].some((t) => mentions(data, t))) left[PB] = n || 1;
    } catch { left[PB] = -1; }
  }
  const db = openDb(dir, true);
  try {
    let n = 0;
    for (const [t, cols] of tablesOf(db)) {
      for (const id of set) n += Number(db.prepare(`SELECT count(*) AS n FROM ${quote(t)} WHERE conversation_id = ?${cols.has("parent_id") ? " OR parent_id = ?" : ""}`).get(...(cols.has("parent_id") ? [id, id] : [id])).n);
    }
    if (n) left[DB] = n;
  } finally { db.close(); }
  for (const name of [LAST, META, HIST]) {
    try {
      const s = fs.readFileSync(path.join(dir, name), "utf8");
      const n = [...set].filter((t) => s.includes(t)).length;
      if (n) left[name] = n;
    } catch (e) { if (e.code !== "ENOENT") left[name] = -1; }
  }
  return left;
}

// Moves a conversation's files into the backup folder's files/ (files-<n>/ for what a
// later pass finds), each recorded in the manifest as it goes. { moved, failed }.
function moveFiles(e, n) {
  const moved = [];
  const failed = [];
  for (const p of e.tree.flatMap((t) => filesOf(e.dir, t))) {
    if (!exists(p)) continue;
    const rel = path.relative(e.dir, p);
    let dest = path.join(e.backup, "files", rel);
    if (exists(dest)) dest = path.join(e.backup, `files-${n}`, rel);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      try { fs.renameSync(p, dest); } catch (err) {
        if (err.code !== "EXDEV") throw err;
        fs.cpSync(p, dest, { recursive: true, preserveTimestamps: true });
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch (err) { failed.push(`${p} (${err.code ?? err.message})`); continue; }
    moved.push({ path: p, to: dest });
    manifest(e, (m) => { m.trashed.push({ path: p, to: dest }); });
  }
  return { moved, failed };
}

// A pass for an entry, then the files once the lists are checked: { state, … }. Each
// pass is in the manifest, a failed one too, with what it changed.
function finish(w, e) {
  const set = new Set(e.tree);
  sweep(e.dir, /\.herdr-\d+$/);
  for (const sub of ["cache"]) sweep(path.join(e.dir, sub), /\.herdr-\d+$/);
  // What the edits can't handle now stops the pass before anything changes.
  const b = blockers(e.dir, set);
  if (Object.keys(b).length) return { state: "failed", stage: "check", error: Object.entries(b).map(([k, v]) => `${k} ${v}`).join("; "), changed: [] };
  let r;
  try { r = pass(w, e); } catch (err) {
    const error = errText(err);
    const changed = err?.changed ?? [];
    if (err?.n) manifest(e, (m) => { const p = m.passes.find((x) => x.n === err.n); if (p) Object.assign(p, { state: "failed", error, changed }); });
    return { state: "failed", stage: "edit", error, changed };
  }
  let left;
  try { left = leftIn(e.dir, set); } catch (err) {
    manifest(e, (m) => { const p = m.passes.find((x) => x.n === r.n); if (p) Object.assign(p, { state: "unchecked", changed: r.changed, removed: r.removed }); });
    return { state: "failed", stage: "check", error: `the lists couldn't be read again (${errText(err)})`, changed: r.changed };
  }
  if (Object.keys(left).length) {
    manifest(e, (m) => { const p = m.passes.find((x) => x.n === r.n); if (p) Object.assign(p, { state: "still listed", changed: r.changed, removed: r.removed, left }); });
    return { state: "failed", stage: "check", error: `still listed in ${Object.keys(left).join(", ")} after the edit`, changed: r.changed, left };
  }
  const { moved, failed } = moveFiles(e, r.n);
  manifest(e, (m) => {
    const p = m.passes.find((x) => x.n === r.n);
    if (p) Object.assign(p, { state: failed.length ? "partly moved" : "done", changed: r.changed, removed: r.removed });
    m.state = failed.length ? "partly moved" : "done";
  });
  if (failed.length) return { state: "failed", stage: "move", error: `couldn't move ${failed.join(", ")}`, changed: r.changed, moved };
  return { state: "done", changed: r.changed, removed: r.removed, moved };
}

// The entry's changes so far, across passes.
const unite = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])];

// --- commands ---

function cmdWipe(w, dirArg, id, pidArg, familyArg) {
  const pid = /^\d+$/.test(pidArg ?? "") ? pidArg : null;
  const mine = [...new Set([pid, ...String(familyArg ?? "").split(",")].filter((p) => /^\d+$/.test(p ?? "")))];
  // The agent's own processes first have to have ended (main.js closed its terminal);
  // while ps can't say, they count as running.
  let still = mine;
  for (const end = Date.now() + WAIT_MS; still.length && Date.now() < end; sleep(200)) {
    const rows = tableOrNull();
    still = rows ? mine.filter((p) => rows.some((r) => r.pid === p)) : mine;
  }
  const unlock = lock(w, 8000);
  if (!unlock) return { state: "refused", error: "another wipe is running; try again in a moment", changed: [] };
  let e, base;
  try {
    sweep(w.cache, /^agy-wiped\.json\.\d+$/);
    const f = inspect(w, dirArg, id, null, still);
    if (f.problems.length) return { state: "refused", error: f.problems.join("; "), root: f.root, changed: [] };
    // One backup folder per wipe: a wipe already pending for this conversation keeps its own.
    const ids = readPending(w);
    const old = goodEntry(w, f.root, ids[f.root]) ? ids[f.root] : null;
    const at = Date.now();
    e = { ...(old ?? {}), id, root: f.root, tree: unite(old?.tree, f.tree), dir: f.dir, title: f.title || f.preview || old?.title || "", at: old?.at ?? at,
      tries: 0, error: null, done: null, wait: still, changed: old?.changed ?? [], backup: old?.backup ?? path.join(w.trash, `antigravity-${f.root}-${at}`) };
    fs.mkdirSync(e.backup, { recursive: true, mode: 0o700 });
    manifest(e, (m) => { m.state = "pending"; });
    // Recorded before anything changes, so History hides it and `pending` finishes it.
    ids[f.root] = e;
    writePending(w, ids);
    base = { root: e.root, tree: e.tree, title: e.title, backup: e.backup };
  } catch (err) {
    unlock();
    return { state: "failed", stage: "record", error: errText(err), changed: [] };
  }
  try {
    if (still.length) return { ...base, state: "pending", why: "closing", changed: e.changed };
    const rows = tableOrNull();
    if (!rows) return { ...base, state: "pending", why: "unknown", changed: e.changed };
    const running = otherAgents(rows).length;
    if (running) return { ...base, state: "pending", why: "running", running, changed: e.changed };
    const r = finish(w, e);
    const changed = unite(e.changed, r.changed);
    try {
      const now = readPending(w);
      if (now[e.root]) {
        now[e.root] = r.state === "done" ? { ...now[e.root], done: Date.now(), wait: [], changed } : { ...now[e.root], tries: 1, error: r.error, changed };
        writePending(w, now);
      }
    } catch (err) { r.note = `the pending list couldn't be updated (${errText(err)})`; }
    return { ...base, ...r, changed, running: 0 };
  } finally { unlock(); }
}

function cmdPending(w) {
  const out = { cleaned: [], failed: [], gaveUp: [], left: [], entries: {}, running: 0 };
  if (!exists(w.pending)) return out;
  const unlock = lock(w, 0);
  if (!unlock) return { ...out, busy: true };
  try {
    sweep(w.cache, /^agy-wiped\.json\.\d+$/);
    const ids = readPending(w);
    const rows = tableOrNull();
    out.unknown = !rows;
    out.running = rows ? otherAgents(rows).length : null;
    const now = Date.now();
    for (const [root, e] of Object.entries(ids)) {
      const name = String(e?.title || root);
      try {
        const bad = entryProblem(w, root, e);
        if (bad) { delete ids[root]; out.gaveUp.push({ id: root, title: name, error: bad, changed: Array.isArray(e?.changed) ? e.changed : [] }); continue; }
        // Waiting while an Antigravity runs, ps can't say, or the agent's own processes are still closing.
        const busy = !rows ? 1 : out.running + (e.wait ?? []).filter((p) => rows.some((r) => r.pid === String(p))).length;
        const next = pendingNext(e, now, busy);
        if (next === "wait") { out.left.push(root); continue; }
        if (next === "give-up") {
          delete ids[root];
          out.gaveUp.push({ id: root, title: name, error: e.error || "no pass could finish it in a week", backup: e.backup, changed: e.changed ?? [] });
          continue;
        }
        if (next === "recheck") {
          const left = leftIn(e.dir, new Set(e.tree));
          const files = e.tree.flatMap((t) => filesOf(e.dir, t)).filter(exists);
          if (!Object.keys(left).length && !files.length) { delete ids[root]; continue; }
          // Something put it back: another pass.
        }
        const r = finish(w, e);
        const changed = unite(e.changed, r.changed);
        if (r.state === "done") {
          if (next === "recheck") delete ids[root];
          else { ids[root] = { ...e, done: Date.now(), wait: [], tries: 0, error: null, changed }; out.cleaned.push({ id: root, title: name, backup: e.backup, moved: r.moved.length }); }
        } else {
          ids[root] = { ...e, tries: (e.tries ?? 0) + 1, error: r.error, changed };
          if (ids[root].tries >= TRIES) { delete ids[root]; out.gaveUp.push({ id: root, title: name, error: r.error, backup: e.backup, changed }); }
          else out.failed.push({ id: root, title: name, error: r.error, tries: ids[root].tries, changed });
        }
      } catch (err) {
        ids[root] = { ...e, tries: (e?.tries ?? 0) + 1, error: errText(err) };
        out.failed.push({ id: root, title: name, error: ids[root].error, tries: ids[root].tries, changed: e?.changed ?? [] });
      }
    }
    for (const [root, e] of Object.entries(ids)) out.entries[root] = { done: Boolean(e.done), tries: e.tries ?? 0, error: e.error ?? null, backup: e.backup };
    writePending(w, ids);
    return out;
  } finally { unlock(); }
}

function cmdRestore(w, backupArg) {
  const backup = path.resolve(backupArg ?? "");
  if (!isBackup(w, backup)) throw new Error(`not a wipe's backup folder (${w.trash}/antigravity-…)`);
  const m = readJson(path.join(backup, "manifest.json"));
  if (!m || path.resolve(String(m.dir ?? "")) !== w.agy || !ID.test(String(m.root ?? ""))) throw new Error("no manifest.json of a wipe there");
  const unlock = lock(w, 8000);
  if (!unlock) throw new Error("a wipe is running; try again in a moment");
  try {
    // Any Antigravity at all (a probe or the editor bridge too) could write its lists back over this.
    const rows = tableOrNull();
    if (!rows) throw new Error("can't tell whether Antigravity runs (ps didn't answer): nothing was changed");
    const running = rows.filter((r) => agyKind(r.comm, r.args));
    if (running.length) throw new Error(`Antigravity is running (process ${running.map((p) => p.pid).join(", ")}): close every Antigravity first, it would write its own lists back over this`);
    const dir = w.agy;
    const back = { pb: 0, rows: 0, cache: 0, history: 0, files: [] };
    const names = fs.readdirSync(backup);
    const passes = [backup, ...names.filter((d) => /^pass-\d+$/.test(d)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).map((d) => path.join(backup, d))];
    for (const p of passes) {
      const r = readJson(path.join(p, "removed.json"));
      if (!r) continue;
      if (r.pb?.length) {
        const file = path.join(dir, PB);
        const data = exists(file) ? fs.readFileSync(file) : Buffer.alloc(0);
        const a = pbAppend(data, r.pb.map((x) => ({ bytes: Buffer.from(x.b64, "base64") })));
        if (a.added) { if (exists(file)) replaceFile(file, a.out); else writeOwn(file, a.out); }
        back.pb += a.added;
      }
      const tables = Object.entries(r.db ?? {});
      if (tables.length) {
        const db = openDb(dir, false);
        try {
          const have = tablesOf(db);
          // The search index has no key of its own: a conversation's rows go back only
          // when it has none there now.
          const indexed = new Set();
          if (have.has("conversations_fts")) for (const row of r.db.conversations_fts ?? []) {
            const id = dec(row.conversation_id);
            if (db.prepare('SELECT count(*) AS n FROM "conversations_fts" WHERE conversation_id = ?').get(id).n > 0) indexed.add(id);
          }
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const [t, list] of tables) {
              if (!have.has(t)) continue;
              for (const row of list) {
                const cols = Object.keys(row).filter((c) => have.get(t).has(c));
                if (t === "conversations_fts" && indexed.has(dec(row.conversation_id))) continue;
                const res = db.prepare(`INSERT${t === "conversations_fts" ? "" : " OR IGNORE"} INTO ${quote(t)} (${cols.map(quote).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => dec(row[c])));
                back.rows += Number(res.changes);
              }
            }
            db.exec("COMMIT");
          } catch (err) { db.exec("ROLLBACK"); throw err; }
        } finally { db.close(); }
      }
      for (const [name, keys] of CACHES) {
        const members = r.cache?.[name];
        if (!members?.length) continue;
        const file = path.join(dir, name);
        if (!exists(file)) continue;
        const a = jsonInsert(fs.readFileSync(file, "utf8"), keys, members);
        if (a.added) replaceFile(file, a.text);
        back.cache += a.added;
      }
      if (r.history?.length && exists(path.join(dir, HIST))) {
        const a = jsonlInsert(fs.readFileSync(path.join(dir, HIST), "utf8"), r.history);
        if (a.added) replaceFile(path.join(dir, HIST), a.text);
        back.history += a.added;
      }
    }
    // The files, from files/ and files-<n>/ (<area>/<name>), where nothing has their place now.
    for (const f of names.filter((d) => d === "files" || /^files-\d+$/.test(d)).sort()) {
      for (const area of fs.readdirSync(path.join(backup, f))) {
        if (!["brain", "conversations", "presence", "annotations"].includes(area)) continue;
        for (const name of fs.readdirSync(path.join(backup, f, area))) {
          const to = path.join(dir, area, name);
          if (exists(to)) continue;
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.renameSync(path.join(backup, f, area, name), to);
          back.files.push(to);
        }
      }
    }
    const ids = readPending(w);
    delete ids[m.root];
    writePending(w, ids);
    writeOwn(path.join(backup, "manifest.json"), JSON.stringify({ ...m, restored: Date.now() }, null, 2));
    return back;
  } finally { unlock(); }
}

const [cmd, homeArg, a1, a2, a3, a4] = process.argv.slice(2);
try {
  const w = places(homeArg);
  if (cmd === "check") say(inspect(w, a1, a2, a3));
  else if (cmd === "wipe") {
    const r = cmdWipe(w, a1, a2, a3, a4);
    say(r);
    if (r.state === "failed" || r.state === "refused") process.exitCode = 2;
  } else if (cmd === "pending") say(cmdPending(w));
  else if (cmd === "restore") say(cmdRestore(w, a1));
  else throw new Error("usage: agywipe.js check|wipe <home> <dir> <id> [pid [family]] | pending <home> | restore <home> <backup>");
} catch (e) {
  process.stderr.write(errText(e));
  process.exitCode = 1;
}
