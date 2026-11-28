// Settings > Accounts' rules, without imports so `node --test` can check them: the page's one
// list (every agent's accounts in a row each), what each row says (accounts.js draws it), the row's ⋯ menu, the Remove and Sign out asks, when a limit
// resets in words, and how herdr-ws-account's answers merge into the page's copy of `list`.
// The data is herdr-ws-account's (ws-switcher/accounts/cli.js): `list [--cached]`, `usage`,
// `prepare`, `signin`, `cancel`, `signout`, `default`, `rename`, `remove`.

export const AGENTS = ["claude", "codex", "agy"];
export const TITLES = { claude: "Claude", codex: "Codex", agy: "Antigravity" };
// Herdr's own agent icons (programs.json's), drawn as pictures (not tinted).
export const ICONS = { claude: "icons/claude.svg", codex: "icons/codex.svg", agy: "icons/antigravity.svg" };

// Usage is read again when the page shows and the last read is older than this, and while the
// page stays open at most this often (CONTRACT: not faster than ~10 min).
export const USAGE_AGE = 10 * 60000;
// A full `list` (each CLI's status) again when the page shows, unless the last is this fresh.
export const LIST_AGE = 60000;
// A terminal sign-in (Antigravity) waits on its row this long at most, unless it's signed in first.
export const WAIT_AGE = 15 * 60000;
// Antigravity's hidden email run (`identify agy <id> --due`) at most this often per account.
export const IDENTIFY_AGE = 3600e3;

export const key = (agent, id) => `${agent}:${id}`;
// Where herdr-ws-account keeps a background sign-in's link while it waits (main: the .main folder),
// and the link it holds (one line, an http(s) URL), or null.
export const signinUrlFile = (home, agent, id) => `${home}/.herdr/accounts/${agent}/${id === "main" ? ".main" : id}/.signin-url`;
export function signinUrlOf(text) {
  const line = String(text ?? "").trim().split("\n")[0].trim();
  return /^https?:\/\/\S+$/.test(line) ? line : null;
}

// What herdr-ws-account's Antigravity sign-in waits for (the account's .signin-ask, one word):
// "code" (the code from the browser), "checking" (one was typed in), "wrong" (it didn't work), or null.
export const signinAskFile = (home, agent, id) => signinUrlFile(home, agent, id).replace(/-url$/, "-ask");
export const askOf = (text) => { const w = String(text ?? "").trim(); return ["code", "checking", "wrong"].includes(w) ? w : null; };

// The code line under a waiting Antigravity row: null when nothing's asked, else { button, off,
// message, tone }. ask: askOf's word; sending: the page is handing a code over; error: why that
// failed (herdr-ws-account's words).
export function codeView(ask, { sending = false, error = null } = {}) {
  if (!ask) return null;
  const busy = sending || ask === "checking";
  const message = error ? error
    : ask === "wrong" ? "That code didn't work. A new sign-in page opened in your browser: paste its code."
    : "";
  return { button: busy ? "Checking…" : "Sign in", off: busy, message, tone: error || ask === "wrong" ? "bad" : "" };
}

// The terminal tab a sign-in that needs typed input opens in.
export const signinTab = (agent) => `Sign in: ${TITLES[agent]}`;

// One JSON line on stdout (exit 0), else the first line of stderr as the error.
export function parseAnswer(r) {
  if (!r) return { error: "herdr-ws-account didn't answer." };
  if (r.code === 0) {
    const line = String(r.stdout ?? "").trim().split("\n").filter(Boolean).pop();
    try { return { value: JSON.parse(line) }; } catch { return { error: "herdr-ws-account's answer wasn't JSON." }; }
  }
  const words = String(r.stderr || r.stdout || "").trim().split("\n")[0].replace(/^herdr-ws-account:\s*/, "");
  if (r.code === 127) return { error: words || "Not installed.", code: 127 };
  return { error: words || `herdr-ws-account failed (exit ${r.code}).`, code: r.code };
}

