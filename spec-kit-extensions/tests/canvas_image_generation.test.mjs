import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, readFile, readdir, realpath, rename, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { freezeGeneration } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/generation.mjs";
import { saveDesignerSettings } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/settings.mjs";
import { materialize } from "../extension-canvas-design/scripts/generate.mjs";
import { renderStockPage } from "../extension-canvas-design/generated-host/workflow-page/generated-workflow-page-adapter.mjs";
import { addWorkflowFixture } from "./workflow_fixture.mjs";
import { mountPageAssets, createStockImageRenderer } from
    "../extension-canvas-design/generated-scaffold/ui/page-assets.mjs";
import { addDesignerAdapterFixture } from "./designer_adapter_fixture.mjs";

const source = new URL("../extension-canvas-design/", import.meta.url);
const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YC24x8AAAAASUVORK5CYII=";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const handoff = { handoffId: "image-handoff", selections: {},
    workflow: { selectedPhases: ["specify"],
        installed: { presets: [], extensions: [], bundles: [] } } };
handoff.sourceFingerprint = digest(JSON.stringify({
    workflow: handoff.workflow, selections: handoff.selections,
}));

async function setup(t, selected = [logo, logo, logo]) {
    const root = join(process.cwd(), `.canvas-image-test-${randomUUID()}`);
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, "project"), workspace = join(root, "workspace");
    const specify = join(project, ".specify", "templates");
    await mkdir(specify, { recursive: true });
    await mkdir(workspace);
    const handoffFolder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
    await mkdir(handoffFolder, { recursive: true });
    await writeFile(join(handoffFolder, "handoff.json"), JSON.stringify(handoff));
    const names = [
        ["shared-controls-image", "shared.control-definition", "shared-controls/stock-image/control.json"],
        ["generated-control-adapter-image", "generated.control-adapter", "shared-controls/stock-image/generated.mjs"],
    ];
    const templates = [];
    for (const [name, kind, file] of names) {
        const path = join(specify, `${name}.${kind === "shared.control-definition" ? "json" : "mjs"}`);
        const bytes = await readFile(new URL(file, source));
        await writeFile(path, bytes);
        templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path: await realpath(path), hash: digest(bytes) });
    }
    const page = { schemaVersion: 1, id: "gallery", title: "Gallery", renderer: "gallery-renderer",
        slots: [{ id: "gallery.logo" }] };
    const pageFiles = [
        ["gallery", "generated.added-page-definition", JSON.stringify(page)],
        ["gallery-renderer", "generated.added-page-renderer",
            'export function renderPage({ root }) { const el = document.createElement("div"); el.dataset.assetSlot = "gallery.logo"; root.append(el); }'],
    ];
    for (const [name, kind, text] of pageFiles) {
        const path = join(specify, `${name}.${kind === "generated.added-page-definition" ? "json" : "mjs"}`);
        await writeFile(path, text);
        templates.push({ name, kind, sourceId: "extension:extension-canvas-design",
            strategy: "replace", path: await realpath(path), hash: digest(text) });
    }
    const fieldIds = ["canvas.logo", "main.logo", "gallery.logo"];
    const baseConstraints = {
        "canvas.id": { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
        "canvas.displayName": { type: "string", minLength: 1, maxLength: 120 },
    };
    const constraints = Object.fromEntries(fieldIds.map((id) => [id, { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] }]));
    const values = { "canvas.id": "image-canvas", "canvas.displayName": "Image canvas",
        ...Object.fromEntries(fieldIds.map((id, index) => [id, selected[index]])) };
    const contributions = fieldIds.map((id, index) => ({
        name: `image-${index}`,
        field: { id, label: `Logo ${index}`, type: "image", control: "stock.image" },
        generatedBinding: { presentation: "asset",
            slot: ["header.brand", "workflow.intro", "gallery.logo"][index],
            ...(index === 2 ? { page: "gallery" } : {}) },
    }));
    const model = { revision: "image-revision",
        pages: [{ page: "designer-essentials", fields: [
            { id: "canvas.id" }, { id: "canvas.displayName" }] }],
        constraints: { ...baseConstraints, ...constraints }, templates, contributions,
        controls: [{ id: "stock.image", adapters: { generated: "generated-control-adapter-image" } }],
        generatedPages: [{ id: "gallery", name: "gallery", title: "Gallery",
            renderer: "gallery-renderer", slots: page.slots }] };
    await addDesignerAdapterFixture(project, model);
    await addWorkflowFixture(project, model);
    const prepared = await freezeGeneration({ model, values, handoff, project, workspace });
    const requestPath = join(handoffFolder, "generations", prepared.requestId, "request.json");
    const sdk = join(project, ".github", "extensions", "image-canvas");
    return { project, workspace, prepared, sdk, requestPath, templates: model.templates, model, values };
}

