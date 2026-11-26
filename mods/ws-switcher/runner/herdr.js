// @ts-nocheck
// The "herdr" module for the background runner (runner/main.js): what
// automations.js, prs.js and defs.js import from the app, done with Node, hc
// and files, so the same code runs with Herdr's window closed.
//
// What the window knows comes from herdr-core instead: its terminals (their
// status, and the herdr.space / herdr.tab labels saying where each shows) and the
// app's layout document (the spaces and tabs by name). Which workspace a space
// is in is the switcher's `workspaces.assigned`, read from the app's shared.json.

import { spawn } from "node:child_process";
import net from "node:net";
import * as nfs from "node:fs/promises";
import { watch, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { inQuietHours } from "../autofacts.js";

export const home = () => os.homedir();
export const appHome = () => process.env.HERDR_APP_HOME || `${home()}/.config/herdr-app`;
export const runnerDir = () => `${home()}/.herdr/runner`;
export const checking = () => false;
export const window = () => ({ platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux" });
// What the window shows: Herdr's view.json (the shown space, and each space's shown
// tab), read with the layout document, while the window is open (its socket answers).
// With the window closed nobody is looking: null.
export const focused = () => (core.open && core.view?.active ? { space: core.view.active, tab: core.view.spaces?.[core.view.active] ?? null } : null);
export const windowOpen = () => core.open;
export const run = () => {}; // app commands: the window's, not ours
export const hex = (n) => randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);

// --- programs and files ---

// As the app's exec: { code, stdout, stderr } once it ends, rejected when it can't start, prints over
// MAX_BUFFER or takes over its timeout. Each call is a process group of its own, so on a timeout the
// whole group ends (TERM, then KILL KILL_GRACE later): what a script started (a `sleep`, a test
// runner's workers) doesn't run on. A timeout's error has `timedOut: true` and what was printed until
// then (`stdout`, `stderr`), as does one for too much output (`tooMuch: true`), so neither is lost.
const MAX_BUFFER = 64 * 1024 * 1024;
const WIN = process.platform === "win32";
const KILL_GRACE = 2000;
export function exec(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = Math.min(options.timeout ?? 30000, 600000);
    let child;
    // Windows: no process groups (detached would give it a console window of its own); taskkill /T ends the tree.
    try { child = spawn(command, args, { cwd: options.cwd, detached: !WIN, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { reject(new Error(String(e?.message ?? e))); return; }
    const out = [], err = [];
    let size = 0, timedOut = false, tooMuch = false, settled = false, timer = null, grace = null;
    const text = (list) => Buffer.concat(list).toString("utf8");
    const stopGroup = () => {
      if (WIN) {
        try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
        grace = setTimeout(() => finish(null, "SIGKILL"), KILL_GRACE);
        return;
      }
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      grace = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} finish(null, "SIGKILL"); }, KILL_GRACE);
    };
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = text(out), stderr = text(err);
      if (timedOut || tooMuch) {
        const e = new Error(timedOut ? `${command} took longer than ${Math.round(timeout / 1000)}s` : `${command} printed over ${MAX_BUFFER / 1048576} MB`);
        Object.assign(e, { timedOut, tooMuch, code: null, stdout, stderr });
        // The group's last ones are sent KILL once its grace is up, whatever happens here.
        reject(e);
        return;
      }
      clearTimeout(grace);
      if (typeof code === "number") resolve({ code, stdout, stderr });
      else reject(Object.assign(new Error(`${command} was stopped (${signal ?? "signal"})`), { code: null, stdout, stderr }));
    };
    const take = (list) => (chunk) => {
      if (tooMuch || timedOut) return;
      if (size + chunk.length > MAX_BUFFER) { tooMuch = true; stopGroup(); return; }
      size += chunk.length;
      list.push(chunk);
    };
    child.stdout.on("data", take(out));
    child.stderr.on("data", take(err));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(e?.code === "ENOENT" ? `${command} not found` : String(e?.message ?? e)));
    });
    child.on("close", (code, signal) => finish(code, signal));
    timer = setTimeout(() => { timedOut = true; stopGroup(); }, timeout);
  });
}

// `hc send` waits for a draft someone is typing, up to a minute.
export const hc = (args) => exec("hc", args, { timeout: 120000 });

