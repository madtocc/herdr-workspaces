# herdr-ws-resume.ps1: herdr-core's shell on Windows. It is PowerShell, as herdr-core's own
# shell is, with the same prompt hook (each prompt tells Windows the folder you're in, so
# hc and Herdr follow a cd), and it first brings back this terminal's agent after a
# restart: herdr-ws-resume --agent, through Git for Windows' sh. When the agent ends, or
# when there's none, you're in PowerShell.
#
# herdr-core's %APPDATA%\herdr-core\config.toml:
#
#   shell = ["powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", ". \"$env:USERPROFILE\\.config\\herdr-app\\mods\\ws-switcher\\bin\\herdr-ws-resume.ps1\""]
#
# (pwsh.exe instead of powershell.exe for PowerShell 7.)

$global:__hc_prompt = $function:prompt
function global:prompt {
  $p = & $global:__hc_prompt
  $l = $ExecutionContext.SessionState.Path.CurrentLocation
  if ($l.Provider.Name -eq 'FileSystem') { try { [Environment]::CurrentDirectory = $l.ProviderPath } catch {} }
  $p
}

if ($env:HC_TERMINAL_ID) {
  $sh = Join-Path $env:ProgramFiles 'Git\bin\sh.exe'
  if (-not (Test-Path $sh)) {
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git) { $sh = Join-Path (Split-Path (Split-Path $git.Source)) 'bin\sh.exe' }
  }
  $resume = Join-Path $PSScriptRoot 'herdr-ws-resume'
  if ((Test-Path $sh) -and (Test-Path $resume)) { & $sh $resume --agent }
  Remove-Variable sh, git, resume -ErrorAction SilentlyContinue
}
