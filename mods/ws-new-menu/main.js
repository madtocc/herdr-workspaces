// ws-new-menu: Herdr's `new-menu` (0.1.14), opened by ws-tabs' +. Changes:
// - After the installed agents, an "Agent presets" list: the shown workspace's agent
//   presets (its own, then the ones for every workspace), from ws-switcher's
//   shared "workspaces.presets". Each opens ws-presets' Start dialog.
// - The number keys go on through the presets after the agents.
// - Presets are left out for a space on another machine: the launcher is local.
// - Under the agents and presets, "Resume a conversation…" shows the workspace's History
//   screen (ws-history), through ws-switcher's shared "workspaces.history", and "Notes" its
//   Notes screen (ws-notes; shared "workspaces.notes"), when a workspace is shown.
// - Up to 721 px tall instead of 491; ws-tabs lets it take 85% of the window.
// - Only installed agents, less the ones hidden from this menu (~/.herdr/agent-menu.json,
//   mirrored in shared "new-menu.hidden"; hidefacts.js). A right-click on an agent's
//   row offers "Hide from this menu"; "Choose agents…" at the foot of the list opens
//   ws-presets on its "Agents in the + menu" pane. Number keys follow what's shown.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared, home, readTextFile, writeTextFile, notify } from "herdr";
import { HIDDEN, hiddenFile, parseHidden, saveHidden, shownAgents, keyTarget } from "./hidefacts.js";

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
// The Agent presets screen (as ws-chrome opens it) on its "Agents in the + menu" pane.
const openChoose = (workspace) =>
  openOverlay({ mod: "ws-presets", kind: "dialog", width: 900, height: 640, props: { workspace, pane: "agents" } });

export default class NewMenu extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The hidden list: the last one known at once, so the first draw already leaves them
    // out; with none known yet, no agents until the file has been read.
    this.hiddenKnown = Array.isArray(shared(HIDDEN));
    this.menuFor = null; // the agent whose right-click menu is open
    cx.spawn(async cx => {
      const text = await readTextFile(hiddenFile(home())).catch(() => null);
      const hidden = parseHidden(text);
      if (JSON.stringify(hidden) !== JSON.stringify(shared(HIDDEN))) setShared(HIDDEN, hidden);
      this.hiddenKnown = true;
      cx.notify();
    });
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  // Hide from this menu: the row goes at once (shared "new-menu.hidden"), the file follows.
  // A file that can't be written puts the list back as the file has it.
  hide(agent, cx) {
    this.menuFor = null;
    setShared(HIDDEN, [...(shared(HIDDEN) ?? []).filter(k => k !== agent.key), agent.key]);
    cx.notify();
    cx.spawn(async cx => {
      try { setShared(HIDDEN, await saveHidden({ home, readTextFile, writeTextFile }, agent.key, true)); }
      catch (e) {
        notify({ title: `Couldn't hide ${agent.name}`, body: `${hiddenFile(home()).replace(home(), "~")}: ${e?.message ?? e}`, level: "error" });
        setShared(HIDDEN, parseHidden(await readTextFile(hiddenFile(home())).catch(() => null)));
      }
      cx.notify();
    });
  }
  // An agent's row, with its right-click menu (one item, drawn as ws-agents draws its menu).
  agentRow(a, hint) {
    const t = theme();
    const icon = a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14);
    const row = this.row(a.key, icon, a.name, () => run("tab.new", { name: a.name, space: spaces().find(s => s.active)?.id, argv: a.run }), hint)
      .when(this.menuFor === a.key, el => el.bg(t.selected))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menuFor = this.menuFor === a.key ? null : a.key; cx.notify(); });
    return Popup.new(`hide-${a.key}`, row).anchor("top_left")
      .when(this.menuFor === a.key, el => el.content(v_flex().id(`hide-menu-${a.key}`).w(200).p(5).ml(28).mt(-2).rounded(8).shadow_md().border_1().border_color(t.border).bg(t.popover).text_size(12.8)
        .on_mouse_down_out((_e, cx) => { this.menuFor = null; cx.notify(); })
        .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(a.name))
        .child(h_flex().id(`hide-go-${a.key}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.hide(a, cx))
          .child(svg("mods/ws-new-menu/eye-off.svg").size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child("Hide from this menu")))));
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
    // Not-installed agents can't start anything, so they aren't offered.
    const installed = this.hiddenKnown ? shownAgents(this.agents, shared(HIDDEN)) : [];
    const allHidden = this.hiddenKnown && installed.length === 0 && this.agents.some(a => a.installed);
    const ws = (shared("workspaces.defs") ?? []).find(d => d.id === shared("workspaces.active"));
    const presets = space?.machine ? [] : presetsFor(ws?.id);
    const startPreset = (p) => openStart(p.name, ws?.id ?? null);
    const iconOf = (p) => {
      const a = this.agents.find(k => k.key === programOf(p.command));
      if (!a?.icon) return svg("icons/shell.svg").size(14);
      return a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14);
    };
    const keyed = (i) => (i < 9 ? String(i + 1) : "");
    return v_flex().min_h(0).w_full().h(Math.min(721, 198 + (ws ? 31 : 0) + (Math.max(1, installed.length) + (installed.length ? 1 : 0)) * 31 + (presets.length ? 34 + presets.length * 31 : 0)))
      .bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.menuFor) { this.menuFor = null; cx.stop_propagation(); cx.notify(); return; }
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const target = keyTarget(/^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1, installed, presets);
        if (!target) return;
        closeOverlay(props().overlay);
        if (target.agent) run("tab.new", { name: target.agent.name, space: space?.id, argv: target.agent.run });
        else startPreset(target.preset);
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(installed.map((a, i) => this.agentRow(a, keyed(i))))
        .when(installed.length > 0, el => el.child(this.row("choose", svg("mods/workspace-chrome/settings.svg").size(14).flex_none().text_color(t.muted),
          div().text_color(t.muted).child("Choose agents\u2026"), () => openChoose(ws?.id ?? null), "", true, "Hide agents from this menu, or bring them back")))
        .when(allHidden, el => el.child(this.row("choose", svg("mods/workspace-chrome/settings.svg").size(14).flex_none().text_color(t.muted),
          div().text_color(t.dim).child("No agents shown. Choose agents\u2026"), () => openChoose(ws?.id ?? null))))
        .when(!allHidden && installed.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim)
          .child(this.failed ? "Could not load agents" : this.agents.length && this.hiddenKnown ? "No agents installed" : "Checking installed agents…")))
        .when(presets.length > 0, el => el
          .child(div().px(9).pt(10).pb(4).flex_none().text_size(11).text_color(t.dim).child("Agent presets"))
          .children(presets.map((p, i) => this.row(`preset-${p.name}`, iconOf(p), p.name, () => startPreset(p), keyed(installed.length + i), true,
            [p.description, p.scope === "workspace" ? `Only in ${ws?.name ?? "this workspace"}` : "Every workspace"].filter(Boolean).join("\n"))))))
      .child(this.row("history", svg("mods/ws-history/history.svg").size(14).text_color(t.foreground), "Resume a conversation…",
        () => setShared("workspaces.history", { id: ws?.id ?? null, at: Date.now() }), "", !space?.machine,
        "Past conversations of every agent, here or everywhere: pick one to continue it"))
      .when(Boolean(ws), el => el.child(this.row("notes", svg("mods/ws-notes/notes.svg").size(14).text_color(t.foreground), "Notes",
        () => setShared("workspaces.notes", { id: ws.id, at: Date.now() }), "", true,
        `${ws.name}'s notes: rough ideas to start a session from later`)))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
