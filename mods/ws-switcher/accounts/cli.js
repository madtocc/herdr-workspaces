// herdr-ws-account: the accounts each agent can start on (Settings > Accounts, the
// Agents menu's Switch account and herdr-ws-agent share it). facts.js has the rules.
//
//   herdr-ws-account list [--cached] [agent]   accounts, who each is and whether it's signed in (JSON)
//   herdr-ws-account usage <agent> <id>        its most used limit (JSON)
//   herdr-ws-account add <agent> [--name N]    a new account: its folder, then its sign-in (JSON)
//   herdr-ws-account prepare <agent> [--name N]  only the folder and the entry (JSON: its id)
//   herdr-ws-account signin <agent> <id>       sign in in the background, the browser opens (JSON)
//   herdr-ws-account login <agent> <id>        the same in this terminal (a CLI that asks for typed input)
//   herdr-ws-account code agy <id> <code>      the code from the browser, for a waiting Antigravity sign-in
//   herdr-ws-account cancel <agent> <id> [--drop]  stop a sign-in (--drop: and remove the new account)
//   herdr-ws-account signout <agent> <id>
//   herdr-ws-account env <agent> [id|default]  the variables to start under it, a line each
//   herdr-ws-account default <agent> <id>      what new agents start on
//   herdr-ws-account rename <agent> <id> [name]  no name: back to its email
//   herdr-ws-account banner agy <id> <terminal>  keep the email and plan agy's start banner shows there
//   herdr-ws-account identify agy <id> [--due]  start agy out of sight to read its banner (--due: not within the hour)
//   herdr-ws-account remove <agent> <id>       signs it out, moves its folder to ~/.herdr/trash
//
// Every check (list, usage) runs the agent's CLI with a do-nothing `open` first on its PATH
// and its input closed, so a signed-out account never opens a browser tab; only signin and
// login, which you start, may. Nothing here reads a sign-in's secret: who an account is
// comes from the CLIs' own status commands (Antigravity: its google_accounts.json, which
// holds emails only).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import * as F from "./facts.js";

const HOME = os.homedir();
const STORE = path.join(HOME, ".herdr", "accounts.json");
const CACHE = path.join(HOME, ".herdr", "cache", "accounts.json");
const TRASH = path.join(HOME, ".herdr", "trash");
const BINS = { claude: "claude", codex: "codex", agy: "agy" };
const DARWIN = process.platform === "darwin";

class Fail extends Error { constructor(msg, code = 1) { super(msg); this.code = code; } }

