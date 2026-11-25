// Talking to the Protected broker (herdr-ws-vaultd) on <vault>/broker.sock: one JSON line out,
// one JSON line back. Its answers never carry a value.
import net from "node:net";
import { vaultFile, fail, BROKER_OFF } from "./base.js";

export function socketPath() {
  return vaultFile("broker.sock");
}

let nextId = 1;

// Sends one request; resolves to the answer (ok: true), throws a VaultError for ok: false
// (its kind) or a broker that isn't there (broker_down). timeoutMs 0 waits as long as it takes
// (a run, or the person's answer to a dialog).
export function request(op, fields = {}, { timeoutMs = 0 } = {}) {
  if (process.platform !== "darwin") {
    return Promise.reject(fail("broker_down", "Protected secrets need macOS (the broker keeps them in the Keychain)"));
  }
  const id = nextId++;
  const line = JSON.stringify({ id, op, ...fields }) + "\n";
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath());
    let buf = "";
    let done = false;
    let timer = null;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(val);
    };
    if (timeoutMs) timer = setTimeout(() => finish(fail("broker_down", "the Protected broker didn't answer")), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(line));
    sock.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i < 0) return;
      let ans;
      try { ans = JSON.parse(buf.slice(0, i)); } catch { return finish(fail("failed", "the broker's answer didn't read")); }
      if (ans.ok) return finish(null, ans);
      const e = ans.error || {};
      finish(fail(e.kind || "failed", e.message || "the broker said no"));
    });
    sock.on("error", (err) => {
      if (["ENOENT", "ECONNREFUSED", "ENOTSOCK", "EACCES"].includes(err.code)) finish(fail("broker_down", BROKER_OFF));
      else finish(fail("failed", "the broker's socket: " + err.code));
    });
    sock.on("close", () => finish(fail("broker_down", "the broker closed the connection without answering")));
  });
}

// The broker's status, or null when it doesn't answer within a moment.
export async function brokerStatus(timeoutMs = 1500) {
  try {
    return await request("status", {}, { timeoutMs });
  } catch {
    return null;
  }
}
