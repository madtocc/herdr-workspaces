// The switcher menu's groups and order. A workspace's group is the "group" line in
// its workspace.jsonc ("group": "Work"); workspaces with the same one sit together
// under a header that folds. The order, and which groups are folded, is
// ~/.herdr/workspaces/.order.json, written when you drag a row or fold a group:
//
//   { "order": ["blog", { "group": "Work" }, "acme", "globex"], "folded": ["Work"] }
//
// "order" is the menu from top to bottom with every group open. A workspace or group
// it doesn't name goes after the ones it does (a new group: where its first workspace
// was). The Scratch workspace has no group and is always last.
// No imports, so node can test it.

// The note written above a "group" line.
export const GROUP_NOTE = "// Its group in the switcher menu: workspaces with the same group sit together.";

export const groupOf = (d) => (d && !d.scratch && !d.error && typeof d.group === "string" && d.group.trim()) ? d.group.trim() : null;

// What .order.json holds, whatever the file says.
export function readOrder(text) {
  let o = {};
  try { o = text ? JSON.parse(text) : {}; } catch {}
  const order = Array.isArray(o?.order) ? o.order.filter((e) => typeof e === "string" || typeof e?.group === "string") : [];
  const folded = Array.isArray(o?.folded) ? o.folded.filter((s) => typeof s === "string") : [];
  return { order, folded };
}
export const orderText = (saved) => JSON.stringify({ order: saved.order ?? [], folded: saved.folded ?? [] }, null, 2) + "\n";

// A group's key in the order can't be a workspace's id: no folder name holds a NUL.
const key = (e) => (typeof e === "string" ? e : typeof e?.group === "string" ? `\0${e.group}` : null);

// The menu's tree: [{ ws: def } | { group, members: [def…] }], then { ws: Scratch, pinned: true }.
// defs: as loaded (by id, Scratch last), which breaks ties among the ones the order doesn't name.
export function arrange(defs, saved) {
  const pos = new Map();
  (saved?.order ?? []).forEach((e, i) => { const k = key(e); if (k !== null && !pos.has(k)) pos.set(k, i); });
  const rank = (k) => (pos.has(k) ? pos.get(k) : Infinity);
  const first = (a, b) => (a.rank - b.rank) || (a.tie - b.tie);
  const top = [], groups = new Map(), pinned = [];
  defs.forEach((d, i) => {
    if (d.scratch) { pinned.push({ ws: d, pinned: true }); return; }
    const item = { ws: d, rank: rank(d.id), tie: i };
    const g = groupOf(d);
    if (!g) { top.push(item); return; }
    if (!groups.has(g)) {
      const group = { group: g, members: [], rank: rank(`\0${g}`), tie: i };
      groups.set(g, group);
      top.push(group);
    }
    groups.get(g).members.push(item);
  });
  for (const g of groups.values()) {
    g.members.sort(first);
    if (g.rank === Infinity) g.rank = g.members[0].rank;
  }
  top.sort(first);
  return [
    ...top.map((it) => (it.group ? { group: it.group, members: it.members.map((m) => m.ws) } : { ws: it.ws })),
    ...pinned,
  ];
}

// The order a tree stands for (Scratch left out: it's always last).
export function flatten(tree) {
  const out = [];
  for (const it of tree) {
    if (it.pinned) continue;
    if (it.group) out.push({ group: it.group }, ...it.members.map((d) => d.id));
    else out.push(it.ws.id);
  }
  return out;
}

// Workspaces in the menu's order, every group open.
export function sortDefs(defs, saved) {
  return arrange(defs, saved).flatMap((it) => (it.group ? it.members : [it.ws]));
}

// A drag in the menu: `from` dropped on `to`. Rows are { kind: "ws", id } or
// { kind: "group", name }; `to` can also be { kind: "end" } (the Scratch row: after
// everything) or, for a workspace, { kind: "before", name } (just above that group,
// in none). `after`: below the row, else above it. A workspace dropped on a
// workspace takes that one's place and group; on a group's header it goes in, first.
// A group dropped on a group or workspace goes before or after that whole item.
// Returns { order, group } (group: the workspace's new group, null for none, when it
// changes), or null when nothing moves.
export function move(tree, from, to, after) {
  const list = tree.filter((it) => !it.pinned)
    .map((it) => (it.group ? { group: it.group, members: it.members.map((d) => d.id) } : { ws: it.ws.id }));
  const holder = (id) => list.find((it) => it.members?.includes(id)) ?? null;
  const topAt = (id) => list.findIndex((it) => it.ws === id || it.members?.includes(id));
  const flat = () => list.filter((it) => !it.members || it.members.length)
    .flatMap((it) => (it.group ? [{ group: it.group }, ...it.members] : [it.ws]));

  if (from.kind === "ws") {
    if (to.kind === "ws" && to.id === from.id) return null;
    const was = holder(from.id);
    const old = was?.group ?? null;
    if (was) was.members.splice(was.members.indexOf(from.id), 1);
    else {
      const i = list.findIndex((it) => it.ws === from.id);
      if (i < 0) return null;
      list.splice(i, 1);
    }
    let now = null;
    if (to.kind === "end") list.push({ ws: from.id });
    else if (to.kind === "before") {
      const i = list.findIndex((it) => it.group === to.name);
      if (i < 0) return null;
      list.splice(i, 0, { ws: from.id });
    } else if (to.kind === "group") {
      const g = list.find((it) => it.group === to.name);
      if (!g) return null;
      g.members.unshift(from.id);
      now = g.group;
    } else {
      const g = holder(to.id);
      if (g) {
        g.members.splice(g.members.indexOf(to.id) + (after ? 1 : 0), 0, from.id);
        now = g.group;
      } else {
        const i = list.findIndex((it) => it.ws === to.id);
        if (i < 0) return null;
        list.splice(i + (after ? 1 : 0), 0, { ws: from.id });
      }
    }
    return { order: flat(), ...(now !== old ? { group: now } : {}) };
  }

  if (from.kind === "group") {
    const i = list.findIndex((it) => it.group === from.name);
    if (i < 0) return null;
    if ((to.kind === "group" && to.name === from.name) || (to.kind === "ws" && list[i].members.includes(to.id))) return null;
    const [g] = list.splice(i, 1);
    let at;
    if (to.kind === "end") at = list.length;
    else {
      at = to.kind === "group" ? list.findIndex((it) => it.group === to.name) : topAt(to.id);
      if (at < 0) return null;
      if (after) at++;
    }
    list.splice(at, 0, g);
    return { order: flat() };
  }
  return null;
}

