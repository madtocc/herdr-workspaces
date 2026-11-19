// Worktrees: every git worktree of one workspace's repos. It's the workspace's own
// screen: the layout holds one copy (props { screen: true }) that shows the worktrees
// of the workspace shown in the switcher and follows it, and the switcher menu's
// "Open … worktrees" shows it in place of the tabs, from any space. In a tab or pane
// of its own (props { workspace }) it keeps to that workspace.
//
// Which ones: git's own list (`git worktree list`) for each repo under the
// workspace's root or among its folders, so a worktree shows wherever it was
// made and whoever made it (Herdr's New worktree, the board, an agent, you).
// Each row says where its work stands (merged, a pull request open, commits
// with no pull request, nothing to merge), whether it has uncommitted changes,
// and whether a space or a terminal is in it. Pull requests are read with `gh`
// when it's signed in; without it the rest still shows.
//
// Remove takes one away (`git worktree remove`; the branch stays), after the
// repo's archive script. "Remove finished" does it for every merged, clean,
// unused one, and the rows' checkboxes pick any others to remove together.
// Scripts: a repo's setup and archive lines (treescripts.js).
//
// The same mod is its dialog: props { dialog: "remove", workspace, trees, picked }
// (picked: chosen by hand, so it may close spaces and lose uncommitted changes,
// which the dialog says first).
// Shared state: workspaces.worktrees.changed, a time, set after a removal so
// the tab reads again.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, terminals, run, theme, shared, setShared, props, openOverlay, closeOverlay,
  home, readTextFile, writeTextFile, exec, notify, checking,
} from "herdr";
import * as fs from "fs/promises";
import { parseList, parseRefs, parsePrs, kindOf, labelOf, finished, ago, inside } from "./facts.js";
import { loadScripts, saveScripts, allowScripts, runScript, markSetUp } from "./treescripts.js";

const io = { home, readTextFile, writeTextFile, exec };
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const FILTERS = [["all", "All"], ["finished", "Finished"], ["changes", "Uncommitted"], ["used", "In use"], ["empty", "Nothing to merge"]];
const SLOW = 6; // worktrees whose changes are read at once

