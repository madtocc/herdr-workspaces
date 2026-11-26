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
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, home, appHome, readTextFile, writeTextFile, run, window, watchFolder, checking } from "herdr";
import { exec } from "./posix.js";
import { parseMeta, exampleFor, lastUsedLabel, expiryDetail, TTL_CHOICES } from "./vaultfacts.js";
import { vaultSetting, featureOn } from "./settingsfacts.js";
import { VAULT_DIR, META, TIER_WORDS, COMMANDS_HINT, brokerUp, brokerFoot, listGroups, visibleEntries, newForm, formFrom, withTier, isDirty, formProblems, namesShell, blocked, saveSteps, saveAsks, answerOf, expiresSub, ttlShown, footNote, scopeName, screenState, escStep } from "./vaultview.js";

const vaultDir = () => `${home()}/${VAULT_DIR}`;
const secretBin = () => `${appHome()}/mods/ws-switcher/bin/herdr-ws-secret`;
const ICON = (name) => `mods/ws-vault/${name}.svg`;
const macHere = () => (window()?.platform ?? "macos") === "macos";
const defOf = (id) => (shared("workspaces.defs") ?? []).find((d) => d.id === id) ?? null;
const TTL_LABEL = { "4h": "4h", "24h": "24h", "7d": "7d", "30d": "30d", never: "Never" };
const errText = (e) => String(e?.message ?? e);

// herdr-ws-secret with these arguments (never a value), as { code, stdout, stderr }.
const runSecret = (args, timeout = 60000) => exec(secretBin(), args, { timeout })
  .catch((e) => ({ code: 1, stdout: "", stderr: errText(e) }));

