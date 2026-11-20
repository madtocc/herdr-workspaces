#!/bin/sh
# Makes a release: CHANGELOG.md's "## [Unreleased]" becomes "## [<version>] - <today>",
# VERSION and mods/ws-switcher/VERSION say <version>, and it's committed and tagged
# v<version>. Nothing leaves this computer unless you add --publish, which pushes
# the commit and tag and makes a GitHub release with that version's notes (people
# watching the repo's releases are notified).
#
#   scripts/release.sh 0.2.0             # local: commit and tag
#   scripts/release.sh 0.2.0 --publish   # also push and make the GitHub release
#   scripts/release.sh --notes 0.2.0     # print a version's notes
#
# Versions: the middle number for anything new, the last for fixes only.
set -eu
cd "$(dirname "$0")/.."

notes() { # the lines under "## [$1]", up to the next version
  awk -v v="$1" '/^## \[/ { on = index($0, "## [" v "]") == 1; next } on' CHANGELOG.md |
    sed -e '/./,$!d' | awk 'NF { for (; n > 0; n--) print ""; print; next } { n++ }'
}

if [ "${1:-}" = --notes ]; then notes "${2:?version}"; exit; fi
v=${1:?usage: release.sh <version> [--publish]}
publish=${2:-}
echo "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "release: $v isn't x.y.z" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "release: v$v is already tagged" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "release: commit or stash your changes first" >&2; exit 1; }
# A drawing changed since the last release but its picture didn't: render it first. The same list as render-preview.sh.
last=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)
for pair in mods/ws-switcher/preview.svg:preview.png mods/ws-board/preview.svg:previews/board.png \
            mods/ws-board/preview-github.svg:previews/github.png mods/ws-worktrees/preview.svg:previews/worktrees.png \
            mods/ws-history/preview.svg:previews/history.png \
            mods/ws-automations/preview.svg:previews/automations.png; do
  svg=${pair%%:*} png=${pair#*:}
  [ -e "$png" ] || { echo "release: $png is missing: run scripts/render-preview.sh" >&2; exit 1; }
  if [ -n "$last" ] && ! git diff --quiet "$last" -- "$svg" && git diff --quiet "$last" -- "$png"; then
    echo "release: $svg changed since $last but $png didn't: run scripts/render-preview.sh" >&2; exit 1
  fi
done
grep -q '^## \[Unreleased\]' CHANGELOG.md || { echo "release: CHANGELOG.md has no ## [Unreleased]" >&2; exit 1; }
[ -n "$(notes Unreleased)" ] || { echo "release: ## [Unreleased] is empty" >&2; exit 1; }

# The version takes Unreleased's notes, and an empty Unreleased waits above it for the next change.
awk -v v="$v" -v d="$(date +%F)" '/^## \[Unreleased\]/ && !done { print; print ""; print "## [" v "] - " d; done = 1; next } { print }' CHANGELOG.md > CHANGELOG.md.new && mv CHANGELOG.md.new CHANGELOG.md
echo "$v" > VERSION
cp VERSION mods/ws-switcher/VERSION
git add CHANGELOG.md VERSION mods/ws-switcher/VERSION
git commit -q -m "release: $v"
git tag -a "v$v" -m "Workspaces $v"
echo "release: committed and tagged v$v"

if [ "$publish" = --publish ]; then
  git push -q origin HEAD "v$v"
  notes "$v" | gh release create "v$v" --title "Workspaces $v" --notes-file -
else
  echo "release: not pushed. To publish: git push origin HEAD v$v && scripts/release.sh --notes $v | gh release create v$v --title \"Workspaces $v\" --notes-file -"
fi
