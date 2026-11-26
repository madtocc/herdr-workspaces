#!/bin/sh
# Installs or updates Workspaces for Herdr on macOS and Linux, and Herdr itself
# when it isn't there yet (with Herdr's own installer, which also adds
# herdr-core). On Windows, run install.ps1 in PowerShell instead.
#
#   curl -fsSL https://madtocc.github.io/herdr-workspaces/install.sh | sh
#   curl -fsSL …/install.sh | sh -s -- --yes      # with options
#   ./install.sh                                  # from a clone: installs that copy
#
# What it does, each step only where it's needed (so running it again updates):
#   1. Herdr missing: runs https://releases.herdr.dev/app/install.sh.
#   2. Copies layouts/workspaces.json and the mods/ws-* folders into Herdr's
#      folder (~/.config/herdr-app). A file you changed is kept in
#      ~/.herdr/install/backup/<time>/ before the new one takes its place.
#   3. Links the herdr-ws-* commands into ~/.local/bin.
#   4. Adds the agents you have (claude, codex, agy, pi) to Herdr's programs.json,
#      so they start through the launcher and get each workspace's instructions.
#   5. Asks: bring agents back after a restart (one line in herdr-core's
#      config.toml), and add the example agent presets.
#   6. Switches Herdr to the layout, on a first install.
# Your workspaces, tasks, presets and automations (~/.herdr) are never touched.
#
# Options:
#   --yes            don't ask: Herdr, the restart line and the presets are all added
#   --no-herdr       don't install Herdr when it's missing (stop instead)
#   --resume, --no-resume     the restart line, without asking
#   --presets, --no-presets   the example presets, without asking
#   --no-switch      leave the shown layout as it is
#   --version X.Y.Z  that release instead of the latest
#   --from DIR       install the copy in DIR (a clone or an unpacked release)
#   --dry-run        say what would change and change nothing
#   --uninstall      take it out again (your ~/.herdr stays)
set -eu

main() {
  repo=${HERDR_WS_REPO:-madtocc/herdr-workspaces}
  releases=${HERDR_RELEASES_URL:-https://releases.herdr.dev}
  config=${XDG_CONFIG_HOME:-$HOME/.config}
  home=${HERDR_APP_HOME:-$config/herdr-app}
  core=$config/herdr-core
  bindir=$HOME/.local/bin
  state=$HOME/.herdr/install
  stamp=$(date +%Y%m%d-%H%M%S)
  backup=$state/backup/$stamp
  commands="herdr-ws-agent herdr-ws-run herdr-ws-runner herdr-ws-notify herdr-ws-secret herdr-ws-resume"

  yes=0 herdr=ask resume=ask presets=ask switch=1 version='' from='' dry=0 uninstall=0
  while [ $# -gt 0 ]; do
    case $1 in
      --yes | -y) yes=1 ;;
      --no-herdr) herdr=no ;;
      --resume) resume=yes ;;
      --no-resume) resume=no ;;
      --presets) presets=yes ;;
      --no-presets) presets=no ;;
      --no-switch) switch=0 ;;
      --version) version=${2:?--version needs a number}; shift ;;
      --from) from=${2:?--from needs a folder}; shift ;;
      --dry-run) dry=1 ;;
      --uninstall) uninstall=1 ;;
      --help | -h)
        if [ -f "$0" ] && grep -q '^# Installs or updates Workspaces' "$0"; then sed -n '2,/^set -eu/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
        else echo "See the top of https://github.com/$repo/blob/main/install.sh"; fi
        exit 0 ;;
      *) fail "unknown option $1 (see --help)" ;;
    esac
    shift
  done

  case $(uname -s) in
    Linux | Darwin) ;;
    MINGW* | MSYS* | CYGWIN*) fail "this script is for macOS and Linux; on Windows, run this in PowerShell: irm https://madtocc.github.io/herdr-workspaces/install.ps1 | iex" ;;
    *) fail "Herdr has no build for $(uname -s)" ;;
  esac

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/herdr-ws-install.XXXXXX")
  trap 'case $tmp in */herdr-ws-install.*) rm -rf "$tmp" ;; esac' EXIT
  notes=$tmp/notes
  : > "$notes"

  if [ "$uninstall" = 1 ]; then uninstall; exit 0; fi

  need_herdr
  find_package
  copy_files
  link_commands
  add_programs
  add_resume
  add_presets
  show_layout
  finish
}

