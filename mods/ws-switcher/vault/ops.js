// The person's commands (and the screens', through ingest): put, edit, migrate, rm, sync, list,
// and the runner's redact. None of them prints a value or takes one as an argument.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fail, vaultDir, ensureVaultDir, withLock, remember, readText } from "./base.js";
import { caller } from "./caller.js";
import { readMeta, writeMeta, readMetaSoft, readEnc, writeEnc, seal, open, masterKey, standardValue } from "./store.js";
import { request as brokerRequest, brokerStatus } from "./broker.js";
import {
  validName, scopeKey, entryKey, ttlMs, TTL_CHOICES, parseHosts, parseCommands, validateEntry,
  usageLabel, expiryLabel, makeRedactor, filterEntries, validScope, resolveEntry,
} from "../vaultfacts.js";

// ---- settings (Settings > Vault): a new secret's tier and expiry ----

async function vaultDefaults() {
  const out = { "default-tier": "standard", "default-ttl": "24h" };
  try {
    const sf = await import("../settingsfacts.js");
    const text = readText(path.join(os.homedir(), ".herdr", "settings.jsonc"));
    const v = sf.parseSettings(text).vault || {};
    if (v["default-tier"]) out["default-tier"] = v["default-tier"];
    if (v["default-ttl"]) out["default-ttl"] = v["default-ttl"];
  } catch { /* the defaults */ }
  return out;
}

// ---- flags shared by put and edit ----

export function parseOpArgs(argv, { value = false } = {}) {
  const o = { name: null, workspace: null, global: false, json: false, valueStdin: false, set: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw fail("usage", `${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--workspace": o.workspace = val(); break;
      case "--global": o.global = true; break;
      case "--json": o.json = true; break;
      case "--tier": o.set.tier = val(); break;
      case "--mode": o.set.mode = val(); break;
      case "--hosts": o.set.hosts = val(); break;
      case "--commands": o.set.commands = val(); break;
      case "--allow-shells": o.set.allowShells = true; break;
      case "--no-allow-shells": o.set.allowShells = false; break;
      case "--ttl": o.set.ttl = val(); break;
      case "--note": o.set.note = val(); break;
      case "--value-stdin":
        if (!value) throw fail("usage", "--value-stdin is for put");
        o.valueStdin = true;
        break;
      default:
        if (a.startsWith("--value") || a === "-v") throw fail("usage", "a value is never an argument: use --value-stdin, or put on a terminal asks for it");
        if (a.startsWith("-")) throw fail("usage", `doesn't know ${a} (herdr-ws-secret --help)`);
        if (o.name) {
          // A scope typed as a word after the name ("rm github_token global"): the flag that says it.
          if (a === "global") throw fail("usage", "use --global for a secret of every workspace");
          if (isWorkspaceId(a)) throw fail("usage", `use --workspace ${a} for a secret of workspace ${a}`);
          throw fail("usage", "one secret name at a time");
        }
        o.name = a;
    }
  }
  if (!o.name) throw fail("usage", "which secret? give its name");
  if (!validName(o.name)) throw fail("usage", "a name is 1 to 64 of a-z 0-9 . _ - and starts with a letter or digit");
  if (o.set.tier !== undefined && !["standard", "protected"].includes(o.set.tier)) throw fail("usage", "--tier is standard or protected");
  if (o.set.mode !== undefined && !["http", "http+cli"].includes(o.set.mode)) throw fail("usage", "--mode is http or http+cli");
  if (o.set.ttl !== undefined && !TTL_CHOICES.includes(o.set.ttl)) throw fail("usage", "--ttl is " + TTL_CHOICES.join(", "));
  return o;
}

// A word that is a workspace's id: a secret is kept for it, or ~/.herdr/workspaces/<id> has a workspace.jsonc.
function isWorkspaceId(a) {
  if (!/^[\w.-]+$/.test(a) || a.startsWith(".")) return false;
  const m = readMetaSoft();
  if ((m.entries || []).some((e) => e.scope === `ws:${a}`)) return true;
  try { return fs.statSync(path.join(os.homedir(), ".herdr", "workspaces", a, "workspace.jsonc")).isFile(); } catch { return false; }
}

