// What each agent's own records say about it, for the Agents list (main.js runs this
// with Node, as History runs its scan):
//
//   node stats.js [--t <address>=<agent>[:<pid>]]...
//
// prints { agents: { <address>: facts }, notes: [...] } (statfacts.js says what the
// facts are). <agent> is claude, pi or
// agy, <pid> the terminal's foreground program (hc get).
//
// Pi: the file the launcher's extension (ws-switcher/pi/herdr-stats.ts) keeps there.
//
// Antigravity: its transcript, through the conversation the launcher's restart hook
// noted for the terminal (~/.herdr/resume/<core>/<terminal>.session).
//
// Claude Code: the status line file herdr-ws-statusline keeps
// (~/.herdr/agents/<core>/<terminal>.json), when it's the running session's; the
// session itself from ~/.claude/sessions/<pid>.json, else from that file; and its
// transcript, read on from where the last run stopped (kept in
// ~/.herdr/cache/agentstats.json), since a transcript can be many megabytes.

import fs from "node:fs";
import path from "node:path";
import { claudeScan, claudeStatus, claudeFacts, piFacts, agyScan, agyFacts } from "./statfacts.js";

const HOME = process.env.HOME || "";
const CORE = process.env.HC_SESSION || "default";
const AGENTS = path.join(process.env.HERDR_WS_AGENTS_DIR || path.join(HOME, ".herdr", "agents"), CORE);
const CACHE = path.join(HOME, ".herdr", "cache", "agentstats.json");
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const NOTES = path.join(process.env.HERDR_WS_RESUME_DIR || path.join(HOME, ".herdr", "resume"), CORE);
const AGY = path.join(HOME, ".gemini", "antigravity-cli");
const DAY = 86400000;

const args = process.argv.slice(2);
const wanted = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--t" || !args[i + 1]) continue;
  const [address, rest] = args[++i].split("=");
  const [app, pid] = String(rest ?? "").split(":");
  if (/^[A-Za-z0-9._/-]+$/.test(address)) wanted.push({ address, app, pid: /^\d+$/.test(pid ?? "") ? pid : null });
}

const notes = [];
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const cache = readJson(CACHE) ?? {};
cache.files ??= {};
cache.where ??= {};
cache.sizes ??= {};
const now = Date.now();

// Every file here: Claude's status lines and Pi's. Files of terminals gone two days are removed.
const statuses = new Map();
const kept = new Map();
let entries = [];
try { entries = fs.readdirSync(AGENTS, { withFileTypes: true }); } catch { /* none yet */ }
for (const e of entries) {
  if (!e.isFile() || !e.name.endsWith(".json")) continue;
  const file = path.join(AGENTS, e.name);
  const address = e.name.slice(0, -5);
  let st;
  try { st = fs.statSync(file); } catch { continue; }
  if (now - st.mtimeMs > 2 * DAY && !wanted.some((w) => w.address === address)) { try { fs.unlinkSync(file); } catch { /* gone */ } continue; }
  const raw = readJson(file);
  kept.set(address, raw);
  if (raw?.agent) continue;
  const s = claudeStatus(raw);
  if (!s) continue;
  statuses.set(address, s);
  if (s.model && s.size) cache.sizes[s.model] = s.size;
}

// The transcript of a Claude session: where its status line said, else found by id.
function transcriptOf(session, hint) {
  if (hint && hint.endsWith(`${session}.jsonl`) && fs.existsSync(hint)) return hint;
  const known = cache.where[session];
  if (known && fs.existsSync(known)) return known;
  let dirs = [];
  try { dirs = fs.readdirSync(path.join(CLAUDE, "projects"), { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const f = path.join(CLAUDE, "projects", d.name, `${session}.jsonl`);
    if (fs.existsSync(f)) { cache.where[session] = f; return f; }
  }
  return null;
}

// A transcript's facts, reading only what was added since the last run.
function scanned(file, scan = claudeScan) {
  let size;
  try { size = fs.statSync(file).size; } catch { return null; }
  let c = cache.files[file];
  if (!c || size < c.off) c = { off: 0, n: 0, last: null, reply: null };
  if (size > c.off) {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - c.off);
      const got = fs.readSync(fd, buf, 0, buf.length, c.off);
      const end = buf.lastIndexOf(10, got - 1);
      if (end >= 0) {
        const s = scan(buf.toString("utf8", 0, end), c);
        c = { ...s, off: c.off + end + 1 };
      }
    } finally { fs.closeSync(fd); }
  }
  c.seen = now;
  cache.files[file] = c;
  return c;
}

const agents = {};
for (const w of wanted) {
  if (w.app === "pi") {
    // Kept by this Pi, not one that ran in this terminal before it.
    const raw = kept.get(w.address);
    if (raw?.agent === "pi" && (!w.pid || !raw.pid || String(raw.pid) === w.pid)) agents[w.address] = piFacts(raw);
    continue;
  }
  if (w.app === "agy") {
    // The conversation the launcher's hook noted for this terminal: its id, then its transcript.
    try {
      const [id, noted] = fs.readFileSync(path.join(NOTES, `${w.address}.session`), "utf8").split("\n");
      if (!/^[A-Za-z0-9-]+$/.test(id ?? "")) continue;
      const file = noted && noted.startsWith(AGY) ? noted : path.join(AGY, "brain", id, ".system_generated", "logs", "transcript.jsonl");
      const scan = scanned(file, agyScan);
      if (scan?.reply || scan?.n) agents[w.address] = { ...agyFacts(scan), session: id };
    } catch { /* not noted yet: its first prompt notes it */ }
    continue;
  }
  if (w.app !== "claude") continue;
  try {
    const running = w.pid ? readJson(path.join(CLAUDE, "sessions", `${w.pid}.json`)) : null;
    let status = statuses.get(w.address) ?? null;
    const session = running?.sessionId ?? status?.session ?? null;
    // A status line of an earlier Claude in this terminal says nothing about this one.
    if (status && session && status.session !== session) status = null;
    const file = session ? transcriptOf(session, status?.transcript) : null;
    const scan = file ? scanned(file) : null;
    if (!status && !scan) continue;
    agents[w.address] = { ...claudeFacts(status, scan, cache.sizes), session };
  } catch (e) {
    notes.push(`${w.address}: ${String(e?.message ?? e)}`);
  }
}

// The cache keeps a day of transcripts not looked at.
for (const [f, c] of Object.entries(cache.files)) if (now - (c.seen ?? 0) > DAY) delete cache.files[f];
for (const [s, f] of Object.entries(cache.where)) if (!fs.existsSync(f)) delete cache.where[s];
try {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const tmp = `${CACHE}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, CACHE);
} catch (e) { notes.push(`cache: ${String(e?.message ?? e)}`); }

process.stdout.write(JSON.stringify({ agents, notes }));
