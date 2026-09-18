import assert from "node:assert/strict";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, test } from "node:test";
import { EventEmitter } from "node:events";
import { compileBlueprint } from "../generation/compiler.mjs";
import {
    resolveWorkspaceDirectory,
    revealWorkspaceDirectory,
} from "../generation/generated-canvas-template/workspace-files.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const template = join(here, "..", "generation", "generated-canvas-template");
const roots = [];
const closeCanvases = [];

afterEach(async () => {
    await Promise.all(closeCanvases.splice(0).map((close) => close()));
    delete globalThis.__generatedCanvasSdk;
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 20));
}

async function waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for generated canvas lifecycle");
        await settle();
    }
}

async function loadGeneratedExtension(root, sdk, {
    workflowConfig = { version: 1, itemLabels: {}, phaseArguments: {} },
    setup = {
        requiresSpecKit: true,
        integration: { id: "copilot", skillsMode: true },
        requiredSkills: [],
        presets: [],
        extensions: [],
    },
    runtime = { visualization: "project", itemRoot: null, userProvidesSlug: false, multiInstance: false },
    artifact = null,
    extensionId = "generated-lifecycle",
    blueprint,
} = {}) {
    const extensionRoot = join(root, "extension");
    await mkdir(join(extensionRoot, "ui"), { recursive: true });
    await copyFile(join(template, "setup-runtime.mjs"), join(extensionRoot, "setup-runtime.mjs"));
    await copyFile(join(template, "approval-runtime.mjs"), join(extensionRoot, "approval-runtime.mjs"));
    await copyFile(join(template, "workspace-files.mjs"), join(extensionRoot, "workspace-files.mjs"));
    await copyFile(join(template, "workflow-adapter.mjs"), join(extensionRoot, "workflow-adapter.mjs"));
    await copyFile(join(template, "project-artifacts.mjs"), join(extensionRoot, "project-artifacts.mjs"));
    await copyFile(join(template, "ui", "command-views.mjs"), join(extensionRoot, "ui", "command-views.mjs"));
    await copyFile(join(template, "ui", "workflow-slug.mjs"), join(extensionRoot, "ui", "workflow-slug.mjs"));
    await writeFile(join(extensionRoot, "workflow-config.json"), JSON.stringify(workflowConfig), "utf8");
    await writeFile(join(extensionRoot, "pipeline.json"), JSON.stringify(blueprint ?? {
        setup,
        runtime,
        pipeline: {
            steps: [{
                index: 0,
                instanceKey: "speckit.specify#0",
                commandName: "speckit.specify",
                skillName: "speckit-specify",
                invocation: "/skill:speckit-specify",
                artifact,
            }],
        },
    }), "utf8");
    let source = await readFile(join(template, "extension.mjs"), "utf8");
    source = source
        .replace('import { joinSession, createCanvas } from "@github/copilot-sdk/extension";',
            "const { joinSession, createCanvas, runSpecify } = globalThis.__generatedCanvasSdk;")
        .replace("    inspectSetup,", "    inspectSetup as inspectSetupImpl,")
        .replace("const here =", "const inspectSetup = (options) => inspectSetupImpl({ ...options, ...(runSpecify ? { runSpecify } : {}) });\nconst here =")
        .replaceAll("__EXTENSION_ID_JSON__", JSON.stringify(extensionId))
        .replaceAll("__DISPLAY_NAME_JSON__", JSON.stringify("Generated Lifecycle"))
        .replaceAll("__DESCRIPTION_JSON__", JSON.stringify("Lifecycle test"));
    await writeFile(join(extensionRoot, "extension.mjs"), source, "utf8");
    globalThis.__generatedCanvasSdk = {
        ...sdk,
        createCanvas(definition) {
            const ids = new Set();
            const open = definition.open;
            definition.open = async (ctx) => { ids.add(ctx.instanceId); return open(ctx); };
            closeCanvases.push(async () => {
                for (const instanceId of ids) await definition.onClose({ instanceId });
            });
            return sdk.createCanvas(definition);
        },
    };
    await import(`${pathToFileURL(join(extensionRoot, "extension.mjs")).href}?test=${Date.now()}`);
    return extensionRoot;
}

