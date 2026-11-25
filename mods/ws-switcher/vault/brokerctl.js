// herdr-ws-secret broker install|status|restart|uninstall: the Protected broker, built here
// from the vaultd.swift beside the mods (ws-vault/broker/), signed ad hoc, and kept running by
// a LaunchAgent. Uninstall takes the LaunchAgent away and leaves the secrets (and the binary:
// the Keychain trusts that exact build, so a rebuild would make macOS ask for each secret).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fail, vaultDir, vaultFile, ensureVaultDir, MOD_DIR, MODS_DIR, sha256, writeAtomic, readText } from "./base.js";
import { socketPath, brokerStatus } from "./broker.js";

const LABEL = "dev.herdr.ws-vaultd";
const SWIFTC = "/usr/bin/swiftc";

// Where its source and build script are: <mods>/ws-vault/broker (HERDR_VAULT_BROKER_DIR in tests).
function brokerSrcDir() {
  return process.env.HERDR_VAULT_BROKER_DIR || path.join(MODS_DIR, "ws-vault", "broker");
}

function plistPath() {
  const dir = process.env.HERDR_WS_LAUNCH_AGENTS_DIR || path.join(os.homedir(), "Library", "LaunchAgents");
  return path.join(dir, LABEL + ".plist");
}

const binPath = () => vaultFile(path.join("bin", "herdr-ws-vaultd"));
const shaPath = () => vaultFile(path.join("bin", ".source-sha256"));
const domain = () => `gui/${process.getuid()}`;

function launchctl(...args) {
  return spawnSync("launchctl", args, { encoding: "utf8" });
}

// What .source-sha256 keeps about the installed build: the source's sha256 (line 1, as the
// contract has it), then "flags: <HERDR_VAULT_SWIFT_FLAGS>" when there were any, then
// "package: <ws-switcher/VERSION>" (the package it came with).
function packageVersion() {
  return (readText(path.join(MOD_DIR, "VERSION")) || "").trim() || "unknown";
}

function sourceNow() {
  const src = path.join(brokerSrcDir(), "vaultd.swift");
  if (!fs.existsSync(src)) return null;
  const flags = (process.env.HERDR_VAULT_SWIFT_FLAGS || "").trim();
  return { sha: sha256(fs.readFileSync(src)), flags, pkg: packageVersion() };
}

function stampText(n) {
  return n.sha + "\n" + (n.flags ? "flags: " + n.flags + "\n" : "") + "package: " + n.pkg + "\n";
}

function readStamp() {
  const t = readText(shaPath());
  if (t === null) return null;
  const lines = t.split("\n");
  const get = (k) => (lines.find((l) => l.startsWith(k + ": ")) || "").slice(k.length + 2) || null;
  return { sha: lines[0].trim(), flags: get("flags") || "", pkg: get("package") };
}

// How the installed build stands against the source beside the mod: "none" (built from it, or
// nothing installed), "update" (the source differs and so does the package version: an
// update), "unexpected" (the source differs and the package version doesn't: someone changed
// vaultd.swift by hand, or something else did).
function driftOf(stamp, now) {
  if (!stamp || !now || stamp.sha === now.sha) return "none";
  return stamp.pkg !== now.pkg ? "update" : "unexpected";
}

const PROMPT_NOTE = "macOS may ask whether herdr-ws-vaultd may use your Protected secrets: allow it only right after you pressed Install or Update yourself; if it appears on its own, click Deny.";

function codesignInfo(bin) {
  const r = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", bin], { encoding: "utf8" });
  const text = (r.stderr || "") + (r.stdout || "");
  if (r.status !== 0) return { signed: "unsigned", hardened: false };
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(text);
  const list = flags ? flags[1].split(",") : [];
  const signed = /Signature=adhoc/.test(text) || list.includes("adhoc") ? "adhoc" : "identity";
  return { signed, hardened: list.includes("runtime") };
}

function xml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// The LaunchAgent: runs the broker at login and again whenever it stops; its log in the vault.
function plistText() {
  const env = {};
  if (process.env.HERDR_VAULT_DIR) env.HERDR_VAULT_DIR = vaultDir();
  for (const k of ["VAULTD_TEST_KEYCHAIN", "VAULTD_TEST_CONFIRM"]) if (process.env[k]) env[k] = process.env[k];
  const envXml = Object.keys(env).length
    ? `  <key>EnvironmentVariables</key>\n  <dict>\n${Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>\n`).join("")}  </dict>\n`
    : "";
  const log = vaultFile("broker.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(binPath())}</string>
  </array>
${envXml}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

function needMac() {
  if (process.platform !== "darwin") throw fail("broker_down", "the Protected broker is for macOS only; Standard secrets work everywhere");
}

async function waitUp(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await brokerStatus(500);
    if (s) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

function load() {
  launchctl("bootout", `${domain()}/${LABEL}`);
  const r = launchctl("bootstrap", domain(), plistPath());
  if (r.status !== 0) throw fail("failed", `launchctl couldn't load the broker (${(r.stderr || "").trim() || "exit " + r.status})`);
}

