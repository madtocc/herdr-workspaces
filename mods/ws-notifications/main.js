// ws-notifications: the list the tab bar's bell opens (a popup of this mod, under the bell, its
// right edge on the bell's). What needs you (pinned until it's resolved) above what happened
// (unread until clicked), across every workspace; notif.js has the rules.
//
// A row is one click to its thing: an agent, a run's tab (or the run in History once its tab
// closed), the card on its board, the automation. A click on a Needs you row goes there and leaves
// it; on an update it also marks it read. Mark all read marks every update read (the gear before it
// opens Settings on Features) and Clear read (N) takes the read ones away. Every row has a quiet ×
// (Backspace or Delete on the selected row does the same): an update, a gone row or a failure goes; a waiting agent, helper or failing pull request is
// hidden until it's over (notif.js forgetEpisodes) and is a row again the next time. ↑ ↓ move, Enter
// opens, Esc closes. A row's time ("4m", "3d") has the date and hour as its tooltip. A row from a toast
// with an undo (an Antigravity wipe) has a solid Put it back at the right of its place line: it runs the
// undo's mod command (pressUndo; ws-agents away: "Show the sidebar to do this." in the detail's place),
// shows "Putting back…" and ws-agents' why from shared "workspaces.agents.restores", and the row turns
// into "Put back “…”" once it's done (notif.js undoState, buildItems). With items in more than one workspace
// (and one shown), All workspaces | <shown> chips filter the list.
//
// It only reads and asks: the log (~/.herdr/notifications.json, as the switcher's sidebar copy
// mirrors it in shared "workspaces.notifications.store") and live state, and every change goes to
// that copy as an ask on "workspaces.notifications.act" (a popup's tasks end when it closes). While
// open it says so in "workspaces.notifications.open" ({ overlay, at }), so the bell and its key
// close it instead of opening a second one.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, terminals, spaces, shared, setShared, props, closeOverlay, theme, checking, window, run } from "herdr";
import {
  ACT_KEY, STORE_KEY, SIZES, buildItems, hasMultiWs, filterScope, summaryOf, headHeight, rowHeight, ago, stamp, moveSel, pushQueue,
  RESTORES_KEY, AGENTS_ALIVE_KEY, undoState, PRESS_WAIT_MS,
} from "./notif.js";

