// The Scratch workspace: a workspace for trying ideas that belong to no project.
// Its root is ~/.herdr/scratch, and each of its spaces gets a fresh folder there.
// "New scratch space" (the + on the switcher menu's Scratch header, the Spaces + while Scratch is shown, or the
// command ws-switcher.scratch-new) asks for a name first (ws-switcher's New space
// dialog), then makes one from any workspace and shows it, so the switcher follows it
// into Scratch. A space named "bot idea" gets ~/.herdr/scratch/<YYYY-MM-DD-HHMM>-bot-idea,
// so a folder that outlives its space still says what it was for; with no name it is
// "Scratch <time>" in ~/.herdr/scratch/<YYYY-MM-DD-HHMM>. The command
// ws-switcher.scratch-new/<name> makes one at once, without the dialog (a script).
//
// The workspace is an ordinary one (~/.herdr/workspaces/scratch/workspace.jsonc with
// "scratch": true), made the first time the switcher runs, so its instructions,
// presets, board and automations work like any other's. Deleted, it comes back the
// next time a scratch space is made.
//
// The switcher's sidebar copy also tidies the folders, every 15 seconds while Herdr
// is open and at once when a scratch space opens or closes. A folder nobody is in
// (no space was made in it or shows it, no terminal is in it):
// - empty: deleted (rmdir, so a folder that isn't empty can never go this way);
// - with files: a toast says so once, with Keep; after KEEP_DAYS unused it goes to
//   the Trash. Keep writes a `.keep` file, and a folder with one is never touched.
// Nothing outside ~/.herdr/scratch is looked at or changed.
// What each folder left is waiting for goes to shared "workspaces.scratch.state" (folder -> { kept } |
// { trashAt } | { empty } | { used }), so the switcher menu's row can say it (scratchWhen()).
// The row's Keep / Don't keep button (and its right-click) send "ws-switcher.scratch-row/keep|unkeep/<folder>"
// to the sidebar copy (setKept(); Don't keep starts the 7 days again from then).

export const KEEP_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
const EMPTY_AFTER = 10000; // ms an empty folder stays unused before it goes (a new space takes a moment)

export const scratchRoot = (home) => `${home}/.herdr/scratch`;
export const isScratch = (path, home) => Boolean(path?.startsWith(scratchRoot(home) + "/"));
export const scratchDef = (defs) => (defs ?? []).find((d) => d.scratch && !d.error) ?? null;

const pad = (n) => String(n).padStart(2, "0");
// A space's name as part of its folder's: "Bot idéa!" -> "bot-idea". "" when nothing
// of it is a letter a-z or a digit; the folder then has only its date and time.
export function scratchSlug(name) {
  let s = String(name ?? "");
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_e) { /* an engine without normalize: accents drop out below */ }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "");
}
// The name in a scratch folder's name, for the lists: ".../2026-11-20-1020-bot-idea" ->
// "bot-idea". null for one made unnamed (only the date and time, or with its -2).
// ws-spaces has the same rule (scratchName()): change both.
export const scratchLabel = (folder) => String(folder ?? "").replace(/\/+$/, "").split("/").pop().match(/^\d{4}-\d\d-\d\d-\d{4}-(?!\d$)(.+)$/)?.[1] ?? null;
// A switcher command's failure toast title, by what was asked ("scratch-new", "scratch-keep/…",
// "automation/…", "show/<view>/…", "settings…", a view's key). nameOf: a view's key -> its name.
export function commandFailTitle(c, nameOf = () => null) {
  const s = String(c ?? "");
  if (s === "scratch-new" || s.startsWith("scratch-new/")) return "Couldn't make a scratch space";
  if (s.startsWith("scratch-keep/") || s.startsWith("scratch-row/keep/")) return "Couldn't keep the scratch folder";
  if (s.startsWith("scratch-row/")) return "Couldn't let the scratch folder go";
  if (s.startsWith("automation/")) return "Couldn't open Automations";
  if (s === "settings" || s.startsWith("settings/")) return "Couldn't open Settings";
  const view = nameOf(s.startsWith("show/") ? s.split("/")[1] : s);
  return view ? `Couldn't open ${view}` : "Couldn't do that";
}
const under = (path, dir) => path === dir || path.startsWith(dir + "/");

