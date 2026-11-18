// @ts-nocheck
// "fs/promises" as the app gives it to mods: Node's, plus exists().
import * as nfs from "node:fs/promises";

export * from "node:fs/promises";
export async function exists(path) {
  try { await nfs.access(path); return true; } catch { return false; }
}
