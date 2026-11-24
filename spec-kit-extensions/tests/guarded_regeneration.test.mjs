import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { materialize, readBoundedSessionFile } from "../extension-canvas-design/scripts/generate.mjs";
import { freezeGeneration } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/generation.mjs";
import { addWorkflowFixture } from "./workflow_fixture.mjs";
import { addDesignerAdapterFixture } from "./designer_adapter_fixture.mjs";

const model = {
    revision: "test-revision", settingsRevision: 0,
    pages: [{ page: "designer-essentials", fields: [
        { id: "canvas.id" }, { id: "canvas.displayName" }, { id: "canvas.description" },
        { id: "canvas.workflowListName" }, { id: "workflowSlug.userProvided" },
    ] }],
    constraints: {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100,
            pattern: "^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]*$" },
        "canvas.displayName": { type: "string", minLength: 1, maxLength: 120 },
        "canvas.description": { type: "string", maxLength: 240 },
        "canvas.workflowListName": { type: "string", maxLength: 80 },
        "workflowSlug.userProvided": { type: "boolean" },
    },
};
const handoff = {
    handoffId: "handoff-1", selections: { presets: [], extensions: [], bundles: [] },
    workflow: { selectedPhases: ["constitution", "specify", "plan"],
        installed: { presets: [{ id: "copilot-sub-agents", source: "copilot",
            version: "1.0.0", priority: 1 }], extensions: [], bundles: [] } },
};
handoff.sourceFingerprint = createHash("sha256").update(JSON.stringify({
    workflow: handoff.workflow, selections: handoff.selections,
})).digest("hex");

async function fixture(t, generate = true) {
    const root = await mkdtemp(join(process.cwd(), ".guarded-regeneration-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, "project"), workspace = join(root, "workspace");
    await mkdir(project);
    await mkdir(workspace);
    await addDesignerAdapterFixture(project, model);
    await addWorkflowFixture(project, model);
    const handoffFolder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
    await mkdir(handoffFolder, { recursive: true });
    await writeFile(join(handoffFolder, "handoff.json"), JSON.stringify(handoff));
    const values = { "canvas.id": "my-workflow", "canvas.displayName": "First",
        "canvas.description": "A workflow", "canvas.workflowListName": "Workflows",
        "workflowSlug.userProvided": false };
    const first = await freezeGeneration({ project, workspace, model, values, handoff });
    const sdk = join(project, ".github", "extensions", values["canvas.id"]);
    const next = await freezeGeneration({ project, workspace, model,
        values: { ...values, "canvas.displayName": "Second" }, handoff });
    if (generate) await materialize(project, workspace, handoff.handoffId, first.requestId);
    const regenerate = (replaceExisting) =>
        materialize(project, workspace, handoff.handoffId, next.requestId, replaceExisting);
    return { project, workspace, sdk, first, next, regenerate };
}

test("direct generation refuses occupied empty targets without changing them", async (t) => {
    const { project, workspace, sdk, first } = await fixture(t, false);
    await mkdir(sdk, { recursive: true });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, first.requestId),
        /Canvas extension already exists/);
    assert.deepEqual(await readdir(sdk), []);
});

test("replacement requires explicit confirmation and preserves the old app on cancellation", async (t) => {
    const { sdk, first, regenerate } = await fixture(t);
    const directory = await lstat(sdk);
    const before = await readFile(join(sdk, "canvas-config.json"), "utf8");
    await assert.rejects(regenerate(false), /already exists/);
    assert.equal(await readFile(join(sdk, "canvas-config.json"), "utf8"), before);
    await assert.rejects(regenerate(true), /Invalid replaceExisting confirmation/);
    assert.equal(await readFile(join(sdk, "canvas-config.json"), "utf8"), before);
    await assert.rejects(regenerate("--replace-existing=stale-request"),
        /Canvas changed since replacement was confirmed/);
    assert.equal(await readFile(join(sdk, "canvas-config.json"), "utf8"), before);
    await regenerate(`--replace-existing=${first.requestId}`);
    assert.notEqual((await lstat(sdk)).ino, directory.ino);
    assert.equal(JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8")).canvas.displayName, "Second");
    assert.deepEqual((await readdir(join(sdk, ".."))).filter((name) => name.startsWith(".my-workflow-")), []);
});

test("published replacement reports a locked backup as a warning without losing success", async (t) => {
    const { sdk, first, next, regenerate } = await fixture(t);
    const originalRm = fs.rm;
    let backupDir;
    const backupPrefix = join(sdk, "..", ".my-workflow-backup-");
    fs.rm = async (path, options) => {
        if (path.startsWith(backupPrefix)) {
            backupDir = path;
            throw Object.assign(new Error("Locked backup fixture"), { code: "EPERM" });
        }
        return originalRm(path, options);
    };
    syncBuiltinESMExports();
    let result;
    try {
        result = await regenerate(`--replace-existing=${first.requestId}`);
    } finally {
        fs.rm = originalRm;
        syncBuiltinESMExports();
    }
    assert.equal(result.canvasId, "my-workflow");
    assert.equal(result.target, ".github/extensions/my-workflow/");
    assert.ok(backupDir);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /replacement was published.*Locked backup fixture/);
    assert.ok(result.warnings[0].includes(backupDir));
    assert.equal(JSON.parse(await readFile(join(sdk, "settings-provenance.json"), "utf8")).requestId,
        next.requestId);
    assert.equal(JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8")).canvas.displayName,
        "Second");
    assert.equal(JSON.parse(await readFile(join(backupDir, "previous", "canvas-config.json"), "utf8"))
        .canvas.displayName, "First");
    await assert.rejects(regenerate(`--replace-existing=${first.requestId}`),
        /Canvas changed since replacement was confirmed/);
});

