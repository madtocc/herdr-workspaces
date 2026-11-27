// Vault: secrets agents use by name, without ever seeing them. A dialog the sidebar footer's
// "Vault" row (ws-chrome) opens with props { workspace } (null: no workspace shown).
//
// The list is the shown workspace's secrets, then every workspace's, from ~/.herdr/vault/meta.json
// (names and rules only, never values; the only file this reads there, re-read when the folder
// changes). On open it runs `herdr-ws-secret sync --json` (the CLI makes the folder and rewrites
// the Protected mirror from the broker) and `herdr-ws-secret broker status --json`.
//
// Writes go only through the CLI's handoff: a file ~/.herdr/vault/.inbox-<random>, made 0600
// before anything else, then `herdr-ws-secret ingest <file>`, which unlinks it first thing; it's
// removed here too whatever happens. The value is in that file and nowhere else: not in an
// argument, shared state, localStorage or a log, and the masked field is emptied as soon as Save
// sends it. Nothing here can read a value back: there's no command that prints one.
//
// The rules (which state shows, what a row says, what Save sends, whether macOS will ask) are
// vaultview.js; the secret's own rules are vaultfacts.js (a copy of ws-switcher's); the defaults
// for a new secret come from Settings > Secrets ("vault" in ~/.herdr/settings.jsonc, settingsfacts.js,
// read from shared "workspaces.settings").

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, home, appHome, readTextFile, writeTextFile, run, window, watchFolder, checking } from "herdr";
import { exec } from "./posix.js";
import { parseMeta, exampleFor, lastUsedLabel, expiryDetail, TTL_CHOICES } from "./vaultfacts.js";
import { vaultSetting, featureOn } from "./settingsfacts.js";
import { VAULT_DIR, META, TIER_WORDS, COMMANDS_HINT, LINE_BREAK_WORDS, LINE_BREAK_CMD, brokerUp, brokerFoot, listGroups, visibleEntries, newForm, formFrom, withTier, isDirty, formProblems, namesShell, blocked, saveSteps, saveAsks, answerOf, expiresSub, ttlShown, footNote, scopeName, screenState, touched, escAction, blockWords, unreadable, valueSub, moveKey, LATE_MS, UNFINISHED, lateWords, unfinishedRecord, readUnfinished, stepWhat, stepAsks, tierBlocks } from "./vaultview.js";

const vaultDir = () => `${home()}/${VAULT_DIR}`;
const secretBin = () => `${appHome()}/mods/ws-switcher/bin/herdr-ws-secret`;
const ICON = (name) => `mods/ws-vault/${name}.svg`;
const macHere = () => (window()?.platform ?? "macos") === "macos";
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;
const TTL_LABEL = { "4h": "4h", "24h": "24h", "7d": "7d", "30d": "30d", never: "Never" };
const errText = (e) => String(e?.message ?? e);
// A control's own press kept from the dialog root, whose on_mouse_down takes back a question asked once.
const STOP = (_e, cx) => cx.stop_propagation();
const ARM_GUARD = 500; // ms after Delete arms in which a press on Cancel or Delete “name” does nothing
// The delete question's line (D2): the same for both tiers, and it can't be taken back.
const DELETE_LINE = "It can't be undone. Agents and automations that name it will be refused.";

// herdr-ws-secret with these arguments (never a value), as { code, stdout, stderr }.
const runSecret = (args, timeout = 60000) => exec(secretBin(), args, { timeout })
  .catch((e) => ({ code: 1, stdout: "", stderr: errText(e) }));

