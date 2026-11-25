// Herdr Vault's rules, kept apart from everything that reads files, runs commands or opens
// sockets, so `node --test` can check them and the ws-vault screen can use the same copy.
// Pure: no imports, nothing Node-only (Buffer, fs), so QuickJS runs it too. The one global
// it touches is URL, in redirectStep only (the CLI's, never the screen's).
//
// What a secret is here: a name, a scope ("global" or "ws:<workspace id>"), a tier
// ("standard": the CLI holds it, encrypted; "protected": the broker holds it in the Keychain),
// a mode ("http" or "http+cli"), the hosts and commands it may be used with, and an expiry.
// Its value never passes through this file except to be redacted.

// ---- names and scopes ----

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validName(name) {
  return typeof name === "string" && NAME_RE.test(name);
}

export function validWorkspace(id) {
  return typeof id === "string" && WS_RE.test(id);
}

// "ws:<id>" for a workspace, "global" for none.
export function scopeKey(wsId) {
  return wsId ? "ws:" + wsId : "global";
}

export function validScope(scope) {
  if (scope === "global") return true;
  return typeof scope === "string" && scope.startsWith("ws:") && validWorkspace(scope.slice(3));
}

// The workspace id in a scope, or null for global.
export function scopeWorkspace(scope) {
  return typeof scope === "string" && scope.startsWith("ws:") ? scope.slice(3) : null;
}

export function entryKey(scope, name) {
  return scope + "/" + name;
}

// A caller in workspace W gets ws:W/<name> first, then global/<name>.
export function resolveEntry(entries, wsId, name) {
  const list = entries || [];
  if (wsId) {
    const own = list.find((e) => e && e.scope === "ws:" + wsId && e.name === name);
    if (own) return own;
  }
  return list.find((e) => e && e.scope === "global" && e.name === name) || null;
}

// ---- expiry ----

