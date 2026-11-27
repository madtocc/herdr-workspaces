// ws-status: Herdr's `workspace-status` (0.1.16) with the plans' usage on the right,
// before the commands hint: each plan's icon and its most used limit (usage()), and a
// click opens the panel with every limit and when it resets (panel(): this mod opened
// as an overlay), as Claude's own app does. PLANS lists the plans: Claude's from
// Claude Code's own /usage (else its newest status line, readStatusLines()) and
// Antigravity's from its own /usage, each asked every 10 minutes (readUsage()).
// Another agent's plan is a new entry there with a parser in usagefacts.js.
// While Plan usage is off in Settings > Features nothing is asked or read (no /usage, no
// status lines, the panel's Refresh ignored) and the bar shows no usage: the bar's copy
// reads ~/.herdr/settings.jsonc itself before its first ask (settingsfacts.js), then
// follows shared "workspaces.settings" (followUsage()); turned on again, it asks at once.
// What was read stays in workspaces.usage.
// Also (UX fixes, 2026-11-26): "1 agent" and "2 need you", as Herdr 0.1.17's workspace-status
// says them; numbers the last ask couldn't refresh dim in the bar and say their age
// (staleOf() in usagefacts.js).
// Also (small round, 2026-11-27): no space (so no branch) while the workspace has none
// (shared "workspaces.covered"); the agent count's hover says it counts every workspace and
// where the ones waiting on you are (countTip()); the usage's tooltip goes once it's clicked.
// Antigravity's limits come in pools (Gemini models; Claude and GPT models): the bar shows
// its own models' pool, the 5-hour limit unless one of that pool's is full (barRow()), the panel
// draws each pool once, its 5-hour and weekly limits side by side (poolBlock()), and the
// hover gives each pool its own line. A full limit shows when it's back, in the bar too
// ("100% · 4:17 PM", barText()).
//
// Shared: workspaces.usage   { <plan>: { rows, at, from, tried } }: what the bar's copy
//                            read, for the panel (rows: usagefacts.js)
//         workspaces.usage.ask { at }: the panel's Refresh asks the bar's copy to read again
// Numbers the last ask couldn't refresh (staleOf(): tried more than a minute after at; away:
// its agent said it isn't signed in) say how old they are: dimmed in the bar, their age on
// hover and in the panel's last line.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, home, shared, setShared, props, openOverlay, checking } from "herdr";
import { exec } from "./posix.js";
import * as fs from "fs/promises";
import { claudeReportRows, agyReportRows, claudeStatusRows, barRow, blocksOf, barText, hoverLines, resetsText, agoText, staleOf, followFeature } from "./usagefacts.js";
import { SETTINGS_FILE, parseSettings, featureOn } from "./settingsfacts.js";

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
// Plan usage's switch in shared "workspaces.settings" (undefined while nothing is there).
const usageShared = () => shared("workspaces.settings")?.features?.usage;

