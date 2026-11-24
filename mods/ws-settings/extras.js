// The Workspaces package's own sections of ws-settings (Features, Agents, Automations, Files and Experimental), drawn inside
// the Settings window that ws-switcher/settingsbuild.js builds from Herdr's (main.js here).
// These are plain functions on that window's view, so they don't depend on Herdr's own methods;
// their state lives on the view as `view.wsx`.
//
// - Features: which of the package's add-ons are on (settingsfacts.js FEATURES: Board, Notes,
//   Worktrees, History, Automations, Plan usage, Agent numbers), each on unless "features" in
//   ~/.herdr/settings.jsonc says false. Off hides it everywhere and stops its background work
//   (the mods follow shared "workspaces.settings"); nothing is deleted. Automations shows how
//   many there are, from shared "workspaces.automations" (the switcher's runner publishes it).
// - Agents: every switch the package has for agents, in one place:
//   - STARTING AGENTS: Herdr guide for every agent (herdr-ws-agent --guide on/off, Edit / Write
//     one for ~/.herdr/AGENTS.md, which opens it in the Files view: shared "workspaces.files.open",
//     the window closing first) and Bring agents back after a restart (herdr-ws-resume --on/--off).
//   - IN THE + MENU: one row per installed agent (hidefacts.js: ~/.herdr/agent-menu.json,
//     mirrored in shared "new-menu.hidden", knownAgents()).
// - Automations: how automations run, all in one place:
//   - WHILE HERDR IS CLOSED: Keep running and Start at login (shared "workspaces.runner", set
//     through "workspaces.runner.set" { on } / { login }: the switcher runs herdr-ws-runner).
//   - LIMITS & QUIET HOURS and AUTHORING: "automations" in ~/.herdr/settings.jsonc
//     (settingsfacts.js AUTOMATIONS_SETTINGS: max-parallel, quiet-hours, drafter). Custom quiet
//     hours are two HH:MM boxes (view.wsx.quietFrom / quietTo, made in packageInit) and Save.
// - Files: Files' defaults, "files" in ~/.herdr/settings.jsonc (settingsfacts.js FILES_SETTINGS):
//   VIEWING (Markdown & SVG open in, Default external app, Show ignored files) and OPENING FROM
//   TERMINALS (Cmd-click a file path, Files to catch). Default external app's list (appChoices)
//   is the editors installed and the apps macOS offers for a text file, found once a window
//   while Files is shown; its popup is the window's `picking` ("wsx-files-app"), so a section
//   change closes it as it closes the font lists.
// - Experimental: the experiments in ~/.herdr/settings.jsonc (settingsfacts.js), each off until
//   turned on, with what it does and why it's experimental.
// A switch or choice on Features, Files or Experimental rewrites only its value in the file
// (comments kept) and sets shared "workspaces.settings" so the mods that read it follow at once.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Popup, InputState, Input } from "gpui-base";
import { theme, shared, setShared, exec, home, appHome, readTextFile, writeTextFile, notify, checking, knownAgents, props, closeOverlay, window } from "herdr";
import * as fs from "fs/promises";
import { SETTINGS_FILE, EXPERIMENTS, FEATURES, FILES_SETTINGS, EDITOR_CATALOG, AUTOMATIONS_SETTINGS, parseSettings, withExperiment, withFeature, withFileSetting, withAutomationSetting, experimentOn, featureOn, fileSetting, automationSetting, appChoices, appLabel, automationCount, automationsLine } from "./settingsfacts.js";
import { HIDDEN, hiddenFile, parseHidden, saveHidden, shownAgents, countLine, notInstalledLine } from "./hidefacts.js";

// Our sections in the window's list, after Herdr's.
export const PACKAGE_SECTIONS = [
  { id: "features", title: "Features", icon: "mods/ws-settings/features.svg" },
  { id: "agents", title: "Agents", icon: "mods/ws-settings/extras.svg" },
  { id: "automations", title: "Automations", icon: "mods/ws-settings/automations.svg" },
  { id: "files", title: "Files", icon: "mods/ws-settings/files.svg" },
  { id: "experimental", title: "Experimental", icon: "mods/ws-settings/experimental.svg" },
];

// A section asked for by whoever opened the window (ws-switcher.settings/<section>): mod.open
// passes no props, so it comes through shared state, for a moment. Taking it clears it, which
// tells the asker the window opened (else its mod.open closed an open one: it opens it again).
// "extras" stays an alias for "agents" so existing key bindings keep working.
export function askedSection() {
  const a = shared("workspaces.settings.section");
  if (!a || typeof a.id !== "string" || Date.now() - (a.at ?? 0) >= 5000) return undefined;
  setShared("workspaces.settings.section", null);
  return a.id === "extras" ? "agents" : a.id;
}

const file = () => `${home()}/${SETTINGS_FILE}`;
const bin = (name) => `${appHome()}/mods/ws-switcher/bin/${name}`;
const guideFile = () => `${home()}/.herdr/AGENTS.md`;
const guideStarter = () => `${appHome()}/mods/ws-switcher/guide.md`;
const tilde = (p) => (p.startsWith(`${home()}/`) ? `~${p.slice(home().length)}` : p);
const errMsg = (e) => String(e?.message ?? e);

