// Board: one workspace's tasks as a kanban board. It's the workspace's own screen:
// the layout holds one copy (props { screen: true }) that shows the board of the
// workspace shown in the switcher and follows it, and the switcher's board button
// shows it in place of the tabs, from any space. In a tab or pane of its own
// (props { workspace }) it keeps to that workspace. A pane beside the terminals (props
// { beside: true, workspace }) has no title row (Herdr's pane header names it), its
// controls in one slim row, and opens as List while narrow unless Board was picked there.
//
// A task is a markdown file, ~/.herdr/workspaces/<workspace>/tasks/<ID>.md:
// front matter between --- lines (id, title, status, folder, priority, created,
// what Start adds: terminal, tab, worktree, branch, started; and pr, its pull
// request, which the agent or the switcher adds), then notes in
// markdown. People (the task dialog) and agents (editing the file) change the
// same files; the board redraws when they do. Unknown front matter lines are kept.
//
// Columns come from the workspace's `board` in workspace.jsonc:
//   "board": { "columns": ["backlog", "todo", "doing", "review", "done"],
//              "prefix": "ACM", "agent": "claude", "start": "doing", "finish": "review" }
// Every key is optional. A card's Start runs the workspace's agent on the task in
// the task's folder (in that folder's space, else a new one); Worktree first makes
// a branch and worktree for it, as Herdr's worktree menu does, and runs the repo's
// setup script in it if it has one (treescripts.js). Either way the
// card moves to `start`, and the agent is asked to set `finish` when it's done.
//
// The same mod opens its task dialog: props { dialog: "task", workspace, task? , status? }.
//
// Start with… beside a card's Start opens its other dialog, props { dialog: "start",
// workspace, task, owner }: who runs it (the workspace's presets and the installed
// agents), in which folder, in a new worktree or not, and the first message (Start's
// own, editable). The dialog's Start hands that to the board copy that opened it
// (shared "workspaces.board.start", `owner` being that copy), which runs its own
// start() with those as overrides (startfacts.js), so the card gets what Start gives it.
//
// Tasks | GitHub in the header switches to the workspace's GitHub project board
// ("board": { "github": "<its link>" }, which the view's own link box writes): its
// columns and items, read with your gh login (`gh api graphql`), nothing written.
// It shows as columns or as a list, in the board's order or by when each item was opened.
// Take makes a card here from any item, with `github:` (its link) and `github_item:`
// (the board item's id); the switcher then keeps that card current (ghboard.js) and
// publishes its status as shared "workspaces.github". ghfacts.js has the rules.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { spaces, panes, agents, terminals, run, theme, settings, shared, setShared, props, openOverlay, closeOverlay, window, home, watchFolder, readTextFile, writeTextFile, notify, knownAgents, checking } from "herdr";
import { exec } from "./posix.js";
import * as fs from "fs/promises";
import { setUp } from "./treescripts.js";
import { programOf, startChoices, firstPick, overOf, whoStarts, firstMessage, columnWidth, WIDE_COLUMN, agentChips, folderChips } from "./startfacts.js";
// The system's trash by its name: the Recycle Bin on Windows, the Trash elsewhere.
const trashName = () => (window()?.platform === "windows" ? "Recycle Bin" : "Trash");
import {
  BOARD_QUERY, itemsQuery, parseBoard, repoOfRemote, shape, boardFrom, columnsOf, filterItems, reposOf, doneLike, shortRepo, refOf, whoOf,
  taskOf, takeColumn, taskBody, taskFields, withBoardLink, ago, ghError, ORDERS, sortItems, age, FRESH, keptText, keptBoard,
} from "./ghfacts.js";

const COLUMNS = ["backlog", "todo", "doing", "review", "done"];
const PRIORITY = { high: 3, medium: 2, low: 1 };
// The list's rows' least width in a narrow tab or pane (id, title, priority, folder, agent).
const LIST_MIN = 600;
// The board's last column (Done) shows this many cards, then "Show all N".
const CARD_LIMIT = 60;
// A pane beside the terminals narrower than this opens as List (unless Board was picked
// there). Under LIST_MIN its list rows take two lines instead of scrolling sideways.
const PANE_BOARD = 720;
// Columns share the width down to COL_FIT each; narrower than that they take COL_MIN each
// and scroll sideways (a full-size board in a 1280px window at 120% has about 146 each).
const COL_FIT = 140;
const COL_MIN = 200;
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const STATUS_WORD = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };
// A dialog's first Esc or Close × with something typed or changed: said on its own line, in
// `working` as Secrets says it. A second Esc or × then closes, whichever came first.
const ASK_AGAIN = { esc: "Press Esc again to close and drop what you typed.", x: "Click × again to close and drop what you typed.", go: "Click again to go there and drop what you typed." };
const START_WITH = "workspaces.board.start"; // Start with…'s dialog asks the board copy that opened it
// The tab bar's bell asks the board (the switcher shows it first) to open a card: { ws, taskId, at, taken? }.
// The screen of that workspace takes it once its cards are read (a tab or pane of it after 1.5s, if the
// screen hasn't), within 15s.
const CARD_OPEN = "workspaces.board.open";
// Moves a file to the Trash ($1), or into $2 where there's no Trash command. Prints where.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/" && echo "$2"`;

const workspacesDir = () => `${home()}/.herdr/workspaces`;
// A folder watch's paths that are all inside workspaces' notes/ folders (as ws-switcher's defs.js tells).
const notesOnly = (paths) => Array.isArray(paths) && paths.length > 0 && paths.every((p) => {
  const rest = String(p).startsWith(workspacesDir() + "/") ? String(p).slice(workspacesDir().length + 1).split("/") : [];
  return rest.length >= 2 && rest[0] !== "" && rest[1] === "notes";
});
const tasksDir = (id) => `${workspacesDir()}/${id}/tasks`;
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;

function expand(p) {
  const s = String(p ?? "").trim();
  if (!s) return "";
  const full = s === "~" ? home() : s.startsWith("~/") ? home() + s.slice(1) : s;
  return full.length > 1 ? full.replace(/\/+$/, "") : full;
}
const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const under = (p, d) => Boolean(p && d) && (p === d || p.startsWith(d + "/"));
const base = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
// Today's date where you are (toISOString would give UTC's).
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");
const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const message = (e) => String(e?.message ?? e);
// Where a GitHub board is kept between reads (ghfacts.js: keptText), one file per board, for every board tab.
const keptFile = (ref) => `${home()}/.herdr/cache/github-boards/${ref.kind}-${ref.owner}-${ref.number}.json`;
// Opens a GitHub page in the browser (nothing else: the links come from files and from GitHub).
// The links the board opens: GitHub's own pages only (a mark on another host isn't drawn as a link).
const opensLink = (url) => /^https:\/\/github\.com\//.test(String(url ?? ""));
const openLink = (url) => {
  if (opensLink(url)) exec("sh", ["-c", 'command -v open >/dev/null 2>&1 && exec open "$1"; command -v explorer.exe >/dev/null 2>&1 && exec explorer.exe "$1"; exec xdg-open "$1"', "sh", url]).catch(() => {});
};

// --- the workspace's board settings ---