// A folder row's words in the switcher menu, from its entry in "workspaces.scratch.state": the tail
// ("kept", "5 days left", "1 day left", "empty") and the tooltip's end. Dates as History's headings
// ("3 Dec"). Nothing known yet (before the first look): no tail.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function scratchWhen(state, now, trashWord = "Trash") {
  if (!state || typeof state !== "object") return { tail: "", tip: "its space is closed" };
  if (state.kept) return { tail: "kept", tip: "kept: it stays until you delete it" };
  if (state.empty) return { tail: "empty", tip: "empty: it's deleted in a moment" };
  if (state.used) return { tail: "", tip: "a terminal is in it" };
  const at = Number(state.trashAt);
  if (!isFinite(at)) return { tail: "", tip: "its space is closed" };
  const days = Math.max(1, Math.ceil((at - now) / DAY));
  const d = new Date(at);
  return { tail: `${days} ${days === 1 ? "day" : "days"} left`, tip: `goes to the ${trashWord} on ${d.getDate()} ${MONTHS[d.getMonth()]} unless you keep it` };
}

// The Delete Scratch dialog's button: it says what else it does, closing its spaces.
export const scratchDeleteButton = (open, trashWord = "Trash") =>
  open > 0 ? `Close ${open} ${open === 1 ? "space" : "spaces"} and move to ${trashWord}` : `Move to ${trashWord}`;

// A scratch folder's row keeps or lets go from the switcher menu (its Keep / Don't keep button and
// right-click): "scratch-row/keep/<folder>" or "scratch-row/unkeep/<folder>". The folder's name, or
// null for anything else (a name is one path part, never "." or ".." or hidden).
export function rowCommand(command) {
  const m = /^scratch-row\/(keep|unkeep)\/([^/]+)$/.exec(String(command ?? ""));
  return m && /^[^/.][^/]*$/.test(m[2]) ? { keep: m[1] === "keep", name: m[2] } : null;
}

// Whether a row's pressed Keep / Don't keep still looks pressed: until the state says it's done, but at least
// 500 ms (a double-click's second press can't land on the opposite button) and at most 10 s (a failed ask).
export const keepPending = (pending, kept, now) =>
  Boolean(pending) && now - pending.at <= 10000 && (kept !== pending.keep || now - pending.at < 500);

export const scratchConfig = `// The Scratch workspace: for trying ideas that belong to no project. Each space
// here gets a fresh folder in ~/.herdr/scratch; an empty one is deleted when you
// close it, one with files goes to the Trash after 7 days unused unless you keep it.
// "New scratch space" in the switcher menu makes one from any workspace.
{
  "name": "Scratch",
  "color": "#7d8089",
  "root": "~/.herdr/scratch",
  "folders": [],
  "scratch": true,
}
`;
export const scratchAgents = `<!-- What every agent (Claude, Codex, Antigravity, Pi) started in the Scratch workspace is told.
     Nothing here is a project: write below this comment if agents should know
     something about trying ideas. The comment itself is not sent. -->
`;

// One line per scratch folder: path, has .keep (1/0), how many entries besides
// .keep and .DS_Store. `*` skips .trash.
const LIST = `
[ -d "$1" ] || exit 0
for d in "$1"/*/; do
  [ -d "$d" ] || continue
  d=\${d%/}
  keep=0; [ -e "$d/.keep" ] && keep=1
  n=$(ls -A "$d" | grep -v -x -e .DS_Store -e .keep | wc -l | tr -d ' ')
  printf '%s\\t%s\\t%s\\n' "$d" "$keep" "$n"
done`;

// io: { home, exec, spaces, panes, run, notify, shared, setShared, readTextFile,
//       writeTextFile, wsDir, trash(path) -> where it went }
// The system's trash by its name: the Recycle Bin on Windows, the Trash elsewhere.
let platformOf = () => null; // io.platform, set by the constructor
const trashName = () => (platformOf() === "windows" ? "Recycle Bin" : "Trash");

export class Scratch {
  constructor(io) {
    this.io = io;
    if (io.platform) platformOf = io.platform;
    const saved = JSON.parse(localStorage.getItem("scratch") ?? "{}");
    this.free = saved.free ?? {}; // folder -> when it was first seen unused
    this.used = new Set(saved.used ?? []); // folders seen in use, so leaving one is noticed
    this.told = new Set(saved.told ?? []); // folders whose "has files" toast was shown
    this.made = Boolean(saved.made); // the workspace was made once (a deleted one waits for the next scratch space)
    this.last = 0;
    this.busy = false;
  }

