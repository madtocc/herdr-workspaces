// Settings > Features' "Desktop notifications" row as rules with no imports, so node can test
// them: what `herdr-ws-notify --status` said, and the row's line for it. extras.js draws the row and
// runs the command (--on / --off write ~/.herdr/notify/switch; it isn't a feature in settings.jsonc).

export const DESK_TITLE = "Desktop notifications";
export const DESK_ABOUT = "Every toast also shows on the desktop when Herdr isn't in front, and the background runner's while Herdr is closed.";

const first = (s) => String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) || "";

// --status's run ({ code, stdout, stderr }, null when it couldn't start) as { on, how, error }:
// on false for "off"; on true with how ("terminal-notifier (…)", "osascript (…)", "notify-send", "a
// Windows toast (…)", "nothing") for "on, through <how>"; on null with error when it said neither.
export function parseDeskStatus(r) {
  if (!r) return { on: null, how: null, error: "herdr-ws-notify couldn't be started" };
  const line = first(r.stdout);
  if (r.code === 0 && line === "off") return { on: false, how: null, error: null };
  const m = r.code === 0 ? /^on, through (.+)$/.exec(line) : null;
  if (m) return { on: true, how: m[1], error: null };
  return { on: null, how: null, error: `herdr-ws-notify --status: ${first(r.stderr) || line || `exited ${r.code ?? "?"}`}` };
}

// The row's line (12px) for an answer, on a platform ("macos" | "linux" | "windows"): { text, warn }.
// Off says where toasts still show; on says only what's missing (nothing when all is there).
export function deskLine(status, platform = "macos") {
  if (!status) return { text: "", warn: false };
  if (status.error) return { text: status.error, warn: true };
  if (status.on === false) return { text: "Off: toasts show only inside Herdr's window.", warn: false };
  const how = String(status.how || "");
  if (platform === "macos" && how.startsWith("osascript")) {
    return { text: "terminal-notifier isn't installed, so a click on one does nothing. brew install terminal-notifier", warn: false };
  }
  if (how === "nothing") {
    return { text: platform === "linux" ? "notify-send isn't installed, so none show." : "Nothing on this computer can show them, so none show.", warn: false };
  }
  return { text: "", warn: false };
}
