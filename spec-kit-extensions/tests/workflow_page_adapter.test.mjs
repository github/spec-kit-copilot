import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { mount, pageId, contractVersion, renderStockPage } from "../extension-canvas-design/generated-host/workflow-page/generated-workflow-page-adapter.mjs";
import { validateWorkflowPageState } from "../extension-canvas-design/generated-scaffold/contracts/external-host-adapter.mjs";

test("stock Workflow adapter stays within the packaged module byte limit", async () => {
    const bytes = await readFile(new URL(
        "../extension-canvas-design/generated-host/workflow-page/generated-workflow-page-adapter.mjs",
        import.meta.url));
    assert.ok(bytes.length <= 32 * 1024, `Workflow adapter is ${bytes.length} bytes`);
    const windowsBytes = Buffer.byteLength(bytes.toString("utf8").replace(/\r?\n/g, "\r\n"));
    assert.ok(windowsBytes <= 32 * 1024, `Windows Workflow adapter is ${windowsBytes} bytes`);
});

test("stock adapter owns setup, constitution, values, phase and contributed markup", () => {
    const root = { innerHTML: "" };
    renderStockPage(root, { id: "workflow", canvas: {
        displayName: "Demo", workflowListName: "<unsafe>", description: "Description",
    }, mainPageAsset: null, readOnlyFields: [
        { id: "test.note", label: "Note", value: "<script>" },
        { id: "test.code", label: "Code", value: "A", section: { id: "billing", title: "Billing" } },
    ],
    textPlacements: [], hasValues: true,
    generatedControls: [{ id: "test.control", label: "Control", adapter: "test-adapter",
        control: "test", properties: { choice: ["a"] }, value: { choice: "a" } }],
    hasConstitution: true, hasBadges: true,
    badgeDestinations: ["workflow.list", "phase.card"],
    fieldSlots: ["workflow.actions", "workflow.extra"] });
    for (const id of ["setup-surface", "instance-collection", "constitution-card",
        "canvas-values", "workflow-pipeline", "delete-workflow-dialog", "constitution-dialog"]) {
        assert.match(root.innerHTML, new RegExp(`id="${id}"`));
    }
    assert.match(root.innerHTML, /data-workflow-slot="workflow.actions"/);
    assert.match(root.innerHTML, /data-workflow-slot="workflow.extra"/);
    assert.match(root.innerHTML, /data-badge-slot="workflow.list"/);
    assert.match(root.innerHTML, /id="constitution-badges"/);
    assert.doesNotMatch(root.innerHTML, /id="constitution-output-badges"/);
    assert.doesNotMatch(root.innerHTML, /data-badge-slot="workflow.summary"/);
    assert.match(root.innerHTML, /&lt;unsafe&gt;|&lt;script&gt;/);
    assert.doesNotMatch(root.innerHTML, /<script>/);
    const html = root.innerHTML;
    const order = ['id="setup-surface"', 'class="workflow-intro"', 'id="workflow-heading"',
        'class="project-foundation workflow-section"', 'id="constitution-card"',
        '<h2>Configured fields</h2>', '<h2>Billing</h2>', 'id="canvas-values"',
        '<h2>Control</h2>', '<h2>Additional fields and actions</h2>',
        'data-workflow-slot="workflow.actions"', 'data-workflow-slot="workflow.extra"',
        'id="instance-collection"', 'class="workflow-detail workflow-section"', 'id="workflow-detail-heading"',
        'class="workflow-workspace"', 'id="selected-workflow-heading"', 'id="workflow-pipeline"']
        .map((marker) => html.indexOf(marker));
    assert.ok(order.every((index, position) => index >= 0 && (!position || index > order[position - 1])), String(order));
    assert.match(html, /<details class="project-foundation workflow-section" open><summary class="section-head"><h2>Project foundation<\/h2><\/summary>/);
    assert.match(html, /<section class="phase-card" aria-label="Billing"><details class="workflow-section" open>/);
    assert.match(html, /<section class="phase-card" aria-label="Control"><details class="workflow-section" open>/);
    assert.match(html, /<details class="workflow-detail workflow-section" open><summary class="section-head"><h2 id="workflow-detail-heading">Detail<\/h2><\/summary><div class="workflow-workspace"><h3 id="selected-workflow-heading" hidden><\/h3><div id="workflow-pipeline" hidden><\/div><\/div><\/details>/);
    assert.match(html, /id="workflow-action-error"[^>]*><\/p><\/section>\s*<details class="workflow-detail workflow-section"/);
    assert.match(html, /id="workflow-list-toggle"[^>]*aria-expanded="true" aria-controls="workflow-list-content">List<\/button>/);
    assert.match(html, /id="new-workflow" type="button" aria-label="New Workflow">\+ New<\/button>/);
    assert.match(html, /placeholder="workflow-1"/);
    assert.doesNotMatch(html, /class="workflow-summary"/);
    assert.match(html, /<div class="workflow-intro">\s*<div><h2 id="workflow-heading">/);
});