// Opens a file in Herdr's Files view: the switcher's sidebar copy takes the ask (shared
// "workspaces.files.open", a short list: the newest last, each id once, none older than 15s) and
// opens it beside the shown terminal, or in a dialog when there's no space.
function openInFiles(path) {
  const now = Date.now(), queue = shared("workspaces.files.open");
  const ask = { path, isDir: false, line: null, on: null, placement: "beside", id: `${now}-settings-${Math.random().toString(36).slice(2, 8)}`, at: now };
  setShared("workspaces.files.open", [...(Array.isArray(queue) ? queue : []).filter((a) => a && typeof a === "object" && now - (a.at ?? 0) < 15000), ask].slice(-64));
}

// From the window's init: read the settings file, switches and installed agents once,
// then re-read the files every 3 seconds so CLI flips and external edits show while open.
export function packageInit(view, cx) {
  view.wsx = {
    text: null, // ~/.herdr/settings.jsonc as last read (null: there's none)
    settings: parseSettings(null),
    resume: null, // { on, count, ready }
    guide: null, // { on, bytes }
    known: shared("new-menu.agents")?.[""] ?? [],
    hidden: shared(HIDDEN) ?? [],
    busy: false, // a Features or Experimental write is in flight
    gen: 0, // counts those writes (at their start and end), so a read from before one is dropped
    hiding: 0, // count of in-flight flipAgent saves
    loading: null, // active load() promise, to prevent overlapping polls
    apps: null, // Default external app's makings: { catalogInstalled, macApps, system } (findApps)
    appsLoading: false,
    // Quiet hours' Custom: its two times, and whether Custom is picked while the file has none of its own.
    quietFrom: InputState.new({ value: "", placeholder: "22:00" }),
    quietTo: InputState.new({ value: "", placeholder: "08:00" }),
    quietCustom: false,
  };
  for (const input of [view.wsx.quietFrom, view.wsx.quietTo]) {
    input.on("change", (_e, cx) => cx.notify());
    input.on("submit", (_e, cx) => saveQuiet(view.wsx, cx));
  }
  if (checking()) return;
  const refresh = (cx) => cx.spawn(async (cx) => {
    if (await load(view.wsx)) {
      // A file that can't be read closes Default external app's list (its choices are greyed).
      if (view.picking === APP_PICK && view.wsx.settings.error) view.picking = null;
      cx.notify();
    }
    if (view.section === "files" && (await findApps(view.wsx))) cx.notify();
  });
  refresh(cx);
  cx.timer.every(3000, refresh);
  cx.spawn(async (cx) => {
    view.wsx.known = await knownAgents().catch(() => view.wsx.known);
    cx.notify();
  });
}

// Reads the package files on disk. Guards against overlapping polls (when wait is false),
// in-flight Features or Experimental writes (x.busy), and in-flight + menu saves (x.hiding).
async function load(x, wait = false) {
  if (x.loading) {
    if (!wait) return false;
    await x.loading;
  }
  const p = (async () => {
    if (!x.busy) {
      // A write that started and finished during this read changed gen: the text read is from
      // before it, so it mustn't go back into the page or shared state.
      const gen = x.gen;
      const text = await readTextFile(file()).catch(() => null);
      if (!x.busy && x.gen === gen) {
        x.text = text;
        x.settings = parseSettings(text);
        // A hand edit of the file reaches the mods that follow it while this window is open
        // (ws-agents reads the file into shared state too, but only every minute).
        if (JSON.stringify(x.settings) !== JSON.stringify(shared("workspaces.settings") ?? null)) setShared("workspaces.settings", x.settings);
      }
    }
    const sw = async (path) => ((await readTextFile(path).catch(() => null)) ?? "").trim() !== "off";
    const resumeDir = `${home()}/.herdr/resume`;
    let count = 0;
    for (const core of await fs.readdir(resumeDir).catch(() => [])) {
      count += (await fs.readdir(`${resumeDir}/${core}`).catch(() => [])).filter((f) => f.endsWith(".cmd")).length;
    }
    const config = await readTextFile(`${home()}/.config/herdr-core/config.toml`).catch(() => null);
    x.resume = { on: await sw(`${resumeDir}/switch`), count, ready: (config ?? "").includes("herdr-ws-resume") };
    const guideText = await readTextFile(guideFile()).catch(() => null);
    x.guide = { on: await sw(`${home()}/.herdr/guide/switch`), bytes: guideText ? guideText.length : 0 };
    if (!x.hiding) {
      const hidden = parseHidden(await readTextFile(hiddenFile(home())).catch(() => null));
      if (!x.hiding) {
        x.hidden = hidden;
        if (JSON.stringify(hidden) !== JSON.stringify(shared(HIDDEN))) setShared(HIDDEN, hidden);
      }
    }
  })();
  x.loading = p;
  try {
    await p;
    return true;
  } finally {
    if (x.loading === p) x.loading = null;
  }
}

