// Describe it: the drafter. You say what you want in words, and an agent's CLI drafts every field
// of the automation, with no tools, no saved session and a fixed answer shape. No imports, so `node`
// can test it: the screen (main.js) runs what buildDraftCommand gives with Herdr's exec and reads
// the answer with parseDraftOutput.
//
// Which CLI drafts: Settings > Automations' Drafter (settingsfacts.js `drafter`). "auto" tries the
// installed ones in DRAFTER_ORDER until one answers; a named one is the only one tried.
//
//   claude  claude -p <text> --model sonnet --system-prompt <GUIDE> … --output-format json --json-schema <SCHEMA>
//   codex   codex exec --ephemeral --skip-git-repo-check --sandbox read-only --output-schema <file> <GUIDE + text>
//   agy     agy -p <GUIDE + text> --output-format json --json-schema <SCHEMA> … --log-file /dev/null,
//           inside NO_BROWSER: signed out, agy opens a sign-in tab in the browser on every call
//   pi      pi -p --no-session --no-tools … --system-prompt <GUIDE> <text>: plain text, JSON in it

export const DRAFTER_ORDER = ["claude", "codex", "agy", "pi"];
export const DRAFTER_NAMES = { claude: "Claude", codex: "Codex", agy: "Antigravity", pi: "Pi" };
export const DRAFT_MODEL = "sonnet"; // claude's
export const DRAFT_TIMEOUT = 120e3;

// Runs "$1" with the rest as its arguments, with a do-nothing `open`/`xdg-open` first on PATH and as
// $BROWSER, so a CLI that's signed out can't open a sign-in tab (the same as ws-status's).
export const NO_BROWSER = `d=$(mktemp -d) || exit 126
printf '#!/bin/sh\\nexit 1\\n' > "$d/open" && chmod +x "$d/open" && cp "$d/open" "$d/xdg-open"
b=$1; shift
PATH="$d:$PATH" BROWSER="$d/open" "$b" "$@" </dev/null
rc=$?; rm -rf "$d"; exit $rc`;

// What the drafter answers with: every field, as strings (card, keep and terminal booleans).
// Every key is required, as codex's --output-schema wants.
export const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["scope", "name", "description", "when", "run", "shell", "terminal", "agent", "model", "effort", "folder", "check", "dedupe", "timeout", "notify", "missed", "card", "keep", "prompt", "note"],
  properties: {
    scope: { type: "string", enum: ["workspace", "global"] }, name: { type: "string" }, description: { type: "string" }, when: { type: "string" },
    run: { type: "string", enum: ["agent", "shell"] }, shell: { type: "string", enum: ["bash", "zsh", "sh"] }, terminal: { type: "boolean" },
    agent: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, folder: { type: "string" },
    check: { type: "string" }, dedupe: { type: "string", enum: ["", "changed", "always"] },
    timeout: { type: "string" }, notify: { type: "string", enum: ["", "problems", "results", "all", "none"] }, missed: { type: "string", enum: ["", "run", "skip", "always"] },
    card: { type: "boolean" }, keep: { type: "boolean" }, prompt: { type: "string" }, note: { type: "string" },
  },
};

