// A repo's worktree scripts: one line of shell to run in a new worktree
// ("setup": install, copy .env) and one to run before a worktree is removed
// ("archive": stop what setup started). The Worktrees screen (ws-worktrees)
// writes them; the board (ws-board) runs setup for the worktrees it makes.
// The same file is copied into both mods: a mod can't import from another's
// folder. scripts/sync-from-home.sh refuses to sync when the copies differ.
//
// Files:
//   ~/.herdr/workspaces/<ws>/worktrees.json     { "<repo>": { "setup": "…", "archive": "…" } }
//   ~/.herdr/workspaces/.worktree-scripts.json  { "<ws>/<repo>/<kind>": "<the line allowed>" }
// A line runs only while it equals the allowed one, which the screen's Save and
// Allow write: a line that got into worktrees.json any other way waits for Allow.
//
// No imports: callers pass `io` = { home, readTextFile, writeTextFile, exec }.

export const KINDS = ["setup", "archive"];
export const scriptsFile = (io, ws) => `${io.home()}/.herdr/workspaces/${ws}/worktrees.json`;
export const allowedFile = (io) => `${io.home()}/.herdr/workspaces/.worktree-scripts.json`;

async function readJson(io, file) {
  const text = await io.readTextFile(file);
  if (text === null) return { text: null, data: {} };
  try {
    const data = JSON.parse(text);
    return { text, data: data && typeof data === "object" && !Array.isArray(data) ? data : {} };
  } catch (e) { return { text, data: {}, error: String(e?.message ?? e) }; }
}

const lineOf = (scripts, repo, kind) => {
  const v = scripts?.[repo]?.[kind];
  return typeof v === "string" ? v.trim() : "";
};

// A workspace's scripts and what's allowed: scriptOf(repo, kind) -> { line, allowed }.
export async function loadScripts(io, ws) {
  const scripts = await readJson(io, scriptsFile(io, ws));
  const allowed = await readJson(io, allowedFile(io));
  return {
    error: scripts.error ? `worktrees.json: ${scripts.error}` : null,
    scriptOf(repo, kind) {
      const line = lineOf(scripts.data, repo, kind);
      return { line, allowed: !line || allowed.data[`${ws}/${repo}/${kind}`] === line };
    },
  };
}

async function update(io, file, change) {
  for (let i = 0; ; i++) {
    const old = await readJson(io, file);
    if (old.error) throw new Error(`${file} isn't valid JSON: ${old.error}`);
    const next = change({ ...old.data });
    try { return await io.writeTextFile(file, JSON.stringify(next, null, 2) + "\n", old.text); }
    catch (e) { if (i >= 2) throw e; } // changed under us: read it again
  }
}

// Saves a repo's lines ("" removes one) and allows them as written.
export async function saveScripts(io, ws, repo, lines) {
  const clean = Object.fromEntries(KINDS.map((k) => [k, String(lines[k] ?? "").trim()]));
  await update(io, scriptsFile(io, ws), (all) => {
    const entry = { ...(all[repo] && typeof all[repo] === "object" ? all[repo] : {}) };
    for (const k of KINDS) { if (clean[k]) entry[k] = clean[k]; else delete entry[k]; }
    if (Object.keys(entry).length) all[repo] = entry; else delete all[repo];
    return all;
  });
  await update(io, allowedFile(io), (all) => {
    for (const k of KINDS) { if (clean[k]) all[`${ws}/${repo}/${k}`] = clean[k]; else delete all[`${ws}/${repo}/${k}`]; }
    return all;
  });
}

// Allows the lines worktrees.json holds now for a repo.
export async function allowScripts(io, ws, repo) {
  const scripts = await readJson(io, scriptsFile(io, ws));
  await update(io, allowedFile(io), (all) => {
    for (const k of KINDS) { const line = lineOf(scripts.data, repo, k); if (line) all[`${ws}/${repo}/${k}`] = line; }
    return all;
  });
}

// Runs a line with sh in the worktree. The line gets the facts as variables,
// never filled into it: $HERDR_WORKTREE, $HERDR_REPO (the main checkout),
// $HERDR_BRANCH, $HERDR_WORKSPACE. { ok, tail }: tail is its last lines.
export async function runScript(io, line, { path, main, branch, ws }) {
  let r;
  try {
    r = await io.exec("env", [`HERDR_WORKTREE=${path}`, `HERDR_REPO=${main}`, `HERDR_BRANCH=${branch ?? ""}`, `HERDR_WORKSPACE=${ws}`, "sh", "-c", line],
      { cwd: path, timeout: 600000 });
  } catch (e) { return { ok: false, tail: String(e?.message ?? e) }; }
  const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-3).join("\n");
  return { ok: r.code === 0, tail: tail || (r.code === 0 ? "" : `It ended with code ${r.code}.`) };
}

// Setup ran here: a file in the worktree's own git folder, out of the checkout.
const MARK = 'd=$(git -C "$1" rev-parse --absolute-git-dir) && ';
export const isSetUp = async (io, path) => (await io.exec("sh", ["-c", `${MARK}test -e "$d/herdr-setup"`, "sh", path]).catch(() => ({ code: 1 }))).code === 0;
export const markSetUp = (io, path) => io.exec("sh", ["-c", `${MARK}date > "$d/herdr-setup"`, "sh", path]).catch(() => null);

// Runs a repo's setup in a worktree that hasn't had it. Returns "" (nothing to
// do), "ran", or throws with what the person should know.
export async function setUp(io, { ws, repo, path, main, branch }) {
  const { line, allowed } = (await loadScripts(io, ws)).scriptOf(repo, "setup");
  if (!line || (await isSetUp(io, path))) return "";
  if (!allowed) throw new Error(`The setup script for ${repo} was changed outside the Worktrees screen. Allow it there first.`);
  const r = await runScript(io, line, { path, main, branch, ws });
  if (!r.ok) throw new Error(`Setup failed in ${repo}: ${r.tail}`);
  await markSetUp(io, path);
  return "ran";
}
