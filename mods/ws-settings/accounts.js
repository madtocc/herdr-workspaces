// Settings > Accounts (ws-settings): the accounts each agent can start on, in one aligned list
// (Claude's, then Codex's, then Antigravity's; an agent that isn't installed is left out; a line
// where the agent changes). Each row: the agent's icon, the account (its name, else its email, the
// plan dim, "Default" on the one new agents start on), its most-used limit as a meter and %, when
// that resets, and a ⋯ menu (a named account's email first, then Make default, Rename…, Sign in
// again, Sign out…, Remove…). The columns have fixed widths and the page a maximum width, so the
// numbers stay next to the names on a wide window.
// While a background sign-in waits, its row has Copy link: the link the CLI gave the browser
// (herdr-ws-account keeps it in the account's .signin-url, read here every second), to paste into
// another browser; "Copied" for 2 s after.
// "Add account ▾" asks which agent, makes the account (`prepare`) and signs in in the background
// (`signin`: the browser opens, the row waits with Cancel; the window stays). Antigravity's waits
// 60 s for the browser: timed out, the row says so with Try again and "Sign in in a terminal",
// a terminal tab running `herdr-ws-account login` (also what a CLI that needs typed input gets);
// the window closes so the tab is seen, the row waits (shared "workspaces.accounts.waiting") until
// it's signed in or 15 minutes pass, and the tab, once signed in, closes itself and opens this
// page again. A signed-in Antigravity account with no email yet gets it from a hidden run of agy
// (`identify agy <id> --due`: its start banner) when the page loads, at most once an hour.
//
// Everything goes through ws-switcher's herdr-ws-account (one JSON line per command; CONTRACT in
// the accounts build notes). Loading: `list --cached` at once, then `list` (each CLI's status),
// then `usage` per signed-in account, in parallel, each redrawn as it lands; again when the page
// is shown, never faster than USAGE_AGE for usage. Nothing here waits in render: every call runs
// in cx.spawn. The rules (what a row says, the menu, the asks) are in accountfacts.js.
//
// Popups, the inline rename and the inline asks use the window's `picking` ("wsx-acc-…"), so
// Escape, a section change and another popup close them as they close the font lists.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Popup, InputState, Input } from "gpui-base";
import { theme, shared, setShared, home, appHome, run, notify, props, closeOverlay, spaces, terminals, readTextFile, window } from "herdr";
import { exec } from "./posix.js";
import * as fs from "fs/promises";
import {
  TITLES, USAGE_AGE, LIST_AGE, key as akey, parseAnswer, groupsOf, rowsOf, addChoices, rowView, BUSY_WORDS,
  menuItems, signinTab, removeWords, signoutWords, nextDefault, countOn, withUsage, withDefault, withName, usageDue, stillWaiting,
  identifyDue, withIdentity, signinUrlFile, signinUrlOf, signinAskFile, askOf, codeView,
} from "./accountfacts.js";

const WAITING = "workspaces.accounts.waiting";
const ADD_PICK = "wsx-acc-add";
const RENAME = "wsx-acc-rename";
const ASK = "wsx-acc-ask";
const menuPick = (k) => `wsx-acc-menu:${k}`;
const accountBin = () => `${appHome()}/mods/ws-switcher/bin/herdr-ws-account`;
const errMsg = (e) => String(e?.message ?? e);

// herdr-ws-account under Herdr's own home (the sandbox's in the sandbox), its answer parsed.
async function call(args, timeout = 30000) {
  const win = window()?.platform === "windows";
  const r = await (win ? exec(accountBin(), args, { timeout }) : exec("env", [`HOME=${home()}`, accountBin(), ...args], { timeout }))
    .catch((e) => ({ code: 1, stdout: "", stderr: errMsg(e) }));
  return parseAnswer(r);
}

