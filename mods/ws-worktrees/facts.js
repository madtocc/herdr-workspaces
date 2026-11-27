// What git and GitHub say about a repo's worktrees, as plain data. No imports,
// so `node --test` can read it.

// `git worktree list --porcelain`: every checkout that still has its folder,
// the main one first. { path, branch, head, main }
export function parseList(text) {
  const out = [];
  let first = true;
  for (const block of String(text ?? "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    const main = first;
    first = false;
    if (lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, head: lines.find((l) => l.startsWith("HEAD "))?.slice(5) ?? null, main });
  }
  return out;
}

// `git for-each-ref --format=%(refname:short)%09%(committerdate:unix)%09%(ahead-behind:<base>)`:
// branch -> { at, ahead }. `ahead` is null when git gave none (no base, or an older git).
export function parseRefs(text) {
  const map = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const [branch, at, counts] = line.split("\t");
    if (!branch) continue;
    const ahead = /^\d+ \d+$/.test(counts ?? "") ? Number(counts.split(" ")[0]) : null;
    map.set(branch, { at: Number(at) || 0, ahead });
  }
  return map;
}

// `gh pr list --json headRefName,state,number,url,headRefOid,isCrossRepository`:
// branch -> its newest pull request from this repo (gh lists newest first).
export function parsePrs(text) {
  const map = new Map();
  let list = [];
  try { list = JSON.parse(text); } catch { return map; }
  for (const p of Array.isArray(list) ? list : []) {
    if (p.isCrossRepository || !p.headRefName || map.has(p.headRefName)) continue;
    map.set(p.headRefName, { state: p.state, number: p.number, url: p.url, head: p.headRefOid ?? null, title: String(p.title ?? "") });
  }
  return map;
}

// Where a worktree's work stands:
//   merged   its pull request is merged, and the branch hasn't moved since
//   open     its pull request is open
//   closed   its pull request was closed without merging
//   empty    no commits the base branch lacks
//   work     commits of its own and no pull request (or more since one merged)
//   detached no branch
export function kindOf(tree) {
  if (!tree.branch) return "detached";
  const pr = tree.pr;
  if (pr?.state === "MERGED") return !pr.head || !tree.head || pr.head === tree.head ? "merged" : "work";
  if (pr?.state === "OPEN") return "open";
  if (tree.ahead === 0) return "empty";
  if (pr?.state === "CLOSED") return "closed";
  return "work";
}

export function labelOf(tree) {
  const pr = tree.pr, n = tree.ahead;
  switch (kindOf(tree)) {
    case "merged": return `Merged #${pr.number}`;
    case "open": return `#${pr.number} open`;
    case "closed": return `#${pr.number} closed`;
    case "empty": return "Nothing to merge";
    case "detached": return "No branch";
    default:
      if (pr?.state === "MERGED") return `Changed since #${pr.number} merged`;
      return n ? `${n} commit${n === 1 ? "" : "s"}, no PR` : "No PR";
  }
}

// Safe to remove without looking: merged, nothing uncommitted (and read: null
// means not looked at yet), and nothing open or running in it.
export const finished = (tree, inUse) => kindOf(tree) === "merged" && tree.dirty === 0 && !inUse;

// The one rule every screen keeps: round down; "1m" under a minute (never "now" here),
// minutes under an hour, hours under a day, days under 60, months (days/30) under 730 days, then years.
export function ago(unix, now = Date.now() / 1000) {
  if (!unix) return "";
  const s = Math.max(0, now - unix);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86400);
  if (d < 60) return `${d}d`;
  return d < 730 ? `${Math.floor(d / 30)}mo` : `${Math.floor(d / 365)}y`;
}

export const inside = (p, dir) => Boolean(p && dir) && (p === dir || p.startsWith(dir + "/"));

const normPath = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const tail = (p) => normPath(p).split("/").pop() ?? "";

