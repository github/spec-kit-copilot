import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    canvasDesignEntries,
    currentCanvasDesignerSelections,
    freshCanvasDesignerSelections,
    openCanvasDesignerDialog,
    submitDesignerLaunch,
} from "../ui/canvas-designer-dialog.js";
import { renderPipelineBanner } from "../ui/phase-runtime.js";
import { state } from "../ui/state.js";

const required = [{ id: "canvas-design", source: "copilot", approved: true }];
const designerSource = { available: true, extension: { version: "0.1.0" } };

test("only bundles also allow Default items with the exact canvas-design tag", () => {
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
        assert.deepEqual(canvasDesignEntries(snapshot, kind),
            kind === "bundles" ? [snapshot.catalog[kind][0], ...candidates.slice(-2)] : candidates.slice(-2));
        assert.deepEqual(snapshot, before);
        assert.deepEqual(canvasDesignEntries({}, kind), []);
        assert.deepEqual(canvasDesignEntries({ catalog: { [kind]: null } }, kind), []);
    }
    assert.deepEqual(freshCanvasDesignerSelections(), { presets: [], extensions: required, bundles: [] });
});

function fakeElement(dataset = {}) {
    const handlers = {};
    const attributes = new Map();
    return {
        dataset, checked: false, disabled: false, hidden: false, inert: false, textContent: "",
        isConnected: true, classList: { toggle() {} },
        addEventListener(type, callback) { handlers[type] = callback; },
        click() { return handlers.click?.({ target: this, currentTarget: this }); },
        change() { return handlers.change?.({ target: this }); },
        keydown(key) {
            const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            handlers.keydown?.(event);
            return event;
        },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        removeAttribute(name) { attributes.delete(name); },
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
                ".designer-backdrop", ".designer-error", ".designer-status", ".designer-submit"]
                .map((selector) => [selector, fakeElement()]));
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
                this.nodes.get(".wizard-modal-cancel"), this.nodes.get(".designer-submit"),
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

