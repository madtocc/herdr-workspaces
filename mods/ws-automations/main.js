// Automations: what a workspace runs by itself. A dialog that the sidebar
// footer's Automations row opens, with props { workspace }. Each row has a switch
// that turns the automation on or off at once; a run that's working or waiting
// on you shows in its row, and its Stop (two clicks) closes the run's tab.
//
// An automation is ~/.herdr/workspaces/<id>/automations/<name>.md: front matter
// (description, when, agent, model, effort, folder, card, enabled), then its
// prompt. This screen writes the files. The switcher's runner
// (mods/ws-switcher/automations.js) reads them, starts the runs, and publishes
// both in shared "workspaces.automations" and "workspaces.automation.runs". Run
// now asks it through "workspaces.automation.run", because a dialog's tasks end
// when it closes.
//
// Describe it: you say what you want in words, and Claude drafts every field
// (`claude -p` with no tools and a fixed answer shape, on DRAFT_MODEL). The draft
// fills the editor unsaved, and you read it before Create or Save. On a saved
// automation the same box changes it ("make it hourly"). The fields themselves
// are folded under Details.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, home, readTextFile, writeTextFile, exec, notify, agents, terminals, run } from "herdr";
import { parseWhen, describe, nextAt, shortTime } from "./when.js";
import { KNOBS, words, programOf, knobsIn } from "./knobs.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODEL_WORD = /^[A-Za-z0-9._:/@-]+$/;
const COLUMNS = ["backlog", "todo", "doing", "review", "done"];
const STATE = { working: "working", blocked: "needs you", done: "finished", idle: "finished" };
// Moves a file to the Trash ($1), or into $2 where there's no Trash command. Prints where.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/" && echo "$2"`;

const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const message = (e) => String(e?.message ?? e);
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();
const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");
const pad = (n) => String(n).padStart(2, "0");
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;
const columnsOf = (def) => (Array.isArray(def?.board?.columns) && def.board.columns.length ? def.board.columns : COLUMNS).map((c) => String(c).toLowerCase());
const rel = (def, path) => (path === def.root ? "" : path.startsWith(def.root + "/") ? path.slice(def.root.length + 1) : tilde(path));
const folderChoices = (def) => (def.folders.length ? def.folders : def.children.map((c) => `${def.root}/${c}`)).map((f) => rel(def, f));
const boardAgentOf = (def) => String(def?.board?.agent || "claude");
// The agents the + menu can start (ws-new-menu publishes them), installed here.
const installedAgents = () => (shared("new-menu.agents")?.[""] ?? []).filter((a) => a.installed && Array.isArray(a.run));

// What sets it off, as the When chips group it. A schedule is every, at, cron or once.
const kindOf = (w) => (w.kind === "every" || w.kind === "at" || w.kind === "cron" || w.kind === "once" ? "schedule" : w.kind);
// "once <tomorrow's date> 09:00", on this computer's clock.
const onceTomorrow = () => {
  const d = new Date(Date.now() + 86400e3);
  return `once ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 09:00`;
};
const KINDS = [["schedule", "Schedule"], ["board", "Board"], ["agent", "Agent"], ["files", "Files"], ["github", "GitHub"], ["link", "By hand"]];
const SCHEDULES = ["every 30m", "every 1h", "daily 09:00", "weekdays 09:00", "mon 09:00", "0 9 * * 1-5"];
// The {{…}} a prompt can use, by kind.
const FILLS = {
  schedule: null,
  board: "{{task}} (its ID, title, notes and file), {{task.id}} {{task.title}} {{task.file}}",
  agent: "{{agent}} (its tab) {{terminal}} {{space}}",
  files: "{{files}} (one per line) {{file}}",
  github: "{{pr}} or {{issue}} (number, title, author, link and description), {{number}} {{title}} {{url}} {{author}} {{repo}} {{labels}}",
  link: "{{text}} (what herdr-ws-run was given)",
};

// --- Describe it: the drafter ---

