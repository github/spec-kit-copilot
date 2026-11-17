import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { test, expect } from "./playwright.mjs";
import { startPresetJourney } from "./preset-journey.mjs";
import { startShell } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/server.mjs";
import { fingerprint, handoffDirectory } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/handoff.mjs";
import { loadResolvedDesignerPages } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/pages.mjs";
import { freshDesignerSettings, loadDesignerSettings } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/settings.mjs";
import { previewModel } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/preview.mjs";
import { materialize } from "../../spec-kit-extensions/extension-canvas-design/scripts/generate.mjs";

const templateRoot = new URL("../../spec-kit-extensions/extension-canvas-design/designer-host/tabs/", import.meta.url);
const settingsRoot = new URL("../../spec-kit-extensions/extension-canvas-design/designer-host/essentials-settings/", import.meta.url);
const extensionRoot = new URL("../../spec-kit-extensions/extension-canvas-design/", import.meta.url);
const riskRoot = new URL("../fixtures/test-presets/copilot-risk-matrix-test/", import.meta.url);
const scratchRoot = fileURLToPath(new URL("../../", import.meta.url));

async function materializeDevSkills(project) {
    // Preset installation regenerates skills; Specify refuses to overwrite dev-linked skill files.
    for (const command of ["load-page", "generate"]) {
        const path = join(project, ".github", "skills",
            `speckit-extension-canvas-design-${command}`, "SKILL.md");
        if (!(await lstat(path)).isSymbolicLink()) continue;
        const content = await readFile(path);
        await unlink(path);
        await writeFile(path, content);
    }
}

function scalarRegistrations(resolve) {
    return [
        ["shared-controls-text", "shared.control-definition"],
        ["designer-control-adapter-text", "designer.control-adapter"],
        ["generated-control-adapter-text", "generated.control-adapter"],
        ["shared-controls-checkbox", "shared.control-definition"],
        ["designer-control-adapter-checkbox", "designer.control-adapter"],
    ].map(([name, kind]) => ({ ...resolve(name), kind, strategy: "replace" }));
}

function workflowRegistrations(resolve) {
    return [
        ["generated-workflow", "generated.workflow-page-definition"],
        ["generated-workflow-page-adapter", "generated.workflow-page-adapter"],
        ["generated-phase-control", "generated.phase-control-definition"],
        ["generated-phase-adapter", "generated.phase-control-adapter"],
    ].map(([name, kind]) => ({ ...resolve(name), kind, strategy: "replace" }));
}

async function model(revision = "first") {
    const pages = [];
    for (const name of ["essentials", "badges", "appearance"]) {
        const document = JSON.parse(await readFile(new URL(`${name}.json`, templateRoot), "utf8"));
        pages.push({ ...document, page: document.id });
    }
    for (const name of ["description", "workflow-heading", "workflow-item-name"]) {
        const { field } = JSON.parse(await readFile(new URL(`${name}.json`, settingsRoot), "utf8"));
        pages[0].fields.push(field);
    }
    return {
        pages, revision,
        workflowPage: { name: "generated-workflow", adapter: "generated-workflow-page-adapter" },
        templates: [
            { name: "generated-workflow", kind: "generated.workflow-page-definition" },
            { name: "generated-phase-control", kind: "generated.phase-control-definition" },
            { name: "generated-phase-adapter", kind: "generated.phase-control-adapter" },
        ],
        constraints: {
            "canvas.id": { type: "string", minLength: 1, maxLength: 100,
                pattern: "^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]*$", required: true },
            "canvas.displayName": { type: "string", minLength: 1, maxLength: 120,
                required: true },
            "canvas.description": { type: "string", maxLength: 240 },
            "canvas.workflowListName": { type: "string", maxLength: 80 },
            "canvas.workflowItemName": { type: "string", maxLength: 80,
                pattern: "^[^\\x00-\\x1f\\x7f]*$" },
        },
        values: { "canvas.id": "", "canvas.displayName": "", "canvas.description": "",
            "canvas.workflowListName": "", "canvas.workflowItemName": "" },
    };
}

async function prepareScalarAdapters(project, state) {
    for (const page of state.pages) {
        for (const field of page.fields ?? []) {
            if (state.constraints[field.id]) {
                field.validation = { ...state.constraints[field.id],
                    ...(field.id === "canvas.id" ? { forbiddenValues: [
                        "speckit-canvas-designer", "speckit-wizard", "speckit-canvas-generator",
                    ] } : {}) };
            }
        }
    }
    state.controls = [...(state.controls ?? []),
        ...await Promise.all(["stock-text", "stock-checkbox"].map(async (name) =>
            JSON.parse(await readFile(new URL(`shared-controls/${name}/control.json`, extensionRoot), "utf8"))))];
    state.adapters = { ...state.adapters, "stock.text": "designer-control-adapter-text",
        "stock.checkbox": "designer-control-adapter-checkbox" };
    state.templates ??= [];
    for (const [name, file] of [
        ["designer-control-adapter-text", "stock-text"],
        ["designer-control-adapter-checkbox", "stock-checkbox"],
    ]) {
        const path = join(project, ".specify", "extensions", "extension-canvas-design",
            "controls", file, "designer.mjs");
        await mkdir(join(project, ".specify", "extensions", "extension-canvas-design",
            "controls", file), { recursive: true });
        await copyFile(new URL(`shared-controls/${file}/designer.mjs`, extensionRoot), path);
        const bytes = await readFile(path);
        state.templates.push({ name, path,
            hash: createHash("sha256").update(bytes).digest("hex"), kind: "designer.control-adapter" });
    }
}

async function startPreparedShell(state) {
    const workspace = await mkdtemp(join(scratchRoot, ".designer-pages-e2e-"));
    const workflow = { selectedPhases: Object.keys(state.outputs ?? {}),
        ...(state.outputs ? { outputEvidence: state.outputs } : {}) };
    const selections = { presets: [], extensions: [], bundles: [] };
    const handoff = { schemaVersion: 1, handoffId: "test", workflow, selections,
        sourceFingerprint: fingerprint({ workflow, selections }) };
    const folder = handoffDirectory(workspace, handoff.handoffId);
    try {
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, "handoff.json"), JSON.stringify(handoff));
        const project = join(workspace, "project");
        await prepareScalarAdapters(project, state);
        state.outputs ??= {};
        state.settingsRevision ??= 0;
        if (state.adapters?.["stock.image"]) {
            const path = join(project, ".specify", "extensions", "extension-canvas-design",
                "controls", "stock-image", "designer.mjs");
            await mkdir(join(project, ".specify", "extensions", "extension-canvas-design",
                "controls", "stock-image"), { recursive: true });
            await copyFile(new URL("shared-controls/stock-image/designer.mjs", extensionRoot), path);
            const bytes = await readFile(path);
            state.templates.push({ name: "designer-control-adapter-image", path,
                hash: createHash("sha256").update(bytes).digest("hex"), kind: "designer.control-adapter" });
        }
        if (state.badgeInputControls?.length) {
            const name = "designer-badge-input-stock-adapter";
            const path = join(project, ".specify", "extensions", "extension-canvas-design",
                "badge-input-controls", "stock", "designer.mjs");
            await mkdir(join(project, ".specify", "extensions", "extension-canvas-design",
                "badge-input-controls", "stock"), { recursive: true });
            await copyFile(new URL("designer-host/badge-input-controls/stock/designer.mjs",
                extensionRoot), path);
            const bytes = await readFile(path);
            state.templates.push({ name, path,
                hash: createHash("sha256").update(bytes).digest("hex"),
                kind: "designer.badge-input-adapter" });
            const evaluator = state.badgeRules[0].adapter;
            const evaluatorPath = join(project, ".specify", "extensions", "extension-canvas-design",
                "badges", "adapters", "run.mjs");
            await mkdir(join(project, ".specify", "extensions", "extension-canvas-design",
                "badges", "adapters"), { recursive: true });
            await copyFile(new URL("generated-host/badges/adapters/run.mjs",
                extensionRoot), evaluatorPath);
            const evaluatorBytes = await readFile(evaluatorPath);
            state.templates.push({ name: evaluator, path: evaluatorPath,
                hash: createHash("sha256").update(evaluatorBytes).digest("hex"),
                kind: "generated.badge-rule-adapter" });
        }
        const shell = await startShell(handoff, state, { workspace, project });
        return { url: shell.url, close: async () => {
            await shell.close();
            await rm(workspace, { recursive: true, force: true });
        } };
    } catch (error) {
        await rm(workspace, { recursive: true, force: true });
        throw error;
    }
}