# What's printed names your home folder as ~.
tilde() { awk -v h="$HOME" '{ while (length(h) > 1 && (i = index($0, h "/")) > 0) $0 = substr($0, 1, i - 1) "~/" substr($0, i + length(h) + 1); print }'; }
say() { printf '%s\n' "$*" | tilde; }
step() { printf '  %s\n' "$*" | tilde; }
note() { printf '%s\n' "$*" | tilde >> "$notes"; }
fail() { printf 'herdr-workspaces: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
# does <what it would do>: runs it, or only says so under --dry-run
does() { if [ "$dry" = 1 ]; then step "would: $1"; return 1; fi; }

# ask "<question>" <y|n>: the answer, the default with --yes or where nobody can be asked
ask() {
  if [ "$yes" = 1 ] || ! (: < /dev/tty) 2>/dev/null; then [ "$2" = y ]; return; fi
  if [ "$2" = y ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  printf '%s %s ' "$1" "$hint" > /dev/tty
  IFS= read -r answer < /dev/tty || answer=
  case ${answer:-$2} in [Yy]*) return 0 ;; *) return 1 ;; esac
}

app() { # Herdr's command, on PATH or where its installer puts it
  if have herdr-app; then command -v herdr-app
  elif [ -x "$bindir/herdr-app" ]; then echo "$bindir/herdr-app"
  else return 1; fi
}

app_running() { a=$(app) && "$a" status >/dev/null 2>&1; }

# ---- 1. Herdr ----------------------------------------------------------------

herdr_there() {
  app >/dev/null && return 0
  for d in "$HOME/Applications/Herdr.app" /Applications/Herdr.app "${XDG_DATA_HOME:-$HOME/.local/share}/herdr-app"; do
    [ -e "$d" ] && return 0
  done
  return 1
}

need_herdr() {
  if herdr_there; then return 0; fi
  say "Herdr isn't installed."
  [ "$herdr" = no ] && fail "install Herdr first (https://herdr.dev), then run this again"
  ask "Install it now, with Herdr's own installer ($releases/app/install.sh)?" y ||
    fail "install Herdr first (https://herdr.dev), then run this again"
  does "install Herdr and herdr-core with $releases/app/install.sh" || return 0
  have curl || fail "curl is needed to download Herdr"
  curl -fsSL "$releases/app/install.sh" -o "$tmp/herdr-install.sh" || fail "couldn't download Herdr's installer from $releases"
  sh "$tmp/herdr-install.sh" || fail "Herdr didn't install (see above). Install it from https://herdr.dev, then run this again"
  herdr_there || fail "Herdr's installer finished but Herdr isn't there. Install it from https://herdr.dev, then run this again"
  say
}

# ---- 2. the package's files --------------------------------------------------

