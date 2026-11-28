// What Switch account needs that a mod can't read itself (main.js runs this with Node):
//
//   node accounts.js look <cli.js> [--t <address>]...
//     { list, on: { <address>: "<agent> <id>" } }: the accounts (herdr-ws-account's
//     `list --cached`, by its cli.js, no agent CLI runs) and which one each terminal's agent
//     was started on (the launcher's ~/.herdr/accounts/on/<core>/<terminal>).
//   node accounts.js restart <address> <kind> [<pid>]
//     { cmd, session, file }: the launcher's restart note for the terminal
//     (~/.herdr/resume/<core>/<terminal>.cmd), and for Codex the conversation its running
//     process has open (a rollout file under sessions/, by lsof on it and its children).
//
// <core> is the core's socket name, as stats.js has it (HC_SESSION, else "default").

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { rolloutIn, rolloutId, onWords } from "./acctfacts.js";

const HOME = process.env.HOME || "";
const CORE = process.env.HC_SESSION || "default";
const ON = path.join(HOME, ".herdr", "accounts", "on", CORE);
const NOTES = path.join(process.env.HERDR_WS_RESUME_DIR || path.join(HOME, ".herdr", "resume"), CORE);
const ADDR = /^[A-Za-z0-9._-]+$/;
const read = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
const run = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }); } catch (e) { return e?.stdout ? String(e.stdout) : ""; }
};

const [mode, ...args] = process.argv.slice(2);
if (mode === "look") {
  const cli = args[0];
  let list = null;
  if (cli && cli.endsWith("/cli.js")) {
    try { list = JSON.parse(execFileSync(process.execPath, [cli, "list", "--cached"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 })); } catch { list = null; }
  }
  const on = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] !== "--t" || !ADDR.test(args[i + 1] ?? "")) continue;
    const text = read(path.join(ON, args[++i]));
    if (text != null) on[args[i]] = text.trim();
  }
  process.stdout.write(JSON.stringify({ list, on }));
} else if (mode === "restart") {
  const [address, kind, pid] = args;
  if (!ADDR.test(address ?? "")) { process.stderr.write("accounts.js: no terminal\n"); process.exit(2); }
  // The restart note, else (Codex: the launcher writes none) the account note's second line.
  const cmd = read(path.join(NOTES, `${address}.cmd`))?.trim() || onWords(read(path.join(ON, address))) || null;
  let file = null;
  if (kind === "codex" && /^\d+$/.test(pid ?? "")) {
    // The process and its children (the codex command can be a launcher of the real one), a few levels.
    let pids = [pid];
    for (let depth = 0; depth < 3 && !file; depth++) {
      for (const p of pids) {
        file = rolloutIn(run("lsof", ["-n", "-P", "-Fn", "-p", p]));
        if (file) break;
      }
      pids = pids.flatMap((p) => run("pgrep", ["-P", p]).split("\n").filter((x) => /^\d+$/.test(x)));
      if (!pids.length) break;
    }
  }
  process.stdout.write(JSON.stringify({ cmd, session: file ? rolloutId(file) : null, file }));
} else {
  process.stderr.write("usage: node accounts.js look <cli.js> [--t <address>]... | restart <address> <kind> [<pid>]\n");
  process.exit(2);
}