// A handoff file's name: random enough that two saves never meet (the folder is the person's own, 0700).
const inboxName = () => `.inbox-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

// Puts $1 on the clipboard (as ws-agents/main.js' COPY). Only ever the example command line.
// wl-copy and xclip stay behind to serve the clipboard: their output goes to /dev/null, so they
// don't hold the pipe exec waits on (the exit code still says whether it worked).
const COPY = `
if command -v pbcopy >/dev/null 2>&1; then printf %s "$1" | pbcopy
elif command -v wl-copy >/dev/null 2>&1; then printf %s "$1" | wl-copy >/dev/null 2>&1
elif command -v xclip >/dev/null 2>&1; then printf %s "$1" | xclip -selection clipboard >/dev/null 2>&1
elif command -v powershell >/dev/null 2>&1; then HERDR_CLIP=$1 powershell -NoProfile -NonInteractive -Command 'for ($i = 0; $i -lt 5; $i++) { try { Set-Clipboard -Value $env:HERDR_CLIP -ErrorAction Stop; exit 0 } catch { Start-Sleep -Milliseconds 150 } }; exit 1'
else echo "no clipboard command (pbcopy, wl-copy, xclip, PowerShell)" >&2; exit 1; fi`;

export default class Vault extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The sidebar row passes the shown workspace; opened another way (mod.open), it's the shown one too.
    this.ws = props()?.workspace !== undefined ? props().workspace : shared("workspaces.active") ?? null;
    this.entries = []; // meta.json's, every scope
    this.metaText = null;
    this.metaError = null;
    this.status = null; // broker status --json's answer
    this.loaded = false; // meta.json read once
    this.tab = "all"; // all | ws | global
    this.sel = null; // the open secret's key ("scope/name"), or null (a new one, or none)
    this.form = null; // vaultview's form; its text fields live in the inputs below
    this.shown = false; // problems shown (after a Save that couldn't go)
    this.busy = null; // "save" | "delete" while the CLI works
    this.waiting = false; // the broker's macOS dialog is up
    this.said = null; // the last outcome: { kind: "error"|"denied"|"saved"|"note", message, field }
    this.confirming = false; // Delete pressed once: the footer holds only the question (D2)
    this.armedAt = 0; // when it was armed: a press on the pair within ARM_GUARD of it is ignored (a double-click)
    this.escAsked = false; // Esc (or the ×) pressed once with something typed or changed
    this.pending = null; // a pick clicked once over unsaved changes
    this.leaving = null; // Open Settings clicked once over something typed: the section it asked for
    this.start = null; // the form as it was loaded, so a new secret's changed choices count as typed
    this.listScroll = ScrollHandle.new();
    this.job = null; // the save or delete running: { op, i, n, asks, tier, lost, key, startedAt } (lateWords)
    this.unfinished = null; // UNFINISHED's record from a save closed part way (readUnfinished), until that secret saves
    this.copiedAt = 0;
    this.inbox = null; // a save's handoff file while it may hold the value (close() removes it)
    this.searchIn = InputState.new({ value: "", placeholder: "Search secrets…" });
    this.nameIn = InputState.new({ value: "", placeholder: "develop-admin-cookie" });
    this.valueIn = InputState.new({ value: "", placeholder: "Paste the value" });
    this.valueIn.set_masked(true);
    this.hostsIn = InputState.new({ value: "", placeholder: "develop.example.com, *.staging.example.com" });
    this.cmdsIn = InputState.new({ value: "", placeholder: "psql, stripe, gh" });
    this.noteIn = InputState.new({ value: "", placeholder: "e.g. Admin session cookie for develop switch rollout" });
    this.focusedIn = null;
    this.searchIn.on("change", (_e, cx) => { this.calm(); cx.notify(); });
    // Enter in the search box opens the first match.
    this.searchIn.on("submit", (_e, cx) => this.openFirstMatch(cx));
    for (const input of [this.searchIn, this.nameIn, this.valueIn, this.hostsIn, this.cmdsIn, this.noteIn]) {
      input.on("focus", (_e, cx) => { this.focusedIn = input; cx.notify(); });
      input.on("blur", (_e, cx) => { if (this.focusedIn === input) this.focusedIn = null; cx.notify(); });
    }
    for (const input of [this.nameIn, this.valueIn, this.hostsIn, this.cmdsIn, this.noteIn]) {
      input.on("change", (_e, cx) => {
        if (this.said && this.said.kind !== "denied") this.said = null;
        this.calm();
        cx.notify();
      });
      // Enter in a one-line field saves, when Save can.
      input.on("submit", (_e, cx) => { if (this.canSave()) this.save(cx); });
    }
    if (checking()) return;
    cx.spawn(async (cx) => {
      await this.readMeta();
      await this.readUnfinished();
      this.loaded = true;
      this.pickFirst();
      // Secrets to look through: typing goes to the search box.
      if (visibleEntries(this.entries, this.ws).length) this.searchIn.focus();
      cx.notify();
      await runSecret(["sync", "--json"]);
      await this.readMeta();
      await this.readStatus();
      if (!this.form) this.pickFirst();
      cx.notify();
      this.watch(cx);
    });
    // The broker's state can change in Settings > Secrets while this is open.
    // Every tick redraws, so "in 5m", "4m ago" and the flip to Expired move while it's open.
    cx.timer.every(15000, (cx) => cx.spawn(async (cx) => { if (!this.busy) await this.readStatus(); cx.notify(); }));
  }

  // meta.json again; true when it changed. The open secret's form follows it unless it has edits.
  async readMeta() {
    const text = await readTextFile(`${vaultDir()}/${META}`).catch(() => null);
    if (text === this.metaText && this.loaded) return false;
    this.metaText = text;
    const m = parseMeta(text);
    this.entries = m.entries;
    this.metaError = m.error;
    const e = this.entry();
    if (this.sel && !e) { this.sel = null; this.form = null; this.confirming = false; }
    else if (e && this.form && !this.form.isNew && !this.dirty()) this.load(formFrom(e));
    return true;
  }

  // A save closed before its last step left a record: kept while it may still say
  // something (readUnfinished), emptied once it can't.
  async readUnfinished() {
    const path = `${vaultDir()}/${UNFINISHED}`;
    const text = await readTextFile(path).catch(() => null);
    const r = readUnfinished(text, this.entries);
    this.unfinished = r.rec;
    if (!r.rec && text && text.trim()) await writeTextFile(path, "", text).catch(() => null);
  }

  // The record done with (that secret saved or deleted here).
  clearUnfinished(key) {
    if (!this.unfinished || this.unfinished.key !== key) return;
    this.unfinished = null;
    const path = `${vaultDir()}/${UNFINISHED}`;
    readTextFile(path).catch(() => null).then((text) => (text && text.trim() ? writeTextFile(path, "", text) : null)).catch(() => null);
  }

  // A step running for LATE_MS or more: Esc and the × close again (lateWords says what that leaves).
  late() { return Boolean(this.busy && this.job && Date.now() - this.job.startedAt >= LATE_MS); }

  async readStatus() {
    if (!macHere()) return false;
    const r = await runSecret(["broker", "status", "--json"], 20000);
    let o = null;
    try { o = JSON.parse(String(r.stdout ?? "")); } catch { /* none */ }
    // No answer (the CLI missing or failing): as not installed, with why.
    const firstLine = String(r.stderr || r.stdout || "").split("\n").map((l) => l.trim()).find(Boolean) || "no answer";
    const next = o && typeof o === "object" && typeof o.installed === "boolean" ? o
      : { platform: "macos", installed: false, running: false, noAnswer: true, error: `herdr-ws-secret broker status: ${firstLine}` };
    const changed = JSON.stringify(next) !== JSON.stringify(this.status);
    this.status = next;
    return changed;
  }

  // Re-reads meta.json whenever the vault folder changes (a save here, the CLI, an agent's use);
  // where the folder can't be watched, every 3 seconds instead.
  watch(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        let ok = true;
        await watchFolder(vaultDir()).catch(() => { ok = false; });
        if (!ok) break;
        if (await this.readMeta()) cx.notify();
      }
      cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { if (await this.readMeta()) cx.notify(); }));
    });
  }

  entry() {
    return this.sel ? this.entries.find((e) => `${e.scope}/${e.name}` === this.sel) ?? null : null;
  }

  // The form with what's typed in its fields now.
  fv() {
    if (!this.form) return null;
    return { ...this.form, name: this.form.isNew ? this.nameIn.value().trim() : this.form.name, hosts: this.hostsIn.value(), commands: this.cmdsIn.value(), note: this.noteIn.value().trim() };
  }

  valueLen() { return this.valueIn.value().length; }

  dirty() { return isDirty(this.fv(), this.entry(), this.valueLen()); }

  // Something typed or changed that closing would drop (vaultview's touched()).
  lose() { return touched(this.fv(), { entry: this.entry(), valueLen: this.valueLen(), start: this.start }); }

  // Typing or clicking anything else: the questions asked once (Esc, a pick, Open Settings) are
  // dropped with their line, so a later second press can't act on an old question.
  calm() {
    this.escAsked = false;
    this.pending = null;
    this.leaving = null;
    if (!this.busy) this.confirming = false; // an armed Delete, too (D2: anything typed or clicked drops it)
    if (this.said?.kind === "note") this.said = null;
  }

  // A press anywhere in the dialog takes back a question asked once (the root's on_mouse_down).
  // The controls that answer one (the ×, a list row, New secret, Open Settings) stop their own
  // press from getting here, so their second click still goes.
  pressAnywhere(cx) {
    if (!this.escAsked && !this.pending && !this.leaving && !(this.confirming && !this.busy)) return;
    this.calm();
    cx.notify();
  }

  // The list's groups as drawn (no tabs without a workspace).
  shownGroups() {
    return listGroups(this.entries, { ws: this.ws, tab: this.ws ? this.tab : "all", query: this.searchIn.value() });
  }

  openFirstMatch(cx) {
    const key = moveKey(this.shownGroups(), null, 1);
    if (key) this.goTo(key, cx, "Press Enter");
  }

  // Opens a listed secret from the keyboard (↑ ↓, Enter in the search) and scrolls to its row.
  goTo(key, cx, again) {
    if (key !== this.sel) this.pick(key, cx, again);
    // Only to a row that opened (unsaved changes may have only asked).
    if (this.sel !== key) return;
    // The list's children: the unreadable line (if any), then each group's title and rows.
    let i = this.metaError ? 1 : 0;
    for (const g of this.shownGroups()) {
      i += 1;
      const at = g.rows.findIndex((r) => r.key === key);
      if (at >= 0) { this.listScroll.scroll_to_item(i + at); break; }
      i += g.rows.length;
    }
  }

  // Puts a form into the fields; the value field always starts empty.
  load(form) {
    this.form = form;
    this.nameIn.set_value(form.name);
    this.hostsIn.set_value(form.hosts);
    this.cmdsIn.set_value(form.commands);
    this.noteIn.set_value(form.note);
    this.valueIn.set_value("");
    this.shown = false;
    this.confirming = false;
    this.escAsked = false;
    this.leaving = null;
    this.start = form;
  }

  // Clear search and Show all: the search and tab back to all; the open secret (and its edits) stays.
  showAll(cx) {
    this.searchIn.set_value("");
    this.tab = "all";
    if (!this.form) this.pickFirst();
    cx.notify();
  }

  // The first secret in the list, open; none: nothing open.
  pickFirst() {
    const groups = listGroups(this.entries, { ws: this.ws, tab: this.tab, query: this.searchIn.value() });
    const row = groups[0]?.rows[0];
    if (!row) { this.sel = null; this.form = null; return; }
    this.sel = row.key;
    this.load(formFrom(this.entry()));
  }

  // Opens a secret (key) or a new one (null); something typed or changed (lose(): a new secret only
  // once it has something in it, and New secret again over a half-filled one too) asks for a second click.
  // again: how the second try is made ("Click", or "Press ↓" for a key).
  pick(key, cx, again = "Click") {
    // While a delete runs, its question (Deleting…) stays on the secret it's about.
    if (this.busy === "delete") return;
    // An armed Delete is taken back first, so the footer that says "Click again to drop them" shows.
    this.unarm();
    const want = key ?? "+new";
    if (this.form && this.lose() && this.pending !== want) {
      this.pending = want;
      // This question replaces any other one asked (Esc, the ×, Open Settings).
      this.escAsked = false;
      this.leaving = null;
      this.said = { kind: "note", message: `This secret has unsaved changes. ${again} again to drop them.` };
      cx.notify();
      return;
    }
    this.pending = null;
    this.said = null;
    if (key === null) {
      const s = shared("workspaces.settings");
      this.sel = null;
      this.load(newForm({ ws: this.ws, tier: vaultSetting(s, "default-tier"), ttl: vaultSetting(s, "default-ttl"), mac: macHere() }));
      this.nameIn.focus();
    } else {
      this.sel = key;
      const e = this.entry();
      if (e) this.load(formFrom(e));
    }
    cx.notify();
  }

  // Save is pressable: something to save, nothing running, Protected not blocked, and not a move to
  // Protected the CLI's migrate would refuse (tierBlocks: said under the tier cards at once).
  canSave() {
    const f = this.fv();
    return Boolean(f) && !this.busy && this.dirty() && !blocked(f, { status: this.status, mac: macHere() }) && !tierBlocks(this.problems());
  }

  problems() {
    const f = this.fv();
    return f ? formProblems(f, { entries: this.entries, entry: this.entry(), valueLen: this.valueLen() }) : [];
  }

  // One step through the handoff: the file (0600 before the value is in it is impossible with
  // writeTextFile, so it's made 0600 at once and before the CLI is asked), ingest, and the file
  // gone whatever happened. value: only for a step that carries one.
  async ingest(step, value) {
    const { withValue: _w, ...payload } = step;
    const path = `${vaultDir()}/${inboxName()}`;
    // Kept on the view while it may hold the value, so close() can remove it (the review's S10).
    this.inbox = path;
    try {
      // The folder: sync makes it, but sync asks the broker first and may stop before then.
      await exec("mkdir", ["-p", "-m", "700", vaultDir()]).catch(() => null);
      await writeTextFile(path, JSON.stringify(value == null ? payload : { ...payload, value }), null);
      const c = await exec("chmod", ["600", path]).catch((e) => ({ code: 1, stderr: errText(e) }));
      if (c.code !== 0) return { code: 1, stdout: "", stderr: `Couldn't protect the handoff file: ${String(c.stderr || "").trim()}` };
      return await runSecret(["ingest", path], 300000);
    } catch (e) {
      return { code: 1, stdout: "", stderr: errText(e) };
    } finally {
      await exec("rm", ["-f", path]).catch(() => null);
      if (this.inbox === path) this.inbox = null;
    }
  }

  save(cx) {
    const f = this.fv();
    const e = this.entry();
    if (!f || this.busy) return;
    this.unarm(); // Enter in a box while Delete asks: the save's problems or error must be seen
    if (blocked(f, { status: this.status, mac: macHere() })) return;
    if (this.problems().length) { this.shown = true; cx.notify(); return; }
    const s = shared("workspaces.settings");
    const steps = saveSteps(f, e, { valueLen: this.valueLen(), defaultTtl: vaultSetting(s, "default-ttl") });
    if (!steps.length) return;
    const asks = saveAsks(f, e).asks;
    let value = steps.some((x) => x.withValue) ? this.valueIn.value() : null;
    this.valueIn.set_value(""); // sent: the field keeps nothing
    this.busy = "save";
    this.waiting = asks;
    this.said = null;
    this.escAsked = false;
    const sent = this.form; // a failed save's value goes back only into this form, if it's still the open one
    const job = { op: "save", n: steps.length, asks, steps: steps.map(stepWhat), key: e ? `${e.scope}/${e.name}` : `${f.scope}/${f.name}` };
    this.job = { ...job, i: 0, startedAt: Date.now() }; // job: lateWords' shape
    cx.notify();
    cx.spawn(async (cx) => {
      let failed = null;
      try {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          this.job = { ...job, i, startedAt: Date.now() };
          cx.timer.after(LATE_MS + 100, (cx) => cx.notify()); // the late notice and the × come back
          const a = answerOf(await this.ingest(step, step.withValue ? value : null));
          if (!a.ok) { failed = a.error; break; }
        }
      } finally {
        // Failed: the value wasn't stored (its put is the last step), so it goes back into the box,
        // masked as before: only while the form that sent it is still open (not another secret
        // picked, New secret or a reload meanwhile) and nothing was typed there since.
        if (failed && value !== null && !this.gone && this.form === sent && this.valueLen() === 0) this.valueIn.set_value(value);
        value = null;
      }
      this.busy = null;
      this.job = null;
      this.waiting = false;
      await this.readMeta();
      if (failed) {
        // The form keeps the edit (a value must be typed again: it was sent).
        this.said = { kind: failed.kind === "denied" ? "denied" : "error", op: "save", message: failed.message, field: failed.field };
      } else {
        this.sel = `${f.scope}/${f.name}`;
        this.clearUnfinished(job.key);
        const saved = this.entry();
        if (saved) this.load(formFrom(saved));
        this.said = { kind: "saved", message: "Saved." };
      }
      cx.notify();
    });
  }

  // Delete: the first press arms (the footer then asks: Cancel, Delete “name”, the line); a press on
  // Delete “name” deletes, unless it comes within ARM_GUARD of arming (the second half of a double-click).
  // The armed Delete taken back by a way out (a pick, New secret, Open Settings, Save, the ×): no
  // other question may be asked while the armed footer hides the line that says it.
  unarm() {
    if (!this.busy) this.confirming = false;
  }

  // The armed question's Cancel (also within ARM_GUARD it does nothing: a double-click on Delete lands here).
  disarm(cx) {
    if (this.busy || Date.now() - this.armedAt < ARM_GUARD) return;
    this.confirming = false;
    cx.notify();
  }

  // Discard (D7): an existing secret's edits dropped, as it's saved; no question (they're on screen).
  discard(cx) {
    const e = this.entry();
    if (!e || this.busy) return;
    this.said = null;
    this.pending = null;
    this.load(formFrom(e));
    cx.notify();
  }

  remove(cx) {
    const e = this.entry();
    if (!e || this.busy) return;
    if (!this.confirming) {
      this.calm();
      this.confirming = true;
      this.armedAt = Date.now();
      cx.notify();
      return;
    }
    if (Date.now() - this.armedAt < ARM_GUARD) return;
    this.busy = "delete"; // confirming stays: the pair shows "Deleting…" until it's done
    this.job = { op: "delete", i: 0, n: 1, asks: false, key: `${e.scope}/${e.name}`, startedAt: Date.now() };
    cx.timer.after(LATE_MS + 100, (cx) => cx.notify());
    cx.notify();
    cx.spawn(async (cx) => {
      const a = answerOf(await this.ingest({ op: "rm", name: e.name, scope: e.scope, withValue: false }, null));
      this.busy = null;
      this.job = null;
      this.confirming = false;
      await this.readMeta();
      if (!a.ok) this.said = { kind: a.error.kind === "denied" ? "denied" : "error", op: "delete", message: a.error.message, field: null };
      else { this.clearUnfinished(`${e.scope}/${e.name}`); this.sel = null; this.form = null; this.pickFirst(); this.said = null; }
      cx.notify();
    });
  }

  // Settings on one of its sections (vault, features); this dialog closes first, the typed value with it.
  // With something typed or changed, the first click asks (the footer's line) and a second goes.
  openSettings(section, cx) {
    if (this.busy) return;
    this.unarm(); // its question would go in the footer the armed Delete hides
    if (this.lose() && this.leaving !== section) {
      this.leaving = section;
      this.escAsked = false;
      this.pending = null;
      this.said = { kind: "note", message: "Opening Settings closes this and drops what you typed. Click again." };
      cx.notify();
      return;
    }
    this.valueIn.set_value("");
    closeOverlay(props()?.overlay);
    setShared("workspaces.settings.section", { id: section, at: Date.now() });
    run("mod.open", { name: "ws-settings" });
  }

  // Esc's close: the value field emptied, then the dialog gone.
  dismiss() {
    this.valueIn.set_value("");
    closeOverlay(props()?.overlay);
  }

  // Herdr's last call when the dialog goes, however it goes (a click outside, mod.open again):
  // nothing typed outlives it.
  async close(_cx) {
    this.gone = true; // a failed save's value isn't put back into the box after this
    this.valueIn.set_value("");
    // A save in flight: its handoff file may still hold the value, and the task writing it is
    // about to be cancelled. An exec started here still goes out.
    const inbox = this.inbox;
    this.inbox = null;
    if (inbox) await exec("rm", ["-f", inbox]).catch(() => null);
    // Closed before a save's last step: the running step's CLI run goes on, the later ones never
    // start. A record says so on the next open (readUnfinished), once that step has gone through.
    const rec = this.busy === "save" ? unfinishedRecord(this.job) : null;
    if (rec) {
      const path = `${vaultDir()}/${UNFINISHED}`;
      const cur = await readTextFile(path).catch(() => null);
      await writeTextFile(path, JSON.stringify(rec), cur).catch(() => null);
    }
  }

  copyExample(text, cx) {
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", COPY, "sh", text]).catch((e) => ({ code: 1, stderr: errText(e) }));
      if (r.code === 0) { this.copiedAt = Date.now(); cx.timer.after(1600, (cx) => cx.notify()); }
      else this.said = { kind: "error", op: "copy", message: String(r.stderr || "").trim() || "The clipboard command failed." };
      cx.notify();
    });
  }

  // Esc's, Cmd/Ctrl+W's ("w") and the header ×'s close: nothing while a save or delete runs (until
  // it's late); Esc first empties a typed search; with something typed or changed, a first press
  // asks (the footer's line) and a second closes.
  tryClose(how, cx) {
    // An armed Delete is a level: Esc (or Cmd/Ctrl+W) takes the question back first. The × takes it
    // back and goes on (it closes, or asks with the normal footer showing).
    if (how !== "x" && this.confirming && !this.busy) { this.confirming = false; cx.notify(); return; }
    if (how === "x") this.unarm();
    // Late, a close is let through at once: what it leaves is said above the footer.
    const late = this.late();
    const act = escAction({ busy: Boolean(this.busy) && !late, query: how === "esc" ? this.searchIn.value() : "", lose: !late && this.lose(), asked: this.escAsked });
    if (act === "wait") return;
    if (act === "clear-search") { this.searchIn.set_value(""); cx.notify(); return; }
    if (act === "ask") {
      this.calm();
      this.escAsked = true;
      this.said = { kind: "note", message: how === "x" ? "Click × again to close and drop what you typed." : "Press Esc again to close and drop what you typed." };
      cx.notify();
      return;
    }
    this.dismiss();
  }

  onKey(e, cx) {
    // Any key while Delete is armed takes the question back (D2); the key does nothing else.
    if (this.confirming && !this.busy) { this.confirming = false; cx.stop_propagation(); cx.notify(); return; }
    // No Esc here: in a dialog Herdr's Esc comes as its action overlay.close (and Cmd/Ctrl+W as
    // tab.close / pane.close), never as a key: render()'s on_action calls tryClose.
    // ↑ ↓ move through the listed secrets, from the search box or with no box focused.
    if ((e.key === "down" || e.key === "up") && (this.focusedIn === null || this.focusedIn === this.searchIn) && this.loaded) {
      const key = moveKey(this.shownGroups(), this.sel, e.key === "down" ? 1 : -1);
      if (!key) return;
      cx.stop_propagation();
      this.goTo(key, cx, e.key === "down" ? "Press ↓" : "Press ↑");
    }
  }

  render() {
    const t = theme();
    const now = Date.now();
    const mac = macHere();
    const settings = shared("workspaces.settings");
    const on = featureOn(settings, "vault");
    const def = defOf(this.ws);
    const wsName = def?.name ?? this.ws;
    const query = this.searchIn.value();
    const tab = this.ws ? this.tab : "all";
    const mine = visibleEntries(this.entries, this.ws);
    const groups = listGroups(this.entries, { query, tab, ws: this.ws, wsName, now });
    const f = this.fv();
    const e = this.entry();
    const state = screenState({ on, entries: mine, groups, query, tab, form: f, entry: e, status: this.status, mac, now });

    const head = h_flex().h(50).flex_none().px(18).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg(ICON("vault")).size(14).text_color(t.muted))
      .child(div().text_size(15).font_semibold().child("Secrets"))
      .when(Boolean(wsName), (el) => el.child(div().text_size(12.5).text_color(t.dim).child(wsName)))
      .child(div().flex_1())
      // The way out with the mouse (a click beside the dialog doesn't close it): the same guarded close as Esc.
      .child(div().id("v-close").size(26).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.muted).when(!this.busy || this.late(), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .when(Boolean(this.busy) && !this.late(), (el) => el.opacity(0.42))
        .tooltip("Close").on_mouse_down("left", STOP).on_click((_e, cx) => this.tryClose("x", cx))
        .child(svg(ICON("x")).size(14)));

    let body;
    if (state === "off") {
      body = this.middle(t, "vault", "Secrets is off",
        "Turn it on in Settings > Features to see and add secrets. Nothing was deleted while it was off.",
        "Open Settings > Features", (_e, cx) => this.openSettings("features", cx));
    } else if (state === "empty" && this.loaded && this.metaError) {
      // Not "No secrets yet": they may all be there. No New secret either: the CLI refuses to write until it's fixed.
      const u = unreadable(this.metaError);
      body = this.middle(t, "warn", u.title, u.words);
    } else if (state === "empty" && this.loaded) {
      body = this.middle(t, "vault", "No secrets yet",
        "Store tokens and cookies here so agents can make authenticated calls through herdr-ws-secret without ever seeing or logging the value.",
        "New secret", (_e, cx) => this.pick(null, cx), "plus");
    } else if (!this.loaded) {
      body = div().flex_1();
    } else {
      body = h_flex().flex_1().min_h(0).items_stretch()
        .child(this.list(t, groups, mine, mac, wsName))
        .child(state === "no-results"
          ? (query.trim()
            ? this.middle(t, "search", `No secrets match “${query.trim()}”`,
              `Check the spelling or clear the filter to see all ${mine.length} secret${mine.length === 1 ? "" : "s"}${this.ws ? ` in ${wsName} and Every workspace` : ""}.`,
              "Clear search", (_e, cx) => this.showAll(cx))
            // A tab with nothing in it: nothing was searched for.
            : this.middle(t, "search", tab === "global" ? "No secrets for every workspace yet" : `No secrets in ${wsName} yet`,
              `Secrets made ${tab === "global" ? "for every workspace" : `for ${wsName}`} show in this tab. Show all to see the ${mine.length} secret${mine.length === 1 ? "" : "s"} there are.`,
              "Show all", (_e, cx) => this.showAll(cx)))
          : state === "none"
            ? v_flex().flex_1().p(20).text_size(12.5).text_color(t.muted).child("Pick a secret, or make a new one.")
            : this.editor(t, state, f, e, mac, wsName, now));
    }

    // Esc, and Cmd/Ctrl+W, reach a dialog as Herdr's actions, never as keys: claimed here (Secrets is
    // only ever a dialog, so all three, always). A handler that returns without closing keeps it open;
    // init keeps the keyboard inside (the handle, or the search box).
    const onEsc = (_e, cx) => { cx.stop_propagation(); this.tryClose("esc", cx); };
    const onW = (_e, cx) => { cx.stop_propagation(); this.tryClose("w", cx); };
    return v_flex().id("vault").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_action("overlay.close", onEsc)
      .on_action("tab.close", onW)
      .on_action("pane.close", onW)
      .on_mouse_down("left", (_e, cx) => this.pressAnywhere(cx))
      .on_key_down((ev, cx) => this.onKey(ev, cx))
      .child(head)
      .child(body);
  }

  // A centered page: an icon, a title, a few words and one button (empty, no match, off); no button
  // when there's nothing to press (unreadable).
  middle(t, icon, title, words, label = null, action = null, buttonIcon = null) {
    return v_flex().flex_1().min_w(0).items_center().justify_center().px(32).gap(10)
      .child(div().size(44).mb(4).flex().items_center().justify_center().rounded(10).bg(t.raised).border_1().border_color(t.border)
        .child(svg(ICON(icon)).size(16).text_color(t.muted)))
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child(title))
      .child(div().max_w(380).pb(8).text_size(12.5).line_height("19px").text_color(t.muted).text_center().child(words))
      .when(Boolean(label), (el) => el.child(this.button(t, "v-middle", label, "primary", action, true, buttonIcon)));
  }

  // kind: primary (solid), plain, danger (red words), fill (the danger fill: D2's Delete “name”).
  // dim: the opacity while it can't be pressed.
  button(t, id, label, kind, action, enabled = true, icon = null, dim = 0.42) {
    return h_flex().id(id).h(32).px(13).gap(6).flex_none().items_center().rounded(8).border_1()
      .border_color(kind === "primary" ? t.solid : kind === "fill" ? t.blocked : kind === "danger" ? t.border : t.input)
      .bg(kind === "primary" ? t.solid : kind === "fill" ? t.blocked : kind === "danger" ? "#00000000" : t.raised)
      .text_color(kind === "primary" || kind === "fill" ? t.solid_foreground : kind === "danger" ? t.blocked : t.foreground)
      .text_size(12.5).when(kind !== "danger", (el) => el.font_medium())
      .when(!enabled, (el) => el.opacity(dim))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(12.5)))
      .child(label);
  }

  list(t, groups, mine, mac, wsName) {
    const query = this.searchIn.value();
    const foot = brokerFoot(this.status, mac);
    const tabBtn = (id, label) => div().id(`v-tab-${id}`).h(22).px(8).flex().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .when(this.tab === id, (el) => el.bg(t.raised).text_color(t.foreground).font_medium())
      .when(this.tab !== id, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { this.tab = id; this.calm(); cx.notify(); })
      .child(label);
    const rowEl = (r) => {
      const isOn = this.sel === r.key;
      const tint = r.tone === "exp" ? t.blocked : r.tone === "prot" ? t.accent : t.muted;
      return h_flex().id(`v-row-${r.key}`).h(48).mx(6).mb(2).px(9).gap(9).flex_none().items_center().rounded(7).cursor_pointer()
        .when(isOn, (el) => el.bg(t.selected)).when(!isOn, (el) => el.hover((s) => s.bg(t.hover)))
        .on_mouse_down("left", STOP).on_click((_e, cx) => this.pick(r.key, cx))
        .child(svg(ICON(r.icon === "shield" ? "shield" : "vault")).size(14).flex_none().text_color(tint))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().id(`v-row-name-${r.key}`).truncate().text_size(12.5).font_family("JetBrains Mono").text_color(r.tone === "exp" ? t.muted : t.foreground)
            .when(r.tone === "exp", (el) => el.line_through()).tooltip(r.name).child(r.name))
          .child(div().id(`v-row-sub-${r.key}`).truncate().text_size(11).text_color(t.dim).tooltip(r.sub).child(r.sub)))
        .when(Boolean(r.ttl), (el) => el.child(div().flex_none().text_size(11)
          .text_color(r.ttlTone === "exp" ? t.blocked : r.ttlTone === "soon" ? t.working : t.dim).child(r.ttl)));
    };
    return v_flex().w(272).flex_none().min_h(0).border_r(1).border_color(t.border).bg(t.chrome)
      .child(v_flex().p(10).gap(8)
        .child(h_flex().id("v-new").h(30).gap(6).items_center().justify_center().rounded(8).border_1().border_color(t.input).bg(t.raised)
          .text_size(12.5).font_medium().cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", STOP).on_click((_e, cx) => this.pick(null, cx))
          .child(svg(ICON("plus")).size(12.5)).child("New secret"))
        .child(h_flex().h(30).px(9).gap(7).items_center().rounded(7).border_1()
          .border_color(this.focusedIn === this.searchIn ? t.accent : t.input).bg(t.background)
          .child(svg(ICON("search")).size(12.5).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).child(Input.new(this.searchIn).w_full().h(28).text_size(12).text_color(t.foreground).tab_index(1)))
          .when(Boolean(query), (el) => el.child(div().id("v-search-clear").size(18).flex_none().flex().items_center().justify_center().rounded(9)
            .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.searchIn.set_value(""); cx.notify(); })
            .child(svg(ICON("x")).size(11)))))
        .when(Boolean(this.ws), (el) => el.child(h_flex().gap(4)
          .child(tabBtn("all", "All")).child(tabBtn("ws", wsName)).child(tabBtn("global", "Every workspace")))))
      // Flat (titles and rows side by side) so goTo() can scroll to a row by its index.
      .child(v_flex().id("v-list").flex_1().min_h(0).pb(12).overflow_y_scrollbar().track_scroll(this.listScroll)
        .when(Boolean(this.metaError), (el) => el.child(div().px(14).py(6).text_size(11.5).text_color(t.blocked).child(this.metaError)))
        .children(groups.flatMap((g) => [div().px(14).pt(10).pb(4).text_size(11).text_color(t.dim).child(g.title), ...g.rows.map(rowEl)])))
      .when(Boolean(foot), (el) => el.child(h_flex().id("v-broker").px(12).py(9).gap(6).items_center().border_t(1).border_color(t.border)
        .text_size(11).text_color(t.dim)
        .when(!foot.on, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(foot.tip ? `${foot.tip} · Open Settings > Secrets` : "Open Settings > Secrets")
          .on_mouse_down("left", STOP).on_click((_e, cx) => this.openSettings("vault", cx)))
        .child(div().size(6).flex_none().rounded(3).bg(foot.on ? t.done : t.dim))
        .child(foot.text)));
  }

  editor(t, state, f, e, mac, wsName, now) {
    const valueLen = this.valueLen();
    const dirty = isDirty(f, e, valueLen);
    const block = blocked(f, { status: this.status, mac });
    // Shown once Save was pressed; the tier's (a move the migrate would refuse) at once, since Save isn't offered then.
    const problems = this.shown ? this.problems() : this.problems().filter((p) => p.field === "tier");
    const said = this.said;
    const fieldError = (field) => {
      const p = problems.find((x) => x.field === field);
      if (p) return p.message;
      return said && said.field === field && (said.kind === "error") ? said.message : null;
    };
    const errorLine = (field) => {
      const m = fieldError(field);
      return m ? div().pt(5).text_size(11.5).text_color(t.blocked).child(m) : div(); // .child() takes no null
    };
    const protectedTier = f.tier === "protected";
    const label = (text, sub) => h_flex().pt(14).pb(6).gap(8).items_center().justify_between()
      .child(div().text_size(11.5).text_color(t.dim).child(text))
      .when(Boolean(sub), (el) => el.child(div().text_size(11).text_color(t.dim).child(sub)));
    const box = (state_, field, idx, mono = true) => Input.new(state_).w_full().h(34).px(10).rounded(8).border_1()
      .border_color(this.focusedIn === state_ ? t.accent : fieldError(field) ? t.blocked : t.input).bg(t.background)
      .text_size(mono ? 12 : 12.5).text_color(t.foreground).tab_index(idx).when(mono, (el) => el.font_family("JetBrains Mono"));
    const chip = (id, text, isOn, action, enabled = true) => div().id(id).h(26).px(10).flex().items_center().rounded(13).border_1()
      .border_color(isOn ? t.accent : t.input).bg(isOn ? t.selected : t.background).text_size(12)
      .text_color(isOn ? t.foreground : t.muted)
      .when(!enabled, (el) => el.opacity(0.42))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { action(); cx.notify(); }))
      .child(text);
    const pill = (text, color, bg, icon = null) => h_flex().h(22).px(8).gap(5).items_center().rounded(11).bg(bg).text_size(11.5).text_color(color)
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(12))).child(text);
    const notice = (kind, title, words, action) => h_flex().mt(12).px(12).py(9).gap(9).items_start().rounded(8).border_1()
      .border_color(kind === "err" ? t.blocked + "73" : t.working + "73").bg(kind === "err" ? t.blocked + "17" : t.working + "14")
      .child(svg(ICON("warn")).size(14).mt(1).flex_none().text_color(kind === "err" ? t.blocked : t.working))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).font_medium().text_color(t.foreground).child(title))
        .child(div().text_size(12).line_height("17px").text_color(t.muted).child(words)))
      .when(Boolean(action), (el) => el.child(action));
    const set = (patch) => { this.form = { ...this.form, ...patch }; this.said = this.said?.kind === "saved" ? null : this.said; this.calm(); };

    // The tier cards.
    const card = (tier, icon, title, words) => {
      const chosen = f.tier === tier;
      const off = tier === "protected" && !mac;
      const needs = tier === "protected" && mac && !brokerUp(this.status) && this.status !== null;
      const badge = tier === "standard" ? (chosen ? "Selected" : "")
        : off ? "macOS only" : needs ? "Needs setup" : chosen ? "Selected" : "";
      const warnLook = chosen && needs;
      return v_flex().id(`v-tier-${tier}`).flex_1().min_w(0).px(12).py(10).gap(3).rounded(8).border_1()
        .border_color(warnLook ? t.working + "8c" : chosen ? t.accent : t.input)
        .bg(warnLook ? t.working + "0f" : chosen ? t.selected : t.background)
        .when(off, (el) => el.opacity(0.5))
        .when(!off && !chosen && !this.busy, (el) => el.cursor_pointer().hover((s) => s.border_color(t.accent))
          .on_click((_e, cx) => { this.form = withTier(this.fv(), tier); this.said = null; this.calm(); cx.notify(); }))
        .child(h_flex().gap(7).items_center()
          .child(svg(ICON(icon)).size(14).text_color(chosen && !warnLook ? t.accent : t.muted))
          .child(div().text_size(12.5).font_medium().text_color(t.foreground).child(title))
          .child(div().flex_1())
          .child(div().text_size(10.5).font_medium().text_color(warnLook ? t.working : chosen ? t.accent : t.dim).child(badge)))
        .child(div().text_size(11.5).line_height("16px").text_color(t.muted).child(words));
    };

    const scopeLabel = scopeName(f.scope, wsName);
    const expired = state === "expired";
    // Whether macOS will ask: only said of a form that could be saved as it is.
    const asks = !f.isNew && dirty && !this.problems().length ? saveAsks(f, e, now) : { asks: false, what: [] };

    const top = h_flex().gap(9).items_center()
      .when(f.isNew, (el) => el.child(div().text_size(15.5).font_semibold().child("New secret"))
        .child(div().flex_1())
        .when(Boolean(this.ws), (el) => el.child(h_flex().gap(6)
          .child(chip("v-scope-ws", wsName, f.scope !== "global", () => set({ scope: `ws:${this.ws}` }), !this.busy))
          .child(chip("v-scope-global", "Every workspace", f.scope === "global", () => set({ scope: "global" }), !this.busy)))))
      .when(!f.isNew, (el) => el.child(div().text_size(14.5).font_semibold().font_family("JetBrains Mono").child(f.name))
        .child(pill(scopeLabel, t.muted, t.raised))
        .child(expired ? pill(expiryDetail(e, now), t.blocked, t.blocked + "24")
          : e.tier === "protected" ? pill("Protected", t.accent, t.accent + "21", "shield") : pill("Standard", t.muted, t.raised, "vault"))
        .when(dirty, (el) => el.child(div().text_size(11.5).text_color(t.working).child("Unsaved")))
        .child(div().flex_1()));

    // The value: masked while typed; an existing one only as bullets and Saved.
    const typing = f.isNew || f.replacing;
    const valueRow = typing
      ? v_flex()
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).child(box(this.valueIn, "value", 3)))
          .when(!f.isNew, (el) => el.child(this.button(t, "v-replace-cancel", "Cancel", "plain", (_e, cx) => { this.valueIn.set_value(""); set({ replacing: false }); cx.notify(); }, !this.busy))))
        .when(!f.isNew, (el) => el.child(div().pt(5).text_size(11.5).line_height("16px").text_color(t.dim)
          .child(`Replacing updates the value in place for every agent and automation using ${f.name}.${e?.tier === "protected" ? " Automations you allowed will be asked about again." : ""}`)))
        // A one-line box drops a paste's line breaks, and the dots wouldn't show it.
        // The command in one piece: the line wraps before it, never inside it.
        .child(h_flex().pt(5).flex_wrap().gap_x(4).text_size(11.5).line_height("16px").text_color(t.dim)
          .child(div().child(LINE_BREAK_WORDS)).child(div().whitespace_nowrap().child(LINE_BREAK_CMD)))
      : h_flex().gap(8).items_center()
        .child(h_flex().flex_1().min_w(0).h(34).px(10).gap(8).items_center().rounded(8).border_1().border_color(t.border).bg(t.surface)
          .child(div().flex_1().text_size(13).text_color(t.muted).child("•••••••••••••"))
          .child(div().text_size(11.5).text_color(expired ? t.blocked : t.done).child(expired ? "Expired" : "Saved")))
        .when(!expired, (el) => el.child(this.button(t, "v-replace", "Replace value", "plain", (_e, cx) => { set({ replacing: true }); this.valueIn.focus(); cx.notify(); }, !this.busy)));

    const usage = f.mode === "http+cli" ? "http+cli" : "http";
    const shellChip = namesShell(f);
    const ttlOn = ttlShown(f, e, now);
    const ex = !f.isNew && e ? exampleFor(e) : null;
    const copied = Date.now() - this.copiedAt < 1500;
    const used = e ? lastUsedLabel(e, now) : "";

    // Blocked by the broker: the reason at the tier picker, with the way to Settings > Secrets.
    const bw = blockWords(block, { isNew: f.isNew, status: this.status });
    const blockNotice = !block || block.kind === "checking" ? null
      : block.kind === "not-mac"
        ? div().pt(8).text_size(11.5).text_color(t.dim).child("Protected needs macOS: the broker keeps secrets in the Keychain. Standard works here.")
        : notice("warn", bw.title, bw.words,
          this.button(t, "v-open-settings", "Open Settings", "primary", (_e, cx) => this.openSettings("vault", cx), !this.busy).on_mouse_down("left", STOP));

    // A save closed part way, on this secret: what didn't get saved.
    const uf = !f.isNew && this.unfinished ? readUnfinished(JSON.stringify(this.unfinished), this.entries, now).note : null;
    const form = v_flex().id(`v-form-${f.isNew ? "+new" : this.sel}`).flex_1().min_h(0).px(20).pt(18).pb(14).overflow_y_scrollbar()
      .child(top)
      .when(Boolean(uf && uf.key === this.sel), (el) => el.child(notice("warn", uf.title, uf.words, null)))
      .when(expired, (el) => el.child(notice("err", `This secret ${expiryDetail(e, now).replace(/^Expired/, "expired")}`,
        "Agents calling herdr-ws-secret are refused until you replace the value, or pick how long it lasts under Expires and Save.",
        f.replacing ? null : this.button(t, "v-expired-replace", "Replace value", "primary", (_e, cx) => { set({ replacing: true }); this.valueIn.focus(); cx.notify(); }, !this.busy))))
      .when(f.isNew, (el) => el.child(label("Name", "Lowercase letters, digits, . _ - · what agents pass to herdr-ws-secret")).child(box(this.nameIn, "name", 2)).child(errorLine("name")))
      .child(label("Value", valueSub(f, valueLen)))
      .child(valueRow)
      .child(errorLine("value"))
      .child(label("Protection tier", f.isNew ? "Default from Settings > Secrets" : "Switching migrates without revealing"))
      .child(h_flex().gap(8).items_stretch()
        .child(card("standard", "vault", "Standard", TIER_WORDS.standard))
        .child(card("protected", "shield", "Protected", TIER_WORDS.protected)))
      .when(Boolean(blockNotice), (el) => el.child(blockNotice))
      .child(errorLine("tier"))
      .child(label("Allowed usage"))
      .child(h_flex().gap(6).flex_wrap().items_center()
        .child(chip("v-mode-http", "HTTP only", usage === "http", () => set({ mode: "http", modeTouched: true }), !this.busy))
        .child(chip("v-mode-cli", protectedTier ? "HTTP + specific CLIs" : "HTTP & CLI", usage === "http+cli", () => set({ mode: "http+cli", modeTouched: true }), !this.busy)))
      .child(errorLine("mode"))
      .child(label("Allowed hosts", !protectedTier ? "Optional · empty allows any host"
        : usage === "http+cli" ? "A host or a command is required · blocks other domains & redirects"
        : f.isNew ? "Required for Protected · comma-separated" : "Required for Protected · blocks other domains & redirects"))
      .child(box(this.hostsIn, "hosts", 4))
      .child(errorLine("hosts"))
      .when(usage === "http+cli", (el) => el
        .child(label("Allowed commands", protectedTier ? "Each pinned to its full path when saved" : "Optional · empty allows any command"))
        .child(box(this.cmdsIn, "commands", 5))
        .child(div().pt(5).text_size(11.5).line_height("16px").text_color(t.dim).child(COMMANDS_HINT))
        .when(shellChip, (el) => el.child(h_flex().pt(8).gap(8).items_center()
          .child(chip("v-shells", "Allow shells and interpreters", Boolean(f.allowShells), () => set({ allowShells: !f.allowShells }), !this.busy))
          .child(div().text_size(11.5).text_color(t.dim).child("A shell can run anything with the secret."))))
        .child(errorLine("commands")))
      .child(label("Expires", expiresSub(f, e, now)))
      .child(h_flex().gap(6).flex_wrap().items_center()
        .children(TTL_CHOICES.map((c) => chip(`v-ttl-${c}`, TTL_LABEL[c], ttlOn === c, () => set({ ttlPick: c }), !this.busy))))
      .child(errorLine("ttl"))
      .when(f.isNew, (el) => el.child(label("Note", "Optional")).child(box(this.noteIn, "note", 6, false)).child(errorLine("note")))
      .when(Boolean(ex), (el) => el.child(v_flex().mt(14).px(12).py(10).gap(6).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(h_flex().items_center().justify_between()
          .child(div().text_size(11.5).text_color(t.dim).child("How agents use it"))
          .child(h_flex().id("v-copy").h(24).px(9).gap(5).items_center().rounded(6).border_1().border_color(t.input)
            .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => this.copyExample(ex, cx))
            .child(svg(ICON("copy")).size(12)).child(copied ? "Copied" : "Copy example")))
        .child(div().text_size(11.5).line_height("17px").font_family("JetBrains Mono").text_color(t.foreground).child(ex))
        .child(h_flex().gap(10).flex_wrap().text_size(11.5).text_color(t.muted)
          .child(div().child(used.startsWith("Used") ? `Last used${used.slice(4)}${e.lastUsedFor ? ` · ${e.lastUsedFor}` : ""}` : used))
          .when(Boolean(e?.note), (el) => el.child(div().child("·")).child(div().child(`Note: ${e.note}`))))));

    // The footer: Delete (or Cancel for a new one), the line that says what Save will do or did, Save.
    // An error that isn't about one field goes in a notice above it instead, where it wraps.
    const saving = this.busy === "save";
    const errBox = !this.busy && said && said.kind === "error" && !(said.field && fieldError(said.field)) ? said : null;
    // Late, the notice above says what it waits for: the line only says what's running.
    // macOS only while the step that asks runs (stepAsks: a move to Standard, or a one-step save saveAsks said asks).
    const note = saving && this.waiting && stepAsks(this.job) && !this.late() ? { text: "Waiting for your OK in the macOS dialog (it closes itself after a minute)…", color: t.working }
      : saving ? { text: "Saving…", color: t.dim }
      : this.busy === "delete" ? { text: "Deleting…", color: t.dim }
      : said && said.kind === "denied" ? { text: said.message, color: t.blocked }
      : said && said.kind === "note" ? { text: said.message, color: t.working }
      : said && said.kind === "saved" && !dirty ? { text: said.message, color: t.done }
      : asks.asks ? { text: `macOS will ask you to allow this: ${asks.what.join(", ")}`, color: t.working }
      : problems.length ? { text: "Fix what's marked above to save.", color: t.blocked }
      : { text: footNote(f, { status: this.status, mac }), color: t.dim };
    const saveLabel = saving ? "Saving…" : f.isNew ? "Save secret" : "Save";
    // D2 armed: the footer holds only the question. Cancel where Delete was (a double-click lands on
    // it), Delete “name” in the danger fill beside it, the line after them (it may wrap). Save and
    // Discard step aside. The pair keeps its own press from the root (which would take it back).
    const armed = !f.isNew && Boolean(e) && (this.confirming || this.busy === "delete");
    const deleting = this.busy === "delete";
    const pairLabel = deleting ? "Deleting…" : `Delete “${e?.name ?? ""}”`;
    const foot = armed
      ? h_flex().flex_none().px(20).pt(10).pb(14).gap(8).items_center().border_t(1).border_color(t.border)
        .child(this.button(t, "v-delete-cancel", "Cancel", "plain", (_e, cx) => this.disarm(cx), !deleting, null, 0.45).on_mouse_down("left", STOP))
        .child(this.button(t, "v-delete-yes", div().max_w(260).truncate().child(pairLabel), "fill", (_e, cx) => this.remove(cx), !deleting, null, 0.45)
          .when(pairLabel.length > 34, (el) => el.tooltip(pairLabel)).on_mouse_down("left", STOP))
        .child(div().flex_1().min_w(0).text_size(11.5).line_height("15px").text_color(t.blocked).child(DELETE_LINE))
      : h_flex().flex_none().px(20).pt(10).pb(14).gap(8).items_center().border_t(1).border_color(t.border)
        .child(f.isNew
          ? this.button(t, "v-cancel", "Cancel", "plain", (_e, cx) => { this.valueIn.set_value(""); this.pending = null; this.pickFirst(); this.said = null; cx.notify(); }, !this.busy)
          : this.button(t, "v-delete", "Delete", "danger", (_e, cx) => this.remove(cx), !this.busy))
        .child(div().id("v-foot-note").flex_1().min_w(0).truncate().text_size(11.5).text_color(note.color).tooltip(note.text).child(note.text))
        // D7: Discard while an existing secret has unsaved changes (Files' Discard and Save pair).
        .when(!f.isNew && dirty, (el) => el.child(this.button(t, "v-discard", "Discard", "plain", (_e, cx) => this.discard(cx), !this.busy)))
        .child(this.button(t, "v-save", saveLabel, "primary", (_e, cx) => this.save(cx), this.canSave()));

    const errTitle = { save: "Couldn't save", delete: "Couldn't delete", copy: "Couldn't copy the example" }[errBox?.op] ?? "Something went wrong";
    const lw = this.late() ? lateWords(this.job) : null;
    return v_flex().flex_1().min_w(0).min_h(0).child(form)
      .when(Boolean(errBox), (el) => el.child(div().flex_none().px(20).pb(10).child(notice("err", errTitle, errBox.message, null))))
      .when(Boolean(lw), (el) => el.child(div().flex_none().px(20).pb(10).child(notice("warn", lw.title, lw.words, null))))
      .child(foot);
  }
}
