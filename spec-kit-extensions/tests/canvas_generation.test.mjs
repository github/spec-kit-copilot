import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, mkdir, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { materialize, readBoundedSessionFile, renameDirectoryWithoutReplacement } from "../extension-canvas-design/scripts/generate.mjs";
import { createRuntime, existingOutputFolder } from "../extension-canvas-design/generated-scaffold/runtime.mjs";
import { phaseContract } from "../extension-canvas-design/generated-scaffold/contract.mjs";
import { renderHtml } from "../extension-canvas-design/generated-scaffold/server.mjs";
import { renderStockPage } from "../extension-canvas-design/generated-host/workflow-page/generated-workflow-page-adapter.mjs";
import { freezeGeneration, readCurrentInstalledVersions, validateEssentials } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/generation.mjs";
import { validateBadges as validateDesignerBadges } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/contracts/external-badges.mjs";
import { validateBadges as validateGeneratedBadges } from "../extension-canvas-design/generated-scaffold/badge-runtime.mjs";
import { buildAugmentedPath } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/env/resolve-path.mjs";
import { addWorkflowFixture } from "./workflow_fixture.mjs";
import { addDesignerAdapterFixture, resolveFixtureFields } from "./designer_adapter_fixture.mjs";
import { isWindowsDeviceName as designerDeviceName } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/pages.mjs";
import { isWindowsDeviceName as runtimeDeviceName } from "../extension-canvas-design/generated-scaffold/files.mjs";

const entryTemplate = await readFile(new URL("../extension-canvas-design/generated-scaffold/extension.mjs",
    import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../extension-canvas-design/generated-scaffold/runtime.mjs",
    import.meta.url), "utf8");
test("Generate command only materializes and reports its target", async () => {
    const command = await readFile(new URL("../extension-canvas-design/commands/generate.md",
        import.meta.url), "utf8");
    assert.match(command, /scripts\/generate\.mjs/);
    assert.match(command, /same frozen\s+handoff ID and request ID/);
    assert.match(command, /Report the exact generated target, canvas ID, request ID, and any warnings/);
    assert.match(command, /app was created but\s+\*\*not opened\*\*/);
    assert.match(command, /speckit\.extension-canvas-design\.open-generated/);
    assert.match(command, /Do not call `extensions_reload`,\s+`extensions_manage`, `list_canvas_capabilities`, or `open_canvas` here/);
    assert.match(command, /--replace-existing/);
    assert.match(command, /only when the\s+Designer server has validated replacement against this same handoff/);
    assert.match(command, /replacement flag is not part of that frozen request/);
});

test("the entry point becomes visible only after generated syntax and rendering validate", async () => {
    const source = await readFile(new URL("../extension-canvas-design/scripts/generate.mjs",
        import.meta.url), "utf8");
    const checked = source.indexOf('checkSyntax(join(target, "extension.mjs"), files.at(-1)[1])');
    const rendered = source.indexOf('if (renderer.error || renderer.status !== 0)');
    const published = source.indexOf('await writeFile(join(target, "extension.mjs"), files.at(-1)[1]');
    const exposed = source.indexOf("await renameDirectoryWithoutReplacement(target, output)");
    assert.ok(checked > 0 && checked < rendered && rendered < published && published < exposed);
    assert.equal(source.match(/writeFile\(join\(target, "extension\.mjs"\)/g)?.length, 1);
    assert.match(source, /const target = await mkdtemp\(join\(parent, `\.\$\{config\.canvas\.id\}-stage-`\)\)/);
});

const model = {
    revision: "test-revision",
    settingsRevision: 0,
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
const values = { "canvas.id": "my-workflow", "canvas.displayName": "My Workflow",
    "canvas.description": "A workflow", "canvas.workflowListName": "Workflows",
    "workflowSlug.userProvided": false };

async function registerStockBadgeInput(selected, project, ruleId) {
    const checklist = ["checklist-progress", "checklist-complete"].includes(ruleId);
    const control = ruleId === "value-match" ? "value-match"
        : checklist ? "checklist" : ruleId === "artifact-stale" ? "ordered-stale"
        : ruleId === "phase-artifact-complete" ? "phase-artifact" : "stock";
    const id = ruleId === "value-match" ? "stock.value-match-inputs"
        : checklist ? "stock.checklist-inputs"
        : ruleId === "artifact-stale" ? "stock.ordered-stale-inputs"
            : ruleId === "phase-artifact-complete" ? "stock.phase-artifact-inputs" : "stock.badge-inputs";
    const definition = `designer-badge-input-${control}`;
    const adapter = `${definition}-adapter`;
    const root = new URL("../extension-canvas-design/designer-host/badge-input-controls/",
        import.meta.url);
    const assets = [
        [`designer-badge-binding-${ruleId}`, "designer.badge-input-binding",
            `stock/bindings/${ruleId}.json`],
        [definition, "designer.badge-input-control", `${control}/control.json`],
        [adapter, "designer.badge-input-adapter", `${control}/designer.mjs`],
    ];
    for (const [name, kind, source] of assets) {
        const bytes = await readFile(new URL(source, root));
        const path = join(project, ".specify", "templates", `${name}.${source.endsWith(".mjs")
            ? "mjs" : "json"}`);
        await writeFile(path, bytes);
        selected.templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path, hash: createHash("sha256").update(bytes).digest("hex") });
    }
    selected.badgeInputControls = [{ rule: ruleId, control: id,
        binding: assets[0][0], definition: assets[1][0], adapter: assets[2][0] }];
}

function stockMarkup(config) {
    const root = { innerHTML: "" };
    renderStockPage(root, {
        canvas: config.canvas, mainPageAsset: config.mainPageAsset,
        readOnlyFields: config.readOnlyFields ?? [], textPlacements: config.textPlacements ?? [],
        hasValues: Boolean(config.valueSources?.length), generatedControls: config.generatedControls ?? [],
        badgeDestinations: config.workflowPage.badgeDestinations, hasBadges: Boolean(config.badges?.instances?.length),
        hasConstitution: config.phases.some((phase) => phase.replace(/^speckit\./, "") === "constitution"),
        fieldSlots: config.workflowPage.slots.filter(({ id }) => id !== "workflow.phases"
            && (config.fieldPlacements?.some((item) => item.page === "workflow" && item.slot === id)
                || config.buttons?.some((item) => item.page === "workflow" && item.slot === id)))
            .map(({ id }) => id),
    });
    return root.innerHTML;
}

test("confirmed outputs override legacy defaults, including an explicitly empty phase", () => {
    const config = { phases: ["specify", "plan"], phaseOutputs: {
        specify: { expectsArtifact: true, outputPath: "specs/<slug>/spec.md" },
        plan: { expectsArtifact: true, outputPath: "specs/<slug>/plan.md" },
    }, phaseArtifacts: {
        specify: { outputs: ["specs/<slug>/spec.md", "specs/<slug>/research.md"],
            view: "specs/<slug>/research.md" },
        plan: { outputs: [], view: null },
    } };
    const phases = phaseContract(config);
    assert.equal(phases[0].output, "specs/<slug>/research.md");
    assert.deepEqual(phases[0].outputs, config.phaseArtifacts.specify.outputs);
    assert.equal(phases[1].output, null);
    assert.deepEqual(phases[1].outputs, []);
    assert.equal(phases[1].expectsArtifact, false);
    const watched = phaseContract({ ...config, phaseArtifacts: {
        ...config.phaseArtifacts, plan: { outputs: ["specs/<slug>/notes.md"], view: null },
    } })[1];
    assert.deepEqual(watched.outputs, ["specs/<slug>/notes.md"]);
    assert.equal(watched.output, null);
    assert.equal(watched.expectsArtifact, true);
    for (const invalid of [
        { outputs: [], view: "specs/<slug>/plan.md" },
        { outputs: ["specs/<slug>/notes.md"], view: "another.md" },
        { outputs: ["../bad.md"], view: "../bad.md" },
        { outputs: ["specs/<slug>/plan.md", "specs/<slug>/plan.md"],
            view: "specs/<slug>/plan.md" },
    ]) {
        assert.throws(() => phaseContract({ ...config, phaseArtifacts:
            { ...config.phaseArtifacts, plan: invalid } }), /Invalid|outside|Duplicate/);
    }
});

test("generated phase contract keeps optional Wizard descriptions and rejects invalid metadata", () => {
    const config = { phases: ["specify"],
        phaseOutputs: { specify: { outputPath: "specs/<slug>/spec.md" } },
        phaseDescriptions: { specify: "Describe what to build and why." } };
    assert.equal(phaseContract(config)[0].description, "Describe what to build and why.");
    assert.equal(phaseContract({ ...config, phaseDescriptions: undefined })[0].description, null);
    for (const phaseDescriptions of [{ plan: "Not selected" }, { specify: "" },
        { specify: "x".repeat(241) }, null]) {
        assert.throws(() => phaseContract({ ...config, phaseDescriptions }), /Invalid phase descriptions/);
    }
});

test("Constitution always opens its fixed artifact despite stale output mappings", () => {
    const [phase] = phaseContract({ phases: ["constitution"], phaseOutputs: {
        constitution: { expectsArtifact: false, outputPath: null },
    }, phaseArtifacts: { constitution: { outputs: [], view: null } } });
    assert.equal(phase.output, ".specify/memory/constitution.md");
    assert.deepEqual(phase.outputs, [".specify/memory/constitution.md"]);
    assert.equal(phase.expectsArtifact, true);
});

test("frozen Designer outputs become the generated viewer and link configuration", async (t) => {
    const { project, workspace } = await fixture(t);
    const outputs = {
        constitution: { outputs: [".specify/memory/constitution.md"],
            view: ".specify/memory/constitution.md" },
        specify: { outputs: ["specs/<slug>/spec.md", "specs/<slug>/research.md"],
            view: "specs/<slug>/research.md" },
        plan: { outputs: [], view: null },
    };
    const prepared = await freezeGeneration({ project, workspace, model, values, handoff, outputs });
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, ".github", "extensions",
        "my-workflow", "canvas-config.json"), "utf8"));
    assert.deepEqual(config.phaseArtifacts, outputs);
    const steps = phaseContract(config);
    assert.equal(steps.find((step) => step.id === "specify").output, "specs/<slug>/research.md");
    assert.equal(steps.find((step) => step.id === "plan").output, null);
    assert.equal(steps.find((step) => step.id === "constitution").output,
        ".specify/memory/constitution.md");
    await assert.rejects(freezeGeneration({ project, workspace, model, values, handoff,
        outputs: { ...outputs, constitution: { outputs: [], view: null } } }),
    /Constitution output is fixed/);
    const directory = join(project, "specs", "demo");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "spec.md"), "# Spec");
    await writeFile(join(directory, "research.md"), "# Research");
    const runtime = await createRuntime({ config, cwd: project, workspace,
        session: { sessionId: "outputs-test", on: () => () => {},
            getEvents: async () => [], log: async () => {} } });
    t.after(() => runtime.close());
    assert.equal((await runtime.artifact({ phase: "specify", itemId: "specs/demo" })).path,
        "specs/demo/research.md");
    assert.equal((await runtime.artifact({ phase: "specify", itemId: "specs/demo",
        output: "specs/<slug>/spec.md" })).content, "# Spec");
    await assert.rejects(runtime.artifact({ phase: "specify", itemId: "specs/demo",
        output: ".github/private.md" }), /not declared/);
    await assert.rejects(runtime.artifact({ phase: "plan", itemId: "specs/demo" }),
        /No artifact is available/);
});

test("viewer-only roots do not create workflows and links resolve within the selected slug", async (t) => {
    const { project, workspace } = await fixture(t);
    const config = {
        canvas: { id: "viewer-roots", displayName: "Viewer roots" },
        phases: ["specify"], phaseOutputs: {
            specify: { expectsArtifact: true, outputPath: "specs/<slug>/spec.md" },
        },
        phaseArtifacts: { specify: {
            outputs: ["specs/<slug>/spec.md", "reports/<slug>/notes.md"],
            view: "specs/<slug>/spec.md",
        } },
    };
    await mkdir(join(project, "specs", "demo"), { recursive: true });
    await mkdir(join(project, "reports", "demo"), { recursive: true });
    await writeFile(join(project, "specs", "demo", "spec.md"), "# Spec");
    await writeFile(join(project, "reports", "demo", "notes.md"), "# Notes");
    const runtime = await createRuntime({ config, cwd: project, workspace,
        session: { sessionId: "viewer-roots", on: () => () => {},
            getEvents: async () => [], log: async () => {} } });
    t.after(() => runtime.close());
    const state = await runtime.snapshot();
    assert.deepEqual(state.items.map(({ id }) => id), ["specs/demo"]);
    assert.equal((await runtime.artifact({ phase: "specify", itemId: "specs/demo",
        output: "reports/<slug>/notes.md" })).content, "# Notes");
    await assert.rejects(runtime.reveal({ phase: "specify", itemId: "specs/demo",
        output: ".github/private.md" }), /not declared/);
});

test("generated discovery uses confirmed outputs when legacy roots are missing or stale", async (t) => {
    for (const phase of ["assess", "specify"]) {
        await t.test(phase, async (t) => {
            const selectedHandoff = structuredClone(handoff);
            selectedHandoff.workflow.selectedPhases = [phase];
            selectedHandoff.sourceFingerprint = createHash("sha256").update(JSON.stringify({
                workflow: selectedHandoff.workflow, selections: selectedHandoff.selections,
            })).digest("hex");
            const { project, workspace, sdk } = await fixture(t, selectedHandoff);
            const outputs = { [phase]: {
                outputs: [".specify/bugs/<slug>/documents/assessment.md",
                    ".specify/bugs/<slug>/notes.md"], view: null,
            } };
            const prepared = await freezeGeneration({ project, workspace, model, values,
                handoff: selectedHandoff, outputs });
            await materialize(project, workspace, selectedHandoff.handoffId, prepared.requestId);
            const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
            const { createRuntime } = await import(pathToFileURL(join(sdk, "runtime.mjs")).href);
            await mkdir(join(project, ".specify", "bugs", "login-crash"), { recursive: true });
            const runtime = await createRuntime({ config, cwd: project, workspace,
                session: { sessionId: `discovery-${phase}`, on: () => () => {},
                    getEvents: async () => [], log: async () => {} } });
            t.after(() => runtime.close());
            assert.deepEqual((await runtime.snapshot()).items.map(({ id }) => id),
                [".specify/bugs/login-crash"]);
        });
    }
});

