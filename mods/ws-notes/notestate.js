// The open note and the workspace's list, and how typing gets to disk safely. It has
// no imports from Herdr: main.js hands it the file functions (`io`) and the text area
// (`editor`), so `node` can test it with a fake disk.
//
//   io:     { read(file) -> text | null, write(file, text, expected) (expected null: create only;
//             else only when the file is still `expected`; throws otherwise),
//             move(from, to) -> true when moved, exists(file), list(dir) -> [{ name, file, mtime, text }] }
//   editor: { get() -> text, set(text) }
//
// The rules that keep typed text:
// - Saves run one at a time (a queue). A save that runs later than it was asked for
//   writes what's typed in that note by then, so nothing typed during a save is left out.
// - A save writes the body into the file as it is now, only while the file's body is
//   still what was last read; else it's a clash (`conflict`), and nothing is written.
// - flush() says whether what's typed is on disk; leaving a note waits for that.
// - What a folder read says is only believed when no save happened since it began.

import { fileName, renamed, bodyOf, compose, noteOf, sortNotes, titleOf } from "./notesfacts.js";

export class NoteState {
  constructor(io, editor, now = () => Date.now()) {
    this.io = io;
    this.editor = editor;
    this.now = now;
    this.queue = Promise.resolve();
    this.pending = 0; // saves asked for and not done
    this.writeGen = 0; // one more after every write: a read begun before it is stale
    this.loadSeq = 0;
    this.reset(null, null);
  }

  // Another workspace (or none): its notes folder, nothing open.
  reset(ws, dir) {
    this.ws = ws;
    this.dir = dir;
    this.notes = [];
    this.loaded = false;
    this.open = null; // { name, file, gone? } (file null: not written yet). Kept as one object while it's open.
    this.known = null; // the open note's file text as last read or written
    this.dirty = false;
    this.typedAt = 0;
    this.conflict = null; // the file's text, when it changed on disk while you typed
    this.fresh = new Set(); // notes made in this sitting: their name follows their first line
    this.saved = false;
    this.error = null;
  }

  get saving() { return this.pending > 0; }

  show(text) { this.editor.set(text); }

  typed() {
    this.dirty = this.editor.get() !== bodyOf(this.known ?? "");
    this.typedAt = this.now();
  }

  // A new note: nothing is written until it has words.
  draft() {
    this.open = { name: null, file: null };
    this.known = null;
    this.conflict = null;
    this.dirty = false;
    this.saved = false;
    this.show("");
  }

  openNote(n) {
    this.open = { name: n.name, file: n.file };
    this.known = n.text;
    this.conflict = null;
    this.dirty = false;
    this.saved = false;
    this.show(bodyOf(n.text));
  }

  // Leaving the open note: it's no longer named after its first line.
  settle() { if (this.open?.name) this.fresh.delete(this.open.name); }

  snapshot() {
    return { ws: this.ws, dir: this.dir, open: this.open, body: this.editor.get(), known: this.known, fresh: this.fresh, names: this.notes.map((n) => n.name) };
  }

  // Queues a save of a snapshot (taken now: the workspace or note may change before it
  // runs). Resolves true when that note's text is on disk.
  save(snap = this.snapshot()) {
    this.pending++;
    const p = this.queue.then(() => this.writeNow(snap)).finally(() => { this.pending--; });
    this.queue = p.catch(() => {});
    return p;
  }

  // Saves until what's typed is on disk. False when it can't be (a clash, an error):
  // then the note stays open and the text stays in the editor.
  async flush() {
    for (let i = 0; i < 5; i++) {
      if (this.conflict !== null) return false;
      if (!this.dirty && !this.saving) return true;
      const ok = this.dirty ? await this.save() : (await this.queue, this.conflict === null);
      if (!ok) return false;
    }
    return !this.dirty && this.conflict === null;
  }

