// What a note is, with no imports, so `node` can test it (main.js draws it).
//
// A note is a markdown file in ~/.herdr/workspaces/<id>/notes/, named
// <YYYY-MM-DD-HHMM>-<slug>.md (the slug is the first line's, only for people
// browsing the folder). Its first line is its title, as in Apple Notes: no title
// field, and no front matter of its own. Front matter someone else put there (an
// agent, an editor, an older version) is kept as written and left out of the editor.

const pad = (n) => String(n).padStart(2, "0");

// "2026-11-21-1405" for a time where you are.
export function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// The title: the body's first line with words in it, without a heading's #s.
export function titleOf(body) {
  for (const raw of String(body ?? "").split("\n")) {
    const line = raw.replace(/^\s*#+\s*/, "").trim();
    if (line) return line;
  }
  return "";
}

// One line of what follows the title, for the list (markdown marks left out).
export function snippetOf(body, max = 120) {
  const lines = String(body ?? "").split("\n");
  const first = lines.findIndex((l) => l.replace(/^\s*#+\s*/, "").trim());
  if (first < 0) return "";
  const rest = lines.slice(first + 1).map((l) => l.replace(/^\s*(?:#+|[-*+](?:\s+\[[ xX]\])?|\d+[.)]|>)\s*/, "").trim()).filter(Boolean).join(" ");
  return rest.length > max ? rest.slice(0, max - 1).trimEnd() + "…" : rest;
}

// The first line as a file name's slug: lowercase words joined by -, at most 40 letters.
export function slugOf(title) {
  const s = String(title ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s.slice(0, 40).replace(/-+$/, "") || "note");
}

// A note's file name: the stamp, the slug, and -2, -3 … when that's taken.
export function fileName(ms, title, taken = []) {
  const stem = `${stamp(ms)}-${slugOf(title)}`;
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}.md` : `${stem}-${n}.md`;
    if (!used.has(name)) return name;
  }
}

// The stamp a file name starts with, kept when the slug changes.
export const stampOf = (name) => /^(\d{4}-\d\d-\d\d-\d{4})-/.exec(String(name ?? ""))?.[1] ?? null;

// A name with the same stamp and a new slug, or null when it already fits.
export function renamed(name, title, taken = []) {
  const s = stampOf(name);
  if (!s) return null;
  const slug = slugOf(title);
  if (new RegExp(`^${s}-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-\\d+)?\\.md$`).test(name)) return null;
  const used = new Set(taken.filter((n) => n !== name));
  for (let n = 1; ; n++) {
    const next = n === 1 ? `${s}-${slug}.md` : `${s}-${slug}-${n}.md`;
    if (!used.has(next)) return next;
  }
}

// --- front matter ---

// { head: [lines], body } from a file's text; no front matter: an empty head.
// Only lines that look like front matter make it front matter (`key: …`, indented or
// list lines under one), so a note that starts with a --- rule stays all text.
export function split(text) {
  const t = String(text ?? "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n?---[ \t]*(?:\n|$)/.exec(t);
  if (!m) return { head: [], body: t };
  const head = m[1] ? m[1].split("\n") : [];
  const looks = head.length > 0 && /^[A-Za-z_][A-Za-z0-9_-]*:/.test(head[0])
    && head.every((l) => !l.trim() || /^[A-Za-z_][A-Za-z0-9_-]*:/.test(l) || /^\s+\S|^-\s/.test(l));
  if (!looks) return { head: [], body: t };
  return { head, body: t.slice(m[0].length) };
}

// The head as keys and their lines: a key's block is its line and the indented
// (or "- ") lines under it.
function blocks(head) {
  const out = [];
  for (const line of head) {
    const key = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line)?.[1];
    if (key || !out.length) out.push({ key: key ?? null, lines: [line] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

// Plain where YAML reads it back as the same text, else a double-quoted string (as ws-board writes).
function quote(v) {
  const s = String(v);
  return /^[A-Za-z0-9_./~@(][^:#"'{}\[\]\n]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|null|yes|no|on|off|-?[0-9.]+)$/i.test(s)
    ? s : JSON.stringify(s);
}

// The file's text with its body replaced and these plain `key: value` fields set
// (null or "" removes one). The rest of the front matter is kept as written; with
// nothing in it, no --- at all.
export function compose(text, fields = {}, body) {
  const parts = split(text);
  const bs = blocks(parts.head);
  for (const [k, v] of Object.entries(fields)) {
    const i = bs.findIndex((b) => b.key === k);
    const gone = v === null || v === undefined || v === "";
    if (gone) { if (i >= 0) bs.splice(i, 1); continue; }
    const lines = [`${k}: ${quote(v)}`];
    if (i >= 0) bs[i] = { key: k, lines };
    else bs.push({ key: k, lines });
  }
  const head = bs.flatMap((b) => b.lines).filter((l, i, all) => l.trim() || i < all.length - 1);
  const rest = body === undefined ? parts.body : String(body);
  const out = head.some((l) => l.trim()) ? `---\n${head.join("\n")}\n---\n${rest}` : rest;
  // A file written with CRLF line ends keeps them.
  return /\r\n/.test(String(text ?? "")) ? out.replace(/\r?\n/g, "\r\n") : out;
}

// The body, as the editor shows it.
export const bodyOf = (text) => split(text).body;

// --- the list ---

// What the list shows of a note: title and snippet.
export function noteOf(name, text, mtime) {
  const body = bodyOf(text);
  return { name, mtime, title: titleOf(body) || "New note", snippet: snippetOf(body), empty: !body.trim() };
}

// Newest edited first; ties by name, newest stamp first.
export const sortNotes = (notes) => [...notes].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || String(b.name).localeCompare(String(a.name)));

// A search: every word somewhere in the title, the text or the name.
export function matches(note, text, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${note.title}\n${text ?? ""}\n${note.name}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// "now", "5m", "3h", "2d", "4w", then the date.
export function ago(ms, now) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 7 * 8) return `${Math.floor(s / 86400 / 7)}w`;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Whether a folder watch's paths touch this workspace's notes (a root path, or none
// given, means anything may have changed).
export function touchesNotes(paths, root, ws) {
  if (!Array.isArray(paths) || !paths.length) return true;
  const dir = `${root}/${ws}/notes`;
  return paths.some((p) => p === root || p === `${root}/${ws}` || p === dir || String(p).startsWith(dir + "/"));
}

// --- the card made from a note ---

// The card's title and notes: the first line, then the rest of the note.
export function cardOf(body) {
  const title = titleOf(body) || "Note";
  const lines = String(body ?? "").split("\n");
  const first = lines.findIndex((l) => l.replace(/^\s*#+\s*/, "").trim());
  const rest = first < 0 ? "" : lines.slice(first + 1).join("\n").trim();
  return { title: title.length > 120 ? title.slice(0, 119).trimEnd() + "…" : title, notes: rest };
}
