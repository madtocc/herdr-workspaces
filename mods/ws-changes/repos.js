// Nested git repositories and linked worktrees for Changes, as plain data.
// No imports, so `node --test` can test it directly.

export const SKIP_DIRS = [
  "node_modules", "target", "dist", "build", "vendor",
  ".next", ".venv", "venv", "__pycache__", ".cache",
  "Pods", ".gradle", ".idea", ".vscode",
];
export const MAX_REPOS = 40;
export const MAX_DIRS = 500;
export const FILTER_THRESHOLD = 6;

// Normalize slashes and drop trailing separators while preserving root ("/" or "C:/").
export function normPath(p) {
  const s = String(p ?? "").trim().replace(/\\/g, "/");
  if (!s) return "";
  if (s === "/") return "/";
  if (/^[A-Za-z]:\/?$/.test(s)) return s[0] + ":/";
  return s.replace(/\/+$/, "");
}

export function baseName(p) {
  const n = normPath(p);
  if (!n || n === "/") return n;
  if (/^[A-Za-z]:\/$/.test(n)) return n;
  return n.split("/").pop() ?? "";
}

export function inside(p, dir) {
  const a = normPath(p), b = normPath(dir);
  if (!a || !b) return false;
  if (b === "/" || /^[A-Za-z]:\/$/.test(b)) return a.startsWith(b);
  return a === b || a.startsWith(b + "/");
}

export function tilde(p, userHome) {
  const n = normPath(p), h = normPath(userHome);
  if (!n || !h) return n;
  if (n === h) return "~";
  return n.startsWith(h + "/") ? "~" + n.slice(h.length) : n;
}

// Relative path of `p` inside `cwd` (or `realCwd` for symlinked roots like /tmp -> /private/tmp),
// else `tilde(p, userHome)`.
export function relPath(p, cwd, userHome = "", realCwd = "") {
  const n = normPath(p);
  for (const base of [normPath(cwd), normPath(realCwd)].filter(Boolean)) {
    if (n === base) return ".";
    const prefix = base === "/" || /^[A-Za-z]:\/$/.test(base) ? base : base + "/";
    if (n.startsWith(prefix)) return n.slice(prefix.length);
  }
  return tilde(n, userHome);
}

// Cap nested scanning to depth 1 in home or filesystem root so we never walk ~/Library or /.
export function maxScanDepth(cwd, userHome = "") {
  const n = normPath(cwd), h = normPath(userHome);
  if (!n || n === "/" || /^[A-Za-z]:\/$/.test(n) || (h && n === h)) return 1;
  return 3;
}

// `git -c core.quotePath=false worktree list --porcelain`:
// every non-bare, non-prunable checkout, main checkout first.
export function parseWorktrees(text) {
  const out = [];
  let first = true;
  const blocks = String(text ?? "").replace(/\r\n/g, "\n").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const pathLine = lines.find((l) => l.startsWith("worktree "));
    if (!pathLine) continue;
    const path = normPath(pathLine.slice(9));
    if (!path) continue;
    const main = first;
    first = false;
    if (lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branchLine = lines.find((l) => l.startsWith("branch "));
    const branch = branchLine ? branchLine.slice(7).replace(/^refs\/heads\//, "") : null;
    const headLine = lines.find((l) => l.startsWith("HEAD "));
    const head = headLine ? headLine.slice(5).trim() : null;
    out.push({ path, branch, head, main });
  }
  return out;
}

export function branchLabel(entry) {
  if (!entry) return "";
  if (entry.branch) return entry.branch;
  if (entry.head) return entry.head.slice(0, 7);
  return "detached";
}

// Count changed entries from `git status --porcelain=v1 -z --no-renames --untracked-files=all`.
export function countPorcelainZ(stdout) {
  return String(stdout ?? "").split("\0").filter(Boolean).length;
}

// The scanners' last token when they stopped early: ":stopped:dirs" (MAX_DIRS folders looked at) or
// ":stopped:repos" (MAX_REPOS found). Repo paths are absolute, so it can't be one.
const STOP = ":stopped:";

// Parse NUL-delimited output of the nested repo scanner:
// token 0 is `realCwd`, remaining tokens are repo directories (or dir/.git).
// stopped: "dirs" or "repos" when the scan stopped before it had looked everywhere, else null.
export function parseScanOutput(stdout, maxRepos = MAX_REPOS) {
  const parts = String(stdout ?? "").split("\0");
  const realCwd = normPath(parts[0] ?? "");
  const seen = new Set();
  const dirs = [];
  let stopped = null;
  const rest = parts.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i];
    if (raw.startsWith(STOP)) { stopped = raw.slice(STOP.length) === "repos" ? "repos" : "dirs"; continue; }
    const clean = normPath(raw).replace(/\/\.git$/, "");
    if (!clean || seen.has(clean)) continue;
    if (dirs.length >= maxRepos) { stopped ??= "repos"; continue; }
    seen.add(clean);
    dirs.push(clean);
  }
  return { realCwd, dirs, stopped };
}

