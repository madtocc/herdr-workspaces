// The add-ons Settings > Features can turn off, as the runners follow them: which answer
// holds (the file's first, then shared "workspaces.settings" for flips), what they say when
// one goes off or comes back, and when an `every` automation starts after Automations was off.
// No imports, so node can test it. settingsfacts.js reads the file; this only decides.
//
// board: off, no pull request follow-through and no GitHub board item status (prs.js,
// ghboard.js: no gh calls, no messages). automations: off, nothing starts (automations.js);
// a run already going finishes, and on again they carry on from then (nothing runs late).

// What a runner's log says when one of the features it follows goes off or comes back.
export const FOLLOWED = {
  board: {
    off: "Board is off in Settings > Features: pull requests and GitHub board items aren't followed (no gh calls, no messages)",
    on: "Board is on: following pull requests and GitHub board items again",
  },
  automations: {
    off: "Automations are off in Settings > Features: none start (schedules, triggers, checks, Run now); runs already going finish",
    on: "Automations are on: carrying on from now (what came due while they were off doesn't run late)",
  },
};

// What a run refused because Automations is off notes in the runs (History's Automations side).
export const OFF_NOTE = "Automations are off in Settings > Features.";

// The features a runner follows: the file's answer once it's read (before that nothing
// runs: known is false), then shared state's whenever that changes (the Settings window
// sets it at once; ws-agents reads the file into it every minute).
export class Features {
  constructor() {
    this.known = false;
    this.now = null;     // { <key>: true|false }
    this.seen = null;    // shared state's features as last looked at, as text
  }
  // parsed: parseSettings()' result for the file; shared: shared "workspaces.settings" now.
  fromFile(parsed, shared) {
    this.now = parsed?.features ?? null;
    this.seen = JSON.stringify(shared?.features ?? null);
    this.known = true;
  }
  // Shared state changed since the last look: its answer holds now.
  follow(shared) {
    const s = JSON.stringify(shared?.features ?? null);
    if (s === this.seen) return;
    this.seen = s;
    if (shared?.features) this.now = shared.features;
  }
  // On unless the answer says false (nothing known yet counts as on, as featureOn).
  on(key) { return this.now?.[key] !== false; }
}

// The followed features whose answer differs between two looks: [{ key, on }]. With no
// look before (null), the ones that are off, so a runner that starts with one off says so.
export function flips(before, after) {
  const out = [];
  for (const key of Object.keys(FOLLOWED)) {
    const on = after?.[key] !== false;
    if (before ? (before[key] !== false) !== on : !on) out.push({ key, on });
  }
  return out;
}

// An `every` automation's next start: `ms` after `from` (its last start, else when it was
// first seen). One that came due while Automations was off (before `resumed`, when it came
// back on) waits `ms` from then, so turning it on doesn't start every overdue one at once.
export function everyNext(from, ms, resumed) {
  const t = from + ms;
  return resumed && t <= resumed ? resumed + ms : t;
}