test("dialog shows empty design catalogs and enables launch after catalog loads", () => {
    const previousDocument = globalThis.document;
    const previousSnapshot = state.snapshot;
    const { root, document, trigger } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = { catalog: { presets: [], extensions: [], bundles: [], designerFingerprint: "ready", designerSource } };
    try {
        openCanvasDesignerDialog();
        assert.match(root.innerHTML, /Canvas designer setup/);
        assert.match(root.innerHTML, /installed in a separate session before the designer opens/);
        assert.match(root.innerHTML, /wizard's configuration stays unchanged/);
        assert.doesNotMatch(root.innerHTML, /leaving this project's workflow configuration unchanged/);
        assert.doesNotMatch(root.innerHTML, /settings, appearance, and generation behavior/);
        assert.match(root.innerHTML, /No presets tagged canvas-design are available/);
        assert.match(root.innerHTML, /No extensions tagged canvas-design are available/);
        assert.match(root.innerHTML, /No bundles tagged canvas-design are available/);
        assert.match(root.innerHTML, /class="btn btn-primary designer-submit">Launch designer/);
        assert.equal(root.querySelector(".designer-submit").disabled, false);
        assert.match(root.innerHTML, /checked disabled aria-label="Canvas Design \(required\)"/);
        assert.doesNotMatch(root.innerHTML, /data-designer-kind=/);
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

test("launch leaves the dialog usable for parallel sessions and reports each acceptance or error", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = { pipeline: [{ id: "plan" }],
        catalog: { presets: [], extensions: [], bundles: [], designerFingerprint: "catalog-1", designerSource } };
    const requests = [];
    let finish;
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        if (requests.length === 1) return new Promise((resolve) => { finish = resolve; });
        return { ok: true, json: async () => ({ queued: true }) };
    };
    try {
        openCanvasDesignerDialog();
        const button = root.querySelector(".designer-submit");
        const pending = button.click();
        assert.equal(button.disabled, false);
        assert.equal(root.querySelector(".wizard-modal-close").disabled, false);
        root.tabs[1].click();
        assert.equal(root.tabs[1].getAttribute("aria-selected"), "true");
        await button.click();
        assert.equal(requests.length, 2);
        assert.match(root.querySelector(".designer-status").textContent, /1 Designer launch queued/);
        assert.notEqual(root.innerHTML, "");
        assert.deepEqual(JSON.parse(requests[0].options.body), {
            selections: { presets: [], extensions: required, bundles: [] },
            catalogFingerprint: "catalog-1", expectedPhases: ["plan"],
        });
        finish({ ok: false, status: 503, text: async () => '{"error":"dispatch unavailable"}' });
        await pending;
        assert.equal(root.querySelector(".designer-error").hidden, false);
        assert.match(root.querySelector(".designer-error").textContent, /dispatch unavailable/);
        assert.match(root.querySelector(".designer-status").textContent, /1 Designer launch queued/);
        assert.equal(button.disabled, false);
        await button.click();
        assert.equal(requests.length, 3);
        assert.match(root.querySelector(".designer-status").textContent, /2 Designer launches queued/);
        assert.equal(root.querySelector(".designer-error").hidden, true);
        root.querySelector(".wizard-modal-close").click();
        assert.equal(root.innerHTML, "");
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
        state.snapshot = previousSnapshot;
    }
});

test("a late launch response cannot change a reopened dialog", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = { pipeline: [], catalog: {
        presets: [], extensions: [], bundles: [], designerFingerprint: "ready", designerSource,
    } };
    let finish;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    try {
        openCanvasDesignerDialog();
        const pending = root.querySelector(".designer-submit").click();
        root.querySelector(".wizard-modal-cancel").click();
        openCanvasDesignerDialog();
        finish({ ok: true, json: async () => ({ queued: true }) });
        await pending;
        assert.equal(root.querySelector(".designer-status").hidden, true);
        assert.equal(root.querySelector(".designer-error").hidden, true);
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
        state.snapshot = previousSnapshot;
    }
});

test("launch submits the dialog's rendered snapshot after a catalog refresh", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = {
        pipeline: [{ id: "plan" }],
        catalog: {
            presets: [{ id: "theme", name: "Original theme", source: "copilot",
                tags: ["canvas-design"], version: "1.0.0" }],
            extensions: [], bundles: [], designerFingerprint: "original", designerSource,
        },
    };
    const requests = [];
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return { ok: false, status: 409,
            text: async () => '{"error":"Wizard pipeline or catalog changed; reopen the Designer setup"}' };
    };
    try {
        openCanvasDesignerDialog();
        const [preset] = root.inputs;
        preset.checked = true;
        await preset.change();
        state.snapshot = {
            pipeline: [{ id: "tasks" }],
            catalog: {
                ...state.snapshot.catalog,
                presets: [{ ...state.snapshot.catalog.presets[0], name: "Updated theme",
                    version: "2.0.0" }],
                designerFingerprint: "updated",
            },
        };
        assert.match(root.innerHTML, /Original theme/);
        assert.doesNotMatch(root.innerHTML, /Updated theme/);
        await root.querySelector(".designer-submit").click();
        assert.deepEqual(requests, [{
            selections: { presets: [{ id: "theme", source: "copilot", approved: true }],
                extensions: required, bundles: [] },
            catalogFingerprint: "original", expectedPhases: ["plan"],
        }]);
        assert.match(root.querySelector(".designer-error").textContent, /reopen the Designer setup/);
        root.querySelector(".wizard-modal-cancel").click();
        openCanvasDesignerDialog();
        assert.match(root.innerHTML, /Updated theme/);
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
        state.snapshot = previousSnapshot;
    }
});

test("submit rejects an unsuccessful or malformed queue acknowledgment", async () => {
    const snapshot = { pipeline: [], catalog: { designerFingerprint: "ready" } };
    const selections = freshCanvasDesignerSelections();
    await assert.rejects(submitDesignerLaunch(snapshot, selections, async () =>
        ({ ok: true, json: async () => ({ ready: true }) })), /did not queue/);
    await assert.rejects(submitDesignerLaunch(snapshot, selections, async () => {
        throw new Error("offline");
    }), /Could not reach the Wizard: offline/);
});

test("designer tabs use roving focus and activate panels with arrow, Home, and End keys", () => {
    const previousDocument = globalThis.document;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = { catalog: { presets: [], extensions: [], bundles: [] } };
    try {
        openCanvasDesignerDialog();
        const [presets, extensions, bundles] = root.tabs;
        assert.match(root.innerHTML, /role="tab" aria-selected="true" aria-controls="designer-panel-presets" tabindex="0"/);
        assert.match(root.innerHTML, /role="tab" aria-selected="false" aria-controls="designer-panel-extensions" tabindex="-1"/);
        assert.match(root.innerHTML, /role="tabpanel" aria-labelledby="designer-tab-bundles"/);
        assert.equal(presets.keydown("ArrowRight").defaultPrevented, true);
        assert.equal(document.activeElement, extensions);
        assert.equal(extensions.getAttribute("tabindex"), "0");
        assert.equal(presets.getAttribute("tabindex"), "-1");
        assert.equal(root.panels[1].hidden, false);
        assert.equal(root.panels[0].hidden, true);
        assert.equal(extensions.keydown("End").defaultPrevented, true);
        assert.equal(document.activeElement, bundles);
        assert.equal(bundles.getAttribute("aria-selected"), "true");
        assert.equal(bundles.keydown("ArrowRight").defaultPrevented, true);
        assert.equal(document.activeElement, presets);
        assert.equal(presets.keydown("ArrowLeft").defaultPrevented, true);
        assert.equal(document.activeElement, bundles);
        assert.equal(bundles.keydown("Home").defaultPrevented, true);
        assert.equal(document.activeElement, presets);
        assert.equal(presets.keydown("Space").defaultPrevented, false);
        bundles.click();
        assert.equal(bundles.getAttribute("tabindex"), "0");
        assert.equal(presets.getAttribute("tabindex"), "-1");
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        state.snapshot = previousSnapshot;
    }
});

