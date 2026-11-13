// What a pull request's state means for its board card: the facts worth keeping
// from `gh pr view --json`, the one status a card shows, what to tell the card's
// agent or the person, and the words for it. No imports: prs.js does the asking,
// the sending and the files. The wake rules follow Compozy's pull request monitors.

// What prs.js asks gh for.
export const FIELDS = "number,url,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefOid,headRefName,baseRefName,reviews";

export const QUIET = 120e3; // new reviews wait for this much quiet, so a burst is one message
export const HOLD = 300e3;  // … but never longer than this
const SLACK = 15e3;         // GitHub's clock and this one may differ by this much
const KEEP_SEEN = 300;

const FAILED = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR"]);
const REVIEWED = { APPROVED: "approved", CHANGES_REQUESTED: "requested changes", COMMENTED: "commented" };

// Text from GitHub (check names, logins, titles) is someone else's: one line, short.
export const clean = (s, max = 60) => {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/[\x60<>]/g, "'").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (names, max = 4) => (names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", "));

// A `pr:` line: a GitHub URL, or a number ("12", "#12") in the task folder's repo.
export function parsePr(value) {
  const v = String(value ?? "").trim();
  const m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(v);
  if (m) return { repo: m[1], number: Number(m[2]) };
  const n = /^#?(\d+)$/.exec(v);
  return n ? { repo: null, number: Number(n[1]) } : null;
}

// The repo of a GitHub remote URL (https or ssh), or null.
export function repoOfRemote(url) {
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return m ? m[1] : null;
}

// gh's answer, cut down. Checks: each name's newest run counts (a rerun replaces
// the run it cancelled); cancelled, skipped and neutral ones neither pass nor fail.
export function facts(raw) {
  const latest = new Map();
  for (const c of raw.statusCheckRollup ?? []) {
    const name = c.__typename === "StatusContext" ? c.context : [c.workflowName, c.name].filter(Boolean).join(" / ");
    const at = Date.parse(c.startedAt ?? c.createdAt ?? "") || 0;
    const old = latest.get(name);
    if (!old || at >= old.at) latest.set(name, { at, c });
  }
  const failed = [], pending = [];
  let passed = 0;
  for (const [name, { c }] of latest) {
    const done = c.__typename === "StatusContext" ? !["PENDING", "EXPECTED"].includes(c.state) : c.status === "COMPLETED";
    const result = c.__typename === "StatusContext" ? c.state : c.conclusion;
    if (!done) pending.push(clean(name));
    else if (FAILED.has(result)) failed.push(clean(name));
    else if (result === "SUCCESS") passed++;
  }
  return {
    number: raw.number, url: raw.url, title: clean(raw.title, 100),
    state: raw.state === "MERGED" ? "merged" : raw.state === "CLOSED" ? "closed" : "open",
    draft: Boolean(raw.isDraft),
    head: raw.headRefOid ?? "", branch: clean(raw.headRefName ?? ""), base: clean(raw.baseRefName ?? ""),
    // null: GitHub hasn't worked it out yet.
    mergeable: raw.mergeable === "MERGEABLE" ? true : raw.mergeable === "CONFLICTING" ? false : null,
    merge: raw.mergeStateStatus ?? "",
    decision: raw.reviewDecision ?? "",
    checks: { total: latest.size, passed, failed, pending },
    // Not the drafts only their author sees.
    reviews: (raw.reviews ?? []).filter((r) => r.id && r.state !== "PENDING")
      .map((r) => ({ id: r.id, by: clean(r.author?.login ?? "someone", 40), state: r.state, at: Date.parse(r.submittedAt ?? "") || 0 })),
  };
}

// Open, not a draft, every check passed (or none), approved (or no review
// needed), and GitHub says it can merge. One fact unknown: not ready.
export function ready(f) {
  return f.state === "open" && !f.draft && f.mergeable === true && !f.checks.failed.length && !f.checks.pending.length
    && (f.decision === "" || f.decision === "APPROVED") && !["BLOCKED", "BEHIND", "DIRTY", "UNKNOWN", "DRAFT"].includes(f.merge);
}

// The one status a card shows: { number, url, label, tone, tip }. `tone` is a
// theme color's name. `stale`: why GitHub couldn't be read for a while; then
// there's no status, because the last one may no longer be true.
export function chip(f, stale) {
  const c = f.checks;
  const checks = !c.total ? "No checks"
    : [c.failed.length && `${c.failed.length} failed`, c.pending.length && `${c.pending.length} running`, `${c.passed} passed`].filter(Boolean).join(", ");
  const review = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Needs a review" }[f.decision];
  const tip = [`#${f.number} ${f.title}`, `${f.branch} → ${f.base}`, checks, c.failed.length && `Failed: ${list(c.failed, 6)}`, review, "Click opens it on GitHub"].filter(Boolean).join("\n");
  const as = (label, tone) => ({ number: f.number, url: f.url, label, tone, tip });
  if (f.state === "merged") return as("Merged", "done");
  if (f.state === "closed") return as("Closed", "dim");
  if (stale) return { number: f.number, url: f.url, label: "", tone: "dim", tip: `#${f.number} ${f.title}\n${stale}` };
  if (c.failed.length) return as("Checks failing", "blocked");
  if (f.decision === "CHANGES_REQUESTED") return as("Changes requested", "blocked");
  if (f.mergeable === false) return as("Conflicts", "blocked");
  if (f.draft) return as("Draft", "dim");
  if (c.pending.length) return as("Checks running", "working");
  if (ready(f)) return as("Ready to merge", "done");
  if (f.decision === "REVIEW_REQUIRED") return as("Needs a review", "muted");
  return as("Open", "muted");
}

