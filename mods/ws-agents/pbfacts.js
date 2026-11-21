// The edits the Agents list's Antigravity wipe makes to Antigravity's own lists, as rules
// with no imports so node can test them (agywipe.js does the reading and writing):
// the protobuf wire format of jetbox_summaries_proto.pb, the conversation id rule, a
// lossless edit of the cache JSON files and of history.jsonl, a conversation's tree
// (root and sub-agents), and what the pending list does with an entry.
//
// Every edit changes only what it removes: the rest of the file stays byte for byte.
// Anything it can't read whole throws, so nothing is written.

// A conversation id, as Antigravity names them (UUIDs) and as it may go into a path.
export const ID = /^[0-9A-Za-z-]{8,64}$/;

// --- protobuf, wire format only ---

// A varint at i: [value, next index]. Throws when the bytes end first or it runs past
// 10 bytes (no valid varint does).
export function varint(b, i) {
  let n = 0, s = 0;
  for (let k = 0; ; k++) {
    if (i >= b.length) throw new Error("truncated varint");
    if (k >= 10) throw new Error("varint too long");
    const c = b[i++];
    n += (c & 0x7f) * 2 ** s;
    s += 7;
    if (c < 0x80) return [n, i];
  }
}

// A message's top-level fields: [{ num, wt, start, end, body }] covering [0, length)
// without gaps (body: a length-delimited field's bytes, else null). Throws on anything it
// can't read: groups (wire types 3, 4), unknown wire types, field 0, truncation.
export function fields(b) {
  const list = [];
  let i = 0;
  while (i < b.length) {
    const start = i;
    let key;
    [key, i] = varint(b, i);
    const num = Math.floor(key / 8), wt = key % 8;
    if (num === 0) throw new Error("field number 0");
    let body = null;
    if (wt === 0) [, i] = varint(b, i);
    else if (wt === 1) i += 8;
    else if (wt === 5) i += 4;
    else if (wt === 2) {
      let n;
      [n, i] = varint(b, i);
      if (i + n > b.length) throw new Error("truncated field");
      body = b.subarray(i, i + n);
      i += n;
    } else throw new Error(`wire type ${wt}`);
    if (i > b.length) throw new Error("truncated field");
    list.push({ num, wt, start, end: i, body });
  }
  return list;
}

const text = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (s) => new TextEncoder().encode(s);

// A summary-file entry's key (top-level field 1 = { 1: id, 2: summary }): its first
// field 1 as text, else null. Throws when the entry isn't itself a message.
export function keyOf(body) {
  const k = fields(body).find((f) => f.num === 1 && f.wt === 2);
  return k ? text(k.body) : null;
}

// The keys the summary file lists, in order (a key twice is listed twice).
export const pbKeys = (data) => fields(data).filter((f) => f.num === 1 && f.wt === 2).map((f) => keyOf(f.body));

// Joined bytes.
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The summary file without the entries keyed by one of `ids` (a Set): { out, removed },
// removed being [{ id, bytes }] (each entry's own bytes, tag included, so putting one
// back is appending it: a message's fields concatenate). out is the kept fields' bytes
// as they were.
export function pbDrop(data, ids) {
  const all = fields(data);
  const keep = [];
  const removed = [];
  for (const f of all) {
    const id = f.num === 1 && f.wt === 2 ? keyOf(f.body) : null;
    if (id != null && ids.has(id)) removed.push({ id, bytes: data.subarray(f.start, f.end) });
    else keep.push(data.subarray(f.start, f.end));
  }
  return { out: removed.length ? concat(keep) : data, removed };
}

// The summary file with entries put back, those whose key it doesn't list yet.
export function pbAppend(data, entries) {
  const have = new Set(pbKeys(data));
  const add = [];
  for (const e of entries) {
    const f = fields(e.bytes);
    if (f.length !== 1 || f[0].num !== 1 || f[0].wt !== 2) throw new Error("not a summary entry");
    const id = keyOf(f[0].body);
    if (id == null || have.has(id)) continue;
    have.add(id);
    add.push(e.bytes);
  }
  return { out: add.length ? concat([data, ...add]) : data, added: add.length };
}