// A repo's main path, git dir, project folder and display name from `git rev-parse --git-common-dir`:
// a normal checkout (<project>/.git) or a hidden bare repo (<project>/.bare, Herdr 0.1.17).
export function repoInfo(common) {
  const c = normPath(common);
  if (c.endsWith("/.git")) {
    const main = c.slice(0, -5);
    return { main, gitDir: c, projectDir: main, name: tail(main) };
  }
  if (c.endsWith("/.bare")) {
    const projectDir = c.slice(0, -6);
    return { main: c, gitDir: c, projectDir, name: tail(projectDir) };
  }
  return null;
}

// A repo's display name from its main path (<project>/.bare is named after <project>).
export function repoName(main) {
  const m = normPath(main);
  return m.endsWith("/.bare") ? tail(m.slice(0, -6)) : tail(m);
}

// Whether `path` is marked `locked` in `git worktree list --porcelain` output:
// null when unlocked or not listed (let git resolve mismatches), "" when locked with no reason,
// or the lock reason string.
export function lockedReason(porcelain, path) {
  const want = normPath(path);
  for (const block of String(porcelain ?? "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const wt = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!wt || normPath(wt) !== want) continue;
    const lock = lines.find((l) => l === "locked" || l.startsWith("locked "));
    return lock === undefined ? null : lock === "locked" ? "" : lock.slice(7).trim();
  }
  return null;
}

// A repo's Scripts panel holds lines that weren't saved: typed and saved are { setup, archive }.
// Saving trims each line, so the spaces around one don't count.
export const unsaved = (typed, saved) => ["setup", "archive"].some((k) => String(typed?.[k] ?? "").trim() !== String(saved?.[k] ?? "").trim());

// The dot before a worktree's branch, in words: the most urgent agent there, or that
// something is open in it.
const DOT = { blocked: "An agent here needs you", working: "An agent here is working", done: "An agent here has finished", idle: "An agent here is idle" };
export const dotTip = (status, inUse) => (status ? DOT[status] ?? `An agent here: ${status}` : inUse ? "Open, with no agent in it" : null);

// The Remove dialog's red button: its words in each state, and every label it can come to show
// in this dialog. The button is as wide as the widest of those from the start, so a label that
// changes never pushes Cancel aside or puts red where Cancel was. "Remove anyway" follows a
// failed removal of one worktree (forced), or asks for several with changes to lose.
const changes = (n) => `${n} change${n === 1 ? "" : "s"}`;
export function removeLabel({ working, force, armed, one, lost }) {
  if (working) return "Removing…";
  if (force) return "Remove anyway";
  if (armed) return one ? `Remove and lose ${changes(lost)}` : "Remove anyway";
  return "Remove";
}
export const removeReserve = ({ one, lost }) => ["Remove", "Removing…", ...(one || lost > 0 ? ["Remove anyway"] : []), ...(one && lost > 0 ? [`Remove and lose ${changes(lost)}`] : [])];

// A link the screen opens in the browser: GitHub's own pages only. Anything else (a GitHub
// Enterprise host) is drawn as a plain tag, not as a link that does nothing.
export const opensLink = (url) => /^https:\/\/github\.com\//.test(String(url ?? ""));

// "Read 4m ago" beside Refresh, in the words the board's GitHub side uses.
export function readAgo(at, now) {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return "Read just now";
  if (m < 60) return `Read ${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `Read ${h}h ago` : `Read ${Math.floor(h / 24)}d ago`;
}

// Whether the screen, shown, reads git and GitHub again by itself: when shown again after
// a minute away (`back`), or, while someone can see it (`seen`: the layout's screen in a
// visible window), when what it shows is 5 minutes old. Never while a read is under way.
// A clock set back behind the last read counts as due, so it can't stall. A tab or a pane
// copy isn't `seen` here: it reads when opened, on Refresh and after a removal, as before.
export const SHOWN_STALE = 300e3;
export function readAgain({ back, reading, readAt, now, away = 60e3, seen = true }) {
  if (reading) return false;
  if (!back && !seen) return false;
  const d = now - readAt;
  if (d < 0) return true;
  return back ? d > away : d >= SHOWN_STALE;
}
