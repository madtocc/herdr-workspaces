// When an automation run's tab closes by itself. No imports, so `node` can test it;
// automations.js (the switcher's runner and the background one) reads it.
//
// A run's tab closes GRACE after its agent finishes its turn (working, then done or
// idle), unless the automation says `keep: true` (or the run has a board card, whose
// pull request is followed by messages to its agent), the agent is working or waiting on
// you again, a helper agent it started is still alive (an orchestrator ends its turn
// and waits for its helpers' reports), or you're looking at that tab. A run whose
// agent doesn't report (a script, a shell after a restart) is never judged here.

export const GRACE = 10e3;

// The live terminals started under `address`, at any depth (hc records the starter as
// `parent`). terms: [{ address, parent, state }], as terminals() gives them.
export function helpersOf(address, terms) {
  if (!address) return [];
  const kids = new Map();
  for (const t of terms ?? []) {
    if (!t?.parent || t.state !== "live") continue;
    if (!kids.has(t.parent)) kids.set(t.parent, []);
    kids.get(t.parent).push(t.address);
  }
  const out = [], seen = new Set([address]);
  for (let i = 0, todo = [address]; i < todo.length; i++) {
    for (const k of kids.get(todo[i]) ?? []) if (!seen.has(k)) { seen.add(k); out.push(k); todo.push(k); }
  }
  return out;
}

// The run's tab is the one shown: the shown space, and that space's shown tab.
export const lookingAt = (view, run) => Boolean(view?.tab && run?.tab && view.tab === run.tab && (!view.space || !run.space || view.space === run.space));

// One tick for one run. status: its agent's status word now (working, blocked, done,
// idle), null while nothing reports there. seen: what this runner saw of it last
// tick ({ worked, since, blocked }), null at first. Kept in memory only: a runner that
// starts again (or a Herdr that restarted, whose resumed agent comes back idle) never
// saw it work, so it doesn't close it.
// Returns { seen, close, wait, needsYou }: close it now; or wait (finished, held back
// for a reason: "grace", "helpers", "looking"); needsYou: it has just started waiting on you.
export function closeStep({ run, keep = false, status = null, helpers = 0, looking = false, seen = null, now = Date.now(), grace = GRACE }) {
  const none = { seen: null, close: false, wait: null, needsYou: false };
  if (!run || run.status !== "started" || !run.expects || run.closed || !run.tab || !run.terminal) return none;
  if (status === "working") return { ...none, seen: { worked: true, since: null, blocked: false } };
  if (status === "blocked") return { ...none, seen: { worked: true, since: null, blocked: true }, needsYou: !seen?.blocked };
  if (status !== "done" && status !== "idle") return none; // nothing reports: a shell, or gone
  if (!seen?.worked) return { ...none, seen: { worked: false, since: null, blocked: false } };
  const next = { worked: true, since: seen.since ?? now, blocked: false };
  if (keep) return { ...none, seen: next };
  const wait = now - next.since < grace ? "grace" : helpers > 0 ? "helpers" : looking ? "looking" : null;
  return { ...none, seen: next, close: !wait, wait };
}

// The agent a run's report names ("claude-code", "pi"), as History knows it.
export function providerOf(app) {
  const a = String(app ?? "").toLowerCase();
  if (!a) return null;
  if (a.startsWith("claude")) return "claude";
  if (a.startsWith("antigravity") || a === "agy") return "antigravity";
  const w = a.split(/[-_ ]/)[0];
  return ["codex", "pi", "grok", "opencode"].includes(w) ? w : null;
}

// --- timeouts, what's running, a shell run's state ---

// The run's own terminal in terms (as terminals() gives them; live, or ended and kept): at its address
// and, when the run has a tab, labelled with that tab (herdr.tab; a remote tab's id has its machine
// before a "/"). Null when there's none. An address can come back for another terminal after a
// restart, a tab's id can't: nothing is read or ended at an address without this.
export function terminalOf(run, terms) {
  if (!run?.terminal) return null;
  const tabOf = (t) => String(t?.labels?.["herdr.tab"] ?? "");
  return (terms ?? []).find((t) => t?.address === run.terminal && (!run.tab || (tabOf(t) !== "" && (tabOf(t) === run.tab || String(run.tab).endsWith(`/${tabOf(t)}`))))) ?? null;
}

// A run that has gone on longer than its automation allows (timeoutMs; 0: no limit) and is still going.
export function isTimedOut(run, timeoutMs, now = Date.now()) {
  return Boolean(run && run.status === "started" && !run.closed && timeoutMs > 0 && now - (run.at ?? now) >= timeoutMs);
}

// A run's agent that hasn't reported yet counts as working this long after it started; one whose
// terminal isn't listed yet (it was only just made) counts this long.
const STARTING = 10 * 60e3;
const MAKING = 30e3;

// How many runs are going now, for the parallel limit: { agents, shells }. An agent run counts while
// its terminal is live and its agent works or waits on you (or, just started, hasn't reported yet,
// or its terminal isn't listed yet); one that finished its turn and kept its tab doesn't. A shell run
// counts while its script runs (no tab) or its tab's terminal is live (or not listed yet).
// runs: the runner's; agents and terminals: as Herdr gives them.
export function countActive(runs, agents, terminals, now = Date.now()) {
  const live = new Set((terminals ?? []).filter((t) => t?.state === "live").map((t) => String(t.address)));
  const listed = new Set((terminals ?? []).map((t) => String(t?.address)));
  let a = 0, s = 0;
  for (const r of runs ?? []) {
    if (!r) continue;
    if (r.status === "running") { s++; continue; }
    if (r.status !== "started" || r.closed || !r.terminal) continue;
    const young = !listed.has(String(r.terminal)) && now - (r.at ?? 0) < MAKING;
    if (r.kind === "shell") { if (live.has(String(r.terminal)) || young) s++; continue; }
    if (!live.has(String(r.terminal))) { if (young) a++; continue; }
    const ag = (agents ?? []).find((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab));
    if (ag ? ag.status === "working" || ag.status === "blocked" : !r.up && now - (r.at ?? 0) < STARTING) a++;
  }
  return { agents: a, shells: s };
}

// A shell run's state in a word: "queued", "running", "timed out", "failed" or "done" ("nothing to
// do" is done: it worked and had nothing to say).
export function shellStateOf(run) {
  if (!run) return "done";
  if (run.status === "queued") return "queued";
  if (run.status === "running" || (run.status === "started" && !run.closed)) return "running";
  if (run.timedOut) return "timed out";
  if (run.outcome === "failed" || run.status === "failed") return "failed";
  return "done";
}
