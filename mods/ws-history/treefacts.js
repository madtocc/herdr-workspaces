// History's family tree: which conversation started which, as rules with no imports, so
// `node` can test them; scan.js (Node) and main.js (the mod) both read it. Also History's
// right-click menu and what stands in the way of a wipe.
//
// Two kinds of children:
// - helpers: agents started with `hc run … herdr-ws-agent --preset <preset> "<task>"`
//   from another agent's terminal. Each is a conversation of its own that can be
//   resumed. Known from the launcher's ledger (~/.herdr/resume/parents, written by
//   herdr-ws-resume) or, for older ones, from the `hc run` calls in the parent's
//   Claude transcript matched to a conversation whose first prompt is that task.
// - sub-agents: an agent's own (Claude's Agent tool, Antigravity's, OpenCode's,
//   Codex's). Their stores name the parent; they can't be resumed on their own, so
//   they're shown read-only (`readonly: true`, `sub: { type }`).
//
// A row is History's: { provider, id, cwd, title, first, started, updated, … } and,
// after link(), `parent` (the parent's key, "claude/<id>") and `helper` ({ name, preset }).

const key = (s) => `${s.provider}/${s.id}`;

// One line of text: whitespace folded (as histfacts.js clean() does, without the cut).
const fold = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const tail = (p) => String(p ?? "").split("/").pop();
// What a prompt and a task are compared by: their first 239 characters (a row keeps 240
// of the first prompt, the last cut to "…") and their last 160 (a task handed over after
// a preset's instructions, as hc and the launcher do for agents without a system prompt).
export const START = 239, END = 160;
export const promptStart = (text) => fold(text).replace(/…$/, "").slice(0, START);
export const promptEnd = (text) => { const s = fold(text); return s.length > START ? s.slice(-END) : ""; };

// --- Reading `hc run` out of a shell command ---

// A shell command line as its simple commands, each a list of words ({ w, dyn }: dyn when
// part of it is only known when it runs: $VAR, $(…), `…`). Splits at ; & && || | and line
// ends, skips comments and here-documents. Good enough for what agents type; anything it
// can't follow ends the read (what came before it is kept).
export function shellCommands(text) {
  const s = String(text ?? "");
  const out = [];
  let cmd = [], word = null, dyn = false, i = 0, skip = false;
  const heredocs = [];
  // skip: the word after a redirection (>file, 2>&1) is where it goes, not an argument.
  const end = () => { if (word !== null) { if (skip) skip = false; else cmd.push({ w: word, dyn }); word = null; dyn = false; } };
  const next = () => { end(); if (cmd.length) out.push(cmd); cmd = []; };
  const add = (c) => { word = (word ?? "") + c; };
  try {
    while (i < s.length) {
      const c = s[i];
      if (c === "\n") {
        next(); i++;
        // Here-documents start on the next line and end at their word, alone on a line.
        while (heredocs.length) {
          const stop = heredocs.shift();
          for (;;) {
            if (i >= s.length) break;
            const nl = s.indexOf("\n", i);
            const line = nl < 0 ? s.slice(i) : s.slice(i, nl);
            i = nl < 0 ? s.length : nl + 1;
            if (line.replace(/^\t+/, "") === stop) break;
          }
        }
        continue;
      }
      if (c === " " || c === "\t") { end(); i++; continue; }
      if (c === "#" && word === null) { while (i < s.length && s[i] !== "\n") i++; continue; }
      if (c === ">" || (c === "<" && !(s[i + 1] === "<" && s[i + 2] !== "<"))) {
        // A redirection: its fd number (2>) and where it goes (/dev/null, &1) aren't words.
        if (word !== null && /^\d+$/.test(word) && !dyn) { word = null; dyn = false; } else end();
        i++;
        while (s[i] === ">" || s[i] === "<" || s[i] === "&" || s[i] === "|") i++;
        skip = true;
        continue;
      }
      if (c === ";" || c === "|" || c === "&" || c === "(" || c === ")") { skip = false; next(); i++; continue; }
      if (c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
        // <<WORD, <<-WORD, <<'WORD', <<"WORD": the document's end word.
        end();
        i += s[i + 2] === "-" ? 3 : 2;
        while (s[i] === " " || s[i] === "\t") i++;
        let stop = "";
        while (i < s.length && !/[\s;&|<>()]/.test(s[i])) {
          if (s[i] === "'" || s[i] === '"') { const q = s[i]; const j = s.indexOf(q, i + 1); if (j < 0) throw 0; stop += s.slice(i + 1, j); i = j + 1; }
          else if (s[i] === "\\") { stop += s[i + 1] ?? ""; i += 2; }
          else stop += s[i++];
        }
        if (stop) heredocs.push(stop);
        continue;
      }
      if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw 0; add(s.slice(i + 1, j)); i = j + 1; continue; }
      if (c === '"') {
        let j = i + 1, part = "";
        for (;;) {
          if (j >= s.length) throw 0;
          const d = s[j];
          if (d === '"') break;
          if (d === "\\" && j + 1 < s.length && '$`"\\\n'.includes(s[j + 1])) { if (s[j + 1] !== "\n") part += s[j + 1]; j += 2; continue; }
          if (d === "$" || d === "`") dyn = true;
          // $( … ) inside double quotes: skipped as a whole, with its own quotes.
          if (d === "$" && s[j + 1] === "(") { j = closing(s, j + 1); part += "…"; continue; }
          part += d; j++;
        }
        add(part); i = j + 1; continue;
      }
      if (c === "\\") { if (s[i + 1] !== "\n") add(s[i + 1] ?? ""); i += 2; continue; }
      if (c === "$" && s[i + 1] === "(") { dyn = true; i = closing(s, i + 1); add("…"); continue; }
      if (c === "$" || c === "`") { dyn = true; if (c === "`") { const j = s.indexOf("`", i + 1); if (j < 0) throw 0; i = j + 1; add("…"); continue; } }
      add(c); i++;
    }
  } catch { /* a quote that never closes: the rest isn't read */ word = null; }
  next();
  return out;
}
// Where the ( at `open` closes, past quotes inside: the index after it.
function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" ) { const j = s.indexOf("'", i + 1); if (j < 0) throw 0; i = j; continue; }
    if (c === '"') { let j = i + 1; while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1; if (j >= s.length) throw 0; i = j; continue; }
    if (c === "\\") { i++; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  throw 0;
}