test("stock Workflow markup uses an independent item name and escapes it", () => {
    const root = { innerHTML: "" };
    const definition = { canvas: { displayName: "Demo", workflowListName: "Bugs",
        workflowItemName: 'Issue "<urgent>"', description: "Tracked bugs" },
    readOnlyFields: [], textPlacements: [], generatedControls: [], hasConstitution: false,
    hasValues: false, hasBadges: false, badgeDestinations: [], fieldSlots: [] };
    renderStockPage(root, definition);
    assert.match(root.innerHTML, /id="workflow-heading">Bugs /);
    assert.match(root.innerHTML, /aria-label="New Issue &quot;&lt;urgent&gt;&quot;"/);
    assert.match(root.innerHTML, /id="workflow-name-label">Issue &quot;&lt;urgent&gt;&quot; name/);
    assert.match(root.innerHTML, /placeholder="Issue &quot;&lt;urgent&gt;&quot; 1"/);
    assert.match(root.innerHTML, /placeholder="issue-urgent-1"/);
    assert.match(root.innerHTML, />Delete Issue &quot;&lt;urgent&gt;&quot;<\/button>/);
    assert.match(root.innerHTML, /placeholder="Search by name or directory"/);
    assert.match(root.innerHTML, /id="workflow-empty">No items yet\./);
    renderStockPage(root, { ...definition, canvas: { ...definition.canvas, workflowItemName: "!!!" } });
    assert.match(root.innerHTML, /placeholder="workflow-1"/);
    for (const invalid of ["", " Bug", "Bug\nReport", "x".repeat(81), null]) {
        assert.throws(() => renderStockPage(root, {
            ...definition, canvas: { ...definition.canvas, workflowItemName: invalid },
        }), /Invalid workflow item name/);
    }
});

test("stock workflow intro combines its fixed title and optional summary badges before List", () => {
    const root = { innerHTML: "" };
    renderStockPage(root, { canvas: { displayName: "Demo", workflowListName: "Bugs", description: "Tracked bugs" },
        mainPageAsset: { file: "logo.png" },
        readOnlyFields: [], textPlacements: [], generatedControls: [], hasConstitution: false,
        hasBadges: true, badgeDestinations: ["workflow.summary"], fieldSlots: [] });
    const html = root.innerHTML;
    assert.match(html, /<div class="workflow-summary"><div id="workflow-badge-summary" data-badge-slot="workflow.summary" class="canvas-badges" hidden><\/div><\/div><\/div>/);
    assert.ok(html.indexOf('data-stock-image="workflow.intro"') < html.indexOf('id="workflow-heading"'));
    assert.ok(html.indexOf('id="workflow-heading"') < html.indexOf('class="workflow-summary"'));
    assert.ok(html.indexOf('class="workflow-summary"') < html.indexOf('id="instance-collection"'));
    assert.match(html, /<h2 id="workflow-heading">Bugs <span class="muted" id="workflow-count">\(0\)<\/span><\/h2>/);
    assert.match(html, /class="collection-description muted">Tracked bugs<\/p>/);
    const intro = html.slice(html.indexOf('<div class="workflow-intro">'), html.indexOf('<section id="instance-collection"'));
    assert.doesNotMatch(intro, /<details|<summary|<button|workflow-summary-heading|>Summary</);
    assert.doesNotMatch(html, /Additional fields and actions/);
});

