// History: the conversations your agents saved on this computer, newest first, and
// a way back into each. Every agent keeps its own conversations (Claude Code, Codex,
// Pi, Grok, OpenCode); this lists them together, for the workspace shown or for
// everywhere, and Resume continues one in a new tab in the folder it ran in.
//
// It's the workspace's own screen: the layout holds one copy (props { screen: true })
// that follows the workspace shown in the switcher, and the sidebar's History row, the
// + menu's "Resume a conversation…" and the command `ws-switcher.history` show it in
// place of the tabs, from any space. With no workspace chosen (All spaces) it opens
// as a dialog (props { dialog: true }) over everything; in a tab or pane of its own
// (props { workspace }) it keeps to that workspace.
//
// What it reads: scan.js (Node) reads each agent's own store and prints the list;
// nothing is copied or changed there. What it runs: that script, and on Resume the
// agent's own command with its resume words (histfacts.js: PROVIDERS), started as
// the + menu starts it (Herdr's programs table, so Claude and Codex go through the
// launcher and get the workspace's instructions again). A Claude conversation the
// launcher noted is resumed with the command it was started with, so a preset's
// conversation comes back with the preset's model, permissions and instructions.
//
// A conversation that's open in a terminal now says so and offers Go to instead:
// resuming it would put two agents on one conversation.
//
// A Claude, Pi or Antigravity conversation that was compacted shows the compacted icon
// and how often on its row; opened, it lists when (newest first), how, and how big the
// context was before and after, and what's in the context at the end.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, terminals, run, theme, shared, setShared, props, closeOverlay,
  home, appHome, exec, notify, checking, knownAgents,
} from "herdr";
import { PROVIDERS, inWorkspace, whereOf, liveOf, keyOf, titleOf, matches, dayLabel, ago, span, modelLabel, resumeArgv, presetOf, tokens, compactionText, compactionsTip } from "./histfacts.js";

const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const KNOWN = "new-menu.agents"; // the agents ws-new-menu last found installed: their icons and run commands
// Shared "workspaces.history.resumed": conversation -> the terminal History resumed it in,
// so it shows as open there (and isn't resumed twice) whichever agent it is.
const RESUMED = "workspaces.history.resumed";
const PAGE = 120; // rows drawn at first, and more with each "Show more"
const SPANS = [90, 365, 3650]; // days back: the first read, then each "Look further back"
const STALE = 20e3; // ms after which the screen, shown again, reads again
const FRESH = 45e3; // ms between reads while it stays shown

const defs = () => shared("workspaces.defs") ?? [];
const defOf = (id) => defs().find((d) => d.id === id) ?? null;
const trees = () => `${home()}/.herdr/worktrees`;
const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const base = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();
const message = (e) => String(e?.message ?? e);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The folders a workspace's conversations ran in: its root and folders (and where
// symlinks lead), and the Herdr worktrees of its repos.
function placesOf(def) {
  const real = def.real ?? {};
  const own = [def.root, ...(def.folders ?? [])].filter(Boolean);
  const repos = [...new Set([...(def.children ?? []), ...(def.folders ?? []).map(base)])].filter(Boolean);
  return [...new Set([...own, ...own.map((p) => real[p]).filter(Boolean), ...repos.map((r) => `${trees()}/${r}`)])];
}

// Runs the reader with Node: from the app's own PATH, else through your shell, as
// agents start (its PATH is where a version manager puts node).
let nodeBin = null; // where Node was found last, so the search runs once
async function node(args) {
  const opts = { timeout: 90000 };
  const missing = (r) => !r || r.code === 127;
  if (nodeBin) {
    const r = await exec(nodeBin, args, opts).catch(() => null);
    if (!missing(r)) return r;
    nodeBin = null;
  }
  const direct = await exec("node", args, opts).catch(() => null);
  if (!missing(direct)) return direct;
  // Not on the app's PATH (an app started from the Dock gets a bare one): where the
  // person's own shell finds it, a login shell first, then an interactive one (nvm's
  // installer sets it up in .zshrc). Only the path is taken from the shell's output,
  // so whatever else an interactive shell prints can't get into what's read.
  for (const flags of ["-lc", "-lic"]) {
    const found = await exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" "$1" "command -v node"', "sh", flags], { timeout: 15000 }).catch(() => null);
    const bin = String(found?.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).pop();
    if (!bin) continue;
    const r = await exec(bin, args, opts).catch(() => null);
    if (!missing(r)) { nodeBin = bin; return r; }
  }
  return { code: 127, stdout: "", stderr: "node not found" };
}

