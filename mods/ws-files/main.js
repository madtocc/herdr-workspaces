// A file browser and editor for the focused pane's folder: a Files | Search rail beside the open
// file, which can be edited, previewed (Markdown, SVG, images) and opened in another app.
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
// 3. The look (reshaped, see 5): no card of its own as a pane or full size (Herdr's pane
//    frame or the view's area is the card) and no title row of its own (the pane's header
//    names it; full size, the tab bar's pill does). Herdr's card stays for any other placement.
// 4. A focus handle of its own on its root (in every placement); full size, it takes
//    the keyboard when it comes into view, so keys don't land in a terminal nobody sees.
//    mod.json says "focusable", so pane.go can hand it the keyboard ("focus" command).
// 5. Two columns at 640px wide and over: a resizable rail (Files | Search: the folder and its
//    git branch, Show ignored, Refresh, a filter box, the tree with file-type icons, git marks
//    and an unsaved dot; or content search through rg, else grep) beside the open file. Under
//    640px (a pane beside a terminal, at first) one column: the rail, or the file with ←.
// 6. Editing: text, code, Markdown and SVG are edited in place (Source, and Split's left side)
//    with an explicit Save (⌘S / Ctrl+S) and Discard, never saved on its own. writeTextFile
//    rejects a save when the file changed on disk: the draft stays, with Keep mine (overwrite) and Take theirs (reload)
//    from disk. A file changed on disk reloads when nothing is unsaved, and a file deleted on
//    disk keeps an unsaved draft (Save as new). Read-only: files cut at 400 KB (over 1 MiB
//    Herdr can't read them whole) and files on another machine (writeTextFile is local only).
//    An unsaved draft holds the view: it doesn't follow another terminal's folder until it's
//    saved or discarded, and switching files asks first. The open file asked for again (tree,
//    search match, Cmd-click, Changes) is never reloaded: only the cursor moves (filesfacts sameFile).
//    Each load has a number, so a load overtaken by another does nothing.
// 7. Preview: Markdown and SVG get Source | Preview | Split (Split hidden under 640px); they
//    open in the "markdown" setting's mode (see 10), and the mode last picked per kind is kept
//    (localStorage) until that setting changes. Images
//    (PNG, JPG, WebP, GIF, BMP, ICO, under 10 MB, on this computer) show through a link
//    under appHome()/data/ws-files/ (Herdr's assets follow links); links in Markdown open
//    here (files) or in the browser (http, mailto).
// 8. Open in <app> ▾: the app picked from the list for the file's extension (else the "default-app"
//    setting, else the last one used, else an installed code editor for text), and a list of the code editors installed
//    (filesfacts.js EDITOR_CATALOG) and the apps macOS offers for the file, with Reveal in
//    Finder and Copy path. Kept in ~/.herdr/files-prefs.json and mirrored in shared
//    "workspaces.files.prefs", so every copy follows a pick at once.
// 9. Opened from elsewhere: shared "workspaces.files.target" { id, scope, space?, tab?, pane?,
//    path, isDir, line, on, at }, published by the switcher's sidebar copy for the asks in
//    "workspaces.files.open" (a Cmd-click in a terminal through link.js, Changes' Open in
//    Files, Settings' Herdr guide): the copy it names opens that file (at its line, in Source)
//    or folder; a path outside the folder shown pins Files to that path's folder, with ↩
//    back to the followed one. As a dialog (props { file }, when there's no space to open
//    it in) it shows that file and its folder, with × to close.
// 10. Settings: the "files" block of ~/.herdr/settings.jsonc (settingsfacts.js, Settings > Files),
//    read on start, every 10s while in sight and on coming into view, and published in shared
//    "workspaces.settings" when it changed, so a hand edit reaches every copy in seconds. Each
//    copy follows a change on its 400ms timer: "markdown" (what Markdown and SVG open in),
//    "default-app" (what Open in names before it has remembered an app) and "show-ignored"
//    (Show ignored's start; the eye still toggles it per copy, until the setting changes).
//    A change of "markdown" or "show-ignored" starts every copy over from the new value: what a
//    copy kept is kept with the setting it was picked under. link.js reads "cmd-click" and "catch".
// 11. Right-click menu, text only, on the tree's rows and Search's file rows, and for the folder itself
//    on the empty space under the tree or its name (withMenu(), filesfacts menuRows()):
//    New file…, New folder… (an edit row in the tree), Open in ▸ (findApps(), the Open in ▾ list),
//    Reveal in Finder, New terminal here, Copy path / relative path, Rename… (edit row; waits while
//    the open file has unsaved edits), Duplicate, Move to Trash… (a dialog copy, props { trash }).
//    Steps run in sh on the folder's machine and never write over a name. A rename or trash is
//    published in shared "workspaces.files.changed" so every copy's open file follows it. A folder
//    opened in the tree that's gone when the tree is read again closes instead of failing it.
// 12. UX fixes (from the audit of package 0.33.0): the tree from the keyboard while the view has it (↑ ↓ ← → Enter,
//    filesfacts treeStep; ↓ in the filter box goes into the rows; the cursor has the hover's look);
//    as a dialog, its × and Esc ask first over unsaved edits (the strip: Save & close, Discard &
//    close, a second Esc drops the draft); Search says when it stopped at 200 matches, dims the
//    last results while a new search runs, and has the filter box's ×; cut names have a tooltip;
//    the filter's no-match line says it looks in open folders only; the open file's bar lets the
//    name shorten and, narrow, shows the unsaved pill as its dot; link.js passes every path while
//    the switcher's sidebar copy is away (shared "workspaces.switcher.alive").
// 13. The git brake, from Herdr 0.1.18's Files (gitscan.js, copied in ws-changes): one shared git
//    status per repo, a file event reads again only once the last status allows (slow ones wait
//    five times as long, up to a minute), nothing while the window is behind; the ignored list is
//    read again only after a new status.
// 14. Picks from the UX round: a + in the tree's header opens the folder's menu at the button (New file…,
//    New folder…), and an empty folder says so; while the filter box has text, a flat list of every file
//    and folder under the folder whose name holds it (filesfacts LIST_ALL_SH, findNames; ↑ ↓ and Enter
//    from the box, a click opens it and the tree opens down to it); a recovery copy of an unsaved draft in
//    appHome()/data/ws-files/drafts/ (filesfacts draftKey; the folder 0700, each copy 0600, written whole
//    through a file beside it), offered with Restore and Discard when the file is opened again after its
//    view closed with the edits in it; the editor is read-only until the strip is answered, and its
//    buttons (and a strip that moves up after) wait 500ms.
// 15. Small fixes: Tab indents as the file does (filesfacts indentStyle: a tab in Makefiles, Go and
//    tab-indented files, else the step of its spaces); the open file stays open when the followed
//    folder moves to one it's under (keptFile); another copy's draft of a trashed file stays, for
//    Save as new (afterTrash); Search's file row opens its first match; a new name row is brought
//    into view; with the keyboard in the filter or Search box, Esc closes an open right-click
//    menu first, keeping the text; preview links it won't follow say so (their scheme only); tooltips on Read-only, Unsaved (while the draft holds the folder), Source and
//    Preview (⌘⇧V), none on + and ▾ while their menu is open; "Only ignored files here."; the
//    filter boxes' × is a 20px target; ← over a draft asks "Discard & go back" / "Save & go back".
// 16. Options the owner accepted: the conflict strip's answers are "Keep mine" and "Take theirs", both
//    outlined, each with a tooltip saying what goes; Discard asks in place ("Discard changes?", a press
//    within 500 ms doesn't count, filesfacts discardStep), keeping its widest width; narrow, ← brings the
//    tree up over the open file (railUp) and a pick lowers it; the right-click menu and Open in ▸ have
//    one lit row with ↑ ↓ Enter → ← and the pointer rule (where Files already has the keyboard);
//    Rename takes a path and moves the entry (nameProblem, RENAME makes the folder); "System default"
//    for the system's opener.
// mod.clone itself rewrote the icon paths from mods/files/ to mods/ws-files/.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input, Popup, ScrollHandle, h_resizable, resizable_panel } from "gpui-base";
import { spaces, panes, focused, readTextFile, writeTextFile, watchFolder, theme, settings, window, props, shared, setShared, checking, machines, home, appHome, closeOverlay, openOverlay, run, nextCommand, notify } from "herdr";
import { exec } from "./posix.js";
import * as fs from "fs/promises";
import { locate, toRemember } from "./follow.js";
import { repoStatus, dueNow, statusRequest, settleRequest } from "./gitscan.js";
import {
  DISPLAY_LIMIT, API_LIMIT, IMAGE_LIMIT, EDITOR_CATALOG, SYSTEM_APP, extOf, fileKind, previewKind, languageOf, indentStyle, linkScheme, stepRow, discardStep, keptFile, afterTrash, typeName, formatSize,
  canEdit, resolveRelativeLink, splitDirBase, relFromRoot, dirName, baseName, offsetForLine, filterEntries, parseSearchOutput,
  mergeApps, pickDefaultApp, rememberApp, parsePrefs, launchCommand, targetFor, svgSize, fitImage, sameFile,
  menuRows, menuLabel, nameProblem, stemEnd, copyName, movedPath, isUnder,
  nativePath, treeStep, LIST_ALL_SH, LIST_CAP, parseListing, findNames, foundLine, draftKey, textHash, draftOffer, draftTitle, draftFits,
} from "./filesfacts.js";
import { SETTINGS_FILE, FILES_KEYS, FILES_DEFAULTS, parseSettings, fileSetting, LINUX_APPS_SH, parseLinuxApps, platformWords } from "./settingsfacts.js";
// Windows' Open with list and launcher (see the file).
const WINAPPS = () => `${appHome()}/mods/ws-files/winapps.ps1`;
const PER_FOLDER = 500, TOTAL = 5000;
const NARROW = 640, RAIL = 248;
const PREFS_FILE = () => `${home()}/.herdr/files-prefs.json`;
const ASSETS = "data/ws-files";
const APPS_FRESH = 60000;
// Recovery copies of unsaved drafts: appHome()/data/ws-files/drafts/<draftKey>.json.
const DRAFTS = () => `${appHome()}/${ASSETS}/drafts`;
const DRAFT_AFTER = 800; // ms after an unsaved edit before its copy is written
// The drafts a copy has open unsaved now (draftKey -> { id, at }), shared by the copies (one VM), so a
// file open in another copy with its edits isn't offered as something to recover. The holder renews
// `at` on its 120ms timer: a copy that went without close() (a reload) lets go within HELD_FRESH.
const HELD = globalThis[Symbol.for("workspaces.files.drafts.v1")] ??= new Map();
const HELD_FRESH = 3000;
const HELD_LOOK = 300; // ms to tell a live holder (renews every 120ms) from a gone one
const FOUND_MAX = 200;
const CALM = 500; // ms a strip's buttons ignore presses after they came up under the pointer
// The tree's write steps (the right-click menu), run with sh on the folder's machine. None writes
// over anything: exit 3 means the name is taken there.
const FREE = '{ [ ! -e "$1" ] && [ ! -L "$1" ] || exit 3; }';
const NEW_FILE = `mkdir -p -- "$(dirname -- "$1")" && ${FREE} && set -C && : > "$1"`;
const NEW_FOLDER = `mkdir -p -- "$(dirname -- "$1")" && ${FREE} && mkdir -- "$1"`;
// $3 = 1: only the case changes (on macOS the new name "is there": it's the same entry). A new name
// with a folder in it moves the entry there, the folder made first (after the check, so a refused
// name leaves no folder behind).
const RENAME = '{ [ "$3" = 1 ] || { [ ! -e "$2" ] && [ ! -L "$2" ]; } || exit 3; } && mkdir -p -- "$(dirname -- "$2")" && mv -- "$1" "$2"';
const DUPLICATE = '{ [ ! -e "$2" ] && [ ! -L "$2" ] || exit 3; } && cp -Rp -- "$1" "$2"';
// To the Trash (macOS 15+ has trash; Linux desktops gio; on Windows posix.js gives sh a trash
// that reaches the Recycle Bin), else into ~/.herdr/trash on that machine, as the Agents menu's Wipe does. Prints
// where it went; exit 4: it isn't there.
const TRASH = `[ -e "$1" ] || [ -L "$1" ] || exit 4
if command -v trash >/dev/null 2>&1 && trash "$1"; then echo Trash; exit 0; fi
if command -v gio >/dev/null 2>&1 && gio trash "$1"; then echo Trash; exit 0; fi
dest="$HOME/.herdr/trash"; mkdir -p "$dest" && mv -- "$1" "$dest/$(basename -- "$1")-$(date +%s)" && echo "$dest"`;
const COUNT = 'find "$1" -type f 2>/dev/null | head -n 10001 | wc -l';
const MENU_W = 228, SUB_W = 244;
// The pointer's place as a key: a move at the same place is no move (the menus' pointer rule, as
// the Agents list and History have it).
const pointKey = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? `${p.x},${p.y}` : undefined);
const SCAN = { exec, active: () => window()?.active !== false };
const firstLine = (s) => String(s ?? "").trim().split("\n")[0];
const showTabs = () => { if (shared("workspaces.screen")) setShared("workspaces.screen", null); };
const SYNTAX = (t) => ({ keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 });
// A theme color with some transparency (#rrggbb only; anything else as it is).
const fade = (c, a) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? `${c}${Math.round(a * 255).toString(16).padStart(2, "0")}` : c);
// Bytes of a string as UTF-8 (the file's size after a save).
function utf8Bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}
// The icon of a tree row.
function iconOf(name, dir) {
  if (dir) return "folder";
  const k = fileKind(name), ext = extOf(name);
  if (k === "markdown") return "file-text";
  if (k === "image" || k === "svg") return "image";
  if (["json", "jsonc", "yaml", "yml", "toml"].includes(ext)) return "braces";
  if (k === "text" && ext && !["txt", "log", "csv", "env", "lock"].includes(ext)) return "file-code";
  return "file";
}

