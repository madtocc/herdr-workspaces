// herdr-ws-secret: use the secrets the person keeps in Herdr's Vault without ever seeing them.
// No command prints a value and none takes one as an argument; there is no get.
import fs from "node:fs";
import path from "node:path";
import { VaultError, EXIT, knownSecrets, vaultDir } from "./base.js";
import { redact } from "../vaultfacts.js";

const HELP = `herdr-ws-secret: use secrets from Herdr's Secrets without seeing them. No command
prints a value; you name a secret and it's filled in where it's used.

  herdr-ws-secret list [--json]
      The secrets you can use here (this workspace's, then every workspace's).

  herdr-ws-secret http <url> [-X METHOD] [-H 'K: V']… [-d DATA | -d @file | -d @-] [-b 'k=v']
                       [-i] [-o FILE] [-f] [--no-location] [--max-time SECONDS]
      Like curl. {{secret:NAME}} may stand in the URL's query, -H, -b and -d:
        herdr-ws-secret http https://develop.example.com/api -H 'Cookie: {{secret:develop-admin-cookie}}'
      Body to stdout; "HTTP <status>" and notes to stderr; -i adds the headers, -f exits 22 on
      4xx/5xx. Redirects are followed (a secret header is dropped for another host). Every form
      of a secret in the answer (plain, URL-encoded, base64, hex) shows as [secret:NAME].

  herdr-ws-secret run [--env VAR=NAME]… [--file VAR=NAME]… [--timeout SECONDS] -- <command…>
      Runs the command with the secret in VAR (--file: VAR is the path of a 0600 file holding it,
      removed afterwards). Its output comes back redacted. A secret can't stand in the command's
      own words. Exits with the command's code; 125 when it couldn't start it.

Each secret says where it may go. Protected ones only to their hosts and pinned commands, enforced
by the broker; Standard ones with hosts or commands set are held to them, and without any, go
anywhere (that's the Standard tier's deal). Expired secrets are refused. A workspace's secrets are
grouped by name for it, not walled off: an agent elsewhere that names the workspace can use them.
Redaction can't catch a value inside a larger encoded blob (base64 of "user:token") or one the
command changed some other way.

For the person (and Herdr's Secrets screen), --json on each:
  herdr-ws-secret put <name> [--workspace ID | --global] [--tier standard|protected] [--mode http|http+cli]
                  [--hosts h1,h2] [--commands c1,c2] [--allow-shells] [--ttl 4h|24h|7d|30d|never] [--note TEXT]
                  (--value-stdin, or it asks with echo off)
  herdr-ws-secret edit <name> [scope] [--mode …] [--hosts …] [--commands …] [--[no-]allow-shells] [--ttl …] [--note …]
  herdr-ws-secret migrate <name> [scope] --tier standard|protected
  herdr-ws-secret rm <name> [scope]
  herdr-ws-secret sync                         refresh the list of Protected secrets from the broker
  herdr-ws-secret broker install [--rebuild]|status|restart|uninstall

Exit codes: 0 done, 2 usage, 3 no such secret, 4 expired, 5 refused by its rules, 6 the broker
isn't running (Settings > Secrets, or herdr-ws-secret broker install), 7 the person said no, 1 other.
`;

function out(o) {
  process.stdout.write(JSON.stringify(o) + "\n");
}

// One error line (or JSON), never with a value in it.
function report(err, json) {
  const kind = err instanceof VaultError ? err.kind : "failed";
  const message = redact(err instanceof VaultError ? err.message : "something went wrong: " + (err && err.code ? err.code : String(err && err.message ? err.message.split("\n")[0] : err)), knownSecrets()).text;
  if (json) out({ ok: false, error: { kind, message } });
  else process.stderr.write(`herdr-ws-secret: ${message}\n`);
  return EXIT[kind] ?? 1;
}

// A screen's handoff file holds a value in plain text until ingest takes it. One older than a
// minute was left by a save that never finished (the dialog closed, Herdr quit): every run
// removes those.
function sweepInbox() {
  const dir = vaultDir();
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  const now = Date.now();
  for (const n of names) {
    if (!n.startsWith(".inbox-")) continue;
    const f = path.join(dir, n);
    try {
      const st = fs.lstatSync(f);
      if ((st.isFile() || st.isSymbolicLink()) && now - st.mtimeMs > 60000) fs.unlinkSync(f);
    } catch { /* gone meanwhile */ }
  }
}

