import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, copyFile, cp, mkdtemp, mkdir, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import {
    fingerprint, handoffDirectory, HANDOFF_LIMIT, readHandoff, validateHandoff,
    validateHandoffId,
} from "../handoff.mjs";
import { readBootstrapRecord, writeBootstrapRecord } from "../bootstrap-artifacts.mjs";
import { shellHtml, startShell } from "../server.mjs";
import { previewModel } from "../preview.mjs";
import { assertPageCommand, loadResolvedDesignerPages as loadPages, readFrozenAsset } from "../pages.mjs";
import {
    freshDesignerSettings, initialOutputs, loadDesignerSettings, SAVE_REQUEST_LIMIT, saveDesignerSettings,
    SETTINGS_LIMIT, validateValues,
} from "../settings.mjs";
import { freezeGeneration, generationBlockers, validateEssentials } from "../generation.mjs";
import { generationAvailability, GENERATION_EXISTS, GENERATION_PENDING } from "../contracts/generation-request.mjs";
import { decodeImage } from "../image.mjs";
import { specifySpawnOptions } from "../../speckit-wizard-canvas/env/specify-invocation.mjs";
import { renderStockPage } from "../../../../../spec-kit-extensions/extension-canvas-design/generated-host/workflow-page/generated-workflow-page-adapter.mjs";

const ID = "designer_1";
const scalarFixtures = new Map();
async function installOpenSkill(project) {
    const path = join(project, ".github", "skills",
        "speckit-extension-canvas-design-open-generated", "SKILL.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "---\nname: speckit-extension-canvas-design-open-generated\n---\n");
}
async function waitFor(check) {
    const deadline = Date.now() + 2000;
    while (!check()) {
        if (Date.now() > deadline) assert.fail("Timed out waiting for child dispatch");
        await delay(10);
    }
}
test("generation availability contract rejects incompatible flags and prioritizes queued work", () => {
    assert.deepEqual(generationAvailability(false, false), { available: true, error: null });
    assert.deepEqual(generationAvailability(true, false), { available: false, error: GENERATION_PENDING });
    assert.deepEqual(generationAvailability(false, true), { available: false, error: GENERATION_EXISTS });
    assert.deepEqual(generationAvailability(true, true), { available: false, error: GENERATION_PENDING });
    assert.throws(() => generationAvailability(null, false), /Invalid Designer generation availability/);
});
function stockMarkup(config) {
    const root = { innerHTML: "" };
    renderStockPage(root, { canvas: config.canvas, mainPageAsset: config.mainPageAsset,
        readOnlyFields: config.readOnlyFields ?? [], textPlacements: config.textPlacements ?? [],
        hasValues: Boolean(config.valueSources?.length), generatedControls: config.generatedControls ?? [],
        hasConstitution: config.phases.some((phase) => phase.replace(/^speckit\./, "") === "constitution"),
        hasBadges: Boolean(config.badges?.instances?.length),
        badgeDestinations: config.workflowPage.badgeDestinations,
        fieldSlots: config.workflowPage.slots.filter(({ id }) => id !== "workflow.phases"
            && (config.fieldPlacements?.some((item) => item.page === "workflow" && item.slot === id)
                || config.buttons?.some((item) => item.page === "workflow" && item.slot === id)))
            .map(({ id }) => id) });
    return root.innerHTML;
}

async function loadResolvedDesignerPages(handoff, project, entries, templates = [], registration) {
    const scalar = scalarFixtures.get(project) ?? [];
    const present = new Set(templates.map((entry) => entry.name));
    const complete = [...templates, ...scalar.filter((entry) => !present.has(entry.name))];
    return loadFixturePages(handoff, project, entries, complete, registration);
}

async function loadFixturePages(handoff, project, entries, complete, registration) {
    const inventory = new Map();
    const scalar = scalarFixtures.get(project) ?? [];
    for (const entry of [...entries, ...complete]) {
        if (inventory.has(`template:${entry.name}`)) continue;
        const stock = scalar.some((item) => item.name === entry.name);
        const sourceId = entry.sourceId ?? "extension:extension-canvas-design";
        const layer = sourceId === "project" ? "project"
            : sourceId.startsWith("extension:") ? "extension" : "preset";
        const fallback = { kind: "template", stack: [{ active: true,
            sourceId: layer === "project" ? "_" : sourceId.replace(/^extension:/, ""),
            layer, strategy: "replace" }] };
        const info = stock || entry.kind === "designer.setting-definition"
            || entry.kind === "designer.tab-definition"
            ? fallback : registration?.(project, entry.name) ?? fallback;
        inventory.set(`template:${entry.name}`, { ...info, id: `template:${entry.name}`,
            name: entry.name, stack: info.stack?.map((item) => ({
                ...item, sourcePath: item.sourcePath ?? entry.path })) });
    }
    return loadPages(handoff, project, entries, complete, async () => inventory);
}

test("Designer packages the same control validator as the generated app", async () => {
    assert.deepEqual(await readFile(new URL("../external-control-contract.mjs", import.meta.url)),
        await readFile(new URL(
            "../../../../../spec-kit-extensions/extension-canvas-design/generated-scaffold/external-control-contract.mjs",
            import.meta.url)));
});

test("open boundary reads one fresh inventory and rejects changed winners and script collisions", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const templates = scalarFixtures.get(project);
    const inventory = new Map([...entries, ...templates].map((entry) => {
        const sourcePath = entry.path;
        return [`template:${entry.name}`, {
            id: `template:${entry.name}`, kind: "template", name: entry.name,
            stack: [{ active: true, layer: "extension", sourceId: "extension-canvas-design",
                strategy: "replace", sourcePath }],
        }];
    }));
    let calls = 0;
    const reader = async () => { calls++; return inventory; };
    await loadPages(validHandoff(), project, entries, templates, reader);
    assert.equal(calls, 1);
    const original = inventory.get("template:designer-essentials").stack[0].sourcePath;
    inventory.get("template:designer-essentials").stack[0].sourcePath = entries[1].path;
    await assert.rejects(loadPages(validHandoff(), project, entries, templates, reader),
        /submitted path does not match/);
    assert.equal(calls, 2);
    inventory.get("template:designer-essentials").stack[0].sourcePath = original;
    inventory.set("script:generated-phase-adapter", { id: "script:generated-phase-adapter",
        kind: "script", name: "generated-phase-adapter", stack: [] });
    await assert.rejects(loadPages(validHandoff(), project, entries, templates, reader),
        /native Specify script/);
    assert.equal(calls, 3);
    inventory.delete("script:generated-phase-adapter");
    const layer = inventory.get("template:generated-phase-adapter").stack[0];
    inventory.get("template:generated-phase-adapter").stack.push({
        ...layer, active: false, strategy: "wrap" });
    await assert.rejects(loadPages(validHandoff(), project, entries, templates, reader),
        /replace-only Specify template/);
    inventory.get("template:generated-phase-adapter").stack.pop();
    inventory.get("template:generated-phase-adapter").stack.push({
        ...layer, active: true });
    await assert.rejects(loadPages(validHandoff(), project, entries, templates, reader),
        /replace-only Specify template/);
    inventory.get("template:generated-phase-adapter").stack.pop();
    const pageLayer = inventory.get("template:designer-essentials").stack[0];
    pageLayer.layer = "unknown";
    await assert.rejects(loadPages(validHandoff(), project, entries, templates, reader),
        /designer-essentials: invalid active Specify template layer/);
    pageLayer.layer = "extension";
    pageLayer.sourceId = 42;
    await assert.rejects(loadPages(validHandoff(), project, entries, templates, reader),
        /designer-essentials: invalid active Specify template layer/);
    pageLayer.sourceId = "extension-canvas-design";
    pageLayer.layer = "project";
    await assert.rejects(loadPages(validHandoff(), project, entries, templates, reader),
        /designer-essentials: invalid active Specify template layer/);
});

test("Outputs persist with Designer settings and reject unsafe or stale edits", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.selectedPhases.unshift("constitution");
    handoff.workflow.outputEvidence = {
        constitution: { outputs: [], view: null },
        specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
        plan: { outputs: [], view: null },
    };
    handoff.workflow.phaseDescriptions = { specify: "Describe what to build and why." };
    handoff.sourceFingerprint = fingerprint({
        workflow: handoff.workflow, selections: handoff.selections,
    });
    const incompatibleHandoff = structuredClone(handoff);
    incompatibleHandoff.workflow.outputEvidence.plan = {
        outputs: ["specs/<slug>/notes.md"], view: null,
    };
    incompatibleHandoff.sourceFingerprint = fingerprint({
        workflow: incompatibleHandoff.workflow, selections: incompatibleHandoff.selections,
    });
    assert.throws(() => validateHandoff(incompatibleHandoff, incompatibleHandoff.handoffId),
        /Invalid outputs for phase plan/);
    await saveHandoff(workspace, handoff);
    const model = { revision: "outputs-test", constraints: {}, values: {},
        badgeTypes: [{ id: "artifact", rule: "artifact", enabled: true }],
        badgeRules: [{ id: "artifact", inputs: [{ id: "artifact", type: "artifact" }],
            textPlaceholders: [] }] };
    const initial = await loadDesignerSettings(workspace, handoff, model);
    assert.deepEqual(initial.badges, []);
    const constitution = { outputs: [".specify/memory/constitution.md"],
        view: ".specify/memory/constitution.md" };
    assert.deepEqual(initial.outputs, { ...handoff.workflow.outputEvidence, constitution });
    const outputs = { constitution, specify: { outputs: [
        "specs/<slug>/spec.md", "specs/<slug>/research.md"],
        view: "specs/<slug>/research.md" }, plan: { outputs: [], view: null } };
    const badges = [{ id: "research", type: "artifact", category: "Readiness",
        inputs: { artifact: { phase: "specify", output: "specs/<slug>/research.md" } },
        text: "Research ready", color: "green", showIn: ["workflow-list"], phase: null }];
    const saved = await saveDesignerSettings(workspace, handoff, initial,
        { modelRevision: model.revision, revision: 0, values: {}, outputs, badges });
    assert.deepEqual(saved.outputs, outputs);
    assert.deepEqual(saved.badges, badges);
    assert.deepEqual((await loadDesignerSettings(workspace, handoff, model)).outputs, outputs);
    assert.deepEqual((await loadDesignerSettings(workspace, handoff, model)).badges, badges);
    const watched = { ...outputs, plan: { outputs: ["specs/<slug>/notes.md"], view: null } };
    const withWatchedFile = await saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 1, values: {}, outputs: watched, badges,
    });
    assert.deepEqual((await loadDesignerSettings(workspace, handoff, model)).outputs, watched);
    assert.deepEqual(withWatchedFile.outputs.plan, watched.plan);
    await assert.rejects(saveDesignerSettings(workspace, handoff, withWatchedFile, {
        modelRevision: model.revision, revision: 2, values: {},
        outputs: { ...outputs, specify: { ...outputs.specify, view: null } },
    }), /Pipeline viewer defaults cannot be removed/);
    await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 2, values: {},
        outputs: { ...outputs, specify: { outputs: ["specs/<slug>/spec.md"],
            view: "specs/<slug>/spec.md" } }, badges,
    }), /invalid artifact input/);
    await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 2, values: {},
        outputs: { ...outputs, specify: { outputs: ["specs/<slug>/research.md"],
            view: "specs/<slug>/research.md" } },
    }), /Pipeline artifacts cannot be changed/);
    await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 2, values: {},
        outputs: { ...outputs, specify: { outputs: [
            "specs/<slug>/SPEC.md", "specs/<slug>/research.md"],
        view: "specs/<slug>/research.md" } },
    }), /Pipeline artifacts cannot be changed/);
    const removed = { ...outputs, specify: { outputs: ["specs/<slug>/spec.md"],
        view: "specs/<slug>/spec.md" } };
    const restored = await saveDesignerSettings(workspace, handoff, withWatchedFile,
        { modelRevision: model.revision, revision: 2, values: {}, outputs: removed, badges: [] });
    assert.deepEqual(restored.outputs, removed);
    assert.deepEqual((await loadDesignerSettings(workspace, handoff, model)).outputs, removed);
    await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 3, values: {},
        outputs: { ...outputs, constitution: { outputs: [], view: null } },
    }), /Constitution output is fixed/);
    await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 3, values: {},
        outputs: { ...outputs, plan: { outputs: ["../outside.md"], view: "../outside.md" } },
    }), /Invalid outputs for phase plan/);
    for (const path of [".GitHub/private.md", ".SPECIFY/templates/private.md"]) {
        await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
            modelRevision: model.revision, revision: 3, values: {},
            outputs: { ...outputs, plan: { outputs: [path], view: path } },
        }), /Invalid outputs for phase plan/);
    }
    await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 3, values: {},
        outputs: { ...outputs, plan: { outputs: Array.from({ length: 101 },
            (_, index) => `specs/<slug>/output-${index}.md`),
        view: "specs/<slug>/output-0.md" } },
    }), /Invalid outputs for phase plan/);
    await assert.rejects(saveDesignerSettings(workspace, handoff, saved, {
        modelRevision: model.revision, revision: 0, values: {}, outputs,
    }), /changed elsewhere/);
});

test("Older saved output edits restore inferred artifacts without losing additions", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.outputEvidence = {
        specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
        plan: { outputs: [], view: null },
    };
    handoff.sourceFingerprint = fingerprint({
        workflow: handoff.workflow, selections: handoff.selections,
    });
    const directory = await saveHandoff(workspace, handoff);
    const base = { revision: "legacy-outputs", constraints: {}, values: {} };
    await writeFile(join(directory, "settings.json"), JSON.stringify({
        schemaVersion: 1, handoffId: handoff.handoffId, modelRevision: base.revision,
        revision: 1, values: {}, outputs: {
            specify: { outputs: ["specs/<slug>/design-notes.md"],
                view: "specs/<slug>/design-notes.md" },
            plan: { outputs: [], view: null },
        },
    }));
    const loaded = await loadDesignerSettings(workspace, handoff, base);
    assert.deepEqual(loaded.outputs.specify, {
        outputs: ["specs/<slug>/spec.md", "specs/<slug>/design-notes.md"],
        view: "specs/<slug>/design-notes.md",
    });
    assert.equal(loaded.settingsRevision, 1);
});

test("Generation freezes the pipeline links and chosen additional viewer target", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.workflow.outputEvidence = {
        specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
        plan: { outputs: [], view: null },
    };
    handoff.sourceFingerprint = fingerprint({
        workflow: handoff.workflow, selections: handoff.selections,
    });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const pages = await loadResolvedDesignerPages(handoff, project, entries, await stockTemplates(project));
    const model = await loadDesignerSettings(workspace, handoff, pages);
    const values = { ...model.values, "canvas.id": "links-canvas",
        "canvas.displayName": "Links Canvas" };
    const outputs = { ...model.outputs, specify: {
        outputs: ["specs/<slug>/spec.md", "specs/<slug>/design-notes.md"],
        view: "specs/<slug>/design-notes.md",
    } };
    await assert.rejects(freezeGeneration({ model, values, outputs: {
        ...outputs, specify: { outputs: ["specs/<slug>/design-notes.md"],
            view: "specs/<slug>/design-notes.md" },
    }, handoff, project, workspace }), /Pipeline artifacts cannot be changed/);
    const prepared = await freezeGeneration({ model, values, outputs, handoff, project, workspace });
    const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.deepEqual(request.workflow.phaseArtifacts, outputs);
    assert.deepEqual(request.workflow.phaseDescriptions, handoff.workflow.phaseDescriptions);
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, prepared.target, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.phaseArtifacts.specify, outputs.specify);
    assert.deepEqual(config.phaseDescriptions, handoff.workflow.phaseDescriptions);
});

function validHandoff(id = ID) {
    const workflow = { selectedPhases: ["specify", "plan"] };
    const selections = {
        presets: [{ id: "theme", source: "copilot", approved: true,
            version: "1.2.3", downloadUrl: "https://example.com/theme" }],
        extensions: [],
        bundles: [{ id: "starter", source: "default", approved: true,
            version: null, downloadUrl: null }],
    };
    return { schemaVersion: 1, handoffId: id, workflow, selections,
        sourceFingerprint: fingerprint({ workflow, selections }) };
}

async function fixture(t) {
    const workspace = await mkdtemp(join(tmpdir(), "speckit-designer-test-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    return workspace;
}

async function saveHandoff(workspace, handoff = validHandoff()) {
    const directory = handoffDirectory(workspace, handoff.handoffId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "handoff.json"), JSON.stringify(handoff));
    return directory;
}

async function projectFixture(t, workspace) {
    const project = join(workspace, "project");
    const specify = join(project, ".specify");
    const installed = join(specify, "extensions", "extension-canvas-design");
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url));
    await mkdir(join(installed, "designer-host", "tabs"), { recursive: true });
    await mkdir(join(installed, "schemas"), { recursive: true });
    await mkdir(join(project, ".github", "skills", "speckit-extension-canvas-design-load-page"),
        { recursive: true });
    await writeFile(join(project, ".github", "skills", "speckit-extension-canvas-design-load-page", "SKILL.md"), "test");
    await writeFile(join(specify, "extensions", ".registry"),
        JSON.stringify({ extensions: { "extension-canvas-design": { enabled: true } } }));
    await copyFile(join(source, "schemas", "external-designer.tab-definition.schema.json"),
        join(installed, "schemas", "external-designer.tab-definition.schema.json"));
    await copyFile(join(source, "extension.yml"), join(installed, "extension.yml"));
    const pages = ["essentials", "badges", "appearance"];
    const entries = [];
    for (const filename of pages) {
        const path = join(installed, "designer-host", "tabs", `${filename}.json`);
        await copyFile(join(source, "designer-host", "tabs", `${filename}.json`), path);
        entries.push({ name: `designer-${filename}`, path,
            kind: "designer.tab-definition", strategy: "replace" });
    }
    const scalar = [];
    for (const [name, directory, filename, kind] of [
        ["generated-workflow", "workflow-page", "workflow.json", "generated.workflow-page-definition"],
        ["generated-workflow-page-adapter", "workflow-page",
            "generated-workflow-page-adapter.mjs", "generated.workflow-page-adapter"],
        ["generated-phase-control", "phase-control", "phase-control.json", "generated.phase-control-definition"],
        ["generated-phase-adapter", "phase-control", "generated-phase-adapter.mjs", "generated.phase-control-adapter"],
    ]) {
        const path = join(installed, "generated-host", directory, filename);
        await mkdir(dirname(path), { recursive: true });
        await copyFile(join(source, "generated-host", directory, filename), path);
        scalar.push({ name, path, sourceId: "extension:extension-canvas-design",
            kind, strategy: "replace" });
    }
    for (const [directory, names] of [
        ["stock-text", [["shared-controls-text", "control.json", "shared.control-definition"],
            ["designer-control-adapter-text", "designer.mjs", "designer.control-adapter"],
            ["generated-control-adapter-text", "generated.mjs", "generated.control-adapter"]]],
        ["stock-checkbox", [["shared-controls-checkbox", "control.json", "shared.control-definition"],
            ["designer-control-adapter-checkbox", "designer.mjs", "designer.control-adapter"]]],
    ]) {
        await mkdir(join(installed, "shared-controls", directory), { recursive: true });
        for (const [name, filename, kind] of names) {
            const path = join(installed, "shared-controls", directory, filename);
            await copyFile(join(source, "shared-controls", directory, filename), path);
            scalar.push({ name, path, sourceId: "extension:extension-canvas-design",
                kind, strategy: "replace" });
        }
    }
    scalarFixtures.set(project, scalar);
    t.after(() => scalarFixtures.delete(project));
    t.after(() => rm(project, { recursive: true, force: true }));
    return { project, entries };
}

async function badgeTemplates(project) {
    const source = fileURLToPath(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url));
    const templates = [];
    const settingsPath = join(project, ".specify", "extensions", "extension-canvas-design",
        "designer-host", "badges-settings", "badge-types.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    await copyFile(join(source, "designer-host", "badges-settings", "badge-types.json"), settingsPath);
    templates.push({ name: "badges-settings", path: settingsPath,
        sourceId: "extension:extension-canvas-design",
        kind: "designer.badges-settings-definition", strategy: "replace" });
    for (const [folder, prefix, kind] of [
        ["rules", "badge-rule", "generated.badge-rule-definition"],
        ["adapters", "badge-rule", "generated.badge-rule-adapter"],
    ]) {
        const directory = join(source, "generated-host", "badges", folder);
        for (const filename of await readdir(directory)) {
            const stem = filename.replace(/\.(?:json|mjs)$/, "");
            const name = `${prefix}-${stem}${folder === "adapters" ? "-adapter" : ""}`;
            const path = join(project, ".specify", "extensions", "extension-canvas-design",
                "generated-host", "badges", folder, filename);
            await mkdir(dirname(path), { recursive: true });
            await copyFile(join(directory, filename), path);
            templates.push({ name, path, sourceId: "extension:extension-canvas-design",
                kind, strategy: "replace" });
        }
    }
    for (const [name, relative, kind] of [
        ["designer-badge-input-stock", "control.json", "designer.badge-input-control"],
        ["designer-badge-input-stock-adapter", "designer.mjs", "designer.badge-input-adapter"],
        ["designer-badge-input-checklist", join("..", "checklist", "control.json"),
            "designer.badge-input-control"],
        ["designer-badge-input-checklist-adapter", join("..", "checklist", "designer.mjs"),
            "designer.badge-input-adapter"],
        ["designer-badge-input-phase-artifact", join("..", "phase-artifact", "control.json"),
            "designer.badge-input-control"],
        ["designer-badge-input-phase-artifact-adapter", join("..", "phase-artifact", "designer.mjs"),
            "designer.badge-input-adapter"],
        ["designer-badge-input-ordered-stale", join("..", "ordered-stale", "control.json"),
            "designer.badge-input-control"],
        ["designer-badge-input-ordered-stale-adapter", join("..", "ordered-stale", "designer.mjs"),
            "designer.badge-input-adapter"],
        ["designer-badge-input-value-match", join("..", "value-match", "control.json"),
            "designer.badge-input-control"],
        ["designer-badge-input-value-match-adapter", join("..", "value-match", "designer.mjs"),
            "designer.badge-input-adapter"],
        ...["value-match", "artifact-current", "artifact-stale", "markdown-file-count",
            "checklist-progress", "checklist-complete",
            "phase-run-complete", "phase-artifact-complete"].map((id) =>
            [`designer-badge-binding-${id}`, join("bindings", `${id}.json`),
                "designer.badge-input-binding"]),
    ]) {
        const folder = join("designer-host", "badge-input-controls", "stock");
        const path = join(project, ".specify", "extensions", "extension-canvas-design", folder, relative);
        await mkdir(dirname(path), { recursive: true });
        await copyFile(join(source, folder, relative), path);
        templates.push({ name, path, sourceId: "extension:extension-canvas-design",
            kind, strategy: "replace" });
    }
    return templates;
}

const badgeRegistration = () => ({ kind: "template", stack: [
    { active: true, sourceId: "extension-canvas-design", layer: "extension",
        strategy: "replace" },
] });

test("registered badge definitions resolve types, rules, adapters, and declared placeholders", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const templates = await badgeTemplates(project);
    const load = (inventory = templates) => loadResolvedDesignerPages(validHandoff(),
        project, entries, inventory, badgeRegistration);
    const model = await load();
    assert.equal(model.badgeTypes.length, 8);
    assert.equal(model.badgeRules.length, 8);
    assert.equal(model.badgeInputControls.length, 8);
    assert.ok(model.badgeInputControls.every((item) => {
        const control = ["checklist-progress", "checklist-complete"].includes(item.rule)
            ? ["stock.checklist-inputs", "designer-badge-input-checklist-adapter"]
            : item.rule === "value-match"
                ? ["stock.value-match-inputs", "designer-badge-input-value-match-adapter"]
            : item.rule === "artifact-stale"
                ? ["stock.ordered-stale-inputs", "designer-badge-input-ordered-stale-adapter"]
                : item.rule === "phase-artifact-complete"
                    ? ["stock.phase-artifact-inputs", "designer-badge-input-phase-artifact-adapter"]
                : ["stock.badge-inputs", "designer-badge-input-stock-adapter"];
        return item.control === control[0] && item.adapter === control[1]
            && (item.capabilities?.includes("declare-markdown-output") === true)
                === (item.rule !== "artifact-stale");
    }));
    assert.ok(model.badgeRules.some((rule) => rule.id === "value-match"
        && rule.inputs[0].type === "artifact" && rule.inputs[1].type === "badge-selection"));
    assert.ok(model.badgeRules.some((rule) => rule.id === "markdown-file-count"
        && rule.inputs[0].scope === "directory"));
    assert.equal(model.badgeTypes.find((item) => item.id === "value-match").title,
        "Value match");
    assert.equal(model.badgeTypes.find((item) => item.id === "checklist-progress").defaultText,
        "Checklist: {completed}/{total} complete");
    assert.equal(model.badgeTypes.find((item) => item.id === "checklist-complete").defaultText,
        "Checklist complete");
    assert.equal(model.badgeTypes.find((item) =>
        item.id === "phase-artifact-complete").replacementGroup, "phase-completion");
    const phaseArtifactAdapter = templates.find((item) =>
        item.name === "designer-badge-input-phase-artifact-adapter");
    await assert.rejects(load(templates.filter((item) => item !== phaseArtifactAdapter)),
        /missing Designer badge input adapter designer-badge-input-phase-artifact-adapter/);
    const rule = templates.find((item) => item.name === "badge-rule-value-match");
    const binding = templates.find((item) => item.name === "designer-badge-binding-value-match");
    await assert.rejects(load(templates.filter((item) => item !== binding)),
        /missing Designer badge input binding for value-match/);
    const typeEntry = templates.find((item) => item.name === "badges-settings");
    const typeBytes = await readFile(typeEntry.path, "utf8");
    const disabledTypes = JSON.parse(typeBytes);
    disabledTypes.types.find((item) => item.id === "value-match").enabled = false;
    await writeFile(typeEntry.path, JSON.stringify(disabledTypes));
    const withoutUnusedBinding = await load(templates.filter((item) => item !== binding
        && !["designer-badge-input-value-match", "designer-badge-input-value-match-adapter"]
            .includes(item.name)));
    assert.equal(withoutUnusedBinding.badgeInputControls.some((item) =>
        item.rule === "value-match"), false);
    assert.equal(withoutUnusedBinding.badgeTypes.find((item) =>
        item.id === "value-match").enabled, false);
    await writeFile(typeEntry.path, typeBytes);
    const invalidGroup = JSON.parse(typeBytes);
    invalidGroup.types.find((item) => item.id === "value-match")
        .replacementGroup = "phase-completion";
    await writeFile(typeEntry.path, JSON.stringify(invalidGroup));
    await assert.rejects(load(), /replacement group requires a target phase artifact/);
    await writeFile(typeEntry.path, typeBytes);
    const control = templates.find((item) => item.name === "designer-badge-input-stock");
    await assert.rejects(load(templates.filter((item) => item !== control)),
        /missing Designer badge input control stock.badge-inputs/);
    const inputAdapter = templates.find((item) =>
        item.name === "designer-badge-input-stock-adapter");
    await assert.rejects(load(templates.filter((item) => item !== inputAdapter)),
        /missing Designer badge input adapter designer-badge-input-stock-adapter/);
    const inputAdapterOriginal = await readFile(inputAdapter.path, "utf8");
    await writeFile(inputAdapter.path, inputAdapterOriginal
        + "\nthrow new Error('must not execute in the Designer Node process');\n");
    await load();
    await writeFile(inputAdapter.path, inputAdapterOriginal.replace(
        'controlId = "stock.badge-inputs"', 'controlId = "wrong.badge-inputs"'));
    await assert.rejects(load(), /incompatible Designer badge input adapter/);
    await writeFile(inputAdapter.path, inputAdapterOriginal.replace(
        'controlId = "stock.badge-inputs"',
        'controlId = ["stock", "badge-inputs"].join(".")'));
    await assert.rejects(load(), /incompatible Designer badge input adapter/);
    await writeFile(inputAdapter.path, inputAdapterOriginal.replace(
        "contractVersion = 1", "contractVersion = 2"));
    await assert.rejects(load(), /incompatible Designer badge input adapter/);
    await writeFile(inputAdapter.path, inputAdapterOriginal.replace(
        "export const declaresMarkdownOutput = true;", ""));
    await assert.rejects(load(), /incompatible Designer badge input adapter/);
    await writeFile(inputAdapter.path, inputAdapterOriginal);
    const controlOriginal = await readFile(control.path, "utf8");
    const withoutCapability = JSON.parse(controlOriginal);
    delete withoutCapability.capabilities;
    await writeFile(control.path, JSON.stringify(withoutCapability));
    await assert.rejects(load(), /incompatible Designer badge input adapter/);
    await writeFile(control.path, controlOriginal);
    const original = await readFile(rule.path, "utf8");
    const { adapter: legacyAdapter, ...withoutAdapter } = JSON.parse(original);
    await writeFile(rule.path, JSON.stringify({ ...withoutAdapter, module: legacyAdapter }));
    await assert.rejects(load(), /invalid badge rule definition/);
    await writeFile(rule.path, JSON.stringify({ ...JSON.parse(original), adapter: "not-registered" }));
    await assert.rejects(load(), /missing registered badge adapter/);
    await writeFile(rule.path, original);
    const type = templates.find((item) => item.name === "badges-settings");
    const typeOriginal = await readFile(type.path, "utf8");
    const settings = JSON.parse(typeOriginal);
    settings.types.find((item) => item.id === "value-match").defaultText =
        "Unknown {not-declared}";
    await writeFile(type.path, JSON.stringify(settings));
    await assert.rejects(load(), /undeclared placeholder/);
    await writeFile(type.path, typeOriginal);
    const handler = templates.find((item) => item.name === "badge-rule-run-adapter");
    await writeFile(handler.path, `import "node:fs";\nexport const contractVersion = 1;\nexport function evaluate() {}`);
    await assert.rejects(load(), /must be self-contained/);
});

test("preset badge definitions add, replace, and disable registered catalog entries", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const inventory = await badgeTemplates(project);
    const folder = join(project, ".specify", "presets", "badge-catalog-test");
    await mkdir(folder, { recursive: true });
    const add = async (name, kind, document, extension = ".json") => {
        const path = join(folder, `${name}${extension}`);
        await writeFile(path, extension === ".json" ? JSON.stringify(document) : document);
        const entry = { name, path, sourceId: "badge-catalog-test", kind, strategy: "replace" };
        inventory.push(entry);
        return entry;
    };
    await add("badge-rule-preset-extra", "generated.badge-rule-adapter",
        "export const contractVersion = 1;\nexport async function evaluate() { return { match: true }; }\n",
        ".mjs");
    const addedRule = await add("badge-rule-preset-extra-definition",
        "generated.badge-rule-definition", {
            schemaVersion: 1, id: "preset-extra", label: "Preset rule",
            description: "Added by a preset.", inputs: [{ id: "phase", type: "phase" }],
            textPlaceholders: ["count"], adapter: "badge-rule-preset-extra",
        });
    await add("designer-badge-preset-control", "designer.badge-input-control",
        { schemaVersion: 1, id: "preset.phase", adapter: "designer-badge-preset-adapter",
            inputTypes: ["phase"] });
    await add("designer-badge-preset-adapter", "designer.badge-input-adapter",
        `export const controlId = "preset.phase";
export const contractVersion = 1;
export function mount({ root, inputs, phases, onChange }) {
    const hint = document.createElement("p");
    hint.textContent = "Choose the phase used by this custom badge.";
    const select = document.createElement("select");
    for (const phase of phases) {
        const option = document.createElement("option");
        option.value = phase;
        option.textContent = phase;
        select.append(option);
    }
    select.value = inputs.phase;
    select.addEventListener("change", () => onChange({ phase: select.value }));
    root.replaceChildren(hint, select);
    return { isReady: () => true };
}`, ".mjs");
    await add("designer-badge-binding-preset-extra", "designer.badge-input-binding",
        { schemaVersion: 1, id: "preset-extra", rule: "preset-extra",
            control: "preset.phase" });
    const settingsEntry = inventory.find((item) => item.name === "badges-settings");
    const settings = JSON.parse(await readFile(settingsEntry.path, "utf8"));
    settings.types.push({ id: "preset-extra", title: "Preset badge",
        description: "Added by a preset.", rule: "preset-extra",
        defaultText: "Preset {count}", defaultColor: "purple", enabled: true });
    const artifact = settings.types.find((item) => item.id === "artifact-current");
    artifact.enabled = false;
    artifact.title = "Replaced by preset";
    artifact.description = "Customized in the single badges settings file.";
    artifact.id = "artifact-renamed";
    const settingsOverride = join(folder, "badges-settings-override.json");
    await writeFile(settingsOverride, JSON.stringify(settings));
    inventory.splice(inventory.indexOf(settingsEntry), 1, {
        ...settingsEntry, path: settingsOverride, sourceId: "badge-catalog-test",
    });
    const source = fileURLToPath(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url));
    const replace = async (name, folderName, filename, patch) => {
        const original = inventory.find((item) => item.name === name);
        const document = JSON.parse(await readFile(join(source, "generated-host", "badges",
            folderName, filename), "utf8"));
        const path = join(folder, `${name}-override.json`);
        await writeFile(path, JSON.stringify({ ...document, ...patch }));
        inventory.splice(inventory.indexOf(original), 1, { ...original, path,
            sourceId: "badge-catalog-test" });
        return path;
    };
    const replacedRule = await replace("badge-rule-checklist-progress", "rules",
        "checklist-progress.json", { adapter: "badge-rule-preset-extra" });
    const load = () => loadResolvedDesignerPages(validHandoff(), project, entries, inventory,
        (_root, name) => {
            const entry = inventory.find((item) => item.name === name);
            const preset = entry?.sourceId === "badge-catalog-test";
            return { kind: "template", stack: [{ active: true,
                sourceId: preset ? "badge-catalog-test" : "extension-canvas-design",
                layer: preset ? "preset" : "extension", strategy: "replace" }] };
        });
    const model = await load();
    assert.equal(model.badgeTypes.length, 9);
    assert.equal(model.badgeRules.length, 9);
    assert.equal(model.badgeTypes.find((item) => item.id === "preset-extra").name, "badges-settings");
    assert.equal(model.badgeRules.find((item) => item.id === "preset-extra").name, addedRule.name);
    assert.deepEqual(model.badgeInputControls.find((item) => item.rule === "preset-extra"),
        { rule: "preset-extra", control: "preset.phase", adapter: "designer-badge-preset-adapter",
            binding: "designer-badge-binding-preset-extra",
            definition: "designer-badge-preset-control", sourceId: "badge-catalog-test" });
    assert.equal(model.badgeTypes.find((item) => item.id === "checklist-progress").rule,
        "checklist-progress");
    assert.equal(model.badgeRules.find((item) => item.id === "checklist-progress").adapter,
        "badge-rule-preset-extra");
    assert.equal(model.badgeTypes.find((item) => item.id === "artifact-renamed").enabled, false);
    assert.equal(model.badgeTypes.find((item) => item.id === "artifact-renamed").title,
        "Replaced by preset");
    assert.equal(model.badgeTypes.find((item) => item.id === "artifact-renamed").description,
        "Customized in the single badges settings file.");
    settings.types.find((item) => item.id === "preset-extra").defaultText = "Unknown {undeclared}";
    await writeFile(settingsOverride, JSON.stringify(settings));
    await assert.rejects(load(), /undeclared placeholder/);
    settings.types.find((item) => item.id === "preset-extra").defaultText = "Preset {count}";
    await writeFile(settingsOverride, JSON.stringify(settings));
    await writeFile(replacedRule, JSON.stringify({
        ...JSON.parse(await readFile(replacedRule, "utf8")), adapter: "not-registered",
    }));
    await assert.rejects(load(), /missing registered badge adapter/);
    await writeFile(replacedRule, JSON.stringify({
        ...JSON.parse(await readFile(replacedRule, "utf8")),
        adapter: "badge-rule-preset-extra",
    }));
    settings.types.push({ ...settings.types[0] });
    await writeFile(settingsOverride, JSON.stringify(settings));
    await assert.rejects(load(), /duplicate badge type ID/);
});