async function openDesigner(page) {
    const shell = await startPreparedShell(await model());
    await page.goto(shell.url);
    return shell;
}

async function generateFromTab(page) {
    await page.getByRole("tab", { name: "Generate" }).click();
    await page.locator("#generate-canvas").click();
}

async function badgeState() {
    const state = await model();
    state.outputs = { specify: {
        outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md",
    } };
    state.badgeTypes = [{ id: "phase-run-complete", rule: "phase-run-complete",
        title: "Phase run complete", description: "Tracks a phase",
        defaultText: "Complete", defaultColor: "green", enabled: true }];
    state.badgeRules = [JSON.parse(await readFile(new URL(
        "generated-host/badges/rules/phase-run-complete.json", extensionRoot), "utf8"))];
    const adapter = "designer-badge-input-stock-adapter";
    state.badgeInputControls = [{ rule: "phase-run-complete", control: "stock.badge-inputs",
        adapter, capabilities: ["declare-markdown-output"] }];
    return state;
}

function badgeImportConfig(state, badges) {
    return { schemaVersion: 1,
        canvas: { id: "source", displayName: "Source", description: "", workflowListName: "Workflows" },
        userProvidesSlug: false, showSetup: false, phases: Object.keys(state.outputs),
        phaseArtifacts: state.outputs, phaseOutputs: {}, workflowPage: state.workflowPage,
        installed: { presets: [], extensions: [], bundles: [] },
        badges: { instances: badges,
            types: state.badgeTypes.map((type) => ({ ...type, schemaVersion: 1, hash: "a".repeat(64) })),
            rules: state.badgeRules.map((rule) => ({ ...rule, hash: state.templates.find((entry) =>
                entry.kind === "generated.badge-rule-adapter" && entry.name === rule.adapter).hash })) } };
}

test("Badges editor persists a configured badge through the Designer save boundary", async ({ page }) => {
    const state = await badgeState();
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        await page.getByRole("tab", { name: "Badges" }).click();
        const badgeButtonStyle = await page.locator(".badge-add").evaluate((button) => {
            const style = getComputedStyle(button);
            return [style.backgroundColor, style.color, style.fontWeight, style.padding];
        });
        await page.getByRole("button", { name: "+ Add badge" }).click();
        await page.getByRole("button", { name: "Phase run complete" }).click();
        await page.getByRole("button", { name: "Create badge" }).click();
        await expect(page.getByRole("alert")).toHaveText("Enter a badge category.");
        await page.getByRole("combobox", { name: /^Category/ }).fill("Readiness");
        await page.getByRole("checkbox", { name: "Workflow list" }).check();
        await page.getByRole("checkbox", { name: "Phase", exact: true }).check();
        await page.getByRole("textbox", { name: /^Workflow list text/ }).fill("List ready");
        await page.getByRole("textbox", { name: /^Phase card text/ }).fill("Phase ready");
        const summary = page.getByRole("textbox", { name: /^Workflow summary text/ });
        await summary.fill("Ready {count}");
        await page.getByRole("button", { name: "Create badge" }).click();
        await expect(page.getByRole("alert")).toContainText("Workflow summary text cannot use {count}");
        await summary.fill("Ready");
        await page.getByRole("button", { name: "Create badge" }).click();
        await expect(page.locator(".badge-row")).toContainText("List ready");
        await expect(page.locator(".badge-row")).toContainText("Category: Readiness");
        await page.locator("#save-settings").click();
        await expect(page.locator("#action-message")).toContainText("Settings saved.");
        const url = new URL(shell.url);
        const response = await page.request.get(new URL(
            `/api/state?token=${url.searchParams.get("token")}`, url).href);
        expect(response.ok()).toBe(true);
        const saved = await response.json();
        expect(saved.persisted).toBe(true);
        expect(saved.badges).toHaveLength(1);
        expect(saved.badges[0]).toMatchObject({
            type: "phase-run-complete", category: "Readiness", inputs: { phase: "specify" },
            text: "List ready", phaseText: "Phase ready", summaryText: "Ready",
            showIn: ["workflow-summary", "workflow-list"],
            targets: [{ phase: "specify", output: null }],
        });
        await page.reload();
        await page.getByRole("tab", { name: "Badges" }).click();
        await expect(page.locator(".badge-row")).toContainText("List ready");
        await expect(page.locator(".badge-row")).toContainText("Category: Readiness");
        await page.getByRole("button", { name: "Edit List ready" }).click();
        await expect(page.getByRole("textbox", { name: /^Workflow list text/ })).toHaveValue("List ready");
        await expect(page.getByRole("textbox", { name: /^Phase card text/ })).toHaveValue("Phase ready");
        await expect(page.getByRole("textbox", { name: /^Workflow summary text/ })).toHaveValue("Ready");
        await page.getByRole("tab", { name: "Generate" }).click();
        for (const id of ["#generate-canvas", "#open-generated-canvas"]) {
            const style = await page.locator(id).evaluate((button) => {
                const computed = getComputedStyle(button);
                return [computed.backgroundColor, computed.color, computed.fontWeight, computed.padding];
            });
            expect(style).toEqual(badgeButtonStyle);
        }
    } finally {
        await shell.close();
    }
});

test("Designer imports a local generated config into the badge draft without saving or partially accepting invalid badges", async ({ page }) => {
    const state = await badgeState();
    const shell = await startPreparedShell(state);
    const badge = { id: "imported-run", type: "phase-run-complete", category: "Readiness",
        inputs: { phase: "specify" }, text: "Imported ready", color: "green",
        showIn: ["workflow-list"] };
    const config = badgeImportConfig(state, [badge]);
    const file = (config) => ({ name: "canvas-config.json", mimeType: "application/json",
        buffer: Buffer.from(typeof config === "string" ? config : JSON.stringify(config)) });
    const base = new URL(shell.url);
    const current = async () => (await page.request.get(
        new URL(`/api/state${base.search}`, base).href)).json();
    try {
        await page.goto(shell.url);
        await page.getByRole("tab", { name: "Badges" }).click();
        const initialState = await current();
        await page.locator(".badge-import-file").setInputFiles(file("{broken"));
        await expect(page.locator(".badge-import-status")).toContainText("not valid JSON");
        const invalid = structuredClone(config);
        invalid.badges.instances.push({ ...badge, id: "second", category: "" });
        await page.locator(".badge-import-file").setInputFiles(file(invalid));
        await expect(page.locator(".badge-import-status")).toContainText("badge 2 (second): invalid category");
        await expect(page.locator(".badge-row")).toHaveCount(0);
        expect(await current()).toEqual(initialState);
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Import badges", exact: true }).click();
        await (await chooser).setFiles(file(config));
        await expect(page.locator(".badge-row")).toHaveCount(1);
        await expect(page.locator(".badge-row")).toContainText("Category: Readiness");
        await expect(page.locator(".badge-import-status")).toHaveText("Imported 1 badge. Use Save to keep them.");
        expect((await current()).badges).toEqual([]);
        await page.locator(".badge-import-file").setInputFiles(file(config));
        await expect(page.locator(".badge-import-status")).toContainText("invalid or duplicate id");
        await expect(page.locator(".badge-row")).toHaveCount(1);
        await page.locator("#save-settings").click();
        await expect(page.locator("#action-message")).toContainText("Settings saved.");
        expect((await current()).badges).toEqual([badge]);
        await page.reload();
        await page.getByRole("tab", { name: "Badges" }).click();
        await expect(page.locator(".badge-row")).toContainText("Imported ready");
    } finally { await shell.close(); }
});

