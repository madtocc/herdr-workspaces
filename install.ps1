# Installs or updates Workspaces for Herdr on Windows, and Herdr itself when it
# isn't there yet (with Herdr's own installer, which also adds herdr-core). On
# macOS and Linux, run install.sh instead.
#
#   irm https://madtocc.github.io/herdr-workspaces/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://madtocc.github.io/herdr-workspaces/install.ps1))) -Yes
#   powershell -ExecutionPolicy Bypass -File install.ps1     # from a clone: installs that copy
#
# What it does, each step only where it's needed (so running it again updates):
#   1. Herdr missing: runs https://releases.herdr.dev/app/install.ps1.
#   2. Git for Windows or Node 20.6 missing: offers to add them with winget.
#      Git's sh runs the package's scripts; Node runs the background runner.
#   3. Copies layouts\workspaces.json and the mods\ws-* folders into Herdr's
#      folder (%USERPROFILE%\.config\herdr-app). A file you changed is kept in
#      %USERPROFILE%\.herdr\install\backup\<time>\ before the new one takes its place.
#   4. Adds mods\ws-switcher\bin (the herdr-ws-* commands) to your user Path.
#   5. Adds the agents you have (claude, codex, agy, pi) to Herdr's programs.json,
#      so they start through the launcher and get each workspace's instructions.
#   6. Asks: bring agents back after a restart (one line in herdr-core's
#      config.toml), add the example agent presets, and, once, whether
#      Herdr's Settings key (Ctrl+,) opens the package's Settings.
#   7. Switches Herdr to the layout, on a first install.
# Your workspaces, tasks, presets and automations (%USERPROFILE%\.herdr) are never touched.
#
# Options: -Yes (don't ask: everything is added but the Settings key, which stays Herdr's), -NoHerdr, -NoTools (no winget),
# -Resume / -NoResume, -Presets / -NoPresets, -SettingsKey / -NoSettingsKey, -NoSwitch, -Version X.Y.Z,
# -From <folder> (a clone or an unpacked release), -DryRun, -Uninstall.
param(
    [switch]$Yes, [switch]$NoHerdr, [switch]$NoTools, [switch]$Resume, [switch]$NoResume,
    [switch]$Presets, [switch]$NoPresets, [switch]$SettingsKey, [switch]$NoSettingsKey, [switch]$NoSwitch,
    [string]$Version = "", [string]$From = "", [switch]$DryRun, [switch]$Uninstall
)