test("Designer badge save and reopen freezes registered assets into generated config", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.workflow.outputEvidence = {
        specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
        plan: { outputs: [], view: null },
    };
    handoff.sourceFingerprint = fingerprint({
        workflow: handoff.workflow, selections: handoff.selections,
    });

    await t.test("test preset badge uses its own Designer control and packages only its evaluator", async (t) => {
        const workspace = await fixture(t);
        const handoff = validHandoff();
        handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
        handoff.sourceFingerprint = fingerprint({
            workflow: handoff.workflow, selections: handoff.selections,
        });
        await saveHandoff(workspace, handoff);
        const { project, entries } = await projectFixture(t, workspace);
        const templates = [...await stockTemplates(project), ...await badgeTemplates(project)];
        const preset = fileURLToPath(new URL(
            "../../../../../tests/fixtures/test-presets/copilot-badge-input-test/", import.meta.url));
        const replacement = templates.find((item) => item.name === "badges-settings");
        const presetFolder = join(project, ".specify", "presets", "copilot-badge-input-test");
        const settingsPath = join(presetFolder, "designer", "badges.json");
        await mkdir(dirname(settingsPath), { recursive: true });
        await copyFile(join(preset, "designer", "badges.json"), settingsPath);
        templates.splice(templates.indexOf(replacement), 1,
            { ...replacement, path: settingsPath, sourceId: "copilot-badge-input-test" });
        for (const [name, relative, kind] of [
            ["badge-rule-test-phase", join("generated", "rule.json"), "generated.badge-rule-definition"],
            ["badge-rule-test-phase-adapter", join("generated", "evaluator.mjs"),
                "generated.badge-rule-adapter"],
            ["designer-badge-test-control", join("designer", "control.json"),
                "designer.badge-input-control"],
            ["designer-badge-test-adapter", join("designer", "adapter.mjs"),
                "designer.badge-input-adapter"],
            ["designer-badge-test-binding", join("designer", "binding.json"),
                "designer.badge-input-binding"],
        ]) {
            const path = join(presetFolder, relative);
            await mkdir(dirname(path), { recursive: true });
            await copyFile(join(preset, relative), path);
            templates.push({ name, path, sourceId: "copilot-badge-input-test",
                kind, strategy: "replace" });
        }
        const inventory = (_root, name) => {
            const item = templates.find((entry) => entry.name === name);
            const presetLayer = item?.sourceId === "copilot-badge-input-test";
            return { kind: "template", stack: [{ active: true,
                layer: presetLayer ? "preset" : "extension",
                sourceId: presetLayer ? "copilot-badge-input-test" : "extension-canvas-design",
                strategy: "replace" }] };
        };
        const model = await loadResolvedDesignerPages(handoff, project, entries, templates, inventory);
        assert.equal(model.badgeInputControls.find((item) => item.rule === "test-phase").control,
            "test.phase-choice");
        const initial = await loadDesignerSettings(workspace, handoff, model);
        const badge = { id: "test-phase-1", type: "test-phase", category: "Phase", inputs: { phase: "specify" },
            text: "Phase confirmed", color: "purple", showIn: ["workflow-list"], phase: null };
        await assert.rejects(saveDesignerSettings(workspace, handoff, initial, {
            modelRevision: model.revision, revision: 0, values: initial.values,
            outputs: initial.outputs,
            badges: [{ ...badge, inputs: { phase: "unknown" } }],
        }), /invalid phase input phase/);
        const saved = await saveDesignerSettings(workspace, handoff, initial, {
            modelRevision: model.revision, revision: 0,
            values: { ...initial.values, "canvas.id": "test-badge-canvas",
                "canvas.displayName": "Test badge canvas" },
            outputs: initial.outputs, badges: [badge],
        });
        const reopened = await loadDesignerSettings(workspace, handoff, model);
        assert.deepEqual(reopened.badges, [badge]);
        const prepared = await freezeGeneration({ model: reopened, values: saved.values,
            badges: reopened.badges, outputs: reopened.outputs, handoff, project, workspace });
        const { materialize } = await import(new URL(
            "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
        await materialize(project, workspace, handoff.handoffId, prepared.requestId);
        const target = join(project, prepared.target);
        const config = JSON.parse(await readFile(join(target, "canvas-config.json"), "utf8"));
        assert.deepEqual(config.badges.instances, [badge]);
        assert.deepEqual(config.badges.rules.map(({ id }) => id), ["test-phase"]);
        assert.equal(config.badges.rules[0].adapter, "badge-rule-test-phase-adapter");
        assert.equal(Object.hasOwn(config.badges.rules[0], "module"), false);
        await assert.rejects(readFile(join(target, "badges", "designer-badge-test-adapter.mjs")),
            /ENOENT/);
        assert.equal((await readFile(join(target, "badges", "badge-rule-test-phase-adapter.mjs"),
            "utf8")).includes("getRun(inputs.phase)"), true);
        const evaluator = await import(pathToFileURL(join(target, "badges",
            "badge-rule-test-phase-adapter.mjs")).href);
        assert.deepEqual(await evaluator.evaluate({ inputs: badge.inputs,
            evidence: { getRun: async (phase) => ({ status: phase === "specify"
                ? "completed" : "failed" }) } }), { match: true });
        assert.deepEqual(await evaluator.evaluate({ inputs: badge.inputs,
            evidence: { getRun: async () => ({ status: "failed" }) } }), { match: false });
        await writeFile(join(presetFolder, "designer", "adapter.mjs"),
            "export const controlId = 'test.phase-choice';");
        await assert.rejects(freezeGeneration({ model: reopened, values: saved.values,
            badges: reopened.badges, outputs: reopened.outputs, handoff, project, workspace }),
        /changed|hash|frozen|integrity/i);
    });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const templates = [...await stockTemplates(project), ...await badgeTemplates(project)];
    const pages = await loadResolvedDesignerPages(handoff, project, entries,
        templates, badgeRegistration);
    assert.equal(pages.badgeTypes.find((type) => type.id === "checklist-progress")
        .name, "badges-settings");
    assert.equal(pages.badgeRules.find((rule) => rule.id === "checklist-progress")
        .name, "badge-rule-checklist-progress");
    const model = await loadDesignerSettings(workspace, handoff, pages);
    assert.deepEqual(model.badges, []);
    const values = { ...model.values, "canvas.id": "badge-canvas",
        "canvas.displayName": "Badge canvas" };
    const outputs = { ...model.outputs, plan: {
        outputs: [...model.outputs.plan.outputs, "specs/<slug>/plan.md"],
        view: "specs/<slug>/plan.md",
    } };
    const badges = [{ id: "checklist-progress-1", type: "checklist-progress", category: "Progress",
        inputs: { artifact: { phase: "plan", output: "specs/<slug>/plan.md" },
            prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" }],
            targetphase: "plan" },
        text: "{completed}/{total} complete", color: "blue",
        phaseText: "{completed}/{total} done", summaryText: "Workflows",
        showIn: ["workflow-list", "workflow-summary"], phase: null,
        targets: [{ phase: "specify", output: "specs/<slug>/spec.md" },
            { phase: "plan", output: null }] }, {
        id: "verdict", type: "value-match", category: "Severity",
        inputs: { artifact: { phase: "specify", output: "specs/<slug>/spec.md" },
            choices: [{ id: "critical", value: "critical", text: "Critical",
                summaryText: "Critical", phaseText: "Critical", color: "red" },
            { id: "low", value: "low", text: "Low", summaryText: "Low", phaseText: "Low", color: "blue" }] },
        color: "amber", showIn: ["workflow-list", "workflow-summary"], phase: null,
        targets: [{ phase: "specify", output: null }] }];
    const saved = await saveDesignerSettings(workspace, handoff, model, {
        modelRevision: model.revision, revision: 0, values, outputs, badges,
    });
    assert.equal(saved.settingsRevision, 1);
    const shared = structuredClone(badges);
    const reopened = await loadDesignerSettings(workspace, handoff, pages);
    assert.deepEqual(reopened.badges, shared);
    const stored = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "settings.json"), "utf8"));
    assert.deepEqual(stored.badges, shared, "settings saves preserve per-placement text");
    const prepared = await freezeGeneration({ model: reopened, values: reopened.values,
        badges: reopened.badges, outputs: reopened.outputs, handoff, project, workspace });
    const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.deepEqual(request.badges.adapters.map(({ name, kind }) => [name, kind]),
        [["badge-rule-content-adapter", "generated.badge-rule-adapter"]]);
    assert.equal(Object.hasOwn(request.badges, "handlers"), false);
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, prepared.target, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.badges.instances, shared);
    assert.equal(config.badges.types[0].id, "checklist-progress");
    assert.equal(config.badges.rules[0].id, "checklist-progress");
    assert.equal(config.badges.rules[0].adapter, "badge-rule-content-adapter");
    assert.deepEqual(Object.keys(config.badges).sort(), ["instances", "rules", "types"]);
    await t.test("generated category and value-match badges import atomically, then save and generate unchanged", async (t) => {
        const shell = await startShell(handoff, model, { project, workspace });
        t.after(() => shell.close());
        const base = new URL(shell.url);
        const endpoint = (path) => new URL(`${path}${base.search}`, base);
        const send = (input, contentType = "application/json") => fetch(
            endpoint("/api/validate-badge-import"), { method: "POST",
                headers: { "Content-Type": contentType },
                body: typeof input === "string" ? input : JSON.stringify(input) });
        const input = { schemaVersion: 1, modelRevision: model.revision,
            config, badges: [], outputs };
        const settingsPath = join(workspace, "speckit-canvas-designer", "handoffs",
            handoff.handoffId, "settings.json");
        const before = await readFile(settingsPath, "utf8");
        const accepted = await send(input);
        assert.equal(accepted.status, 200);
        const imported = await accepted.json();
        assert.deepEqual(imported, { schemaVersion: 1, badges });
        assert.deepEqual((await (await fetch(endpoint("/api/state"))).json()).badges, []);
        assert.equal(await readFile(settingsPath, "utf8"), before, "validation does not save settings");
        const renamed = structuredClone(config);
        renamed.badges.types.forEach((type) => { type.hash = "f".repeat(64); });
        assert.equal((await send({ ...input, config: renamed })).status, 200,
            "a different whole badge-settings hash is not an evaluator incompatibility");
        const duplicateMatch = { ...badges[1], id: "other-verdict",
            inputs: { ...badges[1].inputs, choices: badges[1].inputs.choices.map((choice, index) =>
                ({ ...choice, id: `other-${index}` })) } };
        for (const [body, reason] of [
            [{ ...input, config: { badges: config.badges } }, /complete generated canvas-config/],
            [{ ...input, badges }, /duplicate id/],
            [{ ...input, badges: [duplicateMatch] }, /duplicate phase\/output target.*other-verdict/],
            [{ ...input, outputs: model.outputs }, /invalid artifact input/],
            [{ ...input, config: { ...config, badges: { ...config.badges,
                instances: [badges[0], { ...badges[1], category: "" }] } } }, /badge 2.*invalid category/],
            [{ ...input, config: { ...config, badges: { ...config.badges,
                rules: config.badges.rules.map((rule) => ({ ...rule, hash: "0".repeat(64) })) } } },
            /evaluator.*incompatible/],
        ]) {
            const rejected = await send(body);
            assert.equal(rejected.status, 422);
            assert.match((await rejected.json()).error, reason);
            assert.equal(await readFile(settingsPath, "utf8"), before);
        }
        try {
            const prior = JSON.parse(before);
            await writeFile(settingsPath, JSON.stringify({ ...prior, badges: [badges[1], duplicateMatch] }));
            await assert.rejects(loadDesignerSettings(workspace, handoff, pages),
                /duplicate phase\/output target already covered by badge verdict/);
        } finally { await writeFile(settingsPath, before); }
        assert.equal((await send({ ...input, modelRevision: "stale" })).status, 409);
        assert.equal((await send({ ...input, save: true })).status, 422);
        assert.equal((await send("{broken")).status, 422);
        assert.equal((await send(input, "text/plain")).status, 415);
        assert.equal((await send(" ".repeat(4 * 1024 * 1024 + 1))).status, 413);
        const unauthorized = new URL(endpoint("/api/validate-badge-import"));
        unauthorized.search = "";
        assert.equal((await fetch(unauthorized, { method: "POST", body: JSON.stringify(input) })).status, 404);
        const evaluator = model.templates.find((entry) => entry.kind === "generated.badge-rule-adapter"
            && entry.name === "badge-rule-content-adapter");
        const evaluatorBytes = await readFile(evaluator.path);
        try {
            await appendFile(evaluator.path, "\n// changed since opening");
            const changed = await send(input);
            assert.equal(changed.status, 422);
            assert.match((await changed.json()).error, /changed since Designer opened/);
        } finally { await writeFile(evaluator.path, evaluatorBytes); }
        const save = await fetch(endpoint("/api/save"), { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelRevision: model.revision, revision: 1,
                values: { ...values, "canvas.id": "imported-badge-canvas" },
                outputs, badges: imported.badges }) });
        assert.equal(save.status, 200);
        const kept = await save.json();
        assert.deepEqual(kept.badges, badges);
        const roundTrip = await freezeGeneration({ model: kept, values: kept.values,
            badges: kept.badges, outputs: kept.outputs, handoff, project, workspace });
        await materialize(project, workspace, handoff.handoffId, roundTrip.requestId);
        const regenerated = JSON.parse(await readFile(
            join(project, roundTrip.target, "canvas-config.json"), "utf8"));
        assert.deepEqual(regenerated.badges, config.badges);
    });
    assert.deepEqual(await readFile(join(project, prepared.target, "badges",
        "badge-rule-content-adapter.mjs")), Buffer.from(request.badges.adapters[0].content, "base64"));
    const runtime = await import(pathToFileURL(join(project, prepared.target, "badge-runtime.mjs")).href);
    const phases = [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
        { id: "plan", outputs: ["specs/<slug>/plan.md"] }];
    runtime.validateBadges(config.badges, phases);
    await mkdir(join(project, "specs", "alpha"), { recursive: true });
    await writeFile(join(project, "specs", "alpha", "spec.md"), "low and CRITICAL");
    const result = await runtime.evaluateBadges(config.badges, { cwd: project, phases,
        workflows: ["alpha"], outputPath: async ({ phase }) =>
            `specs/alpha/${phase === "specify" ? "spec" : "plan"}.md`, runFor: () => null });
    assert.equal(result.items.alpha.find(({ id }) => id === "verdict").text, "Critical");
    assert.deepEqual(result.summary.map(({ count }) => count), [0, 1, 0]);
    assert.deepEqual(result.summary.map(({ text }) => text), ["Workflows: 0", "Critical: 1", "Low: 0"]);
});

test("Generate accepts Constitution card and declared output destinations", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.workflow.selectedPhases.unshift("constitution");
    handoff.workflow.outputEvidence = {
        constitution: { outputs: [".specify/memory/constitution.md"],
            view: ".specify/memory/constitution.md" },
        specify: { outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" },
        plan: { outputs: [], view: null },
    };
    handoff.sourceFingerprint = fingerprint({
        workflow: handoff.workflow, selections: handoff.selections,
    });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const pages = await loadResolvedDesignerPages(handoff, project, entries,
        [...await stockTemplates(project), ...await badgeTemplates(project)], badgeRegistration);
    const model = await loadDesignerSettings(workspace, handoff, pages);
    const values = { ...model.values, "canvas.id": "constitution-badge",
        "canvas.displayName": "Constitution badge" };
    // Value match entry text exists exactly for the badge's selected placements.
    const fitEntries = (badge) => {
        const phase = Boolean(badge.targets?.length || badge.showIn.includes("phase-card"));
        const choices = badge.inputs.choices.map(({ text: _t, phaseText: _p, ...choice }) => ({
            ...choice, ...(badge.showIn.includes("workflow-list") ? { text: "Value matched" } : {}),
            ...(phase ? { phaseText: "Value matched" } : {}) }));
        return { ...badge, inputs: { ...badge.inputs, choices } };
    };
    const global = { id: "constitution-evidence", type: "value-match", category: "Constitution",
        inputs: { artifact: { phase: "constitution", output: ".specify/memory/constitution.md" },
            choices: [{ id: "adopted", value: "adopted", text: "Value matched", color: "amber" }] },
        color: "amber",
        showIn: ["workflow-list"], phase: null };
    const options = { model, values, outputs: model.outputs, handoff, project, workspace };
    await assert.doesNotReject(freezeGeneration({ ...options, badges: [global] }));
    for (const badge of [
        { ...global, showIn: ["phase-card"], phase: "constitution" },
        { ...global, targets: [{ phase: "constitution", output: null }] },
        { ...global, targets: [{ phase: "constitution", output: ".specify/memory/constitution.md" }] },
    ].map(fitEntries)) {
        await assert.doesNotReject(freezeGeneration({ ...options, badges: [badge] }));
    }
    const workflowEvidence = { ...global, inputs: {
        artifact: { phase: "specify", output: "specs/<slug>/spec.md" },
        choices: global.inputs.choices,
    } };
    await assert.doesNotReject(freezeGeneration({ ...options, badges: [workflowEvidence] }));
    for (const badge of [
        { ...workflowEvidence, showIn: ["phase-card"], phase: "constitution" },
        { ...workflowEvidence, targets: [{ phase: "constitution", output: null }] },
        { ...workflowEvidence, targets: [{ phase: "constitution",
            output: ".specify/memory/constitution.md" }] },
        { ...workflowEvidence, targets: [
            { phase: "constitution", output: null }, { phase: "specify", output: null },
        ] },
    ].map(fitEntries)) {
        await assert.rejects(saveDesignerSettings(workspace, handoff, model, {
            modelRevision: model.revision, revision: 0, values, outputs: model.outputs,
            badges: [badge],
        }), /project placement requires project-level rule inputs/);
        await assert.rejects(freezeGeneration({ ...options, badges: [badge] }),
            /project placement with workflow rule inputs/);
    }
    const phaseBadge = { ...global, type: "phase-run-complete",
        inputs: { phase: "specify" }, text: "Phase run complete", phaseText: "Phase run complete",
        targets: [{ phase: "constitution", output: null }] };
    await assert.rejects(saveDesignerSettings(workspace, handoff, model, {
        modelRevision: model.revision, revision: 0, values, outputs: model.outputs,
        badges: [phaseBadge],
    }), /project placement requires project-level rule inputs/);
    await assert.rejects(freezeGeneration({ ...options, badges: [phaseBadge] }),
        /project placement with workflow rule inputs/);
    await assert.rejects(freezeGeneration({ ...options, badges: [fitEntries({
        ...global, targets: [{ phase: "constitution", output: "undeclared.md" }],
    })] }),
    /invalid or removed output, phase, text, or placement/);
});

async function stockTemplates(project) {
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/",
        import.meta.url));
    const directory = join(project, ".specify", "extensions", "extension-canvas-design",
        "designer-host", "essentials-settings");
    await mkdir(directory, { recursive: true });
    const templates = [];
    for (const name of ["description", "workflow-heading", "workflow-item-name", "custom-slug"]) {
        const path = join(directory, `${name}.json`);
        await copyFile(join(source, "designer-host", "essentials-settings", `${name}.json`), path);
        templates.push({ name: `designer-essentials-${name}`, path,
            sourceId: "extension:extension-canvas-design",
            kind: "designer.setting-definition", strategy: "replace" });
    }
    return templates;
}

test("Generate freezes winning dialog and button assets with their registrations", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.selectedPhases.push("implement");
    handoff.workflow.installed = { presets: [{ id: "runtime-kit", version: "1.0.0",
        source: "community", enabled: false, priority: 3 }], extensions: [], bundles: [] };
    const locator = { installedId: "runtime-kit", source: "community",
        catalogId: "runtime-catalog", downloadUrl: "https://example.org/runtime.zip" };
    handoff.workflow.installLocators = { presets: [locator], extensions: [], bundles: [] };
    handoff.workflow.runtimeSetup = { presets: [{ id: "runtime-kit", version: "1.0.0",
        enabled: false, priority: 3, locator }], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/",
        import.meta.url));
    const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-dialog-buttons-test/",
        import.meta.url));
    const templates = await stockTemplates(project);
    for (const [name, kind, directory, filename, root] of [
        ["designer-essentials-show-setup", "designer.setting-definition",
            "designer-host/essentials-settings", "show-setup.json", source],
        ["generated-setup-dialog", "generated.dialog-definition",
            "generated-host/dialog", "setup.json", source],
        ["generated-dialog-adapter", "generated.dialog-adapter",
            "generated-host/dialog", "generated-dialog-adapter.mjs", source],
        ["generated-setup-button-control", "generated.button-control-definition",
            "generated-host/setup-button-control", "control.json", source],
        ["generated-setup-button-adapter", "generated.button-adapter",
            "generated-host/setup-button-control", "generated-setup-button-adapter.mjs", source],
        ["generated-setup-button", "generated.button-placement",
            "generated-host/setup-button-control", "setup.json", source],
        ["canvas-dialog-buttons-test", "generated.dialog-definition",
            "generated", "dialog.json", preset],
        ["canvas-button-dialog-test", "generated.dialog-definition",
            "generated", "button-dialog.json", preset],
        ["canvas-dialog-trigger-control", "generated.button-control-definition",
            "generated", "dialog-trigger-control.json", preset],
        ["canvas-dialog-trigger-adapter", "generated.button-adapter",
            "generated", "dialog-trigger-adapter.mjs", preset],
        ["canvas-implement-dialog-test", "generated.phase-dialog-binding",
            "generated", "phase-binding.json", preset],
        ["canvas-workflow-button-test", "generated.button-placement",
            "generated", "button.json", preset],
    ]) {
        const path = join(project, ".specify", root === source ? "extensions" : "presets",
            root === source ? "extension-canvas-design" : "copilot-dialog-buttons-test",
            directory, filename);
        await mkdir(dirname(path), { recursive: true });
        await copyFile(join(root, directory, filename), path);
        if (name === "generated-setup-button") {
            const definition = JSON.parse(await readFile(path, "utf8"));
            await writeFile(path, JSON.stringify({
                ...definition, label: "Initialize project", presentation: "secondary",
            }));
        }
        templates.push({ name, path, kind, sourceId: root === source
            ? "extension:extension-canvas-design" : "copilot-dialog-buttons-test",
        strategy: "replace" });
    }
    const sourceFor = (_root, name) => {
        const template = templates.find((item) => item.name === name);
        return { kind: "template", stack: [{ active: true,
            sourceId: template.sourceId.startsWith("extension:")
                ? template.sourceId.slice("extension:".length) : template.sourceId,
            layer: template.sourceId.startsWith("extension:") ? "extension" : "preset",
            strategy: "replace" }] };
    };
    const model = await loadResolvedDesignerPages(handoff, project, entries, templates, sourceFor);
    for (const [name, change, expected] of [
        ["canvas-implement-dialog-test", (doc) => ({ ...doc, dialog: "generated-setup-dialog" }),
            /phase dialog cannot use package slots/],
        ["canvas-workflow-button-test", (doc) => ({ ...doc, dialog: "canvas-dialog-buttons-test" }),
            /Workflow dialog cannot use dynamic slots/],
        ["generated-setup-dialog", (doc) => ({ ...doc, blocks: [
            ...doc.blocks, { type: "slot", name: "phase" },
        ] }), /setup dialog requires only the pending packages slot/],
    ]) {
        const entry = templates.find((item) => item.name === name);
        const original = await readFile(entry.path);
        await writeFile(entry.path, JSON.stringify(change(JSON.parse(original))));
        await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, templates,
            sourceFor), expected);
        await writeFile(entry.path, original);
    }
    const values = { ...model.values, "canvas.id": "dialog-canvas",
        "canvas.displayName": "Dialog canvas", "setup.show": true };
    const frozen = await freezeGeneration({ model, values, handoff, project, workspace });
    const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", frozen.requestId, "request.json"), "utf8"));
    assert.equal(request.values["setup.show"], true);
    assert.deepEqual(request.runtimeSetup, handoff.workflow.runtimeSetup);
    assert.deepEqual(request.dialogDefinitions.map(({ name, assets }) =>
        [name, assets.map(({ kind }) => kind)]), [
        ["generated-setup-dialog", ["generated.dialog-definition", "generated.dialog-adapter"]],
        ["canvas-dialog-buttons-test", ["generated.dialog-definition", "generated.dialog-adapter"]],
        ["canvas-button-dialog-test", ["generated.dialog-definition", "generated.dialog-adapter"]],
    ]);
    assert.deepEqual(request.phaseDialogBindings.map(({ name, assets }) =>
        [name, assets[0].kind]), [["canvas-implement-dialog-test", "generated.phase-dialog-binding"]]);
    assert.deepEqual(request.buttonControls.map(({ name, assets }) => [
        name, assets.map(({ kind }) => kind),
    ]), [
        ["generated-setup-button-control", ["generated.button-control-definition", "generated.button-adapter"]],
        ["canvas-dialog-trigger-control", ["generated.button-control-definition", "generated.button-adapter"]],
    ]);
    assert.deepEqual(request.buttonPlacements.map(({ name, assets }) =>
        [name, assets[0].kind]), [
        ["generated-setup-button", "generated.button-placement"],
        ["canvas-workflow-button-test", "generated.button-placement"],
    ]);
    for (const entry of [...request.dialogDefinitions, ...request.phaseDialogBindings,
        ...request.buttonControls, ...request.buttonPlacements]) {
        for (const item of entry.assets) {
            assert.equal(createHash("sha256").update(Buffer.from(item.content, "base64"))
                .digest("hex"), item.hash);
        }
    }
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", frozen.requestId, "request.json");
    for (const [kind, name, update, expected] of [
        ["phaseDialogBindings", "canvas-implement-dialog-test",
            { dialog: "generated-setup-dialog" }, /Invalid phase dialog binding/],
        ["buttonPlacements", "canvas-workflow-button-test",
            { dialog: "canvas-dialog-buttons-test" }, /Invalid frozen button placement/],
        ["dialogDefinitions", "generated-setup-dialog",
            { blocks: [...request.dialogDefinitions.find((item) =>
                item.name === "generated-setup-dialog").blocks,
                { type: "slot", name: "phase" }] }, /Invalid frozen button placement/],
    ]) {
        const altered = structuredClone(request);
        const entry = altered[kind].find((item) => item.name === name);
        const asset = entry.assets[0];
        const definition = JSON.parse(Buffer.from(asset.content, "base64").toString("utf8"));
        Object.assign(definition, update);
        Object.assign(entry, update);
        const bytes = Buffer.from(JSON.stringify(definition));
        asset.content = bytes.toString("base64");
        asset.hash = createHash("sha256").update(bytes).digest("hex");
        delete altered.integrity;
        altered.integrity = createHash("sha256").update(JSON.stringify(altered)).digest("hex");
        await writeFile(requestPath, JSON.stringify(altered));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, frozen.requestId),
            expected);
    }
    await writeFile(requestPath, JSON.stringify(request));
    await materialize(project, workspace, handoff.handoffId, frozen.requestId);
    const config = JSON.parse(await readFile(join(project, frozen.target, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.runtimeSetup, request.runtimeSetup);
    assert.equal(config.dialogs.length, 3);
    assert.equal(config.phaseDialogs.length, 1);
    assert.equal(config.buttons.length, 2);
    assert.equal(config.buttons.find((button) => button.id === "generated-setup-button").action.type,
        "project.setup");
    assert.equal(config.buttons.find((button) => button.id === "generated-setup-button").control,
        "project.setup-button");
    assert.equal(config.buttons.find((button) => button.id === "generated-setup-button").label,
        "Initialize project");
    assert.equal(config.buttons.find((button) => button.id === "generated-setup-button").presentation,
        "secondary");
    assert.equal(config.buttons.find((button) => button.page === "workflow").dialog,
        "canvas-button-dialog-test");
    assert.equal(config.buttons.find((button) => button.page === "workflow").control,
        "dialog.trigger");
    assert.equal(config.phaseDialogs[0].phase, "speckit.implement");
    const generated = join(project, frozen.target);
    const { readConfig, renderHtml, createWorkflowRoutes } = await import(
        pathToFileURL(join(generated, "server.mjs")).href);
    const html = renderHtml(readConfig(), "test-token");
    assert.match(stockMarkup(config), /id="setup-surface"[^>]*\shidden>/);
    assert.match(html, /id="workflow-surface"/);
    assert.match(stockMarkup(config), /data-workflow-slot="workflow\.actions"/);
    assert.match(html, /id="generated-dialog-contracts"/);
    const generatedUi = await readFile(join(generated, "ui", "app.js"), "utf8");
    assert.match(generatedUi, /async function confirmGeneratedPhase\(/);
    assert.match(generatedUi, /confirmRun: confirmGeneratedPhase/);
    assert.match(await readFile(join(generated, "dialogs", "canvas-button-dialog-test.json"), "utf8"),
        /No workflow phase will run/);
    assert.match(await readFile(join(generated, "buttons", "generated-setup-button-adapter.mjs"), "utf8"),
        /controlId = "project.setup-button"/);
    assert.match(await readFile(join(generated, "buttons", "canvas-dialog-trigger-adapter.mjs"), "utf8"),
        /controlId = "dialog.trigger"/);
    const http = createServer();
    const routes = createWorkflowRoutes(config, { runtime: { snapshot: async () => ({}) },
        instanceId: "test-instance", token: "test-token", port: () => http.address().port });
    http.on("request", routes.handle);
    await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => { routes.close(); http.close(resolve); }));
    const baseUrl = `http://127.0.0.1:${http.address().port}`;
    for (const [path, content] of [
        ["/dialogs/generated-setup-dialog.json", /pending-packages/],
        ["/dialogs/canvas-button-dialog-test.json", /No workflow phase will run/],
        ["/dialogs/generated-dialog-adapter.mjs", /dialogId = "stock.dialog"/],
        ["/buttons/generated-setup-button-adapter.mjs", /controlId = "project.setup-button"/],
        ["/buttons/canvas-dialog-trigger-adapter.mjs", /controlId = "dialog.trigger"/],
    ]) {
        const response = await fetch(`${baseUrl}${path}?token=test-token`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), content);
    }
    assert.equal((await fetch(`${baseUrl}/dialogs/not-registered.mjs?token=test-token`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/dialogs/generated-setup-dialog.json`)).status, 401);
});

async function stockImageTemplates(project) {
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/",
        import.meta.url));
    const directory = join(project, ".specify", "extensions", "extension-canvas-design",
        "shared-controls", "stock-image");
    await mkdir(directory, { recursive: true });
    const entries = [
        ["shared-controls-image", "control.json", "shared.control-definition"],
        ["designer-control-adapter-image", "designer.mjs", "designer.control-adapter"],
        ["generated-control-adapter-image", "generated.mjs", "generated.control-adapter"],
    ];
    return Promise.all(entries.map(async ([name, filename, kind]) => {
        const path = join(directory, filename);
        await copyFile(join(source, "shared-controls", "stock-image", filename), path);
        return { name, path, sourceId: "extension:extension-canvas-design",
            kind, strategy: "replace" };
    }));
}

test("stock image picker announces its format hint and upload error", async (t) => {
    const previousDocument = globalThis.document;
    t.after(() => { globalThis.document = previousDocument; });
    const element = () => ({
        children: [], attributes: new Map(), classList: { add() {} },
        setAttribute(name, value) { this.attributes.set(name, value); },
        getAttribute(name) { return this.attributes.get(name); },
        removeAttribute(name) { this.attributes.delete(name); },
        addEventListener() {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
    });
    globalThis.document = { createElement: element };
    const { mount } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/shared-controls/stock-image/designer.mjs",
        import.meta.url));
    const root = element();
    mount({ root, field: { id: "canvas.logo", label: "Header logo",
        description: "PNG or JPEG, up to 32 KiB.", validation: { type: "image",
            maxBytes: 32768, mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] } },
        value: "", context: { setBusy() {} }, onChange() {} });
    const input = root.children[2].children[0];
    const error = root.children[3];
    const hint = root.children[4];
    assert.equal(hint.textContent, "PNG or JPEG, up to 32 KiB.");
    assert.equal(input.getAttribute("aria-describedby"), `${hint.id} ${error.id}`);
});

test("stock checkboxes display their JSON help below the label", async (t) => {
    const previousDocument = globalThis.document;
    t.after(() => { globalThis.document = previousDocument; });
    const element = () => ({
        children: [], attributes: new Map(), events: {},
        setAttribute(name, value) { this.attributes.set(name, value); },
        getAttribute(name) { return this.attributes.get(name); },
        addEventListener(name, callback) { this.events[name] = callback; },
        replaceChildren(...children) { this.children = children; },
    });
    globalThis.document = { createElement: element };
    const { mount } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/shared-controls/stock-checkbox/designer.mjs",
        import.meta.url));
    const source = new URL("../../../../../spec-kit-extensions/extension-canvas-design/designer-host/essentials-settings/",
        import.meta.url);
    for (const file of ["custom-slug.json", "show-setup.json"]) {
        const { field } = JSON.parse(await readFile(new URL(file, source), "utf8"));
        const root = element();
        let nextValue;
        mount({ root, field: { ...field, validation: { type: "boolean" } },
            value: false, onChange: (value) => { nextValue = value; } });
        const [input, label, hint] = root.children;
        assert.equal(label.textContent, field.label);
        assert.equal(hint.className, "settings-hint");
        assert.equal(hint.textContent, field.description);
        assert.equal(input.getAttribute("aria-describedby"), hint.id);
        input.checked = true;
        input.events.input();
        assert.equal(nextValue, true);
    }
});

test("Designer tabs remain navigable when a field adapter is not ready", async () => {
    const source = await readFile(new URL("../ui/app.js", import.meta.url), "utf8");
    const start = source.indexOf('tabs.addEventListener("click"');
    const end = source.indexOf("function applyState(", start);
    assert.ok(start >= 0 && end > start);
    const handlers = new Map();
    const buttons = ["designer-appearance", "designer-essentials"].map((page) => ({
        dataset: { page }, focus() {},
    }));
    let selected = buttons[0].dataset.page;
    runInNewContext(source.slice(start, end), {
        tabs: { children: buttons, addEventListener: (type, handler) => handlers.set(type, handler) },
        document: { activeElement: buttons[0] },
        currentPage: selected,
        checkReady: () => { throw new Error("Broken adapter must not block navigation"); },
        renderPage: (page) => { selected = page; },
    });
    handlers.get("click")({ target: { closest: () => buttons[1] } });
    assert.equal(selected, "designer-essentials");
    selected = buttons[0].dataset.page;
    handlers.get("keydown")({ key: "ArrowRight", preventDefault() {} });
    assert.equal(selected, "designer-essentials");
});

test("switching tabs preserves an unsubmitted badge editor", async () => {
    const source = await readFile(new URL("../ui/app.js", import.meta.url), "utf8");
    const start = source.indexOf("function renderPage(");
    const end = source.indexOf('tabs.addEventListener("click"', start);
    assert.ok(start >= 0 && end > start);
    const root = {
        childNodes: [],
        replaceChildren(...children) { this.childNodes = children; },
        append(...children) { this.childNodes.push(...children); },
        setAttribute() {},
    };
    const pageViews = new Map();
    let badgeMounts = 0;
    let badgeUpdates = 0;
    const draftOutputs = { specify: { outputs: ["spec.md"] } };
    const renderPage = runInNewContext(`${source.slice(start, end)}\nrenderPage`, {
        model: { revision: "same", phases: [], outputs: {}, pages: [
            { page: "designer-badges", fields: [], fixedControl: "designer.badges" },
            { page: "designer-appearance", fields: [] },
        ] },
        root, pageViews, currentPage: null,
        generate: { hidden: false }, openGenerated: { hidden: false },
        tabs: { children: [{ dataset: { page: "designer-badges" }, setAttribute() {} },
            { dataset: { page: "designer-appearance" }, setAttribute() {} }] },
        mountBadges: () => {
            badgeMounts++;
            root.replaceChildren({ draft: "", choices: ["spec.md"] });
            return { updateOutputs(outputs) {
                badgeUpdates++;
                root.childNodes[0].choices = [...outputs.specify.outputs];
            } };
        },
        element: (tag, text) => ({ tag, text, children: [],
            append(...nodes) { this.children.push(...nodes); },
            addEventListener() {} }),
        draftBadges: [], draftOutputs, updateSave() {},
    });
    renderPage("designer-badges");
    const editor = root.childNodes[0];
    editor.draft = "still editing";
    renderPage("designer-appearance");
    draftOutputs.specify.outputs.push("new.md");
    renderPage("designer-badges");
    assert.equal(root.childNodes[0], editor);
    assert.equal(root.childNodes[0].draft, "still editing");
    assert.deepEqual(root.childNodes[0].choices, ["spec.md", "new.md"]);
    assert.equal(badgeMounts, 1);
    assert.equal(badgeUpdates, 1);
    assert.ok(pageViews.has("designer-appearance"));
});

test("Designer readiness checks controls on previously visited tabs", async () => {
    const source = await readFile(new URL("../ui/app.js", import.meta.url), "utf8");
    const start = source.indexOf("function checkReady()");
    const end = source.indexOf("function updateSave()", start);
    assert.ok(start >= 0 && end > start);
    const failures = [];
    const handle = { isReady: () => false };
    const model = { pages: [
        { page: "designer-essentials", fields: [{ id: "canvas.logo", label: "Logo" }] },
        { page: "designer-appearance", fields: [] },
    ] };
    const ready = runInNewContext(`${source.slice(start, end)}\ncheckReady`, {
        model, currentPage: "designer-appearance",
        pageViews: new Map([["designer-essentials", []]]),
        mounted: new Map([["canvas.logo", handle]]),
        showFieldError: (message) => failures.push(message),
    });
    assert.equal(ready(), false);
    assert.match(failures[0], /Logo \(canvas.logo\) is still processing/);
    handle.isReady = () => true;
    assert.equal(ready(), true);
});

function stockImageRegistration(_root, name) {
    const stock = name.startsWith("shared-controls-image")
        || ["designer-control-adapter-image", "generated-control-adapter-image"].includes(name);
    return { kind: "template", stack: [{ active: true,
        sourceId: stock ? "extension-canvas-design" : "copilot-logo-gallery-test",
        layer: stock ? "extension" : "preset", strategy: "replace" }] };
}

test("stock scalar definitions mount required fields and reject incomplete visual adapters", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const fields = await stockTemplates(project);
    const scalar = scalarFixtures.get(project);
    const verify = () => ({ kind: "template", stack: [{ active: true,
        sourceId: "extension-canvas-design", layer: "extension", strategy: "replace" }] });
    const model = await loadResolvedDesignerPages(handoff, project, entries, fields);
    assert.equal(model.pages[0].fields[0].control, "stock.text");
    assert.equal(model.pages[0].fields[1].control, "stock.text");
    assert.equal(model.adapters["stock.text"], "designer-control-adapter-text");
    assert.equal(model.adapters["stock.checkbox"], "designer-control-adapter-checkbox");
    const textControlFile = scalar.find((item) => item.name === "shared-controls-text").path;
    const originalTextControl = await readFile(textControlFile, "utf8");
    await writeFile(textControlFile, JSON.stringify({
        ...JSON.parse(originalTextControl), id: "custom-text",
    }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /invalid shared control value contract or adapter references/);
    await writeFile(textControlFile, originalTextControl);
    const workflowFile = scalar.find((item) => item.name === "generated-workflow").path;
    const originalWorkflow = await readFile(workflowFile, "utf8");
    const reordered = JSON.parse(originalWorkflow);
    reordered.slots.push({ id: "workflow.extra" });
    await writeFile(workflowFile, JSON.stringify(reordered));
    const changedLayout = await loadResolvedDesignerPages(handoff, project, entries, fields);
    assert.deepEqual(changedLayout.workflowPage.slots, reordered.slots);
    reordered.slots[1] = reordered.slots[0];
    await writeFile(workflowFile, JSON.stringify(reordered));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /invalid Workflow page definition/);
    await writeFile(workflowFile, originalWorkflow);
    const controlFile = scalar.find((item) => item.name === "generated-phase-control").path;
    const originalControl = await readFile(controlFile, "utf8");
    const changedControl = JSON.parse(originalControl);
    changedControl.adapter = "missing-adapter";
    await writeFile(controlFile, JSON.stringify(changedControl));
    const incompatible = await loadResolvedDesignerPages(handoff, project, entries, fields);
    assert.match(incompatible.compositionErrors.join(" "), /missing or unreferenced phase control adapter missing-adapter/);
    changedControl.adapter = "generated-phase-adapter";
    changedControl.id = "wrong-id";
    await writeFile(controlFile, JSON.stringify(changedControl));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /invalid phase control definition/);
    changedControl.id = "workflow-phases";
    changedControl.placement.slot = "workflow.unknown";
    await writeFile(controlFile, JSON.stringify(changedControl));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /invalid phase control definition/);
    changedControl.placement.slot = "workflow.phases";
    changedControl.viewLabels = { plan: "View Plan" };
    await writeFile(controlFile, JSON.stringify(changedControl));
    assert.deepEqual((await loadResolvedDesignerPages(handoff, project, entries, fields))
        .templates.find((item) => item.name === "generated-phase-control").name, "generated-phase-control");
    changedControl.viewLabels = { plan: " " };
    await writeFile(controlFile, JSON.stringify(changedControl));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /invalid phase control definition/);
    changedControl.viewLabels = { plan: "View Plan" };
    changedControl.adapter = "custom-phase-adapter";
    await writeFile(controlFile, JSON.stringify(changedControl));
    const adapterFile = scalar.find((item) => item.name === "generated-phase-adapter").path;
    const customAdapterPath = join(dirname(adapterFile), "custom-phase-adapter.mjs");
    await copyFile(adapterFile, customAdapterPath);
    scalar.push({ ...scalar.find((item) => item.name === "generated-phase-adapter"),
        name: "custom-phase-adapter", path: customAdapterPath });
    assert.ok((await loadResolvedDesignerPages(handoff, project, entries, fields))
        .templates.some((item) => item.name === "custom-phase-adapter"));
    scalar.pop();
    await writeFile(controlFile, originalControl);
    const originalAdapter = await readFile(adapterFile, "utf8");
    await writeFile(adapterFile, "export function other() {}");
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /missing mount export/);
    await writeFile(adapterFile, originalAdapter);
    assert.equal((await loadResolvedDesignerPages(handoff, project, entries, fields)).workflowPage.managedRun, false);
    await writeFile(adapterFile, `export const controlId = "workflow-phases";
export const contractVersion = 1;
const regex = /\`/;
const example = \`
export const requiredCapabilities = ['workflow.managed-run.v1'];
\`;
export function mount() {}`);
    assert.equal((await loadResolvedDesignerPages(handoff, project, entries, fields)).workflowPage.managedRun, false);
    await writeFile(controlFile, JSON.stringify({ ...JSON.parse(originalControl), managedRun: true }));
    assert.equal((await loadResolvedDesignerPages(handoff, project, entries, fields)).workflowPage.managedRun, true);
    await writeFile(controlFile, JSON.stringify({ ...JSON.parse(originalControl), managedRun: "true" }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /invalid phase control definition/);
    await writeFile(controlFile, originalControl);
    await writeFile(adapterFile, originalAdapter);
    const missingControls = await loadFixturePages(handoff, project, entries,
        scalar.filter((item) => item.kind === "generated.workflow-page-definition"
            || item.kind === "generated.workflow-page-adapter"
            || item.kind === "generated.phase-control-definition"
            || item.kind === "generated.phase-control-adapter"), verify);
    assert.match(missingControls.compositionErrors.join(" "), /missing shared control definition for canvas.id/);
    assert.deepEqual(missingControls.pages.map((page) => page.page), entries.map((entry) => entry.name));
    const missingGeneratedAdapter = await loadFixturePages(handoff, project, entries,
        [...fields, ...scalar.filter((item) => item.name !== "generated-control-adapter-text")],
        verify);
    assert.match(missingGeneratedAdapter.compositionErrors.join(" "),
        /missing generated adapter generated-control-adapter-text/);
    const original = await readFile(fields[0].path, "utf8");
    const changed = JSON.parse(original);
    changed.requires = ["shared-controls-text"];
    await writeFile(fields[0].path, JSON.stringify(changed));
    assert.equal((await loadResolvedDesignerPages(handoff, project, entries, fields))
        .contributions[0].requires[0], "shared-controls-text");
    changed.requires = ["shared-controls-checkbox"];
    await writeFile(fields[0].path, JSON.stringify(changed));
    const incompatibleControl = await loadResolvedDesignerPages(handoff, project, entries, fields);
    assert.match(incompatibleControl.compositionErrors.join(" "),
        /missing or incompatible shared control definition stock.text/);
    assert.ok(!incompatibleControl.contributions.some((item) => item.name === fields[0].name));
    await writeFile(fields[0].path, original);
    await writeFile(fields[0].path, JSON.stringify({ ...JSON.parse(original),
        generatedBinding: { presentation: "text", slot: "workflow.heading" } }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, fields),
        /incompatible generated binding/);
    await writeFile(fields[0].path, original);
    const setup = JSON.parse(await readFile(entries[0].path, "utf8"));
    setup.fields[0].control = "stock.checkbox";
    await writeFile(entries[0].path, JSON.stringify(setup));
    const invalid = await loadResolvedDesignerPages(handoff, project, entries);
    assert.match(invalid.pages[0].error.reason, /required fixed Designer control/);
});

test("preset field placements resolve into Workflow and added-page slots", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const fields = await stockTemplates(project);
    const workflow = scalarFixtures.get(project).find((item) => item.name === "generated-workflow").path;
    const page = JSON.parse(await readFile(workflow, "utf8"));
    page.slots.push({ id: "workflow.extra" });
    await writeFile(workflow, JSON.stringify(page));
    const folder = join(project, ".specify", "presets", "placement-fixture");
    await mkdir(folder, { recursive: true });
    const extra = async (name, kind, contents, extension = "json") => {
        const path = join(folder, `${name}.${extension}`);
        await writeFile(path, typeof contents === "string" ? contents : JSON.stringify(contents));
        return { name, path, kind, strategy: "replace", sourceId: "placement-fixture" };
    };
    const risk = new URL("../../../../../tests/fixtures/test-presets/copilot-risk-matrix-test/controls/risk-matrix/",
        import.meta.url);
    const riskSchema = { type: "object", properties: {
        impact: ["low", "medium", "high"], likelihood: ["low", "medium", "high"],
    } };
    const templates = [...fields,
        await extra("billing-view", "generated.added-page-definition", {
            schemaVersion: 1, id: "billing-view", title: "Billing", order: 20,
            renderer: "billing-renderer", slots: [{ id: "workflow.actions" }],
        }),
        await extra("billing-renderer", "generated.added-page-renderer",
            'export function renderPage({root}) { root.innerHTML = \'<div data-field-slot="workflow.actions"></div>\'; }',
            "mjs"),
        await extra("workflow-description", "generated.field-placement", {
            schemaVersion: 1, id: "workflow-description", page: "workflow",
            slot: "workflow.extra", field: "canvas.description", order: 10,
        }),
        await extra("billing-description", "generated.field-placement", {
            schemaVersion: 1, id: "billing-description", page: "billing-view",
            slot: "workflow.actions", field: "canvas.description", order: 10,
        }),
        await extra("canvas-control-risk-matrix", "shared.control-definition",
            await readFile(new URL("control.json", risk), "utf8")),
        await extra("canvas-control-risk-matrix-designer", "designer.control-adapter",
            await readFile(new URL("designer.mjs", risk), "utf8"), "mjs"),
        await extra("canvas-control-risk-matrix-generated", "generated.control-adapter",
            await readFile(new URL("generated.mjs", risk), "utf8"), "mjs"),
        ...await Promise.all(["risk.first", "risk.second"].map((id) => extra(
            `value-${id.replace(".", "-")}`, "generated.value-definition", {
                schemaVersion: 1, id, label: id, schema: riskSchema,
                source: { kind: "constant", value: { impact: "low", likelihood: "high" } },
                presentation: id === "risk.first" ? "stock.editable" : "stock.readonly",
            }))),
        ...await Promise.all(["risk.first", "risk.second"].map((id, order) => extra(
            `placement-${id.replace(".", "-")}`, "generated.field-placement", {
                schemaVersion: 1, id: `placement-${id.replace(".", "-")}`,
                page: "workflow", slot: "workflow.extra", field: id,
                order: order + 20, control: "risk-matrix",
            }))),
    ];
    const registration = () => ({ kind: "template", stack: [{
        active: true, sourceId: "placement-fixture", layer: "preset", strategy: "replace",
    }] });
    const model = await loadResolvedDesignerPages(handoff, project, entries, templates, registration);
    assert.equal(model.fieldPlacements.find((item) => item.page === "billing-view").slot,
        "workflow.actions");
    assert.deepEqual(model.fieldPlacements.map(({ page: id, field }) => [id, field]),
        [["billing-view", "canvas.description"], ["workflow", "canvas.description"],
            ["workflow", "risk.first"], ["workflow", "risk.second"]]);
    const billingPlacement = templates.find((item) => item.name === "billing-description");
    const billingDocument = JSON.parse(await readFile(billingPlacement.path, "utf8"));
    for (const [change, expected] of [
        [{ page: "missing-page" }, /unknown generated page slot missing-page.workflow.actions/],
        [{ slot: "missing.slot" }, /unknown generated page slot billing-view.missing.slot/],
        [{ field: "missing.field" }, /missing generated field missing.field/],
    ]) {
        await writeFile(billingPlacement.path, JSON.stringify({ ...billingDocument, ...change }));
        const partial = await loadResolvedDesignerPages(handoff, project, entries, templates, registration);
        assert.match(partial.compositionErrors.join(" "), expected);
        assert.equal(partial.fieldPlacements.length, 3);
        assert.ok(generationBlockers(partial).length);
        await assert.rejects(freezeGeneration({ model: partial, values: partial.values,
            handoff, project, workspace }), /Cannot generate|incomplete|missing|blocked/i);
    }
    await writeFile(billingPlacement.path, JSON.stringify(billingDocument));
    const withoutControl = await loadResolvedDesignerPages(handoff, project, entries,
        templates.filter((item) => !item.name.startsWith("canvas-control-risk-matrix")), registration);
    assert.match(withoutControl.compositionErrors.join(" "),
        /missing or incompatible shared generated control risk-matrix/);
    assert.deepEqual(withoutControl.fieldPlacements.map(({ field }) => field),
        ["canvas.description", "canvas.description"]);
    assert.ok(generationBlockers(withoutControl).length);
    const values = { ...model.values, "canvas.id": "placed-canvas",
        "canvas.displayName": "Placed Canvas", "canvas.description": "One shared value" };
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, prepared.target, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.fieldPlacements.filter((item) => item.field === "canvas.description")
        .map(({ page: id, field, value }) => [id, field, value]),
    [["billing-view", "canvas.description", "One shared value"],
        ["workflow", "canvas.description", "One shared value"]]);
    assert.equal(config.fieldPlacements.filter((item) => item.adapter === "canvas-control-risk-matrix-generated")
        .length, 2);
    const portable = join(workspace, "portable-canvas");
    await cp(join(project, prepared.target), portable, { recursive: true });
    await rm(folder, { recursive: true });
    const { readConfig: readPortable } = await import(pathToFileURL(join(portable, "server.mjs")).href);
    assert.equal(readPortable().fieldPlacements.length, 4);
    await writeFile(join(portable, "controls", "canvas-control-risk-matrix-generated.mjs"),
        "export function mount() {}");
    assert.throws(readPortable, /Packaged placement control/);
});