test("Designer ignores a valid import response overtaken by Save", async ({ page }) => {
    const state = await badgeState();
    const shell = await startPreparedShell(state);
    const config = badgeImportConfig(state, [{ id: "late", type: "phase-run-complete",
        category: "Progress", inputs: { phase: "specify" }, text: "Late badge",
        color: "green", showIn: ["workflow-list"] }]);
    let release;
    let intercepted;
    const waiting = new Promise((resolve) => { intercepted = resolve; });
    try {
        await page.route("**/api/validate-badge-import?*", async (route) => {
            const response = await route.fetch();
            await new Promise((resolve) => { release = resolve; intercepted(); });
            await route.fulfill({ response });
        });
        await page.goto(shell.url);
        await page.getByRole("tab", { name: "Badges" }).click();
        await page.locator(".badge-import-file").setInputFiles({
            name: "canvas-config.json", mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(config)),
        });
        await waiting;
        await page.locator("#save-settings").click();
        await expect(page.locator("#action-message")).toContainText("Settings saved.");
        release();
        await expect(page.locator(".badge-import-status")).toContainText("Designer settings changed");
        await expect(page.locator(".badge-row")).toHaveCount(0);
    } finally {
        release?.();
        await shell.close();
    }
});

test("badge editor saves watched evidence without creating a View target", async ({ page }) => {
    const state = await badgeState();
    state.outputs.plan = { outputs: [], view: null };
    state.badgeTypes = [{ id: "watched-file", rule: "watched-file",
        title: "Watched file", defaultText: "Watched file", defaultColor: "green", enabled: true }];
    state.badgeRules = [{ id: "watched-file", description: "Checks a Markdown file",
        inputs: [{ id: "artifact", type: "artifact" }], textPlaceholders: [],
        adapter: "badge-rule-run-adapter" }];
    state.badgeInputControls = [{ rule: "watched-file", control: "stock.badge-inputs",
        adapter: "designer-badge-input-stock-adapter",
        capabilities: ["declare-markdown-output"] }];
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        await page.getByRole("tab", { name: "Badges" }).click();
        await page.getByRole("button", { name: "+ Add badge" }).click();
        await page.getByRole("button", { name: "Watched file" }).click();
        await page.getByRole("combobox", { name: /^Category/ }).fill("Evidence");
        await page.locator(".badge-input-controls").getByRole("checkbox", { name: "Plan" }).check();
        await page.getByText("Use a Markdown file not listed").click();
        await page.getByRole("textbox", { name: "Markdown file path" })
            .fill("specs/<slug>/notes.md");
        await page.getByRole("button", { name: "Add file" }).click();
        await expect(page.locator(".badge-declaration-error")).toBeEmpty();
        await page.getByRole("button", { name: "Create badge" }).click();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toContainText("Settings saved.");
        const url = new URL(shell.url);
        const response = await page.request.get(new URL(
            `/api/state?token=${url.searchParams.get("token")}`, url).href);
        expect(response.ok()).toBe(true);
        const saved = await response.json();
        expect(saved.outputs.plan).toEqual({ outputs: ["specs/<slug>/notes.md"], view: null });
        expect(saved.badges[0].inputs.artifact).toEqual({
            phase: "plan", output: "specs/<slug>/notes.md",
        });
    } finally {
        await shell.close();
    }
});

