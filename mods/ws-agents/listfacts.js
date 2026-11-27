// Rules of the Agents list that need no screen. No imports, so `node` can test it directly.

// Folds are kept across restarts as pins are: localStorage "folds" holds { id: last seen,
// in ms }, an id being a row's terminal (its tree), a space's heading (sp-<space>) or a
// section's heading (pinned, sec-<rank>). A section heading is always kept. A terminal or a
// space that hasn't been listed for a day is dropped, so closed ones don't pile up; "not
// listed right now" alone can't drop one, since the list is empty for a moment after a
// start. `listed` null (while starting) renews every id, so the day counts only while Herdr
// runs (closed for two days, a fold whose machine connects late isn't dropped at the first
// draw). A listed id's time is renewed at most once an hour, so the saved value doesn't change
// on every frame.
export const FOLD_KEEP_MS = 86400000;
export function keptFolds(saved, listed, now) {
  const out = {};
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return out;
  for (const [id, at] of Object.entries(saved)) {
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    const age = now - at;
    if (!listed) out[id] = now;
    else if (listed.has(id)) out[id] = age < 0 || age > 3600000 ? now : at;
    else if (/^(pinned|sec-\d+)$/.test(id) || (age >= 0 && age < FOLD_KEEP_MS)) out[id] = at;
    // A clock set back leaves age < 0: kept, as if just seen.
    else if (age < 0) out[id] = now;
  }
  return out;
}

// The command that puts an Antigravity wipe back (agywipe.js restore), for its toasts to end
// with. A path under the home folder is written from ~, which a shell expands (quoted after
// the ~/ when it holds a space); on Windows, where PowerShell doesn't expand ~ for a program's
// arguments, whole and always in '…', which both PowerShell and Git's sh take as written
// (backslashes included).
export function restoreCommand(script, home, backup, windows = false) {
  const q = (p) => {
    const under = !windows && home && (p === home || p.startsWith(`${home}/`));
    const rest = under ? p.slice(home.length + 1) : p;
    const quoted = windows ? `'${rest.replace(/'/g, "''")}'` // nothing is special inside '…' but '
      : !/[\s"'$`]/.test(rest) ? rest
      : `"${rest.replace(/(["\\$`])/g, "\\$1")}"`;
    return under ? (rest ? `~/${quoted}` : "~") : quoted;
  };
  return `node ${q(script)} restore ${q(home)} ${q(backup)}`;
}

// A look that never answers (its task lost, as a reload can lose one: Herdr drops a finished call
// whose task was cancelled, silently) is started again by the next press, once it has run
// STUCK_LOOK_MS: the Wipe dialog's lookup on a press on Wipe, Hand off's agents check on a press on
// its empty Agent row or Start. A clock set back counts as stuck, so it never waits for good.
export const STUCK_LOOK_MS = 5000;
export function lookStuck(askedAt, now = Date.now()) {
  const d = now - (askedAt ?? 0);
  return !(d >= 0 && d < STUCK_LOOK_MS);
}

// Put it back, on an Antigravity wipe's toast and its bell row. The undo the toast carries:
// `name` is ws-agents' mod command, its tail the backup folder's name only (a mod command carries
// no arguments, and a path from a command's text is never used); `key` the same name, by which the
// outcome is kept (shared "workspaces.agents.restores"); `command` the fallback the bell shows; for the
// bell's row, `ws` (the conversation's workspace, when known), `place` and `done` (its line once put back),
// and `opens` ({ name }: History at that conversation, historyAt()) for the row once it's put back.
export const UNDO_LABEL = "Put it back";
export function wipeUndo(backup, command, ws = null, opens = null) {
  const key = String(backup ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  if (!restoreKey(key)) return null;
  return { label: UNDO_LABEL, name: `ws-agents.restore/${key}`, key, command: String(command ?? ""),
    ws: ws || null, place: "Antigravity", done: "In Antigravity and History again.", ...(opens ? { opens: { name: opens } } : {}) };
}

// The switcher's command that opens History at a conversation, selected (ws-switcher.history-at), or null
// when the id or the workspace has anything but letters, digits, ".", "_" and "-".
export function historyAt(id, ws = null, app = "antigravity") {
  const ok = (v) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(v ?? ""));
  if (!ok(id) || !ok(app)) return null;
  return `ws-switcher.history-at/${app}/${id}${ws && ok(ws) ? `/${ws}` : ""}`;
}

// A backup folder's name as the command gives it, or null: agywipe.js names them
// antigravity-<id>-<time>, so no slash, no "..", nothing to run.
export function restoreKey(tail) {
  const k = String(tail ?? "");
  return /^antigravity-[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(k) && !k.includes("..") ? k : null;
}

// What `agywipe.js restore` answered ({ code, stdout, stderr }, and whether this backup had been
// put back before), as the toast and the bell draw it: { state: "done" | "failed", why, again }.
// `again`: the button stays, so a press can come once the reason is gone.
export function restoreOutcome(r, before = false) {
  if (r?.code === 0) return { state: "done", why: before ? "Already put back" : null, again: false };
  const err = String(r?.stderr ?? "").trim().split("\n").pop() ?? "";
  if (/Antigravity is running/.test(err)) return { state: "failed", why: "Close Antigravity first.", again: true };
  if (/a wipe is running/.test(err)) return { state: "failed", why: "A wipe is running: try again in a moment.", again: true };
  if (/ps didn't answer/.test(err)) return { state: "failed", why: "Can't tell whether Antigravity runs: try again.", again: true };
  if (/not a wipe's backup folder|no manifest\.json/.test(err)) return { state: "failed", why: "Its copy is gone: it can't be put back.", again: false };
  if (r?.code === 127) return { state: "failed", why: "It needs Node (20.6 or newer) on your PATH.", again: true };
  return { state: "failed", why: `Couldn't put it back: ${err.replace(/\.$/, "") || "agywipe.js failed"}.`, again: true };
}