// hc run's own flags that take a value (hc run --help).
const HC_VALUE = new Set(["--name", "--cwd", "--on", "--label", "--parent", "--timeout"]);
// Agents' programs, so `hc run claude "…"` isn't read as a template called claude.
const PROGRAMS = new Set(["claude", "codex", "pi", "agy", "grok", "opencode", "gemini", "cursor-agent", "agent", "sh", "bash", "zsh", "env", "node"]);

// A folder after `cd`: absolute, relative to `dir` (null: the shell's own folder), or
// "?" when it isn't known before it runs ($VAR, ~).
const into = (dir, to, dyn) => (dyn || to.startsWith("~") || dir === "?" ? "?" : to.startsWith("/") || !dir ? to : `${dir}/${to}`);

// Every `hc run` in a command: { name, preset, template, cwd, task } (task "" when it
// isn't known before it runs: a $(cat file), a variable). cwd: where the helper starts,
// as into() gives it ("" for the shell's own folder): its --cwd, after any `cd` before it.
export function hcRuns(command) {
  const out = [];
  let dir = null;
  for (const words of shellCommands(command)) {
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].w)) i++; // VAR=x before it
    if (words[i]?.w === "cd" && i === 0) { dir = words[1] ? into(dir, words[1].w, words[1].dyn) : "?"; continue; }
    if (tail(words[i]?.w) !== "hc" || words[i + 1]?.w !== "run") continue;
    i += 2;
    const run = { name: "", preset: "", template: "", cwd: dir ?? "", task: "" };
    let elsewhere = false;
    for (; i < words.length; i++) {
      const w = words[i].w;
      if (w === "--") { i++; break; }
      if (!w.startsWith("-")) break;
      const [flag, inline] = w.includes("=") ? [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)] : [w, null];
      // Nobody's helper, or another terminal's: not the calling conversation's.
      if (flag === "--no-parent" || flag === "--parent") elsewhere = true;
      if (!HC_VALUE.has(flag)) continue;
      const v = inline ?? words[++i]?.w ?? "";
      if (flag === "--name") run.name = v;
      if (flag === "--cwd") run.cwd = into(dir, v, words[i]?.dyn);
    }
    if (elsewhere) continue;
    const argv = words.slice(i);
    if (!argv.length) continue;
    const known = (list) => (list.some((x) => x.dyn) ? "" : list.map((x) => x.w).join(" "));
    if (tail(argv[0].w) === "herdr-ws-agent") {
      if (argv[1]?.w === "--preset") { run.preset = argv[2]?.w ?? ""; run.task = known(argv.slice(3)); }
      else {
        // --instructions FILE … --task TEXT <agent> [args…]: the preset is the last file's name.
        let j = 1, task = null;
        while (argv[j]?.w === "--instructions" || argv[j]?.w === "--task") {
          if (argv[j].w === "--task") task = argv[j + 1] ?? null;
          else run.preset = tail(argv[j + 1]?.w).replace(/\.md$/, "");
          j += 2;
        }
        const last = argv.length > j + 1 ? argv[argv.length - 1] : null;
        run.task = task ? (task.dyn ? "" : task.w) : last && !last.w.startsWith("-") && !last.dyn ? last.w : "";
      }
    } else if (!argv[0].w.includes("/") && !PROGRAMS.has(argv[0].w) && !argv[0].dyn) {
      run.template = argv[0].w; // hc's own template and its task
      run.task = known(argv.slice(1));
    } else {
      const last = argv[argv.length - 1];
      run.task = argv.length > 1 && !last.w.startsWith("-") && !last.dyn ? last.w : "";
    }
    out.push(run);
  }
  return out;
}