# Its own scope: under `irm | iex` it would otherwise set the caller's variables.
& {
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# throw, not exit: under `irm | iex`, exit would close the person's window.
function Fail($why) { throw "herdr-workspaces: $why" }

$repo = if ($env:HERDR_WS_REPO) { $env:HERDR_WS_REPO } else { "madtocc/herdr-workspaces" }
$releases = if ($env:HERDR_RELEASES_URL) { $env:HERDR_RELEASES_URL.TrimEnd("/") } else { "https://releases.herdr.dev" }
$defaultHome = Join-Path $env:USERPROFILE ".config\herdr-app"
$herdrHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { $defaultHome }
$core = Join-Path $env:APPDATA "herdr-core"
$state = Join-Path $env:USERPROFILE ".herdr\install"
$backup = Join-Path $state ("backup\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$bins = Join-Path $herdrHome "mods\ws-switcher\bin"
$tar = Join-Path $env:SystemRoot "System32\tar.exe"
$notes = New-Object System.Collections.Generic.List[string]
$utf8 = New-Object Text.UTF8Encoding $false

function Step($text) { Write-Host "  $text" }
function Note($text) { $notes.Add($text) }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Does($what) { if ($DryRun) { Step "would: $what"; return $false }; return $true }
function WriteText($path, $text) {
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Ask($question, $default) {
    if ($Yes -or -not [Environment]::UserInteractive) { return $default }
    $hint = if ($default) { "[Y/n]" } else { "[y/N]" }
    try { $answer = Read-Host "$question $hint" } catch { return $default }
    if (-not $answer) { return $default }
    return $answer -match "^[Yy]"
}
# A program with its arguments exactly as written (PowerShell 5 drops the quotes
# inside an argument), its output read and kept out of the way.
function Run($exe, $arguments, $seconds = 20) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $exe
    $info.Arguments = $arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    try { $process = [Diagnostics.Process]::Start($info) } catch { return @{ code = 127; out = "" } }
    $out = $process.StandardOutput.ReadToEndAsync()
    $null = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($seconds * 1000)) { try { $process.Kill() } catch {}; return @{ code = 124; out = "" } }
    return @{ code = $process.ExitCode; out = $out.Result }
}
function Sha($path) {
    $stream = [IO.File]::OpenRead($path)
    try { return -join ([Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) }
    finally { $stream.Close() }
}
function HerdrApp {
    $found = Get-Command herdr-app -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    $path = Join-Path $env:LOCALAPPDATA "Programs\herdr-app\herdr-app.exe"
    if (Test-Path $path) { return $path }
    return $null
}
function AppRunning {
    $app = HerdrApp
    return $app -and ((Run $app "status").code -eq 0)
}
function FindSh {
    $path = Join-Path $env:ProgramFiles "Git\bin\sh.exe"
    if (Test-Path $path) { return $path }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $execPath = (Run $git.Source "--exec-path").out.Trim()
        if ($execPath) {
            $path = Join-Path ([IO.Path]::GetFullPath((Join-Path $execPath "..\..\.."))) "bin\sh.exe"
            if (Test-Path $path) { return $path }
        }
    }
    return $null
}
function NodeOk {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return $false }
    if ((Run $node.Source "-v").out -match "v(\d+)\.(\d+)") {
        return ([int]$Matches[1] -gt 20) -or ([int]$Matches[1] -eq 20 -and [int]$Matches[2] -ge 6)
    }
    return $false
}
# The user Path as the registry holds it, so %VARIABLES% in it stay unexpanded and keep their type.
function EditUserPath($dir, $add) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
    try {
        $raw = [string]$key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $parts = @($raw -split ";" | Where-Object { $_ })
        $listed = @($parts | Where-Object { $_.Trim().TrimEnd("\") -ieq $dir.TrimEnd("\") })
        if ($add -and $listed.Count) { return $false }
        if (-not $add -and -not $listed.Count) { return $false }
        if ($DryRun) { return $true }
        if ($add) { $parts += $dir } else { $parts = @($parts | Where-Object { $_.Trim().TrimEnd("\") -ine $dir.TrimEnd("\") }) }
        $kind = if ($key.GetValueNames() -contains "Path") { $key.GetValueKind("Path") } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        $key.SetValue("Path", ($parts -join ";"), $kind)
        # Setting any user variable tells running programs the environment changed.
        [Environment]::SetEnvironmentVariable("HERDR_WS_INSTALLING", "1", "User")
        [Environment]::SetEnvironmentVariable("HERDR_WS_INSTALLING", $null, "User")
        return $true
    } finally { $key.Close() }
}
function Finish($lines) {
    Write-Host ""
    foreach ($line in $lines) { Write-Host $line }
    if ($notes.Count) {
        Write-Host ""
        Write-Host "To know:"
        foreach ($n in $notes) { Write-Host "  - $n" }
    }
}

# keys.json's global key bound to an action, or $null (no file, not plain JSON, none bound).
function BoundKey($action) {
    $file = Join-Path $herdrHome "keys.json"
    if (-not (Test-Path $file)) { return $null }
    try { $doc = Get-Content -Raw $file | ConvertFrom-Json } catch { return $null }
    if (-not $doc.global) { return $null }
    foreach ($p in $doc.global.PSObject.Properties) { if ($p.Value -eq $action) { return $p.Name } }
    return $null
}
# Sets a global key to an action in keys.json; $false when the file can't be read as JSON.
function SetKey($key, $action) {
    $file = Join-Path $herdrHome "keys.json"
    try {
        $doc = Get-Content -Raw $file | ConvertFrom-Json
        $doc.global.$key = $action
        WriteText $file (($doc | ConvertTo-Json -Depth 20) + "`n")
        return $true
    } catch { return $false }
}
# A key as people write it: ctrl-, -> Ctrl+, (only the modifiers' dashes).
function KeyShown($key) { $key -creplace "cmd-", "Cmd+" -creplace "ctrl-", "Ctrl+" -creplace "alt-", "Alt+" -creplace "shift-", "Shift+" }
# Whether Ask can really ask someone (as Ask decides).
function CanAsk { -not $Yes -and [Environment]::UserInteractive }

$tmp = Join-Path ([IO.Path]::GetTempPath()) "herdr-ws-install-$PID"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {

# ---- -Uninstall ----------------------------------------------------------------
if ($Uninstall) {
    if (-not (Test-Path (Join-Path $herdrHome "mods\ws-switcher"))) { Fail "Workspaces isn't installed in $herdrHome" }
    Write-Host "Taking Workspaces out of $herdrHome"
    if ($DryRun) {
        Step "would: stop the background runner and Start at login,"
        Step "       move layouts\workspaces.json and mods\ws-* to $backup,"
        Step "       take the commands off your Path, the launcher's lines out of programs.json and the shell line out of config.toml,"
        Step "       and give Herdr's Settings key back to Herdr's Settings in keys.json"
        return
    }
    # While its commands are still there: stop what runs in the background.
    if ((FindSh) -and (NodeOk)) { $null = Run "cmd.exe" "/d /s /c `"`"$bins\herdr-ws-runner.cmd`" --off`"" 60 }
    if (AppRunning) { $null = Run (HerdrApp) 'do layout.switch "{\"name\":\"main\"}"' }

    New-Item -ItemType Directory -Force (Join-Path $backup "mods"), (Join-Path $backup "layouts") | Out-Null
    Get-ChildItem (Join-Path $herdrHome "mods") -Directory -Filter "ws-*" | ForEach-Object { Move-Item $_.FullName (Join-Path $backup "mods") }
    $layout = Join-Path $herdrHome "layouts\workspaces.json"
    if (Test-Path $layout) { Move-Item $layout (Join-Path $backup "layouts") }
    Step "files: moved to $backup"

    if (EditUserPath $bins $false) { Step "commands: off your user Path" }

    $file = Join-Path $herdrHome "programs.json"
    if ((Test-Path $file) -and ((Get-Content -Raw $file) -match "herdr-ws-agent")) {
        try {
            $doc = Get-Content -Raw $file | ConvertFrom-Json
            foreach ($name in @($doc.programs.PSObject.Properties.Name)) {
                $entry = $doc.programs.$name
                if ($entry.run -and @($entry.run)[0] -eq "herdr-ws-agent") { $doc.programs.PSObject.Properties.Remove($name) }
            }
            WriteText $file (($doc | ConvertTo-Json -Depth 20) + "`n")
            Step "agents: start plainly again (programs.json)"
        } catch { Note "Take the herdr-ws-agent lines out of $file by hand: without the launcher those agents won't start" }
    }

    # keys.json: Herdr's Settings key back to Herdr's Settings when it opens ours, and a note for
    # any other key bound to the package's commands (they do nothing once the mods are gone).
    $keysFile = Join-Path $herdrHome "keys.json"
    if ((Test-Path $keysFile) -and ((Get-Content -Raw $keysFile) -match "ws-")) {
        Copy-Item $keysFile (Join-Path $backup "keys.json")
        try {
            $doc = Get-Content -Raw $keysFile | ConvertFrom-Json
            $changed = $false; $left = @()
            foreach ($section in @($doc.PSObject.Properties)) {
                if ($section.Value -isnot [Management.Automation.PSCustomObject]) { continue }
                foreach ($p in @($section.Value.PSObject.Properties)) {
                    $c = if ($p.Value -is [string]) { $p.Value } elseif ($p.Value.command) { [string]$p.Value.command } else { "" }
                    if ($section.Name -eq "global" -and $p.Value -eq "mod.open:ws-settings" -and @("cmd-,", "ctrl-,") -contains $p.Name) {
                        $p.Value = "app.settings"; $changed = $true
                        Step "keys: $(KeyShown $p.Name) opens Herdr's Settings again (keys.json)"
                    } elseif ($c -match "^mod\.open:ws-" -or $c -match "^ws-[a-z0-9-]+\.") {
                        $left += $(if ($section.Name -eq "global") { "`"$($p.Name)`"" } else { "`"$($section.Name) $($p.Name)`"" })
                    }
                }
            }
            if ($changed) { WriteText $keysFile (($doc | ConvertTo-Json -Depth 20) + "`n") }
            if ($left.Count) { Note "$keysFile still binds $($left -join ', ') to the package's commands, which do nothing now: take them out or bind them again (a copy from before is $(Join-Path $backup 'keys.json'))" }
        } catch { Note "$keysFile may still bind keys to the package's commands, which do nothing now (a copy from before is $(Join-Path $backup 'keys.json'))" }
    }

    $cfg = Join-Path $core "config.toml"
    if ((Test-Path $cfg) -and ((Get-Content -Raw $cfg) -match "herdr-ws-resume")) {
        Copy-Item $cfg (Join-Path $backup "config.toml")
        $kept = New-Object System.Collections.Generic.List[string]
        $skip = 0; $drop = $false
        foreach ($line in [IO.File]::ReadAllLines($cfg)) {
            if ($line -match "^# herdr-workspaces: a terminal lost to a restart") { $skip = 3 }
            if ($skip -gt 0) { $skip--; continue }
            if ($line -match "^\s*shell\s*=.*herdr-ws-resume") { $drop = $true; continue }
            if ($drop -and $line -match "^\s*$") { $drop = $false; continue }
            $drop = $false
            $kept.Add($line)
        }
        # Nothing else in it: the file was only ours.
        if ($kept.Count) { WriteText $cfg (($kept -join "`r`n") + "`r`n") } else { Remove-Item $cfg }
        Step "restart: the shell line is out of $cfg"
    }
    $manifest = Join-Path $state "files.sha256"
    if (Test-Path $manifest) { Move-Item $manifest (Join-Path $backup "files.sha256") }
    # So an install after this asks about the Settings key again.
    $asked = Join-Path $state "settings-key-asked"
    if (Test-Path $asked) { Move-Item $asked (Join-Path $backup "settings-key-asked") }

    $left = @("Workspaces is out. Still there, yours to keep or delete:",
        "  - $(Join-Path $env:USERPROFILE '.herdr') (your workspaces, tasks, automations, secrets and settings)")
    if (Test-Path (Join-Path $core "templates")) { $left += "  - $(Join-Path $core 'templates') (agent presets)" }
    if (Test-Path (Join-Path $env:LOCALAPPDATA "herdr-ws")) { $left += "  - $(Join-Path $env:LOCALAPPDATA 'herdr-ws') (two small helpers, for Open in and the Recycle Bin)" }
    $left += "  - $backup (the files just taken out)"
    Finish $left
    return
}

# ---- 1. Herdr ------------------------------------------------------------------
if (-not (HerdrApp)) {
    Write-Host "Herdr isn't installed."
    $first = "install Herdr first (https://herdr.dev), then run this again"
    if ($NoHerdr) { Fail $first }
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($arch -ne "AMD64") { Fail "Herdr's installer has no build for $arch Windows (x64 only): $first" }
    if (-not (Ask "Install it now, with Herdr's own installer ($releases/app/install.ps1)?" $true)) { Fail $first }
    if (Does "install Herdr and herdr-core with $releases/app/install.ps1") {
        Invoke-RestMethod "$releases/app/install.ps1" | Invoke-Expression
        if (-not (HerdrApp)) { Fail "Herdr's installer finished but Herdr isn't there: $first" }
        Write-Host ""
    }
}

# ---- 2. Git for Windows and Node -------------------------------------------------
$needGit = -not (FindSh)
$needNode = -not (NodeOk)
if ($needGit -or $needNode) {
    $ids = @(); $what = @()
    if ($needGit) { $ids += "Git.Git"; $what += "Git for Windows (its sh runs the package's scripts)" }
    if ($needNode) { $ids += "OpenJS.NodeJS.LTS"; $what += "Node 20.6 or newer (the background runner and secrets)" }
    $what = $what -join " and "
    if (-not $NoTools -and (Have winget) -and (Ask "The package needs $what. Install with winget now?" $true)) {
        if (Does "winget install $($ids -join ' ')") {
            foreach ($id in $ids) { winget install --id $id -e --accept-source-agreements --accept-package-agreements }
            $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
            $needGit = -not (FindSh)
            $needNode = -not (NodeOk)
        }
    }
    if ($needGit -or $needNode) { Note "Still needed: $what. Install with: winget install $($ids -join ' ')  Until then the screens show, but agents and automations don't start" }
}

# ---- 3. the package's files ------------------------------------------------------
if (-not $From -and $PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "mods\ws-switcher\mod.json"))) { $From = $PSScriptRoot }
if ($From) {
    if (-not (Test-Path $From)) { Fail "no folder $From" }
    $src = (Resolve-Path $From).Path.TrimEnd("\")
} else {
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue) -or -not (Test-Path $tar)) { Fail "needs curl.exe and tar.exe (Windows 10 1803 or newer)" }
    if (-not $Version) {
        $latest = curl.exe -fsSLI -o NUL -w "%{url_effective}" "https://github.com/$repo/releases/latest"
        if ($LASTEXITCODE) { Fail "couldn't reach github.com/$repo" }
        $Version = ([string]$latest) -replace "^.*/tag/v", ""
    }
    if ($Version -notmatch "^\d+\.\d+\.\d+$") { Fail "couldn't find the latest release of $repo (got '$Version')" }
    curl.exe -fsSL "https://github.com/$repo/archive/refs/tags/v$Version.tar.gz" -o "$tmp\package.tar.gz"
    if ($LASTEXITCODE) { Fail "couldn't download version $Version of $repo" }
    New-Item -ItemType Directory -Force "$tmp\package" | Out-Null
    & $tar -xzf "$tmp\package.tar.gz" -C "$tmp\package"
    if ($LASTEXITCODE) { Fail "the download didn't unpack" }
    $src = (Get-ChildItem "$tmp\package" -Directory | Select-Object -First 1).FullName
}
if (-not (Test-Path (Join-Path $src "mods\ws-switcher\mod.json")) -or -not (Test-Path (Join-Path $src "layouts\workspaces.json"))) {
    Fail "$src doesn't hold the package (no mods\ws-switcher, or no layouts\workspaces.json)"
}
$new = if (Test-Path (Join-Path $src "VERSION")) { (Get-Content -Raw (Join-Path $src "VERSION")).Trim() } else { "?" }
$old = ""
if (Test-Path (Join-Path $herdrHome "mods\ws-switcher\VERSION")) { $old = (Get-Content -Raw (Join-Path $herdrHome "mods\ws-switcher\VERSION")).Trim() }
elseif (Test-Path (Join-Path $herdrHome "mods\ws-switcher")) { $old = "an older copy" }
if (-not $old) { Write-Host "Installing Workspaces $new into $herdrHome" }
elseif ($old -eq $new) { Write-Host "Workspaces $new is installed: checking its files" }
else { Write-Host "Updating Workspaces from $old to $new" }

# The package's files, as paths under Herdr's folder, with / as in the manifest.
$paths = @("layouts/workspaces.json")
$paths += Get-ChildItem (Join-Path $src "mods") -Directory -Filter "ws-*" |
    ForEach-Object { Get-ChildItem $_.FullName -Recurse -File -Force } |
    Where-Object { $_.Name -ne ".DS_Store" -and $_.Name -notlike "._*" } |
    ForEach-Object { $_.FullName.Substring($src.Length + 1).Replace("\", "/") }
$manifest = Join-Path $state "files.sha256"
$last = @{}
if (Test-Path $manifest) {
    foreach ($line in [IO.File]::ReadAllLines($manifest)) { if ($line -match "^([0-9a-f]{64})\s+\*?(.+)$") { $last[$Matches[2]] = $Matches[1] } }
}
# add: not there yet. same: already this file. update: the file this installer
# last put there, untouched. keep: someone changed it (or it was copied by hand),
# so the old one goes to the backup first. ws-settings/main.js is written by the
# switcher itself, so it's never worth keeping.
$sums = New-Object System.Collections.Generic.List[string]
$plan = @()
foreach ($p in $paths) {
    $sum = Sha (Join-Path $src $p)
    $sums.Add("$sum  $p")
    $dest = Join-Path $herdrHome $p.Replace("/", "\")
    if (-not (Test-Path $dest)) { $action = "add" }
    else {
        $cur = Sha $dest
        if ($cur -eq $sum) { $action = "same" }
        elseif (($last[$p] -eq $cur) -or $p -eq "mods/ws-settings/main.js") { $action = "update" }
        else { $action = "keep" }
    }
    $plan += @{ action = $action; path = $p; dest = $dest }
}
$added = @($plan | Where-Object { $_.action -eq "add" }).Count
$updated = @($plan | Where-Object { $_.action -eq "update" }).Count
$kept = @($plan | Where-Object { $_.action -eq "keep" }).Count
if ($DryRun) {
    Step "would: copy $added new files and replace $($updated + $kept) (backing up $kept of them first)"
} else {
    foreach ($item in $plan) {
        if ($item.action -eq "same") { continue }
        if ($item.action -eq "keep") {
            $saved = Join-Path $backup $item.path.Replace("/", "\")
            New-Item -ItemType Directory -Force (Split-Path $saved) | Out-Null
            Copy-Item $item.dest $saved
        }
        New-Item -ItemType Directory -Force (Split-Path $item.dest) | Out-Null
        Copy-Item (Join-Path $src $item.path.Replace("/", "\")) $item.dest -Force
    }
    # Files of ours from last time that the package no longer has, still untouched.
    $removed = 0
    foreach ($p in @($last.Keys)) {
        if ($paths -contains $p -or $p -match "\.\." -or $p -notmatch "^mods/ws-[^/]+/") { continue }
        $dest = Join-Path $herdrHome $p.Replace("/", "\")
        if (-not (Test-Path $dest) -or (Sha $dest) -ne $last[$p]) { continue }
        $saved = Join-Path $backup $p.Replace("/", "\")
        New-Item -ItemType Directory -Force (Split-Path $saved) | Out-Null
        Move-Item $dest $saved
        $removed++
    }
    WriteText $manifest (($sums -join "`n") + "`n")
    if (($added + $updated + $kept + $removed) -eq 0) { Step "files: all up to date" }
    else { Step "files: $added new, $($updated + $kept) replaced$(if ($removed) { ", $removed no longer in the package taken out" })" }
    if ($kept) { Note "$kept files differed from what this installer last put there (changed by you or an agent, or copied by hand). The old ones are in $backup" }
}

# ---- 4. the commands ---------------------------------------------------------------
if (EditUserPath $bins $true) {
    if ($DryRun) { Step "would: add $bins to your user Path" }
    else {
        Step "commands: $bins added to your user Path"
        if (Get-Process herdr-core -ErrorAction SilentlyContinue) { Note "Quit and open Herdr again, so herdr-core gets the new Path; a new terminal has the herdr-ws-* commands" }
    }
} else { Step "commands: already on your Path" }
if (($env:Path -split ";") -notcontains $bins) { $env:Path += ";$bins" }

# ---- 5. programs.json ----------------------------------------------------------------
$runs = [ordered]@{
    claude = @("herdr-ws-agent", "claude"); codex = @("herdr-ws-agent", "codex", "--no-daemon")
    antigravity = @("herdr-ws-agent", "agy"); pi = @("herdr-ws-agent", "pi")
}
$clis = @{ claude = "claude"; codex = "codex"; antigravity = "agy"; pi = "pi" }
$want = @($runs.Keys | Where-Object { Have $clis[$_] })
$file = Join-Path $herdrHome "programs.json"
if (-not $want.Count) {
    Note "No agent found on your Path (claude, codex, agy, pi). After you install one, run this again so it starts through the launcher"
} else {
    try {
        $doc = if (Test-Path $file) { Get-Content -Raw $file | ConvertFrom-Json } else { New-Object PSObject }
        if ($null -eq $doc -or $doc -isnot [Management.Automation.PSCustomObject]) { throw "not an object" }
        if ($doc.PSObject.Properties.Name -notcontains "programs") { $doc | Add-Member -NotePropertyName programs -NotePropertyValue (New-Object PSObject) }
        $addedAgents = @($want | Where-Object { $doc.programs.PSObject.Properties.Name -notcontains $_ })
        foreach ($name in $addedAgents) { $doc.programs | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{ run = $runs[$name] }) }
        if (-not $addedAgents.Count) { Step "agents: already start through the launcher" }
        elseif ($DryRun) { Step "agents: would add $($addedAgents -join ' ') to programs.json" }
        else {
            WriteText $file (($doc | ConvertTo-Json -Depth 20) + "`n")
            Step "agents: added $($addedAgents -join ' ') to programs.json"
        }
    } catch { Note "Couldn't add your agents to $file (it isn't plain JSON). Add them by hand: see step 2 of Install in the README" }
}

# ---- 6. agents back after a restart, and the presets -----------------------------------
$cfg = Join-Path $core "config.toml"
$cfgText = if (Test-Path $cfg) { [IO.File]::ReadAllText($cfg) } else { "" }
if ($cfgText -match "herdr-ws-resume") { Step "restart: agents come back (already set up)" }
elseif ($herdrHome.TrimEnd("\") -ine $defaultHome) {
    if ($Resume) { Note "Bringing agents back after a restart needs Herdr's folder at $defaultHome; yours is $herdrHome. See On Windows under Install in the README" }
}
elseif ($cfgText -match "(?m)^\s*shell\s*=") { Note "$cfg already sets its own shell, so agents aren't brought back after a restart. To have that, see On Windows under Install in the README" }
elseif (-not $NoResume -and ($Resume -or (Ask "Bring Claude and Antigravity agents back, resumed, after a restart? (Adds a line to herdr-core's config.toml; Settings > Agents turns it off.)" $true))) {
    if (Does "add the shell line to $cfg") {
        # herdr-core's own choice of shell: PowerShell 7 when it's there.
        $shell = if (Have pwsh) { "pwsh.exe" } else { "powershell.exe" }
        $top = @(
            "# herdr-workspaces: a terminal lost to a restart (reboot, logout, core crash) gets its",
            "# agent back, resumed, through herdr-ws-resume.ps1, which is PowerShell, as herdr-core's",
            "# own shell is. Without the script, you're in plain PowerShell.",
            ('shell = ["' + $shell + '", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", ". \"$env:USERPROFILE\\.config\\herdr-app\\mods\\ws-switcher\\bin\\herdr-ws-resume.ps1\""]')
        ) -join "`r`n"
        if ($cfgText) {
            New-Item -ItemType Directory -Force $backup | Out-Null
            Copy-Item $cfg (Join-Path $backup "config.toml")
        }
        # A key outside every [table] has to come before the first one, so ours goes on top.
        WriteText $cfg ($top + "`r`n" + $(if ($cfgText) { "`r`n" + $cfgText } else { "" }))
        Step "restart: agents come back (line added to $cfg)"
    }
}

$examples = Join-Path $src "examples\presets"
if (Test-Path $examples) {
    $templates = Join-Path $core "templates"
    $toAdd = @()
    foreach ($f in Get-ChildItem $examples -Filter "*.md") {
        if (Test-Path (Join-Path $templates $f.Name)) { continue }
        # The foreman runs pi and starts the two hands, so those three come only with pi.
        if (@("foreman.md", "hand.md", "hand-strong.md") -contains $f.Name) { if (-not (Have pi) -or -not (Have claude)) { continue } }
        elseif (-not (Have claude)) { continue }
        $toAdd += $f
    }
    if ($toAdd.Count) {
        $names = ($toAdd | ForEach-Object { $_.BaseName }) -join " "
        if (-not $NoPresets -and ($Presets -or (Ask "Add the example agent presets ($names)? Some start Claude in auto mode, so a helper never waits at a prompt." $true))) {
            if (Does "copy the presets $names to $templates") {
                New-Item -ItemType Directory -Force $templates | Out-Null
                foreach ($f in $toAdd) { Copy-Item $f.FullName (Join-Path $templates $f.Name) }
                Step "presets: added $names"
            }
        }
    }
}

# ---- 6b. Herdr's Settings key ------------------------------------------------------------
# It opens Herdr's own window, which has none of the package's sections. Asked once: on the first
# run that finds the key bound to Herdr's Settings in keys.json (Herdr writes that file when it
# first starts, so a first install that installs Herdr too is asked on the next run), remembered
# in .herdr\install\settings-key-asked; -Yes and a run nobody can answer don't count as asked.
# -SettingsKey binds it on any run. A yes makes keys.json yours, so Herdr's updates no longer add
# their new default keys to it.
$askedFile = Join-Path $state "settings-key-asked"
if (-not $NoSettingsKey -and ($SettingsKey -or -not (Test-Path $askedFile))) {
    $key = BoundKey "app.settings"
    $keysFile = Join-Path $herdrHome "keys.json"
    if (-not $key) {
        if (-not (BoundKey "mod.open:ws-settings") -and -not (Test-Path $keysFile)) {
            Note "Herdr's Settings key opens Herdr's own window, without the package's sections. Run this again once Herdr has started to be asked whether it should open the package's Settings, or see Settings in the README"
        }
    } else {
        $yesToKey = $SettingsKey
        if (-not $SettingsKey) {
            if ((CanAsk) -and -not $DryRun) { WriteText $askedFile "" }
            $yesToKey = Ask "Have $(KeyShown $key) open this Settings, with the package's sections? (Writes `"$key`" into $keysFile. Herdr then leaves that file to you: new default shortcuts in its updates are added by hand.)" $false
        }
        if ($yesToKey -and (Does "bind $key to the package's Settings in $keysFile")) {
            New-Item -ItemType Directory -Force $backup | Out-Null
            Copy-Item $keysFile (Join-Path $backup "keys.json")
            if (SetKey $key "mod.open:ws-settings") { Step "keys: $(KeyShown $key) opens the package's Settings (keys.json)" }
            else { Note "Couldn't change $keysFile (a copy from before is $(Join-Path $backup 'keys.json')): set `"$key`" in its global section to `"mod.open:ws-settings`" by hand" }
        }
    }
}

# ---- 7. the layout ---------------------------------------------------------------------
# Only on a first install: later, the layout shown is the person's choice.
if (-not $NoSwitch -and -not $old) {
    $shown = $false
    $shared = Join-Path $herdrHome "shared.json"
    if (AppRunning) {
        if (-not (Does "switch Herdr to the Workspaces layout")) { $shown = $true }
        elseif ((Run (HerdrApp) 'do layout.switch "{\"name\":\"workspaces\"}"').code -eq 0) { Step "layout: Herdr now shows Workspaces (ctrl-shift-l cycles back)"; $shown = $true }
    } elseif (-not (Test-Path $shared)) {
        # Herdr hasn't run yet: it opens on the layout its shared state names.
        if (Does "make Workspaces the layout Herdr opens on") {
            WriteText $shared "{`"layout`":`"workspaces`"}`n"
            Step "layout: Herdr will open on Workspaces"
        }
        $shown = $true
    }
    if (-not $shown) { Note "To show it: open Herdr and press ctrl-shift-l until Workspaces shows" }
}

$done = @()
if ($DryRun) { $done += "Nothing was changed (-DryRun)." }
elseif (-not $old) { $done += "Workspaces $new is installed." }
else { $done += "Workspaces $new is in place." }
Finish $done
if (-not $old -and -not $DryRun) {
    Write-Host ""
    Write-Host "Next: open Herdr, click the switcher at the top of the sidebar and pick"
    Write-Host "`"New workspace from a folder...`". The README has the tour:"
    Write-Host "https://github.com/$repo#readme"
}

} finally {
    if ($tmp -like "*herdr-ws-install-*") { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
}
