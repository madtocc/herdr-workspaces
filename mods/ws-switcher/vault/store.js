// Tier 1 (Standard): the master key, standard.enc (AES-256-GCM, a fresh IV each write, AAD =
// the entry's key), and meta.json (every entry's metadata, never a value), plus usage.jsonl.
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { vaultFile, ensureVaultDir, writeAtomic, readText, fail, remember } from "./base.js";
import { parseMeta, entryKey, usageLine } from "../vaultfacts.js";

const SERVICE = "herdr-ws-vault-standard";
const ACCOUNT = "master";
const SECURITY = "/usr/bin/security";

// ---- the master key ----
// A vault.key that's there is used as it is, before any Keychain; else the Keychain on macOS, or
// the desktop's keyring (Secret Service, through secret-tool) on Linux (unless HERDR_VAULT_KEY=file);
// else a new vault.key. HERDR_VAULT_KEYCHAIN names the keychain file the security calls use (a
// throwaway one in a test). A keychain or keyring that's there but doesn't answer is an error, never
// a new key: one made then would leave every secret sealed with the old one unreadable.

function keyFromFile() {
  const file = vaultFile("vault.key");
  const text = readText(file);
  if (text === null) return null;
  const key = Buffer.from(text.trim(), "base64");
  if (key.length !== 32) throw fail("failed", "vault.key isn't a 32-byte key in base64");
  return key;
}

function useKeychain() {
  return process.platform === "darwin" && process.env.HERDR_VAULT_KEY !== "file" && fs.existsSync(SECURITY);
}

function keychainArgs() {
  const kc = process.env.HERDR_VAULT_KEYCHAIN;
  return kc ? [kc] : [];
}

