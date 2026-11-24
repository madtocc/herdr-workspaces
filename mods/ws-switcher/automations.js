// Automations: agents a workspace starts by itself. Each is a file,
// ~/.herdr/workspaces/<id>/automations/<name>.md, or, for every workspace,
// ~/.herdr/automations/<name>.md (a global one). A global one runs in each
// workspace as if it were that workspace's own: its root, board, presets and
// Automations space. A workspace's own of the same name replaces it there, and
// its `off:` line names the workspaces it's off in.
//
//   ---
//   description: Review yesterday's changes
//   when: weekdays 09:00        what sets it off (when.js)
//   agent: reviewer             a preset or a program; default: the board's agent
//   model: haiku                its model, in place of the preset's (claude, codex, pi)
//   effort: low                 its effort, the same way
//   folder: api                 where it runs, from the root; default: the root
//   check: git log --oneline --since=yesterday    a shell command run first, in the
//                               folder: no agent starts unless it prints something (check.js)
//   card: true                  each run also adds a card to the board
//   keep: true                  its runs' tabs stay open when the agent finishes (the
//                               newest three); without it a finished run's tab closes
//   enabled: false              off: only Run now and herdr-ws-run start it
//   off: client-a, client-b     (a global one) the workspaces it's off in
//   ---
//   The prompt: the agent's task. {{event}} and the other {{…}} are filled in.
//
// One Runner runs them. With the background runner on (bin/herdr-ws-runner), that's
// a process herdr-core keeps going while Herdr is closed (runner/main.js); else the
// switcher's sidebar copy owns it and ticks it on its 500ms timer, while Herdr is open.
// A run is a tab in the workspace's "Automations" space (made the first time).
// A one-time schedule (`when: once …`) writes `enabled: false` in its file when
// its time comes, so it doesn't stay on.
// A check that prints nothing leaves one "quiet" entry in the runs, counted up
// while it repeats; one that fails leaves a "failed" one the same way. On a
// schedule, printing the same as at the last check is nothing new: quiet too.
// A check runs only once you've allowed that exact line: by saving it in the
// Automations screen, or with its Allow this check. One that arrives another way
// (herdr-ws-run --add --check, an edited file) is asked about as soon as it's
// seen, with a toast, and its automation doesn't start until then.
// Making a tab shows it, so the runner puts your view back straight after.
// A run whose agent finished its turn closes its tab a few seconds later (runfacts.js
// says when), and stays in the runs as closed, with what's needed to resume its
// conversation (History lists them). Unless `keep: true`: an agent that ends its turn
// with a question looks just like one that's finished.
//
// Published (shared), for the ws-automations screen:
//   workspaces.automations       { <workspace>: [automation, …] }, each with `next`:
//                                its own (scope "workspace"), then the global ones it
//                                doesn't replace (scope "global"; `enabled` is for
//                                that workspace, `everywhere` is the file's)
//   workspaces.automations.global  the global ones as their files have them
//   workspaces.automation.runs   the last 100 runs, newest first. A started one has `terminal`,
//                                `tab`, `space`, `folder`, `expects` (its agent reports), and
//                                once it does `up`, `app` and, when it's known, `conv`
//                                { provider, id }: its conversation; `closed` (when) and
//                                `closedWhy` once the runner closed its tab; `reports` when its
//                                agent was asked to end with an outcome line (OUTCOME_ASK), and once
//                                it closed, `outcome` and `summary` when its screen showed that line
//                                (notif.js outcomeOf; the bell leaves out "nothing to do")
// Asked for (shared), by the screen's Run now (the switcher passes it on):
//   workspaces.automation.run    { workspace, name, at }
// … and by its Create, Save and Allow this check (read here):
//   workspaces.automation.allow  { workspace, name, check, at }; workspace "*": a global one
// Outside calls (bin/herdr-ws-run) are files in ~/.herdr/workspaces/.inbox; with the
// background runner on, the switcher passes Run now and an allowed check on as files there too.
// GitHub automations ask GitHub with `gh api` every POLL, one call per repo.
// What it remembers (when each last ran, when it last ticked, the runs) is in
// ~/.herdr/runner/automations.json, the same file whichever of the two runs.
// Settings > Features' Automations (h.featureOn("automations")): off, nothing starts (fire()
// and launch() refuse; a manual start is noted as skipped), nothing that would set one off is
// gathered, checks don't run and GitHub isn't asked; a run already going finishes and closes
// as usual. On again it carries on from then (gate()): no catch-up, an `every` one waits its
// interval, GitHub's first look only notes what's there (featuregate.js).

import { spaces, agents, terminals, focused, run, shared, setShared, home, readTextFile, writeTextFile, watchFolder, exec, notify, knownAgents } from "herdr";
import * as fs from "fs/promises";
import { parseWhen, describe, due, nextAt, shortTime } from "./when.js";
import { withKnobs } from "./knobs.js";
import { runCheck } from "./check.js";
import { closeStep, helpersOf, lookingAt, providerOf } from "./runfacts.js";
import { OFF_NOTE, everyNext } from "./featuregate.js";
import { outcomeOf } from "./notif.js";

const SPACE = "Automations";
const MISSED = 12 * 3600e3; // a schedule missed (Herdr closed, the Mac asleep) runs once if it was due this recently
const LOOK_BACK = 31 * 86400e3; // older misses, up to this far back, are reported ("missed"), not run
const GAP = 50e3;           // an automatic run doesn't start within this of the same one's last start
const QUIET = 3000;         // files must be quiet this long before a files automation starts
const OLD_CALL = 3600e3;    // an outside call that waited longer than this (Herdr closed) is dropped

// The last line every run's agent is asked for: how it went, in a word History can read
// (ws-history/histfacts.js: reportOf). An agent that's waiting on an answer leaves it out.
const OUTCOME_ASK = "When you're done, end your last message with a line of its own saying how it went: `Outcome: done`, `Outcome: failed` or `Outcome: nothing to do`. Herdr shows it in History. If you need an answer from the person before you can finish, ask, and leave that line out.";
const withOutcome = (task) => (task ? `${task}\n\n${OUTCOME_ASK}` : task);
const KEEP_TABS = 3;        // each automation keeps its newest runs' tabs; older finished ones close
const KEEP_RUNS = 100;
const POLL = 120e3;         // how often GitHub automations look at their repos
const MAX_NEW = 10;         // new PRs and issues one look starts at most, per repo
const MAX_BODY = 4000;      // characters of a PR's or issue's description passed on
const STORE = "automations";
const STALL = 60e3;         // an agent that has reported nothing this long after its run started is taken to be asking something first
const ASK_AFTER = 5000;     // an unallowed check is asked about once it has stayed that way this long
// The first line of the launcher's note of which conversation terminal $1 holds, under
// the resume folder $2: in the folder of this core (its socket's name, as herdr-ws-resume
// finds it, else HC_SESSION), else the one core folder with a note for that terminal
// (the app's programs don't always get HC_SESSION).
const SESSION_NOTE = `t=$1 d=\${HERDR_WS_RESUME_DIR:-$2}
case "$t" in *[!0-9A-Za-z]*|"") exit 0 ;; esac
c=\${HC_TERMINAL_SOCKET##*/}; c=\${c%.sock}; [ -n "$c" ] || c=\${HC_SESSION:-default}
f=$d/$c/$t.session
if [ ! -f "$f" ]; then set -- "$d"/*/"$t.session"; [ $# -eq 1 ] && [ -f "$1" ] || exit 0; f=$1; fi
sed -n 1p "$f"`;
// Changes a files automation doesn't count: git's and dependency folders, dotfiles.
const IGNORED = /\/(\.git|node_modules)(\/|$)|\/\.[^/]*$/;

export const runnerDir = () => `${home()}/.herdr/runner`;
export const globalDir = () => `${home()}/.herdr/automations`;

