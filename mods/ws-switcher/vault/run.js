// herdr-ws-secret run: a command with secrets in its environment (--env VAR=name) or in a 0600
// temp file named by a variable (--file VAR=name), its output redacted on the way out. Standard
// secrets: the command runs here, in its own process group, output streamed through the
// redactor. A Protected one: the broker runs it (the command it pinned) and sends the output
// back when it ends. Fails before the command starts: exit 125 and one line,
// "herdr-ws-secret: <kind>: <message>". After: the command's own exit code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fail, remember } from "./base.js";
import { caller } from "./caller.js";
import { lookup, standardValues, noteUse, noteAttempt } from "./use.js";
import { request as brokerRequest } from "./broker.js";
import { findPlaceholders, commandAllowed, makeRedactor, redact, envNameProblem, validName } from "../vaultfacts.js";

export const RUN_FAILED = 125;

function pairArg(text, flag) {
  const i = text.indexOf("=");
  const env = i < 0 ? "" : text.slice(0, i);
  const name = i < 0 ? "" : text.slice(i + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env) || !validName(name)) throw fail("usage", `${flag} takes VAR=secret-name, not "${env || text}…"`);
  const why = envNameProblem(env);
  if (why) throw fail("refused", why);
  return { env, name };
}

export function parseRunArgs(argv) {
  const o = { env: [], files: [], timeout: null, automation: null, workspace: null, global: false, command: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw fail("usage", `${a} needs a value`);
      return argv[++i];
    };
    if (a === "--") { o.command = argv.slice(i + 1); break; }
    if (a === "--env") o.env.push(pairArg(val(), a));
    else if (a === "--file") o.files.push(pairArg(val(), a));
    else if (a === "--timeout") o.timeout = Number(val());
    else if (a === "--automation") o.automation = val();
    else if (a === "--workspace") o.workspace = val();
    else if (a === "--global") o.global = true;
    else if (a.startsWith("-")) throw fail("usage", `run doesn't know ${a} (herdr-ws-secret --help)`);
    else { o.command = argv.slice(i); break; }
  }
  if (!o.command.length) throw fail("usage", "run needs a command: herdr-ws-secret run --env VAR=name -- <command…>");
  if (o.timeout !== null && !(o.timeout > 0 && o.timeout <= 600)) throw fail("usage", "--timeout is 1 to 600 seconds");
  if (o.automation !== null && !/^[^/\s]+\/[^/\s]+$/.test(o.automation)) throw fail("usage", "--automation takes <workspace>/<name>");
  const seen = new Set();
  for (const p of o.env.concat(o.files)) {
    if (seen.has(p.env)) throw fail("usage", `${p.env} is given twice`);
    seen.add(p.env);
  }
  return o;
}

// The caller's environment for the child, without DYLD_* (as the broker does).
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("DYLD_")) env[k] = v;
  return env;
}

// A fresh 0700 folder for --file values, and how to remove it whatever happens.
function tempFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-ws-secret-"));
  fs.chmodSync(dir, 0o700);
  const remove = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  process.on("exit", remove);
  return { dir, remove };
}

function writeSecretFile(dir, env, value) {
  const file = path.join(dir, env.toLowerCase());
  fs.writeFileSync(file, value, { mode: 0o600, flag: "wx" });
  return file;
}

function readStdinIfPiped() {
  try {
    const st = fs.fstatSync(0);
    if (!st.isFIFO() && !st.isFile()) return null;
    return fs.readFileSync(0);
  } catch {
    return null;
  }
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];

function write(stream, buf) {
  return new Promise((r) => (buf.length ? stream.write(buf, r) : r()));
}

const bytes = (s) => Buffer.from(s, "latin1");

// Whether stdin is a pipe (a FIFO, or a socket as Node's and many tools' pipes are) or a file:
// handed on to the child as it is. A terminal or a device isn't.
function stdinPiped() {
  try {
    const st = fs.fstatSync(0);
    return st.isFIFO() || st.isFile() || st.isSocket();
  } catch {
    return false;
  }
}

// Runs the command here. Resolves to the exit code. A run for an automation, and any run whose
// stdin isn't a terminal, has no controlling terminal: the child gets a session of its own
// (so it can't open /dev/tty and write around the redactor) and /dev/null for stdin unless
// stdin was piped. A person at a terminal running a command by hand keeps the terminal for
// input (the child shares this process group, so a timeout stops just the child).
function runLocal(o, env, secrets, tidy) {
  return new Promise((resolve) => {
    const ownSession = !!o.automation || !process.stdin.isTTY;
    const input = ownSession ? (stdinPiped() ? "inherit" : "ignore") : "inherit";
    let child;
    try {
      child = spawn(o.command[0], o.command.slice(1), {
        env, stdio: [input, "pipe", "pipe"], detached: ownSession,
      });
    } catch (err) {
      tidy();
      process.stderr.write(`herdr-ws-secret: failed: couldn't start ${o.command[0]}\n`);
      return resolve(RUN_FAILED);
    }
    let started = false;
    let timedOut = false;
    let killTimer = null;
    const kill = (sig) => {
      try {
        if (ownSession) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch { /* already gone */ }
    };
    const onSignal = (sig) => kill(sig);
    for (const s of SIGNALS) process.on(s, onSignal);
    const ms = o.timeout !== null ? o.timeout * 1000 : 120000;
    const timer = ms ? setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 5000);
    }, ms) : null;

    const pipes = [];
    {
      for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        const r = makeRedactor(secrets, { bytes: true });
        let chain = Promise.resolve();
        from.on("data", (d) => {
          const out = r.push(d.toString("latin1"));
          chain = chain.then(() => write(to, bytes(out)));
        });
        pipes.push(new Promise((done) => from.on("close", () => { chain = chain.then(() => write(to, bytes(r.end()))); chain.then(done); })));
      }
    }
    child.on("spawn", () => { started = true; });
    child.on("error", () => {
      if (started) return;
      if (timer) clearTimeout(timer);
      for (const s of SIGNALS) process.off(s, onSignal);
      tidy();
      process.stderr.write(`herdr-ws-secret: failed: couldn't start ${o.command[0]} (not found, or not executable)\n`);
      resolve(RUN_FAILED);
    });
    child.on("close", async (code, signal) => {
      if (!started) return;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      // A group's other processes, if the command left any behind.
      if (ownSession) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* none */ } }
      await Promise.all(pipes);
      for (const s of SIGNALS) process.off(s, onSignal);
      tidy();
      if (timedOut) {
        process.stderr.write(`herdr-ws-secret: timed out after ${ms / 1000}s\n`);
        return resolve(124);
      }
      resolve(signal ? 128 + (os.constants.signals[signal] || 1) : code ?? 1);
    });
  });
}