// One experiment or add-on flipped: only its value changes in the file. edit is withExperiment
// or withFeature, isOn experimentOn or featureOn. The new value is the opposite of what the file
// says now (not the page's last read, up to 3 seconds old). What's set in shared state is the
// whole parse (experiments and features both), so neither page's change hides the other's.
function setSetting(x, edit, isOn, key, cx) {
  if (x.busy) return;
  x.busy = true;
  x.gen = (x.gen ?? 0) + 1;
  cx.spawn(async (cx) => {
    try {
      const old = await readTextFile(file()).catch(() => null);
      const was = parseSettings(old);
      const next = edit(old, key, !isOn(was, key));
      if (next == null) {
        throw new Error(was.error
          ? `${tilde(file())} isn't valid JSONC; fix it in the file first`
          : `${tilde(file())} isn't in a shape this switch can change safely (a setting that isn't true or false, or written twice); change it in the file`);
      }
      if (next !== old) await writeTextFile(file(), next, old ?? undefined);
      x.text = next;
      x.settings = parseSettings(next);
      setShared("workspaces.settings", x.settings);
    } catch (e) {
      notify({ title: "Couldn't change it", body: errMsg(e), level: "error" });
    }
    x.gen += 1;
    x.busy = false;
    cx.notify();
  });
}

// One Files setting chosen: only its value changes in the file (withFileSetting, comments kept),
// and shared "workspaces.settings" gets the whole parse, so open Files views and the Cmd-click
// handler follow at once. The value the file already has isn't written again (the page's own
// read can be 3s old, so that's checked on the file, not on the page).
function setFileSetting(x, key, value, cx) {
  if (x.busy || x.settings.error) return;
  x.busy = true;
  x.gen = (x.gen ?? 0) + 1;
  cx.spawn(async (cx) => {
    try {
      const old = await readTextFile(file()).catch(() => null);
      const was = parseSettings(old);
      const next = was.error || fileSetting(was, key) !== value ? withFileSetting(old, key, value) : old;
      if (next == null) {
        throw new Error(was.error
          ? `${tilde(file())} isn't valid JSONC; fix it in the file first`
          : `${tilde(file())} isn't in a shape this can change safely (a "files" value that isn't a plain value, or written twice); change it in the file`);
      }
      if (next !== old) await writeTextFile(file(), next, old ?? undefined);
      x.text = next;
      x.settings = parseSettings(next);
      if (JSON.stringify(x.settings) !== JSON.stringify(shared("workspaces.settings") ?? null)) setShared("workspaces.settings", x.settings);
    } catch (e) {
      notify({ title: "Couldn't change it", body: errMsg(e), level: "error" });
    }
    x.gen += 1;
    x.busy = false;
    cx.notify();
  });
}

