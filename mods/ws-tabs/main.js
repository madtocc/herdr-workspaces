// ws-tabs: Herdr's `tabs` (0.1.14) for the workspaces layout. Three changes:
// - the tab bar's + opens ws-new-menu, which adds the workspace's agent presets
//   (up to 85% of the window instead of 512 px, to fit them);
// - the shown workspace's open screens (its Board, its Worktrees, its History, its Notes) are pills before
//   the space's tabs, the same in every space of the workspace. They belong to the
//   workspace, not to a space: shared `workspaces.screens` says which are open,
//   `workspaces.screen` which one is shown in place of the tabs (the switcher
//   shows it: its header in main.js). The layout's second copy of this bar
//   (props.screens) sits above the shown screen: there a tab's click goes back to
//   the tabs, and the Files and Changes buttons are left out (no panel beside a screen);
// - the side panel never leaves the terminals less than the layout's `main` block asks
//   (its `min`, 400 px; fit.js): a width set in a bigger window is narrowed to what this
//   one has, and grows back when the room does.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, props, layout, settings } from "herdr";
import { fit } from "./fit.js";

// The workspace's screens a tab bar can pin: key -> its pill. The layout holds each
// as the block `screen-<key>`.
const SCREENS = {
  board: { name: "Board", icon: "mods/ws-board/board.svg" },
  worktrees: { name: "Worktrees", icon: "mods/workspace-chrome/git-branch.svg" },
  history: { name: "History", icon: "mods/ws-history/history.svg" },
  notes: { name: "Notes", icon: "mods/ws-notes/notes.svg" },
};

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.held = JSON.parse(localStorage.getItem("panelHeld") ?? "null");
  }

  // Keeps the side panel from taking the terminals' room. This bar is as wide as the
  // work area, so its own width (this.width, from on_size_change) says how much the
  // panel and the terminals share. Shown or not: the panel then opens at a width that fits.
  fitPanel(root, panel) {
    const px = panel?.size?.px, body = find(root, "work-body");
    if (!px || !body || !(this.width > 0)) return;
    // Until our own resize lands, the width it's replacing isn't the person's.
    if (this.fitting) {
      if (px === this.fitting.from && Date.now() < this.fitting.until) return;
      this.fitting = null;
    }
    const room = this.width / settings().zoom - 2 * (body.padding ?? 0) - (body.gap ?? 0);
    const next = fit(px, room, panel.min ?? 0, this.held, find(root, "main")?.min);
    if (JSON.stringify(next.held) !== JSON.stringify(this.held)) {
      this.held = next.held;
      localStorage.setItem("panelHeld", JSON.stringify(next.held));
    }
    if (next.px === null) return;
    this.fitting = { from: px, until: Date.now() + 1000 };
    run("layout.resize", { id: "panel", px: next.px });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const root = layout();
    // Above a screen (props.screens): the screen is what's shown, no tab is.
    const over = Boolean(props()?.screens);
    const ws = shared("workspaces.active") ?? null;
    const scr = shared("workspaces.screen") ?? null;
    const pinned = ws ? ((shared("workspaces.screens") ?? {})[ws] ?? []).filter(k => SCREENS[k] && find(root, `screen-${k}`)) : [];
    // While the workspace has no space of its own, Herdr still shows another's: not its tabs.
    const foreign = over && Boolean(shared("workspaces.covered"));
    const space = foreign ? null : spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const leave = () => { if (shared("workspaces.screen")) setShared("workspaces.screen", null); };
    const stop = (_e, cx) => cx.stop_propagation();
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
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(on, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    // A screen of the workspace: shown from any of its spaces, closed for all of them.
    const pin = (key) => {
      const s = SCREENS[key], on = over && scr?.ws === ws && scr?.screen === key;
      return h_flex().id(`screen-${key}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(on ? t.border : t.chrome).bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(el => el.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => { if (!on) setShared("workspaces.screen", { ws, screen: key, at: Date.now() }); })
        .child(svg(s.icon).size(14).flex_none().text_color(on ? t.foreground : t.muted))
        .child(s.name)
        .when(on, el => el.child(div().id(`screen-close-${key}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => {
          cx.stop_propagation();
          const all = shared("workspaces.screens") ?? {};
          setShared("workspaces.screens", { ...all, [ws]: (all[ws] ?? []).filter(k => k !== key) });
          setShared("workspaces.screen", null);
        }).child(svg("mods/pane/close.svg").size(12))));
    };
    const sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    if (!over) { this.syncPanel(space, panel, body, enabled); this.fitPanel(root, panel); }
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().id("tab-bar").on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (!foreign && Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar()
        .children(pinned.map(pin))
        .when(pinned.length > 0 && shown.length > 0, el => el.child(div().w(1).h(16).mx(4).flex_none().bg(t.border)))
        .children(shown.map(item)))
      .when(!foreign, el => el.child(button("tab-new", "+", () => openOverlay({ mod: "ws-new-menu", kind: "popup", width: 250, height: 0.85 }))))
      .when(!over && enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(!over && enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/ws-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/ws-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/ws-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
