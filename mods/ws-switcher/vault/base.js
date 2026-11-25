// What every part of herdr-ws-secret shares: where the vault is, its errors and exit codes,
// writing files so a crash never leaves half of one, and the lock that keeps two of us from
// writing meta.json at once.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// This mod's folder (ws-switcher) and the folder of mods beside it.
export const MOD_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MODS_DIR = path.dirname(MOD_DIR);

export function vaultDir() {
  const env = process.env.HERDR_VAULT_DIR;
  return env ? path.resolve(env) : path.join(os.homedir(), ".herdr", "vault");
}

export function vaultFile(name) {
  return path.join(vaultDir(), name);
}

// The vault folder, made 0700 when missing (and put back to 0700 when it isn't).
export function ensureVaultDir() {
  const dir = vaultDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.statSync(dir);
  if ((st.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
  return dir;
}

// Exit codes (CONTRACT 5): 0 done, 2 usage, 3 no such secret, 4 expired, 5 refused by policy,
// 6 broker not running (or not macOS), 7 the person said no, 1 anything else.
export const EXIT = { usage: 2, bad_request: 2, not_found: 3, expired: 4, refused: 5, broker_down: 6, denied: 7, keychain: 1, failed: 1 };

export class VaultError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
  get code() {
    return EXIT[this.kind] ?? 1;
  }
}

export const fail = (kind, message) => new VaultError(kind, message);

export const BROKER_OFF = "the Protected broker isn't running: turn it on in Settings > Secrets, or run herdr-ws-secret broker install";

// Values this process has seen, so no error message can carry one by accident.
const known = [];
export function remember(name, value) {
  if (value) known.push({ name, value });
}
export function knownSecrets() {
  return known;
}

// Writes a file whole: a 0600 temp file beside it, then a rename over it.
export function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeSync(fd, typeof data === "string" ? Buffer.from(data) : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLock(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

// Whether a lock is left over: the process it names is gone, or it's older than 2 minutes (a
// reused pid; nothing holds it that long, the broker is asked outside it).
function lockIsStale(text, file) {
  let age = 0;
  try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { return false; }
  if (age > 120000) return true;
  const pid = Number(String(text || "").split(" ")[0]);
  if (!(pid > 0)) return age > 30000;
  try { process.kill(pid, 0); return false; } catch (err) { return err.code === "ESRCH"; }
}

// Takes <vault>/.lock: one writer of meta.json and standard.enc at a time. The lock is made
// whole and put in place in one step (a link of a file holding "<pid> <token>"), so it's never
// seen half-written. One whose process is gone is taken over by renaming it aside first: only
// one waiter can do that, and it checks it moved the lock it judged stale (else it puts it
// back). Returns the token; waitMs: how long to wait for a live holder.
export function takeLock({ waitMs = 10000 } = {}) {
  ensureVaultDir();
  const lock = vaultFile(".lock");
  const token = `${process.pid} ${crypto.randomBytes(8).toString("hex")}`;
  const mine = vaultFile(`.lock.${process.pid}.${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(mine, token, { mode: 0o600, flag: "wx" });
  const start = Date.now();
  try {
    for (;;) {
      try {
        fs.linkSync(mine, lock);
        return token;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
      const seen = readLock(lock);
      if (seen !== null && lockIsStale(seen, lock)) {
        const aside = vaultFile(`.lock.stale.${crypto.randomBytes(4).toString("hex")}`);
        try {
          fs.renameSync(lock, aside);
          const moved = readLock(aside);
          if (moved === seen) fs.unlinkSync(aside);
          else {
            // Someone else's fresh lock: put it back (if a third took the place meanwhile, theirs stays).
            try { fs.linkSync(aside, lock); } catch { /* taken */ }
            fs.unlinkSync(aside);
          }
        } catch { /* it went meanwhile */ }
        continue;
      }
      if (Date.now() - start > waitMs) throw fail("failed", "the vault is busy (another herdr-ws-secret holds its lock)");
      sleep(25);
    }
  } finally {
    try { fs.unlinkSync(mine); } catch { /* gone */ }
  }
}

// Gives the lock back, only while it's still ours.
export function releaseLock(token) {
  const lock = vaultFile(".lock");
  if (readLock(lock) === token) {
    try { fs.unlinkSync(lock); } catch { /* gone */ }
  }
}

// Runs fn holding the lock.
export async function withLock(fn) {
  const token = takeLock();
  try {
    return await fn();
  } finally {
    releaseLock(token);
  }
}

export function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