test("ambiguous confirmed roots reach the canvas error response regardless of output order", async (t) => {
    const { project, workspace, sdk } = await fixture(t);
    const bug = ".specify/bugs/<slug>/assessment.md", report = "reports/<slug>/notes.md";
    const outputs = {
        constitution: { outputs: [".specify/memory/constitution.md"],
            view: ".specify/memory/constitution.md" },
        specify: { outputs: [bug, report], view: bug },
        plan: { outputs: [], view: null },
    };
    const prepared = await freezeGeneration({ project, workspace, model, values, handoff, outputs });
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, createWorkflowRoutes } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const { createRuntime } = await import(pathToFileURL(join(sdk, "runtime.mjs")).href);
    await mkdir(join(project, "reports", "report-only"), { recursive: true });
    await writeFile(join(project, "reports", "report-only", "notes.md"), "# Notes");
    for (const order of [[bug, report], [report, bug]]) {
        const config = readConfig();
        config.phaseArtifacts.specify.outputs = order;
        const runtime = await createRuntime({ config, cwd: project, workspace,
            session: { sessionId: "ambiguous-discovery", on: () => () => {},
                getEvents: async () => [], log: async () => {} } });
        const routes = createWorkflowRoutes(config, { token: "discovery-test", runtime });
        const server = createServer(routes.handle);
        t.after(async () => {
            routes.close();
            await new Promise((resolve) => server.close(resolve));
            runtime.close();
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/state?token=discovery-test`);
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
            error: "Cannot determine workflow discovery root: confirmed outputs reference multiple roots (.specify/bugs, reports).",
        });
    }
});

test("missing output links browse the nearest existing confined directory", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "canvas-output-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "specs", "demo"), { recursive: true });
    assert.equal(await existingOutputFolder(root, "specs/demo/nested"), join(root, "specs", "demo"));
    assert.equal(await existingOutputFolder(root, "reports/demo"), root);
    assert.equal(await existingOutputFolder(root, "."), root);
    await writeFile(join(root, "specs", "demo", "not-a-folder"), "");
    await assert.rejects(existingOutputFolder(root, "specs/demo/not-a-folder"), /not a folder/);
    await assert.rejects(existingOutputFolder(root, "../outside"), /outside/);
    await symlink(join(root, "specs"), join(root, "linked"), "junction");
    await assert.rejects(existingOutputFolder(root, "linked/missing"), /link or leaves/);
});

test("Browse resolves the parent of a run-reported artifact", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "canvas-reported-folder-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "specs", "demo"), { recursive: true });
    await writeFile(join(root, "specs", "demo", "spec.md"), "# Spec");
    const start = runtimeSource.indexOf("    async function outputPath(");
    const end = runtimeSource.indexOf("    async function artifact(", start);
    assert.ok(start >= 0 && end > start);
    const outputPath = runInNewContext(`${runtimeSource.slice(start, end)}\noutputPath`, {
        state: {}, reportedArtifactFor: () => ({ item: "specs/demo", artifact: "specs/demo/spec.md" }),
        authorizeReport() {}, posix,
    });
    const step = { configuredArtifacts: false, output: "specs/<slug>/spec.md" };
    assert.equal(await outputPath(step, "specs/demo"), "specs/demo/spec.md");
    const directory = await outputPath(step, "specs/demo", undefined, undefined, true);
    assert.equal(directory, "specs/demo");
    assert.equal(await existingOutputFolder(root, directory), join(root, "specs", "demo"));
});
const handoff = { handoffId: "handoff-1", sourceFingerprint: "",
    selections: { presets: [], extensions: [], bundles: [] },
    workflow: { selectedPhases: ["constitution", "specify", "plan"],
        installed: { presets: [{ id: "copilot-sub-agents", source: "copilot",
            version: "1.0.0", priority: 1 }],
            extensions: [], bundles: [] } } };
handoff.sourceFingerprint = createHash("sha256").update(JSON.stringify({
    workflow: handoff.workflow, selections: handoff.selections,
})).digest("hex");

async function fixture(t, selectedHandoff = handoff, selectedValues = values, runtimeInventory,
    selectedModel = model) {
    const root = await mkdtemp(join(tmpdir(), "designer-generate-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, "project"), workspace = join(root, "workspace");
    await mkdir(project);
    await mkdir(workspace);
    await addDesignerAdapterFixture(project, selectedModel);
    await addWorkflowFixture(project, selectedModel);
    const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "handoff.json"), JSON.stringify(selectedHandoff));
    const prepared = await freezeGeneration({ project, workspace, model: selectedModel, values: selectedValues,
        handoff: selectedHandoff, runtimeInventory });
    const sdk = join(project, ".github", "extensions", selectedValues["canvas.id"]);
    return { project, workspace, prepared, sdk };
}

test("generation cannot omit the handoff runtime setup when Show setup is off", async (t) => {
    const selectedHandoff = structuredClone(handoff);
    selectedHandoff.workflow.runtimeSetup = { presets: [], extensions: [], bundles: [] };
    selectedHandoff.sourceFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: selectedHandoff.workflow, selections: selectedHandoff.selections,
    })).digest("hex");
    const { project, workspace, prepared } = await fixture(t, selectedHandoff);
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        selectedHandoff.handoffId, "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    delete request.runtimeSetup;
    delete request.integrity;
    request.integrity = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    await writeFile(requestPath, JSON.stringify(request));
    await assert.rejects(materialize(project, workspace, selectedHandoff.handoffId,
        prepared.requestId), /Runtime setup recipe differs/);
});

test("newly generated setup recognizes exact default local inventory", async (t) => {
    const selectedHandoff = structuredClone(handoff);
    const extension = { id: "bug", version: "1.0.0", enabled: true, priority: 0,
        locator: { installedId: "bug", catalogId: "bug", source: "default", downloadUrl: null } };
    selectedHandoff.workflow.installed = { presets: [], bundles: [],
        extensions: [{ id: extension.id, version: extension.version, source: "default", priority: 0 }] };
    selectedHandoff.workflow.runtimeSetup = { presets: [], extensions: [extension], bundles: [] };
    selectedHandoff.sourceFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: selectedHandoff.workflow, selections: selectedHandoff.selections,
    })).digest("hex");
    const { project, workspace, prepared, sdk } = await fixture(t, selectedHandoff);
    await materialize(project, workspace, selectedHandoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.runtimeSetup, selectedHandoff.workflow.runtimeSetup);
    await mkdir(join(project, ".github", "skills", "speckit-specify"), { recursive: true });
    await writeFile(join(project, ".github", "skills", "speckit-specify", "SKILL.md"),
        "---\nname: speckit-specify\n---\n");
    const { createSetup } = await import(pathToFileURL(join(sdk, "setup.mjs")).href);
    let source = { kind: "local" };
    const setup = createSetup({ config, cwd: project, phases: [{ skill: "speckit-specify" }],
        session: { rpc: { skills: { reload: async () => ({ errors: [] }) } } },
        command: async (_exe, args) => ({ stdout: args[0] === "--version" ? "specify 1.0.7"
            : JSON.stringify([{ id: extension.id, version: extension.version, enabled: true,
                priority: 0, source }]) }) });
    assert.equal((await setup.status()).ready, true);
    source = { kind: "local", path: "another-source" };
    assert.equal((await setup.status({ fresh: true })).ready, false);
    assert.deepEqual((await setup.start({})).pending.map((entry) => entry.id), ["bug"]);
});

test("selected badge definitions and evaluator are packaged without preset files", async (t) => {
    const { project, workspace, sdk } = await fixture(t);
    const selected = structuredClone(model);
    const root = new URL("../extension-canvas-design/generated-host/badges/", import.meta.url);
    for (const [name, kind, path] of [
        ["badge-rule-value-match", "generated.badge-rule-definition", "rules/value-match.json"],
        ["badge-rule-content-adapter", "generated.badge-rule-adapter", "adapters/content.mjs"],
    ]) {
        const bytes = await readFile(new URL(path, root));
        const destination = join(project, ".specify", "templates", `${name}.${path.endsWith(".mjs") ? "mjs" : "json"}`);
        await writeFile(destination, bytes);
        selected.templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path: destination,
            hash: createHash("sha256").update(bytes).digest("hex") });
    }
    const settings = JSON.parse(await readFile(new URL(
        "../extension-canvas-design/designer-host/badges-settings/badge-types.json", import.meta.url), "utf8"));
    settings.types[0].id = "preset-value-match";
    settings.types[0].title = "Customized value match";
    settings.types[0].description = "A replacement description from badges-settings.";
    const settingsBytes = Buffer.from(JSON.stringify(settings));
    const settingsPath = join(project, ".specify", "templates", "badges-settings.json");
    await writeFile(settingsPath, settingsBytes);
    selected.templates.push({ name: "badges-settings",
        kind: "designer.badges-settings-definition", sourceId: "extension:extension-canvas-design",
        strategy: "replace", path: settingsPath,
        hash: createHash("sha256").update(settingsBytes).digest("hex") });
    selected.badgeTypes = [{ name: "badges-settings", sourceId: "extension:extension-canvas-design",
        schemaVersion: 1, ...settings.types[0] }];
    selected.badgeRules = [{ name: "badge-rule-value-match",
        ...JSON.parse(await readFile(new URL("rules/value-match.json", root), "utf8")) }];
    await registerStockBadgeInput(selected, project, "value-match");
    const outputs = {
        constitution: { outputs: [".specify/memory/constitution.md"],
            view: ".specify/memory/constitution.md" },
        specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
        plan: { outputs: ["specs/<slug>/plan.md"], view: "specs/<slug>/plan.md" },
    };
    const badges = [{ id: "verdict", type: "preset-value-match", category: "Verdict",
        inputs: { artifact: { phase: "specify", output: "specs/<slug>/spec.md" },
            choices: [{ id: "review", value: "Verdict: needs-clarification", text: "Review needed",
                phaseText: "Phase review", summaryText: "Workflows with review",
                color: "amber" }] },
        color: "amber",
        showIn: ["workflow-list", "workflow-summary"], phase: null,
        targets: [{ phase: "specify", output: "specs/<slug>/spec.md" },
            { phase: "plan", output: "specs/<slug>/plan.md" },
            { phase: "plan", output: null }] }];
    const frozen = await freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges });
    await materialize(project, workspace, handoff.handoffId, frozen.requestId);
    const overlap = { ...badges[0], id: "overlap",
        color: "blue",
        targets: [{ phase: "plan", output: null }] };
    const alternateValues = { ...values, "canvas.id": "badge-duplicate-check" };
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values: alternateValues,
        handoff, outputs, badges: [...badges, overlap] }), /duplicates phase\/output target/);
    const alternateText = { ...overlap, inputs: { ...overlap.inputs, choices: overlap.inputs.choices
        .map((choice) => ({ ...choice, text: "Another review needed" })) } };
    const differentlyLabeled = await freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [...badges, alternateText] });
    const differentlyLabeledRequest = JSON.parse(await readFile(join(workspace,
        "speckit-canvas-designer", "handoffs", handoff.handoffId, "generations",
        differentlyLabeled.requestId, "request.json"), "utf8"));
    assert.equal(differentlyLabeledRequest.badges.instances[1].inputs.choices[0].text,
        "Another review needed");
    const distinctTarget = { ...overlap, targets: [{ phase: "specify", output: null }] };
    const unique = await freezeGeneration({ project, workspace, model: selected, values: alternateValues,
        handoff, outputs, badges: [...badges, distinctTarget] });
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", unique.requestId, "request.json");
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    request.badges.instances[1].targets = [{ phase: "plan", output: null }];
    const { integrity: _integrity, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(request));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, unique.requestId),
        /Duplicate frozen badge target/);
    request.badges.instances[1].targets = distinctTarget.targets;
    const limitedPage = JSON.parse(Buffer.from(request.workflowPage.assets[0].content, "base64"));
    limitedPage.badgeDestinations = ["workflow.list"];
    const limitedBytes = Buffer.from(JSON.stringify(limitedPage));
    request.workflowPage.assets[0].content = limitedBytes.toString("base64");
    request.workflowPage.assets[0].hash = createHash("sha256").update(limitedBytes).digest("hex");
    const { integrity: _oldLimited, ...limitedPayload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(limitedPayload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(request));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, unique.requestId),
        /unsupported by the Workflow page adapter/);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    const shared = structuredClone(badges);
    assert.deepEqual(config.badges.instances, shared, "generation preserves placement text");
    assert.equal(config.badges.types[0].id, "preset-value-match");
    assert.equal(config.badges.types[0].title, "Customized value match");
    assert.equal(config.badges.types[0].description,
        "A replacement description from badges-settings.");
    const cardBadge = [{ ...badges[0], targets: [{ phase: "plan", output: null }] }];
    selected.workflowPage.badgeDestinations = ["workflow.list", "workflow.summary", "phase.card"];
    const cardOnlyRequest = await freezeGeneration({ project, workspace, model: selected,
        values: { ...values, "canvas.id": "card-only-badge" }, handoff, outputs, badges: cardBadge });
    const cardPath = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", cardOnlyRequest.requestId, "request.json");
    const cardRequest = JSON.parse(await readFile(cardPath, "utf8"));
    const cardDefinition = JSON.parse(Buffer.from(
        cardRequest.workflowPage.assets[0].content, "base64"));
    cardDefinition.badgeDestinations = selected.workflowPage.badgeDestinations;
    const cardBytes = Buffer.from(JSON.stringify(cardDefinition));
    cardRequest.workflowPage.assets[0].content = cardBytes.toString("base64");
    cardRequest.workflowPage.assets[0].hash = createHash("sha256").update(cardBytes).digest("hex");
    const { integrity: _cardHash, ...cardPayload } = cardRequest;
    cardRequest.integrity = createHash("sha256").update(JSON.stringify(cardPayload)).digest("hex");
    await writeFile(cardPath, JSON.stringify(cardRequest));
    await materialize(project, workspace, handoff.handoffId, cardOnlyRequest.requestId);
    const { readConfig: readCardConfig } = await import(
        pathToFileURL(join(project, cardOnlyRequest.target, "server.mjs")).href);
    assert.deepEqual(readCardConfig().workflowPage.badgeDestinations,
        ["workflow.list", "workflow.summary", "phase.card"]);
    selected.workflowPage.badgeDestinations = ["workflow.list", "workflow.summary", "phase.output"];
    await assert.rejects(freezeGeneration({ project, workspace, model: selected,
        values: { ...values, "canvas.id": "invalid-card-badge" },
        handoff, outputs, badges: cardBadge }), /unsupported by the Workflow page adapter/);
    selected.workflowPage.badgeDestinations = ["workflow.list", "workflow.summary", "phase.card"];
    await assert.rejects(freezeGeneration({ project, workspace, model: selected,
        values: { ...values, "canvas.id": "invalid-output-badge" },
        handoff, outputs, badges }), /unsupported by the Workflow page adapter/);
    selected.workflowPage.badgeDestinations = ["workflow.list"];
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges }), /unsupported by the Workflow page adapter/);
    selected.workflowPage.badgeDestinations = ["workflow.list", "workflow.summary",
        "phase.card", "phase.output"];
    assert.ok(config.workflowPage.slots.some((slot) => slot.id === "workflow.list"));
    assert.ok(config.workflowPage.slots.some((slot) => slot.id === "workflow.summary"));
    assert.deepEqual(config.workflowPage.phaseSlots,
        [{ id: "phase.card" }, { id: "phase.output" }]);
    const html = renderHtml(config);
    assert.match(stockMarkup(config), /data-badge-slot="workflow.list"/);
    assert.match(stockMarkup(config), /data-badge-slot="workflow.summary"/);
    assert.match(stockMarkup(config), /id="constitution-badges"/);
    assert.match(stockMarkup(config), /id="constitution-output-badges"/);
    assert.match(stockMarkup(config),
        /<div class="constitution-actions">\s*<span id="constitution-output-badges"/);
    const legacyPage = { ...config.workflowPage };
    delete legacyPage.pageAdapter;
    delete legacyPage.pageAdapterHash;
    delete legacyPage.badgeDestinations;
    assert.match(renderHtml({ ...config, workflowPage: legacyPage }),
        /<div class="constitution-actions">\s*<span id="constitution-output-badges"/);
    assert.match(html, /&quot;hasConstitution&quot;:true/);
    assert.match(html, /data-badge-slots="[^"]*phase.card[^"]*phase.output/);
    assert.equal(config.badges.rules[0].adapter, "badge-rule-content-adapter");
    assert.equal(Object.hasOwn(config.badges.rules[0], "module"), false);
    assert.deepEqual(await readFile(join(sdk, "badges", "badge-rule-content-adapter.mjs")),
        await readFile(new URL("adapters/content.mjs", root)));
    selected.badgeTypes[0].title = "Not in badges settings";
    const mismatchedValues = { ...values, "canvas.id": "mismatched-badge" };
    const inconsistent = await freezeGeneration({ project, workspace, model: selected,
        values: mismatchedValues, handoff, outputs, badges });
    await assert.rejects(materialize(project, workspace, handoff.handoffId,
        inconsistent.requestId), /Frozen badge type differs from badges settings/);
    selected.badgeTypes[0].title = settings.types[0].title;
    selected.workflowPage.slots = selected.workflowPage.slots
        .filter((slot) => slot.id !== "workflow.summary");
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges }), /no declared Workflow or phase control slot/);
    selected.workflowPage.slots.push({ id: "workflow.summary" });
    const projectBadge = { ...badges[0], inputs: { ...badges[0].inputs,
        artifact: { phase: "constitution", output: ".specify/memory/constitution.md" } },
    targets: [{ phase: "constitution", output: null }] };
    const projectOutputBadge = { ...projectBadge, targets: [{
        phase: "constitution", output: ".specify/memory/constitution.md",
    }] };
    const mixedBadge = { ...projectBadge, targets: [
        ...projectBadge.targets, { phase: "plan", output: "specs/<slug>/plan.md" },
    ] };
    const control = selected.templates.find((entry) => entry.name === "generated-phase-control");
    const originalControl = await readFile(control.path);
    const incompleteControl = JSON.parse(originalControl.toString("utf8"));
    incompleteControl.slots = [{ id: "phase.card" }];
    const bytes = Buffer.from(JSON.stringify(incompleteControl));
    await writeFile(control.path, bytes);
    control.hash = createHash("sha256").update(bytes).digest("hex");
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges }), /no declared Workflow or phase control slot/);
    await assert.doesNotReject(freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [projectOutputBadge] }));
    await assert.rejects(freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [mixedBadge] }),
    /no declared Workflow or phase control slot/);
    await writeFile(control.path, originalControl);
    control.hash = createHash("sha256").update(originalControl).digest("hex");
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs: { ...outputs, specify: { outputs: [], view: null } }, badges }),
    /invalid or removed output/);
    const adapter = selected.templates.find((entry) => entry.name === "generated-phase-adapter");
    const original = await readFile(adapter.path, "utf8");
    const cardOnly = original.replace(
        '["workflow.badges.v1", "workflow.badges.targets.v1"]', '["workflow.badges.v1"]');
    await writeFile(adapter.path, cardOnly);
    adapter.hash = createHash("sha256").update(cardOnly).digest("hex");
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges }), /does not support phase\/output badge targets/);
    const incompatible = original
        .replace('export const capabilities = ["workflow.badges.v1", "workflow.badges.targets.v1"];', "");
    await writeFile(adapter.path, incompatible);
    adapter.hash = createHash("sha256").update(incompatible).digest("hex");
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges }), /does not support phase-card badges/);
    await assert.doesNotReject(freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [projectBadge] }));
    await assert.doesNotReject(freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [projectOutputBadge] }));
    await assert.rejects(freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [mixedBadge] }),
    /does not support phase-card badges/);
    await writeFile(adapter.path, original);
    adapter.hash = createHash("sha256").update(original).digest("hex");
    const pageAdapter = selected.templates.find((entry) =>
        entry.kind === "generated.workflow-page-adapter");
    const originalPage = await readFile(pageAdapter.path, "utf8");
    const withoutProject = originalPage.replace(
        'export const capabilities = ["workflow.badges.project.v1"];', "")
        + '\nthrow new Error("Workflow page adapter ran in Node");\n';
    assert.notEqual(withoutProject, originalPage);
    await writeFile(pageAdapter.path, withoutProject);
    pageAdapter.hash = createHash("sha256").update(withoutProject).digest("hex");
    await assert.rejects(freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [projectBadge] }),
    /does not support project badges/);
    await assert.doesNotReject(freezeGeneration({ project, workspace, model: selected,
        values: alternateValues, handoff, outputs, badges: [badges[0]] }));
    await writeFile(pageAdapter.path, originalPage);
    pageAdapter.hash = createHash("sha256").update(originalPage).digest("hex");
    const projectRequest = await freezeGeneration({ project, workspace, model: selected,
        values: { ...values, "canvas.id": "project-page-tamper" },
        handoff, outputs, badges: [projectBadge] });
    const projectPath = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", projectRequest.requestId, "request.json");
    const tampered = JSON.parse(await readFile(projectPath, "utf8"));
    tampered.workflowPage.assets[3].content = Buffer.from(withoutProject).toString("base64");
    tampered.workflowPage.assets[3].hash = createHash("sha256").update(withoutProject).digest("hex");
    const { integrity: _projectHash, ...projectPayload } = tampered;
    tampered.integrity = createHash("sha256").update(JSON.stringify(projectPayload)).digest("hex");
    await writeFile(projectPath, JSON.stringify(tampered));
    await assert.rejects(materialize(project, workspace, handoff.handoffId,
        projectRequest.requestId), /Frozen Workflow page adapter does not support project badges/);
    await assert.rejects(readdir(join(project, projectRequest.target)), { code: "ENOENT" });
    tampered.workflowPage.assets[3].content = Buffer.from(originalPage).toString("base64");
    tampered.workflowPage.assets[3].hash = createHash("sha256").update(originalPage).digest("hex");
    tampered.badges.instances[0].inputs.artifact = {
        phase: "specify", output: "specs/<slug>/spec.md",
    };
    const { integrity: _badgeHash, ...badgePayload } = tampered;
    tampered.integrity = createHash("sha256").update(JSON.stringify(badgePayload)).digest("hex");
    await writeFile(projectPath, JSON.stringify(tampered));
    await assert.rejects(materialize(project, workspace, handoff.handoffId,
        projectRequest.requestId), /project placement with workflow rule inputs/);
    await assert.rejects(readdir(join(project, projectRequest.target)), { code: "ENOENT" });
    const browserOnly = `${originalPage.replace(/\r\n/g, "\n")}\nthrow new Error("Workflow page adapter ran in Node");\n`;
    await writeFile(pageAdapter.path, browserOnly);
    pageAdapter.hash = createHash("sha256").update(browserOnly).digest("hex");
    const browserRequest = await freezeGeneration({ project, workspace, model: selected,
        values: { ...values, "canvas.id": "browser-only-page" },
        handoff, outputs, badges: [projectBadge] });
    await materialize(project, workspace, handoff.handoffId, browserRequest.requestId);
    assert.match(await readFile(join(project, browserRequest.target, "pages",
        "generated-workflow-page-adapter.mjs"), "utf8"), /Workflow page adapter ran in Node/);
});

test("Phase artifact replacement group freezes with its badge type and rejects mismatches", async (t) => {
    const { project, workspace, sdk } = await fixture(t);
    const selected = structuredClone(model);
    const root = new URL("../extension-canvas-design/", import.meta.url);
    for (const [name, kind, path] of [
        ["badges-settings", "designer.badges-settings-definition",
            "designer-host/badges-settings/badge-types.json"],
        ["badge-rule-phase-artifact-complete", "generated.badge-rule-definition",
            "generated-host/badges/rules/phase-artifact-complete.json"],
        ["badge-rule-phase-artifact-complete-adapter", "generated.badge-rule-adapter",
            "generated-host/badges/adapters/phase-artifact-complete.mjs"],
    ]) {
        const bytes = await readFile(new URL(path, root));
        const destination = join(project, ".specify", "templates",
            `${name}.${path.endsWith(".mjs") ? "mjs" : "json"}`);
        await writeFile(destination, bytes);
        selected.templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path: destination,
            hash: createHash("sha256").update(bytes).digest("hex") });
    }
    const settings = JSON.parse(await readFile(new URL(
        "designer-host/badges-settings/badge-types.json", root), "utf8"));
    const rule = JSON.parse(await readFile(new URL(
        "generated-host/badges/rules/phase-artifact-complete.json", root), "utf8"));
    selected.badgeTypes = [{ name: "badges-settings", sourceId: "extension:extension-canvas-design",
        schemaVersion: 1, ...settings.types.find((type) => type.id === rule.id) }];
    selected.badgeRules = [{ name: "badge-rule-phase-artifact-complete", ...rule }];
    await registerStockBadgeInput(selected, project, rule.id);
    const outputs = { constitution: { outputs: [".specify/memory/constitution.md"],
        view: ".specify/memory/constitution.md" },
    specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
    plan: { outputs: ["specs/<slug>/plan.md"], view: "specs/<slug>/plan.md" } };
    const badge = { id: "phase-plan", type: rule.id, category: "Progress",
        inputs: { target: { phase: "plan", output: "specs/<slug>/plan.md" },
            prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" }] },
        text: "Plan complete", phaseText: "Plan complete", summaryText: "Plans complete",
        color: "green",
        showIn: ["workflow-list", "workflow-summary"], phase: null,
        targets: [{ phase: "plan", output: null }] };
    const frozen = await freezeGeneration({ project, workspace, model: selected,
        values, handoff, outputs, badges: [badge] });
    await materialize(project, workspace, handoff.handoffId, frozen.requestId);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.equal(config.badges.types[0].replacementGroup, "phase-completion");
    validateGeneratedBadges(config.badges, [
        { id: "specify", outputs: outputs.specify.outputs },
        { id: "plan", outputs: outputs.plan.outputs },
    ]);
    const mismatched = await freezeGeneration({ project, workspace, model: selected,
        values: { ...values, "canvas.id": "mismatched-group" },
        handoff, outputs, badges: [badge] });
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", mismatched.requestId, "request.json");
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    delete request.badges.types[0].replacementGroup;
    const { integrity: _integrity, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(request));
    await assert.rejects(materialize(project, workspace, handoff.handoffId,
        mismatched.requestId), /Frozen badge type differs from badges settings/);
});

test("Checklist complete freezes an ordered currentness chain and rejects invalid order", async (t) => {
    const { project, workspace, sdk } = await fixture(t);
    const selected = structuredClone(model);
    const root = new URL("../extension-canvas-design/", import.meta.url);
    for (const [name, kind, path] of [
        ["badges-settings", "designer.badges-settings-definition",
            "designer-host/badges-settings/badge-types.json"],
        ["badge-rule-checklist-complete", "generated.badge-rule-definition",
            "generated-host/badges/rules/checklist-complete.json"],
        ["badge-rule-content-adapter", "generated.badge-rule-adapter",
            "generated-host/badges/adapters/content.mjs"],
    ]) {
        const bytes = await readFile(new URL(path, root));
        const destination = join(project, ".specify", "templates",
            `${name}.${path.endsWith(".mjs") ? "mjs" : "json"}`);
        await writeFile(destination, bytes);
        selected.templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path: destination,
            hash: createHash("sha256").update(bytes).digest("hex") });
    }
    const settings = JSON.parse(await readFile(new URL(
        "designer-host/badges-settings/badge-types.json", root), "utf8"));
    const definition = JSON.parse(await readFile(new URL(
        "generated-host/badges/rules/checklist-complete.json", root), "utf8"));
    selected.badgeTypes = [{ name: "badges-settings", sourceId: "extension:extension-canvas-design",
        schemaVersion: 1, ...settings.types.find((type) => type.id === "checklist-complete") }];
    selected.badgeRules = [{ name: "badge-rule-checklist-complete", ...definition }];
    await registerStockBadgeInput(selected, project, "checklist-complete");
    const outputs = { constitution: { outputs: [".specify/memory/constitution.md"],
        view: ".specify/memory/constitution.md" },
    specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
    plan: { outputs: ["specs/<slug>/plan.md"], view: "specs/<slug>/plan.md" } };
    const instance = { id: "checklist", type: "checklist-complete", category: "Quality",
        inputs: { artifact: { phase: "plan", output: "specs/<slug>/plan.md" },
            prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" }],
            targetphase: "plan" },
        summaryText: "Checklists complete", color: "green", showIn: ["workflow-summary"], phase: null };
    const outputTarget = { ...instance, id: "checklist-output", phaseText: "Checklist complete",
        targets: [{ phase: "plan", output: "specs/<slug>/plan.md" }] };
    const multipleTargets = { ...instance, id: "checklist-multiple", phaseText: "Checklist complete",
        targets: [{ phase: "specify", output: null },
            { phase: "specify", output: "specs/<slug>/spec.md" }] };
    assert.deepEqual(validateDesignerBadges([outputTarget, multipleTargets],
        { ...selected, phases: ["specify", "plan"], outputs }), [outputTarget, multipleTargets]);
    const frozen = await freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges: [instance, outputTarget, multipleTargets] });
    await materialize(project, workspace, handoff.handoffId, frozen.requestId);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.badges.instances[0].inputs, instance.inputs);
    assert.deepEqual(config.badges.instances.slice(1).map(({ targets }) => targets),
        [outputTarget.targets, multipleTargets.targets]);
    validateGeneratedBadges(config.badges, [
        { id: "specify", outputs: outputs.specify.outputs },
        { id: "plan", outputs: outputs.plan.outputs },
    ]);
    assert.deepEqual(config.badges.rules[0].inputs, definition.inputs);
    assert.deepEqual(await readFile(join(sdk, "badges", "badge-rule-content-adapter.mjs")),
        await readFile(new URL("generated-host/badges/adapters/content.mjs", root)));
    const invalid = { ...instance, inputs: { ...instance.inputs,
        prerequisites: [instance.inputs.artifact] } };
    await assert.rejects(freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges: [invalid] }), /invalid or removed output/);
    const next = await freezeGeneration({ project, workspace, model: selected,
        values: { ...values, "canvas.id": "checklist-tamper" },
        handoff, outputs, badges: [instance] });
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", next.requestId, "request.json");
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    request.badges.instances[0].inputs = invalid.inputs;
    const { integrity: _integrity, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(request));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, next.requestId),
        /Invalid configured badge/);
});

test("directory-scoped rule freezes with its output anchor and evaluator", async (t) => {
    const { project, workspace, sdk } = await fixture(t);
    const selected = structuredClone(model);
    const root = new URL("../extension-canvas-design/", import.meta.url);
    for (const [name, kind, path] of [
        ["badges-settings", "designer.badges-settings-definition",
            "designer-host/badges-settings/badge-types.json"],
        ["badge-rule-markdown-file-count", "generated.badge-rule-definition",
            "generated-host/badges/rules/markdown-file-count.json"],
        ["badge-rule-content-adapter", "generated.badge-rule-adapter",
            "generated-host/badges/adapters/content.mjs"],
    ]) {
        const bytes = await readFile(new URL(path, root));
        const destination = join(project, ".specify", "templates",
            `${name}.${path.endsWith(".mjs") ? "mjs" : "json"}`);
        await writeFile(destination, bytes);
        selected.templates ??= [];
        selected.templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path: destination,
            hash: createHash("sha256").update(bytes).digest("hex") });
    }
    const settings = JSON.parse(await readFile(
        new URL("designer-host/badges-settings/badge-types.json", root), "utf8"));
    selected.badgeTypes = [{ name: "badges-settings",
        sourceId: "extension:extension-canvas-design", schemaVersion: 1,
        ...settings.types.find((entry) => entry.id === "markdown-file-count") }];
    selected.badgeRules = [{ name: "badge-rule-markdown-file-count",
        ...JSON.parse(await readFile(new URL(
            "generated-host/badges/rules/markdown-file-count.json", root), "utf8")) }];
    await registerStockBadgeInput(selected, project, "markdown-file-count");
    const output = "specs/<slug>/review/requirements.md";
    const outputs = { constitution: { outputs: [".specify/memory/constitution.md"],
        view: ".specify/memory/constitution.md" },
    specify: { outputs: [output], view: output },
    plan: { outputs: ["specs/<slug>/plan.md"], view: "specs/<slug>/plan.md" } };
    const badges = [{ id: "markdown-files", type: "markdown-file-count", category: "Files",
        inputs: { artifact: { phase: "specify", output } },
        text: "Files ({count})", summaryText: "Files", color: "blue",
        showIn: ["workflow-list", "workflow-summary"], phase: null }];
    const frozen = await freezeGeneration({ project, workspace, model: selected, values,
        handoff, outputs, badges });
    await materialize(project, workspace, handoff.handoffId, frozen.requestId);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.badges.rules[0].inputs,
        [{ id: "artifact", type: "artifact", scope: "directory" }]);
    await mkdir(join(project, "specs", "demo", "review"), { recursive: true });
    const { createRuntime: createGeneratedRuntime } =
        await import(pathToFileURL(join(sdk, "runtime.mjs")).href);
    const runtime = await createGeneratedRuntime({ config, cwd: project, workspace,
        session: { sessionId: "directory-generation", log: async () => {} } });
    try {
        const snapshot = await runtime.snapshot();
        assert.deepEqual(snapshot.badges.summary, [{ id: "markdown-files", category: "Files",
            color: "blue", count: 0, text: "Files: 0" }]);
        await writeFile(join(project, "specs", "demo", "review", "security.md"), "# Review");
        assert.deepEqual((await runtime.snapshot()).badges.items["specs/demo"], []);
        const updated = await runtime.refresh();
        assert.equal(updated.badges.items["specs/demo"][0].text, "Files (1)");
        assert.equal(updated.badges.summary[0].count, 1);
    } finally { runtime.close(); }
});

test("Specify inventories supply observed package versions and reject invalid responses", async () => {
    const lists = {
        preset: [{ id: "copilot-sub-agents", version: "1.2.3", priority: 4 }],
        extension: [{ id: "extension-canvas-design", version: "0.1.19", priority: 1 }],
        bundle: [{ bundle_id: "bundle-one", version: "2.0.0" }],
    };
    const frozen = { presets: [{ id: "copilot-sub-agents" }],
        extensions: [{ id: "extension-canvas-design" }],
        bundles: [{ id: "bundle-one" }] };
    const kinds = ["presets", "extensions", "bundles"];
    const calls = [];
    const run = async (_command, args, options) => {
        calls.push({ args, cwd: options.cwd, env: options.env, shell: options.shell });
        return { stdout: JSON.stringify(lists[args[0]]) };
    };
    assert.deepEqual(await readCurrentInstalledVersions("child", frozen, run), {
        inventory: { presets: lists.preset, extensions: lists.extension,
            bundles: [{ id: "bundle-one", version: "2.0.0" }] }, warnings: [],
    });
    const augmentedPath = await buildAugmentedPath();
    assert.deepEqual(calls, kinds.map((kind) => ({
        args: [kind === "presets" ? "preset" : kind === "extensions" ? "extension" : "bundle",
            "list", "--json"], cwd: "child",
        env: { ...process.env, PATH: augmentedPath }, shell: process.platform === "win32",
    })));
    assert.deepEqual(await readCurrentInstalledVersions("child",
        { presets: [], extensions: [], bundles: [] }, run),
        { inventory: { presets: [], extensions: [], bundles: [] }, warnings: [] });
    const unreadable = await readCurrentInstalledVersions("child", frozen, async (_command, args) => ({
        stdout: args[0] === "preset" ? "not JSON" : JSON.stringify(lists[args[0]]),
    }));
    assert.match(unreadable.warnings[0], /Invalid presets JSON from Specify/);
    assert.deepEqual(unreadable.inventory.extensions, lists.extension);
    const duplicates = await readCurrentInstalledVersions("child", frozen, async (_command, args) => ({
        stdout: JSON.stringify(args[0] === "preset"
            ? [lists.preset[0], lists.preset[0]] : lists[args[0]]),
    }));
    assert.match(duplicates.warnings[0], /Invalid presets package identity or version/);
    const unrelated = Array.from({ length: 45 }, (_, index) =>
        ({ id: `other-${index}`, version: "1.0.0", priority: 1 }));
    const crowded = await readCurrentInstalledVersions("child", frozen, async (_command, args) => ({
        stdout: JSON.stringify(args[0] === "preset"
            ? [...unrelated, { id: "unrelated-malformed" }, lists.preset[0]]
            : lists[args[0]]),
    }));
    assert.deepEqual(crowded.inventory.presets, lists.preset);
    assert.deepEqual(crowded.warnings, []);
    const malformedRelevant = await readCurrentInstalledVersions("child", frozen,
        async (_command, args) => ({
            stdout: JSON.stringify(args[0] === "preset"
                ? [...unrelated, { id: "copilot-sub-agents" }]
                : lists[args[0]]),
        }));
    assert.match(malformedRelevant.warnings[0], /Invalid presets package identity or version/);
    const missingCli = await readCurrentInstalledVersions("child", frozen, async () => {
        throw Object.assign(new Error("specify not found"), { code: "ENOENT" });
    });
    assert.equal(missingCli.warnings.length, 3);
    assert.deepEqual(missingCli.inventory, { presets: [], extensions: [], bundles: [] });
});

test("generated package versions reflect the installed inventory without blocking drift", async (t) => {
    const current = { presets: [{ id: "copilot-sub-agents", version: "1.2.3", priority: 4 }],
        extensions: [], bundles: [] };
    const { project, workspace, prepared, sdk } = await fixture(t, handoff, values, current);
    assert.match(prepared.warnings[0], /Wizard version 1\.0\.0, installed version 1\.2\.3/);
    const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.deepEqual(request.installed, handoff.workflow.installed);
    assert.deepEqual(request.actualInstalled.presets, [{ id: "copilot-sub-agents",
        version: "1.2.3", priority: 4 }]);
    const generated = await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    assert.match(generated.warnings[0], /Wizard version 1\.0\.0, installed version 1\.2\.3/);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.installed.presets, request.actualInstalled.presets);
});

test("unavailable installed packages remain unverified, not mislabeled as frozen versions", async (t) => {
    const empty = { presets: [], extensions: [], bundles: [] };
    const { project, workspace, prepared, sdk } = await fixture(t, handoff, values, empty);
    assert.match(prepared.warnings[0], /installed version unverified/);
    const generated = await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    assert.match(generated.warnings[0], /installed version unverified/);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.installed.presets, [{ id: "copilot-sub-agents", version: "unverified" }]);
});

test("bundle version drift is recorded from Specify without changing the Wizard snapshot", async (t) => {
    const withBundle = structuredClone(handoff);
    withBundle.workflow.installed.bundles = [{ id: "sample-bundle", version: "2.0.0" }];
    withBundle.sourceFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: withBundle.workflow, selections: withBundle.selections,
    })).digest("hex");
    const current = { presets: [{ id: "copilot-sub-agents", version: "1.0.0", priority: 1 }],
        extensions: [], bundles: [{ id: "sample-bundle", version: "2.1.0" }] };
    const { project, workspace, prepared, sdk } = await fixture(t, withBundle, values, current);
    assert.match(prepared.warnings[0], /bundles sample-bundle: Wizard version 2\.0\.0, installed version 2\.1\.0/);
    await materialize(project, workspace, withBundle.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.installed.bundles, [{ id: "sample-bundle", version: "2.1.0" }]);
});

test("a signed generation request cannot relabel a Wizard package ID", async (t) => {
    const current = { presets: [{ id: "copilot-sub-agents", version: "1.2.3", priority: 4 }],
        extensions: [], bundles: [] };
    const { project, workspace, prepared } = await fixture(t, handoff, values, current);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(path, "utf8"));
    request.actualInstalled.presets[0].id = "wrong-package";
    const { integrity: _integrity, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(path, JSON.stringify(request));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid verified generation inventory/);
});

test("Essentials are validated before freezing a bounded, immutable generation request", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(path, "utf8"));
    const { integrity, ...payload } = request;
    assert.equal(integrity, createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
    assert.equal(request.project, project);
    assert.deepEqual(request.workflow.selectedPhases, handoff.workflow.selectedPhases);
    assert.deepEqual(request.installed.presets, handoff.workflow.installed.presets);
    assert.deepEqual(request.values, values);
    await assert.rejects(freezeGeneration({ model, values: { ...values, "canvas.id": "../bad" },
        handoff, project, workspace }), /Invalid Designer setting: canvas.id/);
    await assert.rejects(freezeGeneration({ model, values: { ...values, "canvas.displayName": " " },
        handoff, project, workspace }), /Canvas ID and Title must be valid/);
    assert.throws(() => validateEssentials(model, { ...values, "canvas.id": "../bad" }), /canvas.id/);
    for (const id of ["con", "prn", "aux", "nul",
        ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
        ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)]) {
        assert.throws(() => validateEssentials(model, { ...values, "canvas.id": id }), /non-reserved/);
    }
    for (const id of ["com0", "com10", "lpt0", "lpt10", "con-1"]) {
        assert.equal(validateEssentials(model, { ...values, "canvas.id": id })["canvas.id"], id);
    }
    assert.throws(() => validateEssentials(model, { ...values, "canvas.displayName": " " }), /Canvas ID and Title must be valid/);
    assert.throws(() => validateEssentials(model, { ...values, "workflowSlug.userProvided": "true" }), /workflowSlug.userProvided/);
    const { ["workflowSlug.userProvided"]: omitted, ...missingToggle } = values;
    assert.throws(() => validateEssentials(model, missingToggle), /unexpected or missing fields/);
});

test("all enabled Designer values are validated and frozen, with only bound fields rendered", async (t) => {
    const { project, workspace } = await fixture(t);
    const contributedModel = { ...model,
        pages: model.pages.map((page) => ({ ...page, fields: [...page.fields] })),
        constraints: { ...model.constraints,
            "billing.costCode": { type: "string", maxLength: 64 },
            "designer.note": { type: "string", maxLength: 80 } },
        contributions: [{ field: { id: "billing.costCode", label: "Cost code" },
            generatedBinding: { presentation: "stock.readonly",
                section: { id: "billing", title: "Billing" } } },
        { field: { id: "designer.note", label: "Internal note" } }] };
    resolveFixtureFields(contributedModel);
    const supplied = { ...values, "billing.costCode": "CC-481", "designer.note": "Designer only" };
    await assert.rejects(freezeGeneration({ model: contributedModel,
        values: { ...supplied, "designer.note": "x".repeat(81) },
        handoff, project, workspace }), /Invalid Internal note \(designer.note\)/);
    const prepared = await freezeGeneration({ model: contributedModel, values: supplied,
        handoff, project, workspace });
    const frozen = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.equal(frozen.values["billing.costCode"], "CC-481");
    assert.equal(frozen.values["designer.note"], "Designer only");
    assert.deepEqual(frozen.generatedFields.map(({ id }) => id), ["billing.costCode"]);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const setup = JSON.parse(await readFile(join(project, ".github", "extensions",
        "my-workflow", "canvas-setup.json"), "utf8"));
    assert.equal(setup.values["billing.costCode"], "CC-481");
    assert.equal(setup.values["designer.note"], "Designer only");
    const config = JSON.parse(await readFile(join(project, ".github", "extensions",
        "my-workflow", "canvas-config.json"), "utf8"));
    assert.equal(config.readOnlyFields.some((field) => field.id === "designer.note"), false);
});

test("re-signed requests reject inconsistent, missing, and colliding generated values", async (t) => {
    for (const [name, change, error] of [
        ["undeclared value", (request) => { request.values["designer.note"] = "not generated"; },
            /Invalid frozen Designer fields/],
        ["missing Essential", (request) => { delete request.values["canvas.description"]; },
            /Invalid frozen Designer fields/],
        ["missing bound value", (request) => {
            request.generatedFields = [{ id: "billing.costCode", label: "Cost code", maxLength: 64 }];
        }, /Invalid frozen generated fields/],
        ["bound ID collides with Essential", (request) => {
            request.generatedFields = [{ id: "canvas.displayName", label: "Title", maxLength: 120 }];
        }, /Invalid frozen generated values/],
        ["generated field maxLength differs from its constraint", (request) => {
            request.generatedFields = [{ id: "canvas.description", label: "Description", maxLength: 1000 }];
        }, /Invalid frozen generated fields/],
    ]) {
        await t.test(name, async (child) => {
            const { project, workspace, prepared, sdk } = await fixture(child);
            const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
                "generations", prepared.requestId, "request.json");
            const request = JSON.parse(await readFile(path, "utf8"));
            change(request);
            const { integrity: _integrity, ...payload } = request;
            request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
            await writeFile(path, JSON.stringify(request));
            await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
                error);
            await assert.rejects(readdir(sdk), { code: "ENOENT" });
        });
    }
});

test("100 bounded generated fields materialize when the frozen request exceeds 128KB", async (t) => {
    const { project, workspace } = await fixture(t);
    const constraints = { ...model.constraints };
    const contributions = [];
    const supplied = { ...values };
    for (let index = 0; index < 100; index++) {
        const id = `billing.code${index}`;
        constraints[id] = { type: "string", maxLength: 1000 };
        supplied[id] = "x".repeat(1000);
        contributions.push({ field: { id, label: "L".repeat(120) },
            generatedBinding: { presentation: "stock.readonly",
                section: { id: `billing-${index}`, title: "S".repeat(120) } } });
    }
    const prepared = await freezeGeneration({ model: { ...model, constraints, contributions },
        values: supplied, handoff, project, workspace });
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const raw = await readFile(path);
    assert.ok(raw.length > 128 * 1024);
    assert.ok(raw.length <= 4 * 1024 * 1024);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, ".github", "extensions",
        "my-workflow", "canvas-config.json"), "utf8"));
    assert.equal(config.readOnlyFields.length, 100);
    assert.equal(config.readOnlyFields[99].value, "x".repeat(1000));
});

test("the generator rejects a frozen request above its shared size limit", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    await writeFile(path, "x".repeat(4 * 1024 * 1024 + 1));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Generation request is too large/);
});

test("six maximum-size generated pages fit the frozen request and materialize", async (t) => {
    const { project, workspace } = await fixture(t);
    const pages = join(project, ".specify", "pages");
    await mkdir(pages, { recursive: true });
    const generatedPages = [], templates = [...model.templates];
    const rendererContent = "export function renderPage({ root }) { root.textContent = 'Overview'; }"
        .padEnd(32 * 1024, " ");
    for (let index = 0; index < 6; index++) {
        const id = `canvas-generated-${index}`, renderer = `canvas-renderer-${index}`;
        const title = `Overview ${index}`;
        const definition = JSON.stringify({ schemaVersion: 1, id, renderer, title })
            .padEnd(32 * 1024, " ");
        generatedPages.push({ name: id, id, title, renderer });
        for (const [name, kind, content, extension] of [
            [id, "generated.added-page-definition", definition, "json"],
            [renderer, "generated.added-page-renderer", rendererContent, "mjs"],
        ]) {
            const path = join(pages, `${name}.${extension}`);
            await writeFile(path, content);
            templates.push({ name, path, kind, sourceId: "test-preset", strategy: "replace",
                hash: createHash("sha256").update(content).digest("hex") });
        }
    }
    const prepared = await freezeGeneration({ project, workspace,
        model: { ...model, generatedPages, templates }, values, handoff });
    const request = await readFile(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json"));
    assert.ok(request.length > 512 * 1024);
    assert.ok(request.length <= 4 * 1024 * 1024);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    for (const page of generatedPages) {
        const bytes = await readFile(join(project, ".github", "extensions", values["canvas.id"],
            "pages", `${page.renderer}.mjs`));
        assert.equal(bytes.length, 32 * 1024);
    }
});

test("generated navigation preserves frozen order with explicit and implicit page orders", async (t) => {
    const { project, workspace } = await fixture(t);
    const pages = join(project, ".specify", "pages");
    await mkdir(pages, { recursive: true });
    const generatedPages = [], templates = [...model.templates];
    for (const [id, order] of [["explicit", 50], ["implicit", undefined]]) {
        const pageId = `canvas-generated-${id}`, renderer = `canvas-renderer-${id}`;
        const definition = JSON.stringify({ schemaVersion: 1, id: pageId, title: id,
            renderer, ...(order !== undefined ? { order } : {}) });
        generatedPages.push({ name: pageId, id: pageId, title: id, renderer,
            ...(order !== undefined ? { order } : {}) });
        for (const [name, kind, content, extension] of [
            [pageId, "generated.added-page-definition", definition, "json"],
            [renderer, "generated.added-page-renderer", "export function renderPage() {}", "mjs"],
        ]) {
            const path = join(pages, `${name}.${extension}`);
            await writeFile(path, content);
            templates.push({ name, path, kind, sourceId: "test-preset", strategy: "replace",
                hash: createHash("sha256").update(content).digest("hex") });
        }
    }
    const prepared = await freezeGeneration({ project, workspace,
        model: { ...model, generatedPages, templates }, values, handoff });
    const frozen = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    const expected = ["canvas-generated-implicit", "canvas-generated-explicit"];
    assert.deepEqual(frozen.generatedPages.map(({ id }) => id), expected);

    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, ".github", "extensions",
        values["canvas.id"], "canvas-config.json"), "utf8"));
    assert.deepEqual(config.generatedPages.map(({ id }) => id), expected);
    const navigation = renderHtml(config).match(/<nav class="phase-navigation" aria-label="Canvas pages">([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(navigation);
    assert.deepEqual([...navigation.matchAll(/data-canvas-page="([^"]+)"/g)]
        .map(([, id]) => id), ["workflow", ...expected]);
});

test("generated stock scalar is escaped, read-only and absent from unchanged defaults", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const target = join(project, ".github", "extensions", "my-workflow");
    const { readConfig } = await import(pathToFileURL(join(target, "server.mjs")).href);
    const defaultConfig = JSON.parse(await readFile(join(target, "canvas-config.json"), "utf8"));
    assert.equal(defaultConfig.readOnlyFields, undefined);
    assert.doesNotMatch(renderHtml(defaultConfig), /Configured fields|data-field-id/);
    const config = { ...defaultConfig,
        readOnlyFields: [{ id: "billing.costCode", label: "Cost code", value: '<script>"CC"</script>' }] };
    const html = stockMarkup(config);
    assert.match(html, /data-field-id="billing.costCode">&lt;script&gt;&quot;CC&quot;&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>"CC"<\/script>|<input[^>]+billing\.costCode/);
    const pagesHtml = renderHtml({ ...config, generatedPages: [
        { id: "undeclared", title: "Undeclared", renderer: "undeclared", values: [] },
        { id: "declared", title: "Declared", renderer: "declared", values: ["billing.costCode"],
            slots: [{ id: "hero.logo", accepts: ["asset"] }] },
    ], generatedPageAssets: [{ id: "brand.gallery", page: "declared",
        slot: "hero.logo", label: "Gallery logo", file: "asset-gallery.png",
        mime: "image/png", hash: "a".repeat(64) }] });
    assert.doesNotMatch(pagesHtml, /<section id="generated-page"[^>]*data-values=/);
    assert.match(pagesHtml, /data-generated-renderer="undeclared"[\s\S]*?data-values="\{\}"/);
    assert.match(pagesHtml, /data-generated-renderer="declared"[\s\S]*?data-values="\{&quot;billing\.costCode&quot;:&quot;&lt;script&gt;\\&quot;CC\\&quot;&lt;\/script&gt;&quot;\}"/);
    assert.match(pagesHtml, /data-generated-renderer="declared"[\s\S]*?data-asset-slots="\[\{&quot;id&quot;:&quot;hero\.logo&quot;,&quot;accepts&quot;:\[&quot;asset&quot;\]\}\]"/);
    assert.match(pagesHtml, /data-generated-renderer="declared"[\s\S]*?data-assets="\[\{&quot;id&quot;:&quot;brand\.gallery&quot;/);
    const grouped = stockMarkup({ ...defaultConfig, readOnlyFields: [
        { id: "billing.costCode", label: "Cost code", value: "CC-481",
            section: { id: "billing", title: "Billing" } },
        { id: "billing.other", label: "Other code", value: "CC-482",
            section: { id: "billing", title: "Billing" } },
        { id: "finance.code", label: "Finance code", value: "CC-483",
            section: { id: "finance", title: "Billing" } },
        { id: "note", label: "Note", value: "Untitled" },
    ] });
    assert.equal((grouped.match(/<h2>Billing<\/h2>/g) ?? []).length, 2);
    assert.equal((grouped.match(/<h2>Configured fields<\/h2>/g) ?? []).length, 1);
    assert.match(grouped, /<h2>Billing<\/h2><\/summary><dl[^>]*>[\s\S]*?billing\.costCode[\s\S]*?billing\.other[\s\S]*?<\/dl>/);
    for (const invalid of [
        [{ id: "billing.costCode", label: "Cost code", value: 123 }],
        [{ id: "billing.costCode", label: "Cost code", value: "x".repeat(1001) }],
        [{ id: "billing.costCode", label: "Cost code", value: "one" },
            { id: "billing.costCode", label: "Duplicate", value: "two" }],
        [{ id: "billing.costCode", label: "Cost code", value: "one",
            section: { id: "billing", title: "" } }],
        [{ id: "billing.costCode", label: "Cost code", value: "one",
            section: { id: "billing", title: "Billing" } },
        { id: "billing.other", label: "Other code", value: "two",
            section: { id: "billing", title: "Finance" } }],
    ]) {
        await writeFile(join(target, "canvas-config.json"),
            JSON.stringify({ ...defaultConfig, readOnlyFields: invalid }));
        assert.throws(() => readConfig(), /Invalid generated canvas configuration|Conflicting generated canvas section/);
    }
    await writeFile(join(target, "canvas-config.json"),
        JSON.stringify({ ...defaultConfig, generatedPages: [{
            id: "workflow", title: "Workflow", renderer: "workflow-renderer",
        }] }));
    assert.throws(() => readConfig(), /Invalid generated canvas configuration/);
    for (const name of ["con", "prn", "aux", "nul", "com1", "lpt9"]) {
        for (const field of ["id", "renderer"]) {
            await writeFile(join(target, "canvas-config.json"),
                JSON.stringify({ ...defaultConfig, generatedPages: [{
                    id: "overview", title: "Overview", renderer: "overview-renderer", [field]: name,
                }] }));
            assert.throws(() => readConfig(), /Invalid generated canvas configuration/);
        }
    }
    await writeFile(join(target, "canvas-config.json"),
        JSON.stringify({ ...defaultConfig, canvas: { ...defaultConfig.canvas, id: "con" } }));
    assert.throws(() => readConfig(), /Invalid generated canvas configuration/);
});

test("materialization rejects a re-signed request with a Windows device Canvas ID", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(path, "utf8"));
    request.canvas.id = "con";
    request.values["canvas.id"] = "con";
    request.target = ".github/extensions/con/";
    const { integrity, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(path, JSON.stringify(request));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen (?:Designer field: canvas\.id|canvas identity)/);
    await assert.rejects(readdir(join(project, ".github", "extensions")), { code: "ENOENT" });
});

test("materialization rejects re-signed requests that diverge from frozen Essentials", async (t) => {
    for (const [field, canvasField, original] of [
        ["canvas.description", "description", values["canvas.description"]],
        ["canvas.workflowListName", "workflowListName", values["canvas.workflowListName"]],
        ["canvas.description", "description", ""],
        ["canvas.workflowListName", "workflowListName", ""],
    ]) {
        await t.test(`${field} ${original ? "explicit" : "default"}`, async (child) => {
            const selectedValues = { ...values, [field]: original };
            const { project, workspace, prepared, sdk } = await fixture(child, handoff, selectedValues);
            const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
                "generations", prepared.requestId, "request.json");
            const request = JSON.parse(await readFile(path, "utf8"));
            request.canvas[canvasField] = "A different value";
            const { integrity, ...payload } = request;
            request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
            await writeFile(path, JSON.stringify(request));
            await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
                /Invalid frozen canvas identity/);
            await assert.rejects(readdir(sdk), { code: "ENOENT" });
        });
    }
});

test("materialization accepts frozen default description and workflow header", async (t) => {
    const selectedValues = { ...values, "canvas.description": "", "canvas.workflowListName": "" };
    const { project, workspace, prepared, sdk } = await fixture(t, handoff, selectedValues);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.equal(config.canvas.description, "Spec Kit workflow canvas.");
    assert.equal(config.canvas.workflowListName, "Workflows");
    assert.equal(config.canvas.workflowItemName, "Workflow");
});

test("item naming survives generation while keeping legacy IDs, slugs and configurations", async (t) => {
    const namedModel = structuredClone(model);
    namedModel.constraints["canvas.workflowItemName"] = {
        type: "string", maxLength: 80, pattern: "^[^\\x00-\\x1f\\x7f]*$",
    };
    const selected = { ...values, "canvas.workflowListName": "Bugs", "canvas.workflowItemName": "Bug" };
    const { project, workspace, prepared, sdk } = await fixture(t, handoff, selected, undefined, namedModel);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const configPath = join(sdk, "canvas-config.json");
    const { readConfig, renderHtml: renderPackaged } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const config = readConfig();
    assert.equal(config.canvas.workflowListName, "Bugs");
    assert.equal(config.canvas.workflowItemName, "Bug");
    const html = renderPackaged(config);
    assert.match(html, /&quot;workflowListName&quot;:&quot;Bugs&quot;/);
    assert.match(html, /&quot;workflowItemName&quot;:&quot;Bug&quot;/);
    const markup = stockMarkup(config);
    assert.match(markup, /id="workflow-heading">Bugs/);
    assert.match(markup, /aria-label="New Bug"/);
    assert.match(markup, /id="workflow-name-label">Bug name/);
    assert.match(markup, /placeholder="Bug 1"/);
    assert.match(markup, /placeholder="bug-1"/);
    const { pageAdapter, pageAdapterHash, ...fallbackPage } = config.workflowPage;
    assert.match(renderPackaged({ ...config, workflowPage: fallbackPage }), /placeholder="bug-1"/);
    assert.match(markup, />Delete Bug<\/button>/);

    await mkdir(join(project, "specs", "workflow-1"), { recursive: true });
    const session = { sessionId: "naming-test", on: () => () => {},
        getEvents: async () => [], log: async () => {} };
    const runtime = await createRuntime({ config, cwd: project, workspace, session });
    t.after(() => runtime.close());
    const pending = await runtime.createPending({ revision: 0 });
    assert.equal(pending.id, "__new__:2");
    const draft = (await runtime.snapshot()).items.find((item) => item.id === pending.id);
    assert.equal(draft.label, "Bug 2");
    assert.equal(draft.slug, "");
    const reopened = await createRuntime({ config, cwd: project, workspace, session });
    t.after(() => reopened.close());
    assert.equal((await reopened.snapshot()).items.find((item) => item.id === pending.id).label, "Bug 2");

    for (const invalid of [null, "", " Bug", "Bug\nReport", "x".repeat(81)]) {
        await writeFile(configPath, JSON.stringify({
            ...config, canvas: { ...config.canvas, workflowItemName: invalid },
        }));
        assert.throws(readConfig, /Invalid generated canvas configuration/);
    }
    const legacy = structuredClone(config);
    delete legacy.canvas.workflowItemName;
    await writeFile(configPath, JSON.stringify(legacy));
    const oldConfig = readConfig();
    assert.equal(oldConfig.canvas.workflowListName, "Bugs");
    assert.match(stockMarkup(oldConfig), /aria-label="New Workflow"/);
    assert.match(stockMarkup(oldConfig), /placeholder="workflow-1"/);
    assert.match(renderPackaged({ ...oldConfig, workflowPage: fallbackPage }), /placeholder="workflow-1"/);
    assert.match(renderPackaged(oldConfig), /&quot;workflowItemName&quot;:&quot;Workflow&quot;/);
});

test("materialization rejects inconsistent frozen item names", async (t) => {
    for (const [label, mutate] of [
        ["different value", (request) => { request.canvas.workflowItemName = "Issue"; }],
        ["missing value", (request) => { delete request.canvas.workflowItemName; }],
        ["blank value", (request) => { request.canvas.workflowItemName = ""; }],
        ["non-string value", (request) => { request.canvas.workflowItemName = 1; }],
        ["too-long value", (request) => { request.canvas.workflowItemName = "x".repeat(81); }],
    ]) {
        await t.test(label, async (child) => {
            const namedModel = structuredClone(model);
            namedModel.constraints["canvas.workflowItemName"] = {
                type: "string", maxLength: 80, pattern: "^[^\\x00-\\x1f\\x7f]*$",
            };
            const { project, workspace, prepared, sdk } = await fixture(child, handoff,
                { ...values, "canvas.workflowItemName": "Bug" }, undefined, namedModel);
            const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
                "generations", prepared.requestId, "request.json");
            const request = JSON.parse(await readFile(path, "utf8"));
            mutate(request);
            const { integrity: _integrity, ...payload } = request;
            request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
            await writeFile(path, JSON.stringify(request));
            await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
                /Invalid frozen canvas identity/);
            await assert.rejects(readdir(sdk), { code: "ENOENT" });
        });
    }
});

test("legacy frozen generation requests without an item name retain the Workflow default", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(path, "utf8"));
    delete request.canvas.workflowItemName;
    const { integrity: _integrity, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(path, JSON.stringify(request));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml: renderPackaged } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    assert.match(renderPackaged(readConfig()), /&quot;workflowItemName&quot;:&quot;Workflow&quot;/);
});

async function delayedSessionSdk(target, workspace, project) {
    const sdk = join(target, "node_modules", "@github", "copilot-sdk");
    await mkdir(sdk, { recursive: true });
    await writeFile(join(sdk, "package.json"), JSON.stringify({ name: "@github/copilot-sdk",
        type: "module", exports: { "./extension": "./extension.mjs" } }));
    await writeFile(join(sdk, "extension.mjs"), `
        export const registered = Promise.withResolvers();
        export const joined = Promise.withResolvers();
        export let snapshots = 0;
        export const createCanvas = (options) => options;
        export const session = {
            sessionId: "test-session", workspacePath: ${JSON.stringify(workspace)},
            rpc: { metadata: { snapshot: async () => {
                snapshots++;
                return { workingDirectory: ${JSON.stringify(project)} };
            } } },
            on: () => () => {}, getEvents: async () => [], log: async () => {}
        };
        export function joinSession({ canvases }) {
            const canvas = canvases[0];
            registered.resolve({ canvas,
                opening: canvas.open({ instanceId: "generated-test" }) });
            return joined.promise;
        }
    `);
    return import(pathToFileURL(join(sdk, "extension.mjs")).href);
}

test("source-owned SDK entry waits for session readiness, serves and closes the generated canvas", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    const result = await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    assert.equal(result.target, ".github/extensions/my-workflow/");
    const target = join(project, ".github", "extensions", "my-workflow");
    await assert.rejects(readdir(join(workspace, "extensions")), { code: "ENOENT" });
    const entry = await readFile(join(target, "extension.mjs"), "utf8");
    assert.equal(entry, entryTemplate);
    assert.match(entry, /joinSession\(\{/);
    assert.match(entry, /createCanvas\(\{/);
    assert.match(entry, /createServer\(\(req, res\)/);
    assert.match(entry, /server\.listen\(0, "127\.0\.0\.1"/);
    assert.match(entry, /onClose: \(ctx\) => withLifecycle\(async \(\) =>/);
    assert.match(entry, /entry\.server\.close/);
    assert.doesNotMatch(entry, /Example agent-callable action/);
    assert.equal((await readFile(join(target, "ui", "workflow-theme.css"), "utf8"))
        .includes(".app-header"), true);
    const config = JSON.parse(await readFile(join(target, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.phases, handoff.workflow.selectedPhases);
    assert.equal(config.userProvidesSlug, false);
    assert.deepEqual(config.installed, { presets: [{ id: "copilot-sub-agents", version: "1.0.0", priority: 1 }],
        extensions: [], bundles: [] });
    assert.equal(Object.hasOwn(config, "resultTags"), false);
    assert.equal(Object.hasOwn(config, "phaseResults"), false);
    for (const removed of ["result-tags.mjs", "tag-evaluator.mjs", "staleness.mjs"]) {
        await assert.rejects(readFile(join(target, removed)), { code: "ENOENT" });
    }
    const sdk = await delayedSessionSdk(target, workspace, project);
    const importing = import(pathToFileURL(join(target, "extension.mjs")).href);
    const imported = importing.then(() => null, (error) => error);
    const { canvas, opening } = await sdk.registered.promise;
    let settled = false;
    const observed = opening.then(() => { settled = true; }, () => { settled = true; });
    t.after(async () => {
        sdk.joined.resolve(sdk.session);
        await imported;
        await observed;
        await canvas.onClose({ instanceId: "generated-test" });
    });
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(sdk.snapshots, 0);
    sdk.joined.resolve(sdk.session);
    assert.equal(await imported, null);
    assert.equal(canvas.id, "my-workflow");
    assert.deepEqual(canvas.actions.map((action) => action.name),
        ["run_phase", "report_workflow_slug", "report_phase_artifact", "report_autopilot_step"]);
    const opened = await opening;
    assert.equal(sdk.snapshots, 1);
    assert.deepEqual(await canvas.open({ instanceId: "generated-test" }), opened);
    assert.match(await (await fetch(opened.url)).text(), /My Workflow/);
    const state = await (await fetch(new URL(`/api/state?token=${new URL(opened.url).searchParams.get("token")}`,
        opened.url))).json();
    assert.ok(state.phases, JSON.stringify(state));
    assert.deepEqual(state.phases.map((phase) => phase.id), handoff.workflow.selectedPhases);
    const token = new URL(opened.url).searchParams.get("token");
    const request = (route, body) => fetch(new URL(route, opened.url), { method: "POST",
        headers: { "x-canvas-token": token, "Content-Type": "application/json" },
        body: JSON.stringify(body) });
    const added = await request("/api/workflow/new", { revision: state.revision });
    assert.equal(added.status, 200);
    const created = await added.json();
    const pending = await (await fetch(new URL(`/api/state?token=${token}`, opened.url))).json();
    assert.equal(pending.items.find((item) => item.id === created.id).slug, "");
    const removed = await request("/api/workflow/pending/remove",
        { itemId: created.id, revision: pending.revision });
    assert.equal(removed.status, 200);
    await canvas.onClose({ instanceId: "generated-test" });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId));
});

test("generated canvas startup and restored open reject a failed session join", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const target = join(project, ".github", "extensions", "my-workflow");
    const sdk = await delayedSessionSdk(target, workspace, project);
    const importing = import(pathToFileURL(join(target, "extension.mjs")).href);
    const imported = importing.then(() => null, (error) => error);
    const { canvas, opening } = await sdk.registered.promise;
    let settled = false;
    const opened = opening.then((value) => {
        settled = true;
        return value;
    }, (error) => {
        settled = true;
        return error;
    });
    t.after(async () => {
        sdk.joined.resolve(sdk.session);
        await imported;
        await opened;
        await canvas.onClose({ instanceId: "generated-test" });
    });
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(sdk.snapshots, 0);
    const failure = new Error("Session join failed");
    sdk.joined.reject(failure);
    assert.equal(await imported, failure);
    assert.equal(await opened, failure);
    assert.equal(sdk.snapshots, 0);
});

test("generation rejects malformed or mismatched frozen page assets before creating a target", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(path, "utf8"));
    const definition = JSON.stringify({ schemaVersion: 1, id: "canvas-generated-overview",
        renderer: "canvas-generated-overview-renderer", title: "Overview" });
    const module = "export function renderPage({ root }) { root.textContent = 'Overview'; }";
    const asset = (name, kind, content) => ({ name, kind, sourceId: "copilot-generated-page-test",
        hash: createHash("sha256").update(content).digest("hex"),
        content: Buffer.from(content).toString("base64") });
    request.generatedPages = [{ id: "canvas-generated-overview", title: "Overview",
        renderer: "canvas-generated-overview-renderer", assets: [
            asset("canvas-generated-overview", "generated.added-page-definition", definition),
            asset("canvas-generated-overview-renderer", "generated.added-page-renderer", module),
        ] }];
    for (const change of [
        (page) => { page.assets[0].hash = "0".repeat(64); },
        (page) => { page.assets[1].kind = "script"; },
        (page) => { page.title = "Changed"; },
        (page) => { page.renderer = "../escape"; },
        (page) => { page.id = "workflow"; },
        (page) => { page.assets[1] = asset(page.renderer, "generated.added-page-renderer",
            module.padEnd(32 * 1024 + 1, " ")); },
    ]) {
        const trial = structuredClone(request);
        change(trial.generatedPages[0]);
        const { integrity: _old, ...payload } = trial;
        trial.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        await writeFile(path, JSON.stringify(trial));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            /Invalid frozen generated page assets|frozen generated page definition|Invalid frozen generated pages/);
        await assert.rejects(readdir(sdk), { code: "ENOENT" });
    }
    for (const [field, name] of [["id", "con"], ["renderer", "nul"]]) {
        const trial = structuredClone(request);
        const page = trial.generatedPages[0];
        page[field] = name;
        page.assets[0] = asset(page.id, "generated.added-page-definition", JSON.stringify({
            schemaVersion: 1, id: page.id, renderer: page.renderer, title: page.title,
        }));
        page.assets[1] = asset(page.renderer, "generated.added-page-renderer", module);
        const { integrity: _old, ...payload } = trial;
        trial.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        await writeFile(path, JSON.stringify(trial));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            /Invalid frozen generated page assets/);
        await assert.rejects(readdir(sdk), { code: "ENOENT" });
    }
    const boundary = structuredClone(request);
    boundary.generatedPages[0].assets[1] = asset("canvas-generated-overview-renderer",
        "generated.added-page-renderer", module.padEnd(32 * 1024, " "));
    const { integrity: _old, ...payload } = boundary;
    boundary.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(path, JSON.stringify(boundary));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    assert.equal((await readFile(join(project, ".github", "extensions", "my-workflow",
        "pages", "canvas-generated-overview-renderer.mjs"))).length, 32 * 1024);
});

test("generated page IDs cannot overwrite fixed page assets before target creation", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    const digest = (content) => createHash("sha256").update(content).digest("hex");
    const asset = (name, kind, content) => ({
        name, kind, sourceId: "copilot-generated-page-test",
        hash: digest(content), content: Buffer.from(content).toString("base64"),
    });
    for (const id of ["phase-control"]) {
        const request = structuredClone(original);
        const renderer = "unique-page-renderer";
        request.generatedPages = [{
            id, title: "Extra page", renderer, assets: [
                asset(id, "generated.added-page-definition", JSON.stringify({
                    schemaVersion: 1, id, renderer, title: "Extra page",
                })),
                asset(renderer, "generated.added-page-renderer",
                    "export function renderPage({ root }) { root.textContent = 'Extra page'; }"),
            ],
        }];
        const { integrity: _previous, ...payload } = request;
        request.integrity = digest(JSON.stringify(payload));
        await writeFile(path, JSON.stringify(request));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            new RegExp(`Conflicting generated page asset: ${id}\\.json`));
        await assert.rejects(readdir(sdk), { code: "ENOENT" });
    }
});

test("Workflow layout and phase control freeze, validate and package independently of the preset", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const original = JSON.parse(await readFile(requestPath, "utf8"));
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const rewrite = async (edit) => {
        const request = structuredClone(original);
        edit(request);
        const { integrity: _old, ...payload } = request;
        request.integrity = digest(JSON.stringify(payload));
        await writeFile(requestPath, JSON.stringify(request));
    };
    for (const edit of [
        (page) => { page.slots.pop(); },
        (page) => { page.slots.push({ id: "workflow.phases" }); },
        (page) => { page.title = "../escape"; },
        (page) => { page.assets[1].hash = "0".repeat(64); },
        (page) => { page.assets[2].kind = "script"; },
        (page) => {
            const bytes = Buffer.from('{"schemaVersion":1,"id":"workflow-phases","adapter":"wrong"}');
            page.assets[1].content = bytes.toString("base64");
            page.assets[1].hash = digest(bytes);
        },
        (page) => {
            const bytes = Buffer.from("export function mount( {");
            page.assets[2].content = bytes.toString("base64");
            page.assets[2].hash = digest(bytes);
        },
    ]) {
        await rewrite((request) => edit(request.workflowPage));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            /Invalid frozen Workflow page assets|Frozen Workflow page definition|Invalid frozen phase control/);
        await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    }
    await rewrite((request) => {
        const bytes = Buffer.from(JSON.stringify({
            schemaVersion: 1, id: "workflow-phases", adapter: "generated-phase-adapter",
            placement: { page: "workflow", slot: "workflow.missing" },
        }));
        request.workflowPage.assets[1].content = bytes.toString("base64");
        request.workflowPage.assets[1].hash = digest(bytes);
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen phase control definition/);
    await rewrite((request) => { request.workflowPage.managedRun = true; });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Frozen phase control capabilities differ from its definition/);
    const replacement = await readFile(new URL(
        "../../spec-kit-presets/copilot-vertical-phase-control/generated/phase-adapter.mjs", import.meta.url));
    const control = await readFile(new URL(
        "../../spec-kit-presets/copilot-vertical-phase-control/generated/phase-control.json", import.meta.url));
    const presetPath = join(project, ".specify", "templates", "generated-phase-adapter.mjs");
    const controlPath = join(project, ".specify", "templates", "phase-control.json");
    await writeFile(presetPath, replacement);
    await writeFile(controlPath, control);
    const presetModel = { ...model, workflowPage: { ...model.workflowPage, managedRun: true },
        templates: model.templates.map((entry) =>
        entry.name === "generated-phase-control"
            ? { ...entry, sourceId: "copilot-vertical-phase-control", hash: digest(control) }
            : entry.name === "generated-phase-adapter"
            ? { ...entry, sourceId: "copilot-vertical-phase-control", hash: digest(replacement) }
            : entry) };
    const frozen = await freezeGeneration({ model: presetModel, values, handoff, project, workspace });
    await rm(presetPath);
    await rm(controlPath);
    await materialize(project, workspace, handoff.handoffId, frozen.requestId);
    assert.deepEqual(await readFile(join(sdk, "pages", "generated-phase-adapter.mjs")), replacement);
    const { readConfig, renderHtml: renderPackaged } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    assert.equal(readConfig().workflowPage.hash, digest(replacement));
    assert.equal(readConfig().workflowPage.managedRun, true);
    assert.equal(readConfig().workflowPage.phaseControl, "generated-phase-control");
    assert.deepEqual(await readdir(join(sdk, "pages")), [
        "generated-phase-adapter.mjs", "generated-workflow-page-adapter.mjs",
        "phase-control.json", "workflow.json",
    ]);
    assert.match(renderPackaged(readConfig()), /data-module="\/pages\/generated-phase-adapter.mjs"/);
    await writeFile(join(sdk, "pages", "phase-control.json"), '{"schemaVersion":1,"id":"workflow-phases","adapter":"wrong"}');
    assert.throws(() => readConfig(), /phase control/);
    await writeFile(join(sdk, "pages", "phase-control.json"), control);
    await writeFile(join(sdk, "pages", "generated-phase-adapter.mjs"), "export function mount() {}");
    assert.throws(() => readConfig(), /phase control|Invalid generated canvas/);
});

test("a preset-style Workflow page adapter freezes independently and detects packaged tampering", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    const definition = JSON.parse(Buffer.from(request.workflowPage.assets[0].content, "base64"));
    definition.badgeDestinations = ["workflow.list"];
    const bytes = Buffer.from(JSON.stringify(definition));
    const replacement = Buffer.from(`export const pageId = "workflow";
export const contractVersion = 1;
export function mount({ root, actions }) {
    root.replaceChildren();
    const button = document.createElement("button");
    button.textContent = "Choose workflow";
    button.addEventListener("click", () => actions.selectWorkflow("__new__"));
    root.append(button);
    return { update(state) { button.disabled = !state.model; }, dispose() { button.remove(); } };
}`);
    request.workflowPage.assets[0].content = bytes.toString("base64");
    request.workflowPage.assets[0].hash = createHash("sha256").update(bytes).digest("hex");
    request.workflowPage.assets[3].sourceId = "copilot-workflow-page-test";
    request.workflowPage.assets[3].content = replacement.toString("base64");
    request.workflowPage.assets[3].hash = createHash("sha256").update(replacement).digest("hex");
    const { integrity: _old, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(request));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    assert.deepEqual(await readFile(join(sdk, "pages", "generated-workflow-page-adapter.mjs")),
        replacement);
    const originalDocument = globalThis.document;
    globalThis.document = { createElement: () => ({
        addEventListener(name, listener) { this.listener = listener; },
        remove() { this.removed = true; },
    }) };
    t.after(() => { globalThis.document = originalDocument; });
    const alternate = await import(pathToFileURL(join(sdk, "pages", "generated-workflow-page-adapter.mjs")).href);
    let selected;
    const root = { replaceChildren() {}, append(button) { this.button = button; } };
    const mounted = alternate.mount({ root, actions: { selectWorkflow: (id) => { selected = id; } } });
    mounted.update({ model: {} });
    root.button.listener();
    assert.equal(selected, "__new__");
    assert.equal(root.button.disabled, false);
    mounted.dispose();
    assert.equal(root.button.removed, true);
    const { readConfig } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    assert.deepEqual(readConfig().workflowPage.badgeDestinations, ["workflow.list"]);
    await writeFile(join(sdk, "pages", "generated-workflow-page-adapter.mjs"),
        "export function mount() {}");
    assert.throws(() => readConfig(), /Workflow page adapter/);
});

test("phase view label preset and differently named adapter survive generation", async (t) => {
    const { project, workspace, sdk } = await fixture(t);
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const preset = JSON.parse(await readFile(new URL(
        "../../tests/fixtures/test-presets/copilot-phase-view-label-test/generated/phase-control.json", import.meta.url)));
    const control = model.templates.find((item) => item.name === "generated-phase-control");
    const adapter = model.templates.find((item) => item.name === "generated-phase-adapter");
    const presetBytes = Buffer.from(JSON.stringify(preset));
    await writeFile(control.path, presetBytes);
    const presetModel = { ...model, templates: model.templates.map((item) =>
        item === control ? { ...item, sourceId: "copilot-phase-view-label-test", hash: digest(presetBytes) } : item) };
    const presetFrozen = await freezeGeneration({ project, workspace, model: presetModel, values, handoff });
    const presetRequest = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", presetFrozen.requestId, "request.json"), "utf8"));
    assert.deepEqual(JSON.parse(Buffer.from(presetRequest.workflowPage.assets[1].content, "base64")), preset);
    assert.equal(presetRequest.workflowPage.assets[2].name, "generated-phase-adapter");
    const renamed = "custom-phase-adapter";
    preset.adapter = renamed;
    const controlBytes = Buffer.from(JSON.stringify(preset));
    const adapterBytes = await readFile(adapter.path);
    const adapterPath = join(project, ".specify", "templates", `${renamed}.mjs`);
    await writeFile(control.path, controlBytes);
    await writeFile(adapterPath, adapterBytes);
    const customModel = { ...model, templates: [...model.templates.map((item) =>
        item === control ? { ...item, sourceId: "copilot-phase-view-label-test", hash: digest(controlBytes) }
            : item), { ...adapter, name: renamed, path: adapterPath, hash: digest(adapterBytes) }] };
    const frozen = await freezeGeneration({ project, workspace, model: customModel, values, handoff });
    await materialize(project, workspace, handoff.handoffId, frozen.requestId);
    const { readConfig, renderHtml: renderPackaged } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const config = readConfig();
    assert.equal(config.workflowPage.adapter, renamed);
    assert.deepEqual(config.workflowPage.viewLabels, { plan: "View Plan" });
    assert.deepEqual(await readFile(join(sdk, "pages", `${renamed}.mjs`)), adapterBytes);
    assert.match(renderPackaged(config), /data-module="\/pages\/custom-phase-adapter.mjs"/);
    assert.match(renderPackaged(config), /data-view-labels="\{&quot;plan&quot;:&quot;View Plan&quot;\}"/);

    const unknown = { ...preset, viewLabels: { unknown: "View unknown" } };
    const unknownBytes = Buffer.from(JSON.stringify(unknown));
    await writeFile(control.path, unknownBytes);
    const invalidModel = { ...customModel, templates: customModel.templates.map((item) =>
        item.name === "generated-phase-control" ? { ...item, hash: digest(unknownBytes) } : item) };
    await assert.rejects(freezeGeneration({ project, workspace, model: invalidModel, values, handoff }),
        /Missing validated Workflow page, phase control, or adapter/);
});

test("materialized managed-run canvas starts a selected pending workflow without Specify", async (t) => {
    const selectedHandoff = structuredClone(handoff);
    const phase = "speckit.bug.assess";
    selectedHandoff.workflow.selectedPhases = [phase];
    selectedHandoff.sourceFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: selectedHandoff.workflow, selections: selectedHandoff.selections,
    })).digest("hex");
    const { project, workspace, sdk } = await fixture(t, selectedHandoff);
    const templates = [];
    for (const template of model.templates) {
        const filename = template.name === "generated-phase-control" ? "phase-control.json"
            : template.name === "generated-phase-adapter" ? "phase-adapter.mjs" : null;
        if (!filename) {
            templates.push(template);
            continue;
        }
        const bytes = await readFile(new URL(
            `../../spec-kit-presets/copilot-vertical-phase-control/generated/${filename}`, import.meta.url));
        await writeFile(template.path, bytes);
        templates.push({ ...template, sourceId: "copilot-vertical-phase-control",
            hash: createHash("sha256").update(bytes).digest("hex") });
    }
    const prepared = await freezeGeneration({ project, workspace, model: { ...model, templates,
        workflowPage: { ...model.workflowPage, managedRun: true } },
        values, handoff: selectedHandoff, outputs: { [phase]: {
            outputs: [".specify/bugs/<slug>/assessment.md"],
            view: ".specify/bugs/<slug>/assessment.md",
        } } });
    await materialize(project, workspace, selectedHandoff.handoffId, prepared.requestId);
    const { readConfig } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const { createRuntime } = await import(pathToFileURL(join(sdk, "runtime.mjs")).href);
    const skill = join(project, ".github", "skills", "speckit-bug-assess");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: speckit-bug-assess\n---\n");
    const sent = [];
    let mode = "interactive";
    const runtime = await createRuntime({ config: readConfig(), cwd: project, workspace,
        session: { sessionId: "generated-autopilot", on: () => () => {},
            getEvents: async () => [], log: async () => {},
            rpc: { skills: { reload: async () => ({ errors: [] }) },
                mode: { get: async () => mode,
                    set: async (input) => { mode = input.mode; return { modeApplied: true }; } } },
            send: async (input) => { sent.push(input); return "generated-message"; } } });
    t.after(() => runtime.close());
    await runtime.createPending({ revision: (await runtime.snapshot()).revision });
    const snapshot = await runtime.snapshot();
    const itemId = snapshot.selected;
    assert.equal(snapshot.items.find((item) => item.id === itemId).status, "Not started");
    const { autopilotId } = await runtime.startAutopilot({ itemId }, "generated-panel");
    assert.equal(sent[0].agentMode, "autopilot");
    assert.ok(sent[0].prompt.includes(`Selected workflow: ${JSON.stringify(itemId)}.`));
    assert.match(sent[0].prompt, /"skill":"speckit-bug-assess"/);
    const started = await runtime.reportAutopilotStep(
        { autopilotId, phase, action: "start" }, "generated-panel");
    assert.equal(started.itemId, itemId);
});

test("generation authorizes managed runs from the frozen definition, never adapter source text", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const original = JSON.parse(await readFile(requestPath, "utf8"));
    const bytes = Buffer.from(`export const controlId = "workflow-phases";
export const contractVersion = 1;
const regex = /\`/;
const example = \`
export const requiredCapabilities = ['workflow.managed-run.v1'];
\`;
export function mount() {}`);
    for (const managedRun of [false, true]) {
        const request = structuredClone(original);
        request.workflowPage.managedRun = managedRun;
        request.workflowPage.assets[2].content = bytes.toString("base64");
        request.workflowPage.assets[2].hash = createHash("sha256").update(bytes).digest("hex");
        const { integrity: _old, ...payload } = request;
        request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        await writeFile(requestPath, JSON.stringify(request));
        if (managedRun) {
            await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
                /Frozen phase control capabilities differ from its definition/);
        } else {
            await materialize(project, workspace, handoff.handoffId, prepared.requestId);
            const { readConfig } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
            assert.equal(readConfig().workflowPage.managedRun, false);
        }
    }
});