// One Automations setting chosen: only its value changes in the file (withAutomationSetting,
// comments kept), and shared "workspaces.settings" gets the whole parse, so the runner, the
// Automations screen's drafter and the background runner follow it.
function setAutomationSetting(x, key, value, cx) {
  if (x.busy || x.settings.error) return;
  x.busy = true;
  x.gen = (x.gen ?? 0) + 1;
  cx.spawn(async (cx) => {
    try {
      const old = await readTextFile(file()).catch(() => null);
      const was = parseSettings(old);
      const next = was.error || automationSetting(was, key) !== value ? withAutomationSetting(old, key, value) : old;
      if (next == null) {
        throw new Error(was.error
          ? `${tilde(file())} isn't valid JSONC; fix it in the file first`
          : `${tilde(file())} isn't in a shape this can change safely (an "automations" value that isn't a plain value, or written twice); change it in the file`);
      }
      if (next !== old) await writeTextFile(file(), next, old ?? undefined);
      x.text = next;
      x.settings = parseSettings(next);
      if (JSON.stringify(x.settings) !== JSON.stringify(shared("workspaces.settings") ?? null)) setShared("workspaces.settings", x.settings);
    } catch (e) {
      notify({ title: "Couldn't change it", body: errMsg(e), level: "error" });
    }
    x.gen += 1;
    x.busy = false;
    cx.notify();
  });
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const twoDigits = (v) => { const m = HHMM.exec(String(v ?? "").trim()); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };
// Custom quiet hours, from the two boxes: saved when both are times and they differ.
function saveQuiet(x, cx) {
  const from = twoDigits(x.quietFrom?.value()), to = twoDigits(x.quietTo?.value());
  if (!from || !to || from === to) {
    notify({ title: "Quiet hours need two different times", body: "Write them as HH:MM, like 22:00 and 08:00.", level: "warning" });
    return;
  }
  x.quietCustom = false;
  setAutomationSetting(x, "quiet-hours", `${from}-${to}`, cx);
}

// Default external app's makings, once a window (true when found now): the editors installed
// (their commands on PATH, as Files' Open in finds them) and, on macOS, the apps it offers for a
// text file and the one it opens text with (a sample file under appHome()/data/ws-settings).
async function findApps(x) {
  if (x.apps || x.appsLoading) return false;
  x.appsLoading = true;
  try {
    const platform = window()?.platform ?? "macos";
    let catalogInstalled = [], macApps = [], system = null;
    if (platform !== "windows") {
      const bins = EDITOR_CATALOG.map((e) => e.binary).join(" ");
      const r = await exec("sh", ["-c", `for b in ${bins}; do command -v "$b" >/dev/null 2>&1 && printf '%s\\n' "$b"; done; true`]).catch(() => null);
      const found = new Set(String(r?.stdout ?? "").split("\n").filter(Boolean));
      catalogInstalled = EDITOR_CATALOG.filter((e) => found.has(e.binary)).map((e) => e.id);
    }
    if (platform === "macos") {
      const dir = `${appHome()}/data/ws-settings`;
      await exec("sh", ["-c", 'mkdir -p "$1" && { [ -f "$1/sample.txt" ] || printf "text\\n" >"$1/sample.txt"; }', "sample", dir]).catch(() => null);
      const jxa = 'function run(argv) { ObjC.import("AppKit"); const ws = $.NSWorkspace.sharedWorkspace, fm = $.NSFileManager.defaultManager, url = $.NSURL.fileURLWithPath(argv[0]); const urls = ws.URLsForApplicationsToOpenURL(url), def = ws.URLForApplicationToOpenURL(url); const out = []; for (let i = 0; i < urls.count && i < 60; i++) { const u = urls.objectAtIndex(i), p = u.path.js; let b = null; try { const bb = $.NSBundle.bundleWithURL(u); b = bb && bb.bundleIdentifier ? bb.bundleIdentifier.js : null; } catch (e) {} out.push({ name: fm.displayNameAtPath(p).js, path: p, bundle: b || null }); } return JSON.stringify({ apps: out, system: def && def.path ? def.path.js : null }); }';
      const r = await exec("osascript", ["-l", "JavaScript", "-e", jxa, `${dir}/sample.txt`], { timeout: 5000 }).catch(() => null);
      try { const o = JSON.parse(r?.stdout || "{}"); macApps = o.apps ?? []; system = o.system ?? null; } catch { /* the editors alone */ }
    }
    x.apps = { catalogInstalled, macApps, system };
    return true;
  } finally {
    x.appsLoading = false;
  }
}

// Give every agent the guide, or none: herdr-ws-agent --guide on / off.
function flipGuide(x, cx) {
  const on = !(x.guide?.on ?? true);
  x.guide = { ...(x.guide ?? { bytes: 0 }), on };
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await exec(bin("herdr-ws-agent"), ["--guide", on ? "on" : "off"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
    if (r.code !== 0) notify({ title: "Couldn't change it", body: String(r.stderr || r.stdout).trim() || "herdr-ws-agent failed.", level: "error" });
    await load(x, true);
    cx.notify();
  });
}

// Edit opens ~/.herdr/AGENTS.md in Files (the Settings window closes so it's seen); with none yet,
// it's first written from the starter (create-only).
function editGuide(x, cx) {
  cx.spawn(async (cx) => {
    const existing = await readTextFile(guideFile()).catch(() => null);
    if (existing == null) {
      const starterText = await readTextFile(guideStarter()).catch(() => null);
      await writeTextFile(guideFile(), starterText ?? "# Working in Herdr\n", null).catch(() => {});
      await load(x, true);
      cx.notify();
    }
    openInFiles(guideFile());
    if (props()?.overlay) closeOverlay(props().overlay);
  });
}

// Bring agents back after a restart, or not: herdr-ws-resume --on / --off.
function flipResume(x, cx) {
  const on = !(x.resume?.on ?? true);
  x.resume = { ...(x.resume ?? { count: 0, ready: true }), on };
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await exec(bin("herdr-ws-resume"), [on ? "--on" : "--off"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
    if (r.code !== 0) notify({ title: "Couldn't change it", body: String(r.stderr || r.stdout).trim() || "herdr-ws-resume failed.", level: "error" });
    await load(x, true);
    cx.notify();
  });
}

// One agent's switch: shown in the + menu or not. The switch moves at once, the file follows;
// a file that can't be written puts it back as the file has it.
function flipAgent(x, key, cx) {
  const cur = shared(HIDDEN) ?? x.hidden ?? [];
  const hide = !cur.includes(key);
  x.hidden = hide ? [...cur, key] : cur.filter((k) => k !== key);
  x.hiding = (x.hiding ?? 0) + 1;
  setShared(HIDDEN, x.hidden);
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      try { x.hidden = await saveHidden({ home, readTextFile, writeTextFile }, key, hide); }
      catch (e) {
        notify({ title: "Couldn't change the + menu", body: `${tilde(hiddenFile(home()))}: ${errMsg(e)}`, level: "error" });
        x.hidden = parseHidden(await readTextFile(hiddenFile(home())).catch(() => null));
      }
      setShared(HIDDEN, x.hidden);
    } finally {
      x.hiding = Math.max(0, (x.hiding ?? 1) - 1);
    }
    cx.notify();
  });
}

// --- drawn as Herdr's Settings window draws them (our own copies, so a change to Herdr's
// methods can't break these pages) ---
function heading(t, text) {
  return div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text.toUpperCase());
}

