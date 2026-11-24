// An automation file's rules, with no imports so `node` can test them: its front matter read and
// written (multi-line `check: |` included), its run mode, timeout, notification level, catch-up
// and dedupe policies, chaining loops, quiet hours and how many runs History keeps. Copied, the
// same, in ws-switcher (the runner) and ws-automations (the screen): change both
// (scripts/sync-from-home.sh checks they match).
//
//   ---
//   when: weekdays 08:55
//   run: shell             "agent" (the default) or "shell": the body is a script, run without an agent
//   shell: bash            "bash" (the default), "zsh" or "sh" (run: shell only)
//   terminal: true         a shell run shows in a tab of the Automations space (default: no tab)
//   timeout: 2m            30s, 2m, 15m, 1h or none; default 2m for a shell run, none for an agent
//   notify: problems       problems, results, all or none; default problems (shell), results (agent)
//   missed: skip           run (12 hours back, the default), skip (never late) or always (once, however late)
//   dedupe: always         changed (the default: on a schedule, a check printing the same is nothing new) or always
//   check: |               a check over several lines: a YAML block, indented
//     git status --porcelain
//   ---

// --- front matter ---

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(.*)$/;
// A block scalar's opening: "|", "|-", "|+", with an indent number ("|2", "|2-", "|-2"), maybe a comment.
const BLOCK = /^[ \t]*\|([+-]?)([1-9]?)([+-]?)[ \t]*(?:#.*)?$/;

// A value in quotes only when the quotes close it (a comment may follow): `"$HOME/bin/x" --flag` is
// a plain value that starts with a quote, not a quoted one.
const DQ = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/;
const SQ = /^'((?:[^']|'')*)'(?:\s+#.*)?$/;

