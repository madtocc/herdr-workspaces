// @ts-nocheck
// The background runner: the workspaces' automations (../automations.js) and
// board cards' pull requests (../prs.js) and GitHub board items (../ghboard.js), run by Node instead of by Herdr's window,
// so they keep going while Herdr is closed. bin/herdr-ws-runner starts it as a
// terminal herdr-core holds (`hc ls` shows it, `hc read herdr-ws-runner` is its log).
//
// Files, all in ~/.herdr/runner:
//   switch            "on": this should run (bin/herdr-ws-runner --on / --off)
//   alive             { at, pid, rev }, rewritten every 10s and on every change:
//                     the switcher takes "fresh" to mean this is running, and reads
//                     state.json again when rev moves
//   state.json        what the Automations screen and the board show, which the
//                     switcher copies into shared state: { automations, global, runs, prs, github }
//   notes/*.json      toasts for the window, shown now or when Herdr next opens
//   automations.json, prs.json, github.json   what they remember (see Store)
// Requests come as files in ~/.herdr/workspaces/.inbox (automations.js).
// It runs either as a terminal herdr-core holds (`hc run`, via "hc" in alive) or straight under
// launchd at login (herdr-ws-runner --login on, via "launchd"): then herdr-core isn't started until
// an agent run needs it (runner/herdr.js), so scripts and checks run with nothing else open.
// Settings > Automations (the same file): how many agent runs go at once, and the quiet hours
// in which its desktop notifications make no sound.
// Settings > Features (~/.herdr/settings.jsonc, read here every 2s: this process has no
// shared state of the window's): Board off, no pull request or GitHub board item follow-through;
// Automations off, no runs (automations.js). Each change is one line in the log.
//
// A run starts as a core terminal with Herdr's labels, which is how Herdr adopts
// a terminal it didn't start: herdr.space is the workspace's Automations space
// (a new id the first time) and herdr.tab a new tab. The switcher names them
// when the window is there (runs marked `adopt`).

import * as nfs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  home, exec, readTextFile, writeTextFile, watchFolder, shared, setShared, onShared, refresh, terminals, spaces, runnerDir, hex, windowOpen, setQuietHours,
} from "./herdr.js";
import { Runner, globalDir } from "../automations.js";
import { terminalOf } from "../runfacts.js";
import { PrWatcher } from "../prs.js";
import { GhWatcher } from "../ghboard.js";
import { dir, loadDefs, templatesDir, loadPresetDir, presetsFor, presetLaunch, withTask, notesOnly } from "../defs.js";
import { SETTINGS_FILE, parseSettings, automationSetting } from "../settingsfacts.js";
import { Features, flips, FOLLOWED } from "../featuregate.js";

const SPACE = "Automations";
const BEAT = 10000;
const two = (n) => String(n).padStart(2, "0");
// Lines in `hc read herdr-ws-runner`, with this computer's time.
const log = (...a) => { const d = new Date(); console.log(`${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`, ...a); };
const said = (e) => String(e?.message ?? e);

const cx = {
  spawn(fn) { Promise.resolve().then(() => fn(cx)).catch((e) => log("task failed:", said(e))); },
  notify() {},
  timer: { every(ms, fn) { setInterval(() => fn(cx), ms); }, after(ms, fn) { setTimeout(() => fn(cx), ms); } },
};

// An agent with its first message, in a shell that stays when the agent exits: as Herdr starts one.
function agentArgv(cmd) {
  const sh = process.env.SHELL || "/bin/sh", name = path.basename(sh), login = process.platform === "darwin";
  if (!["sh", "bash", "zsh", "dash", "ksh", "fish"].includes(name)) return ["/bin/sh", "-c", '"$@"; exec "$0" -i', sh, ...cmd];
  const stay = login ? "-li" : "-i";
  return [sh, login ? "-lic" : "-ic", name === "fish" ? `command $argv[2..]; exec $argv[1] ${stay}` : `"$@"; exec "$0" ${stay}`, sh, ...cmd];
}

let runner = null;

// Settings > Features: the file as it is now, and a line in the log when Board or
// Automations goes off or comes back (once per change; at the start, the ones that are off).
const features = new Features();
let featuresSaid = null;
let settings = null; // the file as last read: Settings > Automations for the runner
async function readFeatures() {
  const parsed = parseSettings(await readTextFile(`${home()}/${SETTINGS_FILE}`));
  settings = parsed;
  setQuietHours(automationSetting(parsed, "quiet-hours"));
  features.fromFile(parsed, null);
  const now = Object.fromEntries(Object.keys(FOLLOWED).map((k) => [k, features.on(k)]));
  for (const f of flips(featuresSaid, now)) log(FOLLOWED[f.key][f.on ? "on" : "off"]);
  featuresSaid = now;
}