find_package() {
  if [ -z "$from" ]; then
    case $0 in
      */install.sh | install.sh)
        here=$(cd "$(dirname "$0")" && pwd)
        [ -f "$here/mods/ws-switcher/mod.json" ] && from=$here ;;
    esac
  fi
  if [ -n "$from" ]; then
    src=$(cd "$from" && pwd) || fail "no folder $from"
  else
    have curl || fail "curl is needed to download the package"
    have tar || fail "tar is needed to unpack the package"
    if [ -z "$version" ]; then
      latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest") ||
        fail "couldn't reach github.com/$repo"
      version=${latest##*/tag/v}
    fi
    echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "couldn't find the latest release of $repo (got '$version')"
    curl -fsSL "https://github.com/$repo/archive/refs/tags/v$version.tar.gz" -o "$tmp/package.tar.gz" ||
      fail "couldn't download version $version of $repo"
    mkdir "$tmp/package"
    tar -xzf "$tmp/package.tar.gz" -C "$tmp/package" || fail "the download didn't unpack"
    src=$(echo "$tmp"/package/*)
  fi
  [ -f "$src/mods/ws-switcher/mod.json" ] && [ -f "$src/layouts/workspaces.json" ] ||
    fail "$src doesn't hold the package (no mods/ws-switcher, or no layouts/workspaces.json)"
  new=$(cat "$src/VERSION" 2>/dev/null || echo "?")
  old=$(cat "$home/mods/ws-switcher/VERSION" 2>/dev/null || true)
  if [ -z "$old" ] && [ -d "$home/mods/ws-switcher" ]; then old="an older copy"; fi
  if [ -z "$old" ]; then say "Installing Workspaces $new into $home"
  elif [ "$old" = "$new" ]; then say "Workspaces $new is installed: checking its files"
  else say "Updating Workspaces from $old to $new"; fi
}

copy_files() {
  # The package's files, as paths under Herdr's folder. No name in it has a space.
  if have sha256sum; then shacmd="sha256sum"; else shacmd="shasum -a 256"; fi
  # Not what a Mac's Finder or tar leaves beside them.
  (cd "$src" && find layouts/workspaces.json mods/ws-* -type f ! -name .DS_Store ! -name '._*' | LC_ALL=C sort) > "$tmp/paths"
  grep -q '[[:space:]]' "$tmp/paths" && fail "a file name in the package has a space in it"
  (cd "$src" && xargs $shacmd < "$tmp/paths") > "$tmp/new.sums"
  : > "$tmp/there"
  while IFS= read -r p; do [ -f "$home/$p" ] && echo "$p" >> "$tmp/there"; done < "$tmp/paths"
  : > "$tmp/cur.sums"
  if [ -s "$tmp/there" ]; then
    (cd "$home" && xargs $shacmd < "$tmp/there") > "$tmp/cur.sums"
  fi
  manifest=$state/files.sha256
  [ -f "$manifest" ] && cp "$manifest" "$tmp/old.sums" || : > "$tmp/old.sums"

  # add: not there yet. same: already this file. update: the file this installer
  # last put there, untouched. keep: someone changed it (or it was copied by
  # hand), so the old one goes to the backup first. ws-settings/main.js is
  # written by the switcher itself, so it's never worth keeping.
  awk -v newf="$tmp/new.sums" -v curf="$tmp/cur.sums" '
    FILENAME == newf { new[$2] = $1; order[++n] = $2; next }
    FILENAME == curf { cur[$2] = $1; next }
    { old[$2] = $1 }
    END {
      for (i = 1; i <= n; i++) {
        p = order[i]
        if (!(p in cur)) a = "add"
        else if (cur[p] == new[p]) a = "same"
        else if (((p in old) && old[p] == cur[p]) || p == "mods/ws-settings/main.js") a = "update"
        else a = "keep"
        print a, p
      }
    }' "$tmp/new.sums" "$tmp/cur.sums" "$tmp/old.sums" > "$tmp/plan"

  # Files of ours from last time that the package no longer has, still untouched.
  awk -v newf="$tmp/new.sums" '
    FILENAME == newf { new[$2] = 1; next }
    !($2 in new) && $2 !~ /\.\./ && ($2 ~ /^mods\/ws-[^\/]+\// ) { print $1, $2 }
  ' "$tmp/new.sums" "$tmp/old.sums" > "$tmp/gone"

  added=$(grep -c '^add ' "$tmp/plan" || true)
  updated=$(grep -c '^update ' "$tmp/plan" || true)
  kept=$(grep -c '^keep ' "$tmp/plan" || true)
  if [ "$dry" = 1 ]; then
    step "would: copy $added new files and replace $((updated + kept)) (backing up $kept of them first)"
    return 0
  fi

  while read -r action p; do
    case $action in
      same) continue ;;
      keep)
        mkdir -p "$backup/$(dirname "$p")"
        cp -p "$home/$p" "$backup/$p" ;;
    esac
    mkdir -p "$home/$(dirname "$p")"
    cp -p "$src/$p" "$home/$p.ws-new"
    mv -f "$home/$p.ws-new" "$home/$p"
  done < "$tmp/plan"

  removed=0
  while read -r sum p; do
    [ -f "$home/$p" ] || continue
    [ "$(cd "$home" && $shacmd "$p" | cut -d' ' -f1)" = "$sum" ] || continue
    mkdir -p "$backup/$(dirname "$p")"
    mv "$home/$p" "$backup/$p"
    removed=$((removed + 1))
  done < "$tmp/gone"

  chmod +x "$home"/mods/ws-switcher/bin/herdr-ws-* 2>/dev/null || true
  mkdir -p "$state"
  cp "$tmp/new.sums" "$manifest"

  if [ $((added + updated + kept + removed)) -eq 0 ]; then step "files: all up to date"
  else step "files: $added new, $((updated + kept)) replaced$([ "$removed" -gt 0 ] && echo ", $removed no longer in the package taken out")"; fi
  if [ "$kept" -gt 0 ]; then
    note "$kept files differed from what this installer last put there (changed by you or an agent, or copied by hand). The old ones are in $backup"
  fi
}

# ---- 3. the commands ---------------------------------------------------------

link_commands() {
  linked=0
  for n in $commands; do
    target=$home/mods/ws-switcher/bin/$n
    link=$bindir/$n
    if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then continue; fi
    if [ -e "$link" ] || [ -L "$link" ]; then
      note "$link is already there and isn't this package's: left as it is. To use the package's: ln -sf $target $link"
      continue
    fi
    linked=$((linked + 1))
    [ "$dry" = 1 ] && continue
    mkdir -p "$bindir"
    ln -s "$target" "$link"
  done
  if [ "$linked" = 0 ]; then step "commands: already linked"
  elif [ "$dry" = 1 ]; then step "would: link $linked commands into $bindir"
  else step "commands: $linked linked into $bindir"; fi
  case ":$PATH:" in
    *":$bindir:"*) ;;
    *)
      shell=${SHELL:-}
      case ${shell##*/} in
        zsh) rc="~/.zshrc" ;;
        bash) rc="~/.bashrc" ;;
        *) rc="your shell's startup file" ;;
      esac
      note "$bindir isn't on your PATH, so the herdr-ws-* commands aren't found yet. Add this line to $rc and open a new terminal:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
}

