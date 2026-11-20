// Workspaces and agent presets as read from their files: what the switcher shows
// and what the automations runner starts. The switcher (main.js) and the
// background runner (runner/main.js) both load these, so they agree.

import { home, readTextFile, exec, window, shared } from "herdr";
import * as fs from "fs/promises";
import { readOrder, sortDefs } from "./arrange.js";

export const dir = () => `${home()}/.herdr/workspaces`;

export function expand(p) {
  const s = String(p ?? "").trim();
  if (!s) return "";
  const full = s === "~" ? home() : s.startsWith("~/") ? home() + s.slice(1) : s;
  return full.length > 1 ? full.replace(/\/+$/, "") : full;
}
export const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
export const under = (p, d) => Boolean(p && d) && (p === d || p.startsWith(d === "/" ? d : d + "/"));
export const base = (p) => p.replace(/\/+$/, "").split("/").pop();

// JSON with // and /* */ comments and trailing commas.
export function parseJsonc(text) {
  const pass = (s, other) => {
    let out = "";
    for (let i = 0; i < s.length;) {
      if (s[i] === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
        out += s.slice(i, j + 1);
        i = j + 1;
      } else {
        const r = other(s, i);
        out += r.text;
        i = r.next;
      }
    }
    return out;
  };
  const uncommented = pass(text, (s, i) => {
    if (s.startsWith("//", i)) { const e = s.indexOf("\n", i); return { text: "", next: e < 0 ? s.length : e }; }
    if (s.startsWith("/*", i)) { const e = s.indexOf("*/", i + 2); return { text: "", next: e < 0 ? s.length : e + 2 }; }
    return { text: s[i], next: i + 1 };
  });
  return JSON.parse(pass(uncommented, (s, i) => {
    if (s[i] !== ",") return { text: s[i], next: i + 1 };
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    return { text: s[j] === "}" || s[j] === "]" ? "" : ",", next: i + 1 };
  }));
}

