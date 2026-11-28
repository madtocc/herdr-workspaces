// The package's own settings, ~/.herdr/settings.jsonc, as rules with no imports so
// node can test them. Herdr's settings are its own (~/.config/herdr-app/settings.json);
// these are the Workspaces package's: for now its experimental features, each off
// until turned on in the Settings window's Experimental section (ws-settings) or in the file.
// And which of the package's add-ons are on (Settings > Features), each on until turned off,
// and Files' defaults (Settings > Files, the "files" block), each today's behaviour until changed,
// and how automations run (Settings > Automations, the "automations" block: how many agents at once,
// quiet hours for desktop sounds, which agent drafts one from words),
// and Vault's defaults (Settings > Vault, the "vault" block: a new secret's tier and expiry, and
// when a secret's use shows in the bell),
// and which plans and limits the status bar's Plan usage shows (the "usage" block, written by the
// Plan usage limits panel's Customize in ws-status: only what someone turned on or off).
// Copied in ws-settings (the screen), ws-agents (which reads it into shared "workspaces.settings"
// for the mods that only draw), ws-switcher (its runners, in the sidebar and the background
// runner), ws-status (its timed usage asks, and Customize's "usage" block) and ws-files (Files and its Cmd-click handler read
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
// vault: the sidebar's Vault row, and automations that name secrets (secret_env) don't run; no secret
// is deleted and herdr-ws-secret still works from a terminal.
export const FEATURE_KEYS = ["board", "notes", "worktrees", "history", "automations", "usage", "numbers", "notifications", "vault"];

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
    what: "Claude's, Antigravity's and Codex's plan limits at the right of the status bar, asked from each agent every 10 minutes.",
    off: "Off: nothing is asked." },
  { key: "numbers", group: "Status bar and agent rows", title: "Agent numbers",
    what: "The model, how full the context is and how often it was compacted, on each agent's row and in History.",
    off: "Off: agent rows show the name and status only." },
  { key: "notifications", group: "Notifications", title: "Notifications bell",
    what: "A bell at the right end of the tab bar: what needs you and what finished, in every workspace.",
    off: "Off: the bell is gone and nothing new is kept. What it kept stays in ~/.herdr/notifications.json." },
  { key: "vault", group: "Screens", title: "Secrets",
    what: "Write-only secrets agents use by name for HTTP calls and commands, from the sidebar's Secrets screen, without ever seeing the values.",
    off: "Off: Secrets is gone from the sidebar, and automations that name secrets (secret_env) don't run. No secret is deleted, and herdr-ws-secret still works from a terminal." },
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
    comment: "where a path Cmd-clicked (Ctrl-clicked on Linux and Windows) in a terminal opens, \"beside\" the terminal (full size for a terminal on another machine), \"full\" in Files full size, or \"off\" to leave it to Herdr and the system's opener, as without Files." },
  { key: "catch", title: "Files to catch", type: "choice", default: "text-images-folders",
    values: [{ value: "text-images-folders", label: "Text, images & folders" }, { value: "everything", label: "Everything" }],
    what: "Which Cmd-clicked paths open in Files instead of macOS.",
    comment: "which Cmd-clicked (Ctrl-clicked) paths Files takes, \"text-images-folders\" (text, code, Markdown, SVG, images and folders; other files go to the system's opener) or \"everything\" (every file and folder that's there, binaries shown as Binary). A path that isn't there always goes on. Not used while \"cmd-click\" is \"off\"." },
];
export const FILES_KEYS = FILES_SETTINGS.map((f) => f.key);
export const FILES_DEFAULTS = Object.fromEntries(FILES_SETTINGS.map((f) => [f.key, f.default]));

