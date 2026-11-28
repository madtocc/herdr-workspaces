// Switch account on the Agents right-click menu, as rules with no imports so node can test
// them: which rows get it, the accounts its submenu lists, the command that starts the agent
// again on another account and continues its conversation, and the row's account mark.
//
// The accounts come from `herdr-ws-account list --cached` (ws-switcher/accounts/cli.js), as
// { agents: { claude: { default, accounts: [{ id, label, main, isDefault, signedIn }] }, … } }.
// Which one an agent runs on: the launcher's note ~/.herdr/accounts/on/<core>/<terminal>,
// "<agent> <id>" (accounts.js reads them); no note = the agent's own sign-in, "main".

import { shellWords } from "./menufacts.js";

export const ACCOUNT_KINDS = new Set(["claude", "codex", "agy"]);
const tail = (p) => String(p ?? "").split("/").pop();

// "claude 2" → { agent: "claude", id: "2" }; anything else null.
export function onNote(text) {
  // Its first line (the second is the launcher's words: onWords()).
  const m = /^(claude|codex|agy) ([A-Za-z0-9._-]+)\s*$/.exec(String(text ?? "").trim().split("\n")[0]);
  return m ? { agent: m[1], id: m[2] } : null;
}

// The launcher's words on the note's second line (herdr-ws-agent …), or null.
export function onWords(text) {
  const w = String(text ?? "").split("\n")[1]?.trim() ?? "";
  return w.startsWith("herdr-ws-agent ") ? w : null;
}

// The account id an agent of `kind` runs on, by its note's text: the note's when it's for
// that kind of agent, else "main".
export function currentAccount(kind, note) {
  const n = onNote(note);
  return n && n.agent === kind ? n.id : "main";
}

// The kind's accounts from the list, or [] (not installed, never looked, no list).
export function kindAccounts(list, kind) {
  const k = list?.agents?.[kind];
  if (!k || k.installed === false || !Array.isArray(k.accounts)) return [];
  return k.accounts.filter((x) => x && typeof x.id === "string");
}

// Whether a row gets Switch account: Claude, Codex or Antigravity, on this computer, in a
// pane (the new one opens as a tab where it was; a helper without a pane stays as it is),
// with more than one account for its kind.
export function switchOffered(a, list) {
  return ACCOUNT_KINDS.has(a?.kind) && !a.remote && Boolean(a.pane) && kindAccounts(list, a.kind).length > 1;
}

// Whether it can be switched now: Claude and Antigravity need the conversation they're in
// (nothing to resume otherwise; the item says so). Codex's is looked up when it's picked
// (the rollout file the running Codex has open, else its latest in that folder).
export const switchKnown = (a) => a?.kind === "codex" || Boolean(a?.session);

// The submenu's rows: each account by its label, the current one checked (and doing
// nothing), a signed-out one dimmed with a hint, then Manage accounts….
// Each row: { id, label, current?, disabled?, hint?, sep? }.
export function accountRows(a, list) {
  const cur = a.account ?? "main";
  const rows = kindAccounts(list, a.kind).map((x) => ({
    id: `acct:${x.id}`,
    account: x.id,
    label: x.label || x.email || x.id,
    ...(x.id === cur ? { current: true } : {}),
    ...(x.id !== cur && x.signedIn === false ? { disabled: true, hint: "signed out" } : {}),
  }));
  return [...rows, { id: "manage", label: "Manage accounts…", sep: true }];
}

// The popup's height for those rows: as menuHeight (menufacts.js), one title line.
export const accountsHeight = (rows) => 10 + 24 + rows.length * 31 + rows.filter((r) => r.sep).length * 9;

// The words that pick a conversation, dropped before the new one is added: those that take
// the next word, and those that don't. (Codex: its subcommands, then the id or --last.)
const PICKS = {
  claude: { one: ["--resume", "-r", "--session-id"], bare: ["--continue", "-c", "--fork-session"] },
  agy: { one: ["--conversation", "-i"], bare: [] },
  codex: { one: [], bare: [] },
};