test("custom text requiredness is field-specific at Generate while Save keeps drafts", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const setup = JSON.parse(await readFile(entries[0].path, "utf8"));
    setup.fields.push({ id: "billing.reference", label: "Reference", type: "string",
        control: "stock.text", required: true });
    await writeFile(entries[0].path, JSON.stringify(setup));
    const templates = await stockTemplates(project);
    const contribution = JSON.parse(await readFile(templates[0].path, "utf8"));
    contribution.field.required = true;
    await writeFile(templates[0].path, JSON.stringify(contribution));
    const model = await loadResolvedDesignerPages(handoff, project, entries, templates);
    assert.equal(model.constraints["billing.reference"].required, true);
    assert.equal(model.constraints["canvas.description"].required, true);
    assert.equal(model.constraints["canvas.workflowListName"].required, undefined);
    const values = { ...model.values, "canvas.id": "required-canvas",
        "canvas.displayName": "Required Canvas", "billing.reference": "   ",
        "canvas.description": "Description" };
    validateValues(values, model.constraints);
    const incomplete = await saveDesignerSettings(workspace, handoff, model, {
        modelRevision: model.revision, revision: 0, values,
    });
    assert.equal((await loadDesignerSettings(workspace, handoff, model)).values["billing.reference"], "   ");
    assert.equal(incomplete.settingsRevision, 1);
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /Invalid Reference \(billing.reference\)/);
    values["billing.reference"] = "REF-42";
    values["canvas.description"] = "  ";
    validateValues(values, model.constraints);
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /Invalid Description \(canvas.description\)/);
    values["canvas.description"] = "Description";
    values["canvas.displayName"] = "  ";
    validateValues(values, model.constraints);
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /Canvas ID and Title must be valid/);
    values["canvas.displayName"] = "Required Canvas";
    validateValues(values, model.constraints);
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    const frozen = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.equal(frozen.fieldConstraints["billing.reference"].required, true);
    assert.equal(frozen.fieldConstraints["canvas.description"].required, true);
    await saveDesignerSettings(workspace, handoff, model, {
        modelRevision: model.revision, revision: 1, values,
    });
    const optional = { ...values, "canvas.workflowListName": "" };
    validateValues(optional, model.constraints);
    contribution.field.required = false;
    await writeFile(templates[0].path, JSON.stringify(contribution));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, templates),
        /incompatible field or control definition/);
    setup.fields[2].required = false;
    await writeFile(entries[0].path, JSON.stringify(setup));
    const invalidPage = await loadResolvedDesignerPages(handoff, project, entries);
    assert.match(invalidPage.pages[0].error.reason, /designer-essentials/);
});

test("Generate uses approved adapter validation and still guards extension paths", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const adapter = scalarFixtures.get(project).find((item) =>
        item.name === "designer-control-adapter-text");
    const original = await readFile(adapter.path, "utf8");
    const templates = await stockTemplates(project);
    const load = () => loadResolvedDesignerPages(handoff, project, entries, templates);
    const values = { ...(await load()).values, "canvas.id": "valid-canvas",
        "canvas.displayName": "Valid Canvas", "canvas.description": "Description" };
    const replaceValidator = async (body) => {
        await writeFile(adapter.path, original.replace(
            "export function validate(value, field) {",
            `export function validate(value, field) { ${body}`));
        return load();
    };
    let model = await replaceValidator("return false;");
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /Invalid Description \(canvas.description\)/);
    model = await replaceValidator('throw new Error("validator broke");');
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /Description \(canvas.description\) validator failed: validator broke/);
    model = await replaceValidator('return "yes";');
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /Description \(canvas.description\) validator must return a boolean/);
    model = await replaceValidator("return true;");
    await assert.rejects(freezeGeneration({ model, values: { ...values, "canvas.id": "../escape" },
        handoff, project, workspace }), /Invalid Designer setting: canvas.id/);
    await writeFile(adapter.path, original.replace("export function validate(", "function validate("));
    await assert.rejects(load(), /Designer adapter is missing validate export/);
});

test("stock image requires one compatible control definition and paired self-contained adapters", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/",
        import.meta.url));
    const fieldPath = join(project, ".specify", "extensions", "extension-canvas-design",
        "designer", "essentials-settings", "header-logo.json");
    await mkdir(dirname(fieldPath), { recursive: true });
    await copyFile(join(source, "designer-host", "essentials-settings", "header-logo.json"), fieldPath);
    const fields = [{ name: "designer-essentials-header-logo", path: fieldPath,
        sourceId: "extension:extension-canvas-design", kind: "designer.setting-definition", strategy: "replace" }];
    const adapters = await stockImageTemplates(project);
    const templates = [...fields, ...adapters];
    const load = (items = templates) => loadResolvedDesignerPages(handoff, project, entries,
        items, stockImageRegistration);
    const model = await load();
    assert.equal(model.adapters["stock.image"], "designer-control-adapter-image");
    assert.equal(model.pages.find((page) => page.page === "designer-appearance")
        .fields.find((field) => field.id === "canvas.logo").control, "stock.image");
    assert.deepEqual(model.constraints["canvas.logo"].mimeTypes,
        ["image/png", "image/jpeg", "image/gif", "image/webp"]);
    const missingImageControl = await load(fields);
    assert.match(missingImageControl.compositionErrors.join(" "),
        /missing or incompatible shared control definition stock.image/);
    assert.ok(!missingImageControl.values["canvas.logo"]);
    for (const kind of ["designer.control-adapter", "generated.control-adapter"]) {
        const missingAdapter = await load(templates.filter((item) => item.kind !== kind));
        assert.match(missingAdapter.compositionErrors.join(" "),
            new RegExp(`missing ${kind.split(".")[0]} adapter`));
    }
    const originalField = await readFile(fieldPath, "utf8");
    await writeFile(fieldPath, JSON.stringify({ ...JSON.parse(originalField),
        requires: ["canvas-stock-image"] }));
    assert.match((await load()).compositionErrors.join(" "),
        /missing or incompatible shared control definition stock.image/);
    await writeFile(fieldPath, JSON.stringify({ ...JSON.parse(originalField),
        requires: ["shared-controls-image"] }));
    assert.equal((await load()).contributions[0].requires[0], "shared-controls-image");
    await writeFile(fieldPath, JSON.stringify({ ...JSON.parse(originalField),
        requires: ["shared-controls-text"] }));
    assert.match((await load()).compositionErrors.join(" "),
        /missing or incompatible shared control definition stock.image/);
    await writeFile(fieldPath, originalField);
    const control = adapters[0];
    const originalControl = await readFile(control.path, "utf8");
    const duplicate = { ...control, name: "shared-controls-image-copy",
        path: join(project, ".specify", "extensions", "extension-canvas-design",
            "shared-controls", "stock-image", "copy.json") };
    await copyFile(control.path, duplicate.path);
    await assert.rejects(load([...templates, duplicate]),
        /unreferenced or duplicate control definition/);
    await writeFile(control.path, JSON.stringify({ ...JSON.parse(originalControl),
        value: { type: "image", maxBytes: 65536, mimeTypes: ["image/png"] } }));
    await assert.rejects(load(), /invalid shared control value contract/);
    await writeFile(control.path, originalControl);
    const designer = adapters[1];
    const originalDesigner = await readFile(designer.path, "utf8");
    await writeFile(designer.path, 'import "elsewhere"; export function mount() {}');
    await assert.rejects(load(), /must be self-contained/);
    await writeFile(designer.path, originalDesigner);
    await assert.rejects(load(templates.map((entry) => entry.name === designer.name
        ? { ...entry, strategy: "append" } : entry)), /Invalid or duplicate Canvas Design template/);
});

test("stock contributions retain the optional slug setting and minimal replaced Essentials generate defaults", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.workflow.installLocators = { presets: [], extensions: [], bundles: [] };
    handoff.workflow.runtimeSetup = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const templates = await stockTemplates(project);
    const full = await loadResolvedDesignerPages(handoff, project, entries, templates);
    assert.equal(full.pages[0].description, "Configure settings for your generated canvas app.");
    assert.deepEqual(full.pages[0].fields.map(({ id, label }) => [id, label]), [
        ["canvas.id", "Canvas ID"], ["canvas.displayName", "Title"],
        ["canvas.description", "Description"], ["canvas.workflowListName", "Header text"],
        ["canvas.workflowItemName", "Workflow item name"],
        ["workflowSlug.userProvided", "Allow custom artifact directory slug"],
    ]);
    const essentials = new Map(full.pages[0].fields.map(({ id, description }) => [id, description]));
    assert.ok([...essentials.values()].every((description) => typeof description === "string"
        && description.trim()), "Every Essentials field has help text from its JSON definition");
    assert.match(essentials.get("canvas.id"), /Windows device names like con and com1/);
    assert.match(essentials.get("canvas.displayName"), /1–120 characters/);
    assert.match(essentials.get("canvas.description"), /240 characters/);
    assert.equal(essentials.get("canvas.workflowListName"),
        "The main header displayed below the canvas title. Leave blank to use ‘Workflows.’");
    assert.equal(essentials.get("canvas.workflowItemName"),
        "The name for one workflow item, used in buttons, labels, and default names. Use the singular form. Leave blank to use ‘Workflow.’");
    assert.equal(full.values["workflowSlug.userProvided"], false);
    const values = { ...full.values, "canvas.id": "stock-canvas",
        "canvas.displayName": "Stock Canvas", "canvas.description": "Stock description",
        "canvas.workflowListName": "Stock heading", "canvas.workflowItemName": "Issue",
        "workflowSlug.userProvided": true };
    await assert.rejects(freezeGeneration({ model: full, values, project, workspace,
        handoff: { ...handoff, workflow: { ...handoff.workflow, installed: {
            ...handoff.workflow.installed, presets: [{ id: "local-runtime", source: "local",
                version: "1.0.0", priority: 1, enabled: true }],
        } } } }), /local presets local-runtime has no verified path/);
    const saved = await saveDesignerSettings(workspace, handoff, full,
        { revision: 0, modelRevision: full.revision, values });
    assert.deepEqual((await loadDesignerSettings(workspace, handoff, saved)).values, values);
    const prepared = await freezeGeneration({ model: saved, values, handoff, project, workspace });
    const phaseRequest = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.deepEqual(phaseRequest.runtimeSetup, handoff.workflow.runtimeSetup);
    const { integrity, ...unsignedRequest } = phaseRequest;
    assert.equal(integrity, createHash("sha256").update(JSON.stringify(unsignedRequest)).digest("hex"));
    assert.deepEqual(Object.keys(phaseRequest.workflowPage).sort(),
        ["assets", "id", "managedRun", "order", "slots", "title"]);
    assert.equal(phaseRequest.workflowPage.managedRun, false);
    assert.equal(phaseRequest.workflowPage.id, "workflow");
    assert.equal(phaseRequest.phasePlacement, undefined);
    assert.deepEqual(JSON.parse(Buffer.from(phaseRequest.workflowPage.assets[1].content, "base64")).placement,
        { page: "workflow", slot: "workflow.phases" });
    assert.deepEqual(phaseRequest.workflowPage.assets.map(({ name, kind }) => [name, kind]), [
        ["generated-workflow", "generated.workflow-page-definition"],
        ["generated-phase-control", "generated.phase-control-definition"],
        ["generated-phase-adapter", "generated.phase-control-adapter"],
        ["generated-workflow-page-adapter", "generated.workflow-page-adapter"],
    ]);
    for (const asset of phaseRequest.workflowPage.assets) {
        assert.deepEqual(Object.keys(asset).sort(), ["content", "hash", "kind", "name", "sourceId"]);
        assert.equal(createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex"),
            asset.hash);
    }
    const { materialize } = await import(new URL("../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs",
        import.meta.url));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const config = JSON.parse(await readFile(join(project, prepared.target, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.canvas, { id: "stock-canvas", displayName: "Stock Canvas",
        description: "Stock description", workflowListName: "Stock heading", workflowItemName: "Issue" });
    assert.equal(config.userProvidesSlug, true);
    assert.equal(phaseRequest.values["workflowSlug.userProvided"], true);

    for (const [id, description, heading, itemName, expectedDescription, expectedHeading, expectedItem] of [
        ["blank-stock", "   ", "  ", "  ", "Spec Kit workflow canvas.", "Workflows", "Workflow"],
        ["padded-stock", "  About this canvas  ", "  My workflows  ", "  Bug  ",
            "About this canvas", "My workflows", "Bug"],
    ]) {
        const stockValues = { ...values, "canvas.id": id, "canvas.description": description,
            "canvas.workflowListName": heading, "canvas.workflowItemName": itemName };
        const frozen = await freezeGeneration({ model: saved, values: stockValues,
            handoff, project, workspace });
        const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
            "handoffs", handoff.handoffId, "generations", frozen.requestId, "request.json"), "utf8"));
        assert.equal(request.values["canvas.description"], description.trim());
        assert.equal(request.values["canvas.workflowListName"], heading.trim());
        assert.equal(request.values["canvas.workflowItemName"], itemName.trim());
        assert.equal(request.canvas.description, expectedDescription);
        assert.equal(request.canvas.workflowListName, expectedHeading);
        assert.equal(request.canvas.workflowItemName, expectedItem);
        await materialize(project, workspace, handoff.handoffId, frozen.requestId);
        const output = JSON.parse(await readFile(join(project, frozen.target, "canvas-config.json"), "utf8"));
        assert.equal(output.canvas.description, expectedDescription);
        assert.equal(output.canvas.workflowListName, expectedHeading);
        assert.equal(output.canvas.workflowItemName, expectedItem);
    }
    for (const invalid of ["x".repeat(81), "Bug\nReport"]) {
        await assert.rejects(freezeGeneration({ model: saved,
            values: { ...values, "canvas.workflowItemName": invalid }, handoff, project, workspace }),
        /Invalid Workflow item name \(canvas.workflowItemName\)/);
    }

    const legacy = await loadResolvedDesignerPages(handoff, project, entries,
        templates.filter((item) => item.name !== "designer-essentials-workflow-item-name"));
    const legacyWorkspace = join(workspace, "legacy-settings");
    await mkdir(legacyWorkspace);
    await saveHandoff(legacyWorkspace, handoff);
    const legacyValues = { ...legacy.values, "canvas.id": "legacy-naming",
        "canvas.displayName": "Legacy", "canvas.workflowListName": "Existing heading" };
    const legacySaved = await saveDesignerSettings(legacyWorkspace, handoff, legacy,
        { revision: 0, modelRevision: legacy.revision, values: legacyValues });
    const legacyReopened = await loadDesignerSettings(legacyWorkspace, handoff, legacy);
    assert.equal(legacyReopened.values["canvas.workflowListName"], "Existing heading");
    assert.equal(Object.hasOwn(legacyReopened.values, "canvas.workflowItemName"), false);
    await assert.rejects(loadDesignerSettings(legacyWorkspace, handoff, full),
        /Saved Designer settings do not match the current handoff or pages/);
    const fresh = await freshDesignerSettings(legacyWorkspace, handoff, full);
    assert.equal(fresh.settingsRevision, legacySaved.settingsRevision);
    assert.equal(fresh.values["canvas.workflowListName"], full.values["canvas.workflowListName"]);
    assert.equal((await loadDesignerSettings(legacyWorkspace, handoff, legacy))
        .values["canvas.workflowListName"], "Existing heading");
    const legacyRequest = await freezeGeneration({ model: legacySaved, values: legacyReopened.values,
        handoff, project, workspace: legacyWorkspace });
    await materialize(project, legacyWorkspace, handoff.handoffId, legacyRequest.requestId);
    const legacyConfig = JSON.parse(await readFile(join(project, legacyRequest.target, "canvas-config.json"), "utf8"));
    assert.equal(legacyConfig.canvas.workflowListName, "Existing heading");
    assert.equal(legacyConfig.canvas.workflowItemName, "Workflow");

    const minimal = await loadResolvedDesignerPages(handoff, project, entries);
    assert.deepEqual(minimal.pages[0].fields.map((field) => field.id),
        ["canvas.id", "canvas.displayName"]);
    const minimum = { ...minimal.values, "canvas.id": "minimal-canvas",
        "canvas.displayName": "Minimal Canvas" };
    const next = await freezeGeneration({ model: minimal, values: minimum, handoff, project, workspace });
    await materialize(project, workspace, handoff.handoffId, next.requestId);
    const defaults = JSON.parse(await readFile(join(project, next.target, "canvas-config.json"), "utf8"));
    assert.equal(defaults.canvas.description, "Spec Kit workflow canvas.");
    assert.equal(defaults.canvas.workflowListName, "Workflows");
    assert.equal(defaults.canvas.workflowItemName, "Workflow");
    assert.equal(defaults.userProvidesSlug, false);
    const { renderHtml } = await import(new URL("../../../../../spec-kit-extensions/extension-canvas-design/generated-scaffold/server.mjs",
        import.meta.url));
    const defaultHtml = renderHtml(defaults);
    assert.match(defaultHtml, /Workflows/);
    assert.match(defaultHtml, /Spec Kit workflow canvas\./);
    assert.match(stockMarkup(defaults), /id="workflow-slug"[^>]+maxlength="100"/);
    assert.equal(await readFile(join(project, next.target, "ui", "runtime.css"), "utf8"),
        await readFile(join(project, prepared.target, "ui", "runtime.css"), "utf8"));
    const originalPages = await Promise.all(entries.slice(0, 2)
        .map((entry) => readFile(entry.path, "utf8")));
    for (const [index, contents] of originalPages.entries()) {
        const page = JSON.parse(contents);
        delete page.fixedControl;
        await writeFile(entries[index].path, JSON.stringify(page));
    }
    const legacyPages = await loadResolvedDesignerPages(handoff, project, entries);
    assert.equal(legacyPages.pages[0].fixedControl, "designer.identity");
    assert.equal(legacyPages.pages[1].fixedControl, "designer.badges");
    assert.equal(legacyPages.pages.find((page) => page.page === "designer-badges")
        .fixedControl, "designer.badges");
    for (const [index, contents] of originalPages.entries()) {
        await writeFile(entries[index].path, contents);
    }
    const withoutSlug = await loadResolvedDesignerPages(handoff, project, entries, templates.slice(0, 2));
    assert.equal(Object.hasOwn(withoutSlug.values, "workflowSlug.userProvided"), false);
    await writeFile(templates[0].path, JSON.stringify({
        ...JSON.parse(await readFile(templates[0].path, "utf8")),
        field: { id: "canvas.id", type: "string", label: "Conflicting ID", control: "stock.text" },
        generatedBinding: undefined,
    }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, templates),
        /designer-essentials-description: duplicate field canvas.id also defined by designer-essentials/);
    for (const id of ["speckit-wizard", "speckit-canvas-designer", "speckit-canvas-generator"]) {
        await assert.rejects(freezeGeneration({ model: minimal,
            values: { ...minimum, "canvas.id": id }, handoff, project, workspace }), /Canvas ID \(canvas.id\)/);
    }
    await assert.rejects(freezeGeneration({ model: minimal,
        values: { ...minimum, "canvas.displayName": " " }, handoff, project, workspace }),
    /Canvas ID and Title must be valid/);
    const broken = JSON.parse(await readFile(entries[1].path, "utf8"));
    broken.fixedControl = "designer.identity";
    await writeFile(entries[1].path, JSON.stringify(broken));
    const incomplete = await loadResolvedDesignerPages(handoff, project, entries);
    assert.match(incomplete.pages[1].error.reason, /required fixed Designer control/);
    await assert.rejects(freezeGeneration({ model: incomplete,
        values: { ...incomplete.values, ...minimum },
        handoff, project, workspace }),
    /Cannot generate: designer-badges:/);
    await writeFile(entries[1].path, "{invalid");
    const invalid = await loadResolvedDesignerPages(handoff, project, entries);
    assert.ok(invalid.pages[1].error);
    await assert.rejects(freezeGeneration({ model: invalid, values: minimum,
        handoff, project, workspace }), /Cannot generate: designer-badges:/);
    const replaced = JSON.parse(await readFile(entries[0].path, "utf8"));
    replaced.fields = [{ id: "canvas.id", label: "ID" }];
    await writeFile(entries[0].path, JSON.stringify(replaced));
    const missingIdentity = await loadResolvedDesignerPages(handoff, project, entries);
    await assert.rejects(freezeGeneration({ model: missingIdentity,
        values: { ...missingIdentity.values, "canvas.id": "other" },
        handoff, project, workspace }), /Essentials must contain Canvas ID and Title/);
});