describe("generated extension setup lifecycle", () => {
    for (const readiness of ["ready", "missing", "failed", "approval-required"]) {
        test(`rejects invalid slugs before gates, queues and dispatch when setup is ${readiness}`, async () => {
            const root = await mkdtemp(join(here, ".generated-lifecycle-"));
            roots.push(root);
            const workspace = join(root, "workspace with spaces");
            await mkdir(workspace);
            const initialize = async () => {
                await mkdir(join(workspace, ".specify"), { recursive: true });
                await writeFile(join(workspace, ".specify", "init-options.json"), '{"integration":"copilot","ai_skills":true}');
            };
            if (readiness === "ready") await initialize();
            let canvas;
            let failSetup = readiness === "failed";
            const sent = [];
            await loadGeneratedExtension(root, {
                createCanvas: (definition) => (canvas = definition),
                runSpecify: async () => "No extensions installed.",
                joinSession: async () => ({
                    send: async ({ prompt }) => {
                        sent.push(prompt);
                        if (failSetup) throw new Error("fixture setup failure");
                    },
                    rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                    log: async () => {},
                }),
            }, {
                runtime: { itemRoot: ".specify/items/<slug>", multiInstance: true, userProvidesSlug: true },
                artifact: { pathTemplate: ".specify/items/<slug>/spec.md" },
                ...(readiness === "approval-required" ? { setup: {
                    requireInstallationApproval: true,
                    integration: { id: "copilot", skillsMode: true }, requiredSkills: [], presets: [],
                    extensions: [{ kind: "extension", id: "assess", enabled: true, priority: 10, precedence: 0 }],
                } } : {}),
            });
            const opened = await canvas.open({ instanceId: "slug-validation", input: { cwd: workspace } });
            const action = (name, input = {}) => canvas.actions.find((entry) => entry.name === name).handler({ instanceId: "slug-validation", input });
            if (readiness === "missing" || readiness === "failed") await waitFor(() => sent.length > 0);
            const before = sent.length;
            const url = new URL(opened.url);
            url.pathname = "/api/run";
            for (const slug of ["Bad-slug", "two words", "a--b", "-a", "a-", "../outside", "con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"]) {
                const input = { phase: "speckit.specify#0", itemId: "__new__", slug };
                const expected = {
                    ok: false, queued: false, code: "invalid_workflow_slug",
                    error: /^(con|prn|aux|nul|com[19]|lpt[19])$/.test(slug)
                        ? "This name is reserved on Windows. Choose another workflow slug."
                        : "Use lowercase letters, numbers, and single hyphens only.",
                };
                assert.deepEqual(await action("run_phase", input), expected);
                const response = await fetch(url, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
                });
                assert.equal(response.status, 400);
                assert.deepEqual(await response.json(), expected);
                assert.equal(sent.length, before, "invalid runs cannot trigger setup retry or phase dispatch");
            }
            if (readiness === "approval-required") {
                assert.equal(before, 0);
                assert.equal((await action("run_phase", { phase: "speckit.specify#0", slug: "corrected" })).code, "installation_approval_required");
                return;
            }
            failSetup = false;
            await initialize();
            assert.equal((await action("reloadSessionSkills")).ok, true);
            await settle();
            assert.equal(sent.length, before, "readiness must not replay any invalid queued requests");
            for (const slug of ["", " \t "]) {
                assert.equal((await action("run_phase", { phase: "speckit.specify#0", itemId: "__new__", slug })).ok, true);
                assert.equal(sent.at(-1), "/skill:speckit-specify", "blank input keeps automatic naming");
            }
            const response = await fetch(url, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phase: "speckit.specify#0", itemId: "__new__", slug: "  corrected-slug  ", args: "Preserved input" }),
            });
            assert.equal(response.status, 202);
            assert.equal((await response.json()).ok, true);
            assert.equal(sent.at(-1), "/skill:speckit-specify slug=corrected-slug Preserved input");
        });
    }

    test("clarification draft scope is stable across panels and isolated by workspace and canvas", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const first = join(root, "first"), second = join(root, "second");
        await Promise.all([mkdir(first), mkdir(second)]);
        let canvas;
        const sent = [];
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({
                send: async (input) => sent.push(input),
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, { setup: { requiresSpecKit: false, requiredSkills: [], presets: [], extensions: [] } });
        const readScope = async (instanceId, cwd, extensionId = "project:clarification-scope") => {
            const opened = await canvas.open({ instanceId, extensionId, canvasId: "scope", input: { cwd } });
            const url = new URL(opened.url);
            url.pathname = "/api/state";
            return (await (await fetch(url)).json()).clarificationScope;
        };
        const scope = await readScope("first-panel", first);
        assert.match(scope, /^[a-f0-9]{64}$/);
        assert.equal(await readScope("second-panel", first), scope);
        assert.notEqual(await readScope("other-workspace", second), scope);
        assert.notEqual(await readScope("other-canvas", first, "project:other-canvas"), scope);
        assert.equal(sent.filter(({ prompt }) => prompt.startsWith("/skill:")).length, 0, "snapshot reads do not dispatch phases");
    });

    test("HTTP dispatch and reload failures never expose thrown SDK details", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, ".specify"), { recursive: true });
        await writeFile(join(workspace, ".specify", "init-options.json"), '{"integration":"copilot","ai_skills":true}');
        let canvas;
        let failure;
        let reloadFails = false;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({
                send: async () => { throw failure; },
                rpc: { skills: { reload: async () => {
                    if (reloadFails) throw failure;
                    return { errors: [], warnings: [] };
                } } },
                log: async () => {},
            }),
        });
        const opened = await canvas.open({ instanceId: "private-errors", input: { cwd: workspace } });
        const url = new URL(opened.url);
        url.pathname = "/api/run";
        for (failure of [
            new Error("PRIVATE_SDK_DETAIL\n    at private-sdk.mjs:42:1"),
            "PRIVATE_STRING_DETAIL\n    at private-sdk.mjs:42:1",
            null,
        ]) {
            const response = await fetch(url, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phase: "speckit.specify#0" }),
            });
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: "invalid request or unavailable workflow resource" });
        }
        failure = new Error("PRIVATE_RELOAD_DETAIL\n    at private-sdk.mjs:42:1");
        reloadFails = true;
        const result = await canvas.actions.find((action) => action.name === "reloadSessionSkills")
            .handler({ instanceId: "private-errors", input: {} });
        assert.equal(result.ok, false);
        assert.equal(result.error, "Session skills could not be reloaded. Retry the skill reload.");
        url.pathname = "/api/state";
        const state = await (await fetch(url)).json();
        assert.equal(state.setup.state, "failed");
        assert.doesNotMatch(JSON.stringify(state), /PRIVATE_|private-sdk/);
    });

    test("selected Constitution gates setup queue, HTTP, actions and reruns without item side effects", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, "specs", "existing"), { recursive: true });
        const blueprint = compileBlueprint({
            pipeline: [{ id: "specify" }, { id: "plan" }, { id: "constitution" }],
        }, { extensionId: "constitution-runtime", displayName: "Constitution", description: "Test." }, { userProvidesSlug: true });
        const constitution = blueprint.pipeline.steps.at(-1);
        const phase = blueprint.pipeline.steps[0];
        const sent = [];
        let canvas;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({
                send: async ({ prompt }) => { sent.push(prompt); },
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, { blueprint });
        const opened = await canvas.open({ instanceId: "constitution-first", input: { cwd: workspace } });
        await canvas.open({ instanceId: "constitution-second", input: { cwd: workspace } });
        const action = (name, input = {}, instanceId = "constitution-first") => canvas.actions.find((entry) => entry.name === name).handler({ instanceId, input });
        const http = async (path, input) => {
            const url = new URL(opened.url);
            url.pathname = path;
            const response = await fetch(url, input === undefined ? {} : {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
            });
            return { status: response.status, data: await response.json() };
        };
        const queued = await action("run_phase", { phase: phase.instanceKey, itemId: "__new__", slug: "unreserved", args: "saved draft" });
        assert.equal(queued.queued, true);
        assert.equal(sent.filter((prompt) => prompt.startsWith("/skill:")).length, 0);
        await mkdir(join(workspace, ".specify", "memory"), { recursive: true });
        await writeFile(join(workspace, ".specify", "init-options.json"), '{"integration":"copilot","ai_skills":true}');
        for (const skill of blueprint.setup.requiredSkills) {
            await mkdir(join(workspace, ".github", "skills", skill.name), { recursive: true });
            await writeFile(join(workspace, ".github", "skills", skill.name, "SKILL.md"), `# ${skill.name}`);
        }
        assert.equal((await action("reloadSessionSkills")).ok, true);
        await settle();
        assert.equal(sent.filter((prompt) => prompt.startsWith("/skill:")).length, 0, "queued phase must be discarded when Constitution is missing");
        assert.equal((await action("run_phase", { phase: phase.instanceKey, itemId: "__new__", slug: "unreserved" })).code, "constitution_required");
        const blockedHttp = await http("/api/run", { phase: phase.instanceKey, itemId: "existing", args: "do not lose" });
        assert.deepEqual([blockedHttp.data.code, blockedHttp.data.queued], ["constitution_required", false]);
        assert.equal((await http("/api/run", { phase: constitution.instanceKey, itemId: "existing", slug: "bad" })).status, 400);
        await action("run_phase", { phase: constitution.instanceKey, args: "Testing and accessible UX" });
        assert.equal(sent.at(-1), "/skill:speckit-constitution Testing and accessible UX");
        let state = (await http("/api/state")).data;
        assert.equal(state.projectArtifacts.constitution.state, "missing", "send acknowledgement cannot mark ready");
        assert.equal(state.items.length, 2);
        assert.ok(state.items.every((item) => !Object.hasOwn(item.phases, constitution.instanceKey)));
        assert.deepEqual(Object.keys(state.phaseInputs), blueprint.pipeline.steps.map((step) => step.instanceKey));
        const artifact = join(workspace, ".specify", "memory", "constitution.md");
        await writeFile(artifact, "# [PROJECT_NAME]\n[PRINCIPLE_1]");
        assert.equal((await action("run_phase", { phase: phase.instanceKey })).code, "constitution_required");
        await writeFile(artifact, "# Project principles\nTest changes before shipping.");
        for (const instanceId of ["constitution-first", "constitution-second"]) {
            assert.equal((await action("list_items", {}, instanceId)).projectArtifacts.constitution.state, "ready");
        }
        const previewUrl = new URL(opened.url);
        previewUrl.pathname = "/api/artifact";
        previewUrl.searchParams.set("path", ".specify/memory/constitution.md");
        assert.match((await (await fetch(previewUrl)).json()).content, /Test changes/);
        await action("run_phase", { phase: phase.instanceKey, itemId: "__new__", slug: "unreserved", args: "Feature idea" }, "constitution-second");
        assert.equal(sent.at(-1), "/skill:speckit-specify slug=unreserved Feature idea");
        await action("run_phase", { phase: constitution.instanceKey, args: "" });
        assert.equal(sent.at(-1), "/skill:speckit-constitution", "Constitution must not reuse a selected or reserved slug");
        await writeFile(artifact, "");
        const before = sent.length;
        assert.equal((await action("run_phase", { phase: phase.instanceKey, itemId: "existing" })).code, "constitution_required");
        assert.equal(sent.length, before, "repeat runs must be gated again");
        state = (await http("/api/state")).data;
        assert.equal(state.projectArtifacts.constitution.state, "empty");
    });

    test("Constitution-only runs after setup without a dummy workflow, binding or slug", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, ".specify"), { recursive: true });
        const blueprint = compileBlueprint({ pipeline: [{ id: "constitution" }] },
            { extensionId: "constitution-only", displayName: "Constitution", description: "Test." }, { userProvidesSlug: true });
        await mkdir(join(workspace, ".github", "skills", "speckit-constitution"), { recursive: true });
        await writeFile(join(workspace, ".github", "skills", "speckit-constitution", "SKILL.md"), "# Constitution");
        let canvas;
        const sent = [];
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({
                send: async ({ prompt }) => { sent.push(prompt); },
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, { blueprint });
        await canvas.open({ instanceId: "only", input: { cwd: workspace } });
        const queued = await canvas.actions.find((entry) => entry.name === "run_phase").handler({
            instanceId: "only", input: { phase: blueprint.pipeline.steps[0].instanceKey, args: "Queued principles" },
        });
        assert.equal(queued.queued, true);
        assert.ok(!sent.some((prompt) => prompt.startsWith("/skill:")));
        await writeFile(join(workspace, ".specify", "init-options.json"), '{"integration":"copilot","ai_skills":true}');
        await canvas.actions.find((entry) => entry.name === "reloadSessionSkills").handler({ instanceId: "only", input: {} });
        await waitFor(() => sent.includes("/skill:speckit-constitution Queued principles"));
        const list = await canvas.actions.find((entry) => entry.name === "list_items").handler({ instanceId: "only", input: {} });
        assert.deepEqual(list.items, []);
        assert.equal(list.projectArtifacts.constitution.state, "missing");
        await canvas.actions.find((entry) => entry.name === "run_phase").handler({
            instanceId: "only", input: { phase: blueprint.pipeline.steps[0].instanceKey, args: "Performance" },
        });
        assert.equal(sent.at(-1), "/skill:speckit-constitution Performance");
        await assert.rejects(lstat(join(workspace, "specs")), { code: "ENOENT" });
    });

    test("installation approval precedes both selected Constitution and normal phases", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(workspace);
        const blueprint = compileBlueprint({
            pipeline: [{ id: "constitution" }, { id: "specify" }],
            catalog: { extensions: [{ id: "assess", active: true }] },
        }, { extensionId: "constitution-approval", displayName: "Constitution", description: "Test." }, { requireInstallationApproval: true });
        let canvas;
        const sent = [];
        await loadGeneratedExtension(root, {
            runSpecify: async () => "No extensions installed.",
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({ send: async ({ prompt }) => { sent.push(prompt); }, log: async () => {} }),
        }, { blueprint });
        const opened = await canvas.open({ instanceId: "approval-constitution", input: { cwd: workspace } });
        for (const step of blueprint.pipeline.steps) {
            const result = await canvas.actions.find((entry) => entry.name === "run_phase").handler({
                instanceId: "approval-constitution", input: { phase: step.instanceKey },
            });
            assert.equal(result.code, "installation_approval_required");
            assert.equal(result.queued, false);
            const url = new URL(opened.url);
            url.pathname = "/api/run";
            const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: step.instanceKey }) });
            assert.equal((await response.json()).code, "installation_approval_required");
        }
        assert.deepEqual(sent, []);
    });

    test("approval gates every setup/run path, defers without mutation, and coalesces approved setup", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(workspace);
        const sent = [];
        let reloadCalls = 0;
        let canvas;
        const setup = {
            requireInstallationApproval: true,
            integration: { id: "copilot", skillsMode: true }, requiredSkills: [], presets: [],
            extensions: [{ kind: "extension", id: "assess", enabled: true, priority: 10, precedence: 0 }],
        };
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({
                send: async ({ prompt }) => { sent.push(prompt); },
                rpc: { skills: { reload: async () => { reloadCalls++; return { errors: [], warnings: [] }; } } },
                log: async () => {},
            }),
            runSpecify: async () => "No extensions installed.",
        }, { setup });
        const first = await canvas.open({ instanceId: "approval-first", input: { cwd: workspace } });
        const second = await canvas.open({ instanceId: "approval-second", input: { cwd: workspace } });
        const http = async (opened, path, input) => {
            const url = new URL(opened.url);
            url.pathname = path;
            const response = await fetch(url, input === undefined ? {} : {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
            });
            return { status: response.status, data: await response.json() };
        };
        const state = (await http(first, "/api/state")).data;
        assert.equal(state.setup.state, "approval-required");
        assert.deepEqual(state.setup.approval.components, setup.extensions.map((entry) => ({ ...entry, installed: false })));
        assert.equal(sent.length, 0);
        assert.equal(reloadCalls, 0);
        assert.equal(canvas.actions.some((action) => /approv|accept/i.test(action.name)), false);
        for (const name of ["setup_workflow", "reloadSessionSkills", "run_phase"]) {
            const result = await canvas.actions.find((action) => action.name === name).handler({
                instanceId: "approval-first", input: name === "run_phase" ? { phase: "speckit.specify#0" } : { approved: true },
            });
            assert.equal(result.approvalRequired, true);
            assert.equal(result.queued, false);
        }
        assert.equal((await http(first, "/api/run", { phase: "speckit.specify#0", approved: true })).status, 400);
        assert.equal((await http(first, "/api/run", { phase: "speckit.specify#0" })).data.approvalRequired, true);
        assert.equal((await http(first, "/api/setup", { approved: true })).status, 400);
        assert.equal((await http(first, "/api/setup", {})).data.approvalRequired, true);
        const { fingerprint, challenge } = state.setup.approval;
        assert.equal((await http(first, "/api/installation-approval", { action: "accept", fingerprint: "stale", challenge })).status, 400);
        assert.equal((await http(first, "/api/installation-approval", { action: "accept", fingerprint, challenge: "wrong" })).status, 400);
        await http(first, "/api/installation-approval", { action: "defer", fingerprint, challenge });
        assert.equal((await http(first, "/api/state")).data.setup.approval.state, "deferred");
        assert.equal(sent.length, 0);
        assert.equal(reloadCalls, 0);
        await assert.rejects(lstat(join(workspace, ".speckit-wizard")), { code: "ENOENT" });
        await http(first, "/api/installation-approval", { action: "review", fingerprint, challenge });
        assert.equal((await http(first, "/api/state")).data.setup.approval.state, "pending");
        const secondApproval = (await http(second, "/api/state")).data.setup.approval;
        const accepted = await Promise.all([
            http(first, "/api/installation-approval", { action: "accept", fingerprint, challenge }),
            http(second, "/api/installation-approval", { action: "accept", fingerprint, challenge: secondApproval.challenge }),
        ]);
        assert.ok(accepted.every((response) => response.status === 200 && response.data.setup.approval.approved), JSON.stringify(accepted));
        assert.equal(sent.length, 1);
        assert.equal(reloadCalls, 0);
        assert.equal((await http(first, "/api/state")).data.setup.ready, false);
        assert.ok(!sent.some((prompt) => prompt.startsWith("/skill:")));
        const third = await canvas.open({ instanceId: "approval-third", input: { cwd: workspace } });
        assert.equal((await http(third, "/api/state")).data.setup.approval.approved, true);
        await settle();
        assert.equal(sent.length, 1);
        const other = join(root, "other-workspace");
        await mkdir(other);
        const isolated = await canvas.open({ instanceId: "approval-isolated", input: { cwd: other } });
        assert.equal((await http(isolated, "/api/state")).data.setup.approval.approved, false);
        assert.equal(sent.length, 1);
    });

    test("already-installed components need no approval, reload once, and require consent only if removed", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, ".specify", "extensions", "assess"), { recursive: true });
        await writeFile(join(workspace, ".specify", "init-options.json"), JSON.stringify({ integration: "copilot", ai_skills: true }));
        await writeFile(join(workspace, ".specify", "extensions", ".registry"), JSON.stringify({ schema_version: "1.0", extensions: { assess: { enabled: true, priority: 10 } } }));
        await writeFile(join(workspace, ".specify", "extensions", "assess", "extension.yml"), "extension:\n  id: assess\n");
        let canvas;
        let reloadCalls = 0;
        const sent = [];
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({
                send: async ({ prompt }) => { sent.push(prompt); },
                rpc: { skills: { reload: async () => { reloadCalls++; return { errors: [], warnings: [] }; } } },
                log: async () => {},
            }),
            runSpecify: async () => "Installed extensions:\n\n  ✓ Assess (v1.0.0)\n     assess\n     Description\n     Commands: 1 | Hooks: 0 | Priority: 10 | Status: Enabled\n",
        }, {
            setup: {
                requireInstallationApproval: true, integration: { id: "copilot", skillsMode: true },
                requiredSkills: [], presets: [], extensions: [{ kind: "extension", id: "assess", enabled: true, priority: 10 }],
            },
        });
        const opened = await canvas.open({ instanceId: "installed-review", input: { cwd: workspace } });
        await waitFor(() => reloadCalls === 1);
        await settle();
        const url = new URL(opened.url);
        url.pathname = "/api/state";
        const initial = await (await fetch(url)).json();
        assert.equal(initial.setup.ready, true);
        assert.equal(initial.setup.approval, undefined);
        assert.equal(reloadCalls, 1);
        assert.equal(sent.length, 0);
        await canvas.open({ instanceId: "installed-another", input: { cwd: workspace } });
        assert.equal(reloadCalls, 1);
        await assert.rejects(lstat(join(workspace, ".speckit-wizard")), { code: "ENOENT" });
        await rm(join(workspace, ".specify", "extensions", "assess", "extension.yml"));
        const blocked = await canvas.actions.find((action) => action.name === "run_phase").handler({
            instanceId: "installed-another", input: { phase: "speckit.specify#0" },
        });
        assert.equal(blocked.approvalRequired, true);
        assert.equal(blocked.code, "installation_approval_error", "An incomplete registry/manifest installation is an error, not a reinstall prompt");
        assert.equal(sent.length, 0);
        assert.equal(reloadCalls, 1);
        await writeFile(join(workspace, ".specify", "extensions", "assess", "extension.yml"), "extension:\n  id: assess\n# restored by external installer\n");
        await waitFor(() => reloadCalls === 2, 5000);
        await settle();
        url.pathname = "/api/state";
        const externallyRestored = await (await fetch(url)).json();
        assert.equal(externallyRestored.setup.ready, true);
        assert.equal(externallyRestored.setup.approval, undefined);
        assert.equal(sent.length, 0, "External installation must not dispatch an installation prompt");
        await assert.rejects(lstat(join(workspace, ".speckit-wizard")), { code: "ENOENT" });
    });

    test("approved setup failures remain retryable without claiming readiness or replaying unapproved runs", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(workspace);
        let canvas;
        let calls = 0;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => (canvas = definition),
            joinSession: async () => ({
                send: async () => { calls++; if (calls === 1) throw new Error("PRIVATE_SETUP_DETAIL\n    at private-sdk.mjs:42:1"); },
                log: async () => {},
            }),
        }, { setup: {
            requireInstallationApproval: true, requiredSkills: [], presets: [],
            integration: { id: "copilot", skillsMode: true },
            extensions: [{ kind: "extension", id: "assess", enabled: true }],
        } });
        const opened = await canvas.open({ instanceId: "retry-review", input: { cwd: workspace } });
        const url = new URL(opened.url);
        url.pathname = "/api/state";
        const initial = await (await fetch(url)).json();
        url.pathname = "/api/installation-approval";
        const accepted = await (await fetch(url, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "accept", fingerprint: initial.setup.approval.fingerprint, challenge: initial.setup.approval.challenge,
            }),
        })).json();
        assert.equal(accepted.setup.approval.approved, true);
        assert.equal(accepted.setup.ready, false);
        assert.equal(accepted.setup.state, "failed");
        assert.equal(accepted.setup.message, "Setup could not be started. Retry setup.");
        assert.doesNotMatch(JSON.stringify(accepted), /PRIVATE_SETUP_DETAIL|private-sdk/);
        const retried = await canvas.actions.find((action) => action.name === "setup_workflow").handler({ instanceId: "retry-review", input: {} });
        assert.equal(retried.ok, true);
        assert.equal(calls, 2);
        url.pathname = "/api/state";
        const verifying = await (await fetch(url)).json();
        assert.equal(verifying.setup.state, "verifying");
        assert.equal(verifying.setup.ready, false);
        await canvas.onClose({ instanceId: "retry-review" });
        await canvas.open({ instanceId: "retry-reopened", input: { cwd: workspace } });
        await waitFor(() => calls === 3);
        assert.equal(calls, 3, "Closing every panel must not leave a stuck shared setup dispatch");
    });

    test("reveals regular directories with spaces using Windows and macOS argument arrays", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace with spaces");
        const output = join(workspace, ".specify", "items", "alpha");
        await mkdir(output, { recursive: true });

        assert.equal(await resolveWorkspaceDirectory(workspace, ".specify/items/alpha"), output);
        await assert.rejects(
            resolveWorkspaceDirectory(workspace, "../outside"),
            /outside workspace/i,
        );

        for (const [platform, expectedCommand] of [["win32", "explorer.exe"], ["darwin", "open"]]) {
            const calls = [];
            const revealed = await revealWorkspaceDirectory(workspace, ".specify/items/alpha", {
                pipeline: {
                    runtime: { itemRoot: ".specify/items/<slug>" },
                    pipeline: { steps: [{ artifact: { pathTemplate: ".specify/items/<slug>/spec.md" } }] },
                },
                platform,
                spawnImpl(command, args, options) {
                    calls.push({ command, args, options });
                    const child = new EventEmitter();
                    child.unref = () => {};
                    queueMicrotask(() => child.emit("spawn"));
                    return child;
                },
            });
            assert.equal(revealed, output);
            assert.deepEqual(calls, [{
                command: expectedCommand,
                args: [output],
                options: { detached: true, stdio: "ignore" },
            }]);
        }
    });

    test("shares automatic setup, reassigns a closed owner, reloads once, and queues early phase execution", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(workspace, { recursive: true });
        const sent = [];
        let reloadCalls = 0;
        let canvas;
        const session = {
            send: async ({ prompt }) => { sent.push(prompt); },
            rpc: { skills: { reload: async () => { reloadCalls += 1; return { errors: [], warnings: [] }; } } },
            log: async () => {},
        };
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => {
                canvas = definition;
                return definition;
            },
            joinSession: async () => session,
        }, {
            runtime: { visualization: "project", itemRoot: null, userProvidesSlug: true, multiInstance: false },
            workflowConfig: {
                version: 1, itemLabels: {}, phaseArguments: {},
                phaseInputs: {
                    "speckit.specify#0": {
                        label: "Feature description",
                        helper: "Describe the behavior you want to build.",
                        optional: false,
                    },
                },
            },
        });

        const firstOpen = await canvas.open({ instanceId: "first", input: { cwd: workspace } });
        const stateUrl = new URL(firstOpen.url);
        stateUrl.pathname = "/api/state";
        const stateResponse = await fetch(stateUrl);
        assert.equal(stateResponse.status, 200);
        assert.deepEqual((await stateResponse.json()).phaseInputs, {
            "speckit.specify#0": {
                label: "Feature description", helper: "Describe the behavior you want to build.", optional: false,
            },
        });
        const reopened = await canvas.open({ instanceId: "first", input: { cwd: workspace } });
        assert.equal(reopened.url, firstOpen.url);
        await canvas.open({ instanceId: "second", input: { cwd: workspace } });
        await settle();
        assert.equal(sent.length, 1);
        assert.match(sent[0], /instance `first`/);

        const runPhase = canvas.actions.find((action) => action.name === "run_phase");
        const queued = await runPhase.handler({
            instanceId: "second",
            input: { phase: "speckit.specify#0", slug: "my-workflow" },
        });
        assert.equal(queued.queued, true);
        assert.equal(sent.length, 1);

        await canvas.onClose({ instanceId: "first" });
        await settle();
        assert.equal(sent.length, 1);

        await mkdir(join(workspace, ".specify"), { recursive: true });
        await writeFile(join(workspace, ".specify", "init-options.json"), JSON.stringify({
            integration: "copilot",
            ai_skills: true,
        }), "utf8");
        const reload = canvas.actions.find((action) => action.name === "reloadSessionSkills");
        const result = await reload.handler({ instanceId: "first", input: {} });
        assert.equal(result.ok, true);
        assert.equal(reloadCalls, 1);
        await waitFor(() => sent.some((prompt) => prompt.startsWith("/skill:speckit-specify")));
        assert.match(sent.at(-1), /^\/skill:speckit-specify slug=my-workflow/);

        await runPhase.handler({ instanceId: "second", input: { phase: "speckit.specify#0" } });
        assert.equal(sent.at(-1), "/skill:speckit-specify");
        const phaseSendCount = sent.length;
        const thirdOpen = await canvas.open({ instanceId: "third", input: { cwd: workspace } });
        await settle();
        assert.ok(thirdOpen.url);
        assert.equal(sent.length, phaseSendCount);
        assert.equal(reloadCalls, 1);
        const state = await canvas.actions.find((action) => action.name === "list_items")
            .handler({ instanceId: "third", input: {} });
        assert.equal(state.setup.ready, true);
        await canvas.onClose({ instanceId: "third" });
        await canvas.onClose({ instanceId: "second" });
    });

    test("requires agent reconciliation and reuses contribution readiness across instances", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, ".specify", "extensions", "assess"), { recursive: true });
        const registryPath = join(workspace, ".specify", "extensions", ".registry");
        const writeRegistry = (enabled) => writeFile(registryPath, JSON.stringify({
            schema_version: "1.0", extensions: { assess: { enabled, priority: 10 } },
        }), "utf8");
        await writeRegistry(false);
        await writeFile(join(workspace, ".specify", "extensions", "assess", "extension.yml"), "id: assess\nversion: 1.0.0\n", "utf8");
        await writeFile(join(workspace, ".specify", "init-options.json"), JSON.stringify({
            integration: "copilot",
            ai_skills: true,
        }), "utf8");
        const sent = [];
        let reloadCalls = 0;
        let canvas;
        const session = {
            send: async ({ prompt }) => { sent.push(prompt); },
            rpc: { skills: { reload: async () => { reloadCalls += 1; return { errors: [], warnings: [] }; } } },
            log: async () => {},
        };
        await loadGeneratedExtension(root, {
            runSpecify: async () => {
                const enabled = JSON.parse(await readFile(registryPath, "utf8")).extensions.assess.enabled;
                return `  ${enabled ? "✓" : "✗"} Assess (v1.0.0)\n     assess\n     Commands: 0 | Hooks: 0 | Priority: 10 | Status: ${enabled ? "Enabled" : "Disabled"}\n`;
            },
            createCanvas: (definition) => {
                canvas = definition;
                return definition;
            },
            joinSession: async () => session,
        }, {
            setup: {
                requiresSpecKit: true,
                integration: { id: "copilot", skillsMode: true },
                requiredSkills: [],
                presets: [],
                extensions: [{ kind: "extension", id: "assess", enabled: false, priority: 10 }],
            },
        });

        await canvas.open({ instanceId: "contributions", input: { cwd: workspace } });
        await settle();
        assert.equal(sent.length, 1);
        assert.equal(reloadCalls, 0);
        assert.match(sent[0], /Preserve it as disabled/);

        const listItems = canvas.actions.find((action) => action.name === "list_items");
        const reload = canvas.actions.find((action) => action.name === "reloadSessionSkills");
        assert.equal((await reload.handler({ instanceId: "contributions", input: {} })).ok, true);
        assert.equal(reloadCalls, 1);
        await canvas.open({ instanceId: "contributions-second", input: { cwd: workspace } });
        await settle();
        assert.equal(sent.length, 1);
        assert.equal(reloadCalls, 1);
        const readyState = await listItems.handler({ instanceId: "contributions-second", input: {} });
        assert.equal(readyState.setup.ready, true);
        const repeatedReload = await reload.handler({ instanceId: "contributions-second", input: {} });
        assert.equal(repeatedReload.ok, true);
        assert.equal(reloadCalls, 2);
        await writeRegistry(true);
        assert.equal((await listItems.handler({ instanceId: "contributions-second", input: {} })).setup.ready, false);
        const mismatchedReload = await reload.handler({ instanceId: "contributions-second", input: {} });
        assert.equal(mismatchedReload.ok, false);
        assert.match(mismatchedReload.error, /enabled|disabled/i);
        await writeRegistry(false);
        assert.equal((await reload.handler({ instanceId: "contributions-second", input: {} })).ok, true);
        await canvas.onClose({ instanceId: "contributions-second" });
        await canvas.onClose({ instanceId: "contributions" });
    });

    test("rejects behavior overrides in configuration before registering a canvas", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(workspace, { recursive: true });
        let canvas;
        await assert.rejects(loadGeneratedExtension(root, {
            createCanvas: (definition) => {
                canvas = definition;
                return definition;
            },
            joinSession: async () => ({
                send: async () => {},
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, {
            workflowConfig: { version: 1, itemLabels: {}, phaseArguments: {}, setupWorkflow: "ignore setup" },
        }), /unsupported field: setupWorkflow/);
        assert.equal(canvas, undefined);
    });

    test("binds one single-instance slug and reuses it", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, ".specify"), { recursive: true });
        await writeFile(join(workspace, ".specify", "init-options.json"), JSON.stringify({
            integration: "copilot",
            ai_skills: true,
        }), "utf8");
        const sent = [];
        let canvas;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => {
                canvas = definition;
                return definition;
            },
            joinSession: async () => ({
                send: async ({ prompt }) => { sent.push(prompt); },
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, {
            runtime: {
                visualization: "item",
                workflowMode: "item",
                itemRoot: ".specify/items/<slug>",
                userProvidesSlug: true,
                multiInstance: false,
            },
            artifact: { pathTemplate: ".specify/items/<slug>/spec.md" },
        });
        await canvas.open({ instanceId: "single", input: { cwd: workspace } });
        await canvas.actions.find((action) => action.name === "reloadSessionSkills")
            .handler({ instanceId: "single", input: {} });
        const runPhase = canvas.actions.find((action) => action.name === "run_phase");
        await runPhase.handler({
            instanceId: "single",
            input: { phase: "speckit.specify#0", itemId: "__new__", slug: "alpha", args: "create Oregon trail on Mars" },
        });
        assert.equal(sent.at(-1), "/skill:speckit-specify slug=alpha create Oregon trail on Mars");
        await runPhase.handler({
            instanceId: "single",
            input: { phase: "speckit.specify#0", itemId: "__new__", slug: "" },
        });
        assert.equal(sent.at(-1), "/skill:speckit-specify slug=alpha");
        const state = await canvas.actions.find((action) => action.name === "list_items")
            .handler({ instanceId: "single", input: {} });
        assert.deepEqual(state.items.map((item) => item.id), ["alpha"]);
        await assert.rejects(
            runPhase.handler({
                instanceId: "single",
                input: { phase: "speckit.specify#0", itemId: "alpha", slug: "beta" },
            }),
            /cannot be changed|already bound/i,
        );
        await canvas.onClose({ instanceId: "single" });
    });

    test("rejects duplicate custom slugs across workflow instances in one workspace", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, ".specify"), { recursive: true });
        await writeFile(join(workspace, ".specify", "init-options.json"), JSON.stringify({
            integration: "copilot",
            ai_skills: true,
        }), "utf8");
        let canvas;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => {
                canvas = definition;
                return definition;
            },
            joinSession: async () => ({
                send: async () => {},
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, {
            runtime: {
                visualization: "item",
                workflowMode: "item",
                itemRoot: ".specify/items/<slug>",
                userProvidesSlug: true,
                multiInstance: true,
            },
            artifact: { pathTemplate: ".specify/items/<slug>/spec.md" },
        });
        await canvas.open({ instanceId: "first", input: { cwd: workspace } });
        await canvas.open({ instanceId: "second", input: { cwd: workspace } });
        const reload = canvas.actions.find((action) => action.name === "reloadSessionSkills");
        await reload.handler({ instanceId: "first", input: {} });
        await reload.handler({ instanceId: "second", input: {} });
        const runPhase = canvas.actions.find((action) => action.name === "run_phase");
        await runPhase.handler({
            instanceId: "first",
            input: { phase: "speckit.specify#0", itemId: "__new__", slug: "alpha" },
        });
        await assert.rejects(
            runPhase.handler({
                instanceId: "second",
                input: { phase: "speckit.specify#0", itemId: "__new__", slug: "alpha" },
            }),
            /already in use/i,
        );
        await mkdir(join(workspace, ".specify", "items", "beta"), { recursive: true });
        await assert.rejects(
            runPhase.handler({
                instanceId: "second",
                input: { phase: "speckit.specify#0", itemId: "__new__", slug: "beta" },
            }),
            /already exists/i,
        );
        await canvas.onClose({ instanceId: "first" });
        await canvas.onClose({ instanceId: "second" });
    });

    test("permanently deletes one multi-workflow directory and its artifacts", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        const workflowDirectory = join(workspace, ".specify", "items", "alpha");
        await mkdir(workflowDirectory, { recursive: true });
        await writeFile(join(workflowDirectory, "spec.md"), "# Alpha\n", "utf8");
        await writeFile(join(workspace, ".specify", "init-options.json"), JSON.stringify({
            integration: "copilot",
            ai_skills: true,
        }), "utf8");
        let canvas;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => {
                canvas = definition;
                return definition;
            },
            joinSession: async () => ({
                send: async () => {},
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, {
            runtime: {
                visualization: "item",
                workflowMode: "item",
                itemRoot: ".specify/items/<slug>",
                userProvidesSlug: true,
                multiInstance: true,
            },
            artifact: { pathTemplate: ".specify/items/<slug>/spec.md" },
        });
        await canvas.open({ instanceId: "delete", input: { cwd: workspace } });
        const deleteWorkflow = canvas.actions.find((action) => action.name === "delete_workflow");
        assert.deepEqual(await deleteWorkflow.handler({
            instanceId: "delete",
            input: { slug: "alpha" },
        }), { ok: true, slug: "alpha" });
        await assert.rejects(lstat(workflowDirectory), /ENOENT/);
        for (const slug of ["", "../outside", "Uppercase", "con", "lpt9"]) {
            await assert.rejects(
                deleteWorkflow.handler({ instanceId: "delete", input: { slug } }),
                /invalid workflow slug/i,
            );
        }
        await canvas.onClose({ instanceId: "delete" });
    });

    test("enumerates only portable slugs and preserves the neutral New item in multi-instance mode", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        await mkdir(join(workspace, ".specify", "items", "alpha"), { recursive: true });
        await mkdir(join(workspace, ".specify", "items", "beta"), { recursive: true });
        const invalidDirectories = ["Uppercase", "double--hyphen", " leading-space"];
        // Windows cannot create these directories; macOS must exclude them from portable workflows.
        if (process.platform !== "win32") invalidDirectories.push("con", "com1", "lpt9");
        for (const name of invalidDirectories) {
            await mkdir(join(workspace, ".specify", "items", name), { recursive: true });
        }
        await writeFile(join(workspace, ".specify", "init-options.json"), JSON.stringify({
            integration: "copilot",
            ai_skills: true,
        }), "utf8");
        let canvas;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => {
                canvas = definition;
                return definition;
            },
            joinSession: async () => ({
                send: async () => {},
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, {
            runtime: {
                visualization: "item",
                workflowMode: "item",
                itemRoot: ".specify/items/<slug>",
                userProvidesSlug: false,
                multiInstance: true,
            },
            artifact: { pathTemplate: ".specify/items/<slug>/spec.md" },
        });
        await canvas.open({ instanceId: "multi", input: { cwd: workspace } });
        const state = await canvas.actions.find((action) => action.name === "list_items")
            .handler({ instanceId: "multi", input: {} });
        assert.deepEqual(state.items.map((item) => item.id), ["alpha", "beta", "__new__"]);
        assert.equal(state.items.find((item) => item.isNew).label, "New");
        await canvas.onClose({ instanceId: "multi" });
    });

    test("HTTP artifact and reveal routes reject unrelated files without affecting workflow reads", async () => {
        const root = await mkdtemp(join(here, ".generated-lifecycle-"));
        roots.push(root);
        const workspace = join(root, "workspace");
        const directory = join(workspace, ".specify", "items", "alpha");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "spec.md"), "# Alpha");
        await writeFile(join(directory, "unrelated.md"), "not a phase artifact");
        await writeFile(join(workspace, "README.md"), "unrelated repository document");
        let canvas;
        await loadGeneratedExtension(root, {
            createCanvas: (definition) => { canvas = definition; return definition; },
            joinSession: async () => ({
                send: async () => {},
                rpc: { skills: { reload: async () => ({ errors: [], warnings: [] }) } },
                log: async () => {},
            }),
        }, {
            runtime: { itemRoot: ".specify/items/<slug>", multiInstance: true, userProvidesSlug: false },
            artifact: { pathTemplate: ".specify/items/<slug>/spec.md" },
        });
        const opened = new URL((await canvas.open({ instanceId: "paths", input: { cwd: workspace } })).url);
        const endpoint = (route, path) => {
            const url = new URL(route, opened);
            url.searchParams.set("token", opened.searchParams.get("token"));
            if (path) url.searchParams.set("path", path);
            return url;
        };
        const success = await fetch(endpoint("/api/artifact", ".specify/items/alpha/spec.md"));
        assert.equal(success.status, 200);
        assert.equal((await success.json()).content, "# Alpha");
        for (const path of ["README.md", ".specify/items/alpha/unrelated.md", "../README.md"]) {
            const denied = await fetch(endpoint("/api/artifact", path));
            assert.equal(denied.status, 400);
            assert.match((await denied.json()).error, /scope|invalid/);
        }
        const revealDenied = await fetch(endpoint("/api/reveal"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "." }),
        });
        assert.equal(revealDenied.status, 400);
        assert.match((await revealDenied.json()).error, /invalid|scope/);
        const deleteDenied = await fetch(endpoint("/api/workflow/delete"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: "../alpha" }),
        });
        assert.equal(deleteDenied.status, 400);
        assert.equal(await readFile(join(directory, "spec.md"), "utf8"), "# Alpha");
        const missing = await fetch(endpoint("/ui/private-missing-file.js"));
        assert.equal(missing.status, 400);
        assert.deepEqual(await missing.json(), { error: "invalid request or unavailable workflow resource" });
        await writeFile(join(directory, "spec.md"), "x".repeat(512 * 1024 + 1));
        const oversized = await fetch(endpoint("/api/artifact", ".specify/items/alpha/spec.md"));
        assert.equal(oversized.status, 413);
        assert.deepEqual(await oversized.json(), { error: "Artifact is unavailable or exceeds the 512 KiB limit." });
        await canvas.onClose({ instanceId: "paths" });
    });
});
