// ws-tabs: Herdr's `tabs` (0.1.14) for the workspaces layout. Changes:
// - the tab bar's + opens ws-new-menu, which adds the workspace's agent presets
//   (up to 85% of the window instead of 512 px, to fit them); while the shown workspace has no
//   space (the layout's empty block shows), + makes one in it instead (Scratch: names one first);
// - Views: a "Views" button at the bar's right end opens a menu (a popup of this mod,
//   props.viewsMenu) of the views: the shown space's Changes and Files, the shown workspace's Board,
//   Notes, Worktrees and History (views.js says which rows, for which state). A row opens its view
//   full size; its split icon, or ⌥ with a click or Enter, beside the shown tab's terminals as a
//   pane. The menu only asks: the switcher's sidebar copy opens (shared "workspaces.view");
// - a view open full size has a pill before the tabs: the workspace's (in every space of it, shared
//   "workspaces.screens"), then this space's Changes and Files (only in that space, shared
//   "workspaces.screens.space"). Shown, it fills the work area (the layout's `screens` stack, the
//   switcher shows it: shared "workspaces.screen"), and a "Beside <tab>" button by Views moves it into
//   a pane. A pill's right-click (a popup of this mod, props.pillMenu): Move beside, Close. With more
//   than 3 pills, or when they and the tabs wouldn't fit, the pills not shown are only their icon;
//   in a window under 900 px, Views and Beside are only their icon;
// - commands for keys (keys.json), handled by any copy of this bar that's shown:
//   "ws-tabs.view/<view>" shows it full size, and goes back to the terminals when it's the one shown;
//   "ws-tabs.beside/<view>" opens it beside (views.js: viewCommand, besideCommand); "ws-tabs.views"
//   opens the Views menu, and closes it when it's open;
// - a zoomed tab says so with an "Unzoom" chip (Herdr's: " Z"); a click on it unzooms;
// - a view whose add-on is off in Settings > Features (shared "workspaces.settings", ws-agents reads
//   ~/.herdr/settings.jsonc into it) has no pill and no row; it stays in "workspaces.screens", so
//   turning it on brings the pill back;
// - the side panel and its Expand are gone: an older build's state is undone here once more each
//   couple of seconds (the bar's main copy): the terminals' block (`main`) shown, an older workspaces
//   layout's `panel` and `panel-back` hidden, shared "workspaces.panel" and "workspaces.beside" and the
//   panel's per-space memory dropped.
// With an older layout (its own bar over the screens, props.screens, and the Back row, props.back),
// that copy draws the same bar over a screen, and the Back row nothing.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, closeOverlay, theme, window, shared, setShared, props, layout, settings, keys, checking, nextCommand } from "herdr";
import { VIEWS, ALL, isView, viewCommand, parseCommand, pushAsk, backName, canBeside, keyLabel, menu, menuRows, menuHeight, moveSel, pillKeys, pillTip, buttonWidth, tight, narrowWindow } from "./views.js";

// Whether an add-on is on in Settings > Features (nothing known yet counts as on).
const featureOn = (key) => shared("workspaces.settings")?.features?.[key] !== false;
const MENU_WIDTH = 300;
// When a Views menu last closed on "ws-tabs.views" (module code is shared by this mod's copies), so the
// command toggles the menu instead of stacking a second one.
let menuClosedAt = 0;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Where things stand, for the bar and its popups: the shown workspace (its def), the shown space
// (null while the workspace has none and Herdr shows another's), the shown tab, the view shown.
function here() {
  const ws = shared("workspaces.active") ?? null;
  const def = ws ? (shared("workspaces.defs") ?? []).find((d) => d.id === ws) ?? null : null;
  const covered = Boolean(shared("workspaces.covered"));
  const space = covered ? null : spaces().find((p) => p.active) ?? null;
  const tab = (space?.tabs ?? []).find((c) => c.active) ?? null;
  return { ws, def, covered, space, tab, scr: shared("workspaces.screen") ?? null };
}

// Whether the view shown full size is this one (a space's view: in this space).
const isShown = (scr, key, ws, space) => Boolean(scr) && scr.screen === key
  && (isView(key) && VIEWS[key].space ? scr.space === space?.id : (scr.ws ?? null) === (ws ?? null));

// The view's pills here: the workspace's (All spaces: History's), then this space's.
function pillsHere(root, ws, space) {
  const usable = (k) => featureOn(k) && Boolean(find(root, `screen-${k}`));
  return pillKeys((shared("workspaces.screens") ?? {})[ws ?? ALL], space ? (shared("workspaces.screens.space") ?? {})[space.id] : [], usable);
}