export const GUIDE = `You set up automations for Herdr, a desktop app for terminals and coding agents. An automation runs by itself: either it starts a coding agent with a prompt, as a new tab in the workspace's "Automations" space, or it runs a shell script with no agent at all. The person says what they want in their own words; you answer with the automation's fields. Nothing is saved until they have read your draft and clicked Create or Save.

Fields:
- scope: "workspace" (this workspace only) or "global" (every workspace). Keep the scope you're given unless the person says otherwise: "global" when they say it's for all or every workspace, each project, or everywhere; "workspace" when they say only here. A global one runs in each workspace separately, as that workspace's own, so nothing in it may belong to this workspace alone: its prompt, script and check name no path or repo from the lists below and use {{folder}}, {{workspace}} (in a script, $HERDR_FOLDER and $HERDR_WORKSPACE) and commands that work from the folder they run in; folder is ""; agent is "" or a preset marked global; a github trigger names the repo "*" (github * pr opened).
- name: a short file name in lowercase words joined by dashes, saying what it does (board-sync, morning-review). Not one of the names taken.
- description: one line, under 80 characters: what it does.
- run: "agent" or "shell". Pick "shell" whenever a plain shell script can do the whole job with no judgment: fetching or pulling repos, pruning merged branches, running tests or a build, a backup, syncing or copying files, cleaning a folder. Pick "agent" when the job needs reading, deciding, writing or reviewing. With "shell", prompt holds the script, and note says you drafted a shell script to read (see note below for Try it).
- shell: "bash" (the default), "zsh" or "sh": the shell a "shell" run's script runs with. "bash" for an agent run.
- terminal: false (the default): a script runs unseen, and History keeps what it printed. true only when the person wants to watch it in a tab, or it runs longer than 10 minutes. false for an agent run.
- when: what sets it off, in exactly one of these forms:
  - every 30m, every 2h, every 1d: an interval of at least a minute, counted from its last run
  - 09:00, daily 9:00, weekdays 09:00,17:30, weekends 10am, mon,wed 8:30, mon-fri 9:00: days and times on this computer's clock
  - 0 9 * * 1-5: cron's five fields (minute hour day month weekday), with lists, ranges and steps
  - once 2026-11-12 06:00: one time, then it turns itself off
  - task enters <column>: a task on the workspace's board moves into that column
  - agent done, agent blocked: an agent in the workspace finishes, or needs the person; a tab name after it listens to that tab only
  - files <folder>: something changes under that folder (from the root)
  - github <folder or owner/name> pr opened, github <folder or owner/name> issue opened, optionally followed by "by others" (leaves out the person's own) and label:<name>: a new pull request or issue on GitHub
  - github <folder or owner/name> pr review-requested: someone asks the person to review a pull request
  - github <folder or owner/name> pr merged: a pull request is merged ("by others" works here too)
  - github <folder or owner/name> ci failed: a GitHub Actions run fails on the default branch
  - github <folder or owner/name> pr labeled:<name>, github <folder or owner/name> issue labeled:<name>: a label is put on an open pull request or issue, even long after it was opened
  GitHub never tells about edits, comments, moves or closes other than these; for those, use a schedule whose prompt or check asks GitHub. "github * …" watches every folder of the workspace that has a GitHub remote.
  - startup: once each time Herdr or its background runner starts
  - wake: each time the computer wakes from sleep
  - automation done <name>, automation failed <name>: another automation here (one of the names taken) finishes with its work done, or fails or times out. One that ends saying it had nothing to do (or whose end isn't known) starts neither. What it said comes as {{output}} ($HERDR_OUTPUT), its name as {{upstream}}, done or failed as {{outcome}}.
  - link: only when started by hand (Run now) or from a script
  Prefer the plain forms. Use cron only when they can't say it: every 30 minutes on weekdays from 9:00 to 18:30 is */30 9-18 * * 1-5.
- agent: "" for the board's agent, else exactly one of the presets or installed agents listed. A preset that fits the job wins (a reviewer for reviews). "" for a shell run.
- model and effort: the smallest that does the job well. For claude: haiku for checks, syncs, summaries and reports that read things and update a file or two; sonnet for ordinary code changes and reviews; opus for hard, long or many-step work; fable only when the person asks for the strongest. Effort "" (the default) unless the job is trivial (low) or hard (high). If the agent is a preset that already sets a model that suits the job, leave model "" to keep it. For any other agent, leave model "" unless the person names one, and then write it as that agent's list below has it. If the person names a model or an effort, use it. Each agent's models and effort levels are listed with the request, by the program it runs (a preset runs the program of its command); one that takes no effort gets effort "", and an agent not listed there takes neither: leave both "". Both "" for a shell run.
- folder: where it runs. "" for the workspace root (for a github trigger, its repo's folder). Else one of the folders listed, written as listed. Pick the folder the commands need (a git repo for git and gh).
- check: "" for none, which is right for most automations. Otherwise shell that Herdr itself runs first, in the folder, each time the automation is set off: the run happens only if it prints something, and an agent gets what it printed as {{check}} (a script as $HERDR_CHECK). It may span several lines when one line can't say it clearly. On a schedule it must also differ from what the last check printed (dedupe "changed"), so a check can simply list what is open or waiting now and the run happens when that list changes; for a reminder that should repeat while nothing changed, use dedupe "always" (never print the date to get around it). Give one when a plain command can tell whether there is anything to do, so nothing runs for nothing: a schedule that looks for new commits, open pull requests, failed runs or files waiting in a folder. It prints what there is to act on, one item per line, and nothing when there is none. It only reads (git log, git status, gh ... list, ls, find, grep, jq, test): never a command that changes, sends, posts or deletes anything. Leave it "" when deciding takes judgment (that's the agent's job), when you'd have to guess a command or flag you aren't sure of, and for link. {{…}} isn't filled in inside a check or a script: what set it off is in variables named after the fill-ins ($HERDR_NUMBER, $HERDR_TITLE, $HERDR_TASK_ID, $HERDR_FILES, $HERDR_DATE, $HERDR_FOLDER, $HERDR_OUTPUT). When you give one, write the prompt so it works from {{check}}, and say in note that they should read the check and press Try it.
- dedupe: "" (the default, "changed") or "always": with a check on a schedule, "always" runs whenever the check prints something, even the same as last time.
- timeout: "" for the default (2 minutes for a shell run, no limit for an agent), or a length like "30s", "5m", "20m", "1h", or "none". Give one when a run could hang or should never run long (an agent's quick report: "20m"; a long build script: "20m"). A script without terminal stops at 10 minutes whatever this says.
- notify: "" for the default (a shell run tells only about problems; an agent run tells its results, failures and when it needs the person), or "problems", "results", "all" (also when it starts) or "none". "results" for a script whose output the person wants to read each time.
- missed: "" for the default (a schedule missed while the computer was off or asleep runs once when it can, within 12 hours), "skip" (never run late: a reminder for that exact time) or "always" (catch up once however late: a weekly backup). "" for anything but a schedule.
- card: true only when the person wants each run as a card on the board. false for a shell run.
- keep: whether a run's tab stays open after it finishes. false (the default): an agent's tab closes a few seconds after it's done, and the run stays listed under History. Choose true when the automation asks the person questions or is a conversation with them (a triage, an interview, a daily check-in they answer in its tab): an agent that ends its turn with a question looks finished, and its tab would close. Also true when the person says to keep the runs open. For a shell run, true keeps its tab open (with terminal true).
- prompt: for an agent run, the agent's whole task. It starts fresh and knows nothing of this conversation, so say what to look at (full paths, repos), what to do, what to leave alone, and how to finish (one line saying what it did or found). Keep it short and concrete, with numbered steps when there are several. It only reads and reports unless the person asks it to change something, and it never pushes, posts, comments, merges, deletes or messages anyone unless the person asked for exactly that. A scheduled check that finds nothing new changes nothing and says so. It can use these fill-ins: {{date}} {{time}} {{workspace}} {{folder}} {{event}} (what set it off); for board triggers {{task}} {{task.id}} {{task.title}} {{task.file}}; agent triggers {{agent}} {{terminal}} {{space}}; files triggers {{files}} {{file}}; github triggers {{pr}} or {{issue}} (number, title, author, link, labels and description) {{number}} {{title}} {{url}} {{author}} {{repo}} {{labels}}, and {{workflow}} for ci failed; automation done or failed {{output}} {{upstream}} {{outcome}}; link {{text}}; with a check {{check}} (what it printed). For anything but a schedule, what set it off is added at the end by itself unless the prompt uses one of these.
  For a shell run, prompt is the script itself: plain shell for the shell chosen, starting with "set -euo pipefail" for bash or zsh when a failing step should stop it, using the $HERDR_… variables for what set it off (never {{…}}, which isn't filled in in a script), and quoting every variable ("$HERDR_FOLDER"). It runs in the folder. It prints a short line of what it did; it exits with a failing code when something went wrong. It changes only what the person asked for.
- note: one or two short, plain sentences for the person about what you assumed or couldn't know and they should check before saving (a path you guessed, a field the agent has to find; for a shell run, that it's a script to read). Try it runs a script for real, here and now: for a script that only reads or reports, say "read it and press Try it"; for one that changes files, deletes branches, pushes, posts or deploys, say "Read the script before allowing or running it" instead, never to press Try it. Don't repeat the fields: they're shown already. "" when there's nothing to check.

You can't look anything up. Use only the folders, repos, presets, agents and automations listed. Where the task needs something you don't know (a project number, a list of issues), have the agent find it, and say so in note.

When you're given the current automation, change only what the person asks and copy every other field exactly as it is, the prompt included.

Answer with the fields as one JSON object and nothing else.`;

