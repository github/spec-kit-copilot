import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createHandler } from "../server.mjs";
import { buildDesignerHandoff, buildDesignerLaunchPrompt,
    checkDesignerProvider, DESIGNER_EXTENSION_ID, enableDesignerProvider,
    validateDesignerSelections } from "../server/handlers-designer.mjs";
import { fingerprint, readHandoff, validateHandoff } from "../../speckit-canvas-designer/handoff.mjs";
import { designerCatalogFingerprint } from "../catalog/designer-fingerprint.mjs";

const catalog = {
    designerFingerprint: "catalog-v1",
    presets: [{ id: "theme", source: "copilot", tags: ["canvas-design"],
        version: "1.0.0", downloadUrl: "https://example.org/theme.zip" }],
    extensions: [], bundles: [],
};
const snapshot = { pipeline: [{ id: "commands/plan" }], catalog };
const empty = { presets: [], extensions: [], bundles: [] };

function fixture(overrides = {}) {
    const sent = [];
    const errors = [];
    const inst = { workspacePath: process.cwd() };
    const provider = { id: DESIGNER_EXTENSION_ID, source: "plugin", status: "running" };
    const registered = { extensionId: DESIGNER_EXTENSION_ID, canvasId: "speckit-canvas-designer" };
    let current = snapshot;
    const session = {
        send: async (message) => { sent.push(message); },
        rpc: {
            extensions: { list: async () => ({ extensions: [provider] }),
                enable: async () => { provider.status = "running"; } },
            canvas: { list: async () => ({ canvases: [registered] }) },
        },
    };
    const handler = createHandler({
        token: "secret",
        log: async (message, level) => { errors.push({ message, level }); },
        getInstance: () => inst,
        getState: async () => current,
        registerSse() {}, broadcast() {},
        ...overrides,
        session: { ...session, ...overrides.session },
    });
    async function post(body, token = "secret") {
        const req = Readable.from([Buffer.from(JSON.stringify(body))]);
        req.method = "POST";
        req.url = `/api/designer/launch?token=${token}`;
        req.headers = {};
        const res = {
            setHeader() {},
            writeHead(code) { this.statusCode = code; },
            end(data) { this.body = JSON.parse(data); },
        };
        await handler(req, res);
        await new Promise(setImmediate);
        return res;
    }
    return { post, sent, errors, inst, provider, registered,
        setSnapshot: (value) => { current = value; } };
}
const request = (selections = empty) => ({
    selections, catalogFingerprint: "catalog-v1", expectedPhases: ["plan"],
});

test("Designer fingerprint tracks tagged catalog entries, not unrelated active composition", () => {
    const original = designerCatalogFingerprint(catalog);
    assert.notEqual(original, designerCatalogFingerprint({ ...catalog,
        presets: [{ ...catalog.presets[0], version: "1.0.1" }] }));
    assert.notEqual(original, designerCatalogFingerprint({ ...catalog,
        presets: [{ ...catalog.presets[0], tags: [] }] }));
    assert.notEqual(original, designerCatalogFingerprint({ ...catalog,
        presets: [{ ...catalog.presets[0], downloadUrl: "https://example.org/changed.zip" }] }));
    assert.equal(original, designerCatalogFingerprint({ ...catalog,
        presets: [...catalog.presets, { id: "unrelated", source: "copilot", tags: [] }] }));
});