// The `hc run` calls in one line of a Claude transcript: an assistant message's Bash
// tool calls. { at, name, preset, cwd, start, end } with the task as promptStart/promptEnd.
export function hcRunCalls(line) {
  let o;
  try { o = typeof line === "string" ? JSON.parse(line) : line; } catch { return []; }
  if (o?.type !== "assistant" || !Array.isArray(o.message?.content)) return [];
  const at = Date.parse(o.timestamp ?? "");
  if (!Number.isFinite(at)) return [];
  const out = [];
  for (const p of o.message.content) {
    if (p?.type !== "tool_use" || typeof p.input?.command !== "string" || !p.input.command.includes("hc run")) continue;
    for (const r of hcRuns(p.input.command)) {
      if (!fold(r.task)) continue;
      // from: the folder the line ran in (hc starts a helper where it's run; Claude's shell keeps a cd between calls).
      out.push({ at, name: r.name, preset: r.preset || r.template, cwd: r.cwd, from: typeof o.cwd === "string" ? o.cwd : "", start: promptStart(r.task), end: promptEnd(r.task) });
    }
  }
  return out;
}

// --- The launcher's ledger, ~/.herdr/resume/parents ---
// One line each, tab-separated (herdr-ws-resume writes them):
//   <ms> session <terminal> <agent> <session id> <parent session|-> <parent terminal> <name> <preset>
//     the hook's, when an agent with a hook (Claude, Antigravity) opens a session
//   <ms> start   <terminal> <agent> <folder>     <parent session|-> <parent terminal> <name> <preset>
//     the launcher's, when it starts any agent under an hc parent
// <agent> is the program (claude, agy, pi, codex, grok, opencode).
const AGENT = { claude: "claude", agy: "antigravity", antigravity: "antigravity", pi: "pi", codex: "codex", grok: "grok", opencode: "opencode" };
export function ledgerOf(text) {
  const sessions = [], starts = [];
  for (const l of String(text ?? "").split("\n")) {
    const f = l.split("\t");
    if (f.length < 9) continue;
    const at = Number(f[0]);
    const provider = AGENT[f[3]];
    if (!Number.isFinite(at) || !provider) continue;
    const parent = f[5] && f[5] !== "-" ? f[5] : null;
    const e = { at, terminal: f[2], provider, parent, parentTerminal: f[6] === "-" ? "" : f[6], name: f[7] === "-" ? "" : f[7], preset: f[8] === "-" ? "" : f[8] };
    if (f[1] === "session" && f[4]) sessions.push({ ...e, id: f[4] });
    else if (f[1] === "start" && f[4].startsWith("/")) starts.push({ ...e, cwd: f[4] });
  }
  return { sessions, starts };
}

