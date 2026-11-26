// posix.js: Herdr's exec, with the POSIX tools found on Windows. The mods run `sh -c …`, `rm`,
// `mkdir` and the package's bin/ scripts; Windows has none of them on PATH, so there they run
// from Git for Windows (bin\sh.exe, which sets up Git's PATH and HOME, runs them all).
// Elsewhere, and on another machine (`on`), it's Herdr's exec as it is. Every mod that runs
// commands has a copy of this file; the copies are kept the same.
import { exec as hostExec, window, appHome } from "herdr";

// Programs Git for Windows has in usr\bin that the mods call directly.
const TOOLS = new Set(["rm", "mkdir", "env", "sleep", "test", "head", "tail", "find", "mv", "cp", "ln", "chmod", "unlink", "cat", "ls", "grep", "sed", "awk", "tr", "touch", "date", "wc", "sort", "xargs", "stat", "readlink", "dirname", "basename", "printf", "kill"]);

let root = null;
// Git for Windows' folder: from `git --exec-path` (…/<mingw64|clangarm64>/libexec/git-core), else the default.
export function gitRoot() {
  root ??= hostExec("git", ["--exec-path"]).then((r) => {
    const m = (r.code === 0 ? r.stdout.trim() : "").replace(/\\/g, "/").match(/^(.*)\/[^/]+\/libexec\/git-core$/i);
    return m ? m[1] : "C:/Program Files/Git";
  }, () => "C:/Program Files/Git");
  return root;
}

export const onWindows = () => window()?.platform === "windows";

// Windows has no `trash` command: each `sh -c` script that names one gets a function that moves a
// path to the Recycle Bin with ws-switcher's herdr-ws-trash.ps1 (never a dialog: a file in use stays
// and `trash` fails, so the script's own fallback runs). The scripts' `command -v trash && trash "$p"`
// then reach the Recycle Bin, as macOS's trash reaches the Trash.
const trashFn = () => {
  const ps = `${appHome()}/mods/ws-switcher/bin/herdr-ws-trash.ps1`.replace(/\\/g, "/").replace(/'/g, "'\\''");
  return `trash() { [ -e "$1" ] || [ -L "$1" ] || return 1; powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '${ps}' "$(cygpath -w "$1")" >/dev/null 2>&1 && ! [ -e "$1" ]; }\n`;
};

export async function exec(cmd, args = [], opts) {
  if (opts?.on || !onWindows()) return hostExec(cmd, args, opts);
  const git = await gitRoot();
  if (cmd === "sh" || cmd === "bash") {
    if (args[0] === "-c" && typeof args[1] === "string" && /\btrash\b/.test(args[1])) args = ["-c", trashFn() + args[1], ...args.slice(2)];
    return hostExec(`${git}/bin/${cmd}.exe`, args, opts);
  }
  // Through Git's sh, so the tool sees Git's PATH too (`env … sh -c`, `find -exec`).
  if (TOOLS.has(cmd)) return hostExec(`${git}/bin/sh.exe`, ["-c", 'exec "$0" "$@"', cmd, ...args], opts);
  // A script by path with no extension (bin/herdr-ws-run), or a program found as …/node: Windows
  // can't start either by that name, sh's exec can (a #! line, or node.exe).
  const name = String(cmd).split(/[\\/]/).pop();
  if (name !== cmd && !name.includes(".")) return hostExec(`${git}/bin/sh.exe`, ["-c", 'exec "$0" "$@"', cmd, ...args], opts);
  return hostExec(cmd, args, opts);
}