// The command that starts the agent again on account `to`, continuing its conversation.
// From the launcher's note of how it started (Claude: a.cmd, stats.js checked it's this
// Claude's; Antigravity and Codex: the restart note, when it's this agent's), else
// `herdr-ws-agent <kind>`. Any --account before the agent goes; `--account <to>` comes
// right after herdr-ws-agent. Then the resume: Claude `--resume <session>`, Antigravity
// `--conversation <session>`, Codex `resume <session>` (no session known: `resume --last`,
// its latest in the folder it starts in). Null when it can't (not one of those, remote,
// no conversation for Claude or Antigravity, a bad account id).
export function switchArgv(a, to) {
  const kind = a?.kind;
  if (!ACCOUNT_KINDS.has(kind) || a.remote || !/^[A-Za-z0-9._-]+$/.test(String(to ?? ""))) return null;
  const session = a.session ? String(a.session) : "";
  if (kind !== "codex" && !session) return null;
  const words = a.cmd ? shellWords(a.cmd) : null;
  let at = -1;
  if (words && tail(words[0]) === "herdr-ws-agent") {
    for (let i = 1; i < words.length; i++) {
      if (words[i] === "--account" || words[i] === "--instructions" || words[i] === "--task") { i++; continue; }
      if (tail(words[i]) === kind) { at = i; break; }
      break; // a word the launcher doesn't take before its agent: not a note of this agent
    }
  }
  const pre = ["herdr-ws-agent", "--account", String(to)];
  let rest = [];
  if (at > 0) {
    // The launcher's own words before the agent (its instructions), less --account and --task.
    for (let i = 1; i < at; i++) {
      if (words[i] === "--account" || words[i] === "--task") { i++; continue; }
      pre.push(words[i]);
    }
    const picks = PICKS[kind];
    const args = words.slice(at + 1);
    // Codex: a subcommand that picks a conversation (resume, fork) goes with what follows it.
    if (kind === "codex") { const sub = args.findIndex((w) => w === "resume" || w === "fork"); if (sub >= 0) args.length = sub; }
    for (let i = 0; i < args.length; i++) {
      const w = args[i];
      if (picks.one.includes(w)) { i++; continue; }
      if (picks.bare.includes(w) || picks.one.some((p) => w.startsWith(`${p}=`))) continue;
      rest.push(w);
    }
  }
  const agent = at > 0 ? words[at] : kind;
  if (kind === "claude") return [...pre, agent, ...rest, "--resume", session];
  if (kind === "agy") return [...pre, agent, ...rest, "--conversation", session];
  return [...pre, agent, "resume", ...rest, ...(session ? [session] : ["--last"])];
}

// A Codex conversation's id from a rollout file's path
// (…/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl), else null.
export function rolloutId(file) {
  const m = /\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^/]*?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(String(file ?? ""));
  return m ? m[1] : null;
}

// The rollout file a Codex has open, out of `lsof -Fn` lines (n<path>), else null.
export function rolloutIn(lsof) {
  for (const line of String(lsof ?? "").split("\n")) {
    if (line[0] !== "n") continue;
    const f = line.slice(1);
    if (rolloutId(f)) return f;
  }
  return null;
}

// The row's mark: the account's label when the agent isn't on its kind's default, else
// null (nothing to say). An agent with no note is on main.
export function accountMark(kind, note, list) {
  if (!ACCOUNT_KINDS.has(kind)) return null;
  const accts = kindAccounts(list, kind);
  if (accts.length < 2) return null;
  const cur = currentAccount(kind, note);
  const def = list.agents[kind].default ?? accts.find((x) => x.isDefault)?.id ?? "main";
  if (cur === def) return null;
  const x = accts.find((y) => y.id === cur);
  return x ? x.label || x.email || x.id : cur;
}

// The confirm's sentence for one that's in the middle of something, else "".
export function switchAsk(a, label) {
  const own = a.status === "working" ? "It's working: switching stops what it's doing, then it continues the conversation"
    : a.status === "blocked" ? "It's waiting on you. Switching ends it there, then it continues the conversation" : "It continues the conversation";
  return `${own} on ${label}, in a new tab.`;
}

// Where the submenu opens: right of the pressed item (its bounds, in window points, as Herdr
// gives them to a press), its first row level with the item (the popup's 5 px padding and 24 px title above it). Null without bounds.
export function sideAt(bounds) {
  if (!bounds) return null;
  const x = bounds.origin?.x ?? bounds.x, y = bounds.origin?.y ?? bounds.y, w = bounds.size?.width ?? bounds.width;
  return [x, y, w].every((n) => typeof n === "number" && isFinite(n)) ? { x: Math.max(0, x + w + 6), y: Math.max(0, y - 29) } : null;
}
