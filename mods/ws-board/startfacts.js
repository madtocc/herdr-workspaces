// Start with… on a card, as rules with no imports, so `node` can test them (main.js
// draws the dialog and starts it through the board's own start()).
//
// The dialog offers the workspace's presets, then the installed agents; a pick is
// "preset:<name>" or "agent:<key>". Start hands the board's start() an `over`
// ({ name, kind, folder, text }) that replaces what the card itself would give:
// who runs it, where, and its first message. Nothing is written to the card's own
// agent: and folder: fields.

// The program a command line runs, past `env`, VAR=x and the launcher.
export function programOf(argv) {
  let i = argv[0] === "env" ? 1 : 0;
  while (argv[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  const base = (w) => String(w ?? "").split(/[\\/]/).pop();
  if (base(argv[i]) === "herdr-ws-agent") i++;
  return base(argv[i]);
}

// The dialog's agent chips: presets (as the board starts them, a workspace's own first),
// then each installed agent once.
export function startChoices(presets, agents) {
  const out = presets.map((p) => ({ id: `preset:${p.name}`, kind: "preset", name: p.name, tip: p.description || p.command || "" }));
  const seen = new Set();
  for (const a of agents ?? []) {
    if (!a?.key || a.installed === false || seen.has(a.key)) continue;
    seen.add(a.key);
    out.push({ id: `agent:${a.key}`, kind: "agent", name: a.key, label: a.name || a.key, tip: (a.run ?? []).join(" ") });
  }
  return out;
}

// What the dialog picks at first: whoever the card's Start would run (a preset of that
// name first, as start() looks it up, else the installed agent of that key), else the first.
export function firstPick(choices, name) {
  return (choices.find((c) => c.kind === "preset" && c.name === name) ?? choices.find((c) => c.kind === "agent" && c.name === name) ?? choices[0] ?? null)?.id ?? null;
}

// The overrides for start(): a pick, a folder (an absolute path) and the edited text.
export function overOf(choices, pick, folder, text) {
  const c = choices.find((x) => x.id === pick);
  if (!c || !folder) return null;
  return { name: c.name, kind: c.kind, folder, text: String(text ?? "") };
}

// Who start() runs and where: the card's own (`name`, `folder`) unless `over` says.
// A preset is looked up by name unless the pick was the plain agent.
export function whoStarts(over, name, folder) {
  if (!over) return { name, folder, preset: true };
  return { name: over.name, folder: over.folder, preset: over.kind !== "agent" };
}

// The first message as an agent gets it. An agent started without the launcher gets it
// as Herdr's task, after its command line, where a message starting with "-" could be
// read as an option: that one starts with the card's id and title instead.
export function firstMessage(text, task) {
  const s = String(text ?? "");
  return /^\s*-/.test(s) ? `${task.id}: ${task.title}\n\n${s}` : s;
}

// A card's Worktree button says "Start in worktree" when its column is this wide or more
// (px, the mod's units): room for Start, Start in worktree and Start with… on one line.
export const WIDE_COLUMN = 290;
// A column's width on the board: the columns share the board's width (`width`, already
// divided by the zoom) after its 12px padding, 10px gaps and a folded last column's 96px
// strip; squeezed, each keeps COL_MIN (200). 0 while the width isn't known yet.
export function columnWidth({ width, columns, folded, squeezed, min = 200 }) {
  if (squeezed) return min;
  if (!(width > 0) || !(columns > 0)) return 0;
  const open = columns - (folded ? 1 : 0);
  if (open < 1) return 0;
  return (width - 24 - 10 * (columns - 1) - (folded ? 96 : 0)) / open;
}

// The task dialog's Agent chips, [value, label]: Default, the presets, then the installed
// agents (as Start with… lists them, by their key, which is what `agent:` holds), and the
// card's own agent when it's none of those, as one more, so the dialog shows what Start runs.
export function agentChips(presets, agents, own) {
  const out = [["", "Default"]];
  const seen = new Set([""]);
  for (const c of startChoices(presets, agents)) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push([c.name, c.name]);
  }
  if (own && !seen.has(own)) out.push([own, own]);
  return out;
}

// The task dialog's Folder chips, [value, label], with the card's own folder as one more
// when it isn't one of them (a subfolder, or a path outside the workspace): its value as
// written, a full path from `~`. `place` turns a value into the folder it names, so a card
// whose folder is written another way (its full path) still lights the chip it names.
export function folderChips(chips, own, tilde = (p) => p, place = (v) => v) {
  if (!own || chips.some(([v]) => v === own || place(v) === place(own))) return chips;
  return [...chips, [own, own.startsWith("/") ? tilde(own) : own]];
}
