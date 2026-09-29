import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    canvasDesignEntries,
    currentCanvasDesignerSelections,
    freshCanvasDesignerSelections,
    openCanvasDesignerDialog,
} from "../ui/canvas-designer-dialog.js";
import { renderPipelineBanner } from "../ui/phase-runtime.js";
import { state } from "../ui/state.js";

test("only Copilot and Community items with the exact canvas-design tag are offered", () => {
    for (const kind of ["presets", "extensions", "bundles"]) {
        const candidates = [
            { id: "wrong-case", source: "copilot", tags: ["Canvas-Design"] },
            { id: "partial", source: "copilot", tags: ["canvas-design-extra"] },
            { id: "string-tags", source: "community", tags: "canvas-design" },
            { id: "untagged", source: "community" },
            { id: "design", source: "community", tags: ["design"] },
            ...["copilot", "community"].map((source) => ({
                id: `${source}-design`, source, name: source, tags: ["canvas-design"],
            })),
        ];
        const snapshot = { catalog: { [kind]: [
            { id: "built-in", source: "default", tags: ["canvas-design"] },
            { source: "copilot", tags: ["canvas-design"] },
            null,
            ...candidates,
        ] } };
        const before = structuredClone(snapshot);
        assert.deepEqual(canvasDesignEntries(snapshot, kind), candidates.slice(-2));
        assert.deepEqual(snapshot, before);
        assert.deepEqual(canvasDesignEntries({}, kind), []);
        assert.deepEqual(canvasDesignEntries({ catalog: { [kind]: null } }, kind), []);
    }
    assert.deepEqual(freshCanvasDesignerSelections(), { presets: [], extensions: [], bundles: [] });
});

function fakeElement(dataset = {}) {
    const handlers = {};
    return {
        dataset, checked: false, disabled: false, hidden: false, textContent: "",
        isConnected: true, classList: { toggle() {} },
        addEventListener(type, callback) { handlers[type] = callback; },
        click() { handlers.click?.({ target: this, currentTarget: this }); },
        change() { return handlers.change?.({ target: this }); },
        keydown(key) { handlers.keydown?.({ key, preventDefault() {} }); },
        setAttribute() {},
        focus() { globalThis.document.activeElement = this; },
    };
}

function fakeDialogDocument() {
    const trigger = fakeElement();
    const root = {
        html: "", nodes: new Map(), inputs: [],
        set innerHTML(value) {
            this.html = value;
            this.nodes = new Map([".designer-modal", ".wizard-modal-close", ".wizard-modal-cancel",
                ".designer-backdrop", ".designer-error"].map((selector) => [selector, fakeElement()]));
            this.inputs = [...value.matchAll(/data-designer-kind="([^"]+)" data-designer-index="(\d+)"/g)]
                .map(([, kind, index]) => {
                    const input = fakeElement({ designerKind: kind, designerIndex: index });
                    input.note = fakeElement();
                    input.parentElement = { querySelector: () => input.note };
                    return input;
                });
            this.tabs = ["presets", "extensions", "bundles"].map((kind) => fakeElement({ designerTab: kind }));
            this.panels = this.tabs.map((tab) => fakeElement({ designerPanel: tab.dataset.designerTab }));
            this.nodes.get(".designer-modal").querySelectorAll = () => [
                this.nodes.get(".wizard-modal-close"), ...this.tabs, ...this.inputs,
                this.nodes.get(".wizard-modal-cancel"),
            ];
        },
        get innerHTML() { return this.html; },
        querySelector(selector) {
            return this.html ? this.nodes.get(selector) ?? null : null;
        },
        querySelectorAll(selector) {
            if (selector === "[data-designer-tab]") return this.tabs;
            if (selector === "[data-designer-panel]") return this.panels;
            if (selector === "[data-designer-kind]") return this.inputs;
            const kind = selector.match(/^\[data-designer-kind="([^"]+)"\]$/)?.[1];
            if (kind) return this.inputs.filter((input) => input.dataset.designerKind === kind);
            return [];
        },
        replaceChildren() { this.innerHTML = ""; },
    };
    root.innerHTML = "";
    const document = {
        activeElement: trigger,
        querySelector(selector) { return selector === ".designer-modal" ? root.querySelector(selector) : null; },
        getElementById(id) { return id === "wizard-modal-root" ? root : null; },
    };
    return { root, document, trigger };
}

