// The Extras section of ws-settings: the Workspaces package's own settings, drawn inside the
// Settings window that ws-switcher/settingsbuild.js builds from Herdr's (main.js here). These
// are plain functions on that window's view, so they don't depend on Herdr's own methods; their
// state lives on the view as `view.wsx`.
//
// - Experimental: the experiments in ~/.herdr/settings.jsonc (settingsfacts.js), each off until
//   turned on, with what it does and why it's experimental. A switch rewrites only its value in
//   the file (comments kept) and sets shared "workspaces.settings" so the mods that read it
//   (ws-agents) follow at once.
// - Switches: the package's switches that live in other screens too: Keep running
//   (ws-automations; shared "workspaces.runner", set through "workspaces.runner.set"), bring
//   agents back after a restart (herdr-ws-resume --on/--off) and the Herdr guide for every agent
//   (herdr-ws-agent --guide on/off), as ws-presets flips them.
// - Open the file: ~/.herdr/settings.jsonc in your editor (written from the starter first when
//   there's none).

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, exec, home, readTextFile, writeTextFile, notify, window, checking } from "herdr";
import { SETTINGS_FILE, EXPERIMENTS, parseSettings, withExperiment, starter, experimentOn } from "./settingsfacts.js";

// Its entry in the window's list of sections, after Herdr's.
export const EXTRAS_SECTION = { id: "extras", title: "Extras", icon: "mods/ws-settings/extras.svg" };

// A section asked for by whoever opened the window (ws-switcher.settings/<section>): mod.open
// passes no props, so it comes through shared state, for a moment. Taking it clears it, which
// tells the asker the window opened (else its mod.open closed an open one: it opens it again).
export function askedSection() {
  const a = shared("workspaces.settings.section");
  if (!a || typeof a.id !== "string" || Date.now() - (a.at ?? 0) >= 5000) return undefined;
  setShared("workspaces.settings.section", null);
  return a.id;
}

const file = () => `${home()}/${SETTINGS_FILE}`;
const bin = (name) => `${home()}/.config/herdr-app/mods/ws-switcher/bin/${name}`;
const tilde = (p) => (p.startsWith(`${home()}/`) ? `~${p.slice(home().length)}` : p);

// As ws-presets opens a file: the first installed editor, else the system's opener.
const EDITORS = ["zed", "cursor", "code", "subl"];
function openFile(path) {
  if (window()?.platform === "windows") return exec("explorer", [path]).catch(() => {});
  const editors = EDITORS.map((e) => `command -v ${e} >/dev/null 2>&1 && exec ${e} "$1";`).join(" ");
  return exec("sh", ["-c", `${editors} command -v open >/dev/null 2>&1 && exec open -t "$1"; exec xdg-open "$1"`, "sh", path]).catch(() => {});
}

// From the window's init: read the file and the switches once.
export function extrasInit(view, cx) {
  view.wsx = {
    text: null, // the file as last read (null: there's none)
    settings: parseSettings(null),
    resume: null, // { on, ready }
    guide: null, // { on }
    busy: false,
  };
  if (checking()) return;
  cx.spawn(async (cx) => { await load(view.wsx); cx.notify(); });
}

async function load(x) {
  x.text = await readTextFile(file()).catch(() => null);
  x.settings = parseSettings(x.text);
  const sw = async (p) => ((await readTextFile(p).catch(() => null)) ?? "").trim() !== "off";
  const config = await readTextFile(`${home()}/.config/herdr-core/config.toml`).catch(() => null);
  x.resume = { on: await sw(`${home()}/.herdr/resume/switch`), ready: (config ?? "").includes("herdr-ws-resume") };
  x.guide = { on: await sw(`${home()}/.herdr/guide/switch`) };
}

// One experiment on or off: only its value changes in the file.
function setExperiment(x, key, on, cx) {
  if (x.busy) return;
  x.busy = true;
  cx.spawn(async (cx) => {
    try {
      const old = await readTextFile(file()).catch(() => null);
      const next = withExperiment(old, key, on);
      if (next == null) throw new Error(`${tilde(file())} isn't valid JSONC; fix it in the file first`);
      await writeTextFile(file(), next, old ?? undefined);
      x.text = next;
      x.settings = parseSettings(next);
      setShared("workspaces.settings", x.settings);
    } catch (e) {
      notify({ title: "Couldn't change it", body: String(e?.message ?? e), level: "error" });
    }
    x.busy = false;
    cx.notify();
  });
}