test("bundles lock listed members; direct choices and overlaps survive removal", async () => {
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
        assert.equal(root.querySelector(".designer-backdrop").inert, false);
        assert.equal(preset.checked, true);
        assert.equal(preset.disabled, true);
        assert.deepEqual(currentCanvasDesignerSelections().presets,
            [{ id: "shared", source: "copilot", approved: true }]);
        assert.deepEqual(currentCanvasDesignerSelections().extensions, required);
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
        assert.equal(preset.disabled, true);
        assert.equal(preset.note.textContent, "Included by bundle: First");
        await preset.change();
        assert.deepEqual(currentCanvasDesignerSelections().presets,
            [{ id: "shared", source: "copilot", approved: true }]);
        assert.equal(preset.checked, true);
        assert.equal(preset.note.textContent, "Included by bundle: First");
        two.checked = true;
        await two.change();
        assert.equal(preset.checked, true);
        assert.equal(preset.note.textContent, "Included by bundle: First, Second");
        preset.checked = true;
        await preset.change();
        one.checked = false;
        await one.change();
        assert.equal(preset.disabled, true);
        assert.equal(preset.note.textContent, "Included by bundle: Second");
        assert.deepEqual(currentCanvasDesignerSelections().extensions, required);
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

test("concurrent bundle inspections cannot re-enable or restore a pending deselected bundle", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const previousSnapshot = state.snapshot;
    const { root, document } = fakeDialogDocument();
    globalThis.document = document;
    state.snapshot = { catalog: {
        designerSource,
        presets: ["first", "second"].map((id) => ({
            id, source: "copilot", tags: ["canvas-design"],
        })),
        extensions: [],
        bundles: ["one", "two"].map((id) => ({
            id, source: "copilot", tags: ["canvas-design"],
        })),
        designerFingerprint: "ready",
    } };
    const pending = new Map();
    globalThis.fetch = (url) => new Promise((resolve) => {
        pending.set(new URL(url, "http://localhost").searchParams.get("id"), resolve);
    });
    try {
        openCanvasDesignerDialog();
        const [, , one, two] = root.inputs;
        one.checked = true;
        const firstInspection = one.change();
        assert.equal(one.disabled, true);
        two.checked = true;
        const secondInspection = two.change();
        assert.equal(one.disabled, true);
        assert.equal(two.disabled, true);
        assert.equal(root.querySelector(".designer-submit").disabled, true);

        pending.get("one")({ ok: true, json: async () => ({
            members: [{ kind: "presets", id: "first" }],
        }) });
        await firstInspection;
        assert.equal(one.disabled, false);
        assert.equal(two.disabled, true);
        one.checked = false;
        await one.change();
        pending.get("two")({ ok: true, json: async () => ({
            members: [{ kind: "presets", id: "second" }],
        }) });
        await secondInspection;
        assert.deepEqual(currentCanvasDesignerSelections(), {
            presets: [{ id: "second", source: "copilot", approved: true }],
            extensions: required,
            bundles: [{ id: "two", source: "copilot", approved: true }],
        });
        assert.equal(root.querySelector(".designer-submit").disabled, false);
    } finally {
        root.replaceChildren();
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
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
        assert.deepEqual(currentCanvasDesignerSelections().extensions, required);
        approved = true;
        extension.checked = true;
        await extension.change();
        assert.deepEqual(currentCanvasDesignerSelections().extensions,
            [...required, { id: "community-style", source: "community", approved: true }]);
        assert.match(root.innerHTML, /class="btn btn-primary designer-submit">Launch designer/);
        extension.checked = false;
        await extension.change();
        assert.deepEqual(currentCanvasDesignerSelections().extensions, required);
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
