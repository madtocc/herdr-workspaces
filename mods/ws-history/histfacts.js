// The History screen's rules: what each agent's saved conversation says about
// itself, how one is resumed, which workspace it belongs to, and which are open
// in a terminal right now. No imports, so `node` can test it directly; scan.js
// (Node) and main.js (the mod) both read it.

// The agents whose conversations can be listed and resumed by id. `program` is the
// agent's key in Herdr's programs table (its icon, name and run command come from
// there); `resume` is what's added to that run command.
export const PROVIDERS = {
  claude: { name: "Claude Code", program: "claude", resume: (s) => ["--resume", s.id] },
  codex: { name: "Codex", program: "codex", resume: (s) => ["resume", s.id] },
  pi: { name: "Pi", program: "pi", resume: (s) => ["--session", s.file || s.id] },
  grok: { name: "Grok", program: "grok", resume: (s) => ["--resume", s.id] },
  opencode: { name: "OpenCode", program: "opencode", resume: (s) => ["--session", s.id] },
  antigravity: { name: "Antigravity", program: "antigravity", resume: (s) => ["--conversation", s.id] },
};

// One line of text for a row: whitespace folded, cut to `max` with an ellipsis.
export function clean(text, max = 160) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

// What a person typed, out of a message's content (a string, or parts). Null for
// what an agent's harness writes in the user's name: tool results, command output,
// reminders, a task handed to a sub-agent's caveat.
export function promptText(content) {
  let text = null;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    if (content.some((p) => p?.type === "tool_result")) return null;
    text = content.filter((p) => p && (p.type === "text" || p.type === "input_text") && typeof p.text === "string").map((p) => p.text).join("\n");
  }
  if (!text) return null;
  text = text.trim();
  // A slash command is kept as the command itself.
  const cmd = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text);
  if (cmd) {
    const args = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/.exec(text)?.[1] ?? "";
    // A bare one (/model, /clear) sets something up; it isn't what was asked.
    return args ? `${cmd[1]} ${args}`.trim() : null;
  }
  if (/^<(local-command-|command-message|system-reminder|environment_context|user_instructions|task-notification|bash-|hc[\s>])/.test(text)) return null;
  if (/^Caveat: The messages below were generated/.test(text)) return null;
  if (/^\[Request interrupted/.test(text)) return null;
  return text;
}

// The whole lines of a piece of a JSONL file, parsed. A piece read from the middle
// of a file starts and ends mid-line: those two are dropped by the parse failing.
function lines(text) {
  const out = [];
  for (const l of String(text ?? "").split("\n")) {
    if (l.length < 2 || l[0] !== "{") continue;
    try { out.push(JSON.parse(l)); } catch { /* cut in two by the read */ }
  }
  return out;
}

const time = (v) => { const t = typeof v === "number" ? v : Date.parse(v ?? ""); return Number.isFinite(t) ? t : null; };

