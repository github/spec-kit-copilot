import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { freezeGeneration } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/generation.mjs";
import { materialize } from "../extension-canvas-design/scripts/generate.mjs";
import { renderStockPage } from "../extension-canvas-design/generated-host/workflow-page/generated-workflow-page-adapter.mjs";
import { addWorkflowFixture } from "./workflow_fixture.mjs";
import { addDesignerAdapterFixture } from "./designer_adapter_fixture.mjs";

const source = new URL("../extension-canvas-design/", import.meta.url);
const digest = (data) => createHash("sha256").update(data).digest("hex");
function workflowMarkup(config) {
    const root = { innerHTML: "" };
    renderStockPage(root, { canvas: config.canvas, mainPageAsset: config.mainPageAsset,
        readOnlyFields: config.readOnlyFields ?? [], textPlacements: config.textPlacements ?? [],
        generatedControls: config.generatedControls ?? [],
        hasConstitution: config.phases.includes("constitution"),
        hasBadges: Boolean(config.badges?.instances?.length),
        hasValues: Boolean(config.valueSources?.length),
        badgeDestinations: config.workflowPage.badgeDestinations, fieldSlots: [] });
    return root.innerHTML;
}
const handoff = { handoffId: "text-handoff", selections: {}, workflow: {
    selectedPhases: ["specify"], installed: { presets: [], extensions: [], bundles: [] },
} };
handoff.sourceFingerprint = digest(JSON.stringify({
    workflow: handoff.workflow, selections: handoff.selections,
}));

async function fixture(t) {
    const root = join(process.cwd(), `.canvas-text-test-${randomUUID()}`);
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, "project"), workspace = join(root, "workspace");
    const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
    await mkdir(join(project, ".specify", "templates"), { recursive: true });
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "handoff.json"), JSON.stringify(handoff));
    const templates = [];
    for (const [name, kind, file] of [
        ["shared-controls-text", "shared.control-definition", "shared-controls/stock-text/control.json"],
        ["designer-control-adapter-text", "designer.control-adapter", "shared-controls/stock-text/designer.mjs"],
        ["generated-control-adapter-text", "generated.control-adapter", "shared-controls/stock-text/generated.mjs"],
        ["shared-controls-checkbox", "shared.control-definition", "shared-controls/stock-checkbox/control.json"],
        ["designer-control-adapter-checkbox", "designer.control-adapter", "shared-controls/stock-checkbox/designer.mjs"],
    ]) {
        const bytes = await readFile(new URL(file, source));
        const path = join(project, ".specify", "templates",
            `${name}.${kind === "shared.control-definition" ? "json" : "mjs"}`);
        await writeFile(path, bytes);
        templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path: await realpath(path), hash: digest(bytes) });
    }
    const fields = [
        ["canvas.description", "Description", "workflow.description"],
        ["canvas.workflowListName", "Header text", "workflow.heading"],
        ["billing.code", "Cost code", "details.content"],
    ];
    const model = {
        revision: "text-revision",
        pages: [{ page: "designer-essentials", fields: [
            { id: "canvas.id" }, { id: "canvas.displayName" }] }],
        constraints: {
            "canvas.id": { type: "string", minLength: 1, maxLength: 100,
                pattern: "^[a-z0-9][a-z0-9-]*$" },
            "canvas.displayName": { type: "string", minLength: 1, maxLength: 120 },
            "canvas.description": { type: "string", maxLength: 240 },
            "canvas.workflowListName": { type: "string", maxLength: 80 },
            "billing.code": { type: "string", maxLength: 64 },
            "workflowSlug.userProvided": { type: "boolean" },
        },
        templates, controls: [{ id: "stock.text",
            adapters: { designer: "designer-control-adapter-text", generated: "generated-control-adapter-text" } },
        { id: "stock.checkbox", adapters: { designer: "designer-control-adapter-checkbox" } }],
        contributions: [...fields.map(([id, label, slot]) => ({
            name: id,
            field: { id, label, type: "string", control: "stock.text" },
            generatedBinding: { presentation: slot === "details.content" ? "stock.readonly" : "text",
                slot },
        })), { name: "custom-slug",
            field: { id: "workflowSlug.userProvided", type: "boolean",
                label: "Allow custom slug", control: "stock.checkbox" } }],
    };
    const values = {
        "canvas.id": "text-canvas", "canvas.displayName": "Text canvas",
        "canvas.description": 'Hello <script>"there"</script>',
        "canvas.workflowListName": "My workflows", "billing.code": "CC-481",
        "workflowSlug.userProvided": false,
    };
    await addDesignerAdapterFixture(project, model);
    await addWorkflowFixture(project, model);
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    return { project, workspace, prepared, model, values, templates,
        requestPath: join(folder, "generations", prepared.requestId, "request.json"),
        sdk: join(project, ".github", "extensions", "text-canvas") };
}

