// Notifications: the rules of the bell in the tab bar and its list. No imports, so `node` can
// test it. Copied, the same, in ws-switcher (which keeps the log and the badge) and
// ws-notifications (the list); scripts/sync-from-home.sh refuses copies that differ.
//
// What the list holds, newest first in two groups:
//   Needs you (pinned until it's resolved; a click goes there and leaves it): an agent waiting
//     on you (sub-agents too), an automation run waiting in its terminal, a check or a script nobody
//     allowed, a check that failed or a run that didn't start, a shell run that failed or a run that
//     timed out (while it's the automation's newest), a run missed while Herdr was closed, a card's
//     pull request failing, with changes asked for or conflicting while no agent works on it.
//   Updates (unread until clicked, Mark all read or 7 days; then dimmed until Clear read): an
//     agent that used a Vault secret (quiet: logged here, never a toast; usageEvent), an agent that finished, an automation run that finished (not "nothing to do"; as the run's
//     `notify` level allows: a shell run only with results or all, none of any with none), a card's pull
//     request ready to merge, merged or closed, and a few things only the system says (a machine
//     needs a login, the background runner didn't start, Settings fell back), every error toast,
//     whole, and every toast that carries an undo (an Antigravity wipe's Put it back: undoOf), with its
//     button until the thing is put back, then "Put back “…”" (store.restored). A run that needs a look (failed, timed out, its check failed or isn't allowed, missed,
//     didn't start, or "no outcome": asked for its Outcome line and ended without one) is drawn in
//     the blocked colour wherever it is.
// Everything else (working or idle agents, runs still going, quiet or skipped checks, drafts,
// running checks, plain confirmations) stays out. Live things (agents, runs, pull requests'
// state) come from what Herdr and the runners publish; the rest is a log of events kept in
// ~/.herdr/notifications.json with what was read or dismissed.

export const NOTIF_FILE = ".herdr/notifications.json";
export const MAX_EVENTS = 50;
export const EXPIRE_MS = 7 * 86400e3;
export const ACT_KEY = "workspaces.notifications.act";
export const PUSH_KEY = "workspaces.notifications.push";
export const STORE_KEY = "workspaces.notifications.store";
export const BADGE_KEY = "workspaces.notifications.badge";
// What an undo became, by its key (ws-agents writes it: { [key]: { state, why, title, at } }, state
// "running" | "waiting" | "done" | "failed"), and whether ws-agents is there to take a press ({ at },
// every 5 s; missing or older than 15 s: away).
export const RESTORES_KEY = "workspaces.agents.restores";
export const AGENTS_ALIVE_KEY = "workspaces.agents.alive";
// The same event said again within this long (a background runner's note shown as a toast too)
// is one event.
export const SAME_MS = 10 * 60e3;

// The spaces list's avatar colors, so a workspace mark matches (the MARK table every mod that
// draws a workspace mark has).
export const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const own = (o, k) => o != null && typeof o === "object" && Object.hasOwn(o, k);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// --- the log: { read: { id: when }, dismissed: { id or dedupe key: when }, restored: { undo key: when },
// events: [...] } ---

export const emptyStore = () => ({ read: {}, dismissed: {}, events: [] });
// `restored` only once there is a mark in it, as `usage`.
const withRestored = (store, restored) => (restored && Object.keys(restored).length ? { ...store, restored } : store);

// How far ~/.herdr/vault/usage.jsonl has been read: { at, keys } (the newest line's time, and the lines
// of that same millisecond already taken), or null before the first read.
function usageCursor(c) {
  return c && typeof c === "object" && typeof c.at === "number" && isFinite(c.at)
    ? { at: c.at, keys: (Array.isArray(c.keys) ? c.keys : []).filter((k) => typeof k === "string").slice(-50) } : null;
}
const withUsage = (store, usage) => (usage ? { ...store, usage } : store);

// The file's text as a store; anything unreadable is an empty one.
export function parseStore(text) {
  let raw = null;
  try { raw = JSON.parse(String(text ?? "")); } catch { return emptyStore(); }
  const s = obj(raw);
  const times = (m) => Object.fromEntries(Object.entries(obj(m)).filter(([, v]) => typeof v === "number" && isFinite(v)));
  const events = (Array.isArray(s.events) ? s.events : []).filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.at === "number");
  return withUsage(withRestored({ read: times(s.read), dismissed: times(s.dismissed), events }, times(s.restored)), usageCursor(s.usage));
}

// Older than 7 days goes (marks and events); at most MAX_EVENTS events, the newest.
export function pruneStore(store, now) {
  const s = store ?? emptyStore();
  const keep = (m) => Object.fromEntries(Object.entries(obj(m)).filter(([, at]) => now - at < EXPIRE_MS));
  const events = (s.events ?? []).filter((e) => now - e.at < EXPIRE_MS).sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
  return withUsage(withRestored({ read: keep(s.read), dismissed: keep(s.dismissed), events }, keep(s.restored)), usageCursor(s.usage));
}

export const markRead = (store, id, now) => ({ ...store, read: { ...store.read, [id]: now } });
export function markAllRead(store, ids, now) {
  const read = { ...store.read };
  for (const id of ids ?? []) read[id] = now;
  return { ...store, read };
}
// Gone from the list: an event leaves the log; a live update (a finished run) is kept out by id.
export function dismissItem(store, id, now) {
  const ev = (store.events ?? []).find((e) => e.id === id);
  const dismissed = { ...store.dismissed, [id]: now, ...(ev?.dedupeKey ? { [ev.dedupeKey]: now } : {}) };
  return { ...store, dismissed, events: (store.events ?? []).filter((e) => e.id !== id) };
}
// Clear read: each of these (the read updates shown) dismissed.
export function clearRead(store, ids, now) {
  let s = store;
  for (const id of ids ?? []) s = dismissItem(s, id, now);
  return s;
}

// An event into the log, unless the same one (dedupe key) happened, was logged or was dismissed
// within SAME_MS (a background runner's note is logged, then shown as a toast that comes back here:
// its time is the note's, maybe hours old, so when it was logged counts too). An older one of the
// same key goes: the newer one is the news (unread again).
export function appendEvent(store, ev, now) {
  if (!ev || typeof ev.id !== "string") return store;
  const key = ev.dedupeKey ?? ev.id;
  const at = typeof ev.at === "number" ? ev.at : now;
  const near = (t) => typeof t === "number" && (Math.abs(at - t) < SAME_MS || Math.abs(now - t) < SAME_MS);
  if ((store.events ?? []).some((e) => e.id === ev.id || ((e.dedupeKey ?? e.id) === key && (near(e.at) || near(e.seenAt))))) return store;
  if (own(store.dismissed, key) && near(store.dismissed[key])) return store;
  const events = [{ ...ev, at, seenAt: now, dedupeKey: key }, ...(store.events ?? []).filter((e) => (e.dedupeKey ?? e.id) !== key)];
  return pruneStore({ ...store, events }, now);
}

