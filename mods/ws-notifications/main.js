// ws-notifications: the list the tab bar's bell opens (a popup of this mod, under the bell, its
// right edge on the bell's). What needs you (pinned until it's resolved) above what happened
// (unread until clicked), across every workspace; notif.js has the rules.
//
// A row is one click to its thing: an agent, a run's tab (or the run in History once its tab
// closed), the card on its board, the automation. A click on a Needs you row goes there and leaves
// it; on an update it also marks it read. Hover × dismisses an update; Mark all read and Clear read
// (N) do the same for many. ↑ ↓ move, Enter opens, Esc closes. With items in more than one workspace
// (and one shown), All workspaces | <shown> chips filter the list.
//
// It only reads and asks: the log (~/.herdr/notifications.json, as the switcher's sidebar copy
// mirrors it in shared "workspaces.notifications.store") and live state, and every change goes to
// that copy as an ask on "workspaces.notifications.act" (a popup's tasks end when it closes). While
// open it says so in "workspaces.notifications.open" ({ overlay, at }), so the bell and its key
// close it instead of opening a second one.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, terminals, spaces, shared, setShared, props, closeOverlay, theme, checking } from "herdr";
import {
  ACT_KEY, STORE_KEY, SIZES, buildItems, hasMultiWs, filterScope, summaryOf, headHeight, rowHeight, ago, moveSel, pushQueue,
} from "./notif.js";

export const OPEN_KEY = "workspaces.notifications.open";
const settings = () => shared("workspaces.settings") ?? null;
const featureOn = (key) => settings()?.features?.[key] !== false;

let asked = 0;
// An ask for the switcher's sidebar copy, which keeps the log.
const ask = (action, fields = {}) => {
  const now = Date.now();
  setShared(ACT_KEY, pushQueue(shared(ACT_KEY), { action, ...fields }, now, `${now}-${++asked}-${Math.random().toString(36).slice(2, 7)}`));
};