export async function install({ log = (s) => process.stderr.write(s + "\n"), rebuild = false } = {}) {
  needMac();
  if (!fs.existsSync(SWIFTC)) throw fail("failed", "building the broker needs Apple's Swift compiler: xcode-select --install");
  const dir = brokerSrcDir();
  const now = sourceNow();
  if (!now) throw fail("failed", `the broker's source isn't there (${path.join(dir, "vaultd.swift")})`);
  ensureVaultDir();
  fs.mkdirSync(vaultFile("bin"), { recursive: true, mode: 0o700 });
  const had = fs.existsSync(binPath());
  const stamp = readStamp();
  if (had && driftOf(stamp, now) === "unexpected" && !rebuild) {
    throw fail("refused", "vaultd.swift changed without a package update: rebuild only if you changed it yourself (herdr-ws-secret broker install --rebuild)");
  }
  let built = false;
  if (!(had && stamp && stamp.sha === now.sha && stamp.flags === now.flags)) {
    const out = binPath() + ".new";
    const flags = (process.env.HERDR_VAULT_SWIFT_FLAGS || "").trim().split(/\s+/).filter(Boolean);
    log("Building the broker (a minute the first time)…");
    const r = spawnSync("/bin/sh", [path.join(dir, "build.sh"), out, ...flags], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0 || !fs.existsSync(out)) {
      const why = ((r.stderr || "") + (r.stdout || "")).trim().split("\n").slice(-3).join(" ");
      throw fail("failed", "the broker didn't build: " + (why || "build.sh exited " + r.status));
    }
    fs.renameSync(out, binPath());
    built = true;
    if (had) log(PROMPT_NOTE);
  }
  // The same source with a newer package: no build (a new binary would make macOS ask again),
  // only the package line moves on.
  writeAtomic(shaPath(), stampText(now));
  const plist = plistPath();
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  writeAtomic(plist, plistText());
  fs.chmodSync(plist, 0o644);
  const lint = spawnSync("/usr/bin/plutil", ["-lint", plist], { encoding: "utf8" });
  if (lint.status !== 0) throw fail("failed", "the LaunchAgent file didn't pass plutil -lint");
  load();
  const up = await waitUp(5000);
  return { built, running: !!up };
}

export async function status() {
  const s = {
    platform: process.platform === "darwin" ? "macos" : "other",
    installed: false, running: false, loaded: false, binary: null, signed: null, hardened: null,
    count: null, version: null, current: false, drift: "none", swiftc: fs.existsSync(SWIFTC), socket: socketPath(), error: null,
  };
  if (s.platform !== "macos") { s.error = "the Protected broker is for macOS only"; return s; }
  const bin = binPath();
  if (fs.existsSync(bin)) s.binary = bin;
  s.installed = !!s.binary && fs.existsSync(plistPath());
  s.loaded = launchctl("print", `${domain()}/${LABEL}`).status === 0;
  const now = sourceNow();
  const stamp = s.binary ? readStamp() : null;
  s.current = !!now && !!stamp && stamp.sha === now.sha && stamp.flags === now.flags;
  s.drift = s.binary ? driftOf(stamp, now) : "none";
  const live = await brokerStatus(1000);
  if (live) {
    s.running = true;
    s.signed = live.signed ?? null;
    s.hardened = live.hardened ?? null;
    s.count = live.count ?? null;
    s.version = live.version ?? null;
  } else if (s.binary) {
    const c = codesignInfo(bin);
    s.signed = c.signed;
    s.hardened = c.hardened;
  }
  if (!now) s.error = "the broker's source isn't beside the mods";
  else if (s.installed && !s.running) s.error = "installed but not answering (see " + vaultFile("broker.log") + ")";
  return s;
}

export function statusText(s) {
  if (s.platform !== "macos") return "The Protected broker is for macOS only. Standard secrets work here.\n";
  const lines = [];
  if (s.running) lines.push(`running: ${s.version || "?"}, ${s.count ?? "?"} Protected secret(s), signed ${s.signed}${s.hardened ? ", hardened" : ""}`);
  else if (s.installed) lines.push("installed, not running");
  else lines.push("not installed: herdr-ws-secret broker install (or Settings > Secrets)");
  if (s.installed && s.drift === "update") lines.push("built from an older vaultd.swift: broker install updates it. " + PROMPT_NOTE);
  else if (s.installed && s.drift === "unexpected") lines.push("vaultd.swift changed without a package update. Rebuild only if you changed it yourself (broker install --rebuild).");
  else if (s.installed && !s.current) lines.push("built with other build flags: broker install rebuilds it");
  if (s.error && s.installed) lines.push(s.error);
  return lines.join("\n") + "\n";
}

export async function restart() {
  needMac();
  if (!fs.existsSync(plistPath())) throw fail("broker_down", "the broker isn't installed: herdr-ws-secret broker install");
  const r = launchctl("kickstart", "-k", `${domain()}/${LABEL}`);
  if (r.status !== 0) load();
  return { running: !!(await waitUp(5000)) };
}

export async function uninstall() {
  needMac();
  launchctl("bootout", `${domain()}/${LABEL}`);
  try { fs.unlinkSync(plistPath()); } catch { /* not there */ }
  try { fs.unlinkSync(socketPath()); } catch { /* not there */ }
  return { removed: true };
}
