// The Files view's rules, apart from its screen: what kind a file is, which Cmd-clicked paths
// Files catches, link and path parsing, the tree filter, content search output, and the
// Open with… list and its memory. No imports, so `node` can test it.

// Text is shown up to DISPLAY_LIMIT characters; past that it's read-only (a save would cut the
// file). Herdr's readTextFile/writeTextFile stop at API_LIMIT. Images are previewed up to IMAGE_LIMIT.
export const DISPLAY_LIMIT = 400_000;
export const API_LIMIT = 1_048_576;
export const IMAGE_LIMIT = 10 * 1024 * 1024;
// The ask list other mods and link.js push to (shared "workspaces.files.open"), like "workspaces.view".
export const ASK_KEEP = 64;
export const ASK_TTL = 15000;

const IMAGES = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"]);
const MARKDOWN = new Set(["md", "mdx", "markdown"]);
// Binaries Files doesn't catch from a terminal (the system opens them) and shows no text for.
export const BINARY_EXTS = new Set([
  "pdf", "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg", "pkg", "iso", "img", "app",
  "mp3", "wav", "flac", "ogg", "m4a", "aac", "mp4", "mov", "mkv", "webm", "avi",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "pages", "numbers",
  "exe", "dll", "so", "dylib", "a", "o", "wasm", "class", "jar", "pyc", "sqlite", "db",
  "ttf", "otf", "woff", "woff2", "eot", "icns", "apk", "ipa",
  "heic", "heif", "tif", "tiff", "psd", "ai", "eps", "raw", "cr2", "nef", "dng", "bin", "dat", "parquet", "avro", "orc",
  "sqlite3", "zst", "lz4", "lzma", "deb", "rpm", "msi", "crx", "xpi", "mid", "midi", "opus", "flv", "wmv", "m4v", "3gp",
]);
// Extensions Files knows as text: a Cmd-clicked file with one of these isn't sniffed for binary content.
export const TEXT_EXTS = new Set([
  "md", "mdx", "markdown", "svg", "txt", "log", "csv", "tsv", "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "env", "lock", "xml", "html", "htm", "css", "scss", "sass", "less", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
  "vue", "svelte", "sh", "bash", "zsh", "fish", "ps1", "py", "rb", "go", "rs", "c", "h", "cc", "cpp", "hpp", "java", "kt",
  "swift", "zig", "lua", "sql", "graphql", "proto", "tf", "hcl", "nix", "ex", "exs", "erl", "hs", "ml", "php", "pl", "r",
  "dart", "scala", "clj", "el", "vim", "gradle", "properties", "dockerfile", "makefile", "mk", "cmake", "gitignore", "patch", "diff",
]);
// Whether a file with no extension Files knows should have its first bytes looked at before it's caught.
export const needsSniff = (path) => { const e = extOf(path); return Boolean(e) && !TEXT_EXTS.has(e) && fileKind(path) === "text"; };
const TYPE_NAMES = {
  pdf: "PDF document", zip: "ZIP archive", tar: "Tar archive", gz: "Gzip archive", tgz: "Gzip archive", dmg: "Disk image",
  mp3: "Audio", wav: "Audio", flac: "Audio", ogg: "Audio", m4a: "Audio", aac: "Audio",
  mp4: "Video", mov: "Video", mkv: "Video", webm: "Video", avi: "Video",
  doc: "Word document", docx: "Word document", xls: "Spreadsheet", xlsx: "Spreadsheet", ppt: "Presentation", pptx: "Presentation",
  sqlite: "SQLite database", db: "Database", ttf: "Font", otf: "Font", woff: "Font", woff2: "Font", wasm: "WebAssembly module",
};

// The base name of a path ("/a/b.md" -> "b.md"; trailing slashes dropped).
export const baseName = (path) => String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
// The folder of an absolute path ("/a/b.md" -> "/a"; "/b" -> "/").
export function dirName(path) {
  const p = String(path ?? "").replace(/[\\/]+$/, "");
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : i === 0 ? p.slice(0, 1) : "";
}

// The lower-case extension without the dot, "" for none (a leading dot is a name: ".env" has none).
export function extOf(path) {
  const name = baseName(path), i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

// "markdown" | "svg" | "image" | "text" | "binary", by name only (content can still say binary).
export function fileKind(path) {
  const ext = extOf(path);
  if (MARKDOWN.has(ext)) return "markdown";
  if (ext === "svg") return "svg";
  if (IMAGES.has(ext)) return "image";
  if (BINARY_EXTS.has(ext)) return "binary";
  return "text";
}

// The kinds with Source | Preview | Split.
export function previewKind(path) {
  const k = fileKind(path);
  return k === "markdown" || k === "svg" ? k : null;
}

// What the binary screen calls it ("PDF document", else "PNG file", else "File").
export function typeName(path) {
  const ext = extOf(path);
  return TYPE_NAMES[ext] ?? (ext ? `${ext.toUpperCase()} file` : "File");
}

// The editor's language for a file: its extension, through LANG's aliases.
export const LANG = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js",
  toml: "yaml", jsonc: "json", json5: "json", svelte: "html", vue: "html", htm: "html", xml: "html", svg: "html",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  sh: "bash", zsh: "bash", bash: "bash", fish: "bash",
  rs: "rust", py: "python", go: "go", rb: "ruby", css: "css", scss: "css", html: "html",
  yaml: "yaml", yml: "yaml", sql: "sql", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
  java: "java", kt: "kotlin", swift: "swift", zig: "zig", lua: "lua",
};
export function languageOf(path) {
  const name = baseName(path).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "make";
  const ext = extOf(path);
  return LANG[ext] ?? (ext || "text");
}

