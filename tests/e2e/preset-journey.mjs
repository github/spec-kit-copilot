import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { expect } from "./playwright.mjs";
import { startServer as startWizardServer } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server.mjs";
import { readInstalledWorkflowInventory } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/handlers-designer.mjs";
import { validateHandoff } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/contracts/wizard-handoff.mjs";
import { handoffDirectory, readHandoff } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/handoff.mjs";
import { transferDesignerHandoff } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/bootstrap-artifacts.mjs";
import { loadResolvedDesignerPages } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/pages.mjs";
import { loadDesignerSettings } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/settings.mjs";
import { startShell } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/server.mjs";
import releaseCatalog from "../../spec-kit-extensions/catalog.json" with { type: "json" };

const repository = fileURLToPath(new URL("../../", import.meta.url));
const extensionPath = fileURLToPath(new URL("../../spec-kit-extensions/extension-canvas-design/", import.meta.url));
const fixturePath = fileURLToPath(new URL("../fixtures/test-presets/", import.meta.url));

function run(executable, args, project) {
    const result = spawnSync(executable, args, {
        cwd: project, encoding: "utf8", timeout: 120_000,
        env: { ...process.env, COLUMNS: "8192", NO_COLOR: "1" },
    });
    expect(result.error, `${executable} ${args.join(" ")}: ${result.error}`).toBeUndefined();
    const diagnostic = `${result.stderr}\n${result.stdout}`;
    expect(result.status, `${executable} ${args.join(" ")}:\n${diagnostic.slice(-5000)}`).toBe(0);
    return stripVTControlCharacters(result.stdout);
}

async function makeDevSkillsWritable(project) {
    for (const command of ["load-page", "generate"]) {
        const path = join(project, ".github", "skills",
            `speckit-extension-canvas-design-${command}`, "SKILL.md");
        const stat = await lstat(path);
        if (!stat.isSymbolicLink()) continue;
        const bytes = await readFile(path);
        await unlink(path);
        await writeFile(path, bytes);
    }
}

async function closeServer(server) {
    if (server?.listening) await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
}

/**
 * Exercise the Wizard-to-Designer boundary without a model: capture the real UI
 * dispatch, then deterministically perform the child agent's documented CLI steps.
 * Call close() in finally; all checkout artifacts are scoped to this journey.
 */