// A pill closed: off the list it's on, and back to the terminals when it's the one shown.
function unpin(key, ws, space) {
  if (isView(key) && VIEWS[key].space) {
    if (!space) return;
    const all = shared("workspaces.screens.space") ?? {};
    setShared("workspaces.screens.space", { ...all, [space.id]: (all[space.id] ?? []).filter((k) => k !== key) });
  } else {
    const all = shared("workspaces.screens") ?? {}, at = ws ?? ALL;
    setShared("workspaces.screens", { ...all, [at]: (all[at] ?? []).filter((k) => k !== key) });
  }
  if (isShown(shared("workspaces.screen"), key, ws, space)) setShared("workspaces.screen", null);
}

// An ask for the switcher's sidebar copy, which opens views (a popup's tasks end when it closes).
// beside: as a pane; toggle: full size, or back to the terminals when it's the one shown; move:
// beside, and its pill closes.
// Asks go on a short list (views.js pushAsk), so two close together are both done.
let asked = 0;
const ask = (key, { beside = false, toggle = false, move = false } = {}) => {
  const now = Date.now();
  setShared("workspaces.view", pushAsk(shared("workspaces.view"), { key, beside, toggle, move }, now, `${now}-${++asked}-${Math.random().toString(36).slice(2, 7)}`));
};

// The panes of the view kind open in this tab (the switcher's ledger, shared "workspaces.beside.panes").
function panesIn(tab, ws) {
  const ledger = shared("workspaces.beside.panes") ?? {};
  return [...new Set(panes().filter((p) => p.tab === tab?.id && ledger[p.pane]
    && ((isView(ledger[p.pane].screen) && VIEWS[ledger[p.pane].screen].space) || (ledger[p.pane].ws ?? null) === (ws ?? null))).map((p) => ledger[p.pane].screen))];
}

// The bottom right of an element a mouse event reports (its bounds), or null.
function corner(bounds) {
  if (!bounds) return null;
  const x = bounds.origin?.x ?? bounds.x ?? bounds.left, y = bounds.origin?.y ?? bounds.y ?? bounds.top;
  const w = bounds.size?.width ?? bounds.width ?? (bounds.right != null ? bounds.right - x : null);
  const h = bounds.size?.height ?? bounds.height ?? (bounds.bottom != null ? bounds.bottom - y : null);
  return [x, y, w, h].every((n) => typeof n === "number" && isFinite(n)) ? { right: x + w, bottom: y + h } : null;
}