// What an agent said last, as History shows it: `said` (plain text, the outcome line
// taken off) and `outcome`, from the line Herdr asks every automation run to end with
// ("Outcome: done", "Outcome: failed" or "Outcome: nothing to do"; ws-switcher's
// automations.js: OUTCOME_ASK). Only the last line counts, and markdown around it.
const OUTCOME = /^[\s>*_`#-]*outcome[*_`]*\s*:\s*[*_`]*\s*(done|failed|nothing to do)\b/i;
export const OUTCOMES = ["done", "failed", "nothing to do"];
export function reportOf(text) {
  const rows = String(text ?? "").replace(/\r/g, "").split("\n");
  let i = rows.length - 1;
  while (i >= 0 && !rows[i].trim()) i--;
  const m = i >= 0 ? OUTCOME.exec(rows[i]) : null;
  const said = plainText((m ? rows.slice(0, i) : rows).join("\n")).trim();
  return { said: said || null, outcome: m ? m[1].toLowerCase() : null };
}

// Markdown as plain text: no ** or __ or `, links as their words, headings without
// their #, bullets as •.
export function plainText(md) {
  return String(md ?? "").split("\n").map((l) => l
    .replace(/^(\s*)#{1,6}\s+/, "$1")
    .replace(/^(\s*)[-*+]\s+/, "$1• ")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1").replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n");
}

// The start of a Claude Code transcript: where it ran, how it was started, and the
// first thing asked. `entry` is Claude's own word: "cli" (a terminal), "sdk-cli"
// (headless, `claude -p`), "claude-desktop" (the desktop app).
export function claudeHead(text) {
  const out = { cwd: null, entry: null, branch: null, first: null, started: null, side: false };
  for (const o of lines(text)) {
    if (!out.cwd && typeof o.cwd === "string") out.cwd = o.cwd;
    if (!out.entry && typeof o.entrypoint === "string") out.entry = o.entrypoint;
    if (!out.branch && typeof o.gitBranch === "string" && o.gitBranch !== "HEAD") out.branch = o.gitBranch;
    if (!out.started) out.started = time(o.timestamp);
    if (o.isSidechain) out.side = true;
    if (out.first) continue;
    if (o.type === "user" && !o.isMeta && !o.toolUseResult) out.first = promptText(o.message?.content);
    // The desktop app queues the prompt before the turn that holds it.
    else if (o.type === "queue-operation" && o.operation === "enqueue") out.first = promptText(o.content);
  }
  // Cut lines hide fields: the folder and the entry point as plain text, where a
  // real field (not one quoted inside a message) starts with an unescaped quote.
  if (!out.cwd) out.cwd = field(text, "cwd");
  if (!out.entry) out.entry = field(text, "entrypoint");
  return out;
}

// A top-level string field of some line, found without parsing the line.
function field(text, name) {
  const m = new RegExp(`(?<!\\\\)"${name}":"((?:[^"\\\\]|\\\\.)*)"`).exec(String(text ?? ""));
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return null; }
}

// The end of a Claude Code transcript: its title (one you gave it, else Claude's
// own), the last thing asked, the model that answered last, and when.
export function claudeTail(text) {
  const out = { title: null, last: null, model: null, ended: null, context: null, replied: null, said: null, outcome: null };
  let custom = null, ai = null, summary = null;
  // What it said last: the text of its last message, while nothing came after it (a
  // tool call or a prompt). One message's blocks are lines of their own, with its id.
  let said = null, saidId = null;
  for (const o of lines(text)) {
    if (o.type === "custom-title" && o.customTitle) custom = o.customTitle;
    else if (o.type === "ai-title" && o.aiTitle) ai = o.aiTitle;
    else if (o.type === "summary" && o.summary) summary = o.summary;
    else if (o.type === "last-prompt" && o.lastPrompt) out.last = promptText(o.lastPrompt) ?? out.last;
    else if (o.type === "assistant") {
      const id = o.message?.id ?? null;
      for (const c of Array.isArray(o.message?.content) ? o.message.content : []) {
        if (c?.type === "tool_use") { said = null; saidId = null; }
        else if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) {
          said = said !== null && id && id === saidId ? `${said}\n\n${c.text}` : c.text;
          saidId = id;
        }
      }
      if (o.message?.model && o.message.model !== "<synthetic>") {
        out.model = o.message.model;
        const u = o.message.usage;
        const used = u ? (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) : 0;
        if (used > 0) { out.context = used; out.replied = time(o.timestamp); }
      }
    }
    else if (o.type === "user" && !o.isMeta && !o.toolUseResult) {
      const p = promptText(o.message?.content);
      if (p) { out.last = p; said = null; saidId = null; }
    }
    const t = time(o.timestamp);
    if (t) out.ended = t;
  }
  out.title = custom ?? ai ?? summary;
  Object.assign(out, reportOf(said));
  return out;
}

