// Views: the six views the tab bar opens (its Views button and pills), and the rules of the Views
// menu and the pills. No imports, so `node` can test it.
//
// A view opens full size (it fills the work area, the layout's block `screen-<key>`, and gets a
// pill before the tabs) or beside the shown tab's terminals as a pane. Changes and Files belong to
// a space (their pills show only in the space they were opened in); Board, Notes, Worktrees and
// History to a workspace (their pills show in every space of it). The switcher's sidebar copy does
// the opening (shared "workspaces.view"); these rules only say what the bar and the menu show.

export const VIEWS = {
  changes: { name: "Changes", space: true, icon: "mods/ws-changes/changes.svg" },
  files: { name: "Files", space: true, icon: "mods/ws-files/folder.svg" },
  board: { name: "Board", space: false, icon: "mods/ws-board/board.svg" },
  notes: { name: "Notes", space: false, icon: "mods/ws-notes/notes.svg" },
  worktrees: { name: "Worktrees", space: false, icon: "mods/workspace-chrome/git-branch.svg" },
  history: { name: "History", space: false, icon: "mods/ws-history/history.svg" },
};
export const SPACE_VIEWS = ["changes", "files"];
export const WORKSPACE_VIEWS = ["board", "notes", "worktrees", "history"];
// The pills of All spaces (no workspace chosen: only History opens there) are kept under this key
// of shared "workspaces.screens", which a workspace id can't be.
export const ALL = "*";

// The commands a key runs (keys.json): full size (again: back to the terminals), and beside.
export const viewCommand = (key) => `ws-tabs.view/${key}`;
export const besideCommand = (key) => `ws-tabs.beside/${key}`;
// Whether a key is one of the views (own keys only: "constructor" isn't a view).
export const isView = (key) => typeof key === "string" && Object.hasOwn(VIEWS, key);
// A command's text back to { key, beside }, or null for anything else.
export function parseCommand(c) {
  const m = /^(view|beside)\/([a-z_]+)$/.exec(String(c ?? ""));
  return m && isView(m[2]) ? { key: m[2], beside: m[1] === "beside" } : null;
}

// The asks for the switcher (shared "workspaces.view"): a short list, newest last, so two asks close
// together (two keys, a script) are both done; the switcher does each id once (beside.js drainAsks).
// An ask older than ASK_TTL is dropped, never done late. id: unique per ask.
export const ASK_KEEP = 64;
export const ASK_TTL = 15000;
export function pushAsk(queue, ask, now, id) {
  const list = (Array.isArray(queue) ? queue : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < ASK_TTL);
  return [...list, { ...ask, id, at: now }].slice(-ASK_KEEP);
}

// What "Beside <name>" names: the tab's own name when someone named it, else its agent's, else
// "the terminals". panes: panes() (tab, program).
export function backName(tab, panes) {
  if (!tab) return "the terminals";
  if (tab.named && tab.name) return tab.name;
  return (panes ?? []).find((p) => p.tab === tab.id && p.program?.agent)?.program?.name ?? "the terminals";
}

// Whether a view can open beside the terminals here: a shown space of this computer's (a mod pane
// can't join a tab on another machine) that has a tab, and not covered (the shown workspace has no
// space: Herdr still shows another's).
export function canBeside(space, covered) {
  return Boolean(space) && !covered && !space.machine && (space.tabs ?? []).length > 0;
}

// The key bound to a command, as a label ("⌘⇧G" on macOS, "Ctrl+Shift+G" elsewhere), or "".
// bindings: keys() ({ section, keys, action }); only the global and this layout's sections count.
export function keyLabel(bindings, action, platform, layout = "workspaces") {
  const k = (bindings ?? []).find((b) => (b.section === "global" || b.section === `layout:${layout}`) && b.action === action);
  const stroke = String(k?.keys ?? "").trim().split(/\s+/)[0];
  if (!stroke) return "";
  const mac = platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd", option: "alt", control: "ctrl", command: "cmd" };
  const parts = stroke.split("-");
  let key = parts.pop();
  if (key === "") { key = "-"; parts.pop(); }
  const held = parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase());
  const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
  const mods = held.map((m) => names[m] ?? m);
  return mac ? mods.join("") + label : [...mods, label].join("+");
}