export const TTL_CHOICES = ["4h", "24h", "7d", "30d", "never"];
const HOUR = 3600 * 1000;
const TTL_MS = { "4h": 4 * HOUR, "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR };

// ms for a choice, null for "never", undefined for anything else.
export function ttlMs(choice) {
  if (choice === "never") return null;
  return Object.prototype.hasOwnProperty.call(TTL_MS, choice) ? TTL_MS[choice] : undefined;
}

export function isExpired(entry, now) {
  return !!entry && typeof entry.expiresAt === "number" && now >= entry.expiresAt;
}

// ---- hosts ----

// Items from "a, b c" or a list.
function items(text) {
  if (Array.isArray(text)) return text.map((s) => String(s).trim()).filter(Boolean);
  return String(text || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

const LABEL_RE = /^[a-z0-9_-]{1,63}$/;

// A pattern split into { wild, host, port } (IPv6 keeps its brackets: "[::1]"), or null. The
// same rules as the broker: every trailing dot goes; a wildcard needs two labels after it
// (*.example.com, not *.com); a bare single label must be localhost.
function splitPattern(raw) {
  const t = String(raw).trim().toLowerCase();
  if (!t || t.length > 270) return null;
  let wild = false;
  let host;
  let portText = null;
  if (t.startsWith("[")) {
    const m = /^\[([a-z0-9:.]+)\](?::(.*))?$/.exec(t);
    if (!m || !m[1].includes(":")) return null;
    host = "[" + m[1] + "]";
    portText = m[2] === undefined ? null : m[2];
  } else {
    const i = t.lastIndexOf(":");
    host = i < 0 ? t : t.slice(0, i);
    portText = i < 0 ? null : t.slice(i + 1);
    host = host.replace(/\.+$/, "");
    if (host.startsWith("*.")) { wild = true; host = host.slice(2); }
    if (!host || host.includes(":")) return null;
    const labels = host.split(".");
    if (!labels.every((l) => LABEL_RE.test(l))) return null;
    if (wild && labels.length < 2) return null;
    if (!wild && labels.length < 2 && host !== "localhost") return null;
  }
  let port = null;
  if (portText !== null) {
    if (!/^\d{1,5}$/.test(portText)) return null;
    port = Number(portText);
    if (!(port >= 1 && port <= 65535)) return null;
  }
  return { wild, host, port };
}

function patternText(p) {
  return (p.wild ? "*." : "") + p.host + (p.port !== null ? ":" + p.port : "");
}

// Host patterns from what someone typed: host, host:port, *.domain (subdomains only), in the
// broker's form (lower case, no trailing dot).
export function parseHosts(text) {
  const hosts = [];
  const errors = [];
  for (const raw of items(text)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) { errors.push(`"${raw}" is a URL; give only its host`); continue; }
    const sp = splitPattern(raw);
    if (!sp) { errors.push(`"${raw}" isn't a host (host, host:port or *.domain; *.com and a bare name other than localhost are too wide)`); continue; }
    const p = patternText(sp);
    if (!hosts.includes(p)) hosts.push(p);
  }
  return { hosts, errors };
}

function normHost(host) {
  let h = String(host || "").toLowerCase().replace(/\.+$/, "");
  if (h.includes(":") && !h.startsWith("[")) h = "[" + h + "]";
  return h;
}

// Whether host (and port, a number or null) matches one of the patterns.
export function hostMatches(patterns, host, port) {
  const h = normHost(host);
  const pt = port === undefined || port === null || port === "" ? null : Number(port);
  for (const raw of patterns || []) {
    const p = splitPattern(raw);
    if (!p) continue;
    if (p.port !== null && p.port !== pt) continue;
    if (p.wild ? h.endsWith("." + p.host) && h.length > p.host.length + 1 : h === p.host) return true;
  }
  return false;
}

// ---- commands ----

const SHELLS = ["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "node", "deno", "bun",
  "python", "python2", "python3", "ruby", "perl", "php", "lua", "osascript"];
const WRAPPERS = ["git", "busybox", "env", "xargs", "sudo", "nice", "nohup", "time", "command", "exec", "eval", "make",
  "awk", "gawk", "mawk", "nawk", "arch", "caffeinate", "xcrun", "script", "timeout", "gtimeout", "find", "ssh",
  "npx", "uvx", "pipx", "bunx", "swift", "tclsh", "expect", "pwsh", "rscript", "java", "open", "watch", "parallel"];
export const SHELL_NAMES = SHELLS.concat(WRAPPERS);

function baseName(p) {
  const s = String(p || "");
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

// A shell, an interpreter, or a wrapper that runs something else (the broker's list, any case;
// versioned interpreters too: python3.12, perl5.34, ruby3.3, node22, php8.3, lua5.4).
export function isShellName(name) {
  const b = baseName(name).toLowerCase();
  return SHELL_NAMES.includes(b) || /^(python|perl|ruby|php|lua|node)[0-9][0-9.]*$/.test(b);
}

const CMD_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

// Commands from "psql, /opt/bin/stripe": { name, path } each (path null for a bare name; a
// Protected entry's names get their path when the broker pins them).
export function parseCommands(text) {
  const commands = [];
  const errors = [];
  for (const raw of items(text)) {
    let c;
    if (raw.startsWith("/")) {
      const name = baseName(raw);
      if (!CMD_RE.test(name) || raw.includes("/../") || raw.endsWith("/..")) { errors.push(`"${raw}" isn't a command path`); continue; }
      c = { name, path: raw };
    } else if (CMD_RE.test(raw)) {
      c = { name: raw, path: null };
    } else {
      errors.push(`"${raw}" isn't a command (a name like psql, or an absolute path)`);
      continue;
    }
    if (!commands.some((x) => x.name === c.name && x.path === c.path)) commands.push(c);
  }
  return { commands, errors };
}

// Whether argv0 (a bare name or a path) may run with this entry's secret.
export function commandAllowed(entry, argv0) {
  if (!entry) return { ok: false, why: "no such secret" };
  if (entry.mode !== "http+cli") return { ok: false, why: `${entry.name} is for HTTP only` };
  const word = String(argv0 || "");
  if (!word) return { ok: false, why: "no command" };
  const name = baseName(word);
  const protectedTier = entry.tier === "protected";
  const list = entry.commands || [];
  if (protectedTier && isShellName(name) && !entry.allowShells) {
    return { ok: false, why: `${name} is a shell or runs other programs; ${entry.name} doesn't allow shells` };
  }
  if (!list.length) {
    if (protectedTier) return { ok: false, why: `${entry.name} has no commands it may run with` };
    return { ok: true, why: "" };
  }
  for (const c of list) {
    const cname = typeof c === "string" ? c : c && c.name;
    const cpath = typeof c === "string" ? null : c && c.path;
    if (word.includes("/")) {
      if (cpath ? word === cpath : name === cname && !protectedTier) return { ok: true, why: "" };
    } else if (name === cname) {
      return { ok: true, why: "" };
    }
  }
  return { ok: false, why: `${name} isn't one of the commands ${entry.name} may run with` };
}

// ---- an entry as a whole ----

const MODES = ["http", "http+cli"];
const TIERS = ["standard", "protected"];

// Whether an entry (meta.json's shape) can be saved. brokerUp: whether Protected can be used now.
export function validateEntry(entry, opts) {
  const errors = [];
  const e = entry || {};
  const add = (field, message) => errors.push({ field, message });
  if (!validName(e.name)) add("name", "A name is 1 to 64 of a-z 0-9 . _ - and starts with a letter or digit");
  if (!validScope(e.scope)) add("scope", "The scope is a workspace or every workspace");
  if (!TIERS.includes(e.tier)) add("tier", "The tier is Standard or Protected");
  if (!MODES.includes(e.mode)) add("mode", "Use is HTTP only, or HTTP and CLI");
  const hosts = e.hosts || [];
  const hp = parseHosts(hosts);
  for (const m of hp.errors) add("hosts", m);
  const cmds = e.commands || [];
  for (const c of cmds) {
    const r = parseCommands([typeof c === "string" ? c : (c && (c.path || c.name)) || ""]);
    for (const m of r.errors) add("commands", m);
  }
  if (cmds.length && e.mode === "http") add("commands", "Commands need HTTP and CLI use");
  if (e.expiresAt !== null && e.expiresAt !== undefined && !(typeof e.expiresAt === "number" && isFinite(e.expiresAt))) {
    add("expiresAt", "The expiry is a time or never");
  }
  if (e.note !== undefined && e.note !== null) {
    if (typeof e.note !== "string" || /[\r\n]/.test(e.note)) add("note", "The note is one line");
    else if (e.note.length > 200) add("note", "The note is at most 200 characters");
  }
  if (e.tier === "protected") {
    if (opts && opts.brokerUp === false) add("tier", "Protected needs the broker: turn it on in Settings > Secrets");
    if (e.mode === "http" && !hosts.length) add("hosts", "A Protected secret for HTTP needs at least one host");
    if (e.mode === "http+cli" && !hosts.length && !cmds.length) add("hosts", "A Protected secret needs at least one host or command");
    for (const c of cmds) {
      const n = typeof c === "string" ? c : c && c.name;
      if (isShellName(n) && !e.allowShells) add("commands", `${n} is a shell or runs other programs; allow shells to use it`);
    }
  } else if (e.allowShells) {
    add("allowShells", "Allowing shells is for Protected secrets");
  }
  return { ok: errors.length === 0, errors };
}

// Whether a patch gives a secret more reach than it had, and what it adds, in words.
// Only the fields in the patch count; a missing one stays as it was.
export function isWidening(oldPolicy, patch) {
  const o = oldPolicy || {};
  const p = patch || {};
  const what = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  const standard = o.tier === "standard";
  if (has("hosts")) {
    const oldH = o.hosts || [];
    const newH = parseHosts(p.hosts || []).hosts;
    if (standard && oldH.length && !newH.length) what.push("any host");
    for (const h of newH) if (!oldH.includes(h)) what.push("host " + h);
  }
  if (has("mode") && p.mode === "http+cli" && o.mode !== "http+cli") what.push("use from the command line");
  if (has("commands")) {
    const oldC = (o.commands || []).map((c) => (typeof c === "string" ? c : c.path || c.name));
    const newC = (p.commands || []).map((c) => (typeof c === "string" ? c : c.path || c.name));
    if (standard && oldC.length && !newC.length) what.push("any command");
    for (const c of newC) {
      const known = oldC.includes(c) || (o.commands || []).some((x) => typeof x === "object" && x && x.name === c && x.path);
      if (!known) what.push("command " + c);
    }
  }
  if (has("allowShells") && p.allowShells && !o.allowShells) what.push("shells and interpreters");
  if (has("expiresAt")) {
    const oe = o.expiresAt === undefined ? null : o.expiresAt;
    const ne = p.expiresAt === undefined ? null : p.expiresAt;
    if (oe !== null && (ne === null || ne > oe)) what.push(ne === null ? "no expiry" : "a later expiry");
  }
  return { widens: what.length > 0, what };
}

// ---- placeholders ----

const PH_RE = /\{\{secret:([a-z0-9][a-z0-9._-]{0,63})\}\}/g;

// The names in {{secret:<name>}} placeholders, each once, in order.
export function findPlaceholders(text) {
  const out = [];
  const s = String(text || "");
  PH_RE.lastIndex = 0;
  let m;
  while ((m = PH_RE.exec(s))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Each placeholder whose name is in values ({ name: value }) replaced by its value; others kept.
export function fillPlaceholders(text, values) {
  return String(text || "").replace(PH_RE, (all, name) =>
    values && Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all);
}

// ---- redaction ----

// A JS string as its UTF-8 bytes.
function utf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

const HEX = "0123456789abcdef";
function hex(bytes) {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

// Percent-encoding keeping `keep` (a regexp of one character), hex in the case asked, and
// optionally "+" for a space (form encoding).
const URI_COMPONENT = /[A-Za-z0-9\-_.!~*'()]/;
const UNRESERVED = /[A-Za-z0-9\-_.~]/;
function percent(bytes, keep, upper, plus) {
  let out = "";
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (b < 128 && keep.test(ch)) out += ch;
    else if (plus && b === 32) out += "+";
    else {
      const h = HEX[b >> 4] + HEX[b & 15];
      out += "%" + (upper ? h.toUpperCase() : h);
    }
  }
  return out;
}

// The bytes of a JSON string's inside: \" \\ (and \/ when slash), \b \f \n \r \t, \u00xx for
// the other control characters; everything else as it is.
function jsonEscaped(bytes, slash) {
  const out = [];
  const esc = { 34: 34, 92: 92, 8: 98, 12: 102, 10: 110, 13: 114, 9: 116 };
  for (const b of bytes) {
    if (esc[b] !== undefined) out.push(92, esc[b]);
    else if (b === 47 && slash) out.push(92, 47);
    else if (b < 32) for (const c of "\\u00" + HEX[b >> 4] + HEX[b & 15]) out.push(c.charCodeAt(0));
    else out.push(b);
  }
  return out;
}

// UTF-8 bytes back to a JS string (bad sequences become U+FFFD).
function fromUtf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let c = 0xfffd;
    let n = 1;
    if (b < 0x80) c = b;
    else if (b >= 0xc2 && b < 0xe0 && (bytes[i + 1] & 0xc0) === 0x80) { c = ((b & 31) << 6) | (bytes[i + 1] & 63); n = 2; }
    else if (b >= 0xe0 && b < 0xf0 && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80) { c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); n = 3; }
    else if (b >= 0xf0 && b < 0xf5 && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80 && (bytes[i + 3] & 0xc0) === 0x80) {
      c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); n = 4;
    }
    out += String.fromCodePoint(c);
    i += n;
  }
  return out;
}

export const SHORT_SECRET = 6;

// Every form a value may show up in, the same list as the broker's: exact; percent-encoded as
// encodeURIComponent does and with only unreserved characters kept, each with upper- and
// lower-case hex and with "+" for a space; base64 and base64url, with and without padding; hex
// in both cases; the inside of a JSON string, with "/" as it is and as "\/"; and, for a value
// with line breaks, each line of 6 bytes or more with at least 8 letters or digits, by itself. A value shorter than 6 bytes only in
// its exact form (its encodings would match too much). Not caught: a value inside a larger
// encoded blob (base64 of "user:token"), or one changed any other way.
// opts.bytes: the value is a byte string (one char per byte, as Node's "latin1"), and so are
// the forms; the CLI redacts output that way so binary output passes through untouched.
export function secretForms(value, opts) {
  const v = String(value === undefined || value === null ? "" : value);
  if (!v) return [];
  const asBytes = !!(opts && opts.bytes);
  const bytes = asBytes ? Array.from(v, (c) => c.charCodeAt(0) & 255) : utf8(v);
  const text = (arr) => (asBytes ? String.fromCharCode(...arr) : fromUtf8(arr));
  const forms = [v];
  if (bytes.length >= SHORT_SECRET) {
    for (const keep of [URI_COMPONENT, UNRESERVED]) {
      for (const upper of [true, false]) {
        forms.push(percent(bytes, keep, upper, false), percent(bytes, keep, upper, true));
      }
    }
    const b = base64(bytes);
    const u = b.replace(/\+/g, "-").replace(/\//g, "_");
    const h = hex(bytes);
    forms.push(b, b.replace(/=+$/, ""), u, u.replace(/=+$/, ""), h, h.toUpperCase());
    forms.push(text(jsonEscaped(bytes, false)), text(jsonEscaped(bytes, true)));
    if (bytes.includes(10) || bytes.includes(13)) {
      let line = [];
      const lines = [];
      for (const x of bytes) {
        if (x === 10) { lines.push(line); line = []; } else line.push(x);
      }
      lines.push(line);
      for (const l of lines) {
        if (l[l.length - 1] === 13) l.pop();
        // Only a line with 8 letters or digits or more: a line of dashes or spaces (an armour
        // line) would match other output.
        const alnum = l.filter((x) => (x >= 48 && x <= 57) || (x >= 65 && x <= 90) || (x >= 97 && x <= 122)).length;
        if (l.length >= SHORT_SECRET && alnum >= 8) forms.push(text(l));
      }
    }
  }
  const seen = [];
  for (const f of forms) if (f && !seen.includes(f)) seen.push(f);
  return seen;
}

function marker(name) {
  return "[secret:" + name + "]";
}

// The forms of every secret, longest first, indexed by first character.
function formTable(secrets, opts) {
  const all = [];
  for (const s of secrets || []) {
    if (!s) continue;
    for (const f of secretForms(s.value, opts)) all.push({ form: f, mark: marker(s.name) });
  }
  all.sort((a, b) => b.form.length - a.form.length);
  const byFirst = new Map();
  for (const x of all) {
    const k = x.form[0];
    if (!byFirst.has(k)) byFirst.set(k, []);
    byFirst.get(k).push(x);
  }
  const maxLen = all.length ? all[0].form.length : 0;
  return { byFirst, maxLen };
}

// One left-to-right pass: at each place the longest form that starts there becomes its
// marker, and the scan goes on after it (so a marker is never scanned again). Unless `final`,
// it stops at the first place near the end where what's left is the start of a form that isn't
// all here yet: that tail is held back for the next piece, and everything before it can go.
// Returns the text made, the rest held back, and how many it replaced.
function scan(table, text, final) {
  let out = "";
  let i = 0;
  let plainFrom = 0;
  let count = 0;
  const n = text.length;
  while (i < n) {
    const cands = table.byFirst.get(text[i]);
    let hit = null;
    if (cands) {
      const left = n - i;
      let wait = false;
      for (const c of cands) {
        if (c.form.length <= left) {
          if (text.startsWith(c.form, i)) { hit = c; break; }
        } else if (!final && c.form.startsWith(text.slice(i))) {
          wait = true;
          break;
        }
      }
      if (wait) break;
    }
    if (hit) {
      out += text.slice(plainFrom, i) + hit.mark;
      i += hit.form.length;
      plainFrom = i;
      count++;
    } else {
      i++;
    }
  }
  out += text.slice(plainFrom, i);
  return { text: out, rest: text.slice(i), count };
}

// Every form of every secret ([{ name, value }]) in text replaced by [secret:<name>].
export function redact(text, secrets, opts) {
  const table = formTable(secrets, opts);
  const s = String(text === undefined || text === null ? "" : text);
  if (!table.maxLen) return { text: s, count: 0 };
  const r = scan(table, s, true);
  return { text: r.text, count: r.count };
}

// The same, for text that comes in pieces: push(chunk) gives what's safe to show so far and
// holds back only an end that might still be the start of a form (so a line a command prints
// shows at once); end() gives the rest. The joined
// output is exactly redact() of the joined input, wherever the pieces were cut.
export function makeRedactor(secrets, opts) {
  const table = formTable(secrets, opts);
  let held = "";
  let count = 0;
  return {
    push(chunk) {
      held += String(chunk === undefined || chunk === null ? "" : chunk);
      if (!table.maxLen) { const t = held; held = ""; return t; }
      const r = scan(table, held, false);
      held = r.rest;
      count += r.count;
      return r.text;
    },
    end() {
      if (!table.maxLen) { const t = held; held = ""; return t; }
      const r = scan(table, held, true);
      held = "";
      count += r.count;
      return r.text;
    },
    get count() { return count; },
  };
}

// ---- redirects ----

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];

export function isLoopbackHost(host) {
  return LOOPBACK.includes(String(host || "").toLowerCase());
}

// https anywhere; http only to a loopback host.
export function schemeAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

function portOf(u) {
  return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : null;
}

function originOf(u) {
  return u.protocol + "//" + u.hostname.toLowerCase().replace(/\.+$/, "") + ":" + portOf(u);
}

// Whether a secret (as an entry: tier, hosts) may go to url's host. A Standard one without hosts
// goes anywhere on a first request, but a redirect takes it only back to that first request's
// origin (scheme, host, port): give that as `origin`.
export function secretAllowsUrl(secret, url, origin) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const hosts = (secret && secret.hosts) || [];
  if (!hosts.length) {
    if (!secret || secret.tier !== "standard") return false;
    if (!origin) return true;
    try { return originOf(new URL(origin)) === originOf(u); } catch { return false; }
  }
  return hostMatches(hosts, u.hostname, u.port ? Number(u.port) : null) ||
    hostMatches(hosts, u.hostname, portOf(u));
}

// What to do with a 3xx. from: the URL asked; to: its Location (may be relative); origin: the
// first request's URL in the chain (default: from); secrets:
// [{ name, value, tier, hosts, inHeaders, inQuery, inBody }] for the secrets this request
// carries. Same scheme, host and port, or an https (or loopback http) URL every secret allows:
// go on as is. Anywhere else: headers that held a secret are dropped, and when the query or a
// re-sent body (307/308) held one, or the Location itself holds one in any form, it isn't
// followed. 301/302 turn a POST into a GET without a body, 303 everything but HEAD.
// Returns { follow, stripSecretHeaders, why, url, method, keepBody } (method: "same" | "GET").
export function redirectStep({ from, to, status, secrets, method, origin }) {
  const out = { follow: false, stripSecretHeaders: false, why: "", url: null, method: "same", keepBody: true };
  let a;
  let b;
  try {
    a = new URL(from);
    b = new URL(to, from);
  } catch {
    out.why = "the redirect's Location isn't a URL";
    return out;
  }
  out.url = b.href;
  const m = String(method || "GET").toUpperCase();
  if (status === 303 && m !== "HEAD") { out.method = "GET"; out.keepBody = false; }
  else if ((status === 301 || status === 302) && m === "POST") { out.method = "GET"; out.keepBody = false; }
  const list = secrets || [];
  if (!schemeAllowed(b.href)) {
    out.why = `not following a redirect to ${b.protocol}//${b.host}: only https (or http to this computer)`;
    return out;
  }
  const sameOrigin = originOf(a) === originOf(b);
  const first = origin || from;
  if (sameOrigin || (b.protocol === "https:" || isLoopbackHost(b.hostname)) && list.every((s) => secretAllowsUrl(s, b.href, first))) {
    out.follow = true;
    out.why = sameOrigin ? "same host" : "a host every secret allows";
    return out;
  }
  const resent = out.keepBody && (status === 307 || status === 308);
  for (const s of list) {
    if (redact(to, [s]).count) { out.why = `not following a redirect to ${b.host}: its Location holds ${s.name}`; return out; }
    if (s.inQuery) { out.why = `not following a redirect to ${b.host}: ${s.name} was in the URL`; return out; }
    if (s.inBody && resent) { out.why = `not following a ${status} to ${b.host}: it would send ${s.name} in the body again`; return out; }
  }
  out.follow = true;
  out.stripSecretHeaders = list.some((s) => s.inHeaders);
  out.why = out.stripSecretHeaders ? `secret headers dropped for ${b.host}` : `to ${b.host}`;
  return out;
}

// ---- request headers ----

// Headers a request that names a secret may not set: they'd change where or how it's sent (the
// broker refuses the same ones).
export const REFUSED_REQUEST_HEADERS = ["host", "connection", "transfer-encoding", "content-length", "upgrade", "te", "trailer",
  "keep-alive", "forwarded", "x-original-host", "x-host", "x-http-host-override"];
export const REFUSED_REQUEST_HEADER_PREFIXES = ["proxy-", "x-forwarded-"];

export function headerRefused(name) {
  const n = String(name || "").trim().toLowerCase();
  return REFUSED_REQUEST_HEADERS.includes(n) || REFUSED_REQUEST_HEADER_PREFIXES.some((p) => n.startsWith(p));
}

// ---- secret_env ----

const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Names a secret may not be bound to: they change how a program starts (the broker's list).
export const REFUSED_ENV_NAMES = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TERM", "LANG", "TZ", "IFS",
  "ENV", "BASH_ENV", "ZDOTDIR", "SHELLOPTS", "BASHOPTS", "PS4", "PROMPT_COMMAND", "CDPATH",
  "GLOBIGNORE", "EDITOR", "VISUAL", "PAGER", "BROWSER", "NODE_OPTIONS", "NODE_PATH", "PERLLIB"];
export const REFUSED_ENV_PREFIXES = ["LC_", "PYTHON", "PERL5", "RUBY", "LD_", "DYLD_", "GIT_", "BASH_FUNC_", "HERDR_"];

// Why a variable name can't hold a secret, or null when it can.
export function envNameProblem(name) {
  if (typeof name !== "string" || !ENV_RE.test(name)) return `"${name}" isn't a variable name`;
  if (REFUSED_ENV_NAMES.includes(name) || REFUSED_ENV_PREFIXES.some((p) => name.startsWith(p)) || name.endsWith("_ASKPASS")) {
    return `${name} changes how a program starts, so it can't hold a secret: pick another name`;
  }
  return null;
}

export function validEnvName(name) {
  return envNameProblem(name) === null;
}

// "A=x, B=y", or one "A=x" a line: [{ env, name }] and what didn't read.
export function parseSecretEnv(text) {
  const pairs = [];
  const errors = [];
  const parts = String(text || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const i = p.indexOf("=");
    const env = i < 0 ? p : p.slice(0, i).trim();
    const name = i < 0 ? "" : p.slice(i + 1).trim();
    if (i < 0 || !ENV_RE.test(env) || !validName(name)) {
      errors.push(`"${p}" isn't VAR=secret-name`);
      continue;
    }
    const why = envNameProblem(env);
    if (why) { errors.push(why); continue; }
    if (pairs.some((x) => x.env === env)) { errors.push(`${env} is given twice`); continue; }
    pairs.push({ env, name });
  }
  return { pairs, errors };
}

// ---- usage ----

const USAGE_KEYS = ["at", "name", "scope", "tier", "via", "target", "ws", "agent", "terminal", "ok"];
const WHY = ["refused", "expired", "denied", "failed"];

// One usage.jsonl line (without its newline): only these fields, never a value. A use that
// didn't go through has ok: false, and may say why in one word (refused, expired, denied,
// failed; never the error's text). The broker's lines don't carry why.
export function usageLine(event) {
  const e = event || {};
  const o = {};
  for (const k of USAGE_KEYS) o[k] = e[k] === undefined ? null : e[k];
  o.ok = e.ok !== false;
  if (!o.ok && WHY.includes(e.why)) o.why = e.why;
  return JSON.stringify(o);
}

export function parseUsage(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && typeof e.name === "string" && typeof e.at === "number") out.push(e);
    } catch { /* a torn line */ }
  }
  return out;
}

