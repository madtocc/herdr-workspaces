// Pull requests on board cards. A task with a `pr:` line (a GitHub URL, or a
// number in its folder's repo) or a `branch:` (what a card's Worktree sets) is
// followed on GitHub with `gh pr view`, your gh login:
//
//   - its card shows one status (Checks failing, Changes requested, Conflicts,
//     Checks running, Ready to merge, Merged, …): shared "workspaces.prs",
//     { <task file>: { number, url, label, tone, tip } }, drawn by ws-board;
//   - the card's agent is sent a message (`hc send`) when a check fails, when it
//     conflicts with its base, or when reviews arrive, once it's free;
//   - you get a toast when it's ready to merge, was closed, or needs someone and
//     the card has no agent left;
//   - a merged one moves its card to the board's last column.
//
// prfacts.js has the rules. Like the automations runner, this lives in the
// switcher's sidebar copy and is ticked on its 500ms timer. What it remembers (what
// each card's agent was already told) is in that copy's localStorage.

import { agents, shared, setShared, readTextFile, writeTextFile, exec, hc, notify } from "herdr";
import * as fs from "fs/promises";
import { wsDir, tilde, message, exists, expand, boardOf, split, field, withFields, folderPath } from "./automations.js";
import { FIELDS, clean, parsePr, repoOfRemote, facts, chip, step, mergeWakes, stillTrue, wakeText, wakeLines } from "./prfacts.js";

const OPEN = 60e3;    // how often an open pull request is read
const SLOW = 300e3;   // … a closed one, or a branch that has none yet
const RETRY = 120e3;  // … after gh couldn't read it
const STALE = 600e3;  // a status this old isn't shown: it may no longer be true
const RESEND = 15e3;  // a message that didn't go in is tried again after this
const WORK_GAP = 5000;
const STORE = "prs";

const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");

// The card's agent: the one at its terminal, if it's still the one Start made
// (an address can come back for another terminal later; a tab's id can't). Cards
// from before `tab:` was recorded go by the tab's name, which Start sets to the id.
function agentOf(t, ag) {
  if (!t.terminal) return null;
  const a = ag.find((x) => x.address === t.terminal);
  if (!a) return null;
  return (t.tab ? a.tab === t.tab : a.tab_name === t.id) ? a : null;
}

export class PrWatcher {
  constructor() {
    this.tasks = {};          // task file -> the task, for those with pr: or branch:
    this.work = {};           // task file -> { since, until }: when its agent was last working
    this.repos = {};          // folder -> { repo } or { error, at }
    this.sending = new Set(); // task files with a message on its way
    this.me = null;           // your GitHub login: your own reviews while the agent works are its replies
    this.looked = 0;
    this.busy = false;
    this.loaded = false;
    try { this.state = { items: {}, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") }; } catch { this.state = { items: {} }; }
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch {} }
  def(ws) { return (shared("workspaces.defs") ?? []).find((d) => d.id === ws && !d.error) ?? null; }

  // Every workspace's tasks that name a pull request or a branch, read again
  // (after the switcher's folder watch).
  async load() {
    const defs = shared("workspaces.defs") ?? [];
    const tasks = {};
    for (const d of defs.filter((x) => !x.error)) {
      const dir = `${wsDir()}/${d.id}/tasks`;
      const columns = boardOf(d).columns;
      let names = [];
      try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith(".")); } catch { continue; }
      for (const n of names) {
        const file = `${dir}/${n}`;
        const text = await readTextFile(file);
        if (text === null) continue;
        const { head } = split(text);
        const pr = field(head, "pr"), branch = field(head, "branch");
        if (!pr && !branch) continue;
        const status = (field(head, "status") || "").toLowerCase();
        tasks[file] = {
          ws: d.id, file, id: field(head, "id") || n.slice(0, -3), status, last: status === columns[columns.length - 1],
          folder: field(head, "folder"), worktree: field(head, "worktree"), terminal: field(head, "terminal"), tab: field(head, "tab"), pr, branch,
        };
      }
    }
    this.tasks = tasks;
    // A card whose pr: or branch: line was changed is looked at again now.
    for (const t of Object.values(tasks)) {
      const e = this.state.items[t.file];
      if (e && e.want !== undefined && e.want !== `${t.pr ?? ""}|${t.branch ?? ""}`) e.tried = 0;
    }
    // A task that's gone, or whose workspace is, is forgotten. One whose
    // workspace.jsonc is broken for now is kept.
    const there = new Set(defs.map((d) => d.id));
    for (const [file, e] of Object.entries(this.state.items)) {
      if (!tasks[file] && (!there.has(e.ws) || this.def(e.ws))) { delete this.state.items[file]; delete this.work[file]; }
    }
    this.loaded = true;
    this.save();
    this.publish();
  }

