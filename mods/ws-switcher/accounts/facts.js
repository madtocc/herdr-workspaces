// Herdr's accounts per agent, as plain data: the store (~/.herdr/accounts.json), the
// variables an agent starts under, which files an Antigravity shadow home shares, and the
// usage each agent reports as one meter. No imports, so `node --test` can test it.
//
// An account is { id, name? }. "main" is the agent's own sign-in (~/.claude, ~/.codex, the
// real HOME); any other id lives in ~/.herdr/accounts/<agent>/<id>/. One per agent is the
// default: what new agents start on.

export const AGENTS = ["claude", "codex", "agy"];
export const TITLES = { claude: "Claude", codex: "Codex", agy: "Antigravity" };
export const MAIN = "main";

// An id a folder can be named by: main, or 1-32 of a-z, 0-9, - and _.
export const validId = (id) => id === MAIN || /^[a-z0-9][a-z0-9_-]{0,31}$/.test(String(id ?? ""));
export const validAgent = (a) => AGENTS.includes(a);

// The store as read (any shape, or null) plus the account folders found on disk
// ({ claude: ["2"], … }), as { claude: { default, accounts: [{ id, name? }] }, … }:
// main first, then the stored ones in their order, then folders the store didn't know
// (sorted, numbers by value). A default that isn't an account falls back to main.
export function normalize(raw, found = {}) {
  const out = {};
  for (const agent of AGENTS) {
    const r = raw && typeof raw === "object" ? raw[agent] : null;
    const seen = new Set([MAIN]);
    const accounts = [{ id: MAIN }];
    const add = (a) => {
      const id = String(a?.id ?? "");
      if (!validId(id)) return;
      const name = typeof a?.name === "string" && a.name.trim() ? a.name.trim().slice(0, 60) : null;
      if (seen.has(id)) {
        if (name) accounts.find((x) => x.id === id).name = name;
        return;
      }
      seen.add(id);
      accounts.push(name ? { id, name } : { id });
    };
    for (const a of Array.isArray(r?.accounts) ? r.accounts : []) add(a);
    const extra = (found[agent] ?? []).filter((id) => validId(id) && !seen.has(id)).sort(byId);
    for (const id of extra) add({ id });
    const def = String(r?.default ?? MAIN);
    out[agent] = { default: seen.has(def) ? def : MAIN, accounts };
  }
  return out;
}

function byId(a, b) {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// The next free id for an agent: one more than the highest number used (folders included),
// at least 2 (main is the first).
export function nextId(store, agent, found = []) {
  let n = 1;
  for (const id of [...(store[agent]?.accounts ?? []).map((a) => a.id), ...found]) {
    if (/^\d+$/.test(id)) n = Math.max(n, Number(id));
  }
  return String(n + 1);
}

// The store as written: no main entry unless it has a name, no default when it's main.
export function serialize(store) {
  const out = { version: 1 };
  for (const agent of AGENTS) {
    const s = store[agent];
    if (!s) continue;
    const accounts = s.accounts.filter((a) => a.id !== MAIN || a.name).map((a) => (a.name ? { id: a.id, name: a.name } : { id: a.id }));
    if (!accounts.length && s.default === MAIN) continue;
    out[agent] = { default: s.default, accounts };
  }
  return JSON.stringify(out, null, 2) + "\n";
}

// The account an id names ("default" or nothing: the agent's default), or null.
export function pick(store, agent, id) {
  const s = store[agent];
  if (!s) return null;
  const want = !id || id === "default" ? s.default : id;
  return s.accounts.find((a) => a.id === want) ?? null;
}

// What an account is called: its name, else its email, else "Claude account 2" (main: "Claude").
export function label(agent, account, email) {
  if (account?.name) return account.name;
  if (email) return email;
  return account?.id === MAIN ? TITLES[agent] : `${TITLES[agent]} account ${account?.id}`;
}

// The folder an account keeps (not main's: the agent's own).
export const accountDir = (home, agent, id) => `${home}/.herdr/accounts/${agent}/${id}`;

// The variables an agent starts under on an account: { set: { NAME: value }, unset: [NAME] }.
// main changes nothing. Claude: its folder as CLAUDE_CONFIG_DIR, and every CLAUDECODE /
// CLAUDE_CODE_* variable it inherited cleared (a Claude started from a Claude session
// takes the session's sign-in from those, whatever its folder); USER stays (Claude's
// Keychain lookup needs it). Codex: CODEX_HOME. Antigravity: HOME (its shadow home).
export function envFor(agent, id, { home, env = {}, darwin = false } = {}) {
  const set = {}, unset = [];
  if (!id || id === MAIN) return { set, unset };
  const dir = accountDir(home, agent, id);
  if (agent === "claude") {
    set.CLAUDE_CONFIG_DIR = dir;
    for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) unset.push(k);
    unset.sort();
  } else if (agent === "codex") {
    set.CODEX_HOME = dir;
  } else if (agent === "agy") {
    set.HOME = `${dir}/home`;
    set.HERDR_WS_REAL_HOME = home;
    // macOS: the shadow home has no Keychain, so what the agent's commands keep there (gh's
    // token, git's https passwords) is reached with the real HOME: gh through a shim in the
    // account's bin folder (first on PATH), git through one more credential helper (after
    // yours, which find nothing there).
    if (darwin) {
      set.PATH = `${dir}/bin:${env.PATH ?? ""}`;
      const n = /^\d+$/.test(String(env.GIT_CONFIG_COUNT ?? "")) ? Number(env.GIT_CONFIG_COUNT) : 0;
      set.GIT_CONFIG_COUNT = String(n + 1);
      set[`GIT_CONFIG_KEY_${n}`] = "credential.helper";
      set[`GIT_CONFIG_VALUE_${n}`] = `!HOME='${home.replace(/'/g, "'\\''")}' git credential-osxkeychain`;
    }
  }
  set.HERDR_WS_ACCOUNT = `${agent}:${id}`;
  return { set, unset };
}

