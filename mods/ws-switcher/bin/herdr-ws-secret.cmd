@echo off
rem herdr-ws-secret for Windows: runs the sh script beside it with Git for Windows' sh.
setlocal
set "sh=%ProgramFiles%\Git\bin\sh.exe"
rem Elsewhere (Scoop, a per-user install): Git's own folder, from git --exec-path (<git>/<mingw64>/libexec/git-core).
if not exist "%sh%" for /f "delims=" %%p in ('git --exec-path 2^>nul') do set "ep=%%p"
if not exist "%sh%" if defined ep for %%r in ("%ep%\..\..\..") do set "sh=%%~fr\bin\sh.exe"
"%sh%" "%~dp0herdr-ws-secret" %*