// What the rail, the picker and the empty screen say when the scan stopped early (parseScanOutput).
export function stopWords(stopped) {
  if (stopped === "repos") return `Stopped after ${MAX_REPOS} repos: some may be missing. Open Changes from inside one.`;
  if (stopped === "dirs") return `Stopped after ${MAX_DIRS} folders: some repos may be missing. Open Changes from inside one.`;
  return "";
}

// Portable POSIX sh script: prints realCwd then each nested repo folder, NUL-delimited.
// Unrolled to depth 3 (no `local` extension, no recursive variable clobbering).
// Skips dot-folders (glob `*`), heavy build/vendor folders, and stops descending once `.git` is found.
// Stopping early (max_dirs, max_repos) prints ":stopped:dirs" or ":stopped:repos" last.
export function posixScanScript() {
  const skip = SKIP_DIRS.join("|");
  return [
    'cwd="$1"; max="$2"; max_repos="$3"; max_dirs="$4"',
    'real=$(cd "$cwd" 2>/dev/null && pwd -P) || real="$cwd"',
    'printf "%s\\0" "$real"',
    'count=0; visited=0; stop=',
    'skip() {',
    `  case "$1" in ${skip}) return 0 ;; esac`,
    '  return 1',
    '}',
    'for p1 in "$cwd"/*; do',
    '  [ -d "$p1" ] || continue',
    '  visited=$((visited + 1)); [ "$visited" -gt "$max_dirs" ] && { stop=dirs; break; }',
    '  skip "${p1##*/}" && continue',
    '  if [ -e "$p1/.git" ]; then',
    '    printf "%s\\0" "$p1"; count=$((count + 1)); [ "$count" -ge "$max_repos" ] && { stop=repos; break; }; continue',
    '  fi',
    '  [ "$max" -ge 2 ] || continue',
    '  for p2 in "$p1"/*; do',
    '    [ -d "$p2" ] || continue',
    '    visited=$((visited + 1)); [ "$visited" -gt "$max_dirs" ] && { stop=dirs; break 2; }',
    '    skip "${p2##*/}" && continue',
    '    if [ -e "$p2/.git" ]; then',
    '      printf "%s\\0" "$p2"; count=$((count + 1)); [ "$count" -ge "$max_repos" ] && { stop=repos; break 2; }; continue',
    '    fi',
    '    [ "$max" -ge 3 ] || continue',
    '    for p3 in "$p2"/*; do',
    '      [ -d "$p3" ] || continue',
    '      visited=$((visited + 1)); [ "$visited" -gt "$max_dirs" ] && { stop=dirs; break 3; }',
    '      skip "${p3##*/}" && continue',
    '      if [ -e "$p3/.git" ]; then',
    '        printf "%s\\0" "$p3"; count=$((count + 1)); [ "$count" -ge "$max_repos" ] && { stop=repos; break 3; }',
    '      fi',
    '    done',
    '  done',
    'done',
    '[ -z "$stop" ] || printf ":stopped:%s\\0" "$stop"',
    'true',
  ].join("\n");
}

// Repo name from its main checkout (or common dir for bare repos):
// relative path under cwd when strictly inside cwd, else basename (parent for `.bare`).
function repoDisplayName(mainPath, cwd, realCwd) {
  const n = normPath(mainPath);
  for (const base of [normPath(cwd), normPath(realCwd)].filter(Boolean)) {
    if (n === base) return baseName(n);
    const prefix = base === "/" || /^[A-Za-z]:\/$/.test(base) ? base : base + "/";
    if (n.startsWith(prefix)) return n.slice(prefix.length);
  }
  const parts = n.split("/").filter(Boolean);
  if (parts.at(-1) === ".bare" && parts.length >= 2) return parts.at(-2);
  return baseName(n);
}