export default class Tabs extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // The Views menu and a pill's right-click menu (popups) take the keyboard: arrows, Enter, Esc.
    if (p.viewsMenu || p.pillMenu) {
      this.handle = cx.focus_handle(); this.handle.focus(); this.sel = null;
      // "ws-tabs.views" again while the Views menu is open (a key): it closes, and says so, so the bar
      // (which gets the command too) doesn't open another.
      if (p.viewsMenu && !checking()) cx.spawn(async () => {
        for (;;) if (await nextCommand() === "views") { menuClosedAt = Date.now(); closeOverlay(props().overlay); return; }
      });
      return;
    }
    if (p.back) return; // an older layout's Back row: hidden, nothing to do
    this.pressed = null;
    if (checking()) return;
    // Keys: every copy of the bar takes them (only a shown one is handed them).
    cx.spawn(async (cx) => {
      for (;;) {
        const text = await nextCommand();
        // The menu: opened a moment later, and only if an open one didn't just close on the same command.
        // Again before it opened: the two cancel out (a toggle pressed twice).
        if (text === "views") {
          if (this.menuPending) { this.menuPending = null; continue; }
          const at = Date.now(), mine = { at };
          this.menuPending = mine;
          cx.timer.after(120, () => {
            if (this.menuPending !== mine) return;
            this.menuPending = null;
            if (menuClosedAt < at - 50) { this.viewsBounds = null; this.openMenu(); }
          });
          continue;
        }
        const c = parseCommand(text);
        if (c) ask(c.key, { beside: c.beside, toggle: !c.beside });
      }
    });
    if (p.screens) return;
    // The side panel and Expand are gone: what they left (the panel's memory per space, and any
    // hidden terminals) is undone now and then, so nothing can hide the terminals again.
    localStorage.removeItem("panels");
    localStorage.removeItem("panelHeld");
    this.undoPanel();
    cx.timer.every(2000, () => this.undoPanel());
  }

  undoPanel() {
    const root = layout();
    if (find(root, "main")?.hidden) run("layout.show", { id: "main" });
    // The panel's blocks only in an older copy of the workspaces layout (its Back row, or the panel
    // beside a screens stack), never Herdr's own panel in a layout someone made with this bar.
    const old = Boolean(find(root, "panel-back")) || (Boolean(find(root, "panel-body")) && Boolean(find(root, "screens")));
    if (old) for (const id of ["panel", "panel-back"]) if (find(root, id) && !find(root, id).hidden) run("layout.hide", { id });
    // The old Expand's state and this morning's beside ask (both gone): nothing reads them now.
    if (shared("workspaces.panel") != null) setShared("workspaces.panel", null);
    if (shared("workspaces.beside") != null) setShared("workspaces.beside", null);
  }

  // The Views menu, under the Views button, its right edge on the button's: from the click's bounds
  // when Herdr gives them, else from this bar's place (it spans the window right of the sidebar), else
  // at the pointer. Its height from the same rules it draws by.
  openMenu() {
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    const zoom = settings().zoom || 1, barWidth = (this.width ?? 0) / zoom;
    const { def, covered, space } = here();
    const c = corner(this.viewsBounds);
    let at = "pointer";
    if (c) at = { x: Math.max(0, c.right - MENU_WIDTH), y: c.bottom + 4 };
    else if (barWidth > 0) {
      const left = sidebar && !sidebar.hidden ? sidebar.size?.px ?? 0 : 0;
      // A popup's `at` is in the window's points; the layout's px are those over the zoom.
      at = { x: Math.max(0, (left + barWidth - 10 - (w?.buttons ? 3 * 29 : 0) - MENU_WIDTH) * zoom), y: ((find(root, "tabs")?.size?.px ?? 42) - 4) * zoom };
    }
    const m = menu({ ws: def ? { id: def.id, name: def.name, scratch: Boolean(def.scratch) } : null, space, covered,
      on: (k) => featureOn(k) && (Boolean(find(root, `screen-${k}`)) || VIEWS[k].space), panels: shared("workspace.panels") });
    openOverlay({ mod: "ws-tabs", kind: "popup", width: MENU_WIDTH, height: menuHeight(m), at, props: { viewsMenu: true } });
  }

  // The Views menu: the groups views.js gives, a row each; a click or Enter opens full size, the
  // split icon or ⌥ beside the tab's terminals.
  viewsMenu(t) {
    const { ws, def, covered, space, tab } = here();
    const root = layout();
    const platform = window()?.platform;
    const tabName = backName(tab, panes());
    const m = menu({
      ws: def ? { id: def.id, name: def.name, scratch: Boolean(def.scratch) } : null, space, covered,
      on: (k) => featureOn(k) && (Boolean(find(root, `screen-${k}`)) || VIEWS[k].space),
      panels: shared("workspace.panels"),
      pills: pillsHere(root, ws, space), panes: panesIn(tab, ws),
      keyOf: (k) => keyLabel(keys(), viewCommand(k), platform), tabName, platform,
    });
    const rows = menuRows(m);
    const go = (key, beside) => {
      if (!key) return;
      closeOverlay(props().overlay);
      ask(key, { beside: beside && m.split, toggle: !(beside && m.split) });
    };
    const row = (r) => h_flex().id(`view-${r.key}`).h(32).pl(9).pr(6).gap(9).flex_none().items_center().rounded(7)
      .bg(this.sel === r.key ? t.hover : t.popover).hover((s) => s.bg(t.hover)).text_color(t.foreground)
      .on_hover((on, cx) => { if (on && this.sel !== r.key) { this.sel = r.key; cx.notify(); } })
      .on_click((e) => go(r.key, Boolean(e.modifiers?.alt)))
      .child(svg(r.icon).size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().child(r.name))
      .when(r.dot, (el) => el.child(div().id(`view-dot-${r.key}`).size(6).flex_none().rounded(3).bg(t.accent).tooltip("Open: it has a pill in the tab bar")))
      .child(div().flex_1())
      .child(div().flex_none().text_size(11).text_color(t.dim).child(r.keys))
      .when(m.split, (el) => el.child(h_flex().id(`view-split-${r.key}`).w(26).h(24).flex_none().items_center().justify_center().rounded(6)
        .bg(r.pane ? t.selected : t.popover).text_color(r.pane ? t.foreground : t.muted)
        .hover((s) => s.bg(t.raised).text_color(t.foreground).border(1).border_color(t.accent))
        .tooltip(r.pane ? `Beside ${tabName} already: show it` : `Open beside ${tabName}`)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); go(r.key, true); })
        .child(svg("mods/ws-tabs/beside.svg").size(14))));
    const line = () => div().h(1).mx(4).my(5).flex_none().bg(t.border);
    const items = [];
    m.groups.forEach((g, i) => {
      if (i) items.push(line());
      items.push(h_flex().h(25).px(9).pt(4).gap(6).flex_none().items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().font_medium().text_color(t.muted).child(g.title)).when(Boolean(g.sub), (el) => el.child(g.sub)));
      for (const r of g.rows) items.push(row(r));
    });
    if (m.note) { if (m.groups.length) items.push(line()); items.push(div().h(26).px(9).pt(5).flex_none().text_size(11).text_color(t.dim).truncate().child(m.note)); }
    if (m.hint) items.push(h_flex().h(28).px(9).pt(4).gap(5).flex_none().items_center().text_size(11).text_color(t.dim)
      .child(svg("mods/ws-tabs/beside.svg").size(12).flex_none()).child(div().min_w(0).truncate().child(m.hint)));
    if (!items.length) items.push(div().px(9).py(8).text_size(12).text_color(t.dim).child("No views: they're off in Settings > Features."));
    return v_flex().id("views-menu").track_focus(this.handle).size_full().min_h(0).p(6).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); closeOverlay(props().overlay); return; }
        if (e.key === "down" || e.key === "up") { this.sel = moveSel(rows, this.sel, e.key === "down" ? 1 : -1); cx.stop_propagation(); cx.notify(); return; }
        if (e.key === "enter") { cx.stop_propagation(); go(this.sel ?? null, Boolean(e.modifiers?.alt)); }
      })
      .children(items);
  }

  // A pill's right-click menu: Move beside <tab> (where a view can open beside) and Close.
  pillMenu(t) {
    const { key } = props().pillMenu;
    const { ws, covered, space, tab } = here();
    const beside = canBeside(space, covered);
    const items = [
      ...(beside ? [{ id: "move", icon: "mods/ws-tabs/beside.svg", label: `Move beside ${backName(tab, panes())}`, go: () => ask(key, { beside: true, move: true }) }] : []),
      { id: "close", icon: "mods/pane/close.svg", label: "Close", go: () => unpin(key, ws, space) },
    ];
    const go = (it) => { closeOverlay(props().overlay); it?.go(); };
    const sel = items.find((it) => it.id === this.sel) ?? null;
    return v_flex().id("pill-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); closeOverlay(props().overlay); return; }
        if (e.key === "down" || e.key === "up") {
          const at = items.indexOf(sel), n = items.length;
          this.sel = items[at < 0 ? (e.key === "down" ? 0 : n - 1) : (at + (e.key === "down" ? 1 : -1) + n) % n].id;
          cx.stop_propagation(); cx.notify(); return;
        }
        if (e.key === "enter") { cx.stop_propagation(); go(sel); }
      })
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(isView(key) ? VIEWS[key].name : ""))
      .children(items.map((it) => h_flex().id(`pill-menu-${it.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .bg(sel === it ? t.hover : t.popover).hover((el) => el.bg(t.hover))
        .on_click(() => go(it))
        .child(svg(it.icon).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(it.label))));
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    if (p.viewsMenu) return this.viewsMenu(t);
    if (p.pillMenu) return this.pillMenu(t);
    if (p.back) return div().size_full().bg(t.chrome);
    const root = layout();
    // Over a view shown full size: an older layout's own bar there (props.screens), or this bar,
    // when the layout has one bar over everything and shows the `screens` stack.
    const single = !find(root, "screens-tabs");
    const over = p.screens ? true : single && find(root, "center")?.active === "screens";
    const { ws, def, covered, space, tab, scr } = here();
    // While the workspace has no space of its own, Herdr still shows another's: not its tabs.
    const shown = space?.tabs ?? [];
    const pinned = pillsHere(root, ws, space);
    const leave = () => { if (shared("workspaces.screen")) setShared("workspaces.screen", null); };
    const stop = (_e, cx) => cx.stop_propagation();
    const zoom = settings().zoom || 1;
    const sidebar = find(root, "sidebar"), w = window();
    const barWidth = (this.width ?? 0) / zoom;
    const narrow = narrowWindow(barWidth + (sidebar && !sidebar.hidden ? sidebar.size?.px ?? 0 : 0));
    const tabName = backName(tab, panes());
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const on = c.active && !over;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(on ? t.border : t.chrome).bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else { leave(); run("tab.select", { id: c.id }); }
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(name))
        // Zoomed: a chip that says so, and unzooms (pane.zoom on the zoomed pane unzooms it).
        .when(Boolean(c.zoomed), el => el.child(h_flex().id(`unzoom-${c.id}`).h(20).px(7).gap(4).flex_none().items_center().rounded(10)
          .bg(t.selected).text_color(t.foreground).text_size(11.5).hover(s => s.bg(t.hover))
          .tooltip("Unzoom: show the tab's other panes again")
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            cx.stop_propagation();
            const z = panes().find((x) => x.tab === c.id && x.zoomed);
            leave();
            if (!c.active) run("tab.select", { id: c.id });
            if (z) run("pane.zoom", { pane: z.pane });
          })
          .child(svg("mods/ws-tabs/unzoom.svg").size(11).flex_none()).child("Unzoom")))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(on, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    // Beside: while a view is shown full size, where it can open as a pane.
    const shownKey = over && scr && pinned.includes(scr.screen) && isShown(scr, scr.screen, ws, space) ? scr.screen : null;
    const beside = Boolean(shownKey) && canBeside(space, covered);
    // The buttons at the right end, then whether the pills not shown go icon-only.
    const right = 8 + (beside ? 3 + buttonWidth(`Beside ${tabName}`, !narrow) : 0) + buttonWidth("Views", !narrow) + (w?.buttons ? 3 * 29 : 0);
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const small = tight(
      pinned.map((k) => ({ name: VIEWS[k].name, shown: k === shownKey })),
      shown.map((c) => ({ name: /^tb\d+$/.test(c.name) ? "Terminal" : c.name, shown: c.active && !over, mark: Boolean(c.status && c.status !== "idle") })),
      barWidth - lightsPadding - 10 - right);
    const pin = (key) => {
      const v = VIEWS[key], on = key === shownKey, iconOnly = small && !on;
      const owner = v.space ? space?.name : def?.name ?? "All spaces";
      return h_flex().id(`screen-${key}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(on ? t.border : t.chrome).bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(el => el.bg(t.hover))
        .tooltip(pillTip(key, owner))
        .on_mouse_down("left", stop)
        .on_click(() => { if (!on) setShared("workspaces.screen", { ws, ...(v.space ? { space: space?.id } : {}), screen: key, at: Date.now() }); })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "ws-tabs", kind: "popup", width: 230, height: 10 + 24 + 31 * (canBeside(space, covered) ? 2 : 1), props: { pillMenu: { key } } });
        })
        .child(svg(v.icon).size(14).flex_none().text_color(on ? t.foreground : t.muted))
        .when(!iconOnly, el => el.child(v.name))
        .when(on, el => el.child(div().id(`screen-close-${key}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => {
          cx.stop_propagation();
          unpin(key, ws, space);
        }).child(svg("mods/pane/close.svg").size(12))));
    };
    // + : a new tab (the + menu); while the workspace has no space, a new space in it.
    const plus = covered
      ? () => {
        if (def?.scratch) openOverlay({ mod: "ws-switcher", kind: "dialog", width: 460, height: 234, props: { dialog: "new-space", id: def.id, scratch: true } });
        else run("space.new", def?.root ? { folder: def.root } : {});
      }
      : () => openOverlay({ mod: "ws-new-menu", kind: "popup", width: 250, height: 0.85 });
    return h_flex().id("tab-bar").on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (!covered && Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // The pills and tabs scroll when they don't fit; +, Beside and Views stay at the end (+ where
      // Herdr's own bar has it, so it's never scrolled away).
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar()
        .children(pinned.map(pin))
        .when(pinned.length > 0 && shown.length > 0, el => el.child(div().w(1).h(16).mx(4).flex_none().bg(t.border)))
        .children(shown.map(item)))
      .child(button("tab-new", "+", plus).when(covered, el => el.tooltip(def?.scratch ? "New scratch space" : `New space in ${def?.name ?? "this workspace"}`)))
      .when(beside, el => el.child(h_flex().id("view-beside").h(28).px(10).gap(6).flex_none().items_center().rounded(7).text_size(12)
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`Move ${VIEWS[shownKey].name} into a pane beside ${tabName}`)
        .on_mouse_down("left", stop)
        .on_click(() => ask(shownKey, { beside: true, move: true }))
        .child(svg("mods/ws-tabs/beside.svg").size(14).flex_none())
        .when(!narrow, el => el.child(div().max_w(180).truncate().child(`Beside ${tabName}`)))))
      .child(h_flex().id("views").h(28).px(10).gap(6).flex_none().items_center().rounded(7).text_size(12)
        .border(1).border_color(t.border).bg(t.raised).text_color(t.foreground).hover(s => s.bg(t.hover))
        .when(narrow, el => el.tooltip("Views"))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.viewsBounds = e.bounds ?? null; })
        .on_click(() => this.openMenu())
        .child(svg("mods/ws-tabs/views.svg").size(14).flex_none())
        .when(!narrow, el => el.child("Views")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/ws-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/ws-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/ws-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