// What a click on a toast about one automation does: the Automations screen, on that
// automation. The switcher's sidebar copy takes the command ("automation/<workspace>/<name>",
// "-" for one that's for every workspace; main.js) and opens the screen there. A workspace
// or a name that a command can't carry opens the screen as a toast about several does.
// `or` is for a desktop notification clicked while the sidebar is hidden: Herdr doesn't know
// the command then (the switcher isn't loaded), so the click opens the screen as it is.
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCREEN = { name: "mod.open", args: { name: "ws-automations" } };
export const openAt = (ws, a) => ((ws === "*" || PLAIN.test(ws)) && PLAIN.test(a.name)
  ? { name: `ws-switcher.automation/${ws === "*" ? "-" : ws}/${a.name}`, args: {}, or: SCREEN } : SCREEN);

// What a runner remembers: ~/.herdr/runner/<name>.json. Whichever runs (the
// switcher's copy or the background runner) reads it when it takes over. Before the
// file existed it was the switcher copy's localStorage, read once.
export class Store {
  constructor(name) {
    this.name = name;
    this.file = `${runnerDir()}/${name}.json`;
    this.old = null;
    this.turn = Promise.resolve();
  }
  async read() {
    this.old = await readTextFile(this.file).catch(() => null);
    try {
      if (this.old !== null) return JSON.parse(this.old);
      return typeof localStorage === "undefined" ? null : JSON.parse(localStorage.getItem(this.name) ?? "null");
    } catch { return null; }
  }
  // The newest value wins; writes take turns.
  write(value) {
    const text = JSON.stringify(value);
    this.next = text;
    this.turn = this.turn.then(async () => {
      if (this.next !== text || text === this.old) return;
      for (let i = 0; i < 2; i++) {
        try { await writeTextFile(this.file, text, this.old); this.old = text; return; }
        catch { this.old = await readTextFile(this.file).catch(() => null); } // changed under us
      }
    });
  }
}

export const wsDir = () => `${home()}/.herdr/workspaces`;
const tasksDir = (id) => `${wsDir()}/${id}/tasks`;
export const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
export const message = (e) => String(e?.message ?? e);
const pad = (n) => String(n).padStart(2, "0");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// fs reads only under home; a workspace can live anywhere, so the shell checks the rest.
export async function exists(path) {
  try { return await fs.exists(path); }
  catch { return (await exec("test", ["-e", path]).catch(() => ({ code: 1 }))).code === 0; }
}

// --- copies of ws-board's (mods can't import across folders): keep them in step ---

const COLUMNS = ["backlog", "todo", "doing", "review", "done"];
// Today's date where you are (toISOString would give UTC's).
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function expand(p) {
  const s = String(p ?? "").trim();
  if (!s) return "";
  const full = s === "~" ? home() : s.startsWith("~/") ? home() + s.slice(1) : s;
  return full.length > 1 ? full.replace(/\/+$/, "") : full;
}

export function boardOf(def) {
  const b = def?.board && typeof def.board === "object" ? def.board : {};
  const columns = (Array.isArray(b.columns) && b.columns.length ? b.columns : COLUMNS).map((c) => String(c).toLowerCase());
  const pick = (want, fallback) => (columns.includes(String(want ?? "").toLowerCase()) ? String(want).toLowerCase() : fallback);
  return {
    columns,
    prefix: String(b.prefix || (def?.id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "T").toUpperCase(),
    agent: String(b.agent || "claude"),
    start: pick(b.start ?? "doing", columns[Math.min(2, columns.length - 1)]),
    finish: pick(b.finish ?? "review", columns[columns.length - 1]),
  };
}

export function split(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { head: [], body: text };
  return { head: m[1] ? m[1].split(/\r?\n/) : [], body: text.slice(m[0].length) };
}

function unquote(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v.startsWith("'")) return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  const hash = v.search(/\s#/);
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

function quote(v) {
  const s = String(v);
  return /^[A-Za-z0-9_./~@(][^:#"'{}\[\]\n]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|null|yes|no|on|off|-?[0-9.]+)$/i.test(s)
    ? s : JSON.stringify(s);
}

export function field(head, key) {
  const line = head.find((l) => l.startsWith(`${key}:`));
  return line === undefined ? null : unquote(line.slice(key.length + 1));
}

export function withFields(text, fields, body) {
  const parts = split(text);
  const lines = [...parts.head];
  for (const [k, v] of Object.entries(fields)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (v === null || v === undefined || v === "") { if (i >= 0) lines.splice(i, 1); continue; }
    if (i >= 0) lines[i] = `${k}: ${quote(v)}`;
    else lines.push(`${k}: ${quote(v)}`);
  }
  const rest = body === undefined ? parts.body : `\n${body.trim()}\n`;
  return `---\n${lines.join("\n")}\n---\n${rest}`;
}

async function nextId(id, prefix) {
  let n = 0;
  try {
    for (const name of await fs.readdir(tasksDir(id))) {
      const m = new RegExp(`^${prefix}-(\\d+)\\.md$`, "i").exec(name);
      if (m) n = Math.max(n, Number(m[1]));
    }
  } catch {}
  return `${prefix}-${n + 1}`;
}

export function folderPath(def, folder) {
  if (!folder) return def.root;
  const e = expand(folder);
  return e.startsWith("/") ? e : `${def.root}/${e}`;
}

function brief(task, b) {
  return [
    `${task.id}: ${task.title}`,
    task.body,
    "---",
    `This task is tracked in ${tilde(task.file)}; its status is now "${b.start}". When you've finished, change its "status:" line to "${b.finish}" and, if anything is left open, add it under a "## Notes" heading at the end. Leave the other lines between the --- markers as they are.`,
    `If you open a pull request for it, add a line "pr: <its URL>" between the --- markers. Herdr then follows it and tells you here when a check fails, a review arrives or it conflicts, so end your turn instead of waiting on its checks.`,
  ].filter(Boolean).join("\n\n");
}

async function herdr(command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)], { timeout: 60000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if (!out || out.error) throw new Error(out?.error || r.stderr.trim() || `herdr-app do ${command} failed`);
  return out;
}

// --- automation and task files ---

const yes = (v) => /^(true|yes|on|1)$/i.test(String(v ?? "").trim());
const no = (v) => /^(false|no|off|0)$/i.test(String(v ?? "").trim());

export function parseAutomation(name, file, text, scope = "workspace") {
  const { head, body } = split(text.replace(/\r\n/g, "\n"));
  const when = field(head, "when") ?? "";
  const trigger = parseWhen(when);
  return {
    name, file, scope, description: field(head, "description") ?? "", when, trigger, summary: describe(trigger),
    agent: field(head, "agent") || null, model: field(head, "model") || null, effort: field(head, "effort") || null,
    folder: field(head, "folder") || null, check: field(head, "check") || null,
    card: yes(field(head, "card")), keep: yes(field(head, "keep")), enabled: !no(field(head, "enabled")),
    ...(scope === "global" ? { off: (field(head, "off") ?? "").split(",").map((w) => w.trim()).filter(Boolean) } : {}),
    body: body.replace(/<!--[\s\S]*?-->/g, "").trim(),
    error: trigger.kind === "error" ? trigger.error : null,
  };
}

async function loadAutomations(at, scope) {
  let names = [];
  try { names = (await fs.readdir(at)).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    const text = await readTextFile(`${at}/${n}`);
    if (text !== null) out.push(parseAutomation(n.slice(0, -3), `${at}/${n}`, text, scope));
  }
  return out;
}

// The workspace's tasks by file: what board automations compare.
async function loadTasks(id) {
  const out = {};
  let names = [];
  try { names = (await fs.readdir(tasksDir(id))).filter((n) => n.endsWith(".md") && !n.startsWith(".")); } catch { return out; }
  for (const n of names) {
    const file = `${tasksDir(id)}/${n}`;
    const text = await readTextFile(file);
    if (text === null) continue;
    const { head, body } = split(text);
    out[file] = {
      file, id: field(head, "id") || n.slice(0, -3), title: field(head, "title") || n.slice(0, -3),
      status: (field(head, "status") || "").toLowerCase(), automation: field(head, "automation"), body: body.trim(),
    };
  }
  return out;
}

// A github automation's repo: a workspace folder's GitHub remote (origin), else owner/name as written.
async function repoOf(def, spec) {
  const folder = def ? folderPath(def, spec) : null;
  if (folder && (await exists(folder))) {
    const r = await exec("git", ["-C", folder, "remote", "get-url", "origin"]).catch(() => null);
    const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(r?.stdout?.trim() ?? "");
    return m ? { repo: m[1], folder } : { error: `${spec} has no GitHub remote called origin.` };
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(spec)) return { repo: spec, folder: null };
  return { error: `There's no folder ${spec} in this workspace, and it isn't owner/name.` };
}

// `github * …`: every repo of the workspace with a GitHub remote, each once: its root's
// and its folders' (the `folders` list, else the root's subfolders), at the repo's top folder.
const repoFolders = (def) => (def ? [def.root, ...(def.folders.length ? def.folders : def.children.map((c) => `${def.root}/${c}`))].filter(Boolean) : []);
async function everyRepo(def) {
  const folders = repoFolders(def);
  const all = [];
  const r = folders.length ? await exec("sh", ["-c",
    'for f; do t=$(git -C "$f" rev-parse --show-toplevel 2>/dev/null) || continue; u=$(git -C "$t" remote get-url origin 2>/dev/null) || continue; printf "%s\\t%s\\n" "$t" "$u"; done',
    "sh", ...folders], { timeout: 60000 }).catch(() => null) : null;
  for (const line of (r?.stdout ?? "").split("\n")) {
    const [folder, url] = line.split("\t");
    const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url?.trim() ?? "");
    if (m && !all.some((x) => x.repo === m[1])) all.push({ repo: m[1], folder });
  }
  return { all, sig: JSON.stringify(folders) };
}
// The repos a github automation watches, from what load() found: [{ repo, folder }].
const watchedOf = (r) => r?.all ?? (r?.repo ? [r] : []);

// What a run gets about a new PR or issue: {{pr}} or {{issue}} (and {{event}}) is all of it.
function itemVars(repo, it) {
  const isPr = Boolean(it.pull_request);
  const labels = (it.labels ?? []).map((l) => l.name ?? l).join(", ");
  let body = String(it.body ?? "").trim();
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY)}\n… (cut here: the link has the rest)`;
  const block = [
    `${isPr ? "Pull request" : "Issue"} #${it.number} in ${repo}: ${it.title}`,
    `By ${it.user?.login ?? "someone"} · ${it.html_url}${labels ? ` · labels: ${labels}` : ""}`,
    body,
  ].filter(Boolean).join("\n");
  return { [isPr ? "pr" : "issue"]: block, number: String(it.number), title: it.title ?? "", url: it.html_url ?? "", author: it.user?.login ?? "", repo, labels, event: block };
}

