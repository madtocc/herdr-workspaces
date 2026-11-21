// How each agent (provider) takes a model and an effort, the models it offers, and
// commands with them set. Used by the runner (an automation's `model:` and `effort:`
// lines), the Automations screen and the Presets screen. The same file is in
// mods/ws-switcher, mods/ws-automations and mods/ws-presets, because mods can't import
// across folders: change all three (scripts/sync-from-home.sh checks they match).
// No imports, so `node` can test it.

// Per program (the command's program word, as programOf() finds it):
// - model: its model flags; models: the models to offer that it can't list itself
//   (Claude's aliases; Codex's also come from ~/.codex/config.toml, see configModels()).
// - effort: its effort flag (or Codex's config key) and levels; null when its --help
//   names no effort flag with levels, so no Effort chips are shown for it.
// - list: the arguments that make it print its models, and the parser for what it
//   prints (listModels() runs it and keeps the answer a day). Absent: no list, so the
//   screens only take a typed model.
// Each was read from the CLI's own --help and a real run (claude 2.1, codex-cli 0.160,
// pi 1.5, agy 1.5, opencode 1.18, grok 1.0, gemini 0.22).
export const KNOBS = {
  claude: { model: ["--model"], models: ["fable", "opus", "sonnet", "haiku"], effort: { flag: "--effort", levels: ["low", "medium", "high", "xhigh", "max"] } },
  codex: { model: ["--model", "-m"], models: [], effort: { config: "model_reasoning_effort", levels: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    // The catalog is JSON with each model's instructions (a quarter of a megabyte):
    // only the slug and visibility lines come back.
    list: { args: `debug models | grep -oE '"(slug|visibility)":"[^"]*"'`, parse: codexCatalog } },
  pi: { model: ["--model"], models: [], effort: { flag: "--thinking", levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
    list: { args: "--list-models", parse: piModels } },
  // Antigravity: --model takes a family (gemini-4-neon) and --effort its level; a model
  // named with its level (gemini-4-neon-high) refuses --effort. Its families are asked
  // of `agy models`, so none are listed here.
  agy: { model: ["--model"], models: [], effort: { flag: "--effort", levels: ["low", "medium", "high", "xhigh", "max"] },
    list: { args: "models", parse: agyFamilies } },
  // OpenCode: --model is provider/model. Its TUI has no effort flag.
  opencode: { model: ["--model", "-m"], models: [], effort: null, list: { args: "models", parse: opencodeModels } },
  // Grok has --reasoning-effort, but its help names no levels (any word gets past it).
  grok: { model: ["--model", "-m"], models: [], effort: null, list: { args: "models", parse: grokModels } },
  // Gemini: --model, and nothing that lists them.
  gemini: { model: ["--model", "-m"], models: [], effort: null },
};

// Each program's flags, as its --help lists them: "=" takes a value, "*" takes values up
// to the next flag, nothing: a switch. swapProgram() drops a flag the old program has and
// the new one hasn't (or takes differently); a word neither lists is kept.
const FLAGS = {
  claude: "--add-dir* --agent= --agents= --allow-dangerously-skip-permissions --allowedTools* --allowed-tools* --append-system-prompt= --autocompact= --bare --betas* --brief --chrome -c --continue --dangerously-skip-permissions -d= --debug= --debug-file= --disable-slash-commands --disallowedTools* --disallowed-tools* --effort= --exclude-dynamic-system-prompt-sections --fallback-model= --file= --fork-session --ide --input-format= --json-schema= --max-budget-usd= --mcp-config* --model= -n= --name= --no-chrome --no-session-persistence --output-format= --permission-mode= --plugin-dir= -p --print -r= --resume= --session-id= --setting-sources= --settings= --strict-mcp-config --system-prompt= --tools* --verbose -w --worktree",
  codex: "-c= --config= --enable= --disable= --strict-config -i* --image* -m= --model= --oss --local-provider= -p= --profile= -s= --sandbox= --approve-for-me --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust -C= --cd= --worktree --add-dir= -a= --ask-for-approval= --search --no-alt-screen --no-daemon",
  pi: "--provider= --model= --api-key= --system-prompt= --append-system-prompt= --mode= -p --print -c --continue -r --resume --session= --session-id= --fork= --session-dir= --no-session -n= --name= --models= --no-tools -t= --tools= -xt= --exclude-tools= --thinking= -e= --extension= --no-extensions --no-mcp --skill= --no-skills --prompt-template= --no-prompt-templates --theme= --no-themes --no-context-files --export= --list-models --verbose --approve --no-approve --offline",
  agy: "--add-dir= --agent= -c --continue --conversation= --dangerously-skip-permissions --disable-slash-commands --effort= -i= --input-format= --json-schema= --log-file= --mode= --model= --new-project --output-format= -p --print --print-timeout= --project= --prompt --prompt-interactive= --remote-agent --remote-control --sandbox --settings=",
  opencode: "--print-logs --log-level= --pure --port= --hostname= --mdns --mdns-domain= --cors= -m= --model= -c --continue -s= --session= --fork --prompt= --agent= --auto --mini --no-replay --replay-limit=",
  grok: "--agent= --agents= --allow= --always-approve -c --continue --cwd= --debug --debug-file= --deny= --disable-web-search --disallowed-tools= --fork-session --fullscreen --include-partial-messages --json-schema= -m= --model= --max-turns= --minimal --no-alt-screen --no-plan --no-subagents --output-format= -p= --single= --permission-mode= --prompt-file= -r= --resume= --reasoning-effort= --effort= --restore-code --rules= -s= --session-id= --sandbox= --system-prompt-override= --tools= --verbatim -w= --worktree= --worktree-ref=",
  gemini: "-d --debug -m= --model= -p= --prompt= -i= --prompt-interactive= -s --sandbox -y --yolo --approval-mode= --allowed-mcp-server-names= --allowed-tools= -e= --extensions= -r= --resume= --include-directories= --screen-reader -o= --output-format=",
};
const flagsOf = (program) => new Map((FLAGS[program] ?? "").split(" ").filter(Boolean).map((f) => (/[=*]$/.test(f) ? [f.slice(0, -1), f.slice(-1)] : [f, ""])));

const base = (p) => p.replace(/\/+$/, "").split("/").pop();
const LAUNCHER = "herdr-ws-agent";

// A shell line as words (quotes and backslashes as sh reads them).
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
// And back: a word as is when plain, else single-quoted.
export const shellWord = (w) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`);
export const joinWords = (ws) => ws.map(shellWord).join(" ");

// Where an argv's program word is: past `env`, VAR=x, and herdr-ws-agent with its --instructions FILE.
function programAt(argv) {
  let i = 0;
  if (argv[i] === "env") i++;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  const launcher = base(argv[i] ?? "") === LAUNCHER ? i : -1;
  if (launcher >= 0) {
    i++;
    while (argv[i] === "--instructions") i += 2;
  }
  return { at: i, launcher };
}
// The agent an argv runs.
export function programOf(argv) {
  return base(argv[programAt(argv).at] ?? "");
}

// A flag's value in the words (`--model x` or `--model=x`), null when absent.
export function flagValue(ws, names) {
  for (let i = 0; i < ws.length; i++) {
    if (names.includes(ws[i])) return ws[i + 1] ?? "";
    const long = names.find((n) => n.startsWith("--") && ws[i].startsWith(`${n}=`));
    if (long) return ws[i].slice(long.length + 1);
  }
  return null;
}
// The same for a `-c key="value"` config override (Codex).
export function configValue(ws, key) {
  for (let i = 0; i < ws.length - 1; i++) {
    if ((ws[i] === "-c" || ws[i] === "--config") && ws[i + 1].startsWith(`${key}=`)) return ws[i + 1].slice(key.length + 1).replace(/^"|"$/g, "");
  }
  return null;
}
// What a command already sets: { model, effort }, each null when it doesn't.
export function knobsIn(argv) {
  const k = KNOBS[programOf(argv)];
  if (!k) return { model: null, effort: null };
  const effort = !k.effort ? null : k.effort.flag ? flagValue(argv, [k.effort.flag]) : configValue(argv, k.effort.config);
  return { model: flagValue(argv, k.model), effort };
}

// The words without a flag (`--model x`, `--model=x`), then with it at the end
// unless value is empty (the agent's default).
export function withFlag(ws, names, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if (names.includes(ws[i])) { i++; continue; }
    if (names.some((n) => n.startsWith("--") && ws[i].startsWith(`${n}=`))) continue;
    out.push(ws[i]);
  }
  return value ? [...out, names[0], value] : out;
}
// The same for a `-c key="value"` config override (Codex).
export function withConfig(ws, key, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if ((ws[i] === "-c" || ws[i] === "--config") && ws[i + 1]?.startsWith(`${key}=`)) { i++; continue; }
    out.push(ws[i]);
  }
  return value ? [...out, "-c", `${key}="${value}"`] : out;
}
// The words with an effort level set (or, "", taken out), as the agent takes it.
export function withEffort(ws, effort, level) {
  return effort.flag ? withFlag(ws, [effort.flag], level) : withConfig(ws, effort.config, level);
}

// argv with the automation's model and effort in place of the preset's, when its agent takes them.
export function withKnobs(argv, model, effort) {
  const k = KNOBS[programOf(argv)];
  if (!k) return argv;
  let out = argv;
  if (model) out = withFlag(out, k.model, model);
  if (effort && k.effort) out = withEffort(out, k.effort, effort);
  return out;
}

// A command switched to another agent: `run` is that agent's argv as the + menu starts
// it (["herdr-ws-agent", "pi"], ["opencode"]). Kept: env and VAR=x in front, the launcher
// (it was there or the new agent's run has it), the new run's own words, and every other
// word unless the old agent has that flag and the new one hasn't (or takes it
// differently). The old agent's model and effort never carry over. Returns
// { argv, dropped }: dropped is the words left out, for a note.
export function swapProgram(argv, run) {
  const old = programAt(argv);
  const oldProgram = base(argv[old.at] ?? "");
  const runAt = base(run[0] ?? "") === LAUNCHER ? 1 : 0;
  const newWord = run[runAt];
  if (!newWord) return { argv, dropped: [] };
  const newProgram = base(newWord);
  if (oldProgram === newProgram) return { argv, dropped: [] };
  const front = argv.slice(0, old.launcher >= 0 ? old.launcher : old.at);
  const launcher = old.launcher >= 0 ? argv.slice(old.launcher, old.at) : runAt ? [run[0]] : [];
  const rest = argv.slice(old.at + 1);
  const was = flagsOf(oldProgram), now = flagsOf(newProgram);
  const k = KNOBS[oldProgram];
  const knob = (name, next) => Boolean(k) && (k.model.includes(name) || name === k.effort?.flag
    || (Boolean(k.effort?.config) && (name === "-c" || name === "--config") && String(next ?? "").startsWith(`${k.effort.config}=`)));
  const kept = [], dropped = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (!/^-./.test(w) || w === "--") { kept.push(w); continue; }
    const eq = w.startsWith("--") && w.includes("=");
    const name = eq ? w.slice(0, w.indexOf("=")) : w;
    const kind = was.get(name);
    let n = 0;
    if (!eq && kind === "=") n = i + 1 < rest.length ? 1 : 0;
    if (!eq && kind === "*") while (i + 1 + n < rest.length && !/^-./.test(rest[i + 1 + n])) n++;
    const group = rest.slice(i, i + 1 + n);
    const goes = knob(name, rest[i + 1]) || (kind !== undefined && now.get(name) !== kind);
    (goes ? dropped : kept).push(...group);
    i += n;
  }
  const own = run.slice(runAt + 1).filter((w) => !kept.includes(w));
  return { argv: [...front, ...launcher, newWord, ...own, ...kept], dropped };
}

// --- The models each agent offers ---

// Codex's model names in ~/.codex/config.toml: its default and any profile's.
export function configModels(text) {
  return [...new Set([...String(text ?? "").matchAll(/^\s*model\s*=\s*"([^"]+)"/gm)].map((m) => m[1]))];
}

// Codex's catalog (`codex debug models`, or the slug and visibility lines out of it):
// the slugs in its order, without the ones it hides from its own picker.
export function codexCatalog(text) {
  const all = [];
  for (const m of String(text ?? "").matchAll(/"(slug|visibility)"\s*:\s*"([^"]*)"/g)) {
    if (m[1] === "slug") all.push({ slug: m[2], hide: false });
    else if (all.length && m[2] === "hide") all[all.length - 1].hide = true;
  }
  return [...new Set(all.filter((m) => !m.hide && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(m.slug)).map((m) => m.slug))];
}

// Pi's `--list-models`: a table (provider, model, context, …) under a header line;
// each row whose context is a size, as provider/model, which --model takes.
export function piModels(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const [provider, model, context] = line.trim().split(/\s+/);
    if (!/^\d/.test(context ?? "") || !/^[A-Za-z0-9][\w.-]*$/.test(provider) || !/^[A-Za-z0-9][\w.:/@-]*$/.test(model)) continue;
    const id = `${provider}/${model}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// Antigravity's model families, out of `agy models` ("<id>\t<name>" a line): each id
// without the level --effort sets (gemini-4-neon-high -> gemini-4-neon). An id with no
// level (an orchestrator) is left out: it can't take --effort.
export function agyFamilies(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const id = /^([A-Za-z0-9][A-Za-z0-9._-]*)\t/.exec(line)?.[1];
    const family = id ? /^(.+)-(?:minimal|low|medium|high|xhigh|max)$/.exec(id)?.[1] : null;
    if (family && !out.includes(family)) out.push(family);
  }
  return out;
}

// OpenCode's `opencode models`: one provider/model a line.
export function opencodeModels(text) {
  return [...new Set(String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.:/@-]*$/.test(l)))];
}

