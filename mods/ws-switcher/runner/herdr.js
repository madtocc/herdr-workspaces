// @ts-nocheck
// The "herdr" module for the background runner (runner/main.js): what
// automations.js, prs.js and defs.js import from the app, done with Node, hc
// and files, so the same code runs with Herdr's window closed.
//
// What the window knows comes from herdr-core instead: its terminals (their
// status, and the herdr.space / herdr.tab labels saying where each shows) and the
// app's layout document (the spaces and tabs by name). Which workspace a space
// is in is the switcher's `workspaces.assigned`, read from the app's shared.json.

import { execFile, spawn } from "node:child_process";
import net from "node:net";
import * as nfs from "node:fs/promises";
import { watch, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

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

export function exec(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = Math.min(options.timeout ?? 30000, 600000);
    execFile(command, args, { cwd: options.cwd, timeout, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr });
      if (error.killed) return reject(new Error(`${command} took longer than ${Math.round(timeout / 1000)}s`));
      if (typeof error.code === "number") return resolve({ code: error.code, stdout: stdout ?? "", stderr: stderr ?? "" });
      reject(new Error(error.code === "ENOENT" ? `${command} not found` : String(error.message)));
    });
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
  await nfs.writeFile(tmp, text);
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

// The same words and the same click as the toast, with the system's sound: Herdr isn't there to play its own.
async function desktop(file, note) {
  try { await nfs.access(file); } catch { return; } // the window took it
  if (!note?.title) return;
  const args = ["--sound"];
  const place = note.action?.args?.terminal ?? note.action?.args?.id;
  if (place) args.push("--group", String(place));
  if (note.action?.name) args.push("--do", String(note.action.name), JSON.stringify(note.action.args ?? {}));
  if (note.action?.or?.name) args.push("--or", String(note.action.or.name), JSON.stringify(note.action.or.args ?? {}));
  args.push("--", String(note.title), String(note.body ?? ""));
  await exec(DESKTOP, args, { timeout: 15000 });
}

// --- herdr-core: one `hc connect` kept open, asked every second ---

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
  const r = await call("terminal.list", {});
  core.terminals = r?.terminals ?? [];
  if (docNow || Date.now() - core.docAt > 5000) {
    const d = await call("doc.get", { name: "herdr-app" }).catch(() => null);
    if (d?.value?.spaces) core.doc = d.value;
    core.docAt = Date.now();
  }
}

// The window is open while its socket takes a connection.
async function look() {
  core.open = await new Promise((resolve) => {
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
