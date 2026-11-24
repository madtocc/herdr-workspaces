// Notifications: the rules of the bell in the tab bar and its list. No imports, so `node` can
// test it. Copied, the same, in ws-switcher (which keeps the log and the badge) and
// ws-notifications (the list); scripts/sync-from-home.sh refuses copies that differ.
//
// What the list holds, newest first in two groups:
//   Needs you (pinned until it's resolved; a click goes there and leaves it): an agent waiting
//     on you (sub-agents too), an automation run waiting in its terminal, a check nobody allowed,
//     a check that failed or a run that didn't start, a run missed while Herdr was closed, a card's
//     pull request failing, with changes asked for or conflicting while no agent works on it.
//   Updates (unread until clicked, Mark all read or 7 days; then dimmed until Clear read): an
//     agent that finished, an automation run that finished (not "nothing to do"), a card's pull
//     request ready to merge, merged or closed, and a few things only the system says (a machine
//     needs a login, the background runner didn't start, Settings fell back).
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
// The same event said again within this long (a background runner's note shown as a toast too)
// is one event.
export const SAME_MS = 10 * 60e3;

// The spaces list's avatar colors, so a workspace mark matches (the MARK table every mod that
// draws a workspace mark has).
export const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

const own = (o, k) => o != null && typeof o === "object" && Object.hasOwn(o, k);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// --- the log: { read: { id: when }, dismissed: { id or dedupe key: when }, events: [...] } ---

export const emptyStore = () => ({ read: {}, dismissed: {}, events: [] });

// The file's text as a store; anything unreadable is an empty one.
export function parseStore(text) {
  let raw = null;
  try { raw = JSON.parse(String(text ?? "")); } catch { return emptyStore(); }
  const s = obj(raw);
  const times = (m) => Object.fromEntries(Object.entries(obj(m)).filter(([, v]) => typeof v === "number" && isFinite(v)));
  const events = (Array.isArray(s.events) ? s.events : []).filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.at === "number");
  return { read: times(s.read), dismissed: times(s.dismissed), events };
}

// Older than 7 days goes (marks and events); at most MAX_EVENTS events, the newest.
export function pruneStore(store, now) {
  const s = store ?? emptyStore();
  const keep = (m) => Object.fromEntries(Object.entries(obj(m)).filter(([, at]) => now - at < EXPIRE_MS));
  const events = (s.events ?? []).filter((e) => now - e.at < EXPIRE_MS).sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
  return { read: keep(s.read), dismissed: keep(s.dismissed), events };
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
  return { read: marks(x.read, y.read), dismissed, events: events.filter((e) => !own(dismissed, e.id)).sort((p, q) => q.at - p.at) };
}