test("dialog shows empty states while never launching", () => {
    const previousDocument = globalThis.document;
    const previousSnapshot = state.snapshot;
    const { root, document, trigger } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = { catalog: { presets: [], extensions: [], bundles: [] } };
    try {
        openCanvasDesignerDialog();
        assert.match(root.innerHTML, /Canvas designer setup/);
        assert.match(root.innerHTML, /settings and generation behavior/);
        assert.match(root.innerHTML, /leaving the wizard's configuration unchanged/);
        assert.doesNotMatch(root.innerHTML, /leaving this project's workflow configuration unchanged/);
        assert.doesNotMatch(root.innerHTML, /settings, appearance, and generation behavior/);
        assert.match(root.innerHTML, /No presets available in the Copilot or Community catalogs/);
        assert.match(root.innerHTML, /No extensions available in the Copilot or Community catalogs/);
        assert.match(root.innerHTML, /No bundles available in the Copilot or Community catalogs/);
        assert.match(root.innerHTML, /designer-submit" disabled aria-label="Launch designer \(not available yet\)"/);
        assert.doesNotMatch(root.innerHTML, /Canvas generator \(required\)|data-designer-kind=/);
        assert.deepEqual(currentCanvasDesignerSelections(), freshCanvasDesignerSelections());
        openCanvasDesignerDialog();
        assert.equal(document.activeElement, root.querySelector(".wizard-modal-close"));
        root.querySelector(".wizard-modal-cancel").click();
        assert.equal(root.innerHTML, "");
        assert.equal(document.activeElement, trigger);
        assert.equal(currentCanvasDesignerSelections(), null);
        openCanvasDesignerDialog();
        assert.deepEqual(currentCanvasDesignerSelections(), freshCanvasDesignerSelections());
        root.querySelector(".designer-modal").keydown("Escape");
        assert.equal(currentCanvasDesignerSelections(), null);
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        state.snapshot = previousSnapshot;
    }
});

test("bundles check only listed members without locking them; direct choices and overlaps survive removal", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousWindow = globalThis.window;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    globalThis.document = document;
    globalThis.window = { confirm: () => true };
    state.snapshot = { catalog: {
        presets: [
            { id: "shared", name: "Shared", source: "copilot", tags: ["canvas-design"] },
            { id: "hidden", name: "Hidden", source: "copilot" },
        ],
        extensions: [],
        bundles: [
            { id: "one", name: "First", source: "copilot", tags: ["canvas-design"] },
            { id: "two", name: "Second", source: "copilot", tags: ["canvas-design"] },
        ],
    } };
    globalThis.fetch = async (url) => ({
        ok: true,
        json: async () => ({ members: url.includes("id=one")
            ? [{ kind: "presets", id: "shared" }, { kind: "presets", id: "hidden" },
                { kind: "extensions", id: "extra" }]
            : [{ kind: "presets", id: "shared" }] }),
    });
    try {
        openCanvasDesignerDialog();
        const [preset, one, two] = root.inputs;
        one.checked = true;
        await one.change();
        assert.equal(preset.checked, true);
        assert.equal(preset.disabled, false);
        assert.deepEqual(currentCanvasDesignerSelections().presets,
            [{ id: "shared", source: "copilot", approved: true }]);
        assert.deepEqual(currentCanvasDesignerSelections().extensions, []);
        assert.doesNotMatch(root.innerHTML, /data-designer-included-kind|extra|Hidden/);
        one.checked = false;
        await one.change();
        assert.equal(preset.checked, false);
        assert.equal(preset.disabled, false);
        preset.checked = true;
        await preset.change();
        one.checked = true;
        await one.change();
        assert.equal(preset.checked, true);
        assert.equal(preset.disabled, false);
        assert.equal(preset.note.textContent, "Included by bundle: First");
        preset.checked = false;
        await preset.change();
        assert.deepEqual(currentCanvasDesignerSelections().presets, []);
        assert.equal(preset.checked, false);
        assert.equal(preset.note.textContent, "Included by bundle: First");
        two.checked = true;
        await two.change();
        assert.equal(preset.checked, true);
        assert.equal(preset.note.textContent, "Included by bundle: First, Second");
        preset.checked = true;
        await preset.change();
        one.checked = false;
        await one.change();
        assert.equal(preset.disabled, false);
        assert.equal(preset.note.textContent, "Included by bundle: Second");
        assert.deepEqual(currentCanvasDesignerSelections().extensions, []);
        two.checked = false;
        await two.change();
        assert.equal(preset.disabled, false);
        assert.equal(preset.checked, true);
        assert.deepEqual(currentCanvasDesignerSelections().presets,
            [{ id: "shared", source: "copilot", approved: true }]);
        preset.checked = false;
        await preset.change();
        assert.deepEqual(currentCanvasDesignerSelections(), freshCanvasDesignerSelections());
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
        globalThis.window = previousWindow;
        state.snapshot = previousSnapshot;
    }
});

test("Copilot bundles do not auto-select a Community member with the same id", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousWindow = globalThis.window;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    let confirmed = false;
    globalThis.document = document;
    globalThis.window = { confirm: () => confirmed };
    state.snapshot = { catalog: {
        presets: [
            { id: "shared", name: "Community shared", source: "community", tags: ["canvas-design"] },
            { id: "same-source", name: "Copilot member", source: "copilot", tags: ["canvas-design"] },
        ],
        extensions: [],
        bundles: [{ id: "kit", name: "Copilot kit", source: "copilot", tags: ["canvas-design"] }],
    } };
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ members: [
            { kind: "presets", id: "shared" },
            { kind: "presets", id: "same-source" },
        ] }),
    });
    try {
        openCanvasDesignerDialog();
        const [community, copilot, bundle] = root.inputs;
        bundle.checked = true;
        await bundle.change();
        assert.equal(community.checked, false);
        assert.equal(community.note.textContent, "");
        assert.equal(copilot.checked, true);
        assert.deepEqual(currentCanvasDesignerSelections().presets,
            [{ id: "same-source", source: "copilot", approved: true }]);
        community.checked = true;
        await community.change();
        assert.equal(community.checked, false);
        confirmed = true;
        community.checked = true;
        await community.change();
        assert.deepEqual(currentCanvasDesignerSelections().presets, [
            { id: "shared", source: "community", approved: true },
            { id: "same-source", source: "copilot", approved: true },
        ]);
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
        globalThis.window = previousWindow;
        state.snapshot = previousSnapshot;
    }
});