test("empty selections produce a complete immutable inline handoff and one queued launch", async () => {
    const { post, sent } = fixture();
    const response = await post(request());
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.body, { queued: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0].prompt, /no base_branch \(the project default\)/);
    assert.match(sent[0].prompt, /Do not edit it afterward or install selected customizations/);
    assert.match(sent[0].prompt, /plugin:spec-kit-copilot-wizard:speckit-canvas-designer/);
    assert.doesNotMatch(sent[0].prompt, /extensions_manage|list_canvas_capabilities|extensions_reload/);
    assert.match(sent[0].prompt, /open_canvas\(\{canvasId:"speckit-canvas-designer",extensionId:"plugin:spec-kit-copilot-wizard:speckit-canvas-designer"/);
    assert.doesNotMatch(sent[0].prompt, /bootstrap\.mjs|\.github\/extensions\//);
    assert.match(sent[0].prompt, /handoff\.json under YOUR session-state artifacts/);
    const json = sent[0].prompt.match(/\nHANDOFF_JSON:\n([^\n]+)\nEND_HANDOFF_JSON\n/)[1];
    const handoff = JSON.parse(json);
    assert.deepEqual(handoff.selections, empty);
    assert.deepEqual(handoff.workflow.selectedPhases, ["plan"]);
    assert.equal(handoff.sourceFingerprint, fingerprint({
        workflow: handoff.workflow, selections: handoff.selections,
    }));
    assert.deepEqual(validateHandoff(handoff, handoff.handoffId), handoff);
    assert.equal(buildDesignerLaunchPrompt(handoff).includes(json), true);
    const otherProject = fixture();
    otherProject.inst.workspacePath = tmpdir();
    assert.equal((await otherProject.post(request())).statusCode, 202);
});

test("selected catalog entries are validated and normalized from the server's catalog", async () => {
    const selection = { presets: [{ id: "theme", source: "copilot", approved: true }],
        extensions: [], bundles: [] };
    const normalized = validateDesignerSelections(selection, catalog);
    assert.deepEqual(normalized.presets[0], { id: "theme", source: "copilot",
        approved: true, version: "1.0.0", downloadUrl: "https://example.org/theme.zip" });
    const { post, sent } = fixture();
    assert.equal((await post(request(selection))).statusCode, 202);
    assert.deepEqual(JSON.parse(sent[0].prompt.match(/\nHANDOFF_JSON:\n([^\n]+)\n/)[1])
        .selections.presets, normalized.presets);
    for (const invalid of [
        { ...selection, presets: [...selection.presets, selection.presets[0]] },
        { ...selection, presets: [{ ...selection.presets[0], downloadUrl: "https://evil.invalid" }] },
        { ...selection, presets: [{ id: "unknown", source: "copilot", approved: true }] },
        { ...selection, presets: [{ ...selection.presets[0], approved: false }] },
    ]) {
        assert.equal((await post(request(invalid))).statusCode, 422);
    }
});

test("stale, unauthenticated and unavailable requests never acknowledge launch", async () => {
    const { post, sent, inst, setSnapshot } = fixture();
    assert.equal((await post(request(), "wrong")).statusCode, 401);
    assert.equal((await post({ ...request(), catalogFingerprint: "old" })).statusCode, 409);
    assert.equal((await post({ ...request(), expectedPhases: [] })).statusCode, 409);
    assert.equal(sent.length, 0);
    setSnapshot({ ...snapshot, catalog: { ...catalog, designerFingerprint: "new" } });
    assert.equal((await post(request())).statusCode, 409);
    assert.equal(sent.length, 0);
    const unavailable = fixture({ session: { send: null } });
    assert.equal((await unavailable.post(request())).statusCode, 503);
});

test("only the running official plugin provider with a registered canvas can launch", async () => {
    const { post, sent, provider, registered } = fixture();
    provider.status = "failed";
    assert.match((await post(request())).body.error, /failed.*extension log/i);
    provider.status = "running";
    registered.extensionId = "session:speckit-canvas-designer";
    assert.match((await post(request())).body.error, /not registered/i);
    registered.extensionId = DESIGNER_EXTENSION_ID;
    provider.id = "project:speckit-canvas-designer";
    assert.match((await post(request())).body.error, /missing.*install or update/i);
    assert.equal(sent.length, 0);
    provider.id = DESIGNER_EXTENSION_ID;
    assert.equal((await post(request())).statusCode, 202);
    assert.equal(sent.length, 1);
});

test("disabled provider is enabled on launch in the current session", async () => {
    const { post, sent, provider } = fixture();
    provider.status = "disabled";
    const response = await post(request());
    assert.equal(response.statusCode, 202);
    assert.equal(provider.status, "running");
    assert.equal(sent.length, 1);
});

test("activation errors and timeouts never dispatch", async () => {
    const provider = { id: DESIGNER_EXTENSION_ID, source: "plugin", status: "disabled" };
    const rpc = {
        extensions: {
            list: async () => ({ extensions: [provider] }),
            enable: async () => { throw new Error("permission denied"); },
        },
        canvas: { list: async () => ({ canvases: [] }) },
    };
    const { post, sent } = fixture({ session: { rpc, send: async (message) => { sent.push(message); } } });
    const error = await post(request());
    assert.equal(error.statusCode, 503);
    assert.match(error.body.error, /permission denied/);
    assert.equal(sent.length, 0);
    rpc.extensions.enable = async ({ id }) => {
        assert.equal(id, DESIGNER_EXTENSION_ID);
        provider.status = "starting";
    };
    await assert.rejects(enableDesignerProvider(rpc, { timeoutMs: 0 }), /activation timed out/);
    provider.status = "disabled";
    const timedOut = fixture({
        session: { rpc },
        enableDesignerProvider: (sessionRpc) => enableDesignerProvider(sessionRpc, { timeoutMs: 0 }),
    });
    const timeout = await timedOut.post(request());
    assert.equal(timeout.statusCode, 503);
    assert.match(timeout.body.error, /activation timed out/);
    assert.equal(timedOut.sent.length, 0);
    rpc.extensions.enable = () => new Promise(() => {});
    await assert.rejects(enableDesignerProvider(rpc, { timeoutMs: 10 }), /activation timed out/);
    rpc.extensions.enable = async () => { provider.status = "running"; };
    rpc.canvas.list = async () => ({ canvases: [{
        extensionId: "session:speckit-canvas-designer", canvasId: "speckit-canvas-designer",
    }] });
    await assert.rejects(enableDesignerProvider(rpc, { timeoutMs: 10, intervalMs: 1 }),
        /activation timed out/);
    provider.status = "failed";
    await assert.rejects(checkDesignerProvider(rpc), /failed/);
});

test("launches cannot overlap while readiness is being checked", async () => {
    let release;
    let entered;
    const ready = new Promise((resolve) => { release = resolve; });
    const checking = new Promise((resolve) => { entered = resolve; });
    const delayed = fixture({
        session: {
            rpc: {
                extensions: {
                    list: async () => {
                        entered();
                        await ready;
                        return { extensions: [{
                            id: DESIGNER_EXTENSION_ID, source: "plugin", status: "running",
                        }] };
                    },
                },
                canvas: { list: async () => ({ canvases: [{
                    extensionId: DESIGNER_EXTENSION_ID, canvasId: "speckit-canvas-designer",
                }] }) },
            },
        },
    });
    const first = delayed.post(request());
    await checking;
    const duplicate = await delayed.post(request());
    assert.equal(duplicate.statusCode, 409);
    release();
    assert.equal((await first).statusCode, 202);
    assert.equal(delayed.sent.length, 1);
    assert.equal((await delayed.post(request())).statusCode, 202);
});

test("consecutive launch requests acknowledge before agent turns finish and have separate handoffs", async () => {
    const sent = [];
    let finish;
    const completion = new Promise((resolve) => { finish = resolve; });
    const { post } = fixture({ session: { send: async (message) => {
        sent.push(message);
        await completion;
    } } });
    const first = await post(request());
    const second = await post(request());
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.equal(sent.length, 2);
    const handoffIds = sent.map(({ prompt }) =>
        JSON.parse(prompt.match(/\nHANDOFF_JSON:\n([^\n]+)\n/)[1]).handoffId);
    assert.equal(new Set(handoffIds).size, 2);
    finish();
});

test("deferred send failures are logged without changing an accepted response", async () => {
    const failing = fixture({ session: { send: async () => { throw new Error("no session"); } } });
    const response = await failing.post(request());
    assert.equal(response.statusCode, 202);
    assert.deepEqual(failing.errors, [{ message: "Designer dispatch failed: no session", level: "error" }]);
});

test("oversized Designer handoff returns 413 without dispatching", async () => {
    const largeCatalog = { ...catalog, presets: Array.from({ length: 40 }, (_, index) => ({
        id: `preset-${index}`, source: "copilot", tags: ["canvas-design"],
        downloadUrl: `https://example.org/${"x".repeat(1950)}${index}`,
    })) };
    const sent = [];
    const { post } = fixture({
        getState: async () => ({ ...snapshot, catalog: largeCatalog }),
        session: { send: async (message) => { sent.push(message); } },
    });
    const selections = { ...empty, presets: largeCatalog.presets.map((item) => ({
        id: item.id, source: item.source, approved: true,
    })) };
    const response = await post(request(selections));
    assert.equal(response.statusCode, 413);
    assert.match(response.body.error, /exceeds 64KB/);
    assert.equal(sent.length, 0);
});

test("invalid fingerprints, oversized handoffs and unsafe IDs are rejected", async () => {
    const handoff = buildDesignerHandoff(snapshot, empty, randomUUID());
    assert.throws(() => validateHandoff({ ...handoff, sourceFingerprint: "0".repeat(64) },
        handoff.handoffId), /fingerprint mismatch/);
    assert.throws(() => validateHandoff({ ...handoff, extra: "x".repeat(65 * 1024) },
        handoff.handoffId), /Invalid Designer handoff/);
    const malformed = { ...handoff, selections: { ...empty,
        presets: [{ id: null, source: "copilot", approved: true,
            version: null, downloadUrl: null }] } };
    malformed.sourceFingerprint = fingerprint({
        workflow: malformed.workflow, selections: malformed.selections,
    });
    assert.throws(() => validateHandoff(malformed, handoff.handoffId), /Invalid Designer handoff/);
    await assert.rejects(readHandoff(tmpdir(), "../escape"), /Invalid Designer handoff ID/);
});