test("Appearance palette colors persist and style both runtime themes without replacing defaults", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/",
        import.meta.url));
    const folder = join(project, ".specify", "extensions", "extension-canvas-design",
        "designer-host", "appearance-settings");
    await mkdir(folder, { recursive: true });
    const templates = [];
    for (const mode of ["light", "dark"]) {
        for (const color of ["accent", "background", "surface", "secondary", "text"]) {
            const filename = `${mode}-${color}.json`;
            const path = join(folder, filename);
            await copyFile(join(source, "designer-host", "appearance-settings", filename), path);
            templates.push({ name: `designer-appearance-${mode}-${color}`, path,
                sourceId: "extension:extension-canvas-design",
                kind: "designer.setting-definition", strategy: "replace" });
        }
    }
    const imageFolder = join(project, ".specify", "extensions", "extension-canvas-design",
        "designer-host", "essentials-settings");
    await mkdir(imageFolder, { recursive: true });
    for (const name of ["header-logo", "main-page-logo"]) {
        const path = join(imageFolder, `${name}.json`);
        await copyFile(join(source, "designer-host", "essentials-settings", `${name}.json`), path);
        templates.push({ name: `designer-essentials-${name}`, path,
            sourceId: "extension:extension-canvas-design",
            kind: "designer.setting-definition", strategy: "replace" });
    }
    const model = await loadResolvedDesignerPages(handoff, project, entries,
        [...templates, ...await stockImageTemplates(project)],
        () => ({ kind: "template", stack: [{ active: true,
            sourceId: "extension-canvas-design", layer: "extension", strategy: "replace" }] }));
    assert.deepEqual(model.pages.find((page) => page.page === "designer-appearance")
        .fields.map((field) => field.id),
        ["canvas.logo", "canvas.mainPageLogo",
            "canvas.accentLight", "canvas.backgroundLight", "canvas.surfaceLight",
            "canvas.secondaryLight", "canvas.textLight",
            "canvas.accentDark", "canvas.backgroundDark", "canvas.surfaceDark",
            "canvas.secondaryDark", "canvas.textDark"]);
    assert.deepEqual(model.pages.find((page) => page.page === "designer-essentials")
        .fields.map((field) => field.id), ["canvas.id", "canvas.displayName"]);
    assert.equal(model.values["canvas.accentLight"], "");
    assert.equal(model.values["canvas.accentDark"], "");
    const values = { ...model.values, "canvas.id": "colored-canvas",
        "canvas.displayName": "Colored canvas", "canvas.accentLight": "123aBc",
        "canvas.backgroundLight": "E8F8E9", "canvas.surfaceLight": "#F7FFF0",
        "canvas.secondaryLight": "CCF0D0", "canvas.textLight": "#233044",
        "canvas.accentDark": "#ABC123", "canvas.backgroundDark": "#11142A",
        "canvas.surfaceDark": "252942", "canvas.secondaryDark": "#303550",
        "canvas.textDark": "F8ECDB" };
    const saved = await saveDesignerSettings(workspace, handoff, model,
        { modelRevision: model.revision, revision: 0, values });
    assert.deepEqual((await loadDesignerSettings(workspace, handoff, model)).values, values);
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs",
        import.meta.url));
    const prepared = await freezeGeneration({ model: saved, values, handoff, project, workspace });
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const target = join(project, prepared.target);
    const config = JSON.parse(await readFile(join(target, "canvas-config.json"), "utf8"));
    assert.deepEqual(config.appearance, {
        light: { accent: "#123aBc", background: "#E8F8E9", surface: "#F7FFF0",
            secondary: "#CCF0D0", text: "#233044" },
        dark: { accent: "#ABC123", background: "#11142A", surface: "#252942",
            secondary: "#303550", text: "#F8ECDB" },
    });
    const { renderHtml, readConfig } = await import(pathToFileURL(join(target, "server.mjs")).href);
    const html = renderHtml(config);
    assert.match(html, /:root\[data-theme="light"\] \{ --accent-color: #123aBc;/);
    assert.match(html, /:root\[data-theme="dark"\] \{ --accent-color: #ABC123;/);
    assert.match(html, /--background-color-default: #E8F8E9; --background-color-elevated: #F7FFF0; --background-color-secondary: #CCF0D0; --text-color-default: #233044;/);
    assert.match(html, /--background-color-default: #11142A; --background-color-elevated: #252942; --background-color-secondary: #303550; --text-color-default: #F8ECDB;/);
    assert.match(html, /@media \(prefers-color-scheme: dark\).*:root:not\(\[data-theme\]\)/);
    assert.match(html, /id="theme-toggle"/);
    assert.deepEqual(readConfig().appearance, config.appearance);
    const opposite = { ...values, "canvas.id": "opposite-accent",
        "canvas.accentLight": "#123aBc", "canvas.accentDark": "ABC123" };
    const alternate = await freezeGeneration({ model, values: opposite, handoff, project, workspace });
    await materialize(project, workspace, handoff.handoffId, alternate.requestId);
    const alternateConfig = JSON.parse(await readFile(
        join(project, alternate.target, "canvas-config.json"), "utf8"));
    assert.deepEqual(alternateConfig.appearance, config.appearance);
    assert.match(renderHtml(alternateConfig), /:root\[data-theme="dark"\] \{ --accent-color: #ABC123;/);
    await writeFile(join(target, "canvas-config.json"), JSON.stringify({
        ...config, appearance: { light: { background: "red" } },
    }));
    assert.throws(() => readConfig(), /Invalid generated canvas configuration/);
    assert.doesNotMatch(renderHtml({ ...config, appearance: { light: { accent: "#123aBc" } } }),
        /:root\[data-theme="dark"\] \{ --accent-color:/);
    assert.match(renderHtml({ ...config, appearance: { light: "#123aBc" } }),
        /:root\[data-theme="light"\] \{ --accent-color: #123aBc;/);
    const backgroundOnly = renderHtml({ ...config, appearance: { light: { background: "#E8F8E9" } } });
    assert.match(backgroundOnly, /:root\[data-theme="light"\] \{ --background-color-default: #E8F8E9;/);
    assert.doesNotMatch(backgroundOnly, /--grad-primary: linear-gradient\(135deg, #E8F8E9/);
    assert.doesNotMatch(backgroundOnly, /:root\[data-theme="dark"\] \{ --background-color-default:/);

    const incomplete = { ...values, "canvas.accentDark": "#123" };
    await saveDesignerSettings(workspace, handoff, saved,
        { modelRevision: model.revision, revision: 1, values: incomplete });
    await assert.rejects(freezeGeneration({ model, values: incomplete, handoff, project, workspace }),
        /Invalid Dark mode accent \(canvas.accentDark\)/);
    for (const invalid of ["red", "12345g", "#12345g", "1234567", "#1234567", "var(--foo)"]) {
        await assert.rejects(freezeGeneration({ model,
            values: { ...values, "canvas.accentLight": invalid }, handoff, project, workspace }),
        /Invalid Light mode accent \(canvas.accentLight\)/);
    }
    await assert.rejects(freezeGeneration({ model, values: { ...values, "canvas.backgroundDark": "11223g" },
        handoff, project, workspace }), /Invalid Dark page background \(canvas.backgroundDark\)/);
    const defaults = { ...values, "canvas.id": "default-accent" };
    for (const id of Object.keys(defaults)) {
        if (/^canvas\.(?:accent|background|surface|secondary|text)(?:Light|Dark)$/.test(id)) {
            defaults[id] = "";
        }
    }
    const plain = await freezeGeneration({ model, values: defaults, handoff, project, workspace });
    await materialize(project, workspace, handoff.handoffId, plain.requestId);
    const plainConfig = JSON.parse(await readFile(join(project, plain.target, "canvas-config.json")));
    assert.equal(plainConfig.appearance, undefined);
    assert.doesNotMatch(renderHtml(plainConfig), /:root\[data-theme="light"\] \{ --accent-color:/);
});

test("stock Logo validates, persists, freezes and packages a portable header image with fallback", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/",
        import.meta.url));
    const path = join(project, ".specify", "extensions", "extension-canvas-design",
        "designer", "essentials-settings", "header-logo.json");
    const mainPath = join(project, ".specify", "extensions", "extension-canvas-design",
        "designer", "essentials-settings", "main-page-logo.json");
    await mkdir(dirname(path), { recursive: true });
    await copyFile(join(source, "designer-host", "essentials-settings", "header-logo.json"), path);
    await copyFile(join(source, "designer-host", "essentials-settings", "main-page-logo.json"), mainPath);
    const templates = [...[path, mainPath].map((file, index) => ({
        name: index ? "designer-essentials-main-page-logo" : "designer-essentials-header-logo", path: file,
        sourceId: "extension:extension-canvas-design", kind: "designer.setting-definition", strategy: "replace",
    })), ...await stockImageTemplates(project)];
    const load = () => loadResolvedDesignerPages(handoff, project, entries, templates,
        stockImageRegistration);
    const model = await load();
    assert.equal(model.constraints["canvas.logo"].type, "image");
    assert.equal(model.values["canvas.logo"], "");
    assert.equal(model.constraints["canvas.mainPageLogo"].type, "image");
    assert.equal(model.values["canvas.mainPageLogo"], "");
    assert.deepEqual(model.pages.find((page) => page.page === "designer-appearance")
        .fields.map((field) => field.id), ["canvas.logo", "canvas.mainPageLogo"]);
    const paletteOrder = JSON.parse(await readFile(join(source, "designer-host",
        "appearance-settings", "light-accent.json"), "utf8")).order;
    assert.ok(model.contributions.find((item) => item.field.id === "canvas.logo").order < paletteOrder);
    assert.ok(model.contributions.find((item) => item.field.id === "canvas.mainPageLogo").order < paletteOrder);
    assert.deepEqual(model.pages.find((page) => page.page === "designer-essentials")
        .fields.map((field) => field.id), ["canvas.id", "canvas.displayName"]);
    const shell = await startShell(handoff, model, { project, workspace });
    t.after(() => shell.close());
    const adapterUrl = new URL(shell.url);
    adapterUrl.pathname = "/adapters/designer-control-adapter-image.mjs";
    const adapterResponse = await fetch(adapterUrl);
    assert.equal(adapterResponse.status, 200);
    assert.match(adapterResponse.headers.get("content-type"), /^text\/javascript/);
    assert.match(await adapterResponse.text(), /export function mount/);
    const appearancePath = entries.find((entry) => entry.name === "designer-appearance").path;
    const originalAppearance = await readFile(appearancePath, "utf8");
    const originalLogo = await readFile(path, "utf8");
    const appearance = JSON.parse(originalAppearance);
    appearance.slots.push({ id: "appearance.logo" });
    await writeFile(appearancePath, JSON.stringify(appearance));
    const logoContribution = JSON.parse(originalLogo);
    await writeFile(path, JSON.stringify({ ...logoContribution, slot: "appearance.logo" }));
    const moved = await load();
    assert.equal(moved.pages.find((page) => page.page === "designer-appearance")
        .fields.at(-1).id, "canvas.logo");
    await writeFile(path, originalLogo);
    await writeFile(appearancePath, originalAppearance);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
    const gif = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==", "base64");
    const logo = `data:image/png;base64,${png.toString("base64")}`;
    const mainLogo = `data:image/gif;base64,${gif.toString("base64")}`;
    assert.deepEqual(decodeImage(logo).bytes, png);
    assert.deepEqual(decodeImage(mainLogo).bytes, gif);
    const jpeg = Buffer.from([
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/",
        "2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/",
        "8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/",
        "8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/",
        "9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==",
    ].join(""), "base64");
    assert.deepEqual(decodeImage(`data:image/jpeg;base64,${jpeg.toString("base64")}`).bytes, jpeg);
    for (const bytes of [
        Buffer.from([255, 216, 255, 255, 217]),
        Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217]),
        Buffer.concat([jpeg.subarray(0, 30), jpeg.subarray(-2)]),
    ]) {
        assert.throws(() => decodeImage(`data:image/jpeg;base64,${bytes.toString("base64")}`),
            /image bytes do not match/);
    }
    const values = { ...model.values, "canvas.id": "with-logo",
        "canvas.displayName": "Logo test", "canvas.logo": logo, "canvas.mainPageLogo": mainLogo };
    const imageContribution = model.contributions.find((item) => item.field.id === "canvas.logo");
    const extraImages = Array.from({ length: 9 }, (_, index) => ({
        ...imageContribution,
        field: { ...imageContribution.field, id: `extra.image${index}`, label: `Extra ${index}` },
        generatedBinding: { ...imageContribution.generatedBinding, slot: `header.extra${index}` },
    }));
    const manyImages = { ...model,
        contributions: [...model.contributions, ...extraImages],
        constraints: { ...model.constraints, ...Object.fromEntries(extraImages.map((item) =>
            [item.field.id, model.constraints["canvas.logo"]])) } };
    const emptyImages = { ...model.values, "canvas.id": "image-count",
        "canvas.displayName": "Image count",
        ...Object.fromEntries(extraImages.map((item) => [item.field.id, ""])) };
    const emptyPrepared = await freezeGeneration({
        model: manyImages, values: emptyImages, handoff, project, workspace,
    });
    const frozenRequest = async (requestId) => JSON.parse(await readFile(join(workspace,
        "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", requestId, "request.json"), "utf8"));
    assert.equal((await frozenRequest(emptyPrepared.requestId)).generatedAssets, undefined);
    const tenImages = { ...emptyImages, "canvas.logo": logo, "canvas.mainPageLogo": mainLogo,
        ...Object.fromEntries(extraImages.slice(0, 8).map((item) => [item.field.id, logo])) };
    const tenPrepared = await freezeGeneration({
        model: manyImages, values: tenImages, handoff, project, workspace,
    });
    assert.equal((await frozenRequest(tenPrepared.requestId)).generatedAssets.length, 10);
    await assert.rejects(freezeGeneration({ model: manyImages,
        values: { ...tenImages, [extraImages[8].field.id]: logo },
        handoff, project, workspace }), /10-image limit/);
    await assert.rejects(freezeGeneration({ model: { ...manyImages,
        contributions: [...model.contributions, { ...extraImages[0],
            generatedBinding: imageContribution.generatedBinding }] },
        values: emptyImages, handoff, project, workspace }), /slots must be unique/);
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA",
        `data:image/png;base64,${Buffer.alloc(32769).toString("base64")}`, "data:image/png;base64,?"]) {
        if (bad.length <= Math.ceil(32768 / 3) * 4 + 64) {
            validateValues({ ...values, "canvas.logo": bad }, model.constraints);
        } else {
            assert.throws(() => validateValues({ ...values, "canvas.logo": bad }, model.constraints),
                /Invalid Designer setting: canvas.logo/);
        }
        await assert.rejects(freezeGeneration({ model, values: { ...values, "canvas.logo": bad },
            handoff, project, workspace }), /Invalid Header logo \(canvas.logo\)/);
        await assert.rejects(freezeGeneration({ model, values: { ...values, "canvas.mainPageLogo": bad },
            handoff, project, workspace }), /Invalid Main page logo \(canvas.mainPageLogo\)/);
    }
    const saved = await saveDesignerSettings(workspace, handoff, model,
        { revision: 0, modelRevision: model.revision, values });
    assert.equal((await loadDesignerSettings(workspace, handoff, model)).values["canvas.logo"], logo);
    assert.equal((await loadDesignerSettings(workspace, handoff, model)).values["canvas.mainPageLogo"], mainLogo);
    const prepared = await freezeGeneration({ model: saved, values, handoff, project, workspace });
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const frozen = JSON.parse(await readFile(requestPath, "utf8"));
    assert.equal(frozen.generatedAssets[0].hash, createHash("sha256").update(png).digest("hex"));
    assert.equal(frozen.generatedAssets[1].hash, createHash("sha256").update(gif).digest("hex"));
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    const tampered = structuredClone(frozen);
    tampered.generatedAssets[0].content = Buffer.from("not an image").toString("base64");
    const { integrity: _prior, ...payload } = tampered;
    tampered.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(tampered));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen image/);
    await writeFile(requestPath, JSON.stringify(frozen));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const target = join(project, prepared.target);
    const config = JSON.parse(await readFile(join(target, "canvas-config.json"), "utf8"));
    assert.deepEqual(await readFile(join(target, "assets", config.brandAsset.file)), png);
    assert.deepEqual(await readFile(join(target, "assets", config.mainPageAsset.file)), gif);
    const portable = await import(pathToFileURL(join(target, "server.mjs")).href);
    assert.deepEqual(portable.readConfig().brandAsset, config.brandAsset);
    assert.deepEqual(portable.readConfig().mainPageAsset, config.mainPageAsset);
    assert.match(portable.renderHtml(config, "secret"), /data-stock-image="header\.brand"/);
    assert.match(portable.renderHtml(config, "secret"), /data-image-file="logo\.png"/);
    assert.match(stockMarkup(config), /data-stock-image="workflow\.intro"/);
    assert.match(stockMarkup(config), /data-image-file="main-page-logo\.gif"/);
    assert.match(portable.renderHtml({ ...config, brandAsset: undefined }), /class="brand-mark" aria-hidden="true">&#9671;/);
    const routed = createServer(portable.createWorkflowRoutes(config, { token: "secret" }).handle);
    await new Promise((resolve) => routed.listen(0, "127.0.0.1", resolve));
    try {
        const base = `http://127.0.0.1:${routed.address().port}`;
        const image = await fetch(`${base}/assets/logo.png?token=secret`);
        assert.equal(image.status, 200);
        assert.equal(image.headers.get("content-type"), "image/png");
        assert.match(image.headers.get("content-security-policy"), /img-src 'self'/);
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
        const mainImage = await fetch(`${base}/assets/main-page-logo.gif?token=secret`);
        assert.equal(mainImage.status, 200);
        assert.equal(mainImage.headers.get("content-type"), "image/gif");
        assert.deepEqual(Buffer.from(await mainImage.arrayBuffer()), gif);
        assert.equal((await fetch(`${base}/assets/logo.png`)).status, 401);
    } finally {
        await new Promise((resolve) => routed.close(resolve));
    }
    await writeFile(join(target, "assets", "logo.png"), Buffer.from("changed"));
    assert.throws(() => portable.readConfig(), /Packaged image does not match its frozen hash/);
    await writeFile(join(target, "assets", "logo.png"), png);
    await writeFile(join(target, "assets", "main-page-logo.gif"), Buffer.from("changed"));
    assert.throws(() => portable.readConfig(), /Packaged image does not match its frozen hash/);
    const onlyMain = { ...values, "canvas.id": "main-only", "canvas.logo": "" };
    const mainOnly = await freezeGeneration({ model, values: onlyMain, handoff, project, workspace });
    await materialize(project, workspace, handoff.handoffId, mainOnly.requestId);
    const mainConfig = JSON.parse(await readFile(join(project, mainOnly.target, "canvas-config.json")));
    assert.equal(mainConfig.brandAsset, undefined);
    assert.equal(mainConfig.mainPageAsset.file, "main-page-logo.gif");
    assert.match(portable.renderHtml(mainConfig), /class="brand-mark" aria-hidden="true">&#9671;/);
    const onlyHeader = { ...values, "canvas.id": "header-only", "canvas.mainPageLogo": "" };
    const headerOnly = await freezeGeneration({ model, values: onlyHeader, handoff, project, workspace });
    await materialize(project, workspace, handoff.handoffId, headerOnly.requestId);
    const headerConfig = JSON.parse(await readFile(join(project, headerOnly.target, "canvas-config.json")));
    assert.equal(headerConfig.mainPageAsset, undefined);
    assert.doesNotMatch(portable.renderHtml(headerConfig), /class="collection-logo"/);
    const absent = { ...model.values, "canvas.id": "without-logo",
        "canvas.displayName": "Fallback", "canvas.logo": "", "canvas.mainPageLogo": "" };
    const noLogo = await freezeGeneration({ model, values: absent, handoff, project, workspace });
    await materialize(project, workspace, handoff.handoffId, noLogo.requestId);
    const fallback = JSON.parse(await readFile(join(project, noLogo.target, "canvas-config.json")));
    assert.equal(fallback.brandAsset, undefined);
    assert.equal(fallback.mainPageAsset, undefined);
    assert.match(portable.renderHtml(fallback), /class="brand-mark" aria-hidden="true">&#9671;/);
});

test("logo gallery preset places a reusable Logo in its declared asset slot", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-logo-gallery-test/",
        import.meta.url));
    const folder = join(project, ".specify", "presets");
    await mkdir(folder);
    const designerPath = join(folder, "designer.json");
    const pagePath = join(folder, "generated.json");
    const rendererPath = join(folder, "generated.mjs");
    const fieldPath = join(folder, "logo.json");
    for (const [relative, target] of [
        [join("designer", "tabs", "logo-gallery.json"), designerPath],
        [join("generated", "pages", "logo-gallery.json"), pagePath],
        [join("generated", "pages", "logo-gallery.mjs"), rendererPath],
        [join("designer", "settings", "logo.json"), fieldPath],
    ]) await copyFile(join(preset, relative), target);
    const designer = JSON.parse(await readFile(designerPath, "utf8"));
    const pageSource = await readFile(pagePath, "utf8");
    const fieldSource = await readFile(fieldPath, "utf8");
    const page = JSON.parse(pageSource);
    const field = JSON.parse(fieldSource);
    const renderer = await readFile(rendererPath, "utf8");
    assert.match(renderer, /dataset\.assetSlot = "hero\.logo"/);
    const templates = [
        { name: page.id, path: pagePath, sourceId: "copilot-logo-gallery-test",
            kind: "generated.added-page-definition", strategy: "replace" },
        { name: page.renderer, path: rendererPath, sourceId: "copilot-logo-gallery-test",
            kind: "generated.added-page-renderer", strategy: "replace" },
        { name: "canvas-logo-gallery-image", path: fieldPath, sourceId: "copilot-logo-gallery-test",
            kind: "designer.setting-definition", strategy: "replace" },
        ...await stockImageTemplates(project),
    ];
    const load = () => loadResolvedDesignerPages(handoff, project,
        [...entries, { name: designer.id, path: designerPath,
            kind: "designer.tab-definition", strategy: "replace" }], templates, stockImageRegistration);
    const model = await load();
    assert.equal(model.pages.find((item) => item.id === designer.id).fields[0].id, "gallery.logo");
    assert.equal(model.pages.find((item) => item.id === "designer-essentials").fields.length, 2);
    assert.equal(field.slot, designer.slots[0].id);
    assert.equal(field.generatedBinding.page, page.id);
    assert.equal(field.generatedBinding.slot, page.slots[0].id);
    await writeFile(fieldPath, JSON.stringify({ ...field,
        generatedBinding: { ...field.generatedBinding, slot: "missing" } }));
    await assert.rejects(load(), /unknown generated page asset slot/);
    await writeFile(fieldPath, fieldSource);
    await writeFile(pagePath, JSON.stringify({ ...page, slots: [{ id: "hero.logo", accepts: ["asset"] }] }));
    await assert.rejects(load(), /invalid generated page definition/);
    await writeFile(pagePath, JSON.stringify({ ...page, slots: [{ id: "hero.logo", orderBy: ["order"] }] }));
    await assert.rejects(load(), /invalid generated page definition/);
    await writeFile(pagePath, pageSource);
    const gif = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==", "base64");
    const values = { ...model.values, "canvas.id": "gallery-canvas",
        "canvas.displayName": "Gallery canvas",
        "gallery.logo": `data:image/gif;base64,${gif.toString("base64")}` };
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const frozen = JSON.parse(await readFile(requestPath, "utf8"));
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    const invalid = structuredClone(frozen);
    invalid.generatedAssets[0].slot = "missing";
    const { integrity: _old, ...payload } = invalid;
    invalid.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(invalid));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /unknown generated page asset slot/);
    await writeFile(requestPath, JSON.stringify(frozen));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const target = join(project, prepared.target);
    const runtime = await import(pathToFileURL(join(target, "server.mjs")).href);
    const config = runtime.readConfig();
    assert.deepEqual(config.generatedPages[0].slots, page.slots);
    const asset = config.generatedPageAssets[0];
    assert.deepEqual({ id: asset.id, page: asset.page, slot: asset.slot },
        { id: "gallery.logo", page: page.id, slot: "hero.logo" });
    assert.equal(config.brandAsset, undefined);
    assert.equal(config.mainPageAsset, undefined);
    assert.deepEqual(await readFile(join(target, "assets", asset.file)), gif);
    assert.match(runtime.renderHtml(config), /data-asset-slots=/);
    const server = createServer(runtime.createWorkflowRoutes(config, { token: "gallery-token" }).handle);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const response = await fetch(`${base}/assets/${asset.file}?token=gallery-token`);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), gif);
        assert.equal((await fetch(`${base}/ui/page-assets.mjs?token=gallery-token`)).status, 200);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
    const { mountPageAssets } = await import(pathToFileURL(join(target, "ui", "page-assets.mjs")).href);
    const slot = { dataset: { assetSlot: "hero.logo" } };
    const content = { querySelectorAll: () => [slot] };
    const mounted = [];
    await mountPageAssets(content, page.slots, [asset], (target, image) =>
        mounted.push({ target, image }));
    assert.deepEqual(mounted, [{ target: slot, image: asset }]);
    await assert.rejects(async () => mountPageAssets({ querySelectorAll: () => [] },
        page.slots, [asset], () => {}), /did not render asset slot/);
    await assert.rejects(async () => mountPageAssets({ querySelectorAll: () => [slot, slot] },
        page.slots, [asset], () => {}), /duplicate generated asset slot/);
    await writeFile(join(target, "assets", asset.file), Buffer.from("tampered"));
    assert.throws(() => runtime.readConfig(), /Packaged image does not match its frozen hash/);
});

test("handoff validates bounded IDs, shape, URLs and fingerprint", () => {
    const good = validHandoff();
    assert.equal(validateHandoff(good, ID), good);
    for (const id of ["", "../escape", "space here", "x".repeat(129), null]) {
        assert.throws(() => validateHandoffId(id), /Invalid Designer handoff ID/);
    }
    assert.throws(() => validateHandoff(good, "different"), /Invalid Designer handoff/);
    const mutate = (change) => {
        const copy = structuredClone(good);
        change(copy);
        copy.sourceFingerprint = fingerprint({ workflow: copy.workflow, selections: copy.selections });
        return copy;
    };
    const invalid = [
        mutate((copy) => { copy.extra = "unexpected"; }),
        mutate((copy) => { copy.workflow.selectedPhases = Array(31).fill("plan"); }),
        mutate((copy) => { copy.selections.presets.push({ ...copy.selections.presets[0] }); }),
        mutate((copy) => { copy.selections.presets[0].downloadUrl = "http://example.com"; }),
        mutate((copy) => { copy.selections.presets[0].downloadUrl = "https://user:pass@example.com"; }),
        mutate((copy) => { copy.selections.bundles[0].approved = false; }),
        mutate((copy) => { delete copy.selections.extensions; }),
        mutate((copy) => { copy.selections.presets[0].id = "../escape"; }),
    ];
    for (const handoff of invalid) {
        assert.throws(() => validateHandoff(handoff, ID), /Invalid Designer handoff/);
    }
    const changed = structuredClone(good);
    changed.workflow.selectedPhases.push("tasks");
    assert.throws(() => validateHandoff(changed, ID), /fingerprint mismatch/);
});

test("handoff accepts additive localSelections (presets/extensions only) and rejects malformed ones", () => {
    const base = validHandoff();
    const withLocal = (localSelections) => {
        const copy = structuredClone(base);
        copy.localSelections = localSelections;
        copy.sourceFingerprint = fingerprint({
            workflow: copy.workflow, selections: copy.selections, localSelections,
        });
        return copy;
    };
    const goodLocal = withLocal({
        presets: [{ id: "my-preset", source: "local", approved: true, path: "C:\\dev\\my-preset" }],
        extensions: [{ id: "extension-canvas-design", source: "local", approved: true, path: "/home/dev/ext" }],
    });
    assert.equal(validateHandoff(goodLocal, ID), goodLocal);
    // A fingerprint computed without localSelections never matches a handoff
    // that declares localSelections (and vice versa) — the field is part of
    // the signed payload, not a trailing decoration.
    const staleFingerprint = structuredClone(goodLocal);
    staleFingerprint.sourceFingerprint = fingerprint({
        workflow: staleFingerprint.workflow, selections: staleFingerprint.selections,
    });
    assert.throws(() => validateHandoff(staleFingerprint, ID), /fingerprint mismatch/);
    const invalidLocal = [
        withLocal({ bundles: [] }),
        withLocal({ presets: "not-an-array" }),
        withLocal({ presets: Array(21).fill({ id: "a", source: "local", approved: true, path: "/a" }) }),
        withLocal({ presets: [{ id: "dup", source: "local", approved: true, path: "/a" },
            { id: "dup", source: "local", approved: true, path: "/b" }] }),
        withLocal({ presets: [{ id: "x", source: "copilot", approved: true, path: "/a" }] }),
        withLocal({ presets: [{ id: "x", source: "local", approved: false, path: "/a" }] }),
        withLocal({ presets: [{ id: "x", source: "local", approved: true, path: "relative/path" }] }),
        withLocal({ presets: [{ id: "x", source: "local", approved: true, path: "/a", downloadUrl: null }] }),
        withLocal({ presets: [{ id: "../escape", source: "local", approved: true, path: "/a" }] }),
    ];
    for (const handoff of invalidLocal) {
        assert.throws(() => validateHandoff(handoff, ID), /Invalid Designer handoff/);
    }
});

test("handoff reads only validated artifacts from its session workspace", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    const directory = await saveHandoff(workspace, handoff);
    assert.deepEqual(await readHandoff(workspace, ID), handoff);
    await assert.rejects(readHandoff(workspace, "../escape"), /Invalid Designer handoff ID/);
    await assert.rejects(readHandoff("", ID), /Designer session workspace is unavailable/);
    await assert.rejects(readHandoff(workspace, "other"), { code: "ENOENT" });

    const path = join(directory, "handoff.json");
    await writeFile(path, `${JSON.stringify(handoff)}\r\n`);
    assert.deepEqual(await readHandoff(workspace, ID), handoff);
    await writeFile(path, "{broken");
    await assert.rejects(readHandoff(workspace, ID), /Malformed Designer handoff/);
    await writeFile(path, JSON.stringify({ ...handoff, sourceFingerprint: "0".repeat(64) }));
    await assert.rejects(readHandoff(workspace, ID), /fingerprint mismatch/);
    await writeFile(path, "x".repeat(HANDOFF_LIMIT + 1));
    await assert.rejects(readHandoff(workspace, ID), /Invalid Designer handoff file/);

    const outside = await fixture(t);
    await saveHandoff(outside);
    await rm(directory, { recursive: true });
    try {
        await symlink(handoffDirectory(outside, ID), directory,
            process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; traversal assertion skipped");
        return;
    }
    await assert.rejects(readHandoff(workspace, ID), /Designer handoff escapes session artifacts/);
});

test("handoff rejects symlinked file without following it", async (t) => {
    const workspace = await fixture(t);
    const directory = await saveHandoff(workspace);
    const path = join(directory, "handoff.json");
    const target = join(workspace, "outside.json");
    await writeFile(target, JSON.stringify(validHandoff()));
    await rm(path);
    try {
        await symlink(target, path, "file");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; file assertion skipped");
        return;
    }
    await assert.rejects(readHandoff(workspace, ID), /Invalid Designer handoff file/);
});

test("handoff rejects a parent directory replaced during file open", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    const directory = await saveHandoff(workspace);
    await saveHandoff(outside);
    const backup = `${directory}-original`;
    let replaced = false;
    try {
        await assert.rejects(readHandoff(workspace, ID, async (path, flags) => {
            await rename(directory, backup);
            try {
                await symlink(handoffDirectory(outside, ID), directory,
                    process.platform === "win32" ? "junction" : "dir");
            } catch (error) {
                await rename(backup, directory);
                throw error;
            }
            replaced = true;
            return open(path, flags);
        }), /Designer handoff escapes session artifacts/);
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; race assertion skipped");
    } finally {
        if (replaced) {
            await rm(directory, { recursive: true });
            await rename(backup, directory);
        }
    }
});

test("handoff rejects a different opened file even if the path still passes validation", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    await saveHandoff(workspace);
    const outsideDirectory = await saveHandoff(outside);
    await assert.rejects(
        readHandoff(workspace, ID, (_path, flags) => open(join(outsideDirectory, "handoff.json"), flags)),
        /Invalid Designer handoff file/,
    );
});

test("settings reject a parent directory replaced during file open, including a missing file", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    const handoff = validHandoff();
    const directory = await saveHandoff(workspace, handoff);
    const outsideDirectory = await saveHandoff(outside, handoff);
    const model = { revision: "snapshot", constraints: {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100 },
    }, values: { "canvas.id": "" } };
    await saveDesignerSettings(outside, handoff, model, { revision: 0,
        modelRevision: model.revision, values: { "canvas.id": "outside" } });
    const backup = `${directory}-original`;
    for (const existing of [true, false]) {
        if (!existing) await rm(join(outsideDirectory, "settings.json"));
        let replaced = false;
        try {
            await assert.rejects(loadDesignerSettings(workspace, handoff, model,
                async (path, flags) => {
                    await rename(directory, backup);
                    try {
                        await symlink(outsideDirectory, directory,
                            process.platform === "win32" ? "junction" : "dir");
                    } catch (error) {
                        await rename(backup, directory);
                        throw error;
                    }
                    replaced = true;
                    return open(path, flags);
                }), /Designer settings escape session artifacts/);
        } catch (error) {
            if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
            t.diagnostic("Windows symlink creation is not permitted; settings race assertion skipped");
            return;
        } finally {
            if (replaced) {
                await rm(directory, { recursive: true });
                await rename(backup, directory);
            }
        }
    }
});

test("settings reject a different opened file even when their parent remains valid", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    const handoff = validHandoff();
    await saveHandoff(workspace, handoff);
    const outsideDirectory = await saveHandoff(outside, handoff);
    const model = { revision: "snapshot", constraints: {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100 },
    }, values: { "canvas.id": "" } };
    const request = { revision: 0, modelRevision: model.revision,
        values: { "canvas.id": "saved" } };
    await saveDesignerSettings(workspace, handoff, model, request);
    await saveDesignerSettings(outside, handoff, model, request);
    await assert.rejects(loadDesignerSettings(workspace, handoff, model,
        (_path, flags) => open(join(outsideDirectory, "settings.json"), flags)),
    /Invalid saved Designer settings file/);
});

test("settings use the canonical workspace when the session path is a symlink", async (t) => {
    const workspace = await fixture(t);
    const aliasParent = await fixture(t);
    const handoff = validHandoff();
    const folder = await saveHandoff(workspace, handoff);
    const alias = join(aliasParent, "linked-session");
    try {
        await symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; workspace alias assertion skipped");
        return;
    }
    try {
        assert.deepEqual(await readHandoff(alias, ID), handoff);
        const model = { revision: "snapshot", constraints: {
            "canvas.id": { type: "string", minLength: 1, maxLength: 100 },
        }, values: { "canvas.id": "" } };
        assert.equal((await loadDesignerSettings(alias, handoff, model)).settingsRevision, 0);
        await saveDesignerSettings(alias, handoff, model, { revision: 0,
            modelRevision: model.revision, values: { "canvas.id": "saved" } });
        assert.equal((await loadDesignerSettings(alias, handoff, model)).values["canvas.id"], "saved");
        assert.equal(JSON.parse(await readFile(join(folder, "settings.json"))).values["canvas.id"], "saved");
    } finally {
        await rm(alias);
    }
});

test("settings reads stay bounded when the file grows after its initial stat", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    const folder = await saveHandoff(workspace, handoff);
    const model = { revision: "snapshot", constraints: {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100 },
    }, values: { "canvas.id": "" } };
    await saveDesignerSettings(workspace, handoff, model, { revision: 0,
        modelRevision: model.revision, values: { "canvas.id": "saved" } });
    await assert.rejects(loadDesignerSettings(workspace, handoff, model,
        async (path, flags) => {
            const file = await open(path, flags);
            return {
                stat: async () => {
                    const before = await file.stat();
                    await appendFile(join(folder, "settings.json"), "x".repeat(SETTINGS_LIMIT + 1));
                    return before;
                },
                read: (...args) => file.read(...args),
                close: () => file.close(),
            };
        }), /Saved Designer settings exceed the size limit/);
});