export async function readTextFile(file) {
  try { return await nfs.readFile(file, "utf8"); } catch { return null; }
}

// expected: what the file holds now (null: it isn't there). Anything else: it changed, so no write.
export async function writeTextFile(file, text, expected) {
  if (expected !== undefined && (await readTextFile(file)) !== expected) throw new Error(`${file} changed`);
  await nfs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${hex(6)}.tmp`;
  // A shell run's log is yours only from the start: a script may print a token.
  await nfs.writeFile(tmp, text, file.startsWith(`${runnerDir()}/logs/`) ? { mode: 0o600 } : undefined);
  await nfs.rename(tmp, file);
  return null;
}

// Resolves with the paths changed under dir the next time anything changes there.
// One watcher per folder stays open, so a change between two calls isn't lost.
const watches = new Map();
export function watchFolder(dir) {
  let w = watches.get(dir);
  if (!w) {
    w = { pending: new Set(), waiters: [], timer: null };
    try {
      w.watcher = watch(dir, { recursive: true }, (_event, name) => {
        w.pending.add(name ? path.join(dir, String(name)) : dir);
        clearTimeout(w.timer);
        w.timer = setTimeout(() => flush(w), 150);
      });
      w.watcher.on("error", () => { watches.delete(dir); try { w.watcher.close(); } catch {} for (const x of w.waiters.splice(0)) x.reject(new Error(`can't watch ${dir}`)); });
    } catch (e) { return Promise.reject(new Error(String(e?.message ?? e))); }
    watches.set(dir, w);
  }
  let waiter;
  const p = new Promise((resolve, reject) => { waiter = { resolve, reject }; w.waiters.push(waiter); });
  p.cancel = () => { const i = w.waiters.indexOf(waiter); if (i >= 0) { w.waiters.splice(i, 1); waiter.resolve([]); } };
  if (w.pending.size && !w.timer) w.timer = setTimeout(() => flush(w), 0);
  return p;
}
function flush(w) {
  w.timer = null;
  if (!w.waiters.length || !w.pending.size) return;
  const paths = [...w.pending].slice(0, 500);
  w.pending.clear();
  for (const x of w.waiters.splice(0)) x.resolve(paths);
}

// --- shared state: ours in memory; the switcher's read from the app's file ---

const mine = new Map();
const listeners = [];
let appShared = { at: 0, mtime: -1, value: {} };
function fromApp(key) {
  const now = Date.now();
  if (now - appShared.at > 2000) {
    appShared.at = now;
    try {
      const file = `${appHome()}/shared.json`, m = statSync(file).mtimeMs;
      if (m !== appShared.mtime) appShared = { at: now, mtime: m, value: JSON.parse(readFileSync(file, "utf8")) };
    } catch {}
  }
  return appShared.value?.[key];
}
export const shared = (key) => (mine.has(key) ? mine.get(key) : key === "workspaces.assigned" ? fromApp(key) : undefined);
export function setShared(key, value) {
  mine.set(key, value);
  for (const fn of listeners) fn(key, value);
}
export const onShared = (fn) => listeners.push(fn);

// --- notifications: files the switcher shows as toasts (now, or when Herdr next opens) ---

const KEEP_NOTES = 40;
// The window takes a note within a couple of seconds, and its toast reaches the
// desktop too when Herdr isn't the app in front (the ws-toast mod). A note still
// there after this long has no window to show it, so it goes to the desktop from
// here (bin/herdr-ws-notify). The file stays: Herdr shows it when it next opens.
const UNSEEN_MS = 6000;
const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "herdr-ws-notify");

export function notify(note) {
  const at = `${runnerDir()}/notes`;
  (async () => {
    await nfs.mkdir(at, { recursive: true });
    const file = `${at}/${Date.now()}-${hex(5)}.json`;
    await writeTextFile(file, JSON.stringify({ ...note, at: Date.now() }));
    const names = (await nfs.readdir(at)).filter((n) => n.endsWith(".json")).sort();
    for (const n of names.slice(0, Math.max(0, names.length - KEEP_NOTES))) await nfs.rm(`${at}/${n}`, { force: true });
    for (const fn of listeners) fn("notes");
    setTimeout(() => desktop(file, note).catch(() => {}), UNSEEN_MS);
  })().catch((e) => console.error("note:", e?.message ?? e));
}

