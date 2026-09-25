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

test("Generate has Details, Catalogs, and Advanced JSON steps without advanced setup toggles", async () => {
    const source = await readFile(new URL("../ui/generation.js", import.meta.url), "utf8");
    const ordered = [
        'id="generation-step-details"',
        'id="generation-step-catalogs"',
        'id="generation-step-advanced"',
        'id="generation-details"',
        'id="generation-target"',
        'id="generation-extension-id"',
        'id="generation-display-name"',
        'id="generation-workflow-list-name"',
        'id="generation-description"',
        'id="generation-catalogs"',
        'id="generation-design-source"',
        'id="generation-design-added-only"',
        'id="generation-design-items"',
        'id="generation-advanced"',
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
        "Cancel does not undo package changes.",
        "their settings are baked into the result.",
        "it replaces that entire document.",
        "Edits here are recorded but will not affect the generated canvas.",
    ]) {
        assert.match(source, new RegExp(help.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(source, /Phase result tags|general help|theme control|layout control/i);
    assert.match(source, /workflowListName: metadata\.workflowListName/);
    assert.doesNotMatch(source, /generation-user-provided-slug|generation-require-installation-approval|Review step/);
    assert.match(source, /\/api\/generation\/configuration/);
    assert.match(source, /\/api\/generation\/validate/);
    assert.match(source, /"preset", "Presets"[\s\S]*"extension", "Extensions"[\s\S]*"bundle", "Bundles"/);
    assert.match(source, /role="dialog" aria-modal="true"/);
    assert.match(source, /document\.addEventListener\?\.\("keydown", onKey\)/);
    assert.match(source, /document\.body\.style\.overflow = "hidden"/);
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
        focus() { globalThis.document.activeElement = this; }
        closest() { return null; }
        matches() { return false; }
        getClientRects() { return [1]; }
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
            node.dataset.designKind = selector.match(/^\[data-design-kind="([^"]+)"\]$/)?.[1];
            nodes.set(selector, node);
        }
        return nodes.get(selector);
    };
    root.querySelectorAll = (selector) => selector === "[data-document]"
        ? root.querySelector("#generation-document-choices").children
        : selector === "[data-design-kind]"
            ? ["preset", "extension", "bundle"].map((kind) => root.querySelector(`[data-design-kind="${kind}"]`))
            : selector.startsWith("#generation-details")
                ? Object.keys(initial).map((id) => root.querySelector(`#${id}`)) : [];
    const modal = root.querySelector(".generation-modal");
    modal.querySelectorAll = () => [
        root.querySelector("#generation-extension-id"), root.querySelector("#generation-next"),
    ];
    modal.contains = (node) => modal.querySelectorAll().includes(node);
    const trigger = new Node("launch");
    const background = new Node("wizard-background");
    background.inert = false;
    const documentListeners = new Map();
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
        getElementById: (id) => id === "wizard-modal-root" ? root : null,
        createElement: () => new Node(),
        body: { children: [background, root], style: { overflow: "auto" } },
        documentElement: { style: { overflow: "auto" } },
        activeElement: trigger,
        addEventListener: (event, listener) => documentListeners.set(event, listener),
        removeEventListener: (event, listener) => {
            if (documentListeners.get(event) === listener) documentListeners.delete(event);
        },
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
    state.snapshot = {
        pipeline: [{ id: "plan" }], commands: [], generatorStatus: { ready: true },
        catalog: {
            sources: [{ name: "Local" }, { name: "Community" }],
            extensionSources: [{ name: "Community" }],
            bundleSources: [{ name: "Local" }],
            presets: [
                { id: "local-style", name: "Local Style", source: "Local", design: true, active: true },
                { id: "community-style", name: "Community Style", source: "Community", design: true, active: false },
            ],
            extensions: [{ id: "theme-extension", name: "Theme Extension", source: "Community", design: true, active: false }],
            bundles: [{ id: "design-bundle", name: "Design Bundle", source: "Local", design: true, active: false }],
        },
    };
    setGenerationDeps({ postJson: async (_path, body) => {
        requests.push(body);
        return { queued: true, target: "C:\\work\\.github\\extensions\\spec-kit-workflow" };
    }, render: () => {} });
    try {
        openGenerationDialog();
        assert.equal(background.inert, true, "Wizard background must be inert");
        assert.equal(document.body.style.overflow, "hidden", "background scrolling must be locked");
        const keydown = documentListeners.get("keydown");
        let arrowScroll;
        root.querySelector(".wizard-modal-body").scrollBy = ({ top }) => { arrowScroll = top; };
        const marker = root.querySelector("#generation-step-details");
        marker.focus();
        let prevented = false;
        keydown({ key: "ArrowDown", preventDefault() { prevented = true; } });
        assert.equal(arrowScroll, 48, "arrow keys scroll the dialog instead of the Wizard");
        assert.equal(prevented, true);
        root.querySelector("#generation-next").focus();
        keydown({ key: "Tab", shiftKey: false, preventDefault() {} });
        assert.equal(document.activeElement, root.querySelector("#generation-extension-id"), "Tab wraps inside the modal");
        const submit = root.querySelector("#generation-submit");
        assert.notEqual(submit.disabled, true, "Generate is never disabled while the baseline loads");
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(root._configurationStatus, "ready");
        await root.querySelector("#generation-next").emit("click");
        assert.equal(root._generationStep, "catalogs");
        const items = root.querySelector("#generation-design-items");
        assert.equal(items.children.length, 2, "presets are shown before filtering");
        const source = root.querySelector("#generation-design-source");
        source.value = "Local";
        await source.emit("change");
        assert.equal(items.children.length, 1, "source selection filters the list");
        const addedOnly = root.querySelector("#generation-design-added-only");
        addedOnly.checked = true;
        await addedOnly.emit("change");
        assert.equal(items.children.length, 1, "added-only keeps active packages");
        const search = root.querySelector("#generation-design-search");
        search.value = "missing";
        await search.emit("input");
        assert.match(items.children[0].textContent, /No presets match/);
        await root.querySelector('[data-design-kind="extension"]').emit("click");
        assert.equal(root._catalogKind, "extension");
        assert.equal(root.querySelector("#generation-available-heading").textContent, "Available extensions");
        assert.equal(items.children.length, 1, "extension tab has its own list");
        await root.querySelector('[data-design-kind="bundle"]').emit("click");
        assert.equal(root.querySelector("#generation-available-heading").textContent, "Available bundles");
        await root.querySelector("#generation-next").emit("click");
        assert.equal(root._generationStep, "advanced");
        root._designPending = true;
        assert.notEqual(submit.disabled, true, "Generate stays clickable while packages update");
        await submit.emit("click");
        assert.match(root.querySelector("#generation-messages").innerHTML, /Wait for Canvas Design changes/);
        root._designPending = false;
        const editor = root.querySelector("#generation-document-json");
        editor.value = "{ invalid JSON";
        await editor.emit("input");
        assert.notEqual(submit.disabled, true, "Generate remains clickable while a document is invalid");
        await submit.emit("click");
        assert.match(root.querySelector("#generation-messages").innerHTML, /Fix canvas-presentation/);
        assert.equal(requests.length, 0, "invalid JSON must not queue generation");
        const raw = '{\n  "note": "customer one-off"\n}';
        editor.value = raw;
        await editor.emit("input");
        await root.querySelector("#generation-back").emit("click");
        await root.querySelector("#generation-next").emit("click");
        assert.equal(editor.value, raw, "returning from Catalogs must not discard the design draft");
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.match(root.querySelector("#generation-document-provider").innerHTML, /recorded in the request and receipt/);
        assert.notEqual(submit.disabled, true, "Generate remains clickable after document validation");
        await submit.emit("click");
        assert.equal(submit.dataset.overwrite, "true");
        assert.equal(root._documentDrafts["canvas-presentation"], raw, "overwrite confirmation must retain the draft");
        assert.notEqual(submit.disabled, true, "overwrite confirmation remains clickable");
        await submit.emit("click");
        assert.equal(requests.length, 1);
        assert.deepEqual(Object.keys(requests[0].inlineDocuments), ["canvas-presentation"]);
        assert.equal(requests[0].inlineDocuments["canvas-presentation"], raw,
            "winning customer preset must not erase the superseded request document");
        await outcomeSeen;
        assert.equal(document.body.style.overflow, "auto", "closing restores background scrolling");
        assert.equal(background.inert, false, "closing restores Wizard interaction");
        assert.equal(document.activeElement, trigger, "closing returns focus to the launch control");
        assert.equal(documentListeners.has("keydown"), false, "closing removes the focus trap");
    } finally {
        closeGenerationDialog();
        globalThis.document = originalDocument;
        globalThis.fetch = originalFetch;
        state.snapshot = originalSnapshot;
        setGenerationDeps({ postJson: async () => undefined, render: () => {} });
    }
});