// The scope the flags (or the current folder) name.
function scopeFrom(o) {
  if (o.global) return "global";
  if (o.workspace) {
    const s = scopeKey(o.workspace);
    if (!validScope(s)) throw fail("usage", `"${o.workspace}" isn't a workspace id`);
    return s;
  }
  return scopeKey(caller({}).ws);
}

// set (strings from flags or ingest) checked and turned into entry fields.
function fieldsFrom(set) {
  const f = {};
  if (set.tier !== undefined) f.tier = set.tier;
  if (set.mode !== undefined) f.mode = set.mode;
  if (set.hosts !== undefined) {
    const r = parseHosts(set.hosts);
    if (r.errors.length) throw fail("usage", r.errors[0]);
    f.hosts = r.hosts;
  }
  if (set.commands !== undefined) {
    const r = parseCommands(Array.isArray(set.commands) ? set.commands.map((c) => (typeof c === "string" ? c : c.path || c.name)) : set.commands);
    if (r.errors.length) throw fail("usage", r.errors[0]);
    f.commands = r.commands;
  }
  if (set.allowShells !== undefined) f.allowShells = !!set.allowShells;
  if (set.ttl !== undefined) {
    if (!TTL_CHOICES.includes(set.ttl)) throw fail("usage", "the expiry is " + TTL_CHOICES.join(", "));
    const ms = ttlMs(set.ttl);
    f.expiresAt = ms === null ? null : Date.now() + ms;
  }
  if (set.note !== undefined) f.note = String(set.note ?? "");
  return f;
}

function checkValid(entry, brokerUp) {
  const v = validateEntry(entry, { brokerUp });
  if (!v.ok) throw fail(v.errors.some((e) => e.field === "tier" && /broker/.test(e.message)) ? "broker_down" : "usage", v.errors.map((e) => e.message).join("; "));
}

// What the broker gets as an entry: the policy, commands as their paths (or names).
function brokerEntry(e) {
  return {
    name: e.name, scope: e.scope, mode: e.mode, hosts: e.hosts,
    commands: (e.commands || []).map((c) => c.path || c.name), allowShells: !!e.allowShells,
    expiresAt: e.expiresAt, note: e.note || "",
  };
}

// The broker's answer as a mirror entry (lastUsed* kept from the old one).
function mirrorOf(ans, old) {
  const e = { ...ans, tier: "protected" };
  e.commands = (e.commands || []).map((c) => (typeof c === "string" ? { name: path.basename(c), path: c.startsWith("/") ? c : null } : c));
  for (const k of ["lastUsedAt", "lastUsedBy", "lastUsedFor"]) if (e[k] === undefined) e[k] = old ? old[k] ?? null : null;
  if (e.createdAt === undefined) e.createdAt = old ? old.createdAt : Date.now();
  if (e.updatedAt === undefined) e.updatedAt = Date.now();
  if (e.grants === undefined) e.grants = [];
  if (e.note === undefined) e.note = "";
  delete e.value;
  delete e.valueB64;
  return e;
}

function replaceIn(entries, entry) {
  const i = entries.findIndex((x) => x.scope === entry.scope && x.name === entry.name);
  if (i < 0) entries.push(entry); else entries[i] = entry;
}

function dropFrom(entries, scope, name) {
  return entries.filter((x) => !(x.scope === scope && x.name === name));
}

function dropEnc(key) {
  const enc = readEnc();
  if (enc.entries[key]) {
    delete enc.entries[key];
    writeEnc(enc);
  }
}

function sealStandard(key, value) {
  const enc = readEnc();
  enc.entries[key] = seal(masterKey(), key, Buffer.from(value, "utf8"));
  writeEnc(enc);
}

