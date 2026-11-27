// ws-toast: Herdr's `toast` (0.1.16), the workspaces layout's toast (`"toast":
// "ws-toast"` at the layout's root). Changes:
// - Each notification is also handed to the desktop (ws-switcher's
//   bin/herdr-ws-notify), which shows it unless Herdr is the app in front. So an
//   agent that needs you or finished, and an automation's news, reach you while
//   you're in another app. A click on the desktop one brings Herdr forward and
//   runs the toast's own action, or the action's `or` when Herdr refuses that one
//   (a mod's command while the mod isn't shown). `herdr-ws-notify --off` turns them off.
// - And handed to the tab bar's bell (shared "workspaces.notifications.push", a short list the
//   switcher's sidebar copy drains), which keeps the few worth keeping (ws-switcher's notif.js
//   classifyToast decides; nothing here filters). Not while Notifications is off in Settings > Features.
// - A × at its right edge, centred (20px, `dim`; hover `hover` and `foreground`, tooltip "Close"),
//   closes it without running its action. The body wraps to two lines (16px each), cut after the second
//   (cut.js), and the text has a tooltip with the whole title and body. Right padding 34px for the ×.
// - A machine's login toast shows the command (cut, whole on hover) and a Copy in place of the body
//   (cut.js commandOf). Copy is as wide as "Copied" from the start.
// - A notification with `undo` ({ label, name, key, command }: an Antigravity wipe's, from ws-agents) shows
//   its body's line beside a solid Put it back (`name`, a mod command, run on a press). The outcome comes
//   back in shared "workspaces.agents.restores" by `key` (cut.js undoState): "Putting back…" (dimmed, as
//   wide), a why in the body's place ("Close Antigravity first.", the button kept; "Its copy is gone…",
//   none), or done, which closes the toast. With ws-agents away ("workspaces.agents.alive" missing or
//   older than 15 s) the press says "Show the sidebar to do this." A click on the rest of it does
//   nothing. The undo goes to the bell with the rest.
//
// How notifications look. Anything can post one with notify({ title, body,
// level, icon, action }); replace this mod to restyle them all. Click to
// run its action (e.g. go to the agent) and dismiss it.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, appHome, checking, shared, setShared } from "herdr";
import { exec } from "./posix.js";
import { twoLines, commandOf, undoState, PRESS_WAIT_MS } from "./cut.js";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

// The bell's list of toasts (ws-switcher's notiflog.js drains it): newest last, at most PUSH_KEEP, none
// older than PUSH_TTL (the switcher may be unloaded for a while, with the sidebar hidden).
const PUSH = "workspaces.notifications.push";
const PUSH_KEEP = 64, PUSH_TTL = 10 * 60e3;
let pushed = 0;
function toBell(p) {
  if (shared("workspaces.settings")?.features?.notifications === false) return;
  const now = Date.now();
  const list = (Array.isArray(shared(PUSH)) ? shared(PUSH) : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < PUSH_TTL);
  const action = p.action?.name ? { name: String(p.action.name), args: p.action.args ?? {} } : null;
  const undo = p.undo && typeof p.undo === "object" ? p.undo : null;
  setShared(PUSH, [...list, { id: `${now}-${++pushed}-${Math.random().toString(36).slice(2, 7)}`, title: String(p.title), body: String(p.body ?? ""), level: p.level ?? null, action, ...(undo ? { undo } : {}), at: now }].slice(-PUSH_KEEP));
}

// Put it back: ws-agents files an undo's outcome here by its key, and says it's there to take a press.
const RESTORES = "workspaces.agents.restores";
const agentsHere = () => Date.now() - Number(shared("workspaces.agents.alive")?.at ?? 0) <= 15000;

// The script lives with the switcher: a mod can't import another mod's code, but it can run its script.
const DESKTOP = () => `${appHome()}/mods/ws-switcher/bin/herdr-ws-notify`;

