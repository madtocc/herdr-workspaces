// Board: one workspace's tasks as a kanban board, in a tab of its own (the
// switcher's "Open … board" makes it, with props { workspace }).
//
// A task is a markdown file, ~/.herdr/workspaces/<workspace>/tasks/<ID>.md:
// front matter between --- lines (id, title, status, folder, priority, created,
// and what Start adds: terminal, worktree, branch, started), then notes in
// markdown. People (the task dialog) and agents (editing the file) change the
// same files; the board redraws when they do. Unknown front matter lines are kept.
//
// Columns come from the workspace's `board` in workspace.jsonc:
//   "board": { "columns": ["backlog", "todo", "doing", "review", "done"],
//              "prefix": "ACM", "agent": "claude", "start": "doing", "finish": "review" }
// Every key is optional. A card's Start runs the workspace's agent on the task in
// the task's folder (in that folder's space, else a new one); Worktree first makes
// a branch and worktree for it, as Herdr's worktree menu does. Either way the
// card moves to `start`, and the agent is asked to set `finish` when it's done.
//
// The same mod opens its task dialog: props { dialog: "task", workspace, task? , status? }.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import {
  spaces, panes, agents, terminals, run, theme, shared, props, openOverlay, closeOverlay,
  home, watchFolder, readTextFile, writeTextFile, exec, notify, knownAgents,
} from "herdr";
import * as fs from "fs/promises";

const COLUMNS = ["backlog", "todo", "doing", "review", "done"];
const PRIORITY = { high: 3, medium: 2, low: 1 };
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const STATUS_WORD = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };
// Moves a file to the Trash ($1), or into $2 where there's no Trash command. Prints where.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/" && echo "$2"`;

const workspacesDir = () => `${home()}/.herdr/workspaces`;
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
const base = (p) => p.replace(/\/+$/, "").split("/").pop();
// Today's date where you are (toISOString would give UTC's).
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");
const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const message = (e) => String(e?.message ?? e);

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
      worktree: field(head, "worktree"),
      branch: field(head, "branch"),
      body: body.trim(),
    });
  }
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