// A Bell note for a use, by the notify setting (off | protected | always): null for none.
// A use: "<name> used", "claude in t12 (acme) · HTTP to develop.example.com". An attempt that
// didn't go through: "claude tried to use <name>", "refused: host not allowed (evil.example.net)".
export function usageNote(event, level) {
  const e = event || {};
  if (level === "off" || !level) return null;
  if (level === "protected" && e.tier !== "protected") return null;
  if (level !== "protected" && level !== "always") return null;
  const where = [e.terminal ? "in " + e.terminal : "", e.ws ? `(${e.ws})` : ""].filter(Boolean).join(" ");
  const how = e.via === "run" ? `ran ${e.target || "a command"}` : `HTTP to ${e.target || "a host"}`;
  if (e.ok !== false) {
    const who = [e.agent, where].filter(Boolean).join(" ") || "something";
    return { title: `${e.name} used`, body: `${who} · ${how}` };
  }
  const thing = e.via === "run" ? "command" : "host";
  const reason = {
    refused: `refused: ${thing} not allowed${e.target ? ` (${e.target})` : ""}`,
    expired: "refused: it has expired",
    denied: "you said no",
    failed: `failed: ${how}`,
  }[e.why] || `didn't go through: ${how}`;
  return { title: `${e.agent || "something"} tried to use ${e.name}`, body: where ? `${reason} · ${where}` : reason };
}