test("additional Workflow slots do not reorder the fixed shell", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    const slots = [...request.workflowPage.slots, { id: "workflow.extra" }];
    request.workflowPage.slots = slots;
    const definition = JSON.parse(Buffer.from(request.workflowPage.assets[0].content, "base64"));
    definition.slots = slots;
    const bytes = Buffer.from(JSON.stringify(definition));
    request.workflowPage.assets[0].content = bytes.toString("base64");
    request.workflowPage.assets[0].hash = createHash("sha256").update(bytes).digest("hex");
    const { integrity: _old, ...payload } = request;
    request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(request));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml: renderPackaged } = await import(
        pathToFileURL(join(sdk, "server.mjs")).href);
    const html = renderPackaged(readConfig());
    assert.ok(html.indexOf('id="instance-collection"') < html.indexOf('id="workflow-pipeline"'));
});

test("registered Workflow field placements are packaged and reject unknown slots", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const bytes = Buffer.from(JSON.stringify({
        schemaVersion: 1, id: "workflow-description-placement", page: "workflow",
        slot: "workflow.extra", field: "canvas.description", order: 10,
    }));
    const request = structuredClone(original);
    request.workflowPage.slots.push({ id: "workflow.extra" });
    const page = JSON.parse(Buffer.from(request.workflowPage.assets[0].content, "base64"));
    page.slots = request.workflowPage.slots;
    const pageBytes = Buffer.from(JSON.stringify(page));
    request.workflowPage.assets[0].content = pageBytes.toString("base64");
    request.workflowPage.assets[0].hash = digest(pageBytes);
    request.fieldPlacements = [{
        id: "workflow-description-placement", page: "workflow", slot: "workflow.extra",
        field: "canvas.description", order: 10, label: "Description", control: "stock.text",
        assets: [{ kind: "generated.field-placement", name: "workflow-description-placement",
            sourceId: "test-preset", content: bytes.toString("base64"), hash: digest(bytes) }],
    }];
    request.designerFields = [{ id: "canvas.description", label: "Description", control: "stock.text" }];
    const writeRequest = async () => {
        const { integrity: _previous, ...payload } = request;
        request.integrity = digest(JSON.stringify(payload));
        await writeFile(path, JSON.stringify(request));
    };
    await writeRequest();
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml: renderPackaged } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    assert.equal(readConfig().fieldPlacements[0].field, "canvas.description");
    assert.match(stockMarkup(readConfig()), /data-workflow-slot="workflow.extra"/);
    assert.deepEqual(await readFile(join(sdk, "pages", "workflow-description-placement.json")), bytes);
    request.fieldPlacements[0].slot = "workflow.unknown";
    await writeRequest();
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /frozen generated.field-placement|Invalid generated field placement/i);
});

