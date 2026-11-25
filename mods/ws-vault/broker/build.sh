#!/bin/sh
# Builds the Herdr Vault broker: build.sh <output path> [extra swiftc flags…]
#
# Compiles vaultd.swift (beside this script) with /usr/bin/swiftc, signs it ad-hoc with the
# hardened runtime, and checks the signature. Ad-hoc on purpose: the Keychain items trust this
# exact build, so a rebuilt or changed binary can't read them without macOS asking the person.
# Extra flags go to swiftc (the tests pass -D VAULTD_TEST). Exits non-zero with a plain message
# when a step fails; the output path is only replaced by a build that passed every step.
set -eu

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: build.sh <output path> [extra swiftc flags…]" >&2
  exit 2
fi
out=$1
shift
here=$(cd "$(dirname "$0")" && pwd)
src="$here/vaultd.swift"

[ -f "$src" ] || { echo "build.sh: $src is missing" >&2; exit 1; }
[ -x /usr/bin/swiftc ] || { echo "build.sh: /usr/bin/swiftc isn't there; install Apple's command line tools (xcode-select --install)" >&2; exit 1; }
[ -x /usr/bin/codesign ] || { echo "build.sh: /usr/bin/codesign isn't there" >&2; exit 1; }

dir=$(dirname "$out")
mkdir -p "$dir" || { echo "build.sh: can't make $dir" >&2; exit 1; }
tmp="$out.building.$$"
trap 'rm -f "$tmp"' EXIT INT TERM

# Swift 5 language mode: the broker uses plain threads and locks, not Swift 6's strict checking.
# -suppress-warnings: the Keychain access-list calls it needs are deprecated (they still work).
if ! /usr/bin/swiftc -O -swift-version 5 -suppress-warnings "$src" -o "$tmp" "$@"; then
  echo "build.sh: compiling vaultd.swift failed" >&2
  exit 1
fi
if ! /usr/bin/codesign --force --sign - --options runtime --identifier dev.herdr.ws-vaultd "$tmp" 2>/dev/null; then
  echo "build.sh: signing failed" >&2
  exit 1
fi
if ! /usr/bin/codesign --verify --strict "$tmp"; then
  echo "build.sh: the signature doesn't verify" >&2
  exit 1
fi
if ! /usr/bin/codesign -dv "$tmp" 2>&1 | grep -q '^CodeDirectory .*flags=.*(adhoc,runtime)'; then
  echo "build.sh: the build isn't ad-hoc signed with the hardened runtime" >&2
  exit 1
fi
mv -f "$tmp" "$out"
trap - EXIT INT TERM
echo "built $out"