// env's lines, as the launcher reads them: "set NAME VALUE" and "unset NAME".
export function envLines({ set, unset }) {
  return [...unset.map((k) => `unset ${k}`), ...Object.entries(set).map(([k, v]) => `set ${k} ${v}`)].join("\n");
}

// --- Folders --------------------------------------------------------------------------

// Claude's folder: every entry of ~/.claude by link, except its own .claude.json (made from
// ~/.claude.json's settings and projects, never its sign-in) and macOS's .DS_Store.
export const CLAUDE_OWN = new Set([".claude.json", ".DS_Store", ".credentials.json"]);
export const CLAUDE_SEED_KEYS = ["mcpServers", "projects", "hasCompletedOnboarding", "lastOnboardingVersion", "installMethod", "autoUpdates", "githubRepoPaths"];
// Codex's: every entry of ~/.codex by link, except its sign-in.
export const CODEX_OWN = new Set(["auth.json", "auth.json.lock", "auth.lock", ".DS_Store"]);

// Antigravity's shadow home: every entry of the real HOME by link, except Library (the
// Keychain is reached through it: agy would see and overwrite the main sign-in, which is a
// Keychain item of a fixed name) and .gemini, which is a folder of its own. In .gemini,
// shared by link: settings and projects; its own: the sign-in and identity files, and
// antigravity-cli, a folder of its own again, where the conversations are shared (so
// --conversation <id> goes on under any account) and what holds a process or a sign-in is not.
// Library is a real folder of the account's own (agy makes Library/Application Support in it),
// holding its own keychain (agyKeychain()): never a link to the real ~/Library.
export const HOME_OWN = new Set(["Library", ".gemini", ".DS_Store", ".Trash", ".CFUserTextEncoding"]);
export const GEMINI_SHARED = new Set(["GEMINI.md", "settings.json", "projects.json", "extensions", "config", "antigravity"]);
export const AGYCLI_SHARED = new Set([
  "annotations", "bin", "brain", "builtin", "cache", "conversation_summaries.db", "conversations",
  "history.jsonl", "implicit", "jetbox_summaries_proto.pb", "knowledge", "scratch", "settings.json",
]);

// Where agy keeps a sign-in when its keyring can't (the account's own, never shared).
export const AGY_TOKEN = "antigravity-oauth-token";
// The account's own keychain. With HOME at the shadow home macOS takes
// $HOME/Library/Keychains/login.keychain-db as the default keychain, so agy's keyring saves the
// sign-in there; without one macOS shows "Keychain Not Found" (whose Reset To Defaults would set
// the real login keychain aside) and agy falls back to AGY_TOKEN after 5 s.
export const agyKeychain = (home, id) => `${accountDir(home, "agy", id)}/home/Library/Keychains/login.keychain-db`;
// agy's keyring item (service, account), as on the main login.
export const AGY_ITEM = ["gemini", "antigravity"];