test("a failed badge adapter import leaves other Designer pages available", async ({ page }) => {
    const shell = await startPreparedShell(await badgeState());
    try {
        await page.route("**/adapters/designer-badge-input-stock-adapter.mjs?*", (route) => route.abort());
        await page.goto(shell.url);
        await expect(page.getByRole("tab", { name: "Essentials" })).toBeVisible();
        await page.getByRole("tab", { name: "Badges" }).click();
        await page.getByRole("button", { name: "+ Add badge" }).click();
        await page.getByRole("button", { name: "Phase run complete" }).click();
        await expect(page.locator(".badge-editor")).toContainText("Could not load badge input control");
        await page.getByRole("tab", { name: "Essentials" }).click();
        await expect(page.getByRole("tab", { name: "Generate" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Outputs" })).toHaveCount(0);
    } finally {
        await shell.close();
    }
});

test("sample preview initializes visible badge input defaults before creating badges", async ({ page }) => {
    const shell = await startShell(null, previewModel(), { preview: true });
    try {
        await page.goto(shell.url);
        await page.getByRole("button", { name: "+ Add badge" }).click();
        await page.getByRole("button", { name: "Phase run complete" }).click();
        await expect(page.locator(".badge-input-controls select")).toHaveValue("constitution");
        await page.getByRole("combobox", { name: /^Category/ }).fill("Progress");
        await page.getByRole("button", { name: "Create badge" }).click();
        await expect(page.locator(".badge-row")).toContainText("Phase run complete");
        await page.getByRole("button", { name: "+ Add badge" }).click();
        await page.getByRole("button", { name: "Artifact current" }).click();
        await page.getByRole("combobox", { name: /^Category/ }).fill("Evidence");
        await page.getByRole("button", { name: "Create badge" }).click();
        await expect(page.locator(".badge-row")).toHaveCount(2);
    } finally {
        await shell.close();
    }
});

test("empty and partial preset inventories keep Designer open with inline generation errors", async ({ page }) => {
    const empty = await model();
    empty.pages = [];
    empty.compositionErrors = ["Generated Workflow page is not registered"];
    const emptyShell = await startPreparedShell(empty);
    let partialShell;
    try {
        await page.goto(emptyShell.url);
        await expect(page.getByRole("heading", { name: "No Designer pages registered" })).toBeVisible();
        await expect(page.getByRole("tab")).toHaveText(["Generate"]);
        await expect(page.locator("#composition-error")).toContainText("Generated Workflow page is not registered");
        await expect(page.locator("#save-settings")).toBeDisabled();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
        const saveUrl = new URL(`/api/save?token=${new URL(emptyShell.url).searchParams.get("token")}`,
            emptyShell.url);
        const refusedSave = await fetch(saveUrl, { method: "POST",
            headers: { "Content-Type": "application/json" }, body: "{}" });
        expect(refusedSave.status).toBe(422);
        expect((await refusedSave.json()).error).toContain("no pages are registered");

        const partial = await model();
        partial.pages = partial.pages.filter((entry) => entry.page !== "designer-badges");
        partial.compositionErrors = ["generated-workflow (from extension:extension-canvas-design):"
            + " missing or unreferenced presentation adapter generated-workflow-page-adapter"];
        partialShell = await startPreparedShell(partial);
        await page.goto(partialShell.url);
        await expect(page.getByRole("tab")).toHaveText(["Essentials", "Appearance", "Generate"]);
        await expect(page.locator("#composition-error")).toContainText("generated-workflow-page-adapter");
        await expect(page.locator("#generation-error")).toContainText("generated-workflow-page-adapter");
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
        await page.getByRole("tab", { name: "Essentials" }).click();
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Partial designer");
        await expect(page.locator("#save-settings")).toBeEnabled();
        await page.locator("#save-settings").click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
    } finally {
        await partialShell?.close();
        await emptyShell.close();
    }
});

test("handoff output evidence remains intact without an Outputs page", async ({ page }) => {
    const state = await model();
    state.outputs = {
        constitution: { outputs: [".specify/memory/constitution.md"],
            view: ".specify/memory/constitution.md" },
        specify: { outputs: ["specs/<slug>/spec.md", "specs/<slug>/research.md"],
            view: "specs/<slug>/spec.md" },
        "speckit.assess.intake": { outputs: [], view: null },
    };
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        await expect(page.getByRole("tab", { name: "Outputs" })).toHaveCount(0);
        await expect(page.locator(".output-section")).toHaveCount(0);
        const token = new URL(shell.url).searchParams.get("token");
        const getState = async () => {
            const response = await fetch(new URL(`/api/state?token=${token}`, shell.url));
            expect(response.status).toBe(200);
            return response.json();
        };
        const initial = await getState();
        expect(initial.pages.some((entry) => entry.page === "designer-artifacts")).toBe(false);
        expect(initial.pipelineOutputs).toEqual(state.outputs);
        expect(initial.pipelineOutputs.specify.view).toBe("specs/<slug>/spec.md");
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("output-default");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Output default");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.reload();
        await expect(page.getByRole("tab", { name: "Outputs" })).toHaveCount(0);
        expect((await getState()).pipelineOutputs).toEqual(state.outputs);
    } finally {
        await shell.close();
    }
});

test("a composition without pages explains why Generate is unavailable", async ({ page }) => {
    const state = await model();
    state.pages = [];
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        await expect(page.getByRole("tab")).toHaveText(["Generate"]);
        await expect(page.getByRole("heading", { name: "No Designer pages registered" })).toBeVisible();
        await expect(page.locator(".output-section")).toHaveCount(0);
        await expect(page.locator("#generate-canvas")).toBeHidden();
    } finally {
        await shell.close();
    }
});

test("a superseded Canvas ID status failure cannot overwrite the current page", async ({ page }) => {
    const shell = await startPreparedShell(await model());
    try {
        await page.goto(shell.url);
        let releaseOld;
        let oldCompleted = false;
        await page.route("**/api/output-status?*", async (route) => {
            const id = new URL(route.request().url()).searchParams.get("canvasId");
            if (id === "old-canvas") {
                await new Promise((resolve) => { releaseOld = resolve; });
                await route.fulfill({ status: 500, json: { error: "Old canvas failed" } });
                oldCompleted = true;
            } else {
                await route.fulfill({ json: {
                    status: "absent", target: `.github/extensions/${id}/`,
                } });
            }
        });
        await page.getByRole("textbox", { name: /Canvas ID/ }).fill("old-canvas");
        await expect.poll(() => typeof releaseOld).toBe("function");
        await page.getByRole("textbox", { name: /Canvas ID/ }).fill("new-canvas");
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#output-target")).toHaveText(".github/extensions/new-canvas/");
        releaseOld();
        await expect.poll(() => oldCompleted).toBe(true);
        await expect(page.locator("#page-error")).toBeHidden();
    } finally {
        await shell.close();
    }
});

test("Main page Logo upload explains rejection beside the picker and clears on replacement", async ({ page }) => {
    const state = await model();
    const { field } = JSON.parse(await readFile(new URL("main-page-logo.json", settingsRoot), "utf8"));
    const logoField = field;
    const { field: headerField } = JSON.parse(await readFile(new URL("header-logo.json", settingsRoot), "utf8"));
    state.pages[0].fields.push(headerField);
    state.constraints[headerField.id] = { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
    state.values[headerField.id] = "";
    state.pages.push({ page: "main", title: "Main", description: "", fields: [logoField] });
    state.constraints[field.id] = { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
    state.values[field.id] = "";
    state.controls = [JSON.parse(await readFile(
        new URL("shared-controls/stock-image/control.json", extensionRoot), "utf8"))];
    state.adapters = { "stock.image": "designer-control-adapter-image" };
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        await page.getByRole("tab", { name: "Main" }).click();
        const picker = page.getByRole("group", { name: field.label }).locator('input[type="file"]');
        const feedback = page.locator(`[id="${await picker.getAttribute("id")}-error"]`);
        await expect(feedback).toHaveAttribute("role", "alert");
        await expect(picker).toHaveAttribute("aria-describedby",
            `${await picker.getAttribute("id")}-hint ${await feedback.getAttribute("id")}`);

        await picker.setInputFiles({ name: "large.png", mimeType: "image/png",
            buffer: Buffer.alloc(326439) });
        await expect(feedback).toBeVisible();
        await expect(feedback).toContainText("326,439 bytes");
        await expect(feedback).toContainText("32,768 bytes (32 KiB)");
        await expect(picker).toHaveAttribute("aria-invalid", "true");

        await picker.setInputFiles({ name: "almost.png", mimeType: "image/png",
            buffer: Buffer.alloc(32988) });
        await expect(feedback).toContainText("32,988 bytes");
        await expect(feedback).toContainText("32,768 bytes (32 KiB)");

        await picker.setInputFiles({ name: "vector.svg", mimeType: "image/svg+xml",
            buffer: Buffer.from("<svg/>") });
        await expect(feedback).toContainText("must be a nonempty PNG, JPEG, GIF, or WebP");

        await picker.setInputFiles({ name: "broken.png", mimeType: "image/png",
            buffer: Buffer.from("not a PNG") });
        await expect(feedback).toContainText("Image bytes do not match the selected format");

        await picker.setInputFiles({ name: "undecodable.png", mimeType: "image/png",
            buffer: Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex") });
        await expect(feedback).toContainText("Image cannot be displayed");

        await picker.setInputFiles({ name: "good.png", mimeType: "image/png",
            buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64") });
        await expect(page.getByAltText(`${field.label} preview`)).toBeVisible();
        await expect(page.getByAltText(`${field.label} preview`)).toHaveJSProperty("naturalWidth", 1);
        await expect(feedback).toBeHidden();
        await expect(picker).not.toHaveAttribute("aria-invalid");
        await page.getByRole("button", { name: "Remove" }).click();
        await expect(feedback).toBeHidden();

        await page.getByRole("tab", { name: "Essentials" }).click();
        const headerPicker = page.getByRole("group", { name: headerField.label }).locator('input[type="file"]');
        const headerFeedback = page.locator(`[id="${await headerPicker.getAttribute("id")}-error"]`);
        await headerPicker.setInputFiles({ name: "header-too-large.png", mimeType: "image/png",
            buffer: Buffer.alloc(32988) });
        await expect(headerFeedback).toContainText("32,988 bytes");
        await expect(headerFeedback).toContainText("32,768 bytes (32 KiB)");
        await expect(headerFeedback).toBeVisible();
    } finally {
        await shell.close();
    }
});

test("an image adapter finishing after a tab switch mounts into the retained page", async ({ page }) => {
    const state = await model();
    const { field } = JSON.parse(await readFile(new URL("header-logo.json", settingsRoot), "utf8"));
    state.pages[0].fields.push(field);
    state.constraints[field.id] = { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
    state.values[field.id] = "";
    state.controls = [JSON.parse(await readFile(
        new URL("shared-controls/stock-image/control.json", extensionRoot), "utf8"))];
    state.adapters = { "stock.image": "designer-control-adapter-image" };
    const shell = await startPreparedShell(state);
    let releaseImport;
    let importArrived;
    const importHeld = new Promise((resolve) => { importArrived = resolve; });
    await page.route("**/adapters/designer-control-adapter-image.mjs?*", async (route) => {
        importArrived();
        await new Promise((release) => { releaseImport = release; });
        await route.continue();
    });
    try {
        await page.goto(shell.url, { waitUntil: "domcontentloaded" });
        await importHeld;
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("retained-image");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Retained image");
        await page.getByRole("tab", { name: "Generate" }).click();
        const imported = page.waitForResponse((response) =>
            response.url().includes("/adapters/designer-control-adapter-image.mjs")
                && response.status() === 200);
        releaseImport();
        await imported;
        await page.getByRole("tab", { name: "Essentials" }).click();
        await expect(page.getByRole("group", { name: field.label })
            .locator('input[type="file"]')).toBeVisible();
        await page.getByRole("tab", { name: "Generate" }).click();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
    } finally {
        releaseImport?.();
        await shell.close();
    }
});

test("pending or failed image selection blocks actions until completion or cancel", async ({ page }) => {
    await page.addInitScript(() => {
        const read = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = function () {
            const file = this;
            window.uploadStarted = true;
            return new Promise((resolve, reject) => {
                window.releaseUpload = () => read.call(file).then(resolve, reject);
            });
        };
    });
    const state = await model();
    const { field } = JSON.parse(await readFile(new URL("header-logo.json", settingsRoot), "utf8"));
    state.pages[0].fields.push(field);
    state.constraints[field.id] = { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
    state.values[field.id] = "";
    state.controls = [JSON.parse(await readFile(
        new URL("shared-controls/stock-image/control.json", extensionRoot), "utf8"))];
    state.adapters = { "stock.image": "designer-control-adapter-image" };
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        const picker = page.locator('input[type="file"]');
        const good = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
        await picker.setInputFiles({ name: "good.png", mimeType: "image/png", buffer: good });
        await page.waitForFunction(() => window.uploadStarted);
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        await expect(page.getByRole("tab", { name: "Generate" })).toBeDisabled();
        await expect(page.getByRole("tab", { name: "Essentials" })).toHaveAttribute("aria-selected", "true");
        await page.evaluate(() => window.releaseUpload());
        await expect(page.getByAltText("Header logo preview")).toBeVisible();
        await expect(page.getByRole("tab", { name: "Generate" })).toBeEnabled();
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.getByRole("tab", { name: "Generate" })).toHaveAttribute("aria-selected", "true");
        await page.getByRole("tab", { name: "Essentials" }).click();
        await picker.setInputFiles({ name: "broken.png", mimeType: "image/png",
            buffer: Buffer.from("not a PNG") });
        await page.evaluate(() => window.releaseUpload());
        await expect(page.locator('[id="setting-field-canvas.logo-error"]'))
            .toContainText("Image bytes do not match");
        await page.getByRole("tab", { name: "Generate" }).click();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#page-error")).toContainText("Header logo (canvas.logo) is still processing or needs attention");
        await expect(page.getByRole("tab", { name: "Essentials" }))
            .toHaveAttribute("aria-selected", "true");
        await expect(page.locator('[id="setting-field-canvas.logo-error"]'))
            .toContainText("Image bytes do not match");
        await page.getByRole("button", { name: "Cancel upload" }).click();
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.getByRole("tab", { name: "Generate" })).toHaveAttribute("aria-selected", "true");
    } finally {
        await shell.close();
    }
});

test("configured image reports an incompatible Designer adapter beside its field", async ({ page }) => {
    const state = await model();
    const { field } = JSON.parse(await readFile(new URL("header-logo.json", settingsRoot), "utf8"));
    state.pages[0].fields.push(field);
    state.constraints[field.id] = { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
    state.values[field.id] = "";
    state.controls = [JSON.parse(await readFile(
        new URL("shared-controls/stock-image/control.json", extensionRoot), "utf8"))];
    state.adapters = { "stock.image": "designer-control-adapter-image" };
    const shell = await startPreparedShell(state);
    try {
        await page.route(/\/adapters\/designer-control-adapter-image\.mjs/, (route) =>
            route.fulfill({ contentType: "text/javascript", body:
                'export const controlId = "wrong"; export const valueContract = { type: "image" }; export function mount() {} export function validate() { return true; }' }));
        await page.goto(shell.url);
        await expect(page.locator('[role="alert"]').filter({
            hasText: "Could not load Header logo: Incompatible control ID or value contract",
        })).toBeVisible();
    } finally {
        await shell.close();
    }
});

test("Designer CSP allows its own UI but blocks cross-origin adapter requests", async ({ page }) => {
    let requests = 0;
    const external = createServer((_request, response) => {
        requests++;
        response.writeHead(204).end();
    });
    await new Promise((resolve) => external.listen(0, "127.0.0.1", resolve));
    let shell;
    try {
        shell = await openDesigner(page);
        await expect(page.getByRole("tab", { name: "Essentials" })).toBeVisible();
        await expect(page.locator(".app-header")).toHaveCSS("display", "grid");
        const document = await page.request.get(shell.url);
        expect(document.headers()["content-security-policy"]).toBe(
            "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'");
        const target = `http://127.0.0.1:${external.address().port}/receive`;
        const result = await page.evaluate(async (url) => {
            try {
                await fetch(url, { mode: "no-cors" });
                return "sent";
            } catch (error) {
                return error.name;
            }
        }, target);
        expect(result).toBe("TypeError");
        expect(requests).toBe(0);
    } finally {
        await shell?.close();
        await new Promise((resolve) => external.close(resolve));
    }
});

test("Wizard-selected Billing preset persists through Designer and renders in the generated canvas", async ({ page }) => {
    test.setTimeout(240_000);
    const prompts = [];
    const journey = await startPresetJourney(page, {
        presetId: "copilot-billing-canvas-test", selectedPhases: ["specify"],
        onGenerate: async ({ prompt }) => { prompts.push(prompt); },
    });
    let freshShell;
    try {
        const { workspace, project, handoff, pages, templates } = journey;
        expect(journey.composedSkill).toContain("- `canvas-settings-billing`");
        expect(journey.composedSkill).toContain("- `canvas-contributions-billing`");
        expect(pages.map((entry) => entry.name)).toContain("canvas-settings-billing");
        expect(templates).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "canvas-contributions-billing",
                sourceId: "copilot-billing-canvas-test" }),
        ]));
        const resolved = journey.resolved;
        expect(resolved.pages.map((item) => item.title)).toEqual(
            ["Essentials", "Badges", "Appearance", "Billing"]);
        const costPage = resolved.pages.find((entry) =>
            entry.fields.some((field) => field.id === "billing.costCode"));
        await page.getByRole("tab", { name: costPage.title }).click();
        const code = page.getByRole("textbox", { name: "Cost code" });
        await expect(code).toHaveAttribute("maxlength", "64");
        await code.fill("CC-481");
        await page.getByRole("tab", { name: "Essentials" }).click();
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("billing-canvas");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Billing Canvas");
        await page.getByRole("tab", { name: "Appearance" }).click();
        const light = page.getByRole("textbox", { name: "Light mode accent" });
        const dark = page.getByRole("textbox", { name: "Dark mode accent" });
        await light.fill("not-a-color");
        await generateFromTab(page);
        await expect(page.locator("#page-error")).toContainText(
            "Invalid Light mode accent (canvas.accentLight)");
        await light.fill("123aBc");
        await dark.fill("#ABC123");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        const saved = await loadDesignerSettings(workspace, handoff,
            await loadResolvedDesignerPages(handoff, project, pages, templates));
        expect(saved.values["billing.costCode"]).toBe("CC-481");
        expect(saved.values["canvas.accentLight"]).toBe("123aBc");
        expect(saved.values["canvas.accentDark"]).toBe("#ABC123");
        await journey.reopenDesigner();
        await page.getByRole("tab", { name: costPage.title }).click();
        await expect(page.getByRole("textbox", { name: "Cost code" })).toHaveValue("CC-481");
        await page.getByRole("tab", { name: "Appearance" }).click();
        await expect(page.getByRole("textbox", { name: "Light mode accent" })).toHaveValue("123aBc");
        await expect(page.getByRole("textbox", { name: "Dark mode accent" })).toHaveValue("#ABC123");
        await page.getByRole("tab", { name: "Generate" }).click();
        await page.locator("#generate-canvas").click();
        await expect(page.locator("#conn-status")).toHaveText("Live");
        await expect(page.locator("#generation-status")).toContainText("Creating canvas files");
        await expect(page.locator("#open-generated-canvas")).toBeDisabled();
        const folder = handoffDirectory(workspace, handoff.handoffId);
        const [requestId] = await readdir(join(folder, "generations"));
        await expect.poll(() => prompts.length).toBe(1);
        expect(prompts[0]).toContain("speckit-extension-canvas-design-generate");
        expect(prompts[0]).toContain(requestId);
        await journey.generate(requestId);
        const config = JSON.parse(await readFile(join(project, ".github", "extensions",
            "billing-canvas", "canvas-config.json"), "utf8"));
        expect(config.readOnlyFields).toEqual([{ id: "billing.costCode",
            label: "Cost code", value: "CC-481",
            section: { id: "billing", title: "Billing" } }]);
        expect(config.appearance).toMatchObject({
            light: { accent: "#123aBc" }, dark: { accent: "#ABC123" },
        });
        await page.goto(journey.shell.url);
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#conn-status")).toHaveText("Live");
        await expect(page.locator("#generation-error")).toBeHidden();
        await expect(page.locator("#generation-status")).toContainText("Canvas files created");
        await expect(page.locator("#generate-canvas")).toHaveText("Regenerate canvas");
        await expect(page.locator("#generate-canvas")).toBeEnabled();
        await expect(page.locator("#open-generated-canvas")).toBeEnabled();
        await page.locator("#generate-canvas").click();
        const confirm = page.getByRole("dialog", { name: "Replace generated canvas?" });
        await expect(confirm).toBeVisible();
        await confirm.getByRole("button", { name: "Cancel" }).click();
        await expect(confirm).not.toBeVisible();
        expect(await readdir(join(folder, "generations"))).toEqual([requestId]);
        freshShell = await startShell(handoff, await freshDesignerSettings(workspace, handoff,
            await loadResolvedDesignerPages(handoff, project, pages, templates)),
        { project, workspace, session: { send: async ({ prompt }) => { prompts.push(prompt); } } });
        await page.goto(freshShell.url);
        await expect(page.getByRole("textbox", { name: "Canvas ID (required)" })).toHaveValue("");
        await expect(page.getByRole("textbox", { name: "Title (required)" })).toHaveValue("");
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generation-status")).not.toContainText("Creating canvas files");
        await page.getByRole("tab", { name: "Essentials" }).click();
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("billing-second");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Billing Second");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#output-target")).toContainText(".github/extensions/billing-second/");
        await page.locator("#generate-canvas").click();
        await expect(page.locator("#generation-status")).toContainText("Creating canvas files");
        await expect.poll(() => prompts.length).toBe(2);
        expect((await readdir(join(folder, "generations"))).length).toBe(2);
        await journey.serveGenerated("billing-canvas", { token: "billing-token" });
        await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Configured fields" })).toHaveCount(0);
        const billing = page.getByRole("region", { name: "Billing" }).locator("details");
        const costCode = billing.locator('[data-field-id="billing.costCode"]');
        await expect(billing).toHaveAttribute("open", "");
        await expect(costCode).toHaveText("CC-481");
        expect(await billing.evaluate((section) => Boolean(
            section.compareDocumentPosition(document.querySelector("#instance-collection"))
            & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
        await billing.locator(":scope > summary").click();
        await expect(costCode).toBeHidden();
        await billing.locator(":scope > summary").click();
        await expect(costCode).toHaveText("CC-481");
        await expect(costCode).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Cost code" })).toHaveCount(0);
    } finally {
        await freshShell?.close();
        await journey.close();
    }
});

test("risk preset selects a cell by keyboard and packages its read-only adapter", async ({ page }) => {
    test.setTimeout(480_000);
    const available = spawnSync("specify", ["--version"], { encoding: "utf8" });
    expect(available.error, "Specify CLI is required for the contract integration").toBeUndefined();
    expect(available.status, available.stderr).toBe(0);
    const workspace = await mkdtemp(join(tmpdir(), "speckit-risk-preset-e2e-"));
    const project = join(workspace, "project");
    const presetCopy = join(workspace, "risk-preset");
    const handoff = {
        schemaVersion: 1, handoffId: "risk-test",
        workflow: { selectedPhases: ["specify"],
            installed: { presets: [], extensions: [], bundles: [] } },
        selections: { presets: [], extensions: [], bundles: [] },
    };
    handoff.sourceFingerprint = fingerprint({
        workflow: handoff.workflow, selections: handoff.selections,
    });
    let shell, reopened, stale, broken, incompatible, brokenContext, server, routes;
    const prompts = [];
    try {
        await mkdir(project);
        const run = (...args) => {
            const result = spawnSync("specify", args, {
                cwd: project, encoding: "utf8", timeout: 120000,
                env: { ...process.env, COLUMNS: "500" },
            });
            expect(result.error, `${args.join(" ")}: ${result.error}`).toBeUndefined();
            expect(result.status, `${args.join(" ")}: ${result.stderr}\n${result.stdout}`).toBe(0);
            return stripVTControlCharacters(result.stdout);
        };
        run("init", "--here", "--force", "--non-interactive", "--ignore-agent-tools",
            "--integration", "copilot", "--integration-options=--skills",
            "--script", process.platform === "win32" ? "ps" : "sh");
        run("extension", "add", fileURLToPath(extensionRoot), "--dev", "--force");
        await materializeDevSkills(project);
        await cp(fileURLToPath(riskRoot), presetCopy, { recursive: true });
        run("preset", "add", "--dev", presetCopy);
        const command = await readFile(join(project, ".github", "skills",
            "speckit-extension-canvas-design-load-page", "SKILL.md"), "utf8");
        for (const name of ["canvas-control-risk-matrix", "canvas-contributions-risk-designer",
            "canvas-control-risk-matrix-designer", "canvas-control-risk-matrix-generated"]) {
            expect(command).toContain(`- \`${name}\``);
        }
        const resolve = (name) => {
            const output = run("preset", "resolve", name);
            const line = output.split(/\r?\n/).map((item) => item.trim())
                .find((item) => item.startsWith(`${name}: `));
            expect(line, output).toBeDefined();
            expect(output).not.toMatch(/not found|composition warning/i);
            const source = output.match(/\(top layer from: (\S+) v[\d.]+\)/);
            expect(source, output).not.toBeNull();
            return { name, path: line.slice(name.length + 2), sourceId: source[1] };
        };
        const pages = ["designer-essentials", "designer-badges", "designer-appearance"]
            .map((name) => { const { sourceId: _sourceId, ...entry } = resolve(name);
                return { ...entry, kind: "designer.tab-definition", strategy: "replace" }; });
        const templates = [
            ["canvas-control-risk-matrix", "shared.control-definition"],
            ["canvas-contributions-risk-designer", "designer.setting-definition"],
            ["canvas-control-risk-matrix-designer", "designer.control-adapter"],
            ["canvas-control-risk-matrix-generated", "generated.control-adapter"],
        ].map(([name, kind]) => ({ ...resolve(name), kind, strategy: "replace" }));
        const adapterRelative = relative(await realpath(workspace), await realpath(templates[2].path));
        expect(isAbsolute(adapterRelative) || adapterRelative === ".."
            || adapterRelative.startsWith(`..${sep}`)).toBe(false);
        templates.push(...scalarRegistrations(resolve));
        templates.push(...workflowRegistrations(resolve));
        templates.push(...["designer-essentials-description", "designer-essentials-workflow-heading",
            "designer-essentials-workflow-item-name"]
            .map((name) => ({ ...resolve(name), kind: "designer.setting-definition", strategy: "replace" })));
        const folder = handoffDirectory(workspace, handoff.handoffId);
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, "handoff.json"), JSON.stringify(handoff));
        const load = async () => loadDesignerSettings(workspace, handoff,
            await loadResolvedDesignerPages(handoff, project, pages, templates));
        shell = await startShell(handoff, await load(), { project, workspace,
            session: { send: async ({ prompt }) => { prompts.push(prompt); } } });
        await page.goto(shell.url);
        const group = page.getByRole("radiogroup", { name: "Risk rating: impact by likelihood" });
        await expect(group.getByRole("radio")).toHaveCount(9);
        await group.getByRole("radio", { name: "Impact low, likelihood low" }).focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowDown");
        await expect(group.getByRole("radio",
            { name: "Impact medium, likelihood medium" })).toHaveAttribute("aria-checked", "true");
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("risk-canvas");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Risk Canvas");
        await page.getByRole("textbox", { name: "Description" }).fill("Risk workflow description");
        await page.getByRole("textbox", { name: "Header text" }).fill("Risk workflows");
        await page.getByRole("textbox", { name: "Workflow item name" }).fill("Risk");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        expect((await load()).values["risk.rating"]).toEqual({
            impact: "medium", likelihood: "medium",
        });
        reopened = await startShell(handoff, await load(), { project, workspace,
            session: { send: async ({ prompt }) => { prompts.push(prompt); } } });
        await page.goto(reopened.url);
        await expect(page.getByRole("radio",
            { name: "Impact medium, likelihood medium" })).toHaveAttribute("aria-checked", "true");
        await generateFromTab(page);
        await expect(page.locator("#conn-status")).toHaveText("Live");
        await expect(page.locator("#generation-status")).toContainText("Creating canvas files");
        const [requestId] = await readdir(join(folder, "generations"));
        await expect.poll(() => prompts.length).toBe(1);
        expect(prompts[0]).toContain(requestId);
        expect(prompts[0]).toContain("speckit-extension-canvas-design-generate");
        const requestPath = join(folder, "generations", requestId, "request.json");
        const requestBytes = await readFile(requestPath);
        const request = JSON.parse(requestBytes.toString("utf8"));
        const { integrity, ...payload } = request;
        expect(request.schemaVersion).toBe(1);
        expect(request.handoffId).toBe(handoff.handoffId);
        expect(request.requestId).toBe(requestId);
        expect(request.settingsRevision).toBe(2);
        expect(requestBytes.length).toBeLessThanOrEqual(4 * 1024 * 1024);
        expect(integrity).toBe(createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
        expect(request.values["risk.rating"]).toEqual({ impact: "medium", likelihood: "medium" });
        expect(request.generatedControls[0].value).toEqual(request.values["risk.rating"]);
        await writeFile(requestPath, JSON.stringify({ ...request, settingsRevision: 0 }));
        await expect(materialize(project, workspace, handoff.handoffId, requestId))
            .rejects.toThrow(/Generation request integrity mismatch/);
        await expect(readFile(join(project, request.target, "canvas-config.json")))
            .rejects.toMatchObject({ code: "ENOENT" });
        await writeFile(requestPath, requestBytes);
        await materialize(project, workspace, handoff.handoffId, requestId);
        const portable = join(workspace, "portable-risk");
        await cp(join(project, ".github", "extensions", "risk-canvas"), portable, { recursive: true });
        const { readConfig, createWorkflowRoutes } = await import(
            pathToFileURL(join(portable, "server.mjs")).href);
        const config = readConfig();
        expect(config.canvas.workflowListName).toBe("Risk workflows");
        expect(config.canvas.workflowItemName).toBe("Risk");
        expect(config.generatedControls[0].value).toEqual({
            impact: "medium", likelihood: "medium",
        });
        routes = createWorkflowRoutes(config, {
            runtime: null, instanceId: "risk-browser", token: "risk-token",
            port: () => server.address().port,
        });
        server = createServer(routes.handle);
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        await page.goto(`http://127.0.0.1:${server.address().port}/?token=risk-token`);
        await expect(page.locator("#workflow-heading")).toContainText("Risk workflows");
        await expect(page.locator("#new-workflow")).toHaveAttribute("aria-label", "New Risk");
        await expect(page.locator(".collection-description")).toHaveText("Risk workflow description");
        await expect(page.locator(".brand-mark")).toContainText(String.fromCodePoint(9671));
        await expect(page.getByRole("table", { name: /impact medium, likelihood medium/ })).toBeVisible();
        await expect(page.locator('[data-control-id="risk.rating"] [aria-current="true"]')).toHaveText("Selected");
        const contract = JSON.parse(await readFile(templates[0].path, "utf8")).value;
        const adapterPattern = `**/adapters/${templates[2].name}.mjs*`;
        await page.route(adapterPattern, (route) => route.fulfill({
            contentType: "text/javascript",
            body: `export const controlId = "risk-matrix";
                export const valueContract = ${JSON.stringify(contract)};
                export function validate() { return true; }
                export function mount({ root, onChange }) {
                    (globalThis.controlCallbacks ??= []).push(onChange);
                    root.textContent = "Adapter mounted";
                    return { isReady: () => true };
                }`,
        }));
        stale = await startShell(handoff, await load(), { project, workspace });
        await page.goto(stale.url);
        await page.waitForFunction(() => globalThis.controlCallbacks?.length === 1);
        await page.getByRole("tab", { name: "Generate" }).click();
        await page.getByRole("tab", { name: "Essentials" }).click();
        await expect.poll(() => page.evaluate(() => globalThis.controlCallbacks?.length)).toBe(1);
        await page.evaluate(() => {
            globalThis.controlCallbacks[0]({ impact: "low", likelihood: "low" });
        });
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        expect((await loadDesignerSettings(workspace, handoff, await load())).values["risk.rating"])
            .toEqual({ impact: "low", likelihood: "low" });
        await page.unroute(adapterPattern);
        const designerAdapter = await readFile(templates[2].path, "utf8");
        await writeFile(templates[2].path, designerAdapter.replace(
            "export function mount(", "export const mount = null; function unusedMount("));
        broken = await startShell(handoff,
            await loadResolvedDesignerPages(handoff, project, pages, templates), { project, workspace });
        await page.goto(broken.url);
        await expect(page.locator('[data-field-id="risk.rating"][role="alert"]')).toContainText(
            "Could not load Risk rating: Missing mount export");
        await expect(page.getByRole("textbox", { name: "Canvas ID (required)" })).toBeVisible();
        await writeFile(templates[2].path, designerAdapter.replace(
            'export const controlId = "risk-matrix"', 'export const controlId = "wrong-control"'));
        incompatible = await startShell(handoff,
            await loadResolvedDesignerPages(handoff, project, pages, templates), { project, workspace });
        await page.goto(incompatible.url);
        await expect(page.locator('[data-field-id="risk.rating"][role="alert"]')).toContainText(
            "Could not load Risk rating: Incompatible control ID or value contract");
        const generatedAdapter = join(portable, "controls", `${templates[3].name}.mjs`);
        await writeFile(generatedAdapter, "export const mount = null;");
        const servedAdapter = await fetch(`http://127.0.0.1:${server.address().port}`
            + `/controls/${templates[3].name}.mjs?token=risk-token`,
        { signal: AbortSignal.timeout(5000) });
        expect(servedAdapter.status).toBe(200);
        expect(await servedAdapter.text()).toContain("export const mount = null;");
        brokenContext = await page.context().browser().newContext();
        const brokenPage = await brokenContext.newPage();
        await brokenPage.goto(`http://127.0.0.1:${server.address().port}/?token=risk-token`,
            { waitUntil: "commit" });
        await expect(brokenPage.locator('[data-control-id="risk.rating"][role="alert"]')).toContainText(
            "Generated control could not render: Missing mount export");
    } finally {
        await brokenContext?.close();
        routes?.close();
        if (server) {
            await new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
            });
        }
        await incompatible?.close();
        await broken?.close();
        await stale?.close();
        await reopened?.close();
        await shell?.close();
        await rm(workspace, { recursive: true, force: true });
    }
});