async function rewrite(requestPath, edit) {
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    edit(request);
    const { integrity: _previous, ...payload } = request;
    await writeFile(requestPath, JSON.stringify({ ...payload, integrity: digest(JSON.stringify(payload)) }));
}

test("stock.image resolves a unique frozen definition by control ID", async (t) => {
    const { project, workspace, templates, model, values } = await setup(t);
    const missing = { ...model, templates: templates.filter((entry) =>
        entry.name !== "shared-controls-image") };
    await assert.rejects(freezeGeneration({ model: missing, values, handoff, project, workspace }),
        /Missing paired stock.image definition or generated adapter/);
    const duplicate = { ...model, templates: [...templates, {
        ...templates.find((entry) => entry.name === "shared-controls-image"),
        name: "another-stock-image",
    }] };
    await assert.rejects(freezeGeneration({ model: duplicate, values, handoff, project, workspace }),
        /Missing paired stock.image definition or generated adapter/);
});

test("ten maximum-size images fit Designer Save and the frozen generation request", async (t) => {
    const { project, workspace, model, values } = await setup(t);
    const base = Buffer.from(logo.split(",")[1], "base64");
    const chunk = Buffer.alloc(32768 - base.length);
    chunk.writeUInt32BE(chunk.length - 12, 0);
    chunk.write("tEXt", 4);
    chunk.fill(65, 8, chunk.length - 4);
    chunk.write("Comment\0", 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    const maximum = `data:image/png;base64,${Buffer.concat([
        base.subarray(0, -12), chunk, base.subarray(-12),
    ]).toString("base64")}`;
    const fields = { ...values };
    const constraints = { ...model.constraints };
    const contributions = [...model.contributions];
    for (const contribution of contributions) fields[contribution.field.id] = maximum;
    for (let index = 3; index < 10; index++) {
        const id = `gallery.logo${index}`;
        fields[id] = maximum;
        constraints[id] = model.constraints["canvas.logo"];
        contributions.push({ name: `extra-${index}`, field: {
            id, label: `Gallery image ${index}`, type: "image", control: "stock.image",
        }, generatedBinding: { presentation: "asset", page: "gallery",
            slot: `gallery.extra${index}` } });
    }
    const expanded = { ...model, constraints, contributions };
    assert.ok(Buffer.byteLength(JSON.stringify({ revision: model.revision, values: fields })) > 256 * 1024);
    await saveDesignerSettings(workspace, handoff, expanded, {
        revision: 0, modelRevision: model.revision, values: fields,
    });
    const prepared = await freezeGeneration({ model: expanded, values: fields, handoff,
        project, workspace });
    const frozen = await readFile(join(workspace, "speckit-canvas-designer", "handoffs",
        handoff.handoffId, "generations", prepared.requestId, "request.json"));
    assert.ok(frozen.length > 512 * 1024 && frozen.length <= 2 * 1024 * 1024);
    assert.equal(JSON.parse(frozen).generatedAssets.length, 10);
});

test("image controls label removal and keep independent uploads busy until each finishes", async () => {
    const { mount } = await import(new URL("shared-controls/stock-image/designer.mjs", source));
    const previousDocument = globalThis.document;
    const previousImage = globalThis.Image;
    const element = (tag) => ({
        tag, children: [], attributes: new Map(), classList: { add() {} },
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
        addEventListener(name, handler) { this[name] = handler; },
        replaceChildren(...children) { this.children = children; },
        append(...children) { this.children.push(...children); },
    });
    globalThis.document = { createElement: element };
    globalThis.Image = class {
        set src(_value) { queueMicrotask(() => this.onload()); }
    };
    try {
        const active = new Set();
        const changes = [];
        const pending = [];
        const png = Buffer.from(logo.split(",")[1], "base64");
        for (const label of ["Header logo", "Main page logo"]) {
            const root = element("div");
            root.isConnected = true;
            let finish;
            const bytes = new Promise((resolve) => { finish = resolve; });
            mount({ root, field: { id: label.replaceAll(" ", "-"), label,
                validation: { type: "image", maxBytes: 32768,
                    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] } },
                value: "", context: {
                setBusy(busy) { if (busy) active.add(label); else active.delete(label); },
            }, onChange(value) { changes.push({ label, value }); } });
            const input = root.children[2].children[0];
            const remove = root.children[2].children[1];
            assert.equal(remove.attributes.get("aria-label"), `Remove ${label} image`);
            input.files = [{ type: "image/png", size: png.length, arrayBuffer: () => bytes }];
            pending.push({ root, input, remove, finish, operation: input.change() });
        }
        assert.equal(active.size, 2);
        assert.ok(pending.every(({ input, remove }) => input.disabled && remove.disabled));
        pending[0].finish(png);
        await pending[0].operation;
        assert.deepEqual([...active], ["Main page logo"]);
        assert.equal(changes.length, 1);
        pending[1].root.isConnected = false;
        pending[1].finish(png);
        await pending[1].operation;
        assert.equal(active.size, 0);
        assert.equal(changes.length, 1);
    } finally {
        globalThis.document = previousDocument;
        globalThis.Image = previousImage;
    }
});