test("field placement IDs cannot overwrite fixed page assets before target creation", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    const digest = (content) => createHash("sha256").update(content).digest("hex");
    for (const [id, error] of [
        ["phase-control", /Invalid generated field placement: phase-control/],
    ]) {
        const request = structuredClone(original);
        request.workflowPage.slots.push({ id: "workflow.extra" });
        const page = JSON.parse(Buffer.from(request.workflowPage.assets[0].content, "base64"));
        page.slots = request.workflowPage.slots;
        const pageBytes = JSON.stringify(page);
        request.workflowPage.assets[0].content = Buffer.from(pageBytes).toString("base64");
        request.workflowPage.assets[0].hash = digest(pageBytes);
        const placement = JSON.stringify({
            schemaVersion: 1, id, page: "workflow", slot: "workflow.extra",
            field: "canvas.description", order: 10,
        });
        request.fieldPlacements = [{
            id, page: "workflow", slot: "workflow.extra", field: "canvas.description",
            order: 10, label: "Description", control: "stock.text",
            assets: [{ kind: "generated.field-placement", name: id, sourceId: "test-preset",
                content: Buffer.from(placement).toString("base64"), hash: digest(placement) }],
        }];
        request.designerFields = [{ id: "canvas.description", label: "Description", control: "stock.text" }];
        const { integrity: _previous, ...payload } = request;
        request.integrity = digest(JSON.stringify(payload));
        await writeFile(path, JSON.stringify(request));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId), error);
        await assert.rejects(readdir(sdk), { code: "ENOENT" });
    }
});

