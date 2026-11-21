// Agent presets: see, make and edit them. A dialog the sidebar footer's
// "Agent presets" row (ws-chrome) opens with props { workspace } (null: no
// workspace shown).
//
// Global presets are herdr-core's templates (~/.config/herdr-core/templates,
// which `hc run <name>` also starts); a workspace's own are in
// ~/.herdr/workspaces/<id>/agents and win over a global one by name. The format
// is herdr-core's: front matter `description` and `command` (values as written),
// instructions as the body. Other front matter lines (ready, submit, …) are kept.
// `guide: off` leaves Herdr's global guide (~/.herdr/AGENTS.md) out for that
// preset; the editor's "Herdr guide" choice writes it, and the list's foot has the
// switch for every agent (ws-switcher/bin/herdr-ws-agent --guide on|off).
//
// The switcher loads presets into shared "workspaces.presets"; this writes the
// files and updates that list at once, and the switcher's folder watch confirms
// it. Start asks the switcher to run one (shared "workspaces.launch"), because a
// dialog's tasks end when it closes.
//
// The same mod is the Start dialog, props { start: <preset name>, workspace }:
// the preset, where it will run, and a task for its first message (optional).
//
// The list's foot also has "Agents in the + menu": a pane with a switch per installed
// agent that hides it from ws-new-menu or brings it back (~/.herdr/agent-menu.json,
// mirrored in shared "new-menu.hidden"; hidefacts.js, a copy of ws-new-menu's). The + menu's
// "Choose agents…" opens this screen on it, props { workspace, pane: "agents" }.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, shared, setShared, props, openOverlay, closeOverlay, home, readTextFile, writeTextFile, exec, notify, spaces, focused, window, knownAgents } from "herdr";
import * as fs from "fs/promises";
import { HIDDEN, hiddenFile, parseHidden, saveHidden, shownAgents, countLine, notInstalledLine } from "./hidefacts.js";
import { KNOBS, words, joinWords, programOf, flagValue, configValue, withFlag, withEffort, swapProgram, configModels, listable, keptModels, listModels, shownModels } from "./knobs.js";

const templatesDir = () => `${home()}/.config/herdr-core/templates`;
const modKey = () => (window()?.platform === "macos" ? "⌘" : "Ctrl+");
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Moves a file to the Trash ($1), or into $2 where there's no Trash command. Prints where.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/" && echo "$2"`;

const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const base = (p) => p.replace(/\/+$/, "").split("/").pop();
const oneLine = (s) => s.replace(/\s*\n\s*/g, " ").trim();
const message = (e) => String(e?.message ?? e);
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;

// The program a command line runs (knobs.js reads the words), and the installed
// agent that runs it: the one whose run has that program, else the one of that key.
const programIn = (command) => programOf(words(command ?? ""));
const agentFor = (known, program) => known.find((k) => Array.isArray(k.run) && programOf(k.run) === program) ?? known.find((k) => k.key === program) ?? null;

// A preset file: front matter between --- lines, then the instructions.
function split(text) {
  const t = (text ?? "").replace(/\r\n/g, "\n");
  const end = t.startsWith("---\n") ? t.indexOf("\n---", 3) : -1;
  if (end < 0) return { head: [], body: t.trim() };
  return { head: t.slice(4, end).split("\n").filter((l) => l.trim()), body: t.slice(end + 4).replace(/^\n/, "").trim() };
}
const field = (head, key) => {
  const line = head.find((l) => l.split(":")[0].trim() === key);
  return line === undefined ? "" : line.slice(line.indexOf(":") + 1).trim();
};
// The file with description and command set (as written, one line) and the rest kept.
function presetText(old, description, command, body, guide = true) {
  const head = split(old).head;
  for (const [key, value] of [["description", oneLine(description)], ["command", oneLine(command)], ["guide", guide ? "" : "off"]]) {
    const i = head.findIndex((l) => l.split(":")[0].trim() === key);
    if (!value) { if (i >= 0) head.splice(i, 1); continue; }
    if (i >= 0) head[i] = `${key}: ${value}`;
    else head.push(`${key}: ${value}`);
  }
  return `---\n${head.join("\n")}\n---\n${body.trim()}\n`;
}

// shared "workspaces.presets" with one preset added, changed or (null) gone.
function updateShared(scope, workspace, name, record) {
  const all = JSON.parse(JSON.stringify(shared("workspaces.presets") ?? { global: [], workspaces: {} }));
  const list = scope === "global" ? (all.global ??= []) : ((all.workspaces ??= {})[workspace] ??= []);
  const i = list.findIndex((x) => x.name === name);
  if (i >= 0) list.splice(i, 1);
  if (record) { list.push(record); list.sort((a, b) => a.name.localeCompare(b.name)); }
  setShared("workspaces.presets", all);
}

// The presets a workspace offers: its own, then the global ones it doesn't override.
function presetsFor(id) {
  const p = shared("workspaces.presets") ?? {};
  const own = (id && p.workspaces?.[id]) || [];
  return [...own, ...(p.global ?? []).filter((g) => !own.some((o) => o.name === g.name))].filter((x) => !x.error);
}