// The page's state, on the window's view (view.wsx.acc). From packageInit.
export function accountsInit(view, cx) {
  const acc = {
    list: null, // herdr-ws-account list's answer, with what came after merged in
    listedAt: 0, // when the last full `list` landed
    listing: false, // a full `list` running
    error: null, // why the list couldn't be read
    gen: 0, // counts changes made here, so a `list` started before one is dropped
    reading: {}, // "<agent>:<id>": a usage read running
    signing: {}, // "<agent>:<id>": { isNew, url? }: a background sign-in running (url: its link, once known)
    copied: null, // { k, at }: Copy link was just clicked on that row
    failed: {}, // "<agent>:<id>": { isNew, timedOut, offer }: a background sign-in that ended without one
    identifying: {}, // "<agent>:<id>": an Antigravity email run asked on this page (once per showing of the window)
    busy: {}, // "<agent>:<id>": what runs on the row (BUSY_WORDS)
    adding: false, // Add account's prepare running
    rename: null, // { agent, id } while its name is being changed
    ask: null, // { agent, id, op: "remove" | "signout", on } while asking
    closedAt: 0, // when a popup closed from a press outside it (its trigger's click then doesn't reopen it)
    renameInput: InputState.new({ value: "", placeholder: "" }),
    renameFocused: false,
    // Antigravity's code from the browser, for the one sign-in that asks for it (codeFor: its key).
    codeInput: InputState.new({ value: "", placeholder: "Paste the code from the browser" }),
    codeFocused: false,
    codeFor: null,
  };
  acc.codeInput.on("focus", (_e, cx) => { acc.codeFocused = true; cx.notify(); });
  acc.codeInput.on("blur", (_e, cx) => { acc.codeFocused = false; cx.notify(); });
  acc.codeInput.on("submit", (_e, cx) => { if (acc.codeFor) submitCode(view, acc.codeFor, cx); });
  acc.renameInput.on("focus", (_e, cx) => { acc.renameFocused = true; cx.notify(); });
  acc.renameInput.on("blur", (_e, cx) => { acc.renameFocused = false; cx.notify(); });
  acc.renameInput.on("submit", (_e, cx) => saveRename(view, cx));
  view.wsx.acc = acc;
}

// The page was shown (or the window opened on it): read what's due. Usage again every USAGE_AGE
// while it stays shown (from packageInit's timer).
export function accountsShown(view, cx) {
  const acc = view.wsx?.acc;
  if (!acc) return;
  cx.spawn(async (cx) => {
    if (!acc.list) await readCached(acc);
    cx.notify();
    if (Date.now() - acc.listedAt >= LIST_AGE) await readFull(acc, cx);
    readUsages(acc, cx);
    readIdentities(acc, cx);
  });
}

// Antigravity accounts signed in without an email: the hidden run reads it (the CLI keeps it to
// once an hour per account, --due), each in its own task. force: the one named, now.
function readIdentities(acc, cx, only = null) {
  for (const { agent, id } of only ? [only] : identifyDue(acc.list, acc.identifying)) {
    const k = akey(agent, id);
    if (acc.identifying[k] === "running") continue;
    acc.identifying[k] = "running";
    cx.spawn(async (cx) => {
      const r = await call(["identify", agent, id, ...(only ? [] : ["--due"])], 120000);
      acc.identifying[k] = "done";
      if (r.value?.email) acc.list = withIdentity(acc.list, agent, id, r.value);
      cx.notify();
    });
  }
}

async function readCached(acc) {
  const gen = acc.gen;
  const r = await call(["list", "--cached"], 15000);
  if (r.value && acc.gen === gen) { acc.list = r.value; acc.error = null; }
  else if (r.error && !acc.list) acc.error = r.error;
}

async function readFull(acc, cx) {
  if (acc.listing) return;
  acc.listing = true;
  cx.notify();
  const gen = acc.gen;
  const r = await call(["list"], 90000);
  acc.listing = false;
  if (r.value && acc.gen === gen) { acc.list = keepTops(r.value, acc.list); acc.listedAt = Date.now(); acc.error = null; }
  else if (r.value) await readCached(acc); // a change landed meanwhile: the store as it is now
  else if (r.error && !acc.list) acc.error = r.error;
  cx.notify();
}

// A full list carries the cached tops already; a usage read that landed while it ran is kept.
function keepTops(next, prev) {
  if (!prev?.agents) return next;
  let out = next;
  for (const [agent, g] of Object.entries(prev.agents)) {
    for (const a of g.accounts ?? []) {
      const n = out.agents?.[agent]?.accounts?.find((x) => x.id === a.id);
      if (n && a.usageAt && (!n.usageAt || a.usageAt > n.usageAt) && n.signedIn !== false) {
        out = withUsage(out, { agent, id: a.id, top: a.top }, a.usageAt);
      }
    }
  }
  return out;
}