test("settings reject a swapped temporary-file parent before writing", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    const handoff = validHandoff();
    const directory = await saveHandoff(workspace, handoff);
    const outsideDirectory = await saveHandoff(outside, handoff);
    const model = { revision: "snapshot", constraints: {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100 },
    }, values: { "canvas.id": "" } };
    const backup = `${directory}-original`;
    let replaced = false;
    try {
        await assert.rejects(saveDesignerSettings(workspace, handoff, model, {
            revision: 0, modelRevision: model.revision, values: { "canvas.id": "saved" },
        }, async (path, flags, mode) => {
            await rename(directory, backup);
            try {
                await symlink(outsideDirectory, directory,
                    process.platform === "win32" ? "junction" : "dir");
            } catch (error) {
                await rename(backup, directory);
                throw error;
            }
            replaced = true;
            return open(path, flags, mode);
        }), /Designer settings escape session artifacts/);
        assert.deepEqual((await readdir(outsideDirectory)).sort(), ["handoff.json"]);
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; settings write race assertion skipped");
    } finally {
        if (replaced) {
            await rm(directory, { recursive: true });
            await rename(backup, directory);
        }
    }
});

test("handoff rejects a FIFO promptly instead of waiting for a writer", {
    skip: process.platform === "win32",
}, async (t) => {
    const workspace = await fixture(t);
    const directory = handoffDirectory(workspace, ID);
    await mkdir(directory, { recursive: true });
    const fifo = join(directory, "handoff.json");
    const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr || created.error?.message);

    const script = `
        import { readHandoff } from ${JSON.stringify(new URL("../handoff.mjs", import.meta.url).href)};
        try {
            await readHandoff(process.argv[1], ${JSON.stringify(ID)});
            process.exitCode = 1;
        } catch (error) {
            if (!/Invalid Designer handoff file/.test(error.message)) {
                console.error(error);
                process.exitCode = 2;
            }
        }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, workspace],
        { timeout: 3000, encoding: "utf8" });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
});

test("shell serves validated pages behind its token", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    await saveHandoff(workspace, handoff);
    const model = { pages: [{ id: "designer-essentials", page: "designer-essentials",
        title: "Essentials", fields: [] }], constraints: {}, values: {}, revision: "test" };
    await assert.rejects(startShell(handoff), /validated before opening/);
    await assert.rejects(startShell(handoff, model), /session workspace is required/);
    const shell = await startShell(handoff, model, { workspace });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.match(url.searchParams.get("token"), /^[a-f0-9]{48}$/);
    const good = await fetch(shell.url);
    assert.equal(good.status, 200);
    assert.match(good.headers.get("content-type"), /text\/html/);
    assert.equal(good.headers.get("cache-control"), "no-store");
    assert.equal(good.headers.get("x-content-type-options"), "nosniff");
    assert.equal(good.headers.get("content-security-policy"),
        "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    assert.match(await good.text(), /Spec Kit Canvas Designer/);
    const stateUrl = new URL(`/api/state?token=${url.searchParams.get("token")}`, url);
    const stateResponse = await fetch(stateUrl);
    assert.equal(stateResponse.headers.get("content-security-policy"),
        good.headers.get("content-security-policy"));
    const state = await stateResponse.json();
    assert.equal(state.pages[0].title, "Essentials");
    assert.deepEqual(state.badges, []);
    assert.equal(state.handoffId, handoff.handoffId);
    const badgeControl = await fetch(new URL(
        `/ui/badges-control.js?token=${url.searchParams.get("token")}`, url));
    assert.equal(badgeControl.status, 200);
    assert.match(await badgeControl.text(), /mountBadges/);
    assert.equal((await fetch(new URL(`/events?token=${url.searchParams.get("token")}`, url))).status, 404);
    for (const [address, options] of [
        [url.origin, undefined],
        [`${url.origin}/?token=wrong`, undefined],
        [`${url.origin}/other?token=${url.searchParams.get("token")}`, undefined],
        [shell.url, { method: "POST" }],
    ]) {
        assert.equal((await fetch(address, options)).status, 404);
    }
});

test("Save persists incomplete drafts beside the handoff and rejects stale or malformed changes", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    const folder = await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const model = await loadResolvedDesignerPages(handoff, project, entries);
    const initial = await loadDesignerSettings(workspace, handoff, model);
    assert.equal(initial.settingsRevision, 0);
    assert.equal(initial.persisted, false);
    const values = { ...initial.values, "canvas.id": "my-canvas",
        "canvas.displayName": "My Canvas" };
    const request = { revision: 0, modelRevision: model.revision, values };
    await assert.rejects(saveDesignerSettings(workspace, handoff, model, {
        ...request, values: { ...values, "canvas.id": "../escape" },
    }), /Invalid Designer setting: canvas.id/);
    await assert.rejects(freezeGeneration({ model, values: { ...values, "canvas.id": "../escape" },
        handoff, project, workspace }), /Invalid Designer setting: canvas.id/);
    for (const id of ["con", "prn", "aux", "nul",
        ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
        ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)]) {
        await assert.rejects(saveDesignerSettings(workspace, handoff, model, {
            ...request, values: { ...values, "canvas.id": id },
        }), /Invalid Designer setting: canvas.id/);
    }
    assert.equal((await loadDesignerSettings(workspace, handoff, model)).settingsRevision, 0);
    await assert.rejects(saveDesignerSettings(workspace, handoff, model, {
        ...request, values: { ...values, unexpected: "extra" },
    }), /unexpected or missing fields/);
    const saved = await saveDesignerSettings(workspace, handoff, model, request);
    assert.equal(saved.settingsRevision, 1);
    assert.equal(saved.persisted, true);
    assert.deepEqual((await loadDesignerSettings(workspace, handoff, model)).values, values);
    const stored = JSON.parse(await readFile(join(folder, "settings.json"), "utf8"));
    assert.deepEqual(stored.values, values);
    assert.equal(stored.revision, 1);
    assert.deepEqual((await readFile(entries[0].path, "utf8")).includes("my-canvas"), false);
    await assert.rejects(saveDesignerSettings(workspace, handoff, model,
        { ...request, values: { ...values, "canvas.displayName": "Stale" } }),
        /Copy any unsaved edits, then close and reopen Designer before saving/);
    const revised = await saveDesignerSettings(workspace, handoff, model,
        { ...request, revision: 1, values: { ...values, "canvas.displayName": "Updated" } });
    assert.equal(revised.settingsRevision, 2);
    await assert.rejects(loadDesignerSettings(workspace, handoff,
        { ...model, revision: "new-page-fingerprint" }), /do not match the current handoff or pages/);
    await writeFile(join(folder, "settings.json"), "{broken");
    await assert.rejects(loadDesignerSettings(workspace, handoff, model),
        /Invalid saved Designer settings JSON/);
});

test("fresh Designer ignores discarded content and model revisions while Save replaces it safely", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    const folder = await saveHandoff(workspace, handoff);
    const path = join(folder, "settings.json");
    const model = { revision: "current", constraints: { "canvas.id": { type: "string" } },
        values: { "canvas.id": "default" } };
    const old = { schemaVersion: 1, handoffId: handoff.handoffId, revision: 7,
        modelRevision: "old", values: { removed: true }, outputs: { removed: null },
        badges: [{ id: "removed", type: "missing", inputs: { obsolete: true } }] };
    for (const discarded of [
        { modelRevision: old.modelRevision },
        { values: old.values },
        { outputs: old.outputs },
        { badges: old.badges },
        { ...old, unknownOldField: true },
    ]) {
        const record = { ...old, modelRevision: model.revision, values: model.values,
            outputs: initialOutputs(handoff), badges: [], ...discarded };
        const bytes = JSON.stringify(record);
        await writeFile(path, bytes);
        const fresh = await freshDesignerSettings(workspace, handoff, model);
        assert.deepEqual(fresh.values, model.values);
        assert.deepEqual(fresh.outputs, initialOutputs(handoff));
        assert.deepEqual(fresh.badges, []);
        assert.equal(fresh.settingsRevision, 7);
        assert.equal(fresh.persisted, false);
        assert.equal(await readFile(path, "utf8"), bytes);
        await assert.rejects(loadDesignerSettings(workspace, handoff, model));
        const request = { modelRevision: model.revision, revision: 7,
            values: { "canvas.id": "replacement" } };
        await assert.rejects(saveDesignerSettings(workspace, handoff, fresh,
            { ...request, modelRevision: "old" }), /Invalid Designer save request/);
        await assert.rejects(saveDesignerSettings(workspace, handoff, fresh,
            { ...request, values: old.values }), /unexpected or missing fields/);
        await assert.rejects(saveDesignerSettings(workspace, handoff, fresh,
            { ...request, outputs: old.outputs }), /Invalid Designer phase outputs/);
        await assert.rejects(saveDesignerSettings(workspace, handoff, fresh,
            { ...request, badges: old.badges }), /badge/i);
        await assert.rejects(saveDesignerSettings(workspace, handoff, fresh,
            { ...request, revision: 6 }), /settings changed elsewhere/);
        assert.equal(await readFile(path, "utf8"), bytes);
        const saved = await saveDesignerSettings(workspace, handoff, fresh, request);
        assert.equal(saved.settingsRevision, 8);
        assert.equal(saved.persisted, true);
        assert.deepEqual((await loadDesignerSettings(workspace, handoff, model)).values,
            request.values);
        assert.equal(JSON.parse(await readFile(path, "utf8")).modelRevision, model.revision);
        const reopened = await freshDesignerSettings(workspace, handoff, model);
        assert.deepEqual(reopened.values, model.values);
        assert.equal(reopened.settingsRevision, 8);
    }
});

test("fresh Designer and Save still reject unsafe files and invalid saved metadata", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    const folder = await saveHandoff(workspace, handoff);
    const path = join(folder, "settings.json");
    const model = { revision: "current", constraints: {}, values: {} };
    const request = { modelRevision: model.revision, revision: 1, values: {} };
    const metadata = { schemaVersion: 1, handoffId: handoff.handoffId, revision: 1 };
    assert.equal((await freshDesignerSettings(workspace, handoff, model)).settingsRevision, 0);
    for (const content of [
        "{broken", "null", "[]",
        JSON.stringify({ ...metadata, handoffId: "different" }),
        JSON.stringify({ ...metadata, schemaVersion: 2 }),
        ...[undefined, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]
            .map((revision) => JSON.stringify({ ...metadata, revision })),
        "x".repeat(SETTINGS_LIMIT + 1),
    ]) {
        await writeFile(path, content);
        await assert.rejects(freshDesignerSettings(workspace, handoff, model),
            /Invalid saved Designer settings|Saved Designer settings/);
        await assert.rejects(saveDesignerSettings(workspace, handoff, model, request),
            /Invalid saved Designer settings|Saved Designer settings/);
        assert.equal(await readFile(path, "utf8"), content);
    }
    await rm(path);
    await mkdir(path);
    await assert.rejects(freshDesignerSettings(workspace, handoff, model));
    await assert.rejects(saveDesignerSettings(workspace, handoff, model, request));
    await rm(path, { recursive: true });
    const target = join(folder, "other-settings.json");
    await writeFile(target, JSON.stringify(metadata));
    try {
        await symlink(target, path, "file");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; settings symlink assertion skipped");
        return;
    }
    await assert.rejects(freshDesignerSettings(workspace, handoff, model),
        /Invalid saved Designer settings file|ELOOP/);
    await assert.rejects(saveDesignerSettings(workspace, handoff, model, request),
        /Invalid saved Designer settings file|ELOOP/);
});

test("token-gated Save endpoint reports errors without losing the current values", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const changedPage = JSON.parse(await readFile(entries[0].path, "utf8"));
    changedPage.fields.push({ id: "changed", label: "Changed" });
    await writeFile(entries[0].path, JSON.stringify(changedPage));
    const model = await loadDesignerSettings(workspace, handoff,
        await loadResolvedDesignerPages(handoff, project, entries));
    const shell = await startShell(handoff, model, { project, workspace });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    const saveUrl = new URL("/api/save", url);
    const values = { ...model.values, "canvas.id": "sample",
        "canvas.displayName": "Sample" };
    const payload = { revision: 0, modelRevision: model.revision, values };
    assert.equal((await fetch(saveUrl, { method: "POST", headers: {
        "Content-Type": "application/json",
    }, body: JSON.stringify(payload) })).status, 404);
    saveUrl.search = url.search;
    const post = (body) => fetch(saveUrl, { method: "POST", headers: {
        "Content-Type": "application/json",
    }, body: JSON.stringify(body) });
    const accepted = await post(payload);
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).settingsRevision, 1);
    const stateUrl = new URL("/api/state", url);
    stateUrl.search = url.search;
    assert.deepEqual((await (await fetch(stateUrl)).json()).values, values);
    const stale = await post(payload);
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /close and reopen Designer before saving/);
    const invalidNamedChanged = await post({ ...payload, revision: 1,
        values: { ...values, changed: true } });
    assert.equal(invalidNamedChanged.status, 422);
    assert.equal((await invalidNamedChanged.json()).error, "Invalid Designer setting: changed");
    assert.deepEqual((await (await fetch(stateUrl)).json()).values, values);
    const incomplete = await post({ ...payload, revision: 1, values: { ...values,
        "canvas.id": "UPPER" } });
    assert.equal(incomplete.status, 200);
    assert.equal((await (await fetch(stateUrl)).json()).values["canvas.id"], "UPPER");
});

test("Save accepts a bounded request and rejects one byte over the limit", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff("a".repeat(128));
    const folder = await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    for (const index of [0, 2]) {
        const entry = entries[index];
        const page = JSON.parse(await readFile(entry.path, "utf8"));
        while (page.fields.length < 100) {
            const id = `custom.${index}.${page.fields.length}`;
            page.fields.push({ id, label: id });
        }
        await writeFile(entry.path, JSON.stringify(page));
    }
    const model = await loadResolvedDesignerPages(handoff, project, entries);
    assert.equal(Object.keys(model.constraints).length, 200);
    const values = { ...model.values, "canvas.id": "example", "canvas.displayName": "Example" };
    const payload = { revision: 0, modelRevision: model.revision, values };
    let remaining = SAVE_REQUEST_LIMIT - Buffer.byteLength(JSON.stringify(payload));
    for (const id of Object.keys(values).filter((key) => key.startsWith("custom."))) {
        const length = Math.min(remaining, model.constraints[id].maxLength);
        values[id] = "x".repeat(length);
        remaining -= length;
    }
    const body = JSON.stringify(payload);
    assert.ok(Buffer.byteLength(body) < SAVE_REQUEST_LIMIT);
    const padded = body + " ".repeat(SAVE_REQUEST_LIMIT - Buffer.byteLength(body));
    assert.equal(Buffer.byteLength(padded), SAVE_REQUEST_LIMIT);
    const shell = await startShell(handoff, model, { project, workspace });
    t.after(() => shell.close());
    const saveUrl = new URL(shell.url);
    saveUrl.pathname = "/api/save";
    const response = await fetch(saveUrl, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: `${padded} ` });
    assert.equal(response.status, 413);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await response.json(), { error: "Designer save request is too large" });
    await assert.rejects(readFile(join(folder, "settings.json")), { code: "ENOENT" });
    const accepted = await fetch(saveUrl, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: padded });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).settingsRevision, 1);
    assert.ok((await readFile(join(folder, "settings.json"))).length <= SETTINGS_LIMIT);
});

test("Generate freezes Essentials and queues one composed skill invocation", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const templates = await stockTemplates(project);
    const generateSkill = join(project, ".github", "skills",
        "speckit-extension-canvas-design-generate", "SKILL.md");
    await mkdir(join(project, ".github", "skills", "speckit-extension-canvas-design-generate"));
    await writeFile(generateSkill, "---\nname: speckit-extension-canvas-design-generate\n---\n");
    await installOpenSkill(project);
    const model = await loadDesignerSettings(workspace, handoff,
        await loadResolvedDesignerPages(handoff, project, entries, templates));
    const prompts = [];
    const dispatchErrors = [];
    let dispatchFails = false;
    const shell = await startShell(handoff, model, { project, workspace,
        session: {
            send: async (value) => {
                if (dispatchFails) throw new Error("generation channel unavailable");
                prompts.push(value.prompt);
            },
            log: async (message, options) => dispatchErrors.push({ message, options }),
        } });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    const endpoint = new URL(`/api/generate?token=${url.searchParams.get("token")}`, url);
    const values = { ...model.values, "canvas.id": "my-canvas",
        "canvas.displayName": "My Canvas" };
    const post = (body, address = endpoint) => fetch(address, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: url.origin },
        body: JSON.stringify(body),
    });
    const wrongType = await fetch(endpoint, { method: "POST",
        headers: { "Content-Type": "text/plain", Origin: url.origin }, body: "{}" });
    assert.equal(wrongType.status, 422);
    assert.equal((await wrongType.json()).error, "Expected JSON Designer settings");
    const generationRequest = (settingsRevision, draft) => ({
        modelRevision: model.revision, settingsRevision, values: draft,
    });
    assert.equal((await post(generationRequest("stale", values))).status, 422);
    assert.equal((await post(generationRequest(0, {
        ...values, "canvas.id": "../outside",
    }))).status, 409);
    assert.equal((await post(generationRequest(0, values),
        new URL("/api/generate?token=wrong", url))).status, 404);
    assert.equal(prompts.length, 0);
    const unsaved = await post(generationRequest(0, values));
    assert.equal(unsaved.status, 409);
    assert.match((await unsaved.json()).error, /Save the current settings/);
    const newerValues = { ...values, "canvas.description": "Newer settings" };
    const saved = await saveDesignerSettings(workspace, handoff, model,
        { revision: 0, modelRevision: model.revision, values: newerValues });
    assert.equal(saved.settingsRevision, 1);
    await rm(generateSkill);
    const unavailable = await post(generationRequest(saved.settingsRevision, newerValues));
    assert.equal(unavailable.status, 409);
    assert.match((await unavailable.json()).error, /Launch a new Designer session with a compatible Canvas Design extension/);
    assert.equal(prompts.length, 0);
    await assert.rejects(readdir(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations")), { code: "ENOENT" });
    await writeFile(generateSkill, "---\nname: speckit-extension-canvas-design-generate\n---\n");
    const stale = await post(generationRequest(0, values));
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /settings changed elsewhere/);
    assert.equal(prompts.length, 0);
    await assert.rejects(readdir(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations")), { code: "ENOENT" });
    for (const changed of [
        generationRequest(saved.settingsRevision, { ...newerValues, "canvas.id": "unsaved-id" }),
        { ...generationRequest(saved.settingsRevision, newerValues), outputs: {} },
        { ...generationRequest(saved.settingsRevision, newerValues), badges: [{ id: "unsaved" }] },
    ]) {
        const mismatch = await post(changed);
        assert.equal(mismatch.status, 409);
        assert.match((await mismatch.json()).error, /Save the current settings/);
    }
    assert.equal(prompts.length, 0);
    await assert.rejects(readdir(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations")), { code: "ENOENT" });
    const absentReplacement = await post({
        ...generationRequest(saved.settingsRevision, newerValues),
        replaceExisting: true, replaceRequestId: "prior-request",
    });
    assert.equal(absentReplacement.status, 409);
    assert.match((await absentReplacement.json()).error, /Canvas is absent/);
    assert.equal(prompts.length, 0);
    await assert.rejects(readdir(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations")), { code: "ENOENT" });
    const response = await post(generationRequest(saved.settingsRevision, newerValues));
    assert.equal(response.status, 202);
    const generated = await response.json();
    assert.equal(generated.target, ".github/extensions/my-canvas/");
    await waitFor(() => prompts.length === 1);
    assert.match(prompts[0], /speckit-extension-canvas-design-generate skill/);
    const frozen = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", generated.requestId, "request.json")));
    assert.equal(frozen.canvas.id, "my-canvas");
    assert.equal(frozen.canvas.description, "Newer settings");
    assert.equal(frozen.settingsRevision, 1);
    assert.deepEqual(frozen.workflow.selectedPhases, handoff.workflow.selectedPhases);
    const target = join(project, ".github", "extensions", "my-canvas");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "extension.mjs"), "export {};\n");
    await writeFile(join(target, "canvas-config.json"),
        JSON.stringify({ canvas: { id: "my-canvas" } }));
    await writeFile(join(target, "settings-provenance.json"),
        JSON.stringify({ handoffId: handoff.handoffId, requestId: generated.requestId,
            sourceFingerprint: frozen.sourceFingerprint }));
    const replace = { ...generationRequest(saved.settingsRevision, newerValues),
        replaceExisting: true, replaceRequestId: generated.requestId };
    assert.equal((await post({ ...replace, replaceRequestId: "../escape" })).status, 422);
    assert.equal((await post({ ...replace, replaceRequestId: undefined })).status, 422);
    assert.equal((await post({ ...replace, replaceRequestId: "stale" })).status, 409);
    assert.equal(prompts.length, 1);
    const replaced = await post(replace);
    assert.equal(replaced.status, 202, await replaced.text());
    await waitFor(() => prompts.length === 2);
    assert.match(prompts[1], new RegExp(`--replace-existing=${generated.requestId}`));
    dispatchFails = true;
    const another = { ...newerValues, "canvas.id": "another-canvas" };
    const next = await saveDesignerSettings(workspace, handoff, model,
        { revision: saved.settingsRevision, modelRevision: model.revision, values: another });
    const failedDispatch = await post(generationRequest(next.settingsRevision, another));
    assert.equal(failedDispatch.status, 202);
    await waitFor(() => dispatchErrors.length === 1);
    assert.match(dispatchErrors[0].message, /Generate dispatch failed: generation channel unavailable/);
    assert.deepEqual(dispatchErrors[0].options, { level: "error" });
});

test("Generate retries while a child request is pending and still protects existing output", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const skill = join(project, ".github", "skills",
        "speckit-extension-canvas-design-generate", "SKILL.md");
    await mkdir(dirname(skill), { recursive: true });
    await writeFile(skill, "---\nname: speckit-extension-canvas-design-generate\n---\n");
    await installOpenSkill(project);
    const model = await loadDesignerSettings(workspace, handoff,
        await loadResolvedDesignerPages(handoff, project, entries, await stockTemplates(project)));
    const prompts = [];
    const shell = await startShell(handoff, model, { project, workspace,
        session: { send: async (value) => prompts.push(value.prompt) } });
    t.after(() => shell.close());
    const stateUrl = new URL(shell.url);
    stateUrl.pathname = "/api/state";
    const generateUrl = new URL(shell.url);
    generateUrl.pathname = "/api/generate";
    const first = { ...model.values, "canvas.id": "first-canvas", "canvas.displayName": "First" };
    const second = { ...first, "canvas.id": "second-canvas", "canvas.displayName": "Second" };
    const post = (values, revision = 0) => fetch(generateUrl, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelRevision: model.revision, settingsRevision: revision, values }) });
    const initial = await saveDesignerSettings(workspace, handoff, model,
        { modelRevision: model.revision, revision: 0, values: first });
    const firstResult = await post(first, initial.settingsRevision);
    assert.equal(firstResult.status, 202);
    const { requestId } = await firstResult.json();
    assert.equal((await post(first, initial.settingsRevision)).status, 202);
    assert.equal((await post(second, initial.settingsRevision)).status, 409);
    const target = join(project, ".github", "extensions", "first-canvas");
    await mkdir(target, { recursive: true });
    assert.equal((await (await fetch(stateUrl)).json()).generationAvailable, true);
    await writeFile(join(target, "extension.mjs"), "export {};\n");
    await writeFile(join(target, "canvas-config.json"),
        JSON.stringify({ canvas: { id: "first-canvas" } }));
    await writeFile(join(target, "settings-provenance.json"),
        JSON.stringify({ handoffId: handoff.handoffId, requestId,
            sourceFingerprint: handoff.sourceFingerprint }));
    const duplicate = await post(first, initial.settingsRevision);
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /already exists/);
    const saveUrl = new URL(shell.url);
    saveUrl.pathname = "/api/save";
    const saved = await fetch(saveUrl, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelRevision: model.revision,
            revision: initial.settingsRevision, values: second }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).generationAvailable, true);
    assert.equal((await post(second, 2)).status, 202);
    assert.equal((await post(second, 2)).status, 202);
    await waitFor(() => prompts.length === 4);
});

test("output status, folder reveal and Open enforce the same generated identity", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const model = await loadDesignerSettings(workspace, handoff,
        await loadResolvedDesignerPages(handoff, project, entries, await stockTemplates(project)));
    const revealed = [];
    const prompts = [];
    const dispatchErrors = [];
    let dispatchFails = false;
    let blockSend = false;
    let resolveSend;
    const shell = await startShell(handoff, model, { project, workspace,
        session: {
            send: async ({ prompt }) => {
                if (dispatchFails) throw new Error("child session unavailable");
                prompts.push(prompt);
                if (blockSend) await new Promise((resolve) => { resolveSend = resolve; });
            },
            log: async (message, options) => dispatchErrors.push({ message, options }),
        },
        launchFolder: (_command, [path]) => {
            revealed.push(path);
            const child = { once(event, callback) {
                if (event === "spawn") queueMicrotask(callback);
                return child;
            }, unref() {} };
            return child;
        } });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    const getStatus = (id) => fetch(new URL(`/api/output-status?token=${url.searchParams.get("token")}&canvasId=${encodeURIComponent(id)}`, url));
    const action = (path, body) => fetch(new URL(`${path}?token=${url.searchParams.get("token")}`, url), {
        method: "POST", headers: { "Content-Type": "application/json", Origin: url.origin },
        body: JSON.stringify(body),
    });
    assert.equal((await getStatus("../escape")).status, 422);
    assert.deepEqual(await (await getStatus("my-canvas")).json(),
        { status: "absent", target: ".github/extensions/my-canvas/" });
    assert.equal((await action("/api/reveal-output", { canvasId: "../escape" })).status, 422);
    const parentReveal = await action("/api/reveal-output", { canvasId: "my-canvas" });
    assert.equal(parentReveal.status, 200);
    assert.deepEqual(await parentReveal.json(), { target: ".github/extensions/" });
    assert.equal(revealed[0], join(project, ".github", "extensions"));
    const missing = await action("/api/open-generated", { canvasId: "my-canvas" });
    assert.equal(missing.status, 422);
    assert.match((await missing.json()).error, /Generate the canvas files first/);
    const target = join(project, ".github", "extensions", "my-canvas");
    await mkdir(target);
    await writeFile(join(target, "extension.mjs"), "export {};\n");
    await writeFile(join(target, "canvas-config.json"), JSON.stringify({ canvas: { id: "my-canvas" } }));
    await writeFile(join(target, "settings-provenance.json"),
        JSON.stringify({ handoffId: "another", requestId: "request-1" }));
    assert.equal((await (await getStatus("my-canvas")).json()).status, "foreign");
    assert.equal((await action("/api/reveal-output", { canvasId: "my-canvas" })).status, 422);
    assert.equal((await action("/api/open-generated", { canvasId: "my-canvas" })).status, 422);
    await writeFile(join(target, "settings-provenance.json"),
        JSON.stringify({ handoffId: handoff.handoffId, requestId: "request-1" }));
    assert.deepEqual(await (await getStatus("my-canvas")).json(),
        { status: "foreign", target: ".github/extensions/my-canvas/" });
    assert.equal((await action("/api/open-generated", { canvasId: "my-canvas" })).status, 422);
    await writeFile(join(target, "settings-provenance.json"), JSON.stringify({
        handoffId: handoff.handoffId, requestId: "request-1", sourceFingerprint: "a".repeat(64),
    }));
    assert.deepEqual(await (await getStatus("my-canvas")).json(),
        { status: "ready", target: ".github/extensions/my-canvas/", requestId: "request-1" });
    assert.equal((await action("/api/reveal-output", { canvasId: "my-canvas" })).status, 200);
    assert.equal(revealed[1], target);
    const withoutSkill = await action("/api/open-generated", { canvasId: "my-canvas" });
    assert.equal(withoutSkill.status, 422);
    assert.match((await withoutSkill.json()).error, /does not provide Open/);
    const openSkill = join(project, ".github", "skills",
        "speckit-extension-canvas-design-open-generated", "SKILL.md");
    await mkdir(dirname(openSkill), { recursive: true });
    await writeFile(openSkill, "---\nname: speckit-extension-canvas-design-open-generated\n---\n");
    dispatchFails = true;
    const failed = await action("/api/open-generated", { canvasId: "my-canvas" });
    assert.equal(failed.status, 202);
    assert.deepEqual(await failed.json(),
        { status: "opening", target: ".github/extensions/my-canvas/" });
    await waitFor(() => dispatchErrors.length === 1);
    assert.match(dispatchErrors[0].message, /Open dispatch failed: child session unavailable/);
    assert.deepEqual(dispatchErrors[0].options, { level: "error" });
    assert.equal(prompts.length, 0);
    dispatchFails = false;
    blockSend = true;
    const opened = await action("/api/open-generated", { canvasId: "my-canvas" });
    assert.equal(opened.status, 202);
    assert.deepEqual(await opened.json(),
        { status: "opening", target: ".github/extensions/my-canvas/" });
    await waitFor(() => prompts.length === 1 && resolveSend);
    assert.match(prompts[0], /speckit-extension-canvas-design-open-generated skill/);
    assert.match(prompts[0], /request-1/);
    resolveSend();
});

test("Generate accepts a saved Designer draft larger than 16KB", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const page = JSON.parse(await readFile(entries[0].path, "utf8"));
    for (let index = 0; index < 20; index++) {
        page.fields.push({ id: `custom.${index}`, label: `Custom ${index}` });
    }
    await writeFile(entries[0].path, JSON.stringify(page));
    const model = await loadResolvedDesignerPages(handoff, project, entries);
    const values = { ...model.values, "canvas.id": "large-canvas",
        "canvas.displayName": "Large Canvas" };
    for (let index = 0; index < 20; index++) values[`custom.${index}`] = "x".repeat(1000);
    const saved = await saveDesignerSettings(workspace, handoff, model,
        { modelRevision: model.revision, revision: 0, values });
    const body = JSON.stringify({ modelRevision: model.revision,
        settingsRevision: saved.settingsRevision, values });
    assert.ok(Buffer.byteLength(body) > 16 * 1024);
    assert.ok(Buffer.byteLength(body) < SETTINGS_LIMIT);
    const skill = join(project, ".github", "skills",
        "speckit-extension-canvas-design-generate", "SKILL.md");
    await mkdir(join(project, ".github", "skills", "speckit-extension-canvas-design-generate"));
    await writeFile(skill, "---\nname: speckit-extension-canvas-design-generate\n---\n");
    await installOpenSkill(project);
    const prompts = [];
    const shell = await startShell(handoff, saved, { project, workspace,
        session: { send: async (value) => prompts.push(value.prompt) } });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    url.pathname = "/api/generate";
    const response = await fetch(url, { method: "POST",
        headers: { "Content-Type": "application/json" }, body });
    assert.equal(response.status, 202);
    await waitFor(() => prompts.length === 1);
    const { requestId } = await response.json();
    const frozen = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", requestId, "request.json")));
    assert.equal(frozen.canvas.id, "large-canvas");
    assert.equal(frozen.values["custom.0"], "x".repeat(1000));
});

test("missing Generate skill disables the button and reports a repair path without preparing a request", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const model = await loadResolvedDesignerPages(handoff, project, entries);
    const prompts = [];
    const shell = await startShell(handoff, model, { project, workspace,
        session: { send: async (value) => prompts.push(value.prompt) } });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    const stateUrl = new URL(`/api/state?token=${url.searchParams.get("token")}`, url);
    const state = await (await fetch(stateUrl)).json();
    assert.equal(state.generationAvailable, false);
    assert.equal(state.generationError,
        "Canvas Design does not provide Generate in this session. Launch a new Designer session with a compatible Canvas Design extension or the current local source.");
    const generateUrl = new URL(`/api/generate?token=${url.searchParams.get("token")}`, url);
    const response = await fetch(generateUrl, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelRevision: model.revision, settingsRevision: 0, values: { ...model.values,
            "canvas.id": "my-canvas", "canvas.displayName": "My Canvas" } }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, state.generationError);
    assert.equal(prompts.length, 0);
    await assert.rejects(readdir(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations")), { code: "ENOENT" });
    const asset = await fetch(new URL(`/ui/generation-state.js?token=${url.searchParams.get("token")}`, url));
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /export const GENERATION_EXISTS/);
    assert.equal((await fetch(new URL("/ui/generation-state.js?token=wrong", url))).status, 404);
    const saveUrl = new URL(`/api/save?token=${url.searchParams.get("token")}`, url);
    const save = async (values, revision) => {
        const result = await fetch(saveUrl, { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelRevision: model.revision, revision, values }) });
        assert.equal(result.status, 200);
        return result.json();
    };
    const target = join(project, ".github", "extensions", "my-canvas");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "extension.mjs"), "export {};\n");
    const values = { ...model.values, "canvas.id": "my-canvas", "canvas.displayName": "My Canvas" };
    await save(values, 0);
    const duplicateState = await (await fetch(stateUrl)).json();
    assert.equal(duplicateState.generationAvailable, false);
    assert.equal(duplicateState.generationError, state.generationError);
    await save({ ...values, "canvas.id": "new-canvas" }, 1);
    const uniqueState = await (await fetch(stateUrl)).json();
    assert.equal(uniqueState.generationAvailable, false);
    assert.equal(uniqueState.generationError, state.generationError);
});

test("an older Generate-only package cannot dispatch a combined Generate and Open turn", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    const generateSkill = join(project, ".github", "skills",
        "speckit-extension-canvas-design-generate", "SKILL.md");
    await mkdir(dirname(generateSkill), { recursive: true });
    await writeFile(generateSkill, "---\nname: speckit-extension-canvas-design-generate\n---\n");
    const model = await loadDesignerSettings(workspace, handoff,
        await loadResolvedDesignerPages(handoff, project, entries, await stockTemplates(project)));
    const prompts = [];
    const shell = await startShell(handoff, model, { project, workspace,
        session: { send: async ({ prompt }) => prompts.push(prompt) } });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    const stateUrl = new URL(url);
    stateUrl.pathname = "/api/state";
    const state = await (await fetch(stateUrl)).json();
    assert.equal(state.generationAvailable, false);
    assert.match(state.generationError, /does not provide separate Generate and Open commands/);
    const generateUrl = new URL(url);
    generateUrl.pathname = "/api/generate";
    const response = await fetch(generateUrl, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelRevision: model.revision, settingsRevision: 0,
            values: { ...model.values, "canvas.id": "my-canvas",
                "canvas.displayName": "My Canvas" } }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, state.generationError);
    assert.equal(prompts.length, 0);
});

test("malformed raw request targets return 404 without stopping the shell", async (t) => {
    const shell = await startShell();
    t.after(() => shell.close());
    const url = new URL(shell.url);
    const status = await new Promise((resolve, reject) => {
        const req = request({ hostname: url.hostname, port: url.port, path: "//[" }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end();
    });
    assert.equal(status, 404);
    assert.equal((await fetch(shell.url)).status, 200);
});

test("empty shell renders without a handoff and keeps the token gate", async (t) => {
    const html = shellHtml();
    assert.match(html, /No Wizard handoff is attached yet/);
    assert.doesNotMatch(html, /Wizard handoff received|customizations queued/);
    const shell = await startShell();
    t.after(() => shell.close());
    assert.match(await (await fetch(shell.url)).text(), /No Wizard handoff is attached yet/);
    const url = new URL(shell.url);
    assert.equal((await fetch(url.origin)).status, 404);
});

test("preview Value match exposes the shipping ordered input shape", async () => {
    const shipping = JSON.parse(await readFile(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/generated-host/badges/rules/value-match.json",
        import.meta.url), "utf8"));
    const preview = previewModel().badgeRules.find(({ id }) => id === "value-match");
    assert.deepEqual(preview.inputs, shipping.inputs);
});

test("preview checklist progress matches the shipping badge type and rule", async () => {
    const root = new URL("../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url);
    const types = JSON.parse(await readFile(new URL("designer-host/badges-settings/badge-types.json", root)));
    const rule = JSON.parse(await readFile(new URL("generated-host/badges/rules/checklist-progress.json", root)));
    const preview = previewModel();
    const expected = types.types.find((entry) => entry.id === "checklist-progress");
    const actual = preview.badgeTypes.find((entry) => entry.id === "checklist-progress");
    assert.equal(actual.description, expected.description);
    assert.equal(actual.defaultText, expected.defaultText);
    assert.equal(preview.badgeRules.find((entry) => entry.id === rule.id).description,
        rule.description);
});

test("sample-only preview renders badges without a handoff and rejects writes", async (t) => {
    const shell = await startShell(null, previewModel(), { preview: true });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    assert.match(await (await fetch(shell.url)).text(), /id="preview-banner"/);
    const state = await (await fetch(new URL(`/api/state?token=${url.searchParams.get("token")}`, url))).json();
    assert.equal(state.preview, true);
    assert.equal(state.handoffId, undefined);
    assert.equal(state.generationAvailable, false);
    assert.deepEqual(state.pages.map((page) => page.page), ["designer-badges"]);
    assert.ok(state.badgeTypes.some((type) => type.id === "value-match"));
    assert.equal(state.badgeInputControls.length, state.badgeRules.length);
    assert.equal(state.badgeRules.find((rule) => rule.id === "checklist-complete")
        .placementPhaseInput, undefined);
    const stock = await fetch(new URL(
        `/adapters/preview-badge-input.mjs?token=${url.searchParams.get("token")}`, url));
    assert.equal(stock.status, 200);
    assert.match(await stock.text(), /export const controlId = "preview.badge-inputs"/);
    assert.ok(state.pipelineOutputs.clarify.outputs.length);
    for (const action of ["save", "generate"]) {
        const response = await fetch(new URL(`/api/${action}?token=${url.searchParams.get("token")}`, url),
            { method: "POST" });
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /Preview cannot save settings or generate/);
    }
    assert.equal((await fetch(url.origin)).status, 404);
    await assert.rejects(startShell(validHandoff(), previewModel(), { preview: true }),
        /requires a sample model and no Wizard handoff/);
});

test("reads the complete effective page set from the child checkout without a snapshot", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const { project, entries } = await projectFixture(t, workspace);
    await assertPageCommand(project);
    const override = join(project, ".specify", "presets", "override.json");
    await mkdir(join(project, ".specify", "presets"));
    const changed = JSON.parse(await readFile(entries[0].path, "utf8"));
    changed.title = "Custom Essentials";
    await writeFile(override, JSON.stringify(changed));
    const effective = [{ ...entries[0], path: override }, ...entries.slice(1)];
    const model = await loadResolvedDesignerPages(handoff, project, effective);
    assert.equal(model.pages[0].title, "Custom Essentials");
    assert.equal(model.pages[0].provenance.path, override);
    assert.equal((await loadResolvedDesignerPages(handoff, project, effective)).revision, model.revision);
    const partial = await loadResolvedDesignerPages(handoff, project, entries.slice(1));
    assert.deepEqual(partial.pages.map((page) => page.page),
        entries.slice(1).map((entry) => entry.name));
    assert.match(generationBlockers(partial)[0], /Essentials must contain Canvas ID and Title/);
    const withoutBadges = await loadResolvedDesignerPages(handoff, project,
        entries.filter((entry) => entry.name !== "designer-badges"));
    assert.deepEqual(generationBlockers(withoutBadges), []);
    const ready = await freezeGeneration({ model: withoutBadges, handoff, project, workspace,
        values: { ...withoutBadges.values, "canvas.id": "without-badges",
            "canvas.displayName": "Without badges" } });
    assert.ok(ready.requestId);
    const empty = await loadFixturePages(handoff, project, [], []);
    assert.deepEqual(empty.pages, []);
    assert.match(empty.compositionErrors.join(" "), /Workflow page is not registered/);
    const workflow = scalarFixtures.get(project).find((item) => item.name === "generated-workflow");
    const originalWorkflow = await readFile(workflow.path);
    try {
        await writeFile(workflow.path, "{invalid json");
        const malformed = await loadResolvedDesignerPages(handoff, project, entries);
        assert.deepEqual(malformed.pages.map((page) => page.page), entries.map((entry) => entry.name));
        assert.match(malformed.compositionErrors.join(" "),
            /generated-workflow \(from extension:extension-canvas-design\): Invalid Designer JSON/);
        assert.match(generationBlockers(malformed).join(" "), /generated-workflow/);
    } finally {
        await writeFile(workflow.path, originalWorkflow);
    }
    await assert.rejects(loadResolvedDesignerPages(handoff, project, [...entries, entries[0]]),
        /duplicate Designer page name/);
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [{ ...entries[0], path: join(project, ".specify", "missing.json") }, ...entries.slice(1)]),
    /ENOENT/);
    const missingParentPath = join(project, ".specify", "not-created", "nested", "setup.json");
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [{ ...entries[0], path: missingParentPath }, ...entries.slice(1)]), /ENOENT/);
    await writeFile(join(workspace, "outside.json"), JSON.stringify(changed));
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [{ ...entries[0], path: join(workspace, "outside.json") }, ...entries.slice(1)]),
    /inside \.specify/);
    const extra = join(project, ".specify", "presets", "extra.json");
    await writeFile(extra, JSON.stringify({ schemaVersion: 1, id: "extra-settings",
        title: "Extra", order: 5, enabled: true, fields: [] }));
    const withExtra = await loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }]);
    assert.equal(withExtra.pages[0].title, "Extra");
    assert.equal(withExtra.pages.length, 4);
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.default-tab-definition", strategy: "replace" }]),
    /Invalid Designer page name\/path/);
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [{ ...effective[0], kind: "designer.added-tab-definition" }, ...effective.slice(1)]),
    /Invalid Designer page name\/path/);
    await writeFile(extra, JSON.stringify({ schemaVersion: 1, id: "extra-settings",
        title: "Extra", order: 5, enabled: false, fields: [] }));
    assert.equal((await loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }])).pages.length, 3);
    await writeFile(extra, JSON.stringify({ schemaVersion: 1, id: "extra-settings",
        enabled: false, order: "invalid", fields: "invalid" }));
    const disabled = await loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }]);
    assert.equal(disabled.pages.length, 3);
    assert.equal(disabled.pages.some((page) => page.error), false);
    const disabledValues = { ...disabled.values, "canvas.id": "disabled-page",
        "canvas.displayName": "Disabled page" };
    assert.deepEqual(validateEssentials(disabled, disabledValues), disabledValues);
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }],
        [{ name: "extra-settings", path: extra, sourceId: "aaa" }]),
    /Invalid or duplicate Canvas Design template: extra-settings/);
    await writeFile(extra, JSON.stringify({ schemaVersion: 1, id: "extra-settings",
        title: "Extra", order: "invalid", fields: [] }));
    const invalidOrder = await loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }]);
    assert.match(invalidOrder.pages.at(-1).error.reason, /expected integer/);
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }],
        [{ name: "extra-settings", path: extra, sourceId: "aaa" }]),
    /Invalid or duplicate Canvas Design template: extra-settings/);
    await writeFile(extra, " ".repeat(256 * 1024 + 1));
    const oversized = await loadResolvedDesignerPages(handoff, project,
        [...effective, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }]);
    assert.match(oversized.pages.at(-1).error.reason, /exceeds its size limit/);
    changed.id = "wrong-page";
    await writeFile(override, JSON.stringify(changed));
    const wrongId = await loadResolvedDesignerPages(handoff, project, effective);
    assert.match(wrongId.pages[0].error.reason, /page id does not match/);
    assert.equal(wrongId.pages[0].fields, undefined);
    await assert.rejects(readFile(join(handoffDirectory(workspace, handoff.handoffId), "pages.json")),
        { code: "ENOENT" });
});

test("valid large page files do not inflate the Designer model with raw bytes", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    for (const entry of entries) {
        const contents = await readFile(entry.path, "utf8");
        await writeFile(entry.path, contents + " ".repeat(256 * 1024 - Buffer.byteLength(contents)));
    }
    const model = await loadResolvedDesignerPages(validHandoff(), project, entries);
    assert.deepEqual(model.pages.map((page) => page.page), entries.map((entry) => entry.name));
});

test("registered contributions validate slots, sources, references and deterministic order", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const handoff = validHandoff();
    const directory = join(project, ".specify", "presets");
    await mkdir(directory);
    const make = (id, sourceId, fieldId, overrides = {}) => ({
        name: `canvas-contribution-${id}`, path: join(directory, `${id}.json`), sourceId,
        kind: "designer.setting-definition", strategy: "replace",
        document: { schemaVersion: 1, id, host: "designer", slot: "essentials.options",
            order: 30, field: { id: fieldId, label: id, type: "string", control: "stock.text" },
            ...overrides },
    });

    await t.test("Billing fixture resolves only registered pages, and both slots save and freeze the same field", async (t) => {
        const workspace = await fixture(t);
        const { project, entries } = await projectFixture(t, workspace);
        const handoff = validHandoff();
        handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
        handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
        await saveHandoff(workspace, handoff);
        const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-billing-canvas-test/",
            import.meta.url));
        const directory = join(project, ".specify", "presets");
        await mkdir(directory);
        const pagePath = join(directory, "billing-page.json");
        const contributionPath = join(directory, "billing-contribution.json");
        await copyFile(join(preset, "designer", "tabs", "billing.json"), pagePath);
        const pageEntry = { name: "canvas-settings-billing", path: pagePath,
            kind: "designer.tab-definition", strategy: "replace" };
        const contribution = JSON.parse(await readFile(join(preset, "designer", "settings", "billing.json")));
        const templates = [{ name: "canvas-contributions-billing", path: contributionPath,
            sourceId: "copilot-billing-canvas-test",
            kind: "designer.setting-definition", strategy: "replace" }];
        const { materialize } = await import(new URL("../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs",
            import.meta.url));
        for (const slot of ["billing.options", "essentials.options"]) {
            await t.test(slot, async () => {
                await writeFile(contributionPath, JSON.stringify({ ...contribution, slot }));
                const unregistered = await loadResolvedDesignerPages(handoff, project, entries);
                assert.equal(unregistered.pages.length, 3);
                assert.equal(unregistered.values["billing.costCode"], undefined);
                const model = await loadResolvedDesignerPages(handoff, project,
                    [...entries, pageEntry], templates);
                assert.deepEqual(model.pages.map((page) => page.title),
                    ["Essentials", "Badges", "Appearance", "Billing"]);
                assert.equal(model.pages.find((page) => page.fields.some((field) =>
                    field.id === "billing.costCode")).page,
                slot === "essentials.options" ? "designer-essentials" : "canvas-settings-billing");
                assert.equal(model.constraints["billing.costCode"].maxLength, 64);
                const values = { ...model.values, "canvas.id": `cost-${slot.split(".")[0]}`,
                    "canvas.displayName": "Cost code test", "billing.costCode": "CC-481" };
                const request = { modelRevision: model.revision, revision: 0, values };
                const incomplete = await saveDesignerSettings(workspace, handoff, model, {
                    ...request, values: { ...values, "billing.costCode": "x".repeat(65) },
                });
                assert.equal(incomplete.values["billing.costCode"].length, 65);
                await assert.rejects(freezeGeneration({ model, values: {
                    ...values, "billing.costCode": "x".repeat(65) },
                handoff, project, workspace }), /Invalid Cost code \(billing.costCode\)/);
                await assert.rejects(freezeGeneration({ model, values: {
                    ...values, "canvas.displayName": "" },
                handoff, project, workspace }), /canvas.displayName|Canvas ID and Title/);
                const saved = await saveDesignerSettings(workspace, handoff, model,
                    { ...request, revision: 1 });
                assert.equal((await loadDesignerSettings(workspace, handoff, model))
                    .values["billing.costCode"], "CC-481");
                const prepared = await freezeGeneration({ model: saved, values: saved.values,
                    handoff, project, workspace });
                const frozen = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
                    "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json")));
                assert.equal(frozen.values["billing.costCode"], "CC-481");
                assert.deepEqual(frozen.generatedFields, [{ id: "billing.costCode",
                    label: "Cost code", maxLength: 64,
                    section: { id: "billing", title: "Billing" } }]);
                await materialize(project, workspace, handoff.handoffId, prepared.requestId);
                const config = JSON.parse(await readFile(join(project, prepared.target,
                    "canvas-config.json"), "utf8"));
                assert.deepEqual(config.readOnlyFields, [{ id: "billing.costCode",
                    label: "Cost code", value: "CC-481",
                    section: { id: "billing", title: "Billing" } }]);
            });
            if (slot === "billing.options") {
                const model = await loadResolvedDesignerPages(handoff, project, [...entries, pageEntry], templates);
                const missingSlot = await loadResolvedDesignerPages(handoff, project, entries, templates);
                assert.match(missingSlot.compositionErrors.join(" "),
                    /canvas-contributions-billing \(from copilot-billing-canvas-test\):.*unknown Designer slot billing.options/);
                assert.ok(!missingSlot.values["billing.costCode"]);
                assert.equal(model.pages.length, 4);
                await rm(join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
                    "settings.json"));
            }
        }
        for (const patch of [
            { field: { ...contribution.field, maxLength: 1001 } },
            { field: { ...contribution.field, maxLength: 0 } },
            { generatedBinding: { presentation: "unknown" } },
            { generatedBinding: { presentation: "stock.readonly", adapter: "foreign" } },
            { generatedBinding: { presentation: "stock.readonly",
                section: { id: "", title: "Billing" } } },
            { generatedBinding: { presentation: "stock.readonly",
                section: { id: "billing", title: " " } } },
            { generatedBinding: { presentation: "stock.readonly",
                section: { id: "billing", title: "Billing", extra: true } } },
        ]) {
            await writeFile(contributionPath, JSON.stringify({ ...contribution, ...patch }));
            await assert.rejects(loadResolvedDesignerPages(handoff, project,
                [...entries, pageEntry], templates), /incompatible/);
        }
        await writeFile(contributionPath, JSON.stringify(contribution));
        const secondPath = join(directory, "second.json");
        const second = { ...contribution, id: "billing-second",
            field: { ...contribution.field, id: "billing.second" },
            generatedBinding: { presentation: "stock.readonly",
                section: { id: "other-billing", title: "Billing" } } };
        await writeFile(secondPath, JSON.stringify(second));
        const secondEntry = { name: "canvas-contributions-second", path: secondPath,
            sourceId: "copilot-billing-canvas-test",
            kind: "designer.setting-definition", strategy: "replace" };
        const sameTitle = await loadResolvedDesignerPages(handoff, project,
            [...entries, pageEntry], [...templates, secondEntry]);
        assert.deepEqual(sameTitle.contributions.map((item) => item.generatedBinding.section.title),
            ["Billing", "Billing"]);
        await writeFile(secondPath, JSON.stringify({ ...second, generatedBinding: {
            presentation: "stock.readonly", section: { id: "billing", title: "Other title" },
        } }));
        await assert.rejects(loadResolvedDesignerPages(handoff, project,
            [...entries, pageEntry], [...templates, secondEntry]), /conflicting generated section billing/);
    });
    const beta = make("beta", "zzz", "billing.beta");
    const alpha = make("alpha", "aaa", "billing.alpha");
    for (const item of [beta, alpha]) await writeFile(item.path, JSON.stringify(item.document));
    const paths = [beta, alpha].map(({ name, path, sourceId, kind, strategy }) =>
        ({ name, path, sourceId, kind, strategy }));
    const model = await loadResolvedDesignerPages(handoff, project, entries, paths);
    assert.deepEqual(model.contributions.map((item) => item.id), ["alpha", "beta"]);
    assert.deepEqual(model.pages[0].fields.slice(-2).map((field) => field.id),
        ["billing.alpha", "billing.beta"]);
    assert.equal(model.constraints["billing.alpha"].maxLength, 1000);
    assert.equal(model.values["billing.alpha"], "");
    assert.equal(model.pages.length, 3);
    const defaultModel = await loadResolvedDesignerPages(handoff, project, entries);
    assert.deepEqual(defaultModel.contributions, []);
    assert.equal(defaultModel.pages[0].fields.length, 2);
    assert.notEqual((await loadResolvedDesignerPages(handoff, project, entries, paths.slice(1))).revision,
        model.revision);

    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, [...paths, paths[0]]),
        /duplicate Canvas Design template/);
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, [
        { ...paths[0], name: entries[0].name },
    ]), /duplicate Canvas Design template/);
    await writeFile(beta.path, JSON.stringify({ ...beta.document,
        field: { ...beta.document.field, id: "billing.alpha" } }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, paths),
        /canvas-contribution-beta: duplicate field billing.alpha also defined by canvas-contribution-alpha|canvas-contribution-alpha: duplicate field billing.alpha also defined by canvas-contribution-beta/);
    await writeFile(beta.path, JSON.stringify({ ...beta.document,
        field: { ...beta.document.field, id: "canvas.id" } }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, paths),
        /canvas-contribution-beta: duplicate field canvas.id also defined by designer-essentials/);
    await writeFile(beta.path, JSON.stringify({ ...beta.document, slot: "unknown.slot" }));
    const missingSlot = await loadResolvedDesignerPages(handoff, project, entries, paths);
    assert.match(missingSlot.compositionErrors.join(" "),
        /canvas-contribution-beta \(from zzz\):.*unknown Designer slot unknown.slot/);
    assert.deepEqual(missingSlot.contributions.map((item) => item.name), ["canvas-contribution-alpha"]);
    await writeFile(beta.path, JSON.stringify({ ...beta.document, slot: "unknown.slot",
        field: { ...beta.document.field, label: "" } }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, paths),
        /incompatible field or control definition/);
    await writeFile(beta.path, JSON.stringify({ ...beta.document, requires: ["missing-template"] }));
    const missingControl = await loadResolvedDesignerPages(handoff, project, entries, paths);
    assert.match(missingControl.compositionErrors.join(" "),
        /canvas-contribution-beta \(from zzz\): missing or incompatible shared control definition stock.text/);
    assert.deepEqual(missingControl.contributions.map((item) => item.name), ["canvas-contribution-alpha"]);
    await writeFile(beta.path, JSON.stringify(beta.document));
    const replacement = join(directory, "project-replacement.json");
    await writeFile(replacement, JSON.stringify({ ...beta.document,
        field: { ...beta.document.field, label: "Replaced cost code" } }));
    const projectWinner = { ...paths[0], path: replacement, sourceId: "project" };
    const projectModel = await loadResolvedDesignerPages(handoff, project, entries,
        [projectWinner, paths[1]]);
    assert.equal(projectModel.contributions.find((item) => item.id === "beta").sourceId, "project");
    assert.equal(projectModel.pages[0].fields.at(-1).label, "Replaced cost code");
    assert.notEqual(projectModel.revision, model.revision);
    const duplicateSlot = JSON.parse(await readFile(entries[1].path, "utf8"));
    duplicateSlot.slots = [{ id: "essentials.options" }];
    await writeFile(entries[1].path, JSON.stringify(duplicateSlot));
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, paths),
        /duplicate Designer slot essentials.options also defined by designer-essentials/);
    delete duplicateSlot.slots;
    await writeFile(entries[1].path, JSON.stringify(duplicateSlot));
    const originalTab = await readFile(entries[1].path, "utf8");
    const tab = JSON.parse(originalTab);
    for (const obsolete of [{ accepts: ["field"] }, { orderBy: ["order", "presetId", "id"] }]) {
        await writeFile(entries[1].path, JSON.stringify({
            ...tab, slots: [{ id: "artifacts.options", ...obsolete }],
        }));
        assert.ok((await loadResolvedDesignerPages(handoff, project, entries, paths))
            .pages.find((page) => page.page === "designer-badges").error);
    }
    await writeFile(entries[1].path, originalTab);
    const modulePath = join(directory, "new-control.mjs");
    await writeFile(modulePath, "export const control = () => null;\n");
    const moduleEntry = { name: "canvas-control-new", path: modulePath, sourceId: "aaa",
        kind: "generated.added-page-renderer", strategy: "replace" };
    const registration = () => ({ kind: "template", stack: [
        { active: true, sourceId: "aaa", layer: "preset", strategy: "replace" }] });
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries,
        [...paths, moduleEntry], registration), /invalid generated renderer/);
    await writeFile(modulePath, Buffer.from([0xff]));
    const invalidModule = await loadResolvedDesignerPages(handoff, project, entries,
        [...paths, moduleEntry], registration);
    assert.match(invalidModule.compositionErrors.join(" "), /canvas-control-new \(from aaa\): Invalid Designer UTF-8/);
    await writeFile(modulePath, "export function renderPage({ root }) { root.textContent = 'ok'; }\n");
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries,
        [...paths, { ...moduleEntry, path: join(directory, "missing.mjs") }],
        registration), /ENOENT/);
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries,
        [...paths, moduleEntry], registration), /generated renderer must belong to exactly one page/);
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, [
        { ...paths[0], path: join(workspace, "outside.json") },
    ]), /inside \.specify/);
});

test("resolved contributions cannot enlarge the assembled Designer model past its limit", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const handoff = validHandoff();
    const directory = join(project, ".specify", "presets");
    await mkdir(directory);
    const pages = [...entries];
    for (let pageIndex = 0; pageIndex < 17; pageIndex++) {
        const name = `canvas-settings-extra-${pageIndex}`;
        const path = join(directory, `${name}.json`);
        await writeFile(path, JSON.stringify({
            schemaVersion: 1, id: name, title: name, order: 100 + pageIndex,
            fields: Array.from({ length: 100 }, (_, fieldIndex) => ({
                id: `extra.${pageIndex}.${fieldIndex}`, label: "Field",
                description: "x".repeat(1000),
            })),
        }));
        pages.push({ name, path, kind: "designer.tab-definition", strategy: "replace" });
    }
    const baseline = await loadResolvedDesignerPages(handoff, project, pages);
    assert.ok(Buffer.byteLength(JSON.stringify(baseline)) <= 2 * 1024 * 1024);
    const contributions = [];
    for (let index = 0; index < 85; index++) {
        const name = `canvas-contribution-extra-${index}`;
        const path = join(directory, `${name}.json`);
        await writeFile(path, JSON.stringify({
            schemaVersion: 1, id: `extra-${index}`, host: "designer",
            slot: "essentials.options", order: index,
            field: { id: `added.${index}`, label: "Field", description: "y".repeat(1000),
                type: "string", control: "stock.text" },
        }));
        contributions.push({ name, path, sourceId: "test",
            kind: "designer.setting-definition", strategy: "replace" });
    }
    await assert.rejects(loadResolvedDesignerPages(handoff, project, pages, contributions),
        /Designer page model exceeds its size limit/);
});

test("page errors retain healthy fields and never accept unsafe or incomplete input", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const handoff = validHandoff();
    const extra = join(project, ".specify", "extra.json");
    await writeFile(extra, JSON.stringify({ schemaVersion: 1, id: "extra-settings",
        title: "Extra", order: 5, fields: [{ id: "canvas.id", label: "Collision" }] }));
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [...entries, { name: "extra-settings", path: extra,
            kind: "designer.tab-definition", strategy: "replace" }]),
    /extra-settings: duplicate enabled field canvas.id also defined by designer-essentials/);

    await writeFile(entries[0].path, "{invalid");
    const broken = await loadResolvedDesignerPages(handoff, project, entries);
    assert.equal(broken.pages[0].page, "designer-essentials");
    assert.match(broken.pages[0].error.reason, /Invalid Designer JSON/);
    assert.equal(broken.pages[0].error.path, entries[0].path);
    assert.equal(Object.hasOwn(broken.values, "canvas.id"), false);
    assert.equal(broken.pages[1].title, "Badges");
    await assert.rejects(loadResolvedDesignerPages(handoff, project, entries.map((entry, i) =>
        ({ ...entry, path: join(project, ".specify", `missing-${i}.json`) }))), /ENOENT/);
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [...entries.slice(0, 2), { ...entries[2], path: join(workspace, "outside.json") }]),
    /inside \.specify/);
    const outside = join(workspace, "outside.json");
    await writeFile(outside, "{}");
    const alias = join(project, ".specify", "alias.json");
    let linked = false;
    try {
        await symlink(outside, alias, "file");
        linked = true;
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; page alias assertion skipped");
    }
    if (linked) {
        await assert.rejects(loadResolvedDesignerPages(handoff, project,
            [{ ...entries[0], path: alias }, ...entries.slice(1)]),
        /escapes its allowed directory/);
    }
    const outsideAlias = join(project, ".specify", "outside-alias");
    try {
        await symlink(workspace, outsideAlias, process.platform === "win32" ? "junction" : "dir");
        await assert.rejects(loadResolvedDesignerPages(handoff, project,
            [{ ...entries[0], path: join(outsideAlias, "missing-dir", "setup.json") },
                ...entries.slice(1)]), /escapes its allowed directory/);
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; parent alias assertion skipped");
    }
    await assert.rejects(loadResolvedDesignerPages(handoff, project,
        [entries[0], entries[0], ...entries.slice(2)]), /duplicate Designer page name/);
});

test("generated-only page validates typed assets, freezes winners and packages without design presets", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-generated-page-test/",
        import.meta.url));
    const directory = join(project, ".specify", "presets");
    await mkdir(directory);
    const definitionPath = join(directory, "overview.json");
    const rendererPath = join(directory, "overview.mjs");
    await copyFile(join(preset, "generated", "pages", "overview.json"), definitionPath);
    await copyFile(join(preset, "generated", "pages", "overview.mjs"), rendererPath);
    const definition = JSON.parse(await readFile(definitionPath, "utf8"));
    const renderer = await readFile(rendererPath, "utf8");
    const pages = [
        { name: definition.id, path: definitionPath, sourceId: "copilot-generated-page-test",
            kind: "generated.added-page-definition", strategy: "replace" },
        { name: definition.renderer, path: rendererPath, sourceId: "copilot-generated-page-test",
            kind: "generated.added-page-renderer", strategy: "replace" },
    ];
    const registration = () => ({ kind: "template", stack: [{
        active: true, sourceId: "copilot-generated-page-test", layer: "preset",
        strategy: "replace",
    }] });
    const load = (assets) => loadResolvedDesignerPages(handoff, project, entries, assets, registration);
    const defaults = await loadResolvedDesignerPages(handoff, project, entries);
    assert.deepEqual(defaults.generatedPages, []);
    const tooManyPages = Array.from({ length: 31 }, (_, index) => ({
        ...pages[0], name: `generated-page-${index}`,
    }));
    await assert.rejects(load(tooManyPages), /at most 30 generated pages/);
    let loaded;
    const executable = process.execPath;
    try {
        process.execPath = join(workspace, "copilot.exe");
        loaded = await load(pages);
    } finally {
        process.execPath = executable;
    }
    assert.deepEqual(loaded.pages.map((page) => page.page), defaults.pages.map((page) => page.page));
    assert.deepEqual(loaded.values, defaults.values);
    assert.deepEqual(loaded.generatedPages, [{ name: definition.id, ...definition }]);
    const projectPages = pages.map((page) => ({ ...page, sourceId: "project" }));
    const projectRegistration = () => ({ kind: "template", stack: [{
        active: true, sourceId: "_", layer: "project", strategy: "replace",
    }] });
    assert.deepEqual((await loadResolvedDesignerPages(handoff, project, entries,
        projectPages, projectRegistration)).generatedPages, loaded.generatedPages);
    for (const [assets, source] of [
        [projectPages, { sourceId: "_", layer: "preset" }],
        [pages, { sourceId: "copilot-generated-page-test", layer: "project" }],
        [pages.map((page) => ({ ...page, sourceId: "extension:copilot-generated-page-test" })),
            { sourceId: "copilot-generated-page-test", layer: "preset" }],
    ]) {
        await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, assets,
            () => ({ kind: "template", stack: [{
                active: true, ...source, strategy: "replace",
            }] })), /replace-only Specify template/);
    }
    const missingRenderer = await load(pages.slice(0, 1));
    assert.match(missingRenderer.compositionErrors.join(" "),
        /canvas-generated-overview \(from copilot-generated-page-test\): missing generated renderer/);
    assert.ok(generationBlockers(missingRenderer).length);
    for (const candidate of [
        [pages.slice(1), /renderer must belong to exactly one page/],
        [[{ ...pages[0], kind: "designer.setting-definition" }, pages[1]], /Canvas Design contribution/],
        [[{ ...pages[0], path: rendererPath }, pages[1]], /must be a \.json/],
        [[pages[0], { ...pages[1], path: definitionPath }], /must be a \.mjs/],
        [[pages[0], { ...pages[1], kind: "designer.setting-definition" }], /must be a \.json/],
        [[pages[0], { ...pages[1], strategy: "append" }], /Invalid or duplicate Canvas Design template/],
        [[pages[0], { ...pages[1], strategy: "wrap" }], /Invalid or duplicate Canvas Design template/],
        [[pages[0], { ...pages[1], kind: "script" }], /Invalid or duplicate Canvas Design template/],
    ]) await assert.rejects(load(candidate[0]), candidate[1]);
    for (const invalid of [
        { kind: "script", stack: [{ active: true, sourceId: "copilot-generated-page-test",
            layer: "preset", strategy: "replace" }] },
        { kind: "template", stack: [{ active: true, sourceId: "copilot-generated-page-test",
            layer: "preset", strategy: "append" }] },
        { kind: "template", stack: [{ active: true, sourceId: "copilot-generated-page-test",
            layer: "preset", strategy: "replace" }, { active: false, strategy: "wrap" }] },
    ]) await assert.rejects(loadResolvedDesignerPages(handoff, project, entries, pages,
        () => invalid), /replace-only Specify template/);
    await writeFile(definitionPath, JSON.stringify({ ...definition, renderer: "missing-renderer" }));
    await assert.rejects(load(pages), /generated renderer must belong to exactly one page/);
    await writeFile(definitionPath, JSON.stringify({ ...definition, extra: true }));
    await assert.rejects(load(pages), /invalid generated page definition/);
    await writeFile(definitionPath, JSON.stringify({ ...definition, id: "workflow" }));
    await assert.rejects(load([{ ...pages[0], name: "workflow" }, pages[1]]),
        /invalid generated page definition/);
    for (const name of ["con", "prn", "aux", "nul", "com1", "lpt9"]) {
        await writeFile(definitionPath, JSON.stringify({ ...definition, id: name }));
        await assert.rejects(load([{ ...pages[0], name }, pages[1]]),
            /Invalid or duplicate Canvas Design template/);
        await writeFile(definitionPath, JSON.stringify({ ...definition, renderer: name }));
        await assert.rejects(load([pages[0], { ...pages[1], name }]),
            /invalid generated page definition/);
    }
    await writeFile(definitionPath, JSON.stringify(definition));
    await writeFile(rendererPath, "export function renderPage( {");
    await assert.rejects(load(pages), /invalid generated renderer/);
    await writeFile(rendererPath, "import './missing.mjs'; export function renderPage() {}");
    await assert.rejects(load(pages), /renderer must be self-contained/);
    await writeFile(join(directory, "helper.mjs"), "export function renderPage() {}");
    await writeFile(rendererPath,
        "const label = 'Overview'; import { renderPage } from './helper.mjs'; export { renderPage };");
    await assert.rejects(load(pages), /renderer must be self-contained/);
    await writeFile(rendererPath, "export { renderPage } from './helper.mjs';");
    await assert.rejects(load(pages), /renderer must be self-contained/);
    await writeFile(rendererPath,
        "export async function renderPage() { return import('./helper.mjs'); }");
    await assert.rejects(load(pages), /renderer must be self-contained/);
    await writeFile(rendererPath,
        "export function renderPage() { return import.meta.url + 'import(\"./helper.mjs\")'; }");
    assert.equal((await load(pages)).generatedPages.length, 1);
    await writeFile(rendererPath, "export const renderPage = null;");
    assert.equal((await load(pages)).generatedPages.length, 1);
    await writeFile(rendererPath, "export const renderPage = ;");
    await assert.rejects(load(pages), /invalid generated renderer/);
    await writeFile(rendererPath, "export function otherPage() {}");
    await assert.rejects(load(pages), /invalid generated renderer/);
    await writeFile(rendererPath, "const href = window.location.href; export function renderPage() { return href; }");
    assert.equal((await load(pages)).generatedPages.length, 1);
    const sideEffectPath = join(workspace, "renderer-evaluated");
    await writeFile(rendererPath,
        `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(sideEffectPath)}, "executed"); export function renderPage() {}`);
    assert.equal((await load(pages)).generatedPages.length, 1);
    await assert.rejects(stat(sideEffectPath), { code: "ENOENT" });
    await writeFile(rendererPath, renderer);
    const billing = JSON.parse(await readFile(new URL(
        "../../../../../tests/fixtures/test-presets/copilot-billing-canvas-test/designer/settings/billing.json",
        import.meta.url)));
    const billingPath = join(directory, "billing.json");
    await writeFile(billingPath, JSON.stringify({ ...billing, slot: "essentials.options" }));
    const model = await load([...pages, { name: "canvas-contributions-billing",
        path: billingPath, sourceId: "copilot-billing-canvas-test",
        kind: "designer.setting-definition", strategy: "replace" }]);
    assert.equal(model.pages.length, 3);
    assert.ok(model.pages[0].fields.some((field) => field.id === "billing.costCode"));
    const values = { ...model.values, "canvas.id": "generated-only",
        "canvas.displayName": "Generated Only", "billing.costCode": "CC-481" };
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    await writeFile(rendererPath, `${renderer}\n// changed`);
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /changed since Designer opened/);
    await writeFile(rendererPath, "x".repeat(32 * 1024 + 1));
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /exceeds its size limit/);
    await writeFile(rendererPath, renderer);
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const target = join(project, prepared.target);
    assert.deepEqual(JSON.parse(await readFile(join(target, "pages", `${definition.id}.json`))), definition);
    assert.equal(await readFile(join(target, "pages", `${definition.renderer}.mjs`), "utf8"), renderer);
    const portable = join(workspace, "portable");
    await mkdir(portable);
    const { cp } = await import("node:fs/promises");
    await cp(target, join(portable, "generated-only"), { recursive: true });
    const { readConfig, renderHtml, createWorkflowRoutes } = await import(pathToFileURL(
        join(portable, "generated-only", "server.mjs")).href);
    const config = readConfig();
    assert.deepEqual(config.generatedPages, [{ id: definition.id,
        title: definition.title, renderer: definition.renderer }]);
    assert.equal(config.readOnlyFields[0].value, "CC-481");
    assert.match(renderHtml(config), /data-canvas-page="canvas-generated-overview"/);
    assert.match(renderHtml(config), /data-generated-renderer="canvas-generated-overview"[^>]*data-values="\{\}"/);
    const declaredHtml = renderHtml({ ...config, generatedPages: config.generatedPages.map((entry) => ({
        ...entry, values: ["billing.costCode"],
    })) });
    assert.match(declaredHtml, /data-generated-renderer="canvas-generated-overview"[^>]*data-values="\{&quot;billing.costCode&quot;:&quot;CC-481&quot;\}"/);
    assert.doesNotMatch(renderHtml({ ...config, generatedPages: undefined }), /data-canvas-page=/);
    assert.equal(typeof createWorkflowRoutes, "function");
    assert.equal((await import(pathToFileURL(join(portable, "generated-only", "pages",
        `${definition.renderer}.mjs`)).href)).renderPage.name, "renderPage");
    assert.ok((await readFile(join(portable, "generated-only", "ui", "app.js"), "utf8"))
        .includes("wireGeneratedPages()"));
    assert.match(await readFile(join(portable, "generated-only", "ui", "app.js"), "utf8"),
        /JSON\.parse\(registration\.dataset\.values\)/);
});

