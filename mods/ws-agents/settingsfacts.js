// The package's own settings, ~/.herdr/settings.jsonc, as rules with no imports so
// node can test them. Herdr's settings are its own (~/.config/herdr-app/settings.json);
// these are the Workspaces package's: for now its experimental features, each off
// until turned on in the Settings window's Experimental section (ws-settings) or in the file.
// And which of the package's add-ons are on (Settings > Features), each on until turned off.
// Copied in ws-settings (the screen), ws-agents (which reads it into shared "workspaces.settings"
// for the mods that only draw), ws-switcher (its runners, in the sidebar and the background
// runner) and ws-status (its timed usage asks); change them together.

export const SETTINGS_FILE = ".herdr/settings.jsonc"; // under home

// Each experiment: its key in "experimental", and what Experimental and the file say about it.
export const EXPERIMENTS = [
  {
    key: "antigravity-wipe",
    title: "Wipe Antigravity conversations",
    what: "Adds Wipe session… to an Antigravity agent's right-click menu in the Agents list: it closes the agent, takes the conversation out of Antigravity's own lists and moves its files into ~/.herdr/trash, so History and Antigravity's /resume no longer show it.",
    why: "It edits Antigravity's own index files (conversation_summaries.db, jetbox_summaries_proto.pb, cache/*.json, history.jsonl), whose format isn't documented: an Antigravity update could change them. It refuses what it can't read, keeps a copy in ~/.herdr/trash first, and waits while another Antigravity runs.",
    recipe: "Right-click an agent for its menu",
  },
];

// The package's add-ons Settings > Features can turn off: each one's key in "features". All on
// unless the file says false (a missing key, a missing file and a file that isn't JSONC are on).
// Off hides the add-on everywhere and stops its background work; nothing is deleted.
// board: the Board tab and button, pull request follow-through, GitHub board item status.
// notes, worktrees, history: their screens and every way in. automations: none of them run.
// usage: the status bar's plan usage and its timed asks. numbers: model, context and
// compactions on Agents rows and in History.
export const FEATURE_KEYS = ["board", "notes", "worktrees", "history", "automations", "usage", "numbers"];

// What Settings > Features shows for each add-on, in FEATURE_KEYS' order: its group, title, what
// it adds, and the line shown only while it's off (Automations' off line and its count while
// on come from automationsLine()). The file's starter uses the titles and what they add too.
export const FEATURES = [
  { key: "board", group: "Screens", title: "Board",
    what: "Cards for each workspace in a Board tab, with Start, pull request follow-through and the GitHub project view.",
    off: "Off: Board is gone from the tab bar's Views menu, and Notes can't move a note to the board. Cards stay in each workspace's tasks folder." },
  { key: "notes", group: "Screens", title: "Notes",
    what: "Quick notes for each workspace, from the tab bar's Views menu.",
    off: "Off: Notes is gone from the Views menu. Notes stay in each workspace's notes folder." },
  { key: "worktrees", group: "Screens", title: "Worktrees",
    what: "Every repo's worktrees in a Worktrees tab, with cleanup and setup scripts.",
    off: "Off: Worktrees is gone from the Views menu. Worktrees and setup scripts stay as they are." },
  { key: "history", group: "Screens", title: "History",
    what: "Every agent's past conversations and automation runs, with Resume.",
    off: "Off: History is gone from the Views menu. Agents keep their own history." },
  { key: "automations", group: "Screens", title: "Automations",
    what: "Agents that run on a schedule or when something happens, such as a card moving or a pull request opening.",
    off: null },
  { key: "usage", group: "Status bar and agent rows", title: "Plan usage",
    what: "Claude's and Antigravity's plan limits at the right of the status bar, asked from each agent every 10 minutes.",
    off: "Off: nothing is asked." },
  { key: "numbers", group: "Status bar and agent rows", title: "Agent numbers",
    what: "The model, how full the context is and how often it was compacted, on each agent's row and in History.",
    off: "Off: agent rows show the name and status only." },
];

// The comment above "features" in the file, so someone who opens it knows what the block is.
const FEATURES_NOTE = [
  "  // The package's add-ons (Settings > Features), each on unless it's false here. Off hides it",
  "  // everywhere and stops its background work; nothing is deleted, so true brings it back.",
];