// ---- the value ----

function stripOneNewline(s) {
  return s.endsWith("\r\n") ? s.slice(0, -2) : s.endsWith("\n") ? s.slice(0, -1) : s;
}

function utf8Text(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw fail("usage", "a value must be text (UTF-8)");
  }
}

// With echo off, on the terminal: what's typed until Enter.
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    let got = Buffer.alloc(0);
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      if (err) reject(err); else resolve(utf8Text(got));
    };
    const onData = (d) => {
      for (const b of d) {
        if (b === 13 || b === 10) return done();
        if (b === 3) return done(fail("usage", "cancelled"));
        if (b === 4 && !got.length) return done(fail("usage", "cancelled"));
        if (b === 127 || b === 8) { got = got.subarray(0, Math.max(0, got.length - 1)); continue; }
        got = Buffer.concat([got, Buffer.from([b])]);
      }
    };
    stdin.on("data", onData);
  });
}

async function readValue(o) {
  let value;
  if (o.valueStdin) value = stripOneNewline(utf8Text(fs.readFileSync(0)));
  else if (process.stdin.isTTY) value = await promptHidden(`Value for ${o.name} (not shown): `);
  else throw fail("usage", "put reads the value with --value-stdin, or asks for it on a terminal");
  if (!value) throw fail("usage", "the value is empty");
  return value;
}

// ---- put ----

// Creates or replaces a secret's value and policy. Flags not given keep an existing entry's
// policy; the expiry, when not given, is kept unless it has passed (then the default again).
export async function putEntry({ name, scope, set, value }) {
  remember(name, value);
  const defs = await vaultDefaults();
  const f = fieldsFrom(set);
  const entries = readMeta();
  const old = entries.find((x) => x.scope === scope && x.name === name) || null;
  const now = Date.now();
  const tier = f.tier || (old ? old.tier : defs["default-tier"]);
  const keepOld = old && old.tier === tier;
  const base = keepOld ? old : {
    mode: tier === "protected" ? "http" : "http+cli", hosts: old ? old.hosts : [], commands: old ? old.commands : [],
    allowShells: false, note: old ? old.note : "",
  };
  let expiresAt = f.expiresAt;
  if (expiresAt === undefined) {
    if (old && (old.expiresAt === null || old.expiresAt > now)) expiresAt = old.expiresAt;
    else { const ms = ttlMs(defs["default-ttl"]); expiresAt = ms === null ? null : now + (ms ?? ttlMs("24h")); }
  }
  const entry = {
    name, scope, tier,
    mode: f.mode ?? base.mode,
    hosts: f.hosts ?? base.hosts ?? [],
    commands: f.commands ?? base.commands ?? [],
    allowShells: tier === "protected" ? (f.allowShells ?? base.allowShells ?? false) : false,
    grants: [],
    createdAt: old ? old.createdAt ?? now : now, updatedAt: now, expiresAt,
    lastUsedAt: old ? old.lastUsedAt : null, lastUsedBy: old ? old.lastUsedBy : null, lastUsedFor: old ? old.lastUsedFor : null,
    note: f.note ?? base.note ?? "",
  };
  if (entry.mode === "http") entry.commands = [];
  checkValid(entry, tier === "protected" ? true : undefined);
  const key = entryKey(scope, name);
  let saved = entry;
  if (tier === "protected") {
    const ans = await brokerRequest("put", { caller: caller({}), entry: brokerEntry(entry), valueB64: Buffer.from(value, "utf8").toString("base64"), searchPath: process.env.PATH || "" });
    saved = mirrorOf(ans.entry, old);
  } else if (old && old.tier === "protected") {
    await brokerRequest("delete", { caller: caller({}), name, scope });
  }
  return withLock(() => {
    if (tier === "protected") dropEnc(key);
    else sealStandard(key, value);
    const now2 = readMeta();
    replaceIn(now2, saved);
    writeMeta(now2);
    return saved;
  });
}

