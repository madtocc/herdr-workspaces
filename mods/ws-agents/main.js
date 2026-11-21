// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
//
// ws-agents: Herdr's `agents` (0.1.14) showing only the agents in the workspace
// chosen in `ws-switcher` (an agent is in its space's workspace, shared
// "workspaces.assigned"). agent.next / agent.prev follow the same list. The
// changes are inWorkspace(), the filter in render(), the empty text,
// open(): a click on a sub-agent keeps it as a tab instead of peeking at it, and
// a click on an agent goes back to the tabs from one of the workspace's screens (showTabs()).
// Also: a second line on an agent's row with its model, how full its context is and
// how often it was compacted, the rest on hover (readStats(), statLine(): stats.js
// reads them from the agent's own records). The plans' usage is in the status bar
// (ws-status).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, hc, appHome, checking } from "herdr";
import { tokens } from "./statfacts.js";

// The workspace ws-switcher shows, null for every space.
const workspace = () => (shared("workspaces.defs") ?? []).find((d) => d.id === shared("workspaces.active")) ?? null;
// An agent is in it when its space is (or its space is the shown one, still being placed).
function inWorkspace(a, ws) {
  if (!ws) return true;
  const assigned = shared("workspaces.assigned") ?? {};
  return assigned[a.space] === ws.id || (!(a.space in assigned) && spaces().some((s) => s.id === a.space && s.active));
}

// A click here means "show me this": one of the workspace's screens (its board, its
// worktrees: ws-switcher's shared "workspaces.screen") gives way to the tabs.
const showTabs = () => { if (shared("workspaces.screen")) setShared("workspaces.screen", null); };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// --- Each agent's numbers (stats.js) ---
// The agents whose records stats.js reads: by what they report (OSC 7501 app), else
// by their program (programs.json's key).
const KINDS = { "claude-code": "claude", claude: "claude", pi: "pi", agy: "agy", antigravity: "agy" };
const kindOf = (a) => KINDS[a.app] ?? KINDS[a.program?.key] ?? null;
// Read again this often while one of them works, and this often anyway.
const STATS_WORKING = 5000;
const STATS_IDLE = 60000;

// Node, as History finds it: the app's PATH, else where the person's shell finds it.
let nodeBin = null;
async function node(args) {
  const opts = { timeout: 30000 };
  const missing = (r) => !r || r.code === 127;
  if (nodeBin) {
    const r = await exec(nodeBin, args, opts).catch(() => null);
    if (!missing(r)) return r;
    nodeBin = null;
  }
  const direct = await exec("node", args, opts).catch(() => null);
  if (!missing(direct)) return direct;
  // Only the path is taken from the shell's output, so whatever else an interactive
  // shell prints can't get into what's read.
  for (const flags of ["-lc", "-lic"]) {
    const found = await exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" "$1" "command -v node"', "sh", flags], { timeout: 15000 }).catch(() => null);
    const bin = String(found?.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).pop();
    if (!bin) continue;
    const r = await exec(bin, args, opts).catch(() => null);
    if (!missing(r)) { nodeBin = bin; return r; }
  }
  return { code: 127, stdout: "", stderr: "node not found" };
}

// The context meter's color: plain, then a warning past 70%, then the blocked color past 85%.
const fullness = (t, pct) => (pct >= 85 ? t.blocked : pct >= 70 ? t.ansi3 : t.muted);

// A small bar, filled to pct.
const meter = (t, pct, w) => div().w(w).h(4).flex_none().rounded(2).bg(t.border)
  .child(div().h(4).rounded(2).bg(fullness(t, pct)).w(Math.max(2, Math.round((w * Math.min(pct, 100)) / 100))));

