// Agent presets: see, make and edit them. A dialog the sidebar footer's
// "Agent presets" row (ws-chrome) opens with props { workspace } (null: no
// workspace shown).
//
// Global presets are herdr-core's templates (~/.config/herdr-core/templates,
// which `hc run <name>` also starts); a workspace's own are in
// ~/.herdr/workspaces/<id>/agents and win over a global one by name. The format
// is herdr-core's: front matter `description` and `command` (values as written),
// instructions as the body. Other front matter lines (ready, submit, …) are kept.
//
// The switcher loads presets into shared "workspaces.presets"; this writes the
// files and updates that list at once, and the switcher's folder watch confirms
// it. Start asks the switcher to run one (shared "workspaces.launch"), because a
// dialog's tasks end when it closes.
//
// The same mod is the Start dialog, props { start: <preset name>, workspace }:
// the preset, where it will run, and a task for its first message (optional).

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, shared, setShared, props, openOverlay, closeOverlay, home, readTextFile, writeTextFile, exec, notify, spaces, focused, window } from "herdr";

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

// A word for a shell line: as is when plain, else single-quoted.
const shellWord = (w) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`);

// The program a command runs: its first word after env assignments and the launcher.
function programOf(command) {
  const w = command.trim().split(/\s+/).filter((x) => x !== "env" && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && base(x) !== "herdr-ws-agent");
  return base(w[0] ?? "");
}

// A shell line as words (quotes and backslashes as sh reads them), and back.
function words(line) {
  const out = [];
  let cur = null, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
      continue;
    }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur ??= "";
    if (c === "'" || c === '"') q = c;
    else if (c === "\\" && i + 1 < line.length) cur += line[++i];
    else cur += c;
  }
  if (cur !== null) out.push(cur);
  return out;
}
const joinWords = (ws) => ws.map(shellWord).join(" ");

// How each agent takes a model and an effort, and the models to offer
// (Codex's also come from ~/.codex/config.toml).
const KNOBS = {
  claude: { model: ["--model"], models: ["fable", "opus", "sonnet", "haiku"], effort: { flag: "--effort", levels: ["low", "medium", "high", "xhigh", "max"] } },
  codex: { model: ["--model", "-m"], models: [], effort: { config: "model_reasoning_effort", levels: ["minimal", "low", "medium", "high", "xhigh", "max"] } },
  pi: { model: ["--model"], models: [], effort: { flag: "--thinking", levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] } },
};

// A flag's value in the words (`--model x` or `--model=x`), null when absent.
function flagValue(ws, names) {
  for (let i = 0; i < ws.length; i++) {
    if (names.includes(ws[i])) return ws[i + 1] ?? "";
    const long = names.find((n) => n.startsWith("--") && ws[i].startsWith(`${n}=`));
    if (long) return ws[i].slice(long.length + 1);
  }
  return null;
}
// The words without that flag, then with it set (at the end) unless value is empty.
function withFlag(ws, names, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if (names.includes(ws[i])) { i++; continue; }
    if (names.some((n) => n.startsWith("--") && ws[i].startsWith(`${n}=`))) continue;
    out.push(ws[i]);
  }
  return value ? [...out, names[0], value] : out;
}
// The same for a `-c key=value` config override (Codex).
function configValue(ws, key) {
  for (let i = 0; i < ws.length - 1; i++) {
    if ((ws[i] === "-c" || ws[i] === "--config") && ws[i + 1].startsWith(`${key}=`)) return ws[i + 1].slice(key.length + 1).replace(/^"|"$/g, "");
  }
  return null;
}
function withConfig(ws, key, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if ((ws[i] === "-c" || ws[i] === "--config") && ws[i + 1]?.startsWith(`${key}=`)) { i++; continue; }
    out.push(ws[i]);
  }
  return value ? [...out, "-c", `${key}="${value}"`] : out;
}

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
function presetText(old, description, command, body) {
  const head = split(old).head;
  for (const [key, value] of [["description", oneLine(description)], ["command", oneLine(command)]]) {
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
      const text = await readTextFile(`${home()}/.codex/config.toml`).catch(() => null);
      this.codexModels = [...new Set([...(text ?? "").matchAll(/^\s*model\s*=\s*"([^"]+)"/gm)].map((m) => m[1]))];
      cx.notify();
    });
    this.sel = null; // { scope, name, isNew }
    this.snap = null; // what was loaded: { text, file, description, command, body }
  }

  def() { return defOf(this.workspace); }

  // The command with its model (or effort) set; "" takes the flag out (the agent's default).
  setModel(model) {
    const knobs = KNOBS[programOf(this.cmdIn.value())];
    if (knobs) this.cmdIn.set_value(joinWords(withFlag(words(this.cmdIn.value()), knobs.model, model)));
  }
  setEffort(level) {
    const ws = words(this.cmdIn.value());
    const effort = KNOBS[programOf(this.cmdIn.value())]?.effort;
    if (!effort) return;
    this.cmdIn.set_value(joinWords(effort.flag ? withFlag(ws, [effort.flag], level) : withConfig(ws, effort.config, level)));
  }
  dirOf(scope) { return scope === "global" ? templatesDir() : `${this.def()?.dir}/agents`; }

  dirty() {
    if (!this.snap) return false;
    return (this.sel?.isNew && this.nameIn.value().trim() !== this.snap.name)
      || this.descIn.value() !== this.snap.description || this.cmdIn.value() !== this.snap.command
      || this.bodyIn.value().trim() !== this.snap.body;
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
      this.sel = sel;
      this.snap = snap;
      this.nameIn.set_value(snap.name);
      this.descIn.set_value(snap.description);
      this.cmdIn.set_value(snap.command);
      this.bodyIn.set_value(snap.body);
      cx.notify();
    };
    if (fill) return load({ text: null, file: null, ...fill }, cx);
    const file = `${this.dirOf(sel.scope)}/${sel.name}.md`;
    cx.spawn(async (cx) => {
      const text = await readTextFile(file);
      if (text === null) { this.error = `${tilde(file)} is gone.`; cx.notify(); return; }
      const { head, body } = split(text);
      load({ text, file, name: sel.name, description: field(head, "description"), command: field(head, "command"), body }, cx);
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
      name, description: this.descIn.value(), command: this.cmdIn.value(), body: this.bodyIn.value().trim(),
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
    const text = presetText(sel.isNew ? null : this.snap.text, description, command, body);
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(file, text, sel.isNew ? null : this.snap.text);
        updateShared(sel.scope, this.workspace, name, {
          name, file, scope: sel.scope, description: oneLine(description), command: oneLine(command),
          body: body.replace(/<!--[\s\S]*?-->/g, "").trim(), error: null,
        });
        this.sel = { scope: sel.scope, name, isNew: false };
        this.snap = { text, file, name, description, command, body: body.trim() };
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
    const system = launcher && ["claude", "codex"].includes(programOf(preset?.command ?? ""));
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
    const program = known.find((k) => k.key === programOf(preset.command));
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
    const known = shared("new-menu.agents")?.[""] ?? [];
    const iconOf = (command, size = 14) => {
      const program = known.find((k) => k.key === programOf(command));
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
        .when(!global.length, (el) => el.child(div().px(14).text_size(12).text_color(t.dim).child("None yet."))));

    return v_flex().id("presets").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      })
      .child(h_flex().h(50).flex_none().px(18).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(15).font_semibold().child("Agent presets"))
        .when(Boolean(def), (el) => el.child(div().text_size(12.5).text_color(t.dim).child(`for ${def.name}`)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().flex_1().min_h(0).items_stretch().child(list).child(this.editor(t, def, own, iconOf)));
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
    const system = launcher && ["claude", "codex"].includes(programOf(this.cmdIn.value()));
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
    const agents = (shared("new-menu.agents")?.[""] ?? []).filter((a) => a.installed && Array.isArray(a.run));
    const where = sel.scope === "global" ? "Every workspace" : `Only in ${def?.name ?? "this workspace"}`;
    const program = programOf(this.cmdIn.value());
    const knobs = KNOBS[program] ? { ...KNOBS[program], models: program === "codex" ? this.codexModels : KNOBS[program].models } : null;
    const cmdWords = words(this.cmdIn.value());
    const model = knobs ? flagValue(cmdWords, knobs.model) : null;
    const effort = knobs ? (knobs.effort.flag ? flagValue(cmdWords, [knobs.effort.flag]) : configValue(cmdWords, knobs.effort.config)) : null;
    const models = knobs ? [...new Set([...knobs.models, ...(model ? [model] : [])])] : [];
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
      .child(label("Command: the program, model and flags"))
      .child(box(this.cmdIn, true))
      .when(agents.length > 0, (el) => el.child(h_flex().pt(6).gap(6).flex_wrap().items_center()
        .child(div().text_size(11.5).text_color(t.dim).child("Start from"))
        .children(agents.map((a) => chip(`p-agent-${a.key}`, a.name, () => this.cmdIn.set_value(a.run.map(shellWord).join(" ")))))))
      .when(Boolean(knobs), (el) => el
        .child(label("Model"))
        .child(h_flex().gap(6).flex_wrap().items_center()
          .child(pick("p-model-default", program === "codex" && this.codexModels[0] ? `Default (${this.codexModels[0]})` : "Default", model === null, () => this.setModel("")))
          .children(models.map((m) => pick(`p-model-${m}`, m, model === m, () => this.setModel(m))))
          .child(div().w(190).child(Input.new(this.modelIn).h(26).px(8).rounded(13).border_1().border_color(this.focusedIn === this.modelIn ? t.accent : t.input).bg(t.background).text_size(11.5).text_color(t.foreground))))
        .child(label("Effort"))
        .child(h_flex().gap(6).flex_wrap()
          .child(pick("p-effort-default", "Default", effort === null, () => this.setEffort("")))
          .children(knobs.effort.levels.map((l) => pick(`p-effort-${l}`, l, effort === l, () => this.setEffort(l))))))
      .child(label(system
        ? "Instructions: Claude and Codex get these as system instructions, after the workspace's"
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
