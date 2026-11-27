// The toast's body, cut to what two lines hold (no imports, so node can test it). GPUI can't clamp a
// wrapped text to two lines, so the body box is two lines tall (overflow hidden) and the text is cut
// here first, at a word, with "…", so a long body ends in "…" on its second line.
// About 40 characters of 12px text fit a line of the toast's 268px; two lines, with what wrapping
// at words loses, take 80.
export const BODY_MAX = 80;
export function twoLines(text, max = BODY_MAX) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  // Counted in characters (code points), so an emoji is never cut in half.
  const chars = [...s];
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max - 1).join("");
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:·-]+$/, "")}…`;
}

// A machine's login toast ("<name> needs login; run hc machine login <name>"): drawn as the command and a
// Copy in place of the body, the title rewritten to "<name> needs a login: run". { login, command } or null.
export function commandOf(body) {
  const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(String(body ?? ""));
  return login ? { login: login[1], command: `hc machine login ${login[1]}` } : null;
}

// A toast's undo (an Antigravity wipe's Put it back; ws-agents' notify({ undo })), as the button shows it,
// from the outcome ws-agents files under its key (shared "workspaces.agents.restores": { state:
// "running" | "done" | "failed", why, again, at }) and the press made here (pressedAt, or null):
//   "done"   put back (why null): the toast closes, ws-agents posts "Put back “…”"
//   "busy"   running, or pressed and nothing back yet, for up to PRESS_WAIT_MS ("Putting back…")
//   "note"   failed and it can be pressed again (again: true, "Close Antigravity first."): why, button
//   "said"   failed for good, or done before ("Already put back"): why, no button
//   "ready"  the button
// The same rule as ws-notifications' notif.js undoState (a mod can't import another's code).
export const PRESS_WAIT_MS = 15000;
export function undoState(entry, pressedAt, now) {
  const e = entry && typeof entry === "object" ? entry : null;
  const fresh = e && (pressedAt == null || (e.at ?? 0) >= pressedAt);
  const why = fresh && e.why ? String(e.why) : null;
  if (fresh && e.state === "done") return why ? { state: "said", why } : { state: "done", why: null };
  if (fresh && e.state === "running") return { state: "busy", why: null };
  if (pressedAt != null && !fresh && now - pressedAt < PRESS_WAIT_MS) return { state: "busy", why: null };
  if (fresh && e.state === "failed") return e.again ? { state: "note", why: why ?? "Press it again." } : { state: "said", why: why ?? "It can't be put back." };
  return { state: "ready", why: null };
}