// ---- labels for the screen ----

function cmdNames(entry) {
  return (entry.commands || []).map((c) => (typeof c === "string" ? c : c.name));
}

// "HTTP only · develop.example.com" | "HTTP + CLI · psql" | "HTTP & CLI · any host".
export function usageLabel(entry) {
  const e = entry || {};
  const hosts = (e.hosts || []).join(", ");
  const cmds = cmdNames(e);
  if (e.mode === "http+cli" && cmds.length) return "HTTP + CLI · " + cmds.join(", ");
  if (e.mode === "http+cli" && e.tier !== "protected") return "HTTP & CLI · " + (hosts || "any host");
  // A Protected entry with no commands can't run anything: it's HTTP only in practice.
  return "HTTP only · " + (hosts || (e.tier === "protected" ? "no host yet" : "any host"));
}

function span(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return m + "m";
  const h = Math.round(ms / HOUR);
  if (h < 48) return h + "h";
  return Math.round(ms / (24 * HOUR)) + "d";
}

// "18h" | "5d" | "Expired" | "" (never expires).
export function expiryLabel(entry, now) {
  if (!entry || typeof entry.expiresAt !== "number") return "";
  if (isExpired(entry, now)) return "Expired";
  return span(entry.expiresAt - now);
}

// "Expires in 18h" | "Expired 2h ago" | "Never expires".
export function expiryDetail(entry, now) {
  if (!entry || typeof entry.expiresAt !== "number") return "Never expires";
  if (isExpired(entry, now)) return `Expired ${span(now - entry.expiresAt)} ago`;
  return `Expires in ${span(entry.expiresAt - now)}`;
}