// agy writes its settings.json by replacing the file, so an account's link to the shared one
// becomes a copy of its own the first time agy saves (a folder trusted there, say). Mended
// before each start: the folders trusted in the copy are added to the shared file, and the copy
// goes back to the link. The shared file wins for everything else (it's what the accounts share;
// a model picked under the account since is lost).
// main, own: the two files' JSON. { main: the shared file's new JSON or null (unchanged), relink }.
export function mendSettings(main, own) {
  const obj = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : null);
  const m = obj(main), o = obj(own);
  if (!m || !o) return { main: null, relink: false };
  const have = Array.isArray(m.trustedWorkspaces) ? m.trustedWorkspaces : [];
  const add = (Array.isArray(o.trustedWorkspaces) ? o.trustedWorkspaces : []).filter((w) => typeof w === "string" && !have.includes(w));
  return { main: add.length ? { ...m, trustedWorkspaces: [...have, ...add] } : null, relink: true };
}

// What to link in a mirrored folder: the entries of the source that the folder doesn't
// have yet and that aren't its own. `keep` decides by name: "own" (skip), "link".
export function linksToMake(srcNames, haveNames, keep) {
  const have = new Set(haveNames);
  return srcNames.filter((n) => n !== "." && n !== ".." && !have.has(n) && keep(n) === "link");
}

// --- Identity and usage ---------------------------------------------------------------

// Claude's plan words: planTier max_20x -> "Max 20x", else its subscriptionType.
export function claudePlan(s) {
  const tier = String(s?.planTier ?? "");
  const m = /^max_(\d+)x$/.exec(tier);
  if (m) return `Max ${m[1]}x`;
  const sub = String(s?.subscriptionType ?? "");
  return sub ? sub[0].toUpperCase() + sub.slice(1) : null;
}

// `claude auth status --json`: { signedIn, email, plan }.
export function claudeIdentity(text) {
  let s; try { s = JSON.parse(String(text)); } catch { return null; }
  if (!s || typeof s !== "object") return null;
  return { signedIn: s.loggedIn === true, email: s.loggedIn ? s.email ?? null : null, plan: s.loggedIn ? claudePlan(s) : null };
}

const cap = (w) => (w ? String(w)[0].toUpperCase() + String(w).slice(1) : null);

// Codex app-server's answers (JSON lines): account/read (id 2) and account/rateLimits/read
// (id 3). { signedIn, email, plan, rows } (rows null when it gave none).
export function codexAnswers(text) {
  const by = {};
  for (const line of String(text).split("\n")) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o && (o.id === 2 || o.id === 3)) by[o.id] = o;
  }
  const acct = by[2]?.result?.account ?? null;
  const limits = by[3]?.result ?? null;
  const signedIn = Boolean(acct) || Boolean(limits?.rateLimits);
  const plan = cap(acct?.planType ?? limits?.rateLimits?.planType ?? null);
  return { signedIn, email: acct?.email ?? null, plan: signedIn ? plan : null, rows: limits ? codexRows(limits) : null };
}

function codexWindow(mins) {
  const m = Number(mins);
  if (!Number.isFinite(m) || m <= 0) return "Limit";
  if (m <= 360) return m === 300 ? "5-hour" : `${Math.round(m / 60)}-hour`;
  if (m === 10080) return "Week";
  if (m >= 40000 && m <= 45000) return "Month";
  return `${Math.round(m / 1440)}-day`;
}

// Codex's limits as rows: each pool's primary and secondary window.
export function codexRows(res) {
  const pools = [];
  const main = res?.rateLimits;
  if (main) pools.push(main);
  for (const [id, p] of Object.entries(res?.rateLimitsByLimitId ?? {})) {
    if (p && String(p.limitId ?? id) !== String(main?.limitId ?? "codex")) pools.push(p);
  }
  const rows = [];
  for (const p of pools) {
    for (const w of [p.primary, p.secondary]) {
      if (!w || typeof w.usedPercent !== "number") continue;
      const span = codexWindow(w.windowDurationMins);
      const at = Number(w.resetsAt);
      rows.push({ label: p.limitName ? `${span} · ${p.limitName}` : span, pct: w.usedPercent, resets: Number.isFinite(at) && at > 0 ? Math.round((at * 1000) / 60000) * 60000 : null });
    }
  }
  return rows;
}

