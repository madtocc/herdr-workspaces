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
//
// How notifications look. Anything can post one with notify({ title, body,
// level, icon, action }); replace this mod to restyle them all. Click to
// run its action (e.g. go to the agent) and dismiss it.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, appHome, checking, shared, setShared } from "herdr";
import { exec } from "./posix.js";
import { twoLines } from "./cut.js";

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
  setShared(PUSH, [...list, { id: `${now}-${++pushed}-${Math.random().toString(36).slice(2, 7)}`, title: String(p.title), body: String(p.body ?? ""), level: p.level ?? null, action, at: now }].slice(-PUSH_KEEP));
}

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

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
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
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
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
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().max_h(32).overflow_hidden().line_height("16px").text_size(12).text_color(t.muted).child(twoLines(p.body))))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
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