// --- Linking ---
// How long after an `hc run` (or the launcher's start) the helper's conversation may
// start: Claude can wait at its folder-trust question first. Pi asks nothing.
export const WINDOW = 15 * 60e3, PI_WINDOW = 2 * 60e3;
const EARLY = 5e3; // clocks and the order of writes: a little before counts too

// A folder by its own name: /a/./b/../c is /a/c.
function normal(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return "/" + out.join("/");
}

// Sets `parent` and `helper` on the rows it can, in this order (the first that knows wins):
// the hook's ledger lines (exact), the agents' own sub-agents (already set by the
// scanner, kept), `hc run` calls in Claude transcripts (rows' `calls`), then the
// launcher's start lines (by agent, folder and start time). A call or a start line goes to
// the conversation that fits it best among all of them, and only when that one isn't
// linked already: one whose helper is already known (by its session line) takes nothing
// else. A parent is found by id among the rows (any agent; a sub-agent's id climbs to the
// conversation it belongs to); one that isn't there stays named as `parent` ("?/<id>"),
// so History says "started by …".
// same(a, b): whether two folders are one (the scanner compares real paths).
export function link(rows, ledger = { sessions: [], starts: [] }, same = (a, b) => a === b) {
  const byId = new Map(), subs = new Map(), byKey = new Map(rows.map((s) => [key(s), s]));
  for (const s of rows) {
    if (s.readonly) { if (!subs.has(s.id)) subs.set(s.id, s); }
    else if (!byId.has(s.id)) byId.set(s.id, s);
  }
  const parentKey = (id) => {
    const p = byId.get(id);
    if (p) return key(p);
    // A sub-agent's conversation (an Antigravity note can name one): its own conversation.
    let x = subs.get(id);
    for (let n = 0; x?.readonly && n < 10; n++) x = byKey.get(x.parent);
    return x && !x.readonly ? key(x) : `?/${id}`;
  };
  const set = (s, parent, name, preset) => {
    if (!parent || parent === key(s)) return false;
    s.parent = parent;
    s.helper = { name: name || "", preset: preset || "" };
    return true;
  };
  // 1. The hook's lines: the last one for a session wins.
  for (const e of ledger.sessions) {
    const s = byId.get(e.id);
    if (!s || s.provider !== e.provider || !e.parent) continue;
    set(s, parentKey(e.parent), e.name, e.preset);
  }
  const closest = (list, at) => { let best = null; for (const s of list) if (!best || Math.abs(s.started - at) < Math.abs(best.started - at)) best = s; return best; };
  const fits = (s, at, window) => { const d = (s.started ?? 0) - at; return d >= -EARLY && d <= window; };
  // 2. hc run calls in the parents' transcripts: where the helper started (its --cwd, a cd
  // before it, else the parent's folder) and what it was asked first.
  const calls = [];
  for (const p of rows) for (const c of p.calls ?? []) calls.push({ ...c, parent: key(p), parentId: p.id, from: c.from || p.cwd });
  calls.sort((a, b) => a.at - b.at);
  for (const c of calls) {
    const where = !c.cwd ? c.from : c.cwd === "?" || c.cwd.startsWith("~") ? null : normal(c.cwd.startsWith("/") ? c.cwd : `${c.from}/${c.cwd}`);
    const best = closest(rows.filter((s) => !s.readonly && s.id !== c.parentId && fits(s, c.at, WINDOW) && askedFirst(s, c) && (!where || same(s.cwd, where))), c.at);
    if (best && !best.parent) set(best, c.parent, c.name, c.preset);
  }
  // 3. The launcher's start lines (the fallback when it couldn't learn the session): that
  // agent, that folder, a start soon after it. One followed by a session line of the same
  // terminal (before that terminal's next start) is known exactly; one whose parent already
  // has a helper of that hc name is that helper's. The rest are matched one to one, the
  // smallest time gap first, so helpers started together don't take each other's line.
  const starts = [...ledger.starts].sort((a, b) => a.at - b.at);
  const known = (e) => {
    const next = starts.find((x) => x.terminal === e.terminal && x.at > e.at)?.at ?? Infinity;
    return ledger.sessions.some((x) => x.terminal === e.terminal && x.at >= e.at && x.at < next);
  };
  const named = new Set(rows.filter((s) => s.parent && s.helper?.name).map((s) => `${s.parent}\t${s.helper.name}`));
  const pairs = [];
  starts.forEach((e, i) => {
    if (!e.parent || known(e)) return;
    const parent = parentKey(e.parent);
    if (e.name && named.has(`${parent}\t${e.name}`)) return;
    const window = e.provider === "pi" ? PI_WINDOW : WINDOW;
    for (const s of rows) {
      if (s.readonly || s.parent || s.provider !== e.provider || s.id === e.parent || !same(s.cwd, e.cwd) || !fits(s, e.at, window)) continue;
      pairs.push({ i, e, s, parent, gap: Math.abs((s.started ?? 0) - e.at) });
    }
  });
  pairs.sort((a, b) => a.gap - b.gap);
  const used = new Set();
  for (const x of pairs) {
    if (used.has(x.i) || x.s.parent) continue;
    used.add(x.i);
    set(x.s, x.parent, x.e.name, x.e.preset);
  }
}