// The agent count's hover: "7 agents across every workspace", then where the ones waiting on you are.
function countTip(list) {
  const waiting = [...new Set(list.filter((a) => a.status === "blocked").map((a) => a.space_name || "a terminal with no space"))];
  return `${list.length} ${list.length === 1 ? "agent" : "agents"} across every workspace${waiting.length ? `\nNeeds you: ${waiting.join(", ")}` : ""}`;
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    if (isPanel() || checking()) return;
    this.data = { ...(shared("workspaces.usage") ?? {}) };
    this.asked = shared("workspaces.usage.ask")?.at ?? 0;
    this.away = {}; // plan -> when its agent last said it isn't signed in
    // Plan usage on or off (null until the settings file is read), and the shared switch last seen.
    this.usageOn = null;
    this.heard = undefined;
    cx.spawn(async (cx) => {
      const text = await fs.readFile(`${home()}/${SETTINGS_FILE}`, "utf8").catch(() => null);
      this.heard = usageShared();
      this.usageOn = featureOn(parseSettings(text), "usage");
      cx.notify();
      await this.readStatusLines();
      await this.readUsage();
    });
    cx.timer.every(USAGE_EVERY, (cx) => cx.spawn(async () => this.readUsage()));
    cx.timer.every(STATUS_EVERY, (cx) => cx.spawn(async () => this.readStatusLines()));
    // The panel's Refresh.
    cx.timer.every(1000, (cx) => {
      this.followUsage(cx);
      const at = shared("workspaces.usage.ask")?.at ?? 0;
      if (at > this.asked) { this.asked = at; cx.spawn(async () => this.readUsage(true)); }
    });
  }

  // Plan usage turned on or off since (shared "workspaces.settings"): on again, it asks at once.
  followUsage(cx) {
    if (this.usageOn === null) return;
    const now = usageShared();
    const next = followFeature(this.usageOn, this.heard, now);
    this.heard = now;
    if (next === this.usageOn) return;
    this.usageOn = next;
    cx.notify();
    if (next) cx.spawn(async () => { await this.readStatusLines(); await this.readUsage(); });
  }

  publish(key, value) {
    if (JSON.stringify(value) === JSON.stringify(this.data[key] ?? null)) return;
    this.data[key] = value;
    setShared("workspaces.usage", { ...(shared("workspaces.usage") ?? {}), [key]: value });
  }

  // Every plan's rows from its agent's /usage, all at once. A failed ask keeps the last
  // rows; no such agent, or no plan (an API key), shows nothing for it.
  async readUsage(refresh = false) {
    if (this.usageBusy || this.usageOn !== true) return;
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
        else if (this.data[p.key]) this.publish(p.key, { ...this.data[p.key], tried: now, away: signedOut(r) });
      }));
    } finally {
      this.usageBusy = false;
    }
  }

  // Until Claude's /usage has answered (or when it can't): the 5-hour window and the
  // week from the newest Claude status line.
  async readStatusLines() {
    if (this.usageOn !== true || this.data.claude?.from === "usage") return;
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

  // In the bar: each plan's icon and the percent of the limit that matters (barRow(): its
  // most used; Antigravity's Gemini 5-hour), and when it's back once it's full; hover lists every limit, a pool a line, a click opens the panel.
  usage(t, plans) {
    const detail = plans.flatMap((p) => {
      const old = staleOf(p.data);
      return [...hoverLines(p.name, p.data.rows), ...(old ? [`${p.name}: from ${old.ago}, ${old.why}`] : [])];
    }).join("\n");
    return h_flex().id("usage").h(20).px(6).gap(10).items_center().rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      // Its tooltip goes once it's clicked, so it doesn't sit over the panel, until the pointer leaves.
      .when(!this.tipOff, (el) => el.tooltip(detail))
      .on_hover((over, cx) => { if (!over && this.tipOff) { this.tipOff = false; cx.notify(); } })
      .on_click((_e, cx) => { this.tipOff = true; openOverlay({ mod: "ws-status", kind: "popup", width: 360, props: { panel: true } }); cx.notify(); })
      .children(plans.map((p) => {
        const top = barRow(p.data.rows);
        const old = staleOf(p.data);
        return h_flex().gap(5).items_center()
          .child(image(p.icon).w(12).h(12).flex_none().when(Boolean(old), (el) => el.opacity(0.5)))
          .child(div().text_color(old ? t.dim : loud(top) ? tone(t, top) : t.muted).child(barText(top)));
      }));
  }

  // The panel: per plan, each limit with when it resets and a meter, and where the
  // numbers came from; Refresh at the top asks every plan again.
  panel() {
    const t = theme();
    // Turned off while it's open: nothing to show or ask.
    if (!featureOn(shared("workspaces.settings"), "usage")) {
      return v_flex().w_full().px(14).py(12).text_size(12).text_color(t.dim).child("Plan usage is off in Settings > Features.");
    }
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
        .children(blocksOf(p.data.rows).map((b, j) => b.group
          ? this.poolBlock(t, b, `usage-${p.key}-${j}`)
          : this.limitRow(t, b.rows[0], `usage-${p.key}-${j}`)))
        .child(div().text_size(10.5).text_color(t.dim).child(`From ${p.from[p.data.from] ?? p.data.from}, ${agoText(p.data.at)}${staleOf(p.data) ? ` · ${staleOf(p.data).why}` : ""}`))));
  }

  // A limit on its own line: its name, when it resets and the percent, over a meter.
  limitRow(t, w, id) {
    return v_flex().id(id).gap(6)
      .when(Boolean(w.note), (el) => el.tooltip(w.note))
      .child(h_flex().items_center().gap(10)
        .child(div().flex_1().min_w(0).truncate().child(w.label))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(resetsText(w.resets)))
        .child(div().w(34).flex_none().text_right().text_color(loud(w) ? tone(t, w) : t.muted).child(pctText(w))))
      .child(meter(t, w, "100%", 4));
  }

  // One pool of a plan (Antigravity's Gemini models): its name, hovered for its models,
  // then its limits two to a line, each its window and percent over a meter and when it
  // resets. A full one has its percent, meter and reset in the blocked color.
  poolBlock(t, b, id) {
    const cell = (w) => v_flex().flex_1().min_w(0).gap(4)
      .child(h_flex().items_center().gap(6)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(w.span ?? w.short))
        .child(div().flex_none().text_color(loud(w) ? tone(t, w) : t.muted).child(pctText(w))))
      .child(meter(t, w, "100%", 4))
      .child(div().truncate().text_size(10.5).text_color(w.pct >= 100 ? tone(t, w) : t.dim).child(resetsText(w.resets)));
    const pairs = [];
    for (let i = 0; i < b.rows.length; i += 2) pairs.push(b.rows.slice(i, i + 2));
    return v_flex().gap(6)
      .child(div().id(id).child(b.group).when(Boolean(b.note), (el) => el.tooltip(b.note)))
      .children(pairs.map((pair) => h_flex().gap(14).items_start()
        .children(pair.map(cell))
        .when(pair.length === 1, (el) => el.child(div().flex_1()))));
  }

  render() {
    if (isPanel()) return this.panel();
    const t = theme();
    // A workspace with no space yet: Herdr's active space is another workspace's, so none (ws-tabs' here()).
    const space = shared("workspaces.covered") ? null : spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const plans = followFeature(this.usageOn, this.heard, usageShared()) ? this.plans() : [];
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      // Every workspace's agents, where the Agents list beside it shows one workspace's: the hover says so.
      .child(h_flex().id("agent-count").gap(6).items_center().tooltip(countTip(list)).child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} ${needs === 1 ? "needs" : "need"} you`))))
      .child(div().flex_1())
      .when(plans.length > 0, el => el.child(this.usage(t, plans)))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
