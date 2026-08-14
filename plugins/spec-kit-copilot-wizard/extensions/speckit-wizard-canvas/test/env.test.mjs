import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path, { isAbsolute, join as pathJoin, sep } from "node:path";
import { describe, test } from "node:test";
import { decideChecks, runChecks, summarizeResults } from "../env/probe.mjs";
import { pickFallbackDirs, pickNewestVersion } from "../env/resolve-path.mjs";
import {
    fetchSessionRepoPath,
    joinIfPossible,
    pathExists,
    resolveWorkspace,
} from "../env/workspace.mjs";
import { isInside, resolveWorkspacePath } from "../server/http-utils.mjs";
import { safeExternalHref } from "../ui/client.js";

describe("env-probe", () => {
// Tests for env-probe.mjs — pure decideChecks + summarizeResults; runChecks
// runs against a stub spawn.

test("decideChecks returns empty list when cache is fresh", () => {
    const now = 1_000_000;
    const cachedAt = now - 5_000;
    const list = decideChecks({ now, cachedAt });
    assert.deepEqual(list, []);
});

test("decideChecks returns full baseline list when cache is stale", () => {
    // Covers both the "cachedAt null" and "cachedAt older than maxAgeMs"
    // branches — they collapse to the same `stale=true` code path.
    const now = 1_000_000;
    const cachedAt = now - 120_000; // > 60s
    const list = decideChecks({ now, cachedAt });
    const names = list.map((c) => c.name);
    assert.ok(names.includes("specify"));
    assert.ok(names.includes("spec-kit-plugin"));
    assert.ok(names.includes("uv"));
    assert.ok(names.includes("git"));
    assert.ok(names.includes("python"));
    assert.ok(names.includes("gh"));
});

test("decideChecks with force=true always returns full list", () => {
    const now = 1_000_000;
    const cachedAt = now - 100; // fresh
    const list = decideChecks({ now, cachedAt, force: true });
    assert.ok(list.length > 0);
});

test("decideChecks adds specify-check probe when project is initialized", () => {
    const list = decideChecks({ cachedAt: null, projectInitialized: true });
    const names = list.map((c) => c.name);
    assert.ok(names.includes("specify-check"));
});

test("runChecks with stub spawn returns per-tool results", async () => {
    const spawnCalls = [];
    const stubSpawn = async (cmd, args) => {
        spawnCalls.push({ cmd, args });
        return { exitCode: 0, stdout: `${cmd} 1.2.3`, stderr: "" };
    };
    const out = await runChecks({ spawn: stubSpawn }, { cachedAt: null });
    assert.equal(out.skipped, false);
    assert.ok(out.results.length >= 5);
    const specify = out.results.find((r) => r.name === "specify");
    assert.equal(specify.exitCode, 0);
});

test("runChecks skips when checks list is empty", async () => {
    const stubSpawn = async () => ({ exitCode: 0, stdout: "", stderr: "" });
    const out = await runChecks({ spawn: stubSpawn }, { cachedAt: Date.now() });
    assert.equal(out.skipped, true);
    assert.deepEqual(out.results, []);
});

test("runChecks catches spawn errors and reports them", async () => {
    const stubSpawn = async (cmd) => {
        if (cmd === "specify") throw new Error("ENOENT");
        return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const out = await runChecks({ spawn: stubSpawn }, { cachedAt: null });
    const specify = out.results.find((r) => r.name === "specify");
    assert.equal(specify.exitCode, -1);
    assert.match(specify.error, /ENOENT/);
});

test("summarizeResults reports pluginInstalled=true and parses version from `copilot plugin list`", () => {
    const stdout = [
        "Installed plugins:",
        "  • workiq@work-iq (v1.0.0)",
        "  • spec-kit-copilot@spec-kit-marketplace (v0.11.8)",
        "  • aspire@aspire-skills (v0.0.1)",
    ].join("\n");
    const summary = summarizeResults([
        { name: "spec-kit-plugin", exitCode: 0, stdout, stderr: "" },
    ]);
    assert.equal(summary.pluginInstalled, true);
    assert.equal(summary.pluginVersion, "0.11.8");
});

test("summarizeResults reports pluginInstalled=false when spec-kit-copilot is absent", () => {
    const stdout = [
        "Installed plugins:",
        "  • workiq@work-iq (v1.0.0)",
    ].join("\n");
    const summary = summarizeResults([
        { name: "spec-kit-plugin", exitCode: 0, stdout, stderr: "" },
    ]);
    assert.equal(summary.pluginInstalled, false);
    assert.equal(summary.pluginVersion, null);
});

test("summarizeResults reports pluginInstalled=false when the probe errored", () => {
    const summary = summarizeResults([
        { name: "spec-kit-plugin", exitCode: -1, error: "ENOENT", stdout: "", stderr: "" },
    ]);
    assert.equal(summary.pluginInstalled, false);
    assert.equal(summary.pluginVersion, null);
});

test("summarizeResults reports 'warn' status for non-zero non-error exit codes", () => {
    const summary = summarizeResults([
        { name: "gh", exitCode: 127, stdout: "", stderr: "not found" },
    ]);
    const gh = summary.checks.find((c) => c.name === "gh");
    assert.equal(gh.status, "warn");
});

test("summarizeResults handles empty input", () => {
    const s = summarizeResults([]);
    assert.equal(s.cliInstalled, false);
    assert.equal(s.cliVersion, null);
    assert.equal(s.pluginInstalled, false);
    assert.equal(s.pluginVersion, null);
    assert.deepEqual(s.checks, []);
});
});

describe("resolve-path", () => {
// Tests for env/resolve-path.mjs — pure pickFallbackDirs + pickNewestVersion.
// buildAugmentedPath (which hits disk) is exercised indirectly via
// pickFallbackDirs with a stub listDir.

test("pickNewestVersion sorts semver-ish version dirs newest first", () => {
    assert.equal(
        pickNewestVersion(["1.0.79-5", "1.0.80", "1.0.79-9", "0.9.0"]),
        "1.0.80",
    );
});

test("pickNewestVersion falls back to lex sort for non-numeric parts", () => {
    // Same numeric prefix; suffix decides. `-9` beats `-5` numerically.
    assert.equal(
        pickNewestVersion(["1.0.79-5", "1.0.79-9"]),
        "1.0.79-9",
    );
});

test("pickNewestVersion ignores non-version-looking names", () => {
    assert.equal(
        pickNewestVersion(["README", "backup", "1.0.0"]),
        "1.0.0",
    );
});

test("pickNewestVersion returns null for empty input", () => {
    assert.equal(pickNewestVersion([]), null);
    assert.equal(pickNewestVersion(null), null);
});

test("pickFallbackDirs on Windows picks newest github-copilot-sdk cli dir", async () => {
    const env = {
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        USERPROFILE: "C:\\Users\\me",
        APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    };
    const listings = {
        "C:\\Users\\me\\AppData\\Local\\github-copilot-sdk\\cli": [
            "1.0.78",
            "1.0.79-5",
            "1.0.79-9",
        ],
        "C:\\Users\\me\\AppData\\Roaming\\Python": ["Python311", "Python312", "notpython"],
        "C:\\Users\\me\\AppData\\Local\\Programs\\Python": ["Python311"],
    };
    const listDir = async (dir) => listings[dir] ?? [];
    const dirs = await pickFallbackDirs(env, "win32", listDir);

    // Newest github-copilot-sdk\cli\<version> is prepended.
    assert.ok(
        dirs.includes(path.win32.join(env.LOCALAPPDATA, "github-copilot-sdk", "cli", "1.0.79-9")),
        `expected newest cli dir in: ${dirs.join(", ")}`,
    );
    // uv default install location.
    assert.ok(dirs.includes(path.win32.join(env.USERPROFILE, ".local", "bin")));
    // pipx / Python user site Scripts dir.
    assert.ok(dirs.includes(path.win32.join(env.APPDATA, "Python", "Python311", "Scripts")));
    assert.ok(dirs.includes(path.win32.join(env.APPDATA, "Python", "Python312", "Scripts")));
    // Programs\Python\<ver>\Scripts.
    assert.ok(dirs.includes(path.win32.join(env.LOCALAPPDATA, "Programs", "Python", "Python311", "Scripts")));
});

test("pickFallbackDirs on Windows tolerates missing env vars", async () => {
    // No env at all — must not throw, must return the (empty) list without
    // ever calling listDir.
    let calls = 0;
    const listDir = async () => { calls++; return []; };
    const dirs = await pickFallbackDirs({}, "win32", listDir);
    assert.deepEqual(dirs, []);
    assert.equal(calls, 0);
});

test("pickFallbackDirs on Windows skips cli root when no version dirs exist", async () => {
    const env = { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
    const listDir = async () => [];
    const dirs = await pickFallbackDirs(env, "win32", listDir);
    // No copilot-sdk entry should appear.
    assert.equal(
        dirs.some((d) => d.includes("github-copilot-sdk")),
        false,
    );
});

test("pickFallbackDirs on POSIX picks common user-scoped install dirs", async () => {
    const env = { HOME: "/home/me" };
    const listDir = async () => [];
    const dirs = await pickFallbackDirs(env, "linux", listDir);
    assert.ok(dirs.includes("/home/me/.local/bin"));
    assert.ok(dirs.includes("/home/me/.cargo/bin"));
    assert.ok(dirs.includes("/usr/local/bin"));
    assert.ok(dirs.includes("/opt/homebrew/bin"));
});

test("pickFallbackDirs deduplicates repeated entries", async () => {
    // Only .local/bin should appear once even if HOME is also USERPROFILE.
    const env = { HOME: "/home/me" };
    const listDir = async () => [];
    const dirs = await pickFallbackDirs(env, "linux", listDir);
    const localBin = dirs.filter((d) => d === "/home/me/.local/bin");
    assert.equal(localBin.length, 1);
});
});

describe("workspace", () => {
test("workspace helpers preserve explicit path precedence and separators", async () => {
    assert.equal(resolveWorkspace({ workspacePath: "/cached" }, { input: { cwd: "/explicit" } }, "/session"), "/explicit");
    assert.equal(resolveWorkspace({ workspacePath: "/cached" }, {}, "/session"), "/session");
    assert.equal(resolveWorkspace({ workspacePath: "/cached" }, {}, null), "/cached");
    assert.equal(joinIfPossible("C:\\repo\\", ".specify"), "C:\\repo\\.specify");
    assert.equal(joinIfPossible("/repo", ".specify"), "/repo/.specify");
});

test("pathExists reports stat success and failure without leaking errors", async () => {
    assert.equal(await pathExists("/present", async () => {}), true);
    assert.equal(await pathExists("/missing", async () => { throw new Error("ENOENT"); }), false);
});

test("fetchSessionRepoPath follows metadata fallback order", async () => {
    assert.equal(
        await fetchSessionRepoPath({ rpc: { metadata: { snapshot: async () => ({ workingDirectory: "/working" }) } } }),
        "/working",
    );
    assert.equal(
        await fetchSessionRepoPath({ rpc: { metadata: { snapshot: async () => ({ workspace: { cwd: "/cwd" } }) } } }),
        "/cwd",
    );
    assert.equal(
        await fetchSessionRepoPath({ rpc: { metadata: { snapshot: async () => ({ workspace: { git_root: "/root" } }) } } }),
        "/root",
    );
});
});

describe("security-helpers", () => {
// Tests for http-utils security helpers: isInside path-boundary check,
// resolveWorkspacePath sandbox, and safeExternalHref URL-scheme allowlist.

// --- isInside -------------------------------------------------------------

test("isInside returns true for the same path", () => {
    const p = pathJoin("a", "b", "c");
    assert.equal(isInside(p, p), true);
});

test("isInside returns true for a descendant", () => {
    const parent = pathJoin("root", "proj");
    const child = pathJoin("root", "proj", "sub", "file.txt");
    assert.equal(isInside(parent, child), true);
});

test("isInside rejects ancestors", () => {
    const parent = pathJoin("root", "proj");
    const child = pathJoin("root");
    assert.equal(isInside(parent, child), false);
});

test("isInside rejects prefix-collision siblings (the core bug)", () => {
    // The bug: startsWith("root/proj") matches "root/proj-secrets/…".
    // path.relative gives "..\proj-secrets\..." or "../proj-secrets/...",
    // which we reject.
    const parent = pathJoin("root", "proj");
    const sibling = pathJoin("root", "proj-secrets", "creds.env");
    assert.equal(isInside(parent, sibling), false);
});

test("isInside rejects ../ traversal", () => {
    const parent = pathJoin("root", "proj");
    const escape = pathJoin("root", "other", "file");
    assert.equal(isInside(parent, escape), false);
});

test("isInside rejects empty / falsy inputs", () => {
    assert.equal(isInside("", "/x"), false);
    assert.equal(isInside("/x", ""), false);
    assert.equal(isInside(null, "/x"), false);
});

// --- resolveWorkspacePath -------------------------------------------------

function mockRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.body = null;
    res.headersSent = false;
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.writeHead = (code, hdrs) => {
        res.statusCode = code;
        Object.assign(res.headers, hdrs ?? {});
        res.headersSent = true;
    };
    res.end = (b) => { res.body = b; res.headersSent = true; };
    return res;
}

test("resolveWorkspacePath: 400 when cwd missing", () => {
    const res = mockRes();
    const out = resolveWorkspacePath(res, "", "any/thing");
    assert.equal(out, null);
    assert.equal(res.statusCode, 400);
});

test("resolveWorkspacePath: accepts inside-workspace relative", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, "sub/file.txt");
    assert.notEqual(out, null);
    assert.equal(res.statusCode, 200); // untouched
    assert.equal(out, pathJoin(cwd, "sub", "file.txt"));
});

test("resolveWorkspacePath: rejects ../ escape", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, `..${sep}other${sep}file`);
    assert.equal(out, null);
    assert.equal(res.statusCode, 403);
});

