// The Agents list's right-click menu as rules, with no imports so node can test them:
// which items an agent's row gets, how a fork or handoff starts, what a wipe moves to
// the Trash.
//
// An agent here is the row's facts (main.js: menuFacts()):
//   { address, name, pane, tab, space, status, kind, pinned, top, focused, remote,
//     session, file, cwd, cmd, helpers }
// kind: kindOf(); session, file, cwd, cmd: what stats.js read for it (its conversation's
// id, transcript, folder, and the launcher's note of how it was started), when it knows;
// switch: { known } when the row gets Switch account (acctfacts.js switchOffered(); known:
// switchKnown(), else it's there dimmed, saying why), else null;
// agyWipe: the experiment "antigravity-wipe" is on (settingsfacts.js); agyFresh: stats.js
// found the Antigravity's note to be the running process's (not one left by an earlier one).
// helpers: { count, working, blocked } of the live sub-agents that end when Close ends it;
// wipeHelpers: the same for Wipe. Closing its pane (pane.close) leaves a helper started to
// outlive it (hc run --outlive-parent: terminals()' die_with_parent false) running, with
// whatever is under that one; terminal.kill (Wipe, and Close on a sub-agent without a pane)
// ends every helper under it, those too. Seen in the sandbox, 2026-11-26: a helper kept as
// its own tab ends either way.

// What an agent is, by what it reports (OSC 7501 app), else by its program's key.
const KINDS = { "claude-code": "claude", claude: "claude", codex: "codex", pi: "pi", agy: "agy", antigravity: "agy" };
export const kindOf = (app, key) => KINDS[app] ?? KINDS[key] ?? null;

// Agents that take /compact.
const COMPACTS = new Set(["claude", "codex", "pi"]);
// Agents whose terminal's conversation the list knows and that can start a copy of
// one: Claude (--resume <id> --fork-session) and Pi (--fork <file>). Codex can fork
// too (codex fork <id>), but which conversation a Codex terminal holds isn't known.
// Antigravity can't fork.
const FORKS = new Set(["claude", "pi"]);

// The menu, in groups: talk to it, more of it, end it. Each item is
// { id, label, icon, hint?, danger?, sep?, disabled?, sub? } (hint: dim text on the right; sep: a line
// above it; disabled: drawn dim and does nothing; sub: it opens a submenu, a chevron on the right).
export function menuItems(a) {
  const known = !a.remote && Boolean(a.session);
  const forks = known && FORKS.has(a.kind);
  const resting = a.status === "idle" || a.status === "done";
  const groups = [
    [
      !a.focused && { id: "peek", label: "Peek", icon: "mods/ws-agents/eye.svg" },
      a.status !== "blocked" && { id: "send", label: "Send a message…", icon: "mods/ws-agents/message.svg" },
      a.status === "working" && { id: "interrupt", label: "Interrupt", icon: "mods/ws-agents/stop.svg" },
      COMPACTS.has(a.kind) && resting && { id: "compact", label: "Compact", icon: "mods/ws-agents/compacted.svg" },
    ],
    [
      forks && { id: "fork", label: "Fork conversation", icon: "mods/ws-agents/fork.svg" },
      !a.remote && { id: "handoff", label: "Hand off…", icon: "mods/ws-agents/handoff.svg" },
      Boolean(a.switch) && { id: "accounts", label: "Switch account", icon: "mods/ws-agents/account.svg",
        ...(a.switch.known ? { sub: true } : { disabled: true, hint: "nothing to resume" }) },
      Boolean(a.tab) && { id: "rename", label: "Rename tab…", icon: "mods/workspace-chrome/square-pen.svg" },
      a.top && { id: "pin", label: a.pinned ? "Unpin" : "Pin to top", icon: `mods/workspace-chrome/${a.pinned ? "pin-off" : "pin"}.svg` },
      // Its Herdr address (t7, vps/t7), for hc read / hc send or another agent's task.
      { id: "address", label: "Copy terminal id", icon: "mods/workspace-chrome/terminal.svg", hint: a.address },
      known && { id: "copy", label: "Copy conversation id", icon: "mods/ws-agents/copy.svg" },
    ],
    [
      { id: "close", label: "Close session", icon: "mods/workspace-chrome/x.svg" },
      known && wipeTargets(a).length > 0 && { id: "wipe", label: "Wipe conversation…", icon: "mods/ws-agents/trash.svg", danger: true, ...(a.kind === "agy" ? { hint: "experimental" } : {}) },
    ],
  ];
  const out = [];
  for (const g of groups) {
    const items = g.filter(Boolean);
    items.forEach((it, i) => out.push(i === 0 && out.length ? { ...it, sep: true } : it));
  }
  return out;
}

