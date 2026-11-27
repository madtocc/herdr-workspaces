// The Vault dialog's rules (main.js draws them): which state the dialog is in, what a row in
// the list says, the form a secret opens into, what may be saved, what Save sends to
// `herdr-ws-secret ingest` (never the value: main.js adds it to the handoff file itself),
// whether macOS will ask, and how the CLI's answer reads. No host calls, so `node --test`
// runs it; its one import is vaultfacts.js (pure too, copied from ws-switcher).

import { validName, scopeKey, scopeWorkspace, ttlMs, isExpired, parseHosts, parseCommands, isShellName, validateEntry, isWidening, expiryLabel, filterEntries, TTL_CHOICES } from "./vaultfacts.js";

export const VAULT_DIR = ".herdr/vault"; // under home; the CLI's HERDR_VAULT_DIR (for tests) isn't seen by a mod

// What each tier gives, said no bigger than it is (the review's S11), on the tier cards.
export const TIER_WORDS = {
  standard: "Encrypted on this computer. Keeps the value out of chats and of what agents print; programs running as you can still use it.",
  protected: "Only the signed Protected broker can read it. It goes only to the hosts and commands you allow.",
};
// Under Allowed commands: what allowing a command means (M2, S6).
export const COMMANDS_HINT = "A command you allow gets the value with whatever arguments the agent gives it: allow only tools that talk to fixed hosts and can't run other programs.";
// Under the Value box while one is typed: a one-line box drops a paste's line breaks (gpui-kit's
// single-line paste removes every \n), so a key file goes in through the CLI.
// main.js draws the command unbroken (LINE_BREAK_CMD), so a narrow box wraps before it, not inside it.
export const LINE_BREAK_CMD = "herdr-ws-secret put <name> --value-stdin < file";
export const LINE_BREAK_WORDS = "Line breaks are dropped here. For a key file or anything with line breaks:";
export const LINE_BREAK_HINT = `${LINE_BREAK_WORDS} ${LINE_BREAK_CMD}`;
export const META = "meta.json";
const HOUR = 3600 * 1000;

// ---- the broker, as `herdr-ws-secret broker status --json` says ----

// Protected can be saved and used now: the broker answers.
export const brokerUp = (status) => Boolean(status && status.installed && status.running);

// The list's bottom line: running (green dot), off (muted; opens Settings > Secrets), nothing off macOS
// or before the first answer. When the CLI gave no answer (status.noAnswer, made up by main.js),
// it says so, with why in tip, rather than calling the broker off.
export function brokerFoot(status, mac = true) {
  if (!mac || (status && status.platform && status.platform !== "macos")) return null;
  if (!status) return null;
  if (status.noAnswer) return { text: "Couldn't check the Protected broker", on: false, tip: status.error || null };
  return brokerUp(status) ? { text: "Protected broker running", on: true } : { text: "Protected broker off", on: false };
}

// The notice at the tier picker while Protected is blocked by the broker (blocked()'s "broker"):
// { title, words }, or null. With no answer from the CLI it gives that reason, not "isn't installed".
export function blockWords(block, { isNew = true, status = null } = {}) {
  if (!block || block.kind !== "broker") return null;
  if (status && status.noAnswer) {
    return { title: "Couldn't check the Protected broker",
      words: `${status.error || "herdr-ws-secret broker status gave no answer"}. ${isNew ? "Settings > Secrets says more; pick Standard to save now." : "This secret can't be changed until it answers. Settings > Secrets says more."}` };
  }
  if (!isNew) return { title: "Protected broker isn't running", words: "This secret can't be changed or used until it runs again. Start it in Settings > Secrets." };
  return block.installed
    ? { title: "Protected broker isn't running", words: "Start it in Settings > Secrets to store Protected secrets, or pick Standard to save now." }
    : { title: "Protected broker isn't installed yet", words: "Install the Protected broker in Settings > Secrets to store Protected secrets, or pick Standard to save now." };
}

// ---- the list ----

// The row's line under the name: its hosts, else its commands, else what it may do.
export function rowSub(e) {
  const hosts = (e.hosts || []).join(", ");
  if (hosts) return hosts;
  const cmds = (e.commands || []).map((c) => (typeof c === "string" ? c : c.name));
  if (cmds.length) return `CLI: ${cmds.join(", ")}`;
  if (e.tier === "protected") return e.mode === "http" ? "No host yet" : "No host or command yet";
  return e.mode === "http" ? "HTTP · any host" : "HTTP & CLI";
}