const taskText = (t) => [`${t.id}: ${t.title}`, t.body, `The task file is ${tilde(t.file)}.`].filter(Boolean).join("\n\n");

// {{name}} from vars; unknown ones stay as written.
const fill = (text, vars) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, k) => (vars[k] ?? all));

export class Runner {
  // h: { presetsFor(workspace), presetLaunch(preset, task), withTask(argv, task), claim(space, workspace),
  //      featureOn(key): Settings > Features (missing: all on) }
  // The background runner also gives open(...), tidy(...) and close(run), its own ways to
  // start and close a run's tab without the window, away, what it calls the time it wasn't
  // running, and windowOpen(), whether Herdr's window is open (Herdr toasts for itself then).
  constructor(h) {
    this.h = h;
    this.list = {};             // workspace -> its automations: its own, then the global ones it doesn't replace
    this.globals = [];          // the global ones, as their files have them
    this.tasks = {};            // workspace -> { file: task }, where a board automation watches
    this.statuses = null;       // agent address -> status at the last tick
    this.minute = Math.floor(Date.now() / 60e3);
    this.files = {};            // "<workspace>/<name>" -> changed files waiting for quiet
    this.watching = new Set();  // folders being watched for files automations
    this.warnings = {};         // folder -> why it can't be watched
    this.starting = new Map();  // key -> starts waiting or under way
    this.queue = new Map();     // key -> the last of them
    this.recent = new Map();    // per task or agent: when it last set an automation off
    this.pending = [];          // missed schedules, started on the next tick
    this.polled = 0;
    this.repos = {};            // "<workspace>\t<repo as written>" -> { repo, folder } or { error }
    this.ghWarn = {};           // repo -> why gh couldn't read it
    this.ghPolled = 0;
    this.me = null;             // your GitHub login, for "by others"
    this.hold = 0;
    this.loaded = false;
    this.unasked = {};          // "<workspace>/<name>" -> a check nobody has allowed, and since when
    this.seen = new Map();      // run id -> what finished() saw of its agent (runfacts.js: closeStep)
    this.closing = new Set();   // run ids whose tab is being closed
    this.convAsked = new Set(); // run ids whose conversation has been looked up
    this.state = { last: {}, base: {}, seen: 0, runs: [], github: {}, printed: {}, allowed: {}, asked: {}, spaces: {} };
    this.store = new Store(STORE);
    this.restored = false;
    this.allowAsked = shared("workspaces.automation.allow")?.at;
    this.autoOn = undefined;    // Automations in Settings > Features, at the last look (gate())
    this.ghRebase = null;       // on again: the repos whose next GitHub look only notes what's there
  }

  automationsOn() { return this.h.featureOn ? this.h.featureOn("automations") !== false : true; }
  // Automations turned off or on (or found so at the first load): off, what waits to start
  // is dropped; on again after off (here, or in state.off since before a restart), it
  // carries on from now. { on, back }: back is true when it just came back on.
  gate(now) {
    const on = this.automationsOn();
    if (on === this.autoOn) return { on, back: false };
    const was = this.autoOn ?? (this.state.off ? false : undefined);
    this.autoOn = on;
    const back = on && was === false;
    if (!on) { this.pending = []; this.files = {}; }
    if (back) {
      this.state.resumed = now;
      this.ghRebase = "all";
      this.ghPolled = 0;
      this.files = {};
      this.minute = Math.floor(now / 60e3);
    }
    if (Boolean(this.state.off) !== !on) { this.state.off = !on; this.save(); }
    else if (back) this.save();
    return { on, back };
  }

  save() { if (this.restored) this.store.write(this.state); }
  // Its check may run: it has none, or you allowed the line as it's written now.
  // A global one's line is allowed once, for every workspace: "*/<name>".
  akey(ws, a) { return `${a.scope === "global" ? "*" : ws}/${a.name}`; }
  allowed(ws, a) { return !a.check || this.state.allowed[this.akey(ws, a)] === a.check; }
  // The screen's Create, Save and Allow this check: that line, for that automation.
  approvals() {
    const ask = shared("workspaces.automation.allow") ?? null;
    if (!ask || ask.at === this.allowAsked) return;
    this.allowAsked = ask.at;
    if (Date.now() - ask.at > 15000 || !ask.workspace || !ask.name || !ask.check) return;
    this.state.allowed[`${ask.workspace}/${ask.name}`] = String(ask.check);
    this.save();
    if (this.loaded) this.publish();
  }
  // While a run's tab is being made: the switcher doesn't follow the view then.
  holding() { return Date.now() < this.hold; }
  def(ws) { return (shared("workspaces.defs") ?? []).find((d) => d.id === ws && !d.error) ?? null; }
  find(ws, name) { return (this.list[ws] ?? []).find((a) => a.name === name) ?? null; }
  each(fn) {
    for (const [ws, autos] of Object.entries(this.list)) {
      if (this.def(ws)) for (const a of autos) if (a.enabled && !a.error) fn(ws, a);
    }
  }
  lastRun(ws, name) { return this.state.runs.find((r) => r.ws === ws && r.name === name && r.status === "started") ?? null; }
  // A run's agent is working or waiting on you. By terminal and tab: a terminal's
  // address can come back for another one later (after a restart, say); a tab's id can't.
  // Helpers it started that are still alive count as working: an orchestrator waits for them.
  busy(r) {
    const ag = r?.terminal ? agents().find((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab)) : null;
    if (ag && this.there(r) && helpersOf(r.terminal, terminals()).length) return true;
    return Boolean(ag ? ag.status === "working" || ag.status === "blocked" : r?.stuck && this.there(r));
  }
  // A run's terminal is still there.
  there(r) { return terminals().some((t) => t.address === r.terminal && t.state === "live"); }

