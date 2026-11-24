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
// (props { workspace }) it keeps to that workspace. A pane beside the terminals (props
// { beside: true, workspace }) has no title row (Herdr's pane header names it), its
// controls in one slim row; with workspace null it lists every conversation.
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
// Conversations | Automations in the header: the second lists the workspace's automation
// runs (shared "workspaces.automation.runs", published by the switcher's runner), newest
// first, under day headings that count what needs a look ("Yesterday · 1 failed"). Each
// run's grey line is the start of what its agent said last (its report; scan.js reads it
// for Claude, Pi and Antigravity), its state is a word (running, needs you, done, failed,
// nothing to do: the outcome line the runner asks every agent to end with, histfacts.js:
// runState), and its one action is Go to while its tab is open, Resume once it's closed
// (its conversation as the runner noted it, histfacts.js: runSessions). A click opens a
// run: the whole report (scan.js --said), when it ran and for how long, and a way into
// the automation. Runs a check kept from starting are hidden unless asked for.
//
// A Claude, Pi or Antigravity conversation that was compacted shows the compacted icon
// and how often on its row; opened, it lists when (newest first), how, and how big the
// context was before and after, and what's in the context at the end. Neither shows while
// Agent numbers is off in Settings > Features (shared "workspaces.settings"), and an
// opened run has no way into the automation while Automations is off.
//
// Who started whom (treefacts.js): a conversation another agent started (an hc helper)
// or an agent's own sub-agent isn't listed on its own: under its parent's row a quiet line
// ("› 8 helpers  fix-login, review") unfolds them, indented, and so on down. A
// search shows a match under its parent. One whose parent isn't listed stays on its own
// with a "started by …" line. Trees are sorted by their newest activity. Fold state is
// kept in memory only.
//
// A right-click on a row opens its menu (treefacts.js historyMenu()): Resume or Go to,
// Copy session id, Wipe session…. Wipe moves a Claude or Pi conversation to the Trash, as
// the Agents list's Wipe does (menufacts.js, a copy of ws-agents' own: wipeTargets()),
// in a dialog of this mod's (wipeDialog()): it closes the terminal it's known to be open
// in first, refuses while another agent might be writing it (treefacts.js wipeCheck()),
// and offers "Wipe all" for a conversation with helpers. An Antigravity conversation goes
// to the Agents list's own Wipe dialog (agywipe.js), only while that experiment is on.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, terminals, run, theme, shared, setShared, props, openOverlay, closeOverlay,
  home, appHome, exec, notify, checking, knownAgents, readTextFile,
} from "herdr";
import { PROVIDERS, inWorkspace, whereOf, liveOf, keyOf, titleOf, matches, dayLabel, ago, span, modelLabel, resumeArgv, presetOf, tokens, compactionText, compactionsTip, runState, runMatches, runSessions, clock, ranText, READS } from "./histfacts.js";
import { forest, treeRows, chipText, kidNames, indent, historyMenu, wipeCheck, holdState, liveUnder, helpersOf } from "./treefacts.js";
import { menuHeight, wipeTargets } from "./menufacts.js";

const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const KNOWN = "new-menu.agents"; // the agents ws-new-menu last found installed: their icons and run commands
// Shared "workspaces.history.resumed": conversation -> the terminal History resumed it in,
// so it shows as open there (and isn't resumed twice) whichever agent it is.
const RESUMED = "workspaces.history.resumed";
const PAGE = 120; // rows drawn at first, and more with each "Show more"
const REPORT_LINES = 60; // lines of a run's report shown when it's opened
// What a day's heading counts among its runs, and in which color (null: the heading's own).
const LOOK = [["needs you", "blocked"], ["failed", "blocked"], ["failed to start", "blocked"], ["stuck", "blocked"], ["running", null]];
const SPANS = [90, 365, 3650]; // days back: the first read, then each "Look further back"
const STALE = 20e3; // ms after which the screen, shown again, reads again
// A pane beside the terminals narrower than this keeps search in its slim row and folds the
// other filters (scope, agents, folder gone, Refresh) into one strip that scrolls sideways.
const PANE_NARROW = 560;
const FRESH = 45e3; // ms between reads while it stays shown
// Shared "workspaces.history.act": { from, key, action, at }: the right-click menu (a popup
// of its own, whose tasks end when it closes) asks the History it was opened from to
// resume or go to a conversation, or to read again after an Antigravity wipe.
const ACT = "workspaces.history.act";
// Shared "workspaces.history.wiped": { keys, at }: what History's Wipe took, so every
// History reads again, and a helper left behind says it was started by a wiped conversation.
const WIPED = "workspaces.history.wiped";
// Shared "workspaces.history.open": { ws, runId, at, taken? }: the tab bar's bell asks History (the
// switcher shows it first) to show that automation run, open. The screen (or a dialog) of that
// workspace takes it once (taken), within 15s.
const HIST_OPEN = "workspaces.history.open";

// Moves each path given after $1 that's there to the Trash, or into $1 where there's
// no Trash command. The same as ws-agents/main.js' TRASH: change both together.
const TRASH = `
dest=$1; shift
for p in "$@"; do
  [ -e "$p" ] || continue
  if command -v trash >/dev/null 2>&1 && trash "$p"; then echo Trash; continue; fi
  if command -v gio >/dev/null 2>&1 && gio trash "$p"; then echo Trash; continue; fi
  mkdir -p "$dest" && mv "$p" "$dest/$(basename "$p")-$(date +%s)" && echo "$dest" || exit 1
done`;
// Puts $1 on the clipboard (as ws-agents/main.js' COPY).
const COPY = `
if command -v pbcopy >/dev/null 2>&1; then printf %s "$1" | pbcopy
elif command -v wl-copy >/dev/null 2>&1; then printf %s "$1" | wl-copy
elif command -v xclip >/dev/null 2>&1; then printf %s "$1" | xclip -selection clipboard
else echo "no clipboard command (pbcopy, wl-copy, xclip)" >&2; exit 1; fi`;
// When each given transcript was last written (seconds, a tab, the path), after
// "now<tab><seconds>" on the same clock (GNU stat, else BSD's): the newest of it and, for
// Claude, its <id>/subagents/*.jsonl (a sub-agent at work writes only there). A file that
// isn't there prints nothing.
const WRITTEN = `printf "now\\t%s\\n" "$(date +%s)"
at() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }
for f; do
  [ -e "$f" ] || continue
  m=$(at "$f") || continue
  for g in "\${f%.jsonl}"/subagents/*.jsonl; do
    [ -e "$g" ] || continue
    n=$(at "$g") && [ "$n" -gt "$m" ] && m=$n
  done
  printf "%s\\t%s\\n" "$m" "$f"
done
exit 0`;
// Claude's own record of each running process, ~/.claude/sessions/<pid>.json ($1 the
// folder): the pid, its start time as ps says it (UTC, as Claude writes procStart) and the
// file, a line each, for the processes still alive.
const RUNNING = `for f in "$1"/*.json; do
  [ -f "$f" ] || continue
  p=\${f##*/}; p=\${p%.json}
  case "$p" in '' | *[!0-9]*) continue ;; esac
  s=$(LC_ALL=C TZ=UTC ps -o lstart= -p "$p" 2>/dev/null) && [ -n "$s" ] || continue
  printf "%s\\t%s\\t" "$p" "$s"
  tr -d '\\n\\t' < "$f"
  echo
done
exit 0`;
// Each given folder's real path, a line each (itself when it isn't there).
const REAL = 'for d; do (cd "$d" 2>/dev/null && pwd -P) || printf "%s\\n" "$d"; done';
// Agents History's own Wipe takes (menufacts.js wipeTargets()); Antigravity's is the Agents list's.
const WIPES = new Set(["claude", "pi"]);
const AGY_WIPE = "antigravity-wipe"; // its experiment's key in ~/.herdr/settings.jsonc

const defs = () => shared("workspaces.defs") ?? [];
const defOf = (id) => defs().find((d) => d.id === id) ?? null;
const trees = () => `${home()}/.herdr/worktrees`;
const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const base = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();
const message = (e) => String(e?.message ?? e);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// What the switcher takes as a workspace or automation name in a command (automations.js: openAt).
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Whether an add-on is on in Settings > Features (nothing known yet counts as on).
const featureOn = (key) => shared("workspaces.settings")?.features?.[key] !== false;

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