// Grok's `grok models`: "  * grok-4.6 (default)" and "  - grok-4.5" lines, the default first.
export function grokModels(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*([*-])\s+([A-Za-z0-9][\w.:/@-]*)/.exec(line);
    if (m && !out.includes(m[2])) (m[1] === "*" ? out.unshift(m[2]) : out.push(m[2]));
  }
  return out;
}

// The programs that can list their models.
export const listable = () => Object.keys(KNOBS).filter((p) => KNOBS[p].list);

// What a list lookup kept: ~/.herdr/cache/models-<program>.json ({ at, models, missing }),
// and for agy the older agy-models.json when there's no new one yet. `text` is the new
// file's own text (null: none yet), so a lookup can replace it.
const cacheFile = (io, program) => `${io.home()}/.herdr/cache/models-${program}.json`;
export async function keptModels(io, program) {
  const read = (f) => Promise.resolve(io.readTextFile(f)).catch(() => null);
  const text = await read(cacheFile(io, program));
  let kept = null;
  try { kept = JSON.parse(text ?? (program === "agy" ? await read(`${io.home()}/.herdr/cache/agy-models.json`) : null)); } catch { kept = null; }
  const models = Array.isArray(kept?.models) ? kept.models.filter((m) => typeof m === "string") : [];
  return { models, at: Number(kept?.at) || 0, missing: kept?.missing === true, text: text ?? null };
}

