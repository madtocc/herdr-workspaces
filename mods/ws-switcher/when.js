// An automation's `when:` line: what sets it off, in words, and when a schedule
// is due. The same file is in mods/ws-switcher (the runner) and
// mods/ws-automations (the screen), because mods can't import across folders:
// change both (scripts/sync-from-home.sh checks they match).
//
//   every 30m | every 2h | every 1d        an interval, at least a minute
//   09:00 | daily 9:00 | weekdays 09:00,17:30 | weekends 10am | mon,wed 8:30 | mon-fri 9:00
//   0 9 * * 1-5                            cron: minute hour day month weekday
//   once 2026-11-12 06:00                  one time, on this computer's clock; then it turns itself off
//   task enters review                     a board task moves into that column
//   agent done | agent blocked [tab name]  an agent in the workspace finishes, or needs you
//   files inbox                            something changes under a folder (from the root)
//   github api pr opened                   a pull request (or `issue`) is opened on GitHub, in a
//   github owner/name issue opened by others label:bug   workspace folder's repo or owner/name
//   link                                   only Run now and herdr-ws-run start it

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const UNITS = { s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3, m: 60e3, min: 60e3, mins: 60e3, minute: 60e3, minutes: 60e3, h: 3600e3, hr: 3600e3, hrs: 3600e3, hour: 3600e3, hours: 3600e3, d: 86400e3, day: 86400e3, days: 86400e3 };
const HELP = 'Try "every 30m", "weekdays 09:00", "once 2026-11-12 06:00", "0 9 * * 1-5", "task enters review", "agent done", "files inbox", "github api pr opened" or "link".';

const pad = (n) => String(n).padStart(2, "0");
const hhmm = ([h, m]) => `${pad(h)}:${pad(m)}`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function day(word) {
  const i = word.length >= 3 ? DAYS.findIndex((d) => d.startsWith(word)) : -1;
  return i < 0 ? null : i;
}

// "daily", "weekdays", "weekends", "mon,wed", "mon-fri" (or "fri-mon"): weekday numbers, 0 = Sunday.
function days(text) {
  if (!text || text === "daily" || text === "everyday" || text === "every day") return range(0, 6);
  if (text === "weekdays") return range(1, 5);
  if (text === "weekends") return [0, 6];
  const out = new Set();
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((p) => day(p.trim().replace(/s$/, "")));
    if (a === null || b === null) return null;
    if (b === undefined) { out.add(a); continue; }
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return out.size ? [...out].sort() : null;
}

// "9:00", "09:30", "9am", "5:30pm": [hour, minute].
function time(text) {
  let m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (m && +m[1] < 24 && +m[2] < 60) return [+m[1], +m[2]];
  m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(text);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +(m[2] ?? 0) < 60) return [(+m[1] % 12) + (m[3] === "pm" ? 12 : 0), +(m[2] ?? 0)];
  return null;
}