  // A run whose agent has reported nothing a minute in is most likely stopped at a
  // question of its own, before its first message (Claude's "do you trust this
  // folder?"): nothing else would say it needs you. Said once, and shown as
  // "needs you" until the agent reports or its tab closes. Only for the agents
  // Herdr knows (`expects`): a script's run never reports.
  stalled(now) {
    const list = agents();
    let changed = false;
    // A changed run is a new object: what's published may be these same ones.
    const set = (r, patch) => { changed = true; return { ...r, ...patch }; };
    this.state.runs = this.state.runs.map((r) => {
      if (r.status !== "started" || !r.expects || !r.terminal || (r.up && !r.stuck)) return r;
      const up = list.some((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab));
      if (r.stuck) return up || !this.there(r) ? set(r, { stuck: undefined, up: true }) : r;
      // Reporting, gone, or too long ago to tell (the runner wasn't looking): not looked at again.
      if (up || now - r.at > 10 * STALL) return set(r, { up: true });
      if (now - r.at < STALL || !this.there(r)) return r;
      notify({
        title: `${r.name} is waiting in its terminal`, level: "warning",
        body: "Its agent hasn't started on its task, so it's probably asking something first. Claude asks whether to trust a folder it hasn't worked in.",
        ...(r.tab ? { action: { name: "tab.select", args: { id: r.tab } } } : {}),
      });
      return set(r, { stuck: true });
    });
    if (changed) { this.save(); this.publish(); }
  }

  // A run's record, changed: a new object, since what's published may be the old one.
  patch(id, fields) {
    this.state.runs = this.state.runs.map((x) => (x.id === id ? { ...x, ...fields } : x));
    this.save();
    this.publish();
  }

  // Runs whose agent finished its turn: their tab closes GRACE later, unless runfacts.js
  // (closeStep) says to wait. One whose agent starts waiting on you while Herdr's window
  // is closed says so (with the window open, Herdr's own toast does, the tab named after
  // the automation). Each run's agent and conversation are noted once it reports.
  finished(cx, now) {
    const list = agents(), terms = terminals(), view = focused();
    const judged = new Set();
    for (const r of this.state.runs) {
      if (r.status !== "started" || !r.expects || r.closed || !r.tab || !r.terminal) continue;
      judged.add(r.id);
      if (this.closing.has(r.id)) continue;
      const ag = this.there(r) ? list.find((x) => x.address === r.terminal && x.tab === r.tab) ?? null : null;
      if (ag?.app && r.app !== ag.app) this.patch(r.id, { app: ag.app });
      if (ag && !r.conv && !this.convAsked.has(r.id)) {
        this.convAsked.add(r.id);
        cx.spawn(async () => { const conv = await this.conversation(r.terminal, ag.app); if (conv) this.patch(r.id, { conv }); });
      }
      const step = closeStep({
        // A run with a board card stays like `keep`: the card's pull request is followed by
        // messages to its agent (prs.js), which a closed tab can't get.
        run: r, keep: Boolean(this.find(r.ws, r.name)?.keep || r.card), status: ag?.status ?? null,
        helpers: ag ? helpersOf(r.terminal, terms).length : 0, looking: lookingAt(view, r), seen: this.seen.get(r.id) ?? null, now,
      });
      if (step.seen) this.seen.set(r.id, step.seen); else this.seen.delete(r.id);
      if (step.needsYou && this.h.windowOpen && !this.h.windowOpen()) notify({
        title: `${r.name} needs you`, level: "warning",
        body: `Its agent is waiting for you, in ${this.def(r.ws)?.name ?? r.ws} › ${SPACE}.`,
        action: { name: "tab.select", args: { id: r.tab } },
      });
      if (step.close) this.closeRun(cx, r, ag?.app);
    }
    for (const id of this.seen.keys()) if (!judged.has(id)) this.seen.delete(id);
  }

  // Closes a finished run's tab (the background runner ends its terminal), after noting
  // its conversation (the launcher's note of it goes once the terminal is gone) and, for an
  // agent asked for an outcome line, that line and the one before it from its screen.
  closeRun(cx, r, app) {
    this.closing.add(r.id);
    cx.spawn(async () => {
      try {
        const conv = r.conv ?? (await this.conversation(r.terminal, app ?? r.app));
        // Only for the bell (Notifications off: not read).
        const report = r.reports && this.h.featureOn?.("notifications") !== false ? await this.report(r.terminal) : null;
        if (this.h.close) await this.h.close(r);
        else run("tab.close", { id: r.tab, confirmed: true });
        this.patch(r.id, {
          closed: Date.now(), closedWhy: "finished", ...(conv ? { conv } : {}),
          ...(report?.outcome ? { outcome: report.outcome } : {}), ...(report?.summary ? { summary: report.summary } : {}),
        });
      } finally {
        this.closing.delete(r.id);
        this.seen.delete(r.id);
      }
    });
  }

  // How a run's agent said it went, read off its screen (`hc read`): { outcome, summary }, or null
  // when that can't be read. Never in the way of closing the tab: 5s at most.
  async report(terminal) {
    if (!terminal) return null;
    try {
      const r = await exec("hc", ["read", String(terminal), "--lines", "60"], { timeout: 5000 });
      return r?.code === 0 ? outcomeOf(r.stdout) : null;
    } catch { return null; }
  }

  // The conversation a terminal's agent holds, from the launcher's note
  // (~/.herdr/resume/<core>/<terminal>.session, written by herdr-ws-resume --hook):
  // Claude's and Antigravity's. Null when it isn't noted (another agent, started without
  // the launcher, or resume notes off).
  async conversation(terminal, app) {
    const provider = providerOf(app);
    if (provider !== "claude" && provider !== "antigravity") return null;
    const r = await exec("sh", ["-c", SESSION_NOTE, "sh", terminal, `${home()}/.herdr/resume`]).catch(() => null);
    const id = String(r?.stdout ?? "").split("\n")[0].trim();
    return /^[0-9A-Za-z-]{6,}$/.test(id) ? { provider, id } : null;
  }

  // Every workspace's automations, read again (after the switcher's folder watch).
  async load(cx) {
    if (!this.restored) {
      this.state = { ...this.state, ...((await this.store.read()) ?? {}) };
      this.restored = true;
    }
    // Before the files: a save in the screen allows its check, then writes the file.
    this.approvals();
    const list = {};
    const globals = await loadAutomations(globalDir(), "global");
    for (const d of (shared("workspaces.defs") ?? []).filter((x) => !x.error)) {
      const own = await loadAutomations(`${d.dir}/automations`, "workspace");
      // A copy each: on here unless its file is off, or names this workspace in `off:`.
      const forAll = globals.filter((g) => !own.some((o) => o.name === g.name))
        .map((g) => ({ ...g, everywhere: g.enabled, enabled: g.enabled && !g.off.includes(d.id) }));
      list[d.id] = [...own, ...forAll];
    }
    this.globals = globals;
    const now = Date.now();
    for (const [ws, autos] of Object.entries(list)) {
      if (autos.some((a) => a.trigger.kind === "board")) this.tasks[ws] ??= await loadTasks(ws);
      else delete this.tasks[ws];
      for (const a of autos) if (a.trigger.kind === "every") this.state.base[`${ws}/${a.name}`] ??= now;
    }
    this.list = list;
    // Each github automation's repo; one that couldn't be found is looked for again.
    for (const k of Object.keys(this.repos)) if (this.repos[k].error) delete this.repos[k];
    const watched = new Set();
    for (const [ws, autos] of Object.entries(list)) {
      for (const a of autos) {
        if (a.trigger.kind !== "github") continue;
        const k = `${ws}\t${a.trigger.repo}`, def = this.def(ws);
        if (a.trigger.repo === "*") {
          // Looked for again when the workspace's folders change.
          if (this.repos[k]?.sig !== JSON.stringify(repoFolders(def))) this.repos[k] = await everyRepo(def);
        } else this.repos[k] ??= await repoOf(def, a.trigger.repo);
        if (a.enabled) for (const r of watchedOf(this.repos[k])) watched.add(r.repo);
      }
    }
    // A repo nothing watches forgets what it saw, so watching it again starts afresh.
    for (const repo of Object.keys(this.state.github)) if (!watched.has(repo)) delete this.state.github[repo];
    // What a check last printed goes with its automation, and with the check as it was written then.
    for (const k of Object.keys(this.state.printed)) {
      const i = k.indexOf("/");
      if (list[k.slice(0, i)]?.find((a) => a.name === k.slice(i + 1))?.check !== this.state.printed[k].cmd) delete this.state.printed[k];
    }
    // An allowed line, and having asked about one, go with their automation.
    for (const map of [this.state.allowed, this.state.asked]) {
      for (const k of Object.keys(map)) {
        const i = k.indexOf("/"), w = k.slice(0, i);
        const autos = w === "*" ? globals : list[w]?.filter((a) => a.scope !== "global");
        if (autos && !autos.some((a) => a.name === k.slice(i + 1) && a.check)) delete map[k];
      }
    }
    // A check nobody has allowed is asked about once, when it's first seen.
    for (const [ws, autos] of Object.entries(list)) {
      for (const a of autos) {
        const k = this.akey(ws, a);
        if (!a.check || this.state.allowed[k] === a.check || this.state.asked[k] === a.check) { delete this.unasked[k]; continue; }
        if (this.unasked[k]?.check !== a.check) this.unasked[k] = { check: a.check, at: now };
      }
    }
    for (const k of Object.keys(this.unasked)) {
      const i = k.indexOf("/"), w = k.slice(0, i);
      if (!(w === "*" ? globals : list[w])?.some((a) => a.name === k.slice(i + 1))) delete this.unasked[k];
    }
    // A workspace that's gone takes its runs and times with it (one with a broken
    // workspace.jsonc is still there).
    const there = new Set((shared("workspaces.defs") ?? []).map((d) => d.id));
    if (there.size) {
      this.state.runs = this.state.runs.filter((r) => there.has(r.ws));
      for (const map of [this.state.last, this.state.base, this.state.allowed, this.state.asked]) for (const k of Object.keys(map)) if (!k.startsWith("*/") && !there.has(k.split("/")[0])) delete map[k];
    }
    const gate = this.gate(now);
    // Off, or just back on: what came due meanwhile doesn't run late.
    if (!this.loaded) { this.loaded = true; if (gate.on && !gate.back) this.catchUp(this.state.seen || now, now, this.h.away ?? "while Herdr was closed"); }
    this.save();
    this.watchFiles(cx);
    this.publish();
  }

