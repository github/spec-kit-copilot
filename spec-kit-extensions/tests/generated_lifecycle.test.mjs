import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readWorkflowPage } from "../extension-canvas-design/generated-scaffold/contracts/packaged-contributions.mjs";

test("schema-v1 packaged phase control retains and verifies its frozen slots", async () => {
    const workflow = Buffer.from(JSON.stringify({
        schemaVersion: 1, id: "workflow", title: "Workflow", order: 1, slots: ["workflow.phases"],
    }));
    const control = await readFile(new URL("../extension-canvas-design/generated-host/phase-control/phase-control.json", import.meta.url));
    const adapter = await readFile(new URL("../extension-canvas-design/generated-host/phase-control/generated-phase-adapter.mjs", import.meta.url));
    const registration = JSON.parse(control);
    const files = new Map([["workflow.json", workflow], ["phase-control.json", control],
        ["generated-phase-adapter.mjs", adapter]]);
    const page = {
        title: "Workflow", order: 1, slots: ["workflow.phases"],
        adapter: registration.adapter, managedRun: false, placement: registration.placement,
        viewLabels: {}, phaseSlots: registration.slots,
        definitionHash: createHash("sha256").update(workflow).digest("hex"),
        controlHash: createHash("sha256").update(control).digest("hex"),
        hash: createHash("sha256").update(adapter).digest("hex"),
    };
    const readPackagedFile = (url) => files.get(basename(fileURLToPath(url)));
    assert.deepEqual(readWorkflowPage(page, readPackagedFile), adapter);
    assert.throws(() => readWorkflowPage({ ...page, phaseSlots: [] }, readPackagedFile),
        /Packaged phase control definition differs/);
});

test("closing the last started panel while another opens retains the shared runtime", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "generated-lifecycle-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const target = join(root, "generated");
    await cp(new URL("../extension-canvas-design/generated-scaffold/", import.meta.url),
        target, { recursive: true });
    const definition = await readFile(new URL("../extension-canvas-design/generated-host/workflow-page/workflow.json", import.meta.url));
    const control = await readFile(new URL("../extension-canvas-design/generated-host/phase-control/phase-control.json", import.meta.url));
    const adapter = await readFile(new URL("../extension-canvas-design/generated-host/phase-control/generated-phase-adapter.mjs", import.meta.url));
    const pageAdapter = await readFile(new URL("../extension-canvas-design/generated-host/workflow-page/generated-workflow-page-adapter.mjs", import.meta.url));
    await mkdir(join(target, "pages"), { recursive: true });
    await writeFile(join(target, "pages", "workflow.json"), definition);
    await writeFile(join(target, "pages", "phase-control.json"), control);
    await writeFile(join(target, "pages", "generated-phase-adapter.mjs"), adapter);
    await writeFile(join(target, "pages", "generated-workflow-page-adapter.mjs"), pageAdapter);
    await writeFile(join(target, "canvas-config.json"), JSON.stringify({
        schemaVersion: 1, userProvidesSlug: false,
        canvas: { id: "lifecycle", displayName: "Lifecycle",
            description: "Test canvas", workflowListName: "Workflows" },
        workflowPage: { title: JSON.parse(definition).title, order: JSON.parse(definition).order,
            managedRun: false,
            slots: JSON.parse(definition).slots,
            phaseSlots: JSON.parse(control).slots,
            phaseControl: "generated-phase-control", adapter: "generated-phase-adapter",
            pageAdapter: "generated-workflow-page-adapter",
            pageAdapterHash: createHash("sha256").update(pageAdapter).digest("hex"),
            badgeDestinations: JSON.parse(definition).badgeDestinations,
            placement: JSON.parse(control).placement, viewLabels: {},
            definitionHash: createHash("sha256").update(definition).digest("hex"),
            controlHash: createHash("sha256").update(control).digest("hex"),
            hash: createHash("sha256").update(adapter).digest("hex") },
        phases: ["specify"],
        phaseOutputs: { specify: { expectsArtifact: true, outputPath: "specs/<slug>/spec.md" } },
        phaseArtifacts: {}, installed: { presets: [], extensions: [], bundles: [] },
    }));
    const sdk = join(target, "node_modules", "@github", "copilot-sdk");
    await mkdir(sdk, { recursive: true });
    await writeFile(join(sdk, "package.json"), JSON.stringify({
        name: "@github/copilot-sdk", type: "module", exports: { "./extension": "./extension.mjs" },
    }));
    await writeFile(join(sdk, "extension.mjs"), `
        export const createCanvas = (options) => options;
        export async function joinSession({ canvases }) {
            globalThis.__lifecycleCanvas = canvases[0];
            return { sessionId: "lifecycle", workspacePath: ${JSON.stringify(root)},
                rpc: { metadata: { snapshot: async () => ({ workingDirectory: ${JSON.stringify(root)} }) } },
                on: () => () => {}, getEvents: async () => [], log: async () => {} };
        }
    `);
    await import(pathToFileURL(join(target, "extension.mjs")).href);
    const canvas = globalThis.__lifecycleCanvas;
    delete globalThis.__lifecycleCanvas;
    const first = await canvas.open({ instanceId: "first" });
    try {
        const opening = canvas.open({ instanceId: "second" });
        await canvas.onClose({ instanceId: "first" });
        const second = await opening;
        try {
            assert.match(await (await fetch(second.url)).text(), /Lifecycle/);
            const action = canvas.actions.find((entry) => entry.name === "report_phase_artifact");
            await assert.rejects(async () => action.handler({ instanceId: "second",
                input: { phaseRunId: "missing", path: "specs/missing/spec.md" } }),
            /Unknown or stale phase reporting request/);
        } finally {
            await canvas.onClose({ instanceId: "second" });
        }
    } finally {
        await canvas.onClose({ instanceId: "first" });
    }
    assert.match(first.url, /^http:/);
});
