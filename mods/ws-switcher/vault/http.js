// herdr-ws-secret http: a small curl that fills {{secret:<name>}} in the URL's query, -H, -b
// and -d, sends the request, and prints the answer with every form of every secret redacted.
// Body to stdout; "HTTP <status>" and notes to stderr; -i adds the status line and headers to
// stdout; -f exits 22 on 4xx/5xx. Standard secrets are filled in here; a request that names a
// Protected one goes to the broker, which fills those in itself.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { fail, remember } from "./base.js";
import { caller } from "./caller.js";
import { lookup, checkStandardHost, standardValues, noteUse, noteAttempt } from "./use.js";
import { request as brokerRequest } from "./broker.js";
import { findPlaceholders, fillPlaceholders, redact, redirectStep, schemeAllowed, makeRedactor, secretForms, headerRefused } from "../vaultfacts.js";

export const BODY_CAP = 16 * 1024 * 1024;

// A body read past the cap (by the longest form's length) redacted, then cut at the cap: a value
// that straddles the cap is still caught whole, and the end that might be the start of one is
// never shown. raw and the secrets' values are byte strings.
export function capBody(raw, cap, secrets) {
  const r = makeRedactor(secrets, { bytes: true });
  const text = r.push(raw);
  return { text: text.slice(0, cap), count: r.count };
}

// How far past the cap to read: the longest form of any of these secrets.
export function capSlack(secrets) {
  let n = 0;
  for (const s of secrets) for (const f of secretForms(s.value, { bytes: true })) n = Math.max(n, f.length);
  return n;
}

function readStdin() {
  return fs.readFileSync(0);
}

// The command line, curl's way: options anywhere, short boolean flags grouped (-fsSL).
export function parseHttpArgs(argv) {
  const o = { url: null, method: null, headers: [], data: [], cookies: [], include: false, output: null, failOnError: false, follow: true, maxTime: 30, silent: false, workspace: null, global: false };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw fail("usage", `${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-X": case "--request": o.method = need(i, a).toUpperCase(); i++; continue;
      case "-H": case "--header": o.headers.push(need(i, a)); i++; continue;
      case "-d": case "--data": case "--data-binary": o.data.push({ text: need(i, a), at: true }); i++; continue;
      case "--data-raw": o.data.push({ text: need(i, a), at: false }); i++; continue;
      case "-b": case "--cookie": o.cookies.push(need(i, a)); i++; continue;
      case "-o": case "--output": o.output = need(i, a); i++; continue;
      case "-m": case "--max-time": o.maxTime = Number(need(i, a)); i++; continue;
      case "--workspace": o.workspace = need(i, a); i++; continue;
      case "--global": o.global = true; continue;
      case "-i": case "--include": o.include = true; continue;
      case "-f": case "--fail": o.failOnError = true; continue;
      case "-L": case "--location": o.follow = true; continue;
      case "--no-location": o.follow = false; continue;
      case "-s": case "--silent": o.silent = true; continue;
      case "-S": case "--show-error": continue;
      default:
        if (/^-[fsSLi]{2,}$/.test(a)) {
          for (const ch of a.slice(1)) {
            if (ch === "f") o.failOnError = true;
            else if (ch === "s") o.silent = true;
            else if (ch === "i") o.include = true;
            else if (ch === "L") o.follow = true;
          }
          continue;
        }
        if (a.startsWith("-") && a !== "-") throw fail("usage", `http doesn't know ${a} (herdr-ws-secret --help)`);
        if (o.url) throw fail("usage", "http takes one URL");
        o.url = a;
    }
  }
  if (!o.url) throw fail("usage", "http needs a URL: herdr-ws-secret http <url> [-H 'K: V'] [-d DATA]");
  if (!/^https?:\/\//i.test(o.url)) o.url = "https://" + o.url;
  if (!(o.maxTime > 0 && o.maxTime <= 300)) throw fail("usage", "--max-time is 1 to 300 seconds");
  return o;
}