// A switch's script, then how it is now.
function flip(x, script, args, cx) {
  cx.spawn(async (cx) => {
    const r = await exec(bin(script), args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
    if (r.code !== 0) notify({ title: "Couldn't change it", body: String(r.stderr || r.stdout).trim() || `${script} failed.`, level: "error" });
    await load(x);
    cx.notify();
  });
}

function openTheFile(x, cx) {
  cx.spawn(async (cx) => {
    const old = await readTextFile(file()).catch(() => null);
    if (old == null) {
      await writeTextFile(file(), starter(x.settings.experimental)).catch(() => {});
      await load(x);
      cx.notify();
    }
    openFile(file());
  });
}

// --- drawn as Herdr's Settings window draws them (our own copies, so a change to Herdr's
// methods can't break this page) ---
function heading(t, text) {
  return div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text.toUpperCase());
}

function row(t, id, title, about, extra, control) {
  return h_flex().id(id).w_full().gap(16).py(12).items_center().border_b(1).border_color(t.border)
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(14).text_color(t.foreground).child(title))
      .when(Boolean(about), (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about)))
      .when(Boolean(extra), (el) => el.child(div().text_size(12).line_height("17px").text_color(t.muted).child(extra))))
    .child(div().flex_none().child(control));
}

function toggle(t, id, on, onClick, off = false) {
  return div().id(id).w(36).h(20).rounded(10).p(2).flex()
    .bg(on ? t.accent : t.hover).when(on, (el) => el.justify_end())
    .when(off, (el) => el.opacity(0.4))
    .when(!off, (el) => el.cursor_pointer().on_click(onClick))
    .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted));
}

function button(t, id, label, onClick) {
  return div().id(id).px(12).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised).cursor_pointer()
    .text_size(13).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
}

function experimental(t, x) {
  const broken = x.settings.error;
  return v_flex().w_full()
    .child(heading(t, "Experimental"))
    .child(div().pb(6).text_size(12.5).line_height("18px").text_color(t.dim)
      .child("Features that lean on things other programs don't promise to keep the same. Each is off until you turn it on, and says why it's experimental."))
    .when(Boolean(broken), (el) => el.child(div().my(8).p(10).rounded(8).bg(t.blocked + "1f").text_size(12.5).line_height("18px").text_color(t.blocked)
      .child(`${tilde(file())} isn't valid JSONC (${broken}). These stay off until it's fixed: Open the file.`)))
    .children(EXPERIMENTS.map((e) => {
      const on = experimentOn(x.settings, e.key);
      return row(t, `wsx-x-${e.key}`, e.title, e.what, `Why it's experimental: ${e.why.charAt(0).toLowerCase()}${e.why.slice(1)}`,
        toggle(t, `wsx-x-${e.key}-switch`, on, (_e, cx) => setExperiment(x, e.key, !on, cx), Boolean(broken) || x.busy));
    }));
}

function switches(t, x) {
  const runner = shared("workspaces.runner") ?? { on: false, running: false };
  const r = x.resume ?? { on: true, ready: true };
  const g = x.guide ?? { on: true };
  return v_flex().w_full()
    .child(heading(t, "Switches"))
    .child(row(t, "wsx-s-runner", "Keep running while Herdr is closed",
      "Automations and board cards' pull requests are followed by a background process herdr-core keeps going. Off, Herdr runs them itself while it's open.",
      runner.on && !runner.running ? "On, but not running yet." : "Also at the foot of Automations.",
      toggle(t, "wsx-s-runner-switch", runner.on, () => setShared("workspaces.runner.set", { on: !runner.on, at: Date.now() }))))
    .child(row(t, "wsx-s-resume", "Bring agents back after a restart",
      "Claude and Antigravity agents started through the launcher continue their conversation after a reboot or a logout.",
      r.ready ? "Also at the foot of Agent presets." : "Needs herdr-ws-resume's shell line in ~/.config/herdr-core/config.toml (see the recipe).",
      toggle(t, "wsx-s-resume-switch", r.on, (_e, cx) => flip(x, "herdr-ws-resume", [r.on ? "--off" : "--on"], cx))))
    .child(row(t, "wsx-s-guide", "Herdr guide for every agent",
      "Agents started through the launcher get ~/.herdr/AGENTS.md, how to use automations, helpers and the board, before the workspace's own instructions.",
      "Also at the foot of Agent presets, where you can edit it.",
      toggle(t, "wsx-s-guide-switch", g.on, (_e, cx) => flip(x, "herdr-ws-agent", ["--guide", g.on ? "off" : "on"], cx))));
}

// The page: the window's body shows it for the "extras" section.
export function extrasPage(view) {
  const t = theme();
  const x = view.wsx ?? (view.wsx = { text: null, settings: parseSettings(null), resume: null, guide: null, busy: false });
  return v_flex().w_full()
    .child(experimental(t, x))
    .child(div().h(22))
    .child(switches(t, x))
    .child(h_flex().pt(18).gap(12).items_center()
      .child(button(t, "wsx-open", "Open the file", (_e, cx) => openTheFile(x, cx)))
      .child(div().flex_1().min_w(0).text_size(12.5).line_height("18px").text_color(t.dim)
        .child(`The experiments are kept in ${tilde(file())}, each with what it does above it.`)));
}