// Claude Code's /usage (stream-json): its usage_report's limits as rows, or null.
export function claudeRows(text) {
  let report = null;
  for (const line of String(text).split("\n")) {
    if (!line.includes("usage_report")) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    report = o.usage_report ?? o.message?.usage_report ?? report;
  }
  const limits = report?.rate_limits?.limits;
  if (!Array.isArray(limits)) return null;
  return limits.filter((r) => r && typeof r.percent === "number").map((r) => {
    const scoped = r.scope?.model?.display_name ?? r.scope?.surface?.display_name ?? null;
    const base = String(r.kind ?? "").startsWith("session") ? "5-hour" : "Week";
    const at = Date.parse(String(r.resets_at ?? "").replace(/\.\d+/, ""));
    return { label: scoped ? `${base} · ${scoped}` : base, pct: r.percent, resets: Number.isFinite(at) ? Math.round(at / 60000) * 60000 : null };
  });
}

// Antigravity's /usage (json): each group's limits as rows (what's used, not what's left), or null.
export function agyRows(text) {
  let o = null;
  for (const line of String(text).split("\n")) {
    if (!line.includes('"command"')) continue;
    try { o = JSON.parse(line); } catch { /* not the answer */ }
  }
  const groups = o?.command?.data?.groups;
  if (!Array.isArray(groups)) return null;
  const rows = [];
  groups.forEach((g, gi) => {
    for (const b of Array.isArray(g?.buckets) ? g.buckets : []) {
      if (typeof b?.remaining_fraction !== "number") continue;
      const span = b.window === "weekly" ? "Week" : b.window === "5h" ? "5-hour" : String(b.window ?? "Limit");
      const at = Date.parse(String(b.reset_time ?? "").replace(/\.\d+/, ""));
      // The first group is the main pool (Gemini models); the others say their name.
      const who = gi === 0 ? "" : ` · ${String(g?.name ?? "").replace(/ [Mm]odels$/, "")}`;
      rows.push({ label: `${span}${who}`, pct: Math.round((1 - b.remaining_fraction) * 1000) / 10, resets: Number.isFinite(at) ? Math.round(at / 60000) * 60000 : null });
    }
  });
  return rows.length ? rows : null;
}

// Signed out, as an agent's print run says it.
export const saysSignedOut = (text) => /Not logged in|Please run \/login|Authentication required|authentication failed|Please sign in|authentication required/i.test(String(text ?? ""));

// The most used limit (the first of equals; of two full ones, the one that resets later).
export function topRow(rows) {
  let top = null;
  for (const r of rows ?? []) {
    if (!r || typeof r.pct !== "number") continue;
    if (!top) { top = r; continue; }
    if (r.pct >= 100 && top.pct >= 100) { if ((r.resets ?? 0) > (top.resets ?? 0)) top = r; }
    else if (r.pct > top.pct) top = r;
  }
  return top;
}

// Antigravity's start banner, as on its screen (the logo on the left):
//   ▄▀▀▄   Antigravity CLI 1.5.19
//  ▀▀▀▀▀▀  sam@hey.dev (Google AI Pro)
// { email, plan } from the line after "Antigravity CLI", or null (signed out, not drawn yet).
// No agy command says who's signed in, and its token is never read: the screen is the one place.
export function agyBanner(screen) {
  const lines = String(screen ?? "").split("\n");
  const at = lines.findIndex((l) => /Antigravity CLI\b/.test(l));
  if (at < 0) return null;
  for (const l of lines.slice(at + 1, at + 3)) {
    const m = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\s+\(([^()]+)\)\s*$/.exec(l);
    if (m) return { email: m[1], plan: m[2].trim() };
  }
  return null;
}

