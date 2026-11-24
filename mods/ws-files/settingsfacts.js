// The package's own settings, ~/.herdr/settings.jsonc, as rules with no imports so
// node can test them. Herdr's settings are its own (~/.config/herdr-app/settings.json);
// these are the Workspaces package's: for now its experimental features, each off
// until turned on in the Settings window's Experimental section (ws-settings) or in the file.
// And which of the package's add-ons are on (Settings > Features), each on until turned off,
// and Files' defaults (Settings > Files, the "files" block), each today's behaviour until changed.
// Copied in ws-settings (the screen), ws-agents (which reads it into shared "workspaces.settings"
// for the mods that only draw), ws-switcher (its runners, in the sidebar and the background
// runner), ws-status (its timed usage asks) and ws-files (Files and its Cmd-click handler read
// the file themselves, so a change reaches them in seconds); change them together.

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
// compactions on Agents rows and in History. notifications: the tab bar's bell, its list and its log.
export const FEATURE_KEYS = ["board", "notes", "worktrees", "history", "automations", "usage", "numbers", "notifications"];

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
  { key: "notifications", group: "Tab bar", title: "Notifications bell",
    what: "A bell at the right end of the tab bar: what needs you and what finished, in every workspace.",
    off: "Off: the bell is gone and nothing new is kept. What it kept stays in ~/.herdr/notifications.json." },
];

// The comment above "features" in the file, so someone who opens it knows what the block is.
const FEATURES_NOTE = [
  "  // The package's add-ons (Settings > Features), each on unless it's false here. Off hides it",
  "  // everywhere and stops its background work; nothing is deleted, so true brings it back.",
];

// Files' defaults, in Settings > Files' order (its two groups: Viewing, the first three; Opening
// from terminals, the rest): each key in "files", its title and what it does on the page, its
// values (choices: each with its label on the page; "app": an app id or null; "switch": true or
// false) and the default, which is how Files behaved before the setting was there. A missing
// value, or one that isn't one of these, is the default (parseSettings, fileSetting).
// comment: the lines above the key in the file (with the title in front); off: the line the page
// shows while it's "off".
export const FILES_SETTINGS = [
  { key: "markdown", title: "Markdown & SVG open in", type: "choice", default: "preview",
    values: [{ value: "preview", label: "Preview" }, { value: "source", label: "Source" }, { value: "split", label: "Split" }],
    what: "Starting view for Markdown and SVG files. Split falls back to Preview in narrow panes.",
    comment: "what a .md, .mdx, .markdown or .svg file shows when Files opens it, \"preview\", \"source\" or \"split\" (Preview under 640 px wide). Another one picked in Files is kept for that kind of file until this changes." },
  { key: "default-app", title: "Default external app", type: "app", default: null,
    what: "What Open in starts with before you pick an app for a file type.",
    comment: "the app Open in offers for a kind of file before it has remembered one for it. An app id (\"zed\", \"cursor\", \"vscode\", \"app:<bundle id>\"), \"system\" for the system's default app, or null for an installed code editor first (an image viewer for images)." },
  { key: "show-ignored", title: "Show ignored files", type: "switch", default: false,
    what: "Start with gitignored files (or dotfiles outside git) shown in the tree. The eye button still toggles each view.",
    comment: "whether the tree starts with git-ignored files shown (hidden files outside a git repo), true or false. The eye button still shows or hides them in each Files; a change here resets open Files views." },
  { key: "cmd-click", title: "Cmd-click a file path", type: "choice", default: "beside",
    values: [{ value: "beside", label: "Beside" }, { value: "full", label: "Full size" }, { value: "off", label: "Off" }],
    what: "Where a file or folder Cmd-clicked in a terminal or agent opens.",
    off: "Off: Herdr hands Cmd-clicked paths to macOS as before.",
    comment: "where a path Cmd-clicked in a terminal opens, \"beside\" the terminal (full size for a terminal on another machine), \"full\" in Files full size, or \"off\" to leave it to Herdr and the system's opener, as without Files." },
  { key: "catch", title: "Files to catch", type: "choice", default: "text-images-folders",
    values: [{ value: "text-images-folders", label: "Text, images & folders" }, { value: "everything", label: "Everything" }],
    what: "Which Cmd-clicked paths open in Files instead of macOS.",
    comment: "which Cmd-clicked paths Files takes, \"text-images-folders\" (text, code, Markdown, SVG, images and folders; other files go to the system's opener) or \"everything\" (every file and folder that's there, binaries shown as Binary). A path that isn't there always goes on. Not used while \"cmd-click\" is \"off\"." },
];
export const FILES_KEYS = FILES_SETTINGS.map((f) => f.key);
export const FILES_DEFAULTS = Object.fromEntries(FILES_SETTINGS.map((f) => [f.key, f.default]));