test("project foundation is omitted when Constitution is not configured", () => {
    const root = { innerHTML: "" };
    renderStockPage(root, { canvas: { displayName: "Demo", workflowListName: "Workflows" },
        readOnlyFields: [], textPlacements: [], generatedControls: [],
        hasConstitution: false, hasBadges: false, badgeDestinations: [], fieldSlots: [] });
    assert.doesNotMatch(root.innerHTML, /project-foundation|constitution-card|constitution-dialog/);
    assert.match(root.innerHTML, /class="workflow-workspace"/);
    assert.match(root.innerHTML, /id="selected-workflow-heading"[^>]* hidden/);
});

test("Constitution output badge is in the visible actions area of the Workflow page", () => {
    const root = { innerHTML: "" };
    renderStockPage(root, { canvas: { displayName: "Demo", workflowListName: "Workflows" },
        readOnlyFields: [], textPlacements: [], generatedControls: [],
        hasConstitution: true, hasBadges: true, badgeDestinations: ["phase.output"],
        fieldSlots: [] });
    assert.match(root.innerHTML,
        /<div class="constitution-actions">\s*<span id="constitution-output-badges"/);
    const details = root.innerHTML.match(/<div class="constitution-details">[\s\S]*?<\/div>/)?.[0];
    assert.ok(details);
    assert.doesNotMatch(details, /id="constitution-output-badges"/);
});

test("stock Workflow page mounts its phase control, updates collection and disposes", (t) => {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, {
            id, dataset: {}, children: [], hidden: false, scrollTop: 0,
            classList: { toggle() {} },
            addEventListener(name, callback) { this.listener = callback; },
            removeEventListener() { this.listener = null; },
            querySelector() { return { hidden: false }; },
            querySelectorAll() { return []; },
            closest() { return this.field ??= { hidden: false }; },
            replaceChildren(...children) { this.children = children; },
            append(...children) { this.children.push(...children); },
        });
        return elements.get(id);
    };
    const root = { querySelector: (selector) => element(selector.slice(1)),
        addEventListener() {}, removeEventListener() {} };
    const originalDocument = globalThis.document;
    globalThis.document = { getElementById: element, createElement: () => ({
        dataset: {}, style: {}, children: [], append(...children) { this.children.push(...children); },
    }), activeElement: null };
    t.after(() => { globalThis.document = originalDocument; });
    let disposed = false, updates = 0;
    const page = mount({ root, definition: { id: pageId },
        state: { model: null, phaseState: {} },
        actions: {
            selectWorkflow() {},
            mountPhase: (pipeline, state) => {
                assert.equal(pipeline, element("workflow-pipeline"));
                assert.deepEqual(state, {});
                return { update() { updates++; }, dispose() { disposed = true; } };
            },
            clearSetupPlan() {},
        } });
    assert.equal(contractVersion, 1);
    page.update({ model: { showSetup: false, userProvidesSlug: false, items: [], selected: "__new__",
        phases: [], badges: {}, constitutionReady: false, statuses: {},
        valueFields: [], valueErrors: {} },
    phaseState: {}, inputPending: false });
    assert.equal(element("workflow-count").textContent, "(0)");
    assert.equal(element("workflow-empty").textContent, "No workflow phases are configured.");
    assert.equal(updates, 1);
    const phase = { id: "speckit.constitution", project: true,
        output: ".specify/memory/constitution.md" };
    const badge = { id: "constitution", text: "Constitution ready",
        phaseText: "Project ready", color: "purple", targets: [{
            phase: phase.id, output: null,
        }] };
    const outputBadge = { ...badge, id: "constitution-output", targets: [{
        phase: phase.id, output: phase.output,
    }] };
    page.update({ model: { showSetup: false, userProvidesSlug: false, items: [], selected: "__new__",
        phases: [phase], badges: { project: [badge, outputBadge] }, constitutionReady: true,
        statuses: { [phase.id]: { status: "Completed", artifactAvailability: "available" } },
        valueFields: [], valueErrors: {} }, phaseState: {}, inputPending: false,
    pendingLabel: () => null });
    assert.equal(element("constitution-badges").children[0].children.length, 1);
    assert.equal(element("constitution-badges").children[0].children[0].textContent, "Project ready");
    assert.equal(element("constitution-output-badges").children[0].children.length, 1);
    const invalid = { showSetup: false, userProvidesSlug: false, items: [], selected: "__new__",
        phases: [phase], badges: { project: "invalid" }, constitutionReady: true,
        statuses: { [phase.id]: { status: "Completed", artifactAvailability: "available" } },
        valueFields: [], valueErrors: {} };
    assert.throws(() => page.update({ model: invalid, phaseState: {}, inputPending: false,
        pendingLabel: () => null }), /Invalid project badge results/);
    const project = { id: "constitution", project: true };
    const model = { showSetup: false, userProvidesSlug: false, items: [], selected: "__new__",
        phases: [project], badges: {}, constitutionReady: true,
        valueFields: [], valueErrors: {} };
    page.update({ model: { ...model, statuses: { constitution: {
        artifactAvailability: "available", status: "Completed" } } },
    pendingLabel: () => null, phaseState: {}, inputPending: false });
    assert.equal(element("constitution-status").textContent, "");
    assert.equal(element("constitution-status").hidden, true);
    assert.equal(element("view-constitution").hidden, false);
    page.update({ model: { ...model, statuses: { constitution: {
        artifactAvailability: "error", status: "Failed" } } },
    pendingLabel: () => null, phaseState: {}, inputPending: false });
    assert.equal(element("constitution-status").textContent, "Unavailable");
    assert.equal(element("constitution-status").hidden, false);
    assert.equal(element("workflow-slug").closest(".field").hidden, true);
    page.update({ model: { ...model, userProvidesSlug: true, statuses: {} },
        pendingLabel: () => null, phaseState: {}, inputPending: false });
    assert.equal(element("workflow-slug").closest(".field").hidden, false);
    page.dispose();
    assert.equal(disposed, true);
    assert.equal(element("workflow-search").listener, null);
});