// The Wipe dialog's words about the helpers under a conversation (its own, then all under it).
function helperWords(f, wipeable) {
  const direct = f.direct ?? f.helpers;
  // Each with its title, so a helper that isn't what it seems shows before Wipe all.
  const cut = (t) => (t.length > 34 ? `${t.slice(0, 33).trimEnd()}…` : t);
  const names = direct.slice(0, 6).map((x) => (x.name ? `${x.name} “${cut(x.title)}”` : `“${cut(x.title)}”`)).join(", ") + (direct.length > 6 ? ", …" : "");
  const all = f.helpers.length > direct.length ? `, ${f.helpers.length} conversations under it in all` : "";
  const stay = f.helpers.length - wipeable;
  return `It started ${plural(direct.length, "helper")} (${names})${all}. Wipe leaves them in History, on their own; Wipe all ${wipeable + 1} takes ${wipeable === 1 ? "that one" : "them"} too${stay ? ` (${stay} of another agent stay${stay === 1 ? "s" : ""})` : ""}.`;
}
// The Wipe dialog's height for what it may say: its text, the helpers line, and room for a
// reason it can't (and one for Wipe all). The text scrolls past that, the buttons stay.
function wipeHeight(f) {
  const lines = (text, per) => Math.max(1, Math.ceil(text.length / per));
  let h = 36 + 24 + 12 + 3 * 20 + 8 + 3 * 17 + 14 + 32;
  if (f.helpers.length) h += 8 + lines(helperWords(f, f.helpers.filter((x) => WIPES.has(x.provider)).length), 62) * 18 + 8 + 3 * 17 + 8 + 2 * 17;
  return Math.min(560, h);
}

export default class History extends View {
  init(_props, cx) {
    if (props()?.histMenu || props()?.wipe) return this.initOverlay(props(), cx);
    this.handle = cx.focus_handle();
    this.dialog = Boolean(props()?.dialog);
    // The layout's screen follows the shown workspace; a tab or a dialog keeps what it was opened with.
    this.follow = Boolean(props()?.screen);
    // A pane beside the terminals: Herdr's pane header names it, so no title row of its own.
    this.beside = !this.follow && !this.dialog && Boolean(props()?.beside);
    // A pane opened with no workspace (All spaces) lists every conversation.
    this.workspace = this.beside ? props()?.workspace ?? null : (this.follow ? null : props()?.workspace) ?? shared("workspaces.active") ?? null;
    this.scope = this.workspace ? "ws" : "all";
    this.provider = null; // one agent's conversations, or null for every agent's
    this.gone = false; // also show the ones whose folder is gone
    this.span = 0; // index into SPANS
    this.max = PAGE;
    this.open = null; // the row whose details show (a run's: "run:<id>")
    this.reports = new Map(); // runs' whole reports, by conversation file: { at, said, outcome } or "reading"
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
    this.me = Math.random().toString(36).slice(2); // which History a menu was opened from
    this.unfolded = new Set(); // rows whose children show (keys; a run's by its conversation's)
    this.core = "default";
    this.actAt = shared(ACT)?.at ?? 0;
    this.wipedAt = shared(WIPED)?.at ?? 0;
    this.rescans = []; // times to read again (after handing a wipe to the Agents list)
    this.query = InputState.new({ value: "", placeholder: "Search conversations" });
    this.query.on("change", (_e, cx) => { this.max = PAGE; cx.notify(); });
    // Enter on a search goes to its first result.
    this.query.on("submit", (_e, cx) => { if (this.query.value().trim()) { const first = this.view().shown.find((x) => x.hit && !x.s.readonly); if (first) this.act(first.s, first.at, cx); } });
    this.mode = "conversations"; // or "automations": the runs
    this.hideQuiet = true; // runs a check kept from starting, misses and skips
    this.runQuery = InputState.new({ value: "", placeholder: "Search runs" });
    this.runQuery.on("change", (_e, cx) => { this.max = PAGE; cx.notify(); });
    this.runQuery.on("submit", (_e, cx) => { if (this.runQuery.value().trim()) { const first = this.runsView().shown[0]; if (first) this.runAct(first.r, first.st, cx); } });
    if (checking()) return;
    // A tab or dialog takes the keyboard for its search; a pane beside the terminals only when
    // it's the focused pane (just opened), not when its tab comes back after a start.
    if (!this.follow) { this.load(cx); if (!props()?.beside || panes().find((p) => p.focused)?.mod === "ws-history") this.query.focus(); }
    // Looked at on a timer, not in render: a task started while rendering never gets to run.
    cx.timer.every(this.follow ? 400 : 500, (cx) => {
      const scr = this.follow ? shared("workspaces.screen") ?? null : null;
      const showing = !this.follow || scr?.screen === "history";
      const back = showing && !this.showing;
      this.showing = showing;
      // What this History's right-click menu asked for.
      const asked = shared(ACT);
      if (asked?.at && asked.at !== this.actAt) {
        this.actAt = asked.at;
        if (asked.from === this.me && Date.now() - asked.at < 10000) this.menuAct(asked, cx);
      }
      // A wipe: read again now, or when shown.
      const wiped = shared(WIPED);
      if (wiped?.at && wiped.at !== this.wipedAt) { this.wipedAt = wiped.at; this.readAt = 0; }
      if (this.rescans.length && Date.now() >= this.rescans[0]) { this.rescans.shift(); this.readAt = 0; }
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
      this.runAsked(cx);
      // In place of the terminals, it takes the keyboard from them: typing searches, and
      // mustn't land in a terminal nobody sees.
      if (back) this.input().focus();
    });
  }