// A group's new name in the order and the folded list (its workspaces' lines are
// rewritten apart). Merges into a group of that name, if there is one.
export function renamed(saved, from, to) {
  return {
    order: (saved.order ?? []).map((e) => (typeof e !== "string" && e.group === from ? { group: to } : e)),
    folded: [...new Set((saved.folded ?? []).map((n) => (n === from ? to : n)))],
  };
}

// The name to use for a group typed by hand: an existing one that matches it but
// for case, else as typed (trimmed).
export function groupName(typed, names) {
  const t = String(typed ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return names.find((n) => n.toLowerCase() === t.toLowerCase()) ?? t;
}

// --- workspace.jsonc: its "group" line, comments and the rest kept as they are ---

// The object's top-level keys: where each key starts, and its value's span (to: -1
// for an object or array).
function topKeys(text) {
  const keys = [];
  let depth = 0, open = -1, k = null, start = -1, colon = false;
  for (let i = 0; i < text.length;) {
    if (text.startsWith("//", i)) { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e; continue; }
    if (text.startsWith("/*", i)) { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 2; continue; }
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (depth === 1 && !colon) { k = JSON.parse(text.slice(i, j + 1)); start = i; }
      else if (depth === 1 && k !== null) { keys.push({ key: k, start, from: i, to: j + 1 }); k = null; }
      i = j + 1;
      continue;
    }
    if (depth === 1 && colon && k !== null && !/\s/.test(c)) {
      if (c === "{" || c === "[") { keys.push({ key: k, start, from: i, to: -1 }); k = null; }
      else {
        const word = /^[^\s,}\]/]+/.exec(text.slice(i))?.[0] ?? c;
        keys.push({ key: k, start, from: i, to: i + word.length });
        k = null;
        i += word.length;
        continue;
      }
    }
    if (c === "{" || c === "[") { if (depth === 0 && open < 0) open = i; depth++; }
    else if (c === "}" || c === "]") depth--;
    else if (c === ":" && depth === 1) colon = true;
    else if (c === "," && depth === 1) { colon = false; k = null; }
    i++;
  }
  return { open, keys };
}

// workspace.jsonc with its group set (a name) or taken out (null).
export function withGroup(text, group) {
  const { open, keys } = topKeys(text);
  const g = keys.find((x) => x.key === "group");
  if (g && g.to > 0 && group) return text.slice(0, g.from) + JSON.stringify(group) + text.slice(g.to);
  if (g && g.to > 0) {
    const from = text.lastIndexOf("\n", g.start - 1) + 1;
    let end = text.indexOf("\n", g.to);
    if (end < 0) end = text.length;
    // Alone on its line: the line goes, and the note above it if it's ours.
    if (!text.slice(from, g.start).trim() && /^\s*,?\s*(\/\/.*)?$/.test(text.slice(g.to, end))) {
      const above = from > 0 ? text.lastIndexOf("\n", from - 2) + 1 : from;
      const cut = from > 0 && text.slice(above, from - 1).trim() === GROUP_NOTE ? above : from;
      return text.slice(0, cut) + text.slice(Math.min(end + 1, text.length));
    }
    const comma = /^\s*,/.exec(text.slice(g.to))?.[0].length ?? 0;
    return text.slice(0, g.start) + text.slice(g.to + comma).replace(/^[ \t]+/, "");
  }
  if (!group) return text;
  const lines = `  ${GROUP_NOTE}\n  "group": ${JSON.stringify(group)},\n`;
  const name = keys.find((x) => x.key === "name" && x.to > 0);
  if (name) {
    // After the name's line, or before it when it's the last key with no comma.
    const rest = /^[ \t]*,[^\n]*\n/.exec(text.slice(name.to));
    const line = text.lastIndexOf("\n", name.start - 1) + 1;
    const at = rest ? name.to + rest[0].length : line > open ? line : -1;
    if (at >= 0) return text.slice(0, at) + lines + text.slice(at);
  }
  if (open < 0) throw new Error("workspace.jsonc has no { }");
  return `${text.slice(0, open + 1)}\n${lines.replace(/\n$/, "")}${text.slice(open + 1)}`;
}