// "Used 4m ago by claude" | "Never used".
export function lastUsedLabel(entry, now) {
  if (!entry || typeof entry.lastUsedAt !== "number") return "Never used";
  return `Used ${span(Math.max(0, now - entry.lastUsedAt))} ago` + (entry.lastUsedBy ? ` by ${entry.lastUsedBy}` : "");
}

function envFor(name) {
  return String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "SECRET";
}

// The command line under "How agents use it".
export function exampleFor(entry) {
  const e = entry || {};
  const cmds = cmdNames(e);
  const ph = `{{secret:${e.name}}}`;
  if (e.mode === "http+cli" && cmds.length) {
    return `herdr-ws-secret run --env ${envFor(e.name)}=${e.name} -- ${cmds[0]} …`;
  }
  const plain = (e.hosts || []).find((h) => !h.startsWith("*.")) || (e.hosts || [])[0];
  const host = plain ? plain.replace(/^\*\./, "api.") : "api.example.com";
  const scheme = isLoopbackHost(host.replace(/:\d+$/, "")) ? "http" : "https";
  const header = /cookie|session/.test(e.name || "") ? `Cookie: ${ph}` : `Authorization: Bearer ${ph}`;
  return `herdr-ws-secret http ${scheme}://${host}/ -H '${header}'`;
}

