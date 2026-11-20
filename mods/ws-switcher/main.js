// Workspaces: named groups of spaces, each a folder of repos. A workspace is
// ~/.herdr/workspaces/<id>/workspace.jsonc (name, color, root, folders) plus the
// AGENTS.md its agents are told (bin/herdr-ws-agent adds it on launch).
// This block sits above the spaces list and shows the chosen workspace; a click
// opens the menu to switch. `ws-spaces` and `ws-agents` show only that workspace's
// spaces and agents. While the shown workspace has no spaces, it shows the layout's
// empty block (another copy of this mod, props.empty) in place of the work column,
// which would otherwise show some other workspace's space (coverWork()).
//
// Files it writes: ~/.herdr/workspaces/.index (the workspaces' folders, for
// bin/herdr-ws-agent) and, from "New workspace from a folder…", a new workspace's
// two files. It runs your editor (or the system's opener) from "Edit".
//
// Shared state, read by ws-spaces and ws-agents too:
//   workspaces.defs      the parsed configs
//   workspaces.active    the chosen workspace's id, null for every space
//   workspaces.assigned  space id -> workspace id (false: kept out of all of them)
//   workspaces.last      workspace id -> the space last shown in it
//   workspaces.create    a time: the menu asks this block to make a workspace
//   workspaces.scratch   { at, name? }: the New scratch space dialog asks this block for a scratch space (scratch.js)
//   workspaces.scratch.folders  the Scratch workspace's folders, newest first, for the menu and ws-spaces
//   workspaces.worktrees { id, at }: the menu asks this block to show a workspace's
//                        Worktrees screen (ws-worktrees), as workspaces.board does the board
//   workspaces.history   { id, at }: the sidebar's History row and the + menu ask this block to show a
//                        workspace's History screen (ws-history); with no id (All spaces), as a dialog
//   workspaces.screens   workspace id -> its open screens ("board", "worktrees", "history"): the pills
//                        ws-tabs draws before the tabs of every space of that workspace
//   workspaces.screen    { ws, screen, at } or null: the screen shown in place of the tabs.
//                        Anyone sets it (ws-tabs' pills; null from ws-spaces and ws-agents
//                        when a space or agent is clicked); this block shows it (coverWork())
//   workspaces.covered   true while the shown space isn't the shown workspace's (it has none)
//   workspaces.order     { order, folded }: the menu's order and folded groups (arrange.js, ~/.herdr/workspaces/.order.json)
//   workspaces.arrange   { order?, folded?, groups?: { id: group or null }, at }: the menu asks this block to
//                        save a drag, a fold or a workspace's group (applyArrange())
//
//   workspaces.prs       task file -> its pull request's one status (prs.js), drawn by ws-board
//   workspaces.github    task file -> its GitHub board item's status (ghboard.js), drawn by ws-board
//
// It also runs each workspace's automations (automations.js) and follows board cards'
// pull requests (prs.js) and GitHub board items (ghboard.js): the one runner of each lives in this sidebar
// copy and ticks on its timer. Unless the background runner is on
// (bin/herdr-ws-runner, ~/.herdr/runner/switch): then a process herdr-core holds
// runs both, Herdr open or closed, and this copy only passes things between it and
// the window (background()): it starts it when it isn't running, copies what it
// publishes (~/.herdr/runner/state.json) into shared state, shows its notes as
// toasts, names the tabs and spaces of the runs it started, and hands it the
// screen's Run now and allowed checks as files in the inbox.
//   workspaces.runner      { on, running }: the background runner, for the screens
//   workspaces.runner.set  { on, at }: a screen asks to turn it on or off
//
// A space joins a workspace once and stays: when its first terminal is under the
// workspace's root or one of its folders (a herdr worktree goes by its repo's
// name), or when it's made while that workspace is shown.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, machines, run, theme, shared, setShared, props, openOverlay, closeOverlay,
  home, appHome, layout, watchFolder, readTextFile, writeTextFile, pickFolder, exec, notify, window, nextCommand, focused,
} from "herdr";
import * as fs from "fs/promises";
import { Runner, runnerDir, globalDir } from "./automations.js";
import { PrWatcher } from "./prs.js";
import { GhWatcher } from "./ghboard.js";
import { Scratch, isScratch, scratchDef, scratchLabel } from "./scratch.js";
import { dir, expand, tilde, under, base, subdirs, loadDefs, loadOrder, orderFile, templatesDir, loadPresetDir, presetsFor, presetLaunch, withTask } from "./defs.js";
import { arrange, move as moveRow, groupOf, groupName, renamed, withGroup, orderText } from "./arrange.js";

// "Edit" opens the workspace's folder in the first of these that's installed,
// else with the system's opener (Finder, the file manager, Explorer).
const EDITORS = ["zed", "cursor", "code", "subl"];
const SETTLE = 1500; // ms a new space's first terminal takes to report its folder
// A workspace's screens: they belong to the workspace, not to a space. The layout
// holds each once, as the block `screen-<key>` in the `screens` column of `center`.
const SCREENS = { board: { mod: "ws-board", name: "Board" }, worktrees: { mod: "ws-worktrees", name: "Worktrees" }, history: { mod: "ws-history", name: "History" } };
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
// The spaces list's avatar colors, so a workspace mark matches.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const URGENT = { blocked: 2, done: 1 };


function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// The sidebar's rail goes by its width, as in the other sidebar mods.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;


// A folder of the workspace and, when a symlink leads there, where it really is.
function realOf(def, path) {
  if (def.real?.[path]) return def.real[path];
  const root = def.real?.[def.root];
  return root && path.startsWith(def.root + "/") ? root + path.slice(def.root.length) : null;
}
const inFolder = (def, at, folder) => under(at, folder) || under(at, realOf(def, folder));

// What bin/herdr-ws-agent reads (a shell script can't read JSONC): one line per
// fact, tab-separated. ws: id, root, instructions file. dir: id, a root or folder.
// repo: id, a repo name a herdr worktree can be named after.
function indexText(defs) {
  const ok = (s) => !/[\t\n]/.test(s);
  const lines = ["# Written by the ws-switcher mod for herdr-ws-agent. Don't edit: it's rewritten."];
  for (const d of defs) {
    if (d.error || !d.root || !ok(d.root) || !ok(d.instructions)) continue;
    lines.push(["ws", d.id, d.root, d.instructions].join("\t"));
    for (const f of [d.root, ...d.folders]) if (ok(f)) lines.push(["dir", d.id, f].join("\t"));
    for (const r of new Set([...d.children, ...d.folders.map(base)])) if (ok(r)) lines.push(["repo", d.id, r].join("\t"));
  }
  return lines.join("\n") + "\n";
}


// Starts a preset as a tab named after it in the shown space (its focused
// terminal's folder), else as a new space in the workspace's root. `prompt`:
// the task for its first message, if any.
function startPreset(preset, active, prompt = "") {
  const shown = spaces().find((s) => s.active);
  const launch = presetLaunch(preset, prompt);
  const { argv, task } = withTask(launch.argv, launch.task);
  if (shown) run("tab.new", { space: shown.id, name: preset.name, argv, ...(task ? { task } : {}) });
  else run("space.new", { ...(active?.root ? { folder: active.root } : {}), tab: preset.name, argv, ...(task ? { task } : {}) });
}

// Opens a folder in the first installed editor of EDITORS, else the system's opener.
function openFolder(path) {
  if (window()?.platform === "windows") return exec("explorer", [path]).catch(() => {});
  const editors = EDITORS.map((e) => `command -v ${e} >/dev/null 2>&1 && exec ${e} "$1";`).join(" ");
  return exec("sh", ["-c", `${editors} command -v open >/dev/null 2>&1 && exec open "$1"; exec xdg-open "$1"`, "sh", path]).catch(() => {});
}

// workspace.jsonc with its top-level "name" set, comments and all kept as written.
function withName(text, name) {
  const value = JSON.stringify(name);
  let depth = 0, key = null, colon = false, open = -1;
  for (let i = 0; i < text.length;) {
    if (text.startsWith("//", i)) { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e; continue; }
    if (text.startsWith("/*", i)) { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 2; continue; }
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (depth === 1 && colon && key === "name") return text.slice(0, i) + value + text.slice(j + 1);
      if (depth === 1 && !colon) key = JSON.parse(text.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") { if (depth === 0 && open < 0) open = i; depth++; }
    else if (c === "}" || c === "]") depth--;
    else if (c === ":" && depth === 1) colon = true;
    else if (c === "," && depth === 1) { colon = false; key = null; }
    i++;
  }
  if (open < 0) throw new Error("workspace.jsonc has no { }");
  return `${text.slice(0, open + 1)}\n  "name": ${value},${text.slice(open + 1)}`;
}

// Moves a folder to the Trash ($1), or to $2/$3 where there's no Trash command.
// Prints where it went.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/$3" && echo "$2/$3"`;

// The delete dialog's words for the Scratch workspace: its folders and spaces go too.
function scratchDeleteText(d) {
  const folders = (shared("workspaces.scratch.folders") ?? []).length;
  const open = spaces().filter((s) => (shared("workspaces.assigned") ?? {})[s.id] === d.id).length;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return `Moves ${tilde(d.dir)} and ${tilde(d.root)} (${n(folders, "scratch folder", "scratch folders")}, kept ones too) to the Trash`
    + (open ? `, and closes its ${n(open, "space", "spaces")}, ending what runs there.` : ".")
    + " Scratch comes back, empty, the next time you make a scratch space.";
}

// Where a space is now: its first terminal's live folder, else where it was made.
function placeOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}