// usage for every signed-in account that's due (force: the one named, now), each in its own task.
function readUsages(acc, cx, only = null) {
  const due = only ? [only] : usageDue(acc.list);
  for (const { agent, id } of due) {
    const k = akey(agent, id);
    if (acc.reading[k]) continue;
    acc.reading[k] = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await call(["usage", agent, id], 120000);
      delete acc.reading[k];
      if (r.value) acc.list = withUsage(acc.list, { ...r.value, agent, id });
      cx.notify();
    });
  }
}

// After a change made here: the store as it is now (fast), and nothing older lands over it.
async function afterChange(acc) {
  acc.gen += 1;
  await readCached(acc);
}

// --- actions ---

function closePicking(view, cx) {
  view.picking = null;
  view.handle?.focus();
  cx.notify();
}

function setDefault(view, agent, id, cx) {
  const acc = view.wsx.acc, k = akey(agent, id);
  acc.busy[k] = "default";
  acc.list = withDefault(acc.list, agent, id);
  acc.gen += 1;
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await call(["default", agent, id]);
    if (r.error) notify({ title: "Couldn't make it the default", body: r.error, level: "error" });
    delete acc.busy[k];
    await afterChange(acc);
    cx.notify();
  });
}

function startRename(view, agent, a, cx) {
  const acc = view.wsx.acc;
  acc.rename = { agent, id: a.id };
  acc.ask = null;
  view.picking = RENAME;
  const name = a.name ?? "";
  acc.renameInput.set_value(name);
  acc.renameInput.set_placeholder?.(a.email ? `Empty: called ${a.email}` : "A name for it");
  if (name) acc.renameInput.set_selected_range({ start: 0, end: encodeURIComponent(name).replace(/%[0-9A-F]{2}/g, "_").length });
  acc.renameFocused = true;
  acc.renameInput.focus();
  cx.notify();
}

function saveRename(view, cx) {
  const acc = view.wsx.acc, edit = acc.rename;
  if (!edit || view.picking !== RENAME) return;
  const name = String(acc.renameInput.value() ?? "").trim();
  const k = akey(edit.agent, edit.id);
  acc.rename = null;
  acc.busy[k] = "rename";
  acc.list = withName(acc.list, edit.agent, edit.id, name);
  acc.gen += 1;
  closePicking(view, cx);
  cx.spawn(async (cx) => {
    const r = await call(["rename", edit.agent, edit.id, ...(name ? [name] : [])]);
    if (r.error) notify({ title: "Couldn't rename it", body: r.error, level: "error" });
    delete acc.busy[k];
    await afterChange(acc);
    cx.notify();
  });
}

// Remove… and Sign out… ask in a box under the row first; the count of agents on it comes a
// moment later (the launcher's notes, for terminals still live).
function startAsk(view, agent, id, op, cx) {
  const acc = view.wsx.acc;
  acc.ask = { agent, id, op, on: null };
  acc.rename = null;
  view.picking = ASK;
  view.handle?.focus();
  cx.notify();
  cx.spawn(async (cx) => {
    const on = await agentsOn(agent, id).catch(() => null);
    if (acc.ask?.agent === agent && acc.ask?.id === id) { acc.ask.on = on; cx.notify(); }
  });
}

// ~/.herdr/accounts/on/<core>/<terminal> = "<agent> <id>", for every agent the launcher started
// on an account; only live terminals here count.
async function agentsOn(agent, id) {
  const dir = `${home()}/.herdr/accounts/on`;
  const notes = [];
  for (const core of await fs.readdir(dir).catch(() => [])) {
    for (const t of await fs.readdir(`${dir}/${core}`).catch(() => [])) {
      notes.push({ core, terminal: t, text: (await readTextFile(`${dir}/${core}/${t}`).catch(() => "")) ?? "" });
    }
  }
  const live = new Set((terminals() ?? []).filter((k) => k.state === "live").map((k) => k.address));
  return countOn(notes, live, agent, id);
}

function confirmAsk(view, cx) {
  const acc = view.wsx.acc, ask = acc.ask;
  if (!ask || view.picking !== ASK) return;
  const k = akey(ask.agent, ask.id);
  acc.ask = null;
  acc.busy[k] = ask.op;
  closePicking(view, cx);
  cx.spawn(async (cx) => {
    const r = await call([ask.op, ask.agent, ask.id], 60000);
    if (r.error) notify({ title: ask.op === "remove" ? "Couldn't remove it" : "Couldn't sign out", body: r.error, level: "error" });
    else if (ask.op === "remove") { dropWaiting(k); delete acc.failed[k]; }
    delete acc.busy[k];
    await afterChange(acc);
    cx.notify();
  });
}

