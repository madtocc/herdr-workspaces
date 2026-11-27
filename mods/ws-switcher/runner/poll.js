// The runner's slow look beside its folder watches: a watch can miss a save (on Linux, Node watches each
// file by itself, so a file saved by rename is seen once and then not), so once a minute the automation
// files, each workspace's workspace.jsonc, its cards (tasks/*.md: a card's pr: line, a card that moved) and
// its presets (agents/*.md) are listed with their inode, size and time. Only when that differs from
// the last look does it ask for the same reload a watch event asks for; unchanged, it does nothing at all.
// Node only (the runner's own code, never loaded by Herdr's window).
import * as nfs from "node:fs/promises";

export const POLL = 60000;

// What the files are now, as one string: the same files unchanged give the same string.
export async function filesNow(wsDir, globalDir) {
  const out = [];
  const names = async (d, keep) => { try { return (await nfs.readdir(d)).filter(keep).sort(); } catch { return []; } };
  const add = async (p) => { try { const s = await nfs.stat(p); out.push(`${p}\t${s.ino}\t${s.size}\t${s.mtimeMs}`); } catch { out.push(`${p}\t-`); } };
  const md = (n) => n.endsWith(".md") && !n.startsWith(".");
  for (const id of await names(wsDir, (n) => !n.startsWith("."))) {
    await add(`${wsDir}/${id}/workspace.jsonc`);
    for (const sub of ["automations", "tasks", "agents"]) for (const n of await names(`${wsDir}/${id}/${sub}`, md)) await add(`${wsDir}/${id}/${sub}/${n}`);
  }
  for (const n of await names(globalDir, md)) await add(`${globalDir}/${n}`);
  return out.join("\n");
}

// The look and the reloads take turns. Every reload (the watch's or the look's) goes through around(),
// which notes what the files were before it read them (seen). The look skips while a reload is asked for
// or running (busy()), so it never overlaps one, nor itself, and asks for one (ask(): the watch's own
// queue) only when the files differ from seen, with the paths that differ (a card's path makes the
// automations' board check look at that workspace).
export class Poller {
  constructor(look) {
    this.look = look;
    this.seen = null;
    this.looking = false;
  }

  async around(reload) {
    const before = await this.look().catch(() => null);
    await reload();
    if (before !== null) this.seen = before;
  }

  // The minute's look: true when it asked for a reload.
  async tick(busy, ask) {
    if (this.looking || busy()) return false;
    this.looking = true;
    try {
      const now = await this.look().catch(() => null);
      if (now === null || now === this.seen || busy()) return false;
      ask(changedPaths(this.seen, now));
      return true;
    } finally { this.looking = false; }
  }
}

// The paths whose line differs between two listings: changed, made or gone.
export function changedPaths(before, now) {
  const lines = (t) => new Map(String(t ?? "").split("\n").filter(Boolean).map((l) => [l.split("\t")[0], l]));
  const a = lines(before), b = lines(now);
  return [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).sort();
}