// What the hover says about an agent's numbers, a fact a line.
function statDetail(s) {
  const out = [];
  const via = s.provider ? ` via ${s.provider}` : "";
  if (s.name || s.model) out.push(`${s.name ?? s.model}${s.effort ? `, ${s.effort} ${s.app === "pi" ? "thinking" : "effort"}` : ""}${s.model && s.name && s.name !== s.model ? ` (${s.model}${via})` : via}`);
  if (s.used != null) out.push(`Context: ${tokens(s.used)}${s.size ? ` of ${tokens(s.size)} tokens (${s.pct}%)` : " tokens"}`);
  if (s.compactions > 0) {
    const c = s.compacted;
    const how = c?.trigger === "manual" ? "by /compact" : c?.trigger === "auto" ? "automatically" : "";
    const size = c?.pre ? (c.post ? `${tokens(c.pre)} → ${tokens(c.post)}` : `from ${tokens(c.pre)}`) : "";
    const what = [how, size].filter(Boolean).join(", ");
    out.push(`Compacted ${s.compactions === 1 ? "once" : `${s.compactions} times`}${what ? `, last ${what}` : ""}`);
  } else if (s.used != null) out.push("Not compacted yet");
  const spent = [];
  if (s.cost != null) spent.push(`$${s.cost < 10 ? s.cost.toFixed(2) : Math.round(s.cost)}`);
  if (s.lines && (s.lines.added || s.lines.removed)) spent.push(`+${s.lines.added} −${s.lines.removed} lines`);
  if (spent.length) out.push(`This session: ${spent.join(", ")}`);
  return out.join("\n");
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    // Each agent's numbers, by address, and the terminals' programs (pid) they're read for.
    this.stats = {};
    this.statsRaw = "";
    this.statsAt = 0;
    this.statsFor = "";
    this.pids = new Map();
    if (checking()) return;
    cx.spawn(async (cx) => this.readStats(cx));
    cx.timer.every(STATS_WORKING, (cx) => {
      if (this.statsBusy) return;
      const list = this.statAgents();
      const key = list.map((a) => a.address).join(" ");
      const wait = list.some((a) => a.status === "working") ? STATS_WORKING : STATS_IDLE;
      if (key !== this.statsFor || Date.now() - this.statsAt >= wait - 500) cx.spawn(async (cx) => this.readStats(cx));
    });
  }

  // This computer's agents stats.js can read (another machine's records are there).
  statAgents() {
    return agents().filter((a) => !a.address.includes("/") && kindOf(a));
  }

  // Reads every agent's numbers (stats.js).
  // Redraws only when something changed.
  async readStats(cx) {
    if (this.statsBusy) return;
    this.statsBusy = true;
    try {
      const list = this.statAgents();
      this.statsFor = list.map((a) => a.address).join(" ");
      const args = [`${appHome()}/mods/ws-agents/stats.js`];
      for (const a of list) {
        const kind = kindOf(a);
        // Which program runs there (to tell this Claude or Pi from one before it): asked
        // again every minute. Antigravity goes by the launcher's note instead.
        let p = this.pids.get(a.address);
        if (kind !== "agy" && (!p || Date.now() - p.at > 60000)) {
          const r = await hc(["get", a.address, "--json"]).catch(() => null);
          let pid = null;
          try { pid = JSON.parse(r?.stdout ?? "")?.foreground?.pid ?? null; } catch { pid = null; }
          p = { pid, at: Date.now() };
          this.pids.set(a.address, p);
        }
        args.push("--t", `${a.address}=${kind}${p?.pid ? `:${p.pid}` : ""}`);
      }
      for (const k of this.pids.keys()) if (!list.some((a) => a.address === k)) this.pids.delete(k);
      const r = await node(args);
      if (r.code !== 0 || r.stdout === this.statsRaw) return;
      let data = null;
      try { data = JSON.parse(r.stdout); } catch { return; }
      this.statsRaw = r.stdout;
      this.stats = data.agents ?? {};
      cx.notify();
    } finally {
      this.statsBusy = false;
      this.statsAt = Date.now();
    }
  }

  // An agent row's second line: its model, a meter of its context and how often it
  // was compacted; the rest (effort, tokens, cost) on hover.
  statLine(t, a, s) {
    const pct = s.pct;
    return h_flex()
      .id(`stat-${a.address}`)
      .min_w(0)
      .gap(5)
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .tooltip(statDetail(s))
      .when(Boolean(s.name), (el) => el.child(div().min_w(0).truncate().child(s.name)))
      .when(pct != null, (el) => el
        .child(meter(t, pct, 26))
        .child(div().flex_none().text_color(pct >= 70 ? fullness(t, pct) : t.dim).child(`${pct}%`)))
      .when(pct == null && s.used != null, (el) => el.child(div().flex_none().child(tokens(s.used))))
      .when(s.compactions > 0, (el) => el.child(h_flex().flex_none().gap(2).items_center()
        .child(svg("mods/ws-agents/compacted.svg").size(10))
        .child(String(s.compactions))));
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // A click on a sub-agent: to its pane, or without one it gets a tab in its
  // parent's space (no peek first). Cmd-click (Ctrl elsewhere) peeks instead.
  open(k, root, e) {
    showTabs();
    if (this.listed.has(k.address)) return run("pane.focus", { terminal: k.address });
    if (e?.modifiers?.platform || e?.modifiers?.control) return this.peek(k.address);
    // A second click while the tab is being made would only toast "in progress".
    const now = Date.now();
    if (now - (this.keeping?.get(k.address) ?? 0) < 1500) return;
    (this.keeping ??= new Map()).set(k.address, now);
    // terminal.keep puts the tab in the shown space: show the parent's first.
    if (root && !spaces().some((s) => s.id === root.space && s.active)) run("pane.focus", { terminal: root.address });
    run("terminal.keep", { terminal: k.address });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact, root) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click((e) => this.open(k, root, e))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const ws = workspace();
    const everywhere = list.length;
    list = list.filter((a) => inWorkspace(a, ws));
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority, a))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => { showTabs(); run("pane.focus", { pane: a.pane }); })
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const stat = this.stats[a.address];
      const nameLine = h_flex().min_w(0).gap(5).items_center()
        .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
        .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${more}`)));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(stat ? 42 : 30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => { showTabs(); run("pane.focus", { pane: a.pane }); })
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(stat
          ? v_flex().flex_1().min_w(0).gap(2).child(nameLine).child(this.statLine(t, a, stat))
          : nameLine.flex_1())
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "ws-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child(ws && everywhere
          ? `No agents in ${ws.name}. Agents in other workspaces show in theirs.`
          : "No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