async function openWithError(page, name) {
    const state = await model();
    const index = state.pages.findIndex((item) => item.page === name);
    state.pages[index] = { page: name, title: name, order: (index + 1) * 10,
        error: { name, path: "C:\\project\\.specify\\bad.json",
            reason: "Invalid JSON: <b>unexpected</b>" } };
    if (index === 0) {
        for (const field of ["canvas.id", "canvas.displayName", "canvas.description",
            "canvas.workflowListName", "canvas.workflowItemName"]) {
            delete state.constraints[field];
            delete state.values[field];
        }
    }
    const shell = await startPreparedShell(state);
    await page.goto(shell.url);
    return shell;
}

test("Essentials exposes independent header and item names without a slug toggle", async ({ page }) => {
    const shell = await openDesigner(page);
    try {
        await expect(page.getByRole("tab")).toHaveText(["Essentials", "Badges", "Appearance", "Generate"]);
        const id = page.getByRole("textbox", { name: "Canvas ID (required)" });
        const title = page.getByRole("textbox", { name: "Title (required)" });
        await expect(page.getByRole("textbox")).toHaveCount(5);
        await expect(page.getByRole("checkbox")).toHaveCount(0);
        await expect(id).toHaveAttribute("pattern",
            "^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]*$");
        const hint = page.locator(`[id="${await id.getAttribute("id")}-hint"]`);
        await expect(id).toHaveAttribute("aria-describedby", await hint.getAttribute("id"));
        await expect(hint)
            .toHaveText("Use 1–100 characters: lowercase letters (a–z), numbers (0–9), and hyphens (-). Start with a letter or number. Reserved IDs, including Windows device names like con and com1, cannot be used.");
        await expect(title).toHaveAttribute("maxlength", "120");
        await expect(page.getByRole("textbox", { name: "Description" })).toHaveAttribute("maxlength", "240");
        const header = page.getByRole("textbox", { name: "Header text" });
        const item = page.getByRole("textbox", { name: "Workflow item name" });
        await expect(header).toHaveAttribute("maxlength", "80");
        await expect(item).toHaveAttribute("maxlength", "80");
        await expect(page.locator(`[id="${await header.getAttribute("id")}-hint"]`))
            .toHaveText("The main header displayed below the canvas title. Leave blank to use ‘Workflows.’");
        await expect(page.locator(`[id="${await item.getAttribute("id")}-hint"]`))
            .toHaveText("The name for one workflow item, used in buttons, labels, and default names. Use the singular form. Leave blank to use ‘Workflow.’");
        await id.fill("example-canvas");
        for (const name of ["Appearance", "Generate"]) {
            await page.getByRole("tab", { name }).click();
            if (name === "Generate") await expect(page.locator("#output-target")).toBeVisible();
            else await expect(page.getByText("This template defines no fields.")).toBeVisible();
        }
        await page.getByRole("tab", { name: "Essentials" }).click();
        await expect(id).toHaveValue("example-canvas");
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
        await expect(page.locator("#conn-status")).toHaveText("Live");
    } finally {
        await shell.close();
    }
});

