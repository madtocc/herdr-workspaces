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
// (ws-status). While Agent numbers is off in Settings > Features (settingsfacts.js, shared
// "workspaces.settings": numbersOn()) a row has its name and status only, at its one-line
// height, and nothing reads the records on a timer; the right-click menu still needs its
// conversation (Fork, Copy session id, Wipe), so a right-click reads that one agent's
// records first (menuAt()). Turned on again, the numbers come at the next read.
// Also: History's own right-click Wipe hands an Antigravity conversation that's open in no
// terminal to the Wipe dialog here (props wipe with no address: nothing to close first).
// Also: a right-click on an agent's row (a sub-agent's too, and on the rail) opens its
// menu: Peek, Send a message, Interrupt, Compact, Fork session, Rename, Pin, Copy
// terminal id, Copy session id, Close session, Wipe session (menufacts.js says which a
// row gets), with the Send a message and Wipe dialogs (agentMenu(), act(), sendDialog(),
// wipeDialog()). Antigravity's Wipe is experimental, offered while "antigravity-wipe" is
// on in ~/.herdr/settings.jsonc (settingsfacts.js, read by readSettings() into shared
// "workspaces.settings"), and only for a row whose conversation note is provably its running
// process's (stats.js: fresh); agywipe.js checks it before the agent is closed, then
// wipes the conversation's tree (out of Antigravity's lists, checked, then its files to
// the Trash), and agyPending() finishes a wipe left for when no Antigravity runs.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, hc, appHome, home, notify, checking, readTextFile } from "herdr";
import { tokens } from "./statfacts.js";
import { kindOf as menuKind, menuItems, menuHeight, closeAsks, forkArgv, wipeTargets, agyDir } from "./menufacts.js";
import { SETTINGS_FILE, parseSettings, experimentOn, featureOn } from "./settingsfacts.js";

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
// Whether Agent numbers is on in Settings > Features (nothing known yet counts as on).
const numbersOn = () => featureOn(shared("workspaces.settings"), "numbers");

// Node, as History finds it: the app's PATH, else where the person's shell finds it
// (found with `node --version`, so a script itself never runs twice to find it).
let nodeBin = null;
async function findNode() {
  if (nodeBin) return nodeBin;
  const works = async (bin) => (await exec(bin, ["--version"], { timeout: 15000 }).catch(() => null))?.code === 0;
  if (await works("node")) return (nodeBin = "node");
  // Only the path is taken from the shell's output, so whatever else an interactive
  // shell prints can't get into what's read.
  for (const flags of ["-lc", "-lic"]) {
    const found = await exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" "$1" "command -v node"', "sh", flags], { timeout: 15000 }).catch(() => null);
    const bin = String(found?.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).pop();
    if (bin && await works(bin)) return (nodeBin = bin);
  }
  return null;
}
// Runs a Node script. One that couldn't start (or got 127) is tried once more with Node
// looked for again, unless `once`: a run that changes things is never started a second
// time, and one that timed out or was stopped says so (code -1).
async function node(args, { timeout = 30000, once = false } = {}) {
  for (let i = 0; ; i++) {
    const bin = await findNode();
    if (!bin) return { code: 127, stdout: "", stderr: "node not found" };
    const r = await exec(bin, args, { timeout }).catch((e) => ({ code: -1, stdout: "", stderr: `didn't finish: ${e?.message ?? e}` }));
    if ((r.code !== -1 && r.code !== 127) || once || i > 0) return r;
    nodeBin = null;
  }
}