// ---- edit ----

export async function editEntry({ name, scope, set }) {
  const f = fieldsFrom(set);
  if (f.tier !== undefined) throw fail("usage", "edit doesn't change the tier: herdr-ws-secret migrate <name> --tier …");
  if (!Object.keys(f).length) throw fail("usage", "nothing to change");
  const old = readMeta().find((x) => x.scope === scope && x.name === name);
  if (!old) throw fail("not_found", `no secret named ${name} in ${scope === "global" ? "every workspace" : scope.slice(3)}`);
  let saved;
  if (old.tier === "protected") {
    const patch = { ...f };
    if (patch.commands) patch.commands = patch.commands.map((c) => c.path || c.name);
    const ans = await brokerRequest("policy", { caller: caller({}), name, scope, patch, searchPath: process.env.PATH || "" });
    saved = mirrorOf(ans.entry, old);
  } else {
    saved = { ...old, ...f, updatedAt: Date.now() };
    if (saved.mode === "http" && f.commands === undefined) saved.commands = [];
    checkValid(saved);
  }
  return withLock(() => {
    const entries = readMeta();
    replaceIn(entries, saved);
    writeMeta(entries);
    return saved;
  });
}

// ---- migrate ----

export async function migrateEntry({ name, scope, tier }) {
  if (!["standard", "protected"].includes(tier)) throw fail("usage", "--tier is standard or protected");
  const old = readMeta().find((x) => x.scope === scope && x.name === name);
  if (!old) throw fail("not_found", `no secret named ${name} in ${scope === "global" ? "every workspace" : scope.slice(3)}`);
  if (old.tier === tier) return old;
  const key = entryKey(scope, name);
  let saved;
  let sealed = null;
  if (tier === "protected") {
    // Standard → Protected: the value goes to the broker as a put.
    const want = { ...old, tier: "protected", allowShells: false };
    checkValid(want, true);
    const value = standardValue(old);
    const ans = await brokerRequest("put", { caller: caller({}), entry: brokerEntry(want), valueB64: Buffer.from(value, "utf8").toString("base64"), searchPath: process.env.PATH || "" });
    saved = mirrorOf(ans.entry, old);
  } else {
    // Protected → Standard: the broker asks the person, then seals the value under our key
    // (it deletes its item once sealed). The record must open here before it's kept.
    const mk = masterKey();
    const ans = await brokerRequest("migrate", { caller: caller({}), name, scope, to: "standard", keyB64: mk.toString("base64") });
    const rec = ans.sealed;
    if (!rec || !rec.iv || !rec.ct || !rec.tag) throw fail("failed", "the broker's sealed record is missing");
    open(mk, key, rec);
    sealed = { iv: rec.iv, ct: rec.ct, tag: rec.tag };
    const e = ans.entry || old;
    saved = {
      ...old, ...e, tier: "standard", allowShells: false, grants: [],
      commands: (e.commands || []).map((c) => ({ name: typeof c === "string" ? path.basename(c) : c.name, path: null })),
      updatedAt: Date.now(),
    };
  }
  return withLock(() => {
    if (sealed) {
      const enc = readEnc();
      enc.entries[key] = sealed;
      writeEnc(enc);
    } else {
      dropEnc(key);
    }
    const entries = readMeta();
    replaceIn(entries, saved);
    writeMeta(entries);
    return saved;
  });
}

// ---- rm ----

export async function removeEntry({ name, scope }) {
  return withLock(async () => {
    const entries = readMeta();
    const old = entries.find((x) => x.scope === scope && x.name === name);
    if (!old) throw fail("not_found", `no secret named ${name} in ${scope === "global" ? "every workspace" : scope.slice(3)}`);
    if (old.tier === "protected") {
      try {
        await brokerRequest("delete", { caller: caller({}), name, scope });
      } catch (err) {
        if (err.kind !== "not_found") throw err;
      }
    } else {
      dropEnc(entryKey(scope, name));
    }
    writeMeta(dropFrom(entries, scope, name));
    return old;
  });
}