test("named value sources freeze typed values and run from a portable canvas without a design preset", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const preset = fileURLToPath(new URL(
        "../../../../../tests/fixtures/test-presets/copilot-canvas-values-test/", import.meta.url));
    const directory = join(project, ".specify", "presets");
    await mkdir(directory);
    const items = [
        ["canvas-value-heading", "values/heading.json", "generated.value-definition"],
        ["canvas-value-enabled", "values/enabled.json", "generated.value-definition"],
        ["canvas-value-choice", "values/choice.json", "generated.value-definition"],
        ["canvas-value-note", "values/note.json", "generated.value-definition"],
        ["canvas-value-workflow", "values/workflow.json", "generated.value-definition"],
        ["canvas-value-workflow-provider", "values/workflow.mjs", "generated.computed-value-provider"],
        ["canvas-value-processing", "values/processing.json", "generated.value-definition"],
        ["canvas-generated-values", "generated/pages/values.json", "generated.added-page-definition"],
        ["canvas-generated-values-renderer", "generated/pages/values.mjs", "generated.added-page-renderer"],
    ];
    const command = await readFile(join(preset, "commands", "load-page.md"), "utf8");
    for (const [name, , kind] of items) {
        assert.ok(command.includes(`- \`${name}\` — \`${kind}\`, \`replace\``));
    }
    const templates = await Promise.all(items.map(async ([name, file, kind]) => {
        const path = join(directory, `${name}${file.endsWith(".mjs") ? ".mjs" : ".json"}`);
        await copyFile(join(preset, ...file.split("/")), path);
        return { name, path, kind, sourceId: "copilot-canvas-values-test", strategy: "replace" };
    }));
    for (const item of [templates[0], templates[7]]) {
        await writeFile(item.path, JSON.stringify({
            $schema: "../schemas/authoring.json",
            ...JSON.parse(await readFile(item.path, "utf8")),
        }));
    }
    const registration = () => ({ kind: "template", stack: [{
        active: true, sourceId: "copilot-canvas-values-test", layer: "preset", strategy: "replace",
    }] });
    const load = (assets = templates, verify = registration) =>
        loadResolvedDesignerPages(handoff, project, entries, assets, verify);
    const definition = templates[0], provider = templates[5], page = templates[7];
    const model = await load();
    assert.deepEqual(model.valueSources.map(({ id }) => id).sort(),
        ["demo.choice", "demo.enabled", "demo.heading", "demo.note", "demo.processing", "demo.workflow"]);
    assert.deepEqual(model.generatedPages[0].values, ["demo.processing"]);
    assert.equal(Object.hasOwn(model.values, "demo.note"), false);
    assert.notEqual((await load(templates.filter((asset) => asset !== definition))).revision, model.revision);
    for (const assets of [
        templates.filter((asset) => asset !== provider),
        templates.map((asset) => asset === provider ? { ...asset, kind: "designer.setting-definition" } : asset),
        templates.map((asset) => asset === definition ? { ...asset, strategy: "append" } : asset),
    ]) await assert.rejects(load(assets), /value provider|must be a \.json|Invalid or duplicate/);
    await assert.rejects(load(templates, () => ({ kind: "template", stack: [{
        active: true, sourceId: "copilot-canvas-values-test", layer: "preset", strategy: "append",
    }] })), /replace-only Specify template/);
    const originalDefinition = await readFile(definition.path, "utf8");
    for (const invalid of [
        { schema: { type: "string", maxLength: 0 } },
        { source: { kind: "constant", value: 42 } },
        { source: { kind: "provider", module: "canvas-value-workflow-provider" } },
        { source: { kind: "computed", module: "../outside" } },
        { presentation: "unknown" },
    ]) {
        await writeFile(definition.path, JSON.stringify({
            ...JSON.parse(originalDefinition), ...invalid,
        }));
        await assert.rejects(load(), /invalid Canvas Design value source|invalid typed constant value/);
    }
    for (const module of ["con", "com1", "lpt9"]) {
        await writeFile(definition.path, JSON.stringify({
            ...JSON.parse(originalDefinition), source: { kind: "computed", module },
        }));
        await assert.rejects(load(), /invalid Canvas Design value source/);
    }
    await writeFile(definition.path, originalDefinition);
    const computedDefinition = templates[4];
    const originalComputed = await readFile(computedDefinition.path, "utf8");
    await writeFile(computedDefinition.path, JSON.stringify({
        ...JSON.parse(originalComputed), presentation: "stock.editable",
    }));
    await assert.rejects(load(), /invalid Canvas Design value source/);
    await writeFile(computedDefinition.path, originalComputed);
    await writeFile(definition.path, JSON.stringify({
        ...JSON.parse(originalDefinition), section: { id: "demo", title: "Conflicting" },
    }));
    await assert.rejects(load(), /conflicting generated section demo/);
    await writeFile(definition.path, originalDefinition);
    for (const [asset, value] of [
        [templates[1], "true"],
        [templates[2], { level: "three" }],
    ]) {
        const original = await readFile(asset.path, "utf8");
        await writeFile(asset.path, JSON.stringify({
            ...JSON.parse(original), source: { kind: "constant", value },
        }));
        await assert.rejects(load(), /invalid typed constant value/);
        await writeFile(asset.path, original);
    }
    const originalPage = await readFile(page.path, "utf8");
    await writeFile(page.path, JSON.stringify({
        ...JSON.parse(originalPage), values: ["demo.unregistered"],
    }));
    await assert.rejects(load(), /undeclared generated value|invalid generated page definition/);
    await writeFile(page.path, originalPage);
    const originalProvider = await readFile(provider.path, "utf8");
    await writeFile(provider.path, "export const provideValue = ;");
    await assert.rejects(load(), /invalid generated.computed-value-provider/);
    for (const runtimeInvalid of [
        "export const provideValue = 42;",
        "export const provideValue = async () => 'ok';",
        "export async function provideValue() { return 'ok'; }",
    ]) {
        await writeFile(provider.path, runtimeInvalid);
        assert.equal((await load()).valueSources.find((value) => value.id === "demo.workflow").id,
            "demo.workflow");
    }
    for (const valid of [
        "export const provideValue = function () { return 'ok'; };",
        "export const provideValue = (input) => input.workflow.slug;",
    ]) {
        await writeFile(provider.path, valid);
        assert.equal((await load()).valueSources.find((value) => value.id === "demo.workflow").id,
            "demo.workflow");
    }
    await writeFile(provider.path, "export function otherValue() {}");
    await assert.rejects(load(), /invalid generated.computed-value-provider/);
    await writeFile(provider.path, "function provideValue() { return 'ok'; }\nexport { provideValue };");
    await assert.rejects(load(), /value provider must use a direct export function provideValue.*named re-exports are not supported/);
    await writeFile(provider.path, "/*\nexport function provideValue\n*/\nconst provideValue = () => 'ok';\nexport { provideValue };");
    await assert.rejects(load(), /value provider must use a direct export function provideValue.*named re-exports are not supported/);
    await writeFile(provider.path, "const text = `\nexport function provideValue\n`;\nconst provideValue = () => text;\nexport { provideValue };");
    await assert.rejects(load(), /value provider must use a direct export function provideValue.*named re-exports are not supported/);
    await writeFile(provider.path, "export const provideValue = () => 'ok';\nconst workflow = {};");
    assert.equal((await load()).valueSources.find((value) => value.id === "demo.workflow").id,
        "demo.workflow");
    const localResultProvider = "const result = 'Provider result';\nconst workflow = 'helper';\n"
        + "export function provideValue({ workflow: selected }) { return `${result}: ${workflow}: ${selected.slug}`; }\n";
    await writeFile(provider.path, localResultProvider);
    assert.equal((await load()).valueSources.find((value) => value.id === "demo.workflow").id,
        "demo.workflow");
    const bomProvider = `\uFEFF${originalProvider}`;
    await writeFile(provider.path, bomProvider);
    assert.equal((await load()).templates.find((item) => item.name === provider.name).hash,
        createHash("sha256").update(Buffer.from(bomProvider, "utf8")).digest("hex"));
    await writeFile(provider.path, originalProvider);

    const selected = { ...model.values, "canvas.id": "value-demo",
        "canvas.displayName": "Value demo" };
    const overrideAssets = templates.map((item) => item === provider
        ? { ...item, sourceId: "project" } : item);
    const overridden = await load(overrideAssets, (_project, name) => ({
        kind: "template", stack: [{ active: true, strategy: "replace",
            layer: name === provider.name ? "project" : "preset",
            sourceId: name === provider.name ? "_" : "copilot-canvas-values-test" }],
    }));
    const skill = join(project, ".github", "skills",
        "speckit-extension-canvas-design-generate", "SKILL.md");
    await mkdir(join(project, ".github", "skills", "speckit-extension-canvas-design-generate"));
    await writeFile(skill, "---\nname: speckit-extension-canvas-design-generate\n---\n");
    await installOpenSkill(project);
    const prompts = [];
    const shell = await startShell(handoff, overridden, { project, workspace,
        session: { send: async ({ prompt }) => prompts.push(prompt) } });
    t.after(() => shell.close());
    const saved = await saveDesignerSettings(workspace, handoff, overridden,
        { modelRevision: overridden.revision, revision: 0, values: selected });
    const endpoint = new URL(shell.url);
    endpoint.pathname = "/api/generate";
    const post = (approvedProviders) => fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json",
            Origin: endpoint.origin },
        body: JSON.stringify({ modelRevision: overridden.revision,
            settingsRevision: saved.settingsRevision, values: selected,
            ...(approvedProviders === undefined ? {} : { approvedProviders }) }),
    });
    const approval = overridden.templates.filter((item) => item.kind === "generated.computed-value-provider")
        .map(({ name, sourceId, hash }) => ({ name, sourceId, hash }));
    assert.deepEqual(approval, [{ name: provider.name, sourceId: "project",
        hash: overridden.templates.find((item) => item.name === provider.name).hash }]);
    assert.equal((await post()).status, 422);
    assert.equal((await post([{ ...approval[0], sourceId: "copilot-canvas-values-test" }])).status, 422);
    assert.equal((await post([{ ...approval[0], hash: "0".repeat(64) }])).status, 422);
    assert.equal(prompts.length, 0);
    await writeFile(provider.path, `${originalProvider}\n// changed after approval`);
    const changedApproval = await post(approval);
    assert.equal(changedApproval.status, 422);
    assert.match((await changedApproval.json()).error, /changed since Designer opened/);
    await writeFile(provider.path, originalProvider);
    assert.equal((await post(approval)).status, 202);
    await waitFor(() => prompts.length === 1);
    const prepared = await freezeGeneration({ model, values: selected, handoff, project, workspace });
    await writeFile(provider.path, `${originalProvider}\n// changed after freeze`);
    await assert.rejects(freezeGeneration({ model, values: selected, handoff, project, workspace }),
        /changed since Designer opened/);
    await writeFile(provider.path, originalProvider);
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const originalRequest = await readFile(requestPath, "utf8");
    const request = JSON.parse(originalRequest);
    const broken = structuredClone(request);
    broken.valueSources.find((value) => value.id === "demo.workflow").assets[1].hash = "0".repeat(64);
    const { integrity: _previous, ...payload } = broken;
    broken.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(broken));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen value source asset/);
    await writeFile(requestPath, originalRequest);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const portable = join(workspace, "portable-values");
    await cp(join(project, prepared.target), portable, { recursive: true });
    const { readConfig, renderHtml } = await import(pathToFileURL(join(portable, "server.mjs")).href);
    const config = readConfig();
    assert.equal(config.valueSources.find((value) => value.id === "demo.workflow").source.hash,
        approval[0].hash);
    assert.deepEqual(config.valueSources.map(({ id }) => id).sort(),
        ["demo.choice", "demo.enabled", "demo.heading", "demo.note", "demo.processing", "demo.workflow"]);
    assert.equal(config.valueSources.find((value) => value.id === "demo.note").presentation, "stock.editable");
    assert.deepEqual(config.generatedPages[0].values, ["demo.processing"]);
    assert.doesNotMatch(renderHtml(config), /private hint/);
    assert.equal(await readFile(join(portable, "providers",
        `${provider.name}.mjs`), "utf8"), originalProvider);
    const packagedProvider = join(portable, "providers", `${provider.name}.mjs`);
    await rm(packagedProvider);
    const { createRuntime } = await import(pathToFileURL(join(portable, "runtime.mjs")).href);
    const session = { sessionId: "values-test", on: () => () => {},
        getEvents: async () => [], log: async () => {} };
    const runtime = await createRuntime({ config, cwd: project, workspace, session });
    t.after(() => runtime.close());
    const initial = await runtime.snapshot();
    assert.equal(initial.valueFields.find((field) => field.id === "demo.heading").value, "Sample heading");
    assert.equal(initial.valueFields.find((field) => field.id === "demo.enabled").value, true);
    assert.deepEqual(initial.valueFields.find((field) => field.id === "demo.choice").value, { level: "two" });
    assert.equal(initial.valueFields.find((field) => field.id === "demo.note").value, "Initial note");
    assert.equal(initial.valueFields.some((field) => field.id === "demo.workflow"), false);
    assert.equal(Object.hasOwn(initial.valueErrors, "demo.workflow"), false);
    assert.equal(initial.valueFields.some((field) => field.id === "demo.processing"), false);
    assert.deepEqual(initial.pageValues["canvas-generated-values"], { "demo.processing": "private hint" });
    await writeFile(packagedProvider, originalProvider);
    await assert.rejects(runtime.saveValue({ id: "demo.heading", value: "new", revision: initial.revision }),
        /not editable/);
    await assert.rejects(runtime.saveValue({ id: "demo.note", value: "x".repeat(81),
        revision: initial.revision }), /Invalid value/);
    await assert.rejects(runtime.saveValue({ id: "demo.note", value: false,
        revision: initial.revision }), /Invalid value/);
    await runtime.saveValue({ id: "demo.note", value: "Changed globally", revision: initial.revision });
    await assert.rejects(runtime.saveValue({ id: "demo.note", value: "stale",
        revision: initial.revision }), /changed in another panel/);
    const afterEdit = await runtime.snapshot();
    assert.equal(afterEdit.valueFields.find((field) => field.id === "demo.note").value, "Changed globally");
    await mkdir(join(project, "specs", "001-first"), { recursive: true });
    await mkdir(join(project, "specs", "002-second"), { recursive: true });
    await runtime.save({ selected: "specs/001-first", revision: afterEdit.revision });
    const first = await runtime.snapshot();
    assert.equal(first.valueFields.find((field) => field.id === "demo.workflow").value,
        "001-first (001-first)");
    await writeFile(packagedProvider, "export function provideValue() { return 12; }");
    const invalidProvider = await runtime.snapshot();
    assert.equal(invalidProvider.valueFields.some((field) => field.id === "demo.workflow"), false);
    assert.match(invalidProvider.valueErrors["demo.workflow"], /Packaged provider .* changed/);
    await writeFile(packagedProvider, originalProvider);
    await runtime.save({ selected: "specs/002-second", revision: first.revision });
    const second = await runtime.snapshot();
    assert.equal(second.valueFields.find((field) => field.id === "demo.workflow").value,
        "002-second (002-second)");
    assert.equal(second.valueFields.find((field) => field.id === "demo.note").value, "Changed globally");
    for (const [source, reason] of [
        ["export const provideValue = 42;", /provideValue must be a function/],
        ["export async function provideValue() { return 'ok'; }", /Async providers are not supported/],
        ["export const provideValue = async () => 'ok';", /Async providers are not supported/],
    ]) {
        await writeFile(packagedProvider, source);
        const invalidConfig = structuredClone(config);
        invalidConfig.valueSources.find((field) => field.id === "demo.workflow").source.hash =
            createHash("sha256").update(source).digest("hex");
        const diagnostics = [];
        const invalidRuntime = await createRuntime({ config: invalidConfig, cwd: project, workspace,
            session: { ...session, log: async (message) => { diagnostics.push(message); } } });
        t.after(() => invalidRuntime.close());
        const invalid = await invalidRuntime.snapshot();
        assert.equal(invalid.valueFields.some((field) => field.id === "demo.workflow"), false);
        assert.match(invalid.valueErrors["demo.workflow"], reason);
        assert.match(diagnostics.join("\n"), reason);
    }
    await writeFile(packagedProvider, originalProvider);
    await writeFile(packagedProvider, "export function provideValue() { return 'changed'; }");
    let reachedDiagnostic, releaseDiagnostic;
    const reached = new Promise((resolve) => { reachedDiagnostic = resolve; });
    const release = new Promise((resolve) => { releaseDiagnostic = resolve; });
    const originalLog = session.log;
    session.log = async () => { reachedDiagnostic(); await release; };
    const pendingSnapshot = runtime.snapshot();
    try {
        await reached;
        await runtime.saveValue({ id: "demo.note", value: "Edited during refresh",
            revision: second.revision });
    } finally {
        releaseDiagnostic();
        session.log = originalLog;
    }
    const inFlight = await pendingSnapshot;
    assert.equal(inFlight.revision, second.revision);
    assert.equal(inFlight.valueFields.find((field) => field.id === "demo.note").value,
        "Changed globally");
    const afterOverlap = await runtime.snapshot();
    assert.equal(afterOverlap.revision, second.revision + 1);
    assert.equal(afterOverlap.valueFields.find((field) => field.id === "demo.note").value,
        "Edited during refresh");
    await writeFile(packagedProvider, localResultProvider);
    const localResultConfig = structuredClone(config);
    localResultConfig.valueSources.find((value) => value.id === "demo.workflow").source.hash =
        createHash("sha256").update(localResultProvider).digest("hex");
    const localResultRuntime = await createRuntime({
        config: localResultConfig, cwd: project, workspace, session,
    });
    t.after(() => localResultRuntime.close());
    const localResultSnapshot = await localResultRuntime.snapshot();
    assert.equal(localResultSnapshot.valueFields.find((field) => field.id === "demo.workflow").value,
        "Provider result: helper: 002-second");
    await writeFile(packagedProvider, bomProvider);
    const bomConfig = structuredClone(config);
    bomConfig.valueSources.find((value) => value.id === "demo.workflow").source.hash =
        createHash("sha256").update(Buffer.from(bomProvider, "utf8")).digest("hex");
    const bomRuntime = await createRuntime({ config: bomConfig, cwd: project, workspace, session });
    t.after(() => bomRuntime.close());
    const bomSnapshot = await bomRuntime.snapshot();
    assert.equal(bomSnapshot.valueFields.find((field) => field.id === "demo.workflow").value,
        "002-second (002-second)");
    await writeFile(packagedProvider, originalProvider);
    const reopened = await createRuntime({ config, cwd: project, workspace, session });
    t.after(() => reopened.close());
    assert.equal((await reopened.snapshot()).valueFields.find((field) => field.id === "demo.note").value,
        "Edited during refresh");
    const noConsumer = { ...config, generatedPages: config.generatedPages.map((entry) => ({
        ...entry, values: [],
    })) };
    const withoutConsumer = await createRuntime({
        config: noConsumer, cwd: project, workspace, session,
    });
    t.after(() => withoutConsumer.close());
    assert.deepEqual(Object.keys((await withoutConsumer.snapshot()).pageValues), []);
    assert.equal((await withoutConsumer.snapshot()).valueFields.some(
        (field) => field.id === "demo.processing"), false);
    const constructorPage = { ...config, generatedPages: config.generatedPages.map((entry) => ({
        ...entry, id: "constructor",
    })) };
    const constructorRuntime = await createRuntime({
        config: constructorPage, cwd: project, workspace, session,
    });
    t.after(() => constructorRuntime.close());
    const constructorValues = (await constructorRuntime.snapshot()).pageValues;
    assert.equal(Object.hasOwn(constructorValues, "constructor"), true);
    assert.deepEqual(JSON.parse(JSON.stringify(constructorValues)),
        { constructor: { "demo.processing": "private hint" } });
    const slowSource = "export function provideValue() { const end = Date.now() + 150; while (Date.now() < end) {} return 'ok'; }";
    await writeFile(join(portable, "providers", "slow-provider.mjs"), slowSource);
    const workflowField = config.valueSources.find((field) => field.id === "demo.workflow");
    const slowConfig = { ...config, valueSources: [
        config.valueSources.find((field) => field.id === "demo.heading"),
        ...Array.from({ length: 40 }, (_, index) => ({
            ...workflowField, id: `demo.slow${index}`, label: `Slow ${index}`,
            source: { kind: "computed", module: "slow-provider",
                hash: createHash("sha256").update(slowSource).digest("hex") },
        })),
    ], generatedPages: [] };
    const slowWorkspace = await fixture(t);
    const slowRuntime = await createRuntime({ config: slowConfig, cwd: project,
        workspace: slowWorkspace, session });
    t.after(() => slowRuntime.close());
    const noSelection = await slowRuntime.snapshot();
    assert.equal(Object.keys(noSelection.valueErrors).length, 0);
    assert.equal(noSelection.valueFields.some((field) => field.id.startsWith("demo.slow")), false);
    await slowRuntime.save({ selected: "specs/002-second", revision: 0 });
    const start = performance.now();
    const slowSnapshot = await slowRuntime.snapshot();
    assert.ok(performance.now() - start < 5000, "refresh should not wait for all 40 slow providers");
    assert.equal(slowSnapshot.valueFields.find((field) => field.id === "demo.heading").value,
        "Sample heading");
    assert.ok(Object.keys(slowSnapshot.valueErrors).length > 0);
    assert.ok(Object.values(slowSnapshot.valueErrors).every((error) =>
        error === "Value provider refresh time limit exceeded. Refresh to retry."));
    assert.equal(slowSnapshot.valueFields.filter((field) => field.id.startsWith("demo.slow")).length
        + Object.keys(slowSnapshot.valueErrors).length, 40);
    const stateKey = createHash("sha256").update(JSON.stringify([project, config.canvas.id])).digest("hex");
    const statePath = join(workspace, "generated-canvases", stateKey, "state.json");
    const savedState = await readFile(statePath, "utf8");
    const invalidState = JSON.parse(savedState);
    invalidState.values["demo.note"] = 42;
    await writeFile(statePath, JSON.stringify(invalidState));
    await assert.rejects(createRuntime({ config, cwd: project, workspace, session }),
        /Saved canvas state is invalid/);
    await writeFile(statePath, savedState);
    const recovered = await createRuntime({ config, cwd: project, workspace, session });
    t.after(() => recovered.close());
    assert.equal((await recovered.snapshot()).valueFields.find(
        (field) => field.id === "demo.note").value, "Edited during refresh");
});

