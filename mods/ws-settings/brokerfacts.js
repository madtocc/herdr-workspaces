// Settings > Vault's broker row as rules with no imports, so node can test them: what the row
// says and which buttons it has for an answer of `herdr-ws-secret broker status --json`
// (CONTRACT: { platform, installed, running, loaded, binary, signed, hardened, count, version,
// current, drift, swiftc, socket, error }), how an action's answer reads, and what a press does.
// extras.js draws it and runs the CLI.

// What each button runs (herdr-ws-secret's arguments) and says while it runs. Start is a
// restart (the LaunchAgent is booted out and in again); Update is an install, which rebuilds
// because the source's sha256 no longer matches the installed build's. Rebuild anyway is an
// install that the CLI otherwise refuses: vaultd.swift changed without a package update.
export const BROKER_OPS = {
  install: { args: ["broker", "install", "--json"], busy: "Installing…" },
  start: { args: ["broker", "restart", "--json"], busy: "Starting…" },
  restart: { args: ["broker", "restart", "--json"], busy: "Restarting…" },
  update: { args: ["broker", "install", "--json"], busy: "Updating…" },
  rebuild: { args: ["broker", "install", "--rebuild", "--json"], busy: "Rebuilding…" },
  uninstall: { args: ["broker", "uninstall", "--json"], busy: "Uninstalling…" },
};
export const STATUS_ARGS = ["broker", "status", "--json"];

// What the broker gives, and nothing more (the review's S11): only it reads the items, and it
// sends a value only where the secret allows.
export const ABOUT_INSTALLED = "Signed hardened-runtime helper (herdr-ws-vaultd). Only it can read Protected secrets, and it sends them only to the hosts and commands you allow.";
export const ABOUT_SETUP = "Compiles and signs a small local Swift helper (herdr-ws-vaultd). Only it will be able to read Protected secrets, and it sends them only to the hosts and commands you allow.";
// When to trust macOS's Keychain prompt after a rebuild (S9): only one you caused.
export const PROMPT_NOTE = "Allow that macOS prompt only right after you pressed Install or Update yourself; if it appears on its own, click Deny.";
export const UPDATE_NOTE = "Built from an older source. After an update macOS asks once for each Protected secret, because the Keychain trusts the exact build. " + PROMPT_NOTE;
export const UNEXPECTED_NOTE = "vaultd.swift changed without a package update. Rebuild only if you changed it yourself.";
export const UNINSTALL_NOTE = "Protected secrets stay in the Keychain but can't be used until the broker is installed again.";
const NO_SWIFTC = "Needs Xcode's command line tools to build it: run xcode-select --install in a terminal. Standard secrets work without it.";

// A press on the row (m10): what it changes at once and what it runs. confirm-uninstall and
// cancel only ask or stop asking (the row must redraw at once: run is null); any other known op
// runs, and a press while something runs does nothing.
export function pressBroker(b, op) {
  if (b && b.busy) return { confirm: Boolean(b.confirm), run: null };
  if (op === "confirm-uninstall") return { confirm: true, run: null };
  if (op === "cancel") return { confirm: false, run: null };
  return { confirm: false, run: BROKER_OPS[op] ? op : null };
}