// The page's groups: Claude, Codex, Antigravity in that order; an agent `list` found not
// installed (installed: false) is left out; null (only --cached, never looked) still shows.
export function groupsOf(list) {
  const agents = list?.agents ?? {};
  return AGENTS.filter((a) => agents[a] && agents[a].installed !== false)
    .map((a) => ({ agent: a, title: agents[a].title || TITLES[a], icon: ICONS[a], installed: agents[a].installed, accounts: agents[a].accounts ?? [] }));
}

// The page's one list, every agent's accounts in order: [{ group, a, sep }]; sep marks the row
// where the agent changes (not the first), which draws the line between agents.
export function rowsOf(list) {
  const rows = [];
  for (const g of groupsOf(list)) {
    g.accounts.forEach((a, i) => rows.push({ group: g, a, sep: i === 0 && rows.length > 0 }));
  }
  return rows;
}

// Add account's choices: the agents installed (true), or not looked at yet (null).
export const addChoices = (list) => groupsOf(list).map((g) => ({ agent: g.agent, title: g.title, icon: g.icon }));

// Used share's tone, as the status bar's: 85% and up red, 70% and up amber.
export const toneOf = (pct) => (pct >= 85 ? "bad" : pct >= 70 ? "warn" : "");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clock = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;

// When a limit resets, short and in local time, as the status bar's: "in 12m" within the hour,
// "4:30 PM" later today, "Fri 11:00 PM" within the week, else "Dec 1". "" when unknown.
export function resetsWhen(ms, now = Date.now()) {
  if (!ms) return "";
  const left = ms - now;
  if (left <= 0) return "now";
  if (left < 3600000) return `in ${Math.max(1, Math.round(left / 60000))}m`;
  const d = new Date(ms), n = new Date(now);
  if (d.toDateString() === n.toDateString()) return clock(d);
  if (left < 7 * 86400000 && d.getDay() !== n.getDay()) return `${DAYS[d.getDay()]} ${clock(d)}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// The Resets column: "Week · Wed 10:00 AM" (the limit's name alone without a time).
export function usageLine(top, now = Date.now()) {
  if (!top) return "";
  const when = resetsWhen(top.resets, now);
  return when ? `${top.label} · ${when}` : String(top.label ?? "");
}

// What one account row says. state (the page's, for this row): { signing, waiting, busy,
// failed, url, copied, usageReading, listing }. url: the background sign-in's link (Copy link
// beside Cancel, "Copied" for a moment after a click). failed: a background sign-in that ended without one
// ({ timedOut, offer }): its words, with Try again (and Sign in in a terminal when offered).
//   title: its name, else its email (herdr-ws-account's label); a named account's email is only
//     in its ⋯ menu (menuItems), so a name like "Work" keeps the email off the page
//   sub: the plan (dim, after the title)
//   usage: { pct, tone, line } when there's a top limit to show, else null
//   right: "usage" | "signed-out" | "signing" | "waiting" | "busy" | "failed" | "reading" | "unknown" | "unclear" | "none"
export function rowView(agent, a, state = {}, now = Date.now()) {
  // A main account with no name or email yet (signed out, or not looked at) is the CLI's own sign-in.
  const title = state.isNew && !a.signedIn ? `New ${TITLES[agent]} account`
    : a.main && !a.name && !a.email ? `${TITLES[agent]}'s own sign-in`
    : (a.label || a.name || a.email || TITLES[agent]);
  const sub = a.plan ? String(a.plan) : "";
  const top = a.top && typeof a.top.pct === "number" ? a.top : null;
  const usage = top ? { pct: Math.max(0, Math.min(100, Math.round(top.pct))), tone: toneOf(top.pct), line: usageLine(top, now) } : null;
  let right;
  if (state.signing || a.signingIn) right = "signing";
  else if (state.waiting) right = "waiting";
  else if (state.busy) right = "busy";
  else if (state.failed && a.signedIn !== true) right = "failed";
  else if (a.signedIn === false) right = "signed-out";
  else if (usage) right = "usage";
  else if (a.signedIn === true && state.usageReading) right = "reading";
  else if (a.signedIn == null && state.listing) right = "unknown";
  else if (a.signedIn == null && state.listed) right = "unclear";
  else right = "none";
  const note = right === "signing" ? "Finish in your browser…"
    : right === "waiting" ? `Finish signing in in the “${signinTab(agent)}” tab`
    : right === "failed" ? (state.failed.timedOut ? "Sign-in timed out" : "Not signed in")
    : right === "unknown" ? "Checking…"
    : right === "unclear" ? "Couldn't tell if it's signed in"
    : "";
  const copy = right === "signing" && state.url ? (state.copied ? "Copied" : "Copy link") : null;
  return { title, sub, isDefault: Boolean(a.isDefault), usage, right, note, copy };
}

