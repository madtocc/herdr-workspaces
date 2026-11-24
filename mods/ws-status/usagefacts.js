// The plans' usage as rows the status bar and its panel draw, from what each agent
// reports. No imports, so `node` can test it directly.
//
// A row: { kind, short, label, pct, resets (ms) | null, severity | null, group?, span?, note? }
//   short  the hover's word: "5h", "week", "Fable"
//   label  the panel's: "Current session", "Weekly · all models", "Weekly · Fable"
//   group  Antigravity: the quota pool it belongs to ("Gemini models"), which the panel
//          draws once as a block with its limits side by side
//   span   Antigravity: the limit's window in that block ("5-hour", "Weekly")
//   note   what the panel says on hover (Antigravity: which models share the pool)

// Claude Code's own /usage report (`claude -p /usage --output-format stream-json
// --verbose`): its usage_report's limits, in its order. null when there's no report.
export function claudeReportRows(text) {
  let report = null;
  for (const line of String(text).split("\n")) {
    if (!line.includes("usage_report")) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    report = o.usage_report ?? o.message?.usage_report ?? report;
  }
  const limits = report?.rate_limits?.limits;
  if (!Array.isArray(limits)) return null;
  return limits.filter((r) => r && typeof r.percent === "number").map((r) => {
    const scoped = r.scope?.model?.display_name ?? r.scope?.surface?.display_name ?? null;
    const [short, label] = r.kind === "session" ? ["5h", "Current session"]
      : r.kind === "weekly_all" ? ["week", "Weekly · all models"]
      : scoped ? [scoped, `${String(r.kind).startsWith("session") ? "Session" : "Weekly"} · ${scoped}`]
      : [String(r.kind ?? "?"), String(r.kind ?? "?")];
    // On the minute: the report's time can fall a moment before it (01:59:59.574 for 02:00).
    const at = Date.parse(String(r.resets_at ?? "").replace(/\.\d+/, ""));
    const resets = Number.isFinite(at) ? Math.round(at / 60000) * 60000 : null;
    return { kind: r.kind ?? null, short, label, pct: r.percent, resets, severity: r.severity ?? null };
  });
}

// Antigravity's own /usage (`agy -p /usage --output-format json`): each quota group's
// limits, groups in its order ("Gemini Models", "Claude and GPT models", "Gemini 4 Argon"),
// the 5-hour one before the weekly one in each, as Claude's session comes before its week.
// Each row has its group, its window as `span` and the group's description as `note`. It
// gives what's left; a row's pct is what's used. null when there's no report (an API key).
const SPAN_ORDER = { "5h": 0, weekly: 1 };
export function agyReportRows(text) {
  let o = null;
  for (const line of String(text).split("\n")) {
    if (!line.includes('"command"')) continue;
    try { o = JSON.parse(line); } catch { /* not the answer */ }
  }
  const groups = o?.command?.data?.groups;
  if (!Array.isArray(groups)) return null;
  const rows = [];
  for (const g of groups) {
    const who = String(g?.name ?? "").replace(/ Models$/, " models");
    const buckets = (Array.isArray(g?.buckets) ? g.buckets : []).filter((b) => typeof b?.remaining_fraction === "number")
      .map((b, i) => ({ b, i })).sort((x, y) => (SPAN_ORDER[x.b.window] ?? 2) - (SPAN_ORDER[y.b.window] ?? 2) || x.i - y.i);
    for (const { b } of buckets) {
      const [span, word] = b.window === "weekly" ? ["Weekly", "week"] : b.window === "5h" ? ["5-hour", "5h"] : [String(b.window ?? "Limit"), String(b.window ?? "")];
      const at = Date.parse(String(b.reset_time ?? "").replace(/\.\d+/, ""));
      rows.push({
        kind: b.id ?? null,
        short: word || span,
        label: `${span} · ${who}`,
        pct: Math.round((1 - b.remaining_fraction) * 1000) / 10,
        resets: Number.isFinite(at) ? Math.round(at / 60000) * 60000 : null,
        severity: null,
        group: who || null,
        span,
        note: g.description ?? null,
      });
    }
  }
  return rows.length ? rows : null;
}

// A plan's rows for the panel and the hover, in order: a row without a group alone
// ({ rows: [row] }), the rows of one group together ({ group, note, rows }), each group
// where its first row is.
export function blocksOf(rows) {
  const out = [];
  const byGroup = new Map();
  for (const r of rows ?? []) {
    if (!r?.group) { out.push({ group: null, note: null, rows: [r] }); continue; }
    let b = byGroup.get(r.group);
    if (!b) { b = { group: r.group, note: r.note ?? null, rows: [] }; byGroup.set(r.group, b); out.push(b); }
    b.rows.push(r);
  }
  return out;
}

