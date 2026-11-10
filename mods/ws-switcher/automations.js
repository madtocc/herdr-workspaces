// Automations: agents a workspace starts by itself. Each is a file,
// ~/.herdr/workspaces/<id>/automations/<name>.md:
//
//   ---
//   description: Review yesterday's changes
//   when: weekdays 09:00        what sets it off (when.js)
//   agent: reviewer             a preset or a program; default: the board's agent
//   folder: api                 where it runs, from the root; default: the root
//   card: true                  each run also adds a card to the board
//   enabled: false              off: only Run now and herdr-ws-run start it
//   ---
//   The prompt: the agent's task. {{event}} and the other {{…}} are filled in.
//
// The switcher's sidebar copy owns the one Runner and ticks it on its 500ms timer:
// Herdr doesn't draw in the background, and a dialog's tasks end when it closes.
// A run is a tab in the workspace's "Automations" space (made the first time).
// Making a tab shows it, so the runner puts your view back straight after.
//
// Published (shared), for the ws-automations screen:
//   workspaces.automations       { <workspace>: [automation, …] }, each with `next`
//   workspaces.automation.runs   the last 100 runs, newest first
// Asked for (shared), by the screen's Run now (the switcher passes it on):
//   workspaces.automation.run    { workspace, name, at }
// Outside calls (bin/herdr-ws-run) are files in ~/.herdr/workspaces/.inbox.
// GitHub automations ask GitHub with `gh api` every POLL, one call per repo.
// What it remembers (when each last ran, when Herdr last ticked, the runs) is in
// this copy's localStorage.

import { spaces, agents, focused, run, shared, setShared, home, readTextFile, writeTextFile, watchFolder, exec, notify, knownAgents } from "herdr";
import * as fs from "fs/promises";
import { parseWhen, describe, due, nextAt, shortTime } from "./when.js";

const SPACE = "Automations";
const MISSED = 12 * 3600e3; // a schedule missed while Herdr was closed runs once if it was due this recently
const GAP = 50e3;           // an automatic run doesn't start within this of the same one's last start
const QUIET = 3000;         // files must be quiet this long before a files automation starts
const OLD_CALL = 3600e3;    // an outside call that waited longer than this (Herdr closed) is dropped
const KEEP_TABS = 3;        // each automation keeps its newest runs' tabs; older finished ones close
const KEEP_RUNS = 100;
const POLL = 120e3;         // how often GitHub automations look at their repos
const MAX_NEW = 10;         // new PRs and issues one look starts at most, per repo
const MAX_BODY = 4000;      // characters of a PR's or issue's description passed on
const STORE = "automations";
// Changes a files automation doesn't count: git's and dependency folders, dotfiles.
const IGNORED = /\/(\.git|node_modules)(\/|$)|\/\.[^/]*$/;

const wsDir = () => `${home()}/.herdr/workspaces`;
const tasksDir = (id) => `${wsDir()}/${id}/tasks`;
const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const message = (e) => String(e?.message ?? e);
const pad = (n) => String(n).padStart(2, "0");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// fs reads only under home; a workspace can live anywhere, so the shell checks the rest.
async function exists(path) {
  try { return await fs.exists(path); }
  catch { return (await exec("test", ["-e", path]).catch(() => ({ code: 1 }))).code === 0; }
}

// --- copies of ws-board's (mods can't import across folders): keep them in step ---

const COLUMNS = ["backlog", "todo", "doing", "review", "done"];
// Today's date where you are (toISOString would give UTC's).
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function expand(p) {
  const s = String(p ?? "").trim();
  if (!s) return "";
  const full = s === "~" ? home() : s.startsWith("~/") ? home() + s.slice(1) : s;
  return full.length > 1 ? full.replace(/\/+$/, "") : full;
}

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

