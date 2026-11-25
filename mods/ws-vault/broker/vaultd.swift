// herdr-ws-vaultd: the Herdr Vault "Protected" broker (macOS).
//
// What it is: a small program that keeps Protected secrets in the Keychain, one generic-password
// item each, under an access list that trusts only this exact binary. Agents never get a value.
// They ask the broker, over a Unix socket only the same user can reach, to *use* a secret: send
// an HTTP request with it, or run one pinned command with it in the environment or in a file.
// The broker checks the policy kept inside the Keychain item (never one on disk, never one a
// caller sends), does the work, and hands back the result with every form of every secret it
// used replaced by `[secret:<name>]`.
//
// The invariant: no answer ever carries a value, in any form. There is no `get` op, and there
// is nothing that prints, exports or reveals one. `migrate` to Standard returns the value only
// sealed (AES-256-GCM) under the Standard tier's key, after the person allowed it.
//
// Things that widen what a secret may be used for (a new host, CLI use, a new command, shells,
// a later expiry, moving to Standard, letting an automation use it) are shown to the person in a
// native macOS dialog first. Anything but "Allow" is a no.
//
// Commands it refuses to run with a secret, unless the entry has allowShells (they run whatever
// they are told, so a pinned shell would be no pin at all):
//   shells and interpreters: sh bash zsh fish dash ksh csh tcsh node deno bun python python2
//                            python3 python3.x ruby perl php lua osascript
//                            (and versioned names like perl5.34, ruby3.3, node22)
//   wrappers that run something else: env xargs sudo nice nohup time command exec eval make awk
//                            (and gawk, mawk, nawk) arch caffeinate xcrun script timeout gtimeout
//                            find ssh npx uvx pipx bunx swift tclsh expect pwsh Rscript java open
//                            watch parallel git busybox
// A pinned command runs in an environment built fresh (its own folder and the system folders on
// PATH, the user's HOME/USER/LOGNAME/SHELL, the broker's TMPDIR, the caller's locale and TERM, the
// secrets), never with what else the caller sent; it does get the agent's arguments and folder.
// An automation (a shell script the person allowed once in the dialog, by its exact text and the
// folder it runs in) may run `sh`, `bash` or `zsh -c <script>` from /bin; a changed script or
// folder asks again. It runs with the PATH it was allowed with, in an environment built fresh
// from a short list (never what else the caller sent), and zsh with -f (no ~/.zshenv).
//
// Protocol: one JSON request a line, one JSON answer a line, on <vault dir>/broker.sock (0600).
// The vault dir is $HERDR_VAULT_DIR, else $HOME/.herdr/vault. Nothing read from it is trusted.
//
// Build only with build.sh (compile, ad-hoc sign with the hardened runtime, verify). A test build
// (`-D VAULTD_TEST`) uses a throwaway keychain, its own Keychain service, answers dialogs from
// VAULTD_TEST_CONFIRM and never shows one; the normal build has no switch that weakens it.

import CoreFoundation
import CryptoKit
import Darwin
import Foundation
import Security

let vaultdVersion = "1.0.0"
let protocolVersion = 1

#if VAULTD_TEST
let isTestBuild = true
let keychainService = "dev.herdr.ws-vault.protected.test"
#else
let isTestBuild = false
let keychainService = "dev.herdr.ws-vault.protected"
#endif

// MARK: - Errors and small helpers

struct VaultError: Error {
    let kind: String
    let message: String
}

func badRequest(_ m: String) -> VaultError { VaultError(kind: "bad_request", message: m) }
func notFound(_ m: String) -> VaultError { VaultError(kind: "not_found", message: m) }
func expiredError(_ m: String) -> VaultError { VaultError(kind: "expired", message: m) }
func refused(_ m: String) -> VaultError { VaultError(kind: "refused", message: m) }
func denied(_ m: String) -> VaultError { VaultError(kind: "denied", message: m) }
func keychainError(_ m: String, _ status: OSStatus) -> VaultError {
    let text = (SecCopyErrorMessageString(status, nil) as String?) ?? "status \(status)"
    return VaultError(kind: "keychain", message: "\(m): \(text) (\(status))")
}
func failed(_ m: String) -> VaultError { VaultError(kind: "failed", message: m) }

typealias JSON = [String: Any]

func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

func logLine(_ s: String) {
    FileHandle.standardError.write(Data("vaultd: \(s)\n".utf8))
}

func isBool(_ v: Any?) -> Bool {
    guard let n = v as? NSNumber else { return false }
    return CFGetTypeID(n) == CFBooleanGetTypeID()
}

func boolValue(_ v: Any?) -> Bool? { isBool(v) ? (v as! NSNumber).boolValue : nil }

// A JSON number that is a whole millisecond count (or nil for anything else).
func wholeNumber(_ v: Any?) -> Int64? {
    guard let n = v as? NSNumber, !isBool(n) else { return nil }
    let d = n.doubleValue
    guard d.isFinite, d == d.rounded(), abs(d) < 9.0e15 else { return nil }
    return Int64(d)
}

func base64(_ b: [UInt8]) -> String { Data(b).base64EncodedString() }
func unbase64(_ s: String) -> [UInt8]? { Data(base64Encoded: s).map { [UInt8]($0) } }

func hexString(_ b: [UInt8], upper: Bool = false) -> String {
    let digits = Array((upper ? "0123456789ABCDEF" : "0123456789abcdef").utf8)
    var out = [UInt8]()
    out.reserveCapacity(b.count * 2)
    for x in b { out.append(digits[Int(x >> 4)]); out.append(digits[Int(x & 15)]) }
    return String(decoding: out, as: UTF8.self)
}

func sha256Hex(_ b: [UInt8]) -> String { hexString(Array(SHA256.hash(data: b))) }

func basename(_ p: String) -> String { (p as NSString).lastPathComponent }

func realPath(_ p: String) -> String? {
    guard let r = realpath(p, nil) else { return nil }
    defer { free(r) }
    return String(cString: r)
}

func isExecutableFile(_ p: String) -> Bool {
    var st = stat()
    guard stat(p, &st) == 0, (st.st_mode & S_IFMT) == S_IFREG else { return false }
    return access(p, X_OK) == 0
}

// Text that is safe to show in a dialog or a log: no control characters, cut to a length.
func printable(_ s: String, max: Int) -> String {
    var out = String(s.unicodeScalars.map { $0.properties.generalCategory == .control && $0 != "\n" ? "·" : Character($0) })
    if out.count > max { out = String(out.prefix(max)) + "…" }
    return out
}

func charsAll(_ s: String, _ ok: (UInt8) -> Bool) -> Bool { s.utf8.allSatisfy(ok) }
func isLowerAlnum(_ c: UInt8) -> Bool { (c >= 97 && c <= 122) || (c >= 48 && c <= 57) }
func isAlnum(_ c: UInt8) -> Bool { isLowerAlnum(c) || (c >= 65 && c <= 90) }

// MARK: - Names, scopes, hosts

// `^[a-z0-9][a-z0-9._-]{0,63}$`
func validName(_ s: String) -> Bool {
    let b = Array(s.utf8)
    guard (1...64).contains(b.count), isLowerAlnum(b[0]) else { return false }
    return b.allSatisfy { isLowerAlnum($0) || $0 == 46 || $0 == 95 || $0 == 45 }
}

// A workspace id is a folder name: letters, digits, `.`, `_`, `-`, not starting with `.` or `-`.
func validWorkspaceId(_ s: String) -> Bool {
    let b = Array(s.utf8)
    guard (1...128).contains(b.count), isAlnum(b[0]) || b[0] == 95 else { return false }
    return b.allSatisfy { isAlnum($0) || $0 == 46 || $0 == 95 || $0 == 45 }
}

func validScope(_ s: String) -> Bool {
    if s == "global" { return true }
    return s.hasPrefix("ws:") && validWorkspaceId(String(s.dropFirst(3)))
}

func validEnvName(_ s: String) -> Bool {
    let b = Array(s.utf8)
    guard (1...128).contains(b.count), !(b[0] >= 48 && b[0] <= 57) else { return false }
    return b.allSatisfy { isAlnum($0) || $0 == 95 }
}

// Variables a secret may not be bound to: they change how a program starts or what it runs
// (a key file as BASH_ENV is sourced as a script, and its lines come back in error messages).
let refusedBindingNames: Set<String> = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TERM", "LANG", "TZ", "IFS",
                                        "ENV", "BASH_ENV", "ZDOTDIR", "SHELLOPTS", "BASHOPTS", "PS4", "PROMPT_COMMAND", "CDPATH",
                                        "GLOBIGNORE", "EDITOR", "VISUAL", "PAGER", "BROWSER", "NODE_OPTIONS", "NODE_PATH", "PERLLIB"]
let refusedBindingPrefixes = ["LC_", "PYTHON", "PERL5", "RUBY", "LD_", "DYLD_", "GIT_", "BASH_FUNC_", "HERDR_"]

func validBindingName(_ s: String) -> Bool {
    validEnvName(s) && !refusedBindingNames.contains(s) && !refusedBindingPrefixes.contains(where: { s.hasPrefix($0) })
        && !s.hasSuffix("_ASKPASS")
}

let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]

// A host as a URL gives it: lower case, no brackets around IPv6, no trailing dot.
func normalHost(_ h: String) -> String {
    var s = h.lowercased()
    if s.hasPrefix("["), s.hasSuffix("]") { s = String(s.dropFirst().dropLast()) }
    while s.hasSuffix(".") { s.removeLast() }
    return s
}

struct HostPattern {
    let host: String      // without `*.`, brackets removed
    let wildcard: Bool    // `*.suffix`: subdomains only, not the apex
    let port: Int?        // nil: any port
}

// Parses `host`, `host:port`, `*.suffix`, `*.suffix:port`, `[v6]`, `[v6]:port`; nil when malformed.
func parseHostPattern(_ raw: String) -> HostPattern? {
    let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
    guard !s.isEmpty, s.utf8.count <= 270 else { return nil }
    if !s.hasPrefix("[") {
        // Every trailing dot of the host goes (before a port too: `example.com.:8443`).
        var hostText = s, portPart = ""
        if let colon = s.lastIndex(of: ":") { hostText = String(s[..<colon]); portPart = String(s[colon...]) }
        if hostText.hasSuffix(".") {
            while hostText.hasSuffix(".") { hostText.removeLast() }
            return hostText.isEmpty ? nil : parseHostPattern(hostText + portPart)
        }
    }
    var host = s
    var portText: String?
    if s.hasPrefix("[") {
        guard let close = s.firstIndex(of: "]") else { return nil }
        host = String(s[s.index(after: s.startIndex)..<close])
        let rest = String(s[s.index(after: close)...])
        if !rest.isEmpty {
            guard rest.hasPrefix(":") else { return nil }
            portText = String(rest.dropFirst())
        }
        guard !host.isEmpty, charsAll(host, { isLowerAlnum($0) || $0 == 58 || $0 == 46 }), host.contains(":") else { return nil }
        return portOK(portText).map { HostPattern(host: host, wildcard: false, port: $0) } ?? nil
    }
    if let colon = s.lastIndex(of: ":") {
        host = String(s[..<colon])
        portText = String(s[s.index(after: colon)...])
    }
    var wildcard = false
    if host.hasPrefix("*.") { wildcard = true; host = String(host.dropFirst(2)) }
    guard !host.isEmpty, !host.contains(":") else { return nil }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    // `*.com` would cover a whole top-level domain, and a bare `com` or `intranet` almost nothing
    // a person means: a wildcard needs two labels after it, a bare name must be localhost.
    if wildcard && labels.count < 2 { return nil }
    if !wildcard && labels.count < 2 && host != "localhost" { return nil }
    for label in labels {
        guard !label.isEmpty, label.utf8.count <= 63,
              label.utf8.allSatisfy({ isLowerAlnum($0) || $0 == 45 || $0 == 95 }) else { return nil }
    }
    guard let port = portOK(portText) else { return nil }
    return HostPattern(host: host, wildcard: wildcard, port: port)
}