test("failed bundle inspection leaves selections unchanged and shows an error", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = { catalog: {
        presets: [], extensions: [], bundles: [{ id: "broken", source: "copilot", tags: ["canvas-design"] }],
    } };
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: "not found" }) });
    try {
        openCanvasDesignerDialog();
        const [bundle] = root.inputs;
        bundle.checked = true;
        await bundle.change();
        assert.equal(bundle.checked, false);
        assert.equal(bundle.disabled, false);
        assert.deepEqual(currentCanvasDesignerSelections(), freshCanvasDesignerSelections());
        assert.match(root.querySelector(".designer-error").textContent, /not found/);
        assert.equal(root.querySelector(".designer-error").hidden, false);
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
        state.snapshot = previousSnapshot;
    }
});

test("selection stays local, community confirmation can cancel, and reopen resets choices", async () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    let approved = false;
    globalThis.document = document;
    globalThis.window = { confirm: () => approved };
    state.snapshot = { catalog: {
        presets: [{ id: "copilot-style", name: "Style", source: "copilot", tags: ["canvas-design"] }],
        extensions: [{ id: "community-style", name: "Extension", source: "community",
            tags: ["canvas-design"], installAllowed: false }],
        bundles: [],
    } };
    try {
        openCanvasDesignerDialog();
        assert.match(root.innerHTML, /Copilot/);
        const [preset, extension] = root.inputs;
        preset.checked = true;
        await preset.change();
        assert.deepEqual(currentCanvasDesignerSelections().presets,
            [{ id: "copilot-style", source: "copilot", approved: true }]);
        extension.checked = true;
        await extension.change();
        assert.equal(extension.checked, false);
        assert.deepEqual(currentCanvasDesignerSelections().extensions, []);
        approved = true;
        extension.checked = true;
        await extension.change();
        assert.deepEqual(currentCanvasDesignerSelections().extensions,
            [{ id: "community-style", source: "community", approved: true }]);
        assert.match(root.innerHTML, /designer-submit" disabled/);
        extension.checked = false;
        await extension.change();
        assert.deepEqual(currentCanvasDesignerSelections().extensions, []);
        root.querySelector(".wizard-modal-close").click();
        openCanvasDesignerDialog();
        assert.deepEqual(currentCanvasDesignerSelections(), freshCanvasDesignerSelections());
        assert.equal(root.inputs.every((input) => !input.checked), true);
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
        state.snapshot = previousSnapshot;
    }
});

test("Phases header exposes Generate canvas even without steps", () => {
    const previousDocument = globalThis.document;
    const previousTab = state.activeTab;
    const previousSnapshot = state.snapshot;
    const banner = { hidden: true, innerHTML: "", querySelector: () => null };
    globalThis.document = { getElementById: (id) => id === "pipeline-banner" ? banner : null };
    state.activeTab = "phases";
    try {
        state.snapshot = { pipeline: [] };
        renderPipelineBanner();
        assert.equal(banner.hidden, false);
        assert.match(banner.innerHTML, /pipeline-generate" aria-label="Generate canvas"[^>]*>Generate canvas<\/button>/);
        assert.match(banner.innerHTML, /pipeline-clear" data-action="clear" disabled/);
        assert.match(banner.innerHTML, /pipeline-reset" data-action="reset"/);
        const dialogSource = readFileSync(new URL("../ui/canvas-designer-dialog.js", import.meta.url), "utf8");
        assert.doesNotMatch(dialogSource, /\/api\/generator\/launch|submitGeneratorLaunch|create_session/);
        assert.match(dialogSource, /designerSession: true/);
    } finally {
        globalThis.document = previousDocument;
        state.activeTab = previousTab;
        state.snapshot = previousSnapshot;
    }
});