function quote(v) {
  const s = String(v);
  return /^[A-Za-z0-9_./~@(][^:#"'{}\[\]\n]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|null|yes|no|on|off|-?[0-9.]+)$/i.test(s)
    ? s : JSON.stringify(s);
}

function field(head, key) {
  const line = head.find((l) => l.startsWith(`${key}:`));
  return line === undefined ? null : unquote(line.slice(key.length + 1));
}

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

function folderPath(def, folder) {
  if (!folder) return def.root;
  const e = expand(folder);
  return e.startsWith("/") ? e : `${def.root}/${e}`;
}

function brief(task, b) {
  return [
    `${task.id}: ${task.title}`,
    task.body,
    "---",
    `This task is tracked in ${tilde(task.file)}; its status is now "${b.start}". When you've finished, change its "status:" line to "${b.finish}" and, if anything is left open, add it under a "## Notes" heading at the end. Leave the other lines between the --- markers as they are.`,
  ].filter(Boolean).join("\n\n");
}

async function herdr(command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)], { timeout: 60000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if (!out || out.error) throw new Error(out?.error || r.stderr.trim() || `herdr-app do ${command} failed`);
  return out;
}

// --- automation and task files ---

const yes = (v) => /^(true|yes|on|1)$/i.test(String(v ?? "").trim());
const no = (v) => /^(false|no|off|0)$/i.test(String(v ?? "").trim());

export function parseAutomation(name, file, text) {
  const { head, body } = split(text.replace(/\r\n/g, "\n"));
  const when = field(head, "when") ?? "";
  const trigger = parseWhen(when);
  return {
    name, file, description: field(head, "description") ?? "", when, trigger, summary: describe(trigger),
    agent: field(head, "agent") || null, folder: field(head, "folder") || null,
    card: yes(field(head, "card")), enabled: !no(field(head, "enabled")),
    body: body.replace(/<!--[\s\S]*?-->/g, "").trim(),
    error: trigger.kind === "error" ? trigger.error : null,
  };
}

async function loadAutomations(def) {
  const at = `${def.dir}/automations`;
  let names = [];
  try { names = (await fs.readdir(at)).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    const text = await readTextFile(`${at}/${n}`);
    if (text !== null) out.push(parseAutomation(n.slice(0, -3), `${at}/${n}`, text));
  }
  return out;
}

// The workspace's tasks by file: what board automations compare.
async function loadTasks(id) {
  const out = {};
  let names = [];
  try { names = (await fs.readdir(tasksDir(id))).filter((n) => n.endsWith(".md") && !n.startsWith(".")); } catch { return out; }
  for (const n of names) {
    const file = `${tasksDir(id)}/${n}`;
    const text = await readTextFile(file);
    if (text === null) continue;
    const { head, body } = split(text);
    out[file] = {
      file, id: field(head, "id") || n.slice(0, -3), title: field(head, "title") || n.slice(0, -3),
      status: (field(head, "status") || "").toLowerCase(), automation: field(head, "automation"), body: body.trim(),
    };
  }
  return out;
}

// A github automation's repo: a workspace folder's GitHub remote (origin), else owner/name as written.
async function repoOf(def, spec) {
  const folder = def ? folderPath(def, spec) : null;
  if (folder && (await exists(folder))) {
    const r = await exec("git", ["-C", folder, "remote", "get-url", "origin"]).catch(() => null);
    const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(r?.stdout?.trim() ?? "");
    return m ? { repo: m[1], folder } : { error: `${spec} has no GitHub remote called origin.` };
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(spec)) return { repo: spec, folder: null };
  return { error: `There's no folder ${spec} in this workspace, and it isn't owner/name.` };
}

// What a run gets about a new PR or issue: {{pr}} or {{issue}} (and {{event}}) is all of it.
function itemVars(repo, it) {
  const isPr = Boolean(it.pull_request);
  const labels = (it.labels ?? []).map((l) => l.name ?? l).join(", ");
  let body = String(it.body ?? "").trim();
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY)}\n… (cut here: the link has the rest)`;
  const block = [
    `${isPr ? "Pull request" : "Issue"} #${it.number} in ${repo}: ${it.title}`,
    `By ${it.user?.login ?? "someone"} · ${it.html_url}${labels ? ` · labels: ${labels}` : ""}`,
    body,
  ].filter(Boolean).join("\n");
  return { [isPr ? "pr" : "issue"]: block, number: String(it.number), title: it.title ?? "", url: it.html_url ?? "", author: it.user?.login ?? "", repo, labels, event: block };
}