// Editors with a command line, as Files' Open in knows them: a copy of ws-files' filesfacts.js
// EDITOR_CATALOG (keep them the same), so Settings > Files offers the same ids.
export const EDITOR_CATALOG = [
  { id: "zed", label: "Zed", binary: "zed", bundle: "dev.zed.Zed", lineStyle: "colon", desktop: ["dev.zed.Zed.desktop", "zed.desktop"], exe: "zed.exe" },
  { id: "cursor", label: "Cursor", binary: "cursor", bundle: "com.todesktop.230313mzl4w4u92", lineStyle: "goto", desktop: ["cursor.desktop"], exe: "cursor.exe" },
  { id: "vscode", label: "VS Code", binary: "code", bundle: "com.microsoft.VSCode", lineStyle: "goto", desktop: ["code.desktop"], exe: "code.exe" },
  { id: "vscode-insiders", label: "VS Code Insiders", binary: "code-insiders", bundle: "com.microsoft.VSCodeInsiders", lineStyle: "goto", desktop: ["code-insiders.desktop"], exe: "code - insiders.exe" },
  { id: "windsurf", label: "Windsurf", binary: "windsurf", bundle: "com.exafunction.windsurf", lineStyle: "goto", desktop: ["windsurf.desktop"], exe: "windsurf.exe" },
  { id: "sublime", label: "Sublime Text", binary: "subl", bundle: "com.sublimetext.4", lineStyle: "colon", desktop: ["sublime_text.desktop"], exe: "sublime_text.exe" },
  { id: "idea", label: "IntelliJ IDEA", binary: "idea", bundle: "com.jetbrains.intellij", lineStyle: "line", desktop: ["jetbrains-idea.desktop", "jetbrains-idea-ce.desktop"], exe: "idea64.exe" },
  { id: "webstorm", label: "WebStorm", binary: "webstorm", bundle: "com.jetbrains.WebStorm", lineStyle: "line", desktop: ["jetbrains-webstorm.desktop"], exe: "webstorm64.exe" },
  { id: "goland", label: "GoLand", binary: "goland", bundle: "com.jetbrains.goland", lineStyle: "line", desktop: ["jetbrains-goland.desktop"], exe: "goland64.exe" },
  { id: "pycharm", label: "PyCharm", binary: "pycharm", bundle: "com.jetbrains.pycharm", lineStyle: "line", desktop: ["jetbrains-pycharm.desktop", "jetbrains-pycharm-ce.desktop"], exe: "pycharm64.exe" },
  { id: "xcode", label: "Xcode", binary: "xed", bundle: "com.apple.dt.Xcode", lineStyle: "xed" },
  { id: "android-studio", label: "Android Studio", binary: "studio", bundle: "com.google.android.studio", lineStyle: "line", desktop: ["android-studio.desktop", "jetbrains-studio.desktop"], exe: "studio64.exe" },
  { id: "fleet", label: "Fleet", binary: "fleet", bundle: "fleet.app", lineStyle: "colon", exe: "fleet.exe" },
];

// What Settings > Files' Default external app lists, with the ids Files' Open in knows
// (filesfacts.js mergeApps and pickDefaultApp): the installed editors (catalogInstalled: their ids;
// one the system lists for a text file counts too) with Xcode last, the other apps the system offers
// for a text file (macApps: [{ name, path, bundle }], each once, no helper app inside another .app or
// test browser; on Linux the .desktop files of parseLinuxApps, bundle their desktop id) as
// "app:<bundle>", then "system" (the system's own pick for each file). The app the system opens a
// text file with (system: its path) is tagged "system". current: the setting now; one
// that isn't in the list (written by hand, or not installed here) is added at the end, tagged
// "not found", so it's never hidden. Each: { id, label, tag }.
// The catalog's editor for an app the system lists: by macOS bundle id, Linux desktop id or Windows .exe name.
const catalogFor = (bundle) => {
  const b = String(bundle ?? "").toLowerCase();
  return b ? EDITOR_CATALOG.find((e) => e.bundle.toLowerCase() === b || (e.desktop ?? []).some((d) => d.toLowerCase() === b) || e.exe === b) : undefined;
};

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
    const cat = catalogFor(a.bundle);
    if (cat) {
      const had = editors.find((x) => x.id === cat.id);
      if (had) { if (!had.tag) had.tag = tagOf(path); continue; }
      add(editors, { id: cat.id, label: cat.label, tag: tagOf(path) }, cat.bundle);
      continue;
    }
    add(apps, { id: `app:${a.bundle || a.name}`, label: String(a.name).replace(/\.app$/i, ""), tag: tagOf(path) }, a.bundle);
  }
  const out = [...editors.filter((a) => a.id !== "xcode"), ...editors.filter((a) => a.id === "xcode"), ...apps,
    { id: "system", label: "System default", tag: "per file type" }];
  if (typeof current === "string" && current && !out.some((a) => a.id === current)) out.push({ id: current, label: appLabel(out, current), tag: "not found" });
  return out;
}

