import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./playwright.mjs";
import { startServer } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server.mjs";
import { readInstalledWorkflowInventory } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/server/handlers-designer.mjs";
import { validateHandoff } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/contracts/wizard-handoff.mjs";
import { handoffDirectory, readHandoff } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/handoff.mjs";
import { transferDesignerHandoff } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/bootstrap-artifacts.mjs";
import { startShell } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/server.mjs";
import releaseCatalog from "../../spec-kit-extensions/catalog.json" with { type: "json" };

const selectedBase = releaseCatalog.extensions["extension-canvas-design"];
const base = { id: selectedBase.id, source: "copilot", name: selectedBase.name,
    version: selectedBase.version, downloadUrl: selectedBase.download_url,
    tags: selectedBase.tags };
const runtime = { id: "runtime-ext", installedId: "runtime-ext", name: "Runtime",
    source: "copilot", version: selectedBase.version, downloadUrl: "https://example.com/runtime.zip",
    tags: ["canvas-design"] };
const scratchRoot = fileURLToPath(new URL("../../", import.meta.url));

test("raw Specify inventory survives a browser launch and the Wizard handoff opens Designer", async ({ page }) => {
    const checkout = await mkdtemp(join(scratchRoot, ".wizard-contract-checkout-"));
    const child = await mkdtemp(join(scratchRoot, ".designer-contract-child-"));
    const sourceRoot = join(checkout, "source-session");
    let server, shell;
    const prompts = [];
    const calls = [];
    const responses = {
        preset: "[]", extension: JSON.stringify([{ id: runtime.id, version: runtime.version,
            priority: 30, enabled: false, source: { kind: "catalog", catalog: "copilot" } }]),
        bundle: "[]",
    };
    const runner = async (_executable, args) => {
        calls.push(args.join(" "));
        return { stdout: responses[args[0]] };
    };
    const snapshot = {
        featureFlags: { generateCanvas: true },
        workspacePath: checkout, currentPhase: "constitution",
        setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
        boot: { phase: "ready", steps: [] }, phases: {}, commands: [],
        pipeline: [{ id: "speckit.constitution" }, { id: "speckit.specify" }],
        artifactEvidence: { specify: { candidates: [{
            kind: "file", relativeTo: "feature", path: "spec.md",
        }], primaryIndex: 0 } },
        catalog: { designerFingerprint: "contracts-e2e", presets: [],
            extensions: [base, runtime], bundles: [] },
    };
    try {
        await mkdir(join(checkout, ".specify"));
        await mkdir(sourceRoot);
        server = await startServer("contract-e2e", {
            session: {
                sessionId: "source-session",
                workspacePath: sourceRoot,
                send: async (input) => { prompts.push(input.prompt); },
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
            getInstalledWorkflow: (state) => readInstalledWorkflowInventory(state, runner),
            inspectBundle: async () => ({ source: "copilot", members: [] }),
        });
        await page.goto(server.url);
        await page.getByRole("tab", { name: "Phases" }).click();
        await page.getByRole("button", { name: "Generate canvas" }).click();
        const launch = page.getByRole("dialog", { name: "Canvas Designer setup" })
            .getByRole("button", { name: "Launch designer" });
        const validExtension = responses.extension;
        responses.extension = "{";
        await launch.click();
        await expect(page.getByRole("dialog", { name: "Canvas Designer setup" })
            .getByRole("alert")).toContainText("Invalid installed extensions");
        expect(prompts).toHaveLength(0);
        responses.extension = validExtension;
        calls.length = 0;
        await launch.click();
        await expect.poll(() => prompts.length).toBe(1);
        expect(new Set(calls)).toEqual(new Set([
            "preset list --json", "extension list --json", "bundle list --json",
        ]));
        const [, referenceText] = prompts[0].match(/LAUNCH_REFERENCE:\s*(\{[^\n]+\})/) ?? [];
        expect(referenceText).toBeTruthy();
        const reference = JSON.parse(referenceText);
        const json = await readFile(join(handoffDirectory(sourceRoot, reference.handoffId), "handoff.json"), "utf8");
        const handoff = validateHandoff(JSON.parse(json), JSON.parse(json).handoffId);
        expect(handoff.workflow.selectedPhases).toEqual(["constitution", "specify"]);
        expect(handoff.workflow.outputEvidence.constitution.outputs)
            .toEqual([".specify/memory/constitution.md"]);
        expect(handoff.workflow.outputEvidence.specify)
            .toEqual({ outputs: ["specs/<slug>/spec.md"], view: "specs/<slug>/spec.md" });
        expect(handoff.workflow.installed.extensions).toEqual([{
            id: runtime.id, version: runtime.version, priority: 30, enabled: false,
            source: "copilot", downloadUrl: runtime.downloadUrl,
        }]);
        expect(handoff.workflow.installLocators.extensions).toEqual([{
            installedId: runtime.id, source: "copilot", catalogId: runtime.id,
            downloadUrl: runtime.downloadUrl,
        }]);
        const folder = handoffDirectory(child, handoff.handoffId);
        await transferDesignerHandoff(reference, { sessionId: "child-session", root: child, project: checkout });
        expect(await readHandoff(child, handoff.handoffId)).toEqual(handoff);
        const model = { pages: [{ id: "designer-essentials", page: "designer-essentials",
            title: "Essentials", fields: [] }],
            constraints: {}, values: {}, revision: "test", outputs: handoff.workflow.outputEvidence };
        shell = await startShell(handoff, model, { workspace: child });
        await page.goto(shell.url);
        await expect(page.getByRole("tab", { name: "Outputs" })).toHaveCount(0);
        const stateUrl = new URL(shell.url);
        stateUrl.pathname = "/api/state";
        const state = await (await fetch(stateUrl)).json();
        expect(state.outputs).toEqual(handoff.workflow.outputEvidence);
        await writeFile(join(folder, "handoff.json"), JSON.stringify({
            ...handoff, sourceFingerprint: "0".repeat(64),
        }));
        await expect(readHandoff(child, handoff.handoffId)).rejects.toThrow();
    } finally {
        await page.close();
        if (shell) await shell.close();
        if (server) await new Promise((resolve, reject) =>
            server.server.close((error) => error ? reject(error) : resolve()));
        await rm(checkout, { recursive: true, force: true });
        await rm(child, { recursive: true, force: true });
    }
});