const taskText = (t) => [`${t.id}: ${t.title}`, t.body, `The task file is ${tilde(t.file)}.`].filter(Boolean).join("\n\n");

// {{name}} from vars; unknown ones stay as written.
const fill = (text, vars) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, k) => (vars[k] ?? all));

export class Runner {
  // h: { presetsFor(workspace), presetLaunch(preset, task), claim(space, workspace) }
  constructor(h) {
    this.h = h;
    this.list = {};             // workspace -> its automations
    this.tasks = {};            // workspace -> { file: task }, where a board automation watches
    this.statuses = null;       // agent address -> status at the last tick
    this.minute = Math.floor(Date.now() / 60e3);
    this.files = {};            // "<workspace>/<name>" -> changed files waiting for quiet
    this.watching = new Set();  // folders being watched for files automations
    this.warnings = {};         // folder -> why it can't be watched
    this.starting = new Map();  // key -> starts waiting or under way
    this.queue = new Map();     // key -> the last of them
    this.recent = new Map();    // per task or agent: when it last set an automation off
    this.pending = [];          // missed schedules, started on the next tick
    this.polled = 0;
    this.repos = {};            // "<workspace>\t<repo as written>" -> { repo, folder } or { error }
    this.ghWarn = {};           // repo -> why gh couldn't read it
    this.ghPolled = 0;
    this.me = null;             // your GitHub login, for "by others"
    this.hold = 0;
    this.loaded = false;
    const empty = { last: {}, base: {}, seen: 0, runs: [], github: {} };
    try { this.state = { ...empty, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") }; } catch { this.state = empty; }
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch {} }
  // While a run's tab is being made: the switcher doesn't follow the view then.
  holding() { return Date.now() < this.hold; }
  def(ws) { return (shared("workspaces.defs") ?? []).find((d) => d.id === ws && !d.error) ?? null; }
  find(ws, name) { return (this.list[ws] ?? []).find((a) => a.name === name) ?? null; }
  each(fn) {
    for (const [ws, autos] of Object.entries(this.list)) {
      if (this.def(ws)) for (const a of autos) if (a.enabled && !a.error) fn(ws, a);
    }
  }
  lastRun(ws, name) { return this.state.runs.find((r) => r.ws === ws && r.name === name && r.status === "started") ?? null; }
  // A run's agent is working or waiting on you. By terminal and tab: a terminal's
  // address can come back for another one later (after a restart, say); a tab's id can't.
  busy(r) {
    const ag = r?.terminal ? agents().find((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab)) : null;
    return Boolean(ag && (ag.status === "working" || ag.status === "blocked"));
  }

  // Every workspace's automations, read again (after the switcher's folder watch).
  async load(cx) {
    const list = {};
    for (const d of (shared("workspaces.defs") ?? []).filter((x) => !x.error)) list[d.id] = await loadAutomations(d);
    const now = Date.now();
    for (const [ws, autos] of Object.entries(list)) {
      if (autos.some((a) => a.trigger.kind === "board")) this.tasks[ws] ??= await loadTasks(ws);
      else delete this.tasks[ws];
      for (const a of autos) if (a.trigger.kind === "every") this.state.base[`${ws}/${a.name}`] ??= now;
    }
    this.list = list;
    // Each github automation's repo; one that couldn't be found is looked for again.
    for (const k of Object.keys(this.repos)) if (this.repos[k].error) delete this.repos[k];
    const watched = new Set();
    for (const [ws, autos] of Object.entries(list)) {
      for (const a of autos) {
        if (a.trigger.kind !== "github") continue;
        const k = `${ws}\t${a.trigger.repo}`;
        this.repos[k] ??= await repoOf(this.def(ws), a.trigger.repo);
        if (a.enabled && this.repos[k].repo) watched.add(this.repos[k].repo);
      }
    }
    // A repo nothing watches forgets what it saw, so watching it again starts afresh.
    for (const repo of Object.keys(this.state.github)) if (!watched.has(repo)) delete this.state.github[repo];
    // A workspace that's gone takes its runs and times with it (one with a broken
    // workspace.jsonc is still there).
    const there = new Set((shared("workspaces.defs") ?? []).map((d) => d.id));
    if (there.size) {
      this.state.runs = this.state.runs.filter((r) => there.has(r.ws));
      for (const map of [this.state.last, this.state.base]) for (const k of Object.keys(map)) if (!there.has(k.split("/")[0])) delete map[k];
    }
    if (!this.loaded) { this.loaded = true; this.catchUp(now); }
    this.save();
    this.watchFiles(cx);
    this.publish();
  }

  // Schedules due while Herdr was closed (in the last MISSED): each runs once.
  catchUp(now) {
    const from = Math.max(this.state.seen || now, now - MISSED);
    this.each((ws, a) => {
      if (a.trigger.kind !== "at" && a.trigger.kind !== "cron") return;
      const last = this.state.last[`${ws}/${a.name}`] ?? 0;
      let missed = null;
      for (let t = Math.floor(from / 60e3) * 60e3; t < Math.floor(now / 60e3) * 60e3; t += 60e3) {
        if (t > last && due(a.trigger, new Date(t))) missed = t;
      }
      if (missed) this.pending.push({ ws, name: a.name, why: `Missed ${shortTime(missed, now)} while Herdr was closed` });
    });
  }

  next(ws, a, now) {
    if (!a.enabled || a.error) return null;
    if (a.trigger.kind === "every") {
      const k = `${ws}/${a.name}`;
      return (this.state.last[k] ?? this.state.base[k] ?? now) + a.trigger.ms;
    }
    return nextAt(a.trigger, now);
  }

  warningOf(ws, a, def) {
    if (a.trigger.kind === "files") return def ? this.warnings[folderPath(def, a.trigger.folder)] ?? null : null;
    if (a.trigger.kind !== "github") return null;
    const r = this.repos[`${ws}\t${a.trigger.repo}`];
    return r?.error ?? (r?.repo ? this.ghWarn[r.repo] ?? null : null);
  }

  publish() {
    const now = Date.now();
    const out = {};
    for (const [ws, autos] of Object.entries(this.list)) {
      const def = this.def(ws);
      out[ws] = autos.map((a) => ({
        ...a, next: this.next(ws, a, now),
        warning: this.warningOf(ws, a, def),
      }));
    }
    if (JSON.stringify(out) !== JSON.stringify(shared("workspaces.automations") ?? null)) setShared("workspaces.automations", out);
    if (JSON.stringify(this.state.runs) !== JSON.stringify(shared("workspaces.automation.runs") ?? null)) setShared("workspaces.automation.runs", this.state.runs);
  }

  // Every 500ms, from the switcher's timer.
  tick(cx) {
    if (!this.loaded) return;
    const now = Date.now();
    for (const p of this.pending.splice(0)) {
      const a = this.find(p.ws, p.name);
      if (a) this.fire(cx, p.ws, a, p.why);
    }
    const minute = Math.floor(now / 60e3);
    if (minute !== this.minute) {
      this.minute = minute;
      const at = new Date(minute * 60e3);
      this.each((ws, a) => { if (due(a.trigger, at)) this.fire(cx, ws, a, `The ${shortTime(at.getTime(), now)} schedule`); });
      for (const [k, t] of this.recent) if (now - t > GAP) this.recent.delete(k);
      this.state.seen = now;
      this.save();
      this.publish();
    }
    this.each((ws, a) => { if (a.trigger.kind === "every" && now >= this.next(ws, a, now)) this.fire(cx, ws, a, a.summary); });
    this.watchAgents(cx);
    for (const [k, f] of Object.entries(this.files)) {
      if (now - f.at >= QUIET) { delete this.files[k]; this.filesFire(cx, f); }
    }
    if (now - this.polled >= 2000) { this.polled = now; this.inbox(cx); }
    if (now - this.ghPolled >= POLL) { this.ghPolled = now; this.github(cx); }
  }

  // What the switcher's folder watch saw change under ~/.herdr/workspaces.
  changed(paths, cx) {
    const root = wsDir();
    const all = paths.includes(root);
    if (all || paths.some((p) => p.startsWith(`${root}/.inbox/`))) this.inbox(cx);
    for (const ws of Object.keys(this.tasks)) {
      if (all || paths.some((p) => p === tasksDir(ws) || p.startsWith(`${tasksDir(ws)}/`))) this.boardCheck(ws, cx);
    }
  }

  // Starts an automation. how: { manual } (Run now, herdr-ws-run: even when it's
  // off or its last run is working), { key } (one run per task or agent).
  fire(cx, ws, a, why, vars = {}, how = {}) {
    const k = `${ws}/${a.name}`, key = how.key ? `${k}#${how.key}` : k, now = Date.now();
    if (!how.manual) {
      if (this.starting.has(key)) return;
      if (now - ((how.key ? this.recent.get(key) : this.state.last[k]) ?? 0) < GAP) return;
      if (how.key) this.recent.set(key, now);
      this.state.last[k] = now;
      this.save();
      const prev = this.lastRun(ws, a.name);
      if (!how.key && this.busy(prev)) {
        this.log({ ws, name: a.name, at: now, why, status: "skipped", note: "Its last run was still working." });
        return;
      }
    }
    cx.spawn(async (cx) => { await this.start(ws, a, why, vars, key, how.folder); cx.notify(); });
  }

  // Starts of one automation take turns, so a burst of calls all run, one after another.
  start(ws, a, why, vars, key, place) {
    const at = Date.now();
    this.starting.set(key, (this.starting.get(key) ?? 0) + 1);
    const go = async () => {
      try { await this.launch(ws, a, why, vars, at, place); }
      catch (e) {
        this.log({ ws, name: a.name, at, why, status: "failed", note: message(e) });
        notify({ title: `${a.name} didn't start`, body: message(e), level: "error" });
      }
      const left = (this.starting.get(key) ?? 1) - 1;
      if (left > 0) this.starting.set(key, left); else { this.starting.delete(key); this.queue.delete(key); }
    };
    const turn = (this.queue.get(key) ?? Promise.resolve()).then(go);
    this.queue.set(key, turn);
    return turn;
  }

  // place: where it runs when the automation names no folder (a github one's repo), else the root.
  async launch(ws, a, why, vars, at, place) {
    const def = this.def(ws);
    if (!def) throw new Error("Its workspace is gone.");
    const b = boardOf(def);
    const name = a.agent || b.agent;
    const folder = a.folder ? folderPath(def, a.folder) : place ?? def.root;
    if (!(await exists(folder))) throw new Error(`${tilde(folder)} isn't there.`);
    const d = new Date(at);
    const all = {
      workspace: def.name, automation: a.name, folder: tilde(folder), event: why,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, ...vars,
    };
    let prompt = fill(a.body, all);
    // What set it off goes at the end, unless the prompt uses one of its fill-ins.
    if (vars.event && !/\{\{\s*(event|text|task|task\.\w+|files?|agent|terminal|space|pr|issue|number|title|url|author|repo|labels)\s*\}\}/.test(a.body)) prompt = [prompt, vars.event].filter(Boolean).join("\n\n");
    const card = a.card ? await this.card(def, b, a, name, prompt, at) : null;
    const task = card ? brief(card, b) : prompt;
    const preset = this.h.presetsFor(ws).find((x) => x.name === name);
    let argv, first;
    if (preset) ({ argv, task: first } = this.h.presetLaunch(preset, task));
    else {
      const known = await knownAgents().catch(() => []);
      argv = known.find((x) => x.key === name)?.run ?? [name];
      first = task;
    }
    const made = await this.open(ws, a.name, folder, argv, first);
    if (card) await this.updateCard(card.file, { terminal: made.terminal ?? null, started: today() });
    this.log({ ws, name: a.name, at, why, status: "started", terminal: made.terminal ?? null, tab: made.tab ?? null, space: made.space ?? null, card: card?.id ?? null });
    this.tidy(ws, a.name);
    notify({
      title: `${a.name} started`, body: `${why}. In ${def.name} › ${SPACE}.`, level: "info",
      ...(made.tab ? { action: { name: "tab.select", args: { id: made.tab } } } : {}),
    });
  }

  // A tab in the workspace's Automations space (made the first time), then your view back.
  async open(ws, name, folder, argv, task) {
    const assigned = shared("workspaces.assigned") ?? {};
    const space = spaces().find((s) => assigned[s.id] === ws && !s.machine && s.named && s.name === SPACE);
    const view = focused();
    this.hold = Date.now() + 5000;
    let made = null;
    try {
      made = space
        ? await herdr("tab.new", { space: space.id, name, folder, argv, ...(task ? { task } : {}) })
        : await herdr("space.new", { name: SPACE, folder, tab: name, argv, ...(task ? { task } : {}) });
      if (!space && made.space) this.h.claim(made.space, ws);
    } finally {
      if (view?.space && made?.space && view.space !== made.space) run("space.select", { id: view.space });
      if (view?.tab && made?.tab && view.tab !== made.tab) run("tab.select", { id: view.tab });
      this.hold = Date.now() + 1500;
    }
    return made;
  }

  // The run's card: a new task in the board's start column, with the prompt as its notes.
  async card(def, b, a, agent, prompt, at) {
    const d = new Date(at);
    const title = `${a.description || a.name} (${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())})`;
    for (let i = 0; i < 5; i++) {
      const id = await nextId(def.id, b.prefix);
      const file = `${tasksDir(def.id)}/${id}.md`;
      const fields = { id, title, status: b.start, agent, folder: a.folder, automation: a.name, created: today() };
      try {
        await writeTextFile(file, withFields("---\n---\n", fields, prompt || title), null);
        return { id, title, file, body: prompt };
      } catch {} // that ID was just taken: the next one
    }
    throw new Error("Couldn't add its card to the board.");
  }

  async updateCard(file, fields) {
    for (let i = 0; i < 3; i++) {
      const old = await readTextFile(file);
      if (old === null) return;
      try { await writeTextFile(file, withFields(old, fields), old); return; } catch {}
    }
  }

  // Closes this automation's older run tabs whose agent isn't working or waiting on you.
  tidy(ws, name) {
    const live = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
    const runs = this.state.runs.filter((r) => r.ws === ws && r.name === name && r.status === "started" && r.tab && live.has(r.tab));
    for (const r of runs.slice(KEEP_TABS)) if (!this.busy(r)) run("tab.close", { id: r.tab, confirmed: true });
  }

  log(r) {
    this.state.runs = [{ id: `${r.at}-${Math.random().toString(36).slice(2, 7)}`, ...r }, ...this.state.runs].slice(0, KEEP_RUNS);
    this.save();
    this.publish();
  }

  // --- what sets them off ---

  // An agent in the workspace finished or needs you. Runs of automations don't count,
  // so an automation can't set itself (or another) off in a loop.
  watchAgents(cx) {
    const list = agents();
    const before = this.statuses;
    this.statuses = new Map(list.map((a) => [a.address, a.status]));
    if (!before) return;
    const assigned = shared("workspaces.assigned") ?? {};
    const ours = new Set(this.state.runs.filter((r) => r.terminal && r.tab).map((r) => `${r.terminal} ${r.tab}`));
    for (const ag of list) {
      const was = before.get(ag.address);
      if (!was || was === ag.status || ours.has(`${ag.address} ${ag.tab}`)) continue;
      // "done" turns "idle" once someone looks: either is finished.
      const finished = was === "working" && (ag.status === "done" || ag.status === "idle");
      const blocked = ag.status === "blocked";
      if (!finished && !blocked) continue;
      const ws = assigned[ag.space];
      if (!ws) continue;
      const who = ag.tab_name || ag.program?.name || "An agent";
      const what = blocked ? "needs you" : "finished";
      this.each((w, a) => {
        const t = a.trigger;
        if (w !== ws || t.kind !== "agent" || (t.status === "blocked") !== blocked) return;
        if (t.name && t.name.toLowerCase() !== String(ag.tab_name ?? "").toLowerCase()) return;
        this.fire(cx, ws, a, `${who} ${what}`, {
          agent: who, terminal: ag.address, space: ag.space_name,
          event: `${who} (in the “${ag.space_name}” space) ${what}. Its terminal is ${ag.address}: \`hc read ${ag.address}\` shows its screen.`,
        }, { key: ag.address });
      });
    }
  }

  // A task entered a column. A card an automation just made doesn't count (its
  // later moves do), so a card can't set off the automation that made it.
  boardCheck(ws, cx) {
    cx.spawn(async (cx) => {
      const before = this.tasks[ws];
      if (!before) return;
      const now = await loadTasks(ws);
      this.tasks[ws] = now;
      for (const [file, t] of Object.entries(now)) {
        const was = before[file];
        if (was ? was.status === t.status : t.automation) continue;
        this.each((w, a) => {
          if (w !== ws || a.trigger.kind !== "board" || a.trigger.column !== t.status) return;
          this.fire(cx, ws, a, `${t.id} entered ${t.status}`, {
            task: taskText(t), "task.id": t.id, "task.title": t.title, "task.file": tilde(t.file), event: taskText(t),
          }, { key: `${t.id}>${t.status}` });
        });
      }
    });
  }

  // One watch per folder that a files automation names.
  watchFiles(cx) {
    for (const folder of this.folders()) {
      if (this.watching.has(folder)) continue;
      this.watching.add(folder);
      delete this.warnings[folder];
      cx.spawn(async (cx) => {
        for (;;) {
          let paths;
          try { paths = await watchFolder(folder); }
          catch (e) {
            this.watching.delete(folder);
            this.warnings[folder] = `Can't watch ${tilde(folder)}: ${message(e)}`;
            this.publish();
            return;
          }
          if (!this.folders().has(folder)) { this.watching.delete(folder); return; }
          this.filesSeen(folder, paths);
        }
      });
    }
  }

  folders() {
    const out = new Set();
    this.each((ws, a) => { if (a.trigger.kind === "files") out.add(folderPath(this.def(ws), a.trigger.folder)); });
    return out;
  }

  // Changes gather until the folder is quiet. Changes made while the automation's
  // own run is working don't count: its agent writing there mustn't set it off again.
  filesSeen(folder, paths) {
    // Watched paths can come back as the real path (macOS's /tmp is /private/tmp): test them whole.
    const kept = paths.filter((p) => !IGNORED.test(p));
    if (!kept.length) return;
    const now = Date.now();
    this.each((ws, a) => {
      if (a.trigger.kind !== "files" || folderPath(this.def(ws), a.trigger.folder) !== folder) return;
      if (this.busy(this.lastRun(ws, a.name))) return;
      const f = (this.files[`${ws}/${a.name}`] ??= { ws, name: a.name, folder, paths: new Set(), at: now });
      for (const p of kept) f.paths.add(p);
      f.at = now;
    });
  }

  filesFire(cx, f) {
    const a = this.find(f.ws, f.name);
    if (!a?.enabled) return;
    cx.spawn(async (cx) => {
      const live = [];
      for (const p of f.paths) if (await exists(p)) live.push(p); // a deleted file isn't news
      if (!live.length) return;
      const shown = live.slice(0, 50).map(tilde);
      const list = shown.join("\n") + (live.length > 50 ? `\n… and ${live.length - 50} more` : "");
      this.fire(cx, f.ws, a, `${plural(live.length, "file")} changed in ${a.trigger.folder}`, {
        files: list, file: shown[0], event: `These changed in ${tilde(f.folder)}:\n${list}`,
      });
    });
  }

  // New PRs and issues: one `gh api` call per watched repo (GitHub's issues list has
  // both). The first look only notes the highest number there; after that, each
  // higher one is new. What's opened while Herdr is closed is picked up when it opens.
  github(cx) {
    if (this.ghBusy) return;
    const watch = new Map(); // repo -> [{ ws, a, folder }]
    this.each((ws, a) => {
      if (a.trigger.kind !== "github") return;
      const r = this.repos[`${ws}\t${a.trigger.repo}`];
      if (!r?.repo) return;
      if (!watch.has(r.repo)) watch.set(r.repo, []);
      watch.get(r.repo).push({ ws, a, folder: r.folder });
    });
    if (!watch.size) return;
    this.ghBusy = true;
    cx.spawn(async (cx) => {
      try {
        if (this.me === null) {
          const r = await exec("gh", ["api", "user", "--jq", ".login"], { timeout: 30000 }).catch(() => null);
          this.me = r?.code === 0 ? r.stdout.trim() : "";
        }
        for (const [repo, subs] of watch) {
          let r;
          try { r = await exec("gh", ["api", `repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=30`], { timeout: 60000 }); }
          catch (e) { r = { code: 1, stderr: /start|not found|ENOENT/i.test(message(e)) ? "gh isn't installed" : message(e) }; }
          let items = null;
          if (r.code === 0) { try { items = JSON.parse(r.stdout); } catch {} }
          if (!Array.isArray(items)) {
            this.ghWarn[repo] = `Can't read ${repo} with gh: ${String(r.stderr || r.stdout || "no answer").trim().split("\n")[0]}`;
            continue;
          }
          delete this.ghWarn[repo];
          const seen = this.state.github[repo];
          this.state.github[repo] = Math.max(seen ?? 0, ...items.map((it) => it.number ?? 0));
          if (seen === undefined) continue;
          const fresh = items.filter((it) => it.number > seen).sort((x, y) => x.number - y.number).slice(-MAX_NEW);
          for (const it of fresh) {
            const isPr = Boolean(it.pull_request);
            for (const { ws, a, folder } of subs) {
              const t = a.trigger;
              if ((t.what === "pr") !== isPr) continue;
              if (t.others && this.me && it.user?.login === this.me) continue;
              if (t.label && !(it.labels ?? []).some((l) => String(l.name ?? l).toLowerCase() === t.label.toLowerCase())) continue;
              this.fire(cx, ws, a, `${isPr ? "PR" : "Issue"} #${it.number} opened in ${repo}`, itemVars(repo, it), { key: `${repo}#${it.number}`, folder });
            }
          }
        }
        this.save();
        this.publish();
      } finally {
        this.ghBusy = false;
      }
    });
  }

  // Calls from bin/herdr-ws-run: ~/.herdr/workspaces/.inbox/<stamp>.run, lines
  // workspace, automation, when (ms), then the text.
  inbox(cx) {
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const at = `${wsDir()}/.inbox`;
        let names = [];
        try { names = (await fs.readdir(at)).filter((n) => n.endsWith(".run")).sort(); } catch {}
        for (const n of names) {
          const path = `${at}/${n}`;
          const text = await readTextFile(path);
          await exec("rm", ["-f", path]).catch(() => {});
          if (text === null) continue;
          const [ws = "", name = "", when = "", ...rest] = text.split("\n");
          const a = this.find(ws.trim(), name.trim());
          const body = rest.join("\n").trim();
          if (!a) {
            notify({ title: "herdr-ws-run: nothing to start", body: `There's no automation "${name.trim()}" in "${ws.trim()}".`, level: "warning" });
            continue;
          }
          const asked = Number(when) || Date.now();
          if (Date.now() - asked > OLD_CALL) {
            this.log({ ws: ws.trim(), name: a.name, at: Date.now(), why: "Called from outside", status: "skipped", note: `Called at ${shortTime(asked)}, while Herdr was closed.` });
            continue;
          }
          this.fire(cx, ws.trim(), a, "Called from outside", body ? { text: body, event: body } : {}, { manual: true });
        }
      } finally {
        this.polling = false;
      }
    });
  }
}
