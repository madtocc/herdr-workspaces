#!/bin/sh
# Copies the live layout and mods from your Herdr home into this package, so the
# package matches what runs. Leaves out what Herdr writes itself (jsconfig.json,
# gpui-kit.d.ts) and your own workspaces (~/.herdr/workspaces).
#
#   scripts/sync-from-home.sh            # from ~/.config/herdr-app
#   HERDR_APP_HOME=/other/home scripts/sync-from-home.sh
set -eu
src=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
dst=$(cd "$(dirname "$0")/.." && pwd)

# The runner and the Automations screen read `when:`, `model:` and `effort:`, and run a `check:`, with the same files.
for shared in when.js knobs.js check.js; do
  cmp -s "$src/mods/ws-switcher/$shared" "$src/mods/ws-automations/$shared" || {
    echo "mods/ws-switcher/$shared and mods/ws-automations/$shared differ: make them the same first" >&2
    exit 1
  }
done

mkdir -p "$dst/layouts"
cp "$src/layouts/workspaces.json" "$dst/layouts/workspaces.json"

for mod in ws-switcher ws-spaces ws-agents ws-board ws-presets ws-chrome ws-automations ws-tabs ws-new-menu; do
  rm -rf "$dst/mods/$mod"
  mkdir -p "$dst/mods/$mod"
  (cd "$src/mods/$mod" && find . -type f ! -name jsconfig.json ! -name gpui-kit.d.ts ! -name '.*' ! -name '*.error') |
    while read -r f; do
      mkdir -p "$dst/mods/$mod/$(dirname "$f")"
      cp -p "$src/mods/$mod/$f" "$dst/mods/$mod/$f"
    done
done
echo "synced from $src"