test("frozen named values reject tampered modules and package independently of their preset", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const original = JSON.parse(await readFile(requestPath, "utf8"));
    const preset = new URL("../../tests/fixtures/test-presets/copilot-canvas-values-test/", import.meta.url);
    const sourceId = "copilot-canvas-values-test";
    const asset = async (name, kind, file) => {
        const content = await readFile(new URL(file, preset));
        return { name, kind, sourceId, hash: createHash("sha256").update(content).digest("hex"),
            content: content.toString("base64") };
    };
    const definitions = [
        ["heading", "canvas-value-heading"],
        ["enabled", "canvas-value-enabled"],
        ["choice", "canvas-value-choice"],
        ["note", "canvas-value-note"],
        ["workflow", "canvas-value-workflow"],
        ["processing", "canvas-value-processing"],
    ];
    const valueSources = await Promise.all(definitions.map(async ([file, name]) => {
        const definition = JSON.parse(await readFile(new URL(`values/${file}.json`, preset)));
        const assets = [await asset(name, "generated.value-definition", `values/${file}.json`)];
        if (definition.source.kind === "computed") {
            assets.push(await asset(definition.source.module, "generated.computed-value-provider", "values/workflow.mjs"));
        }
        const { schemaVersion: _version, ...source } = definition;
        return { ...source, assets };
    }));
    const page = JSON.parse(await readFile(new URL("generated/pages/values.json", preset)));
    const request = { ...original, valueSources, generatedPages: [{
        id: page.id, title: page.title, renderer: page.renderer, values: page.values,
        assets: [
            await asset(page.id, "generated.added-page-definition", "generated/pages/values.json"),
            await asset(page.renderer, "generated.added-page-renderer", "generated/pages/values.mjs"),
        ],
    }] };
    const persist = async (candidate) => {
        const { integrity: _old, ...payload } = candidate;
        await writeFile(requestPath, JSON.stringify({ ...payload,
            integrity: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }));
    };
    for (const name of ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"]) {
        assert.equal(designerDeviceName(name), true);
        assert.equal(runtimeDeviceName(name), true);
        const invalid = structuredClone(request);
        invalid.valueSources.find((entry) => entry.id === "demo.workflow").source.module = name;
        await persist(invalid);
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            /Invalid frozen value source registration/);
        await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    }
    for (const name of ["com0", "com10", "lpt0", "lpt10", "con-1"]) {
        assert.equal(designerDeviceName(name), false);
        assert.equal(runtimeDeviceName(name), false);
    }
    const tampered = structuredClone(request);
    tampered.valueSources.find((entry) => entry.id === "demo.workflow").assets[1].hash = "0".repeat(64);
    await persist(tampered);
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen value source asset/);
    await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    const provider = valueSources.find((entry) => entry.id === "demo.workflow").assets[1];
    const providerSource = await readFile(new URL("values/workflow.mjs", preset), "utf8");
    const oversized = structuredClone(request);
    const oversizedBytes = Buffer.from(providerSource.padEnd(32 * 1024 + 1, " "));
    oversized.valueSources.find((entry) => entry.id === "demo.workflow").assets[1] = {
        ...provider, hash: createHash("sha256").update(oversizedBytes).digest("hex"),
        content: oversizedBytes.toString("base64"),
    };
    await persist(oversized);
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen value source asset/);
    await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    const unregistered = structuredClone(request);
    unregistered.generatedPages[0].values = ["demo.missing"];
    await persist(unregistered);
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen generated page assets|Invalid frozen generated pages|invalid frozen generated page definition/);
    await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    const boundary = structuredClone(request);
    const boundaryBytes = Buffer.from(providerSource.padEnd(32 * 1024, " "));
    boundary.valueSources.find((entry) => entry.id === "demo.workflow").assets[1] = {
        ...provider, hash: createHash("sha256").update(boundaryBytes).digest("hex"),
        content: boundaryBytes.toString("base64"),
    };
    await persist(boundary);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const config = readConfig();
    for (const name of ["con", "com1", "lpt9"]) {
        const invalid = structuredClone(config);
        invalid.valueSources.find((entry) => entry.id === "demo.workflow").source.module = name;
        await writeFile(join(sdk, "canvas-config.json"), JSON.stringify(invalid));
        assert.throws(readConfig, /Invalid value provider/);
    }
    await writeFile(join(sdk, "canvas-config.json"), JSON.stringify(config));
    assert.equal(config.valueSources.length, definitions.length);
    assert.deepEqual(config.generatedPages[0].values, ["demo.processing"]);
    assert.equal(config.valueSources.find((entry) => entry.id === "demo.note").presentation, "stock.editable");
    assert.deepEqual(await readFile(join(sdk, "providers", "canvas-value-workflow-provider.mjs")),
        boundaryBytes);
    const portable = join(workspace, "portable-values");
    const { cp } = await import("node:fs/promises");
    await cp(sdk, portable, { recursive: true });
    const { readConfig: readPortableConfig } = await import(pathToFileURL(join(portable, "server.mjs")).href);
    assert.deepEqual(readPortableConfig().valueSources, config.valueSources);
});

