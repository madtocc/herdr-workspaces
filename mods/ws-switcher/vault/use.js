// Finding the secrets a request names, in the caller's scope, and noting a use that worked.
import { fail, withLock } from "./base.js";
import { readMeta, writeMeta, appendUsage, standardValue } from "./store.js";
import { resolveEntry, isExpired, entryKey, hostMatches } from "../vaultfacts.js";

// Each name's entry (the workspace's first, then the global one); not found and expired
// throw (an expired Standard one gets an ok: false usage line when `use` says how it was
// to be used: { via, target }). Returns [{ name, entry }].
export function lookup(names, who, use) {
  const entries = readMeta();
  const now = Date.now();
  return names.map((name) => {
    const entry = resolveEntry(entries, who.ws, name);
    if (!entry) throw fail("not_found", `no secret named ${name}${who.ws ? ` in ${who.ws} or every workspace` : " in every workspace"} (herdr-ws-secret list shows them)`);
    if (isExpired(entry, now)) {
      if (use) noteAttempt([{ name, entry }], { ...use, who, why: "expired" });
      throw fail("expired", `${name} has expired; ask the person to replace it or extend it in Secrets`);
    }
    return { name, entry };
  });
}

// A Standard secret's rules for a URL: its hosts, when it has any.
export function checkStandardHost(entry, url) {
  const hosts = entry.hosts || [];
  if (!hosts.length) return;
  const u = new URL(url);
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!hostMatches(hosts, u.hostname, port)) throw fail("refused", `${entry.name} may only be sent to ${hosts.join(", ")}, not ${u.host}`);
}

// Standard values by name ({ name: value }).
export function standardValues(found) {
  const out = {};
  for (const { name, entry } of found) if (entry.tier === "standard") out[name] = standardValue(entry);
  return out;
}

// After a use that worked: lastUsed* on each entry, and a usage line for each Standard one
// (the broker writes Protected's). Never fails the command that used them.
export async function noteUse(found, { via, target, who }) {
  if (!found.length) return;
  const at = Date.now();
  try {
    await withLock(() => {
      const entries = readMeta();
      for (const { entry } of found) {
        const e = entries.find((x) => x.scope === entry.scope && x.name === entry.name);
        if (!e) continue;
        e.lastUsedAt = at;
        e.lastUsedBy = who.agent || who.terminal || null;
        e.lastUsedFor = target || null;
      }
      writeMeta(entries);
      for (const { entry } of found) {
        if (entry.tier !== "standard") continue;
        appendUsage({ at, name: entry.name, scope: entry.scope, tier: "standard", via, target, ws: who.ws, agent: who.agent, terminal: who.terminal, ok: true });
      }
    });
  } catch { /* the use itself worked */ }
}

// A use of Standard secrets that didn't go through: an ok: false usage line each, with why
// (refused, expired, failed). Protected ones are the broker's to note.
export function noteAttempt(found, { via, target, who, why }) {
  const at = Date.now();
  for (const { entry } of found) {
    if (entry.tier !== "standard") continue;
    try {
      appendUsage({ at, name: entry.name, scope: entry.scope, tier: "standard", via, target, ws: who.ws, agent: who.agent, terminal: who.terminal, ok: false, why });
    } catch { /* the refusal stands either way */ }
  }
}

export function keyOf(entry) {
  return entryKey(entry.scope, entry.name);
}