async function rewrite(path, edit) {
    const request = JSON.parse(await readFile(path, "utf8"));
    edit(request);
    const { integrity: _old, ...payload } = request;
    await writeFile(path, JSON.stringify({ ...payload, integrity: digest(JSON.stringify(payload)) }));
}

test("frozen stock.text is packaged once and mounted at visible slots without design-time files", async (t) => {
    const { project, workspace, prepared, requestPath, sdk } = await fixture(t);
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    assert.deepEqual(request.generatedTextPlacements.map(({ presentation, slot }) => [presentation, slot]),
        [["text", "workflow.description"], ["text", "workflow.heading"],
            ["stock.readonly", "details.content"]]);
    assert.equal(request.generatedTextControl.assets.length, 2);
    assert.equal(request.generatedControls, undefined);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml, createWorkflowRoutes } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const config = readConfig();
    assert.equal(config.textControl.adapter, "generated-control-adapter-text");
    assert.deepEqual((await readdir(join(sdk, "controls"))).sort(),
        ["generated-control-adapter-text.mjs", "shared-controls-text.json"]);
    const html = `${renderHtml(config, "secret")}${workflowMarkup(config)}`;
    assert.match(html, /data-stock-text="workflow.description"[^>]*>Hello &lt;script&gt;&quot;there&quot;&lt;\/script&gt;/);
    assert.match(html, /data-stock-text="workflow.heading"[^>]*>My workflows<\/span> <span class="muted" id="workflow-count">\(0\)/);
    assert.match(html, /data-field-id="billing.code" data-stock-text="details.content"[^>]*>CC-481/);
    assert.match(html, /id="stock-text-registration"/);
    assert.match(html, /id="workflow-slug"[^>]+maxlength="100"/);
    assert.doesNotMatch(html, /id="workflow-slug"[^>]+required/);
    const routes = createWorkflowRoutes(config, { token: "secret", runtime: null });
    const server = createServer(routes.handle);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
        routes.close();
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
    });
    const url = `http://127.0.0.1:${server.address().port}/controls/generated-control-adapter-text.mjs`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(`${url}?token=secret`)).status, 200);
    const portable = join(workspace, "portable");
    await cp(sdk, portable, { recursive: true });
    assert.equal((await import(`${pathToFileURL(join(portable, "server.mjs")).href}?portable=1`))
        .readConfig().textControl.hash, config.textControl.hash);
    const packaged = join(sdk, "controls", "generated-control-adapter-text.mjs");
    await writeFile(packaged, "export function mount() {}");
    assert.throws(() => readConfig(), /stock.text adapter does not match its frozen hash/);
    assert.equal((await fetch(`${url}?token=secret`)).status, 500);
});