// How Tab indents in the editor, read from the file: a tab for Makefiles, Go and a file whose
// indented lines mostly start with one; otherwise the step its spaces go up by (2 to 8), or
// nothing (the editor's 2) when no line says. The first 2,000 lines are enough.
export function indentStyle(text, path) {
  const name = baseName(path).toLowerCase(), ext = extOf(path);
  if (name === "makefile" || name === "gnumakefile" || ext === "mk" || ext === "go") return { hard_tabs: true, tab_size: 4 };
  let tabs = 0, spaced = 0;
  const steps = new Map();
  for (const line of String(text ?? "").split("\n", 2000)) {
    if (line[0] === "\t") { tabs++; continue; }
    const m = /^( +)(\S)/.exec(line);
    if (!m || m[2] === "*") continue; // a block comment's " * " is no indent
    spaced++;
    const n = m[1].length;
    if (n >= 2) steps.set(n, (steps.get(n) ?? 0) + 1);
  }
  if (tabs > spaced) return { hard_tabs: true, tab_size: 4 };
  // The smallest indent (2 to 8) at least two lines use, when the others are its multiples mostly.
  const step = [...steps.keys()].filter((n) => n <= 8 && steps.get(n) >= 2).sort((a, b) => a - b)[0];
  if (!step) return {};
  const fits = [...steps].reduce((k, [n, c]) => k + (n % step === 0 ? c : 0), 0);
  return fits * 10 >= spaced * 8 ? { tab_size: step } : {};
}

// Whether a Cmd-clicked path (one that's there) is Files' to open: folders, and every file but
// the binaries above (those go on to the system's opener). catchMode: the "catch" setting
// (settings.jsonc "files"); "everything" takes every file and folder, binaries included.
export function shouldCatchLink(path, isDir, catchMode = "text-images-folders") {
  if (isDir || catchMode === "everything") return true;
  return !BINARY_EXTS.has(extOf(path));
}

// "612 B", "4.2 KB", "2.4 MB".
export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Editable: text, Markdown and SVG, read whole, on this computer (writeTextFile is local only).
export function canEdit({ kind, truncated, remote }) {
  return (kind === "text" || kind === "markdown" || kind === "svg") && !truncated && !remote;
}