// Two copies of the log (this one and the file's, written by another window meanwhile) as one: every
// mark (the later time), every event once.
export function mergeStore(a, b) {
  const x = a ?? emptyStore(), y = b ?? emptyStore();
  const marks = (m, n) => { const out = { ...obj(m) }; for (const [k, v] of Object.entries(obj(n))) out[k] = Math.max(out[k] ?? 0, v); return out; };
  const dismissed = marks(x.dismissed, y.dismissed);
  const events = [...(x.events ?? [])];
  for (const e of y.events ?? []) if (!events.some((z) => z.id === e.id)) events.push(e);
  // The usage cursor that has read further.
  const ux = usageCursor(x.usage), uy = usageCursor(y.usage);
  const usage = !ux ? uy : !uy ? ux : uy.at > ux.at ? uy : ux;
  return withUsage(withRestored({ read: marks(x.read, y.read), dismissed, events: events.filter((e) => !own(dismissed, e.id)).sort((p, q) => q.at - p.at) }, marks(x.restored, y.restored)), usage);
}

// --- Vault's usage notes: a secret used, as usage.jsonl says (CONTRACT: the CLI and the broker append) ---

export const USAGE_MERGE_MS = 10 * 60e3; // one secret, one agent, one target within this: one entry, counted
export const USAGE_BACK_MS = 86400e3;    // a read after a long gap (Herdr closed) goes back at most this far
export const USAGE_KEEP = 20;            // usage entries the log keeps
const clip = (v, n = 80) => { const t = String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const usageKey = (e) => `${e.at}|${e.scope ?? ""}|${e.name}|${e.agent ?? ""}|${e.terminal ?? ""}|${e.via ?? ""}|${e.target ?? ""}`;

// The usage lines (parsed: vaultfacts.js parseUsage) not taken yet, and where reading has got to.
// The first read (no cursor) takes none: what was there before isn't news. Never older than
// USAGE_BACK_MS. { fresh: [event], cursor }.
export function newUsage(events, cursor, now) {
  const list = (events ?? []).filter((e) => e && typeof e.at === "number" && typeof e.name === "string");
  const c = usageCursor(cursor);
  const newest = list.reduce((m, e) => Math.max(m, e.at), c?.at ?? -Infinity);
  const top = (at) => list.filter((e) => e.at === at).map(usageKey);
  if (!c) return { fresh: [], cursor: { at: isFinite(newest) ? newest : now, keys: isFinite(newest) ? top(newest) : [] } };
  const seen = new Set(c.keys);
  const fresh = list.filter((e) => (e.at > c.at || (e.at === c.at && !seen.has(usageKey(e)))) && e.at >= now - USAGE_BACK_MS).sort((a, b) => a.at - b.at);
  if (!fresh.length) return { fresh, cursor: c };
  const at = Math.max(c.at, newest);
  return { fresh, cursor: { at, keys: at === c.at ? [...c.keys, ...top(at).filter((k) => !seen.has(k))] : top(at) } };
}

// A use as a Bell entry, or null: note is what vaultfacts.js usageNote(event, level) gave (null: the
// notify level doesn't tell about it). Quiet: an Update the log keeps, never a toast. Only the
// secret's name, who used it and the host or command's name: never a value, a path or a header.
export function usageEvent(e, note) {
  if (!note || !e || typeof e.name !== "string" || typeof e.at !== "number") return null;
  const who = clip(e.agent, 40) || "Something";
  const name = clip(e.name, 64);
  const how = e.via === "run" ? `ran ${clip(e.target) || "a command"}` : `HTTP to ${clip(e.target) || "a host"}`;
  // A refused try (ok: false: refused, expired, denied, failed) is an entry of its own, never one use more.
  const key = `vault:${e.scope ?? ""}/${name}:${clip(e.agent, 40)}:${clip(e.terminal, 20)}:${e.via ?? ""}:${clip(e.target)}${e.ok === false ? ":refused" : ""}`;
  // A refused try says why, in usageNote's words (its body's first part; the workspace shows apart).
  const why = e.ok === false ? clip(String(note.body ?? "").split(" · ")[0], 100) : "";
  const detail = !why ? how : e.target && why.includes(clip(e.target)) ? why : `${why} · ${how}`;
  return {
    id: `ev:${key}@${e.at}`, dedupeKey: key, at: e.at, kind: "vault", quiet: true, count: 1,
    tone: e.ok === false ? "warn" : "dim", title: e.ok === false ? `${who} tried to use ${name}` : `${who} used ${name}`,
    how: detail, detail, ws: typeof e.ws === "string" && e.ws ? e.ws : null, place: "Secrets",
    target: { kind: "vault", ws: typeof e.ws === "string" && e.ws ? e.ws : null },
  };
}

// A usage entry into the log: the same secret, agent and target as an entry from within
// USAGE_MERGE_MS before is that entry, counted up (its id, so read stays read: it's quiet), else a new
// one. One dismissed within that time takes it too.
export function appendUsage(store, ev, now) {
  if (!ev || typeof ev.id !== "string") return store;
  const s = store ?? emptyStore();
  const key = ev.dedupeKey;
  const near = (t) => typeof t === "number" && ev.at - t < USAGE_MERGE_MS && ev.at - t >= -USAGE_MERGE_MS;
  if (own(s.dismissed, key) && near(s.dismissed[key])) return { ...s, dismissed: { ...s.dismissed, [key]: Math.max(s.dismissed[key], ev.at) } };
  const old = (s.events ?? []).find((e) => e.kind === "vault" && e.dedupeKey === key && near(e.lastAt ?? e.at));
  if (old) {
    const count = (old.count ?? 1) + 1;
    const merged = { ...old, count, lastAt: Math.max(old.lastAt ?? old.at, ev.at), detail: `${old.how ?? ev.how} · ${count} times` };
    return { ...s, events: (s.events ?? []).map((e) => (e === old ? merged : e)) };
  }
  // At most USAGE_KEEP of them, the newest, so they never push the log's other events out.
  let n = 0;
  const events = [{ ...ev, seenAt: now, lastAt: ev.at }, ...(s.events ?? [])].filter((e) => e.kind !== "vault" || ++n <= USAGE_KEEP);
  return pruneStore({ ...s, events }, now);
}

// A row is read or dismissed for that one time: once what it's about is over, its marks go, so the
// next time is news (a row again), never kept out for a week by an old dismissal. Only on a sign that
// it's over, never because something isn't listed (a restart lists nothing for a moment):
//   agent:<address>:<tab>:done       the agent seen working or idle again
//   agent:<address>:<tab>:blocked    the agent seen working, idle or done (it stopped needing you), or
//                                    its tab changed after the mark (it may have worked and stopped
//                                    again between two looks; after a restart Herdr doesn't know when
//                                    a tab changed, and the mark stays)
//   sub:<address>:blocked|error      the helper seen in another state
//   run:<id>:needs                   the run closed, or its agent seen working, idle or done (not stuck)
//   run:<id>:asked                   the run closed, or its agent seen working (it was answered)
//   prn:<file>:<label>:<number>      the card's pull request seen with another status (not while
//                                    GitHub can't be read: then it has none)
// A failed, timed-out or no-outcome run's row, and a failed check's, is run:<id>, and every run has an
// id of its own: dismissing one never hides the next. (Ids are stable across a restart, when Herdr
// forgets when a tab last changed.) agents: agents(); terminals: terminals(); runs:
// workspaces.automation.runs; prs: workspaces.prs; spaces: spaces() (each tab's changed_at). Returns
// the store, the same one if nothing went.
const OVER = new Set(["working", "idle", "done"]);
export function forgetEpisodes(store, agents, { terminals = [], runs = [], prs = null, spaces = [] } = {}) {
  const again = new Set();
  const changed = new Map();
  for (const sp of spaces ?? []) for (const c of sp?.tabs ?? []) if (c && typeof c.changed_at === "number") changed.set(c.id, c.changed_at);
  // A blocked mark (read or dismissed) made before its tab last changed.
  const stale = [];
  for (const a of agents ?? []) {
    if (a.status === "working" || a.status === "idle") again.add(`agent:${a.address}:${a.tab}:done`);
    if (OVER.has(a.status)) again.add(`agent:${a.address}:${a.tab}:blocked`);
    else if (changed.has(a.tab)) stale.push([`agent:${a.address}:${a.tab}:blocked`, changed.get(a.tab)]);
  }
  const s0 = store ?? emptyStore();
  for (const [k, at] of stale) for (const m of [s0.read, s0.dismissed]) if (own(obj(m), k) && m[k] < at) again.add(k);
  for (const k of terminals ?? []) {
    if (!k || k.state !== "live" || !k.parent || !(OVER.has(k.status) || k.status === "blocked" || k.status === "error")) continue;
    if (k.status !== "blocked") again.add(`sub:${k.address}:blocked`);
    if (k.status !== "error") again.add(`sub:${k.address}:error`);
  }
  for (const r of runs ?? []) {
    if (!r || typeof r !== "object" || r.status !== "started") continue;
    const ag = r.terminal ? (agents ?? []).find((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab)) : null;
    if (r.closed || (!r.stuck && OVER.has(ag?.status))) again.add(`run:${r.id}:needs`);
    if (r.closed || ag?.status === "working") again.add(`run:${r.id}:asked`);
  }
  // A pull request's marks other than the one it needs now (none: it's fine now).
  const prNow = [];
  if (prs && typeof prs === "object") {
    for (const [file, e] of Object.entries(prs)) {
      if (!e || typeof e.label !== "string" || !e.label) continue;
      prNow.push([`prn:${file}:`, own(NEEDS_PR, e.label) ? `prn:${file}:${e.label}:${e.number ?? ""}` : null]);
    }
  }
  const over = (k) => again.has(k) || (k.startsWith("prn:") && prNow.some(([pre, cur]) => k.startsWith(pre) && k !== cur));
  const drop = (m) => { const out = { ...obj(m) }; let n = 0; for (const k of Object.keys(out)) if (over(k)) { delete out[k]; n++; } return [out, n]; };
  const [read, a] = drop(store.read), [dismissed, b] = drop(store.dismissed);
  return a || b ? { ...store, read, dismissed } : store;
}

// --- which toasts are worth keeping ---

const trimDot = (s) => String(s ?? "").trim().replace(/\.$/, "");
const LOGIN = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/;
// The board card a toast's action opens: "ws-switcher.show/board/<workspace>/<card>".
const CARD_ACTION = /^ws-switcher\.show\/board\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/([A-Za-z0-9][A-Za-z0-9._-]*))?$/;

