// Automations: what a workspace runs by itself. A dialog that the sidebar's
// Automations row and the switcher's menu open, with props { workspace }.
//
// An automation is ~/.herdr/workspaces/<id>/automations/<name>.md: front matter
// (description, when, agent, folder, card, enabled), then its prompt. This screen
// writes the files. The switcher's runner (mods/ws-switcher/automations.js) reads
// them, starts the runs, and publishes both in shared "workspaces.automations" and
// "workspaces.automation.runs". Run now asks it through "workspaces.automation.run",
// because a dialog's tasks end when it closes.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, home, readTextFile, writeTextFile, exec, notify, agents, terminals, run } from "herdr";
import { parseWhen, describe, nextAt, shortTime } from "./when.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
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
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;
const columnsOf = (def) => (Array.isArray(def?.board?.columns) && def.board.columns.length ? def.board.columns : COLUMNS).map((c) => String(c).toLowerCase());
const rel = (def, path) => (path === def.root ? "" : path.startsWith(def.root + "/") ? path.slice(def.root.length + 1) : tilde(path));
const folderChoices = (def) => (def.folders.length ? def.folders : def.children.map((c) => `${def.root}/${c}`)).map((f) => rel(def, f));

// What sets it off, as the When chips group it. A schedule is every, at, cron or once.
const kindOf = (w) => (w.kind === "every" || w.kind === "at" || w.kind === "cron" || w.kind === "once" ? "schedule" : w.kind);
// "once <tomorrow's date> 09:00", on this computer's clock.
const onceTomorrow = () => {
  const d = new Date(Date.now() + 86400e3), p = (n) => String(n).padStart(2, "0");
  return `once ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 09:00`;
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

export default class Automations extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.workspace = props()?.workspace ?? null;
    this.nameIn = InputState.new({ value: "", placeholder: "daily-review" });
    this.descIn = InputState.new({ value: "", placeholder: "What it does, in one line" });
    this.whenIn = InputState.new({ value: "", placeholder: "weekdays 09:00" });
    this.bodyIn = TextareaState.new({ value: "", rows: 8, placeholder: "The agent's task: what to do and how to report back." });
    // The editor follows the fields as you type; the one being typed in has the accent border.
    this.focusedIn = null;
    for (const input of [this.nameIn, this.descIn, this.whenIn, this.bodyIn]) {
      input.on("change", (_e, cx) => cx.notify());
      input.on("focus", (_e, cx) => { this.focusedIn = input; cx.notify(); });
      input.on("blur", (_e, cx) => { if (this.focusedIn === input) this.focusedIn = null; cx.notify(); });
    }
    this.sel = null;  // { name, isNew }
    this.snap = null; // what was loaded: { text, file, name, description, when, agent, folder, card, enabled, body }
    this.choice = { agent: "", folder: "", card: false, enabled: true };
    // The workspace's folders with a GitHub remote, for the GitHub chips.
    this.ghRepos = [];
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
  list() { return (shared("workspaces.automations") ?? {})[this.workspace] ?? []; }

  dirty() {
    const s = this.snap;
    if (!s) return false;
    return (this.sel?.isNew && this.nameIn.value().trim() !== s.name)
      || this.descIn.value() !== s.description || this.whenIn.value() !== s.when || this.bodyIn.value().trim() !== s.body
      || this.choice.agent !== s.agent || this.choice.folder !== s.folder || this.choice.card !== s.card || this.choice.enabled !== s.enabled;
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
    // `cx` is passed in: the click's own is gone by the time the file has been read.
    const load = (snap, cx) => {
      this.sel = sel;
      this.snap = snap;
      this.nameIn.set_value(snap.name);
      this.descIn.set_value(snap.description);
      this.whenIn.set_value(snap.when);
      this.bodyIn.set_value(snap.body);
      this.choice = { agent: snap.agent, folder: snap.folder, card: snap.card, enabled: snap.enabled };
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
        agent: field(head, "agent") ?? "", folder: field(head, "folder") ?? "",
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
      name: `automation-${n}`, description: "", when: "weekdays 09:00", agent: "", folder: "", card: false, enabled: true, body: "",
    }, cx);
    this.nameIn.focus();
  }

  save(cx) {
    const sel = this.sel, def = this.def();
    if (!sel || !def || this.busy) return;
    const name = sel.isNew ? this.nameIn.value().trim() : sel.name;
    const when = oneLine(this.whenIn.value());
    const trigger = parseWhen(when);
    if (!NAME.test(name)) { this.error = "A name is letters, digits, dots, dashes or underscores, starting with a letter or digit."; cx.notify(); return; }
    if (sel.isNew && this.list().some((a) => a.name === name)) { this.error = `There's already an automation called "${name}".`; cx.notify(); return; }
    if (trigger.kind === "error") { this.error = trigger.error; cx.notify(); return; }
    const c = this.choice;
    const file = `${def.dir}/automations/${name}.md`;
    const body = this.bodyIn.value();
    const text = automationText(sel.isNew ? null : this.snap.text, {
      description: this.descIn.value(), when, agent: c.agent, folder: c.folder, card: c.card ? "true" : null, enabled: c.enabled ? null : "false",
    }, body);
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(file, text, sel.isNew ? null : this.snap.text);
        updateShared(def.id, name, {
          name, file, description: oneLine(this.descIn.value()), when, trigger, summary: describe(trigger),
          agent: c.agent || null, folder: c.folder || null, card: c.card, enabled: c.enabled,
          body: body.replace(/<!--[\s\S]*?-->/g, "").trim(), error: null, next: null, warning: null,
        });
        this.sel = { name, isNew: false };
        this.snap = { text, file, name, description: this.descIn.value(), when: this.whenIn.value(), ...c, body: body.trim() };
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
    const item = (a) => {
      const on = this.sel && !this.sel.isNew && this.sel.name === a.name;
      const dot = a.error ? t.blocked : a.enabled ? t.done : t.dim;
      return h_flex().id(`a-${a.name}`).h(46).mx(6).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => this.pick({ name: a.name, isNew: false }, null, cx))
        .child(div().size(7).flex_none().rounded_full().bg(dot))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_color(a.enabled ? t.foreground : t.muted).child(a.name))
          .child(div().truncate().text_size(11).text_color(a.error ? t.blocked : t.dim).child(a.error ? "Can't read its when" : a.summary)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(!a.enabled ? "off" : a.next ? shortTime(a.next) : ""));
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
    const boardAgent = String(def.board?.agent || "claude");
    const runs = saved ? (shared("workspaces.automation.runs") ?? []).filter((r) => r.ws === def.id && r.name === saved.name).slice(0, 4) : [];
    const ag = agents(), tm = terminals();
    const stateOf = (r) => {
      if (r.status !== "started") return r.status;
      const a = ag.find((x) => x.address === r.terminal);
      if (a) return STATE[a.status] ?? a.status;
      // Not an agent (or not one that reports): its tab is still open, or it's gone.
      return tm.some((x) => x.address === r.terminal && x.state === "live") ? "open" : "closed";
    };
    const runRow = (r) => {
      const state = stateOf(r);
      const color = state === "working" ? t.working : state === "needs you" ? t.blocked : state === "failed" ? t.blocked : t.dim;
      const live = state !== "closed" && r.status === "started" && r.tab;
      return h_flex().id(`a-run-${r.id}`).h(26).gap(10).items_center().text_size(12)
        .child(div().w(70).flex_none().text_color(t.dim).child(shortTime(r.at)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.note ? `${r.why}. ${r.note}` : r.why))
        .child(div().flex_none().text_color(color).child(state))
        .when(Boolean(live), (el) => el.child(div().id(`a-go-${r.id}`).flex_none().px(8).h(22).flex().items_center().rounded(6).border_1().border_color(t.input)
          .text_size(11.5).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.goTo(r)).child("Go to")));
    };
    // Its own id per automation, so each opens scrolled to the top.
    const form = v_flex().id(`a-form-${sel.isNew ? "+new" : sel.name}`).flex_1().min_h(0).px(18).pt(18).pb(8).overflow_y_scrollbar()
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(16).font_semibold().child(sel.isNew ? "New automation" : sel.name))
        .when(dirty, (el) => el.child(div().text_size(11.5).text_color(t.working).child("unsaved")))
        .child(div().flex_1())
        .child(chips(pick("a-on", "On", c.enabled, () => { c.enabled = true; }), pick("a-off", "Off", !c.enabled, () => { c.enabled = false; }))))
      .when(sel.isNew, (el) => el.child(label_("Name: its file's name, and what herdr-ws-run calls it")).child(box(this.nameIn)))
      .child(label_("Description")).child(box(this.descIn))
      .child(label_("When"))
      .child(chips(...KINDS.map(([k, text]) => pick(`a-k-${k}`, text, kind === k, () => { if (kind !== k) setWhen(firstOf[k]); }))))
      .child(div().pt(8).child(box(this.whenIn, true)))
      .when(quick.length > 0, (el) => el.child(div().pt(8).child(chips(...quick))))
      .child(div().pt(7).text_size(11.5).text_color(w.kind === "error" ? t.blocked : t.muted)
        .child(w.kind === "error" ? w.error : `${describe(w)}${next ? ` · next ${shortTime(next)}` : ""}${w.kind === "github" ? " · looks every 2 minutes, with your gh login" : ""}`))
      .when(Boolean(saved?.warning), (el) => el.child(div().pt(4).text_size(11.5).text_color(t.working).child(saved.warning)))
      .child(label_("Agent: a preset, or the board's agent"))
      .child(chips(pick("a-ag-default", `Board's (${boardAgent})`, !c.agent, () => { c.agent = ""; }),
        ...presets.map((p) => pick(`a-ag-${p.name}`, p.name, c.agent === p.name, () => { c.agent = p.name; })),
        ...(c.agent && !presets.some((p) => p.name === c.agent) ? [pick("a-ag-other", c.agent, true, () => {})] : [])))
      .child(label_("Folder: where it runs"))
      .child(chips(pick("a-fo-root", kind === "github" ? "Its repo's folder" : "Root", !c.folder, () => { c.folder = ""; }),
        ...folderChoices(def).map((f) => pick(`a-fo-${f}`, f, c.folder === f, () => { c.folder = f; })),
        ...(c.folder && !folderChoices(def).includes(c.folder) ? [pick("a-fo-other", c.folder, true, () => {})] : [])))
      .child(label_("Each run"))
      .child(chips(pick("a-card-no", "Just its tab", !c.card, () => { c.card = false; }), pick("a-card-yes", "A tab and a board card", c.card, () => { c.card = true; })))
      .child(label_("Prompt: the agent's task"))
      .child(div().h(150).flex_none().child(Textarea.new(this.bodyIn).size_full().p(10).rounded(8).border_1().border_color(this.focusedIn === this.bodyIn ? t.accent : t.input)
        .bg(t.background).text_size(12.5).text_color(t.foreground)))
      .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Fill-ins: ${[FILLS[kind], "{{event}} {{workspace}} {{folder}} {{date}} {{time}}"].filter(Boolean).join(" · ")}.`))
      .when(kind !== null && kind !== "schedule", (el) => el.child(div().pt(2).text_size(11.5).text_color(t.dim)
        .child("What set it off is added at the end, unless the prompt uses {{event}} or one of the fill-ins above.")))
      .when(Boolean(saved), (el) => el
        .child(label_("Recent runs"))
        .when(!runs.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("None yet.")))
        .children(runs.map(runRow))
        .child(label_("From another app or a script"))
        .child(div().text_size(11.5).text_color(t.muted).font_family("JetBrains Mono").child(`herdr-ws-run ${def.id} ${saved.name} "optional text"`)));
    return pane
      .child(form)
      .child(v_flex().flex_none().px(18).pb(14).pt(8).border_t(1).border_color(t.border)
        .when(Boolean(this.error), (el) => el.child(div().pb(8).text_size(11.5).text_color(t.blocked).child(this.error)))
        .when(!this.error && Boolean(this.notice), (el) => el.child(div().pb(8).text_size(11.5).text_color(t.done).child(this.notice)))
        .child(h_flex().gap(8).items_center()
          .when(!sel.isNew, (el) => el.child(button("a-delete", this.confirming ? "Click again to delete" : "Delete", "danger", (_e, cx) => this.remove(cx))))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.snap?.file ? tilde(this.snap.file) : ""))
          .when(!sel.isNew, (el) => el.child(button("a-run", "Run now", "plain", (_e, cx) => this.runNow(cx))))
          .child(button("a-save", sel.isNew ? "Create" : "Save", "primary", (_e, cx) => this.save(cx), sel.isNew || dirty))));
  }
}
