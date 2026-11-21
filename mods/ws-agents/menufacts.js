// The Agents list's right-click menu as rules, with no imports so node can test them:
// which items an agent's row gets, how a fork starts, what a wipe moves to the Trash.
//
// An agent here is the row's facts (main.js: menuFacts()):
//   { address, name, pane, tab, space, status, kind, pinned, top, focused, remote,
//     session, file, cwd, cmd }
// kind: kindOf(); session, file, cwd, cmd: what stats.js read for it (its conversation's
// id, transcript, folder, and the launcher's note of how it was started), when it knows;
// agyWipe: the experiment "antigravity-wipe" is on (settingsfacts.js); agyFresh: stats.js
// found the Antigravity's note to be the running process's (not one left by an earlier one).

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
// { id, label, icon, hint?, danger?, sep? } (hint: dim text on the right; sep: a line above it).
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
      forks && { id: "fork", label: "Fork session", icon: "mods/ws-agents/fork.svg" },
      Boolean(a.tab) && { id: "rename", label: "Rename…", icon: "mods/workspace-chrome/square-pen.svg" },
      a.top && { id: "pin", label: a.pinned ? "Unpin" : "Pin to top", icon: `mods/workspace-chrome/${a.pinned ? "pin-off" : "pin"}.svg` },
      // Its Herdr address (t7, vps/t7), for hc read / hc send or another agent's task.
      { id: "address", label: "Copy terminal id", icon: "mods/workspace-chrome/terminal.svg", hint: a.address },
      known && { id: "copy", label: "Copy session id", icon: "mods/ws-agents/copy.svg" },
    ],
    [
      { id: "close", label: "Close session", icon: "mods/workspace-chrome/x.svg" },
      known && wipeTargets(a).length > 0 && { id: "wipe", label: "Wipe session…", icon: "mods/ws-agents/trash.svg", danger: true, ...(a.kind === "agy" ? { hint: "experimental" } : {}) },
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

// Closing one that's in the middle of something asks first.
export const closeAsks = (a) => a.status === "working" || a.status === "blocked";

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
