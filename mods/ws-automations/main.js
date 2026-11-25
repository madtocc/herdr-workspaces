// Automations: what a workspace runs by itself. A dialog that the sidebar
// footer's Automations row opens, with props { workspace }. Each row has a switch
// that turns the automation on or off at once; a run that's working or waiting
// on you shows in its row, and its Stop (two clicks) closes the run's tab.
//
// An automation is ~/.herdr/workspaces/<id>/automations/<name>.md: front matter
// (description, when, agent, model, effort, folder, check, card, enabled), then
// its prompt. One for every workspace is ~/.herdr/automations/<name>.md, the same
// file plus `off:` (the workspaces it's off in); the list shows the workspace's
// own first, then those, as agent presets are shown. A workspace's own of the same
// name replaces a global one there. This screen writes the files. The switcher's runner
// (mods/ws-switcher/automations.js) reads them, starts the runs, and publishes
// both in shared "workspaces.automations" and "workspaces.automation.runs". Run
// now asks it through "workspaces.automation.run", because a dialog's tasks end
// when it closes.
//
// Describe it: you say what you want in words, and an agent's CLI drafts every field
// (drafter.js: claude, codex, agy or pi, as Settings > Automations' Drafter says, with no
// tools and a fixed answer shape). The draft fills the editor unsaved, and you read it before
// Create or Save. On a saved automation the same box changes it ("make it hourly"). The fields
// themselves are folded under Details.
//
// It runs an agent with a prompt, or (run: shell) a script with no agent: the body is then a
// script, run by bash, zsh or sh in its folder, with what set it off as $HERDR_… variables.
// Try it beside the script runs it here and now; Preview runs only the check and shows what a
// run would get (the prompt filled in, or the script and its variables), starting nothing.
// With secret_env (as the runner read the saved file), both run the check or script under
// herdr-ws-secret as the runner does (check.js), so it gets its variables and what it prints comes
// back redacted; Preview lists each such variable by its secret's name, never a value.
//
// A check (check.js) is a shell command the runner runs first: nothing starts
// unless it prints something. It's shown in "What it does" whenever there is one,
// since Herdr runs it by itself, and Try it under Details runs it here and now.
// The runner runs only a check and a script you've allowed. Create and Save allow what they
// write (shared "workspaces.automation.allow" { workspace, name, check, script }, set before
// the file is written); one that came another way shows Allow this check (or script). A toast
// about one automation opens the screen on it (props.pick, from the switcher); opened with no
// props (a toast about several, a key), it goes to an automation that's waiting to be allowed.
// A shell run's Log opens History on it (through the bell's "open" ask, which the switcher drains).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea, Popup, ScrollHandle } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, home, appHome, readTextFile, writeTextFile, exec, notify, agents, terminals, run, knownAgents, window } from "herdr";
import { parseWhen, describe, nextAt, shortTime } from "./when.js";
import { KNOBS, words, programOf, knobsIn, configModels, listable, keptModels, listModels, shownModels, knobsText, SHORT_LIST, typeahead, markSegments } from "./knobs.js";
import { runCheck, runShellScript, checkEnv } from "./check.js";
import { splitFront, fieldValue, withFrontFields, normCheck, normScript, parseDuration, formatDuration, effectiveTimeout, effectiveNotify, SHELLS } from "./autofacts.js";
import { DRAFTER_NAMES, DRAFT_MODEL, DRAFT_TIMEOUT, SCHEMA, GUIDE, buildDraftCommand, parseDraftOutput, pickDrafters } from "./drafter.js";
import { automationSetting, parseSettings, SETTINGS_FILE, platformWords } from "./settingsfacts.js";
import * as fs from "fs/promises";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODEL_WORD = /^[A-Za-z0-9._:/@-]+$/;
const COLUMNS = ["backlog", "todo", "doing", "review", "done"];
const STATE = { working: "working", blocked: "needs you", done: "finished", idle: "finished" };
// Moves a file to the Trash ($1), or into $2 where there's no Trash command. Prints where.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/" && echo "$2"`;

const globalDir = () => `${home()}/.herdr/automations`;
const scopeOf = (a) => a?.scope ?? "workspace";
const namesIn = (v) => String(v ?? "").split(",").map((w) => w.trim()).filter(Boolean);
const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const message = (e) => String(e?.message ?? e);
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();
const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");
const pad = (n) => String(n).padStart(2, "0");
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;
// With no workspace shown, the screen is about the automations for every workspace
// alone: this stands in for the workspace, so the editor has something to ask.
const nowhere = () => ({ none: true, id: "", name: "", root: home(), dir: "", folders: [], children: [], board: {} });
const columnsOf = (def) => (Array.isArray(def?.board?.columns) && def.board.columns.length ? def.board.columns : COLUMNS).map((c) => String(c).toLowerCase());
const rel = (def, path) => (path === def.root ? "" : path.startsWith(def.root + "/") ? path.slice(def.root.length + 1) : tilde(path));
const folderChoices = (def) => (def.folders.length ? def.folders : def.children.map((c) => `${def.root}/${c}`)).map((f) => rel(def, f));
const boardAgentOf = (def) => String(def?.board?.agent || "claude");
// The agents Herdr can start: what knownAgents() said when the screen opened, else the
// + menu's last list (ws-new-menu publishes it). installedAgents(): those installed here.
let agentsSeen = null;
const agentList = () => agentsSeen ?? shared("new-menu.agents")?.[""] ?? [];
const installedAgents = () => agentList().filter((a) => a.installed && Array.isArray(a.run));

// What sets it off, as the When chips group it. A schedule is every, at, cron or once.
const kindOf = (w) => (w.kind === "every" || w.kind === "at" || w.kind === "cron" || w.kind === "once" ? "schedule" : w.kind);
const isSchedule = (w) => kindOf(w) === "schedule";
// "once <tomorrow's date> 09:00", on this computer's clock.
const onceTomorrow = () => {
  const d = new Date(Date.now() + 86400e3);
  return `once ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 09:00`;
};
const KINDS = [["schedule", "Schedule"], ["github", "GitHub"], ["board", "Board"], ["agent", "Agent"], ["files", "Files"], ["chain", "After run"], ["lifecycle", "Startup / Wake"], ["link", "By hand"]];
const SCHEDULES = ["every 30m", "every 1h", "daily 09:00", "weekdays 09:00", "mon 09:00", "0 9 * * 1-5"];
// The {{…}} a prompt can use, by kind.
const FILLS = {
  schedule: null,
  board: "{{task}} (its ID, title, notes and file), {{task.id}} {{task.title}} {{task.file}}",
  agent: "{{agent}} (its tab) {{terminal}} {{space}}",
  files: "{{files}} (one per line) {{file}}",
  github: "{{pr}} or {{issue}} (number, title, author, link and description), {{number}} {{title}} {{url}} {{author}} {{repo}} {{labels}}",
  link: "{{text}} (what herdr-ws-run was given)",
  chain: "{{output}} (what the run before said) {{upstream}} {{outcome}}",
  lifecycle: null,
};

// --- Describe it: the drafter (drafter.js) ---

// Which installed CLIs draft, in turn: Settings > Automations' Drafter ("auto": the installed ones in order).
const drafterSetting = (fileSettings) => automationSetting(shared("workspaces.settings") ?? fileSettings, "drafter");

// Where a CLI is: on Herdr's PATH (its name is enough), else the path your login shell gives
// (only a line starting with "/" is taken, so whatever else a shell prints can't get in), as
// ws-status finds an agent's program. Kept for the screen's life; "" when it's on the PATH or nowhere.
const bins = new Map();
async function programBin(name) {
  if (bins.has(name)) return bins.get(name);
  let bin = "";
  const onPath = await exec("sh", ["-c", 'command -v "$1"', "sh", name], { timeout: 5000 }).catch(() => null);
  if (!String(onPath?.stdout ?? "").trim()) {
    for (const flags of ["-lc", "-lic"]) {
      const found = await exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" "$1" "command -v $2"', "sh", flags, name], { timeout: 15000 }).catch(() => null);
      bin = String(found?.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).pop() ?? "";
      if (bin) break;
    }
  }
  bins.set(name, bin);
  return bin;
}

// --- the file: front matter (autofacts.js: `key: value` lines and `key: |` blocks, others kept), then the body ---

function split(text) {
  const { entries, body } = splitFront(text ?? "");
  return { entries, body };
}
const field = (entries, key) => fieldValue(entries, key);
const yes = (v) => /^(true|yes|on|1)$/i.test(String(v ?? "").trim());
const no = (v) => /^(false|no|off|0)$/i.test(String(v ?? "").trim());
// One-line values on one line; check may span lines (a `check: |` block).
function automationText(old, fields, body) {
  const set = {};
  // true/false as they are (written plain: keep: true), the rest as text.
  for (const [k, v] of Object.entries(fields)) set[k] = v === null || v === "" ? null : typeof v === "boolean" ? v : k === "check" ? normCheck(v) : oneLine(v);
  return withFrontFields(old ?? "", set, body);
}
// The new keys as a file has them (lower case, "" when unset), and the fields as the editor shows them.
const low = (v) => String(v ?? "").trim().toLowerCase();
function snapOf(entries) {
  const mode = low(field(entries, "run")) === "shell" ? "shell" : "agent";
  return {
    run: mode, shell: mode === "shell" ? (SHELLS.includes(low(field(entries, "shell"))) ? low(field(entries, "shell")) : "bash") : "bash",
    terminal: mode === "shell" && yes(field(entries, "terminal")),
    timeout: String(field(entries, "timeout") ?? "").trim(), notify: low(field(entries, "notify")),
    missed: low(field(entries, "missed")), dedupe: low(field(entries, "dedupe")),
  };
}
const SHELL_DEFAULTS = { run: "agent", shell: "bash", terminal: false, timeout: "", notify: "", missed: "", dedupe: "" };
const NOTIFY_WORDS = { problems: "notifies on problems only", results: "notifies on results", all: "notifies on everything", none: "silent" };
const TIMEOUTS = [["", "Default"], ["none", "None"], ["2m", "2m"], ["5m", "5m"], ["20m", "20m"], ["1h", "1h"]];
const NOTIFIES = [["problems", "Problems only"], ["results", "Results"], ["all", "Everything"], ["none", "Silent"]];
const MISSES = [["run", "Run within 12h"], ["skip", "Skip"], ["always", "Always catch up"]];
// The $HERDR_… variables a script or a check gets, by what sets it off.
const VARS = {
  schedule: [], board: ["TASK_ID", "TASK_TITLE", "TASK_FILE"], agent: ["AGENT", "TERMINAL", "SPACE"], files: ["FILES", "FILE"],
  github: ["NUMBER", "TITLE", "REPO", "URL", "AUTHOR", "LABELS"], link: ["TEXT"], chain: ["OUTPUT", "UPSTREAM", "OUTCOME", "EXIT_CODE"], lifecycle: [],
};
// An example of each fill-in, for Preview: what a run of that kind would get.
const SAMPLES = {
  task: "T-12: An example task", "task.id": "T-12", "task.title": "An example task", "task.file": "tasks/T-12.md",
  agent: "claude", terminal: "t1", space: "Automations", files: "src/example.ts", file: "src/example.ts",
  pr: "#42 An example pull request", issue: "#42 An example issue", number: "42", title: "An example title", url: "https://github.com/owner/name/pull/42",
  author: "someone", repo: "owner/name", labels: "example", workflow: "CI", text: "(the text you'd pass)",
  output: "(what the automation before it printed)", upstream: "(the automation before it)", outcome: "done", exit_code: "0",
};
const fillIn = (text, vars) => String(text ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, k) => (vars[k] ?? all));

// A run's state now: its agent's status, else whether its terminal is still open.
function runState(r, ag, tm) {
  if (!r) return null;
  if (r.timedOut) return "timed out";
  if (r.status !== "started") return r.status;
  // A script's run: how it ended (a tab one is followed like an agent's until it ends).
  if (r.kind === "shell" && r.closed) return r.outcome === "failed" ? (r.exitCode != null ? `exit ${r.exitCode}` : "failed") : r.outcome === "nothing to do" ? "nothing to do" : `exit ${r.exitCode ?? 0}`;
  // The runner closed its tab once its agent was done (automations.js: finished).
  if (r.closed) return "finished, closed";
  const a = ag.find((x) => x.address === r.terminal);
  if (a) return STATE[a.status] ?? a.status;
  // Not an agent (or not one that reports): its tab is still open, or it's gone.
  // `stuck`: an agent that reported nothing a minute in, so it's asking something first.
  return tm.some((x) => x.address === r.terminal && x.state === "live") ? (r.stuck ? "needs you" : "open") : "closed";
}

// shared "workspaces.automations" with one changed or (null) gone, until the runner confirms it.
function updateShared(ws, name, record) {
  const all = JSON.parse(JSON.stringify(shared("workspaces.automations") ?? {}));
  const list = (all[ws] ??= []);
  const i = list.findIndex((x) => x.name === name);
  if (i >= 0) list.splice(i, 1);
  if (record) { list.push(record); list.sort((a, b) => a.name.localeCompare(b.name)); }
  setShared("workspaces.automations", all);
}

// shared "workspaces.automations.global" the same way: the global ones as their files have them.
function updateGlobal(name, record) {
  const list = JSON.parse(JSON.stringify(shared("workspaces.automations.global") ?? []));
  const i = list.findIndex((x) => x.name === name);
  if (i >= 0) list.splice(i, 1);
  if (record) { list.push(record); list.sort((a, b) => a.name.localeCompare(b.name)); }
  setShared("workspaces.automations.global", list);
}

function presetsFor(id) {
  const p = shared("workspaces.presets") ?? {};
  const own = (id && p.workspaces?.[id]) || [];
  return [...own, ...(p.global ?? []).filter((g) => !own.some((o) => o.name === g.name))].filter((x) => !x.error);
}

// The command an agent choice runs ("" is the board's agent): a preset's, an installed agent's, or the name.
function commandOf(def, agent) {
  const name = agent || boardAgentOf(def);
  const preset = presetsFor(def.id).find((p) => p.name === name);
  if (preset) return { name, preset, argv: words(preset.command ?? "") };
  const known = agentList().find((a) => a.key === name);
  return { name, preset: null, argv: known?.run ?? [name] };
}

