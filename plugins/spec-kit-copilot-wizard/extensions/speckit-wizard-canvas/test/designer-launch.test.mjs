import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createHandler } from "../server.mjs";
import { buildDesignerHandoff, buildDesignerLaunchPrompt,
    validateDesignerSelections } from "../server/handlers-designer.mjs";
import { fingerprint, HANDOFF_LIMIT, readHandoff, validateHandoff } from "../../speckit-canvas-designer/handoff.mjs";
import { designerCatalogFingerprint } from "../catalog/designer-fingerprint.mjs";
import { readDesignSource } from "../../speckit-canvas-designer/source.mjs";

const requiredExtension = await readDesignSource();
const required = { id: "canvas-design", source: "copilot", approved: true,
    version: requiredExtension.version, downloadUrl: null };
const catalog = {
    designerFingerprint: "catalog-v1",
    designerSource: { available: true, extension: requiredExtension },
    presets: [{ id: "theme", source: "copilot", tags: ["canvas-design"],
        version: "1.0.0", downloadUrl: "https://example.org/theme.zip" }],
    extensions: [], bundles: [],
};
const snapshot = { pipeline: [{ id: "commands/plan" }], catalog };
const empty = { presets: [], extensions: [required], bundles: [] };

function fixture(overrides = {}) {
    const sent = [];
    const errors = [];
    const inst = { workspacePath: process.cwd() };
    let current = snapshot;
    const handler = createHandler({
        token: "secret",
        session: { send: async (message) => { sent.push(message); } },
        log: async (message, level) => { errors.push({ message, level }); },
        getInstance: () => inst,
        getState: async () => current,
        registerSse() {}, broadcast() {},
        ...overrides,
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
    return { post, sent, errors, inst, setSnapshot: (value) => { current = value; } };
}
const request = (selections = empty) => ({
    selections: Object.fromEntries(Object.entries(selections).map(([kind, items]) =>
        [kind, items.map(({ id, source, approved }) => ({ id, source, approved }))])),
    catalogFingerprint: "catalog-v1", expectedPhases: ["plan"],
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
    assert.notEqual(original, designerCatalogFingerprint({ ...catalog,
        designerSource: { available: false, error: "Source missing" } }));
});

test("required-only selections produce a complete immutable inline handoff and one queued launch", async () => {
    const { post, sent } = fixture();
    const response = await post(request());
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.body, { queued: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0].prompt, /no base_branch \(the project default\)/);
    assert.match(sent[0].prompt, /provider ships with the installed spec-kit-copilot-wizard plugin/);
    assert.match(sent[0].prompt, /list_canvas_capabilities\(\{canvasId:"speckit-canvas-designer"\}\)/);
    assert.doesNotMatch(sent[0].prompt, /\.github\/extensions\//);
    assert.match(sent[0].prompt, /YOU perform setup through the Spec Kit skills/);
    assert.match(sent[0].prompt, /handoff\.json under YOUR session-state artifacts/);
    const json = sent[0].prompt.match(/\nHANDOFF_JSON:\n([^\n]+)\nEND_HANDOFF_JSON\n/)[1];
    const handoff = JSON.parse(json);
    assert.deepEqual(handoff.selections, empty);
    assert.deepEqual(handoff.workflow.selectedPhases, ["plan"]);
    assert.equal(handoff.sourceFingerprint, fingerprint({
        workflow: handoff.workflow, selections: handoff.selections, requiredExtension,
    }));
    assert.deepEqual(validateHandoff(handoff, handoff.handoffId), handoff);
    assert.equal(buildDesignerLaunchPrompt(handoff).includes(json), true);
    const otherProject = fixture();
    otherProject.inst.workspacePath = tmpdir();
    assert.equal((await otherProject.post(request())).statusCode, 202);
});

test("child kickoff delegates setup and failure reporting to skills without a verification script", () => {
    const handoff = buildDesignerHandoff(snapshot, empty);
    const prompt = buildDesignerLaunchPrompt(handoff);
    const checkpoints = [
        "invoke the skill tool with each named skill",
        "use speckit-init",
        "After init, call speckit_designer_reload_skills",
        "Use speckit-extension",
        "Then use speckit-bundle",
        "speckit-extension for remaining",
        "speckit-preset for remaining",
        "After all installations, call speckit_designer_reload_skills",
        "Call extensions_reload",
        'call open_canvas({canvasId:"speckit-canvas-designer"',
    ];
    let previous = -1;
    for (const text of checkpoints) {
        const position = prompt.indexOf(text);
        assert.ok(position > previous, `${text} must occur after the previous setup step`);
        previous = position;
    }
    assert.match(prompt, /--integration copilot --integration-options="--skills" and --script ps/);
    assert.match(prompt, /Otherwise skip init; never overwrite an incompatible existing setup/);
    assert.match(prompt, /Use the skills to inspect CLI results and re-list installed packages/);
    assert.match(prompt, /components just installed by a selected bundle/);
    assert.match(prompt, /Do not treat ID\/version alone as proof/);
    assert.match(prompt, /do NOT emit \/skills reload as plain text/);
    assert.match(prompt, /On ANY setup or reload failure stop/);
    assert.match(prompt, /You own setup success\/failure reporting/);
    assert.match(prompt, /do not create a setup receipt or run a separate package-verification script/);
    assert.doesNotMatch(prompt, /bootstrap\.mjs|install\.mjs|validate-setup|preflight|setup\.json/);
    assert.ok(Buffer.byteLength(prompt) - Buffer.byteLength(JSON.stringify(handoff)) <= 4096,
        "kickoff instructions must fit the allowance above the handoff limit");
    assert.ok(Buffer.byteLength(prompt) <= HANDOFF_LIMIT + 4096);
});

test("selected catalog entries are validated and normalized from the server's catalog", async () => {
    const selection = { presets: [{ id: "theme", source: "copilot", approved: true }],
        extensions: [{ id: "canvas-design", source: "copilot", approved: true }], bundles: [] };
    const normalized = validateDesignerSelections(selection, catalog);
    assert.deepEqual(normalized.presets[0], { id: "theme", source: "copilot",
        approved: true, version: "1.0.0", downloadUrl: "https://example.org/theme.zip" });
    const { post, sent } = fixture();
    assert.equal((await post(request(selection))).statusCode, 202);
    assert.deepEqual(JSON.parse(sent[0].prompt.match(/\nHANDOFF_JSON:\n([^\n]+)\n/)[1])
        .selections.presets, normalized.presets);
    for (const invalid of [
        { ...selection, presets: [...selection.presets, selection.presets[0]] },
        { ...selection, presets: [{ id: "unknown", source: "copilot", approved: true }] },
        { ...selection, presets: [{ ...selection.presets[0], approved: false }] },
    ]) {
        assert.equal((await post(request(invalid))).statusCode, 422);
    }
    assert.equal((await post({ ...request(selection), selections: {
        ...selection, presets: [{ ...selection.presets[0], downloadUrl: "https://evil.invalid" }],
    } })).statusCode, 422);
    assert.equal((await post({ ...request(), selections: { presets: [], extensions: [], bundles: [] } }))
        .statusCode, 422);
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
    setSnapshot({ ...snapshot, catalog: { ...catalog,
        designerSource: { available: false, error: "Required source missing" } } });
    assert.equal((await post(request())).statusCode, 422);
    setSnapshot({ ...snapshot, catalog: { ...catalog,
        designerSource: { available: true, extension: { ...requiredExtension, fingerprint: "0".repeat(64) } } } });
    assert.equal((await post(request())).statusCode, 409);
    assert.equal(sent.length, 0);
    const unavailable = fixture({ session: {} });
    assert.equal((await unavailable.post(request())).statusCode, 503);
});

test("parallel launch requests acknowledge before agent turns finish and have separate handoffs", async () => {
    const sent = [];
    let finish;
    const completion = new Promise((resolve) => { finish = resolve; });
    const { post } = fixture({ session: { send: async (message) => {
        sent.push(message);
        await completion;
    } } });
    const [first, second] = await Promise.all([post(request()), post(request())]);
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
        workflow: malformed.workflow, selections: malformed.selections, requiredExtension,
    });
    assert.throws(() => validateHandoff(malformed, handoff.handoffId), /Invalid Designer handoff/);
    await assert.rejects(readHandoff(tmpdir(), "../escape"), /Invalid Designer handoff ID/);
});