// After a restart (ws-switcher/bin/herdr-ws-resume): whether agents come back
// (~/.herdr/resume/switch), how many have notes, and whether herdr-core's
// config.toml starts terminals through the script.
const resumeBin = () => `${home()}/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-resume`;
async function resumeState() {
  const dir = `${home()}/.herdr/resume`;
  const on = ((await readTextFile(`${dir}/switch`).catch(() => null)) ?? "").trim() !== "off";
  let count = 0;
  for (const core of await fs.readdir(dir).catch(() => [])) {
    count += (await fs.readdir(`${dir}/${core}`).catch(() => [])).filter((f) => f.endsWith(".cmd")).length;
  }
  const config = await readTextFile(`${home()}/.config/herdr-core/config.toml`).catch(() => null);
  return { on, count, ready: (config ?? "").includes("herdr-ws-resume") };
}

// Herdr's global guide (ws-switcher/bin/herdr-ws-agent): whether agents get it
// (~/.herdr/guide/switch), and the file's size in characters (0: no guide yet).
const agentBin = () => `${home()}/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-agent`;
const guideFile = () => `${home()}/.herdr/AGENTS.md`;
const guideStarter = () => `${home()}/.config/herdr-app/mods/ws-switcher/guide.md`;
async function guideState() {
  const on = ((await readTextFile(`${home()}/.herdr/guide/switch`).catch(() => null)) ?? "").trim() !== "off";
  const text = await readTextFile(guideFile()).catch(() => null);
  return { on, bytes: text ? text.length : 0 };
}
const EDITORS = ["zed", "cursor", "code", "subl"]; // as in ws-switcher
// Opens a file in the first installed editor of EDITORS, else the system's opener.
function openFile(path) {
  if (window()?.platform === "windows") return exec("explorer", [path]).catch(() => {});
  const editors = EDITORS.map((e) => `command -v ${e} >/dev/null 2>&1 && exec ${e} "$1";`).join(" ");
  return exec("sh", ["-c", `${editors} command -v open >/dev/null 2>&1 && exec open "$1"; exec xdg-open "$1"`, "sh", path]).catch(() => {});
}

// Opens the Start dialog for a preset (from this screen or the switcher's New agent).
function openStart(name, workspace) {
  openOverlay({ mod: "ws-presets", kind: "dialog", width: 560, height: 430, props: { start: name, workspace } });
}

