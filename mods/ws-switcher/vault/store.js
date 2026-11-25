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
// A vault.key that's there is used as it is, before any Keychain; else the Keychain on macOS
// (unless HERDR_VAULT_KEY=file); else a new vault.key. HERDR_VAULT_KEYCHAIN names the keychain
// file the security calls use (a throwaway one in a test).

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

// Where the key is: "file" | "keychain" | null (none yet).
export function keyPlace() {
  if (fs.existsSync(vaultFile("vault.key"))) return "file";
  if (useKeychain()) return keyFromKeychain() ? "keychain" : null;
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