  // What ws-board draws: each card's one status.
  publish() {
    const now = Date.now();
    const out = {};
    for (const t of Object.values(this.tasks)) {
      const e = this.state.items[t.file];
      if (!e?.f) continue;
      const stale = e.err && now - (e.at ?? 0) > STALE ? e.err : null;
      out[t.file] = chip(e.f, stale);
    }
    if (JSON.stringify(out) !== JSON.stringify(shared("workspaces.prs") ?? null)) setShared("workspaces.prs", out);
  }

  // Every 500ms, from the switcher's timer.
  tick(cx) {
    if (!this.loaded) return;
    const now = Date.now();
    const ag = agents();
    for (const t of Object.values(this.tasks)) {
      if (agentOf(t, ag)?.status !== "working") continue;
      const w = (this.work[t.file] ??= { since: now, until: now });
      if (now - w.until > WORK_GAP) w.since = now;
      w.until = now;
    }
    this.deliver(cx, now, ag);
    if (!this.busy && now - this.looked >= 5000) { this.looked = now; this.look(cx, now); }
  }

  due(t, now) {
    const e = this.state.items[t.file];
    if (!e) return true;
    if (e.f?.state === "merged") return false;
    // A card in the last column: nothing more to learn once its pull request isn't open.
    if (t.last && e.f?.state !== "open") return false;
    return now - (e.tried ?? 0) >= (e.err ? RETRY : e.f?.state === "open" ? OPEN : SLOW);
  }

