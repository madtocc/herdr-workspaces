#!/bin/sh
# Checks that the drawings agree on the parts every screen shares. Each drawing marks
# its parts with comments (<!-- sidebar -->, <!-- footer -->, …); the parts below must
# be the same, line for line (blank lines and indentation aside), as in the main
# drawing, mods/ws-switcher/preview.svg, and every drawing must have the tab bar's bell.
# render-preview.sh and release.sh run it, so a change to the sidebar or the tab bar
# that reached one drawing and not the others stops there.
#
#   scripts/check-drawings.sh          # the package's drawings
#   scripts/check-drawings.sh <dir>    # the drawings under <dir>/mods (your live copy)
set -eu
root=${1:-$(cd "$(dirname "$0")/.." && pwd)}
main="$root/mods/ws-switcher/preview.svg"
# The parts every drawing shares. A screen that really draws one differently (a row
# highlighted for its menu) keeps that part out of this list: the Agents list is out
# because the right-click drawing highlights a row, and the tab bar's left side and the
# status bar change with what each screen shows.
shared="sidebar|the switcher|spaces|footer"

part() { # the lines of part $1 in drawing $2, trimmed, blank lines dropped
  awk -v want="$1" '
    /<!--/ { name = $0; sub(/.*<!-- */, "", name); sub(/ *(-->|[:(]).*/, "", name); on = (name == want); next }
    on { gsub(/^[ \t]+|[ \t]+$/, ""); if (length) print }
  ' "$2"
}

[ -f "$main" ] || { echo "check-drawings: $main is missing" >&2; exit 1; }
bad=0
IFS='|'
for p in $shared; do
  [ -n "$(part "$p" "$main")" ] || { echo "check-drawings: the main drawing has no <!-- $p --> part" >&2; bad=1; }
done
unset IFS
for f in "$root"/mods/*/preview*.svg; do
  [ "$f" = "$main" ] && continue
  rel=${f#"$root"/}
  IFS='|'
  for p in $shared; do
    if [ "$(part "$p" "$f")" != "$(part "$p" "$main")" ]; then
      echo "check-drawings: $rel draws \"$p\" differently from mods/ws-switcher/preview.svg: copy that part over" >&2
      bad=1
    fi
  done
  unset IFS
  grep -q '<!-- the bell' "$f" || { echo "check-drawings: $rel has no bell in its tab bar (<!-- the bell … -->)" >&2; bad=1; }
done
[ "$bad" = 0 ] || exit 1
echo "check-drawings: the drawings agree on the sidebar, the switcher, spaces, the footer and the bell"
