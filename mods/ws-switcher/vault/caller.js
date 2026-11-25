// Who is asking: the workspace (from --workspace / --global, else the current folder, found the
// way herdr-ws-agent and herdr-ws-run find it, through ~/.herdr/workspaces/.index), the agent
// and the Herdr terminal. Only what the caller says about itself, for scope and the usage line.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

function real(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function holds(dir, root) {
  return (dir + "/").startsWith(root + "/");
}

// The workspace id holding a folder, or null (the index's most specific root or folder; a
// herdr worktree, ~/.herdr/worktrees/<repo>/<branch>, goes by its repo).
export function workspaceFor(cwd) {
  const home = os.homedir();
  let text;
  try { text = fs.readFileSync(path.join(home, ".herdr", "workspaces", ".index"), "utf8"); } catch { return null; }
  const rows = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t"));
  const here = real(cwd);
  let ws = null;
  let best = -1;
  for (const [kind, id, p] of rows) {
    if (kind !== "dir" || !id || !p) continue;
    const root = real(p);
    if (holds(here, root) && root.length > best) { ws = id; best = root.length; }
  }
  if (!ws) {
    const trees = real(path.join(home, ".herdr", "worktrees"));
    if (holds(here, trees)) {
      const repo = here.slice(trees.length + 1).split("/")[0];
      const row = rows.find(([kind, , name]) => kind === "repo" && name === repo);
      if (row) ws = row[1];
    }
  }
  return ws;
}

const AGENTS = ["claude", "codex", "agy", "antigravity", "pi", "gemini", "grok", "opencode", "cursor-agent", "aider", "goose", "amp"];

// The agent's name. Nothing Herdr starts says it outright (herdr-ws-agent exports nothing
// that names the agent), so: what agent CLIs put in their commands' environment, else the
// nearest parent process with a known agent's name, else the parent's own name.
export function agentName(env = process.env) {
  const ai = env.AI_AGENT || "";
  if (ai) return ai.startsWith("claude") ? "claude" : ai.split(/[_\s]/)[0];
  if (env.CLAUDECODE) return "claude";
  if (Object.keys(env).some((k) => k.startsWith("CODEX_"))) return "codex";
  if (env.GEMINI_CLI) return "gemini";
  let pid = process.ppid;
  let first = null;
  for (let i = 0; i < 6 && pid > 1; i++) {
    let line;
    try { line = execFileSync("/bin/ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { break; }
    const m = /^(\d+)\s+(.*)$/.exec(line);
    if (!m) break;
    const name = path.basename(m[2]);
    if (first === null) first = name;
    if (AGENTS.includes(name)) return name === "antigravity" ? "agy" : name;
    pid = Number(m[1]);
  }
  return first;
}

let cached = null;

// { ws, agent, terminal } for the broker and the usage line. opts: { workspace, global }.
export function caller(opts = {}) {
  if (cached) return cached;
  const ws = opts.global ? null : opts.workspace || workspaceFor(process.cwd());
  cached = { ws: ws || null, agent: agentName() || null, terminal: process.env.HC_TERMINAL_ID || null };
  return cached;
}