// Group discovered repos & checkouts, deduplicated by git common dir, sorted alphabetically.
// `repos`: [{ commonDir, mainPath, checkouts: [{ path, branch, head, main, dirty? }] }]
// Returns { groups: [{ id, name, main, worktrees }], flat: [checkout, ...] }.
export function buildGroups({ cwd, realCwd = "", userHome = "", repos = [], followedRoot = null }) {
  const followed = normPath(followedRoot);
  const byCommon = new Map();

  for (const r of repos) {
    if (!r || !Array.isArray(r.checkouts) || !r.checkouts.length) continue;
    const key = normPath(r.commonDir || r.mainPath || r.checkouts[0].path);
    if (!key) continue;
    let entry = byCommon.get(key);
    if (!entry) {
      const mainPath = normPath(r.mainPath || r.checkouts.find((c) => c.main)?.path || r.checkouts[0].path);
      entry = { id: key, mainPath, byPath: new Map() };
      byCommon.set(key, entry);
    }
    for (const c of r.checkouts) {
      const p = normPath(c.path);
      if (!p) continue;
      const prev = entry.byPath.get(p);
      entry.byPath.set(p, {
        path: p,
        branch: c.branch ?? prev?.branch ?? null,
        head: c.head ?? prev?.head ?? null,
        main: Boolean(c.main || prev?.main),
        dirty: c.dirty !== undefined ? c.dirty : (prev?.dirty ?? null),
      });
    }
  }

  const rawGroups = [...byCommon.values()].map((entry) => {
    const name = repoDisplayName(entry.mainPath, cwd, realCwd);
    const items = [...entry.byPath.values()].map((c) => ({
      ...c,
      repoId: entry.id,
      repoName: name,
      branchLabel: branchLabel(c),
      where: relPath(c.path, cwd, userHome, realCwd),
      isFollowed: Boolean(followed && c.path === followed),
    }));
    const main = items.find((c) => c.main) ?? null;
    const worktrees = items
      .filter((c) => c !== main)
      .sort((a, b) => a.branchLabel.localeCompare(b.branchLabel, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
    return { id: entry.id, mainPath: entry.mainPath, name, main, worktrees };
  });

  // Disambiguate colliding external repo names (e.g. two external worktree repos both named "app").
  const nameCounts = new Map();
  for (const g of rawGroups) nameCounts.set(g.name, (nameCounts.get(g.name) ?? 0) + 1);
  for (const g of rawGroups) {
    if ((nameCounts.get(g.name) ?? 0) > 1) {
      const dis = relPath(g.mainPath, cwd, userHome, realCwd);
      g.name = dis;
      if (g.main) g.main.repoName = dis;
      for (const w of g.worktrees) w.repoName = dis;
    }
  }

  rawGroups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
  const flat = [];
  for (const g of rawGroups) {
    if (g.main) flat.push(g.main);
    for (const w of g.worktrees) flat.push(w);
  }
  return { groups: rawGroups, flat };
}

// Pick which checkout to show:
// 1. Keep previous selection if still present.
// 2. Otherwise the followed terminal's checkout if present.
// 3. Otherwise the first checkout with uncommitted changes (dirty > 0), else the first checkout.
export function pickInitial({ flat = [], followedRoot = null, previousPick = null }) {
  if (!flat.length) return null;
  const prev = normPath(previousPick);
  if (prev) {
    const hit = flat.find((c) => c.path === prev);
    if (hit) return hit.path;
  }
  const fol = normPath(followedRoot);
  if (fol) {
    const hit = flat.find((c) => c.path === fol);
    if (hit) return hit.path;
  }
  const dirty = flat.find((c) => (c.dirty ?? 0) > 0);
  return (dirty ?? flat[0]).path;
}

// Filter grouped repos & worktrees by substring match on repo name, branch, or relative path.
// The checkout Enter in the filter takes: the first that matches in the list's order, the repo's
// main when its name or main matches, else its first matching worktree (filterGroups keeps the
// main row as the group's heading when only a worktree matched). null when nothing does.
export function firstMatch(groups, query) {
  const q = String(query ?? "").trim().toLowerCase();
  for (const g of filterGroups(groups, query)) {
    const mainHit = Boolean(g.main) && (!q || g.name.toLowerCase().includes(q) || `${g.name} ${g.main.branchLabel} ${g.main.where}`.toLowerCase().includes(q));
    const c = mainHit ? g.main : g.worktrees[0];
    if (c) return c;
  }
  return null;
}

export function filterGroups(groups, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return groups;
  const out = [];
  for (const g of groups) {
    const nameMatch = g.name.toLowerCase().includes(q);
    const mainMatch = Boolean(g.main && `${g.name} ${g.main.branchLabel} ${g.main.where}`.toLowerCase().includes(q));
    const wts = nameMatch
      ? g.worktrees
      : g.worktrees.filter((w) => `${g.name} ${w.branchLabel} ${w.where}`.toLowerCase().includes(q));
    if (nameMatch || mainMatch || wts.length) {
      out.push({ ...g, worktrees: wts });
    }
  }
  return out;
}

// New files' line counts (git's numstat leaves untracked files out), in one pass per load: find
// keeps the files of 1 MB or less (2048 blocks) among the paths it's given, and one grep counts their
// lines as the diff counts them (a last line without a newline counts); a binary file counts 0, which
// shows no count. Three programs in all, whatever the number of files. newLinesArgs() puts "./" before
// every path, so a name like "-n" isn't an option; the output is "./path:N" lines.
export const NEW_LINES_SH = 'find "$@" -prune -type f -size -2049 -print0 2>/dev/null | LC_ALL=C xargs -0 grep -H -I -c "" -- 2>/dev/null; true';
export const NEW_LINES_MAX = 200;

export function newLinesArgs(paths) {
  return paths.map((p) => `./${p}`);
}

// { path: lines } for the paths asked (as given to newLinesArgs); anything else grep says is skipped.
export function parseNewLines(stdout, asked) {
  const out = {}, want = asked ? new Set(asked) : null;
  for (const line of String(stdout ?? "").split("\n")) {
    const i = line.lastIndexOf(":");
    if (i < 3 || !line.startsWith("./")) continue;
    const path = line.slice(2, i), n = Number(line.slice(i + 1));
    if (!Number.isInteger(n) || n < 0 || (want && !want.has(path))) continue;
    out[path] = n;
  }
  return out;
}

// The changed file ↑ or ↓ opens in Changes' list: the next or previous after the open one (no
// wrap), the first (↓) or last (↑) when none is open; null for any other key or an empty list.
export function nextFile(paths, open, key) {
  if (!paths?.length || (key !== "up" && key !== "down")) return null;
  const i = paths.indexOf(open);
  if (i < 0) return key === "down" ? paths[0] : paths[paths.length - 1];
  return paths[Math.max(0, Math.min(paths.length - 1, i + (key === "down" ? 1 : -1)))];
}

// A changed file's right-click menu in Changes: its rows (null a line). Open in Files isn't there for
// a deleted file, Discard changes… isn't there for a conflict (finish that in the terminal).
export function rowMenuItems(file) {
  const out = [];
  if (file.status !== "D") out.push("open");
  out.push("copy");
  // A path ending in "/" is a folder git won't list inside (a repository of its own, a worktree): it
  // would go to the Trash whole, with commits that may be nowhere else. No Discard for it.
  if (file.status !== "U" && !file.gitlink && !String(file.path ?? "").endsWith("/")) out.push(null, "discard"); // gitlink: the same, staged
  return out;
}

// What Discard changes… does to a file, from its two status letters (git status --porcelain, "??"
// for an untracked one) and whether the checkout has a commit: "restore" (git checkout HEAD -- path:
// the file as the last commit has it, staged and unstaged changes both gone), "trash" (a new file,
// untracked: to the Trash), "untrack" (a new file already staged: out of the index, then to the
// Trash), or null (a conflict: not offered).
export function discardPlan(xy, hasHead, path = "") {
  const x = String(xy ?? "").slice(0, 2);
  if (String(path).endsWith("/")) return null; // a folder with a repository of its own: never
  if (x === "??") return "trash";
  if (x.includes("U") || x === "AA" || x === "DD") return null;
  if (!hasHead || x.includes("A")) return "untrack"; // staged new, or added with -N (" A")
  return "restore";
}

// The question Discard changes… asks in place, naming the file and what becomes of it.
export function discardAsk(name, plan) {
  if (plan === "restore") return { title: `Discard the changes to ${name}?`, body: "It goes back to how the last commit has it. This can't be undone.", button: `Discard ${name}` };
  return { title: `Discard ${name}?`, body: "It's new, so it goes to the Trash.", button: `Move ${name} to the Trash` };
}

// The paths that are gitlinks (mode 160000: a repository of its own, staged into this one) in
// `git ls-files -s -z` output ("<mode> <sha> <stage>\t<path>\0").
export function parseGitlinks(stdout) {
  const out = new Set();
  for (const entry of String(stdout ?? "").split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab > 0 && entry.startsWith("160000 ")) out.add(entry.slice(tab + 1));
  }
  return out;
}