test("resolveWorkspacePath: rejects prefix-collision sibling", () => {
    // This is the exact regression the fix targets.
    const cwd = pathJoin(process.cwd(), "worktrees", "myproj");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, `..${sep}myproj-secrets${sep}creds.env`);
    assert.equal(out, null);
    assert.equal(res.statusCode, 403);
});

test("resolveWorkspacePath: rejects absolute relPath", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    // OS-appropriate absolute path
    const abs = process.platform === "win32" ? "C:\\Windows\\System32\\config" : "/etc/passwd";
    // On the wrong drive/root, path.resolve returns abs as-is, so this must be caught.
    if (isAbsolute(abs)) {
        const out = resolveWorkspacePath(res, cwd, abs);
        assert.equal(out, null);
        assert.equal(res.statusCode, 403);
    }
});

test("resolveWorkspacePath: rejects non-string relPath", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, null);
    assert.equal(out, null);
    assert.equal(res.statusCode, 403);
});

// --- safeExternalHref -----------------------------------------------------

test("safeExternalHref: allows https", () => {
    const out = safeExternalHref("https://github.com/o/r");
    assert.equal(out, "https://github.com/o/r");
});

test("safeExternalHref: allows http", () => {
    const out = safeExternalHref("http://example.com/");
    assert.equal(out, "http://example.com/");
});