// Editors with a command line, as Files' Open in knows them: a copy of ws-files' filesfacts.js
// EDITOR_CATALOG (keep them the same), so Settings > Files offers the same ids.
export const EDITOR_CATALOG = [
  { id: "zed", label: "Zed", binary: "zed", bundle: "dev.zed.Zed", lineStyle: "colon" },
  { id: "cursor", label: "Cursor", binary: "cursor", bundle: "com.todesktop.230313mzl4w4u92", lineStyle: "goto" },
  { id: "vscode", label: "VS Code", binary: "code", bundle: "com.microsoft.VSCode", lineStyle: "goto" },
  { id: "vscode-insiders", label: "VS Code Insiders", binary: "code-insiders", bundle: "com.microsoft.VSCodeInsiders", lineStyle: "goto" },
  { id: "windsurf", label: "Windsurf", binary: "windsurf", bundle: "com.exafunction.windsurf", lineStyle: "goto" },
  { id: "sublime", label: "Sublime Text", binary: "subl", bundle: "com.sublimetext.4", lineStyle: "colon" },
  { id: "idea", label: "IntelliJ IDEA", binary: "idea", bundle: "com.jetbrains.intellij", lineStyle: "line" },
  { id: "webstorm", label: "WebStorm", binary: "webstorm", bundle: "com.jetbrains.WebStorm", lineStyle: "line" },
  { id: "goland", label: "GoLand", binary: "goland", bundle: "com.jetbrains.goland", lineStyle: "line" },
  { id: "pycharm", label: "PyCharm", binary: "pycharm", bundle: "com.jetbrains.pycharm", lineStyle: "line" },
  { id: "xcode", label: "Xcode", binary: "xed", bundle: "com.apple.dt.Xcode", lineStyle: "xed" },
  { id: "android-studio", label: "Android Studio", binary: "studio", bundle: "com.google.android.studio", lineStyle: "line" },
  { id: "fleet", label: "Fleet", binary: "fleet", bundle: "fleet.app", lineStyle: "colon" },
];