// The first line of a text that says something, trimmed (null when there's none).
export function firstLine(text) {
  const line = String(text ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  return line || null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// `herdr-ws-secret broker status --json`'s run ({ code, stdout, stderr }, null when it couldn't
// start) as { status, error }: the answer when stdout is one, else the first line of why not.
export function parseBrokerStatus(r) {
  if (!r) return { status: null, error: "herdr-ws-secret couldn't be started" };
  let o = null;
  try { o = JSON.parse(String(r.stdout ?? "")); } catch { /* not an answer */ }
  if (o && typeof o === "object" && !Array.isArray(o) && typeof o.installed === "boolean") return { status: o, error: null };
  return { status: null, error: firstLine(r.stderr) ?? (r.code !== 0 ? firstLine(r.stdout) : null) ?? `herdr-ws-secret broker status gave no answer (exit ${r.code ?? "?"})` };
}

// An action's run ({ code, stdout, stderr }, null when it couldn't start): null when it worked,
// else the first line of why (the JSON answer's error message first, then stderr, then stdout).
export function actionError(r) {
  if (!r) return "herdr-ws-secret couldn't be started";
  let o = null;
  try { o = JSON.parse(String(r.stdout ?? "")); } catch { /* plain text */ }
  const said = o && typeof o === "object" && o.ok === false ? firstLine(o.error?.message ?? o.error) : null;
  if (r.code === 0 && !(o && o.ok === false)) return null;
  return said ?? firstLine(r.stderr) ?? firstLine(r.stdout) ?? `herdr-ws-secret exited ${r.code ?? "?"}`;
}

// Which state the row is in: checking (no answer yet), other (not macOS), no-swiftc, absent
// (not installed), outdated (built from an older source, and the package was updated too),
// unexpected (the source changed with no package update: maybe not by you), running, stopped.
// `drift` ("none" | "update" | "unexpected") decides when the CLI gives it; an older CLI's
// `current: false` counts as an update.
export function brokerState(status, mac = true) {
  if (!mac || (status && status.platform && status.platform !== "macos")) return "other";
  if (!status) return "checking";
  if (!status.installed) return status.swiftc === false ? "no-swiftc" : "absent";
  if (status.drift === "unexpected") return "unexpected";
  if (status.drift === "update" || (status.drift === undefined && status.current === false)) return "outdated";
  return status.running ? "running" : "stopped";
}

// The row for a status answer. opts: mac (this is macOS), busy (the op running, or null), error
// (an action's failure, else the status' own or the read's), confirm (Uninstall was pressed once:
// the row asks before it goes), home (for ~ in the socket's path). Returns { state, chip:
// { label, tone: ok|warn|dim } | null, about, facts, note, buttons: [{ op, label, kind:
// primary|plain|danger, enabled }], error }. An op "confirm-uninstall" asks; "cancel" stops asking.
export function brokerView(status, { mac = true, busy = null, error = null, readError = null, confirm = false, home = "" } = {}) {
  const state = brokerState(status, mac);
  const tilde = (p) => (home && String(p).startsWith(`${home}/`) ? `~${String(p).slice(home.length)}` : String(p));
  const btn = (op, label, kind = "plain") => ({ op, label: busy === op ? BROKER_OPS[op]?.busy ?? label : label, kind, enabled: !busy });
  const v = { state, chip: null, about: ABOUT_INSTALLED, facts: "", factParts: [], note: null, buttons: [], error: null };
  // The facts line in parts, so the screen can wrap between them and never inside one (a
  // socket path broke in the middle beside the wider Rebuild anyway).
  const installedParts = () => [
    status.loaded ? "LaunchAgent loaded" : "LaunchAgent not loaded",
    typeof status.count === "number" ? plural(status.count, "Protected secret") : null,
    status.socket ? `socket ${tilde(status.socket)}` : null,
  ].filter(Boolean);
  const installedFacts = () => installedParts().join(" · ");
  const uninstall = () => (confirm && !busy
    ? [btn("cancel", "Cancel"), btn("uninstall", "Uninstall", "danger")]
    : [btn(busy === "uninstall" ? "uninstall" : "confirm-uninstall", "Uninstall", "danger")]);

  if (state === "other") {
    return { ...v, about: "Protected secrets need macOS: the broker keeps them in the Keychain, where only it can read them. Standard secrets work here.", error: firstLine(error) };
  }
  if (state === "checking") {
    const facts = readError ? "" : "Checking the broker…";
    return { ...v, about: "", facts, factParts: facts ? [facts] : [], error: firstLine(error) ?? firstLine(readError) };
  }
  if (state === "absent" || state === "no-swiftc") {
    v.chip = { label: "Not installed", tone: "dim" };
    v.about = ABOUT_SETUP;
    if (state === "no-swiftc") v.facts = NO_SWIFTC;
    else {
      v.facts = "Requires macOS Command Line Tools (swiftc). Standard secrets work without it.";
      v.buttons = [btn("install", "Install & enable", "primary")];
    }
  } else {
    v.factParts = installedParts();
    const signed = status.signed === "adhoc" || status.signed === "identity";
    const run = status.running ? (signed ? "Running · signed" : "Running · unsigned") : "Not running";
    v.facts = installedFacts();
    if (state === "unexpected") {
      // Not an Update (S9): a warning, and only a quiet way to rebuild.
      v.chip = { label: `${run} · source changed`, tone: "warn" };
      v.note = UNEXPECTED_NOTE;
      v.buttons = [...(status.swiftc === false ? [] : [btn("rebuild", "Rebuild anyway")]), ...uninstall()];
    } else if (state === "outdated") {
      v.chip = { label: `${run} · older build`, tone: "warn" };
      if (status.swiftc === false) v.note = `${UPDATE_NOTE} ${NO_SWIFTC.replace("to build it", "to update it")}`;
      else v.note = UPDATE_NOTE;
      v.buttons = [...(status.swiftc === false ? [] : [btn("update", "Update", "primary")]), ...uninstall()];
    } else if (state === "running") {
      v.chip = { label: run, tone: signed && status.hardened !== false ? "ok" : "warn" };
      v.buttons = [btn("restart", "Restart"), ...uninstall()];
      // All well: only the count. The LaunchAgent and the socket are for when something is wrong.
      if (v.chip.tone === "ok" && status.loaded && typeof status.count === "number" && !error && !status.error && !readError) {
        v.factParts = [plural(status.count, "Protected secret")];
        v.facts = v.factParts[0];
      }
    } else {
      v.chip = { label: run, tone: "warn" };
      v.buttons = [btn("start", "Start", "primary"), ...uninstall()];
    }
    // Asking before Uninstall: the row's only buttons are Cancel and Uninstall.
    if (confirm && !busy) { v.note = UNINSTALL_NOTE; v.buttons = uninstall(); }
  }
  if (!v.factParts.length && v.facts) v.factParts = [v.facts];
  // The home folder as ~, as in the facts ("see ~/.herdr/vault/broker.log").
  const err = firstLine(error) ?? firstLine(status?.error) ?? firstLine(readError);
  v.error = err && home ? err.split(`${home}/`).join("~/") : err;
  return v;
}