  // Schedules due from `from` up to this minute (at most MISSED back) that didn't
  // run, because Herdr was closed or its timer stopped while the Mac slept: each runs once.
  // One whose misses are all older than that doesn't run late: it's logged as
  // "missed" (how many times, and the last), and one toast lists them all.
  catchUp(from, now, reason) {
    const cutoff = now - MISSED;
    const older = Math.max(from, now - LOOK_BACK);
    const report = [];
    let one = null; // the automation the toast is about, when it's about one
    this.each((ws, a) => {
      if (a.trigger.kind !== "at" && a.trigger.kind !== "cron" && a.trigger.kind !== "once") return;
      const last = this.state.last[`${ws}/${a.name}`] ?? 0;
      let missed = null;
      for (let t = Math.floor(Math.max(from, cutoff) / 60e3) * 60e3; t < Math.floor(now / 60e3) * 60e3; t += 60e3) {
        if (t > last && due(a.trigger, new Date(t))) missed = t;
      }
      if (missed) { this.pending.push({ ws, name: a.name, why: `Missed ${shortTime(missed, now)} ${reason}` }); return; }
      if (older >= cutoff) return;
      // Due minutes from `older` up to the cutoff, after its last run.
      let count = 0, latest = null;
      for (let t = nextAt(a.trigger, Math.max(older, last) - 60e3); t !== null && t < cutoff && count < 50000; t = nextAt(a.trigger, t)) {
        if (t > last && t >= older) { count++; latest = t; }
      }
      if (!latest) return;
      const when = `${count > 1 ? `${count} times, last ` : ""}${shortTime(latest, now)}`;
      this.log({ ws, name: a.name, at: now, why: `Missed ${when} ${reason}`, status: "missed", note: "Over 12 hours ago, so it didn't run late. Run now runs it" });
      report.push(`${a.name} (${this.def(ws)?.name ?? ws}, ${when})`);
      one = report.length === 1 ? { ws, a } : null;
    });
    if (report.length) {
      notify({
        title: report.length === 1 ? "An automation didn't run" : `${report.length} automations didn't run`,
        body: `Missed over 12 hours ago ${reason}: ${report.join("; ")}. Run now in Automations runs one.`,
        level: "warning",
        action: one ? openAt(one.ws, one.a) : SCREEN,
      });
    }
  }

  next(ws, a, now) {
    if (!a.enabled || a.error) return null;
    if (a.trigger.kind === "every") {
      const k = `${ws}/${a.name}`;
      return everyNext(this.state.last[k] ?? this.state.base[k] ?? now, a.trigger.ms, this.state.resumed);
    }
    return nextAt(a.trigger, now);
  }

  // Its check failed the last time it was set off (and hasn't been changed since).
  checkFailing(ws, a) {
    const r = a.check ? this.state.runs.find((x) => x.ws === ws && x.name === a.name) : null;
    return r?.check && r.status === "failed" && r.cmd === a.check ? r : null;
  }

  warningOf(ws, a, def) {
    if (!this.allowed(ws, a)) return "Its check hasn't been allowed yet, so it doesn't start. Read the command, then allow it.";
    const failing = this.checkFailing(ws, a);
    if (failing) return `Its check failed ${shortTime(failing.at)}: ${failing.what} No agent starts until the check works. Try it under Details.`;
    if (a.trigger.kind === "once") return a.enabled && a.trigger.at < Date.now() - 60e3 ? "Its time has passed and it didn't run. Change the date, or use Run now." : null;
    if (a.trigger.kind === "files") return def ? this.warnings[folderPath(def, a.trigger.folder)] ?? null : null;
    if (a.trigger.kind !== "github") return null;
    const r = this.repos[`${ws}\t${a.trigger.repo}`];
    if (r?.all && !r.all.length) return !a.enabled ? null : "Nothing to watch here: no folder of this workspace has a GitHub remote.";
    return r?.error ?? watchedOf(r).map((x) => this.ghWarn[x.repo]).find(Boolean) ?? null;
  }

  publish() {
    const now = Date.now();
    const out = {};
    for (const [ws, autos] of Object.entries(this.list)) {
      const def = this.def(ws);
      out[ws] = autos.map((a) => ({
        ...a, next: this.next(ws, a, now), allowed: this.allowed(ws, a),
        warning: this.warningOf(ws, a, def),
      }));
    }
    if (JSON.stringify(out) !== JSON.stringify(shared("workspaces.automations") ?? null)) setShared("workspaces.automations", out);
    const globals = this.globals.map((a) => ({ ...a, allowed: this.allowed("*", a) }));
    if (JSON.stringify(globals) !== JSON.stringify(shared("workspaces.automations.global") ?? null)) setShared("workspaces.automations.global", globals);
    if (JSON.stringify(this.state.runs) !== JSON.stringify(shared("workspaces.automation.runs") ?? null)) setShared("workspaces.automation.runs", this.state.runs);
  }

  // A check nobody has allowed is asked about once, a few seconds after it's first
  // seen: the screen's own Save allows it, and that can arrive just after the file.
  ask(now) {
    for (const [k, u] of Object.entries(this.unasked)) {
      if (now - u.at < ASK_AFTER) continue;
      delete this.unasked[k];
      const i = k.indexOf("/"), ws = k.slice(0, i);
      const a = ws === "*" ? this.globals.find((g) => g.name === k.slice(i + 1)) : this.find(ws, k.slice(i + 1));
      if (!a || a.check !== u.check || this.allowed(ws, a) || this.state.asked[k] === a.check) continue;
      this.state.asked[k] = a.check;
      this.save();
      notify({
        title: `Allow ${a.name}'s check?`,
        body: `In ${ws === "*" ? "every workspace" : this.def(ws)?.name ?? ws}. Before each start, Herdr would run: ${a.check.length > 160 ? `${a.check.slice(0, 160)}…` : a.check}. It doesn't start until you allow that in Automations.`,
        level: "warning", action: openAt(ws, a),
      });
    }
  }