// Antigravity's question about a folder it hasn't been trusted with, as on its screen:
//   Accessing workspace:
//   ~/.herdr/accounts/agy/2
//   Do you trust the contents of this project?
//   > Yes, I trust this folder
//     No, exit
// { folder, yes } (yes: "Yes, I trust this folder" is the chosen line, so Enter answers it), or null.
export function agyTrust(screen) {
  const lines = String(screen ?? "").split("\n");
  if (!lines.some((l) => /Do you trust the contents of this/i.test(l))) return null;
  const at = lines.findIndex((l) => /Accessing workspace:/i.test(l));
  const folder = at < 0 ? null : (lines.slice(at + 1).map((l) => l.trim()).find((l) => l) ?? null);
  return { folder, yes: lines.some((l) => /^\s*[>❯›]\s*Yes, I trust this folder/.test(l)) };
}

// A folder as the trust question names it, against ours: the same path, a trailing / aside
// (and macOS's /private/tmp for /tmp).
export const sameFolder = (a, b) => {
  const n = (p) => String(p ?? "").replace(/\/+$/, "").replace(/^\/private\/tmp(?=\/|$)/, "/tmp");
  return Boolean(a) && Boolean(b) && n(a) === n(b);
};

// Antigravity's interactive sign-in, as its screen shows it (agy 1.5.19, signed out):
//   Welcome to the Antigravity CLI. You are currently not signed in.
//   Select login method:
//   > 1. Google OAuth
//     2. Use a Google Cloud project
// then, with Google OAuth chosen (the browser opens by itself):
//   Your browser should open automatically. If not:
//   https://accounts.google.com/o/oauth2/auth?…   (wrapped over several lines)
//   Copy and paste the URL or click on the link below:
//   …
//   If you aren't automatically redirected, paste the authorization code below:
//   authorization code...
// and a wrong code:
//   Got an error: token exchange failed: oauth2: "invalid_grant" "Malformed auth code."
//   Press any key to go back.        (back to the login method, and a new link: a code fits its link only)
// Once signed in: the trust question for the folder (agyTrust()), then the banner (agyBanner()).
// { step: "banner" | "trust" | "error" | "code" | "method" | null, url?, error?, google? }
// (method: google is whether "Google OAuth" is the chosen line, so Enter picks it.)
export function agyLogin(screen) {
  const text = String(screen ?? "");
  const lines = text.split("\n");
  const b = agyBanner(text);
  if (b) return { step: "banner", ...b };
  if (agyTrust(text)) return { step: "trust" };
  const err = lines.find((l) => /Got an error:/.test(l));
  if (err && /Press any key to go back/i.test(text)) return { step: "error", error: err.replace(/^.*?Got an error:\s*/, "").trim() };
  if (/paste the authorization code below/i.test(text)) {
    const at = lines.findIndex((l) => /^\s*https:\/\//.test(l));
    let url = null;
    if (at >= 0) {
      const parts = [];
      for (const l of lines.slice(at)) {
        if (!l.trim() || /Copy and paste the URL|click on the link/i.test(l)) break;
        parts.push(l.trim());
      }
      url = parts.join("");
      if (!/^https:\/\/\S+$/.test(url)) url = null;
    }
    return { step: "code", url };
  }
  if (/Select login method/i.test(text)) return { step: "method", google: lines.some((l) => /^\s*[>❯›]\s*1\.\s*Google OAuth/.test(l)) };
  return { step: null };
}

// A code as Google's page shows it: one word of URL-safe characters (4/0A…), nothing that could
// press a key or start a new line in the terminal it's typed into.
export const validCode = (c) => /^[A-Za-z0-9/_.~%+=-]{6,512}$/.test(String(c ?? ""));

// The sign-in link a CLI prints while it waits for the browser, to copy into another browser:
//   Codex: "If your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/…"
//   agy:   "Authentication required. Please visit the URL to log in:\n  https://accounts.google.com/…"
// Claude's printed link is a different flow (it ends in a code to paste, which a background
// sign-in can't take), so it's null here: Claude's comes from the browser opener (cli.js).
// Only the link, never a code. null until it's there.
export function signinUrl(agent, text) {
  const t = String(text ?? "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const re = agent === "codex" ? /navigate to this URL to authenticate:\s*(https:\/\/\S+)/
    : agent === "agy" ? /visit the URL to log in:\s*(https:\/\/\S+)/
    : null;
  const m = re ? re.exec(t) : null;
  return m ? m[1] : null;
}

// The hidden email run is tried at most this often per account (the page asks on each visit).
export const IDENTIFY_AGE = 3600e3;
