// GitHub project boards, for the board's GitHub view (ws-board) and the watcher
// that keeps taken cards current (ws-switcher/ghboard.js). Only the rules: no
// imports, so `node` can test them. The same file is in both mods (a mod can't
// import from another's folder); scripts/sync-from-home.sh checks they match.
//
// A workspace names its board in workspace.jsonc:
//   "board": { "github": "https://github.com/orgs/acme/projects/1" }
// A card taken from it carries `github:` (the issue's or pull request's link; a
// draft has none) and `github_item:` (the board item's id) in its front matter.
// Everything here reads GitHub; nothing writes to it.

const CONTENT = (body) => `
  __typename
  ... on Issue { number title url state createdAt${body ? " body" : ""} repository { nameWithOwner } assignees(first: 5) { nodes { login } }
    closedByPullRequestsReferences(first: 3, includeClosedPrs: true) { nodes { number url state author { login } } } }
  ... on PullRequest { number title url state createdAt${body ? " body" : ""} repository { nameWithOwner } assignees(first: 5) { nodes { login } } author { login } }
  ... on DraftIssue { title createdAt${body ? " body" : ""} assignees(first: 5) { nodes { login } } }`;

const FIELDS = `
  status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
  priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
  severity: fieldValueByName(name: "Severity") { ... on ProjectV2ItemFieldSingleSelectValue { name } }`;

// One page (100 items) of a board. Variables: owner, number, after.
export const BOARD_QUERY = `query($owner: String!, $number: Int!, $after: String) {
  viewer { login }
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) {
    title url
    field(name: "Status") { ... on ProjectV2SingleSelectField { options { name } } }
    items(first: 100, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { id isArchived ${FIELDS}
        content { ${CONTENT(false)} } }
    }
  } } }
}`;

// Board items by id, with their text when `body`. Ids are checked, then written
// into the query (gh's -F has no lists everywhere). Null when none is usable.
export const ITEM_ID = /^[A-Za-z0-9_=-]{4,120}$/;
export function itemsQuery(ids, body = false) {
  const good = [...new Set(ids)].filter((id) => ITEM_ID.test(String(id)));
  if (!good.length) return null;
  return `query { viewer { login } nodes(ids: ${JSON.stringify(good)}) { ... on ProjectV2Item { id isArchived ${FIELDS}
    project { title url }
    content { ${CONTENT(body)} } } } }`;
}