  // A run the bell asked for (HIST_OPEN): the Automations side, that run open, quiet runs shown when
  // it's one of them (anything but a started run: a check that failed, a miss, a skip).
  runAsked(cx) {
    const want = shared(HIST_OPEN) ?? null;
    if (!want?.at || want.taken || !(this.follow || this.dialog) || Date.now() - want.at > 15000) return;
    if ((want.ws ?? null) !== (this.workspace ?? null)) return;
    setShared(HIST_OPEN, { ...want, taken: true });
    const r = (shared("workspaces.automation.runs") ?? []).find((x) => x.id === want.runId) ?? null;
    if (this.mode !== "automations") { this.mode = "automations"; this.max = PAGE; }
    if (r && r.status !== "started") this.hideQuiet = false;
    // Nothing in the way of the run: no search left in the box, and its row on the page.
    if (this.runQuery.value()) this.runQuery.set_value("");
    const at = this.runsView().shown.findIndex((x) => x.r.id === want.runId);
    if (at >= this.max) this.max = at + 1;
    this.open = `run:${want.runId}`;
    this.input().focus();
    cx.notify();
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
      this.rows = data.sessions; this.notes = data.notes ?? []; this.error = null; this.core = data.core || "default";
      this.keys = new Set(this.rows.map(keyOf));
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

  // What the list shows now: the rows as trees (treefacts.js), under the filters, and what
  // each is open in. `shown`: the rows to draw in order ({ s, depth, kids, open, hit, at }),
  // `here`: the conversations in the trees shown (sub-agents aside), `searched`: those the
  // search lets through, `hidden`: those whose folder is gone, behind the chip.
  view() {
    const terms = liveTerms();
    // Sub-agents run inside their parent's terminal: never "open" on their own.
    const own = this.rows.filter((s) => !s.readonly);
    const live = liveOf(own, terms, shared(RESUMED) ?? {});
    const q = this.query.value();
    const f = forest(this.rows);
    // A tree whose root's folder is gone still shows while anything in it is open.
    const anyLive = (s) => live.has(keyOf(s)) || (f.kids.get(keyOf(s)) ?? []).some(anyLive);
    const rootOk = (s) => this.gone || !s.gone || anyLive(s);
    const extra = (s) => [presetOf(s), s.helper?.name, s.helper?.preset, s.sub?.type, s.sub ? "sub-agent" : ""].filter(Boolean).join(" ");
    const said = (s) => matches(s, q, extra(s));
    const pass = (s) => said(s) && (!this.provider || s.provider === this.provider);
    const inTrees = [], behind = [];
    const walk = (s, into) => { into.push(s); for (const c of f.kids.get(keyOf(s)) ?? []) walk(c, into); };
    for (const r of f.roots) walk(r, rootOk(r) ? inTrees : behind);
    const here = inTrees.filter((s) => !s.readonly);
    const searched = here.filter(said);
    const filtering = Boolean(q.trim()) || Boolean(this.provider);
    const shown = treeRows(f, { pass, root: rootOk, unfolded: this.unfolded, filtering })
      .map((x) => ({ ...x, hit: pass(x.s), at: x.s.readonly ? null : live.get(keyOf(x.s)) ?? null }));
    return { f, live, here, searched, shown, hidden: behind.filter((s) => !s.readonly).length, status: new Map(terms.map((x) => [x.address, x.status])) };
  }

  // The search box of the list shown.
  input() { return this.mode === "automations" ? this.runQuery : this.query; }

  // The Automations view: the runs of the workspace shown (or of every one), each with
  // its state now (`st`, histfacts.js: runState).
  // `s`: its conversation (runSessions), with what its agent said last.
  runsView() {
    const runs = shared("workspaces.automation.runs") ?? [];
    const all = runs.filter((r) => this.scope === "all" || r.ws === this.workspace);
    const sessions = runSessions(runs, this.rows.filter((s) => !s.readonly));
    const tabs = new Set(spaces().flatMap((x) => (x.tabs ?? []).map((c) => c.id)));
    const terms = new Map(terminals().filter((x) => x.state === "live").map((x) => [String(x.address), x]));
    const rows = all.map((r) => {
      const term = r.terminal ? terms.get(r.terminal) : null;
      // An address can come back for another terminal later: Herdr's tab label tells them apart.
      const mine = Boolean(term) && (!term.labels?.["herdr.tab"] || term.labels["herdr.tab"] === r.tab);
      const s = sessions.get(r.id) ?? null;
      const found = Boolean(s) && !s.stub;
      return { r, s, st: runState(r, { status: mine ? term.status ?? null : null, live: mine, open: Boolean(r.tab && tabs.has(r.tab)), found, said: found ? s.said ?? null : null, outcome: found ? s.outcome ?? null : null }) };
    });
    const q = this.runQuery.value();
    const searched = rows.filter(({ r, s, st }) => runMatches(r, q, `${defOf(r.ws)?.name ?? ""} ${st.word} ${s?.said ?? ""}`));
    const shown = searched.filter(({ st }) => !this.hideQuiet || !st.quiet);
    return { all, searched, shown, quiet: searched.length - shown.length, sessions };
  }

  // A click on a run opens it, and reads its whole report when the row has only its start.
  toggleRun(r, s, cx) {
    const id = `run:${r.id}`;
    this.open = this.open === id ? null : id;
    if (this.open && s && !s.stub && s.saidMore && s.file && READS.has(s.provider)) this.readReport(s, cx);
    cx.notify();
  }

  readReport(s, cx) {
    const had = this.reports.get(s.file);
    if (had === "reading" || (had && had.at === s.updated && !had.failed)) return;
    this.reports.set(s.file, "reading");
    cx.spawn(async (cx) => {
      const r = await node([`${appHome()}/mods/ws-history/scan.js`, "--said", s.provider, s.file]);
      let data = null;
      if (r.code === 0) { try { data = JSON.parse(r.stdout); } catch { data = null; } }
      this.reports.set(s.file, data ? { at: s.updated, said: data.said ?? null, outcome: data.outcome ?? null } : { at: s.updated, said: null, failed: true });
      cx.notify();
    });
  }

  // A run's own action: to its tab while it's open, else its conversation (Go to where
  // it's open now, or Resume).
  runAct(r, st, cx) {
    if (st.open) return this.goToRun(r);
    const own = this.rows.filter((x) => !x.readonly);
    const s = runSessions(shared("workspaces.automation.runs"), own).get(r.id);
    if (!s) return;
    const at = liveOf(own, liveTerms(), shared(RESUMED) ?? {}).get(keyOf(s));
    if (at) this.goTo(at);
    else if (!s.gone) this.resume(s, cx);
  }

  goToRun(r) {
    this.leave();
    if (panes().some((p) => p.terminal === r.terminal)) return run("pane.focus", { terminal: r.terminal });
    if (r.space) run("space.select", { id: r.space });
    run("tab.select", { id: r.tab });
  }

  // The Automations screen, on that automation (the switcher's sidebar copy takes the command).
  openAutomation(r) {
    if (PLAIN.test(String(r.ws)) && PLAIN.test(String(r.name))) run(`ws-switcher.automation/${r.ws}/${r.name}`, {});
    else run("mod.open", { name: "ws-automations" });
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
    // Only the layout's screen gives way; a tab or a pane is already among the terminals.
    if (this.follow && shared("workspaces.screen")) setShared("workspaces.screen", null);
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
    if (props()?.histMenu) return this.menuView(t);
    if (props()?.wipe) return this.wipeDialog(t);
    const def = defOf(this.workspace);
    const shell = v_flex().id("history").size_full().min_h(0).bg(this.dialog ? t.popover : t.canvas).text_size(13).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .when(this.follow, (el) => el.track_focus(this.handle));
    // In a pane beside the terminals there's less room: the rows keep what matters.
    const tight = this.width > 0 && this.width < 720;
    // Between two workspaces (the timer is a moment behind): nothing of the last one.
    if (this.follow && (shared("workspaces.active") ?? null) !== this.workspace) return shell;
    const everywhere = this.scope === "all";
    const autos = this.mode === "automations";
    const { f, here, searched, shown, hidden, status } = this.view();
    const rv = autos ? this.runsView() : null;
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
    // Conversations | Automations: which list shows.
    const side = (id, text, on, mode, tip) => div().id(id).h(22).px(9).flex().flex_none().items_center().rounded(6).text_size(12).cursor_pointer().tooltip(tip)
      .when(on, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
      .when(!on, (el) => el.text_color(t.muted).hover((x) => x.text_color(t.foreground)))
      .on_click((_e, cx) => { if (this.mode === mode) return; this.mode = mode; this.max = PAGE; this.open = null; this.input().focus(); cx.notify(); }).child(text);
    const modes = h_flex().h(26).p(2).gap(2).flex_none().items_center().rounded(8).bg(t.raised)
      .child(side("mode-conv", "Conversations", !autos, "conversations", "Your agents' conversations, with Resume"))
      .child(side("mode-runs", "Automations", autos, "automations", "What the automations ran and what each one said at the end"));
    const counted = autos ? plural(rv.all.length, "run") : this.loaded ? `${plural(here.length, "conversation")}${since}` : "Reading…";
    // Which conversations (the workspace's or every one), and Refresh: in the header, or in a
    // narrow pane's filter strip.
    const scopes = () => (def ? [
      chip("scope-ws", !everywhere, (cx) => this.rescope("ws", cx), [def.name], `What ran in ${def.name}'s folders and worktrees`),
      chip("scope-all", everywhere, (cx) => this.rescope("all", cx), ["Everywhere"], "Every conversation on this computer, whatever folder it ran in"),
    ] : []);
    const refresh = () => button("hist-refresh", "Refresh", (cx) => this.load(cx), { tip: "Read the conversations again" });
    const narrowPane = this.beside && !(this.width >= PANE_NARROW);
    const searchBox = (input) => h_flex().w(tight ? 150 : 240).h(28).px(9).gap(7).flex_none().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
      .when(narrowPane, (el) => el.w_auto().flex_1().min_w(90))
      .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
      .child(Input.new(input).flex_1().min_w(0).text_size(12).text_color(t.foreground));
    // A pane beside the terminals: one slim row (Herdr's pane header names it). Narrow, search
    // takes the room the scope chips and Refresh had; they go to the filter strip below.
    const slim = () => h_flex().min_h(36).flex_none().px(10).py(4).gap(8).items_center().border_b(1).border_color(t.border)
      .child(modes)
      .when(!narrowPane && (!tight || (!autos && !this.loaded)), (el) => el.child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(counted)))
      .when(this.reading && this.loaded, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(13).flex_none().text_color(t.dim).spin(900)))
      .when(!narrowPane, (el) => el.child(div().flex_1()).children(scopes()).child(refresh()))
      .when(narrowPane, (el) => el.child(searchBox(autos ? this.runQuery : this.query)));
    // Tight (a pane beside the terminals), the header wraps rather than lose its chips and Refresh.
    const header = this.beside ? slim() : h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .when(tight, (el) => el.h_auto().min_h(48).py(9).flex_wrap())
      .child(def && !everywhere ? mark(def, t, 20) : svg("mods/ws-history/history.svg").size(16).flex_none().text_color(t.muted))
      .child(div().font_semibold().child(def && !everywhere ? `${def.name} history` : "History"))
      .child(modes)
      .when(!tight || (!autos && !this.loaded), (el) => el.child(div().text_size(12).text_color(t.dim).child(counted)))
      .when(this.reading && this.loaded, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(13).text_color(t.dim).spin(900)))
      .child(div().flex_1())
      .children(this.beside ? [] : scopes())
      .when(!this.beside, (el) => el.child(refresh()));