test("generator independently enforces required text constraints in frozen requests", async (t) => {
    const { project, workspace, prepared, requestPath } = await fixture(t);
    const original = JSON.parse(await readFile(requestPath, "utf8"));
    await rewrite(requestPath, (request) => {
        request.fieldConstraints["billing.code"].required = true;
        request.values["billing.code"] = "   ";
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen Designer field: billing.code/);
    await rewrite(requestPath, (request) => {
        request.values["billing.code"] = "CC-481";
    });
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    await writeFile(requestPath, JSON.stringify(original));
});

test("stock.text freezes winning bytes and rejects missing, altered and incompatible adapters", async (t) => {
    const { project, workspace, prepared, requestPath, sdk, model, values, templates } = await fixture(t);
    const original = JSON.parse(await readFile(requestPath, "utf8"));
    await rewrite(requestPath, (request) => { request.generatedTextControl.assets[1].hash = "0".repeat(64); });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /stock.text control asset or hash/);
    await rewrite(requestPath, (request) => {
        request.generatedTextControl = structuredClone(original.generatedTextControl);
        request.generatedTextControl.assets[1].name = "wrong-adapter";
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Incompatible frozen stock.text/);
    await rewrite(requestPath, (request) => {
        request.generatedTextControl = structuredClone(original.generatedTextControl);
        request.generatedTextPlacements[1].slot = "workflow.description";
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen stock.text placements/);
    await rewrite(requestPath, (request) => {
        request.generatedTextPlacements = structuredClone(original.generatedTextPlacements);
        request.generatedTextPlacements[0].presentation = "stock.readonly";
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen stock.text placements/);
    await rewrite(requestPath, (request) => {
        request.generatedTextPlacements = structuredClone(original.generatedTextPlacements);
        delete request.generatedTextControl;
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Invalid frozen stock.text placements/);
    await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    await writeFile(requestPath, JSON.stringify(original));
    await writeFile(templates.find((asset) => asset.name === "generated-control-adapter-text").path,
        "export function mount() {}");
    await assert.rejects(freezeGeneration({ model, values, handoff, project, workspace }),
        /generated asset changed/);
});

test("header text requires declared placements; absent contributions retain shell defaults", async (t) => {
    const { project, workspace, model, values, sdk } = await fixture(t);
    const withoutVisual = structuredClone(model);
    withoutVisual.contributions = withoutVisual.contributions.filter((item) =>
        item.generatedBinding?.presentation !== "text"
        && item.generatedBinding?.presentation !== "stock.readonly");
    const defaults = { ...values, "canvas.description": "", "canvas.workflowListName": "" };
    const prepared = await freezeGeneration({ model: withoutVisual, values: defaults,
        handoff, project, workspace });
    const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.equal(request.generatedTextControl, undefined);
    assert.equal(request.generatedTextPlacements, undefined);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const config = readConfig();
    assert.equal(config.textControl, undefined);
    await assert.rejects(readdir(join(sdk, "controls")), { code: "ENOENT" });
    const html = `${renderHtml(config)}${workflowMarkup(config)}`;
    assert.match(html, /<h2 id="workflow-heading">Workflows <span class="muted" id="workflow-count">\(0\)/);
    assert.match(html, /<p class="collection-description muted">Spec Kit workflow canvas\.<\/p>/);
    assert.doesNotMatch(html, /data-stock-text|stock-text-registration/);
    for (const [slot, expected] of [
        ["workflow.heading", /Invalid or duplicate generated stock.text placement/],
        ["details.content", /Invalid or duplicate generated stock.text placement/],
    ]) {
        const invalid = structuredClone(model);
        invalid.contributions[0].generatedBinding.slot = slot;
        await assert.rejects(freezeGeneration({ model: invalid, values, handoff,
            project, workspace }), expected);
    }
    const duplicate = structuredClone(model);
    duplicate.contributions.push({ ...duplicate.contributions[0], name: "duplicate" });
    await assert.rejects(freezeGeneration({ model: duplicate, values, handoff,
        project, workspace }), /Invalid or duplicate generated stock.text placement/);
});

test("stock.readonly text resolves the winning shared definition by control ID", async (t) => {
    const { project, workspace, model, values, sdk } = await fixture(t);
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    const request = JSON.parse(await readFile(join(workspace, "speckit-canvas-designer",
        "handoffs", handoff.handoffId, "generations", prepared.requestId, "request.json"), "utf8"));
    assert.equal(request.generatedTextControl.assets[0].name, "shared-controls-text");
    assert.deepEqual(request.generatedTextPlacements.at(-1), {
        id: "billing.code", label: "Cost code",
        presentation: "stock.readonly", slot: "details.content",
    });
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    assert.match(workflowMarkup(readConfig()), /data-field-id="billing.code" data-stock-text="details.content"/);
    const invalid = { ...model, templates: model.templates.filter((entry) =>
        entry.name !== "shared-controls-text") };
    await assert.rejects(freezeGeneration({ model: invalid, values, handoff, project, workspace }),
        /Missing paired stock.text definition or generated adapter/);
    const duplicate = { ...model, templates: [...model.templates, {
        ...model.templates.find((entry) => entry.name === "shared-controls-text"),
        name: "another-stock-text",
    }] };
    await assert.rejects(freezeGeneration({ model: duplicate, values, handoff, project, workspace }),
        /Missing paired stock.text definition or generated adapter/);
});

test("packaged stock.text adapter receives string values and host-owned presentation context", async () => {
    const { mount, controlId, valueContract } = await import(
        new URL("../extension-canvas-design/shared-controls/stock-text/generated.mjs", import.meta.url));
    assert.equal(controlId, "stock.text");
    assert.deepEqual(valueContract, { type: "string" });
    const previous = globalThis.document;
    const span = {};
    globalThis.document = { createElement: (name) => {
        assert.equal(name, "span"); return span;
    } };
    try {
        const root = { replaceChildren(...nodes) { this.children = nodes; } };
        mount({ root, field: { id: "canvas.description", label: "Description" },
            value: "<unsafe>", context: { className: "", slot: "workflow.description" } });
        assert.deepEqual(root.children, [span]);
        assert.equal(span.textContent, "<unsafe>");
        assert.throws(() => mount({ root, field: { id: "canvas.description" },
            value: false, context: { className: "" } }), /Invalid packaged text presentation/);
    } finally {
        globalThis.document = previous;
    }
});