// The request's parts as templates, each knowing which secrets it holds.
function templates(o) {
  const q = o.url.indexOf("?");
  const before = q < 0 ? o.url : o.url.slice(0, q);
  if (findPlaceholders(before).length) throw fail("usage", "a secret may stand only in the URL's query (after ?), in -H, -b or -d");
  const headers = o.headers.map((h) => {
    const i = h.indexOf(":");
    if (i <= 0) throw fail("usage", `-H "${h.split(":")[0]}…" isn't "Name: value"`);
    return [h.slice(0, i).trim(), h.slice(i + 1).trim()];
  });
  if (o.cookies.length) {
    for (const c of o.cookies) if (!c.includes("=")) throw fail("usage", "-b takes cookies as name=value (a cookie file isn't read)");
    headers.push(["Cookie", o.cookies.join("; ")]);
  }
  let body = null;
  if (o.data.length) {
    body = o.data.map((d) => {
      if (d.at && d.text.startsWith("@")) {
        const f = d.text.slice(1);
        try { return (f === "-" ? readStdin() : fs.readFileSync(f)).toString("utf8"); } catch { throw fail("usage", `-d @${f}: can't read it`); }
      }
      return d.text;
    }).join("&");
    if (!headers.some(([k]) => k.toLowerCase() === "content-type")) headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
  }
  const method = o.method || (body !== null ? "POST" : "GET");
  return { url: o.url, headers, body, method };
}

// One request, sent from here. Resolves { status, statusText, headers: [[k, v]], body, truncated }.
function sendLocal({ method, url, headers, body }, deadline, slack = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : u.protocol === "http:" ? http : null;
    if (!mod) return reject(fail("usage", `http can't send to ${u.protocol}`));
    const hdrs = {};
    for (const [k, raw] of headers) {
      // As its UTF-8 bytes, as curl sends it (Node writes a header's characters as single bytes).
      const v = Buffer.from(String(raw), "utf8").toString("latin1");
      const key = Object.keys(hdrs).find((x) => x.toLowerCase() === k.toLowerCase()) || k;
      hdrs[key] = hdrs[key] === undefined ? v : [].concat(hdrs[key], v);
    }
    let req;
    try {
      req = mod.request({
        method, hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || undefined, path: u.pathname + u.search,
        headers: hdrs, agent: false, rejectUnauthorized: true,
      });
    } catch (err) {
      return reject(fail("usage", "the request isn't valid: " + (err.code || "bad header or URL")));
    }
    const left = deadline - Date.now();
    const timer = setTimeout(() => req.destroy(fail("failed", "timed out")), Math.max(1, left));
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof Error && err.kind ? err : fail("failed", `couldn't reach ${u.host}: ${err.code || "error"}`));
    });
    req.on("response", (res) => {
      const parts = [];
      let size = 0;
      let truncated = false;
      res.on("data", (d) => {
        if (truncated) return;
        const limit = BODY_CAP + slack;
        if (size + d.length > limit) {
          parts.push(d.subarray(0, limit - size));
          size = limit;
          truncated = true;
          res.destroy();
          done();
          return;
        }
        parts.push(d);
        size += d.length;
      });
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const raw = res.rawHeaders;
        const pairs = [];
        for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
        resolve({ status: res.statusCode, statusText: res.statusMessage || "", headers: pairs, body: Buffer.concat(parts), truncated, version: res.httpVersion });
      };
      res.on("end", done);
      res.on("error", () => (truncated ? done() : reject(fail("failed", "the answer broke off"))));
    });
    if (body !== null && body !== undefined) req.end(Buffer.from(body, "utf8"));
    else req.end();
  });
}

