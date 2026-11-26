// Cmd-click on a path in a terminal (an agent's output, ls, a compiler's file:line, an OSC 8 link):
// text, code, Markdown, SVG, images and folders open in Files, beside that terminal (the
// switcher's sidebar copy does the opening: shared "workspaces.files.open"). Other binaries (PDF,
// archives, media…) and paths that aren't there pass, so Herdr hands them to the system's opener.
// Herdr's own detector skips bare file names ("README.md" with no "/"), so those never get here.
// The "files" settings in ~/.herdr/settings.jsonc, read fresh on each click: "cmd-click" "off"
// passes every path (as without Files), "full" opens in Files full size; "catch" "everything"
// takes binaries too (only a path that isn't there passes).
import { home, shared, setShared, window, readTextFile } from "herdr";
import { exec } from "./posix.js";
import { parseRawLink, resolveTargetPath, shouldCatchLink, needsSniff, pushOpen } from "./filesfacts.js";
import { SETTINGS_FILE, parseSettings, fileSetting } from "./settingsfacts.js";

// "d", "f", "b" (a file whose first 8000 bytes hold a NUL: binary, when sniff asks) or "" for the
// path on that machine, and the path as its shell resolved it ("~/x" on another machine is only known
// there). sniff: the extension isn't one Files knows as text (filesfacts.js needsSniff).
async function lookup(path, on, sniff) {
  const win = !on && window()?.platform === "windows";
  const script = 'p=$1; case $p in "~") p=$HOME;; "~/"*) p=$HOME/${p#"~/"};; esac; ! command -v cygpath >/dev/null 2>&1 || p=$(cygpath -m "$p"); if [ -d "$p" ]; then printf "d\\n%s" "$p"; elif [ -f "$p" ]; then k=f; if [ "$2" = 1 ] && [ "$(head -c 8000 "$p" | tr -dc "\\000" | wc -c | tr -d " ")" != 0 ]; then k=b; fi; printf "%s\\n%s" "$k" "$p"; fi';
  const r = await exec("sh", ["-c", script, "sh", win ? String(path).replace(/\\/g, "/") : path, sniff ? "1" : "0"], { on: on ?? null, timeout: 10000 }).catch(() => null);
  if (r || !win) {
    const [kind = "", resolved = ""] = String(r?.stdout ?? "").split("\n");
    // Windows: the path as Windows writes it (sh printed it with "/").
    return { kind: kind.trim(), path: !resolved ? path : win ? resolved.replace(/\//g, "\\") : resolved };
  }
  {
    // No sh (Git for Windows isn't there): PowerShell.
    const r = await exec("powershell", ["-NoProfile", "-Command", "& { param($p) if (Test-Path -LiteralPath $p -PathType Container) { 'd' } elseif (Test-Path -LiteralPath $p -PathType Leaf) { 'f' } } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"]).catch(() => null);
    return { kind: String(r?.stdout ?? "").trim(), path };
  }
}

export async function handleLink(click) {
  const link = click?.link, source = click?.source ?? {};
  if (link?.kind !== "file") return "pass";
  // The file as it is now (a hand edit counts at once), else what ws-agents last read of it.
  const raw = await readTextFile(`${home()}/${SETTINGS_FILE}`).catch(() => null);
  const cfg = raw != null ? parseSettings(raw) : (shared("workspaces.settings") ?? parseSettings(null));
  const cmdClick = fileSetting(cfg, "cmd-click"), catchMode = fileSetting(cfg, "catch");
  if (cmdClick === "off") return "pass";
  const parsed = parseRawLink(link.raw);
  const on = source.machine ?? null;
  const target = !on && link.path ? link.path : resolveTargetPath(parsed.path, source.cwd, Boolean(on), home());
  if (!target) return "pass";
  const everything = catchMode === "everything";
  const found = await lookup(target, on, !everything && needsSniff(target));
  if (found.kind !== "d" && found.kind !== "f" && !(everything && found.kind === "b")) return "pass";
  if (!shouldCatchLink(found.path, found.kind === "d", catchMode)) return "pass";
  const now = Date.now(), id = `${now}-link-${Math.random().toString(36).slice(2, 8)}`;
  setShared("workspaces.files.open", pushOpen(shared("workspaces.files.open"), {
    path: found.path, isDir: found.kind === "d", line: parsed.line, col: parsed.col, on,
    space: source.space ?? null, tab: source.tab ?? null, placement: cmdClick === "full" ? "full" : "beside",
  }, now, id));
  return "handled";
}
