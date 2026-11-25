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
  protected: "Only the signed Keychain broker can read it. It goes only to the hosts and commands you allow.",
};
// Under Allowed commands: what allowing a command means (M2, S6).
export const COMMANDS_HINT = "A command you allow gets the value with whatever arguments the agent gives it: allow only tools that talk to fixed hosts and can't run other programs.";
export const META = "meta.json";
const HOUR = 3600 * 1000;

// ---- the broker, as `herdr-ws-secret broker status --json` says ----

// Protected can be saved and used now: the broker answers.
export const brokerUp = (status) => Boolean(status && status.installed && status.running);

// The list's bottom line: running (green dot), off (muted; opens Settings > Secrets), nothing off macOS
// or before the first answer.
export function brokerFoot(status, mac = true) {
  if (!mac || (status && status.platform && status.platform !== "macos")) return null;
  if (!status) return null;
  return brokerUp(status) ? { text: "Protected broker running", on: true } : { text: "Protected broker off", on: false };
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

// Whether Save has anything to do: a new secret always; an existing one when it changes or a
// value is being typed in.
export function isDirty(form, e, valueLen = 0) {
  if (!form) return false;
  if (form.isNew) return true;
  return Object.keys(changes(form, e)).length > 0 || (form.replacing && valueLen > 0);
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
// the entry's own rules (validateEntry), a name taken in that scope, a missing value. The broker
// being off is blocked(), not a problem here.
export function formProblems(form, { entries = [], entry = null, valueLen = 0, now = Date.now() } = {}) {
  const out = [];
  const add = (field, message) => { if (!out.some((p) => p.field === field)) out.push({ field, message }); };
  if (form.isNew) {
    if (!form.name) add("name", "Give it a name");
    else if (!validName(form.name)) add("name", "A name is 1 to 64 of a-z 0-9 . _ - and starts with a letter or digit");
    else if (entries.some((e) => e.scope === form.scope && e.name === form.name)) {
      add("name", `There's already a secret called ${form.name} ${form.scope === "global" ? "for every workspace" : "here"}`);
    }
  }
  if ((form.isNew || form.replacing) && valueLen === 0) add("value", form.isNew ? "Type or paste the value" : "Type or paste the new value, or Cancel");
  for (const m of parseHosts(form.hosts).errors) add("hosts", m);
  // Commands typed while HTTP only aren't kept, so only then do their typos count.
  if (form.mode === "http+cli") for (const m of parseCommands(form.commands).errors) add("commands", m);
  const v = validateEntry(formEntry(form, now), {});
  for (const p of v.errors) {
    if (p.field === "name" && !form.isNew) continue;
    if (p.field === "commands" && form.mode !== "http+cli") continue;
    add(p.field === "expiresAt" ? "ttl" : p.field === "allowShells" ? "commands" : p.field, p.message);
  }
  return out;
}

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
// reads "Not changed: it wasn't allowed".
export function answerOf(r) {
  if (!r) return { ok: false, entry: null, error: { kind: "failed", message: "herdr-ws-secret couldn't be started", field: null } };
  let o = null;
  try { o = JSON.parse(String(r.stdout || "")); } catch { /* not an answer */ }
  if (o && o.ok === true && r.code === 0) return { ok: true, entry: o.entry || null, error: null };
  const err = (o && o.error) || {};
  const kind = err.kind || (r.code === 7 ? "denied" : r.code === 6 ? "broker" : "failed");
  const message = kind === "denied" ? "Not changed: it wasn't allowed"
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
  if (isExpired(e, now)) return `Expired ${when(e.expiresAt)}`;
  return `Auto-expires ${when(e.expiresAt)} (${span(e.expiresAt - now)} left)`;
}

// The expiry chip shown as chosen: the one picked, else the one the secret was given.
export const ttlShown = (form, e) => form.ttlPick || (e ? inferTtl(e) : null);

// The footer's quiet line beside Save, by what's being saved where.
export function footNote(form, { status = null, mac = true } = {}) {
  const b = blocked(form, { status, mac });
  if (b && b.kind === "checking") return "Checking the Protected broker…";
  if (b && b.kind === "broker") return !form.isNew ? "Start the Protected broker in Settings > Secrets to change it"
    : b.installed ? "Start the Protected broker or switch to Standard" : "Install Protected broker or switch to Standard";
  if (b) return "Protected needs macOS";
  if (form.isNew) return form.tier === "protected" ? "Encrypted & written directly to macOS Keychain broker" : "Encrypted & written to ~/.herdr/vault";
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

// Esc: close, unless a value has been typed and Esc hasn't been pressed once already for it.
export const escStep = (valueLen, askedOnce) => (valueLen > 0 && !askedOnce ? "ask" : "close");
