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
        pool: slug(who) || null,
        note: g.description ?? null,
      });
    }
  }
  return rows.length ? rows : null;
}

// A name as a settings key: "Claude and GPT models" -> "claude-and-gpt-models".
export const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// A Codex window's length in minutes as the panel's and the bar's words: 300 -> "5-hour" / "5h",
// 10080 -> "Weekly" / "week", 43200 -> "Monthly" / "month" (the Free plan's), else hours up to
// six hours and days after that ("2-day" / "2d").
export function codexWindow(mins) {
  const m = Number(mins);
  if (!Number.isFinite(m) || m <= 0) return { span: "Limit", short: "limit" };
  if (m === 10080) return { span: "Weekly", short: "week" };
  if (m === 43200) return { span: "Monthly", short: "month" };
  if (m === 1440) return { span: "Daily", short: "day" };
  if (m <= 360) { const h = Math.max(1, Math.round(m / 60)); return { span: `${h}-hour`, short: `${h}h` }; }
  const d = Math.max(1, Math.round(m / 1440));
  return { span: `${d}-day`, short: `${d}d` };
}

// One Codex pool ({ limitId, limitName, primary, secondary, planType }, or the rollout's
// snake_case { limit_id, limit_name, primary: { used_percent, window_minutes, resets_at } … })
// as rows, its shorter window first. The main pool ("codex", no name) is called "Codex"; a
// pool with a name (a model's own limit) by its name.
function codexPoolRows(p) {
  if (!p || typeof p !== "object") return [];
  const id = String(p.limitId ?? p.limit_id ?? "codex");
  const name = p.limitName ?? p.limit_name ?? null;
  const group = name ? String(name) : id === "codex" ? "Codex" : id;
  const plan = p.planType ?? p.plan_type ?? null;
  const wins = [p.primary, p.secondary].filter((w) => w && typeof (w.usedPercent ?? w.used_percent) === "number")
    .map((w) => ({ pct: w.usedPercent ?? w.used_percent, mins: w.windowDurationMins ?? w.window_minutes ?? null, at: w.resetsAt ?? w.resets_at ?? null }))
    .sort((a, b) => (a.mins ?? Infinity) - (b.mins ?? Infinity));
  return wins.map((w) => {
    const { span, short } = codexWindow(w.mins);
    return {
      kind: `${id}:${w.mins ?? "?"}`,
      short,
      label: `${span} · ${group}`,
      pct: w.pct,
      // Unix seconds, on the minute.
      resets: typeof w.at === "number" && w.at > 0 ? Math.round((w.at * 1000) / 60000) * 60000 : null,
      severity: null,
      group,
      span,
      pool: slug(id) || "codex",
      note: plan ? `${String(plan).charAt(0).toUpperCase()}${String(plan).slice(1)} plan` : null,
    };
  });
}

// Every pool of a Codex answer, the main one ("codex", or rateLimits' own) first.
function codexPools(main, byId) {
  const pools = [];
  const seen = new Set();
  const add = (p) => {
    const id = String(p?.limitId ?? p?.limit_id ?? "");
    if (!p || seen.has(id)) return;
    seen.add(id);
    pools.push(p);
  };
  const all = byId && typeof byId === "object" ? Object.values(byId) : [];
  const mainId = String(main?.limitId ?? main?.limit_id ?? "codex");
  add(all.find((p) => String(p?.limitId ?? p?.limit_id ?? "") === mainId) ?? main);
  for (const p of all) add(p);
  return pools;
}

// Codex's own rate limits: what `codex app-server` answers account/rateLimits/read with (the
// JSON-RPC reply with "id": 2, one line among its notifications). Each pool's windows are rows
// grouped as Antigravity's are. null when there's no answer or it's an error (signed out).
export function codexReportRows(text) {
  let res = null;
  for (const line of String(text).split("\n")) {
    if (!/"id"\s*:\s*2\b/.test(line)) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.id === 2 && o.result) res = o.result;
  }
  if (!res) return null;
  const rows = codexPools(res.rateLimits, res.rateLimitsByLimitId).flatMap(codexPoolRows);
  return rows.length ? rows : null;
}

