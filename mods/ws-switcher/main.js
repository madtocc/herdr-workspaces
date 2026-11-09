// Workspaces: named groups of spaces, each a folder of repos. A workspace is
// ~/.herdr/workspaces/<id>/workspace.jsonc (name, color, root, folders) plus the
// AGENTS.md its agents are told (bin/herdr-ws-agent adds it on launch).
// This block sits above the spaces list and shows the chosen workspace; a click
// opens the menu to switch. `ws-spaces` and `ws-agents` show only that workspace's
// spaces and agents.
//
// Files it writes: ~/.herdr/workspaces/.index (the workspaces' folders, for
// bin/herdr-ws-agent) and, from "New workspace from a folder…", a new workspace's
// two files. It runs your editor (or the system's opener) from "Edit".
//
// Shared state, read by ws-spaces and ws-agents too:
//   workspaces.defs      the parsed configs
//   workspaces.active    the chosen workspace's id, null for every space
//   workspaces.assigned  space id -> workspace id (false: kept out of all of them)
//   workspaces.last      workspace id -> the space last shown in it
//   workspaces.create    a time: the menu asks this block to make a workspace
//
// A space joins a workspace once and stays: when its first terminal is under the
// workspace's root or one of its folders (a herdr worktree goes by its repo's
// name), or when it's made while that workspace is shown.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  spaces, panes, machines, run, theme, shared, setShared, props, openOverlay, closeOverlay,
  home, layout, watchFolder, readTextFile, writeTextFile, pickFolder, exec, notify, window,
} from "herdr";
import * as fs from "fs/promises";

// "Edit" opens the workspace's folder in the first of these that's installed,
// else with the system's opener (Finder, the file manager, Explorer).
const EDITORS = ["zed", "cursor", "code", "subl"];
const SETTLE = 1500; // ms a new space's first terminal takes to report its folder
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
// The spaces list's avatar colors, so a workspace mark matches.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const URGENT = { blocked: 2, done: 1 };