// quiet: the title in the muted colour (an add-on that's off).
function row(t, id, title, about, extra, control, warn = false, quiet = false) {
  return h_flex().id(id).w_full().gap(16).py(12).items_center().border_b(1).border_color(t.border)
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(14).text_color(quiet ? t.muted : t.foreground).child(title))
      .when(Boolean(about), (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about)))
      .when(Boolean(extra), (el) => el.child(div().text_size(12).line_height("17px").text_color(warn ? t.blocked : t.muted).child(extra))))
    .child(div().flex_none().child(control));
}

function toggle(t, id, on, onClick, off = false) {
  return div().id(id).w(36).h(20).rounded(10).p(2).flex()
    .bg(on ? t.accent : t.hover).when(on, (el) => el.justify_end())
    .when(off, (el) => el.opacity(0.4))
    .when(!off, (el) => el.cursor_pointer().on_click(onClick))
    .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted));
}

// A choice of values, drawn as Herdr's Appearance picker (an unchosen one keeps a clear border, so
// nothing moves when the choice does). off: greyed, no clicks. The chosen one isn't clickable.
function segmented(t, id, values, now, onPick, off = false) {
  return h_flex().p(2).gap(2).rounded(8).border_1().border_color(t.border).bg(t.background)
    .when(off, (el) => el.opacity(0.4))
    .children(values.map((v) => div().id(`${id}-${v.value}`).px(12).py(4).rounded(6).border_1().text_size(13)
      .when(now === v.value, (el) => el.bg(t.raised).text_color(t.foreground).border_color(t.border))
      .when(now !== v.value, (el) => el.border_color("#00000000").text_color(t.muted)
        .when(!off, (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => onPick(v.value, cx))))
      .child(v.label)));
}

function button(t, id, label, onClick, tip = "") {
  return div().id(id).px(12).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised).cursor_pointer()
    .text_size(13).text_color(t.foreground).hover((s) => s.bg(t.hover))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .on_click(onClick).child(label);
}

function agentsPage(t, x) {
  const g = x.guide ?? { on: true, bytes: 0 };
  const guideSize = g.bytes < 1024 ? `${g.bytes} bytes` : `${(g.bytes / 1024).toFixed(1)} KB`;
  const guideNote = !x.guide ? "" : !g.bytes ? "No guide yet" : g.on ? `On: ${guideSize}` : "Off: agents go without it";
  const guideBtn = !x.guide || g.bytes ? "Edit" : "Write one";
  const guideTip = g.bytes ? `Open ${tilde(guideFile())} in Files` : `Write ${tilde(guideFile())} from the starter, then open it in Files`;

  const r = x.resume ?? { on: true, count: 0, ready: true };
  const resumeNote = !x.resume ? ""
    : !r.ready ? "Not set up in herdr-core's config.toml (see the recipe)."
    : !r.on ? "Off: tabs come back as shells"
    : r.count === 1 ? "On: 1 agent would come back" : `On: ${r.count} agents would come back`;

  const hidden = shared(HIDDEN) ?? x.hidden ?? [];
  const installed = x.known.filter((a) => a.installed);
  const shown = new Set(shownAgents(installed, hidden).map((a) => a.key));
  const missing = notInstalledLine(x.known);
  const iconOf = (a) => !a.icon
    ? svg("mods/workspace-chrome/terminal.svg").size(16).flex_none().text_color(t.muted)
    : (a.tint ? svg(a.icon).text_color(t.foreground) : image(a.icon)).size(16).flex_none().rounded(3);

  return v_flex().w_full()
    .child(heading(t, "Starting agents"))
    .child(row(t, "wsx-s-guide", "Herdr guide for every agent",
      "Agents started through the launcher get ~/.herdr/AGENTS.md, how to use automations, helpers and the board, before the workspace's own instructions.",
      guideNote,
      h_flex().gap(10).items_center()
        .child(button(t, "wsx-s-guide-edit", guideBtn, (_e, cx) => editGuide(x, cx), guideTip))
        .child(toggle(t, "wsx-s-guide-switch", g.on, (_e, cx) => flipGuide(x, cx)))))
    .child(row(t, "wsx-s-resume", "Bring agents back after a restart",
      "Claude and Antigravity agents started through the launcher continue their conversation after a reboot or a logout.",
      resumeNote,
      toggle(t, "wsx-s-resume-switch", r.on, (_e, cx) => flipResume(x, cx)),
      Boolean(x.resume && !r.ready && r.on)))
    .child(div().h(22))
    .child(h_flex().items_center().gap(10)
      .child(heading(t, "In the + menu"))
      .when(installed.length > 0, (el) => el.child(div().pt(6).pb(8).text_size(12).text_color(t.muted).child(countLine(x.known, hidden)))))
    .child(div().pb(6).text_size(12.5).line_height("18px").text_color(t.dim)
      .child("The tab bar's + lists the agents installed here. Turn off the ones you don't use; a right-click on an agent in the + menu hides it too."))
    .when(!installed.length, (el) => el.child(div().py(10).text_size(12.5).text_color(t.dim)
      .child(x.known.length ? "No agents are installed here." : "Checking installed agents…")))
    .children(installed.map((a) => {
      const on = shown.has(a.key);
      return h_flex().id(`wsx-a-${a.key}`).w_full().gap(12).py(10).items_center().border_b(1).border_color(t.border)
        .child(iconOf(a))
        .child(div().flex_1().min_w(0).truncate().text_size(14).text_color(on ? t.foreground : t.muted).child(a.name))
        .when(!on, (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child("hidden")))
        .child(toggle(t, `wsx-a-${a.key}-switch`, on, (_e, cx) => flipAgent(x, a.key, cx)));
    }))
    .when(Boolean(missing), (el) => el.child(div().pt(10).text_size(12).line_height("17px").text_color(t.dim).child(missing)))
    .child(div().pt(missing ? 6 : 10).text_size(12).line_height("17px").text_color(t.dim)
      .child("Hidden agents are only left out of the + menu. Presets and automations can still start them."));
}