// Whether the bytes hold the id as text anywhere (in an entry not keyed by it, say:
// Antigravity changed how it keys them).
export function mentions(data, id) {
  const want = bytesOf(id);
  outer: for (let i = 0; i + want.length <= data.length; i++) {
    for (let j = 0; j < want.length; j++) if (data[i + j] !== want[j]) continue outer;
    return true;
  }
  return false;
}

// --- JSON, edited as text ---

// The value at i, with where each part is: { type, start, end, members? } where an
// object's members are [{ key, keyStart, vStart, vEnd, value, pre, post }] (pre: the text
// between the `{` or `,` before it and its key; post: between its value and the `,` or
// `}` after it). Throws on anything that isn't JSON.
function spanAt(s, i) {
  const ws = () => { while (i < s.length && /[ \t\r\n]/.test(s[i])) i++; };
  const str = () => {
    if (s[i] !== '"') throw new Error(`expected a string at ${i}`);
    const start = i++;
    while (i < s.length && s[i] !== '"') i += s[i] === "\\" ? 2 : 1;
    if (i >= s.length) throw new Error("unterminated string");
    i++;
    return { start, end: i, key: JSON.parse(s.slice(start, i)) };
  };
  const value = () => {
    ws();
    const start = i;
    const c = s[i];
    if (c === "{") {
      i++;
      const members = [];
      let mark = i;
      ws();
      if (s[i] === "}") { i++; return { type: "object", start, end: i, open: start, close: i - 1, members }; }
      for (;;) {
        ws();
        const k = str();
        ws();
        if (s[i] !== ":") throw new Error(`expected : at ${i}`);
        i++;
        const v = value();
        const vEnd = i;
        ws();
        const m = { key: k.key, keyStart: k.start, vStart: v.start, vEnd, value: v, pre: s.slice(mark, k.start), post: s.slice(vEnd, i) };
        members.push(m);
        if (s[i] === ",") { i++; mark = i; continue; }
        if (s[i] === "}") { i++; return { type: "object", start, end: i, open: start, close: i - 1, members }; }
        throw new Error(`expected , or } at ${i}`);
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (s[i] === "]") { i++; return { type: "array", start, end: i }; }
      for (;;) {
        value();
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return { type: "array", start, end: i }; }
        throw new Error(`expected , or ] at ${i}`);
      }
    }
    if (c === '"') { str(); return { type: "string", start, end: i }; }
    const m = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
    m.lastIndex = i;
    const hit = m.exec(s);
    if (!hit) throw new Error(`unexpected ${JSON.stringify(s[i] ?? "end")} at ${i}`);
    i += hit[0].length;
    return { type: "literal", start, end: i };
  };
  const v = value();
  ws();
  return [v, i];
}

export function jsonSpans(s) {
  const [v, end] = spanAt(String(s), 0);
  if (end !== s.length) throw new Error(`text after the JSON at ${end}`);
  return v;
}

// The object at `keys` from the top (the last member of a key, as JSON.parse reads it), or null.
function objectAt(root, keys) {
  let node = root;
  for (const k of keys) {
    if (node?.type !== "object") return null;
    node = [...node.members].reverse().find((m) => m.key === k)?.value;
  }
  return node?.type === "object" ? node : null;
}

// The text without the members of the object at `keys` for which match(key, value) is
// true (value: the member's parsed value): { text, removed: [{ key, value }] } (value:
// its text as it was). Everything else stays as written. When the object isn't there,
// nothing changes. Throws when the text isn't JSON, or when the result doesn't read as
// the same JSON minus exactly those members (a key twice, one kept: refused).
export function jsonDrop(s, keys, match) {
  const root = jsonSpans(s);
  const obj = objectAt(root, keys);
  if (!obj) return { text: s, removed: [] };
  const ms = obj.members;
  const drop = ms.filter((m) => match(m.key, JSON.parse(s.slice(m.vStart, m.vEnd))));
  if (!drop.length) return { text: s, removed: [] };
  const kept = ms.filter((m) => !drop.includes(m));
  const tail = ms[ms.length - 1].post;
  const inner = kept.map((m, i) => m.pre + s.slice(m.keyStart, m.vEnd) + (i === kept.length - 1 ? tail : m.post)).join(",");
  const out = s.slice(0, obj.open + 1) + inner + s.slice(obj.close);
  // The same JSON minus those keys, read back.
  const want = JSON.parse(s);
  let at = want;
  for (const k of keys) at = at[k];
  for (const m of drop) delete at[m.key];
  if (JSON.stringify(JSON.parse(out)) !== JSON.stringify(want)) throw new Error("the edit would change more than the conversation's entries");
  return { text: out, removed: drop.map((m) => ({ key: m.key, value: s.slice(m.vStart, m.vEnd) })) };
}

