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
//   run: shell                  no agent: the body is a script, run in the folder (shell: bash,
//                               zsh or sh; terminal: true shows it in a tab, else it runs unseen
//                               and its output goes to ~/.herdr/runner/logs/<run>.log)
//   timeout: 15m                a run going longer is stopped (default 2m for a script, none for an agent)
//   notify: problems            what it tells you: problems, results, all or none (autofacts.js)
//   missed: skip                a schedule missed while nothing ran: run (within 12 hours), skip, always
//   dedupe: always              a schedule's check printing the same as last time still starts it
//   secret_env: STRIPE_KEY=stripe-test, DB_URL=staging-db   Vault secrets as variables (or a `|` block,
//                               one VAR=name a line): see "Secrets" below
//   ---
//   The prompt: the agent's task (or the script). {{event}} and the other {{…}} are filled in;
//   a script gets them as $HERDR_… variables instead, never in its text.
//   The front matter is read by autofacts.js, so `check: |` can span lines.
//
// One Runner runs them. With the background runner on (bin/herdr-ws-runner), that's
// a process herdr-core keeps going while Herdr is closed (runner/main.js); else the
// switcher's sidebar copy owns it and ticks it on its 500ms timer, while Herdr is open.
// A run is a tab in the workspace's "Automations" space (made the first time).
// A one-time schedule (`when: once …`) writes `enabled: false` in its file when
// its time comes, so it doesn't stay on.
// Automatic runs take turns: Settings > Automations' max-parallel agents at once (shell scripts
// four), the rest wait in order as "queued" runs; Run now never waits. A run past its timeout while
// its agent still works (or its script runs) is stopped and noted as failed. `when: automation done
// <name>` starts one after another finishes with its work done (not "nothing to do", nor an end that
// isn't known); `failed`: after it fails or times out. What it said is {{output}}; a loop of them is
// an error, and a chain stops five deep. `startup` runs once when the runner starts (not again within 5 minutes), `wake` when
// the Mac wakes from sleep.
// A check that prints nothing leaves one "quiet" entry in the runs, counted up
// while it repeats; one that fails leaves a "failed" one the same way. On a
// schedule, printing the same as at the last check is nothing new: quiet too.
// A check runs only once you've allowed that exact line: by saving it in the
// Automations screen, or with its Allow this check. One that arrives another way
// (herdr-ws-run --add --check, an edited file) is asked about as soon as it's
// seen, with a toast, and its automation doesn't start until then. A shell automation's
// script is allowed the same way, by its exact text (Allow this script).
// Making a tab shows it, so the runner puts your view back straight after.
// A run whose agent finished its turn closes its tab a few seconds later (runfacts.js
// says when), and stays in the runs as closed, with what's needed to resume its
// conversation (History lists them). Unless `keep: true`: an agent that ends its turn
// with a question looks just like one that's finished.
//
// Secrets (secret_env:): names of Vault secrets (meta.json: this workspace's, then every workspace's),
// handed to a shell automation's script and to any automation's check as variables by herdr-ws-secret,
// never to an agent's own process (whatever it holds can end up in its conversation). The runner never
// holds a value: a script and a check run as `herdr-ws-secret run --automation <ws>/<name> --env VAR=name
// … -- <shell> -c …` (check.js), whose output comes back redacted. An agent automation with secret_env
// needs a check (else that's its error), and a note under it says the agent can use secrets by name
// (`herdr-ws-secret http` / `run`); its report is still redacted by the CLI before it's kept. A name
// Vault doesn't have, or a pair that doesn't read (vaultfacts.js refuses names like PATH or BASH_ENV),
// is the automation's error; Vault off in Settings > Features, it doesn't run (skipped, with a note). A
// Protected secret works once the person allows that check or script in the broker's own macOS dialog.
// meta.json is looked at again every few seconds.
//
// Published (shared), for the ws-automations screen:
//   workspaces.automations       { <workspace>: [automation, …] }, each with `next`:
//                                its own (scope "workspace"), then the global ones it
//                                doesn't replace (scope "global"; `enabled` is for
//                                that workspace, `everywhere` is the file's)
//   workspaces.automations.global  the global ones as their files have them
//   workspaces.automation.runs   the runs, newest first (25 per automation, 500 in all). A started one has `terminal`,
//                                `tab`, `space`, `folder`, `expects` (its agent reports), and
//                                once it does `up`, `app` and, when it's known, `conv`
//                                { provider, id }: its conversation; `closed` (when) and
//                                `closedWhy` once the runner closed its tab; `reports` when its
//                                agent was asked to end with an outcome line (OUTCOME_ASK), and once
//                                it closed, `outcome` and `summary` when its screen showed that line
//                                (notif.js outcomeOf; the bell leaves out "nothing to do"). `notify`: the
//                                automation's level then. A shell run: `kind: "shell"`, `shell`, "running"
//                                while its script runs, then "started" and closed, with `exitCode`,
//                                `durationMs`, `timedOut`, `outcome`, `summary` and `logFile`. A run
//                                waiting for a slot is "queued"; one stopped by its timeout has `timedOut`
//                                and closedWhy "timed_out".
//                                Each automation also has `checkAllowed` and `scriptAllowed` (`allowed`: both).
// Asked for (shared), by the screen's Run now (the switcher passes it on):
//   workspaces.automation.run    { workspace, name, text?, at }
// … and by its Create, Save and Allow this check or script (read here):
//   workspaces.automation.allow  { workspace, name, check?, script?, at }; workspace "*": a global one
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