function boardOf(def) {
  const b = def?.board && typeof def.board === "object" ? def.board : {};
  const columns = (Array.isArray(b.columns) && b.columns.length ? b.columns : COLUMNS).map((c) => String(c).toLowerCase());
  const pick = (want, fallback) => (columns.includes(String(want ?? "").toLowerCase()) ? String(want).toLowerCase() : fallback);
  return {
    columns,
    prefix: String(b.prefix || (def?.id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "T").toUpperCase(),
    agent: String(b.agent || "claude"),
    start: pick(b.start ?? "doing", columns[Math.min(2, columns.length - 1)]),
    finish: pick(b.finish ?? "review", columns[columns.length - 1]),
  };
}

// --- task files: front matter (simple `key: value` lines) and a markdown body ---

function split(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { head: [], body: text };
  return { head: m[1] ? m[1].split(/\r?\n/) : [], body: text.slice(m[0].length) };
}

function unquote(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v.startsWith("'")) return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  const hash = v.search(/\s#/);
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

// Plain where YAML reads it back as the same text, else a double-quoted string.
function quote(v) {
  const s = String(v);
  return /^[A-Za-z0-9_./~@(][^:#"'{}\[\]\n]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|null|yes|no|on|off|-?[0-9.]+)$/i.test(s)
    ? s : JSON.stringify(s);
}

function field(head, key) {
  const line = head.find((l) => l.startsWith(`${key}:`));
  return line === undefined ? null : unquote(line.slice(key.length + 1));
}

// The text with these front matter fields set (null or "" removes one), the rest kept.
function withFields(text, fields, body) {
  const parts = split(text);
  const lines = [...parts.head];
  for (const [k, v] of Object.entries(fields)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (v === null || v === undefined || v === "") { if (i >= 0) lines.splice(i, 1); continue; }
    if (i >= 0) lines[i] = `${k}: ${quote(v)}`;
    else lines.push(`${k}: ${quote(v)}`);
  }
  const rest = body === undefined ? parts.body : `\n${body.trim()}\n`;
  return `---\n${lines.join("\n")}\n---\n${rest}`;
}

async function loadTasks(id) {
  const dir = tasksDir(id);
  let names = [];
  try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith(".")); }
  catch { return []; }
  const tasks = [];
  for (const name of names) {
    const file = `${dir}/${name}`;
    const text = await readTextFile(file);
    if (text === null) continue;
    const { head, body } = split(text);
    const firstLine = body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean);
    tasks.push({
      file,
      id: field(head, "id") || name.replace(/\.md$/, ""),
      title: field(head, "title") || firstLine || name.replace(/\.md$/, ""),
      status: (field(head, "status") || "").toLowerCase(),
      folder: field(head, "folder"),
      priority: (field(head, "priority") || "").toLowerCase() || null,
      agent: field(head, "agent"),
      terminal: field(head, "terminal"),
      tab: field(head, "tab"),
      worktree: field(head, "worktree"),
      branch: field(head, "branch"),
      pr: field(head, "pr"),
      github: field(head, "github"),
      github_item: field(head, "github_item"),
      body: body.trim(),
    });
  }
  // A card started with Worktree: whether that worktree is still there (Start runs in it then).
  for (const t of tasks) t.treeThere = Boolean(t.worktree) && await fs.exists(expand(t.worktree)).catch(() => false);
  const num = (t) => Number(/(\d+)$/.exec(t.id)?.[1] ?? Infinity);
  return tasks.sort((a, b) => (PRIORITY[b.priority] ?? 0) - (PRIORITY[a.priority] ?? 0) || num(a) - num(b) || a.title.localeCompare(b.title));
}

// The next free ID: one more than the highest PREFIX-n in the folder.
async function nextId(id, prefix) {
  let n = 0;
  try {
    for (const name of await fs.readdir(tasksDir(id))) {
      const m = new RegExp(`^${prefix}-(\\d+)\\.md$`, "i").exec(name);
      if (m) n = Math.max(n, Number(m[1]));
    }
  } catch {}
  return `${prefix}-${n + 1}`;
}

// The open last column's cards: the first `limit`, plus any that landed in that column while
// this board was open (a drop, a move in the dialog, an agent's), so a card moved there is
// seen to land. All of them once "Show all" was pressed.
// The Tasks side's search: the cards holding every typed word in their id, title, folder,
// agent or notes (any case), as the GitHub side's search matches its items.
function filterTasks(tasks, text) {
  const words = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tasks;
  return tasks.filter((x) => {
    const hay = `${x.id ?? ""} ${x.title ?? ""} ${x.folder ?? ""} ${x.agent ?? ""} ${x.body ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function shownCards(tasks, limit, all, landed) {
  if (all || tasks.length <= limit) return tasks;
  return tasks.filter((x, i) => i < limit || landed.has(x.id));
}

// --- folders, spaces and agents ---

// Folder names as the task writes them: relative to root, else ~/... .
const rel = (def, path) => (path === def.root ? "" : path.startsWith(def.root + "/") ? path.slice(def.root.length + 1) : tilde(path));
function folderPath(def, folder) {
  if (!folder) return def.root;
  const e = expand(folder);
  return e.startsWith("/") ? e : `${def.root}/${e}`;
}
const folderChoices = (def) => (def.folders.length ? def.folders : def.children.map((c) => `${def.root}/${c}`));

function placeOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}

// Where a workspace folder really is when a symlink leads there (the switcher
// resolves roots and folders; macOS's /tmp is /private/tmp). Terminals report that.
function realOf(def, path) {
  if (def.real?.[path]) return def.real[path];
  const root = def.real?.[def.root];
  return root && path.startsWith(def.root + "/") ? root + path.slice(def.root.length) : null;
}

// The workspace's space that best holds a folder: the deepest one inside it.
function spaceFor(def, folder) {
  const assigned = shared("workspaces.assigned") ?? {};
  const ps = panes();
  let best = null, length = -1;
  for (const s of spaces()) {
    if (assigned[s.id] !== def.id || s.machine) continue;
    const at = placeOf(s, ps);
    if ((under(at, folder) || under(at, realOf(def, folder))) && at.length > length) { best = s; length = at.length; }
  }
  return best;
}

// What the card shows of its agent: live and its status, or gone. An agent at its
// terminal counts only in the tab Start made (an address can come back for another
// terminal later; a tab's id can't), as the pull request watcher (prs.js) checks it.
// Cards from before `tab:` was recorded go by the tab's name, which Start sets to the id.
function agentOf(task, ag, tm) {
  if (!task.terminal) return null;
  const a = ag.find((x) => x.address === task.terminal);
  if (a) return (task.tab ? a.tab === task.tab : a.tab_name === task.id) ? { live: true, status: a.status, name: a.program?.name ?? "Agent" } : { live: false };
  const term = tm.find((x) => x.address === task.terminal);
  if (term && term.state === "live") return { live: true, status: null, name: term.program?.name ?? "Terminal" };
  return { live: false };
}

// --- presets (loaded by the switcher into shared "workspaces.presets") ---

function presetsFor(id) {
  const p = shared("workspaces.presets") ?? {};
  const own = (id && p.workspaces?.[id]) || [];
  return [...own, ...(p.global ?? []).filter((g) => !own.some((o) => o.name === g.name))].filter((x) => !x.error);
}

// A shell line as words: quotes and backslashes as sh reads them.
function words(line) {
  const out = [];
  let cur = null, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
      continue;
    }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur ??= "";
    if (c === "'" || c === '"') q = c;
    else if (c === "\\" && i + 1 < line.length) cur += line[++i];
    else cur += c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

// How Herdr starts a preset: { argv, task }. With the launcher, Claude, Codex,
// Antigravity (agy) and Pi get the instructions as system instructions (--instructions)
// and the task as the first message; other agents get both in the first message,
// as hc does.
// The first message, for the launcher: as --task, not last on the command line where
// Herdr would put it, so a restart brings the agent back without sending it again
// (bin/herdr-ws-resume). Other commands keep Herdr's task.
// Windows: herdr-core starts herdr-ws-agent through its .cmd, and cmd can't take a line break in an
// argument, so the task's line breaks go as U+2028 (LINE SEPARATOR), which herdr-ws-agent turns back.
function withTask(argv, task) {
  let i = argv[0] === "env" ? 1 : 0;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  if (!task || base(argv[i] ?? "") !== "herdr-ws-agent") return { argv, task };
  const t = window()?.platform === "windows" ? String(task).replace(/\r\n?|\n/g, "\u2028") : task;
  return { argv: [...argv.slice(0, i + 1), "--task", t, ...argv.slice(i + 1)], task: "" };
}

function presetLaunch(preset, task) {
  let argv = words(preset.command);
  // `VAR=x cmd` (or `env VAR=x cmd`): the assignments go first, before the launcher.
  if (argv[0] === "env") argv = argv.slice(1);
  const assigns = [];
  while (argv[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) assigns.push(argv.shift());
  if (base(argv[0] ?? "") === "herdr-ws-agent") argv = argv.slice(1);
  const agent = base(argv[0] ?? "");
  const launcher = shared("workspaces.launcher") === true;
  const system = launcher && (agent === "claude" || agent === "codex" || agent === "agy" || agent === "pi") && Boolean(preset.body);
  if (launcher) argv = ["herdr-ws-agent", ...(system ? ["--instructions", preset.file] : []), ...argv];
  if (assigns.length) argv = ["env", ...assigns, ...argv];
  const told = preset.body && `You are the "${preset.name}" agent, started from the Herdr agent preset of that name (${preset.file}). Its instructions:\n\n${preset.body}`;
  return { argv, task: system ? task : [told, task].filter(Boolean).join("\n\n") };
}

// Runs an app command and returns what it made ({ space, tab, terminal }).
async function herdr(command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)], { timeout: 60000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if (!out || out.error) throw new Error(out?.error || r.stderr.trim() || `herdr-app do ${command} failed`);
  return out;
}

// A branch and worktree for the task, where Herdr's worktree menu puts them.
async function makeWorktree(folder, task) {
  const git = (args) => exec("git", ["-C", folder, ...args], { timeout: 600000 });
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => null);
  if (!common || common.code !== 0) throw new Error(`${tilde(folder)} isn't a git repository. Pick the task's repo first.`);
  const repo = common.stdout.trim().replace(/\/\.git\/?$/, "");
  const branch = `task/${task.id.toLowerCase()}-${slug(task.title.toLowerCase()).slice(0, 40)}`.replace(/[-.]+$/, "");
  const path = `${home()}/.herdr/worktrees/${base(repo)}/${slug(branch)}`;
  if (await fs.exists(path)) return { path, branch, repo };
  const exists = (await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  const r = await git(exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "git worktree add failed");
  return { path, branch, repo };
}

// The agent's first message: the task, then how to report back.
function brief(task, b) {
  return [
    `${task.id}: ${task.title}`,
    task.body,
    "---",
    `This task is tracked in ${tilde(task.file)}; its status is now "${b.start}". When you've finished, change its "status:" line to "${b.finish}" and, if anything is left open, add it under a "## Notes" heading at the end. Leave the other lines between the --- markers as they are.`,
    `If you open a pull request for it, add a line "pr: <its URL>" between the --- markers. Herdr then follows it and tells you here when a check fails, a review arrives or it conflicts, so end your turn instead of waiting on its checks.`,
  ].filter(Boolean).join("\n\n");
}

// A multi-line box takes ⌘/Ctrl+Enter itself: it puts a line break at the cursor, then says
// "submit" with `secondary` (the key never reaches the dialog). This takes that break back out.
function dropEnterBreak(state) {
  const at = state.selected_range()?.start ?? -1, text = state.value();
  if (at > 0 && text[at - 1] === "\n") {
    state.set_value(text.slice(0, at - 1) + text.slice(at));
    state.set_selected_range({ start: at - 1, end: at - 1 });
  }
}

function mark(def, t, size) {
  const defs = shared("workspaces.defs") ?? [];
  const c = def.color ?? PALETTE[Math.max(0, defs.findIndex((d) => d.id === def.id)) % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
  return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(Math.round(size * 0.55)).font_bold().text_color("#ffffff").child([...def.name][0]?.toUpperCase() ?? "?");
}

export default class Board extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (props()?.dialog) return this.initDialog(cx);
    // The layout's screen follows the shown workspace; a tab keeps the one it was made with.
    this.follow = Boolean(props()?.screen);
    // A pane beside the terminals: Herdr's pane header names it, so it has no title row of its own.
    this.beside = !this.follow && Boolean(props()?.beside);
    this.workspace = (this.follow ? null : props()?.workspace) ?? shared("workspaces.active") ?? null;
    this.taskSearch = InputState.new({ value: "", placeholder: "Search tasks…" });
    this.taskSearch.on("change", (_e, cx) => cx.notify());
    this.reset();
    this.initGithub(cx);
    this.load(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        // The workspace's folder: tasks/ may not exist until the first task. The
        // screen watches every workspace's, so it needn't start over when it changes.
        let paths;
        try { paths = await watchFolder(this.follow ? workspacesDir() : `${workspacesDir()}/${this.workspace}`); }
        catch { cx.timer.every(5000, (cx) => this.load(cx)); return; }
        if (notesOnly(paths)) continue; // a note being typed (ws-notes): no task changed
        this.load(cx);
      }
    });
    // On a timer, not in render: a task started while rendering never gets to run.
    if (this.follow && !checking()) cx.timer.every(400, (cx) => this.retarget(cx));
    // Start with…: its dialog's tasks end when it closes, so this copy starts what it asks for.
    this.copyId = Math.random().toString(36).slice(2, 10);
    this.startAsked = shared(START_WITH)?.at;
    if (!checking()) cx.timer.every(400, (cx) => { this.startWithAsked(cx); this.cardAsked(); });
  }

  // A card the bell asked for (CARD_OPEN): its task dialog. Gone since: nothing (the bell said so).
  // A task the dialog just added (shared "workspaces.board.added"): when the search holds
  // words it doesn't match, the box is emptied, so the new card shows. Looked at when the
  // cards are read and on the board's 2s beat (the file may be read before the stamp lands).
  addedAsked(cx) {
    const added = shared("workspaces.board.added") ?? null;
    if (!added?.at || added.at === this.addedSeen) return;
    this.addedSeen = added.at;
    const d = Date.now() - added.at;
    if (added.ws !== this.workspace || d < 0 || d > 15000 || !this.taskSearch?.value()) return;
    const x = this.tasks.find((t) => t.id === added.id);
    if (!x) { this.addedSeen = null; return; } // not read yet: the next read or beat looks again
    if (!filterTasks([x], this.taskSearch.value()).length) { this.taskSearch.set_value(""); cx?.notify(); }
  }

  cardAsked() {
    const ask = shared(CARD_OPEN) ?? null;
    if (!ask?.at || ask.taken || !this.loaded || ask.ws !== this.workspace) return;
    const age = Date.now() - ask.at;
    if (age > 15000 || (!this.follow && age < 1500)) return;
    setShared(CARD_OPEN, { ...ask, taken: true });
    const task = this.tasks.find((x) => x.id === ask.taskId);
    if (task) this.openTask(task);
  }

  // A Start with… this copy opened: the card as it is now, started through start().
  startWithAsked(cx) {
    const ask = shared(START_WITH) ?? null;
    if (!ask || ask.at === this.startAsked) return;
    this.startAsked = ask.at;
    if (ask.owner !== this.copyId || Date.now() - ask.at > 15000) return;
    const task = this.tasks.find((x) => x.file === ask.file);
    if (!task) return notify({ title: "Couldn't start that card", body: "Its file is gone.", level: "error" });
    this.start(task, Boolean(ask.worktree), cx, ask.over ?? null);
  }

  openStartWith(task) {
    openOverlay({
      mod: "ws-board", kind: "dialog", width: 600, height: 600, modal: true,
      props: { dialog: "start", workspace: this.workspace, task: { ...task }, owner: this.copyId },
    });
  }

  // Board or List: what was picked here, else List in a narrow pane beside the terminals
  // (its width unknown yet counts as narrow), else Board.
  shownView(github = false) {
    const picked = github ? this.gh.view : this.view;
    return picked ?? (this.beside && !(this.width >= PANE_BOARD) ? "list" : "board");
  }

  // A board's own state, as it opens.
  reset() {
    this.tasks = [];
    if (this.taskSearch?.value()) this.taskSearch.set_value(""); // another workspace's cards: not its search
    this.loaded = false;
    this.busy = {}; // task id -> "start" | "worktree"
    this.drag = null; // { id, from, moved }
    this.over = null;
    this.dropped = 0;
    this.tipGone = null; // the id of a clicked opener whose tooltip is held back (tip())
    this.tipOver = null; // the id of the tip() element under the pointer
    // Remembered: which view, and the list's folded sections
    // (null until changed: the last column, done, starts folded).
    // Board or List as picked here; null until picked (shownView() decides).
    this.view = ["list", "board"].includes(this.pref("view")) ? this.pref("view") : null;
    const folded = this.pref("folded");
    this.folded = folded ? new Set(JSON.parse(folded)) : null;
    // The board view's last column folded to a strip (it starts open), and all its cards
    // shown past the first CARD_LIMIT (for as long as this board is open).
    this.lastFolded = this.pref("col.folded") === "1";
    this.showAll = false;
    this.landed = new Set(); // ids that came into the last column while this board was open
    this.addedSeen = shared("workspaces.board.added")?.at ?? null; // the last added task already looked at (addedAsked())
    // Tasks (this board) or GitHub (the workspace's GitHub project board).
    this.source = this.pref("source") === "github" ? "github" : "tasks";
  }

  // What a board remembers: per tab, and the screen per workspace.
  pref(key) { return localStorage.getItem(this.follow ? `${this.workspace}:${key}` : key); }
  keep(key, value) { localStorage.setItem(this.follow ? `${this.workspace}:${key}` : key, value); }

  // The screen: another workspace is shown, so it's that one's board from here.
  // What was being read for the last one lands in the state left behind.
  retarget(cx) {
    // Shown in place of the terminals, it takes the keyboard from them: keys typed
    // at a board mustn't land in a terminal nobody sees.
    const showing = shared("workspaces.screen")?.screen === "board";
    if (showing && !this.showing) this.handle.focus();
    this.showing = showing;
    const ws = shared("workspaces.active") ?? null;
    if (ws === this.workspace) return;
    this.workspace = ws;
    this.reset();
    this.ghReset();
    this.load(cx);
    this.ghBeat(cx);
    cx.notify();
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const ws = this.workspace;
      const tasks = ws ? await loadTasks(ws) : [];
      if (ws !== this.workspace) return;
      const def = defOf(ws), cols = def ? boardOf(def).columns : null, last = cols?.[cols.length - 1];
      if (this.loaded && last) {
        const was = new Map(this.tasks.map((x) => [x.id, x.status]));
        for (const x of tasks) if (x.status === last && was.get(x.id) !== last) this.landed.add(x.id);
      }
      this.tasks = tasks;
      this.loaded = true;
      this.cardAsked();
      this.addedAsked();
      cx.notify();
    });
  }

  async update(task, fields) {
    for (let i = 0; ; i++) {
      const old = await readTextFile(task.file);
      if (old === null) throw new Error("its file is gone");
      try { return await writeTextFile(task.file, withFields(old, fields), old); }
      catch (e) { if (i >= 2) throw e; } // changed under us: read it again
    }
  }

  move(task, column, cx) {
    task.status = column; // shown at once; the folder watch confirms it
    this.landed.add(task.id); // stays in sight if it lands past the last column's first cards
    cx.spawn(async (cx) => {
      try { await this.update(task, { status: column }); }
      catch (e) { notify({ title: `Couldn't move ${task.id}`, body: message(e), level: "error" }); this.load(cx); }
    });
  }

  // `over` (Start with…, startfacts.js): another agent, folder and first message for
  // this start only; the rest (status, terminal, tab, started, worktree) is the same.
  // `stay`: Shift held on Start or Worktree: the new tab or space is made without being shown
  // (focus: false), so the board stays in view for the next card.
  start(task, worktree, cx, over = null, stay = false) {
    const def = defOf(this.workspace);
    if (!def || this.busy[task.id]) return;
    const b = boardOf(def);
    this.busy[task.id] = worktree ? "worktree" : "start";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // A card with its own worktree runs there, unless it's made a new one or Start with… says where.
        const tree = !worktree && !over && task.worktree ? expand(task.worktree) : null;
        const own = tree && await fs.exists(tree).catch(() => false) ? tree : folderPath(def, task.folder);
        const who = whoStarts(over, task.agent || b.agent, own);
        const folder = who.folder, name = who.name;
        const text = over ? firstMessage(over.text, task) : brief(task, b);
        const preset = who.preset ? presetsFor(def.id).find((x) => x.name === name) : null;
        let argv, first;
        if (preset) ({ argv, task: first } = presetLaunch(preset, text));
        else {
          const known = await knownAgents().catch(() => []);
          argv = known.find((a) => a.key === name)?.run ?? [name];
          first = text;
        }
        ({ argv, task: first } = withTask(argv, first));
        let made, extra = {};
        if (worktree) {
          const wt = await makeWorktree(folder, task);
          // The repo's setup script (the Worktrees screen's Scripts), once per worktree.
          // If it fails the agent doesn't start; Worktree again tries it again.
          await setUp({ home, readTextFile, writeTextFile, exec }, { ws: def.id, repo: base(wt.repo), path: wt.path, main: wt.repo, branch: wt.branch });
          made = await herdr("space.new", { folder: wt.path, tab: task.id, argv, ...(first ? { task: first } : {}), ...(stay ? { focus: false } : {}) });
          extra = { worktree: tilde(wt.path), branch: wt.branch };
        } else {
          const space = spaceFor(def, folder);
          made = space
            ? await herdr("tab.new", { space: space.id, name: task.id, folder, argv, ...(first ? { task: first } : {}), ...(stay ? { focus: false } : {}) })
            : await herdr("space.new", { folder, tab: task.id, argv, ...(first ? { task: first } : {}), ...(stay ? { focus: false } : {}) });
        }
        await this.update(task, { status: b.start, terminal: made.terminal ?? null, tab: made.tab ?? null, started: today(), ...extra });
      } catch (e) {
        notify({ title: `Couldn't start ${task.id}`, body: message(e), level: "error" });
      }
      delete this.busy[task.id];
      cx.notify();
    });
  }

  openTask(task, status) {
    openOverlay({
      mod: "ws-board", kind: "dialog", width: 600, height: 620, modal: true,
      props: { dialog: "task", workspace: this.workspace, status, task: task ? { ...task } : null },
    });
  }

  render() {
    const t = theme();
    if (props()?.dialog) return this.dialog(t);
    const def = defOf(this.workspace);
    const shell = v_flex().id("board").size_full().min_h(0).bg(t.canvas).text_size(13).text_color(t.foreground)
      // Sizes come in window px; the limits here (PANE_BOARD, LIST_MIN, COL_MIN) are in the mod's units.
      .on_size_change((size, cx) => { const w = size.width / (Number(settings().zoom) > 0 ? Number(settings().zoom) : 1); if (w !== this.width) { this.width = w; cx.notify(); } })
      .when(this.follow, (el) => el.track_focus(this.handle));
    // Between two workspaces (retarget() is a moment behind): nothing of the last one.
    if (this.follow && (shared("workspaces.active") ?? null) !== this.workspace) return shell;
    if (!def) {
      return shell.items_center().justify_center().text_color(t.dim)
        .child(this.workspace ? "This board's workspace is gone." : this.follow ? "Choose a workspace in the switcher to see its board." : "Open a board from Views, in the tab bar.");
    }
    const b = boardOf(def);
    const ag = agents(), tm = terminals();
    const columnOf = (task) => (b.columns.includes(task.status) ? task.status : b.columns[0]);
    const open = this.tasks.filter((x) => columnOf(x) !== b.columns[b.columns.length - 1]).length;

    const github = this.source === "github";
    // A tab or a pane beside the terminals can be narrow: its header wraps rather than lose its buttons.
    // A pane beside the terminals: one slim row of controls (Herdr's header names it); narrow,
    // without the counts and with New task as its + alone. It wraps rather than lose a button.
    const slim = this.beside, tiny = slim && !(this.width >= PANE_BOARD);
    if (slim) {
      const header = h_flex().min_h(36).flex_none().px(10).py(4).gap(8).items_center().flex_wrap().border_b(1).border_color(t.border)
        .child(this.sourceToggle(t))
        .when(!tiny, (el) => el.child(div().min_w(0).truncate().text_size(12).text_color(t.dim)
          .child(github ? (this.gh.board && this.ghRef(def) ? `${this.gh.board.title} on GitHub` : "") : `${open} open · ${this.tasks.length - open} done`)))
        .child(div().flex_1())
        .children(github ? this.ghTools(def, t) : [
          ...(tiny ? [] : [this.taskSearchBox(t, 160)]),
          this.viewToggle(t),
          h_flex().id("board-new").h(26).px(tiny ? 0 : 10).when(tiny, (el) => el.w(26).justify_center()).gap(6).flex_none().items_center().rounded(7).cursor_pointer()
            .bg(t.solid).text_color(t.solid_foreground).text_size(12).font_medium().hover((s) => s.opacity(0.88))
            .when(tiny, (el) => this.tip(el, "board-new", "New task"))
            .on_click((_e, cx) => { this.tipClicked("board-new", cx); this.openTask(null, b.columns[0]); })
            .child(svg("mods/workspace-chrome/plus.svg").size(13)).when(!tiny, (el) => el.child("New task")),
        ]);
      if (github) return shell.child(header).child(this.github(def, b, t));
      if (this.shownView() === "list") return shell.child(header).child(this.list(b, t, ag, tm, columnOf));
      return this.columns(shell, header, b, def, t, ag, tm, columnOf);
    }
    const header = h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      // Wraps only when its parts don't fit on one line: 48px when they do (the Board | List pill is 32).
      .h_auto().min_h(48).py(8).flex_wrap()
      .child(mark(def, t, 20))
      .child(div().flex_none().font_semibold().child(`${def.name} board`))
      .child(this.sourceToggle(t))
      .child(div().min_w(0).truncate().text_size(12).text_color(t.dim)
        .child(github ? (this.gh.board && this.ghRef(def) ? `${this.gh.board.title} on GitHub` : "") : `${open} open · ${this.tasks.length - open} done`))
      .child(div().flex_1())
      .children(github ? this.ghTools(def, t) : [
        this.taskSearchBox(t, 200),
        this.viewToggle(t),
        h_flex().id("board-new").h(30).px(12).gap(6).flex_none().items_center().rounded(8).cursor_pointer()
          .bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium().hover((s) => s.opacity(0.88))
          .on_click(() => this.openTask(null, b.columns[0]))
          .child(svg("mods/workspace-chrome/plus.svg").size(13)).child("New task"),
      ]);

    if (github) return shell.child(header).child(this.github(def, b, t));
    if (this.shownView() === "list") return shell.child(header).child(this.list(b, t, ag, tm, columnOf));
    return this.columns(shell, header, b, def, t, ag, tm, columnOf);
  }

  // The board view: a column per status.
  columns(shell, header, b, def, t, ag, tm, columnOf) {
    // How wide each open column is, for the cards' Worktree button (agentArea()).
    this.colWidth = columnWidth({ width: this.width, columns: b.columns.length, folded: this.lastFolded, squeezed: this.squeezed(b), min: COL_MIN });
    const shown = filterTasks(this.tasks, this.taskSearch?.value());
    const columns = b.columns.map((col) => this.column(col, shown.filter((x) => columnOf(x) === col), def, b, t, ag, tm));
    return shell
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; this.over = null; cx.notify(); } })
      .child(header)
      .child(h_flex().id("board-columns").flex_1().min_h(0).items_stretch().p(12).gap(10).children(columns)
        .when(this.squeezed(b), (el) => el.overflow_x_scrollbar()));
  }

  // The Tasks side's search box, drawn as the GitHub side's: an × while it holds text, and Esc in it empties it.
  taskSearchBox(t, w) {
    return h_flex().id("task-search").w(w).h(28).flex_none().px(8).gap(6).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
      .on_key_down((e, cx) => { if (e.key === "escape" && this.taskSearch.value()) { this.taskSearch.set_value(""); cx.stop_propagation(); cx.notify(); } })
      .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
      .child(Input.new(this.taskSearch).flex_1().min_w(0).text_size(12).text_color(t.foreground))
      .when(Boolean(this.taskSearch.value()), (el) => el.child(div().id("task-search-x").flex_none().cursor_pointer().text_color(t.dim).hover((x) => x.text_color(t.foreground))
        .tooltip("Clear the search").on_click((_e, cx) => { this.taskSearch.set_value(""); cx.notify(); }).child(svg("mods/workspace-chrome/x.svg").size(12))));
  }

  // Board | List, as two segments: for the tasks, or (github) for the GitHub view, each remembered apart.
  viewToggle(t, github = false) {
    const now = this.shownView(github);
    const segment = (view, text, icon) => h_flex().id(`${github ? "gh-" : ""}view-${view}`).h(26).px(10).gap(6).items_center().rounded(6).cursor_pointer()
      .text_size(12).when(now === view, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(now !== view, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => {
        if (github) this.gh.view = view; else this.view = view;
        this.keep(github ? "gh.view" : "view", view);
        cx.notify();
      })
      .child(svg(icon).size(13)).child(text);
    return h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border).bg(t.chrome)
      .child(segment("board", "Board", "mods/ws-board/board.svg"))
      .child(segment("list", "List", "mods/ws-board/list.svg"));
  }

  // The list: a section per column (click its header to fold it), a row per task.
  list(b, t, ag, tm, columnOf) {
    const last = b.columns[b.columns.length - 1];
    const folded = this.folded ?? new Set([last]);
    const fold = (col, cx) => {
      const next = new Set(folded);
      next.has(col) ? next.delete(col) : next.add(col);
      this.folded = next;
      this.keep("folded", JSON.stringify([...next]));
      cx.notify();
    };
    const shown = filterTasks(this.tasks, this.taskSearch?.value());
    const rows = b.columns.flatMap((col) => {
      const tasks = shown.filter((x) => columnOf(x) === col);
      const shut = folded.has(col);
      const head = h_flex().id(`sec-${col}`).h(34).flex_none().pl(14).pr(8).gap(8).items_center().cursor_pointer()
        .when(this.narrow(LIST_MIN + 40) && !this.compact(), (el) => el.min_w(LIST_MIN))
        .bg(t.chrome).border_b(1).border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => fold(col, cx))
        .child(svg(`mods/workspace-chrome/chevron-${shut ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(label(col)))
        .child(div().text_size(11.5).text_color(t.dim).child(String(tasks.length)))
        .child(div().flex_1())
        .child(div().id(`sec-new-${col}`).size(24).flex().items_center().justify_center().rounded(6).text_color(t.dim)
          .hover((s) => s.bg(t.raised).text_color(t.foreground)).when(true, (el) => this.tip(el, `sec-new-${col}`, `New task in ${label(col)}`))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.tipClicked(`sec-new-${col}`, cx); this.openTask(null, col); })
          .child(svg("mods/workspace-chrome/plus.svg").size(13)));
      return [head, ...(shut ? [] : tasks.map((task) => this.row(task, col === last, b, t, ag, tm)))];
    });
    // Narrow (a tab or a pane beside the terminals), the rows keep their width and the list scrolls sideways too.
    const wide = !this.narrow(LIST_MIN + 40);
    return v_flex().id("board-list").flex_1().min_h(0).when(wide, (el) => el.overflow_y_scrollbar()).when(!wide, (el) => el.overflow_scrollbar()).children(rows)
      .when(!this.tasks.length && this.loaded, (el) => el.child(div().px(16).py(12).text_size(12).text_color(t.dim).child("No tasks yet. New task adds one.")));
  }

  // Narrow: a tab or a pane always (it may be); the full-size screen once its width is
  // known and under `least`.
  narrow(least) { return !this.follow || (this.width > 0 && this.width < least); }
  // The columns don't fit at COL_FIT each: they take COL_MIN and scroll sideways (a tab or
  // pane whose width isn't known yet counts as too narrow; the screen as wide enough).
  squeezed(b) {
    const need = b.columns.length * (COL_FIT + 10) + 24;
    return this.width > 0 ? this.width < need : !this.follow;
  }

  // A narrow pane beside the terminals: list rows of two lines (id and title, then the agent
  // or Start), without the priority and folder columns, so nothing scrolls sideways.
  compact() { return this.beside && !(this.width >= LIST_MIN); }

  row(task, last, b, t, ag, tm) {
    const compact = this.compact();
    const pr = task.priority && PRIORITY[task.priority] ? task.priority : null;
    const prColor = pr === "high" ? t.blocked : pr === "medium" ? t.working : t.dim;
    const pull = this.prChip(task, t, true);
    const hub = this.ghChip(task, t);
    if (compact) {
      const area = this.agentArea(task, last, b, t, ag, tm, true);
      return v_flex().id(`row-${task.id}`).flex_none().pl(14).pr(10).py(7).gap(5)
        .border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { if (!this.dialogJustClosed()) { this.tipClicked(`row-title-${task.id}`, cx); this.openTask(task); } })
        .child(h_flex().gap(10).items_center()
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(task.id))
          .child(this.tip(div().id(`row-title-${task.id}`).flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground), `row-title-${task.id}`, task.title).child(task.title))
          .when(Boolean(hub), (el) => el.child(hub))
          .when(Boolean(pull), (el) => el.child(pull)))
        .when(Boolean(area), (el) => el.child(h_flex().justify_end().child(area)));
    }
    return h_flex().id(`row-${task.id}`).h(40).flex_none().pl(36).pr(12).gap(12).items_center()
      .when(this.narrow(LIST_MIN + 40), (el) => el.min_w(LIST_MIN))
      .border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { if (!this.dialogJustClosed()) { this.tipClicked(`row-title-${task.id}`, cx); this.openTask(task); } })
      .child(div().w(64).flex_none().text_size(11.5).text_color(t.dim).child(task.id))
      .child(this.tip(div().id(`row-title-${task.id}`).flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground), `row-title-${task.id}`, task.title).child(task.title))
      .when(Boolean(hub), (el) => el.child(hub))
      .when(Boolean(pull), (el) => el.child(pull))
      .child(div().w(52).flex_none().text_size(11.5).text_color(prColor).child(pr ?? ""))
      .child(h_flex().w(120).flex_none().gap(6).items_center().text_size(11).text_color(t.dim)
        .when(Boolean(task.folder), (el) => el.child(div().min_w(0).px(6).rounded(4).bg(t.raised).truncate().tooltip(task.folder).child(base(task.folder))))
        .when(Boolean(task.branch), (el) => el.child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none())))
      .child(h_flex().w(210).flex_none().justify_end().child(this.agentArea(task, last, b, t, ag, tm, true) ?? div()));
  }

  // A tooltip on something that opens a dialog goes once it's clicked with the pointer on it
  // (it would stay up over what it opened), and is back once the pointer has left it or is
  // on another one (the clicked thing may be gone, as Start is). While the dialog is up,
  // its backdrop keeps the board from being hovered at all.
  tip(el, id, text) {
    return el.on_hover((on, cx) => {
      if (on) { this.tipOver = id; if (this.tipGone && this.tipGone !== id) { this.tipGone = null; cx.notify(); } return; }
      if (this.tipOver === id) this.tipOver = null;
      if (this.tipGone === id) { this.tipGone = null; cx.notify(); }
    }).when(this.tipGone !== id, (x) => x.tooltip(text));
  }
  tipClicked(id, cx) { if (this.tipOver === id) { this.tipGone = id; cx?.notify(); } }

  // The task dialog just closed (a save or a delete): the second half of a double-click on its
  // button lands on the board under it, where it mustn't open or start a card.
  // The stamp is shared state, which Herdr keeps: a clock now behind it (set back) mustn't freeze the board.
  dialogJustClosed() { const d = Date.now() - (shared("workspaces.board.closed") ?? 0); return d >= 0 && d < 500; }

  // The last column folds to a strip and back, remembered per board.
  foldLast(cx) {
    this.lastFolded = !this.lastFolded;
    this.keep("col.folded", this.lastFolded ? "1" : "");
    cx.notify();
  }

  column(col, tasks, def, b, t, ag, tm) {
    const dropping = this.drag?.moved && this.over === col && this.drag.from !== col;
    // Narrow (a tab or a pane beside the terminals), the columns keep a card's width and scroll sideways.
    const squeezed = this.squeezed(b);
    const last = col === b.columns[b.columns.length - 1];
    // Folded (as the GitHub view's finished columns): a strip with its name and count. A card
    // dropped on it still lands in that column.
    if (last && this.lastFolded) {
      return this.dropOn(col, v_flex().id(`col-${col}`).w(96).flex_none().min_h(0).rounded(10).bg(t.chrome).border_1()
        .border_color(dropping ? t.accent : t.border).p(10).gap(4).cursor_pointer().hover((s) => s.border_color(dropping ? t.accent : t.input))
        .tooltip(`Show ${label(col)}`).on_click((_e, cx) => { if (!this.drag && Date.now() - this.dropped > 300) this.foldLast(cx); })
        .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(t.muted).child(label(col)))
        .child(div().text_size(11.5).text_color(t.dim).child(String(tasks.length))));
    }
    const all = !last || this.showAll || tasks.length <= CARD_LIMIT;
    const shown = shownCards(tasks, CARD_LIMIT, all, this.landed);
    return this.dropOn(col, v_flex().id(`col-${col}`).when(squeezed, (el) => el.w(COL_MIN).flex_none()).when(!squeezed, (el) => el.flex_1().min_w(0)).min_h(0).rounded(10).bg(t.chrome).border_1()
      .border_color(dropping ? t.accent : t.border))
      .child(h_flex().id(`col-head-${col}`).h(38).flex_none().pl(12).pr(6).gap(6).items_center()
        // The last column's header folds it; its + keeps its own click.
        .when(last, (el) => el.cursor_pointer().tooltip("Fold this column").on_click((_e, cx) => this.foldLast(cx)))
        .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(t.muted).child(label(col)))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(tasks.length)))
        .child(div().flex_1())
        .child(div().id(`col-new-${col}`).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).when(true, (el) => this.tip(el, `col-new-${col}`, `New task in ${label(col)}`))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.tipClicked(`col-new-${col}`, cx); this.openTask(null, col); }).child(svg("mods/workspace-chrome/plus.svg").size(13))))
      .child(v_flex().id(`col-list-${col}`).flex_1().min_h(0).px(8).pb(8).gap(8).overflow_y_scrollbar()
        .children(shown.map((task) => this.card(task, col, b, t, ag, tm)))
        .when(!all, (el) => el.child(div().id(`col-more-${col}`).flex_none().px(4).py(6).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.showAll = true; cx.notify(); })
          .child(`Show all ${tasks.length}`)))
        .when(!tasks.length && this.loaded, (el) => el.child(div().px(4).py(6).text_size(12).text_color(t.dim)
          .child(this.taskSearch?.value() ? "None like that" : "Empty"))));
  }

  // A column, open or folded, as a place to drop a dragged card.
  dropOn(col, el) {
    return el
      .on_mouse_move((e, cx) => {
        if (!this.drag) return;
        // Let go outside the board (the sidebar, the tab bar, another window): no release reached
        // it, so the first move back with no button held ends the drag (else the next click moves the card).
        if (e?.pressed_button !== "left") { this.drag = null; this.over = null; cx.notify(); return; }
        if (this.over === col) return;
        this.over = col;
        if (col !== this.drag.from) this.drag.moved = true;
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        this.over = null;
        const task = this.tasks.find((x) => x.id === d.id);
        if (d.moved && task && col !== d.from) { this.dropped = Date.now(); this.move(task, col, cx); }
        cx.notify();
      });
  }

  // A task's agent: starting, live (status and Go to), or Start / Worktree.
  // `inline`: one row for the list; else wrapping, for a card.
  agentArea(task, last, b, t, ag, tm, inline) {
    const a = agentOf(task, ag, tm);
    const busy = this.busy[task.id];
    const stop = (_e, cx) => cx.stop_propagation();
    const small = (id, text, action, tip) => div().id(id).h(24).px(8).flex().flex_none().items_center().rounded(6).border_1().border_color(t.input)
      .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => this.tip(el, id, tip))
      .on_mouse_down("left", stop).on_click((e, cx) => { cx.stop_propagation(); if (!this.dialogJustClosed()) { this.tipClicked(id, cx); action(cx, Boolean(e?.modifiers?.shift)); } }).child(text);
    if (busy) {
      return div().text_size(11.5).text_color(t.dim).child(busy === "worktree" ? "Making the worktree…" : "Starting…");
    }
    if (a?.live) {
      return h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted).when(inline, (el) => el.justify_end())
        .child(div().size(7).flex_none().rounded_full().bg(a.status ? (t[a.status] ?? t.unknown) : t.unknown))
        .child(div().when(!inline, (el) => el.flex_1()).min_w(0).truncate().child(`${a.name} · ${a.status ? STATUS_WORD[a.status] ?? a.status : "running"}`))
        .child(small(`go-${task.id}`, "Go to", () => run("agent.focus", { terminal: task.terminal }), "Show this task's agent"));
    }
    if (last) return null;
    // A list row has room for the buttons only: "Agent ended" goes into Start's tooltip there.
    const ended = a && !a.live;
    const where = task.treeThere ? `in its worktree${task.branch ? ` (${task.branch})` : ""}` : `in ${task.folder || "the workspace root"}`;
    return h_flex().gap(6).items_center().when(!inline, (el) => el.flex_wrap()).when(inline, (el) => el.justify_end())
      .when(ended && !inline, (el) => el.child(div().w_full().text_size(11.5).text_color(t.dim).child("Agent ended")))
      .child(small(`start-${task.id}`, "Start", (cx, shift) => this.start(task, false, cx, null, shift), `${ended && inline ? "Its agent ended. " : ""}Run ${task.agent || b.agent} on it ${where}. Shift-click starts it and stays on the board.`))
      .child(small(`wt-${task.id}`, !inline && this.colWidth >= WIDE_COLUMN ? "Start in worktree" : "Worktree", (cx, shift) => this.start(task, true, cx, null, shift), "Run it on a new branch in its own worktree"))
      .child(small(`sw-${task.id}`, "Start with…", () => this.openStartWith(task), "Pick the agent, the folder and the first message, then start it"));
  }

  // The task's pull request, as the switcher reads it from GitHub (shared
  // "workspaces.prs"): one status and its number. A click opens it. In a list
  // row both sit in one chip. On a card the number follows the chip, and wraps
  // out of sight when the card is too narrow for both.
  prChip(task, t, inline) {
    const pr = (shared("workspaces.prs") ?? {})[task.file];
    if (!pr) return null;
    // Its pr: line couldn't be read yet (gh missing, signed out, no GitHub remote, not a pull
    // request's link): the icon with "?" and the reason, no click.
    if (pr.unread) {
      return h_flex().child(h_flex().id(`pr-${task.id}`).flex_none().h(20).px(6).gap(5).items_center().rounded(5).bg(t.raised)
        .text_size(11).text_color(t.muted).tooltip(pr.tip || "This pull request couldn't be read")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => cx.stop_propagation())
        .child(svg("mods/ws-board/pr.svg").size(11).flex_none()).child("?"));
    }
    const opens = (el) => el.cursor_pointer().tooltip(pr.tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        openLink(pr.url);
      });
    const number = () => div().flex_none().text_color(t.muted).child(`#${pr.number}`);
    const status = pr.label ? div().text_color(t[pr.tone] ?? t.muted).child(pr.label) : null;
    const chip = (kids) => opens(h_flex().id(`pr-${task.id}`).h(20).px(6).gap(5).items_center().rounded(5).bg(t.raised)
      .text_size(11).text_color(t.muted).hover((s) => s.bg(t.hover))
      .child(svg("mods/ws-board/pr.svg").size(11).flex_none())
      .children(kids));
    if (inline) return chip([number(), status?.flex_none()].filter(Boolean)).flex_none();
    if (!status) return h_flex().child(chip([number()]).flex_none());
    return h_flex().h(20).min_w(0).flex_wrap().items_start().overflow_hidden().gap(6)
      .child(chip([status.min_w(0).truncate()]).min_w(0).max_w_full())
      .child(opens(h_flex().id(`pr-number-${task.id}`).flex_none().h(20).items_center().text_size(11).child(number())));
  }

  card(task, col, b, t, ag, tm) {
    const last = col === b.columns[b.columns.length - 1];
    const pr = task.priority && PRIORITY[task.priority] ? task.priority : null;
    const prColor = pr === "high" ? t.blocked : pr === "medium" ? t.working : t.dim;
    const foot = this.agentArea(task, last, b, t, ag, tm, false);
    const pull = this.prChip(task, t, false);
    const hub = this.ghChip(task, t);

    return v_flex().id(`card-${task.id}`).flex_none().gap(7).p(10).rounded(8).bg(t.background).border_1().border_color(t.border)
      .cursor_pointer().hover((s) => s.border_color(t.input))
      .when(this.drag?.id === task.id && this.drag.moved, (el) => el.opacity(0.4))
      .on_mouse_down("left", () => { this.drag = { id: task.id, from: col, moved: false }; this.over = col; })
      .on_click(() => { if (Date.now() - this.dropped > 300 && !this.dialogJustClosed()) this.openTask(task); })
      .child(h_flex().gap(6).flex_wrap().items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().child(task.id))
        .when(Boolean(task.folder), (el) => el.child(div().flex_none().px(6).rounded(4).bg(t.raised).child(base(task.folder))))
        .when(Boolean(task.branch), (el) => el.child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none()))
        .when(Boolean(task.agent), (el) => el.child(div().flex_none().child(task.agent)))
        .child(div().flex_1())
        .when(Boolean(pr), (el) => el.child(div().flex_none().text_color(prColor).child(pr))))
      .child(div().text_size(13).text_color(t.foreground).child(task.title))
      .when(Boolean(hub), (el) => el.child(h_flex().min_w(0).child(hub.max_w_full())))
      .when(Boolean(pull), (el) => el.child(pull))
      .when(Boolean(foot), (el) => el.child(foot));
  }

  // --- the GitHub view: the workspace's GitHub project board, read with your gh login ---
  // Nothing here writes to GitHub. Take makes a card on this board from an item.

  initGithub(cx) {
    this.ghReset();
    if (checking()) return;
    cx.timer.every(2000, (cx) => this.ghBeat(cx));
  }

  // The view's state for the board's workspace, as it opens.
  ghReset() {
    const who = this.pref("gh.who");
    let folds = {};
    try { folds = JSON.parse(this.pref("gh.folds") ?? "{}") ?? {}; } catch {}
    this.gh = {
      board: null, link: null, at: 0, tried: 0, drawn: 0, loading: false, opening: false, error: null,
      who: ["all", "mine", "none"].includes(who) ? who : "all", repo: this.pref("gh.repo") ?? "", folds,
      view: ["list", "board"].includes(this.pref("gh.view")) ? this.pref("gh.view") : null,
      order: ORDERS.some(([o]) => o === this.pref("gh.order")) ? this.pref("gh.order") : "board",
      taking: {}, all: {}, folders: null, foldersKey: null,
      found: null, finding: false, linking: false, linkError: null, relink: false, pending: null, pendingAt: 0,
    };
    this.ghSearch = InputState.new({ value: "", placeholder: "Search issues" });
    this.ghSearch.on("change", (_e, cx) => cx.notify());
    this.ghLink = InputState.new({ value: "", placeholder: "https://github.com/orgs/acme/projects/1" });
    this.ghLink.on("change", (_e, cx) => { if (this.gh.linkError) { this.gh.linkError = null; cx.notify(); } });
    this.ghLink.on("submit", (_e, cx) => this.linkBoard(this.ghLink.value(), cx));
  }

  // The board the view shows: the workspace's, or the one just linked (until its file is read again).
  ghRef(def) {
    const g = this.gh;
    if (g.relink) return null;
    return parseBoard(def?.board?.github) ?? (g.pending ? parseBoard(g.pending) : null);
  }

  // Every 2s while the view is the GitHub one: a newly shown board is opened (from
  // its kept copy when there is one), one read more than 10 minutes ago is read
  // again, and "Read 3m ago" keeps moving.
  ghBeat(cx) {
    this.addedAsked(cx);
    if (this.source !== "github") return;
    // The screen stays in the layout once shown: it asks GitHub nothing while it isn't the one shown.
    const scr = this.follow ? shared("workspaces.screen") : null;
    if (this.follow && !(scr?.screen === "board" && scr.ws === this.workspace)) return;
    const def = defOf(this.workspace);
    if (!def) return;
    const g = this.gh, now = Date.now();
    const saved = parseBoard(def.board?.github);
    if (g.pending && (saved?.url === g.pending || now - g.pendingAt > 15000)) { g.pending = null; cx.notify(); }
    const ref = saved ?? (g.pending ? parseBoard(g.pending) : null);
    if (!ref) { if (!g.found && !g.finding) this.findBoards(def, cx); return; }
    if (g.loading || g.opening) return;
    if (g.link !== ref.url) { g.board = null; g.error = null; g.link = ref.url; g.at = 0; g.tried = 0; g.all = {}; this.openGithub(ref, cx); return; }
    if (now - g.tried > FRESH) { this.openGithub(ref, cx); return; }
    if (now - g.drawn > 60e3) { g.drawn = now; cx.notify(); }
  }

  setSource(source, cx) {
    this.source = source;
    this.keep("source", source);
    this.ghBeat(cx);
    cx.notify();
  }

  // Which of the workspace's folders is each GitHub repo: by its origin remote.
  async repoFolders(def) {
    const g = this.gh, places = [...folderChoices(def), def.root].filter(Boolean);
    const key = places.join("|");
    if (g.folders && g.foldersKey === key) return g.folders;
    const map = {};
    for (const f of places) {
      const r = await exec("git", ["-C", f, "remote", "get-url", "origin"], { timeout: 10000 }).catch(() => null);
      const repo = r?.code === 0 ? repoOfRemote(r.stdout) : null;
      if (repo && !(repo in map)) map[repo] = rel(def, f);
    }
    g.folders = map;
    g.foldersKey = key;
    return map;
  }

  // The card's folder for an item: its repo's folder here, else one of the same name.
  folderOf(def, item) {
    if (!item.repo) return "";
    const known = this.gh.folders?.[item.repo];
    if (known !== undefined) return known;
    const same = folderChoices(def).find((f) => base(f) === shortRepo(item.repo));
    return same ? rel(def, same) : "";
  }

  // The board from its kept copy when that's newer than what's shown: any board tab's
  // read counts, also one from before Herdr restarted. GitHub is read only when the
  // newest copy is older than 10 minutes (it's shown meanwhile), or there is none.
  openGithub(ref, cx) {
    const g = this.gh;
    if (g.opening || g.loading) return;
    g.opening = true;
    cx.spawn(async (cx) => {
      let kept = null;
      try { kept = keptBoard(await readTextFile(keptFile(ref)), ref.url, Date.now()); } catch {}
      g.opening = false;
      if (g.link !== ref.url) return;
      if (kept && kept.at > g.at) {
        Object.assign(g, { board: kept.board, at: kept.at, tried: Math.max(g.tried, kept.at), drawn: Date.now(), error: null });
        cx.notify();
      }
      if (Date.now() - g.tried > FRESH) this.readGithub(ref, cx);
    });
  }

  readGithub(ref, cx) {
    const def = defOf(this.workspace), g = this.gh;
    if (!def || !ref || g.loading) return;
    g.loading = true;
    g.tried = Date.now();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.repoFolders(def).catch(() => {});
        const pages = [];
        let after = null;
        for (let i = 0; i < 30; i++) {
          const args = ["api", "graphql", "-f", `query=${BOARD_QUERY}`, "-f", `owner=${ref.owner}`, "-F", `number=${ref.number}`, ...(after ? ["-f", `after=${after}`] : [])];
          let r;
          try { r = await exec("gh", args, { timeout: 60000 }); }
          catch (x) { r = { code: 1, stdout: "", stderr: /start|not found|ENOENT/i.test(message(x)) ? "gh isn't installed" : message(x) }; }
          let page = null;
          try { page = JSON.parse(r.stdout); } catch {}
          const project = page?.data?.repositoryOwner?.projectV2;
          if (!project) {
            if (page?.data && !page.errors?.length) throw new Error("GitHub has no such board, or your gh login can't see it.");
            throw new Error(ghError(r.stderr || page?.errors?.[0]?.message || r.stdout));
          }
          pages.push(page);
          if (!project.items?.pageInfo?.hasNextPage) break;
          after = project.items.pageInfo.endCursor;
        }
        const board = boardFrom(pages);
        if (board.error) throw new Error(board.error);
        if (g.link === ref.url) { g.board = board; g.at = Date.now(); g.drawn = g.at; g.error = null; }
        // Kept for the next time the view opens. A write names the text it replaces: twice, for another board tab's write in between.
        const file = keptFile(ref), text = keptText(board, ref.url, Date.now());
        for (let n = 0; n < 2; n++) {
          try { await writeTextFile(file, text, await readTextFile(file)); break; } catch {}
        }
      } catch (e) {
        // A failed read is tried again after 5 minutes, not 10.
        if (g.link === ref.url) { g.error = message(e); g.tried = Date.now() - FRESH / 2; }
      }
      g.loading = false;
      cx.notify();
    });
  }

  // For the link screen: the open boards of the owners of this workspace's repos.
  findBoards(def, cx) {
    const g = this.gh;
    if (g.finding) return;
    g.finding = true;
    cx.spawn(async (cx) => {
      const found = [];
      try {
        const map = await this.repoFolders(def);
        const owners = [...new Set(Object.keys(map).map((r) => r.split("/")[0]))].filter((o) => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(o)).slice(0, 4);
        for (const o of owners) {
          const r = await exec("gh", ["project", "list", "--owner", o, "--format", "json", "--limit", "30"], { timeout: 30000 }).catch(() => null);
          let list = [];
          try { list = JSON.parse(r.stdout).projects ?? []; } catch {}
          for (const p of list) {
            const ref = parseBoard(p.url);
            if (ref && !p.closed) found.push({ title: String(p.title ?? `#${p.number}`), url: ref.url, owner: o });
          }
        }
      } catch {}
      g.found = found.slice(0, 12);
      g.finding = false;
      cx.notify();
    });
  }

  // Saves the board's link as "board": { "github": … } in the workspace's file.
  linkBoard(link, cx) {
    const def = defOf(this.workspace), g = this.gh, ref = parseBoard(link);
    if (!def || g.linking) return;
    if (!ref) {
      g.linkError = "That isn't a GitHub project board's link. One looks like https://github.com/orgs/acme/projects/1.";
      cx.notify();
      return;
    }
    g.linking = true;
    g.linkError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const file = `${def.dir}/workspace.jsonc`;
        for (let i = 0; ; i++) {
          const old = await readTextFile(file);
          if (old === null) throw new Error("its workspace.jsonc is gone");
          try { await writeTextFile(file, withBoardLink(old, ref.url), old); break; }
          catch (e) { if (i >= 2) throw e; }
        }
        g.pending = ref.url;
        g.pendingAt = Date.now();
        g.relink = false;
      } catch (e) {
        g.linkError = `Couldn't save the link: ${message(e)}`;
      }
      g.linking = false;
      this.ghBeat(cx);
      cx.notify();
    });
  }

  // A card on this board from a GitHub item: its text is read now, and the card
  // keeps the item's link, which the switcher follows from then on (ghboard.js).
  take(item, cx) {
    const def = defOf(this.workspace), g = this.gh;
    if (!def || g.taking[item.item] || taskOf(item, this.tasks)) return;
    g.taking[item.item] = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const b = boardOf(def);
        const query = itemsQuery([item.item], true);
        let r;
        try { r = await exec("gh", ["api", "graphql", "-f", `query=${query}`], { timeout: 60000 }); }
        catch (x) { r = { code: 1, stdout: "", stderr: /start|not found|ENOENT/i.test(message(x)) ? "gh isn't installed" : message(x) }; }
        let nodes = null;
        try { nodes = JSON.parse(r.stdout)?.data?.nodes ?? null; } catch {}
        if (!Array.isArray(nodes)) throw new Error(ghError(r.stderr || r.stdout));
        const got = shape(nodes[0]);
        if (!got) throw new Error("It isn't on the GitHub board any more. Refresh to see the board as it is now.");
        if (taskOf(got, await loadTasks(def.id))) return;
        const f = taskFields(got);
        for (let i = 0; ; i++) {
          const id = await nextId(def.id, b.prefix);
          const text = withFields("---\n---\n", {
            id, title: f.title, status: takeColumn(b.columns), folder: this.folderOf(def, got), priority: f.priority, created: today(),
            github: f.github, github_item: f.github_item,
          }, taskBody(got));
          try {
            await writeTextFile(`${tasksDir(def.id)}/${id}.md`, text, null);
            notify({ title: `Took ${refOf(got)} as ${id}`, body: `${got.title}. Its card is in ${label(takeColumn(b.columns))} on your board; nothing changed on GitHub.`, level: "success" });
            break;
          } catch (e) { if (i >= 2) throw e; } // the ID was just taken: the next one
        }
        this.tasks = await loadTasks(def.id);
      } catch (e) {
        notify({ title: `Couldn't take ${refOf(item)}`, body: message(e), level: "error" });
      } finally {
        delete g.taking[item.item];
        cx.notify();
      }
    });
  }

  // Tasks | GitHub, as two segments.
  sourceToggle(t) {
    const segment = (source, text) => h_flex().id(`source-${source}`).h(26).px(10).items_center().rounded(6).cursor_pointer()
      .text_size(12).when(this.source === source, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(this.source !== source, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => this.setSource(source, cx)).child(text);
    return h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border).bg(t.chrome)
      .child(segment("tasks", "Tasks")).child(segment("github", "GitHub"));
  }

  ghButton(t, id, text, action, tip) {
    return div().id(id).h(26).px(10).flex().flex_none().items_center().rounded(7).border_1().border_color(t.input)
      .text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);
  }

  // The header's right side in the GitHub view: when it was read, Refresh, Open, Change board.
  ghTools(def, t) {
    const g = this.gh, ref = this.ghRef(def);
    if (!ref) return [];
    return [
      this.viewToggle(t, true),
      g.loading
        ? h_flex().flex_none().gap(6).items_center().text_size(11.5).text_color(t.dim)
          .child(svg("mods/workspace-chrome/spinner.svg").size(13).spin(900)).child("Reading…")
        : div().flex_none().text_size(11.5).text_color(t.dim).child(g.at ? `Read ${ago(g.at, Date.now())}` : ""),
      this.ghButton(t, "gh-refresh", "Refresh", (cx) => this.readGithub(ref, cx), "Read the board from GitHub now. Otherwise it's read again 10 minutes after the last read."),
      this.ghButton(t, "gh-open", "Open on GitHub", () => openLink(ref.url), ref.url),
      this.ghButton(t, "gh-change", "Change board", (cx) => { g.relink = true; g.found = null; this.ghLink.set_value(ref.url); this.findBoards(def, cx); cx.notify(); }, "Show another GitHub board here"),
    ];
  }

  github(def, b, t) {
    const g = this.gh, ref = this.ghRef(def);
    const middle = () => v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(24);
    if (!ref) return this.linkScreen(def, t);
    if (!g.board) {
      if (g.error) {
        return middle()
          .child(div().text_size(13).text_color(t.foreground).child("Couldn't read the board"))
          .child(div().max_w(520).text_size(12).text_color(t.muted).child(g.error))
          .child(this.ghButton(t, "gh-again", "Try again", (cx) => this.readGithub(ref, cx)));
      }
      return middle().child(h_flex().gap(8).items_center().text_size(12.5).text_color(t.dim)
        .child(svg("mods/workspace-chrome/spinner.svg").size(14).spin(900)).child("Reading the board from GitHub…"));
    }
    const board = g.board, me = board.me;
    const { repos, drafts } = reposOf(board.items);
    const repo = g.repo === "draft" ? (drafts ? "draft" : "") : repos.includes(g.repo) ? g.repo : "";
    const shown = sortItems(filterItems(board.items, { who: g.who, repo, text: this.ghSearch.value() }, me), g.order);
    const chip = (id, text, on, action) => div().id(id).h(24).px(9).flex().flex_none().items_center().rounded(12).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(11.5)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(text);
    const setWho = (who) => () => { g.who = who; this.keep("gh.who", who); };
    const setRepo = (value) => () => { g.repo = value; this.keep("gh.repo", value); };
    const setOrder = (value) => () => { g.order = value; this.keep("gh.order", value); };
    const choices = repos.length + (drafts ? 1 : 0) > 1;
    const bar = h_flex().min_h(44).py(8).flex_none().flex_wrap().px(16).gap(6).items_center().border_b(1).border_color(t.border)
      .child(chip("gh-who-all", "Everyone", g.who === "all", setWho("all")))
      .child(chip("gh-who-mine", "Mine", g.who === "mine", setWho("mine")))
      .child(chip("gh-who-none", "Unassigned", g.who === "none", setWho("none")))
      .when(choices, (el) => el
        .child(div().w(1).h(16).mx(4).flex_none().bg(t.border))
        .child(chip("gh-repo-all", "All repos", repo === "", setRepo("")))
        .children(repos.slice(0, 6).map((r) => chip(`gh-repo-${r}`, shortRepo(r), repo === r, setRepo(r))))
        .when(drafts, (el) => el.child(chip("gh-repo-draft", "Drafts", repo === "draft", setRepo("draft")))))
      .child(div().w(1).h(16).mx(4).flex_none().bg(t.border))
      .children(ORDERS.map(([value, text]) => chip(`gh-order-${value}`, text, g.order === value, setOrder(value))))
      .child(div().flex_1())
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(shown.length === board.items.length ? `${shown.length} items` : `${shown.length} of ${board.items.length}`))
      // As Files' filter: an × while it holds text, and Esc in it empties it.
      .child(h_flex().id("gh-search").w(200).h(28).flex_none().px(8).gap(6).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .on_key_down((e, cx) => { if (e.key === "escape" && this.ghSearch.value()) { this.ghSearch.set_value(""); cx.stop_propagation(); cx.notify(); } })
        .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
        .child(Input.new(this.ghSearch).flex_1().min_w(0).text_size(12).text_color(t.foreground))
        .when(Boolean(this.ghSearch.value()), (el) => el.child(div().id("gh-search-x").flex_none().cursor_pointer().text_color(t.dim).hover((x) => x.text_color(t.foreground))
          .tooltip("Clear the search").on_click((_e, cx) => { this.ghSearch.set_value(""); cx.notify(); }).child(svg("mods/workspace-chrome/x.svg").size(12)))));
    const cols = columnsOf(board, shown);
    return v_flex().flex_1().min_h(0)
      .child(bar)
      .when(Boolean(g.error), (el) => el.child(div().px(16).py(6).flex_none().text_size(11.5).text_color(t.blocked).child(`Couldn't read it again: ${g.error} Showing what was read ${ago(g.at, Date.now())}.`)))
      .child(this.shownView(true) === "list"
        ? this.ghList(cols, b, t, me)
        : h_flex().id("gh-columns").flex_1().min_h(0).items_stretch().p(12).gap(10).overflow_x_scrollbar().children(cols.map((c) => this.ghColumn(c, b, t, me))));
  }

  // Finished columns (Done, Canceled, …) start folded, in the columns and in the list alike.
  ghFolded(name) {
    const f = this.gh.folds;
    return name in f ? f[name] === true : doneLike(name);
  }

  ghFold(name, cx) {
    const g = this.gh;
    g.folds = { ...g.folds, [name]: !this.ghFolded(name) };
    this.keep("gh.folds", JSON.stringify(g.folds));
    cx.notify();
  }

  // What an item offers on the right: Take, or the card it already is (a click opens the card).
  ghAction(i, task, b, t) {
    if (task) {
      return div().id(`gh-card-${i.item}`).h(22).px(8).flex().flex_none().items_center().rounded(6).bg(t.selected)
        .text_size(11.5).text_color(t.foreground).cursor_pointer().hover((s) => s.opacity(0.85)).when(true, (el) => this.tip(el, `gh-card-${i.item}`, "On your board: open its card"))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); this.tipClicked(`gh-card-${i.item}`, cx); this.openTask(task); })
        .child(`${task.id} · ${label(b.columns.includes(task.status) ? task.status : b.columns[0])}`);
    }
    if (this.gh.taking[i.item]) return div().flex_none().text_size(11.5).text_color(t.dim).child("Taking…");
    return this.ghButton(t, `gh-take-${i.item}`, "Take", (cx) => this.take(i, cx), "Make a card for it on your board. Nothing changes on GitHub.").h(24).px(9).text_size(11.5);
  }

  // The list: a section per column of the GitHub board (a click on its header folds it), a row per item.
  ghList(cols, b, t, me) {
    const g = this.gh, now = Date.now(), LIMIT = 60;
    const rows = cols.flatMap((c) => {
      const shut = this.ghFolded(c.name);
      const head = h_flex().id(`ghsec-${c.name}`).h(34).flex_none().pl(14).pr(8).gap(8).items_center().cursor_pointer()
        .bg(t.chrome).border_b(1).border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.ghFold(c.name, cx))
        .child(svg(`mods/workspace-chrome/chevron-${shut ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(c.name))
        .child(div().text_size(11.5).text_color(t.dim).child(String(c.items.length)));
      if (shut) return [head];
      const all = g.all[c.name] === true || c.items.length <= LIMIT;
      const more = all ? [] : [div().id(`ghsec-more-${c.name}`).h(34).flex().flex_none().items_center().pl(36).border_b(1).border_color(t.border)
        .text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { g.all[c.name] = true; cx.notify(); }).child(`Show all ${c.items.length}`)];
      return [head, ...(all ? c.items : c.items.slice(0, LIMIT)).map((i) => this.ghRow(i, b, t, me, now)), ...more];
    });
    return v_flex().id("gh-list").flex_1().min_h(0).overflow_y_scrollbar().children(rows);
  }

  // One item as a row: where it is, its title, its pull request, priority, who has it, how long ago it was opened, Take.
  ghRow(i, b, t, me, now) {
    const shut = i.state === "closed" || i.state === "merged";
    const rankColor = i.priority === "high" ? t.blocked : i.priority === "medium" ? t.working : t.dim;
    return h_flex().id(`ghrow-${i.item}`).h(40).flex_none().pl(36).pr(12).gap(12).items_center().border_b(1).border_color(t.border)
      .when(Boolean(i.url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openLink(i.url)))
      .child(div().w(104).flex_none().truncate().text_size(11.5).text_color(t.dim).tooltip(refOf(i)).child(refOf(i)))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(shut ? t.muted : t.foreground).tooltip(i.title).child(i.title))
      // The pull request's mark opens the pull request; the rest of the row opens the issue.
      .when(i.prs.length > 0, (el) => el.child(h_flex().id(`ghpr-${i.item}`).flex_none().gap(3).items_center().text_size(11).text_color(t.dim)
        .tooltip(`Pull request #${i.prs[0]?.number} (${i.prs[0]?.state})${opensLink(i.prs[0]?.url) ? " · click opens it" : ""}`)
        .when(opensLink(i.prs[0]?.url), (x) => x.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); openLink(i.prs[0].url); }))
        .child(svg("mods/ws-board/pr.svg").size(11)).child(`#${i.prs[0]?.number}`)))
      .child(div().w(52).flex_none().truncate().text_size(11.5).text_color(rankColor).child(i.rank ?? ""))
      .child(div().w(120).flex_none().truncate().text_size(11.5).text_color(t.dim).when(Boolean(whoOf(i, me)), (el) => el.tooltip(whoOf(i, me))).child(whoOf(i, me)))
      .child(div().w(48).flex_none().text_size(11.5).text_color(t.dim)
        .when(Boolean(i.created), (el) => el.tooltip(`Opened ${String(i.created).slice(0, 10)}`)).child(age(i.created, now)))
      .child(h_flex().w(124).flex_none().justify_end().child(this.ghAction(i, taskOf(i, this.tasks), b, t)));
  }

  // A column of the GitHub board. Finished ones (Done, Canceled, …) start folded to a strip.
  ghColumn(c, b, t, me) {
    const g = this.gh;
    const folded = this.ghFolded(c.name);
    const fold = (_e, cx) => this.ghFold(c.name, cx);
    if (folded) {
      return v_flex().id(`ghcol-${c.name}`).w(96).flex_none().min_h(0).rounded(10).bg(t.chrome).border_1().border_color(t.border)
        .p(10).gap(4).cursor_pointer().hover((s) => s.border_color(t.input)).tooltip(`Show ${c.name}`).on_click(fold)
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(c.name))
        .child(div().text_size(11.5).text_color(t.dim).child(String(c.items.length)));
    }
    const LIMIT = 60;
    const all = g.all[c.name] === true || c.items.length <= LIMIT;
    const items = all ? c.items : c.items.slice(0, LIMIT);
    return v_flex().id(`ghcol-${c.name}`).w(288).flex_none().min_h(0).rounded(10).bg(t.chrome).border_1().border_color(t.border)
      .child(h_flex().id(`ghcol-head-${c.name}`).h(38).flex_none().px(12).gap(6).items_center().cursor_pointer().tooltip("Fold this column").on_click(fold)
        .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(t.muted).child(c.name))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(c.items.length))))
      .child(v_flex().id(`ghcol-list-${c.name}`).flex_1().min_h(0).px(8).pb(8).gap(8).overflow_y_scrollbar()
        .children(items.map((i) => this.ghCard(i, b, t, me)))
        .when(!all, (el) => el.child(div().id(`ghcol-more-${c.name}`).flex_none().px(4).py(6).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { g.all[c.name] = true; cx.notify(); })
          .child(`Show all ${c.items.length}`)))
        .when(!c.items.length, (el) => el.child(div().px(4).py(6).text_size(12).text_color(t.dim).child("Empty"))));
  }

  // One item of the GitHub board: a click opens it on GitHub, Take puts it on your
  // board, and one already taken shows its card (a click opens the card).
  ghCard(i, b, t, me) {
    const g = this.gh;
    const task = taskOf(i, this.tasks);
    const shut = i.state === "closed" || i.state === "merged";
    const rankColor = i.priority === "high" ? t.blocked : i.priority === "medium" ? t.working : t.dim;
    return v_flex().id(`gh-${i.item}`).flex_none().gap(6).p(10).rounded(8).bg(t.background).border_1().border_color(task ? t.accent : t.border)
      .when(Boolean(i.url), (el) => el.cursor_pointer().hover((s) => s.border_color(task ? t.accent : t.input)).on_click(() => openLink(i.url)))
      .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(div().min_w(0).truncate().tooltip(refOf(i)).child(refOf(i)))
        .when(Boolean(i.rank), (el) => el.child(div().flex_none().text_color(rankColor).child(i.rank)))
        .when(shut, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).child(i.state)))
        .when(g.order !== "board" && Boolean(i.created), (el) => el.child(div().flex_none().tooltip(`Opened ${String(i.created).slice(0, 10)}`).child(age(i.created, Date.now()))))
        .child(div().flex_1())
        .when(i.prs.length > 0, (el) => el.child(h_flex().id(`ghcpr-${i.item}`).flex_none().gap(3).items_center()
          .tooltip(`Pull request #${i.prs[0].number} (${i.prs[0].state})${opensLink(i.prs[0].url) ? " · click opens it" : ""}`)
          .when(opensLink(i.prs[0].url), (x) => x.cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); openLink(i.prs[0].url); }))
          .child(svg("mods/ws-board/pr.svg").size(11)).child(`#${i.prs[0].number}`))))
      .child(div().text_size(13).text_color(shut ? t.muted : t.foreground).child(i.title))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).when(Boolean(whoOf(i, me)), (el) => el.tooltip(whoOf(i, me))).child(whoOf(i, me)))
        .child(this.ghAction(i, task, b, t)));
  }

  // No board yet (or Change board): paste its link, or pick one of your repos' owners' boards.
  linkScreen(def, t) {
    const g = this.gh;
    const button = (id, text, primary, action) => h_flex().id(id).h(34).px(14).flex_none().items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12.5).font_medium().cursor_pointer().when(g.linking, (el) => el.opacity(0.5)).hover((s) => s.opacity(0.88))
      .on_click(action).child(text);
    return v_flex().flex_1().min_h(0).items_center().justify_center().px(24)
      .child(v_flex().w(560).max_w_full().gap(10)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Show a GitHub project board here"))
        .child(div().text_size(12.5).text_color(t.muted).child(`Paste the board's link. Herdr reads it with your gh login and changes nothing on GitHub. Take then puts any issue on your ${def.name} board.`))
        .child(h_flex().gap(8).items_center()
          .child(Input.new(this.ghLink).flex_1().min_w(0).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
          .child(button("gh-link", g.linking ? "Linking…" : "Link board", true, (_e, cx) => this.linkBoard(this.ghLink.value(), cx)))
          .when(g.relink, (el) => el.child(button("gh-link-cancel", "Cancel", false, (_e, cx) => { g.relink = false; g.linkError = null; cx.notify(); }))))
        .when(Boolean(g.linkError), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(g.linkError)))
        .when(Boolean(g.found?.length), (el) => el
          .child(div().pt(8).text_size(11.5).text_color(t.dim).child("Or pick one: the boards of your repos' owners"))
          .child(h_flex().gap(6).flex_wrap().children((g.found ?? []).map((f, n) => div().id(`gh-found-${n}`).h(26).px(10).flex().items_center().rounded(13).border_1()
            .border_color(t.input).bg(t.background).text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .tooltip(f.url).on_click((_e, cx) => this.linkBoard(f.url, cx)).child(`${f.title} · ${f.owner}`)))))
        .when(g.finding, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.dim).child("Looking for your repos' boards…")))
        .child(div().pt(8).text_size(11).text_color(t.dim).child(`Saved as "board": { "github": … } in ${tilde(def.dir)}/workspace.jsonc.`)));
  }

  // The card's GitHub item, as the switcher reads it (shared "workspaces.github"):
  // its number and its status on the GitHub board. A click opens it.
  ghChip(task, t) {
    if (!task.github && !task.github_item) return null;
    const live = (shared("workspaces.github") ?? {})[task.file];
    const number = live?.number ?? (/\/(?:issues|pull)\/(\d+)/.exec(task.github ?? "")?.[1] ?? null);
    const url = live?.url ?? task.github ?? null;
    const tone = live?.tone === "done" ? t.done : live?.tone === "dim" ? t.dim : t.muted;
    return h_flex().id(`gh-chip-${task.id}`).h(20).px(6).gap(5).flex_none().items_center().rounded(5).bg(t.raised)
      .text_size(11).text_color(t.muted).tooltip(live?.tip ?? "From the GitHub board. Its status shows here once it's been read.")
      .when(Boolean(url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); openLink(url); }))
      .child(svg("mods/ws-board/issue.svg").size(11).flex_none())
      .child(div().flex_none().child(number ? `#${number}` : "Draft"))
      .when(Boolean(live?.label), (el) => el.child(div().min_w(0).truncate().text_color(tone).child(live.label)));
  }

  // --- the task dialog ---

  initDialog(cx) {
    const p = props();
    if (p.dialog === "start") return this.initStartWith(cx);
    const task = p.task;
    const def = defOf(p.workspace);
    const b = boardOf(def);
    this.form = {
      status: task?.status && b.columns.includes(task.status) ? task.status : (p.status ?? b.columns[0]),
      folder: task?.folder ?? "",
      priority: task?.priority ?? "",
      agent: task?.agent ?? "",
    };
    this.titleInput = InputState.new({ value: task?.title ?? "", placeholder: "What needs doing" });
    this.bodyInput = TextareaState.new({ value: task?.body ?? "", rows: 9, placeholder: "Details, acceptance criteria, links. Agents get this as the task." });
    this.formAt = { ...this.form };
    // What the fields held as the dialog opened: "changed" is against these, not the file's text.
    this.titleAt = this.titleInput.value();
    this.bodyAt = this.bodyInput.value();
    this.escAsked = false;
    this.titleInput.on("submit", (_e, cx) => this.save(cx));
    this.titleInput.on("change", (_e, cx) => { this.unask(cx); this.disarm(cx); });
    this.bodyInput.on("change", (_e, cx) => { this.unask(cx); this.disarm(cx); });
    // ⌘/Ctrl+Enter in the notes saves (a plain Enter is a line break there).
    this.bodyInput.on("submit", (e, cx) => { if (!e?.secondary) return; dropEnterBreak(this.bodyInput); this.save(cx); });
    // The installed agents for the Agent chips: the + menu's last list at once, then asked again.
    this.tdAgents = shared("new-menu.agents")?.[""] ?? [];
    cx.spawn(async (cx) => {
      const known = await knownAgents().catch(() => null);
      if (known) { this.tdAgents = known; cx.notify(); }
    });
    this.titleInput.focus();
    cx.timer.after(400, () => this.titleInput.focus());
    this.handle.focus();
  }

  // Esc and the Close × of both dialogs (`via`: "esc" or "x"): at once when nothing typed or
  // changed would be lost, else the first one asks (ASK_AGAIN on the dialog's own line) and the
  // second, either of them, closes.
  guardedClose(changed, cx, via) {
    if (this.busy) return; // saving or deleting: it closes by itself when that's done
    if (changed && !this.escAsked) { this.escAsked = via; cx.notify(); return; }
    closeOverlay(props().overlay);
  }

  // Go to on the task dialog: shows the card's agent and closes the dialog; with something
  // typed, the first click asks on the dialog's line (as Esc and × do), the second goes.
  goTo(task, cx) {
    if (this.busy) return;
    if (this.taskChanged() && this.escAsked !== "go") { this.escAsked = "go"; this.goAskedAt = Date.now(); cx.notify(); return; }
    // The second half of a double-click isn't a yes.
    const d = Date.now() - (this.goAskedAt ?? 0);
    if (this.escAsked === "go" && d >= 0 && d < 500) return;
    run("agent.focus", { terminal: task.terminal });
    closeOverlay(props().overlay);
  }

  // Typing or a click anywhere else in the dialog: Esc asks again before dropping anything.
  unask(cx) {
    if (!this.escAsked) return;
    this.escAsked = false;
    cx.notify();
  }

  // The delete question (asked in the footer) goes when anything else is typed or clicked.
  disarm(cx) {
    if (!this.confirming || this.busy) return;
    this.confirming = false;
    cx.notify();
  }

  // The task dialog: something typed or picked that Save hasn't written.
  taskChanged() {
    return this.titleInput.value() !== this.titleAt || this.bodyInput.value() !== this.bodyAt
      || Object.keys(this.form).some((k) => this.form[k] !== this.formAt[k]);
  }

  // A dialog's Close ×, where its header said "Esc". Its press doesn't reach the dialog's
  // own (which resets the Esc guard), so a second click closes.
  closeX(t, id, action) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx))
      .child(svg("mods/workspace-chrome/x.svg").size(14));
  }

  // Either dialog once its workspace is gone: what happened, and the Close × (it's modal).
  goneDialog(t, id) {
    return v_flex().size_full().p(18).gap(10).bg(t.popover).text_color(t.muted)
      .child(h_flex().items_center().child(div().flex_1().child("This task's workspace is gone."))
        .child(this.closeX(t, id, () => closeOverlay(props().overlay))));
  }

  save(cx) {
    const p = props();
    const def = defOf(p.workspace);
    const title = this.titleInput.value().trim();
    if (!def || this.busy) return;
    this.confirming = false; // a key that saves takes the delete question back first
    if (!title) { this.error = "A task needs a title."; cx.notify(); return; }
    this.busy = true;
    cx.notify();
    const b = boardOf(def);
    const body = this.bodyInput.value();
    cx.spawn(async (cx) => {
      try {
        const old = p.task;
        if (old) {
          // Only what changed here, so an agent's edits in the meantime stay.
          const fields = {};
          if (title !== old.title) fields.title = title;
          if (this.form.status !== old.status) fields.status = this.form.status;
          if ((this.form.folder || null) !== (old.folder || null)) fields.folder = this.form.folder;
          if ((this.form.priority || null) !== (old.priority || null)) fields.priority = this.form.priority;
          if ((this.form.agent || null) !== (old.agent || null)) fields.agent = this.form.agent;
          const bodyChanged = body.trim() !== old.body;
          for (let i = 0; ; i++) {
            const text = await readTextFile(old.file);
            if (text === null) throw new Error("its file is gone");
            try { await writeTextFile(old.file, withFields(text, fields, bodyChanged ? body : undefined), text); break; }
            catch (e) { if (i >= 2) throw e; }
          }
        } else {
          let id = null;
          for (let i = 0; ; i++) {
            id = await nextId(def.id, b.prefix);
            const text = withFields("---\n---\n", {
              id, title, status: this.form.status, folder: this.form.folder, priority: this.form.priority, agent: this.form.agent, created: today(),
            }, body);
            try { await writeTextFile(`${tasksDir(def.id)}/${id}.md`, text, null); break; }
            catch (e) { if (i >= 2) throw e; } // the ID was just taken: the next one
          }
          // The board's search mustn't hide the card just added (addedAsked()).
          setShared("workspaces.board.added", { ws: def.id, id, at: Date.now() });
        }
        setShared("workspaces.board.closed", Date.now());
        closeOverlay(p.overlay);
      } catch (e) {
        this.error = `Couldn't save: ${message(e)}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  remove(cx) {
    const p = props();
    if (!p.task || this.busy) return;
    if (!this.confirming) { this.confirming = true; this.confirmAt = Date.now(); this.escAsked = false; cx.notify(); return; }
    if (Date.now() - this.confirmAt < 500) return; // the second half of a double-click isn't a yes
    this.busy = true;
    this.deleting = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", TRASH, "sh", p.task.file, `${workspacesDir()}/.trash`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        const where = r.stdout.trim();
        notify({ title: `Deleted ${p.task.id}`, body: where === "Trash" ? `Its file is in the ${trashName()}.` : `Its file is in ${tilde(where)}.`, level: "success" });
        setShared("workspaces.board.closed", Date.now());
        closeOverlay(p.overlay);
      } catch (e) {
        this.error = `Couldn't delete it: ${message(e)}`;
        this.busy = false;
        this.deleting = false;
        cx.notify();
      }
    });
  }

  dialog(t) {
    const p = props();
    if (p.dialog === "start") return this.startDialog(t);
    const def = defOf(p.workspace);
    const close = () => closeOverlay(p.overlay);
    if (!def) return this.goneDialog(t, "task-close");
    const b = boardOf(def);
    const mac = window()?.platform === "macos";
    const section = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const chip = (id, text, on, action) => div().id(id).h(26).px(10).flex().items_center().rounded(13).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(12)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { action(); cx.notify(); }).child(text);
    const button = (id, text, kind, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(kind === "primary" ? t.solid : t.input).bg(kind === "primary" ? t.solid : t.raised)
      .text_color(kind === "primary" ? t.solid_foreground : kind === "danger" ? t.blocked : t.foreground)
      .text_size(12.5).font_medium().cursor_pointer().when(this.busy, (el) => el.opacity(0.5)).hover((s) => s.opacity(0.88))
      .on_click(action).child(text);
    const folders = folderChips([["", "Workspace root"], ...folderChoices(def).map((f) => [rel(def, f), base(f)])], p.task?.folder ?? "", tilde, (v) => folderPath(def, v));
    const task = p.task;

    // Esc, and Cmd/Ctrl+W, reach a dialog as Herdr's actions, never as keys: claim them here.
    // A handler that returns without closing keeps the dialog open.
    // While Delete asks, Esc only drops the question.
    const onClose = (_e, cx) => { cx.stop_propagation(); if (this.confirming) this.disarm(cx); else this.guardedClose(this.taskChanged(), cx, "esc"); };
    // Delete asked once: the footer holds only the question (Cancel where Delete was, the
    // named delete beside it, where it goes); Save and the rest step aside.
    const armed = Boolean(task) && this.confirming;
    const pair = (id, action, el) => el.id(id).h(32).items_center().rounded(8).border_1().text_size(12.5).font_medium()
      .when(this.busy, (x) => x.opacity(0.45)).when(!this.busy, (x) => x.cursor_pointer().hover((s) => s.opacity(0.88)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { if (!this.busy && Date.now() - this.confirmAt >= 500) action(cx); });
    const named = task ? `Delete “${task.title}”` : "";
    // What the card is tied to, under its title: its live agent with Go to, its worktree and
    // its pull request, drawn as on the card (nothing when it has none of them).
    const live = task ? agentOf(task, agents(), terminals()) : null;
    const tree = task?.treeThere ? task.worktree : null;
    const pull = task ? this.prChip(task, t, true) : null;
    const ties = live?.live || tree || pull ? h_flex().pt(8).gap(8).flex_wrap().items_center().text_size(11.5)
      .when(Boolean(live?.live), (el) => el.child(h_flex().gap(6).items_center()
        .child(div().size(7).flex_none().rounded_full().bg(live.status ? (t[live.status] ?? t.unknown) : t.unknown))
        .child(div().text_color(t.muted).child(`${live.name} · ${live.status ? STATUS_WORD[live.status] ?? live.status : "running"}`))
        .child(div().id("task-goto").h(24).px(8).flex().flex_none().items_center().rounded(6).border_1().border_color(t.input)
          .text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { this.disarm(cx); this.goTo(task, cx); }).child("Go to"))))
      .when(Boolean(tree), (el) => el.child(h_flex().id("task-tree").flex_none().h(20).px(6).gap(5).items_center().rounded(5).bg(t.raised).text_color(t.muted)
        .tooltip(`${tilde(expand(tree))}${task.branch ? `, on ${task.branch}` : ""}`)
        .child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none())
        .child(String(tilde(expand(tree))).replace(/^~\/\.herdr\/worktrees\//, ""))))
      .when(Boolean(pull), (el) => el.child(pull)) : null;
    const question = () => [
      pair("task-delete-cancel", (cx) => { this.confirming = false; cx.notify(); },
        h_flex().flex_none().px(14).border_color(t.input).bg(t.raised).text_color(t.foreground).child("Cancel")),
      pair("task-delete-yes", (cx) => this.remove(cx),
        h_flex().min_w(0).max_w(320).px(13).border_color(t.blocked).bg(t.blocked).text_color(t.solid_foreground)
          .when(named.length > 40, (x) => x.tooltip(named))
          .child(div().min_w(0).truncate().child(this.deleting ? "Deleting…" : named))),
      div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(`It goes to the ${trashName()}.`),
    ];
    return v_flex().id("task-dialog").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      .on_action("overlay.close", onClose).on_action("tab.close", onClose).on_action("pane.close", onClose)
      .on_mouse_down("left", (_e, cx) => { this.unask(cx); this.disarm(cx); })
      .on_key_down((e, cx) => {
        this.disarm(cx); // any key drops the delete question
        // (Esc never arrives here: Herdr sends it as overlay.close, claimed above.)
        // ⌘Enter (Ctrl+Enter elsewhere) saves from anywhere, the notes too, as Start with… starts.
        if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control)) this.save(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(task ? `${task.id}` : `New task in ${def.name}`))
        .child(this.closeX(t, "task-close", (cx) => { this.disarm(cx); this.guardedClose(this.taskChanged(), cx, "x"); })))
      .when(Boolean(ties), (el) => el.child(ties))
      .child(section("Title"))
      .child(Input.new(this.titleInput).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(13).text_color(t.foreground))
      .child(section("Status"))
      .child(h_flex().gap(6).flex_wrap().children(b.columns.map((c) => chip(`st-${c}`, label(c), this.form.status === c, () => { this.form.status = c; }))))
      .child(section("Folder: where Start runs the agent"))
      .child(h_flex().gap(6).flex_wrap().children(folders.map(([value, name]) => chip(`fd-${value || "root"}`, name, this.form.folder === value || folderPath(def, this.form.folder) === folderPath(def, value), () => { this.form.folder = value; }))))
      .child(section("Priority"))
      .child(h_flex().gap(6).children([["", "None"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]
        .map(([value, name]) => chip(`pr-${value || "none"}`, name, this.form.priority === value, () => { this.form.priority = value; }))))
      .child(section(`Agent: who Start runs (default: ${b.agent})`))
      .child(h_flex().gap(6).flex_wrap().children(agentChips(presetsFor(def.id), this.tdAgents ?? [], p.task?.agent ?? "")
        .map(([value, name]) => chip(`ag-${value || "default"}`, name, this.form.agent === value, () => { this.form.agent = value; }))))
      .child(section("Notes"))
      .child(div().flex_1().min_h(0).child(Textarea.new(this.bodyInput).size_full().p(8).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(Boolean(this.error || this.escAsked), (el) => el.child(div().pt(8).text_size(11.5).text_color(this.escAsked ? t.working : t.blocked).child(this.escAsked ? ASK_AGAIN[this.escAsked] : this.error)))
      .when(armed, (el) => el.child(h_flex().pt(14).gap(8).items_center().children(question())))
      .when(!armed, (el) => el.child(h_flex().pt(14).gap(8).items_center()
        .when(Boolean(task), (el) => el.child(button("task-delete", "Delete", "danger", (_e, cx) => this.remove(cx))))
        .when(Boolean(task?.file), (el) => el.child(div().id("task-file").flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(tilde(task.file)).child(tilde(task.file))))
        .when(!task, (el) => el.child(div().flex_1()))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${mac ? "⌘" : "Ctrl+"}Enter saves`))
        // Like Esc and the ×: nothing while it saves or deletes (it closes by itself when done).
        .child(button("task-cancel", "Cancel", "plain", () => { if (!this.busy) close(); }))
        .child(button("task-save", task ? "Save" : "Add task", "primary", (_e, cx) => this.save(cx)))));
  }

  // --- Start with… (props { dialog: "start", workspace, task, owner }) ---

  initStartWith(cx) {
    const p = props();
    const def = defOf(p.workspace);
    const b = boardOf(def);
    // The installed agents: the + menu's last list at once, then asked again.
    // Until one is clicked, the pick is whoever the card's Start would run, found again
    // when the installed agents arrive (the card's agent may be one of them).
    this.swAgents = shared("new-menu.agents")?.[""] ?? [];
    this.swChosen = false;
    const who = p.task?.agent || b.agent;
    cx.spawn(async (cx) => {
      const known = await knownAgents().catch(() => null);
      if (known) {
        this.swAgents = known;
        if (!this.swChosen && def) this.swPick = firstPick(this.swChoices(), who);
        cx.notify();
      }
    });
    this.swPick = def ? firstPick(this.swChoices(), who) : null;
    // A card with its own worktree starts there unless another folder is picked.
    this.swFolder = def ? (p.task?.treeThere ? expand(p.task.worktree) : folderPath(def, p.task?.folder)) : null;
    this.swTree = false;
    this.swFolderAt = this.swFolder;
    this.escAsked = false;
    this.swText = TextareaState.new({ value: def && p.task ? brief(p.task, b) : "", rows: 10, placeholder: "Its first message. Leave empty to start it idle." });
    this.swTextAt = this.swText.value();
    this.swText.on("change", (_e, cx) => this.unask(cx));
    // ⌘/Ctrl+Enter in the message starts it (a plain Enter is a line break there).
    this.swText.on("submit", (e, cx) => { if (!e?.secondary) return; dropEnterBreak(this.swText); this.swStart(); cx.notify(); });
    this.swText.focus();
    cx.timer.after(400, () => this.swText.focus());
    this.handle.focus();
  }

  // Start with…: an agent picked, another folder, the worktree box or the message changed.
  swChanged() {
    return this.swChosen || this.swFolder !== this.swFolderAt || this.swTree || this.swText.value() !== this.swTextAt;
  }

  swChoices() {
    return startChoices(presetsFor(props().workspace), this.swAgents ?? []);
  }

  // Start: the board copy that opened the dialog starts it (startWithAsked), then this closes.
  swStart() {
    const p = props();
    const over = overOf(this.swChoices(), this.swPick, this.swFolder, this.swText.value());
    if (!over) { this.swError = this.swChoices().length ? "Pick an agent and a folder first." : "No agents yet: still checking which are installed."; return; }
    if (this.swDone) return; // asked once already (the key and the box can both say so)
    this.swDone = true;
    setShared(START_WITH, { owner: p.owner, file: p.task.file, worktree: this.swTree, over, at: Date.now() });
    closeOverlay(p.overlay);
  }

  startDialog(t) {
    const p = props();
    const def = defOf(p.workspace);
    const task = p.task;
    const close = () => closeOverlay(p.overlay);
    if (!def || !task) return this.goneDialog(t, "sw-close");
    const b = boardOf(def);
    const choices = this.swChoices();
    const pick = choices.find((c) => c.id === this.swPick) ?? null;
    const agents = this.swAgents ?? [];
    const section = (text) => div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const glyph = (a) => (a?.icon ? (a.tint ? svg(a.icon).text_color(t.foreground) : image(a.icon)).size(13).flex_none()
      : svg("mods/workspace-chrome/terminal.svg").size(13).flex_none().text_color(t.muted));
    const iconFor = (c) => glyph(c.kind === "agent" ? agents.find((a) => a.key === c.name)
      : agents.find((a) => a.key === programOf(words(presetsFor(def.id).find((x) => x.name === c.name)?.command ?? ""))));
    const chip = (id, kids, on, action, tip) => h_flex().id(id).h(26).px(10).gap(6).flex_none().items_center().rounded(13).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(12)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => { action(); cx.notify(); }).children(kids);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12.5).font_medium().cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action).child(text);
    // The card's own worktree first, when it has one that's still there.
    const tree = task.treeThere ? expand(task.worktree) : null;
    const places = [tree, def.root, ...folderChoices(def)].filter((f, i, all) => f && all.indexOf(f) === i);
    const placeName = (f) => (f === tree ? "Its worktree" : f === def.root ? `${def.name} root` : base(f));
    // The key first: the line is cut at the end in a narrow dialog (its tooltip has it all).
    const note = `${window()?.platform === "macos" ? "⌘" : "Ctrl+"}Enter starts it. The card moves to ${label(b.start)} and keeps its own agent and folder.`;
    // Esc, and Cmd/Ctrl+W, reach a dialog as Herdr's actions, never as keys: claim them here.
    const onClose = (_e, cx) => { cx.stop_propagation(); this.guardedClose(this.swChanged(), cx, "esc"); };
    return v_flex().id("start-with").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_action("overlay.close", onClose).on_action("tab.close", onClose).on_action("pane.close", onClose)
      .on_mouse_down("left", (_e, cx) => this.unask(cx))
      .on_key_down((e, cx) => {
        // (Esc never arrives here: Herdr sends it as overlay.close, claimed above.)
        if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control)) { this.swStart(); cx.notify(); }
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().gap(10).items_center()
        .child(div().flex_none().text_size(15).font_semibold().child(`Start ${task.id} with…`))
        .child(div().id("sw-title").flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).tooltip(task.title).child(task.title))
        .child(this.closeX(t, "sw-close", (cx) => this.guardedClose(this.swChanged(), cx, "x"))))
      .child(section("Agent"))
      .child(h_flex().gap(6).flex_wrap().children(choices.map((c) => chip(`sw-${c.id}`, [iconFor(c), c.label ?? c.name], this.swPick === c.id, () => { this.swPick = c.id; this.swChosen = true; this.swError = null; }, c.tip))))
      .when(!choices.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("Checking installed agents…")))
      .child(section("Folder"))
      .child(h_flex().gap(6).flex_wrap()
        .children(places.map((f, i) => chip(`sw-dir-${i}`, [placeName(f)], this.swFolder === f, () => { this.swFolder = f; }, f === tree && task.branch ? `${tilde(f)}, on ${task.branch}` : tilde(f)))))
      // Not a fifth place: an on/off for whichever folder is picked, so a tick box of its own (as Worktrees draws one).
      .child(h_flex().id("sw-tree").pt(10).gap(8).items_center().cursor_pointer().text_size(12.5).text_color(t.foreground)
        .on_click((_e, cx) => { this.swTree = !this.swTree; cx.notify(); })
        .child(h_flex().size(15).flex_none().rounded(4).border_1().items_center().justify_center()
          .border_color(this.swTree ? t.accent : t.input).when(this.swTree, (el) => el.bg(t.accent).text_color(t.accent_foreground)
            .child(svg("mods/workspace-chrome/check.svg").size(11))))
        .child("In a new worktree of that folder's repo"))
      .child(section(pick?.kind === "preset" ? "First message: after the preset's instructions" : "First message"))
      .child(div().flex_1().min_h(80).child(Textarea.new(this.swText).size_full().p(10).rounded(8).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(Boolean(this.swError || this.escAsked), (el) => el.child(div().pt(8).text_size(11.5).text_color(this.escAsked ? t.working : t.blocked).child(this.escAsked ? ASK_AGAIN[this.escAsked] : this.swError)))
      .child(h_flex().pt(12).gap(8).items_center()
        .child(div().id("sw-note").flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(note).child(note))
        .child(button("sw-cancel", "Cancel", false, close))
        .child(button("sw-go", "Start", true, (_e, cx) => { this.swStart(); cx.notify(); })));
  }
}