const dir = () => `${home()}/.herdr/workspaces`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// The sidebar's rail goes by its width, as in the other sidebar mods.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function expand(p) {
  const s = String(p ?? "").trim();
  if (!s) return "";
  const full = s === "~" ? home() : s.startsWith("~/") ? home() + s.slice(1) : s;
  return full.length > 1 ? full.replace(/\/+$/, "") : full;
}
const tilde = (p) => (p === home() ? "~" : p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const under = (p, d) => Boolean(p && d) && (p === d || p.startsWith(d === "/" ? d : d + "/"));
const base = (p) => p.replace(/\/+$/, "").split("/").pop();

// JSON with // and /* */ comments and trailing commas.
function parseJsonc(text) {
  const pass = (s, other) => {
    let out = "";
    for (let i = 0; i < s.length;) {
      if (s[i] === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
        out += s.slice(i, j + 1);
        i = j + 1;
      } else {
        const r = other(s, i);
        out += r.text;
        i = r.next;
      }
    }
    return out;
  };
  const uncommented = pass(text, (s, i) => {
    if (s.startsWith("//", i)) { const e = s.indexOf("\n", i); return { text: "", next: e < 0 ? s.length : e }; }
    if (s.startsWith("/*", i)) { const e = s.indexOf("*/", i + 2); return { text: "", next: e < 0 ? s.length : e + 2 }; }
    return { text: s[i], next: i + 1 };
  });
  return JSON.parse(pass(uncommented, (s, i) => {
    if (s[i] !== ",") return { text: s[i], next: i + 1 };
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    return { text: s[j] === "}" || s[j] === "]" ? "" : ",", next: i + 1 };
  }));
}

async function subdirs(path) {
  try {
    return (await fs.readdir(path, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
  } catch { return []; }
}

async function loadDefs() {
  const defs = [];
  for (const id of await subdirs(dir())) {
    const at = `${dir()}/${id}`;
    const text = await readTextFile(`${at}/workspace.jsonc`);
    if (text === null) continue;
    try {
      const c = parseJsonc(text);
      const root = expand(c.root);
      const folders = (Array.isArray(c.folders) ? c.folders : []).map((f) => {
        const e = expand(f);
        return e.startsWith("/") ? e : `${root}/${e}`;
      });
      const told = expand(c.instructions || "AGENTS.md");
      defs.push({
        id, dir: at, name: String(c.name || id), color: c.color ? String(c.color) : null, root, folders,
        children: root ? await subdirs(root) : [], instructions: told.startsWith("/") ? told : `${at}/${told}`,
      });
    } catch (e) {
      defs.push({ id, dir: at, name: id, color: null, root: "", folders: [], children: [], instructions: "", error: String(e?.message ?? e) });
    }
  }
  return defs;
}

// What bin/herdr-ws-agent reads (a shell script can't read JSONC): one line per
// fact, tab-separated. ws: id, root, instructions file. dir: id, a root or folder.
// repo: id, a repo name a herdr worktree can be named after.
function indexText(defs) {
  const ok = (s) => !/[\t\n]/.test(s);
  const lines = ["# Written by the ws-switcher mod for herdr-ws-agent. Don't edit: it's rewritten."];
  for (const d of defs) {
    if (d.error || !d.root || !ok(d.root) || !ok(d.instructions)) continue;
    lines.push(["ws", d.id, d.root, d.instructions].join("\t"));
    for (const f of [d.root, ...d.folders]) if (ok(f)) lines.push(["dir", d.id, f].join("\t"));
    for (const r of new Set([...d.children, ...d.folders.map(base)])) if (ok(r)) lines.push(["repo", d.id, r].join("\t"));
  }
  return lines.join("\n") + "\n";
}

// Opens a folder in the first installed editor of EDITORS, else the system's opener.
function openFolder(path) {
  if (window()?.platform === "windows") return exec("explorer", [path]).catch(() => {});
  const editors = EDITORS.map((e) => `command -v ${e} >/dev/null 2>&1 && exec ${e} "$1";`).join(" ");
  return exec("sh", ["-c", `${editors} command -v open >/dev/null 2>&1 && exec open "$1"; exec xdg-open "$1"`, "sh", path]).catch(() => {});
}

// workspace.jsonc with its top-level "name" set, comments and all kept as written.
function withName(text, name) {
  const value = JSON.stringify(name);
  let depth = 0, key = null, colon = false, open = -1;
  for (let i = 0; i < text.length;) {
    if (text.startsWith("//", i)) { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e; continue; }
    if (text.startsWith("/*", i)) { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 2; continue; }
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (depth === 1 && colon && key === "name") return text.slice(0, i) + value + text.slice(j + 1);
      if (depth === 1 && !colon) key = JSON.parse(text.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") { if (depth === 0 && open < 0) open = i; depth++; }
    else if (c === "}" || c === "]") depth--;
    else if (c === ":" && depth === 1) colon = true;
    else if (c === "," && depth === 1) { colon = false; key = null; }
    i++;
  }
  if (open < 0) throw new Error("workspace.jsonc has no { }");
  return `${text.slice(0, open + 1)}\n  "name": ${value},${text.slice(open + 1)}`;
}

// Moves a folder to the Trash ($1), or to $2/$3 where there's no Trash command.
// Prints where it went.
const TRASH = `
if command -v trash >/dev/null 2>&1; then trash "$1" && echo Trash && exit 0; fi
if command -v gio >/dev/null 2>&1; then gio trash "$1" && echo Trash && exit 0; fi
mkdir -p "$2" && mv "$1" "$2/$3" && echo "$2/$3"`;

// Where a space is now: its first terminal's live folder, else where it was made.
function placeOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}

// The workspace a folder belongs to: the most specific root or folder holding it.
function match(path, defs) {
  let best = null, length = -1;
  for (const d of defs) for (const f of [d.root, ...d.folders]) {
    if (under(path, f) && f.length > length) { best = d; length = f.length; }
  }
  if (best) return best.id;
  const trees = `${home()}/.herdr/worktrees/`;
  if (!path.startsWith(trees)) return null;
  const repo = path.slice(trees.length).split("/")[0];
  return defs.find((d) => d.children.includes(repo) || d.folders.some((f) => base(f) === repo))?.id ?? null;
}

function urgent(list) {
  let best = null;
  for (const s of list) if ((URGENT[s.status] ?? 0) > (URGENT[best] ?? 0)) best = s.status;
  return best;
}

function mark(def, defs, t, size) {
  if (!def) {
    return h_flex().size(size).flex_none().rounded(5).border_1().border_color(t.input).items_center().justify_center()
      .text_color(t.muted).child(svg("mods/workspace-chrome/layers.svg").size(Math.round(size * 0.6)));
  }
  const c = def.color ?? PALETTE[Math.max(0, defs.findIndex((d) => d.id === def.id)) % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
  return h_flex().size(size).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(Math.round(size * 0.55)).font_bold().text_color("#ffffff").child([...def.name][0]?.toUpperCase() ?? "?");
}

// Show a workspace, and the space last shown in it (else its first).
function choose(id) {
  setShared("workspaces.active", id);
  if (!id) return;
  const assigned = shared("workspaces.assigned") ?? {};
  const mine = spaces().filter((s) => assigned[s.id] === id);
  if (!mine.length || mine.some((s) => s.active)) return;
  const last = (shared("workspaces.last") ?? {})[id];
  run("space.select", { id: (mine.find((s) => s.id === last) ?? mine[0]).id });
}

function configText(name, color, root, folders) {
  return `// A Herdr workspace. The switcher above the spaces list reads this file;
// edits apply at once. Comments and trailing commas are fine.
{
  // Shown in the switcher.
  "name": ${JSON.stringify(name)},
  // Its mark: ansi1..ansi6 (theme colors) or "#rrggbb".
  "color": ${JSON.stringify(color)},
  // The folder the work lives in. A space whose terminal is under it joins
  // this workspace, and so does a space made while this workspace is shown.
  "root": ${JSON.stringify(root)},
  // The repos and folders used here: relative to root, or absolute (~ works)
  // for one that lives elsewhere. The switcher lists them to open as spaces.
  "folders": [
${folders.map((f) => `    ${JSON.stringify(f)},`).join("\n")}
  ],
  // What every agent started here is told (claude, codex), on top of each
  // repo's own CLAUDE.md / AGENTS.md. Default: AGENTS.md next to this file.
  // "instructions": "AGENTS.md",
}
`;
}

const instructionsText = (name) => `<!-- What every agent (claude, codex) started in the ${name} workspace is told,
     on top of each repo's own CLAUDE.md / AGENTS.md. Write below this comment;
     the comment itself is not sent. Applies to agents started after you save. -->
`;

export default class Workspaces extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (props()?.popup) {
      this.handle.focus();
      return;
    }
    if (props()?.dialog) {
      this.handle.focus();
      if (props().dialog === "rename") {
        this.text = (shared("workspaces.defs") ?? []).find((d) => d.id === props().id)?.name ?? "";
        this.input = InputState.new({ value: this.text });
        this.input.set_selected_range({ start: 0, end: this.text.length });
        this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = null; cx.notify(); });
        this.input.on("submit", (_e, cx) => this.rename(cx));
        this.input.focus();
        cx.timer.after(600, () => this.input.focus());
      }
      return;
    }
    this.known = new Set(spaces().map((s) => s.id)); // decided: no "made while shown" fallback
    this.born = {};
    this.shown = spaces().find((s) => s.active)?.id ?? null;
    this.loaded = false;
    this.asked = shared("workspaces.create") ?? null;
    this.reload(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(dir()); }
        catch { cx.timer.every(5000, (cx) => this.reload(cx)); return; }
        this.reload(cx);
      }
    });
    // A new space waits SETTLE for its folder; look again until it's decided.
    cx.timer.every(500, (cx) => { if (spaces().some((s) => !this.known.has(s.id))) cx.notify(); });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      const defs = await loadDefs();
      this.loaded = true;
      if (JSON.stringify(defs) !== JSON.stringify(shared("workspaces.defs") ?? [])) setShared("workspaces.defs", defs);
      // Only when it changes: writing it wakes watchFolder (and this) again.
      const index = `${dir()}/.index`, text = indexText(defs);
      try {
        const old = await readTextFile(index);
        if (old !== text) await writeTextFile(index, text, old);
      } catch {} // a stale snapshot: the next change writes it
      cx.notify();
    });
  }

  // Places new spaces, follows the shown space into its workspace, remembers it.
  sync() {
    const defs = shared("workspaces.defs") ?? [];
    let active = shared("workspaces.active") ?? null;
    if (this.loaded && active && !defs.some((d) => d.id === active)) {
      active = null;
      setShared("workspaces.active", null);
    }
    const sp = spaces(), ps = panes(), now = Date.now();
    const assigned = { ...(shared("workspaces.assigned") ?? {}) };
    let changed = false;
    // A workspace that's gone (deleted here or by hand): its spaces are decided again.
    if (this.loaded) {
      for (const [id, ws] of Object.entries(assigned)) {
        if (ws !== false && !defs.some((d) => d.id === ws)) { delete assigned[id]; this.known.add(id); changed = true; }
      }
    }
    for (const s of sp) {
      if (s.id in assigned) { this.known.add(s.id); continue; }
      const fresh = !this.known.has(s.id);
      if (fresh && now - (this.born[s.id] ??= now) < SETTLE) continue;
      const hit = s.machine ? null : match(placeOf(s, ps), defs);
      if (hit) { assigned[s.id] = hit; changed = true; }
      else if (fresh && active) { assigned[s.id] = active; changed = true; }
      this.known.add(s.id);
    }
    // Spaces that are gone, once every machine's spaces are known.
    if (machines().every((m) => m.layout === "ready")) {
      const live = new Set(sp.map((s) => s.id));
      for (const id of Object.keys(assigned)) if (!live.has(id)) { delete assigned[id]; changed = true; }
    }
    if (changed) setShared("workspaces.assigned", assigned);

    // A key, a toast or space.next showed a space elsewhere: go with it.
    const shown = sp.find((s) => s.active)?.id ?? null;
    if (shown && shown !== this.shown && this.known.has(shown)) {
      this.shown = shown;
      const owner = defs.some((d) => d.id === assigned[shown]) ? assigned[shown] : null;
      if (owner !== active) { active = owner; setShared("workspaces.active", active); }
    }
    if (active && shown && assigned[shown] === active) {
      const last = shared("workspaces.last") ?? {};
      if (last[active] !== shown) setShared("workspaces.last", { ...last, [active]: shown });
    }
  }

  async create() {
    const root = await pickFolder({ prompt: "Use as workspace" });
    if (!root) return;
    const defs = shared("workspaces.defs") ?? [];
    const slug = base(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
    let id = slug;
    for (let n = 2; defs.some((d) => d.id === id) || (await fs.exists(`${dir()}/${id}`)); n++) id = `${slug}-${n}`;
    const used = new Set(defs.map((d) => d.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[defs.length % PALETTE.length];
    await writeTextFile(`${dir()}/${id}/workspace.jsonc`, configText(base(root), color, tilde(root), await subdirs(root)), null);
    await writeTextFile(`${dir()}/${id}/AGENTS.md`, instructionsText(base(root)), null);
    setShared("workspaces.defs", await loadDefs());
    choose(id);
  }

  // The rename dialog's Save: writes the new name into workspace.jsonc, then closes.
  rename(cx) {
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === props().id);
    const name = this.text.trim();
    if (!d || this.busy) return;
    if (!name) { this.error = "A workspace needs a name."; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const file = `${d.dir}/workspace.jsonc`;
        const old = await readTextFile(file);
        if (old === null) throw new Error("its workspace.jsonc is gone");
        await writeTextFile(file, withName(old, name), old);
        // Shown at once; the folder watch confirms it.
        setShared("workspaces.defs", (shared("workspaces.defs") ?? []).map((x) => (x.id === d.id ? { ...x, name } : x)));
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = `Couldn't rename it: ${e?.message ?? e}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  // The delete dialog's confirm: the folder to the Trash, its spaces decided again.
  remove(cx) {
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === props().id);
    if (!d || this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const r = await exec("sh", ["-c", TRASH, "sh", d.dir, `${dir()}/.trash`, `${d.id}-${stamp}`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        const where = r.stdout.trim();
        // Gone from the list now, so its spaces join where their folder is, not it again.
        setShared("workspaces.defs", (shared("workspaces.defs") ?? []).filter((x) => x.id !== d.id));
        const assigned = { ...(shared("workspaces.assigned") ?? {}) };
        for (const [id, ws] of Object.entries(assigned)) if (ws === d.id) delete assigned[id];
        setShared("workspaces.assigned", assigned);
        const last = { ...(shared("workspaces.last") ?? {}) };
        delete last[d.id];
        setShared("workspaces.last", last);
        if (shared("workspaces.active") === d.id) setShared("workspaces.active", null);
        notify({ title: `Deleted ${d.name}`, body: where === "Trash" ? "Its folder is in the Trash." : `Its folder is in ${tilde(where)}.`, level: "success" });
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = `Couldn't delete it: ${e?.message ?? e}`;
        this.busy = false;
        cx.notify();
      }
    });
  }

  dialog(t) {
    const p = props();
    const d = (shared("workspaces.defs") ?? []).find((x) => x.id === p.id);
    const close = () => closeOverlay(p.overlay);
    const button = (id, label, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(this.busy, (el) => el.opacity(0.5)).hover((s) => s.opacity(0.88)).on_click(action).child(label);
    const title = (text) => h_flex().items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(text))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
    const error = () => div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error ?? "");
    const frame = (id, enter) => v_flex().id(id).track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") close();
        else if (e.key === "enter" && enter) enter(cx);
        else return;
        cx.stop_propagation();
      });
    if (!d) return frame("ws-gone", null).child(title("Workspace")).child(div().pt(12).text_color(t.muted).child("This workspace is gone."));

    if (p.dialog === "rename") {
      return frame("ws-rename", null)
        .child(title("Rename workspace"))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
        .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(`Changes "name" in ${tilde(d.dir)}/workspace.jsonc.`))
        .when(Boolean(this.error), (el) => el.child(error()))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ws-rename-cancel", "Cancel", false, close))
          .child(button("ws-rename-save", "Save", true, (_e, cx) => this.rename(cx))));
    }

    return frame("ws-delete", (cx) => this.remove(cx))
      .child(title(`Delete “${d.name}”?`))
      .child(div().pt(12).text_color(t.muted).child(
        `Moves ${tilde(d.dir)} (its workspace.jsonc and AGENTS.md) to the Trash. Your repos and folders aren't touched, and its spaces stay open: they join the workspace their folder is in, else show under All spaces.`))
      .when(Boolean(this.error), (el) => el.child(error()))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ws-delete-cancel", "Cancel", false, close))
        .child(button("ws-delete-yes", this.busy ? "Deleting…" : "Move to Trash", true, (_e, cx) => this.remove(cx))));
  }

  render(cx) {
    const t = theme();
    if (props()?.popup) return this.menu(t);
    if (props()?.dialog) return this.dialog(t);
    this.sync();
    const ask = shared("workspaces.create") ?? null;
    if (ask !== this.asked) {
      this.asked = ask;
      if (ask) cx.spawn(async (cx) => {
        try { await this.create(); }
        catch (e) { notify({ title: "Couldn't make the workspace", body: String(e?.message ?? e), level: "error" }); }
        cx.notify();
      });
    }
    const defs = shared("workspaces.defs") ?? [];
    const active = defs.find((d) => d.id === shared("workspaces.active")) ?? null;
    const assigned = shared("workspaces.assigned") ?? {};
    const sp = spaces();
    const count = active ? sp.filter((s) => assigned[s.id] === active.id).length : sp.length;
    // An agent needs you in a workspace that isn't shown.
    const elsewhere = active ? urgent(sp.filter((s) => assigned[s.id] !== active.id)) : null;
    const dot = (id) => div().id(id).size(6).flex_none().rounded_full().bg(t[elsewhere])
      .tooltip(elsewhere === "blocked" ? "An agent needs you in another workspace" : "An agent finished in another workspace");
    const open = () => openOverlay({ mod: "ws-switcher", kind: "popup", width: 288, height: 600, props: { popup: true } });
    if (narrow()) {
      return h_flex().size_full().bg(t.chrome).items_center().justify_center()
        .child(h_flex().id("ws-rail").relative().size(32).rounded(6).items_center().justify_center().cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(active?.name ?? "All spaces").on_click(open)
          .child(mark(active, defs, t, 20))
          .when(Boolean(elsewhere), (el) => el.child(dot("ws-rail-dot").absolute().top(2).right(2))));
    }
    return h_flex().size_full().bg(t.chrome).px(8).items_center().text_size(13)
      .child(h_flex().id("ws-current").flex_1().min_w(0).h(34).px(8).gap(9).rounded(8).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(open)
        .child(mark(active, defs, t, 20))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(active?.name ?? "All spaces"))
        .when(Boolean(elsewhere), (el) => el.child(dot("ws-dot")))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(count)))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).flex_none().text_color(t.dim)));
  }

  menu(t) {
    const defs = shared("workspaces.defs") ?? [];
    const active = defs.find((d) => d.id === shared("workspaces.active")) ?? null;
    const assigned = shared("workspaces.assigned") ?? {};
    const sp = spaces(), ps = panes();
    const shown = sp.find((s) => s.active) ?? null;
    let height = 10; // the menu's padding; each part adds its own
    const icon = (name) => svg(`mods/workspace-chrome/${name}.svg`).size(14).flex_none().text_color(t.muted);
    const hint = (...kids) => h_flex().flex_none().gap(8).items_center().text_size(11).text_color(t.dim).children(kids);
    const check = (on) => (on ? svg("mods/workspace-chrome/check.svg").size(13).text_color(t.accent) : div().w(13));
    const head = (text) => { height += 26; return div().h(26).px(8).pt(9).flex_none().text_size(11).text_color(t.dim).child(text); };
    const line = () => { height += 9; return div().h(1).mx(4).my(4).flex_none().bg(t.border); };
    const row = (id, lead, label, tail, action, { dim = false, tip = null, keep = false, danger = false } = {}) => {
      height += 30;
      return h_flex().id(id).h(30).px(8).gap(9).rounded(7).items_center().flex_none().cursor_pointer()
        .text_color(danger ? t.blocked : dim ? t.dim : t.foreground).hover((s) => s.bg(t.selected))
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .on_click((_e, cx) => { if (!keep) closeOverlay(props().overlay); action(cx); })
        .child(lead).child(div().flex_1().min_w(0).truncate().child(label)).child(tail);
    };
    const frame = (items) => v_flex().id("ws-menu").track_focus(this.handle).on_key_down((e) => this.key(e, defs))
      .w_full().h(Math.min(600, height)).p(5).bg(t.popover).text_size(12.8).overflow_y_scrollbar()
      .children(items);

    // "Move to…": where the shown space goes. Its new workspace is then shown.
    if (this.moving && shown) {
      const owner = assigned[shown.id];
      const move = (to) => {
        setShared("workspaces.assigned", { ...(shared("workspaces.assigned") ?? {}), [shown.id]: to });
        setShared("workspaces.active", to || null);
      };
      return frame([head(`Move “${shown.name}” to`),
        ...defs.map((d) => row(`ws-to-${d.id}`, mark(d, defs, t, 18), d.name, hint(check(owner === d.id)), () => move(d.id))),
        line(),
        row("ws-to-none", mark(null, defs, t, 18), "No workspace", hint(check(!owner)), () => move(false),
          { tip: "Shows only under All spaces, and doesn't join a workspace by its folder" })]);
    }

    const items = [head("Workspaces"),
      row("ws-all", mark(null, defs, t, 18), "All spaces", hint(String(sp.length), check(!active)), () => choose(null))];
    for (const d of defs) {
      const mine = sp.filter((s) => assigned[s.id] === d.id);
      const status = urgent(mine);
      items.push(row(`ws-${d.id}`, mark(d, defs, t, 18), d.name,
        hint(status ? div().size(6).rounded_full().bg(t[status]) : div(), String(mine.length), check(active?.id === d.id)),
        () => choose(d.id), { dim: Boolean(d.error), tip: d.error ? `workspace.jsonc: ${d.error}` : tilde(d.root) }));
    }

    // The actions before the folders: a workspace can have many folders.
    items.push(line());
    if (shown && defs.length) {
      items.push(row("ws-move", icon("layers"), `Move “${shown.name}” to…`, hint("›"),
        (cx) => { this.moving = true; cx.notify(); }, { keep: true }));
    }
    items.push(row("ws-new", icon("folder-plus"), "New workspace from a folder…", div(), () => setShared("workspaces.create", Date.now())));
    const target = active?.dir ?? dir();
    items.push(row("ws-edit", icon("file-text"), active ? `Open ${active.name}'s files` : "Open the workspaces folder", div(),
      () => openFolder(target), { tip: tilde(target) }));
    if (active) {
      const ask = (dialog, height) => openOverlay({ mod: "ws-switcher", kind: "dialog", width: 420, height, props: { dialog, id: active.id } });
      items.push(row("ws-rename", icon("square-pen"), `Rename ${active.name}…`, div(), () => ask("rename", 210)));
      items.push(row("ws-delete", svg("mods/workspace-chrome/archive.svg").size(14).flex_none().text_color(t.blocked), `Delete ${active.name}…`, div(),
        () => ask("delete", 200), { danger: true }));
    }

    if (active && !active.error) {
      const folders = active.folders.length ? active.folders : active.children.map((c) => `${active.root}/${c}`);
      if (folders.length) items.push(line(), head(`${active.name} folders`));
      for (const f of folders) {
        const there = sp.find((s) => !s.machine && under(placeOf(s, ps), f));
        items.push(row(`ws-folder-${f}`, icon("folder"), base(f), hint(there ? "Go" : "Open"),
          () => run(there ? "space.select" : "space.new", there ? { id: there.id } : { folder: f }), { tip: tilde(f) }));
      }
    }

    return frame(items);
  }

  // 0 shows every space, 1-9 the workspaces in the menu's order.
  key(e, defs) {
    if (this.moving || e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    if (!/^[0-9]$/.test(e.key)) return;
    const n = Number(e.key);
    if (n > defs.length) return;
    closeOverlay(props().overlay);
    choose(n === 0 ? null : defs[n - 1].id);
  }
}