// Whether a conversation's first prompt is a call's task: the same start (one a prefix
// of the other only where the row's own copy was cut short), or, after a preset's
// instructions, the same end.
export function askedFirst(s, c) {
  const first = promptStart(s.first);
  if (first && c.start) {
    if (first === c.start) return true;
    if (/…$/.test(String(s.first ?? "")) && first.length >= 200 && c.start.startsWith(first)) return true;
  }
  return Boolean(s.firstEnd && c.end && s.firstEnd === c.end);
}

// --- The tree ---
// The rows as trees: roots (nobody listed started them), each node's children, and the
// newest activity in each tree (`latest`: it and everything under it). Trees and their
// children are sorted by that, newest first. A parent that's its own ancestor (bad data)
// doesn't hold: such a row is a root.
export function forest(rows) {
  const by = new Map(rows.map((s) => [key(s), s]));
  const kids = new Map();
  const roots = [];
  const loops = (s) => {
    const seen = new Set([key(s)]);
    for (let p = by.get(s.parent); p; p = by.get(p.parent)) {
      if (seen.has(key(p))) return true;
      seen.add(key(p));
    }
    return false;
  };
  for (const s of rows) {
    const p = s.parent ? by.get(s.parent) : null;
    if (p && !loops(s)) { if (!kids.has(key(p))) kids.set(key(p), []); kids.get(key(p)).push(s); }
    else roots.push(s);
  }
  const latest = new Map();
  const newest = (s) => {
    const k = key(s);
    if (latest.has(k)) return latest.get(k);
    latest.set(k, s.updated ?? 0); // a guard while it's worked out
    let t = s.updated ?? 0;
    for (const c of kids.get(k) ?? []) t = Math.max(t, newest(c));
    latest.set(k, t);
    return t;
  };
  for (const s of rows) newest(s);
  const order = (a, b) => latest.get(key(b)) - latest.get(key(a));
  roots.sort(order);
  for (const list of kids.values()) list.sort(order);
  return { roots, kids, latest, by };
}

// What a parent's chip says: "8 helpers", "3 sub-agents", "2 helpers, 1 sub-agent".
export function chipText(kids = []) {
  const subs = kids.filter((s) => s.readonly).length, helpers = kids.length - subs;
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  return [helpers && n(helpers, "helper"), subs && n(subs, "sub-agent")].filter(Boolean).join(", ");
}

// The names on the line under a row with helpers ("tree-check, review, Explore ×2"): each
// helper's hc name and each sub-agent's type, in order, a repeat counted on its first.
// A helper with no hc name isn't named.
export function kidNames(kids = []) {
  const n = new Map();
  for (const s of kids) {
    const w = s.helper?.name || (s.readonly ? s.sub?.type || "sub-agent" : "");
    if (w) n.set(w, (n.get(w) ?? 0) + 1);
  }
  return [...n].map(([w, k]) => (k > 1 ? `${w} ×${k}` : w)).join(", ");
}

