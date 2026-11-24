// A copy of Herdr's `changes` mod, 0.1.17 (made with mod.clone), for the Changes view.
// Changes from Herdr's, each kept small so the copy can be rebuilt on a newer Herdr:
// 1. Where it looks (follow.js, copied in ws-files): as a pane beside the terminals
//    (props { beside, tab }) it follows the last focused terminal of its own tab, not
//    whichever pane has focus, so clicking into it doesn't switch it to the space's
//    folder; full size (props { screen }) it follows the shown tab of the space it was
//    opened in (shared "workspaces.screen".space, else the shown space). The terminal
//    last focused in each tab is kept in shared "workspaces.follow", so a restart comes
//    back to it; only a copy in sight writes it (follow.js' toRemember). Anything else
//    (no props.tab, as panes opened before Views have): Herdr's rule.
// 2. Hidden, it reads nothing: full size only while shared "workspaces.screen" says
//    "changes" in the space shown; a pane (with props.tab) only while its tab is shown, no
//    view covers the tabs and no terminal of the tab is zoomed. The folder watch is
//    cancelled while hidden. The checks run on a 400ms timer, not from
//    render (a task started while rendering may never run).
// 3. The look: as a pane, no card of its own (Herdr's pane frame is the card) and no
//    title row (the pane's header names it): one slim row with the repo, branch,
//    +/- and file count. Full size, a header row like the other views' (icon,
//    "Changes", repo · branch, totals at the right) and no card. Herdr's card stays
//    for any other placement.
// 4. Full size, it takes the keyboard when it comes into view, so keys don't land in a
//    terminal nobody sees.
// 5. The commit box: Commit is greyed while the place shown is behind the one it now
//    follows (up to one 400ms tick), and a typed message comes back when the new place
//    is the same repo on the same machine (and per-checkout drafts are kept when
//    switching between nested repos or worktrees).
// 6. Open in Files: the selected file's row (not a deleted one) has a quiet icon that opens
//    it in the Files view, beside this terminal (shared "workspaces.files.open", which the
//    switcher's sidebar copy drains).
// 7. Nested repos & worktrees (repos.js): when the followed folder is not a git repo,
//    discovers nested git repos (up to depth 3, depth 1 in home/root, skipping dot-folders
//    and heavy build/vendor folders) and lists each repo's linked worktrees via
//    `git worktree list --porcelain` (deduplicated by git common dir, sorted alphabetically
//    with live changed-file counts). When the followed folder IS a git repo with linked
//    worktrees, lists those worktrees too (defaulting to the terminal's checkout, marked
//    "here", with a return button when viewing a sibling checkout). Shown as a resizable
//    left rail at >= 640px (matching ws-files) and as a clickable header switcher popover
//    under 640px (e.g. beside a terminal); hidden completely for a single repo with no
//    worktrees.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, Popup, h_resizable, resizable_panel } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, shared, setShared, checking, machines, home, window } from "herdr";
import { locate, toRemember, placeKey } from "./follow.js";
import {
  SKIP_DIRS, MAX_REPOS, MAX_DIRS, FILTER_THRESHOLD,
  normPath, baseName, maxScanDepth,
  parseWorktrees, countPorcelainZ, parseScanOutput, posixScanScript,
  buildGroups, pickInitial, filterGroups,
} from "./repos.js";

const NARROW = 640, RAIL = 248, SLOW = 6;
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
const wideGlyph = /[\p{Ideographic}\p{Emoji_Presentation}\p{Extended_Pictographic}\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/gu;
const fade = (c, a) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? `${c}${Math.round(a * 255).toString(16).padStart(2, "0")}` : c);
const draftKey = (root, on) => `${on ?? ""}::${normPath(root)}`;

// Keep room for spacing marks and give wide glyphs at least two columns.
function displayColumns(text) {
  let columns = text.length;
  for (const glyph of text.match(wideGlyph) ?? []) {
    if (glyph.length === 1) columns++;
  }
  return columns;
}

// The diff was laid out for 11px text: 20px rows, 7px characters.
const rowHeight = size => Math.ceil(size * 1.8), charWidth = size => size * 0.64;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