// The file as first written: every setting with what it does above it. values: the
// experiments' (off unless true); features: the add-ons' (on unless false).
export function starter(values = {}, features = {}) {
  const lines = EXPERIMENTS.map((e) => [
    ...wrap(`${e.title}: ${lowerFirst(e.what)}`, "    // "),
    ...wrap(`Experimental because ${lowerFirst(e.why)}`, "    // "),
    `    // RECIPE.md: "${e.recipe}".`,
    `    "${e.key}": ${values[e.key] === true}`,
  ].join("\n"));
  const feats = FEATURES.map((f) => [
    ...wrap(`${f.title}: ${lowerName(f.what)}`, "    // "),
    `    "${f.key}": ${features[f.key] !== false}`,
  ].join("\n"));
  return `// Workspaces settings: the package's own (Herdr's are in ~/.config/herdr-app/settings.json).
// Settings > Features and Settings > Experimental (the sidebar footer's Settings) change them;
// you can edit them here too.
{
${FEATURES_NOTE.join("\n")}
  "features": {
${feats.join(",\n")}
  },

  // Off until you turn them on. Each says what it does and why it's experimental.
  "experimental": {
${lines.join(",\n\n")}
  }
}
`;
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
// The same, but a sentence that starts with a name ("Claude's and Antigravity's plan limits") keeps it.
const lowerName = (s) => (/^(Claude|Antigravity|Herdr|GitHub|Codex|Pi)\b/.test(s) ? s : lowerFirst(s));

// Words to lines of at most 88 characters, each starting with `lead`.
function wrap(text, lead) {
  const out = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (line && (lead + line + " " + w).length > 88) { out.push(lead + line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(lead + line);
  return out;
}

// The text with its comments blanked out (each character a space, line ends kept), so a
// match in it is at the same place in the text and never inside a comment.
function blankComments(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      // A line comment ends before its line end, a block comment after its */ (or at the end).
      const line = text[i + 1] === "/";
      const at = line ? text.indexOf("\n", i) : text.indexOf("*/", i + 2);
      const stop = at < 0 ? text.length : line ? at : at + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else out += c;
  }
  return out;
}

// The text without comments and trailing commas, strings left as they are.
function stripJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// The settings: { experimental: { <key>: true|false }, features: { <key>: true|false } } with
// every experiment present (off unless the file says true) and every feature present (on
// unless the file says false), and `error` when the file can't be read as JSONC (then the
// experiments are off and the features on).
export function parseSettings(text) {
  const experimental = Object.fromEntries(EXPERIMENTS.map((e) => [e.key, false]));
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
  if (text == null || !String(text).trim()) return { experimental, features };
  try {
    const raw = JSON.parse(stripJsonc(String(text)));
    for (const e of EXPERIMENTS) experimental[e.key] = raw?.experimental?.[e.key] === true;
    for (const k of FEATURE_KEYS) features[k] = raw?.features?.[k] !== false;
    return { experimental, features };
  } catch (err) {
    return { experimental, features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])), error: String(err?.message ?? err) };
  }
}

export const experimentOn = (settings, key) => settings?.experimental?.[key] === true;

// Whether an add-on is on, for parseSettings()' result or shared "workspaces.settings"
// (nothing known yet counts as on).
export const featureOn = (settings, key) => settings?.features?.[key] !== false;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The file's text with one experiment turned on or off, its comments kept. A file
// without the key gets it at the top of "experimental"; no file (or one that isn't
// JSONC) gets the starter. Null when the text can't be changed safely.
export function withExperiment(text, key, on) {
  if (!EXPERIMENTS.some((e) => e.key === key)) return null;
  if (text == null || !String(text).trim()) return starter({ [key]: on });
  const s = String(text);
  if (parseSettings(s).error) return null;
  // The setting itself, not a mention of it in a comment.
  const has = new RegExp(`("${esc(key)}"\\s*:\\s*)(true|false)`).exec(blankComments(s));
  if (has) return s.slice(0, has.index) + has[1] + on + s.slice(has.index + has[0].length);
  const block = /"experimental"\s*:\s*\{/.exec(s);
  if (block) {
    const at = block.index + block[0].length;
    const rest = s.slice(at);
    const empty = /^\s*\}/.test(rest);
    return `${s.slice(0, at)}\n    "${key}": ${on}${empty ? "\n  " : ","}${rest}`;
  }
  const open = s.indexOf("{");
  if (open < 0) return null;
  const rest = s.slice(open + 1);
  const empty = /^\s*\}/.test(rest);
  return `${s.slice(0, open + 1)}\n  "experimental": {\n    "${key}": ${on}\n  }${empty ? "\n" : ","}${rest}`;
}

// --- features: writing a switch, and the automations count Features shows ---

// The text's top-level "features" object as [open, close] (the indexes of its { and }) in the
// comment-blanked text, null when there's none, or "other" when "features" isn't an object.
function featuresBlock(b) {
  let depth = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === '"') {
      let j = i + 1;
      while (j < b.length && b[j] !== '"') j += b[j] === "\\" ? 2 : 1;
      if (depth === 1 && b.slice(i, j + 1) === '"features"') {
        const m = /^\s*:\s*/.exec(b.slice(j + 1));
        if (m) {
          const open = j + 1 + m[0].length;
          if (b[open] !== "{") return "other";
          let d = 0;
          for (let k = open; k < b.length; k++) {
            if (b[k] === '"') { k++; while (k < b.length && b[k] !== '"') k += b[k] === "\\" ? 2 : 1; }
            else if (b[k] === "{" || b[k] === "[") d++;
            else if ((b[k] === "}" || b[k] === "]") && --d === 0) return [open, k];
          }
          return "other";
        }
      }
      i = j;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return null;
}

