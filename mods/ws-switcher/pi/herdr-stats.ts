// Pi's numbers for Herdr's Agents list (ws-agents): which model, how full the
// context is, how often it was compacted and what the session cost, kept where the
// list reads them, as Claude's status line does (herdr-ws-statusline):
//
//   ~/.herdr/agents/<core>/<terminal>.json
//   { "at": <unix seconds>, "agent": "pi", "pid": <pi's pid>, "status": { ... } }
//
// <core> is the core's socket name ("default"), <terminal> is $HC_TERMINAL_ID, so
// outside a herdr-core terminal it does nothing. herdr-ws-agent loads it (-e) for
// every Pi it starts in one; to have it in a Pi you start yourself, link it into
// ~/.pi/agent/extensions/. Written after each reply, on a model or thinking change,
// a compaction and a new session.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export default function herdrStats(pi: any) {
  const id = process.env.HC_TERMINAL_ID;
  const socket = process.env.HC_TERMINAL_SOCKET;
  if (!id || !socket || !/^[A-Za-z0-9._-]+$/.test(id)) return;
  const core = path.basename(socket).replace(/\.sock$/, "");
  const dir = path.join(process.env.HERDR_WS_AGENTS_DIR || path.join(os.homedir(), ".herdr", "agents"), core);
  const file = path.join(dir, `${id}.json`);
  // Why each compaction ran ("manual", "threshold", "overflow"), by its entry's id:
  // the entry itself doesn't say.
  const reasons = new Map<string, string>();

  const keep = (ctx: any) => {
    try {
      const sm = ctx.sessionManager;
      let compactions = 0;
      let last: any = null;
      for (const e of sm?.getBranch?.() ?? []) if (e?.type === "compaction") { compactions++; last = e; }
      let cost = 0;
      for (const e of sm?.getEntries?.() ?? []) {
        if (e?.type === "message" && e.message?.role === "assistant") cost += Number(e.message.usage?.cost?.total) || 0;
        else if (e?.type === "compaction") cost += Number(e.usage?.cost?.total) || 0;
      }
      const usage = ctx.getContextUsage?.() ?? null;
      const m = ctx.model ?? null;
      const status = {
        session_id: sm?.getSessionId?.() ?? null,
        session_file: sm?.getSessionFile?.() ?? null,
        model: m ? { id: m.id ?? null, name: m.name ?? null, provider: m.provider ?? null } : null,
        thinking: ctx.thinkingLevel ?? null,
        context: usage ? { tokens: usage.tokens ?? null, window: usage.contextWindow ?? m?.contextWindow ?? null, percent: usage.percent ?? null } : null,
        compactions,
        compacted: last ? { reason: reasons.get(last.id) ?? null, before: last.tokensBefore ?? null, at: Date.parse(last.timestamp) || null } : null,
        cost,
      };
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.${id}.${process.pid}`);
      fs.writeFileSync(tmp, JSON.stringify({ at: Math.floor(Date.now() / 1000), agent: "pi", pid: process.pid, status }));
      fs.renameSync(tmp, file);
    } catch {
      // The list goes without; Pi goes on.
    }
  };

  pi.on("session_start", (_e: any, ctx: any) => keep(ctx));
  pi.on("model_select", (_e: any, ctx: any) => keep(ctx));
  pi.on("thinking_level_select", (_e: any, ctx: any) => keep(ctx));
  pi.on("message_end", (e: any, ctx: any) => { if (e?.message?.role === "assistant") keep(ctx); });
  pi.on("agent_end", (_e: any, ctx: any) => keep(ctx));
  pi.on("session_compact", (e: any, ctx: any) => {
    if (e?.compactionEntry?.id && e.reason) reasons.set(e.compactionEntry.id, e.reason);
    keep(ctx);
  });
}