// The popup's height for those items: a title line, 31 a row, 9 a line between groups.
export const menuHeight = (items) => 10 + 24 + items.length * 31 + items.filter((it) => it.sep).length * 9;

// Closing one that's in the middle of something asks first, and so does closing one
// with live helpers that end with it.
export const closeAsks = (a) => a.status === "working" || a.status === "blocked" || (a.helpers?.count ?? 0) > 0;

// The sentence about the helpers that end with it (h: a.helpers for Close, a.wipeHelpers
// for Wipe), or "" when none do: "It has 3 helpers (2 working): they end with it."
export function helpersLine(h) {
  if (!h?.count) return "";
  const busy = [h.working && `${h.working} working`, h.blocked && `${h.blocked} waiting on you`].filter(Boolean).join(", ");
  const many = h.count !== 1;
  return `It has ${h.count} ${many ? "helpers" : "helper"}${busy ? ` (${busy})` : ""}: ${many ? "they end" : "it ends"} with it.`;
}

// The words of a launcher note (herdr-ws-agent writes them, quoted as sh reads
// them: bare words and '…' with '\'' for a quote inside). Null when it's anything else.
// A copy of History's (ws-history/histfacts.js).
export function shellWords(text) {
  const out = [];
  const s = String(text ?? "").trim();
  let i = 0;
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (i >= s.length) break;
    let word = "";
    while (i < s.length && s[i] !== " " && s[i] !== "\t") {
      if (s[i] === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) return null;
        word += s.slice(i + 1, end);
        i = end + 1;
      } else if (s[i] === "\\" && i + 1 < s.length) { word += s[i + 1]; i += 2; }
      else if (/["`$;&|<>(){}*?!#~\n]/.test(s[i])) return null; // not a plain list of words
      else word += s[i++];
    }
    out.push(word);
  }
  return out;
}

const tail = (p) => String(p ?? "").split("/").pop();
// The words that pick a conversation, which a fork replaces: those that take the
// next word, and those that don't.
const PICKS = {
  claude: { one: ["--resume", "-r", "--session-id"], bare: ["--continue", "-c", "--fork-session"] },
  pi: { one: ["--session", "--session-id", "--fork"], bare: ["--continue", "-c", "--resume", "-r", "--no-session"] },
};

// The command that starts a copy of the agent's conversation, in a new tab: how the
// launcher noted it was started (a preset keeps its model, permissions and
// instructions) when the note is for this kind of agent, else the launcher with the
// bare agent; then the agent's own fork words. Null when it can't fork.
export function forkArgv(a) {
  if (!FORKS.has(a.kind) || !a.session || a.remote) return null;
  const words = a.cmd ? shellWords(a.cmd) : null;
  const at = words && tail(words[0]) === "herdr-ws-agent" ? words.findIndex((w, i) => i > 0 && tail(w) === a.kind) : -1;
  let base = [`herdr-ws-agent`, a.kind];
  if (at > 0) {
    const picks = PICKS[a.kind];
    base = words.slice(0, at + 1);
    for (let i = at + 1; i < words.length; i++) {
      const w = words[i];
      if (picks.one.includes(w)) { i++; continue; }
      if (picks.bare.includes(w) || picks.one.some((p) => w.startsWith(`${p}=`))) continue;
      base.push(w);
    }
  }
  return a.kind === "claude" ? [...base, "--resume", a.session, "--fork-session"] : [...base, "--fork", a.file || a.session];
}

// Antigravity's own folder, from its transcript's path (<dir>/brain/<id>/…).
export function agyDir(a) {
  const id = String(a.session ?? "");
  const f = String(a.file ?? "");
  const at = id ? f.indexOf(`/brain/${id}/`) : -1;
  return at > 0 ? f.slice(0, at) : null;
}

