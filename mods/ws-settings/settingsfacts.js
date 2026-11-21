// The package's own settings, ~/.herdr/settings.jsonc, as rules with no imports so
// node can test them. Herdr's settings are its own (~/.config/herdr-app/settings.json);
// these are the Workspaces package's: for now its experimental features, each off
// until turned on in the Settings window's Experimental section (ws-settings) or in the file.
// Copied in ws-settings (the screen) and ws-agents (which reads it); change both together.

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

// The file as first written: every setting with what it does above it.
export function starter(values = {}) {
  const lines = EXPERIMENTS.map((e) => [
    ...wrap(`${e.title}: ${lowerFirst(e.what)}`, "    // "),
    ...wrap(`Experimental because ${lowerFirst(e.why)}`, "    // "),
    `    // RECIPE.md: "${e.recipe}".`,
    `    "${e.key}": ${values[e.key] === true}`,
  ].join("\n"));
  return `// Workspaces settings: the package's own (Herdr's are in ~/.config/herdr-app/settings.json).
// Settings > Experimental (the sidebar footer's Settings) changes them; you can edit them here too.
{
  // Off until you turn them on. Each says what it does and why it's experimental.
  "experimental": {
${lines.join(",\n\n")}
  }
}
`;
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

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

// The settings: { experimental: { <key>: true|false } } with every experiment present
// (off unless the file says true), and `error` when the file can't be read as JSONC.
export function parseSettings(text) {
  const experimental = Object.fromEntries(EXPERIMENTS.map((e) => [e.key, false]));
  if (text == null || !String(text).trim()) return { experimental };
  try {
    const raw = JSON.parse(stripJsonc(String(text)));
    for (const e of EXPERIMENTS) experimental[e.key] = raw?.experimental?.[e.key] === true;
    return { experimental };
  } catch (err) {
    return { experimental, error: String(err?.message ?? err) };
  }
}

export const experimentOn = (settings, key) => settings?.experimental?.[key] === true;

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
