// Which agents the + menu shows, as rules with no imports so node can test them. A copy
// is in ws-new-menu (the menu) and ws-presets (its "Agents in the + menu" pane); keep
// them equal (scripts/sync-from-home.sh checks).
//
// The owner's list is ~/.herdr/agent-menu.json, { "hidden": ["gemini", "cursor"] }:
// program keys as knownAgents() gives them, one list for every machine. No file means
// nothing hidden. Other keys in the file are kept when it's written.
// Shared "new-menu.hidden" holds the same list, so the menu's first draw already
// leaves them out (readTextFile is async).
//
// An agent here is a knownAgents() entry: { key, name, installed, run, icon, tint }.

export const HIDDEN = "new-menu.hidden";
export const hiddenFile = (home) => `${home}/.herdr/agent-menu.json`;

// The hidden keys in the file's text: [] for no file, a broken one or a wrong shape.
export function parseHidden(text) {
  const obj = readObject(text);
  const list = Array.isArray(obj?.hidden) ? obj.hidden : [];
  return [...new Set(list.filter((k) => typeof k === "string" && k))];
}

// The file's text as an object; null when absent or not a JSON object.
function readObject(text) {
  if (text === null || text === undefined || !String(text).trim()) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// The file's new text with `key` hidden (hide true) or shown again. Throws on a file
// that isn't a JSON object, so a hand edit with a typo isn't written over.
export function withHidden(text, key, hide) {
  const absent = text === null || text === undefined || !String(text).trim();
  const obj = absent ? {} : readObject(text);
  if (!obj) throw new Error("it isn't a JSON object; fix or delete it");
  const now = parseHidden(text).filter((k) => k !== key);
  return `${JSON.stringify({ ...obj, hidden: hide ? [...now, key] : now }, null, 2)}\n`;
}

// Hides `key` (hide true) or shows it again in the file, read fresh first so a change
// made meanwhile isn't lost (writeTextFile only replaces the text it's told is there);
// once more when the file changed between the read and the write. Resolves with the
// new list. `io`: { home, readTextFile, writeTextFile }.
export async function saveHidden(io, key, hide) {
  const file = hiddenFile(io.home());
  for (let tries = 0; ; tries++) {
    const text = await io.readTextFile(file);
    const next = withHidden(text, key, hide);
    try {
      await io.writeTextFile(file, next, text ?? null);
      return parseHidden(next);
    } catch (e) {
      if (tries >= 1) throw e;
    }
  }
}

// What the menu lists: installed and not hidden, in knownAgents()'s order.
export const shownAgents = (agents, hidden) =>
  (agents ?? []).filter((a) => a.installed && !(hidden ?? []).includes(a.key));

// What number key n (0-based) starts: { agent } or { preset } or null.
export function keyTarget(n, shown, presets) {
  if (n < 0 || n > 8) return null;
  if (n < shown.length) return { agent: shown[n] };
  const p = presets[n - shown.length];
  return p ? { preset: p } : null;
}

// The pane's count line: "6 of 8 shown".
export function countLine(agents, hidden) {
  const installed = (agents ?? []).filter((a) => a.installed);
  return `${shownAgents(installed, hidden).length} of ${installed.length} shown`;
}

// The note under the pane's switches: "Not installed: copilot, amp." or "" for none.
export function notInstalledLine(agents) {
  const names = (agents ?? []).filter((a) => !a.installed).map((a) => a.key);
  return names.length ? `Not installed: ${names.join(", ")}.` : "";
}