test("required stock text keeps incomplete drafts until Generate", async ({ page }) => {
    const state = await model();
    state.pages[0].fields.find((field) => field.id === "canvas.description").required = true;
    state.constraints["canvas.description"].required = true;
    state.settingsRevision = 0;
    state.persisted = false;
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        const id = page.getByRole("textbox", { name: "Canvas ID (required)" });
        const title = page.getByRole("textbox", { name: "Title (required)" });
        const description = page.getByRole("textbox", { name: "Description (required)" });
        await id.fill("required-canvas");
        await title.fill("  ");
        await title.blur();
        await expect(title).not.toHaveAttribute("aria-invalid");
        await title.fill("Required Canvas");
        await description.fill("   ");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        await expect(page.locator("#action-message")).toBeVisible();
        await expect(description).toHaveValue("   ");
        await description.fill("A valid description");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        await expect(page.locator("#action-message")).toBeVisible();
    } finally {
        await shell.close();
    }
});

test("missing Generate skill explains why the action is disabled", async ({ page }) => {
    const workspace = await mkdtemp(join(scratchRoot, ".designer-generate-unavailable-"));
    const project = join(workspace, "project");
    const workflow = { selectedPhases: ["specify"],
        installed: { presets: [], extensions: [], bundles: [] } };
    const selections = { presets: [], extensions: [], bundles: [] };
    const handoff = { schemaVersion: 1, handoffId: "missing-generate", workflow, selections,
        sourceFingerprint: fingerprint({ workflow, selections }) };
    let shell;
    try {
        await mkdir(project);
        const folder = handoffDirectory(workspace, handoff.handoffId);
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, "handoff.json"), JSON.stringify(handoff));
        const state = await model();
        await prepareScalarAdapters(project, state);
        shell = await startShell(handoff, state, { project, workspace,
            session: { send: async () => {} } });
        await page.goto(shell.url);
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
        await expect(page.locator("#generation-error")).toHaveText(
            "Canvas Design does not provide Generate in this session. Launch a new Designer session with a compatible Canvas Design extension or the current local source.");
        await page.getByRole("tab", { name: "Essentials" }).click();
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("new-canvas");
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
        await expect(page.locator("#generation-error")).toBeVisible();
    } finally {
        await shell?.close();
        await rm(workspace, { recursive: true, force: true });
    }
});