// Add account: the agent picked → a new account (prepare) → its sign-in.
function addAccount(view, agent, cx) {
  const acc = view.wsx.acc;
  closePicking(view, cx);
  if (acc.adding) return;
  acc.adding = agent;
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await call(["prepare", agent]);
    acc.adding = false;
    if (r.error || !r.value?.id) {
      notify({ title: `Couldn't add a ${TITLES[agent]} account`, body: r.error ?? "No account id came back.", level: "error" });
      cx.notify();
      return;
    }
    const id = String(r.value.id);
    // The new row shows as signing in at once (before the list has it).
    acc.signing[akey(agent, id)] = { isNew: true };
    await afterChange(acc);
    cx.notify();
    signIn(view, agent, id, true, cx);
  });
}

// Sign in (a signed-out row), Sign in again (the menu) or a new account's: in the background, the
// row waiting with Cancel; a terminal tab when the CLI needs typed input.
function signIn(view, agent, id, isNew, cx) {
  const acc = view.wsx.acc, k = akey(agent, id);
  const mine = { isNew };
  acc.signing[k] = mine;
  delete acc.failed[k];
  cx.notify();
  // Its link, and (Antigravity) whether it waits for the code from the browser, read every second
  // while this sign-in waits. The code field takes the focus when it first shows.
  const poll = (cx) => {
    if (acc.signing[k] !== mine) return;
    cx.spawn(async (cx) => {
      const url = signinUrlOf(await readTextFile(signinUrlFile(home(), agent, id)).catch(() => null));
      const ask = agent === "agy" ? askOf(await readTextFile(signinAskFile(home(), agent, id)).catch(() => null)) : null;
      if (acc.signing[k] !== mine) return;
      if (url !== (mine.url ?? null)) { mine.url = url; cx.notify(); }
      if (ask !== (mine.ask ?? null)) {
        if (ask && !mine.ask && acc.codeFor !== k) { acc.codeFor = k; acc.codeInput.set_value(""); acc.codeInput.focus(); }
        if (ask === "wrong") mine.codeError = null;
        mine.ask = ask;
        cx.notify();
      }
      cx.timer.after(1000, poll);
    });
  };
  cx.timer.after(700, poll);
  cx.spawn(async (cx) => {
    const r = await call(["signin", agent, id], 595000);
    const was = acc.signing[k];
    delete acc.signing[k];
    if (acc.codeFor === k) acc.codeFor = null;
    const v = r.value;
    if (v?.terminal && Array.isArray(v.command)) {
      openTerminal(view, agent, id, v.command, isNew);
    } else if (v?.cancelled || !was) {
      // Cancelled here (Cancel already redrew the row).
    } else if (v && !v.ok && (v.timedOut || Array.isArray(v.offer))) {
      // Antigravity's 60 s ran out (or it wanted a pasted code): the row says so and offers again.
      acc.failed[k] = { isNew, timedOut: Boolean(v.timedOut), offer: Array.isArray(v.offer) ? v.offer : null };
    } else if (r.error) {
      notify({ title: `Couldn't sign in to ${TITLES[agent]}`, body: r.error, level: "error" });
    } else if (!v?.ok) {
      notify({ title: "Not signed in", body: `The ${TITLES[agent]} sign-in ended without an account. Sign in again from its row.`, level: "warning" });
    }
    await afterChange(acc);
    if (v?.ok) readUsages(acc, cx, { agent, id });
    if (v?.ok && agent === "agy" && !v.email && id !== "main") readIdentities(acc, cx, { agent, id });
    cx.notify();
  });
}

// The terminal tab for a sign-in that needs typed input: `herdr-ws-account login <agent> <id>` by
// its full path, in the shown space; the window closes so the tab is seen, and the row waits.
function openTerminal(view, agent, id, command, isNew) {
  delete view.wsx.acc.failed[akey(agent, id)];
  const argv = [accountBin(), ...command.slice(1).map(String)];
  run("tab.new", { name: signinTab(agent), space: spaces().find((s) => s.active)?.id, argv });
  const now = Date.now();
  const waiting = stillWaiting(shared(WAITING), null, now);
  setShared(WAITING, { ...waiting, [akey(agent, id)]: { at: now, isNew: Boolean(isNew) } });
  if (props()?.overlay) closeOverlay(props().overlay);
}