    if (autos) {
      const filters = h_flex().h(44).flex_none().px(16).gap(10).items_center()
        .when(narrowPane, (el) => el.h(40).px(10))
        .child(h_flex().id("runs-chips").flex_1().min_w(0).h_full().gap(6).items_center().when(narrowPane, (el) => el.overflow_x_scrollbar())
          .when(narrowPane, (el) => el.children(scopes()))
          .child(chip("runs-quiet", this.hideQuiet, () => { this.hideQuiet = !this.hideQuiet; }, ["Hide quiet runs", ...(this.hideQuiet && rv.quiet ? [count(rv.quiet)] : [])],
            "Runs that never started: a check that printed nothing (or the same as before) or failed, a missed schedule, a run skipped while the last one was still working"))
          .when(narrowPane, (el) => el.child(refresh())))
        .when(!narrowPane, (el) => el.child(searchBox(this.runQuery)));
      const live = liveOf(this.rows.filter((s) => !s.readonly), liveTerms(), shared(RESUMED) ?? {});
      // Each day's heading counts what needs a look, in the list as it's filtered.
      const tally = new Map();
      for (const { r, st } of rv.shown) {
        const m = tally.get(dayLabel(r.at, now)) ?? {};
        m[st.word] = (m[st.word] ?? 0) + 1;
        tally.set(dayLabel(r.at, now), m);
      }
      const heading = (label) => {
        const m = tally.get(label) ?? {};
        const parts = LOOK.filter(([w]) => m[w]);
        return h_flex().h(30).mt(4).px(8).gap(6).flex_none().items_end().pb(5).text_size(11.5).text_color(t.dim).child(label)
          .when(parts.length > 0, (el) => el.child(div().child("·"))
            .child(h_flex().gap(4).children(parts.map(([w, tone], i) => div().text_color(tone ? t[tone] : t.dim).child(`${m[w]} ${w}${i < parts.length - 1 ? "," : ""}`)))));
      };
      const kids = [];
      let day = null;
      for (const { r, s: conv, st } of rv.shown.slice(0, this.max)) {
        const label = dayLabel(r.at, now);
        if (label !== day) { day = label; kids.push(heading(label)); }
        // Its conversation's helpers and sub-agents, as in the Conversations list.
        const s = st.open || st.quiet ? null : conv;
        const under = s ? f.kids.get(keyOf(s)) ?? [] : [];
        kids.push(this.item(this.runRow(r, st, conv, live, t, now, everywhere, tight, under), t,
          this.open === `run:${r.id}` ? this.runDetails(r, st, conv, t, now) : null));
        if (under.length && this.unfolded.has(keyOf(s))) {
          for (const x of treeRows({ ...f, roots: [s] }, { unfolded: this.unfolded }).slice(1)) {
            const at = x.s.readonly ? null : live.get(keyOf(x.s)) ?? null;
            kids.push(this.item(this.row(x.s, at, at ? status.get(at) : null, t, now, everywhere ? null : def, tight, x), t,
              this.open === keyOf(x.s) ? this.details(x.s, at, t, x.depth) : null));
          }
        }
      }
      if (rv.shown.length > this.max) {
        kids.push(h_flex().h(40).flex_none().items_center().justify_center()
          .child(button("runs-more", `Show ${Math.min(PAGE, rv.shown.length - this.max)} more`, (cx) => { this.max += PAGE; cx.notify(); })));
      }
      if (!rv.shown.length) {
        kids.push(div().p(16).text_color(t.dim).child(this.runQuery.value().trim() ? "None like that."
          : rv.quiet ? `Only quiet runs: ${plural(rv.quiet, "check")} that kept an automation from starting.`
          : everywhere || !def ? "No automation runs yet." : `No automation runs in ${def.name} yet.`));
      }
      return shell.child(header).child(filters).child(v_flex().id("runs-list").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(16).children(kids));
    }

    const providers = Object.keys(PROVIDERS).filter((k) => searched.some((s) => s.provider === k));
    // The chips scroll sideways when there isn't room; the search box stays in view.
    const filters = h_flex().h(44).flex_none().px(16).gap(10).items_center()
      .when(narrowPane, (el) => el.h(40).px(10))
      .child(h_flex().id("hist-chips").flex_1().min_w(0).h_full().gap(6).items_center().overflow_x_scrollbar()
        .when(narrowPane, (el) => el.children(scopes()))
        .child(chip("p-all", !this.provider, () => { this.provider = null; }, ["All", count(searched.length)]))
        .children(providers.map((k) => chip(`p-${k}`, this.provider === k, () => { this.provider = this.provider === k ? null : k; },
          [this.icon(k, t, 13), this.agent(k)?.name ?? PROVIDERS[k].name, count(searched.filter((s) => s.provider === k).length)])))
        .when(hidden > 0 || this.gone, (el) => el.child(chip("gone", this.gone, () => { this.gone = !this.gone; },
          [this.gone ? "Hide folder gone" : "Folder gone", ...(this.gone ? [] : [count(hidden)])],
          "Conversations whose folder isn't there any more (a removed worktree, a deleted scratch folder). They can be read about here but not resumed.")))
        .when(narrowPane, (el) => el.child(refresh())))
      .when(!narrowPane, (el) => el.child(searchBox(this.query)));

