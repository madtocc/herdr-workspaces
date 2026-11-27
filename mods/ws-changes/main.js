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
// 8. UX fixes (from the audit of package 0.33.0): Commit says what it takes ("Commit all 4 files", the box "Message for
//    all changes"); each of its steps may take 10 minutes (hooks), and running out says what
//    happened instead of "failed" (staging gave up; nothing committed; or committed while a hook ran on); a cut diff ends with "… 2,340 more lines not shown"; the
//    nested scan says when it stopped at 40 repos or 500 folders (repos.js stopWords); cut paths
//    have a tooltip; Open in Files says "Show the sidebar to do this" while the switcher's sidebar
//    copy is away (shared "workspaces.switcher.alive").
//    Small fixes: Commit is grey with nothing to commit, a failure gives git's first line and last
//    two (no "Error:"), a commit says "Committed 4 files to main"; counts read "1,000+ files"; the picker's
//    filter takes the keyboard (and gives it back when the picker's button closes it) and Enter takes the
//    first checkout that matches (repos.js firstMatch); no tooltip on the picker while
//    it's open; the filter's × is a 20px target.
//    Options the owner accepted: new files' rows and the header count their lines (repos.js
//    NEW_LINES_SH, one bounded run per load); ↑ ↓ step through the files where Changes has the
//    keyboard (nextFile); a file's right-click menu has Open in Files, Copy path and Discard changes…,
//    which asks in place and restores the file from HEAD or moves a new one to the Trash
//    (rowMenuItems, discardPlan, discardAsk).
// 9. The git brake, from Herdr 0.1.18's Changes (gitscan.js, copied in ws-files): the checkout's
//    status and every worktree's count go through one shared git status per repo; a file event
//    reads again only once the last status allows, the repos and counts on the poll (10s, longer
//    after a slow status), nothing while the window is behind; with only new files, no HEAD or
//    numstat runs.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, Popup, h_resizable, resizable_panel, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, readTextFile, watchFolder, theme, settings, props, shared, setShared, checking, machines, home, window } from "herdr";
import { exec } from "./posix.js";
import { locate, toRemember, placeKey } from "./follow.js";
import { repoStatus, dueNow, statusRequest, settleRequest } from "./gitscan.js";
import {
  SKIP_DIRS, MAX_REPOS, MAX_DIRS, FILTER_THRESHOLD,
  normPath, baseName, maxScanDepth,
  parseWorktrees, countPorcelainZ, parseScanOutput, posixScanScript,
  buildGroups, pickInitial, filterGroups, firstMatch, stopWords, NEW_LINES_SH, NEW_LINES_MAX, newLinesArgs, parseNewLines, nextFile, parseGitlinks,
  rowMenuItems, discardPlan, discardAsk,
} from "./repos.js";

const NARROW = 640, RAIL = 248, SLOW = 6;
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
// The pointer's place as a key: a move at the same place is no move (the menus' pointer rule, as the
// Agents list and History have it).
const pointKey = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? `${p.x},${p.y}` : undefined);
// To the Trash, as Files' right-click menu does it (a copy of ws-files/main.js' TRASH): trash (macOS 15
// and later), else gio, else ~/.herdr/trash on that machine. Exit 4: it wasn't there.
const TRASH = `[ -e "$1" ] || [ -L "$1" ] || exit 4
if command -v trash >/dev/null 2>&1 && trash "$1"; then echo Trash; exit 0; fi
if command -v gio >/dev/null 2>&1 && gio trash "$1"; then echo Trash; exit 0; fi
dest="$HOME/.herdr/trash"; mkdir -p "$dest" && mv -- "$1" "$dest/$(basename -- "$1")-$(date +%s)" && echo "$dest"`;
const ASK_WAIT = 500;
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
const wideGlyph = /[\p{Ideographic}\p{Emoji_Presentation}\p{Extended_Pictographic}\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/gu;
const fade = (c, a) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? `${c}${Math.round(a * 255).toString(16).padStart(2, "0")}` : c);
const draftKey = (root, on) => `${on ?? ""}::${normPath(root)}`;
// A commit's two steps (add, commit) may each take this long: hooks that lint or test. Herdr's cap.
const COMMIT_TIMEOUT = 600000;
// The diff shows this many lines; a last row says how many more there are.
const DIFF_LINES = 1500;
const SCAN = { exec, active: () => window()?.active !== false };
// 2340 → "2,340" (the mods' JavaScript has no grouping in toLocaleString).
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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

