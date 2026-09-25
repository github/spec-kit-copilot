import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
    changedGenerationDocuments, closeGenerationDialog, defaultGenerationMetadata,
    openGenerationDialog, setGenerationDeps, validateGenerationDocument,
} from "../ui/generation.js";
import { state } from "../ui/state.js";

const canonical = {
    pipeline: [
        "constitution", "specify", "clarify", "plan",
        "tasks", "analyze", "checklist", "implement",
    ].map((id) => ({ id })),
    commands: [],
};

test("canonical SDD defaults match the compact Generate form", () => {
    const metadata = defaultGenerationMetadata(canonical);
    assert.equal(metadata.extensionId, "spec-kit-workflow");
    assert.equal(metadata.displayName, "Spec-Driven Development");
    assert.equal(metadata.workflowListName, "Features");
    assert.match(metadata.description, /Constitution.*Specify.*Implement/);
});

test("Generate has Details and Canvas Design steps without advanced setup toggles", async () => {
    const source = await readFile(new URL("../ui/generation.js", import.meta.url), "utf8");
    const ordered = [
        'id="generation-step-details"',
        'id="generation-step-design"',
        'id="generation-details"',
        'id="generation-target"',
        'id="generation-extension-id"',
        'id="generation-display-name"',
        'id="generation-workflow-list-name"',
        'id="generation-description"',
        'id="generation-design-step"',
        'id="generation-design-items"',
        'id="generation-document-choices"',
        'id="generation-document-json"',
    ];
    let previous = -1;
    for (const marker of ordered) {
        const index = source.indexOf(marker);
        assert.ok(index > previous, `${marker} must appear in approved order`);
        previous = index;
    }
    for (const help of [
        "Folder where the canvas app is created. Set by Extension ID.",
        "Technical ID and folder name, not a display label. Use lowercase letters, numbers, and hyphens.",
        "Text displayed as the canvas title.",
        "Text displayed as the workflow collection heading, such as Assessments or Bugs.",
        "Text displayed beneath the workflow collection heading, before the folder link.",
        "Cancel does not undo them.",
        "Start from the generator baseline, not a customer preset.",
    ]) {
        assert.match(source, new RegExp(help.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(source, /Phase result tags|general help|theme control|layout control/i);
    assert.match(source, /workflowListName: metadata\.workflowListName/);
    assert.doesNotMatch(source, /generation-user-provided-slug|generation-require-installation-approval|Review step/);
    assert.match(source, /\/api\/generation\/configuration/);
    assert.match(source, /\/api\/generation\/validate/);
    assert.match(source, /inlineDocuments,/);
    assert.match(source, /changedGenerationDocuments\(\s*root\._baselineDocuments, root\._documentDrafts, root\._validatedDocuments/s);
    assert.match(source, /root\._documentDrafts\[category\] = editor\.value/);
    const styles = await readFile(new URL("../ui/styles/overlays.css", import.meta.url), "utf8");
    assert.match(styles, /#generation-design-items\s*\{[^}]*overflow-y: auto/s);
});

test("only semantically changed strict JSON documents are submitted", () => {
    const keys = ["canvas-presentation", "phase-outputs", "canvas-results", "canvas-interactions", "canvas-setup"];
    const baseline = Object.fromEntries(keys.map((key) => [key, { title: key, enabled: true }]));
    const drafts = Object.fromEntries(keys.map((key) => [key, JSON.stringify({ enabled: true, title: key }, null, 4)]));
    assert.deepEqual(changedGenerationDocuments(baseline, drafts), {});
    drafts["canvas-results"] = '{"title":"results","enabled":false}';
    assert.deepEqual(changedGenerationDocuments(baseline, drafts), {
        "canvas-results": '{"title":"results","enabled":false}',
    });
    drafts["canvas-results"] = '{\n  "title": "results",\n  "enabled": false\n}';
    assert.equal(changedGenerationDocuments(baseline, drafts)["canvas-results"], drafts["canvas-results"]);
    assert.deepEqual(changedGenerationDocuments(baseline, drafts), {
        "canvas-results": drafts["canvas-results"],
    });
    drafts["canvas-setup"] = '{"title": }';
    assert.throws(() => changedGenerationDocuments(baseline, drafts), SyntaxError);
    drafts["canvas-setup"] = "[]";
    assert.throws(() => changedGenerationDocuments(baseline, drafts), /must be a JSON object/);
    drafts["canvas-setup"] = '{"nested":{"key":1,"key":2}}';
    assert.throws(() => changedGenerationDocuments(baseline, drafts), /Duplicate JSON key: key/);
});

test("generator schema validates raw editor text and supplies the semantic comparison document", async () => {
    const raw = '{\n  "enabled": false\n}';
    const document = await validateGenerationDocument("canvas-results", raw, async (url, options) => {
        assert.match(url, /\/api\/generation\/validate\?token=/);
        assert.equal(options.method, "POST");
        assert.deepEqual(JSON.parse(options.body), { name: "canvas-results", json: raw });
        return { ok: true, json: async () => ({ valid: true, document: { enabled: false } }) };
    });
    const keys = ["canvas-presentation", "phase-outputs", "canvas-results", "canvas-interactions", "canvas-setup"];
    const baseline = Object.fromEntries(keys.map((key) => [key, { enabled: true }]));
    const drafts = Object.fromEntries(keys.map((key) => [key, '{"enabled":true}']));
    drafts["canvas-results"] = raw;
    assert.equal(changedGenerationDocuments(baseline, drafts, {
        "canvas-results": { raw, status: "valid", document },
    })["canvas-results"], raw);
    assert.deepEqual(changedGenerationDocuments(baseline, drafts, {
        "canvas-results": { raw, status: "valid", document: baseline["canvas-results"] },
    }), {});
    await assert.rejects(validateGenerationDocument("canvas-setup", "{}", async () => ({
        ok: false, status: 422, json: async () => ({ error: "canvas-setup: unexpected field $/unknown" }),
    })), /canvas-setup: unexpected field \$\/unknown/);
});

test("Details navigation and overwrite confirmation retain the raw one-off draft under a winning preset", async () => {
    class Node {
        constructor(id = "") {
            this.id = id;
            this.value = "";
            this.dataset = {};
            this.children = [];
            this.listeners = new Map();
            this.isConnected = true;
            this.classList = { add() {}, remove() {} };
        }
        addEventListener(type, listener) {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }
        async emit(type) {
            await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({
                currentTarget: this, target: this, preventDefault() {},
            })));
        }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children = nodes; }
        setAttribute(name, value) { this[name] = value; }
        removeAttribute(name) { delete this[name]; }
    }
    const root = new Node("wizard-modal-root");
    const nodes = new Map();
    const initial = {
        "generation-extension-id": "spec-kit-workflow",
        "generation-display-name": "Spec Kit Workflow",
        "generation-workflow-list-name": "Workflows",
        "generation-description": "Visual workflow.",
    };
    root.querySelector = (selector) => {
        if (!nodes.has(selector)) {
            const node = new Node(selector);
            node.value = initial[selector.slice(1)] ?? "";
            nodes.set(selector, node);
        }
        return nodes.get(selector);
    };
    root.querySelectorAll = (selector) => selector === "[data-document]"
        ? root.querySelector("#generation-document-choices").children
        : selector.startsWith("#generation-details")
            ? Object.keys(initial).map((id) => root.querySelector(`#${id}`)) : [];
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;
    const originalSnapshot = state.snapshot;
    const keys = ["canvas-presentation", "phase-outputs", "canvas-results", "canvas-interactions", "canvas-setup"];
    const baseline = Object.fromEntries(keys.map((key) => [key, { note: key }]));
    const winner = { kind: "preset", id: "customer-design" };
    const requests = [];
    let resolveOutcome;
    const outcomeSeen = new Promise((resolve) => { resolveOutcome = resolve; });
    globalThis.document = {
        getElementById: () => root,
        createElement: () => new Node(),
    };
    globalThis.fetch = async (url, options = {}) => {
        if (url.startsWith("/api/generation/configuration")) return {
            ok: true, json: async () => ({ documents: baseline, winners: { "canvas-presentation": winner } }),
        };
        if (url.startsWith("/api/generation/target")) return {
            ok: true, json: async () => ({ exists: true, target: "C:\\work\\.github\\extensions\\spec-kit-workflow" }),
        };
        if (url.startsWith("/api/generation/validate")) return {
            ok: true, json: async () => ({ valid: true, document: JSON.parse(JSON.parse(options.body).json) }),
        };
        resolveOutcome();
        return { ok: true, json: async () => ({ status: "succeeded" }) };
    };
    state.snapshot = { pipeline: [{ id: "plan" }], commands: [], generatorStatus: { ready: true } };
    setGenerationDeps({ postJson: async (_path, body) => {
        requests.push(body);
        return { queued: true, target: "C:\\work\\.github\\extensions\\spec-kit-workflow" };
    }, render: () => {} });
    try {
        openGenerationDialog();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(root._configurationStatus, "ready");
        await root.querySelector("#generation-next").emit("click");
        const editor = root.querySelector("#generation-document-json");
        const raw = '{\n  "note": "customer one-off"\n}';
        editor.value = raw;
        await editor.emit("input");
        await root.querySelector("#generation-back").emit("click");
        await root.querySelector("#generation-next").emit("click");
        assert.equal(editor.value, raw, "returning from Details must not discard the design draft");
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.match(root.querySelector("#generation-document-summary").innerHTML, /recorded in the request and receipt/);
        await root.querySelector("#generation-submit").emit("click");
        assert.equal(root.querySelector("#generation-submit").dataset.overwrite, "true");
        assert.equal(root._documentDrafts["canvas-presentation"], raw, "overwrite confirmation must retain the draft");
        await root.querySelector("#generation-submit").emit("click");
        assert.equal(requests.length, 1);
        assert.deepEqual(Object.keys(requests[0].inlineDocuments), ["canvas-presentation"]);
        assert.equal(requests[0].inlineDocuments["canvas-presentation"], raw,
            "winning customer preset must not erase the superseded request document");
        await outcomeSeen;
    } finally {
        closeGenerationDialog();
        globalThis.document = originalDocument;
        globalThis.fetch = originalFetch;
        state.snapshot = originalSnapshot;
        setGenerationDeps({ postJson: async () => undefined, render: () => {} });
    }
});