// Words for a row while an action of its own runs.
export const BUSY_WORDS = { default: "Saving…", rename: "Saving…", signout: "Signing out…", remove: "Removing…", prepare: "Preparing…" };

// The row's ⋯ menu: [{ op, label, off?, tag?, sep?, info? }]. A named account's email comes first,
// dim and not clickable (info), since the row shows only the name. Make default only on a row that isn't;
// Sign in again on a signed-in row (a signed-out one has Sign in as its button); Sign out not
// for Antigravity (its CLI has none) nor a row already signed out; Remove off for the main
// account (it's the CLI's own sign-in).
export function menuItems(agent, a) {
  const items = [];
  if (a.name && a.email) items.push({ info: true, label: String(a.email) }, { sep: true });
  if (!a.isDefault) items.push({ op: "default", label: "Make default" });
  items.push({ op: "rename", label: "Rename…" });
  if (a.signedIn !== false) items.push({ op: "signin", label: "Sign in again" });
  items.push({ sep: true });
  if (a.signedIn !== false) {
    items.push(agent === "agy" ? { op: "signout", label: "Sign out", off: true, tag: "Remove it instead" } : { op: "signout", label: "Sign out…" });
  }
  items.push(a.main ? { op: "remove", label: "Remove…", off: true, tag: `${TITLES[agent]}'s own sign-in` } : { op: "remove", label: "Remove…" });
  return items;
}

const agentsWord = (n) => (n === 1 ? "One agent is on it: it keeps running until it restarts" : `${n} agents are on it: they keep running until they restart`);

// Remove's ask: what goes and what happens to agents running on it. on: how many live agents run
// on it (null: couldn't tell); next: the label new agents start on afterwards.
export function removeWords(agent, title, on, next) {
  const gone = agent === "agy" ? "Its sign-in and folder move to Herdr's trash." : "It's signed out and its folder moves to Herdr's trash.";
  const after = on == null ? `Agents on it keep running until they restart, then start on ${next}.`
    : on === 0 ? `New agents start on ${next}.`
    : `${agentsWord(on)}, then ${on === 1 ? "starts" : "start"} on ${next}.`;
  return `Remove “${title}”? ${gone} ${after}`;
}

// Sign out's ask (it can't be undone from here without signing in again).
export function signoutWords(title, on, main) {
  const own = main ? " It's the CLI's own sign-in, outside Herdr too." : "";
  const after = on == null || on === 0 ? "" : ` ${on === 1 ? "One agent is on it and stops" : `${on} agents are on it and stop`} working until you sign in again.`;
  return `Sign out of “${title}”?${own}${after}`;
}

// The account new agents start on once `id` is removed: the default, else (removing the default)
// the main account.
export function nextDefault(group, id) {
  const accounts = group?.accounts ?? [];
  const d = accounts.find((a) => a.isDefault && a.id !== id) ?? accounts.find((a) => a.main);
  return d ? (d.label || d.email || TITLES[group.agent]) : TITLES[group?.agent] ?? "the main account";
}

// How many live agents run on an account: the launcher's notes (~/.herdr/accounts/on/<core>/<t>
// = "<agent> <id>"), counted for terminals still live. notes: [{ core, terminal, text }];
// live: Set of live terminal addresses (bare ids here; "<machine>/<id>" elsewhere).
export function countOn(notes, live, agent, id) {
  let n = 0;
  for (const note of notes ?? []) {
    if (String(note.text ?? "").trim() !== `${agent} ${id}`) continue;
    if (live && !live.has(note.terminal)) continue;
    n += 1;
  }
  return n;
}

