// Settings > Agents' "Bring agents back after a restart" while herdr-core's config.toml lacks the
// line: the line itself, for its Copy button, as the installer writes it and the README's Install
// gives it (step 3), and the clipboard script. No imports, so node can test it.

// The config.toml line for a platform ("macos", "linux", "windows").
export function resumeLine(platform) {
  if (platform === "windows") return 'shell = ["powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", ". \\"$env:USERPROFILE\\\\.config\\\\herdr-app\\\\mods\\\\ws-switcher\\\\bin\\\\herdr-ws-resume.ps1\\""]';
  return 'shell = ["/bin/sh", "-c", "r=\\"$HOME/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-resume\\"; [ -x \\"$r\\" ] && exec \\"$r\\"; exec \\"${SHELL:-/bin/sh}\\" -l"]';
}

// Puts $1 on the clipboard (as ws-vault's COPY). wl-copy and xclip stay behind to serve the
// clipboard: their output goes to /dev/null, so they don't hold the pipe exec waits on (the exit
// code still says whether it worked).
export const COPY = `
if command -v pbcopy >/dev/null 2>&1; then printf %s "$1" | pbcopy
elif command -v wl-copy >/dev/null 2>&1; then printf %s "$1" | wl-copy >/dev/null 2>&1
elif command -v xclip >/dev/null 2>&1; then printf %s "$1" | xclip -selection clipboard >/dev/null 2>&1
elif command -v powershell >/dev/null 2>&1; then HERDR_CLIP=$1 powershell -NoProfile -NonInteractive -Command 'for ($i = 0; $i -lt 5; $i++) { try { Set-Clipboard -Value $env:HERDR_CLIP -ErrorAction Stop; exit 0 } catch { Start-Sleep -Milliseconds 150 } }; exit 1'
else echo "no clipboard command (pbcopy, wl-copy, xclip, PowerShell)" >&2; exit 1; fi`;
