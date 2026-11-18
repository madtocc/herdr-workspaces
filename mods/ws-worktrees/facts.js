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
    map.set(p.headRefName, { state: p.state, number: p.number, url: p.url, head: p.headRefOid ?? null });
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

export function ago(unix, now = Date.now() / 1000) {
  if (!unix) return "";
  const d = Math.max(0, now - unix);
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m`;
  if (d < 86400) return `${Math.round(d / 3600)}h`;
  if (d < 86400 * 60) return `${Math.round(d / 86400)}d`;
  return `${Math.round(d / 86400 / 30)}mo`;
}

export const inside = (p, dir) => Boolean(p && dir) && (p === dir || p.startsWith(dir + "/"));
