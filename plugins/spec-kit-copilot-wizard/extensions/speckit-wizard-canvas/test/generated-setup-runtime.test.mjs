import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";

import {
    buildSetupPrompt,
    inspectSetup,
    setupContractFingerprint,
} from "../generation/generated-canvas-template/setup-runtime.mjs";

const roots = [];
const here = dirname(fileURLToPath(import.meta.url));
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const contract = {
    requiresSpecKit: true,
    integration: { id: "copilot", skillsMode: true },
    requiredSkills: [{
        name: "speckit-assess-intake",
        invocation: "/skill:speckit-assess-intake",
        commandName: "speckit.assess.intake",
        provider: { kind: "extension", id: "assess" },
    }],
    presets: [{ kind: "preset", id: "copilot-sub-agents", enabled: true, priority: 1, precedence: 0 }],
    extensions: [{ kind: "extension", id: "assess", enabled: true, priority: 10, precedence: 0 }],
};

async function workspace() {
    const root = await mkdtemp(join(here, ".setup workspace with spaces-"));
    roots.push(root);
    return root;
}

function listOutput(kind, entries) {
    if (!entries.length) return `No ${kind}s installed.\n`;
    return `Installed ${kind}s:\n\n${entries.map((entry) => kind === "preset"
        ? `  ${entry.id} (${entry.id}) v1.0.0 — ${entry.enabled ? "enabled" : "disabled"} — priority ${entry.priority}\n    Description`
        : `  ${entry.enabled ? "✓" : "✗"} ${entry.id} (v1.0.0)\n     ${entry.id}\n     Description\n     Commands: 1 | Hooks: 0 | Priority: ${entry.priority} | Status: ${entry.enabled ? "Enabled" : "Disabled"}`
    ).join("\n\n")}\n`;
}

async function installedWorkspace(setup = contract) {
    const root = await workspace();
    await mkdir(join(root, ".specify"), { recursive: true });
    await writeFile(join(root, ".specify", "init-options.json"), JSON.stringify({
        integration: "copilot", integrationOptions: "--skills",
    }));
    const inventory = {};
    for (const kind of ["preset", "extension"]) {
        inventory[kind] = structuredClone(setup[`${kind}s`] ?? []);
        await mkdir(join(root, ".specify", `${kind}s`), { recursive: true });
        await writeRegistry(root, kind, inventory[kind]);
        for (const entry of inventory[kind]) {
            await mkdir(join(root, ".specify", `${kind}s`, entry.id), { recursive: true });
            await writeFile(join(root, ".specify", `${kind}s`, entry.id, `${kind}.yml`),
                `schema_version: "1.0"\n${kind}:\n  id: ${entry.id}\n`);
        }
    }
    for (const skill of setup.requiredSkills ?? []) {
        await mkdir(join(root, ".github", "skills", skill.name), { recursive: true });
        await writeFile(join(root, ".github", "skills", skill.name, "SKILL.md"), "# intake\n");
    }
    const calls = [];
    const runSpecify = async (args, cwd) => {
        assert.equal(cwd, root);
        assert.deepEqual(args, [args[0], "list"]);
        assert.ok(["preset", "extension"].includes(args[0]));
        calls.push(args);
        return listOutput(args[0], inventory[args[0]]);
    };
    return { root, inventory, calls, runSpecify };
}

async function writeRegistry(root, kind, entries) {
    await writeFile(join(root, ".specify", `${kind}s`, ".registry"), JSON.stringify({
        schema_version: "1.0",
        [`${kind}s`]: Object.fromEntries(entries.map(({ id, enabled, priority }) => [id, { enabled, priority }])),
    }));
}

