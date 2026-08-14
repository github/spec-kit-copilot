// Tests for env-probe.mjs — pure decideChecks + summarizeResults; runChecks
// runs against a stub spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideChecks, runChecks, summarizeResults } from "../env/probe.mjs";

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