// ---- sync: the mirror from the broker ----

export async function syncMirror() {
  const ans = await brokerRequest("list", { caller: caller({}) });
  return withLock(() => {
    const entries = readMeta();
    const olds = entries.filter((e) => e.tier === "protected");
    const keep = entries.filter((e) => e.tier !== "protected");
    for (const b of ans.entries || []) {
      const old = olds.find((x) => x.scope === b.scope && x.name === b.name);
      const m = mirrorOf(b, old);
      // A Standard entry of the same key loses to the broker's (the broker has the value).
      const i = keep.findIndex((x) => x.scope === m.scope && x.name === m.name);
      if (i >= 0) keep.splice(i, 1);
      keep.push(m);
    }
    writeMeta(keep);
    return keep.filter((e) => e.tier === "protected").length;
  });
}

// ---- ingest: a screen's one-shot handoff ----

// The file must be <vault>/.inbox-*, a regular file of ours, 0600. It is read and unlinked
// before anything else happens; one that doesn't pass is refused and left alone.
export async function ingest(file) {
  if (!file) throw fail("usage", "ingest needs the inbox file");
  const dir = fs.realpathSync(ensureVaultDir());
  let fd;
  let data;
  try {
    const abs = path.resolve(file);
    const parent = fs.realpathSync(path.dirname(abs));
    if (parent !== dir || !path.basename(abs).startsWith(".inbox-")) throw fail("refused", "ingest reads only the vault's own .inbox-* files");
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | (fs.constants.O_NONBLOCK || 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw fail("refused", "the inbox isn't a plain file");
    if ((st.mode & 0o777) !== 0o600) throw fail("refused", "the inbox file must be mode 0600");
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw fail("refused", "the inbox file isn't yours");
    data = fs.readFileSync(fd);
    fs.unlinkSync(abs);
  } catch (err) {
    if (err.kind) throw err;
    if (err.code === "ELOOP") throw fail("refused", "the inbox file is a link");
    if (err.code === "ENOENT") throw fail("not_found", "no such inbox file");
    throw fail("failed", "couldn't read the inbox file");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  let req;
  try { req = JSON.parse(data.toString("utf8")); } catch { throw fail("usage", "the inbox file isn't JSON"); }
  data.fill(0);
  if (!req || typeof req !== "object") throw fail("usage", "the inbox file isn't a request");
  const name = req.name;
  if (!validName(name)) throw fail("usage", "a name is 1 to 64 of a-z 0-9 . _ - and starts with a letter or digit");
  const scope = req.scope || "global";
  if (!validScope(scope)) throw fail("usage", "the scope is \"global\" or \"ws:<id>\"");
  const set = {};
  for (const k of ["tier", "mode", "hosts", "commands", "allowShells", "ttl", "note"]) if (req[k] !== undefined && req[k] !== null) set[k] = req[k];
  switch (req.op) {
    case "put": {
      if (typeof req.value !== "string" || !req.value) throw fail("usage", "put needs a value");
      return putEntry({ name, scope, set, value: req.value });
    }
    case "edit": return editEntry({ name, scope, set });
    case "migrate": return migrateEntry({ name, scope, tier: req.tier });
    case "rm": return removeEntry({ name, scope });
    default: throw fail("usage", "op is put, edit, migrate or rm");
  }
}

// ---- list ----

// The secrets this caller can use (the workspace's, then every workspace's); never a value.
// all: every scope (for a person at a terminal).
export async function listEntries({ workspace, global, all }) {
  const m = readMetaSoft();
  if (m.error) throw fail("failed", m.error);
  const who = caller({ workspace, global });
  const list = all ? m.entries.slice().sort((a, b) => (a.scope + a.name < b.scope + b.name ? -1 : 1)) : filterEntries(m.entries, { ws: who.ws });
  const hasProtected = list.some((e) => e.tier === "protected");
  const up = hasProtected ? !!(await brokerStatus(800)) : true;
  // Other workspaces' secrets, left out: an empty list says they're there and how to see them.
  const others = all ? [] : m.entries.filter((e) => !list.includes(e));
  return { who, up, entries: list, others };
}

export function listText({ who, up, entries, others }) {
  if (!entries.length) {
    const none = `No secrets for ${who.ws ? `${who.ws} or every workspace` : "every workspace"} yet.`;
    const ids = [...new Set((others || []).filter((e) => e.scope.startsWith("ws:")).map((e) => e.scope.slice(3)))];
    if (ids.length) {
      const n = others.length;
      return `${none} ${n} more ${n === 1 ? "is" : "are"} kept for ${ids.length === 1 ? "workspace" : "workspaces"} (${ids.join(", ")}): herdr-ws-secret list --all\n`;
    }
    return `${none} The person adds them in Herdr's Secrets (sidebar), or: herdr-ws-secret put <name>\n`;
  }
  const now = Date.now();
  const rows = entries.map((e) => [
    e.name,
    e.scope === "global" ? "every workspace" : e.scope.slice(3),
    e.tier === "protected" ? (up ? "protected" : "protected (broker off)") : "standard",
    usageLabel(e),
    expiryLabel(e, now) || "never",
  ]);
  const head = ["NAME", "SCOPE", "TIER", "USE", "EXPIRES"];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join("  ");
  let out = [line(head), ...rows.map(line)].join("\n") + "\n";
  out += "\nUse one: herdr-ws-secret http <url> -H 'Authorization: Bearer {{secret:NAME}}'   or   herdr-ws-secret run --env VAR=NAME -- <command>\n";
  if (!up) out += "Protected secrets need the broker: turn it on in Settings > Secrets, or run herdr-ws-secret broker install.\n";
  return out;
}

// JSON for screens and agents: metadata only.
export function listJson({ who, up, entries }) {
  return { ok: true, workspace: who.ws, broker: up, entries: entries.map((e) => ({ ...e, brokerOff: e.tier === "protected" && !up })) };
}

// ---- redact: stdin (or --in FILE) to stdout with Standard secrets' forms replaced ----

export async function redactCommand(argv) {
  let names = null;
  let input = null;
  let workspace = null;
  let global = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw fail("usage", `${a} needs a value`);
      return argv[++i];
    };
    if (a === "--names") names = val().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--in") input = val();
    else if (a === "--workspace") workspace = val();
    else if (a === "--global") global = true;
    else throw fail("usage", `redact doesn't know ${a}`);
  }
  if (!names || !names.length) throw fail("usage", "redact --names a,b [--in FILE]");
  const who = caller({ workspace, global });
  const entries = readMeta();
  const secrets = [];
  for (const n of names) {
    // Expired ones are still redacted: their value may well be in old output.
    const e = resolveEntry(entries, who.ws, n);
    if (!e) throw fail("not_found", `no secret named ${n}`);
    if (e.tier === "protected") throw fail("refused", `${n} is Protected: only the broker can redact it`);
    secrets.push({ name: n, value: Buffer.from(standardValue(e), "utf8").toString("latin1") });
  }
  const r = makeRedactor(secrets, { bytes: true });
  const src = input ? fs.createReadStream(input) : process.stdin;
  await new Promise((resolve, reject) => {
    src.on("data", (d) => { const t = r.push(Buffer.from(d).toString("latin1")); if (t) process.stdout.write(Buffer.from(t, "latin1")); });
    src.on("end", resolve);
    src.on("error", () => reject(fail("failed", `can't read ${input || "stdin"}`)));
  });
  const t = r.end();
  await new Promise((res) => process.stdout.write(Buffer.from(t, "latin1"), res));
  return 0;
}

export { parseOpArgs as parseArgs, scopeFrom, readValue, vaultDir };