function dropWaiting(k) {
  const w = shared(WAITING);
  if (w && typeof w === "object" && w[k]) {
    const next = { ...w };
    delete next[k];
    setShared(WAITING, next);
  }
}

// Cancel on a signing-in or waiting row: stops the sign-in; a new account is dropped with it.
function cancelSignIn(view, agent, id, isNew, cx) {
  const acc = view.wsx.acc, k = akey(agent, id);
  delete acc.signing[k];
  delete acc.failed[k];
  dropWaiting(k);
  if (isNew) acc.busy[k] = "remove";
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await call(["cancel", agent, id, ...(isNew ? ["--drop"] : [])], 60000);
    if (r.error) notify({ title: "Couldn't cancel the sign-in", body: r.error, level: "error" });
    delete acc.busy[k];
    await afterChange(acc);
    cx.notify();
  });
}

// Sign in (or Enter) on the code line: the code goes to the waiting sign-in's terminal through
// herdr-ws-account (never kept here); the field empties once it's handed over.
function submitCode(view, k, cx) {
  const acc = view.wsx.acc, mine = acc.signing[k];
  const value = String(acc.codeInput.value() ?? "").trim();
  if (!mine || !mine.ask || mine.sending || mine.ask === "checking" || !value) return;
  const [agent, id] = k.split(":");
  mine.sending = true;
  mine.codeError = null;
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await call(["code", agent, id, value], 30000);
    mine.sending = false;
    if (r.error) mine.codeError = r.error;
    else { mine.ask = "checking"; acc.codeInput.set_value(""); }
    cx.notify();
  });
}

// Copy link: the waiting sign-in's link on the clipboard; the link reads "Copied" for 2 s.
function copyLink(view, k, cx) {
  const acc = view.wsx.acc, url = acc.signing[k]?.url;
  if (!url) return;
  cx.write_to_clipboard(url);
  acc.copied = { k, at: Date.now() };
  cx.timer.after(2050, (cx) => cx.notify());
  cx.notify();
}

function menuAct(view, agent, a, op, cx) {
  closePicking(view, cx);
  if (op === "default") setDefault(view, agent, a.id, cx);
  else if (op === "rename") startRename(view, agent, a, cx);
  else if (op === "signin") signIn(view, agent, a.id, false, cx);
  else if (op === "signout" || op === "remove") startAsk(view, agent, a.id, op, cx);
}

// --- drawn with the Settings window's own pieces ---

function button(t, id, label, onClick, kind = "plain", off = false) {
  const primary = kind === "primary", danger = kind === "danger";
  return h_flex().id(id).h(28).px(12).gap(6).flex_none().items_center().rounded(7).border_1()
    .border_color(primary ? t.solid : danger ? t.blocked : t.border)
    .bg(primary ? t.solid : danger ? t.blocked : t.raised)
    .text_size(13).font_medium().text_color(primary ? t.solid_foreground : danger ? t.background : t.foreground)
    .when(off, (el) => el.opacity(0.45))
    .when(!off, (el) => el.cursor_pointer().hover((s) => (primary || danger ? s.opacity(0.88) : s.bg(t.hover))).on_click(onClick))
    .child(label);
}

const link = (t, id, label, onClick) => div().id(id).flex_none().text_size(12.5).text_color(t.muted).cursor_pointer()
  .hover((s) => s.text_color(t.foreground)).on_click(onClick).child(label);

// A popup's list: rows of { id, label, icon?, off?, tag?, sep?, onClick }.
function popList(t, view, id, items, width = 220) {
  const acc = view.wsx.acc;
  return v_flex().id(id).w(width).p(5).rounded(9).border_1().border_color(t.border).bg(t.popover)
    .on_mouse_down_out((_e, cx) => { acc.closedAt = Date.now(); closePicking(view, cx); })
    .children(items.map((it, i) => it.sep
      ? div().flex_none().my(4).h(1).bg(t.border)
      : it.info
      ? div().flex_none().h(26).px(9).flex().items_center().min_w(0).child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(it.label))
      : h_flex().id(`${id}-${it.id ?? i}`).flex_none().h(30).px(9).gap(9).items_center().rounded(6)
        .when(!it.off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(it.onClick))
        .when(Boolean(it.icon), (el) => el.child(image(it.icon).size(15).flex_none().rounded(3).when(Boolean(it.off), (e) => e.opacity(0.5))))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(it.off ? t.dim : it.red ? t.blocked : t.foreground).child(it.label))
        .when(Boolean(it.tag), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(it.tag)))));
}