export default class Notifications extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    this.sel = null;      // the row the keyboard is on (an id)
    this.hover = null;    // the row under the pointer (its × shows)
    this.scope = "all";   // or "current": the shown workspace's
    // What was clicked here, shown at once (the switcher writes the log a moment later).
    this.read = new Set();
    this.dismissed = new Set();
    if (checking()) return;
    setShared(OPEN_KEY, { overlay: props()?.overlay ?? null, at: Date.now() });
  }

  async close() {
    const o = shared(OPEN_KEY);
    if (!o || o.overlay === (props()?.overlay ?? null)) setShared(OPEN_KEY, { overlay: null, closedAt: Date.now() });
  }

  // The list now: live state and the log, with what was clicked here already applied.
  items() {
    const store = shared(STORE_KEY) ?? null;
    const items = buildItems({
      agents: agents(), terminals: terminals(), spaces: spaces(),
      defs: shared("workspaces.defs") ?? [], assigned: shared("workspaces.assigned") ?? {},
      runs: shared("workspaces.automation.runs") ?? [], automations: shared("workspaces.automations") ?? {},
      prs: shared("workspaces.prs") ?? null, store, features: settings()?.features ?? {}, now: Date.now(),
    });
    return items.filter((x) => !this.dismissed.has(x.id)).map((x) => (this.read.has(x.id) && x.group === "updates" ? { ...x, unread: false } : x));
  }

  shut() { closeOverlay(props()?.overlay); }

  // A row's click (or Enter): to its thing; an update is read from now on. A row whose thing is gone
  // and has no other way in does nothing (its × or Clear read takes it away).
  activate(it, cx) {
    if (!it || (it.gone && !it.fallbackLabel) || !it.target) return;
    if (it.group === "updates") this.read.add(it.id);
    ask("open", { item: it.id, target: it.target, pinned: Boolean(it.pinned), group: it.group });
    this.shut();
  }

  dismiss(it, cx) {
    this.dismissed.add(it.id);
    if (this.sel === it.id) this.sel = null;
    ask("dismiss", { item: it.id });
    cx.notify();
  }

  render() {
    const t = theme();
    const head = (children, h) => v_flex().id("n-head").h(h).flex_none().px(14).pt(12).border_b(1).border_color(t.border).children(children);
    const titleRow = (right) => h_flex().h(20).flex_none().items_center().gap(8)
      .child(div().flex_1().min_w(0).text_size(13.5).font_semibold().text_color(t.foreground).child("Notifications"))
      .when(Boolean(right), (el) => el.child(right));
    const link = (id, text, go) => div().id(id).flex_none().px(6).py(3).rounded(5).text_size(11.5).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); })
      .child(text);
    const root = (children) => v_flex().id("notifications").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => this.key(e, cx))
      .children(children);

    if (!featureOn("notifications")) {
      return root([head([titleRow(null)], SIZES.head),
        div().px(14).py(16).text_size(12).text_color(t.dim).child("Notifications are off in Settings > Features.")]);
    }

    const active = shared("workspaces.active") ?? null;
    const all = this.items();
    const multiWs = hasMultiWs(all, active);
    if (!multiWs) this.scope = "all";
    const shown = filterScope(all, this.scope, active);
    this.rows = shown;
    const needs = shown.filter((x) => x.group === "needs");
    const updates = shown.filter((x) => x.group === "updates");
    const unread = updates.filter((x) => x.unread);
    const readRows = updates.filter((x) => !x.unread);
    const summary = summaryOf(shown);
    if (this.sel && !shown.some((x) => x.id === this.sel)) this.sel = null;

    // Nothing at all: the title and one quiet note.
    if (!all.length) {
      return root([head([titleRow(null)], SIZES.head),
        v_flex().id("n-empty").h(SIZES.empty).flex_none().items_center().justify_center().gap(6).px(20)
          .child(h_flex().size(34).rounded(9).bg(t.raised).items_center().justify_center().text_color(t.dim)
            .child(svg("mods/ws-notifications/bell.svg").size(15)))
          .child(div().pt(4).text_size(13).font_medium().text_color(t.foreground).child("All caught up"))
          .child(div().max_w(270).text_size(12).text_color(t.dim).text_center()
            .child("Agents waiting on you, finished runs, and pull requests needing action will appear here."))]);
    }

    const def = (shared("workspaces.defs") ?? []).find((d) => d.id === active) ?? null;
    const markOf = (name, color, size = 14) => h_flex().size(size).flex_none().rounded(4).bg(color ? (String(color).startsWith("#") ? color : t[color] ?? t.accent) : t.dim)
      .items_center().justify_center().text_size(Math.round(size * 0.62)).font_bold().text_color("#ffffff").child([...String(name || "?")][0].toUpperCase());
    const chip = (id, on, label, go, mark = null) => h_flex().id(id).h(22).px(8).gap(5).rounded(5).flex_none().items_center().text_size(11.5).cursor_pointer()
      .border(1).border_color(on ? t.border : t.popover).bg(on ? t.raised : t.popover).text_color(on ? t.foreground : t.muted)
      .when(on, (el) => el.font_medium()).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { go(); cx.notify(); })
      .when(Boolean(mark), (el) => el.child(mark)).child(label);

    const header = head([
      titleRow(unread.length ? link("n-mark-all", "Mark all read", (cx) => {
        for (const x of unread) this.read.add(x.id);
        ask("markAllRead", { items: unread.map((x) => x.id) });
        cx.notify();
      }) : null),
      summary.length ? h_flex().h(20).pt(4).flex_none().items_center().gap(4).text_size(12)
        .children(summary.flatMap((p, i) => [
          ...(i ? [div().text_color(t.muted).child("·")] : []),
          div().text_color(p.tone === "muted" ? t.muted : t[p.tone]).when(p.tone !== "muted", (el) => el.font_medium()).child(p.text),
        ])) : null,
      multiWs ? h_flex().h(30).pt(6).flex_none().items_center().gap(4)
        .child(chip("n-scope-all", this.scope === "all", "All workspaces", () => { this.scope = "all"; }))
        .child(chip("n-scope-current", this.scope === "current", def?.name ?? "This workspace", () => { this.scope = "current"; }, markOf(def?.name, all.find((x) => x.ws === active)?.wsColor, 13))) : null,
    ].filter(Boolean), headHeight({ summary: summary.length > 0, multiWs }));

    const now = Date.now();
    const filtered = this.scope === "current";
    const section = (id, title, n, urgent) => h_flex().id(id).h(SIZES.section).flex_none().px(14).pt(8).pb(4).items_center().justify_between()
      .text_size(10.5).font_semibold().text_color(urgent ? t.blocked : t.dim)
      .child(title.toUpperCase()).child(String(n));
    const tone = (it) => (it.gone ? t.dim : it.group === "updates" && !it.unread ? null : { blocked: t.blocked, done: t.done, success: t.ansi2, warn: t.working, dim: t.dim }[it.tone] ?? t.done);
    const row = (it, i) => {
      const read = it.group === "updates" && !it.unread;
      const on = this.sel === it.id, hovered = this.hover === it.id;
      const dot = tone(it);
      const where = filtered ? it.place || it.wsName : [it.wsName, it.place].filter(Boolean).join(" · ");
      const clickable = !(it.gone && !it.fallbackLabel) && Boolean(it.target);
      const detail = it.goneNote
        ? h_flex().h(17).mt(2).flex_none().min_w(0).gap(4).text_size(11.8)
          .when(Boolean(it.detail) && !it.gone, (el) => el.child(div().min_w(0).truncate().text_color(read ? t.dim : t.muted).child(`${it.detail} ·`)))
          .child(div().flex_none().italic().text_color(t.dim).child(it.goneNote))
          .when(Boolean(it.fallbackLabel), (el) => el.child(div().flex_none().text_color(t.dim).child("·")).child(div().flex_none().font_medium().text_color(t.accent).child(it.fallbackLabel)))
        : it.detail ? div().h(17).mt(2).flex_none().min_w(0).truncate().text_size(11.8).text_color(read ? t.dim : t.muted).child(it.detail) : null;
      return h_flex().id(`n-row-${i}`).h(rowHeight(it)).flex_none().px(14).pt(9).gap(10).items_start()
        .border_b(1).border_color(t.border)
        .bg(on || hovered ? t.hover : t.popover)
        .when(clickable, (el) => el.cursor_pointer())
        .when(read && !(on || hovered), (el) => el.opacity(0.7))
        .on_hover((h, cx) => { if (h && this.hover !== it.id) { this.hover = it.id; cx.notify(); } else if (!h && this.hover === it.id) { this.hover = null; cx.notify(); } })
        .on_click((_e, cx) => this.activate(it, cx))
        .child(h_flex().w(10).pt(5).flex_none().justify_center()
          .child(dot ? div().size(7).rounded(4).bg(dot) : div().size(7).rounded(4).border(1.5).border_color(t.dim).opacity(0.6)))
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().h(18).flex_none().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(read || it.gone ? t.muted : t.foreground).when(!read && !it.gone, (el) => el.font_medium()).child(it.title))
            .child(hovered && !it.pinned
              ? h_flex().id(`n-x-${i}`).size(20).flex_none().rounded(5).bg(t.raised).items_center().justify_center().text_color(t.muted).cursor_pointer()
                .hover((s) => s.bg(t.selected).text_color(t.foreground)).tooltip("Dismiss")
                .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                .on_click((_e, cx) => { cx.stop_propagation(); this.dismiss(it, cx); })
                .child(svg("mods/pane/close.svg").size(11))
              : div().flex_none().text_size(11).text_color(t.dim).child(ago(it.at, now))))
          .when(Boolean(detail), (el) => el.child(detail))
          .child(h_flex().h(16).mt(3).flex_none().min_w(0).gap(5).items_center().text_size(11).text_color(t.dim)
            .when(!filtered && Boolean(it.wsName), (el) => el.child(markOf(it.wsName, it.wsColor, 12)))
            .child(div().min_w(0).truncate().child(where))));
    };
    const list = [];
    let i = 0;
    if (needs.length) { list.push(section("n-sec-needs", "Needs you", needs.length, true)); for (const it of needs) list.push(row(it, i++)); }
    if (updates.length) { list.push(section("n-sec-updates", "Updates", updates.length, false)); for (const it of updates) list.push(row(it, i++)); }
    if (!shown.length) list.push(div().px(14).py(14).text_size(12).text_color(t.dim).child(`Nothing for ${def?.name ?? "this workspace"}.`));

    const foot = h_flex().id("n-foot").h(SIZES.foot).flex_none().px(14).items_center().justify_between()
      .border_t(1).border_color(t.border).bg(t.chrome).text_size(11).text_color(t.dim)
      .child(div().flex_none().child("↑↓ move · Enter open · Esc close"))
      .when(readRows.length > 0, (el) => el.child(link("n-clear-read", `Clear read (${readRows.length})`, (cx) => {
        for (const x of readRows) this.dismissed.add(x.id);
        ask("clearRead", { items: readRows.map((x) => x.id) });
        cx.notify();
      })));

    // The list's own height: what it holds, at most what the popup has room for (a popup is as tall as
    // its content, so a flex_1 list would have none).
    const headH = headHeight({ summary: summary.length > 0, multiWs });
    const content = SIZES.listPad + [needs, updates].reduce((a, g) => a + (g.length ? SIZES.section + g.reduce((b, x) => b + rowHeight(x), 0) : 0), 0) + (shown.length ? 0 : 44);
    const room = Math.max(80, Math.min(SIZES.max, Number(props()?.height) || SIZES.max) - headH - SIZES.foot - SIZES.frame);
    return root([
      header,
      v_flex().id("n-list").h(Math.min(content, room)).flex_none().py(6).overflow_y_scrollbar().track_scroll(this.scroll).children(list),
      foot,
    ]);
  }

  key(e, cx) {
    if (e.key === "escape") { cx.stop_propagation(); this.shut(); return; }
    const rows = this.rows ?? [];
    if (e.key === "down" || e.key === "up") {
      this.sel = moveSel(rows, this.sel, e.key === "down" ? 1 : -1);
      // The list's children: a section header before each group's rows.
      const at = rows.findIndex((x) => x.id === this.sel);
      if (at >= 0) {
        const needsN = rows.filter((x) => x.group === "needs").length;
        this.scroll.scroll_to_item(at + (at < needsN ? 1 : needsN ? 2 : 1));
      }
      cx.stop_propagation(); cx.notify(); return;
    }
    if (e.key === "enter") { cx.stop_propagation(); this.activate(rows.find((x) => x.id === this.sel) ?? null, cx); }
  }
}