// --- Store ----------------------------------------------------------------------------

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeAtomic(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}
// Account folders on disk, per agent.
function found() {
  const out = {};
  for (const a of F.AGENTS) {
    try { out[a] = fs.readdirSync(path.join(HOME, ".herdr", "accounts", a), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
    catch { out[a] = []; }
  }
  return out;
}
const load = () => F.normalize(readJson(STORE), found());
const save = (store) => writeAtomic(STORE, F.serialize(store), 0o644);
function account(store, agent, id) {
  if (!F.validAgent(agent)) throw new Fail(`herdr-ws-account: no agent ${agent ?? ""} (claude, codex or agy)`, 2);
  const a = F.pick(store, agent, id);
  if (!a) throw new Fail(`herdr-ws-account: ${F.TITLES[agent]} has no account ${id}`, 3);
  return a;
}
const cacheAll = () => readJson(CACHE) ?? {};
function cachePut(key, facts) {
  const all = cacheAll();
  // A plain value (a program's path, false) as it is; facts merged into what's there.
  all[key] = facts && typeof facts === "object" ? { ...(all[key] && typeof all[key] === "object" ? all[key] : {}), ...facts } : facts;
  try { writeAtomic(CACHE, JSON.stringify(all)); } catch { /* a cache */ }
}

// --- Folders --------------------------------------------------------------------------

const names = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
function mirror(src, dst, keep) {
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  // An empty folder of its own where a link belongs (the agent ran before the folder was
  // made): the link instead, so what's shared is.
  for (const n of names(dst)) {
    if (keep(n) !== "link" || !fs.existsSync(path.join(src, n))) continue;
    const at = path.join(dst, n);
    try { if (!fs.lstatSync(at).isSymbolicLink() && fs.statSync(at).isDirectory() && names(at).length === 0) fs.rmdirSync(at); } catch { /* left */ }
  }
  for (const n of F.linksToMake(names(src), names(dst), keep)) {
    try { fs.symlinkSync(path.join(src, n), path.join(dst, n)); } catch { /* there now */ }
  }
}
// An account's folder, made or brought up to date (new entries of the agent's own folder linked).
function ensureFolder(agent, id) {
  if (id === F.MAIN) return;
  const dir = F.accountDir(HOME, agent, id);
  if (agent === "claude") {
    mirror(path.join(HOME, ".claude"), dir, (n) => (F.CLAUDE_OWN.has(n) ? "own" : "link"));
    const own = path.join(dir, ".claude.json");
    if (!fs.existsSync(own)) {
      const d = readJson(path.join(HOME, ".claude.json")) ?? {};
      const out = {};
      for (const k of F.CLAUDE_SEED_KEYS) if (k in d) out[k] = d[k];
      try { const fd = fs.openSync(own, "wx", 0o600); fs.writeSync(fd, JSON.stringify(out)); fs.closeSync(fd); } catch { /* made meanwhile */ }
    }
  } else if (agent === "codex") {
    mirror(path.join(HOME, ".codex"), dir, (n) => (F.CODEX_OWN.has(n) ? "own" : "link"));
  } else if (agent === "agy") {
    const home = path.join(dir, "home");
    mirror(HOME, home, (n) => (F.HOME_OWN.has(n) ? "own" : "link"));
    mirror(path.join(HOME, ".gemini"), path.join(home, ".gemini"), (n) => (F.GEMINI_SHARED.has(n) ? "link" : "own"));
    mendAgySettings(path.join(home, ".gemini", "antigravity-cli", "settings.json"));
    mirror(path.join(HOME, ".gemini", "antigravity-cli"), path.join(home, ".gemini", "antigravity-cli"), (n) => (F.AGYCLI_SHARED.has(n) ? "link" : "own"));
    if (!agyKeychain(id)) process.stderr.write("herdr-ws-account: couldn't make or unlock this Antigravity account's keychain; macOS may ask about it\n");
    // gh with the real HOME, so its Keychain token works (macOS; see facts.js envFor()).
    const gh = DARWIN ? onPath("gh") : null;
    const shim = path.join(dir, "bin", "gh");
    if (gh && !gh.startsWith(path.join(dir, "bin"))) {
      const text = `#!/bin/sh\n# gh with your real HOME: its token is in the Keychain, which this account's home can't reach.\nHOME="\${HERDR_WS_REAL_HOME:-$HOME}" exec '${gh.replace(/'/g, "'\\''")}' "$@"\n`;
      let now = null; try { now = fs.readFileSync(shim, "utf8"); } catch { /* none yet */ }
      if (now !== text) { fs.mkdirSync(path.dirname(shim), { recursive: true }); writeAtomic(shim, text, 0o755); }
    }
  }
}

// An account's antigravity-cli/settings.json that agy turned into a copy of its own: its trusted
// folders added to the shared file, and the link back (facts.js mendSettings()). The shared file
// is replaced only when it changes, and only if it's still what was read.
function mendAgySettings(own) {
  const shared = path.join(HOME, ".gemini", "antigravity-cli", "settings.json");
  try { if (fs.lstatSync(own).isSymbolicLink() || !fs.lstatSync(shared).isFile()) return; } catch { return; }
  let mainText; try { mainText = fs.readFileSync(shared, "utf8"); } catch { return; }
  let m, o; try { m = JSON.parse(mainText); o = JSON.parse(fs.readFileSync(own, "utf8")); } catch { return; }
  const r = F.mendSettings(m, o);
  if (!r.relink) return;
  try {
    if (r.main) {
      if (fs.readFileSync(shared, "utf8") !== mainText) return; // agy changed it meanwhile: next start
      writeAtomic(shared, JSON.stringify(r.main, null, 2) + "\n", fs.statSync(shared).mode & 0o777);
    }
    fs.unlinkSync(own);
    fs.symlinkSync(shared, own);
  } catch { /* left for the next start */ }
}

// An Antigravity account's own keychain (macOS), made when missing and unlocked: before
// every agy start under the account (the launcher's env, a sign-in, a check). Made with an
// empty password and no auto-lock; a reboot or sleep can still lock it, and a locked one
// would ask for a password, hence the unlock each time. HOME is the shadow home, so the
// real keychain list and default are never touched. True when it's there and unlocked.
function agyKeychain(id) {
  if (!DARWIN || id === F.MAIN) return true;
  const home = path.join(F.accountDir(HOME, "agy", id), "home");
  const k = F.agyKeychain(HOME, id);
  const sec = (args) => {
    try { execFileSync("/usr/bin/security", args, { env: { ...process.env, HOME: home }, stdio: "ignore", timeout: 15000 }); return true; } catch { return false; }
  };
  if (!fs.existsSync(k)) {
    fs.mkdirSync(path.dirname(k), { recursive: true, mode: 0o700 });
    if (!sec(["create-keychain", "-p", "", k])) return false;
    sec(["set-keychain-settings", k]);
  }
  return sec(["unlock-keychain", "-p", "", k]);
}
// Whether an Antigravity account holds a sign-in, by what's there only (never its value):
// the token file of agy's fallback, or its keyring item in the account's keychain.
function agyHasLogin(id) {
  const own = path.join(F.accountDir(HOME, "agy", id), "home", ".gemini", "antigravity-cli", F.AGY_TOKEN);
  try { if (fs.lstatSync(own).isFile() && fs.statSync(own).size > 0) return true; } catch { /* none */ }
  if (!DARWIN || !fs.existsSync(F.agyKeychain(HOME, id))) return false;
  // A locked keychain could ask for its password: unlocked first (it's never made here).
  try { execFileSync("/usr/bin/security", ["unlock-keychain", "-p", "", F.agyKeychain(HOME, id)], { env: { ...process.env, HOME: path.join(F.accountDir(HOME, "agy", id), "home") }, stdio: "ignore", timeout: 15000 }); } catch { /* then the look below fails */ }
  try {
    // Without -w or -g: the item's attributes only, never its secret.
    execFileSync("/usr/bin/security", ["find-generic-password", "-s", F.AGY_ITEM[0], "-a", F.AGY_ITEM[1], F.agyKeychain(HOME, id)], { stdio: "ignore", timeout: 10000 });
    return true;
  } catch { return false; }
}

// --- Running the CLIs -----------------------------------------------------------------

// An agent's program: on PATH, else where a login shell finds it (only the path taken
// from its output). Kept in the cache while it's there.
function binOf(agent) {
  const name = BINS[agent];
  const kept = cacheAll()["bin:" + name];
  const found = (bin) => { if (kept !== bin) cachePut("bin:" + name, bin); return bin; };
  if (kept && isExec(kept)) return kept;
  for (const d of String(process.env.PATH ?? "").split(path.delimiter)) {
    if (d && isExec(path.join(d, name))) return found(path.join(d, name));
  }
  for (const flags of ["-lc", "-lic"]) {
    try {
      const out = execFileSync(process.env.SHELL || "/bin/sh", [flags, `command -v ${name}`], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
      const bin = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).pop();
      if (bin && isExec(bin)) return found(bin);
    } catch { /* not there */ }
  }
  // Not installed: false in the cache (list --cached leaves it out too).
  found(false);
  return null;
}
// A program on PATH (no login shell): its path or null.
function onPath(name) {
  for (const d of String(process.env.PATH ?? "").split(path.delimiter)) if (d && isExec(path.join(d, name))) return path.join(d, name);
  return null;
}
function isExec(p) { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }

// The environment an account's CLI runs in. USER set (Claude's Keychain lookup needs it).
function envOf(agent, id, extra = {}) {
  const e = { ...process.env };
  const { set, unset } = F.envFor(agent, id, { home: HOME, env: e, darwin: DARWIN });
  for (const k of unset) delete e[k];
  Object.assign(e, set, extra);
  if (!e.USER) { try { e.USER = os.userInfo().username; } catch { /* left out */ } }
  return e;
}

// A folder with a do-nothing open / xdg-open, for checks that must never open a browser.
let quiet = null;
function noBrowser() {
  if (quiet) return quiet;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-acct-"));
  for (const n of ["open", "xdg-open"]) fs.writeFileSync(path.join(d, n), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.on("exit", () => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp */ } });
  quiet = d;
  return d;
}
const quietEnv = (e) => ({ ...e, PATH: `${noBrowser()}${path.delimiter}${e.PATH ?? ""}`, BROWSER: path.join(noBrowser(), "open") });

// Runs a program to its end (or the timeout): { code, stdout, stderr }.
function run(bin, args, { env, timeout = 60000, input = null, cwd = HOME, onSpawn = null, onData = null } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    const p = spawn(bin, args, { env, cwd, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"], detached: Boolean(onSpawn) });
    if (onSpawn) onSpawn(p);
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, timeout);
    p.stdout.on("data", (b) => { out += b; if (onData) onData(`${out}\n${err}`); });
    p.stderr.on("data", (b) => { err += b; if (onData) onData(`${out}\n${err}`); });
    p.on("error", (e) => { if (!done) { done = true; clearTimeout(t); resolve({ code: 127, stdout: out, stderr: String(e.message) }); } });
    p.on("close", (code, sig) => { if (!done) { done = true; clearTimeout(t); resolve({ code: code ?? (sig ? 128 : 1), stdout: out, stderr: err, signal: sig }); } });
    if (input != null) { p.stdin.end(input); }
  });
}

