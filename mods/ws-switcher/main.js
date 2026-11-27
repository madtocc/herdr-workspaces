// Workspaces: named groups of spaces, each a folder of repos. A workspace is
// ~/.herdr/workspaces/<id>/workspace.jsonc (name, color, root, folders) plus the
// AGENTS.md its agents are told (bin/herdr-ws-agent adds it on launch).
// This block sits above the spaces list and shows the chosen workspace; a click
// opens the menu to switch. `ws-spaces` and `ws-agents` show only that workspace's
// spaces and agents. While the shown workspace has no spaces, it shows the layout's
// empty block (another copy of this mod, props.empty) in place of the work column,
// which would otherwise show some other workspace's space (coverWork()).
//
// Files it writes: ~/.herdr/workspaces/.index (the workspaces' folders, for
// bin/herdr-ws-agent) and, from "New workspace from a folder…", a new workspace's
// two files. It runs your editor (or the system's opener) from "Edit".
//
// Shared state, read by ws-spaces and ws-agents too:
//   workspaces.defs      the parsed configs
//   workspaces.active    the chosen workspace's id, null for every space
//   workspaces.assigned  space id -> workspace id (false: kept out of all of them)
//   workspaces.last      workspace id -> the space last shown in it
//   workspaces.create    a time: the menu asks this block to make a workspace
//   workspaces.scratch   { at, name? }: the New scratch space dialog asks this block for a scratch space (scratch.js)
//   workspaces.scratch.folders  the Scratch workspace's folders, newest first, for the menu and ws-spaces
//   workspaces.scratch.state    folder -> { kept } | { trashAt } | { empty } | { used }: what each waits for, so its row
//                        in the menu says "kept" or "5 days left" (scratch.js scratchWhen())
//   workspaces.scratch.keep     { <folder name>: { keep, at } }: a scratch folder row's Keep or Don't keep, asked of
//                        this block by the menu popup (works with the sidebar hidden after start, where a mod
//                        command is refused); each name's newest ask is done once (requests())
//   workspaces.switcher.menu    { overlay, at } or { overlay: null, closedAt }: the switcher menu (a popup of this
//                        mod) is open, so the block's click closes it and its tooltip isn't drawn over it
//   workspaces.switcher.alive   { at }: this sidebar copy is running (refreshed every 5 s). A screen that asks it to do
//                        something treats it as away when the key is missing or older than 15 s, and says so
//   workspaces.board, workspaces.worktrees, workspaces.notes  { id, at }: ask this block to show that workspace's
//                        Board, Worktrees or Notes full size (nothing in the package sets them now; kept for scripts)
//   workspaces.history   { id, at }: the same for History; with no id, History for All spaces
// Not this block's: ws-history's own, between its copies (its right-click menu and Wipe dialog are copies of their own).
//   workspaces.history.act    { from, key, action, terminal, at }: the menu asks the History it was opened from to resume or go to a row
//   workspaces.history.wiped  { keys, at }: what History's Wipe took; every History reads again
//   workspaces.board.start  { owner, file, worktree, over, at }: ws-board's Start with… dialog asks the board
//                        copy that opened it (owner) to start a card with another agent, folder or first message
//   Views (ws-tabs' Views menu): Changes and Files belong to a space, Board, Notes, Worktrees and History
//   to a workspace. Each opens full size (the layout's block `screen-<view>`, in place of the terminals,
//   with a pill in the tab bar) or beside the shown tab's terminals as a pane.
//   workspaces.screens   workspace id -> its views open full size ("board", "worktrees", "history", "notes"), in
//                        the order opened: the pills ws-tabs draws before the tabs of every space of it ("*": All
//                        spaces, where History opens)
//   workspaces.screens.space  space id -> its views open full size ("changes", "files"): pills in that space only
//   workspaces.screen    { ws, space?, screen, at } or null: the view shown in place of the tabs (space: a space's
//                        view's space). Anyone sets it (ws-tabs' pills; null from ws-spaces and ws-agents when a
//                        space or agent is clicked); this block shows it (coverWork())
//   workspaces.covered   true while the shown space isn't the shown workspace's (it has none)
//   workspaces.view      [{ id, key, beside, toggle, move, at }]: the tab bar (its Views menu, keys, Beside button, a
//                        pill's right-click) asks this block to open a view in the shown space and workspace (openView();
//                        a short list, each id done once: beside.js drainAsks, ws-tabs' views.js pushAsk):
//                        full size (toggle: back to the terminals when it's the one shown) or beside (move: its pill
//                        closes; it does too when it's the one shown)
//   workspaces.follow    tab id -> pane id: the terminal Changes and Files opened as panes in that tab follow
//                        (ws-changes and ws-files write it)
//   workspaces.files.open    [{ id, path, isDir, line?, col?, on?, space?, tab?, placement, at }]: a file or folder to
//                        open in Files (ws-files' link.js on a Cmd-click in a terminal, Changes' Open in Files,
//                        Settings' Herdr guide; a list like workspaces.view, each id done once: openFiles()).
//                        Beside the terminal in its tab (that tab's Files pane if it has one), full size on
//                        another machine's space, in a dialog when there's no space to open it in
//   workspaces.files.target  { id, scope: "screen" | "tab" | "pane", space?, tab?, pane?, path, isDir, line, col, on, at }:
//                        which Files copy opens it (ws-files takes it, marking it taken); one at a time
//   workspaces.files.prefs   { byExt, last }: Files' Open with… memory (~/.herdr/files-prefs.json), so every copy follows a pick
//   workspaces.beside.panes  pane id -> { ws, screen }: the views this block opened as panes (nothing else tells them
//                        from a pane split in by hand; beside.js). Closed when the view's add-on is turned off;
//                        an entry goes once its pane has been gone a while (followBeside())
//   workspaces.order     { order, folded, scratchFolded }: the menu's order and folded groups (arrange.js, ~/.herdr/workspaces/.order.json)
//   workspaces.arrange   { order?, folded?, scratchFolded?, groups?: { id: group or null }, at }: the menu asks this block to
//                        save a drag, a fold or a workspace's group (applyArrange())
//
//   workspaces.prs       task file -> its pull request's one status (prs.js), drawn by ws-board
//   workspaces.github    task file -> its GitHub board item's status (ghboard.js), drawn by ws-board
//
// The tab bar's bell (ws-notifications' list; notiflog.js keeps its log in ~/.herdr/notifications.json):
//   workspaces.notifications.store  { read, dismissed, events, live }: the log as this block keeps it, and
//                        when each live item was first listed (notif.js has the rules; the list reads it)
//   workspaces.notifications.badge  { count, tone, needs, unread, height }: the bell's count (ws-tabs) and its
//                        list's height
//   workspaces.notifications.act    [{ id, action, item?, items?, target?, group?, at }]: the list asks this block
//                        to open an item's thing (openNotification()), dismiss, mark all read or clear read
//   workspaces.notifications.push   [{ id, title, body, level, action, at }]: every toast ws-toast showed, for the
//                        log (notif.js classifyToast keeps the few worth it)
//   workspaces.notifications.open   { overlay, at } or { overlay: null, closedAt }: the list is open (ws-notifications
//                        says so), so the bell and its key close it
//   workspaces.history.open  { ws, runId, at, taken? }: a notification asks History to show that run (ws-history)
//   workspaces.board.open    { ws, taskId, at, taken? }: a notification asks the board to open that card (ws-board)
//
//   workspaces.usage     { <plan>: { rows, at, from, tried } }: each plan's usage, read by ws-status's bar for its panel
//   workspaces.usage.ask { at }: ws-status's panel asks the bar to read the usage again
//
// It also runs each workspace's automations (automations.js) and follows board cards'
// pull requests (prs.js) and GitHub board items (ghboard.js): the one runner of each lives in this sidebar
// copy and ticks on its timer. Unless the background runner is on
// (bin/herdr-ws-runner, ~/.herdr/runner/switch): then a process herdr-core holds
// runs both, Herdr open or closed, and this copy only passes things between it and
// the window (background()): it starts it when it isn't running, copies what it
// publishes (~/.herdr/runner/state.json) into shared state, shows its notes as
// toasts, names the tabs and spaces of the runs it started, and hands it the
// screen's Run now (with its text) and allowed checks and scripts as files in the inbox.
//   workspaces.runner      { on, running, via, pid, login, plist }: the background runner, for the
//                        screens: via "launchd" or "systemd" (started at login) or "hc" (a terminal herdr-core
//                        holds), login: it starts at login (its LaunchAgent or systemd unit file, plist, is there)
//   workspaces.runner.set  { on?, login?, at }: a screen asks to turn it, or Start at login, on or off
// Not this block's: the package's own settings, ~/.herdr/settings.jsonc, as ws-agents
// reads it (and our Settings window, ws-settings, sets it when you change one; settingsfacts.js).
//   workspaces.settings    { experimental: { <key>: true|false }, features: { <key>: true|false } }
//                        Settings > Features: an add-on that's off is hidden here and does nothing.
//                        Board, Notes, Worktrees, History off: no button, no menu row, and nothing
//                        opens it (the commands, the asks above, a Board tab taken in); shown now,
//                        the tabs come back. workspaces.screens keeps its pin for when it's on again.
//                        Board off also stops prs.js and ghboard.js; Automations off, the runs
//                        (automations.js), and the toasts' ways into the Automations screen. The
//                        runners here read the file first (featuregate.js) and follow this for flips.
//   workspaces.settings.section  { id, at } or null: the section our Settings window (ws-settings) opens on,
//                        for a moment after "ws-switcher.settings/<section>" asks (mod.open passes no props); the
//                        window clears it as it opens
// This block writes ws-settings' main.js: Herdr's Settings window with Features, Agents and Experimental
// sections (settingsbuild.js), rebuilt when Herdr's own file changes (settingsCopy()).
//
// A space joins a workspace once and stays: when its first terminal is under the
// workspace's root or one of its folders (a herdr worktree goes by its repo's
// name), or when it's made while that workspace is shown.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { spaces, panes, machines, run, theme, shared, setShared, props, openOverlay, closeOverlay, home, appHome, layout, watchFolder, readTextFile, writeTextFile, pickFolder, notify, window, nextCommand, focused, updates, checking } from "herdr";
import { exec } from "./posix.js";
import * as fs from "fs/promises";
import { Runner, runnerDir, globalDir } from "./automations.js";
import { PrWatcher } from "./prs.js";
import { GhWatcher } from "./ghboard.js";
import { Scratch, isScratch, scratchDef, scratchLabel, scratchWhen, scratchDeleteButton, scratchRoot, keepPending, commandFailTitle } from "./scratch.js";
import { dir, expand, tilde, under, base, subdirs, parseJsonc, loadDefs, loadOrder, orderFile, templatesDir, loadPresetDir, presetsFor, presetLaunch, withTask, notesOnly } from "./defs.js";
import { arrange, move as moveRow, groupOf, groupName, renamed, withGroup, orderText } from "./arrange.js";
import { buildSettings, hash, SOURCE as SETTINGS_SOURCE, TARGET as SETTINGS_TARGET } from "./settingsbuild.js";
import { SETTINGS_FILE, parseSettings, automationSetting } from "./settingsfacts.js";
import { openIn, splitAt, follow as followLedger, wantsClose, trusted, drainAsks } from "./beside.js";
import { Features, flips, FOLLOWED } from "./featuregate.js";
import { NotifLog } from "./notiflog.js";
// The system's trash by its name: the Recycle Bin on Windows, the Trash elsewhere.
const trashName = () => (window()?.platform === "windows" ? "Recycle Bin" : "Trash");

// "Edit" opens the workspace's folder in the first of these that's installed,
// else with the system's opener (Finder, the file manager, Explorer).
const EDITORS = ["zed", "cursor", "code", "subl"];
const SETTLE = 1500; // ms a new space's first terminal takes to report its folder
// The views: a workspace's (Board, Worktrees, History, Notes) and a space's (Changes, Files: space).
// The layout holds each once, as the block `screen-<key>` in the `screens` column of `center`.
// (ws-tabs' views.js has the same six for the tab bar and its menu.)
const SCREENS = {
  board: { mod: "ws-board", name: "Board" }, worktrees: { mod: "ws-worktrees", name: "Worktrees" },
  history: { mod: "ws-history", name: "History" }, notes: { mod: "ws-notes", name: "Notes" },
  changes: { mod: "ws-changes", name: "Changes", space: true }, files: { mod: "ws-files", name: "Files", space: true },
};
// The pills of All spaces (History, with no workspace chosen) in "workspaces.screens" (views.js: ALL).
const ALL = "*";
// A view by its key, or null: only SCREENS' own keys ("constructor" in a command's text isn't one).
const screenOf = (key) => (typeof key === "string" && Object.hasOwn(SCREENS, key) ? SCREENS[key] : null);
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
// The spaces list's avatar colors, so a workspace mark matches.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const URGENT = { blocked: 2, done: 1 };
const SWITCHER_MENU = "workspaces.switcher.menu";
// Settings > Features, for what's drawn and opened (the runners go by this.features).
const featureOn = (key) => shared("workspaces.settings")?.features?.[key] !== false;
// The views opened as panes (beside.js).
const LEDGER = "workspaces.beside.panes";


function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// The sidebar's rail goes by its width, as in the other sidebar mods.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;


// A folder of the workspace and, when a symlink leads there, where it really is.
function realOf(def, path) {
  if (def.real?.[path]) return def.real[path];
  const root = def.real?.[def.root];
  return root && path.startsWith(def.root + "/") ? root + path.slice(def.root.length) : null;
}
const inFolder = (def, at, folder) => under(at, folder) || under(at, realOf(def, folder));

// What bin/herdr-ws-agent reads (a shell script can't read JSONC): one line per
// fact, tab-separated. ws: id, root, instructions file. dir: id, a root or folder.
// repo: id, a repo name a herdr worktree can be named after.
function indexText(defs) {
  const ok = (s) => !/[\t\n]/.test(s);
  const lines = ["# Written by the ws-switcher mod for herdr-ws-agent. Don't edit: it's rewritten."];
  for (const d of defs) {
    if (d.error || !d.root || !ok(d.root) || !ok(d.instructions)) continue;
    lines.push(["ws", d.id, d.root, d.instructions].join("\t"));
    for (const f of [d.root, ...d.folders]) if (ok(f)) lines.push(["dir", d.id, f].join("\t"));
    for (const r of new Set([...d.children, ...d.folders.map(base)])) if (ok(r)) lines.push(["repo", d.id, r].join("\t"));
  }
  return lines.join("\n") + "\n";
}


// Starts a preset as a tab named after it in the shown space (its focused
// terminal's folder), else as a new space in the workspace's root. `prompt`:
// the task for its first message, if any.
function startPreset(preset, active, prompt = "") {
  const shown = spaces().find((s) => s.active);
  const launch = presetLaunch(preset, prompt);
  const { argv, task } = withTask(launch.argv, launch.task);
  if (shown) run("tab.new", { space: shown.id, name: preset.name, argv, ...(task ? { task } : {}) });
  else run("space.new", { ...(active?.root ? { folder: active.root } : {}), tab: preset.name, argv, ...(task ? { task } : {}) });
}

// Opens a folder in the first installed editor of EDITORS, else the system's opener.
function openFolder(path) {
  if (window()?.platform === "windows") return exec("explorer", [path]).catch(() => {});
  const editors = EDITORS.map((e) => `command -v ${e} >/dev/null 2>&1 && exec ${e} "$1";`).join(" ");
  return exec("sh", ["-c", `${editors} command -v open >/dev/null 2>&1 && exec open "$1"; exec xdg-open "$1"`, "sh", path]).catch(() => {});
}

// workspace.jsonc with its top-level "name" set, comments and all kept as written.
function withName(text, name) {
  const value = JSON.stringify(name);
  let depth = 0, key = null, colon = false, open = -1;
  for (let i = 0; i < text.length;) {
    if (text.startsWith("//", i)) { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e; continue; }
    if (text.startsWith("/*", i)) { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 2; continue; }
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (depth === 1 && colon && key === "name") return text.slice(0, i) + value + text.slice(j + 1);
      if (depth === 1 && !colon) key = JSON.parse(text.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") { if (depth === 0 && open < 0) open = i; depth++; }
    else if (c === "}" || c === "]") depth--;
    else if (c === ":" && depth === 1) colon = true;
    else if (c === "," && depth === 1) { colon = false; key = null; }
    i++;
  }
  if (open < 0) throw new Error("workspace.jsonc has no { }");
  return `${text.slice(0, open + 1)}\n  "name": ${value},${text.slice(open + 1)}`;
}

// Moves a folder to the Trash ($1), or to $2/$3 where there's no Trash command.
// Prints where it went.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/$3" && echo "$2/$3"`;

// The delete dialog's words for the Scratch workspace: its folders and spaces go too.
function scratchDeleteText(d) {
  const folders = (shared("workspaces.scratch.folders") ?? []).length;
  const open = spaces().filter((s) => (shared("workspaces.assigned") ?? {})[s.id] === d.id).length;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return `Moves ${tilde(d.dir)} and ${tilde(d.root)} (${n(folders, "scratch folder", "scratch folders")}, kept ones too) to the ${trashName()}`
    + (open ? `, and closes its ${n(open, "space", "spaces")}, ending what runs there.` : ".")
    + " Scratch comes back, empty, the next time you make a scratch space.";
}

// Where a space is now: its first terminal's live folder, else where it was made.
function placeOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}

