// The plans' usage as rows the status bar and its panel draw, from what each agent
// reports. No imports, so `node` can test it directly.
//
// A row: { kind, short, label, pct, resets (ms) | null, severity | null, note? }
//   short  the bar's word: "5h", "Week", "Fable"
//   label  the panel's: "Current session", "Weekly · all models", "Weekly · Fable"
//   note   what the panel says on hover (Antigravity: which models share the limit)

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
      : r.kind === "weekly_all" ? ["Week", "Weekly · all models"]
      : scoped ? [scoped, `${String(r.kind).startsWith("session") ? "Session" : "Weekly"} · ${scoped}`]
      : [String(r.kind ?? "?"), String(r.kind ?? "?")];
    // On the minute: the report's time can fall a moment before it (01:59:59.574 for 02:00).
    const at = Date.parse(String(r.resets_at ?? "").replace(/\.\d+/, ""));
    const resets = Number.isFinite(at) ? Math.round(at / 60000) * 60000 : null;
    return { kind: r.kind ?? null, short, label, pct: r.percent, resets, severity: r.severity ?? null };
  });
}

// Antigravity's own /usage (`agy -p /usage --output-format json`): each quota group's
// limits, in its order ("Gemini Models", "Claude and GPT models", "Gemini 4 Argon"; a
// weekly and a 5-hour one each), with the group's description as `note`. It gives
// what's left; a row's pct is what's used. null when there's no report (an API key).
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
    for (const b of Array.isArray(g?.buckets) ? g.buckets : []) {
      if (typeof b?.remaining_fraction !== "number") continue;
      const [span, word] = b.window === "weekly" ? ["Weekly", "week"] : b.window === "5h" ? ["5-hour", "5h"] : [String(b.window ?? "Limit"), String(b.window ?? "")];
      const at = Date.parse(String(b.reset_time ?? "").replace(/\.\d+/, ""));
      rows.push({
        kind: b.id ?? null,
        short: `${who.replace(/ models$/, "")} ${word}`.trim(),
        label: `${span} · ${who}`,
        pct: Math.round((1 - b.remaining_fraction) * 1000) / 10,
        resets: Number.isFinite(at) ? Math.round(at / 60000) * 60000 : null,
        severity: null,
        note: g.description ?? null,
      });
    }
  }
  return rows.length ? rows : null;
}

// The row a plan shows in the bar: its most used limit (the first of equals).
export function topRow(rows) {
  let top = null;
  for (const r of rows ?? []) if (!top || r.pct > top.pct) top = r;
  return top;
}

// The newest Claude status line that has limits (the files herdr-ws-statusline saves,
// { at, status }): its 5-hour window and week, leaving out one already past its reset.
// { rows, at } or null.
export function claudeStatusRows(saved, now = Date.now()) {
  let best = null;
  for (const s of saved) if (s?.status?.rate_limits && !s.agent && (!best || (s.at ?? 0) > (best.at ?? 0))) best = s;
  if (!best) return null;
  const rows = [];
  for (const [k, kind, short, label] of [["five_hour", "session", "5h", "Current session"], ["seven_day", "weekly_all", "Week", "Weekly · all models"]]) {
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
// else "Resets Nov 28".
export function resetsText(ms, now = Date.now()) {
  if (!ms) return "";
  const left = ms - now;
  if (left <= 0) return "Resets now";
  if (left < 3600000) return `Resets in ${Math.max(1, Math.round(left / 60000))}m`;
  const d = new Date(ms);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return `Resets ${clock(d)}`;
  if (left < 7 * 86400000 && d.getDay() !== n.getDay()) return `Resets ${DAYS[d.getDay()]} ${clock(d)}`;
  return `Resets ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// "just now", "7 min ago", "2h ago".
export function agoText(ms, now = Date.now()) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