test("paired control validates both adapters, typed values and portable generated display", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const handoff = validHandoff();
    handoff.workflow.installed = { presets: [], extensions: [], bundles: [] };
    handoff.sourceFingerprint = fingerprint({ workflow: handoff.workflow, selections: handoff.selections });
    await saveHandoff(workspace, handoff);
    const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-risk-matrix-test/",
        import.meta.url));
    const directory = join(project, ".specify", "presets");
    await mkdir(directory);
    const items = [
        ["canvas-control-risk-matrix", "controls/risk-matrix/control.json", "shared.control-definition"],
        ["canvas-contributions-risk-designer", "designer/settings/risk-rating.json", "designer.setting-definition"],
        ["canvas-control-risk-matrix-designer", "controls/risk-matrix/designer.mjs", "designer.control-adapter"],
        ["canvas-control-risk-matrix-generated", "controls/risk-matrix/generated.mjs", "generated.control-adapter"],
    ];
    const templates = await Promise.all(items.map(async ([name, file, kind]) => {
        const path = join(directory, `${name}${file.endsWith(".mjs") ? ".mjs" : ".json"}`);
        await copyFile(join(preset, ...file.split("/")), path);
        return { name, path, kind, sourceId: "copilot-risk-matrix-test", strategy: "replace" };
    }));
    const registration = () => ({ kind: "template", stack: [{
        active: true, sourceId: "copilot-risk-matrix-test", layer: "preset", strategy: "replace",
    }] });
    const load = (assets = templates, verify = registration) =>
        loadResolvedDesignerPages(handoff, project, entries, assets, verify);
    const model = await load();
    assert.equal(model.contributions.find((item) => item.field.id === "risk.rating").requires,
        undefined);
    assert.equal(model.pages[0].fields.find((field) => field.id === "risk.rating").control, "risk-matrix");
    assert.deepEqual(model.values["risk.rating"], null);
    assert.equal(model.generatedPages.length, 0);
    assert.equal(model.adapters["risk-matrix"], "canvas-control-risk-matrix-designer");
    assert.equal(model.controls[0].template, templates[0].name);
    const controlDocument = JSON.parse(await readFile(templates[0].path, "utf8"));
    const contributionSource = await readFile(templates[1].path, "utf8");
    const contributionDocument = JSON.parse(contributionSource);
    const secondField = { ...contributionDocument, id: "risk-second-field",
        field: { ...contributionDocument.field, id: "risk.second", label: "Second risk" } };
    const secondFieldTemplate = { ...templates[1], name: "canvas-contributions-risk-second",
        path: join(directory, "risk-second.json") };
    await writeFile(secondFieldTemplate.path, JSON.stringify(secondField));
    assert.equal((await load([...templates, secondFieldTemplate])).pages[0].fields
        .filter((field) => field.control === "risk-matrix").length, 2);
    const secondControlTemplate = { ...templates[0], name: "canvas-control-risk-other",
        path: join(directory, "risk-other.json") };
    await writeFile(secondControlTemplate.path, JSON.stringify({
        ...controlDocument, id: "risk-other",
    }));
    await writeFile(secondFieldTemplate.path, JSON.stringify({
        ...secondField,
        field: { ...secondField.field, control: "risk-other" },
    }));
    await assert.rejects(load([...templates, secondControlTemplate, secondFieldTemplate]),
        /designer adapter belongs to both risk-matrix and risk-other/);
    const secondDesignerAdapter = { ...templates[2], name: "canvas-control-risk-other-designer",
        path: join(directory, "risk-other.mjs") };
    await copyFile(templates[2].path, secondDesignerAdapter.path);
    await writeFile(secondControlTemplate.path, JSON.stringify({
        ...controlDocument, id: "risk-other",
        adapters: { ...controlDocument.adapters, designer: secondDesignerAdapter.name },
    }));
    await assert.rejects(load([...templates, secondControlTemplate, secondFieldTemplate,
        secondDesignerAdapter]), /generated adapter belongs to both risk-matrix and risk-other/);
    const secondGeneratedAdapter = { ...templates[3], name: "canvas-control-risk-other-generated",
        path: join(directory, "risk-other-generated.mjs") };
    await copyFile(templates[3].path, secondGeneratedAdapter.path);
    await writeFile(secondControlTemplate.path, JSON.stringify({
        ...controlDocument, id: "risk-other",
        adapters: { designer: secondDesignerAdapter.name, generated: secondGeneratedAdapter.name },
    }));
    const bothControls = [...templates, secondControlTemplate, secondFieldTemplate,
        secondDesignerAdapter, secondGeneratedAdapter];
    assert.deepEqual((await load(bothControls)).controls
        .filter((item) => item.id.startsWith("risk-")).map((item) => item.id),
    ["risk-matrix", "risk-other"]);
    await writeFile(templates[1].path, JSON.stringify({
        ...contributionDocument, requires: [secondControlTemplate.name, templates[0].name],
    }));
    await assert.rejects(load(bothControls), /requires must name exactly one control definition template/);
    await writeFile(templates[1].path, contributionSource);
    const designerAdapter = templates[2];
    const designerModule = await readFile(designerAdapter.path, "utf8");
    await writeFile(designerAdapter.path, `${designerModule}\nprocess.exit(57);`);
    assert.equal((await load()).adapters["risk-matrix"], designerAdapter.name);
    await writeFile(designerAdapter.path, designerModule);
    const raced = await load();
    await writeFile(designerAdapter.path, "export const mount = null;");
    assert.equal(raced.templates.find((item) => item.name === designerAdapter.name).hash,
        model.templates.find((item) => item.name === designerAdapter.name).hash);
    await assert.rejects(startShell(handoff, raced, { project, workspace }),
        /changed since Designer opened/);
    await writeFile(designerAdapter.path, "export function mount() { throw new Error('unvalidated'); }");
    await assert.rejects(startShell(handoff, model, { project, workspace }),
        /changed since Designer opened/);
    await writeFile(designerAdapter.path, "x".repeat(32 * 1024 + 1));
    await assert.rejects(startShell(handoff, model, { project, workspace }),
        /exceeds its size limit/);
    await writeFile(designerAdapter.path, designerModule);
    const shell = await startShell(handoff, model, { project, workspace });
    t.after(() => shell.close());
    await writeFile(designerAdapter.path, "export function mount() { throw new Error('unvalidated'); }");
    const adapterUrl = new URL(shell.url);
    adapterUrl.pathname = `/adapters/${designerAdapter.name}.mjs`;
    const adapterResponse = await fetch(adapterUrl);
    assert.match(adapterResponse.headers.get("content-security-policy"), /connect-src 'self'/);
    assert.equal(await adapterResponse.text(), designerModule);
    await writeFile(designerAdapter.path, designerModule);
    const moved = `${directory}-original`;
    const outside = join(workspace, "untrusted-presets");
    await mkdir(outside);
    await writeFile(join(outside, `${designerAdapter.name}.mjs`), "export function mount() {}");
    await rename(directory, moved);
    let linked = false;
    try {
        try {
            await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
            linked = true;
        } catch (error) {
            if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
            t.diagnostic("Windows symlink creation is not permitted; adapter parent assertion skipped");
        }
        if (linked) await assert.rejects(startShell(handoff, model, { project, workspace }),
            /escapes its allowed directory|changed since Designer opened/);
    } finally {
        if (linked) await rm(directory);
        await rename(moved, directory);
    }
    const values = { ...model.values, "canvas.id": "risk-demo", "canvas.displayName": "Risk",
        "risk.rating": { impact: "high", likelihood: "medium" } };
    const draft = await saveDesignerSettings(workspace, handoff, model,
        { modelRevision: model.revision, revision: 0, values: { ...values, "risk.rating": null } });
    assert.equal((await loadDesignerSettings(workspace, handoff, model)).values["risk.rating"], null);
    assert.equal(draft.settingsRevision, 1);
    for (const value of [null, { impact: "high" },
        { impact: "high", likelihood: "unknown" }, { impact: "high", likelihood: "medium", extra: 1 }]) {
        await assert.rejects(freezeGeneration({ model, values: { ...values, "risk.rating": value },
            handoff, project, workspace }), /Invalid Risk rating \(risk.rating\)/);
    }
    const controlContribution = model.contributions.find((item) => item.field.id === "risk.rating");
    const controlId = (index) => index ? `risk.rating${index}` : "risk.rating";
    const controlValues = { ...values };
    const controlConstraints = { ...model.constraints };
    const controls = Array.from({ length: 31 }, (_, index) => {
        const id = controlId(index);
        controlValues[id] = values["risk.rating"];
        controlConstraints[id] = model.constraints["risk.rating"];
        return { ...controlContribution, field: { ...controlContribution.field, id } };
    });
    const controlModel = { ...model, constraints: controlConstraints };
    await assert.rejects(freezeGeneration({
        model: { ...controlModel, contributions: controls }, values: controlValues,
        handoff, project, workspace,
    }), /Generated controls exceed the 30-control limit/);
    await assert.rejects(readdir(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations")), { code: "ENOENT" });
    const atLimit = await freezeGeneration({
        model: { ...controlModel, contributions: controls.slice(0, 30) }, values: controlValues,
        handoff, project, workspace,
    });
    const atLimitRequest = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", atLimit.requestId, "request.json")));
    assert.equal(atLimitRequest.generatedControls.length, 30);
    assert.equal(atLimitRequest.controlAssets.length, 1);
    assert.ok(atLimitRequest.generatedControls.every((item) =>
        item.control === "risk-matrix" && !Object.hasOwn(item, "assets")));
    assert.equal(atLimitRequest.controlAssets[0].assets[0].name, templates[0].name);
    atLimitRequest.canvas.id = "risk-many";
    atLimitRequest.values["canvas.id"] = "risk-many";
    atLimitRequest.target = ".github/extensions/risk-many/";
    const { integrity: _atLimitHash, ...atLimitPayload } = atLimitRequest;
    atLimitRequest.integrity = createHash("sha256").update(JSON.stringify(atLimitPayload)).digest("hex");
    await writeFile(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", atLimit.requestId, "request.json"),
    JSON.stringify(atLimitRequest));
    const { materialize } = await import(new URL(
        "../../../../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs", import.meta.url));
    await materialize(project, workspace, handoff.handoffId, atLimit.requestId);
    assert.deepEqual((await readdir(join(project, ".github", "extensions", "risk-many", "controls"))).sort(),
        [`${templates[0].name}.json`, `${templates[3].name}.mjs`].sort());
    assert.equal(JSON.parse(await readFile(join(project, ".github", "extensions", "risk-many",
        "canvas-config.json"))).generatedControls.length, 30);
    const originalDefinition = await readFile(templates[0].path, "utf8");
    const originalGeneratedAdapter = await readFile(templates[3].path, "utf8");
    const fillAsset = (content) => content + " ".repeat(32 * 1024 - Buffer.byteLength(content));
    try {
        await writeFile(templates[0].path, fillAsset(originalDefinition));
        await writeFile(templates[3].path, fillAsset(originalGeneratedAdapter));
        const sizedModel = await load();
        const pageTemplates = [];
        const largePages = [];
        for (let index = 0; index < 19; index++) {
            const id = `canvas-generated-risk-${index}`;
            const renderer = `${id}-renderer`;
            const definition = fillAsset(JSON.stringify({
                schemaVersion: 1, id, renderer, title: `Page ${index}`,
            }));
            const module = fillAsset("export function renderPage() { return ''; }");
            for (const [name, kind, extension, content] of [
                [id, "generated.added-page-definition", ".json", definition],
                [renderer, "generated.added-page-renderer", ".mjs", module],
            ]) {
                const path = join(directory, `${name}${extension}`);
                await writeFile(path, content);
                pageTemplates.push({ name, kind, path, sourceId: "copilot-risk-matrix-test",
                    strategy: "replace", hash: createHash("sha256").update(content).digest("hex") });
            }
            largePages.push({ name: id, id, title: `Page ${index}`, renderer });
        }
        const large = await freezeGeneration({
            model: { ...sizedModel, constraints: controlConstraints,
                contributions: controls.slice(0, 30), generatedPages: largePages,
                templates: [...sizedModel.templates, ...pageTemplates] },
            values: { ...controlValues, "canvas.id": "risk-full" },
            handoff, project, workspace,
        });
        const largeRequest = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
            "handoffs", handoff.handoffId, "generations", large.requestId, "request.json")));
        assert.equal(largeRequest.controlAssets.length, 1);
        assert.ok(Buffer.byteLength(JSON.stringify(largeRequest)) < 4 * 1024 * 1024);
        assert.ok(Buffer.byteLength(JSON.stringify(largeRequest))
            + 29 * Buffer.byteLength(JSON.stringify(largeRequest.controlAssets[0].assets)) > 4 * 1024 * 1024);
        await materialize(project, workspace, handoff.handoffId, large.requestId);
        const largeConfig = JSON.parse(await readFile(join(project, ".github", "extensions",
            "risk-full", "canvas-config.json")));
        assert.equal(largeConfig.generatedControls.length, 30);
        assert.equal(largeConfig.generatedPages.length, 19);
    } finally {
        await writeFile(templates[0].path, originalDefinition);
        await writeFile(templates[3].path, originalGeneratedAdapter);
    }
    const saved = await saveDesignerSettings(workspace, handoff, model,
        { modelRevision: model.revision, revision: 1, values });
    const reopened = await loadDesignerSettings(workspace, handoff, await load());
    assert.deepEqual(saved.values["risk.rating"], reopened.values["risk.rating"]);
    for (const kind of ["designer.control-adapter", "generated.control-adapter"]) {
        const missingAdapter = await load(templates.filter((item) => item.kind !== kind));
        assert.match(missingAdapter.compositionErrors.join(" "),
            new RegExp(`missing ${kind.split(".")[0]} adapter`));
        assert.ok(generationBlockers(missingAdapter).length);
    }
    for (const [assets, message] of [
        [templates.map((item) => item.kind === "shared.control-definition"
            ? { ...item, kind: "designer.setting-definition" } : item), /Canvas Design contribution/],
        [templates.map((item) => item.kind === "generated.control-adapter"
            ? { ...item, kind: "designer.setting-definition" } : item), /must be a \.json/],
        [templates.map((item) => item.kind === "designer.control-adapter"
            ? { ...item, strategy: "append" } : item), /Invalid or duplicate/],
    ]) await assert.rejects(load(assets), message);
    for (const name of ["con", "prn", "aux", "nul", "com1", "lpt9"]) {
        for (const kind of ["shared.control-definition", "generated.control-adapter"]) {
            await assert.rejects(load(templates.map((item) =>
                item.kind === kind ? { ...item, name } : item)),
            /Invalid or duplicate Canvas Design template/);
        }
    }
    await assert.rejects(load(templates, () => ({ kind: "script", stack: [] })),
        /replace-only Specify template/);
    const definition = templates[0];
    for (const requires of [
        null, [],
        [templates[2].name, definition.name], [definition.name, definition.name],
    ]) {
        const invalid = { ...contributionDocument };
        invalid.requires = requires;
        await writeFile(templates[1].path, JSON.stringify(invalid));
        await assert.rejects(load(), /requires must name exactly one control definition template|missing or incompatible shared control definition/);
    }
    await writeFile(templates[1].path, JSON.stringify({
        ...contributionDocument, requires: [templates[2].name],
    }));
    assert.match((await load()).compositionErrors.join(" "),
        /missing or incompatible shared control definition risk-matrix/);
    await writeFile(templates[1].path, contributionSource);
    const original = await readFile(definition.path, "utf8");
    await writeFile(definition.path, original.replace('"type": "object"', '"type": "string"'));
    await assert.rejects(load(), /invalid shared control value contract|incompatible shared control/);
    for (const invalidProperties of [
        Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`key${index}`, ["low"]])),
        { impact: ["low", "low"] },
        { impact: ["low", null] },
        { impact: [""] },
        { impact: ["x".repeat(81)] },
    ]) {
        const invalidDefinition = JSON.parse(original);
        invalidDefinition.value.properties = invalidProperties;
        await writeFile(definition.path, JSON.stringify(invalidDefinition));
        await assert.rejects(load(), /invalid shared control value contract/);
    }
    await writeFile(definition.path, original);
    await writeFile(designerAdapter.path, designerModule.replace(
        'export const controlId = "risk-matrix"', 'export const controlId = "other-control"'));
    assert.equal((await load()).adapters["risk-matrix"], designerAdapter.name);
    await writeFile(designerAdapter.path, designerModule);
    const generated = templates[3];
    const module = await readFile(generated.path, "utf8");
    await writeFile(generated.path, module.replace('"medium", "high"', '"medium", "critical"'));
    assert.equal((await load()).controls[0].id, "risk-matrix");
    await writeFile(generated.path, module);
    await writeFile(generated.path, "export const mount = null;");
    assert.equal((await load()).controls[0].id, "risk-matrix");
    await writeFile(generated.path, "export const mount = ;");
    await assert.rejects(load(), /invalid generated.control-adapter/);
    await writeFile(generated.path, module);
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    const requestPath = join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json");
    const originalRequest = await readFile(requestPath, "utf8");
    for (const [change, message] of [
        [(request) => { delete request.controlAssets; }, /Missing frozen generated control assets/],
        [(request) => { request.controlAssets.push(structuredClone(request.controlAssets[0])); },
            /Invalid frozen generated control assets/],
        [(request) => { request.generatedControls[0].control = "missing"; },
            /Invalid frozen generated control registration/],
        [(request) => {
            request.fieldConstraints["risk.rating"].properties.impact.push("critical");
        }, /incompatible frozen control value or adapters/],
        [(request) => { request.generatedControls[0].assets = request.controlAssets[0].assets; },
            /Invalid frozen generated control registration/],
        [(request) => {
            const extra = structuredClone(request.controlAssets[0]);
            extra.control = "unused";
            extra.assets[1].name = "unused-generated";
            const definition = JSON.parse(Buffer.from(extra.assets[0].content, "base64").toString("utf8"));
            definition.id = "unused";
            definition.adapters.generated = extra.assets[1].name;
            const bytes = Buffer.from(JSON.stringify(definition));
            extra.assets[0].content = bytes.toString("base64");
            extra.assets[0].hash = createHash("sha256").update(bytes).digest("hex");
            request.controlAssets.push(extra);
        }, /Unused frozen generated control assets/],
        [(request) => {
            const extra = structuredClone(request.controlAssets[0]);
            extra.control = "risk-other";
            extra.assets[0].name = "canvas-control-risk-other";
            const definition = JSON.parse(Buffer.from(extra.assets[0].content, "base64").toString("utf8"));
            definition.id = "risk-other";
            const bytes = Buffer.from(JSON.stringify(definition));
            extra.assets[0].content = bytes.toString("base64");
            extra.assets[0].hash = createHash("sha256").update(bytes).digest("hex");
            request.controlAssets.push(extra);
            request.generatedControls.push({ ...request.generatedControls[0],
                id: "risk.other", control: "risk-other" });
            request.values["risk.other"] = request.generatedControls[1].value;
            request.fieldConstraints["risk.other"] = request.fieldConstraints["risk.rating"];
        }, /generated adapter belongs to both risk-matrix and risk-other/],
    ]) {
        const request = JSON.parse(originalRequest);
        change(request);
        const { integrity: _hash, ...unsigned } = request;
        request.integrity = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
        await writeFile(requestPath, JSON.stringify(request));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            message);
        await assert.rejects(readdir(join(project, prepared.target)), { code: "ENOENT" });
    }
    for (const name of ["con", "prn", "aux", "nul", "com1", "lpt9"]) {
        for (const kind of ["shared.control-definition", "generated.control-adapter"]) {
            const request = JSON.parse(originalRequest);
            const asset = request.controlAssets[0].assets.find((entry) => entry.kind === kind);
            asset.name = name;
            if (kind === "generated.control-adapter") {
                const definitionAsset = request.controlAssets[0].assets[0];
                const definition = JSON.parse(Buffer.from(definitionAsset.content, "base64").toString("utf8"));
                definition.adapters.generated = name;
                const bytes = Buffer.from(JSON.stringify(definition));
                definitionAsset.content = bytes.toString("base64");
                definitionAsset.hash = createHash("sha256").update(bytes).digest("hex");
            }
            const { integrity: _hash, ...unsigned } = request;
            request.integrity = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
            await writeFile(requestPath, JSON.stringify(request));
            await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
                /Invalid frozen generated control asset/);
            await assert.rejects(readdir(join(project, prepared.target)), { code: "ENOENT" });
        }
    }
    for (const invalidProperties of [
        Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`key${index}`, ["low"]])),
        { impact: ["low", "low"] },
        { impact: ["low", null] },
        { impact: [""] },
        { impact: ["x".repeat(81)] },
    ]) {
        const request = JSON.parse(originalRequest);
        const asset = request.controlAssets[0].assets[0];
        const definition = JSON.parse(Buffer.from(asset.content, "base64").toString("utf8"));
        definition.value.properties = invalidProperties;
        const bytes = Buffer.from(JSON.stringify(definition));
        asset.content = bytes.toString("base64");
        asset.hash = createHash("sha256").update(bytes).digest("hex");
        const { integrity: _hash, ...unsigned } = request;
        request.integrity = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
        await writeFile(requestPath, JSON.stringify(request));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            /incompatible frozen control assets/);
    }
    for (const [change, error] of [
        [(request) => { request.values["designer.unbound"] = "not generated"; },
            /Invalid frozen Designer fields/],
        [(request) => { request.generatedControls[0].id = "canvas.description"; },
            /Invalid frozen generated values/],
    ]) {
        const request = JSON.parse(originalRequest);
        change(request);
        const { integrity: _hash, ...unsigned } = request;
        request.integrity = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
        await writeFile(requestPath, JSON.stringify(request));
        await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
            error);
    }
    const invalidRequest = JSON.parse(originalRequest);
    invalidRequest.generatedControls[0].value.likelihood = "impossible";
    const { integrity: _integrity, ...payload } = invalidRequest;
    invalidRequest.integrity = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(invalidRequest));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /incompatible frozen control value or adapters/);
    const oversizedRequest = JSON.parse(originalRequest);
    const oversized = Buffer.alloc(32 * 1024 + 1);
    oversizedRequest.controlAssets[0].assets[1].content = oversized.toString("base64");
    oversizedRequest.controlAssets[0].assets[1].hash =
        createHash("sha256").update(oversized).digest("hex");
    const { integrity: _oversizedIntegrity, ...oversizedPayload } = oversizedRequest;
    oversizedRequest.integrity = createHash("sha256").update(JSON.stringify(oversizedPayload)).digest("hex");
    await writeFile(requestPath, JSON.stringify(oversizedRequest));
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen generated control asset/);
    await writeFile(requestPath, originalRequest);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const portable = join(workspace, "portable-risk");
    const { cp } = await import("node:fs/promises");
    await cp(join(project, prepared.target), portable, { recursive: true });
    const { readConfig, renderHtml, createWorkflowRoutes } = await import(
        pathToFileURL(join(portable, "server.mjs")).href);
    const config = readConfig();
    assert.deepEqual(config.generatedControls[0].value, values["risk.rating"]);
    assert.deepEqual(await readFile(join(portable, "external-control-contract.mjs")),
        await readFile(new URL("../../../../../spec-kit-extensions/extension-canvas-design/generated-scaffold/external-control-contract.mjs",
            import.meta.url)));
    const configPath = join(portable, "canvas-config.json");
    for (const invalidProperties of [
        Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`key${index}`, ["low"]])),
        { impact: ["low", "low"] },
        { impact: ["low", null] },
        { impact: [""] },
        { impact: ["x".repeat(81)] },
    ]) {
        const invalid = structuredClone(config);
        invalid.generatedControls[0].properties = invalidProperties;
        await writeFile(configPath, JSON.stringify(invalid));
        assert.throws(() => readConfig(), /Invalid generated canvas configuration/);
    }
    await writeFile(configPath, JSON.stringify(config));
    assert.match(stockMarkup(config), /data-control-id="risk.rating"/);
    assert.equal((await import(pathToFileURL(join(portable, "controls",
        `${generated.name}.mjs`)).href)).mount.name, "mount");
    assert.equal(await readFile(join(portable, "controls", `${generated.name}.mjs`), "utf8"), module);
    assert.doesNotMatch(renderHtml({ ...config, generatedControls: undefined }), /data-control-id=/);
    const routes = createWorkflowRoutes(config, {
        runtime: null, instanceId: "test", token: "portable-token", port: () => server.address().port,
    });
    const server = createServer(routes.handle);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const html = await fetch(`${origin}/?token=portable-token`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /data-page-module="\/pages\/generated-workflow-page-adapter.mjs"/);
    const packaged = await fetch(`${origin}/controls/${generated.name}.mjs?token=portable-token`);
    assert.equal(packaged.status, 200);
    assert.equal(await packaged.text(), module);
    assert.equal((await fetch(`${origin}/controls/${generated.name}.mjs`)).status, 401);
});