// Settings > Automations' quiet hours ("22:00-08:00", or null), as runner/main.js last read them.
let quietHours = null;
export const setQuietHours = (value) => { quietHours = value ?? null; };

// The same words and the same click as the toast, with the system's sound: Herdr isn't there to play
// its own. In the quiet hours, without a sound.
async function desktop(file, note) {
  try { await nfs.access(file); } catch { return; } // the window took it
  if (!note?.title) return;
  const args = inQuietHours(quietHours) ? [] : ["--sound"];
  const place = note.action?.args?.terminal ?? note.action?.args?.id;
  if (place) args.push("--group", String(place));
  if (note.action?.name) args.push("--do", String(note.action.name), JSON.stringify(note.action.args ?? {}));
  if (note.action?.or?.name) args.push("--or", String(note.action.or.name), JSON.stringify(note.action.or.args ?? {}));
  args.push("--", String(note.title), String(note.body ?? ""));
  await exec(DESKTOP, args, { timeout: 15000 });
}

// --- herdr-core: one `hc connect` kept open, asked every second ---
// Only while herdr-core is running: `hc` starts it when it isn't, and a core started at login
// would bring back the agents it resumes. So a runner with only scripts and checks to run
// (started by launchd at login, say) leaves it asleep until an agent run starts it (`hc run`).

// Where herdr-core listens, as hc finds it (herdr-core's paths.rs): HC_SOCKET, else the config's
// `socket`, else $XDG_RUNTIME_DIR/herdr-core/<session>.sock, else beside its state:
// ~/.local/state/herdr-core/<session>/<session>.sock. The session is HC_SESSION, else "default".
// Windows: a named pipe, \\.\pipe\herdr-core-<user>-<session>.sock (the user's name in letters and
// digits), and the config in %APPDATA%\herdr-core.
export function coreSocketPath() {
  if (process.env.HC_SOCKET) return process.env.HC_SOCKET;
  const session = (process.env.HC_SESSION || "default").trim() || "default";
  try {
    const confDir = process.env.XDG_CONFIG_HOME || (WIN ? process.env.APPDATA || `${home()}/AppData/Roaming` : `${home()}/.config`);
    const conf = readFileSync(`${confDir}/herdr-core/config.toml`, "utf8");
    const m = /^\s*socket\s*=\s*["']([^"']+)["']/m.exec(conf);
    if (m) return m[1];
  } catch {}
  if (WIN) return `\\\\.\\pipe\\herdr-core-${String(process.env.USERNAME ?? "").replace(/[^A-Za-z0-9]/g, "")}-${session}.sock`;
  const runtime = process.env.XDG_RUNTIME_DIR || (() => { try { const d = `/run/user/${process.getuid()}`; return statSync(d).isDirectory() ? d : null; } catch { return null; } })();
  if (runtime) return `${runtime}/herdr-core/${session}.sock`;
  return `${process.env.XDG_STATE_HOME || `${home()}/.local/state`}/herdr-core/${session}/${session}.sock`;
}

// herdr-core answers on its socket (a socket file left by one that stopped doesn't).
let coreSeen = { at: 0, up: false };
async function coreUp() {
  if (Date.now() - coreSeen.at < 3000) return coreSeen.up;
  const at = coreSocketPath();
  let up = false;
  try { if (!WIN) statSync(at); up = await knock(at); } catch {}
  coreSeen = { at: Date.now(), up };
  return up;
}
function knock(at) {
  return new Promise((resolve) => {
    const s = net.connect(at);
    const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
    const t = setTimeout(() => done(false), 1000);
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
  });
}

const core = { child: null, next: 1, calls: new Map(), terminals: [], doc: { spaces: [] }, docAt: 0, view: null, open: false, viewAt: 0 };

function connect() {
  if (core.child) return;
  const child = spawn("hc", ["connect"], { stdio: ["pipe", "pipe", "ignore"] });
  core.child = child;
  const gone = () => {
    if (core.child !== child) return;
    core.child = null;
    for (const c of core.calls.values()) c.reject(new Error("herdr-core closed the connection"));
    core.calls.clear();
  };
  child.on("error", gone);
  child.on("exit", gone);
  child.stdin.on("error", () => {});
  createInterface({ input: child.stdout }).on("line", (line) => {
    let m = null;
    try { m = JSON.parse(line); } catch { return; }
    const c = m.id !== undefined ? core.calls.get(m.id) : null;
    if (!c) return;
    core.calls.delete(m.id);
    if (m.error) c.reject(new Error(m.error.message ?? "herdr-core refused")); else c.resolve(m.result);
  });
}