// "A, B and C".
export function listWords(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The Views menu for the state now:
//   ws: the shown workspace ({ id, name, scratch }) or null (All spaces)
//   space: the shown space ({ id, name, machine, tabs }) or null; covered: the shown workspace has
//     no space (Herdr shows another's), so there's no "this space"
//   on(key): the view's add-on is on (Settings > Features); panels: Herdr's shared "workspace.panels"
//     (the panels its welcome turned on; Changes and Files go by it)
//   pills: the keys with a pill here; panes: the keys open as a pane in the shown tab
//   keyOf(key): the label of its key ("" for none); tabName: what "beside <name>" says
// Returns { groups: [{ id, title, sub, rows: [{ key, name, icon, keys, dot, pane }] }], note, split,
// hint }: split says the rows have their split icon (beside can open), hint is the footer's words
// after the icon ("or ⌥ opens it beside claude"), note a muted line under the groups (or null).
export function menu({ ws, space, covered, on = () => true, panels, pills = [], panes = [], keyOf = () => "", tabName = "the terminals", platform = "macos" }) {
  const row = (key) => ({
    key, name: VIEWS[key].name, icon: VIEWS[key].icon, keys: keyOf(key) || "",
    dot: pills.includes(key), pane: panes.includes(key),
  });
  const here = covered ? null : space ?? null;
  const groups = [];
  if (here) {
    const enabled = Array.isArray(panels) ? panels : ["files", "changes"];
    const rows = SPACE_VIEWS.filter((k) => on(k) && enabled.includes(k)).map(row);
    if (rows.length) groups.push({ id: "space", title: here.name || "This space", sub: "this space", rows });
  }
  let note = null;
  if (ws) {
    const keys = WORKSPACE_VIEWS.filter((k) => on(k) && !(k === "worktrees" && ws.scratch));
    if (keys.length) groups.push({ id: "workspace", title: ws.name, sub: "workspace", rows: keys.map(row) });
  } else {
    if (on("history")) groups.push({ id: "everywhere", title: "Everywhere", sub: "", rows: [row("history")] });
    const need = ["board", "notes", "worktrees"].filter((k) => on(k)).map((k) => VIEWS[k].name);
    if (need.length) note = `Choose a workspace for ${listWords(need)}.`;
  }
  const split = canBeside(here, covered) && groups.length > 0;
  const hint = split ? `or ${platform === "macos" ? "⌥" : "Alt"} opens it beside ${tabName}` : null;
  return { groups, note, split, hint };
}

// The menu's rows top to bottom (the keyboard moves through these).
export const menuRows = (m) => m.groups.flatMap((g) => g.rows);

// The menu's height, px, as main.js draws it: 6 padding top and bottom; a group's header 25 and
// 32 a row; a line 11 between groups; the note 26; the hint 28. At least 60 (an empty menu says so).
export function menuHeight(m) {
  let h = 12;
  m.groups.forEach((g, i) => { h += (i ? 11 : 0) + 25 + 32 * g.rows.length; });
  if (m.note) h += (m.groups.length ? 11 : 0) + 26;
  if (m.hint) h += 28;
  return Math.max(60, h);
}

// The next row for up (-1) or down (+1), wrapping; sel: the one highlighted now (null: none).
export function moveSel(rows, sel, dir) {
  if (!rows.length) return null;
  const at = rows.findIndex((r) => r.key === sel);
  if (at < 0) return rows[dir > 0 ? 0 : rows.length - 1].key;
  return rows[(at + dir + rows.length) % rows.length].key;
}

// The bar's pills, in order: the workspace's (as they were opened, so they don't move when the
// space changes), then this space's. wsOpen: shared "workspaces.screens"[ws]; spaceOpen: shared
// "workspaces.screens.space"[space]; usable(key): the view is on and the layout has its block.
export function pillKeys(wsOpen, spaceOpen, usable = () => true) {
  const w = (wsOpen ?? []).filter((k) => isView(k) && !VIEWS[k].space && usable(k));
  const s = (spaceOpen ?? []).filter((k) => isView(k) && VIEWS[k].space && usable(k));
  return [...new Set([...w, ...s])];
}

// A pill's tooltip: its name and what it belongs to ("Changes · api", "Notes · Acme").
export const pillTip = (key, owner) => { const name = isView(key) ? VIEWS[key].name : key; return owner ? `${name} · ${owner}` : name; };

// How wide the bar's things are at full names, estimated (a mod can't measure text before drawing
// it): a pill or tab is 2 border + 20 padding + a 14 icon + 7 gap + its text (12.8 px type: 6.9 px a
// character on average) and, shown, 7 + a 12 close; a tab with an agent working or done adds 7 + 12.
// The bar's own: 3 between items, 9 for the line between pills and tabs, 26 for +.
export const CHAR = 6.9;
export const textWidth = (s) => Math.ceil(String(s ?? "").length * CHAR);
export const itemWidth = (name, { close = false, mark = false, label = true } = {}) =>
  2 + 20 + 14 + (label ? 7 + textWidth(name) : 0) + (close ? 19 : 0) + (mark ? 19 : 0);
// The Views and Beside buttons: 2 border + 20 padding + 14 icon (+ 6 gap and the words).
export const buttonWidth = (words, label = true) => 2 + 20 + 14 + (label ? 6 + textWidth(words) : 0);

// The bell at the bar's right end (ws-notifications' list): 28 square bare; with its count, 2 border +
// 14 padding + a 14 icon + 5 gap + the badge (10 padding + 6.5 a digit, at least 16).
export const BELL_WIDTH = 28;
export const bellWidth = (label) => (label ? 2 + 14 + 14 + 5 + Math.max(16, Math.ceil(10 + 6.5 * String(label).length)) : BELL_WIDTH);

// Whether the inactive pills show only their icon: more than 3 pills, or the pills and tabs at full
// names wouldn't fit `room` (the bar's width less its padding and the buttons at its right end).
// pills: [{ name, shown }]; tabs: [{ name, shown, mark }].
export function tight(pills, tabs, room) {
  if (pills.length > 3) return true;
  if (!(room > 0)) return false;
  const items = [
    ...pills.map((p) => itemWidth(p.name, { close: p.shown })),
    ...tabs.map((c) => itemWidth(c.name, { close: c.shown, mark: c.mark })),
  ];
  const total = items.reduce((a, b) => a + b, 0) + 3 * items.length + (pills.length && tabs.length ? 9 : 0) + 26;
  return total > room;
}

// Under this window width (layout px) Views and Beside show only their icon.
export const NARROW = 900;
export const narrowWindow = (width) => width > 0 && width < NARROW;