// nil text → .some(nil) (any port); a valid port → .some(n); anything else → nil.
func portOK(_ t: String?) -> Int?? {
    guard let t = t else { return .some(nil) }
    guard !t.isEmpty, t.utf8.count <= 5, charsAll(t, { $0 >= 48 && $0 <= 57 }), let n = Int(t), (1...65535).contains(n) else { return nil }
    return .some(n)
}

func canonicalPattern(_ p: HostPattern) -> String {
    var h = p.host.contains(":") ? "[\(p.host)]" : p.host
    if p.wildcard { h = "*." + h }
    if let port = p.port { h += ":\(port)" }
    return h
}

func hostMatches(_ patterns: [String], host rawHost: String, port: Int) -> Bool {
    let host = normalHost(rawHost)
    for text in patterns {
        guard let p = parseHostPattern(text) else { continue }
        if let want = p.port, want != port { continue }
        if p.wildcard {
            if host.hasSuffix("." + p.host) { return true }
        } else if host == p.host {
            return true
        }
    }
    return false
}

// MARK: - Shells and interpreters

let refusedShells: Set<String> = ["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "node", "deno", "bun",
                                  "python", "python2", "python3", "ruby", "perl", "php", "lua", "osascript"]
let refusedWrappers: Set<String> = ["env", "xargs", "sudo", "nice", "nohup", "time", "command", "exec", "eval", "make",
                                    "awk", "gawk", "mawk", "nawk", "arch", "caffeinate", "xcrun", "script", "timeout",
                                    "gtimeout", "find", "ssh", "npx", "uvx", "pipx", "bunx", "swift", "tclsh", "expect",
                                    "pwsh", "rscript", "java", "open", "watch", "parallel", "git", "busybox"]

func isShellName(_ raw: String) -> Bool {
    let n = basename(raw).lowercased()
    if refusedShells.contains(n) || refusedWrappers.contains(n) { return true }
    // Versioned interpreters: python3.12, perl5.34, ruby3.3, node22, php8.3, lua5.4, …
    for stem in ["python", "perl", "ruby", "php", "lua", "node"] where n.hasPrefix(stem) {
        let rest = n.dropFirst(stem.count)
        if let first = rest.utf8.first, first >= 48 && first <= 57,
           rest.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || $0 == 46 }) { return true }
    }
    return false
}

// MARK: - The policy kept inside each Keychain item

struct PinnedCommand: Equatable {
    var name: String
    var path: String
}

// An automation the person allowed: its id, the sha256 of its argv and folder, and the PATH and
// folder it was allowed with. Later runs use this PATH, never the caller's.
struct Grant: Equatable {
    var kind: String
    var id: String
    var sha256: String
    var path: String
    var cwd: String
}

struct Policy: Equatable {
    var name: String
    var scope: String
    var mode: String           // "http" | "http+cli"
    var hosts: [String]
    var commands: [PinnedCommand]
    var allowShells: Bool
    var grants: [Grant]
    var createdAt: Int64
    var updatedAt: Int64
    var expiresAt: Int64?
    var lastUsedAt: Int64?
    var lastUsedBy: String?
    var lastUsedFor: String?
    var note: String

    var key: String { scope + "/" + name }

    func isExpired(_ now: Int64) -> Bool { expiresAt.map { $0 <= now } ?? false }

    func json(tier: String?) -> JSON {
        var d: JSON = [
            "name": name, "scope": scope, "mode": mode, "hosts": hosts,
            "commands": commands.map { ["name": $0.name, "path": $0.path] },
            "allowShells": allowShells,
            "grants": grants.map { ["kind": $0.kind, "id": $0.id, "sha256": $0.sha256, "path": $0.path, "cwd": $0.cwd] },
            "createdAt": NSNumber(value: createdAt), "updatedAt": NSNumber(value: updatedAt),
            "expiresAt": expiresAt.map { NSNumber(value: $0) } ?? NSNull(),
            "lastUsedAt": lastUsedAt.map { NSNumber(value: $0) } ?? NSNull(),
            "lastUsedBy": lastUsedBy ?? NSNull(),
            "lastUsedFor": lastUsedFor ?? NSNull(),
            "note": note,
        ]
        if let tier = tier { d["tier"] = tier }
        return d
    }

    // Reads a policy back from an item's JSON; nil when it isn't one of ours.
    static func parse(_ d: JSON) -> Policy? {
        guard let name = d["name"] as? String, validName(name),
              let scope = d["scope"] as? String, validScope(scope),
              let mode = d["mode"] as? String, mode == "http" || mode == "http+cli" else { return nil }
        let hosts = (d["hosts"] as? [String]) ?? []
        let commands = ((d["commands"] as? [JSON]) ?? []).compactMap { c -> PinnedCommand? in
            guard let n = c["name"] as? String, let p = c["path"] as? String else { return nil }
            return PinnedCommand(name: n, path: p)
        }
        let grants = ((d["grants"] as? [JSON]) ?? []).compactMap { g -> Grant? in
            guard let k = g["kind"] as? String, let i = g["id"] as? String, let s = g["sha256"] as? String,
                  let p = g["path"] as? String, let c = g["cwd"] as? String else { return nil }
            return Grant(kind: k, id: i, sha256: s, path: p, cwd: c)
        }
        return Policy(name: name, scope: scope, mode: mode, hosts: hosts, commands: commands,
                      allowShells: boolValue(d["allowShells"]) ?? false, grants: grants,
                      createdAt: wholeNumber(d["createdAt"]) ?? 0, updatedAt: wholeNumber(d["updatedAt"]) ?? 0,
                      expiresAt: wholeNumber(d["expiresAt"]), lastUsedAt: wholeNumber(d["lastUsedAt"]),
                      lastUsedBy: d["lastUsedBy"] as? String, lastUsedFor: d["lastUsedFor"] as? String,
                      note: (d["note"] as? String) ?? "")
    }

    // The Protected rules: HTTP only needs a host; HTTP + CLI needs a host or a command.
    func check() throws {
        if mode == "http" && hosts.isEmpty { throw badRequest("an HTTP-only Protected secret needs at least one allowed host") }
        if mode == "http" && !commands.isEmpty { throw badRequest("commands need mode http+cli") }
        if mode == "http+cli" && hosts.isEmpty && commands.isEmpty {
            throw badRequest("an HTTP + CLI Protected secret needs at least one allowed host or command")
        }
    }
}

// MARK: - Reading what a caller sends

struct Caller {
    var ws: String?
    var agent: String?
    var terminal: String?

    init(_ v: Any?) {
        let d = v as? JSON ?? [:]
        ws = (d["ws"] as? String).flatMap { validWorkspaceId($0) ? $0 : nil }
        agent = (d["agent"] as? String).map { printable($0, max: 64) }
        terminal = (d["terminal"] as? String).map { printable($0, max: 64) }
    }

    var who: String? { agent ?? terminal }
}

func requireString(_ d: JSON, _ k: String) throws -> String {
    guard let s = d[k] as? String else { throw badRequest("`\(k)` must be a string") }
    return s
}

func requireNameScope(_ d: JSON) throws -> (String, String) {
    let name = try requireString(d, "name"), scope = try requireString(d, "scope")
    guard validName(name) else { throw badRequest("`name` must match ^[a-z0-9][a-z0-9._-]{0,63}$") }
    guard validScope(scope) else { throw badRequest("`scope` must be \"global\" or \"ws:<workspace id>\"") }
    return (name, scope)
}

func readHosts(_ v: Any?) throws -> [String] {
    guard let list = v as? [Any] else { throw badRequest("`hosts` must be a list of host patterns") }
    var out = [String]()
    for item in list {
        guard let s = item as? String, let p = parseHostPattern(s) else {
            throw badRequest("`hosts` has a pattern that isn't host, host:port or *.suffix")
        }
        let c = canonicalPattern(p)
        if !out.contains(c) { out.append(c) }
    }
    return out
}

// Pins each command to an absolute path: a name is looked up on the caller's PATH now, once;
// a path is kept as given. A bare name that is already pinned keeps the path it has.
func pinCommands(_ v: Any?, searchPath: String?, existing: [PinnedCommand]) throws -> [PinnedCommand] {
    guard let list = v as? [Any] else { throw badRequest("`commands` must be a list of names or absolute paths") }
    var out = [PinnedCommand]()
    for item in list {
        var text: String?
        if let s = item as? String { text = s } else if let o = item as? JSON { text = (o["path"] as? String) ?? (o["name"] as? String) }
        guard let c = text, !c.isEmpty, c.utf8.count <= 1024, !c.contains("\0") else { throw badRequest("`commands` has an empty or odd entry") }
        let pinned: PinnedCommand
        if c.contains("/") {
            guard c.hasPrefix("/") else { throw badRequest("a command path must be absolute") }
            let path = (c as NSString).standardizingPath
            guard isExecutableFile(path) else { throw badRequest("\(printable(path, max: 200)) is not an executable file") }
            pinned = PinnedCommand(name: basename(path), path: path)
        } else if let known = existing.first(where: { $0.name == c }) {
            pinned = known
        } else {
            guard charsAll(c, { isAlnum($0) || $0 == 46 || $0 == 95 || $0 == 45 || $0 == 43 }) else {
                throw badRequest("a command name may hold only letters, digits, . _ - +")
            }
            var found: String?
            for dir in (searchPath ?? "").split(separator: ":").map(String.init) where dir.hasPrefix("/") {
                let candidate = (dir as NSString).appendingPathComponent(c)
                if isExecutableFile(candidate) { found = (candidate as NSString).standardizingPath; break }
            }
            guard let path = found else { throw badRequest("\(c) was not found on the PATH that was sent") }
            pinned = PinnedCommand(name: c, path: path)
        }
        if !out.contains(pinned) { out.append(pinned) }
    }
    return out
}

func readExpiry(_ v: Any?) throws -> Int64? {
    if v == nil || v is NSNull { return nil }
    guard let n = wholeNumber(v), n > 0 else { throw badRequest("`expiresAt` must be milliseconds or null") }
    return n
}

func readNote(_ v: Any?) throws -> String {
    if v == nil || v is NSNull { return "" }
    guard let s = v as? String else { throw badRequest("`note` must be a string") }
    return printable(s, max: 500)
}

// MARK: - The Keychain

final class Store {
    let keychain: SecKeychain
    let lock = NSLock()

    init(keychain: SecKeychain) { self.keychain = keychain }