// A pi session file: its first line names the session and its folder; messages
// follow, each `{ type: "message", message: { role, content } }`.
export function piFacts(head, tail = "") {
  const out = { id: null, cwd: null, first: null, last: null, model: null, started: null, ended: null, name: null, context: null, replied: null, said: null, outcome: null };
  let said = null; // its last message's text, while no tool call or prompt came after
  const read = (o, isHead) => {
    if (o.type === "session") { out.id ??= o.id ?? null; out.cwd ??= o.cwd ?? null; out.started ??= time(o.timestamp); }
    else if (o.type === "model_change" && o.modelId) out.model = o.modelId;
    else if (o.type === "session_info" && o.name) out.name = o.name;
    else if (o.type === "message" && o.message?.role === "user") {
      const p = promptText(o.message.content);
      if (p && isHead && !out.first) out.first = p;
      if (p) { out.last = p; said = null; }
    } else if (o.type === "message" && o.message?.role === "assistant") {
      const parts = Array.isArray(o.message.content) ? o.message.content : [];
      const text = parts.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n\n").trim();
      if (parts.some((x) => x?.type === "toolCall")) said = null;
      else if (text) said = text;
      const u = o.message.usage;
      const used = u ? (Number(u.input) || 0) + (Number(u.cacheRead) || 0) + (Number(u.cacheWrite) || 0) : 0;
      if (used > 0) { out.context = used; out.replied = time(o.timestamp); }
    }
    const t = time(o.timestamp);
    if (t) out.ended = t;
  };
  for (const o of lines(head)) read(o, true);
  for (const o of lines(tail)) read(o, false);
  Object.assign(out, reportOf(said));
  return out;
}

// A Codex thread, as a row of its state database's `threads` table. Null for what
// isn't a conversation of yours: a sub-agent's thread, a headless run, an archived one.
export function codexRow(r) {
  if (!r?.id || !r.cwd || Number(r.archived)) return null;
  if (!["cli", "vscode"].includes(String(r.source))) return null;
  if (r.thread_source && r.thread_source !== "user") return null;
  const first = clean(r.first_user_message || r.preview || "", 240);
  const title = clean(r.name || r.title || "", 120);
  if (!first && !title) return null;
  return {
    provider: "codex", id: String(r.id), cwd: String(r.cwd), title: title && title !== clean(first, 120) ? title : "", first, last: "",
    model: r.model ?? "", branch: r.git_branch ?? "",
    started: Number(r.created_at_ms) || Number(r.created_at) * 1000 || 0,
    updated: Number(r.updated_at_ms) || Number(r.updated_at) * 1000 || 0,
    via: r.source === "vscode" ? "app" : "",
  };
}

// An OpenCode session, as a row of its database's `session` table.
export function opencodeRow(r) {
  if (!r?.id || !r.directory || r.parent_id || r.time_archived) return null;
  let model = "";
  try { model = JSON.parse(r.model ?? "null")?.id ?? ""; } catch { model = ""; }
  // Its placeholder title for a session nobody named.
  const title = /^New session - \d{4}-/.test(r.title ?? "") ? "" : clean(r.title, 120);
  return {
    provider: "opencode", id: String(r.id), cwd: String(r.directory), title, first: "", last: "", model, branch: "",
    started: Number(r.time_created) || 0, updated: Number(r.time_updated) || 0, via: "",
  };
}

// A grok session folder's summary.json, with the first prompt from its chat history.
export function grokFacts(summary, first = "") {
  let s;
  try { s = typeof summary === "string" ? JSON.parse(summary) : summary; } catch { return null; }
  if (!s?.info?.id || !s.info.cwd) return null;
  return {
    provider: "grok", id: String(s.info.id), cwd: String(s.info.cwd),
    title: clean(s.title || s.session_summary || "", 120), first: clean(first, 240), last: "",
    model: s.current_model_id ?? "", branch: "",
    started: time(s.created_at) ?? 0, updated: time(s.last_active_at) ?? time(s.updated_at) ?? 0, via: "",
  };
}