  save() {
    localStorage.setItem("scratch", JSON.stringify({ free: this.free, used: [...this.used], told: [...this.told], made: this.made }));
  }

  // Writes the workspace's two files unless a Scratch workspace exists. Returns its id.
  async ensureWorkspace() {
    const { shared, readTextFile, writeTextFile, wsDir } = this.io;
    const have = scratchDef(shared("workspaces.defs"));
    if (have) return have.id;
    let id = "scratch";
    for (let n = 2; (await readTextFile(`${wsDir()}/${id}/workspace.jsonc`)) !== null; n++) id = `scratch-${n}`;
    await writeTextFile(`${wsDir()}/${id}/workspace.jsonc`, scratchConfig, null);
    if ((await readTextFile(`${wsDir()}/${id}/AGENTS.md`)) === null) await writeTextFile(`${wsDir()}/${id}/AGENTS.md`, scratchAgents, null);
    this.made = true;
    this.save();
    return id;
  }

  // Once, when the switcher has read the workspaces: the workspace is always there.
  async firstRun() {
    if (this.made || scratchDef(this.io.shared("workspaces.defs"))) {
      if (!this.made) { this.made = true; this.save(); }
      return;
    }
    await this.ensureWorkspace();
  }

  // Makes the folder and the space; the switcher places it in Scratch by its root.
  async create(name = "") {
    const { home, exec, run } = this.io;
    await this.ensureWorkspace();
    name = String(name ?? "").trim().slice(0, 80);
    const slug = scratchSlug(name);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const parent = scratchRoot(home());
    // mkdir without -p fails on a taken name, so the first free one wins.
    const r = await exec("sh", ["-c", `mkdir -p "$1" && for n in "" -2 -3 -4 -5 -6 -7 -8 -9; do mkdir "$1/$2$n" 2>/dev/null && echo "$1/$2$n" && exit 0; done; exit 1`, "sh", parent, slug ? `${stamp}-${slug}` : stamp]);
    const folder = r.stdout.trim();
    if (r.code !== 0 || !folder) throw new Error(r.stderr.trim() || `couldn't make a folder in ${parent}`);
    this.used.add(folder); // so closing it, however soon, is noticed
    this.save();
    // Unnamed, two in the same minute: "Scratch 10:20 (2)", like the folder's -2.
    const n = name ? null : folder.match(/-(\d)$/)?.[1];
    run("space.new", { folder, name: name || `Scratch ${pad(now.getHours())}:${pad(now.getMinutes())}${n ? ` (${n})` : ""}` });
    return folder;
  }

  // The folders something is in now: spaces (where made, where their terminals are) and terminals.
  places() {
    const ps = this.io.panes();
    const out = [];
    for (const s of this.io.spaces()) {
      if (s.machine) continue;
      if (s.folder) out.push(s.folder);
      const tabs = new Set((s.tabs ?? []).map((t) => t.id));
      for (const p of ps) if (tabs.has(p.tab) && p.cwd) out.push(p.cwd);
    }
    for (const p of ps) if (p.cwd) out.push(p.cwd);
    return out;
  }

  tick(cx) {
    const now = Date.now();
    // Sooner when a scratch space opens or closes.
    const sig = this.places().filter((p) => isScratch(p, this.io.home())).sort().join("\n");
    const moved = sig !== this.sig;
    this.sig = sig;
    if (this.busy || (!moved && now - this.last < 15000)) return;
    this.last = now;
    this.busy = true;
    cx.spawn(async () => {
      try { await this.sweep(now); }
      catch (e) { console.log(`scratch: ${e?.message ?? e}`); }
      finally { this.busy = false; }
    });
  }