// Until Codex's app-server answers (or when it can't): the newest rate limits a Codex session
// logged (lines of ~/.codex/sessions/…/rollout-*.jsonl, its event_msg token_count entries'
// payload.rate_limits), leaving out a window already past its reset. { rows, at } or null.
export function codexRolloutRows(text, now = Date.now()) {
  let best = null;
  for (const line of String(text).split("\n")) {
    if (!line.includes('"rate_limits"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o?.payload;
    if (o?.type !== "event_msg" || p?.type !== "token_count" || !p.rate_limits || typeof p.rate_limits !== "object") continue;
    const at = Date.parse(String(o.timestamp ?? "")) || 0;
    if (!best || at >= best.at) best = { at, limits: p.rate_limits };
  }
  if (!best) return null;
  const rows = codexPoolRows(best.limits).filter((r) => !r.resets || r.resets > now);
  return rows.length ? { rows, at: best.at } : null;
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

// Whether a limit is used up.
export const full = (r) => typeof r?.pct === "number" && r.pct >= 100;

// Whether a limit warrants attention in the bar (warning/critical severity or >= 70%).
export const isWarm = (r) => Boolean(r) && (r.pct >= 70 || r.severity === "warning" || r.severity === "critical");

// Whether an un-grouped row is a model/surface sub-limit (e.g. Claude's Fable, Sonnet)
// rather than an overall plan ceiling (Current session, Weekly · all models).
export function isSubLimit(r) {
  if (!r || r.group) return false;
  return r.kind !== "session" && r.kind !== "weekly_all" && r.short !== "5h" && r.short !== "week";
}

// The parent window kind for a Claude sub-limit row ("session" or "weekly_all").
function parentKindOf(r) {
  return /^session/i.test(String(r?.kind ?? r?.label ?? "")) ? "session" : "weekly_all";
}

// The most used limit in a set (the first of equals; when two limits are both full,
// the one that resets later wins because it keeps the pool blocked longer).
export function topRow(rows) {
  let top = null;
  for (const r of rows ?? []) {
    if (!r) continue;
    if (!top) { top = r; continue; }
    if (full(r) && full(top)) {
      if ((r.resets ?? 0) > (top.resets ?? 0)) top = r;
    } else if (r.pct > top.pct) {
      top = r;
    }
  }
  return top;
}

// Short readable label for a secondary limit in the status bar:
// "Fable" for a Claude sub-limit, or "5h" / "week" for a sibling time window.
export function subName(r) {
  if (!r) return "";
  return String(r.short ?? r.label ?? "");
}

// --- What the status bar shows: the plans and limits Customize turns on or off ---

// A limit's id as a settings key, for an un-grouped (Claude) row: "session", "weekly", and a
// model's own limit under its window, "weekly-fable" or "session-fable".
export function limitId(r) {
  if (!r) return "";
  if (r.kind === "session" || (!isSubLimit(r) && r.short === "5h")) return "session";
  if (r.kind === "weekly_all" || (!isSubLimit(r) && r.short === "week")) return "weekly";
  if (isSubLimit(r)) return `${parentKindOf(r) === "session" ? "session" : "weekly"}-${slug(r.short ?? r.label)}`;
  return slug(r.kind ?? r.label) || "limit";
}

// A plan's parts Customize turns on or off, in the panel's order:
//   - a plan with pools (Antigravity, Codex): one per pool, { id, label, spans, rows, pool: true },
//     the first pool on unless the settings say otherwise, the others off;
//   - Claude: one per limit, { id, label, rows: [row], sub }, every one on; `sub` for a model's
//     own limit (Fable), which Customize draws under its window.
export function usageUnits(rows) {
  const out = [];
  for (const b of blocksOf((rows ?? []).filter(Boolean))) {
    if (b.group) {
      const id = b.rows[0]?.pool ?? slug(b.group);
      out.push({ id, label: b.group, spans: b.rows.map((r) => r.span ?? r.short), rows: b.rows, pool: true, sub: false, on: !out.some((u) => u.pool) });
    } else {
      const r = b.rows[0];
      out.push({ id: limitId(r), label: isSubLimit(r) ? r.short : r.label, spans: [], rows: [r], pool: false, sub: isSubLimit(r), on: true });
    }
  }
  return out;
}

// The settings' word on a plan or one of its parts ("usage" in ~/.herdr/settings.jsonc, the
// panel's Customize): "<plan>" off hides the whole plan from the bar; "<plan>/<id>" turns one
// part on or off; anything not there keeps its default (usageUnits()' on).
export const planOn = (prefs, plan) => prefs?.[plan] !== false;
export function unitOn(prefs, plan, unit) {
  const v = prefs?.[`${plan}/${unit.id}`];
  return typeof v === "boolean" ? v : Boolean(unit.on);
}

// The parts of a plan the bar shows: none while the plan is off. `plan` null: the defaults.
export function shownUnits(rows, plan = null, prefs = null) {
  const units = usageUnits(rows);
  if (plan == null) return units.filter((u) => u.on);
  if (!planOn(prefs, plan)) return [];
  return units.filter((u) => unitOn(prefs, plan, u));
}

// What the status bar draws for one plan, from the limits it shows (shownUnits()):
//   main     the governing limit: the most used of the plan's overall ones (Claude's 5-hour and
//            week; a pooled plan's first shown pool), or of its sub-limits when only those show
//   bars     1 or 2 rows for the 14px micro-bars: [main, hottest sub-limit] when a sub-limit
//            shows (Claude's Fable, or another pool of Antigravity or Codex), else the overall
//            ones' first two ([5h, week]); one bar when only one limit shows
//   sub      the second micro-bar row (bars[1] ?? null), kept for callers
//   hotSubs  warm shown secondary limits (>= 70% / warning / critical) worth naming inline in
//            the bar ("· Fable 97%", "· week 73%"), hottest first (left out while `main` itself
//            is full unless the secondary limit is also full until a later reset), and
//   hotNames their names there: the row's short word, with its pool's name for another pool
//            ("Claude and GPT week")
// With nothing shown (the plan off, or every part of it), main is null and the bar leaves the
// plan out.
export function barSummary(rows, plan = null, prefs = null) {
  const on = shownUnits(rows, plan, prefs);
  if (!on.length) return { main: null, bars: [], sub: null, hotSubs: [], hotNames: [] };
  const keepHot = (main, r) => isWarm(r) && (!full(main) || (full(r) && (r.resets ?? 0) > (main.resets ?? 0)));
  let overall, subs;
  if (on[0].pool) {
    overall = on[0].rows;
    subs = on.slice(1).flatMap((u) => u.rows);
  } else {
    const all = on.flatMap((u) => u.rows);
    overall = all.filter((r) => !isSubLimit(r));
    subs = all.filter(isSubLimit);
  }
  const nameOf = (r) => (on[0].pool && !overall.includes(r) && r.group ? `${String(r.group).replace(/ models$/i, "")} ${subName(r)}` : subName(r));
  const done = (main, bars, hot) => ({ main, bars, sub: bars[1] ?? null, hotSubs: hot, hotNames: hot.map(nameOf) });
  const hottest = (list) => list.slice().sort((a, b) => b.pct - a.pct);
  if (!overall.length) {
    const main = topRow(subs);
    const rest = subs.filter((r) => r !== main);
    const second = topRow(rest);
    return done(main, second ? [main, second] : [main], hottest(rest.filter((r) => keepHot(main, r))));
  }
  const main = topRow(overall);
  const topSub = topRow(subs);
  const bars = topSub ? [main, topSub] : overall.slice(0, 2);
  const hotModelSubs = hottest(subs.filter((r) => keepHot(main, r)));
  const hotOverallOther = hottest(overall.filter((r) => r !== main && keepHot(main, r)));
  return done(main, bars, hotModelSubs.length ? hotModelSubs : hotOverallOther);
}

// The governing overall row a plan shows as its main percent in the bar.
export function barRow(rows, plan = null, prefs = null) {
  return barSummary(rows, plan, prefs).main;
}

// The plans the bar shows ({ key, rows }, or { key, data: { rows } } as the bar keeps them), each
// with its barSummary() as `summary`: the ones with something shown. `hidden` when there are
// plans with numbers but the settings show none of them (the bar then keeps a quiet way into
// the panel, so Customize can be reached again).
export function barPlans(plans, prefs = null) {
  const withRows = (plans ?? []).filter((p) => (p?.rows ?? p?.data?.rows)?.length);
  const shown = withRows.map((p) => ({ ...p, summary: barSummary(p.rows ?? p.data.rows, p.key, prefs) })).filter((p) => p.summary.main);
  return { shown, hidden: withRows.length > 0 && shown.length === 0 };
}

// Whether Customize may turn `key` ("<plan>" or "<plan>/<id>") off: not when that would leave
// the bar with no plan at all, since the bar is the way into this panel.
export function canTurnOff(plans, prefs, key) {
  const before = barPlans(plans, prefs);
  if (!before.shown.length) return true;
  return barPlans(plans, { ...(prefs ?? {}), [key]: false }).shown.length > 0;
}

// Structured blocks for the Plan usage limits panel:
//   - Grouped pools (Antigravity, Codex): { kind: "pool", group, note, rows, governing }
//     where `governing` is the bar's main row when it's in this pool.
//   - Un-grouped limits (Claude): { kind: "limit", row, children }
//     where scoped sub-limits (e.g. Weekly · Fable) nest under their parent window
//     (Weekly · all models), or stay standalone if that parent row isn't present.
export function panelBlocks(rows, plan = null, prefs = null) {
  const blocks = blocksOf(rows);
  const { main } = barSummary(rows, plan, prefs);
  const out = [];
  const parents = new Map();
  const pendingSubs = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.group) {
      out.push({ kind: "pool", group: b.group, note: b.note, rows: b.rows, governing: main && b.rows.includes(main) ? main : null });
      continue;
    }
    const r = b.rows[0];
    if (isSubLimit(r)) {
      pendingSubs.push(r);
      continue;
    }
    const entry = { kind: "limit", row: r, children: [] };
    const key = r.kind === "session" || r.short === "5h" ? "session" : r.kind === "weekly_all" || r.short === "week" ? "weekly_all" : null;
    if (key && !parents.has(key)) parents.set(key, entry);
    out.push(entry);
  }

  for (const r of pendingSubs) {
    const parent = parents.get(parentKindOf(r));
    if (parent) parent.children.push(r);
    else out.push({ kind: "limit", row: r, children: [] });
  }
  return out;
}

// Customize's list for one plan, in the panel's order: { unit, on, depth } with Claude's model
// limits (Fable) under the window they belong to (depth 1), as the panel nests them.
export function customizeRows(rows, plan, prefs) {
  const units = usageUnits(rows);
  const byRow = new Map(units.map((u) => [u.rows[0], u]));
  const out = [];
  const used = new Set();
  const push = (u, depth) => { if (u && !used.has(u)) { used.add(u); out.push({ unit: u, on: unitOn(prefs, plan, u), depth }); } };
  for (const b of panelBlocks(rows)) {
    if (b.kind === "pool") { push(units.find((u) => u.pool && u.rows.includes(b.rows[0])), 0); continue; }
    push(byRow.get(b.row), 0);
    for (const c of b.children) push(byRow.get(c), 1);
  }
  for (const u of units) push(u, 0);
  return out;
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

// The bar's text for a plan's main limit: "81%", or "100% · 4:17 PM" once it's full.
export function barText(r, now = Date.now()) {
  const pct = `${Math.round(r.pct)}%`;
  const back = full(r) ? backText(r.resets, now) : "";
  return back ? `${pct} · ${back}` : pct;
}

// The bar's inline callout for a warm sub-limit: "Fable 97%", or "Fable 100% (11:00 PM)"
// once full (parentheses avoid double middle dots after "84% · ").
export function subBarText(r, now = Date.now(), name = subName(r)) {
  const pct = `${Math.round(r.pct)}%`;
  const back = full(r) ? backText(r.resets, now) : "";
  return back ? `${name} ${pct} (${back})` : `${name} ${pct}`;
}

// The hover's lines for one plan: "Claude: week 81%, Fable 97%", or a line per group,
// "Antigravity, Gemini: 5h 0%, week 41%", a full limit with "until 4:17 PM".
export function hoverLines(name, rows, now = Date.now()) {
  const say = (r) => {
    const back = full(r) ? backText(r.resets, now) : "";
    return `${r.short} ${Math.round(r.pct)}%${back ? ` until ${back}` : ""}`;
  };
  const lines = [];
  const loose = [];
  for (const b of blocksOf(rows)) {
    if (!b.group) { loose.push(...b.rows); continue; }
    // A plan whose pool has its own name ("Codex") says it once.
    lines.push(`${b.group === name ? name : `${name}, ${b.group.replace(/ models$/, "")}`}: ${b.rows.map(say).join(", ")}`);
  }
  if (loose.length) lines.unshift(`${name}: ${loose.map(say).join(", ")}`);
  return lines;
}

// The one time-ago rule (as Notes' ago()), always rounded down, with " ago": "just now"
// under a minute, then "7m ago", "3h ago", "12d ago" (under 60 days), "4mo ago" (days/30,
// under 730 days), "2y ago" (days/365). Never "60m", "24h" or "27mo".
export function agoText(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 60) return `${d}d ago`;
  return d < 730 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`;
}

// A plan's numbers that the last ask couldn't refresh: its last try came more than a
// minute after the rows were read. data: { rows, at, tried, away } (away: its agent said
// it isn't signed in). Null while they're current; else { ago, why } for the words.
export function staleOf(data, now = Date.now()) {
  if (!data?.at || !data.tried || data.tried - data.at <= 60000) return null;
  return { ago: agoText(data.at, now), why: data.away ? "not signed in" : "couldn't refresh" };
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

// Not usage, the status bar's other rule: "· 1 needs you" goes to the first agent waiting on
// you (agents() order), and its hover names it as its Agents row does: "Go to migrate in Globex".
// `tabOf(a)` is the agent's tab ({ name, named }, spaces()). Null while none waits.
// `owner` is the workspace its space belongs to (null: none, so every space), for the switcher to
// show first: while the shown workspace is empty, Herdr may already show that very space under the
// empty block, so focusing the pane changes nothing the switcher could follow.
export function firstWaiting(list, tabOf = () => null, assigned = {}, defs = []) {
  const a = (list ?? []).find((x) => x?.status === "blocked" && x.pane);
  if (!a) return null;
  const name = agentName(tabOf(a), a) || "it";
  const ws = assigned?.[a.space];
  const owner = ws && (defs ?? []).some((d) => d?.id === ws) ? ws : null;
  return { pane: a.pane, owner, tip: `Go to ${name}${a.space_name ? ` in ${a.space_name}` : ""}` };
}

// An agent's name as ws-agents' row gives it (its title() and clean(), Herdr 0.1.15-0.1.17): the
// tab's name when someone named it (and it isn't just the program's), else the terminal's title
// when it tells something (not a path, an address, a login or the program), else the program.
const cleanTitle = (s) => (s ?? "").replace(/^(?:\[ [!.] \] |[✋⏳]\uFE0F?(?=\s)|(?!(?:\p{Emoji}\uFE0F|[#*]\u20E3))[^\p{L}\p{N}\p{Ps}\p{Pi}\p{Emoji_Presentation}])+/u, "").trim();
export function agentName(tab, a) {
  const prog = a?.program?.name;
  if (tab?.named && tab.name && tab.name !== prog) return tab.name;
  const live = cleanTitle(a?.title);
  const path = /^[~/]|^[A-Za-z]:\\/.test((a?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== a?.address && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== a?.program?.key;
  return telling ? live : prog || null;
}
