// An automation's `model:` and `effort:` lines: how each agent takes them, and
// the agent's command with them set. The same file is in mods/ws-switcher (the
// runner) and mods/ws-automations (the screen), because mods can't import across
// folders: change both (scripts/sync-from-home.sh checks they match). The Presets
// screen (ws-presets) has its own copy of the table.

// The models to offer (Codex's come from ~/.codex/config.toml) and the effort levels.
export const KNOBS = {
  claude: { model: ["--model"], models: ["fable", "opus", "sonnet", "haiku"], effort: { flag: "--effort", levels: ["low", "medium", "high", "xhigh", "max"] } },
  codex: { model: ["--model", "-m"], models: [], effort: { config: "model_reasoning_effort", levels: ["minimal", "low", "medium", "high", "xhigh", "max"] } },
  pi: { model: ["--model"], models: [], effort: { flag: "--thinking", levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] } },
};

const base = (p) => p.replace(/\/+$/, "").split("/").pop();

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

// The agent an argv runs: past `env`, VAR=x, and herdr-ws-agent with its --instructions FILE.
export function programOf(argv) {
  let i = 0;
  if (argv[i] === "env") i++;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  if (base(argv[i] ?? "") === "herdr-ws-agent") {
    i++;
    while (argv[i] === "--instructions") i += 2;
  }
  return base(argv[i] ?? "");
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
  return { model: flagValue(argv, k.model), effort: k.effort.flag ? flagValue(argv, [k.effort.flag]) : configValue(argv, k.effort.config) };
}

// The words without a flag (`--model x`, `--model=x`), then with it at the end.
function withFlag(ws, names, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if (names.includes(ws[i])) { i++; continue; }
    if (names.some((n) => n.startsWith("--") && ws[i].startsWith(`${n}=`))) continue;
    out.push(ws[i]);
  }
  return [...out, names[0], value];
}
// The same for a `-c key="value"` config override (Codex).
function withConfig(ws, key, value) {
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if ((ws[i] === "-c" || ws[i] === "--config") && ws[i + 1]?.startsWith(`${key}=`)) { i++; continue; }
    out.push(ws[i]);
  }
  return [...out, "-c", `${key}="${value}"`];
}

// argv with the automation's model and effort in place of the preset's, when its agent takes them.
export function withKnobs(argv, model, effort) {
  const k = KNOBS[programOf(argv)];
  if (!k) return argv;
  let out = argv;
  if (model) out = withFlag(out, k.model, model);
  if (effort) out = k.effort.flag ? withFlag(out, [k.effort.flag], effort) : withConfig(out, k.effort.config, effort);
  return out;
}