// One row: name, icon (shield: Protected; key: Standard), tone (prot | exp | ""), the line
// under it, the expiry at its right (soon: less than a day left).
export function rowView(e, now) {
  const expired = isExpired(e, now);
  const left = typeof e.expiresAt === "number" ? e.expiresAt - now : null;
  return {
    key: `${e.scope}/${e.name}`,
    name: e.name,
    scope: e.scope,
    icon: e.tier === "protected" ? "shield" : "key",
    tone: expired ? "exp" : e.tier === "protected" ? "prot" : "",
    sub: rowSub(e),
    ttl: expiryLabel(e, now),
    ttlTone: expired ? "exp" : left !== null && left < 24 * HOUR ? "soon" : "",
  };
}

// The list in its groups: the shown workspace's (titled with its name) then "Every workspace";
// a group with no rows is left out. tab: all | ws | global.
export function listGroups(entries, { query = "", tab = "all", ws = null, wsName = null, now = Date.now() } = {}) {
  const shown = filterEntries(entries, { query, tab, ws });
  const own = shown.filter((e) => e.scope !== "global");
  const glob = shown.filter((e) => e.scope === "global");
  const groups = [];
  if (own.length) groups.push({ title: wsName || ws || "This workspace", rows: own.map((e) => rowView(e, now)) });
  if (glob.length) groups.push({ title: "Every workspace", rows: glob.map((e) => rowView(e, now)) });
  return groups;
}

// The entries this dialog may show at all: the workspace's and every workspace's.
export const visibleEntries = (entries, ws) => filterEntries(entries, { query: "", tab: "all", ws });

// ---- the form ----

// The expiry choice an entry was given (expiresAt − updatedAt within two minutes of one), "never"
// for none, null when it matches none (an expiry set some other way).
export function inferTtl(e) {
  if (!e || typeof e.expiresAt !== "number") return "never";
  const from = typeof e.updatedAt === "number" ? e.updatedAt : e.createdAt;
  if (typeof from !== "number") return null;
  for (const c of TTL_CHOICES) {
    const ms = ttlMs(c);
    if (ms && Math.abs(e.expiresAt - from - ms) <= 2 * 60000) return c;
  }
  return null;
}

// A new secret's form: scope the shown workspace (else every workspace), tier and expiry from
// Settings > Secrets (Standard off macOS), the tier's own usage default.
export function newForm({ ws = null, tier = "standard", ttl = "24h", mac = true } = {}) {
  const t = mac && tier === "protected" ? "protected" : "standard";
  return { isNew: true, name: "", scope: scopeKey(ws), tier: t, mode: t === "protected" ? "http" : "http+cli", modeTouched: false,
    hosts: "", commands: "", allowShells: false, ttlPick: TTL_CHOICES.includes(ttl) ? ttl : "24h", note: "", replacing: true };
}

// An existing secret's form: what it has now; no expiry picked (the chips show inferTtl), the value
// not being replaced.
export function formFrom(e) {
  return { isNew: false, name: e.name, scope: e.scope, tier: e.tier, mode: e.mode, modeTouched: true,
    hosts: (e.hosts || []).join(", "), commands: (e.commands || []).map((c) => (typeof c === "string" ? c : c.name)).join(", "),
    allowShells: e.allowShells === true, ttlPick: null, note: e.note || "", replacing: false };
}