# ---- 4. programs.json --------------------------------------------------------

add_programs() {
  file=$home/programs.json
  want=
  have claude && want="$want claude"
  have codex && want="$want codex"
  have agy && want="$want antigravity"
  have pi && want="$want pi"
  if [ -z "$want" ]; then
    note "No agent found on your PATH (claude, codex, agy, pi). After you install one, run this again so it starts through the launcher"
    return 0
  fi
  if have node; then
    # shellcheck disable=SC2086
    result=$(DRY=$dry node -e '
      const fs = require("fs");
      const [file, ...want] = process.argv.slice(1);
      const run = { claude: ["herdr-ws-agent", "claude"], codex: ["herdr-ws-agent", "codex", "--no-daemon"],
                    antigravity: ["herdr-ws-agent", "agy"], pi: ["herdr-ws-agent", "pi"] };
      let doc = {};
      try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
      catch (e) { if (e.code !== "ENOENT") { console.log("unreadable"); process.exit(0); } }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) { console.log("unreadable"); process.exit(0); }
      if (!doc.programs || typeof doc.programs !== "object") doc.programs = {};
      const added = want.filter((name) => !(name in doc.programs));
      for (const name of added) doc.programs[name] = { run: run[name] };
      if (added.length && process.env.DRY !== "1") {
        fs.mkdirSync(require("path").dirname(file), { recursive: true });
        fs.writeFileSync(file + ".ws-new", JSON.stringify(doc, null, 2) + "\n");
        fs.renameSync(file + ".ws-new", file);
      }
      console.log("added " + added.join(" "));
    ' "$file" $want) || result=unreadable
  elif [ ! -e "$file" ]; then
    result="added$want"
    if [ "$dry" != 1 ]; then
      mkdir -p "$home"
      {
        echo '{'
        echo '  "programs": {'
        sep=
        for name in $want; do
          case $name in
            claude) line='"claude": { "run": ["herdr-ws-agent", "claude"] }' ;;
            codex) line='"codex": { "run": ["herdr-ws-agent", "codex", "--no-daemon"] }' ;;
            antigravity) line='"antigravity": { "run": ["herdr-ws-agent", "agy"] }' ;;
            pi) line='"pi": { "run": ["herdr-ws-agent", "pi"] }' ;;
          esac
          printf '%s    %s' "$sep" "$line"
          sep=',
'
        done
        echo
        echo '  }'
        echo '}'
      } > "$file"
    fi
  else
    result=unreadable
  fi
  case $result in
    unreadable) note "Couldn't add your agents to $file (it isn't plain JSON, or Node isn't installed). Add them by hand: see step 2 of Install in the README" ;;
    "added ") step "agents: already start through the launcher" ;;
    *) step "agents: $([ "$dry" = 1 ] && echo "would add" || echo "added")${result#added} to programs.json" ;;
  esac
}

# ---- 5. agents back after a restart, and the presets ---------------------------

