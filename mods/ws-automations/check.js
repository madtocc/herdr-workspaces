// An automation's check: a shell command that says whether there's anything to
// do, so no agent starts for nothing. No imports: the caller passes `exec`.
// Copied in ws-switcher (the runner) and ws-automations (Try it): keep them the same.
//
//   check: gh pr list --search "review-requested:@me" --json number,title -q '.[]'
//
// It runs with `sh -c` in the automation's folder, as you. What it prints
// (stdout) decides:
//   something  the run starts, and the agent gets it as {{check}}
//   nothing    no run
// (On a schedule the runner also wants it to differ from the last check's.)
// It failed when it printed nothing and ended with an error (a failing exit code
// and something on stderr), couldn't start, or took over CHECK_TIMEOUT. A failing
// exit alone isn't one: `grep` ends that way when it finds nothing, and `diff`
// when it finds something.

export const CHECK_TIMEOUT = 60e3;
const MAX_OUT = 4000; // characters of its output passed on
const MAX_VAR = 8000; // … and of each variable it's given

// The run's fill-ins as variables: {{number}} is $HERDR_NUMBER, {{task.id}} is
// $HERDR_TASK_ID. They're never put into the command itself: a pull request's
// title is someone else's text.
export function checkEnv(vars) {
  const out = [];
  for (const [k, v] of Object.entries(vars ?? {})) {
    const name = `HERDR_${k.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
    if (v === null || v === undefined || !/^HERDR_[A-Z0-9_]+$/.test(name)) continue;
    out.push(`${name}=${String(v).replace(/\u0000/g, "").slice(0, MAX_VAR)}`);
  }
  return out;
}

// --- secrets (secret_env:): the command runs under herdr-ws-secret, which holds the values ---
//
// secret: { cli, pairs: [{ env, name }], workspace, automation: "<ws>/<name>" } or null. The runner
// never holds a value: it only builds a command that starts with the CLI, which looks the names up,
// hands the values to the command as variables and redacts them from what comes back. The CLI gets the
// run's time limit and exec a few seconds more, so the CLI stops the script itself and hands back
// what it printed.
export const SECRET_GRACE = 5e3;

// The CLI's words in front of the command: herdr-ws-secret run --automation … --env VAR=name … --.
// Only ever a check or a script: an agent's own process is never handed secrets.
export function secretArgv(secret, { timeoutMs = 0 } = {}) {
  if (!secret?.cli || !secret.pairs?.length) return [];
  return [
    secret.cli, "run",
    ...(secret.automation ? ["--automation", secret.automation] : []),
    ...(secret.workspace ? ["--workspace", secret.workspace] : []),
    ...(timeoutMs > 0 ? ["--timeout", String(Math.max(1, Math.ceil(timeoutMs / 1000)))] : []),
    ...secret.pairs.flatMap((p) => ["--env", `${p.env}=${p.name}`]),
    "--",
  ];
}

// How long the CLI may let the command go, and how long exec waits for the CLI: never past `cap`
// (Herdr's exec stops any call at 10 minutes).
function secretLimits(limit, cap) {
  const inner = Math.max(1000, Math.min(limit, cap - SECRET_GRACE));
  return { inner, outer: inner + SECRET_GRACE };
}

// The CLI refused before the command started: exit 125 and one line "herdr-ws-secret: <kind>: <message>"
// on stderr. { kind, message } or null (the command's own exit 125 has no such line).
const TOOL_LINE = /^herdr-ws-secret: (not_found|expired|refused|denied|broker_down|failed): (.*)$/;
const TOOL_TIMEOUT = /^herdr-ws-secret: timed out after [^\n]*\n?/m;
export function toolFailure(code, stderr) {
  if (code !== 125) return null;
  for (const line of String(stderr ?? "").split("\n")) {
    const m = TOOL_LINE.exec(line.trim());
    if (m) return { kind: m[1], message: m[2].trim() };
  }
  return null;
}

// That refusal in the words a person sees, as the run's problem. names: the secrets it asked for (the
// one the message names, else the first, is the one it's about); automation: "<ws>/<name>".
export function secretProblem(fail, { names = [], automation = "" } = {}) {
  const msg = String(fail?.message ?? "").trim();
  const name = names.find((n) => msg.includes(n)) ?? names[0] ?? "its secret";
  switch (fail?.kind) {
    case "expired": return `${name} has expired: replace it in Secrets`;
    case "denied": return `macOS asked whether ${automation || "this automation"} may use ${name} and nobody allowed it: run it once while you're at the computer`;
    case "broker_down": return "The Protected broker isn't running: Settings > Secrets";
    case "not_found": return `There's no secret ${name} in Secrets for this workspace: add it there, or fix secret_env`;
    case "refused": return `Secrets refused ${name}${msg ? `: ${msg}` : ""}`;
    default: return `herdr-ws-secret couldn't start it${msg ? `: ${msg}` : ""}`;
  }
}