    struct Item {
        let policy: Policy
        let value: [UInt8]
        let ref: SecKeychainItem
    }

    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    // Every account (entry key) under our service. Attributes only: no item data is read.
    func accounts() throws -> [String] {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
            kSecMatchSearchList as String: [keychain],
        ]
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound { return [] }
        guard st == errSecSuccess else { throw keychainError("listing the Keychain failed", st) }
        let rows = (out as? [[String: Any]]) ?? []
        return rows.compactMap { $0[kSecAttrAccount as String] as? String }.sorted()
    }

    func find(_ key: String) throws -> Item? {
        var len: UInt32 = 0
        var data: UnsafeMutableRawPointer?
        var ref: SecKeychainItem?
        let st = SecKeychainFindGenericPassword(keychain, UInt32(keychainService.utf8.count), keychainService,
                                                UInt32(key.utf8.count), key, &len, &data, &ref)
        if st == errSecItemNotFound { return nil }
        guard st == errSecSuccess, let bytes = data, let item = ref else { throw keychainError("reading \(key) failed", st) }
        let raw = Data(bytes: bytes, count: Int(len))
        SecKeychainItemFreeContent(nil, bytes)
        guard let obj = try? JSONSerialization.jsonObject(with: raw) as? JSON, wholeNumber(obj["v"]) == 1,
              let pd = obj["policy"] as? JSON, let policy = Policy.parse(pd), policy.key == key,
              let vb = obj["value"] as? String, let value = unbase64(vb) else {
            throw VaultError(kind: "keychain", message: "the Keychain item for \(key) isn't one this broker wrote")
        }
        return Item(policy: policy, value: value, ref: item)
    }

    func all() throws -> [Item] {
        try accounts().compactMap { key in
            do { return try find(key) } catch let e as VaultError { logLine("skipping \(key): \(e.message)"); return nil }
        }
    }

    static func encode(_ policy: Policy, _ value: [UInt8]) throws -> [UInt8] {
        let obj: JSON = ["v": 1, "policy": policy.json(tier: nil), "value": base64(value)]
        return [UInt8](try JSONSerialization.data(withJSONObject: obj))
    }

    // A new item whose access list trusts only this binary.
    func create(_ policy: Policy, _ value: [UInt8]) throws {
        let data = try Store.encode(policy, value)
        var app: SecTrustedApplication?
        var st = SecTrustedApplicationCreateFromPath(nil, &app)
        guard st == errSecSuccess, let me = app else { throw keychainError("trusting this broker failed", st) }
        var access: SecAccess?
        let label = "Herdr Secrets: \(policy.name)"
        st = SecAccessCreate(label as CFString, [me] as CFArray, &access)
        guard st == errSecSuccess, let acl = access else { throw keychainError("making the access list failed", st) }
        let service = keychainService, account = policy.key
        var item: SecKeychainItem?
        st = service.withCString { s in account.withCString { a in label.withCString { l in
            var attrs = [
                SecKeychainAttribute(tag: SecItemAttr.serviceItemAttr.rawValue, length: UInt32(strlen(s)), data: UnsafeMutableRawPointer(mutating: s)),
                SecKeychainAttribute(tag: SecItemAttr.accountItemAttr.rawValue, length: UInt32(strlen(a)), data: UnsafeMutableRawPointer(mutating: a)),
                SecKeychainAttribute(tag: SecItemAttr.labelItemAttr.rawValue, length: UInt32(strlen(l)), data: UnsafeMutableRawPointer(mutating: l)),
            ]
            return attrs.withUnsafeMutableBufferPointer { buf -> OSStatus in
                var list = SecKeychainAttributeList(count: UInt32(buf.count), attr: buf.baseAddress)
                return data.withUnsafeBytes { d in
                    SecKeychainItemCreateFromContent(SecItemClass.genericPasswordItemClass, &list, UInt32(d.count), d.baseAddress, keychain, acl, &item)
                }
            }
        }}}
        guard st == errSecSuccess else { throw keychainError("saving \(account) failed", st) }
    }

    // Rewrites an item's data in place; its access list stays as it is.
    func update(_ item: Item, _ policy: Policy) throws {
        let data = try Store.encode(policy, item.value)
        let st = data.withUnsafeBytes { d in SecKeychainItemModifyAttributesAndData(item.ref, nil, UInt32(d.count), d.baseAddress) }
        guard st == errSecSuccess else { throw keychainError("updating \(policy.key) failed", st) }
    }

    func delete(_ item: Item) throws {
        let st = SecKeychainItemDelete(item.ref)
        guard st == errSecSuccess else { throw keychainError("deleting \(item.policy.key) failed", st) }
    }

    // A caller in workspace W gets ws:W/<name> first, then global/<name>.
    func resolve(_ name: String, ws: String?) throws -> Item? {
        if let ws = ws, let hit = try find("ws:\(ws)/\(name)") { return hit }
        return try find("global/\(name)")
    }
}

// MARK: - The person's OK

let dialogLock = NSLock()
let appendLock = NSLock()

func appendLine(_ path: String, _ obj: JSON) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    appendLock.lock()
    defer { appendLock.unlock() }
    let fd = open(path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { logLine("can't append to \(path): \(String(cString: strerror(errno)))"); return }
    defer { close(fd) }
    let line = [UInt8](data) + [10]
    _ = line.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
}

// Asks the person. Anything but "Allow" (Don't Allow, closing it, 60 s passing) is a no.
func confirm(kind: String, keys: [String], title: String, lines: [String]) -> Bool {
    #if VAULTD_TEST
    // The test build never shows a dialog: it answers from VAULTD_TEST_CONFIRM (unset is a no)
    // and writes down what it would have asked.
    let testEnv = ProcessInfo.processInfo.environment
    let answer = testEnv["VAULTD_TEST_CONFIRM"] == "allow"
    // VAULTD_TEST_CONFIRM_DELAY_MS: how long the stand-in dialog "shows", so a test can change
    // things while it does.
    if let ms = testEnv["VAULTD_TEST_CONFIRM_DELAY_MS"].flatMap({ UInt32($0) }), ms > 0 { usleep(min(ms, 10_000) * 1000) }
    appendLine(vaultDir + "/test-confirms.jsonl", ["at": NSNumber(value: nowMs()), "kind": kind, "keys": keys,
                                                   "title": title, "what": lines, "answer": answer ? "allow" : "deny"])
    return answer
    #else
    dialogLock.lock()
    defer { dialogLock.unlock() }
    var flags: CFOptionFlags = 0
    let message = lines.joined(separator: "\n")
    let rc = CFUserNotificationDisplayAlert(60, CFOptionFlags(kCFUserNotificationCautionAlertLevel), nil, nil, nil,
                                            title as CFString, message as CFString,
                                            "Don't Allow" as CFString, "Allow" as CFString, nil, &flags)
    let allowed = rc == 0 && (flags & 0x3) == CFOptionFlags(kCFUserNotificationAlternateResponse)
    logLine("\(kind) for \(keys.joined(separator: ", ")): \(allowed ? "allowed" : "not allowed")")
    return allowed
    #endif
}

func scopeLabel(_ scope: String) -> String { scope == "global" ? "every workspace" : "workspace \(scope.dropFirst(3))" }

// MARK: - Usage lines

// A use that didn't go through also says why, in one word (the error's kind; any kind but
// refused, expired or denied counts as failed). Never the message.
func logUse(_ p: Policy, via: String, target: String, caller: Caller, ok: Bool, why: String = "failed") {
    var line: JSON = [
        "at": NSNumber(value: nowMs()), "name": p.name, "scope": p.scope, "tier": "protected", "via": via,
        "target": target, "ws": caller.ws ?? NSNull(), "agent": caller.agent ?? NSNull(),
        "terminal": caller.terminal ?? NSNull(), "ok": ok,
    ]
    if !ok { line["why"] = ["refused", "expired", "denied"].contains(why) ? why : "failed" }
    appendLine(vaultDir + "/usage.jsonl", line)
}

// Notes the last use inside the item (the CLI mirrors it into meta.json).
func noteUse(_ keys: [String], target: String, caller: Caller) {
    store.withLock {
        for key in keys {
            guard let item = try? store.find(key) else { continue }
            var p = item.policy
            p.lastUsedAt = nowMs(); p.lastUsedBy = caller.who; p.lastUsedFor = target
            do { try store.update(item, p) } catch let e as VaultError { logLine("noting use of \(key): \(e.message)") } catch {}
        }
    }
}

// MARK: - Redaction

