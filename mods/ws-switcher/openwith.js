// What opens a workspace's folder (the switcher menu's "Edit … settings"): Settings >
// Files' Default external app first, then the code editors in turn, then the system's opener. Pure (it
// imports only settingsfacts.js, which is pure too), so a unit check can load it.
import { EDITOR_CATALOG } from "./settingsfacts.js";

// The editors tried when no default app is set, or when it can't open the folder: as before the setting.
export const EDITORS = ["zed", "cursor", "code", "subl"];

// The commands to try, in order, until one exits 0 (the last one is used whatever it answers:
// explorer exits 1 even when it worked). defaultApp: the "default-app" value (null, "system", a
// catalog id, or "app:<bundle id, name or Linux desktop id>").
export function folderOpeners(defaultApp, platform, path) {
  const steps = [];
  const app = typeof defaultApp === "string" ? defaultApp : null;
  const editor = app ? EDITOR_CATALOG.find((e) => e.id === app) : undefined;
  if (platform === "windows") {
    if (editor?.exe) steps.push({ cmd: "cmd", args: ["/c", editor.binary, path] });
    steps.push({ cmd: "explorer", args: [path] });
    return steps;
  }
  if (editor) {
    steps.push({ cmd: "sh", args: ["-c", `command -v ${editor.binary} >/dev/null 2>&1 && exec ${editor.binary} "$1"; exit 127`, "sh", path] });
    if (platform === "macos") steps.push({ cmd: "open", args: ["-b", editor.bundle, path] });
  } else if (app?.startsWith("app:") && app.length > 4) {
    const id = app.slice(4);
    if (platform === "macos") steps.push({ cmd: "open", args: /^[\w.-]+\.[\w.-]+$/.test(id) ? ["-b", id, path] : ["-a", id, path] });
    else steps.push({ cmd: "sh", args: ["-c", 'command -v gtk-launch >/dev/null 2>&1 && exec gtk-launch "$1" "$2"; exit 127', "sh", id.replace(/\.desktop$/, ""), path] });
  } else if (app === "system") {
    steps.push({ cmd: "sh", args: ["-c", 'command -v open >/dev/null 2>&1 && exec open "$1"; exec xdg-open "$1"', "sh", path] });
  }
  const editors = EDITORS.map((e) => `command -v ${e} >/dev/null 2>&1 && exec ${e} "$1";`).join(" ");
  steps.push({ cmd: "sh", args: ["-c", `${editors} command -v open >/dev/null 2>&1 && exec open "$1"; exec xdg-open "$1"`, "sh", path] });
  return steps;
}
