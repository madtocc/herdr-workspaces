// Notes: a workspace's rough ideas, written down before they're work. Each note is
// a markdown file, ~/.herdr/workspaces/<workspace>/notes/<YYYY-MM-DD-HHMM>-<slug>.md;
// its first line is its title (notesfacts.js has the rules). There's no form: a
// note is just writing, saved as you type (notestate.js keeps the typing safe).
//
// It's the workspace's own screen: the layout holds one copy (props { screen: true })
// that follows the workspace shown in the switcher, and the switcher's Notes button
// (beside the board's), the + menu's "Notes" and the command `ws-switcher.notes` show
// it in place of the tabs, from any space. In a tab or pane of its own (props
// { workspace }) it keeps to that workspace.
//
// Notes start nothing themselves: work goes through the board. Move to the board
// writes a card from the note (the board's writer: nextId, withFields, copied from
// ws-board) in the board's first column, then moves the note to the Trash, so the idea
// waits in one place. Delete moves a note to the Trash. While the Board add-on is off in
// Settings > Features (shared "workspaces.settings"), Move to the board isn't offered (the
// button and moveToBoard() itself), and the empty note's hint doesn't name the board.
//
// People and agents change the same files: a note that changes on disk while open
// is shown as it is now, unless you've typed since (then yours stays, nothing is
// overwritten, and the bar asks which to keep).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import {
  theme, shared, props, home, watchFolder, readTextFile, writeTextFile, exec, notify, checking,
} from "herdr";
import * as fs from "fs/promises";
import { matches, ago, cardOf, titleOf, touchesNotes } from "./notesfacts.js";
import { NoteState } from "./notestate.js";

const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const COLUMNS = ["backlog", "todo", "doing", "review", "done"]; // the board's default columns
// Whether an add-on is on in Settings > Features (nothing known yet counts as on).
const featureOn = (key) => shared("workspaces.settings")?.features?.[key] !== false;
const QUIET = 700; // ms after the last key before a note is saved
// Moves a file to the Trash ($1), or into $2 where there's no Trash command (under a
// name with the time in front, so an earlier note of the same name isn't replaced). Prints where.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/$(date +%Y%m%d-%H%M%S)-\${1##*/}" && echo "$2"`;
// Each note's change time and name, one per line (macOS's stat, else GNU's).
const LIST = `
cd "$1" 2>/dev/null || exit 0
for f in *.md; do
  [ -f "$f" ] || continue
  m=$(stat -f %m "./$f" 2>/dev/null || stat -c %Y "./$f" 2>/dev/null)
  printf '%s\\t%s\\n' "$m" "$f"
done`;