test("workflow identity survives rebuilding a selected row after evidence changes", (t) => {
    class Element {
        constructor(tagName = "div", id = "") {
            this.tagName = tagName;
            this.id = id;
            this.dataset = {};
            this.children = [];
            this.parentElement = null;
            this.classList = { toggle() {} };
            this.hidden = false;
            this.scrollTop = 0;
        }
        append(...children) {
            for (const child of children) {
                if (child.parentElement) {
                    const siblings = child.parentElement.children;
                    siblings.splice(siblings.indexOf(child), 1);
                }
                child.parentElement = this;
                this.children.push(child);
            }
        }
        replaceChildren(...children) {
            for (const child of this.children) child.parentElement = null;
            this.children = [];
            this.append(...children);
        }
        querySelector(selector) {
            const matches = (node) => selector.startsWith("#") ? node.id === selector.slice(1)
                : selector.startsWith(".") ? node.className?.split(" ").includes(selector.slice(1))
                    : node.tagName === selector;
            for (const child of this.children) {
                if (matches(child)) return child;
                const nested = child.querySelector(selector);
                if (nested) return nested;
            }
            return null;
        }
        querySelectorAll() { return []; }
        closest() { return this.field ??= { hidden: false }; }
        setAttribute() {}
        removeAttribute() {}
        addEventListener() {}
        removeEventListener() {}
    }
    const root = new Element();
    const identity = new Element("div", "workflow-identity");
    identity.append(new Element("input", "workflow-name"));
    const slugLabel = new Element("span", "workflow-slug-label");
    const required = new Element("span");
    required.className = "muted";
    slugLabel.append(required);
    identity.append(slugLabel, new Element("input", "workflow-slug"), new Element("span", "workflow-slug-error"));
    const rows = new Element("div", "workflow-rows");
    for (const id of ["setup-surface", "workflow-search", "workflow-count", "new-workflow",
        "workflow-constitution-note", "workflow-pipeline", "workflow-list",
        "workflow-empty", "workflow-search-field", "workflow-list-status",
        "selected-workflow-heading"]) {
        root.append(new Element("div", id));
    }
    root.append(rows, identity);
    const originalDocument = globalThis.document;
    globalThis.document = {
        createElement: (tag) => new Element(tag),
        getElementById: () => null,
        activeElement: null,
    };
    t.after(() => { globalThis.document = originalDocument; });
    const page = mount({ root, definition: { id: pageId },
        state: { model: null, phaseState: {} },
        actions: { selectWorkflow() {}, mountPhase: () => ({ update() {}, dispose() {} }),
            clearSetupPlan() {} } });
    const model = (badges) => ({
        showSetup: false, userProvidesSlug: true,
        items: [{ id: "draft", label: "Draft", slug: "draft", pending: true }],
        selected: "draft", name: "Draft", slug: "draft", phases: [{ id: "specify" }],
        badges: { items: badges }, constitutionReady: true, statuses: {},
        valueFields: [], valueErrors: {},
    });
    const update = (badges) => page.update({
        model: model(badges), phaseState: {}, inputPending: false, slugTouched: false,
        slugError: "", pendingLabel: () => null,
    });
    const detailHead = () => root.querySelector("#selected-workflow-heading").children
        .map((child) => [child.tagName, child.textContent, child.hidden]);
    update({});
    assert.equal(root.querySelector("#selected-workflow-heading").hidden, false);
    assert.deepEqual(detailHead(), [["strong", "Draft", false], ["code", "draft", false]]);
    assert.equal(identity.parentElement, rows.children[0]);
    assert.equal(root.querySelector("#workflow-slug").closest(".field").hidden, false);
    update({ draft: [{ text: "Ready", color: "amber", showIn: ["workflow-list"] }] });
    assert.equal(identity.parentElement, rows.children[0]);
    assert.equal(root.querySelector("#workflow-name"), identity.querySelector("#workflow-name"));
    page.update({ model: {
        ...model({}), selected: "saved",
        items: [{ id: "saved", label: "Saved", slug: "saved", pending: false }],
    }, phaseState: {}, inputPending: false, pendingLabel: () => null });
    assert.equal(identity.hidden, true);
    assert.deepEqual(detailHead(), [["strong", "Saved", false], ["code", "saved", false]]);
    page.update({ model: { ...model({}), selected: "missing" },
        phaseState: {}, inputPending: false, pendingLabel: () => null });
    assert.equal(root.querySelector("#selected-workflow-heading").hidden, true);
    assert.deepEqual(detailHead(), []);
    update({});
    assert.equal(identity.hidden, false);
    assert.equal(identity.parentElement, rows.children[0]);
    assert.deepEqual(detailHead(), [["strong", "Draft", false], ["code", "draft", false]]);
    page.update({ model: { ...model({}), items: [{ id: "draft", label: "Draft", slug: "", pending: true }] },
        phaseState: {}, inputPending: false, pendingLabel: () => null });
    assert.deepEqual(detailHead()[1], ["code", "", true]);
    page.update({ model: { ...model({}), phases: [] },
        phaseState: {}, inputPending: false, pendingLabel: () => null });
    assert.equal(root.querySelector("#selected-workflow-heading").hidden, true);
    page.dispose();
});