export async function subdirs(path) {
  try {
    return (await fs.readdir(path, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
  } catch { return []; }
}

// The menu's order and folded groups (arrange.js).
export const orderFile = () => `${dir()}/.order.json`;
export async function loadOrder() {
  return readOrder(await readTextFile(orderFile()).catch(() => null));
}

// In the menu's order (arrange.js), Scratch last. saved: the order, read here if not given.
export async function loadDefs(saved) {
  const defs = [];
  for (const id of await subdirs(dir())) {
    const at = `${dir()}/${id}`;
    const text = await readTextFile(`${at}/workspace.jsonc`);
    if (text === null) continue;
    try {
      const c = parseJsonc(text);
      const root = expand(c.root);
      const folders = (Array.isArray(c.folders) ? c.folders : []).map((f) => {
        const e = expand(f);
        return e.startsWith("/") ? e : `${root}/${e}`;
      });
      const told = expand(c.instructions || "AGENTS.md");
      defs.push({
        id, dir: at, name: String(c.name || id), color: c.color ? String(c.color) : null, root, folders,
        children: root ? await subdirs(root) : [], instructions: told.startsWith("/") ? told : `${at}/${told}`,
        board: c.board && typeof c.board === "object" ? c.board : null,
        scratch: c.scratch === true, // the Scratch workspace (scratch.js)
        group: typeof c.group === "string" && c.group.trim() ? c.group.trim().replace(/\s+/g, " ").slice(0, 40) : null, // its group in the menu
      });
    } catch (e) {
      defs.push({ id, dir: at, name: id, color: null, root: "", folders: [], children: [], instructions: "", error: String(e?.message ?? e) });
    }
  }
  // Where each root and folder really is, when a symlink leads there (macOS's /tmp
  // is /private/tmp): terminals report the real path. `real`: path -> real path.
  const paths = [...new Set(defs.flatMap((d) => [d.root, ...d.folders]).filter(Boolean))];
  let real = {};
  if (paths.length && window()?.platform !== "windows") {
    try {
      const r = await exec("sh", ["-c", 'for p; do (cd "$p" 2>/dev/null && pwd -P) || printf "%s\\n" "$p"; done', "sh", ...paths]);
      const out = r.stdout.split("\n");
      paths.forEach((p, i) => { if (out[i] && out[i] !== p) real[p] = out[i]; });
    } catch {}
  }
  // The Scratch workspace comes last in the lists, the rest as the menu has them.
  defs.sort((a, b) => Number(Boolean(a.scratch)) - Number(Boolean(b.scratch)));
  for (const d of defs) d.real = Object.fromEntries([d.root, ...d.folders].filter((p) => real[p]).map((p) => [p, real[p]]));
  return sortDefs(defs, saved ?? (await loadOrder()));
}

// --- agent presets ---
// herdr-core's templates are the global presets (`hc run <name> "<task>"` starts
// one too); a workspace's own are ~/.herdr/workspaces/<id>/agents/<name>.md and
// win by name. Same format as hc's: front matter `description` and `command` (a
// shell line, values taken as written), instructions as the body.
export const templatesDir = () => `${home()}/.config/herdr-core/templates`;

export function parsePreset(name, file, text, scope) {
  const t = text.replace(/\r\n/g, "\n");
  const end = t.startsWith("---\n") ? t.indexOf("\n---", 3) : -1;
  if (end < 0) return { name, file, scope, description: "", command: "", body: "", error: "no front matter (start the file with ---)" };
  const fields = {};
  for (const line of t.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const body = t.slice(end + 4).replace(/^\n/, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return { name, file, scope, description: fields.description ?? "", command: fields.command ?? "", body, error: fields.command ? null : "no command" };
}

export async function loadPresetDir(path, scope) {
  let names = [];
  try { names = (await fs.readdir(path)).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    const text = await readTextFile(`${path}/${n}`);
    if (text !== null) out.push(parsePreset(n.slice(0, -3), `${path}/${n}`, text, scope));
  }
  return out;
}

// The presets a workspace offers: its own, then the global ones it doesn't override.
export function presetsFor(id) {
  const p = shared("workspaces.presets") ?? {};
  const own = (id && p.workspaces?.[id]) || [];
  return [...own, ...(p.global ?? []).filter((g) => !own.some((o) => o.name === g.name))].filter((x) => !x.error);
}

// A shell line as words: quotes and backslashes as sh reads them.
export function words(line) {
  const out = [];
  let cur = null, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
      continue;
    }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur ??= "";
    if (c === "'" || c === '"') q = c;
    else if (c === "\\" && i + 1 < line.length) cur += line[++i];
    else cur += c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

// How Herdr starts a preset: { argv, task }. With the launcher, Claude, Codex,
// Antigravity (agy) and Pi get the instructions as system instructions (--instructions)
// and the task as the first message; other agents get both in the first message,
// as hc does.
export function presetLaunch(preset, task) {
  let argv = words(preset.command);
  // `VAR=x cmd` (or `env VAR=x cmd`): the assignments go first, before the launcher.
  if (argv[0] === "env") argv = argv.slice(1);
  const assigns = [];
  while (argv[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) assigns.push(argv.shift());
  if (base(argv[0] ?? "") === "herdr-ws-agent") argv = argv.slice(1);
  const agent = base(argv[0] ?? "");
  const launcher = shared("workspaces.launcher") === true;
  const system = launcher && (agent === "claude" || agent === "codex" || agent === "agy" || agent === "pi") && Boolean(preset.body);
  if (launcher) argv = ["herdr-ws-agent", ...(system ? ["--instructions", preset.file] : []), ...argv];
  if (assigns.length) argv = ["env", ...assigns, ...argv];
  const told = preset.body && `You are the "${preset.name}" agent, started from the Herdr agent preset of that name (${preset.file}). Its instructions:\n\n${preset.body}`;
  return { argv, task: system ? task : [told, task].filter(Boolean).join("\n\n") };
}

// The first message, for the launcher: as --task, not last on the command line where
// Herdr would put it, so a restart brings the agent back without sending it again
// (bin/herdr-ws-resume). Other commands keep Herdr's task.
export function withTask(argv, task) {
  let i = argv[0] === "env" ? 1 : 0;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  if (!task || base(argv[i] ?? "") !== "herdr-ws-agent") return { argv, task };
  return { argv: [...argv.slice(0, i + 1), "--task", task, ...argv.slice(i + 1)], task: "" };
}