// Windows: whether Git's sh started for this computer's last listing (null: not tried yet). The
// right-click menu's write steps need it.
let localSh = null;

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
  // Windows: Git's sh lists in a tenth of PowerShell's time; PowerShell only when there's no sh.
  const local = !on && window()?.platform === "windows";
  if (local) path = String(path).replace(/\\/g, "/");
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); if (local) localSh = true; }
  catch (e) {
    if (local) localSh = false;
    if (local || (on && String(e).includes("cannot start sh: program not found"))) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// A file's size in bytes on its machine, or null when it isn't there (or isn't a file).
async function sizeOf(path, on) {
  if (!on && window()?.platform === "windows") {
    const r = await exec("sh", ["-c", '[ -f "$1" ] && wc -c < "$1"', "files", String(path).replace(/\\/g, "/")]).catch(() => null);
    const n = Number(String(r?.stdout ?? "").trim());
    if (r) return r.code === 0 && String(r.stdout).trim() && Number.isFinite(n) ? n : null;
    // No sh (Git for Windows isn't there): PowerShell.
    const w = await exec("powershell", ["-NoProfile", "-Command", "& { param($p) if (Test-Path -LiteralPath $p -PathType Leaf) { (Get-Item -LiteralPath $p).Length } } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"]).catch(() => null);
    const m = Number(String(w?.stdout ?? "").trim());
    return w?.code === 0 && String(w.stdout).trim() && Number.isFinite(m) ? m : null;
  }
  const r = await exec("sh", ["-c", '[ -f "$1" ] && wc -c < "$1"', "files", path], { on }).catch(() => null);
  const n = Number(String(r?.stdout ?? "").trim());
  return r?.code === 0 && Number.isFinite(n) ? n : null;
}

export default class Files extends View {
  init(_props, cx) {
    // The Trash dialog (the right-click menu's Move to Trash…): a copy of its own, nothing else.
    if (props()?.trash) { this.trashInit(cx); return; }
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {}; this.ignored = new Set();
    this.handle = cx.focus_handle();
    this.treeScroll = ScrollHandle.new();
    this.shown = false;
    this.rail = "files";
    this.filter = InputState.new({ placeholder: "Filter files…" });
    this.filter.on("change", (_e, cx) => { this.flatSel = 0; this.listAll(cx); cx.notify(); });
    this.filter.on("submit", (_e, cx) => { const d = Date.now() - (this.menuEnterAt ?? 0); if (this.menu || (d >= 0 && d < 300)) return; if (this.flatMode()) { const rows = this.flatRows().rows; this.openFound(rows[Math.min(this.flatSel ?? 0, rows.length - 1)], cx); } });
    // The filter's flat list: every name under the folder ({ key, busy, paths, cut, error }).
    this.found = null; this.foundStale = false; this.flatSel = 0;
    this.finder = InputState.new({ placeholder: "Search in files…" });
    this.finder.on("change", (_e, cx) => { this.searchAt = Date.now(); cx.notify(); });
    this.finder.on("submit", (_e, cx) => { this.searchAt = 0; this.runSearch(cx); });
    this.search = { query: "", results: [], count: 0, truncated: false, busy: false, error: null };
    // The right-click menu ({ rowId, path, name, dir, where, x, y, left }) and the tree's edit row
    // ({ mode: "file" | "folder" | "rename", dir, path, isDir, tried, error, busy }).
    this.menu = null; this.menuSub = false; this.menuSubIn = false; this.menuApps = null;
    this.edit = null;
    this.nameInput = InputState.new({ placeholder: "" });
    this.nameInput.on("change", (_e, cx) => { if (this.edit) { this.edit.error = null; cx.notify(); } });
    this.nameInput.on("submit", (_e, cx) => this.commitEdit(cx));
    // Clicking away cancels (not while its step runs).
    // nameKeys: whether the name box has the keyboard (editKeyBack gives it back only then).
    this.nameInput.on("focus", () => { this.nameKeys = true; });
    this.nameInput.on("blur", (_e, cx) => { this.nameKeys = false; if (this.edit && !this.edit.busy && Date.now() - (this.edit.at ?? 0) > 300) { this.edit = null; cx.notify(); } });
    // The "files" settings as last seen (defaults until shared "workspaces.settings" says).
    this.fcfg = { ...FILES_DEFAULTS }; this.fcfgKnown = false;
    const fnow = this.filesNow();
    if (fnow) { this.fcfg = fnow; this.fcfgKnown = true; }
    this.showIgnored = this.ignoredNow();
    this.pin = null; // { root, on }: a folder opened from elsewhere, until ↩
    this.id = Math.random().toString(36).slice(2, 8);
    this.assetSeq = 0;
    this.mdSeq = 0;
    this.prefs = { byExt: {}, last: null };
    this.appsCache = new Map();
    this.targetsDone = new Set();
    this.resetFile();
    const p = props() ?? {};
    if (p.file) this.wanted = { path: p.file, line: p.line ?? null, col: null, isDir: false, on: null };
    // As a dialog, it holds the keyboard from the start: Herdr's Esc (overlay.close) only passes the
    // mod when something inside it has the keyboard (dialogClose()).
    if (p.file) this.handle.focus();
    this.refresh(cx);
    if (checking()) return;
    this.readSettings(cx);
    cx.timer.every(10000, cx => { if (this.shown) this.readSettings(cx); });
    cx.timer.every(500, cx => this.refreshIfDue(cx));
    cx.timer.every(400, cx => this.tick(cx));
    cx.timer.every(120, cx => this.fast(cx));
    // Open with… memory: the file, mirrored in shared "workspaces.files.prefs" so every copy follows a pick at once.
    cx.spawn(async cx => {
      this.prefs = parsePrefs(await readTextFile(PREFS_FILE()).catch(() => null));
      if (!shared("workspaces.files.prefs")) setShared("workspaces.files.prefs", this.prefs);
      cx.notify();
    });
    // Preview links left by copies that quit, crashed or were reloaded: gone after an hour (the links, not their files).
    if (window()?.platform !== "windows") exec("find", [`${appHome()}/${ASSETS}`, "-name", "preview-*", "-mmin", "+60", "-delete"]).catch(() => {});
    // Recovery copies nobody came back for in 30 days, and a half-written one a day old (sh: on Windows Git's).
    exec("sh", ["-c", '[ -d "$1" ] || exit 0; find "$1" -type f \\( -name "*.json" -mtime +30 -o -name "*.tmp" -mtime +1 \\) -delete', "files", DRAFTS().replace(/\\/g, "/")]).catch(() => {});
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c === "save") this.save(cx);
        cx.notify();
      }
    });
  }

  async close() {
    // Closed with unsaved edits (a pane's ×, a layout switch, quitting): the copy is written now and stays.
    if (this.dirty && this.draftDue && !this.recovery) { this.draftDue = 0; this.writeDraft(); }
    await this.draftChain?.catch(() => {});
    this.letGoDraft();
    this.code?.release(); this.code = null;
    await this.dropAsset();
  }

  // Where it looks now (follow.js), remembering the terminal it follows when that terminal has
  // the keyboard: shared "workspaces.follow" (tab -> pane), which Changes and Files share and
  // Herdr keeps across restarts (a copy's localStorage wouldn't do: it's keyed by the props as
  // given, and after a restart Herdr hands them back in another order).
  // Render notes it (this.held) and the timer writes it down: never set shared state while rendering.
  // Full size, the space it was opened in (shared "workspaces.screen".space) when that's said.
  // As a dialog (props.file), that file's folder.
  place() {
    const p = props() ?? {}, held = this.held, all = panes();
    if (p.file) return { cwd: dirName(p.file), on: null, space: null, tab: null, pane: null };
    const last = { ...(shared("workspaces.follow") ?? {}), ...(held ? { [held.tab]: held.pane } : {}) };
    const view = p.screen ? { ...p, space: shared("workspaces.screen")?.space ?? null } : p;
    const loc = locate(view, { spaces: spaces(), panes: all, focused: focused(), last });
    if ((p.beside || p.screen) && loc.pane && loc.tab && all.find((x) => x.pane === loc.pane)?.focused) this.held = { tab: loc.tab, pane: loc.pane };
    return loc;
  }

  // Where it shows: the folder it follows, or the one a file opened from elsewhere pinned it to.
  where() {
    const loc = this.place();
    return this.pin ? { ...loc, cwd: this.pin.root, on: this.pin.on } : loc;
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

  key() { const { cwd, on, space } = this.where(); return JSON.stringify({ cwd, on, space: this.pin ? null : space }); }

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
    const fnow = this.filesNow();
    if (fnow && (!this.fcfgKnown || JSON.stringify(fnow) !== JSON.stringify(this.fcfg))) this.followSettings(fnow, cx);
    const seen = this.seen();
    if (!seen) this.held = null;
    this.remember(seen);
    if (!seen) { if (this.shown) { this.shown = false; this.unwatch(); } return; }
    const back = !this.shown;
    this.shown = true;
    if (back) this.readSettings(cx);
    if (back && props()?.screen) this.handle.focus();
    // An unsaved draft holds the place: it doesn't follow another folder until saved or discarded.
    if (back || (this.key() !== this.context?.key && !this.dirty)) this.refresh(cx);
    if (this.wanted) this.applyWanted(cx);
  }

  // The "files" settings now (shared "workspaces.settings", every key checked), null while nothing's there.
  filesNow() {
    const all = shared("workspaces.settings");
    return all && typeof all === "object" ? Object.fromEntries(FILES_KEYS.map((k) => [k, fileSetting(all, k)])) : null;
  }

  // ~/.herdr/settings.jsonc into shared "workspaces.settings" when it differs (as ws-agents and
  // ws-settings do), so a hand edit reaches every copy in seconds, not at ws-agents' next read.
  // A read that another publisher overtook (Settings wrote meanwhile) is dropped, not published over it.
  readSettings(cx) {
    cx.spawn(async () => {
      const before = JSON.stringify(shared("workspaces.settings") ?? null);
      const text = await readTextFile(`${home()}/${SETTINGS_FILE}`).catch(() => null);
      const next = parseSettings(text), now = JSON.stringify(shared("workspaces.settings") ?? null);
      if (now === before && JSON.stringify(next) !== now) setShared("workspaces.settings", next);
    });
  }

  // A value this copy keeps (localStorage "ws-files.<name>") with the setting it was picked under.
  keep(name, value, under) {
    localStorage.setItem(`ws-files.${name}`, value);
    localStorage.setItem(`ws-files.${name}.under`, under);
  }

  // A kept value, while the setting is still the one it was picked under (null otherwise). One
  // kept before the settings were there was picked under `before` (the old behaviour, the default).
  kept(name, under, before) {
    const v = localStorage.getItem(`ws-files.${name}`);
    if (v == null) return null;
    return (localStorage.getItem(`ws-files.${name}.under`) ?? before) === under ? v : null;
  }

  // Show ignored: this copy's eye, else the "show-ignored" setting.
  ignoredNow() {
    const set = this.fcfg["show-ignored"] === true;
    const k = this.kept("ignored", String(set), "false");
    return k != null ? k === "1" : set;
  }

  // What a Markdown or SVG file opens in: the mode last picked for its kind, else the "markdown" setting.
  modeFor(pk) {
    const set = this.fcfg.markdown;
    const k = this.kept(`mode.${pk}`, set, "preview");
    return ["source", "preview", "split"].includes(k) ? k : set;
  }

  // The "files" settings changed (or became known). A change of "show-ignored" or "markdown"
  // starts this copy over from the new value (what it kept is written over); the open Markdown or
  // SVG file takes the new mode unless it has unsaved changes. The first value seen isn't a
  // change: what the copy kept under it stays. "default-app" needs only a redraw (Open in).
  followSettings(next, cx) {
    const was = this.fcfgKnown ? this.fcfg : null;
    this.fcfg = next; this.fcfgKnown = true;
    const ign = next["show-ignored"], md = next.markdown;
    if (was && was["show-ignored"] !== ign) this.keep("ignored", ign ? "1" : "0", String(ign));
    this.showIgnored = this.ignoredNow();
    if (was && was.markdown !== md) {
      for (const pk of ["markdown", "svg"]) this.keep(`mode.${pk}`, md, md);
      const pk = this.file && this.code ? previewKind(this.file) : null;
      if (pk && !this.truncated && !this.dirty) {
        this.mode = this.modeFor(pk);
        if (this.mode !== "source") this.livePreview(cx);
      }
    }
    cx.notify();
  }

  // The quick timer: a file asked for from elsewhere (shared "workspaces.files.target"), and the
  // debounced preview, search and "Copied" mark. Never from render.
  fast(cx) {
    const target = shared("workspaces.files.target") ?? null, now = Date.now();
    if (target?.id !== this.targetSeen) {
      this.targetSeen = target?.id;
      const p = props() ?? {};
      const me = { screen: Boolean(p.screen), space: p.screen ? this.place().space : null, tab: p.beside ? p.tab ?? null : null };
      if (targetFor(target, me, now, this.targetsDone)) {
        this.targetsDone.add(target.id);
        setShared("workspaces.files.target", { ...target, taken: now });
        this.wanted = { path: target.path, isDir: Boolean(target.isDir), line: target.line ?? null, col: target.col ?? null, on: target.on ?? null };
        if (this.seen()) this.applyWanted(cx);
        if (p.screen || p.beside) this.handle.focus();
      }
    }
    const changed = shared("workspaces.files.changed") ?? null;
    if (changed?.id !== this.changedSeen) { this.changedSeen = changed?.id; if (changed && now - (changed.at ?? 0) < 15000) this.followChange(changed, cx); }
    // Once the edit row is drawn (a rename in a folder still being listed waits for it).
    if (this.edit?.focusAgain && this.edit.drawn) { this.edit.focusAgain = false; this.nameInput.focus(); }
    if (this.editedAt && now - this.editedAt >= 250) { this.editedAt = 0; this.livePreview(cx); }
    // The recovery copy, a moment after an unsaved edit (not while an older one is offered).
    if (this.draftDue && now - this.draftDue >= DRAFT_AFTER) { this.draftDue = 0; if (this.dirty && !this.recovery) this.writeDraft(); }
    if (this.heldKey && HELD.get(this.heldKey)?.id === this.id) HELD.get(this.heldKey).at = now;
    // Typing searches 300ms after the last key, from 2 characters (Enter searches anything).
    if (this.searchAt && now - this.searchAt >= 300) {
      this.searchAt = 0;
      const q = this.finder.value().trim();
      if (q.length >= 2 || !q) this.runSearch(cx);
    }
    if (this.copiedAt && now - this.copiedAt >= 1200) { this.copiedAt = 0; cx.notify(); }
    // A new preview image loads after the frame that asked for it: draw again a moment later, twice.
    if (this.assetAt) {
      const age = now - this.assetAt;
      // A fresh element each time: one drawn while its image was still loading may stay empty.
      if (age >= 1200) { this.assetAt = 0; this.imgGen = (this.imgGen ?? 0) + 1; cx.notify(); }
      else if (age >= 400 && !this.assetDrawn) { this.assetDrawn = true; this.imgGen = (this.imgGen ?? 0) + 1; cx.notify(); }
    }
  }

  // The brake (gitscan.js, as Herdr 0.1.18's Files): the tree is read again on a file event once the
  // last git status allows (watchAt), else every 10s or longer after a slow status (pollAt); nothing
  // while the window is behind, one catch-up when it's in front again.
  refreshIfDue(cx) {
    const active = window()?.active !== false, context = this.context;
    const refocused = active && this.windowActive === false;
    this.windowActive = active;
    if (!context || !this.shown) return;
    if (dueNow(context, Date.now(), { active: active && !this.loading, refocused, watched: Boolean(this.watched) })) this.refresh(cx, { due: true });
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
          const paths = await this.watching;
          // A change: read again when the brake allows (refreshIfDue), not at once.
          if ((!Array.isArray(paths) || paths.length) && this.current(context) && this.watched === root) {
            context.dirtyAt = Date.now() + 1;
            this.refreshIfDue(cx);
          }
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

  // due: the brake's read (refreshIfDue). Anything else (a new folder, coming into view, Refresh, a
  // step that changed the folder) reads a fresh git status.
  refresh(cx, { due = false } = {}) {
    if (!this.seen()) return; // hidden: no listing, no watch
    const { cwd, on } = this.where(), next = this.key();
    const visiting = next !== this.context?.key;
    if (visiting) {
      if (this.dirty && this.context) return; // the draft holds the place (tick())
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      // The open file stays open when it's under the new folder too (a cd into its folder or above it).
      const kept = saved?.file ? null : keptFile(this.root, this.file, this.on, cwd, on);
      this.context = { key: next, cwd, on, dirtyAt: 0 }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.ignored = new Set(); this.branch = null; this.git = false;
      this.show(null); this.unwatch(); this.error = null; this.limited = false;
      this.closeMenu(); this.edit = null; // they were about the folder it showed
      this.search = { query: "", results: [], count: 0, truncated: false, busy: false, error: null };
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
      else if (kept) this.show(kept, cx);
    }
    if (this.loading && !due) this.refreshAgain = true; // a step changed the folder while it was being read
    if (!cwd) { this.context.pollAt = Date.now() + 10000; return; }
    if (this.loading) return;
    const context = this.context;
    const req = statusRequest(context, Date.now(), { force: !due && !visiting, visiting });
    this.loading = true;
    this.limited = false;
    if (this.file && !this.loadingFile) this.recheck(cx);
    cx.spawn(async cx => {
      try {
        const dirtyAtListing = context.dirtyAt;
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          // A folder opened in the tree that's gone since (deleted, trashed, renamed) closes; the root's error shows.
          try { await this.loadFolder(path, context); }
          catch (e) { if (!path || !this.current(context)) throw e; this.folders.delete(path); this.entries.delete(path); }
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], { cwd, on }).catch(() => null);
        let marks = {}, ignored = new Set();
        let branch = null, git = false;
        if (top?.code === 0) {
          const [dir, head] = top.stdout.trim().split("\n");
          git = true; branch = head && head !== "HEAD" ? head : null;
          // The repo's status through the shared scan (gitscan.js; Changes' copies use it too). It writes
          // nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const scan = await repoStatus(dir, on, req, cx, () => this.context === context, SCAN).catch(() => null);
          if (!this.current(context)) return;
          if (!scan) { marks = this.marks; ignored = this.ignored; } // the window is behind: the marks it had stay
          else {
            settleRequest(context, req, scan, dirtyAtListing);
            const status = scan.status;
            if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
              const xy = entry.slice(0, 2);
              marks[`${dir}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            }
            // Ignored files, a whole ignored folder as one entry ("node_modules/"): listed again only
            // after a new status (a .gitignore edit is a file event, so it brings one).
            if (context.ignoredAt === scan.started && context.ignoredDir === dir) ignored = this.ignored;
            else {
              const ign = await exec("git", ["--no-optional-locks", "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], { cwd: dir, on }).catch(() => null);
              if (ign?.code === 0) for (const p of ign.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) ignored.add(`${dir}/${p.replace(/\/$/, "")}`);
              context.ignoredAt = scan.started; context.ignoredDir = dir;
            }
          }
        } else {
          context.watchAt = Date.now();
          if (context.dirtyAt && context.dirtyAt <= dirtyAtListing) context.dirtyAt = 0;
        }
        if (!this.current(context)) return;
        this.marks = marks; this.ignored = ignored; this.branch = branch; this.git = git; this.error = null; this.watch(cwd, cx);
        if (!due || dirtyAtListing) this.foundStale = true; // the folder may have changed: the flat list again
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) this.loading = false;
        if (this.refreshAgain) { this.refreshAgain = false; this.refresh(cx); }
        if (this.filter.value().trim()) this.listAll(cx);
        cx.notify();
      }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else this.expand(path, cx);
    cx.notify();
  }

  expand(path, cx) {
    this.folders.add(path);
    if (this.entries.has(path) || this.pending.has(path)) return;
    const context = this.context;
    this.pending.add(path);
    cx.spawn(async cx => {
      try { await this.loadFolder(path, context); }
      catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
    });
  }

  // Opens the folders down to a path (its own too when it's a folder), so the tree shows it.
  expandTo(rel, cx, self = false) {
    const parts = rel.split("/").filter(Boolean);
    const upto = self ? parts.length : parts.length - 1;
    for (let i = 1; i <= upto; i++) this.expand(parts.slice(0, i).join("/"), cx);
  }

  // A file or folder asked for from elsewhere (a target, props.file): opened once this copy's in sight.
  applyWanted(cx) {
    const w = this.wanted;
    if (!w || !this.seen()) return;
    this.wanted = null;
    if (sameFile({ root: this.root, file: this.file, on: this.on }, w)) { this.jumpTo(w, cx); return; }
    if (this.dirty) { this.pendingSwitch = { target: w }; cx.notify(); return; }
    this.openTarget(w, cx);
  }

  // A path inside the folder it follows opens there (a pin goes); else inside the pinned folder shown;
  // else Files pins to the path's folder (a file's) or the path (a folder), with ↩ back.
  openTarget(w, cx) {
    const on = w.on ?? null;
    if (!this.context) this.refresh(cx);
    // The file open now: only the cursor moves (a reload would drop an unsaved draft).
    if (sameFile({ root: this.root, file: this.file, on: this.on }, w)) { this.jumpTo(w, cx); return; }
    const follow = this.place();
    const inFollowed = follow.cwd && (follow.on ?? null) === on ? relFromRoot(follow.cwd, w.path) : null;
    // A pin goes only when nothing is unsaved (refresh() keeps a draft's folder).
    const unpin = inFollowed !== null && this.pin && !this.dirty;
    if (unpin) { this.pin = null; this.refresh(cx); }
    const rel = inFollowed !== null && !this.pin ? inFollowed : this.root && (this.on ?? null) === on ? relFromRoot(this.root, w.path) : null;
    if (w.isDir) {
      if (rel === null) { this.pin = { root: w.path, on }; this.refresh(cx); }
      else { this.show(null); if (rel) this.expandTo(rel, cx, true); this.rail = "files"; this.reveal = rel; }
      cx.notify();
      return;
    }
    if (rel === null) {
      this.pin = { root: dirName(w.path), on };
      this.refresh(cx);
      this.show(baseName(w.path), cx, { line: w.line, col: w.col });
    } else {
      this.expandTo(rel, cx);
      this.reveal = rel;
      this.show(rel, cx, { line: w.line, col: w.col });
    }
    cx.notify();
  }

  // The open file asked for again (the tree, a search match, a Cmd-click, Changes): never reloaded, so
  // an unsaved draft stays; with a line, Markdown and SVG go to Source and the cursor goes there.
  jumpTo(w, cx) {
    this.railUp = false; // the same file asked for again: the narrow tree goes down to show it
    if (!this.code) { cx.notify(); return; }
    if (w.line) {
      if (previewKind(this.file) && !this.truncated && this.mode !== "source") this.mode = "source";
      const off = offsetForLine(this.code.value(), w.line, w.col ?? 1);
      this.code.set_selected_range({ start: off, end: off });
    }
    this.code.focus();
    cx.notify();
  }

  // Back from a pinned folder to the one it follows.
  unpin(cx) {
    if (!this.pin) return;
    if (this.dirty) { this.pendingSwitch = { unpin: true }; cx.notify(); return; }
    this.pin = null;
    this.refresh(cx);
    cx.notify();
  }

  resetFile() {
    this.code?.release(); this.code = null; this.discardArmed = 0;
    this.file = null; this.fk = null; this.fileError = null; this.fileGone = false; this.fileSize = null; this.loadingFile = false;
    this.truncated = false; this.snapshot = null; this.dirty = false; this.conflict = false; this.saveError = null; this.saving = false;
    this.mdText = ""; this.img = null; this.withOpen = false; this.apps = null; this.pendingSwitch = null; this.editedAt = 0;
    this.recovery = null; this.draftDue = 0; this.offerWait = false; this.letGoDraft();
    this.codeFocused = false; // a released editor sends no blur: a swap mustn't take the keyboard back
  }

  // Opens a file (path under the root), or none. A file with unsaved edits asks first (pick()).
  show(path, cx, opts = {}) {
    if (path) this.railUp = false; // a file shown (a target, a Cmd-click, a link) lowers the narrow tree
    const old = this.img;
    this.resetFile();
    if (old) this.dropAsset(old);
    this.file = path;
    if (!path || !cx) return;
    this.loadingFile = true;
    this.fk = fileKind(path);
    const context = this.context, root = this.root, on = this.on, abs = `${root}/${path}`;
    const ext = extOf(path);
    // Each load has its own number: a load overtaken by another (the same file shown again) does nothing.
    const seq = this.loadSeq = (this.loadSeq ?? 0) + 1;
    cx.spawn(async cx => {
      const mine = () => this.loadSeq === seq && this.file === path && this.context === context;
      try {
        const size = await sizeOf(abs, on);
        if (!mine()) return;
        if (size === null) {
          const probe = await readTextFile(abs, { on }).catch(() => undefined);
          if (!mine()) return;
          if (probe === null) { this.fileGone = true; return; }
        }
        this.fileSize = size;
        const kind = this.fk;
        if (kind === "binary") return;
        if (kind === "image") {
          if (!on && (size ?? 0) <= IMAGE_LIMIT) await this.makeAsset(abs, ext, mine);
          return;
        }
        let text;
        if ((size ?? 0) > API_LIMIT) {
          // Over Herdr's 1 MiB read: the start of it, read-only.
          const head = await exec("head", ["-c", String(DISPLAY_LIMIT), abs], { on }).catch(() => null);
          if (!mine()) return;
          if (head?.code !== 0) { this.fileError = "Cannot read this file"; return; }
          text = head.stdout; this.truncated = true;
        } else {
          try { text = await readTextFile(abs, { on }); }
          catch (e) {
            if (!mine()) return;
            if (/utf-?8|invalid data|stream did not contain/i.test(String(e))) { this.fk = "binary"; return; }
            this.fileError = String(e?.message ?? e); return;
          }
          if (!mine()) return;
          if (text === null) { this.fileGone = true; return; }
        }
        if (text.includes("\0")) { this.fk = "binary"; return; }
        if (text.length > DISPLAY_LIMIT) { text = text.slice(0, DISPLAY_LIMIT); this.truncated = true; }
        const editable = canEdit({ kind, truncated: this.truncated, remote: Boolean(on) });
        this.snapshot = editable ? text : null;
        const pk = previewKind(path);
        if (pk) {
          this.mode = opts.line ? "source" : this.modeFor(pk);
          if (this.truncated) this.mode = "source";
        }
        const code = this.makeCode(this.truncated ? text + `\n… (truncated at ${formatSize(DISPLAY_LIMIT)})` : text, editable);
        if (!mine()) { code.release(); return; }
        this.code = code;
        if (editable && !on) this.offerDraft(abs, text, mine, cx);
        this.mdText = text; this.mdSeq++;
        if (kind === "svg" && !on && (size ?? 0) <= IMAGE_LIMIT) {
          await this.makeAsset(abs, ext, mine);
          if (!mine()) return;
          const dims = svgSize(text);
          if (dims && this.img) { this.img.w = dims.w; this.img.h = dims.h; }
        }
        // The current editor: a swap (read-only while a copy is offered) may have made it again.
        if (opts.line && mine() && this.code) {
          const off = offsetForLine(text, opts.line, opts.col ?? 1);
          this.code.set_selected_range({ start: off, end: off });
          this.code.focus();
        }
      } catch (e) { if (mine()) this.fileError = String(e?.message ?? e); }
      finally {
        if (mine()) { this.loadingFile = false; if (!on && ext) this.discoverApps(ext, abs, cx); }
        cx.notify();
      }
    });
  }

  // A file picked in the tree, search or a Markdown link: with unsaved edits, asks first.
  pick(path, cx, opts = {}) {
    this.railUp = false; // narrow: picking a file lowers the tree it brought up (its unsaved strip shows)
    if (path === this.file && (this.code || this.loadingFile)) { this.jumpTo(opts, cx); return; }
    if (this.dirty) { this.pendingSwitch = { path, opts }; cx.notify(); return; }
    this.show(path, cx, opts);
    cx.notify();
  }

  // The unsaved-switch strip's answers.
  async settleSwitch(how, cx) {
    const sw = this.pendingSwitch;
    if (!sw) return;
    if (how === "cancel") { this.pendingSwitch = null; cx.notify(); return; }
    if (how === "save") { const ok = await this.save(cx); if (!ok) return; }
    else this.discard(cx);
    this.pendingSwitch = null;
    if (sw.closeDialog) { closeOverlay(props()?.overlay); return; }
    if (sw.unpin) { this.pin = null; this.refresh(cx); }
    else if (sw.target) this.openTarget(sw.target, cx);
    else if (sw.close) this.show(null);
    else this.show(sw.path, cx, sw.opts ?? {});
    cx.notify();
  }

  // Typing: dirty or not, the preview a moment later, a stale save error gone.
  edited(cx) {
    if (!this.code || this.snapshot === null) return;
    this.discardArmed = 0; // typing takes Discard's question back
    const dirty = this.code.value() !== this.snapshot;
    if (dirty && !this.draftDue) this.draftDue = Date.now();
    if (!dirty && this.dirty) this.dropDraft(); // typed back to the file: nothing to recover
    if (dirty !== this.dirty) this.dirty = dirty;
    if (this.saveError) this.saveError = null;
    this.editedAt = Date.now();
    cx.notify();
  }

  // The preview follows the draft (Split, Preview): Markdown's text, an SVG's own preview file.
  livePreview(cx) {
    if (!this.code) return;
    const text = this.code.value();
    if (this.fk === "markdown") { this.mdText = text; this.mdSeq++; cx.notify(); return; }
    if (this.fk === "svg" && !this.on) {
      const context = this.context, path = this.file, load = this.loadSeq;
      // The newest draft wins: an earlier write finishing late is dropped.
      const live = this.liveSeq = (this.liveSeq ?? 0) + 1;
      cx.spawn(async cx => {
        const seq = ++this.assetSeq, rel = `${ASSETS}/preview-${this.id}-${seq}.svg`;
        try {
          await fs.mkdir(`${appHome()}/${ASSETS}`, { recursive: true });
          await fs.writeFile(`${appHome()}/${rel}`, text);
        } catch { return; }
        if (this.file !== path || this.context !== context || this.loadSeq !== load || this.liveSeq !== live) { this.dropAsset({ asset: rel }); return; }
        const old = this.img, dims = svgSize(text);
        this.img = { ...(old ?? {}), asset: rel, ...(dims ? { w: dims.w, h: dims.h } : {}) };
        this.assetAt = Date.now(); this.assetDrawn = false;
        if (old) this.dropAsset(old);
        cx.notify();
      });
    }
  }

  // The image preview: a link to the file under appHome() (Herdr's assets follow links; Windows
  // gets a copy), a new name each time so nothing cached shows. Its size from sips on macOS.
  // mine(): this load is still the current one (show()).
  async makeAsset(abs, ext, mine) {
    const seq = ++this.assetSeq, rel = `${ASSETS}/preview-${this.id}-${seq}.${ext}`, dest = `${appHome()}/${rel}`;
    try {
      await fs.mkdir(`${appHome()}/${ASSETS}`, { recursive: true });
      // Windows: a copy (cp through Git's sh, else PowerShell; the mod's fs reads only under home).
      const win = window()?.platform === "windows";
      const cp = win ? await exec("cp", ["--", abs.replace(/\\/g, "/"), dest.replace(/\\/g, "/")]).catch(() => null) : null;
      const r = cp ?? (win
        ? await exec("powershell", ["-NoProfile", "-Command", "& { param($a, $b) Copy-Item -LiteralPath $a -Destination $b } '" + abs.replace(/['‘’‚‛]/g, "$&$&") + "' '" + dest.replace(/['‘’‚‛]/g, "$&$&") + "'"])
        : await exec("ln", ["-sf", abs, dest]));
      if (r.code !== 0) throw new Error(r.stderr);
    } catch (e) { if (mine()) this.imgError = String(e?.message ?? e); return; }
    if (!mine()) { this.dropAsset({ asset: rel }); return; }
    if (this.img) this.dropAsset(this.img);
    this.img = { asset: rel, w: null, h: null, fmt: ext.toUpperCase() };
    this.assetAt = Date.now(); this.assetDrawn = false;
    if (window()?.platform === "macos" && ext !== "svg") {
      const r = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", abs]).catch(() => null);
      const w = Number(/pixelWidth:\s*(\d+)/.exec(r?.stdout ?? "")?.[1]), h = Number(/pixelHeight:\s*(\d+)/.exec(r?.stdout ?? "")?.[1]);
      if (this.img?.asset === rel && w && h) { this.img.w = w; this.img.h = h; }
    }
  }

  // Herdr's fs follows a link to check where it writes, so a preview link (pointing outside the app
  // home) is removed with unlink(1); Windows has copies, which fs removes.
  async dropAsset(img = this.img) {
    if (!img?.asset) return;
    if (img === this.img) this.img = null;
    const path = `${appHome()}/${img.asset}`;
    if (window()?.platform === "windows") await fs.unlink(path).catch(() => {});
    else await exec("unlink", [path]).catch(() => {});
  }

  // The open file again from disk (the folder watch, Refresh, the 10s timer): reloaded when nothing's
  // unsaved; with a draft, a conflict (changed) or a draft kept for Save as new (deleted).
  recheck(cx) {
    const path = this.file, context = this.context;
    if (!path || !this.code || this.truncated || this.saving) {
      if (path && (this.fk === "image" || this.fk === "binary") && !this.loadingFile) {
        cx.spawn(async cx => {
          const size = await sizeOf(`${this.root}/${path}`, this.on);
          if (this.file !== path || this.context !== context) return;
          if (size === null && !this.fileGone) { this.fileGone = true; cx.notify(); }
        });
      }
      return;
    }
    cx.spawn(async cx => {
      const text = await readTextFile(`${this.root}/${path}`, { on: this.on }).catch(() => undefined);
      if (this.file !== path || this.context !== context || text === undefined || this.saving) return;
      if (text === null) {
        if (!this.fileGone) { this.fileGone = true; cx.notify(); }
        return;
      }
      if (this.fileGone) this.fileGone = false;
      if (this.snapshot === null) {
        // Read-only (another machine): follow the disk.
        if (text !== this.code.value()) { this.code.set_value(text); this.mdText = text; this.mdSeq++; this.fileSize = utf8Bytes(text); cx.notify(); }
        return;
      }
      if (text === this.snapshot) return;
      if (!this.dirty) {
        this.snapshot = text; this.code.set_value(text); this.mdText = text; this.mdSeq++; this.fileSize = utf8Bytes(text);
        if (this.recovery) this.recovery.changed = this.recovery.base !== textHash(text);
        if (this.fk === "svg") this.livePreview(cx);
        cx.notify();
      } else if (!this.conflict) { this.conflict = true; this.answeredAt = Date.now(); cx.notify(); } // its answers wait 500 ms (calm())
    });
  }

  // Save: writeTextFile only replaces the file it was read as (the snapshot). It awaits, so a click
  // or a key calls it (and settleSwitch) through cx.spawn: a handler's own cx is gone after an await. force: write over
  // what's on disk now (Overwrite); asNew: the file was deleted, write it again.
  async save(cx, { force = false, asNew = false } = {}) {
    if (!this.code || this.snapshot === null || this.saving || this.on) return false;
    this.discardArmed = 0;
    if (!this.dirty && !force && !asNew && !this.fileGone) return true;
    const path = this.file, abs = `${this.root}/${path}`, text = this.code.value();
    this.saving = true;
    cx.notify();
    try {
      let expected = this.snapshot;
      if (asNew || (this.fileGone && !force)) expected = null;
      if (force) expected = await readTextFile(abs);
      await writeTextFile(abs, text, expected);
      if (this.file !== path) return true;
      this.snapshot = text; this.dirty = this.code.value() !== text; this.conflict = false; this.saveError = null; this.fileGone = false;
      this.fileSize = utf8Bytes(text);
      if (!this.dirty) this.dropDraft(abs); else this.draftDue = Date.now(); // typed on while it saved: a new copy
      return true;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (this.file === path) {
        if (/changed outside Herdr|changed while saving/i.test(msg)) { this.conflict = true; this.answeredAt = Date.now(); } // Keep mine / Take theirs wait 500 ms
        else this.saveError = msg.replace(/^`[^`]*`:\s*/, "").replace(/([^.])$/, "$1.");
      }
      return false;
    } finally {
      this.saving = false;
      cx.notify();
    }
  }

  discard(cx) {
    this.pendingSwitch = null;
    if (!this.code || this.snapshot === null) return;
    this.dropDraft();
    if (this.fileGone) { this.dirty = false; this.code.set_value(this.snapshot); this.conflict = false; this.saveError = null; cx.notify(); return; }
    this.code.set_value(this.snapshot);
    this.dirty = false; this.conflict = false; this.saveError = null;
    this.mdText = this.snapshot; this.mdSeq++;
    if (this.fk === "svg") this.livePreview(cx);
    cx.notify();
  }

  // Reload from disk: the draft goes, the disk's text comes.
  reload(cx) {
    const path = this.file;
    cx.spawn(async cx => {
      const text = await readTextFile(`${this.root}/${path}`, { on: this.on }).catch(() => undefined);
      if (this.file !== path || text === undefined) return;
      if (text === null) { this.fileGone = true; cx.notify(); return; }
      this.snapshot = text; this.code?.set_value(text); this.dirty = false; this.conflict = false; this.saveError = null; this.fileGone = false;
      this.mdText = text; this.mdSeq++; this.fileSize = utf8Bytes(text);
      this.dropDraft();
      if (this.fk === "svg") this.livePreview(cx);
      cx.notify();
    });
  }

  // The recovery copy ------------------------------------------------
  // While a file has unsaved edits, a copy of the draft sits in DRAFTS() (filesfacts draftKey), written
  // DRAFT_AFTER ms after an edit and when the view closes. It goes on save, discard, reload, or when the
  // edits are typed back. Opened again with a copy there that isn't the file as it is, the file shows the
  // recovery strip (Restore, Discard). Writes and removals queue in draftChain, in order.

  writeDraft() {
    if (!this.code || this.snapshot === null || this.on || !this.file || this.truncated || checking()) return;
    const abs = `${this.root}/${this.file}`, key = draftKey(abs, null);
    const body = JSON.stringify({ v: 1, abs, on: null, text: this.code.value(), base: textHash(this.snapshot), at: Date.now() });
    if (!draftFits(body)) return; // it couldn't be read back whole: no copy (an older one stays)
    if (this.heldKey && this.heldKey !== key) this.letGoDraft();
    HELD.set(key, { id: this.id, at: Date.now() }); this.heldKey = key;
    const seq = this.draftSeq = (this.draftSeq ?? 0) + 1;
    this.draftChain = (this.draftChain ?? Promise.resolve()).then(async () => {
      if (this.draftSeq !== seq) return; // a newer copy or a removal came after
      if (!(await this.draftsDir())) return;
      // Whole or not at all: written beside it (made 0600 first, off Windows), then moved over it.
      const win = window()?.platform === "windows", fwd = (x) => (win ? x.replace(/\\/g, "/") : x);
      const tmp = `${DRAFTS()}/${key}.${this.id}.tmp`, final = `${DRAFTS()}/${key}.json`;
      if (!win) {
        const r = await exec("sh", ["-c", 'umask 077 && : > "$1" && chmod 600 "$1"', "files", tmp]).catch(() => null);
        if (r?.code !== 0) { this.draftsReady = false; return; } // the folder may be gone: made again next time
      }
      await fs.writeFile(tmp, body);
      const mv = await exec("sh", ["-c", 'mv -f -- "$1" "$2"', "files", fwd(tmp), fwd(final)]).catch(() => ({ code: -1, nosh: true }));
      if (mv?.code !== 0) await fs.unlink(tmp).catch(() => {});
      // Windows without Git's sh: no move, so the copy is written in place, as the rest of Files copes.
      if (mv?.nosh && win) await fs.writeFile(final, body);
    }).catch(() => {});
  }

  // The drafts folder, made once per copy: 0700 (and its copies 0600) off Windows, where a user's
  // profile is already theirs alone. False when it can't be made so: then no copy is written.
  async draftsDir() {
    if (this.draftsReady) return true;
    await fs.mkdir(DRAFTS(), { recursive: true });
    if (window()?.platform !== "windows") {
      const r = await exec("sh", ["-c", 'chmod 700 "$1" || exit 1; for f in "$1"/*.json; do [ -f "$f" ] && chmod 600 "$f"; done; true', "files", DRAFTS()]).catch(() => null);
      if (r?.code !== 0) return false;
    }
    this.draftsReady = true;
    return true;
  }

  // The editor, editable or not (EditorState takes readonly only when it's made). Its focus is kept so
  // a swap (swapCode) can hand the keyboard on.
  makeCode(value, editable) {
    const t = theme(), font = settings(), path = this.file;
    const code = EditorState.new({
      language: languageOf(path), readonly: !editable, line_numbers: true, folding: true, soft_wrap: this.fk === "markdown",
      value, font_family: font.font_family, font_size: font.font_size, syntax: SYNTAX(t), ...indentStyle(value, path),
    });
    code.on("change", (_e, cx) => { if (this.code === code) this.edited(cx); });
    code.on("focus", () => { if (this.code === code) this.codeFocused = true; });
    code.on("blur", () => { if (this.code === code) this.codeFocused = false; });
    return code;
  }

  // The open file's editor made again, read-only while the recovery strip asks (or while another copy's
  // hold is waited out), editable once it's answered; the cursor and the keyboard stay.
  swapCode(value, editable) {
    const old = this.code;
    if (!old) return;
    const sel = old.selected_range(), focused = this.codeFocused;
    const code = this.makeCode(value, editable);
    this.code = code;
    old.release();
    const end = value.length;
    try { code.set_selected_range({ start: Math.min(sel?.start ?? 0, end), end: Math.min(sel?.end ?? 0, end) }); } catch { /* the start */ }
    if (focused) code.focus();
  }

  // The copy goes (abs: that file's, else the open one's). While the strip offers it, only its own
  // Discard removes it (force).
  dropDraft(abs = this.file ? `${this.root}/${this.file}` : null, force = false) {
    this.draftDue = 0;
    if (!abs || this.on || (this.recovery && !force)) return;
    const key = draftKey(abs, null);
    if (HELD.get(key)?.id === this.id) HELD.delete(key);
    if (this.heldKey === key) this.heldKey = null;
    this.draftSeq = (this.draftSeq ?? 0) + 1;
    this.draftChain = (this.draftChain ?? Promise.resolve()).then(() => fs.unlink(`${DRAFTS()}/${key}.json`)).catch(() => {});
  }

  // This copy no longer holds its file's draft open (another copy may offer it now); the copy stays.
  letGoDraft() {
    if (this.heldKey && HELD.get(this.heldKey)?.id === this.id) HELD.delete(this.heldKey);
    this.heldKey = null;
  }

  // A file just opened (editable, on this computer): its copy, if one is there, held by no other copy,
  // and not the file as it is now (that one is removed).
  // Held by another copy: a live one renews its stamp every 120ms, one that went without close() (a
  // reload) doesn't. The editor waits read-only for HELD_LOOK ms; a renewed stamp means the other copy
  // keeps it (unlocked, no strip), else it's asked again (gone: the hold isn't looked at).
  async offerDraft(abs, disk, mine, cx, gone = false) {
    const key = draftKey(abs, null), holder = HELD.get(key);
    const unlock = () => { if (this.offerWait) { this.offerWait = false; if (this.code && !this.recovery) this.swapCode(this.code.value(), true); } };
    if (!gone && holder && holder.id !== this.id && Date.now() - holder.at < HELD_FRESH) {
      const seen = holder.at;
      if (!this.dirty && this.code) { this.offerWait = true; this.swapCode(this.code.value(), false); }
      cx.spawn(async (cx) => {
        await cx.sleep(HELD_LOOK);
        const now = HELD.get(key), live = now && now.id !== this.id && now.at !== seen;
        if (!live && mine() && this.code && !this.dirty) this.offerDraft(abs, disk, mine, cx, true);
        else { unlock(); cx.notify(); }
      });
      cx.notify();
      return;
    }
    const raw = await fs.readFile(`${DRAFTS()}/${key}.json`, "utf8").catch(() => null);
    if (!mine() || !this.code) return;
    let draft = null;
    try { draft = raw ? JSON.parse(raw) : null; } catch { draft = null; }
    // Compared with the file as it is now (a reload meanwhile moved the snapshot on).
    const offer = draftOffer(draft, { abs, on: null, disk: this.snapshot ?? disk });
    if (offer === "drop" && !this.dirty) this.dropDraft(abs);
    if (!offer || offer === "drop" || this.dirty) { unlock(); cx.notify(); return; }
    // Read-only until it's answered, so nothing can be typed between the two drafts.
    this.recovery = { ...offer, text: draft.text, base: draft.base, abs, shownAt: Date.now() };
    this.offerWait = false;
    this.swapCode(this.code.value(), false);
    cx.notify();
  }

  // Restore: the draft into the editor, unsaved (it's copied again from there).
  // Its buttons take no press in the CALM ms after the strip came up (a double-click's second half).
  restoreDraft(cx) {
    const rec = this.recovery;
    if (!rec || !this.code || Date.now() - rec.shownAt < CALM) return;
    this.recovery = null; this.answeredAt = Date.now();
    this.swapCode(rec.text, true);
    this.edited(cx);
    this.livePreview(cx);
    cx.notify();
  }

  // Discard: the copy goes; the editor is editable again, and copies work again from the next edit.
  discardDraft(cx) {
    const rec = this.recovery;
    if (!rec || !this.code || Date.now() - rec.shownAt < CALM) return;
    this.dropDraft(rec.abs, true);
    this.recovery = null; this.answeredAt = Date.now();
    this.swapCode(this.code.value(), true);
    if (this.dirty) this.draftDue = Date.now();
    cx.notify();
  }

  // A strip that moved up when the one over it was answered: its buttons wait CALM ms.
  calm() { const d = Date.now() - (this.answeredAt ?? 0); return d >= 0 && d < CALM; } // a clock set back can't freeze it

  // The filter's flat list -------------------------------------------
  // While the filter box has text, it lists every file and folder under the folder whose name holds it
  // (filesfacts LIST_ALL_SH, findNames), not only the open folders. The names are listed when the box
  // gets text and again after the folder changed while it has text; a listing that fails (no sh on
  // Windows) leaves the box filtering the open folders, as before.

  listKey() { return `${this.context?.key ?? ""}|${this.git ? 1 : 0}|${this.showIgnored ? 1 : 0}`; }

  listAll(cx) {
    if (!this.filter.value().trim() || !this.root || !this.context) return;
    const key = this.listKey(), had = this.found?.key === key ? this.found : null;
    if (had && (had.busy || !this.foundStale)) return;
    this.foundStale = false;
    const context = this.context, root = this.root;
    // The last names stay in sight while they're listed again.
    const next = this.found = { key, busy: true, paths: had?.paths ?? null, cut: had?.cut ?? false, error: null };
    cx.spawn(async (cx) => {
      const r = await this.sh(LIST_ALL_SH, [root, this.git ? "git" : "", this.showIgnored ? "1" : "0", String(LIST_CAP + 1)]);
      if (this.found !== next || this.context !== context) return;
      next.busy = false;
      if (r.code !== 0) next.error = firstLine(r.stderr) || "Couldn't list the folder";
      else Object.assign(next, parseListing(r.stdout, LIST_CAP), { error: null });
      cx.notify();
    });
  }

  // The flat list shows while the box has text and this folder's names are being listed or are there.
  flatMode() {
    const f = this.found;
    return Boolean(this.filter.value().trim()) && f?.key === this.listKey() && !(f.error && !f.paths);
  }

  flatRows() {
    const paths = this.found?.paths ?? [], q = this.filter.value().trim();
    const m = this.flatMemo;
    if (m && m.paths === paths && m.q === q) return m.res;
    const res = findNames(paths, q, FOUND_MAX);
    this.flatMemo = { paths, q, res };
    return res;
  }

  // A row of the flat list picked (a click, Enter): the box empties, the tree opens down to it with the
  // cursor there, and a file opens (asking first over unsaved edits, as a click in the tree does).
  openFound(r, cx) {
    if (!r) return;
    this.filter.set_value(""); this.flatSel = 0; this.rail = "files";
    this.expandTo(r.path, cx, r.dir);
    this.cursor = r.path; this.reveal = r.path;
    this.handle.focus();
    if (!r.dir) this.pick(r.path, cx);
    cx.notify();
  }

  // The folder's menu from the + in the tree's header, under the button (to its left when the
  // window has no room on the right). A click on it while that menu is open closes it.
  plusMenu(cx) {
    const shut = this.menuShut;
    this.menuShut = null;
    if (shut?.rowId === "root-plus" && Date.now() - shut.at < 600) return; // that click closed it
    if (this.menu?.rowId === "root-plus") { this.closeMenu(); cx.notify(); return; }
    const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
    let left = false, position = { x: 0, y: 0 };
    try {
      const w = globalThis.window, vw = w?.viewport_size?.()?.width, mp = w?.mouse_position?.();
      if (mp) position = mp;
      if (vw && mp) left = mp.x + (MENU_W + 8) * zoom > vw;
    } catch { /* assume room */ }
    this.openMenu({ local_position: { x: (left ? 26 - MENU_W : 0) * zoom, y: 28 * zoom }, position }, "root-plus", { path: "", dir: true }, "root", cx);
  }

  setMode(mode, cx) {
    const pk = this.file ? previewKind(this.file) : null;
    if (!pk) return;
    this.mode = mode;
    this.keep(`mode.${pk}`, mode, this.fcfg.markdown);
    if (mode !== "source") this.livePreview(cx);
    cx.notify();
  }

  // Search's box emptied (its × or Esc): no query, no results.
  clearSearch() {
    this.finder.set_value("");
    this.search = { query: "", results: [], count: 0, truncated: false, busy: false, error: null };
  }

  // Content search in the folder: rg (fixed strings, smart case), else grep; at most 200 matches.
  // One search runs at a time: asked again meanwhile, the newest query runs when it ends. rg's lines
  // are cut at 300 columns and the whole output at 201 lines in the shell, so a short query in a big
  // repo (or a minified bundle) can't fill memory.
  runSearch(cx) {
    const query = this.finder.value().trim(), root = this.root, on = this.on, context = this.context;
    if (!query || !root) { this.searchAgain = false; this.search = { query, results: [], count: 0, truncated: false, busy: false, error: null }; cx.notify(); return; }
    if (this.searching) { this.searchAgain = true; return; }
    this.searching = true; this.searchAgain = false;
    this.search = { ...this.search, query, busy: true, error: null };
    cx.notify();
    const ci = query === query.toLowerCase() ? "-i" : "";
    cx.spawn(async cx => {
      let r;
      try {
        if (!on && window()?.platform === "windows") {
          r = await exec("rg", ["--vimgrep", "--max-count", "50", "--max-filesize", "1M", "--max-columns", "300", "--max-columns-preview", "--color", "never", "--fixed-strings", "--smart-case", "--", query, root], { timeout: 20000 }).catch((e) => ({ code: 2, stderr: String(e), stdout: "" }));
          r = { ...r, stdout: String(r.stdout ?? "").split("\n").slice(0, 201).join("\n") };
        } else {
          const script = 'if command -v rg >/dev/null 2>&1; then rg --vimgrep --max-count 50 --max-filesize 1M --max-columns 300 --max-columns-preview --color never --fixed-strings --smart-case -- "$1" "$2"; else grep -rnIF $3 --exclude-dir=.git --exclude-dir=node_modules -- "$1" "$2"; fi | head -n 201 | cut -c1-600';
          r = await exec("sh", ["-c", script, "search", query, root, ci], { on, timeout: 20000 }).catch((e) => ({ code: 2, stderr: String(e), stdout: "" }));
        }
      } finally { this.searching = false; }
      if (this.context === context && this.finder.value().trim() === query) {
        const parsed = parseSearchOutput(r.stdout, root, 200);
        this.search = { query, ...parsed, busy: false, error: !parsed.count && String(r.stderr ?? "").trim() ? String(r.stderr).trim().split("\n")[0] : null };
      }
      if (this.searchAgain) this.runSearch(cx);
      cx.notify();
    });
  }

  // Open with…: the editors installed (once a session) and, on macOS and Linux, the apps the system offers for the file,
  // kept a minute per extension so switching files is quick.
  discoverApps(ext, abs, cx) {
    const cached = this.appsCache.get(ext);
    if (cached && Date.now() - cached.at < APPS_FRESH) { this.apps = cached.apps; this.systemApp = cached.system; return; }
    const path = this.file;
    cx.spawn(async cx => {
      const got = await this.findApps(ext, abs);
      if (this.file === path) { this.apps = got.apps; this.systemApp = got.system; cx.notify(); }
    });
  }

  // The apps for a file with this extension ({ apps, system }, kept a minute). A folder (dir): the
  // code editors installed only (they open it as a project); Finder is the menu's System default.
  async findApps(ext, abs, dir = false) {
    const key = dir ? "/" : ext;
    const cached = this.appsCache.get(key);
    if (cached && Date.now() - cached.at < APPS_FRESH) return cached;
    const platform = window()?.platform ?? "macos";
    if (!this.catalogIds) {
      const bins = EDITOR_CATALOG.map((e) => e.binary).join(" ");
      // Windows: the JetBrains commands are .cmd files, which sh's command -v finds only by that name.
      const r = await exec("sh", ["-c", `for b in ${bins}; do { command -v "$b" || command -v "$b.cmd"; } >/dev/null 2>&1 && printf '%s\\n' "$b"; done; true`]).catch(() => null);
      const found = new Set(String(r?.stdout ?? "").split("\n").filter(Boolean));
      this.catalogIds = EDITOR_CATALOG.filter((e) => found.has(e.binary)).map((e) => e.id);
    }
    let macApps = [], system = null;
    if (platform === "macos" && !dir) {
      const jxa = 'function run(argv) { ObjC.import("AppKit"); const ws = $.NSWorkspace.sharedWorkspace, fm = $.NSFileManager.defaultManager, url = $.NSURL.fileURLWithPath(argv[0]); const urls = ws.URLsForApplicationsToOpenURL(url), def = ws.URLForApplicationToOpenURL(url); const out = []; for (let i = 0; i < urls.count && i < 60; i++) { const u = urls.objectAtIndex(i), p = u.path.js; let b = null; try { const bb = $.NSBundle.bundleWithURL(u); b = bb && bb.bundleIdentifier ? bb.bundleIdentifier.js : null; } catch (e) {} out.push({ name: fm.displayNameAtPath(p).js, path: p, bundle: b || null }); } return JSON.stringify({ apps: out, system: def && def.path ? def.path.js : null }); }';
      const r = await exec("osascript", ["-l", "JavaScript", "-e", jxa, abs], { timeout: 5000 }).catch(() => null);
      try { const o = JSON.parse(r?.stdout || "{}"); macApps = o.apps ?? []; system = o.system ?? null; } catch { /* the editors alone */ }
    }
    if (platform === "linux" && !dir) {
      // The desktop's apps for this type (their .desktop files), as macOS's list above.
      const r = await exec("sh", ["-c", LINUX_APPS_SH, "apps", abs], { timeout: 5000 }).catch(() => null);
      ({ apps: macApps, system } = parseLinuxApps(r?.stdout));
    }
    if (platform === "windows" && !dir) {
      // The apps Windows' Open with lists for this type (winapps.ps1), as macOS's list above.
      const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", nativePath(WINAPPS(), platform), "list", nativePath(abs, platform)], { timeout: 8000 }).catch(() => null);
      ({ apps: macApps, system } = parseLinuxApps(r?.stdout));
    }
    const got = { apps: mergeApps({ catalogInstalled: this.catalogIds, macApps, ext: dir ? "" : ext, platform }), system, at: Date.now() };
    this.appsCache.set(key, got);
    return got;
  }

  // The app the Open in button names now (SYSTEM_APP until the list is known).
  defaultApp() {
    return pickDefaultApp(this.apps ?? [], this.sharedPrefs(), extOf(this.file ?? ""), this.fcfg["default-app"]);
  }

  // The Open with… memory as every copy sees it now (shared "workspaces.files.prefs"), else this copy's read.
  sharedPrefs() {
    const p = shared("workspaces.files.prefs");
    return p && typeof p === "object" ? p : this.prefs;
  }

  // The cursor's line (1-based) in the editor, for editors that take one.
  cursorLine() {
    if (!this.code) return null;
    const at = this.code.selected_range()?.start ?? 0, text = this.code.value();
    let n = 1;
    for (let i = 0; i < Math.min(at, text.length); i++) if (text.charCodeAt(i) === 10) n++;
    return n > 1 ? n : null;
  }

  // explicit: picked from the Open in ▾ list (remembered for the extension); the button itself
  // opens the app it names, which only becomes the last one used (filesfacts rememberApp).
  // target: { abs, ext, dir } of a row of the tree (the right-click menu), else the open file.
  openWith(app, cx, explicit = false, target = null) {
    if (this.on || (!target && !this.file)) return;
    const abs = target?.abs ?? `${this.root}/${this.file}`, ext = target ? target.ext : extOf(this.file), platform = window()?.platform ?? "macos";
    const { cmd, args } = launchCommand(app, abs, !target && app.kind === "editor" ? this.cursorLine() : null, platform, { winapps: WINAPPS() });
    this.withOpen = false;
    cx.spawn(async cx => {
      const r = await exec(cmd, args, { timeout: 15000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      // explorer exits 1 even when it opened the file.
      if (r.code !== 0 && !(cmd === "explorer" && r.code === 1)) notify({ title: `Couldn't open ${baseName(abs)}`, body: String(r.stderr || "").trim().split("\n")[0] || `${cmd} failed`, level: "error" });
      if (app.id === "reveal" || target?.dir || !ext) return; // a folder: nothing to remember
      const had = this.sharedPrefs();
      if (!explicit && had?.last === app.id) return; // nothing new to remember
      this.prefs = rememberApp(had, ext, app.id, explicit);
      setShared("workspaces.files.prefs", this.prefs);
      cx.notify();
      // The file is shared by every copy: read, merge, write only over what was read (a few tries).
      for (let i = 0; i < 3; i++) {
        const was = await readTextFile(PREFS_FILE()).catch(() => null);
        const next = rememberApp(parsePrefs(was), ext, app.id, explicit);
        try { await writeTextFile(PREFS_FILE(), JSON.stringify(next, null, 2) + "\n", was); this.prefs = next; setShared("workspaces.files.prefs", next); break; }
        catch { /* changed under us: again */ }
      }
    });
  }

  copyPath(cx) {
    if (!this.file) return;
    cx.write_to_clipboard(nativePath(`${this.root}/${this.file}`, window()?.platform));
    this.copiedAt = Date.now();
    cx.notify();
  }

  // Narrow (beside a terminal), ←: the tree comes up over the open file, which keeps its place, cursor
  // and draft; picking a file (it again, or another, which asks first over a draft) lowers it.
  raiseTree(cx) {
    this.railUp = true;
    if (this.file) { this.expandTo(this.file, cx); this.reveal = this.file; }
    cx.notify();
  }

  // Back to the folder (the file-gone screen).
  closeFile(cx) {
    if (this.dirty) { this.pendingSwitch = { close: true }; cx.notify(); return; }
    this.show(null);
    cx.notify();
  }

  // The dialog's own × and Esc (props.file): with unsaved edits, the strip asks first (Save & close,
  // Discard & close; a second × or Esc drops the draft and closes), as ← does for the file.
  closeDialog(cx) {
    if (this.saving) return;
    if (this.dirty && this.pendingSwitch?.closeDialog) { this.settleSwitch("discard", cx); return; }
    if (this.dirty) { this.pendingSwitch = { closeDialog: true }; cx.notify(); return; }
    closeOverlay(props()?.overlay);
  }

  // Esc and Cmd/Ctrl+W in the dialog, which reach it as Herdr's actions (overlay.close, tab.close,
  // pane.close), never as keys. One level at a time: the right-click menu or the edit row, then the
  // Open in list, then the strip (after the close question a second Esc drops the draft and closes;
  // another strip is cancelled), then the close itself (it asks first over unsaved edits). While a
  // save or the edit row's step runs, nothing.
  dialogClose(cx) {
    if (this.saving || this.edit?.busy) return;
    if (this.discardArmed) { this.disarm(cx); return; } // Discard's question first
    if (this.menu || this.edit) { const ed = this.edit; this.closeMenu(); this.edit = null; if (ed) this.editKeyBack(ed); cx.notify(); return; }
    if (this.withOpen) { this.withOpen = false; cx.notify(); return; }
    if (this.pendingSwitch?.closeDialog) { this.settleSwitch("discard", cx); return; }
    if (this.pendingSwitch) { this.pendingSwitch = null; cx.notify(); return; }
    this.closeDialog(cx);
  }

  revealInTree(cx) {
    if (!this.file) return;
    this.rail = "files";
    this.filter.set_value("");
    this.expandTo(this.file, cx);
    this.reveal = this.file;
    cx.notify();
  }

  // A link in the Markdown preview: the web in the browser, a file here.
  linkClicked(url, cx) {
    const abs = `${this.root}/${this.file}`;
    const r = resolveRelativeLink(abs, url);
    if (r.external) { cx.open_url(r.external); return; }
    // The links it won't follow say so instead of nothing.
    if (r.anchor !== undefined) { notify({ title: "Links within the page don't jump here", level: "info", timeout: 3000 }); return; }
    if (r.blocked) { notify({ title: "Only web and file links open from a preview", body: `This one starts with ${linkScheme(r.blocked)}`, level: "info", timeout: 4000 }); return; }
    if (!r.path) return;
    const rel = relFromRoot(this.root, r.path);
    if (rel === null) { if (this.dirty) { this.pendingSwitch = { target: { path: r.path, on: this.on, isDir: false } }; cx.notify(); return; } this.openTarget({ path: r.path, on: this.on, isDir: false }, cx); return; }
    this.expandTo(rel, cx);
    this.pick(rel, cx);
  }

  keyDown(e, cx) {
    const m = e.modifiers ?? {}, cmd = m.platform || m.control;
    // Any key takes Discard's question back; Esc does only that.
    if (this.discardArmed) { this.disarm(cx); if (e.key === "escape") { cx.stop_propagation(); return; } }
    if (cmd && !m.shift && !m.alt && e.key === "s") {
      cx.stop_propagation();
      if (this.dirty && !this.conflict) cx.spawn(async (cx) => this.save(cx, { asNew: this.fileGone }));
      return;
    }
    if (cmd && m.shift && e.key === "v" && this.file && previewKind(this.file) && !this.truncated) {
      cx.stop_propagation();
      this.setMode(this.mode === "source" ? "preview" : "source", cx);
      return;
    }
    if (this.menu && ["up", "down", "left", "right", "enter"].includes(e.key) && this.menuKey(e, cx)) return;
    if (["up", "down", "left", "right", "enter"].includes(e.key) && !cmd && !m.shift && !m.alt && this.treeHasKeys()) {
      cx.stop_propagation();
      this.treeKey(e.key, cx);
      return;
    }
    if (e.key === "escape" && (this.menu || this.edit)) {
      const ed = this.edit;
      this.closeMenu(); this.edit = null; if (ed) this.editKeyBack(ed); cx.stop_propagation(); cx.notify(); return;
    }
    // Esc as a key: only in a pane or full size. In the dialog Herdr's Esc comes as overlay.close
    // (dialogClose()), never here.
    if (e.key === "escape") {
      if (this.withOpen) { this.withOpen = false; cx.stop_propagation(); cx.notify(); }
      else if (this.pendingSwitch) { this.pendingSwitch = null; cx.stop_propagation(); cx.notify(); }
      return;
    }
  }

  // The right-click menu ---------------------------------------------------
  // On a row of the tree or of Search: New file/folder, Open in ▸, Reveal in Finder, New terminal
  // here, Copy path / relative path, Rename, Duplicate, Move to Trash (filesfacts menuRows). It's a
  // Popup of this copy (so its steps use this copy's state), opened at the pointer; Open in ▸ is a
  // second Popup beside it (to its left when the window has no room on the right).

  // The write steps run in a shell on the folder's machine: not on Windows itself.
  writes() { return Boolean(this.on) || window()?.platform !== "windows" || localSh !== false; }

  // Names that differ only in case are the same entry here (macOS, Windows), not on another machine.
  caseless() { return !this.on && window()?.platform !== "linux"; }

  // The names in a folder of the tree (relative, "" the root), as last listed.
  namesIn(dir) { return (this.entries.get(dir) ?? []).map((e) => e.name); }

  // Paths go to sh with "/" (Git's sh on Windows takes C:/Users/…, and its dirname splits on "/").
  sh(script, args) {
    if (!this.on && window()?.platform === "windows") args = args.map((a) => String(a).replace(/\\/g, "/"));
    return exec("sh", ["-c", script, "files", ...args], { on: this.on, timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e), stdout: "" }));
  }

  openMenu(e, rowId, r, where, cx) {
    cx.stop_propagation();
    if (!this.root || this.edit?.busy) return;
    this.withOpen = false; this.edit = null;
    // Event positions are window px; the menu is placed in the units rows are written in: divide by the zoom.
    const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
    const at = e.local_position ?? { x: 24 * zoom, y: 13 * zoom };
    let roomRight = true;
    try { const vw = globalThis.window?.viewport_size?.()?.width; if (vw) roomRight = e.position.x + (MENU_W + SUB_W + 8) * zoom <= vw; } catch { /* assume room */ }
    this.menu = { rowId, path: r.path, name: baseName(r.path || this.root), dir: Boolean(r.dir), where, x: at.x / zoom, y: at.y / zoom, left: !roomRight };
    this.menuSub = false; this.menuSubIn = false; this.menuApps = null;
    // One lit row, the first, which Enter runs; the pointer takes it only once it moves from the press.
    this.menu.at = 0; this.menu.subAt = 0; this.pointerLast = pointKey(e.position);
    if (!this.on) {
      const m = this.menu, abs = r.path ? `${this.root}/${r.path}` : this.root;
      cx.spawn(async (cx) => {
        const got = await this.findApps(m.dir ? "" : extOf(m.path), abs, m.dir);
        if (this.menu === m) { this.menuApps = got; cx.notify(); }
      });
    }
    cx.notify();
  }

  closeMenu() { this.menu = null; this.menuSub = false; this.menuSubIn = false; }

  menuAct(id, cx) {
    const m = this.menu;
    if (!m) return;
    this.closeMenu();
    const abs = m.path ? `${this.root}/${m.path}` : this.root, here = m.dir ? m.path : dirName(m.path);
    switch (id) {
      case "new-file": case "new-folder": this.startNew(id === "new-file" ? "file" : "folder", here, cx); break;
      case "reveal": this.openWith({ id: "reveal" }, cx, false, { abs, ext: "", dir: m.dir }); break;
      case "terminal": {
        const space = this.place().space;
        if (props()?.screen) showTabs();
        run("tab.new", { ...(space ? { space } : {}), folder: m.dir ? abs : dirName(abs) });
        break;
      }
      case "copy-path": this.copyText(nativePath(abs, window()?.platform), "Path copied", cx); break;
      case "copy-rel": this.copyText(nativePath(m.path, window()?.platform), "Relative path copied", cx); break;
      case "rename": this.startRename(m.path, m.dir, cx); break;
      case "duplicate": this.duplicate(m, cx); break;
      case "trash":
        openOverlay({ mod: "ws-files", kind: "dialog", width: 440, height: 188, props: { trash: {
          abs, on: this.on ?? null, name: m.name, dir: m.dir, dirty: Boolean(this.dirty && this.file && isUnder(this.file, m.path)), by: this.id } } });
        break;
    }
    cx.notify();
  }

  copyText(text, title, cx) {
    cx.write_to_clipboard(text);
    notify({ title, body: text, level: "success", timeout: 2500 });
  }

  // Rename waits while the open file (or one inside the folder) has unsaved edits.
  blocksRename(path) { return Boolean(this.dirty && this.file && isUnder(this.file, path)); }

  // The edit row's box had the keyboard; once the row is gone (made, renamed, Esc) nothing drawn holds
  // it, so it goes back to the editor it came from, or to Files itself (its tree's and menus' keys). Not
  // after a blur: the keyboard went somewhere of the person's choosing then.
  editKeyBack(ed) {
    if (!this.nameKeys) return; // the keyboard went somewhere of the person's choosing (a terminal clicked while the step ran)
    this.nameKeys = false;
    if (ed?.back && ed.back === this.code) ed.back.focus();
    else this.handle.focus();
  }

  // The edit row: a new file or folder in `dir` (relative, "" the root).
  startNew(mode, dir, cx) {
    this.rail = "files";
    this.filter.set_value("");
    if (dir) this.expandTo(dir, cx, true);
    this.edit = { mode, dir, path: null, isDir: mode === "folder", at: Date.now(), focusAgain: true, back: this.codeFocused ? this.code : null };
    this.nameInput.set_value("");
    this.nameInput.focus();
    cx.notify();
  }

  // The edit row over a row of the tree, its name selected up to the extension.
  startRename(path, isDir, cx) {
    if (this.blocksRename(path)) return;
    this.rail = "files";
    this.filter.set_value("");
    this.expandTo(path, cx);
    this.reveal = path;
    const name = baseName(path);
    this.edit = { mode: "rename", dir: dirName(path), path, isDir, at: Date.now(), focusAgain: true, back: this.codeFocused ? this.code : null };
    this.nameInput.set_value(name);
    this.nameInput.focus();
    this.nameInput.set_selected_range({ start: 0, end: stemEnd(name, isDir) });
    cx.notify();
  }

  // What's wrong with the name typed (an empty one only once Enter was pressed).
  editProblem(name) {
    const ed = this.edit;
    if (!ed) return null;
    const p = nameProblem(name, { mode: ed.mode === "rename" ? "rename" : ed.mode, taken: this.namesIn(ed.dir), old: ed.path ? baseName(ed.path) : null, caseless: this.caseless(), isDir: ed.isDir, windows: !this.on && window()?.platform === "windows" });
    return p === "Type a name" && !ed.tried ? null : p;
  }

  // Enter in the edit row: make it or rename it, then show it (a new file opens).
  commitEdit(cx) {
    const ed = this.edit;
    if (!ed || ed.busy) return;
    const name = this.nameInput.value();
    ed.tried = true;
    if (this.editProblem(name)) { cx.notify(); return; }
    if (ed.mode === "rename" && name === baseName(ed.path)) { this.edit = null; this.editKeyBack(ed); cx.notify(); return; }
    const rel = ed.dir ? `${ed.dir}/${name}` : name, abs = `${this.root}/${rel}`, context = this.context;
    ed.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const old = ed.path ? `${this.root}/${ed.path}` : null;
      const r = ed.mode === "rename"
        ? await this.sh(RENAME, [old, abs, name.toLowerCase() === baseName(ed.path).toLowerCase() ? "1" : "0"])
        : await this.sh(ed.mode === "file" ? NEW_FILE : NEW_FOLDER, [abs]);
      if (this.context !== context) return;
      if (r.code !== 0) {
        ed.busy = false;
        // The step's own line, its paths from the folder shown (not from /).
        let said = firstLine(r.stderr);
        for (const root of new Set([this.root, String(this.root).replace(/\\/g, "/")])) {
          if (!root || /^([A-Za-z]:)?[\\/]?$/.test(root)) continue; // Files on / (or C:\) itself: the paths stay whole
          said = said.split(`${root}/`).join("").split(root).join(".");
        }
        ed.error = r.code === 3 ? `${name} is already there` : said || (ed.mode === "rename" ? "Couldn't rename it" : `Couldn't make the ${ed.mode}`);
        if (this.edit === ed) { ed.focusAgain = true; } else { this.edit = ed; ed.focusAgain = true; }
        cx.notify();
        return;
      }
      if (this.edit === ed) { this.edit = null; this.editKeyBack(ed); }
      await this.loadFolder(ed.dir, context).catch(() => {});
      if (ed.mode === "rename") {
        if (name.includes("/")) this.expandTo(rel, cx); // a move: the tree opens down to where it went
        this.followRename(ed.path, rel, cx);
        setShared("workspaces.files.changed", { id: `${this.id}-${Date.now()}`, kind: "rename", from: old, to: abs, on: this.on ?? null, at: Date.now(), by: this.id });
      } else if (ed.mode === "file") { this.expandTo(rel, cx); this.reveal = rel; this.pick(rel, cx); }
      else { this.expandTo(rel, cx, true); this.reveal = rel; }
      this.refresh(cx); // another machine has no folder watch
      cx.notify();
    });
  }

  // After a rename here: the folders open inside it and the open file follow its new name.
  followRename(from, to, cx) {
    const moved = [...this.folders].filter((f) => isUnder(f, from));
    for (const f of moved) { this.folders.delete(f); this.entries.delete(f); }
    for (const f of moved) this.expand(movedPath(f, from, to), cx);
    if (this.file && isUnder(this.file, from)) this.show(movedPath(this.file, from, to), cx);
    this.reveal = to;
  }

  // A rename or a trash published by a copy (shared "workspaces.files.changed"): the open file
  // follows it (a trashed one closes, its draft with it: the dialog said so).
  followChange(c, cx) {
    if (!this.root || (c.on ?? null) !== (this.on ?? null)) return;
    const from = relFromRoot(this.root, c.from);
    if (from === null) return;
    if (c.kind === "trash") {
      const then = afterTrash({ under: Boolean(this.file && isUnder(this.file, from)), dirty: this.dirty, asked: c.by === this.id });
      if (then === "keep") this.fileGone = true;
      else if (then === "close") { this.dirty = false; this.show(null); }
      for (const f of [...this.folders]) if (isUnder(f, from)) { this.folders.delete(f); this.entries.delete(f); }
      this.refresh(cx);
    } else if (c.kind === "rename" && c.by !== this.id) {
      const to = relFromRoot(this.root, c.to);
      if (to !== null && this.file && isUnder(this.file, from) && !this.dirty) this.show(movedPath(this.file, from, to), cx);
      this.refresh(cx);
    }
    cx.notify();
  }

  // Duplicate: "name copy.ext" beside it, then its name in the edit row.
  // From a folder not listed in the tree (a flat-list row), the folder is listed first for the name.
  duplicate(m, cx) {
    const dir = dirName(m.path), context = this.context, root = this.root, on = this.on;
    if (dir) this.expandTo(m.path, cx);
    cx.spawn(async (cx) => {
      const names = this.entries.has(dir) ? this.namesIn(dir) : (await directory(dir ? `${root}/${dir}` : root, on).catch(() => [])).map((e) => e.name);
      if (this.context !== context) return;
      const name = copyName(m.name, names, m.dir, this.caseless()), rel = dir ? `${dir}/${name}` : name;
      const r = await this.sh(DUPLICATE, [`${this.root}/${m.path}`, `${this.root}/${rel}`]);
      if (this.context !== context) return;
      if (r.code !== 0) { notify({ title: `Couldn't duplicate ${m.name}`, body: r.code === 3 ? `${name} is already there` : firstLine(r.stderr), level: "error" }); return; }
      await this.loadFolder(dir, context).catch(() => {});
      this.startRename(rel, m.dir, cx);
      this.refresh(cx);
    });
  }

  // The menu itself, and Open in ▸ beside it, as Popups pinned to a point in the row it opened on.
  withMenu(el, rowId, t) {
    const m = this.menu;
    if (!m || m.rowId !== rowId) return el;
    const platform = window()?.platform ?? "macos";
    const rows = menuRows({ where: m.where, remote: Boolean(this.on), writes: this.writes(), platform });
    let top = 5, subTop = 5;
    const keyed = this.menuItems(m, platform);
    const items = rows.map((id, i) => {
      if (id === null) { top += 9; return div().h(1).my(4).bg(t.border); }
      if (id === "open-in") subTop = top;
      top += 28;
      const why = id === "rename" && this.blocksRename(m.path) ? "Save first" : null;
      const sub = id === "open-in";
      const k = keyed.indexOf(id);
      // One lit row (the keys' and the pointer's; no hover fill of its own), which Enter runs.
      return h_flex().id(`ws-files-menu-${id}`).h(28).px(8).gap(8).items_center().rounded(6)
        .when(!why, (s) => s.cursor_pointer())
        .when(Boolean(why), (s) => s.text_color(t.dim))
        .when(k >= 0 && k === m.at, (s) => s.bg(t.selected))
        .on_hover((h, cx) => { if (h && this.menuSub !== sub) { this.menuSub = sub; cx.notify(); } })
        .when(k >= 0, (s) => s.on_mouse_move((e, cx) => {
          this.pointerRow("at", k, e, cx);
          if (!sub && this.menuSub && this.menu?.at === k) { this.menuSub = false; cx.notify(); } // one lit row: Open in's list goes
        }))
        .on_click((_e, cx) => { if (why) return; if (sub) { this.menuSub = !this.menuSub; cx.notify(); return; } this.menuAct(id, cx); })
        .child(div().flex_1().min_w(0).truncate().child(menuLabel(id, platform)))
        .when(Boolean(why), (s) => s.child(div().flex_none().text_size(11).child(why)))
        .when(sub, (s) => s.child(svg("mods/ws-files/chevron-right.svg").size(12).flex_none().text_color(t.dim)));
    });
    const box = (id, w) => v_flex().id(id).w(w).p(5).rounded(8).shadow_md().border_1().border_color(t.border).bg(t.popover).text_size(12.5).text_color(t.foreground);
    const list = box("ws-files-menu-list", MENU_W)
      .on_mouse_down_out((_e, cx) => { if (this.menuSubIn) return; this.menuShut = { rowId: m.rowId, at: Date.now() }; this.closeMenu(); cx.notify(); })
      .children(items);
    const point = (id, x, y) => Popup.new(id, div().size(0)).absolute().left(x).top(y).anchor("top_left");
    const subX = m.left ? m.x - SUB_W - 2 : m.x + MENU_W + 2;
    return el.relative()
      .child(point("ws-files-menu", m.x, m.y).content(list))
      .when(this.menuSub, (s) => s.child(point("ws-files-menu-sub", subX, m.y + subTop - 5).content(this.subMenu(t, m, platform))));
  }

  // Open in ▸: the apps for that file (as Open in ▾ lists them), or the code editors and Finder for a folder.
  subMenu(t, m, platform) {
    const got = this.menuApps, ext = m.dir ? "" : extOf(m.path), abs = m.path ? `${this.root}/${m.path}` : this.root;
    const chosen = !m.dir && got ? pickDefaultApp(got.apps, this.sharedPrefs(), ext, this.fcfg["default-app"]) : null;
    const row = (rid, name, app, hint = "", checked = false, k = 0) => h_flex().id(rid).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .when(k === m.subAt, (s) => s.bg(t.selected))
      .on_mouse_move((e, cx) => this.pointerRow("subAt", k, e, cx))
      .on_click((_e, cx) => { this.closeMenu(); this.openWith(app, cx, !m.dir, { abs, ext, dir: m.dir }); cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().child(name))
      .when(Boolean(hint), (s) => s.child(div().flex_none().text_size(11).text_color(t.dim).child(hint)))
      .when(checked, (s) => s.child(svg("mods/ws-files/check.svg").size(13).flex_none().text_color(t.accent)));
    const apps = (got?.apps ?? []).slice(0, 12);
    const caption = m.dir ? "Open the folder with" : ext ? `Open .${ext} with${this.sharedPrefs().byExt?.[ext] ? " (remembered)" : ""}` : "Open with";
    const finder = m.dir && platform === "macos" ? "Finder" : "System default";
    return v_flex().id("ws-files-menu-sub-list").w(SUB_W).p(5).rounded(8).shadow_md().border_1().border_color(t.border).bg(t.popover).text_size(12.5).text_color(t.foreground)
      .on_hover((h, cx) => { if (this.menuSubIn !== h) { this.menuSubIn = h; cx.notify(); } })
      .child(div().px(8).pt(3).pb(5).text_size(11).text_color(t.dim).child(caption))
      .when(!got, (s) => s.child(div().px(8).py(6).text_color(t.dim).child("Looking for apps…")))
      .children(apps.map((a, i) => row(`ws-files-sub-${i}`, a.label, a, a.path && a.path === got?.system ? "system" : "", chosen?.id === a.id, i)))
      .when(Boolean(got), (s) => s.child(row("ws-files-sub-system", finder, SYSTEM_APP, "", chosen?.id === "system", apps.length)));
  }

  // The rows the keys can light: no line, no row waiting on a save (Rename's "Save first").
  menuItems(m, platform = window()?.platform ?? "macos") {
    return menuRows({ where: m.where, remote: Boolean(this.on), writes: this.writes(), platform })
      .filter((id) => id !== null && !(id === "rename" && this.blocksRename(m.path)));
  }

  // Open in ▸'s apps in its order, the system's last (what Enter there opens).
  subApps() {
    const got = this.menuApps;
    return got ? [...(got.apps ?? []).slice(0, 12), SYSTEM_APP] : [];
  }

  // A row under a pointer that moves becomes the keys' row. pointerLast starts at the press that
  // opened the menu and follows every move; a move at the same place as the last one is no move (a
  // resting pointer, or one re-sent with no movement), so it never takes the row. which: "at" for the
  // menu, "subAt" for Open in ▸.
  pointerRow(which, i, e, cx) {
    const here = pointKey(e?.position);
    if (here === undefined || here === this.pointerLast) return;
    const first = this.pointerLast === undefined;
    this.pointerLast = here;
    if (first || !this.menu) return; // no press known: the first move is only where it rests
    if (this.menu[which] !== i) { this.menu[which] = i; cx.notify(); }
  }

  // ↑ ↓ move the lit row, Enter runs it (not a held one), → or Enter on Open in opens its list and
  // ← closes it. Only where Files already has the keyboard: a right-click doesn't take it.
  menuKey(e, cx) {
    const m = this.menu, mods = e.modifiers ?? {};
    if (!m || mods.platform || mods.control || mods.alt || mods.shift) return false;
    if (this.menuSub) {
      const apps = this.subApps(), n = apps.length;
      if (e.key === "left") this.menuSub = false;
      else if (!n) { if (!["up", "down", "enter", "right"].includes(e.key)) return false; }
      else if (e.key === "down" || e.key === "up") m.subAt = stepRow(m.subAt, n, e.key);
      else if (e.key === "enter") {
        cx.stop_propagation();
        if (e.is_held) return true;
        this.menuEnterAt = Date.now();
        const app = apps[Math.min(m.subAt, n - 1)], abs = m.path ? `${this.root}/${m.path}` : this.root;
        this.closeMenu(); this.openWith(app, cx, !m.dir, { abs, ext: m.dir ? "" : extOf(m.path), dir: m.dir }); cx.notify();
        return true;
      } else if (e.key !== "right") return false;
      cx.stop_propagation(); cx.notify(); return true;
    }
    const items = this.menuItems(m), n = items.length;
    if (!n) return false;
    const id = items[Math.min(m.at, n - 1)];
    if (e.key === "down" || e.key === "up") m.at = stepRow(m.at, n, e.key);
    else if (e.key === "right" && id === "open-in") { this.menuSub = true; m.subAt = 0; }
    else if (e.key === "enter") {
      cx.stop_propagation();
      if (e.is_held) return true;
      this.menuEnterAt = Date.now(); // the filter box's submit then knows this Enter was the menu's
      if (id === "open-in") { this.menuSub = true; m.subAt = 0; cx.notify(); return true; }
      this.menuAct(id, cx); cx.notify();
      return true;
    } else return false;
    cx.stop_propagation(); cx.notify(); return true;
  }

  // The edit row in the tree (a new file or folder, or a rename), with what's wrong under it.
  editRow(t, depth) {
    const ed = this.edit, value = this.nameInput.value();
    ed.drawn = true; // fast() hands it the keyboard (not state that redraws)
    const problem = ed.error ?? this.editProblem(value);
    const icon = ed.isDir ? "folder" : iconOf(value || "x", false);
    const where = ed.dir || baseName(this.root ?? "") || "the folder";
    const hint = ed.busy ? (ed.mode === "rename" ? "Renaming…" : "Making it…")
      : ed.mode === "rename" ? (value.includes("/") ? `Enter moves it to ${ed.dir ? `${ed.dir}/` : ""}${value} · Esc cancels` : "Enter renames it · Esc cancels")
      : `New ${ed.mode} in ${where} · Enter ${ed.mode === "file" ? "makes and opens it" : "makes it"} · Esc cancels`;
    const pad = 6 + depth * 14;
    return v_flex().id("ws-files-edit").flex_none()
      .child(h_flex().id("ws-files-edit-row").h(26).pl(pad).pr(6).gap(6).items_center().rounded(6).border_1().border_color(problem ? t.ansi1 : t.accent).bg(t.background)
        .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); if (!ed.busy) { this.edit = null; this.editKeyBack(ed); cx.notify(); } } })
        .child(div().w(12).flex_none())
        .child(svg(`mods/ws-files/${icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).child(Input.new(this.nameInput).text_size(12.5))))
      .child(div().pl(pad + 18).pr(6).pt(2).pb(4).text_size(11).text_color(problem ? t.ansi1 : t.dim).child(problem || hint));
  }

  // The Trash dialog -------------------------------------------------------
  // A copy of its own (props.trash { abs, on, name, dir, dirty }). It moves the entry to the Trash
  // and publishes shared "workspaces.files.changed", so every copy closes a file that went with it.

  trashInit(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.trashing = false; this.trashError = null; this.trashCount = null;
    const a = props().trash;
    if (a.dir && !checking()) cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", COUNT, "files", a.abs], { on: a.on ?? undefined, timeout: 10000 }).catch(() => null);
      const n = Number(String(r?.stdout ?? "").trim());
      if (r?.code === 0 && Number.isFinite(n)) { this.trashCount = n; cx.notify(); }
    });
  }

  trashNow(cx) {
    const p = props(), a = p.trash;
    if (this.trashing) return;
    this.trashing = true; this.trashError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", TRASH, "files", a.on ? a.abs : String(a.abs).replace(/\\/g, "/")], { on: a.on ?? undefined, timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      this.trashing = false;
      if (r.code !== 0 && r.code !== 4) { this.trashError = firstLine(r.stderr) || (window()?.platform === "windows" && !a.on ? "Couldn't move it to the Recycle Bin." : "Couldn't move it to the Trash."); cx.notify(); return; }
      setShared("workspaces.files.changed", { id: `trash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: "trash", from: a.abs, on: a.on ?? null, at: Date.now(), by: a.by ?? null });
      const where = String(r.stdout ?? "").trim();
      if (where && where !== "Trash") notify({ title: `${a.name} moved to ${where.replace(home() ?? "\0", "~")}`, body: "There's no Trash command here, so it went into that folder.", level: "info", timeout: 5000 });
      closeOverlay(p.overlay);
    });
  }

  trashView(cx) {
    const t = theme(), a = props().trash, mac = window()?.platform === "macos", win = !a.on && window()?.platform === "windows";
    const bin = win ? "the Recycle Bin" : "the Trash";
    const n = this.trashCount;
    const what = a.dir ? (n == null ? `${a.name} and everything in it` : n === 0 ? `${a.name} (empty)` : `${a.name} and the ${n > 10000 ? "10,000+" : n.toLocaleString()} file${n === 1 ? "" : "s"} in it`) : a.name;
    const back = a.on ? "If that machine has no Trash, it goes into ~/.herdr/trash there." : mac ? "You can put it back from the Trash in Finder." : win ? "You can put it back from the Recycle Bin." : "You can put it back from the trash.";
    const detail = [back, a.dirty ? "Its unsaved edits are lost too." : null].filter(Boolean).join(" ");
    const button = (id, label, bg, fg, border, onClick) => h_flex().id(id).h(30).px(14).items_center().rounded(7).border_1().border_color(border).bg(bg).text_color(fg).cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    const trashEsc = (_e, cx) => { cx.stop_propagation(); if (!this.trashing) closeOverlay(props().overlay); };
    return v_flex().id("ws-files-trash").track_focus(this.handle).size_full().min_h(0).p(18).gap(10).rounded(8).bg(t.popover).text_size(13).text_color(t.foreground)
      // Herdr's Esc (and Cmd/Ctrl+W) comes as overlay.close, never as a key: claimed so that it waits
      // while Moving… (closing would end the step half way, and the other copies wouldn't hear of it).
      .on_key_down((e, cx) => { if (e.key === "enter") { cx.stop_propagation(); this.trashNow(cx); } })
      .on_action("overlay.close", trashEsc).on_action("tab.close", trashEsc).on_action("pane.close", trashEsc)
      .child(div().text_size(14.5).font_semibold().child(`Move ${what} to ${bin}?`))
      .child(div().flex_1().min_h(0).text_color(t.muted).child(this.trashError ? `Couldn't: ${this.trashError}` : detail))
      .child(h_flex().justify_end().gap(8).text_size(12.5)
        .child(button("ws-files-trash-no", "Cancel", t.raised, t.foreground, t.input, () => closeOverlay(props().overlay)))
        .child(button("ws-files-trash-yes", this.trashing ? "Moving…" : win ? "Move to Recycle Bin" : "Move to Trash", t.ansi1, t.solid_foreground, t.ansi1, (_e, cx) => this.trashNow(cx))));
  }

  // Pieces ---------------------------------------------------------------

  iconButton(t, id, icon, tip, onClick, opts = {}) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(opts.on ? t.foreground : t.muted).when(Boolean(opts.on), (s) => s.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground))
      // No tooltip while the menu it opened is up (gpui drops a shown one once it's gone).
      .when(!opts.open, (s) => s.tooltip(tip)).on_click((_e, cx) => onClick(cx))
      .child(svg(`mods/ws-files/${icon}.svg`).size(14));
  }

  // Discard asks in place: the first press turns it into "Discard changes?" in `blocked`, a press
  // within 500 ms of that doesn't count (discardStep), the next one puts the saved text back. Any key,
  // typing, a press elsewhere, Esc, a save or another file takes the question back. Its widest label
  // is laid out unseen inside it, so it never changes width and Save beside it never moves.
  discardButton(t) {
    const armed = Boolean(this.discardArmed);
    return h_flex().id("ws-files-discard").h(26).px(10).flex_none().items_center().rounded(6).cursor_pointer().text_size(12.5).relative()
      .text_color(armed ? t.blocked : t.muted).hover((x) => x.bg(t.hover))
      .on_mouse_down_out((_e, cx) => this.disarm(cx))
      .on_click((_e, cx) => this.discardPress(cx))
      .child(div().opacity(0).child("Discard changes?"))
      .child(div().absolute().inset_0().flex().items_center().justify_center().child(armed ? "Discard changes?" : "Discard"));
  }

  discardPress(cx) {
    const step = discardStep(this.discardArmed, Date.now());
    if (step === "wait") return;
    if (step === "arm") { this.discardArmed = Date.now(); cx.notify(); return; }
    this.discardArmed = 0;
    this.answeredAt = Date.now(); // what slides into Discard's place waits (calm())
    this.discard(cx);
  }

  disarm(cx) { if (this.discardArmed) { this.discardArmed = 0; cx.notify(); } }

  // kind: "solid" (the one primary), "outline", "quiet".
  textButton(t, id, label, onClick, kind = "quiet", extra = null, tip = null) {
    return h_flex().id(id).h(26).px(10).gap(6).flex_none().items_center().rounded(6).cursor_pointer().text_size(12.5)
      .when(kind === "solid", (s) => s.bg(t.solid).text_color(t.solid_foreground).hover((x) => x.opacity(0.9)))
      .when(kind === "outline", (s) => s.border_1().border_color(t.border).text_color(t.foreground).hover((x) => x.bg(t.hover)))
      .when(kind === "quiet", (s) => s.text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground)))
      .when(Boolean(tip), (s) => s.tooltip(tip))
      .on_click((_e, cx) => onClick(cx))
      .child(label)
      .when(Boolean(extra), (s) => s.child(div().text_size(11).opacity(0.6).child(extra)));
  }

  // Open in <app> ▾: the remembered app, and the list.
  openIn(t, id, kind, narrow) {
    const app = this.defaultApp(), mac = window()?.platform === "macos";
    const label = narrow ? app.label : `Open in ${app.label}`;
    const solid = kind === "solid";
    const fg = solid ? t.solid_foreground : t.foreground;
    const half = (s) => s.h(26).flex().items_center().cursor_pointer().when(solid, (x) => x.bg(t.solid).hover((y) => y.opacity(0.9))).when(!solid, (x) => x.hover((y) => y.bg(t.hover)));
    const trigger = h_flex().flex_none().rounded(6).overflow_hidden().text_size(12.5).text_color(fg).when(!solid, (x) => x.border_1().border_color(t.border))
      .child(half(h_flex().id(`${id}-go`).px(10).gap(6)).tooltip(`Open ${this.file} in ${app.label}`)
        .on_click((_e, cx) => { if (!this.calm()) this.openWith(app, cx); })
        .child(svg("mods/ws-files/external-link.svg").size(13)).child(label))
      .child(half(div().id(`${id}-more`).w(22).justify_center().border_l(1).border_color(solid ? fade(t.solid_foreground, 0.25) : t.border)).when(!this.withOpen, (x) => x.tooltip("Open with…"))
        // A press on ▾ while the list is open is a press outside the list, which closed it in the same
        // press (capture runs first): the click that follows mustn't open it again.
        .on_mouse_down("left", () => { this.withSkip = Boolean(this.withShut) && Date.now() - this.withShut < 100; })
        .on_click((_e, cx) => { if (this.withSkip) { this.withSkip = false; return; } if (this.calm()) return; this.withOpen = !this.withOpen; cx.notify(); })
        .child(svg("mods/ws-files/chevron-down.svg").size(12)));
    const row = (rid, icon, name, onClick, hint = "", checked = false) => h_flex().id(rid).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => onClick(cx))
      .child(icon)
      .child(div().flex_1().min_w(0).truncate().child(name))
      .when(Boolean(hint), (s) => s.child(div().flex_none().text_size(11).text_color(t.dim).child(hint)))
      .when(checked, (s) => s.child(svg("mods/ws-files/check.svg").size(13).flex_none().text_color(t.accent)));
    const mark = (a) => div().size(16).flex_none().rounded(4).bg(t.raised).flex().items_center().justify_center().text_size(10).font_semibold().text_color(t.muted).child(a.label.slice(0, 1).toUpperCase());
    const apps = (this.apps ?? []).slice(0, 12), ext = extOf(this.file);
    const list = v_flex().id(`${id}-list`).w(260).p(5).mt(4).rounded(8).shadow_md().border_1().border_color(t.border).bg(t.popover).text_size(12.5).text_color(t.foreground)
      .on_mouse_down_out((_e, cx) => { this.withOpen = false; this.withShut = Date.now(); cx.notify(); })
      .child(div().px(8).pt(3).pb(5).text_size(11).text_color(t.dim).child(ext ? `Open .${ext} with${this.sharedPrefs().byExt?.[ext] ? " (remembered)" : ""}` : "Open with"))
      .when(!this.apps, (s) => s.child(div().px(8).py(6).text_color(t.dim).child("Looking for apps…")))
      .children(apps.map((a, i) => row(`${id}-app-${i}`, mark(a), a.label, (cx) => this.openWith(a, cx, true), a.path && a.path === this.systemApp ? "system" : "", a.id === app.id)))
      .child(row(`${id}-app-system`, div().size(16).flex_none(), SYSTEM_APP.label, (cx) => this.openWith(SYSTEM_APP, cx, true), "", app.id === "system"))
      .child(div().h(1).my(4).bg(t.border))
      .child(row(`${id}-reveal`, svg("mods/ws-files/folder.svg").size(14).flex_none().text_color(t.muted), mac ? "Reveal in Finder" : window()?.platform === "windows" ? "Show in Explorer" : "Show in folder", (cx) => this.openWith({ id: "reveal" }, cx)))
      .child(row(`${id}-copy`, svg("mods/ws-files/copy.svg").size(14).flex_none().text_color(t.muted), "Copy path", (cx) => { this.withOpen = false; this.copyPath(cx); }));
    return Popup.new(`${id}-popup`, trigger).anchor("top_right").when(this.withOpen, (el) => el.content(list));
  }

  // The rail: Files | Search.
  railView(t, narrow) {
    const tab = (key, icon, label) => h_flex().id(`ws-files-tab-${key}`).h(26).px(9).gap(6).items_center().rounded(6).cursor_pointer().text_size(12.5)
      .text_color(this.rail === key ? t.foreground : t.muted).when(this.rail === key, (s) => s.bg(t.selected)).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.rail = key; if (key === "search") this.finder.focus(); cx.notify(); })
      .child(svg(`mods/ws-files/${icon}.svg`).size(13)).child(label);
    return v_flex().size_full().min_h(0).bg(t.chrome).when(!narrow, (s) => s.border_r(1).border_color(t.border))
      .child(h_flex().h(38).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
        .child(tab("files", "folder", "Files")).child(tab("search", "search", "Search"))
        .when(Boolean(props()?.file) && narrow, (s) => s.child(div().flex_1()).child(this.iconButton(t, "ws-files-x-rail", "x", "Close", (cx) => this.closeDialog(cx)))))
      .child(this.rail === "search" ? this.searchView(t) : this.treeView(t));
  }

  // Left out of the tree: ignored by git (outside git, dotfiles), unless Show ignored is on (always:
  // whether it would be). Never the open file or a folder holding it.
  hidden(path, entry, always = false) {
    if (this.showIgnored && !always) return false;
    if (this.file && (this.file === path || this.file.startsWith(`${path}/`))) return false;
    if (this.git) {
      let p = `${this.root}/${path}`;
      for (;;) {
        if (this.ignored.has(p)) return true;
        const i = p.lastIndexOf("/");
        if (i <= this.root.length) return false;
        p = p.slice(0, i);
      }
    }
    return entry.name.startsWith(".");
  }

  // The tree's rows as shown: the entries without what's hidden (ignored by git; outside git,
  // dotfiles), then the filter.
  treeRows() {
    const visible = new Map();
    for (const [dir, list] of this.entries) visible.set(dir, list.filter((e) => !this.hidden(dir ? `${dir}/${e.name}` : e.name, e)));
    return filterEntries(visible, this.folders, this.filter.value(), TOTAL);
  }

  // The tree takes ↑ ↓ ← → Enter while it's in sight and the view itself has the keyboard (not a
  // box or the editor), with no menu, edit row, strip or list open over it.
  treeHasKeys() {
    return this.rail === "files" && !this.menu && !this.edit && !this.pendingSwitch && !this.withOpen && !this.flatMode()
      && !(this.narrowNow && this.file && !this.railUp) && Boolean(this.handle?.is_focused());
  }

  // A key on the tree (filesfacts treeStep): the cursor moves, kept in sight (reveal); a folder opens
  // or closes; Enter opens a file. From no cursor it starts at the open file's row.
  treeKey(key, cx) {
    const rows = this.treeRows(), has = (p) => p != null && rows.some((r) => r.path === p);
    const { cursor, act } = treeStep(rows, has(this.cursor) ? this.cursor : has(this.file) ? this.file : null, key);
    this.cursor = cursor; this.reveal = cursor;
    if (act === "open" && !this.folders.has(cursor)) this.expand(cursor, cx);
    else if (act === "close" && this.folders.has(cursor)) this.toggle(cursor, cx);
    else if (act === "pick") this.pick(cursor, cx);
    cx.notify();
  }

  // A key in the filter box: Esc empties it; ↓ goes into the rows (the first one; the view takes the keyboard).
  // With the flat list, ↑ ↓ move its selection and the keyboard stays in the box (Enter opens: submit).
  filterKey(e, rows, cx) {
    // With the right-click menu open (a right-click leaves the keyboard in the box), Esc closes the menu, not the box's text.
    if (e.key === "escape" && this.menu) { this.closeMenu(); cx.stop_propagation(); cx.notify(); }
    else if (this.menu && ["up", "down", "left", "right", "enter"].includes(e.key)) this.menuKey(e, cx); // the open menu's keys, not the list's
    else if (e.key === "escape" && this.filter.value()) { this.filter.set_value(""); cx.stop_propagation(); cx.notify(); }
    else if ((e.key === "up" || e.key === "down") && this.flatMode()) {
      cx.stop_propagation();
      const n = this.flatRows().rows.length;
      if (!n) return;
      this.flatSel = Math.max(0, Math.min(n - 1, (this.flatSel ?? 0) + (e.key === "down" ? 1 : -1)));
      this.treeScroll.scroll_to_item(this.flatSel);
      cx.notify();
    }
    else if (e.key === "down" && rows.length) { cx.stop_propagation(); this.cursor = rows[0].path; this.reveal = this.cursor; this.handle.focus(); cx.notify(); }
  }

  treeView(t) {
    const query = this.filter.value(), flat = this.flatMode();
    const rows = flat ? [] : this.treeRows();
    const folder = baseName(this.root ?? "") || this.root || "";
    const followed = this.pin ? baseName(this.place().cwd ?? "") : "";
    const revealAt = this.reveal ? rows.findIndex((r) => r.path === this.reveal) : -1;
    if (revealAt >= 0) { this.treeScroll.scroll_to_item(revealAt); this.reveal = null; }
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(32).flex_none().pl(12).pr(6).gap(6).items_center()
        .when(Boolean(this.pin), (s) => s.child(this.iconButton(t, "ws-files-unpin", "undo", followed ? `Back to ${followed}` : "Back to the followed folder", (cx) => this.unpin(cx))))
        .child(this.withMenu(div().id("ws-files-root").flex_none().max_w(140).truncate().font_semibold().text_size(12.5).child(folder).when(this.menu?.rowId !== "root-name", (x) => x.tooltip(this.root ?? ""))
          .on_mouse_down("right", (e, cx) => this.openMenu(e, "root-name", { path: "", dir: true }, "root", cx)), "root-name", t))
        .when(Boolean(this.branch), (s) => s.child(h_flex().flex_1().min_w(0).gap(3).items_center().text_size(11.5).text_color(t.dim)
          .child(svg("mods/ws-files/git-branch.svg").size(11).flex_none()).child(div().min_w(0).truncate().child(this.branch))))
        .when(!this.branch, (s) => s.child(div().flex_1()))
        // The folder's menu (New file…, New folder…) from a button, where the right-click is hidden.
        .when(Boolean(this.root) && this.writes(), (s) => s.child(this.withMenu(this.iconButton(t, "ws-files-plus", "plus", "New file or folder", (cx) => this.plusMenu(cx), { on: this.menu?.rowId === "root-plus", open: this.menu?.rowId === "root-plus" }), "root-plus", t)))
        .child(this.iconButton(t, "ws-files-ignored", this.showIgnored ? "eye" : "eye-off", this.git ? (this.showIgnored ? "Hide ignored files" : "Show ignored files") : (this.showIgnored ? "Hide hidden files" : "Show hidden files"),
          (cx) => { this.showIgnored = !this.showIgnored; this.keep("ignored", this.showIgnored ? "1" : "0", String(this.fcfg["show-ignored"] === true)); this.listAll(cx); cx.notify(); }, { on: this.showIgnored }))
        .child(this.iconButton(t, "ws-files-refresh-tree", "refresh", "Refresh", (cx) => this.refresh(cx))))
      .child(div().px(8).pb(6).flex_none()
        .child(h_flex().id("ws-files-filter").h(28).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.border).bg(t.background).cursor_text()
          .on_key_down((e, cx) => this.filterKey(e, rows, cx))
          // In the dialog Esc comes as overlay.close: with text in the box, it empties the box first.
          .when(Boolean(props()?.file && query), (el) => el.on_action("overlay.close", (_e, cx) => { cx.stop_propagation(); if (this.menu) this.closeMenu(); else this.filter.set_value(""); cx.notify(); }))
          .child(svg("mods/ws-files/search.svg").size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).child(Input.new(this.filter).text_size(12.5)))
          .when(Boolean(query), (s) => s.child(div().id("ws-files-filter-x").flex_none().size(20).mr(-4).flex().items_center().justify_center().cursor_pointer().text_color(t.dim).hover((x) => x.text_color(t.foreground))
            .on_click((_e, cx) => { this.filter.set_value(""); cx.notify(); }).child(svg("mods/ws-files/x.svg").size(12))))))
      // A right-click on the empty space under the rows (a row's own stops there) is the folder's menu.
      .child(this.withMenu(v_flex().id("ws-files-tree-area").flex_1().min_h(0)
        .on_mouse_down("right", (e, cx) => this.openMenu(e, "root", { path: "", dir: true }, "root", cx))
        .child(flat ? this.flatList(t, folder) : v_flex().id("ws-files-tree").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.treeScroll).px(6).pb(6)
        .children(this.withEditRow(t, rows))
        .when(Boolean(this.error) || !rows.length, (s) => s.child(div().p(8).text_size(12).text_color(t.dim)
          .child(this.error || (query ? "No match in the folders open in the tree." : this.loading && !this.entries.size ? "Loading files…"
            : this.root && (this.entries.get("")?.length ?? 0) > 0 ? `Only ${this.git ? "ignored" : "hidden"} files here. The eye above shows them.`
            : this.root ? (this.writes() ? "This folder is empty. + above, or a right-click here, makes a file." : "This folder is empty") : "No folder"))))
        .when(this.limited, (s) => s.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))), "root", t));
  }

  // The filter's flat list, one row per match (name, then its folder), the selected one in
  // t.selected, and a line under it saying how many and where.
  flatList(t, folder) {
    const f = this.found, q = this.filter.value().trim(), { rows, total } = this.flatRows();
    const sel = Math.min(this.flatSel ?? 0, Math.max(0, rows.length - 1));
    const line = foundLine({ busy: f.busy, listed: Boolean(f.paths), total, cut: f.cut, where: folder || "the folder",
      skipped: String(f.key).endsWith("|0|0"), max: FOUND_MAX, cap: LIST_CAP }); // |0|0: outside git, Show ignored off
    return v_flex().id("ws-files-found").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.treeScroll).px(6).pb(6)
      .children(rows.map((r, i) => {
        const id = `ws-files-found-${r.path}`, at = r.at, end = at + q.length;
        return this.withMenu(h_flex().id(id).h(24).flex_none().px(8).gap(6).items_center().rounded(6).cursor_pointer().text_size(12.5)
          .when(i === sel, (s) => s.bg(t.selected)).when(i !== sel, (s) => s.hover((x) => x.bg(t.hover)))
          .when(this.menu?.rowId === id, (s) => s.border_1().border_color(t.accent))
          .on_mouse_down("right", (e, cx) => this.openMenu(e, id, r, "tree", cx))
          .on_click((_e, cx) => this.openFound(r, cx))
          .when(this.menu?.rowId !== id, (x) => x.tooltip(r.path))
          .child(svg(`mods/ws-files/${iconOf(r.name, r.dir)}.svg`).size(14).flex_none().text_color(t.muted))
          // The name gives way last; the typed part in semibold.
          .child(h_flex().flex_shrink(1).min_w(0).overflow_hidden().whitespace_nowrap().text_color(t.foreground)
            .when(at > 0, (s) => s.child(div().flex_none().child(r.name.slice(0, at))))
            .child(div().flex_none().font_semibold().child(r.name.slice(at, end)))
            .when(end < r.name.length, (s) => s.child(div().min_w(0).truncate().child(r.name.slice(end)))))
          .when(Boolean(r.folder), (s) => s.child(div().flex_shrink(10).min_w(0).truncate().text_size(11.5).text_color(t.dim).child(r.folder))), id, t);
      }))
      .child(div().px(8).pt(6).text_size(11).text_color(t.dim).child(line));
  }

  // The tree's rows, with the edit row of a new file or folder at the top of the folder it goes in.
  withEditRow(t, rows) {
    const out = rows.map((r) => this.treeRow(t, r)), ed = this.edit;
    if (!ed || ed.mode === "rename") return out;
    const at = ed.dir ? rows.findIndex((r) => r.path === ed.dir) : -1;
    out.splice(at + 1, 0, this.editRow(t, at >= 0 ? rows[at].depth + 1 : 0));
    // Brought into view once, when its folder's row is there (a long folder, a scrolled tree).
    if (!ed.inView && (!ed.dir || at >= 0)) { ed.inView = true; this.treeScroll.scroll_to_item(at + 1); }
    return out;
  }

  treeRow(t, r) {
    if (this.edit?.mode === "rename" && this.edit.path === r.path) return this.editRow(t, r.depth);
    const abs = `${this.root}/${r.path}`, mark = r.dir ? null : this.marks[abs], open = this.file === r.path;
    const dim = this.showIgnored && this.hidden(r.path, { name: r.name }, true);
    const id = `file-${r.path}`, menu = this.menu?.rowId === id;
    // The keyboard's cursor (treeKey) has the hover's look while the tree has the keys.
    const cur = !open && this.cursor === r.path && this.treeHasKeys();
    return this.withMenu(h_flex().id(id).h(26).flex_none().pl(6 + r.depth * 14).pr(8).gap(6).items_center().rounded(6).cursor_pointer().text_size(12.5)
      .when(open, (s) => s.bg(t.selected)).when(cur, (s) => s.bg(t.hover)).hover((s) => s.bg(t.hover))
      .when(menu, (s) => s.border_1().border_color(t.accent))
      .when(dim, (s) => s.text_color(t.dim))
      .drag_paths([abs], { on: this.on ?? null })
      .on_mouse_down("right", (e, cx) => this.openMenu(e, id, r, "tree", cx))
      .on_click((_e, cx) => { this.cursor = r.path; this.handle.focus(); if (r.dir) this.toggle(r.path, cx); else this.pick(r.path, cx); })
      .child(r.dir ? svg(`mods/ws-files/chevron-${r.open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(svg(`mods/ws-files/${iconOf(r.name, r.dir)}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().id(`${id}-name`).flex_1().min_w(0).truncate().child(r.name).when(this.menu?.rowId !== id, (x) => x.tooltip(r.path)))
      .when(open && this.dirty, (s) => s.child(div().size(6).flex_none().rounded(3).bg(t.accent)))
      .when(Boolean(mark), (s) => s.child(div().flex_none().text_size(10.5).font_semibold().text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))), id, t);
  }

  searchView(t) {
    const s = this.search, q = s.query;
    const hl = (text, id) => {
      const lower = text.toLowerCase(), at = q ? lower.indexOf(q.toLowerCase()) : -1;
      if (at < 0) return div().flex_1().min_w(0).truncate().child(text);
      const from = Math.max(0, at - 24), pre = (from ? "…" : "") + text.slice(from, at);
      return h_flex().id(id).flex_1().min_w(0).overflow_hidden().whitespace_nowrap()
        .child(div().flex_none().child(pre))
        .child(div().flex_none().px(2).rounded(3).bg(t.selection).text_color(t.foreground).child(text.slice(at, at + q.length)))
        .child(div().flex_1().min_w(0).truncate().child(text.slice(at + q.length)));
    };
    const font = settings();
    return v_flex().flex_1().min_h(0)
      .child(div().p(8).flex_none()
        .child(h_flex().id("ws-files-search").h(28).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background).cursor_text()
          .on_key_down((e, cx) => {
            if (e.key === "escape" && this.menu) { this.closeMenu(); cx.stop_propagation(); cx.notify(); }
            else if (e.key === "escape" && this.finder.value()) { this.clearSearch(); cx.stop_propagation(); cx.notify(); }
          })
          // In the dialog Esc comes as overlay.close: with a query in the box, it empties the box first.
          .when(Boolean(props()?.file && this.finder.value()), (el) => el.on_action("overlay.close", (_e, cx) => { cx.stop_propagation(); this.clearSearch(); cx.notify(); }))
          .child(svg("mods/ws-files/search.svg").size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).child(Input.new(this.finder).text_size(12.5)))
          .when(s.count > 0, (x) => x.child(div().flex_none().text_size(11).text_color(t.dim).child(`${s.count}${s.truncated ? "+" : ""}`)))
          // The same × as the filter box's.
          .when(Boolean(this.finder.value()), (x) => x.child(div().id("ws-files-search-x").flex_none().size(20).mr(-4).flex().items_center().justify_center().cursor_pointer().text_color(t.dim).hover((y) => y.text_color(t.foreground))
            .on_click((_e, cx) => { this.clearSearch(); this.finder.focus(); cx.notify(); }).child(svg("mods/ws-files/x.svg").size(12))))))
      // Dimmed while a new search runs over the last one's results.
      .child(v_flex().id("ws-files-results").flex_1().min_h(0).overflow_y_scrollbar().px(6).pb(8)
        .when(s.busy && s.results.length > 0, (x) => x.opacity(0.5))
        .children(s.results.flatMap((g, gi) => [
          this.withMenu(h_flex().id(`ws-files-hit-${gi}`).h(24).mt(gi ? 6 : 0).px(6).gap(6).items_center().rounded(5).text_size(12).font_semibold()
            .cursor_pointer().hover((x) => x.bg(t.hover))
            .when(this.menu?.rowId === `ws-files-hit-${gi}`, (x) => x.border_1().border_color(t.accent))
            .on_mouse_down("right", (e, cx) => this.openMenu(e, `ws-files-hit-${gi}`, { path: g.path, dir: false }, "search", cx))
            // The file's row opens it at its first match, as that match's row does.
            .when(g.matches.length > 0, (x) => x.on_click((_e, cx) => { const m = g.matches[0]; this.jumped = `${g.path}:${m.line}`; this.expandTo(g.path, cx); this.pick(g.path, cx, { line: m.line, col: m.col }); }))
            .child(svg(`mods/ws-files/${iconOf(g.path, false)}.svg`).size(13).flex_none().text_color(t.muted))
            .child(div().flex_1().min_w(0).truncate().child(g.path))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(String(g.matches.length)))
            .when(this.menu?.rowId !== `ws-files-hit-${gi}`, (x) => x.tooltip(g.path)), `ws-files-hit-${gi}`, t),
          ...g.matches.map((m, mi) => this.withMenu(h_flex().id(`ws-files-hit-${gi}-${mi}`).h(22).pl(10).pr(6).gap(8).items_center().rounded(5).cursor_pointer()
            .font_family(font.font_family).text_size(11.5).text_color(t.muted).hover((x) => x.bg(t.hover))
            .when(this.file === g.path && this.jumped === `${g.path}:${m.line}`, (x) => x.bg(t.selected))
            .when(this.menu?.rowId === `ws-files-hit-${gi}-${mi}`, (x) => x.border_1().border_color(t.accent))
            .on_mouse_down("right", (e, cx) => this.openMenu(e, `ws-files-hit-${gi}-${mi}`, { path: g.path, dir: false }, "search", cx))
            .on_click((_e, cx) => { this.jumped = `${g.path}:${m.line}`; this.expandTo(g.path, cx); this.pick(g.path, cx, { line: m.line, col: m.col }); })
            .child(div().w(26).flex_none().text_right().text_color(t.dim).child(String(m.line)))
            .child(hl(m.text.trim(), `ws-files-hl-${gi}-${mi}`))
            .when(this.menu?.rowId !== `ws-files-hit-${gi}-${mi}`, (x) => x.tooltip(m.text.trim())), `ws-files-hit-${gi}-${mi}`, t)),
        ]))
        .when(s.truncated && s.results.length > 0, (x) => x.child(div().px(6).pt(8).text_size(11).text_color(t.dim).child(`Only the first ${s.count} matches are shown: narrow the search`)))
        .when(!s.results.length, (x) => x.child(div().p(8).text_size(12).text_color(t.dim)
          .child(s.busy ? "Searching…" : s.error ? s.error : q ? "No matches" : "Search the contents of this folder"))));
  }

  // The viewer's state: which screen it shows.
  state() {
    if (!this.file) return "empty";
    if (this.fileGone && !this.dirty) return "gone";
    if (this.loadingFile) return "loading";
    if (this.fileError) return "error";
    if (this.fk === "binary") return "binary";
    if (this.fk === "image") return "image";
    if (!this.code) return "loading";
    return "text";
  }

  header(t, st, narrow) {
    const p = props() ?? {}, { dir, base } = splitDirBase(this.file ?? "");
    const editable = Boolean(this.code) && this.snapshot !== null;
    const pk = this.file && st === "text" && !this.truncated ? previewKind(this.file) : null;
    const pill = (id, label, color, dot = false) => h_flex().id(id).flex_none().h(18).px(6).gap(4).items_center().rounded(4).text_size(11).bg(fade(color, 0.14)).text_color(color)
      .when(dot, (s) => s.child(div().size(6).rounded(3).bg(color))).child(label);
    // A strip under the header holds the one primary action (Reload, Retry, Save as new, Save & switch).
    const failed = this.conflict || Boolean(this.saveError) || (this.fileGone && this.dirty) || Boolean(this.pendingSwitch);
    const seg = (mode, label) => div().id(`ws-files-mode-${mode}`).h(22).px(8).flex().items_center().rounded(5).cursor_pointer().text_size(12)
      .text_color(this.mode === mode ? t.foreground : t.muted).when(this.mode === mode, (s) => s.bg(t.selected).font_medium()).hover((s) => s.text_color(t.foreground))
      .when(mode !== "split", (s) => s.tooltip(`${window()?.platform === "macos" ? "⌘⇧V" : "Ctrl+Shift+V"} switches Source and Preview`))
      .on_click((_e, cx) => this.setMode(mode, cx)).child(label);
    const copied = Boolean(this.copiedAt);
    // The clean bar's buttons slide in where Discard and Save were: they wait out calm() after a discard.
    const calmly = (fn) => (cx) => { if (!this.calm()) fn(cx); };
    const copy = this.iconButton(t, "ws-files-copy", copied ? "check" : "copy", copied ? "Copied" : `Copy path`, calmly((cx) => this.copyPath(cx)));
    const save = window()?.platform === "macos" ? "⌘S" : "Ctrl+S";
    const actions = [];
    if (this.pendingSwitch && this.discardArmed) this.discardArmed = 0; // a strip that asks takes Discard's question back
    if (this.pendingSwitch) { /* the strip under the bar holds the answers */ }
    else if (st === "gone" || st === "binary" || st === "error") actions.push(copy);
    else if (st === "loading" || st === "empty") { /* nothing yet */ }
    else if (failed) actions.push(this.discardButton(t));
    else if (this.dirty) actions.push(this.discardButton(t), this.textButton(t, "ws-files-save", this.saving ? "Saving…" : "Save", (cx) => cx.spawn(async (cx) => this.save(cx, { asNew: this.fileGone })), "solid", narrow ? null : save));
    else if (this.truncated || st === "image") {
      actions.push(copy);
      if (!narrow) actions.push(this.iconButton(t, "ws-files-refresh", "refresh", "Reload from disk", calmly((cx) => this.show(this.file, cx))));
      if (!this.on) actions.push(this.openIn(t, "ws-files-open", "solid", narrow));
    } else {
      actions.push(copy);
      if (!narrow) actions.push(this.iconButton(t, "ws-files-reveal", "reveal", "Reveal in tree", calmly((cx) => this.revealInTree(cx))), this.iconButton(t, "ws-files-refresh", "refresh", "Reload from disk", calmly((cx) => this.recheck(cx))));
      if (!this.on) actions.push(this.openIn(t, "ws-files-open", "outline", narrow));
    }
    const sized = !narrow && this.fileSize !== null && (st === "text" || st === "image");
    const held = this.dirty && this.context && this.key() !== this.context.key ? `Unsaved changes. Files stays in ${baseName(this.root ?? "") || this.root} until you save or discard them.` : "";
    const font = settings();
    return h_flex().h(38).flex_none().pl(narrow ? 6 : 12).pr(8).gap(8).items_center().border_b(1).border_color(t.border)
      .when(narrow && Boolean(this.file), (s) => s.child(this.iconButton(t, "ws-files-back", "arrow-left", "Back to the folder", (cx) => this.raiseTree(cx))))
      // Clipped: squeezed to nothing (a narrow pane, an edited Markdown file), it paints over nothing.
      .child(h_flex().flex_1().min_w(0).overflow_hidden().items_center().gap(8)
        .child(h_flex().id("ws-files-path").min_w(0).flex_shrink(1).font_family(font.font_family).text_size(12.5).tooltip(this.file ? `${this.root}/${this.file}` : "")
          // The folder gives way first, then the name (it never runs under the pill).
          .child(div().flex_shrink(10).min_w(0).truncate().text_color(t.dim).child(dir))
          .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).font_medium().child(base)))
        // Narrow, the pill is its dot (the tree's unsaved mark), its word in the tooltip.
        // While the draft holds the place (another folder is followed meanwhile), the tooltip says so.
        .when(this.dirty && !narrow, (s) => s.child(pill("ws-files-unsaved", "Unsaved", t.blocked, true).when(Boolean(held), (x) => x.tooltip(held))))
        .when(this.dirty && narrow, (s) => s.child(div().id("ws-files-unsaved").flex_none().size(8).rounded(4).bg(t.blocked).tooltip(held || "Unsaved changes")))
        .when(!this.dirty && st === "text" && (this.truncated || Boolean(this.on)), (s) => s.child(pill("ws-files-readonly", "Read-only", t.muted)
          .tooltip(this.truncated ? `Only the first ${formatSize(DISPLAY_LIMIT)} is shown, so it can't be saved.` : "Files on another machine open read-only."))))
      .when(Boolean(pk), (s) => s.child(h_flex().flex_none().p(2).gap(1).rounded(7).border_1().border_color(t.border)
        .child(seg("source", "Source")).child(seg("preview", "Preview")).when(!narrow, (x) => x.child(seg("split", "Split")))))
      .when(sized, (s) => s.child(div().flex_none().text_size(11.5).text_color(t.dim).child(formatSize(this.fileSize))))
      .children(actions)
      .when(Boolean(p.file) && !narrow, (s) => s.child(this.iconButton(t, "ws-files-x", "x", "Close", (cx) => this.closeDialog(cx))));
  }

  // The strips under the header: a failed save, a file deleted under a draft, a switch with unsaved
  // edits, a file cut short. One primary action each.
  banners(t, narrow) {
    const out = [];
    // Narrow (beside a terminal): the buttons go under the words.
    const strip = (id, icon, color, title, body, buttons) => {
      const words = h_flex().flex_1().min_w(0).gap(10).items_center()
        .child(svg(`mods/ws-files/${icon}.svg`).size(14).flex_none().text_color(color))
        .child(v_flex().flex_1().min_w(0).gap(1).child(div().text_size(12.5).font_medium().child(title)).when(Boolean(body), (s) => s.child(div().text_size(11.5).text_color(t.muted).child(body))));
      const box = narrow ? v_flex().gap(8).items_stretch() : h_flex().gap(10).items_center();
      return box.id(id).flex_none().px(12).py(8).border_b(1).border_color(t.border).bg(fade(color, 0.08))
        .child(words).child(h_flex().flex_none().gap(8).justify_end().children(buttons));
    };
    const name = baseName(this.file ?? "");
    if (this.pendingSwitch) {
      const closing = Boolean(this.pendingSwitch.closeDialog), how = closing ? "close" : this.pendingSwitch.close ? "go back" : "switch";
      out.push(strip("ws-files-switch", "warn", t.blocked, `Unsaved changes in ${name}`, closing ? "Press Esc again to close and drop what you typed." : null, [
        this.textButton(t, "ws-files-sw-cancel", "Cancel", (cx) => { if (!this.calm()) cx.spawn(async (cx) => this.settleSwitch("cancel", cx)); }),
        this.textButton(t, "ws-files-sw-discard", `Discard & ${how}`, (cx) => { if (!this.calm()) cx.spawn(async (cx) => this.settleSwitch("discard", cx)); }, "outline"),
        this.textButton(t, "ws-files-sw-save", `Save & ${how}`, (cx) => { if (!this.calm()) cx.spawn(async (cx) => this.settleSwitch("save", cx)); }, "solid"),
      ]));
    }
    // A recovery copy of a draft left unsaved (the file opened again after its view closed).
    if (this.recovery && !this.pendingSwitch) {
      const rec = this.recovery;
      out.push(strip("ws-files-draft", "warn", t.working, draftTitle(rec.at, Date.now()),
        `${rec.changed ? `${name} changed on disk since. Restore still puts your draft in the editor, unsaved.` : "Restore puts it in the editor, unsaved, so you can look before you save."} Editing waits until you choose.`, [
        this.textButton(t, "ws-files-draft-discard", "Discard", (cx) => this.discardDraft(cx)),
        this.textButton(t, "ws-files-draft-restore", "Restore", (cx) => this.restoreDraft(cx), "solid"),
      ]));
    }
    if (this.fileGone && this.dirty) {
      out.push(strip("ws-files-gone-draft", "warn", t.blocked, "This file was deleted on disk. Your draft is still here.", null, [
        this.textButton(t, "ws-files-save-new", "Save as new", (cx) => { if (!this.calm()) cx.spawn(async (cx) => this.save(cx, { asNew: true })); }, "solid"),
      ]));
    } else if (this.conflict) {
      out.push(strip("ws-files-conflict", "warn", t.blocked, "File changed on disk while you were editing.", "Your unsaved changes are still in the editor below.", [
        // Notes' pair, neither the primary: the strip is the question, each answer says what goes.
        this.textButton(t, "ws-files-overwrite", "Keep mine", (cx) => { if (!this.calm()) cx.spawn(async (cx) => this.save(cx, { force: true })); }, "outline", null, "Write what you typed over the file"),
        this.textButton(t, "ws-files-reload", "Take theirs", (cx) => { if (!this.calm()) this.reload(cx); }, "outline", null, "Show the file as it is now; what you typed goes"),
      ]));
    } else if (this.saveError) {
      out.push(strip("ws-files-save-error", "warn", t.ansi1, `Couldn't save ${name}.`, `${this.saveError} Your changes are still in the editor.`, [
        this.textButton(t, "ws-files-retry", "Retry save", (cx) => { if (!this.calm()) cx.spawn(async (cx) => this.save(cx)); }, "solid"),
      ]));
    }
    if (this.truncated && this.code) {
      out.push(h_flex().flex_none().h(30).px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12).text_color(t.muted)
        .child(svg("mods/ws-files/info.svg").size(13).flex_none())
        .child(div().flex_1().min_w(0).truncate().child(`Only the first ${formatSize(DISPLAY_LIMIT)} is shown, so it can't be saved.`)));
    }
    return out;
  }

  // A centered screen (empty, binary, gone, failed read).
  centered(t, icon, title, body, buttons = []) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).p(24)
      .child(div().size(38).rounded(9).border_1().border_color(t.border).bg(t.surface).flex().items_center().justify_center().child(svg(`mods/ws-files/${icon}.svg`).size(16).text_color(t.muted)))
      .child(div().text_size(14).font_semibold().child(title))
      .child(div().max_w(420).text_size(12.5).text_color(t.muted).text_center().child(body))
      .when(buttons.length > 0, (s) => s.child(h_flex().mt(4).gap(8).children(buttons)));
  }

  editorEl() {
    const font = settings();
    return Editor.new(this.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0).size_full();
  }

  mdPreview(t, wide) {
    return v_flex().id("ws-files-md").flex_1().min_h(0).size_full().overflow_y_scrollbar()
      .child(h_flex().w_full().justify_center()
        .child(div().w_full().when(wide, (s) => s.max_w(720)).px(24).py(18).text_size(14)
          .child(TextView.markdown(`ws-files-md-${this.mdSeq}`, this.mdText).selectable(true).scrollable(false)
            .on_link_click((url, cx) => this.linkClicked(url, cx)))));
  }

  // An image fitted to the room it has (its own size when known, never larger).
  imageEl(t, roomW, roomH, caption = true) {
    const img = this.img;
    if (!img) {
      return this.centered(t, "image", this.on ? "Image on another machine" : (this.fileSize ?? 0) > IMAGE_LIMIT ? "Image too large to preview" : this.imgError ? "Can't preview this image" : "Loading image…",
        this.on ? "Herdr previews images on this computer only." : (this.fileSize ?? 0) > IMAGE_LIMIT ? `${formatSize(this.fileSize)}: previews stop at ${formatSize(IMAGE_LIMIT)}.` : this.imgError ?? "");
    }
    const { w, h } = fitImage(img.w, img.h, Math.max(80, roomW - 64), Math.max(80, roomH - (caption ? 80 : 40)));
    return v_flex().flex_1().min_h(0).size_full().overflow_hidden().items_center().justify_center().gap(10).p(16)
      .child(div().rounded(8).border_1().border_color(t.border).bg(t.surface).p(8)
        .child(div().id(`ws-files-img-${this.imgGen ?? 0}`).child(image(img.asset).w(w).h(h))))
      .when(caption && Boolean(img.w), (s) => s.child(div().text_size(11.5).text_color(t.dim).child(`${img.fmt} · ${img.w} × ${img.h}`)));
  }

  viewerBody(t, st, narrow, room) {
    if (st === "empty") return this.centered(t, "folder", "Select a file", platformWords("Pick any file on the left to read, preview, or edit it, or Cmd-click a path in a terminal. Drag a file onto a terminal to paste its path.", window()?.platform ?? "macos"));
    if (st === "loading") {
      return v_flex().flex_1().min_h(0).p(16).gap(10).children([0.7, 0.5, 0.85, 0.4, 0.6, 0.75].map((f, i) =>
        div().h(10).w(Math.round(f * Math.min(560, room.w - 40))).rounded(4).bg(t.raised).loop("opacity", { from: 0.4, to: 1, period: 1200 + i * 60 })));
    }
    if (st === "gone") {
      return this.centered(t, "warn", "This file is no longer on disk", `${this.file} was moved or deleted outside Herdr.`, [
        this.textButton(t, "ws-files-gone-back", "Back to folder", (cx) => this.closeFile(cx), "solid"),
        this.textButton(t, "ws-files-gone-refresh", "Refresh tree", (cx) => this.refresh(cx), "outline"),
      ]);
    }
    if (st === "error") return this.centered(t, "warn", "Can't open this file", this.fileError);
    if (st === "binary") {
      const size = this.fileSize !== null ? ` · ${formatSize(this.fileSize)}` : "";
      return this.centered(t, "file", "Binary file", `${typeName(this.file)}${size}. Herdr can't preview this format directly.`, this.on ? [] : [this.openIn(t, "ws-files-open-bin", "outline", false)]);
    }
    if (st === "image") return this.imageEl(t, room.w, room.h);
    // Text: the editor, or Preview / Split for Markdown and SVG.
    const pk = previewKind(this.file);
    const mode = pk && !this.truncated ? (narrow && this.mode === "split" ? "preview" : this.mode ?? "preview") : "source";
    const preview = (wide, w) => (pk === "svg" ? this.imageEl(t, w, room.h, false) : this.mdPreview(t, wide));
    if (mode === "preview") return preview(true, room.w);
    if (mode === "split") {
      return h_resizable("ws-files-split").flex_1().min_h(0).size_full()
        .child(resizable_panel().size(Math.round(room.w / 2)).size_range(200).child(div().size_full().border_r(1).border_color(t.border).child(this.editorEl())))
        .child(resizable_panel().size_range(200).child(preview(false, room.w / 2)));
    }
    return this.editorEl();
  }

  viewer(t, narrow, room) {
    const st = this.state();
    return v_flex().size_full().min_h(0).min_w(0).bg(t.background)
      .child(this.header(t, st, narrow))
      .children(this.file ? this.banners(t, narrow) : [])
      .child(this.viewerBody(t, st, narrow, room));
  }

  render(cx) {
    if (props()?.trash) return this.trashView(cx);
    this.place(); // a focus change is remembered at once
    const t = theme(), p = props() ?? {};
    // A card of its own only where nothing frames it (Herdr's panel); a pane's frame, the view's area or the dialog is the card.
    const card = !p.screen && !p.beside && !p.file;
    const width = this.size?.width ?? 0, height = this.size?.height ?? 600;
    const narrow = width > 0 ? width < NARROW : Boolean(p.beside);
    this.narrowNow = narrow; // the tree's keys (treeHasKeys) need it; not state that redraws
    if (!narrow) this.railUp = false; // wide, the tree and the file are side by side
    // The room the viewer has, in the units sizes are given in (the measured size is zoomed; .w() isn't yet).
    const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
    const railW = this.railW ?? RAIL;
    const room = { w: Math.max(200, (narrow ? width : width - railW * zoom) / zoom), h: Math.max(160, height / zoom - 38) };
    const body = narrow
      // The raised tree gives way while a strip asks (its question lives in the viewer).
      ? (this.file && (!this.railUp || this.pendingSwitch) ? this.viewer(t, true, room) : this.railView(t, true))
      : h_resizable("ws-files-main").size_full().on_resize((sizes, cx) => { this.railW = sizes[0]; cx.notify(); })
        .child(resizable_panel().size(RAIL).size_range(180, 420).child(this.railView(t, false)))
        .child(resizable_panel().child(this.viewer(t, false, room)));
    return v_flex().id("files").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_size_change((size, cx) => {
        if (size.width === this.size?.width && size.height === this.size?.height) return;
        this.size = { width: size.width, height: size.height };
        cx.notify();
      })
      .on_key_down((e, cx) => this.keyDown(e, cx))
      // As a dialog: Esc and Cmd/Ctrl+W come as Herdr's actions (dialogClose()); a pane or the
      // full-size view leaves them to Herdr (Cmd+W there closes the tab).
      .when(Boolean(p.file), (el) => {
        const onClose = (_e, cx) => { cx.stop_propagation(); this.dialogClose(cx); };
        return el.on_action("overlay.close", onClose).on_action("tab.close", onClose).on_action("pane.close", onClose);
      })
      .when(card, el => el.rounded(10).border_1().border_color(t.border))
      .child(body);
  }
}