// The file's text with one add-on turned on or off, its comments kept. Only that value
// changes (turned back on it's written as true, not taken out). A file without the key gets
// it at the top of "features", one without "features" gets the block (with a comment saying
// what it is) at the top; no file gets the starter. Turning on one the file doesn't mention
// changes nothing (missing is on). Null when the text can't be changed safely: not JSONC, not
// an object, "features" or the key's value isn't a plain value, or the edit wouldn't read back
// as asked with everything else as it was (a key or a "features" block that's there twice).
export function withFeature(text, key, on) {
  if (!FEATURE_KEYS.includes(key)) return null;
  on = on !== false;
  const next = editFeature(text, key, on);
  if (next == null) return null;
  const was = parseSettings(text), now = parseSettings(next);
  if (now.error || now.features[key] !== on) return null;
  if (FEATURE_KEYS.some((k) => k !== key && now.features[k] !== was.features[k])) return null;
  if (EXPERIMENTS.some((e) => now.experimental[e.key] !== was.experimental[e.key])) return null;
  return next;
}

// withFeature()'s edit, before it's read back.
function editFeature(text, key, on) {
  if (text == null || !String(text).trim()) return starter({}, { [key]: on });
  const s = String(text);
  if (parseSettings(s).error) return null;
  const b = blankComments(s);
  const root = b.search(/\S/);
  if (root < 0 || b[root] !== "{") return null;
  const block = featuresBlock(b);
  if (block === "other") return null;
  if (block) {
    const [open, close] = block;
    // A direct key of "features", at any value (a value that isn't false counts as on).
    const re = new RegExp(`("${esc(key)}"\\s*:\\s*)(true|false|null|-?[0-9][0-9.eE+-]*|"(?:[^"\\\\]|\\\\.)*"|\\{|\\[)`, "g");
    const inner = b.slice(open + 1, close);
    let has = null;
    for (let m; (m = re.exec(inner));) {
      if (depthAt(inner, m.index) === 0) { has = m; break; }
    }
    if (has) {
      // An object or a list there isn't a switch this can set.
      if (has[2] === "{" || has[2] === "[") return null;
      const at = open + 1 + has.index;
      return s.slice(0, at) + has[1] + on + s.slice(at + has[0].length);
    }
    if (on) return s;
    const rest = s.slice(open + 1);
    const empty = /^\s*\}/.test(b.slice(open + 1));
    return `${s.slice(0, open + 1)}\n    "${key}": false${empty ? "\n  " : ","}${rest}`;
  }
  if (on) return s;
  const rest = s.slice(root + 1);
  const empty = /^\s*\}/.test(b.slice(root + 1));
  return `${s.slice(0, root + 1)}\n${FEATURES_NOTE.join("\n")}\n  "features": {\n    "${key}": false\n  }${empty ? "\n" : ","}${rest}`;
}

// How deep `at` is inside nested objects and arrays of the (comment-blanked) text.
function depthAt(b, at) {
  let d = 0;
  for (let i = 0; i < at; i++) {
    if (b[i] === '"') { i++; while (i < at && b[i] !== '"') i += b[i] === "\\" ? 2 : 1; }
    else if (b[i] === "{" || b[i] === "[") d++;
    else if (b[i] === "}" || b[i] === "]") d--;
  }
  return d;
}

// The automations Features counts, from shared "workspaces.automations" (the switcher's runner
// publishes it: { <workspace>: [automation, …] }, each workspace's own then the global ones it
// doesn't replace): the ones that would run (on, and their file reads), a global one once
// however many workspaces have it. workspaces: how many have at least one.
export function automationCount(all) {
  let count = 0;
  const globals = new Set();
  let workspaces = 0;
  for (const autos of Object.values(all && typeof all === "object" ? all : {})) {
    let here = false;
    for (const a of Array.isArray(autos) ? autos : []) {
      if (!a || !a.enabled || a.error) continue;
      here = true;
      if (a.scope === "global") globals.add(a.name);
      else count++;
    }
    if (here) workspaces++;
  }
  return { count: count + globals.size, workspaces };
}

// Automations' line on Features: the count while on (nothing when there are none), and while
// off that none of them run, they're kept and a run already going finishes.
export function automationsLine({ count = 0, workspaces = 0 } = {}, on = true) {
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  if (on) return count ? `${n(count, "automation")} in ${n(workspaces, "workspace")}` : "";
  if (!count) return "Off: automations don't run, including the ones a card or a pull request starts. They're kept, and a run already going finishes.";
  if (count === 1) return "Off: the 1 automation doesn't run, even when a card or a pull request would start it. It's kept, and a run already going finishes.";
  return `Off: none of the ${count} automations run, including the ones a card or a pull request starts. They're kept, and a run already going finishes.`;
}