function keyFromKeychain() {
  const r = spawnSync(SECURITY, ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", ...keychainArgs()], { encoding: "utf8" });
  if (r.status === 44) return null; // not there
  if (r.status !== 0) throw fail("keychain", `the Keychain didn't give the vault's key (security exited ${r.status})`);
  const key = Buffer.from(r.stdout.trim(), "base64");
  if (key.length !== 32) throw fail("keychain", "the vault's key in the Keychain isn't a 32-byte key");
  return key;
}

// Through `security -i`, which reads the command from stdin: the key is never in an argument list.
function keyToKeychain(key) {
  const q = (s) => '"' + String(s).replace(/(["\\])/g, "\\$1") + '"';
  const kc = process.env.HERDR_VAULT_KEYCHAIN;
  const line = `add-generic-password -U -s ${q(SERVICE)} -a ${q(ACCOUNT)} -l ${q("Herdr Secrets (Standard)")} -w ${q(key.toString("base64"))}${kc ? " " + q(kc) : ""}\n`;
  const r = spawnSync(SECURITY, ["-i"], { input: line, encoding: "utf8" });
  if (r.status !== 0 || /error|fail/i.test(r.stderr || "")) throw fail("keychain", "couldn't keep the vault's key in the Keychain");
}

// ---- Linux: the Secret Service (GNOME Keyring, KWallet), through secret-tool ----
// Used when secret-tool is on PATH and a session bus is there. The key goes in on stdin, never as an
// argument. A new key goes there only while the keyring is unlocked (keyringState); reading one from a
// locked keyring asks the person to unlock it (the desktop's own dialog), with a minute's wait.
const SECRET_TOOL_ATTRS = ["service", SERVICE, "account", ACCOUNT];
let secretTool;
function secretToolPath() {
  if (secretTool !== undefined) return secretTool;
  secretTool = null;
  for (const dir of String(process.env.PATH ?? "").split(":")) {
    const p = `${dir || "."}/secret-tool`;
    try { fs.accessSync(p, fs.constants.X_OK); secretTool = p; break; } catch { /* not here */ }
  }
  return secretTool;
}

function useSecretService() {
  return process.platform === "linux" && process.env.HERDR_VAULT_KEY !== "file" &&
    Boolean(process.env.DBUS_SESSION_BUS_ADDRESS || process.env.XDG_RUNTIME_DIR) && Boolean(secretToolPath());
}

// Whether the keyring a new key would go into (the Secret Service's default collection) is there
// and unlocked: "unlocked" | "locked" | "absent" (no default collection: one would be made with a
// dialog) | null (no answer). Asked of busctl, else gdbus, so nothing prompts.
function keyringState() {
  const path = "/org/freedesktop/secrets/aliases/default";
  const ask = [
    ["busctl", ["--user", "get-property", "org.freedesktop.secrets", path, "org.freedesktop.Secret.Collection", "Locked"]],
    ["gdbus", ["call", "--session", "--dest", "org.freedesktop.secrets", "--object-path", path, "--method", "org.freedesktop.DBus.Properties.Get", "org.freedesktop.Secret.Collection", "Locked"]],
  ];
  for (const [cmd, args] of ask) {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
    if (r.error) continue; // not installed
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (r.status === 0 && /\btrue\b/.test(out)) return "locked";
    if (r.status === 0 && /\bfalse\b/.test(out)) return "unlocked";
    if (/does not exist|UnknownObject|UnknownMethod|No such object/i.test(out)) return "absent";
    return null;
  }
  return null;
}

function keyFromSecretService() {
  const r = spawnSync(secretToolPath(), ["lookup", ...SECRET_TOOL_ATTRS], { encoding: "utf8", timeout: 60000 });
  const out = String(r.stdout ?? "").trim(), err = String(r.stderr ?? "").trim();
  // Not there: exit 1 with nothing said. Anything else said (no keyring, locked, timed out): an error.
  if (r.status === 1 && !out && !err) return null;
  if (r.status !== 0 || r.error) throw fail("keychain", `the desktop keyring didn't give the vault's key${err ? ` (${err.split("\n")[0]})` : r.error ? ` (${r.error.code ?? r.error.message})` : ""}; set HERDR_VAULT_KEY=file to keep it in ~/.herdr/vault instead`);
  const key = Buffer.from(out, "base64");
  if (key.length !== 32) throw fail("keychain", "the vault's key in the desktop keyring isn't a 32-byte key");
  return key;
}

function keyToSecretService(key) {
  const r = spawnSync(secretToolPath(), ["store", "--label", "Herdr Secrets (Standard)", ...SECRET_TOOL_ATTRS],
    { input: key.toString("base64"), encoding: "utf8", timeout: 60000 });
  if (r.status !== 0 || r.error) {
    const err = String(r.stderr ?? "").trim().split("\n")[0];
    throw fail("keychain", `couldn't keep the vault's key in the desktop keyring${err ? ` (${err})` : ""}; set HERDR_VAULT_KEY=file to keep it in ~/.herdr/vault instead`);
  }
}

let cachedKey = null;

// The key, made when there's none yet (create: false only reads).
export function masterKey({ create = true } = {}) {
  if (cachedKey) return cachedKey;
  let key = keyFromFile();
  if (!key && useKeychain()) {
    key = keyFromKeychain();
    if (!key && create) {
      key = crypto.randomBytes(32);
      keyToKeychain(key);
      const back = keyFromKeychain();
      if (!back || !back.equals(key)) throw fail("keychain", "the vault's key didn't read back from the Keychain");
    }
  } else if (!key && useSecretService()) {
    // Secrets sealed already and no vault.key: their key is in the keyring (unlocking it may ask).
    // A new vault: the keyring only when it's there and open, so no dialog ever waits on an
    // agent or an automation (autologin and SSH sessions often have it locked); else the file.
    // A failed store falls back to the file too: no secret was sealed with a key yet.
    if (fs.existsSync(vaultFile("standard.enc"))) {
      key = keyFromSecretService();
      if (!key) throw fail("keychain", "standard.enc is there but its key isn't (no vault.key, nothing in the desktop keyring)");
    } else if (create && keyringState() === "unlocked") {
      const made = crypto.randomBytes(32);
      try {
        keyToSecretService(made);
        const back = keyFromSecretService();
        if (back && back.equals(made)) key = made;
      } catch { /* the file, below */ }
    }
  }
  if (!key && create) {
    ensureVaultDir();
    key = crypto.randomBytes(32);
    writeAtomic(vaultFile("vault.key"), key.toString("base64") + "\n");
  }
  if (!key) return null;
  cachedKey = key;
  return key;
}

// Where the key is: "file" | "keychain" | "keyring" (Linux's Secret Service) | null (none yet).
export function keyPlace() {
  if (fs.existsSync(vaultFile("vault.key"))) return "file";
  if (useKeychain()) return keyFromKeychain() ? "keychain" : null;
  if (useSecretService() && fs.existsSync(vaultFile("standard.enc"))) return keyFromSecretService() ? "keyring" : null;
  return null;
}

// ---- sealing ----

export function seal(key, entryKeyText, value) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(entryKeyText, "utf8"));
  const ct = Buffer.concat([c.update(value), c.final()]);
  return { iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") };
}

export function open(key, entryKeyText, rec) {
  try {
    const iv = Buffer.from(rec.iv, "base64");
    const tag = Buffer.from(rec.tag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("bad record");
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(entryKeyText, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(rec.ct, "base64")), d.final()]);
  } catch {
    throw fail("failed", `${entryKeyText} doesn't open: standard.enc was changed, or the key isn't the one it was sealed with`);
  }
}

// ---- standard.enc ----

export function readEnc() {
  const text = readText(vaultFile("standard.enc"));
  if (text === null || !text.trim()) return { v: 1, entries: {} };
  try {
    const o = JSON.parse(text);
    if (o && o.v === 1 && o.entries && typeof o.entries === "object") return o;
  } catch { /* below */ }
  throw fail("failed", "standard.enc is broken");
}

export function writeEnc(enc) {
  ensureVaultDir();
  writeAtomic(vaultFile("standard.enc"), JSON.stringify(enc, null, 1) + "\n");
}

// A Standard entry's value, as a UTF-8 string (remembered so no error can show it).
export function standardValue(entry) {
  const k = entryKey(entry.scope, entry.name);
  const rec = readEnc().entries[k];
  if (!rec) throw fail("not_found", `${entry.name} has no stored value (sync, or put it again)`);
  const key = masterKey({ create: false });
  if (!key) throw fail("failed", "the vault's key is gone, so Standard secrets can't be opened");
  const value = open(key, k, rec).toString("utf8");
  remember(entry.name, value);
  return value;
}

// ---- meta.json ----

export function readMeta() {
  const text = readText(vaultFile("meta.json"));
  const m = parseMeta(text);
  if (m.error) throw fail("failed", m.error);
  return m.entries;
}

// For list: what reads, and the error instead of throwing.
export function readMetaSoft() {
  return parseMeta(readText(vaultFile("meta.json")));
}

export function writeMeta(entries) {
  ensureVaultDir();
  writeAtomic(vaultFile("meta.json"), JSON.stringify({ v: 1, entries }, null, 1) + "\n");
}

// ---- usage.jsonl ----

const USAGE_MAX = 512 * 1024;

// One line per use; over 512 KB, the oldest half goes.
export function appendUsage(event) {
  ensureVaultDir();
  const file = vaultFile("usage.jsonl");
  const fd = fs.openSync(file, "a", 0o600);
  try { fs.writeSync(fd, usageLine(event) + "\n"); } finally { fs.closeSync(fd); }
  try {
    if (fs.statSync(file).size > USAGE_MAX) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      writeAtomic(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
    }
  } catch { /* trimming can wait for the next use */ }
}