// A handoff file's name: random enough that two saves never meet (the folder is the person's own, 0700).
const inboxName = () => `.inbox-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

// Puts $1 on the clipboard (as ws-agents/main.js' COPY). Only ever the example command line.
const COPY = `
if command -v pbcopy >/dev/null 2>&1; then printf %s "$1" | pbcopy
elif command -v wl-copy >/dev/null 2>&1; then printf %s "$1" | wl-copy
elif command -v xclip >/dev/null 2>&1; then printf %s "$1" | xclip -selection clipboard
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
    this.confirming = false; // Delete pressed once
    this.escAsked = false; // Esc pressed once with a value typed
    this.pending = null; // a pick clicked once over unsaved changes
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
    this.searchIn.on("change", (_e, cx) => cx.notify());
    for (const input of [this.searchIn, this.nameIn, this.valueIn, this.hostsIn, this.cmdsIn, this.noteIn]) {
      input.on("focus", (_e, cx) => { this.focusedIn = input; cx.notify(); });
      input.on("blur", (_e, cx) => { if (this.focusedIn === input) this.focusedIn = null; cx.notify(); });
    }
    for (const input of [this.nameIn, this.valueIn, this.hostsIn, this.cmdsIn, this.noteIn]) {
      input.on("change", (_e, cx) => {
        if (this.said && this.said.kind !== "denied") this.said = null;
        this.escAsked = false;
        cx.notify();
      });
      // Enter in a one-line field saves, when Save can.
      input.on("submit", (_e, cx) => { if (this.canSave()) this.save(cx); });
    }
    if (checking()) return;
    cx.spawn(async (cx) => {
      await this.readMeta();
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
    cx.timer.every(15000, (cx) => cx.spawn(async (cx) => { if (!this.busy && (await this.readStatus())) cx.notify(); }));
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
    if (this.sel && !e) { this.sel = null; this.form = null; }
    else if (e && this.form && !this.form.isNew && !this.dirty()) this.load(formFrom(e));
    return true;
  }

  async readStatus() {
    if (!macHere()) return false;
    const r = await runSecret(["broker", "status", "--json"], 20000);
    let o = null;
    try { o = JSON.parse(String(r.stdout ?? "")); } catch { /* none */ }
    // No answer (the CLI missing or failing): as not installed, with why.
    const firstLine = String(r.stderr || r.stdout || "").split("\n").map((l) => l.trim()).find(Boolean) || "no answer";
    const next = o && typeof o === "object" && typeof o.installed === "boolean" ? o
      : { platform: "macos", installed: false, running: false, error: `herdr-ws-secret broker status: ${firstLine}` };
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
  }

  // The first secret in the list, open; none: nothing open.
  pickFirst() {
    const groups = listGroups(this.entries, { ws: this.ws, tab: this.tab, query: this.searchIn.value() });
    const row = groups[0]?.rows[0];
    if (!row) { this.sel = null; this.form = null; return; }
    this.sel = row.key;
    this.load(formFrom(this.entry()));
  }

  // Opens a secret (key) or a new one (null); unsaved edits ask for a second click.
  pick(key, cx) {
    const want = key ?? "+new";
    if (this.form && this.dirty() && this.pending !== want && !(this.form.isNew && key === null)) {
      this.pending = want;
      this.said = { kind: "note", message: "This secret has unsaved changes. Click again to drop them." };
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

  // Save is pressable: something to save, nothing running, Protected not blocked.
  canSave() {
    const f = this.fv();
    return Boolean(f) && !this.busy && this.dirty() && !blocked(f, { status: this.status, mac: macHere() });
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
    cx.notify();
    cx.spawn(async (cx) => {
      let failed = null;
      try {
        for (const step of steps) {
          const a = answerOf(await this.ingest(step, step.withValue ? value : null));
          if (!a.ok) { failed = a.error; break; }
        }
      } finally {
        value = null;
      }
      this.busy = null;
      this.waiting = false;
      await this.readMeta();
      if (failed) {
        // The form keeps the edit (a value must be typed again: it was sent).
        this.said = { kind: failed.kind === "denied" ? "denied" : "error", message: failed.message, field: failed.field };
      } else {
        this.sel = `${f.scope}/${f.name}`;
        const saved = this.entry();
        if (saved) this.load(formFrom(saved));
        this.said = { kind: "saved", message: "Saved." };
      }
      cx.notify();
    });
  }

  remove(cx) {
    const e = this.entry();
    if (!e || this.busy) return;
    if (!this.confirming) { this.confirming = true; cx.notify(); return; }
    this.busy = "delete";
    this.confirming = false;
    cx.notify();
    cx.spawn(async (cx) => {
      const a = answerOf(await this.ingest({ op: "rm", name: e.name, scope: e.scope, withValue: false }, null));
      this.busy = null;
      await this.readMeta();
      if (!a.ok) this.said = { kind: a.error.kind === "denied" ? "denied" : "error", message: a.error.message, field: null };
      else { this.sel = null; this.form = null; this.pickFirst(); this.said = null; }
      cx.notify();
    });
  }

  // Settings on one of its sections (vault, features); this dialog closes first, the typed value with it.
  openSettings(section) {
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
    this.valueIn.set_value("");
    // A save in flight: its handoff file may still hold the value, and the task writing it is
    // about to be cancelled. An exec started here still goes out.
    const inbox = this.inbox;
    this.inbox = null;
    if (inbox) await exec("rm", ["-f", inbox]).catch(() => null);
  }

  copyExample(text, cx) {
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", COPY, "sh", text]).catch((e) => ({ code: 1, stderr: errText(e) }));
      if (r.code === 0) { this.copiedAt = Date.now(); cx.timer.after(1600, (cx) => cx.notify()); }
      else this.said = { kind: "error", message: `Couldn't copy: ${String(r.stderr || "").trim()}` };
      cx.notify();
    });
  }

  onKey(e, cx) {
    if (e.key !== "escape") return;
    cx.stop_propagation();
    if (escStep(this.valueLen(), this.escAsked) === "ask") {
      this.escAsked = true;
      this.said = { kind: "note", message: "Press Esc again to close and drop the value you typed." };
      cx.notify();
      return;
    }
    this.dismiss();
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
      .child(div().text_size(11).text_color(t.dim).child("Esc to close"));

    let body;
    if (state === "off") {
      body = this.middle(t, "vault", "Secrets is off",
        "Turn it on in Settings > Features to see and add secrets. Nothing was deleted while it was off.",
        "Open Settings > Features", () => this.openSettings("features"));
    } else if (state === "empty" && this.loaded) {
      body = this.middle(t, "vault", "No secrets yet",
        "Store tokens and cookies here so agents can make authenticated calls through herdr-ws-secret without ever seeing or logging the value.",
        "New secret", (_e, cx) => this.pick(null, cx), "plus", this.metaError);
    } else if (!this.loaded) {
      body = div().flex_1();
    } else {
      body = h_flex().flex_1().min_h(0).items_stretch()
        .child(this.list(t, groups, mine, mac, wsName))
        .child(state === "no-results"
          ? this.middle(t, "search", `No secrets match “${query.trim() || (tab === "global" ? "Every workspace" : wsName)}”`,
            `Check the spelling or clear the filter to see all ${mine.length} secret${mine.length === 1 ? "" : "s"}${this.ws ? ` in ${wsName} and Every workspace` : ""}.`,
            "Clear search", (_e, cx) => { this.searchIn.set_value(""); this.tab = "all"; this.pickFirst(); cx.notify(); })
          : state === "none"
            ? v_flex().flex_1().p(20).text_size(12.5).text_color(t.muted).child("Pick a secret, or make a new one.")
            : this.editor(t, state, f, e, mac, wsName, now));
    }

    return v_flex().id("vault").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((ev, cx) => this.onKey(ev, cx))
      .child(head)
      .child(body);
  }

  // A centered page: an icon, a title, a few words and one button (empty, no match, off).
  middle(t, icon, title, words, label, action, buttonIcon = null, warning = null) {
    return v_flex().flex_1().min_w(0).items_center().justify_center().px(32).gap(10)
      .child(div().size(44).mb(4).flex().items_center().justify_center().rounded(10).bg(t.raised).border_1().border_color(t.border)
        .child(svg(ICON(icon)).size(16).text_color(t.muted)))
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child(title))
      .child(div().max_w(380).pb(8).text_size(12.5).line_height("19px").text_color(t.muted).text_center().child(words))
      .when(Boolean(warning), (el) => el.child(div().max_w(380).pb(6).text_size(12).text_color(t.blocked).text_center().child(warning)))
      .child(this.button(t, "v-middle", label, "primary", action, true, buttonIcon));
  }

  button(t, id, label, kind, action, enabled = true, icon = null) {
    return h_flex().id(id).h(32).px(13).gap(6).flex_none().items_center().rounded(8).border_1()
      .border_color(kind === "primary" ? t.solid : kind === "danger" ? t.border : t.input)
      .bg(kind === "primary" ? t.solid : kind === "danger" ? "#00000000" : t.raised)
      .text_color(kind === "primary" ? t.solid_foreground : kind === "danger" ? t.blocked : t.foreground)
      .text_size(12.5).when(kind !== "danger", (el) => el.font_medium())
      .when(!enabled, (el) => el.opacity(0.42))
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
      .on_click((_e, cx) => { this.tab = id; cx.notify(); })
      .child(label);
    const rowEl = (r) => {
      const isOn = this.sel === r.key;
      const tint = r.tone === "exp" ? t.blocked : r.tone === "prot" ? t.accent : t.muted;
      return h_flex().id(`v-row-${r.key}`).h(48).mx(6).mb(2).px(9).gap(9).flex_none().items_center().rounded(7).cursor_pointer()
        .when(isOn, (el) => el.bg(t.selected)).when(!isOn, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => this.pick(r.key, cx))
        .child(svg(ICON(r.icon === "shield" ? "shield" : "vault")).size(14).flex_none().text_color(tint))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().text_size(12.5).font_family("JetBrains Mono").text_color(r.tone === "exp" ? t.muted : t.foreground)
            .when(r.tone === "exp", (el) => el.line_through()).child(r.name))
          .child(div().truncate().text_size(11).text_color(t.dim).child(r.sub)))
        .when(Boolean(r.ttl), (el) => el.child(div().flex_none().text_size(11)
          .text_color(r.ttlTone === "exp" ? t.blocked : r.ttlTone === "soon" ? t.working : t.dim).child(r.ttl)));
    };
    return v_flex().w(272).flex_none().min_h(0).border_r(1).border_color(t.border).bg(t.chrome)
      .child(v_flex().p(10).gap(8)
        .child(h_flex().id("v-new").h(30).gap(6).items_center().justify_center().rounded(8).border_1().border_color(t.input).bg(t.raised)
          .text_size(12.5).font_medium().cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.pick(null, cx))
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
          .child(tabBtn("all", "All")).child(tabBtn("ws", wsName)).child(tabBtn("global", "Global")))))
      .child(v_flex().id("v-list").flex_1().min_h(0).pb(12).overflow_y_scrollbar()
        .when(Boolean(this.metaError), (el) => el.child(div().px(14).py(6).text_size(11.5).text_color(t.blocked).child(this.metaError)))
        .children(groups.map((g) => v_flex()
          .child(div().px(14).pt(10).pb(4).text_size(11).text_color(t.dim).child(g.title))
          .children(g.rows.map(rowEl)))))
      .when(Boolean(foot), (el) => el.child(h_flex().id("v-broker").px(12).py(9).gap(6).items_center().border_t(1).border_color(t.border)
        .text_size(11).text_color(t.dim)
        .when(!foot.on, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Open Settings > Secrets")
          .on_click(() => this.openSettings("vault")))
        .child(div().size(6).flex_none().rounded(3).bg(foot.on ? t.done : t.dim))
        .child(foot.text)));
  }

  editor(t, state, f, e, mac, wsName, now) {
    const valueLen = this.valueLen();
    const dirty = isDirty(f, e, valueLen);
    const block = blocked(f, { status: this.status, mac });
    const problems = this.shown ? this.problems() : [];
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
    const set = (patch) => { this.form = { ...this.form, ...patch }; this.said = this.said?.kind === "saved" ? null : this.said; this.escAsked = false; };

    // The tier cards.
    const card = (tier, icon, title, words) => {
      const chosen = f.tier === tier;
      const off = tier === "protected" && !mac;
      const needs = tier === "protected" && mac && !brokerUp(this.status) && this.status !== null;
      const badge = tier === "standard" ? (chosen ? "Selected" : "")
        : off ? "macOS only" : needs ? "Needs setup" : chosen ? "Keychain ACL" : "macOS broker";
      const warnLook = chosen && needs;
      return v_flex().id(`v-tier-${tier}`).flex_1().min_w(0).px(12).py(10).gap(3).rounded(8).border_1()
        .border_color(warnLook ? t.working + "8c" : chosen ? t.accent : t.input)
        .bg(warnLook ? t.working + "0f" : chosen ? t.selected : t.background)
        .when(off, (el) => el.opacity(0.5))
        .when(!off && !chosen && !this.busy, (el) => el.cursor_pointer().hover((s) => s.border_color(t.accent))
          .on_click((_e, cx) => { this.form = withTier(this.fv(), tier); this.said = null; cx.notify(); }))
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
      : h_flex().gap(8).items_center()
        .child(h_flex().flex_1().min_w(0).h(34).px(10).gap(8).items_center().rounded(8).border_1().border_color(t.border).bg(t.surface)
          .child(div().flex_1().text_size(13).text_color(t.muted).child("•••••••••••••"))
          .child(div().text_size(11.5).text_color(expired ? t.blocked : t.done).child(expired ? "Expired" : "Saved")))
        .when(!expired, (el) => el.child(this.button(t, "v-replace", "Replace value", "plain", (_e, cx) => { set({ replacing: true }); this.valueIn.focus(); cx.notify(); }, !this.busy)));

    const usage = f.mode === "http+cli" ? "http+cli" : "http";
    const shellChip = namesShell(f);
    const ttlOn = ttlShown(f, e);
    const ex = !f.isNew && e ? exampleFor(e) : null;
    const copied = Date.now() - this.copiedAt < 1500;
    const used = e ? lastUsedLabel(e, now) : "";

    // Blocked by the broker: the reason at the tier picker, with the way to Settings > Secrets.
    const blockNotice = !block || block.kind === "checking" ? null
      : block.kind === "not-mac"
        ? div().pt(8).text_size(11.5).text_color(t.dim).child("Protected needs macOS: the broker keeps secrets in the Keychain. Standard works here.")
        : notice("warn",
          f.isNew ? (block.installed ? "Protected broker isn't running" : "Protected broker isn't installed yet")
            : "Protected broker isn't running",
          f.isNew ? (block.installed ? "Start it in Settings > Secrets to store Protected secrets, or pick Standard to save now."
            : "Install the signed macOS helper in Settings > Secrets to store Protected secrets, or pick Standard to save now.")
            : "This secret can't be changed or used until it runs again. Start it in Settings > Secrets.",
          this.button(t, "v-open-settings", "Open Settings", "primary", () => this.openSettings("vault")));

    const form = v_flex().id(`v-form-${f.isNew ? "+new" : this.sel}`).flex_1().min_h(0).px(20).pt(18).pb(14).overflow_y_scrollbar()
      .child(top)
      .when(expired, (el) => el.child(notice("err", `This secret ${expiryDetail(e, now).replace(/^Expired/, "expired")}`,
        "Agents calling herdr-ws-secret are refused until you replace the value or extend expiry.",
        f.replacing ? null : this.button(t, "v-expired-replace", "Replace value", "primary", (_e, cx) => { set({ replacing: true }); this.valueIn.focus(); cx.notify(); }, !this.busy))))
      .when(f.isNew, (el) => el.child(label("Name", "Handle agents pass to herdr-ws-secret")).child(box(this.nameIn, "name", 2)).child(errorLine("name")))
      .child(label("Value", f.isNew ? "Masked · cannot be viewed after saving" : "Write-only · never shown after save"))
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
          .child(div().child(used.startsWith("Used") ? `Last used${used.slice(4)}` : used))
          .when(Boolean(e?.note), (el) => el.child(div().child("·")).child(div().child(`Note: ${e.note}`))))));

    // The footer: Delete (or Cancel for a new one), the line that says what Save will do or did, Save.
    const saving = this.busy === "save";
    const note = saving && this.waiting ? { text: "Waiting for your OK in the macOS dialog…", color: t.working }
      : saving ? { text: "Saving…", color: t.dim }
      : this.busy === "delete" ? { text: "Deleting…", color: t.dim }
      : said && said.kind === "denied" ? { text: said.message, color: t.blocked }
      : said && said.kind === "error" && !(said.field && fieldError(said.field)) ? { text: said.message, color: t.blocked }
      : said && said.kind === "note" ? { text: said.message, color: t.working }
      : said && said.kind === "saved" && !dirty ? { text: said.message, color: t.done }
      : this.confirming && e?.tier === "protected" ? { text: "Protected: it's removed from the Keychain too.", color: t.working }
      : asks.asks ? { text: `macOS will ask you to allow this: ${asks.what.join(", ")}`, color: t.working }
      : problems.length ? { text: "Fix what's marked above to save.", color: t.blocked }
      : { text: footNote(f, { status: this.status, mac }), color: t.dim };
    const saveLabel = saving ? "Saving…" : f.isNew ? "Save secret" : "Save";
    const foot = h_flex().flex_none().px(20).pt(10).pb(14).gap(8).items_center().border_t(1).border_color(t.border)
      .child(f.isNew
        ? this.button(t, "v-cancel", "Cancel", "plain", (_e, cx) => { this.valueIn.set_value(""); this.pending = null; this.pickFirst(); this.said = null; cx.notify(); }, !this.busy)
        : this.button(t, "v-delete", this.busy === "delete" ? "Deleting…" : this.confirming ? "Click again to delete" : "Delete", "danger", (_e, cx) => this.remove(cx), !this.busy))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(note.color).child(note.text))
      .child(this.button(t, "v-save", saveLabel, "primary", (_e, cx) => this.save(cx), this.canSave()));

    return v_flex().flex_1().min_w(0).min_h(0).child(form).child(foot);
  }
}