// The workspace a folder belongs to: the most specific root or folder holding it.
function match(path, defs) {
  let best = null, length = -1;
  for (const d of defs) for (const f of [d.root, ...d.folders]) {
    if (inFolder(d, path, f) && f.length > length) { best = d; length = f.length; }
  }
  if (best) return best.id;
  const trees = `${home()}/.herdr/worktrees/`;
  if (!path.startsWith(trees)) return null;
  const repo = path.slice(trees.length).split("/")[0];
  return defs.find((d) => d.children.includes(repo) || d.folders.some((f) => base(f) === repo))?.id ?? null;
}

function urgent(list) {
  let best = null;
  for (const s of list) if ((URGENT[s.status] ?? 0) > (URGENT[best] ?? 0)) best = s.status;
  return best;
}

// The switcher's sidebar copy isn't running (its alive key missing or older than 15 s): an ask would wait unseen.
const switcherAway = () => { const a = shared("workspaces.switcher.alive"); return !a || !(Date.now() - Number(a.at) <= 15000); };

// New scratch space, wherever it's asked for (the menu, the Spaces +, the empty work
// area, the command): the New space dialog in its Scratch form, which asks for the name.
// ws-spaces and ws-tabs open the same one; keep the sizes alike. Each dialog here is opened with room
// for its error line (or the Esc note), and keeps its buttons at the bottom.
const askScratch = () => openOverlay({ mod: "ws-switcher", kind: "dialog", modal: true, width: 460, height: 260,
  props: { dialog: "new-space", id: scratchDef(shared("workspaces.defs"))?.id ?? null, scratch: true } });