const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;
const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const base = (p) => p.replace(/\/+$/, "").split("/").pop();
const message = (e) => String(e?.message ?? e);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function git(cwd, args, timeout) {
  const r = await exec("git", ["-C", cwd, ...args], timeout ? { timeout } : {}).catch((e) => ({ code: 1, stdout: "", stderr: message(e) }));
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

// The repos of a workspace: the main checkout of its root, of each folder in the
// root and of each of its `folders`. A folder that only sits inside some repo
// above the workspace doesn't count.
async function reposOf(def) {
  const kids = def.children.map((c) => `${def.root}/${c}`);
  const places = [...new Set([def.root, ...kids, ...def.folders].filter(Boolean))];
  if (!places.length) return [];
  const r = await exec("sh", ["-c", 'for p; do git -C "$p" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo; done', "sh", ...places])
    .catch(() => ({ stdout: "" }));
  const lines = (r.stdout ?? "").split("\n");
  const roots = [def.root, def.real?.[def.root]].filter(Boolean);
  const mains = [];
  places.forEach((place, i) => {
    const common = (lines[i] ?? "").trim();
    if (!common.endsWith("/.git")) return; // not in git, or a bare repo
    const main = common.slice(0, -5);
    const mine = roots.some((root) => inside(main, root)) || def.folders.includes(place);
    if (mine && !mains.includes(main)) mains.push(main);
  });
  return mains;
}

// One repo: its base branch and its linked worktrees, most recently committed first.
async function readRepo(main) {
  const list = await git(main, ["worktree", "list", "--porcelain"]);
  const head = await git(main, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  let baseRef = head.ok ? head.out : null;
  if (!baseRef) for (const b of ["main", "master"]) if ((await git(main, ["show-ref", "--verify", "--quiet", `refs/heads/${b}`])).ok) { baseRef = b; break; }
  let refs = await git(main, ["for-each-ref", `--format=%(refname:short)%09%(committerdate:unix)${baseRef ? `%09%(ahead-behind:${baseRef})` : ""}`, "refs/heads"]);
  // An older git has no ahead-behind: the dates alone.
  if (!refs.ok) refs = await git(main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"]);
  const facts = parseRefs(refs.out);
  // Where setup has run: the worktrees whose own git folder holds the mark.
  const done = await exec("sh", ["-c", 'for d in "$1"/.git/worktrees/*/; do [ -e "$d/herdr-setup" ] && cat "$d/gitdir"; done; true', "sh", main]).catch(() => ({ stdout: "" }));
  const setUp = new Set((done.stdout ?? "").split("\n").map((l) => l.trim().replace(/\/\.git$/, "")).filter(Boolean));
  const trees = parseList(list.out).filter((x) => !x.main).map((x) => ({
    ...x, repo: main, at: facts.get(x.branch)?.at ?? 0, ahead: facts.get(x.branch)?.ahead ?? null,
    pr: null, dirty: null, setUp: setUp.has(x.path),
  })).sort((a, b) => b.at - a.at);
  return { main, name: base(main), base: baseRef, trees, prs: undefined };
}

// The workspace's board cards that have a worktree: path -> card id.
async function cardsOf(ws) {
  const dir = `${home()}/.herdr/workspaces/${ws}/tasks`;
  const map = new Map();
  let names = [];
  try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith(".")); } catch { return map; }
  for (const name of names) {
    const text = await readTextFile(`${dir}/${name}`);
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? "")?.[1] ?? "";
    const wt = /^worktree:\s*(.+)$/m.exec(head)?.[1].trim().replace(/^["']|["']$/g, "");
    if (!wt) continue;
    const id = /^id:\s*(.+)$/m.exec(head)?.[1].trim() ?? name.replace(/\.md$/, "");
    map.set(wt.startsWith("~/") ? home() + wt.slice(1) : wt, id);
  }
  // Git names a worktree by its real path: a card's, when a symlink leads there.
  const paths = [...map.keys()];
  if (paths.length) {
    const r = await exec("sh", ["-c", 'for p; do (cd "$p" 2>/dev/null && pwd -P) || echo; done', "sh", ...paths]).catch(() => ({ stdout: "" }));
    (r.stdout ?? "").split("\n").forEach((real, i) => { if (real && paths[i] && real !== paths[i]) map.set(real, map.get(paths[i])); });
  }
  return map;
}

// Where a space is now: its first terminal's live folder, else where it was made.
function placeOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}

function mark(def, t, size) {
  const defs = shared("workspaces.defs") ?? [];
  const c = def.color ?? PALETTE[Math.max(0, defs.findIndex((d) => d.id === def.id)) % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
  return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(Math.round(size * 0.55)).font_bold().text_color("#ffffff").child([...def.name][0]?.toUpperCase() ?? "?");
}

const STALE = 60e3; // ms after which the screen, shown again, reads the worktrees again

export default class Worktrees extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (props()?.dialog) return this.initDialog(cx);
    // The layout's screen follows the shown workspace; a tab keeps the one it was made with.
    this.follow = Boolean(props()?.screen);
    this.workspace = (this.follow ? null : props()?.workspace) ?? shared("workspaces.active") ?? null;
    this.turn = 0;
    this.readAt = Date.now();
    this.showing = !this.follow;
    this.reset();
    this.changed = shared("workspaces.worktrees.changed") ?? null;
    if (checking()) return;
    this.load(cx);
    // The dialog says when it removed something, and the screen's workspace may have
    // changed. Looked at on a timer, not in render: a task started while rendering
    // never gets to run.
    cx.timer.every(this.follow ? 400 : 1000, (cx) => {
      // The screen stays in the layout once shown. Reading every worktree is slow, so
      // it reads nothing while it isn't the one shown, and catches up when it is again.
      const scr = this.follow ? shared("workspaces.screen") ?? null : null;
      const showing = !this.follow || scr?.screen === "worktrees";
      const back = showing && !this.showing;
      this.showing = showing;
      if (!showing) return;
      // In place of the terminals, it takes the keyboard from them: keys typed here
      // mustn't land in a terminal nobody sees.
      if (back) this.handle.focus();
      const ws = this.follow ? shared("workspaces.active") ?? null : this.workspace;
      const changed = shared("workspaces.worktrees.changed") ?? null;
      if (ws !== this.workspace) {
        // Another workspace is shown: its worktrees from here. A read under way is dropped (turn).
        this.workspace = ws; this.changed = changed; this.turn++;
        this.reset();
        this.load(cx);
        cx.notify();
      } else if (changed !== this.changed || (back && !this.reading && Date.now() - this.readAt > STALE)) { this.changed = changed; this.load(cx); }
    });
  }

  // The list's own state, as it opens.
  reset() {
    this.repos = [];
    this.cards = new Map();
    this.scripts = null;
    this.loaded = false;
    this.reading = false;
    this.filter = "all";
    this.editing = null; // the repo (its main checkout) whose scripts are open
    this.busy = {}; // worktree path -> "setup"
    this.selected = new Set(); // the paths ticked for Remove selected
    this.anchor = null; // the row ticked or unticked last, and which of the two: a shift-click runs from it
  }

  // Reads everything again, in a task of its own. Call it from a click, a timer
  // or init, never from render.
  load(cx) {
    cx.spawn(async (cx) => this.read(cx));
  }

  // Git first (fast), then each repo's pull requests and each worktree's changes.
  async read(cx) {
    const turn = ++this.turn;
    const def = defOf(this.workspace);
    if (!def) { this.loaded = true; return cx.notify(); }
    this.reading = true;
    cx.notify();
    {
      try {
        const repos = [];
        for (const main of await reposOf(def)) repos.push(await readRepo(main));
        const cards = await cardsOf(def.id);
        const scripts = await loadScripts(io, def.id);
        if (turn !== this.turn) return;
        // What was read last time stays on screen until it's read again.
        const old = new Map(this.repos.flatMap((r) => r.trees.map((x) => [x.path, x])));
        for (const r of repos) {
          r.prs = this.repos.find((o) => o.main === r.main)?.prs;
          for (const x of r.trees) { x.dirty = old.get(x.path)?.dirty ?? null; x.pr = r.prs?.get?.(x.branch) ?? null; }
        }
        Object.assign(this, { repos, cards, scripts, loaded: true });
        const there = new Set(repos.flatMap((r) => r.trees.map((x) => x.path)));
        for (const path of [...this.selected]) if (!there.has(path)) this.selected.delete(path);
        cx.notify();
        await Promise.all(repos.filter((r) => r.trees.length).map(async (r) => {
          const out = await exec("gh", ["pr", "list", "--state", "all", "--limit", "300", "--json", "headRefName,state,number,url,headRefOid,isCrossRepository"], { cwd: r.main, timeout: 30000 })
            .catch(() => ({ code: 1 }));
          if (turn !== this.turn) return;
          r.prs = out.code === 0 ? parsePrs(out.stdout) : null; // null: gh couldn't say
          for (const x of r.trees) x.pr = r.prs?.get(x.branch) ?? null;
          cx.notify();
        }));
        const all = repos.flatMap((r) => r.trees);
        let next = 0;
        await Promise.all(Array.from({ length: SLOW }, async () => {
          while (next < all.length && turn === this.turn) {
            const x = all[next++];
            const s = await git(x.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], 60000);
            x.dirty = s.ok ? s.out.split("\n").filter(Boolean).length : null;
            cx.notify();
          }
        }));
      } catch (e) {
        notify({ title: "Couldn't read the worktrees", body: message(e), level: "error" });
      }
      if (turn === this.turn) { this.reading = false; this.readAt = Date.now(); cx.notify(); }
    }
  }

  // What's in each worktree right now: path -> { spaces, terminals, status }.
  live() {
    const sp = spaces().filter((s) => !s.machine), ps = panes();
    const places = sp.map((s) => [s, placeOf(s, ps)]);
    const terms = terminals().filter((x) => x.cwd && !String(x.address ?? "").includes("/"));
    const rank = { blocked: 3, done: 2, working: 1 };
    const map = new Map();
    for (const x of this.repos.flatMap((r) => r.trees)) {
      const here = terms.filter((y) => inside(y.cwd, x.path));
      const status = here.map((y) => y.status).filter(Boolean).sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0))[0] ?? null;
      map.set(x.path, { spaces: places.filter(([, at]) => inside(at, x.path)).map(([s]) => s), terminals: here.length, status });
    }
    return map;
  }

  // The folder a worktree sits in, from the workspace's root when it's inside it.
  where(path) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const def = defOf(this.workspace);
    for (const root of [def?.root, def?.real?.[def?.root]]) if (root && inside(dir, root)) return dir === root ? "." : dir.slice(root.length + 1);
    return tilde(dir);
  }

  // What each filter keeps, given what's in each worktree now.
  tests(live) {
    const used = (x) => { const on = live.get(x.path); return Boolean(on && (on.spaces.length || on.terminals)); };
    return {
      all: () => true,
      finished: (x) => finished(x, used(x)),
      changes: (x) => x.dirty > 0,
      used,
      empty: (x) => kindOf(x) === "empty" && x.dirty === 0 && !used(x),
    };
  }

  // A click ticks or unticks one row. A shift-click gives every row from the one
  // clicked last to this one that row's state.
  pick(path, shift, cx) {
    // The rows as shown, top to bottom, under the filter that's on.
    const order = this.repos.flatMap((r) => r.trees).filter(this.tests(this.live())[this.filter]).map((x) => x.path);
    const from = this.anchor ? order.indexOf(this.anchor.path) : -1, to = order.indexOf(path);
    if (shift && from >= 0 && to >= 0) {
      for (const p of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (this.anchor.on) this.selected.add(p); else this.selected.delete(p);
      }
    } else {
      const on = !this.selected.has(path);
      if (on) this.selected.add(path); else this.selected.delete(path);
      this.anchor = { path, on };
    }
    cx.notify();
  }

  open(tree, on) {
    if (on.spaces[0]) run("space.select", { id: on.spaces[0].id });
    else run("space.new", { folder: tree.path });
  }

  // `picked`: the ticked rows, whatever state they're in (else: the finished ones).
  remove(trees, live, picked = false) {
    const def = defOf(this.workspace);
    openOverlay({
      mod: "ws-worktrees", kind: "dialog", width: 480, height: trees.length === 1 ? 290 : picked ? 380 : 320,
      props: {
        dialog: "remove", workspace: this.workspace, name: def?.name ?? "", picked,
        trees: trees.map((x) => ({
          path: x.path, branch: x.branch, repo: x.repo, label: labelOf(x), dirty: x.dirty ?? 0, merged: ["merged", "empty"].includes(kindOf(x)),
          spaces: (live.get(x.path)?.spaces ?? []).map((s) => s.id), terminals: live.get(x.path)?.terminals ?? 0,
        })),
      },
    });
  }

  setUp(tree, repo, cx) {
    const line = this.scripts?.scriptOf(repo.name, "setup");
    if (!line?.line || !line.allowed || this.busy[tree.path]) return;
    this.busy[tree.path] = "setup";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await runScript(io, line.line, { path: tree.path, main: repo.main, branch: tree.branch, ws: this.workspace });
      if (r.ok) { await markSetUp(io, tree.path); tree.setUp = true; }
      notify({ title: r.ok ? `Set up ${tree.branch ?? base(tree.path)}` : `Setup failed in ${tree.branch ?? base(tree.path)}`, body: r.tail, level: r.ok ? "success" : "error" });
      delete this.busy[tree.path];
      cx.notify();
    });
  }

  // Opens a repo's scripts (again: closes them), read from the file as it is now.
  edit(repo, cx) {
    if (this.editing?.main === repo.main) { this.editing = null; return cx.notify(); }
    cx.spawn(async (cx) => {
      this.scripts = await loadScripts(io, this.workspace);
      const state = (kind, placeholder) => {
        const s = InputState.new({ value: this.scripts.scriptOf(repo.name, kind).line, placeholder });
        s.on("change", (_e, cx) => { if (this.editing) { this.editing.saved = false; this.editing.error = null; } cx.notify(); });
        s.on("submit", (_e, cx) => this.save(repo, cx));
        return s;
      };
      this.editing = {
        main: repo.main, saved: false, error: null,
        setup: state("setup", 'e.g. pnpm install && cp "$HERDR_REPO/.env" .'),
        archive: state("archive", "e.g. docker compose down"),
      };
      this.editing.setup.focus();
      cx.notify();
    });
  }

  save(repo, cx) {
    const e = this.editing;
    if (!e || e.main !== repo.main) return;
    cx.spawn(async (cx) => {
      try {
        await saveScripts(io, this.workspace, repo.name, { setup: e.setup.value(), archive: e.archive.value() });
        this.scripts = await loadScripts(io, this.workspace);
        e.saved = true;
      } catch (err) { e.error = message(err); }
      cx.notify();
    });
  }

  allow(repo, cx) {
    cx.spawn(async (cx) => {
      try { await allowScripts(io, this.workspace, repo.name); this.scripts = await loadScripts(io, this.workspace); }
      catch (e) { notify({ title: "Couldn't allow the scripts", body: message(e), level: "error" }); }
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    if (props()?.dialog) return this.dialog(t);
    const def = defOf(this.workspace);
    const shell = v_flex().id("worktrees").size_full().min_h(0).bg(t.canvas).text_size(13).text_color(t.foreground)
      .when(this.follow, (el) => el.track_focus(this.handle));
    // Between two workspaces (the timer is a moment behind): nothing of the last one.
    if (this.follow && (shared("workspaces.active") ?? null) !== this.workspace) return shell;
    if (!def) {
      return shell.items_center().justify_center().text_color(t.dim)
        .child(this.workspace ? "This workspace is gone." : this.follow ? "Choose a workspace in the switcher to see its worktrees." : "Open the worktrees from the workspace switcher's menu.");
    }
    const live = this.live();
    const all = this.repos.flatMap((r) => r.trees);
    const tests = this.tests(live);
    const done = all.filter(tests.finished);
    const show = tests[this.filter] ?? tests.all;
    const shown = all.filter(show);
    const picked = all.filter((x) => this.selected.has(x.path));
    const allPicked = shown.length > 0 && shown.every((x) => this.selected.has(x.path));

    const button = (id, text, action, { solid = false, tip = null, danger = false } = {}) => div().id(id).h(26).px(10).flex().flex_none().items_center().rounded(7)
      .text_size(12).cursor_pointer()
      .when(solid, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_medium().hover((s) => s.opacity(0.88)))
      .when(!solid, (el) => el.border_1().border_color(t.input).text_color(danger ? t.blocked : t.muted).hover((s) => s.bg(t.hover).text_color(danger ? t.blocked : t.foreground)))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => action(cx)).child(text);
    const chip = ([key, text]) => {
      const n = all.filter(tests[key]).length, on = this.filter === key;
      return h_flex().id(`f-${key}`).h(26).px(10).gap(6).flex_none().items_center().rounded(13).border_1().cursor_pointer().text_size(12)
        .border_color(on ? t.accent : t.input).text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected))
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.filter = key; cx.notify(); })
        .child(text).child(div().text_color(t.dim).child(String(n)));
    };

    const header = h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(mark(def, t, 20))
      .child(div().font_semibold().child(`${def.name} worktrees`))
      .child(div().text_size(12).text_color(t.dim).child(this.loaded ? `${all.length} in ${plural(this.repos.filter((r) => r.trees.length).length, "repo")}` : "Reading…"))
      .when(this.reading && this.loaded, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.dim).spin(900)))
      .child(div().flex_1())
      .child(button("wt-refresh", "Refresh", (cx) => this.load(cx), { tip: "Read git and GitHub again" }))
      .when(picked.length > 0, (el) => el
        .child(button("wt-unpick", "Clear", (cx) => { this.selected.clear(); cx.notify(); }, { tip: "Untick every row" }))
        .child(button("wt-picked", `Remove ${picked.length} selected…`, () => this.remove(picked, live, true),
          { solid: true, tip: "The ticked rows, after a confirmation that says what would be lost" })))
      .when(!picked.length && done.length > 0, (el) => el.child(button("wt-clean", `Remove ${done.length} finished…`, () => this.remove(done, live),
        { solid: true, tip: "Merged, nothing uncommitted, and nothing open or running in them" })));

    const filters = h_flex().h(44).flex_none().px(16).gap(6).items_center().children(FILTERS.map(chip))
      .child(div().flex_1())
      .when(shown.length > 0, (el) => el.child(div().id("wt-pick-all").h(26).px(8).flex().flex_none().items_center().rounded(7).text_size(12)
        .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(allPicked ? "Untick the rows shown" : "Tick every row shown, to remove them together")
        .on_click((_e, cx) => { for (const x of shown) { if (allPicked) this.selected.delete(x.path); else this.selected.add(x.path); } cx.notify(); })
        .child(allPicked ? "Deselect these" : this.filter === "all" ? `Select all ${shown.length}` : `Select these ${shown.length}`)));

    // Every repo shows under All, so one without worktrees can still get scripts.
    const kids = [];
    if (this.scripts?.error) kids.push(div().px(6).py(6).text_size(12).text_color(t.blocked).child(this.scripts.error));
    for (const r of this.repos) {
      const rows = r.trees.filter(show);
      const editing = this.editing?.main === r.main;
      if (this.filter !== "all" && !rows.length && !editing) continue;
      kids.push(this.repoHead(r, rows.length, t, button));
      if (editing) kids.push(this.scriptsPanel(r, t, button));
      for (const x of rows) kids.push(this.row(x, r, live.get(x.path), t));
      if (!r.trees.length) kids.push(div().h(30).px(6).flex().flex_none().items_center().text_size(12).text_color(t.dim).child("No worktrees."));
    }
    if (this.loaded && !this.repos.length) kids.push(div().p(16).text_color(t.dim).child(`No git repository in ${tilde(def.root)} or its folders.`));
    else if (this.loaded && this.filter !== "all" && !shown.length) kids.push(div().p(16).text_color(t.dim).child("None like that."));
    const body = v_flex().id("wt-list").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(16).children(kids);
    const noGh = this.repos.some((r) => r.trees.length && r.prs === null);
    return shell.child(header).child(filters).child(body)
      .when(noGh, (el) => el.child(div().h(28).flex_none().px(16).flex().items_center().border_t(1).border_color(t.border).text_size(11.5).text_color(t.dim)
        .child("Pull requests couldn't be read for some repos (gh missing, signed out, or no GitHub remote), so nothing there counts as finished.")));
  }

  repoHead(r, count, t, button) {
    const setup = this.scripts?.scriptOf(r.name, "setup"), archive = this.scripts?.scriptOf(r.name, "archive");
    const waiting = (setup && !setup.allowed) || (archive && !archive.allowed);
    const has = Boolean(setup?.line || archive?.line);
    return h_flex().h(40).mt(6).px(6).gap(8).items_center().flex_none()
      .child(svg("mods/workspace-chrome/git-branch.svg").size(14).flex_none().text_color(t.muted))
      .child(div().font_semibold().child(r.name))
      .child(div().text_size(12).text_color(t.dim).child(`${count === r.trees.length ? r.trees.length : `${count} of ${r.trees.length}`}${r.base ? ` · against ${r.base}` : ""}`))
      .child(div().flex_1())
      .when(waiting, (el) => el.child(div().text_size(12).text_color(t.blocked).child("A script is waiting to be allowed")))
      .child(button(`sc-${r.main}`, this.editing?.main === r.main ? "Close scripts" : has ? "Scripts" : "Add scripts", (cx) => this.edit(r, cx),
        { tip: "What runs in a new worktree, and before one is removed" }));
  }

  scriptsPanel(r, t, button) {
    const e = this.editing;
    const field = (label, state, hint) => v_flex().gap(4)
      .child(div().text_size(12).text_color(t.muted).child(label))
      .child(Input.new(state).h(30).px(10).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground))
      .child(div().text_size(11.5).text_color(t.dim).child(hint));
    const waiting = ["setup", "archive"].some((k) => !this.scripts?.scriptOf(r.name, k).allowed);
    return v_flex().mx(6).mb(8).p(12).gap(10).rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(field("After a worktree is made", e.setup, "One line of sh, run in the new worktree when the board makes one, or from a row's Set up. $HERDR_REPO is the main checkout."))
      .child(field("Before a worktree is removed", e.archive, "Run in the worktree first. If it fails, the worktree stays."))
      .when(waiting, (el) => el.child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(12).text_color(t.blocked).child("These lines were changed outside this screen and won't run until you allow them. Read them first."))
        .child(button(`allow-${r.main}`, "Allow as written", (cx) => this.allow(r, cx)))))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(12).text_color(e.error ? t.blocked : t.dim).child(e.error ?? (e.saved ? "Saved." : "")))
        .child(button(`save-${r.main}`, "Save", (cx) => this.save(r, cx), { solid: true })));
  }

  row(x, r, on, t) {
    const kind = kindOf(x);
    const color = { merged: t.done, open: t.working, closed: t.muted, empty: t.dim, work: t.foreground, detached: t.muted }[kind];
    const inUse = Boolean(on && (on.spaces.length || on.terminals));
    const card = this.cards.get(x.path);
    const setup = this.scripts?.scriptOf(r.name, "setup");
    const busy = this.busy[x.path];
    const tag = (text, c, tip) => div().flex_none().h(20).px(6).flex().items_center().rounded(5).bg(t.raised).text_size(11.5).text_color(c)
      .when(Boolean(tip), (el) => el.tooltip(tip)).child(text);
    const act = (id, text, action, tip, danger) => div().id(id).h(24).px(8).flex().flex_none().items_center().rounded(6).border_1().border_color(t.input)
      .text_size(11.5).text_color(danger ? t.blocked : t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(danger ? t.blocked : t.foreground))
      .tooltip(tip).on_click((_e, cx) => action(cx)).child(text);
    const ticked = this.selected.has(x.path);
    return h_flex().id(`wt-${x.path}`).h(38).px(6).gap(8).items_center().flex_none().rounded(7).hover((s) => s.bg(t.hover))
      .when(ticked, (el) => el.bg(t.selected))
      .child(h_flex().id(`pick-${x.path}`).w(26).h(38).flex_none().items_center().justify_center().cursor_pointer()
        .tooltip("Tick it to remove several together. Shift-click ticks every row from the last one you ticked.")
        .on_click((e, cx) => this.pick(x.path, Boolean(e?.modifiers?.shift), cx))
        .child(h_flex().size(15).rounded(4).border_1().items_center().justify_center()
          .border_color(ticked ? t.accent : t.input).when(ticked, (el) => el.bg(t.accent).text_color(t.accent_foreground)
            .child(svg("mods/workspace-chrome/check.svg").size(11)))))
      .child(div().size(7).flex_none().rounded_full().bg(on?.status ? (t[on.status] ?? t.unknown) : inUse ? t.idle : "#00000000"))
      .child(div().flex_none().max_w(420).truncate().child(x.branch ?? base(x.path)))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).tooltip(tilde(x.path)).child(this.where(x.path)))
      .when(Boolean(card), (el) => el.child(tag(card, t.muted, "A board card runs here")))
      .when(inUse, (el) => el.child(tag(on.spaces.length ? "open" : plural(on.terminals, "terminal"), t.accent,
        on.spaces.length ? `Shown as the space “${on.spaces[0].name}”` : "A terminal is in it, outside any space")))
      .when(x.dirty > 0, (el) => el.child(tag(`${x.dirty} uncommitted`, t.blocked, "Files changed or added and not committed")))
      .child(tag(labelOf(x), color, r.prs === null ? "Pull requests couldn't be read for this repo" : null))
      .child(div().w(34).flex_none().text_size(11.5).text_color(t.dim).child(ago(x.at)))
      .when(Boolean(setup?.line && setup.allowed && !x.setUp), (el) => el.child(busy
        ? div().w(52).flex_none().text_size(11.5).text_color(t.dim).child("Setting up…")
        : act(`su-${x.path}`, "Set up", (cx) => this.setUp(x, r, cx), `Run: ${setup.line}`)))
      .child(act(`op-${x.path}`, on?.spaces.length ? "Go to" : "Open", () => this.open(x, on ?? { spaces: [] }), on?.spaces.length ? "Show its space" : "Open it as a space"))
      .child(act(`rm-${x.path}`, "Remove…", () => this.remove([x], new Map([[x.path, on]])), "Delete the folder; the branch stays", true));
  }

  // --- the remove dialog ---

  initDialog(cx) {
    const p = props();
    this.trees = p.trees ?? [];
    this.working = false;
    this.error = "";
    this.force = false;
    this.ready = false;
    this.archive = {}; // repo name -> { line, allowed }
    this.progress = null; // while removing: { at, name, step: "script" | "remove", failed }
    this.stop = false; // Esc while removing: finish this one, leave the rest
    this.handle.focus();
    if (checking()) return;
    cx.spawn(async (cx) => {
      const scripts = await loadScripts(io, p.workspace);
      for (const x of this.trees) this.archive[base(x.repo)] ??= scripts.scriptOf(base(x.repo), "archive");
      // One worktree, or ones picked by hand: look again, they may have changed
      // since the list was read, and what's uncommitted there is about to go.
      if (this.trees.length === 1 || p.picked) {
        let next = 0;
        await Promise.all(Array.from({ length: SLOW }, async () => {
          while (next < this.trees.length) {
            const x = this.trees[next++];
            const s = await git(x.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], 60000);
            if (s.ok) x.dirty = s.out.split("\n").filter(Boolean).length;
          }
        }));
      }
      this.ready = true;
      cx.notify();
    });
  }

  // Esc: closes the dialog, or, while it's removing, stops after the one in hand.
  // Closing mid-way would end the task with the list never told what went.
  cancel(cx) {
    if (!this.working) return closeOverlay(props().overlay);
    this.stop = true;
    cx.notify();
  }

  blocked() {
    return Object.entries(this.archive).filter(([, a]) => a.line && !a.allowed).map(([repo]) => repo);
  }

  go(cx) {
    if (this.working || !this.ready || this.blocked().length) return;
    this.working = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const p = props();
      const one = this.trees.length === 1;
      const byHand = one || Boolean(p.picked);
      const failed = [];
      let removed = 0;
      let at = 0;
      for (const x of this.trees) {
        if (this.stop) break;
        const name = x.branch ?? base(x.path);
        const a = this.archive[base(x.repo)];
        // Said before each one, and each step of it: deleting a big checkout takes a while.
        const say = (step) => { this.progress = { at, name, step, failed: failed.length }; cx.notify(); };
        at++;
        say(a?.line && !this.force ? "script" : "remove");
        if (a?.line && !this.force) {
          const r = await runScript(io, a.line, { path: x.path, main: x.repo, branch: x.branch, ws: p.workspace });
          if (!r.ok) { failed.push(`${name}: its before-removal script failed. ${r.tail}`); continue; }
          say("remove");
        }
        // Spaces first: a shell sitting in the folder keeps it busy.
        for (const id of byHand ? x.spaces : []) run("space.close", { id, confirmed: true });
        // The finished ones are never forced: only what git itself calls clean goes.
        // One picked by hand is, when the dialog said its changes would be lost.
        const force = (byHand && x.dirty > 0) || (one && this.force);
        const r = await git(x.repo, ["worktree", "remove", ...(force ? ["--force"] : []), x.path], 600000);
        if (r.ok) removed++;
        else failed.push(`${name}: ${r.err.split("\n").pop() || "git worktree remove failed"}`);
      }
      const left = this.trees.length - removed - failed.length; // Esc stopped it before these
      this.working = false;
      this.progress = null;
      if (removed) setShared("workspaces.worktrees.changed", Date.now());
      if (one && failed.length) {
        this.error = failed[0];
        this.force = true;
        return cx.notify();
      }
      if (!one) {
        notify({
          title: `Removed ${plural(removed, "worktree")}${failed.length ? `, ${failed.length} couldn't be` : ""}${left ? `, stopped with ${left} to go` : ""}`,
          body: failed.slice(0, 3).join("\n"), level: failed.length || left ? "warning" : "success",
        });
      }
      closeOverlay(p.overlay);
    });
  }

  dialog(t) {
    const p = props();
    const one = this.trees.length === 1 ? this.trees[0] : null;
    const blocked = this.blocked();
    const scripts = Object.entries(this.archive).filter(([, a]) => a.line && a.allowed);
    const names = this.trees.slice(0, 4).map((x) => x.branch ?? base(x.path)).join(", ") + (this.trees.length > 4 ? ` and ${this.trees.length - 4} more` : "");
    const warn = (text) => div().text_color(t.blocked).child(text);
    // Picked by hand, several: what each kind of loss covers, by name.
    const many = !one && p.picked ? this.trees : null;
    const some = (list) => list.slice(0, 3).map((x) => x.branch ?? base(x.path)).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
    const dirty = (many ?? []).filter((x) => x.dirty > 0), open = (many ?? []).filter((x) => x.spaces.length);
    const loose = (many ?? []).filter((x) => !x.spaces.length && x.terminals), unmerged = (many ?? []).filter((x) => !x.merged);
    const g = this.progress, total = this.trees.length;
    const hint = this.working ? (this.stop ? "stopping after this one…" : total > 1 ? "esc stops after this one" : "working…") : !this.ready ? "…" : blocked.length ? "esc close"
      : this.force ? "↵ remove anyway · esc cancel" : "↵ remove · esc cancel";
    return v_flex().id("wt-remove").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.cancel(cx);
        if (e.key === "enter") this.go(cx);
      })
      .size_full().p(16).gap(10).bg(t.popover).text_size(13).text_color(t.muted)
      .child(div().font_semibold().text_color(t.foreground).child(one ? `Remove the worktree ${one.branch ?? base(one.path)}?`
        : many ? `Remove ${this.trees.length} worktrees of ${p.name}?` : `Remove ${this.trees.length} finished worktrees of ${p.name}?`))
      .child(div().child(one
        ? `Deletes ${tilde(one.path)}. The branch stays, so nothing committed is lost.`
        : many ? `${names}. Their folders are deleted; the branches stay, so nothing committed is lost.`
          : `${names}. Each is merged with nothing uncommitted. Their folders are deleted; the branches stay.`))
      .when(Boolean(many && this.ready && dirty.length), (el) => el.child(warn(`${dirty.length === 1 ? "1 has" : `${dirty.length} have`} uncommitted changes that will be lost: ${some(dirty)}.`)))
      .when(Boolean(many && open.length), (el) => el.child(warn(`${open.length === 1 ? "1 is open as a space, which" : `${open.length} are open as spaces, which`} will be closed, and what runs there ends: ${some(open)}.`)))
      .when(Boolean(many && loose.length), (el) => el.child(warn(`${loose.length === 1 ? "1 has" : `${loose.length} have`} a terminal in it outside any space: ${some(loose)}.`)))
      .when(Boolean(many && unmerged.length), (el) => el.child(div().child(`${unmerged.length === 1 ? "1 has commits that aren't merged: they stay on its branch" : `${unmerged.length} have commits that aren't merged: they stay on their branches`}.`)))
      .when(Boolean(one && one.label), (el) => el.child(div().child(`It stands at: ${one.label}.`)))
      .when(Boolean(one && one.dirty > 0), (el) => el.child(warn(one.dirty === 1 ? "It has 1 uncommitted change: it will be lost." : `It has ${one.dirty} uncommitted changes: they will be lost.`)))
      .when(Boolean(one && one.spaces.length), (el) => el.child(warn("Its space will be closed, and what runs in it ends.")))
      .when(Boolean(one && !one.spaces.length && one.terminals), (el) => el.child(warn(`${plural(one.terminals, "terminal")} outside a space ${one.terminals === 1 ? "is" : "are"} in it and will lose the folder.`)))
      .children(scripts.map(([repo, a]) => div().child(`Runs first${one ? "" : ` in ${repo}`}: ${a.line}`)))
      .when(blocked.length > 0, (el) => el.child(warn(`The before-removal script of ${blocked.join(", ")} was changed outside the Worktrees screen. Allow it under Scripts first.`)))
      .when(Boolean(this.error), (el) => el.child(warn(this.error)))
      .when(Boolean(this.error && this.force), (el) => el.child(div().child(`Enter again ${scripts.length ? "skips the script and " : ""}forces it (git worktree remove --force).`)))
      .child(div().flex_1())
      .when(Boolean(this.working && g), (el) => el.child(v_flex().gap(6)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground)
            .child(`${g.step === "script" ? "Running its script" : "Deleting"}${total > 1 ? ` ${g.at} of ${total}` : ""}: ${g.name}`))
          .when(g.failed > 0, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.blocked).child(`${g.failed} couldn't be removed`))))
        .when(total > 1, (el) => el.child(div().h(4).w_full().rounded(2).bg(t.raised)
          .child(div().h(4).rounded(2).bg(t.accent).w(Math.round(448 * (g.at - 1) / total)))))))
      .child(h_flex().justify_end().gap(6).text_size(11).text_color(t.dim)
        .when(this.working, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
        .child(hint));
  }
}