export default class Automations extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // From the footer, the shown workspace; opened on its own (a missed-runs toast), the same.
    this.workspace = props()?.workspace ?? shared("workspaces.active") ?? null;
    // From a toast about one automation: that one ({ scope, name }, which the switcher looked up).
    // With no props: to a check that's waiting to be allowed, in the shown workspace first.
    let waiting = props()?.pick ?? null;
    if (!props()?.workspace) {
      const all = shared("workspaces.automations") ?? {};
      const ws = [this.workspace, ...Object.keys(all)].find((id) => id && (all[id] ?? []).some((a) => a.allowed === false));
      if (ws) { this.workspace = ws; const a = all[ws].find((x) => x.allowed === false); waiting = { scope: scopeOf(a), name: a.name }; }
    }
    this.nameIn = InputState.new({ value: "", placeholder: "daily-review" });
    this.descIn = InputState.new({ value: "", placeholder: "What it does, in one line" });
    this.whenIn = InputState.new({ value: "", placeholder: "weekdays 09:00" });
    this.checkIn = TextareaState.new({ value: "", rows: 3, placeholder: "Optional shell check before starting (one or more lines)" });
    this.bodyIn = TextareaState.new({ value: "", rows: 8, placeholder: "The agent's task: what to do and how to report back." });
    // Describe it: one box for a new automation, one for a change to what's there.
    this.askIn = TextareaState.new({ value: "", rows: 3, placeholder: "For example: every weekday at 9, list yesterday's merged PRs in api that still need docs" });
    this.changeIn = InputState.new({ value: "", placeholder: "Change it in words: make it hourly, only on Mondays, use opus, run it as a script…" });
    // Run now on a `link` one: the optional {{text}} for that run, Enter starts it.
    this.textIn = InputState.new({ value: "", placeholder: "Optional {{text}} for this run…" });
    this.textIn.on("submit", (_e, cx) => this.runNow(cx, true));
    this.modelIn = InputState.new({ value: "", placeholder: "another model, then Enter" });
    this.modelIn.on("submit", (_e, cx) => {
      const model = this.modelIn.value().trim();
      if (MODEL_WORD.test(model)) this.choice.model = model;
      this.modelIn.set_value("");
      cx.notify();
    });
    // The model box for a long list (more than SHORT_LIST): what's typed lists the matches
    // under it; findHi is the highlighted row (arrows move it, Enter picks it). findModels is
    // the list the editor last drew, so the keys pick from what's on screen.
    this.findIn = InputState.new({ value: "", placeholder: "Type part of a model's name" });
    this.findHi = 0;
    this.findModels = [];
    this.findScroll = ScrollHandle.new();
    this.findIn.on("change", (_e, cx) => { this.findHi = 0; this.findScroll.scroll_to_item(0); cx.notify(); });
    this.findIn.on("submit", (_e, cx) => { this.findSubmit(); cx.notify(); });
    for (const input of [this.askIn, this.changeIn]) input.on("submit", (e, cx) => { if (!e.shift) this.draft(cx); });
    // The editor follows the fields as you type; the one being typed in has the accent border.
    this.focusedIn = null;
    for (const input of [this.nameIn, this.descIn, this.whenIn, this.checkIn, this.bodyIn, this.askIn, this.changeIn, this.modelIn, this.textIn, this.findIn]) {
      input.on("change", (_e, cx) => cx.notify());
      input.on("focus", (_e, cx) => { this.focusedIn = input; cx.notify(); });
      input.on("blur", (_e, cx) => {
        if (this.focusedIn === input) this.focusedIn = null;
        // The model box closes empty: what was half typed isn't a choice.
        if (input === this.findIn) this.findSet("");
        cx.notify();
      });
    }
    this.sel = null;  // { scope: "workspace" | "global", name, isNew }
    this.snap = null; // what was loaded: { text, file, name, description, when, agent, model, effort, folder, check, card, enabled, off, offHere, body }
    // enabled: as its file says. offHere (a global one): off in this workspace, by its file's `off:` line.
    this.choice = { agent: "", model: "", effort: "", folder: "", card: false, keep: false, enabled: true, offHere: false, ...SHELL_DEFAULTS };
    this.details = false; // the fields shown, not just the summary
    this.manual = false;  // a new one being filled in by hand, before any draft
    this.drafting = null; // the selection a draft is for, while Claude works
    this.drafted = false; // the editor holds a draft not saved yet
    this.draftNote = null;
    this.draftError = null;
    this.trying = false; // Try it is running the check
    this.tried = null;   // { cmd, out } or { cmd, error }: what the check last said here
    this.tryingScript = false; // the script's Try it is running it
    this.triedScript = null;   // { script, folder, code, timedOut, durationMs, combined }: what it did here
    this.preview = null;       // Preview's panel: { sel, loading, check: { out } | { error } | null, text, vars, folder }
    this.askText = false;      // Run now on a `link` one: the {{text}} strip is open
    // The settings file as read when the screen opened, for the Drafter when Settings hasn't shared it.
    this.fileSettings = null;
    cx.spawn(async () => {
      const text = await readTextFile(`${home()}/${SETTINGS_FILE}`).catch(() => null);
      if (text !== null) { const p = parseSettings(text); if (!p.error) this.fileSettings = p; }
    });
    // The workspace's folders with a GitHub remote, for the GitHub chips and the drafter.
    this.ghRepos = [];
    // Codex's models, from its config.
    this.codexModels = [];
    cx.spawn(async (cx) => {
      this.codexModels = configModels(await readTextFile(`${home()}/.codex/config.toml`).catch(() => null));
      cx.notify();
    });
    // The models each agent lists (knobs.js): what was kept at once, then asked again
    // when that's a day old. Each lookup is its own task, so a slow CLI holds up nothing.
    this.listed = {}; // program -> models
    cx.spawn(async (cx) => {
      const all = await knownAgents().catch(() => null);
      if (Array.isArray(all) && all.length) { agentsSeen = all; cx.notify(); }
    });
    const io = { exec, readTextFile, writeTextFile, home };
    for (const program of listable()) {
      cx.spawn(async (cx) => {
        this.listed[program] = (await keptModels(io, program).catch(() => null))?.models ?? [];
        cx.notify();
        this.listed[program] = await listModels(io, program).catch(() => this.listed[program]);
        cx.notify();
      });
    }
    // The ready-made ones that come with this mod (starters/*.md): listed under the
    // others until one of that name exists, and opened as a new automation, filled in.
    this.starters = [];
    cx.spawn(async (cx) => {
      const dir = `${appHome()}/mods/ws-automations/starters`;
      let names = [];
      try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort(); } catch {}
      for (const n of names) {
        const text = await readTextFile(`${dir}/${n}`).catch(() => null);
        if (text === null) continue;
        const { entries, body } = split(text);
        const when = oneLine(field(entries, "when") ?? "");
        const trigger = parseWhen(when);
        if (!NAME.test(n.slice(0, -3)) || trigger.kind === "error") continue;
        this.starters.push({
          name: n.slice(0, -3), description: field(entries, "description") ?? "", when, summary: describe(trigger),
          agent: field(entries, "agent") ?? "", model: field(entries, "model") ?? "", effort: field(entries, "effort") ?? "",
          check: normCheck(field(entries, "check")), card: yes(field(entries, "card")), keep: yes(field(entries, "keep")), body: body.trim(),
          ...snapOf(entries),
        });
      }
      cx.notify();
    });
    const def = defOf(this.workspace);
    if (def && waiting) this.pick({ ...waiting, isNew: false }, null, cx);
    if (def) cx.spawn(async (cx) => {
      for (const f of folderChoices(def)) {
        const path = f.startsWith("/") || f.startsWith("~") ? f.replace(/^~/, home()) : `${def.root}/${f}`;
        const r = await exec("git", ["-C", path, "remote", "get-url", "origin"]).catch(() => null);
        const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(r?.stdout?.trim() ?? "");
        if (m) this.ghRepos.push({ folder: f, repo: m[1] });
      }
      cx.notify();
    });
  }

  def() { return defOf(this.workspace) ?? nowhere(); }
  none() { return !defOf(this.workspace); }
  // A new one shows only the Describe box until it's drafted or you choose to fill it in.
  blank() { return Boolean(this.sel?.isNew && !this.drafted && !this.manual); }
  askState() { return this.blank() ? this.askIn : this.changeIn; }
  // This workspace's: its own, then the global ones it doesn't replace. With no
  // workspace, the global ones as their files have them.
  list() {
    if (this.none()) return this.globals().map((g) => ({ ...g, everywhere: g.enabled }));
    return (shared("workspaces.automations") ?? {})[this.workspace] ?? [];
  }
  globals() { return shared("workspaces.automations.global") ?? []; }
  // The saved one the selection names. A global one this workspace replaces isn't in
  // its list: that comes as its file has it, marked `replaced`.
  lookup(sel) {
    if (!sel || sel.isNew) return null;
    const a = this.list().find((x) => x.name === sel.name && scopeOf(x) === sel.scope);
    if (a || sel.scope !== "global") return a ?? null;
    const g = this.globals().find((x) => x.name === sel.name);
    return g ? { ...g, replaced: true, everywhere: g.enabled, enabled: false, next: null, warning: null } : null;
  }
  same(a) { return Boolean(this.sel && !this.sel.isNew && this.sel.name === a.name && this.sel.scope === scopeOf(a)); }
  taken(scope) { return new Set((scope === "global" ? this.globals() : this.list().filter((a) => scopeOf(a) === "workspace")).map((a) => a.name)); }
  dirOf(scope) { return scope === "global" ? globalDir() : `${this.def()?.dir}/automations`; }
  globalPresets() { return (shared("workspaces.presets")?.global ?? []).filter((x) => !x.error); }

  dirty() {
    const s = this.snap, c = this.choice;
    if (!s) return false;
    return (this.sel?.isNew && this.nameIn.value().trim() !== s.name)
      || this.descIn.value() !== s.description || this.whenIn.value() !== s.when || this.bodyIn.value().trim() !== s.body
      || normCheck(this.checkIn.value()) !== s.check
      || c.agent !== s.agent || c.model !== s.model || c.effort !== s.effort || c.folder !== s.folder || c.card !== s.card || c.keep !== s.keep || c.enabled !== s.enabled
      || c.offHere !== (s.offHere ?? false)
      || Object.keys(SHELL_DEFAULTS).some((k) => c[k] !== (s[k] ?? SHELL_DEFAULTS[k]));
  }

  // Opens an automation (or a new one) in the editor; unsaved edits ask for a second click.
  pick(sel, fill, cx) {
    const key = JSON.stringify(sel);
    if (this.dirty() && this.pending !== key) {
      this.pending = key;
      this.error = "This automation has unsaved changes. Click again to discard them.";
      cx.notify();
      return;
    }
    this.pending = null;
    this.error = null;
    this.notice = null;
    this.confirming = false;
    this.stopping = null;
    this.drafting = null;
    this.drafted = false;
    this.draftNote = null;
    this.draftError = null;
    this.manual = false;
    this.tried = null;
    this.triedScript = null;
    this.preview = null;
    this.askText = false;
    this.textIn.set_value("");
    this.askIn.set_value("");
    this.changeIn.set_value("");
    // `cx` is passed in: the click's own is gone by the time the file has been read.
    const load = (snap, cx) => {
      this.sel = sel;
      this.snap = snap;
      this.nameIn.set_value(snap.name);
      this.descIn.set_value(snap.description);
      this.whenIn.set_value(snap.when);
      this.checkIn.set_value(snap.check);
      this.bodyIn.set_value(snap.body);
      this.choice = { agent: snap.agent, model: snap.model, effort: snap.effort, folder: snap.folder, card: snap.card, keep: snap.keep ?? false, enabled: snap.enabled, offHere: snap.offHere ?? false,
        ...Object.fromEntries(Object.keys(SHELL_DEFAULTS).map((k) => [k, snap[k] ?? SHELL_DEFAULTS[k]])) };
      cx.notify();
    };
    if (fill) return load({ text: null, file: null, off: [], offHere: false, ...SHELL_DEFAULTS, ...fill }, cx);
    const file = `${this.dirOf(sel.scope)}/${sel.name}.md`;
    cx.spawn(async (cx) => {
      const text = await readTextFile(file);
      if (text === null) { this.error = `${tilde(file)} is gone.`; cx.notify(); return; }
      const { entries, body } = split(text);
      const off = sel.scope === "global" ? namesIn(field(entries, "off")) : [];
      load({
        off, offHere: off.includes(this.workspace),
        text, file, name: sel.name, description: field(entries, "description") ?? "", when: field(entries, "when") ?? "",
        agent: field(entries, "agent") ?? "", model: field(entries, "model") ?? "", effort: field(entries, "effort") ?? "", folder: field(entries, "folder") ?? "",
        check: normCheck(field(entries, "check")),
        card: yes(field(entries, "card")), keep: yes(field(entries, "keep")), enabled: !no(field(entries, "enabled")),
        ...snapOf(entries),
        body: body.trim(),
      }, cx);
    });
  }

  fresh(cx) {
    const names = new Set([...this.list(), ...this.globals()].map((a) => a.name));
    let n = 1;
    while (names.has(`automation-${n}`)) n++;
    this.pick({ scope: this.none() ? "global" : "workspace", name: "", isNew: true }, {
      name: `automation-${n}`, description: "", when: "weekdays 09:00", agent: "", model: "", effort: "", folder: "", check: "", card: false, keep: false, enabled: true, body: "",
    }, cx);
    this.askIn.focus();
  }

  // A ready-made one, as a new automation with its fields filled in. Nothing is
  // written until Create. An agent this workspace doesn't have is left out (the board's agent).
  useStarter(s, cx) {
    const def = this.def();
    const known = !s.agent || presetsFor(def.id).some((p) => p.name === s.agent) || installedAgents().some((a) => a.key === s.agent);
    this.pick({ scope: this.none() ? "global" : "workspace", name: "", isNew: true, starter: s.name }, {
      name: s.name, description: s.description, when: s.when, agent: known ? s.agent : "", model: known ? s.model : "", effort: known ? s.effort : "",
      folder: "", check: s.check, card: s.card, keep: s.keep ?? false, enabled: true, body: s.body,
      ...Object.fromEntries(Object.keys(SHELL_DEFAULTS).map((k) => [k, s[k] ?? SHELL_DEFAULTS[k]])),
    }, cx);
    // Unsaved changes elsewhere asked for a second click first.
    if (this.sel?.starter !== s.name) return;
    this.manual = true;
    if (!known) this.notice = `It names the "${s.agent}" preset, which isn't here, so it starts the board's agent. Details has the agents you can pick.`;
  }

  // --- Describe it ---

  // What the drafter is told: the workspace, what it offers, the time, the automation so far, and the ask.
  request(def, ask, current, retry) {
    const presets = presetsFor(def.id);
    const d = new Date();
    const lines = [
      ...(def.none ? ["No workspace is shown, so this one is for every workspace: its scope is global. It runs in each workspace's root, or in a folder named from that root."] : [
        `Workspace: ${def.name} (id ${def.id}). Root: ${def.root}`,
        `Folders, from the root: ${folderChoices(def).join(", ") || "none"}`,
        `GitHub repos: ${this.ghRepos.map((g) => `${g.folder} is ${g.repo}`).join("; ") || "none found"}`,
      ]),
      `Board columns: ${columnsOf(def).join(", ")}. The board's agent: ${boardAgentOf(def)}`,
      `Presets: ${presets.map((p) => `${p.name} (${p.scope === "global" ? "global" : "this workspace's"}; runs: ${p.command ?? "?"})${p.description ? `: ${p.description}` : ""}`).join("; ") || "none"}`,
      `Installed agents: ${installedAgents().map((a) => (programOf(a.run) === a.key ? a.key : `${a.key} (runs ${programOf(a.run)})`)).join(", ") || "claude"}`,
      `Models and effort, by program:\n${knobsText(this.listed)}`,
      `Names taken: ${[...new Set([...this.list(), ...this.globals()].map((a) => a.name))].join(", ") || "none"}`,
      `Scope now: ${this.sel.scope} (${this.sel.scope === "global" ? "every workspace" : "this workspace only"})${this.sel.isNew ? "" : ". It's saved, so the scope stays as it is"}`,
      `Automations here (for automation done|failed <name>): ${[...new Set(this.list().map((a) => a.name))].join(", ") || "none"}`,
      `Now: ${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}, this computer's clock`,
    ];
    if (current) lines.push("", "The current automation (change only what's asked):", JSON.stringify(current, null, 2));
    lines.push("", "What the person wants:", ask);
    if (retry) lines.push("", `Your last draft's when line "${retry.when}" can't be read: ${retry.problem} Answer again, with one that can.`);
    return lines.join("\n");
  }

  // The CLIs that may draft, in turn: Settings > Automations' Drafter, else the installed ones in order.
  drafters() {
    return pickDrafters(drafterSetting(this.fileSettings), installedAgents().map((a) => a.key));
  }

  // One CLI's draft. Its program as Herdr knows it, else where your shell finds it (programBin):
  // Herdr's own PATH often lacks ~/.bun/bin and the like. codex reads the answer's shape from a
  // file, written next to the runner's.
  async askDrafter(cli, text) {
    const known = agentList().find((a) => a.key === cli);
    const prog = Array.isArray(known?.run) ? String(known.run[0] ?? "") : "";
    const bin = prog.split("/").pop() === cli && prog.includes("/") ? prog : await programBin(cli);
    let schemaPath = "";
    if (cli === "codex") {
      schemaPath = `${home()}/.herdr/runner/drafter-schema.json`;
      const w = await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf %s "$2" > "$1"', "sh", schemaPath, JSON.stringify(SCHEMA)]).catch((e) => ({ code: 1, stderr: message(e) }));
      if (w.code !== 0) throw new Error(`couldn't write the answer's shape for codex (${String(w.stderr ?? "").trim()})`);
    }
    const c = buildDraftCommand(cli, { prompt: text, guide: GUIDE, schemaPath, bin });
    const r = await exec(c.bin, c.args, { cwd: "/tmp", timeout: DRAFT_TIMEOUT })
      .catch((e) => (/no such file|not found|os error 2/i.test(message(e)) ? { code: 127, stdout: "", stderr: `${cli} isn't installed where Herdr or your shell can find it` } : Promise.reject(e)));
    return parseDraftOutput(cli, r);
  }

  // A draft from the first CLI that gives one; when none does, the first one's reason.
  async askDraft(text) {
    let first = null;
    for (const cli of this.drafters()) {
      this.drafter = cli;
      try { return await this.askDrafter(cli, text); }
      catch (e) { first ??= `${DRAFTER_NAMES[cli] ?? cli}: ${message(e)}`; }
    }
    throw new Error(first ?? "no agent CLI to draft with");
  }

  // The fields as they are in the editor, for a change in words.
  current() {
    const c = this.choice;
    return {
      scope: this.sel.scope, name: this.sel.isNew ? this.nameIn.value().trim() : this.sel.name, description: this.descIn.value(), when: this.whenIn.value(),
      run: c.run, shell: c.shell, terminal: c.terminal,
      agent: c.agent, model: c.model, effort: c.effort, folder: c.folder, check: normCheck(this.checkIn.value()), dedupe: c.dedupe,
      timeout: c.timeout, notify: c.notify, missed: c.missed, card: c.card, keep: c.keep, prompt: this.bodyIn.value().trim(),
    };
  }

  draft(cx) {
    const def = this.def(), sel = this.sel;
    const input = this.askState();
    const ask = input.value().trim();
    if (!def || !sel || !ask || this.drafting) return;
    // A new one starts from nothing until it has been drafted or filled in; after that, a draft changes it.
    const current = this.blank() ? null : this.current();
    this.drafting = sel;
    this.draftError = null;
    this.draftNote = null;
    this.error = null;
    this.notice = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        let d = await this.askDraft(this.request(def, ask, current, null));
        const w = parseWhen(oneLine(d.when));
        if (w.kind === "error") d = await this.askDraft(this.request(def, ask, current, { when: d.when, problem: w.error }));
        // Opened another one meanwhile: this draft was for the one before.
        if (this.sel !== sel) return;
        this.apply(def, d);
        this.drafted = true;
        this.draftNote = oneLine(d.note) || null;
        input.set_value("");
      } catch (e) {
        if (this.sel === sel) this.draftError = `Couldn't draft it: ${message(e)}`;
      } finally {
        if (this.drafting === sel) this.drafting = null;
        cx.notify();
      }
    });
  }

  // A draft into the editor, kept to what this workspace has: anything else stays as it was.
  apply(def, d) {
    const s = (v) => (typeof v === "string" ? v.trim() : "");
    // In place: the draft belongs to this selection object.
    if (this.sel.isNew && (d.scope === "global" || d.scope === "workspace")) this.sel.scope = def.none ? "global" : d.scope;
    const global = this.sel.scope === "global";
    if (this.sel.isNew) {
      const base = s(d.name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 60);
      if (NAME.test(base)) {
        const taken = new Set([...this.list(), ...this.globals()].map((a) => a.name));
        let name = base, n = 2;
        while (taken.has(name)) name = `${base}-${n++}`;
        this.nameIn.set_value(name);
      }
    }
    this.descIn.set_value(oneLine(d.description));
    if (s(d.when)) this.whenIn.set_value(oneLine(d.when));
    if (s(d.prompt)) this.bodyIn.set_value(s(d.prompt));
    // A draft's check is what Herdr will run by itself: "What it does" shows it before any save.
    this.checkIn.set_value(normCheck(d.check).slice(0, 2000));
    this.tried = null;
    this.triedScript = null;
    this.preview = null;
    const c = this.choice;
    const agent = s(d.agent);
    // A global one runs in every workspace: only what they all have (global presets, a folder from the root).
    const okAgent = !agent || (global ? this.globalPresets() : presetsFor(def.id)).some((p) => p.name === agent) || installedAgents().some((a) => a.key === agent) ? agent : global ? "" : c.agent;
    const folder = s(d.folder);
    const okFolder = global ? (/^[/~]/.test(folder) ? "" : folder) : !folder || folderChoices(def).includes(folder) ? folder : c.folder;
    const knobs = KNOBS[programOf(commandOf(def, okAgent).argv)];
    const model = knobs && MODEL_WORD.test(s(d.model)) ? s(d.model) : "";
    const effort = knobs?.effort && knobs.effort.levels.includes(s(d.effort)) ? s(d.effort) : "";
    // A script: no agent, model, effort or card. Each new key only as one of its values, else as it was.
    const shell = s(d.run) === "shell";
    const one = (v, list, was) => (list.includes(s(v).toLowerCase()) ? s(v).toLowerCase() : was);
    const timeout = s(d.timeout) && parseDuration(s(d.timeout)) !== null ? s(d.timeout) : s(d.timeout) ? c.timeout : "";
    this.choice = {
      ...c, agent: shell ? "" : okAgent, model: shell ? "" : model, effort: shell ? "" : effort, folder: okFolder, card: !shell && d.card === true, keep: d.keep === true,
      run: shell ? "shell" : "agent", shell: shell ? one(d.shell, SHELLS, "bash") : "bash", terminal: shell && d.terminal === true,
      timeout, notify: one(d.notify, ["", "problems", "results", "all", "none"], c.notify),
      missed: one(d.missed, ["", "run", "skip", "always"], c.missed), dedupe: one(d.dedupe, ["", "changed", "always"], c.dedupe),
    };
  }

  save(cx) {
    const sel = this.sel, def = this.def();
    if (!sel || !def || this.busy) return;
    const name = sel.isNew ? this.nameIn.value().trim() : sel.name;
    const when = oneLine(this.whenIn.value());
    const trigger = parseWhen(when);
    const showDetails = (why) => { this.error = why; this.details = true; cx.notify(); };
    if (!NAME.test(name)) return showDetails("A name is letters, digits, dots, dashes or underscores, starting with a letter or digit.");
    const scope = sel.scope, global = scope === "global";
    if (sel.isNew && this.taken(scope).has(name)) return showDetails(`There's already an automation called "${name}"${global ? " for every workspace" : ` in ${def.name}`}.`);
    if (trigger.kind === "error") return showDetails(trigger.error);
    const c = this.choice;
    const shell = c.run === "shell";
    const file = `${this.dirOf(scope)}/${name}.md`;
    const body = this.bodyIn.value();
    const check = normCheck(this.checkIn.value());
    const script = shell ? normScript(body) : null;
    if (shell && !script) return showDetails("A shell automation runs its script: write it in the Script box.");
    if (c.timeout && parseDuration(c.timeout) === null) return showDetails(`"${c.timeout}" isn't a length of time: 30s, 2m, 1h or none.`);
    // A global one's `off:` line: the other workspaces as they were, and this one as chosen.
    const off = global ? [...(this.snap.off ?? []).filter((w) => w !== def.id), ...(c.offHere ? [def.id] : [])] : [];
    // A script has no agent, model, effort or card: those lines go.
    const text = automationText(sel.isNew ? null : this.snap.text, {
      description: this.descIn.value(), when, run: shell ? "shell" : null, shell: shell ? c.shell : null, terminal: shell && c.terminal ? true : null,
      agent: shell ? null : c.agent, model: shell ? null : c.model, effort: shell ? null : c.effort, folder: c.folder,
      check, dedupe: c.dedupe, timeout: c.timeout, notify: c.notify, missed: c.missed,
      card: !shell && c.card ? true : null, keep: c.keep ? true : null, enabled: c.enabled ? null : false, ...(global ? { off: off.join(", ") } : {}),
    }, body);
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // You've read it here and saved it: that check and script may run. Said first, so the runner knows when it reads the file.
        if (check || script) setShared("workspaces.automation.allow", { workspace: global ? "*" : def.id, name, check: check || null, script, at: Date.now() });
        await writeTextFile(file, text, sel.isNew ? null : this.snap.text);
        const record = {
          name, file, scope, description: oneLine(this.descIn.value()), when, trigger, summary: describe(trigger),
          agent: shell ? null : c.agent || null, model: shell ? null : c.model || null, effort: shell ? null : c.effort || null, folder: c.folder || null, check: check || null,
          card: !shell && c.card, keep: c.keep, enabled: c.enabled,
          run: c.run, shell: shell ? c.shell : null, terminal: shell && c.terminal, timeout: c.timeout || null, notify: c.notify || null, missed: c.missed || "run", dedupe: c.dedupe || "changed",
          body: normScript(body), error: null, next: null, warning: null, allowed: true, checkAllowed: true, scriptAllowed: true,
        };
        record.timeoutMs = effectiveTimeout(record);
        record.notifyLevel = effectiveNotify(record);
        if (global) {
          updateGlobal(name, { ...record, off });
          // Not where this workspace has its own of that name: that one runs here.
          if (!def.none && !this.taken("workspace").has(name)) updateShared(def.id, name, { ...record, off, everywhere: c.enabled, enabled: c.enabled && !c.offHere });
        } else updateShared(def.id, name, record);
        this.sel = { scope, name, isNew: false };
        this.snap = { text, file, name, description: this.descIn.value(), when: this.whenIn.value(), ...c, off, check, body: body.trim() };
        this.preview = null;
        this.drafted = false;
        this.draftNote = null;
        this.error = null;
        const others = off.filter((w) => w !== def.id).map((w) => defOf(w)?.name ?? w);
        this.notice = !c.enabled ? `Saved. It's off${global ? " in every workspace" : ""}: only Run now and herdr-ws-run start it.`
          : !global ? "Saved. It's on."
          : c.offHere ? `Saved. It's off in ${def.name}, and on in the other workspaces${others.length ? ` but ${others.join(", ")}` : ""}.`
          : `Saved. It's on in every workspace${others.length ? ` but ${others.join(", ")}` : ""}.`;
      } catch (e) {
        this.error = sel.isNew
          ? `Couldn't save: an automation called "${name}" may already be there (${message(e)}).`
          : `Couldn't save: it changed on disk since you opened it. Open it again. (${message(e)})`;
      }
      this.busy = false;
      cx.notify();
    });
  }

  remove(cx) {
    const sel = this.sel;
    if (!sel || sel.isNew || this.busy) return;
    if (!this.confirming) { this.confirming = true; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", TRASH, "sh", this.snap.file, `${home()}/.herdr/workspaces/.trash`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        if (sel.scope === "global") updateGlobal(sel.name, null);
        if (!this.none() && (sel.scope !== "global" || !this.taken("workspace").has(sel.name))) updateShared(this.workspace, sel.name, null);
        notify({ title: `Deleted the ${sel.name} automation${sel.scope === "global" ? " from every workspace" : ""}`, body: r.stdout.trim() === "Trash" ? "Its file is in the Trash." : `Its file is in ${tilde(r.stdout.trim())}.`, level: "success" });
        this.sel = null;
        this.snap = null;
      } catch (e) {
        this.error = `Couldn't delete it: ${message(e)}`;
      }
      this.busy = false;
      this.confirming = false;
      cx.notify();
    });
  }

  // A row's switch: turns it on or off at once, rewriting only its `enabled` line.
  // A global one's row is about this workspace: it rewrites the `off:` line. One that's
  // off everywhere, turned on here, comes on here alone (off in each other workspace).
  // With no workspace shown, a global one's row is about them all: its `enabled` line.
  toggle(a, cx) {
    const open = this.same(a);
    if (open && this.dirty()) { this.error = "Save or discard this automation's changes first."; cx.notify(); return; }
    const none = this.none();
    const on = !a.enabled, ws = this.workspace, global = scopeOf(a) === "global" && !none;
    const { everywhere: _e, ...asFiled } = a;
    const show = (enabled) => (none ? updateGlobal(a.name, { ...asFiled, enabled })
      : updateShared(ws, a.name, enabled === a.enabled ? a : { ...a, enabled, next: enabled ? a.next : null, ...(global && enabled ? { everywhere: true } : {}) }));
    show(on);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const old = await readTextFile(a.file);
        if (old === null) throw new Error(`${tilde(a.file)} is gone.`);
        let fields = { enabled: on ? null : "false" }, off = [];
        if (global) {
          const { entries } = split(old);
          const was = namesIn(field(entries, "off")).filter((w) => w !== ws);
          const everywhere = !no(field(entries, "enabled"));
          off = !on ? [...was, ws] : everywhere ? was : (shared("workspaces.defs") ?? []).map((d) => d.id).filter((w) => w !== ws);
          fields = { ...(on ? { enabled: null } : {}), off: off.join(", ") };
        }
        // Its other lines and its body as they are.
        const text = automationText(old, fields, undefined);
        await writeTextFile(a.file, text, old);
        if (this.same(a) && this.snap) {
          this.snap = global ? { ...this.snap, text, enabled: true, off, offHere: !on } : { ...this.snap, text, enabled: on };
          if (global) { this.choice.enabled = true; this.choice.offHere = !on; } else this.choice.enabled = on;
        }
      } catch (e) {
        show(a.enabled);
        notify({ title: `Couldn't turn ${a.name} ${on ? "on" : "off"}`, body: message(e), level: "error" });
      }
      cx.notify();
    });
  }

  // Stops a run that's working, waiting on you or (a program) still open, by closing its tab; the first click asks.
  stop(r, cx) {
    if (this.stopping !== r.id) { this.stopping = r.id; cx.notify(); return; }
    this.stopping = null;
    run("tab.close", { id: r.tab, confirmed: true });
    cx.notify();
  }

  // Allows the saved check and script as they're shown: the runner may run them from now on.
  allow(cx) {
    const def = this.def(), sel = this.sel;
    const saved = this.lookup(sel);
    if (!def || !saved) return;
    const check = saved.checkAllowed === false && saved.check ? saved.check : null;
    const script = saved.run === "shell" && saved.scriptAllowed === false && saved.body ? saved.body : null;
    if (!check && !script && saved.allowed !== false) return;
    const global = scopeOf(saved) === "global";
    setShared("workspaces.automation.allow", { workspace: global ? "*" : def.id, name: saved.name, check: check ?? saved.check ?? null, script, at: Date.now() });
    const ok = { allowed: true, checkAllowed: true, scriptAllowed: true };
    if (!saved.replaced && !def.none) updateShared(def.id, saved.name, { ...saved, ...ok, warning: null });
    if (global) { const g = this.globals().find((x) => x.name === saved.name); if (g) updateGlobal(g.name, { ...g, ...ok }); }
    this.error = null;
    this.notice = script && check ? "Allowed. Its check and its script run from now on." : script ? "Allowed. Its script runs from now on." : "Allowed. Its check runs before each start from now on.";
    cx.notify();
  }

  // The folder a run would use: its own, else (github) the repo's, else the root.
  folderNow(def) {
    const w = parseWhen(this.whenIn.value());
    const repo = w.kind === "github" ? (w.repo === "*" ? this.ghRepos[0] : this.ghRepos.find((g) => g.folder === w.repo || g.repo === w.repo))?.folder : null;
    const f = this.choice.folder || repo || "";
    return !f ? def.root : f.startsWith("/") || f.startsWith("~") ? f.replace(/^~/, home()) : `${def.root}/${f}`;
  }

  // The fill-ins a run gets, as the runner makes them; with samples, examples of what sets it off.
  runVars(def, sel, folder, event, samples) {
    const d = new Date();
    const w = parseWhen(this.whenIn.value());
    const kind = w.kind === "error" ? null : kindOf(w);
    const own = !samples || !kind ? {} : Object.fromEntries(Object.entries(SAMPLES).filter(([k]) => {
      const key = k === "exit_code" ? "EXIT_CODE" : k.replace(".", "_").toUpperCase();
      return (VARS[kind] ?? []).includes(key) || (kind === "github" && (k === "pr" || k === "issue" ? k === w.what : k === "workflow" && w.what === "ci"));
    }));
    return {
      workspace: def.name, automation: sel.isNew ? this.nameIn.value().trim() : sel.name, folder: tilde(folder), event,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, ...own,
    };
  }

  // The saved automation's secret_env, as the runner hands it over (check.js: runCheck, runShellScript):
  // null without any. A new one has none until it's saved (the field is only in its file).
  secretOf(def, sel) {
    const pairs = this.lookup(sel)?.secretEnv ?? [];
    return pairs.length ? { cli: `${appHome()}/mods/ws-switcher/bin/herdr-ws-secret`, pairs, workspace: def.id, automation: `${def.id}/${sel.name}` } : null;
  }

  // Runs the check as written in the box, here and now, in the folder a run would
  // use. Nothing is set off, so the variables for what did (a PR's number) are empty.
  tryCheck(cx) {
    const def = this.def(), sel = this.sel;
    const cmd = normCheck(this.checkIn.value());
    if (!def || !sel || !cmd || this.trying) return;
    const folder = this.folderNow(def);
    this.trying = true;
    this.tried = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const res = await runCheck(exec, cmd, folder, { ...this.runVars(def, sel, folder, "Tried from the Automations screen", false), folder, workspace_id: def.id }, this.secretOf(def, sel));
      this.trying = false;
      if (this.sel === sel) this.tried = { cmd, folder, ...res };
      cx.notify();
    });
  }

  // Try it beside a script: runs the script as written in the box, here and now, with its shell,
  // folder and timeout, and shows how it ended and the start of what it printed. It's your click on
  // what you can read, so it runs whether or not it has been allowed.
  tryScript(cx) {
    const def = this.def(), sel = this.sel, c = this.choice;
    const script = normScript(this.bodyIn.value());
    if (!def || !sel || !script || this.tryingScript) return;
    const folder = this.folderNow(def);
    this.tryingScript = true;
    this.triedScript = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const vars = { ...this.runVars(def, sel, folder, "Tried from the Automations screen", false), folder, workspace_id: def.id };
      const res = await runShellScript(exec, { shell: c.shell, script, folder, vars, timeoutMs: effectiveTimeout({ run: "shell", timeout: c.timeout }), secret: this.secretOf(def, sel) });
      this.tryingScript = false;
      if (this.sel === sel) this.triedScript = { script, folder, ...res };
      cx.notify();
    });
  }

  // Preview: what a run would get, with nothing started. Runs the check (unless it waits to be
  // allowed), then fills in the prompt as the runner would, or lists the script's variables.
  previewRun(cx) {
    const def = this.def(), sel = this.sel, c = this.choice;
    if (!def || !sel || def.none) return;
    const saved = this.lookup(sel);
    const check = normCheck(this.checkIn.value());
    const waits = Boolean(check) && saved?.checkAllowed === false && check === saved.check;
    const folder = this.folderNow(def);
    const w = parseWhen(this.whenIn.value());
    const event = isSchedule(w) ? "A preview from the Automations screen" : "A preview from the Automations screen, with example values for what sets it off";
    const vars = this.runVars(def, sel, folder, event, true);
    const shell = c.run === "shell";
    const body = shell ? normScript(this.bodyIn.value()) : this.bodyIn.value().replace(/<!--[\s\S]*?-->/g, "").trim();
    const show = (res) => {
      const all = { ...vars, ...(res?.out !== undefined ? { check: res.out } : {}) };
      let text = body;
      if (!shell) {
        text = fillIn(body, all);
        // As the runner does: what set it off at the end, then the check's output, unless the prompt places them.
        // (Startup, wake and a Run now with no text don't get it: nothing is said to have set them off.)
        if (!isSchedule(w) && w.kind !== "error" && w.kind !== "lifecycle" && w.kind !== "link" && !/\{\{\s*(event|text|task|task\.\w+|files?|agent|terminal|space|pr|issue|number|title|url|author|repo|labels|output|upstream|workflow)\s*\}\}/.test(body)) text = [text, event].filter(Boolean).join("\n\n");
        if (all.check && !/\{\{\s*check\s*\}\}/.test(body)) text = [text, `Before you were started, Herdr ran this automation's check (\`${check}\`). It printed:\n${all.check}`].filter(Boolean).join("\n\n");
      }
      return { sel, loading: false, shell, check: !check ? null : waits ? { waits: true } : res, text, env: shell ? checkEnv({ ...all, folder, workspace_id: def.id }) : [], folder, secrets: this.secretOf(def, sel)?.pairs ?? [] };
    };
    if (!check || waits) { this.preview = show(null); cx.notify(); return; }
    this.preview = { sel, loading: true };
    cx.notify();
    cx.spawn(async (cx) => {
      const res = await runCheck(exec, check, folder, { ...vars, folder, workspace_id: def.id }, this.secretOf(def, sel));
      if (this.sel === sel && this.preview?.sel === sel) this.preview = show(res);
      cx.notify();
    });
  }

  // Opens History on a run (the bell's "open" ask: the switcher opens History and shows the run).
  openLog(r) {
    const now = Date.now(), q = shared("workspaces.notifications.act");
    const ask = { action: "open", target: { kind: "history", ws: r.ws, runId: r.id }, id: `${now}-automations-${Math.random().toString(36).slice(2, 7)}`, at: now };
    setShared("workspaces.notifications.act", [...(Array.isArray(q) ? q : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < 15000), ask].slice(-32));
    closeOverlay(props().overlay);
  }

  // A global one, as a new one of the same name for this workspace only: saved, it
  // replaces the global one here.
  copyHere(cx) {
    const s = this.snap;
    if (!s || !this.sel || this.sel.scope !== "global") return;
    this.pick({ scope: "workspace", name: "", isNew: true }, {
      name: s.name, description: s.description, when: s.when, agent: s.agent, model: s.model, effort: s.effort, folder: s.folder,
      check: s.check, card: s.card, keep: s.keep ?? false, enabled: true, body: s.body,
      ...Object.fromEntries(Object.keys(SHELL_DEFAULTS).map((k) => [k, s[k] ?? SHELL_DEFAULTS[k]])),
    }, cx);
    this.manual = true;
  }

  // The switcher's sidebar copy starts it: this dialog's tasks end when it closes.
  // go: from the {{text}} strip (a `link` one), which the first click opens.
  runNow(cx, go = false) {
    if (!this.sel || this.sel.isNew || this.none()) return;
    if (this.dirty()) { this.error = "Save it first: Run now starts what's saved."; cx.notify(); return; }
    const saved = this.lookup(this.sel);
    if (saved?.replaced) { this.error = `${this.def()?.name ?? "This workspace"} has its own "${saved.name}", which is the one that runs here. Open that one to run it.`; cx.notify(); return; }
    if (saved?.allowed === false) { this.error = `Allow its ${saved.scriptAllowed === false ? "script" : "check"} first: it doesn't start until then.`; cx.notify(); return; }
    if (saved?.trigger?.kind === "link" && !go) { this.askText = true; this.textIn.focus(); cx.notify(); return; }
    const text = go ? this.textIn.value().trim() : "";
    setShared("workspaces.automation.run", { workspace: this.workspace, name: this.sel.name, ...(text ? { text } : {}), at: Date.now() });
    this.askText = false;
    this.textIn.set_value("");
    this.error = null;
    const shell = saved?.run === "shell";
    this.notice = shell ? (saved.terminal ? "Running its script in a tab in the Automations space…" : "Running its script now. Recent runs and History show how it went.")
      : this.snap?.check ? "Starting it as a tab in the Automations space, whatever its check says…" : "Starting it as a tab in the Automations space…";
    cx.notify();
  }

  goTo(r) {
    closeOverlay(props().overlay);
    run("space.select", { id: r.space });
    run("tab.select", { id: r.tab });
  }


  // A row picked in the model box: a provider narrows the box to its models; a model, or
  // what was typed (when it's a model-like word), is set and the box closes.
  findPick(r) {
    if (r.kind === "provider") return this.findSet(`${r.provider}/`);
    const model = r.kind === "model" ? r.id : r.text;
    if (MODEL_WORD.test(model)) this.choice.model = model;
    this.findSet("");
    this.findIn.blur();
  }
  // The model box's text set from here (set_value fires no change): the cursor at its
  // end and the highlight back on the first row.
  findSet(text) {
    this.findIn.set_value(text);
    this.findIn.set_selected_range({ start: text.length, end: text.length });
    this.findHi = 0;
    this.findScroll.scroll_to_item(0);
  }
  // Enter in the model box: the highlighted row.
  findSubmit() {
    const { rows } = typeahead(this.findModels, this.findIn.value());
    const r = rows[Math.min(this.findHi, rows.length - 1)];
    if (r) this.findPick(r);
  }
  // Keys while the model box is open: arrows move the highlight, Tab fills in the
  // highlighted name, Escape closes it (and the dialog stays). Enter is the box's submit.
  findKey(e, cx) {
    if (this.focusedIn !== this.findIn) return;
    const { rows } = typeahead(this.findModels, this.findIn.value());
    const r = rows[Math.min(this.findHi, rows.length - 1)];
    if (e.key === "down" || e.key === "up") {
      this.findHi = Math.max(0, Math.min(rows.length - 1, Math.min(this.findHi, rows.length - 1) + (e.key === "down" ? 1 : -1)));
      this.findScroll.scroll_to_item(this.findHi);
    } else if (e.key === "tab" && r && r.kind !== "typed") {
      this.findSet(r.kind === "provider" ? `${r.provider}/` : r.id);
    } else if (e.key === "escape") {
      this.findSet("");
      this.findIn.blur();
    } else return;
    cx.stop_propagation();
    cx.notify();
  }
  // The model box (knobs.js typeahead): the model set shows in it, lit like a chosen chip,
  // with × back to Default. Clicking it or typing opens the list under it: the providers
  // while nothing is typed, then the models with every word typed, the provider on the
  // right; one row to use what was typed when nothing matches. `who` names the agent.
  modelFind(t, id, models, model, who, clear) {
    const open = this.focusedIn === this.findIn;
    const typed = this.findIn.value();
    const { rows, words: marks, matches } = typeahead(models, typed);
    const hi = Math.min(this.findHi, rows.length - 1);
    const W = 360;
    const box = h_flex().id(`${id}-find`).w(W).h(26).relative()
      .on_key_down((e, cx) => this.findKey(e, cx))
      .child(Input.new(this.findIn).w_full().h(26).px(10).rounded(13).border_1().border_color(open ? t.accent : t.input).bg(t.background)
        .text_size(12).text_color(t.foreground))
      // Set and closed: the model over the box; a click opens it (the box takes the keyboard).
      // (The theme's selected color lets what's under it show, so it sits on the box's own.)
      .when(!open && Boolean(model), (el) => el.child(div().id(`${id}-find-set`).absolute().inset_0().rounded(13).bg(t.background).cursor_text()
        .on_click((_e, cx) => { this.findIn.focus(); cx.notify(); })
        .child(h_flex().size_full().px(10).gap(6).items_center().rounded(13).border_1().border_color(t.accent).bg(t.selected)
          .text_size(12).text_color(t.foreground)
          .child(div().flex_1().min_w(0).truncate().child(model))
          .child(div().id(`${id}-find-clear`).size(18).flex_none().flex().items_center().justify_center().rounded(9).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Back to Default")
            .on_click((_e, cx) => { cx.stop_propagation(); clear(); cx.notify(); }).child("×")))));
    const row = (r, i) => h_flex().id(`${id}-find-${i}`).h(28).flex_none().px(8).gap(10).items_center().rounded(6).cursor_pointer()
      .when(i === hi, (el) => el.bg(t.hover))
      .text_size(12).text_color(i === hi || r.kind !== "model" ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.findPick(r); cx.notify(); })
      .when(r.kind === "provider", (el) => el
        .child(div().flex_1().min_w(0).truncate().child(`${r.provider}/`))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`${r.count} models`)))
      .when(r.kind === "typed", (el) => el
        .child(div().flex_1().min_w(0).truncate().child(`Use “${r.text}” as typed`))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`not in ${who}'s list`)))
      .when(r.kind === "model", (el) => el
        .child(div().w(12).flex_none().text_size(11).text_color(t.accent).child(r.id === model ? "✓" : ""))
        .child(h_flex().flex_1().min_w(0).overflow_hidden()
          .children(markSegments(r.name, marks).map((g) => div().flex_none().when(g.on, (d) => d.text_color(t.foreground).font_semibold()).child(g.text))))
        .when(Boolean(r.provider), (d) => d.child(div().flex_none().text_size(11.5).text_color(t.dim).child(r.provider))));
    const providers = rows.filter((r) => r.kind === "provider").length;
    const count = !typed.trim() ? (providers ? `${models.length} models from ${providers} providers` : `${models.length} models`)
      : matches ? `${matches} match${matches === 1 ? "" : "es"}` : "No match";
    const list = v_flex().id(`${id}-find-list`).w(W).mt(6).rounded(8).shadow_md().border_1().border_color(t.input).bg(t.popover).text_color(t.foreground)
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().id(`${id}-find-rows`).max_h(8 * 28 + 8).overflow_y_scrollbar().track_scroll(this.findScroll).p(4)
        .children(rows.map(row)))
      .child(h_flex().h(24).flex_none().px(10).gap(12).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().flex_1().child(count))
        .child(div().flex_none().child("↑↓ move   ↵ pick   esc close")));
    return Popup.new(`${id}-find-popup`, box).when(open, (el) => el.content(list));
  }

  render() {
    const t = theme();
    const def = this.def();
    const shell = v_flex().id("automations").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      })
      .child(h_flex().h(50).flex_none().px(18).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/ws-automations/automations.svg").size(16).text_color(t.muted))
        .child(div().text_size(15).font_semibold().child("Automations"))
        .child(div().text_size(12.5).text_color(t.dim).child(def.none ? "for every workspace" : `for ${def.name}`))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("Esc")));
    const autos = this.list();
    const own = autos.filter((a) => scopeOf(a) === "workspace");
    // Those for every workspace: the ones that run here, then the ones this workspace replaces.
    const forAll = [...autos.filter((a) => scopeOf(a) === "global"),
      ...this.globals().filter((g) => own.some((o) => o.name === g.name)).map((g) => ({ ...g, replaced: true, everywhere: g.enabled, enabled: false, next: null }))];
    const runs = (shared("workspaces.automation.runs") ?? []).filter((r) => r.ws === def.id);
    const ag = agents(), tm = terminals();
    // On or off at a click: a track with its knob at the right when it's on.
    const toggle = (a) => h_flex().id(`a-sw-${scopeOf(a)}-${a.name}`).w(26).h(15).p(2).flex_none().rounded_full().items_center().cursor_pointer()
      .bg(a.enabled ? t.accent : t.input).when(a.enabled, (el) => el.justify_end())
      .tooltip(def.none ? (a.enabled ? "On. Click to turn it off in every workspace" : "Off in every workspace. Click to turn it on")
        : scopeOf(a) !== "global" ? (a.enabled ? "On. Click to turn it off" : "Off. Click to turn it on")
        : a.enabled ? `On in ${def.name}. Click to turn it off here; the other workspaces keep it`
        : a.everywhere === false ? `Off in every workspace. Click to turn it on in ${def.name} only`
        : `Off in ${def.name}. Click to turn it on here`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(a, cx); })
      .child(div().size(11).rounded_full().bg(t.background));
    const item = (a) => {
      const on = this.same(a);
      const dot = a.error || (a.allowed === false && a.enabled) ? t.blocked : a.enabled ? t.done : t.dim;
      // A script: a terminal icon in the dot's place, the same colours.
      const mark = a.run === "shell" ? svg("mods/workspace-chrome/terminal.svg").size(13).flex_none().text_color(dot) : div().size(7).flex_none().rounded_full().bg(dot);
      // Its newest run, while that's working, waiting on you, running or queued. (A replaced one doesn't run here.)
      const newest = a.replaced ? null : runs.find((r) => r.name === a.name);
      const now = a.replaced ? null : runState(runs.find((r) => r.name === a.name && (r.status === "started" || r.status === "running" || r.status === "queued")), ag, tm);
      const busy = now === "working" || now === "needs you" || now === "running" || now === "queued" ? now : null;
      // Missed while the Mac was off, and nothing has run since; or its last run hit its timeout.
      const missed = newest?.status === "missed";
      const timedOut = Boolean(newest?.timedOut);
      if (a.replaced) {
        return h_flex().id(`a-global-${a.name}`).h(46).mx(6).px(8).gap(9).rounded(7).items_center().cursor_pointer()
          .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
          .tooltip(`${def.name} has its own "${a.name}", which is the one that runs here`)
          .on_click((_e, cx) => this.pick({ scope: "global", name: a.name, isNew: false }, null, cx))
          .child(div().size(7).flex_none().rounded_full().bg(t.dim))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().truncate().text_color(t.muted).child(a.name))
            .child(div().truncate().text_size(11).text_color(t.dim).child(a.summary)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child("replaced here"));
      }
      return h_flex().id(`a-${scopeOf(a)}-${a.name}`).h(46).mx(6).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => this.pick({ scope: scopeOf(a), name: a.name, isNew: false }, null, cx))
        .child(mark)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_color(a.enabled ? t.foreground : t.muted).child(a.name))
          .child(div().truncate().text_size(11).text_color(a.error ? t.blocked : t.dim).child(a.error ? "Can't read it: open it to see why" : a.summary)))
        .child(div().flex_none().text_size(11).text_color(busy === "working" || busy === "running" ? t.working : busy === "queued" ? t.dim : busy || missed || timedOut || a.allowed === false ? t.blocked : t.dim)
          .child(busy ?? (a.allowed === false ? "allow?" : !a.enabled ? "off" : timedOut ? "timed out" : missed ? "missed" : a.next ? shortTime(a.next) : "")))
        .child(toggle(a));
    };
    // The ready-made ones nobody has made yet, here or for every workspace.
    const taken = new Set([...autos, ...this.globals()].map((a) => a.name));
    const ready = this.starters.filter((s) => !taken.has(s.name));
    const starter = (s) => {
      const on = Boolean(this.sel?.isNew && this.sel.starter === s.name);
      return h_flex().id(`a-ready-${s.name}`).h(46).mx(6).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .tooltip(`${s.description}. Click to read it; nothing runs until you create it`)
        .on_click((_e, cx) => this.useStarter(s, cx))
        .child(div().size(7).flex_none().rounded_full().border_1().border_color(t.dim))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_color(t.muted).child(s.name))
          .child(div().truncate().text_size(11).text_color(t.dim).child(s.summary)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("add"));
    };
    const group = (text) => div().px(14).pb(4).text_size(11).text_color(t.dim).truncate().child(text);
    // A new one each time: an element can only be added once.
    const none = () => div().px(14).pb(2).text_size(12).text_color(t.dim).child("None yet.");
    const list = v_flex().w(260).flex_none().min_h(0).border_r(1).border_color(t.border).bg(t.chrome)
      .child(div().p(10).child(h_flex().id("a-new").h(30).px(12).gap(6).items_center().justify_center().rounded(8).cursor_pointer()
        .bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium().hover((s) => s.opacity(0.88))
        .on_click((_e, cx) => this.fresh(cx)).child(svg("mods/workspace-chrome/plus.svg").size(13)).child("New automation")))
      .child(v_flex().id("a-list").flex_1().min_h(0).pb(10).overflow_y_scrollbar()
        .when(!def.none, (el) => el
          .child(group(def.name))
          .children(own.map(item))
          .when(!own.length, (el) => el.child(none()))
          .child(div().h(12)))
        .child(group("Every workspace"))
        .children(forAll.map(item))
        .when(!forAll.length, (el) => el.child(none()))
        .when(Boolean(def.none), (el) => el.child(div().px(14).pt(12).text_size(11.5).text_color(t.dim).child("Show a workspace to see its own, and each one's runs.")))
        .when(ready.length > 0, (el) => el
          .child(div().h(12))
          .child(group("Ready-made"))
          .children(ready.map(starter))));
    return shell.child(h_flex().flex_1().min_h(0).items_stretch().child(list).child(this.editor(t, def)));
  }

  editor(t, def) {
    const pane = v_flex().flex_1().min_w(0).min_h(0);
    if (!this.sel) {
      const words = (s) => platformWords(s, window()?.platform ?? "macos");
      return pane.p(18).gap(10).text_color(t.muted).text_size(12.5)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Pick an automation, or make a new one."))
        .child(div().child(words(`An automation runs by itself: on a schedule, when a task enters a board column, when an agent finishes or needs you, when files change, on GitHub (a PR opened, merged or waiting for your review, CI failing, a label), after another automation, when Herdr starts or the Mac wakes, or when another app calls it.`)))
        .child(div().child(`It starts an agent with a prompt, or runs a shell script with no agent at all (fetching repos, running tests, a backup).`))
        .child(div().child(`New automation asks what it should do, in your words. An agent drafts it, and nothing is saved until you've read it.`))
        .child(div().child(`The ready-made ones under the list are a place to start: open one to read it, change what you like, and Create adds it${def.none ? " for every workspace" : ` to ${def.name} or to every workspace`}.`))
        .child(div().child(`An agent's run is a tab in ${def.none ? "its workspace" : def.name}'s Automations space, made the first time; a script runs unseen, and History keeps what it printed. Your view stays where it is.`))
        .child(div().child(`An automation can have a check: a command Herdr runs first, so nothing starts when there's nothing to do.`))
        .child(div().child(words(`They run while Herdr is open, or all the time with Keep running on, in Settings > Automations. A schedule missed while nothing was running or the Mac slept runs once when it can, if that's within 12 hours. A one-time schedule turns itself off after it runs.`)))
        .child(div().child(`One made for every workspace runs in each of them, as that workspace's own; a workspace's own automation of the same name replaces it there, and its switch in the list turns it off for that workspace alone.`))
        .child(div().child(def.none ? `No workspace is shown, so these are the ones for every workspace. Their files are in ${tilde(globalDir())}.`
          : `${def.name}'s files are in ${tilde(def.dir)}/automations, and the ones for every workspace in ${tilde(globalDir())}.`));
    }
    const sel = this.sel, c = this.choice;
    const global = sel.scope === "global";
    const shell = c.run === "shell";
    const saved = this.lookup(sel);
    const dirty = this.dirty();
    const w = parseWhen(this.whenIn.value());
    const kind = w.kind === "error" ? null : kindOf(w);
    const next = w.kind === "every" ? (saved && !dirty ? saved.next : null) : nextAt(w, Date.now());
    const drafting = this.drafting === sel;
    const blank = this.blank();
    const ask = this.askState();
    const label_ = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const box = (state, mono) => Input.new(state).h(34).px(10).rounded(8).border_1().border_color(this.focusedIn === state ? t.accent : t.input).bg(t.background)
      .text_size(12.8).text_color(t.foreground).when(mono, (el) => el.font_family("JetBrains Mono"));
    const button = (id, text, kind_, action, enabled = true) => h_flex().id(id).h(32).px(13).flex_none().items_center().rounded(8).border_1()
      .border_color(kind_ === "primary" ? t.solid : t.input).bg(kind_ === "primary" ? t.solid : t.raised)
      .text_color(kind_ === "primary" ? t.solid_foreground : kind_ === "danger" ? t.blocked : t.foreground)
      .text_size(12.5).font_medium().when(!enabled || this.busy, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((st) => st.opacity(0.88)).on_click(action)).child(text);
    // A small quiet button beside a label (Try it, Close).
    const small = (id, text, action, enabled = true) => div().id(id).flex_none().px(9).h(24).flex().items_center().rounded(6).border_1().border_color(t.input)
      .text_size(11.5).text_color(t.muted).when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click(action)).child(text);
    // A choice chip: highlighted when it's the one chosen.
    const pick = (id, text, on, action) => div().id(id).h(26).px(10).flex().items_center().rounded(13).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(12)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((st) => st.text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(text);
    const chips = (...kids) => h_flex().gap(6).flex_wrap().items_center().children(kids);
    // A label and its chips on one line (Safety & delivery).
    const row = (text, ...kids) => h_flex().pt(6).gap(8).items_center().child(div().w(96).flex_none().text_size(11.5).text_color(t.dim).child(text)).child(chips(...kids));
    const mono = (lines, color) => v_flex().px(10).py(8).rounded(6).bg(t.raised).font_family("JetBrains Mono").text_size(11.5).text_color(color ?? t.muted)
      .children(lines.map((line) => div().truncate().child(line || " ")));
    const setWhen = (v) => this.whenIn.set_value(v);
    // The github line with one part changed, the rest kept. ev: opened, review-requested, merged, labeled, ci.
    const evNow = w.kind === "github" ? (w.what === "ci" ? "ci" : w.event ?? "opened") : null;
    const setGithub = (patch) => {
      const g = { repo: w.repo, what: w.what === "ci" ? "pr" : w.what, ev: evNow, others: w.others, label: w.label, ...patch };
      const lab = g.label ? ` label:${/\s/.test(g.label) ? JSON.stringify(g.label) : g.label}` : "";
      const by = g.others ? " by others" : "";
      setWhen(g.ev === "ci" ? `github ${g.repo} ci failed`
        : g.ev === "review-requested" ? `github ${g.repo} pr review-requested`
        : g.ev === "merged" ? `github ${g.repo} pr merged${by}${lab}`
        : g.ev === "labeled" && g.label ? `github ${g.repo} ${g.what} labeled:${/\s/.test(g.label) ? JSON.stringify(g.label) : g.label}`
        : `github ${g.repo} ${g.what} opened${by}${lab}`);
    };
    // The other automations here, for After run.
    const others = [...new Set(this.list().map((a) => a.name))].filter((n) => n !== (sel.isNew ? this.nameIn.value().trim() : sel.name));
    const setChain = (patch) => {
      const g = { target: w.target ?? others[0] ?? "name", on: w.on ?? "done", ...patch };
      setWhen(`automation ${g.on === "failed" ? "failed" : "done"} ${g.target}`);
    };
    const columns = columnsOf(def);
    const finish = String(def.board?.finish ?? "review").toLowerCase();
    const firstOf = {
      github: `github ${global ? "*" : this.ghRepos[0]?.folder ?? "owner/name"} pr opened`, schedule: "weekdays 09:00", board: `task enters ${columns.includes(finish) ? finish : columns[columns.length - 1]}`,
      agent: "agent done", files: `files ${folderChoices(def)[0] ?? "inbox"}`, chain: `automation done ${others[0] ?? "name"}`, lifecycle: "startup", link: "link",
    };
    const quick = kind === "schedule" ? [...SCHEDULES.map((x) => pick(`a-q-${x}`, x, this.whenIn.value().trim() === x, () => setWhen(x))),
      pick("a-q-once", "once tomorrow 09:00", w.kind === "once", () => setWhen(onceTomorrow()))]
      : kind === "board" ? columns.map((col) => pick(`a-q-${col}`, label(col), w.column === col, () => setWhen(`task enters ${col}`)))
      : kind === "agent" ? [pick("a-q-done", "Finishes", w.status === "done", () => setWhen("agent done")), pick("a-q-blocked", "Needs you", w.status === "blocked", () => setWhen("agent blocked"))]
      : kind === "files" ? (global ? [] : folderChoices(def)).map((f) => pick(`a-q-f-${f}`, f, w.folder === f, () => setWhen(`files ${f}`)))
      : kind === "github" ? [
        pick("a-q-gh-all", "Every repo", w.repo === "*", () => setGithub({ repo: "*" })),
        ...(global ? [] : this.ghRepos).map((g) => pick(`a-q-gh-${g.folder}`, g.folder, w.repo === g.folder || w.repo === g.repo, () => setGithub({ repo: g.folder }))),
        div().w(8),
        pick("a-q-gh-pr", "PR opened", evNow === "opened" && w.what === "pr", () => setGithub({ what: "pr", ev: "opened" })),
        pick("a-q-gh-review", "PR review requested", evNow === "review-requested", () => setGithub({ what: "pr", ev: "review-requested", others: false, label: null })),
        pick("a-q-gh-merged", "PR merged", evNow === "merged", () => setGithub({ what: "pr", ev: "merged" })),
        pick("a-q-gh-issue", "Issue opened", evNow === "opened" && w.what === "issue", () => setGithub({ what: "issue", ev: "opened" })),
        pick("a-q-gh-ci", "CI failed", evNow === "ci", () => setGithub({ ev: "ci", others: false, label: null })),
        ...(evNow === "labeled" ? [pick("a-q-gh-labeled", `Labeled ${w.label}`, true, () => {})] : []),
        ...(evNow === "opened" || evNow === "merged" ? [pick("a-q-gh-others", "By others only", w.others, () => setGithub({ others: !w.others }))] : []),
      ]
      : kind === "chain" ? [
        ...others.map((n) => pick(`a-q-ch-${n}`, n, w.target === n, () => setChain({ target: n }))),
        div().w(8),
        pick("a-q-ch-done", "When it finishes", w.on === "done", () => setChain({ on: "done" })),
        pick("a-q-ch-failed", "When it fails", w.on === "failed", () => setChain({ on: "failed" })),
      ]
      : kind === "lifecycle" ? [pick("a-q-startup", "On startup", w.event === "startup", () => setWhen("startup")), pick("a-q-wake", "On wake", w.event === "wake", () => setWhen("wake"))]
      : [];
    // A global one runs in every workspace: only the presets and folders they all have.
    const presets = global ? this.globalPresets() : presetsFor(def.id);
    const agentChoices = installedAgents().filter((a) => !presets.some((p) => p.name === a.key));
    // Another agent: a model or effort chosen for a different program doesn't carry over.
    const chooseAgent = (name) => {
      if (programOf(commandOf(def, name).argv) !== programOf(commandOf(def, c.agent).argv)) { c.model = ""; c.effort = ""; }
      c.agent = name;
      this.modelIn.set_value("");
      this.findSet("");
    };
    const folders = global ? [] : folderChoices(def);
    const boardAgent = boardAgentOf(def);
    // The agent it starts, and the model and effort that will run: its own, else what its command sets.
    const cmd = commandOf(def, c.agent);
    const program = programOf(cmd.argv);
    const knobs = KNOBS[program] ?? null;
    const own = knobsIn(cmd.argv);
    const models = knobs ? [...new Set([...knobs.models, ...(program === "codex" ? this.codexModels : []), ...(this.listed[program] ?? []), ...(own.model ? [own.model] : []), ...(c.model ? [c.model] : [])])] : [];
    const { shown: shownList, more: moreModels } = shownModels(models, this.modelIn.value(), c.model || own.model);
    this.findModels = models;
    const model = c.model || own.model, effort = knobs?.effort ? c.effort || own.effort : null;
    const who = `${c.agent || (global ? "each board's agent" : boardAgent)}${cmd.preset && program && program !== cmd.name ? ` (${program})` : ""}`;
    const knobText = [model && `on ${model}`, effort && `${effort} effort`].filter(Boolean).join(", ");
    const where = c.folder || (kind === "github" ? "its repo's folder" : global ? "each workspace's root" : "the root");
    const checkCmd = normCheck(this.checkIn.value());
    const checkLines = checkCmd ? checkCmd.split("\n") : [];
    const script = shell ? normScript(this.bodyIn.value()) : "";
    // Its limit as it would run: a script without a tab stops at 10 minutes whatever it says.
    const limitMs = effectiveTimeout({ run: c.run, timeout: c.timeout });
    const capped = shell && !c.terminal && (limitMs === 0 || limitMs > 600e3);
    const timeoutLabel = capped ? "10 min" : limitMs > 0 ? formatDuration(limitMs) : null;
    const notifyLabel = NOTIFY_WORDS[c.notify || (shell ? "problems" : "results")];
    const runsText = shell
      ? `Runs a ${c.shell || "bash"} script in ${where} (${c.terminal ? (c.keep ? "in a tab, kept open" : "in a tab") : "background"}${timeoutLabel ? `, ${timeoutLabel} timeout` : ""}) · ${notifyLabel}.`
      : `Starts ${who}${knobText ? ` ${knobText}` : ""} in ${where}${timeoutLabel ? ` · ${timeoutLabel} timeout` : ""} · ${notifyLabel}${c.card ? " · with a board card" : ""}.`;
    const noKnobs = !shell && ((!knobs && (c.model || c.effort)) || (Boolean(knobs) && !knobs.effort && c.effort));
    // Waiting to be allowed: the saved check or script, as it's still shown here.
    const waitsCheck = Boolean(saved) && (saved.checkAllowed === false || (saved.allowed === false && saved.checkAllowed === undefined)) && Boolean(saved.check) && checkCmd === saved.check;
    const waitsScript = Boolean(saved) && saved.run === "shell" && saved.scriptAllowed === false && shell && script === saved.body;
    const waits = !dirty && (waitsCheck || waitsScript);
    const allowText = waitsCheck && waitsScript ? "Allow check and script" : waitsScript ? "Allow this script" : "Allow this check";

    const runs = saved && !saved.replaced ? (shared("workspaces.automation.runs") ?? []).filter((r) => r.ws === def.id && r.name === saved.name).slice(0, 4) : [];
    const ag = agents(), tm = terminals();
    const took = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60e3 ? `${(ms / 1000).toFixed(ms < 10e3 ? 1 : 0)} s` : `${Math.round(ms / 60e3)} min`);
    const runRow = (r) => {
      const state = runState(r, ag, tm);
      const bad = state === "needs you" || state === "failed" || state === "missed" || state === "waiting" || state === "timed out" || /^exit [1-9]/.test(state ?? "");
      const color = state === "working" || state === "running" ? t.working : bad ? t.blocked : r.kind === "shell" && /^exit 0$/.test(state ?? "") ? t.done : t.dim;
      const live = state !== "closed" && !r.closed && r.status === "started" && r.tab;
      const text = r.note ? `${r.why}. ${r.note}` : r.kind === "shell" && r.durationMs != null ? `${r.why} · ${took(r.durationMs)}` : r.why;
      return h_flex().id(`a-run-${r.id}`).h(26).gap(10).items_center().text_size(12)
        .child(div().w(70).flex_none().text_color(t.dim).child(shortTime(r.at)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(text))
        .child(div().flex_none().text_color(color).child(state))
        .when(Boolean(live) && (state === "working" || state === "needs you" || state === "open"), (el) => el.child(div().id(`a-stop-${r.id}`).flex_none().px(8).h(22).flex().items_center()
          .rounded(6).border_1().border_color(t.input).text_size(11.5).text_color(t.blocked).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => this.stop(r, cx)).child(this.stopping === r.id ? "Click again to stop" : "Stop")))
        .when(Boolean(live), (el) => el.child(div().id(`a-go-${r.id}`).flex_none().px(8).h(22).flex().items_center().rounded(6).border_1().border_color(t.input)
          .text_size(11.5).cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => this.goTo(r)).child("Go to")))
        // A script's run that ended: what it printed is in History.
        .when(r.kind === "shell" && Boolean(r.closed) && !live, (el) => el.child(div().id(`a-log-${r.id}`).flex_none().px(8).h(22).flex().items_center().rounded(6).border_1().border_color(t.input)
          .text_size(11.5).cursor_pointer().hover((st) => st.bg(t.hover)).tooltip("Open this run in History, with what it printed").on_click(() => this.openLog(r)).child("Log")));
    };

    // Describe it: a box for a new one (Draft it), or one line to change what's there (Change it).
    const drafterName = DRAFTER_NAMES[this.drafter ?? this.drafters()[0]] ?? "An agent";
    const working = h_flex().gap(8).items_center()
      .child(svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.working).spin(900))
      .child(div().text_size(11.5).text_color(t.muted).child(`${drafterName}${(this.drafter ?? this.drafters()[0]) === "claude" ? ` (${DRAFT_MODEL})` : ""} is drafting it…`));
    const canDraft = !drafting && Boolean(ask.value().trim());
    const askBox = blank
      ? v_flex().pt(4)
        .child(div().pb(8).text_size(12.5).text_color(t.muted).child(`Say what it should do and when, in your own words. ${drafterName} drafts it (an agent, or a shell script when no agent is needed), and you read the draft before it's saved.`))
        .child(div().h(92).flex_none().child(Textarea.new(ask).size_full().p(10).rounded(8).border_1()
          .border_color(this.focusedIn === ask ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground)))
        .child(h_flex().pt(8).gap(8).items_center()
          .when(drafting, (el) => el.child(working))
          .when(!drafting, (el) => el.child(div().id("a-manual").text_size(11.5).text_color(t.dim).cursor_pointer().hover((st) => st.text_color(t.foreground))
            .on_click((_e, cx) => { this.manual = true; this.details = true; cx.notify(); }).child("Or fill it in yourself")))
          .child(div().flex_1())
          .child(button("a-draft", "Draft it", "primary", (_e, cx) => this.draft(cx), canDraft)))
      : v_flex().pt(12)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).child(box(ask)))
          .child(button("a-draft", "Change it", "plain", (_e, cx) => this.draft(cx), canDraft)))
        .when(drafting, (el) => el.child(div().pt(8).child(working)));
    const askNotes = v_flex()
      .when(Boolean(this.draftError), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.draftError)))
      .when(Boolean(this.draftNote), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.working).child(`Before you save: ${this.draftNote}`)));

    // What it does, in words: when, what it runs and where, then its check; and what waits for you.
    const summary = v_flex().gap(3)
      .child(div().text_size(13).text_color(w.kind === "error" ? t.blocked : t.foreground)
        .child(w.kind === "error" ? w.error : `${describe(w)}${next ? ` · next ${shortTime(next)}` : ""}${w.kind === "github" ? " · looks every 2 minutes, with your gh login" : ""}`))
      .child(div().text_size(12).text_color(t.muted).child(runsText))
      .when(Boolean(checkCmd), (el) => el
        .child(div().pt(2).text_size(12).text_color(t.muted).child(`First, Herdr runs this in ${where}. Nothing ${shell ? "runs" : "starts"} unless it prints something${kind === "schedule" && w.kind !== "once" && c.dedupe !== "always" ? " new" : ""}:`))
        .child(div().mt(2).child(mono([...checkLines.slice(0, 4), ...(checkLines.length > 4 ? [`… ${checkLines.length - 4} more lines`] : [])], t.foreground))))
      .when(Boolean(noKnobs), (el) => el.child(div().text_size(11.5).text_color(t.working).child(knobs ? `${who} doesn't take an effort, so it's left out when it runs.` : `${who} doesn't take a model or effort here, so they're left out when it runs.`)))
      .when(Boolean(saved?.warning) && !waits, (el) => el.child(div().text_size(11.5).text_color(t.working).child(saved.warning)))
      // A check or script that came from outside this screen (an agent, the file): yours to allow, as it's saved.
      .when(waits, (el) => el
        .child(div().pt(4).text_size(12).text_color(t.working).child(waitsScript && waitsCheck ? "This script and its check were added outside this screen and haven't been allowed yet, so it won't run. Read them, then allow them."
          : waitsScript ? "This script was added outside this screen and hasn't been allowed yet, so it won't run. Read it below, then allow it."
          : "This check was added outside this screen and hasn't been allowed yet, so it won't start. Read the command above, then allow it."))
        .child(h_flex().pt(6).child(button("a-allow", allowText, "primary", (_e, cx) => this.allow(cx)))));

    // Preview: what a run would get, nothing started.
    const pv = this.preview?.sel === sel ? this.preview : null;
    const pvBadge = !pv || pv.loading ? null
      : !pv.check ? ["No check", t.dim]
      : pv.check.waits ? ["Check not run: allow it first", t.working]
      : pv.check.error ? ["Check failed", t.blocked]
      : pv.check.out ? [`Check passed · ${pv.check.out.split("\n").length === 1 ? "1 line" : `${pv.check.out.split("\n").length} lines`}`, t.done]
      : ["Check printed nothing · nothing would run", t.working];
    const pvLines = pv && !pv.loading ? String(pv.text ?? "").split("\n") : [];
    const previewPanel = !pv ? null : v_flex().mt(10).p(12).gap(8).rounded(8).border_1().border_color(t.accent).bg(t.background)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(12.5).font_semibold().child("Dry-run preview (nothing started)"))
        .when(Boolean(pvBadge), (el) => el.child(div().px(7).h(20).flex().items_center().rounded(10).bg(t.raised).text_size(11).text_color(pvBadge[1]).child(pvBadge[0])))
        .when(Boolean(pv.loading), (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)).child(div().text_size(11.5).text_color(t.muted).child("Running the check…")))
        .child(div().flex_1())
        .child(small("a-pv-close", "Close", (_e, cx) => { this.preview = null; cx.notify(); })))
      .when(Boolean(pv.check?.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(pv.check.error)))
      .when(!pv.loading, (el) => el
        .child(div().text_size(11.5).text_color(t.dim).child(pv.shell ? `The ${c.shell} script, in ${tilde(pv.folder)}` : `The prompt, filled in for ${def.name} (${tilde(pv.folder)})`))
        .child(mono([...pvLines.slice(0, 24), ...(pvLines.length > 24 ? [`… ${pvLines.length - 24} more lines`] : [])], t.foreground))
        .when(pv.shell, (el) => el
          .child(div().text_size(11.5).text_color(t.dim).child("With these variables (as data, never put into the script)"))
          .child(mono(pv.env.map((e) => (e.length > 110 ? `${e.slice(0, 109)}…` : e)))))
        // secret_env: each variable by its secret's name; herdr-ws-secret hands the value over, never this screen.
        .when((pv.secrets ?? []).length > 0, (el) => el
          .child(div().text_size(11.5).text_color(t.dim).child(pv.shell ? "Secrets from Vault for the script and its check, handed over by herdr-ws-secret (their values never show here)"
            : "Secrets from Vault for its check only, handed over by herdr-ws-secret: the agent itself isn't given them (their values never show here)"))
          .child(mono(pv.secrets.map((p) => `${p.env}=[secret:${p.name}]`))))
        .when(!isSchedule(w), (el) => el.child(div().text_size(11).text_color(t.dim).child("What sets it off has example values here."))));

    // The body: the agent's prompt, or the script with its own Try it.
    const vars = ["WORKSPACE", "FOLDER", "DATE", "TIME", "EVENT", ...(checkCmd ? ["CHECK"] : []), ...(VARS[kind] ?? []), ...(kind === "github" && w.what === "ci" ? ["WORKFLOW"] : [])];
    const ts = this.triedScript && this.triedScript.script === script ? this.triedScript : null;
    const tsLines = ts ? String(ts.combined ?? "").split("\n").filter((l, i, all) => i < all.length - 1 || l) : [];
    const bodyField = shell
      ? v_flex()
        .child(h_flex().pt(14).pb(6).items_center()
          .child(div().flex_1().text_size(11.5).text_color(t.dim).child(`Script (${c.shell || "bash"})`))
          .child(small("a-try-script", this.tryingScript ? "Running…" : "Try it", (_e, cx) => this.tryScript(cx), Boolean(script) && !this.tryingScript && !def.none)))
        .child(div().h(150).flex_none().child(Textarea.new(this.bodyIn).size_full().p(10).rounded(8).border_1().border_color(this.focusedIn === this.bodyIn ? t.accent : t.input)
          .bg(t.background).text_size(12.5).text_color(t.foreground).font_family("JetBrains Mono")))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Variables: ${vars.map((v) => `$HERDR_${v}`).join(" ")} (never put into the script itself).`))
        // A check's Try it only reads; a script's is the whole job, done now.
        .when(!def.none, (el) => el.child(div().pt(2).text_size(11.5).text_color(t.muted).child(`Try it runs this script for real in ${tilde(this.folderNow(def))}, with what sets it off left empty.`)))
        .when(Boolean(ts), (el) => el.child(v_flex().mt(8).px(10).py(8).gap(4).rounded(6).bg(t.raised)
          .child(div().text_size(11.5).text_color(ts.outcome === "failed" ? t.blocked : t.done)
            .child(`Ran in ${tilde(ts.folder)} · ${ts.timedOut ? "timed out" : `exit ${ts.code ?? "?"}`} · ${took(ts.durationMs ?? 0)}${tsLines.length ? "" : " · it printed nothing"}`))
          .when(tsLines.length > 0, (el) => el.child(v_flex().font_family("JetBrains Mono").text_size(11.5).text_color(t.muted)
            .children(tsLines.slice(0, 8).map((line) => div().truncate().child(line || " ")))
            .when(tsLines.length > 8, (el) => el.child(div().text_color(t.dim).child(`… and ${tsLines.length - 8} more lines`)))))))
      : v_flex()
        .child(label_("Prompt: the agent's task"))
        .child(div().h(150).flex_none().child(Textarea.new(this.bodyIn).size_full().p(10).rounded(8).border_1().border_color(this.focusedIn === this.bodyIn ? t.accent : t.input)
          .bg(t.background).text_size(12.5).text_color(t.foreground)))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Fill-ins: ${[FILLS[kind], kind === "github" && w.what === "ci" && "{{workflow}}", checkCmd && "{{check}} (what the check printed)", "{{event}} {{workspace}} {{folder}} {{date}} {{time}}"].filter(Boolean).join(" · ")}.`))
        .when(kind !== null && kind !== "schedule" && kind !== "lifecycle", (el) => el.child(div().pt(2).text_size(11.5).text_color(t.dim)
          .child("What set it off is added at the end, unless the prompt uses {{event}} or one of the fill-ins above.")));

    // Try it: what the check says here and now.
    const tried = this.tried && this.tried.cmd === checkCmd ? this.tried : null;
    const repeats = kind === "schedule" && w.kind !== "once";
    const triedLines = tried?.out ? tried.out.split("\n") : [];
    const starts = shell ? "The script runs" : "An agent starts";
    const triedText = !tried ? null
      : tried.error ? `It failed: ${tried.error}`
      : tried.out ? `It printed ${triedLines.length === 1 ? "one line" : `${triedLines.length} lines`}. ${repeats && c.dedupe !== "always" ? `${starts} when that differs from the last check, and gets` : `${shell ? "The script would run now" : "An agent would start now"} and get`}:`
      : `It printed nothing, so nothing would ${shell ? "run" : "start"} now.`;
    const checkField = v_flex()
      .child(label_("Check first: optional shell command before starting (one or more lines)"))
      .child(h_flex().gap(8).items_start()
        .child(div().flex_1().min_w(0).h(74).child(Textarea.new(this.checkIn).size_full().px(10).py(8).rounded(8).border_1().border_color(this.focusedIn === this.checkIn ? t.accent : t.input)
          .bg(t.background).text_size(12.5).text_color(t.foreground).font_family("JetBrains Mono")))
        .child(button("a-try", this.trying ? "Trying…" : "Try it", "plain", (_e, cx) => this.tryCheck(cx), Boolean(checkCmd) && !this.trying)))
      .when(kind === "schedule", (el) => el.child(h_flex().pt(8).gap(8).items_center()
        .child(div().text_size(11.5).text_color(t.dim).child("Same output as last time:"))
        .child(chips(pick("a-dd-skip", "Skip", c.dedupe !== "always", () => { c.dedupe = ""; }), pick("a-dd-always", "Run anyway", c.dedupe === "always", () => { c.dedupe = "always"; })))))
      .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Herdr runs it with sh in ${where}, as you, each time this is set off. Prints something: ${shell ? "the script runs, with it as $HERDR_CHECK" : "the agent starts and gets it as {{check}}"}. Prints nothing${repeats && c.dedupe !== "always" ? ", or the same as at the last check" : ""}: nothing ${shell ? "runs" : "starts"}. Empty: it always ${shell ? "runs" : "starts"}. Run now ${shell ? "runs" : "starts"} it either way. Create and Save allow it as it's written here; one that an agent or the file brought waits for Allow this check.`))
      .when(Boolean(checkCmd) && kind !== null && kind !== "schedule" && kind !== "link", (el) => el.child(div().pt(2).text_size(11.5).text_color(t.dim)
        .child("What set it off is in variables, not {{…}}: $HERDR_NUMBER, $HERDR_TITLE, $HERDR_TASK_ID, $HERDR_FILES, $HERDR_OUTPUT and so on. Try it runs with those empty.")))
      .when(Boolean(triedText), (el) => el.child(div().pt(6).text_size(11.5).text_color(tried.error ? t.blocked : tried.out ? t.done : t.muted).child(triedText)))
      .when(triedLines.length > 0, (el) => el.child(v_flex().mt(4).px(8).py(6).rounded(6).bg(t.raised).font_family("JetBrains Mono").text_size(11.5).text_color(t.muted)
        .children(triedLines.slice(0, 6).map((line) => div().truncate().child(line || " ")))
        .when(triedLines.length > 6, (el) => el.child(div().text_color(t.dim).child(`… and ${triedLines.length - 6} more`)))));

    const detailsRow = h_flex().id("a-details").mt(16).h(30).gap(6).items_center().cursor_pointer().border_t(1).border_color(t.border).pt(12)
      .on_click((_e, cx) => { this.details = !this.details; cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${this.details ? "down" : "right"}.svg`).size(13).text_color(t.muted))
      .child(div().text_size(12.5).font_medium().child("Details"))
      .child(div().text_size(11.5).text_color(t.dim).child(`${sel.isNew ? "name, " : ""}runs as, when, ${shell ? "shell" : "agent, model"}, folder, check, timeout, notifications`));

    // Timeout, notifications and catch-up: the chip for the default stands for "unset", so the file stays short.
    const defTimeout = shell ? "2m" : "none";
    const sameTime = (a, b) => parseDuration(a) === parseDuration(b);
    const setTimeout_ = (v) => { c.timeout = sameTime(v, defTimeout) ? "" : v; };
    const nowTimeout = c.timeout || defTimeout;
    const timeouts = TIMEOUTS.filter(([v]) => v).map(([v, text]) => pick(`a-to-${v}`, text, sameTime(nowTimeout, v), () => setTimeout_(v)));
    const customTimeout = c.timeout && !TIMEOUTS.some(([v]) => v && sameTime(c.timeout, v)) ? [pick("a-to-custom", c.timeout, true, () => {})] : [];
    const defNotify = shell ? "problems" : "results";
    const notifies = NOTIFIES.map(([v, text]) => pick(`a-nt-${v}`, text, (c.notify || defNotify) === v, () => { c.notify = v === defNotify ? "" : v; }));
    const misses = MISSES.map(([v, text]) => pick(`a-ms-${v}`, text, (c.missed || "run") === v, () => { c.missed = v === "run" ? "" : v; }));

    const details = v_flex()
      .when(sel.isNew, (el) => el.child(label_("Name: its file's name, and what herdr-ws-run calls it")).child(box(this.nameIn)))
      .child(label_("Description")).child(box(this.descIn))
      .child(label_("Runs as"))
      .child(chips(pick("a-run-agent", "Agent", !shell, () => { c.run = "agent"; c.terminal = false; }),
        pick("a-run-shell", "Shell script", shell, () => { c.run = "shell"; c.card = false; this.preview = null; })))
      .child(label_("When"))
      .child(chips(...KINDS.map(([k, text]) => pick(`a-k-${k}`, text, kind === k, () => { if (kind !== k) setWhen(firstOf[k]); }))))
      .child(div().pt(8).child(box(this.whenIn, true)))
      .when(quick.length > 0, (el) => el.child(div().pt(8).child(chips(...quick))))
      .when(shell, (el) => el
        .child(label_("Shell"))
        .child(chips(...SHELLS.map((x) => pick(`a-sh-${x}`, x, c.shell === x, () => { c.shell = x; }))))
        .child(label_("Runs in"))
        .child(chips(pick("a-tm-bg", "Background", !c.terminal, () => { c.terminal = false; c.keep = false; }),
          pick("a-tm-tab", "In a tab", c.terminal && !c.keep, () => { c.terminal = true; c.keep = false; }),
          pick("a-tm-keep", "Keep tab open", c.terminal && c.keep, () => { c.terminal = true; c.keep = true; })))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(c.terminal ? "A tab in the Automations space runs it, so you can watch; History keeps how it ended." : "It runs unseen; History keeps its exit code and what it printed. Without a tab it stops at 10 minutes.")))
      .when(!shell, (el) => el
        .child(label_(global ? "Agent: a preset for every workspace, or each board's agent" : "Agent: a preset, or the board's agent"))
        .child(chips(pick("a-ag-default", global ? "Each board's" : `Board's (${boardAgent})`, !c.agent, () => chooseAgent("")),
          ...presets.map((p) => pick(`a-ag-${p.name}`, p.name, c.agent === p.name, () => chooseAgent(p.name))),
          // The installed agents, as they come: picking one shows its own models and efforts.
          ...agentChoices.map((a) => pick(`a-ag-${a.key}`, a.name, c.agent === a.key, () => chooseAgent(a.key))),
          ...(c.agent && !presets.some((p) => p.name === c.agent) && !agentChoices.some((a) => a.key === c.agent) ? [pick("a-ag-other", c.agent, true, () => {})] : [])))
        .when(Boolean(knobs), (el) => el
          .child(label_(cmd.preset ? `Model: Default is what ${cmd.name} sets` : "Model"))
          // A long list: Default, then the box that suggests as you type.
          .when(models.length > SHORT_LIST, (el) => el.child(h_flex().gap(6).items_center()
            .child(pick("a-model-default", own.model ? `Default (${own.model})` : "Default", !c.model, () => { c.model = ""; }))
            .child(this.modelFind(t, "a", models, c.model || null, program, () => { c.model = ""; }))))
          .when(models.length <= SHORT_LIST, (el) => el.child(h_flex().gap(6).flex_wrap().items_center()
            .child(pick("a-model-default", own.model ? `Default (${own.model})` : program === "codex" && this.codexModels[0] ? `Default (${this.codexModels[0]})` : "Default", !c.model, () => { c.model = ""; }))
            .children(shownList.map((m) => pick(`a-model-${m}`, m, c.model === m, () => { c.model = m; this.modelIn.set_value(""); })))
            .child(div().w(190).child(Input.new(this.modelIn).h(26).px(8).rounded(13).border_1().border_color(this.focusedIn === this.modelIn ? t.accent : t.input).bg(t.background).text_size(11.5).text_color(t.foreground)))))
          .when(models.length <= SHORT_LIST && moreModels > 0, (el) => el.child(div().pt(6).text_size(11.5).text_color(t.dim)
            .child(this.modelIn.value().trim() ? `${moreModels} more like that: type more of the name.` : `${program} lists ${models.length} models: type part of a name to find one.`)))
          .when(Boolean(knobs.effort), (el) => el
            .child(label_("Effort"))
            .child(h_flex().gap(6).flex_wrap()
              .child(pick("a-effort-default", own.effort ? `Default (${own.effort})` : "Default", !c.effort, () => { c.effort = ""; }))
              .children((knobs.effort?.levels ?? []).map((l) => pick(`a-effort-${l}`, l, c.effort === l, () => { c.effort = l; })))))))
      .child(label_(global ? "Folder: where it runs, in each workspace" : "Folder: where it runs"))
      .child(chips(pick("a-fo-root", kind === "github" ? "Its repo's folder" : "Root", !c.folder, () => { c.folder = ""; }),
        ...folders.map((f) => pick(`a-fo-${f}`, f, c.folder === f, () => { c.folder = f; })),
        ...(c.folder && !folders.includes(c.folder) ? [pick("a-fo-other", c.folder, true, () => {})] : [])))
      .child(checkField)
      .child(label_("Safety & delivery"))
      .child(row("Timeout", ...timeouts, ...customTimeout))
      .when(capped && limitMs !== 120e3, (el) => el.child(div().pt(4).text_size(11.5).text_color(t.working).child("Without a tab a script stops at 10 minutes: choose In a tab for longer.")))
      .child(row("Notifications", ...notifies))
      .when(kind === "schedule" && w.kind !== "once", (el) => el.child(row("If missed", ...misses)))
      .when(!shell, (el) => el
        .child(label_("Each run"))
        .child(chips(pick("a-card-no", "Just its tab", !c.card, () => { c.card = false; }), pick("a-card-yes", "A tab and a board card", c.card, () => { c.card = true; })))
        .child(label_("When it finishes"))
        .child(chips(pick("a-keep-no", "Close the tab", !c.keep, () => { c.keep = false; }), pick("a-keep-yes", "Keep it open", c.keep, () => { c.keep = true; })))
        .when(c.keep, (el) => el.child(div().pt(6).text_size(11.5).text_color(t.dim).child("Its newest three runs stay open. Right for one that asks you questions: an agent that ends its turn with a question looks finished.")))
        .when(!c.keep, (el) => el.child(div().pt(6).text_size(11.5).text_color(t.dim).child(c.card ? "With a board card, each run's tab stays open: when the card gets a pull request, its agent hears about checks and reviews there." : "The tab closes a few seconds after the agent is done, unless it's waiting on you, its helpers are still at work or you're looking at it. History lists the run, with Resume."))));

    // A global one: the other workspaces it's off in; whether this workspace's own replaces it;
    // and for a workspace's own, the global one of the same name it replaces.
    const offElsewhere = global ? (this.snap?.off ?? []).filter((x) => x !== def.id).map((x) => defOf(x)?.name ?? x) : [];
    const typed = sel.isNew ? this.nameIn.value().trim() : sel.name;
    const replacedHere = global && typed && this.taken("workspace").has(typed);
    const replacesGlobal = !global && !blank && typed && this.globals().some((g) => g.name === typed) ? typed : null;
    // Its own id per automation, so each opens scrolled to the top.
    const title = sel.isNew ? (this.drafted || this.manual ? this.nameIn.value().trim() || "New automation" : "New automation") : sel.name;
    const form = v_flex().id(`a-form-${sel.isNew ? "+new" : `${sel.scope}-${sel.name}`}`).flex_1().min_h(0).px(18).pt(18).pb(8).overflow_y_scrollbar()
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(16).font_semibold().child(title))
        .when(!sel.isNew || Boolean(def.none), (el) => el.child(div().px(8).h(22).flex().flex_none().items_center().rounded(11).bg(t.raised).text_size(11.5).text_color(t.muted)
          .child(global ? "Every workspace" : `Only in ${def.name}`)))
        // A script: a quiet pill, so it reads as one before anything else.
        .when(shell && !blank, (el) => el.child(h_flex().px(8).h(22).gap(5).flex_none().items_center().rounded(11).bg(t.selected).text_size(11.5).text_color(t.accent)
          .child(svg("mods/workspace-chrome/terminal.svg").size(12).text_color(t.accent)).child("Shell")))
        .when(dirty && !blank, (el) => el.child(div().text_size(11.5).text_color(t.working).child(this.drafted ? "drafted, not saved" : "unsaved")))
        .child(div().flex_1())
        .when(!blank && !global, (el) => el.child(chips(pick("a-on", "On", c.enabled, () => { c.enabled = true; }), pick("a-off", "Off", !c.enabled, () => { c.enabled = false; })))))
      // A new one: where it runs. Changing it keeps only what the other kind can have.
      .when(sel.isNew && !def.none, (el) => el.child(h_flex().pt(10).pb(6).gap(8).items_center()
        .child(div().text_size(11.5).text_color(t.dim).child("Runs in"))
        .child(chips(
          pick("a-scope-ws", `Only ${def.name}`, !global, () => { sel.scope = "workspace"; c.offHere = false; }),
          pick("a-scope-global", "Every workspace", global, () => {
            sel.scope = "global";
            if (c.agent && !this.globalPresets().some((x) => x.name === c.agent) && !installedAgents().some((a) => a.key === c.agent)) c.agent = "";
            if (/^[/~]/.test(c.folder)) c.folder = "";
          })))))
      // A global one: on, off here, or off everywhere.
      .when(global && !blank, (el) => el.child(h_flex().pt(10).gap(8).items_center()
        .child(chips(...[
          pick("a-on", "On", c.enabled && !c.offHere, () => { c.enabled = true; c.offHere = false; }),
          !def.none && pick("a-off-here", `Off in ${def.name}`, c.enabled && c.offHere, () => { c.enabled = true; c.offHere = true; }),
          pick("a-off", "Off everywhere", !c.enabled, () => { c.enabled = false; })].filter(Boolean)))
        .when(c.enabled && offElsewhere.length > 0, (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${def.none ? "Off" : "Also off"} in ${offElsewhere.join(", ")}`)))))
      .when(Boolean(sel.isNew && sel.starter), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.dim)
        .child("A ready-made automation. Nothing runs until you create it: read it, choose where it runs and change what you like.")))
      .when(Boolean(replacedHere), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.working)
        .child(`${def.name} has its own "${sel.name}", which is the one that runs here. This one runs in the other workspaces.`)))
      .when(Boolean(replacesGlobal), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.working)
        .child(`There's a "${replacesGlobal}" for every workspace. This one replaces it in ${def.name}.`)))
      .child(askBox)
      .child(askNotes)
      .when(!blank, (el) => el
        .child(label_("What it does"))
        .child(summary)
        .when(Boolean(previewPanel), (el) => el.child(previewPanel))
        .child(bodyField)
        .child(detailsRow)
        .when(this.details, (el) => el.child(details))
        .when(Boolean(saved), (el) => el
          .child(label_("Recent runs"))
          .when(!runs.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(def.none ? "Each workspace lists its own runs of it." : "None yet.")))
          .children(runs.map(runRow))
          .child(label_("From another app or a script"))
          .child(div().text_size(11.5).text_color(t.muted).font_family("JetBrains Mono").child(`herdr-ws-run ${def.none ? "<workspace>" : def.id} ${saved.name} "optional text"`))));
    // Run now waits while something waits to be allowed; Save stays for an edit (saving allows what's written).
    const canRun = !saved?.replaced && saved?.allowed !== false;
    return pane
      .child(form)
      .child(v_flex().flex_none().px(18).pb(14).pt(8).border_t(1).border_color(t.border)
        .when(Boolean(this.error), (el) => el.child(div().pb(8).text_size(11.5).text_color(t.blocked).child(this.error)))
        .when(!this.error && Boolean(this.notice), (el) => el.child(div().pb(8).text_size(11.5).text_color(t.done).child(this.notice)))
        // Run now on a `link` one: the {{text}} it gets, if any; Enter or Start runs it.
        .when(this.askText && !sel.isNew, (el) => el.child(h_flex().pb(8).gap(8).items_center()
          .child(div().flex_1().min_w(0).child(box(this.textIn)))
          .child(button("a-run-go", "Start", "plain", (_e, cx) => this.runNow(cx, true), canRun))
          .child(small("a-run-cancel", "Cancel", (_e, cx) => { this.askText = false; this.textIn.set_value(""); cx.notify(); }))))
        .child(h_flex().gap(8).items_center()
          .when(!sel.isNew, (el) => el.child(button("a-delete", this.confirming ? (global ? "Click again: gone from every workspace" : "Click again to delete") : "Delete", "danger", (_e, cx) => this.remove(cx))))
          .when(!sel.isNew && global && !replacedHere && !def.none, (el) => el.child(button("a-custom", `Change for ${def.name}`, "plain", (_e, cx) => this.copyHere(cx), !dirty)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.snap?.file ? tilde(this.snap.file) : sel.isNew && !blank ? `New · will save to ${tilde(`${this.dirOf(sel.scope)}/${typed || "…"}.md`)}` : ""))
          .when(!blank && !def.none, (el) => el.child(button("a-preview", pv ? "Preview again" : "Preview", "plain", (_e, cx) => this.previewRun(cx), !pv?.loading)))
          .when(!sel.isNew && !def.none && !this.askText, (el) => el.child(button("a-run", "Run now", "plain", (_e, cx) => this.runNow(cx), canRun)))
          .child(button("a-save", sel.isNew ? "Create" : "Save", "primary", (_e, cx) => this.save(cx), !blank && (sel.isNew || dirty)))));
  }
}
