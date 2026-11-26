# winapps.ps1: Windows' "Open with" apps for a file, for Files' Open in (ws-files) and
# Settings > Files' Default external app (ws-settings). Windows only.
#
#   winapps.ps1 list FILE        "default<TAB>NAME" for the app Windows opens FILE with, then
#                                "app<TAB>LABEL<TAB>NAME" for each app it recommends for FILE's type
#   winapps.ps1 open FILE NAME   opens FILE with the app called NAME (as `list` gives it)
#
# NAME is the handler's own name (an .exe path, or a packaged app's id). The shell's handler list
# (SHAssocEnumHandlers) is what Explorer's "Open with" shows, packaged apps included; an app is
# started through its handler, as Explorer does. The small C# part is compiled once into
# %LOCALAPPDATA%\herdr-ws\ and loaded from there after that.
param([string]$what, [string]$file, [string]$name)
$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace HerdrWs {
  [ComImport, Guid("F04061AC-1659-4a3f-A954-775AA57FC083"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAssocHandler {
    [PreserveSig] int GetName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int GetUIName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int GetIconLocation([MarshalAs(UnmanagedType.LPWStr)] out string path, out int index);
    [PreserveSig] int IsRecommended();
    [PreserveSig] int MakeDefault([MarshalAs(UnmanagedType.LPWStr)] string description);
    [PreserveSig] int Invoke(IntPtr dataObject);
    [PreserveSig] int CreateInvoker(IntPtr dataObject, out IntPtr invoker);
  }
  [ComImport, Guid("973810ae-9599-4b88-9e4d-6ee98c9552da"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IEnumAssocHandlers {
    [PreserveSig] int Next(uint count, [MarshalAs(UnmanagedType.Interface)] out IAssocHandler handler, out uint fetched);
  }
  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr bc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint sigdn, out IntPtr name);
    void GetAttributes(uint mask, out uint attrs);
    void Compare(IShellItem other, uint hint, out int order);
  }
  public static class Apps {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHAssocEnumHandlers(string ext, int filter, out IEnumAssocHandlers handlers);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHCreateItemFromParsingName(string path, IntPtr bc, [In] ref Guid riid, out IShellItem item);
    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
    static extern int AssocQueryString(int flags, int str, string assoc, string extra, System.Text.StringBuilder outs, ref uint size);

    static IEnumerable<IAssocHandler> Handlers(string ext) {
      IEnumAssocHandlers e;
      if (SHAssocEnumHandlers(ext, 1 /* ASSOC_FILTER_RECOMMENDED */, out e) != 0 || e == null) yield break;
      IAssocHandler h; uint got;
      while (e.Next(1, out h, out got) == 0 && got == 1) yield return h;
    }
    // The default handler's name: the progid's app (ASSOCSTR_EXECUTABLE), or for a packaged
    // app its AppUserModelId (ASSOCSTR_APPID, 21), else its ProgID (ASSOCSTR_PROGID, 20).
    public static string Default(string ext) {
      foreach (int kind in new[] { 2, 21, 20 }) {
        uint size = 1024; var sb = new System.Text.StringBuilder(1024);
        if (AssocQueryString(0x400 /* ASSOCF_NOTRUNCATE */, kind, ext, null, sb, ref size) == 0 && sb.Length > 0) return sb.ToString();
      }
      return null;
    }
    public static List<string[]> List(string ext) {
      var out_ = new List<string[]>();
      foreach (var h in Handlers(ext)) {
        string n, ui;
        if (h.GetName(out n) != 0 || h.GetUIName(out ui) != 0 || String.IsNullOrEmpty(n) || String.IsNullOrEmpty(ui)) continue;
        out_.Add(new[] { ui, n });
      }
      return out_;
    }
    public static int Open(string file, string name) {
      string ext = System.IO.Path.GetExtension(file);
      foreach (var h in Handlers(String.IsNullOrEmpty(ext) ? "." : ext)) {
        string n;
        if (h.GetName(out n) != 0 || !String.Equals(n, name, StringComparison.OrdinalIgnoreCase)) continue;
        Guid iidItem = typeof(IShellItem).GUID, bhid = new Guid("3981E225-F559-11D3-8E3A-00C04F6837D5") /* BHID_SFUIObject */, iidData = new Guid("0000010e-0000-0000-C000-000000000046");
        IShellItem item;
        int hr = SHCreateItemFromParsingName(file, IntPtr.Zero, ref iidItem, out item);
        if (hr != 0) return hr;
        IntPtr data;
        item.BindToHandler(IntPtr.Zero, ref bhid, ref iidData, out data);
        try { return h.Invoke(data); } finally { Marshal.Release(data); }
      }
      return 2; // no such app for this type
    }
  }
}
'@

# Compiled once per version of the C# above.
$sha = [Security.Cryptography.SHA256]::Create()
$tag = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($src))[0..5] | ForEach-Object { $_.ToString('x2') })
$dir = Join-Path $env:LOCALAPPDATA 'herdr-ws'
$dll = Join-Path $dir "winapps-$tag.dll"
if (-not ('HerdrWs.Apps' -as [type])) {
  if (Test-Path $dll) { Add-Type -Path $dll }
  else {
    New-Item -ItemType Directory -Force $dir | Out-Null
    try { Add-Type -TypeDefinition $src -OutputAssembly $dll -OutputType Library; Add-Type -Path $dll }
    catch { Add-Type -TypeDefinition $src }
  }
}

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ext = [IO.Path]::GetExtension($file)
if (-not $ext) { $ext = '.' }
switch ($what) {
  'list' {
    $def = [HerdrWs.Apps]::Default($ext)
    $apps = [HerdrWs.Apps]::List($ext)
    # The default's name as the list writes it (AssocQueryString may give a packaged app's id).
    if ($def) {
      # A packaged default comes as its app id (Microsoft.Windows.Photos_8wekyb3d8bbwe!App): it's the
      # handler installed under that package (…\Microsoft.Paint_<version>_<arch>__<publisher>\…), or the
      # one named as the package's last word (Photos).
      $pkg, $pub = (($def -split '!')[0]) -split '_', 2
      $word = ($pkg -split '\.')[-1]
      $hit = $apps | Where-Object {
        $_[1] -ieq $def -or
        ($pub -and $_[1] -like "*\$($pkg)_*_$pub\*") -or
        ($def -like '*!*' -and ($_[1] -ieq $word -or $_[0] -ieq $word))
      } | Select-Object -First 1
      if ($hit) { $def = $hit[1] }
      [Console]::Out.Write("default`t$def`n")
    }
    foreach ($a in $apps) { [Console]::Out.Write("app`t$($a[0])`t$($a[1])`n") }
  }
  'open' {
    $hr = [HerdrWs.Apps]::Open([IO.Path]::GetFullPath($file), $name)
    if ($hr -ne 0) { [Console]::Error.WriteLine("can't open with $name (0x{0:x})" -f $hr); exit 1 }
  }
  default { [Console]::Error.WriteLine('usage: winapps.ps1 list FILE | open FILE NAME'); exit 2 }
}