// The text with members put back into the object at `keys`, after its last member (with
// that member's indentation), those whose key it doesn't have. { text, added }.
export function jsonInsert(s, keys, members) {
  const obj = objectAt(jsonSpans(s), keys);
  if (!obj) throw new Error(`no ${keys.length ? keys.join(".") : "top-level"} object to put them back in`);
  const have = new Set(obj.members.map((m) => m.key));
  const add = members.filter((m) => !have.has(m.key) && (have.add(m.key), true));
  if (!add.length) return { text: s, added: 0 };
  const body = (m) => `${JSON.stringify(m.key)}: ${m.value}`;
  let out;
  if (obj.members.length) {
    const last = obj.members[obj.members.length - 1];
    const lead = last.pre.includes("\n") ? last.pre : " ";
    out = s.slice(0, last.vEnd) + add.map((m) => `,${lead}${body(m)}`).join("") + s.slice(last.vEnd);
  } else {
    const line = s.slice(s.lastIndexOf("\n", obj.open) + 1, obj.open);
    const ind = /^[ \t]*/.exec(line)[0];
    out = s.slice(0, obj.open + 1) + add.map((m) => `\n${ind}  ${body(m)}`).join(",") + `\n${ind}` + s.slice(obj.close);
  }
  JSON.parse(out);
  return { text: out, added: add.length };
}

// history.jsonl (the prompts typed, a JSON object a line) without the lines whose
// conversationId is one of `ids`: { text, removed: [{ at, line }] } (at: its line number).
// Lines it can't read stay.
export function jsonlDrop(s, ids) {
  const lines = String(s).split("\n");
  const kept = [];
  const removed = [];
  lines.forEach((line, at) => {
    let id = null;
    try { id = JSON.parse(line)?.conversationId ?? null; } catch { id = null; }
    if (typeof id === "string" && ids.has(id)) removed.push({ at, line });
    else kept.push(line);
  });
  return { text: removed.length ? kept.join("\n") : s, removed };
}

// The lines put back where they were (or at the end, before a final newline, when the
// file got shorter), those not there already.
export function jsonlInsert(s, removed) {
  const lines = String(s).split("\n");
  const have = new Set(lines);
  let added = 0;
  for (const r of [...removed].sort((a, b) => a.at - b.at)) {
    if (have.has(r.line)) continue;
    const end = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    lines.splice(Math.min(r.at, end), 0, r.line);
    added++;
  }
  return { text: added ? lines.join("\n") : s, added };
}

// --- a conversation's tree ---

// The root a conversation belongs to and every conversation under that root, from the
// parent links Antigravity keeps ([{ id, parent }]). A loop stops where it closes.
export function treeOf(links, id) {
  const up = new Map();
  const down = new Map();
  for (const l of links) {
    if (!l?.id || !l?.parent || l.id === l.parent) continue;
    up.set(l.id, l.parent);
    if (!down.has(l.parent)) down.set(l.parent, new Set());
    down.get(l.parent).add(l.id);
  }
  let root = id;
  const seen = new Set([root]);
  while (up.has(root) && !seen.has(up.get(root))) { root = up.get(root); seen.add(root); }
  const tree = [root];
  const inTree = new Set(tree);
  for (let i = 0; i < tree.length; i++) {
    for (const c of down.get(tree[i]) ?? []) if (!inTree.has(c)) { inTree.add(c); tree.push(c); }
  }
  return { root, tree };
}