// What a wipe moves to the Trash: the conversation's transcript and the folders the
// agent keeps for it. Claude: <claude>/projects/<folder>/<id>.jsonl, the <id>/ folder
// beside it (sub-agents, tool output), file-history/<id> and session-env/<id>. Pi: its
// session file. Antigravity, only with the experiment on and a fresh note: brain/<id>/,
// conversations/<id>.db (and its -wal, -shm), presence/<id>.lock and annotations/<id>.pbtxt
// (agywipe.js does the wipe itself: its root conversation and sub-agents too, out of
// Antigravity's lists first). Nothing when the transcript isn't plainly that conversation's.
export function wipeTargets(a) {
  const id = String(a.session ?? "");
  const f = String(a.file ?? "");
  if (a.remote || !/^[A-Za-z0-9._-]+$/.test(id) || !f.startsWith("/") || f.includes("/../") || /[\n\r]/.test(f)) return [];
  if (a.kind === "claude") {
    const m = /^(\/.+)\/projects\/[^/]+\/([^/]+)\.jsonl$/.exec(f);
    if (!m || m[2] !== id) return [];
    return [f, f.slice(0, -".jsonl".length), `${m[1]}/file-history/${id}`, `${m[1]}/session-env/${id}`];
  }
  if (a.kind === "pi") return f.endsWith(".jsonl") ? [f] : [];
  if (a.kind === "agy") {
    const dir = agyDir(a);
    if (!a.agyWipe || !a.agyFresh || !dir) return [];
    return [`${dir}/brain/${id}`, `${dir}/conversations/${id}.db`, `${dir}/conversations/${id}.db-wal`, `${dir}/conversations/${id}.db-shm`,
      `${dir}/presence/${id}.lock`, `${dir}/annotations/${id}.pbtxt`];
  }
  return [];
}

// Words of a preset's command line (single quotes, double quotes and backslash escapes),
// as ws-switcher/defs.js reads them.
export function commandWords(line) {
  const out = [];
  let cur = null, q = null;
  const s = String(line ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
      continue;
    }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur ??= "";
    if (c === "'" || c === '"') q = c;
    else if (c === "\\" && i + 1 < s.length) cur += s[++i];
    else cur += c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

// The program a command line runs, past `env`, VAR=x and the launcher.
export function commandProgram(command) {
  const argv = Array.isArray(command) ? command : commandWords(command);
  let i = argv[0] === "env" ? 1 : 0;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  if (tail(argv[i]) === "herdr-ws-agent") i++;
  return tail(argv[i] ?? "");
}

// Raw argv of a handoff choice (agent or preset), for inspecting its default model/effort.
export function choiceArgv(choice) {
  if (!choice) return [];
  return choice.kind === "agent" ? [...(choice.run ?? [])] : commandWords(choice.command ?? "");
}

// Replaces or clears a CLI flag (`--model x`, `--model=x`, `-m x`) in `ws`.
function setFlag(ws, names, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if (names.includes(ws[i])) { i++; continue; }
    if (names.some((n) => n.startsWith("--") && ws[i].startsWith(`${n}=`))) continue;
    out.push(ws[i]);
  }
  return value ? [...out, names[0], value] : out;
}

// Replaces or clears a Codex `-c key="value"` config override in `ws`.
function setConfig(ws, key, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if ((ws[i] === "-c" || ws[i] === "--config") && ws[i + 1]?.startsWith(`${key}=`)) { i++; continue; }
    out.push(ws[i]);
  }
  return value ? [...out, "-c", `${key}="${value}"`] : out;
}

// Applies optional model/effort overrides (`undefined` keeps command as-is; `""` or `null` clears).
function applyKnobs(argv, { model, effort, knobs } = {}) {
  if (!knobs) return argv;
  let out = argv;
  if (model !== undefined && Array.isArray(knobs.model) && knobs.model.length) {
    out = setFlag(out, knobs.model, model || "");
  }
  if (effort !== undefined && knobs.effort) {
    out = knobs.effort.flag
      ? setFlag(out, [knobs.effort.flag], effort || "")
      : setConfig(out, knobs.effort.config, effort || "");
  }
  return out;
}

