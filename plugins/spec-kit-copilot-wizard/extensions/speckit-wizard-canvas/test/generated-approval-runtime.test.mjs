// Regression coverage for standalone setup consent and installation approval.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import {
    acceptInstallationApproval, approvalComponents, readInstallationApproval, requiresInstallationApproval,
} from "../generation/generated-canvas-template/approval-runtime.mjs";
import { setupContractFingerprint } from "../generation/generated-canvas-template/setup-runtime.mjs";

const roots = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function context() {
    const cwd = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), ".approval-test-"));
    roots.push(cwd);
    return {
        cwd, extensionId: "assess-review", identity: "project:assess-review:assess-review",
        setup: {
            requireInstallationApproval: true,
            integration: { id: "copilot", skillsMode: true },
            requiredSkills: [],
            presets: [{ kind: "preset", id: "questions", enabled: false, priority: 2, precedence: 0 }],
            extensions: [{ kind: "extension", id: "assess", enabled: true, source: { name: "community", url: "https://example.test/assess.zip", direct: true } }],
        },
    };
}

test("approval defaults off and empty lists need no consent", async () => {
    for (const setup of [{}, { requireInstallationApproval: false, extensions: [{ id: "x" }] }, { requireInstallationApproval: true, extensions: [], presets: [] }]) {
        assert.equal(requiresInstallationApproval(setup), false);
        assert.deepEqual(await readInstallationApproval({ setup }), { required: false, approved: true });
    }
    assert.throws(() => requiresInstallationApproval({ requireInstallationApproval: "false" }), /boolean/);
});

test("consent persists exact configuration without altering installation evidence", async () => {
    const ctx = await context();
    const initial = await readInstallationApproval(ctx);
    assert.equal(initial.approved, false);
    assert.deepEqual(initial.components, approvalComponents(ctx.setup));
    await assert.rejects(readFile(join(ctx.cwd, ".speckit-wizard", "canvas-approvals", "assess-review.json")), { code: "ENOENT" });
    const results = await Promise.all([acceptInstallationApproval(ctx, initial.fingerprint), acceptInstallationApproval(ctx, initial.fingerprint)]);
    assert.ok(results.every((entry) => entry.approved));
    assert.equal((await readInstallationApproval(ctx)).approved, true);
    const directory = join(ctx.cwd, ".speckit-wizard", "canvas-approvals");
    const recordPath = join(directory, "assess-review.json");
    const recorded = await readFile(recordPath, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await acceptInstallationApproval(ctx, initial.fingerprint);
    assert.equal(await readFile(recordPath, "utf8"), recorded, "Repeated panel approval must not replace identical consent.");
    assert.deepEqual(await readdir(directory), ["assess-review.json"]);
    assert.deepEqual(await readdir(ctx.cwd), [".speckit-wizard"]);
});

test("consent does not cross workspaces, canvas identities, or changed contracts", async () => {
    const ctx = await context();
    const fingerprint = setupContractFingerprint(ctx.setup);
    await acceptInstallationApproval(ctx, fingerprint);
    assert.equal((await readInstallationApproval({ ...ctx, identity: "project:another:another" })).approved, false);
    assert.equal((await readInstallationApproval({ ...ctx, extensionId: "another" })).approved, false);
    const other = await context();
    const original = await readFile(join(ctx.cwd, ".speckit-wizard", "canvas-approvals", "assess-review.json"));
    await mkdir(join(other.cwd, ".speckit-wizard", "canvas-approvals"), { recursive: true });
    await writeFile(join(other.cwd, ".speckit-wizard", "canvas-approvals", "assess-review.json"), original);
    assert.equal((await readInstallationApproval({ ...ctx, cwd: other.cwd })).approved, false);
    for (const mutate of [
        (setup) => { setup.presets[0].priority++; },
        (setup) => { setup.presets[0].enabled = true; },
        (setup) => { setup.extensions[0].source.url = "https://example.test/new.zip"; },
        (setup) => { setup.extensions.push({ id: "extra" }); },
    ]) {
        const setup = structuredClone(ctx.setup);
        mutate(setup);
        assert.equal((await readInstallationApproval({ ...ctx, setup })).approved, false);
        await assert.rejects(acceptInstallationApproval({ ...ctx, setup }, fingerprint), /contract changed/);
    }
    assert.equal((await readInstallationApproval({ ...ctx, displayName: "Cosmetic heading" })).approved, true);
});

test("malformed, oversized, and non-file records fail explicitly", async () => {
    const ctx = await context();
    const directory = join(ctx.cwd, ".speckit-wizard", "canvas-approvals");
    await mkdir(directory, { recursive: true });
    const file = join(directory, "assess-review.json");
    for (const payload of ["{", "{}", "x".repeat(17000)]) {
        await writeFile(file, payload);
        await assert.rejects(readInstallationApproval(ctx), /Cannot read installation approval/);
        await assert.rejects(acceptInstallationApproval(ctx, setupContractFingerprint(ctx.setup)), /Cannot read installation approval/);
    }
    await rm(file);
    await mkdir(file);
    await assert.rejects(readInstallationApproval(ctx), /Unsafe/);
    await assert.rejects(acceptInstallationApproval(ctx, setupContractFingerprint(ctx.setup)), /Unsafe/);
    await assert.rejects(readInstallationApproval({ ...ctx, extensionId: "../escape" }), /Unsafe/);
});

test("approval metadata cannot follow a directory link", async () => {
    const ctx = await context();
    const outside = await context();
    await symlink(outside.cwd, join(ctx.cwd, ".speckit-wizard"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(readInstallationApproval(ctx), /Unsafe approval metadata directory/);
    await assert.rejects(acceptInstallationApproval(ctx, setupContractFingerprint(ctx.setup)), /Unsafe approval metadata directory/);
    assert.deepEqual(await readdir(outside.cwd), []);
});