// The rows to draw, in order: { s, depth, kids, open, forced }. `pass(s)`: a row the
// search and filters let through; `root(s)`: whether a tree may show at all (the folder-
// gone rule); `unfolded`: keys opened by hand. With a filter on (`filtering`), a tree shows
// when any row of it passes, opened down to the rows that do (`forced`), with only those
// under it; a row that passes itself but has none under it that does shows folded, and
// opened by hand shows all of its children.
export function treeRows(f, { pass = () => true, root = () => true, unfolded = new Set(), filtering = false } = {}) {
  const hit = new Map();
  const below = (s) => {
    const k = key(s);
    if (hit.has(k)) return hit.get(k);
    hit.set(k, false);
    const v = (f.kids.get(k) ?? []).some((c) => pass(c) || below(c));
    hit.set(k, v);
    return v;
  };
  const out = [];
  const walk = (s, depth, seen) => {
    const k = key(s);
    if (seen.has(k)) return;
    seen.add(k);
    const kids = f.kids.get(k) ?? [];
    const forced = filtering && below(s);
    const open = kids.length > 0 && (forced || unfolded.has(k));
    out.push({ s, depth, kids, open, forced });
    if (!open) return;
    for (const c of kids) if (!forced || pass(c) || below(c)) walk(c, depth + 1, seen);
  };
  for (const s of f.roots) {
    if (!root(s)) continue;
    if (filtering && !pass(s) && !below(s)) continue;
    walk(s, 0, new Set());
  }
  return out;
}

// How far a row at that depth is drawn in: 20px a level, at most 4 levels.
export const indent = (depth) => Math.min(depth, 4) * 20;

// --- The right-click menu ---
// A History row's menu: { id, label, icon, hint?, danger?, sep? }, drawn as the Agents
// list's (menufacts.js menuHeight() sizes it). f: { at (the terminal it's open in),
// gone, readonly, wipe (whether Wipe can be offered: its agent's files are known) }.
export function historyMenu(f) {
  if (f.readonly) return [];
  const out = [];
  if (f.at) out.push({ id: "goto", label: "Go to", icon: "mods/workspace-chrome/terminal.svg", hint: f.at });
  else if (!f.gone) out.push({ id: "resume", label: "Resume", icon: "mods/ws-history/history.svg" });
  out.push({ id: "copy", label: "Copy session id", icon: "mods/ws-agents/copy.svg" });
  if (f.wipe) out.push({ id: "wipe", label: "Wipe session…", icon: "mods/ws-agents/trash.svg", danger: true, sep: true, ...(f.agy ? { hint: "experimental" } : {}) });
  return out;
}

// --- What stands in the way of a wipe ---
// A wipe moves a conversation's files to the Trash; an agent still writing to them would
// write on (or write them again).

// How sure History is that a live terminal holds conversation `id` (of `provider`), by the
// process running there now (`pid`, its foreground program, as ws-agents/stats.js tells
// them apart): "exact" (Claude: ~/.claude/sessions/<pid>.json, which Claude keeps for each
// running process, says it, `running`; Pi: its stats note says it and was written by this
// pid, `statsPid`), "other" (that says another one), "maybe" (only notes that may be an
// earlier agent's name it: the launcher's .session note, a stats note of another pid,
// History's own resume claim) or "unknown". Only "exact" may be closed by a wipe.
export function holdState(provider, id, { pid = null, running = null, note = null, stats = null, statsPid = null, claim = null } = {}) {
  if (provider === "claude" && running) return running === id ? "exact" : "other";
  if (provider === "pi" && stats && pid && String(statsPid) === String(pid)) return stats === id ? "exact" : "other";
  return [note, stats, claim].includes(id) ? "maybe" : "unknown";
}