// Codex's app-server, asked for the account (id 2) and its limits (id 3); its answers as text.
function codexAsk(bin, env) {
  return new Promise((resolve) => {
    let out = "", sent = false, finished = false;
    const p = spawn(bin, ["app-server"], { env, cwd: HOME, stdio: ["pipe", "pipe", "ignore"] });
    const finish = () => { if (finished) return; finished = true; clearTimeout(t); try { p.kill(); } catch { /* gone */ } resolve(out); };
    const t = setTimeout(finish, 10000);
    p.on("error", finish);
    p.on("close", finish);
    p.stdout.on("data", (b) => {
      out += b;
      if (!sent && /"id":\s*1\b/.test(out)) {
        sent = true;
        p.stdin.write('{"jsonrpc":"2.0","id":2,"method":"account/read","params":{}}\n{"jsonrpc":"2.0","id":3,"method":"account/rateLimits/read","params":{}}\n');
      }
      if (/"id":\s*2\b/.test(out) && /"id":\s*3\b/.test(out)) finish();
    });
    p.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"herdr","version":"0.1"}}}\n');
  });
}

// Who an account is: { signedIn, email, plan } (signedIn null when it couldn't be told).
async function identity(agent, id) {
  const bin = binOf(agent);
  if (!bin) return { signedIn: null, email: null, plan: null, missing: true };
  // Checks change nothing: an account whose folder is gone is signed out.
  if (id !== F.MAIN && !fs.existsSync(F.accountDir(HOME, agent, id))) return { signedIn: false, email: null, plan: null };
  const env = quietEnv(envOf(agent, id));
  if (agent === "claude") {
    const r = await run(bin, ["auth", "status", "--json"], { env, timeout: 30000 });
    return F.claudeIdentity(r.stdout) ?? { signedIn: null, email: null, plan: null };
  }
  if (agent === "codex") {
    const a = F.codexAnswers(await codexAsk(bin, env));
    return { signedIn: a.signedIn, email: a.email, plan: a.plan, rows: a.rows };
  }
  // Antigravity: the active account its home's google_accounts.json names (emails only). agy
  // writes that file for the main login only; a second account's sign-in is told by what it
  // keeps (agyHasLogin()), and no agy command says its email (/usage, /credits, /help don't),
  // so it's called "Antigravity account N" until it's named.
  // Email and plan also come from its start banner (banner()), kept in the cache: main's
  // google_accounts.json wins for the email, the banner's is kept for the others.
  const g = readJson(path.join(id === F.MAIN ? HOME : path.join(F.accountDir(HOME, agent, id), "home"), ".gemini", "google_accounts.json"));
  const seen = cacheAll()[`agy:${id}`] ?? {};
  const own = typeof g?.active === "string" && g.active ? g.active : null;
  const signedIn = Boolean(own) || (id !== F.MAIN && agyHasLogin(id));
  return { signedIn, email: own ?? (signedIn ? seen.bannerEmail ?? null : null), plan: signedIn ? seen.bannerPlan ?? null : null };
}

