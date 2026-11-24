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

# The + menu and Settings > Agents hide agents by the same rules.
cmp -s "$src/mods/ws-new-menu/hidefacts.js" "$src/mods/ws-settings/hidefacts.js" || {
  echo "mods/ws-new-menu/hidefacts.js and mods/ws-settings/hidefacts.js differ: make them the same first" >&2
  exit 1
}

# The Presets screen offers each agent's models and efforts from the same table.
cmp -s "$src/mods/ws-switcher/knobs.js" "$src/mods/ws-presets/knobs.js" || {
  echo "mods/ws-switcher/knobs.js and mods/ws-presets/knobs.js differ: make them the same first" >&2
  exit 1
}

# Settings (Features, Files, Experimental), the Agents list, the switcher's runners, the status bar and Files read the package's settings (~/.herdr/settings.jsonc) by the same rules.
for mod in ws-agents ws-switcher ws-status ws-files; do
  cmp -s "$src/mods/ws-settings/settingsfacts.js" "$src/mods/$mod/settingsfacts.js" || {
    echo "mods/ws-settings/settingsfacts.js and mods/$mod/settingsfacts.js differ: make them the same first" >&2
    exit 1
  }
done

# History's Wipe moves the same files to the Trash as the Agents list's (wipeTargets()) and draws its menu the same size.
cmp -s "$src/mods/ws-agents/menufacts.js" "$src/mods/ws-history/menufacts.js" || {
  echo "mods/ws-agents/menufacts.js and mods/ws-history/menufacts.js differ: make them the same first" >&2
  exit 1
}

# Changes and Files follow the same terminal, by the same rules.
cmp -s "$src/mods/ws-changes/follow.js" "$src/mods/ws-files/follow.js" || {
  echo "mods/ws-changes/follow.js and mods/ws-files/follow.js differ: make them the same first" >&2
  exit 1
}

# The bell's rules: the switcher keeps its log and count, ws-notifications draws its list.
cmp -s "$src/mods/ws-switcher/notif.js" "$src/mods/ws-notifications/notif.js" || {
  echo "mods/ws-switcher/notif.js and mods/ws-notifications/notif.js differ: make them the same first" >&2
  exit 1
}

mkdir -p "$dst/layouts"
cp "$src/layouts/workspaces.json" "$dst/layouts/workspaces.json"

for mod in ws-switcher ws-spaces ws-agents ws-board ws-worktrees ws-history ws-notes ws-presets ws-chrome ws-automations ws-tabs ws-new-menu ws-toast ws-status ws-settings ws-changes ws-files ws-notifications; do
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