function mark(def, defs, t, size) {
  if (!def) {
    return h_flex().size(size).flex_none().rounded(5).border_1().border_color(t.input).items_center().justify_center()
      .text_color(t.muted).child(svg("mods/workspace-chrome/layers.svg").size(Math.round(size * 0.6)));
  }
  const c = def.color ?? PALETTE[Math.max(0, defs.findIndex((d) => d.id === def.id)) % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
  return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(Math.round(size * 0.55)).font_bold().text_color("#ffffff").child([...def.name][0]?.toUpperCase() ?? "?");
}

// Show a workspace, and the space last shown in it (else its first).
function choose(id) {
  setShared("workspaces.active", id);
  if (!id) return;
  const assigned = shared("workspaces.assigned") ?? {};
  const mine = spaces().filter((s) => assigned[s.id] === id);
  if (!mine.length || mine.some((s) => s.active)) return;
  const last = (shared("workspaces.last") ?? {})[id];
  run("space.select", { id: (mine.find((s) => s.id === last) ?? mine[0]).id });
}

function configText(name, color, root, folders) {
  return `// A Herdr workspace. The switcher above the spaces list reads this file;
// edits apply at once. Comments and trailing commas are fine.
{
  // Shown in the switcher.
  "name": ${JSON.stringify(name)},
  // Its mark: ansi1..ansi6 (theme colors) or "#rrggbb".
  "color": ${JSON.stringify(color)},
  // The folder the work lives in. A space whose terminal is under it joins
  // this workspace, and so does a space made while this workspace is shown.
  "root": ${JSON.stringify(root)},
  // The repos and folders used here: relative to root, or absolute (~ works)
  // for one that lives elsewhere. The switcher lists them to open as spaces.
  "folders": [
${folders.map((f) => `    ${JSON.stringify(f)},`).join("\n")}
  ],
  // What every agent started here is told (Claude, Codex, Antigravity, Pi), on top of each
  // repo's own CLAUDE.md / AGENTS.md. Default: AGENTS.md next to this file.
  // "instructions": "AGENTS.md",
  // The task board (ws-board). All optional; these are the defaults.
  // "board": { "columns": ["backlog", "todo", "doing", "review", "done"],
  //            "agent": "claude", "start": "doing", "finish": "review" },
}
`;
}

// Our Settings window (ws-settings: Herdr's, with Features, Agents and Experimental), as a dialog 880 wide
// (its mod.json), which mod.open toggles. Asking for a section opens it there: mod.open passes
// no props, so the section goes through shared state and the window clears it as it opens.
// Still there a moment later: the window was open and mod.open closed it, so open it again.
function openSettings(section, cx) {
  if (section) {
    const at = Date.now();
    setShared("workspaces.settings.section", { id: section, at });
    cx.timer.after(400, () => { if (shared("workspaces.settings.section")?.at === at) run("mod.open", { name: "ws-settings" }); });
  }
  run("mod.open", { name: "ws-settings" });
}

const instructionsText = (name) => `<!-- What every agent (Claude, Codex, Antigravity, Pi) started in the ${name} workspace is told,
     on top of each repo's own CLAUDE.md / AGENTS.md. Write below this comment;
     the comment itself is not sent. Applies to agents started after you save. -->
`;

export default class Workspaces extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // The layout's empty block (beside the work column in the `center` stack): it only draws.
    if (props()?.empty) return;
    if (props()?.popup) {
      this.handle.focus();
      if (!checking()) setShared(SWITCHER_MENU, { overlay: props()?.overlay ?? null, at: Date.now() });
      // The group submenus' boxes: a new group's name, and a group's new name.
      this.newGroupIn = InputState.new({ value: "", placeholder: "New group…" });
      this.renameIn = InputState.new({ value: "" });
      this.newGroupIn.on("submit", (_e, cx) => this.groupTyped(this.newGroupIn.value(), cx));
      this.renameIn.on("submit", (_e, cx) => this.groupTyped(this.renameIn.value(), cx));
      return;
    }
    if (props()?.dialog) {
      this.handle.focus();
      if (props().dialog === "new-space") this.initNewSpace(cx);
      if (props().dialog === "rename") {
        this.text = (shared("workspaces.defs") ?? []).find((d) => d.id === props().id)?.name ?? "";
        this.typedFrom = this.text; // what Esc compares with: a changed name asks once before it goes
        this.input = InputState.new({ value: this.text });
        this.input.set_selected_range({ start: 0, end: this.text.length });
        this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = null; this.escAsked = false; cx.notify(); });
        this.input.on("submit", (_e, cx) => this.rename(cx));
        this.input.focus();
        cx.timer.after(600, () => this.input.focus());
      }
      return;
    }
    this.startedAt = Date.now(); // an open mark older than this copy is from before a restart
    this.known = new Set(spaces().map((s) => s.id)); // decided: no "made while shown" fallback
    this.born = {};
    this.shown = spaces().find((s) => s.active)?.id ?? null;
    this.loaded = false;
    this.asked = shared("workspaces.create") ?? null;
    this.launchAsked = shared("workspaces.launch")?.at;
    this.boardAsked = shared("workspaces.board")?.at;
    this.treesAsked = shared("workspaces.worktrees")?.at;
    this.historyAsked = shared("workspaces.history")?.at;
    this.notesAsked = shared("workspaces.notes")?.at;
    // The tab bar's asks already there at start were for an earlier run: none is done again.
    this.viewSeen = drainAsks(shared("workspaces.view"), [], Date.now()).seen;
    { const q = shared("workspaces.view"); this.viewLast = Array.isArray(q) && q.length ? q[q.length - 1]?.id : null; }
    // The same for the files asked for (workspaces.files.open).
    this.filesSeen = drainAsks(shared("workspaces.files.open"), [], Date.now()).seen;
    { const q = shared("workspaces.files.open"); this.filesLast = Array.isArray(q) && q.length ? q[q.length - 1]?.id : null; }
    this.runAsked = shared("workspaces.automation.run")?.at;
    this.scratchAsked = shared("workspaces.scratch")?.at;
    // The rows' Keep asks already there at start were for an earlier run: none is done again.
    this.keepSeen = Object.fromEntries(Object.entries(shared("workspaces.scratch.keep") ?? {}).map(([k, v]) => [k, v?.at]));
    this.allowAsked = shared("workspaces.automation.allow")?.at;
    this.setAsked = shared("workspaces.runner.set")?.at;
    this.arrangeAsked = shared("workspaces.arrange")?.at;
    // A space the runner makes for its runs joins that workspace at once.
    // Settings > Features for the runners here: the file's answer before their first tick,
    // then shared state's flips (followFeatures()).
    this.features = new Features();
    this.hooks = {
      presetsFor, presetLaunch, withTask,
      featureOn: (key) => this.features.on(key),
      // Settings > Automations: ws-agents' copy of the file in shared state, else this copy's own read.
      automationSetting: (key) => automationSetting(shared("workspaces.settings")?.automations ? shared("workspaces.settings") : this.settings, key),
      claim: (space, ws) => {
        this.known.add(space);
        setShared("workspaces.assigned", { ...(shared("workspaces.assigned") ?? {}), [space]: ws });
      },
    };
    this.runner = new Runner(this.hooks);
    this.prs = new PrWatcher();
    this.gh = new GhWatcher();
    this.scratch = new Scratch({
      home, exec, spaces, panes, run, notify, shared, setShared, readTextFile, writeTextFile, wsDir: dir, platform: () => window()?.platform,
      trash: async (path) => (await exec("sh", ["-c", TRASH, "sh", path, `${home()}/.herdr/scratch/.trash`, `${base(path)}-${Date.now()}`])).stdout.trim(),
    });
    // Commands for this copy: "ws-switcher.scratch-new" (bind it to a key) asks for a scratch
    // space's name, and "ws-switcher.scratch-new/<name>" makes one at once (a script; a blank
    // name is "Scratch <time>"); the scratch toast's Keep is "ws-switcher.scratch-keep/<folder>" (a scratch folder
    // row's Keep and Don't keep come as shared "workspaces.scratch.keep", or "ws-switcher.scratch-row/keep|unkeep/<folder>");
    // a toast about one automation is "ws-switcher.automation/<workspace>/<name>" (automations.js: openAt);
    // "ws-switcher.board", "ws-switcher.worktrees", "ws-switcher.history" and "ws-switcher.notes" show the
    // shown workspace's view full size, and go back to the tabs when it's the one shown (the tab bar's
    // "ws-tabs.view/<view>" does the same for all six, and is the one to bind: it works with the sidebar hidden);
    // "ws-switcher.show/<screen>/<workspace>" only shows it (a toast's action: Notes' Move to the board);
    // "ws-switcher.settings" opens or closes our Settings window (ws-settings) and
    // "ws-switcher.settings/<section>" opens it on that section (features, agents, experimental, look, machines, …; extras is an alias for agents).
    // "ws-switcher.show/board/<workspace>/<card>" also opens that card (a pull request's toast).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        await this.command(c, cx);
      }
    });
    // known: the switch has been read once (nothing runs here before that).
    // owner: the background runner runs them, not this copy.
    this.bg = { known: false, owner: false, rev: null, tries: 0, tried: 0, failed: false };
    // The bell's log (notiflog.js): read once, then kept from the timers below.
    this.notif = new NotifLog((target, cx) => this.openNotification(target, cx));
    if (!checking()) cx.spawn(async (cx) => { await this.notif.load(); this.notif.tick(); cx.notify(); });
    try { this.adopted = new Set(JSON.parse(localStorage.getItem("adopted") ?? "[]")); } catch { this.adopted = new Set(); }
    this.reload(cx);
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${home()}/${SETTINGS_FILE}`).catch(() => null);
      this.settings = parseSettings(text);
      this.features.fromFile(this.settings, shared("workspaces.settings"));
      this.followFeatures();
      if (this.mine()) this.reload(cx); // the runners load once the answer is known
    });
    this.background(cx);
    cx.timer.every(2000, (cx) => this.background(cx));
    // Herdr rewrites its Settings window at every start: our copy follows (and every few minutes).
    this.settingsCopy(cx);
    cx.timer.every(180000, (cx) => this.settingsCopy(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        let paths;
        try { paths = await watchFolder(dir()); }
        catch { cx.timer.every(5000, (cx) => { this.reload(cx); if (this.mine()) this.runner.changed([dir()], cx); }); return; }
        if (notesOnly(paths, dir())) continue; // a note being typed: nothing here reads notes
        this.reload(cx);
        if (this.mine()) this.runner.changed(paths ?? [], cx);
      }
    });
    // The automations for every workspace (~/.herdr/automations), made if it isn't there.
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", globalDir()]).catch(() => {});
      for (;;) {
        try { await watchFolder(globalDir()); }
        catch { cx.timer.every(10000, (cx) => { if (this.mine()) this.reload(cx); }); return; }
        if (this.mine()) this.reload(cx);
      }
    });
    // herdr-core's templates: the global presets. The folder may not exist yet.
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(templatesDir()); }
        catch { cx.timer.every(10000, (cx) => this.reloadPresets(cx)); return; }
        this.reloadPresets(cx);
      }
    });
    // Placing and following also run here: Herdr doesn't draw while its window is
    // in the background, and a new space waits SETTLE for its folder.
    // Board off: no pull request follow-through or GitHub board item status (no gh, no messages).
    cx.timer.every(100, (cx) => this.drainViews(cx));
    // Says this sidebar copy is running, for the screens that ask it to do things (History, Settings,
    // Files' Cmd-click): they treat it as away when this is missing or older than 15 s.
    if (!checking()) {
      setShared("workspaces.switcher.alive", { at: Date.now() });
      cx.timer.every(5000, () => setShared("workspaces.switcher.alive", { at: Date.now() }));
    }
    cx.timer.every(500, (cx) => { this.sync(); this.requests(cx); this.notif.tick(); this.followFeatures(); this.followBeside(cx); if (this.mine()) { this.runner.tick(cx); if (this.features.on("board")) { this.prs.tick(cx); this.gh.tick(cx); } } this.scratch.tick(cx); if (spaces().some((s) => !this.known.has(s.id))) cx.notify(); });
  }

  async close() {
    if (!props()?.popup) return;
    const o = shared(SWITCHER_MENU);
    if (!o || o.overlay === (props()?.overlay ?? null)) setShared(SWITCHER_MENU, { overlay: null, closedAt: Date.now() });
  }

  // A command for this copy (see init): "scratch-new", "scratch-keep/…", "automation/…", "show/…",
  // "settings…", a view's key. The bell's items with such an action come here too (openNotification()).
  async command(c, cx) {
    try {
      if (c === "scratch-new") askScratch();
      else if (c.startsWith("scratch-new/")) await this.scratch.create(c.slice("scratch-new/".length));
      else if (screenOf(c) && !screenOf(c).space) this.toggleScreen(c, cx);
      else if (c.startsWith("scratch-keep/")) await this.scratch.keep(c);
      else if (c.startsWith("scratch-row/")) await this.scratch.setKept(c);
      else if (c.startsWith("automation/")) this.openAutomation(c);
      else if (c.startsWith("show/")) this.showScreen(c, cx);
      else if (c === "settings" || c.startsWith("settings/")) openSettings(c.slice("settings/".length), cx);
    } catch (e) { notify({ title: commandFailTitle(c, (k) => screenOf(k)?.name ?? null), body: String(e?.message ?? e), level: "error" }); }
  }

  // A notification's row was clicked (notif.js buildItems' target): its agent, its run's tab, the run
  // in History, the card on its board, the automation, or the command it carries. What's shown full
  // size gives way to the terminals for an agent or a tab.
  openNotification(target, cx) {
    if (!target || typeof target !== "object") return;
    const back = () => { if (shared("workspaces.screen")) setShared("workspaces.screen", null); };
    const id = (v) => (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(v ?? "")) ? String(v) : null);
    switch (target.kind) {
      case "agent":
        if (!target.terminal) return;
        back();
        run("agent.focus", { terminal: String(target.terminal) });
        return;
      case "tab":
        if (!target.tab) return;
        back();
        run("tab.select", { id: String(target.tab) });
        return;
      case "history": {
        if (!featureOn("history")) return;
        const ws = id(target.ws) && (shared("workspaces.defs") ?? []).some((d) => d.id === target.ws) ? target.ws : null;
        this.openHistory(ws, cx);
        setShared("workspaces.history.open", { ws, runId: String(target.runId ?? ""), at: Date.now() });
        return;
      }
      case "board": {
        const ws = id(target.ws);
        if (!ws || !featureOn("board")) return;
        this.openScreen(ws, "board", cx);
        if (id(target.taskId)) setShared("workspaces.board.open", { ws, taskId: target.taskId, at: Date.now() });
        return;
      }
      case "automation": {
        const ws = target.ws === "*" ? "-" : id(target.ws), name = id(target.name);
        if (ws && name) this.openAutomation(`automation/${ws}/${name}`);
        return;
      }
      case "vault": {
        // A Vault usage note: the Vault dialog, on the workspace the use was in.
        if (!featureOn("vault")) return;
        const ws = id(target.ws) && (shared("workspaces.defs") ?? []).some((d) => d.id === target.ws) ? target.ws : shared("workspaces.active") ?? null;
        openOverlay({ mod: "ws-vault", kind: "dialog", modal: true, width: 940, height: 680, props: { workspace: ws } });
        return;
      }
      case "action": {
        const name = String(target.name ?? "");
        if (name.startsWith("ws-switcher.")) { this.command(name.slice("ws-switcher.".length), cx); return; }
        if (name) run(name, target.args ?? {});
        return;
      }
    }
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      const gen = this.arrangeGen;
      const saved = await loadOrder();
      const defs = await loadDefs(saved);
      this.loaded = true;
      // A workspace.jsonc that read before and doesn't now (a save with a mistake): said once, not only in
      // the menu row's tooltip. Not at start: a file broken then is the row's dim name and tooltip.
      const readBefore = this.readOk ?? null;
      this.readOk = new Map(defs.filter((d) => !d.error).map((d) => [d.id, d.name]));
      // Read again a moment later first: an editor that empties the file before it writes it is no mistake.
      if (readBefore) for (const d of defs) if (d.error && readBefore.has(d.id)) cx.timer.after(1500, (cx) => cx.spawn(async () => {
        const text = await readTextFile(`${d.dir}/workspace.jsonc`).catch(() => null);
        let error = null;
        try { parseJsonc(text ?? ""); } catch (e) { error = String(e?.message ?? e); }
        if (text !== null && error) notify({ title: `${readBefore.get(d.id)}'s workspace.jsonc doesn't read`, body: `Open its files from the switcher menu (right-click “${d.id}”): ${error}`, level: "error" });
      }));
      // What's shown already has a drag or group change being written: only a read
      // that began after it was written may replace it.
      if (!this.arranging && gen === this.arrangeGen) {
        if (JSON.stringify(defs) !== JSON.stringify(shared("workspaces.defs") ?? [])) setShared("workspaces.defs", defs);
        if (JSON.stringify(saved) !== JSON.stringify(shared("workspaces.order") ?? null)) setShared("workspaces.order", saved);
      }
      // The Scratch workspace is there from the first run (scratch.js); the folder watch reloads.
      if (this.scratch && !this.scratchChecked) {
        this.scratchChecked = true;
        try { await this.scratch.firstRun(); }
        catch (e) { notify({ title: "Couldn't make the Scratch workspace", body: String(e?.message ?? e), level: "error" }); }
      }
      // Only when it changes: writing it wakes watchFolder (and this) again.
      const index = `${dir()}/.index`, text = indexText(defs);
      try {
        const old = await readTextFile(index);
        if (old !== text) await writeTextFile(index, text, old);
      } catch {} // a stale snapshot: the next change writes it
      await this.loadPresets(defs);
      if (this.mine()) {
        await this.runner?.load(cx);
        await this.prs?.load();
        await this.gh?.load();
      }
      cx.notify();
    });
  }

  // ws-settings' main.js: Herdr's Settings window (frame/settings/main.js) with Features,
  // Agents and Experimental, built by settingsbuild.js. Rebuilt only when Herdr's file changed since the last
  // look and written only when the text differs, so writing it (which reloads ws-settings)
  // never loops. Not before ws-settings is installed (its extras.js is there), and never
  // during a check (appHome() is then the person's own Herdr home).
  settingsCopy(cx) {
    if (checking() || this.settingsBusy) return;
    this.settingsBusy = true;
    cx.spawn(async () => {
      try {
        const source = await readTextFile(`${appHome()}/${SETTINGS_SOURCE}`).catch(() => null);
        const seen = source == null ? "none" : hash(source);
        if (seen !== this.settingsSeen && (await readTextFile(`${appHome()}/mods/ws-settings/extras.js`).catch(() => null)) != null) {
          const r = buildSettings(source, { version: updates()?.app?.version });
          const target = `${appHome()}/${SETTINGS_TARGET}`;
          const old = await readTextFile(target).catch(() => null);
          if (old !== r.text) {
            await writeTextFile(target, r.text, old ?? undefined);
            if (!r.ok) notify({ title: "Settings shows only the package's sections for now", level: "warning",
              body: "Herdr's Settings changed in a way the package's copy can't follow yet: until the package is updated, the footer's Settings has only the package's own sections and a button to Herdr's own." });
          }
          this.settingsSeen = seen;
        }
      } catch (e) { console.log(`ws-switcher: couldn't write ws-settings: ${e?.message ?? e}`); }
      this.settingsBusy = false;
    });
  }

  // This copy runs the automations and follows the pull requests itself (once it knows
  // what Settings > Features says).
  mine() { return this.bg.known && !this.bg.owner && this.features.known; }

  // Settings > Features' flips, from shared state; one line in Herdr's log for each.
  followFeatures() {
    if (!this.features.known) return;
    const before = this.featuresSaid ?? null;
    this.features.follow(shared("workspaces.settings"));
    const now = Object.fromEntries(Object.keys(FOLLOWED).map((k) => [k, this.features.on(k)]));
    for (const f of flips(before, now)) console.log(`ws-switcher: ${FOLLOWED[f.key][f.on ? "on" : "off"]}`);
    this.featuresSaid = now;
  }

  // Every 2s: who runs them, and, when it's the background runner, what it has for the window.
  background(cx) {
    if (this.bgBusy) return;
    this.bgBusy = true;
    cx.spawn(async (cx) => {
      try {
        const at = runnerDir(), b = this.bg, now = Date.now();
        const on = ((await readTextFile(`${at}/switch`)) ?? "").trim() === "on";
        let alive = null;
        try { alive = JSON.parse((await readTextFile(`${at}/alive`)) ?? "null"); } catch {}
        const running = Boolean(alive && now - alive.at < 30000);
        if (!on || running) { b.tries = 0; b.failed = false; }
        // On but not running (the computer restarted, or it stopped): start it. After
        // three tries, this copy runs them while Herdr is open, and says so once.
        if (on && !running && !b.failed && now - b.tried > 20000) {
          if (b.tries >= 3) {
            b.failed = true;
            notify({
              title: "The background runner didn't start", level: "warning",
              body: `${b.why || "It gave no reason."} Herdr runs your automations itself while it's open. herdr-ws-runner --status says more.`,
            });
          } else {
            b.tries++;
            b.tried = now;
            const r = await exec(`${appHome()}/mods/ws-switcher/bin/herdr-ws-runner`, ["--start"], { timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
            b.why = r.code === 0 ? null : String(r.stderr ?? "").trim().split("\n").pop();
          }
        }
        const owner = on && !b.failed;
        if (!b.known || owner !== b.owner) {
          b.known = true;
          b.owner = owner;
          b.rev = null;
          // Ours again (or for the first time): from what the file remembers.
          if (!owner) { this.runner = new Runner(this.hooks); this.prs = new PrWatcher(); this.gh = new GhWatcher(); this.reload(cx); }
        }
        if (owner && running && alive.rev !== b.rev) {
          let state = null;
          try { state = JSON.parse((await readTextFile(`${at}/state.json`)) ?? "null"); } catch {}
          if (state) {
            b.rev = alive.rev;
            for (const [key, value] of [["workspaces.automations", state.automations ?? {}], ["workspaces.automations.global", state.global ?? []], ["workspaces.automation.runs", state.runs ?? []], ["workspaces.prs", state.prs ?? {}], ["workspaces.github", state.github ?? {}]]) {
              if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? null)) setShared(key, value);
            }
          }
        }
        await this.notes();
        this.adopt();
        // Start at login: its LaunchAgent file on macOS, its systemd user unit on Linux
        // (herdr-ws-runner --login on writes either). "plist" names whichever file it is.
        // Windows: its scheduled task, as Task Scheduler says (asked at most every 30 seconds,
        // and again after a switch).
        const platform = window()?.platform;
        const plist = platform === "macos" ? `${home()}/Library/LaunchAgents/dev.herdr.ws-runner.plist`
          : platform === "windows" ? "Task Scheduler: \\Herdr\\herdr-ws-runner"
          : `${home()}/.config/systemd/user/herdr-ws-runner.service`;
        let login = false;
        if (platform === "windows") {
          if (!this.loginTask || Date.now() - this.loginTask.at > 30000) {
            const r = await exec("schtasks", ["/query", "/tn", "\\Herdr\\herdr-ws-runner"], { timeout: 15000 }).catch(() => null);
            this.loginTask = { at: Date.now(), on: r?.code === 0 };
          }
          login = this.loginTask.on;
        } else login = (platform === "macos" || platform === "linux") && (await readTextFile(plist).catch(() => null)) !== null;
        const say = { on, running, via: running ? alive.via ?? "hc" : null, pid: running ? alive.pid ?? null : null, login, plist };
        if (JSON.stringify(say) !== JSON.stringify(shared("workspaces.runner") ?? null)) setShared("workspaces.runner", say);
      } finally {
        this.bgBusy = false;
      }
      cx.notify();
    });
  }

  // The background runner's toasts: files it left, shown once. Many at once (Herdr
  // was closed) become one.
  async notes() {
    const at = `${runnerDir()}/notes`;
    let names = [];
    try { names = (await fs.readdir(at)).filter((n) => n.endsWith(".json")).sort(); } catch { return; }
    if (!names.length) return;
    const list = [];
    for (const n of names) {
      try {
        const note = JSON.parse((await readTextFile(`${at}/${n}`)) ?? "null");
        if (note?.title) {
          // The bell keeps each one worth it, with its own time, before many become one toast.
          this.notif?.record(note);
          delete note.at;
          list.push(note);
        }
      } catch {}
    }
    await exec("rm", ["-f", ...names.map((n) => `${at}/${n}`)]).catch(() => {});
    if (list.length <= 3) { for (const n of list) notify(n); return; }
    notify({
      title: `${list.length} updates from your automations`,
      body: `${list.slice(-6).map((n) => n.title).join("; ")}${list.length > 6 ? "; and earlier ones" : ""}.`,
      level: list.some((n) => n.level === "error" || n.level === "warning") ? "warning" : "info",
      ...(featureOn("automations") ? { action: { name: "mod.open", args: { name: "ws-automations" } } } : {}),
    });
  }

  // "automation/<workspace>/<name>": a toast about one automation was clicked. Opens the
  // Automations screen for that workspace with the automation picked ("-": one for every
  // workspace, in the workspace on screen). The words come from a command's text, so they're
  // only looked up among what's loaded. One that's gone since: the screen for its workspace,
  // or as the footer opens it.
  openAutomation(c) {
    if (!featureOn("automations")) return; // off in Settings > Features: its screen isn't there
    const [, ws, name] = c.split("/");
    const defs = (shared("workspaces.defs") ?? []).filter((d) => !d.error);
    const active = shared("workspaces.active") ?? null;
    const workspace = ws === "-" ? active ?? defs[0]?.id ?? null : defs.some((d) => d.id === ws) ? ws : null;
    const a = workspace ? ((shared("workspaces.automations") ?? {})[workspace] ?? []).find((x) => x.name === name && (ws !== "-" || x.scope === "global")) : null;
    openOverlay({
      mod: "ws-automations", kind: "dialog", modal: true, width: 940, height: 680,
      props: a ? { workspace, pick: { scope: a.scope ?? "workspace", name: a.name } } : { workspace: workspace ?? active },
    });
  }

  // Runs the background runner started arrive as bare terminals with Herdr's labels:
  // their space joins the workspace and is called Automations, their tab is called
  // after the automation. Once each, so a name you change stays.
  adopt() {
    const runs = (shared("workspaces.automation.runs") ?? []).filter((r) => r.adopt && r.space && r.tab);
    if (!runs.length) return;
    const sp = spaces();
    let changed = false;
    // A space that's gone is forgotten: the runner makes it again under the same id
    // for a later run, and it's then claimed and named as the first time.
    if (sp.length) for (const k of [...this.adopted]) if (k.startsWith("s:") && !sp.some((x) => x.id === k.slice(2))) { this.adopted.delete(k); changed = true; }
    for (const r of runs) {
      const s = sp.find((x) => x.id === r.space);
      if (!s) continue;
      if (!this.adopted.has(`s:${s.id}`)) {
        this.adopted.add(`s:${s.id}`);
        changed = true;
        this.hooks.claim(s.id, r.ws);
        if (!s.named) run("space.rename", { id: s.id, name: "Automations" });
      }
      if (this.adopted.has(r.id)) continue;
      const tab = (s.tabs ?? []).find((t) => t.id === r.tab);
      if (!tab) continue;
      this.adopted.add(r.id);
      changed = true;
      if (tab.name !== r.name) run("tab.rename", { id: tab.id, name: r.name });
    }
    if (changed) { try { localStorage.setItem("adopted", JSON.stringify([...this.adopted].slice(-300))); } catch {} }
  }

  reloadPresets(cx) {
    cx.spawn(async (cx) => { await this.loadPresets(shared("workspaces.defs") ?? []); cx.notify(); });
  }

  // Publishes { global, workspaces: { id: [...] } } and whether the launcher is installed.
  async loadPresets(defs) {
    const presets = { global: await loadPresetDir(templatesDir(), "global"), workspaces: {} };
    for (const d of defs) presets.workspaces[d.id] = await loadPresetDir(`${d.dir}/agents`, "workspace");
    if (JSON.stringify(presets) !== JSON.stringify(shared("workspaces.presets") ?? null)) setShared("workspaces.presets", presets);
    let launcher = false;
    try { launcher = (await exec("sh", ["-c", "command -v herdr-ws-agent"])).code === 0; } catch {}
    if (launcher !== shared("workspaces.launcher")) setShared("workspaces.launcher", launcher);
  }

  // Places new spaces, follows the shown space into its workspace, remembers it.
  sync() {
    const defs = shared("workspaces.defs") ?? [];
    let active = shared("workspaces.active") ?? null;
    if (this.loaded && active && !defs.some((d) => d.id === active)) {
      active = null;
      setShared("workspaces.active", null);
    }
    const sp = spaces(), ps = panes(), now = Date.now();
    const assigned = { ...(shared("workspaces.assigned") ?? {}) };
    let changed = false;
    // A workspace that's gone (deleted here or by hand): its spaces are decided again.
    if (this.loaded) {
      for (const [id, ws] of Object.entries(assigned)) {
        if (ws !== false && !defs.some((d) => d.id === ws)) { delete assigned[id]; this.known.add(id); changed = true; }
      }
    }
    for (const s of sp) {
      if (s.id in assigned) { this.known.add(s.id); continue; }
      // A scratch space joins Scratch at once; it waits while that workspace is being made.
      if (!s.machine && isScratch(s.folder || placeOf(s, ps), home())) {
        const sd = scratchDef(defs);
        if (sd) { assigned[s.id] = sd.id; changed = true; this.known.add(s.id); }
        continue;
      }
      const fresh = !this.known.has(s.id);
      if (fresh && now - (this.born[s.id] ??= now) < SETTLE) continue;
      const hit = s.machine ? null : match(placeOf(s, ps), defs);
      if (hit) { assigned[s.id] = hit; changed = true; }
      else if (fresh && active) { assigned[s.id] = active; changed = true; }
      this.known.add(s.id);
    }
    // Spaces that are gone, once every machine's spaces are known.
    if (machines().every((m) => m.layout === "ready")) {
      const live = new Set(sp.map((s) => s.id));
      for (const id of Object.keys(assigned)) if (!live.has(id)) { delete assigned[id]; changed = true; }
      // And their Changes and Files pills.
      const pills = shared("workspaces.screens.space") ?? {};
      const gone = Object.keys(pills).filter((id) => !live.has(id));
      if (gone.length && sp.length) setShared("workspaces.screens.space", Object.fromEntries(Object.entries(pills).filter(([id]) => live.has(id))));
    }
    if (changed) setShared("workspaces.assigned", assigned);

    // A key, a toast or space.next showed a space elsewhere: go with it. Not while
    // an automation's tab is being made: that shows it for a moment.
    const order = this.order ?? [];
    this.order = sp.map((s) => s.id);
    if (this.runner?.holding()) return;
    const shown = sp.find((s) => s.active)?.id ?? null;
    // The shown space was closed and Herdr showed its next one, from another
    // workspace: stay, on the closed one's neighbour here (none left: the
    // workspace's empty list, with whatever Herdr shows beside it).
    const closed = this.shown && !sp.some((s) => s.id === this.shown) ? this.shown : null;
    if (closed && active && shown && assigned[shown] !== active) {
      this.shown = shown;
      const live = new Set(sp.filter((s) => assigned[s.id] === active).map((s) => s.id));
      const at = order.indexOf(closed);
      const next = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0)).reverse()].find((id) => live.has(id))
        ?? [...live][0];
      if (next) { run("space.select", { id: next }); return; }
    }
    const ownerOf = (id) => (defs.some((d) => d.id === assigned[id]) ? assigned[id] : null);
    // A tab made and shown in the covered space (Cmd-T while the empty block shows): go with it.
    const tabNow = sp.find((s) => s.id === shown)?.tabs?.find((c) => c.active)?.id ?? null;
    const madeTab = Boolean(this.cover?.tabs) && shown === this.shown && tabNow && !this.cover.tabs.has(tabNow);
    if (shown && (shown !== this.shown || madeTab) && this.known.has(shown)) {
      this.shown = shown;
      const owner = ownerOf(shown);
      if (owner !== active) { active = owner; setShared("workspaces.active", active); }
    }
    if (active && shown && assigned[shown] === active) {
      const last = shared("workspaces.last") ?? {};
      if (last[active] !== shown) setShared("workspaces.last", { ...last, [active]: shown });
    }
    // Herdr always shows a space. While the shown workspace has none of its own here
    // (its last one closed, or it was chosen empty), the empty block covers the other one's.
    const covered = this.loaded && Boolean(active) && (!shown || (this.known.has(shown) && ownerOf(shown) !== active));
    this.coverWork(covered, sp.find((s) => s.id === shown), this.screen(active, `${shown}/${tabNow}`, now));
  }

  // The screen to show in place of the tabs, or null. It goes back to the tabs when
  // its workspace isn't the shown one, when it's closed there, and when the shown
  // space or tab changes (a click, a key, a new tab): whoever asked wants to see that.
  screen(active, view, now) {
    const scr = shared("workspaces.screen") ?? null;
    if (!scr) { this.screenKey = null; return null; }
    if (!this.loaded) return screenOf(scr.screen) && featureOn(scr.screen) ? scr.screen : null;
    // A space's view belongs to its space (its pills there), a workspace's to the workspace.
    const space = screenOf(scr.screen)?.space;
    const open = space ? (shared("workspaces.screens.space") ?? {})[scr.space] ?? [] : (shared("workspaces.screens") ?? {})[scr.ws ?? ALL] ?? [];
    const key = `${scr.ws}/${scr.space}/${scr.screen}/${scr.at}`;
    // Just shown (or Herdr just started): where the view is now is where it stays.
    if (this.screenKey !== key || now - (scr.at ?? 0) < 800) { this.screenKey = key; this.screenView = view; }
    // Its feature turned off (Settings > Features): the tabs again; its pin stays for when it's back.
    if (!screenOf(scr.screen) || !featureOn(scr.screen) || (scr.ws ?? null) !== active || !open.includes(scr.screen) || view !== this.screenView
      || (space && (!scr.space || !view.startsWith(`${scr.space}/`)))) {
      setShared("workspaces.screen", null);
      this.screenKey = null;
      return null;
    }
    return scr.screen;
  }

  // Shows the layout's empty block in place of the work column (tabs, terminals, status),
  // or the work column again; `screen`, one of the workspace's screens, goes over either.
  // An older copy of the layout, with no `center` stack, is left alone.
  coverWork(on, space, screen = null) {
    const center = find(layout(), "center");
    if (!center?.children?.some((c) => c.id === "empty")) return;
    if (on && !this.cover) this.cover = { tabs: new Set((space?.tabs ?? []).map((c) => c.id)) };
    if (!on) this.cover = null;
    if (Boolean(shared("workspaces.covered")) !== on) setShared("workspaces.covered", on);
    const body = screen ? find(center, "screens-body") : null;
    if (screen && !body?.children?.some((c) => c.id === `screen-${screen}`)) screen = null;
    if (screen && body.active !== `screen-${screen}`) run("layout.select", { stack: "screens-body", child: `screen-${screen}` });
    const want = screen ? "screens" : on ? "empty" : "work";
    if (center.active === want) return;
    run("layout.select", { stack: "center", child: want });
    // Back from a view shown full size, which had taken the keyboard: to the pane that had it before.
    const pane = center.active === "screens" && want === "work" ? focused()?.pane : null;
    if (pane) run("pane.focus", { pane });
  }

  // The empty block: the shown workspace has no spaces. What still opens (the workspace's views,
  // from the tab bar's Views), and a "New space in <workspace>" button that starts one (as the Spaces
  // + does; Scratch: names one first), in both layouts.
  empty(t) {
    const ws = (shared("workspaces.defs") ?? []).find((d) => d.id === shared("workspaces.active")) ?? null;
    const make = () => {
      if (ws?.scratch) askScratch();
      else run("space.new", ws?.root ? { folder: ws.root } : {});
    };
    const bar = !find(layout(), "screens-tabs"); // one tab bar over everything, with + and Views
    const views = ["board", "notes", "worktrees", "history"].filter((k) => featureOn(k) && !(k === "worktrees" && ws?.scratch)).map((k) => SCREENS[k].name);
    const list = views.length <= 1 ? views[0] ?? "" : `${views.slice(0, -1).join(", ")} and ${views[views.length - 1]}`;
    return v_flex().size_full().items_center().justify_center().gap(4).px(24).text_size(12.8).text_color(t.muted)
      .when(Boolean(ws), (el) => el.child(div().font_medium().text_size(14).text_color(t.foreground).child(`${ws.name} has no spaces yet`))
        .when(Boolean(list) && bar, (el) => el.child(div().text_center().child(`${list} still ${views.length === 1 ? "opens" : "open"} from Views.`)))
        .child(div().text_center().child(`Start a ${ws.scratch ? "scratch space" : "space"} to work beside an agent.`))
        .child(div().id("empty-new").mt(8).px(10).py(5).rounded(7).cursor_pointer().text_color(t.muted)
          .border(1).border_color(t.border).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(make).child(ws.scratch ? "New scratch space…" : `New space in ${ws.name}`)));
  }

  async create() {
    const root = await pickFolder({ prompt: "Use as workspace" });
    if (!root) return;
    const defs = shared("workspaces.defs") ?? [];
    // A folder a workspace already has as its root: that workspace, not a second one with its name.
    const had = defs.find((d) => !d.error && !d.scratch && d.root && d.root === expand(root));
    if (had) { notify({ title: `${had.name} already uses that folder`, body: `${tilde(had.root)} is ${had.name}'s: it's shown now.`, level: "info" }); choose(had.id); return; }
    const slug = base(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
    let id = slug;
    for (let n = 2; defs.some((d) => d.id === id) || (await fs.exists(`${dir()}/${id}`)); n++) id = `${slug}-${n}`;
    const used = new Set(defs.map((d) => d.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[defs.length % PALETTE.length];
    await writeTextFile(`${dir()}/${id}/workspace.jsonc`, configText(base(root), color, tilde(root), await subdirs(root)), null);
    await writeTextFile(`${dir()}/${id}/AGENTS.md`, instructionsText(base(root)), null);
    setShared("workspaces.defs", await loadDefs());
    choose(id);
  }

  // The New space dialog (holding or right-clicking the Spaces +): a name and a folder.
  // Its Scratch form (props.scratch, or Scratch's id) has only the name, and is what
  // every New scratch space opens (askScratch()).
  initNewSpace(cx) {
    const ws = (shared("workspaces.defs") ?? []).find((d) => d.id === props().id) ?? null;
    const scratch = Boolean(props().scratch || ws?.scratch);
    const shown = spaces().find((s) => s.active);
    const start = ws?.root || (shown ? placeOf(shown, panes()) : "") || home();
    const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    this.nameIn = InputState.new({ value: "", placeholder: scratch ? `Scratch ${hhmm}` : "Called after its folder" });
    this.folderIn = InputState.new({ value: scratch ? "" : tilde(start) });
    this.typedFrom = this.folderIn.value(); // what Esc compares with: a name typed or the folder changed asks once
    for (const input of [this.nameIn, this.folderIn]) {
      input.on("change", (_e, cx) => { this.error = null; this.escAsked = false; cx.notify(); });
      input.on("submit", (_e, cx) => this.newSpace(cx));
    }
    this.nameIn.focus();
    cx.timer.after(600, () => this.nameIn.focus());
  }

  // Its Create: a space with that name in that folder (Scratch: a new scratch folder).
  newSpace(cx) {
    const p = props();
    const ws = (shared("workspaces.defs") ?? []).find((d) => d.id === p.id) ?? null;
    const name = this.nameIn.value().trim();
    if (this.busy) return;
    if (p.scratch || ws?.scratch) {
      setShared("workspaces.scratch", { at: Date.now(), ...(name ? { name } : {}) });
      closeOverlay(p.overlay);
      return;
    }
    const folder = expand(this.folderIn.value().trim()).replace(/\/+$/, "") || "/";
    if (!folder.startsWith("/")) { this.error = "Give a full path, or one starting with ~/."; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await exec("test", ["-d", folder]).catch(() => ({ code: 1 }));
      this.busy = false;
      if (r.code !== 0) { this.error = `There's no folder at ${tilde(folder)}.`; cx.notify(); return; }
      run("space.new", { folder, ...(name ? { name } : {}) });
      closeOverlay(p.overlay);
    });
  }

  // The rename dialog's Save: writes the new name into workspace.jsonc, then closes.
  rename(cx) {
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === props().id);
    const name = this.text.trim();
    if (!d || this.busy) return;
    if (!name) { this.error = "A workspace needs a name."; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const file = `${d.dir}/workspace.jsonc`;
        const old = await readTextFile(file);
        if (old === null) throw new Error("its workspace.jsonc is gone");
        await writeTextFile(file, withName(old, name), old);
        // Shown at once; the folder watch confirms it.
        setShared("workspaces.defs", (shared("workspaces.defs") ?? []).map((x) => (x.id === d.id ? { ...x, name } : x)));
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = `Couldn't rename it: ${e?.message ?? e}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  // The delete dialog's confirm: the folder to the Trash, its spaces decided again.
  // Scratch takes its scratch folders along (they're throwaway) and closes its spaces first.
  remove(cx) {
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === props().id);
    if (!d || this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        if (d.scratch) {
          const assignedNow = shared("workspaces.assigned") ?? {};
          for (const s of spaces()) if (assignedNow[s.id] === d.id) run("space.close", { id: s.id, confirmed: true });
          const root = d.root;
          if (root && root.endsWith("/.herdr/scratch") && (await fs.exists(root))) {
            const t = await exec("sh", ["-c", TRASH, "sh", root, `${dir()}/.trash`, `scratch-folders-${stamp}`]);
            if (t.code !== 0) throw new Error(t.stderr.trim() || `exit ${t.code}`);
          }
        }
        const r = await exec("sh", ["-c", TRASH, "sh", d.dir, `${dir()}/.trash`, `${d.id}-${stamp}`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        const where = r.stdout.trim();
        // Gone from the list now, so its spaces join where their folder is, not it again.
        setShared("workspaces.defs", (shared("workspaces.defs") ?? []).filter((x) => x.id !== d.id));
        const assigned = { ...(shared("workspaces.assigned") ?? {}) };
        for (const [id, ws] of Object.entries(assigned)) if (ws === d.id) delete assigned[id];
        setShared("workspaces.assigned", assigned);
        const last = { ...(shared("workspaces.last") ?? {}) };
        delete last[d.id];
        setShared("workspaces.last", last);
        if (shared("workspaces.active") === d.id) setShared("workspaces.active", null);
        notify({ title: `Deleted ${d.name}`, body: d.scratch
          ? (where === "Trash" ? `It and its scratch folders are in the ${trashName()}. It comes back, empty, with the next scratch space.` : `It and its scratch folders are in ${tilde(`${dir()}/.trash`)}.`)
          : where === "Trash" ? `Its folder is in the ${trashName()}.` : `Its folder is in ${tilde(where)}.`, level: "success" });
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = `Couldn't delete it: ${e?.message ?? e}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  // The scratch-trash dialog's confirm: the folder to the Trash, only one directly in ~/.herdr/scratch that
  // nothing is in (no space, no terminal), then gone from the menu at once (the tidy forgets it).
  trashFolder(cx) {
    if (this.busy) return;
    const folder = String(props().folder ?? "");
    const root = scratchRoot(home());
    const inside = folder.startsWith(root + "/") && /^[^/.][^/]*$/.test(folder.slice(root.length + 1));
    const ps = panes();
    const busyThere = spaces().some((s) => !s.machine && (s.folder === folder || s.folder?.startsWith(folder + "/")))
      || ps.some((p) => p.cwd === folder || p.cwd?.startsWith(folder + "/"));
    if (!inside) { this.error = "That isn't a scratch folder."; cx.notify(); return; }
    if (busyThere) { this.error = "A space or a terminal is in it now: close it first."; cx.notify(); return; }
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", TRASH, "sh", folder, `${root}/.trash`, `${base(folder)}-${Date.now()}`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        const where = r.stdout.trim();
        setShared("workspaces.scratch.folders", (shared("workspaces.scratch.folders") ?? []).filter((f) => f !== folder));
        const state = { ...(shared("workspaces.scratch.state") ?? {}) };
        delete state[folder];
        setShared("workspaces.scratch.state", state);
        const label = scratchLabel(folder) ?? base(folder);
        notify({ title: `Scratch folder moved to the ${trashName()}`, body: where === "Trash" ? `${label} is in the ${trashName()}.` : `${label} is in ${tilde(where)}.`, level: "success" });
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = `Couldn't move it: ${e?.message ?? e}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  newSpaceDialog(t, ws, { frame, title, button, error, close }) {
    const defs = shared("workspaces.defs") ?? [];
    const field = (label, input) => [div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child(label),
      Input.new(input).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground)];
    const scratch = Boolean(props().scratch || ws?.scratch);
    const el = frame("ws-new-space", (cx) => this.newSpace(cx)).child(title(scratch ? "New scratch space" : ws ? `New space in ${ws.name}` : "New space"));
    el.children(field("Name", this.nameIn));
    if (scratch) {
      return el.child(div().pt(10).text_size(11.5).text_color(t.dim).child("Its new folder in ~/.herdr/scratch carries the name, and is tidied away when you're done unless you keep it. Blank name: Scratch and the time."))
        .when(Boolean(this.error || this.escAsked), (e) => e.child(error()))
        .child(div().flex_1().min_h(0)).child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ws-new-cancel", "Cancel", false, close))
          .child(button("ws-new-create", "Create", true, (_e, cx) => this.newSpace(cx))));
    }
    const folder = expand(this.folderIn.value().trim()).replace(/\/+$/, "");
    const hit = folder.startsWith("/") ? (isScratch(folder, home()) ? scratchDef(defs)?.id : match(folder, defs)) : null;
    const owner = defs.find((d) => d.id === hit) ?? null;
    const joins = owner && owner.id !== ws?.id ? `Joins ${owner.name}: its folder is there.` : ws ? `Joins ${ws.name}.` : owner ? `Joins ${owner.name}.` : "Shows under All spaces.";
    const picks = ws ? [ws.root, ...ws.folders].filter(Boolean).slice(0, 6) : [];
    const chip = (id, label, tip, action) => div().id(id).h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.input)
      .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(label);
    const setFolder = (path, cx) => { this.folderIn.set_value(tilde(path)); this.error = null; this.escAsked = false; cx.notify(); };
    return el.children(field("Folder", this.folderIn))
      .child(h_flex().pt(8).gap(6).flex_wrap()
        .children(picks.map((f, i) => chip(`ws-new-pick-${i}`, f === ws.root ? `${base(f)} (root)` : base(f), tilde(f), (_e, cx) => setFolder(f, cx))))
        .child(chip("ws-new-choose", "Choose…", "Pick a folder", (_e, cx) => cx.spawn(async (cx) => {
          const picked = await pickFolder({ prompt: "Use for the space" });
          if (picked) setFolder(picked, cx);
        }))))
      .child(div().pt(10).text_size(11.5).text_color(t.dim).child(`${joins} Blank name: called after its folder.`))
      .when(Boolean(this.error || this.escAsked), (e) => e.child(error()))
      .child(div().flex_1().min_h(0)).child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ws-new-cancel", "Cancel", false, close))
        .child(button("ws-new-create", "Create", true, (_e, cx) => this.newSpace(cx))));
  }

  // What the dialog holds that Esc would drop: Rename's changed name, New space's typed name or changed
  // folder. Delete holds nothing.
  typed() {
    const p = props();
    if (p.dialog === "rename") return (this.text ?? "").trim() !== (this.typedFrom ?? "").trim();
    if (p.dialog === "new-space") return Boolean(this.nameIn?.value().trim()) || (this.folderIn?.value() ?? "") !== (this.typedFrom ?? "");
    return false;
  }

  dialog(t) {
    const p = props();
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === p.id);
    // These dialogs are modal (a click beside them doesn't close them). While one is deleting, creating
    // or saving, nothing closes it: its task ends with it. Esc with something typed asks once first.
    const close = () => { if (!this.busy) closeOverlay(p.overlay); };
    const escape = (cx) => {
      if (this.busy) return;
      // Only where the frame draws the ask line: in "This workspace is gone." nothing is left to lose.
      if (this.typed() && !this.escAsked && (d || p.dialog === "new-space")) { this.escAsked = true; cx.notify(); return; }
      close();
    };
    // danger: a delete's button, in the danger fill (`blocked`), as Files' Move to Trash has it (D2).
    const button = (id, label, primary, action, danger = false) => h_flex().id(id).h(32).px(danger ? 13 : 14).items_center().rounded(8)
      .border_1().border_color(danger ? t.blocked : primary ? t.solid : t.input).bg(danger ? t.blocked : primary ? t.solid : t.raised)
      .text_color(danger || primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(this.busy, (el) => el.opacity(0.45)).hover((s) => s.opacity(0.88)).on_click(action).child(label);
    const title = (text) => h_flex().items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(text))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
    // The error line, which also says what a first Esc did (in `working`, as Secrets says it).
    const error = () => this.escAsked
      ? div().pt(8).text_size(11.5).text_color(t.working).child("Press Esc again to close and drop what you typed.")
      : div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error ?? "");
    // Esc, and Cmd/Ctrl+W, reach a dialog as Herdr's actions (overlay.close, tab.close, pane.close), never
    // as keys: claimed here, so the first asks when something typed would be lost and a busy dialog stays.
    // A handler that returns without closing keeps the dialog. (These dialogs are only ever overlays.)
    const onClose = (_e, cx) => { cx.stop_propagation(); escape(cx); };
    const frame = (id, enter) => v_flex().id(id).track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      // A click anywhere in it takes back the first Esc.
      .on_mouse_down("left", (_e, cx) => { if (this.escAsked) { this.escAsked = false; cx.notify(); } })
      .on_action("overlay.close", onClose)
      .on_action("tab.close", onClose)
      .on_action("pane.close", onClose)
      // Enter only: Herdr's Esc comes as overlay.close (above), never as a key here.
      .on_key_down((e, cx) => {
        if (e.key === "enter" && enter) enter(cx);
        else return;
        cx.stop_propagation();
      });
    if (p.dialog === "new-space") return this.newSpaceDialog(t, d ?? null, { frame, title, button, error, close });
    // A scratch folder's Move to Trash… (its right-click in the menu): it asks first, as a delete does.
    if (p.dialog === "scratch-trash") {
      const folder = String(p.folder ?? "");
      const name = scratchLabel(folder) ?? base(folder);
      return frame("ws-scratch-trash", (cx) => this.trashFolder(cx))
        .child(title(`Move ${name} to the ${trashName()}?`))
        .child(div().pt(12).text_color(t.muted).child(`Moves ${tilde(folder)} and the files in it to the ${trashName()}.`))
        .when(Boolean(this.error), (el) => el.child(error()))
        .child(div().flex_1().min_h(0)).child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ws-scratch-trash-cancel", "Cancel", false, close))
          .child(button("ws-scratch-trash-yes", this.busy ? "Moving…" : `Move to ${trashName()}`, false, (_e, cx) => this.trashFolder(cx), true)));
    }
    // Its workspace went while the dialog was open (its folder moved or removed): only a way out.
    if (!d) return frame("ws-gone", null).child(title("Workspace")).child(div().pt(12).text_color(t.muted).child("This workspace is gone."))
      .child(div().flex_1().min_h(0)).child(h_flex().pt(18).gap(8).justify_end().child(button("ws-gone-cancel", "Cancel", false, close)));

    if (p.dialog === "rename") {
      return frame("ws-rename", null)
        .child(title("Rename workspace"))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
        .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Changes "name" in ${tilde(d.dir)}/workspace.jsonc.`))
        .when(Boolean(this.error || this.escAsked), (el) => el.child(error()))
        .child(div().flex_1().min_h(0)).child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ws-rename-cancel", "Cancel", false, close))
          .child(button("ws-rename-save", "Save", true, (_e, cx) => this.rename(cx))));
    }

    // Enter confirms a delete, but not Scratch's: it closes its spaces, ending what runs there, which
    // the Trash can't bring back.
    return frame("ws-delete", d.scratch ? null : (cx) => this.remove(cx))
      .child(title(`Delete “${d.name}”?`))
      .child(div().pt(12).text_color(t.muted).child(
        d.scratch ? scratchDeleteText(d) :
        `Moves ${tilde(d.dir)} (its workspace.jsonc and AGENTS.md) to the ${trashName()}. Your repos and folders aren't touched, and its spaces stay open: they join the workspace their folder is in, else show under All spaces.`))
      .when(Boolean(this.error), (el) => el.child(error()))
      .child(div().flex_1().min_h(0)).child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ws-delete-cancel", "Cancel", false, close))
        // Scratch's says it closes its spaces too (D2); every delete is in the danger fill.
        .child(button("ws-delete-yes", this.busy ? "Deleting…" : d.scratch ? scratchDeleteButton(spaces().filter((s) => (shared("workspaces.assigned") ?? {})[s.id] === d.id).length, trashName()) : `Move to ${trashName()}`,
          false, (_e, cx) => this.remove(cx), true)));
  }

  render(cx) {
    const t = theme();
    if (props()?.empty) return this.empty(t);
    if (props()?.popup) return this.menu(t);
    if (props()?.dialog) return this.dialog(t);
    // Only placing here; the asks wait for the timer (requests()): a task started from render runs to
    // its first await and never goes on.
    this.sync();
    const defs = shared("workspaces.defs") ?? [];
    const active = defs.find((d) => d.id === shared("workspaces.active")) ?? null;
    // No count of spaces and no dot for another workspace's agents here: the spaces list shows the
    // spaces, and the tab bar's bell (ws-notifications) says what needs you and where.
    // Open already: the click closes it (a press outside a popup may close it first: then it stays closed).
    const m = shared(SWITCHER_MENU), up = Boolean(m?.overlay) && (m.at ?? 0) >= this.startedAt;
    const open = () => {
      if (up) { closeOverlay(m.overlay); setShared(SWITCHER_MENU, { overlay: null, closedAt: Date.now() }); return; }
      if (Date.now() - (m?.closedAt ?? 0) < 300) return;
      openOverlay({ mod: "ws-switcher", kind: "popup", width: 288, height: 600, props: { popup: true } });
    };
    if (narrow()) {
      return h_flex().size_full().bg(t.chrome).items_center().justify_center()
        .child(h_flex().id("ws-rail").relative().size(32).rounded(6).items_center().justify_center().cursor_pointer()
          .hover((s) => s.bg(t.hover)).when(!up, (el) => el.tooltip(active?.name ?? "All spaces")).on_click(open)
          .child(mark(active, defs, t, 20)));
    }
    return h_flex().size_full().bg(t.chrome).px(8).items_center().text_size(13)
      .child(h_flex().id("ws-current").flex_1().min_w(0).h(34).px(8).gap(9).rounded(8).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(open)
        .child(mark(active, defs, t, 20))
        .child(div().id("ws-current-name").flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).when(!up, (el) => el.tooltip(active?.name ?? "All spaces")).child(active?.name ?? "All spaces"))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).flex_none().text_color(t.dim)));
  }

  // What the menu and dialogs ask this sidebar copy to do (their own tasks end when
  // they close). From the 500ms timer only, never from render: several of them start tasks
  // (cx.spawn), and one started from render stops at its first await. A start asked for more
  // than 15s ago is dropped, never run late.
  requests(cx) {
    const ask = shared("workspaces.create") ?? null;
    if (ask !== this.asked) {
      this.asked = ask;
      if (ask) cx.spawn(async (cx) => {
        try { await this.create(); }
        catch (e) { notify({ title: "Couldn't make the workspace", body: String(e?.message ?? e), level: "error" }); }
        cx.notify();
      });
    }
    // A scratch folder row's Keep or Don't keep (the menu popup's setKeep()): each name's newest ask, once.
    const keepAsks = shared("workspaces.scratch.keep") ?? {};
    for (const [name, ask] of Object.entries(keepAsks)) {
      if (!ask || ask.at === this.keepSeen[name]) continue;
      this.keepSeen[name] = ask.at;
      if (Date.now() - ask.at < 15000) cx.spawn(async () => { await this.scratch.setKept(`scratch-row/${ask.keep ? "keep" : "unkeep"}/${name}`); });
    }
    const scratchAsk = shared("workspaces.scratch") ?? null;
    if (scratchAsk?.at !== this.scratchAsked) {
      this.scratchAsked = scratchAsk?.at;
      if (scratchAsk && Date.now() - scratchAsk.at < 15000) {
        cx.spawn(async () => {
          try { await this.scratch.create(scratchAsk.name ?? ""); }
          catch (e) { notify({ title: "Couldn't make a scratch space", body: String(e?.message ?? e), level: "error" }); }
        });
      }
    }
    const launchAsk = shared("workspaces.launch") ?? null;
    if (launchAsk?.at !== this.launchAsked) {
      this.launchAsked = launchAsk?.at;
      const preset = launchAsk && Date.now() - launchAsk.at < 15000 && presetsFor(launchAsk.workspace).find((x) => x.name === launchAsk.name);
      if (preset) startPreset(preset, (shared("workspaces.defs") ?? []).find((d) => d.id === launchAsk.workspace), launchAsk.task ?? "");
    }
    const runAsk = shared("workspaces.automation.run") ?? null;
    if (runAsk?.at !== this.runAsked) {
      this.runAsked = runAsk?.at;
      const recent = runAsk && Date.now() - runAsk.at < 15000;
      const a = recent && this.mine() && this.runner?.find(runAsk.workspace, runAsk.name);
      // What Run now's box says: {{text}} (a link automation's input).
      const body = String(runAsk?.text ?? "").trim();
      if (a) this.runner.fire(cx, runAsk.workspace, a, "Started by hand", body ? { text: body, event: body } : {}, { manual: true });
      else if (recent && this.bg.owner) this.pass(cx, "run", `${runAsk.workspace}\n${runAsk.name}\n${Date.now()} hand\n${body}`);
    }
    // An allowed check: this copy's runner reads the request itself; the background one gets a file.
    const allowAsk = shared("workspaces.automation.allow") ?? null;
    if (allowAsk?.at !== this.allowAsked) {
      this.allowAsked = allowAsk?.at;
      if (allowAsk && Date.now() - allowAsk.at < 15000 && this.bg.owner) this.pass(cx, "allow", JSON.stringify({ workspace: allowAsk.workspace, name: allowAsk.name, check: allowAsk.check, script: allowAsk.script }));
    }
    const setAsk = shared("workspaces.runner.set") ?? null;
    if (setAsk?.at !== this.setAsked) {
      this.setAsked = setAsk?.at;
      // { on }: Keep running; { login }: Start at login (which turns it on too). Both: login first.
      if (setAsk && Date.now() - setAsk.at < 15000) cx.spawn(async (cx) => {
        const bin = `${appHome()}/mods/ws-switcher/bin/herdr-ws-runner`;
        const steps = [];
        if (typeof setAsk.login === "boolean") steps.push({ args: ["--login", setAsk.login ? "on" : "off"], what: `Start at login ${setAsk.login ? "on" : "off"}` });
        if (typeof setAsk.on === "boolean" && !(setAsk.on && setAsk.login === true)) steps.push({ args: [setAsk.on ? "--on" : "--off"], what: `the background runner ${setAsk.on ? "on" : "off"}` });
        for (const st of steps) {
          const r = await exec(bin, st.args, { timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
          if (r.code !== 0) { notify({ title: `Couldn't turn ${st.what}`, body: String(r.stderr ?? "").trim().split("\n").pop() || "herdr-ws-runner gave no reason.", level: "error" }); break; }
        }
        this.bg.tries = 0; this.bg.tried = 0; this.bg.failed = false;
        this.loginTask = null;
        this.background(cx);
      });
    }
    const boardAsk = shared("workspaces.board") ?? null;
    if (boardAsk?.at !== this.boardAsked) {
      this.boardAsked = boardAsk?.at;
      if (boardAsk && Date.now() - boardAsk.at < 15000) this.openScreen(boardAsk.id, "board", cx);
    }
    const treesAsk = shared("workspaces.worktrees") ?? null;
    if (treesAsk?.at !== this.treesAsked) {
      this.treesAsked = treesAsk?.at;
      if (treesAsk && Date.now() - treesAsk.at < 15000) this.openScreen(treesAsk.id, "worktrees", cx);
    }
    const historyAsk = shared("workspaces.history") ?? null;
    if (historyAsk?.at !== this.historyAsked) {
      this.historyAsked = historyAsk?.at;
      if (historyAsk && Date.now() - historyAsk.at < 15000) this.openHistory(historyAsk.id ?? null, cx);
    }
    const notesAsk = shared("workspaces.notes") ?? null;
    if (notesAsk?.at !== this.notesAsked) {
      this.notesAsked = notesAsk?.at;
      if (notesAsk?.id && Date.now() - notesAsk.at < 15000) this.openScreen(notesAsk.id, "notes", cx);
    }
    // The tab bar's asks (workspaces.view) have a faster timer of their own: drainViews().
    this.takeTabs();
  }

  // The tab bar's asks: a list, each done once, in order (beside.js drainAsks). On a 100 ms timer of its
  // own (a click on Views or a key shouldn't wait for the 500 ms one); with nothing new it only compares
  // the list's newest id with the one seen last. Never from render (a task started there stops at its
  // first await). Also the beside asks waiting for their tab's split (nextBeside()).
  drainViews(cx) {
    // The menu's fold, drop and group asks (workspaces.arrange): here, so a click never waits half a second.
    const arrangeAsk = shared("workspaces.arrange") ?? null;
    if (arrangeAsk?.at !== this.arrangeAsked) {
      this.arrangeAsked = arrangeAsk?.at;
      if (arrangeAsk && Date.now() - arrangeAsk.at < 15000) this.applyArrange(arrangeAsk, cx);
    }
    // The bell's list's asks and the toasts shown since (notiflog.js).
    this.notif?.drain(cx);
    const queue = shared("workspaces.view");
    const last = Array.isArray(queue) && queue.length ? queue[queue.length - 1]?.id : null;
    if (last !== this.viewLast) {
      this.viewLast = last;
      const views = drainAsks(queue, this.viewSeen, Date.now(), (k) => Boolean(screenOf(k)));
      this.viewSeen = views.seen;
      for (const a of views.run) this.openView(a, cx);
      // Shown now, not on the next draw or 500 ms tick (sync() only places and shows; it starts no task).
      if (views.run.length) this.sync();
    }
    const files = shared("workspaces.files.open");
    const lastFile = Array.isArray(files) && files.length ? files[files.length - 1]?.id : null;
    if (lastFile !== this.filesLast) {
      this.filesLast = lastFile;
      const asks = drainAsks(files, this.filesSeen, Date.now());
      this.filesSeen = asks.seen;
      this.filesWaiting = [...(this.filesWaiting ?? []), ...asks.run.filter((a) => typeof a.path === "string" && a.path)];
    }
    // One at a time: the next once Files took the last target (or it's had 1.5s), so two asks close
    // together both open (there's one target slot). None older than 15s.
    if (this.filesWaiting?.length) {
      const now = Date.now(), cur = shared("workspaces.files.target");
      if (!cur || cur.taken || now - (cur.at ?? 0) > 1500) {
        let a = this.filesWaiting.shift();
        while (a && now - (a.at ?? 0) >= 15000) a = this.filesWaiting.shift();
        if (a) { this.openFiles(a, cx); this.sync(); }
      }
    }
    if (this.besideWaiting?.length) this.nextBeside(cx);
  }

  // A file or folder asked for in Files (shared "workspaces.files.open"), published for the copy that
  // opens it (shared "workspaces.files.target"). In the asker's space and tab while they're there, else
  // the shown ones. Beside the terminal: that tab's Files pane when it has one (focused), else a new
  // one split beside it. Full size on another machine's space (a mod pane can't join a tab there), when
  // asked, or in a space with no tab. With no space at all (an empty workspace), in a dialog.
  openFiles(ask, cx) {
    const all = spaces(), covered = Boolean(shared("workspaces.covered"));
    const space = (ask.space ? all.find((s) => s.id === ask.space) : null) ?? (covered ? null : all.find((s) => s.active) ?? null);
    const at = Date.now(), asked = { id: ask.id, path: ask.path, isDir: Boolean(ask.isDir), line: ask.line ?? null, col: ask.col ?? null, at };
    if (!space) {
      if (ask.isDir) { notify({ title: "Files belongs to a space", body: "Start a space with + first.", level: "info" }); return; }
      openOverlay({ mod: "ws-files", kind: "dialog", modal: true, width: 960, height: 680, props: { file: ask.path, line: ask.line ?? null } });
      return;
    }
    const active = shared("workspaces.active") ?? null;
    const tab = (ask.tab ? (space.tabs ?? []).find((c) => c.id === ask.tab) : null) ?? (space.tabs ?? []).find((c) => c.active) ?? (space.tabs ?? [])[0] ?? null;
    if (ask.placement === "full" || space.machine || !tab) {
      const pins = shared("workspaces.screens.space") ?? {};
      if (!(pins[space.id] ?? []).includes("files")) setShared("workspaces.screens.space", { ...pins, [space.id]: [...(pins[space.id] ?? []), "files"] });
      if (!space.active) run("space.select", { id: space.id });
      // An ask that says where (on: null is this computer, as Settings' guide is) keeps it; else the space's machine.
      setShared("workspaces.files.target", { ...asked, scope: "screen", space: space.id, on: "on" in ask ? ask.on ?? null : space.machine ?? null });
      setShared("workspaces.screen", { ws: active, space: space.id, screen: "files", at });
      return;
    }
    const ps = panes(), open = openIn(shared(LEDGER) ?? {}, ps, tab.id, undefined, "files");
    if (!space.active) run("space.select", { id: space.id });
    if (!tab.active) run("tab.select", { id: tab.id });
    // The tab is shown now, so openBeside() puts the pane there (it goes by the shown tab). The target is
    // published only when a pane is focused or on its way: else no Files pane would take it, and one
    // opened later in that tab would jump to it.
    const placed = this.openBeside({ key: "files", ws: active, space: { ...space, tabs: (space.tabs ?? []).map((c) => ({ ...c, active: c.id === tab.id })) }, move: false }, cx);
    if (placed) setShared("workspaces.files.target", { ...asked, scope: open ? "pane" : "tab", pane: open?.pane ?? null, tab: tab.id, on: null });
  }

  // A view asked for from the tab bar (shared "workspaces.view"): in the shown space and workspace.
  // Full size: shown in place of the tabs with a pill (toggle: back to the tabs when it's the one
  // shown). Beside: as a pane in the shown tab; when it's the one shown full size, that's a move
  // (its pill closes), as it is when asked to (move: the Beside button, a pill's Move beside).
  // A workspace's view needs a workspace (History doesn't: All spaces); a space's view, a space.
  openView(ask, cx) {
    const key = ask.key, v = screenOf(key);
    if (!v || !featureOn(key)) return;
    const active = shared("workspaces.active") ?? null, scr = shared("workspaces.screen") ?? null;
    const space = shared("workspaces.covered") ? null : spaces().find((p) => p.active) ?? null;
    if (v.space && !space) {
      notify({ title: `${v.name} belongs to a space`, body: "Start a space with + first.", level: "info" });
      return;
    }
    if (!v.space && !active && key !== "history") {
      notify({ title: `${v.name} belongs to a workspace`, body: "Choose a workspace in the switcher first.", level: "info" });
      return;
    }
    const shown = Boolean(scr) && scr.screen === key && (v.space ? scr.space === space.id : (scr.ws ?? null) === active);
    if (ask.beside) return this.openBeside({ key, ws: active, space, move: Boolean(ask.move) || shown }, cx);
    if (ask.toggle && shown) { setShared("workspaces.screen", null); return; }
    if (!v.space) return key === "history" ? this.openHistory(active, cx) : this.openScreen(active, key, cx);
    // A space's view: an older layout has no block for it, so it opens beside.
    if (!find(layout(), "screens-body")?.children?.some((c) => c.id === `screen-${key}`)) return this.openBeside({ key, ws: active, space }, cx);
    const all = shared("workspaces.screens.space") ?? {};
    if (!(all[space.id] ?? []).includes(key)) setShared("workspaces.screens.space", { ...all, [space.id]: [...(all[space.id] ?? []), key] });
    setShared("workspaces.screen", { ws: active, space: space.id, screen: key, at: Date.now() });
  }

  // A view as a pane in the shown tab, beside its terminals (beside.js says where). One already a pane
  // in this tab is shown instead of a second (another tab's doesn't count, and the tab doesn't change).
  // A view shown full size gives way, so the pane is seen; move: its pill closes too, once the pane is
  // there. Only in a space of this computer's (a mod pane can't join a tab on another machine) that has
  // a tab. One split per tab at a time: an ask while one is under way waits for it (nextBeside()), so
  // the second view stacks under the first. Returns true when a pane is focused, split or waiting.
  openBeside({ key, ws, space, move = false }, cx) {
    const s = screenOf(key);
    // A key can still ask on another machine's space (the menu has no split icons there): say why not.
    if (s && space?.machine) notify({ title: `${s.name} can't open beside a terminal on another machine`, body: "Open it full size from Views instead.", level: "info" });
    if (!s || !space || space.machine || !(space.tabs ?? []).length || shared("workspaces.covered")) return;
    const tab = space.tabs.find((c) => c.active) ?? space.tabs[0];
    this.besideBusy ??= new Set();
    this.besideWaiting ??= [];
    if (this.besideBusy.has(tab.id)) { this.besideWaiting.push({ key, ws, space: space.id, tab: tab.id, move, at: Date.now() }); return true; }
    const ledger = shared(LEDGER) ?? {}, ps = panes();
    const open = openIn(ledger, ps, tab.id, s.space ? undefined : ws ?? null, key);
    if (open) {
      if (move) this.unpinView(key, ws, space);
      if (shared("workspaces.screen")) setShared("workspaces.screen", null);
      const zoomed = ps.find((p) => p.tab === tab.id && p.zoomed && p.pane !== open.pane);
      if (zoomed) run("pane.zoom", { pane: zoomed.pane }); // on the zoomed pane, it unzooms
      run("pane.focus", { pane: open.pane });
      return true;
    }
    const at = splitAt(ledger, ps, tab.id);
    if (!at) return;
    if (shared("workspaces.screen")) setShared("workspaces.screen", null);
    this.besideBusy.add(tab.id);
    // A zoomed tab shows only its zoomed pane: unzoomed, the new one is seen beside it.
    if (at.zoomed) run("pane.zoom", { pane: at.zoomed });
    cx.spawn(async () => {
      try {
        // run() answers nothing in a mod, so the split goes through herdr-app, which prints the new pane.
        // Keys in alphabetical order: Herdr hands a pane its props back sorted after a restart, and a
        // copy's localStorage goes by its props as given.
        const paneProps = { beside: true, tab: tab.id, view: key, workspace: ws ?? null };
        const r = await exec("herdr-app", ["do", "pane.split", JSON.stringify({ direction: at.direction, pane: at.pane, mod: s.mod, props: paneProps })]);
        const pane = JSON.parse(r.stdout || "{}").pane;
        if (!pane) throw new Error(String(r.stderr ?? "").trim() || "Herdr made no pane");
        setShared(LEDGER, { ...(shared(LEDGER) ?? {}), [pane]: { ws: ws ?? null, screen: key } });
        run("pane.rename", { pane, name: s.name });
        // Moved: the pill closes now the pane is there (a failed split leaves the pill).
        if (move) this.unpinView(key, ws, space);
      } catch (e) {
        notify({ title: `Couldn't open ${s.name} beside the terminals`, body: String(e?.message ?? e), level: "error" });
      }
      this.besideBusy.delete(tab.id);
    });
    return true;
  }

  // The beside asks that waited for their tab's split: each runs once its tab is free, while that tab is
  // still the shown one (else it's dropped: the person has moved on), at most 15s late.
  nextBeside(cx) {
    if (!this.besideWaiting?.length) return;
    const now = Date.now(), waiting = this.besideWaiting;
    this.besideWaiting = [];
    for (const w of waiting) {
      if (now - w.at > 15000) continue;
      if (this.besideBusy?.has(w.tab)) { this.besideWaiting.push(w); continue; }
      const space = shared("workspaces.covered") ? null : spaces().find((p) => p.active && p.id === w.space);
      if (!space || (space.tabs ?? []).find((c) => c.active)?.id !== w.tab) continue;
      this.openBeside({ key: w.key, ws: w.ws, space, move: w.move }, cx);
    }
  }

  // A view's pill closed (its view moved into a pane).
  unpinView(key, ws, space) {
    if (screenOf(key)?.space) {
      const all = shared("workspaces.screens.space") ?? {};
      if ((all[space.id] ?? []).includes(key)) setShared("workspaces.screens.space", { ...all, [space.id]: all[space.id].filter((k) => k !== key) });
    } else {
      const all = shared("workspaces.screens") ?? {}, at = ws ?? ALL;
      if ((all[at] ?? []).includes(key)) setShared("workspaces.screens", { ...all, [at]: all[at].filter((k) => k !== key) });
    }
  }

  // The views opened as panes: closed in every space when the view's add-on is turned off
  // (Settings > Features, or the file); turning it on again reopens nothing. Only on a sure "off": before closing, the file is read here, and a missing,
  // unreadable or broken one closes nothing (shared state says "off" for those too). A pane that's
  // its space's last stays open and leaves the list: this never closes a space. An entry goes
  // when its pane is gone, once this computer's layout is read and it has stayed missing a while
  // (beside.js), never because the panes aren't known yet.
  followBeside(cx) {
    const ledger = shared(LEDGER) ?? {};
    if (!Object.keys(ledger).length) return;
    const ps = panes();
    const here = machines().find((m) => m.name == null);
    const ready = ps.length > 0 && (!here || here.layout === "ready");
    let sure = null;
    if (wantsClose(ledger, ps, shared("workspaces.settings"))) {
      const read = this.besideRead;
      if (read && Date.now() - read.at < 3000) sure = read.settings;
      else if (!this.besideReading) {
        this.besideReading = true;
        cx.spawn(async () => {
          const text = await readTextFile(`${home()}/${SETTINGS_FILE}`).catch(() => null);
          this.besideRead = { settings: trusted(text, text == null ? null : parseSettings(text)), at: Date.now() };
          this.besideReading = false;
        });
      }
    }
    const r = followLedger({
      ledger, panes: ps, spaces: spaces(), sure, ready, now: Date.now(),
      missing: this.besideMissing ?? {}, closing: this.besideClosing ?? {},
    });
    this.besideMissing = r.missing;
    this.besideClosing = r.closing;
    if (r.ledger) setShared(LEDGER, r.ledger);
    for (const pane of r.close) run("pane.close", { pane });
  }

  // The menu's drag, fold or group change: shown at once, then written to .order.json
  // and each changed workspace.jsonc. The folder watch reads them back afterwards.
  applyArrange(ask, cx) {
    const saved = { order: [], folded: [], ...(shared("workspaces.order") ?? {}) };
    if (ask.order) saved.order = ask.order;
    if (ask.folded) saved.folded = ask.folded;
    if ("scratchFolded" in ask) saved.scratchFolded = Boolean(ask.scratchFolded);
    saved.scratchFolded = Boolean(saved.scratchFolded);
    const groups = ask.groups ?? {};
    const was = shared("workspaces.defs") ?? [];
    const defs = was.map((d) => (d.id in groups ? { ...d, group: groups[d.id] } : d));
    setShared("workspaces.order", saved);
    setShared("workspaces.defs", arrange(defs, saved).flatMap((it) => (it.group ? it.members : [it.ws])));
    this.arranging = (this.arranging ?? 0) + 1;
    this.arrangeGen = (this.arrangeGen ?? 0) + 1;
    cx.spawn(async (cx) => {
      try {
        for (const [id, group] of Object.entries(groups)) {
          const d = was.find((x) => x.id === id);
          if (!d || d.error) continue;
          const file = `${d.dir}/workspace.jsonc`;
          const old = await readTextFile(file);
          if (old === null) continue;
          const text = withGroup(old, group);
          if (text !== old) await writeTextFile(file, text, old);
        }
        const old = await readTextFile(orderFile());
        const text = orderText(saved);
        if (old !== text) await writeTextFile(orderFile(), text, old);
      } catch (e) {
        notify({ title: "Couldn't save the workspaces' order", body: String(e?.message ?? e), level: "error" });
      }
      this.arranging--;
      this.arrangeGen++;
      this.reload(cx);
    });
  }

  // A Board or Worktrees tab from before they were the workspace's own (or made by
  // hand): it becomes the workspace's screen and the tab closes. Only a tab that
  // holds nothing else, in a space that has other tabs.
  takeTabs() {
    if (!this.loaded || !find(layout(), "screens-body")) return;
    const assigned = shared("workspaces.assigned") ?? {}, defs = shared("workspaces.defs") ?? [];
    const ps = panes();
    this.taken ??= new Set();
    // Views opened as panes stay where they are, even left alone in their tab.
    const beside = shared(LEDGER) ?? {};
    for (const p of ps) {
      const key = Object.keys(SCREENS).find((k) => SCREENS[k].mod === p.mod && !SCREENS[k].space);
      if (!key || !featureOn(key) || p.terminal || this.taken.has(p.pane) || beside[p.pane]) continue;
      const space = spaces().find((s) => (s.tabs ?? []).some((c) => c.id === p.tab));
      const ws = space && !space.machine ? assigned[space.id] : null;
      if (!ws || !defs.some((d) => d.id === ws) || space.tabs.length < 2 || ps.filter((x) => x.tab === p.tab).length !== 1) continue;
      this.taken.add(p.pane);
      const front = space.active && space.tabs.find((c) => c.id === p.tab)?.active && shared("workspaces.active") === ws;
      this.pin(ws, key);
      run("tab.close", { id: p.tab, confirmed: true });
      if (front) setShared("workspaces.screen", { ws, screen: key, at: Date.now() });
    }
  }

  // The key's way in ("ws-switcher.board" and the like): the shown workspace's view, and back to the
  // tabs from it. Off in Settings > Features: nothing (no toast), here and in openScreen() and openHistory().
  toggleScreen(key, cx) {
    this.openView({ key, toggle: true }, cx);
  }

  // History is the one workspace view that also works with no workspace chosen (All spaces): full
  // size, every conversation, its pill kept under "*". An older layout with no block for it: a dialog.
  openHistory(id, cx) {
    if (!featureOn("history")) return;
    // A workspace's (one not known, or not known yet: nothing, as openScreen does; never All spaces).
    if (id) return this.openScreen(id, "history", cx);
    if (!find(layout(), "screens-body")?.children?.some((c) => c.id === "screen-history")) {
      openOverlay({ mod: "ws-history", kind: "dialog", width: 980, height: 700, props: { dialog: true } });
      return;
    }
    if (shared("workspaces.active")) choose(null);
    this.pin(ALL, "history");
    setShared("workspaces.screen", { ws: null, screen: "history", at: Date.now() });
  }

  // "show/<screen>/<workspace>": that workspace's screen, never back to the tabs.
  // "show/board/<workspace>/<card>": its board, with that card open (ws-board takes "workspaces.board.open").
  showScreen(c, cx) {
    const [, key, ws, card] = c.split("/");
    const plain = (v) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(v ?? ""));
    if (!screenOf(key) || screenOf(key).space || !plain(ws)) return;
    if (!(shared("workspaces.defs") ?? []).some((d) => d.id === ws)) return;
    this.openScreen(ws, key, cx);
    if (key === "board" && plain(card) && featureOn("board")) setShared("workspaces.board.open", { ws, taskId: card, at: Date.now() });
  }

  pin(ws, key) {
    const all = shared("workspaces.screens") ?? {};
    if (!(all[ws] ?? []).includes(key)) setShared("workspaces.screens", { ...all, [ws]: [...(all[ws] ?? []), key] });
  }

  // Shows one of a workspace's screens (its board, its worktrees) in place of the
  // tabs, and pins it in the tab bar of every space of the workspace. With an older
  // copy of the layout, which has no place for screens, it's a tab in one space.
  openScreen(id, key, cx) {
    if (!featureOn(key)) return;
    if (!screenOf(key)) return;
    if (!find(layout(), "screens-body")?.children?.some((c) => c.id === `screen-${key}`)) return this.openBoard(id, cx, screenOf(key));
    if (!(shared("workspaces.defs") ?? []).some((d) => d.id === id)) return;
    this.pin(id, key);
    if (shared("workspaces.active") !== id) choose(id);
    setShared("workspaces.screen", { ws: id, screen: key, at: Date.now() });
  }

  // A request for the background runner: a file in the inbox it reads.
  pass(cx, kind, text) {
    cx.spawn(async () => {
      try { await writeTextFile(`${dir()}/.inbox/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${kind}`, text, null); }
      catch (e) { notify({ title: "Couldn't reach the background runner", body: String(e?.message ?? e), level: "error" }); }
    });
  }

  // The older way, for a layout without the `screens` column: the workspace's board
  // tab, the one already open in one of its spaces, else a new one in the shown space
  // (if it's in the workspace), its first space, or a new space in its root.
  // `screen`: another tab of the workspace's, the same way.
  openBoard(id, cx, screen = { mod: "ws-board", name: "Board" }) {
    const def = (shared("workspaces.defs") ?? []).find((d) => d.id === id);
    if (!def) return;
    const assigned = shared("workspaces.assigned") ?? {};
    const sp = spaces();
    const spaceOfTab = (tab) => sp.find((s) => (s.tabs ?? []).some((c) => c.id === tab));
    const open = panes().find((p) => p.mod === screen.mod && assigned[spaceOfTab(p.tab)?.id] === id);
    if (open) {
      run("space.select", { id: spaceOfTab(open.tab).id });
      run("tab.select", { id: open.tab });
      return;
    }
    cx.spawn(async (cx) => {
      try {
        const mine = sp.filter((s) => assigned[s.id] === id);
        let space = (mine.find((s) => s.active) ?? mine[0])?.id;
        if (!space) {
          const r = await exec("herdr-app", ["do", "space.new", JSON.stringify({ folder: def.root })]);
          space = JSON.parse(r.stdout).space;
          if (!space) throw new Error(r.stderr.trim() || "couldn't make a space");
        }
        run("space.select", { id: space });
        run("tab.new", { space, name: screen.name, mod: screen.mod, props: { workspace: id } });
      } catch (e) {
        notify({ title: `Couldn't open the ${def.name} ${screen.name.toLowerCase()}`, body: String(e?.message ?? e), level: "error" });
      }
      cx.notify();
    });
  }

  menu(t) {
    const defs = shared("workspaces.defs") ?? [];
    const active = defs.find((d) => d.id === shared("workspaces.active")) ?? null;
    const assigned = shared("workspaces.assigned") ?? {};
    const sp = spaces(), ps = panes();
    // While the workspace has no space, Herdr's active one is another workspace's, under the empty block: not offered.
    const shown = shared("workspaces.covered") ? null : sp.find((s) => s.active) ?? null;
    let height = 10; // the menu's padding; each part adds its own
    const icon = (name) => svg(`mods/workspace-chrome/${name}.svg`).size(14).flex_none().text_color(t.muted);
    const hint = (...kids) => h_flex().flex_none().gap(8).items_center().text_size(11).text_color(t.dim).children(kids);
    const check = (on) => (on ? svg("mods/workspace-chrome/check.svg").size(13).text_color(t.accent) : div().w(13));
    const head = (text) => { height += 26; return div().h(26).px(8).pt(9).flex_none().text_size(11).text_color(t.dim).child(text); };
    const line = () => { height += 9; return div().h(1).mx(4).my(4).flex_none().bg(t.border); };
    const row = (id, lead, label, tail, action, { dim = false, tip = null, keep = false, danger = false } = {}) => {
      height += 30;
      return h_flex().id(id).h(30).px(8).gap(9).rounded(7).items_center().flex_none().cursor_pointer()
        .text_color(danger ? t.blocked : dim ? t.dim : t.foreground).hover((s) => s.bg(t.selected))
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .on_click((_e, cx) => { if (!keep) closeOverlay(props().overlay); action(cx); })
        .child(lead).child(div().flex_1().min_w(0).truncate().child(label)).child(tail);
    };
    const frame = (items) => v_flex().id("ws-menu").track_focus(this.handle).on_key_down((e) => this.key(e, defs))
      // In a submenu (Move to, a workspace's own menu and its group, a group's own, a scratch folder's),
      // Herdr's Esc (overlay.close) goes back a level, as ‹ Back does; at the menu's top level Herdr closes it.
      .when(this.inSubmenu(), (el) => el.on_action("overlay.close", (_e, cx) => { cx.stop_propagation(); this.goBack(cx); }))
      .w_full().h(Math.min(600, height)).p(5).bg(t.popover).text_size(12.8).overflow_y_scrollbar()
      .on_mouse_up("left", (_e, cx) => { if (this.dragFrom) { this.dragFrom = this.dragOver = null; cx.notify(); } })
      .children(items);

    // A submenu whose space, workspace, group or folder went away is gone: its flag goes too, so Esc and the
    // digit keys work on the main menu at once.
    if (this.moving && !shown) this.moving = false;
    if (this.wsMenu && !defs.some((d) => d.id === this.wsMenu)) this.wsMenu = null;
    if (this.grouping && !defs.some((d) => d.id === this.grouping && !d.scratch && !d.error)) this.grouping = null;
    if (this.folderMenu && !(shared("workspaces.scratch.folders") ?? []).includes(this.folderMenu)) this.folderMenu = null;
    if (this.renaming && !arrange(defs, shared("workspaces.order") ?? {}).some((it) => it.group === this.renaming)) this.renaming = null;
    // Every submenu starts with ‹ Back (D3-6): one level up, as Esc.
    const back = () => [row("ws-back", svg("mods/workspace-chrome/chevron-left.svg").size(14).flex_none().text_color(t.muted),
      div().text_color(t.muted).child("Back"), div(), (cx) => this.goBack(cx), { keep: true }), line()];
    const askFor = (dialog, height, id) => openOverlay({ mod: "ws-switcher", kind: "dialog", modal: true, width: 420, height, props: { dialog, id } });
    const trashIcon = () => svg("mods/workspace-chrome/archive.svg").size(14).flex_none().text_color(t.blocked);

    // "Move to…": where the shown space goes. Its new workspace is then shown.
    if (this.moving && shown) {
      const owner = assigned[shown.id];
      const move = (to) => {
        setShared("workspaces.assigned", { ...(shared("workspaces.assigned") ?? {}), [shown.id]: to });
        setShared("workspaces.active", to || null);
      };
      return frame([...back(), head(`Move “${shown.name}” to`),
        ...defs.map((d) => row(`ws-to-def-${d.id}`, mark(d, defs, t, 18), d.name, hint(check(owner === d.id)), () => move(d.id))),
        line(),
        row("ws-to-none", mark(null, defs, t, 18), "No workspace", hint(check(!owner)), () => move(false),
          { tip: "Shows only under All spaces, and doesn't join a workspace by its folder" })]);
    }

    // A workspace's group (its right-click, or "Put … in a group…"): the groups there
    // are, none, or a new one typed in the box. A group's header, right-clicked: its
    // new name in the box, or Ungroup.
    const tree = arrange(defs, shared("workspaces.order") ?? {});
    const groupNames = tree.filter((it) => it.group).map((it) => it.group);
    const box = (input, note) => {
      height += note ? 62 : 44;
      return v_flex().px(4).pt(6).pb(4).gap(5).flex_none()
        .child(Input.new(input).h(32).px(9).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
        .when(Boolean(note), (el) => el.child(div().px(4).text_size(11).text_color(t.dim).child(note)));
    };
    const picking = this.grouping ? defs.find((d) => d.id === this.grouping && !d.scratch && !d.error) : null;
    if (picking) {
      const now = groupOf(picking);
      return frame([...back(), head(`Group for “${picking.name}”`),
        ...groupNames.map((n) => row(`ws-grp-${n}`, icon("layers"), n, hint(check(now === n)), () => this.setGroup(picking.id, n))),
        row("ws-grp-none", div().w(14).flex_none(), "No group", hint(check(!now)), () => this.setGroup(picking.id, null)),
        line(),
        box(this.newGroupIn, null)]);
    }
    const editing = this.renaming ? tree.find((it) => it.group === this.renaming) : null;
    if (editing) {
      const n = editing.members.length;
      return frame([...back(), head(`The “${editing.group}” group`),
        box(this.renameIn, "Enter renames it."),
        line(),
        row("ws-grp-ungroup", icon("layers"), "Ungroup", hint(`${n} ${n === 1 ? "workspace" : "workspaces"}`), () => this.ungroup(editing),
          { tip: "Its workspaces stay where they are in the list, without a group" })]);
    }

    // A workspace's own menu (D3-5): its row right-clicked, or Scratch's header. What the actions below do
    // for the shown one, for this one; no group for Scratch or a workspace whose file doesn't parse.
    const owner = this.wsMenu ? defs.find((d) => d.id === this.wsMenu) : null;
    if (owner) {
      const now = groupOf(owner);
      return frame([...back(), head(owner.name),
        row("ws-m-rename", icon("square-pen"), `Rename ${owner.name}…`, div(), () => askFor("rename", 236, owner.id)),
        row("ws-m-files", icon("file-text"), `Open ${owner.name}'s files`, div(), () => openFolder(owner.dir), { tip: tilde(owner.dir) }),
        ...(owner.scratch || owner.error ? [] : [row("ws-m-group", icon("layers"), now ? `Change ${owner.name}'s group…` : `Put ${owner.name} in a group…`, hint(now ?? "", "›"),
          (cx) => { this.grouping = owner.id; this.newGroupIn.set_value(""); this.newGroupIn.focus(); cx.notify(); },
          { keep: true, tip: "Workspaces in the same group sit together in this list, under a header that folds" })]),
        line(),
        row("ws-m-delete", trashIcon(), `Delete ${owner.name}…`, div(), () => askFor("delete", owner.scratch ? 256 : 226, owner.id), { danger: true })]);
    }
    // A scratch folder's menu (D4, its row right-clicked): Open, Keep or Don't keep, Move to Trash….
    const fm = this.folderMenu;
    if (fm) {
      const st = (shared("workspaces.scratch.state") ?? {})[fm];
      const name = scratchLabel(fm);
      return frame([...back(), head(name ?? base(fm)),
        row("ws-f-open", icon("folder"), "Open", div(), () => run("space.new", { folder: fm, ...(name ? { name } : {}) }), { tip: tilde(fm) }),
        ...(st?.kept || isFinite(Number(st?.trashAt)) ? [switcherAway()
          ? row("ws-f-keep", div().w(14).flex_none(), st.kept ? "Don't keep" : "Keep", hint("Show the sidebar to do this"), () => {}, { dim: true, keep: true })
          : row("ws-f-keep", div().w(14).flex_none(), st.kept ? "Don't keep" : "Keep", div(), () => this.setKeep(fm, !st.kept),
            { tip: st.kept ? `Takes its .keep out: it goes to the ${trashName()} after 7 days unused` : "Writes a .keep file in it: it stays until you delete it" })] : []),
        line(),
        row("ws-f-trash", trashIcon(), `Move to ${trashName()}…`, div(),
          () => openOverlay({ mod: "ws-switcher", kind: "dialog", modal: true, width: 420, height: 200, props: { dialog: "scratch-trash", folder: fm } }), { danger: true })]);
    }

    // Making a workspace comes first, above the list it adds to. A scratch space is made
    // from the + on the Scratch group's header, below.
    const items = [row("ws-new", icon("folder-plus"), "New workspace from a folder…", div(), () => setShared("workspaces.create", Date.now())),
      line(), head("Workspaces"),
      row("ws-all", mark(null, defs, t, 18), "All spaces", hint(String(sp.length), check(!active)), () => choose(null))];
    // The workspaces as arrange.js has them: each group under a header that folds (a
    // folded one still shows the workspace you're in), then Scratch as a group of its
    // scratch spaces and kept folders, with a + for a new one. A row can be dragged:
    // a workspace dropped on a workspace goes above or below it, in its group; on a
    // header's lower part it goes into that group; a header moves its whole group.
    // Right-click a workspace (or Scratch's header) for its own menu, a group's header to rename or ungroup
    // it, a scratch folder for Open, Keep and Move to Trash.
    const rows = this.rowsOf(tree, active);
    const drop = this.dropAt(rows);
    // Pressed, then let go on the same row: a click. On another: a drop there.
    const moving = (r) => this.dragOver && this.dragOver !== this.dragFrom && !r.kind.startsWith("scratch")
      && (this.dragFrom === r.key || (r.group && this.dragFrom === `g:${r.group}`));
    const drag = (el, r, click, menu) => el.relative()
      .when(moving(r), (el) => el.opacity(0.5))
      .when(drop?.key === r.key, (el) => el.child(drop.edge === "into"
        ? div().absolute().top(0).bottom(0).left(0).right(0).rounded(7).border_1().border_color(t.accent)
        : div().absolute().left(6).right(6).h(2).rounded_full().bg(t.accent).when(drop.edge === "top", (l) => l.top(-1)).when(drop.edge === "bottom", (l) => l.bottom(-1))))
      .on_mouse_down("left", () => { this.dragFrom = r.key; this.dragOver = r.key; this.dragY = 0.5; })
      .on_mouse_move((e, cx) => {
        if (!this.dragFrom) return;
        const y = e.bounds?.height ? e.local_position.y / e.bounds.height : 0.5;
        if (this.dragOver !== r.key || Math.abs(y - this.dragY) > 0.05) { this.dragOver = r.key; this.dragY = y; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.dragFrom;
        if (from === r.key) { this.dragFrom = this.dragOver = null; click(cx); return; }
        if (from && drop) this.dropped(rows, drop);
        this.dragFrom = this.dragOver = null;
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => { this.dragFrom = this.dragOver = null; menu(cx); });
    for (const r of rows) {
      if (r.kind === "scratch") {
        // Its + makes a scratch space (the dialog asks the name); it doesn't fold or drag.
        height += 28;
        const status = r.shut ? urgent(r.open) : null;
        const plus = div().id("ws-scratch-new").size(22).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("New scratch space: name an idea that belongs to no project, and it gets a space in a new empty folder. Deleted when you close it empty; with files, kept 7 days unless you keep it.")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => { closeOverlay(props().overlay); askScratch(); })
          .child(svg("mods/workspace-chrome/plus.svg").size(13));
        items.push(drag(h_flex().id("ws-scratch-head").h(28).pl(8).pr(2).gap(6).rounded(7).items_center().flex_none().cursor_pointer()
          .hover((s) => s.bg(t.selected)).tooltip(`${r.shut ? "Click to open" : "Click to fold"}${r.def ? "; right-click for more" : ""}`)
          .child(svg(`mods/workspace-chrome/chevron-${r.shut ? "right" : "down"}.svg`).size(10).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.muted).child(r.def?.name ?? "Scratch"))
          .child(hint(status ? div().size(6).rounded_full().bg(t[status]) : div(), r.shut && r.open.length ? String(r.open.length) : ""))
          .child(plus),
          r, () => this.foldScratch(), (cx) => { if (r.def) { this.wsMenu = r.def.id; this.handle.focus(); cx.notify(); } }));
        continue;
      }
      if (r.kind === "scratch-space") {
        // An open scratch space: shown like the Spaces list's row; a click goes there.
        height += 30;
        const s = r.space;
        const c = (shared("space.colors") ?? {})[s.id] ?? "ansi6";
        const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
        const status = urgent([s]);
        items.push(drag(h_flex().id(`ws-scratch-${s.id}`).h(30).pl(24).pr(8).gap(9).rounded(7).items_center().flex_none().cursor_pointer()
          .text_color(t.foreground).hover((x) => x.bg(t.selected)).tooltip(tilde(placeOf(s, ps)))
          .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10).font_bold().text_color("#ffffff").child([...s.name][0]?.toUpperCase() ?? "?"))
          .child(div().flex_1().min_w(0).truncate().child(s.name))
          .child(hint(status ? div().size(6).rounded_full().bg(t[status]) : div(), check(Boolean(active?.scratch && s.active)))),
          r, () => { closeOverlay(props().overlay); if (shared("workspaces.screen")) setShared("workspaces.screen", null); run("space.select", { id: s.id }); }, () => {}));
        continue;
      }
      if (r.kind === "scratch-folder") {
        // A folder whose space was closed with files in it: it says whether it's kept or how long it
        // has before the Trash (the tooltip: on which day). A click opens it again.
        height += 30;
        const name = scratchLabel(r.folder);
        const st = (shared("workspaces.scratch.state") ?? {})[r.folder];
        const when = scratchWhen(st, Date.now(), trashName());
        // On hover, after the words, a small Keep (on its way to the Trash) or Don't keep (kept) (D4-a). Pressed,
        // it stays at 0.45 until the shared state says the folder changed (10 s at most).
        const pending = this.keeping?.[r.folder];
        if (pending && !keepPending(pending, Boolean(st?.kept), Date.now())) delete this.keeping[r.folder];
        const canKeep = Boolean(st?.kept) || isFinite(Number(st?.trashAt));
        // Nobody would do it (the switcher isn't running): on hover the away line takes the tail words' place,
        // with no button, so the name keeps its room (COMMON's "The switcher says it's there").
        const awayHere = canKeep && switcherAway() && this.overFolder === r.folder;
        const keepBtn = !awayHere && canKeep && (this.overFolder === r.folder || this.keeping?.[r.folder])
          ? h_flex().id(`ws-scratch-keep-${r.folder}`).h(24).px(9).flex_none().items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
            .text_size(11.5).text_color(st?.kept ? t.muted : t.foreground).cursor_pointer().hover((x) => x.bg(t.hover))
            .when(Boolean(this.keeping?.[r.folder]), (el) => el.opacity(0.45))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { if (!this.keeping?.[r.folder]) this.setKeep(r.folder, !st?.kept, cx); })
            .child(st?.kept ? "Don't keep" : "Keep")
          : null;
        items.push(drag(h_flex().id(`ws-scratch-f-${r.folder}`).h(30).pl(24).pr(keepBtn ? 3 : 8).gap(9).rounded(7).items_center().flex_none().cursor_pointer()
          .text_color(t.muted).hover((x) => x.bg(t.selected)).tooltip(`${tilde(r.folder)}: ${when.tip}`)
          .on_hover((on, cx) => { if (on) this.overFolder = r.folder; else if (this.overFolder === r.folder) this.overFolder = null; cx.notify(); })
          .child(div().w(18).flex_none().flex().justify_center().child(icon("folder")))
          .child(div().flex_1().min_w(0).truncate().child(name ?? base(r.folder)))
          .child(awayHere ? div().flex_none().text_size(11.5).text_color(t.muted).child("Show the sidebar to do this") : hint(when.tail || "Open"))
          .when(Boolean(keepBtn), (el) => el.child(keepBtn)),
          r, () => { closeOverlay(props().overlay); run("space.new", { folder: r.folder, ...(name ? { name } : {}) }); },
          (cx) => { this.folderMenu = r.folder; this.handle.focus(); cx.notify(); }));
        continue;
      }
      if (r.kind === "scratch-none") {
        height += 30;
        items.push(div().h(30).pl(51).flex().items_center().flex_none().text_size(12).text_color(t.dim).child("No scratch spaces yet"));
        continue;
      }
      if (r.kind === "group") {
        height += 28;
        const members = new Set(r.item.members.map((d) => d.id));
        const mine = sp.filter((s) => members.has(assigned[s.id]));
        const status = r.shut ? urgent(mine) : null;
        items.push(drag(h_flex().id(`ws-group-${r.name}`).h(28).px(8).gap(6).rounded(7).items_center().flex_none().cursor_pointer()
          .hover((s) => s.bg(t.selected)).tooltip(`${r.shut ? "Click to open" : "Click to fold"}. Drag to move the group; right-click to rename or ungroup it.`)
          .child(svg(`mods/workspace-chrome/chevron-${r.shut ? "right" : "down"}.svg`).size(10).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.muted).child(r.name))
          .child(hint(status ? div().size(6).rounded_full().bg(t[status]) : div(), r.shut ? String(mine.length) : "", div().w(13))),
          r, () => this.fold(r.name),
          (cx) => { this.renaming = r.name; this.renameIn.set_value(r.name); this.renameIn.set_selected_range({ start: 0, end: r.name.length }); this.renameIn.focus(); cx.notify(); }));
        continue;
      }
      const d = r.def;
      const mine = sp.filter((s) => assigned[s.id] === d.id);
      const status = urgent(mine);
      height += 30;
      items.push(drag(h_flex().id(`ws-def-${d.id}`).h(30).px(8).when(Boolean(r.group), (el) => el.pl(24)).gap(9).rounded(7).items_center().flex_none().cursor_pointer()
        .text_color(d.error ? t.dim : t.foreground).hover((s) => s.bg(t.selected))
        .tooltip(d.error ? `workspace.jsonc: ${d.error} · right-click for more` : `${tilde(d.root)} · drag to reorder, right-click for more`)
        .child(mark(d, defs, t, 18)).child(div().flex_1().min_w(0).truncate().child(d.name))
        .child(hint(status ? div().size(6).rounded_full().bg(t[status]) : div(), String(mine.length), check(active?.id === d.id))),
        r, () => { closeOverlay(props().overlay); choose(d.id); },
        (cx) => { this.wsMenu = d.id; this.handle.focus(); cx.notify(); }));
    }

    // The actions before the folders: a workspace can have many folders.
    items.push(line());
    // The workspace's views (Board, Notes, Worktrees, History) open from the tab bar's Views menu.
    if (shown && defs.length) {
      items.push(row("ws-move", icon("layers"), `Move “${shown.name}” to…`, hint("›"),
        (cx) => { this.moving = true; cx.notify(); }, { keep: true }));
    }
    const target = active?.dir ?? dir();
    items.push(row("ws-edit", icon("file-text"), active ? `Open ${active.name}'s files` : "Open the workspaces folder", div(),
      () => openFolder(target), { tip: tilde(target) }));
    if (active) {
      const ask = (dialog, height) => askFor(dialog, height, active.id);
      items.push(row("ws-rename", icon("square-pen"), `Rename ${active.name}…`, div(), () => ask("rename", 236)));
      if (!active.scratch && !active.error) {
        const now = groupOf(active);
        items.push(row("ws-group", icon("layers"), now ? `Change ${active.name}'s group…` : `Put ${active.name} in a group…`, hint(now ?? "", "›"),
          (cx) => { this.grouping = active.id; this.newGroupIn.set_value(""); this.newGroupIn.focus(); cx.notify(); },
          { keep: true, tip: "Workspaces in the same group sit together in this list, under a header that folds" }));
      }
      items.push(row("ws-delete", trashIcon(), `Delete ${active.name}…`, div(),
        () => ask("delete", active.scratch ? 256 : 226), { danger: true }));
    }

    // Scratch's folders are in its group above.
    if (active && !active.error && !active.scratch) {
      const folders = active.folders.length ? active.folders : active.children.map((c) => `${active.root}/${c}`);
      if (folders.length) items.push(line(), head(`${active.name} folders`));
      for (const f of folders) {
        const there = sp.find((s) => !s.machine && inFolder(active, placeOf(s, ps), f));
        items.push(row(`ws-folder-${f}`, icon("folder"), base(f), hint(there ? "Go" : "Open"),
          () => run(there ? "space.select" : "space.new", there ? { id: there.id } : { folder: f }), { tip: tilde(f) }));
      }
    }

    return frame(items);
  }

  // The menu's workspace rows, top to bottom: { key, kind, top: its item's index in the
  // tree, … }. "ws" (def, group: the one it's in) and "group" (name, item, shut), then
  // Scratch's: "scratch" (its header: def, null when it's gone; shut; open), its open
  // spaces ("scratch-space", in Herdr's order), the folders kept with files but no space
  // ("scratch-folder", newest first) or "scratch-none". The header is there even with
  // Scratch gone: its + brings it back.
  rowsOf(tree, active) {
    const saved = shared("workspaces.order") ?? {};
    const folded = new Set(saved.folded ?? []);
    const rows = [];
    let scratch = null;
    tree.forEach((it, top) => {
      if (it.pinned) { scratch = it.ws; return; }
      if (!it.group) { rows.push({ key: `w:${it.ws.id}`, kind: "ws", def: it.ws, top }); return; }
      const shut = folded.has(it.group);
      rows.push({ key: `g:${it.group}`, kind: "group", name: it.group, item: it, top, shut });
      for (const d of it.members) if (!shut || d.id === active?.id) rows.push({ key: `w:${d.id}`, kind: "ws", def: d, group: it.group, top });
    });
    const top = tree.length, shut = Boolean(saved.scratchFolded);
    const assigned = shared("workspaces.assigned") ?? {}, ps = panes();
    const open = scratch && !scratch.error ? spaces().filter((s) => assigned[s.id] === scratch.id) : [];
    const folders = scratch && !scratch.error ? (shared("workspaces.scratch.folders") ?? scratch.children.map((c) => `${scratch.root}/${c}`)) : [];
    const kept = folders.filter((f) => !open.some((s) => !s.machine && inFolder(scratch, placeOf(s, ps), f)));
    rows.push({ key: "s:", kind: "scratch", def: scratch, top, shut, open });
    for (const s of open) if (!shut || (active?.scratch && s.active)) rows.push({ key: `s:${s.id}`, kind: "scratch-space", space: s, top });
    if (!shut) for (const f of kept) rows.push({ key: `f:${f}`, kind: "scratch-folder", folder: f, top });
    if (!shut && !open.length && !kept.length) rows.push({ key: "s:none", kind: "scratch-none", top });
    return rows;
  }

  // Whether the menu shows a submenu (Esc and ‹ Back go up a level).
  inSubmenu() { return Boolean(this.moving || this.grouping || this.renaming || this.wsMenu || this.folderMenu); }

  // ‹ Back, or Esc in a submenu: a workspace's group opened from its own menu goes back to that menu;
  // anything else to the main menu.
  goBack(cx) {
    if (this.grouping && this.wsMenu) this.grouping = null;
    else { this.moving = false; this.grouping = null; this.renaming = null; this.wsMenu = null; this.folderMenu = null; }
    this.handle.focus();
    cx.notify();
  }

  // A scratch folder kept or let go from its row (the sidebar copy writes or takes out .keep).
  // Asked through shared state, not a mod command: Herdr refuses one while the sidebar is hidden, even
  // with the sidebar copy still running. Its look stays pressed at least 500 ms, so the second click
  // of a double-click can't land on the opposite button.
  setKeep(folder, keep, cx) {
    const at = Date.now();
    this.keeping = { ...(this.keeping ?? {}), [folder]: { keep, at } };
    const name = base(folder);
    const asks = Object.fromEntries(Object.entries(shared("workspaces.scratch.keep") ?? {}).filter(([, v]) => at - Number(v?.at) < 60000));
    setShared("workspaces.scratch.keep", { ...asks, [name]: { keep, at } });
    cx?.timer?.after(600, (cx) => cx.notify());
    cx?.notify();
  }

  // The Scratch header clicked: its group folded, or open again.
  foldScratch() {
    setShared("workspaces.arrange", { scratchFolded: !shared("workspaces.order")?.scratchFolded, at: Date.now() });
  }

  // Where the row being dragged would land: the row and edge to mark, and the move for
  // arrange.js. On a workspace: above it in its upper half, below in its lower; on a
  // header, a workspace goes above the group in its top third, else into it; a group
  // goes above or below a whole item. The Scratch row means the end.
  dropAt(rows) {
    const from = rows.find((r) => r.key === this.dragFrom), over = rows.find((r) => r.key === this.dragOver);
    if (!from || !over || from === over || from.kind.startsWith("scratch")) return null;
    const upper = (this.dragY ?? 0.5) < 0.5;
    const src = from.kind === "group" ? { kind: "group", name: from.name } : { kind: "ws", id: from.def.id };
    if (over.kind.startsWith("scratch")) return { key: "s:", edge: "top", src, to: { kind: "end" } };
    if (from.kind === "ws") {
      if (over.kind === "group") {
        if ((this.dragY ?? 0.5) >= 0.34) return { key: over.key, edge: "into", src, to: { kind: "group", name: over.name } };
        return { key: over.key, edge: "top", src, to: { kind: "before", name: over.name } };
      }
      return { key: over.key, edge: upper ? "top" : "bottom", src, to: { kind: "ws", id: over.def.id }, after: !upper };
    }
    if (over.top === from.top) return null;
    const span = rows.filter((r) => r.top === over.top);
    const first = span[0] === over, last = span[span.length - 1] === over;
    const down = rows.indexOf(from) < rows.indexOf(over);
    const after = first && last ? !upper : first ? (upper ? false : down) : last ? (upper ? down : true) : down;
    const to = over.kind === "group" ? { kind: "group", name: over.name } : over.group ? { kind: "group", name: over.group } : { kind: "ws", id: over.def.id };
    return { key: (after ? span[span.length - 1] : span[0]).key, edge: after ? "bottom" : "top", src, to, after };
  }

  // A drop: the new order (and the workspace's new group) to the sidebar copy.
  dropped(rows, drop) {
    const tree = arrange(shared("workspaces.defs") ?? [], shared("workspaces.order") ?? {});
    const r = moveRow(tree, drop.src, drop.to, drop.after);
    if (!r) return;
    setShared("workspaces.arrange", { order: r.order, ...(r.group !== undefined ? { groups: { [drop.src.id]: r.group } } : {}), at: Date.now() });
  }

  // A group's header clicked: folded, or open again.
  fold(name) {
    const folded = new Set(shared("workspaces.order")?.folded ?? []);
    if (folded.has(name)) folded.delete(name); else folded.add(name);
    setShared("workspaces.arrange", { folded: [...folded], at: Date.now() });
  }

  // A workspace's group set from its submenu (null: none). Its place in the list stays.
  setGroup(id, group) {
    const defs = (shared("workspaces.defs") ?? []).map((d) => (d.id === id ? { ...d, group } : d));
    const saved = shared("workspaces.order") ?? {};
    const order = arrange(defs, saved).filter((it) => !it.pinned)
      .flatMap((it) => (it.group ? [{ group: it.group }, ...it.members.map((d) => d.id)] : [it.ws.id]));
    setShared("workspaces.arrange", { order, groups: { [id]: group }, at: Date.now() });
  }

  // Enter in a submenu's box: the new group for the workspace, or the group's new name.
  groupTyped(text, cx) {
    const defs = shared("workspaces.defs") ?? [];
    const names = [...new Set(defs.map(groupOf).filter(Boolean))];
    if (this.grouping) {
      const name = groupName(text, names);
      if (!name) return;
      closeOverlay(props().overlay);
      this.setGroup(this.grouping, name);
    } else if (this.renaming) {
      const from = this.renaming, to = groupName(text, names.filter((n) => n !== from));
      closeOverlay(props().overlay);
      if (!to || to === from) return;
      const saved = renamed(shared("workspaces.order") ?? {}, from, to);
      const groups = Object.fromEntries(defs.filter((d) => groupOf(d) === from).map((d) => [d.id, to]));
      setShared("workspaces.arrange", { ...saved, groups, at: Date.now() });
    }
  }

  // Ungroup: its workspaces lose the group and stay where they are.
  ungroup(g) {
    const saved = shared("workspaces.order") ?? {};
    setShared("workspaces.arrange", {
      order: (saved.order ?? []).filter((e) => typeof e === "string" || e.group !== g.group),
      folded: (saved.folded ?? []).filter((n) => n !== g.group),
      groups: Object.fromEntries(g.members.map((d) => [d.id, null])),
      at: Date.now(),
    });
  }

  // 0 shows every space, 1-9 the workspaces in the menu's order. (Herdr's Esc comes as overlay.close,
  // never as a key here: menu() claims it in a submenu.)
  key(e, defs) {
    if (this.inSubmenu() || e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    if (!/^[0-9]$/.test(e.key)) return;
    const n = Number(e.key);
    if (n > defs.length) return;
    closeOverlay(props().overlay);
    choose(n === 0 ? null : defs[n - 1].id);
  }
}