test("safeExternalHref: allows mailto", () => {
    const out = safeExternalHref("mailto:a@b.example");
    assert.equal(out, "mailto:a@b.example");
});

test("safeExternalHref: blocks javascript:", () => {
    assert.equal(safeExternalHref("javascript:alert(1)"), "");
    assert.equal(safeExternalHref("JavaScript:alert(1)"), "");
    // Leading whitespace shouldn't bypass — trim() then re-check
    assert.equal(safeExternalHref("  javascript:alert(1)"), "");
});

test("safeExternalHref: blocks data:", () => {
    assert.equal(safeExternalHref("data:text/html,<script>alert(1)</script>"), "");
});

test("safeExternalHref: blocks vbscript:", () => {
    assert.equal(safeExternalHref("vbscript:msgbox"), "");
});

test("safeExternalHref: blocks bare protocol-relative", () => {
    // // scheme is interpreted as protocol-relative; not on our allowlist,
    // so reject.
    assert.equal(safeExternalHref("//evil.example/x"), "");
});

test("safeExternalHref: blocks empty / falsy", () => {
    assert.equal(safeExternalHref(""), "");
    assert.equal(safeExternalHref(null), "");
    assert.equal(safeExternalHref(undefined), "");
});

test("safeExternalHref: HTML-escapes the returned URL", () => {
    // Even valid schemes must be HTML-escaped for attribute context.
    const out = safeExternalHref('https://example.com/"><img>');
    assert.match(out, /&quot;/);
    assert.doesNotMatch(out, /"/);
});
});
