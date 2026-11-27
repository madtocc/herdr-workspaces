// gitscan.js: one `git status` per repo, shared by every copy of Changes and Files, with a brake.
// Taken from Herdr 0.1.18's `changes` and `files` (their repoStatus()), under a key of the package's
// own: Herdr's record ("herdr.repoStatus.v2") may change shape with Herdr. The mods run in one VM,
// so the copies meet in one map; each waits through its own task, so another copy's close can't
// cancel its work. A scan that took over half a second makes the next wait five times as long (up
// to a minute); none starts while the window isn't in front, unless the request allows it (a new
// folder, a click). Copied in ws-changes and ws-files; the copies are kept the same.
// No imports: exec and whether the window is in front come in `deps`, so node can test it.

export const STATUS_ARGS = ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
const scans = globalThis[Symbol.for("workspaces.repoStatus.v1")] ??= new Map();

// The same repo however a copy wrote its path ("C:\\x\\" and "C:/x" alike).
const repoKey = (root, on) => JSON.stringify([on ?? null, String(root ?? "").replace(/\\/g, "/").replace(/(.)\/+$/, "$1")]);

// The next status after a scan that took `duration` ms finished at `finished`: a file event may start
// one at watchAt, the timer at pollAt.
export function nextTimes(finished, duration) {
  const delay = duration < 500 ? 0 : Math.min(60000, 5 * duration);
  return { watchAt: finished + delay, pollAt: finished + Math.max(10000, delay) };
}

// req { after, visiting, urgent, allowInactive }: a scan that started at or after `after` will do (or,
// not urgent, any still inside its watch delay); visiting: a new folder, never an older scan's result.
// current(): the asking copy still wants it. deps { exec(cmd, args, opts), active() }.
// Resolves the scan { status, error, started, watchAt, pollAt }, or null (not wanted any more, or the
// window is behind and the request doesn't allow that).
export async function repoStatus(root, on, req, cx, current, deps) {
  const { after, visiting, urgent, allowInactive } = req;
  const repo = repoKey(root, on), now = Date.now();
  for (const [key, scan] of scans) {
    if (scan.pollAt <= now || (!scan.pollAt && scan.task.is_done())) scans.delete(key);
  }
  while (current()) {
    let scan = scans.get(repo);
    const pending = scan && !scan.pollAt && !scan.task.is_done();
    const reusable = scan?.status?.code === 0 && Date.now() < scan.pollAt
      && (scan.started >= after || (!urgent && Date.now() < scan.watchAt));
    if (!reusable && (!pending || (visiting && scan.started !== undefined && scan.started < after))) {
      if (!allowInactive && !deps.active()) return null;
      const next = {};
      next.task = cx.spawn(async (cx) => {
        await cx.sleep(25); // both listeners of one watch batch join before git starts
        if (!allowInactive && !deps.active()) return;
        next.started = Date.now();
        try {
          next.status = await deps.exec("git", STATUS_ARGS, { cwd: root, on: on ?? undefined });
        } catch (error) {
          next.error = error;
        } finally {
          const finished = Date.now();
          Object.assign(next, nextTimes(finished, finished - next.started));
          if (next.status?.code !== 0 && scans.get(repo) === next) scans.delete(repo);
        }
      });
      scans.set(repo, next);
      scan = next;
    }
    while (current() && !scan.pollAt && !scan.task.is_done()) await cx.sleep(50);
    if (!current()) return null;
    if (!scan.pollAt) continue; // the copy that scanned closed or reloaded
    return scan;
  }
  return null;
}

// When a copy reads again (its 500ms timer): the window back in front after a change (or with no
// folder watch) catches up once; a file event waits for watchAt, anything else for pollAt.
// ctx: the visit's { dirtyAt, watchAt, pollAt, catchUp }. Returns "poll", "dirty" or null.
export function dueNow(ctx, now, { active, refocused, watched }) {
  if (!ctx) return null;
  if (refocused && (ctx.dirtyAt || !watched)) ctx.catchUp = true;
  if (!active) return null;
  if (now >= (ctx.pollAt ?? 0)) return "poll";
  if (ctx.catchUp || (ctx.dirtyAt && now >= (ctx.watchAt ?? 0))) return "dirty";
  return null;
}

// The request for a read starting now, and the visit's times put off until the scan says (Herdr's
// refresh()). force: a click or a step that changed the folder; visiting: a new folder.
export function statusRequest(ctx, now, { force = false, visiting = false } = {}) {
  if (force || (ctx.catchUp && !ctx.dirtyAt)) ctx.dirtyAt = now + 1;
  const req = {
    after: visiting ? now + 1 : ctx.dirtyAt || (ctx.lastStatus ?? -1) + 1,
    visiting, urgent: force || visiting || Boolean(ctx.catchUp), allowInactive: force || visiting,
  };
  ctx.catchUp = false;
  ctx.pollAt = ctx.watchAt = now + 10000;
  return req;
}

// After the scan: the visit's times from it. A failed scan still answers the change that asked for
// it (retrying at once would spin); `covered` is the newest change the read saw (defaults to the
// scan's start). An urgent request the scan predates catches up on the next tick.
export function settleRequest(ctx, req, scan, covered = scan.started) {
  ctx.lastStatus = scan.started;
  ctx.pollAt = scan.pollAt;
  ctx.watchAt = scan.watchAt;
  if (ctx.dirtyAt && ctx.dirtyAt <= Math.min(covered, scan.started)) ctx.dirtyAt = 0;
  if (req.urgent && req.after > scan.started) ctx.catchUp = true;
}