// What Settings > Files' Default external app lists, with the ids Files' Open in knows
// (filesfacts.js mergeApps and pickDefaultApp): the installed editors (catalogInstalled: their ids;
// one macOS lists for a text file counts too) with Xcode last, the other apps macOS offers for a
// text file (macApps: [{ name, path, bundle }], each once, no helper app inside another .app or test
// browser) as "app:<bundle>", then "system" (the system's own pick for each file). The app macOS
// opens a text file with (system: its path) is tagged "system". current: the setting now; one
// that isn't in the list (written by hand, or not installed here) is added at the end, tagged
// "not found", so it's never hidden. Each: { id, label, tag }.
export function appChoices({ catalogInstalled = [], macApps = [], system = null, current = null } = {}) {
  const installed = new Set(catalogInstalled ?? []);
  const editors = [], apps = [], seenBundle = new Set(), seenName = new Set();
  const tagOf = (path) => (system && path === system ? "system" : "");
  const add = (list, a, bundle) => {
    const b = bundle ? String(bundle).toLowerCase() : null, n = a.label.toLowerCase();
    if ((b && seenBundle.has(b)) || seenName.has(n)) return null;
    if (b) seenBundle.add(b);
    seenName.add(n);
    list.push(a);
    return a;
  };
  for (const e of EDITOR_CATALOG) if (installed.has(e.id)) add(editors, { id: e.id, label: e.label, tag: "" }, e.bundle);
  for (const a of Array.isArray(macApps) ? macApps : []) {
    const path = String(a?.path ?? "");
    if (!a?.name || !path) continue;
    if (/\.app\/.+\.app/i.test(path) || /\.app\/Contents\//i.test(path)) continue;
    if (/ms-playwright|puppeteer|Google Chrome for Testing|\/Library\/Caches\/|\/\.cache\//i.test(path)) continue;
    const cat = EDITOR_CATALOG.find((e) => a.bundle && e.bundle.toLowerCase() === String(a.bundle).toLowerCase());
    if (cat) {
      const had = editors.find((x) => x.id === cat.id);
      if (had) { if (!had.tag) had.tag = tagOf(path); continue; }
      add(editors, { id: cat.id, label: cat.label, tag: tagOf(path) }, cat.bundle);
      continue;
    }
    add(apps, { id: `app:${a.bundle || a.name}`, label: String(a.name).replace(/\.app$/i, ""), tag: tagOf(path) }, a.bundle);
  }
  const out = [...editors.filter((a) => a.id !== "xcode"), ...editors.filter((a) => a.id === "xcode"), ...apps,
    { id: "system", label: "Default app", tag: "per file type" }];
  if (typeof current === "string" && current && !out.some((a) => a.id === current)) out.push({ id: current, label: appLabel(out, current), tag: "not found" });
  return out;
}

// The name of a "default-app" value: "Automatic (editor first)" for null, an app's name from the
// list (or the catalog), else the id as written ("app:<bundle>" without its "app:").
export function appLabel(choices, id) {
  if (id == null) return "Automatic (editor first)";
  const a = (choices ?? []).find((x) => x.id === id && x.tag !== "not found") ?? EDITOR_CATALOG.find((x) => x.id === id);
  if (a) return a.label;
  if (id === "system") return "Default app";
  return String(id).startsWith("app:") ? String(id).slice(4) : String(id);
}

// The comment above "files" in the file.
const FILES_NOTE = [
  "  // Files' defaults (Settings > Files); a missing or unknown value is the default.",
];

// A "files" value as the file means it, or undefined when it isn't one of the key's values.
function fileValue(key, v) {
  const f = FILES_SETTINGS.find((x) => x.key === key);
  if (!f) return undefined;
  if (f.type === "choice") return f.values.some((x) => x.value === v) ? v : undefined;
  if (f.type === "app") return v === null ? null : typeof v === "string" && v.trim() ? v.trim() : undefined;
  return typeof v === "boolean" ? v : undefined;
}

// Every Files setting from a "files" object (anything else counts as none): its value, else the default.
function readFiles(raw) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(FILES_KEYS.map((k) => {
    const v = fileValue(k, obj[k]);
    return [k, v === undefined ? FILES_DEFAULTS[k] : v];
  }));
}

// One Files setting, for parseSettings()' result or shared "workspaces.settings" (nothing known
// yet, or a value that isn't one of the key's, is the default).
export function fileSetting(settings, key) {
  const v = fileValue(key, settings?.files?.[key]);
  return v === undefined ? FILES_DEFAULTS[key] ?? null : v;
}

// The "files" block's keys as the file writes them: each with its comment above it.
const fileLines = (f, value) => [
  ...wrap(`${f.title}: ${f.comment}`, "    // "),
  `    "${f.key}": ${JSON.stringify(value)}`,
].join("\n");

// The file as first written: every setting with what it does above it. values: the
// experiments' (off unless true); features: the add-ons' (on unless false); files: Files'
// defaults (each the default unless given).
export function starter(values = {}, features = {}, files = {}) {
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
  const fv = readFiles(files);
  const fileKeys = FILES_SETTINGS.map((f) => fileLines(f, fv[f.key]));
  return `// Workspaces settings: the package's own (Herdr's are in ~/.config/herdr-app/settings.json).
// Settings > Features, Settings > Files and Settings > Experimental (the sidebar footer's
// Settings) change them; you can edit them here too.
{
${FEATURES_NOTE.join("\n")}
  "features": {
${feats.join(",\n")}
  },

${FILES_NOTE.join("\n")}
  "files": {
${fileKeys.join(",\n\n")}
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

// The text without comments and trailing commas, strings left as they are (and without the
// byte order mark some editors put first).
function stripJsonc(text) {
  text = String(text).replace(/^\uFEFF/, "");
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

// The settings: { experimental: { <key>: true|false }, features: { <key>: true|false },
// files: { <key>: value } } with every experiment present (off unless the file says true),
// every feature present (on unless the file says false) and every Files setting present (its
// default unless the file gives one of its values), and `error` when the file can't be read as
// JSONC (then the experiments are off, the features on and Files' settings the defaults).
export function parseSettings(text) {
  const experimental = Object.fromEntries(EXPERIMENTS.map((e) => [e.key, false]));
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
  if (text == null || !String(text).trim()) return { experimental, features, files: { ...FILES_DEFAULTS } };
  try {
    const raw = JSON.parse(stripJsonc(String(text)));
    for (const e of EXPERIMENTS) experimental[e.key] = raw?.experimental?.[e.key] === true;
    for (const k of FEATURE_KEYS) features[k] = raw?.features?.[k] !== false;
    return { experimental, features, files: readFiles(raw?.files) };
  } catch (err) {
    return { experimental, features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])), files: { ...FILES_DEFAULTS }, error: String(err?.message ?? err) };
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

// The text's top-level `name` object ("features", "files") as [open, close] (the indexes of its
// { and }) in the comment-blanked text, null when there's none, or "other" when it isn't an object.
function topBlock(b, name) {
  const quoted = JSON.stringify(name);
  let depth = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === '"') {
      let j = i + 1;
      while (j < b.length && b[j] !== '"') j += b[j] === "\\" ? 2 : 1;
      if (depth === 1 && b.slice(i, j + 1) === quoted) {
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
  if (FILES_KEYS.some((k) => now.files[k] !== was.files[k])) return null;
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
  const block = topBlock(b, "features");
  if (block === "other") return null;
  if (block) {
    const [open, close] = block;
    // A direct key of "features", at any value (a value that isn't false counts as on).
    const has = directKey(b, open, close, key);
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

// A direct key of the block b[open..close] (comment-blanked text), at any value: the match in
// the block's inside ([1] the key and colon, [2] the value or its first { or [), or null.
function directKey(b, open, close, key) {
  const re = new RegExp(`("${esc(key)}"\\s*:\\s*)(true|false|null|-?[0-9][0-9.eE+-]*|"(?:[^"\\\\]|\\\\.)*"|\\{|\\[)`, "g");
  const inner = b.slice(open + 1, close);
  for (let m; (m = re.exec(inner));) if (depthAt(inner, m.index) === 0) return m;
  return null;
}

