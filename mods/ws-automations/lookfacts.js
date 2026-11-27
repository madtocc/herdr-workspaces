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
