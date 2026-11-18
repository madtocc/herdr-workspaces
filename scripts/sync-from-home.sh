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

# The board runs a repo's setup script with the file the Worktrees tab writes them with.
cmp -s "$src/mods/ws-worktrees/treescripts.js" "$src/mods/ws-board/treescripts.js" || {
  echo "mods/ws-worktrees/treescripts.js and mods/ws-board/treescripts.js differ: make them the same first" >&2
  exit 1
}

# The board's GitHub view and the watcher of taken cards read GitHub by the same rules.
cmp -s "$src/mods/ws-switcher/ghfacts.js" "$src/mods/ws-board/ghfacts.js" || {
  echo "mods/ws-switcher/ghfacts.js and mods/ws-board/ghfacts.js differ: make them the same first" >&2
  exit 1
}

mkdir -p "$dst/layouts"
cp "$src/layouts/workspaces.json" "$dst/layouts/workspaces.json"

for mod in ws-switcher ws-spaces ws-agents ws-board ws-worktrees ws-presets ws-chrome ws-automations ws-tabs ws-new-menu ws-toast; do
  rm -rf "$dst/mods/$mod"
  mkdir -p "$dst/mods/$mod"
  (cd "$src/mods/$mod" && find . -type f ! -name jsconfig.json ! -name gpui-kit.d.ts ! -name '.*' ! -name '*.error') |
    while read -r f; do
      mkdir -p "$dst/mods/$mod/$(dirname "$f")"
      cp -p "$src/mods/$mod/$f" "$dst/mods/$mod/$f"
    done
done
# Your copy says which version it is, so CHANGELOG.md can tell you what's new since.
cp "$dst/VERSION" "$dst/mods/ws-switcher/VERSION"
echo "synced from $src"