test("Essentials contributes a default-off custom slug option", async () => {
    const page = JSON.parse(await readFile(new URL("../extension-canvas-design/designer-host/tabs/essentials.json", import.meta.url)));
    assert.deepEqual(page.fields.map((entry) => entry.id), ["canvas.id", "canvas.displayName"]);
    const heading = JSON.parse(await readFile(new URL("../extension-canvas-design/designer-host/essentials-settings/workflow-heading.json", import.meta.url)));
    const slug = JSON.parse(await readFile(new URL("../extension-canvas-design/designer-host/essentials-settings/custom-slug.json", import.meta.url)));
    const setup = JSON.parse(await readFile(new URL("../extension-canvas-design/designer-host/essentials-settings/show-setup.json", import.meta.url)));
    assert.equal(slug.field.id, "workflowSlug.userProvided");
    assert.equal(slug.field.default, false);
    const item = JSON.parse(await readFile(new URL("../extension-canvas-design/designer-host/essentials-settings/workflow-item-name.json", import.meta.url)));
    assert.equal(heading.field.id, "canvas.workflowListName");
    assert.equal(heading.field.label, "Header text");
    assert.equal(item.field.id, "canvas.workflowItemName");
    assert.equal(item.field.label, "Workflow item name");
    assert.match(setup.field.description, /review and approve installation/);
    assert.match(setup.field.description, /When off, nothing is installed automatically/);
});