describe("generated setup runtime", () => {
    test("observes installed components independently of configuration readiness", async () => {
        const { root, runSpecify, inventory } = await installedWorkspace();
        inventory.extension[0].priority = 99;
        await writeRegistry(root, "extension", inventory.extension);
        const state = await inspectSetup({ cwd: root, setup: contract, runSpecify });
        assert.equal(state.diskReady, false);
        assert.equal(state.contributionsInstalled, true);
        assert.ok(state.contributions.every((entry) => entry.installed));
        assert.match(state.checks.find((entry) => entry.id === "extension:assess").message, /priority must be 10/);
    });

    test("partial installations preserve verified installed status for other components of the same kind", async () => {
        const setup = structuredClone(contract);
        setup.extensions.push({ kind: "extension", id: "extra", enabled: true, priority: 5, precedence: 1 });
        const { root, runSpecify, inventory } = await installedWorkspace(setup);
        inventory.extension.pop();
        await writeRegistry(root, "extension", inventory.extension);
        const state = await inspectSetup({ cwd: root, setup, runSpecify });
        assert.equal(state.contributionsInstalled, false);
        assert.equal(state.contributions.find((entry) => entry.id === "assess").installed, true);
        assert.equal(state.contributions.find((entry) => entry.id === "extra").installed, false);
        assert.equal(state.contributions.find((entry) => entry.id === "extra").installationState, "unverified");
        await rm(join(root, ".specify", "extensions", "extra", "extension.yml"));
        const missing = await inspectSetup({ cwd: root, setup, runSpecify });
        assert.equal(missing.contributions.find((entry) => entry.id === "extra").installationState, "missing");
        assert.equal(state.contributions.find((entry) => entry.id === "copilot-sub-agents").installed, true);
    });

    test("already-installed setup never claims installation consent or requests reinstalling", () => {
        const setup = { ...contract, requireInstallationApproval: true };
        const existing = buildSetupPrompt({ setup, instanceId: "existing" });
        assert.match(existing, /No installation consent was requested or granted/);
        assert.match(existing, /Do not install, reinstall, remove, or upgrade any preset or extension/);
        assert.doesNotMatch(existing, /Install a missing (?:preset|extension) by id|The user approved this complete installation contract/);
        const accepted = buildSetupPrompt({ setup, instanceId: "accepted", installationApproved: true });
        assert.match(accepted, /The user approved this complete installation contract/);
        assert.match(accepted, /Install a missing preset by id/);
        assert.match(accepted, /Retain matching installed components without reinstalling them/);
    });

    test("reports missing dynamic setup evidence", async () => {
        const root = await workspace();
        const result = await inspectSetup({ cwd: root, setup: contract });
        assert.equal(result.diskReady, false);
        assert.equal(result.checks.some((entry) => entry.id === "spec-kit-init" && !entry.ready), true);
        assert.equal(result.checks.some((entry) => entry.id === "skill:speckit-assess-intake" && !entry.ready), true);
        assert.ok(result.contributions.every((entry) => entry.installationState === "missing"));
    });

    test("accepts Copilot skills-mode init, installed contributions, and required skill files", async () => {
        const { root, runSpecify } = await installedWorkspace();
        const result = await inspectSetup({ cwd: root, setup: contract, runSpecify });
        assert.equal(result.diskReady, true);
        assert.ok(result.checks.every((entry) => entry.ready));

        await writeFile(join(root, ".github", "skills", "speckit-assess-intake", "SKILL.md"), "# changed intake\n");
        const changed = await inspectSetup({ cwd: root, setup: contract, runSpecify });
        assert.notEqual(changed.diskFingerprint, result.diskFingerprint);
    });

    test("directory presence and registered ghosts do not prove installation", async () => {
        const { root, runSpecify, calls } = await installedWorkspace();
        await rm(join(root, ".specify", "presets", ".registry"));
        await rm(join(root, ".specify", "extensions", "assess", "extension.yml"));
        const result = await inspectSetup({ cwd: root, setup: contract, runSpecify });
        assert.equal(result.diskReady, false);
        assert.equal(result.checks.find((entry) => entry.id === "preset:copilot-sub-agents").ready, false);
        assert.equal(result.checks.find((entry) => entry.id === "extension:assess").ready, false);
        assert.equal(calls.length, 0);
    });

    for (const kind of ["preset", "extension"]) {
        test(`${kind}: checks enabled and exact priority and invalidates same-stat registry edits`, async () => {
            const { root, runSpecify, calls, inventory } = await installedWorkspace();
            const args = { cwd: root, setup: contract, runSpecify };
            const before = await inspectSetup(args);
            const path = join(root, ".specify", `${kind}s`, ".registry");
            const originalStat = await stat(path);
            const changedPriority = kind === "preset" ? 2 : 11;
            inventory[kind][0].priority = changedPriority;
            await writeRegistry(root, kind, inventory[kind]);
            await utimes(path, originalStat.atime, originalStat.mtime);
            assert.equal((await stat(path)).size, originalStat.size);
            const changed = await inspectSetup(args);
            assert.equal(changed.diskReady, false);
            assert.notEqual(changed.diskFingerprint, before.diskFingerprint);
            assert.equal(calls.length, 3, "only changed kind is queried again");
            assert.match(changed.checks.find((entry) => entry.id === `${kind}:${inventory[kind][0].id}`).message, /priority must be/);
            inventory[kind][0].priority = contract[`${kind}s`][0].priority;
            inventory[kind][0].enabled = false;
            await writeRegistry(root, kind, inventory[kind]);
            const disabled = await inspectSetup(args);
            assert.equal(disabled.diskReady, false);
            assert.notEqual(disabled.diskFingerprint, changed.diskFingerprint);
            assert.match(disabled.checks.find((entry) => entry.id === `${kind}:${inventory[kind][0].id}`).message, /enabled state must be true/);
        });

        test(`${kind}: permits captured disabled state but rejects an unexpectedly enabled install`, async () => {
            const setup = structuredClone(contract);
            setup[`${kind}s`][0].enabled = false;
            const { root, runSpecify, inventory } = await installedWorkspace(setup);
            assert.equal((await inspectSetup({ cwd: root, setup, runSpecify })).diskReady, true);
            inventory[kind][0].enabled = true;
            const result = await inspectSetup({ cwd: root, setup, runSpecify, refresh: true });
            assert.equal(result.diskReady, false);
            assert.match(result.checks.find((entry) => entry.id === `${kind}:${inventory[kind][0].id}`).message, /enabled state must be false/);
        });

        test(`${kind}: enforces relative CLI order, not registry order or guessed priority ties`, async () => {
            const setup = { ...contract, presets: [], extensions: [], requiredSkills: [] };
            setup[`${kind}s`] = [
                { id: "z-required", enabled: true, priority: 10, precedence: 2 },
                { id: "a-required", enabled: true, priority: 10, precedence: 7 },
            ];
            const { root, runSpecify, inventory } = await installedWorkspace(setup);
            inventory[kind].splice(1, 0, { id: "unrelated", enabled: true, priority: 10 });
            // Registry order is deliberately opposite of the CLI's authority.
            await writeRegistry(root, kind, [...inventory[kind]].reverse());
            const registryBefore = await readFile(join(root, ".specify", `${kind}s`, ".registry"), "utf8");
            const args = { cwd: root, setup, runSpecify };
            const before = await inspectSetup(args);
            assert.equal(before.diskReady, true);
            inventory[kind].reverse();
            const after = await inspectSetup({ ...args, refresh: true });
            assert.equal(after.diskReady, false);
            assert.notEqual(after.diskFingerprint, before.diskFingerprint);
            assert.equal(after.checks.find((entry) => entry.id === `${kind}:precedence`).ready, false);
            assert.equal(await readFile(join(root, ".specify", `${kind}s`, ".registry"), "utf8"), registryBefore);
        });
    }

    test("caches unchanged CLI evidence, rechecks on expiry and explicit refresh", async () => {
        const { root, runSpecify, calls, inventory } = await installedWorkspace();
        let time = 1_000;
        const args = { cwd: root, setup: contract, runSpecify, now: () => time };
        const before = await inspectSetup(args);
        assert.equal(calls.length, 2);
        assert.equal((await inspectSetup(args)).diskFingerprint, before.diskFingerprint);
        assert.equal(calls.length, 2);
        inventory.extension[0].priority = 20;
        time += 30_000;
        const expired = await inspectSetup(args);
        assert.equal(calls.length, 4);
        assert.equal(expired.diskReady, false);
        assert.notEqual(expired.diskFingerprint, before.diskFingerprint);
        await inspectSetup({ ...args, refresh: true });
        assert.equal(calls.length, 6);
    });

    test("coalesces concurrent list reads", async () => {
        const { root, runSpecify, calls } = await installedWorkspace();
        await Promise.all(Array.from({ length: 5 }, () => inspectSetup({ cwd: root, setup: contract, runSpecify })));
        assert.equal(calls.length, 2);
    });

    test("manifest content changes invalidate list evidence", async () => {
        const { root, runSpecify, calls } = await installedWorkspace();
        const args = { cwd: root, setup: contract, runSpecify };
        const before = await inspectSetup(args);
        await writeFile(join(root, ".specify", "presets", "copilot-sub-agents", "preset.yml"), "changed: true\n");
        const after = await inspectSetup(args);
        assert.equal(calls.length, 3);
        assert.notEqual(before.diskFingerprint, after.diskFingerprint);
    });

    for (const registry of ["{", "[]", '{"schema_version":"2.0","presets":{}}', '{"schema_version":"1.0","presets":[]}']) {
        test(`blocks malformed or unsupported registry: ${registry}`, async () => {
            const { root, runSpecify } = await installedWorkspace();
            await writeFile(join(root, ".specify", "presets", ".registry"), registry);
            const result = await inspectSetup({ cwd: root, setup: contract, runSpecify });
            assert.equal(result.diskReady, false);
            assert.match(result.checks.find((entry) => entry.id === "preset:copilot-sub-agents").message, /\.registry/);
        });
    }

    for (const output of [
        "",
        '{"error":"new unsupported format"}',
        "  Copilot (copilot-sub-agents) v1.0.0",
        "  Copilot (copilot-sub-agents) v1.0.0 — enabled\n    Description mentions priority 1",
        "  Copilot (copilot-sub-agents) v1.0.0 — enabled — priority 1\n  Copilot (copilot-sub-agents) v1.0.0 — enabled — priority 1",
        "No presets installed.\n",
    ]) {
        test(`fails closed for incomplete CLI evidence: ${JSON.stringify(output)}`, async () => {
            const { root } = await installedWorkspace();
            const setup = { ...contract, extensions: [] };
            const result = await inspectSetup({ cwd: root, setup, runSpecify: async () => output });
            assert.equal(result.diskReady, false);
            assert.equal(result.checks.find((entry) => entry.id === "preset:copilot-sub-agents").ready, false);
        });
    }

    test("CLI failures never fall back to directory presence", async () => {
        const { root } = await installedWorkspace();
        const result = await inspectSetup({
            cwd: root, setup: contract,
            runSpecify: async () => { throw new Error("EACCES: permission denied"); },
        });
        assert.equal(result.diskReady, false);
        assert.match(result.checks.find((entry) => entry.id === "preset:copilot-sub-agents").message, /Cannot verify.*permission denied/);
    });

    test("blocks invalid registry values even if the CLI would normalize them", async () => {
        const { root, runSpecify } = await installedWorkspace();
        await writeRegistry(root, "extension", [{ id: "assess", enabled: "true", priority: "10" }]);
        const result = await inspectSetup({ cwd: root, setup: contract, runSpecify });
        assert.equal(result.diskReady, false);
        assert.match(result.checks.find((entry) => entry.id === "extension:assess").message, /invalid registry enabled state or priority/);
    });

    test("blocks non-file registries and undecodable manifest evidence", async () => {
        const { root, runSpecify } = await installedWorkspace();
        const registry = join(root, ".specify", "presets", ".registry");
        await rm(registry);
        await mkdir(registry);
        await writeFile(join(root, ".specify", "extensions", "assess", "extension.yml"), Buffer.from([0xff, 0xfe]));
        const result = await inspectSetup({ cwd: root, setup: contract, runSpecify });
        assert.equal(result.diskReady, false);
        assert.equal(result.checks.find((entry) => entry.id === "preset:copilot-sub-agents").ready, false);
        assert.equal(result.checks.find((entry) => entry.id === "extension:assess").ready, false);
    });

    test("does not infer extension priority from its description", async () => {
        const { root } = await installedWorkspace();
        const result = await inspectSetup({
            cwd: root, setup: { ...contract, presets: [] },
            runSpecify: async () => "  ✓ Assess (v1.0.0)\n    assess\n    Description priority 10\n",
        });
        assert.equal(result.diskReady, false);
        assert.match(result.checks.find((entry) => entry.id === "extension:assess").message, /priority is unknown/);
    });

    test("fingerprints same-size same-mtime skill content changes", async () => {
        const { root, runSpecify } = await installedWorkspace();
        const args = { cwd: root, setup: contract, runSpecify };
        const before = await inspectSetup(args);
        const path = join(root, ".github", "skills", "speckit-assess-intake", "SKILL.md");
        const original = await stat(path);
        await writeFile(path, "# edited\n");
        await utimes(path, original.atime, original.mtime);
        assert.equal((await stat(path)).size, original.size);
        const after = await inspectSetup(args);
        assert.equal(after.diskReady, true);
        assert.notEqual(after.diskFingerprint, before.diskFingerprint);
    });

    test("rejects evidence changed during the CLI query", async () => {
        const { root, runSpecify, inventory } = await installedWorkspace();
        const result = await inspectSetup({
            cwd: root, setup: contract,
            runSpecify: async (args, cwd) => {
                const output = await runSpecify(args, cwd);
                inventory[args[0]][0].priority += 1;
                await writeRegistry(root, args[0], inventory[args[0]]);
                return output;
            },
        });
        assert.equal(result.diskReady, false);
        assert.match(result.checks.find((entry) => entry.id === "preset:copilot-sub-agents").message, /changed while verifying/);
    });

    test("rejects initialized projects that are not in Copilot skills mode", async () => {
        const root = await workspace();
        await mkdir(join(root, ".specify"), { recursive: true });
        await writeFile(join(root, ".specify", "init-options.json"), JSON.stringify({
            integration: "copilot",
            ai_skills: false,
        }));
        const result = await inspectSetup({ cwd: root, setup: { ...contract, presets: [], extensions: [], requiredSkills: [] } });
        assert.equal(result.diskReady, false);
        assert.equal(result.checks.find((entry) => entry.id === "spec-kit-init").ready, false);
    });

    test("builds a workflow-general agent prompt and stable contract fingerprint", () => {
        const prompt = buildSetupPrompt({ setup: contract, instanceId: "generated-1" });
        assert.match(prompt, /\/skill:speckit-cli-setup/);
        assert.match(prompt, /\/skill:speckit-init/);
        assert.match(prompt, /\/skill:speckit-preset/);
        assert.match(prompt, /\/skill:speckit-extension/);
        assert.match(prompt, /reloadSessionSkills/);
        assert.doesNotMatch(prompt, /copilot skill list/);
        assert.match(prompt, /current session's reloadSessionSkills result as the loaded-registry authority/);
        assert.match(prompt, /speckit-assess-intake/);
        assert.match(prompt, /listed precedence order \(highest precedence first\)/);
        assert.match(prompt, /Set its resolution priority to 1/);
        assert.match(prompt, /Set its resolution priority to 10/);
        assert.match(prompt, /Preserve unrelated installed contributions/);
        assert.match(prompt, /already approved.*community/);
        assert.match(prompt, /does not bypass platform permissions/);
        assert.match(prompt, /never edit registries directly/);
        assert.match(prompt, /relative order/);
        assert.doesNotMatch(prompt, /manually authored assess canvas/i);
        assert.equal(setupContractFingerprint(contract), setupContractFingerprint(structuredClone(contract)));
    });
});