export async function runCommand(argv) {
  let o;
  let tidy = () => {};
  try {
    o = parseRunArgs(argv);
    if (o.command.some((w) => findPlaceholders(w).length)) {
      throw fail("refused", "a secret can't stand in the command's own words: give it with --env VAR=name or --file VAR=name");
    }
    const who = caller({ workspace: o.workspace, global: o.global });
    const pairs = o.env.map((p) => ({ ...p, file: false })).concat(o.files.map((p) => ({ ...p, file: true })));
    const names = [...new Set(pairs.map((p) => p.name))];
    const target = o.automation ? `automation ${o.automation}` : path.basename(o.command[0]);
    const use = { via: "run", target, who };
    const found = lookup(names, who, use);
    const byName = Object.fromEntries(found.map((f) => [f.name, f.entry]));
    const prot = found.filter((f) => f.entry.tier === "protected");
    for (const f of found) {
      if (f.entry.tier !== "standard") continue;
      const ok = commandAllowed(f.entry, o.command[0]);
      if (!ok.ok) {
        noteAttempt(found, { ...use, why: "refused" });
        throw fail("refused", ok.why);
      }
    }
    const values = standardValues(found);
    for (const [n, v] of Object.entries(values)) remember(n, v);
    const secrets = Object.entries(values).map(([name, value]) => ({ name, value: Buffer.from(value, "utf8").toString("latin1") }));
    const env = childEnv();
    const fileNeeded = pairs.some((p) => p.file && byName[p.name].tier === "standard");
    const temp = fileNeeded ? tempFolder() : null;
    tidy = temp ? temp.remove : () => {};
    for (const p of pairs) {
      if (byName[p.name].tier !== "standard") continue;
      env[p.env] = p.file ? writeSecretFile(temp.dir, p.env, values[p.name]) : values[p.name];
    }

    if (!prot.length) {
      const code = await runLocal(o, env, secrets, tidy);
      if (code !== RUN_FAILED) await noteUse(found, { via: "run", target, who });
      else noteAttempt(found, { ...use, why: "failed" });
      return code;
    }

    // Through the broker: it runs the command it pinned, with the Protected secrets.
    const onSignal = (sig) => { tidy(); process.exit(128 + (os.constants.signals[sig] || 1)); };
    for (const s of SIGNALS) process.on(s, onSignal);
    const stdin = readStdinIfPiped();
    let ans;
    try {
      ans = await brokerRequest("run", {
        caller: who,
        argv: o.command, cwd: process.cwd(), env,
        secretEnv: pairs.filter((p) => !p.file && byName[p.name].tier === "protected").map(({ env: e, name }) => ({ env: e, name })),
        secretFiles: pairs.filter((p) => p.file && byName[p.name].tier === "protected").map(({ env: e, name }) => ({ env: e, name })),
        timeoutMs: (o.timeout ?? 120) * 1000,
        stdinB64: stdin && stdin.length ? stdin.toString("base64") : null,
        ...(o.automation ? { automation: { id: o.automation } } : {}),
      });
    } finally {
      for (const s of SIGNALS) process.off(s, onSignal);
      tidy();
    }
    const out = redact(Buffer.from(ans.stdoutB64 || "", "base64").toString("latin1"), secrets, { bytes: true }).text;
    const err = redact(Buffer.from(ans.stderrB64 || "", "base64").toString("latin1"), secrets, { bytes: true }).text;
    await write(process.stdout, bytes(out));
    await write(process.stderr, bytes(err));
    if (ans.truncated) process.stderr.write("herdr-ws-secret: the output was cut at 8 MB\n");
    await noteUse(found, { via: "run", target, who });
    if (ans.timedOut) {
      process.stderr.write(`herdr-ws-secret: timed out after ${o.timeout ?? 120}s\n`);
      return 124;
    }
    if (ans.signal) return 128 + (typeof ans.signal === "number" ? ans.signal : os.constants.signals[ans.signal] || 1);
    return typeof ans.code === "number" ? ans.code : 1;
  } catch (err) {
    tidy();
    if (!err.kind) throw err;
    const kind = ["not_found", "expired", "refused", "denied", "broker_down"].includes(err.kind) ? err.kind : "failed";
    process.stderr.write(`herdr-ws-secret: ${kind}: ${err.message}\n`);
    return RUN_FAILED;
  }
}