// A popup trigger's click: opens it, or closes it when open. A press outside the list closes it
// first, so a click on the trigger right after doesn't open it again.
function togglePick(view, pick, cx) {
  const acc = view.wsx.acc;
  if (view.picking === pick) return closePicking(view, cx);
  if (Date.now() - acc.closedAt < 250) return;
  view.picking = pick;
  acc.rename = null;
  acc.ask = null;
  view.handle?.focus();
  cx.notify();
}

// The list's columns (px): the agent's icon, the account (the rest, up to the page's width), Used
// (meter + %), Resets, ⋯. The page stops at PAGE_W so the halves don't drift apart.
const COL = { icon: 16, meter: 64, pct: 40, used: 116, resets: 168, more: 26, gap: 12 };
const PAGE_W = 720;
// Used and Resets together, for a row that shows words or buttons there instead.
const SPAN_W = COL.used + COL.gap + COL.resets;

function usedCell(t, u) {
  const color = u.tone === "bad" ? t.blocked : u.tone === "warn" ? t.ansi3 : null;
  return h_flex().w(COL.used).flex_none().items_center()
    .child(div().w(COL.meter).flex_none().h(4).rounded(2).bg(t.hover).overflow_hidden()
      .when(u.pct > 0, (el) => el.child(div().h_full().rounded(2).w(`${Math.max(3, u.pct)}%`).bg(color ?? t.muted))))
    .child(div().flex_1().text_right().text_size(13).text_color(color ?? t.foreground).child(`${u.pct}%`));
}

const resetsCell = (t, k, line) => div().id(`wsx-acc-res-${k}`).w(COL.resets).flex_none().min_w(0).truncate()
  .text_size(11.5).text_color(t.dim).when(Boolean(line), (el) => el.tooltip(line)).child(line || "");

// A small button that fits the row's height (Sign in, Save).
const rowButton = (t, id, label, onClick) => h_flex().id(id).h(24).px(10).flex_none().items_center().rounded(6).border_1()
  .border_color(t.border).bg(t.raised).text_size(12.5).font_medium().text_color(t.foreground)
  .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick).child(label);