// "https://github.com/orgs/acme/projects/1/views/2" -> { kind, owner, number, url }
export function parseBoard(link) {
  const m = /^(?:https?:\/\/)?github\.com\/(orgs|users)\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/projects\/(\d{1,9})(?:[/?#].*)?$/.exec(String(link ?? "").trim());
  if (!m) return null;
  return { kind: m[1], owner: m[2], number: Number(m[3]), url: `https://github.com/${m[1]}/${m[2]}/projects/${m[3]}` };
}

// "git@github.com:acme/api.git" or "https://github.com/acme/api" -> "acme/api"
export function repoOfRemote(text) {
  const m = /github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?\s*$/.exec(String(text ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// A board's Priority or Severity as the card's: P0 and P1 are high, P2 medium, P3 and on low.
export function priorityOf(name) {
  const s = String(name ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(p0|p1|urgent|critical|blocker|highest|high|sev ?[01])\b/.test(s)) return "high";
  if (/^(p2|medium|normal|moderate|sev ?2)\b/.test(s)) return "medium";
  if (/^(p[3-9]|low|lowest|minor|trivial|sev ?[3-9])\b/.test(s)) return "low";
  return null;
}

const logins = (c) => (c?.assignees?.nodes ?? []).map((a) => a?.login).filter(Boolean);

// One board item as the view and the watcher use it; null for what can't be shown
// (an archived item, one whose issue you can't see).
export function shape(node) {
  const c = node?.content;
  if (!node?.id || node.isArchived || !c?.__typename) return null;
  const type = c.__typename === "Issue" ? "issue" : c.__typename === "PullRequest" ? "pr" : c.__typename === "DraftIssue" ? "draft" : null;
  if (!type) return null;
  const raw = node.severity?.name ?? node.priority?.name ?? null;
  const state = type === "draft" ? null : String(c.state ?? "").toLowerCase() || null; // open, closed, merged
  return {
    item: node.id, type,
    number: c.number ?? null, title: String(c.title ?? "").trim() || "(no title)", url: c.url ?? null,
    repo: c.repository?.nameWithOwner ?? null, state,
    status: node.status?.name ?? null, rank: raw, priority: priorityOf(raw),
    created: c.createdAt ?? null, // when the issue (or draft) was opened
    assignees: logins(c),
    prs: type === "issue"
      ? (c.closedByPullRequestsReferences?.nodes ?? []).filter(Boolean).map((p) => ({ number: p.number, url: p.url, state: String(p.state ?? "").toLowerCase(), author: p.author?.login ?? null }))
      : [],
    ...(c.body !== undefined ? { body: String(c.body ?? "") } : {}),
    ...(node.project ? { board: node.project.title ?? null, boardUrl: node.project.url ?? null } : {}),
  };
}

// The pages of BOARD_QUERY (each gh's whole answer) as one board, or { error }.
export function boardFrom(pages) {
  const first = pages[0]?.data?.repositoryOwner?.projectV2;
  if (!first) return { error: pages[0]?.errors?.[0]?.message || "GitHub has no such board, or your login can't see it." };
  const items = [];
  for (const p of pages) for (const n of p?.data?.repositoryOwner?.projectV2?.items?.nodes ?? []) { const s = shape(n); if (s) items.push(s); }
  return {
    title: String(first.title ?? "Board"), url: first.url ?? null, me: pages[0]?.data?.viewer?.login ?? null,
    statuses: (first.field?.options ?? []).map((o) => o.name).filter(Boolean),
    total: first.items?.totalCount ?? items.length, items,
  };
}

export const NO_STATUS = "No status";
// A column that starts folded: where finished and dropped work sits.
export const doneLike = (name) => /^(done|closed|complete|completed|shipped|released|merged|cancel+ed|won'?t ?(do|fix)|deferred|archived?)$/i.test(String(name ?? "").trim());

// The board's columns in its own order, with a "No status" one first when items have none.
export function columnsOf(board, items = board.items) {
  const names = [...board.statuses];
  for (const i of items) if (i.status && !names.includes(i.status)) names.push(i.status);
  const cols = names.map((name) => ({ name, items: items.filter((i) => i.status === name) }));
  const none = items.filter((i) => !i.status);
  return none.length || board.items.some((i) => !i.status) ? [{ name: NO_STATUS, items: none }, ...cols] : cols;
}

// who: "all" | "mine" | "none" (unassigned); repo: "owner/name", "draft" or ""; text: words, all must be there.
export function filterItems(items, { who = "all", repo = "", text = "" } = {}, me = null) {
  const words = String(text).toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (who === "mine" && !(me && i.assignees.includes(me))) return false;
    if (who === "none" && i.assignees.length) return false;
    if (repo === "draft" ? i.type !== "draft" : repo && i.repo !== repo) return false;
    if (!words.length) return true;
    const hay = `${i.title} ${i.number ? `#${i.number}` : ""} ${i.repo ?? ""} ${i.assignees.join(" ")} ${i.rank ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// How the view orders items: the board's own order, or by when each was opened.
export const ORDERS = [["board", "Board order"], ["newest", "Newest"], ["oldest", "Oldest"]];
export function sortItems(items, order = "board") {
  if (order !== "newest" && order !== "oldest") return items;
  const at = (i) => { const n = Date.parse(i.created ?? ""); return Number.isNaN(n) ? null : n; };
  const dir = order === "newest" ? -1 : 1;
  // Items with no date go last either way; equal dates keep the board's order.
  return items.map((i, n) => [i, at(i), n]).sort((a, b) => (a[1] === null) - (b[1] === null) || (a[1] === null ? 0 : dir * (a[1] - b[1])) || a[2] - b[2]).map((x) => x[0]);
}

// How long ago, short: "5 min", "3 h", "12 d", "4 mo", "2 y". "" with no date.
export function age(when, now) {
  const at = Date.parse(when ?? "");
  if (Number.isNaN(at)) return "";
  const m = Math.max(0, Math.floor((now - at) / 60000));
  if (m < 60) return `${Math.max(1, m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  const d = Math.floor(m / 1440);
  if (d < 60) return `${d} d`;
  return d < 730 ? `${Math.floor(d / 30)} mo` : `${Math.floor(d / 365)} y`;
}

// The repos on the board, most items first, and whether it has drafts.
export function reposOf(items) {
  const n = {};
  for (const i of items) if (i.repo) n[i.repo] = (n[i.repo] ?? 0) + 1;
  return { repos: Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b)), drafts: items.some((i) => i.type === "draft") };
}

export const shortRepo = (repo) => String(repo ?? "").split("/").pop();
// "api #214", "Draft"
export const refOf = (i) => (i.type === "draft" ? "Draft" : `${shortRepo(i.repo)} #${i.number}`);
export const whoOf = (i, me) => (i.assignees.length ? i.assignees.map((a) => (a === me ? "You" : a)).join(", ") : "Unassigned");

// The card that was taken from this item: by the item's id, else by its link.
export function taskOf(item, tasks) {
  return tasks.find((t) => t.github_item && t.github_item === item.item)
    ?? (item.url ? tasks.find((t) => t.github && t.github === item.url) : undefined) ?? null;
}

// Where a taken card starts: "todo" when the board has it, else the first column.
export const takeColumn = (columns) => (columns.includes("todo") ? "todo" : columns[0]);

const CUT = 12000;
// A taken card's notes: where it came from, then the issue's own text.
export function taskBody(item, text = item.body ?? "") {
  const from = item.url ? `From GitHub: ${item.url}` : `From a draft on the GitHub board${item.boardUrl ? `: ${item.boardUrl}` : ""}`;
  let body = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (body.length > CUT) body = `${body.slice(0, CUT).trimEnd()}\n\n(Cut here: the rest is on GitHub.)`;
  // A line of --- alone would end the card's front matter early for some readers.
  body = body.replace(/^---[ \t]*$/gm, "- - -");
  return body ? `${from}\n\n## From the issue\n\n${body}` : from;
}

// A taken card's front matter, besides id, status, folder and created.
export function taskFields(item) {
  return { title: item.title.replace(/\s+/g, " "), priority: item.priority, github: item.url, github_item: item.item };
}

// --- taken cards, kept current (the watcher) ---

// What the card shows of its item: { label, tone, tip, url, number }.
export function chip(f, stale = null) {
  if (f.gone) return { label: "Off the board", tone: "dim", tip: "This item isn't on the GitHub board any more (removed or archived).", url: f.url ?? null, number: f.number ?? null };
  const shut = f.state === "closed" || f.state === "merged";
  const label = shut ? (f.state === "merged" ? "Merged" : "Closed") : (f.status ?? "No status");
  const what = f.type === "draft" ? "A draft" : `${f.repo ?? "GitHub"} #${f.number}`;
  const tip = [
    `${what}${f.board ? ` on the ${f.board} board` : ""}: ${f.status ?? "no status"}${shut ? `, ${f.state}` : ""}`,
    f.assignees?.length ? `assigned to ${f.assignees.join(", ")}` : "unassigned",
    stale ? `not read lately (${stale})` : null,
  ].filter(Boolean).join(" · ");
  return { label, tone: shut || doneLike(f.status) ? "done" : "muted", tip, url: f.url ?? f.boardUrl ?? null, number: f.number ?? null };
}

// One look at a taken card. s: what was seen last time ({ title, closed }, null the
// first time); f: the item now; card: { title, last, pr, branch }; me: your login.
// -> { s, fields (front matter to set), notes: ["closed"] }
//   - the title follows GitHub's while the card's still says what GitHub's said;
//   - an issue or pull request that closes moves the card to the last column, once;
//   - an open or merged pull request of yours that closes the issue becomes the card's
//     `pr:` (a card with a branch finds its own; someone else's is theirs to follow).
export function step(s, f, card, me) {
  const fields = {}, notes = [];
  if (f.gone) return { s: s ?? null, fields, notes };
  if (s && s.title !== undefined && f.title !== s.title && card.title === s.title) fields.title = f.title.replace(/\s+/g, " ");
  const closed = f.state === "closed" || f.state === "merged";
  if (closed && !s?.closed && !card.last) notes.push("closed");
  if (!card.pr && !card.branch && me && f.type === "issue") {
    const mine = (f.prs ?? []).filter((p) => p.author === me && p.state !== "closed" && p.url);
    if (mine.length === 1) fields.pr = mine[0].url;
  }
  return { s: { title: f.title, closed }, fields, notes };
}

// --- workspace.jsonc ---

// The file with board.github set, comments and the rest kept as written.
export function withBoardLink(text, link) {
  const value = JSON.stringify(String(link ?? ""));
  let depth = 0, key = null, colon = false, root = -1, board = -1, inner = null, innerColon = false;
  const skip = (i) => {
    if (text.startsWith("//", i)) { const e = text.indexOf("\n", i); return e < 0 ? text.length : e; }
    if (text.startsWith("/*", i)) { const e = text.indexOf("*/", i + 2); return e < 0 ? text.length : e + 2; }
    return i;
  };
  // After an opening brace: is the object empty (only space and comments before its end)?
  const empty = (from) => {
    for (let i = from; i < text.length;) {
      const j = skip(i);
      if (j !== i) { i = j; continue; }
      if (/\s/.test(text[i])) { i++; continue; }
      return text[i] === "}";
    }
    return true;
  };
  for (let i = 0; i < text.length;) {
    const j = skip(i);
    if (j !== i) { i = j; continue; }
    const c = text[i];
    if (c === '"') {
      let e = i + 1;
      while (e < text.length && text[e] !== '"') e += text[e] === "\\" ? 2 : 1;
      const str = () => { try { return JSON.parse(text.slice(i, e + 1)); } catch { return null; } };
      if (board >= 0 && depth === 2) {
        if (innerColon && inner === "github") return text.slice(0, i) + value + text.slice(e + 1);
        if (!innerColon) inner = str();
      } else if (depth === 1 && !colon) key = str();
      i = e + 1;
      continue;
    }
    if (c === "{" || c === "[") {
      if (depth === 0 && root < 0) root = i;
      if (depth === 1 && colon && key === "board" && c === "{") board = i;
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      // The board object ended without a github line: it goes first in it.
      if (board >= 0 && depth === 1) return `${text.slice(0, board + 1)} "github": ${value}${empty(board + 1) ? " " : ","}${text.slice(board + 1)}`;
    } else if (c === ":") {
      if (depth === 1) colon = true;
      else if (depth === 2 && board >= 0) innerColon = true;
    } else if (c === ",") {
      if (depth === 1) { colon = false; key = null; }
      else if (depth === 2 && board >= 0) { innerColon = false; inner = null; }
    }
    i++;
  }
  if (root < 0) throw new Error("workspace.jsonc has no { }");
  return `${text.slice(0, root + 1)}\n  "board": { "github": ${value} }${empty(root + 1) ? "\n" : ","}${text.slice(root + 1)}`;
}

// --- a board kept on disk, so opening the view again doesn't read GitHub again ---

// How long a read counts as fresh: no new read on opening the view within this, and the next one this long after the last.
export const FRESH = 600e3;
const KEPT = 1; // the kept file's shape; another number is ignored
export const keptText = (board, url, at) => JSON.stringify({ v: KEPT, url, at, board });
// The kept file's board when it's this board's and whole: { at, board }, else null.
export function keptBoard(text, url, now) {
  let c = null;
  try { c = JSON.parse(text ?? "null"); } catch {}
  if (!c || c.v !== KEPT || c.url !== url || typeof c.at !== "number" || c.at > now + 60000) return null;
  if (!Array.isArray(c.board?.items) || !Array.isArray(c.board?.statuses)) return null;
  return { at: c.at, board: c.board };
}

// "3 min ago", "just now"
export function ago(at, now) {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

// gh's first error line as something to act on.
export function ghError(text) {
  const line = String(text ?? "").trim().split("\n").find((l) => l.trim()) ?? "";
  if (/not found|ENOENT|isn't installed|no such file/i.test(line) && /gh\b|spawn|start/i.test(line)) return "gh (GitHub's command line) isn't installed.";
  if (/required scopes|read:project|not been granted/i.test(text ?? "")) return "Your gh login can't read project boards. Run: gh auth refresh -s read:project";
  if (/auth login|not logged in|authentication/i.test(text ?? "")) return "gh isn't signed in. Run: gh auth login";
  return line.replace(/^gh: /, "").slice(0, 200) || "gh gave no answer.";
}