async function main(argv) {
  sweepInbox();
  const [cmd, ...rest] = argv;
  const json = rest.includes("--json");
  try {
    switch (cmd) {
      case undefined: case "-h": case "--help": case "help":
        process.stdout.write(HELP);
        return cmd === undefined ? 2 : 0;
      case "list": {
        const ops = await import("./ops.js");
        const all = rest.includes("--all");
        let workspace = null;
        const i = rest.indexOf("--workspace");
        if (i >= 0) workspace = rest[i + 1];
        for (const a of rest) if (a.startsWith("-") && !["--json", "--all", "--workspace", "--global"].includes(a)) throw new VaultError("usage", `list doesn't know ${a}`);
        const r = await ops.listEntries({ workspace, global: rest.includes("--global"), all });
        if (json) out(ops.listJson(r)); else process.stdout.write(ops.listText(r));
        return 0;
      }
      case "http": {
        const { httpCommand } = await import("./http.js");
        return await httpCommand(rest);
      }
      case "run": {
        const { runCommand } = await import("./run.js");
        return await runCommand(rest);
      }
      case "redact": {
        const { redactCommand } = await import("./ops.js");
        return await redactCommand(rest);
      }
      case "put": case "edit": case "migrate": case "rm": {
        const ops = await import("./ops.js");
        const o = ops.parseArgs(rest, { value: cmd === "put" });
        const scope = ops.scopeFrom(o);
        let entry;
        if (cmd === "put") entry = await ops.putEntry({ name: o.name, scope, set: o.set, value: await ops.readValue(o) });
        else if (cmd === "edit") entry = await ops.editEntry({ name: o.name, scope, set: o.set });
        else if (cmd === "migrate") {
          if (!o.set.tier) throw new VaultError("usage", "migrate needs --tier standard or --tier protected");
          entry = await ops.migrateEntry({ name: o.name, scope, tier: o.set.tier });
        } else entry = await ops.removeEntry({ name: o.name, scope });
        if (json) out({ ok: true, entry });
        else {
          const where = entry.scope === "global" ? "every workspace" : entry.scope.slice(3);
          const did = { put: "saved", edit: "changed", migrate: `now ${entry.tier}`, rm: "removed" }[cmd];
          process.stderr.write(`${entry.name} (${where}): ${did}\n`);
        }
        return 0;
      }
      case "ingest": {
        const ops = await import("./ops.js");
        try {
          const entry = await ops.ingest(rest.find((a) => !a.startsWith("--")));
          out({ ok: true, entry });
          return 0;
        } catch (err) {
          return report(err, true);
        }
      }
      case "sync": {
        const ops = await import("./ops.js");
        const n = await ops.syncMirror();
        if (json) out({ ok: true, protected: n }); else process.stderr.write(`${n} Protected secret(s) from the broker\n`);
        return 0;
      }
      case "broker": {
        const b = await import("./brokerctl.js");
        const sub = rest.find((a) => !a.startsWith("--"));
        if (sub === "status") {
          const s = await b.status();
          if (json) out(s); else process.stdout.write(b.statusText(s));
          return 0;
        }
        let r;
        if (sub === "install") r = await b.install({ log: json ? () => {} : undefined, rebuild: rest.includes("--rebuild") });
        else if (sub === "restart") r = await b.restart();
        else if (sub === "uninstall") r = await b.uninstall();
        else throw new VaultError("usage", "broker install, status, restart or uninstall");
        if (json) out({ ok: true, ...r });
        else if (sub === "uninstall") process.stderr.write("The broker is off and won't start at login. Your secrets are kept.\n");
        else process.stderr.write(r.running ? "The broker is running.\n" : "The broker was set up but isn't answering yet (herdr-ws-secret broker status).\n");
        return 0;
      }
      default:
        throw new VaultError("usage", `no command ${cmd} (herdr-ws-secret --help)`);
    }
  } catch (err) {
    return report(err, json);
  }
}

const code = await main(process.argv.slice(2));
process.exitCode = code;