test("publication failure rolls back the old canvas and permits retry", async (t) => {
    const { sdk, first, regenerate } = await fixture(t);
    const originalRename = fs.rename;
    const stagePrefix = join(sdk, "..", ".my-workflow-stage-");
    fs.rename = async (source, destination) => {
        if (source.startsWith(stagePrefix) && destination === sdk) {
            throw Object.assign(new Error("Publication fixture failure"), { code: "EIO" });
        }
        return originalRename(source, destination);
    };
    syncBuiltinESMExports();
    try {
        await assert.rejects(regenerate(`--replace-existing=${first.requestId}`),
            /Publication fixture failure/);
    } finally {
        fs.rename = originalRename;
        syncBuiltinESMExports();
    }
    assert.equal(JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8")).canvas.displayName,
        "First");
    assert.deepEqual((await readdir(join(sdk, ".."))).filter((name) => name.startsWith(".my-workflow-")), []);
    await regenerate(`--replace-existing=${first.requestId}`);
    assert.equal(JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8")).canvas.displayName,
        "Second");
});

test("confirmed replacement discards regular manual edits and extra files", async (t) => {
    const { sdk, first, regenerate } = await fixture(t);
    await writeFile(join(sdk, "extension.mjs"), "manual change");
    const configPath = join(sdk, "canvas-config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(configPath, JSON.stringify({ ...config, canvas: {
        ...config.canvas, displayName: "Locally modified",
    }, workflowPage: { ...config.workflowPage, adapter: "locally-modified" } }));
    await mkdir(join(sdk, "custom"));
    await writeFile(join(sdk, "custom", "notes.txt"), "my notes");
    await assert.rejects(regenerate(false), /already exists/);
    assert.equal(await readFile(join(sdk, "custom", "notes.txt"), "utf8"), "my notes");
    await regenerate(`--replace-existing=${first.requestId}`);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).canvas.displayName, "Second");
    assert.notEqual(await readFile(join(sdk, "extension.mjs"), "utf8"), "manual change");
    await assert.rejects(readFile(join(sdk, "custom", "notes.txt")), /ENOENT/);
});

test("replacement rejects forged provenance, unrelated canvas identity and incomplete output", async (t) => {
    for (const corrupt of [
        async (sdk) => writeFile(join(sdk, "settings-provenance.json"), JSON.stringify({
            requestId: "forged", handoffId: handoff.handoffId, sourceFingerprint: handoff.sourceFingerprint,
        })),
        async (sdk) => {
            const path = join(sdk, "settings-provenance.json");
            const original = JSON.parse(await readFile(path, "utf8"));
            await writeFile(path, JSON.stringify({ ...original, handoffId: "another-handoff" }));
        },
        async (sdk) => {
            const path = join(sdk, "canvas-config.json");
            const original = JSON.parse(await readFile(path, "utf8"));
            await writeFile(path, JSON.stringify({ ...original, canvas: { ...original.canvas, id: "foreign" } }));
        },
        async (sdk) => rm(join(sdk, "extension.mjs")),
        async (sdk) => rm(join(sdk, "pages", "workflow.json")),
        async (sdk) => writeFile(join(sdk, "settings-provenance.json"),
            "x".repeat(4 * 1024 * 1024 + 1)),
    ]) {
        const { sdk, first, regenerate } = await fixture(t);
        await corrupt(sdk);
        const before = await readdir(sdk);
        await assert.rejects(regenerate(`--replace-existing=${first.requestId}`), /cannot be safely replaced|Incomplete/);
        assert.deepEqual(await readdir(sdk), before);
    }
});