  async sweep(now) {
    const { home, exec, notify, trash, shared, setShared } = this.io;
    const r = await exec("sh", ["-c", LIST, "sh", scratchRoot(home())]);
    if (r.code !== 0) return;
    const places = this.places();
    const seen = new Set();
    const left = []; // folders still there after this look, for the menu
    const state = {}; // what each of them waits for (scratchWhen())
    for (const line of r.stdout.split("\n")) {
      const [path, keep, count] = line.split("\t");
      if (!path) continue;
      seen.add(path);
      if (places.some((p) => under(p, path))) {
        this.used.add(path);
        delete this.free[path];
        this.told.delete(path);
        left.push(path);
        state[path] = keep === "1" ? { kept: true } : { used: true };
        continue;
      }
      const since = (this.free[path] ??= now);
      const files = Number(count) > 0;
      if (keep === "1") { left.push(path); state[path] = { kept: true }; continue; }
      if (!files) {
        if (now - since >= EMPTY_AFTER) await exec("sh", ["-c", `rm -f "$1/.DS_Store"; rmdir "$1"`, "sh", path]);
        else { left.push(path); state[path] = { empty: true }; }
        continue;
      }
      const name = path.split("/").pop(), label = scratchLabel(path) ?? name;
      if (this.used.has(path) && !this.told.has(path)) {
        this.told.add(path);
        notify({
          title: `Scratch folder ${label} has files`,
          body: `Click to keep it. Otherwise it goes to the ${trashName()} after ${KEEP_DAYS} days unused.`,
          level: "info",
          action: { name: `ws-switcher.scratch-keep/${name}` },
        });
      }
      if (now - since >= KEEP_DAYS * DAY) {
        const where = await trash(path);
        notify({ title: `Scratch folder moved to the ${trashName()}`, body: `${label}: unused for ${KEEP_DAYS} days${where && where !== "Trash" ? `, now in ${where}` : ""}.`, level: "info" });
      } else { left.push(path); state[path] = { trashAt: since + KEEP_DAYS * DAY }; }
    }
    // Gone (deleted, trashed, moved out): forget it.
    for (const p of Object.keys(this.free)) if (!seen.has(p)) delete this.free[p];
    for (const p of [...this.used]) if (!seen.has(p)) this.used.delete(p);
    for (const p of [...this.told]) if (!seen.has(p)) this.told.delete(p);
    this.save();
    // The menu and the empty list show these, newest first.
    left.sort().reverse();
    if (JSON.stringify(left) !== JSON.stringify(shared("workspaces.scratch.folders") ?? null)) setShared("workspaces.scratch.folders", left);
    if (JSON.stringify(state) !== JSON.stringify(shared("workspaces.scratch.state") ?? null)) setShared("workspaces.scratch.state", state);
  }

  // The menu row's Keep or Don't keep ("scratch-row/…", rowCommand()): quiet, since the row's words
  // change at once ("kept", "7 days left"); only a failure says so. Don't keep takes the .keep file out
  // and starts the folder's 7 days again from now, with no "has files" toast (it was told, or kept).
  async setKept(command) {
    const c = rowCommand(command);
    if (!c) return;
    const path = `${scratchRoot(this.io.home())}/${c.name}`;
    const r = await this.io.exec("sh", ["-c", c.keep ? `[ -d "$1" ] && : > "$1/.keep"` : `[ -d "$1" ] && rm -f "$1/.keep"`, "sh", path]);
    if (r.code !== 0) {
      this.io.notify({ title: c.keep ? "Couldn't keep the scratch folder" : "Couldn't let the scratch folder go", body: `${scratchLabel(c.name) ?? c.name} isn't there any more.`, level: "error" });
      return;
    }
    const now = Date.now();
    if (!c.keep) { this.free[path] = now; this.told.add(path); this.save(); }
    this.io.setShared("workspaces.scratch.state", { ...(this.io.shared("workspaces.scratch.state") ?? {}), [path]: c.keep ? { kept: true } : { trashAt: now + KEEP_DAYS * DAY } });
  }

  // The toast's Keep: "scratch-keep/<folder>" from nextCommand().
  async keep(command) {
    const name = command.slice("scratch-keep/".length);
    if (!/^[^/.][^/]*$/.test(name)) return;
    const path = `${scratchRoot(this.io.home())}/${name}`;
    const r = await this.io.exec("sh", ["-c", `[ -d "$1" ] && : > "$1/.keep"`, "sh", path]);
    // The menu says "kept" at once, not at the next look.
    if (r.code === 0) this.io.setShared("workspaces.scratch.state", { ...(this.io.shared("workspaces.scratch.state") ?? {}), [path]: { kept: true } });
    const label = scratchLabel(name) ?? name;
    this.io.notify(r.code === 0
      ? { title: "Scratch folder kept", body: `${label} stays in ~/.herdr/scratch until you delete it (a .keep file in it says so).`, level: "success" }
      : { title: "Couldn't keep the scratch folder", body: `${label} isn't there any more.`, level: "error" });
  }
}