  // Every 500ms: from the switcher's timer, or the background runner's.
  tick(cx) {
    if (!this.loaded) return;
    this.approvals();
    const now = Date.now();
    // Automations off: the minutes still pass (so nothing is caught up later) and runs going
    // finish, but nothing starts and nothing is asked.
    const { on } = this.gate(now);
    if (on) this.ask(now);
    for (const p of this.pending.splice(0)) {
      const a = this.find(p.ws, p.name);
      if (a) this.fire(cx, p.ws, a, p.why);
    }
    const minute = Math.floor(now / 60e3);
    if (minute !== this.minute) {
      // Minutes skipped since the last tick (the Mac slept): their schedules run late, once.
      if (on && this.minute !== undefined && minute > this.minute + 1) this.catchUp((this.minute + 1) * 60e3, now, "while the Mac was asleep");
      this.minute = minute;
      const at = new Date(minute * 60e3);
      if (on) this.each((ws, a) => { if (due(a.trigger, at)) this.fire(cx, ws, a, `The ${shortTime(at.getTime(), now)} schedule`); });
      for (const [k, t] of this.recent) if (now - t > GAP) this.recent.delete(k);
      this.state.seen = now;
      this.save();
      this.publish();
    }
    if (on) this.each((ws, a) => { if (a.trigger.kind === "every" && now >= this.next(ws, a, now)) this.fire(cx, ws, a, a.summary); });
    this.watchAgents(cx);
    this.stalled(now);
    this.finished(cx, now);
    for (const [k, f] of Object.entries(this.files)) {
      if (now - f.at >= QUIET) { delete this.files[k]; this.filesFire(cx, f); }
    }
    if (now - this.polled >= 2000) { this.polled = now; this.inbox(cx); }
    if (on && now - this.ghPolled >= POLL) { this.ghPolled = now; this.github(cx); }
  }

  // What the switcher's folder watch saw change under ~/.herdr/workspaces.
  changed(paths, cx) {
    const root = wsDir();
    const all = paths.includes(root);
    if (all || paths.some((p) => p.startsWith(`${root}/.inbox/`))) this.inbox(cx);
    for (const ws of Object.keys(this.tasks)) {
      if (all || paths.some((p) => p === tasksDir(ws) || p.startsWith(`${tasksDir(ws)}/`))) this.boardCheck(ws, cx);
    }
  }

  // Starts an automation. how: { manual } (Run now, herdr-ws-run: even when it's
  // off or its last run is working), { key } (one run per task or agent).
  // Automations off: nothing starts; a manual start is noted as skipped.
  fire(cx, ws, a, why, vars = {}, how = {}) {
    const k = `${ws}/${a.name}`, key = how.key ? `${k}#${how.key}` : k, now = Date.now();
    if (!this.automationsOn()) {
      if (how.manual) this.log({ ws, name: a.name, at: now, why, status: "skipped", note: OFF_NOTE });
      return;
    }
    if (!how.manual) {
      if (this.starting.has(key)) return;
      if (now - ((how.key ? this.recent.get(key) : this.state.last[k]) ?? 0) < GAP) return;
      if (how.key) this.recent.set(key, now);
      this.state.last[k] = now;
      this.save();
      // A one-time one whose check waits for you stays on: it hasn't had its turn.
      if (a.trigger.kind === "once" && this.allowed(ws, a)) this.turnOff(cx, a);
      const prev = this.lastRun(ws, a.name);
      if (!how.key && this.busy(prev)) {
        this.log({ ws, name: a.name, at: now, why, status: "skipped", note: "Its last run was still working." });
        return;
      }
    }
    cx.spawn(async (cx) => { await this.start(ws, a, why, vars, key, how.folder, Boolean(how.manual)); cx.notify(); });
  }

  // A one-time schedule has had its turn: `enabled: false` in its file, which the
  // folder watch then reloads. Until then, the copy in the list is off already.
  turnOff(cx, a) {
    a.enabled = false;
    this.publish();
    cx.spawn(async () => {
      for (let i = 0; i < 3; i++) {
        const old = await readTextFile(a.file);
        if (old === null) return;
        const parts = split(old);
        const head = [...parts.head.filter((l) => !/^enabled\s*:/.test(l)), "enabled: false"];
        try { await writeTextFile(a.file, `---\n${head.join("\n")}\n---\n${parts.body}`, old); return; } catch {}
      }
    });
  }

  // Starts of one automation take turns, so a burst of calls all run, one after another.
  start(ws, a, why, vars, key, place, manual) {
    const at = Date.now();
    this.starting.set(key, (this.starting.get(key) ?? 0) + 1);
    const go = async () => {
      try { await this.launch(ws, a, why, vars, at, place, manual); }
      catch (e) {
        this.log({ ws, name: a.name, at, why, status: "failed", note: message(e) });
        notify({ title: `${a.name} didn't start`, body: message(e), level: "error" });
      }
      const left = (this.starting.get(key) ?? 1) - 1;
      if (left > 0) this.starting.set(key, left); else { this.starting.delete(key); this.queue.delete(key); }
    };
    const turn = (this.queue.get(key) ?? Promise.resolve()).then(go);
    this.queue.set(key, turn);
    return turn;
  }

  // place: where it runs when the automation names no folder (a github one's repo), else the root.
  // manual: started by hand or from outside, so it starts whatever its check says.
  async launch(ws, a, why, vars, at, place, manual) {
    // Turned off while it waited its turn: it doesn't start (nor its check).
    if (!this.automationsOn()) { this.log({ ws, name: a.name, at, why, status: "skipped", note: OFF_NOTE }); return; }
    const def = this.def(ws);
    if (!def) throw new Error("Its workspace is gone.");
    const b = boardOf(def);
    const name = a.agent || b.agent;
    const folder = a.folder ? folderPath(def, a.folder) : place ?? def.root;
    if (!(await exists(folder))) throw new Error(`${tilde(folder)} isn't there.`);
    const d = new Date(at);
    const all = {
      workspace: def.name, automation: a.name, folder: tilde(folder), event: why,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, ...vars,
    };
    if (a.check && !this.allowed(ws, a)) {
      const again = this.repeat(ws, a, at, why, "waiting", "", (row) => `Its check hasn't been allowed${row}, so it didn't start`);
      if (manual || a.trigger.kind === "once" || !again) notify({
        title: `${a.name} didn't start`, body: "Its check hasn't been allowed yet. Read it in Automations, then allow it.", level: "warning",
        action: openAt(ws, a),
      });
      return;
    }
    if (a.check) {
      const res = await runCheck(exec, a.check, folder, { ...all, folder, workspace_id: ws });
      // On a schedule, what it printed at the last check too isn't news. (What sets
      // off the other kinds is new each time.) Printing nothing in between forgets it.
      if (!res.error && (a.trigger.kind === "every" || a.trigger.kind === "at" || a.trigger.kind === "cron")) {
        const k = `${ws}/${a.name}`, was = this.state.printed[k];
        res.same = Boolean(res.out) && was?.cmd === a.check && was.out === res.out;
        this.state.printed[k] = { cmd: a.check, out: res.out };
        this.save();
      }
      if (!manual && !this.checked(ws, a, at, why, res)) return;
      all.check = res.out ?? "";
    }
    let prompt = fill(a.body, all);
    // What set it off goes at the end, unless the prompt uses one of its fill-ins.
    if (vars.event && !/\{\{\s*(event|text|task|task\.\w+|files?|agent|terminal|space|pr|issue|number|title|url|author|repo|labels)\s*\}\}/.test(a.body)) prompt = [prompt, vars.event].filter(Boolean).join("\n\n");
    // What the check printed goes last, unless the prompt says where with {{check}}.
    if (all.check && !/\{\{\s*check\s*\}\}/.test(a.body)) prompt = [prompt, `Before you were started, Herdr ran this automation's check (\`${a.check}\`). It printed:\n${all.check}`].filter(Boolean).join("\n\n");
    const card = a.card ? await this.card(def, b, a, name, prompt, at, vars) : null;
    const task = card ? brief(card, b) : prompt;
    const preset = this.h.presetsFor(ws).find((x) => x.name === name);
    let argv, first;
    const known = await knownAgents().catch(() => []);
    if (preset) ({ argv, task: first } = this.h.presetLaunch(preset, withOutcome(task)));
    else {
      argv = known.find((x) => x.key === name)?.run ?? [name];
      first = task;
    }
    // One of the agents Herdr knows, which report what they're doing (see stalled).
    const programs = new Set(known.flatMap((x) => [x.key, String(x.run?.[0] ?? "").split("/").pop()]));
    const expects = argv.slice(0, 8).some((w) => programs.has(String(w).split("/").pop()));
    // An agent is asked to end with its outcome line (History reads it); a script isn't.
    if (!preset && expects) first = withOutcome(first);
    const reports = Boolean(task) && (Boolean(preset) || expects);
    argv = withKnobs(argv, a.model, a.effort);
    const made = this.h.open ? await this.h.open(ws, a.name, folder, argv, first) : await this.open(ws, a.name, folder, argv, first);
    if (card) await this.updateCard(card.file, { terminal: made.terminal ?? null, tab: made.tab ?? null, started: today() });
    this.log({ ws, name: a.name, at, why, status: "started", terminal: made.terminal ?? null, tab: made.tab ?? null, space: made.space ?? null, folder, card: card?.id ?? null, ...(made.adopt ? { adopt: true } : {}), ...(expects ? { expects: true } : {}), ...(reports ? { reports: true } : {}) });
    this.tidy(ws, a.name);
    notify({
      title: `${a.name} started`, body: `${why}. In ${def.name} › ${SPACE}.`, level: "info",
      ...(made.tab ? { action: { name: "tab.select", args: { id: made.tab } } } : {}),
    });
  }