// An Antigravity transcript (brain/<id>/.system_generated/logs/transcript.jsonl): the
// first and last thing asked, the model that answered last, and when it started. A
// prompt is the text inside <USER_REQUEST>; what hc types in is left out, as for the others.
export function agyFacts(head, tail = "") {
  const out = { first: null, last: null, model: null, started: null, context: null, replied: null, said: null, outcome: null };
  let said = null; // its last response's words, while no tool call or prompt came after
  const read = (o, isHead) => {
    if (isHead && !out.started) out.started = time(o.created_at);
    if (typeof o.model === "string" && o.model) out.model = o.model;
    if (o.type === "PLANNER_RESPONSE") {
      const used = (Number(o.input_tokens) || 0) + (Number(o.cache_read_tokens) || 0);
      if (used > 0) { out.context = used; out.replied = time(o.created_at); }
      const calls = o.tool_calls;
      if (Array.isArray(calls) ? calls.length : calls && calls !== "[]") said = null;
      else if (typeof o.content === "string" && o.content.trim()) said = o.content;
    }
    if (o.type !== "USER_INPUT" || o.source !== "USER_EXPLICIT") return;
    const m = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(String(o.content ?? ""));
    const p = m ? promptText(m[1]) : null;
    if (p && isHead && !out.first) out.first = p;
    if (p) { out.last = p; said = null; }
  };
  for (const o of lines(head)) read(o, true);
  for (const o of lines(tail)) read(o, false);
  Object.assign(out, reportOf(said));
  return out;
}

// Where an Antigravity conversation ran, from its workspace folders (`file://` URIs in
// its summary). One the launcher started has its rules folder (under `agyDir`,
// ~/.herdr/agy) among them, and `rules(folder)` (that folder's AGENTS.md) names the
// working folder. Otherwise the folder Antigravity says it last ran in there
// (`lastIn`), else the first of the rest, which is where it runs commands.
export function agyCwd(uris, agyDir, rules, lastIn) {
  const paths = [];
  for (const u of Array.isArray(uris) ? uris : []) {
    if (typeof u !== "string" || !u.startsWith("file://")) continue;
    try { paths.push(decodeURIComponent(u.slice(7)).replace(/\/+$/, "") || "/"); } catch { /* not a path */ }
  }
  // Its rules folders: under agyDir, or anything shaped like one (another home's).
  const ours = (x) => inside(x, agyDir) || /\/\.herdr\/agy\/[^/]+\/[^/]+$/.test(x);
  for (const p of paths.filter(ours)) {
    const m = /Your working folder is (.+?)\. Run every command there/.exec(String(rules(p) ?? ""));
    if (m) return m[1];
  }
  const rest = paths.filter((x) => !ours(x));
  return (lastIn && rest.includes(lastIn) ? lastIn : rest[0]) ?? null;
}

// An Antigravity conversation, as a row of its conversation_summaries table, with
// agyFacts() from its transcript. Null for a sub-agent's. Antigravity titles the ones
// you talk to; a print run (`agy -p`) keeps none, so one without a title is headless.
export function agyRow(r, facts, cwd) {
  if (!r?.conversation_id || !cwd || r.parent_conversation_id || Number(r.nesting_depth) > 0) return null;
  const first = clean(facts?.first || r.preview || "", 240);
  const title = clean(r.title || "", 120);
  if (!first && !title) return null;
  const updated = time(String(r.last_modified_time ?? "").replace(" ", "T")) ?? 0;
  return {
    provider: "antigravity", id: String(r.conversation_id), cwd, title: title && title !== clean(first, 120) ? title : "", first,
    last: samePrompt(facts?.first, facts?.last) ? "" : clean(facts?.last, 240), model: facts?.model ?? "", branch: "",
    started: facts?.started ?? updated, updated, via: "", headless: !r.title,
  };
}