// The page's copy of `list` with one account's facts changed (usage's answer, a rename, a
// default). Returns a new object; an account it doesn't have leaves it as it was.
export function withAccount(list, agent, id, change) {
  if (!list?.agents?.[agent]) return list;
  const g = list.agents[agent];
  return { ...list, agents: { ...list.agents, [agent]: { ...g, accounts: g.accounts.map((a) => (a.id === id ? { ...a, ...change } : a)) } } };
}

// usage's answer merged into the account: its top (null keeps what was there when the read gave
// none), when, and signed-in state when it says.
export function withUsage(list, u, now = Date.now()) {
  if (!u?.agent) return list;
  const change = { usageAt: now };
  if (u.top) change.top = u.top;
  if (u.signedIn === true || u.signedIn === false) change.signedIn = u.signedIn;
  if (u.signedIn === false) change.top = null;
  return withAccount(list, u.agent, u.id, change);
}

// The default moved: one isDefault per agent.
export function withDefault(list, agent, id) {
  if (!list?.agents?.[agent]) return list;
  const g = list.agents[agent];
  return { ...list, agents: { ...list.agents, [agent]: { ...g, default: id, accounts: g.accounts.map((a) => ({ ...a, isDefault: a.id === id })) } } };
}

// A rename: the name, and the label it gives (name, else email, else what it was).
export function withName(list, agent, id, name) {
  const a = list?.agents?.[agent]?.accounts?.find((x) => x.id === id);
  if (!a) return list;
  const n = String(name ?? "").trim().slice(0, 60) || null;
  return withAccount(list, agent, id, { name: n, label: n || a.email || a.label });
}

// Antigravity accounts signed in with no email yet, whose hidden email run is due: [{ agent, id }].
// (Main's email is its own google_accounts.json's.) tried: keys asked already on this page.
export function identifyDue(list, tried = {}, now = Date.now()) {
  const out = [];
  for (const a of list?.agents?.agy?.accounts ?? []) {
    if (a.main || a.signedIn !== true || a.email || tried[key("agy", a.id)]) continue;
    if (a.identifyAt && now - a.identifyAt < IDENTIFY_AGE) continue;
    out.push({ agent: "agy", id: a.id });
  }
  return out;
}

// identify's answer: the email and plan its banner showed (the label follows: name, else email).
export function withIdentity(list, agent, id, { email, plan } = {}) {
  const a = list?.agents?.[agent]?.accounts?.find((x) => x.id === id);
  if (!a || !email) return list;
  return withAccount(list, agent, id, { email, plan: plan ?? a.plan ?? null, label: a.name || email, signedIn: true });
}

// Signed-in accounts whose usage is due: never read, or older than maxAge.
export function usageDue(list, now = Date.now(), maxAge = USAGE_AGE) {
  const out = [];
  for (const g of groupsOf(list)) {
    if (g.installed === false) continue;
    for (const a of g.accounts) {
      if (a.signedIn !== true) continue;
      if (!a.usageAt || now - a.usageAt >= maxAge) out.push({ agent: g.agent, id: a.id });
    }
  }
  return out;
}

// A terminal sign-in still waiting ({ "<agent>:<id>": { at, isNew } }): under WAIT_AGE old, the
// account still there and not signed in yet.
export function stillWaiting(waiting, list, now = Date.now()) {
  const out = {};
  for (const [k, w] of Object.entries(waiting && typeof waiting === "object" ? waiting : {})) {
    const at = w?.at;
    if (typeof at !== "number" || now - at >= WAIT_AGE) continue;
    const [agent, id] = k.split(":");
    const a = list?.agents?.[agent]?.accounts?.find((x) => x.id === id);
    if (list && !a) continue; // removed meanwhile
    if (a?.signedIn === true) continue;
    out[k] = { at, isNew: Boolean(w.isNew) };
  }
  return out;
}