// agywipe.js with its JSON reply as `out` (null when it printed none).
async function agywipe(args, timeout) {
  const r = await node([`${appHome()}/mods/ws-agents/agywipe.js`, ...args], { timeout, once: args[0] !== "check" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { out = null; }
  return { ...r, out };
}

// A time as "21 Nov, 09:15" (this year) or "21 Nov 2025".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayTime(ms) {
  const d = new Date(ms);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (d.getFullYear() !== new Date().getFullYear()) return `${day} ${d.getFullYear()}`;
  return `${day}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

// --- The right-click menu (menufacts.js) ---
const tilde = (p) => {
  const h = home();
  return p && h && (p === h || p.startsWith(`${h}/`)) ? `~${p.slice(h.length)}` : p ?? "";
};

// Moves each path given after $1 that's there to the Trash, or into $1 where there's
// no Trash command (as ws-switcher moves a scratch folder). Prints where each went.
const TRASH = `
dest=$1; shift
for p in "$@"; do
  [ -e "$p" ] || continue
  if command -v trash >/dev/null 2>&1 && trash "$p"; then echo Trash; continue; fi
  if command -v gio >/dev/null 2>&1 && gio trash "$p"; then echo Trash; continue; fi
  mkdir -p "$dest" && mv "$p" "$dest/$(basename "$p")-$(date +%s)" && echo "$dest" || exit 1
done`;

// Puts $1 on the clipboard.
const COPY = `
if command -v pbcopy >/dev/null 2>&1; then printf %s "$1" | pbcopy
elif command -v wl-copy >/dev/null 2>&1; then printf %s "$1" | wl-copy
elif command -v xclip >/dev/null 2>&1; then printf %s "$1" | xclip -selection clipboard
else echo "no clipboard command (pbcopy, wl-copy, xclip)" >&2; exit 1; fi`;

// What hc (or a shell step) said went wrong, in its words.
function failure(r) {
  const out = String(r?.stdout ?? "").trim();
  const err = String(r?.stderr ?? "").trim();
  try {
    const j = JSON.parse(out || err);
    return String(j?.error?.message ?? j?.error ?? out);
  } catch {
    return err || out || "it didn't say why";
  }
}

// Where a wipe's files went, in words (agywipe.js moves them into its backup folder).
const filesWhere = (n, backup) => (n ? `its files are in ${tilde(backup)}/files (move that folder to the Trash once you're sure)` : "it had no files left to move");
// What changed in Antigravity's lists, in words, from agywipe.js' `changed`.
const changedWords = (changed) => (changed?.length ? `Antigravity's lists were partly changed (${changed.join(", ")})` : "Antigravity's lists weren't changed");

// Toasts for what an `agywipe.js pending` run did.
function pendingToasts(out) {
  for (const c of out.cleaned ?? []) {
    notify({ title: "Antigravity wipe finished", level: "success", body: `“${c.title}” is out of Antigravity's lists, and ${filesWhere(c.moved, c.backup)}.` });
  }
  for (const g of out.gaveUp ?? []) {
    notify({ title: "An Antigravity wipe gave up", level: "error", timeout: 0,
      body: `“${g.title}”: ${g.error}. ${changedWords(g.changed)}; its files weren't moved.${g.backup ? ` A copy and what it removed are in ${tilde(g.backup)} (agywipe.js restore puts them back).` : ""}` });
  }
}

export default class Agents extends View {
  init(_props, cx) {
    const p = props();
    if (p?.sortMenu) return;
    if (p?.agentMenu || p?.send || p?.wipe) return this.initOverlay(p, cx);
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
    // The package's settings (an edit in the file shows within a minute; Settings sets them
    // at once), and an Antigravity wipe left to finish. The numbers wait for the settings:
    // while they're off, nothing is read for them.
    cx.spawn(async (cx) => {
      await this.readSettings();
      if (numbersOn()) await this.readStats(cx);
    });
    cx.timer.every(60000, (cx) => {
      cx.spawn(async () => this.readSettings());
      cx.spawn(async () => this.agyPending());
    });
    cx.timer.every(STATS_WORKING, (cx) => {
      if (this.statsBusy || !numbersOn()) return;
      const list = this.statAgents();
      const key = list.map((a) => a.address).join(" ");
      const wait = list.some((a) => a.status === "working") ? STATS_WORKING : STATS_IDLE;
      if (key !== this.statsFor || Date.now() - this.statsAt >= wait - 500) cx.spawn(async (cx) => this.readStats(cx));
    });
  }

  // ~/.herdr/settings.jsonc into shared "workspaces.settings", when it differs from what's there.
  async readSettings() {
    const text = await readTextFile(`${home()}/${SETTINGS_FILE}`).catch(() => null);
    const next = parseSettings(text);
    if (JSON.stringify(next) !== JSON.stringify(shared("workspaces.settings") ?? null)) setShared("workspaces.settings", next);
  }

  // An Antigravity wipe left for when none runs (or one that failed, retried): agywipe.js
  // does it once none runs and looks once more a minute later. A toast says when one
  // finished, and when it gave up (after a few failed tries, or a week); a failure of the
  // run itself shows once, not every minute.
  async agyPending() {
    if (this.agyBusy) return;
    const pending = await readTextFile(`${home()}/.herdr/cache/agy-wiped.json`).catch(() => null);
    if (!pending || !pending.includes('"ids"')) return;
    this.agyBusy = true;
    try {
      const r = await agywipe(["pending", home()], 120000);
      if (r.code !== 0 || !r.out) {
        const why = String(r.stderr ?? "").trim().split("\n").pop() || `agywipe.js ended with ${r.code}`;
        if (why !== this.agyError) notify({ title: "An Antigravity wipe couldn't go on", body: `${why}. It tries again each minute.`, level: "error" });
        this.agyError = why;
        return;
      }
      this.agyError = null;
      pendingToasts(r.out);
    } finally { this.agyBusy = false; }
  }

  // This computer's agents stats.js can read (another machine's records are there).
  statAgents() {
    return agents().filter((a) => !a.address.includes("/") && kindOf(a));
  }

  // Reads every agent's numbers (stats.js), or only `only`'s (a list of agents: the
  // right-click's read, which waits for a read already going instead of being skipped).
  // Redraws only when something changed.
  async readStats(cx, only = null) {
    if (this.statsBusy) {
      if (!only) return;
      await this.statsDone;
      return this.readStats(cx, only);
    }
    this.statsBusy = true;
    let done;
    this.statsDone = new Promise((resolve) => { done = resolve; });
    try {
      const list = only ?? this.statAgents();
      this.statsFor = list.map((a) => a.address).join(" ");
      const args = [`${appHome()}/mods/ws-agents/stats.js`];
      for (const a of list) {
        const kind = kindOf(a);
        // Which program runs there (to tell this Claude or Pi from one before it, and
        // whether an Antigravity's note is its own): asked again every minute.
        let p = this.pids.get(a.address);
        if (!p || Date.now() - p.at > 60000) {
          const r = await hc(["get", a.address, "--json"]).catch(() => null);
          let pid = null;
          try { pid = JSON.parse(r?.stdout ?? "")?.foreground?.pid ?? null; } catch { pid = null; }
          p = { pid, at: Date.now() };
          this.pids.set(a.address, p);
        }
        args.push("--t", `${a.address}=${kind}${p?.pid ? `:${p.pid}` : ""}`);
      }
      // Agents gone are forgotten (not on a one-agent read: the others are still there).
      if (!only) for (const k of this.pids.keys()) if (!list.some((a) => a.address === k)) this.pids.delete(k);
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
      done();
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

  // The menu and its dialogs take the keyboard; Send a message starts in its box.
  initOverlay(p, cx) {
    this.at = 0;
    this.busy = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Antigravity's Wipe: which conversation it is and what stands in the way, before anything.
    if (p.wipe?.kind === "agy") this.agyLookUp(p.wipe, cx);
    if (!p.send) return;
    this.sendIn = InputState.new({ value: "", placeholder: `What to tell ${p.send.name}` });
    this.sendIn.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.sendIn.on("submit", (_e, cx) => this.doSend(cx));
    this.sendIn.focus();
    cx.timer.after(600, () => this.sendIn.focus());
  }

  // What the menu needs to know about a row's agent (menufacts.js). The popup is a copy
  // of its own without the list's numbers, so they go with it.
  // a: an agents() entry, else a sub-agent's terminal; status: as the row shows it;
  // top: a row of its own (it can be pinned).
  menuFacts(a, name, status, top) {
    const s = this.stats?.[a.address] ?? {};
    const pane = a.pane ? panes().find((p) => p.pane === a.pane) : null;
    const tab = a.tab ? spaces().flatMap((sp) => sp.tabs).find((x) => x.id === a.tab) : null;
    return {
      address: a.address, name: name || a.address, pane: pane ? a.pane : null, tab: tab ? a.tab : null, space: a.space ?? null,
      tabName: tab?.named ? tab.name : null, program: a.program?.name ?? null,
      status, kind: menuKind(a.app ?? a.agent, a.program?.key), pinned: Boolean(a.pinned), top, focused: Boolean(a.focused),
      remote: a.address.includes("/"),
      session: s.session ?? null, file: s.file ?? null, cwd: s.cwd ?? pane?.cwd ?? a.cwd ?? null, cmd: s.cmd ?? null,
      agyWipe: experimentOn(shared("workspaces.settings"), "antigravity-wipe"), agyFresh: s.fresh === true, pid: this.pids?.get(a.address)?.pid ?? null,
    };
  }

  // A right-click's menu. While the numbers are off nothing keeps this.stats current,
  // so that agent's records are read first (its conversation, for Fork, Copy session id, Wipe).
  menuAt(cx, a, name, status, top) {
    const one = numbersOn() ? [] : this.statAgents().filter((x) => x.address === a.address);
    if (!one.length) return this.openMenu(this.menuFacts(a, name, status, top));
    cx.spawn(async (cx) => {
      await this.readStats(cx, one);
      this.openMenu(this.menuFacts(a, name, status, top));
    });
  }

  openMenu(f) {
    openOverlay({ mod: "ws-agents", kind: "popup", width: 220, height: menuHeight(menuItems(f)), props: { agentMenu: f } });
  }

  // A menu item. Quick ones run here and the popup closes after (its tasks end when it
  // does); Send a message and Wipe open their own dialogs, Close asks first while it works.
  act(it, cx) {
    const p = props();
    const f = p.agentMenu;
    const done = () => closeOverlay(p.overlay);
    if (!it || this.busy) return;
    switch (it.id) {
      case "peek":
        done();
        return run("terminal.peek", { terminal: f.address });
      case "send":
        done();
        return openOverlay({ mod: "ws-agents", kind: "dialog", width: 460, height: 216, props: { send: f } });
      case "interrupt":
        return this.quick(cx, () => hc(["keys", f.address, "esc"]), "Couldn't interrupt it");
      case "compact":
        return this.quick(cx, () => hc(["send", f.address, "/compact"]), "Couldn't compact it");
      case "fork": {
        done();
        const argv = forkArgv(f);
        if (!argv) return;
        showTabs();
        return run("tab.new", { ...(f.space ? { space: f.space } : {}), name: `${f.tabName || f.program || "Agent"} fork`, ...(f.cwd ? { folder: f.cwd } : {}), argv });
      }
      case "rename":
        done();
        return run("tab.rename", { id: f.tab });
      case "pin":
        done();
        return run("terminal.pin", { terminal: f.address, pinned: !f.pinned });
      case "address":
        return this.quick(cx, () => exec("sh", ["-c", COPY, "sh", f.address]), "Couldn't copy the terminal id",
          () => notify({ title: "Terminal id copied", body: `${f.address}: hc read ${f.address}, hc send ${f.address} "…"`, level: "success", timeout: 2500 }));
      case "copy":
        return this.quick(cx, () => exec("sh", ["-c", COPY, "sh", f.session]), "Couldn't copy the session id",
          () => notify({ title: "Session id copied", body: f.session, level: "success", timeout: 2500 }));
      case "close": {
        done();
        const command = f.pane ? { name: "pane.close", args: { pane: f.pane } } : { name: "terminal.kill", args: { terminal: f.address } };
        if (!closeAsks(f)) return run(command.name, command.args);
        return openOverlay({ mod: "confirm", kind: "dialog", width: 420, height: 176, props: {
          title: `Close ${f.name}?`,
          detail: f.status === "working"
            ? "It's working: closing it stops what it's doing. Its conversation stays in History."
            : "It's waiting on you. Closing it ends it there; its conversation stays in History.",
          command } });
      }
      case "wipe":
        done();
        return openOverlay({ mod: "ws-agents", kind: "dialog", width: 480, height: f.kind === "agy" ? 410 : 226, props: { wipe: f } });
    }
  }

  // Runs one quick step (hc, a shell line), then closes the popup; a toast says when it failed.
  quick(cx, step, failed, after) {
    const overlay = props().overlay;
    this.busy = true;
    cx.spawn(async () => {
      const r = await step().catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      if (r?.code !== 0) notify({ title: failed, body: failure(r), level: "error" });
      else after?.();
      closeOverlay(overlay);
    });
  }

  agentMenu(t) {
    const f = props().agentMenu;
    const items = menuItems(f);
    return v_flex()
      .id("agent-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % items.length;
        else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
        else if (e.key === "enter") return this.act(items[this.at], cx);
        else if (e.key === "escape") return closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(f.name))
      .children(items.map((it, i) => v_flex()
        .when(Boolean(it.sep), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex()
          .id(`am-${it.id}`)
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .text_color(it.danger ? t.blocked : t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => this.act(it, cx))
          .child(svg(it.icon).size(14).flex_none().text_color(it.danger ? t.blocked : t.muted))
          .child(div().flex_1().min_w(0).truncate().child(it.label))
          .when(Boolean(it.hint), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint))))));
  }

  // The dialogs' frame, title, buttons and error line, as the switcher's dialogs look.
  dialogFrame(t, id, title, enter) {
    return v_flex().id(id).track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && enter) enter(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")));
  }

  button(t, id, label, kind, action) {
    const bg = kind === "danger" ? t.blocked : kind === "primary" ? t.solid : t.raised;
    const fg = kind === "danger" ? "#ffffff" : kind === "primary" ? t.solid_foreground : t.foreground;
    return h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(kind ? bg : t.input).bg(bg)
      .text_color(fg).text_size(12.5).font_medium().cursor_pointer()
      .when(this.busy && Boolean(kind), (el) => el.opacity(0.5)).hover((s) => s.opacity(0.88)).on_click(action).child(label);
  }

  // Send a message: typed into the agent's prompt and sent, without going to it.
  sendDialog(t) {
    const f = props().send;
    return this.dialogFrame(t, "agent-send", `Message ${f.name}`, null)
      .child(div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child("Message"))
      .child(Input.new(this.sendIn).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(10).text_size(11.5).text_color(t.dim).child(this.busy
        ? "Sending… (if you left a draft in its prompt, it waits until that's sent or cleared)"
        : "Typed into its prompt and sent, as if you'd typed it there."))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().pt(14).gap(8).justify_end()
        .child(this.button(t, "agent-send-cancel", "Cancel", null, () => closeOverlay(props().overlay)))
        .child(this.button(t, "agent-send-go", this.busy ? "Sending…" : "Send", "primary", (_e, cx) => this.doSend(cx))));
  }

  doSend(cx) {
    const p = props();
    const text = this.sendIn.value().trim();
    if (this.busy) return;
    if (!text) { this.error = "Type what to tell it first."; cx.notify(); return; }
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["send", p.send.address, text]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      if (r.code === 0) return closeOverlay(p.overlay);
      this.busy = false;
      this.error = `Couldn't send it: ${failure(r)}`;
      cx.notify();
    });
  }

  // Wipe: closes the agent and moves its conversation to the Trash (menufacts.js:
  // wipeTargets()), so History and its agent's own resume no longer find it. Antigravity's
  // shows which conversation it is (agywipe.js check), asks twice when the wipe takes more
  // than the note's own conversation, and goes through agywipe.js.
  wipeDialog(t) {
    const f = props().wipe;
    const targets = wipeTargets(f);
    const working = f.status === "working" ? "; it's working, so this also stops what it's doing" : "";
    if (f.kind !== "agy") {
      return this.dialogFrame(t, "agent-wipe", `Wipe ${f.name}?`, (cx) => this.doWipe(cx))
        .child(div().pt(12).text_color(t.muted).child(`Closes it and moves its conversation to the Trash. History won't list it and it can't be resumed${working}.`))
        .child(div().pt(10).text_size(11.5).text_color(t.dim).truncate().child(tilde(targets[0])))
        .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
        .child(div().flex_1())
        .child(h_flex().pt(14).gap(8).justify_end()
          .child(this.button(t, "agent-wipe-cancel", "Cancel", null, () => closeOverlay(props().overlay)))
          .child(this.button(t, "agent-wipe-go", this.busy ? "Wiping…" : "Wipe", "danger", (_e, cx) => this.doWipe(cx))));
    }
    const c = this.agyCheck;
    const kids = c ? c.tree.length - 1 : 0;
    const facts = c
      ? v_flex().mt(12).p(10).gap(3).rounded(8).bg(t.background).border_1().border_color(t.border).text_size(11.5)
        .child(div().text_size(12.5).text_color(t.foreground).truncate().child(c.title || c.preview ? `“${c.title || c.preview}”` : "Untitled conversation"))
        .child(div().text_color(t.muted).truncate().child([c.last ? `Last active ${dayTime(c.last)}` : "", kids ? `${kids} sub-agent conversation${kids === 1 ? "" : "s"} with it` : ""].filter(Boolean).join(" · ") || "Never used"))
        .child(div().text_color(t.dim).truncate().child(c.root))
      : div().mt(12).text_size(11.5).text_color(t.dim).child(this.agyLooking ? "Looking up the conversation…" : "");
    const others = c?.running ? "Another Antigravity is running: nothing changes until every Antigravity has closed, then it finishes on its own (History hides it meanwhile)."
      : c && c.running == null ? "It can't tell whether another Antigravity runs (ps didn't answer): nothing changes until it can, then it finishes on its own." : "";
    const ask = this.agyConfirm && c ? [
      c.confirm.includes("note") ? `This tab's note names one of its sub-agents (${c.id.slice(0, 8)}…), so the wipe takes the whole conversation it belongs to.` : "",
      `It takes ${c.tree.length} conversations: this one and ${kids === 1 ? "its sub-agent" : `its ${kids} sub-agents`}${c.subs?.length ? ` (${c.subs.map((x) => x.title ? `“${x.title}”` : x.id.slice(0, 8)).join(", ")}${kids > c.subs.length ? ", …" : ""})` : ""}. Press Wipe all ${c.tree.length} to go on.`,
    ].filter(Boolean).join(" ") : "";
    const go = this.busy ? "Wiping…" : this.agyClosed ? "Try again" : this.agyConfirm && c ? `Wipe all ${c.tree.length}` : "Wipe";
    return this.dialogFrame(t, "agent-wipe", `Wipe ${f.name}?`, (cx) => this.doWipe(cx))
      .child(div().pt(12).text_color(t.muted).child(`${f.address ? "Closes it, takes" : "Takes"} this conversation out of Antigravity's own lists and moves its files into ~/.herdr/trash, so History and /resume won't show it${working}. Experimental: what it removes is kept there too, and agywipe.js restore puts it back.`))
      .child(facts)
      .when(Boolean(ask) && !this.error, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.ansi3).child(ask)))
      .when(Boolean(others) && !this.error && !ask, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.muted).child(others)))
      .when(Boolean(this.hint) && !this.error, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.muted).child(this.hint)))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().pt(14).gap(8).justify_end()
        .child(this.button(t, "agent-wipe-cancel", this.agyClosed ? "Close" : "Cancel", null, () => closeOverlay(props().overlay)))
        .child(this.button(t, "agent-wipe-go", go, "danger", (_e, cx) => this.doWipe(cx))));
  }

  // agywipe.js check for the dialog: the conversation's root, title, last use and sub-agents,
  // or why it can't be wiped (then Wipe does nothing).
  agyLookUp(f, cx) {
    this.agyCheck = null;
    this.agyLooking = true;
    cx.spawn(async (cx) => {
      const r = await agywipe(["check", home(), agyDir(f) ?? "", f.session ?? "", ...(f.pid ? [String(f.pid)] : [])], 30000);
      this.agyLooking = false;
      this.hint = null;
      if (r.code !== 0 || !r.out) this.error = `Can't wipe it: ${String(r.stderr ?? "").trim().split("\n").pop() || "agywipe.js failed"}.`;
      else if (r.out.problems?.length) this.error = `Can't wipe it: ${r.out.problems.join("; ")}.`;
      else this.agyCheck = r.out;
      cx.notify();
    });
  }

  doWipe(cx) {
    const p = props();
    const f = p.wipe;
    const targets = wipeTargets(f);
    if (this.busy || !targets.length) return;
    if (f.kind === "agy") {
      if (!this.agyCheck) {
        if (this.agyLooking) { this.hint = "Still looking up the conversation: Wipe works once it's shown."; cx.notify(); }
        return;
      }
      // More than the note's own conversation: the first press asks.
      if (!this.agyClosed && this.agyCheck.confirm?.length && !this.agyConfirm) { this.agyConfirm = true; cx.notify(); return; }
    }
    this.busy = true;
    this.error = null;
    cx.notify();
    const running = () => terminals().some((x) => x.address === f.address && x.state === "live");
    cx.spawn(async (cx) => {
      try {
        if (f.kind === "agy") return await this.doWipeAgy(p, f, running, cx);
        // Ended first, so it can't write to its transcript again.
        if (running()) run("terminal.kill", { terminal: f.address });
        for (let i = 0; i < 40 && running(); i++) await exec("sleep", ["0.15"]);
        if (running()) throw new Error("it's still running");
        if (f.pane && panes().some((x) => x.pane === f.pane)) run("pane.close", { pane: f.pane });
        const r = await exec("sh", ["-c", TRASH, "sh", `${home()}/.herdr/trash`, ...targets]);
        if (r.code !== 0) throw new Error(String(r.stderr ?? "").trim() || "moving it to the Trash failed");
        const elsewhere = String(r.stdout ?? "").split("\n").map((l) => l.trim()).find((l) => l && l !== "Trash");
        notify({ title: `Wiped ${f.name}`, body: elsewhere ? `Its conversation is in ${tilde(elsewhere)}.` : "Its conversation is in the Trash.", level: "success" });
        closeOverlay(p.overlay);
      } catch (e) {
        this.busy = false;
        this.error = `Couldn't wipe it: ${e?.message ?? e}`;
        cx.notify();
      }
    });
  }

  // Antigravity: checked again before it's closed (nothing is closed when that fails),
  // then closed, then agywipe.js wipes once its processes (the family the check found)
  // have ended. What each outcome says is what happened: a failure after the close keeps
  // the dialog open with it, and Try again runs what the minute retry runs (`pending`),
  // or the wipe again when nothing was recorded.
  async doWipeAgy(p, f, running, cx) {
    const stop = (msg, last) => { this.busy = false; this.error = msg; this.agyLast = last; cx.notify(); };
    // Turned off in Settings > Experimental since the menu opened: nothing happens.
    if (!this.agyClosed && !experimentOn(shared("workspaces.settings"), "antigravity-wipe")) return stop("Nothing was changed: \"Wipe Antigravity conversations\" was turned off in Settings > Experimental.");
    const dir = agyDir(f);
    const title = this.agyCheck.title || this.agyCheck.preview || "the conversation";
    if (this.agyClosed && this.agyLast !== "refused") {
      const r = await agywipe(["pending", home()], 120000);
      const o = r.out;
      if (r.code !== 0 || !o) return stop(`It didn't run: ${String(r.stderr ?? "").trim().split("\n").pop() || `agywipe.js ended with ${r.code}`}. It tries again each minute.`, "failed");
      if (o.busy) return stop("Another wipe is running right now; try again in a moment.", "failed");
      pendingToasts(o);
      const root = this.agyCheck.root;
      const e = o.entries?.[root];
      if (o.cleaned?.some((x) => x.id === root) || e?.done) return closeOverlay(p.overlay);
      if (o.gaveUp?.some((x) => x.id === root)) return closeOverlay(p.overlay);
      if (o.left?.includes(root) && !e?.error) {
        notify({ title: `Wiped ${f.name}, to finish later`, level: "success", body: `Nothing has changed yet: it finishes once every Antigravity has closed, and History hides “${title}” meanwhile.` });
        return closeOverlay(p.overlay);
      }
      if (!e) { notify({ title: `${f.name}: nothing left to do`, level: "success", body: `“${title}” isn't waiting to be wiped any more.` }); return closeOverlay(p.overlay); }
      return stop(`It still didn't finish: ${e.error ?? "it's waiting"}. It tries again each minute while no Antigravity runs, and says if it gives up.`, "failed");
    }
    // Its program now (it may have changed since the menu opened).
    const got = f.address ? await hc(["get", f.address, "--json"]).catch(() => null) : null;
    let pid = f.pid;
    try { pid = JSON.parse(got?.stdout ?? "")?.foreground?.pid ?? pid; } catch { /* the menu's */ }
    let family = this.agyFamily ?? [];
    if (!this.agyClosed) {
      const c = await agywipe(["check", home(), dir, f.session, ...(pid ? [String(pid)] : [])], 30000);
      if (c.code !== 0 || !c.out) return stop(`Nothing was changed: ${String(c.stderr ?? "").trim().split("\n").pop() || "agywipe.js failed"}.`);
      if (c.out.problems?.length) return stop(`Nothing was changed: ${c.out.problems.join("; ")}.`);
      if (c.out.root !== this.agyCheck.root || c.out.tree.length !== this.agyCheck.tree.length) return stop("Nothing was changed: its conversation changed since this opened. Open Wipe again.");
      family = this.agyFamily = c.out.family ?? [];
      if (running()) run("terminal.kill", { terminal: f.address });
      for (let i = 0; i < 40 && running(); i++) await exec("sleep", ["0.15"]);
      if (running()) return stop("Nothing was changed: it's still running.");
      if (f.pane && panes().some((x) => x.pane === f.pane)) run("pane.close", { pane: f.pane });
      this.agyClosed = true;
    }
    const r = await agywipe(["wipe", home(), dir, f.session, String(pid ?? "-"), family.join(",")], 90000);
    const o = r.out;
    if (o?.state === "done") {
      notify({ title: `Wiped ${f.name}`, level: "success",
        body: `“${title}” is out of Antigravity's lists${o.tree.length > 1 ? `, with ${o.tree.length - 1} sub-agent conversation${o.tree.length === 2 ? "" : "s"}` : ""}, and ${filesWhere(o.moved?.length, o.backup)}. What it removed from the lists is kept there too.` });
      return closeOverlay(p.overlay);
    }
    if (o?.state === "pending") {
      const why = o.why === "closing" ? "Its Antigravity is still closing" : o.why === "unknown" ? "It can't tell whether another Antigravity runs (ps didn't answer)" : "Another Antigravity is running";
      notify({ title: `Wiped ${f.name}, to finish later`, level: "success",
        body: `${why}, so nothing has changed yet: History hides “${title}” now, and it leaves Antigravity's lists once that's over.` });
      return closeOverlay(p.overlay);
    }
    if (o?.state === "refused") return stop(`It was closed, but nothing was wiped: ${o.error}.`, "refused");
    if (o?.stage === "record") return stop(`It was closed, but nothing was wiped: the wipe couldn't be recorded (${o.error}). Antigravity's lists weren't changed.`, "refused");
    if (o?.stage === "move") return stop(`It's out of Antigravity's lists, but some of its files weren't moved: ${o.error}. What it removed from the lists is in ${tilde(o.backup)}.`, "failed");
    const parts = o ? changedWords(o.changed) : "Antigravity's lists may be partly changed";
    const why = o?.error ?? (String(r.stderr ?? "").trim().split("\n").pop() || `agywipe.js ended with ${r.code}`);
    const backup = o?.backup ? ` A copy of them and what it removed are in ${tilde(o.backup)}.` : " Any copy is in ~/.herdr/trash.";
    const retry = o?.backup ? " It tries again each minute while no Antigravity runs, and says if it gives up." : "";
    return stop(`It was closed, but the wipe didn't finish: ${why}. ${parts}, and its files weren't moved.${backup}${retry}`, o ? "failed" : "unknown");
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
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.menuAt(cx, this.agentsBy?.get(k.address) ?? k, k.name || k.template || k.program?.name || k.address, st, false);
      })
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
    if (props()?.agentMenu) return this.agentMenu(t);
    if (props()?.send) return this.sendDialog(t);
    if (props()?.wipe) return this.wipeDialog(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.agentsBy = new Map(list.map((a) => [a.address, a]));
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
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menuAt(cx, a, label(a) || a.space_name, a.status, true); })
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
      const stat = numbersOn() ? this.stats[a.address] : null;
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
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menuAt(cx, a, full && more ? `${name} · ${more}` : name, a.status, true); })
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