// The words of a launcher note (herdr-ws-agent writes them, quoted as sh reads
// them: bare words and '…' with '\'' for a quote inside). Null when it's anything else.
export function shellWords(text) {
  const out = [];
  const s = String(text ?? "").trim();
  let i = 0;
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (i >= s.length) break;
    let word = "";
    while (i < s.length && s[i] !== " " && s[i] !== "\t") {
      if (s[i] === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) return null;
        word += s.slice(i + 1, end);
        i = end + 1;
      } else if (s[i] === "\\" && i + 1 < s.length) { word += s[i + 1]; i += 2; }
      else if (/["`$;&|<>(){}*?!#~\n]/.test(s[i])) return null; // not a plain list of words
      else word += s[i++];
    }
    out.push(word);
  }
  return out;
}

// The command that continues a conversation: how it was started when the launcher
// noted that (a preset keeps its model, its permissions and its instructions), else
// the agent's run command from Herdr's programs table, then the agent's resume words.
export function resumeArgv(session, run) {
  const p = PROVIDERS[session.provider];
  if (!p) return null;
  const noted = session.words ? shellWords(session.words) : null;
  const base = noted?.length > 1 && noted[0].split("/").pop() === "herdr-ws-agent" ? noted : run?.length ? run : [p.program];
  return [...base, ...p.resume(session)];
}

// The preset a conversation was started from, by the launcher's note: its file's name.
export function presetOf(session) {
  const words = session.words ? shellWords(session.words) : null;
  const i = words ? words.lastIndexOf("--instructions") : -1;
  return i >= 0 && words[i + 1] ? words[i + 1].split("/").pop().replace(/\.md$/, "") : "";
}

export const inside = (p, dir) => Boolean(p && dir) && (p === dir || p.startsWith(dir + "/"));
const base = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();

// Whether a folder is one of a workspace's: under its root or one of its folders
// (or where a symlink leads to them), or a Herdr worktree of one of its repos
// (`<trees>/<repo>/…`), as the launcher decides which workspace an agent is in.
export function inWorkspace(cwd, def, trees) {
  if (!cwd || !def || def.error) return false;
  const real = def.real ?? {};
  const places = [def.root, ...(def.folders ?? [])].filter(Boolean);
  for (const p of places) if (inside(cwd, p) || inside(cwd, real[p])) return true;
  if (trees && inside(cwd, trees) && cwd !== trees) {
    const repo = cwd.slice(trees.length + 1).split("/")[0];
    const repos = new Set([...(def.children ?? []), ...(def.folders ?? []).map(base)]);
    if (repos.has(repo)) return true;
  }
  return false;
}

// Where a conversation ran, short: from the workspace's root when it's inside it,
// a worktree by its repo and branch folder, else from home.
export function whereOf(cwd, def, home, trees) {
  if (!cwd) return "";
  const real = def?.real ?? {};
  for (const root of [def?.root, real[def?.root]]) {
    if (root && inside(cwd, root)) return cwd === root ? base(root) : cwd.slice(root.length + 1);
  }
  if (trees && inside(cwd, trees) && cwd !== trees) return cwd.slice(trees.length + 1);
  if (home && inside(cwd, home)) return cwd === home ? "~" : "~" + cwd.slice(home.length);
  return cwd;
}

