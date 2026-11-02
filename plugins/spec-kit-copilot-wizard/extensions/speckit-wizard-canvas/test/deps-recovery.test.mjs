// Unit tests for env/deps-recovery.mjs.
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";

import { buildNpmDiagnosticPrompt } from "../env/deps-recovery.mjs";
import { getExtensionDir, installDeps } from "../env/deps-check.mjs";

test("runtime bootstrap omits development dependencies in quiet and progress modes", async () => {
    const calls = [];
    const progress = [];
    const guard = mock.method(childProcess, "spawn", (command, args, options) => {
        calls.push({ command, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => {
            child.stdout.emit("data", Buffer.from("runtime ready\n"));
            child.emit("close", 0);
        });
        return child;
    });
    syncBuiltinESMExports();
    try {
        for (const opts of [{}, { onProgress: (line) => progress.push(line) }]) {
            const result = await installDeps(["js-yaml"], opts);
            assert.equal(result.ok, true);
            const call = calls.at(-1);
            assert.equal(call.command, process.platform === "win32" ? "npm.cmd" : "npm");
            assert.ok(call.args.includes("--omit=dev"));
            assert.ok(call.args.includes("js-yaml"));
            assert.equal(call.options.cwd, getExtensionDir());
            assert.equal(call.options.shell, true);
        }
        assert.deepEqual(progress, ["runtime ready"]);
    } finally {
        guard.mock.restore();
        syncBuiltinESMExports();
    }
});

test("throws when extDir is missing", () => {
    assert.throws(
        () => buildNpmDiagnosticPrompt({ errorCode: "UNKNOWN" }),
        /requires extDir/,
    );
});

test("includes extDir verbatim in the retry step", () => {
    const p = buildNpmDiagnosticPrompt({
        extDir: "C:\\Users\\me\\ext",
        errorCode: "TLS_HANDSHAKE",
        stderr: "schannel: SEC_E_ILLEGAL_MESSAGE",
    });
    assert.ok(p.includes("C:\\Users\\me\\ext"));
    assert.match(p, /npm install --omit=dev --no-audit --no-fund/);
});

test("mentions the classified error code and includes a code-specific hint", () => {
    const tls = buildNpmDiagnosticPrompt({
        extDir: "/x",
        errorCode: "TLS_HANDSHAKE",
        stderr: "",
    });
    assert.match(tls, /TLS_HANDSHAKE/);
    assert.match(tls, /Focus on TLS/);

    const cert = buildNpmDiagnosticPrompt({ extDir: "/x", errorCode: "CERT_UNTRUSTED" });
    assert.match(cert, /Focus on certificates/);

    const proxy = buildNpmDiagnosticPrompt({ extDir: "/x", errorCode: "HTTP_407_PROXY" });
    assert.match(proxy, /Focus on proxy/);

    const dns = buildNpmDiagnosticPrompt({ extDir: "/x", errorCode: "DNS_UNRESOLVED" });
    assert.match(dns, /Focus on DNS/);

    const missing = buildNpmDiagnosticPrompt({ extDir: "/x", errorCode: "NPM_MISSING" });
    assert.match(missing, /npm is not installed|not on PATH/);
});

test("falls back to UNKNOWN hint for unknown codes", () => {
    const p = buildNpmDiagnosticPrompt({ extDir: "/x", errorCode: "SOMETHING_ELSE" });
    assert.match(p, /did not match a known pattern/);
});

test("truncates very long stderr", () => {
    const long = "x".repeat(5000);
    const p = buildNpmDiagnosticPrompt({ extDir: "/x", errorCode: "UNKNOWN", stderr: long });
    assert.ok(p.includes("(truncated)"));
    assert.ok(p.length < long.length + 2000);
});

test("workspacePath appears when provided", () => {
    const p = buildNpmDiagnosticPrompt({
        extDir: "/x",
        errorCode: "UNKNOWN",
        workspacePath: "/home/nicole/repo",
    });
    assert.match(p, /User workspace: \/home\/nicole\/repo/);
});

test("prompt tells the agent to call refreshEnvironment on success", () => {
    const p = buildNpmDiagnosticPrompt({ extDir: "/x", errorCode: "UNKNOWN" });
    assert.match(p, /refreshEnvironment/);
});
