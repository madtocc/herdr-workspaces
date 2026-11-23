// Views beside the terminals: a view (Changes, Files; the workspace's Board, Notes, Worktrees,
// History) as a pane in the shown tab, beside its terminals. No imports, so `node` can test it.
//
// The switcher's sidebar copy opens them (the tab bar's Views menu, its keys and its Beside button
// ask, shared "workspaces.view") and keeps a ledger of the panes it opened (shared
// "workspaces.beside.panes", pane id -> { ws, screen }): nothing else tells them from a pane someone
// split in by hand. Panes this ledger lists stay ordinary panes: only a view's add-on turned off in
// Settings > Features closes them (follow()).
// panes: panes() (pane, tab, mod, focused, zoomed); a space: spaces()' (id, tabs).

// ms a ledger pane must be missing, with this computer's layout read, before it's forgotten.
export const GONE = 3000;

// The ledger's live pane showing that view in the tab, or null. Only that tab: a view open as a
// pane in another tab doesn't count (it belongs to that tab). ws: the workspace a workspace view
// belongs to (undefined: any, for a space's view, whose tab already says which space).
export function openIn(ledger, panes, tab, ws, screen) {
  return (panes ?? []).find((p) => p.tab === tab && ledger?.[p.pane]?.screen === screen
    && (ws === undefined || (ledger[p.pane].ws ?? null) === (ws ?? null))) ?? null;
}

// Where a new one goes in the tab: below the tab's other beside pane, so they stack in one
// column; else right of the tab's focused pane (its first, when none is). Null: no pane there.
// zoomed: the tab's zoomed pane, to unzoom first so the new pane is seen (null: none).
export function splitAt(ledger, panes, tab) {
  const here = (panes ?? []).filter((p) => p.tab === tab);
  if (!here.length) return null;
  const zoomed = here.find((p) => p.zoomed)?.pane ?? null;
  const mine = here.filter((p) => ledger?.[p.pane]);
  if (mine.length) return { pane: mine[mine.length - 1].pane, direction: "down", zoomed };
  return { pane: (here.find((p) => p.focused) ?? here[0]).pane, direction: "right", zoomed };
}

// Whether shared "workspaces.settings" would close one of the ledger's listed panes: that
// view's add-on off. Then the file itself is read first (trusted()).
export function wantsClose(ledger, panes, settings) {
  const live = new Set((panes ?? []).map((p) => p.pane));
  return Object.entries(ledger ?? {}).some(([id, e]) => live.has(id) && isOff(settings, e.screen));
}

// The settings to close by: the file's own parse when it was read and is valid JSONC, else
// null (a missing, unreadable or broken file says "off" without meaning it: nothing closes).
// text: what was read (null when the read failed); parsed: parseSettings(text).
export function trusted(text, parsed) {
  if (text == null || !String(text).trim() || !parsed || parsed.error) return null;
  return parsed;
}

const isOff = (settings, screen) => settings?.features?.[screen] === false;

// What to close and what the ledger becomes. sure: the settings as just read from the file
// (trusted()), or null: then nothing closes. ready: this computer's layout is read and there
// are panes, so a pane that isn't listed is really gone (the ledger holds this computer's only).
// missing: { pane: since } from the last look, closing: { pane: when its close was sent } (this
// returns the next of both). spaces: spaces(), for a pane that is its space's last one.
// Returns { close: [pane id], ledger: the new one or null (unchanged), missing, closing }.
// An entry goes when its pane is gone (a close that doesn't land is sent again after RETRY),
// except a pane that's its space's last: it stays open and leaves the ledger at once.
export function follow({ ledger, panes, spaces, sure, ready, missing = {}, closing = {}, now }) {
  const ids = Object.keys(ledger ?? {});
  if (!ids.length) return { close: [], ledger: null, missing: {}, closing: {} };
  const live = new Map((panes ?? []).map((p) => [p.pane, p]));
  const close = [], next = {}, gone = {}, sent = {};
  let changed = false;
  for (const id of ids) {
    const e = ledger[id], p = live.get(id);
    if (!p) {
      // Not listed: forgotten once it's stayed so a while, with this computer's layout read.
      if (!ready) { if (missing[id]) gone[id] = missing[id]; next[id] = e; continue; }
      const since = missing[id] ?? now;
      if (now - since >= GONE) { changed = true; continue; }
      gone[id] = since; next[id] = e;
      continue;
    }
    if (sure && isOff(sure, e.screen)) {
      if (lastOfSpace(p, panes, spaces)) { changed = true; continue; }
      if (closing[id] && now - closing[id] < RETRY) sent[id] = closing[id];
      else { close.push(id); sent[id] = now; }
    }
    next[id] = e;
  }
  return { close, ledger: changed ? next : null, missing: gone, closing: sent };
}

// ms before a close that didn't land is sent again.
export const RETRY = 3000;

// pane.close refuses a space's last pane. Turning an add-on off never closes a space, so such a pane
// stays, as an ordinary pane.
function lastOfSpace(p, panes, spaces) {
  const space = (spaces ?? []).find((s) => (s.tabs ?? []).some((c) => c.id === p.tab));
  return Boolean(space) && space.tabs.length === 1 && (panes ?? []).filter((x) => x.tab === p.tab).length === 1;
}

// The tab bar's asks (shared "workspaces.view", a list ws-tabs' views.js pushAsk() keeps): the ones to
// do now, in order, and the ids seen so far. seen: the ids already seen (at start: every id in the list,
// so nothing is done again after a restart); known(key): the key is a view. An ask is done once, and only
// while younger than ttl.
export function drainAsks(queue, seen, now, known = () => true, ttl = 15000) {
  const list = Array.isArray(queue) ? queue.filter((a) => a && typeof a === "object" && typeof a.id === "string") : [];
  const was = new Set(seen ?? []);
  const run = list.filter((a) => !was.has(a.id) && now - (a.at ?? 0) < ttl && known(a.key));
  return { run, seen: list.map((a) => a.id) };
}