test("Workflow page state requires a boolean slug setting and supports both modes", () => {
    const state = { model: { userProvidesSlug: true }, phaseState: { slugEditable: true } };
    assert.equal(validateWorkflowPageState(state), state);
    assert.equal(validateWorkflowPageState({
        model: { userProvidesSlug: false }, phaseState: { slugEditable: false },
    }).model.userProvidesSlug, false);
    assert.equal(validateWorkflowPageState({ model: null, phaseState: { slugEditable: false } }).model, null);
    for (const invalid of [undefined, null, "false", 0]) {
        assert.throws(() => validateWorkflowPageState({
            model: { userProvidesSlug: invalid }, phaseState: { slugEditable: false },
        }), /userProvidesSlug must be a boolean/);
    }
    assert.throws(() => validateWorkflowPageState({
        model: { userProvidesSlug: false }, phaseState: { slugEditable: "false" },
    }), /slugEditable must be a boolean/);
    assert.throws(() => validateWorkflowPageState({
        model: { userProvidesSlug: false }, phaseState: { slugEditable: true },
    }), /slug settings disagree/);
});

test("Workflow page contract validates pending recovery before a replacement adapter receives it", () => {
    const received = [];
    const replacement = { update: (state) => received.push(state.model.items[0]) };
    const row = { id: "__new__:1", pending: true, hasWorkflowRunHistory: true,
        workflowRecoveryMessage: "Inspect specs/001-demo.", status: "Run output unconfirmed" };
    const state = (item) => ({ model: { userProvidesSlug: false, items: [item] },
        phaseState: { slugEditable: false } });
    for (const status of ["Not started", "Request sent", "Running", "Unconfirmed",
        "Run output unconfirmed", "Completed", "Failed"]) {
        replacement.update(validateWorkflowPageState(state({ ...row, status })));
    }
    replacement.update(validateWorkflowPageState(state({ ...row,
        hasWorkflowRunHistory: false, workflowRecoveryMessage: null, status: "Not started" })));
    assert.equal(received.length, 8);
    for (const invalid of [
        ...[undefined, null, "true", 1].map((hasWorkflowRunHistory) =>
            ({ ...row, hasWorkflowRunHistory })),
        ...[undefined, false, 42, {}].map((workflowRecoveryMessage) =>
            ({ ...row, workflowRecoveryMessage })),
        ...[undefined, null, "Unknown"].map((status) => ({ ...row, status })),
    ]) {
        assert.throws(() => replacement.update(validateWorkflowPageState(state(invalid))),
            /invalid pending workflow recovery/);
    }
    assert.equal(received.length, 8);
    assert.throws(() => validateWorkflowPageState({ ...state(row),
        model: { userProvidesSlug: false, items: "invalid" } }), /items must be an array/);
});