// Automations: the background runner (Keep running, Start at login), then the limits and quiet
// hours and the drafter from "automations" in the settings file. A broken file: one note, those
// three greyed at their defaults (what the runner uses until it's fixed); the runner's switches
// still work, since they don't live in the file.
function automationsPage(t, x) {
  const broken = x.settings.error;
  const off = Boolean(broken) || x.busy;
  const runner = shared("workspaces.runner") ?? { on: false, running: false };
  const runnerNote = !runner.on ? "Off: they run while Herdr is open"
    : !runner.running ? "On, but not running yet"
    : runner.via === "launchd" ? `On: running via launchd${runner.pid ? ` (pid ${runner.pid})` : ""}`
    : `On: running in herdr-core${runner.pid ? ` (pid ${runner.pid})` : ""}`;
  const mac = (window()?.platform ?? "macos") === "macos";
  const loginNote = !mac ? "macOS only. On Linux, herdr-ws-runner --login on prints a systemd user unit to set up."
    : runner.login ? `On: ${tilde(runner.plist || `${home()}/Library/LaunchAgents/dev.herdr.ws-runner.plist`)}` : "";
  const s = (key) => AUTOMATIONS_SETTINGS.find((a) => a.key === key);
  const val = (key) => automationSetting(x.settings, key);
  const quiet = val("quiet-hours");
  const quietNow = x.quietCustom ? "custom" : quiet == null ? "off" : quiet === "22:00-08:00" ? "22:00-08:00" : "custom";
  const pickQuiet = (v, cx) => {
    if (v === "custom") {
      // Custom: the boxes, filled with what's there (or the usual night), and Save.
      const [a, b] = String(quiet ?? "22:00-08:00").split("-");
      x.quietFrom?.set_value(a ?? ""); x.quietTo?.set_value(b ?? "");
      x.quietCustom = true;
      cx.notify();
      return;
    }
    x.quietCustom = false;
    setAutomationSetting(x, "quiet-hours", v === "off" ? null : v, cx);
  };
  const time = (state) => div().w(64).child(Input.new(state).h(28).px(8).rounded(7).border_1().border_color(t.border).bg(t.background)
    .text_size(13).text_color(t.foreground).font_family("JetBrains Mono"));
  const quietRow = row(t, "wsx-au-quiet", "Quiet hours for desktop sound",
    "Mute background desktop notification sounds overnight while Herdr is closed. Everything still shows in the bell and History.",
    quietNow === "custom" && !x.quietCustom && quiet ? `Now: ${quiet.replace("-", " – ")}` : "",
    v_flex().gap(8).items_end()
      .child(segmented(t, "wsx-au-quiet-seg", [{ value: "off", label: "Off" }, { value: "22:00-08:00", label: "22:00 – 08:00" }, { value: "custom", label: "Custom" }], quietNow, pickQuiet, off))
      .when(quietNow === "custom" && !off && Boolean(x.quietFrom), (el) => el.child(h_flex().gap(6).items_center()
        .child(time(x.quietFrom)).child(div().text_size(13).text_color(t.dim).child("–")).child(time(x.quietTo))
        .child(button(t, "wsx-au-quiet-save", "Save", (_e, cx) => saveQuiet(x, cx), "Save these quiet hours")))),
    false, Boolean(broken));
  const drafters = [{ value: "auto", label: "Auto" }, { value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }, { value: "agy", label: "Antigravity" }, { value: "pi", label: "Pi" }];
  return v_flex().w_full()
    .child(div().pb(4).text_size(18).font_semibold().text_color(t.foreground).child("Automations"))
    .child(div().pb(14).text_size(12.5).line_height("18px").text_color(t.dim)
      .child(`Background runner, limits, quiet hours and drafter defaults. Saves to ${tilde(file())}.`))
    .when(Boolean(broken), (el) => el.child(div().mb(14).p(10).rounded(8).bg(t.blocked + "1f").text_size(12.5).line_height("18px").text_color(t.blocked)
      .child(`${tilde(file())} isn't valid JSONC (${broken}). Defaults stay in effect until it's fixed.`)))
    .child(heading(t, "While Herdr is closed"))
    .child(row(t, "wsx-s-runner", "Keep running",
      "Automations and board cards' pull requests keep running in a background process after you close Herdr. Turning it off turns off Start at login too.",
      runnerNote,
      toggle(t, "wsx-s-runner-switch", runner.on, () => setShared("workspaces.runner.set", { on: !runner.on, at: Date.now() })),
      Boolean(runner.on && !runner.running)))
    .child(row(t, "wsx-au-login", "Start at login",
      "Install a macOS LaunchAgent so automations run after a reboot without opening Herdr. Shell scripts run without starting herdr-core.",
      loginNote,
      toggle(t, "wsx-au-login-switch", Boolean(runner.login), () => setShared("workspaces.runner.set", { login: !runner.login, at: Date.now() }), !mac),
      false, !mac))
    .child(div().h(14))
    .child(heading(t, "Limits & quiet hours"))
    .child(row(t, "wsx-au-parallel", s("max-parallel").title,
      "When a global schedule fires in several workspaces at once, extra runs queue instead of starting all at once.", "",
      segmented(t, "wsx-au-parallel-seg", s("max-parallel").values, val("max-parallel"), (v, cx) => setAutomationSetting(x, "max-parallel", v, cx), off),
      false, Boolean(broken)))
    .child(quietRow)
    .child(div().h(14))
    .child(heading(t, "Authoring"))
    .child(row(t, "wsx-au-drafter", "Drafter",
      "Which installed CLI turns your words into an automation when you click Draft it or Change it. Auto tries Claude, Codex, Antigravity, then Pi.", "",
      segmented(t, "wsx-au-drafter-seg", drafters, val("drafter"), (v, cx) => setAutomationSetting(x, "drafter", v, cx), off),
      false, Boolean(broken)));
}