export async function startPresetJourney(page, {
    presetId, selectedPhases = ["specify"], onGenerate = async () => {},
} = {}) {
    if (!/^copilot-[a-z0-9-]+-test$/.test(presetId ?? "")) {
        throw new Error("A test-only presetId is required.");
    }
    // Keep installed template paths below the legacy Windows MAX_PATH boundary.
    const workspace = await mkdtemp(join(repository, ".pj-"));
    const checkout = join(workspace, "wizard");
    const project = join(workspace, "project");
    const sourceRoot = join(workspace, "source-session");
    const presetPath = join(fixturePath, presetId);
    const published = releaseCatalog.extensions["extension-canvas-design"];
    const catalogBase = {
        id: published.id, name: published.name, version: published.version,
        downloadUrl: published.download_url, source: "copilot", tags: published.tags,
    };
    const snapshot = {
        featureFlags: { generateCanvas: true },
        workspacePath: checkout,
        currentPhase: "constitution",
        setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true,
            skillsReloaded: true },
        boot: { phase: "ready", steps: [] }, phases: {}, commands: [],
        pipeline: selectedPhases.map((id) => ({ id: `speckit.${id}` })),
        catalog: { designerFingerprint: "preset-journey-e2e", presets: [],
            extensions: [catalogBase], bundles: [] },
    };
    const prompts = [];
    let wizard, shell, generatedRoutes, generatedServer;
    const shells = new Set();
    const journey = {
        workspace, project, checkout,
        runSpecify: (...args) => run("specify", args, project),
        runInstalled: (script, ...args) => {
            if (!["verify-launch.mjs", "generate.mjs"].includes(script)) {
                throw new Error(`Unexpected installed Canvas Design script: ${script}`);
            }
            return run(process.execPath, [join(project, ".specify", "extensions",
                "extension-canvas-design", "scripts", script), ...args], project);
        },
        async openDesigner() {
            const resolved = await loadResolvedDesignerPages(
                journey.handoff, project, journey.pages, journey.templates);
            journey.resolved = resolved;
            shell = await startShell(journey.handoff,
                await loadDesignerSettings(workspace, journey.handoff, resolved),
                { workspace, project, session: { send: onGenerate } });
            shells.add(shell);
            journey.shell = shell;
            await page.goto(shell.url);
            return resolved;
        },
        async reopenDesigner() {
            return journey.openDesigner();
        },
        async generate(requestId) {
            const folder = handoffDirectory(workspace, journey.handoff.handoffId);
            const requests = await readdir(join(folder, "generations"));
            expect(requests).toContain(requestId);
            journey.runInstalled("generate.mjs", project, workspace,
                journey.handoff.handoffId, requestId);
        },
        async serveGenerated(canvasId, { token = "preset-journey-token" } = {}) {
            const { createWorkflowRoutes } = await import(pathToFileURL(join(project,
                ".github", "extensions", canvasId, "server.mjs")).href);
            const config = JSON.parse(await readFile(join(project, ".github",
                "extensions", canvasId, "canvas-config.json"), "utf8"));
            generatedRoutes = createWorkflowRoutes(config, {
                runtime: null, instanceId: randomUUID(), token,
                port: () => generatedServer.address().port,
            });
            generatedServer = createServer(generatedRoutes.handle);
            await new Promise((resolve) => generatedServer.listen(0, "127.0.0.1", resolve));
            const url = `http://127.0.0.1:${generatedServer.address().port}/?token=${token}`;
            await page.goto(url, { waitUntil: "commit" });
            return { url, config };
        },
        async close() {
            generatedRoutes?.close();
            await closeServer(generatedServer);
            for (const opened of shells) await opened.close();
            await closeServer(wizard?.server);
            await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
        },
    };
    try {
        await mkdir(join(checkout, ".specify"), { recursive: true });
        await mkdir(sourceRoot);
        wizard = await startWizardServer(randomUUID(), {
            session: {
                sessionId: "source-session",
                workspacePath: sourceRoot,
                send: async ({ prompt }) => { prompts.push(prompt); },
                rpc: {
                    metadata: { snapshot: async () => ({
                        sessionId: "source-session", workspacePath: sourceRoot, workingDirectory: checkout,
                    }) },
                    extensions: { list: async () => ({ extensions: [{
                        id: "plugin:spec-kit-copilot-wizard:speckit-canvas-designer",
                        source: "plugin", status: "running",
                    }] }) },
                    canvas: { list: async () => ({ canvases: [{
                        extensionId: "plugin:spec-kit-copilot-wizard:speckit-canvas-designer",
                        canvasId: "speckit-canvas-designer",
                    }] }) },
                },
            },
            log: async () => {},
            getState: async () => snapshot,
            getInstance: () => ({ workspacePath: checkout, generateCanvas: true }),
            getInstalledWorkflow: (state) => readInstalledWorkflowInventory(state,
                async (_executable, args) => ({ stdout: "[]" })),
        });
        await page.goto(wizard.url);
        await page.getByRole("tab", { name: "Phases" }).click();
        await page.getByRole("button", { name: "Generate canvas" }).click();
        const dialog = page.getByRole("dialog", { name: "Canvas Designer setup" });
        const local = dialog.locator("[data-designer-local]");
        await local.locator("summary").click();
        for (const path of [presetPath, extensionPath]) {
            await local.locator("[data-designer-local-path]").fill(path);
            await local.locator("[data-designer-local-add]").click();
        }
        await expect(local.locator(".designer-local-item")).toHaveCount(2);
        for (const checkbox of await local.locator(".designer-local-item")
            .getByRole("checkbox").all()) await expect(checkbox).toBeChecked();
        await dialog.getByRole("button", { name: "Launch designer" }).click();
        await expect.poll(() => prompts.length).toBe(1);
        const [, referenceText] = prompts[0].match(/LAUNCH_REFERENCE:\r?\n([^\r\n]+)/) ?? [];
        expect(referenceText, "Wizard must dispatch a source-owned launch reference").toBeTruthy();
        const reference = JSON.parse(referenceText);
        const json = await readFile(join(handoffDirectory(sourceRoot, reference.handoffId), "handoff.json"), "utf8");
        journey.handoffJson = json;
        journey.handoffHash = reference.sha256;
        expect(createHash("sha256").update(json, "utf8").digest("hex")).toBe(reference.sha256);
        const parsed = JSON.parse(json);
        journey.handoff = validateHandoff(parsed, parsed.handoffId);
        expect(journey.handoff.workflow.selectedPhases).toEqual(selectedPhases);
        expect(journey.handoff.localSelections.presets).toEqual([expect.objectContaining({
            id: presetId, path: await realpath(presetPath), source: "local", approved: true,
        })]);
        expect(journey.handoff.localSelections.extensions).toEqual([expect.objectContaining({
            id: "extension-canvas-design", path: await realpath(extensionPath),
            source: "local", approved: true,
        })]);
        await page.goto("about:blank");
        await closeServer(wizard.server);
        wizard = undefined;

        const folder = handoffDirectory(workspace, journey.handoff.handoffId);
        await transferDesignerHandoff(reference, { sessionId: "child-session", root: workspace, project });
        expect(await readFile(join(folder, "handoff.json"), "utf8")).toBe(json);
        expect(await readHandoff(workspace, journey.handoff.handoffId,
            undefined, journey.handoffHash)).toEqual(journey.handoff);
        await mkdir(project);
        journey.runSpecify("init", "--here", "--force", "--non-interactive",
            "--ignore-agent-tools", "--integration", "copilot",
            "--integration-options=--skills", "--script",
            process.platform === "win32" ? "ps" : "sh");
        for (const selection of journey.handoff.localSelections.extensions) {
            journey.runSpecify("extension", "add", selection.path, "--dev", "--force");
            expect(JSON.parse(journey.runSpecify("extension", "list", "--json"))
                .find((item) => item.id === selection.id)?.version).toBe(selection.version);
        }
        await makeDevSkillsWritable(project);
        for (const selection of journey.handoff.localSelections.presets) {
            journey.runSpecify("preset", "add", "--dev", selection.path);
            expect(JSON.parse(journey.runSpecify("preset", "list", "--json"))
                .find((item) => item.id === selection.id)?.version).toBe(selection.version);
        }
        journey.composedSkill = await readFile(join(project, ".github", "skills",
            "speckit-extension-canvas-design-load-page", "SKILL.md"), "utf8");
        const resolved = JSON.parse(journey.runInstalled("verify-launch.mjs", project));
        expect(resolved.pages.length).toBeGreaterThan(0);
        expect(resolved.templates.length).toBeGreaterThan(0);
        journey.pages = resolved.pages;
        journey.templates = resolved.templates;
        await journey.openDesigner();
        return journey;
    } catch (error) {
        await journey.close();
        throw error;
    }
}