// Resolves { out } (what it printed, "" for nothing) or { error } (why it failed). secret: as above
// (its `{{check}}` comes back redacted); a refusal of the CLI's is { error, vault: kind }.
export async function runCheck(exec, command, folder, vars, secret = null) {
  let r;
  const wrap = secret?.pairs?.length ? secretLimits(CHECK_TIMEOUT, CHECK_TIMEOUT + SECRET_GRACE) : null;
  try { r = await exec("env", [...checkEnv(vars), ...(wrap ? secretArgv(secret, { timeoutMs: wrap.inner }) : []), "sh", "-c", command], { cwd: folder, timeout: wrap ? wrap.outer : CHECK_TIMEOUT }); }
  catch (e) {
    const why = String(e?.message ?? e);
    return { error: /tim(ed|e) ?out/i.test(why) ? `It took over ${CHECK_TIMEOUT / 1000} seconds.` : why };
  }
  const fail = wrap ? toolFailure(r.code, r.stderr) : null;
  if (fail) return { error: `${secretProblem(fail, { names: secret.pairs.map((p) => p.name), automation: secret.automation })}.`, vault: fail.kind };
  const out = String(r.stdout ?? "").trim();
  if (out) return { out: out.length > MAX_OUT ? `${out.slice(0, MAX_OUT)}\n… (cut here: the check printed more)` : out };
  const err = String(r.stderr ?? "").trim();
  if (r.code !== 0 && err) return { error: `${err.split("\n")[0].slice(0, 200)} (exit ${r.code})` };
  return { out: "" };
}

// --- a shell automation's script (run: shell): the whole job, no agent after it ---

const SHELL_BIN = { bash: "bash", zsh: "zsh", sh: "sh" };
export const LOG_MAX = 256 * 1024; // characters of a run's output its log file keeps
export const SCRIPT_MAX = 600e3;   // a script without a tab runs 10 minutes at most: Herdr's exec stops any call then
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