// The form with another tier: a new secret's usage follows the tier's default until it's picked.
export function withTier(form, tier) {
  const f = { ...form, tier };
  if (form.isNew && !form.modeTouched) f.mode = tier === "protected" ? "http" : "http+cli";
  if (tier !== "protected") f.allowShells = false;
  return f;
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const hostList = (text) => parseHosts(text).hosts;
const cmdList = (text) => parseCommands(text).commands.map((c) => c.path || c.name);
const entryCmds = (e) => (e.commands || []).map((c) => (typeof c === "string" ? c : c.name));

// What the form changes on an existing secret, field by field (hosts and commands compared as
// lists, so spacing doesn't count).
export function changes(form, e) {
  if (!e) return {};
  const out = {};
  if (form.tier !== e.tier) out.tier = form.tier;
  if (form.mode !== e.mode) out.mode = form.mode;
  const h = hostList(form.hosts);
  if (!sameList(h, e.hosts || [])) out.hosts = h;
  const c = cmdList(form.commands);
  if (!sameList(c, entryCmds(e))) out.commands = c;
  if (Boolean(form.allowShells) !== Boolean(e.allowShells)) out.allowShells = Boolean(form.allowShells);
  if (form.ttlPick) out.ttl = form.ttlPick;
  if ((form.note || "") !== (e.note || "")) out.note = form.note || "";
  return out;
}

// A box with words its rule refuses (parse's errors), typed so it differs from the saved text: an
// edit, though the list it reads is the saved one (Save then says why, in formProblems).
const refusedTyping = (text, saved, parse) => parse(text).errors.length > 0
  && String(text ?? "").trim() !== String(saved ?? "").trim();

// Whether Save has anything to do: a new secret always; an existing one when it changes, a value
// is being typed in, or hosts or commands hold what their rule refuses.
export function isDirty(form, e, valueLen = 0) {
  if (!form) return false;
  if (form.isNew) return true;
  const saved = e ? formFrom(e) : {};
  return Object.keys(changes(form, e)).length > 0 || (form.replacing && valueLen > 0)
    || refusedTyping(form.hosts, saved.hosts, parseHosts)
    || (form.mode === "http+cli" && refusedTyping(form.commands, saved.commands, parseCommands));
}

// The form as an entry (meta.json's shape), for validateEntry.
export function formEntry(form, now) {
  const ms = form.ttlPick ? ttlMs(form.ttlPick) : undefined;
  return {
    name: form.name, scope: form.scope, tier: form.tier, mode: form.mode,
    hosts: hostList(form.hosts), commands: form.mode === "http+cli" ? parseCommands(form.commands).commands : [],
    allowShells: form.tier === "protected" && Boolean(form.allowShells),
    expiresAt: ms === undefined ? null : ms === null ? null : now + ms,
    note: form.note || "",
  };
}

// Whether a typed command is a shell or interpreter (the form then offers "Allow shells").
export const namesShell = (form) => form.tier === "protected" && form.mode === "http+cli"
  && parseCommands(form.commands).commands.some((c) => isShellName(c.name));

// What stands in the way of saving, one per field (name, value, tier, mode, hosts, commands, note,
// ttl; the first found, so what's typed that can't be read comes before the rule it then breaks):
// the entry's own rules (validateEntry), a name taken in that scope, a missing value, a move to
// Protected the migrate would refuse (tierBlocks: Save isn't offered). The broker being off is
// blocked(), not a problem here.
export function formProblems(form, { entries = [], entry = null, valueLen = 0, now = Date.now() } = {}) {
  const out = [];
  const add = (field, message) => { if (!out.some((p) => p.field === field)) out.push({ field, message }); };
  if (form.isNew) {
    if (!form.name) add("name", "Give it a name");
    else if (!validName(form.name) && validName(form.name.toLowerCase())) add("name", `Names are lowercase: ${form.name.toLowerCase()}`);
    else if (!validName(form.name)) add("name", "A name is 1 to 64 of a-z 0-9 . _ - and starts with a letter or digit");
    else if (entries.some((e) => e.scope === form.scope && e.name === form.name)) {
      add("name", `There's already a secret called ${form.name} ${form.scope === "global" ? "for every workspace" : "here"}`);
    }
  }
  if ((form.isNew || form.replacing) && valueLen === 0) add("value", form.isNew ? "Type or paste the value" : "Type or paste the new value, or Cancel");
  for (const m of parseHosts(form.hosts).errors) add("hosts", m);
  // Commands typed while HTTP only aren't kept, so only then do their typos count.
  if (form.mode === "http+cli") for (const m of parseCommands(form.commands).errors) add("commands", m);
  // A move to Protected goes first (saveSteps: migrate, then the rest), and the CLI's migrate checks
  // the secret as it is saved now, as Protected with shells off: what it would refuse is said here,
  // on the tier, before anything is sent.
  if (entry && !form.isNew && entry.tier !== "protected" && form.tier === "protected") {
    const m = validateEntry({ ...entry, tier: "protected", allowShells: false }, { brokerUp: true });
    const why = m.errors.filter((x) => x.field !== "tier").map((x) => x.message).join("; ");
    if (why) add("tier", `${why}. Keep it Standard, make that change and Save; then move it to Protected.`);
  }
  const v = validateEntry(formEntry(form, now), {});
  for (const p of v.errors) {
    if (p.field === "name" && !form.isNew) continue;
    if (p.field === "commands" && form.mode !== "http+cli") continue;
    add(p.field === "expiresAt" ? "ttl" : p.field === "allowShells" ? "commands" : p.field, p.message);
  }
  return out;
}

// The problem that keeps Save from being offered at all, shown before Save is pressed: a move to
// Protected the CLI's migrate would refuse (formProblems' "tier").
export const tierBlocks = (problems) => (problems || []).find((p) => p.field === "tier") || null;

// Why Protected can't be saved here, or null: not macOS ("not-mac"), the broker's state not known
// yet ("checking": Save waits, nothing is said), or it isn't running ("broker": with installed true
// or false, for the words).
export function blocked(form, { status = null, mac = true } = {}) {
  if (!form || form.tier !== "protected") return null;
  if (!mac) return { kind: "not-mac" };
  if (!status) return { kind: "checking" };
  if (!brokerUp(status)) return { kind: "broker", installed: Boolean(status && status.installed) };
  return null;
}

// ---- saving ----

// What Save sends to `herdr-ws-secret ingest`, in order, each without the value (withValue: main.js
// adds it to that step's handoff file). A new secret: one put. An existing one: a tier change
// first (migrate, the value never typed again), then the new value (put: the whole policy, its
// expiry renewed: the chip picked, else the one it had, else the default) or the other changes
// (edit: only what changed).
export function saveSteps(form, e, { valueLen = 0, defaultTtl = "24h" } = {}) {
  const policy = (f) => ({ mode: f.mode, hosts: hostList(f.hosts), commands: f.mode === "http+cli" ? cmdList(f.commands) : [],
    allowShells: f.tier === "protected" && f.mode === "http+cli" && Boolean(f.allowShells), note: f.note || "" });
  if (form.isNew) {
    return [{ op: "put", name: form.name, scope: form.scope, tier: form.tier, ...policy(form), ttl: form.ttlPick || defaultTtl, withValue: true }];
  }
  const steps = [];
  const ch = changes(form, e);
  if (ch.tier) steps.push({ op: "migrate", name: e.name, scope: e.scope, tier: ch.tier, withValue: false });
  if (form.replacing && valueLen > 0) {
    steps.push({ op: "put", name: e.name, scope: e.scope, tier: form.tier, ...policy(form), ttl: form.ttlPick || inferTtl(e) || defaultTtl, withValue: true });
    return steps;
  }
  const patch = {};
  for (const k of ["mode", "hosts", "commands", "allowShells", "ttl", "note"]) if (k in ch) patch[k] = ch[k];
  if (patch.mode === "http") patch.commands = [];
  if (Object.keys(patch).length) steps.push({ op: "edit", name: e.name, scope: e.scope, ...patch, withValue: false });
  return steps;
}

// Whether Save will make macOS ask (the broker's own dialog): moving a Protected secret to
// Standard, or an edit that widens a Protected one (a host or command added, CLI turned on,
// shells allowed, a later expiry). what: the words for each.
export function saveAsks(form, e, now = Date.now()) {
  if (!e || form.isNew || e.tier !== "protected") return { asks: false, what: [] };
  if (form.tier === "standard") return { asks: true, what: ["moving it to Standard"] };
  if (form.replacing) return { asks: false, what: [] }; // a put brings its own value: never asks
  const ch = changes(form, e);
  const patch = {};
  if ("mode" in ch) patch.mode = ch.mode;
  if ("hosts" in ch) patch.hosts = ch.hosts;
  if ("commands" in ch) patch.commands = ch.commands;
  if ("allowShells" in ch) patch.allowShells = ch.allowShells;
  if ("ttl" in ch) { const ms = ttlMs(ch.ttl); patch.expiresAt = ms === null ? null : now + ms; }
  const w = isWidening(e, patch);
  return { asks: w.widens, what: w.what };
}

// What a step does, in words for the late notice and a save closed part way: text (what it
// saves), done (said once it went through), plural, asks (macOS's dialog, in a save of two steps:
// only a move to Standard; a one-step save asks as saveAsks says: stepAsks), check (how a later
// read tells it went through: "tier" once the tier is the target, "updated" once the secret was
// written after the step began).
export function stepWhat(step) {
  const tier = { standard: "Standard", protected: "Protected" }[step.tier] || step.tier;
  if (step.op === "migrate") return { text: `the move to ${tier}`, done: `It was moved to ${tier}`, plural: false, asks: step.tier === "standard", check: "tier", tier: step.tier };
  if (step.op === "put") return { text: "the new value", done: "The new value was saved", plural: false, asks: false, check: "updated", value: true };
  return { text: "your other changes", done: "Your other changes were saved", plural: true, asks: false, check: "updated" };
}

// The field a CLI error is about (its own `field`, else read from its words), or null.
export function errorField(error) {
  const f = error && error.field;
  if (f) return f === "expiresAt" ? "ttl" : f === "allowShells" ? "commands" : f;
  const m = String((error && error.message) || "").toLowerCase();
  if (/\bhosts?\b/.test(m)) return "hosts";
  if (/\bcommands?\b|\bshells?\b/.test(m)) return "commands";
  if (/\bnames?\b/.test(m)) return "name";
  if (/\bvalue\b/.test(m)) return "value";
  if (/\bexpir/.test(m)) return "ttl";
  if (/\bnote\b/.test(m)) return "note";
  return null;
}

const first = (s) => String(s || "").split("\n").map((l) => l.trim()).find(Boolean) || "";

// `herdr-ws-secret ingest`'s run ({ code, stdout, stderr }, null when it couldn't start):
// { ok, entry, error: { kind, message, field } }. denied (the person said no in macOS's dialog)
// (Don't Allow, or the dialog left a minute: the broker then counts it as no) reads "Not changed:
// the macOS dialog wasn't answered with Allow".
export function answerOf(r) {
  if (!r) return { ok: false, entry: null, error: { kind: "failed", message: "herdr-ws-secret couldn't be started", field: null } };
  let o = null;
  try { o = JSON.parse(String(r.stdout || "")); } catch { /* not an answer */ }
  if (o && o.ok === true && r.code === 0) return { ok: true, entry: o.entry || null, error: null };
  const err = (o && o.error) || {};
  const kind = err.kind || (r.code === 7 ? "denied" : r.code === 6 ? "broker" : "failed");
  const message = kind === "denied" ? "Not changed: the macOS dialog wasn't answered with Allow"
    : first(err.message) || first(r.stderr) || first(r.stdout) || `herdr-ws-secret exited ${r.code}`;
  return { ok: false, entry: null, error: { kind, message, field: kind === "denied" ? null : errorField({ field: err.field, message }) } };
}

// ---- words ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n) => String(n).padStart(2, "0");
// "25 Nov 11:00", local time.
export function when(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
function span(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(ms / HOUR);
  if (h < 48) return `${h}h`;
  return `${Math.round(ms / (24 * HOUR))}d`;
}

// The line beside "Expires": the new expiry once a chip is picked, else when it expires (or did).
export function expiresSub(form, e, now) {
  if (form.ttlPick && !form.isNew) {
    const ms = ttlMs(form.ttlPick);
    return ms === null ? "New expiry: never" : `New expiry ${when(now + ms)}`;
  }
  if (form.isNew) return "";
  if (!e || typeof e.expiresAt !== "number") return "Never expires";
  if (isExpired(e, now)) return `Expired ${when(e.expiresAt)} · pick one to renew from now`;
  return `Auto-expires ${when(e.expiresAt)} (${span(e.expiresAt - now)} left)`;
}

// The expiry chip shown as chosen: the one picked, else the one the secret was given; none for an
// expired one (picking a chip is what renews it).
export const ttlShown = (form, e, now = Date.now()) => form.ttlPick || (e && !isExpired(e, now) ? inferTtl(e) : null);

// The footer's quiet line beside Save, by what's being saved where.
export function footNote(form, { status = null, mac = true } = {}) {
  const b = blocked(form, { status, mac });
  if (b && b.kind === "checking") return "Checking the Protected broker…";
  if (b && b.kind === "broker" && status && status.noAnswer) return "Couldn't check the Protected broker";
  if (b && b.kind === "broker") return !form.isNew ? "Start the Protected broker in Settings > Secrets to change it"
    : b.installed ? "Start the Protected broker or switch to Standard" : "Install the Protected broker or switch to Standard";
  if (b) return "Protected needs macOS";
  if (form.isNew) return form.tier === "protected" ? "Encrypted & written to the Keychain by the Protected broker" : "Encrypted & written to ~/.herdr/vault";
  return form.tier === "protected" ? "Protected in macOS Keychain · no get command" : "Encrypted in ~/.herdr/vault · no get command";
}

// The scope's name for the pill and the chips: the workspace's name, or "Every workspace".
export const scopeName = (scope, wsName) => (scope === "global" ? "Every workspace" : wsName || scopeWorkspace(scope) || scope);

// ---- which state ----

// off (Vault is off in Settings > Features), empty (no secrets here), no-results (the search or
// tab matches none), new, blocked-broker (a new Protected one while the broker is off), expired,
// replacing, ready (an existing secret), none (nothing picked).
export function screenState({ on = true, entries = [], groups = [], query = "", tab = "all", form = null, entry = null, status = null, mac = true, now = Date.now() } = {}) {
  if (!on) return "off";
  if (!entries.length && !(form && form.isNew)) return "empty";
  if (form && form.isNew) return blocked(form, { status, mac })?.kind === "broker" ? "blocked-broker" : "new";
  if (!groups.length && (String(query).trim() || tab !== "all")) return "no-results";
  if (!form || !entry) return "none";
  if (form.replacing) return "replacing";
  if (isExpired(entry, now)) return "expired";
  return "ready";
}

// Whether closing (or leaving for Settings) would lose something: a new secret with anything typed
// in name, value, hosts, commands or note, or a choice changed from how it opened (start: the form
// it was loaded with); an existing one with unsaved changes or a value typed.
export function touched(form, { entry = null, valueLen = 0, start = null } = {}) {
  if (!form) return false;
  if (!form.isNew) return isDirty(form, entry, valueLen);
  if (valueLen > 0) return true;
  if (["name", "hosts", "commands", "note"].some((k) => String(form[k] ?? "").trim())) return true;
  if (!start) return false;
  return ["scope", "tier", "mode", "allowShells", "ttlPick"].some((k) => (form[k] ?? null) !== (start[k] ?? null));
}

// Closing (Esc or the header's ×): close, unless something would be lost (touched()) and it hasn't
// been asked once already.
export const escStep = (lose, askedOnce) => (lose && !askedOnce ? "ask" : "close");

// What one Esc does, in order: nothing while a save or delete runs ("wait": it must not stop half
// way), empties a typed search ("clear-search"), then escStep's ask or close. The × is the same
// without the search (query "").
export function escAction({ busy = false, query = "", lose = false, asked = false } = {}) {
  if (busy) return "wait";
  if (String(query).length) return "clear-search";
  return escStep(lose, asked);
}

// ---- a save or delete that waits (the review's S2) ----

// After this long in one step (the broker, or macOS's dialog, not answering), Esc and the × close again.
export const LATE_MS = 20000;
export const UNFINISHED = "screen-unfinished.json"; // in the vault folder: a save closed before its last step
const TIER_NAME = { standard: "Standard", protected: "Protected" };

// What closing now would leave, said in a notice above the footer once a step is late. job: { op:
// "save"|"delete", i (the step running, from 0), n (how many), steps (stepWhat of each, for a save),
// asks (saveAsks: for a one-step save) }. A dialog's tasks end when it closes, but a CLI run already
// started goes on: so the step running goes through (if it's allowed) and the ones after it never
// start. The words name the one that goes on and the ones that won't.
// Whether the step running now is the one macOS asks about: in a two-step save its own (a move to
// Standard), in a one-step save what saveAsks said for the save (job.asks).
export function stepAsks(job) {
  if (!job) return false;
  const now = (job.steps || [])[job.i];
  return job.n > 1 ? Boolean(now && now.asks) : Boolean(job.asks);
}
const andList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
export function lateWords(job) {
  const steps = job.steps || [];
  const now = steps[job.i];
  const title = stepAsks(job) ? "Still waiting for your OK in the macOS dialog" : "Still waiting for herdr-ws-secret";
  if (job.op === "save" && now && job.i < job.n - 1) {
    const rest = steps.slice(job.i + 1).map((x) => x.text);
    return { title, half: true,
      words: `You can close this: ${now.text} ${now.plural ? "go" : "goes"} on if ${now.plural ? "they're" : "it's"} allowed, but ${andList(rest)} won't be saved.` };
  }
  return { title, half: false, words: `You can close this: the ${job.op === "delete" ? "delete" : "save"} goes on without it, and is kept if it's allowed.` };
}

// The record a close during any but the last step of a save leaves (UNFINISHED's text), or null:
// the step that goes on (done, and how to tell it went through) and what won't be saved (lost).
export function unfinishedRecord(job, now = Date.now()) {
  if (!job || job.op !== "save" || !job.steps || job.i >= job.n - 1) return null;
  const step = job.steps[job.i];
  const rest = job.steps.slice(job.i + 1);
  return { key: job.key, done: step.done, check: step.check, tier: step.tier ?? null,
    lost: andList(rest.map((x) => x.text)), lostPlural: rest.length > 1 || rest.some((x) => x.plural), lostValue: rest.some((x) => x.value),
    startedAt: job.startedAt, at: now };
}

const DAY = 24 * HOUR;
// The record read back: { rec, note } where note ({ key, title, words }) is shown on that secret
// once its step went through after it began (the tier is the target, or the secret was written),
// and rec is null when the record can go (the secret is gone, or a week old, or the step never
// went through within the CLI's 5-minute limit and then some).
export function readUnfinished(text, entries, now = Date.now()) {
  let rec = null;
  try { rec = JSON.parse(String(text || "null")); } catch { rec = null; }
  if (!rec || typeof rec.key !== "string" || typeof rec.at !== "number" || typeof rec.done !== "string") return { rec: null, note: null };
  const e = (entries || []).find((x) => `${x.scope}/${x.name}` === rec.key);
  if (!e || now - rec.at > 7 * DAY) return { rec: null, note: null };
  const written = (e.updatedAt ?? 0) >= (rec.startedAt ?? rec.at) - 1000;
  const through = written && (rec.check !== "tier" || e.tier === rec.tier);
  if (!through) return { rec: now - rec.at > 10 * 60000 ? null : rec, note: null };
  const todo = rec.lostValue ? "replace the value again." : `make ${rec.lostPlural ? "them" : "it"} again and Save.`;
  return { rec, note: { key: rec.key, title: "The last save stopped part way",
    words: `${rec.done}, but ${rec.lost} ${rec.lostPlural ? "weren't" : "wasn't"} saved: ${todo}` } };
}

// The page in place of the list when meta.json can't be read (parseMeta's error): what's wrong
// with which file, and what to do. Nothing in it is lost: the values are elsewhere.
export function unreadable(metaError) {
  const what = String(metaError || "meta.json can't be read");
  const todo = /version/.test(what) ? "Update the Workspaces package to read it. The values aren't touched." : "The values aren't touched; fix or restore that file.";
  return { title: "Secrets couldn't be read", words: `~/${VAULT_DIR}/${what}. ${todo}` };
}

// The line beside "Value": while a value is typed, its length (the dots can't show an empty or
// wrong paste); else what happens to it.
export function valueSub(form, valueLen = 0) {
  if ((form.isNew || form.replacing) && valueLen > 0) return `Masked · ${valueLen} character${valueLen === 1 ? "" : "s"}`;
  return form.isNew ? "Masked · cannot be viewed after saving" : "Write-only · never shown after save";
}

// ↑ ↓ in the list: the row key after (step 1) or before (-1) the open one among the listed rows,
// held at the ends; with none of them open, the first. null: no rows.
export function moveKey(groups, sel, step) {
  const keys = (groups || []).flatMap((g) => g.rows.map((r) => r.key));
  if (!keys.length) return null;
  const at = keys.indexOf(sel);
  if (at < 0) return keys[0];
  return keys[Math.max(0, Math.min(keys.length - 1, at + step))];
}