// One hop through the broker (it fills in the Protected secrets and redacts them).
async function sendBroker(req, timeoutMs, who, followRedirects) {
  const ans = await brokerRequest("http", {
    caller: who,
    request: {
      method: req.method, url: req.url, headers: req.headers,
      bodyB64: req.body === null || req.body === undefined ? null : Buffer.from(req.body, "utf8").toString("base64"),
      followRedirects, maxRedirects: 10, timeoutMs,
    },
  });
  return {
    status: ans.status, statusText: "", headers: ans.headers || [], body: Buffer.from(ans.bodyB64 || "", "base64"),
    truncated: !!ans.truncated, version: "1.1", finalUrl: ans.finalUrl, redirects: ans.redirects || 0,
    stripped: ans.stripped || 0, redacted: ans.redacted || 0,
  };
}

const latin = (b) => Buffer.from(b).toString("latin1");

export async function httpCommand(argv) {
  const o = parseHttpArgs(argv);
  const t = templates(o);
  const who = caller({ workspace: o.workspace, global: o.global });
  // A request that names a secret can't set the headers that change where or how it goes.
  const refusedHeader = t.headers.find(([k]) => headerRefused(k));
  if (refusedHeader && findPlaceholders(JSON.stringify(t)).length) {
    throw fail("usage", `a request with a secret can't set its own ${refusedHeader[0]} header`);
  }
  const where = (name) => ({
    inQuery: findPlaceholders(t.url).includes(name),
    inHeaders: t.headers.some(([, v]) => findPlaceholders(v).includes(name)),
    inBody: t.body !== null && findPlaceholders(t.body).includes(name),
  });
  const names = findPlaceholders([t.url, ...t.headers.map(([, v]) => v), t.body || ""].join("\n"));
  let firstHost = null;
  try { firstHost = new URL(t.url.replace(/\{\{secret:[^}]*\}\}/g, "x")).hostname; } catch { /* checked below */ }
  const use = { via: "http", target: firstHost, who };
  const found = lookup(names, who, use);
  const refuse = (err) => {
    noteAttempt(found, { ...use, why: err.kind === "refused" ? "refused" : "failed" });
    return err;
  };
  const protectedOnes = found.filter((f) => f.entry.tier === "protected");
  const values = standardValues(found);
  for (const [n, v] of Object.entries(values)) remember(n, v);
  // As byte strings: the answer is redacted as bytes.
  const standardSecrets = Object.entries(values).map(([name, value]) => ({ name, value: Buffer.from(value, "utf8").toString("latin1") }));
  const slack = capSlack(standardSecrets);
  const protectedNames = protectedOnes.map((f) => f.name);
  const fill = (s) => (s === null ? null : fillPlaceholders(s, values));
  // In the URL's query a value is percent-encoded, so it arrives as it is ("+" stays "+").
  const encoded = Object.fromEntries(Object.entries(values).map(([n, v]) => [n, encodeURIComponent(v)]));
  const req = { method: t.method, url: fillPlaceholders(t.url, encoded), headers: t.headers.map(([k, v]) => [k, fill(v)]), body: fill(t.body) };
  // Which header lines held a secret: they're the ones dropped on a redirect to another host.
  const secretHeader = t.headers.map(([, v]) => findPlaceholders(v).length > 0);

  if (found.length && !schemeAllowed(req.url)) throw refuse(fail("refused", "secrets go only over https (or http to this computer)"));
  for (const f of found) {
    if (f.entry.tier !== "standard") continue;
    try { checkStandardHost(f.entry, req.url); } catch (err) { throw refuse(err); }
  }

  const timeoutMs = Math.round(o.maxTime * 1000);
  const deadline = Date.now() + timeoutMs;
  let res;
  let redirects = 0;
  let stripped = 0;
  let brokerRedacted = 0;
  let note = "";
  let finalUrl = req.url;

  if (protectedOnes.length && !standardSecrets.length) {
    // All of it is the broker's, redirects too.
    res = await sendBroker(req, timeoutMs, who, o.follow);
    redirects = res.redirects;
    stripped = res.stripped;
    brokerRedacted = res.redacted;
    finalUrl = res.finalUrl || req.url;
  } else {
    // Standard (and a mix): redirects followed here, one hop at a time.
    const infos = found.map(({ name, entry }) => ({ name, value: values[name] || "", tier: entry.tier, hosts: entry.hosts, ...where(name) }));
    let cur = { ...req, headers: req.headers.slice() };
    let marks = secretHeader.slice();
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw fail("failed", "timed out");
      // A hop that still holds a Protected placeholder goes to the broker; one that doesn't (its
      // secret headers dropped on the way to another host) is sent from here.
      const held = findPlaceholders([cur.url, ...cur.headers.map(([, v]) => v), cur.body || ""].join("\n"));
      if (held.some((n) => protectedNames.includes(n))) res = await sendBroker(cur, left, who, false);
      else {
        try { res = await sendLocal(cur, deadline, slack); } catch (err) { throw refuse(err); }
      }
      brokerRedacted += res.redacted || 0;
      finalUrl = cur.url;
      const loc = res.headers.find(([k]) => k.toLowerCase() === "location");
      if (!o.follow || !loc || res.status < 300 || res.status > 399 || res.status === 304) break;
      if (redirects >= 10) { note = "not followed: more than 10 redirects"; break; }
      if (loc[1].includes("[secret:")) { note = "not followed: its Location held a secret"; break; }
      const step = redirectStep({ from: cur.url, to: loc[1], status: res.status, secrets: infos, method: cur.method, origin: req.url });
      if (!step.follow) { note = "not followed: " + step.why.replace(/^not following /, ""); break; }
      let headers = cur.headers;
      if (step.stripSecretHeaders) {
        const keep = [];
        const keepMarks = [];
        headers.forEach((h, i) => { if (marks[i]) stripped++; else { keep.push(h); keepMarks.push(false); } });
        headers = keep;
        marks = keepMarks;
        for (const s of infos) s.inHeaders = false;
      }
      let body = cur.body;
      if (!step.keepBody) {
        body = null;
        const keep = [];
        const keepMarks = [];
        headers.forEach((h, i) => { if (!/^content-(type|length)$/i.test(h[0])) { keep.push(h); keepMarks.push(marks[i]); } });
        headers = keep;
        marks = keepMarks;
        for (const s of infos) s.inBody = false;
      }
      for (const s of infos) s.inQuery = false;
      cur = { method: step.method === "GET" ? "GET" : cur.method, url: step.url, headers, body };
      redirects++;
    }
  }

  // Redact the Standard values here (the broker did the Protected ones).
  let count = brokerRedacted;
  const red = (s) => {
    const r = redact(s, standardSecrets, { bytes: true });
    count += r.count;
    return r.text;
  };
  let bodyText;
  if (res.body.length > BODY_CAP) {
    const c = capBody(latin(res.body), BODY_CAP, standardSecrets);
    count += c.count;
    bodyText = c.text;
    res.truncated = true;
  } else bodyText = red(latin(res.body));
  const body = Buffer.from(bodyText, "latin1");
  const statusText = red(res.statusText || "");
  const headerLines = res.headers.map(([k, v]) => `${red(k)}: ${red(v)}`);
  red(finalUrl || "");

  await noteUse(found, { via: "http", target: firstHost, who });

  const notes = [`HTTP ${res.status}`];
  if (redirects) notes.push(`redirected ${redirects}`);
  if (stripped) notes.push("secret headers dropped");
  if (note) notes.push(note);
  if (count) notes.push(`${count} redaction${count === 1 ? "" : "s"}`);
  if (res.truncated) notes.push("body cut at 16 MB");
  const failed = o.failOnError && res.status >= 400;
  if (!o.silent || failed) process.stderr.write(notes.join(" · ") + "\n");
  if (failed) return 22;
  const out = [];
  if (o.include) out.push(Buffer.from(`HTTP/${res.version || "1.1"} ${res.status}${statusText ? " " + statusText : ""}\r\n${headerLines.map((l) => l + "\r\n").join("")}\r\n`, "latin1"));
  out.push(body);
  const all = Buffer.concat(out);
  if (o.output) fs.writeFileSync(o.output, all, { mode: 0o600 });
  else await new Promise((r) => process.stdout.write(all, r));
  return 0;
}

