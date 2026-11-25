// ws-chrome: Herdr's `workspace-chrome` (0.1.14) for the sidebar footer, with
// "Automations", "Agent presets" and "Vault" rows above Settings. They open the ws-automations,
// ws-presets and ws-vault screens for the shown workspace. (History was a row here; it opens from
// the tab bar's Views menu now, ws-tabs.) Settings opens our copy of Herdr's Settings window (ws-settings,
// with the package's own sections) instead of app.settings. The brand row still
// uses Herdr's own workspace-chrome.
// Automations and Vault are each left out while its add-on is off in Settings > Features
// (shared "workspaces.settings"), and the footer's block (`sidebar-footer`) is then asked
// to be the height the layout file gives it less 28 px a hidden row (footer.js,
// fitFooter()), so none leaves a hole; with every row shown, the file's height. The file
// (layouts/<shared "layout">.json) is read at start, when the layout changes and every 30 s.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, openOverlay, appHome, checking } from "herdr";
import * as fs from "fs/promises";
import { ROWS, FOOTER, footerRows, footerPx, footerWant } from "./footer.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Whether an add-on is on in Settings > Features (nothing known yet counts as on).
const featureOn = (key) => shared("workspaces.settings")?.features?.[key] !== false;

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    if (!props()?.footer || checking()) return;
    localStorage.removeItem("footer"); // an earlier version's guess at the footer's height
    this.fileFooter = null; // the footer's px in the layout file (null: leave the block alone)
    this.readFooter(cx);
    cx.timer.every(2000, (cx) => {
      if ((shared("layout") ?? null) !== this.footerFor || Date.now() - this.footerAt > 30000) this.readFooter(cx);
    });
  }

  // The footer's px as the shown layout's file has it (Herdr's layout() has the size
  // with clicks applied, so the file is read). A file being written reads as null for a
  // moment: the block is left as it is until the next read.
  readFooter(cx) {
    const name = shared("layout") ?? null;
    this.footerFor = name;
    this.footerAt = Date.now();
    cx.spawn(async (cx) => {
      const text = name && /^[\w.-]+$/.test(name)
        ? await fs.readFile(`${appHome()}/layouts/${name}.json`, "utf8").catch(() => null) : null;
      const px = footerPx(text);
      if (px !== this.fileFooter) { this.fileFooter = px; cx.notify(); }
    });
  }

  // The footer block at the file's height less the room of `hidden` rows (footer.js). A
  // size set this way is a click (layouts/.state), not a change to the layout file. Until
  // our own resize lands it isn't asked for again.
  fitFooter(hidden) {
    const now = find(layout(), FOOTER)?.size?.px;
    const want = footerWant(this.fileFooter, hidden);
    if (!now || !want || now === want) return;
    if (this.sizing?.px === want && Date.now() < this.sizing.until) return;
    this.sizing = { px: want, until: Date.now() + 1000 };
    run("layout.resize", { id: FOOTER, px: want });
  }
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(icon.includes("/") ? icon : `mods/ws-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      const shown = footerRows(featureOn);
      this.fitFooter(ROWS.length - shown.length);
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .when(shown.includes("automations"), el => el.child(row("automations", "mods/ws-automations/automations.svg", "Automations", false, () => openOverlay({
          mod: "ws-automations", kind: "dialog", width: 940, height: 680, props: { workspace: shared("workspaces.active") ?? null } }))))
        .child(row("presets", "presets", "Agent presets", false, () => openOverlay({
          mod: "ws-presets", kind: "dialog", width: 900, height: 640, props: { workspace: shared("workspaces.active") ?? null } })))
        .when(shown.includes("vault"), el => el.child(row("vault", "vault", "Secrets", false, () => openOverlay({
          mod: "ws-vault", kind: "dialog", width: 940, height: 680, props: { workspace: shared("workspaces.active") ?? null } }))))
        .child(row("settings", "settings", "Settings", false, () => run("mod.open", { name: "ws-settings" }))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/ws-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/ws-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