function unquote(raw) {
  const v = raw.trim();
  const d = DQ.exec(v);
  if (d) { try { return JSON.parse(d[1]); } catch { return d[1].slice(1, -1); } }
  const q = SQ.exec(v);
  if (q) return q[1].replace(/''/g, "'");
  // A comment starts at " #": a # inside a word (a URL's fragment, "C#") isn't one.
  const hash = v.search(/\s#/);
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

const indentOf = (line) => /^ */.exec(line)[0].length;

// { headLines, entries, body, has }: the lines between the --- markers, each key found there
// ({ key, value, start, end, block }: its lines are headLines[start..end)), what's after, and
// whether the text has front matter at all. The first of a key twice is the one that counts.
export function splitFront(text) {
  const s = String(text ?? "").replace(/\r\n/g, "\n");
  // The closing --- starts a line: an `echo -----` or an indented --- in a `check: |` block isn't it.
  const m = /^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(s);
  if (!m) return { headLines: [], entries: [], body: s, has: false };
  const headLines = m[1] ? m[1].split("\n") : [];
  const entries = [];
  for (let i = 0; i < headLines.length;) {
    const k = KEY.exec(headLines[i]);
    if (!k) { i++; continue; }
    const b = BLOCK.exec(k[2]);
    if (!b) { entries.push({ key: k[1], value: unquote(k[2]), start: i, end: i + 1, block: false }); i++; continue; }
    // The block: every line after it that's blank or indented, up to the first that isn't.
    let j = i + 1;
    while (j < headLines.length && (!headLines[j].trim() || /^[ \t]/.test(headLines[j]))) j++;
    const lines = headLines.slice(i + 1, j);
    // How far its lines are indented: as its indent number says, else as its first line with text is.
    const first = lines.find((l) => l.trim());
    const indent = b[2] ? Number(b[2]) : first ? indentOf(first) : 0;
    const value = lines.map((l) => (l.trim() ? l.slice(Math.min(indent, indentOf(l))) : "")).join("\n").replace(/\n+$/, "");
    // Blank lines after the block, before the next key, aren't the block's: they stay where they are.
    let end = j;
    while (end > i + 1 && !headLines[end - 1].trim()) end--;
    entries.push({ key: k[1], value, start: i, end, block: true });
    i = j;
  }
  return { headLines, entries, body: s.slice(m[0].length), has: true };
}

// A key's value (a block's with its lines), null when it isn't there.
export function fieldValue(entries, key) {
  const e = (entries ?? []).find((x) => x.key === key);
  return e ? e.value : null;
}

// A value as it can be written on one line unquoted: anything the reader (splitFront) takes back as
// it is. Quoted: empty, a space at an end, a quote or "|" first (a quoted value, a block), a "#" first
// or after a space (a comment). "weekdays 09:00", "Say: hi", "true" and "12" stay plain.
function plainOk(s) {
  return s !== "" && !/^\s|\s$/.test(s) && !/^["'|#]/.test(s) && !/\s#/.test(s) && !s.includes("\n");
}

// One key's lines: `key: value` (quoted when it must be), true/false and numbers as they are,
// or a block (`key: |`, each line indented two spaces) for a value over several lines.
export function formatField(key, value) {
  if (typeof value === "boolean" || (typeof value === "number" && isFinite(value))) return `${key}: ${value}`;
  const s = String(value ?? "").replace(/\r\n/g, "\n");
  if (!s.includes("\n")) return `${key}: ${plainOk(s) ? s : JSON.stringify(s)}`;
  const lines = s.replace(/\n+$/, "").split("\n");
  // A first line that starts with spaces needs the indent said, or it would be read as the indent.
  const first = lines.find((l) => l.trim()) ?? "";
  const open = /^[ \t]/.test(first) ? "|2-" : "|-";
  return [`${key}: ${open}`, ...lines.map((l) => (l.trim() ? `  ${l}` : ""))].join("\n");
}

// The text with these keys set (a value) or taken out (null, undefined or ""), each in its place
// (a block replaced whole, none of its lines left behind), new ones at the end, every other line of
// the front matter as it was. body: the new body (trimmed; a blank line before it only when the old
// body had one), else the old.
export function withFrontFields(oldText, fields, newBody) {
  const parts = splitFront(oldText);
  const lines = [...parts.headLines];
  // From the last key up, so the line numbers of the ones above stay right.
  const edits = [];
  const added = [];
  for (const [k, v] of Object.entries(fields ?? {})) {
    const gone = v === null || v === undefined || v === "";
    const all = parts.entries.filter((e) => e.key === k);
    if (!all.length) { if (!gone) added.push(formatField(k, v)); continue; }
    // The first one gets the value; any later copy of the key goes.
    all.forEach((e, n) => edits.push({ e, text: gone || n > 0 ? null : formatField(k, v) }));
  }
  edits.sort((a, b) => b.e.start - a.e.start);
  for (const { e, text } of edits) lines.splice(e.start, e.end - e.start, ...(text === null ? [] : text.split("\n")));
  lines.push(...added.flatMap((t) => t.split("\n")));
  const gap = parts.has && /^[ \t]*\n/.test(parts.body) ? "\n" : "";
  const rest = newBody === undefined ? parts.body : `${gap}${String(newBody).trim()}\n`;
  return `---\n${lines.join("\n")}\n---\n${rest}`;
}

// A script or a check as the runner compares it with the one you allowed: line ends as \n,
// <!-- comments --> out (a script; a body's are notes), no blank lines or spaces at its ends.
export const normCheck = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
export const normScript = (s) => String(s ?? "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();

// --- lengths of time ---

const UNIT = { s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3, m: 60e3, min: 60e3, mins: 60e3, minute: 60e3, minutes: 60e3, h: 3600e3, hr: 3600e3, hrs: 3600e3, hour: 3600e3, hours: 3600e3 };

// "30s", "2m", "15 min", "1h", "1h30m": ms; "none", "off", "never", "0": 0 (no limit); else null.
export function parseDuration(str) {
  if (typeof str === "number") return isFinite(str) && str >= 0 ? Math.round(str) : null;
  const s = String(str ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(none|off|never|no|0)$/.test(s)) return 0;
  let ms = 0, rest = s.replace(/\s+/g, "");
  const part = /^(\d+(?:\.\d+)?)([a-z]+)/;
  let m;
  while (rest && (m = part.exec(rest))) {
    if (!UNIT[m[2]]) return null;
    ms += Number(m[1]) * UNIT[m[2]];
    rest = rest.slice(m[0].length);
  }
  return rest || !ms ? null : Math.round(ms);
}

// 30000: "30 s"; 120000: "2 min"; 3600000: "1 h"; 0: "none".
export function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return "none";
  if (n % 3600e3 === 0) return `${n / 3600e3} h`;
  if (n % 60e3 === 0) return `${n / 60e3} min`;
  return `${Math.round(n / 1e3)} s`;
}

export const SHELL_TIMEOUT = 120e3; // a shell run's limit when its file says none

// How long a run may take, in ms (0: as long as it likes): its `timeout:`, else 2 minutes for a
// shell run and no limit for an agent's.
export function effectiveTimeout(auto) {
  const t = auto?.timeout;
  if (t !== null && t !== undefined && t !== "") {
    const ms = parseDuration(t);
    if (ms !== null) return ms;
  }
  return auto?.run === "shell" ? SHELL_TIMEOUT : 0;
}

// --- run mode, notifications, catch-up and dedupe ---

export const RUN_MODES = ["agent", "shell"];
export const SHELLS = ["bash", "zsh", "sh"];
export const NOTIFY_LEVELS = ["problems", "results", "all", "none"];
export const MISSED_POLICIES = ["run", "skip", "always"];
export const DEDUPE_POLICIES = ["changed", "always"];

export const runOf = (auto) => (auto?.run === "shell" ? "shell" : "agent");
export const shellOf = (auto) => (SHELLS.includes(auto?.shell) ? auto.shell : "bash");

// Its notification level: its `notify:` when that's one, else problems for a shell run (quiet when
// it works) and results for an agent's.
export function effectiveNotify(auto) {
  return NOTIFY_LEVELS.includes(auto?.notify) ? auto.notify : runOf(auto) === "shell" ? "problems" : "results";
}

// Whether a level tells about this: kind "started", "finished" (with something to say),
// "problem" (failed, timed out, a check failing or not allowed, stuck, needs you, missed) or
// "nothing_to_do" (never told).
export function shouldNotify(level, kind) {
  if (kind === "nothing_to_do" || level === "none") return false;
  if (kind === "problem") return true;
  if (kind === "finished") return level === "results" || level === "all";
  if (kind === "started") return level === "all";
  return false;
}

// What a new key's value says is wrong, or null when it's fine (unset is fine).
export function optionError(key, value) {
  if (value === null || value === undefined || value === "") return null;
  const v = String(value).trim().toLowerCase();
  const list = { run: RUN_MODES, shell: SHELLS, notify: NOTIFY_LEVELS, missed: MISSED_POLICIES, dedupe: DEDUPE_POLICIES }[key];
  if (list) return list.includes(v) ? null : `${key}: is ${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}, not "${value}".`;
  if (key === "timeout") return parseDuration(v) === null ? `timeout: is a length of time ("30s", "2m", "1h") or none, not "${value}".` : null;
  return null;
}

// --- chaining ---

// The loop an automation is in through `when: automation done|failed <name>` lines, in the order
// they wait on each other (["a", "b", "a"]: a waits on b, which waits on a), or null when there's
// none. automations: [{ name, trigger }]. Each waits on one other at most, so this follows those.
export function findChainCycle(automations, startName) {
  const byName = new Map();
  for (const a of automations ?? []) if (a?.name && !byName.has(a.name)) byName.set(a.name, a);
  const path = [startName];
  const seen = new Set([startName]);
  for (let cur = byName.get(startName); cur; ) {
    const t = cur.trigger;
    if (t?.kind !== "chain" || !t.target) return null;
    path.push(t.target);
    if (t.target === startName) return path;
    if (seen.has(t.target)) return null; // a loop further up, not through this one
    seen.add(t.target);
    cur = byName.get(t.target);
  }
  return null;
}

// --- quiet hours ---

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// "22:00-08:00" (over midnight) or "13:00-14:00": { startMin, endMin } minutes after midnight;
// null for anything else (off), a start equal to its end included.
export function parseQuietHours(value) {
  if (value && typeof value === "object" && Number.isInteger(value.startMin) && Number.isInteger(value.endMin)) return value;
  const m = /^\s*(\S+)\s*[-–]\s*(\S+)\s*$/.exec(String(value ?? ""));
  const a = m && HM.exec(m[1]), b = m && HM.exec(m[2]);
  if (!a || !b) return null;
  const startMin = +a[1] * 60 + +a[2], endMin = +b[1] * 60 + +b[2];
  return startMin === endMin ? null : { startMin, endMin };
}

// Whether `date` (this computer's clock) is inside the quiet hours.
export function inQuietHours(value, date = new Date()) {
  const q = parseQuietHours(value);
  if (!q) return false;
  const min = date.getHours() * 60 + date.getMinutes();
  return q.startMin < q.endMin ? min >= q.startMin && min < q.endMin : min >= q.startMin || min < q.endMin;
}

// --- how many runs History keeps ---

export const RUNS_PER_AUTOMATION = 25;
export const RUNS_MAX = 500;
// A run waiting for a slot or still running is never dropped.
const going = (r) => r?.status === "queued" || r?.status === "running";

// The runs (newest first) to keep: perAuto per automation (its workspace and name), maxTotal in
// all, the oldest dropped first; runs still going are always kept. { kept, dropped }, each newest first.
export function pruneRuns(runs, { perAuto = RUNS_PER_AUTOMATION, maxTotal = RUNS_MAX } = {}) {
  const count = new Map();
  let kept = [];
  const dropped = [];
  for (const r of runs ?? []) {
    const k = `${r?.ws}/${r?.name}`;
    const n = count.get(k) ?? 0;
    if (going(r) || n < perAuto) { kept.push(r); if (!going(r)) count.set(k, n + 1); }
    else dropped.push(r);
  }
  if (kept.length > maxTotal) {
    let over = kept.length - maxTotal;
    const out = [];
    // From the oldest end: what isn't going goes until there are maxTotal.
    for (let i = kept.length - 1; i >= 0; i--) {
      if (over > 0 && !going(kept[i])) { dropped.push(kept[i]); over--; } else out.push(kept[i]);
    }
    kept = out.reverse();
  }
  return { kept, dropped };
}