// A run's tab: a terminal labelled into the workspace's Automations space. bare: argv as it is (a
// shell automation's script, which says how it ended and ends), not an agent in your shell.
async function open(ws, name, folder, argv, task, { bare = false } = {}) {
  ({ argv, task } = withTask(argv, task));
  const cmd = [...argv, ...(task?.trim() ? [task.trim()] : [])];
  await refresh(true).catch(() => {});
  const assigned = shared("workspaces.assigned") ?? {};
  const known = spaces().find((s) => s.named && s.name === SPACE && assigned[s.id] === ws)?.id;
  const space = known ?? runner.state.spaces[ws] ?? `sp${hex(32)}`;
  runner.state.spaces[ws] = space;
  runner.save();
  const tab = `tb${hex(32)}`;
  const r = await exec("hc", ["run", "--json", "--bg", "--keep", "--no-parent", "--cwd", folder,
    "--label", `herdr.space=${space}`, "--label", `herdr.tab=${tab}`, "--label", "herdr.seen=0", "--", ...(bare ? cmd : agentArgv(cmd))], { timeout: 60000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  const terminal = out?.address ?? out?.terminal?.address ?? out?.terminal ?? null;
  if (r.code !== 0 || typeof terminal !== "string") throw new Error(out?.error?.message || r.stderr.trim() || r.stdout.trim() || "hc run failed");
  log(`started ${ws}/${name} at ${terminal}`);
  return { space, tab, terminal, adopt: true };
}

// Ends this automation's older run terminals that aren't working or waiting on
// you (their tabs close with them), keeping the newest `keep` that are still there.
function tidy(runs, keep, busy) {
  const live = runs.filter((r) => terminalOf(r, terminals())?.state === "live");
  for (const r of live.slice(keep)) if (!busy(r)) exec("hc", ["kill", r.terminal]).catch(() => {});
}

// A run's tab closing (its agent finished, or its time ran out): its terminal ends, and the tab
// with it. Only the run's own terminal: an address that's another terminal's now is left alone.
async function close(r) {
  if (!terminalOf(r, terminals())) { log(`left ${r.ws}/${r.name} at ${r.terminal}: that terminal isn't its run's any more`); return; }
  await exec("hc", ["kill", r.terminal]).catch(() => {});
  log(`closed ${r.ws}/${r.name} at ${r.terminal}`);
}

// --- what the window shows: state.json, and alive ---

let rev = 0, dirty = false, noted = false;
const published = ["workspaces.automations", "workspaces.automations.global", "workspaces.automation.runs", "workspaces.prs", "workspaces.github"];
onShared((key) => { if (key === "notes") noted = true; else if (published.includes(key)) dirty = true; });

async function beat() {
  if (((await readTextFile(`${runnerDir()}/switch`)) ?? "").trim() !== "on") { log("turned off"); process.exit(0); }
  if (dirty) {
    dirty = false;
    rev++;
    await writeTextFile(`${runnerDir()}/state.json`, JSON.stringify({
      rev, automations: shared("workspaces.automations") ?? {}, global: shared("workspaces.automations.global") ?? [], runs: shared("workspaces.automation.runs") ?? [], prs: shared("workspaces.prs") ?? {}, github: shared("workspaces.github") ?? {},
    }));
  }
  if (noted) { noted = false; rev++; }
  await writeTextFile(`${runnerDir()}/alive`, JSON.stringify({ at: Date.now(), pid: process.pid, rev, via: process.env.HERDR_WS_RUNNER_VIA || "hc" }));
}

async function reload() {
  const defs = await loadDefs();
  if (JSON.stringify(defs) !== JSON.stringify(shared("workspaces.defs") ?? [])) setShared("workspaces.defs", defs);
  await presets();
  await runner.load(cx);
  await prs.load();
  await gh.load();
}

async function presets() {
  const out = { global: await loadPresetDir(templatesDir(), "global"), workspaces: {} };
  for (const d of shared("workspaces.defs") ?? []) out.workspaces[d.id] = await loadPresetDir(`${d.dir}/agents`, "workspace");
  setShared("workspaces.presets", out);
  let launcher = false;
  try { launcher = (await exec("sh", ["-c", "command -v herdr-ws-agent"])).code === 0; } catch {}
  setShared("workspaces.launcher", launcher);
}

// This mod's code as it is on disk now. Herdr reloads its own copy when a file changes;
// this process has to start again to do the same (bin/herdr-ws-runner's loop does that).
async function codeNow() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  let out = "";
  for (const d of [root, `${root}/runner`]) {
    for (const n of (await nfs.readdir(d)).filter((x) => x.endsWith(".js")).sort()) out += `${n} ${(await nfs.stat(`${d}/${n}`)).mtimeMs}\n`;
  }
  return out;
}

// One at a time: another one that's alive keeps the job.
async function alone() {
  let a = null;
  try { a = JSON.parse((await readTextFile(`${runnerDir()}/alive`)) ?? "null"); } catch {}
  if (!a || a.pid === process.pid || Date.now() - a.at > 3 * BEAT) return true;
  try { process.kill(a.pid, 0); return false; } catch { return true; }
}

let prs = null, gh = null;
async function main() {
  await nfs.mkdir(runnerDir(), { recursive: true });
  await nfs.mkdir(`${dir()}/.inbox`, { recursive: true });
  await nfs.mkdir(globalDir(), { recursive: true });
  if (!(await alone())) { log("another runner is running: leaving it to it"); process.exit(0); }
  if (((await readTextFile(`${runnerDir()}/switch`)) ?? "").trim() !== "on") { log("it's off (herdr-ws-runner --on turns it on)"); process.exit(0); }
  await refresh(true).catch((e) => log("herdr-core:", said(e)));
  await readFeatures();
  runner = new Runner({
    presetsFor, presetLaunch, withTask, claim() {}, open, tidy, close, windowOpen, away: "while Herdr's runner wasn't running",
    featureOn: (k) => features.on(k), automationSetting: (k) => automationSetting(settings, k), startWhy: "Herdr's background runner started",
    // Vault's folder as herdr-ws-secret finds it (HERDR_VAULT_DIR, else ~/.herdr/vault): meta.json, for secret_env.
    vaultDir: () => process.env.HERDR_VAULT_DIR || `${home()}/.herdr/vault`,
  });
  prs = new PrWatcher();
  gh = new GhWatcher();
  dirty = true;
  await reload();
  await beat();
  log(`running (pid ${process.pid}): ${Object.values(runner.list).flat().length} automations in ${Object.keys(runner.list).length} workspaces`);

  let reloading = Promise.resolve();
  const again = (paths) => { reloading = reloading.then(reload).then(() => runner.changed(paths, cx)).catch((e) => log("reload failed:", said(e))); };
  (async () => {
    for (;;) {
      let paths;
      try { paths = await watchFolder(dir()); }
      catch (e) { log("can't watch the workspaces:", said(e)); setInterval(() => again([dir()]), 5000); return; }
      if (!notesOnly(paths, dir())) again(paths); // a note being typed: nothing here reads notes
    }
  })();
  // The automations for every workspace.
  (async () => {
    for (;;) {
      try { await watchFolder(globalDir()); }
      catch (e) { log("can't watch the global automations:", said(e)); setInterval(() => again([]), 10000); return; }
      again([]);
    }
  })();
  (async () => {
    for (;;) {
      try { await watchFolder(templatesDir()); }
      catch { setInterval(() => presets().catch(() => {}), 10000); return; }
      await presets().catch(() => {});
    }
  })();

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await refresh(); } catch {} // herdr-core is away: the schedules still tick
    try { runner.tick(cx); if (features.on("board")) { prs.tick(cx); gh.tick(cx); } } catch (e) { log("tick failed:", said(e)); }
    busy = false;
    if (dirty || noted) beat().catch(() => {});
  }, 500);
  setInterval(() => beat().catch((e) => log("alive:", said(e))), BEAT);
  setInterval(() => readFeatures().catch((e) => log("settings:", said(e))), 2000);
  const code = await codeNow().catch(() => null);
  setInterval(async () => {
    const now = await codeNow().catch(() => code);
    if (code !== null && now !== code) { log("its code changed: starting again with the new one"); process.exit(3); }
  }, BEAT);
}

process.on("unhandledRejection", (e) => log("unhandled:", said(e)));
main().catch((e) => { log("couldn't start:", said(e)); process.exit(1); });