// A clicked link's text to { path, line, col }: a file:// URI decoded (its host dropped),
// and a trailing ":line", ":line:col", ":line-end", "#Lline", "#Lline-Lend", "#Lline-end",
// or "(line,col)" (plus an optional trailing sentence period) taken off.
export function parseRawLink(raw) {
  let path = String(raw ?? "").trim();
  let line = null, col = null;
  if (/^file:\/\//i.test(path)) {
    path = path.replace(/^file:\/\/(localhost)?/i, "");
    if (!path.startsWith("/")) path = path.replace(/^[^/]*/, ""); // file://host/path: the host goes
    const frag = /#([^?]*)$/.exec(path)?.[1] ?? "";
    const hm = /^L(\d+)(?:-L?\d+)?\.?$/i.exec(frag);
    if (hm) line = Number(hm[1]);
    path = path.replace(/[?#].*$/, "");
    try { path = decodeURIComponent(path); } catch { /* keep it as written */ }
  } else {
    const hm = /^(.*?)#L(\d+)(?:-L?\d+)?\.?$/i.exec(path);
    if (hm && hm[1]) { path = hm[1]; line = Number(hm[2]); }
  }
  if (line === null) {
    const rm = /^(.*?):(\d+)-\d+\.?$/.exec(path);
    if (rm && rm[1]) { path = rm[1]; line = Number(rm[2]); }
  }
  if (line === null) {
    const m = /^(.*?):(\d+)(?::(\d+))?:?\.?$/.exec(path) ?? /^(.*?)\((\d+)(?:,\s*(\d+))?\)\.?$/.exec(path);
    if (m && m[1]) { path = m[1]; line = Number(m[2]); col = m[3] ? Number(m[3]) : null; }
  }
  return { path, line, col };
}

// The 1-based line and column of a clicked terminal file link: Herdr 0.1.18's link.line /
// link.column first, else what parseRawLink() read from link.raw (remote links, "(line,col)").
export function linkPlace(link, parsed = parseRawLink(link?.raw)) {
  const hasLine = Number.isInteger(link?.line) && link.line > 0;
  const line = hasLine ? link.line : parsed.line;
  const col = Number.isInteger(link?.column) && link.column > 0 ? link.column : (hasLine ? null : parsed.col);
  return { line, col };
}

// "." and ".." resolved out of an absolute POSIX path.
export function normalizePath(path) {
  const abs = String(path ?? "").startsWith("/");
  const out = [];
  for (const part of String(path ?? "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else if (!abs) out.push(".."); continue; }
    out.push(part);
  }
  return (abs ? "/" : "") + out.join("/");
}

// A clicked path to an absolute one: "~/x" from home (on another machine it's left to its shell:
// "~/x" stays), a relative one against the terminal's cwd. Null when it can't be placed.
export function resolveTargetPath(raw, cwd, isRemote, home) {
  const p = String(raw ?? "").trim();
  if (!p) return null;
  if (p === "~" || p.startsWith("~/")) {
    if (isRemote || !home) return p;
    return normalizePath(home + p.slice(1));
  }
  if (p.startsWith("/")) return normalizePath(p);
  if (!cwd) return null;
  return normalizePath(`${cwd}/${p}`);
}

// A link in a Markdown file: { external: url } for http(s) and mailto, { anchor } for "#x",
// else { path } resolved against the file's folder (anchor and query dropped). baseFile is absolute.
// Only http(s) and mailto open outside; any other scheme is { blocked } (an app link in a cloned README
// shouldn't start that app). A Windows drive path ("C:/x.md", "C:\\x.md") is a path.
export function resolveRelativeLink(baseFile, href) {
  const h = String(href ?? "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(h)) return { external: h };
  if (h.startsWith("#")) return { anchor: h.slice(1) };
  if (/^file:\/\//i.test(h)) return { path: parseRawLink(h).path };
  if (/^[a-z]:[\\/]/i.test(h)) return { path: h.replace(/\\/g, "/") };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return { blocked: h };
  let p = h.replace(/[?#].*$/, "");
  try { p = decodeURIComponent(p); } catch { /* keep it */ }
  if (!p) return { anchor: "" };
  if (p.startsWith("/")) return { path: normalizePath(p) };
  return { path: normalizePath(`${dirName(baseFile)}/${p}`) };
}

// "docs/architecture.md" -> { dir: "docs/", base: "architecture.md" }.
export function splitDirBase(relPath) {
  const p = String(relPath ?? ""), i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", base: p } : { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

// macOS's /tmp, /var and /etc are links into /private: a folder can be named either way.
const unprivate = (p) => p.replace(/^\/private(?=\/(tmp|var|etc)(\/|$))/, "");

// The path under root ("docs/a.md"), "" for root itself, null when it's outside.
export function relFromRoot(root, absPath) {
  const r = unprivate(normalizePath(root)), a = unprivate(normalizePath(absPath));
  if (!r || !a) return null;
  if (a === r) return "";
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return a.startsWith(prefix) ? a.slice(prefix.length) : null;
}

// A link's scheme for words ("vscode:"), never the link itself (it can be long, or hold a home path).
export function linkScheme(href) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(href ?? "").trim());
  return m ? `${m[1].slice(0, 24).toLowerCase()}:` : "other";
}

// Files moved to another folder (its terminal's cd, another space): the open file (relative to the
// old root) as a path under the new one, when it's there too on the same machine; else null.
export function keptFile(oldRoot, file, oldOn, cwd, on) {
  if (!oldRoot || !file || !cwd || (oldOn ?? null) !== (on ?? null)) return null;
  return relFromRoot(cwd, `${oldRoot}/${file}`) || null;
}

// A trash from any copy of Files: what the open file does when it was in what went (isUnder).
// The copy whose menu asked (it said "Its unsaved edits are lost too") closes it; another copy with
// a draft keeps the draft, as for a file deleted on disk ("Save as new"); without one it closes.
export function afterTrash({ under, dirty, asked }) {
  if (!under) return null;
  return dirty && !asked ? "keep" : "close";
}

// The UTF-16 offset of a 1-based line and column, for EditorState.set_selected_range. A line past
// the end goes to the end; a column past the line's end stops at it.
export function offsetForLine(text, line, col = 1) {
  const s = String(text ?? "");
  let at = 0;
  for (let n = 1; n < Math.max(1, Number(line) || 1); n++) {
    const next = s.indexOf("\n", at);
    if (next < 0) return s.length;
    at = next + 1;
  }
  const end = s.indexOf("\n", at);
  const lineEnd = end < 0 ? s.length : end;
  return Math.min(at + Math.max(0, (Number(col) || 1) - 1), lineEnd);
}

// The tree's rows with a filter: entries (dir path -> [{ name, dir }], "" the root), expanded (the
// open folders). Folders first as listed. With a query, a row stays when its name matches (case-
// insensitive) or it's a loaded folder holding a match, and those folders show open.
// Returns [{ path, name, dir, depth, open }].
export function filterEntries(entries, expanded, query, limit = 5000) {
  const q = String(query ?? "").trim().toLowerCase();
  const get = (p) => (entries instanceof Map ? entries.get(p) : entries?.[p]) ?? [];
  const open = (p) => (expanded instanceof Set ? expanded.has(p) : Boolean(expanded?.[p]));
  const hits = new Map();
  const holds = (path, depth = 0) => {
    if (hits.has(path)) return hits.get(path);
    let any = false;
    if (depth < 40) for (const e of get(path)) {
      const child = path ? `${path}/${e.name}` : e.name;
      if (e.name.toLowerCase().includes(q) || (e.dir && holds(child, depth + 1))) { any = true; break; }
    }
    hits.set(path, any);
    return any;
  };
  const out = [];
  const walk = (prefix, depth) => {
    if (depth > 40) return;
    for (const e of get(prefix)) {
      if (out.length >= limit) return;
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      const match = !q || e.name.toLowerCase().includes(q);
      const inside = q && e.dir ? holds(path) : false;
      if (!match && !inside) continue;
      const isOpen = e.dir && (q ? inside || open(path) : open(path));
      out.push({ path, name: e.name, dir: e.dir, depth, open: Boolean(isOpen) });
      if (isOpen) walk(path, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

// `rg --vimgrep` / `grep -rn` output to [{ path, matches: [{ line, col, text }] }], paths under root,
// files in the order found, at most maxMatches matches in all. truncated: more were left out.
export function parseSearchOutput(stdout, root, maxMatches = 200) {
  const groups = new Map();
  let count = 0, truncated = false;
  const prefix = root ? (String(root).endsWith("/") ? root : `${root}/`) : "";
  for (const raw of String(stdout ?? "").split("\n")) {
    if (!raw) continue;
    const m = /^(.+?):(\d+):(?:(\d+):)?(.*)$/.exec(raw);
    if (!m) continue;
    if (count >= maxMatches) { truncated = true; break; }
    let path = m[1];
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
    if (path.startsWith("./")) path = path.slice(2);
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push({ line: Number(m[2]), col: m[3] ? Number(m[3]) : 1, text: m[4].replace(/\r$/, "").slice(0, 300) });
    count++;
  }
  return { results: [...groups.entries()].map(([path, matches]) => ({ path, matches })), count, truncated };
}

// Editors with a command line, as Compozy lists them: id, name, the command, the macOS bundle
// id, and how a line is passed ("colon": file:line, "goto": -g file:line, "line": --line n file).
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
const IMAGE_VIEWERS = new Set(["com.apple.Preview", "preview"]);
const isTexty = (ext) => !IMAGES.has(ext) && ext !== "svg" ? !BINARY_EXTS.has(ext) : false;

// The Open with… list for a file: the catalog's installed editors (catalogInstalled: ids) and the
// apps the system lists for it (macApps: [{ name, path, bundle }]: macOS's, or on Linux the .desktop
// files settingsfacts' parseLinuxApps reads, bundle their desktop id), each once (by bundle, else name),
// without helper apps nested in another .app or test browsers. Order: for text, code editors first
// (Xcode after them), then the rest; for images, image viewers first. Each:
// { id, label, kind: "editor" | "app", binary?, bundle?, path?, lineStyle? }.
export function mergeApps({ catalogInstalled = [], macApps = [], ext = "", platform = "macos" } = {}) {
  const out = [], seenBundle = new Set(), seenName = new Set();
  const add = (a) => {
    const b = a.bundle ? String(a.bundle).toLowerCase() : null, n = String(a.label).toLowerCase();
    if ((b && seenBundle.has(b)) || seenName.has(n)) return;
    if (b) seenBundle.add(b);
    seenName.add(n);
    out.push(a);
  };
  const installed = new Set(catalogInstalled);
  for (const e of EDITOR_CATALOG) if (installed.has(e.id)) add({ id: e.id, label: e.label, kind: "editor", binary: e.binary, bundle: e.bundle, lineStyle: e.lineStyle, cli: true });
  if (platform === "macos" || platform === "linux" || platform === "windows") for (const a of macApps ?? []) {
    const path = String(a?.path ?? "");
    if (!a?.name || !path) continue;
    if (/\.app\/.+\.app/i.test(path) || /\.app\/Contents\//i.test(path)) continue;
    if (/ms-playwright|puppeteer|Google Chrome for Testing|\/Library\/Caches\/|\/\.cache\//i.test(path)) continue;
    const ab = String(a.bundle ?? "").toLowerCase();
    const cat = ab ? EDITOR_CATALOG.find((e) => e.bundle.toLowerCase() === ab || (e.desktop ?? []).some((d) => d.toLowerCase() === ab) || e.exe === ab) : undefined;
    if (cat) {
      // Its command line was found already: keep it (line numbers), and note where the app is.
      const had = out.find((x) => x.id === cat.id);
      if (had) { if (!had.path) had.path = path; continue; }
      add({ id: cat.id, label: cat.label, kind: "editor", binary: cat.binary, bundle: cat.bundle, lineStyle: cat.lineStyle, path });
      continue;
    }
    add({ id: `app:${a.bundle || a.name}`, label: String(a.name).replace(/\.app$/i, ""), kind: "app", bundle: a.bundle || null, path });
  }
  const e = String(ext ?? "").toLowerCase(), image = IMAGES.has(e), texty = isTexty(e) || e === "svg";
  // Windows lists no app for many text types (.md, .ts, no extension): Notepad opens any of them.
  if (platform === "windows" && texty) add({ id: "app:notepad", label: "Notepad", kind: "app", binary: "notepad" });
  const rank = (a) => {
    const viewer = IMAGE_VIEWERS.has(String(a.bundle ?? "").toLowerCase()) || IMAGE_VIEWERS.has(String(a.bundle ?? "")) || a.label === "Preview";
    if (image) return viewer ? 0 : a.kind === "app" ? 1 : 2;
    if (texty) return a.id === "xcode" ? 1 : a.kind === "editor" ? 0 : 2;
    return a.kind === "app" ? 0 : 1;
  };
  return out.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a);
}

// The app to offer first for an extension: the one remembered for it, else the "default-app"
// setting (settings.jsonc "files", when it names "system" or an app of the list), else the last
// one used, else the first code editor that isn't Xcode (text), else the first app; with none,
// the system's opener ("system"). Returns an app of apps, or { id: "system", label: "System default", kind: "system" }.
export const SYSTEM_APP = { id: "system", label: "System default", kind: "system" };
export function pickDefaultApp(apps, prefs, ext, defaultApp = null) {
  const list = apps ?? [], e = String(ext ?? "").toLowerCase();
  const byId = (id) => (id === "system" ? SYSTEM_APP : list.find((a) => a.id === id));
  const remembered = prefs?.byExt?.[e] != null ? byId(prefs.byExt[e]) : null;
  if (remembered) return remembered;
  const setting = typeof defaultApp === "string" && defaultApp ? byId(defaultApp) : null;
  if (setting) return setting;
  const last = prefs?.last != null ? byId(prefs.last) : null;
  if (last && (!isTexty(e) || last.kind === "editor" || last.id === "system")) return last;
  if (isTexty(e)) {
    const editor = list.find((a) => a.kind === "editor" && a.id !== "xcode");
    if (editor) return editor;
  }
  if (last) return last;
  return list[0] ?? SYSTEM_APP;
}

// The prefs after opening a file with an app: the last one used and, when it was picked from the
// list (pinExt), remembered for its extension. The Open in button's own app isn't a pick: it
// leaves the extension free to follow the "default-app" setting.
export function rememberApp(prefs, ext, appId, pinExt = true) {
  const e = String(ext ?? "").toLowerCase();
  return { byExt: { ...(prefs?.byExt ?? {}), ...(e && pinExt ? { [e]: appId } : {}) }, last: appId };
}

// The prefs file's text to prefs (anything broken: none).
export function parsePrefs(text) {
  try {
    const p = JSON.parse(String(text ?? ""));
    if (!p || typeof p !== "object") return { byExt: {}, last: null };
    return { byExt: p.byExt && typeof p.byExt === "object" ? { ...p.byExt } : {}, last: typeof p.last === "string" ? p.last : null };
  } catch { return { byExt: {}, last: null }; }
}

// The command that opens a file with an app (line: 1-based or null). An editor whose command line was
// found (cli) runs it, with the line; one macOS listed without it opens as an app. app.id "system": the system's
// opener; "reveal": the file shown in Finder / Explorer / its folder.
// Linux: start a .desktop file's app with a file (gio, else gtk-launch, else the system's opener).
export const LINUX_LAUNCH_SH = 'command -v gio >/dev/null 2>&1 && exec gio launch "$1" "$2"; ' +
  'command -v gtk-launch >/dev/null 2>&1 && exec gtk-launch "$(basename "$1" .desktop)" "$2"; exec xdg-open "$2"';

// A path as the system writes it: backslashes on Windows (explorer and Windows apps take no "/";
// the mods join with "/" onto home(), which is C:\Users\…), as it is elsewhere.
export const nativePath = (p, platform) => platform === "windows" ? String(p).replace(/\//g, "\\") : p;

// Windows' own default for these runs them (a .js under Windows Script Host, a .bat in cmd): Default
// app opens a script in Notepad instead, and shows a program in Explorer.
const WIN_SCRIPTS = new Set(["js", "jse", "vbs", "vbe", "wsf", "wsh", "hta", "bat", "cmd", "reg", "ps1", "psm1", "sh"]);
const WIN_PROGRAMS = new Set(["exe", "msi", "com", "scr", "pif", "cpl", "lnk", "appx", "msix", "application"]);

// opts.winapps: ws-files' winapps.ps1 (Windows: an app Windows lists starts through its handler).
export function launchCommand(app, path, line, platform = "macos", opts = {}) {
  path = nativePath(path, platform);
  const at = line ? `${path}:${line}` : path;
  if (app?.id === "reveal") {
    if (platform === "macos") return { cmd: "open", args: ["-R", path] };
    if (platform === "windows") return { cmd: "explorer", args: [`/select,${path}`] };
    return { cmd: "xdg-open", args: [dirName(path) || "."] };
  }
  if (!app || app.id === "system") {
    if (platform === "macos") return { cmd: "open", args: [path] };
    if (platform === "windows") {
      const e = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
      if (WIN_SCRIPTS.has(e)) return { cmd: "notepad", args: [path] };
      if (WIN_PROGRAMS.has(e)) return { cmd: "explorer", args: [`/select,${path}`] };
      return { cmd: "explorer", args: [path] };
    }
    return { cmd: "xdg-open", args: [path] };
  }
  if (platform === "windows") {
    // A code editor found on PATH starts through Git's sh (VS Code's `code` is a sh script, the
    // JetBrains ones .cmd files); an app Windows lists through its handler, as Explorer does.
    if (app.kind === "editor" && app.binary && app.cli) {
      const c = editorCommand(app, path, line, at);
      return { cmd: "sh", args: ["-c", 'b=$0; command -v "$b" >/dev/null 2>&1 || b=$b.cmd; exec "$b" "$@"', c.cmd, ...c.args] };
    }
    if (app.path && opts.winapps) return { cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", nativePath(opts.winapps, platform), "open", path, app.path] };
    if (app.binary) return { cmd: app.binary, args: [path] };
    return { cmd: "explorer", args: [path] };
  }
  // Linux: an app found by its .desktop file (and no command line found for it) starts through it.
  const desktop = platform === "linux" && !app.cli && /\.desktop$/.test(String(app.path ?? ""));
  if (desktop) return { cmd: "sh", args: ["-c", LINUX_LAUNCH_SH, "open", app.path, path] };
  if (app.kind === "editor" && app.binary && (platform !== "macos" || !app.path || app.cli)) return editorCommand(app, path, line, at);
  if (platform === "macos") {
    if (app.path) return { cmd: "open", args: ["-a", app.path, path] };
    if (app.bundle) return { cmd: "open", args: ["-b", app.bundle, path] };
  }
  if (app.binary) return { cmd: app.binary, args: [path] };
  return platform === "windows" ? { cmd: "explorer", args: [path] } : { cmd: "xdg-open", args: [path] };
}

function editorCommand(app, path, line, at) {
  if (app.lineStyle === "goto") return { cmd: app.binary, args: line ? ["-g", at] : [path] };
  if (app.lineStyle === "line" || app.lineStyle === "xed") return { cmd: app.binary, args: line ? ["--line", String(line), path] : [path] };
  return { cmd: app.binary, args: [at] };
}

// An SVG's drawn size from its own text: width/height in px (or unitless), else its viewBox. Null when
// neither says.
export function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(String(text ?? ""))?.[0];
  if (!tag) return null;
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)(px)?\\s*["']`, "i").exec(tag);
  const w = attr("width"), h = attr("height");
  if (w && h && Number(w[1]) > 0 && Number(h[1]) > 0) return { w: Number(w[1]), h: Number(h[1]) };
  const vb = /\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(tag);
  if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return { w: Number(vb[1]), h: Number(vb[2]) };
  return null;
}

// An image's box in the room it has: its own size, never larger than the room (aspect kept). Unknown
// size: a box of up to 480 × 320 (the image is fitted inside it).
export function fitImage(w, h, roomW, roomH) {
  const iw = Number(w) > 0 ? Number(w) : Math.min(480, roomW), ih = Number(h) > 0 ? Number(h) : Math.min(320, roomH);
  const scale = Math.min(1, Math.max(1, roomW) / iw, Math.max(1, roomH) / ih);
  return { w: Math.max(1, Math.round(iw * scale)), h: Math.max(1, Math.round(ih * scale)) };
}

// Whether a target names the file open now (same machine, same file under the root shown): then it's
// only a cursor move, never a reload (which would drop an unsaved draft).
export function sameFile(open, target) {
  if (!open?.file || !open.root || !target?.path || target.isDir) return false;
  if ((open.on ?? null) !== (target.on ?? null)) return false;
  return relFromRoot(open.root, target.path) === open.file;
}

// The asks (shared "workspaces.files.open"): a short list, newest last, each done once (like
// "workspaces.view"). pushOpen adds one; one older than ASK_TTL is dropped, never done late.
export function pushOpen(queue, ask, now, id) {
  const list = (Array.isArray(queue) ? queue : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < ASK_TTL);
  return [...list, { ...ask, id, at: now }].slice(-ASK_KEEP);
}

// Whether a published target (shared "workspaces.files.target") is this copy's to open:
// "screen" for the full-size copy of that space, "tab"/"pane" for the beside pane of that tab,
// "overlay" never (an overlay copy gets its file in props). Fresh only (ASK_TTL), each id once.
export function targetFor(target, me, now, done) {
  if (!target || typeof target !== "object" || typeof target.id !== "string" || !target.path) return false;
  if (done?.has?.(target.id) || now - (target.at ?? 0) >= ASK_TTL || target.taken) return false;
  if (target.scope === "screen") return Boolean(me.screen) && (!target.space || target.space === me.space);
  if (target.scope === "tab" || target.scope === "pane") return Boolean(me.tab) && target.tab === me.tab;
  return false;
}

// --- The tree's right-click menu (main.js menuView) ---

// The rows of the menu for a file or folder, in groups (null between groups). where: "tree",
// "search" (a search row has no New file/New folder: the edit row lives in the tree) or "root"
// (the folder Files shows: the empty space under the tree, or its name; no relative path, and it
// isn't renamed, duplicated or trashed from here); remote: on
// another machine (no Open in, no Reveal: they start apps here); writes: the shell steps can run
// (not on Windows); blocked: the open file has unsaved edits under this path (Rename waits).
export function menuRows({ where = "tree", remote = false, writes = true, platform = "macos" } = {}) {
  const groups = [];
  if (where !== "search" && writes) groups.push(["new-file", "new-folder"]);
  const outside = [];
  if (!remote) outside.push("open-in", "reveal");
  outside.push("terminal");
  groups.push(outside);
  groups.push(where === "root" ? ["copy-path"] : ["copy-path", "copy-rel"]);
  if (writes && where !== "root") groups.push(["rename", "duplicate", "trash"]);
  const out = [];
  for (const g of groups) { if (out.length) out.push(null); out.push(...g); }
  return out;
}

// What a menu row says.
export function menuLabel(id, platform = "macos") {
  return {
    "new-file": "New file…", "new-folder": "New folder…", "open-in": "Open in",
    reveal: platform === "macos" ? "Reveal in Finder" : platform === "windows" ? "Show in Explorer" : "Show in folder",
    terminal: "New terminal here", "copy-path": "Copy path", "copy-rel": "Copy relative path",
    rename: "Rename…", duplicate: "Duplicate", trash: platform === "macos" ? "Move to Trash…" : platform === "windows" ? "Move to Recycle Bin…" : "Move to trash…",
  }[id] ?? id;
}

// Whether two names are the same entry on this machine: macOS (and Windows) folders don't
// tell case apart by default, so "Readme.md" is taken when "README.md" is there.
const sameName = (a, b, caseless) => (caseless ? a.toLowerCase() === b.toLowerCase() : a === b);

// What's wrong with a name typed in the tree's edit row, or null. mode: "file" or "folder" (a new
// one: "a/b.js" makes the folders on the way) or "rename" (one name, no "/"). taken: the names in
// the folder it goes in; old: the name being renamed (a rename that only changes case is fine).
// A rename may give a path too ("lib/auth.js" moves it into lib, made when it isn't there); isDir:
// a folder can't go inside itself.
export function nameProblem(name, { mode = "file", taken = [], old = null, caseless = true, isDir = false, windows = false } = {}) {
  const n = String(name ?? "");
  if (!n.trim()) return "Type a name";
  // On Windows a "\" is a folder step the shell turns into "/", past these checks ("..\..\x").
  if (windows && n.includes("\\")) return "Use / between folders";
  if (n !== n.trim()) return "A name can't start or end with a space";
  if (mode === "rename" && n.endsWith("/")) return "Type a name after the /";
  if (n.startsWith("/")) return "Type a name, not a path from /";
  const parts = n.split("/");
  if (parts.some((p, i) => !p && i < parts.length - 1)) return "Two / in a row";
  if (parts.some((p) => p === "." || p === "..")) return "A name can't be . or ..";
  if (n.includes("\0")) return "A name can't have that character";
  const first = parts.filter(Boolean)[0];
  if (mode === "rename") {
    if (isDir && old != null && parts.length > 1 && sameName(parts[0], old, caseless)) return "A folder can't go inside itself";
    if (parts.length > 1) return null; // a move: a name taken there is the shell step's to refuse
    if (old != null && n === old) return null; // unchanged: Enter just closes
    if (old != null && sameName(n, old, caseless)) return null; // only the case changes
    if (taken.some((t) => sameName(t, n, caseless))) return `${n} is already there`;
    return null;
  }
  // A new one: taken only when the whole name is a single part that's there (deeper parts are
  // checked by the shell step, which won't write over anything).
  if (parts.filter(Boolean).length === 1 && taken.some((t) => sameName(t, first, caseless))) return `${first} is already there`;
  return null;
}

// Where the name's extension starts (what Rename selects up to): "auth.test.js" → 9 ("auth.test"),
// ".env" → 4 (a dotfile has no extension), "Makefile" → its length. Folders: the whole name.
export function stemEnd(name, dir = false) {
  const n = String(name ?? "");
  if (dir) return n.length;
  const i = n.lastIndexOf(".");
  return i > 0 ? i : n.length;
}

// Duplicate's name: "auth copy.js", then "auth copy 2.js" and on, the first not taken.
export function copyName(name, taken = [], dir = false, caseless = true) {
  const n = String(name ?? ""), at = stemEnd(n, dir), stem = n.slice(0, at), ext = n.slice(at);
  for (let i = 1; i < 1000; i++) {
    const next = `${stem} copy${i > 1 ? ` ${i}` : ""}${ext}`;
    if (!taken.some((t) => sameName(t, next, caseless))) return next;
  }
  return `${stem} copy ${Date.now()}${ext}`;
}

// A path after the entry at `from` was renamed to `to` (all relative to the same root): itself
// or anything inside it moves along; anything else stays.
export function movedPath(path, from, to) {
  if (path == null) return path;
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

// Whether `path` is the entry at `gone` or inside it (absolute or relative alike).
export const isUnder = (path, gone) => path != null && gone != null && (path === gone || path.startsWith(`${gone}/`));

// The tree from the keyboard: where the cursor (a row's path, or null) goes on a key, and what to do
// there. ↑ ↓ move (from no cursor: the first row, or the last for ↑); → opens a closed folder, and on
// an open one goes to its first row; ← closes an open folder, else goes up to the folder holding the
// row; Enter opens a file, or opens or closes a folder. rows: filterEntries' [{ path, dir, depth, open }].
// Returns { cursor, act }: act "open" or "close" (that folder), "pick" (that file), or null.
export function treeStep(rows, cursor, key) {
  const list = Array.isArray(rows) ? rows : [], n = list.length;
  if (!n) return { cursor: null, act: null };
  const i = list.findIndex((r) => r.path === cursor);
  const at = (j) => ({ cursor: list[j].path, act: null });
  if (key === "down") return at(i < 0 ? 0 : Math.min(n - 1, i + 1));
  if (key === "up") return at(i < 0 ? n - 1 : Math.max(0, i - 1));
  if (i < 0) return at(0);
  const r = list[i];
  if (key === "right") {
    if (!r.dir) return at(i);
    if (!r.open) return { cursor: r.path, act: "open" };
    return list[i + 1] && list[i + 1].depth > r.depth ? at(i + 1) : at(i);
  }
  if (key === "left") {
    if (r.dir && r.open) return { cursor: r.path, act: "close" };
    for (let j = i - 1; j >= 0; j--) if (list[j].depth < r.depth) return at(j);
    return at(i);
  }
  if (key === "enter") return { cursor: r.path, act: r.dir ? (r.open ? "close" : "open") : "pick" };
  return { cursor: list[i].path, act: null };
}

// Whether the switcher's sidebar copy is away (shared "workspaces.switcher.alive" { at }, which it
// refreshes every 5s): the key missing or older than 15s. An ask it drains would then go nowhere.
export const SWITCHER_FRESH = 15000;
export function switcherAway(alive, now) {
  const at = Number(alive?.at);
  return !Number.isFinite(at) || now - at > SWITCHER_FRESH;
}

// The filter box's flat list ---------------------------------------------------------
// Every file under the folder, names only, for the filter box: git's own list in a repo (tracked and
// untracked, not ignored; ignored ones too while Show ignored is on), else find (no dot folders or
// node_modules while it's off). Folders come from the files' paths, so an empty folder isn't listed.
// $1 the folder, $2 "git" or "", $3 "1" with Show ignored, $4 the most lines (one more says it was cut).
// In a repo, after a line holding only \001, the paths to leave out: tracked files deleted from the
// folder, and submodules (git lists one as a file; it's a folder of another repo).
export const LIST_CAP = 20000;
export const LIST_ALL_SH = `cd "$1" || exit 1
{ if [ "$2" = git ]; then
    git --no-optional-locks ls-files -z --cached --others --exclude-standard | tr '\\000' '\\n'
    [ "$3" = 1 ] && git --no-optional-locks ls-files -z --others --ignored --exclude-standard | tr '\\000' '\\n'
  elif [ "$3" = 1 ]; then find . -mindepth 1 -name .git -prune -o ! -type d -print
  else find . -mindepth 1 \\( -name '.*' -o -name node_modules \\) -prune -o ! -type d -print
  fi; } | head -n "$4"
if [ "$2" = git ]; then
  printf '\\001\\n'
  git --no-optional-locks ls-files -z --deleted | tr '\\000' '\\n' | head -n "$4"
  git --no-optional-locks -c core.quotepath=off ls-files -s | sed -n 's/^160000 [0-9a-f]* [0-9]\t//p' | head -n 1000
fi; true`;

// The listing's output: relative paths, each once ("./" gone), without those after the \001 line
// (deleted, submodules), and whether it was cut at `cap`.
export function parseListing(stdout, cap = LIST_CAP) {
  const text = String(stdout ?? ""), at = text.indexOf("\u0001\n");
  const clean = (line) => { const p = line.replace(/^\.\//, "").replace(/\/+$/, ""); return p && p !== "." ? p : null; };
  const seen = new Set();
  for (const line of (at < 0 ? text : text.slice(0, at)).split("\n")) { const p = clean(line); if (p) seen.add(p); }
  const all = [...seen], cut = all.length > cap;
  const out = new Set(at < 0 ? [] : text.slice(at + 2).split("\n").map(clean).filter(Boolean));
  return { paths: all.slice(0, cap).filter((p) => !out.has(p)), cut };
}

// The line under the flat list. where: the folder's name; skipped: hidden files and folders (a name
// starting with a dot) and node_modules were left out (find, without Show ignored).
export function foundLine({ busy = false, listed = true, total = 0, cut = false, where = "the folder", skipped = false, max = 200, cap = LIST_CAP } = {}) {
  if (busy && !listed) return "Looking in every folder…";
  const first = `the first ${grouped(cap)} names of ${where}`;
  if (!total) {
    if (cut) return `No file or folder in ${first} is called that`;
    return skipped ? `No file or folder in ${where} is called that (hidden files and folders and node_modules aren't looked in)` : `No file or folder in ${where} is called that`;
  }
  if (total > max) return `The first ${max} of ${grouped(total)}${cut ? "+" : ""} · type more to narrow`;
  if (cut) return `${total} in ${first} · names only`;
  return skipped ? `${total} in ${where}, not counting hidden files and folders or node_modules · names only` : `${total} in every folder of ${where} · names only`;
}

// The rows for a query: every file and folder whose name holds it (any case), the best first: the
// name starting with it, then files before folders, then the shorter name, then the shallower path, then by path. `limit` rows,
// and how many there are in all. Each row: { path, name, dir, folder (its parent, "" the top), at
// (where the query starts in the name) }.
export function findNames(paths, query, limit = 200) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return { rows: [], total: 0 };
  const dirs = new Set(), hits = [];
  const consider = (path, dir) => {
    const i = path.lastIndexOf("/"), name = path.slice(i + 1), at = name.toLowerCase().indexOf(q);
    if (at >= 0) hits.push({ path, name, dir, folder: i < 0 ? "" : path.slice(0, i), at });
  };
  for (const p of paths ?? []) {
    consider(p, false);
    for (let i = p.indexOf("/"); i > 0; i = p.indexOf("/", i + 1)) {
      const d = p.slice(0, i);
      if (!dirs.has(d)) { dirs.add(d); consider(d, true); }
    }
  }
  const depth = (p) => p.split("/").length;
  hits.sort((a, b) => Number(a.at !== 0) - Number(b.at !== 0) || Number(a.dir) - Number(b.dir) || a.name.length - b.name.length
    || depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { rows: hits.slice(0, limit), total: hits.length };
}

// A count with thousands marked ("1,240"): the mods' toLocaleString doesn't group.
export const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// The recovery copy of an unsaved draft -----------------------------------------------
// Written under appHome()/data/ws-files/drafts/<draftKey>.json while a file has unsaved edits:
// { v: 1, abs, on, text, base (textHash of the file as it was read), at }. Gone on save, discard,
// reload, or when the edits are typed back to the file.

// FNV-1a, 32 bits, as 8 hex digits.
function fnv(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
// A file's name in the drafts folder: the same for the same file on the same machine.
export function draftKey(abs, on) {
  const s = `${on ?? ""}\u0000${String(abs ?? "").replace(/\\/g, "/")}`;
  return fnv(s, 0x811c9dc5) + fnv(s, 0x01000193);
}
// A text's fingerprint (whether the file changed on disk since the draft).
export function textHash(s) {
  const t = String(s ?? "");
  return `${t.length}-${fnv(t, 0x811c9dc5)}${fnv(t, 0x2f5a1e3d)}`;
}

// What a recovery copy means for the file just opened with `disk` as its text: null (none, or not
// this file), "drop" (nothing to recover: the draft is the file as it is), else { at, changed }
// (changed: the file is no longer what the draft was made on).
export function draftOffer(draft, { abs, on, disk }) {
  if (!draft || typeof draft !== "object" || typeof draft.text !== "string") return null;
  if (String(draft.abs ?? "").replace(/\\/g, "/") !== String(abs ?? "").replace(/\\/g, "/") || (draft.on ?? null) !== (on ?? null)) return null;
  if (draft.text === disk) return "drop";
  const at = Number(draft.at);
  return { at: Number.isFinite(at) && at > 0 ? at : null, changed: draft.base !== textHash(disk) };
}

// The strip's title: with no time that can be read, none.
export function draftTitle(at, now) {
  const when = Number.isFinite(at) && at > 0 ? draftWhen(at, now) : "";
  return when ? `An unsaved draft from ${when} is still here.` : "An unsaved draft is still here.";
}

// A copy is written only when it can be read back whole: the mods' fs writes up to 8 MiB at once.
export const DRAFT_MAX_BYTES = 8_000_000;
export function draftFits(body) {
  const s = String(body ?? "");
  if (s.length * 3 <= DRAFT_MAX_BYTES) return true;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3;
    if (n > DRAFT_MAX_BYTES) return false;
  }
  return true;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// When a draft was written, in the strip: "14:02" today, "Yesterday 14:02", else "Nov 24 14:02".
export function draftWhen(at, now) {
  const d = new Date(at), n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(n)) return hm;
  const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (day(d) === day(y)) return `Yesterday ${hm}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${hm}`;
}

// A menu's lit row after ↑ or ↓ (wrapping), or null for any other key; n rows, at the lit one.
export function stepRow(at, n, key) {
  if (!(n > 0) || (key !== "up" && key !== "down")) return null;
  const i = Number.isInteger(at) && at >= 0 && at < n ? at : 0;
  return key === "down" ? (i + 1) % n : (i + n - 1) % n;
}

// Discard's two presses: the first arms it ("Discard changes?"), a press within 500 ms of that
// doesn't count (a double-click only asks), a later one discards. A clock set back counts.
export const ASK_WAIT = 500;
export function discardStep(armedAt, now) {
  if (!armedAt) return "arm";
  const d = now - armedAt;
  return d >= 0 && d < ASK_WAIT ? "wait" : "discard";
}