add_resume() {
  cfg=$core/config.toml
  if [ -f "$cfg" ] && grep -q 'herdr-ws-resume' "$cfg"; then step "restart: agents come back (already set up)"; return 0; fi
  if [ "$home" != "$HOME/.config/herdr-app" ]; then
    [ "$resume" = yes ] && note "Bringing agents back after a restart needs Herdr's folder at ~/.config/herdr-app; yours is $home. See step 3 of Install in the README"
    return 0
  fi
  if [ -f "$cfg" ] && grep -Eq '^[[:space:]]*shell[[:space:]]*=' "$cfg"; then
    note "$cfg already sets its own shell, so agents aren't brought back after a restart. To have that, see step 3 of Install in the README"
    return 0
  fi
  case $resume in
    no) return 0 ;;
    ask) ask "Bring Claude and Antigravity agents back, resumed, after a restart? (Adds a line to herdr-core's config.toml; Settings > Agents turns it off.)" y || return 0 ;;
  esac
  does "add the shell line to $cfg" || return 0
  mkdir -p "$core"
  {
    cat <<'EOF'
# herdr-workspaces: a terminal lost to a restart (reboot, logout, core crash) gets its
# agent back, resumed, through herdr-ws-resume; any other terminal gets your
# usual login shell. Without the script, the line falls back to that shell.
shell = ["/bin/sh", "-c", "r=\"$HOME/.config/herdr-app/mods/ws-switcher/bin/herdr-ws-resume\"; [ -x \"$r\" ] && exec \"$r\"; exec \"${SHELL:-/bin/sh}\" -l"]
EOF
    # A key outside every [table] has to come before the first one, so ours goes on top.
    if [ -f "$cfg" ]; then echo; cat "$cfg"; fi
  } > "$tmp/config.toml"
  if [ -f "$cfg" ]; then mkdir -p "$backup"; cp -p "$cfg" "$backup/config.toml"; fi
  cp "$tmp/config.toml" "$cfg"
  step "restart: agents come back (line added to $cfg)"
}