const DRAFT_MODEL = "sonnet";
const DRAFT_TIMEOUT = 120e3;
// What Claude answers with: every field, as strings (card a boolean).
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["name", "description", "when", "agent", "model", "effort", "folder", "card", "prompt", "note"],
  properties: {
    name: { type: "string" }, description: { type: "string" }, when: { type: "string" },
    agent: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, folder: { type: "string" },
    card: { type: "boolean" }, prompt: { type: "string" }, note: { type: "string" },
  },
};
const GUIDE = `You set up automations for Herdr, a desktop app for terminals and coding agents. An automation starts a coding agent by itself, with a prompt, as a new tab in the workspace's "Automations" space, while Herdr is open. The person says what they want in their own words; you answer with the automation's fields. Nothing is saved until they have read your draft and clicked Create or Save.

Fields:
- name: a short file name in lowercase words joined by dashes, saying what it does (board-sync, morning-review). Not one of the names taken.
- description: one line, under 80 characters: what it does.
- when: what sets it off, in exactly one of these forms:
  - every 30m, every 2h, every 1d: an interval of at least a minute, counted from its last run
  - 09:00, daily 9:00, weekdays 09:00,17:30, weekends 10am, mon,wed 8:30, mon-fri 9:00: days and times on this computer's clock
  - 0 9 * * 1-5: cron's five fields (minute hour day month weekday), with lists, ranges and steps
  - once 2026-11-12 06:00: one time, then it turns itself off
  - task enters <column>: a task on the workspace's board moves into that column
  - agent done, agent blocked: an agent in the workspace finishes, or needs the person; a tab name after it listens to that tab only
  - files <folder>: something changes under that folder (from the root)
  - github <folder or owner/name> pr opened, github <folder or owner/name> issue opened, optionally followed by "by others" (leaves out the person's own) and label:<name>: a new pull request or issue on GitHub. It only sees new ones, never edits, comments, moves, assignments or closes; for those, use a schedule whose prompt checks GitHub.
  - link: only when started by hand (Run now) or from a script
  Prefer the plain forms. Use cron only when they can't say it: every 30 minutes on weekdays from 9:00 to 18:30 is */30 9-18 * * 1-5.
- agent: "" for the board's agent, else exactly one of the presets or installed agents listed. A preset that fits the job wins (a reviewer for reviews).
- model and effort: the smallest that does the job well. For claude: haiku for checks, syncs, summaries and reports that read things and update a file or two; sonnet for ordinary code changes and reviews; opus for hard, long or many-step work; fable only when the person asks for the strongest. Effort "" (the default) unless the job is trivial (low) or hard (high). If the agent is a preset that already sets a model that suits the job, leave model "" to keep it. For codex and pi, leave model "" unless the person names one. If the person names a model or an effort, use it. Effort levels: claude low, medium, high, xhigh, max; codex minimal, low, medium, high, xhigh, max; pi off, minimal, low, medium, high, xhigh, max. Other agents take neither: leave both "".
- folder: where it runs. "" for the workspace root (for a github trigger, its repo's folder). Else one of the folders listed, written as listed. Pick the folder the agent's commands need (a git repo for git and gh).
- card: true only when the person wants each run as a card on the board.
- prompt: the agent's whole task. It starts fresh and knows nothing of this conversation, so say what to look at (full paths, repos), what to do, what to leave alone, and how to finish (one line saying what it did or found). Keep it short and concrete, with numbered steps when there are several. It only reads and reports unless the person asks it to change something, and it never pushes, posts, comments, merges, deletes or messages anyone unless the person asked for exactly that. A scheduled check that finds nothing new changes nothing and says so. It can use these fill-ins: {{date}} {{time}} {{workspace}} {{folder}} {{event}} (what set it off); for board triggers {{task}} {{task.id}} {{task.title}} {{task.file}}; agent triggers {{agent}} {{terminal}} {{space}}; files triggers {{files}} {{file}}; github triggers {{pr}} or {{issue}} (number, title, author, link, labels and description) {{number}} {{title}} {{url}} {{author}} {{repo}} {{labels}}; link {{text}}. For anything but a schedule, what set it off is added at the end by itself unless the prompt uses one of these.
- note: one or two short, plain sentences for the person about what you assumed or couldn't know and they should check before saving (a path you guessed, a field the agent has to find). Don't repeat the fields: they're shown already. "" when there's nothing to check.

You can't look anything up. Use only the folders, repos, presets and agents listed. Where the task needs something you don't know (a project number, a list of issues), have the agent find it, and say so in note.

When you're given the current automation, change only what the person asks and copy every other field exactly as it is, the prompt included.`;

// The result message of `claude -p --output-format json` (one object, or a list of messages ending with it).
function draftOf(r) {
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  const res = Array.isArray(out) ? [...out].reverse().find((m) => m?.type === "result") : out;
  if (!res) throw new Error(r.code !== 0 ? (r.stderr.trim().split("\n").pop() || `claude stopped with code ${r.code}`) : "Claude's answer couldn't be read.");
  if (res.is_error) throw new Error(String(res.result || res.subtype || "Claude couldn't draft it."));
  let d = res.structured_output;
  if (!d && typeof res.result === "string") { try { d = JSON.parse(res.result); } catch {} }
  if (!d || typeof d !== "object") throw new Error("Claude didn't send back a draft.");
  return d;
}

// --- the file: front matter (`key: value` lines, others kept), then the prompt ---