const workspacesDir = () => `${home()}/.herdr/workspaces`;
const notesDir = (id) => `${workspacesDir()}/${id}/notes`;
const tasksDir = (id) => `${workspacesDir()}/${id}/tasks`;
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;
const tilde = (p) => (p === home() ? "~" : String(p ?? "").startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const message = (e) => String(e?.message ?? e);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");
// Today's date where you are (toISOString would give UTC's).
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// --- the board's card writer (copied from ws-board/main.js: a mod can't import another's) ---

function boardSplit(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { head: [], body: text };
  return { head: m[1] ? m[1].split(/\r?\n/) : [], body: text.slice(m[0].length) };
}

function boardQuote(v) {
  const s = String(v);
  return /^[A-Za-z0-9_./~@(][^:#"'{}\[\]\n]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|null|yes|no|on|off|-?[0-9.]+)$/i.test(s)
    ? s : JSON.stringify(s);
}

// The text with these front matter fields set (null or "" removes one), the rest kept.
function withFields(text, fields, body) {
  const parts = boardSplit(text);
  const lines = [...parts.head];
  for (const [k, v] of Object.entries(fields)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (v === null || v === undefined || v === "") { if (i >= 0) lines.splice(i, 1); continue; }
    if (i >= 0) lines[i] = `${k}: ${boardQuote(v)}`;
    else lines.push(`${k}: ${boardQuote(v)}`);
  }
  const rest = body === undefined ? parts.body : `\n${body.trim()}\n`;
  return `---\n${lines.join("\n")}\n---\n${rest}`;
}

// The board's columns and card prefix, as ws-board's boardOf() reads them.
function boardOf(def) {
  const b = def?.board && typeof def.board === "object" ? def.board : {};
  const columns = (Array.isArray(b.columns) && b.columns.length ? b.columns : COLUMNS).map((c) => String(c).toLowerCase());
  return { columns, prefix: String(b.prefix || (def?.id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "T").toUpperCase() };
}

// The next free ID: one more than the highest PREFIX-n in the folder.
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

// --- notes on disk, for notestate.js ---

const io = {
  read: (file) => readTextFile(file).catch(() => null),
  // writeTextFile's `expected` rule, and a read back, so a write that didn't land is an error.
  async write(file, text, expected) {
    await writeTextFile(file, text, expected);
    if ((await readTextFile(file).catch(() => null)) !== text) throw new Error(`${tilde(file)} changed while it was being saved`);
  },
  async move(from, to) {
    const r = await exec("mv", ["-n", from, to]).catch(() => null);
    return r?.code === 0 && (await fs.exists(to)) && !(await fs.exists(from));
  },
  exists: (file) => fs.exists(file).catch(() => false),
  async list(dir) {
    const r = await exec("sh", ["-c", LIST, "sh", dir], { timeout: 15000 }).catch(() => null);
    const out = [];
    for (const line of String(r?.stdout ?? "").split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const name = line.slice(tab + 1);
      if (!name.endsWith(".md") || name.startsWith(".") || name.includes("/")) continue;
      const file = `${dir}/${name}`;
      const text = await readTextFile(file).catch(() => null);
      if (text !== null) out.push({ name, file, mtime: Number(line.slice(0, tab)) * 1000 || 0, text });
    }
    return out;
  },
};

function mark(def, t, size) {
  const defs = shared("workspaces.defs") ?? [];
  const c = def.color ?? PALETTE[Math.max(0, defs.findIndex((d) => d.id === def.id)) % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
  return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(Math.round(size * 0.55)).font_bold().text_color("#ffffff").child([...def.name][0]?.toUpperCase() ?? "?");
}

export default class Notes extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // The layout's screen follows the shown workspace; a tab keeps the one it was opened with.
    this.follow = Boolean(props()?.screen);
    this.workspace = (this.follow ? null : props()?.workspace) ?? shared("workspaces.active") ?? null;
    this.showing = !this.follow;
    this.editor = TextareaState.new({ value: "", placeholder: featureOn("board") ? "Write a rough idea here. Move it to the board when it's ready to be work." : "Write a rough idea here." });
    this.editor.set_soft_wrap(true);
    this.editor.on("change", (_e, cx) => { if (this.quiet) return; this.st.typed(); this.confirming = false; this.error = null; cx.notify(); });
    this.st = new NoteState(io, { get: () => this.editor.value(), set: (text) => this.setEditor(text) });
    this.query = InputState.new({ value: "", placeholder: "Search notes" });
    this.query.on("change", (_e, cx) => cx.notify());
    // Enter in the search opens the first note found.
    this.query.on("submit", (_e, cx) => { const first = this.shownNotes()[0]; if (first) this.select(first.name, cx); });
    this.reset();
    if (checking()) return;
    this.load(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        // Every workspace's folder: notes/ may not exist until the first note, and the
        // screen needn't start over when another workspace is shown. Only changes to
        // the shown workspace's notes matter here.
        let paths;
        try { paths = await watchFolder(this.follow ? workspacesDir() : `${workspacesDir()}/${this.workspace}`); }
        catch { cx.timer.every(5000, (cx) => { if (this.showing) this.load(cx); }); return; }
        if (!this.workspace || !touchesNotes(paths, workspacesDir(), this.workspace)) continue;
        if (this.showing) this.load(cx);
        else this.stale = true;
      }
    });
    // On a timer, not in render: a task started while rendering never gets to run.
    cx.timer.every(400, (cx) => this.tick(cx));
  }

  // A workspace's notes as they open.
  reset() {
    this.st.reset(this.workspace, this.workspace ? notesDir(this.workspace) : null);
    this.confirming = false; // Delete asked once
    this.busy = null; // "move" | "delete" | "switch"
    this.error = null; // what went wrong last, under the bar
    this.setEditor("");
    this.query?.set_value("");
  }

  // The editor's text, set from here (not typed).
  setEditor(text) {
    this.quiet = true;
    this.editor.set_value(text);
    this.quiet = false;
  }

  pref(key) { return localStorage.getItem(`${this.workspace}:${key}`); }
  keep(key, value) { localStorage.setItem(`${this.workspace}:${key}`, value ?? ""); }

  tick(cx) {
    const st = this.st;
    const showing = !this.follow || shared("workspaces.screen")?.screen === "notes";
    const back = showing && !this.showing;
    const left = !showing && this.showing;
    this.showing = showing;
    const ws = this.follow ? shared("workspaces.active") ?? null : this.workspace;
    if (ws !== this.workspace) {
      if (st.dirty) this.save(cx); // the last workspace's note, saved where it belongs (a snapshot)
      this.workspace = ws;
      this.reset();
      this.load(cx);
      cx.notify();
      return;
    }
    if (left && st.dirty) this.save(cx); // typing isn't lost when the screen gives way
    if (!showing) return;
    if (back) {
      if (this.stale) { this.stale = false; this.load(cx); }
      // In place of the terminals, it takes the keyboard from them: typing goes into the note.
      this.editor.focus();
    }
    if (this.again) { this.again = false; this.load(cx); }
    if (st.dirty && !st.saving && st.conflict === null && Date.now() - st.typedAt > QUIET) this.save(cx);
    // "5m" and the like stay true.
    if (Date.now() - (this.drawnAt ?? 0) > 30000) { this.drawnAt = Date.now(); cx.notify(); }
  }

  save(cx) {
    const st = this.st, snap = st.snapshot();
    cx.spawn(async (cx) => {
      const ok = await st.save(snap);
      if (ok && snap.open?.name && st.open === snap.open) this.keep("open", snap.open.name);
      if (!ok && st.error) {
        // Not again at once; the bar says why.
        this.error = `Couldn't save the note: ${st.error}`;
        st.typedAt = Date.now() + 5000;
      }
      cx.notify();
    });
  }

  // Reads the workspace's notes again, in a task of its own (never from render).
  load(cx) {
    cx.spawn(async (cx) => {
      const st = this.st, ws = this.workspace;
      const got = ws && defOf(ws) ? await st.load() : "ok";
      if (ws !== this.workspace || got === "stale") return;
      if (got === "again") { this.again = true; return; } // a save landed while it read
      if (!st.open && ws) {
        // Opens where you were: the note open last time, else the newest, else a new one.
        const last = this.pref("open");
        const pick = st.notes.find((n) => n.name === last) ?? st.notes[0] ?? null;
        if (pick) st.openNote(pick); else st.draft();
      }
      cx.notify();
    });
  }

  // Leaves the open note for `then`, once what's typed is on disk. While the note
  // clashes with a change on disk (or a save failed), it stays: the bar says why.
  leave(cx, then) {
    if (this.busy) return;
    this.busy = "switch";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (await this.st.flush()) { this.st.settle(); then(); }
        else if (this.st.error) this.error = `Couldn't save the note: ${this.st.error}`;
      } finally {
        this.busy = null;
        cx.notify();
      }
    });
  }

  select(name, cx) {
    if (this.st.open?.name === name) return;
    this.leave(cx, () => {
      const n = this.st.notes.find((x) => x.name === name);
      if (!n) return;
      this.st.openNote(n);
      this.keep("open", n.name);
      this.confirming = false;
      this.editor.focus();
    });
  }

  newNote(cx) {
    this.leave(cx, () => {
      this.st.draft();
      this.confirming = false;
      this.editor.focus();
    });
  }

  // The next note after one left, else a new one.
  openNext() {
    const next = this.shownNotes()[0] ?? this.st.notes[0] ?? null;
    if (next) { this.st.openNote(next); this.keep("open", next.name); } else this.st.draft();
  }

  // Move to the board: a card from the note in the board's first column, then the note
  // goes to the Trash. Nothing is trashed unless the card was written.
  moveToBoard(cx) {
    const def = defOf(this.workspace);
    if (!def || this.busy || !this.editor.value().trim() || !featureOn("board")) return;
    this.busy = "move";
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (!(await this.st.flush())) {
          this.error = this.st.conflict !== null ? "Choose which text to keep first." : `Couldn't save the note first: ${this.st.error ?? "unknown"}`;
          return;
        }
        const open = this.st.open;
        if (!open?.file) return;
        const b = boardOf(def);
        const { title, notes } = cardOf(this.editor.value());
        let id = null;
        try {
          for (let i = 0; ; i++) {
            id = await nextId(def.id, b.prefix);
            const text = withFields("---\n---\n", { id, title, status: b.columns[0], created: today() }, notes);
            try { await writeTextFile(`${tasksDir(def.id)}/${id}.md`, text, null); break; }
            catch (e) { if (i >= 4) throw e; } // that ID was just taken: the next one
          }
        } catch (e) {
          this.error = `Couldn't make the card, so the note stays: ${message(e)}`;
          return;
        }
        const r = await exec("sh", ["-c", TRASH, "sh", open.file, `${workspacesDir()}/.trash`]).catch((e) => ({ code: 1, stderr: message(e) }));
        if (r.code !== 0) {
          this.error = `${id} is on the board, but the note couldn't go to the Trash: ${String(r.stderr ?? "").trim() || `exit ${r.code}`}`;
          return;
        }
        const where = String(r.stdout ?? "").trim();
        notify({
          title: `Moved to the board as ${id}`,
          body: where === "Trash" ? "The note is in the Trash." : `The note is in ${tilde(where)}.`,
          level: "success",
          action: { name: `ws-switcher.show/board/${def.id}`, args: {} },
        });
        this.st.drop(open.file);
        this.openNext();
      } finally {
        this.busy = null;
        cx.notify();
      }
    });
  }

  // Delete: asked once in the header row, then the file goes to the Trash.
  remove(cx) {
    const open = this.st.open;
    if (!open || this.busy) return;
    if (!open.file) { this.openNext(); cx.notify(); return; } // a new note with no file just goes
    if (!this.confirming) { this.confirming = true; cx.notify(); return; }
    this.busy = "delete";
    this.confirming = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (!(await io.exists(open.file))) { this.st.drop(open.file); this.openNext(); return; } // gone already
        const r = await exec("sh", ["-c", TRASH, "sh", open.file, `${workspacesDir()}/.trash`]);
        if (r.code !== 0) throw new Error(String(r.stderr ?? "").trim() || `exit ${r.code}`);
        const where = String(r.stdout ?? "").trim();
        notify({ title: "Note deleted", body: where === "Trash" ? "Its file is in the Trash." : `Its file is in ${tilde(where)}.`, level: "success" });
        this.st.drop(open.file);
        this.openNext();
      } catch (e) {
        this.error = `Couldn't delete the note: ${message(e)}`;
      } finally {
        this.busy = null;
        cx.notify();
      }
    });
  }

  keepMine(cx) { cx.spawn(async (cx) => { await this.st.keepMine(); cx.notify(); }); }
  takeTheirs(cx) { this.st.takeTheirs(); cx.notify(); }

  // The list as searched.
  shownNotes() {
    const q = this.query.value();
    return this.st.notes.filter((n) => matches(n, n.text, q));
  }

  render() {
    const t = theme();
    const def = defOf(this.workspace);
    const st = this.st;
    const shell = v_flex().id("notes").size_full().min_h(0).bg(t.canvas).text_size(13).text_color(t.foreground)
      .when(this.follow, (el) => el.track_focus(this.handle));
    // Between two workspaces (the timer is a moment behind): nothing of the last one.
    if (this.follow && (shared("workspaces.active") ?? null) !== this.workspace) return shell;
    if (!def) {
      return shell.items_center().justify_center().text_color(t.dim)
        .child(this.workspace ? "This workspace is gone." : "Notes belong to a workspace: choose one in the switcher to see its notes.");
    }
    const now = Date.now();
    const button = (id, text, action, { tip = null, solid = false, tone = null, icon = null, off = false } = {}) => h_flex().id(id).h(28).px(11).gap(6).flex_none().items_center().rounded(7)
      .text_size(12).cursor_pointer()
      .when(solid, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_medium().hover((s) => s.opacity(0.88)))
      .when(!solid, (el) => el.border_1().border_color(t.input).text_color(tone ? t[tone] : t.muted).hover((s) => s.bg(t.hover).text_color(tone ? t[tone] : t.foreground)))
      .when(off, (el) => el.opacity(0.5))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => action(cx))
      .when(Boolean(icon), (el) => el.child(svg(icon).size(13).flex_none()))
      .child(text);

    const shown = this.shownNotes();
    const header = h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(mark(def, t, 20))
      .child(div().flex_none().font_semibold().child(`${def.name} notes`))
      .child(div().text_size(12).text_color(t.dim).child(st.loaded ? plural(st.notes.length, "note") : "Reading…"))
      .child(div().flex_1())
      .child(h_flex().w(220).h(28).px(9).gap(7).flex_none().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
        .child(Input.new(this.query).flex_1().min_w(0).text_size(12).text_color(t.foreground)))
      .child(button("note-new", "New note", (cx) => this.newNote(cx), { solid: true, icon: "mods/workspace-chrome/plus.svg" }));

    // The list: newest edited first. A note being written that has no file yet shows at the top.
    const rows = [];
    if (st.open && !st.open.file && !this.query.value().trim()) rows.push(this.row(null, true, t, now));
    for (const n of shown) rows.push(this.row(n, st.open?.file === n.file, t, now));
    if (st.loaded && !shown.length && this.query.value().trim()) rows.push(div().p(12).text_size(12).text_color(t.dim).child("No notes like that."));
    const list = v_flex().id("notes-list").w(290).flex_none().min_h(0).border_r(1).border_color(t.border).overflow_y_scrollbar().p(8).gap(2).children(rows);

    return shell.child(header)
      .child(h_flex().flex_1().min_h(0).items_stretch().child(list).child(this.editorPane(def, t, button)));
  }

  // A row: title, a line of what follows, and how long ago.
  row(n, on, t, now) {
    const title = n ? n.title : titleOf(this.editor.value()) || "New note";
    return v_flex().id(`note-${n?.name ?? "new"}`).px(10).py(7).gap(2).flex_none().rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { if (n) this.select(n.name, cx); })
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(n?.empty ? t.muted : t.foreground).child(title))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(n ? ago(n.mtime, now) : "")))
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(n ? n.snippet || " " : "Not saved until it has words"));
  }

  // The open note: its bar (where it's kept, saved, actions), then the text.
  editorPane(def, t, button) {
    const st = this.st;
    const open = st.open;
    const has = Boolean(this.editor.value().trim());
    const first = boardOf(def).columns[0];
    const state = st.conflict !== null ? "" : st.saving || st.dirty ? "Saving…" : st.saved && open?.file ? "Saved" : "";
    const where = open?.file ? `notes/${open.name}` : "The first line is its title";
    const actions = this.confirming
      ? [
        div().text_size(12).text_color(t.muted).child("Move this note to the Trash?"),
        button("note-delete-cancel", "Cancel", (cx) => { this.confirming = false; cx.notify(); }),
        button("note-delete-yes", "Move to Trash", (cx) => this.remove(cx), { tone: "blocked" }),
      ]
      : [
        ...(featureOn("board") ? [button("note-move", this.busy === "move" ? "Moving…" : "Move to the board", (cx) => this.moveToBoard(cx),
          { solid: has, off: !has, tip: has ? `Make it a card in ${label(first)} and take it out of Notes` : "Write something first", icon: "mods/ws-board/board.svg" })] : []),
        ...(open?.file || has ? [button("note-delete", "Delete", (cx) => this.remove(cx), { tip: open?.file ? "Move it to the Trash" : "Throw away this new note", icon: "mods/ws-notes/trash.svg" })] : []),
      ];
    const bar = h_flex().h(48).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(where))
      .when(Boolean(state), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(state)))
      .children(actions);
    const problem = this.error
      ? h_flex().flex_none().mx(16).mt(10).px(12).py(8).gap(10).items_center().rounded(8).border_1().border_color(t.blocked).bg(t.surface).text_size(12)
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(this.error))
        .child(button("note-error-ok", "OK", (cx) => { this.error = null; cx.notify(); }))
      : null;
    const clash = st.conflict !== null
      ? h_flex().flex_none().mx(16).mt(10).px(12).py(8).gap(10).items_center().rounded(8).border_1().border_color(t.blocked).bg(t.surface).text_size(12)
        .child(div().flex_1().min_w(0).text_color(t.foreground).child("This note changed on disk while you were typing. What you typed isn't saved yet."))
        .child(button("note-keep-mine", "Keep mine", (cx) => this.keepMine(cx), { tip: "Write what you typed over the file" }))
        .child(button("note-take-theirs", "Take theirs", (cx) => this.takeTheirs(cx), { tip: "Show the file as it is now; what you typed goes" }))
      : null;
    return v_flex().flex_1().min_w(0).min_h(0)
      .child(bar)
      .when(Boolean(problem), (el) => el.child(problem))
      .when(Boolean(clash), (el) => el.child(clash))
      .child(div().flex_1().min_h(0).p(16).child(Textarea.new(this.editor).size_full().p(14).rounded(8).border_1().border_color(t.border)
        .bg(t.background).text_size(13.5).text_color(t.foreground)));
  }
}