    const kids = [];
    let day = null, drawn = 0;
    const roots = shown.filter((x) => x.depth === 0).length;
    // A tree is listed under the day of its newest activity; the page counts trees.
    for (const x of shown) {
      const { s, at } = x;
      if (x.depth === 0) {
        if (++drawn > this.max) break;
        const label = dayLabel(f.latest.get(keyOf(s)) ?? s.updated, now);
        if (label !== day) { day = label; kids.push(div().h(30).mt(4).px(8).flex().flex_none().items_end().pb(5).text_size(11.5).text_color(t.dim).child(label)); }
      }
      kids.push(this.item(this.row(s, at, at ? status.get(at) : null, t, now, everywhere ? null : def, tight, x), t,
        this.open === keyOf(s) ? this.details(s, at, t, x.depth) : null));
    }
    if (roots > this.max) {
      kids.push(h_flex().h(40).flex_none().items_center().justify_center()
        .child(button("more", `Show ${Math.min(PAGE, roots - this.max)} more`, (cx) => { this.max += PAGE; cx.notify(); })));
    }
    if (this.error) kids.push(div().p(16).text_color(t.blocked).child(this.error));
    else if (this.loaded && !shown.length) {
      kids.push(div().p(16).text_color(t.dim).child(this.query.value().trim() || this.provider ? "None like that."
        : everywhere || !def ? `No conversations${since}.` : `No conversations in ${def.name}${since}.`));
    }
    // The end of what was read: older ones are one more read away.
    if (this.loaded && !this.error && this.span < SPANS.length - 1 && roots <= this.max) {
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

  // `at`: the terminal it's open in now, if any, and `status`, that agent's. `x`: where
  // it sits in its tree ({ depth, kids, open }, treefacts.js treeRows()).
  row(s, at, status, t, now, def, tight, x = { depth: 0, kids: [], open: false }) {
    const key = keyOf(s);
    const preset = presetOf(s) || s.helper?.preset || "";
    const sub = [this.startedBy(s), whereOf(s.cwd, def, home(), trees()), s.branch, s.last ? `last: ${s.last}` : s.title ? s.first : ""].filter(Boolean).join("  ·  ");
    const tag = (text, c, tip) => div().flex_none().h(20).px(6).flex().items_center().rounded(5).bg(t.raised).text_size(11.5).text_color(c)
      .when(Boolean(tip), (el) => el.tooltip(tip)).child(text);
    const name = s.helper?.name || "";
    const act = (id, text, action, tip, solid) => div().id(id).h(24).px(9).flex().flex_none().items_center().rounded(6)
      .text_size(11.5).cursor_pointer().tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(solid, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_medium().hover((x) => x.opacity(0.88)))
      .when(!solid, (el) => el.border_1().border_color(t.input).text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);
    // A row with helpers or sub-agents holds the line that folds them in and out, under its
    // own line, in one highlight.
    const folds = x.kids.length > 0;
    const shell = (folds ? v_flex().pt(4).pb(6) : h_flex().h(s.readonly ? 40 : 46).gap(10).items_center())
      .id(`h-${key}`).pl(8 + indent(x.depth)).pr(8).flex_none().rounded(7).cursor_pointer()
      .when(this.open !== key, (el) => el.hover((el) => el.bg(t.hover)))
      .on_click((_e, cx) => { this.open = this.open === key ? null : key; cx.notify(); })
      .when(!s.readonly, (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(s, at); }));
    const fill = (el) => el
      .child(this.icon(s.provider, t, s.readonly ? 13 : 16))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().min_w(0).gap(7).items_center()
          .when(Boolean(name), (el) => el.child(div().flex_none().max_w(180).truncate().font_medium().text_color(s.gone && !at ? t.muted : t.foreground).child(name)))
          .child(div().flex_1().min_w(0).truncate().text_size(s.readonly ? 12 : 13).text_color(s.gone && !at ? t.muted : name || s.readonly ? t.muted : t.foreground).child(titleOf(s))))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(sub)))
      .when(Boolean(preset) && !tight, (el) => el.child(tag(preset, t.muted, "Started from this agent preset; Resume starts it the same way")))
      .when(Boolean(s.readonly) && !tight, (el) => el.child(tag(s.sub?.type || "sub-agent", t.dim, "The agent's own sub-agent: read here, it can't be resumed on its own")))
      .when(s.via === "app" && !tight, (el) => el.child(tag("app", t.muted, "Started in the agent's desktop app or an editor, not in a terminal. Resume continues it here.")))
      .when(Boolean(at), (el) => el.child(h_flex().flex_none().h(20).px(6).gap(5).items_center().rounded(5).bg(t.raised).text_size(11.5).text_color(t.accent)
        .tooltip(`Open in ${at} now`)
        .child(div().size(6).rounded_full().bg(status ? (t[status] ?? t.idle) : t.idle)).child("open")))
      .when(Boolean(s.gone && !at), (el) => el.child(tag("folder gone", t.dim, `${tilde(s.cwd)} isn't there any more, so it can't be resumed there`)))
      .when(Boolean(s.model) && !tight, (el) => el.child(div().flex_none().max_w(150).truncate().text_size(11.5).text_color(t.dim).child(modelLabel(s.model))))
      .when(s.compactions > 0 && !tight && featureOn("numbers"), (el) => el.child(h_flex().id(`hc-${key}`).flex_none().gap(3).items_center().text_size(11.5).text_color(t.dim)
        .tooltip(compactionsTip(s.compactions, s.compacted?.[s.compacted.length - 1]))
        .child(svg("mods/ws-history/compacted.svg").size(11).text_color(t.dim)).child(String(s.compactions))))
      .child(div().w(30).flex_none().text_size(11.5).text_color(t.dim).child(ago(s.updated, now)))
      .child(h_flex().w(62).flex_none().justify_end()
        .when(Boolean(at), (el) => el.child(act(`go-${key}`, "Go to", () => this.goTo(at), "Show the terminal it's open in")))
        .when(!at && !s.gone && this.starting === key, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Starting…")))
        .when(!at && !s.gone && !s.readonly && this.starting !== key, (el) => el.child(act(`re-${key}`, "Resume", (cx) => this.resume(s, cx), "Continue it in a new tab, in the folder it ran in", true))));
    if (!folds) return fill(shell);
    return shell.child(fill(h_flex().h(s.readonly ? 32 : 38).gap(10).items_center()))
      .child(this.foldLine(`hf-${key}`, key, x.kids, x.open, s.readonly ? 23 : 26, t, "Show the conversations it started"));
  }

  // A row as the list draws it: opened, the row and its details are one piece, the row's
  // highlight holding both.
  item(row, t, details) {
    if (!details) return row;
    return v_flex().flex_none().rounded(7).bg(t.selected).mb(6).child(row).child(details);
  }

  // The quiet line inside a row with helpers or sub-agents, under its own line, from its
  // title's edge (`left`): "› 4 helpers  tree-check, review", which unfolds them; unfolded,
  // the count alone. (A negative margin to pull it up made the row lose its height.)
  foldLine(id, key, kids, open, left, t, tip) {
    const names = open ? "" : kidNames(kids);
    return h_flex().id(id).h(18).ml(left).gap(6).items_center().flex_none().cursor_pointer()
      .text_size(11.5).text_color(t.muted).hover((el) => el.text_color(t.foreground))
      .tooltip(open ? "Fold them away" : tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); if (this.unfolded.has(key)) this.unfolded.delete(key); else this.unfolded.add(key); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none())
      .child(div().flex_none().child(chipText(kids)))
      .when(Boolean(names), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(names)));
  }

  // "started by …" for a row whose parent isn't listed: its title when the reader knew it,
  // a wiped one's word, else its id, short.
  startedBy(s) {
    if (!s.parent || this.keys?.has(s.parent)) return "";
    const id = s.parent.split("/").pop();
    if ((shared(WIPED)?.keys ?? []).some((k) => k.split("/").pop() === id)) return "started by a wiped conversation";
    if (s.parentTitle) return `started by “${s.parentTitle}”`;
    return `started by ${s.parent.split("/").pop().slice(0, 8)}`;
  }

  // One automation run: its name (and workspace, everywhere), the start of what its agent
  // said last (else why it ran), its state, when, and one action: Go to its tab while it's
  // open, else Go to or Resume its conversation. A click opens it (runDetails()). A run
  // that never started is drawn quieter. `s`: its conversation (runsView()).
  runRow(r, st, s, live, t, now, everywhere, tight, under = []) {
    const own = st.open || st.quiet ? null : s; // the conversation Go to and Resume act on
    const at = own ? live.get(keyOf(own)) ?? null : null;
    const opened = this.open === `run:${r.id}`;
    const wsName = everywhere ? defOf(r.ws)?.name ?? r.ws : null;
    const said = s && !s.stub ? s.said ?? "" : "";
    const why = r.note ? `${r.why}. ${r.note}` : r.why;
    // Opened, the report shows whole below: the line says why it ran.
    const sub = opened || st.quiet ? why : st.word === "running" ? `Running since ${clock(r.at)}  ·  ${r.why}` : said || why;
    const act = (id, text, action, tip, solid) => div().id(id).h(24).px(9).flex().flex_none().items_center().rounded(6)
      .text_size(11.5).cursor_pointer().tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(solid, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_medium().hover((x) => x.opacity(0.88)))
      .when(!solid, (el) => el.border_1().border_color(t.input).text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);
    const key = own ? keyOf(own) : null;
    // With helpers, the line that folds them sits under its own, in its highlight.
    const folds = under.length > 0 && Boolean(key);
    const shell = (folds ? v_flex().pt(4).pb(6) : h_flex().h(st.quiet ? 38 : 46).gap(10).items_center())
      .id(`run-${r.id}`).px(8).flex_none().rounded(7).cursor_pointer()
      .when(!opened, (el) => el.hover((x) => x.bg(t.hover)))
      .on_click((_e, cx) => this.toggleRun(r, s, cx));
    const fill = (el) => el
      .child(svg("mods/ws-automations/automations.svg").size(st.quiet ? 13 : 15).flex_none().text_color(st.quiet ? t.dim : t.muted))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().min_w(0).gap(7).items_center()
          .child(div().flex_none().max_w(320).truncate().text_color(st.quiet ? t.muted : t.foreground).text_size(st.quiet ? 12 : 13).child(r.name))
          .when(Boolean(wsName), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(wsName))))
        .child(div().truncate().text_size(11.5).text_color(said && sub === said ? t.muted : t.dim).child(sub)))
      .child(div().flex_none().text_size(11.5).text_color(t[st.tone] ?? t.dim).child(st.word))
      .child(div().w(30).flex_none().text_size(11.5).text_color(t.dim).child(ago(r.at, now)))
      .child(h_flex().w(70).flex_none().gap(6).justify_end()
        .when(st.open, (el) => el.child(act(`rgo-${r.id}`, "Go to", () => this.goToRun(r), "Show its tab", st.word === "needs you")))
        .when(!st.open && Boolean(at), (el) => el.child(act(`rgo-${r.id}`, "Go to", () => this.goTo(at), `Its conversation is open in ${at} now`)))
        .when(!st.open && !at && Boolean(own) && !own.gone && this.starting === key, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Starting…")))
        .when(!st.open && !at && Boolean(own) && !own.gone && this.starting !== key, (el) => el.child(act(`rre-${r.id}`, "Resume", (cx) => this.resume(own, cx),
          r.conv ? "Continue its conversation in a new tab, in the folder it ran in" : "Continue the conversation that ran in its folder then, in a new tab"))));
    if (!folds) return fill(shell);
    return shell.child(fill(h_flex().h(38).gap(10).items_center()))
      .child(this.foldLine(`rf-${r.id}`, key, under, this.unfolded.has(key), 25, t, "Show the conversations its run started"));
  }

  // Under an opened run, inside its highlight: what its agent said last, whole (read with
  // scan.js --said when the row had only its start), when it ran and for how long, its
  // check, its folder, and a way into the automation.
  runDetails(r, st, s, t, now) {
    const line = (label, value) => h_flex().gap(10).items_start()
      .child(div().w(84).flex_none().text_color(t.dim).child(label))
      .child(typeof value === "string" ? div().flex_1().min_w(0).text_color(t.muted).child(value) : value);
    const found = Boolean(s) && !s.stub;
    const whole = found && s.file ? this.reports.get(s.file) : null;
    const reading = whole === "reading";
    const said = whole && !reading && whole.said ? whole.said : found ? s.said ?? null : null;
    const cut = found && s.saidMore && !(whole && !reading && whole.said);
    // A report's paragraphs and list items as lines of their own, at most REPORT_LINES.
    const paras = said ? said.split("\n") : [];
    const report = v_flex().flex_1().min_w(0).gap(2).text_color(t.foreground)
      .children(paras.slice(0, REPORT_LINES).map((p) => (p.trim() ? div().child(p) : div().h(5))))
      .when(paras.length > REPORT_LINES || cut, (el) => el.child(div().text_color(t.dim).child(reading ? "Reading the rest…" : paras.length > REPORT_LINES ? "… the rest is in its conversation" : "…")));
    const automation = div().id(`rau-${r.id}`).h(24).px(9).flex().flex_none().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .border_1().border_color(t.input).text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground)).tooltip(`Open ${r.name} in Automations`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.openAutomation(r); }).child("Open the automation");
    return v_flex().pl(33).pr(8).pt(2).pb(12).gap(7).text_size(12)
      .when(Boolean(said), (el) => el.child(line(st.word === "needs you" ? "It asked" : "It said", report)))
      .child(line(r.status === "started" ? "Ran" : "When", ranText(r, st, s, now)))
      .when(Boolean(r.cmd), (el) => el.child(line("Check", r.cmd)))
      .when(Boolean(r.folder), (el) => el.child(line("Folder", tilde(r.folder))))
      .when(featureOn("automations"), (el) => el.child(h_flex().gap(10).child(div().w(84).flex_none()).child(automation)));
  }

  // Under an opened row, inside its highlight (item()): what was asked first and last,
  // where and when, and the command Resume runs.
  details(s, at, t, depth = 0) {
    const a = this.agent(s.provider);
    const argv = resumeArgv(s, a?.run) ?? [];
    const quote = (w) => (/^[A-Za-z0-9_\/.:=@%+-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);
    const line = (label, text) => h_flex().gap(10).items_start()
      .child(div().w(84).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_color(t.muted).child(text));
    const started = s.helper ? [s.helper.name && `as ${s.helper.name}`, s.helper.preset && `(${s.helper.preset})`].filter(Boolean).join(" ") : "";
    const parent = s.parent ? this.rows.find((x) => keyOf(x) === s.parent) : null;
    return v_flex().pl((s.readonly ? 31 : 34) + indent(depth)).pr(8).pt(2).pb(12).gap(7).text_size(12)
      .when(Boolean(s.parent), (el) => el.child(line(s.readonly ? "Sub-agent of" : "Started by", `${parent ? `“${titleOf(parent)}”` : this.startedBy(s).replace(/^started by /, "")}${started ? `  ${started}` : ""}`)))
      .when(Boolean(s.first), (el) => el.child(line("First asked", s.first)))
      .when(Boolean(s.last), (el) => el.child(line("Last asked", s.last)))
      .child(line("Folder", `${tilde(s.cwd)}${s.branch ? `  (${s.branch})` : ""}${s.gone ? "  ·  gone" : ""}`))
      .child(line("When", span(s.started, s.updated)))
      .when(s.context != null && featureOn("numbers"), (el) => el.child(line("Context", `${tokens(s.context)} tokens at the end`)))
      .when(s.compactions > 0 && featureOn("numbers"), (el) => el.child(h_flex().gap(10).items_start()
        .child(div().w(84).flex_none().text_color(t.dim).child("Compacted"))
        .child(v_flex().flex_1().min_w(0).gap(3).text_color(t.muted)
          .children([...(s.compacted ?? [])].reverse().slice(0, 5).map((c) => div().child(compactionText(c))))
          .when(s.compactions > Math.min(5, s.compacted?.length ?? 0), (el) => el.child(div().text_color(t.dim)
            .child(`${s.compactions === 1 ? "Once" : `${s.compactions} times`} in all`))))))
      .when(Boolean(at), (el) => el.child(line("Open in", at)))
      .when(!s.gone && !at && !s.readonly, (el) => el.child(line("Resume runs", argv.map((w) => (quote(w) === w ? tilde(w) : quote(w))).join(" "))));
  }

  // --- The right-click menu and the Wipe dialog ---

  // A popup or dialog of its own (props histMenu / wipe): nothing of the list.
  initOverlay(p, cx) {
    this.at = 0;
    this.busy = false;
    this.error = null;
    this.hint = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (p.wipe) { this.checks = null; if (!checking()) cx.spawn(async (cx) => { await this.checkWipe(cx); }); }
  }

  // What a row's menu and its Wipe need, worked out here where the list is: the row, the
  // terminal it's open in, the helpers under it, and which terminals hold what.
  openMenu(s, at) {
    const f = forest(this.rows);
    const lean = (x) => ({ provider: x.provider, id: x.id, file: x.file ?? null, cwd: x.cwd, title: titleOf(x), name: x.helper?.name || "", terminal: x.terminal ?? null, gone: Boolean(x.gone), readonly: Boolean(x.readonly), via: x.via ?? "" });
    const agyOn = shared("workspaces.settings")?.experimental?.[AGY_WIPE] === true;
    const wipe = WIPES.has(s.provider) ? wipeTargets({ kind: s.provider, session: s.id, file: s.file }).length > 0
      : s.provider === "antigravity" && agyOn && !at && Boolean(s.file);
    const menu = { from: this.me, key: keyOf(s), row: lean(s), at, gone: Boolean(s.gone), readonly: Boolean(s.readonly), wipe, agy: s.provider === "antigravity",
      helpers: helpersOf(f, s).map(lean), direct: (f.kids.get(keyOf(s)) ?? []).filter((x) => !x.readonly).map(lean), core: this.core };
    openOverlay({ mod: "ws-history", kind: "popup", width: 220, height: menuHeight(historyMenu(menu)), props: { histMenu: menu } });
  }

  // What the menu asked this History for (shared ACT): it can resume, the popup can't.
  menuAct(asked, cx) {
    if (asked.action === "rescan") { const now = Date.now(); this.rescans = [now + 4000, now + 15000, now + 45000]; return; }
    const s = this.rows.find((x) => keyOf(x) === asked.key);
    if (!s) return;
    if (asked.action === "goto" && asked.terminal) return this.goTo(asked.terminal);
    if (asked.action === "resume") this.act(s, liveOf(this.rows.filter((x) => !x.readonly), liveTerms(), shared(RESUMED) ?? {}).get(keyOf(s)) ?? null, cx);
  }

  menuView(t) {
    const f = props().histMenu;
    const items = historyMenu(f);
    return v_flex().id("hist-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % items.length;
        else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
        else if (e.key === "enter") return this.pick(items[this.at], cx);
        else if (e.key === "escape") return closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(f.row.name ? `${f.row.name} · ${f.row.title}` : f.row.title))
      .children(items.map((it, i) => v_flex()
        .when(Boolean(it.sep), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`hm-${it.id}`).h(31).px(8).gap(9).rounded(7).items_center()
          .text_color(it.danger ? t.blocked : t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => this.pick(it, cx))
          .child(svg(it.icon).size(14).flex_none().text_color(it.danger ? t.blocked : t.muted))
          .child(div().flex_1().min_w(0).truncate().child(it.label))
          .when(Boolean(it.hint), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint))))));
  }

  // A menu item. Resume and Go to are the History's it was opened from (shared ACT);
  // Copy runs here and the popup closes after (its tasks end when it does); Wipe opens
  // its dialog, or the Agents list's for Antigravity.
  pick(it, cx) {
    const p = props();
    const f = p.histMenu;
    const done = () => closeOverlay(p.overlay);
    if (!it || this.busy) return;
    switch (it.id) {
      case "resume":
      case "goto":
        setShared(ACT, { from: f.from, key: f.key, action: it.id, terminal: f.at ?? null, at: Date.now() });
        return done();
      case "copy": {
        this.busy = true;
        return cx.spawn(async () => {
          const r = await exec("sh", ["-c", COPY, "sh", f.row.id]).catch((e) => ({ code: 1, stderr: message(e) }));
          if (r?.code !== 0) notify({ title: "Couldn't copy the session id", body: String(r?.stderr ?? "").trim() || "it didn't say why", level: "error" });
          else notify({ title: "Session id copied", body: f.row.id, level: "success", timeout: 2500 });
          done();
        });
      }
      case "wipe":
        done();
        if (f.agy) {
          // The Agents list's Wipe, as it does it (agywipe.js), for a conversation open in no terminal.
          setShared(ACT, { from: f.from, key: f.key, action: "rescan", at: Date.now() });
          return openOverlay({ mod: "ws-agents", kind: "dialog", width: 480, height: 410, props: { wipe: {
            address: null, name: f.row.title, pane: null, tab: null, space: null, status: null, kind: "agy", remote: false,
            session: f.row.id, file: f.row.file, cwd: f.row.cwd, cmd: null, agyWipe: true, agyFresh: true, pid: null } } });
        }
        return openOverlay({ mod: "ws-history", kind: "dialog", width: 480, height: wipeHeight(f), props: { wipe: f } });
    }
  }

  // What stands in the way of wiping each conversation the dialog could take (treefacts.js
  // wipeCheck()), read fresh. For each live terminal running that agent, which conversation
  // it holds (holdState()): Claude's .session note and its status line's stats note
  // (~/.herdr/resume/<core>/<t>.session, ~/.herdr/agents/<core>/<t>.json), Pi's stats note,
  // History's own resume claim; folders by real path; when each transcript was last written;
  // and the live helpers hc ends with a terminal that's closed (`ends`).
  async checkWipe(cx) {
    const f = props().wipe;
    const all = [f.row, ...f.helpers].filter((x) => WIPES.has(x.provider));
    const files = all.map((x) => x.file).filter(Boolean);
    const terms = liveTerms();
    const w = await exec("sh", ["-c", WRITTEN, "sh", ...files], { timeout: 10000 }).catch(() => null);
    let now = Date.now();
    const written = new Map();
    for (const l of String(w?.stdout ?? "").split("\n")) {
      const i = l.indexOf("\t");
      if (i < 0) continue;
      const n = Number(l.slice(0, i)) * 1000, rest = l.slice(i + 1);
      if (!Number.isFinite(n)) { if (l.startsWith("now\t")) now = Number(rest) * 1000 || now; continue; }
      written.set(rest, n);
    }
    const dirs = [...new Set([...all.map((x) => x.cwd), ...terms.map((x) => x.cwd)].filter(Boolean))];
    const rp = dirs.length ? await exec("sh", ["-c", REAL, "sh", ...dirs], { timeout: 10000 }).catch(() => null) : null;
    const reals = String(rp?.stdout ?? "").split("\n");
    const real = new Map(dirs.map((d, i) => [d, rp?.code === 0 && reals[i] ? reals[i] : d]));
    const core = /^[A-Za-z0-9._-]+$/.test(f.core ?? "") ? f.core : "default";
    const claims = Object.entries(shared(RESUMED) ?? {});
    const idOf = (v) => (typeof v === "string" && /^[0-9A-Za-z-]+$/.test(v) ? v : null);
    // Every running Claude, by Claude's own record (pid reused by another program: left out).
    const procs = new Map(); // session id -> pids
    const ran = await exec("sh", ["-c", RUNNING, "sh", `${home()}/.claude/sessions`], { timeout: 10000 }).catch(() => null);
    const norm = (x) => String(x ?? "").replace(/\s+/g, " ").trim();
    for (const l of String(ran?.stdout ?? "").split("\n")) {
      const [pid, started, json] = l.split("\t");
      let j = null;
      try { j = JSON.parse(json ?? ""); } catch { j = null; }
      const sid = idOf(j?.sessionId);
      if (!sid || (j.procStart && norm(j.procStart) !== norm(started))) continue;
      if (!procs.has(sid)) procs.set(sid, []);
      procs.get(sid).push(Number(pid));
    }
    // Each Claude or Pi terminal: the program running there now (hc's foreground pid, 3 s
    // at most), and what's noted for it.
    const facts = new Map();
    for (const term of terms) {
      if (term.program !== "claude" && term.program !== "pi") continue;
      const got = await exec("hc", ["get", term.address, "--json"], { timeout: 3000 }).catch(() => null);
      let pid = null;
      try { pid = JSON.parse(got?.stdout ?? "")?.foreground?.pid ?? null; } catch { pid = null; }
      let note = null, stats = null, statsPid = null, running = null;
      if (term.program === "claude") {
        note = idOf(String(await readTextFile(`${home()}/.herdr/resume/${core}/${term.address}.session`).catch(() => "")).split("\n")[0].trim());
        if (pid) { try { running = idOf(JSON.parse(await readTextFile(`${home()}/.claude/sessions/${pid}.json`))?.sessionId); } catch { running = null; } }
      }
      try {
        const j = JSON.parse(await readTextFile(`${home()}/.herdr/agents/${core}/${term.address}.json`));
        stats = idOf(j?.status?.session_id);
        statsPid = j?.pid ?? null;
      } catch { stats = null; }
      facts.set(term.address, { pid, note, stats, statsPid, running, claims: claims.filter(([, a]) => a === term.address).map(([k]) => k) });
    }
    const everyone = terminals();
    const checks = new Map();
    let gone = false;
    for (const x of all) {
      const k = `${x.provider}/${x.id}`;
      const program = PROVIDERS[x.provider]?.program;
      let open = null;
      const maybe = [], others = [];
      for (const term of terms) {
        if (term.program !== program) continue;
        const h = facts.get(term.address) ?? {};
        const claim = (h.claims ?? []).includes(k) ? x.id : null;
        const st = holdState(x.provider, x.id, { pid: h.pid, running: h.running, note: h.note, stats: h.stats, statsPid: h.statsPid, claim });
        if (st === "exact") open = term.address; // wherever its folder is now
        else if (st === "maybe") maybe.push(term.address);
        else if (st === "unknown" && (real.get(term.cwd) ?? term.cwd) === (real.get(x.cwd) ?? x.cwd)) others.push(term.address);
      }
      // A running Claude with it open that isn't the one in `open`.
      const mine = open ? facts.get(open)?.pid : null;
      const outside = x.provider === "claude" ? (procs.get(x.id) ?? []).filter((p) => String(p) !== String(mine)) : [];
      const missing = Boolean(x.file) && w?.code === 0 && !written.has(x.file);
      if (missing) gone = true;
      const targets = wipeTargets({ kind: x.provider, session: x.id, file: x.file });
      const check = wipeCheck(x, { targets, open, maybe, others, procs: outside, missing, written: written.get(x.file) ?? null, now, name: PROVIDERS[x.provider]?.name, app: x.via === "app" });
      checks.set(k, { x, targets, ends: check.ok && check.close ? liveUnder(check.close, everyone) : [], ...check });
    }
    // Something here is gone already: every History reads again.
    if (gone && !this.toldGone) { this.toldGone = true; setShared(WIPED, { keys: shared(WIPED)?.keys ?? [], at: Date.now() }); }
    this.checks = checks;
    cx.notify();
    return checks;
  }

  // What Wipe all would end besides what it wipes: the live helpers under the terminals it
  // closes that aren't among them.
  allEnds(checks, keys) {
    const list = keys.map((k) => checks.get(k)).filter((x) => x?.ok);
    const closing = new Set(list.map((x) => x.close).filter(Boolean));
    const seen = new Set();
    return list.flatMap((x) => x.ends).filter((e) => !closing.has(e.address) && !seen.has(e.address) && seen.add(e.address));
  }

  wipeDialog(t) {
    const f = props().wipe;
    const c = this.checks?.get(f.key) ?? null;
    const wipeable = f.helpers.filter((x) => WIPES.has(x.provider));
    const helperChecks = wipeable.map((x) => this.checks?.get(`${x.provider}/${x.id}`)).filter(Boolean);
    const blockedHelper = helperChecks.find((x) => !x.ok);
    const who = (list) => list.map((e) => (e.name ? `${e.name} (${e.address})` : e.address)).join(", ");
    // Closing an open conversation's terminal ends its running helpers too (hc).
    const ends = c?.ok ? c.ends : [];
    const allEnds = this.checks ? this.allEnds(this.checks, [f.key, ...wipeable.map((x) => `${x.provider}/${x.id}`)]) : [];
    const opens = [c, ...helperChecks].filter((x) => x?.ok && x.close).length;
    const what = f.row.provider === "pi" ? "its session file" : "its transcript and what Claude keeps beside it";
    // danger: filled red; more: red words on the plain button (Wipe all, the bigger step, isn't the default).
    const button = (id, label, kind, action, off) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(kind ? t.blocked : t.input).bg(kind === "danger" ? t.blocked : t.raised)
      .text_color(kind === "danger" ? "#ffffff" : kind === "more" ? t.blocked : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(this.busy || off, (el) => el.opacity(0.5)).hover((el) => el.opacity(0.88)).on_click(action).child(label);
    const enter = (cx) => this.doWipe(false, cx);
    const line = (text, color, size = 11.5) => div().pt(8).text_size(size).text_color(color).child(text);
    return v_flex().id("hist-wipe").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter") enter(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().flex_none().items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(`Wipe “${f.row.title}”?`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      // What it says scrolls when it's more than the dialog holds; the buttons stay.
      .child(v_flex().id("hist-wipe-text").flex_1().min_h(0).overflow_y_scrollbar()
        .child(div().pt(12).text_color(t.muted).child(`Moves this conversation to the Trash (${what}), so History won't list it and it can't be resumed.${c?.ok && c.close ? ` It's open in ${c.close}: Wipe closes that first.` : ""}`))
        .when(f.helpers.length > 0, (el) => el.child(line(`${helperWords(f, wipeable.length)}${opens > (c?.close ? 1 : 0) ? " Wipe all closes the ones that are open." : ""}`, t.muted, 12)))
        .when(!this.checks && !this.error, (el) => el.child(line("Looking at what has it open…", t.dim)))
        .when(Boolean(c) && !c.ok && !this.error, (el) => el.child(line(`Can't wipe it now: ${c.why}`, t.blocked)))
        .when(ends.length > 0 && !this.error, (el) => el.child(line(`Closing ${c.close} would also end ${who(ends)}, still running, so Wipe waits until they're done${wipeable.length ? "; Wipe all wipes the ones History lists here too" : ""}.`, t.blocked)))
        .when(Boolean(blockedHelper) && c?.ok && !this.error, (el) => el.child(line(`Wipe all can't go on: ${blockedHelper.x.name || blockedHelper.x.title}: ${blockedHelper.why}`, t.muted)))
        .when(wipeable.length > 0 && allEnds.length > 0 && !blockedHelper && c?.ok && !this.error, (el) => el.child(line(`Wipe all also ends ${who(allEnds)}, still running (their conversations stay).`, t.muted)))
        .when(Boolean(this.error), (el) => el.child(line(this.error, t.blocked))))
      .child(h_flex().flex_none().pt(14).gap(8).justify_end()
        .child(button("hist-wipe-cancel", "Cancel", null, () => closeOverlay(props().overlay), false))
        .when(wipeable.length > 0, (el) => el.child(button("hist-wipe-all", this.busy ? "Wiping…" : `Wipe all ${wipeable.length + 1}`, "more", (_e, cx) => this.doWipe(true, cx), !c?.ok || Boolean(blockedHelper))))
        .child(button("hist-wipe-go", this.busy ? "Wiping…" : "Wipe", "danger", (_e, cx) => this.doWipe(false, cx), !c?.ok || ends.length > 0)));
  }

  // Looks again (what has it open may have changed while the dialog was open), closes the
  // terminals that hold what it takes (helpers first), then moves the files to the Trash,
  // says where they went and has every History read again. A single Wipe of a conversation
  // whose terminal has live helpers refuses: closing it would end them (hc).
  doWipe(all, cx) {
    const p = props();
    const f = p.wipe;
    if (this.busy || !this.checks) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const shownChecks = this.checks;
        const checks = await this.checkWipe(cx);
        const keys = [f.key, ...(all ? f.helpers.filter((x) => WIPES.has(x.provider)).map((x) => `${x.provider}/${x.id}`) : [])];
        // Helpers started since the dialog showed what Wipe all ends: show them first.
        if (all) {
          const shown = new Set(this.allEnds(shownChecks, keys).map((e) => e.address));
          const fresh = this.allEnds(checks, keys).filter((e) => !shown.has(e.address));
          if (fresh.length) throw new Error(`${fresh.map((e) => e.name || e.address).join(", ")} started since this opened and would end too. It's in the list now: press Wipe all again to go on`);
        }
        const list = keys.map((k) => checks.get(k)).filter(Boolean);
        const no = list.find((x) => !x.ok);
        if (!list.length || no) throw new Error(no ? `${no.x === f.row ? "" : `${no.x.name || no.x.title}: `}${no.why}` : "there's nothing to wipe");
        const main = checks.get(f.key);
        if (!all && main.ends.length) throw new Error(`closing ${main.close} would also end ${main.ends.map((e) => e.name || e.address).join(", ")}, still running`);
        // Ended first, so they can't write to their transcripts again.
        const live = (address) => terminals().some((x) => x.address === address && x.state === "live");
        for (const x of [...list].reverse()) {
          if (!x.close) continue;
          const pane = panes().find((q) => q.terminal === x.close)?.pane ?? null;
          if (live(x.close)) run("terminal.kill", { terminal: x.close });
          for (let i = 0; i < 40 && live(x.close); i++) await exec("sleep", ["0.15"]);
          if (live(x.close)) throw new Error(`${x.close} is still running, so nothing was wiped`);
          if (pane && panes().some((q) => q.pane === pane)) run("pane.close", { pane });
        }
        const r = await exec("sh", ["-c", TRASH, "sh", `${home()}/.herdr/trash`, ...list.flatMap((x) => x.targets)]);
        if (r.code !== 0) throw new Error(String(r.stderr ?? "").trim() || "moving it to the Trash failed");
        const elsewhere = String(r.stdout ?? "").split("\n").map((l) => l.trim()).find((l) => l && l !== "Trash");
        const more = list.length > 1 ? ` and ${plural(list.length - 1, "helper")}` : "";
        notify({ title: `Wiped “${f.row.title}”${more}`, body: elsewhere ? `${list.length > 1 ? "Their conversations are" : "Its conversation is"} in ${tilde(elsewhere)}.` : `${list.length > 1 ? "Their conversations are" : "Its conversation is"} in the Trash.`, level: "success" });
        const before = shared(WIPED)?.keys ?? [];
        setShared(WIPED, { keys: [...new Set([...before, ...keys])].slice(-200), at: Date.now() });
        closeOverlay(p.overlay);
      } catch (e) {
        this.busy = false;
        this.error = `Couldn't wipe it: ${message(e)}`;
        cx.notify();
      }
    });
  }
}