// One read of a card's pull request: what changed since the last one.
//   prev: what the last step returned as `s` (null the first time)
//   ctx:  { now, me, workSince, lastWorking }: your GitHub login, and when the
//         card's agent was last working (from, until)
// Returns { s, wakes, notes }. wakes are for the card's agent:
//   { kind: "checks" }    a check failed; once per head commit (failures already there count)
//   { kind: "conflicts" } it conflicts with its base; once per head commit
//   { kind: "reviews", items: [{ by, state }] }  new reviews, after QUIET of quiet (at most HOLD)
// notes are for the person: "ready" (once per head commit), "merged", "closed".
// Not told: reviews already there the first time, a push by itself, checks that
// pass, and reviews by you sent while the agent was working (they're its own replies).
export function step(prev, f, ctx) {
  const first = !prev || prev.number !== f.number;
  const s = first
    ? { number: f.number, url: f.url, state: null, told: {}, seen: f.reviews.map((r) => r.id), wait: null }
    : { ...prev, told: { ...prev.told }, seen: [...prev.seen] };
  const wakes = [], notes = [];
  if (f.state === "open") {
    if (f.checks.failed.length && s.told.fail !== f.head) { s.told.fail = f.head; wakes.push({ kind: "checks" }); }
    if (f.mergeable === false && s.told.conflict !== f.head) { s.told.conflict = f.head; wakes.push({ kind: "conflicts" }); }
    const seen = new Set(s.seen);
    const fresh = f.reviews.filter((r) => !seen.has(r.id));
    s.seen = [...s.seen, ...fresh.map((r) => r.id)].slice(-KEEP_SEEN);
    const own = (r) => Boolean(ctx.me) && r.by === ctx.me && ctx.workSince != null
      && r.at >= ctx.workSince - SLACK && r.at <= (ctx.lastWorking ?? ctx.workSince) + SLACK;
    const news = fresh.filter((r) => REVIEWED[r.state] && !own(r)).map((r) => ({ by: r.by, state: r.state }));
    if (news.length) s.wait = { since: s.wait?.since ?? ctx.now, last: ctx.now, items: [...(s.wait?.items ?? []), ...news] };
    if (s.wait && (ctx.now - s.wait.last >= QUIET || ctx.now - s.wait.since >= HOLD)) {
      wakes.push({ kind: "reviews", items: s.wait.items });
      s.wait = null;
    }
    if (ready(f) && s.told.ready !== f.head) { s.told.ready = f.head; notes.push("ready"); }
  } else {
    s.wait = null;
    if (f.state === "merged" && s.state !== "merged") notes.push("merged");
    if (f.state === "closed" && s.state === "open") notes.push("closed");
  }
  s.state = f.state;
  s.url = f.url;
  return { s, wakes, notes };
}

// Wakes waiting for the agent to be free, as one: a kind once, reviews gathered.
export function mergeWakes(queue, more) {
  const out = queue.map((w) => ({ ...w }));
  for (const w of more) {
    const old = out.find((x) => x.kind === w.kind);
    if (!old) out.push({ ...w });
    else if (w.kind === "reviews") old.items = [...(old.items ?? []), ...(w.items ?? [])];
  }
  return out;
}

// Of the wakes that waited, the ones still true of the pull request as it is now.
export function stillTrue(wakes, f) {
  if (f.state !== "open") return [];
  return wakes.filter((w) => (w.kind === "checks" ? f.checks.failed.length > 0 : w.kind === "conflicts" ? f.mergeable === false : true));
}

const reviewers = (items) => {
  const by = new Map();
  for (const r of items) by.set(r.by, r.state === "COMMENTED" && by.has(r.by) ? by.get(r.by) : r.state);
  return [...by].map(([who, state]) => `${who} ${REVIEWED[state] ?? "reviewed"}`);
};

// One line per wake, for a toast.
export function wakeLines(wakes, f) {
  return wakes.map((w) => {
    if (w.kind === "checks") return `${plural(f.checks.failed.length, "check")} failed: ${list(f.checks.failed)}`;
    if (w.kind === "conflicts") return `It conflicts with ${f.base}`;
    return `New reviews: ${list(reviewers(w.items ?? []))}`;
  });
}

// What the card's agent is sent. It names where to read the rest: the facts here
// are GitHub's, so the agent reads logs and reviews itself.
export function wakeText(task, repo, f, wakes) {
  const lines = wakes.map((w) => {
    if (w.kind === "checks") {
      const running = f.checks.pending.length ? ` (${f.checks.pending.length} still running)` : "";
      return `- ${plural(f.checks.failed.length, "check")} failed on ${f.head.slice(0, 7)}${running}: ${list(f.checks.failed, 8)}. \`gh pr checks ${f.number} --repo ${repo}\` lists them with their links, and \`gh run view <run id> --repo ${repo} --log-failed\` shows why one failed.`;
    }
    if (w.kind === "conflicts") return `- It conflicts with ${f.base}. Bring ${f.base} in (rebase or merge, as this repo does it), settle the conflicts and push.`;
    return `- New reviews: ${list(reviewers(w.items ?? []), 8)}. Read them before changing anything: \`gh pr view ${f.number} --repo ${repo} --comments\` for the reviews, and \`gh api repos/${repo}/pulls/${f.number}/comments\` for the comments on lines.`;
  });
  return [
    `[Herdr] Pull request #${f.number} for ${task.id} (${f.url}) needs you:`,
    ...lines,
    "Fix what is yours to fix and push to the same branch; say so if something needs a person. Herdr tells you here again when a check fails or a review arrives, so end your turn instead of waiting on them.",
  ].join("\n");
}