  look(cx, now) {
    const list = Object.values(this.tasks).filter((t) => this.due(t, now));
    if (!list.length) { this.publish(); return; } // a status may have gone stale meanwhile
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        if (this.me === null) {
          const r = await exec("gh", ["api", "user", "--jq", ".login"], { timeout: 30000 }).catch(() => null);
          this.me = r?.code === 0 ? r.stdout.trim() : "";
        }
        for (const t of list) {
          try { await this.read(t); }
          catch (x) { const e = this.state.items[t.file]; if (e) e.err = message(x); }
        }
        this.save();
        this.publish();
      } finally {
        this.busy = false;
      }
      cx.notify();
    });
  }

  // The GitHub repo a task's folder (its worktree, when it has one) pushes to.
  async repoOf(t) {
    const def = this.def(t.ws);
    let folder = t.worktree ? expand(t.worktree) : null;
    if (!folder || !(await exists(folder))) folder = def ? folderPath(def, t.folder) : null;
    if (!folder) return { error: "Its workspace is gone." };
    const hit = this.repos[folder];
    if (hit && (hit.repo || Date.now() - hit.at < SLOW)) return hit;
    const r = await exec("git", ["-C", folder, "remote", "get-url", "origin"]).catch(() => null);
    const repo = repoOfRemote(r?.stdout);
    return (this.repos[folder] = repo ? { repo } : { error: `${tilde(folder)} has no GitHub remote called origin.`, at: Date.now() });
  }

  // One look at a task's pull request: by its `pr:`, else the newest one of its branch.
  async read(t) {
    const now = Date.now();
    const e = (this.state.items[t.file] ??= { ws: t.ws, queue: [] });
    e.tried = now;
    e.want = `${t.pr ?? ""}|${t.branch ?? ""}`;
    const want = parsePr(t.pr);
    let repo = want?.repo ?? null;
    if (!repo) {
      const r = await this.repoOf(t);
      if (r.error) { e.err = r.error; return; }
      repo = r.repo;
    }
    const what = want ? String(want.number) : t.branch;
    if (!what || what.startsWith("-")) { e.err = t.pr ? `Its pr: line isn't a GitHub pull request: ${clean(t.pr)}` : "It has no branch."; return; }
    let r;
    try { r = await exec("gh", ["pr", "view", "--repo", repo, "--json", FIELDS, "--", what], { timeout: 60000 }); }
    catch (x) { r = { code: 1, stdout: "", stderr: /start|not found|ENOENT/i.test(message(x)) ? "gh isn't installed" : message(x) }; }
    if (r.code !== 0) {
      const why = String(r.stderr || r.stdout || "no answer").trim().split("\n")[0];
      // A branch nobody opened a pull request for yet: not an error, looked at again later.
      if (!want && /no pull requests found/i.test(why)) { e.err = null; e.at = now; return; }
      e.err = `Couldn't read ${repo} with gh: ${clean(why, 160)}`;
      return;
    }
    let raw = null;
    try { raw = JSON.parse(r.stdout); } catch {}
    if (!raw?.number) { e.err = `gh's answer for ${repo} couldn't be read.`; return; }
    const f = facts(raw);
    const w = this.work[t.file];
    const out = step(e.s ?? null, f, { now, me: this.me, workSince: w?.since, lastWorking: w?.until });
    Object.assign(e, { repo, s: out.s, f, at: now, err: null });
    if (out.wakes.length) e.queue = mergeWakes(e.queue ?? [], out.wakes);
    // Found by its branch: the card keeps the link from now on.
    if (!want) { t.pr = f.url; await this.update(t, { pr: f.url }); }
    for (const n of out.notes) await this.note(n, t, f);
  }

  // For the person: ready to merge, merged (its card moves), closed.
  async note(kind, t, f) {
    if (kind === "ready") {
      const c = f.checks;
      notify({
        title: `${t.id} is ready to merge`, level: "success",
        body: `Pull request #${f.number}: ${c.total ? `${c.passed} ${c.passed === 1 ? "check" : "checks"} passed` : "no checks"}${f.decision === "APPROVED" ? ", approved" : ""}, no conflicts.`,
      });
      return;
    }
    if (kind === "closed") {
      notify({ title: `${t.id}: pull request closed`, body: `#${f.number} was closed without merging. Its card stays where it is.`, level: "warning" });
      return;
    }
    const def = this.def(t.ws);
    if (!def) return;
    const columns = boardOf(def).columns, done = columns[columns.length - 1];
    if (t.status === done) return;
    t.status = done;
    t.last = true;
    await this.update(t, { status: done });
    notify({ title: `${t.id} merged`, body: `Pull request #${f.number} merged, so its card moved to ${label(done)}.`, level: "success" });
  }

  async update(t, fields) {
    for (let i = 0; i < 3; i++) {
      const old = await readTextFile(t.file);
      if (old === null) return;
      try { await writeTextFile(t.file, withFields(old, fields), old); return; } catch {} // changed under us: read it again
    }
  }

  // What waits for a card's agent goes in once the agent is free: never into a
  // turn that's running or a question it's asking. With no agent left, you're told.
  deliver(cx, now, ag) {
    for (const t of Object.values(this.tasks)) {
      const e = this.state.items[t.file];
      if (!e?.queue?.length || !e.f || this.sending.has(t.file)) continue;
      const wakes = stillTrue(e.queue, e.f);
      if (!wakes.length) { e.queue = []; this.save(); continue; }
      const a = agentOf(t, ag);
      if (a && (a.status === "working" || a.status === "blocked")) continue;
      const said = wakeLines(wakes, e.f).join(". ");
      if (!a) {
        e.queue = [];
        this.save();
        notify({
          title: `${t.id}: pull request #${e.f.number} needs someone`, level: "warning",
          body: `${said}. ${t.terminal ? "Its agent has ended" : "The card has no agent"}, so nobody was told.`,
        });
        continue;
      }
      if (now - (e.sent ?? 0) < RESEND) continue;
      e.sent = now;
      this.sending.add(t.file);
      const text = wakeText(t, e.repo, e.f, wakes);
      cx.spawn(async () => {
        try {
          // hc waits for a draft you're typing there, and refuses (nothing typed) if the
          // agent turned out to be asking something; then it's tried again.
          const r = await hc(["send", a.address, text]);
          if (r.code === 0) {
            e.queue = [];
            notify({
              title: `${t.id}: told ${a.program?.name ?? "its agent"} about pull request #${e.f.number}`, body: `${said}.`, level: "info",
              action: { name: "agent.focus", args: { terminal: a.address } },
            });
          }
        } catch {} finally {
          this.sending.delete(t.file);
          this.save();
        }
      });
    }
  }
}
