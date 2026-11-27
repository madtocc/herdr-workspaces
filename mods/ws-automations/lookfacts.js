// What the Automations screen says about a run that needs a look, without imports so node
// can test it. One rule for the list, History and the bell: a run needs a look when it
// failed, timed out, its check failed, it was missed, or its agent ended its turn without
// the Outcome line it was asked for ("no outcome"). (A check that isn't allowed yet is the
// automation's own "allow?", from its record, not from a run.)

// An agent's run asked for its Outcome line (`reports`) whose tab closed after a finished
// turn without one. The runner reads that line only while Notifications are on (or another
// automation waits on it), so with them off a missing outcome says nothing: not counted.
export function noOutcome(r, notificationsOn = true) {
  return Boolean(r && r.kind !== "shell" && r.reports && r.closed && r.closedWhy === "finished" && !r.outcome && notificationsOn);
}

// The word for a run that needs a look, or null for one that doesn't (or is still going).
export function lookWord(r, notificationsOn = true) {
  if (!r) return null;
  if (r.timedOut) return "timed out";
  if (r.status === "missed") return "missed";
  if (r.status === "failed") return r.check ? "check failed" : "failed";
  if (r.status === "started" && r.closed && r.outcome === "failed") return "failed";
  if (r.status === "started" && noOutcome(r, notificationsOn)) return "no outcome";
  return null;
}

// A press at `now` that comes less than `ms` after `at` (a button just appeared or slid under the
// pointer): the rest of a double-click, to be ignored. No `at` yet: never too soon.
export function soonAfter(at, now, ms = 500) {
  return typeof at === "number" && now >= at && now - at < ms;
}

// Try it beside a script stops it after 2 minutes, or sooner when its own timeout is shorter: the
// screen can't stop an exec, so a slow try mustn't hold the button for the 10 a run may take.
// (A real run keeps its own timeout.) `ms` is its effective timeout; 0 means none.
export const TRY_MAX = 120e3;
export function tryLimit(ms) {
  return ms > 0 ? Math.min(ms, TRY_MAX) : TRY_MAX;
}

// A script running in the background stops by itself at its timeout, and at 10 minutes whatever
// that says (check.js' SCRIPT_MAX): the limit its row names ("running · stops at 2 min").
export const SCRIPT_MAX = 600e3;
export function scriptStops(timeoutMs) {
  return timeoutMs > 0 ? Math.min(timeoutMs, SCRIPT_MAX) : SCRIPT_MAX;
}

// After a rename: the automations that run after the old name (their When names it), said so nothing
// is silent. "" when none.
export function followersLine(followers, oldName, newName) {
  const names = [...new Set(followers)].map((n) => `"${n}"`);
  if (!names.length) return "";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} run${names.length === 1 ? "s" : ""} after "${oldName}": change ${names.length === 1 ? "its" : "their"} When to "${newName}".`;
}

// What a save asks the runner to allow, its check and its script, each by its text (the runner allows by
// automation name and exact text), so nothing becomes allowed that the person didn't press Save on:
//   "save":  Save, Create or Overwrite on what the editor shows: each part as written (the screen's rule).
//   "keep":  the On / Off chips and the 10-minute fixes, the saved one again with one line changed: a part
//            still as the source has it asks nothing (it keeps its flag); a part typed since (after a refused
//            save, before Overwrite) is asked as written. No source: nothing.
//   "carry": a rename or a duplicate (a new name): each part as its source had it. Allowed if the source's
//            was, or if it was changed here; a part that waited to be allowed still waits.
// source: { check, script, checkOk, scriptOk } as the saved one (or the original) was. null: not asked.
export function allowAsk(how, { check = "", script = "" } = {}, source = {}) {
  if (how === "keep") {
    const typed = (text, was) => (text && typeof was === "string" && text !== was ? text : null);
    return { check: typed(check, source.check), script: typed(script, source.script) };
  }
  const part = (text, was, ok) => (!text ? null : how === "save" || text !== was || ok !== false ? text : null);
  return { check: part(check, source.check, source.checkOk), script: part(script, source.script, source.scriptOk) };
}

// What the strip's Allow names and allows: a part that waits to be allowed and that the editor shows as
// the list's record has it (the editor doesn't read the file again by itself, so the two can differ:
// then that part isn't named, and isn't allowed). shown: { check, script, shell } as the editor has them.
export function allowParts(saved, { check = "", script = "", shell = false } = {}) {
  if (!saved) return { check: null, script: null };
  const checkWaits = (saved.checkAllowed === false || (saved.allowed === false && saved.checkAllowed === undefined)) && Boolean(saved.check) && check === saved.check;
  const scriptWaits = saved.run === "shell" && saved.scriptAllowed === false && shell && Boolean(saved.body) && script === saved.body;
  return { check: checkWaits ? saved.check : null, script: scriptWaits ? saved.body : null };
}

// What a copy or a rename carries (allowAsk's source): the texts as the editor has them, each ok only when
// the list's record has it allowed and is about that same text (the file may have changed since the editor
// opened, and then the record vouches for another text). norm: how the runner compares a script.
// The kind comes from the editor (`shell`), not the record: a record that's gone, or of another kind
// (the file turned into an agent's task meanwhile), carries nothing, so an untouched part still waits.
// snap: the editor's snapshot as it is ({ check, body, run }), or { check, body, shell }.
export function carrySource(rec, { check = "", body = "", run, shell } = {}, norm = (x) => String(x ?? "").trim()) {
  shell = shell ?? run === "shell";
  const script = shell ? norm(body) : "";
  const checkWaits = rec?.checkAllowed === false || (rec?.allowed === false && rec?.checkAllowed === undefined && Boolean(rec?.check));
  return {
    check, script,
    checkOk: Boolean(rec) && !checkWaits && (rec.check ?? "") === (check ?? ""),
    scriptOk: Boolean(rec) && (!shell || (rec.run === "shell" && rec.scriptAllowed !== false && norm(rec.body) === script)),
  };
}

// A part of the saved record that waits to be allowed but isn't what the editor opened (the file changed on
// disk since): the strip can't name it, so the screen says so and offers Reload from disk.
export function staleParts(rec, snap = {}, norm = (x) => String(x ?? "").trim()) {
  if (!rec) return { check: false, script: false };
  const checkWaits = (rec.checkAllowed === false || (rec.allowed === false && rec.checkAllowed === undefined)) && Boolean(rec.check);
  const scriptWaits = rec.run === "shell" && rec.scriptAllowed === false && Boolean(rec.body);
  return {
    check: checkWaits && (rec.check ?? "") !== (snap.check ?? ""),
    script: scriptWaits && (snap.run !== "shell" || norm(rec.body) !== norm(snap.body)),
  };
}