// One cron field: null for "*", else the values it allows.
function cronField(text, lo, hi) {
  if (text === "*") return null;
  const out = new Set();
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return undefined;
    const a = m[1] === "*" ? lo : +m[2], b = m[1] === "*" ? hi : m[3] !== undefined ? +m[3] : m[4] ? hi : a;
    const step = m[4] ? +m[4] : 1;
    if (a < lo || b > hi || a > b || step < 1) return undefined;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

// The parsed line: { kind: "every" | "at" | "cron" | "once" | "board" | "agent" | "files" | "github" | "link" | "error", ... }.
export function parseWhen(line) {
  const raw = String(line ?? "").trim();
  const s = raw.toLowerCase().replace(/\s+/g, " ");
  if (!s || s === "link" || s === "manual" || s === "never") return { kind: "link" };
  // once YYYY-MM-DD [at] time: one minute on this computer's clock.
  let m = /^once\b(.*)$/.exec(s);
  if (m) {
    const d = /^ (\d{4})-(\d{1,2})-(\d{1,2})(?: at)? (\S+)$/.exec(m[1]);
    const t = d && time(d[4]);
    const at = t && new Date(+d[1], +d[2] - 1, +d[3], t[0], t[1]);
    if (!at || at.getMonth() !== +d[2] - 1 || at.getDate() !== +d[3]) return { kind: "error", error: 'A one-time schedule is a date and a time: "once 2026-11-12 06:00".' };
    return { kind: "once", at: at.getTime() };
  }
  m = /^every (\d+) ?([a-z]+)$/.exec(s);
  if (m && UNITS[m[2]]) {
    const ms = +m[1] * UNITS[m[2]];
    return ms >= 60e3 ? { kind: "every", ms } : { kind: "error", error: "An interval is at least a minute." };
  }
  m = /^task (?:enters|moves to|moves into) (.+)$/.exec(s);
  if (m) return { kind: "board", column: m[1].trim() };
  m = /^agent (done|finishes|finished|blocked|needs you)(?: (.+))?$/.exec(s);
  if (m) {
    const name = m[2] ? raw.replace(/\s+/g, " ").split(" ").slice(m[1] === "needs you" ? 3 : 2).join(" ") : null;
    return { kind: "agent", status: m[1] === "blocked" || m[1] === "needs you" ? "blocked" : "done", name };
  }
  m = /^files? (.+)$/i.exec(raw);
  if (m) return { kind: "files", folder: m[1].trim() };
  // github <repo> pr|issue [opened] [by others] [label:<name>]
  m = /^github\s+(\S+)(?:\s+(.*))?$/i.exec(raw);
  if (m) {
    const rest = (m[2] ?? "").trim();
    const what = /^(prs?|pull requests?|pulls?)\b/i.test(rest) ? "pr" : /^issues?\b/i.test(rest) ? "issue" : null;
    if (!what) return { kind: "error", error: `After the repo comes "pr opened" or "issue opened": "github ${m[1]} pr opened".` };
    const label = /\blabel:("[^"]+"|\S+)/i.exec(rest)?.[1].replace(/^"|"$/g, "") ?? null;
    return { kind: "github", repo: m[1], what, others: /\bby others\b/i.test(rest), label };
  }
  const parts = s.split(" ");
  if (parts.length === 5 && parts.every((p) => /^[\d*,/-]+$/.test(p))) {
    const [mi, h, dom, mon, dow] = parts;
    const f = { minute: cronField(mi, 0, 59), hour: cronField(h, 0, 23), dom: cronField(dom, 1, 31), month: cronField(mon, 1, 12), dow: cronField(dow, 0, 7) };
    if (Object.values(f).includes(undefined)) return { kind: "error", error: `"${raw}" isn't a cron line I can read (minute hour day month weekday).` };
    if (f.dow) f.dow = [...new Set(f.dow.map((d) => d % 7))].sort();
    return { kind: "cron", text: parts.join(" "), ...f };
  }
  // "[days] [at] times": the times are the last word (commas between them).
  const rest = s.replace(/^at /, "").replace(/ at /, " ").replace(/\s*,\s*/g, ",").split(" ");
  const times = rest.pop().split(",").map(time);
  if (times.length && !times.includes(null)) {
    const d = days(rest.join(" ").trim());
    if (d) return { kind: "at", days: d, times: times.sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
  }
  return { kind: "error", error: `Can't read "${raw}". ${HELP}` };
}

// A schedule ("at", "cron" or "once") is due in the minute starting at `d`.
export function due(w, d) {
  if (w.kind === "once") return Math.floor(w.at / 60e3) === Math.floor(d.getTime() / 60e3);
  if (w.kind === "at") return w.days.includes(d.getDay()) && w.times.some(([h, m]) => h === d.getHours() && m === d.getMinutes());
  if (w.kind !== "cron") return false;
  const has = (list, v) => !list || list.includes(v);
  if (!has(w.minute, d.getMinutes()) || !has(w.hour, d.getHours()) || !has(w.month, d.getMonth() + 1)) return false;
  // Cron's rule: with both day fields set, either one will do.
  if (w.dom && w.dow) return w.dom.includes(d.getDate()) || w.dow.includes(d.getDay());
  return has(w.dom, d.getDate()) && has(w.dow, d.getDay());
}

// The next minute a schedule is due, after `from` (ms), within 32 days; else null.
export function nextAt(w, from) {
  if (w.kind === "once") return w.at > from ? w.at : null;
  if (w.kind !== "at" && w.kind !== "cron") return null;
  let t = Math.floor(from / 60e3) * 60e3 + 60e3;
  for (let i = 0; i < 32 * 1440; i++, t += 60e3) if (due(w, new Date(t))) return t;
  return null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const and = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
const label = (c) => c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, " ");

// A cron line in words when it has a common shape ("Every 30 minutes from 09:00
// to 18:30, weekdays", "Weekdays at 09:00"); else null. Day of month and month must be *.
function cronWords(w) {
  if (w.dom || w.month) return null;
  const dayList = w.dow ?? range(0, 6);
  const daysText = { "0,1,2,3,4,5,6": "", "1,2,3,4,5": "weekdays", "0,6": "weekends" }[dayList.join(",")] ?? and(dayList.map((x) => `${label(DAYS[x])}s`));
  if (w.minute?.length === 1 && w.hour && w.hour.length <= 4) return describe({ kind: "at", days: dayList, times: w.hour.map((h) => [h, w.minute[0]]) });
  const mins = w.minute ?? range(0, 59);
  const step = mins.length > 1 ? mins[1] - mins[0] : 60;
  const even = mins[0] === 0 && 60 % step === 0 && mins.length === 60 / step && mins.every((m, i) => m === i * step);
  const every = mins.length === 1 ? `Every hour at :${pad(mins[0])}` : even ? (step === 1 ? "Every minute" : `Every ${step} minutes`) : null;
  const hours = w.hour;
  if (!every || (hours && !hours.every((h, i) => i === 0 || h === hours[i - 1] + 1))) return null;
  const span = hours ? ` from ${hhmm([hours[0], mins[0]])} to ${hhmm([hours[hours.length - 1], mins[mins.length - 1]])}` : "";
  return `${every}${span}${daysText ? `, ${daysText}` : ""}`;
}

// The line in words: "Weekdays at 09:00", "When a task enters Review".
export function describe(w) {
  switch (w.kind) {
    case "every": {
      const [n, unit] = w.ms % 86400e3 === 0 ? [w.ms / 86400e3, "day"] : w.ms % 3600e3 === 0 ? [w.ms / 3600e3, "hour"] : [Math.round(w.ms / 60e3), "minute"];
      return n === 1 ? `Every ${unit}` : `Every ${plural(n, unit)}`;
    }
    case "at": {
      const d = w.days.join(",");
      const when = d === "0,1,2,3,4,5,6" ? "Every day" : d === "1,2,3,4,5" ? "Weekdays" : d === "0,6" ? "Weekends"
        : and(w.days.map((x) => `${label(DAYS[x])}s`));
      return `${when} at ${and(w.times.map(hhmm))}`;
    }
    case "cron": return cronWords(w) ?? `On the cron schedule ${w.text}`;
    case "once": {
      const d = new Date(w.at);
      return `Once, ${label(DAYS[d.getDay()]).slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} at ${hhmm([d.getHours(), d.getMinutes()])}`;
    }
    case "board": return `When a task enters ${label(w.column)}`;
    case "agent": return `When an agent ${w.status === "done" ? "finishes" : "needs you"}${w.name ? ` (tabs named ${w.name})` : ""}`;
    case "files": return `When files change in ${w.folder}`;
    case "github": return `When ${w.what === "pr" ? "a pull request" : "an issue"} is opened in ${w.repo}${w.others ? " by someone else" : ""}${w.label ? ` with the label ${w.label}` : ""}`;
    case "link": return "Only when started by hand or called from outside";
    default: return w.error ?? HELP;
  }
}

// When a time is, in short: "09:00" today, "Tue 09:00" this week, else "12 Nov 09:00".
export function shortTime(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const clock = hhmm([d.getHours(), d.getMinutes()]);
  if (d.toDateString() === n.toDateString()) return clock;
  if (Math.abs(ms - now) < 6 * 86400e3) return `${label(DAYS[d.getDay()]).slice(0, 3)} ${clock}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${clock}`;
}
