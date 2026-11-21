#!/bin/sh
# Renders the drawings to the pictures the README and RECIPE show, with headless
# Chrome at each drawing's own size (1280×800). Run it after every change to a
# drawing; release.sh refuses a release where a drawing changed and its picture didn't.
#
#   scripts/render-preview.sh            # every drawing in the list below
#   CHROME=/path/to/chrome scripts/render-preview.sh
#
# The drawings use demo names only (Acme, Globex, Initech; api, web, docs). Never
# put a real screenshot here: it would show your own workspaces.
set -eu
cd "$(dirname "$0")/.."
# drawing:picture. The first is also the picture Herdr's layout settings show. release.sh has the same list.
pairs="mods/ws-switcher/preview.svg:preview.png
mods/ws-board/preview.svg:previews/board.png
mods/ws-board/preview-github.svg:previews/github.png
mods/ws-worktrees/preview.svg:previews/worktrees.png
mods/ws-history/preview.svg:previews/history.png
mods/ws-automations/preview.svg:previews/automations.png
mods/ws-agents/preview.svg:previews/agent-menu.png"
chrome=${CHROME:-}
if [ -z "$chrome" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" google-chrome chromium chromium-browser; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then chrome=$c; break; fi
  done
fi
[ -n "$chrome" ] || { echo "render-preview: no Chrome or Chromium found; set CHROME" >&2; exit 1; }
# Text drawn in a font that isn't installed falls back, and the picture changes with it.
mkdir -p previews
for pair in $pairs; do
  svg=${pair%%:*} png=${pair#*:}
  size=$(sed -n 's/.*<svg[^>]* width="\([0-9]*\)" height="\([0-9]*\)".*/\1,\2/p' "$svg" | head -1)
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="${size:-1280,800}" --screenshot="$PWD/$png" "file://$PWD/$svg" >/dev/null 2>&1
  echo "render-preview: $svg -> $png (${size:-1280,800})"
done