function split(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(text ?? "");
  if (!m) return { head: [], body: text ?? "" };
  return { head: m[1] ? m[1].split(/\r?\n/) : [], body: (text ?? "").slice(m[0].length) };
}
function unquote(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v.startsWith("'")) return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  const hash = v.search(/\s#/);
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}
function field(head, key) {
  const line = head.find((l) => l.startsWith(`${key}:`));
  return line === undefined ? null : unquote(line.slice(key.length + 1));
}
// As written, unless the reader would take part of it for a quote or a comment.
const plain = (v) => (/^["']|\s#/.test(v) ? JSON.stringify(v) : v);
function automationText(old, fields, body) {
  const head = [...split(old ?? "").head];
  for (const [k, v] of Object.entries(fields)) {
    const i = head.findIndex((l) => l.startsWith(`${k}:`));
    if (v === null || v === "") { if (i >= 0) head.splice(i, 1); continue; }
    const line = `${k}: ${plain(oneLine(v))}`;
    if (i >= 0) head[i] = line; else head.push(line);
  }
  return `---\n${head.join("\n")}\n---\n${body.trim()}\n`;
}

// A run's state now: its agent's status, else whether its terminal is still open.
function runState(r, ag, tm) {
  if (!r) return null;
  if (r.status !== "started") return r.status;
  const a = ag.find((x) => x.address === r.terminal);
  if (a) return STATE[a.status] ?? a.status;
  // Not an agent (or not one that reports): its tab is still open, or it's gone.
  return tm.some((x) => x.address === r.terminal && x.state === "live") ? "open" : "closed";
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
  const known = (shared("new-menu.agents")?.[""] ?? []).find((a) => a.key === name);
  return { name, preset: null, argv: known?.run ?? [name] };
}

export default class Automations extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.workspace = props()?.workspace ?? null;
    this.nameIn = InputState.new({ value: "", placeholder: "daily-review" });
    this.descIn = InputState.new({ value: "", placeholder: "What it does, in one line" });
    this.whenIn = InputState.new({ value: "", placeholder: "weekdays 09:00" });
    this.bodyIn = TextareaState.new({ value: "", rows: 8, placeholder: "The agent's task: what to do and how to report back." });
    // Describe it: one box for a new automation, one for a change to what's there.
    this.askIn = TextareaState.new({ value: "", rows: 3, placeholder: "For example: every weekday at 9, list yesterday's merged PRs in api that still need docs" });
    this.changeIn = InputState.new({ value: "", placeholder: "Change it in words: make it hourly, only on Mondays, use opus…" });
    this.modelIn = InputState.new({ value: "", placeholder: "another model, then Enter" });
    this.modelIn.on("submit", (_e, cx) => {
      const model = this.modelIn.value().trim();
      if (MODEL_WORD.test(model)) this.choice.model = model;
      this.modelIn.set_value("");
      cx.notify();
    });
    for (const input of [this.askIn, this.changeIn]) input.on("submit", (e, cx) => { if (!e.shift) this.draft(cx); });
    // The editor follows the fields as you type; the one being typed in has the accent border.
    this.focusedIn = null;
    for (const input of [this.nameIn, this.descIn, this.whenIn, this.bodyIn, this.askIn, this.changeIn, this.modelIn]) {
      input.on("change", (_e, cx) => cx.notify());
      input.on("focus", (_e, cx) => { this.focusedIn = input; cx.notify(); });
      input.on("blur", (_e, cx) => { if (this.focusedIn === input) this.focusedIn = null; cx.notify(); });
    }
    this.sel = null;  // { name, isNew }
    this.snap = null; // what was loaded: { text, file, name, description, when, agent, model, effort, folder, card, enabled, body }
    this.choice = { agent: "", model: "", effort: "", folder: "", card: false, enabled: true };
    this.details = false; // the fields shown, not just the summary
    this.manual = false;  // a new one being filled in by hand, before any draft
    this.drafting = null; // the selection a draft is for, while Claude works
    this.drafted = false; // the editor holds a draft not saved yet
    this.draftNote = null;
    this.draftError = null;
    // The workspace's folders with a GitHub remote, for the GitHub chips and the drafter.
    this.ghRepos = [];
    // Codex's models, from its config.
    this.codexModels = [];
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${home()}/.codex/config.toml`).catch(() => null);
      this.codexModels = [...new Set([...(text ?? "").matchAll(/^\s*model\s*=\s*"([^"]+)"/gm)].map((m) => m[1]))];
      cx.notify();
    });
    const def = defOf(this.workspace);
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

  def() { return defOf(this.workspace); }
  // A new one shows only the Describe box until it's drafted or you choose to fill it in.
  blank() { return Boolean(this.sel?.isNew && !this.drafted && !this.manual); }
  askState() { return this.blank() ? this.askIn : this.changeIn; }
  list() { return (shared("workspaces.automations") ?? {})[this.workspace] ?? []; }

  dirty() {
    const s = this.snap, c = this.choice;
    if (!s) return false;
    return (this.sel?.isNew && this.nameIn.value().trim() !== s.name)
      || this.descIn.value() !== s.description || this.whenIn.value() !== s.when || this.bodyIn.value().trim() !== s.body
      || c.agent !== s.agent || c.model !== s.model || c.effort !== s.effort || c.folder !== s.folder || c.card !== s.card || c.enabled !== s.enabled;
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
    this.askIn.set_value("");
    this.changeIn.set_value("");
    // `cx` is passed in: the click's own is gone by the time the file has been read.
    const load = (snap, cx) => {
      this.sel = sel;
      this.snap = snap;
      this.nameIn.set_value(snap.name);
      this.descIn.set_value(snap.description);
      this.whenIn.set_value(snap.when);
      this.bodyIn.set_value(snap.body);
      this.choice = { agent: snap.agent, model: snap.model, effort: snap.effort, folder: snap.folder, card: snap.card, enabled: snap.enabled };
      cx.notify();
    };
    if (fill) return load({ text: null, file: null, ...fill }, cx);
    const file = `${this.def()?.dir}/automations/${sel.name}.md`;
    cx.spawn(async (cx) => {
      const text = await readTextFile(file);
      if (text === null) { this.error = `${tilde(file)} is gone.`; cx.notify(); return; }
      const { head, body } = split(text);
      load({
        text, file, name: sel.name, description: field(head, "description") ?? "", when: field(head, "when") ?? "",
        agent: field(head, "agent") ?? "", model: field(head, "model") ?? "", effort: field(head, "effort") ?? "", folder: field(head, "folder") ?? "",
        card: /^(true|yes|on|1)$/i.test(field(head, "card") ?? ""), enabled: !/^(false|no|off|0)$/i.test(field(head, "enabled") ?? ""),
        body: body.trim(),
      }, cx);
    });
  }

  fresh(cx) {
    const names = new Set(this.list().map((a) => a.name));
    let n = 1;
    while (names.has(`automation-${n}`)) n++;
    this.pick({ name: "", isNew: true }, {
      name: `automation-${n}`, description: "", when: "weekdays 09:00", agent: "", model: "", effort: "", folder: "", card: false, enabled: true, body: "",
    }, cx);
    this.askIn.focus();
  }

  // --- Describe it ---

  // What the drafter is told: the workspace, what it offers, the time, the automation so far, and the ask.
  request(def, ask, current, retry) {
    const presets = presetsFor(def.id);
    const d = new Date();
    const lines = [
      `Workspace: ${def.name} (id ${def.id}). Root: ${def.root}`,
      `Folders, from the root: ${folderChoices(def).join(", ") || "none"}`,
      `GitHub repos: ${this.ghRepos.map((g) => `${g.folder} is ${g.repo}`).join("; ") || "none found"}`,
      `Board columns: ${columnsOf(def).join(", ")}. The board's agent: ${boardAgentOf(def)}`,
      `Presets: ${presets.map((p) => `${p.name} (runs: ${p.command ?? "?"})${p.description ? `: ${p.description}` : ""}`).join("; ") || "none"}`,
      `Installed agents: ${installedAgents().map((a) => a.key).join(", ") || "claude"}`,
      `Names taken: ${this.list().map((a) => a.name).join(", ") || "none"}`,
      `Now: ${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}, this computer's clock`,
    ];
    if (current) lines.push("", "The current automation (change only what's asked):", JSON.stringify(current, null, 2));
    lines.push("", "What the person wants:", ask);
    if (retry) lines.push("", `Your last draft's when line "${retry.when}" can't be read: ${retry.problem} Answer again, with one that can.`);
    return lines.join("\n");
  }

  async askClaude(text) {
    const r = await exec("claude", ["-p", text, "--model", DRAFT_MODEL, "--system-prompt", GUIDE,
      "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--disable-slash-commands",
      "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA)], { cwd: "/tmp", timeout: DRAFT_TIMEOUT });
    return draftOf(r);
  }

  // The fields as they are in the editor, for a change in words.
  current() {
    const c = this.choice;
    return {
      name: this.sel.isNew ? this.nameIn.value().trim() : this.sel.name, description: this.descIn.value(), when: this.whenIn.value(),
      agent: c.agent, model: c.model, effort: c.effort, folder: c.folder, card: c.card, prompt: this.bodyIn.value().trim(),
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
        let d = await this.askClaude(this.request(def, ask, current, null));
        const w = parseWhen(oneLine(d.when));
        if (w.kind === "error") d = await this.askClaude(this.request(def, ask, current, { when: d.when, problem: w.error }));
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
    if (this.sel.isNew) {
      const base = s(d.name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 60);
      if (NAME.test(base)) {
        const taken = new Set(this.list().map((a) => a.name));
        let name = base, n = 2;
        while (taken.has(name)) name = `${base}-${n++}`;
        this.nameIn.set_value(name);
      }
    }
    this.descIn.set_value(oneLine(d.description));
    if (s(d.when)) this.whenIn.set_value(oneLine(d.when));
    if (s(d.prompt)) this.bodyIn.set_value(s(d.prompt));
    const c = this.choice;
    const agent = s(d.agent);
    const okAgent = !agent || presetsFor(def.id).some((p) => p.name === agent) || installedAgents().some((a) => a.key === agent) ? agent : c.agent;
    const folder = s(d.folder);
    const okFolder = !folder || folderChoices(def).includes(folder) ? folder : c.folder;
    const knobs = KNOBS[programOf(commandOf(def, okAgent).argv)];
    const model = knobs && MODEL_WORD.test(s(d.model)) ? s(d.model) : "";
    const effort = knobs && knobs.effort.levels.includes(s(d.effort)) ? s(d.effort) : "";
    this.choice = { ...c, agent: okAgent, model, effort, folder: okFolder, card: d.card === true };
  }

  save(cx) {
    const sel = this.sel, def = this.def();
    if (!sel || !def || this.busy) return;
    const name = sel.isNew ? this.nameIn.value().trim() : sel.name;
    const when = oneLine(this.whenIn.value());
    const trigger = parseWhen(when);
    const showDetails = (why) => { this.error = why; this.details = true; cx.notify(); };
    if (!NAME.test(name)) return showDetails("A name is letters, digits, dots, dashes or underscores, starting with a letter or digit.");
    if (sel.isNew && this.list().some((a) => a.name === name)) return showDetails(`There's already an automation called "${name}".`);
    if (trigger.kind === "error") return showDetails(trigger.error);
    const c = this.choice;
    const file = `${def.dir}/automations/${name}.md`;
    const body = this.bodyIn.value();
    const text = automationText(sel.isNew ? null : this.snap.text, {
      description: this.descIn.value(), when, agent: c.agent, model: c.model, effort: c.effort, folder: c.folder,
      card: c.card ? "true" : null, enabled: c.enabled ? null : "false",
    }, body);
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(file, text, sel.isNew ? null : this.snap.text);
        updateShared(def.id, name, {
          name, file, description: oneLine(this.descIn.value()), when, trigger, summary: describe(trigger),
          agent: c.agent || null, model: c.model || null, effort: c.effort || null, folder: c.folder || null, card: c.card, enabled: c.enabled,
          body: body.replace(/<!--[\s\S]*?-->/g, "").trim(), error: null, next: null, warning: null,
        });
        this.sel = { name, isNew: false };
        this.snap = { text, file, name, description: this.descIn.value(), when: this.whenIn.value(), ...c, body: body.trim() };
        this.drafted = false;
        this.draftNote = null;
        this.error = null;
        this.notice = c.enabled ? "Saved. It's on." : "Saved. It's off: only Run now and herdr-ws-run start it.";
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
        updateShared(this.workspace, sel.name, null);
        notify({ title: `Deleted the ${sel.name} automation`, body: r.stdout.trim() === "Trash" ? "Its file is in the Trash." : `Its file is in ${tilde(r.stdout.trim())}.`, level: "success" });
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
  toggle(a, cx) {
    const open = this.sel && !this.sel.isNew && this.sel.name === a.name;
    if (open && this.dirty()) { this.error = "Save or discard this automation's changes first."; cx.notify(); return; }
    const on = !a.enabled, ws = this.workspace;
    updateShared(ws, a.name, { ...a, enabled: on, next: on ? a.next : null });
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const old = await readTextFile(a.file);
        if (old === null) throw new Error(`${tilde(a.file)} is gone.`);
        const text = automationText(old, { enabled: on ? null : "false" }, split(old).body);
        await writeTextFile(a.file, text, old);
        if (this.sel && !this.sel.isNew && this.sel.name === a.name && this.snap) {
          this.snap = { ...this.snap, text, enabled: on };
          this.choice.enabled = on;
        }
      } catch (e) {
        updateShared(ws, a.name, a);
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

  // The switcher's sidebar copy starts it: this dialog's tasks end when it closes.
  runNow(cx) {
    if (!this.sel || this.sel.isNew) return;
    if (this.dirty()) { this.error = "Save it first: Run now starts what's saved."; cx.notify(); return; }
    setShared("workspaces.automation.run", { workspace: this.workspace, name: this.sel.name, at: Date.now() });
    this.error = null;
    this.notice = "Starting it as a tab in the Automations space…";
    cx.notify();
  }

  goTo(r) {
    closeOverlay(props().overlay);
    run("space.select", { id: r.space });
    run("tab.select", { id: r.tab });
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
        .when(Boolean(def), (el) => el.child(div().text_size(12.5).text_color(t.dim).child(`for ${def.name}`)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("Esc")));
    if (!def) {
      return shell.child(div().p(18).text_color(t.muted).child("Automations belong to a workspace. Pick one in the switcher first, then open this again."));
    }
    const autos = this.list();
    const runs = (shared("workspaces.automation.runs") ?? []).filter((r) => r.ws === def.id);
    const ag = agents(), tm = terminals();
    // On or off at a click: a track with its knob at the right when it's on.
    const toggle = (a) => h_flex().id(`a-sw-${a.name}`).w(26).h(15).p(2).flex_none().rounded_full().items_center().cursor_pointer()
      .bg(a.enabled ? t.accent : t.input).when(a.enabled, (el) => el.justify_end())
      .tooltip(a.enabled ? "On. Click to turn it off" : "Off. Click to turn it on")
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(a, cx); })
      .child(div().size(11).rounded_full().bg(t.background));
    const item = (a) => {
      const on = this.sel && !this.sel.isNew && this.sel.name === a.name;
      const dot = a.error ? t.blocked : a.enabled ? t.done : t.dim;
      // Its newest run, while that's working or waiting on you.
      const now = runState(runs.find((r) => r.name === a.name && r.status === "started"), ag, tm);
      const busy = now === "working" || now === "needs you" ? now : null;
      return h_flex().id(`a-${a.name}`).h(46).mx(6).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => this.pick({ name: a.name, isNew: false }, null, cx))
        .child(div().size(7).flex_none().rounded_full().bg(dot))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_color(a.enabled ? t.foreground : t.muted).child(a.name))
          .child(div().truncate().text_size(11).text_color(a.error ? t.blocked : t.dim).child(a.error ? "Can't read its when" : a.summary)))
        .child(div().flex_none().text_size(11).text_color(busy === "working" ? t.working : busy ? t.blocked : t.dim)
          .child(busy ?? (!a.enabled ? "off" : a.next ? shortTime(a.next) : "")))
        .child(toggle(a));
    };
    const list = v_flex().w(260).flex_none().min_h(0).border_r(1).border_color(t.border).bg(t.chrome)
      .child(div().p(10).child(h_flex().id("a-new").h(30).px(12).gap(6).items_center().justify_center().rounded(8).cursor_pointer()
        .bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium().hover((s) => s.opacity(0.88))
        .on_click((_e, cx) => this.fresh(cx)).child(svg("mods/workspace-chrome/plus.svg").size(13)).child("New automation")))
      .child(v_flex().id("a-list").flex_1().min_h(0).pb(10).overflow_y_scrollbar()
        .children(autos.map(item))
        .when(!autos.length, (el) => el.child(div().px(14).pt(4).text_size(12).text_color(t.dim).child("None yet."))));
    return shell.child(h_flex().flex_1().min_h(0).items_stretch().child(list).child(this.editor(t, def)));
  }

  editor(t, def) {
    const pane = v_flex().flex_1().min_w(0).min_h(0);
    if (!this.sel) {
      return pane.p(18).gap(10).text_color(t.muted).text_size(12.5)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Pick an automation, or make a new one."))
        .child(div().child(`An automation starts an agent by itself: on a schedule, when a task enters a board column, when an agent finishes or needs you, when files change, when a PR or issue is opened on GitHub, or when another app calls it.`))
        .child(div().child(`New automation asks what it should do, in your words. Claude drafts it, and nothing is saved until you've read it.`))
        .child(div().child(`Each run is a tab in ${def.name}'s Automations space, made the first time. Your view stays where it is.`))
        .child(div().child(`They run while Herdr is open. A schedule missed while it was closed or the Mac slept runs once when it can, if that's within 12 hours. A one-time schedule turns itself off after it runs.`))
        .child(div().child(`The files are in ${tilde(def.dir)}/automations.`));
    }
    const sel = this.sel, c = this.choice;
    const saved = sel.isNew ? null : this.list().find((a) => a.name === sel.name) ?? null;
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
    const button = (id, text, kind, action, enabled = true) => h_flex().id(id).h(32).px(13).items_center().rounded(8).border_1()
      .border_color(kind === "primary" ? t.solid : t.input).bg(kind === "primary" ? t.solid : t.raised)
      .text_color(kind === "primary" ? t.solid_foreground : kind === "danger" ? t.blocked : t.foreground)
      .text_size(12.5).font_medium().when(!enabled || this.busy, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action)).child(text);
    // A choice chip: highlighted when it's the one chosen.
    const pick = (id, text, on, action) => div().id(id).h(26).px(10).flex().items_center().rounded(13).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(12)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(text);
    const chips = (...kids) => h_flex().gap(6).flex_wrap().items_center().children(kids);
    const setWhen = (v) => this.whenIn.set_value(v);
    // The github line with one part changed, the rest kept.
    const setGithub = (patch) => {
      const g = { repo: w.repo, what: w.what, others: w.others, label: w.label, ...patch };
      setWhen(`github ${g.repo} ${g.what} opened${g.others ? " by others" : ""}${g.label ? ` label:${/\s/.test(g.label) ? JSON.stringify(g.label) : g.label}` : ""}`);
    };
    const columns = columnsOf(def);
    const finish = String(def.board?.finish ?? "review").toLowerCase();
    const firstOf = { github: `github ${this.ghRepos[0]?.folder ?? "owner/name"} pr opened`, schedule: "weekdays 09:00", board: `task enters ${columns.includes(finish) ? finish : columns[columns.length - 1]}`, agent: "agent done", files: `files ${folderChoices(def)[0] ?? "inbox"}`, link: "link" };
    const quick = kind === "schedule" ? [...SCHEDULES.map((s) => pick(`a-q-${s}`, s, this.whenIn.value().trim() === s, () => setWhen(s))),
      pick("a-q-once", "once tomorrow 09:00", w.kind === "once", () => setWhen(onceTomorrow()))]
      : kind === "board" ? columns.map((col) => pick(`a-q-${col}`, label(col), w.column === col, () => setWhen(`task enters ${col}`)))
      : kind === "agent" ? [pick("a-q-done", "Finishes", w.status === "done", () => setWhen("agent done")), pick("a-q-blocked", "Needs you", w.status === "blocked", () => setWhen("agent blocked"))]
      : kind === "files" ? folderChoices(def).map((f) => pick(`a-q-f-${f}`, f, w.folder === f, () => setWhen(`files ${f}`)))
      : kind === "github" ? [
        ...this.ghRepos.map((g) => pick(`a-q-gh-${g.folder}`, g.folder, w.repo === g.folder || w.repo === g.repo, () => setGithub({ repo: g.folder }))),
        div().w(8),
        pick("a-q-gh-pr", "Pull requests", w.what === "pr", () => setGithub({ what: "pr" })),
        pick("a-q-gh-issue", "Issues", w.what === "issue", () => setGithub({ what: "issue" })),
        pick("a-q-gh-others", "By others only", w.others, () => setGithub({ others: !w.others })),
      ]
      : [];
    const presets = presetsFor(def.id);
    const boardAgent = boardAgentOf(def);
    // The agent it starts, and the model and effort that will run: its own, else what its command sets.
    const cmd = commandOf(def, c.agent);
    const program = programOf(cmd.argv);
    const knobs = KNOBS[program] ? { ...KNOBS[program], models: program === "codex" ? this.codexModels : KNOBS[program].models } : null;
    const own = knobsIn(cmd.argv);
    const models = knobs ? [...new Set([...knobs.models, ...(own.model ? [own.model] : []), ...(c.model ? [c.model] : [])])] : [];
    const model = c.model || own.model, effort = c.effort || own.effort;
    const who = `${c.agent || boardAgent}${cmd.preset && program && program !== cmd.name ? ` (${program})` : ""}`;
    const knobText = [model && `on ${model}`, effort && `${effort} effort`].filter(Boolean).join(", ");
    const where = c.folder || (kind === "github" ? "its repo's folder" : "the root");
    const runsText = `Starts ${who}${knobText ? ` ${knobText}` : ""}, in ${where}${c.card ? ", with a board card each run" : ""}.`;
    const noKnobs = !knobs && (c.model || c.effort);

    const runs = saved ? (shared("workspaces.automation.runs") ?? []).filter((r) => r.ws === def.id && r.name === saved.name).slice(0, 4) : [];
    const ag = agents(), tm = terminals();
    const runRow = (r) => {
      const state = runState(r, ag, tm);
      const color = state === "working" ? t.working : state === "needs you" ? t.blocked : state === "failed" ? t.blocked : t.dim;
      const live = state !== "closed" && r.status === "started" && r.tab;
      return h_flex().id(`a-run-${r.id}`).h(26).gap(10).items_center().text_size(12)
        .child(div().w(70).flex_none().text_color(t.dim).child(shortTime(r.at)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.note ? `${r.why}. ${r.note}` : r.why))
        .child(div().flex_none().text_color(color).child(state))
        .when(Boolean(live) && (state === "working" || state === "needs you" || state === "open"), (el) => el.child(div().id(`a-stop-${r.id}`).flex_none().px(8).h(22).flex().items_center()
          .rounded(6).border_1().border_color(t.input).text_size(11.5).text_color(t.blocked).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.stop(r, cx)).child(this.stopping === r.id ? "Click again to stop" : "Stop")))
        .when(Boolean(live), (el) => el.child(div().id(`a-go-${r.id}`).flex_none().px(8).h(22).flex().items_center().rounded(6).border_1().border_color(t.input)
          .text_size(11.5).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.goTo(r)).child("Go to")));
    };

    // Describe it: a box for a new one (Draft it), or one line to change what's there (Change it).
    const working = h_flex().gap(8).items_center()
      .child(svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.working).spin(900))
      .child(div().text_size(11.5).text_color(t.muted).child(`Claude (${DRAFT_MODEL}) is drafting it…`));
    const canDraft = !drafting && Boolean(ask.value().trim());
    const askBox = blank
      ? v_flex().pt(4)
        .child(div().pb(8).text_size(12.5).text_color(t.muted).child("Say what it should do and when, in your own words. Claude drafts it, and you read the draft before it's saved."))
        .child(div().h(92).flex_none().child(Textarea.new(ask).size_full().p(10).rounded(8).border_1()
          .border_color(this.focusedIn === ask ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground)))
        .child(h_flex().pt(8).gap(8).items_center()
          .when(drafting, (el) => el.child(working))
          .when(!drafting, (el) => el.child(div().id("a-manual").text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
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
      .when(Boolean(this.draftNote), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.working).child(`Check: ${this.draftNote}`)));

    // What it does, in words: when, then what it starts and where.
    const summary = v_flex().gap(3)
      .child(div().text_size(13).text_color(w.kind === "error" ? t.blocked : t.foreground)
        .child(w.kind === "error" ? w.error : `${describe(w)}${next ? ` · next ${shortTime(next)}` : ""}${w.kind === "github" ? " · looks every 2 minutes, with your gh login" : ""}`))
      .child(div().text_size(12).text_color(t.muted).child(runsText))
      .when(Boolean(noKnobs), (el) => el.child(div().text_size(11.5).text_color(t.working).child(`${who} doesn't take a model or effort here, so they're left out when it runs.`)))
      .when(Boolean(saved?.warning), (el) => el.child(div().text_size(11.5).text_color(t.working).child(saved.warning)));

    const detailsRow = h_flex().id("a-details").mt(16).h(30).gap(6).items_center().cursor_pointer().border_t(1).border_color(t.border).pt(12)
      .on_click((_e, cx) => { this.details = !this.details; cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${this.details ? "down" : "right"}.svg`).size(13).text_color(t.muted))
      .child(div().text_size(12.5).font_medium().child("Details"))
      .child(div().text_size(11.5).text_color(t.dim).child(sel.isNew ? "name, when, agent, model, folder" : "when, agent, model, folder"));

    const details = v_flex()
      .when(sel.isNew, (el) => el.child(label_("Name: its file's name, and what herdr-ws-run calls it")).child(box(this.nameIn)))
      .child(label_("Description")).child(box(this.descIn))
      .child(label_("When"))
      .child(chips(...KINDS.map(([k, text]) => pick(`a-k-${k}`, text, kind === k, () => { if (kind !== k) setWhen(firstOf[k]); }))))
      .child(div().pt(8).child(box(this.whenIn, true)))
      .when(quick.length > 0, (el) => el.child(div().pt(8).child(chips(...quick))))
      .child(label_("Agent: a preset, or the board's agent"))
      .child(chips(pick("a-ag-default", `Board's (${boardAgent})`, !c.agent, () => { c.agent = ""; }),
        ...presets.map((p) => pick(`a-ag-${p.name}`, p.name, c.agent === p.name, () => { c.agent = p.name; })),
        ...(c.agent && !presets.some((p) => p.name === c.agent) ? [pick("a-ag-other", c.agent, true, () => {})] : [])))
      .when(Boolean(knobs), (el) => el
        .child(label_(cmd.preset ? `Model: Default is what ${cmd.name} sets` : "Model"))
        .child(h_flex().gap(6).flex_wrap().items_center()
          .child(pick("a-model-default", own.model ? `Default (${own.model})` : program === "codex" && this.codexModels[0] ? `Default (${this.codexModels[0]})` : "Default", !c.model, () => { c.model = ""; }))
          .children(models.map((m) => pick(`a-model-${m}`, m, c.model === m, () => { c.model = m; })))
          .child(div().w(190).child(Input.new(this.modelIn).h(26).px(8).rounded(13).border_1().border_color(this.focusedIn === this.modelIn ? t.accent : t.input).bg(t.background).text_size(11.5).text_color(t.foreground))))
        .child(label_("Effort"))
        .child(h_flex().gap(6).flex_wrap()
          .child(pick("a-effort-default", own.effort ? `Default (${own.effort})` : "Default", !c.effort, () => { c.effort = ""; }))
          .children(knobs.effort.levels.map((l) => pick(`a-effort-${l}`, l, c.effort === l, () => { c.effort = l; })))))
      .child(label_("Folder: where it runs"))
      .child(chips(pick("a-fo-root", kind === "github" ? "Its repo's folder" : "Root", !c.folder, () => { c.folder = ""; }),
        ...folderChoices(def).map((f) => pick(`a-fo-${f}`, f, c.folder === f, () => { c.folder = f; })),
        ...(c.folder && !folderChoices(def).includes(c.folder) ? [pick("a-fo-other", c.folder, true, () => {})] : [])))
      .child(label_("Each run"))
      .child(chips(pick("a-card-no", "Just its tab", !c.card, () => { c.card = false; }), pick("a-card-yes", "A tab and a board card", c.card, () => { c.card = true; })));

    // Its own id per automation, so each opens scrolled to the top.
    const title = sel.isNew ? (this.drafted || this.manual ? this.nameIn.value().trim() || "New automation" : "New automation") : sel.name;
    const form = v_flex().id(`a-form-${sel.isNew ? "+new" : sel.name}`).flex_1().min_h(0).px(18).pt(18).pb(8).overflow_y_scrollbar()
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(16).font_semibold().child(title))
        .when(dirty && !blank, (el) => el.child(div().text_size(11.5).text_color(t.working).child(this.drafted ? "drafted, not saved" : "unsaved")))
        .child(div().flex_1())
        .when(!blank, (el) => el.child(chips(pick("a-on", "On", c.enabled, () => { c.enabled = true; }), pick("a-off", "Off", !c.enabled, () => { c.enabled = false; })))))
      .child(askBox)
      .child(askNotes)
      .when(!blank, (el) => el
        .child(label_("What it does"))
        .child(summary)
        .child(label_("Prompt: the agent's task"))
        .child(div().h(150).flex_none().child(Textarea.new(this.bodyIn).size_full().p(10).rounded(8).border_1().border_color(this.focusedIn === this.bodyIn ? t.accent : t.input)
          .bg(t.background).text_size(12.5).text_color(t.foreground)))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Fill-ins: ${[FILLS[kind], "{{event}} {{workspace}} {{folder}} {{date}} {{time}}"].filter(Boolean).join(" · ")}.`))
        .when(kind !== null && kind !== "schedule", (el) => el.child(div().pt(2).text_size(11.5).text_color(t.dim)
          .child("What set it off is added at the end, unless the prompt uses {{event}} or one of the fill-ins above.")))
        .child(detailsRow)
        .when(this.details, (el) => el.child(details))
        .when(Boolean(saved), (el) => el
          .child(label_("Recent runs"))
          .when(!runs.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("None yet.")))
          .children(runs.map(runRow))
          .child(label_("From another app or a script"))
          .child(div().text_size(11.5).text_color(t.muted).font_family("JetBrains Mono").child(`herdr-ws-run ${def.id} ${saved.name} "optional text"`))));
    return pane
      .child(form)
      .child(v_flex().flex_none().px(18).pb(14).pt(8).border_t(1).border_color(t.border)
        .when(Boolean(this.error), (el) => el.child(div().pb(8).text_size(11.5).text_color(t.blocked).child(this.error)))
        .when(!this.error && Boolean(this.notice), (el) => el.child(div().pb(8).text_size(11.5).text_color(t.done).child(this.notice)))
        .child(h_flex().gap(8).items_center()
          .when(!sel.isNew, (el) => el.child(button("a-delete", this.confirming ? "Click again to delete" : "Delete", "danger", (_e, cx) => this.remove(cx))))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.snap?.file ? tilde(this.snap.file) : ""))
          .when(!sel.isNew, (el) => el.child(button("a-run", "Run now", "plain", (_e, cx) => this.runNow(cx))))
          .child(button("a-save", sel.isNew ? "Create" : "Save", "primary", (_e, cx) => this.save(cx), !blank && (sel.isNew || dirty)))));
  }
}