// Choices for the Hand off dialog: installed agents (respecting the + menu's hidden list
// unless every installed agent is hidden), then valid workspace/global presets.
export function handoffChoices(presets, agents, hidden = []) {
  const hide = new Set(hidden ?? []);
  const installed = [];
  const seen = new Set();
  for (const a of agents ?? []) {
    if (!a?.key || a.installed === false || !Array.isArray(a.run) || !a.run.length || seen.has(a.key)) continue;
    seen.add(a.key);
    installed.push({
      id: `agent:${a.key}`,
      kind: "agent",
      key: a.key,
      name: a.name || a.key,
      run: [...a.run],
      tip: a.run.join(" "),
    });
  }
  const shown = installed.filter((a) => !hide.has(a.key));
  const agentList = shown.length ? shown : installed;
  const presetList = [];
  for (const p of presets ?? []) {
    if (!p?.name || !p.command || p.error) continue;
    presetList.push({
      id: `preset:${p.name}`,
      kind: "preset",
      name: p.name,
      command: p.command,
      file: p.file ?? null,
      body: p.body ?? "",
      description: p.description ?? "",
      scope: p.scope ?? null,
      tip: [p.description, p.command].filter(Boolean).join("\n"),
    });
  }
  return [...agentList, ...presetList];
}

// Default pick for Hand off: the source agent's own kind when installed, else the first choice.
export function firstHandoffPick(choices, sourceKind) {
  if (!choices?.length) return null;
  if (sourceKind) {
    const match = choices.find((c) => c.kind === "agent" && (c.key === sourceKind || kindOf(null, c.key) === sourceKind));
    if (match) return match.id;
  }
  return choices[0].id;
}

// The initial message handed to the new agent: structured reference to the source session
// (terminal id for `hc read`, transcript path when known, working folder) plus the task.
// When `prefill` is true and no task was typed, ends with a blank line so the cursor is
// ready for extra text or a pasted image without extra boilerplate to delete.
export function handoffPrompt(source, task, { prefill = false } = {}) {
  const lines = ["Context from another agent in Herdr:"];
  const who = [source?.program || source?.kind, source?.address ? `terminal ${source.address}` : ""].filter(Boolean).join(", ");
  lines.push(`- Agent: ${source?.name || source?.address || "unknown"}${who ? ` (${who})` : ""}`);
  if (source?.address) {
    lines.push(`- Live terminal: run \`hc read ${source.address}\` to inspect its recent output (or \`hc get ${source.address}\` for status)`);
  }
  if (source?.file) {
    lines.push(`- Transcript: ${source.file} (JSONL; read or grep only what you need, it can be large)`);
  }
  if (source?.cwd) {
    lines.push(`- Working folder: ${source.cwd}`);
  }
  const trimmed = String(task ?? "").trim();
  if (prefill) return trimmed ? `${lines.join("\n")}\n\n${trimmed}` : `${lines.join("\n")}\n\n`;
  const body = trimmed
    || "Inspect the referenced session above as context, summarize where things stand, and wait for my next instruction.";
  return `${lines.join("\n")}\n\n${body}`;
}

// Tab name for a handoff: `<target> · <source>` when the source has a telling name.
export function handoffTabName(choice, source) {
  const target = choice?.name || "Agent";
  const raw = String(source?.tabName || source?.name || "").trim();
  const base = raw && !/^\d+$/.test(raw) && raw !== source?.address ? raw : "";
  if (!base || base.toLowerCase() === target.toLowerCase()) return target;
  const short = base.length > 32 ? `${base.slice(0, 31).trimEnd()}…` : base;
  return `${target} · ${short}`;
}

// Passes `task` through `herdr-ws-agent --task` when the command uses the launcher
// (keeping it out of restart notes and handling agy's -i / pi's --); otherwise keeps Herdr's task.
// platform "windows": herdr-core starts herdr-ws-agent through its .cmd, and cmd can't take a line
// break in an argument, so the task's go as U+2028 (LINE SEPARATOR), which herdr-ws-agent turns back.
function withTaskArgv(argv, task, platform) {
  let i = argv[0] === "env" ? 1 : 0;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  if (!task || tail(argv[i] ?? "") !== "herdr-ws-agent") return { argv, task };
  const t = platform === "windows" ? String(task).replace(/\r\n?|\n/g, "\u2028") : task;
  return { argv: [...argv.slice(0, i + 1), "--task", t, ...argv.slice(i + 1)], task: "" };
}