// The CLIs that draft, in the order they're tried: the one Settings names (if it's one of them),
// else ("auto", or anything else) the installed ones in DRAFTER_ORDER. Nothing known to be
// installed: claude, as before there was a choice.
export function pickDrafters(setting, installedKeys) {
  const s = String(setting ?? "").trim().toLowerCase();
  if (DRAFTER_ORDER.includes(s)) return [s];
  const have = new Set((installedKeys ?? []).map((k) => String(k).toLowerCase()));
  const list = DRAFTER_ORDER.filter((k) => have.has(k));
  return list.length ? list : ["claude"];
}

// The text for a CLI that takes no system prompt of its own: the guide, then the request.
const combined = (guide, prompt) => `${guide}\n\n---\n\n${prompt}`;

// What to run: { cli, bin, args }, for exec(bin, args). bin: the CLI's program (a path to it
// when you know one), else its name. schemaPath: a file holding SCHEMA, for codex.
export function buildDraftCommand(cli, { prompt, guide = GUIDE, schemaPath = "", bin = "" } = {}) {
  const text = String(prompt ?? "");
  const json = JSON.stringify(SCHEMA);
  switch (cli) {
    case "claude":
      return { cli, bin: bin || "claude", args: ["-p", text, "--model", DRAFT_MODEL, "--system-prompt", guide,
        "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--disable-slash-commands",
        "--output-format", "json", "--json-schema", json] };
    case "codex":
      if (!schemaPath) throw new Error("codex needs the answer's shape in a file.");
      return { cli, bin: bin || "codex", args: ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema", schemaPath, combined(guide, text)] };
    case "agy":
      return { cli, bin: "sh", args: ["-c", NO_BROWSER, "sh", bin || "agy", "-p", combined(guide, text), "--output-format", "json", "--json-schema", json,
        "--disable-slash-commands", "--log-file", "/dev/null"] };
    case "pi":
      return { cli, bin: bin || "pi", args: ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", "--system-prompt", guide, text] };
    default:
      throw new Error(`${cli} can't draft automations.`);
  }
}

// The last line of what went wrong, else what the exit code says.
const lastErr = (r, cli) => String(r?.stderr ?? "").trim().split("\n").filter(Boolean).pop() || (r?.code === 127 ? `${cli} isn't installed` : `${cli} stopped with code ${r?.code}`);
const isDraft = (d) => Boolean(d) && typeof d === "object" && !Array.isArray(d) && ("when" in d || "prompt" in d || "name" in d);

// An object in text: the whole text, the inside of a ``` fence, or from its first { to its last }.
function jsonIn(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const tries = [s];
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(s);
  if (fence) tries.push(fence[1].trim());
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
  for (const t of tries) { try { const v = JSON.parse(t); if (v && typeof v === "object") return v; } catch {} }
  return null;
}

// The draft (an object with the fields) from a CLI's answer, exec's { code, stdout, stderr };
// throws with why it couldn't be read.
export function parseDraftOutput(cli, r) {
  const name = DRAFTER_NAMES[cli] ?? cli;
  const out = String(r?.stdout ?? "");
  if (cli === "claude") {
    // One result object, or a list of messages ending with it.
    let all = null;
    try { all = JSON.parse(out); } catch {}
    const res = Array.isArray(all) ? [...all].reverse().find((m) => m?.type === "result") : all;
    if (!res) throw new Error(r?.code !== 0 ? lastErr(r, cli) : `${name}'s answer couldn't be read.`);
    if (res.is_error) throw new Error(String(res.result || res.subtype || `${name} couldn't draft it.`));
    const d = res.structured_output ?? (typeof res.result === "string" ? jsonIn(res.result) : null);
    if (!isDraft(d)) throw new Error(`${name} didn't send back a draft.`);
    return d;
  }
  if (cli === "agy") {
    const res = jsonIn(out);
    if (!res) throw new Error(r?.code !== 0 ? lastErr(r, cli) : `${name}'s answer couldn't be read.`);
    if (res.status && res.status !== "SUCCESS") throw new Error(String(res.error?.message ?? res.error ?? res.response ?? `${name} couldn't draft it (${res.status}).`).trim());
    const d = res.structured_output ?? (typeof res.response === "string" ? jsonIn(res.response) : isDraft(res) ? res : null);
    if (!isDraft(d)) throw new Error(`${name} didn't send back a draft.`);
    return d;
  }
  if (cli === "codex" || cli === "pi") {
    // Its last message as plain text: the object, maybe in a ``` fence.
    const d = jsonIn(out);
    if (isDraft(d)) return d;
    throw new Error(r?.code !== 0 ? lastErr(r, cli) : `${name} didn't send back a draft.`);
  }
  throw new Error(`${cli} can't draft automations.`);
}