// The row a plan shows in the bar: its most used limit (the first of equals).
export function topRow(rows) {
  let top = null;
  for (const r of rows ?? []) if (!top || r.pct > top.pct) top = r;
  return top;
}

// The row a plan shows in the bar. A plan with pools (Antigravity) is read by its first
// pool, its own models (Gemini): another pool used up (Claude and GPT) doesn't stop it.
// That pool's 5-hour limit, or one of its limits that's full; with no 5-hour limit, its
// most used. A plan without pools: its most used limit (the first of equals).
export function barRow(rows) {
  const blocks = blocksOf(rows);
  const main = blocks[0]?.group ? blocks[0].rows : null;
  if (!main) return topRow(rows);
  return main.find(full) ?? main.find((r) => r.span === "5-hour") ?? topRow(main);
}

// The newest Claude status line that has limits (the files herdr-ws-statusline saves,
// { at, status }): its 5-hour window and week, leaving out one already past its reset.
// { rows, at } or null.
export function claudeStatusRows(saved, now = Date.now()) {
  let best = null;
  for (const s of saved) if (s?.status?.rate_limits && !s.agent && (!best || (s.at ?? 0) > (best.at ?? 0))) best = s;
  if (!best) return null;
  const rows = [];
  for (const [k, kind, short, label] of [["five_hour", "session", "5h", "Current session"], ["seven_day", "weekly_all", "week", "Weekly · all models"]]) {
    const w = best.status.rate_limits[k];
    const resets = typeof w?.resets_at === "number" ? w.resets_at * 1000 : null;
    if (typeof w?.used_percentage !== "number" || (resets && resets <= now)) continue;
    rows.push({ kind, short, label, pct: w.used_percentage, resets, severity: null });
  }
  return rows.length ? { rows, at: (best.at ?? 0) * 1000 } : null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clock = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;

// When a limit resets, in local time: "Resets in 12m" within the hour, "Resets 4:30 PM"
// later today, "Resets Fri 11:00 PM" within the week (a weekday that isn't today's),
// else "Resets Tue Dec 1".
export function resetsText(ms, now = Date.now()) {
  if (!ms) return "";
  const left = ms - now;
  if (left <= 0) return "Resets now";
  if (left < 3600000) return `Resets in ${Math.max(1, Math.round(left / 60000))}m`;
  const d = new Date(ms);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return `Resets ${clock(d)}`;
  if (left < 7 * 86400000 && d.getDay() !== n.getDay()) return `Resets ${DAYS[d.getDay()]} ${clock(d)}`;
  return `Resets ${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// When a full limit is back, short, for the bar and its hover: "in 12m", "4:17 PM" today,
// "Fri 11:00 PM" within the week, else "Dec 1". "" for one with no reset time.
export function backText(ms, now = Date.now()) {
  if (!ms) return "";
  const t = resetsText(ms, now).replace(/^Resets /, "");
  return t.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (?=[A-Z][a-z]{2} \d)/, "");
}

// Whether a limit is used up.
export const full = (r) => typeof r?.pct === "number" && r.pct >= 100;

// The bar's text for a plan's most used limit: "52%", or "100% · 4:17 PM" once it's full.
export function barText(r, now = Date.now()) {
  const pct = `${Math.round(r.pct)}%`;
  const back = full(r) ? backText(r.resets, now) : "";
  return back ? `${pct} · ${back}` : pct;
}

// The hover's lines for one plan: "Claude: week 52%, Fable 47%", or a line per group,
// "Antigravity, Gemini: 5h 39%, week 69%", a full limit with "until 4:17 PM".
export function hoverLines(name, rows, now = Date.now()) {
  const say = (r) => {
    const back = full(r) ? backText(r.resets, now) : "";
    return `${r.short} ${Math.round(r.pct)}%${back ? ` until ${back}` : ""}`;
  };
  const lines = [];
  const loose = [];
  for (const b of blocksOf(rows)) {
    if (!b.group) { loose.push(...b.rows); continue; }
    lines.push(`${name}, ${b.group.replace(/ models$/, "")}: ${b.rows.map(say).join(", ")}`);
  }
  if (loose.length) lines.unshift(`${name}: ${loose.map(say).join(", ")}`);
  return lines;
}

// "just now", "7 min ago", "2h ago".
export function agoText(ms, now = Date.now()) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// Whether an add-on is on, for a copy that read ~/.herdr/settings.jsonc itself at start
// and follows shared "workspaces.settings" after: `was`, what it took last (null until
// the file is read); `heard`, the shared value it saw last; `now`, the shared value now
// (true, false, or undefined while nothing is there). A shared value it hasn't seen is a
// change (a switch flipped in Settings, or ws-agents read the file again), so it wins;
// otherwise what it took stands.
export function followFeature(was, heard, now) {
  if (now !== undefined && now !== heard) return now !== false;
  return was ?? now !== false;
}