// The workspace a folder belongs to: the most specific root or folder holding it.
function match(path, defs) {
  let best = null, length = -1;
  for (const d of defs) for (const f of [d.root, ...d.folders]) {
    if (inFolder(d, path, f) && f.length > length) { best = d; length = f.length; }
  }
  if (best) return best.id;
  const trees = `${home()}/.herdr/worktrees/`;
  if (!path.startsWith(trees)) return null;
  const repo = path.slice(trees.length).split("/")[0];
  return defs.find((d) => d.children.includes(repo) || d.folders.some((f) => base(f) === repo))?.id ?? null;
}

function urgent(list) {
  let best = null;
  for (const s of list) if ((URGENT[s.status] ?? 0) > (URGENT[best] ?? 0)) best = s.status;
  return best;
}

// New scratch space, wherever it's asked for (the menu, the Spaces +, the empty work
// area, the command): the New space dialog in its Scratch form, which asks for the name.
// ws-spaces opens the same one (askNewSpace()); keep the two sizes alike.
const askScratch = () => openOverlay({ mod: "ws-switcher", kind: "dialog", width: 460, height: 234,
  props: { dialog: "new-space", id: scratchDef(shared("workspaces.defs"))?.id ?? null, scratch: true } });

function mark(def, defs, t, size) {
  if (!def) {
    return h_flex().size(size).flex_none().rounded(5).border_1().border_color(t.input).items_center().justify_center()
      .text_color(t.muted).child(svg("mods/workspace-chrome/layers.svg").size(Math.round(size * 0.6)));
  }
  const c = def.color ?? PALETTE[Math.max(0, defs.findIndex((d) => d.id === def.id)) % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
  return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(Math.round(size * 0.55)).font_bold().text_color("#ffffff").child([...def.name][0]?.toUpperCase() ?? "?");
}

// Show a workspace, and the space last shown in it (else its first).
function choose(id) {
  setShared("workspaces.active", id);
  if (!id) return;
  const assigned = shared("workspaces.assigned") ?? {};
  const mine = spaces().filter((s) => assigned[s.id] === id);
  if (!mine.length || mine.some((s) => s.active)) return;
  const last = (shared("workspaces.last") ?? {})[id];
  run("space.select", { id: (mine.find((s) => s.id === last) ?? mine[0]).id });
}

function configText(name, color, root, folders) {
  return `// A Herdr workspace. The switcher above the spaces list reads this file;
// edits apply at once. Comments and trailing commas are fine.
{
  // Shown in the switcher.
  "name": ${JSON.stringify(name)},
  // Its mark: ansi1..ansi6 (theme colors) or "#rrggbb".
  "color": ${JSON.stringify(color)},
  // The folder the work lives in. A space whose terminal is under it joins
  // this workspace, and so does a space made while this workspace is shown.
  "root": ${JSON.stringify(root)},
  // The repos and folders used here: relative to root, or absolute (~ works)
  // for one that lives elsewhere. The switcher lists them to open as spaces.
  "folders": [
${folders.map((f) => `    ${JSON.stringify(f)},`).join("\n")}
  ],
  // What every agent started here is told (claude, codex), on top of each
  // repo's own CLAUDE.md / AGENTS.md. Default: AGENTS.md next to this file.
  // "instructions": "AGENTS.md",
  // The task board (ws-board). All optional; these are the defaults.
  // "board": { "columns": ["backlog", "todo", "doing", "review", "done"],
  //            "agent": "claude", "start": "doing", "finish": "review" },
}
`;
}

const instructionsText = (name) => `<!-- What every agent (claude, codex) started in the ${name} workspace is told,
     on top of each repo's own CLAUDE.md / AGENTS.md. Write below this comment;
     the comment itself is not sent. Applies to agents started after you save. -->
`;

export default class Workspaces extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // The layout's empty block (beside the work column in the `center` stack): it only draws.
    if (props()?.empty) return;
    if (props()?.popup) {
      this.handle.focus();
      // The group submenus' boxes: a new group's name, and a group's new name.
      this.newGroupIn = InputState.new({ value: "", placeholder: "New group…" });
      this.renameIn = InputState.new({ value: "" });
      this.newGroupIn.on("submit", (_e, cx) => this.groupTyped(this.newGroupIn.value(), cx));
      this.renameIn.on("submit", (_e, cx) => this.groupTyped(this.renameIn.value(), cx));
      return;
    }
    if (props()?.dialog) {
      this.handle.focus();
      if (props().dialog === "new-space") this.initNewSpace(cx);
      if (props().dialog === "rename") {
        this.text = (shared("workspaces.defs") ?? []).find((d) => d.id === props().id)?.name ?? "";
        this.input = InputState.new({ value: this.text });
        this.input.set_selected_range({ start: 0, end: this.text.length });
        this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = null; cx.notify(); });
        this.input.on("submit", (_e, cx) => this.rename(cx));
        this.input.focus();
        cx.timer.after(600, () => this.input.focus());
      }
      return;
    }
    this.known = new Set(spaces().map((s) => s.id)); // decided: no "made while shown" fallback
    this.born = {};
    this.shown = spaces().find((s) => s.active)?.id ?? null;
    this.loaded = false;
    this.asked = shared("workspaces.create") ?? null;
    this.launchAsked = shared("workspaces.launch")?.at;
    this.boardAsked = shared("workspaces.board")?.at;
    this.treesAsked = shared("workspaces.worktrees")?.at;
    this.historyAsked = shared("workspaces.history")?.at;
    this.runAsked = shared("workspaces.automation.run")?.at;
    this.scratchAsked = shared("workspaces.scratch")?.at;
    this.allowAsked = shared("workspaces.automation.allow")?.at;
    this.setAsked = shared("workspaces.runner.set")?.at;
    this.arrangeAsked = shared("workspaces.arrange")?.at;
    // A space the runner makes for its runs joins that workspace at once.
    this.hooks = {
      presetsFor, presetLaunch, withTask,
      claim: (space, ws) => {
        this.known.add(space);
        setShared("workspaces.assigned", { ...(shared("workspaces.assigned") ?? {}), [space]: ws });
      },
    };
    this.runner = new Runner(this.hooks);
    this.prs = new PrWatcher();
    this.gh = new GhWatcher();
    this.scratch = new Scratch({
      home, exec, spaces, panes, run, notify, shared, setShared, readTextFile, writeTextFile, wsDir: dir,
      trash: async (path) => (await exec("sh", ["-c", TRASH, "sh", path, `${home()}/.herdr/scratch/.trash`, `${base(path)}-${Date.now()}`])).stdout.trim(),
    });
    // Commands for this copy: "ws-switcher.scratch-new" (bind it to a key) asks for a scratch
    // space's name, and "ws-switcher.scratch-new/<name>" makes one at once (a script; a blank
    // name is "Scratch <time>"); the scratch toast's Keep is "ws-switcher.scratch-keep/<folder>";
    // a toast about one automation is "ws-switcher.automation/<workspace>/<name>" (automations.js: openAt);
    // "ws-switcher.board", "ws-switcher.worktrees" and "ws-switcher.history" (bind them to keys) show
    // the shown workspace's screen, and go back to the tabs when it's the one shown.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try {
          if (c === "scratch-new") askScratch();
          else if (c.startsWith("scratch-new/")) await this.scratch.create(c.slice("scratch-new/".length));
          else if (SCREENS[c]) this.toggleScreen(c, cx);
          else if (c.startsWith("scratch-keep/")) await this.scratch.keep(c);
          else if (c.startsWith("automation/")) this.openAutomation(c);
        } catch (e) { notify({ title: c.startsWith("automation/") ? "Couldn't open Automations" : "Couldn't make a scratch space", body: String(e?.message ?? e), level: "error" }); }
      }
    });
    // known: the switch has been read once (nothing runs here before that).
    // owner: the background runner runs them, not this copy.
    this.bg = { known: false, owner: false, rev: null, tries: 0, tried: 0, failed: false };
    try { this.adopted = new Set(JSON.parse(localStorage.getItem("adopted") ?? "[]")); } catch { this.adopted = new Set(); }
    this.reload(cx);
    this.background(cx);
    cx.timer.every(2000, (cx) => this.background(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        let paths;
        try { paths = await watchFolder(dir()); }
        catch { cx.timer.every(5000, (cx) => { this.reload(cx); if (this.mine()) this.runner.changed([dir()], cx); }); return; }
        this.reload(cx);
        if (this.mine()) this.runner.changed(paths ?? [], cx);
      }
    });
    // The automations for every workspace (~/.herdr/automations), made if it isn't there.
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", globalDir()]).catch(() => {});
      for (;;) {
        try { await watchFolder(globalDir()); }
        catch { cx.timer.every(10000, (cx) => { if (this.mine()) this.reload(cx); }); return; }
        if (this.mine()) this.reload(cx);
      }
    });
    // herdr-core's templates: the global presets. The folder may not exist yet.
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(templatesDir()); }
        catch { cx.timer.every(10000, (cx) => this.reloadPresets(cx)); return; }
        this.reloadPresets(cx);
      }
    });
    // Placing and following also run here: Herdr doesn't draw while its window is
    // in the background, and a new space waits SETTLE for its folder.
    cx.timer.every(500, (cx) => { this.sync(); this.requests(cx); if (this.mine()) { this.runner.tick(cx); this.prs.tick(cx); this.gh.tick(cx); } this.scratch.tick(cx); if (spaces().some((s) => !this.known.has(s.id))) cx.notify(); });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      const gen = this.arrangeGen;
      const saved = await loadOrder();
      const defs = await loadDefs(saved);
      this.loaded = true;
      // What's shown already has a drag or group change being written: only a read
      // that began after it was written may replace it.
      if (!this.arranging && gen === this.arrangeGen) {
        if (JSON.stringify(defs) !== JSON.stringify(shared("workspaces.defs") ?? [])) setShared("workspaces.defs", defs);
        if (JSON.stringify(saved) !== JSON.stringify(shared("workspaces.order") ?? null)) setShared("workspaces.order", saved);
      }
      // The Scratch workspace is there from the first run (scratch.js); the folder watch reloads.
      if (this.scratch && !this.scratchChecked) {
        this.scratchChecked = true;
        try { await this.scratch.firstRun(); }
        catch (e) { notify({ title: "Couldn't make the Scratch workspace", body: String(e?.message ?? e), level: "error" }); }
      }
      // Only when it changes: writing it wakes watchFolder (and this) again.
      const index = `${dir()}/.index`, text = indexText(defs);
      try {
        const old = await readTextFile(index);
        if (old !== text) await writeTextFile(index, text, old);
      } catch {} // a stale snapshot: the next change writes it
      await this.loadPresets(defs);
      if (this.mine()) {
        await this.runner?.load(cx);
        await this.prs?.load();
        await this.gh?.load();
      }
      cx.notify();
    });
  }

  // This copy runs the automations and follows the pull requests itself.
  mine() { return this.bg.known && !this.bg.owner; }

  // Every 2s: who runs them, and, when it's the background runner, what it has for the window.
  background(cx) {
    if (this.bgBusy) return;
    this.bgBusy = true;
    cx.spawn(async (cx) => {
      try {
        const at = runnerDir(), b = this.bg, now = Date.now();
        const on = ((await readTextFile(`${at}/switch`)) ?? "").trim() === "on";
        let alive = null;
        try { alive = JSON.parse((await readTextFile(`${at}/alive`)) ?? "null"); } catch {}
        const running = Boolean(alive && now - alive.at < 30000);
        if (!on || running) { b.tries = 0; b.failed = false; }
        // On but not running (the computer restarted, or it stopped): start it. After
        // three tries, this copy runs them while Herdr is open, and says so once.
        if (on && !running && !b.failed && now - b.tried > 20000) {
          if (b.tries >= 3) {
            b.failed = true;
            notify({
              title: "The background runner didn't start", level: "warning",
              body: `${b.why || "It gave no reason."} Herdr runs your automations itself while it's open. herdr-ws-runner --status says more.`,
            });
          } else {
            b.tries++;
            b.tried = now;
            const r = await exec(`${appHome()}/mods/ws-switcher/bin/herdr-ws-runner`, ["--start"], { timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
            b.why = r.code === 0 ? null : String(r.stderr ?? "").trim().split("\n").pop();
          }
        }
        const owner = on && !b.failed;
        if (!b.known || owner !== b.owner) {
          b.known = true;
          b.owner = owner;
          b.rev = null;
          // Ours again (or for the first time): from what the file remembers.
          if (!owner) { this.runner = new Runner(this.hooks); this.prs = new PrWatcher(); this.gh = new GhWatcher(); this.reload(cx); }
        }
        if (owner && running && alive.rev !== b.rev) {
          let state = null;
          try { state = JSON.parse((await readTextFile(`${at}/state.json`)) ?? "null"); } catch {}
          if (state) {
            b.rev = alive.rev;
            for (const [key, value] of [["workspaces.automations", state.automations ?? {}], ["workspaces.automations.global", state.global ?? []], ["workspaces.automation.runs", state.runs ?? []], ["workspaces.prs", state.prs ?? {}], ["workspaces.github", state.github ?? {}]]) {
              if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? null)) setShared(key, value);
            }
          }
        }
        await this.notes();
        this.adopt();
        const say = { on, running };
        if (JSON.stringify(say) !== JSON.stringify(shared("workspaces.runner") ?? null)) setShared("workspaces.runner", say);
      } finally {
        this.bgBusy = false;
      }
      cx.notify();
    });
  }

  // The background runner's toasts: files it left, shown once. Many at once (Herdr
  // was closed) become one.
  async notes() {
    const at = `${runnerDir()}/notes`;
    let names = [];
    try { names = (await fs.readdir(at)).filter((n) => n.endsWith(".json")).sort(); } catch { return; }
    if (!names.length) return;
    const list = [];
    for (const n of names) {
      try { const note = JSON.parse((await readTextFile(`${at}/${n}`)) ?? "null"); if (note?.title) { delete note.at; list.push(note); } } catch {}
    }
    await exec("rm", ["-f", ...names.map((n) => `${at}/${n}`)]).catch(() => {});
    if (list.length <= 3) { for (const n of list) notify(n); return; }
    notify({
      title: `${list.length} updates from your automations`,
      body: `${list.slice(-6).map((n) => n.title).join("; ")}${list.length > 6 ? "; and earlier ones" : ""}.`,
      level: list.some((n) => n.level === "error" || n.level === "warning") ? "warning" : "info",
      action: { name: "mod.open", args: { name: "ws-automations" } },
    });
  }

  // "automation/<workspace>/<name>": a toast about one automation was clicked. Opens the
  // Automations screen for that workspace with the automation picked ("-": one for every
  // workspace, in the workspace on screen). The words come from a command's text, so they're
  // only looked up among what's loaded. One that's gone since: the screen for its workspace,
  // or as the footer opens it.
  openAutomation(c) {
    const [, ws, name] = c.split("/");
    const defs = (shared("workspaces.defs") ?? []).filter((d) => !d.error);
    const active = shared("workspaces.active") ?? null;
    const workspace = ws === "-" ? active ?? defs[0]?.id ?? null : defs.some((d) => d.id === ws) ? ws : null;
    const a = workspace ? ((shared("workspaces.automations") ?? {})[workspace] ?? []).find((x) => x.name === name && (ws !== "-" || x.scope === "global")) : null;
    openOverlay({
      mod: "ws-automations", kind: "dialog", width: 940, height: 680,
      props: a ? { workspace, pick: { scope: a.scope ?? "workspace", name: a.name } } : { workspace: workspace ?? active },
    });
  }

  // Runs the background runner started arrive as bare terminals with Herdr's labels:
  // their space joins the workspace and is called Automations, their tab is called
  // after the automation. Once each, so a name you change stays.
  adopt() {
    const runs = (shared("workspaces.automation.runs") ?? []).filter((r) => r.adopt && r.space && r.tab);
    if (!runs.length) return;
    const sp = spaces();
    let changed = false;
    // A space that's gone is forgotten: the runner makes it again under the same id
    // for a later run, and it's then claimed and named as the first time.
    if (sp.length) for (const k of [...this.adopted]) if (k.startsWith("s:") && !sp.some((x) => x.id === k.slice(2))) { this.adopted.delete(k); changed = true; }
    for (const r of runs) {
      const s = sp.find((x) => x.id === r.space);
      if (!s) continue;
      if (!this.adopted.has(`s:${s.id}`)) {
        this.adopted.add(`s:${s.id}`);
        changed = true;
        this.hooks.claim(s.id, r.ws);
        if (!s.named) run("space.rename", { id: s.id, name: "Automations" });
      }
      if (this.adopted.has(r.id)) continue;
      const tab = (s.tabs ?? []).find((t) => t.id === r.tab);
      if (!tab) continue;
      this.adopted.add(r.id);
      changed = true;
      if (tab.name !== r.name) run("tab.rename", { id: tab.id, name: r.name });
    }
    if (changed) { try { localStorage.setItem("adopted", JSON.stringify([...this.adopted].slice(-300))); } catch {} }
  }

  reloadPresets(cx) {
    cx.spawn(async (cx) => { await this.loadPresets(shared("workspaces.defs") ?? []); cx.notify(); });
  }

  // Publishes { global, workspaces: { id: [...] } } and whether the launcher is installed.
  async loadPresets(defs) {
    const presets = { global: await loadPresetDir(templatesDir(), "global"), workspaces: {} };
    for (const d of defs) presets.workspaces[d.id] = await loadPresetDir(`${d.dir}/agents`, "workspace");
    if (JSON.stringify(presets) !== JSON.stringify(shared("workspaces.presets") ?? null)) setShared("workspaces.presets", presets);
    let launcher = false;
    try { launcher = (await exec("sh", ["-c", "command -v herdr-ws-agent"])).code === 0; } catch {}
    if (launcher !== shared("workspaces.launcher")) setShared("workspaces.launcher", launcher);
  }

  // Places new spaces, follows the shown space into its workspace, remembers it.
  sync() {
    const defs = shared("workspaces.defs") ?? [];
    let active = shared("workspaces.active") ?? null;
    if (this.loaded && active && !defs.some((d) => d.id === active)) {
      active = null;
      setShared("workspaces.active", null);
    }
    const sp = spaces(), ps = panes(), now = Date.now();
    const assigned = { ...(shared("workspaces.assigned") ?? {}) };
    let changed = false;
    // A workspace that's gone (deleted here or by hand): its spaces are decided again.
    if (this.loaded) {
      for (const [id, ws] of Object.entries(assigned)) {
        if (ws !== false && !defs.some((d) => d.id === ws)) { delete assigned[id]; this.known.add(id); changed = true; }
      }
    }
    for (const s of sp) {
      if (s.id in assigned) { this.known.add(s.id); continue; }
      // A scratch space joins Scratch at once; it waits while that workspace is being made.
      if (!s.machine && isScratch(s.folder || placeOf(s, ps), home())) {
        const sd = scratchDef(defs);
        if (sd) { assigned[s.id] = sd.id; changed = true; this.known.add(s.id); }
        continue;
      }
      const fresh = !this.known.has(s.id);
      if (fresh && now - (this.born[s.id] ??= now) < SETTLE) continue;
      const hit = s.machine ? null : match(placeOf(s, ps), defs);
      if (hit) { assigned[s.id] = hit; changed = true; }
      else if (fresh && active) { assigned[s.id] = active; changed = true; }
      this.known.add(s.id);
    }
    // Spaces that are gone, once every machine's spaces are known.
    if (machines().every((m) => m.layout === "ready")) {
      const live = new Set(sp.map((s) => s.id));
      for (const id of Object.keys(assigned)) if (!live.has(id)) { delete assigned[id]; changed = true; }
    }
    if (changed) setShared("workspaces.assigned", assigned);

    // A key, a toast or space.next showed a space elsewhere: go with it. Not while
    // an automation's tab is being made: that shows it for a moment.
    const order = this.order ?? [];
    this.order = sp.map((s) => s.id);
    if (this.runner?.holding()) return;
    const shown = sp.find((s) => s.active)?.id ?? null;
    // The shown space was closed and Herdr showed its next one, from another
    // workspace: stay, on the closed one's neighbour here (none left: the
    // workspace's empty list, with whatever Herdr shows beside it).
    const closed = this.shown && !sp.some((s) => s.id === this.shown) ? this.shown : null;
    if (closed && active && shown && assigned[shown] !== active) {
      this.shown = shown;
      const live = new Set(sp.filter((s) => assigned[s.id] === active).map((s) => s.id));
      const at = order.indexOf(closed);
      const next = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0)).reverse()].find((id) => live.has(id))
        ?? [...live][0];
      if (next) { run("space.select", { id: next }); return; }
    }
    const ownerOf = (id) => (defs.some((d) => d.id === assigned[id]) ? assigned[id] : null);
    // A tab made and shown in the covered space (Cmd-T while the empty block shows): go with it.
    const tabNow = sp.find((s) => s.id === shown)?.tabs?.find((c) => c.active)?.id ?? null;
    const madeTab = Boolean(this.cover?.tabs) && shown === this.shown && tabNow && !this.cover.tabs.has(tabNow);
    if (shown && (shown !== this.shown || madeTab) && this.known.has(shown)) {
      this.shown = shown;
      const owner = ownerOf(shown);
      if (owner !== active) { active = owner; setShared("workspaces.active", active); }
    }
    if (active && shown && assigned[shown] === active) {
      const last = shared("workspaces.last") ?? {};
      if (last[active] !== shown) setShared("workspaces.last", { ...last, [active]: shown });
    }
    // Herdr always shows a space. While the shown workspace has none of its own here
    // (its last one closed, or it was chosen empty), the empty block covers the other one's.
    const covered = this.loaded && Boolean(active) && (!shown || (this.known.has(shown) && ownerOf(shown) !== active));
    this.coverWork(covered, sp.find((s) => s.id === shown), this.screen(active, `${shown}/${tabNow}`, now));
  }

  // The screen to show in place of the tabs, or null. It goes back to the tabs when
  // its workspace isn't the shown one, when it's closed there, and when the shown
  // space or tab changes (a click, a key, a new tab): whoever asked wants to see that.
  screen(active, view, now) {
    const scr = shared("workspaces.screen") ?? null;
    if (!scr) { this.screenKey = null; return null; }
    if (!this.loaded) return SCREENS[scr.screen] ? scr.screen : null;
    const open = (shared("workspaces.screens") ?? {})[scr.ws] ?? [];
    const key = `${scr.ws}/${scr.screen}/${scr.at}`;
    // Just shown (or Herdr just started): where the view is now is where it stays.
    if (this.screenKey !== key || now - (scr.at ?? 0) < 800) { this.screenKey = key; this.screenView = view; }
    if (!SCREENS[scr.screen] || scr.ws !== active || !open.includes(scr.screen) || view !== this.screenView) {
      setShared("workspaces.screen", null);
      this.screenKey = null;
      return null;
    }
    return scr.screen;
  }

  // Shows the layout's empty block in place of the work column (tabs, terminals, status),
  // or the work column again; `screen`, one of the workspace's screens, goes over either.
  // An older copy of the layout, with no `center` stack, is left alone.
  coverWork(on, space, screen = null) {
    const center = find(layout(), "center");
    if (!center?.children?.some((c) => c.id === "empty")) return;
    if (on && !this.cover) this.cover = { tabs: new Set((space?.tabs ?? []).map((c) => c.id)) };
    if (!on) this.cover = null;
    if (Boolean(shared("workspaces.covered")) !== on) setShared("workspaces.covered", on);
    const body = screen ? find(center, "screens-body") : null;
    if (screen && !body?.children?.some((c) => c.id === `screen-${screen}`)) screen = null;
    if (screen && body.active !== `screen-${screen}`) run("layout.select", { stack: "screens-body", child: `screen-${screen}` });
    const want = screen ? "screens" : on ? "empty" : "work";
    if (center.active === want) return;
    run("layout.select", { stack: "center", child: want });
    // Back from a screen, which had taken the keyboard: to the pane that had it before.
    const pane = center.active === "screens" && want === "work" ? focused()?.pane : null;
    if (pane) run("pane.focus", { pane });
  }

  // The empty block: the shown workspace has no spaces. A quiet line, and New space
  // as the Spaces + does it (Scratch: the dialog that names a new scratch space).
  empty(t) {
    const ws = (shared("workspaces.defs") ?? []).find((d) => d.id === shared("workspaces.active")) ?? null;
    const make = () => {
      if (ws?.scratch) askScratch();
      else run("space.new", ws?.root ? { folder: ws.root } : {});
    };
    return v_flex().size_full().items_center().justify_center().gap(10).text_size(12.8).text_color(t.dim)
      .when(Boolean(ws), (el) => el.child(div().child(`No spaces in ${ws.name}`))
        .child(div().id("empty-new").px(10).py(5).rounded(7).cursor_pointer().text_color(t.muted)
          .border(1).border_color(t.border).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(make).child(ws?.scratch ? "New scratch space…" : "New space")));
  }

  async create() {
    const root = await pickFolder({ prompt: "Use as workspace" });
    if (!root) return;
    const defs = shared("workspaces.defs") ?? [];
    const slug = base(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
    let id = slug;
    for (let n = 2; defs.some((d) => d.id === id) || (await fs.exists(`${dir()}/${id}`)); n++) id = `${slug}-${n}`;
    const used = new Set(defs.map((d) => d.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[defs.length % PALETTE.length];
    await writeTextFile(`${dir()}/${id}/workspace.jsonc`, configText(base(root), color, tilde(root), await subdirs(root)), null);
    await writeTextFile(`${dir()}/${id}/AGENTS.md`, instructionsText(base(root)), null);
    setShared("workspaces.defs", await loadDefs());
    choose(id);
  }

  // The New space dialog (holding or right-clicking the Spaces +): a name and a folder.
  // Its Scratch form (props.scratch, or Scratch's id) has only the name, and is what
  // every New scratch space opens (askScratch()).
  initNewSpace(cx) {
    const ws = (shared("workspaces.defs") ?? []).find((d) => d.id === props().id) ?? null;
    const scratch = Boolean(props().scratch || ws?.scratch);
    const shown = spaces().find((s) => s.active);
    const start = ws?.root || (shown ? placeOf(shown, panes()) : "") || home();
    const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    this.nameIn = InputState.new({ value: "", placeholder: scratch ? `Scratch ${hhmm}` : "Called after its folder" });
    this.folderIn = InputState.new({ value: scratch ? "" : tilde(start) });
    for (const input of [this.nameIn, this.folderIn]) {
      input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      input.on("submit", (_e, cx) => this.newSpace(cx));
    }
    this.nameIn.focus();
    cx.timer.after(600, () => this.nameIn.focus());
  }

  // Its Create: a space with that name in that folder (Scratch: a new scratch folder).
  newSpace(cx) {
    const p = props();
    const ws = (shared("workspaces.defs") ?? []).find((d) => d.id === p.id) ?? null;
    const name = this.nameIn.value().trim();
    if (this.busy) return;
    if (p.scratch || ws?.scratch) {
      setShared("workspaces.scratch", { at: Date.now(), ...(name ? { name } : {}) });
      closeOverlay(p.overlay);
      return;
    }
    const folder = expand(this.folderIn.value().trim()).replace(/\/+$/, "") || "/";
    if (!folder.startsWith("/")) { this.error = "Give a full path, or one starting with ~/."; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await exec("test", ["-d", folder]).catch(() => ({ code: 1 }));
      this.busy = false;
      if (r.code !== 0) { this.error = `There's no folder at ${tilde(folder)}.`; cx.notify(); return; }
      run("space.new", { folder, ...(name ? { name } : {}) });
      closeOverlay(p.overlay);
    });
  }

  // The rename dialog's Save: writes the new name into workspace.jsonc, then closes.
  rename(cx) {
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === props().id);
    const name = this.text.trim();
    if (!d || this.busy) return;
    if (!name) { this.error = "A workspace needs a name."; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const file = `${d.dir}/workspace.jsonc`;
        const old = await readTextFile(file);
        if (old === null) throw new Error("its workspace.jsonc is gone");
        await writeTextFile(file, withName(old, name), old);
        // Shown at once; the folder watch confirms it.
        setShared("workspaces.defs", (shared("workspaces.defs") ?? []).map((x) => (x.id === d.id ? { ...x, name } : x)));
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = `Couldn't rename it: ${e?.message ?? e}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  // The delete dialog's confirm: the folder to the Trash, its spaces decided again.
  // Scratch takes its scratch folders along (they're throwaway) and closes its spaces first.
  remove(cx) {
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === props().id);
    if (!d || this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        if (d.scratch) {
          const assignedNow = shared("workspaces.assigned") ?? {};
          for (const s of spaces()) if (assignedNow[s.id] === d.id) run("space.close", { id: s.id, confirmed: true });
          const root = d.root;
          if (root && root.endsWith("/.herdr/scratch") && (await fs.exists(root))) {
            const t = await exec("sh", ["-c", TRASH, "sh", root, `${dir()}/.trash`, `scratch-folders-${stamp}`]);
            if (t.code !== 0) throw new Error(t.stderr.trim() || `exit ${t.code}`);
          }
        }
        const r = await exec("sh", ["-c", TRASH, "sh", d.dir, `${dir()}/.trash`, `${d.id}-${stamp}`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        const where = r.stdout.trim();
        // Gone from the list now, so its spaces join where their folder is, not it again.
        setShared("workspaces.defs", (shared("workspaces.defs") ?? []).filter((x) => x.id !== d.id));
        const assigned = { ...(shared("workspaces.assigned") ?? {}) };
        for (const [id, ws] of Object.entries(assigned)) if (ws === d.id) delete assigned[id];
        setShared("workspaces.assigned", assigned);
        const last = { ...(shared("workspaces.last") ?? {}) };
        delete last[d.id];
        setShared("workspaces.last", last);
        if (shared("workspaces.active") === d.id) setShared("workspaces.active", null);
        notify({ title: `Deleted ${d.name}`, body: d.scratch
          ? (where === "Trash" ? "It and its scratch folders are in the Trash. It comes back, empty, with the next scratch space." : `It and its scratch folders are in ${tilde(`${dir()}/.trash`)}.`)
          : where === "Trash" ? "Its folder is in the Trash." : `Its folder is in ${tilde(where)}.`, level: "success" });
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = `Couldn't delete it: ${e?.message ?? e}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  newSpaceDialog(t, ws, { frame, title, button, error, close }) {
    const defs = shared("workspaces.defs") ?? [];
    const field = (label, input) => [div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child(label),
      Input.new(input).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground)];
    const scratch = Boolean(props().scratch || ws?.scratch);
    const el = frame("ws-new-space", (cx) => this.newSpace(cx)).child(title(scratch ? "New scratch space" : ws ? `New space in ${ws.name}` : "New space"));
    el.children(field("Name", this.nameIn));
    if (scratch) {
      return el.child(div().pt(10).text_size(11.5).text_color(t.dim).child("Its new folder in ~/.herdr/scratch carries the name, and is tidied away when you're done unless you keep it. Blank name: Scratch and the time."))
        .when(Boolean(this.error), (e) => e.child(error()))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ws-new-cancel", "Cancel", false, close))
          .child(button("ws-new-create", "Create", true, (_e, cx) => this.newSpace(cx))));
    }
    const folder = expand(this.folderIn.value().trim()).replace(/\/+$/, "");
    const hit = folder.startsWith("/") ? (isScratch(folder, home()) ? scratchDef(defs)?.id : match(folder, defs)) : null;
    const owner = defs.find((d) => d.id === hit) ?? null;
    const joins = owner && owner.id !== ws?.id ? `Joins ${owner.name}: its folder is there.` : ws ? `Joins ${ws.name}.` : owner ? `Joins ${owner.name}.` : "Shows under All spaces.";
    const picks = ws ? [ws.root, ...ws.folders].filter(Boolean).slice(0, 6) : [];
    const chip = (id, label, tip, action) => div().id(id).h(24).px(8).flex().items_center().rounded(6).border_1().border_color(t.input)
      .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(label);
    const setFolder = (path, cx) => { this.folderIn.set_value(tilde(path)); this.error = null; cx.notify(); };
    return el.children(field("Folder", this.folderIn))
      .child(h_flex().pt(8).gap(6).flex_wrap()
        .children(picks.map((f, i) => chip(`ws-new-pick-${i}`, f === ws.root ? `${base(f)} (root)` : base(f), tilde(f), (_e, cx) => setFolder(f, cx))))
        .child(chip("ws-new-choose", "Choose…", "Pick a folder", (_e, cx) => cx.spawn(async (cx) => {
          const picked = await pickFolder({ prompt: "Use for the space" });
          if (picked) setFolder(picked, cx);
        }))))
      .child(div().pt(10).text_size(11.5).text_color(t.dim).child(`${joins} Blank name: called after its folder.`))
      .when(Boolean(this.error), (e) => e.child(error()))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ws-new-cancel", "Cancel", false, close))
        .child(button("ws-new-create", "Create", true, (_e, cx) => this.newSpace(cx))));
  }

  dialog(t) {
    const p = props();
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === p.id);
    const close = () => closeOverlay(p.overlay);
    const button = (id, label, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(this.busy, (el) => el.opacity(0.5)).hover((s) => s.opacity(0.88)).on_click(action).child(label);
    const title = (text) => h_flex().items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(text))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
    const error = () => div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error ?? "");
    const frame = (id, enter) => v_flex().id(id).track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") close();
        else if (e.key === "enter" && enter) enter(cx);
        else return;
        cx.stop_propagation();
      });
    if (p.dialog === "new-space") return this.newSpaceDialog(t, d ?? null, { frame, title, button, error, close });
    if (!d) return frame("ws-gone", null).child(title("Workspace")).child(div().pt(12).text_color(t.muted).child("This workspace is gone."));

    if (p.dialog === "rename") {
      return frame("ws-rename", null)
        .child(title("Rename workspace"))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
        .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Changes "name" in ${tilde(d.dir)}/workspace.jsonc.`))
        .when(Boolean(this.error), (el) => el.child(error()))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ws-rename-cancel", "Cancel", false, close))
          .child(button("ws-rename-save", "Save", true, (_e, cx) => this.rename(cx))));
    }

    return frame("ws-delete", (cx) => this.remove(cx))
      .child(title(`Delete “${d.name}”?`))
      .child(div().pt(12).text_color(t.muted).child(
        d.scratch ? scratchDeleteText(d) :
        `Moves ${tilde(d.dir)} (its workspace.jsonc and AGENTS.md) to the Trash. Your repos and folders aren't touched, and its spaces stay open: they join the workspace their folder is in, else show under All spaces.`))
      .when(Boolean(this.error), (el) => el.child(error()))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ws-delete-cancel", "Cancel", false, close))
        .child(button("ws-delete-yes", this.busy ? "Deleting…" : "Move to Trash", true, (_e, cx) => this.remove(cx))));
  }

  render(cx) {
    const t = theme();
    if (props()?.empty) return this.empty(t);
    if (props()?.popup) return this.menu(t);
    if (props()?.dialog) return this.dialog(t);
    this.sync();
    this.requests(cx);
    const defs = shared("workspaces.defs") ?? [];
    const active = defs.find((d) => d.id === shared("workspaces.active")) ?? null;
    const assigned = shared("workspaces.assigned") ?? {};
    const sp = spaces();
    const count = active ? sp.filter((s) => assigned[s.id] === active.id).length : sp.length;
    // An agent needs you in a workspace that isn't shown.
    const elsewhere = active ? urgent(sp.filter((s) => assigned[s.id] !== active.id)) : null;
    const dot = (id) => div().id(id).size(6).flex_none().rounded_full().bg(t[elsewhere])
      .tooltip(elsewhere === "blocked" ? "An agent needs you in another workspace" : "An agent finished in another workspace");
    const open = () => openOverlay({ mod: "ws-switcher", kind: "popup", width: 288, height: 600, props: { popup: true } });
    if (narrow()) {
      return h_flex().size_full().bg(t.chrome).items_center().justify_center()
        .child(h_flex().id("ws-rail").relative().size(32).rounded(6).items_center().justify_center().cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(active?.name ?? "All spaces").on_click(open)
          .child(mark(active, defs, t, 20))
          .when(Boolean(elsewhere), (el) => el.child(dot("ws-rail-dot").absolute().top(2).right(2))));
    }
    return h_flex().size_full().bg(t.chrome).px(8).items_center().text_size(13)
      .child(h_flex().id("ws-current").flex_1().min_w(0).h(34).px(8).gap(9).rounded(8).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(open)
        .child(mark(active, defs, t, 20))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(active?.name ?? "All spaces"))
        .when(Boolean(elsewhere), (el) => el.child(dot("ws-dot")))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(count)))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).flex_none().text_color(t.dim)))
      .when(Boolean(active), (el) => el.child(div().id("ws-board").size(28).ml(2).flex_none().flex().items_center().justify_center()
        .rounded(7).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`${active.name} board`).on_click((_e, cx) => this.openScreen(active.id, "board", cx))
        .child(svg("mods/ws-board/board.svg").size(15))));
  }

  // What the menu and dialogs ask this sidebar copy to do (their own tasks end when
  // they close). From render and the 500ms timer: Herdr doesn't draw while in the
  // background. A start asked for more than 15s ago is dropped, never run late.
  requests(cx) {
    const ask = shared("workspaces.create") ?? null;
    if (ask !== this.asked) {
      this.asked = ask;
      if (ask) cx.spawn(async (cx) => {
        try { await this.create(); }
        catch (e) { notify({ title: "Couldn't make the workspace", body: String(e?.message ?? e), level: "error" }); }
        cx.notify();
      });
    }
    const scratchAsk = shared("workspaces.scratch") ?? null;
    if (scratchAsk?.at !== this.scratchAsked) {
      this.scratchAsked = scratchAsk?.at;
      if (scratchAsk && Date.now() - scratchAsk.at < 15000) {
        cx.spawn(async () => {
          try { await this.scratch.create(scratchAsk.name ?? ""); }
          catch (e) { notify({ title: "Couldn't make a scratch space", body: String(e?.message ?? e), level: "error" }); }
        });
      }
    }
    const launchAsk = shared("workspaces.launch") ?? null;
    if (launchAsk?.at !== this.launchAsked) {
      this.launchAsked = launchAsk?.at;
      const preset = launchAsk && Date.now() - launchAsk.at < 15000 && presetsFor(launchAsk.workspace).find((x) => x.name === launchAsk.name);
      if (preset) startPreset(preset, (shared("workspaces.defs") ?? []).find((d) => d.id === launchAsk.workspace), launchAsk.task ?? "");
    }
    const runAsk = shared("workspaces.automation.run") ?? null;
    if (runAsk?.at !== this.runAsked) {
      this.runAsked = runAsk?.at;
      const recent = runAsk && Date.now() - runAsk.at < 15000;
      const a = recent && this.mine() && this.runner?.find(runAsk.workspace, runAsk.name);
      if (a) this.runner.fire(cx, runAsk.workspace, a, "Started by hand", {}, { manual: true });
      else if (recent && this.bg.owner) this.pass(cx, "run", `${runAsk.workspace}\n${runAsk.name}\n${Date.now()} hand\n`);
    }
    // An allowed check: this copy's runner reads the request itself; the background one gets a file.
    const allowAsk = shared("workspaces.automation.allow") ?? null;
    if (allowAsk?.at !== this.allowAsked) {
      this.allowAsked = allowAsk?.at;
      if (allowAsk && Date.now() - allowAsk.at < 15000 && this.bg.owner) this.pass(cx, "allow", JSON.stringify({ workspace: allowAsk.workspace, name: allowAsk.name, check: allowAsk.check }));
    }
    const setAsk = shared("workspaces.runner.set") ?? null;
    if (setAsk?.at !== this.setAsked) {
      this.setAsked = setAsk?.at;
      if (setAsk && Date.now() - setAsk.at < 15000) cx.spawn(async (cx) => {
        const r = await exec(`${appHome()}/mods/ws-switcher/bin/herdr-ws-runner`, [setAsk.on ? "--on" : "--off"], { timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
        if (r.code !== 0) notify({ title: `Couldn't turn the background runner ${setAsk.on ? "on" : "off"}`, body: String(r.stderr ?? "").trim().split("\n").pop() || "herdr-ws-runner gave no reason.", level: "error" });
        this.bg.tries = 0; this.bg.tried = 0; this.bg.failed = false;
        this.background(cx);
      });
    }
    const arrangeAsk = shared("workspaces.arrange") ?? null;
    if (arrangeAsk?.at !== this.arrangeAsked) {
      this.arrangeAsked = arrangeAsk?.at;
      if (arrangeAsk && Date.now() - arrangeAsk.at < 15000) this.applyArrange(arrangeAsk, cx);
    }
    const boardAsk = shared("workspaces.board") ?? null;
    if (boardAsk?.at !== this.boardAsked) {
      this.boardAsked = boardAsk?.at;
      if (boardAsk && Date.now() - boardAsk.at < 15000) this.openScreen(boardAsk.id, "board", cx);
    }
    const treesAsk = shared("workspaces.worktrees") ?? null;
    if (treesAsk?.at !== this.treesAsked) {
      this.treesAsked = treesAsk?.at;
      if (treesAsk && Date.now() - treesAsk.at < 15000) this.openScreen(treesAsk.id, "worktrees", cx);
    }
    const historyAsk = shared("workspaces.history") ?? null;
    if (historyAsk?.at !== this.historyAsked) {
      this.historyAsked = historyAsk?.at;
      if (historyAsk && Date.now() - historyAsk.at < 15000) this.openHistory(historyAsk.id ?? null, cx);
    }
    this.takeTabs();
  }

  // The menu's drag, fold or group change: shown at once, then written to .order.json
  // and each changed workspace.jsonc. The folder watch reads them back afterwards.
  applyArrange(ask, cx) {
    const saved = { order: [], folded: [], ...(shared("workspaces.order") ?? {}) };
    if (ask.order) saved.order = ask.order;
    if (ask.folded) saved.folded = ask.folded;
    const groups = ask.groups ?? {};
    const was = shared("workspaces.defs") ?? [];
    const defs = was.map((d) => (d.id in groups ? { ...d, group: groups[d.id] } : d));
    setShared("workspaces.order", saved);
    setShared("workspaces.defs", arrange(defs, saved).flatMap((it) => (it.group ? it.members : [it.ws])));
    this.arranging = (this.arranging ?? 0) + 1;
    this.arrangeGen = (this.arrangeGen ?? 0) + 1;
    cx.spawn(async (cx) => {
      try {
        for (const [id, group] of Object.entries(groups)) {
          const d = was.find((x) => x.id === id);
          if (!d || d.error) continue;
          const file = `${d.dir}/workspace.jsonc`;
          const old = await readTextFile(file);
          if (old === null) continue;
          const text = withGroup(old, group);
          if (text !== old) await writeTextFile(file, text, old);
        }
        const old = await readTextFile(orderFile());
        const text = orderText(saved);
        if (old !== text) await writeTextFile(orderFile(), text, old);
      } catch (e) {
        notify({ title: "Couldn't save the workspaces' order", body: String(e?.message ?? e), level: "error" });
      }
      this.arranging--;
      this.arrangeGen++;
      this.reload(cx);
    });
  }

  // A Board or Worktrees tab from before they were the workspace's own (or made by
  // hand): it becomes the workspace's screen and the tab closes. Only a tab that
  // holds nothing else, in a space that has other tabs.
  takeTabs() {
    if (!this.loaded || !find(layout(), "screens-body")) return;
    const assigned = shared("workspaces.assigned") ?? {}, defs = shared("workspaces.defs") ?? [];
    const ps = panes();
    this.taken ??= new Set();
    for (const p of ps) {
      const key = Object.keys(SCREENS).find((k) => SCREENS[k].mod === p.mod);
      if (!key || p.terminal || this.taken.has(p.pane)) continue;
      const space = spaces().find((s) => (s.tabs ?? []).some((c) => c.id === p.tab));
      const ws = space && !space.machine ? assigned[space.id] : null;
      if (!ws || !defs.some((d) => d.id === ws) || space.tabs.length < 2 || ps.filter((x) => x.tab === p.tab).length !== 1) continue;
      this.taken.add(p.pane);
      const front = space.active && space.tabs.find((c) => c.id === p.tab)?.active && shared("workspaces.active") === ws;
      this.pin(ws, key);
      run("tab.close", { id: p.tab, confirmed: true });
      if (front) setShared("workspaces.screen", { ws, screen: key, at: Date.now() });
    }
  }

  // The key's way in: the shown workspace's screen, and back to the tabs from it.
  toggleScreen(key, cx) {
    const ws = shared("workspaces.active") ?? null, scr = shared("workspaces.screen") ?? null;
    if (!ws) { if (key === "history") this.openHistory(null, cx); return; }
    if (scr?.ws === ws && scr.screen === key) setShared("workspaces.screen", null);
    else this.openScreen(ws, key, cx);
  }

  // History is the one screen that also works with no workspace chosen (All spaces):
  // the pills belong to a workspace, so there it's a dialog over everything.
  openHistory(id, cx) {
    if (id && (shared("workspaces.defs") ?? []).some((d) => d.id === id)) return this.openScreen(id, "history", cx);
    openOverlay({ mod: "ws-history", kind: "dialog", width: 980, height: 700, props: { dialog: true } });
  }

  pin(ws, key) {
    const all = shared("workspaces.screens") ?? {};
    if (!(all[ws] ?? []).includes(key)) setShared("workspaces.screens", { ...all, [ws]: [...(all[ws] ?? []), key] });
  }

  // Shows one of a workspace's screens (its board, its worktrees) in place of the
  // tabs, and pins it in the tab bar of every space of the workspace. With an older
  // copy of the layout, which has no place for screens, it's a tab in one space.
  openScreen(id, key, cx) {
    if (!find(layout(), "screens-body")?.children?.some((c) => c.id === `screen-${key}`)) return this.openBoard(id, cx, SCREENS[key]);
    if (!(shared("workspaces.defs") ?? []).some((d) => d.id === id)) return;
    this.pin(id, key);
    if (shared("workspaces.active") !== id) choose(id);
    setShared("workspaces.screen", { ws: id, screen: key, at: Date.now() });
  }

  // A request for the background runner: a file in the inbox it reads.
  pass(cx, kind, text) {
    cx.spawn(async () => {
      try { await writeTextFile(`${dir()}/.inbox/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${kind}`, text, null); }
      catch (e) { notify({ title: "Couldn't reach the background runner", body: String(e?.message ?? e), level: "error" }); }
    });
  }

  // The older way, for a layout without the `screens` column: the workspace's board
  // tab, the one already open in one of its spaces, else a new one in the shown space
  // (if it's in the workspace), its first space, or a new space in its root.
  // `screen`: another tab of the workspace's, the same way.
  openBoard(id, cx, screen = { mod: "ws-board", name: "Board" }) {
    const def = (shared("workspaces.defs") ?? []).find((d) => d.id === id);
    if (!def) return;
    const assigned = shared("workspaces.assigned") ?? {};
    const sp = spaces();
    const spaceOfTab = (tab) => sp.find((s) => (s.tabs ?? []).some((c) => c.id === tab));
    const open = panes().find((p) => p.mod === screen.mod && assigned[spaceOfTab(p.tab)?.id] === id);
    if (open) {
      run("space.select", { id: spaceOfTab(open.tab).id });
      run("tab.select", { id: open.tab });
      return;
    }
    cx.spawn(async (cx) => {
      try {
        const mine = sp.filter((s) => assigned[s.id] === id);
        let space = (mine.find((s) => s.active) ?? mine[0])?.id;
        if (!space) {
          const r = await exec("herdr-app", ["do", "space.new", JSON.stringify({ folder: def.root })]);
          space = JSON.parse(r.stdout).space;
          if (!space) throw new Error(r.stderr.trim() || "couldn't make a space");
        }
        run("space.select", { id: space });
        run("tab.new", { space, name: screen.name, mod: screen.mod, props: { workspace: id } });
      } catch (e) {
        notify({ title: `Couldn't open the ${def.name} ${screen.name.toLowerCase()}`, body: String(e?.message ?? e), level: "error" });
      }
      cx.notify();
    });
  }

  menu(t) {
    const defs = shared("workspaces.defs") ?? [];
    const active = defs.find((d) => d.id === shared("workspaces.active")) ?? null;
    const assigned = shared("workspaces.assigned") ?? {};
    const sp = spaces(), ps = panes();
    const shown = sp.find((s) => s.active) ?? null;
    let height = 10; // the menu's padding; each part adds its own
    const icon = (name) => svg(`mods/workspace-chrome/${name}.svg`).size(14).flex_none().text_color(t.muted);
    const hint = (...kids) => h_flex().flex_none().gap(8).items_center().text_size(11).text_color(t.dim).children(kids);
    const check = (on) => (on ? svg("mods/workspace-chrome/check.svg").size(13).text_color(t.accent) : div().w(13));
    const head = (text) => { height += 26; return div().h(26).px(8).pt(9).flex_none().text_size(11).text_color(t.dim).child(text); };
    const line = () => { height += 9; return div().h(1).mx(4).my(4).flex_none().bg(t.border); };
    const row = (id, lead, label, tail, action, { dim = false, tip = null, keep = false, danger = false } = {}) => {
      height += 30;
      return h_flex().id(id).h(30).px(8).gap(9).rounded(7).items_center().flex_none().cursor_pointer()
        .text_color(danger ? t.blocked : dim ? t.dim : t.foreground).hover((s) => s.bg(t.selected))
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .on_click((_e, cx) => { if (!keep) closeOverlay(props().overlay); action(cx); })
        .child(lead).child(div().flex_1().min_w(0).truncate().child(label)).child(tail);
    };
    const frame = (items) => v_flex().id("ws-menu").track_focus(this.handle).on_key_down((e) => this.key(e, defs))
      .w_full().h(Math.min(600, height)).p(5).bg(t.popover).text_size(12.8).overflow_y_scrollbar()
      .on_mouse_up("left", (_e, cx) => { if (this.dragFrom) { this.dragFrom = this.dragOver = null; cx.notify(); } })
      .children(items);

    // "Move to…": where the shown space goes. Its new workspace is then shown.
    if (this.moving && shown) {
      const owner = assigned[shown.id];
      const move = (to) => {
        setShared("workspaces.assigned", { ...(shared("workspaces.assigned") ?? {}), [shown.id]: to });
        setShared("workspaces.active", to || null);
      };
      return frame([head(`Move “${shown.name}” to`),
        ...defs.map((d) => row(`ws-to-def-${d.id}`, mark(d, defs, t, 18), d.name, hint(check(owner === d.id)), () => move(d.id))),
        line(),
        row("ws-to-none", mark(null, defs, t, 18), "No workspace", hint(check(!owner)), () => move(false),
          { tip: "Shows only under All spaces, and doesn't join a workspace by its folder" })]);
    }

    // A workspace's group (its right-click, or "Put … in a group…"): the groups there
    // are, none, or a new one typed in the box. A group's header, right-clicked: its
    // new name in the box, or Ungroup.
    const tree = arrange(defs, shared("workspaces.order") ?? {});
    const groupNames = tree.filter((it) => it.group).map((it) => it.group);
    const box = (input, note) => {
      height += note ? 62 : 44;
      return v_flex().px(4).pt(6).pb(4).gap(5).flex_none()
        .child(Input.new(input).h(32).px(9).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
        .when(Boolean(note), (el) => el.child(div().px(4).text_size(11).text_color(t.dim).child(note)));
    };
    const picking = this.grouping ? defs.find((d) => d.id === this.grouping && !d.scratch && !d.error) : null;
    if (picking) {
      const now = groupOf(picking);
      return frame([head(`Group for “${picking.name}”`),
        ...groupNames.map((n) => row(`ws-grp-${n}`, icon("layers"), n, hint(check(now === n)), () => this.setGroup(picking.id, n))),
        row("ws-grp-none", div().w(14).flex_none(), "No group", hint(check(!now)), () => this.setGroup(picking.id, null)),
        line(),
        box(this.newGroupIn, null)]);
    }
    const editing = this.renaming ? tree.find((it) => it.group === this.renaming) : null;
    if (editing) {
      const n = editing.members.length;
      return frame([head(`The “${editing.group}” group`),
        box(this.renameIn, "Enter renames it."),
        line(),
        row("ws-grp-ungroup", icon("layers"), "Ungroup", hint(`${n} ${n === 1 ? "workspace" : "workspaces"}`), () => this.ungroup(editing),
          { tip: "Its workspaces stay where they are in the list, without a group" })]);
    }

    // Making a workspace comes first, above the list it adds to.
    // A space in a new empty folder in the Scratch workspace (scratch.js): its dialog asks for
    // the name, and the sidebar copy makes it.
    const scratchRow = row("ws-scratch", svg("mods/ws-switcher/scratch.svg").size(14).flex_none().text_color(t.muted), "New scratch space…", div(),
      () => askScratch(),
      { tip: "Name an idea that belongs to no project, and it gets a space in a new empty folder in the Scratch workspace. Deleted when you close it empty; with files, kept 7 days unless you keep it." });
    const items = [row("ws-new", icon("folder-plus"), "New workspace from a folder…", div(), () => setShared("workspaces.create", Date.now())),
      scratchRow,
      line(), head("Workspaces"),
      row("ws-all", mark(null, defs, t, 18), "All spaces", hint(String(sp.length), check(!active)), () => choose(null))];
    // The workspaces as arrange.js has them: each group under a header that folds (a
    // folded one still shows the workspace you're in), Scratch last. A row can be dragged:
    // a workspace dropped on a workspace goes above or below it, in its group; on a
    // header's lower part it goes into that group; a header moves its whole group.
    // Right-click a workspace for its group, a header to rename or ungroup it.
    const rows = this.rowsOf(tree, active);
    const drop = this.dropAt(rows);
    // Pressed, then let go on the same row: a click. On another: a drop there.
    const moving = (r) => this.dragOver && this.dragOver !== this.dragFrom && (this.dragFrom === r.key || (r.group && this.dragFrom === `g:${r.group}`));
    const drag = (el, r, click, menu) => el.relative()
      .when(moving(r), (el) => el.opacity(0.5))
      .when(drop?.key === r.key, (el) => el.child(drop.edge === "into"
        ? div().absolute().top(0).bottom(0).left(0).right(0).rounded(7).border_1().border_color(t.accent)
        : div().absolute().left(6).right(6).h(2).rounded_full().bg(t.accent).when(drop.edge === "top", (l) => l.top(-1)).when(drop.edge === "bottom", (l) => l.bottom(-1))))
      .on_mouse_down("left", () => { this.dragFrom = r.key; this.dragOver = r.key; this.dragY = 0.5; })
      .on_mouse_move((e, cx) => {
        if (!this.dragFrom) return;
        const y = e.bounds?.height ? e.local_position.y / e.bounds.height : 0.5;
        if (this.dragOver !== r.key || Math.abs(y - this.dragY) > 0.05) { this.dragOver = r.key; this.dragY = y; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.dragFrom;
        if (from === r.key) { this.dragFrom = this.dragOver = null; click(cx); return; }
        if (from && drop) this.dropped(rows, drop);
        this.dragFrom = this.dragOver = null;
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => { this.dragFrom = this.dragOver = null; menu(cx); });
    for (const r of rows) {
      if (r.kind === "group") {
        height += 28;
        const members = new Set(r.item.members.map((d) => d.id));
        const mine = sp.filter((s) => members.has(assigned[s.id]));
        const status = r.shut ? urgent(mine) : null;
        items.push(drag(h_flex().id(`ws-group-${r.name}`).h(28).px(8).gap(6).rounded(7).items_center().flex_none().cursor_pointer()
          .hover((s) => s.bg(t.selected)).tooltip(`${r.shut ? "Click to open" : "Click to fold"}. Drag to move the group; right-click to rename or ungroup it.`)
          .child(svg(`mods/workspace-chrome/chevron-${r.shut ? "right" : "down"}.svg`).size(10).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.muted).child(r.name))
          .child(hint(status ? div().size(6).rounded_full().bg(t[status]) : div(), r.shut ? String(mine.length) : "", div().w(13))),
          r, () => this.fold(r.name),
          (cx) => { this.renaming = r.name; this.renameIn.set_value(r.name); this.renameIn.set_selected_range({ start: 0, end: r.name.length }); this.renameIn.focus(); cx.notify(); }));
        continue;
      }
      const d = r.def;
      const mine = sp.filter((s) => assigned[s.id] === d.id);
      const status = urgent(mine);
      height += 30;
      items.push(drag(h_flex().id(`ws-def-${d.id}`).h(30).px(8).when(Boolean(r.group), (el) => el.pl(24)).gap(9).rounded(7).items_center().flex_none().cursor_pointer()
        .text_color(d.error ? t.dim : t.foreground).hover((s) => s.bg(t.selected))
        .tooltip(d.error ? `workspace.jsonc: ${d.error}` : tilde(d.root))
        .child(mark(d, defs, t, 18)).child(div().flex_1().min_w(0).truncate().child(d.name))
        .child(hint(status ? div().size(6).rounded_full().bg(t[status]) : div(), String(mine.length), check(active?.id === d.id))),
        r, () => { closeOverlay(props().overlay); choose(d.id); },
        (cx) => { if (d.scratch || d.error) return; this.grouping = d.id; this.newGroupIn.set_value(""); this.newGroupIn.focus(); cx.notify(); }));
    }

    // The actions before the folders: a workspace can have many folders.
    items.push(line());
    // The board has its own button beside the switcher, except on the narrow rail.
    if (active && narrow()) {
      // The board opens from the sidebar copy: a popup's tasks end when it closes.
      items.push(row("ws-board-open", svg("mods/ws-board/board.svg").size(14).flex_none().text_color(t.muted), `Open ${active.name} board`, div(),
        () => setShared("workspaces.board", { id: active.id, at: Date.now() })));
    }
    if (active && !active.error && !active.scratch) {
      items.push(row("ws-trees-open", icon("git-branch"), `Open ${active.name} worktrees`, div(),
        () => setShared("workspaces.worktrees", { id: active.id, at: Date.now() }), { tip: "Every worktree of its repos: what's finished, set up and clean up" }));
    }
    if (shown && defs.length) {
      items.push(row("ws-move", icon("layers"), `Move “${shown.name}” to…`, hint("›"),
        (cx) => { this.moving = true; cx.notify(); }, { keep: true }));
    }
    const target = active?.dir ?? dir();
    items.push(row("ws-edit", icon("file-text"), active ? `Open ${active.name}'s files` : "Open the workspaces folder", div(),
      () => openFolder(target), { tip: tilde(target) }));
    if (active) {
      const ask = (dialog, height) => openOverlay({ mod: "ws-switcher", kind: "dialog", width: 420, height, props: { dialog, id: active.id } });
      items.push(row("ws-rename", icon("square-pen"), `Rename ${active.name}…`, div(), () => ask("rename", 210)));
      if (!active.scratch && !active.error) {
        const now = groupOf(active);
        items.push(row("ws-group", icon("layers"), now ? `Change ${active.name}'s group…` : `Put ${active.name} in a group…`, hint(now ?? "", "›"),
          (cx) => { this.grouping = active.id; this.newGroupIn.set_value(""); this.newGroupIn.focus(); cx.notify(); },
          { keep: true, tip: "Workspaces in the same group sit together in this list, under a header that folds" }));
      }
      items.push(row("ws-delete", svg("mods/workspace-chrome/archive.svg").size(14).flex_none().text_color(t.blocked), `Delete ${active.name}…`, div(),
        () => ask("delete", active.scratch ? 230 : 200), { danger: true }));
    }

    if (active && !active.error) {
      // Scratch's folders are its scratch folders as the last look found them (scratch.js).
      const folders = active.scratch ? (shared("workspaces.scratch.folders") ?? active.children.map((c) => `${active.root}/${c}`))
        : active.folders.length ? active.folders : active.children.map((c) => `${active.root}/${c}`);
      if (folders.length) items.push(line(), head(`${active.name} folders`));
      for (const f of folders) {
        const there = sp.find((s) => !s.machine && inFolder(active, placeOf(s, ps), f));
        // A named scratch folder shows its name, and a space reopened there is called that.
        const name = active.scratch ? scratchLabel(f) : null;
        items.push(row(`ws-folder-${f}`, icon("folder"), name ?? base(f), hint(there ? "Go" : "Open"),
          () => run(there ? "space.select" : "space.new", there ? { id: there.id } : { folder: f, ...(name ? { name } : {}) }), { tip: tilde(f) }));
      }
    }

    return frame(items);
  }

  // The menu's workspace rows, top to bottom: { key, kind: "ws" | "group", def or name,
  // top: its item's index in the tree, group: the one it's in, pinned: Scratch, shut }.
  rowsOf(tree, active) {
    const folded = new Set(shared("workspaces.order")?.folded ?? []);
    const rows = [];
    tree.forEach((it, top) => {
      if (!it.group) { rows.push({ key: `w:${it.ws.id}`, kind: "ws", def: it.ws, top, pinned: Boolean(it.pinned) }); return; }
      const shut = folded.has(it.group);
      rows.push({ key: `g:${it.group}`, kind: "group", name: it.group, item: it, top, shut });
      for (const d of it.members) if (!shut || d.id === active?.id) rows.push({ key: `w:${d.id}`, kind: "ws", def: d, group: it.group, top });
    });
    return rows;
  }

  // Where the row being dragged would land: the row and edge to mark, and the move for
  // arrange.js. On a workspace: above it in its upper half, below in its lower; on a
  // header, a workspace goes above the group in its top third, else into it; a group
  // goes above or below a whole item. The Scratch row means the end.
  dropAt(rows) {
    const from = rows.find((r) => r.key === this.dragFrom), over = rows.find((r) => r.key === this.dragOver);
    if (!from || !over || from === over || from.pinned) return null;
    const upper = (this.dragY ?? 0.5) < 0.5;
    const src = from.kind === "group" ? { kind: "group", name: from.name } : { kind: "ws", id: from.def.id };
    if (over.pinned) return { key: over.key, edge: "top", src, to: { kind: "end" } };
    if (from.kind === "ws") {
      if (over.kind === "group") {
        if ((this.dragY ?? 0.5) >= 0.34) return { key: over.key, edge: "into", src, to: { kind: "group", name: over.name } };
        return { key: over.key, edge: "top", src, to: { kind: "before", name: over.name } };
      }
      return { key: over.key, edge: upper ? "top" : "bottom", src, to: { kind: "ws", id: over.def.id }, after: !upper };
    }
    if (over.top === from.top) return null;
    const span = rows.filter((r) => r.top === over.top);
    const first = span[0] === over, last = span[span.length - 1] === over;
    const down = rows.indexOf(from) < rows.indexOf(over);
    const after = first && last ? !upper : first ? (upper ? false : down) : last ? (upper ? down : true) : down;
    const to = over.kind === "group" ? { kind: "group", name: over.name } : over.group ? { kind: "group", name: over.group } : { kind: "ws", id: over.def.id };
    return { key: (after ? span[span.length - 1] : span[0]).key, edge: after ? "bottom" : "top", src, to, after };
  }

  // A drop: the new order (and the workspace's new group) to the sidebar copy.
  dropped(rows, drop) {
    const tree = arrange(shared("workspaces.defs") ?? [], shared("workspaces.order") ?? {});
    const r = moveRow(tree, drop.src, drop.to, drop.after);
    if (!r) return;
    setShared("workspaces.arrange", { order: r.order, ...(r.group !== undefined ? { groups: { [drop.src.id]: r.group } } : {}), at: Date.now() });
  }

  // A group's header clicked: folded, or open again.
  fold(name) {
    const folded = new Set(shared("workspaces.order")?.folded ?? []);
    if (folded.has(name)) folded.delete(name); else folded.add(name);
    setShared("workspaces.arrange", { folded: [...folded], at: Date.now() });
  }

  // A workspace's group set from its submenu (null: none). Its place in the list stays.
  setGroup(id, group) {
    const defs = (shared("workspaces.defs") ?? []).map((d) => (d.id === id ? { ...d, group } : d));
    const saved = shared("workspaces.order") ?? {};
    const order = arrange(defs, saved).filter((it) => !it.pinned)
      .flatMap((it) => (it.group ? [{ group: it.group }, ...it.members.map((d) => d.id)] : [it.ws.id]));
    setShared("workspaces.arrange", { order, groups: { [id]: group }, at: Date.now() });
  }

  // Enter in a submenu's box: the new group for the workspace, or the group's new name.
  groupTyped(text, cx) {
    const defs = shared("workspaces.defs") ?? [];
    const names = [...new Set(defs.map(groupOf).filter(Boolean))];
    if (this.grouping) {
      const name = groupName(text, names);
      if (!name) return;
      closeOverlay(props().overlay);
      this.setGroup(this.grouping, name);
    } else if (this.renaming) {
      const from = this.renaming, to = groupName(text, names.filter((n) => n !== from));
      closeOverlay(props().overlay);
      if (!to || to === from) return;
      const saved = renamed(shared("workspaces.order") ?? {}, from, to);
      const groups = Object.fromEntries(defs.filter((d) => groupOf(d) === from).map((d) => [d.id, to]));
      setShared("workspaces.arrange", { ...saved, groups, at: Date.now() });
    }
  }

  // Ungroup: its workspaces lose the group and stay where they are.
  ungroup(g) {
    const saved = shared("workspaces.order") ?? {};
    setShared("workspaces.arrange", {
      order: (saved.order ?? []).filter((e) => typeof e === "string" || e.group !== g.group),
      folded: (saved.folded ?? []).filter((n) => n !== g.group),
      groups: Object.fromEntries(g.members.map((d) => [d.id, null])),
      at: Date.now(),
    });
  }

  // 0 shows every space, 1-9 the workspaces in the menu's order.
  key(e, defs) {
    if (this.moving || this.grouping || this.renaming || e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    if (!/^[0-9]$/.test(e.key)) return;
    const n = Number(e.key);
    if (n > defs.length) return;
    closeOverlay(props().overlay);
    choose(n === 0 ? null : defs[n - 1].id);
  }
}