export function call(method, params = {}) {
  connect();
  return new Promise((resolve, reject) => {
    const id = core.next++;
    const timer = setTimeout(() => { if (core.calls.delete(id)) reject(new Error(`herdr-core didn't answer ${method}`)); }, 20000);
    core.calls.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    try { core.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); }
    catch (e) { core.calls.delete(id); clearTimeout(timer); reject(e); }
  });
}

// The live terminals and, every 5s (or now), the app's spaces and tabs. Every 3s,
// whether the window is open and what it shows.
export async function refresh(docNow = false) {
  if (Date.now() - core.viewAt > 3000) { core.viewAt = Date.now(); await look(); }
  // No herdr-core: no terminals and no spaces, and nothing that would start it.
  if (!core.child && !(await coreUp())) { core.terminals = []; core.doc = { spaces: [] }; return; }
  const r = await call("terminal.list", {});
  core.terminals = r?.terminals ?? [];
  if (docNow || Date.now() - core.docAt > 5000) {
    const d = await call("doc.get", { name: "herdr-app" }).catch(() => null);
    if (d?.value?.spaces) core.doc = d.value;
    core.docAt = Date.now();
  }
}

// The window is open while its socket takes a connection. Windows: Herdr's is an AF_UNIX socket,
// which Node can't open there, so while herdr-app.exe runs (asked every 10 seconds).
let appSeen = { at: 0, open: false };
function appRunning() {
  if (Date.now() - appSeen.at < 10000) return Promise.resolve(appSeen.open);
  return new Promise((resolve) => {
    let out = "";
    const p = spawn("tasklist", ["/FI", "IMAGENAME eq herdr-app.exe", "/NH"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    p.stdout.on("data", (d) => { out += d; });
    const done = (open) => { appSeen = { at: Date.now(), open }; resolve(open); };
    p.on("error", () => done(false));
    p.on("close", () => done(/herdr-app\.exe/i.test(out)));
  });
}
async function look() {
  core.open = WIN ? await appRunning() : await new Promise((resolve) => {
    const s = net.connect(`${appHome()}/herdr-app.sock`);
    const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
    const t = setTimeout(() => done(false), 1000);
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
  });
  if (!core.open) { core.view = null; return; }
  try { core.view = JSON.parse(await nfs.readFile(`${appHome()}/view.json`, "utf8")); } catch {}
}

export const terminals = () => core.terminals;
export function spaces() {
  return (core.doc.spaces ?? []).map((s) => ({ id: s.id, name: s.name || "", named: Boolean(s.name), machine: null, folder: s.folder ?? "", tabs: (s.tabs ?? []).map((t) => ({ id: t.id, name: t.name || "" })) }));
}
// As the app's agents(): the terminals whose program reports a status. The core
// has no "done" of its own for us to tell from "idle"; either means finished.
export function agents() {
  const sp = spaces();
  return core.terminals.filter((t) => t.state === "live" && t.status?.state).map((t) => {
    const space = sp.find((s) => s.id === t.labels?.["herdr.space"]);
    const tab = space?.tabs.find((x) => x.id === t.labels?.["herdr.tab"]);
    return {
      address: t.address, status: t.status.state, app: t.status.app ?? null,
      space: t.labels?.["herdr.space"] ?? null, tab: t.labels?.["herdr.tab"] ?? null,
      space_name: space?.name ?? "", tab_name: tab?.name ?? "", program: { name: t.status.app ?? t.foreground?.name ?? "agent" },
    };
  });
}

// The agents people start by name: programs.json's `run`, as the app's knownAgents().
export async function knownAgents() {
  const out = [{ key: "codex", run: ["codex", "--no-daemon"] }];
  try {
    const p = JSON.parse((await readTextFile(`${appHome()}/programs.json`)) ?? "{}").programs ?? {};
    for (const [key, v] of Object.entries(p)) if (Array.isArray(v?.run) && v.run.length) out.unshift({ key, run: v.run.map(String) });
  } catch {}
  return out;
}