test("one frozen stock.image adapter renders Header, Main and gallery without design-time files", async (t) => {
    const { project, workspace, prepared, sdk, requestPath } = await setup(t);
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    assert.equal(request.generatedImageControl.assets.length, 2);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml, createWorkflowRoutes } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const config = readConfig();
    assert.equal(config.imageControl.adapter, "generated-control-adapter-image");
    assert.equal(config.generatedPageAssets.length, 1);
    const configPath = join(sdk, "canvas-config.json");
    const configText = await readFile(configPath, "utf8");
    for (const obsolete of [{ accepts: ["asset"] }, { orderBy: ["order"] }]) {
        const invalid = structuredClone(config);
        invalid.generatedPages[0].slots[0] = { ...invalid.generatedPages[0].slots[0], ...obsolete };
        await writeFile(configPath, JSON.stringify(invalid));
        assert.throws(() => readConfig(), /Invalid generated canvas configuration/);
    }
    await writeFile(configPath, configText);
    const html = renderHtml(config, "secret");
    assert.match(html, /data-stock-image="header.brand"/);
    const page = { innerHTML: "" };
    renderStockPage(page, { canvas: config.canvas, mainPageAsset: config.mainPageAsset,
        readOnlyFields: config.readOnlyFields ?? [], textPlacements: config.textPlacements ?? [],
        generatedControls: config.generatedControls ?? [], hasConstitution: false,
        hasBadges: false, hasValues: false,
        badgeDestinations: config.workflowPage.badgeDestinations, fieldSlots: [] });
    assert.match(html, /data-page-module="\/pages\/generated-workflow-page-adapter\.mjs"/);
    assert.match(page.innerHTML, /data-stock-image="workflow.intro"/);
    assert.match(html, /gallery.logo/);
    assert.doesNotMatch(html, /<img src="\/assets\/logo/);
    const packaged = join(sdk, "controls", "generated-control-adapter-image.mjs");
    assert.deepEqual((await readdir(join(sdk, "controls"))).sort(),
        ["generated-control-adapter-image.mjs", "shared-controls-image.json"]);
    assert.equal(await readFile(packaged, "utf8"),
        await readFile(new URL("shared-controls/stock-image/generated.mjs", source), "utf8"));
    const routes = createWorkflowRoutes(config, { token: "secret", runtime: null });
    const server = createServer(routes.handle);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
        routes.close();
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${url}/controls/generated-control-adapter-image.mjs`)).status, 401);
    assert.equal((await fetch(`${url}/controls/generated-control-adapter-image.mjs?token=secret`)).status, 200);
    assert.equal((await fetch(`${url}/assets/logo.png?token=secret`)).status, 200);
    assert.equal((await fetch(`${url}/assets/unlisted.png?token=secret`)).status, 503);
    const portable = join(workspace, "portable");
    await cp(sdk, portable, { recursive: true });
    assert.equal((await import(`${pathToFileURL(join(portable, "server.mjs")).href}?portable=1`))
        .readConfig().imageControl.hash, config.imageControl.hash);
    await writeFile(packaged, "export const controlId = 'tampered';");
    assert.throws(() => readConfig(), /adapter does not match its frozen hash/);
    assert.equal((await fetch(`${url}/controls/generated-control-adapter-image.mjs?token=secret`)).status, 500);
    await writeFile(packaged, await readFile(new URL("shared-controls/stock-image/generated.mjs", source)));
    await writeFile(join(sdk, "assets", "logo.png"), Buffer.alloc(32 * 1024 + 1));
    assert.throws(() => readConfig(), /regular file under 32 KiB/);
    await writeFile(join(sdk, "assets", "logo.png"), "tampered");
    assert.throws(() => readConfig(), /image does not match its frozen hash/);
    assert.equal((await fetch(`${url}/assets/logo.png?token=secret`)).status, 500);
});

test("generated canvas rejects packaged asset directories redirected outside its root", async (t) => {
    for (const kind of ["assets", "controls"]) {
        await t.test(kind, async (subtest) => {
            const { project, workspace, prepared, sdk } = await setup(subtest);
            await materialize(project, workspace, handoff.handoffId, prepared.requestId);
            const { readConfig } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
            const directory = join(sdk, kind);
            const outside = join(workspace, `external-${kind}`);
            await cp(directory, outside, { recursive: true });
            await rename(directory, join(sdk, `original-${kind}`));
            try {
                await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
            } catch (error) {
                if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
                    subtest.skip("Directory symlinks are unavailable on this host");
                    return;
                }
                throw error;
            }
            assert.throws(() => readConfig(), /Packaged asset directory escapes/);
        });
    }
});

test("generated host adapter route rejects linked and oversized packaged files after startup", async (t) => {
    const { project, workspace, prepared, sdk } = await setup(t);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, createWorkflowRoutes } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const routes = createWorkflowRoutes(readConfig(), { token: "secret", runtime: null });
    const server = createServer(routes.handle);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
        routes.close();
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
    });
    const url = `http://127.0.0.1:${server.address().port}/contracts/external-host-adapter.mjs?token=secret`;
    assert.equal((await fetch(url)).status, 200);
    const contracts = join(sdk, "contracts");
    const adapter = join(contracts, "external-host-adapter.mjs");
    const original = join(sdk, "original-external-host-adapter.mjs");
    await t.test("file symlink", async (subtest) => {
        const outside = join(workspace, "outside-external-host-adapter.mjs");
        await writeFile(outside, "private outside package");
        await rename(adapter, original);
        try {
            try {
                await symlink(outside, adapter, "file");
            } catch (error) {
                if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
                    subtest.skip("File symlinks are unavailable on this host");
                    return;
                }
                throw error;
            }
            const response = await fetch(url);
            assert.equal(response.status, 500);
            assert.doesNotMatch(await response.text(), /private outside package/);
        } finally {
            await rm(adapter, { force: true });
            await rename(original, adapter);
        }
    });
    await t.test("parent directory link", async (subtest) => {
        const originalDirectory = join(sdk, "original-contracts");
        const outside = join(workspace, "outside-contracts");
        await mkdir(outside);
        await writeFile(join(outside, "external-host-adapter.mjs"), "private outside package");
        await rename(contracts, originalDirectory);
        let linked = false;
        try {
            try {
                await symlink(outside, contracts, process.platform === "win32" ? "junction" : "dir");
                linked = true;
            } catch (error) {
                if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
                    subtest.skip("Directory symlinks are unavailable on this host");
                    return;
                }
                throw error;
            }
            const response = await fetch(url);
            assert.equal(response.status, 500);
            assert.doesNotMatch(await response.text(), /private outside package/);
        } finally {
            if (linked) {
                if (process.platform === "win32") await rmdir(contracts);
                else await unlink(contracts);
            }
            await rename(originalDirectory, contracts);
        }
    });
    await writeFile(adapter, Buffer.alloc(32 * 1024 + 1));
    assert.equal((await fetch(url)).status, 500);
});