function experimentalPage(t, x) {
  const broken = x.settings.error;
  return v_flex().w_full()
    .child(heading(t, "Experimental"))
    .child(div().pb(6).text_size(12.5).line_height("18px").text_color(t.dim)
      .child("Features that lean on things other programs don't promise to keep the same. Each is off until you turn it on, and says why it's experimental."))
    .when(Boolean(broken), (el) => el.child(div().my(8).p(10).rounded(8).bg(t.blocked + "1f").text_size(12.5).line_height("18px").text_color(t.blocked)
      .child(`${tilde(file())} isn't valid JSONC (${broken}). These stay off until it's fixed.`)))
    .children(EXPERIMENTS.map((e) => {
      const on = experimentOn(x.settings, e.key);
      return row(t, `wsx-x-${e.key}`, e.title, e.what, `Why it's experimental: ${e.why.charAt(0).toLowerCase()}${e.why.slice(1)}`,
        toggle(t, `wsx-x-${e.key}-switch`, on, (_e, cx) => setSetting(x, withExperiment, experimentOn, e.key, cx), Boolean(broken) || x.busy));
    }));
}

// Features: the add-ons in their groups, a switch each. A row that's off says what's gone and
// what stays; Automations says how many there are while on. A broken file: one note, every
// switch greyed and drawn on (everything acts as on until it's fixed).
function featuresPage(t, x) {
  const broken = x.settings.error;
  const autos = automationCount(shared("workspaces.automations"));
  const groups = [];
  for (const f of FEATURES) {
    const g = groups.find((y) => y.name === f.group);
    if (g) g.list.push(f);
    else groups.push({ name: f.group, list: [f] });
  }
  return v_flex().w_full()
    .child(div().pb(4).text_size(18).font_semibold().text_color(t.foreground).child("Features"))
    .child(div().pb(18).text_size(12.5).line_height("18px").text_color(t.dim)
      .child("Turn off what you don't use. Off hides it everywhere and stops its background work; nothing is deleted, so on brings it back as it was."))
    .when(Boolean(broken), (el) => el.child(div().mb(14).p(10).rounded(8).bg(t.blocked + "1f").text_size(12.5).line_height("18px").text_color(t.blocked)
      .child(`${tilde(file())} isn't valid JSONC (${broken}). Everything stays on until it's fixed.`)))
    .children(groups.map((g, i) => v_flex().w_full()
      .when(i > 0, (el) => el.child(div().h(22)))
      .child(heading(t, g.name))
      .children(g.list.map((f) => {
        const on = featureOn(x.settings, f.key);
        const extra = broken ? "" : f.key === "automations" ? automationsLine(autos, on) : on ? "" : f.off;
        return row(t, `wsx-f-${f.key}`, f.title, f.what, extra,
          toggle(t, `wsx-f-${f.key}-switch`, on, (_e, cx) => setSetting(x, withFeature, featureOn, f.key, cx), Boolean(broken) || x.busy),
          false, !on);
      }))));
}

const APP_PICK = "wsx-files-app"; // the window's `picking` while Default external app's list is open