// The first line with text, without terminal colours, at most 140 characters.
export function firstLine(text) {
  const line = String(text ?? "").replace(ANSI, "").replace(/\r/g, "\n").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

// Runs the script with that shell ("bash", "zsh" or "sh"; anything else is sh) in the folder, the
// run's fill-ins as $HERDR_… variables (never put into the script itself), for at most timeoutMs
// and never over SCRIPT_MAX (0: SCRIPT_MAX), the longest a call can take. Resolves, never rejects:
//   { code, stdout, stderr, timedOut, durationMs, combined, summary, outcome }
// combined: stdout, then stderr after a "--- stderr ---" line, at most LOG_MAX (the log file's);
// outcome: "failed" (a failing exit or the time ran out), "nothing to do" (it printed nothing) or
// "done"; summary: its first line with text (stderr's when it failed), or what stopped it.
//
// secret (secret_env:): it runs under herdr-ws-secret (secretArgv), given the limit, with exec a few
// seconds more; what it printed comes back redacted. The CLI refusing before the script starts (exit
// 125 and its line) is a failed run whose summary says why in plain words, with `vault`: the kind.
export async function runShellScript(exec, { shell = "bash", script = "", folder, vars = {}, timeoutMs = 0, secret = null } = {}) {
  const bin = SHELL_BIN[shell] ?? "sh";
  let limit = timeoutMs > 0 ? Math.min(timeoutMs, SCRIPT_MAX) : SCRIPT_MAX;
  const wrap = secret?.pairs?.length ? secretLimits(limit, SCRIPT_MAX) : null;
  if (wrap) limit = wrap.inner;
  const started = Date.now();
  let r, timedOut = false;
  try { r = await exec("env", [...checkEnv(vars), ...(wrap ? secretArgv(secret, { timeoutMs: wrap.inner }) : []), bin, "-c", String(script)], { cwd: folder, timeout: wrap ? wrap.outer : limit }); }
  catch (e) {
    // What it printed before it was stopped is kept (the background runner's exec says it; Herdr's may not).
    const why = String(e?.message ?? e);
    timedOut = e?.timedOut === true || (!e?.tooMuch && /tim(ed|e) ?out|took longer/i.test(why));
    const printed = String(e?.stderr ?? "");
    r = { code: timedOut ? null : e?.tooMuch ? null : 127, stdout: String(e?.stdout ?? ""), stderr: timedOut ? printed : [printed.replace(/\n+$/, ""), why].filter(Boolean).join("\n") };
  }
  const durationMs = Date.now() - started;
  const fail = wrap ? toolFailure(r.code, r.stderr) : null;
  if (fail) {
    const summary = secretProblem(fail, { names: secret.pairs.map((p) => p.name), automation: secret.automation });
    return { code: null, stdout: "", stderr: String(r.stderr ?? ""), timedOut: false, durationMs, combined: String(r.stderr ?? ""), summary, outcome: "failed", vault: fail.kind };
  }
  // Under the CLI, a script it stopped at the limit ends with 124 and its "timed out" line (or, at the
  // limit, any failing code): timed out, its line left out of what it printed.
  const cliTimeout = wrap && r.code === 124 && TOOL_TIMEOUT.test(String(r.stderr ?? ""));
  if (wrap && !timedOut && (cliTimeout || (r.code !== 0 && durationMs >= wrap.inner - 250))) {
    timedOut = true;
    r = { ...r, code: null, stderr: String(r.stderr ?? "").replace(TOOL_TIMEOUT, "") };
  }
  const stdout = String(r.stdout ?? ""), stderr = String(r.stderr ?? "");
  const took = limit % 60e3 === 0 ? `${limit / 60e3} min` : `${Math.round(limit / 1e3)} s`;
  let combined = stdout.trim() && stderr.trim() ? `${stdout.replace(/\n+$/, "")}\n--- stderr ---\n${stderr}` : stdout.trim() ? stdout : stderr;
  if (combined.length > LOG_MAX) combined = `${combined.slice(0, LOG_MAX)}\n… (cut here: it printed more)`;
  // Stopped with something printed: the log says where it stopped.
  if (timedOut && combined.trim()) combined = `${combined.replace(/\n+$/, "")}\n--- timed out after ${took} ---\n`;
  const code = typeof r.code === "number" ? r.code : null;
  const outcome = timedOut || code !== 0 ? "failed" : combined.trim() ? "done" : "nothing to do";
  const summary = timedOut ? `Timed out after ${took}`
    : outcome === "failed" ? firstLine(stderr) || firstLine(stdout) || `It ended with exit ${code ?? "?"}`
    : firstLine(stdout) || firstLine(stderr);
  return { code, stdout, stderr, timedOut, durationMs, combined, summary, outcome };
}
