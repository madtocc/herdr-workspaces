#!/bin/sh
# A second Herdr for trying the workspaces mods: its own window, core, home and
# demo workspaces under /tmp. Nothing in it touches your real window, your
# terminals or ~/.herdr, and its mods are copies of the live ones
# (~/.config/herdr-app/mods), so a test can change them freely.
#
#   sandbox.sh up        make it and open its window, behind your other windows
#   sandbox.sh sync      copy the live mods in again (Herdr reloads them)
#   sandbox.sh app ...   herdr-app, asking the sandbox's window: status, do, shot, check
#   sandbox.sh hc ...    hc, on the sandbox's core
#   sandbox.sh run ...   any command with the sandbox's environment
#   sandbox.sh quit      close its window; its core and background runner keep going
#   sandbox.sh down      end its window, core and terminals, and delete it
#
# Agents aren't signed in there (it has another HOME): Claude stops at its
# first-run questions, which is enough to see a run start, show in its tab and
# be told apart from one that's working. gh isn't signed in either: test GitHub
# against a throwaway workspace in the real setup.
# HERDR_WS_SANDBOX picks another folder than /tmp/herdr-ws-sandbox.
set -eu

root=${HERDR_WS_SANDBOX:-/tmp/herdr-ws-sandbox}
live=${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app
bin=$(command -v herdr-app) || { echo "sandbox: herdr-app isn't on PATH" >&2; exit 1; }
path=$PATH

export HOME="$root/home"
export HC_SESSION=ws-sandbox HERDR_APP_HOME="$HOME/.config/herdr-app" HERDR_APP_NO_SOUND=1
export PATH="$HERDR_APP_HOME/mods/ws-switcher/bin:$path"
unset XDG_CONFIG_HOME XDG_STATE_HOME HC_SOCKET HERDR_ENV

running() { herdr-app status >/dev/null 2>&1; }

sync() {
  mkdir -p "$HERDR_APP_HOME"
  # What decides how Herdr looks and behaves: not the window's own state (your spaces and tabs).
  for f in mods layouts themes icons keys.json settings.json programs.json installed.json seen.json; do
    [ -e "$live/$f" ] || continue
    if [ -d "$live/$f" ]; then mkdir -p "$HERDR_APP_HOME/$f" && rsync -a --delete "$live/$f/" "$HERDR_APP_HOME/$f/"
    else cp "$live/$f" "$HERDR_APP_HOME/$f"; fi
  done
}

demo() {
  mkdir -p "$HOME/.herdr/automations" "$HOME/.config/herdr-core/templates"
  # The layout your window uses, and no first-run welcome.
  if [ ! -e "$HERDR_APP_HOME/shared.json" ]; then
    layout=$(grep -o '"layout": *"[^"]*"' "$live/shared.json" 2>/dev/null | head -1)
    printf '{%s"frame.welcomed":"finished"}\n' "${layout:+$layout,}" >"$HERDR_APP_HOME/shared.json"
  fi
  n=1
  for ws in "Acme:api web" "Blog:site"; do
    name=${ws%%:*} id=$(echo "${ws%%:*}" | tr 'A-Z' 'a-z')
    dir="$HOME/.herdr/workspaces/$id"
    [ -e "$dir" ] && continue
    mkdir -p "$dir"
    folders=""
    for f in ${ws#*:}; do
      mkdir -p "$HOME/work/$id/$f"
      git -C "$HOME/work/$id/$f" init -q 2>/dev/null || true
      folders="$folders\"$f\", "
    done
    printf '{\n  "name": "%s",\n  "color": "ansi%s",\n  "root": "~/work/%s",\n  "folders": [%s],\n}\n' "$name" "$((n + 3))" "$id" "$folders" >"$dir/workspace.jsonc"
    printf '<!-- What agents in %s should know. -->\n' "$name" >"$dir/AGENTS.md"
    n=$((n + 1))
  done
  [ -e "$HOME/.config/herdr-core/templates/reviewer.md" ] || printf -- '---\ndescription: Reviews a change\ncommand: claude\n---\nReview what you are given and say what you would change.\n' >"$HOME/.config/herdr-core/templates/reviewer.md"
}

case ${1:-} in
  up)
    sync; demo
    if running; then echo "sandbox: its window is open already"; exit 0; fi
    real=$(readlink "$bin" 2>/dev/null || echo "$bin"); app=${real%/Contents/MacOS/*}
    if [ "$(uname)" = Darwin ] && [ -d "$app" ] && [ "$app" != "$real" ]; then
      # -g: it doesn't come to the front. -n: beside the Herdr that's already open.
      open -g -n -a "$app" --env "HOME=$HOME" --env "HC_SESSION=$HC_SESSION" --env "HERDR_APP_HOME=$HERDR_APP_HOME" --env HERDR_APP_NO_SOUND=1 --env "PATH=$PATH"
    else
      nohup herdr-app >"$root/window.log" 2>&1 &
    fi
    i=0; until running; do i=$((i + 1)); [ "$i" -gt 60 ] && { echo "sandbox: its window didn't come up" >&2; exit 1; }; sleep 0.5; done
    echo "sandbox: up in $root (workspaces Acme and Blog)"
    ;;
  sync) sync ;;
  app) shift; exec herdr-app "$@" ;;
  hc) shift; exec hc "$@" ;;
  run) shift; exec "$@" ;;
  quit) running && herdr-app do app.quit >/dev/null 2>&1 || true ;;
  down)
    if running; then herdr-app do app.quit >/dev/null 2>&1 || true; fi
    [ -e "$HOME/.herdr/runner/switch" ] && echo off >"$HOME/.herdr/runner/switch"
    hc server stop >/dev/null 2>&1 || true
    case $root in /tmp/*|/private/tmp/*|/var/tmp/*) rm -rf "$root" ;; *) echo "sandbox: left $root in place (not under /tmp)" ;; esac
    ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