// The models to offer for a program, asked of the program itself and kept for a day
// (also that it isn't installed). It runs through your login shell, where the CLI is on
// PATH even when Herdr was started from the Dock; -lic when -lc doesn't find it. A
// failed lookup keeps what was kept. `io`: { exec, readTextFile, writeTextFile, home }.
export const MODELS_KEPT = 86400e3;
export async function listModels(io, program, now = Date.now()) {
  const list = KNOBS[program]?.list;
  if (!list) return [];
  const kept = await keptModels(io, program);
  if (kept.at && now - kept.at < MODELS_KEPT) return kept.models;
  const save = (models, missing) => Promise.resolve(io.writeTextFile(cacheFile(io, program), JSON.stringify({ at: now, models, ...(missing ? { missing } : {}) }), kept.text)).catch(() => {});
  const line = `command -v ${program} >/dev/null 2>&1 || exit 127; ${program} ${list.args}`;
  let missing = false;
  for (const flags of ["-lc", "-lic"]) {
    const r = await Promise.resolve(io.exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" "$1" "$2"', "sh", flags, line], { timeout: 30000 })).catch(() => null);
    const models = list.parse(r?.stdout);
    if (models.length) { await save(models, false); return models; }
    missing = r?.code === 127;
  }
  if (missing) { await save([], true); return []; }
  return kept.models;
}

// Which model chips to show: all of a short list; of a long one (Pi and OpenCode list
// a hundred or more) the ones matching what's typed in the model box, and the one set.
// Returns { shown, more }: more is how many are left out.
export function shownModels(models, typed, current, max = 12) {
  const q = String(typed ?? "").trim().toLowerCase();
  if (models.length <= max) return { shown: models, more: 0 };
  const hits = q ? models.filter((m) => m.toLowerCase().includes(q)) : [];
  const shown = [...new Set([...(current && models.includes(current) ? [current] : []), ...hits.slice(0, max)])];
  return { shown, more: q ? Math.max(0, hits.length - max) : models.length - shown.length };
}

// For the automation drafter: each agent's models and effort levels, in words, from the
// table and what the agents listed (`listed`: program -> models). Long lists are cut.
export function knobsText(listed = {}, max = 30) {
  return Object.entries(KNOBS).map(([p, k]) => {
    const models = [...new Set([...k.models, ...(listed[p] ?? [])])];
    const m = !models.length ? "any model name it takes" : models.length > max ? `${models.slice(0, max).join(", ")} and ${models.length - max} more` : models.join(", ");
    const e = k.effort ? `effort ${k.effort.levels.join(", ")}` : "no effort";
    return `${p}: models ${m}; ${e}`;
  }).join("\n");
}