// A finished agent's row is read or dismissed for that one finish: once the agent is seen working or
// idle again, its marks go, so its next finish is news. (Its id is stable across a restart, when Herdr
// forgets when its tab last changed.) agents: agents(); returns the store, the same one if nothing went.
export function forgetEpisodes(store, agents) {
  const again = (agents ?? []).filter((a) => a.status === "working" || a.status === "idle").map((a) => `agent:${a.address}:${a.tab}:done`);
  if (!again.length) return store;
  const drop = (m) => { const out = { ...obj(m) }; let n = 0; for (const k of again) if (own(out, k)) { delete out[k]; n++; } return [out, n]; };
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
  return null;
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
//   | { kind: "board", ws, taskId } | { kind: "automation", ws, name } | { kind: "action", name, args }
//   | null. goneNote: what's no longer there ("Tab closed"); with a fallbackLabel a click does that
// ("Open in History"), else the row is gone (gone: true) and a click does nothing.
export function buildItems({ agents = [], terminals = [], spaces = [], defs = [], assigned = {}, runs = [], automations = {}, prs = null, store = null, features = {}, now = Date.now() } = {}) {
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
          add({ id: `run:${r.id}`, group: "updates", tone: "done", title: `${r.name} finished`, ...base,
            detail: r.summary ?? r.why ?? "", at: tabs.get(r.tab)?.changed_at ?? r.at ?? now, target: go });
        }
        continue;
      }
      if (r.status === "started" && r.closed) {
        if (now - r.closed >= EXPIRE_MS) continue;
        if (r.outcome === "nothing to do") continue;
        const history = on("history");
        const it = { ...base, at: r.closed, target: history ? { kind: "history", ws: r.ws, runId: r.id } : null };
        const failed = r.outcome === "failed";
        add({ id: `run:${r.id}`, group: "updates", tone: failed ? "warn" : "done", title: `${r.name} ${failed ? "failed" : "finished"}`, ...it,
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
        add({ id: global ? `run:*/${r.name}:waiting` : `run:${r.id}`, group: "needs", tone: "blocked", title: `Allow ${r.name}'s check?`, detail: `${r.cmd ?? a.check ?? ""} · waiting for approval`, ...every, at: r.at ?? now, target: everyGo });
        continue;
      }
      if (now - (r.at ?? 0) >= EXPIRE_MS) continue;
      if (r.status === "failed" && r.check) {
        add({ id: `run:${r.id}`, group: "needs", tone: "blocked", title: `${r.name}'s check failed`, detail: trimDot(r.what ?? r.note ?? ""), ...base, at: r.at ?? now, target: auto });
      } else if (r.status === "failed") {
        add({ id: `run:${r.id}`, group: "updates", tone: "warn", title: `${r.name} didn't start`, detail: trimDot(r.note ?? r.what ?? ""), ...base, at: r.at ?? now, target: auto });
      } else if (r.status === "missed") {
        const key = `missed/${r.name}/${Math.floor((r.at ?? 0) / 60e3)}`;
        if (global) { if (once.has(key)) continue; once.add(key); }
        add({ id: global ? `run:*/${r.name}:missed:${Math.floor((r.at ?? 0) / 60e3)}` : `run:${r.id}`, group: "updates", tone: "warn", title: `${r.name} didn't run`, detail: trimDot(r.why ?? "Missed while Herdr was closed"), ...every, at: r.at ?? now, target: everyGo });
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
    add({ id: ev.id, group: "updates", tone: ev.tone ?? "done", title: ev.title, detail: ev.detail ?? "", ...wsInfo(ev.ws), place: ev.place ?? "", at: ev.at, target: ev.target ?? null, ...gone });
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
export function summaryOf(items) {
  const needs = items.filter((x) => x.group === "needs").length;
  const unread = items.filter((x) => x.group === "updates" && x.unread).length;
  const readN = items.filter((x) => x.group === "updates" && !x.unread).length;
  const parts = [];
  if (needs) parts.push({ text: `${needs} need${needs === 1 ? "s" : ""} you`, tone: "blocked" });
  if (unread) parts.push({ text: needs ? `${unread} unread` : `${unread} unread update${unread === 1 ? "" : "s"}`, tone: "done" });
  if (!parts.length && readN) parts.push({ text: `0 unread · ${readN} recent`, tone: "muted" });
  return parts;
}

// The heights the list draws at (main.js uses these), so the popup is as tall as what it shows.
// head: the title row with its padding; summary and scope: the lines under it; a row with a detail
// line (row) or without (rowShort); foot: the key hints and Clear read; empty: the caught-up note.
export const SIZES = { width: 392, max: 556, head: 43, summary: 20, scope: 30, listPad: 12, section: 28, row: 72, rowShort: 53, foot: 35, empty: 196, frame: 2 };
export const rowHeight = (it) => (it.detail || it.goneNote ? SIZES.row : SIZES.rowShort);
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

// "now", "4m", "2h", "Yesterday", "3d".
export function ago(ms, now) {
  const d = Math.max(0, now - ms);
  if (d < 60e3) return "now";
  if (d < 3600e3) return `${Math.floor(d / 60e3)}m`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h`;
  if (d < 2 * 86400e3) return "Yesterday";
  return `${Math.floor(d / 86400e3)}d`;
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