function accountRow(t, view, g, a, sep, waiting) {
  const acc = view.wsx.acc;
  const k = akey(g.agent, a.id);
  const signing = acc.signing[k];
  const wait = waiting[k];
  const failed = acc.failed[k] ?? null;
  const isNew = Boolean(signing?.isNew ?? wait?.isNew ?? failed?.isNew);
  const v = rowView(g.agent, a, {
    url: signing?.url ?? null, copied: acc.copied?.k === k && Date.now() - acc.copied.at < 2000,
    signing: Boolean(signing), waiting: Boolean(wait), busy: acc.busy[k], failed, isNew,
    usageReading: Boolean(acc.reading[k]), listing: acc.listing, listed: acc.listedAt > 0,
  });
  const renaming = view.picking === RENAME && acc.rename?.agent === g.agent && acc.rename?.id === a.id;
  const asking = view.picking === ASK && acc.ask?.agent === g.agent && acc.ask?.id === a.id ? acc.ask : null;
  const pick = menuPick(k);
  const menuOpen = view.picking === pick;
  const waits = v.right === "signing" || v.right === "waiting";

  // Account: the title, the plan (dim), Default; a signed-out row says so in red after them.
  const who = renaming
    ? Input.new(acc.renameInput).flex_1().min_w(0).h(28).px(9).rounded(6).border_1()
      .border_color(acc.renameFocused ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground)
    : h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(div().min_w(0).truncate().text_size(13.5).text_color(t.foreground).child(v.title))
      .when(Boolean(v.sub) && !waits, (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(v.sub)))
      .when(v.isDefault, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.accent).child("Default")))
      .when(v.right === "signed-out", (el) => el.child(div().flex_none().text_size(12).text_color(t.blocked).child("Signed out")));

  // Used and Resets: the meter and when it resets, or what the row does instead, across both.
  const span = (child) => h_flex().w(SPAN_W).flex_none().min_w(0).gap(10).items_center().child(child);
  const words = (text) => div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(text);
  const cells = renaming
    ? span(h_flex().flex_1().justify_end().gap(10).items_center()
      .child(link(t, `wsx-acc-rename-cancel-${k}`, "Cancel", (_e, cx) => { acc.rename = null; closePicking(view, cx); }))
      .child(rowButton(t, `wsx-acc-rename-save-${k}`, "Save", (_e, cx) => saveRename(view, cx))))
    : v.right === "usage" ? [usedCell(t, v.usage), resetsCell(t, k, v.usage.line)]
    : v.right === "signed-out" ? [h_flex().w(COL.used).flex_none().child(rowButton(t, `wsx-acc-signin-${k}`, "Sign in", (_e, cx) => signIn(view, g.agent, a.id, false, cx))), div().w(COL.resets).flex_none()]
    : waits ? span(words(v.note))
      .when(Boolean(v.copy), (el) => el.child(link(t, `wsx-acc-copy-${k}`, v.copy, (_e, cx) => copyLink(view, k, cx)).when(v.copy === "Copied", (e) => e.text_color(t.foreground))))
      .child(link(t, `wsx-acc-cancel-${k}`, "Cancel", (_e, cx) => cancelSignIn(view, g.agent, a.id, isNew, cx)))
    : v.right === "failed" ? span(words(v.note))
      .when(Boolean(failed?.offer), (el) => el.child(link(t, `wsx-acc-term-${k}`, "Use a terminal", (_e, cx) => { openTerminal(view, g.agent, a.id, failed.offer, isNew); cx.notify(); })
        .tooltip("Sign in in a terminal tab instead")))
      .child(rowButton(t, `wsx-acc-retry-${k}`, "Try again", (_e, cx) => signIn(view, g.agent, a.id, isNew, cx)))
    : v.right === "busy" ? span(h_flex().gap(6).items_center()
      .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900))
      .child(div().text_size(12).text_color(t.muted).child(BUSY_WORDS[acc.busy[k]] ?? "Working…")))
    : v.right === "reading" ? span(words("Reading usage…"))
    : v.right === "unknown" || v.right === "unclear" ? span(words(v.note))
    : span(div());

  const items = menuItems(g.agent, a).map((it) => it.sep || it.info ? it : { ...it, id: it.op, onClick: (_e, cx) => menuAct(view, g.agent, a, it.op, cx) });
  const dotsTrigger = div().id(`wsx-acc-more-${k}`).w(COL.more).h(24).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
    .bg(menuOpen ? t.hover : "#00000000").hover((s) => s.bg(t.hover)).tooltip(`More for ${v.title}`)
    .on_click((_e, cx) => togglePick(view, pick, cx))
    .child(svg("mods/ws-settings/more.svg").size(15).text_color(menuOpen ? t.foreground : t.muted));
  const dots = Popup.new(`wsx-acc-menu-pop-${k}`, dotsTrigger).anchor("top_right")
    .when(menuOpen, (el) => el.content(popList(t, view, `wsx-acc-menu-${k}`, items, 250)));
  const showDots = !renaming && !waits && v.right !== "busy";

  // Antigravity's code from the browser: a second line under the waiting row, the field and Sign in
  // (the page's one primary then), and what went wrong under them.
  const cv = signing ? codeView(signing.ask, { sending: signing.sending, error: signing.codeError }) : null;
  const codeLine = cv && v_flex().id(`wsx-acc-code-${k}`).w_full().pl(COL.icon + COL.gap).pr(COL.more + COL.gap).pb(10).gap(6)
    .child(h_flex().w_full().gap(10).items_center()
      .child(Input.new(acc.codeInput).flex_1().min_w(0).h(28).px(9).rounded(6).border_1()
        .border_color(cv.tone === "bad" ? t.blocked : acc.codeFocused ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground))
      .child(button(t, `wsx-acc-code-go-${k}`, cv.button, (_e, cx) => submitCode(view, k, cx), "primary", cv.off)))
    .when(Boolean(cv.message), (el) => el.child(div().text_size(12).line_height("17px").text_color(cv.tone === "bad" ? t.blocked : t.dim).child(cv.message)));

  const line = h_flex().id(`wsx-acc-${k}`).w_full().min_h(40).gap(COL.gap).py(6).items_center()
    .when(!codeLine, (el) => el.border_b(1).border_color(t.border))
    .when(sep && !codeLine, (el) => el.border_t(1))
    .child(image(g.icon).size(COL.icon).flex_none().rounded(3))
    .child(who).children(Array.isArray(cells) ? cells : [cells])
    .child(showDots ? dots : div().w(COL.more).flex_none());
  if (codeLine) return v_flex().w_full().border_b(1).border_color(t.border).when(sep, (el) => el.border_t(1)).child(line).child(codeLine);
  if (!asking) return line;

  const askWords = asking.op === "remove"
    ? removeWords(g.agent, v.title, asking.on, nextDefault(g, a.id))
    : signoutWords(v.title, asking.on, Boolean(a.main));
  return v_flex().w_full().child(line)
    .child(h_flex().id(`wsx-acc-ask-${k}`).mt(6).mb(6).px(12).py(10).gap(12).items_center().rounded(8).bg(t.blocked + "1a")
      .child(div().flex_1().min_w(0).text_size(12.5).line_height("18px").text_color(t.foreground).child(askWords))
      .child(link(t, `wsx-acc-ask-cancel-${k}`, "Cancel", (_e, cx) => { acc.ask = null; closePicking(view, cx); }))
      .child(button(t, `wsx-acc-ask-go-${k}`, asking.op === "remove" ? "Remove" : "Sign out", (_e, cx) => confirmAsk(view, cx), "danger")));
}