test("frozen generated asset read rejects a FIFO without blocking", {
    skip: process.platform === "win32",
}, async (t) => {
    const workspace = await fixture(t);
    const path = join(workspace, "renderer.mjs");
    const created = spawnSync("mkfifo", [path], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    await assert.rejects(readFrozenAsset({ name: "renderer", path, hash: "unused" }, workspace),
        /Invalid Designer file/);
});

test("unavailable page schema stops opening with repair guidance; invalid pages remain per-page errors", async (t) => {
    const workspace = await fixture(t);
    const { project, entries } = await projectFixture(t, workspace);
    const schema = join(project, ".specify", "extensions", "extension-canvas-design",
        "schemas", "external-designer.tab-definition.schema.json");
    const original = await readFile(schema);
    for (const [contents, reason] of [
        [null, /ENOENT/], ["{broken", /Invalid Designer JSON/],
        ["{}", /Invalid shared Designer page schema/],
    ]) {
        if (contents === null) await rm(schema);
        else await writeFile(schema, contents);
        await assert.rejects(loadResolvedDesignerPages(validHandoff(), project, entries),
            (error) => error.message.includes(schema)
                && /Repair or reinstall extension-canvas-design/.test(error.message)
                && reason.test(error.message));
    }
    await writeFile(schema, original);
    await writeFile(entries[0].path, "{broken");
    const model = await loadResolvedDesignerPages(validHandoff(), project, entries);
    assert.match(model.pages[0].error.reason, /Invalid Designer JSON/);
    assert.equal(model.pages[1].title, "Badges");
});

test("canvas opens with a partial inventory and rebuilds on reopening", async (t) => {
    const cli = spawnSync("specify", ["--version"], await specifySpawnOptions(process.cwd(), {
        encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    }));
    assert.ifError(cli.error);
    assert.equal(cli.status, 0,
        `Specify CLI is required for resolved-template integration: ${cli.stderr || cli.stdout}`);
    const workspace = await fixture(t);
    const source = fileURLToPath(new URL("../", import.meta.url));
    const extension = join(workspace, "provider");
    const sdk = join(workspace, "node_modules", "@github", "copilot-sdk");
    await mkdir(sdk, { recursive: true });
    await mkdir(extension);
    for (const file of ["extension.mjs", "preview.mjs", "handoff.mjs", "open-state.mjs", "server.mjs", "pages.mjs", "external-control-contract.mjs",
        "settings.mjs", "generation.mjs", "image.mjs", "bootstrap.mjs", "bootstrap-artifacts.mjs"]) {
        await copyFile(join(source, file), join(extension, file));
    }
    await cp(join(source, "contracts"), join(extension, "contracts"), { recursive: true });
    const extensionSource = await readFile(join(extension, "extension.mjs"), "utf8");
    const openCall = "model = await loadResolvedDesignerPages(handoff, project, pages, templates);";
    assert.ok(extensionSource.includes(openCall));
    await writeFile(join(extension, "extension.mjs"), extensionSource.replace(openCall, `
        model = await loadResolvedDesignerPages(handoff, project, pages, templates, async () => {
            const inventory = new Map();
            for (const item of [...pages, ...templates]) {
                if (inventory.has("template:" + item.name)) continue;
                const source = item.sourceId ?? "extension:extension-canvas-design";
                const layer = source === "project" ? "project"
                    : source.startsWith("extension:") ? "extension" : "preset";
                inventory.set("template:" + item.name, {
                    id: "template:" + item.name, kind: "template", name: item.name,
                    stack: [{ active: true, strategy: "replace", layer,
                        sourceId: layer === "project" ? "_" : source.replace(/^extension:/, ""),
                        sourcePath: item.path }],
                });
            }
            return inventory;
        });`));
    await copyFile(join(extension, "server.mjs"), join(extension, "shell.mjs"));
    await writeFile(join(extension, "server.mjs"), `
        import { startShell as actualStartShell } from "./shell.mjs";
        export async function startShell(...args) {
            const shell = await actualStartShell(...args);
            if (globalThis.__pauseDesignerShell) await globalThis.__pauseDesignerShell(shell);
            return { ...shell, close: async () => {
                if (globalThis.__failDesignerClose?.(shell)) {
                    throw new Error("Previous Designer server could not close");
                }
                if (globalThis.__pauseDesignerClose) await globalThis.__pauseDesignerClose(shell);
                return shell.close();
            } };
        }
    `);
    const shared = join(workspace, "speckit-wizard-canvas", "env");
    await mkdir(shared, { recursive: true });
    await copyFile(join(source, "..", "speckit-wizard-canvas", "env", "workspace.mjs"),
        join(shared, "workspace.mjs"));
    const sharedContracts = join(workspace, "speckit-wizard-canvas", "contracts");
    await mkdir(sharedContracts, { recursive: true });
    await copyFile(join(source, "..", "speckit-wizard-canvas", "contracts", "generate-feature.mjs"),
        join(sharedContracts, "generate-feature.mjs"));
    for (const file of ["resolve-path.mjs", "specify-invocation.mjs"]) {
        await copyFile(join(source, "..", "speckit-wizard-canvas", "env", file),
            join(shared, file));
    }
    await mkdir(join(extension, "ui"));
    for (const file of ["index.html", "app.js", "generation-state.js", "generated-output-state.js",
        "identity-control.js", "output-evidence.js",
        "external-control-adapter-contract.js", "badges-control.js", "badge-duplicates.js",
        "badge-selection-contract.js", "badge-import-contract.js", "preview-badge-input.js", "styles.css"]) {
        await copyFile(join(source, "ui", file), join(extension, "ui", file));
    }
    const { project, entries } = await projectFixture(t, workspace);
    await writeFile(join(sdk, "package.json"), JSON.stringify({
        name: "@github/copilot-sdk", type: "module", exports: { "./extension": "./extension.mjs" },
    }));
    await writeFile(join(sdk, "extension.mjs"), `
        export const createCanvas = (canvas) => canvas;
        export class CanvasError extends Error {
            constructor(code, message) { super(message); this.code = code; }
        }
        export const session = {
            sessionId: "designer-provider-test", workspacePath: ${JSON.stringify(workspace)},
            rpc: { metadata: { snapshot: async () => ({
                sessionId: "designer-provider-test", workspacePath: ${JSON.stringify(workspace)},
                workingDirectory: ${JSON.stringify(project)} }) },
                skills: { reload: async () => ({ errors: [], warnings: [] }) },
                tools: { execute: async () => { throw new Error("Unexpected native open"); } },
                canvas: { listOpen: async () => { throw new Error("Unexpected native snapshot"); } } },
            log: async () => {}
        };
        export const joinSession = async ({ canvases, tools }) => {
            globalThis.__designerTestCanvas = canvases[0];
            globalThis.__designerTestTools = tools;
            return session;
        };
    `);
    const inventorySource = await readFile(join(extension, "open-state.mjs"), "utf8");
    const stage = /await saveLastOpen\(workspace, input\);\r?\n(\s*)await prepare\(\);/;
    assert.match(inventorySource, stage);
    const eol = inventorySource.includes("\r\n") ? "\r\n" : "\n";
    await writeFile(join(extension, "open-state.mjs"), inventorySource.replace(stage,
        (_match, indent) => `await saveLastOpen(workspace, input);${eol}${indent}`
            + `if (globalThis.__pauseDesignerInventory) await globalThis.__pauseDesignerInventory();`
            + `${eol}${indent}await prepare();`));
    await import(pathToFileURL(join(extension, "extension.mjs")).href);
    const canvas = globalThis.__designerTestCanvas;
    delete globalThis.__designerTestCanvas;
    const tools = globalThis.__designerTestTools;
    delete globalThis.__designerTestTools;
    assert.deepEqual(tools.map((tool) => tool.name),
        ["speckit_designer_bootstrap", "speckit_designer_reload_skills"]);
    assert.equal(tools[0].parameters.properties.schemaVersion.const, 1);
    assert.deepEqual(tools[0].parameters.properties.stage.enum, ["install", "finalize-open"]);
    const incompatible = await tools[0].handler({ schemaVersion: 2 });
    assert.equal(incompatible.resultType, "failure");
    assert.equal(JSON.parse(incompatible.textResultForLlm).status, "failure");
    assert.deepEqual(canvas.actions ?? [], []);
    assert.deepEqual(canvas.inputSchema.required, undefined);
    assert.equal(canvas.inputSchema.properties.preview.type, "boolean");
    assert.deepEqual(canvas.inputSchema.properties.handoffId.type, "string");
    assert.equal(canvas.inputSchema.properties.pages.minItems, undefined);
    assert.equal(canvas.inputSchema.properties.pages.maxItems, 100);
    assert.equal(canvas.inputSchema.properties.pages.items.properties.kind.const,
        "designer.tab-definition");
    assert.equal(canvas.inputSchema.properties.templates.maxItems, 100);
    assert.deepEqual(canvas.inputSchema.properties.templates.items.properties.kind.enum,
        ["designer.setting-definition", "generated.workflow-page-definition",
            "generated.workflow-page-adapter",
            "generated.phase-control-definition", "generated.phase-control-adapter",
            "designer.badges-settings-definition", "generated.badge-rule-definition",
            "generated.badge-rule-adapter", "designer.badge-input-control",
            "designer.badge-input-binding", "designer.badge-input-adapter",
            "generated.field-placement",
            "generated.added-page-definition",
            "generated.added-page-renderer", "shared.control-definition",
            "designer.control-adapter", "generated.control-adapter",
            "generated.value-definition", "generated.computed-value-provider",
            "generated.dialog-definition", "generated.dialog-adapter",
            "generated.phase-dialog-binding", "generated.button-control-definition",
            "generated.button-adapter", "generated.button-placement"]);

    let releaseShell, releaseOldClose, releaseInventory;
    try {
        await assert.rejects(readFile(join(extension, "node_modules", "es-module-lexer", "package.json")),
            { code: "ENOENT" });
        const sample = await canvas.open({ instanceId: "preview", input: { preview: true } });
        const sampleStateUrl = new URL(sample.url);
        sampleStateUrl.pathname = "/api/state";
        assert.equal((await (await fetch(sampleStateUrl)).json()).preview, true);
        await canvas.onClose({ instanceId: "preview" });
        await assert.rejects(canvas.open({ instanceId: "preview", input: {
            preview: true, handoffId: ID, pages: entries, templates: [],
        } }), /preview cannot include a Wizard handoff/);
        await assert.rejects(canvas.open({ instanceId: "same", input: {} }),
            /Designer requires es-module-lexer.*Wizard.*environment setup/);
        await cp(join(source, "node_modules", "es-module-lexer"),
            join(extension, "node_modules", "es-module-lexer"), { recursive: true });
        const empty = await canvas.open({ instanceId: "same", input: {} });
        assert.match(await (await fetch(empty.url)).text(), /No Wizard handoff is attached yet/);
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
            /complete resolved inventory/);
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID, pages: entries } }),
            /complete resolved inventory/);
        await assert.rejects(canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: entries, templates: [],
        } }), (error) => error.code === "designer_handoff_invalid");
        await saveHandoff(workspace);
        await t.test("registered bootstrap preserves failed host reload diagnostics", async () => {
            const { session } = await import(pathToFileURL(join(sdk, "extension.mjs")).href);
            const diagnostics = { errors: ["Host skill reload failed"], warnings: ["Host reload warning"] };
            const reload = session.rpc.skills.reload;
            session.rpc.skills.reload = async () => diagnostics;
            try {
                const folder = handoffDirectory(workspace, ID);
                const launchRef = { sourceSessionId: "source-session",
                    sourceRoot: join(workspace, "source-session"), handoffId: ID,
                    sha256: createHash("sha256").update(await readFile(join(folder, "handoff.json"))).digest("hex") };
                await writeFile(join(folder, "setup-record.json"), JSON.stringify({
                    schemaVersion: 1, handoffId: ID, handoffHash: launchRef.sha256,
                }));
                await writeBootstrapRecord(workspace, ID, { schemaVersion: 1, launchRef,
                    skillsReloaded: false, opening: false,
                    install: { stage: "installed", timings: {}, warnings: [] } });
                const result = await tools[0].handler({
                    schemaVersion: 1, stage: "finalize-open", launchRef,
                });
                assert.equal(result.resultType, "failure");
                const failure = JSON.parse(result.textResultForLlm);
                assert.equal(failure.error.code, "designer_skill_reload_failed");
                assert.match(failure.error.message, /Host skill reload failed/);
                const record = await readBootstrapRecord(workspace, ID);
                assert.deepEqual(record.reload, diagnostics);
                assert.equal(record.skillsReloaded, false);
                assert.equal(record.finalize, undefined);
                assert.equal(record.nativeResult, undefined);
                await assert.rejects(tools[1].handler(), /Session skill reload failed: Host skill reload failed/);
            } finally {
                session.rpc.skills.reload = reload;
            }
        });
        const partial = await canvas.open({ instanceId: "partial", input: {
            handoffId: ID, pages: entries.slice(1), templates: [],
        } });
        const partialState = new URL(partial.url);
        partialState.pathname = "/api/state";
        assert.match((await (await fetch(partialState)).json()).generationBlockers.join(" "),
            /Essentials must contain Canvas ID and Title/);
        await canvas.onClose({ instanceId: "partial" });
        await assert.rejects(canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: [...entries, entries[0]], templates: [],
        } }), /duplicate Designer page name/);
        const schema = join(project, ".specify", "extensions", "extension-canvas-design",
            "schemas", "external-designer.tab-definition.schema.json");
        const installedSchema = await readFile(schema);
        await rm(schema);
        await assert.rejects(canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: entries, templates: [],
        } }),
            (error) => error.code === "designer_open_failed"
                && error.message.includes(schema)
                && /Repair or reinstall extension-canvas-design/.test(error.message));
        assert.match(await (await fetch(empty.url)).text(), /No Wizard handoff is attached yet/);
        await writeFile(schema, installedSchema);
        await assert.rejects(canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: [{ ...entries[0], path: join(project, ".specify", "missing.json") },
                ...entries.slice(1)], templates: scalarFixtures.get(project),
        } }), /ENOENT/);
        const filled = await canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: entries, templates: scalarFixtures.get(project),
        } });
        assert.notEqual(filled.url, empty.url);
        assert.match(await (await fetch(filled.url)).text(), /Spec Kit Canvas Designer/);
        const stateUrl = new URL(filled.url);
        stateUrl.pathname = "/api/state";
        const initial = await (await fetch(stateUrl)).json();
        assert.equal(initial.pages.length, 3);
        assert.equal((await fetch(new URL("/api/reload", filled.url), { method: "POST" })).status, 404);
        await canvas.onClose({ instanceId: "same" });
        const resumed = await canvas.open({ instanceId: "resumed", input: {} });
        const resumedStateUrl = new URL(resumed.url);
        resumedStateUrl.pathname = "/api/state";
        const resumedState = await (await fetch(resumedStateUrl)).json();
        assert.equal(resumedState.handoffId, ID);
        assert.equal(resumedState.pages.length, initial.pages.length);
        assert.equal(resumedState.revision, initial.revision);
        await canvas.onClose({ instanceId: "resumed" });
        await import(`${pathToFileURL(join(extension, "extension.mjs")).href}?restart=1`);
        const restartedCanvas = globalThis.__designerTestCanvas;
        delete globalThis.__designerTestCanvas;
        delete globalThis.__designerTestTools;
        const afterRestart = await restartedCanvas.open({ instanceId: "after-restart", input: {} });
        const afterRestartState = new URL(afterRestart.url);
        afterRestartState.pathname = "/api/state";
        assert.equal((await (await fetch(afterRestartState)).json()).handoffId, ID);
        await restartedCanvas.onClose({ instanceId: "after-restart" });
        const lastOpen = join(workspace, "speckit-canvas-designer", "last-open.json");
        const originalOpen = await readFile(lastOpen);
        await writeFile(lastOpen, "{broken");
        await assert.rejects(canvas.open({ instanceId: "resumed", input: {} }),
            /Invalid saved Designer open inventory JSON/);
        await writeFile(lastOpen, JSON.stringify({ ...JSON.parse(originalOpen),
            templates: [{ name: "wrong", path: "bad", sourceId: "x",
                kind: "unknown", strategy: "replace" }] }));
        await assert.rejects(canvas.open({ instanceId: "resumed", input: {} }),
            /Invalid saved Designer open inventory/);
        await writeFile(lastOpen, originalOpen);
        const handoffPath = join(handoffDirectory(workspace, ID), "handoff.json");
        const originalHandoff = await readFile(handoffPath);
        await rm(handoffPath);
        await assert.rejects(canvas.open({ instanceId: "resumed", input: {} }),
            (error) => error.code === "designer_handoff_invalid");
        await writeFile(handoffPath, originalHandoff);
        await canvas.open({ instanceId: "resumed", input: {} });
        await canvas.onClose({ instanceId: "resumed" });
        const templatePath = join(project, ".specify", "billing.json");
        await writeFile(templatePath, JSON.stringify({
            schemaVersion: 1, id: "billing-code", host: "designer",
            slot: "essentials.options", order: 30,
            field: { id: "billing.costCode", label: "Cost code",
                type: "string", control: "stock.text" },
        }));
        const withTemplate = await canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: entries,
            templates: [{ name: "canvas-contribution-billing", path: templatePath,
                sourceId: "billing", kind: "designer.setting-definition", strategy: "replace" },
            ...scalarFixtures.get(project)],
        } });
        const templateStateUrl = new URL(withTemplate.url);
        templateStateUrl.pathname = "/api/state";
        const templateState = await (await fetch(templateStateUrl)).json();
        assert.deepEqual(templateState.contributions.map((item) => item.id), ["billing-code"]);
        assert.deepEqual(Object.fromEntries(Object.entries(templateState.values)
            .filter(([id]) => id !== "billing.costCode")), initial.values);
        assert.equal(templateState.values["billing.costCode"], "");
        assert.ok(templateState.pages[0].fields.some((field) => field.id === "billing.costCode"));
        assert.equal(templateState.pages.length, initial.pages.length);
        assert.notEqual(templateState.revision, initial.revision);
        const preset = fileURLToPath(new URL(
            "../../../../../tests/fixtures/test-presets/copilot-canvas-design-test/", import.meta.url));
        const testPage = join(project, ".specify", "pr1-test-page.json");
        const testField = join(project, ".specify", "pr1-test-field.json");
        await copyFile(join(preset, "designer", "tabs", "pr1-test.json"), testPage);
        await copyFile(join(preset, "designer", "settings", "pr1-test.json"), testField);
        const testToggle = join(project, ".specify", "pr1-test-toggle.json");
        await copyFile(join(preset, "designer", "settings", "pr1-toggle.json"), testToggle);
        const withPreset = await canvas.open({ instanceId: "same", input: {
            handoffId: ID,
            pages: [...entries, { name: "canvas-settings-pr1-test", path: testPage,
                kind: "designer.tab-definition", strategy: "replace" }],
            templates: [{ name: "canvas-contribution-pr1-test", path: testField,
                sourceId: "copilot-canvas-design-test", kind: "designer.setting-definition", strategy: "replace" },
            ...scalarFixtures.get(project),
            { name: "canvas-contribution-pr1-toggle", path: testToggle,
                sourceId: "copilot-canvas-design-test", kind: "designer.setting-definition", strategy: "replace" }],
        } });
        const presetStateUrl = new URL(withPreset.url);
        presetStateUrl.pathname = "/api/state";
        const presetState = await (await fetch(presetStateUrl)).json();
        assert.equal(presetState.pages.at(-1).title, "Test settings");
        assert.deepEqual(presetState.pages.at(-1).fields.map((field) => field.id),
            ["pr1Test.label", "pr1Test.enabled"]);
        assert.deepEqual(presetState.constraints["pr1Test.enabled"], { type: "boolean" });
        assert.equal(presetState.values["pr1Test.enabled"], true);
        assert.equal(presetState.contributions[0].sourceId, "copilot-canvas-design-test");
        const changed = JSON.parse(await readFile(entries[0].path, "utf8"));
        changed.title = "Updated Essentials";
        await writeFile(entries[0].path, JSON.stringify(changed));
        const reopened = await canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: entries, templates: scalarFixtures.get(project),
        } });
        assert.notEqual(reopened.url, filled.url);
        await assert.rejects(fetch(stateUrl));
        const latest = new URL(reopened.url);
        latest.pathname = "/api/state";
        const updated = await (await fetch(latest)).json();
        assert.equal(updated.pages[0].title, "Updated Essentials");
        assert.notEqual(updated.revision, initial.revision);
        await writeFile(entries[1].path, "{broken");
        const broken = await canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: entries, templates: scalarFixtures.get(project),
        } });
        await assert.rejects(fetch(latest));
        const brokenStateUrl = new URL(broken.url);
        brokenStateUrl.pathname = "/api/state";
        const brokenState = await (await fetch(brokenStateUrl)).json();
        assert.equal(brokenState.pages.length, 3);
        assert.match(brokenState.pages[1].error.reason, /Invalid Designer JSON/);
        assert.notEqual(brokenState.revision, updated.revision);
        const saveUrl = new URL(broken.url);
        saveUrl.pathname = "/api/save";
        const savedValues = { ...brokenState.values, "canvas.id": "saved-designer",
            "canvas.displayName": "Saved Designer" };
        const savedResponse = await fetch(saveUrl, { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelRevision: brokenState.revision,
                revision: brokenState.settingsRevision, values: savedValues }) });
        assert.equal(savedResponse.status, 200);
        const restored = await canvas.open({ instanceId: "same", input: {
            handoffId: ID, pages: entries, templates: scalarFixtures.get(project),
        } });
        const restoredUrl = new URL(restored.url);
        restoredUrl.pathname = "/api/state";
        const restoredState = await (await fetch(restoredUrl)).json();
        assert.deepEqual(restoredState.values, initial.values);
        assert.equal(restoredState.settingsRevision, 1);
        assert.equal(restoredState.persisted, false);
        const freshValues = { ...restoredState.values, "canvas.id": "second-designer",
            "canvas.displayName": "Second Designer" };
        const freshSave = new URL(restored.url);
        freshSave.pathname = "/api/save";
        const nextSave = await fetch(freshSave, { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelRevision: restoredState.revision,
                revision: restoredState.settingsRevision, values: freshValues }) });
        assert.equal(nextSave.status, 200);
        assert.equal((await nextSave.json()).settingsRevision, 2);
        assert.equal((await (await fetch(restoredUrl)).json()).values["canvas.id"], "second-designer");

        const beforeReplacement = await readFile(lastOpen);
        const raceId = "designer_2";
        await saveHandoff(workspace, validHandoff(raceId));
        globalThis.__failDesignerClose = (shell) => shell.url === restored.url;
        await assert.rejects(canvas.open({ instanceId: "same", input: {
            handoffId: raceId, pages: entries, templates: scalarFixtures.get(project),
        } }), /Previous Designer server could not close/);
        delete globalThis.__failDesignerClose;
        assert.deepEqual(await readFile(lastOpen), beforeReplacement);
        assert.equal((await fetch(restored.url)).status, 200);

        let candidate;
        globalThis.__pauseDesignerShell = async (shell) => { candidate = shell; };
        const closingPrevious = new Promise((resolve) => {
            globalThis.__pauseDesignerClose = async (shell) => {
                if (shell.url !== restored.url) return;
                resolve();
                await new Promise((release) => { releaseOldClose = release; });
            };
        });
        const late = canvas.open({ instanceId: "same", input: {
            handoffId: raceId, pages: entries, templates: scalarFixtures.get(project),
        } });
        await closingPrevious;
        assert.equal(JSON.parse(await readFile(lastOpen)).handoffId, raceId);
        const waitingRestore = canvas.open({ instanceId: "waiting-restore", input: {} });
        await canvas.onClose({ instanceId: "same" });
        delete globalThis.__pauseDesignerClose;
        delete globalThis.__pauseDesignerShell;
        releaseOldClose();
        releaseOldClose = null;
        await assert.rejects(late, /panel closed while opening/);
        assert.deepEqual(await readFile(lastOpen), beforeReplacement);
        await assert.rejects(fetch(candidate.url));
        await assert.rejects(fetch(restored.url));
        const waiting = await waitingRestore;
        const waitingState = new URL(waiting.url);
        waitingState.pathname = "/api/state";
        assert.equal((await (await fetch(waitingState)).json()).handoffId, ID);
        await canvas.onClose({ instanceId: "waiting-restore" });

        const prior = await canvas.open({ instanceId: "same", input: {} });
        const beforeSaveRace = await readFile(lastOpen);
        let savingCandidate;
        globalThis.__pauseDesignerShell = async (shell) => { savingCandidate = shell; };
        const saving = new Promise((resolve) => {
            globalThis.__pauseDesignerInventory = async () => {
                resolve();
                await new Promise((release) => { releaseInventory = release; });
            };
        });
        const interruptedSave = canvas.open({ instanceId: "same", input: {
            handoffId: raceId, pages: entries, templates: scalarFixtures.get(project),
        } });
        await saving;
        assert.equal(JSON.parse(await readFile(lastOpen)).handoffId, raceId);
        await canvas.onClose({ instanceId: "same" });
        delete globalThis.__pauseDesignerInventory;
        delete globalThis.__pauseDesignerShell;
        releaseInventory();
        releaseInventory = null;
        await assert.rejects(interruptedSave, /panel closed while opening/);
        assert.deepEqual(await readFile(lastOpen), beforeSaveRace);
        await assert.rejects(fetch(prior.url));
        await assert.rejects(fetch(savingCandidate.url));

        const started = new Promise((resolve) => {
            globalThis.__pauseDesignerShell = async (shell) => {
                resolve(shell);
                await new Promise((release) => { releaseShell = release; });
            };
        });
        const pending = canvas.open({ instanceId: "closed-during-open", input: {} });
        const shell = await started;
        await canvas.onClose({ instanceId: "closed-during-open" });
        delete globalThis.__pauseDesignerShell;
        const reopenedAfterClose = await canvas.open({ instanceId: "closed-during-open", input: {} });
        releaseShell();
        releaseShell = null;
        await assert.rejects(pending, /panel closed while opening/);
        await assert.rejects(fetch(shell.url));
        assert.equal((await fetch(reopenedAfterClose.url)).status, 200);
    } finally {
        releaseShell?.();
        releaseOldClose?.();
        releaseInventory?.();
        delete globalThis.__pauseDesignerShell;
        delete globalThis.__pauseDesignerInventory;
        delete globalThis.__pauseDesignerClose;
        delete globalThis.__failDesignerClose;
        await canvas.onClose({ instanceId: "waiting-restore" });
        await canvas.onClose({ instanceId: "closed-during-open" });
        await canvas.onClose({ instanceId: "same" });
    }
});
