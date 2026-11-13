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

// Resolves { out } (what it printed, "" for nothing) or { error } (why it failed).
export async function runCheck(exec, command, folder, vars) {
  let r;
  try { r = await exec("env", [...checkEnv(vars), "sh", "-c", command], { cwd: folder, timeout: CHECK_TIMEOUT }); }
  catch (e) {
    const why = String(e?.message ?? e);
    return { error: /tim(ed|e) ?out/i.test(why) ? `It took over ${CHECK_TIMEOUT / 1000} seconds.` : why };
  }
  const out = String(r.stdout ?? "").trim();
  if (out) return { out: out.length > MAX_OUT ? `${out.slice(0, MAX_OUT)}\n… (cut here: the check printed more)` : out };
  const err = String(r.stderr ?? "").trim();
  if (r.code !== 0 && err) return { error: `${err.split("\n")[0].slice(0, 200)} (exit ${r.code})` };
  return { out: "" };
}
