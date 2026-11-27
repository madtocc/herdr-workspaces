// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
//
// ws-agents: Herdr's `agents` (0.1.14) showing only the agents in the workspace
// chosen in `ws-switcher` (an agent is in its space's workspace, shared
// "workspaces.assigned"). agent.next / agent.prev follow the same list. The
// changes are inWorkspace(), the filter in render(), the empty text,
// open(): a click on a sub-agent keeps it as a tab instead of peeking at it, and
// a click on an agent goes back to the tabs from one of the workspace's screens (showTabs()).
// A + in the header, right of the sort button, opens ws-new-menu with only the agents and
// presets (props.agentsOnly); hidden while the workspace has no space.
// Also: a second line on an agent's row with its model, how full its context is and
// how often it was compacted, the rest on hover (readStats(), statLine(): stats.js
// reads them from the agent's own records). The plans' usage is in the status bar
// (ws-status). While Agent numbers is off in Settings > Features (settingsfacts.js, shared
// "workspaces.settings": numbersOn()) a row has its name and status only, at its one-line
// height, and nothing reads the records on a timer; the right-click menu still needs its
// conversation (Fork, Copy conversation id, Wipe), so a right-click reads that one agent's
// records first (menuAt()). Turned on again, the numbers come at the next read.
// A sub-agent's row in the tree gets the same second line (subRow(); statAgents() adds the
// live sub-agents without a pane, which agents() leaves out), and its tree lines run the
// whole row so they join at either height (treeLine()). A sub-agent with its own sub-agents
// folds them like a top row (its chevron or its icon: fold(), toggleFold(), tree()'s `up`),
// each line runs down from the middle of the icon above it, and a stat line too narrow for
// the meter drops it, so the model shows and the % says how full (measured(), statWidth()).
// Also: History's own right-click Wipe hands an Antigravity conversation that's open in no
// terminal to the Wipe dialog here (props wipe with no address: nothing to close first).
// Also: a right-click on an agent's row (a sub-agent's too, and on the rail) opens its
// menu: Peek, Send a message, Interrupt, Compact, Fork conversation, Hand off, Rename, Pin, Copy
// terminal id, Copy conversation id, Close session, Wipe conversation (menufacts.js says which a
// row gets), with the Send a message, Hand off and Wipe dialogs (agentMenu(), act(),
// sendDialog(), handoffDialog(), wipeDialog()). Antigravity's Wipe is experimental, offered while "antigravity-wipe" is
// on in ~/.herdr/settings.jsonc (settingsfacts.js, read by readSettings() into shared
// "workspaces.settings"), and only for a row whose conversation note is provably its running
// process's (stats.js: fresh); agywipe.js checks it before the agent is closed, then
// wipes the conversation's tree (out of Antigravity's lists, checked, then its files to
// the Trash), and agyPending() finishes a wipe left for when no Antigravity runs.
// Also (UX fixes, 2026-11-26): Close session and Wipe on an agent with live helpers ask
// first and say how many end with it (menuFacts() helpers, menufacts.js helpersLine());
// Send a message, Hand off and Wipe open modal (a click beside them doesn't close them),
// and Esc on Send a message or Hand off with something typed or picked asks once
// (escClose()); while Wipe says "Wiping…", Esc and Cancel do nothing; Send a message takes
// several lines (⌘Enter sends); Hand off's part above Task scrolls once Task would go under 140 px; a Pre-fill
// that didn't paste puts the task on the clipboard and says so (prefillFailed()); hover
// shows a cut name (rows, helper rows, the rail); and from Herdr 0.1.17's agents, a kept
// sub-agent shows its own status, done included, without a helper's done pulling its
// parent out of Working (kidStatus(), kidRank).
// Also (picked D3-1): a hovered row, a helper's too, shows a ⋯ after its pin (more()), which
// opens the same menu as a right-click, under the button (moreAt()).
// Also (small round, 2026-11-27): from Herdr's agents, clean() (0.1.17: a title keeps a leading
// bracket, quote or emoji), title()'s path test on the raw title (0.1.15), the guarded saved
// values (0.1.16) and the rail's mark on the agent you're on (0.1.17); the Sort popup takes
// ↑ ↓ Enter; one highlight in both popups follows the keys and the pointer; a quick menu item
// says what it's doing while it runs (BUSY_WORDS); a right-click's menu that waits for a read
// opens where the press was (pressAt()); the ⋯, Sort and + drop their tooltip once clicked
// (quietTip()); Hand off's Agent row says why it has none (menufacts.js agentsCheckLine()).
// Esc, and Cmd/Ctrl+W, reach these dialogs as Herdr's actions (overlay.close, tab.close,
// pane.close), never as keys: dialogFrame() and handoffDialog() claim them on the root.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Popup, ScrollHandle } from "gpui-base";
import { agents, terminals, panes, focused, spaces, knownAgents, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, hc, appHome, home, notify, checking, readTextFile, writeTextFile } from "herdr";
import { exec } from "./posix.js";
import { tokens } from "./statfacts.js";
import { kindOf as menuKind, menuItems, menuHeight, closeAsks, helpersLine, forkArgv, wipeTargets, agyDir, handoffChoices, firstHandoffPick, handoffLaunch, commandProgram, choiceArgv, moreAt, agentsCheckLine } from "./menufacts.js";
import { KNOBS, knobsIn, configModels, listable, keptModels, listModels, SHORT_LIST, typeahead, markSegments } from "./knobs.js";
import { SETTINGS_FILE, parseSettings, experimentOn, featureOn } from "./settingsfacts.js";
// The system's trash by its name: the Recycle Bin on Windows, the Trash elsewhere.
const trashName = () => (window()?.platform === "windows" ? "Recycle Bin" : "Trash");

// The workspace ws-switcher shows, null for every space.
const workspace = () => (shared("workspaces.defs") ?? []).find((d) => d.id === shared("workspaces.active")) ?? null;
// Shared request from the Hand off dialog to the sidebar copy to pre-fill a newly started
// agent's prompt once it reports idle (an overlay's own tasks end when it closes).
const PREFILL_KEY = "workspaces.agents.prefill";
// The presets a workspace offers: its own, then the global ones it doesn't override.
function presetsFor(id) {
  const p = shared("workspaces.presets") ?? {};
  const own = (id && p.workspaces?.[id]) || [];
  return [...own, ...(p.global ?? []).filter((g) => !own.some((o) => o.name === g.name))].filter((x) => !x.error);
}
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