let unreservedBytes: Set<UInt8> = Set(Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~".utf8))
let uriComponentBytes: Set<UInt8> = unreservedBytes.union(Array("!'()*".utf8))

func percentEncode(_ v: [UInt8], keep: Set<UInt8>, upper: Bool, plusForSpace: Bool = false) -> [UInt8] {
    let digits = Array((upper ? "0123456789ABCDEF" : "0123456789abcdef").utf8)
    var out = [UInt8]()
    for b in v {
        if keep.contains(b) { out.append(b) }
        else if plusForSpace && b == 32 { out.append(43) }
        else { out += [37, digits[Int(b >> 4)], digits[Int(b & 15)]] }
    }
    return out
}

// The JSON string form of a value (without the quotes): `"` `\\` and control characters escaped
// as JSON.stringify does, and optionally `/` as `\/` (PHP's default).
func jsonEscaped(_ v: [UInt8], slash: Bool) -> [UInt8] {
    let digits = Array("0123456789abcdef".utf8)
    var out = [UInt8]()
    for b in v {
        switch b {
        case 34: out += [92, 34]
        case 92: out += [92, 92]
        case 47 where slash: out += [92, 47]
        case 8: out += [92, 98]
        case 12: out += [92, 102]
        case 10: out += [92, 110]
        case 13: out += [92, 114]
        case 9: out += [92, 116]
        case 0..<32: out += Array("\\u00".utf8) + [digits[Int(b >> 4)], digits[Int(b & 15)]]
        default: out.append(b)
        }
    }
    return out
}

// Every form of a value the broker looks for (the same list as vaultfacts.js): exact;
// percent-encoded as encodeURIComponent does and with only unreserved characters kept, each
// with upper- and lower-case hex and with `+` for a space; base64 and base64url, with and
// without padding; hex in both cases; the JSON string form, with `/` escaped and not; and for
// a value with line breaks, each line with 8 letters or digits by itself. Under 6 bytes: exact only.
func secretForms(_ v: [UInt8]) -> [[UInt8]] {
    var forms: [[UInt8]] = [v]
    if v.count >= 6 {
        for keep in [uriComponentBytes, unreservedBytes] {
            for upper in [true, false] {
                forms.append(percentEncode(v, keep: keep, upper: upper))
                forms.append(percentEncode(v, keep: keep, upper: upper, plusForSpace: true))
            }
        }
        let std = base64(v)
        let url = std.replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        for s in [std, url] {
            forms.append(Array(s.utf8))
            forms.append(Array(s.trimmingCharacters(in: CharacterSet(charactersIn: "=")).utf8))
        }
        forms.append(Array(hexString(v).utf8))
        forms.append(Array(hexString(v, upper: true).utf8))
        forms.append(jsonEscaped(v, slash: false))
        forms.append(jsonEscaped(v, slash: true))
        if v.contains(10) || v.contains(13) {
            for line in v.split(separator: 10, omittingEmptySubsequences: true) {
                var l = Array(line)
                if l.last == 13 { l.removeLast() }
                // Only a line with 8 letters or digits: a line of dashes, spaces or a short
                // `-----END …-----` armour line would mangle other output.
                if l.filter(isAlnum).count >= 8 { forms.append(l) }
            }
        }
    }
    var seen = Set<[UInt8]>()
    return forms.filter { !$0.isEmpty && seen.insert($0).inserted }
}

struct Redactor {
    private var forms: [(bytes: [UInt8], label: [UInt8])] = []
    private var byFirst = [[Int]](repeating: [], count: 256)

    init(_ secrets: [(name: String, value: [UInt8])]) {
        for s in secrets {
            let label = Array("[secret:\(s.name)]".utf8)
            for f in secretForms(s.value) { forms.append((f, label)) }
        }
        forms.sort { $0.bytes.count > $1.bytes.count }   // longest first, so a form inside another can't split it
        for (i, f) in forms.enumerated() { byFirst[Int(f.bytes[0])].append(i) }
    }

    // The longest form: how far past a cap to read so a value at the cut is still caught whole.
    var longest: Int { forms.first?.bytes.count ?? 0 }

    // Redacts `b`. With `limit`, the output holds only what starts before `limit` (a form that
    // starts before it and runs past it is still replaced whole), so a cut never splits a value.
    func apply(_ b: [UInt8], limit: Int? = nil) -> (out: [UInt8], count: Int) {
        let n = min(b.count, limit ?? b.count)
        if forms.isEmpty || b.isEmpty { return (Array(b.prefix(n)), 0) }
        var out = [UInt8]()
        out.reserveCapacity(n)
        var count = 0, i = 0
        b.withUnsafeBufferPointer { buf in
            outer: while i < n {
                for idx in byFirst[Int(buf[i])] {
                    let f = forms[idx].bytes
                    if i + f.count <= b.count {
                        var same = true
                        var k = 1
                        while k < f.count { if buf[i + k] != f[k] { same = false; break }; k += 1 }
                        if same { out += forms[idx].label; count += 1; i += f.count; continue outer }
                    }
                }
                out.append(buf[i]); i += 1
            }
        }
        return (out, count)
    }

    func apply(_ s: String) -> (out: String, count: Int) {
        let r = apply(Array(s.utf8))
        return (String(decoding: r.out, as: UTF8.self), r.count)
    }

    func containsAny(_ s: String) -> Bool { apply(s).count > 0 }
}

// MARK: - Placeholders: {{secret:<name>}}

let placeholderOpen = Array("{{secret:".utf8)

func findBytes(_ needle: [UInt8], in hay: [UInt8], from: Int) -> Int? {
    guard needle.count <= hay.count else { return nil }
    var i = from
    while i + needle.count <= hay.count {
        if hay[i] == needle[0] && Array(hay[i..<(i + needle.count)]) == needle { return i }
        i += 1
    }
    return nil
}

func placeholders(_ b: [UInt8]) throws -> [(range: Range<Int>, name: String)] {
    var out = [(range: Range<Int>, name: String)]()
    var i = 0
    while let s = findBytes(placeholderOpen, in: b, from: i) {
        var j = s + placeholderOpen.count
        while j < b.count, j - s < 80, isLowerAlnum(b[j]) || b[j] == 46 || b[j] == 95 || b[j] == 45 { j += 1 }
        let name = String(decoding: b[(s + placeholderOpen.count)..<j], as: UTF8.self)
        guard j + 1 < b.count, b[j] == 125, b[j + 1] == 125, validName(name) else {
            throw badRequest("a {{secret:<name>}} placeholder is malformed")
        }
        out.append((s..<(j + 2), name))
        i = j + 2
    }
    return out
}

func fillPlaceholders(_ b: [UInt8], _ values: [String: [UInt8]], encode: ([UInt8]) -> [UInt8] = { $0 }) throws -> [UInt8] {
    var out = [UInt8]()
    var last = 0
    for p in try placeholders(b) {
        out += b[last..<p.range.lowerBound]
        out += encode(values[p.name] ?? [])
        last = p.range.upperBound
    }
    out += b[last...]
    return out
}

// MARK: - Socket server

func vaultDirectory() -> String {
    let env = ProcessInfo.processInfo.environment
    if let d = env["HERDR_VAULT_DIR"], !d.isEmpty { return (d as NSString).standardizingPath }
    let home = env["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
    return (home as NSString).appendingPathComponent(".herdr/vault")
}

var vaultDir = ""
var store: Store!
var selfPath = ""
var signedKind = "unsigned"
var hardened = false

func die(_ m: String) -> Never {
    FileHandle.standardError.write(Data("herdr-ws-vaultd: \(m)\n".utf8))
    exit(1)
}

func prepareVaultDir() {
    let fm = FileManager.default
    var isDir: ObjCBool = false
    if !fm.fileExists(atPath: vaultDir, isDirectory: &isDir) {
        do { try fm.createDirectory(atPath: vaultDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { die("can't make the vault folder \(vaultDir): \(error.localizedDescription)") }
    } else if !isDir.boolValue {
        die("\(vaultDir) is not a folder")
    }
    var st = stat()
    guard lstat(vaultDir, &st) == 0, (st.st_mode & S_IFMT) == S_IFDIR else { die("\(vaultDir) is not a folder") }
    guard st.st_uid == geteuid() else { die("\(vaultDir) belongs to another user") }
    if st.st_mode & 0o077 != 0 { chmod(vaultDir, 0o700) }
}

func withSockAddr<T>(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) -> T) -> T? {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    let cap = MemoryLayout.size(ofValue: addr.sun_path)
    guard bytes.count < cap else { return nil }
    withUnsafeMutableBytes(of: &addr.sun_path) { raw in
        for (i, b) in bytes.enumerated() { raw[i] = b }
        raw[bytes.count] = 0
    }
    addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    return withUnsafePointer(to: &addr) { p in
        p.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
}

// True when something answers on the socket path (another broker).
func someoneListens(_ path: String) -> Bool {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    return withSockAddr(path) { connect(fd, $0, $1) == 0 } ?? false
}

func listenOn(_ path: String) -> Int32 {
    var st = stat()
    if lstat(path, &st) == 0 {
        guard (st.st_mode & S_IFMT) == S_IFSOCK else { die("\(path) exists and is not a socket; move it away first") }
        if someoneListens(path) { die("another broker already answers on \(path)") }
        unlink(path)   // a stale socket nobody serves
    }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { die("socket: \(String(cString: strerror(errno)))") }
    _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
    let old = umask(0o177)
    let rc = withSockAddr(path) { bind(fd, $0, $1) }
    umask(old)
    guard let bound = rc else { die("the socket path \(path) is too long") }
    guard bound == 0 else { die("bind \(path): \(String(cString: strerror(errno)))") }
    chmod(path, 0o600)
    guard listen(fd, 64) == 0 else { die("listen: \(String(cString: strerror(errno)))") }
    return fd
}

func writeAll(_ fd: Int32, _ bytes: [UInt8]) -> Bool {
    var off = 0
    while off < bytes.count {
        let n = bytes.withUnsafeBytes { write(fd, $0.baseAddress! + off, $0.count - off) }
        if n < 0 { if errno == EINTR { continue }; return false }
        off += n
    }
    return true
}

let maxLine = 48 * 1024 * 1024

func serveConnection(_ fd: Int32) {
    defer { close(fd) }
    var pending = [UInt8]()
    var buf = [UInt8](repeating: 0, count: 65536)
    while true {
        let n = buf.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
        if n < 0 && errno == EINTR { continue }
        if n <= 0 { return }
        pending += buf[0..<n]
        while let nl = pending.firstIndex(of: 10) {
            let line = Array(pending[..<nl])
            pending.removeSubrange(...nl)
            if line.allSatisfy({ $0 == 32 || $0 == 13 || $0 == 9 }) { continue }
            let answer = answerLine(line)
            guard writeAll(fd, answer + [10]) else { return }
        }
        if pending.count > maxLine {
            _ = writeAll(fd, encodeAnswer(["id": NSNull(), "ok": false, "error": ["kind": "bad_request", "message": "request line too long"]]) + [10])
            return
        }
    }
}

func encodeAnswer(_ a: JSON) -> [UInt8] {
    if let d = try? JSONSerialization.data(withJSONObject: a) { return [UInt8](d) }
    return Array(#"{"id":null,"ok":false,"error":{"kind":"failed","message":"the answer could not be encoded"}}"#.utf8)
}

func answerLine(_ line: [UInt8]) -> [UInt8] {
    guard let obj = try? JSONSerialization.jsonObject(with: Data(line)), let req = obj as? JSON else {
        return encodeAnswer(["id": NSNull(), "ok": false, "error": ["kind": "bad_request", "message": "a request is one JSON object a line"]])
    }
    let id = req["id"] ?? NSNull()
    do {
        var answer = try handle(req)
        answer["id"] = id
        answer["ok"] = true
        return encodeAnswer(answer)
    } catch let e as VaultError {
        return encodeAnswer(["id": id, "ok": false, "error": ["kind": e.kind, "message": e.message]])
    } catch {
        return encodeAnswer(["id": id, "ok": false, "error": ["kind": "failed", "message": "unexpected error"]])
    }
}

func handle(_ req: JSON) throws -> JSON {
    let caller = Caller(req["caller"])
    guard let op = req["op"] as? String else { throw badRequest("`op` is missing") }
    switch op {
    case "status": return try opStatus()
    case "list": return try opList()
    case "put": return try opPut(req)
    case "policy": return try opPolicy(req, caller)
    case "delete": return try opDelete(req)
    case "migrate": return try opMigrate(req, caller)
    case "http": return try opHttp(req, caller)
    case "run": return try opRun(req, caller)
    default: throw badRequest("unknown op \(printable(op, max: 40)); ops: status list put policy delete migrate http run")
    }
}

// MARK: - status, list, put, policy, delete

func opStatus() throws -> JSON {
    let count = try store.withLock { try store.accounts().count }
    return ["version": vaultdVersion, "protocol": protocolVersion, "pid": Int(getpid()), "binary": selfPath,
            "signed": signedKind, "hardened": hardened, "count": count, "test": isTestBuild]
}

func opList() throws -> JSON {
    let items = try store.withLock { try store.all() }
    return ["entries": items.map { $0.policy.json(tier: "protected") }]
}

func opPut(_ req: JSON) throws -> JSON {
    guard let e = req["entry"] as? JSON else { throw badRequest("`entry` is missing") }
    let (name, scope) = try requireNameScope(e)
    let mode = (e["mode"] as? String) ?? "http"
    guard mode == "http" || mode == "http+cli" else { throw badRequest("`mode` must be http or http+cli") }
    let hosts = e["hosts"] == nil ? [] : try readHosts(e["hosts"])
    let commands = e["commands"] == nil ? [] : try pinCommands(e["commands"], searchPath: req["searchPath"] as? String, existing: [])
    if e["allowShells"] != nil && !isBool(e["allowShells"]) { throw badRequest("`allowShells` must be true or false") }
    guard let vb = req["valueB64"] as? String, let value = unbase64(vb) else { throw badRequest("`valueB64` must be base64") }
    guard !value.isEmpty, value.count <= 1024 * 1024 else { throw badRequest("the value must be 1 byte to 1 MB") }
    let now = nowMs()
    var p = Policy(name: name, scope: scope, mode: mode, hosts: hosts, commands: commands,
                   allowShells: boolValue(e["allowShells"]) ?? false, grants: [], createdAt: now, updatedAt: now,
                   expiresAt: try readExpiry(e["expiresAt"]), lastUsedAt: nil, lastUsedBy: nil, lastUsedFor: nil,
                   note: try readNote(e["note"]))
    try p.check()
    try store.withLock {
        if let old = try store.find(p.key) {
            p.createdAt = old.policy.createdAt
            try store.delete(old)   // a fresh item, so its access list trusts this build
        }
        try store.create(p, value)
    }
    return ["entry": p.json(tier: "protected")]
}

// Applies a patch and says, in words, everything it adds.
func applyPatch(_ old: Policy, _ patch: JSON, searchPath: String?) throws -> (Policy, [String]) {
    var p = old
    var widens = [String]()
    let known: Set<String> = ["mode", "hosts", "commands", "allowShells", "expiresAt", "note"]
    if let extra = patch.keys.first(where: { !known.contains($0) }) { throw badRequest("`patch` can't change \(printable(extra, max: 40))") }
    if let m = patch["mode"] {
        guard let mode = m as? String, mode == "http" || mode == "http+cli" else { throw badRequest("`mode` must be http or http+cli") }
        if old.mode == "http" && mode == "http+cli" { widens.append("Use from the command line (HTTP + CLI)") }
        p.mode = mode
    }
    if patch["hosts"] != nil {
        p.hosts = try readHosts(patch["hosts"])
        for h in p.hosts where !old.hosts.contains(h) { widens.append("New host: \(h)") }
    }
    if patch["commands"] != nil {
        p.commands = try pinCommands(patch["commands"], searchPath: searchPath, existing: old.commands)
        for c in p.commands where !old.commands.contains(c) { widens.append("New command: \(c.path)") }
    }
    if let s = patch["allowShells"] {
        guard let v = boolValue(s) else { throw badRequest("`allowShells` must be true or false") }
        if v && !old.allowShells { widens.append("Shells and interpreters may be pinned (sh, python, node, …)") }
        p.allowShells = v
    }
    if patch.keys.contains("expiresAt") {
        p.expiresAt = try readExpiry(patch["expiresAt"])
        if let was = old.expiresAt {
            if let new = p.expiresAt {
                if new > was {
                    let date = DateFormatter.localizedString(from: Date(timeIntervalSince1970: Double(new) / 1000), dateStyle: .medium, timeStyle: .short)
                    widens.append(was <= nowMs() ? "Revive the expired secret until \(date)" : "Keep it longer: until \(date)")
                }
            } else {
                widens.append("Never expire")
            }
        }
    }
    if patch.keys.contains("note") { p.note = try readNote(patch["note"]) }
    if p.mode == "http" && !p.commands.isEmpty && patch["commands"] == nil && patch["mode"] != nil { p.commands = [] }
    try p.check()
    return (p, widens)
}

// Two policies are the same but for their last use (a use while a dialog shows isn't a change).
func sameIgnoringUse(_ a: Policy, _ b: Policy) -> Bool {
    var x = a, y = b
    x.lastUsedAt = nil; x.lastUsedBy = nil; x.lastUsedFor = nil
    y.lastUsedAt = nil; y.lastUsedBy = nil; y.lastUsedFor = nil
    return x == y
}

func opPolicy(_ req: JSON, _ caller: Caller) throws -> JSON {
    let (name, scope) = try requireNameScope(req)
    guard let patch = req["patch"] as? JSON else { throw badRequest("`patch` is missing") }
    let key = scope + "/" + name
    let searchPath = req["searchPath"] as? String
    guard let first = try store.withLock({ try store.find(key) }) else { throw notFound("no Protected secret \(key)") }
    // The policy written is exactly this one, the one the dialog describes (no second lookup).
    var (planned, widens) = try applyPatch(first.policy, patch, searchPath: searchPath)
    if !widens.isEmpty {
        var lines = ["Herdr Secrets wants to widen what “\(name)” (\(scopeLabel(scope))) may be used for:", ""]
        lines += widens.map { "• " + $0 }
        if let who = caller.who { lines += ["", "Asked by: \(who) (as it says of itself)"] }
        guard confirm(kind: "policy", keys: [key], title: "Allow a wider use of “\(name)”?", lines: lines) else {
            throw denied("the change to \(key) wasn't allowed")
        }
    }
    return try store.withLock {
        guard let item = try store.find(key) else { throw notFound("no Protected secret \(key)") }
        guard sameIgnoringUse(item.policy, first.policy) else { throw failed("\(key) changed while asking; try again") }
        planned.lastUsedAt = item.policy.lastUsedAt
        planned.lastUsedBy = item.policy.lastUsedBy
        planned.lastUsedFor = item.policy.lastUsedFor
        planned.updatedAt = nowMs()
        try store.update(item, planned)
        return ["entry": planned.json(tier: "protected")]
    }
}

func opDelete(_ req: JSON) throws -> JSON {
    let (name, scope) = try requireNameScope(req)
    let key = scope + "/" + name
    try store.withLock {
        guard let item = try store.find(key) else { throw notFound("no Protected secret \(key)") }
        try store.delete(item)
    }
    return [:]
}

// MARK: - migrate (to Standard, sealed)

func opMigrate(_ req: JSON, _ caller: Caller) throws -> JSON {
    let (name, scope) = try requireNameScope(req)
    guard (req["to"] as? String) == "standard" else { throw badRequest("`to` must be \"standard\"") }
    guard let kb = req["keyB64"] as? String, let key = unbase64(kb), key.count == 32 else {
        throw badRequest("`keyB64` must be the 32-byte Standard key in base64")
    }
    let entryKey = scope + "/" + name
    guard try store.withLock({ try store.find(entryKey) }) != nil else { throw notFound("no Protected secret \(entryKey)") }
    var lines = ["Herdr Secrets wants to move “\(name)” (\(scopeLabel(scope))) from Protected to Standard.", "",
                 "Standard secrets are kept in a file any program running as you can read with the Standard key; the broker's host and command checks no longer apply."]
    if let who = caller.who { lines += ["", "Asked by: \(who) (as it says of itself)"] }
    guard confirm(kind: "migrate", keys: [entryKey], title: "Move “\(name)” to Standard?", lines: lines) else {
        throw denied("moving \(entryKey) to Standard wasn't allowed")
    }
    return try store.withLock {
        guard let item = try store.find(entryKey) else { throw notFound("no Protected secret \(entryKey)") }
        let box: AES.GCM.SealedBox
        do { box = try AES.GCM.seal(item.value, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce(), authenticating: Array(entryKey.utf8)) }
        catch { throw failed("sealing failed") }
        try store.delete(item)
        var p = item.policy
        p.grants = []
        p.allowShells = false
        p.updatedAt = nowMs()
        return ["sealed": ["iv": base64(box.nonce.withUnsafeBytes { Array($0) }), "ct": base64(Array(box.ciphertext)), "tag": base64(Array(box.tag))],
                "entry": p.json(tier: "standard")]
    }
}

// MARK: - http

// Looks up every named secret for a use and checks what holds for all uses.
func secretsFor(_ names: [String], via: String, target: String, _ caller: Caller) throws -> [Store.Item] {
    var out = [Store.Item]()
    for name in names where !out.contains(where: { $0.policy.name == name }) {
        guard let item = try store.withLock({ try store.resolve(name, ws: caller.ws) }) else {
            throw notFound("no Protected secret \(name) here; Standard secrets are filled in by the CLI")
        }
        if item.policy.isExpired(nowMs()) {
            logUse(item.policy, via: via, target: target, caller: caller, ok: false, why: "expired")
            throw expiredError("\(name) has expired")
        }
        out.append(item)
    }
    return out
}

struct Endpoint {
    let scheme: String
    let host: String
    let port: Int

    init?(_ url: URL) {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: true), let s = c.scheme?.lowercased(),
              let h = c.host, !h.isEmpty, c.user == nil, c.password == nil else { return nil }
        scheme = s
        host = normalHost(h)
        guard !host.contains("%") else { return nil }
        port = c.port ?? (s == "https" ? 443 : 80)
    }

    var allowedScheme: Bool { scheme == "https" || (scheme == "http" && loopbackHosts.contains(host)) }

    func same(_ o: Endpoint) -> Bool { scheme == o.scheme && host == o.host && port == o.port }
}

final class HopDelegate: NSObject, URLSessionDataDelegate {
    let cap: Int
    var body = Data()
    var truncated = false
    var response: HTTPURLResponse?
    var error: Error?
    let done = DispatchSemaphore(value: 0)

    init(cap: Int) { self.cap = cap }

    // Redirects are followed by hand, never by URLSession.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // TLS checks stay as macOS does them; no stored or client credential is ever offered.
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else {
            completionHandler(.rejectProtectionSpace, nil)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        self.response = response as? HTTPURLResponse
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let room = cap - body.count
        if data.count > room {
            body.append(data.prefix(room))
            truncated = true
            dataTask.cancel()
        } else {
            body.append(data)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if !truncated { self.error = error }
        done.signal()
    }
}

struct Hop {
    var url: URL
    var method: String
    var headers: [(name: String, value: String, secret: Bool)]
    var body: [UInt8]?
    var bodyHasSecret: Bool
    var queryHasSecret: Bool
}

let bodyCap = 16 * 1024 * 1024

func perform(_ hop: Hop, deadline: Date, readPast: Int) throws -> HopDelegate {
    let remaining = deadline.timeIntervalSinceNow
    guard remaining > 0 else { throw failed("timed out") }
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.urlCredentialStorage = nil
    config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    config.timeoutIntervalForRequest = remaining
    config.timeoutIntervalForResource = remaining
    let delegate = HopDelegate(cap: bodyCap + readPast)
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    let session = URLSession(configuration: config, delegate: delegate, delegateQueue: queue)
    defer { session.finishTasksAndInvalidate() }
    var r = URLRequest(url: hop.url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: remaining)
    r.httpMethod = hop.method
    r.httpShouldHandleCookies = false
    for h in hop.headers { r.addValue(h.value, forHTTPHeaderField: h.name) }
    if let b = hop.body { r.httpBody = Data(b) }
    let task = session.dataTask(with: r)
    task.resume()
    if delegate.done.wait(timeout: .now() + remaining + 1) == .timedOut {
        task.cancel()
        throw failed("timed out")
    }
    if let e = delegate.error as? URLError {
        throw failed(e.code == .timedOut ? "timed out" : "the request failed (URLError \(e.code.rawValue))")
    } else if delegate.error != nil {
        throw failed("the request failed")
    }
    guard delegate.response != nil else { throw failed("no HTTP answer") }
    return delegate
}

// Headers URLSession owns, or that would send the request somewhere else than the URL's host
// (a caller's `Host` reaches another tenant behind a shared front end).
let forbiddenHeaders: Set<String> = ["host", "connection", "transfer-encoding", "content-length", "upgrade", "te",
                                     "trailer", "keep-alive"]

// Also the ones front ends and proxies route or rewrite by, for the same reason.
let forwardingHeaders: Set<String> = ["forwarded", "x-original-host", "x-host", "x-http-host-override"]

func forbiddenHeader(_ name: String) -> Bool {
    let n = name.lowercased()
    return forbiddenHeaders.contains(n) || n.hasPrefix("proxy-") || forwardingHeaders.contains(n) || n.hasPrefix("x-forwarded-")
}

func validHeaderName(_ s: String) -> Bool {
    !s.isEmpty && s.utf8.count <= 256 && charsAll(s, { isAlnum($0) || Array("!#$%&'*+-.^_`|~".utf8).contains($0) })
}

func opHttp(_ req: JSON, _ caller: Caller) throws -> JSON {
    guard let r = req["request"] as? JSON else { throw badRequest("`request` is missing") }
    let method = ((r["method"] as? String) ?? "GET").uppercased()
    guard validHeaderName(method), method.utf8.count <= 20 else { throw badRequest("`method` is not an HTTP method") }
    let urlText = try requireString(r, "url")
    guard urlText.utf8.count <= 65536 else { throw badRequest("`url` is too long") }
    var rawHeaders = [(String, String)]()
    for h in (r["headers"] as? [Any]) ?? [] {
        guard let pair = h as? [Any], pair.count == 2, let k = pair[0] as? String, let v = pair[1] as? String,
              validHeaderName(k), !v.contains("\r"), !v.contains("\n"), !v.contains("\0") else {
            throw badRequest("`headers` must be [[name, value], …] with plain names and one-line values")
        }
        if forbiddenHeader(k) { throw badRequest("header \(k) can't be set by a caller") }
        rawHeaders.append((k, v))
    }
    guard rawHeaders.count <= 200 else { throw badRequest("too many headers") }
    var body: [UInt8]?
    if let bb = r["bodyB64"] as? String {
        guard let b = unbase64(bb) else { throw badRequest("`bodyB64` must be base64") }
        body = b
    }
    let follow = boolValue(r["followRedirects"]) ?? true
    let maxRedirects = max(0, min(Int(wholeNumber(r["maxRedirects"]) ?? 10), 50))
    let timeoutMs = max(1, min(wholeNumber(r["timeoutMs"]) ?? 30000, 300000))
    let deadline = Date(timeIntervalSinceNow: Double(timeoutMs) / 1000)

    // Where placeholders may stand: the URL's query, header values, the body.
    let urlBytes = Array(urlText.utf8)
    let urlPlaceholders = try placeholders(urlBytes)
    let q = urlBytes.firstIndex(of: 63), hash = urlBytes.firstIndex(of: 35)
    for p in urlPlaceholders {
        guard let q = q, p.range.lowerBound > q, hash.map({ p.range.upperBound <= $0 }) ?? true else {
            throw badRequest("a secret may stand only in the URL's query")
        }
    }
    let headerPlaceholders = try rawHeaders.map { try placeholders(Array($0.1.utf8)) }
    for (k, _) in rawHeaders where k.contains("{{") { throw badRequest("a secret may not stand in a header name") }
    let bodyPlaceholders = try body.map { try placeholders($0) } ?? []
    let names = urlPlaceholders.map(\.name) + headerPlaceholders.flatMap { $0.map(\.name) } + bodyPlaceholders.map(\.name)
    guard !names.isEmpty else { throw badRequest("the request names no {{secret:<name>}}") }

    // The endpoint, read from the URL with the placeholders blanked out.
    var probe = urlBytes
    for p in urlPlaceholders.reversed() { probe.replaceSubrange(p.range, with: Array("x".utf8)) }
    guard let probeURL = URL(string: String(decoding: probe, as: UTF8.self)), let start = Endpoint(probeURL) else {
        throw badRequest("`url` is not an absolute URL with a host")
    }
    guard start.allowedScheme else { throw refused("only https is allowed (http only to localhost)") }

    let items = try secretsFor(names, via: "http", target: start.host, caller)
    for item in items {
        guard !item.policy.hosts.isEmpty else {
            logUse(item.policy, via: "http", target: start.host, caller: caller, ok: false, why: "refused")
            throw refused("\(item.policy.name) has no allowed hosts, so it can't go in an HTTP request")
        }
        guard hostMatches(item.policy.hosts, host: start.host, port: start.port) else {
            logUse(item.policy, via: "http", target: start.host, caller: caller, ok: false, why: "refused")
            throw refused("\(item.policy.name) may not be sent to \(start.host)")
        }
    }
    var values = [String: [UInt8]]()
    for item in items { values[item.policy.name] = item.value }
    let redactor = Redactor(items.map { ($0.policy.name, $0.value) })

    // In the query a value is percent-encoded as JavaScript's encodeURIComponent does it, so a value
    // with + or & arrives as it is and both tiers fill it the same way.
    let filledURL = try fillPlaceholders(urlBytes, values) { percentEncode($0, keep: uriComponentBytes, upper: true) }
    guard let firstURL = URL(string: String(decoding: filledURL, as: UTF8.self)) else { throw badRequest("`url` is not a valid URL") }
    var headers = [(name: String, value: String, secret: Bool)]()
    for (i, (k, v)) in rawHeaders.enumerated() {
        if headerPlaceholders[i].isEmpty { headers.append((k, v, false)); continue }
        let filled = try fillPlaceholders(Array(v.utf8), values)
        guard let s = String(bytes: filled, encoding: .utf8), !s.contains("\r"), !s.contains("\n"), !s.contains("\0") else {
            throw badRequest("a secret in header \(k) isn't one line of text")
        }
        headers.append((k, s, true))
    }
    let filledBody = try body.map { try fillPlaceholders($0, values) }
    var hop = Hop(url: firstURL, method: method, headers: headers, body: filledBody, bodyHasSecret: !bodyPlaceholders.isEmpty, queryHasSecret: !urlPlaceholders.isEmpty)

    var redirects = 0, stripped = 0
    var result: HopDelegate
    var current = start
    while true {
        do { result = try perform(hop, deadline: deadline, readPast: redactor.longest) } catch let e as VaultError {
            for item in items { logUse(item.policy, via: "http", target: start.host, caller: caller, ok: false, why: e.kind) }
            throw VaultError(kind: e.kind, message: redactor.apply(e.message).out)
        }
        let status = result.response!.statusCode
        guard follow, [301, 302, 303, 307, 308].contains(status), redirects < maxRedirects,
              let loc = result.response!.value(forHTTPHeaderField: "Location"), !redactor.containsAny(loc),
              let next = URL(string: loc, relativeTo: hop.url)?.absoluteURL, let to = Endpoint(next), to.allowedScheme else { break }
        var nextHop = hop
        nextHop.url = next
        nextHop.queryHasSecret = false   // the Location holds no form of any secret (checked above)
        if status == 303 && hop.method != "HEAD" || (status == 301 || status == 302) && hop.method == "POST" {
            nextHop.method = "GET"
            nextHop.body = nil
            nextHop.bodyHasSecret = false
            nextHop.headers.removeAll { ["content-type", "content-length"].contains($0.name.lowercased()) }
        }
        let resendsSecretBody = nextHop.body != nil && hop.bodyHasSecret
        let holdsSecret = nextHop.headers.contains(where: \.secret) || hop.queryHasSecret || resendsSecretBody
        let everyoneAllows = to.scheme == "https" && items.allSatisfy { hostMatches($0.policy.hosts, host: to.host, port: to.port) }
        if !(to.same(current) || everyoneAllows || !holdsSecret) {
            // Another host: secrets in the query or in a body that would be re-sent stop here.
            if hop.queryHasSecret || resendsSecretBody { break }
            nextHop.headers.removeAll { $0.secret }
            stripped += 1
        }
        hop = nextHop
        current = to
        redirects += 1
    }

    let resp = result.response!
    var count = 0
    var outHeaders = [[String]]()
    for (k, v) in resp.allHeaderFields.map({ ("\($0.key)", "\($0.value)") }).sorted(by: { $0.0 < $1.0 }) {
        let rk = redactor.apply(k), rv = redactor.apply(v)
        count += rk.count + rv.count
        outHeaders.append([rk.out, rv.out])
    }
    // Read past the cap by the longest form, redact, then cut at the cap.
    let rawBody = [UInt8](result.body)
    let rb = redactor.apply(rawBody, limit: bodyCap)
    let bodyTruncated = result.truncated || rawBody.count > bodyCap
    let ru = redactor.apply(resp.url?.absoluteString ?? hop.url.absoluteString)
    count += rb.count + ru.count
    for item in items { logUse(item.policy, via: "http", target: start.host, caller: caller, ok: true) }
    noteUse(items.map(\.policy.key), target: start.host, caller: caller)
    return ["status": resp.statusCode, "headers": outHeaders, "bodyB64": base64(rb.out), "finalUrl": ru.out,
            "redirects": redirects, "stripped": stripped, "redacted": count, "truncated": bodyTruncated]
}

// MARK: - run

final class Flag {
    private let lock = NSLock()
    private var value = false
    func set() { lock.lock(); value = true; lock.unlock() }
    var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
}

// Reads one pipe end on its own thread, keeping at most `cap` bytes and draining the rest.
final class Collector {
    let fd: Int32
    let cap: Int
    var data = [UInt8]()
    var truncated = false
    let stop = Flag()
    let done = DispatchSemaphore(value: 0)

    init(fd: Int32, cap: Int) { self.fd = fd; self.cap = cap }

    func start() {
        Thread { [self] in
            var buf = [UInt8](repeating: 0, count: 65536)
            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            while !stop.isSet {
                let r = poll(&pfd, 1, 100)
                if r < 0 { if errno == EINTR { continue }; break }
                if r == 0 { continue }
                let n = buf.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
                if n < 0 { if errno == EINTR || errno == EAGAIN { continue }; break }
                if n == 0 { break }
                let room = cap - data.count
                if n > room { data += buf[0..<max(0, room)]; truncated = true } else { data += buf[0..<n] }
            }
            close(fd)
            done.signal()
        }.start()
    }
}

func makePipe() throws -> (Int32, Int32) {
    var fds: [Int32] = [0, 0]
    guard pipe(&fds) == 0 else { throw failed("pipe: \(String(cString: strerror(errno)))") }
    _ = fcntl(fds[0], F_SETFD, FD_CLOEXEC)
    _ = fcntl(fds[1], F_SETFD, FD_CLOEXEC)
    return (fds[0], fds[1])
}

func spawnChild(path: String, argv: [String], env: [String], cwd: String, stdin: Int32, stdout: Int32, stderr: Int32) throws -> pid_t {
    var fa: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&fa)
    defer { posix_spawn_file_actions_destroy(&fa) }
    posix_spawn_file_actions_adddup2(&fa, stdin, 0)
    posix_spawn_file_actions_adddup2(&fa, stdout, 1)
    posix_spawn_file_actions_adddup2(&fa, stderr, 2)
    posix_spawn_file_actions_addchdir_np(&fa, cwd)
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    // Its own process group; nothing inherited but 0, 1, 2; signals back to their defaults.
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK))
    posix_spawnattr_setpgroup(&attr, 0)
    var defaults: sigset_t = 0
    for sig in 1...31 where sig != SIGKILL && sig != SIGSTOP { defaults |= sigset_t(1) << sigset_t(sig - 1) }
    posix_spawnattr_setsigdefault(&attr, &defaults)
    var noMask: sigset_t = 0
    posix_spawnattr_setsigmask(&attr, &noMask)
    let cArgv = argv.map { strdup($0) } + [nil]
    let cEnv = env.map { strdup($0) } + [nil]
    defer { cArgv.forEach { free($0) }; cEnv.forEach { free($0) } }
    var pid: pid_t = 0
    let rc = posix_spawn(&pid, path, &fa, &attr, cArgv, cEnv)
    guard rc == 0 else { throw failed("could not start \(basename(path)): \(String(cString: strerror(rc)))") }
    return pid
}

// Waits until the child has ended without reaping it, so its process group id stays reserved
// while the group is signalled.
func waitExited(_ pid: pid_t) {
    var info = siginfo_t()
    while waitid(P_PID, id_t(pid), &info, WEXITED | WNOWAIT) != 0 && errno == EINTR {}
}

let signalNames: [Int32: String] = [SIGHUP: "SIGHUP", SIGINT: "SIGINT", SIGQUIT: "SIGQUIT", SIGILL: "SIGILL", SIGTRAP: "SIGTRAP",
                                    SIGABRT: "SIGABRT", SIGBUS: "SIGBUS", SIGFPE: "SIGFPE", SIGKILL: "SIGKILL", SIGSEGV: "SIGSEGV",
                                    SIGPIPE: "SIGPIPE", SIGALRM: "SIGALRM", SIGTERM: "SIGTERM", SIGUSR1: "SIGUSR1", SIGUSR2: "SIGUSR2"]

let runOutputCap = 8 * 1024 * 1024
let tempPrefix = "herdr-vaultd-run."

// $TMPDIR when it is an absolute folder (launchd sets it to the per-user temp folder), else macOS's own.
func temporaryRoot() -> String {
    if let t = ProcessInfo.processInfo.environment["TMPDIR"], t.hasPrefix("/") {
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: t, isDirectory: &isDir), isDir.boolValue { return (t as NSString).standardizingPath }
    }
    let t = NSTemporaryDirectory()
    return t.isEmpty ? "/tmp" : (t as NSString).standardizingPath
}

func removeFolder(_ dir: String) {
    try? FileManager.default.removeItem(atPath: dir)
}

// Removes run folders a broker that died left behind.
func sweepTempFolders() {
    let root = temporaryRoot()
    for name in (try? FileManager.default.contentsOfDirectory(atPath: root)) ?? [] where name.hasPrefix(tempPrefix) {
        let p = (root as NSString).appendingPathComponent(name)
        var st = stat()
        if lstat(p, &st) == 0, (st.st_mode & S_IFMT) == S_IFDIR, st.st_uid == geteuid() { removeFolder(p) }
    }
}

// A child's environment, built fresh: the PATH given, HOME, USER, LOGNAME and SHELL from the user
// database, the broker's own TMPDIR, the caller's LANG, LC_*, TZ and TERM, and (for an automation)
// the caller's HERDR_* fill-ins, which are input the caller controls. Nothing else the caller sent:
// no NODE_OPTIONS, BASH_ENV, PYTHONPATH, a HOME with a .curlrc, … that would run or redirect code
// inside the command. The secrets are added after.
let callerEnvKeys: Set<String> = ["LANG", "TZ", "TERM"]

func freshEnv(_ callerEnv: [String: String], path: String, herdr: Bool) -> [String: String] {
    var out = ["PATH": path, "TMPDIR": temporaryRoot()]
    if let pw = getpwuid(getuid()) {
        let user = String(cString: pw.pointee.pw_name)
        out["HOME"] = String(cString: pw.pointee.pw_dir)
        out["USER"] = user
        out["LOGNAME"] = user
        out["SHELL"] = String(cString: pw.pointee.pw_shell)
    }
    for (k, v) in callerEnv where callerEnvKeys.contains(k) || k.hasPrefix("LC_") || (herdr && k.hasPrefix("HERDR_")) { out[k] = v }
    return out
}

let systemPath = "/usr/bin:/bin:/usr/sbin:/sbin"

// The script as the dialog shows it: its first 1200 characters, and what isn't shown, said plainly.
func scriptLines(_ script: String, shell: String) -> [String] {
    let total = script.split(separator: "\n", omittingEmptySubsequences: false).count
    let shown = String(script.prefix(1200))
    var lines = ["Its script (\(shell), \(total) line\(total == 1 ? "" : "s")):", printable(shown, max: 1200)]
    let rest = script.dropFirst(shown.count)
    if !rest.isEmpty {
        let more = rest.filter { $0 == "\n" }.count
        lines.append("… and \(more) more line\(more == 1 ? "" : "s") (\(rest.count) characters) not shown here: read the automation's file before you allow it")
    }
    return lines
}

func readSecretBindings(_ v: Any?, _ field: String) throws -> [(env: String, name: String)] {
    guard let v = v else { return [] }
    guard let list = v as? [Any] else { throw badRequest("`\(field)` must be [{ env, name }, …]") }
    return try list.map { item in
        guard let o = item as? JSON, let env = o["env"] as? String, let name = o["name"] as? String, validEnvName(env), validName(name) else {
            throw badRequest("`\(field)` must be [{ env, name }, …] with a plain variable name and a secret name")
        }
        guard validBindingName(env) else {
            throw badRequest("a secret can't be bound to \(env): it changes how a program starts")
        }
        return (env, name)
    }
}

func opRun(_ req: JSON, _ caller: Caller) throws -> JSON {
    guard let argv = req["argv"] as? [String], !argv.isEmpty, !argv[0].isEmpty,
          argv.allSatisfy({ !$0.contains("\0") }), argv.count <= 4096 else {
        throw badRequest("`argv` must be a non-empty list of strings")
    }
    let secretEnv = try readSecretBindings(req["secretEnv"], "secretEnv")
    let secretFiles = try readSecretBindings(req["secretFiles"], "secretFiles")
    let bindings = secretEnv + secretFiles
    guard !bindings.isEmpty else { throw badRequest("the run names no secret (secretEnv or secretFiles)") }
    guard Set(bindings.map(\.env)).count == bindings.count else { throw badRequest("a variable is named twice") }
    let timeoutMs = max(1, min(wholeNumber(req["timeoutMs"]) ?? 120_000, 600_000))
    var cwd = (req["cwd"] as? String) ?? NSHomeDirectory()
    var isDir: ObjCBool = false
    guard cwd.hasPrefix("/"), FileManager.default.fileExists(atPath: cwd, isDirectory: &isDir), isDir.boolValue else {
        throw badRequest("`cwd` must be an absolute folder")
    }
    cwd = (cwd as NSString).standardizingPath
    var stdinBytes: [UInt8]?
    if let s = req["stdinB64"] as? String {
        guard let b = unbase64(s) else { throw badRequest("`stdinB64` must be base64") }
        stdinBytes = b
    }
    var env = [String: String]()
    if let e = req["env"] {
        guard let d = e as? [String: Any] else { throw badRequest("`env` must be an object of strings") }
        for (k, v) in d {
            guard let s = v as? String, !k.isEmpty, !k.contains("="), !k.contains("\0"), !s.contains("\0") else {
                throw badRequest("`env` must be an object of strings")
            }
            env[k] = s
        }
    } else {
        env = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": NSHomeDirectory()]
    }
    for k in env.keys where k.hasPrefix("DYLD_") { env.removeValue(forKey: k) }

    let runTarget = (req["automation"] as? JSON)?["id"].flatMap { $0 as? String }.map { "automation \(printable($0, max: 80))" } ?? basename(argv[0])
    let items = try secretsFor(bindings.map(\.name), via: "run", target: runTarget, caller)
    let exec: String
    let target: String
    var childArgv = argv
    if let a = req["automation"] {
        // A shell automation: allowed by the person for this exact script.
        guard let o = a as? JSON, let id = o["id"] as? String, (3...200).contains(id.utf8.count), id.contains("/"),
              id.unicodeScalars.allSatisfy({ $0.properties.generalCategory != .control }) else {
            throw badRequest("`automation` must be { id: \"<ws>/<name>\" }")
        }
        let shells = ["sh", "bash", "zsh"]
        guard argv.count == 3, argv[1] == "-c", let shell = shells.first(where: { argv[0] == $0 || argv[0] == "/bin/" + $0 }) else {
            throw refused("an automation runs as [sh|bash|zsh, \"-c\", <script>]")
        }
        for item in items where item.policy.scope != "global" && !id.hasPrefix(item.policy.scope.dropFirst(3) + "/") {
            throw refused("\(item.policy.name) belongs to another workspace than automation \(printable(id, max: 80))")
        }
        exec = "/bin/" + shell
        target = "automation \(id)"
        if shell == "zsh" { childArgv = [argv[0], "-f", "-c", argv[2]] }   // -f: no ~/.zshenv or other start-up files
        guard argv[2].utf8.count <= 65536 else { throw badRequest("an automation's script may be at most 64 KB") }
        // The grant covers the exact argv, the folder it runs in, and which variables get which
        // secrets (sorted `env:VAR=name` / `file:VAR=name`), so a replay can't rebind them.
        let bound = (secretEnv.map { "env:\($0.env)=\($0.name)" } + secretFiles.map { "file:\($0.env)=\($0.name)" }).sorted()
        let sha = sha256Hex(Array(([argv.joined(separator: "\0"), cwd] + bound).joined(separator: "\0").utf8))
        let callerPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        let matching = items.map { item in item.policy.grants.first { $0.kind == "automation" && $0.id == id && $0.sha256 == sha && $0.cwd == cwd } }
        var grantPath: String?
        if matching.allSatisfy({ $0 != nil }) && Set(matching.map { $0!.path }).count == 1 {
            grantPath = matching[0]!.path
        } else {
            // Ask for all of them, so they end up allowed with one PATH.
            let names = items.map { "“\($0.policy.name)” (\(scopeLabel($0.policy.scope)))" }.joined(separator: ", ")
            let earlier = items.compactMap { $0.policy.grants.first { $0.kind == "automation" && $0.id == id } }
            var lines = ["The automation “\(printable(id, max: 80))” wants to use \(names).", ""]
            if let was = earlier.first {
                lines += [was.cwd == cwd ? "Its script changed since you last allowed it." : "It runs in another folder than when you last allowed it.", ""]
            }
            lines += ["Folder: \(printable(cwd, max: 300))", "PATH: \(printable(callerPath, max: 300))",
                      "Secrets as: \(bound.joined(separator: ", "))", ""]
            lines += scriptLines(argv[2], shell: shell)
            guard confirm(kind: "grant", keys: items.map(\.policy.key), title: "Let an automation use a Protected secret?", lines: lines) else {
                for item in items { logUse(item.policy, via: "run", target: target, caller: caller, ok: false, why: "denied") }
                throw denied("automation \(printable(id, max: 80)) wasn't allowed to use \(items.map(\.policy.name).joined(separator: ", "))")
            }
            try store.withLock {
                for item in items {
                    guard let fresh = try store.find(item.policy.key) else { throw notFound("no Protected secret \(item.policy.key)") }
                    var p = fresh.policy
                    p.grants.removeAll { $0.kind == "automation" && $0.id == id }   // a changed script or folder replaces the old grant
                    p.grants.append(Grant(kind: "automation", id: id, sha256: sha, path: callerPath, cwd: cwd))
                    p.updatedAt = nowMs()
                    try store.update(fresh, p)
                }
            }
            grantPath = callerPath
        }
        env = freshEnv(env, path: grantPath!, herdr: true)
    } else {
        // A pinned command: the broker runs the path pinned when it was added, whatever PATH says.
        let argv0 = argv[0]
        var chosen: PinnedCommand?
        for item in items {
            let p = item.policy
            guard p.mode == "http+cli" else {
                logUse(p, via: "run", target: basename(argv0), caller: caller, ok: false, why: "refused")
                throw refused("\(p.name) is HTTP only")
            }
            var match: PinnedCommand?
            if argv0.contains("/") {
                guard argv0.hasPrefix("/") else { throw refused("a command path must be absolute") }
                let std = (argv0 as NSString).standardizingPath, real = realPath(std)
                match = p.commands.first { $0.path == std || (real != nil && realPath($0.path) == real) }
            } else {
                match = p.commands.first { $0.name == argv0 }
            }
            guard let m = match else {
                logUse(p, via: "run", target: basename(argv0), caller: caller, ok: false, why: "refused")
                throw refused("\(printable(basename(argv0), max: 80)) is not a command \(p.name) is pinned to")
            }
            let names = [argv0, m.name, m.path, realPath(m.path) ?? m.path]
            if !p.allowShells && names.contains(where: isShellName) {
                logUse(p, via: "run", target: m.name, caller: caller, ok: false, why: "refused")
                throw refused("\(m.name) is a shell, interpreter or wrapper; \(p.name) doesn't allow shells")
            }
            if let c = chosen, c.path != m.path, realPath(c.path) != realPath(m.path) {
                throw refused("the secrets are pinned to different \(m.name) commands")
            }
            chosen = chosen ?? m
        }
        exec = chosen!.path
        target = chosen!.name
        guard isExecutableFile(exec) else { throw failed("the pinned command \(exec) is no longer there") }
        // Its own folder first (for tools that call their siblings), then the system's.
        env = freshEnv(env, path: (exec as NSString).deletingLastPathComponent + ":" + systemPath, herdr: false)
    }

    var values = [String: [UInt8]]()
    for item in items { values[item.policy.name] = item.value }
    for b in secretEnv {
        guard let s = String(bytes: values[b.name]!, encoding: .utf8), !s.contains("\0") else {
            throw badRequest("\(b.name) isn't text, so it can't go in an environment variable; use secretFiles")
        }
        env[b.env] = s
    }
    let redactor = Redactor(items.map { ($0.policy.name, $0.value) })

    // Secret files: a fresh 0700 folder, one 0600 file each, removed however the child ends.
    var tempDir: String?
    defer { if let d = tempDir { removeFolder(d) } }
    if !secretFiles.isEmpty {
        var template = Array((temporaryRoot() + "/" + tempPrefix + "XXXXXX").utf8CString)
        guard let made = template.withUnsafeMutableBufferPointer({ mkdtemp($0.baseAddress) }) else {
            throw failed("can't make a temp folder: \(String(cString: strerror(errno)))")
        }
        let dir = String(cString: made)
        tempDir = dir
        chmod(dir, 0o700)
        for (i, b) in secretFiles.enumerated() {
            let path = dir + "/\(i)-\(b.name)"
            let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard fd >= 0 else { throw failed("can't write a secret file: \(String(cString: strerror(errno)))") }
            let ok = writeAll(fd, values[b.name]!)
            close(fd)
            guard ok else { throw failed("can't write a secret file") }
            env[b.env] = path
        }
    }

    let (outR, outW) = try makePipe()
    let (errR, errW) = try makePipe()
    var inR: Int32, inW: Int32 = -1
    if stdinBytes != nil { (inR, inW) = try makePipe() } else { inR = open("/dev/null", O_RDONLY | O_CLOEXEC) }
    let pid: pid_t
    do {
        pid = try spawnChild(path: exec, argv: childArgv, env: env.map { "\($0.key)=\($0.value)" }, cwd: cwd,
                             stdin: inR, stdout: outW, stderr: errW)
    } catch {
        [outR, outW, errR, errW, inR, inW].filter { $0 >= 0 }.forEach { close($0) }
        for item in items { logUse(item.policy, via: "run", target: target, caller: caller, ok: false) }
        throw error
    }
    close(outW); close(errW); close(inR)
    let out = Collector(fd: outR, cap: runOutputCap + redactor.longest), err = Collector(fd: errR, cap: runOutputCap + redactor.longest)
    out.start(); err.start()
    if let bytes = stdinBytes {
        let fd = inW
        Thread { _ = writeAll(fd, bytes); close(fd) }.start()
    }

    let exited = DispatchSemaphore(value: 0)
    Thread { waitExited(pid); exited.signal() }.start()
    var timedOut = false
    var outDone = false, errDone = false
    if exited.wait(timeout: .now() + .milliseconds(Int(timeoutMs))) == .timedOut {
        // Timeout: the whole group gets SIGTERM, then, after a moment, SIGKILL.
        timedOut = true
        killpg(pid, SIGTERM)
        let gone = exited.wait(timeout: .now() + 2) == .success
        killpg(pid, SIGKILL)   // also whatever in the group outlived SIGTERM
        if !gone { exited.wait() }
    } else {
        // Ended: give anything left in its group a moment to close the output, then stop it.
        let soon = DispatchTime.now() + 2
        outDone = out.done.wait(timeout: soon) == .success
        errDone = err.done.wait(timeout: soon) == .success
        if !(outDone && errDone) { killpg(pid, SIGKILL) }
    }
    var status: Int32 = 0
    while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
    // The readers end at EOF; past a few seconds (something outside the group still holds a pipe)
    // they're told to stop.
    for (c, finished) in [(out, outDone), (err, errDone)] where !finished {
        if c.done.wait(timeout: .now() + 3) == .timedOut { c.stop.set(); c.done.wait() }
    }

    var code: Any = NSNull(), signal: Any = NSNull()
    let low = status & 0x7f
    if low == 0 { code = Int((status >> 8) & 0xff) } else if low != 0x7f { signal = signalNames[low] ?? "SIG\(low)" }
    let ro = redactor.apply(out.data, limit: runOutputCap), re = redactor.apply(err.data, limit: runOutputCap)
    let outputTruncated = out.truncated || err.truncated || out.data.count > runOutputCap || err.data.count > runOutputCap
    for item in items { logUse(item.policy, via: "run", target: target, caller: caller, ok: true) }
    noteUse(items.map(\.policy.key), target: target, caller: caller)
    return ["code": code, "signal": signal, "timedOut": timedOut, "stdoutB64": base64(ro.out), "stderrB64": base64(re.out),
            "redacted": ro.count + re.count, "truncated": outputTruncated]
}

// MARK: - Start

func readSigning() {
    selfPath = Bundle.main.executableURL?.resolvingSymlinksInPath().path ?? CommandLine.arguments[0]
    var code: SecCode?
    var staticCode: SecStaticCode?
    var info: CFDictionary?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let c = code,
          SecCodeCopyStaticCode(c, [], &staticCode) == errSecSuccess, let s = staticCode,
          SecCodeCopySigningInformation(s, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let d = info as? [String: Any], let flags = (d[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value else { return }
    let adhoc: UInt32 = 0x0002, runtime: UInt32 = 0x10000
    signedKind = flags & adhoc != 0 ? "adhoc" : (d[kSecCodeInfoIdentifier as String] != nil ? "identity" : "unsigned")
    hardened = flags & runtime != 0
}

func openKeychain() -> SecKeychain {
    var kc: SecKeychain?
    #if VAULTD_TEST
    // The test build works only in a throwaway keychain file, never the login or default one,
    // and never lets the Keychain ask the person anything.
    SecKeychainSetUserInteractionAllowed(false)
    guard let path = ProcessInfo.processInfo.environment["VAULTD_TEST_KEYCHAIN"], path.hasPrefix("/") else {
        die("the test build needs VAULTD_TEST_KEYCHAIN (an absolute path to a throwaway keychain)")
    }
    var defaultKC: SecKeychain?
    var len: UInt32 = 1024
    var buf = [CChar](repeating: 0, count: 1024)
    if SecKeychainCopyDefault(&defaultKC) == errSecSuccess, let d = defaultKC, SecKeychainGetPath(d, &len, &buf) == errSecSuccess {
        let defaultPath = String(cString: buf)
        if realPath(defaultPath) == realPath(path) || defaultPath == path { die("VAULTD_TEST_KEYCHAIN is the default keychain") }
    }
    if path.hasSuffix("/login.keychain-db") || path.hasSuffix("/login.keychain") { die("VAULTD_TEST_KEYCHAIN is a login keychain") }
    guard FileManager.default.fileExists(atPath: path) else { die("VAULTD_TEST_KEYCHAIN \(path) doesn't exist") }
    let st = SecKeychainOpen(path, &kc)
    #else
    // The person's login keychain, by its path under their real home (not $HOME, not the search list).
    guard let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir else { die("can't find your home folder") }
    let home = String(cString: dir)
    let candidates = ["\(home)/Library/Keychains/login.keychain-db", "\(home)/Library/Keychains/login.keychain"]
    guard let path = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) else { die("can't find the login keychain") }
    let st = SecKeychainOpen(path, &kc)
    #endif
    guard st == errSecSuccess, let k = kc else { die("can't open the keychain (status \(st))") }
    return k
}

func main() -> Never {
    let args = Array(CommandLine.arguments.dropFirst())
    if args == ["--version"] {
        print("herdr-ws-vaultd \(vaultdVersion)\(isTestBuild ? " (test build)" : "")")
        exit(0)
    }
    guard args.isEmpty else {
        FileHandle.standardError.write(Data("usage: herdr-ws-vaultd [--version]\n".utf8))
        exit(2)
    }
    signal(SIGPIPE, SIG_IGN)
    readSigning()
    vaultDir = vaultDirectory()
    prepareVaultDir()
    store = Store(keychain: openKeychain())
    sweepTempFolders()
    let socketPath = vaultDir + "/broker.sock"
    let listener = listenOn(socketPath)
    logLine("\(vaultdVersion)\(isTestBuild ? " (test build)" : "") serving on \(socketPath), pid \(getpid())")
    while true {
        let fd = accept(listener, nil, nil)
        if fd < 0 { if errno == EINTR || errno == ECONNABORTED { continue }; die("accept: \(String(cString: strerror(errno)))") }
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        var one: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        // Only peers running as this same user.
        var uid: uid_t = 0, gid: gid_t = 0
        guard getpeereid(fd, &uid, &gid) == 0, uid == geteuid() else {
            logLine("refused a connection from uid \(uid)")
            close(fd)
            continue
        }
        Thread { serveConnection(fd) }.start()
    }
}

main()