// Bounded nested-repo scan for local Windows (matches posixScanScript's NUL output).
function windowsScanArgs(cwd, maxDepth) {
  const skip = SKIP_DIRS.map((s) => `'${s}'`).join(",");
  const escaped = String(cwd ?? "").replace(/['‘’‚‛]/g, "$&$&");
  const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($root,$max,$maxR,$maxD) $skip=@(${skip}); $real=(Resolve-Path -LiteralPath $root -ErrorAction SilentlyContinue).Path; if(-not $real){$real=$root}; $out=[System.Collections.Generic.List[string]]::new(); $out.Add($real); $cnt=0; $vis=0; function walk($d,$dep){ if($dep -gt $max -or $script:cnt -ge $maxR -or $script:vis -gt $maxD){return}; foreach($c in (Get-ChildItem -LiteralPath $d -Directory -ErrorAction SilentlyContinue)){ if($c.Name.StartsWith('.') -or $skip -contains $c.Name){continue}; $script:vis++; if($script:vis -gt $maxD){return}; if(Test-Path -LiteralPath (Join-Path $c.FullName '.git')){ $out.Add($c.FullName); $script:cnt++; if($script:cnt -ge $maxR){return} } elseif($dep -lt $max){ walk $c.FullName ($dep+1) } } }; walk $root 1; [Console]::Write(($out -join [char]0)) } '${escaped}' ${maxDepth} ${MAX_REPOS} ${MAX_DIRS}`;
  return ["-NoProfile", "-Command", script];
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.longest = 0; this.gutterChars = 4; this.message = ""; this.handle = cx.focus_handle();
    this.size = null; this.railW = RAIL;
    this.groups = []; this.flat = []; this.selectedPath = null; this.followedRoot = null; this.branch = null;
    this.userPicked = false; this.popOpen = false; this.scanning = false; this.noRepos = false;
    this.loadSeq = 0; this.drafts = new Map();
    this.filterQuery = ""; this.filtering = false;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (this.root) {
        const k = draftKey(this.root, this.on);
        if (this.message.trim()) this.drafts.set(k, this.message);
        else this.drafts.delete(k);
      }
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.filterInput = InputState.new({ placeholder: "Filter repos & worktrees…" });
    this.filterInput.on("change", (_e, cx) => { this.filterQuery = this.filterInput.value(); cx.notify(); });
    this.filterInput.on("focus", (_e, cx) => { this.filtering = true; cx.notify(); });
    this.filterInput.on("blur", (_e, cx) => { this.filtering = false; cx.notify(); });
    this.shown = false;
    if (!checking()) {
      this.refresh(cx);
      cx.timer.every(10000, (cx) => this.refresh(cx));
      cx.timer.every(400, (cx) => this.tick(cx));
    }
  }

  // Where it looks now (follow.js), remembering the terminal it follows when that terminal has
  // the keyboard: shared "workspaces.follow" (tab -> pane), which Changes and Files share and
  // Herdr keeps across restarts (a copy's localStorage wouldn't do: it's keyed by the props as
  // given, and after a restart Herdr hands them back in another order).
  // Render notes it (this.held) and the timer writes it down: never set shared state while rendering.
  // Full size, the space it was opened in (shared "workspaces.screen".space) when that's said.
  place() {
    const p = props() ?? {}, held = this.held, all = panes();
    const last = { ...(shared("workspaces.follow") ?? {}), ...(held ? { [held.tab]: held.pane } : {}) };
    const view = p.screen ? { ...p, space: shared("workspaces.screen")?.space ?? null } : p;
    const loc = locate(view, { spaces: spaces(), panes: all, focused: focused(), last });
    if ((p.beside || p.screen) && loc.pane && loc.tab && all.find((x) => x.pane === loc.pane)?.focused) this.held = { tab: loc.tab, pane: loc.pane };
    return loc;
  }

  // Only a copy in sight writes (follow.js' toRemember): a hidden one holds what it saw last time.
  remember(seen) {
    const next = toRemember({
      held: this.held, seen, last: shared("workspaces.follow") ?? {},
      tabs: spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)),
      ready: machines().filter((x) => x.name && x.layout === "ready").map((x) => x.name),
    });
    if (next) setShared("workspaces.follow", next);
  }

  key() { return placeKey(this.place()); }

  // In sight: full size while it's the view shown, in the space it was opened in; a pane while its
  // tab is shown, no view covers the tabs and no terminal of that tab is zoomed over it.
  seen() {
    const p = props() ?? {}, scr = shared("workspaces.screen") ?? null;
    if (p.screen) return scr?.screen === "changes" && (!scr.space || scr.space === spaces().find((s) => s.active)?.id);
    if (p.beside && p.tab) return !scr && focused()?.tab === p.tab && !panes().some((x) => x.tab === p.tab && x.zoomed && x.terminal);
    return true;
  }

  // Comes into view: read again (full size, take the keyboard); out of view: stop watching.
  tick(cx) {
    const seen = this.seen();
    if (!seen) this.held = null;
    this.remember(seen);
    if (!seen) { if (this.shown) { this.shown = false; this.popOpen = false; this.unwatch(); } return; }
    const back = !this.shown;
    this.shown = true;
    if (back && props()?.screen) this.handle.focus();
    if (back || this.key() !== this.context?.key) this.refresh(cx);
  }

  unwatch() {
    this.watched = null;
    this.watching?.cancel?.();
    this.watching = null;
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          this.watching = watchFolder(root);
          await this.watching;
          if (this.watched === root && this.context && this.selectedPath === normPath(root)) {
            this.loadCheckout(this.selectedPath, this.context, cx);
          }
        }
      } catch { if (this.watched === root) this.watched = null; }
    });
  }

  // One visit to a folder: results from an earlier visit to the same folder are stale too.
  current(context) {
    return this.context === context && this.key() === context.key;
  }

  // Resolve one git checkout's toplevel, common dir and all its non-bare worktrees.
  async probeRepo(dir, on) {
    const rev = await exec("git", [...READ, "rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"], { cwd: dir, on }).catch(() => ({ code: 1, stdout: "" }));
    if (rev.code !== 0) return null;
    const lines = rev.stdout.trim().split(/\r?\n/).filter(Boolean);
    const top = normPath(lines[0] ?? ""), commonDir = normPath(lines[1] ?? "");
    if (!top || !commonDir) return null;
    const wtRes = await exec("git", [...READ, "-c", "core.quotePath=false", "worktree", "list", "--porcelain"], { cwd: top, on }).catch(() => ({ code: 1, stdout: "" }));
    let checkouts = wtRes.code === 0 ? parseWorktrees(wtRes.stdout) : [];
    if (!checkouts.length) {
      const br = await exec("git", [...READ, "branch", "--show-current"], { cwd: top, on }).catch(() => ({ code: 1, stdout: "" }));
      const branch = br.code === 0 ? (br.stdout.trim() || null) : null;
      const hd = branch ? null : await exec("git", [...READ, "rev-parse", "--short", "HEAD"], { cwd: top, on }).catch(() => ({ code: 1, stdout: "" }));
      checkouts = [{ path: top, branch, head: hd?.code === 0 ? hd.stdout.trim() : null, main: true }];
    }
    const mainPath = commonDir.endsWith("/.git") ? commonDir.slice(0, -5) : (checkouts.find((c) => c.main)?.path ?? top);
    return { top, commonDir, mainPath, checkouts };
  }

  // Scan nested folders for `.git` directories/files (stopping descent inside repos).
  async scanNested(cwd, on) {
    const depth = maxScanDepth(cwd, on ? "" : home());
    if (!on && window()?.platform === "windows") {
      const r = await exec("powershell", windowsScanArgs(cwd, depth), { on }).catch(() => ({ code: 1, stdout: "" }));
      return parseScanOutput(r.code === 0 ? r.stdout : "", MAX_REPOS);
    }
    const r = await exec("sh", ["-c", posixScanScript(), "ws-changes-scan", cwd, String(depth), String(MAX_REPOS), String(MAX_DIRS)], { on }).catch(() => ({ code: 1, stdout: "" }));
    return parseScanOutput(r.code === 0 ? r.stdout : "", MAX_REPOS);
  }

  // Read changed-file counts for every checkout in `list` with bounded concurrency.
  async readDirtyCounts(list, on, context, cx, skipPath = null) {
    const todo = list.filter((c) => c.path !== skipPath);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(SLOW, todo.length) }, async () => {
      while (next < todo.length && this.current(context)) {
        const item = todo[next++];
        const s = await exec("git", [...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: item.path, on }).catch(() => ({ code: 1, stdout: "" }));
        if (!this.current(context)) return;
        item.dirty = s.code === 0 ? countPorcelainZ(s.stdout) : null;
        cx.notify();
      }
    }));
  }

  // Preserve known dirty counts across background rescans so badges don't blink to loading.
  carryDirty(repos, prevFlat) {
    const prev = new Map(prevFlat.map((c) => [c.path, c.dirty]));
    for (const r of repos) {
      for (const c of r.checkouts) {
        if (prev.has(c.path)) c.dirty = prev.get(c.path);
      }
    }
  }

  // Switch active checkout within the current visit (user click in rail/popover or ↩ button).
  selectCheckout(targetPath, cx) {
    const path = normPath(targetPath);
    if (!path || !this.context) return;
    const wasPop = this.popOpen;
    this.userPicked = true;
    this.popOpen = false;
    if (wasPop) this.handle.focus();
    if (path === this.selectedPath && this.root === path) { cx.notify(); return; }
    if (this.root && this.message.trim()) this.drafts.set(draftKey(this.root, this.on), this.message);
    const entry = this.flat.find((c) => c.path === path) ?? null;
    this.selectedPath = path;
    this.root = null;
    this.branch = entry?.branchLabel ?? null;
    this.files = [];
    this.open = null;
    this.closed = false;
    this.limited = false;
    this.error = null;
    this.note = null;
    this.setLines([]);
    this.unwatch();
    const saved = this.drafts.get(draftKey(path, this.context.on)) ?? "";
    this.message = saved;
    this.input.set_value(saved);
    cx.notify();
    this.loadCheckout(path, this.context, cx);
  }

  refresh(cx, { force = false } = {}) {
    if (!this.seen()) return; // hidden: no git, no watch
    const loc = this.place(), { cwd, on } = loc, next = placeKey(loc);
    const visitChanged = next !== this.context?.key;
    if (visitChanged) {
      // A typed message waits for the new place's repo: the same repo on the same machine (a cd
      // inside it, a terminal's folder unknown for a moment after a restart) gets it back.
      const stash = this.message.trim() && this.root ? { message: this.message, root: this.root, on: this.on } : this.context?.stash ?? null;
      if (this.root && this.message.trim()) this.drafts.set(draftKey(this.root, this.on), this.message);
      this.context = { key: next, cwd, on, stash };
      this.root = null; this.on = on; this.branch = null; this.files = []; this.open = null;
      this.groups = []; this.flat = []; this.selectedPath = null; this.followedRoot = null;
      this.userPicked = false; this.popOpen = false; this.noRepos = false; this.scanning = false;
      this.filterQuery = ""; this.filterInput.set_value("");
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null;
      this.unwatch(); this.closed = false; this.limited = false; this.loading = false;
      this.loadSeq++;
      cx.notify();
    }
    if (!cwd || this.busy) return;
    const context = this.context;
    const quiet = !visitChanged && !force && (this.flat.length > 0 || this.noRepos);
    if (this.scanning) return;
    this.discover(cwd, on, context, cx, { quiet });
  }

  discover(cwd, on, context, cx, { quiet = false } = {}) {
    this.scanning = true;
    if (!quiet) cx.notify();
    cx.spawn(async (cx) => {
      try {
        const prevFlat = this.flat;
        const userHome = on ? "" : home();
        const direct = await this.probeRepo(cwd, on);
        if (!this.current(context)) return;

        let repos = [];
        let followedRoot = null;
        let realCwd = "";

        if (direct) {
          followedRoot = direct.top;
          repos = [direct];
        } else {
          const scanned = await this.scanNested(cwd, on);
          if (!this.current(context)) return;
          realCwd = scanned.realCwd;
          const seenCommon = new Set();
          let nextIdx = 0;
          await Promise.all(Array.from({ length: Math.min(SLOW, scanned.dirs.length) }, async () => {
            while (nextIdx < scanned.dirs.length && this.current(context)) {
              const dir = scanned.dirs[nextIdx++];
              const rev = await exec("git", [...READ, "rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"], { cwd: dir, on }).catch(() => ({ code: 1, stdout: "" }));
              if (!this.current(context) || rev.code !== 0) continue;
              const lines = rev.stdout.trim().split(/\r?\n/).filter(Boolean);
              const top = normPath(lines[0] ?? ""), commonDir = normPath(lines[1] ?? "");
              if (!top || !commonDir || seenCommon.has(commonDir)) continue;
              seenCommon.add(commonDir);
              const wtRes = await exec("git", [...READ, "-c", "core.quotePath=false", "worktree", "list", "--porcelain"], { cwd: top, on }).catch(() => ({ code: 1, stdout: "" }));
              if (!this.current(context)) return;
              let checkouts = wtRes.code === 0 ? parseWorktrees(wtRes.stdout) : [];
              if (!checkouts.length) checkouts = [{ path: top, branch: null, head: null, main: true }];
              const mainPath = commonDir.endsWith("/.git") ? commonDir.slice(0, -5) : (checkouts.find((c) => c.main)?.path ?? top);
              repos.push({ top, commonDir, mainPath, checkouts });
            }
          }));
        }

        if (!this.current(context)) return;
        if (quiet) this.carryDirty(repos, prevFlat);
        const { groups, flat } = buildGroups({ cwd, realCwd, userHome, repos, followedRoot });

        if (!flat.length) {
          this.groups = []; this.flat = []; this.selectedPath = null; this.followedRoot = null;
          this.root = null; this.branch = null; this.files = []; this.open = null; this.setLines([]);
          this.noRepos = true; this.error = null; this.unwatch();
          return;
        }

        this.groups = groups;
        this.flat = flat;
        this.followedRoot = followedRoot;
        this.noRepos = false;
        this.error = null;
        cx.notify();

        // Non-git folder initial visit: count dirty checkouts first so we auto-open the first
        // dirty checkout (else the first repo) without flashing a clean one first.
        if (!followedRoot && !this.userPicked && !this.selectedPath) {
          if (flat.length > 1) await this.readDirtyCounts(flat, on, context, cx);
          if (!this.current(context)) return;
          if (!this.userPicked && !this.selectedPath) {
            this.selectedPath = pickInitial({ flat: this.flat, followedRoot: null, previousPick: null });
            cx.notify();
            await this.loadCheckout(this.selectedPath, context, cx);
          }
          return;
        }

        const pick = pickInitial({ flat, followedRoot, previousPick: this.selectedPath });
        if (pick !== this.selectedPath) {
          this.selectedPath = pick;
          this.open = null; this.closed = false; this.setLines([]);
          cx.notify();
        }
        const tasks = [this.loadCheckout(pick, context, cx)];
        if (flat.length > 1) tasks.push(this.readDirtyCounts(flat, on, context, cx, pick));
        await Promise.all(tasks);
      } catch (e) {
        if (this.current(context)) this.error = String(e);
      } finally {
        if (this.context === context) this.scanning = false;
        cx.notify();
      }
    });
  }

  async loadCheckout(targetPath, context, cx) {
    const root = normPath(targetPath);
    if (!root || this.busy) return;
    const on = context.on ?? null;
    const seq = ++this.loadSeq;
    const sameRoot = this.root === root;
    if (!sameRoot) { this.loading = true; cx.notify(); }
    try {
      const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
      const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
      if (!this.current(context) || this.loadSeq !== seq) return;
      if (status.code !== 0) throw new Error(status.stderr || "Could not read git status");
      const head = await git(["rev-parse", "--verify", "HEAD"]);
      const stats = {};
      const results = head.code === 0
        ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])]
        : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
      for (const result of results) {
        if (result.code !== 0) throw new Error(result.stderr);
        for (const entry of result.stdout.split("\0")) {
          const [a, d, ...parts] = entry.split("\t");
          if (!parts.length) continue;
          const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
          stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
        }
      }
      const files = [];
      const entries = status.stdout.split("\0").filter(Boolean);
      for (const entry of entries.slice(0, 1000)) {
        const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
        const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
        const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
        const stat = stats[path] ?? { add: 0, del: 0 };
        files.push({ path, status: s, fresh, ...stat });
      }
      if (!this.current(context) || this.loadSeq !== seq) return;

      const entry = this.flat.find((c) => c.path === root);
      if (entry) entry.dirty = entries.length;
      const stash = context.stash;
      context.stash = null;
      if (stash && normPath(stash.root) === root && stash.on === on && !this.message.trim()) {
        this.message = stash.message; this.input.set_value(stash.message);
      } else if (!sameRoot && !this.message.trim()) {
        const saved = this.drafts.get(draftKey(root, on)) ?? "";
        if (saved) { this.message = saved; this.input.set_value(saved); }
      }
      this.root = root; this.on = on; this.branch = entry?.branchLabel ?? this.branch;
      this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
      this.watch(root, cx);
      if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
      // The first file's diff shows until you pick another.
      if (!this.open && !this.closed && files.length) this.open = files[0].path;
      if (this.open) {
        try { await this.load(this.open, context, seq); }
        catch { if (this.current(context) && this.loadSeq === seq) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
      }
    } catch (e) {
      if (this.current(context) && this.loadSeq === seq) this.error = String(e);
    } finally {
      if (this.current(context) && this.loadSeq === seq) this.loading = false;
      cx.notify();
    }
  }

  async load(path, context, seq = this.loadSeq) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (this.current(context) && this.loadSeq === seq && this.open === path) {
      this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
    }
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.longest = Math.max(0, ...this.rows.map(row => displayColumns(row.text)));
    this.gutterChars = Math.max(4, String(Math.max(0, ...this.rows.map(row => row.number ?? 0))).length);
  }

  // Asks the switcher to open a changed file in Files (shared "workspaces.files.open", a short list
  // like "workspaces.view": the newest last, each id once, none older than 15s).
  openInFiles(path) {
    if (!this.root) return;
    const loc = this.place(), now = Date.now(), queue = shared("workspaces.files.open");
    const ask = { path: `${this.root}/${path}`, isDir: false, line: null, on: this.on ?? null, space: loc.space ?? null, tab: loc.tab ?? null, placement: "beside",
      id: `${now}-changes-${Math.random().toString(36).slice(2, 8)}`, at: now };
    setShared("workspaces.files.open", [...(Array.isArray(queue) ? queue : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < 15000), ask].slice(-64));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context, seq = this.loadSeq;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context, seq); }
      catch (e) { if (this.current(context) && this.loadSeq === seq && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context?.key !== this.key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        this.drafts.delete(draftKey(root, on));
        if (this.current(context)) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (this.current(context)) this.note = `Commit failed: ${e}`; }
      finally {
        this.busy = false;
        if (this.current(context)) this.loadCheckout(this.selectedPath ?? root, context, cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  gutter(size) { return Math.ceil(this.gutterChars * charWidth(size)) + 2; }

  diffRow({ kind, number, text }, t, size) {
    const height = rowHeight(size);
    if (kind === "@") return div().w_full().px(12).h(height).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(height).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(this.gutter(size)).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  // Dirty-count pill (amber when dirty, subtle pulsing placeholder while loading, omitted when clean).
  dirtyBadge(dirty, t) {
    if (dirty === null) {
      return div().w(16).h(10).flex_none().rounded(4).bg(t.raised).loop("opacity", { from: 0.35, to: 0.9, period: 1100 });
    }
    if (dirty > 0) {
      return h_flex().h(18).min_w(20).px(6).flex_none().items_center().justify_center().rounded(9)
        .bg(fade(t.working, 0.16)).text_size(11).font_semibold().text_color(t.working).child(String(dirty));
    }
    return null;
  }

  // Shared repo + indented worktree rows for both the left rail and the narrow popover.
  repoRows(t, compact) {
    const filtered = filterGroups(this.groups, this.filterQuery);
    const active = normPath(this.selectedPath);
    const rows = [];
    const herePill = () => h_flex().h(16).px(5).flex_none().items_center().rounded(4)
      .bg(fade(t.accent, 0.14)).text_size(10).text_color(t.accent).child("here");

    for (const g of filtered) {
      if (g.main) {
        const c = g.main, on = active === c.path, badge = this.dirtyBadge(c.dirty, t);
        rows.push(
          h_flex().id(`ch-repo-${compact ? "p-" : ""}${c.path}`).h(30).flex_none().px(8).gap(7).items_center().rounded(6).cursor_pointer()
            .when(on, (e) => e.bg(t.selected)).when(!on, (e) => e.hover((s) => s.bg(t.hover)))
            .tooltip(c.where)
            .on_click((_e, cx) => this.selectCheckout(c.path, cx))
            .child(svg("mods/workspace-chrome/git-branch.svg").size(13).flex_none().text_color(t.muted))
            .child(div().min_w(0).flex_shrink(1).truncate().font_medium().text_size(12.5).text_color(t.foreground).child(g.name))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(c.branchLabel))
            .when(c.isFollowed, (e) => e.child(herePill()))
            .when(Boolean(badge), (e) => e.child(badge))
            .when(compact && on, (e) => e.child(svg("mods/workspace-chrome/check.svg").size(12).flex_none().text_color(t.accent))),
        );
      } else {
        rows.push(
          h_flex().id(`ch-bare-${compact ? "p-" : ""}${g.id}`).h(26).flex_none().px(8).gap(7).items_center().text_size(12).text_color(t.muted)
            .child(svg("mods/workspace-chrome/git-branch.svg").size(12).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).truncate().font_medium().child(g.name)),
        );
      }
      for (const w of g.worktrees) {
        const on = active === w.path, badge = this.dirtyBadge(w.dirty, t);
        rows.push(
          h_flex().id(`ch-wt-${compact ? "p-" : ""}${w.path}`).h(28).flex_none().pl(22).pr(8).gap(7).items_center().rounded(6).cursor_pointer()
            .when(on, (e) => e.bg(t.selected)).when(!on, (e) => e.hover((s) => s.bg(t.hover)))
            .tooltip(w.where)
            .on_click((_e, cx) => this.selectCheckout(w.path, cx))
            .child(svg("mods/workspace-chrome/branch.svg").size(12).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(on ? t.foreground : t.muted).child(w.branchLabel))
            .when(w.isFollowed, (e) => e.child(herePill()))
            .when(Boolean(badge), (e) => e.child(badge))
            .when(compact && on, (e) => e.child(svg("mods/workspace-chrome/check.svg").size(12).flex_none().text_color(t.accent))),
        );
      }
    }
    return rows;
  }

  filterBox(t, id) {
    return div().px(8).pt(8).pb(4).flex_none()
      .child(h_flex().id(id).h(28).px(8).gap(6).items_center().rounded(6).border_1().border_color(this.filtering ? t.accent : t.border).bg(t.background).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_key_down((e, cx) => {
          if (e.key === "escape" && this.filterQuery) {
            this.filterQuery = ""; this.filterInput.set_value(""); cx.stop_propagation(); cx.notify();
          }
        })
        .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).child(Input.new(this.filterInput).text_size(12).text_color(t.foreground)))
        .when(Boolean(this.filterQuery), (e) => e.child(div().id(`${id}-clear`).flex_none().cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.filterQuery = ""; this.filterInput.set_value(""); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(12)))));
  }

  // Wide left rail listing nested repos and indented worktrees (shown when >= 640px and > 1 checkout).
  railView(t, loc, p) {
    const folder = baseName(loc.cwd ?? "") || loc.cwd || "";
    const rows = this.repoRows(t, false);
    const showFilter = this.flat.length > FILTER_THRESHOLD;
    return v_flex().size_full().min_h(0).bg(t.chrome).border_r(1).border_color(t.border)
      .child(h_flex().h(p.screen ? 48 : 36).flex_none().pl(14).pr(8).gap(7).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).flex_shrink(1).truncate().font_semibold().text_size(13).text_color(t.foreground).tooltip(loc.cwd ?? "").child(folder))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(this.flat.length)))
        .child(div().flex_1())
        .child(div().id("changes-rail-refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Refresh repos and worktrees")
          .on_click((_e, cx) => this.refresh(cx, { force: true }))
          .child(svg("mods/ws-files/refresh.svg").size(13))))
      .when(showFilter, (e) => e.child(this.filterBox(t, "changes-rail-filter")))
      .child(v_flex().id("changes-rail-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .children(rows)
        .when(!rows.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child("No matching repos or worktrees"))));
  }

  // Clickable header switcher + anchored popover (used in narrow panes < 640px when > 1 checkout).
  repoSwitcher(t, loc, activeEntry, slim) {
    const labelRepo = activeEntry?.repoName ?? baseName(this.root ?? loc.cwd);
    const labelBranch = activeEntry?.branchLabel ?? this.branch ?? "";
    const isWt = Boolean(activeEntry && !activeEntry.main);
    const trigger = h_flex().id("changes-repo-trigger").h(slim ? 24 : 26).max_w(slim ? 235 : 320).px(8).gap(6).items_center().rounded(6)
      .border_1().border_color(this.popOpen ? t.input : t.border).bg(this.popOpen ? t.hover : t.surface).cursor_pointer()
      .hover((s) => s.bg(t.hover).border_color(t.input))
      .tooltip("Switch repository or worktree")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        this.popOpen = !this.popOpen;
        if (this.popOpen && !this.scanning) this.refresh(cx);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/${isWt ? "branch" : "git-branch"}.svg`).size(12).flex_none().text_color(t.muted))
      .child(div().min_w(0).flex_shrink(1).truncate().font_medium().text_size(slim ? 11.5 : 12).text_color(t.foreground).child(labelRepo))
      .when(Boolean(labelBranch), (e) => e.child(div().min_w(0).flex_shrink(2).truncate().text_size(slim ? 11.5 : 12).text_color(t.dim).child(`· ${labelBranch}`)))
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).flex_none().text_color(t.dim));

    const rows = this.repoRows(t, true);
    const showFilter = this.flat.length > FILTER_THRESHOLD;
    const folder = baseName(loc.cwd ?? "") || loc.cwd || "";
    const listH = Math.min(300, Math.max(44, rows.length * 30 + 12));
    const pop = v_flex().id("changes-repo-menu").w(300).mt(4).rounded(8).shadow_md().border_1().border_color(t.border).bg(t.popover).text_size(12.5).text_color(t.foreground)
      .on_mouse_down_out((_e, cx) => { this.popOpen = false; cx.notify(); })
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(h_flex().h(30).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(this.followedRoot ? `${folder} checkouts` : `Repos in ${folder}`))
        .child(div().flex_none().child(`${this.flat.length} checkouts`))
        .child(div().id("changes-pop-refresh").size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Refresh")
          .on_click((_e, cx) => this.refresh(cx, { force: true }))
          .child(svg("mods/ws-files/refresh.svg").size(11))))
      .when(showFilter, (e) => e.child(this.filterBox(t, "changes-pop-filter")))
      .child(v_flex().id("changes-pop-list").h(listH).overflow_y_scrollbar().p(5).gap(1)
        .children(rows)
        .when(!rows.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child("No matching repos or worktrees"))));

    return Popup.new("changes-repo-popup", trigger).when(this.popOpen, (el) => el.content(pop));
  }

  // Its first row: Herdr's title row (a card of its own), the view's header (full size),
  // or one slim row under the pane's own header (a pane beside the terminals).
  head(t, add, del, loc, showSwitcher) {
    const p = props() ?? {};
    const activeEntry = this.flat.find((c) => c.path === normPath(this.selectedPath)) ?? null;
    const followedEntry = this.followedRoot ? this.flat.find((c) => c.path === this.followedRoot) : null;
    const canReturn = Boolean(this.followedRoot && activeEntry && activeEntry.path !== this.followedRoot);
    const returnBtn = canReturn
      ? div().id("changes-return-followed").size(24).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(followedEntry ? `Back to ${followedEntry.repoName} (${followedEntry.branchLabel})` : "Back to followed checkout")
          .on_click((_e, cx) => this.selectCheckout(this.followedRoot, cx))
          .child(svg("mods/ws-files/undo.svg").size(12))
      : null;

    if (!p.screen && !p.beside) {
      return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .when(showSwitcher, (e) => e.child(this.repoSwitcher(t, loc, activeEntry, true)))
        .when(!showSwitcher, (e) => e.child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`)))
        .when(Boolean(returnBtn), (e) => e.child(returnBtn))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`));
    }
    const paneBranch = loc.pane ? panes().find((x) => x.pane === loc.pane)?.branch : null;
    const branch = activeEntry?.branchLabel ?? this.branch ?? (this.root ? paneBranch : null);
    const repoName = activeEntry?.repoName ?? baseName(this.root ?? loc.cwd);
    const where = this.noRepos ? baseName(loc.cwd ?? "") : [repoName, this.root || activeEntry ? branch : null].filter(Boolean).join(" · ");
    const totals = this.files.length
      ? [div().flex_none().text_color(t.ansi2).child(`+${add}`), div().flex_none().text_color(t.ansi1).child(`−${del}`),
        div().flex_none().text_color(t.dim).child(`· ${this.files.length} ${this.files.length === 1 ? "file" : "files"}${this.limited ? "+" : ""}`)]
      : [];
    if (p.screen) {
      return h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/ws-changes/changes.svg").size(16).flex_none().text_color(t.muted))
        .child(div().flex_none().font_semibold().child("Changes"))
        .when(showSwitcher, (e) => e.child(this.repoSwitcher(t, loc, activeEntry, false)))
        .when(!showSwitcher, (e) => e.child(div().min_w(0).flex_shrink(1).truncate().text_size(12).text_color(t.dim).child(where)))
        .when(Boolean(returnBtn), (e) => e.child(returnBtn))
        .child(div().flex_1())
        .child(h_flex().flex_none().gap(6).text_size(12).children(totals));
    }
    return h_flex().h(32).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
      .when(showSwitcher, (e) => e.child(this.repoSwitcher(t, loc, activeEntry, true)))
      .when(!showSwitcher, (e) => e.child(div().min_w(0).flex_shrink(1).truncate().text_color(t.dim).child(where)))
      .when(Boolean(returnBtn), (e) => e.child(returnBtn))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(6).children(totals));
  }

  emptyNoRepos(t, loc) {
    const folder = baseName(loc.cwd ?? "") || loc.cwd || "this folder";
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(8).p(24)
      .child(div().size(38).rounded(9).border_1().border_color(t.border).bg(t.surface).flex().items_center().justify_center()
        .child(svg("mods/ws-changes/changes.svg").size(16).text_color(t.muted)))
      .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(`No git repositories in ${folder}`))
      .child(div().max_w(380).text_size(12).text_color(t.dim).text_center()
        .child("This folder isn't a git repository, and no nested repositories were found inside it."));
  }

  viewer(t, size, add, del, loc, showSwitcher, enabled) {
    return v_flex().size_full().min_h(0).min_w(0).bg(t.background)
      .child(this.head(t, add, del, loc, showSwitcher))
      .when(this.noRepos, (e) => e.child(this.emptyNoRepos(t, loc)))
      .when(!this.noRepos, (e) => e
        // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
        .child(div().flex_1().min_h(44).max_h(this.files.length * 28 + 12).relative().border_b(1).border_color(t.border)
          .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => {
            const parts = f.path.split("/"), name = parts.pop();
            return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
              .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
              .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
              .when(f.add > 0, (el) => el.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (el) => el.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
              .when(this.open === f.path && f.status !== "D", (el) => el.child(div().id(`change-files-${f.path}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.muted)
                .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Open in Files")
                .on_click((_e, cx) => { cx.stop_propagation(); this.openInFiles(f.path); })
                .child(svg("mods/ws-files/external-link.svg").size(12))));
          })).when(!this.files.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.error || (this.loading || this.scanning ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
          .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
        .when(this.limited, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
        .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(size)
          .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
            .child(div().w_full().min_w(Math.max(300, this.longest * charWidth(size) + this.gutter(size) + 20)).h_full().child(v_virtual_list("changes-diff", this.rows.length, rowHeight(size), (i) => String(i),
              (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t, size))).size_full())))
          .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
          .when(!this.open && this.files.length > 0, (el) => el.child(div().absolute().top(6).px(12).text_size(11).text_color(t.dim).child("Select a file to view its changes"))))
        .when(Boolean(this.note), (el) => el.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
        .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
          .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
          .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (el) => el.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit"))));
  }

  render(cx) {
    const loc = this.place(); // a focus change is remembered at once
    const p = props() ?? {};
    const t = theme(), cfg = settings(), size = cfg.font_size;
    const add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    // Not while what's shown is a place behind (the timer hasn't read the new one yet): it would do nothing.
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading && this.context?.key === this.key());
    // A card of its own only where nothing frames it (Herdr's panel); a pane's frame or the view's area is the card.
    const card = !p.screen && !p.beside;
    const width = this.size?.width ?? 0;
    const zoom = Number(cfg.zoom) > 0 ? Number(cfg.zoom) : 1;
    const logicalW = width > 0 ? width / zoom : 0;
    const narrow = logicalW > 0 ? logicalW < NARROW : Boolean(p.beside);
    const multi = this.flat.length > 1;
    const showRail = multi && !narrow;
    const showSwitcher = multi && narrow;
    const content = this.viewer(t, size, add, del, loc, showSwitcher, enabled);
    const body = showRail
      ? h_resizable("ws-changes-main").size_full()
          .child(resizable_panel().size(RAIL).size_range(180, 380).child(this.railView(t, loc, p)))
          .child(resizable_panel().child(content))
      : content;

    return v_flex().id("changes").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .when(card, (e) => e.rounded(10).border_1().border_color(t.border))
      .on_size_change((s, cx) => {
        if (s.width === this.size?.width && s.height === this.size?.height) return;
        this.size = { width: s.width, height: s.height };
        const z = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
        if (s.width / z >= NARROW) this.popOpen = false;
        cx.notify();
      })
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.popOpen) { this.popOpen = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); return; }
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(body);
  }
}