test("failed optional page shows safe diagnostics while Essentials remains editable", async ({ page }) => {
    const shell = await openWithError(page, "designer-appearance");
    try {
        await expect(page.locator("#conn-status")).toHaveText("Live");
        const id = page.getByRole("textbox", { name: "Canvas ID (required)" });
        await id.fill("my-canvas");
        await page.getByRole("tab", { name: "designer-appearance (error)" }).click();
        await expect(page.getByRole("heading", { name: "Could not load designer-appearance" })).toBeVisible();
        await expect(page.getByText("Resolved path: C:\\project\\.specify\\bad.json")).toBeVisible();
        await expect(page.getByText("Reason: Invalid JSON: <b>unexpected</b>")).toBeVisible();
        await expect(page.locator("#settings-page b")).toHaveCount(0);
        await page.getByRole("tab", { name: "Essentials" }).click();
        await expect(id).toHaveValue("my-canvas");
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
    } finally {
        await shell.close();
    }
});

test("Save keeps incomplete drafts, persists edits and reports stale revisions", async ({ page }) => {
    const workspace = await mkdtemp(join(scratchRoot, ".designer-save-e2e-"));
    const workflow = { selectedPhases: [] };
    const selections = { presets: [], extensions: [], bundles: [] };
    const handoff = { schemaVersion: 1, handoffId: "test", workflow, selections,
        sourceFingerprint: fingerprint({ workflow, selections }) };
    const folder = handoffDirectory(workspace, handoff.handoffId);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "handoff.json"), JSON.stringify(handoff));
    const initial = await model();
    initial.settingsRevision = 0;
    initial.persisted = false;
    const project = join(workspace, "project");
    await prepareScalarAdapters(project, initial);
    const shell = await startShell(handoff, initial, { project, workspace });
    const staleShell = await startShell(handoff, initial, { project, workspace });
    try {
        await page.goto(shell.url);
        const save = page.getByRole("button", { name: "Save", exact: true });
        await save.click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        await expect(page.locator('[id="setting-field-canvas.id-hint"]'))
            .toContainText("lowercase letters (a–z), numbers (0–9), and hyphens (-)");
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("example-canvas");
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Example");
        await save.click();
        await expect(page.locator("#action-message")).toHaveText("Settings saved.");
        await expect(save).toBeDisabled();
        await expect(page.locator("#save-help")).toHaveAttribute("title", "No changes to save");
        await expect(save).toHaveAttribute("aria-description", "No changes to save");
        expect(await save.evaluate((button) => getComputedStyle(button).cursor)).toBe("default");
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generate-canvas")).toBeDisabled();

        const reopenedModel = await loadDesignerSettings(workspace, handoff, await model());
        await prepareScalarAdapters(project, reopenedModel);
        const reopened = await startShell(handoff, reopenedModel, { project, workspace });
        try {
            await page.goto(reopened.url);
            await expect(page.getByRole("textbox", { name: "Canvas ID (required)" }))
                .toHaveValue("example-canvas");
            await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
            await expect(page.locator("#save-help")).toHaveAttribute("title", "No changes to save");
        } finally {
            await reopened.close();
        }

        await page.goto(staleShell.url);
        await page.getByRole("textbox", { name: "Title (required)" }).fill("Changed");
        await page.getByRole("textbox", { name: "Canvas ID (required)" }).fill("stale-canvas");
        await save.click();
        await expect(page.getByRole("alert")).toContainText("close and reopen Designer before saving");
        await expect(page.getByRole("textbox", { name: "Title (required)" })).toHaveValue("Changed");
    } finally {
        await shell.close();
        await staleShell.close();
        await rm(workspace, { recursive: true, force: true });
    }
});