test("legacy result state stays on disk but is not evaluated or shown", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, ".github", "extensions",
        "my-workflow", "canvas-config.json"), "utf8"));
    config.resultTags = [{ id: "legacy" }];
    config.phaseResults = { specify: { source: { kind: "phase-report" }, values: [{ id: "done" }] } };
    const stateKey = createHash("sha256").update(JSON.stringify([project, config.canvas.id])).digest("hex");
    const stateDir = join(workspace, "generated-canvases", stateKey);
    await mkdir(stateDir, { recursive: true });
    const old = { version: 1, revision: 0, selected: "__new__", phase: null, slug: "",
        name: "", names: {}, drafts: {}, runs: [], tagMatches: { old: { id: "old", name: "Old" } } };
    await writeFile(join(stateDir, "state.json"), JSON.stringify(old));
    const skill = join(project, ".github", "skills", "speckit-specify");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: speckit-specify\n---\n");
    let events = [];
    const runtime = await createRuntime({ config, cwd: project, workspace,
        session: { sessionId: "legacy-test", on: () => () => {},
            rpc: { skills: { reload: async () => ({ errors: [] }) } },
            send: async () => "message-legacy",
            getEvents: async () => events, log: async () => {} } });
    t.after(() => runtime.close());
    const snapshot = JSON.parse(JSON.stringify(await runtime.snapshot()));
    assert.equal(Object.hasOwn(snapshot, "tagMatches"), false);
    assert.equal(Object.hasOwn(snapshot, "summaryTags"), false);
    assert.equal(Object.hasOwn(snapshot.statuses.specify, "tags"), false);
    assert.equal(Object.hasOwn(snapshot.phases[1], "results"), false);
    assert.equal(Object.hasOwn(snapshot.items[0] ?? {}, "tags"), false);
    const html = renderHtml(config);
    assert.doesNotMatch(html, /result-tags|tag-diagnostic|checklist-progress/);
    await mkdir(join(project, ".specify", "memory"), { recursive: true });
    await writeFile(join(project, ".specify", "memory", "constitution.md"), "# Existing principles\n");
    await runtime.save({ revision: 0, selected: "__new__" });
    const run = await runtime.run({ phase: "specify", itemId: "__new__", args: "Feature" }, "panel-legacy");
    events = [
        { type: "user.message", data: { messageId: "message-legacy", interactionId: "interaction-legacy" } },
        { type: "assistant.turn_start", data: { interactionId: "interaction-legacy", turnId: "turn-legacy" } },
        { type: "assistant.message", data: { interactionId: "interaction-legacy",
            turnId: "turn-legacy", content: "Done", phase: "final" } },
        { type: "assistant.turn_end", data: { turnId: "turn-legacy" } },
    ];
    const completed = await runtime.refresh();
    assert.equal(completed.statuses.specify.status, "Run output unconfirmed");
    assert.equal(Object.hasOwn(completed.statuses.specify, "result"), false);
    assert.equal(JSON.parse(await readFile(join(stateDir, "state.json"), "utf8"))
        .runs.find((entry) => entry.runId === run.runId).status, "Run output unconfirmed");
    assert.deepEqual(JSON.parse(await readFile(join(stateDir, "state.json"), "utf8")).tagMatches,
        old.tagMatches);
});

test("optional artifact folder slug previews only when enabled and binds the actual directory", async (t) => {
    for (const [mode, requested] of [["enabled", "sample-feature"], ["disabled", "sample-feature"]]) {
        await t.test(mode, async (child) => {
        const enabled = mode === "enabled";
        const { project, workspace, prepared } = await fixture(child, handoff,
            { ...values, "workflowSlug.userProvided": enabled });
        await materialize(project, workspace, handoff.handoffId, prepared.requestId);
        const config = JSON.parse(await readFile(join(project, ".github", "extensions", "my-workflow",
            "canvas-config.json"), "utf8"));
        const html = renderHtml(config);
        assert.equal(config.userProvidesSlug, enabled);
        const collection = stockMarkup(config);
        assert.ok(collection.indexOf('id="constitution-card"') < collection.indexOf('id="instance-collection"'));
        assert.match(collection, /id="constitution-card"/);
        assert.doesNotMatch(stockMarkup({ ...config, phases: ["specify"] }),
            /id="constitution-card"|id="view-constitution"|id="constitution-dialog"/);
        assert.doesNotMatch(collection, /id="feature-select"/);
        assert.match(collection, /id="workflow-list" class="instance-list"/);
        assert.match(collection, /id="workflow-search"/);
        assert.doesNotMatch(html, /id="current-workflow-title"/);
        assert.ok(collection.indexOf('id="workflow-name"') > collection.indexOf('id="new-workflow"'));
        assert.doesNotMatch(collection, /id="workflow-draft-head"|id="cancel-new-workflow"/);
        assert.match(html, /id="workflow-pipeline" hidden data-module="\/pages\/generated-phase-adapter.mjs"/);
        assert.doesNotMatch(html, /id="phase-card"|id="phase-args"|phase-template-/);
        assert.match(collection, /id="workflow-name-label">Workflow name<\/span>/);
        assert.ok(collection.indexOf('id="workflow-name"') < collection.indexOf('id="workflow-slug"'));
        assert.match(collection, /id="workflow-slug-label">Artifact directory slug<\/span>/);
        assert.doesNotMatch(collection, /id="workflow-slug-label"[^<]*Optional/);
        assert.doesNotMatch(collection, /id="workflow-slug"[^>]+required/);
        assert.match(collection, /id="workflow-slug-help">Leave blank to let Spec Kit choose/);
        assert.match(collection, /id="workflow-name-help">Shown in the list\./);
        assert.doesNotMatch(collection, /id="create-first-workflow"/);
        assert.match(collection, /id="new-workflow"[^>]*aria-label="New Workflow">\+ New<\/button>/);
        assert.match(collection, /id="workflow-rows" role="list" aria-labelledby="workflow-heading"/);
        assert.match(collection, /id="workflow-empty">No items yet\.<\/p>/);
        assert.doesNotMatch(collection, /Nothing has been created yet|id="workflow-draft-note"/);
        const ui = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/app.js", import.meta.url), "utf8");
        assert.match(ui, /function slugError\(\)/);
        assert.match(ui, /\$\("workflow-pipeline"\)\.hidden = !workflowPhases\(\)\.length/);
        assert.match(collection, /<h2 id="workflow-heading">Workflows/);
        assert.match(stockMarkup({ ...config, phases: ["constitution"] }), /id="workflow-name"/);
        const skill = join(project, ".github", "skills", "speckit-specify");
        await mkdir(skill, { recursive: true });
        await writeFile(join(skill, "SKILL.md"), "---\nname: speckit-specify\n---\n");
        const prompts = [];
        const runtime = await createRuntime({
            config,
            cwd: project, workspace, session: {
                sessionId: "workflow-test", rpc: { skills: { reload: async () => ({ errors: [] }) } },
                send: async ({ prompt }) => { prompts.push(prompt); return "message-1"; },
                on: () => () => {}, getEvents: async () => [], log: async () => {},
            },
        });
        child.after(() => runtime.close());
        assert.equal((await runtime.snapshot()).userProvidesSlug, enabled);
        assert.equal((await runtime.snapshot()).constitutionReady, false);
        await assert.rejects(runtime.run({ phase: "specify", itemId: "__new__", args: "Feature",
            ...(enabled ? { slug: requested } : {}) }, "panel-1"), /Create a constitution/);
        await mkdir(join(project, ".specify", "memory"), { recursive: true });
        await writeFile(join(project, ".specify", "memory", "constitution.md"), "# Existing principles\n");
        assert.equal((await runtime.snapshot()).constitutionReady, true);
        assert.equal((await runtime.snapshot()).statuses.constitution.artifactAvailability, "available");
        if (!enabled) {
            const pending = await runtime.createPending({ revision: 0 });
            let draft = await runtime.snapshot();
            assert.equal(draft.items.find((item) => item.id === pending.id).slug, "");
            assert.equal(draft.statuses.specify.output, null);
            await assert.rejects(runtime.save({ revision: draft.revision, slug: requested }), /disabled/);
            await runtime.removePending({ itemId: pending.id, revision: draft.revision });
            draft = await runtime.snapshot();
            assert.equal(draft.selected, "__new__");
        }
        await assert.rejects(runtime.run({ phase: "specify", itemId: "__new__", args: "Feature",
            slug: "Invalid Name" }, "panel-1"), /lowercase letters/);
        if (!enabled) await assert.rejects(runtime.run({ phase: "specify", itemId: "__new__",
            args: "Feature", slug: requested }, "panel-1"), /disabled/);
        await assert.rejects(runtime.run({ phase: "specify", itemId: "__new__", args: "Feature",
            name: "\n" }, "panel-1"), /Workflow name/);
        if (!enabled) await assert.rejects(runtime.save({ revision: 0, slug: requested }), /disabled/);
        const revision = (await runtime.snapshot()).revision;
        if (enabled) await runtime.save({ revision, slug: requested, name: "Customer dashboard" });
        else await runtime.save({ revision, name: "Customer dashboard" });
        assert.equal((await runtime.snapshot()).statuses.specify.output,
            enabled ? "specs/sample-feature/spec.md" : null);
        const result = await runtime.run({ phase: "specify", itemId: "__new__", args: "Feature",
            name: "Customer dashboard", ...(enabled ? { slug: requested } : {}) }, "panel-1");
        assert.equal(prompts.length, 1);
        if (enabled) assert.match(prompts[0], /Requested short name: "sample-feature"/);
        else assert.doesNotMatch(prompts[0], /Requested short name:/);
        assert.doesNotMatch(prompts[0], /Customer dashboard/);
        assert.match(prompts[0], /Before writing workflow artifacts, invoke report_workflow_slug/);
        assert.doesNotMatch(prompts[0], /report_phase_result/);
        await assert.rejects(runtime.reportSlug({ phaseRunId: result.runId,
            slug: "001-sample-feature" }, "panel-1"), /does not exist yet/);
        const directory = join(project, "specs", "001-sample-feature");
        await mkdir(directory, { recursive: true });
        const reported = await runtime.reportSlug({ phaseRunId: result.runId,
            slug: "001-sample-feature" }, "panel-1");
        await assert.rejects(runtime.reportSlug({ phaseRunId: result.runId,
            slug: "002-other-feature" }, "panel-1"), /already reported a different/);
        assert.equal(reported.phases.find((phase) => phase.phase === "specify").outputs[0],
            "specs/001-sample-feature/spec.md");
        assert.equal((await runtime.snapshot()).selected, "specs/001-sample-feature");
        assert.equal((await runtime.snapshot()).items.find((item) => item.id === "specs/001-sample-feature").label,
            "Customer dashboard");
        await writeFile(join(directory, "spec.md"), "# Feature\n");
        await runtime.report({ phaseRunId: result.runId,
            path: "specs/001-sample-feature/spec.md" }, "panel-1");
        const snapshot = await runtime.snapshot();
        assert.equal(snapshot.selected, "specs/001-sample-feature");
        assert.equal(snapshot.statuses.specify.output, "specs/001-sample-feature/spec.md");
        const reopened = await createRuntime({
            config, cwd: project, workspace, session: {
                sessionId: "reopened-test", on: () => () => {},
                getEvents: async () => [], log: async () => {},
            },
        });
        child.after(() => reopened.close());
        assert.equal((await reopened.snapshot()).items.find((item) => item.id === snapshot.selected).label,
            "Customer dashboard");
        const pending = await runtime.createPending({ revision: (await runtime.snapshot()).revision });
        const draft = await runtime.snapshot();
        assert.equal(draft.items.find((item) => item.id === pending.id).slug, "");
        assert.equal(draft.statuses.specify.output, null);
        const withoutSlug = await runtime.run({ phase: "specify", itemId: pending.id,
            args: "Another feature" }, "panel-1");
        assert.ok(withoutSlug.runId);
        assert.doesNotMatch(prompts.at(-1), /Requested short name:/);
        });
    }
});