test("missing Logo keeps diamond; frozen image and adapter tampering fail before packaging", async (t) => {
    const { project, workspace, prepared, sdk, requestPath, templates, model } = await setup(t, ["", logo, ""]);
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    await rewrite(requestPath, (candidate) => { candidate.generatedImageControl.assets[1].hash = "0".repeat(64); });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /stock.image control asset or hash/);
    await rewrite(requestPath, (candidate) => {
        candidate.generatedImageControl = structuredClone(request.generatedImageControl);
        candidate.generatedImageControl.assets[1].name = "wrong-adapter";
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Incompatible frozen stock.image/);
    await rewrite(requestPath, (candidate) => {
        candidate.generatedImageControl = structuredClone(request.generatedImageControl);
        const module = 'import "https://example.invalid/foreign.mjs"; export function mount() {}';
        candidate.generatedImageControl.assets[1].content = Buffer.from(module).toString("base64");
        candidate.generatedImageControl.assets[1].hash = digest(module);
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /adapter must be self-contained/);
    await rewrite(requestPath, (candidate) => {
        candidate.generatedImageControl = structuredClone(request.generatedImageControl);
        candidate.generatedImageControl.assets[0].content = Buffer.from(JSON.stringify({
            schemaVersion: 1, id: "stock.image",
            value: { type: "image", maxBytes: 64, mimeTypes: ["image/png"] },
            adapters: { designer: "designer-control-adapter-image",
                generated: "generated-control-adapter-image" },
        })).toString("base64");
        candidate.generatedImageControl.assets[0].hash =
            digest(Buffer.from(candidate.generatedImageControl.assets[0].content, "base64"));
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /Incompatible frozen stock.image/);
    await rewrite(requestPath, (candidate) => {
        candidate.generatedImageControl = structuredClone(request.generatedImageControl);
        candidate.generatedAssets[0].hash = "0".repeat(64);
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /image bytes or hash/);
    await rewrite(requestPath, (candidate) => {
        candidate.generatedAssets = structuredClone(request.generatedAssets);
        delete candidate.generatedImageControl;
    });
    await assert.rejects(materialize(project, workspace, handoff.handoffId, prepared.requestId),
        /require a frozen stock.image/);
    await assert.rejects(readFile(join(sdk, "extension.mjs")), { code: "ENOENT" });
    await writeFile(requestPath, JSON.stringify(request));
    await writeFile(templates[1].path, "export const controlId = 'changed';");
    await assert.rejects(freezeGeneration({
        model: { ...model, revision: "changed", templates },
        values: request.values, handoff, project, workspace }), /generated asset changed/);
    await materialize(project, workspace, handoff.handoffId, prepared.requestId);
    const { readConfig, renderHtml } = await import(pathToFileURL(join(sdk, "server.mjs")).href);
    const config = readConfig();
    assert.equal(config.brandAsset, undefined);
    assert.match(renderHtml(config), /brand-mark" aria-hidden="true">&#9671;/);
    await assert.rejects(readFile(join(sdk, "assets", "logo.png")), { code: "ENOENT" });
    assert.equal(config.imageControl.adapter, "generated-control-adapter-image");
});

test("the shared image adapter mounts only its authorized presentation; gallery slots remain host-owned", async () => {
    const { mount, controlId, valueContract } = await import(
        new URL("../extension-canvas-design/shared-controls/stock-image/generated.mjs", import.meta.url));
    const definition = JSON.parse(await readFile(new URL(
        "../extension-canvas-design/shared-controls/stock-image/control.json", import.meta.url)));
    assert.equal(controlId, definition.id);
    assert.equal(definition.adapters.generated, "generated-control-adapter-image");
    assert.deepEqual(valueContract, definition.value);
    assert.deepEqual(definition.value, { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] });
    const previousDocument = globalThis.document;
    const image = {};
    globalThis.document = { createElement: (tag) => {
        assert.equal(tag, "img"); return image;
    } };
    try {
        const target = { replaceChildren(...children) { this.children = children; } };
        const field = { id: "gallery.logo", label: "Gallery Logo" };
        const value = "/assets/asset-local.png?token=secret";
        const context = { alt: "Gallery Logo", className: "generated-image" };
        mount({ root: target, field, value, context });
        assert.deepEqual(target.children, [image]);
        assert.equal(image.src, value);
        assert.equal(image.alt, context.alt);
        assert.equal(image.className, context.className);
        assert.throws(() => mount({ root: target, field, value: null, context }),
            /Invalid packaged image presentation/);
        assert.throws(() => mount({ root: target, field, value, context: null }),
            /Invalid packaged image presentation/);
        const slot = { dataset: { assetSlot: "gallery.logo" } };
        const content = { querySelectorAll: () => [slot] };
        const assets = [{ id: "gallery.logo", label: "Gallery Logo",
            slot: "gallery.logo", file: "asset-local.png" }];
        const mounted = [];
        await mountPageAssets(content, [{ id: "gallery.logo" }],
            assets, async (root, asset) => mounted.push([root, asset]));
        assert.deepEqual(mounted, [[slot, assets[0]]]);
        await assert.rejects(mountPageAssets(content, [], assets, async () => {}),
            /Unknown or duplicate generated asset slot/);
        await assert.rejects(mountPageAssets(content, [{ id: "gallery.logo" }],
            assets, async () => { throw new Error("adapter failed"); }), /adapter failed/);
    } finally {
        globalThis.document = previousDocument;
    }
});

test("generated host exposes adapter failure rather than hiding or replacing a configured Logo", async () => {
    const registration = { dataset: { module: "/controls/generated-control-adapter-image.mjs",
        assets: '["logo.png"]' } };
    const field = { id: "canvas.logo", label: "Logo" };
    const asset = { file: "logo.png" };
    const root = { setAttribute(name, value) { this[name] = value; }, textContent: "" };
    const contract = { type: "image", maxBytes: 32768,
        mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };
    const calls = [];
    const render = createStockImageRenderer(registration, "secret", async (url) => {
        calls.push(url);
        return { controlId: "stock.image", valueContract: contract,
            mount: async ({ value, context }) => { root.value = value; root.context = context; } };
    });
    await render(root, field, asset, "", "generated-image");
    assert.equal(root.value, "/assets/logo.png?token=secret");
    assert.deepEqual(root.context, { alt: "", className: "generated-image" });
    assert.equal(calls.length, 1);
    await render(root, field, asset, "", "generated-image");
    assert.equal(calls.length, 1);
    const failed = createStockImageRenderer(registration, "secret",
        async () => ({ controlId: "stock.text", valueContract: contract, mount() {} }));
    await failed(root, field, asset, "", "generated-image");
    assert.equal(root.role, "alert");
    assert.match(root.textContent, /Generated image could not render: Incompatible stock.image adapter/);
    const denied = createStockImageRenderer(registration, "secret", async () => {
        throw new Error("Should not load for unauthorized asset");
    });
    await denied(root, field, { file: "../secret.png" }, "", "generated-image");
    assert.match(root.textContent, /Unauthorized packaged image/);
    const throwing = createStockImageRenderer(registration, "secret",
        async () => ({ controlId: "stock.image", valueContract: contract,
            mount() { throw new Error("Adapter crashed"); } }));
    await throwing(root, field, asset, "", "generated-image");
    assert.match(root.textContent, /Generated image could not render: Adapter crashed/);
});