test("failed Essentials remains selected with no identity fields; other tabs work", async ({ page }) => {
    const shell = await openWithError(page, "designer-essentials");
    try {
        await expect(page.getByRole("tab", { name: "designer-essentials (error)" }))
            .toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "Could not load designer-essentials" })).toBeVisible();
        await expect(page.getByRole("textbox")).toHaveCount(0);
        await page.getByRole("tab", { name: "Generate" }).click();
        await expect(page.locator("#generation-error")).toBeVisible();
        await expect(page.locator("#generate-canvas")).toBeDisabled();
    } finally {
        await shell.close();
    }
});

test("failed Essentials stays selected when a custom page sorts before it", async ({ page }) => {
    const state = await model();
    state.pages[0] = { page: "designer-essentials", title: "designer-essentials", order: 10,
        error: { name: "designer-essentials", path: "C:\\project\\.specify\\missing.json",
            reason: "resolved page file is missing" } };
    state.pages.push({ page: "custom-settings", id: "custom-settings", title: "Custom",
        order: 5, fields: [] });
    state.pages.sort((a, b) => a.order - b.order);
    const shell = await startPreparedShell(state);
    try {
        await page.goto(shell.url);
        await expect(page.getByRole("tab", { name: "designer-essentials (error)" }))
            .toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "Could not load designer-essentials" }))
            .toBeVisible();
    } finally {
        await shell.close();
    }
});