import { spaces, agents, terminals, focused, run, shared, setShared, home, appHome, readTextFile, writeTextFile, watchFolder, notify, knownAgents, window } from "herdr";
import { exec } from "./posix.js";
import * as fs from "fs/promises";
import { parseWhen, describe, due, nextAt, shortTime } from "./when.js";
import { withKnobs } from "./knobs.js";
import { runCheck, runShellScript, checkEnv, SCRIPT_MAX, secretArgv, toolFailure, secretProblem } from "./check.js";
import { closeStep, helpersOf, lookingAt, providerOf, isTimedOut, countActive, terminalOf } from "./runfacts.js";
import {
  splitFront, fieldValue, withFrontFields, normCheck, normScript, optionError, effectiveTimeout, effectiveNotify, shouldNotify, formatDuration,
  shellOf, findChainCycle, pruneRuns,
} from "./autofacts.js";
import { OFF_NOTE, everyNext } from "./featuregate.js";
import { outcomeOf } from "./notif.js";
import { parseSecretEnv, parseMeta, resolveEntry, isExpired } from "./vaultfacts.js";

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
const SHELL_CAP = 4;        // shell scripts running at once (agents: Settings > Automations' max-parallel)
const STARTUP_GAP = 5 * 60e3; // `startup` automations don't run again within this (a reload of the mod)
const CHAIN_MAX = 5;        // a chain of automations setting each other off stops this deep
const OUTPUT_MAX = 4000;    // characters of a run's output passed on as {{output}}
// A script in a tab: run, say how it ended, then end (or stay, with keep: true). $1 the shell, $2 the script.
// The line it ends with is one a script wouldn't print itself (an "[exit 1]" of its own isn't its end).
// $4…: herdr-ws-secret's words in front of the shell, when it has secrets (check.js secretArgv).
const SHELL_TAB = 'b=$1; s=$2; k=$3; shift 3; "$@" "$b" -c "$s"; c=$?; printf "\\n[herdr-exit:%s]\\n" "$c"; if [ -n "$k" ]; then exec "${SHELL:-/bin/sh}" -i; fi; exit "$c"';
const EXIT_LINE = /^\[herdr-exit:(\d+)\]$/;
const YOUNG = 30e3;         // a run's terminal not listed this soon after it started is still being made
const POLL = 120e3;         // how often GitHub automations look at their repos
const MAX_NEW = 10;         // new PRs and issues one look starts at most, per repo
const MAX_BODY = 4000;      // characters of a PR's or issue's description passed on
const STORE = "automations";
const STALL = 60e3;         // an agent that has reported nothing this long after its run started is taken to be asking something first
const ASK_AFTER = 5000;     // an unallowed check is asked about once it has stayed that way this long
const VAULT_LOOK = 5000;    // how often meta.json is looked at again, while an automation uses secrets
const TAB_SECRET_MAX = 600e3; // herdr-ws-secret runs a command 10 minutes at most: a script in a tab with no timeout gets that
export const AGENT_NO_CHECK = "secret_env reaches a check or a script, never the agent itself, and this has no check. The agent can use a secret by name instead (herdr-ws-secret http or run: say which in its prompt), or make this a shell automation.";
export const AGENT_SECRETS_NOTE = "Its check gets these secrets as variables. The agent itself isn't handed them: it can use them by name (herdr-ws-secret http or run).";
export const VAULT_OFF_NOTE = "Secrets is off in Settings > Features, and it uses secrets (secret_env), so it didn't run.";
// The first line of the launcher's note of which conversation terminal $1 holds, under
// the resume folder $2: in the folder of this core (its socket's name, as herdr-ws-resume
// finds it, else HC_SESSION), else the one core folder with a note for that terminal
// (the app's programs don't always get HC_SESSION).
const SESSION_NOTE = `t=$1 d=\${HERDR_WS_RESUME_DIR:-$2}
case "$t" in *[!0-9A-Za-z]*|"") exit 0 ;; esac
c=\${HC_TERMINAL_SOCKET##*[/\\\\]}; c=\${c%.sock}; case "$HC_TERMINAL_SOCKET" in '\\\\.\\pipe\\'*) c=\${c#herdr-core-*-} ;; esac; [ -n "$c" ] || c=\${HC_SESSION:-default}
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
  const { entries, body } = splitFront(text);
  const get = (k) => fieldValue(entries, k);
  const low = (k) => (get(k) ?? "").trim().toLowerCase() || null;
  const when = get("when") ?? "";
  const trigger = parseWhen(when);
  const mode = low("run") ?? "agent";
  const a = {
    name, file, scope, description: get("description") ?? "", when, trigger, summary: describe(trigger),
    agent: get("agent") || null, model: get("model") || null, effort: get("effort") || null,
    folder: get("folder") || null, check: normCheck(get("check")) || null,
    card: yes(get("card")), keep: yes(get("keep")), enabled: !no(get("enabled")),
    ...(scope === "global" ? { off: (get("off") ?? "").split(",").map((w) => w.trim()).filter(Boolean) } : {}),
    run: mode, shell: mode === "shell" ? low("shell") ?? "bash" : null, terminal: mode === "shell" && yes(get("terminal")),
    timeout: get("timeout")?.trim() || null, notify: low("notify"), missed: low("missed") ?? "run", dedupe: low("dedupe") ?? "changed",
    body: normScript(body),
    error: trigger.kind === "error" ? trigger.error : null,
  };
  // A value the runner can't follow is the automation's error, as a `when:` it can't read is.
  a.error ??= ["run", "shell", "timeout", "notify", "missed", "dedupe"].map((k) => optionError(k, get(k))).find(Boolean) ?? null;
  // secret_env: VAR=name pairs (vaultfacts.js); whether Vault has each name is the Runner's to say (vaultIssue).
  const secrets = parseSecretEnv(get("secret_env") ?? "");
  a.secretEnv = secrets.pairs;
  a.error ??= secrets.errors.length ? `secret_env: ${secrets.errors[0]}.` : null;
  // An agent is never handed secrets: on an agent automation they're for its check, so it needs one.
  if (!a.error && mode !== "shell" && a.secretEnv.length && !a.check) a.error = AGENT_NO_CHECK;
  if (!a.error && mode === "shell" && !a.body) a.error = "A shell automation runs its script: put it under the front matter.";
  if (!a.error && mode === "shell" && a.card) a.error = "A shell automation has no agent to give a card to: take out card: true.";
  a.timeoutMs = effectiveTimeout(a);
  a.notifyLevel = effectiveNotify(a);
  return a;
}

// Automations that wait on each other in a loop (`when: automation done <name>`) get it as their error.
function chainErrors(autos) {
  for (const a of autos) {
    if (a.error || a.trigger.kind !== "chain") continue;
    const loop = findChainCycle(autos, a.name);
    if (loop) a.error = `A loop: ${loop.join(" → ")}. Each would start the next for ever, so none of them runs.`;
  }
  return autos;
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

// The first line with text of what a script printed, at most 140 characters.
const firstOf = (text) => { const l = String(text ?? "").split("\n").map((x) => x.trim()).find(Boolean) ?? ""; return l.length > 140 ? `${l.slice(0, 139)}…` : l; };

// {{name}} from vars; unknown ones stay as written.
const fill = (text, vars) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, k) => (vars[k] ?? all));

export class Runner {
  // h: { presetsFor(workspace), presetLaunch(preset, task), withTask(argv, task), claim(space, workspace),
  //      featureOn(key): Settings > Features (missing: all on),
  //      automationSetting(key): Settings > Automations (settingsfacts.js; missing: the defaults),
  //      startWhy: what a `startup` run says set it off }
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
    this.unaskedScripts = {};   // … a shell automation's script nobody has allowed, the same way
    this.waitQueue = [];        // automatic runs waiting for a parallel slot, oldest first
    this.launching = { agent: 0, shell: 0 }; // runs between taking a slot and being in the runs
    this.ghBranch = {};         // repo -> its default branch, for `ci failed`
    this.cx = null;             // the last cx it was given: for chains set off when a run ends
    this.seen = new Map();      // run id -> what finished() saw of its agent (runfacts.js: closeStep)
    this.closing = new Set();   // run ids whose tab is being closed
    this.convAsked = new Set(); // run ids whose conversation has been looked up
    this.state = {
      last: {}, base: {}, seen: 0, runs: [], github: {}, printed: {}, allowed: {}, asked: {}, spaces: {},
      allowedScripts: {}, askedScripts: {}, githubReview: {}, githubMerged: {}, githubCi: {}, githubLabeled: {},
    };
    this.store = new Store(STORE);
    this.restored = false;
    this.allowAsked = shared("workspaces.automation.allow")?.at;
    this.autoOn = undefined;    // Automations in Settings > Features, at the last look (gate())
    this.ghRebase = null;       // on again: the repos whose next GitHub look only notes what's there
    this.vault = { text: undefined, entries: [], error: null }; // meta.json as last read (names and policies, never values)
    this.vaultLooked = 0;
  }

  automationsOn() { return this.h.featureOn ? this.h.featureOn("automations") !== false : true; }
  vaultOn() { return this.h.featureOn ? this.h.featureOn("vault") !== false : true; }

  // --- Vault: what secret_env names, as meta.json has it ---

  vaultDir() { return this.h.vaultDir?.() ?? `${home()}/.herdr/vault`; }
  secretCli() { return this.h.secretCli?.() ?? `${appHome()}/mods/ws-switcher/bin/herdr-ws-secret`; }
  async readVault() {
    const text = await readTextFile(`${this.vaultDir()}/meta.json`).catch(() => null);
    const m = parseMeta(text);
    this.vault = { text, entries: m.entries, error: m.error };
  }
  usesSecrets() { return Object.values(this.list).some((autos) => autos.some((a) => a.secretEnv?.length)); }
  // What Vault says about an automation's secrets in a workspace: { error, warning } or null. error: a
  // name it doesn't have there, a Protected one for an agent, a meta.json it can't read; warning: a
  // Protected one (macOS asks), an expired one.
  vaultIssue(ws, a) {
    if (!a.secretEnv?.length) return null;
    if (this.vault.error) return { error: `secret_env: Secrets' list can't be read (${this.vault.error}).`, warning: null };
    const wsId = ws === "*" ? null : ws;
    const errors = [], notes = [], now = Date.now();
    for (const p of a.secretEnv) {
      const e = resolveEntry(this.vault.entries, wsId, p.name);
      if (!e) { errors.push(`secret_env: Secrets has no secret ${p.name} for ${wsId ? "this workspace" : "every workspace"}. Add it in Secrets, or fix the name.`); continue; }
      if (e.tier === "protected") {
        // The broker asks once for each command it runs: a shell automation's check and script are two.
        notes.push(a.run !== "shell"
          ? `Uses the Protected secret ${p.name}: macOS asks you once when its check first runs, and again when the check changes.`
          : a.check
          ? `Uses the Protected secret ${p.name}: macOS asks you once for its check and once for its script when each first runs, and again when either changes.`
          : `Uses the Protected secret ${p.name}: macOS asks you once when it first runs, and again when the script changes.`);
      }
      if (isExpired(e, now)) notes.push(`${p.name} has expired: replace it in Secrets, or its runs fail.`);
    }
    if (a.run !== "shell") notes.unshift(AGENT_SECRETS_NOTE);
    return { error: errors[0] ?? null, warning: notes.join(" ") || null };
  }
  // Each automation's error from Vault, as meta.json says now (one from before goes first).
  applyVault(ws, autos) {
    for (const a of autos) {
      if (a.vaultError) { a.error = null; a.vaultError = false; }
      const v = this.vaultIssue(ws, a);
      if (!a.error && v?.error) { a.error = v.error; a.vaultError = true; }
    }
    return autos;
  }
  // meta.json changed (a secret added, removed, made Protected): the errors again.
  lookAtVault(cx, now) {
    if (this.vaultLooking || now - this.vaultLooked < VAULT_LOOK || !this.usesSecrets()) return;
    this.vaultLooked = now;
    this.vaultLooking = true;
    cx.spawn(async () => {
      try {
        const was = this.vault.text;
        await this.readVault();
        if (this.vault.text === was) return;
        for (const [ws, autos] of Object.entries(this.list)) chainErrors(this.applyVault(ws, autos));
        this.publish();
      } finally { this.vaultLooking = false; }
    });
  }
  // How a run's command gets its secrets (check.js): null without any.
  secretFor(ws, a) {
    return a.secretEnv?.length ? { cli: this.secretCli(), pairs: a.secretEnv, workspace: ws, automation: `${ws}/${a.name}` } : null;
  }
  // What keeps an automation with secrets from running now: Vault off, or what vaultIssue calls an
  // error. { status, note } or null.
  vaultBlock(ws, a) {
    // A secret_env that doesn't read, or one on an agent with no check: Run now doesn't start it either.
    if (a.error && (a.error === AGENT_NO_CHECK || a.error.startsWith("secret_env:"))) return { status: "failed", note: a.error };
    if (!a.secretEnv?.length) return null;
    if (!this.vaultOn()) return { status: "skipped", note: VAULT_OFF_NOTE };
    const v = this.vaultIssue(ws, a);
    return v?.error ? { status: "failed", note: v.error } : null;
  }
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
  checkAllowed(ws, a) { return !a.check || this.state.allowed[this.akey(ws, a)] === a.check; }
  // Its script may run: it isn't a shell automation, or you allowed the script as it's written now.
  allowedScript(ws, a) { return a.run !== "shell" || this.state.allowedScripts[this.akey(ws, a)] === a.body; }
  allowed(ws, a) { return this.checkAllowed(ws, a) && this.allowedScript(ws, a); }
  // An allow from the screen (Create, Save, Allow this check or script) or the inbox:
  // { workspace, name, check?, script? }, each the text as it's written now. True when it took one.
  allow(ask) {
    if (!ask?.workspace || !ask.name) return false;
    const k = `${ask.workspace}/${ask.name}`;
    let took = false;
    if (typeof ask.check === "string" && normCheck(ask.check)) { this.state.allowed[k] = normCheck(ask.check); took = true; }
    if (typeof ask.script === "string" && normScript(ask.script)) { this.state.allowedScripts[k] = normScript(ask.script); took = true; }
    return took;
  }
  // The screen's Create, Save and Allow this check: that line, for that automation.
  approvals() {
    const ask = shared("workspaces.automation.allow") ?? null;
    if (!ask || ask.at === this.allowAsked) return;
    this.allowAsked = ask.at;
    if (Date.now() - ask.at > 15000 || !this.allow(ask)) return;
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
  lastRun(ws, name) { return this.state.runs.find((r) => r.ws === ws && r.name === name && (r.status === "started" || r.status === "running")) ?? null; }
  // A run's agent is working or waiting on you. By terminal and tab: a terminal's
  // address can come back for another one later (after a restart, say); a tab's id can't.
  // Helpers it started that are still alive count as working: an orchestrator waits for them.
  busy(r) {
    if (r?.status === "running") return true; // a shell script still running
    if (r?.kind === "shell") return Boolean(r.terminal && !r.closed && this.there(r));
    const ag = r?.terminal ? agents().find((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab)) : null;
    if (ag && this.there(r) && helpersOf(r.terminal, terminals()).length) return true;
    return Boolean(ag ? ag.status === "working" || ag.status === "blocked" : r?.stuck && this.there(r));
  }
  // A run's terminal is still there.
  there(r) { return terminals().some((t) => t.address === r.terminal && t.state === "live"); }
  // The run's own terminal as herdr-core lists it now (live, or ended and kept): at its address and,
  // when the run has a tab, labelled with that tab. Null when there's none: closed, or its address is
  // another terminal's now (after a restart). Nothing is read or ended at an address without this.
  ownTerminal(r, terms = terminals()) { return terminalOf(r, terms); }
  // … and it's still running.
  liveTab(r, terms) { return this.ownTerminal(r, terms)?.state === "live"; }
  // Some automation here waits on this one (`when: automation done|failed <name>`).
  hasFollowers(ws, name) { return (this.list[ws] ?? []).some((a) => a.enabled && !a.error && a.trigger.kind === "chain" && a.trigger.target === name); }

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
    this.state.runs = this.prune(this.state.runs.map((x) => (x.id === id ? { ...x, ...fields } : x)));
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
      // Its agent's first finished turn is noted (`turnDone`): its timeout was for that turn, not for
      // what you ask it after. A run that keeps its tab never closes: the automations waiting on it
      // start then, with what its agent said (read off its screen: how it went decides which start).
      if (!r.turnDone && step.seen?.worked && step.seen.since === now && (ag?.status === "done" || ag?.status === "idle")) {
        const a = this.find(r.ws, r.name);
        const kept = Boolean(a?.keep || r.card) && !r.chained;
        this.patch(r.id, { turnDone: now, ...(kept ? { chained: true } : {}) });
        if (kept && this.hasFollowers(r.ws, r.name)) {
          cx.spawn(async () => {
            const report = r.reports ? await this.report(r.terminal, r) : null;
            // Asked for its outcome line and didn't give one (it asked you something, say): not known, nothing starts.
            const outcome = report?.outcome ?? (r.reports ? null : "done");
            if (outcome === "done" || outcome === "failed") {
              this.triggerChains(r.ws, r.name, outcome, { output: report?.summary ?? r.summary ?? "", chainDepth: r.chainDepth ?? 0, runId: r.id });
            }
          });
        }
      }
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
  // why: "finished", or "timed_out" (with what to note in `extra`: outcome, timedOut, summary).
  // Then the automations waiting on it start.
  closeRun(cx, r, app, why = "finished", extra = {}) {
    this.closing.add(r.id);
    cx.spawn(async () => {
      try {
        const conv = r.conv ?? (await this.conversation(r.terminal, app ?? r.app));
        // For the bell, and for the automations waiting on this one (with Notifications off, only for them).
        const report = r.reports && why === "finished" && (this.h.featureOn?.("notifications") !== false || this.hasFollowers(r.ws, r.name)) ? await this.report(r.terminal, r) : null;
        if (this.h.close) await this.h.close(r);
        else run("tab.close", { id: r.tab, confirmed: true });
        const fields = {
          closed: Date.now(), closedWhy: why, ...(conv ? { conv } : {}),
          ...(report?.outcome ? { outcome: report.outcome } : {}), ...(report?.summary ? { summary: report.summary } : {}), ...extra,
        };
        this.patch(r.id, fields);
        const a = this.find(r.ws, r.name);
        // An agent asked for its outcome line that gave none: how it went isn't known. One not asked: done.
        const outcome = fields.outcome ?? (r.reports ? null : "done");
        if (a && !r.chained) this.ended(r.ws, a, { id: r.id, outcome, timedOut: fields.timedOut === true, summary: fields.summary ?? "", output: fields.summary ?? "", chainDepth: r.chainDepth ?? 0, toast: false });
      } finally {
        this.closing.delete(r.id);
        this.seen.delete(r.id);
      }
    });
  }

  // Agent runs going longer than their automation's timeout while their agent still works on its
  // task (or hasn't said yet): their tab closes and they're noted as failed, timed out (the bell pins
  // it; `automation failed <name>` ones start). Not one that finished its turn (a kept or a card's run,
  // what you ask it after included) or waits on you. One whose tab is gone (closed by hand, or its
  // address another terminal's now) has nothing to stop: it's noted closed, quietly, and nothing is ended.
  timeouts(cx, now) {
    let terms = null, list = null;
    for (const r of this.state.runs) {
      if (r.status !== "started" || r.closed || r.kind === "shell" || r.turnDone || this.closing.has(r.id)) continue;
      if (!(this.h.close ? r.terminal : r.tab)) continue;
      const a = this.find(r.ws, r.name);
      const ms = a ? effectiveTimeout(a) : 0;
      if (!isTimedOut(r, ms, now)) continue;
      terms ??= terminals();
      list ??= agents();
      if (!this.liveTab(r, terms)) {
        this.patch(r.id, { closed: now, closedWhy: "gone" });
        this.seen.delete(r.id);
        continue;
      }
      const ag = list.find((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab));
      if (ag && ag.status !== "working") continue;
      const summary = `Stopped after ${formatDuration(ms)} timeout.`;
      this.closeRun(cx, r, r.app, "timed_out", { outcome: "failed", timedOut: true, summary });
      if (shouldNotify(effectiveNotify(a), "problem")) notify({
        title: `${a.name} timed out`, body: `${summary} Its agent was still going in ${this.def(r.ws)?.name ?? r.ws} › ${SPACE}.`, level: "warning", action: openAt(r.ws, a),
      });
    }
  }

  // Shell runs shown in a tab (terminal: true): every 2s, a look at its screen for the
  // "[herdr-exit:N]" line SHELL_TAB prints. Ended: noted, its tab closed (unless keep: true), and the
  // ones waiting on it start. Past its timeout: closed and noted as timed out. Only at its own
  // terminal (ownTerminal): one that's gone, or whose address is another terminal's now (after a
  // herdr-core restart), is never read or ended (nor herdr-core started for it, under Start at login):
  // it's noted closed, how it ended unknown, and nothing waiting on it starts.
  shellTabs(cx, now) {
    if (now - (this.tabsLooked ?? 0) < 2000) return;
    this.tabsLooked = now;
    const terms = terminals();
    for (const r of this.state.runs) {
      if (r.kind !== "shell" || r.status !== "started" || r.closed || !r.terminal || this.closing.has(r.id)) continue;
      const a = this.find(r.ws, r.name);
      const ms = a ? effectiveTimeout(a) : 0;
      const own = this.ownTerminal(r, terms);
      if (!own) {
        if (now - (r.at ?? 0) < YOUNG) continue; // just made: not listed yet
        this.patch(r.id, { closed: now, finishedAt: now, durationMs: now - r.at, exitCode: null, timedOut: false, outcome: null, summary: "Its tab closed before it said how it ended.", closedWhy: "gone" });
        continue;
      }
      const live = own.state === "live";
      this.closing.add(r.id);
      cx.spawn(async () => {
        try {
          // Read even once it has ended: a terminal that's kept after its program exits still has its screen.
          const screen = await exec("hc", ["read", String(r.terminal), "--lines", "200"], { timeout: 5000 }).catch(() => null);
          const rows = String(screen?.code === 0 ? screen.stdout : "").replace(/\r/g, "").split("\n");
          let at = -1;
          for (let i = rows.length - 1; i >= 0; i--) if (EXIT_LINE.test(rows[i].trim())) { at = i; break; }
          const timedOut = at < 0 && live && isTimedOut(r, ms, Date.now());
          if (at < 0 && live && !timedOut) return;
          const code = at >= 0 ? Number(EXIT_LINE.exec(rows[at].trim())[1]) : null;
          const said = rows.slice(0, Math.max(0, at)).join("\n");
          // herdr-ws-secret refused before the script started (exit 125 and its line): why, in plain words.
          const fail = r.secrets?.length ? toolFailure(code, said) : null;
          const summary = fail ? secretProblem(fail, { names: r.secrets, automation: `${r.ws}/${r.name}` })
            : timedOut ? `Stopped after ${formatDuration(ms)} timeout.` : code === null ? "Its tab closed before it said how it ended." : firstOf(said) || null;
          if (timedOut || !a?.keep) {
            if (this.h.close) await this.h.close(r);
            else if (r.tab) run("tab.close", { id: r.tab, confirmed: true });
          }
          const outcome = timedOut || (code !== null && code !== 0) ? "failed" : code === null ? null : said.trim() ? "done" : "nothing to do";
          const end = Date.now();
          this.patch(r.id, { closed: end, finishedAt: end, durationMs: end - r.at, exitCode: fail ? null : code, timedOut, outcome, summary, closedWhy: timedOut ? "timed_out" : code === null ? "gone" : "finished", ...(fail ? { vault: fail.kind } : {}) });
          if (a) this.ended(r.ws, a, { id: r.id, outcome, timedOut, exitCode: fail ? null : code, summary: summary ?? "", output: fail ? "" : said.slice(-OUTPUT_MAX), chainDepth: r.chainDepth ?? 0, timeoutMs: ms, vault: fail?.kind ?? null });
        } finally {
          this.closing.delete(r.id);
        }
      });
    }
  }

  // `startup` (the runner has just started: not again within STARTUP_GAP) or `wake` (the computer
  // woke): those automations run on the next tick.
  lifecycle(event, why, now) {
    if (event === "startup") {
      if (now - (this.state.lastStartup ?? 0) < STARTUP_GAP) return;
      this.state.lastStartup = now;
      this.save();
    }
    this.each((ws, a) => { if (a.trigger.kind === "lifecycle" && a.trigger.event === event) this.pending.push({ ws, name: a.name, why }); });
  }

  // How a run's agent said it went, read off its screen (`hc read`): { outcome, summary }, or null
  // when that can't be read. Never in the way of closing the tab: 5s at most.
  // run: a run with secrets has its screen redacted by herdr-ws-secret first; when that fails, its
  // outcome word is kept and its summary isn't (no report text rather than an unredacted one).
  async report(terminal, run = null) {
    if (!terminal) return null;
    try {
      const r = await exec("hc", ["read", String(terminal), "--lines", "60"], { timeout: 5000 });
      if (r?.code !== 0) return null;
      // Only Standard ones: a Protected value never reaches the runner's side (the broker redacts its
      // own output), and the CLI refuses to redact one. A name Vault no longer has stays, so it fails safe.
      const names = (run?.secrets ?? []).filter((n) => resolveEntry(this.vault.entries, run.ws, n)?.tier !== "protected");
      if (!names.length) return outcomeOf(r.stdout);
      const clean = await this.redacted(r.stdout, { ...run, secrets: names });
      return clean === null ? { outcome: outcomeOf(r.stdout).outcome, summary: null } : outcomeOf(clean);
    } catch { return null; }
  }

  // Text with a run's secrets replaced by herdr-ws-secret redact, or null when that can't be done. The
  // text goes through a 0600 file in the runner's logs folder (0700; exec has no stdin), removed after.
  async redacted(text, run) {
    const dir = `${runnerDir()}/logs`;
    const file = `${dir}/${run.id}-${Math.random().toString(36).slice(2, 8)}-report.log`;
    try {
      await exec("mkdir", ["-p", "-m", "700", dir]);
      await writeTextFile(file, String(text ?? ""), null);
      await exec("chmod", ["600", file]);
      const r = await exec(this.secretCli(), ["redact", "--workspace", run.ws, "--names", run.secrets.join(","), "--in", file], { timeout: 15000 });
      return r?.code === 0 ? String(r.stdout ?? "") : null;
    } catch { return null; }
    finally { await exec("rm", ["-f", "--", file]).catch(() => {}); }
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
    this.cx = cx;
    if (!this.restored) {
      this.state = { ...this.state, ...((await this.store.read()) ?? {}) };
      for (const k of ["allowedScripts", "askedScripts", "githubReview", "githubMerged", "githubCi", "githubLabeled"]) this.state[k] ??= {};
      this.restored = true;
      // What was waiting or running when the last runner stopped doesn't carry on: its queue and
      // its scripts went with it.
      const now = Date.now();
      this.state.runs = this.state.runs.map((r) => (r.status === "queued" ? { ...r, status: "skipped", note: "The runner stopped while it waited for a slot." }
        : r.status === "running" ? { ...r, status: "started", closed: now, closedWhy: "stopped", outcome: "failed", summary: "The runner stopped while its script ran." } : r));
      this.logsSwept = false; // once its runs are known (below)
    }
    // Before the files: a save in the screen allows its check, then writes the file.
    this.approvals();
    await this.readVault();
    const list = {};
    const globals = await loadAutomations(globalDir(), "global");
    for (const d of (shared("workspaces.defs") ?? []).filter((x) => !x.error)) {
      const own = await loadAutomations(`${d.dir}/automations`, "workspace");
      // A copy each: on here unless its file is off, or names this workspace in `off:`.
      const forAll = globals.filter((g) => !own.some((o) => o.name === g.name))
        .map((g) => ({ ...g, everywhere: g.enabled, enabled: g.enabled && !g.off.includes(d.id) }));
      list[d.id] = chainErrors(this.applyVault(d.id, [...own, ...forAll]));
    }
    this.globals = chainErrors(globals);
    const now = Date.now();
    for (const [ws, autos] of Object.entries(list)) {
      if (autos.some((a) => a.trigger.kind === "board")) this.tasks[ws] ??= await loadTasks(ws);
      else delete this.tasks[ws];
      for (const a of autos) if (a.trigger.kind === "every") this.state.base[`${ws}/${a.name}`] ??= now;
    }
    this.list = list;
    // Each github automation's repo; one that couldn't be found is looked for again.
    for (const k of Object.keys(this.repos)) if (this.repos[k].error) delete this.repos[k];
    const watched = new Set(); // "<repo>\t<event>", and "<repo>\tlabeled\t<label>" for each label
    for (const [ws, autos] of Object.entries(list)) {
      for (const a of autos) {
        if (a.trigger.kind !== "github") continue;
        const k = `${ws}\t${a.trigger.repo}`, def = this.def(ws);
        if (a.trigger.repo === "*") {
          // Looked for again when the workspace's folders change.
          if (this.repos[k]?.sig !== JSON.stringify(repoFolders(def))) this.repos[k] = await everyRepo(def);
        } else this.repos[k] ??= await repoOf(def, a.trigger.repo);
        if (!a.enabled || a.error || !this.def(ws)) continue;
        const event = a.trigger.event ?? "opened";
        for (const r of watchedOf(this.repos[k])) {
          watched.add(`${r.repo}\t${event}`);
          if (event === "labeled") watched.add(`${r.repo}\tlabeled\t${a.trigger.label.toLowerCase()}`);
        }
      }
    }
    // A kind of event (or a label) nothing watches on a repo forgets what it saw there, so watching it
    // again starts afresh: its first look only notes what's there.
    const kinds = { opened: this.state.github, "review-requested": this.state.githubReview, merged: this.state.githubMerged, failed: this.state.githubCi, labeled: this.state.githubLabeled };
    for (const [event, map] of Object.entries(kinds)) {
      for (const repo of Object.keys(map)) if (!watched.has(`${repo}\t${event}`)) delete map[repo];
    }
    for (const [repo, byLabel] of Object.entries(this.state.githubLabeled)) {
      // Kept per label since automations v2's review; an older list of "number:label" pairs starts afresh.
      if (!byLabel || typeof byLabel !== "object" || Array.isArray(byLabel)) { delete this.state.githubLabeled[repo]; continue; }
      for (const label of Object.keys(byLabel)) if (!watched.has(`${repo}\tlabeled\t${label}`)) delete byLabel[label];
      if (!Object.keys(byLabel).length) delete this.state.githubLabeled[repo];
    }
    // What a check last printed goes with its automation, and with the check as it was written then.
    for (const k of Object.keys(this.state.printed)) {
      const i = k.indexOf("/");
      if (list[k.slice(0, i)]?.find((a) => a.name === k.slice(i + 1))?.check !== this.state.printed[k].cmd) delete this.state.printed[k];
    }
    // An allowed line or script, and having asked about one, go with their automation.
    const what = [[this.state.allowed, (a) => a.check], [this.state.asked, (a) => a.check],
      [this.state.allowedScripts, (a) => a.run === "shell"], [this.state.askedScripts, (a) => a.run === "shell"]];
    for (const [map, has] of what) {
      for (const k of Object.keys(map)) {
        const i = k.indexOf("/"), w = k.slice(0, i);
        const autos = w === "*" ? globals : list[w]?.filter((a) => a.scope !== "global");
        if (autos && !autos.some((a) => a.name === k.slice(i + 1) && has(a))) delete map[k];
      }
    }
    // A check or a script nobody has allowed is asked about once, when it's first seen.
    for (const [ws, autos] of Object.entries(list)) {
      for (const a of autos) {
        const k = this.akey(ws, a);
        if (!a.check || this.state.allowed[k] === a.check || this.state.asked[k] === a.check) delete this.unasked[k];
        else if (this.unasked[k]?.check !== a.check) this.unasked[k] = { check: a.check, at: now };
        const script = a.run === "shell" ? a.body : null;
        if (!script || this.state.allowedScripts[k] === script || this.state.askedScripts[k] === script) delete this.unaskedScripts[k];
        else if (this.unaskedScripts[k]?.script !== script) this.unaskedScripts[k] = { script, at: now };
      }
    }
    for (const map of [this.unasked, this.unaskedScripts]) {
      for (const k of Object.keys(map)) {
        const i = k.indexOf("/"), w = k.slice(0, i);
        if (!(w === "*" ? globals : list[w])?.some((a) => a.name === k.slice(i + 1))) delete map[k];
      }
    }
    // A workspace that's gone takes its runs and times with it (one with a broken
    // workspace.jsonc is still there).
    const there = new Set((shared("workspaces.defs") ?? []).map((d) => d.id));
    if (there.size) {
      const gone = this.state.runs.filter((r) => !there.has(r.ws));
      if (gone.length) { this.state.runs = this.state.runs.filter((r) => there.has(r.ws)); this.dropLogs(gone.map((r) => r.logFile)); }
      for (const map of [this.state.last, this.state.base, this.state.allowed, this.state.asked, this.state.allowedScripts, this.state.askedScripts]) for (const k of Object.keys(map)) if (!k.startsWith("*/") && !there.has(k.split("/")[0])) delete map[k];
    }
    if (this.logsSwept === false) { this.logsSwept = true; await this.sweepLogs(now); }
    const gate = this.gate(now);
    // Off, or just back on: what came due meanwhile doesn't run late.
    if (!this.loaded) {
      this.loaded = true;
      if (gate.on && !gate.back) this.catchUp(this.state.seen || now, now, this.h.away ?? "while Herdr was closed");
      if (gate.on) this.lifecycle("startup", this.h.startWhy ?? "Herdr started", now);
    }
    this.save();
    this.watchFiles(cx);
    this.publish();
  }

  // Schedules due from `from` up to this minute (at most MISSED back) that didn't
  // run, because Herdr was closed or its timer stopped while the Mac slept: each runs once.
  // One whose misses are all older than that doesn't run late: it's logged as
  // "missed" (how many times, and the last), and one toast lists them all.
  // `missed: skip` never runs late and says nothing; `missed: always` runs once however late
  // (up to LOOK_BACK).
  catchUp(from, now, reason) {
    const cutoff = now - MISSED;
    const older = Math.max(from, now - LOOK_BACK);
    const report = [];
    let one = null; // the automation the toast is about, when it's about one
    this.each((ws, a) => {
      if (a.trigger.kind !== "at" && a.trigger.kind !== "cron" && a.trigger.kind !== "once") return;
      if (a.missed === "skip") return;
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
      if (a.missed === "always") { this.pending.push({ ws, name: a.name, why: `Missed ${when} ${reason}` }); return; }
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
    const check = this.checkAllowed(ws, a), script = this.allowedScript(ws, a);
    if (!check && !script) return "Its script and its check haven't been allowed yet, so it doesn't run. Read them, then allow them.";
    if (!script) return "Its script hasn't been allowed yet, so it doesn't run. Read it, then allow it.";
    if (!check) return "Its check hasn't been allowed yet, so it doesn't start. Read the command, then allow it.";
    if (a.secretEnv?.length && !this.vaultOn()) return "Secrets is off in Settings > Features, and this uses secrets (secret_env), so it doesn't run. Turn Secrets on to run it.";
    const vault = this.vaultIssue(ws, a)?.warning;
    if (vault) return vault;
    // A script without a tab is one call, and Herdr stops any call after 10 minutes.
    if (a.run === "shell" && !a.terminal && a.timeout && (a.timeoutMs === 0 || a.timeoutMs > SCRIPT_MAX)) {
      return `Without a tab its script is stopped after ${formatDuration(SCRIPT_MAX)}, whatever its timeout says. For longer, give it terminal: true.`;
    }
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
        checkAllowed: this.checkAllowed(ws, a), scriptAllowed: this.allowedScript(ws, a),
        warning: this.warningOf(ws, a, def),
      }));
    }
    if (JSON.stringify(out) !== JSON.stringify(shared("workspaces.automations") ?? null)) setShared("workspaces.automations", out);
    const globals = this.globals.map((a) => ({ ...a, allowed: this.allowed("*", a), checkAllowed: this.checkAllowed("*", a), scriptAllowed: this.allowedScript("*", a) }));
    if (JSON.stringify(globals) !== JSON.stringify(shared("workspaces.automations.global") ?? null)) setShared("workspaces.automations.global", globals);
    if (JSON.stringify(this.state.runs) !== JSON.stringify(shared("workspaces.automation.runs") ?? null)) setShared("workspaces.automation.runs", this.state.runs);
  }

  // A check nobody has allowed is asked about once, a few seconds after it's first
  // seen: the screen's own Save allows it, and that can arrive just after the file.
  ask(now) {
    const cut = (t) => (t.length > 160 ? `${t.slice(0, 160)}…` : t);
    const where = (ws) => (ws === "*" ? "every workspace" : this.def(ws)?.name ?? ws);
    const autoOf = (k) => { const i = k.indexOf("/"), ws = k.slice(0, i); return [ws, ws === "*" ? this.globals.find((g) => g.name === k.slice(i + 1)) : this.find(ws, k.slice(i + 1))]; };
    for (const [k, u] of Object.entries(this.unasked)) {
      if (now - u.at < ASK_AFTER) continue;
      delete this.unasked[k];
      const [ws, a] = autoOf(k);
      if (!a || a.check !== u.check || this.checkAllowed(ws, a) || this.state.asked[k] === a.check) continue;
      this.state.asked[k] = a.check;
      this.save();
      notify({
        title: `Allow ${a.name}'s check?`,
        body: `In ${where(ws)}. Before each start, Herdr would run: ${cut(a.check)}. It doesn't start until you allow that in Automations.`,
        level: "warning", action: openAt(ws, a),
      });
    }
    for (const [k, u] of Object.entries(this.unaskedScripts)) {
      if (now - u.at < ASK_AFTER) continue;
      delete this.unaskedScripts[k];
      const [ws, a] = autoOf(k);
      if (!a || a.run !== "shell" || a.body !== u.script || this.allowedScript(ws, a) || this.state.askedScripts[k] === a.body) continue;
      this.state.askedScripts[k] = a.body;
      this.save();
      notify({
        title: `Allow ${a.name}'s script?`,
        body: `In ${where(ws)}. It runs this ${shellOf(a)} script, with no agent: ${cut(a.body.replace(/\s*\n\s*/g, "; "))}. It doesn't run until you allow it in Automations.`,
        level: "warning", action: openAt(ws, a),
      });
    }
  }

  // Every 500ms: from the switcher's timer, or the background runner's.
  tick(cx) {
    if (!this.loaded) return;
    this.cx = cx;
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
      // Minutes skipped since the last tick (the Mac slept): their schedules run late, once, and
      // the `wake` automations run.
      if (on && this.minute !== undefined && minute > this.minute + 1) {
        this.catchUp((this.minute + 1) * 60e3, now, window()?.platform === "macos" ? "while the Mac was asleep" : "while the computer was asleep");
        this.lifecycle("wake", "The computer woke from sleep", now);
      }
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
    this.timeouts(cx, now);
    this.shellTabs(cx, now);
    this.drain(cx, on);
    for (const [k, f] of Object.entries(this.files)) {
      if (now - f.at >= QUIET) { delete this.files[k]; this.filesFire(cx, f); }
    }
    if (now - this.polled >= 2000) { this.polled = now; this.inbox(cx); }
    this.lookAtVault(cx, now);
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
  // off or its last run is working), { key } (one run per task or agent), { chainDepth }
  // (how many automations set each other off before this one).
  // Automations off: nothing starts; a manual start is noted as skipped.
  fire(cx, ws, a, why, vars = {}, how = {}) {
    const k = `${ws}/${a.name}`, key = how.key ? `${k}#${how.key}` : k, now = Date.now();
    if (!this.automationsOn()) {
      if (how.manual) this.log({ ws, name: a.name, at: now, why, status: "skipped", note: OFF_NOTE });
      return;
    }
    if (!how.manual) {
      if (this.starting.has(key) || this.waitQueue.some((q) => q.key === key)) return;
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
    const extra = how.chainDepth ? { chainDepth: how.chainDepth } : {};
    cx.spawn(async (cx) => { await this.start(ws, a, why, vars, key, how.folder, Boolean(how.manual), extra); cx.notify(); });
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
        // Through autofacts.js, which reads a `check: |` block whole.
        try { await writeTextFile(a.file, withFrontFields(old, { enabled: false }), old); return; } catch {}
      }
    });
  }

  // Starts of one automation take turns, so a burst of calls all run, one after another.
  // extra: { chainDepth, reserved (a slot is held for it: the queue's), checked (its check's
  // output, from before it waited) }.
  start(ws, a, why, vars, key, place, manual, extra = {}) {
    const at = Date.now();
    this.starting.set(key, (this.starting.get(key) ?? 0) + 1);
    const go = async () => {
      try { await this.launch(ws, a, why, vars, at, place, manual, { ...extra, key }); }
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

  // --- taking turns: how many run at once ---

  kindOf(a) { return a.run === "shell" ? "shell" : "agent"; }
  // How many of a kind may run at once (0: no limit).
  cap(kind) {
    if (kind === "shell") return SHELL_CAP;
    const n = Number(this.h.automationSetting?.("max-parallel") ?? 2);
    return Number.isInteger(n) && n >= 0 ? n : 2;
  }
  // How many of a kind run now, those being started included.
  going(kind) {
    const c = countActive(this.state.runs, agents(), terminals(), Date.now());
    return (kind === "shell" ? c.shells : c.agents) + this.launching[kind];
  }
  free(kind) { const cap = this.cap(kind); return cap === 0 || this.going(kind) < cap; }

  // An automatic run with no slot: a "queued" entry in the runs, and its turn in the queue (once per key).
  enqueue(ws, a, why, vars, place, at, extra, checked) {
    const kind = this.kindOf(a);
    if (this.waitQueue.some((q) => q.key === extra.key)) return;
    const id = this.log({
      ws, name: a.name, at, why, status: "queued", ...(kind === "shell" ? { kind: "shell", shell: shellOf(a) } : {}),
      note: `Waiting for a parallel slot (${this.going(kind)} of ${this.cap(kind)} busy)`,
    });
    this.waitQueue.push({ key: extra.key, ws, name: a.name, why, vars, place, at, kind, id, extra: { ...(extra.chainDepth ? { chainDepth: extra.chainDepth } : {}), ...(checked !== undefined ? { checked } : {}) } });
  }

  // Each tick: the queued runs whose kind has a free slot start, oldest first. Automations off,
  // or an automation that's gone or off: its queued run is noted as skipped.
  drain(cx, on) {
    if (!this.waitQueue.length) return;
    const left = [];
    for (const q of this.waitQueue) {
      const a = this.find(q.ws, q.name);
      const why = !on ? OFF_NOTE : !a ? "It was taken out while it waited." : !a.enabled || a.error ? "It was turned off while it waited." : null;
      if (why) { this.patch(q.id, { status: "skipped", note: why }); continue; }
      if (!this.free(q.kind)) { left.push(q); continue; }
      this.launching[q.kind]++;
      this.state.runs = this.state.runs.filter((r) => r.id !== q.id);
      cx.spawn(async (cx) => { await this.start(q.ws, a, q.why, q.vars, q.key, q.place, false, { ...q.extra, reserved: true }); cx.notify(); });
    }
    this.waitQueue = left;
  }

  // place: where it runs when the automation names no folder (a github one's repo), else the root.
  // manual: started by hand or from outside, so it starts whatever its check says, and doesn't wait for a slot.
  async launch(ws, a, why, vars, at, place, manual, extra = {}) {
    const kind = this.kindOf(a);
    // Holding a slot (the queue took one for it, or it took one below) until it's in the runs.
    let held = Boolean(extra.reserved);
    const release = () => { if (held) { held = false; this.launching[kind] = Math.max(0, this.launching[kind] - 1); } };
    try {
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
      // Vault off, or a secret it names that Vault doesn't have (or can't hand an agent): it doesn't run.
      const blocked = this.vaultBlock(ws, a);
      if (blocked) {
        this.log({ ws, name: a.name, at, why, ...blocked });
        if (manual || blocked.status === "failed") notify({ title: `${a.name} didn't start`, body: blocked.note, level: "warning", action: openAt(ws, a) });
        return;
      }
      if (!this.allowed(ws, a)) {
        const script = !this.allowedScript(ws, a), check = !this.checkAllowed(ws, a);
        const what = script && check ? "Its script and its check haven't" : script ? "Its script hasn't" : "Its check hasn't";
        const again = this.repeat(ws, a, at, why, "waiting", "", (row) => `${what} been allowed${row}, so it didn't start`);
        if (manual || a.trigger.kind === "once" || !again) notify({
          title: `${a.name} didn't start`, body: `${what} been allowed yet. Read it in Automations, then allow it.`, level: "warning",
          action: openAt(ws, a),
        });
        return;
      }
      if (a.check && extra.checked !== undefined) all.check = extra.checked; // checked before it waited for a slot
      else if (a.check) {
        const res = await runCheck(exec, a.check, folder, { ...all, folder, workspace_id: ws }, this.secretFor(ws, a));
        // On a schedule, what it printed at the last check too isn't news (unless `dedupe: always`).
        // (What sets off the other kinds is new each time.) Printing nothing in between forgets it.
        if (!res.error && (a.trigger.kind === "every" || a.trigger.kind === "at" || a.trigger.kind === "cron")) {
          const k = `${ws}/${a.name}`, was = this.state.printed[k];
          res.same = a.dedupe !== "always" && Boolean(res.out) && was?.cmd === a.check && was.out === res.out;
          this.state.printed[k] = { cmd: a.check, out: res.out };
          this.save();
        }
        if (!manual && !this.checked(ws, a, at, why, res)) return;
        all.check = res.out ?? "";
      }
      // No slot free: it waits its turn (a manual start never does).
      if (!held) {
        if (!manual && !this.free(kind)) { this.enqueue(ws, a, why, vars, place, at, extra, a.check ? all.check : undefined); return; }
        this.launching[kind]++;
        held = true;
      }
      if (kind === "shell") return await this.shellRun(ws, a, why, all, at, folder, def, extra, release);
      let prompt = fill(a.body, all);
      // What set it off goes at the end, unless the prompt uses one of its fill-ins.
      if (vars.event && !/\{\{\s*(event|text|task|task\.\w+|files?|agent|terminal|space|pr|issue|number|title|url|author|repo|labels|output|upstream|workflow)\s*\}\}/.test(a.body)) prompt = [prompt, vars.event].filter(Boolean).join("\n\n");
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
      // Its secrets went to its check only: the agent's tab is started as it always is. Their names stay
      // on the run, so its report is redacted before it's kept.
      const secret = this.secretFor(ws, a);
      const made = this.h.open ? await this.h.open(ws, a.name, folder, argv, first) : await this.open(ws, a.name, folder, argv, first);
      if (card) await this.updateCard(card.file, { terminal: made.terminal ?? null, tab: made.tab ?? null, started: today() });
      const level = effectiveNotify(a);
      this.log({ ws, name: a.name, at, why, status: "started", terminal: made.terminal ?? null, tab: made.tab ?? null, space: made.space ?? null, folder, card: card?.id ?? null, notify: level, ...(extra.chainDepth ? { chainDepth: extra.chainDepth } : {}), ...(made.adopt ? { adopt: true } : {}), ...(expects ? { expects: true } : {}), ...(reports ? { reports: true } : {}), ...(secret ? { secrets: secret.pairs.map((p) => p.name) } : {}) });
      release();
      this.tidy(ws, a.name);
      // Said only at the level `all` (notify:): the run's end is what the others tell.
      if (shouldNotify(level, "started")) notify({
        title: `${a.name} started`, body: `${why}. In ${def.name} › ${SPACE}.`, level: "info",
        ...(made.tab ? { action: { name: "tab.select", args: { id: made.tab } } } : {}),
      });
    } finally {
      release();
    }
  }

  // A shell automation's run (run: shell): its script with the run's fill-ins as $HERDR_…
  // variables. Without `terminal: true` it runs unseen: "running" in the runs, then its exit
  // code, how long it took, what it printed (the log file) and a one-line summary. With it, a
  // tab in the Automations space runs it (shellTabs() follows it). release(): its slot is taken
  // once it's in the runs.
  async shellRun(ws, a, why, all, at, folder, def, extra, release) {
    const level = effectiveNotify(a), timeoutMs = effectiveTimeout(a), shell = shellOf(a);
    const env = { ...all, folder, workspace_id: ws };
    const depth = extra.chainDepth ? { chainDepth: extra.chainDepth } : {};
    const secret = this.secretFor(ws, a);
    const named = secret ? { secrets: secret.pairs.map((p) => p.name) } : {};
    const started = () => {
      if (shouldNotify(level, "started")) notify({ title: `${a.name} started`, body: `${why}. Its ${shell} script runs in ${tilde(folder)}.`, level: "info", action: openAt(ws, a) });
    };
    if (a.terminal) {
      const argv = ["env", ...checkEnv(env), "sh", "-c", SHELL_TAB, "sh", shell, a.body, a.keep ? "1" : "",
        ...(secret ? secretArgv(secret, { timeoutMs: timeoutMs > 0 ? Math.min(timeoutMs, TAB_SECRET_MAX) : TAB_SECRET_MAX }) : [])];
      const made = this.h.open ? await this.h.open(ws, a.name, folder, argv, null, { bare: true }) : await this.open(ws, a.name, folder, argv, null);
      this.log({ ws, name: a.name, at, why, status: "started", kind: "shell", shell, shown: true, terminal: made.terminal ?? null, tab: made.tab ?? null, space: made.space ?? null, folder, notify: level, ...depth, ...named, ...(made.adopt ? { adopt: true } : {}) });
      release();
      started();
      return;
    }
    const id = this.log({ ws, name: a.name, at, why, status: "running", kind: "shell", shell, folder, notify: level, ...depth, ...named });
    release();
    started();
    // With secrets, what comes back (and so the log, the summary, {{output}}) is redacted by the CLI.
    const res = await runShellScript(exec, { shell, script: a.body, folder, vars: env, timeoutMs, secret });
    const end = Date.now();
    let logFile = null;
    if (res.combined) {
      logFile = `${runnerDir()}/logs/${id}.log`;
      try {
        // Yours only: a script may print a token.
        await exec("mkdir", ["-p", "-m", "700", `${runnerDir()}/logs`]);
        await writeTextFile(logFile, res.combined, null);
        await exec("chmod", ["600", logFile]).catch(() => {});
      } catch { logFile = null; }
    }
    this.patch(id, {
      status: "started", closed: end, finishedAt: end, durationMs: res.durationMs, exitCode: res.code, timedOut: res.timedOut,
      outcome: res.outcome, summary: res.summary || null, logFile, closedWhy: res.timedOut ? "timed_out" : "finished", ...(res.vault ? { vault: res.vault } : {}),
    });
    // Refused by herdr-ws-secret before it started: no output to pass on.
    this.ended(ws, a, { id, outcome: res.outcome, timedOut: res.timedOut, exitCode: res.code, summary: res.summary, output: res.vault ? "" : res.combined, chainDepth: extra.chainDepth ?? 0, level, timeoutMs, vault: res.vault ?? null });
  }

  // A run has ended (a script's, or an agent's closed or stopped): what its level says about it,
  // then the automations waiting on it (`when: automation done|failed <name>`).
  ended(ws, a, { id, outcome, timedOut = false, exitCode = null, summary = "", output = "", chainDepth = 0, level = effectiveNotify(a), timeoutMs = 0, toast = true, vault = null }) {
    const action = { action: openAt(ws, a) };
    if (toast && outcome === "failed" && shouldNotify(level, "problem")) {
      notify({
        title: vault ? `${a.name} didn't run` : timedOut ? `${a.name} timed out` : a.run === "shell" ? (exitCode == null ? `${a.name} stopped` : `${a.name} failed (exit ${exitCode})`) : `${a.name} failed`,
        body: timedOut ? `Stopped after ${formatDuration(timeoutMs)}.${summary && !/^Timed out/.test(summary) ? ` ${summary}` : ""}` : summary || "It gave no reason.",
        level: timedOut ? "warning" : "error", ...action,
      });
    } else if (toast && outcome === "done" && a.run === "shell" && shouldNotify(level, "finished")) {
      notify({ title: `${a.name} finished`, body: summary || "Its script worked.", level: "info", ...action });
    }
    // `automation done` ones start when it did its work, `automation failed` ones when it failed or
    // timed out. One that had nothing to do, or whose end isn't known (its tab closed first), starts neither.
    const how = timedOut ? "failed" : outcome;
    if (how === "done" || how === "failed") this.triggerChains(ws, a.name, how, { output, exitCode, chainDepth, runId: id });
  }

  // The automations here that wait on this one: each starts, told what it said ({{output}},
  // $HERDR_OUTPUT), unless the chain is CHAIN_MAX deep already.
  triggerChains(ws, name, outcome, { output = "", exitCode = null, chainDepth = 0, runId = "" } = {}) {
    const cx = this.cx;
    if (!cx) return;
    const failed = outcome === "failed";
    for (const a of this.list[ws] ?? []) {
      const t = a.trigger;
      if (!a.enabled || a.error || t.kind !== "chain" || t.target !== name || (t.on === "failed") !== failed) continue;
      const why = `${name} ${failed ? "failed" : "finished"}`;
      if (chainDepth + 1 >= CHAIN_MAX) {
        this.log({ ws, name: a.name, at: Date.now(), why, status: "skipped", note: `${CHAIN_MAX} automations in a row set each other off: the chain stops here.` });
        continue;
      }
      const out = String(output ?? "");
      const text = out.length > OUTPUT_MAX ? `… ${out.slice(-OUTPUT_MAX)}` : out;
      this.fire(cx, ws, a, why, {
        upstream: name, outcome: outcome ?? "done", output: text, exit_code: exitCode === null || exitCode === undefined ? "" : String(exitCode),
        event: [`${why}.`, text && `It said:\n${text}`].filter(Boolean).join("\n"),
      }, { key: `after:${runId || Date.now()}`, chainDepth: chainDepth + 1 });
    }
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

  // A run into the runs (newest first); its id. History keeps RUNS_PER_AUTOMATION of each
  // automation's and RUNS_MAX in all (autofacts.js: pruneRuns); a dropped one's log file goes too.
  log(r) {
    const id = `${r.at}-${Math.random().toString(36).slice(2, 7)}`;
    this.state.runs = this.prune([{ id, ...r }, ...this.state.runs]);
    this.save();
    this.publish();
    return id;
  }

  prune(runs) {
    const { kept, dropped } = pruneRuns(runs);
    this.dropLogs(dropped.map((x) => x.logFile));
    return kept;
  }

  // Deletes these log files: only ones in the logs folder.
  dropLogs(files) {
    const logs = (files ?? []).filter((f) => typeof f === "string" && f.startsWith(`${runnerDir()}/logs/`) && !f.includes("/../"));
    if (logs.length) exec("rm", ["-f", "--", ...logs]).catch(() => {});
  }

  // Once, when it starts: the log files no run names go (a run dropped while nothing was looking,
  // or a removed workspace's from before this was done). Not one from the last hour (its name starts
  // with its run's start time): a runner handing over may have just written it.
  async sweepLogs(now) {
    const at = `${runnerDir()}/logs`;
    let names = [];
    try { names = await fs.readdir(at); } catch { return; }
    const named = new Set(this.state.runs.map((r) => r.logFile).filter(Boolean));
    this.dropLogs(names.filter((n) => n.endsWith(".log") && !named.has(`${at}/${n}`) && !(Number(/^\d+/.exec(n)?.[0] ?? 0) > now - 3600e3)).map((n) => `${at}/${n}`));
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

  // What's new on GitHub for the github automations: one `gh api` call per watched repo and kind
  // of event, each made only while an automation watches for it. Each kind's first look (and each
  // label's) only notes what's there; after that, what wasn't there before sets them off. A kind or a
  // label nothing watches any more is forgotten (load()), so watching it again looks afresh.
  //   opened             the issues list (it has PRs too): each number higher than the last look's
  //   review-requested   a search for open PRs asking for your review: each one not asked last time
  //   merged             recently closed PRs: each merged one not seen merged before
  //   failed (ci)        the default branch's workflow runs: the newest of each workflow, failed (or timed
  //                      out, or it couldn't start), not seen before
  //   labeled            recently updated open issues and PRs: per label, each number not seen with it before
  // What happens while Herdr is closed is picked up when it opens.
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
    // Back on after off: this look only notes what's there, as a first look does.
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
          const rebase = Boolean(this.ghRebase?.has(repo));
          this.ghRebase?.delete(repo);
          const wants = (event) => subs.filter((x) => (x.a.trigger.event ?? "opened") === event);
          delete this.ghWarn[repo];
          const api = async (path) => {
            let r;
            try { r = await exec("gh", ["api", path], { timeout: 60000 }); }
            catch (e) { r = { code: 1, stderr: /start|not found|ENOENT/i.test(message(e)) ? "gh isn't installed" : message(e) }; }
            let out = null;
            if (r.code === 0) { try { out = JSON.parse(r.stdout); } catch {} }
            if (out === null) this.ghWarn[repo] ??= `Can't read ${repo} with gh: ${String(r.stderr || r.stdout || "no answer").trim().split("\n")[0]}`;
            return out;
          };
          const fireFor = (list, it, why, key, vars) => {
            const isPr = Boolean(it.pull_request);
            for (const { ws, a, folder } of list) {
              const t = a.trigger;
              if (t.what !== "ci" && (t.what === "pr") !== isPr) continue;
              if (t.others && this.me && it.user?.login === this.me) continue;
              if (t.label && t.event !== "labeled" && !(it.labels ?? []).some((l) => String(l.name ?? l).toLowerCase() === t.label.toLowerCase())) continue;
              this.fire(cx, ws, a, why, vars ?? itemVars(repo, it), { key, folder });
            }
          };

          // Opened: the highest number seen.
          if (wants("opened").length) {
            const items = await api(`repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=30`);
            if (Array.isArray(items)) {
              const seen = rebase ? undefined : this.state.github[repo];
              this.state.github[repo] = Math.max(seen ?? 0, ...items.map((it) => it.number ?? 0));
              if (seen !== undefined) {
                for (const it of items.filter((x) => x.number > seen).sort((x, y) => x.number - y.number).slice(-MAX_NEW)) {
                  fireFor(wants("opened"), it, `${it.pull_request ? "PR" : "Issue"} #${it.number} opened in ${repo}`, `${repo}#${it.number}`);
                }
              }
            }
          }

          // Review requested: the open PRs that ask you now; one not asked last time is new.
          if (wants("review-requested").length) {
            const res = await api(`search/issues?q=${encodeURIComponent(`repo:${repo} is:pr is:open review-requested:@me`).replace(/%20/g, "+")}&per_page=20`);
            const items = Array.isArray(res?.items) ? res.items : null;
            if (items) {
              const seen = rebase ? undefined : this.state.githubReview[repo];
              this.state.githubReview[repo] = items.map((it) => it.number);
              if (seen !== undefined) {
                for (const it of items.filter((x) => !seen.includes(x.number)).slice(0, MAX_NEW)) {
                  fireFor(wants("review-requested"), { ...it, pull_request: it.pull_request ?? {} }, `Your review is asked for on PR #${it.number} in ${repo}`, `${repo}#${it.number}:review`);
                }
              }
            }
          }

          // Merged: recently closed PRs that were merged, each once.
          if (wants("merged").length) {
            const items = await api(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`);
            if (Array.isArray(items)) {
              const merged = items.filter((it) => it.merged_at);
              const seen = rebase ? undefined : this.state.githubMerged[repo];
              this.state.githubMerged[repo] = [...new Set([...merged.map((it) => it.number), ...(seen ?? [])])].slice(0, 100);
              if (seen !== undefined) {
                for (const it of merged.filter((x) => !seen.includes(x.number)).reverse().slice(-MAX_NEW)) {
                  fireFor(wants("merged"), { ...it, pull_request: {} }, `PR #${it.number} merged in ${repo}`, `${repo}#${it.number}:merged`);
                }
              }
            }
          }

          // CI failed: the default branch's newest run of each workflow, when it failed.
          if (wants("failed").length) {
            if (!this.ghBranch[repo]) {
              const r = await exec("gh", ["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { timeout: 30000 }).catch(() => null);
              if (r?.code === 0 && r.stdout.trim()) this.ghBranch[repo] = r.stdout.trim();
            }
            const branch = this.ghBranch[repo];
            const res = branch ? await api(`repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`) : null;
            if (!branch) this.ghWarn[repo] ??= `Can't read ${repo}'s default branch with gh.`;
            const runs = Array.isArray(res?.workflow_runs) ? res.workflow_runs : null;
            if (runs) {
              const newest = new Map();
              for (const w of runs) if (w.status === "completed" && !newest.has(w.workflow_id)) newest.set(w.workflow_id, w);
              const failing = [...newest.values()].filter((w) => ["failure", "timed_out", "startup_failure"].includes(w.conclusion));
              const seen = rebase ? undefined : this.state.githubCi[repo];
              this.state.githubCi[repo] = [...new Set([...failing.map((w) => w.id), ...(seen ?? [])])].slice(0, 50);
              if (seen !== undefined) {
                for (const w of failing.filter((x) => !seen.includes(x.id))) {
                  const block = [`The ${w.name ?? "workflow"} workflow failed on ${branch} in ${repo} (run #${w.run_number}): ${w.display_title ?? ""}`.trim(), w.html_url].filter(Boolean).join("\n");
                  fireFor(wants("failed"), w, `${w.name ?? "A workflow"} failed in ${repo}`, `${repo}:ci:${w.id}`, {
                    workflow: w.name ?? "", url: w.html_url ?? "", title: w.display_title ?? "", number: String(w.run_number ?? ""), repo, event: block,
                  });
                }
              }
            }
          }

          // Labeled: the recently updated open items with each label watched. Each label has its own
          // first look (a label watched for the first time only notes what has it), then an item
          // that has it and didn't before sets them off.
          if (wants("labeled").length) {
            const items = await api(`repos/${repo}/issues?state=open&sort=updated&direction=desc&per_page=30`);
            if (Array.isArray(items)) {
              const labels = new Set(wants("labeled").map((x) => x.a.trigger.label.toLowerCase()));
              const was = rebase ? {} : this.state.githubLabeled[repo] ?? {};
              const byLabel = {}, fresh = [];
              for (const label of labels) {
                const having = items.filter((it) => (it.labels ?? []).some((l) => String(l.name ?? l).toLowerCase() === label));
                const seen = was[label];
                byLabel[label] = [...new Set([...having.map((it) => it.number), ...(seen ?? [])])].slice(0, 300);
                if (seen !== undefined) for (const it of having) if (!seen.includes(it.number)) fresh.push({ it, label });
              }
              this.state.githubLabeled[repo] = byLabel;
              for (const p of fresh.slice(0, MAX_NEW)) {
                const who = wants("labeled").filter((x) => x.a.trigger.label.toLowerCase() === p.label);
                fireFor(who, p.it, `${p.it.pull_request ? "PR" : "Issue"} #${p.it.number} got the label ${p.label} in ${repo}`, `${repo}#${p.it.number}:label:${p.label}`);
              }
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
          // The screen's Create, Save and Allow this check or script, passed on by the switcher
          // while the background runner runs: { workspace, name, check?, script? }.
          if (n.endsWith(".allow")) {
            let ask = null;
            try { ask = JSON.parse(text); } catch {}
            if (this.allow(ask)) {
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
