// Which folder Changes and Files show, and on which machine. No imports, so `node`
// can test it. Copied byte for byte in ws-changes and ws-files.
//
// - A pane beside the terminals (props { beside, tab }) follows the terminal beside it:
//   the last focused terminal pane of its own tab. Focus on the view's own pane, or on
//   a terminal of another tab or space, changes nothing. At start (and after a restart,
//   when the view's pane is the focused one) it's the terminal it followed last time
//   (`last`), else the tab's focused terminal, else its first.
// - Full size (props { screen }) follows the space it was opened in (view.space, from
//   shared "workspaces.screen"), else the shown space: the focused terminal of that
//   space's shown tab, else the one it followed last in that tab, else the tab's first.
// - Anything else (no tab, or no terminal left in it): Herdr's own rule, the focused
//   pane's folder, else the focused block's, else the space's.
//
// spaces, panes, focused: as Herdr's spaces(), panes(), focused(). last: tab id -> the
// pane id followed there last (shared "workspaces.follow"; toRemember() says what to
// write). Returns { cwd, on, space, tab, pane } where `pane` is the terminal pane
// followed (null under Herdr's rule) and `tab` the tab it was looked for in.

// The terminal pane to follow in a tab, or null when the tab has none.
export function followed(tab, panes, last) {
  const mine = (panes ?? []).filter((p) => p.tab === tab && p.terminal);
  if (!mine.length) return null;
  const focused = mine.find((p) => p.focused);
  if (focused) return focused;
  return mine.find((p) => p.pane === last) ?? mine[0];
}

// Herdr's rule (its files and changes mods' location()).
export function herdrRule(spaces, panes, f) {
  const space = (spaces ?? []).find((s) => s.active);
  const pane = f?.pane ? (panes ?? []).find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on, space: space?.id ?? null, tab: null, pane: null };
}

export function locate(view, { spaces, panes, focused, last = {} }) {
  const all = spaces ?? [];
  let space = null, tab = null;
  if (view?.screen) {
    space = (view.space ? all.find((s) => s.id === view.space) : null) ?? all.find((s) => s.active) ?? null;
    tab = space?.tabs?.find((t) => t.active)?.id ?? null;
  } else if (view?.beside && view.tab) {
    tab = view.tab;
    space = all.find((s) => (s.tabs ?? []).some((t) => t.id === tab)) ?? null;
  }
  const pane = space && tab ? followed(tab, panes, last[tab]) : null;
  if (!pane) return herdrRule(spaces, panes, focused);
  return { cwd: pane.cwd || space.folder || null, on: space.machine ?? null, space: space.id, tab, pane: pane.pane };
}

// What a copy writes to "workspaces.follow" this tick, or null for nothing. held: the
// terminal it last saw with the keyboard ({ tab, pane }). Only a copy in sight writes: a
// hidden one (a full-size copy under the terminals, a pane in another tab) holds what it
// saw when it was last shown, and writing that would fight the copy in sight. Entries
// for tabs that are gone are dropped, except a remote machine's (tab "<machine>/…")
// while that machine isn't ready: its tabs aren't listed yet. tabs: every listed tab id;
// ready: the names of the other machines whose layout is ready.
export function toRemember({ held, seen, last = {}, tabs = [], ready = [] }) {
  if (!seen || !held?.tab || !held.pane || last[held.tab] === held.pane) return null;
  const listed = new Set(tabs), up = new Set(ready);
  const kept = Object.entries(last).filter(([tab]) => listed.has(tab) || (tab.includes("/") && !up.has(tab.split("/")[0])));
  return { ...Object.fromEntries(kept), [held.tab]: held.pane };
}

// What a location is compared by: another folder or machine is another visit.
export const placeKey = (loc) => JSON.stringify({ cwd: loc.cwd, on: loc.on });