// Parameters for `tab.new` to launch a handoff agent or preset referencing `source`.
// With `fallback.prefill`, launches idle (no `--task` / `task`) and returns `prefill` text
// for ws-agents to paste into the prompt once the new agent reports ready.
// `fallback.platform`: window().platform (Windows writes the task's line breaks as U+2028).
// Optional `fallback.model`, `fallback.effort`, and `fallback.knobs` (from knobs.js KNOBS)
// override or clear the model/effort flags on the agent or preset command.
// Returns null when the choice has no runnable command.
export function handoffLaunch(choice, source, task, launcher = false, fallback = {}) {
  if (!choice) return null;
  const prefill = Boolean(fallback.prefill);
  const prompt = handoffPrompt(source, task, { prefill });
  const space = source?.space || fallback.space || null;
  const folder = source?.cwd || fallback.folder || null;
  let argv, outTask = "", prefillText = null;
  if (choice.kind === "agent") {
    let base = Array.isArray(choice.run) ? [...choice.run] : [];
    if (!base.length) return null;
    base = applyKnobs(base, fallback);
    if (prefill) { argv = base; prefillText = prompt; }
    else ({ argv, task: outTask } = withTaskArgv(base, prompt, fallback.platform));
  } else if (choice.kind === "preset") {
    let words = commandWords(choice.command);
    if (words[0] === "env") words = words.slice(1);
    const assigns = [];
    while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) assigns.push(words.shift());
    if (tail(words[0] ?? "") === "herdr-ws-agent") words = words.slice(1);
    if (!words.length) return null;
    const agent = tail(words[0]);
    const system = Boolean(launcher) && (agent === "claude" || agent === "codex" || agent === "agy" || agent === "pi")
      && Boolean(choice.body) && Boolean(choice.file);
    let cmd = launcher ? ["herdr-ws-agent", ...(system ? ["--instructions", choice.file] : []), ...words] : words;
    if (assigns.length) cmd = ["env", ...assigns, ...cmd];
    cmd = applyKnobs(cmd, fallback);
    const told = choice.body
      ? `You are the "${choice.name}" agent, started from the Herdr agent preset of that name (${choice.file}). Its instructions:\n\n${choice.body}`
      : "";
    const msg = system ? prompt : [told, prompt].filter(Boolean).join("\n\n");
    if (prefill) { argv = cmd; prefillText = msg; }
    else ({ argv, task: outTask } = withTaskArgv(cmd, msg, fallback.platform));
  } else {
    return null;
  }
  return {
    name: handoffTabName(choice, source),
    ...(space ? { space } : {}),
    ...(folder ? { folder } : {}),
    argv,
    ...(outTask ? { task: outTask } : {}),
    ...(prefillText !== null ? { prefill: prefillText } : {}),
  };
}

// Hand off's Agent row with no agent to offer, in the + menu's words: the check failed, found
// none, or hasn't answered yet. `end`: the same as a sentence, for Start's error line.
export function agentsCheckLine({ failed = false, checked = false } = {}, end = false) {
  if (failed) return end ? "Could not load agents." : "Could not load agents";
  if (checked) return end ? "No agents installed." : "No agents installed";
  return end ? "No agents yet: still checking which are installed." : "Checking installed agents…";
}

// The ⋯'s place (a press's bounds, in window points) as a popup's `at`: under the button, from
// its left edge. Null when Herdr gave no bounds: the popup then opens at the pointer.
export function moreAt(bounds) {
  if (!bounds) return null;
  const x = bounds.origin?.x ?? bounds.x, y = bounds.origin?.y ?? bounds.y, h = bounds.size?.height ?? bounds.height;
  return [x, y, h].every((n) => typeof n === "number" && isFinite(n)) ? { x: Math.max(0, x), y: y + h + 4 } : null;
}