  async writeNow(snap) {
    const open = snap.open;
    if (!open || !snap.ws) return true;
    const same = () => this.ws === snap.ws && this.open === open;
    // Typed in that note since the snapshot: that goes in too.
    const body = same() ? this.editor.get() : snap.body;
    const known = same() ? this.known : snap.known;
    if (same() && this.conflict !== null) return false;
    const names = this.ws === snap.ws ? this.notes.map((n) => n.name) : snap.names;
    try {
      let name = open.name, file = open.file, text = null;
      let old = file ? await this.io.read(file) : null;
      if (!file || old === null) {
        // New, or its file went away: written as a new file (never over one).
        if (!body.trim()) { if (same()) this.dirty = false; return true; }
        if (!file) { name = fileName(this.now(), titleOf(body), names); file = `${snap.dir}/${name}`; }
        try { await this.io.write(file, body, null); }
        catch (e) {
          // It's there after all (made again elsewhere): a clash, not a lost save.
          const there = await this.io.read(file);
          if (there === null) throw e;
          if (same()) this.conflict = there;
          return false;
        }
        text = body;
        if (!open.name) snap.fresh.add(name);
      } else if (bodyOf(old) !== bodyOf(known ?? "")) {
        // Changed on disk since it was read: a clash, unless it already says what you have.
        if (bodyOf(old) !== body) { if (same()) this.conflict = old; return false; }
        text = old;
      } else {
        text = compose(old, {}, body);
        if (text !== old) await this.io.write(file, text, old);
      }
      // A note made in this sitting is named after its first line as that line is written.
      const next = snap.fresh.has(name) ? renamed(name, titleOf(body), names) : null;
      if (next && (await this.io.move(file, `${snap.dir}/${next}`))) {
        snap.fresh.delete(name); snap.fresh.add(next);
        name = next; file = `${snap.dir}/${next}`;
      }
      const was = open.file;
      // The same object stays the open note, so a save asked for meanwhile still finds it.
      open.name = name; open.file = file; delete open.gone;
      this.writeGen++;
      if (this.ws === snap.ws) {
        this.notes = sortNotes([{ ...noteOf(name, text, this.now()), file, text }, ...this.notes.filter((n) => n.file !== was && n.file !== file)]);
      }
      if (!same()) return true;
      this.known = text;
      this.saved = true;
      this.error = null;
      this.dirty = this.editor.get() !== bodyOf(text);
      return true;
    } catch (e) {
      this.error = String(e?.message ?? e);
      return false;
    }
  }

  // Reads the list again. "stale": a newer read or another workspace took over;
  // "again": a save landed while it read, so read once more; "ok".
  async load() {
    const seq = ++this.loadSeq, ws = this.ws, gen = this.writeGen;
    const got = ws ? await this.io.list(this.dir) : [];
    if (seq !== this.loadSeq || ws !== this.ws) return "stale";
    if (gen !== this.writeGen || this.saving) return "again";
    this.notes = sortNotes(got.map((x) => ({ ...noteOf(x.name, x.text, x.mtime), file: x.file, text: x.text })));
    this.loaded = true;
    await this.follows();
    return "ok";
  }

  // The open note changed on disk (an agent or an editor wrote it): shown as it is now,
  // unless you've typed since. Nothing is decided while a save runs.
  async follows() {
    const open = this.open;
    if (!open?.file || this.saving) return;
    const n = this.notes.find((x) => x.file === open.file);
    if (!n) {
      // Not in the list: gone only if it's really not there.
      if (!open.gone && !(await this.io.exists(open.file)) && this.open === open && !this.saving) open.gone = true;
      return;
    }
    delete open.gone;
    if (n.text === this.known) return;
    const mine = bodyOf(this.known ?? ""), theirs = bodyOf(n.text);
    if (theirs === mine) { this.known = n.text; return; }
    if (!this.dirty) {
      this.known = n.text;
      this.conflict = null;
      this.show(theirs);
    } else if (theirs === this.editor.get()) {
      this.known = n.text; // they wrote what you typed
      this.dirty = false;
    } else {
      this.conflict = n.text;
    }
  }

  // The clash: keep what you typed (written over the file), or take theirs.
  keepMine() {
    if (this.conflict === null) return Promise.resolve(true);
    this.known = this.conflict;
    this.conflict = null;
    this.dirty = true;
    return this.save();
  }

  takeTheirs() {
    if (this.conflict === null) return;
    this.known = this.conflict;
    this.conflict = null;
    this.dirty = false;
    this.show(bodyOf(this.known));
  }

  // A note that left (deleted, moved to the board): out of the list.
  drop(file) {
    this.notes = this.notes.filter((n) => n.file !== file);
    if (this.open?.file === file) { this.open = null; this.dirty = false; this.conflict = null; }
  }
}