// A notify() payload ({ title, body, level, action, at }, from ws-toast or a background runner's
// note) as an event for the log, or null when it isn't one: what live state already shows (agents,
// automation runs, pull requests that need someone are drawn from what's published), and noise.
// A notification's undo, checked: { label, name, key, command, ws, place, done, opens } or null. name
// is the mod command a press runs (ws-agents.restore/<backup folder>), key what its outcome is filed
// under (RESTORES_KEY), command the same thing to paste (the bell's fallback, never on the toast), done
// the words once it's put back ("In Antigravity and History again."), opens what a click on the
// put-back row runs ({ name, args }: History at that conversation, ws-switcher.history-at/…).
export function undoOf(u) {
  const o = obj(u);
  const str = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const name = str(o.name, 200), key = str(o.key, 200);
  if (!name || !key) return null;
  const opensName = str(obj(o.opens).name, 300);
  const opens = opensName ? { name: opensName, args: obj(obj(o.opens).args) } : null;
  return { label: str(o.label, 40) ?? "Put it back", name, key, command: str(o.command, 1000), ws: str(o.ws, 100), place: str(o.place, 100), done: str(o.done, 200), opens };
}

// What a press shows, from the outcome filed under its key (ws-agents: { state: "running" | "done" |
// "failed", why, again, title, at }) and the press made here (pressedAt, or null):
//   "done"   put back by this press or another (why null): the toast closes, the row says "Put back"
//   "busy"   running, or pressed and nothing back yet, for up to PRESS_WAIT_MS ("Putting back…")
//   "note"   failed and it can be pressed again (again: true, "Close Antigravity first."): why, button
//   "said"   failed for good, or done before ("Already put back"): why, no button
//   "ready"  the button
// An outcome older than this press is the last press's, not this one's.
export const PRESS_WAIT_MS = 15000;
export function undoState(entry, pressedAt, now) {
  const e = entry && typeof entry === "object" ? entry : null;
  const fresh = e && (pressedAt == null || (e.at ?? 0) >= pressedAt);
  const why = fresh && e.why ? String(e.why) : null;
  if (fresh && e.state === "done") return why ? { state: "said", why } : { state: "done", why: null };
  if (fresh && e.state === "running") return { state: "busy", why: null };
  if (pressedAt != null && !fresh && now - pressedAt < PRESS_WAIT_MS) return { state: "busy", why: null };
  if (fresh && e.state === "failed") return e.again ? { state: "note", why: why ?? "Press it again." } : { state: "said", why: why ?? "It can't be put back." };
  return { state: "ready", why: null };
}