export default class Toast extends View {
  // Once per notification: the desktop's copy. The script does nothing while
  // Herdr is in front, when it's switched off, or where there's no notifier.
  init() {
    if (checking()) return;
    const p = props() ?? {};
    if (!p.title) return;
    toBell(p);
    const args = ["--unless-front"];
    // One per place: an agent's later news replaces its earlier one.
    const place = p.action?.args?.terminal ?? p.action?.args?.id;
    if (place) args.push("--group", String(place));
    if (p.action?.name) args.push("--do", String(p.action.name), JSON.stringify(p.action.args ?? {}));
    if (p.action?.or?.name) args.push("--or", String(p.action.or.name), JSON.stringify(p.action.or.args ?? {}));
    args.push("--", String(p.title), String(p.body ?? ""));
    exec(DESKTOP(), args, { timeout: 15000 }).catch(() => {});
  }

  // Put it back: runs the undo's mod command (ws-agents.restore/<folder>); its outcome comes back by key.
  // Not while busy, not a second click of a double-click, not with ws-agents away (the toast says so).
  pressUndo(undo, e, cx) {
    if ((e?.click_count ?? 1) > 1) return;
    if (undoState((shared(RESTORES) ?? {})[undo.key], this.pressedAt ?? null, Date.now()).state === "busy") return;
    if (!agentsHere()) { this.away = true; cx.notify(); return; }
    this.away = false;
    this.pressedAt = Date.now();
    run(String(undo.name), {});
    cx.notify();
    // Nothing back in time: draw the button again (undoState stops calling it busy).
    cx.timer.after(PRESS_WAIT_MS + 100, (cx) => cx.notify());
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    // A machine's login: the command and a Copy in place of the body (cut.js commandOf).
    const cmd = commandOf(p.body);
    const login = cmd?.login ?? null, command = cmd?.command ?? null;
    // An undo (an Antigravity wipe's Put it back): the body's line beside the button; a why or the
    // sidebar note in its place. Done: the toast closes (ws-agents posts "Put back “…”").
    const undo = p.undo && typeof p.undo === "object" && p.undo.name && p.undo.key ? p.undo : null;
    const ust = undo ? undoState((shared(RESTORES) ?? {})[undo.key], this.pressedAt ?? null, Date.now()) : null;
    if (ust?.state === "done" && !this.closed) { this.closed = true; closeOverlay(p.overlay); }
    const unote = undo && this.away && !agentsHere() ? "Show the sidebar to do this." : ust?.why ?? null;
    const whole = [p.title ?? "", String(p.body ?? "").replace(/\s+/g, " ").trim()].filter(Boolean).join("\n");
    return h_flex()
      .id("toast")
      .relative()
      .size_full()
      .pl(18)
      .pr(34)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .when(!undo, (el) => el.cursor_pointer())
      .hover((s) => s.bg(t.hover))
      // A toast with an undo does nothing on a click: only Put it back and × act.
      .on_click(() => {
        if (undo) return;
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .id("toast-text")
          .flex_1()
          .overflow_hidden()
          .when(!login && Boolean(whole), (el) => el.tooltip(whole))
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login} needs a login: run` : p.title ?? ""))
          .when(!command && !undo && Boolean(p.body), (el) => el.child(div().max_h(32).overflow_hidden().line_height("16px").text_size(12).text_color(t.muted).child(twoLines(p.body))))
          .when(Boolean(undo), (el) => el.child(h_flex().mt(2).gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().line_height("16px").text_size(12).text_color(unote ? t.foreground : t.muted).child(unote ?? String(p.body ?? "")))
            .when(ust.state !== "said", (el) => el.child(h_flex().id("toast-undo").h(20).min_w(90).px(8).flex_none().rounded(4).items_center().justify_center()
              .text_size(11.5).font_medium().bg(t.solid).text_color(t.solid_foreground)
              .when(ust.state === "busy", (b) => b.opacity(0.55))
              .when(ust.state !== "busy", (b) => b.cursor_pointer().hover((x) => x.opacity(0.88)))
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((e, cx) => { cx.stop_propagation(); this.pressUndo(undo, e, cx); })
              .child(ust.state === "busy" ? "Putting back…" : String(undo.label || "Put it back"))))))
          .when(Boolean(command), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            // Copy keeps the width "Copied" needs from the start; its press and click aren't the toast's.
            .child(h_flex().id("toast-login-copy").flex_none().min_w(54).justify_center().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      )
      // The ×: closes the toast, its action not run.
      .child(h_flex().id("toast-close").absolute().right(8).top(26).size(20).rounded(5).items_center().justify_center()
        .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); closeOverlay(p.overlay); })
        .child(svg("mods/ws-toast/x.svg").size(12)));
  }
}
