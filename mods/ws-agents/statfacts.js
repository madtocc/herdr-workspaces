// What an agent's own records say about it: the model, how full its context is, how
// often it was compacted and what it cost. No imports, so `node` can test it
// directly; stats.js does the reading. The plans' usage is ws-status's (usagefacts.js).
//
// Sources, per agent:
//   Claude Code  what it hands its status line (kept by herdr-ws-statusline in
//                ~/.herdr/agents/<core>/<terminal>.json) and its transcript
//                (~/.claude/projects/<folder>/<session>.jsonl), found through
//                ~/.claude/sessions/<pid>.json for a Claude started without the launcher.
//   Antigravity  its transcript (~/.gemini/antigravity-cli/brain/<id>/.system_generated/
//                logs/transcript.jsonl), found through the launcher's restart note
//                (~/.herdr/resume/<core>/<terminal>.session), read on as Claude's is.
//   Pi           what the launcher's extension (ws-switcher/pi/herdr-stats.ts) keeps in
//                the same place, from Pi's own numbers (getContextUsage(), its entries).

// "claude-fable-5-2" -> "Fable 5.2", "claude-sonnet-4-5-20250929[1m]" -> "Sonnet 4.5".
// Anything else is shown as it is.
export function modelName(id) {
  const s = String(id ?? "").replace(/\[.*\]$/, "");
  const m = s.match(/^claude-([a-z]+)((?:-\d+)+?)(?:-\d{8})?$/);
  if (!m) return s;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].slice(1).split("-").join(".")}`;
}

// 38546 -> "39k", 1000000 -> "1M", 1250000 -> "1.3M".
export function tokens(n) {
  if (n == null || !Number.isFinite(n)) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

// The tokens an API reply's usage says were in its context (what was sent, cached or not).
export function inContext(u) {
  if (!u) return null;
  const n = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return n > 0 ? n : null;
}

const time = (s) => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : null; };

// A transcript's new lines, read on from where the last read stopped. `state` is what
// the last read kept ({ n, last, reply }), `text` the complete lines after it.
//   n       how many times it was compacted
//   last    the newest compaction: { trigger: "auto" | "manual", pre, post, at }
//   reply   the newest reply of the main conversation: { model, used, at }
// Sub-agents' replies (isSidechain) and Claude Code's own stand-ins (model
// "<synthetic>") don't count. A compaction after the newest reply sets what's in
// the context to what the compaction kept.
export function claudeScan(text, state = {}) {
  const out = { n: state.n ?? 0, last: state.last ?? null, reply: state.reply ?? null };
  for (const line of String(text).split("\n")) {
    if (line.includes('"compact_boundary"')) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.subtype !== "compact_boundary") continue;
      const m = o.compactMetadata ?? {};
      out.n += 1;
      out.last = { trigger: m.trigger ?? null, pre: m.preTokens ?? null, post: m.postTokens ?? null, at: time(o.timestamp) };
    } else if (line.includes('"assistant"') && line.includes('"usage"')) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "assistant" || o.isSidechain) continue;
      const model = o.message?.model;
      const used = inContext(o.message?.usage);
      if (!model || model === "<synthetic>" || used == null) continue;
      out.reply = { model, used, at: time(o.timestamp) };
    }
  }
  return out;
}

// What Claude handed its status line (the file herdr-ws-statusline keeps), as facts.
// The context: what's in it, the window's size and how full that is; null before the
// first reply, and again right after a compaction until the next one.
export function claudeStatus(file) {
  const s = file?.status;
  if (!s || typeof s !== "object") return null;
  const cw = s.context_window ?? {};
  const used = inContext(cw.current_usage) ?? (cw.total_input_tokens > 0 ? cw.total_input_tokens : null);
  return {
    at: Number(file.at) * 1000 || null,
    session: s.session_id ?? null,
    transcript: s.transcript_path ?? null,
    model: s.model?.id ?? null,
    name: s.model?.display_name ?? null,
    effort: s.effort?.level ?? null,
    used,
    size: cw.context_window_size ?? null,
    pct: used == null ? null : (cw.used_percentage ?? null),
    cost: s.cost?.total_cost_usd ?? null,
    lines: s.cost ? { added: s.cost.total_lines_added ?? 0, removed: s.cost.total_lines_removed ?? 0 } : null,
  };
}

// One agent's facts from its status line (when it's this session's) and its transcript.
// `sizes`: each model's context window as status lines reported it, for a session
// without one of its own (a Claude started before, or without, the launcher).
export function claudeFacts(status, scan, sizes = {}) {
  const st = status ?? {};
  const reply = scan?.reply ?? null;
  const last = scan?.last ?? null;
  // Compacted after the newest reply: what's in the context is what the compaction kept.
  const compactedSince = last?.at && (!reply?.at || last.at > reply.at);
  let used = st.used ?? null;
  if (used == null || (compactedSince && st.at && last.at > st.at)) used = compactedSince ? last.post : reply?.used ?? null;
  const model = st.model ?? reply?.model ?? null;
  const size = st.size ?? (model ? sizes[model] : null) ?? null;
  const pct = used != null && size ? Math.round((used / size) * 100) : null;
  return {
    app: "claude",
    model,
    name: st.name ?? (model ? modelName(model) : null),
    effort: st.effort ?? null,
    used,
    size,
    pct: st.pct != null && st.used === used ? Math.round(st.pct) : pct,
    compactions: scan?.n ?? 0,
    compacted: last,
    cost: st.cost ?? null,
    lines: st.lines ?? null,
    at: Math.max(st.at ?? 0, reply?.at ?? 0, last?.at ?? 0) || null,
  };
}


// What Pi's extension kept (herdr-stats.ts), as facts. Its thinking level stands in
// for Claude's effort; its compactions say how big the context was, not what was kept.
export function piFacts(file) {
  const s = file?.status;
  if (!s || typeof s !== "object") return null;
  const c = s.context ?? {};
  const k = s.compacted;
  return {
    app: "pi",
    model: s.model?.id ?? null,
    name: s.model?.name ?? s.model?.id ?? null,
    provider: s.model?.provider ?? null,
    effort: s.thinking && s.thinking !== "off" ? s.thinking : null,
    used: c.tokens ?? null,
    size: c.window ?? null,
    pct: c.percent != null ? Math.round(c.percent) : c.tokens != null && c.window ? Math.round((c.tokens / c.window) * 100) : null,
    compactions: s.compactions ?? 0,
    compacted: k ? { trigger: k.reason === "manual" ? "manual" : k.reason ? "auto" : null, pre: k.before ?? null, post: null, at: k.at ?? null } : null,
    cost: s.cost > 0 ? s.cost : null,
    lines: null,
    at: Number(file.at) * 1000 || null,
  };
}

// Antigravity's model ids carry the effort: "gemini-4-neon-high" -> "Gemini 4 Neon",
// "high"; "claude-opus-5-5-medium" -> "Opus 5.5", "medium".
export function agyModel(id) {
  const m = String(id ?? "").match(/^(.*?)(?:-(minimal|low|medium|high|xhigh|max))?$/);
  const base = m?.[1] ?? "";
  const name = base.startsWith("claude-") ? modelName(base)
    : base.split("-").map((w) => (/^(gpt|oss)$/.test(w) ? w.toUpperCase() : /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return { name: name || null, effort: m?.[2] ?? null };
}

// An Antigravity transcript's new lines, as claudeScan() reads Claude's: its replies
// (PLANNER_RESPONSE: the model, and what was sent, cached or not) and its
// checkpoints (CHECKPOINT: the earlier conversation cut and summed up, its compaction).
export function agyScan(text, state = {}) {
  const out = { n: state.n ?? 0, last: state.last ?? null, reply: state.reply ?? null };
  for (const line of String(text).split("\n")) {
    if (!line.includes('"CHECKPOINT"') && !line.includes('"PLANNER_RESPONSE"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "CHECKPOINT") {
      out.n += 1;
      out.last = { trigger: "auto", pre: out.reply?.used ?? null, post: null, at: time(o.created_at) };
    } else if (o.type === "PLANNER_RESPONSE" && o.model) {
      const used = (Number(o.input_tokens) || 0) + (Number(o.cache_read_tokens) || 0);
      if (used > 0) out.reply = { model: o.model, used, at: time(o.created_at) };
    }
  }
  return out;
}

// One Antigravity conversation's facts. Its window's size isn't recorded anywhere,
// so it says what's in the context, not how full that is.
export function agyFacts(scan) {
  const reply = scan?.reply ?? null;
  const last = scan?.last ?? null;
  const { name, effort } = agyModel(reply?.model);
  const compactedSince = last?.at && (!reply?.at || last.at > reply.at);
  return {
    app: "agy",
    model: reply?.model ?? null,
    name,
    effort,
    used: compactedSince ? null : reply?.used ?? null,
    size: null,
    pct: null,
    compactions: scan?.n ?? 0,
    compacted: last,
    cost: null,
    lines: null,
    at: Math.max(reply?.at ?? 0, last?.at ?? 0) || null,
  };
}

