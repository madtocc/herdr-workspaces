# herdr-ws-trash.ps1 PATH: moves PATH (a file or a folder) to the Recycle Bin, Windows only.
# posix.js gives the mods' sh scripts a `trash` that runs this. It never shows a dialog (no
# confirmation, no error box, no progress): a file that's in use stays where it is and this
# exits non-zero, so the script falls back to ~/.herdr/trash. Through SHFileOperationW with
# FOF_ALLOWUNDO; its C# is compiled once into %LOCALAPPDATA%\herdr-ws\.
param([string]$path)
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
namespace HerdrWs {
  public static class Bin {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Op {
      public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo; public ushort fFlags;
      [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted; public IntPtr hNameMappings; public string lpszProgressTitle;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHFileOperationW(ref Op op);
    // FO_DELETE with FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT.
    public static int Recycle(string path) {
      var op = new Op { wFunc = 3, pFrom = path + "\0\0", fFlags = 0x40 | 0x10 | 0x400 | 0x4 };
      int r = SHFileOperationW(ref op);
      return r != 0 ? r : (op.fAnyOperationsAborted ? 1 : 0);
    }
  }
}
'@
if (-not $path -or -not (Test-Path -LiteralPath $path)) { exit 4 }
$tag = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($src))[0..5] | ForEach-Object { $_.ToString('x2') })
$dir = Join-Path $env:LOCALAPPDATA 'herdr-ws'
$dll = Join-Path $dir "trash-$tag.dll"
if (-not ('HerdrWs.Bin' -as [type])) {
  if (Test-Path $dll) { Add-Type -Path $dll }
  else {
    New-Item -ItemType Directory -Force $dir | Out-Null
    try { Add-Type -TypeDefinition $src -OutputAssembly $dll -OutputType Library; Add-Type -Path $dll }
    catch { Add-Type -TypeDefinition $src }
  }
}
$r = [HerdrWs.Bin]::Recycle([IO.Path]::GetFullPath($path))
if ($r -ne 0 -or (Test-Path -LiteralPath $path)) { exit 1 }