// Where a space is now: its first terminal's live folder, else where it was made.
function placeOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}

// Which of the listed agents a terminal runs, by Herdr's name for its program or by
// what the agent itself reports ("claude-code"). Null for a shell or anything else.
function agentOf(key, app) {
  for (const p of Object.values(PROVIDERS)) {
    if (key === p.program || app === p.program || String(app ?? "").split("-")[0] === p.program) return p.program;
  }
  return null;
}

// The live terminals on this computer that run one of the listed agents.
function liveTerms() {
  const out = new Map();
  for (const p of panes()) {
    if (!p.terminal || p.terminal.includes("/")) continue;
    const program = agentOf(p.program?.key, p.app);
    if (program) out.set(p.terminal, { address: p.terminal, program, cwd: p.cwd, status: p.status ?? null, pane: p.pane });
  }
  // A helper agent has no pane of its own.
  for (const x of terminals()) {
    const address = String(x.address ?? "");
    if (!address || address.includes("/") || out.has(address) || (x.state && x.state !== "live")) continue;
    const program = agentOf(x.program?.key, x.app ?? x.agent);
    if (program) out.set(address, { address, program, cwd: x.cwd, status: x.status ?? null, pane: null });
  }
  return [...out.values()];
}

function mark(def, t, size) {
  const all = defs();
  const c = def.color ?? PALETTE[Math.max(0, all.findIndex((d) => d.id === def.id)) % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
  return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(Math.round(size * 0.55)).font_bold().text_color("#ffffff").child([...def.name][0]?.toUpperCase() ?? "?");
}

export default class History extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.dialog = Boolean(props()?.dialog);
    // The layout's screen follows the shown workspace; a tab or a dialog keeps what it was opened with.
    this.follow = Boolean(props()?.screen);
    this.workspace = (this.follow ? null : props()?.workspace) ?? shared("workspaces.active") ?? null;
    this.scope = this.workspace ? "ws" : "all";
    this.provider = null; // one agent's conversations, or null for every agent's
    this.gone = false; // also show the ones whose folder is gone
    this.span = 0; // index into SPANS
    this.max = PAGE;
    this.open = null; // the row whose details show
    this.starting = null; // the row being resumed, until Herdr says which terminal it made
    this.rows = [];
    this.notes = [];
    this.error = null;
    this.loaded = false;
    this.reading = false;
    this.readAt = 0;
    this.turn = 0;
    this.showing = !this.follow;
    this.agents = shared(KNOWN)?.[""] ?? [];
    this.query = InputState.new({ value: "", placeholder: "Search conversations" });
    this.query.on("change", (_e, cx) => { this.max = PAGE; cx.notify(); });
    // Enter on a search goes to its first result.
    this.query.on("submit", (_e, cx) => { if (this.query.value().trim()) { const first = this.view().shown[0]; if (first) this.act(first.s, first.at, cx); } });
    if (checking()) return;
    if (!this.follow) { this.load(cx); this.query.focus(); }
    // Looked at on a timer, not in render: a task started while rendering never gets to run.
    cx.timer.every(this.follow ? 400 : 2000, (cx) => {
      const scr = this.follow ? shared("workspaces.screen") ?? null : null;
      const showing = !this.follow || scr?.screen === "history";
      const back = showing && !this.showing;
      this.showing = showing;
      if (!showing) return; // the hidden screen reads nothing
      const ws = this.follow ? shared("workspaces.active") ?? null : this.workspace;
      if (ws !== this.workspace) {
        // Another workspace is shown: its conversations from here. A read under way is dropped (turn).
        this.workspace = ws;
        this.scope = ws ? "ws" : "all";
        this.rows = []; this.loaded = false; this.open = null; this.max = PAGE; this.span = 0; this.provider = null;
        this.load(cx);
        cx.notify();
      } else if (!this.reading && Date.now() - this.readAt > (back ? STALE : FRESH)) this.load(cx);
      // In place of the terminals, it takes the keyboard from them: typing searches, and
      // mustn't land in a terminal nobody sees.
      if (back) this.query.focus();
    });
  }

  // Reads the list again, in a task of its own. Call it from a click, a timer or
  // init, never from render.
  load(cx) {
    cx.spawn(async (cx) => this.read(cx));
  }

  async read(cx) {
    const turn = ++this.turn;
    this.reading = true;
    cx.notify();
    const def = this.scope === "ws" ? defOf(this.workspace) : null;
    const args = [`${appHome()}/mods/ws-history/scan.js`, "--days", String(SPANS[this.span])];
    if (def) for (const dir of placesOf(def)) args.push("--in", dir);
    // How each agent is started can change (programs.json): asked again with every read.
    const [r, known] = await Promise.all([node(args), knownAgents().catch(() => null)]);
    if (known) this.agents = known;
    if (turn !== this.turn) return;
    let data = null;
    if (r.code === 0) { try { data = JSON.parse(r.stdout); } catch { data = null; } }
    if (data?.sessions) {
      this.rows = data.sessions; this.notes = data.notes ?? []; this.error = null;
      if (this.provider && !this.rows.some((s) => s.provider === this.provider)) this.provider = null;
    } else {
      this.error = r.code === 127 ? "History needs Node (20.6 or newer) on your PATH to read the conversations."
        : `Couldn't read the conversations: ${String(r.stderr ?? "").trim().split("\n").pop() || "the reader gave no reason."}`;
    }
    this.loaded = true;
    this.reading = false;
    this.readAt = Date.now();
    cx.notify();
  }

  // What the list shows now: the rows under the filters, and what each is open in.
  view() {
    const terms = liveTerms();
    const live = liveOf(this.rows, terms, shared(RESUMED) ?? {});
    const q = this.query.value();
    const inScope = this.rows;
    const here = inScope.filter((s) => this.gone || !s.gone || live.has(keyOf(s)));
    const searched = here.filter((s) => matches(s, q, presetOf(s)));
    const shown = searched.filter((s) => !this.provider || s.provider === this.provider).map((s) => ({ s, at: live.get(keyOf(s)) ?? null }));
    return { live, here, searched, shown, hidden: inScope.length - here.length, status: new Map(terms.map((x) => [x.address, x.status])) };
  }

  // The agent as Herdr knows it: its icon, its name and how it's started.
  agent(provider) {
    const p = PROVIDERS[provider];
    return this.agents.find((a) => a.key === p?.program) ?? null;
  }

  icon(provider, t, size = 15) {
    const a = this.agent(provider);
    const path = a?.icon ?? `icons/${PROVIDERS[provider]?.program ?? "agent"}.svg`;
    return (a ? a.tint : provider !== "claude" && provider !== "codex") ? svg(path).size(size).flex_none().text_color(t.muted) : image(path).size(size).flex_none();
  }

  // The workspace a folder belongs to: the screen's own first, then any other.
  owner(cwd) {
    const mine = defOf(this.workspace);
    if (mine && inWorkspace(cwd, mine, trees())) return mine;
    return defs().find((d) => inWorkspace(cwd, d, trees())) ?? null;
  }

  // Back to the terminals: the screen gives way, the dialog closes.
  leave() {
    if (this.dialog) return closeOverlay(props().overlay);
    if (shared("workspaces.screen")) setShared("workspaces.screen", null);
  }

  // A row's own action: to the terminal it's open in, else resume it.
  act(s, at, cx) {
    if (at) return this.goTo(at);
    if (!s.gone) this.resume(s, cx);
  }

  goTo(address) {
    this.leave();
    if (panes().some((p) => p.terminal === address)) run("pane.focus", { terminal: address });
    else run("terminal.peek", { terminal: address });
  }

  // Continues a conversation in a new tab, in the folder it ran in: in the space
  // that sits in that folder, else in a new space there. Started through `herdr-app
  // do`, which says which terminal it made, so the row can say it's open there.
  resume(s, cx) {
    const a = this.agent(s.provider);
    const argv = resumeArgv(s, a?.run);
    if (!argv || this.starting) return;
    const name = presetOf(s) || a?.name || PROVIDERS[s.provider].name;
    const def = this.owner(s.cwd);
    const assigned = shared("workspaces.assigned") ?? {};
    const ps = panes();
    const same = (at) => Boolean(at) && (at === s.cwd || def?.real?.[at] === s.cwd || def?.real?.[s.cwd] === at);
    const space = spaces().find((x) => !x.machine && (def ? assigned[x.id] === def.id : !assigned[x.id]) && (same(placeOf(x, ps)) || same(x.folder)));
    const [command, args] = space ? ["tab.new", { space: space.id, name, folder: s.cwd, argv }] : ["space.new", { folder: s.cwd, tab: name, argv }];
    this.starting = keyOf(s);
    cx.notify();
    // The dialog closes only after: its tasks end when it does.
    cx.spawn(async (cx) => {
      try {
        const r = await exec("herdr-app", ["do", command, JSON.stringify(args)], { timeout: 20000 });
        const made = JSON.parse(r.stdout || "{}");
        if (made.error || !made.terminal) throw new Error(made.error || String(r.stderr ?? "").trim() || "Herdr didn't say what it made");
        // Remembered while that terminal lives; the ones that ended are dropped here.
        const live = new Set(liveTerms().map((x) => x.address));
        const kept = Object.fromEntries(Object.entries(shared(RESUMED) ?? {}).filter(([, address]) => live.has(address)));
        setShared(RESUMED, { ...kept, [keyOf(s)]: made.terminal });
        this.leave();
      } catch (e) {
        notify({ title: "Couldn't resume that conversation", body: message(e), level: "error" });
      }
      this.starting = null;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const def = defOf(this.workspace);
    const shell = v_flex().id("history").size_full().min_h(0).bg(this.dialog ? t.popover : t.canvas).text_size(13).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .when(this.follow, (el) => el.track_focus(this.handle));
    // In a pane beside the terminals there's less room: the rows keep what matters.
    const tight = this.width > 0 && this.width < 720;
    // Between two workspaces (the timer is a moment behind): nothing of the last one.
    if (this.follow && (shared("workspaces.active") ?? null) !== this.workspace) return shell;
    const everywhere = this.scope === "all";
    const { here, searched, shown, hidden, status } = this.view();
    const now = Date.now();

    const button = (id, text, action, { tip = null, solid = false } = {}) => div().id(id).h(26).px(10).flex().flex_none().items_center().rounded(7)
      .text_size(12).cursor_pointer()
      .when(solid, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_medium().hover((s) => s.opacity(0.88)))
      .when(!solid, (el) => el.border_1().border_color(t.input).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => action(cx)).child(text);
    const chip = (id, on, action, kids, tip = null) => h_flex().id(id).h(26).px(10).gap(6).flex_none().items_center().rounded(13).border_1().cursor_pointer().text_size(12)
      .border_color(on ? t.accent : t.input).text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected))
      .hover((s) => s.text_color(t.foreground)).when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => { action(cx); this.max = PAGE; cx.notify(); }).children(kids);
    const count = (n) => div().text_color(t.dim).child(String(n));

    const back = SPANS[this.span];
    const since = back >= 3650 ? "" : back === 365 ? " in the last year" : ` in the last ${back} days`;
    const header = h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(def && !everywhere ? mark(def, t, 20) : svg("mods/ws-history/history.svg").size(16).flex_none().text_color(t.muted))
      .child(div().font_semibold().child(def && !everywhere ? `${def.name} history` : "History"))
      .when(!tight || !this.loaded, (el) => el.child(div().text_size(12).text_color(t.dim).child(this.loaded ? `${plural(here.length, "conversation")}${since}` : "Reading…")))
      .when(this.reading && this.loaded, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.dim).spin(900)))
      .child(div().flex_1())
      .when(Boolean(def), (el) => el
        .child(chip("scope-ws", !everywhere, (cx) => this.rescope("ws", cx), [def.name], `What ran in ${def.name}'s folders and worktrees`))
        .child(chip("scope-all", everywhere, (cx) => this.rescope("all", cx), ["Everywhere"], "Every conversation on this computer, whatever folder it ran in")))
      .child(button("hist-refresh", "Refresh", (cx) => this.load(cx), { tip: "Read the conversations again" }));

    const providers = Object.keys(PROVIDERS).filter((k) => searched.some((s) => s.provider === k));
    // The chips scroll sideways when there isn't room; the search box stays in view.
    const filters = h_flex().h(44).flex_none().px(16).gap(10).items_center()
      .child(h_flex().id("hist-chips").flex_1().min_w(0).h_full().gap(6).items_center().overflow_x_scrollbar()
        .child(chip("p-all", !this.provider, () => { this.provider = null; }, ["All", count(searched.length)]))
        .children(providers.map((k) => chip(`p-${k}`, this.provider === k, () => { this.provider = this.provider === k ? null : k; },
          [this.icon(k, t, 13), this.agent(k)?.name ?? PROVIDERS[k].name, count(searched.filter((s) => s.provider === k).length)])))
        .when(hidden > 0 || this.gone, (el) => el.child(chip("gone", this.gone, () => { this.gone = !this.gone; },
          [this.gone ? "Hide folder gone" : "Folder gone", ...(this.gone ? [] : [count(hidden)])],
          "Conversations whose folder isn't there any more (a removed worktree, a deleted scratch folder). They can be read about here but not resumed."))))
      .child(h_flex().w(tight ? 150 : 240).h(28).px(9).gap(7).flex_none().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
        .child(Input.new(this.query).flex_1().min_w(0).text_size(12).text_color(t.foreground)));

    const kids = [];
    let day = null;
    for (const { s, at } of shown.slice(0, this.max)) {
      const label = dayLabel(s.updated, now);
      if (label !== day) { day = label; kids.push(div().h(30).mt(4).px(8).flex().flex_none().items_end().pb(5).text_size(11.5).text_color(t.dim).child(label)); }
      kids.push(this.row(s, at, at ? status.get(at) : null, t, now, everywhere ? null : def, tight));
      if (this.open === keyOf(s)) kids.push(this.details(s, at, t));
    }
    if (shown.length > this.max) {
      kids.push(h_flex().h(40).flex_none().items_center().justify_center()
        .child(button("more", `Show ${Math.min(PAGE, shown.length - this.max)} more`, (cx) => { this.max += PAGE; cx.notify(); })));
    }
    if (this.error) kids.push(div().p(16).text_color(t.blocked).child(this.error));
    else if (this.loaded && !shown.length) {
      kids.push(div().p(16).text_color(t.dim).child(this.query.value().trim() || this.provider ? "None like that."
        : everywhere || !def ? `No conversations${since}.` : `No conversations in ${def.name}${since}.`));
    }
    // The end of what was read: older ones are one more read away.
    if (this.loaded && !this.error && this.span < SPANS.length - 1 && shown.length <= this.max) {
      kids.push(h_flex().h(40).flex_none().items_center().justify_center()
        .child(button("older", "Look further back", (cx) => { this.span++; this.load(cx); }, { tip: this.span === 0 ? "The last year" : "Everything that's kept" })));
    }
    const body = v_flex().id("hist-list").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(16).children(kids);
    return shell.child(header).child(filters).child(body)
      .when(this.notes.length > 0, (el) => el.child(div().min_h(28).flex_none().px(16).py(6).border_t(1).border_color(t.border).text_size(11.5).text_color(t.dim)
        .child(this.notes.join(" "))));
  }

  // The other scope: read for it, since the reader does the choosing.
  rescope(scope, cx) {
    if (this.scope === scope) return;
    this.scope = scope;
    this.rows = []; this.loaded = false; this.open = null; this.provider = null;
    this.load(cx); // a read under way for the old scope is dropped (turn)
  }

  // `at`: the terminal it's open in now, if any, and `status`, that agent's.
  row(s, at, status, t, now, def, tight) {
    const key = keyOf(s);
    const preset = presetOf(s);
    const sub = [whereOf(s.cwd, def, home(), trees()), s.branch, s.last ? `last: ${s.last}` : s.title ? s.first : ""].filter(Boolean).join("  ·  ");
    const tag = (text, c, tip) => div().flex_none().h(20).px(6).flex().items_center().rounded(5).bg(t.raised).text_size(11.5).text_color(c)
      .when(Boolean(tip), (el) => el.tooltip(tip)).child(text);
    const act = (id, text, action, tip, solid) => div().id(id).h(24).px(9).flex().flex_none().items_center().rounded(6)
      .text_size(11.5).cursor_pointer().tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(solid, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_medium().hover((x) => x.opacity(0.88)))
      .when(!solid, (el) => el.border_1().border_color(t.input).text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);
    return h_flex().id(`h-${key}`).h(46).px(8).gap(10).items_center().flex_none().rounded(7).cursor_pointer()
      .hover((x) => x.bg(t.hover)).when(this.open === key, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.open = this.open === key ? null : key; cx.notify(); })
      .child(this.icon(s.provider, t, 16))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_color(s.gone && !at ? t.muted : t.foreground).child(titleOf(s)))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(sub)))
      .when(Boolean(preset) && !tight, (el) => el.child(tag(preset, t.muted, "Started from this agent preset; Resume starts it the same way")))
      .when(s.via === "app" && !tight, (el) => el.child(tag("app", t.muted, "Started in the agent's desktop app or an editor, not in a terminal. Resume continues it here.")))
      .when(Boolean(at), (el) => el.child(h_flex().flex_none().h(20).px(6).gap(5).items_center().rounded(5).bg(t.raised).text_size(11.5).text_color(t.accent)
        .tooltip(`Open in ${at} now`)
        .child(div().size(6).rounded_full().bg(status ? (t[status] ?? t.idle) : t.idle)).child("open")))
      .when(Boolean(s.gone && !at), (el) => el.child(tag("folder gone", t.dim, `${tilde(s.cwd)} isn't there any more, so it can't be resumed there`)))
      .when(Boolean(s.model) && !tight, (el) => el.child(div().flex_none().max_w(150).truncate().text_size(11.5).text_color(t.dim).child(modelLabel(s.model))))
      .when(s.compactions > 0 && !tight, (el) => el.child(h_flex().id(`hc-${key}`).flex_none().gap(3).items_center().text_size(11.5).text_color(t.dim)
        .tooltip(compactionsTip(s.compactions, s.compacted?.[s.compacted.length - 1]))
        .child(svg("mods/ws-history/compacted.svg").size(11).text_color(t.dim)).child(String(s.compactions))))
      .child(div().w(30).flex_none().text_size(11.5).text_color(t.dim).child(ago(s.updated, now)))
      .child(h_flex().w(62).flex_none().justify_end()
        .when(Boolean(at), (el) => el.child(act(`go-${key}`, "Go to", () => this.goTo(at), "Show the terminal it's open in")))
        .when(!at && !s.gone && this.starting === key, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Starting…")))
        .when(!at && !s.gone && this.starting !== key, (el) => el.child(act(`re-${key}`, "Resume", (cx) => this.resume(s, cx), "Continue it in a new tab, in the folder it ran in", true))));
  }

  // Under an opened row: what was asked first and last, where and when, and the
  // command Resume runs.
  details(s, at, t) {
    const a = this.agent(s.provider);
    const argv = resumeArgv(s, a?.run) ?? [];
    const quote = (w) => (/^[A-Za-z0-9_\/.:=@%+-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);
    const line = (label, text) => h_flex().gap(10).items_start()
      .child(div().w(84).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_color(t.muted).child(text));
    return v_flex().ml(34).mr(8).mb(8).p(12).gap(7).rounded(8).border_1().border_color(t.border).bg(t.surface).text_size(12)
      .when(Boolean(s.first), (el) => el.child(line("First asked", s.first)))
      .when(Boolean(s.last), (el) => el.child(line("Last asked", s.last)))
      .child(line("Folder", `${tilde(s.cwd)}${s.branch ? `  (${s.branch})` : ""}${s.gone ? "  ·  gone" : ""}`))
      .child(line("When", span(s.started, s.updated)))
      .when(s.context != null, (el) => el.child(line("Context", `${tokens(s.context)} tokens at the end`)))
      .when(s.compactions > 0, (el) => el.child(h_flex().gap(10).items_start()
        .child(div().w(84).flex_none().text_color(t.dim).child("Compacted"))
        .child(v_flex().flex_1().min_w(0).gap(3).text_color(t.muted)
          .children([...(s.compacted ?? [])].reverse().slice(0, 5).map((c) => div().child(compactionText(c))))
          .when(s.compactions > Math.min(5, s.compacted?.length ?? 0), (el) => el.child(div().text_color(t.dim)
            .child(`${s.compactions === 1 ? "Once" : `${s.compactions} times`} in all`))))))
      .when(Boolean(at), (el) => el.child(line("Open in", at)))
      .when(!s.gone && !at, (el) => el.child(line("Resume runs", argv.map((w) => (quote(w) === w ? tilde(w) : quote(w))).join(" "))));
  }
}