test("unstarted workflow rows persist, retain drafts and only create a folder on Specify", async (t) => {
    const { project, workspace, prepared } = await fixture(t, handoff,
        { ...values, "workflowSlug.userProvided": true });
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, ".github", "extensions", "my-workflow",
        "canvas-config.json"), "utf8"));
    const skill = join(project, ".github", "skills", "speckit-specify");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: speckit-specify\n---\n");
    await mkdir(join(project, ".specify", "memory"), { recursive: true });
    await writeFile(join(project, ".specify", "memory", "constitution.md"), "# Principles\n");
    const session = { sessionId: "pending-test", on: () => () => {},
        rpc: { skills: { reload: async () => ({ errors: [] }) } },
        send: async () => "pending-message", getEvents: async () => [], log: async () => {} };
    const runtime = await createRuntime({ config, cwd: project, workspace, session });
    t.after(() => runtime.close());
    assert.deepEqual((await runtime.snapshot()).items, []);
    await runtime.save({ revision: 0, name: "Draft without a row", slug: "draft",
        draft: { item: "__new__", phase: "specify", value: "Draft" } });
    assert.deepEqual((await runtime.snapshot()).items, []);
    const first = await runtime.createPending({ revision: (await runtime.snapshot()).revision });
    assert.equal(first.id, "__new__:1");
    let snapshot = await runtime.snapshot();
    assert.deepEqual(snapshot.items.map(({ label, slug, pending }) => ({ label, slug, pending })),
        [{ label: "Workflow 1", slug: "", pending: true }]);
    const { validateWorkflowPageState } = await import(
        "../extension-canvas-design/generated-scaffold/contracts/external-host-adapter.mjs");
    assert.equal(validateWorkflowPageState({ model: snapshot,
        phaseState: { slugEditable: snapshot.userProvidesSlug } }).model, snapshot);
    assert.equal(snapshot.statuses.specify.output, null);
    await assert.rejects(readdir(join(project, "specs")), { code: "ENOENT" });
    await runtime.save({ revision: snapshot.revision, name: "Customer dashboard", slug: "customer-dashboard",
        draft: { item: first.id, phase: "specify", value: "Dashboard scope" } });
    snapshot = await runtime.snapshot();
    const second = await runtime.createPending({ revision: snapshot.revision });
    assert.equal(second.id, "__new__:2");
    const reopened = await createRuntime({ config, cwd: project, workspace, session });
    t.after(() => reopened.close());
    snapshot = await reopened.snapshot();
    assert.deepEqual(snapshot.items.map((item) => item.label), ["Workflow 2", "Customer dashboard"]);
    assert.equal(snapshot.selected, second.id);
    await reopened.removePending({ itemId: second.id, revision: snapshot.revision });
    snapshot = await reopened.snapshot();
    assert.equal(snapshot.selected, first.id);
    assert.equal(snapshot.drafts[JSON.stringify([first.id, "specify"])], "Dashboard scope");
    await mkdir(join(project, "specs", "000-existing"), { recursive: true });
    snapshot = await reopened.snapshot();
    assert.deepEqual(snapshot.items.map((item) => item.id), [first.id, "specs/000-existing"]);
    const result = await reopened.run({ phase: "specify", itemId: first.id, args: "Dashboard scope" }, "pending-panel");
    await assert.rejects(reopened.removePending({ itemId: first.id, revision: (await reopened.snapshot()).revision }),
        /Confirm Discard pending row/);
    await assert.rejects(reopened.removePending({ itemId: first.id,
        revision: (await reopened.snapshot()).revision, confirmation: "discard" }),
        /The agent turn has not ended/);
    const directory = join(project, "specs", "001-customer-dashboard");
    await mkdir(directory, { recursive: true });
    await reopened.reportSlug({ phaseRunId: result.runId, slug: "001-customer-dashboard" }, "pending-panel");
    snapshot = await reopened.snapshot();
    assert.equal(snapshot.selected, "specs/001-customer-dashboard");
    assert.deepEqual(snapshot.items.map((item) => item.id),
        ["specs/001-customer-dashboard", "specs/000-existing"]);
    assert.equal(snapshot.drafts[JSON.stringify([snapshot.selected, "specify"])], "Dashboard scope");
});

test("a missing project constitution can be created before workflow runs", async (t) => {
    const { project, workspace, prepared } = await fixture(t);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, ".github", "extensions",
        "my-workflow", "canvas-config.json"), "utf8"));
    const skill = join(project, ".github", "skills", "speckit-constitution");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: speckit-constitution\n---\n");
    const prompts = [];
    const runtime = await createRuntime({ config, cwd: project, workspace,
        session: { sessionId: "constitution-test", on: () => () => {},
            rpc: { skills: { reload: async () => ({ errors: [] }) } },
            send: async ({ prompt }) => { prompts.push(prompt); return "message-constitution"; },
            getEvents: async () => [], log: async () => {} } });
    t.after(() => runtime.close());
    assert.equal((await runtime.snapshot()).constitutionReady, false);
    await assert.rejects(runtime.run({ phase: "constitution", args: "" }, "panel-project"),
        /Enter project principles/);
    assert.equal(prompts.length, 0);
    await runtime.run({ phase: "constitution", args: "Use concise project principles" }, "panel-project");
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Project-scoped Constitution/);
    assert.equal((await runtime.snapshot()).constitutionReady, false);
});

test("local development selections remain bound to the frozen handoff at publication", async (t) => {
    const local = { ...handoff, localSelections: { extensions: [{
        id: "extension-canvas-design", source: "local", approved: true,
        path: join(tmpdir(), "canvas-design-dev"),
    }] } };
    local.sourceFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: local.workflow, selections: local.selections,
        localSelections: local.localSelections,
    })).digest("hex");
    const { project, workspace, prepared } = await fixture(t, local);
    await materialize(project, workspace, local.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, ".github", "extensions",
        "my-workflow", "canvas-config.json"), "utf8"));
    assert.deepEqual(config.installed.presets, [{ id: "copilot-sub-agents", version: "1.0.0", priority: 1 }]);

    const hosted = { ...handoff, canvasDesign: {
        version: "0.1.18", downloadUrl: "https://example.org/extension-canvas-design.zip",
    } };
    hosted.sourceFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: hosted.workflow, selections: hosted.selections,
        canvasDesign: hosted.canvasDesign,
    })).digest("hex");
    const another = await fixture(t, hosted);
    const result = await materialize(another.project, another.workspace,
        hosted.handoffId, another.prepared.requestId);
    assert.deepEqual(result.warnings, []);

    const drifted = await fixture(t, hosted);
    const path = join(drifted.workspace, "speckit-canvas-designer", "handoffs",
        hosted.handoffId, "handoff.json");
    await writeFile(path, JSON.stringify({ ...hosted,
        selections: { ...hosted.selections, presets: [{ id: "changed" }] } }));
    const warned = await materialize(drifted.project, drifted.workspace,
        hosted.handoffId, drifted.prepared.requestId);
    assert.match(warned.warnings[0], /fingerprint differs/);
    assert.equal(warned.canvasId, "my-workflow");
});

test("generated config excludes session-only installed package locators", async (t) => {
    const withLocators = { ...handoff, workflow: { ...handoff.workflow, installed: {
        presets: [{ id: "copilot-sub-agents", version: "1.0.0", priority: 1,
            path: join(tmpdir(), "private-preset"), source: "local",
            downloadUrl: "https://example.com/preset.zip" }],
        extensions: [{ id: "runtime-extension", version: "2.0.0", priority: 2,
            path: join(tmpdir(), "private-extension"), downloadUrl: "https://example.com/extension.zip" }],
        bundles: [{ id: "runtime-bundle", version: "3.0.0", source: "community",
            downloadUrl: "https://example.com/bundle.zip", catalogId: "community-bundle" }],
    } } };
    withLocators.sourceFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: withLocators.workflow, selections: withLocators.selections,
    })).digest("hex");
    const { project, workspace, prepared, sdk } = await fixture(t, withLocators);
    const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer", "handoffs",
        withLocators.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.deepEqual(request.installed, withLocators.workflow.installed);
    await materialize(project, workspace, withLocators.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.installed, {
        presets: [{ id: "copilot-sub-agents", version: "1.0.0", priority: 1 }],
        extensions: [{ id: "runtime-extension", version: "2.0.0", priority: 2 }],
        bundles: [{ id: "runtime-bundle", version: "3.0.0" }],
    });
});

test("existing canvases are preserved and tampered requests fail before creation", async (t) => {
    const one = await fixture(t);
    await mkdir(one.sdk, { recursive: true });
    await writeFile(join(one.sdk, "extension.mjs"), "await joinSession({})");
    await assert.rejects(materialize(one.project, one.workspace, handoff.handoffId, one.prepared.requestId),
        /Canvas extension already exists/);
    assert.equal(await readFile(join(one.sdk, "extension.mjs"), "utf8"), "await joinSession({})");
    assert.deepEqual(await readdir(one.sdk), ["extension.mjs"]);
    const two = await fixture(t);
    const path = join(two.workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", two.prepared.requestId, "request.json");
    const request = JSON.parse(await readFile(path, "utf8"));
    request.values["canvas.displayName"] = "Tampered";
    await writeFile(path, JSON.stringify(request));
    await assert.rejects(materialize(two.project, two.workspace, handoff.handoffId, two.prepared.requestId),
        /integrity mismatch/);
});

async function withRenameIntercept(intercept, action) {
    const original = fs.promises.rename;
    fs.promises.rename = (source, destination) => intercept(source, destination, original);
    syncBuiltinESMExports();
    try { return await action(); }
    finally {
        fs.promises.rename = original;
        syncBuiltinESMExports();
    }
}

test("first-time Windows publication retries a transient rename denial", {
    skip: process.platform !== "win32",
}, async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    let attempts = 0;
    await withRenameIntercept(async (source, destination, original) => {
        if (destination === sdk) {
            attempts++;
            if (attempts === 1) throw Object.assign(new Error("temporarily locked"), { code: "EPERM" });
        }
        return original(source, destination);
    }, () => materialize(project, workspace, handoff.handoffId, prepared.requestId));
    assert.equal(attempts, 2);
    assert.equal(JSON.parse(await readFile(join(sdk, "canvas-config.json"), "utf8")).canvas.id,
        values["canvas.id"]);
});

test("Windows publication surfaces persistent denial without creating output", {
    skip: process.platform !== "win32",
}, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "canvas-publish-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = join(root, "stage");
    const destination = join(root, "canvas");
    await mkdir(source);
    let attempts = 0;
    await withRenameIntercept(async (from, to, original) => {
        if (from === source && to === destination) {
            attempts++;
            throw Object.assign(new Error("locked"), { code: "EPERM" });
        }
        return original(from, to);
    }, () => assert.rejects(renameDirectoryWithoutReplacement(source, destination),
        { code: "EPERM" }));
    assert.equal(attempts, 6);
    await assert.rejects(readdir(destination), { code: "ENOENT" });
    assert.deepEqual(await readdir(source), []);
});

test("Windows publication will not retry over a newly created destination", {
    skip: process.platform !== "win32",
}, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "canvas-publish-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = join(root, "stage");
    const destination = join(root, "canvas");
    await mkdir(source);
    let attempts = 0;
    await withRenameIntercept(async (from, to, original) => {
        if (from === source && to === destination) {
            attempts++;
            await mkdir(destination);
            await writeFile(join(destination, "owner.txt"), "another process");
            throw Object.assign(new Error("occupied"), { code: "EPERM" });
        }
        return original(from, to);
    }, () => assert.rejects(renameDirectoryWithoutReplacement(source, destination),
        /Canvas destination changed before publication/));
    assert.equal(attempts, 1);
    assert.equal(await readFile(join(destination, "owner.txt"), "utf8"), "another process");
    assert.deepEqual(await readdir(source), []);
});

test("generator rejects inconsistent all-page values and stock defaults before writing", async (t) => {
    const { project, workspace, prepared, sdk } = await fixture(t);
    const path = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", prepared.requestId, "request.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    const failures = [
        (request) => { request.values["other.page"] = "unexpected"; },
        (request) => { delete request.values["canvas.displayName"]; },
        (request) => { request.values["workflowSlug.userProvided"] = "true"; },
        (request) => { request.values["canvas.description"] = "x".repeat(241); },
        (request) => { request.canvas.description = "not the frozen value"; },
        (request) => { request.fieldConstraints["canvas.description"].type = "object"; },
        (request) => { request.fieldConstraints["canvas.id"].pattern = "^(a+)+$"; },
        (request) => { delete request.fieldConstraints["canvas.id"].pattern; },
        (request) => { request.fieldConstraints["canvas.description"].pattern = "^(a+)+$"; },
    ];
    for (const change of failures) {
        const request = structuredClone(original);
        change(request);
        const { integrity: _old, ...payload } = request;
        request.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        await writeFile(path, JSON.stringify(request));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            /Invalid frozen Designer field|Invalid frozen Designer fields|Invalid frozen canvas identity/);
        await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    }
});

test("generation request and Wizard handoff reject symlinks and oversized files", async (t) => {
    for (const [name, limit] of [["request.json", 4 * 1024 * 1024], ["handoff.json", 64 * 1024]]) {
        await t.test(name, async (child) => {
            const { project, workspace, prepared, sdk } = await fixture(child);
            const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
            const path = name === "request.json"
                ? join(folder, "generations", prepared.requestId, name) : join(folder, name);
            const saved = `${path}.saved`;
            await rename(path, saved);
            let linked = false;
            try {
                await symlink(saved, path, "file");
                linked = true;
            } catch (error) {
                if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
                child.diagnostic(`File symlink unavailable: ${error.code}`);
            }
            if (linked) {
                await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
                    /bounded regular session file|ELOOP|EINVAL/);
                await rm(path);
            }
            await writeFile(path, Buffer.alloc(limit + 1, 32));
            await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
                /too large/);
            await assert.rejects(readdir(sdk), { code: "ENOENT" });
        });
    }
});

test("pinned generation reads reject leaf and parent swaps during open", async (t) => {
    for (const [name, limit, label] of [
        ["request.json", 4 * 1024 * 1024, "Generation request"],
        ["handoff.json", 64 * 1024, "Wizard handoff"],
    ]) {
        for (const swap of ["leaf", "parent"]) {
            await t.test(`${name} ${swap}`, async (child) => {
                const { workspace, prepared } = await fixture(child);
                const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
                const parent = name === "request.json"
                    ? join(folder, "generations", prepared.requestId) : folder;
                const path = join(parent, name);
                await assert.rejects(readBoundedSessionFile(parent, name, limit, label, async (filePath, flags) => {
                    if (swap === "parent") {
                        await rename(parent, `${parent}.old`);
                        await mkdir(parent);
                        await writeFile(path, "replacement");
                    }
                    const file = await open(filePath, flags);
                    if (swap === "leaf") {
                        await rename(path, `${path}.old`);
                        await writeFile(path, "replacement");
                    }
                    return file;
                }), /bounded regular session file/);
            });
        }
    }
});
