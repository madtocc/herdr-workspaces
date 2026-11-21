// ws-status: Herdr's `workspace-status` (0.1.16) with the plans' usage on the right,
// before the commands hint: each plan's icon and its most used limit (usage()), and a
// click opens the panel with every limit and when it resets (panel(): this mod opened
// as an overlay), as Claude's own app does. PLANS lists the plans: Claude's from
// Claude Code's own /usage (else its newest status line, readStatusLines()) and
// Antigravity's from its own /usage, each asked every 10 minutes (readUsage()).
// Another agent's plan is a new entry there with a parser in usagefacts.js.
//
// Shared: workspaces.usage   { <plan>: { rows, at, from, tried } }: what the bar's copy
//                            read, for the panel (rows: usagefacts.js)
//         workspaces.usage.ask { at }: the panel's Refresh asks the bar's copy to read again

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, home, shared, setShared, props, openOverlay, checking } from "herdr";
import * as fs from "fs/promises";
import { claudeReportRows, agyReportRows, claudeStatusRows, topRow, resetsText, agoText } from "./usagefacts.js";

// The plans the bar shows, in its order: how to ask each agent for its usage without
// a model turn, and what its sources are called. Claude's runs with no hooks, no MCP
// servers and no session kept; Antigravity's with its log in /dev/null, so neither
// leaves anything behind.
const PLANS = [
  {
    key: "claude", name: "Claude", icon: "icons/claude.svg", bin: "claude",
    args: ["-p", "/usage", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config", "--settings", '{"disableAllHooks":true}'],
    parse: claudeReportRows,
    from: { usage: "Claude Code's /usage", status: "a Claude session's status line" },
  },
  {
    key: "agy", name: "Antigravity", icon: "icons/antigravity.svg", bin: "agy",
    args: ["-p", "/usage", "--output-format", "json", "--log-file", "/dev/null"],
    parse: agyReportRows,
    from: { usage: "Antigravity's /usage" },
  },
];
const USAGE_EVERY = 600000;
// Signed out, `agy -p` opens a Google sign-in page in the browser (through `open`), so every
// ask would open another tab. Each ask runs with a do-nothing `open` (and xdg-open, BROWSER)
// first on its PATH, and a plan whose agent says it isn't signed in is left alone this long
// (the panel's Refresh asks at once).
const SIGNED_OUT_WAIT = 6 * 3600e3;
const signedOut = (r) => /Authentication required|authentication failed|Please sign in/i.test(`${r?.stdout ?? ""}\n${r?.stderr ?? ""}`);
const NO_BROWSER = `d=$(mktemp -d) || exit 126
printf '#!/bin/sh\\nexit 1\\n' > "$d/open" && chmod +x "$d/open" && cp "$d/open" "$d/xdg-open"
b=$1; shift
PATH="$d:$PATH" BROWSER="$d/open" "$b" "$@" </dev/null
rc=$?; rm -rf "$d"; exit $rc`;
const run1 = (bin, args, opts) => exec("sh", ["-c", NO_BROWSER, "sh", bin, ...args], opts).catch(() => null);

// Runs an agent's program: on the app's PATH, else where your shell finds it (taking
// only the path from the shell's output, so whatever else it prints can't get in).
const bins = new Map();
async function ask(name, args) {
  const opts = { timeout: 60000, cwd: home() };
  const missing = (r) => !r || r.code === 127;
  const known = bins.get(name);
  if (known) {
    const r = await run1(known, args, opts);
    if (!missing(r)) return r;
    bins.delete(name);
  }
  const direct = await run1(name, args, opts);
  if (!missing(direct)) return direct;
  for (const flags of ["-lc", "-lic"]) {
    const found = await exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" "$1" "command -v $2"', "sh", flags, name], { timeout: 15000 }).catch(() => null);
    const bin = String(found?.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).pop();
    if (!bin) continue;
    const r = await run1(bin, args, opts);
    if (!missing(r)) { bins.set(name, bin); return r; }
  }
  return { code: 127, stdout: "", stderr: `${name} not found` };
}

// The status lines herdr-ws-statusline saves, one folder per herdr-core.
const STATUS_EVERY = 60000;
const statusDir = () => `${home()}/.herdr/agents`;

// A limit's color: plain, a warning past 70% (or when the plan says so), blocked past 85%.
const tone = (t, w) => (w.severity === "critical" || w.pct >= 85 ? t.blocked : w.severity === "warning" || w.pct >= 70 ? t.ansi3 : t.muted);
const loud = (w) => w.pct >= 70 || w.severity === "warning" || w.severity === "critical";
const meter = (t, w, width, height) => div().w(width).h(height).flex_none().rounded(height / 2).bg(t.border)
  .child(div().h(height).rounded(height / 2).bg(tone(t, w)).w(`${Math.max(2, Math.min(100, w.pct))}%`));
const pctText = (w) => `${Math.round(w.pct)}%`;
// This copy is the panel: opened as an overlay (the bar's click, or mod.open).
const isPanel = () => Boolean(props()?.panel || props()?.overlay);

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    if (isPanel() || checking()) return;
    this.data = { ...(shared("workspaces.usage") ?? {}) };
    this.asked = shared("workspaces.usage.ask")?.at ?? 0;
    this.away = {}; // plan -> when its agent last said it isn't signed in
    cx.spawn(async () => { await this.readStatusLines(); await this.readUsage(); });
    cx.timer.every(USAGE_EVERY, (cx) => cx.spawn(async () => this.readUsage()));
    cx.timer.every(STATUS_EVERY, (cx) => cx.spawn(async () => this.readStatusLines()));
    // The panel's Refresh.
    cx.timer.every(1000, (cx) => {
      const at = shared("workspaces.usage.ask")?.at ?? 0;
      if (at > this.asked) { this.asked = at; cx.spawn(async () => this.readUsage(true)); }
    });
  }

  publish(key, value) {
    if (JSON.stringify(value) === JSON.stringify(this.data[key] ?? null)) return;
    this.data[key] = value;
    setShared("workspaces.usage", { ...(shared("workspaces.usage") ?? {}), [key]: value });
  }

  // Every plan's rows from its agent's /usage, all at once. A failed ask keeps the last
  // rows; no such agent, or no plan (an API key), shows nothing for it.
  async readUsage(refresh = false) {
    if (this.usageBusy) return;
    this.usageBusy = true;
    try {
      await Promise.all(PLANS.map(async (p) => {
        if (!refresh && Date.now() - (this.away[p.key] ?? 0) < SIGNED_OUT_WAIT) return;
        const r = await ask(p.bin, p.args);
        if (signedOut(r)) this.away[p.key] = Date.now();
        else delete this.away[p.key];
        const rows = r.code === 0 ? p.parse(r.stdout) : null;
        const now = Date.now();
        if (rows?.length) this.publish(p.key, { rows, at: now, from: "usage", tried: now });
        else if (this.data[p.key]) this.publish(p.key, { ...this.data[p.key], tried: now });
      }));
    } finally {
      this.usageBusy = false;
    }
  }

  // Until Claude's /usage has answered (or when it can't): the 5-hour window and the
  // week from the newest Claude status line.
  async readStatusLines() {
    if (this.data.claude?.from === "usage") return;
    const saved = [];
    for (const core of await fs.readdir(statusDir()).catch(() => [])) {
      const dir = `${statusDir()}/${core}`;
      for (const name of await fs.readdir(dir).catch(() => [])) {
        if (!name.endsWith(".json") || name.startsWith(".")) continue;
        try { saved.push(JSON.parse(await fs.readFile(`${dir}/${name}`, "utf8"))); } catch { /* being written */ }
      }
    }
    const got = claudeStatusRows(saved);
    if (got && this.data.claude?.from !== "usage") this.publish("claude", { rows: got.rows, at: got.at, from: "status", tried: this.data.claude?.tried ?? 0 });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // The plans that have rows, with them.
  plans() {
    const u = shared("workspaces.usage") ?? {};
    return PLANS.filter((p) => u[p.key]?.rows?.length).map((p) => ({ ...p, data: u[p.key] }));
  }

  // In the bar: each plan's icon and its most used limit's percent; hover lists every
  // limit, a click opens the panel.
  usage(t, plans) {
    const detail = plans.map((p) => `${p.name}: ${p.data.rows.map((w) => `${w.short} ${pctText(w)}`).join(", ")}`).join("\n");
    return h_flex().id("usage").h(20).px(6).gap(10).items_center().rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(detail)
      .on_click(() => openOverlay({ mod: "ws-status", kind: "popup", width: 360, props: { panel: true } }))
      .children(plans.map((p) => {
        const top = topRow(p.data.rows);
        return h_flex().gap(5).items_center()
          .child(image(p.icon).w(12).h(12).flex_none())
          .child(div().text_color(loud(top) ? tone(t, top) : t.muted).child(pctText(top)));
      }));
  }

  // The panel: per plan, each limit with when it resets and a meter, and where the
  // numbers came from; Refresh at the top asks every plan again.
  panel() {
    const t = theme();
    const plans = this.plans();
    const asked = shared("workspaces.usage.ask")?.at ?? 0;
    const reading = plans.some((p) => asked > (p.data.tried ?? 0)) && Date.now() - asked < 90000;
    return v_flex().w_full().px(14).py(12).gap(12).text_size(12).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_color(t.muted).child("Plan usage limits"))
        .when(plans.length > 0, (el) => el.child(div().id("usage-refresh").text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click(() => setShared("workspaces.usage.ask", { at: Date.now() }))
          .child(reading ? "Reading…" : "Refresh"))))
      .when(!plans.length, (el) => el.child(div().text_color(t.dim).child("No plan usage yet")))
      .children(plans.map((p, i) => v_flex().gap(10)
        .when(i > 0, (el) => el.pt(12).border_t(1).border_color(t.border))
        .child(h_flex().items_center().gap(8)
          .child(image(p.icon).w(13).h(13).flex_none())
          .child(div().child(p.name)))
        .children(p.data.rows.map((w, j) => v_flex().id(`usage-${p.key}-${j}`).gap(6)
          .when(Boolean(w.note), (el) => el.tooltip(w.note))
          .child(h_flex().items_center().gap(10)
            .child(div().flex_1().min_w(0).truncate().child(w.label))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(resetsText(w.resets)))
            .child(div().w(34).flex_none().text_right().text_color(loud(w) ? tone(t, w) : t.muted).child(pctText(w))))
          .child(meter(t, w, "100%", 4))))
        .child(div().text_size(10.5).text_color(t.dim).child(`From ${p.from[p.data.from] ?? p.data.from}, ${agoText(p.data.at)}`))));
  }

  render() {
    if (isPanel()) return this.panel();
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const plans = this.plans();
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(plans.length > 0, el => el.child(this.usage(t, plans)))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