// The log's "put back" marks: an undo event whose key the outcome says is done gets one (when it was
// done), so the row still says "Put back" once Herdr restarts and the shared outcome is gone.
export function markRestored(store, restores, now) {
  const s = store ?? emptyStore();
  const r = obj(restores), restored = { ...obj(s.restored) };
  let changed = false;
  for (const ev of s.events ?? []) {
    const key = ev?.kind === "undo" ? ev.undo?.key : null;
    if (!key || own(restored, key) || obj(r[key]).state !== "done") continue;
    restored[key] = typeof r[key].at === "number" ? r[key].at : now;
    changed = true;
  }
  return changed ? { ...s, restored } : s;
}

export function classifyToast(toast) {
  const n = obj(toast);
  const title = String(n.title ?? "").trim();
  if (!title) return null;
  const body = String(n.body ?? "");
  const at = typeof n.at === "number" && isFinite(n.at) ? n.at : null;
  const act = n.action && typeof n.action.name === "string" ? n.action : null;
  const ev = (key, fields) => ({ id: `ev:${key}@${at ?? 0}`, dedupeKey: key, at, ...fields });
  // A machine that needs a login (herdr-core's own words).
  const login = LOGIN.exec(body.trim());
  if (login) return ev(`sys:login:${login[1]}`, { kind: "system", tone: "warn", title: `${login[1]} needs a login`, detail: `Run hc machine login ${login[1]}`, place: "Settings · Machines", target: { kind: "action", name: "ws-switcher.settings/machines" } });
  if (title === "The background runner didn't start") {
    return ev("sys:runner", { kind: "system", tone: "warn", title, detail: firstSentence(body) || "Herdr runs your automations itself while it's open", place: "Automations", target: { kind: "action", name: "mod.open", args: { name: "ws-automations" } } });
  }
  if (title === "Settings shows only the package's sections for now") {
    return ev("sys:settings", { kind: "system", tone: "warn", title: "Settings fell back to the package's sections", detail: "Herdr's Settings changed; the package needs an update", place: "Settings", target: { kind: "action", name: "ws-switcher.settings" } });
  }
  // A toast with an undo (a wipe's Put it back), whatever its level: kept with the button.
  const undo = undoOf(n.undo);
  if (undo) {
    return ev(`undo:${undo.key}`, {
      kind: "undo", tone: n.level === "error" ? "blocked" : "done", title: title.slice(0, 200), detail: body.replace(/\s+/g, " ").trim().slice(0, 2000),
      ws: undo.ws, place: undo.place ?? "Shown as a toast", undo, target: null,
    });
  }
  // A card's pull request: ready, merged, closed, or news nobody was told.
  const card = act ? CARD_ACTION.exec(act.name) : null;
  const ws = card?.[1] ?? null;
  const pr = (task, kind, fields) => {
    const number = Number(/#(\d+)/.exec(`${title} ${body}`)?.[1]) || null;
    const taskId = card?.[2] ?? task;
    return ev(`pr:${ws ?? "?"}:${taskId}:${kind}:${number ?? ""}`, {
      kind: "pr", ws, taskId, number, place: number ? `Board · PR #${number}` : "Board",
      target: ws ? { kind: "board", ws, taskId } : null, ...fields,
    });
  };
  let m;
  if ((m = /^(\S+) is ready to merge$/.exec(title))) return pr(m[1], "ready", { tone: "success", title, detail: trimDot(body.replace(/^Pull request #\d+:\s*/, "")) });
  if ((m = /^(\S+) merged$/.exec(title))) return pr(m[1], "merged", { tone: "done", title: `${m[1]} merged`, detail: trimDot(body) });
  if ((m = /^(\S+): pull request closed$/.exec(title))) return pr(m[1], "closed", { tone: "dim", title: `${m[1]}: pull request closed`, detail: trimDot(body) });
  if ((m = /^(\S+): pull request #\d+ needs someone$/.exec(title))) return pr(m[1], "needs", { tone: "warn", title, detail: trimDot(body) });
  // An error, kept whole (a toast shows a line of it for a few seconds), so a missed one can be read
  // later. Not one a live row already tells: Herdr's own "<agent> needs you" (level error, its action
  // agent.focus), the runner's toasts for a run that failed, stopped, timed out or didn't run (their
  // action opens the automation: ws-switcher.automation/<ws>/<name>, or mod.open of ws-automations),
  // and its "<automation> didn't start" (no action; the run's own row says it).
  if (n.level === "error") {
    if (/ didn't start$/.test(title)) return null;
    if (act && (act.name === "agent.focus" || act.name.startsWith("ws-switcher.automation/") || (act.name === "mod.open" && obj(act.args).name === "ws-automations"))) return null;
    const whole = body.replace(/\s+/g, " ").trim();
    return ev(`err:${hashOf(`${title}\n${whole}`)}`, {
      kind: "error", tone: "blocked", title: title.slice(0, 200), detail: whole.slice(0, 2000), place: "Shown as a toast",
      target: act ? { kind: "action", name: act.name, args: obj(act.args) } : null,
    });
  }
  return null;
}
// A short, stable name for a text (FNV-1a), so an error's key stays small in the log.
function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
const firstSentence = (s) => trimDot(String(s ?? "").split(/(?<=\.)\s/)[0] ?? "");

// --- the list ---

const NEEDS_PR = { "Checks failing": "checks failing", "Changes requested": "changes requested", Conflicts: "conflicts with its base" };

// A workspace's mark color: its own (a theme color's name or "#hex"), else its place in the list's.
export function wsColorOf(def, defs) {
  if (!def) return null;
  const c = def.color ?? PALETTE[Math.max(0, (defs ?? []).findIndex((d) => d.id === def.id)) % PALETTE.length];
  return String(c).startsWith("#") ? c : MARK[c] ?? c;
}

// What a terminal's title says when it tells more than the program's name (not a path or a prompt).
function telling(title, program) {
  const s = String(title ?? "").replace(/[⠀-⣿✳✶✻✽✢·*⠂⠐]\s*/gu, "").trim();
  if (!s || s === program?.name || s.toLowerCase() === String(program?.key ?? "").toLowerCase()) return "";
  if (/^[~/]|^[A-Za-z]:\\/.test(s) || s.includes("@")) return "";
  return s;
}

// The card a pull request's entry is (workspaces.prs is keyed by the task's file).
function cardOf(file, e) {
  const ws = e?.ws ?? /\/workspaces\/([^/]+)\/tasks\/[^/]+$/.exec(file)?.[1] ?? null;
  const taskId = e?.taskId ?? /([^/]+)\.md$/.exec(file)?.[1] ?? null;
  return { ws, taskId };
}

// The unified list, as the bell shows it. Live data as Herdr's functions give it (agents, terminals,
// spaces), the switcher's shared state (defs, assigned, runs: workspaces.automation.runs, automations:
// workspaces.automations, prs: workspaces.prs), the log (store, with `live`: id -> when first seen) and
// features (Settings > Features; a missing key is on). Each item:
//   { id, group: "needs"|"updates", tone, title, detail, ws, wsName, wsColor, place, at, unread, pinned,
//     gone, goneNote, fallbackLabel, target }
// target: { kind: "agent", terminal } | { kind: "tab", tab } | { kind: "history", ws, runId }
//   | { kind: "board", ws, taskId } | { kind: "automation", ws, name } | { kind: "vault", ws } | { kind: "action", name, args }
//   | null. goneNote: what's no longer there ("Tab closed"); with a fallbackLabel a click does that
// ("Open in History"), else the row is gone (gone: true) and a click does nothing.
export function buildItems({ agents = [], terminals = [], spaces = [], defs = [], assigned = {}, runs = [], automations = {}, prs = null, store = null, restores = null, features = {}, now = Date.now() } = {}) {
  const on = (k) => obj(features)[k] !== false;
  if (!on("notifications")) return [];
  const s = store ?? emptyStore();
  const read = obj(s.read), dismissed = obj(s.dismissed), live = obj(s.live);
  const defOf = (id) => (defs ?? []).find((d) => d.id === id && !d.error) ?? null;
  const wsInfo = (ws) => { const d = defOf(ws); return { ws: d ? ws : null, wsName: d?.name ?? "", wsColor: wsColorOf(d, defs) }; };
  const tabs = new Map(), spaceOfTab = new Map();
  for (const sp of spaces ?? []) for (const c of sp.tabs ?? []) { tabs.set(c.id, c); spaceOfTab.set(c.id, sp); }
  const liveTerms = new Map((terminals ?? []).filter((x) => x.state === "live").map((x) => [String(x.address), x]));
  const seen = (id, fallback) => (typeof live[id] === "number" ? live[id] : fallback ?? now);
  const items = [];
  const add = (it) => { if (!own(dismissed, it.id)) items.push({ gone: false, goneNote: null, fallbackLabel: null, pinned: it.group === "needs", unread: it.group === "needs" || !own(read, it.id), detail: "", place: "", ...it }); };

  // Automation runs: the ones still going whose agent is in the list are shown as the run. A finished
  // run is one row, run:<id>, from its open stage to its closed one, so a read or a dismissal carries
  // over; a run the runner closes by itself (it reports its outcome, the automation doesn't keep it, no
  // card) is listed only once it's closed and its outcome is known (a "nothing to do" one never is).
  const runTerms = new Set();
  if (on("automations")) {
    const newest = new Map();
    for (const r of runs ?? []) { const k = `${r.ws}/${r.name}`; if (!newest.has(k) || (newest.get(k).at ?? 0) < (r.at ?? 0)) newest.set(k, r); }
    // The newest run of each automation that has ended (waiting for a slot or still going doesn't
    // count): a failure or a timeout stays pinned while it's that.
    const newestEnded = new Map();
    for (const r of runs ?? []) {
      if (!r || r.status === "queued" || r.status === "running" || (r.status === "started" && !r.closed)) continue;
      const k = `${r.ws}/${r.name}`;
      if (!newestEnded.has(k) || (newestEnded.get(k).at ?? 0) < (r.at ?? 0)) newestEnded.set(k, r);
    }
    const once = new Set(); // a global automation's row said once for every workspace
    for (const r of runs ?? []) {
      if (!r || typeof r !== "object") continue;
      const a = ((automations ?? {})[r.ws] ?? []).find((x) => x.name === r.name) ?? null;
      const latest = newest.get(`${r.ws}/${r.name}`) === r;
      const auto = { kind: "automation", ws: r.ws, name: r.name };
      const base = { ...wsInfo(r.ws), place: "Automations" };
      if (r.status === "started" && !r.closed) {
        const ag = r.terminal ? (agents ?? []).find((x) => x.address === r.terminal && (!r.tab || x.tab === r.tab)) : null;
        if (ag) runTerms.add(`${ag.address} ${ag.tab}`);
        const tabThere = Boolean(r.tab && tabs.has(r.tab));
        const go = tabThere ? { kind: "tab", tab: r.tab } : { kind: "history", ws: r.ws, runId: r.id };
        if (r.stuck || ag?.status === "blocked") {
          add({ id: `run:${r.id}:needs`, group: "needs", tone: "blocked", title: `${r.name} needs you`, ...base,
            detail: r.stuck && ag?.status !== "blocked" ? "Its agent is asking something before it starts" : "Its agent is waiting for you",
            at: tabs.get(r.tab)?.changed_at ?? r.at ?? now, target: go });
        } else if (ag?.status === "done" && !(r.reports && !a?.keep && !r.card)) {
          // A run that keeps its tab (keep, or a card's): the runner reads its outcome line when its first
          // turn ends (turnOutcome at turnDone; "none": it ended without one, it asked you something,
          // say). That holds only for that turn: while its tab hasn't changed since (Herdr forgets when
          // after a restart: then it's taken as that turn). "none" needs you, as History says it while
          // the tab is open; "failed" is a failure (Needs you too); the rest, or a later turn, finished as before.
          const tab = tabs.get(r.tab);
          const first = Boolean(r.turnDone && r.turnOutcome) && (tab?.changed_at == null || tab.changed_at <= r.turnDone);
          if (first && r.turnOutcome === "none") {
            add({ id: `run:${r.id}:asked`, group: "needs", tone: "blocked", title: `${r.name} needs you`, ...base,
              detail: "Its agent stopped without saying how it went", at: r.turnDone, target: go });
          } else {
            const failed = first && r.turnOutcome === "failed";
            // A failure is pinned under Needs you, as a failed shell run's is (the red badge).
            add({ id: `run:${r.id}`, group: failed ? "needs" : "updates", tone: failed ? "blocked" : "done", title: `${r.name} ${failed ? "failed" : "finished"}`, ...base,
              detail: r.summary ?? r.why ?? "", at: tab?.changed_at ?? r.at ?? now, target: go });
          }
        }
        continue;
      }
      if (r.status === "started" && r.closed) {
        if (now - r.closed >= EXPIRE_MS) continue;
        if (r.outcome === "nothing to do") continue;
        // Its tab went before it said how it ended (closed by hand, or gone with a restart): nothing to tell.
        if (r.closedWhy === "gone") continue;
        const history = on("history");
        const level = r.notify ?? (r.kind === "shell" ? "problems" : "results");
        const failed = r.outcome === "failed" || r.timedOut === true;
        // A failed shell run, or any run stopped by its timeout: pinned while it's the newest that ended.
        if (failed && (r.kind === "shell" || r.timedOut)) {
          if (level === "none" || newestEnded.get(`${r.ws}/${r.name}`) !== r) continue;
          const shell = r.kind === "shell";
          add({ id: `run:${r.id}`, group: "needs", tone: "blocked", ...base, place: shell ? "Automations · Shell" : "Automations",
            // A script the runner stopped (it stopped itself, say) has no exit code: "stopped", not "exit ?".
            // herdr-ws-secret refused before the script started (r.vault: the kind): the summary says why.
            title: r.vault ? `${r.name} didn't run` : r.timedOut ? `${r.name} timed out` : shell && (r.closedWhy === "stopped" || r.exitCode == null) ? `${r.name} stopped` : `${r.name} failed (exit ${r.exitCode})`,
            detail: shell ? trimDot(r.summary || r.note || "") : "Stopped after timeout",
            at: r.closed, target: history ? { kind: "history", ws: r.ws, runId: r.id } : auto });
          continue;
        }
        // Asked for its Outcome line and ended its turn without one (it asked you something, say): how it
        // went isn't known, so it reads "no outcome", as in History, never "finished". Like a failure, it
        // needs a look (the blocked colour) and the "problems" level shows it.
        const unknown = !failed && r.kind !== "shell" && Boolean(r.reports) && !r.outcome;
        // What finished as the run's level says: a shell run only with results or all; none, never.
        if (level === "none" || (!failed && !unknown && level === "problems")) continue;
        const it = { ...base, ...(r.kind === "shell" ? { place: "Automations · Shell" } : {}), at: r.closed, target: history ? { kind: "history", ws: r.ws, runId: r.id } : null };
        add({ id: `run:${r.id}`, group: "updates", tone: failed || unknown ? "blocked" : "done", title: unknown ? `${r.name}: no outcome` : `${r.name} ${failed ? "failed" : "finished"}`, ...it,
          detail: r.summary ?? "", ...(r.summary ? {} : history ? { goneNote: "Tab closed", fallbackLabel: "Open in History" } : { gone: true, goneNote: "Tab closed" }) });
        continue;
      }
      // What kept a run from starting: only while it's the automation's newest entry and the automation
      // is still there and on. A check nobody allowed stays pinned until it's allowed; a failing check
      // too, for 7 days; a run that didn't start or didn't run is an update (7 days, dismissable).
      if (!latest || !a || a.enabled === false) continue;
      const global = a.scope === "global";
      // A global one's check is allowed once for every workspace, and a miss is logged in each at the
      // same moment: one row, for every workspace.
      const every = global ? { ws: null, wsName: "", wsColor: null, place: "Every workspace · Automations" } : base;
      const everyGo = global ? { kind: "automation", ws: "*", name: r.name } : auto;
      if (r.status === "waiting" && a.allowed !== true) {
        if (global) { if (once.has(`waiting/${r.name}`)) continue; once.add(`waiting/${r.name}`); }
        // A shell automation's script nobody allowed (made outside Herdr, or changed on disk) before its check.
        const script = a.scriptAllowed === false;
        // Each wait is a row of its own, so a closed one comes back at the next: one workspace's by its
        // run id, an every-workspace one's by its entry's minute (as a miss's).
        add({ id: global ? `run:*/${r.name}:waiting:${Math.floor((r.at ?? 0) / 60e3)}` : `run:${r.id}`, group: "needs", tone: "blocked", title: script ? `Allow ${r.name}'s script?` : `Allow ${r.name}'s check?`,
          detail: script ? "Added outside Herdr · waiting for approval" : `${r.cmd ?? a.check ?? ""} · waiting for approval`, ...every, at: r.at ?? now, target: everyGo });
        continue;
      }
      if (now - (r.at ?? 0) >= EXPIRE_MS) continue;
      if (r.status === "failed" && r.check) {
        add({ id: `run:${r.id}`, group: "needs", tone: "blocked", title: `${r.name}'s check failed`, detail: trimDot(r.what ?? r.note ?? ""), ...base, at: r.at ?? now, target: auto });
      } else if (r.status === "failed") {
        add({ id: `run:${r.id}`, group: "updates", tone: "blocked", title: `${r.name} didn't start`, detail: trimDot(r.note ?? r.what ?? ""), ...base, at: r.at ?? now, target: auto });
      } else if (r.status === "missed") {
        const key = `missed/${r.name}/${Math.floor((r.at ?? 0) / 60e3)}`;
        if (global) { if (once.has(key)) continue; once.add(key); }
        add({ id: global ? `run:*/${r.name}:missed:${Math.floor((r.at ?? 0) / 60e3)}` : `run:${r.id}`, group: "updates", tone: "blocked", title: `${r.name} didn't run`, detail: trimDot(r.why ?? "Missed while Herdr was closed"), ...every, at: r.at ?? now, target: everyGo });
      }
    }
  }

  // Agents waiting on you or finished, everywhere (an automation run's agent is its run above).
  for (const ag of agents ?? []) {
    if (ag.status !== "blocked" && ag.status !== "done") continue;
    if (runTerms.has(`${ag.address} ${ag.tab}`)) continue;
    const tab = tabs.get(ag.tab), sp = spaceOfTab.get(ag.tab);
    const name = ag.program?.name || "An agent";
    const blocked = ag.status === "blocked";
    const tabName = tab?.named ? tab.name : null;
    const id = `agent:${ag.address}:${ag.tab}:${ag.status}`;
    add({
      id, group: blocked ? "needs" : "updates", tone: blocked ? "blocked" : "done",
      title: `${name} ${blocked ? "needs you" : "finished"}`, detail: telling(ag.title, ag.program),
      ...wsInfo(assigned?.[ag.space]), place: [sp?.name ?? ag.space_name, tabName].filter(Boolean).join(" · "),
      at: tab?.changed_at ?? seen(id), target: { kind: "agent", terminal: ag.address },
    });
  }
  // Sub-agents without a pane (not in agents()): waiting on you, or stopped with an error.
  const listed = new Set((agents ?? []).map((x) => String(x.address)));
  for (const k of liveTerms.values()) {
    if (!k.parent || listed.has(String(k.address)) || (k.status !== "blocked" && k.status !== "error")) continue;
    let root = k, guard = 0;
    while (root.parent && liveTerms.has(String(root.parent)) && guard++ < 20) root = liveTerms.get(String(root.parent));
    const ra = (agents ?? []).find((x) => x.address === root.address) ?? null;
    const id = `sub:${k.address}:${k.status}`;
    const who = k.program?.name ?? k.labels?.["hc.name"] ?? k.name ?? "A helper";
    add({
      id, group: "needs", tone: "blocked", title: k.status === "error" ? `${who} stopped with an error` : `${who} needs you`,
      detail: ra ? `A helper of ${ra.program?.name ?? "an agent"}` : "A helper agent", ...wsInfo(ra ? assigned?.[ra.space] : null),
      place: ra?.space_name ?? "", at: seen(id), target: { kind: "agent", terminal: String(k.address) },
    });
  }

  // Cards' pull requests that need someone while no agent works on them.
  const needsCard = new Set();
  if (on("board") && prs && typeof prs === "object") {
    for (const [file, e] of Object.entries(prs)) {
      // A message to the card's agent is on its way (prs.js): it's being handled, not news yet.
      if (!e || !own(NEEDS_PR, e.label) || e.waking) continue;
      const { ws, taskId } = cardOf(file, e);
      const ag = e.terminal ? (agents ?? []).find((x) => x.address === e.terminal && (!e.tab || x.tab === e.tab)) : null;
      if (ag?.status === "working") continue;
      needsCard.add(`${ws}/${taskId}`);
      const id = `prn:${file}:${e.label}:${e.number ?? ""}`;
      add({
        id, group: "needs", tone: "blocked", title: `${taskId}: ${NEEDS_PR[e.label]}`,
        detail: ag ? "Its agent isn't working on it" : "Nobody is working on it", ...wsInfo(ws), place: `Board · PR #${e.number}`,
        at: seen(id), target: ag ? { kind: "agent", terminal: ag.address } : { kind: "board", ws, taskId },
      });
    }
  }

  // The log: what only an event said.
  for (const ev of s.events ?? []) {
    if (!ev || typeof ev !== "object" || now - ev.at >= EXPIRE_MS) continue;
    let gone = {};
    if (ev.kind === "pr") {
      if (!on("board")) continue;
      if (ev.dedupeKey?.includes(":needs:") && needsCard.has(`${ev.ws}/${ev.taskId}`)) continue;
      if (prs && typeof prs === "object" && ev.ws && !Object.entries(prs).some(([f, e]) => { const c = cardOf(f, e); return c.ws === ev.ws && c.taskId === ev.taskId; })) {
        gone = { gone: true, goneNote: "Card removed" };
      }
    }
    if (ev.target?.kind === "tab" && !tabs.has(ev.target.tab)) gone = { gone: true, goneNote: "Tab closed" };
    if (ev.target?.kind === "agent" && !liveTerms.has(String(ev.target.terminal))) gone = { gone: true, goneNote: "Agent ended" };
    if (ev.target?.kind === "action" && ev.target.args?.name === "ws-automations" && !on("automations")) continue;
    if (ev.kind === "vault" && !on("vault")) continue;
    if (ev.kind === "undo" && ev.undo?.key) {
      const u = ev.undo, entry = obj(restores)[u.key];
      const doneAt = own(obj(s.restored), u.key) ? s.restored[u.key] : obj(entry).state === "done" ? entry.at ?? now : null;
      if (doneAt != null) {
        const name = obj(entry).title || /“(.+)”/.exec(ev.title)?.[1] || "";
        add({ id: ev.id, group: "updates", tone: "done", title: name ? `Put back “${name}”` : "Put back", detail: u.done ?? "", ...wsInfo(ev.ws), place: ev.place ?? "", at: doneAt, target: u.opens ? { kind: "action", name: u.opens.name, args: u.opens.args } : null, undo: null });
      } else {
        add({ id: ev.id, group: "updates", tone: ev.tone ?? "done", title: ev.title, detail: [ev.detail, u.command ? `Or: ${u.command}` : ""].filter(Boolean).join(" "), ...wsInfo(ev.ws), place: ev.place ?? "", at: ev.at, target: null, undo: { label: u.label, name: u.name, key: u.key } });
      }
      continue;
    }
    add({ id: ev.id, group: "updates", tone: ev.tone ?? "done", title: ev.title, detail: ev.detail ?? "", ...wsInfo(ev.ws), place: ev.place ?? "", at: ev.kind === "vault" ? ev.lastAt ?? ev.at : ev.at, target: ev.target ?? null, ...gone });
  }

  const needs = items.filter((x) => x.group === "needs").sort((a, b) => b.at - a.at);
  const updates = items.filter((x) => x.group === "updates" && now - x.at < EXPIRE_MS)
    .sort((a, b) => (a.unread === b.unread ? b.at - a.at : a.unread ? -1 : 1));
  return [...needs, ...updates];
}

// --- what the bell and the list show ---

// The badge: everything that needs you plus the unread updates; red when anything needs you,
// blue for updates only, none at 0.
export function badgeOf(items) {
  const needs = (items ?? []).filter((x) => x.group === "needs").length;
  const unread = (items ?? []).filter((x) => x.group === "updates" && x.unread).length;
  const count = needs + unread;
  return { count, needs, unread, tone: needs ? "blocked" : unread ? "done" : null, label: count > 99 ? "99+" : count ? String(count) : "" };
}

// The scope chips show only when items are in more than one workspace and one is shown.
export function hasMultiWs(items, activeWs) {
  if (!activeWs) return false;
  return new Set((items ?? []).map((x) => x.ws ?? "").filter(Boolean)).size > 1;
}
// scope: "all" or "current" (the shown workspace's).
export const filterScope = (items, scope, activeWs) => (scope === "current" && activeWs ? (items ?? []).filter((x) => x.ws === activeWs) : items ?? []);

// The summary under the title: [{ text, tone }] ("2 need you · 3 unread", "0 unread · 4 recent").
// Unread updates in the blocked colour (an error, a run that failed or has no outcome, one that didn't
// start or run) are counted apart, in red, before the other unread: "2 failed · 1 unread". The badge
// stays blue for them: red is for Needs you.
export function summaryOf(items) {
  const needs = items.filter((x) => x.group === "needs").length;
  const failed = items.filter((x) => x.group === "updates" && x.unread && x.tone === "blocked").length;
  const unread = items.filter((x) => x.group === "updates" && x.unread && x.tone !== "blocked").length;
  const readN = items.filter((x) => x.group === "updates" && !x.unread).length;
  const parts = [];
  if (needs) parts.push({ text: `${needs} need${needs === 1 ? "s" : ""} you`, tone: "blocked" });
  if (failed) parts.push({ text: `${failed} failed`, tone: "blocked" });
  if (unread) parts.push({ text: needs || failed ? `${unread} unread` : `${unread} unread update${unread === 1 ? "" : "s"}`, tone: "done" });
  if (!parts.length && readN) parts.push({ text: `0 unread · ${readN} recent`, tone: "muted" });
  return parts;
}

// The heights the list draws at (main.js uses these), so the popup is as tall as what it shows.
// head: the title row with its padding; summary and scope: the lines under it; a row with a detail
// line (row) or without (rowShort); foot: the key hints and Clear read; empty: the caught-up note.
// undoRow: a row with an undo's button on its place line (20px, where the line is 16).
export const SIZES = { width: 392, max: 556, head: 43, summary: 20, scope: 30, listPad: 12, section: 28, row: 72, rowShort: 53, undoRow: 76, foot: 35, empty: 196, frame: 2 };
export const rowHeight = (it) => (it.undo ? SIZES.undoRow : it.detail || it.goneNote ? SIZES.row : SIZES.rowShort);
export const headHeight = ({ summary = false, multiWs = false } = {}) => SIZES.head + (summary ? SIZES.summary : 0) + (multiWs ? SIZES.scope : 0);
// The popup's height for these items: header, sections and rows, footer; at most SIZES.max.
export function panelHeight(items, { multiWs = false } = {}) {
  const list = items ?? [];
  if (!list.length) return SIZES.head + SIZES.empty + SIZES.frame;
  let h = headHeight({ summary: summaryOf(list).length > 0, multiWs }) + SIZES.listPad + SIZES.foot + SIZES.frame;
  for (const g of ["needs", "updates"]) {
    const rows = list.filter((x) => x.group === g);
    if (rows.length) h += SIZES.section + rows.reduce((a, x) => a + rowHeight(x), 0);
  }
  return Math.min(SIZES.max, h);
}

// How long ago, the one way every screen writes it, always rounded down: "now", "5m", "3h", "12d"
// (under 60 days), "4mo" (days/30, under 730 days), "2y" (days/365). Never "60m", "24h" or "27mo".
export function ago(ms, now) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const days = Math.floor(s / 86400);
  if (days < 60) return `${days}d`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

// The date and hour behind ago(), for its tooltip: "27 Nov 14:05", with the year when it isn't this one's
// ("3 Dec 2025 23:10"). Local time. "" without a time.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function stamp(ms, now) {
  if (!ms) return "";
  const d = new Date(ms), two = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear() === new Date(now ?? Date.now()).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// The next row for up (-1) or down (+1), wrapping; sel: the id highlighted now (null: none).
export function moveSel(rows, sel, dir) {
  if (!rows?.length) return null;
  const at = rows.findIndex((r) => r.id === sel);
  if (at < 0) return rows[dir > 0 ? 0 : rows.length - 1].id;
  return rows[(at + dir + rows.length) % rows.length].id;
}

// A short list of asks or toasts for the switcher (shared ACT_KEY and PUSH_KEY), newest last, so two
// close together are both done (each id once). Older than ttl goes, never done late.
export const QUEUE_KEEP = 64;
export function pushQueue(queue, item, now, id, ttl = 15000) {
  const list = (Array.isArray(queue) ? queue : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < ttl);
  return [...list, { ...item, id, at: now }].slice(-QUEUE_KEEP);
}
// The entries of a queue not done yet: { run, seen }; seen: the ids done (kept to the queue's).
export function drainQueue(queue, seen, now, ttl = 15000) {
  const list = Array.isArray(queue) ? queue : [];
  const done = new Set(seen ?? []);
  const run = list.filter((a) => a && typeof a === "object" && a.id != null && !done.has(a.id) && now - (a.at ?? 0) < ttl);
  return { run, seen: list.map((a) => a?.id).filter((x) => x != null) };
}

// A finished run's report as its terminal shows it (`hc read`): the outcome line the runner asks
// for (automations.js OUTCOME_ASK; the last such line on the screen) and the line said before it,
// as a one-line summary. { outcome: "done"|"failed"|"nothing to do"|null, summary: string|null }.
const OUTCOME_LINE = /^[\s>*_`#⏺●•-]*outcome[*_`]*\s*:\s*[*_`]*\s*(done|failed|nothing to do)[*_`.\s]*$/i;
export function outcomeOf(screen) {
  const rows = String(screen ?? "").replace(/\r/g, "").split("\n");
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = OUTCOME_LINE.exec(rows[i]);
    if (!m) continue;
    let j = i - 1;
    while (j >= 0 && !rows[j].trim()) j--;
    // The paragraph it ends: back to a blank row or the row a bullet or the agent's mark starts (a
    // long message wraps over several rows), at most 4 rows.
    const parts = [];
    for (let k = j; k >= 0 && k > j - 4 && rows[k].trim(); k--) {
      parts.unshift(rows[k]);
      if (/^\s*[>⏺●•*-]\s/.test(rows[k])) break;
    }
    const said = parts.map((x) => x.replace(/^[\s>⏺●•*-]+/, "").replace(/[*_`]/g, "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return { outcome: m[1].toLowerCase(), summary: said ? said.slice(0, 140) : null };
  }
  return { outcome: null, summary: null };
}
