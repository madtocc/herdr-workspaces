// ws-new-menu: Herdr's `new-menu` (0.1.14), opened by ws-tabs' +. Changes:
// - After the installed agents, an "Agent presets" list: the shown workspace's agent
//   presets (its own, then the ones for every workspace), from ws-switcher's
//   shared "workspaces.presets". Each opens ws-presets' Start dialog.
// - The number keys go on through the presets after the agents.
// - Presets are left out for a space on another machine: the launcher is local.
// - Up to 659 px tall instead of 491; ws-tabs lets it take 85% of the window.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

// The presets a workspace offers: its own, then the global ones it doesn't override.
function presetsFor(id) {
  const p = shared("workspaces.presets") ?? {};
  const own = (id && p.workspaces?.[id]) || [];
  return [...own, ...(p.global ?? []).filter((g) => !own.some((o) => o.name === g.name))].filter((x) => !x.error);
}

// The program a preset runs, past env settings and the launcher: its icon.
function programOf(command) {
  const w = String(command ?? "").trim().split(/\s+/).map((x) => x.replace(/^['"]|['"]$/g, ""))
    .filter((x) => x && x !== "env" && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x.split("/").pop() !== "herdr-ws-agent");
  return (w[0] ?? "").split("/").pop();
}

const openStart = (name, workspace) =>
  openOverlay({ mod: "ws-presets", kind: "dialog", width: 560, height: 430, props: { start: name, workspace } });

export default class NewMenu extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  row(id, icon, name, action, hint = "", enabled = true, tip = "") {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .when(Boolean(tip), el => el.tooltip(tip))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    const ws = (shared("workspaces.defs") ?? []).find(d => d.id === shared("workspaces.active"));
    const presets = space?.machine ? [] : presetsFor(ws?.id);
    const startPreset = (p) => openStart(p.name, ws?.id ?? null);
    const iconOf = (p) => {
      const a = this.agents.find(k => k.key === programOf(p.command));
      if (!a?.icon) return svg("icons/shell.svg").size(14);
      return a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14);
    };
    const keyed = (i) => (i < 9 ? String(i + 1) : "");
    return v_flex().min_h(0).w_full().h(Math.min(659, 167 + Math.max(1, choices.length) * 31 + (presets.length ? 34 + presets.length * 31 : 0)))
      .bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
        const agent = installed[n], preset = presets[n - installed.length];
        if (!agent && !preset) return;
        closeOverlay(props().overlay);
        if (agent) run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
        else startPreset(preset);
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? keyed(i) : "not installed", a.installed)))
        .when(this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…")))
        .when(presets.length > 0, el => el
          .child(div().px(9).pt(10).pb(4).flex_none().text_size(11).text_color(t.dim).child("Agent presets"))
          .children(presets.map((p, i) => this.row(`preset-${p.name}`, iconOf(p), p.name, () => startPreset(p), keyed(installed.length + i), true,
            [p.description, p.scope === "workspace" ? `Only in ${ws?.name ?? "this workspace"}` : "Every workspace"].filter(Boolean).join("\n"))))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
