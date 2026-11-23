// A lazy file browser for the focused pane's folder, with bounded read-only previews.
//
// A copy of Herdr's `files` mod, 0.1.17 (made with mod.clone), for the Files view.
// Changes from Herdr's, each kept small so the copy can be rebuilt on a newer Herdr:
// 1. Where it looks (follow.js, copied from ws-changes): as a pane beside the terminals
//    (props { beside, tab }) it follows the last focused terminal of its own tab, not
//    whichever pane has focus, so clicking into it doesn't switch it to the space's
//    folder; full size (props { screen }) it follows the shown tab of the space it was
//    opened in (shared "workspaces.screen".space, else the shown space). The terminal
//    last focused in each tab is kept in shared "workspaces.follow", so a restart comes
//    back to it; only a copy in sight writes it (follow.js' toRemember). Anything else
//    (no props.tab, as panes opened before Views have): Herdr's rule.
// 2. Hidden, it reads nothing: full size only while shared "workspaces.screen" says
//    "files" in the space shown; a pane (with props.tab) only while its tab is shown, no
//    view covers the tabs and no terminal of the tab is zoomed. The folder watch is
//    cancelled while hidden. The checks run on a 400ms timer, not from
//    render (a task started while rendering may never run).
// 3. The look: as a pane, no card of its own (Herdr's pane frame is the card) and no
//    title row (the pane's header names it): one slim row with ← (a file open) and the
//    file or the folder. Full size, a header row like the other views' (icon, "Files",
//    the folder, the open file at the right) and no card. Herdr's card stays for any
//    other placement.
// 4. A focus handle of its own on its root (in every placement); full size, it takes
//    the keyboard when it comes into view, so keys don't land in a terminal nobody sees.
// mod.clone itself rewrote the icon paths from mods/files/ to mods/ws-files/.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, props, shared, setShared, checking, machines } from "herdr";
import { locate, toRemember } from "./follow.js";
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.handle = cx.focus_handle();
    this.shown = false;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    if (!checking()) cx.timer.every(400, cx => this.tick(cx));
  }

  // Where it looks now (follow.js), remembering the terminal it follows when that terminal has
  // the keyboard: shared "workspaces.follow" (tab -> pane), which Changes and Files share and
  // Herdr keeps across restarts (a copy's localStorage wouldn't do: it's keyed by the props as
  // given, and after a restart Herdr hands them back in another order).
  // Render notes it (this.held) and the timer writes it down: never set shared state while rendering.
  // Full size, the space it was opened in (shared "workspaces.screen".space) when that's said.
  place() {
    const p = props() ?? {}, held = this.held, all = panes();
    const last = { ...(shared("workspaces.follow") ?? {}), ...(held ? { [held.tab]: held.pane } : {}) };
    const view = p.screen ? { ...p, space: shared("workspaces.screen")?.space ?? null } : p;
    const loc = locate(view, { spaces: spaces(), panes: all, focused: focused(), last });
    if ((p.beside || p.screen) && loc.pane && loc.tab && all.find((x) => x.pane === loc.pane)?.focused) this.held = { tab: loc.tab, pane: loc.pane };
    return loc;
  }

  // Only a copy in sight writes (follow.js' toRemember): a hidden one holds what it saw last time.
  remember(seen) {
    const next = toRemember({
      held: this.held, seen, last: shared("workspaces.follow") ?? {},
      tabs: spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)),
      ready: machines().filter((x) => x.name && x.layout === "ready").map((x) => x.name),
    });
    if (next) setShared("workspaces.follow", next);
  }

  key() { const { cwd, on, space } = this.place(); return JSON.stringify({ cwd, on, space }); }

  // In sight: full size while it's the view shown, in the space it was opened in; a pane while its
  // tab is shown, no view covers the tabs and no terminal of that tab is zoomed over it.
  seen() {
    const p = props() ?? {}, scr = shared("workspaces.screen") ?? null;
    if (p.screen) return scr?.screen === "files" && (!scr.space || scr.space === spaces().find((s) => s.active)?.id);
    if (p.beside && p.tab) return !scr && focused()?.tab === p.tab && !panes().some((x) => x.tab === p.tab && x.zoomed && x.terminal);
    return true;
  }

  // Comes into view: read again (full size, take the keyboard); out of view: stop watching.
  tick(cx) {
    const seen = this.seen();
    if (!seen) this.held = null;
    this.remember(seen);
    if (!seen) { if (this.shown) { this.shown = false; this.unwatch(); } return; }
    const back = !this.shown;
    this.shown = true;
    if (back && props()?.screen) this.handle.focus();
    if (back || this.key() !== this.context?.key) this.refresh(cx);
  }

  unwatch() {
    this.watched = null;
    this.watching?.cancel?.();
    this.watching = null;
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try {
        while (this.context === context && this.watched === root) {
          this.watching = watchFolder(root);
          await this.watching;
          if (this.current(context) && this.watched === root) this.refresh(cx);
        }
      }
      catch { if (this.context === context && this.watched === root) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && this.key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if (!this.seen()) return; // hidden: no listing, no watch
    const { cwd, on } = this.place(), next = this.key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.unwatch(); this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/ws-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/ws-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  // Its first row: Herdr's title row (a card of its own), the view's header (full size),
  // or one slim row under the pane's own header (a pane beside the terminals).
  head(t) {
    const p = props() ?? {};
    const back = (w) => div().id("files-back").w(w).flex_none().cursor_pointer().text_color(t.muted).hover(s => s.text_color(t.foreground)).tooltip("Back to the folder").on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←");
    const folder = this.root?.split(/[\\/]/).pop() ?? "";
    if (p.screen) {
      return h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(back(16)))
        .child(svg("mods/ws-files/folder.svg").size(16).flex_none().text_color(t.muted))
        .child(div().flex_none().font_semibold().child("Files"))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(folder))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? ""));
    }
    if (p.beside) {
      return h_flex().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .when(Boolean(this.file), el => el.child(back(14)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.file ? `${folder}/${this.file}` : folder));
    }
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .when(Boolean(this.file), el => el.child(back(20)))
      .child(div().font_semibold().child("Files"))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? folder));
  }

  render(cx) {
    this.place(); // a focus change is remembered at once
    const t = theme();
    const font = this.code ? settings() : null;
    // A card of its own only where nothing frames it (Herdr's panel); a pane's frame or the view's area is the card.
    const card = !props()?.screen && !props()?.beside;
    return v_flex().id("files").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .when(card, el => el.rounded(10).border_1().border_color(t.border))
      .child(this.head(t))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code
        ? Editor.new(this.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0)
        : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