export const OPEN_KEY = "workspaces.notifications.open";
const settings = () => shared("workspaces.settings") ?? null;
const featureOn = (key) => settings()?.features?.[key] !== false;
// The switcher writes "workspaces.switcher.alive" { at } every 5 s; missing or older than 15 s, it's away
// (the sidebar hidden since Herdr started) and nobody would take an ask.
const switcherHere = () => Date.now() - Number(shared("workspaces.switcher.alive")?.at ?? 0) <= 15000;
// ws-agents runs an undo's command (Put it back) and says so the same way, in AGENTS_ALIVE_KEY.
const agentsHere = () => Date.now() - Number(shared(AGENTS_ALIVE_KEY)?.at ?? 0) <= 15000;
// The key that closes a row, as its keyboard names it: the sign on a Mac, the word elsewhere.
const backKey = () => (window()?.platform === "macos" ? "⌫" : "Backspace");

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
    this.hover = null;    // the row under the pointer (highlighted)
    this.scope = "all";   // or "current": the shown workspace's
    // What was clicked here, shown at once (the switcher writes the log a moment later).
    this.read = new Set();
    this.dismissed = new Set();
    this.away = false; // the gear was pressed with the switcher away
    this.undoPress = {}; // undo key -> when Put it back was pressed here
    this.undoAway = null; // the undo key whose press found ws-agents away
    this.slidAt = 0; // when a row last went (the rows under it slid up)
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
      prs: shared("workspaces.prs") ?? null, store, restores: shared(RESTORES_KEY) ?? null, features: settings()?.features ?? {}, now: Date.now(),
    });
    return items.filter((x) => !this.dismissed.has(x.id)).map((x) => (this.read.has(x.id) && x.group === "updates" ? { ...x, unread: false } : x));
  }

  shut() { closeOverlay(props()?.overlay); }

  // A row's × (or Backspace/Delete on it): gone from the list at once, the switcher writes the log.
  // The keyboard's row moves to the next one (the one before, at the end).
  dismiss(it, cx) {
    if (!it) return;
    const rows = this.rows ?? [];
    if (this.sel === it.id) {
      const at = rows.findIndex((x) => x.id === it.id);
      this.sel = (rows[at + 1] ?? rows[at - 1] ?? null)?.id ?? null;
    }
    if (this.hover === it.id) this.hover = null;
    this.slidAt = Date.now();
    this.dismissed.add(it.id);
    ask("dismiss", { item: it.id });
    cx.notify();
  }

  // A row's click (or Enter): to its thing; an update is read from now on. A row whose thing is gone
  // and has no other way in does nothing (Mark all read, then Clear read, takes it away).
  activate(it, cx) {
    if (!it || (it.gone && !it.fallbackLabel) || !it.target) return;
    if (it.group === "updates") this.read.add(it.id);
    ask("open", { item: it.id, target: it.target, pinned: Boolean(it.pinned), group: it.group });
    this.shut();
  }

  // A row's Put it back: runs the undo's mod command (ws-agents.restore/<folder>), which files its
  // outcome under the key; the row draws it. Not while it's busy, not within 500 ms of a row going (the
  // button may have slid under the pointer), and not with ws-agents away (the row says so).
  pressUndo(it, cx) {
    const u = it?.undo;
    if (!u) return;
    if (undoState((shared(RESTORES_KEY) ?? {})[u.key], this.undoPress[u.key] ?? null, Date.now()).state === "busy") return;
    if (Date.now() - this.slidAt < 500) return;
    if (!agentsHere()) { this.undoAway = u.key; cx.notify(); return; }
    this.undoAway = null;
    this.undoPress[u.key] = Date.now();
    run(u.name, {});
    cx.notify();
    // Nothing back in time: draw the button again (undoState stops calling it busy).
    cx.timer.after(PRESS_WAIT_MS + 100, (cx) => cx.notify());
  }

  render() {
    const t = theme();
    const head = (children, h) => v_flex().id("n-head").h(h).flex_none().px(14).pt(12).border_b(1).border_color(t.border).children(children);
    // The gear before Mark all read: Settings on Features, where the bell is switched (through the
    // switcher, as a row's click goes; the list closes, so its tooltip goes with it). Pressed with the
    // switcher away, the list stays and "Show the sidebar to do this" (`muted`) stands in the gear's
    // place until the switcher is back.
    const awayNote = this.away && !switcherHere()
      ? div().id("n-settings-away").flex_none().px(6).text_size(11.5).text_color(t.muted).child("Show the sidebar to do this") : null;
    if (this.away && !awayNote) this.away = false;
    const gear = awayNote ?? h_flex().id("n-settings").size(20).flex_none().rounded(5).items_center().justify_center().cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Notification settings")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!switcherHere()) { this.away = true; cx.notify(); return; }
        ask("open", { target: { kind: "action", name: "ws-switcher.settings/features" } });
        this.shut();
      })
      .child(svg("mods/ws-notifications/settings.svg").size(13));
    const titleRow = (right) => h_flex().h(20).flex_none().items_center().gap(8)
      .child(div().flex_1().min_w(0).text_size(13.5).font_semibold().text_color(t.foreground).child("Notifications"))
      .child(h_flex().flex_none().items_center().gap(2).child(gear).when(Boolean(right), (el) => el.child(right)));
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
      // An undo's row: its state from ws-agents' outcome; a why ("Close Antigravity first.") or the
      // sidebar note stands in the detail's place.
      const ust = it.undo ? undoState((shared(RESTORES_KEY) ?? {})[it.undo.key], this.undoPress[it.undo.key] ?? null, now) : null;
      const unote = it.undo && this.undoAway === it.undo.key && !agentsHere() ? "Show the sidebar to do this." : ust?.why ?? null;
      const ubutton = it.undo && ust.state !== "said"
        ? h_flex().id(`n-row-${i}-undo`).h(20).min_w(90).px(8).flex_none().rounded(4).items_center().justify_center()
          .text_size(11.5).font_medium().bg(t.solid).text_color(t.solid_foreground)
          .when(ust.state === "busy", (el) => el.opacity(0.55))
          .when(ust.state !== "busy", (el) => el.cursor_pointer().hover((x) => x.opacity(0.88)))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.pressUndo(it, cx); })
          .child(ust.state === "busy" ? "Putting back…" : it.undo.label)
        : null;
      const detail = unote ? div().id(`n-row-${i}-detail`).h(17).mt(2).flex_none().min_w(0).truncate().tooltip(unote).text_size(11.8).text_color(t.foreground).child(unote)
        : it.goneNote
        ? h_flex().h(17).mt(2).flex_none().min_w(0).gap(4).text_size(11.8)
          .when(Boolean(it.detail) && !it.gone, (el) => el.child(div().id(`n-row-${i}-detail`).min_w(0).truncate().tooltip(it.detail).text_color(read ? t.dim : t.muted).child(`${it.detail} ·`)))
          .child(div().flex_none().italic().text_color(t.dim).child(it.goneNote))
          .when(Boolean(it.fallbackLabel), (el) => el.child(div().flex_none().text_color(t.dim).child("·")).child(div().flex_none().font_medium().text_color(t.accent).child(it.fallbackLabel)))
        : it.detail ? div().id(`n-row-${i}-detail`).h(17).mt(2).flex_none().min_w(0).truncate().tooltip(it.detail).text_size(11.8).text_color(read ? t.dim : t.muted).child(it.detail) : null;
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
            .child(div().id(`n-row-${i}-title`).flex_1().min_w(0).truncate().tooltip(it.title).text_size(12.8).text_color(read || it.gone ? t.muted : t.foreground).when(!read && !it.gone, (el) => el.font_medium()).child(it.title))
            .child(div().id(`n-row-${i}-time`).flex_none().text_size(11).text_color(t.dim).when(Boolean(it.at), (el) => el.tooltip(stamp(it.at, now))).child(ago(it.at, now)))
            .child(h_flex().id(`n-row-${i}-x`).size(20).flex_none().rounded(5).items_center().justify_center().cursor_pointer()
              .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(`Close ${backKey()}`)
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => { cx.stop_propagation(); this.dismiss(it, cx); })
              .child(svg("mods/ws-notifications/x.svg").size(12))))
          .when(Boolean(detail), (el) => el.child(detail))
          .child(h_flex().h(it.undo ? 20 : 16).mt(3).flex_none().min_w(0).gap(5).items_center().text_size(11).text_color(t.dim)
            .when(!filtered && Boolean(it.wsName), (el) => el.child(markOf(it.wsName, it.wsColor, 12)))
            .child(div().id(`n-row-${i}-where`).flex_1().min_w(0).truncate().when(Boolean(where), (el) => el.tooltip(where)).child(where))
            .when(Boolean(ubutton), (el) => el.child(ubutton))));
    };
    const list = [];
    let i = 0;
    if (needs.length) { list.push(section("n-sec-needs", "Needs you", needs.length, true)); for (const it of needs) list.push(row(it, i++)); }
    if (updates.length) { list.push(section("n-sec-updates", "Updates", updates.length, false)); for (const it of updates) list.push(row(it, i++)); }
    if (!shown.length) list.push(div().px(14).py(14).text_size(12).text_color(t.dim).child(`Nothing for ${def?.name ?? "this workspace"}.`));

    const foot = h_flex().id("n-foot").h(SIZES.foot).flex_none().px(14).items_center().justify_between()
      .border_t(1).border_color(t.border).bg(t.chrome).text_size(11).text_color(t.dim)
      .child(div().flex_none().child(`↑↓ move · Enter open · ${backKey()} close · Esc`))
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
    // Esc (and Cmd/Ctrl+W) never come here: Herdr sends them to a popup as its overlay.close (tab.close,
    // pane.close) action and closes the list itself, which is all Esc does here; close() then says it's shut.
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
    if (e.key === "enter") { cx.stop_propagation(); this.activate(rows.find((x) => x.id === this.sel) ?? null, cx); return; }
    // One press, one row: a held key's repeats would close the rows after it, one by one.
    if ((e.key === "backspace" || e.key === "delete") && e.is_held) { cx.stop_propagation(); return; }
    if ((e.key === "backspace" || e.key === "delete") && this.sel) { cx.stop_propagation(); this.dismiss(rows.find((x) => x.id === this.sel) ?? null, cx); }
  }
}