// For one conversation (`s`, with menufacts.js wipeTargets() as `targets`):
//   open: the terminal known for sure to hold it ("exact"), which the wipe closes first;
//   maybe: terminals that might hold it, by notes that can't be trusted to close one;
//   others: live terminals running that agent in its folder (real paths) that aren't known
//         to hold another conversation (they might hold this one), checked even when open;
//   written: when its transcript was last written (ms), `now` the same clock;
//   app: started in an agent's desktop app or an editor, where History can't see it open.
// Returns { ok: true, close } or { ok: false, why } in plain words.
export const RECENT = 2 * 60e3, APP_RECENT = 30 * 60e3;
//   procs: running Claude processes (pids) that have it open by ~/.claude/sessions, other than
//         the one in `open` (outside any terminal History could close: another terminal app);
//   missing: its transcript isn't there any more.
export function wipeCheck(s, { targets = [], open = null, maybe = [], others = [], procs = [], written = null, now = Date.now(), name = "", app = false, missing = false } = {}) {
  const who = name || (s.provider === "pi" ? "Pi" : "Claude Code");
  if (s.readonly) return { ok: false, why: "A sub-agent's conversation is part of the one that started it: wipe that one." };
  if (!targets.length) return { ok: false, why: "Its files aren't where History expects them, so nothing would be wiped." };
  if (missing) return { ok: false, why: "Its files are already gone (wiped or moved elsewhere). History reads again to catch up." };
  if (procs.length) return { ok: false, why: `${who} is running with this conversation open (process ${procs.join(", ")}), outside the terminals History can close. Close it there first, then wipe.` };
  if (maybe.length) return { ok: false, why: `It may be open in ${maybe.join(", ")}, but History can't be sure which conversation that ${who} holds now. Close it in ${maybe[0]} first, then wipe.` };
  if (others.length) {
    const list = others.join(", ");
    return { ok: false, why: s.provider === "pi"
      ? `A Pi is running in its folder (${list}), and Pi doesn't keep its file open, so there's no telling whether it's this conversation. Close it first, then wipe.`
      : `${who} is running in its folder (${list}) and may have this conversation open. Close it first (or wipe it from the Agents list, which closes it), then wipe.` };
  }
  if (open) return { ok: true, close: open };
  if (app && (written == null || now - written < APP_RECENT)) {
    return { ok: false, why: `It was started in ${who}'s desktop app or an editor, where History can't see whether it's open, and it was used in the last half hour. Close it there first, or wipe it once it's been left for half an hour.` };
  }
  if (written == null || now - written < RECENT) {
    return { ok: false, why: "It was written to in the last two minutes, so an agent may still have it open somewhere History can't see. Close that agent first, or try again in a couple of minutes." };
  }
  return { ok: true, close: null };
}

// The live terminals under one (its hc helpers and theirs): hc ends them when it ends.
// terms: terminals() ({ address, parent, state, name }).
export function liveUnder(address, terms = []) {
  const out = [];
  const seen = new Set([address]);
  for (let i = 0, list = [address]; i < list.length; i++) {
    for (const t of terms) {
      if (t?.parent !== list[i] || t.state !== "live" || seen.has(t.address)) continue;
      seen.add(t.address);
      list.push(t.address);
      out.push({ address: String(t.address), name: String(t.name ?? "") });
    }
  }
  return out;
}

// The conversations under one (helpers and their helpers, not sub-agents: those go with
// their own conversation's files), depth first.
export function helpersOf(f, s) {
  const out = [];
  const seen = new Set([key(s)]);
  const walk = (p) => {
    for (const c of f.kids.get(key(p)) ?? []) {
      if (seen.has(key(c))) continue;
      seen.add(key(c));
      if (!c.readonly) out.push(c);
      walk(c);
    }
  };
  walk(s);
  return out;
}

// --- Rows for sub-agents ---
// A sub-agent's row: read-only, under `parent` (its key). `type`: what the agent calls
// it (Claude's agentType: "Explore", "general-purpose").
export function subRow(provider, id, parent, { title = "", first = "", type = "", cwd = "", started = 0, updated = 0 } = {}) {
  const cut = (t, max) => { const x = fold(t); return x.length > max ? x.slice(0, max - 1).trimEnd() + "…" : x; };
  return {
    provider, id: String(id), cwd: String(cwd ?? ""), title: cut(title, 120), first: cut(first, 240), last: "", model: "", branch: "",
    started: Number(started) || Number(updated) || 0, updated: Number(updated) || Number(started) || 0, via: "",
    parent, readonly: true, sub: { type: String(type ?? "") },
  };
}

// The thread that spawned a Codex thread, from its `source` column
// ({"subagent":{"thread_spawn":{"parent_thread_id":…}}}), else null.
export function codexParentOf(source) {
  let o = source;
  if (typeof o === "string") { if (!o.startsWith("{")) return null; try { o = JSON.parse(o); } catch { return null; } }
  const id = o?.subagent?.thread_spawn?.parent_thread_id;
  return typeof id === "string" && /^[0-9A-Za-z-]+$/.test(id) ? id : null;
}