test("replacement metadata reader rejects an entry swapped after opening", async (t) => {
    const { sdk } = await fixture(t);
    const path = join(sdk, "settings-provenance.json");
    await assert.rejects(readBoundedSessionFile(sdk, "settings-provenance.json",
        4 * 1024 * 1024, "Existing generated settings-provenance.json",
        async (file, flags) => {
            const descriptor = await open(file, flags);
            await rename(path, `${path}.prior`);
            await writeFile(path, '{"forged":true}');
            return descriptor;
        }), /bounded regular session file/);
});

test("replacement refuses symlinked canvas and symlinked contents", async (t) => {
    const { sdk, first, regenerate } = await fixture(t);
    await writeFile(join(sdk, "linked-entry.mjs"), "manual");
    try { await symlink(join(sdk, "linked-entry.mjs"), join(sdk, "manual-link.mjs")); }
    catch (error) {
        if (error.code === "EPERM") { t.skip("Symlinks require Windows developer mode"); return; }
        throw error;
    }
    await assert.rejects(regenerate(`--replace-existing=${first.requestId}`), /link/);
    assert.ok((await lstat(join(sdk, "manual-link.mjs"))).isSymbolicLink());
});

test("failed staging leaves any existing canvas intact and can be retried", async (t) => {
    for (const generate of [false, true]) {
        const { project, sdk, workspace, first, next, regenerate } = await fixture(t, generate);
        const original = generate ? await readFile(join(sdk, "canvas-config.json"), "utf8") : null;
        const preload = join(workspace, "fail-renderer.cjs");
        await writeFile(preload, `if (process.execArgv.includes("-e")
            && process.argv[1]?.endsWith("/server.mjs")) {
            const { existsSync } = require("node:fs");
            const { fileURLToPath } = require("node:url");
            const { dirname, join } = require("node:path");
            if (existsSync(join(dirname(fileURLToPath(process.argv[1])), "extension.mjs"))) {
                throw new Error("Entry point exposed before render validation");
            }
            throw new Error("Renderer fixture failure");
        }`);
        const previousOptions = process.env.NODE_OPTIONS;
        process.env.NODE_OPTIONS = [previousOptions,
            `--require="${preload.replaceAll("\\", "\\\\")}"`]
            .filter(Boolean).join(" ");
        try {
            const run = generate ? regenerate(`--replace-existing=${first.requestId}`)
                : materialize(project, workspace, handoff.handoffId, next.requestId);
            await assert.rejects(run, (error) => {
                assert.match(error.message, /Workflow renderer failed:/);
                assert.match(error.message, /Renderer fixture failure/);
                return true;
            });
        } finally {
            if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
            else process.env.NODE_OPTIONS = previousOptions;
        }
        if (generate) {
            assert.equal(await readFile(join(sdk, "canvas-config.json"), "utf8"), original);
        } else {
            await assert.rejects(lstat(sdk), /ENOENT/);
        }
        assert.deepEqual((await readdir(join(sdk, ".."))).filter((name) => name.startsWith(".my-workflow-")), []);
        if (generate) await regenerate(`--replace-existing=${first.requestId}`);
        else await materialize(project, workspace, handoff.handoffId, next.requestId);
        assert.equal(JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8")).canvas.displayName, "Second");
    }
});

test("failed cleanup reports both errors and the target path", async (t) => {
    const { sdk, first, regenerate } = await fixture(t);
    const originalRm = fs.rm;
    const originalWriteFile = fs.writeFile;
    const stagePrefix = join(sdk, "..", ".my-workflow-stage-");
    fs.writeFile = async (path, ...args) => {
        if (path.startsWith(stagePrefix) && path.endsWith("canvas-config.json")) {
            throw new Error("Staging fixture failure");
        }
        return originalWriteFile(path, ...args);
    };
    fs.rm = async (path, options) => {
        if (path.startsWith(stagePrefix)) {
            throw Object.assign(new Error("Locked staging fixture"), { code: "EPERM" });
        }
        return originalRm(path, options);
    };
    syncBuiltinESMExports();
    try {
        await assert.rejects(regenerate(`--replace-existing=${first.requestId}`), (error) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 2);
            assert.ok(error.message.includes(stagePrefix));
            assert.match(error.message, /Staging fixture failure/);
            assert.match(error.message, /Locked staging fixture/);
            return true;
        });
    } finally {
        fs.rm = originalRm;
        fs.writeFile = originalWriteFile;
        syncBuiltinESMExports();
    }
    assert.ok((await lstat(sdk)).isDirectory());
});
