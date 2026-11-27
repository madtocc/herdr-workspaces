// GitHub board items on board cards. A task with a `github_item:` line (what the
// board's Take writes: ws-board's GitHub view) is read again on GitHub every few
// minutes, all of them in one `gh api graphql` call, your gh login. Reads only:
// nothing here changes anything on GitHub.
//
//   - its card shows the item's status on the GitHub board (In review, Closed, …):
//     shared "workspaces.github", { <task file>: { label, tone, tip, url, number } },
//     drawn by ws-board;
//   - a title changed on GitHub changes the card's, unless you renamed the card;
//   - an issue or pull request that closes moves its card to the board's last
//     column, once, and you get a toast;
//   - a pull request of yours that closes the issue becomes the card's `pr:`, which
//     prs.js then follows.
//
// ghfacts.js has the rules. Ticked like prs.js: by the background runner when it's
// on, else by the switcher's sidebar copy. What it remembers (each card's title and
// whether it was closed, as last seen) is in ~/.herdr/runner/github.json.

import { shared, setShared, readTextFile, writeTextFile, notify } from "herdr";
import { exec } from "./posix.js";
import * as fs from "fs/promises";
import { wsDir, message, boardOf, split, field, withFields, Store } from "./automations.js";
import { ITEM_ID, itemsQuery, shape, chip, step, refOf, ghError } from "./ghfacts.js";
import { cardAt } from "./prs.js";

const EVERY = 300e3;  // how often the taken items are read
const RETRY = 120e3;  // … after gh couldn't read them
const SOON = 15e3;    // … when a card was just taken (and not more often than this)
const STALE = 1800e3; // a status this old is shown as not read lately
const BATCH = 50;     // items per call
const STORE = "github";

const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");

export class GhWatcher {
  constructor() {
    this.tasks = {};    // task file -> the task, for those with github_item:
    this.busy = false;
    this.loaded = false;
    this.checked = 0;
    this.state = { items: {}, tried: 0, err: null };
    this.store = new Store(STORE);
    this.restored = false;
  }

  save() { if (this.restored) this.store.write(this.state); }
  def(ws) { return (shared("workspaces.defs") ?? []).find((d) => d.id === ws && !d.error) ?? null; }

  // Every workspace's tasks that came from a GitHub board, read again (after the
  // switcher's folder watch).
  async load() {
    if (!this.restored) {
      this.state = { items: {}, tried: 0, err: null, ...((await this.store.read()) ?? {}) };
      this.restored = true;
    }
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
        const item = field(head, "github_item");
        if (!item || !ITEM_ID.test(item)) continue;
        const status = (field(head, "status") || "").toLowerCase();
        tasks[file] = {
          ws: d.id, file, id: field(head, "id") || n.slice(0, -3), item, github: field(head, "github"),
          title: field(head, "title") || "", status, last: status === columns[columns.length - 1],
          pr: field(head, "pr"), branch: field(head, "branch"),
        };
      }
    }
    this.tasks = tasks;
    // A task that's gone, or whose workspace is, is forgotten. One whose
    // workspace.jsonc is broken for now is kept. So is one now naming another item.
    const there = new Set(defs.map((d) => d.id));
    for (const [file, e] of Object.entries(this.state.items)) {
      const t = tasks[file];
      if (t ? e.item !== t.item : (!there.has(e.ws) || this.def(e.ws))) delete this.state.items[file];
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
      out[t.file] = chip(e.f, this.state.err && now - (e.at ?? 0) > STALE ? this.state.err : null);
    }
    if (JSON.stringify(out) !== JSON.stringify(shared("workspaces.github") ?? null)) setShared("workspaces.github", out);
  }

  // A card with nothing more to learn: done here and closed there.
  settled(t) {
    const f = this.state.items[t.file]?.f;
    return Boolean(t.last && f && (f.state === "closed" || f.state === "merged"));
  }

  // Every 500ms, from the switcher's timer (or the background runner's).
  tick(cx) {
    if (!this.loaded || this.busy) return;
    const now = Date.now();
    if (now - this.checked < 5000) return;
    this.checked = now;
    const list = Object.values(this.tasks).filter((t) => !this.settled(t));
    if (!list.length) return;
    const since = now - (this.state.tried ?? 0);
    const fresh = list.some((t) => !this.state.items[t.file]); // just taken: looked at soon
    if (since < (fresh ? SOON : this.state.err ? RETRY : EVERY)) { this.publish(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try { await this.look(list, now); }
      catch (x) { this.state.err = message(x); }
      finally { this.busy = false; }
      this.save();
      this.publish();
      cx.notify();
    });
  }

  async look(list, now) {
    this.state.tried = now;
    this.state.err = null;
    for (let i = 0; i < list.length; i += BATCH) {
      const part = list.slice(i, i + BATCH);
      const query = itemsQuery(part.map((t) => t.item));
      if (!query) continue;
      let r;
      try { r = await exec("gh", ["api", "graphql", "-f", `query=${query}`], { timeout: 60000 }); }
      catch (x) { r = { code: 1, stdout: "", stderr: /start|not found|ENOENT/i.test(message(x)) ? "gh isn't installed" : message(x) }; }
      // An item that's gone makes gh fail and still answer for the rest: the answer counts.
      let data = null;
      try { data = JSON.parse(r.stdout)?.data ?? null; } catch {}
      if (!Array.isArray(data?.nodes)) { this.state.err = ghError(r.stderr || r.stdout); continue; }
      const me = data.viewer?.login ?? null;
      const seen = {};
      for (const n of data.nodes) { const s = shape(n); if (s) seen[s.item] = s; }
      for (const t of part) {
        try { await this.one(t, seen[t.item] ?? null, me, now); }
        catch (x) { this.state.err = message(x); }
      }
    }
  }

  // One card against its item as GitHub has it now (null: not on the board any more).
  async one(t, got, me, now) {
    const e = (this.state.items[t.file] ??= { ws: t.ws, item: t.item });
    const { body: _text, ...seen } = got ?? {}; // the item's text isn't kept
    const f = got ? seen : { gone: true, number: e.f?.number ?? null, url: t.github ?? e.f?.url ?? null };
    const out = step(e.s ?? null, f, t, me);
    const fields = { ...out.fields };
    const def = this.def(t.ws);
    let moved = null;
    if (out.notes.includes("closed") && def) {
      const columns = boardOf(def).columns;
      moved = columns[columns.length - 1];
      fields.status = moved;
    }
    if (Object.keys(fields).length) await this.update(t, fields);
    if (fields.title) t.title = fields.title;
    if (fields.pr) t.pr = fields.pr;
    if (moved) {
      t.status = moved;
      t.last = true;
      notify({
        title: `${t.id}: ${f.state === "merged" ? "merged" : "closed"} on GitHub`, level: "info",
        body: `${refOf(f)} was ${f.state === "merged" ? "merged" : "closed"}, so its card moved to ${label(moved)}.`, ...cardAt(t),
      });
    }
    Object.assign(e, { ws: t.ws, item: t.item, s: out.s, f, at: now });
  }

  async update(t, fields) {
    for (let i = 0; i < 3; i++) {
      const old = await readTextFile(t.file);
      if (old === null) return;
      try { await writeTextFile(t.file, withFields(old, fields), old); return; } catch {} // changed under us: read it again
    }
  }
}