// The name of a "default-app" value: "Automatic (editor first)" for null, an app's name from the
// list (or the catalog), else the id as written ("app:<bundle>" without its "app:").
export function appLabel(choices, id) {
  if (id == null) return "Automatic (editor first)";
  const a = (choices ?? []).find((x) => x.id === id && x.tag !== "not found") ?? EDITOR_CATALOG.find((x) => x.id === id);
  if (a) return a.label;
  if (id === "system") return "System default";
  return String(id).startsWith("app:") ? String(id).slice(4) : String(id);
}

// How automations run (Settings > Automations), the same way as Files' settings: each key in
// "automations", its title and what it does, its values (choices; "hours": a time range or null)
// and the default. A missing value, or one that isn't one of these, is the default.
export const AUTOMATIONS_SETTINGS = [
  { key: "max-parallel", title: "Max parallel agent runs", type: "choice", default: 2,
    values: [{ value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" }, { value: 0, label: "Unlimited" }],
    what: "How many automations with an agent run at once; the others wait their turn. Run now never waits.",
    comment: "how many automation runs with an agent go at once, 1, 2, 3 or 0 for no limit. More wait their turn, in the order they came; Run now doesn't wait. Shell scripts go 4 at a time." },
  { key: "quiet-hours", title: "Quiet hours", type: "hours", default: null,
    what: "Desktop notifications from automations make no sound during these hours. The bell and History still keep everything.",
    comment: "a time range such as \"22:00-08:00\" (over midnight) when the background runner's desktop notifications make no sound, or null for none. The bell and History still keep everything." },
  { key: "drafter", title: "Drafter", type: "choice", default: "auto",
    values: [{ value: "auto", label: "Automatic" }, { value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }, { value: "agy", label: "Antigravity" }, { value: "pi", label: "Pi" }],
    what: "Which agent writes an automation from your words in Automations.",
    comment: "which agent writes an automation from the words in Automations' describe box: \"auto\" (the first installed of claude, codex, agy and pi) or one of those." },
];
export const AUTOMATIONS_KEYS = AUTOMATIONS_SETTINGS.map((a) => a.key);
export const AUTOMATIONS_DEFAULTS = Object.fromEntries(AUTOMATIONS_SETTINGS.map((a) => [a.key, a.default]));

// The comment above "automations" in the file.
const AUTOMATIONS_NOTE = [
  "  // How automations run (Settings > Automations); a missing or unknown value is the default.",
];

// "22:00-08:00" (or "9:00 - 17:30"), written "HH:MM-HH:MM"; undefined when it isn't a time range
// (or its start is its end).
function hoursValue(v) {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*[-–]\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(typeof v === "string" ? v : "");
  if (!m) return undefined;
  const a = `${m[1].padStart(2, "0")}:${m[2]}`, b = `${m[3].padStart(2, "0")}:${m[4]}`;
  return a === b ? undefined : `${a}-${b}`;
}

// An "automations" value as the file means it, or undefined when it isn't one of the key's values.
function automationValue(key, v) {
  const a = AUTOMATIONS_SETTINGS.find((x) => x.key === key);
  if (!a) return undefined;
  if (a.type === "choice") return a.values.some((x) => x.value === v) ? v : undefined;
  if (a.type === "hours") return v === null ? null : hoursValue(v);
  return undefined;
}

// Every automations setting from an "automations" object: its value, else the default.
function readAutomations(raw) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(AUTOMATIONS_KEYS.map((k) => {
    const v = automationValue(k, obj[k]);
    return [k, v === undefined ? AUTOMATIONS_DEFAULTS[k] : v];
  }));
}

// One automations setting, for parseSettings()' result or shared "workspaces.settings" (nothing
// known yet, or a value that isn't one of the key's, is the default).
export function automationSetting(settings, key) {
  const v = automationValue(key, settings?.automations?.[key]);
  return v === undefined ? AUTOMATIONS_DEFAULTS[key] ?? null : v;
}

const automationLines = (a, value) => [
  ...wrap(`${a.title}: ${a.comment}`, "    // "),
  `    "${a.key}": ${JSON.stringify(value)}`,
].join("\n");

// Vault's defaults (Settings > Vault), the same way as the automations': each key in "vault", its
// title and what it does, its values and the default. A missing value, or one that isn't one of
// these, is the default. default-tier and default-ttl only prefill a new secret in Vault; notify
// says which uses of a secret show in the bell.
export const VAULT_SETTINGS = [
  { key: "default-tier", title: "Default tier", type: "choice", default: "standard",
    values: [{ value: "standard", label: "Standard" }, { value: "protected", label: "Protected" }],
    what: "Pre-selected when creating a secret. You can still pick Standard or Protected per entry.",
    comment: "the tier Secrets picks for a new secret, \"standard\" (encrypted in ~/.herdr/vault) or \"protected\" (in the Keychain, used only through the macOS broker). Each secret can still pick its own." },
  { key: "default-ttl", title: "Default expiry", type: "choice", default: "24h",
    values: [{ value: "4h", label: "4h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "never", label: "Never" }],
    what: "Expired secrets are refused automatically so temporary cookies and rollout tokens don't linger.",
    comment: "how long a new secret lasts before it's refused, \"4h\", \"24h\", \"7d\", \"30d\" or \"never\". Each secret can still pick its own." },
  { key: "notify", title: "Show secret use in the bell", type: "choice", default: "protected",
    values: [{ value: "off", label: "Off" }, { value: "protected", label: "Protected only" }, { value: "always", label: "Always" }],
    what: "Leaves a quiet bell entry when an agent uses a secret or is refused one (which host or command, never the value). Protected only leaves none for Standard secrets.",
    comment: "which uses of a secret, and tries that were refused, leave a quiet entry in the bell (who, and which host or command; never the value): \"off\", \"protected\" (Protected secrets only) or \"always\"." },
];
export const VAULT_KEYS = VAULT_SETTINGS.map((v) => v.key);
export const VAULT_DEFAULTS = Object.fromEntries(VAULT_SETTINGS.map((v) => [v.key, v.default]));

// The comment above "vault" in the file.
const VAULT_NOTE = [
  "  // Secrets' defaults (Settings > Secrets); a missing or unknown value is the default.",
];

// A "vault" value as the file means it, or undefined when it isn't one of the key's values.
function vaultValue(key, v) {
  const s = VAULT_SETTINGS.find((x) => x.key === key);
  return s && s.values.some((x) => x.value === v) ? v : undefined;
}

// Every Vault setting from a "vault" object: its value, else the default.
function readVault(raw) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(VAULT_KEYS.map((k) => {
    const v = vaultValue(k, obj[k]);
    return [k, v === undefined ? VAULT_DEFAULTS[k] : v];
  }));
}

// One Vault setting, for parseSettings()' result or shared "workspaces.settings" (nothing known
// yet, or a value that isn't one of the key's, is the default).
export function vaultSetting(settings, key) {
  const v = vaultValue(key, settings?.vault?.[key]);
  return v === undefined ? VAULT_DEFAULTS[key] ?? null : v;
}

const vaultLines = (v, value) => [
  ...wrap(`${v.title}: ${v.comment}`, "    // "),
  `    "${v.key}": ${JSON.stringify(value)}`,
].join("\n");

// The comment above "files" in the file.
// What the status bar's Plan usage shows (the "usage" block): "<plan>" (claude, agy, codex) false
// leaves a whole plan out of the bar, "<plan>/<part>" turns one of its limits or pools on or off
// ("claude/weekly-fable", "agy/claude-and-gpt-models", "codex/codex"). Only booleans, only what
// someone changed: a key that isn't there keeps the bar's default (ws-status/usagefacts.js).
export const USAGE_KEY = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/;
const USAGE_NOTE = [
  "  // What the status bar's Plan usage shows (its panel's Customize): \"<plan>\" for a whole plan,",
  "  // \"<plan>/<limit or pool>\" for one part of it, each true or false. Missing ones keep their defaults.",
];
function readUsagePrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (USAGE_KEY.test(k) && typeof v === "boolean") out[k] = v;
  return out;
}
const sameUsage = (a, b) => JSON.stringify(a?.usage ?? {}) === JSON.stringify(b?.usage ?? {});

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
// defaults (each the default unless given); automations: how automations run (the same);
// vault: Vault's defaults (the same).
export function starter(values = {}, features = {}, files = {}, automations = {}, vault = {}) {
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
  const av = readAutomations(automations);
  const autoKeys = AUTOMATIONS_SETTINGS.map((a) => automationLines(a, av[a.key]));
  const vv = readVault(vault);
  const vaultKeys = VAULT_SETTINGS.map((v) => vaultLines(v, vv[v.key]));
  return `// Workspaces settings: the package's own (Herdr's are in ~/.config/herdr-app/settings.json).
// Settings > Features, Settings > Files, Settings > Automations, Settings > Vault and Settings >
// Experimental (the sidebar footer's Settings) change them; you can edit them here too.
{
${FEATURES_NOTE.join("\n")}
  "features": {
${feats.join(",\n")}
  },

${FILES_NOTE.join("\n")}
  "files": {
${fileKeys.join(",\n\n")}
  },

${AUTOMATIONS_NOTE.join("\n")}
  "automations": {
${autoKeys.join(",\n\n")}
  },

${VAULT_NOTE.join("\n")}
  "vault": {
${vaultKeys.join(",\n\n")}
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
// files: { <key>: value }, automations: { <key>: value }, vault: { <key>: value },
// usage: { <plan or plan/part>: true|false } (only the keys the file gives) } with every
// experiment present (off unless the file says true), every feature present (on unless the file
// says false) and every Files, automations and Vault setting present (its default unless the file
// gives one of its values),
// and `error` when the file can't be read as JSONC (then the experiments are off, the features
// on and the other settings the defaults).
export function parseSettings(text) {
  const experimental = Object.fromEntries(EXPERIMENTS.map((e) => [e.key, false]));
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
  if (text == null || !String(text).trim()) return { experimental, features, files: { ...FILES_DEFAULTS }, automations: { ...AUTOMATIONS_DEFAULTS }, vault: { ...VAULT_DEFAULTS }, usage: {} };
  try {
    const raw = JSON.parse(stripJsonc(String(text)));
    for (const e of EXPERIMENTS) experimental[e.key] = raw?.experimental?.[e.key] === true;
    for (const k of FEATURE_KEYS) features[k] = raw?.features?.[k] !== false;
    return { experimental, features, files: readFiles(raw?.files), automations: readAutomations(raw?.automations), vault: readVault(raw?.vault), usage: readUsagePrefs(raw?.usage) };
  } catch (err) {
    return { experimental, features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])), files: { ...FILES_DEFAULTS }, automations: { ...AUTOMATIONS_DEFAULTS }, vault: { ...VAULT_DEFAULTS }, usage: {}, error: String(err?.message ?? err) };
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
  if (AUTOMATIONS_KEYS.some((k) => now.automations[k] !== was.automations[k])) return null;
  if (VAULT_KEYS.some((k) => now.vault[k] !== was.vault[k])) return null;
  if (!sameUsage(now, was)) return null;
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
  if (AUTOMATIONS_KEYS.some((k) => now.automations[k] !== was.automations[k])) return null;
  if (VAULT_KEYS.some((k) => now.vault[k] !== was.vault[k])) return null;
  if (!sameUsage(now, was)) return null;
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

// The file's text with one automations setting changed, its comments kept, the same way as
// withFileSetting(): only that value changes; a file without the key gets it (with its comment) at
// the top of "automations"; one without "automations" gets the whole block at the top; no file
// gets the starter. Null when the key or the value isn't one of the settings' (a quiet-hours range
// is written "HH:MM-HH:MM"), or the text can't be changed safely.
export function withAutomationSetting(text, key, value) {
  if (!AUTOMATIONS_KEYS.includes(key)) return null;
  value = automationValue(key, value);
  if (value === undefined) return null;
  const next = editAutomationSetting(text, key, value);
  if (next == null) return null;
  const was = parseSettings(text), now = parseSettings(next);
  if (now.error || now.automations[key] !== value) return null;
  if (AUTOMATIONS_KEYS.some((k) => k !== key && now.automations[k] !== was.automations[k])) return null;
  if (FILES_KEYS.some((k) => now.files[k] !== was.files[k])) return null;
  if (FEATURE_KEYS.some((k) => now.features[k] !== was.features[k])) return null;
  if (EXPERIMENTS.some((e) => now.experimental[e.key] !== was.experimental[e.key])) return null;
  if (VAULT_KEYS.some((k) => now.vault[k] !== was.vault[k])) return null;
  if (!sameUsage(now, was)) return null;
  return next;
}

// withAutomationSetting()'s edit, before it's read back.
function editAutomationSetting(text, key, value) {
  if (text == null || !String(text).trim()) return starter({}, {}, {}, { [key]: value });
  const s = String(text);
  if (parseSettings(s).error) return null;
  const b = blankComments(s);
  const root = b.search(/\S/);
  if (root < 0 || b[root] !== "{") return null;
  const block = topBlock(b, "automations");
  if (block === "other") return null;
  const a = AUTOMATIONS_SETTINGS.find((x) => x.key === key);
  if (block) {
    const [open, close] = block;
    const has = directKey(b, open, close, key);
    if (has) {
      if (has[2] === "{" || has[2] === "[") return null;
      const at = open + 1 + has.index;
      return s.slice(0, at) + has[1] + JSON.stringify(value) + s.slice(at + has[0].length);
    }
    const empty = /^\s*\}/.test(b.slice(open + 1));
    return `${s.slice(0, open + 1)}\n${automationLines(a, value)}${empty ? "\n  " : ",\n"}${s.slice(open + 1)}`;
  }
  const av = { ...AUTOMATIONS_DEFAULTS, [key]: value };
  const empty = /^\s*\}/.test(b.slice(root + 1));
  return `${s.slice(0, root + 1)}\n${AUTOMATIONS_NOTE.join("\n")}\n  "automations": {\n${AUTOMATIONS_SETTINGS.map((x) => automationLines(x, av[x.key])).join(",\n\n")}\n  }${empty ? "\n" : ",\n"}${s.slice(root + 1)}`;
}

// The file's text with one Vault setting changed, its comments kept, the same way as
// withAutomationSetting(): only that value changes; a file without the key gets it (with its comment)
// at the top of "vault"; one without "vault" gets the whole block at the top; no file gets the
// starter. Null when the key or the value isn't one of the settings', or the text can't be changed
// safely (not JSONC, not an object, "vault" or the key's value isn't a plain value, or the edit
// wouldn't read back as asked with everything else as it was).
export function withVaultSetting(text, key, value) {
  if (!VAULT_KEYS.includes(key)) return null;
  value = vaultValue(key, value);
  if (value === undefined) return null;
  const next = editVaultSetting(text, key, value);
  if (next == null) return null;
  const was = parseSettings(text), now = parseSettings(next);
  if (now.error || now.vault[key] !== value) return null;
  if (VAULT_KEYS.some((k) => k !== key && now.vault[k] !== was.vault[k])) return null;
  if (!sameUsage(now, was)) return null;
  if (AUTOMATIONS_KEYS.some((k) => now.automations[k] !== was.automations[k])) return null;
  if (FILES_KEYS.some((k) => now.files[k] !== was.files[k])) return null;
  if (FEATURE_KEYS.some((k) => now.features[k] !== was.features[k])) return null;
  if (EXPERIMENTS.some((e) => now.experimental[e.key] !== was.experimental[e.key])) return null;
  return next;
}

// withVaultSetting()'s edit, before it's read back.
function editVaultSetting(text, key, value) {
  if (text == null || !String(text).trim()) return starter({}, {}, {}, {}, { [key]: value });
  const s = String(text);
  if (parseSettings(s).error) return null;
  const b = blankComments(s);
  const root = b.search(/\S/);
  if (root < 0 || b[root] !== "{") return null;
  const block = topBlock(b, "vault");
  if (block === "other") return null;
  const v = VAULT_SETTINGS.find((x) => x.key === key);
  if (block) {
    const [open, close] = block;
    const has = directKey(b, open, close, key);
    if (has) {
      if (has[2] === "{" || has[2] === "[") return null;
      const at = open + 1 + has.index;
      return s.slice(0, at) + has[1] + JSON.stringify(value) + s.slice(at + has[0].length);
    }
    const empty = /^\s*\}/.test(b.slice(open + 1));
    return `${s.slice(0, open + 1)}\n${vaultLines(v, value)}${empty ? "\n  " : ",\n"}${s.slice(open + 1)}`;
  }
  const vv = { ...VAULT_DEFAULTS, [key]: value };
  const empty = /^\s*\}/.test(b.slice(root + 1));
  return `${s.slice(0, root + 1)}\n${VAULT_NOTE.join("\n")}\n  "vault": {\n${VAULT_SETTINGS.map((x) => vaultLines(x, vv[x.key])).join(",\n\n")}\n  }${empty ? "\n" : ",\n"}${s.slice(root + 1)}`;
}

// The file's text with one of Plan usage's parts turned on or off for the status bar (the panel's
// Customize), its comments kept, the same way as withFeature(): only that value changes; a file
// without the key gets it at the top of "usage"; one without "usage" gets the block (with a comment
// saying what it is) at the top; no file gets the starter with the block. Unlike a feature, the
// value is always written (a part's default isn't known here). Null when the key isn't one
// (USAGE_KEY) or the text can't be changed safely (not JSONC, not an object, "usage" or the key's
// value isn't a plain value, or the edit wouldn't read back as asked with everything else as it was).
export function withUsageSetting(text, key, on) {
  if (typeof key !== "string" || !USAGE_KEY.test(key)) return null;
  on = on !== false;
  const next = editUsageSetting(text == null || !String(text).trim() ? starter() : text, key, on);
  if (next == null) return null;
  const was = parseSettings(text), now = parseSettings(next);
  if (now.error || now.usage[key] !== on) return null;
  const rest = (u) => JSON.stringify(Object.entries(u).filter(([k]) => k !== key).sort());
  if (rest(now.usage) !== rest(was.usage)) return null;
  if (VAULT_KEYS.some((k) => now.vault[k] !== was.vault[k])) return null;
  if (AUTOMATIONS_KEYS.some((k) => now.automations[k] !== was.automations[k])) return null;
  if (FILES_KEYS.some((k) => now.files[k] !== was.files[k])) return null;
  if (FEATURE_KEYS.some((k) => now.features[k] !== was.features[k])) return null;
  if (EXPERIMENTS.some((e) => now.experimental[e.key] !== was.experimental[e.key])) return null;
  return next;
}

// withUsageSetting()'s edit, before it's read back.
function editUsageSetting(s, key, on) {
  s = String(s);
  if (parseSettings(s).error) return null;
  const b = blankComments(s);
  const root = b.search(/\S/);
  if (root < 0 || b[root] !== "{") return null;
  const block = topBlock(b, "usage");
  if (block === "other") return null;
  if (block) {
    const [open, close] = block;
    const has = directKey(b, open, close, key);
    if (has) {
      if (has[2] === "{" || has[2] === "[") return null;
      const at = open + 1 + has.index;
      return s.slice(0, at) + has[1] + on + s.slice(at + has[0].length);
    }
    const empty = /^\s*\}/.test(b.slice(open + 1));
    return `${s.slice(0, open + 1)}\n    ${JSON.stringify(key)}: ${on}${empty ? "\n  " : ","}${s.slice(open + 1)}`;
  }
  const empty = /^\s*\}/.test(b.slice(root + 1));
  return `${s.slice(0, root + 1)}\n${USAGE_NOTE.join("\n")}\n  "usage": {\n    ${JSON.stringify(key)}: ${on}\n  }${empty ? "\n" : ",\n"}${s.slice(root + 1)}`;
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

// Linux: the apps the desktop offers for a file ($1), as file managers find them: the .desktop
// files (user's first, then the system's, Flatpak's and Snap's) whose MimeType lists the file's
// type (text files: text/plain too), not hidden. Prints "default<TAB><desktop file>" for the one
// xdg-mime opens it with, then "app<TAB><name><TAB><desktop file>" for each. parseLinuxApps reads it.
export const LINUX_APPS_SH = `f=$1
mime=$(xdg-mime query filetype "$f" 2>/dev/null || file --brief --mime-type "$f" 2>/dev/null) || true
[ -n "$mime" ] || exit 0
mimes=$mime; case $mime in text/*) mimes="$mime;text/plain" ;; esac
def=$(xdg-mime query default "$mime" 2>/dev/null || true)
[ -n "$def" ] || def=$(xdg-mime query default text/plain 2>/dev/null || true)
dirs="\${XDG_DATA_HOME:-$HOME/.local/share}:\${XDG_DATA_DIRS:-/usr/local/share:/usr/share}:/var/lib/flatpak/exports/share:$HOME/.local/share/flatpak/exports/share:/var/lib/snapd/desktop"
old=$IFS; IFS=:
for d in $dirs; do
  IFS=$old
  [ -d "$d/applications" ] || continue
  for a in "$d"/applications/*.desktop; do
    [ -f "$a" ] || continue
    [ -n "$def" ] && [ "\${a##*/}" = "$def" ] && printf 'default\\t%s\\n' "$a" && def=
    awk -v mimes="$mimes" -v file="$a" '
      /^\\[/ { sec = ($0 == "[Desktop Entry]"); next }
      !sec { next }
      /^Name=/ && name == "" { name = substr($0, 6) }
      /^MimeType=/ { n = split(substr($0, 10), m, ";"); k = split(mimes, want, ";")
        for (i = 1; i <= n; i++) for (j = 1; j <= k; j++) if (m[i] != "" && m[i] == want[j]) hit = 1 }
      /^NoDisplay=true/ || /^Hidden=true/ { hide = 1 }
      /^Type=/ && $0 != "Type=Application" { hide = 1 }
      END { if (hit && !hide && name != "") printf "app\\t%s\\t%s\\n", name, file }' "$a"
  done
done
true`;

// LINUX_APPS_SH's output (or ws-files' winapps.ps1 list on Windows: an .exe path or a packaged app's
// name where the .desktop file is) as the macOS list's shape: { apps: [{ name, path, bundle }], system } with
// path the .desktop file, bundle its desktop id ("org.gnome.TextEditor.desktop"), each id once
// (the first found wins, as XDG_DATA_HOME comes first), system the default's .desktop file.
export function parseLinuxApps(stdout) {
  const apps = [], seen = new Set();
  let system = null;
  for (const line of String(stdout ?? "").split("\n")) {
    const [kind, a, b] = line.split("\t");
    if (kind === "default" && a && !system) system = a;
    if (kind !== "app" || !a || !b) continue;
    const id = b.split(/[\\/]/).pop();
    if (seen.has(id)) continue;
    seen.add(id);
    apps.push({ name: a, path: b, bundle: id });
  }
  if (system) {
    const id = system.split(/[\\/]/).pop(), hit = apps.find((x) => x.bundle === id);
    if (hit) system = hit.path;
  }
  return { apps, system };
}

// The words of a text for this platform: written for macOS, they're said as they are there. On
// Linux and Windows a Cmd-click is a Ctrl-click, the paths Herdr hands on go to the system's opener,
// and the machine is "the computer".
export function platformWords(text, platform = "macos") {
  const s = String(text ?? "");
  if (platform === "macos") return s;
  return s.replace(/Cmd-click/g, "Ctrl-click").replace(/instead of macOS/g, "instead of the system's opener")
    .replace(/to macOS/g, "to the system's opener").replace(/\bthe Mac\b/g, "the computer");
}