// The file's text with one Files setting changed, its comments kept. Only that value changes.
// A file without the key gets it (with its comment) at the top of "files"; one without "files"
// gets the whole block (every key with its comment, the others at their defaults) at the top;
// no file gets the starter. Null when the key or the value isn't one of Files' (default-app's
// is trimmed), or the text can't be changed safely: not JSONC, not an object, "files" or the
// key's value isn't a plain value, or the edit wouldn't read back as asked with everything
// else as it was (a key or a "files" block that's there twice).
export function withFileSetting(text, key, value) {
  if (!FILES_KEYS.includes(key)) return null;
  value = fileValue(key, value);
  if (value === undefined) return null;
  const next = editFileSetting(text, key, value);
  if (next == null) return null;
  const was = parseSettings(text), now = parseSettings(next);
  if (now.error || now.files[key] !== value) return null;
  if (FILES_KEYS.some((k) => k !== key && now.files[k] !== was.files[k])) return null;
  if (FEATURE_KEYS.some((k) => now.features[k] !== was.features[k])) return null;
  if (EXPERIMENTS.some((e) => now.experimental[e.key] !== was.experimental[e.key])) return null;
  return next;
}

// withFileSetting()'s edit, before it's read back.
function editFileSetting(text, key, value) {
  if (text == null || !String(text).trim()) return starter({}, {}, { [key]: value });
  const s = String(text);
  if (parseSettings(s).error) return null;
  const b = blankComments(s);
  const root = b.search(/\S/);
  if (root < 0 || b[root] !== "{") return null;
  const block = topBlock(b, "files");
  if (block === "other") return null;
  const f = FILES_SETTINGS.find((x) => x.key === key);
  if (block) {
    const [open, close] = block;
    const has = directKey(b, open, close, key);
    if (has) {
      if (has[2] === "{" || has[2] === "[") return null;
      const at = open + 1 + has.index;
      return s.slice(0, at) + has[1] + JSON.stringify(value) + s.slice(at + has[0].length);
    }
    const empty = /^\s*\}/.test(b.slice(open + 1));
    return `${s.slice(0, open + 1)}\n${fileLines(f, value)}${empty ? "\n  " : ",\n"}${s.slice(open + 1)}`;
  }
  const fv = { ...FILES_DEFAULTS, [key]: value };
  const empty = /^\s*\}/.test(b.slice(root + 1));
  return `${s.slice(0, root + 1)}\n${FILES_NOTE.join("\n")}\n  "files": {\n${FILES_SETTINGS.map((x) => fileLines(x, fv[x.key])).join(",\n\n")}\n  }${empty ? "\n" : ",\n"}${s.slice(root + 1)}`;
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