async function usage(agent, id) {
  const bin = binOf(agent);
  if (!bin) return { signedIn: null, rows: null, top: null };
  if (id !== F.MAIN && !fs.existsSync(F.accountDir(HOME, agent, id))) return { agent, id, signedIn: false, rows: null, top: null };
  const env = quietEnv(envOf(agent, id));
  let rows = null, signedIn = null, r = null;
  // Antigravity signed out: not asked (a run would make its own folders where the shared
  // conversations go, and there's nothing to show).
  if (agent === "agy" && (await identity(agent, id)).signedIn === false) {
    cachePut(`${agent}:${id}`, { signedIn: false, top: null, usageAt: Date.now() });
    return { agent, id, signedIn: false, rows: null, top: null };
  }
  // Its keychain unlocked first, else macOS would ask for it (or say it's not found).
  if (agent === "agy") agyKeychain(id);
  if (agent === "claude") {
    r = await run(bin, ["-p", "/usage", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config", "--settings", '{"disableAllHooks":true}'], { env, timeout: 60000 });
    rows = F.claudeRows(r.stdout);
  } else if (agent === "codex") {
    const a = F.codexAnswers(await codexAsk(bin, env));
    rows = a.rows; signedIn = a.signedIn;
  } else {
    r = await run(bin, ["-p", "/usage", "--output-format", "json", "--log-file", "/dev/null"], { env, timeout: 60000 });
    rows = F.agyRows(r.stdout);
  }
  if (r) signedIn = rows ? true : F.saysSignedOut(`${r.stdout}\n${r.stderr}`) ? false : null;
  // Claude signed out prints only a cost summary: its own status says.
  if (signedIn === null && agent === "claude") signedIn = (await identity(agent, id)).signedIn;
  const top = F.topRow(rows);
  const facts = { top: top ?? null, usageAt: Date.now() };
  if (signedIn !== null) facts.signedIn = signedIn;
  cachePut(`${agent}:${id}`, facts);
  return { agent, id, signedIn, rows, top: top ?? null };
}

// --- Commands -------------------------------------------------------------------------

async function list(args) {
  const cached = args.includes("--cached");
  const only = args.find((a) => !a.startsWith("--"));
  const store = load();
  const cache = cacheAll();
  const out = {};
  const jobs = [];
  for (const agent of F.AGENTS) {
    if (only && agent !== only) continue;
    const s = store[agent];
    // --cached: what the last full look found (null: never looked).
    let bin = cached ? cache["bin:" + BINS[agent]] ?? null : binOf(agent);
    if (bin !== null && typeof bin !== "string" && bin !== false) bin = null; // an old, broken entry
    const entry = { title: F.TITLES[agent], installed: cached && bin === null ? null : Boolean(bin), default: s.default, accounts: [] };
    out[agent] = entry;
    for (const a of s.accounts) {
      const key = `${agent}:${a.id}`;
      const c = cache[key] ?? {};
      const row = {
        id: a.id, name: a.name ?? null, main: a.id === F.MAIN, isDefault: a.id === s.default,
        email: c.email ?? null, plan: c.plan ?? null, signedIn: c.signedIn ?? null,
        top: c.top ?? null, usageAt: c.usageAt ?? null, signingIn: signingIn(agent, a.id),
        ...(agent === "agy" ? { identifyAt: c.identifyAt ?? null } : {}),
      };
      row.label = F.label(agent, a, row.email);
      entry.accounts.push(row);
      if (!cached && bin) {
        jobs.push(identity(agent, a.id).then((idn) => {
          Object.assign(row, { email: idn.email, plan: idn.plan, signedIn: idn.signedIn });
          row.label = F.label(agent, a, row.email);
          const facts = { email: idn.email, plan: idn.plan, signedIn: idn.signedIn, at: Date.now() };
          // Codex's identity comes with its limits.
          if (idn.rows) { facts.top = F.topRow(idn.rows) ?? null; facts.usageAt = Date.now(); row.top = facts.top; row.usageAt = facts.usageAt; }
          cachePut(key, facts);
        }).catch(() => {}));
      }
    }
  }
  await Promise.all(jobs);
  return { agents: out };
}

// The folder Antigravity runs in for an account's sign-in: the account's own (main: the .main
// folder beside them, where its sign-in note goes), made when missing. Never the real home, which
// agy was never trusted with.
function agyFolder(id) {
  const dir = id === F.MAIN ? path.join(HOME, ".herdr", "accounts", "agy", ".main") : F.accountDir(HOME, "agy", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const signinFile = (agent, id) => path.join(id === F.MAIN ? path.join(HOME, ".herdr", "accounts", agent, ".main") : F.accountDir(HOME, agent, id), ".signin");
// The sign-in's link while it waits (one line, the URL only), for the page's Copy link.
const signinUrlFile = (agent, id) => `${signinFile(agent, id)}-url`;

// A background sign-in's link, kept in signinUrlFile from the moment it's known: what the CLI
// hands the browser (an `open` / `xdg-open` first on its PATH writes its URL, then runs the real
// one, so the browser still opens), else what it prints (facts.js signinUrl()). The opener's
// wins. Returns { env, onData, done } for run().
function signinLink(agent, id, env) {
  const file = signinUrlFile(agent, id);
  try { writeAtomic(file, ""); } catch { /* the page shows no link */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-signin-"));
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  for (const n of ["open", "xdg-open"]) {
    // The real one: first on the CLI's PATH (macOS: /usr/bin/open when none is).
    const real = String(env.PATH ?? "").split(path.delimiter).map((d) => d && path.join(d, n)).find((f) => f && isExec(f)) ?? (n === "open" && DARWIN ? "/usr/bin/open" : null);
    fs.writeFileSync(path.join(dir, n), `#!/bin/sh\n# The sign-in's link for Settings > Accounts' Copy link, then the browser as usual.\nfor a in "$@"; do case $a in http://*|https://*) printf '%s\\n' "$a" > ${q(file)}; break ;; esac; done\n${real ? `exec ${q(real)} "$@"` : "exit 1"}\n`, { mode: 0o755 });
  }
  let seen = false;
  const onData = (text) => {
    if (seen) return;
    const url = F.signinUrl(agent, text);
    if (!url) return;
    seen = true;
    try { if (!fs.readFileSync(file, "utf8").trim()) writeAtomic(file, `${url}\n`); } catch { /* left */ }
  };
  const done = () => {
    try { fs.unlinkSync(file); } catch { /* gone */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* tmp */ }
  };
  return { env: { ...env, PATH: `${dir}${path.delimiter}${env.PATH ?? ""}` }, onData, done };
}
function signingIn(agent, id) {
  const s = readJson(signinFile(agent, id));
  if (!s?.pid) return false;
  try { process.kill(s.pid, 0); return true; } catch { return false; }
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? "" : null;
}

function prepare(agent, name) {
  const store = load();
  if (!F.validAgent(agent)) throw new Fail(`herdr-ws-account: no agent ${agent ?? ""} (claude, codex or agy)`, 2);
  const id = F.nextId(store, agent, found()[agent]);
  ensureFolder(agent, id);
  store[agent].accounts.push(name && name.trim() ? { id, name: name.trim().slice(0, 60) } : { id });
  save(store);
  return id;
}

// The sign-in command, and whether it needs a terminal (typed input). Antigravity has no
// sign-in command: it asks when it starts (agySignin() runs it in a hidden terminal; login, the
// terminal fallback, agy itself).
function signinArgs(agent) {
  if (agent === "claude") return { args: ["auth", "login"] };
  if (agent === "codex") return { args: ["login"] };
  return { args: [], terminal: true };
}

// Antigravity's sign-in in the background. A print run can't finish it (agy waits for the code
// from the browser to be pasted, and a print run has no input), so agy runs interactively out of
// sight: in a herdr-core terminal of our own (no Herdr tab), HOME its shadow home, in the
// account's folder, its screen read every second (facts.js agyLogin()):
//   the login method: Google OAuth picked (Enter); agy opens the browser itself, and its link is
//     kept for Copy link (signinLink());
//   the code prompt: signinAskFile says "code", and the page shows a field; `code agy <id> <code>`
//     types it into the terminal (never into a file) and says "checking";
//   a wrong code: "wrong", a key back to the login method, and Google OAuth again (a new link: a
//     code only fits the link it came from);
//   signed in: the trust question for the account's own folder answered, the banner's email and
//     plan kept, agy left (/exit) and the terminal stopped and removed; settings.json mended.
// Gives up after SIGNIN_SECS (the answer offers the terminal sign-in, `offer`); a watchdog in the
// terminal ends agy a little later even if this process is gone. Cancel stops both.
const SIGNIN_SECS = 540;
const signinAskFile = (agent, id) => `${signinFile(agent, id)}-ask`;
function setAsk(agent, id, word) {
  const f = signinAskFile(agent, id);
  try { if (word) writeAtomic(f, `${word}\n`); else fs.unlinkSync(f); } catch { /* gone, or the page shows no field */ }
}
const readAsk = (agent, id) => { try { return fs.readFileSync(signinAskFile(agent, id), "utf8").trim() || null; } catch { return null; } };

async function agySignin(id, bin) {
  const dir = agyFolder(id);
  const file = signinFile("agy", id);
  const link = signinLink("agy", id, envOf("agy", id));
  setAsk("agy", id, null);
  // A terminal doesn't take this process's environment: the account's variables on env's line,
  // with the opener that keeps the link first on PATH (the browser still opens).
  const { set, unset } = F.envFor("agy", id, { home: HOME, env: process.env, darwin: DARWIN });
  const vars = { ...set, PATH: link.env.PATH };
  const t = await startHidden(dir, SIGNIN_SECS + 30, ["/usr/bin/env", ...unset.flatMap((k) => ["-u", k]), ...Object.entries(vars).map(([k, v]) => `${k}=${v}`), bin]);
  const out = (o) => ({ agent: "agy", id, ok: false, cancelled: false, signedIn: null, email: null, plan: null, ...o });
  if (!t) { link.done(); return out({ error: "couldn't start a terminal (hc)", offer: ["herdr-ws-account", "login", "agy", id] }); }
  writeAtomic(file, JSON.stringify({ pid: process.pid, terminal: t, at: Date.now() }));
  let ended = false;
  const end = async (atPrompt) => {
    if (ended) return;
    ended = true;
    await endTerminal(t, atPrompt).catch(() => {});
    link.done();
    setAsk("agy", id, null);
    try { fs.unlinkSync(file); } catch { /* gone */ }
  };
  // Cancel (herdr-ws-account cancel) ends this process: the terminal goes with it.
  let cancelled = false;
  process.once("SIGTERM", () => { cancelled = true; end(false).finally(() => process.exit(143)); });

  const until = Date.now() + SIGNIN_SECS * 1000;
  let found = null, why = "timeout", misses = 0, pressed = 0, shownUrl = null, checkingAt = 0;
  const press = async () => { if (Date.now() - pressed > 3000) { pressed = Date.now(); await hc(["keys", t, "enter"]); } };
  while (Date.now() < until && !ended) {
    await new Promise((r) => setTimeout(r, 1000));
    const screen = await hcRead(t);
    if (screen == null) { if (++misses >= 3) { why = "gone"; break; } continue; }
    misses = 0;
    const s = F.agyLogin(screen);
    const ask = readAsk("agy", id);
    if (s.step === "banner") { keepBanner(id, s); found = s; break; }
    if (s.step === "trust") {
      if (trustCall(screen, dir) !== "yes") { why = "trust"; break; }
      await press();
    } else if (s.step === "error") {
      // A wrong code: said on the row (the field stays), then back and Google OAuth again.
      if (ask !== "wrong") setAsk("agy", id, "wrong");
      await press();
    } else if (s.step === "code") {
      if (s.url && s.url !== shownUrl) { shownUrl = s.url; try { writeAtomic(signinUrlFile("agy", id), `${s.url}\n`); } catch { /* no link */ } }
      if (!ask) setAsk("agy", id, "code");
      // A code typed in that agy didn't answer (still the prompt a while later): the field again.
      if (ask === "checking") { checkingAt ||= Date.now(); if (Date.now() - checkingAt > 20000) { checkingAt = 0; setAsk("agy", id, "code"); } }
      else checkingAt = 0;
    } else if (s.step === "method") {
      if (!s.google) { why = "method"; break; }
      await press();
    }
  }
  if (cancelled) return out({ cancelled: true });
  await end(Boolean(found));
  // The trust answer made agy save its settings: the folder to the shared list, the link back.
  mendAgySettings(path.join(F.accountDir(HOME, "agy", id), "home", ".gemini", "antigravity-cli", "settings.json"));
  if (found) {
    cachePut(`agy:${id}`, { signedIn: true, email: found.email, plan: found.plan, at: Date.now() });
    return out({ ok: true, signedIn: true, email: found.email, plan: found.plan });
  }
  const signedIn = agyHasLogin(id);
  if (signedIn) cachePut(`agy:${id}`, { signedIn: true, at: Date.now() });
  return out({ ok: signedIn, signedIn, why, timedOut: why === "timeout" || undefined, offer: signedIn ? undefined : ["herdr-ws-account", "login", "agy", id] });
}

// `code agy <id> <code>`: the code from the browser, typed into the waiting sign-in's terminal
// (pasted, then Enter). Only there: never written to a file or the cache.
async function code(agent, id, c) {
  if (agent !== "agy") throw new Fail("herdr-ws-account: only Antigravity's sign-in takes a pasted code", 2);
  account(load(), agent, id);
  const value = String(c ?? "").trim();
  if (!F.validCode(value)) throw new Fail("herdr-ws-account: That doesn't look like a code from the sign-in page.", 2);
  const s = readJson(signinFile(agent, id));
  let alive = false; try { if (s?.pid) { process.kill(s.pid, 0); alive = true; } } catch { /* gone */ }
  if (!s?.terminal || !alive) throw new Fail("herdr-ws-account: This sign-in isn't waiting for a code any more.", 4);
  // --force: hc holds typing while agy waits on its sign-in (that's what this answers).
  const r = await hc(["send", "--force", s.terminal, value]);
  if (r.code !== 0) throw new Fail("herdr-ws-account: Couldn't hand the code to the sign-in.", 1);
  setAsk(agent, id, "checking");
  return { agent, id, sent: true };
}

async function signin(agent, id) {
  const store = load();
  account(store, agent, id);
  const bin = binOf(agent);
  if (!bin) throw new Fail(`herdr-ws-account: ${F.TITLES[agent]} isn't installed`, 127);
  ensureFolder(agent, id);
  if (agent === "agy") return agySignin(id, bin);
  const how = signinArgs(agent);
  if (how.terminal) return { agent, id, terminal: true, command: ["herdr-ws-account", "login", agent, id] };
  const file = signinFile(agent, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const link = signinLink(agent, id, envOf(agent, id));
  const r = await run(bin, how.args, {
    env: link.env, timeout: 9 * 60000, onData: link.onData,
    onSpawn: (p) => writeAtomic(file, JSON.stringify({ pid: p.pid, at: Date.now() })),
  });
  link.done();
  try { fs.unlinkSync(file); } catch { /* gone */ }
  // Cancelled (herdr-ws-account cancel): nothing more here; --drop may be removing the folder.
  if (r.signal) return { agent, id, ok: false, cancelled: true, signedIn: null };
  const text = `${r.stdout}\n${r.stderr}`;
  // A CLI that waits for a pasted code can't finish here: a terminal tab instead.
  const needsTerminal = r.code !== 0 && /paste|enter (the )?code|authorization code/i.test(text);
  const idn = await identity(agent, id).catch(() => ({ signedIn: null }));
  cachePut(`${agent}:${id}`, { email: idn.email ?? null, plan: idn.plan ?? null, signedIn: idn.signedIn, at: Date.now() });
  return { agent, id, ok: idn.signedIn === true, cancelled: Boolean(r.signal), signedIn: idn.signedIn, email: idn.email ?? null, terminal: needsTerminal || undefined, command: needsTerminal ? ["herdr-ws-account", "login", agent, id] : undefined };
}

// In this terminal: the sign-in command (Antigravity: agy itself, which asks to sign in).
function login(agent, id) {
  const store = load();
  account(store, agent, id);
  const bin = binOf(agent);
  if (!bin) throw new Fail(`herdr-ws-account: ${F.TITLES[agent]} isn't installed`, 127);
  ensureFolder(agent, id);
  const how = signinArgs(agent);
  const t = process.env.HC_TERMINAL_ID;
  if (agent === "agy") process.stderr.write(t ? "Sign in to the Google account you want. This tab closes once you're signed in.\n" : "Sign in to the Google account you want, then leave Antigravity with /exit.\n");
  // agy runs in the account's own folder (never the real home, which it was never trusted with).
  const dir = agent === "agy" ? agyFolder(id) : HOME;
  return new Promise((resolve) => {
    let over = false, seen = null;
    const p = spawn(bin, how.args, { env: envOf(agent, id), stdio: "inherit", cwd: dir });
    // agy (in a herdr-core terminal): its banner names the account once it's signed in, after the
    // trust question for the account's folder, which is answered. Then agy is left (/exit), and
    // once it's gone Settings > Accounts opens again and this tab closes.
    if (agent === "agy" && t) {
      banner(id, t, 24 * 3600, () => over, dir).then((b) => {
        if (!b || over) return;
        seen = b;
        hc(["send", t, "/exit"]).catch(() => {});
        setTimeout(() => { if (!over) { try { p.kill("SIGTERM"); } catch { /* gone */ } } }, 5000);
      }).catch(() => {});
    }
    p.on("close", async (code) => {
      over = true;
      if (seen) await backToSettings(t).catch(() => {});
      resolve(seen ? 0 : code ?? 1);
    });
    p.on("error", () => { over = true; resolve(127); });
  });
}

// The terminal sign-in is done: Settings > Accounts again (its window closed for the tab, as
// ws-switcher's settings opener opens it), then this terminal's tab closed, unless it's its
// space's only tab (that would close the space).
async function backToSettings(t) {
  const app = onPath("herdr-app");
  if (!app || !t) return;
  await run(app, ["do", "ws-switcher.settings/accounts"], { env: process.env, timeout: 10000 });
  const ls = await run(app, ["ls"], { env: process.env, timeout: 10000 });
  let spaces = []; try { spaces = JSON.parse(ls.stdout).spaces ?? []; } catch { return; }
  for (const s of spaces) {
    const tab = (s.tabs ?? []).find((x) => (x.terminals ?? []).some((k) => k.terminal === t));
    if (tab && s.tabs.length > 1) await run(app, ["do", "tab.close", JSON.stringify({ id: tab.id, confirmed: true })], { env: process.env, timeout: 10000 });
  }
}

async function cancel(agent, id, drop) {
  const s = readJson(signinFile(agent, id));
  if (s?.pid) {
    try { process.kill(-s.pid, "SIGTERM"); } catch { try { process.kill(s.pid, "SIGTERM"); } catch { /* gone */ } }
  }
  // Antigravity's hidden terminal: stopped here too (its sign-in ends it as well, on SIGTERM).
  if (s?.terminal) { await hc(["kill", s.terminal]); await hc(["rm", s.terminal]); setAsk(agent, id, null); }
  if (drop && id !== F.MAIN) return remove(agent, id);
  return { agent, id, cancelled: Boolean(s?.pid) };
}

async function signout(agent, id) {
  const store = load();
  account(store, agent, id);
  const bin = binOf(agent);
  if (agent === "agy") throw new Fail("herdr-ws-account: Antigravity has no sign-out command; remove the account instead", 5);
  if (!bin) throw new Fail(`herdr-ws-account: ${F.TITLES[agent]} isn't installed`, 127);
  ensureFolder(agent, id);
  const r = await run(bin, agent === "claude" ? ["auth", "logout"] : ["logout"], { env: quietEnv(envOf(agent, id)), timeout: 30000 });
  cachePut(`${agent}:${id}`, { signedIn: false, email: null, plan: null, top: null, at: Date.now() });
  return { agent, id, ok: r.code === 0 };
}

async function remove(agent, id) {
  const store = load();
  account(store, agent, id);
  if (id === F.MAIN) throw new Fail(`herdr-ws-account: the main account is ${F.TITLES[agent]}'s own sign-in; sign out instead`, 5);
  // Claude's sign-in is a Keychain item named after the folder: signed out first, so it isn't left behind.
  if (agent !== "agy") await signout(agent, id).catch(() => {});
  const dir = F.accountDir(HOME, agent, id);
  if (fs.existsSync(dir)) {
    fs.mkdirSync(TRASH, { recursive: true });
    fs.renameSync(dir, path.join(TRASH, `account-${agent}-${id}-${Date.now()}`));
  }
  const s = store[agent];
  s.accounts = s.accounts.filter((a) => a.id !== id);
  if (s.default === id) s.default = F.MAIN;
  save(store);
  const all = cacheAll(); delete all[`${agent}:${id}`];
  try { writeAtomic(CACHE, JSON.stringify(all)); } catch { /* a cache */ }
  return { agent, id, removed: true };
}

function setDefault(agent, id) {
  const store = load();
  account(store, agent, id);
  store[agent].default = id;
  save(store);
  return { agent, default: id };
}

function rename(agent, id, name) {
  const store = load();
  const a = account(store, agent, id);
  const n = String(name ?? "").trim().slice(0, 60);
  if (n) a.name = n; else delete a.name;
  save(store);
  return { agent, id, name: a.name ?? null };
}

// Antigravity's email and plan from its start banner on terminal T's screen (hc read), asked
// every 1.5 s until it's there or `secs` pass (the launcher starts this in the background, the
// sign-in tab runs it alongside agy). A banner with an email replaces what was kept; none
// changes nothing.
// hc (herdr-core) with its answer: { code, stdout }. On PATH, else in ~/.local/bin; on the core
// the terminal runs on when that's known (an agent's terminal sets its socket).
function hc(args, timeout = 10000) {
  const bin = onPath("hc") ?? [HOME, process.env.HERDR_WS_REAL_HOME].filter(Boolean).map((h) => path.join(h, ".local", "bin", "hc")).find(isExec) ?? "hc";
  const sock = process.env.HC_SOCKET || process.env.HC_TERMINAL_SOCKET;
  return run(bin, args, { env: sock ? { ...process.env, HC_SOCKET: sock } : process.env, timeout, cwd: os.tmpdir() });
}
async function hcRead(t) {
  const r = await hc(["read", "--lines", "0", t]);
  return r.code === 0 ? r.stdout : null;
}
// agy's trust question on a screen, for our own folder `dir` only: "yes" (Enter answers it:
// "Yes, I trust this folder" is the chosen line), "no" (another folder, or Yes not chosen:
// never answered), or null (no question there).
function trustCall(screen, dir) {
  const q = F.agyTrust(screen);
  if (!q) return null;
  return dir && q.yes && F.sameFolder(q.folder, dir) ? "yes" : "no";
}
function keepBanner(id, b) {
  cachePut(`agy:${id}`, { bannerEmail: b.email, bannerPlan: b.plan, bannerAt: Date.now(), email: b.email, plan: b.plan });
}
// trustDir: the account's own folder, whose trust question is answered Yes (the sign-in tab).
async function banner(id, t, secs = 90, stop = () => false, trustDir = null) {
  const until = Date.now() + secs * 1000;
  let misses = 0, answered = 0;
  while (Date.now() < until && !stop()) {
    const screen = await hcRead(t);
    if (screen == null) { if (++misses >= 3) return null; } // the terminal is gone
    else {
      misses = 0;
      const b = F.agyBanner(screen);
      if (b) { keepBanner(id, b); return b; }
      // Answered once, and again only if the question is still there a while later.
      if (trustDir && trustCall(screen, trustDir) === "yes" && Date.now() - answered > 4000) {
        answered = Date.now();
        await hc(["keys", t, "enter"]);
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

// An Antigravity account's email and plan without a tab: agy started in a herdr-core terminal of
// our own (no Herdr tab), under the account (HOME its shadow home, in its own folder, no browser),
// its banner read, then left (/exit) and the terminal stopped by its address. The trust question
// for the account's folder is answered Yes (it's ours; agy adds that one path to its trusted
// folders, which the accounts share). Gives up after `secs`; a watchdog in the terminal ends agy
// after secs + 30 even if this process is gone. --due: not when tried within IDENTIFY_AGE.
async function identify(id, { due = false, secs = 60 } = {}) {
  const key = `agy:${id}`;
  const was = cacheAll()[key] ?? {};
  const out = (o) => ({ agent: "agy", id, email: was.bannerEmail ?? null, plan: was.bannerPlan ?? null, ...o });
  if (id === F.MAIN) throw new Fail("herdr-ws-account: identify is for Antigravity's other accounts (main's email is in its own google_accounts.json)", 2);
  if (due && was.identifyAt && Date.now() - was.identifyAt < F.IDENTIFY_AGE) return out({ skipped: true });
  const bin = binOf("agy");
  if (!bin) throw new Fail("herdr-ws-account: Antigravity isn't installed", 127);
  const dir = F.accountDir(HOME, "agy", id);
  if (!fs.existsSync(dir) || !agyHasLogin(id)) return out({ signedIn: false });
  cachePut(key, { identifyAt: Date.now() });
  ensureFolder("agy", id);
  // A terminal doesn't take this process's environment: the account's variables go on env's line.
  const { set, unset } = F.envFor("agy", id, { home: HOME, env: process.env, darwin: DARWIN });
  const q = quietEnv(envOf("agy", id));
  const vars = { ...set, PATH: q.PATH, BROWSER: q.BROWSER };
  const t = await startHidden(dir, secs + 30, ["/usr/bin/env", ...unset.flatMap((k) => ["-u", k]), ...Object.entries(vars).map(([k, v]) => `${k}=${v}`), bin]);
  if (!t) return out({ error: "couldn't start a terminal (hc)" });
  const until = Date.now() + secs * 1000;
  let found = null, why = "timeout", misses = 0, answered = 0;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    const screen = await hcRead(t);
    if (screen == null) { if (++misses >= 3) { why = "gone"; break; } continue; }
    misses = 0;
    const b = F.agyBanner(screen);
    if (b) { keepBanner(id, b); found = b; break; }
    const trust = trustCall(screen, dir);
    if (trust === "no") { why = "trust"; break; }
    if (trust === "yes") { if (Date.now() - answered > 4000) { answered = Date.now(); await hc(["keys", t, "enter"]); } continue; }
    if (F.saysSignedOut(screen)) { why = "signed-out"; break; }
  }
  await endTerminal(t, Boolean(found));
  // A trust answer made agy save its settings: the folder goes to the shared list, the link back.
  mendAgySettings(path.join(dir, "home", ".gemini", "antigravity-cli", "settings.json"));
  return found ? out({ email: found.email, plan: found.plan, signedIn: true }) : out({ found: false, why });
}

// A herdr-core terminal of our own running argv in dir, out of sight (no Herdr tab, removed when
// it ends), with a watchdog that ends the program after `secs` even if nobody's watching. Its
// address, or null.
async function startHidden(dir, secs, argv) {
  const started = await hc(["run", "--bg", "--rm", "--no-notify", "--json", "--cwd", dir,
    "/bin/sh", "-c", '( sleep "$1"; kill -TERM $$ 2>/dev/null ) & shift; exec "$@"', "sh", String(secs), ...argv], 20000);
  try { return JSON.parse(started.stdout.trim().split("\n").pop()).address ?? null; } catch { return null; }
}

// Ends a terminal we started: agy left with /exit when it's at its prompt (`atPrompt`; never on a
// question, where Enter would answer it), else killed; then removed. By its address only.
async function endTerminal(t, atPrompt) {
  const gone = async () => { const r = await hc(["get", "--json", t]); return r.code !== 0 || !/"state"\s*:\s*"live"/.test(r.stdout); };
  if (atPrompt) {
    await hc(["send", t, "/exit"]);
    for (let i = 0; i < 6 && !(await gone()); i++) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(await gone())) { await hc(["kill", t]); await new Promise((r) => setTimeout(r, 1000)); }
  await hc(["rm", t]);
}

// The variables to start under an account. No store yet and no id asked for: nothing.
function env(agent, id) {
  const store = load();
  const a = account(store, agent, id || "default");
  ensureFolder(agent, a.id);
  const lines = F.envLines(F.envFor(agent, a.id, { home: HOME, env: process.env, darwin: DARWIN }));
  return `id ${a.id}${lines ? `\n${lines}` : ""}`;
}

const HELP = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n").split("\n\nimport")[0];

async function main(argv) {
  const [cmd, ...args] = argv;
  const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && (args[i - 1] === "--name" || args[i - 1] === "--for")));
  const json = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  switch (cmd) {
    case "list": return json(await list(args));
    case "usage": account(load(), pos[0], pos[1]); return json(await usage(pos[0], pos[1]));
    case "prepare": return json({ agent: pos[0], id: prepare(pos[0], flag(args, "--name")) });
    case "add": {
      if (F.validAgent(pos[0]) && !binOf(pos[0])) throw new Fail(`herdr-ws-account: ${F.TITLES[pos[0]]} isn't installed`, 127);
      const id = prepare(pos[0], flag(args, "--name"));
      return json(await signin(pos[0], id));
    }
    case "signin": return json(await signin(pos[0], pos[1]));
    case "login": process.exitCode = await login(pos[0], pos[1]); return;
    case "code": return json(await code(pos[0], pos[1], pos[2]));
    case "cancel": return json(await cancel(pos[0], pos[1], args.includes("--drop")));
    case "signout": return json(await signout(pos[0], pos[1]));
    case "remove": return json(await remove(pos[0], pos[1]));
    case "default": return json(setDefault(pos[0], pos[1]));
    case "rename": return json(rename(pos[0], pos[1], pos.slice(2).join(" ")));
    case "env": return process.stdout.write(env(pos[0], pos[1]) + "\n");
    case "identify": {
      if (pos[0] !== "agy" || !pos[1]) throw new Fail("usage: herdr-ws-account identify agy <id> [--due]", 2);
      account(load(), "agy", pos[1]);
      return json(await identify(pos[1], { due: args.includes("--due") }));
    }
    case "banner": {
      if (pos[0] !== "agy" || !pos[2]) throw new Fail("usage: herdr-ws-account banner agy <id> <terminal> [--for SECONDS]", 2);
      account(load(), "agy", pos[1]);
      return json({ agent: "agy", id: pos[1], banner: await banner(pos[1], pos[2], Number(flag(args, "--for")) || 90) });
    }
    case undefined: case "-h": case "--help": case "help": return process.stdout.write(HELP + "\n");
    default: throw new Fail(`herdr-ws-account: no command ${cmd}\n\n${HELP}`, 2);
  }
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`${e instanceof Fail ? e.message : `herdr-ws-account: ${e?.stack ?? e}`}\n`);
  process.exitCode = e?.code ?? 1;
});