add_presets() {
  [ -d "$src/examples/presets" ] || return 0
  dest=$core/templates
  : > "$tmp/presets"
  for f in "$src"/examples/presets/*.md; do
    name=$(basename "$f")
    [ -e "$dest/$name" ] && continue
    # The foreman runs pi and starts the two hands, so those three come only with pi.
    case $name in
      foreman.md | hand.md | hand-strong.md) if ! have pi || ! have claude; then continue; fi ;;
      *) have claude || continue ;;
    esac
    echo "$name" >> "$tmp/presets"
  done
  [ -s "$tmp/presets" ] || return 0
  names=$(sed 's/\.md$//' "$tmp/presets" | tr '\n' ' ' | sed 's/ $//')
  case $presets in
    no) return 0 ;;
    ask) ask "Add the example agent presets ($names)? Some start Claude in auto mode, so a helper never waits at a prompt." y || return 0 ;;
  esac
  does "copy the presets $names to $dest" || return 0
  mkdir -p "$dest"
  while IFS= read -r name; do cp "$src/examples/presets/$name" "$dest/$name"; done < "$tmp/presets"
  step "presets: added $names"
}

# ---- 6. the layout -----------------------------------------------------------

show_layout() {
  [ "$switch" = 1 ] || return 0
  # Only on a first install: later, the layout shown is the person's choice.
  [ -z "$old" ] || return 0
  if app_running; then
    does "switch Herdr to the Workspaces layout" || return 0
    if "$(app)" "do" layout.switch '{"name":"workspaces"}' >/dev/null 2>&1; then step "layout: Herdr now shows Workspaces (ctrl-shift-l cycles back)"; return 0; fi
  elif [ ! -e "$home/shared.json" ]; then
    # Herdr hasn't run yet: it opens on the layout its shared state names.
    does "make Workspaces the layout Herdr opens on" || return 0
    mkdir -p "$home"
    printf '{"layout":"workspaces"}\n' > "$home/shared.json"
    step "layout: Herdr will open on Workspaces"
    return 0
  fi
  note "To show it: open Herdr and run  herdr-app do layout.switch '{\"name\":\"workspaces\"}'  (or press ctrl-shift-l until it shows)"
}

finish() {
  if ! have node; then
    note "Node isn't installed. The screens work without it; the background runner, secrets, agent numbers and History need Node 20.6 or newer"
  elif ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 6) ? 0 : 1)'; then
    note "Node $(node -v) is older than 20.6, which the background runner and secrets need"
  fi
  say
  if [ "$dry" = 1 ]; then say "Nothing was changed (--dry-run)."
  elif [ -z "$old" ]; then say "Workspaces $new is installed."
  else say "Workspaces $new is in place."; fi
  if [ -s "$notes" ]; then
    say
    say "To know:"
    sed 's/^/  - /' "$notes"
  fi
  if [ -z "$old" ] && [ "$dry" != 1 ]; then
    say
    say "Next: open Herdr, click the switcher at the top of the sidebar and pick"
    say "\"New workspace from a folder…\". The README has the tour:"
    say "https://github.com/$repo#readme"
  fi
}

# ---- --uninstall ---------------------------------------------------------------

uninstall() {
  [ -d "$home/mods/ws-switcher" ] || fail "Workspaces isn't installed in $home"
  say "Taking Workspaces out of $home"
  bins=$home/mods/ws-switcher/bin
  if [ "$dry" = 1 ]; then
    step "would: stop the background runner and Start at login, uninstall the Protected broker,"
    step "       move layouts/workspaces.json and mods/ws-* to $backup,"
    step "       remove the herdr-ws-* links, the launcher's lines in programs.json and the shell line in config.toml"
    return 0
  fi
  # While its commands are still there: stop what runs in the background.
  if have node; then
    "$bins/herdr-ws-runner" --off >/dev/null 2>&1 || true
    if [ "$(uname -s)" = Darwin ]; then "$bins/herdr-ws-secret" broker uninstall >/dev/null 2>&1 || true; fi
  fi
  if app_running; then "$(app)" "do" layout.switch '{"name":"main"}' >/dev/null 2>&1 || true; fi

  mkdir -p "$backup/mods" "$backup/layouts"
  for d in "$home"/mods/ws-*; do
    [ -d "$d" ] && mv "$d" "$backup/mods/"
  done
  [ -f "$home/layouts/workspaces.json" ] && mv "$home/layouts/workspaces.json" "$backup/layouts/"
  step "files: moved to $backup"

  for n in $commands; do
    link=$bindir/$n
    if [ -L "$link" ] && [ "$(readlink "$link")" = "$bins/$n" ]; then rm -f "$link"; fi
  done
  step "commands: links removed from $bindir"

  file=$home/programs.json
  if [ -f "$file" ] && grep -q 'herdr-ws-agent' "$file"; then
    if have node && node -e '
      const fs = require("fs");
      const file = process.argv[1];
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [name, p] of Object.entries(doc.programs || {})) {
        if (p && Array.isArray(p.run) && p.run[0] === "herdr-ws-agent") delete doc.programs[name];
      }
      fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
    ' "$file" 2>/dev/null; then step "agents: start plainly again (programs.json)"
    else note "Take the herdr-ws-agent lines out of $file by hand: without the launcher those agents won't start"; fi
  fi

  cfg=$core/config.toml
  if [ -f "$cfg" ] && grep -q 'herdr-ws-resume' "$cfg"; then
    cp -p "$cfg" "$backup/config.toml"
    awk '
      /^# herdr-workspaces: a terminal lost to a restart/ { skip = 3 }
      skip > 0 { skip--; next }
      /^[[:space:]]*shell[[:space:]]*=.*herdr-ws-resume/ { drop = 1; next }
      drop && /^[[:space:]]*$/ { drop = 0; next }
      { drop = 0; print }
    ' "$backup/config.toml" > "$tmp/config.toml"
    # Nothing else in it: the file was only ours.
    if [ -s "$tmp/config.toml" ]; then cp "$tmp/config.toml" "$cfg"; else rm -f "$cfg"; fi
    step "restart: the shell line is out of $cfg"
  fi
  [ -f "$state/files.sha256" ] && mv "$state/files.sha256" "$backup/files.sha256"

  say
  say "Workspaces is out. Still there, yours to keep or delete:"
  say "  - $HOME/.herdr (your workspaces, tasks, automations, secrets and settings)"
  [ -d "$core/templates" ] && say "  - $core/templates (agent presets)"
  say "  - $backup (the files just taken out)"
  if [ -s "$notes" ]; then say; say "To know:"; sed 's/^/  - /' "$notes"; fi
}

main "$@"