// The list's quiet header: Account, Used (meter and %), Resets, over their columns.
function headerRow(t) {
  const hd = (text) => div().text_size(11).text_color(t.dim).child(text.toUpperCase());
  return h_flex().w_full().gap(COL.gap).pb(6).items_center().border_b(1).border_color(t.border)
    .child(div().w(COL.icon).flex_none())
    .child(div().flex_1().min_w(0).child(hd("Account")))
    .child(div().w(COL.used).flex_none().child(hd("Used")))
    .child(div().w(COL.resets).flex_none().child(hd("Resets")))
    .child(div().w(COL.more).flex_none());
}

// The page: the window's body shows it for "accounts".
export function accountsPage(t, view) {
  const acc = view.wsx?.acc;
  const list = acc?.list ?? null;
  const rows = rowsOf(list);
  const choices = addChoices(list);
  const waiting = stillWaiting(shared(WAITING), list);
  const addOpen = view.picking === ADD_PICK;
  // Add account stays the page's primary button, except while a row asks to remove (its red one leads).
  const asking = view.picking === ASK && acc?.ask;
  // …or while a sign-in asks for the code from the browser (its Sign in leads).
  const codeAsked = Object.values(acc?.signing ?? {}).some((s) => s?.ask);

  const addTrigger = button(t, "wsx-acc-add", acc?.adding ? "Adding…" : "Add account ▾", (_e, cx) => togglePick(view, ADD_PICK, cx),
    asking || codeAsked ? "plain" : "primary", !acc || !list || !choices.length || Boolean(acc.adding));
  const add = Popup.new("wsx-acc-add-pop", addTrigger).anchor("top_right")
    .when(addOpen && Boolean(acc), (el) => el.content(popList(t, view, "wsx-acc-add-list",
      choices.map((c) => ({ id: c.agent, label: c.title, icon: c.icon, onClick: (_e, cx) => addAccount(view, c.agent, cx) })), 200)));

  const page = v_flex().w_full().max_w(PAGE_W)
    .child(h_flex().w_full().gap(16).items_start().pb(18)
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(18).font_semibold().text_color(t.foreground).child("Accounts"))
        .child(div().text_size(12.5).line_height("18px").text_color(t.dim)
          .child("New agents start on the default. Move a running agent from its right-click menu: it picks up where it was.")))
      .child(add));

  if (!acc || (!list && !acc.error)) {
    return page.child(h_flex().py(14).gap(8).items_center()
      .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900))
      .child(div().text_size(12.5).text_color(t.dim).child("Reading accounts…")));
  }
  if (!list) return page.child(div().py(10).text_size(12.5).line_height("18px").text_color(t.blocked).child(`Couldn't read the accounts: ${acc.error}`));
  if (!groupsOf(list).length) return page.child(div().py(10).text_size(12.5).text_color(t.dim).child("Claude, Codex and Antigravity aren't installed here."));

  return page.child(headerRow(t)).children(rows.map((r) => accountRow(t, view, r.group, r.a, r.sep, waiting)));
}