// ---- meta.json ----

function normEntry(e) {
  return {
    name: e.name,
    scope: e.scope,
    tier: e.tier === "protected" ? "protected" : "standard",
    mode: e.mode === "http" ? "http" : "http+cli",
    hosts: Array.isArray(e.hosts) ? e.hosts.filter((h) => typeof h === "string") : [],
    commands: Array.isArray(e.commands)
      ? e.commands.map((c) => (typeof c === "string" ? { name: c, path: null } : c && typeof c.name === "string" ? { name: c.name, path: typeof c.path === "string" ? c.path : null } : null)).filter(Boolean)
      : [],
    allowShells: e.allowShells === true,
    grants: Array.isArray(e.grants) ? e.grants : [],
    createdAt: typeof e.createdAt === "number" ? e.createdAt : null,
    updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : null,
    expiresAt: typeof e.expiresAt === "number" ? e.expiresAt : null,
    lastUsedAt: typeof e.lastUsedAt === "number" ? e.lastUsedAt : null,
    lastUsedBy: typeof e.lastUsedBy === "string" ? e.lastUsedBy : null,
    lastUsedFor: typeof e.lastUsedFor === "string" ? e.lastUsedFor : null,
    note: typeof e.note === "string" ? e.note : "",
  };
}

// meta.json's entries, each with every field; entries without a valid name or scope dropped.
// A missing or empty file is an empty vault; a broken one says so in error.
export function parseMeta(text) {
  const s = String(text === undefined || text === null ? "" : text);
  if (!s.trim()) return { entries: [], error: null };
  let o;
  try { o = JSON.parse(s); } catch (err) { return { entries: [], error: "meta.json isn't valid JSON" }; }
  if (!o || typeof o !== "object" || !Array.isArray(o.entries)) return { entries: [], error: "meta.json has no entries list" };
  if (o.v !== 1) return { entries: [], error: `meta.json is version ${o.v}, this knows 1` };
  const entries = [];
  for (const e of o.entries) {
    if (e && typeof e === "object" && validName(e.name) && validScope(e.scope)) entries.push(normEntry(e));
  }
  return { entries, error: null };
}

// The list a screen shows: tab "all" (the workspace's and every workspace's), "ws" (the
// workspace's only), "global"; query matches name, note, hosts and commands, any case.
// Other workspaces' entries never show. Sorted: the workspace's first, then by name.
export function filterEntries(entries, { query, tab, ws } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const own = ws ? "ws:" + ws : null;
  return (entries || [])
    .filter((e) => {
      if (e.scope !== "global" && e.scope !== own) return false;
      if (tab === "ws" && e.scope !== own) return false;
      if (tab === "global" && e.scope !== "global") return false;
      if (!q) return true;
      const hay = [e.name, e.note || "", (e.hosts || []).join(" "), cmdNames(e).join(" ")].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (a.scope === b.scope ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.scope === "global" ? 1 : -1));
}