// Bounded nested-repo scan for local Windows (matches posixScanScript's NUL output, its
// ":stopped:" token included).
function windowsScanArgs(cwd, maxDepth) {
  const skip = SKIP_DIRS.map((s) => `'${s}'`).join(",");
  const escaped = String(cwd ?? "").replace(/['‘’‚‛]/g, "$&$&");
  const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($root,$max,$maxR,$maxD) $skip=@(${skip}); $real=(Resolve-Path -LiteralPath $root -ErrorAction SilentlyContinue).Path; if(-not $real){$real=$root}; $out=[System.Collections.Generic.List[string]]::new(); $out.Add($real); $cnt=0; $vis=0; function walk($d,$dep){ if($dep -gt $max -or $script:cnt -ge $maxR -or $script:vis -gt $maxD){return}; foreach($c in (Get-ChildItem -LiteralPath $d -Directory -ErrorAction SilentlyContinue)){ if($c.Name.StartsWith('.') -or $skip -contains $c.Name){continue}; $script:vis++; if($script:vis -gt $maxD){$script:stop='dirs'; return}; if(Test-Path -LiteralPath (Join-Path $c.FullName '.git')){ $out.Add($c.FullName); $script:cnt++; if($script:cnt -ge $maxR){$script:stop='repos'; return} } elseif($dep -lt $max){ walk $c.FullName ($dep+1) } } }; walk $root 1; if($script:stop){ $out.Add(':stopped:' + $script:stop) }; [Console]::Write(($out -join [char]0)) } '${escaped}' ${maxDepth} ${MAX_REPOS} ${MAX_DIRS}`;
  return ["-NoProfile", "-Command", script];
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.longest = 0; this.gutterChars = 4; this.message = ""; this.handle = cx.focus_handle();
    this.size = null; this.railW = RAIL; this.listScroll = ScrollHandle.new();
    this.groups = []; this.flat = []; this.selectedPath = null; this.followedRoot = null; this.branch = null;
    this.userPicked = false; this.popOpen = false; this.scanning = false; this.noRepos = false;
    this.loadSeq = 0; this.drafts = new Map();
    this.filterQuery = ""; this.filtering = false;
    this.input = InputState.new({ placeholder: "Message for all changes" });
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
    // Not while the row menu or its question is up, nor right after Enter answered it: that Enter was theirs.
    this.input.on("submit", (_e, cx) => { const d = Date.now() - (this.rowKeyAt ?? 0); if (this.rowMenu || (d >= 0 && d < 300)) return; this.commit(cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.filterInput = InputState.new({ placeholder: "Filter repos & worktrees…" });
    this.filterInput.on("change", (_e, cx) => { this.filterQuery = this.filterInput.value(); cx.notify(); });
    this.filterInput.on("focus", (_e, cx) => { this.filtering = true; cx.notify(); });
    this.filterInput.on("blur", (_e, cx) => { this.filtering = false; cx.notify(); });
    // Enter takes the first checkout the filter leaves, as a click on it does.
    this.filterInput.on("submit", (_e, cx) => {
      const c = firstMatch(this.groups, this.filterQuery);
      if (c) this.selectCheckout(c.path, cx);
    });
    this.shown = false;
    if (!checking()) {
      this.refresh(cx);
      cx.timer.every(500, (cx) => this.refreshIfDue(cx));
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
    if (!seen) { if (this.shown) { this.shown = false; this.popOpen = false; this.popTook = false; this.rowMenu = null; this.unwatch(); } return; }
    const back = !this.shown;
    this.shown = true;
    if (back && props()?.screen) this.handle.focus();
    if (back || this.key() !== this.context?.key) this.refresh(cx);
  }

  // The brake (gitscan.js, as Herdr 0.1.18's Changes): a file event reads the checkout again once
  // the last status allows (watchAt); the repos, their worktrees and every count only on the poll
  // (pollAt: 10s, longer after a slow status); nothing while the window is behind, one catch-up
  // when it's in front again; nothing while a read or a commit runs.
  refreshIfDue(cx) {
    const active = window()?.active !== false, context = this.context;
    const refocused = active && this.windowActive === false;
    this.windowActive = active;
    if (!context || !this.shown) return;
    const busy = Boolean(this.busy || this.loading || this.scanning || this.reading);
    const due = dueNow(context, Date.now(), { active: active && !busy, refocused, watched: Boolean(this.watched) });
    if (due === "poll") this.refresh(cx, { due: true });
    else if (due === "dirty" && this.selectedPath) {
      const req = statusRequest(context, Date.now());
      cx.spawn(async (cx) => this.loadCheckout(this.selectedPath, context, cx, req));
    }
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
          const paths = await this.watching;
          // A change: read again when the brake allows (refreshIfDue), not at once.
          if ((!Array.isArray(paths) || paths.length) && this.watched === root && this.context && this.selectedPath === normPath(root)) {
            this.context.dirtyAt = Date.now() + 1;
            this.refreshIfDue(cx);
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
    // Windows: Git's sh scans in a tenth of PowerShell's time; PowerShell only when there's no sh.
    const win = !on && window()?.platform === "windows";
    const r = await exec("sh", ["-c", posixScanScript(), "ws-changes-scan", win ? String(cwd).replace(/\\/g, "/") : cwd, String(depth), String(MAX_REPOS), String(MAX_DIRS)], { on }).catch(() => null);
    if (!r && win) {
      const w = await exec("powershell", windowsScanArgs(cwd, depth), { on }).catch(() => ({ code: 1, stdout: "" }));
      return parseScanOutput(w.code === 0 ? w.stdout : "", MAX_REPOS);
    }
    if (!r) return parseScanOutput("", MAX_REPOS);
    return parseScanOutput(r.code === 0 ? r.stdout : "", MAX_REPOS);
  }

  // Read changed-file counts for every checkout in `list` with bounded concurrency, through the shared
  // scan (gitscan.js): a fresh status of that checkout (Files', another copy's) is used again.
  async readDirtyCounts(list, on, context, cx, skipPath = null, req = null) {
    const todo = list.filter((c) => c.path !== skipPath);
    const ask = req?.urgent ? { ...req } : { after: 0, visiting: false, urgent: false, allowInactive: Boolean(req?.allowInactive) };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(SLOW, todo.length) }, async () => {
      while (next < todo.length && this.current(context)) {
        const item = todo[next++];
        const scan = await repoStatus(item.path, on, ask, cx, () => this.current(context), SCAN).catch(() => null);
        if (!this.current(context)) return;
        if (!scan) continue; // the window is behind: the count it had stays
        item.dirty = scan.status?.code === 0 ? countPorcelainZ(scan.status.stdout) : null;
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

  // The picker closed without a pick (its button, Esc, a press outside): when its filter took the
  // keyboard on opening, it goes back to the message box if that had it, else to the view. Not on
  // `this.filtering`: by the click, the frame drawn without the filter has already blurred it. A press
  // outside runs this in the capture phase, so whatever it lands on still takes the keyboard after.
  // A press outside that lands on nothing taking the keyboard (the counts text, the diff: the view's
  // root takes it) gets the message box back on its release (`popRefocus`, the root's on_mouse_up).
  closePop(outside = false) {
    this.popOpen = false;
    if (!this.popTook) return;
    this.popTook = false;
    if (this.popBack) this.input.focus(); else this.handle.focus();
    if (outside && this.popBack) this.popRefocus = Date.now();
  }

  refocusAfterPress() {
    const at = this.popRefocus;
    this.popRefocus = 0;
    if (at && Date.now() - at < 2000 && this.handle.is_focused()) this.input.focus();
  }

  // Switch active checkout within the current visit (user click in rail/popover or ↩ button).
  selectCheckout(targetPath, cx) {
    const path = normPath(targetPath);
    if (!path || !this.context) return;
    const wasPop = this.popOpen, back = this.popTook && this.popBack;
    this.userPicked = true;
    this.popOpen = false; this.popTook = false; this.rowMenu = null;
    // A pick from the picker: the keyboard where it was when the picker opened (the message box), else the view.
    if (wasPop) { if (back) this.input.focus(); else this.handle.focus(); }
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
    const context = this.context;
    cx.spawn(async (cx) => this.loadCheckout(path, context, cx));
  }

  // due: the brake's poll (refreshIfDue); anything else (a new place, coming into view, Refresh) reads
  // a fresh status.
  refresh(cx, { force = false, due = false } = {}) {
    if (!this.seen()) return; // hidden: no git, no watch
    const loc = this.place(), { cwd, on } = loc, next = placeKey(loc);
    const visitChanged = next !== this.context?.key;
    if (visitChanged) {
      // A typed message waits for the new place's repo: the same repo on the same machine (a cd
      // inside it, a terminal's folder unknown for a moment after a restart) gets it back.
      const stash = this.message.trim() && this.root ? { message: this.message, root: this.root, on: this.on } : this.context?.stash ?? null;
      if (this.root && this.message.trim()) this.drafts.set(draftKey(this.root, this.on), this.message);
      this.context = { key: next, cwd, on, stash, dirtyAt: 0 };
      this.root = null; this.on = on; this.branch = null; this.files = []; this.open = null;
      this.groups = []; this.flat = []; this.selectedPath = null; this.followedRoot = null;
      this.userPicked = false; this.popOpen = false; this.popTook = false; this.rowMenu = null; this.noRepos = false; this.scanning = false;
      this.filterQuery = ""; this.filterInput.set_value(""); this.scanStop = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null;
      this.unwatch(); this.closed = false; this.limited = false; this.loading = false;
      this.loadSeq++;
      cx.notify();
    }
    if (!cwd) { this.context.pollAt = Date.now() + 10000; return; }
    if (this.busy) return;
    const context = this.context;
    const quiet = !visitChanged && !force && (this.flat.length > 0 || this.noRepos);
    if (this.scanning) return;
    const req = statusRequest(context, Date.now(), { force: !due && !visitChanged, visiting: visitChanged });
    this.discover(cwd, on, context, cx, { quiet, req });
  }

  discover(cwd, on, context, cx, { quiet = false, req = null } = {}) {
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
        let stopped = null;

        if (direct) {
          followedRoot = direct.top;
          repos = [direct];
        } else {
          const scanned = await this.scanNested(cwd, on);
          if (!this.current(context)) return;
          realCwd = scanned.realCwd; stopped = scanned.stopped;
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
        this.scanStop = stopped;
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
          if (flat.length > 1) await this.readDirtyCounts(flat, on, context, cx, null, req);
          if (!this.current(context)) return;
          if (!this.userPicked && !this.selectedPath) {
            this.selectedPath = pickInitial({ flat: this.flat, followedRoot: null, previousPick: null });
            cx.notify();
            await this.loadCheckout(this.selectedPath, context, cx, req);
          }
          return;
        }

        const pick = pickInitial({ flat, followedRoot, previousPick: this.selectedPath });
        if (pick !== this.selectedPath) {
          this.selectedPath = pick;
          this.open = null; this.closed = false; this.setLines([]);
          cx.notify();
        }
        const tasks = [this.loadCheckout(pick, context, cx, req)];
        if (flat.length > 1) tasks.push(this.readDirtyCounts(flat, on, context, cx, pick, req));
        await Promise.all(tasks);
      } catch (e) {
        if (this.current(context)) this.error = String(e);
      } finally {
        if (this.context === context) this.scanning = false;
        cx.notify();
      }
    });
  }

  // One checkout's changes. Its status comes through the shared scan (gitscan.js); req is the read's
  // request (statusRequest), a fresh one (a click, a commit) when none is given. With only new files,
  // no HEAD or numstat runs (as Herdr 0.1.18).
  async loadCheckout(targetPath, context, cx, req = null) {
    const root = normPath(targetPath);
    if (!root || this.busy) return;
    const on = context.on ?? null;
    const seq = ++this.loadSeq;
    const sameRoot = this.root === root;
    if (!sameRoot) { this.loading = true; cx.notify(); }
    this.reading = seq;
    req ??= statusRequest(context, Date.now(), { force: true });
    try {
      const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
      const scan = await repoStatus(root, on, req, cx, () => this.current(context) && this.loadSeq === seq, SCAN);
      if (!scan || !this.current(context) || this.loadSeq !== seq) return;
      settleRequest(context, req, scan);
      if (scan.error) throw scan.error;
      const status = scan.status;
      if (status.code !== 0) throw new Error(status.stderr || "Could not read git status");
      const tracked = status.stdout.split("\0").filter(Boolean).slice(0, 1000).some((entry) => !entry.startsWith("??"));
      const head = tracked ? await git(["rev-parse", "--verify", "HEAD"]) : { code: 1 };
      const stats = {};
      const results = !tracked ? [] : head.code === 0
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
        files.push({ path, status: s, fresh, xy, ...stat });
      }
      // A staged new path that is a repository of its own (a gitlink, mode 160000: what Commit's git add -A
      // leaves after a hook failed) gets no Discard changes… (repos.js rowMenuItems).
      const added = files.filter((f) => !f.fresh && f.xy.includes("A")).slice(0, NEW_LINES_MAX).map((f) => f.path);
      if (added.length) {
        const r = await exec("git", [...READ, "--literal-pathspecs", "ls-files", "-s", "-z", "--", ...added], { cwd: root, on }).catch(() => null);
        const links = r?.code === 0 ? parseGitlinks(r.stdout) : new Set();
        for (const f of files) if (links.has(f.path)) f.gitlink = true;
      }
      // New files' lines (numstat leaves untracked ones out), one bounded run, so their rows and the
      // header count them (repos.js NEW_LINES_SH). A failure only leaves them uncounted.
      const fresh = files.filter((f) => f.fresh || (head.code !== 0 && f.status === "A" && !f.add)).slice(0, NEW_LINES_MAX);
      if (fresh.length) {
        const r = await exec("sh", ["-c", NEW_LINES_SH, "lines", ...newLinesArgs(fresh.map((f) => f.path))], { cwd: root, on }).catch(() => null);
        const counts = r?.code === 0 ? parseNewLines(r.stdout, fresh.map((f) => f.path)) : {};
        for (const f of fresh) if (counts[f.path] !== undefined) f.add = counts[f.path];
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
      if (this.rowMenu && !files.some((f) => f.path === this.rowMenu.path)) this.rowMenu = null; // its file left the list
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
      if (this.reading === seq) this.reading = 0;
      cx.notify();
    }
  }

  async load(path, context, seq = this.loadSeq) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines, total = null;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text); total = file.add + 1;
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, DIFF_LINES).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "--literal-pathspecs", "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (this.current(context) && this.loadSeq === seq && this.open === path) {
      const shown = lines.slice(0, DIFF_LINES).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line);
      // A diff that was cut says so at its end (a plain row, diffRows).
      const more = (total ?? lines.length) - shown.length;
      if (more > 0) shown.push(`… ${grouped(more)} more line${more === 1 ? "" : "s"} not shown`);
      this.setLines(shown);
    }
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.longest = Math.max(0, ...this.rows.map(row => displayColumns(row.text)));
    this.gutterChars = Math.max(4, String(Math.max(0, ...this.rows.map(row => row.number ?? 0))).length);
  }

  // Asks the switcher to open a changed file in Files (shared "workspaces.files.open", a short list
  // like "workspaces.view": the newest last, each id once, none older than 15s).
  // While the switcher's sidebar copy is away (shared "workspaces.switcher.alive" missing or older
  // than 15s), nobody would drain the ask: the note line says so instead.
  openInFiles(path, cx) {
    if (!this.root) return;
    const loc = this.place(), now = Date.now(), queue = shared("workspaces.files.open");
    const alive = Number(shared("workspaces.switcher.alive")?.at);
    if (!Number.isFinite(alive) || now - alive > 15000) { this.note = "Show the sidebar to do this"; this.noteTone = "quiet"; cx.notify(); return; }
    const ask = { path: `${this.root}/${path}`, isDir: false, line: null, on: this.on ?? null, space: loc.space ?? null, tab: loc.tab ?? null, placement: "beside",
      id: `${now}-changes-${Math.random().toString(36).slice(2, 8)}`, at: now };
    setShared("workspaces.files.open", [...(Array.isArray(queue) ? queue : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < 15000), ask].slice(-64));
  }

  // A changed file's right-click menu: Open in Files, Copy path, Discard changes… (repos.js
  // rowMenuItems), a Popup at the pointer. The right-click doesn't take the keyboard (the row stops the
  // mouse-down, so a terminal beside Changes keeps it); its keys work where Changes already has it.
  // One lit row, which Enter runs; the pointer takes it only once it moves from the press.
  openRowMenu(e, f, cx) {
    cx.stop_propagation();
    if (this.busy || this.discarding) return;
    const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
    const at = e.local_position ?? { x: 24 * zoom, y: 14 * zoom };
    this.rowMenu = { path: f.path, x: at.x / zoom, y: at.y / zoom, at: 0, askAt: 0 };
    this.pointerLast = pointKey(e.position);
    cx.notify();
  }

  closeRowMenu() { this.rowMenu = null; }

  pointerRow(i, e, cx) {
    const here = pointKey(e?.position);
    if (here === undefined || here === this.pointerLast) return;
    const first = this.pointerLast === undefined;
    this.pointerLast = here;
    if (first || !this.rowMenu) return; // no press known: the first move is only where it rests
    if (this.rowMenu.at !== i) { this.rowMenu.at = i; cx.notify(); }
  }

  rowMenuView(t, f) {
    const m = this.rowMenu, name = baseName(f.path);
    const items = rowMenuItems(f).filter((id) => id !== null), plan = discardPlan(f.xy, this.hasHead, f.path);
    const label = { open: "Open in Files", copy: "Copy path", discard: "Discard changes…" };
    const box = v_flex().id("ch-row-menu").p(5).rounded(8).shadow_md().border_1().border_color(t.border).bg(t.popover).text_size(12.5).text_color(t.foreground)
      .on_mouse_down_out((_e, cx) => { this.closeRowMenu(); cx.notify(); })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    let content;
    if (m.askAt) {
      // Discard changes… asks in place, naming the file; a press within 500 ms doesn't count.
      const ask = discardAsk(name, plan);
      content = box.w(280).p(10).gap(8)
        .child(div().font_medium().child(ask.title))
        .child(div().text_size(11.5).text_color(t.muted).child(ask.body))
        .child(h_flex().gap(8).justify_end()
          .child(h_flex().id("ch-row-ask-no").h(26).px(10).items_center().rounded(6).cursor_pointer().text_color(t.muted).hover((x) => x.bg(t.hover)).on_click((_e, cx) => { this.closeRowMenu(); cx.notify(); }).child("Cancel"))
          .child(h_flex().id("ch-row-ask-yes").h(26).px(10).items_center().rounded(6).cursor_pointer().bg(t.blocked).text_color(t.solid_foreground).hover((x) => x.opacity(0.9))
            .on_click((_e, cx) => this.confirmDiscard(f, plan, cx)).child(ask.button)));
    } else {
      let k = 0;
      content = box.w(200).children(rowMenuItems(f).map((id) => {
        if (id === null) return div().h(1).my(4).bg(t.border);
        const i = k++;
        return h_flex().id(`ch-row-${id}`).h(28).px(8).items_center().rounded(6).cursor_pointer()
          .when(id === "discard", (el) => el.text_color(t.blocked))
          .when(i === m.at, (el) => el.bg(t.selected))
          .on_mouse_move((e, cx) => this.pointerRow(i, e, cx))
          .on_click((_e, cx) => this.rowMenuPick(id, f, cx))
          .child(label[id]);
      }));
    }
    return Popup.new("ch-row-popup", div().size(0)).absolute().left(m.x).top(m.y).anchor("top_left").content(content);
  }

  rowMenuPick(id, f, cx) {
    if (id === "open") { this.closeRowMenu(); this.openInFiles(f.path, cx); }
    else if (id === "copy") {
      this.closeRowMenu();
      const p = `${this.root}/${f.path}`;
      cx.write_to_clipboard(!this.on && window()?.platform === "windows" ? p.replace(/\//g, "\\") : p);
    }
    else if (id === "discard") { this.rowMenu.askAt = Date.now(); }
    cx.notify();
  }

  confirmDiscard(f, plan, cx) {
    if (this.busy || this.discarding) return; // never beside a commit's git add -A
    const d = Date.now() - (this.rowMenu?.askAt ?? 0);
    if (!this.rowMenu?.askAt || (d >= 0 && d < ASK_WAIT)) return; // a double-click only asks
    this.closeRowMenu();
    // Another row whose path differs only in case (or in Unicode spelling) may be the same file on this
    // disk (a caseless one: git mv Foo foo, or core.ignorecase off); discardFile's step asks the disk.
    const fold = (p) => p.normalize("NFC").toLowerCase();
    const twin = this.files.find((o) => o.path !== f.path && fold(o.path) === fold(f.path))?.path ?? null;
    this.discardFile(f.path, plan, cx, twin);
    cx.notify();
  }

  // Esc closes it; ↑ ↓ move the lit row and Enter runs it (not a held one). While it asks, Enter
  // (after 500 ms, not held) discards and any other key takes the question back.
  rowMenuKey(e, cx) {
    const m = this.rowMenu, f = this.files.find((x) => x.path === m.path);
    if (!f) { this.closeRowMenu(); return false; }
    cx.stop_propagation();
    if (e.key === "enter") this.rowKeyAt = Date.now(); // the message box's submit then knows it was the menu's
    if (e.key === "escape") { this.closeRowMenu(); cx.notify(); return true; }
    if (m.askAt) {
      if (e.key === "enter") { if (!e.is_held) this.confirmDiscard(f, discardPlan(f.xy, this.hasHead, f.path), cx); return true; }
      this.closeRowMenu(); cx.notify(); return true;
    }
    const items = rowMenuItems(f).filter((id) => id !== null), n = items.length;
    if (e.key === "down") m.at = (m.at + 1) % n;
    else if (e.key === "up") m.at = (m.at + n - 1) % n;
    else if (e.key === "enter") { if (!e.is_held) this.rowMenuPick(items[Math.min(m.at, n - 1)], f, cx); return true; }
    else return true; // the menu has the keys while it's open
    cx.notify();
    return true;
  }

  // Discard changes…, answered: git checkout HEAD -- path (the file as the last commit has it), or a
  // new file to the Trash (out of the index first when it was staged). The list reads again after.
  discardFile(path, plan, cx, twin = null) {
    const root = this.root, on = this.on, context = this.context, name = baseName(path);
    if (!root || !plan) return;
    this.discarding = true; this.note = null; this.noteTone = null;
    cx.spawn(async (cx) => {
      let note = null;
      try {
        // Nothing but the named path may change. The step asks the disk: 0 a real folder at the path (a
        // repository of its own, a submodule, a folder that took a deleted file's name, whose new files git
        // checkout would delete); 3 the row that differs only in case is this same file on this disk; 2 a
        // file or link at any name above the path (git would delete it to make the folder; it prints which);
        // 1 go on. It guards a delete, so it fails closed: anything but 1 (a throw, a timeout) stops.
        const g = await exec("sh", ["-c", '[ -d "$1" ] && [ ! -L "$1" ] && exit 0; [ -n "${3:-}" ] && [ -e "$1" ] && [ "$1" -ef "$3" ] && exit 3; p=${1%/*}; while [ "${#p}" -gt "${#2}" ]; do if [ -L "$p" ] || { [ -e "$p" ] && [ ! -d "$p" ]; }; then printf "%s" "${p#"$2"/}"; exit 2; fi; p=${p%/*}; done; exit 1', "changes", `${root}/${path}`, root, twin ? `${root}/${twin}` : ""], { on, timeout: 15000 }).catch(() => null);
        if (g?.code === 0) note = `${name} is a folder here: not discarded.`;
        else if (g?.code === 3) note = `${twin} is the same file here: ${path} not discarded.`;
        else if (g?.code === 2) note = `${String(g.stdout ?? "").trim() || "A folder above it"} is a file here: ${path} not discarded.`;
        else if (g?.code !== 1) note = `Couldn't check ${name}: not discarded.`;
        else if (plan === "restore") {
          // --literal-pathspecs: "pages/[id].tsx" is that file, not a pattern that also takes pages/i.tsx.
          const r = await exec("git", ["--literal-pathspecs", "checkout", "HEAD", "--", path], { cwd: root, on });
          if (r.code !== 0) throw new Error(r.stderr || r.stdout);
        } else {
          if (plan === "untrack") {
            const r = await exec("git", ["--literal-pathspecs", "rm", "--cached", "-f", "-q", "--", path], { cwd: root, on });
            if (r.code !== 0) throw new Error(r.stderr || r.stdout);
          }
          const r = await exec("sh", ["-c", TRASH, "changes", `${root}/${path}`], { on, timeout: 60000 });
          if (r.code !== 0 && r.code !== 4) throw new Error(r.stderr || r.stdout);
          const where = String(r.stdout ?? "").trim();
          if (where && where !== "Trash") note = `${name} went to ${where.replace(home() ?? "\0", "~")} (there's no Trash command here).`;
        }
      } catch (e) {
        const said = String(e?.message ?? e).split("\n").map((l) => l.trim()).filter(Boolean);
        note = `Couldn't discard ${name}: ${said[0] ?? "git failed"}`;
      } finally {
        this.discarding = false;
        if (this.current(context)) {
          if (note) { this.note = note; this.noteTone = note.startsWith("Couldn't") || note.endsWith("not discarded.") ? null : "quiet"; }
          await this.loadCheckout(this.selectedPath ?? root, context, cx);
        }
        cx.notify();
      }
    });
  }

  showHeld(path, cx) {
    this.open = path; this.closed = false; this.setLines([]);
    const mark = this.heldMark = (this.heldMark ?? 0) + 1;
    cx.spawn(async (cx) => {
      await cx.sleep(150);
      if (this.heldMark === mark && this.open === path) this.pick(path, cx, true);
    });
    cx.notify();
  }

  // A click on a row shows its diff, or hides it when it's the one shown; keep: ↑ ↓ (always shows).
  pick(path, cx, keep = false) {
    this.open = this.open === path && !keep ? null : path; this.setLines([]); this.note = null; this.noteTone = null;
    this.closed = !this.open;
    const context = this.context, seq = this.loadSeq;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context, seq); }
      catch (e) { if (this.current(context) && this.loadSeq === seq && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  // Commit: git add -A, then git commit, each allowed 10 minutes (hooks that lint or test). When
  // exec stops a step there (its time, or Herdr's own words for it), that isn't git failing on its
  // own: Herdr ends git, its hooks run on to their end, orphaned. What it means depends on the step:
  // add -A ran out (nothing committed, what's staged unknown), or the commit did, which HEAD read
  // before and after tells apart (a slow post-commit hook: the commit was made).
  commit(cx) {
    if (!this.message.trim() || !this.root || !this.files.length || this.busy || this.loading || this.discarding || this.context?.key !== this.key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    const what = `Committed ${this.countWords()}${this.branch ? ` to ${this.branch}` : ""}`;
    this.busy = true; this.note = null; this.noteTone = null;
    const head = async () => {
      const r = await exec("git", [...READ, "rev-parse", "--verify", "-q", "HEAD"], { cwd: root, on }).catch(() => null);
      return r ? (r.code === 0 ? r.stdout.trim() : "") : null; // "" no commit yet, null couldn't ask
    };
    const done = () => {
      this.drafts.delete(draftKey(root, on));
      if (this.current(context)) { this.message = ""; this.input.set_value(""); }
    };
    cx.spawn(async (cx) => {
      let step = "add", since = Date.now(), before = null;
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          if (args[0] === "commit") { before = await head(); step = "commit"; }
          since = Date.now();
          const r = await exec("git", args, { cwd: root, on, timeout: COMMIT_TIMEOUT });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        done();
        if (this.current(context)) { this.note = what; this.noteTone = "quiet"; }
      } catch (e) {
        const stopped = Date.now() - since >= COMMIT_TIMEOUT - 2000 || /took longer than .* and was stopped/.test(String(e?.message ?? e));
        // Git's own words without "Error:": its first line and its last two (a hook's reason is at the end).
        const said = String(e?.message ?? e).split("\n").map((l) => l.trim()).filter(Boolean);
        let note = `Commit failed: ${(said.length > 3 ? [said[0], "…", ...said.slice(-2)] : said).join(" ")}`, tone = null;
        if (stopped && step === "add") { note = "Staging gave up after 10 minutes, so nothing was committed. Commit from the terminal to see what git is doing."; tone = "wait"; }
        else if (stopped) {
          const after = await head();
          tone = "wait";
          if (after && before !== null && after !== before) { note = "The commit was made, but a hook was still running after 10 minutes and was stopped. Check git log before committing again."; done(); }
          else if (after === null || before === null) note = "Commit gave up after 10 minutes. Check git log before committing again.";
          else note = "Commit gave up after 10 minutes, so nothing was committed; the changes are staged. Commit from the terminal to see the hooks' output.";
        }
        // A step stopped while it held the index (add -A does) leaves git's lock behind for good:
        // every later git command there fails until it's gone.
        if (stopped) {
          // The lock's path as git gives it: in a linked worktree it isn't .git/index.lock.
          const lock = await exec("sh", ["-c", 'p=$(git rev-parse --git-path index.lock) && test -e "$p" && printf "%s" "$p"'], { cwd: root, on }).catch(() => null);
          const where = lock?.code === 0 ? String(lock.stdout ?? "").trim() : "";
          if (where) note += ` Git left ${where} behind: delete it once no git is running in this repo.`;
        }
        if (this.current(context)) { this.note = note; this.noteTone = tone; }
      } finally {
        this.busy = false;
        if (this.current(context)) await this.loadCheckout(this.selectedPath ?? root, context, cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  // "1 file", "4 files", "1,000+ files" (the list stops at 1,000).
  countWords() {
    const n = this.files.length;
    return `${grouped(n)}${this.limited ? "+" : ""} ${n === 1 && !this.limited ? "file" : "files"}`;
  }

  // What Commit takes: every change in the checkout (git add -A), so the button says how many.
  commitLabel() {
    const n = this.files.length;
    if (!n) return "Commit";
    if (n === 1) return "Commit 1 file";
    return `Commit all ${grouped(n)}${this.limited ? "+" : ""} files`;
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
        .when(Boolean(this.filterQuery), (e) => e.child(div().id(`${id}-clear`).flex_none().size(20).mr(-4).flex().items_center().justify_center().cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
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
        .when(!rows.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child("No matching repos or worktrees"))))
      .when(Boolean(this.scanStop), (e) => e.child(this.stopLine(t)));
  }

  // The scan stopped early (repos.js MAX_DIRS, MAX_REPOS): a line under the repos says so.
  stopLine(t) {
    return div().flex_none().px(12).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child(stopWords(this.scanStop));
  }

  // Clickable header switcher + anchored popover (used in narrow panes < 640px when > 1 checkout).
  repoSwitcher(t, loc, activeEntry, slim) {
    const labelRepo = activeEntry?.repoName ?? baseName(this.root ?? loc.cwd);
    const labelBranch = activeEntry?.branchLabel ?? this.branch ?? "";
    const isWt = Boolean(activeEntry && !activeEntry.main);
    const trigger = h_flex().id("changes-repo-trigger").h(slim ? 24 : 26).max_w(slim ? 235 : 320).px(8).gap(6).items_center().rounded(6)
      .border_1().border_color(this.popOpen ? t.input : t.border).bg(this.popOpen ? t.hover : t.surface).cursor_pointer()
      .hover((s) => s.bg(t.hover).border_color(t.input))
      .when(!this.popOpen, (e) => e.tooltip("Switch repository or worktree"))
      // A press on this button while the list is open is a press outside the list, which closed it in
      // the same press (capture runs first): the click that follows mustn't open it again.
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.popSkip = Boolean(this.popShut) && Date.now() - this.popShut < 100; })
      .on_click((_e, cx) => {
        if (this.popSkip) { this.popSkip = false; cx.notify(); return; } // the press outside closed it (closePop)
        if (this.popOpen) { this.closePop(); cx.notify(); return; }
        this.popOpen = true;
        // Its filter takes the keyboard while it's open (popTook); where it was is noted for closePop().
        if (this.flat.length > FILTER_THRESHOLD) { this.popBack = this.typing; this.popTook = true; this.filterInput.focus(); }
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
      .on_mouse_down_out((_e, cx) => { this.closePop(true); this.popShut = Date.now(); cx.notify(); })
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
        .when(!rows.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child("No matching repos or worktrees"))))
      .when(Boolean(this.scanStop), (e) => e.child(this.stopLine(t)));

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
        .when(!showSwitcher, (e) => e.child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(this.countWords())))
        .when(Boolean(returnBtn), (e) => e.child(returnBtn))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`));
    }
    const paneBranch = loc.pane ? panes().find((x) => x.pane === loc.pane)?.branch : null;
    const branch = activeEntry?.branchLabel ?? this.branch ?? (this.root ? paneBranch : null);
    const repoName = activeEntry?.repoName ?? baseName(this.root ?? loc.cwd);
    const where = this.noRepos ? baseName(loc.cwd ?? "") : [repoName, this.root || activeEntry ? branch : null].filter(Boolean).join(" · ");
    const totals = this.files.length
      ? [div().flex_none().text_color(t.ansi2).child(`+${add}`), div().flex_none().text_color(t.ansi1).child(`−${del}`),
        div().flex_none().text_color(t.dim).child(`· ${this.countWords()}`)]
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
        .child("This folder isn't a git repository, and no nested repositories were found inside it."))
      .when(Boolean(this.scanStop), (e) => e.child(div().max_w(380).text_size(12).text_color(t.dim).text_center().child(stopWords(this.scanStop))));
  }

  viewer(t, size, add, del, loc, showSwitcher, enabled) {
    return v_flex().size_full().min_h(0).min_w(0).bg(t.background)
      .child(this.head(t, add, del, loc, showSwitcher))
      .when(this.noRepos, (e) => e.child(this.emptyNoRepos(t, loc)))
      .when(!this.noRepos, (e) => e
        // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
        .child(div().flex_1().min_h(44).max_h(this.files.length * 28 + 12).relative().border_b(1).border_color(t.border)
          .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().track_scroll(this.listScroll).p(6).children(this.files.map((f) => {
            const parts = f.path.split("/"), name = parts.pop();
            const menu = this.rowMenu?.path === f.path;
            return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().relative().when(this.open === f.path, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
              .when(menu, (el) => el.border_1().border_color(t.accent))
              .on_mouse_down("right", (e, cx) => this.openRowMenu(e, f, cx))
              .when(menu, (el) => el.child(this.rowMenuView(t, f)))
              .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
              .child(h_flex().id(`change-name-${f.path}`).flex_1().min_w(0).when(!menu, (el) => el.tooltip(f.path)).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
              .when(f.add > 0, (el) => el.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (el) => el.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
              .when(this.open === f.path && f.status !== "D", (el) => el.child(div().id(`change-files-${f.path}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.muted)
                .hover((s) => s.bg(t.hover).text_color(t.foreground)).when(!menu, (el) => el.tooltip("Open in Files"))
                .on_click((_e, cx) => { cx.stop_propagation(); this.openInFiles(f.path, cx); })
                .child(svg("mods/ws-files/external-link.svg").size(12))));
          })).when(!this.files.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.error || (this.loading || this.scanning ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
          .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
        .when(this.limited, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
        // One repo found (no rail, no picker) by a scan that stopped early: the line goes here.
        .when(Boolean(this.scanStop) && this.flat.length <= 1, (el) => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child(stopWords(this.scanStop))))
        .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(size)
          .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
            .child(div().w_full().min_w(Math.max(300, this.longest * charWidth(size) + this.gutter(size) + 20)).h_full().child(v_virtual_list("changes-diff", this.rows.length, rowHeight(size), (i) => String(i),
              (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t, size))).size_full())))
          .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
          .when(!this.open && this.files.length > 0, (el) => el.child(div().absolute().top(6).px(12).text_size(11).text_color(t.dim).child("Select a file to view its changes"))))
        .when(Boolean(this.note), (el) => el.child(div().px(10).pb(8).text_size(11).text_color(this.noteTone === "wait" ? t.blocked : this.noteTone === "quiet" ? t.muted : t.ansi1).child(this.note)))
        .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
          .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
          .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (el) => el.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : this.commitLabel()))));
  }

  render(cx) {
    const loc = this.place(); // a focus change is remembered at once
    const p = props() ?? {};
    const t = theme(), cfg = settings(), size = cfg.font_size;
    const add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    // Not while what's shown is a place behind (the timer hasn't read the new one yet): it would do nothing.
    const enabled = Boolean(this.message.trim() && this.root && this.files.length && !this.busy && !this.loading && this.context?.key === this.key());
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
      // The release of a press outside the picker (closePop): the view took the keyboard, nothing else did.
      .on_mouse_up("left", () => this.refocusAfterPress()).on_mouse_up("right", () => this.refocusAfterPress())
      .when(card, (e) => e.rounded(10).border_1().border_color(t.border))
      .on_size_change((s, cx) => {
        if (s.width === this.size?.width && s.height === this.size?.height) return;
        this.size = { width: s.width, height: s.height };
        const z = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
        if (s.width / z >= NARROW) { this.popOpen = false; this.popTook = false; }
        cx.notify();
      })
      .on_key_down((e, cx) => {
        if (this.rowMenu && this.rowMenuKey(e, cx)) return;
        if (e.key === "escape" && this.popOpen) { this.closePop(); cx.stop_propagation(); cx.notify(); return; }
        // ↑ ↓ step through the changed files, each one's diff shown, where Changes itself has the
        // keyboard (after a click in the list), not the message box or a filter, nor while the picker's open.
        const mods = e.modifiers ?? {};
        if ((e.key === "up" || e.key === "down") && !mods.platform && !mods.control && !mods.alt && !mods.shift
          && !this.popOpen && this.handle.is_focused()) {
          const paths = this.files.map((f) => f.path), next = nextFile(paths, this.open, e.key);
          if (next) {
            cx.stop_propagation();
            if (next !== this.open) {
              // A held key moves the row at once, its diff read once the key stops (150 ms), not one git per repeat.
              if (e.is_held) this.showHeld(next, cx); else this.pick(next, cx, true);
              this.listScroll.scroll_to_item(paths.indexOf(next));
            }
            return;
          }
        }
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(body);
  }
}