// Which conversations are open in a terminal now: conversation key -> address.
// Known for sure, in this order: a Claude conversation the launcher's hook noted
// (`session.terminal`), then one History itself resumed (`claims`: key -> address),
// each only while that terminal is live and still runs that agent. For the rest,
// each live terminal running that agent in that folder is taken to hold the folder's
// most recently used conversation not already claimed: a guess, since two agents in
// one folder are told apart only by which was used last.
// `terms`: [{ address, program, cwd }], the live agent terminals.
export function liveOf(sessions, terms, claims = {}) {
  const map = new Map();
  const free = new Map(terms.map((t) => [t.address, t]));
  const runs = (s, address) => free.get(address)?.program === PROVIDERS[s.provider]?.program;
  const take = (s, address) => { map.set(keyOf(s), address); free.delete(address); };
  for (const s of sessions) if (s.terminal && runs(s, s.terminal)) take(s, s.terminal);
  for (const s of sessions) {
    const address = claims[keyOf(s)];
    if (address && !map.has(keyOf(s)) && runs(s, address)) take(s, address);
  }
  const sorted = [...sessions].sort((a, b) => b.updated - a.updated);
  for (const t of [...free.values()]) {
    const s = sorted.find((x) => !map.has(keyOf(x)) && PROVIDERS[x.provider]?.program === t.program && x.cwd === t.cwd);
    if (s) take(s, t.address);
  }
  return map;
}

export const keyOf = (s) => `${s.provider}/${s.id}`;

// Whether two prompts are the same one, though either may have been cut short ("…").
export function samePrompt(a, b) {
  const x = clean(a, 1e6).replace(/…$/, ""), y = clean(b, 1e6).replace(/…$/, "");
  if (!x || !y) return false;
  return x.length <= y.length ? y.startsWith(x) : x.startsWith(y);
}

// What a row is called: its title, else the first thing asked.
export const titleOf = (s) => s.title || clean(s.first, 120) || "(nothing asked yet)";