// What the card shows of its agent: live and its status, or gone.
function agentOf(task, ag, tm) {
  if (!task.terminal) return null;
  const a = ag.find((x) => x.address === task.terminal);
  if (a) return { live: true, status: a.status, name: a.program?.name ?? "Agent" };
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

// How Herdr starts a preset: { argv, task }. With the launcher, Claude and Codex
// get the instructions as system instructions (--instructions) and the task as
// the first message; other agents get both in the first message, as hc does.
// The first message, for the launcher: as --task, not last on the command line where
// Herdr would put it, so a restart brings the agent back without sending it again
// (bin/herdr-ws-resume). Other commands keep Herdr's task.
function withTask(argv, task) {
  let i = argv[0] === "env" ? 1 : 0;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  if (!task || base(argv[i] ?? "") !== "herdr-ws-agent") return { argv, task };
  return { argv: [...argv.slice(0, i + 1), "--task", task, ...argv.slice(i + 1)], task: "" };
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
  const system = launcher && (agent === "claude" || agent === "codex") && Boolean(preset.body);
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
  if (await fs.exists(path)) return { path, branch };
  const exists = (await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  const r = await git(exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "git worktree add failed");
  return { path, branch };
}

// The agent's first message: the task, then how to report back.
function brief(task, b) {
  return [
    `${task.id}: ${task.title}`,
    task.body,
    "---",
    `This task is tracked in ${tilde(task.file)}; its status is now "${b.start}". When you've finished, change its "status:" line to "${b.finish}" and, if anything is left open, add it under a "## Notes" heading at the end. Leave the other lines between the --- markers as they are.`,
  ].filter(Boolean).join("\n\n");
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
    this.workspace = props()?.workspace ?? shared("workspaces.active") ?? null;
    this.tasks = [];
    this.loaded = false;
    this.busy = {}; // task id -> "start" | "worktree"
    this.drag = null; // { id, from, moved }
    this.over = null;
    this.dropped = 0;
    // Remembered per board tab: which view, and the list's folded sections
    // (null until changed: the last column, done, starts folded).
    this.view = localStorage.getItem("view") === "list" ? "list" : "board";
    const folded = localStorage.getItem("folded");
    this.folded = folded ? new Set(JSON.parse(folded)) : null;
    this.load(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        // The workspace's folder: tasks/ may not exist until the first task.
        try { await watchFolder(`${workspacesDir()}/${this.workspace}`); }
        catch { cx.timer.every(5000, (cx) => this.load(cx)); return; }
        this.load(cx);
      }
    });
  }

  load(cx) {
    cx.spawn(async (cx) => {
      this.tasks = this.workspace ? await loadTasks(this.workspace) : [];
      this.loaded = true;
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
    cx.spawn(async (cx) => {
      try { await this.update(task, { status: column }); }
      catch (e) { notify({ title: `Couldn't move ${task.id}`, body: message(e), level: "error" }); this.load(cx); }
    });
  }

  start(task, worktree, cx) {
    const def = defOf(this.workspace);
    if (!def || this.busy[task.id]) return;
    const b = boardOf(def);
    this.busy[task.id] = worktree ? "worktree" : "start";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const folder = folderPath(def, task.folder);
        const name = task.agent || b.agent;
        const preset = presetsFor(def.id).find((x) => x.name === name);
        let argv, first;
        if (preset) ({ argv, task: first } = presetLaunch(preset, brief(task, b)));
        else {
          const known = await knownAgents().catch(() => []);
          argv = known.find((a) => a.key === name)?.run ?? [name];
          first = brief(task, b);
        }
        ({ argv, task: first } = withTask(argv, first));
        let made, extra = {};
        if (worktree) {
          const wt = await makeWorktree(folder, task);
          made = await herdr("space.new", { folder: wt.path, tab: task.id, argv, ...(first ? { task: first } : {}) });
          extra = { worktree: tilde(wt.path), branch: wt.branch };
        } else {
          const space = spaceFor(def, folder);
          made = space
            ? await herdr("tab.new", { space: space.id, name: task.id, folder, argv, ...(first ? { task: first } : {}) })
            : await herdr("space.new", { folder, tab: task.id, argv, ...(first ? { task: first } : {}) });
        }
        await this.update(task, { status: b.start, terminal: made.terminal ?? null, started: today(), ...extra });
      } catch (e) {
        notify({ title: `Couldn't start ${task.id}`, body: message(e), level: "error" });
      }
      delete this.busy[task.id];
      cx.notify();
    });
  }

  openTask(task, status) {
    openOverlay({
      mod: "ws-board", kind: "dialog", width: 600, height: 620,
      props: { dialog: "task", workspace: this.workspace, status, task: task ? { ...task } : null },
    });
  }

  render() {
    const t = theme();
    if (props()?.dialog) return this.dialog(t);
    const def = defOf(this.workspace);
    const shell = v_flex().id("board").size_full().min_h(0).bg(t.canvas).text_size(13).text_color(t.foreground);
    if (!def) {
      return shell.items_center().justify_center().text_color(t.dim)
        .child(this.workspace ? "This board's workspace is gone." : "Open a board from the workspace switcher's menu.");
    }
    const b = boardOf(def);
    const ag = agents(), tm = terminals();
    const columnOf = (task) => (b.columns.includes(task.status) ? task.status : b.columns[0]);
    const open = this.tasks.filter((x) => columnOf(x) !== b.columns[b.columns.length - 1]).length;

    const header = h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(mark(def, t, 20))
      .child(div().font_semibold().child(`${def.name} board`))
      .child(div().text_size(12).text_color(t.dim).child(`${open} open · ${this.tasks.length - open} done`))
      .child(div().flex_1())
      .child(this.viewToggle(t))
      .child(h_flex().id("board-new").h(30).px(12).gap(6).items_center().rounded(8).cursor_pointer()
        .bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium().hover((s) => s.opacity(0.88))
        .on_click(() => this.openTask(null, b.columns[0]))
        .child(svg("mods/workspace-chrome/plus.svg").size(13)).child("New task"));

    if (this.view === "list") return shell.child(header).child(this.list(b, t, ag, tm, columnOf));
    const columns = b.columns.map((col) => this.column(col, this.tasks.filter((x) => columnOf(x) === col), def, b, t, ag, tm));
    return shell
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; this.over = null; cx.notify(); } })
      .child(header)
      .child(h_flex().id("board-columns").flex_1().min_h(0).items_stretch().p(12).gap(10).children(columns));
  }

  // Board | List, as two segments.
  viewToggle(t) {
    const segment = (view, text, icon) => h_flex().id(`view-${view}`).h(26).px(10).gap(6).items_center().rounded(6).cursor_pointer()
      .text_size(12).when(this.view === view, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(this.view !== view, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => {
        this.view = view;
        localStorage.setItem("view", view);
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
      localStorage.setItem("folded", JSON.stringify([...next]));
      cx.notify();
    };
    const rows = b.columns.flatMap((col) => {
      const tasks = this.tasks.filter((x) => columnOf(x) === col);
      const shut = folded.has(col);
      const head = h_flex().id(`sec-${col}`).h(34).flex_none().pl(14).pr(8).gap(8).items_center().cursor_pointer()
        .bg(t.chrome).border_b(1).border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => fold(col, cx))
        .child(svg(`mods/workspace-chrome/chevron-${shut ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(label(col)))
        .child(div().text_size(11.5).text_color(t.dim).child(String(tasks.length)))
        .child(div().flex_1())
        .child(div().id(`sec-new-${col}`).size(24).flex().items_center().justify_center().rounded(6).text_color(t.dim)
          .hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip(`New task in ${label(col)}`)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.openTask(null, col); })
          .child(svg("mods/workspace-chrome/plus.svg").size(13)));
      return [head, ...(shut ? [] : tasks.map((task) => this.row(task, col === last, b, t, ag, tm)))];
    });
    return v_flex().id("board-list").flex_1().min_h(0).overflow_y_scrollbar().children(rows)
      .when(!this.tasks.length && this.loaded, (el) => el.child(div().px(16).py(12).text_size(12).text_color(t.dim).child("No tasks yet. New task adds one.")));
  }

  row(task, last, b, t, ag, tm) {
    const pr = task.priority && PRIORITY[task.priority] ? task.priority : null;
    const prColor = pr === "high" ? t.blocked : pr === "medium" ? t.working : t.dim;
    return h_flex().id(`row-${task.id}`).h(40).flex_none().pl(36).pr(12).gap(12).items_center()
      .border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => this.openTask(task))
      .child(div().w(64).flex_none().text_size(11.5).text_color(t.dim).child(task.id))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(task.title))
      .child(div().w(52).flex_none().text_size(11.5).text_color(prColor).child(pr ?? ""))
      .child(h_flex().w(120).flex_none().gap(6).items_center().text_size(11).text_color(t.dim)
        .when(Boolean(task.folder), (el) => el.child(div().min_w(0).px(6).rounded(4).bg(t.raised).truncate().child(base(task.folder))))
        .when(Boolean(task.branch), (el) => el.child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none())))
      .child(h_flex().w(210).flex_none().justify_end().child(this.agentArea(task, last, b, t, ag, tm, true) ?? div()));
  }

  column(col, tasks, def, b, t, ag, tm) {
    const dropping = this.drag?.moved && this.over === col && this.drag.from !== col;
    return v_flex().id(`col-${col}`).flex_1().min_w(0).min_h(0).rounded(10).bg(t.chrome).border_1()
      .border_color(dropping ? t.accent : t.border)
      .on_mouse_move((_e, cx) => {
        if (!this.drag || this.over === col) return;
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
      })
      .child(h_flex().h(38).flex_none().pl(12).pr(6).gap(6).items_center()
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(label(col)))
        .child(div().text_size(11.5).text_color(t.dim).child(String(tasks.length)))
        .child(div().flex_1())
        .child(div().id(`col-new-${col}`).size(24).flex().items_center().justify_center().rounded(6).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`New task in ${label(col)}`)
          .on_click(() => this.openTask(null, col)).child(svg("mods/workspace-chrome/plus.svg").size(13))))
      .child(v_flex().id(`col-list-${col}`).flex_1().min_h(0).px(8).pb(8).gap(8).overflow_y_scrollbar()
        .children(tasks.map((task) => this.card(task, col, b, t, ag, tm)))
        .when(!tasks.length && this.loaded, (el) => el.child(div().px(4).py(6).text_size(12).text_color(t.dim)
          .child(col === b.columns[0] && !this.tasks.length ? "No tasks yet. New task adds one." : "Empty"))));
  }

  // A task's agent: starting, live (status and Go to), or Start / Worktree.
  // `inline`: one row for the list; else wrapping, for a card.
  agentArea(task, last, b, t, ag, tm, inline) {
    const a = agentOf(task, ag, tm);
    const busy = this.busy[task.id];
    const stop = (_e, cx) => cx.stop_propagation();
    const small = (id, text, action, tip) => div().id(id).h(24).px(8).flex().flex_none().items_center().rounded(6).border_1().border_color(t.input)
      .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);
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
    return h_flex().gap(6).items_center().when(!inline, (el) => el.flex_wrap()).when(inline, (el) => el.justify_end())
      .when(a && !a.live, (el) => el.child(div().when(!inline, (el) => el.w_full()).text_size(11.5).text_color(t.dim).child("Agent ended")))
      .child(small(`start-${task.id}`, "Start", (cx) => this.start(task, false, cx), `Run ${task.agent || b.agent} on it in ${task.folder || "the workspace root"}`))
      .child(small(`wt-${task.id}`, "Worktree", (cx) => this.start(task, true, cx), "Run it on a new branch in its own worktree"));
  }

  card(task, col, b, t, ag, tm) {
    const last = col === b.columns[b.columns.length - 1];
    const pr = task.priority && PRIORITY[task.priority] ? task.priority : null;
    const prColor = pr === "high" ? t.blocked : pr === "medium" ? t.working : t.dim;
    const foot = this.agentArea(task, last, b, t, ag, tm, false);

    return v_flex().id(`card-${task.id}`).flex_none().gap(7).p(10).rounded(8).bg(t.background).border_1().border_color(t.border)
      .cursor_pointer().hover((s) => s.border_color(t.input))
      .when(this.drag?.id === task.id && this.drag.moved, (el) => el.opacity(0.4))
      .on_mouse_down("left", () => { this.drag = { id: task.id, from: col, moved: false }; this.over = col; })
      .on_click(() => { if (Date.now() - this.dropped > 300) this.openTask(task); })
      .child(h_flex().gap(6).flex_wrap().items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().child(task.id))
        .when(Boolean(task.folder), (el) => el.child(div().flex_none().px(6).rounded(4).bg(t.raised).child(base(task.folder))))
        .when(Boolean(task.branch), (el) => el.child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none()))
        .when(Boolean(task.agent), (el) => el.child(div().flex_none().child(task.agent)))
        .child(div().flex_1())
        .when(Boolean(pr), (el) => el.child(div().flex_none().text_color(prColor).child(pr))))
      .child(div().text_size(13).text_color(t.foreground).child(task.title))
      .when(Boolean(foot), (el) => el.child(foot));
  }

  // --- the task dialog ---

  initDialog(cx) {
    const p = props();
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
    this.titleInput.on("submit", (_e, cx) => this.save(cx));
    this.titleInput.focus();
    cx.timer.after(400, () => this.titleInput.focus());
    this.handle.focus();
  }

  save(cx) {
    const p = props();
    const def = defOf(p.workspace);
    const title = this.titleInput.value().trim();
    if (!def || this.busy) return;
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
          for (let i = 0; ; i++) {
            const id = await nextId(def.id, b.prefix);
            const text = withFields("---\n---\n", {
              id, title, status: this.form.status, folder: this.form.folder, priority: this.form.priority, agent: this.form.agent, created: today(),
            }, body);
            try { await writeTextFile(`${tasksDir(def.id)}/${id}.md`, text, null); break; }
            catch (e) { if (i >= 2) throw e; } // the ID was just taken: the next one
          }
        }
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
    if (!this.confirming) { this.confirming = true; cx.notify(); return; }
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", TRASH, "sh", p.task.file, `${workspacesDir()}/.trash`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        const where = r.stdout.trim();
        notify({ title: `Deleted ${p.task.id}`, body: where === "Trash" ? "Its file is in the Trash." : `Its file is in ${tilde(where)}.`, level: "success" });
        closeOverlay(p.overlay);
      } catch (e) {
        this.error = `Couldn't delete it: ${message(e)}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  dialog(t) {
    const p = props();
    const def = defOf(p.workspace);
    const close = () => closeOverlay(p.overlay);
    if (!def) return v_flex().size_full().p(18).bg(t.popover).text_color(t.muted).child("This task's workspace is gone.");
    const b = boardOf(def);
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
    const folders = [["", "Workspace root"], ...folderChoices(def).map((f) => [rel(def, f), base(f)])];
    const task = p.task;

    return v_flex().id("task-dialog").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { close(); cx.stop_propagation(); }
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(task ? `${task.id}` : `New task in ${def.name}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(section("Title"))
      .child(Input.new(this.titleInput).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(13).text_color(t.foreground))
      .child(section("Status"))
      .child(h_flex().gap(6).flex_wrap().children(b.columns.map((c) => chip(`st-${c}`, label(c), this.form.status === c, () => { this.form.status = c; }))))
      .child(section("Folder: where Start runs the agent"))
      .child(h_flex().gap(6).flex_wrap().children(folders.map(([value, name]) => chip(`fd-${value || "root"}`, name, this.form.folder === value, () => { this.form.folder = value; }))))
      .child(section("Priority"))
      .child(h_flex().gap(6).children([["", "None"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]
        .map(([value, name]) => chip(`pr-${value || "none"}`, name, this.form.priority === value, () => { this.form.priority = value; }))))
      .child(section(`Agent: who Start runs (default: ${b.agent})`))
      .child(h_flex().gap(6).flex_wrap().children([["", "Default"], ...presetsFor(def.id).map((x) => [x.name, x.name])]
        .map(([value, name]) => chip(`ag-${value || "default"}`, name, this.form.agent === value, () => { this.form.agent = value; }))))
      .child(section("Notes"))
      .child(div().flex_1().min_h(0).child(Textarea.new(this.bodyInput).size_full().p(8).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(14).gap(8).items_center()
        .when(Boolean(task), (el) => el.child(button("task-delete", this.confirming ? "Click again to delete" : "Delete", "danger", (_e, cx) => this.remove(cx))))
        .when(Boolean(task?.file), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(tilde(task.file))))
        .when(!task, (el) => el.child(div().flex_1()))
        .child(button("task-cancel", "Cancel", "plain", close))
        .child(button("task-save", task ? "Save" : "Add task", "primary", (_e, cx) => this.save(cx))));
  }
}
