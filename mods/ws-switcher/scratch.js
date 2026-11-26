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
const under = (path, dir) => path === dir || path.startsWith(dir + "/");

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
    for (const line of r.stdout.split("\n")) {
      const [path, keep, count] = line.split("\t");
      if (!path) continue;
      seen.add(path);
      if (places.some((p) => under(p, path))) {
        this.used.add(path);
        delete this.free[path];
        this.told.delete(path);
        left.push(path);
        continue;
      }
      const since = (this.free[path] ??= now);
      const files = Number(count) > 0;
      if (keep === "1") { left.push(path); continue; }
      if (!files) {
        if (now - since >= EMPTY_AFTER) await exec("sh", ["-c", `rm -f "$1/.DS_Store"; rmdir "$1"`, "sh", path]);
        else left.push(path);
        continue;
      }
      const name = path.split("/").pop();
      if (this.used.has(path) && !this.told.has(path)) {
        this.told.add(path);
        notify({
          title: `Scratch folder ${name} has files`,
          body: `Click to keep it. Otherwise it goes to the ${trashName()} after ${KEEP_DAYS} days unused.`,
          level: "info",
          action: { name: `ws-switcher.scratch-keep/${name}` },
        });
      }
      if (now - since >= KEEP_DAYS * DAY) {
        const where = await trash(path);
        notify({ title: `Scratch folder moved to the ${trashName()}`, body: `${name}: unused for ${KEEP_DAYS} days${where && where !== "Trash" ? `, now in ${where}` : ""}.`, level: "info" });
      } else left.push(path);
    }
    // Gone (deleted, trashed, moved out): forget it.
    for (const p of Object.keys(this.free)) if (!seen.has(p)) delete this.free[p];
    for (const p of [...this.used]) if (!seen.has(p)) this.used.delete(p);
    for (const p of [...this.told]) if (!seen.has(p)) this.told.delete(p);
    this.save();
    // The menu and the empty list show these, newest first.
    left.sort().reverse();
    if (JSON.stringify(left) !== JSON.stringify(shared("workspaces.scratch.folders") ?? null)) setShared("workspaces.scratch.folders", left);
  }

  // The toast's Keep: "scratch-keep/<folder>" from nextCommand().
  async keep(command) {
    const name = command.slice("scratch-keep/".length);
    if (!/^[^/.][^/]*$/.test(name)) return;
    const path = `${scratchRoot(this.io.home())}/${name}`;
    const r = await this.io.exec("sh", ["-c", `[ -d "$1" ] && : > "$1/.keep"`, "sh", path]);
    this.io.notify(r.code === 0
      ? { title: "Scratch folder kept", body: `${name} stays until you delete it (a .keep file in it says so).`, level: "success" }
      : { title: "Couldn't keep the scratch folder", body: `${name} isn't there any more.`, level: "error" });
  }
}