  // A tab in the workspace's Automations space (made the first time), then your view back.
  async open(ws, name, folder, argv, task) {
    ({ argv, task } = this.h.withTask(argv, task));
    const assigned = shared("workspaces.assigned") ?? {};
    const space = spaces().find((s) => assigned[s.id] === ws && !s.machine && s.named && s.name === SPACE);
    const view = focused();
    this.hold = Date.now() + 5000;
    let made = null;
    try {
      made = space
        ? await herdr("tab.new", { space: space.id, name, folder, argv, ...(task ? { task } : {}) })
        : await herdr("space.new", { name: SPACE, folder, tab: name, argv, ...(task ? { task } : {}) });
      if (!space && made.space) this.h.claim(made.space, ws);
    } finally {
      if (view?.space && made?.space && view.space !== made.space) run("space.select", { id: view.space });
      if (view?.tab && made?.tab && view.tab !== made.tab) run("tab.select", { id: view.tab });
      this.hold = Date.now() + 1500;
    }
    return made;
  }

  // The run's card: a new task in the board's start column, with the prompt as its notes.
  // Its title is the PR's or issue's for a github run, else the automation's with the time.
  async card(def, b, a, agent, prompt, at, vars = {}) {
    const d = new Date(at);
    const title = vars.number && vars.title ? `${vars.pr ? "PR" : "Issue"} #${vars.number}: ${String(vars.title).slice(0, 120)}`
      : `${a.description || a.name} (${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())})`;
    for (let i = 0; i < 5; i++) {
      const id = await nextId(def.id, b.prefix);
      const file = `${tasksDir(def.id)}/${id}.md`;
      const fields = { id, title, status: b.start, agent, folder: a.folder, automation: a.name, created: today() };
      try {
        await writeTextFile(file, withFields("---\n---\n", fields, prompt || title), null);
        return { id, title, file, body: prompt };
      } catch {} // that ID was just taken: the next one
    }
    throw new Error("Couldn't add its card to the board.");
  }

  async updateCard(file, fields) {
    for (let i = 0; i < 3; i++) {
      const old = await readTextFile(file);
      if (old === null) return;
      try { await writeTextFile(file, withFields(old, fields), old); return; } catch {}
    }
  }

  // Closes this automation's older run tabs whose agent isn't working or waiting on you.
  tidy(ws, name) {
    if (this.h.tidy) {
      this.h.tidy(this.state.runs.filter((r) => r.ws === ws && r.name === name && r.status === "started" && r.tab), KEEP_TABS, (r) => this.busy(r));
      return;
    }
    const live = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
    const runs = this.state.runs.filter((r) => r.ws === ws && r.name === name && r.status === "started" && r.tab && live.has(r.tab));
    for (const r of runs.slice(KEEP_TABS)) if (!this.busy(r)) run("tab.close", { id: r.tab, confirmed: true });
  }

  // What an automatic run's check said. True: it printed something (new), so the
  // run goes on. Nothing, nothing new, or a failure: no run, and one entry in the
  // runs that counts up while the same thing repeats. A failure is also said
  // once, as a toast.
  checked(ws, a, at, why, res) {
    if (res.out && !res.same) return true;
    const what = res.error ?? (res.same ? "same" : "");
    const again = this.repeat(ws, a, at, why, res.error ? "failed" : "quiet", what, (row) => (res.error ? `Its check failed${row}: ${what}`
      : `Its check printed ${res.same ? "the same as last time" : "nothing"}${row}, so no agent started`));
    const open = { action: openAt(ws, a) };
    if (res.error && !again) notify({ title: `${a.name}'s check failed`, body: `${what} No agent starts until the check works.`, level: "warning", ...open });
    // A one-time one won't be back: say that it came to nothing.
    if (!res.error && a.trigger.kind === "once") notify({ title: `${a.name} had nothing to do`, body: `${why}: its check printed nothing, so no agent started.`, level: "info", ...open });
    return false;
  }

  // An entry for a run its check kept from starting. The same thing again (status,
  // reason, line) replaces the last one, with its count one higher. True: again.
  repeat(ws, a, at, why, status, what, note) {
    const i = this.state.runs.findIndex((x) => x.ws === ws && x.name === a.name);
    const old = i >= 0 ? this.state.runs[i] : null;
    const again = Boolean(old?.check && old.status === status && old.what === what && old.cmd === a.check);
    if (again) this.state.runs.splice(i, 1);
    const times = again ? (old.times ?? 1) + 1 : 1;
    this.log({ ws, name: a.name, at, why, status, check: true, cmd: a.check, what, times, note: note(times > 1 ? `, ${times} times in a row` : "") });
    return again;
  }

  log(r) {
    this.state.runs = [{ id: `${r.at}-${Math.random().toString(36).slice(2, 7)}`, ...r }, ...this.state.runs].slice(0, KEEP_RUNS);
    this.save();
    this.publish();
  }

  // --- what sets them off ---

  // An agent in the workspace finished or needs you. Runs of automations don't count,
  // so an automation can't set itself (or another) off in a loop.
  watchAgents(cx) {
    const list = agents();
    const before = this.statuses;
    this.statuses = new Map(list.map((a) => [a.address, a.status]));
    if (!before) return;
    const assigned = shared("workspaces.assigned") ?? {};
    const ours = new Set(this.state.runs.filter((r) => r.terminal && r.tab).map((r) => `${r.terminal} ${r.tab}`));
    for (const ag of list) {
      const was = before.get(ag.address);
      if (!was || was === ag.status || ours.has(`${ag.address} ${ag.tab}`)) continue;
      // "done" turns "idle" once someone looks: either is finished.
      const finished = was === "working" && (ag.status === "done" || ag.status === "idle");
      const blocked = ag.status === "blocked";
      if (!finished && !blocked) continue;
      const ws = assigned[ag.space];
      if (!ws) continue;
      const who = ag.tab_name || ag.program?.name || "An agent";
      const what = blocked ? "needs you" : "finished";
      this.each((w, a) => {
        const t = a.trigger;
        if (w !== ws || t.kind !== "agent" || (t.status === "blocked") !== blocked) return;
        if (t.name && t.name.toLowerCase() !== String(ag.tab_name ?? "").toLowerCase()) return;
        this.fire(cx, ws, a, `${who} ${what}`, {
          agent: who, terminal: ag.address, space: ag.space_name,
          event: `${who} (in the “${ag.space_name}” space) ${what}. Its terminal is ${ag.address}: \`hc read ${ag.address}\` shows its screen.`,
        }, { key: ag.address });
      });
    }
  }