// Default external app: the app chosen (a trigger drawn as Herdr's font button) and, open, its
// list under it: Automatic, then the apps (appChoices), the chosen one checked. Closes on a pick,
// a press outside it, Escape (the window's), a section change and a file that can't be read.
function appPicker(t, x, view, now, off) {
  const open = view.picking === APP_PICK && !off;
  const choices = appChoices({ ...(x.apps ?? {}), current: now });
  const close = (cx) => { view.picking = null; view.handle?.focus(); cx.notify(); };
  const trigger = h_flex().id("wsx-files-app").w(220).px(12).py(6).gap(8).items_center().rounded(7).border_1()
    .border_color(open ? t.accent : t.border).bg(t.raised)
    .when(off, (el) => el.opacity(0.4))
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
      if (open) return close(cx);
      view.picking = APP_PICK;
      view.handle?.focus();
      cx.notify();
      cx.spawn(async (cx) => { if (await findApps(x)) cx.notify(); });
    }))
    .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(now == null ? t.muted : t.foreground).child(appLabel(choices, now)))
    .child(svg("mods/ws-settings/chevron-down.svg").size(12).flex_none().text_color(t.dim));
  const item = (id, label, tag) => {
    const on = id === now;
    return h_flex().id(`wsx-files-app-${id ?? "auto"}`).flex_none().h(30).px(9).gap(8).items_center().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { close(cx); setFileSetting(x, "default-app", id, cx); })
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(label))
      .when(Boolean(tag), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(tag)))
      .child(div().w(12).flex_none().when(on, (el) => el.child(svg("frame/settings/check.svg").size(12).text_color(t.accent))));
  };
  // Rows and the line keep their height (flex_none), so a long list scrolls instead of squeezing.
  const list = v_flex().id("wsx-files-app-list").w(260).max_h(280).overflow_y_scroll().p(5).rounded(9).border_1().border_color(t.border).bg(t.background)
    .on_mouse_down_out((_e, cx) => close(cx))
    .on_scroll_wheel((_e, cx) => cx.stop_propagation())
    .child(item(null, "Automatic", "editor first"))
    .child(div().flex_none().my(4).h(1).bg(t.border))
    .children(choices.map((a) => item(a.id, a.label, a.tag)))
    .when(!x.apps, (el) => el.child(div().px(9).py(6).text_size(12).text_color(t.dim).child("Looking for installed apps…")));
  return Popup.new("wsx-files-app-pop", trigger).anchor("top_right").when(open, (el) => el.content(list));
}

// Files: Files' defaults in two groups, each row its control. Cmd-click Off says what happens and
// greys Files to catch. A broken file: one note, every row and control greyed and drawn at the
// defaults (what Files and the Cmd-click handler use until it's fixed).
function filesPage(t, x, view) {
  const broken = x.settings.error;
  const val = (key) => fileSetting(x.settings, key);
  const off = Boolean(broken) || x.busy;
  const f = (key) => FILES_SETTINGS.find((s) => s.key === key);
  const choiceRow = (key, greyed = false) => {
    const s = f(key), now = val(key);
    return row(t, `wsx-files-${key}`, s.title, s.what, key === "cmd-click" && now === "off" && !broken ? s.off : "",
      segmented(t, `wsx-files-${key}-seg`, s.values, now, (v, cx) => setFileSetting(x, key, v, cx), off || greyed),
      false, Boolean(broken) || greyed);
  };
  const ign = f("show-ignored"), app = f("default-app");
  const clickOff = val("cmd-click") === "off";
  return v_flex().w_full()
    .child(div().pb(4).text_size(18).font_semibold().text_color(t.foreground).child("Files"))
    // Two lines, so the path never breaks at one of its slashes.
    .child(v_flex().pb(14).text_size(12.5).line_height("18px").text_color(t.dim)
      .child(div().child("Defaults for the Files view and Cmd-clicked paths."))
      .child(div().child(`Changes apply immediately and save to ${tilde(file())}.`)))
    .when(Boolean(broken), (el) => el.child(div().mb(14).p(10).rounded(8).bg(t.blocked + "1f").text_size(12.5).line_height("18px").text_color(t.blocked)
      .child(`${tilde(file())} isn't valid JSONC (${broken}). Defaults stay in effect until it's fixed.`)))
    .child(heading(t, "Viewing"))
    .child(choiceRow("markdown"))
    .child(row(t, "wsx-files-default-app", app.title, app.what, "", appPicker(t, x, view, val("default-app"), off), false, Boolean(broken)))
    .child(row(t, "wsx-files-show-ignored", ign.title, ign.what, "",
      toggle(t, "wsx-files-show-ignored-switch", val("show-ignored"), (_e, cx) => setFileSetting(x, "show-ignored", !val("show-ignored"), cx), off),
      false, Boolean(broken)))
    .child(div().h(14))
    .child(heading(t, "Opening from terminals"))
    .child(choiceRow("cmd-click"))
    .child(choiceRow("catch", clickOff));
}

// The page: the window's body shows it for our section ids ("features", "agents", "automations", "files" and "experimental").
export function packagePage(view) {
  const t = theme();
  const x = view.wsx ?? (view.wsx = { text: null, settings: parseSettings(null), resume: null, guide: null, known: [], hidden: [], busy: false, gen: 0, hiding: 0, loading: null, apps: null, appsLoading: false, quietFrom: null, quietTo: null });
  return view.section === "features" ? featuresPage(t, x) : view.section === "automations" ? automationsPage(t, x) : view.section === "files" ? filesPage(t, x, view) : view.section === "experimental" ? experimentalPage(t, x) : agentsPage(t, x);
}