// What a conversation keeps of its own on disk, under Antigravity's folder.
export const filesOf = (dir, id) => [`${dir}/brain/${id}`, `${dir}/conversations/${id}.db`, `${dir}/conversations/${id}.db-wal`,
  `${dir}/conversations/${id}.db-shm`, `${dir}/presence/${id}.lock`, `${dir}/annotations/${id}.pbtxt`];

// --- processes ---

// The process table from two ps listings (`-axo pid=,ppid=,pgid=,comm=` and `-axww -o
// pid=,args=`: a program's name and its arguments can both hold spaces, so they come
// apart): [{ pid, ppid, pgid, comm, args }] (pids as strings).
export function psRows(commOut, argsOut) {
  const args = new Map();
  for (const l of String(argsOut).split("\n")) {
    const m = /^\s*(\d+)\s(.*)$/.exec(l);
    if (m) args.set(m[1], m[2].trim());
  }
  const rows = [];
  for (const l of String(commOut).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) rows.push({ pid: m[1], ppid: m[2], pgid: m[3], comm: m[4].trim(), args: args.get(m[1]) ?? "" });
  }
  return rows;
}

const base = (p) => String(p ?? "").split("/").pop();
// What an Antigravity process is: "agent" (an interactive agy, which keeps the lists in
// memory and writes them back), "probe" (agy -p / --print: a one-off answer, like the
// status bar's usage check), "helper" (agy agentapi, the editor bridge), or null when it
// isn't Antigravity's program (by its name or its first word).
export function agyKind(comm, args) {
  const words = String(args ?? "").trim().split(/\s+/);
  if (base(comm) !== "agy" && base(words[0]) !== "agy") return null;
  if (words[1] === "agentapi") return "helper";
  if (words.slice(1).some((w) => w === "-p" || w === "--print" || w.startsWith("--print="))) return "probe";
  return "agent";
}

// An agent's own processes: everything in its process group and below it (its
// language server and tools), from one table. Empty without a pid it lists.
export function familyOf(rows, pid) {
  const me = rows.find((r) => r.pid === String(pid));
  if (!me) return [];
  const out = new Set([me.pid]);
  for (const r of rows) if (r.pgid === me.pgid) out.add(r.pid);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (out.has(r.ppid) && !out.has(r.pid)) { out.add(r.pid); grew = true; }
  }
  return [...out];
}

// The Antigravity agents that count as "another Antigravity runs": interactive ones,
// outside the given family (the agent being wiped).
export const otherAgents = (rows, family = []) => rows.filter((r) => agyKind(r.comm, r.args) === "agent" && !family.includes(r.pid));

// --- the backup folder ---

// Where a pass saves its copies and what it removed: the backup folder itself for the
// first (none started there yet), else pass-<n> after the highest there. A pass that
// stopped part way keeps its folder, so nothing it saved is written over.
export function passFolder(names) {
  const ns = names.filter((d) => /^pass-\d+$/.test(d)).map((d) => Number(d.slice(5)));
  if (!names.includes("removed.json") && !ns.length) return { n: 1, dir: null };
  const n = Math.max(1, ...ns) + 1;
  return { n, dir: `pass-${n}` };
}

// --- the pending list ---

export const TRIES = 5; // failed passes before it gives up and says so
export const QUIET = 60000; // a done wipe is checked once more this long after
export const EXPIRES = 7 * 86400000; // an entry no pass could finish in a week is given up

// What `pending` does with an entry ({ at, tries, done }) now: "wait" (an Antigravity
// runs), "finish" (edit, check, move the files), "recheck" (done: look once more that
// nothing put it back, then forget it), "give-up".
export function pendingNext(e, now, running) {
  if (!e || typeof e !== "object") return "give-up";
  if ((e.tries ?? 0) >= TRIES) return "give-up";
  if (!e.done && now - (e.at ?? 0) > EXPIRES) return "give-up";
  if (running > 0) return "wait";
  if (!e.done) return "finish";
  return now - e.done >= QUIET ? "recheck" : "wait";
}