// Herdr 0.1.17's: drops a status glyph or spinner and its separator, and Codex's "[ ! ] ", but
// stops at an opening bracket or quote ("[web] login") and at an emoji ("🔴 deploy").
const clean = (s) => (s ?? "").replace(/^(?:\[ [!.] \] |[✋⏳]\uFE0F?(?=\s)|(?!(?:\p{Emoji}\uFE0F|[#*]\u20E3))[^\p{L}\p{N}\p{Ps}\p{Pi}\p{Emoji_Presentation}])+/u, "").trim();

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
  // Herdr 0.1.15's: clean() would strip a path's leading ~ or /, so the title is tested with only
  // its status glyph gone; a title that is the terminal's own id doesn't count either.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
// A kept sub-agent (one with a pane) is in agents() too: it keeps its own status, done included.
const kidStatus = (k, listed) => {
  if (listed.has(k.address)) return listed.get(k.address);
  const s = k.status;
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
// The agents whose records stats.js reads: by what they report (OSC 7501 app; a
// terminals() entry's `agent`), else by their program (programs.json's key).
const KINDS = { "claude-code": "claude", claude: "claude", pi: "pi", agy: "agy", antigravity: "agy" };
const kindOf = (a) => KINDS[a.app] ?? KINDS[a.agent] ?? KINDS[a.program?.key] ?? null;
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
// A stat line's width at its 11 px text, roughly (6.3 px a character): when its column is
// narrower, the meter goes, so the model keeps its room (measured(), statLine()).
const statWidth = (s) => (s.name ? s.name.length * 6.3 + 5 : 0)
  + (s.pct != null ? 31 + String(s.pct).length * 7 + 9 : 0)
  + (s.compactions > 0 ? 17 + String(s.compactions).length * 7 : 0);
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
// A pointer position as a key ("x,y"), or undefined when there is none.
const pointKey = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? `${p.x},${p.y}` : undefined);
// Where a press was, in window points (a popup's `at`), or null.
const pressAt = (e) => {
  const x = e?.position?.x, y = e?.position?.y;
  return typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y) ? { x: Math.max(0, x), y: Math.max(0, y) } : null;
};
// A quick item's words while it runs (quick()): the popup stays until it's done.
const BUSY_WORDS = { interrupt: "Interrupting…", compact: "Compacting…", address: "Copying…", copy: "Copying…" };
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
// wl-copy and xclip stay behind to serve the clipboard: their output goes to /dev/null, or they'd
// hold exec's pipe open and it would return only once another program takes the clipboard.
const COPY = `
if command -v pbcopy >/dev/null 2>&1; then printf %s "$1" | pbcopy
elif command -v wl-copy >/dev/null 2>&1; then printf %s "$1" | wl-copy >/dev/null 2>&1
elif command -v xclip >/dev/null 2>&1; then printf %s "$1" | xclip -selection clipboard >/dev/null 2>&1
elif command -v powershell >/dev/null 2>&1; then HERDR_CLIP=$1 powershell -NoProfile -NonInteractive -Command 'for ($i = 0; $i -lt 5; $i++) { try { Set-Clipboard -Value $env:HERDR_CLIP -ErrorAction Stop; exit 0 } catch { Start-Sleep -Milliseconds 150 } }; exit 1'
else echo "no clipboard command (pbcopy, wl-copy, xclip, PowerShell)" >&2; exit 1; fi`;

// The kit's Textarea takes Cmd/Ctrl+Enter itself: it puts a line break at the cursor, then
// emits submit with `secondary`. That break isn't part of the text: take it out again
// (offsets are UTF-16, as a JS string counts them).
function dropEnterBreak(box) {
  const at = box.selected_range()?.end ?? 0;
  if (at > 0 && box.value()[at - 1] === "\n") { box.set_selected_range({ start: at - 1, end: at }); box.replace(""); }
}

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
const filesWhere = (n, backup) => (n ? `its files are in ${tilde(backup)}/files (move that folder to the ${trashName()} once you're sure)` : "it had no files left to move");
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
    if (p?.sortMenu) {
      // ↑ ↓ Enter, as the agent menu beside it; the highlight starts on the current sort.
      this.handle = cx.focus_handle();
      this.handle.focus();
      this.at = Math.max(0, SORTS.findIndex((s) => s.id === sortOf().id));
      this.pointerLast = pointKey(p.pointer);
      return;
    }
    if (p?.agentMenu || p?.send || p?.wipe || p?.handoff) return this.initOverlay(p, cx);
    this.folded = new Set();
    this.widths = new Map();
    // Each agent's last state and when it changed (ms), kept across restarts.
    // Herdr 0.1.16's guards: a damaged saved value is dropped instead of taking the list away.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    // Each agent's numbers, by address, and the terminals' programs (pid) they're read for.
    this.stats = {};
    this.statsRaw = "";
    this.statsAt = 0;
    this.statsFor = "";
    this.pids = new Map();
    this.prefillSeen = shared(PREFILL_KEY)?.id ?? 0;
    if (checking()) return;
    // Watch for Hand off "Pre-fill only" requests published by the dialog.
    cx.timer.every(250, (cx) => {
      const ask = shared(PREFILL_KEY);
      if (ask && ask.id !== this.prefillSeen && Date.now() - ask.at < 15000) {
        this.prefillSeen = ask.id;
        cx.spawn(async () => this.runPrefill(ask));
      }
    });
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

  // This computer's agents stats.js can read (another machine's records are there):
  // agents(), then the sub-agents without a pane, which only the tree shows (subRow).
  statAgents() {
    const local = (a) => !a.address.includes("/") && kindOf(a);
    const own = agents().filter(local);
    const seen = new Set(own.map((a) => a.address));
    const subs = terminals().filter((k) => k.state === "live" && k.parent && !seen.has(k.address) && local(k));
    return [...own, ...subs];
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
  // was compacted; the rest (effort, tokens, cost) on hover. Short: no meter, the % says it.
  statLine(t, a, s, id = `stat-${a.address}`, short = false) {
    const pct = s.pct;
    return h_flex()
      .id(id)
      .min_w(0)
      .gap(5)
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .tooltip(statDetail(s))
      .when(Boolean(s.name), (el) => el.child(div().min_w(0).truncate().child(s.name)))
      .when(pct != null, (el) => el
        .when(!short, (el) => el.child(meter(t, pct, 26)))
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
    this.pointerLast = pointKey(p.pointer);
    this.busy = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Antigravity's Wipe: which conversation it is and what stands in the way, before anything.
    if (p.wipe?.kind === "agy") this.agyLookUp(p.wipe, cx);
    if (p.handoff) {
      // Installed agents: the + menu's last list at once, then refreshed in the background.
      this.hoAgents = shared("new-menu.agents")?.[""] ?? [];
      this.hoChosen = false;
      this.hoFocusedIn = null;
      this.hoModel = null;
      this.hoEffort = null;
      this.hoKnobEdited = false;
      this.codexModels = [];
      this.listed = {};
      this.hoModelIn = InputState.new({ value: "", placeholder: "another model, then Enter" });
      this.hoModelIn.on("submit", (_e, cx) => {
        const m = this.hoModelIn.value().trim();
        if (m) { this.hoModel = m; this.hoKnobEdited = true; }
        this.hoModelIn.set_value("");
        cx.notify();
      });
      this.hoFindIn = InputState.new({ value: "", placeholder: "Type part of a model's name" });
      this.hoFindHi = 0;
      this.hoFindScroll = ScrollHandle.new();
      this.hoFindIn.on("change", (_e, cx) => { this.hoFindHi = 0; this.hoFindScroll.scroll_to_item(0); cx.notify(); });
      this.hoFindIn.on("submit", (_e, cx) => { this.hoFindSubmit(p.handoff); cx.notify(); });
      for (const input of [this.hoModelIn, this.hoFindIn]) {
        input.on("change", (_e, cx) => cx.notify());
        input.on("focus", (_e, cx) => { this.hoFocusedIn = input; cx.notify(); });
        input.on("blur", (_e, cx) => {
          if (this.hoFocusedIn === input) this.hoFocusedIn = null;
          if (input === this.hoFindIn) this.hoFindSet("");
          cx.notify();
        });
      }
      this.hoPick = firstHandoffPick(this.hoChoices(p.handoff), p.handoff.kind);
      this.syncHoKnobs(p.handoff);
      cx.spawn(async (cx) => {
        const known = await knownAgents().catch(() => null);
        // What the Agent row says while it has none to offer (agentsCheckLine()).
        this.hoCheck = known ? { checked: true } : { failed: true };
        if (!known) cx.notify();
        if (known) {
          this.hoAgents = known;
          if (!this.hoChosen) {
            this.hoPick = firstHandoffPick(this.hoChoices(p.handoff), p.handoff.kind);
            this.syncHoKnobs(p.handoff);
          }
          cx.notify();
        }
      });
      cx.spawn(async (cx) => {
        this.codexModels = configModels(await readTextFile(`${home()}/.codex/config.toml`).catch(() => null));
        cx.notify();
      });
      const io = { exec, readTextFile, writeTextFile, home };
      for (const program of listable()) {
        cx.spawn(async (cx) => {
          this.listed[program] = (await keptModels(io, program).catch(() => null))?.models ?? [];
          cx.notify();
          this.listed[program] = await listModels(io, program).catch(() => this.listed[program]);
          cx.notify();
        });
      }
      this.hoText = TextareaState.new({
        value: "",
        rows: 5,
        placeholder: "What should it do? Leave empty to inspect and wait.",
      });
      this.hoText.on("change", (_e, cx) => { this.error = null; this.escAsked = false; cx.notify(); });
      // ⌘Enter (Ctrl+Enter) in the box starts it: the box keeps that key, so it's read here.
      // ⇧⌘Enter isn't the box's, so it still reaches the dialog's on_key_down.
      this.hoText.on("submit", (e, cx) => { if (!e?.secondary) return; dropEnterBreak(this.hoText); this.doHandoff(cx, Boolean(e.shift)); });
      this.hoText.focus();
      cx.timer.after(350, () => this.hoText.focus());
      return;
    }
    if (!p.send) return;
    // Several lines, as Hand off's task box: hc send pastes it, then presses Enter.
    this.sendIn = TextareaState.new({ value: "", rows: 4, placeholder: `What to tell ${p.send.name}` });
    this.sendIn.on("change", (_e, cx) => { this.error = null; this.escAsked = false; cx.notify(); });
    // ⌘Enter (Ctrl+Enter) in the box sends: the box keeps that key, so it's read here.
    this.sendIn.on("submit", (e, cx) => { if (!e?.secondary) return; dropEnterBreak(this.sendIn); this.doSend(cx); });
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
    // Its live helpers, at any depth, that end with it (menufacts.js: helpers, wipeHelpers).
    // Closing its pane leaves one started to outlive it running, with what's under that
    // one; terminal.kill (Wipe, Close on a sub-agent without a pane) ends them all.
    const kids = this.tree(terminals(), a.address);
    const byAddr = new Map(kids.map((k) => [k.t.address, k.t]));
    const stays = (k) => [k.t, ...k.up.map((x) => byAddr.get(x))].some((t) => t?.die_with_parent === false);
    const tally = (list) => {
      const sts = list.map((k) => kidStatus(k.t, this.listed ?? new Map()));
      return { count: sts.length, working: sts.filter((x) => x === "working").length, blocked: sts.filter((x) => x === "blocked").length };
    };
    const wipeHelpers = tally(kids);
    const helpers = pane ? tally(kids.filter((k) => !stays(k))) : wipeHelpers;
    return {
      address: a.address, name: name || a.address, pane: pane ? a.pane : null, tab: tab ? a.tab : null, space: a.space ?? null,
      tabName: tab?.named ? tab.name : null, program: a.program?.name ?? null,
      status, kind: menuKind(a.app ?? a.agent, a.program?.key), pinned: Boolean(a.pinned), top, focused: Boolean(a.focused),
      remote: a.address.includes("/"),
      session: s.session ?? null, file: s.file ?? null, cwd: s.cwd ?? pane?.cwd ?? a.cwd ?? null, cmd: s.cmd ?? null,
      agyWipe: experimentOn(shared("workspaces.settings"), "antigravity-wipe"), agyFresh: s.fresh === true, pid: this.pids?.get(a.address)?.pid ?? null,
      helpers, wipeHelpers,
    };
  }

  // A right-click's menu. While the numbers are off nothing keeps this.stats current,
  // so that agent's records are read first (its conversation, for Fork, Copy conversation id, Wipe).
  // `at`: where the popup goes (the ⋯'s place, moreAt()); without one, at the pointer.
  // `press`: where the opening press was (window points): the popup's pointerRow() starts there,
  // and a menu that opens only after that read goes there, as the pointer may have moved on.
  menuAt(cx, a, name, status, top, at, press) {
    const one = numbersOn() ? [] : this.statAgents().filter((x) => x.address === a.address);
    if (!one.length) return this.openMenu(this.menuFacts(a, name, status, top), at, press);
    cx.spawn(async (cx) => {
      await this.readStats(cx, one);
      this.openMenu(this.menuFacts(a, name, status, top), at ?? press, press);
    });
  }

  // press: where the press that opened it was (pointerRow()'s first place).
  openMenu(f, at, press = null) {
    openOverlay({ mod: "ws-agents", kind: "popup", width: 220, height: menuHeight(menuItems(f)), ...(at ? { at } : {}), props: { agentMenu: f, pointer: press } });
  }

  // The hovered row's ⋯ (drawn like its pin): the same menu as a right-click, opened under
  // the button. Its press keeps the button's place (window points, as a popup's `at` wants);
  // Herdr keeps the popup inside the window. No place yet (not painted): at the pointer.
  // Drawn only while the row is hovered, like the pin: a click that comes in the same frame as
  // the pointer, before the ⋯ is drawn, lands on the row (known and accepted).
  more(t, id, open, row = null) {
    return this.quietTip(div()
      .id(id)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (e) => { this.moreBounds = e.bounds ?? null; this.morePress = pressAt(e); })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.tipOff = id;
        open(cx, moreAt(this.moreBounds), this.morePress);
        this.moreBounds = null;
        cx.notify();
      }), id, "More", row)
      .child(svg("mods/ws-agents/dots.svg").size(13));
  }

  // A button that opens a popup beside itself (⋯, Sort, +), or a row's name under its right-click
  // menu: its tooltip goes once it's clicked (the click sets tipOff), so it doesn't sit over the
  // popup, and comes back once the pointer has left it.
  // `row`: the row it's in, whose right-click menu quiets it too.
  quietTip(el, id, text, row = null) {
    return el
      .when(this.tipOff !== id && (!row || this.tipOff !== row), (e) => e.tooltip(text))
      .on_hover((over, cx) => { if (!over && this.tipOff === id) { this.tipOff = null; cx.notify(); } });
  }

  // A row under a pointer that moves becomes the keys' row. pointerLast starts at the press that
  // opened the menu (props.pointer) and follows every move; a move at the same place as the last
  // one is no move (a resting pointer, or one re-sent with no movement), so it never takes the row.
  pointerRow(i, e, cx) {
    const here = pointKey(e?.position);
    if (here === undefined || here === this.pointerLast) return;
    const first = this.pointerLast === undefined;
    this.pointerLast = here;
    if (first) return; // no press known: the first move is only where it rests
    if (this.at !== i) { this.at = i; cx.notify(); }
  }

  // A menu item. Quick ones run here and the popup closes after (its tasks end when it
  // does); Send a message and Wipe open their own dialogs, Close asks first while it works.
  act(it, cx) {
    const p = props();
    const f = p.agentMenu;
    const done = () => closeOverlay(p.overlay);
    if (!it || this.busy) return;
    this.acting = it.id;
    switch (it.id) {
      case "peek":
        done();
        return run("terminal.peek", { terminal: f.address });
      case "send":
        done();
        return openOverlay({ mod: "ws-agents", kind: "dialog", modal: true, width: 460, height: 300, props: { send: f } });
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
      case "handoff":
        done();
        return openOverlay({ mod: "ws-agents", kind: "dialog", modal: true, width: 580, height: 610, props: { handoff: f } });
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
        return this.quick(cx, () => exec("sh", ["-c", COPY, "sh", f.session]), "Couldn't copy the conversation id",
          () => notify({ title: "Conversation id copied", body: f.session, level: "success", timeout: 2500 }));
      case "close": {
        done();
        const command = f.pane ? { name: "pane.close", args: { pane: f.pane } } : { name: "terminal.kill", args: { terminal: f.address } };
        if (!closeAsks(f)) return run(command.name, command.args);
        const own = f.status === "working" ? "It's working: closing it stops what it's doing."
          : f.status === "blocked" ? "It's waiting on you. Closing it ends it there." : "";
        const kids = helpersLine(f.helpers);
        return openOverlay({ mod: "confirm", kind: "dialog", width: 420, height: kids ? 196 : 176, props: {
          title: `Close ${f.name}?`,
          detail: [own, kids, "Its conversation stays in History."].filter(Boolean).join(" "),
          command } });
      }
      case "wipe":
        done();
        return openOverlay({ mod: "ws-agents", kind: "dialog", modal: true, width: 480, height: (f.kind === "agy" ? 410 : 226) + (helpersLine(f.wipeHelpers) ? 20 : 0), props: { wipe: f } });
    }
  }

  // Runs one quick step (hc, a shell line), then closes the popup; a toast says when it failed.
  quick(cx, step, failed, after) {
    const overlay = props().overlay;
    // The clicked row says so while it runs (hc send waits while a draft sits in the prompt).
    this.busy = this.acting ?? true;
    cx.notify();
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
        // Esc never comes here: Herdr's Esc closes a popup as its action overlay.close.
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
          // The pointer moves the keys' row too, so one row is lit and Enter runs it (pointerRow());
          // no hover fill of its own, or a menu under a resting pointer would show two.
          .on_mouse_move((e, cx) => this.pointerRow(i, e, cx))
          .on_click((_e, cx) => this.act(it, cx))
          .child(svg(it.icon).size(14).flex_none().text_color(it.danger ? t.blocked : t.muted))
          .child(div().flex_1().min_w(0).truncate().child(this.busy === it.id ? (BUSY_WORDS[it.id] ?? it.label) : it.label))
          .when(Boolean(it.hint), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint))))));
  }

  // Esc on a dialog with something typed or changed (`unsaved`): the first press says
  // so (escLine()), the second closes; typing or clicking anything else resets it.
  // While a wipe runs (`locked`) it does nothing: closing then would leave it half done.
  escClose(cx, unsaved, locked = false) {
    if (locked) return;
    if (unsaved && !this.escAsked) { this.escAsked = true; cx.notify(); return; }
    closeOverlay(props().overlay);
  }

  escLine(t) {
    return div().pt(8).text_size(11.5).text_color(t.working).child("Press Esc again to close and drop what you typed.");
  }

  // The dialogs' frame, title, buttons and error line, as the switcher's dialogs look.
  // enter: what Enter does (with ⌘ or Ctrl when `o.modEnter`); o.unsaved, o.locked: escClose().
  dialogFrame(t, id, title, enter, o = {}) {
    // Esc, and Cmd/Ctrl+W, reach a dialog as Herdr's actions, never as keys: claim them here.
    // A handler that returns without closing keeps the dialog open.
    const onClose = (_e, cx) => { cx.stop_propagation(); this.escClose(cx, o.unsaved?.(), o.locked?.()); };
    return v_flex().id(id).track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      .on_action("overlay.close", onClose)
      .on_action("tab.close", onClose)
      .on_action("pane.close", onClose)
      .on_mouse_down("left", (_e, cx) => { if (this.escAsked) { this.escAsked = false; cx.notify(); } })
      .on_key_down((e, cx) => {
        // Herdr's Esc comes as overlay.close (above), never here.
        if (e.key === "enter" && enter && (!o.modEnter || e.modifiers?.platform || e.modifiers?.control)) enter(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")));
  }

  // dead: drawn dimmed and does nothing (Cancel while a wipe runs).
  button(t, id, label, kind, action, dead = false) {
    const bg = kind === "danger" ? t.blocked : kind === "primary" ? t.solid : t.raised;
    const fg = kind === "danger" ? "#ffffff" : kind === "primary" ? t.solid_foreground : t.foreground;
    return h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(kind ? bg : t.input).bg(bg)
      .text_color(fg).text_size(12.5).font_medium()
      .when(!dead, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
      .when((this.busy && Boolean(kind)) || dead, (el) => el.opacity(0.5)).child(label);
  }

  // Send a message: typed into the agent's prompt and sent, without going to it.
  sendDialog(t) {
    const f = props().send;
    const modKey = window()?.platform === "macos" ? "⌘" : "Ctrl+";
    return this.dialogFrame(t, "agent-send", `Message ${f.name}`, (cx) => this.doSend(cx),
      { modEnter: true, unsaved: () => this.sendIn.value().trim() !== "" })
      .child(div().mt(14).flex_1().min_h(76).child(Textarea.new(this.sendIn).size_full().p(10).rounded(8).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.5).text_color(t.foreground)))
      .child(div().pt(10).text_size(11.5).text_color(t.dim).child(this.busy
        ? "Sending… (if you left a draft in its prompt, it waits until that's sent or cleared)"
        : "Typed into its prompt and sent, as if you'd typed it there."))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .when(Boolean(this.escAsked), (el) => el.child(this.escLine(t)))
      .child(h_flex().pt(14).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${modKey}Enter sends`))
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

  // Hand off: starts a new agent or preset in the same space and folder with a reference
  // to this session (terminal id for hc read, transcript path when known, working folder).
  hoWorkspace(f) {
    const assigned = shared("workspaces.assigned") ?? {};
    return (f?.space && assigned[f.space]) || shared("workspaces.active") || null;
  }

  hoChoices(f) {
    return handoffChoices(presetsFor(this.hoWorkspace(f)), this.hoAgents ?? [], shared("new-menu.hidden") ?? []);
  }

  // Resets Model/Effort to whatever the newly picked agent or preset's own command sets.
  syncHoKnobs(f) {
    const pick = this.hoChoices(f).find((c) => c.id === this.hoPick) ?? null;
    const k = knobsIn(choiceArgv(pick));
    this.hoModel = k.model ?? null;
    this.hoEffort = k.effort ?? null;
    this.hoKnobEdited = false;
    this.hoModelIn?.set_value("");
    this.hoFindSet("");
  }

  hoModelState(f) {
    const pick = this.hoChoices(f).find((c) => c.id === this.hoPick) ?? null;
    const program = pick ? commandProgram(choiceArgv(pick)) : "";
    const knobs = KNOBS[program] ?? null;
    const models = knobs
      ? [...new Set([...knobs.models, ...(program === "codex" ? this.codexModels : []), ...(this.listed[program] ?? []), ...(this.hoModel ? [this.hoModel] : [])])]
      : [];
    return { pick, program, knobs, models };
  }

  hoFindSet(text) {
    if (!this.hoFindIn) return;
    this.hoFindIn.set_value(text);
    this.hoFindIn.set_selected_range({ start: text.length, end: text.length });
    this.hoFindHi = 0;
    this.hoFindScroll?.scroll_to_item(0);
  }

  hoFindPick(r) {
    if (r.kind === "provider") return this.hoFindSet(`${r.provider}/`);
    this.hoModel = r.kind === "model" ? r.id : r.text;
    this.hoKnobEdited = true;
    this.hoFindSet("");
    this.hoFindIn.blur();
  }

  hoFindSubmit(f) {
    const { rows } = typeahead(this.hoModelState(f).models, this.hoFindIn.value());
    const r = rows[Math.min(this.hoFindHi, rows.length - 1)];
    if (r) this.hoFindPick(r);
  }

  hoFindKey(f, e, cx) {
    if (this.hoFocusedIn !== this.hoFindIn) return;
    const { rows } = typeahead(this.hoModelState(f).models, this.hoFindIn.value());
    const r = rows[Math.min(this.hoFindHi, rows.length - 1)];
    if (e.key === "down" || e.key === "up") {
      this.hoFindHi = Math.max(0, Math.min(rows.length - 1, Math.min(this.hoFindHi, rows.length - 1) + (e.key === "down" ? 1 : -1)));
      this.hoFindScroll.scroll_to_item(this.hoFindHi);
    } else if (e.key === "tab" && r && r.kind !== "typed") {
      this.hoFindSet(r.kind === "provider" ? `${r.provider}/` : r.id);
    } else return; // Esc comes as overlay.close: the dialog's handler closes the list first.
    cx.stop_propagation();
    cx.notify();
  }

  // Typeahead model box for providers with long lists (> SHORT_LIST, e.g. Pi and OpenCode).
  hoModelFind(t, f, models, model, who) {
    const open = this.hoFocusedIn === this.hoFindIn;
    const typed = this.hoFindIn.value();
    const { rows, words: marks, matches } = typeahead(models, typed);
    const hi = Math.min(this.hoFindHi, rows.length - 1);
    const W = 360;
    const box = h_flex().id("ho-find").w(W).h(26).relative()
      .on_key_down((e, cx) => this.hoFindKey(f, e, cx))
      .child(Input.new(this.hoFindIn).w_full().h(26).px(10).rounded(13).border_1().border_color(open ? t.accent : t.input).bg(t.background)
        .text_size(12).text_color(t.foreground))
      .when(!open && Boolean(model), (el) => el.child(div().id("ho-find-set").absolute().inset_0().rounded(13).bg(t.background).cursor_text()
        .on_click((_e, cx) => { this.hoFindIn.focus(); cx.notify(); })
        .child(h_flex().size_full().px(10).gap(6).items_center().rounded(13).border_1().border_color(t.accent).bg(t.selected)
          .text_size(12).text_color(t.foreground)
          .child(div().flex_1().min_w(0).truncate().child(model))
          .child(div().id("ho-find-clear").size(18).flex_none().flex().items_center().justify_center().rounded(9).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Back to Default")
            .on_click((_e, cx) => { cx.stop_propagation(); this.hoModel = null; this.hoKnobEdited = true; cx.notify(); }).child("×")))));
    const row = (r, i) => h_flex().id(`ho-find-${i}`).h(28).flex_none().px(8).gap(10).items_center().rounded(6).cursor_pointer()
      .when(i === hi, (el) => el.bg(t.hover))
      .text_size(12).text_color(i === hi || r.kind !== "model" ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.hoFindPick(r); cx.notify(); })
      .when(r.kind === "provider", (el) => el
        .child(div().flex_1().min_w(0).truncate().child(`${r.provider}/`))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`${r.count} models`)))
      .when(r.kind === "typed", (el) => el
        .child(div().flex_1().min_w(0).truncate().child(`Use “${r.text}” as typed`))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`not in ${who}'s list`)))
      .when(r.kind === "model", (el) => el
        .child(div().w(12).flex_none().text_size(11).text_color(t.accent).child(r.id === model ? "✓" : ""))
        .child(h_flex().flex_1().min_w(0).overflow_hidden()
          .children(markSegments(r.name, marks).map((g) => div().flex_none().when(g.on, (d) => d.text_color(t.foreground).font_semibold()).child(g.text))))
        .when(Boolean(r.provider), (d) => d.child(div().flex_none().text_size(11.5).text_color(t.dim).child(r.provider))));
    const providers = rows.filter((r) => r.kind === "provider").length;
    const count = !typed.trim() ? (providers ? `${models.length} models from ${providers} providers` : `${models.length} models`)
      : matches ? `${matches} match${matches === 1 ? "" : "es"}` : "No match";
    const list = v_flex().id("ho-find-list").w(W).mt(6).rounded(8).shadow_md().border_1().border_color(t.input).bg(t.popover).text_color(t.foreground)
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().id("ho-find-rows").max_h(8 * 28 + 8).overflow_y_scrollbar().track_scroll(this.hoFindScroll).p(4)
        .children(rows.map(row)))
      .child(h_flex().h(24).flex_none().px(10).gap(12).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().flex_1().child(count))
        .child(div().flex_none().child("↑↓ move   ↵ pick   esc close")));
    return Popup.new("ho-find-popup", box).when(open, (el) => el.content(list));
  }

  handoffDialog(t) {
    const p = props();
    const f = p.handoff;
    const close = () => closeOverlay(p.overlay);
    const choices = this.hoChoices(f);
    const agentChoices = choices.filter((c) => c.kind === "agent");
    const presetChoices = choices.filter((c) => c.kind === "preset");
    const { pick, program, knobs, models } = this.hoModelState(f);
    const allAgents = this.hoAgents ?? [];
    const activeSpace = spaces().find((s) => s.active);
    const spaceObj = spaces().find((s) => s.id === (f.space || activeSpace?.id));
    const folder = f.cwd || spaceObj?.folder || null;
    const modKey = window()?.platform === "macos" ? "⌘" : "Ctrl+";
    const section = (text) => div().pt(10).pb(5).text_size(11.5).text_color(t.dim).child(text);
    const glyph = (a) => (a?.icon ? (a.tint ? svg(a.icon).text_color(t.foreground) : image(a.icon)).size(13).flex_none()
      : svg("mods/workspace-chrome/terminal.svg").size(13).flex_none().text_color(t.muted));
    const iconFor = (c) => glyph(c.kind === "agent"
      ? allAgents.find((a) => a.key === c.key)
      : allAgents.find((a) => a.key === commandProgram(c.command)));
    const chip = (c) => {
      const on = this.hoPick === c.id;
      return h_flex().id(`ho-${c.id}`).h(26).px(10).gap(6).flex_none().items_center().rounded(13).border_1()
        .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(12)
        .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .when(Boolean(c.tip), (el) => el.tooltip(c.tip))
        .on_click((_e, cx) => {
          if (this.hoPick !== c.id) {
            this.hoPick = c.id;
            this.hoChosen = true;
            this.syncHoKnobs(f);
          }
          this.error = null;
          cx.notify();
        })
        .child(iconFor(c)).child(c.name);
    };
    const knobChip = (id, label, on, action) => div().id(id).h(26).px(10).flex().items_center().rounded(13).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_size(12)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { action(); this.hoKnobEdited = true; cx.notify(); }).child(label);
    const providerName = allAgents.find((a) => a.key === program)?.name ?? program;
    const refMeta = [f.program || f.kind, `terminal ${f.address}`].filter(Boolean).join(" · ");
    // Anything typed or picked is lost on close: Esc asks once (escClose()). With the model
    // box's list open, Esc closes the list first (empty) and the dialog stays.
    const unsaved = () => this.hoText.value().trim() !== "" || this.hoChosen || this.hoKnobEdited || this.hoModelIn.value().trim() !== "";
    // Esc, and Cmd/Ctrl+W, reach a dialog as Herdr's actions, never as keys: claim them here.
    const onClose = (_e, cx) => {
      cx.stop_propagation();
      if (this.hoFocusedIn === this.hoFindIn) { this.hoFocusedIn = null; this.hoFindSet(""); this.hoFindIn.blur(); this.handle.focus(); cx.notify(); return; }
      this.escClose(cx, unsaved());
    };
    return v_flex().id("agent-handoff").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_action("overlay.close", onClose)
      .on_action("tab.close", onClose)
      .on_action("pane.close", onClose)
      .on_mouse_down("left", (_e, cx) => { if (this.escAsked) { this.escAsked = false; cx.notify(); } })
      .on_key_down((e, cx) => {
        // Herdr's Esc comes as overlay.close (above), never here.
        if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control)) this.doHandoff(cx, Boolean(e.modifiers?.shift));
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(`Hand off ${f.name}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      // Everything above Task keeps its height while it fits and scrolls once the Task box
      // would go under 140, so many agents or presets never squeeze it or push the buttons out.
      .child(v_flex().id("ho-top").flex_shrink_1().min_h(0).overflow_y_scrollbar()
      .child(v_flex().mt(10).p(10).gap(3).rounded(8).bg(t.background).border_1().border_color(t.border).text_size(11.5)
        .child(h_flex().gap(8).items_center()
          .child(div().text_color(t.foreground).truncate().child(`Reference: ${refMeta}`))
          .child(div().flex_1())
          .child(div().flex_none().text_color(t.dim).font_family("JetBrains Mono").child(`hc read ${f.address}`)))
        .when(Boolean(f.file), (el) => el.child(div().text_color(t.muted).truncate().child(`Transcript: ${tilde(f.file)}`)))
        .when(Boolean(folder), (el) => el.child(div().text_color(t.dim).truncate().child(`Folder: ${tilde(folder)}`))))
      .child(section("Agent"))
      .when(agentChoices.length > 0, (el) => el.child(h_flex().gap(6).flex_wrap().children(agentChoices.map(chip))))
      .when(agentChoices.length === 0, (el) => el.child(div().text_size(12).text_color(t.dim).child(agentsCheckLine(this.hoCheck))))
      .when(presetChoices.length > 0, (el) => el
        .child(section("Presets"))
        .child(h_flex().gap(6).flex_wrap().children(presetChoices.map(chip))))
      .when(Boolean(knobs), (el) => el
        .child(section("Model"))
        .when(models.length > SHORT_LIST, (el) => el.child(h_flex().gap(6).items_center()
          .child(knobChip("ho-model-default", "Default", !this.hoModel, () => { this.hoModel = null; }))
          .child(this.hoModelFind(t, f, models, this.hoModel, providerName))))
        .when(models.length <= SHORT_LIST, (el) => el.child(h_flex().gap(6).flex_wrap().items_center()
          .child(knobChip("ho-model-default", program === "codex" && this.codexModels[0] ? `Default (${this.codexModels[0]})` : "Default", !this.hoModel, () => { this.hoModel = null; this.hoModelIn.set_value(""); }))
          .children(models.map((m) => knobChip(`ho-model-${m}`, m, this.hoModel === m, () => { this.hoModel = m; this.hoModelIn.set_value(""); })))
          .child(div().w(175).child(Input.new(this.hoModelIn).h(26).px(8).rounded(13).border_1().border_color(this.hoFocusedIn === this.hoModelIn ? t.accent : t.input).bg(t.background).text_size(11.5).text_color(t.foreground)))))
        .when(Boolean(knobs.effort), (el) => el
          .child(section("Effort"))
          .child(h_flex().gap(6).flex_wrap()
            .child(knobChip("ho-effort-default", "Default", !this.hoEffort, () => { this.hoEffort = null; }))
            .children((knobs.effort?.levels ?? []).map((l) => knobChip(`ho-effort-${l}`, l, this.hoEffort === l, () => { this.hoEffort = l; })))))))
      .child(section(pick?.kind === "preset"
        ? "Task (sent with reference; preset instructions included)"
        : "Task (sent with reference)"))
      .child(div().flex_1().min_h(140).child(Textarea.new(this.hoText).size_full().p(10).rounded(8).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .when(Boolean(this.escAsked), (el) => el.child(this.escLine(t)))
      .child(h_flex().pt(12).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${modKey}Enter sends · ⇧${modKey}Enter pre-fills`))
        .child(this.button(t, "agent-handoff-cancel", "Cancel", null, close))
        .child(this.button(t, "agent-handoff-prefill", "Pre-fill only", null, (_e, cx) => this.doHandoff(cx, true))
          .tooltip(`Start the agent and paste this into its prompt without sending (⇧${modKey}Enter)`))
        .child(this.button(t, "agent-handoff-go", "Start", "primary", (_e, cx) => this.doHandoff(cx, false))
          .tooltip(`Start the agent and send right away (${modKey}Enter)`)));
  }

  doHandoff(cx, prefill = false) {
    const p = props();
    const f = p.handoff;
    const choices = this.hoChoices(f);
    const choice = choices.find((c) => c.id === this.hoPick) ?? null;
    if (!choice) {
      this.error = choices.length ? "Pick an agent or preset first." : agentsCheckLine(this.hoCheck, true);
      cx.notify();
      return;
    }
    const activeSpace = spaces().find((s) => s.active);
    const targetSpace = f.space || activeSpace?.id || null;
    const folder = f.cwd || spaces().find((s) => s.id === targetSpace)?.folder || null;
    const program = commandProgram(choiceArgv(choice));
    const knobs = KNOBS[program] ?? null;
    const typedModel = this.hoModelIn?.value().trim() || "";
    const override = knobs && (this.hoKnobEdited || Boolean(typedModel))
      ? { knobs, model: typedModel || this.hoModel || "", effort: this.hoEffort || "" }
      : {};
    const launch = handoffLaunch(choice, f, this.hoText.value(), shared("workspaces.launcher") === true, { space: targetSpace, folder, prefill, platform: window()?.platform, ...override });
    if (!launch) {
      this.error = `Couldn't build a launch command for ${choice.name}.`;
      cx.notify();
      return;
    }
    const { prefill: prefillText, ...tabArgs } = launch;
    const before = prefill ? terminals().map((t) => t.address) : null;
    showTabs();
    run("tab.new", tabArgs);
    if (prefill && prefillText) {
      setShared(PREFILL_KEY, { id: Date.now() + Math.random(), space: targetSpace, name: tabArgs.name, before, text: prefillText, at: Date.now() });
    }
    closeOverlay(p.overlay);
  }

  // A Pre-fill that didn't paste: the task goes to the clipboard, so it's never lost, and a
  // toast says why and where it is.
  async prefillFailed(req, who, why) {
    const r = await exec("sh", ["-c", COPY, "sh", req.text]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
    notify({ title: `Couldn't pre-fill ${who}`, level: "error",
      body: r?.code === 0 ? `${why} Your task is on the clipboard.` : `${why} Copying your task failed too: ${failure(r)}` });
  }

  // Finds the terminal just opened by a Pre-fill handoff, waits until the agent reports
  // idle, and pastes the reference + task into its prompt via bracketed paste without Enter.
  async runPrefill(req) {
    const sleep = (ms) => exec("sleep", [String(ms / 1000)]).catch(() => {});
    const before = new Set(req.before ?? []);
    let addr = null;
    const findEnd = Date.now() + 6000;
    while (!addr && Date.now() < findEnd) {
      const added = terminals().filter((t) => t.state === "live" && !before.has(t.address));
      const inSpace = req.space ? added.filter((t) => t.labels?.["herdr.space"] === req.space) : added;
      const pool = inSpace.length ? inSpace : added;
      const exact = pool.find((t) => req.name && String(t.labels?.where ?? "").endsWith(`/ ${req.name}`));
      addr = (exact ?? pool[0])?.address ?? null;
      if (!addr) await sleep(200);
    }
    if (!addr) return this.prefillFailed(req, req.name || "agent", "The new terminal wasn't found.");
    const readyEnd = Date.now() + 45000;
    let ready = false;
    while (Date.now() < readyEnd) {
      const live = terminals().find((t) => t.address === addr && t.state === "live");
      if (!live) return this.prefillFailed(req, req.name || addr, "Its terminal ended before it was ready.");
      const ag = agents().find((a) => a.address === addr);
      if (ag?.status === "idle") { ready = true; break; }
      await sleep(250);
    }
    if (!ready) return this.prefillFailed(req, req.name || addr, "It didn't report ready in time.");
    await sleep(350);
    const agNow = agents().find((a) => a.address === addr);
    if (!agNow || agNow.status !== "idle") return this.prefillFailed(req, req.name || addr, "It got busy before the task could be pasted.");
    const r = await exec("python3", [`${appHome()}/mods/ws-agents/prefill.py`, addr, req.text], { timeout: 15000 })
      .catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
    if (r.code !== 0) return this.prefillFailed(req, req.name || addr, `${failure(r).replace(/\.$/, "")}.`);
  }

  // Wipe: closes the agent and moves its conversation to the Trash (menufacts.js:
  // wipeTargets()), so History and its agent's own resume no longer find it. Antigravity's
  // shows which conversation it is (agywipe.js check), asks twice when the wipe takes more
  // than the note's own conversation, and goes through agywipe.js.
  wipeDialog(t) {
    const f = props().wipe;
    const targets = wipeTargets(f);
    const working = f.status === "working" ? "; it's working, so this also stops what it's doing" : "";
    const helpers = helpersLine(f.wipeHelpers) ? ` ${helpersLine(f.wipeHelpers)}` : "";
    if (f.kind !== "agy") {
      return this.dialogFrame(t, "agent-wipe", `Wipe ${f.name}?`, (cx) => this.doWipe(cx), { locked: () => this.busy })
        .child(div().pt(12).text_color(t.muted).child(`Closes it and moves its conversation to the ${trashName()}. History won't list it and it can't be resumed${working}.${helpers}`))
        .child(div().id("agent-wipe-file").pt(10).text_size(11.5).text_color(t.dim).truncate().tooltip(tilde(targets[0])).child(tilde(targets[0])))
        .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
        .child(div().flex_1())
        .child(h_flex().pt(14).gap(8).justify_end()
          .child(this.button(t, "agent-wipe-cancel", "Cancel", null, () => closeOverlay(props().overlay), this.busy))
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
    return this.dialogFrame(t, "agent-wipe", `Wipe ${f.name}?`, (cx) => this.doWipe(cx), { locked: () => this.busy })
      .child(div().pt(12).text_color(t.muted).child(`${f.address ? "Closes it, takes" : "Takes"} this conversation out of Antigravity's own lists and moves its files into ~/.herdr/trash, so History and /resume won't show it${working}.${helpers} Experimental: what it removes is kept there too, and agywipe.js restore puts it back.`))
      .child(facts)
      .when(Boolean(ask) && !this.error, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.ansi3).child(ask)))
      .when(Boolean(others) && !this.error && !ask, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.muted).child(others)))
      .when(Boolean(this.hint) && !this.error, (el) => el.child(div().pt(8).text_size(11.5).text_color(t.muted).child(this.hint)))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().pt(14).gap(8).justify_end()
        .child(this.button(t, "agent-wipe-cancel", this.agyClosed ? "Close" : "Cancel", null, () => closeOverlay(props().overlay), this.busy))
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
        if (r.code !== 0) throw new Error(String(r.stderr ?? "").trim() || `moving it to the ${trashName()} failed`);
        const elsewhere = String(r.stdout ?? "").split("\n").map((l) => l.trim()).find((l) => l && l !== "Trash");
        notify({ title: `Wiped ${f.name}`, body: elsewhere ? `Its conversation is in ${tilde(elsewhere)}.` : `Its conversation is in the ${trashName()}.`, level: "success" });
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
    // 3 s at most (as History's Wipe asks it): the dialog can't be closed while it waits.
    const got = f.address ? await exec("hc", ["get", f.address, "--json"], { timeout: 3000 }).catch(() => null) : null;
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
    const pick = (s) => { setShared("agents.sort", s.id); closeOverlay(props().overlay); };
    return v_flex()
      .id("sort-menu")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down" || e.key === "up") this.at = (this.at + (e.key === "down" ? 1 : SORTS.length - 1)) % SORTS.length;
        else if (e.key === "enter") return pick(SORTS[this.at]);
        else return;
        cx.notify();
      })
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
        .when(SORTS[this.at] === s, (el) => el.bg(t.selected))
        .on_mouse_move((e, cx) => this.pointerRow(SORTS.indexOf(s), e, cx))
        .on_click(() => pick(s))
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

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it
  // and the sub-agents above it (`up`, nearest last), so folding one hides its own.
  tree(all, addr, lead = [], up = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"], up },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"], [...up, k.address]),
      ];
    });
  }

  // The fold chevron of a row with sub-agents (`subs`, every one under it); folded,
  // the count too, colored by the most urgent one.
  fold(t, addr, subs) {
    const sts = subs.map((s) => kidStatus(s.t, this.listed));
    const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    const open = !this.folded.has(addr);
    return div()
      .id(`fold-${addr}`)
      .h(18)
      .px(3)
      .gap(3)
      .flex()
      .flex_none()
      .items_center()
      .rounded(4)
      .text_size(11)
      .text_color(open ? t.dim : (t[top] ?? t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.toggleFold(addr, cx);
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!open, (el) => el.child(String(subs.length)));
  }

  toggleFold(addr, cx) {
    this.folded.has(addr) ? this.folded.delete(addr) : this.folded.add(addr);
    cx.notify();
  }

  // A stat line's column reports its width; too narrow for the whole line (statWidth),
  // the line drops the meter and keeps the model and the % (statLine's `short`).
  measured(el, id) {
    return el.on_size_change((size, cx) => {
      const w = Math.round(size.width);
      if (this.widths.get(id) === w) return;
      this.widths.set(id, w);
      cx.notify();
    });
  }

  short(id, s) {
    const w = this.widths.get(id);
    return w != null && w < statWidth(s);
  }

  subRow(t, s, shown, compact, root, kids = []) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    // Its numbers (as a top row's, statLine) on a second line, when there are any.
    const stat = numbersOn() ? this.stats[k.address] : null;
    const subName = k.name || k.template || k.program?.name || k.address;
    const nameEl = div().id(`sub-name-${k.address}`).flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted)
      .when(this.tipOff !== `sub-${k.address}`, (el) => el.tooltip(subName)).child(subName); // not under its own menu
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(9)
      .pr(8)
      .rounded(8)
      .h(stat ? 38 : 26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_hover((over, cx) => {
        if (over) this.hovered = k.address;
        else if (this.hovered === k.address) { this.hovered = null; this.tipOff = null; } // its ⋯ goes, and its tooltip's back next time
        cx.notify();
      })
      .on_click((e) => this.open(k, root, e))
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        this.tipOff = `sub-${k.address}`; // the row's tooltips go while its menu is up, back once the pointer leaves the row
        cx.notify();
        this.menuAt(cx, this.agentsBy?.get(k.address) ?? k, subName, st, false, null, pressAt(e));
      })
      .children(s.lines.map((l) => this.treeLine(t, l, stat ? 38 : 26, stat ? 23 : 17)))
      .when(Boolean(pic), el => el.child(div().id(`sub-fold-${k.address}`).mr(6)
        .when(kids.length > 0, (el) => el.on_click((_e, cx) => { cx.stop_propagation(); this.toggleFold(k.address, cx); }))
        .child(pic)))
      .child(stat
        ? this.measured(v_flex().id(`sub-col-${k.address}`).flex_1().min_w(0).mr(6).gap(1), k.address)
          .child(nameEl).child(this.statLine(t, k, stat, `sub-stat-${k.address}`, this.short(k.address, stat)))
        : nameEl)
      .when(kids.length > 0, (el) => el.child(div().mr(4).child(this.fold(t, k.address, kids))))
      .when(this.hovered === k.address, (el) => el.child(div().mr(6).child(this.more(t, `sub-more-${k.address}`,
        (cx, at, press) => this.menuAt(cx, this.agentsBy?.get(k.address) ?? k, subName, st, false, at, press), `sub-${k.address}`))))
      .child(this.status(t, { status: st }, compact));
  }

  // One step of a sub-row's tree lines, in a row h tall: "│" runs the whole row, "└" bends
  // to the icon (its middle `elbow` down, past the 4 px it starts above the row), "├" both.
  // A step is as wide as an icon's middle (7) plus the bend (6) and a gap (2), so each line
  // runs down from the middle of the icon above it.
  treeLine(t, l, h, elbow) {
    const seg = () => div().self_start().mt(-4).ml(7).w(6).mr(2).flex_none();
    const bend = (el) => el.h(elbow).border_l(1.5).border_b(1.5).border_color(t.input).rounded_bl(5);
    if (l === "└") return bend(seg());
    if (l === "│") return seg().h(h + 4).border_l(1.5).border_color(t.input);
    if (l === "├") return seg().h(h + 4).flex().flex_col()
      .child(bend(div().w(6).flex_none()))
      .child(div().flex_1().border_l(1.5).border_color(t.input));
    return seg();
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
    if (props()?.handoff) return this.handoffDialog(t);
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
    // A helper's done is its own row's news: it doesn't pull a working parent out of Working.
    const kidRank = (k) => { const s = kidStatus(k, this.listed); return RANK[s === "done" ? "idle" : s] ?? 0; };
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => kidRank(s.t)))]));
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
      return [r, ...subs
        .filter((s) => !s.up.some((u) => this.folded.has(u)))
        .map((s) => this.subRow(t, s, shown, byPriority, a, subs.filter((x) => x.up.includes(s.t.address))))];
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
        return this.quietTip(h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .mx(6)
          .px(2)
          .rounded(6)
          .flex_none()
          .items_center()
          .gap(4)
          .when(Boolean(a.focused), (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => { showTabs(); run("pane.focus", { pane: a.pane }); })
          // Its tooltip goes while its own menu is open (quietTip()), until the pointer leaves the row.
          .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); this.tipOff = `ag-${a.address}`; cx.notify(); this.menuAt(cx, a, label(a) || a.space_name, a.status, true, null, pressAt(e)); })
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(a.focused ? t.foreground : t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true))),
          // The rail's number says nothing about which agent it is: hover names it.
          `ag-${a.address}`, more ? `${a.space_name} · ${more}` : a.space_name || label(a) || a.address);
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      // Its tooltips stay off while the row's own right-click menu is up (tipOff: the row's id).
      const quiet = this.tipOff === `ag-${a.address}`;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .when(!quiet, (el) => el.tooltip(isPinned ? "Unpin" : "Pin to top"))
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
      const nameLine = h_flex().id(`name-${a.address}`).min_w(0).gap(5).items_center()
        .when(!quiet, (el) => el.tooltip(full && more ? `${name} · ${more}` : String(name || a.address)))
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
          else if (this.hovered === a.address) { this.hovered = null; this.tipOff = null; } // its ⋯ goes, and its tooltip's back next time
          cx.notify();
        })
        .on_click(() => { showTabs(); run("pane.focus", { pane: a.pane }); })
        .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); this.tipOff = `ag-${a.address}`; cx.notify(); this.menuAt(cx, a, full && more ? `${name} · ${more}` : name, a.status, true, null, pressAt(e)); })
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.toggleFold(a.address, cx);
          })).child(pic)))
        .child(stat
          ? this.measured(v_flex().id(`col-${a.address}`).flex_1().min_w(0).gap(2), a.address)
            .child(nameLine).child(this.statLine(t, a, stat, undefined, this.short(a.address, stat)))
          : nameLine.flex_1())
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(this.fold(t, a.address, subs)))
        .when(this.hovered === a.address, el => el.child(pin)
          .child(this.more(t, `more-${a.address}`, (cx, at, press) => this.menuAt(cx, a, full && more ? `${name} · ${more}` : name, a.status, true, at, press), `ag-${a.address}`)))
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
            .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(this.quietTip(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_mouse_down("left", (e) => { this.sortPress = pressAt(e); })
                .on_click((_e, cx) => { this.tipOff = "ag-sort"; openOverlay({ mod: "ws-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true, pointer: this.sortPress ?? null } }); cx.notify(); })
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
              "ag-sort", `Sort agents: ${sort.label}`))
            // + : the + menu with only the agents and presets, starting in the shown space.
            // Not while the workspace has no space: the tab bar's + makes one.
            .when(!shared("workspaces.covered"), (el) => el.child(this.quietTip(
              div()
                .id("ag-new")
                .ml(10)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => { this.tipOff = "ag-new"; openOverlay({ mod: "ws-new-menu", kind: "popup", width: 250, height: 0.85, props: { agentsOnly: true } }); cx.notify(); })
                .child(svg("mods/workspace-chrome/plus.svg").size(14)),
              "ag-new", "Start an agent"))),
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
