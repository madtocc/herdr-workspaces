#!/bin/sh
# Renders the drawing (mods/ws-switcher/preview.svg, also the picture Herdr's
# layout settings show) to preview.png, the README's and RECIPE's picture, with
# headless Chrome at 1280×800. Run it after every change to the drawing; release.sh
# refuses a release where the drawing changed and preview.png didn't.
#
#   scripts/render-preview.sh            # preview.svg -> preview.png
#   CHROME=/path/to/chrome scripts/render-preview.sh
#
# The drawing uses demo names only (Acme, Globex, Initech; api, web, docs). Never
# put a real screenshot here: it would show your own workspaces.
set -eu
cd "$(dirname "$0")/.."
svg=mods/ws-switcher/preview.svg
chrome=${CHROME:-}
if [ -z "$chrome" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" google-chrome chromium chromium-browser; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then chrome=$c; break; fi
  done
fi
[ -n "$chrome" ] || { echo "render-preview: no Chrome or Chromium found; set CHROME" >&2; exit 1; }
# Text drawn in a font that isn't installed falls back, and the picture changes with it.
size=$(sed -n 's/.*<svg[^>]* width="\([0-9]*\)" height="\([0-9]*\)".*/\1,\2/p' "$svg" | head -1)
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="${size:-1280,800}" --screenshot="$PWD/preview.png" "file://$PWD/$svg" >/dev/null 2>&1
echo "render-preview: $svg -> preview.png (${size:-1280,800})"