  // A task entered a column. A card an automation just made doesn't count (its
  // later moves do), so a card can't set off the automation that made it.
  boardCheck(ws, cx) {
    cx.spawn(async (cx) => {
      const before = this.tasks[ws];
      if (!before) return;
      const now = await loadTasks(ws);
      this.tasks[ws] = now;
      for (const [file, t] of Object.entries(now)) {
        const was = before[file];
        if (was ? was.status === t.status : t.automation) continue;
        this.each((w, a) => {
          if (w !== ws || a.trigger.kind !== "board" || a.trigger.column !== t.status) return;
          this.fire(cx, ws, a, `${t.id} entered ${t.status}`, {
            task: taskText(t), "task.id": t.id, "task.title": t.title, "task.file": tilde(t.file), event: taskText(t),
          }, { key: `${t.id}>${t.status}` });
        });
      }
    });
  }

  // One watch per folder that a files automation names.
  watchFiles(cx) {
    for (const folder of this.folders()) {
      if (this.watching.has(folder)) continue;
      this.watching.add(folder);
      delete this.warnings[folder];
      cx.spawn(async (cx) => {
        for (;;) {
          let paths;
          try { paths = await watchFolder(folder); }
          catch (e) {
            this.watching.delete(folder);
            this.warnings[folder] = `Can't watch ${tilde(folder)}: ${message(e)}`;
            this.publish();
            return;
          }
          if (!this.folders().has(folder)) { this.watching.delete(folder); return; }
          this.filesSeen(folder, paths);
        }
      });
    }
  }

  folders() {
    const out = new Set();
    this.each((ws, a) => { if (a.trigger.kind === "files") out.add(folderPath(this.def(ws), a.trigger.folder)); });
    return out;
  }

  // Changes gather until the folder is quiet. Changes made while the automation's
  // own run is working don't count: its agent writing there mustn't set it off again.
  filesSeen(folder, paths) {
    // Watched paths can come back as the real path (macOS's /tmp is /private/tmp): test them whole.
    const kept = paths.filter((p) => !IGNORED.test(p));
    if (!kept.length || this.autoOn === false) return; // changes made while Automations is off don't count
    const now = Date.now();
    this.each((ws, a) => {
      if (a.trigger.kind !== "files" || folderPath(this.def(ws), a.trigger.folder) !== folder) return;
      if (this.busy(this.lastRun(ws, a.name))) return;
      const f = (this.files[`${ws}/${a.name}`] ??= { ws, name: a.name, folder, paths: new Set(), at: now });
      for (const p of kept) f.paths.add(p);
      f.at = now;
    });
  }

  filesFire(cx, f) {
    const a = this.find(f.ws, f.name);
    if (!a?.enabled) return;
    cx.spawn(async (cx) => {
      const live = [];
      for (const p of f.paths) if (await exists(p)) live.push(p); // a deleted file isn't news
      if (!live.length) return;
      const shown = live.slice(0, 50).map(tilde);
      const list = shown.join("\n") + (live.length > 50 ? `\n… and ${live.length - 50} more` : "");
      this.fire(cx, f.ws, a, `${plural(live.length, "file")} changed in ${a.trigger.folder}`, {
        files: list, file: shown[0], event: `These changed in ${tilde(f.folder)}:\n${list}`,
      });
    });
  }

  // New PRs and issues: one `gh api` call per watched repo (GitHub's issues list has
  // both). The first look only notes the highest number there; after that, each
  // higher one is new. What's opened while Herdr is closed is picked up when it opens.
  github(cx) {
    if (this.ghBusy) return;
    const watch = new Map(); // repo -> [{ ws, a, folder }]
    this.each((ws, a) => {
      if (a.trigger.kind !== "github") return;
      for (const r of watchedOf(this.repos[`${ws}\t${a.trigger.repo}`])) {
        if (!watch.has(r.repo)) watch.set(r.repo, []);
        watch.get(r.repo).push({ ws, a, folder: r.folder });
      }
    });
    // Back on after off: this look only notes the newest number, as a first look does.
    if (this.ghRebase === "all") this.ghRebase = new Set(watch.keys());
    if (!watch.size) return;
    this.ghBusy = true;
    cx.spawn(async (cx) => {
      try {
        if (this.me === null) {
          const r = await exec("gh", ["api", "user", "--jq", ".login"], { timeout: 30000 }).catch(() => null);
          this.me = r?.code === 0 ? r.stdout.trim() : "";
        }
        for (const [repo, subs] of watch) {
          let r;
          try { r = await exec("gh", ["api", `repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=30`], { timeout: 60000 }); }
          catch (e) { r = { code: 1, stderr: /start|not found|ENOENT/i.test(message(e)) ? "gh isn't installed" : message(e) }; }
          let items = null;
          if (r.code === 0) { try { items = JSON.parse(r.stdout); } catch {} }
          if (!Array.isArray(items)) {
            this.ghWarn[repo] = `Can't read ${repo} with gh: ${String(r.stderr || r.stdout || "no answer").trim().split("\n")[0]}`;
            continue;
          }
          delete this.ghWarn[repo];
          const seen = this.ghRebase?.has(repo) ? undefined : this.state.github[repo];
          this.ghRebase?.delete(repo);
          this.state.github[repo] = Math.max(seen ?? 0, ...items.map((it) => it.number ?? 0));
          if (seen === undefined) continue;
          const fresh = items.filter((it) => it.number > seen).sort((x, y) => x.number - y.number).slice(-MAX_NEW);
          for (const it of fresh) {
            const isPr = Boolean(it.pull_request);
            for (const { ws, a, folder } of subs) {
              const t = a.trigger;
              if ((t.what === "pr") !== isPr) continue;
              if (t.others && this.me && it.user?.login === this.me) continue;
              if (t.label && !(it.labels ?? []).some((l) => String(l.name ?? l).toLowerCase() === t.label.toLowerCase())) continue;
              this.fire(cx, ws, a, `${isPr ? "PR" : "Issue"} #${it.number} opened in ${repo}`, itemVars(repo, it), { key: `${repo}#${it.number}`, folder });
            }
          }
        }
        this.save();
        this.publish();
      } finally {
        this.ghBusy = false;
      }
    });
  }

  // Calls from bin/herdr-ws-run: ~/.herdr/workspaces/.inbox/<stamp>.run, lines
  // workspace, automation, when (ms), then the text.
  inbox(cx) {
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const at = `${wsDir()}/.inbox`;
        let names = [];
        try { names = (await fs.readdir(at)).filter((n) => n.endsWith(".run") || n.endsWith(".allow")).sort(); } catch {}
        for (const n of names) {
          const path = `${at}/${n}`;
          const text = await readTextFile(path);
          await exec("rm", ["-f", path]).catch(() => {});
          if (text === null) continue;
          // The screen's Create, Save and Allow this check, passed on by the switcher
          // while the background runner runs: { workspace, name, check }.
          if (n.endsWith(".allow")) {
            let ask = null;
            try { ask = JSON.parse(text); } catch {}
            if (ask?.workspace && ask.name && ask.check) {
              this.state.allowed[`${ask.workspace}/${ask.name}`] = String(ask.check);
              this.save();
              this.publish();
            }
            continue;
          }
          const [ws = "", name = "", stamp = "", ...rest] = text.split("\n");
          // "<ms> hand": the screen's Run now, passed on the same way.
          const [when = "", mark = ""] = stamp.trim().split(/\s+/);
          const a = this.find(ws.trim(), name.trim());
          const body = rest.join("\n").trim();
          if (!a) {
            notify({ title: "herdr-ws-run: nothing to start", body: `There's no automation "${name.trim()}" in "${ws.trim()}".`, level: "warning" });
            continue;
          }
          const asked = Number(when) || Date.now();
          if (Date.now() - asked > OLD_CALL) {
            this.log({ ws: ws.trim(), name: a.name, at: Date.now(), why: "Called from outside", status: "skipped", note: `Called at ${shortTime(asked)}, while Herdr was closed.` });
            continue;
          }
          this.fire(cx, ws.trim(), a, mark === "hand" ? "Started by hand" : "Called from outside", body ? { text: body, event: body } : {}, { manual: true });
        }
      } finally {
        this.polling = false;
      }
    });
  }
}