test("Workflow page contract validates project badges before a replacement adapter receives them", () => {
    const received = [];
    const replacement = { update(state) { received.push(state.model.badges.project); } };
    const badge = { id: "constitution", category: "Progress", text: "Ready", phaseText: "Project ready",
        color: "purple", showIn: [], targets: [{ phase: "speckit.constitution", output: null },
            { phase: "speckit.constitution", output: ".specify/memory/constitution.md" }] };
    const legacy = { id: "legacy", text: "Ready", color: "theme",
        showIn: ["phase-card"], phase: "speckit.constitution" };
    const state = (project) => ({ phaseState: { slugEditable: false },
        model: { userProvidesSlug: false, badges: { project } } });
    replacement.update(validateWorkflowPageState(state([badge, legacy])));
    replacement.update(validateWorkflowPageState(state([])));
    assert.deepEqual(received, [[badge, legacy], []]);
    for (const invalid of ["invalid", [null], [{ ...badge, text: null }],
        [{ ...badge, color: null }], [{ ...badge, targets: [{ phase: "speckit.constitution" }] }],
        [{ ...badge, targets: [{ phase: 42, output: null }] }],
        [{ ...badge, targets: "invalid" }], [{ ...legacy, phase: undefined }],
        ...[null, 7, false, {}, []].map((category) => [{ ...badge, category }])]) {
        assert.throws(() => replacement.update(validateWorkflowPageState(state(invalid))),
            /invalid project badge results/);
    }
    assert.equal(received.length, 2);
});

test("Workflow page contract validates list and summary categories before adapter updates", () => {
    const received = [];
    const replacement = { update(state) { received.push(state.model.badges); } };
    const state = (badges) => ({ phaseState: { slugEditable: false },
        model: { userProvidesSlug: false, badges } });
    const item = { id: "ready", category: "Progress", text: "Ready", color: "green",
        showIn: ["workflow-list"] };
    const summary = { id: "ready", category: "Progress", text: "Ready: 1", color: "green", count: 1 };
    const { category: _itemCategory, ...legacyItem } = item;
    const { category: _summaryCategory, ...legacySummary } = summary;
    const valid = { items: { first: [item, legacyItem], second: [] },
        summary: [summary, legacySummary] };
    for (const badges of [valid, { items: {}, summary: [] }, {}]) {
        replacement.update(validateWorkflowPageState(state(badges)));
    }
    assert.deepEqual(received, [valid, { items: {}, summary: [] }, {}]);
    for (const category of [null, 7, false, {}, []]) {
        assert.throws(() => replacement.update(validateWorkflowPageState(
            state({ items: { first: [{ ...item, category }] } }))), /invalid workflow badge results/);
        assert.throws(() => replacement.update(validateWorkflowPageState(
            state({ summary: [{ ...summary, category }] }))), /invalid summary badge results/);
    }
    for (const items of [null, [], "invalid", { first: null }, { first: {} },
        { first: [null] }, { first: [[]] }, { first: [7] }]) {
        assert.throws(() => replacement.update(validateWorkflowPageState(state({ items }))),
            /invalid workflow badge results/);
    }
    for (const summary of [null, {}, "invalid", [null], [[]], [7]]) {
        assert.throws(() => replacement.update(validateWorkflowPageState(state({ summary }))),
            /invalid summary badge results/);
    }
    assert.equal(received.length, 3);
});