// Every word of the search appears in the row's text, whatever the case.
export function matches(session, query, extra = "") {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [session.title, session.first, session.last, session.cwd, session.branch, session.model, PROVIDERS[session.provider]?.name, extra].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

// --- Compactions ---
// What an agent writes into its transcript when it compacts the conversation (cuts the
// earlier part and sums it up): the text scan.js looks for, and the record as
// { at, trigger: "auto" | "manual" | null, pre, post } (tokens before and after, when
// it says). Codex, Grok and OpenCode keep none this reads.
export const COMPACTION = { claude: '"compact_boundary"', pi: '"type":"compaction"', antigravity: '"CHECKPOINT"' };
const count = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
export function compactionOf(provider, line) {
  let o; try { o = JSON.parse(line); } catch { return null; }
  if (provider === "claude" && o.type === "system" && o.subtype === "compact_boundary") {
    const m = o.compactMetadata ?? {};
    return { at: time(o.timestamp), trigger: m.trigger === "manual" || m.trigger === "auto" ? m.trigger : null, pre: count(m.preTokens), post: count(m.postTokens) };
  }
  if (provider === "pi" && o.type === "compaction") return { at: time(o.timestamp), trigger: null, pre: count(o.tokensBefore), post: null };
  if (provider === "antigravity" && o.type === "CHECKPOINT") return { at: time(o.created_at), trigger: "auto", pre: null, post: null };
  return null;
}

// What's in the context at the end: the newest reply's, unless a compaction came after
// it (then what that one kept, when it says).
export function contextAtEnd(tail, last) {
  if (last?.at && (!tail?.replied || last.at > tail.replied)) return last.post ?? null;
  return tail?.context ?? null;
}

// "950", "48k", "1.2M" tokens.
export function tokens(n) {
  if (n == null) return "";
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

// One compaction, for the details: "20 Nov 14:02  ·  automatically  ·  375k → 45k".
export function compactionText(c) {
  const how = c.trigger === "manual" ? "by /compact" : c.trigger === "auto" ? "automatically" : "";
  const size = c.pre ? (c.post ? `${tokens(c.pre)} → ${tokens(c.post)}` : `from ${tokens(c.pre)}`) : "";
  return [c.at ? span(c.at, null) : "", how, size].filter(Boolean).join("  ·  ");
}

// The row's hover: "Compacted 3 times, last automatically, 375k → 45k".
export function compactionsTip(n, last) {
  if (!n) return "";
  const how = last?.trigger === "manual" ? "by /compact" : last?.trigger === "auto" ? "automatically" : "";
  const size = last?.pre ? (last.post ? `${tokens(last.pre)} → ${tokens(last.post)}` : `from ${tokens(last.pre)}`) : "";
  const what = [how, size].filter(Boolean).join(", ");
  return `Compacted ${n === 1 ? "once" : n === 2 ? "twice" : `${n} times`}${what ? `, last ${what}` : ""}`;
}

// --- Automation runs ---
// The runs the switcher publishes (shared "workspaces.automation.runs", newest first;
// mods/ws-switcher/automations.js), as History's Automations list shows them.

// A run's state in words, and its color by the Automations screen's rule (working:
// the working color; needs you, failures, misses: the blocked one; the rest dim).
// `quiet`: an entry for a run its check (or a miss, or a skip) kept from starting.
// now: { status, live, open, found, said, outcome }: its agent's status word (null when
// nothing reports), whether its terminal is alive, whether its tab is still there,
// whether its conversation was found, and what it said last (reportOf). Once it's
// ended, its outcome line says how it went; without one, a report says done. A run
// asked for that line (`reports`) that ended its turn without one is waiting on an
// answer, while its tab is open.
export function runState(r, now = {}) {
  const { status = null, live = false, open = false, found = false, said = null, outcome = null } = now;
  const quiet = (word, tone = "dim") => ({ word, tone, quiet: true, open: false });
  const times = r.times > 1 ? ` ×${r.times}` : "";
  switch (r.status) {
    case "started": break;
    case "failed": return r.check ? quiet(`check failed${times}`, "blocked") : { word: "failed to start", tone: "blocked", quiet: false, open: false };
    case "quiet": return quiet(`quiet${times}`);
    case "missed": return quiet("missed", "blocked");
    case "waiting": return quiet(`check not allowed${times}`, "blocked");
    case "skipped": return quiet("skipped");
    default: return quiet(String(r.status ?? ""));
  }
  const state = (word, tone, isOpen) => ({ word, tone, quiet: false, open: isOpen });
  const ended = outcome === "failed" ? ["failed", "blocked"] : outcome === "nothing to do" ? ["nothing to do", "dim"] : outcome || said ? ["done", "muted"] : null;
  const there = open && live && !r.closed;
  if (there) {
    if (status === "working") return state("running", "working", true);
    if (status === "blocked") return state("needs you", "blocked", true);
    if (r.stuck) return state("stuck", "blocked", true);
    if (status === "done" || status === "idle") {
      if (r.reports && said && !outcome) return state("needs you", "blocked", true);
      return ended ? state(...ended, true) : state("finished", "muted", true);
    }
    return state("open", "muted", true); // a script, or a shell
  }
  if (ended) return state(...ended, false);
  if (found && runProvider(r) && READS.has(runProvider(r))) return state("no report", "dim", false);
  return state(r.closed ? "finished" : "closed", "dim", false);
}

// The agents whose last words History reads (scan.js): a run of another ends as
// "finished" or "closed", never "no report".
export const READS = new Set(["claude", "pi", "antigravity"]);

// Every word of the search is in the run's name, why it ran, its note, its state, its
// workspace or what it said last (`extra`).
export function runMatches(r, query, extra = "") {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.name, r.why, r.note, r.folder, extra].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

// The agent a run's report names ("claude-code", "pi"), as PROVIDERS has it.
export function runProvider(r) {
  if (r?.conv?.provider) return r.conv.provider;
  const a = String(r?.app ?? "").toLowerCase();
  if (a.startsWith("claude")) return "claude";
  if (a.startsWith("antigravity") || a === "agy") return "antigravity";
  const w = a.split(/[-_ ]/)[0];
  return PROVIDERS[w] ? w : null;
}

// Each run's conversation among History's rows: run id -> session. The one the runner
// noted (`conv`); a noted one that isn't among the rows (read before it was saved) still
// resumes, plainly (`stub`: nothing of it was read). For the others, a guess: each conversation of that agent in the run's
// folder that no run noted goes to the run that started last before it (a minute's slack),
// if it started before that run closed. Two runs in one folder at once can be told apart
// only by their notes.
export function runSessions(runs, sessions) {
  const out = new Map();
  const mine = (runs ?? []).filter((r) => r?.status === "started");
  const taken = new Set(mine.filter((r) => r.conv?.id).map((r) => `${r.conv.provider}/${r.conv.id}`));
  for (const r of mine) {
    if (!r.conv?.id || !PROVIDERS[r.conv.provider]) continue;
    const s = sessions.find((x) => x.provider === r.conv.provider && x.id === r.conv.id)
      ?? (r.folder ? { provider: r.conv.provider, id: r.conv.id, cwd: r.folder, title: "", first: "", last: "", started: r.at, updated: r.closed ?? r.at, stub: true } : null);
    if (s) out.set(r.id, s);
  }
  const guessing = mine.filter((r) => !r.conv?.id && r.folder && runProvider(r)).sort((a, b) => b.at - a.at);
  for (const s of [...sessions].sort((a, b) => a.started - b.started)) {
    if (taken.has(`${s.provider}/${s.id}`)) continue;
    const r = guessing.find((x) => !out.has(x.id) && runProvider(x) === s.provider && x.folder === s.cwd && x.at - 60e3 <= s.started && s.started <= (x.closed ?? Infinity));
    if (r) out.set(r.id, s);
  }
  return out;
}

const DAY = 86400e3;
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The heading a conversation is listed under, by the day it was last used.
export function dayLabel(ms, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(ms);
  if (days < 7) return DAYS[d.getDay()];
  const same = d.getFullYear() === new Date(now).getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${same ? "" : ` ${d.getFullYear()}`}`;
}

// How long ago, short: "now", "5m", "3h", "2d", "4mo".
export function ago(ms, now = Date.now()) {
  if (!ms) return "";
  const d = Math.max(0, now - ms) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86400) return `${Math.round(d / 3600)}h`;
  if (d < 86400 * 60) return `${Math.round(d / 86400)}d`;
  return `${Math.round(d / 86400 / 30)}mo`;
}

// When a conversation ran: "20 Nov 11:02 to 14:33", or both days when they differ.
export function span(from, to) {
  const two = (n) => String(n).padStart(2, "0");
  const day = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const hour = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
  const a = from ? new Date(from) : null, b = to ? new Date(to) : null;
  if (!a && !b) return "";
  if (!a || !b) { const d = a ?? b; return `${day(d)} ${hour(d)}`; }
  return day(a) === day(b) && a.getFullYear() === b.getFullYear() ? `${day(a)} ${hour(a)} to ${hour(b)}` : `${day(a)} ${hour(a)} to ${day(b)} ${hour(b)}`;
}

// The time of day, "21:15".
export function clock(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// How long something took, in words: "40 s", "1 min 33 s", "25 min", "2 h 5 min".
export function took(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 10) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  if (m < 60) return `${Math.round(s / 60)} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

// When a run ran, for its opened row: "Yesterday 21:15, for 1 min 33 s", "Today 10:41,
// running for 3 min", or the start alone. Its end: when its conversation was last
// written (`updated`, when it's its own: `found`), else when the runner closed its tab.
export function ranText(r, st, s, now = Date.now()) {
  const began = `${dayLabel(r.at, now)} ${clock(r.at)}`;
  if (r.status !== "started") return began;
  if (st.word === "running") return `${began}, running for ${took(now - r.at)}`;
  const end = s && !s.stub && s.updated > r.at ? s.updated : r.closed;
  return end && end > r.at ? `${began}, for ${took(end - r.at)}` : began;
}

// A model's id, short enough for a row: without the vendor prefix or a date stamp.
export function modelLabel(id) {
  return String(id ?? "").replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
}