export default class Presets extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.workspace = props()?.workspace ?? null;
    if (props()?.start) {
      this.taskIn = TextareaState.new({ value: "", rows: 7, placeholder: "What should it do? Leave empty to start it idle and type to it yourself." });
      this.taskIn.focus();
      cx.timer.after(300, () => this.taskIn.focus());
      return;
    }
    this.nameIn = InputState.new({ value: "", placeholder: "reviewer" });
    this.descIn = InputState.new({ value: "", placeholder: "What it's for, in one line" });
    this.cmdIn = InputState.new({ value: "", placeholder: "claude --model opus" });
    this.bodyIn = TextareaState.new({ value: "", rows: 12, placeholder: "Its instructions: what it does, how it works, how it reports." });
    this.modelIn = InputState.new({ value: "", placeholder: "another model, then Enter" });
    this.modelIn.on("submit", (_e, cx) => {
      const model = this.modelIn.value().trim();
      if (model) this.setModel(model);
      this.modelIn.set_value("");
      cx.notify();
    });
    // The editor's markers (unsaved, model, effort) follow the fields as you type,
    // and the field being typed in shows the accent border.
    this.focusedIn = null;
    for (const input of [this.nameIn, this.descIn, this.cmdIn, this.bodyIn, this.modelIn]) {
      input.on("change", (_e, cx) => cx.notify());
      input.on("focus", (_e, cx) => { this.focusedIn = input; cx.notify(); });
      input.on("blur", (_e, cx) => { if (this.focusedIn === input) this.focusedIn = null; cx.notify(); });
    }
    // Codex's models from its config: the default and any profile's.
    this.codexModels = [];
    cx.spawn(async (cx) => {
      this.codexModels = configModels(await readTextFile(`${home()}/.codex/config.toml`).catch(() => null));
      cx.notify();
    });
    // The models each agent lists (knobs.js): what was kept at once, then asked again
    // when that's a day old. Each lookup is its own task, so a slow CLI holds up nothing.
    this.listed = {}; // program -> models
    const io = { exec, readTextFile, writeTextFile, home };
    for (const program of listable()) {
      cx.spawn(async (cx) => {
        this.listed[program] = (await keptModels(io, program).catch(() => null))?.models ?? [];
        cx.notify();
        this.listed[program] = await listModels(io, program).catch(() => this.listed[program]);
        cx.notify();
      });
    }
    this.swapNote = null; // what the last agent switch left out of the command
    this.sel = null; // { scope, name, isNew }
    this.snap = null; // what was loaded: { text, file, description, command, body }
    // The restart switch, read again every 3s (the CLI can change it too).
    this.resume = null; // { on, count, ready }
    const readResume = async (cx) => { this.resume = await resumeState(); cx.notify(); };
    cx.spawn(readResume);
    cx.timer.every(3000, readResume);
    // The guide's switch and file, read again every 3s too.
    this.guide = null; // { on, bytes }
    this.guideIn = true; // the editor's choice: this preset gets the guide
    const readGuide = async (cx) => { this.guide = await guideState(); cx.notify(); };
    cx.spawn(readGuide);
    cx.timer.every(3000, readGuide);
    // The agents this computer has (the + menu's last list at once, then asked again)
    // and which the + menu leaves out.
    this.pane = props()?.pane === "agents" ? "agents" : null; // shown when no preset is picked
    this.known = shared("new-menu.agents")?.[""] ?? [];
    this.hidden = shared(HIDDEN) ?? [];
    cx.spawn(async (cx) => {
      this.hidden = parseHidden(await readTextFile(hiddenFile(home())).catch(() => null));
      if (JSON.stringify(this.hidden) !== JSON.stringify(shared(HIDDEN))) setShared(HIDDEN, this.hidden);
      cx.notify();
    });
    cx.spawn(async (cx) => {
      this.known = await knownAgents().catch(() => this.known);
      cx.notify();
    });
  }

  // The "Agents in the + menu" pane in place of the editor; unsaved edits ask for a second click.
  showAgents(cx) {
    if (this.dirty() && this.pending !== "agents") {
      this.pending = "agents";
      this.error = "This preset has unsaved changes. Click again to discard them.";
      cx.notify();
      return;
    }
    this.pending = null;
    this.error = null;
    this.sel = null;
    this.snap = null;
    this.pane = "agents";
    cx.notify();
  }

  // One agent's switch: shown in the + menu or not. The switch moves at once, the file follows;
  // a file that can't be written puts it back as the file has it.
  flipAgent(key, cx) {
    const hide = !this.hidden.includes(key);
    this.hidden = hide ? [...this.hidden, key] : this.hidden.filter((k) => k !== key);
    setShared(HIDDEN, this.hidden);
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.hidden = await saveHidden({ home, readTextFile, writeTextFile }, key, hide); }
      catch (e) {
        notify({ title: "Couldn't change the + menu", body: `${tilde(hiddenFile(home()))}: ${message(e)}`, level: "error" });
        this.hidden = parseHidden(await readTextFile(hiddenFile(home())).catch(() => null));
      }
      setShared(HIDDEN, this.hidden);
      cx.notify();
    });
  }

  // Give every agent the guide, or none: herdr-ws-agent --guide on / off.
  flipGuide(cx) {
    const on = !this.guide?.on;
    this.guide = { ...this.guide, on };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(agentBin(), ["--guide", on ? "on" : "off"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      if (r.code !== 0) notify({ title: "Couldn't change it", body: (r.stderr || r.stdout).trim() || `${tilde(agentBin())} failed.`, level: "error" });
      this.guide = await guideState();
      cx.notify();
    });
  }

  // Edit opens the guide; with none yet, it's first written from the starter.
  editGuide(cx) {
    cx.spawn(async (cx) => {
      if (!this.guide?.bytes) {
        const starter = await readTextFile(guideStarter()).catch(() => null);
        await writeTextFile(guideFile(), starter ?? "# Working in Herdr\n", null).catch(() => {});
        this.guide = await guideState();
        cx.notify();
      }
      openFile(guideFile());
    });
  }

  // Bring agents back after a restart, or not: herdr-ws-resume --on / --off.
  flipResume(cx) {
    const on = !this.resume?.on;
    this.resume = { ...this.resume, on };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(resumeBin(), [on ? "--on" : "--off"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      if (r.code !== 0) notify({ title: "Couldn't change it", body: (r.stderr || r.stdout).trim() || `${tilde(resumeBin())} failed.`, level: "error" });
      this.resume = await resumeState();
      cx.notify();
    });
  }

  def() { return defOf(this.workspace); }

  // The command with its model (or effort) set; "" takes the flag out (the agent's default).
  setModel(model) {
    const knobs = KNOBS[programIn(this.cmdIn.value())];
    if (knobs) this.cmdIn.set_value(joinWords(withFlag(words(this.cmdIn.value()), knobs.model, model)));
  }
  setEffort(level) {
    const effort = KNOBS[programIn(this.cmdIn.value())]?.effort;
    if (effort) this.cmdIn.set_value(joinWords(withEffort(words(this.cmdIn.value()), effort, level)));
  }
  // The Agent row: the command runs that agent instead, keeping what still fits
  // (knobs.js swapProgram); what it left out is said under the row.
  setAgent(agent) {
    const before = programIn(this.cmdIn.value());
    const was = agentFor(this.known, before)?.name ?? before;
    const { argv, dropped } = swapProgram(words(this.cmdIn.value()), agent.run);
    this.cmdIn.set_value(joinWords(argv));
    this.modelIn.set_value("");
    this.swapNote = dropped.length ? `Left out ${joinWords(dropped)}: ${was}'s, not ${agent.name}'s.` : null;
  }
  dirOf(scope) { return scope === "global" ? templatesDir() : `${this.def()?.dir}/agents`; }

  dirty() {
    if (!this.snap) return false;
    return (this.sel?.isNew && this.nameIn.value().trim() !== this.snap.name)
      || this.descIn.value() !== this.snap.description || this.cmdIn.value() !== this.snap.command
      || this.bodyIn.value().trim() !== this.snap.body || this.guideIn !== (this.snap.guide ?? true);
  }

  // Opens a preset (or a new one) in the editor; unsaved edits ask for a second click.
  pick(sel, fill, cx) {
    const key = JSON.stringify(sel);
    if (this.dirty() && this.pending !== key) {
      this.pending = key;
      this.error = "This preset has unsaved changes. Click again to discard them.";
      cx.notify();
      return;
    }
    this.pending = null;
    this.error = null;
    this.notice = null;
    this.confirming = false;
    // `cx` is passed in: the click's own is gone by the time the file has been read.
    const load = (snap, cx) => {
      this.pane = null;
      this.sel = sel;
      this.snap = snap;
      this.nameIn.set_value(snap.name);
      this.descIn.set_value(snap.description);
      this.cmdIn.set_value(snap.command);
      this.bodyIn.set_value(snap.body);
      this.guideIn = snap.guide ?? true;
      this.swapNote = null;
      cx.notify();
    };
    if (fill) return load({ text: null, file: null, ...fill }, cx);
    const file = `${this.dirOf(sel.scope)}/${sel.name}.md`;
    cx.spawn(async (cx) => {
      const text = await readTextFile(file);
      if (text === null) { this.error = `${tilde(file)} is gone.`; cx.notify(); return; }
      const { head, body } = split(text);
      load({ text, file, name: sel.name, description: field(head, "description"), command: field(head, "command"), body, guide: field(head, "guide") !== "off" }, cx);
    });
  }

  fresh(cx) {
    const launcher = shared("workspaces.launcher") === true;
    this.pick({ scope: this.def() ? "workspace" : "global", name: "", isNew: true },
      { name: "", description: "", command: launcher ? "herdr-ws-agent claude" : "claude", body: "" }, cx);
    this.nameIn.focus();
  }

  copy(scope, name, cx) {
    this.pick({ scope, name, isNew: true }, {
      name, description: this.descIn.value(), command: this.cmdIn.value(), body: this.bodyIn.value().trim(), guide: this.guideIn,
    }, cx);
  }

  save(cx) {
    const sel = this.sel;
    if (!sel || this.busy) return;
    const name = sel.isNew ? this.nameIn.value().trim() : sel.name;
    const description = this.descIn.value(), command = this.cmdIn.value(), body = this.bodyIn.value();
    if (!NAME.test(name)) { this.error = "A name is letters, digits, dots, dashes or underscores, starting with a letter or digit."; cx.notify(); return; }
    if (!oneLine(command)) { this.error = "A preset needs a command."; cx.notify(); return; }
    if (sel.scope === "workspace" && !this.def()) { this.error = "There's no workspace for a workspace preset."; cx.notify(); return; }
    const file = `${this.dirOf(sel.scope)}/${name}.md`;
    const guide = this.guideIn;
    const text = presetText(sel.isNew ? null : this.snap.text, description, command, body, guide);
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(file, text, sel.isNew ? null : this.snap.text);
        updateShared(sel.scope, this.workspace, name, {
          name, file, scope: sel.scope, description: oneLine(description), command: oneLine(command),
          body: body.replace(/<!--[\s\S]*?-->/g, "").trim(), error: null,
        });
        this.sel = { scope: sel.scope, name, isNew: false };
        this.snap = { text, file, name, description, command, body: body.trim(), guide };
        this.error = null;
        this.notice = "Saved.";
      } catch (e) {
        this.error = sel.isNew
          ? `Couldn't save: a preset called "${name}" may already be there (${message(e)}).`
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
        updateShared(sel.scope, this.workspace, sel.name, null);
        notify({ title: `Deleted the ${sel.name} preset`, body: r.stdout.trim() === "Trash" ? "Its file is in the Trash." : `Its file is in ${tilde(r.stdout.trim())}.`, level: "success" });
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

  // Start: this screen makes way for the Start dialog.
  start() {
    if (!this.sel || this.sel.isNew) return;
    const name = this.sel.name;
    closeOverlay(props().overlay);
    openStart(name, this.workspace);
  }

  // The Start dialog's button: the switcher's sidebar copy starts it, with the task.
  launch() {
    setShared("workspaces.launch", { workspace: this.workspace, name: props().start, task: this.taskIn.value().trim(), at: Date.now() });
    closeOverlay(props().overlay);
  }

  startDialog(t) {
    const name = props().start;
    const preset = presetsFor(this.workspace).find((x) => x.name === name);
    const shown = spaces().find((s) => s.active);
    const where = shown ? `A new tab in “${shown.name}”, in ${tilde(focused()?.cwd || shown.folder || "~")}` : "A new space in the workspace's root";
    const launcher = shared("workspaces.launcher") === true;
    const system = launcher && ["claude", "codex", "agy", "pi"].includes(programIn(preset?.command));
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12.5).font_medium().cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action).child(text);
    const shell = v_flex().id("start").track_focus(this.handle).size_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control) && preset) this.launch();
        else return;
        cx.stop_propagation();
      });
    if (!preset) return shell.child(div().text_color(t.muted).child(`There's no preset called “${name}” here any more.`));
    const known = shared("new-menu.agents")?.[""] ?? [];
    const program = agentFor(known, programIn(preset.command));
    const glyph = program?.icon ? (program.tint ? svg(program.icon) : image(program.icon)).size(20).flex_none().rounded(4)
      : svg("mods/workspace-chrome/terminal.svg").size(20).flex_none().text_color(t.muted);
    return shell
      .child(h_flex().gap(10).items_center()
        .child(glyph)
        .child(div().text_size(15).font_semibold().child(`Start ${name}`))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(Boolean(preset.description), (el) => el.child(div().text_size(12.5).text_color(t.muted).child(preset.description)))
      .child(div().text_size(11.5).text_color(t.dim).font_family("JetBrains Mono").child(preset.command))
      .child(div().text_size(11.5).text_color(t.dim).child(where))
      .child(div().pt(4).text_size(11.5).text_color(t.dim).child(system
        ? "Task: its first message. Its instructions are already in as system instructions."
        : "Task: sent after its instructions, in the same first message."))
      .child(div().flex_1().min_h(80).child(Textarea.new(this.taskIn).size_full().p(10).rounded(8).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.5).text_color(t.foreground)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child(`${modKey()}Enter starts it`))
        .child(button("start-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("start-go", "Start", true, () => this.launch())));
  }

  render() {
    const t = theme();
    if (props()?.start) return this.startDialog(t);
    const def = this.def();
    const all = shared("workspaces.presets") ?? {};
    const own = (def && all.workspaces?.[def.id]) || [];
    const global = all.global ?? [];
    const known = this.known;
    const iconOf = (command, size = 14) => {
      const program = agentFor(known, programIn(command));
      if (!program?.icon) return svg("mods/workspace-chrome/terminal.svg").size(size).flex_none().text_color(t.muted);
      return (program.tint ? svg(program.icon) : image(program.icon)).size(size).flex_none().rounded(3);
    };

    const head = (text) => div().px(14).pt(12).pb(6).text_size(11).text_color(t.dim).child(text);
    const item = (p, scope, note) => {
      const on = this.sel && !this.sel.isNew && this.sel.scope === scope && this.sel.name === p.name;
      return h_flex().id(`p-${scope}-${p.name}`).h(32).mx(6).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .when(Boolean(p.error), (el) => el.tooltip(p.error))
        .on_click((_e, cx) => this.pick({ scope, name: p.name, isNew: false }, null, cx))
        .child(iconOf(p.command))
        .child(div().flex_1().min_w(0).truncate().text_color(p.error ? t.dim : t.foreground).child(p.name))
        .when(Boolean(note), (el) => el.child(div().flex_none().text_size(11).text_color(p.error ? t.blocked : t.dim).child(note)));
    };
    const list = v_flex().w(250).flex_none().min_h(0).border_r(1).border_color(t.border).bg(t.chrome)
      .child(div().p(10).child(h_flex().id("p-new").h(30).px(12).gap(6).items_center().justify_center().rounded(8).cursor_pointer()
        .bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium().hover((s) => s.opacity(0.88))
        .on_click((_e, cx) => this.fresh(cx)).child(svg("mods/workspace-chrome/plus.svg").size(13)).child("New preset")))
      .child(v_flex().id("p-list").flex_1().min_h(0).pb(10).overflow_y_scrollbar()
        .when(Boolean(def), (el) => el.child(head(`Only in ${def.name}`))
          .children(own.map((p) => item(p, "workspace", p.error ? "error" : global.some((g) => g.name === p.name) ? "replaces global" : "")))
          .when(!own.length, (el) => el.child(div().px(14).text_size(12).text_color(t.dim).child("None yet."))))
        .child(head("Every workspace"))
        .children(global.map((p) => item(p, "global", p.error ? "error" : own.some((o) => o.name === p.name) ? "replaced here" : "")))
        .when(!global.length, (el) => el.child(div().px(14).text_size(12).text_color(t.dim).child("None yet."))))
      .when(Boolean(this.guide), (el) => el.child(this.guideRow(t)))
      .when(Boolean(this.resume), (el) => el.child(this.resumeRow(t)))
      .child(this.agentsRow(t));

    return v_flex().id("presets").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      })
      .child(h_flex().h(50).flex_none().px(18).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(15).font_semibold().child("Agent presets"))
        .when(Boolean(def), (el) => el.child(div().text_size(12.5).text_color(t.dim).child(`for ${def.name}`)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().flex_1().min_h(0).items_stretch().child(list)
        .child(!this.sel && this.pane === "agents" ? this.agentsPane(t) : this.editor(t, def, own, iconOf)));
  }

  // At the foot of the list: which agents the + menu shows; picking it shows agentsPane().
  agentsRow(t) {
    const on = !this.sel && this.pane === "agents";
    return v_flex().flex_none().border_t(1).border_color(t.border).pb(8)
      .child(div().px(14).pt(10).pb(4).text_size(11).text_color(t.dim).child("Agents in the + menu"))
      .child(h_flex().id("p-agents").mx(6).px(8).py(6).gap(9).rounded(7).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .tooltip("Hide agents you don't use from the tab bar's + menu, or bring them back.")
        .on_click((_e, cx) => this.showAgents(cx))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().child("Choose agents"))
          .child(div().truncate().text_size(11).text_color(t.dim).child(this.known.length ? countLine(this.known, this.hidden) : "Checking installed agents…")))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
  }

  // The pane: a switch per installed agent (on: the + menu shows it), the rest in words.
  agentsPane(t) {
    const installed = this.known.filter((a) => a.installed);
    const shown = new Set(shownAgents(installed, this.hidden).map((a) => a.key));
    const missing = notInstalledLine(this.known);
    const iconOf = (a) => !a.icon ? svg("mods/workspace-chrome/terminal.svg").size(16).flex_none().text_color(t.muted)
      : (a.tint ? svg(a.icon).text_color(t.foreground) : image(a.icon)).size(16).flex_none().rounded(3);
    return v_flex().flex_1().min_w(0).min_h(0).p(18).gap(10).text_size(12.5)
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(16).font_semibold().child("Agents in the + menu"))
        .when(installed.length > 0, (el) => el.child(div().px(8).h(22).flex().items_center().rounded(11).bg(t.raised).text_size(11.5).text_color(t.muted)
          .child(countLine(this.known, this.hidden)))))
      .child(div().text_color(t.muted).child("The tab bar's + lists the agents installed here. Turn off the ones you don't use; a right-click on an agent in the + menu hides it too."))
      .child(v_flex().id("p-agents-list").flex_1().min_h(0).pt(4).overflow_y_scrollbar()
        .when(!installed.length, (el) => el.child(div().px(8).text_color(t.dim).child(this.known.length ? "No agents are installed here." : "Checking installed agents…")))
        .children(installed.map((a) => {
          const on = shown.has(a.key);
          return h_flex().id(`p-agent-on-${a.key}`).h(36).px(8).gap(10).rounded(7).items_center().flex_none().cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .tooltip(on ? `In the + menu. Click to hide ${a.name} there.` : `Hidden from the + menu. Click to bring ${a.name} back.`)
            .on_click((_e, cx) => this.flipAgent(a.key, cx))
            .child(iconOf(a))
            .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(a.name))
            .when(!on, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("hidden")))
            // On or off: the same switch as Bring agents back.
            .child(h_flex().w(26).h(15).p(2).flex_none().rounded_full().items_center()
              .bg(on ? t.accent : t.input).when(on, (el) => el.justify_end())
              .child(div().size(11).rounded_full().bg(t.background)));
        }))
        .when(Boolean(missing), (el) => el.child(div().px(8).pt(12).text_size(11.5).text_color(t.dim).child(missing))))
      .child(div().text_size(11.5).text_color(t.dim).child("Hidden agents are only left out of the + menu. Presets and automations can still start them."));
  }

  // At the foot of the list: the switch for Herdr's global guide, and Edit for its file.
  guideRow(t) {
    const g = this.guide;
    const size = g.bytes < 1024 ? `${g.bytes} bytes` : `${(g.bytes / 1024).toFixed(1)} KB`;
    const note = !g.bytes ? "No guide yet" : g.on ? `On: ${size}` : "Off: agents go without it";
    return v_flex().flex_none().border_t(1).border_color(t.border)
      .child(h_flex().px(14).pt(10).pb(4).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("Herdr guide"))
        .child(div().id("p-guide-edit").text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .tooltip(g.bytes ? `Open ${tilde(guideFile())}` : `Write ${tilde(guideFile())} from the starter, then open it`)
          .on_click((_e, cx) => this.editGuide(cx)).child(g.bytes ? "Edit" : "Write one")))
      .child(h_flex().id("p-guide").mx(6).px(8).py(6).gap(9).rounded(7).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(g.on ? `Claude, Codex, Antigravity and Pi started through Herdr get ${tilde(guideFile())} first: how to use automations, hc helpers and the board. A preset can leave it out. Click to turn it off for every agent.`
          : "Agents start without the guide. Click to give it to Claude, Codex, Antigravity and Pi again.")
        .on_click((_e, cx) => this.flipGuide(cx))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().child("Give agents the guide"))
          .child(div().truncate().text_size(11).text_color(t.dim).child(note)))
        .child(h_flex().w(26).h(15).p(2).flex_none().rounded_full().items_center()
          .bg(g.on ? t.accent : t.input).when(g.on, (el) => el.justify_end())
          .child(div().size(11).rounded_full().bg(t.background))));
  }

  // At the foot of the list: the switch for bringing Claude agents back after a restart.
  resumeRow(t) {
    const r = this.resume;
    const note = !r.ready ? "Not set up in herdr-core's config.toml"
      : !r.on ? "Off: tabs come back as shells"
      : r.count === 1 ? "On: 1 agent would come back" : `On: ${r.count} agents would come back`;
    return v_flex().flex_none().border_t(1).border_color(t.border).pb(8)
      .child(div().px(14).pt(10).pb(4).text_size(11).text_color(t.dim).child("After a restart"))
      .child(h_flex().id("p-resume").mx(6).px(8).py(6).gap(9).rounded(7).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(!r.ready ? `Add herdr-ws-resume's shell line to ~/.config/herdr-core/config.toml (see the recipe). ${r.on ? "On" : "Off"}: click to turn it ${r.on ? "off" : "on"}.`
          : r.on ? "Claude agents you didn't close come back, resumed, in their tabs. Click to turn it off."
          : "Tabs come back as shells. Click to bring Claude agents back.")
        .on_click((_e, cx) => this.flipResume(cx))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().child("Bring agents back"))
          .child(div().truncate().text_size(11).text_color(!r.ready && r.on ? t.blocked : t.dim).child(note)))
        // On or off: a track with its knob at the right when it's on, as in Automations.
        .child(h_flex().w(26).h(15).p(2).flex_none().rounded_full().items_center()
          .bg(r.on ? t.accent : t.input).when(r.on, (el) => el.justify_end())
          .child(div().size(11).rounded_full().bg(t.background))));
  }

  editor(t, def, own, iconOf) {
    const pane = v_flex().flex_1().min_w(0).min_h(0).p(18);
    if (!this.sel) {
      return pane.gap(10).text_color(t.muted).text_size(12.5)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Pick a preset, or make a new one."))
        .child(div().child("A preset is an agent you can start by name: a command (the program, model and flags) and its instructions."))
        .child(div().child(`Presets for every workspace are herdr-core templates in ${tilde(templatesDir())}, so agents can start them too, with hc run <name>.`))
        .when(Boolean(def), (el) => el.child(div().child(`${def.name}'s own are in ${tilde(def.dir)}/agents, and replace a global one with the same name.`)))
        .child(div().child("Start them from the switcher's New agent…, or pick one in a task's Agent row on the board."));
    }
    const sel = this.sel;
    const launcher = shared("workspaces.launcher") === true;
    const system = launcher && ["claude", "codex", "agy", "pi"].includes(programIn(this.cmdIn.value()));
    const dirty = this.dirty();
    const label = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const box = (state, mono) => Input.new(state).h(34).px(10).rounded(8).border_1().border_color(this.focusedIn === state ? t.accent : t.input).bg(t.background)
      .text_size(12.8).text_color(t.foreground).when(mono, (el) => el.font_family("JetBrains Mono"));
    const button = (id, text, kind, action, enabled = true) => h_flex().id(id).h(32).px(13).items_center().rounded(8).border_1()
      .border_color(kind === "primary" ? t.solid : t.input).bg(kind === "primary" ? t.solid : t.raised)
      .text_color(kind === "primary" ? t.solid_foreground : kind === "danger" ? t.blocked : t.foreground)
      .text_size(12.5).font_medium().when(!enabled || this.busy, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action)).child(text);
    const chip = (id, text, action) => div().id(id).h(24).px(9).flex().items_center().rounded(12).border_1().border_color(t.input)
      .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground).bg(t.hover))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(text);
    // The agents this computer has: the + menu's list, then what knownAgents() said (init).
    const agents = this.known.filter((a) => a.installed && Array.isArray(a.run));
    const where = sel.scope === "global" ? "Every workspace" : `Only in ${def?.name ?? "this workspace"}`;
    const program = programIn(this.cmdIn.value());
    // The Agent row: the installed agents, and the command's own program when it's none of them.
    const current = agentFor(agents, program);
    const providers = current || !program ? agents : [...agents, { key: program, name: program, run: null }];
    const knobs = KNOBS[program] ?? null;
    const cmdWords = words(this.cmdIn.value());
    const model = knobs ? flagValue(cmdWords, knobs.model) : null;
    const effort = knobs?.effort ? (knobs.effort.flag ? flagValue(cmdWords, [knobs.effort.flag]) : configValue(cmdWords, knobs.effort.config)) : null;
    const models = knobs ? [...new Set([...knobs.models, ...(program === "codex" ? this.codexModels : []), ...(this.listed[program] ?? []), ...(model ? [model] : [])])] : [];
    const { shown, more } = shownModels(models, this.modelIn.value(), model);
    const agentIcon = (a) => !a.icon ? svg("mods/workspace-chrome/terminal.svg").size(13).flex_none().text_color(t.muted)
      : (a.tint ? svg(a.icon).text_color(t.foreground) : image(a.icon)).size(13).flex_none().rounded(3);
    // A choice chip: highlighted when it's what the command says.
    const pick = (id, text, on, action) => div().id(id).h(26).px(10).flex().items_center().rounded(13).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(12)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(text);
    const file = sel.isNew ? null : this.snap?.file;
    const overridesGlobal = sel.scope === "global" && def && own.some((o) => o.name === sel.name);

    return pane
      .child(h_flex().gap(10).items_center()
        .child(iconOf(this.cmdIn.value(), 20))
        .when(!sel.isNew, (el) => el.child(div().text_size(16).font_semibold().child(sel.name)))
        .when(sel.isNew, (el) => el.child(div().text_size(16).font_semibold().child("New preset")))
        .child(div().px(8).h(22).flex().items_center().rounded(11).bg(t.raised).text_size(11.5).text_color(t.muted).child(where))
        .when(dirty, (el) => el.child(div().text_size(11.5).text_color(t.working).child("unsaved")))
        .child(div().flex_1())
        .when(sel.isNew && Boolean(def), (el) => el.child(h_flex().gap(6)
          .child(chip("p-scope-ws", sel.scope === "workspace" ? `● Only in ${def.name}` : `Only in ${def.name}`, () => { this.sel = { ...sel, scope: "workspace" }; }))
          .child(chip("p-scope-global", sel.scope === "global" ? "● Every workspace" : "Every workspace", () => { this.sel = { ...sel, scope: "global" }; })))))
      .when(Boolean(overridesGlobal), (el) => el.child(div().pt(6).text_size(11.5).text_color(t.working)
        .child(`${def.name} has its own "${sel.name}", which is the one that runs there.`)))
      .when(sel.isNew, (el) => el.child(label("Name: how you and agents call it (hc run <name>)")).child(box(this.nameIn)))
      .child(label("Description"))
      .child(box(this.descIn))
      .when(providers.length > 0, (el) => el
        .child(label("Agent: the program it runs"))
        .child(h_flex().gap(6).flex_wrap().items_center()
          .children(providers.map((a) => h_flex().id(`p-agent-${a.key}`).h(26).px(10).gap(6).items_center().rounded(13).border_1()
            .border_color(a === current || !a.run ? t.accent : t.input).bg(a === current || !a.run ? t.selected : t.background).text_size(12)
            .text_color(a === current || !a.run ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .when(Boolean(a.run) && a !== current, (el) => el.on_click((_e, cx) => { this.setAgent(a); cx.notify(); }))
            .when(!a.run, (el) => el.tooltip(`${program} isn't one of the agents installed here.`))
            .child(agentIcon(a)).child(a.name))))
        .when(Boolean(this.swapNote), (el) => el.child(div().pt(6).text_size(11.5).text_color(t.working).child(this.swapNote))))
      .child(label("Command: the program, model and flags"))
      .child(box(this.cmdIn, true))
      .when(Boolean(knobs), (el) => el
        .child(label("Model"))
        .child(h_flex().gap(6).flex_wrap().items_center()
          .child(pick("p-model-default", program === "codex" && this.codexModels[0] ? `Default (${this.codexModels[0]})` : "Default", model === null, () => this.setModel("")))
          .children(shown.map((m) => pick(`p-model-${m}`, m, model === m, () => { this.setModel(m); this.modelIn.set_value(""); })))
          .child(div().w(190).child(Input.new(this.modelIn).h(26).px(8).rounded(13).border_1().border_color(this.focusedIn === this.modelIn ? t.accent : t.input).bg(t.background).text_size(11.5).text_color(t.foreground))))
        .when(more > 0, (el) => el.child(div().pt(6).text_size(11.5).text_color(t.dim)
          .child(this.modelIn.value().trim() ? `${more} more like that: type more of the name.` : `${current?.name ?? program} lists ${models.length} models: type part of a name to find one.`)))
        .when(Boolean(knobs.effort), (el) => el
          .child(label("Effort"))
          .child(h_flex().gap(6).flex_wrap()
            .child(pick("p-effort-default", "Default", effort === null, () => this.setEffort("")))
            .children((knobs.effort?.levels ?? []).map((l) => pick(`p-effort-${l}`, l, effort === l, () => this.setEffort(l)))))))
      .when(system, (el) => el
        .child(label(this.guide && !this.guide.on ? "Herdr guide (off for every agent right now)" : "Herdr guide: how to use automations, hc helpers and the board"))
        .child(h_flex().gap(6).flex_wrap()
          .child(pick("p-guide-in", "Gets it", this.guideIn, () => { this.guideIn = true; }))
          .child(pick("p-guide-out", "Goes without", !this.guideIn, () => { this.guideIn = false; }))))
      .child(label(system
        ? "Instructions: this agent gets these as system instructions, after the workspace's"
        : "Instructions: sent as the agent's first message, before any task"))
      .child(div().flex_1().min_h(80).child(Textarea.new(this.bodyIn).size_full().p(10).rounded(8).border_1().border_color(this.focusedIn === this.bodyIn ? t.accent : t.input)
        .bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .when(!this.error && Boolean(this.notice), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.done).child(this.notice)))
      .child(h_flex().pt(14).gap(8).items_center()
        .when(!sel.isNew, (el) => el
          .child(button("p-delete", this.confirming ? "Click again to delete" : "Delete", "danger", (_e, cx) => this.remove(cx)))
          .child(button("p-dup", "Duplicate", "plain", (_e, cx) => this.copy(sel.scope, `${sel.name}-copy`, cx)))
          .when(sel.scope === "global" && Boolean(def) && !own.some((o) => o.name === sel.name), (el) => el
            .child(button("p-custom", `Change for ${def.name}`, "plain", (_e, cx) => this.copy("workspace", sel.name, cx)))))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(file ? tilde(file) : ""))
        .when(!sel.isNew, (el) => el.child(button("p-start", "Start", "plain", () => this.start(), !dirty)))
        .child(button("p-save", sel.isNew ? "Create" : "Save", "primary", (_e, cx) => this.save(cx), sel.isNew || dirty)));
  }
}
