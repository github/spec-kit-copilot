import assert from "node:assert/strict";
import { test } from "node:test";
import { controlId, contractVersion, capabilities, mount } from "../../spec-kit-presets/copilot-vertical-phase-control/generated/phase-adapter.mjs";

const phases = [
    { id: "specify", label: "Specify", output: "specs/demo/spec.md" },
    { id: "plan", label: "Plan <script>", output: "specs/demo/plan.md" },
];
const definition = { id: "workflow-phases", viewLabels: {} };
const initial = {
    workflow: "demo", phases, current: 0, status: { status: "Not run" },
    draft: "Initial <input>", output: phases[0].output,
    outputLinks: [{ template: "specs/<slug>/checklist.md", label: "specs/demo/checklist.md" }],
    sending: false, runLabel: null,
    badgeSlots: [{ id: "phase.card" }, { id: "phase.output" }],
};

function rootFixture() {
    const listeners = new Map();
    const confirmations = [];
    const root = {
        innerHTML: "", ownerDocument: { activeElement: null,
            defaultView: { confirm: (text) => { confirmations.push(text); return true; } } },
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); },
        replaceChildren() { this.innerHTML = ""; },
        contains() { return true; },
        querySelector(selector) {
            return selector === "[data-phase-draft]" ? { value: "Edited draft" } : null;
        },
    };
    return { root, listeners, confirmations };
}

test("vertical phase adapter owns full navigation and card and dispatches the contracted actions", () => {
    assert.equal(controlId, "workflow-phases");
    assert.equal(contractVersion, 1);
    const { root, listeners } = rootFixture();
    const calls = [];
    const actions = Object.fromEntries(["select", "draft", "runAt", "viewAt",
        "startManagedRun", "stopManagedRun", "reveal", "error"]
        .map((name) => [name, (...args) => calls.push([name, ...args])]));
    const control = mount({ root, definition, state: initial, actions });
    assert.match(root.innerHTML, /vertical-phase-list/);
    assert.match(root.innerHTML, /Autopilot/);
    assert.match(root.innerHTML, /Start Step 0/);
    assert.match(root.innerHTML, /aria-current="step"/);
    assert.match(root.innerHTML, /<section class="phase-card vertical-phase-detail"/);
    assert.match(root.innerHTML, /Initial &lt;input&gt;/);
    assert.doesNotMatch(root.innerHTML, /<script>/);
    assert.match(root.innerHTML, /data-output="specs\/&lt;slug&gt;\/checklist.md"/);
    control.update({ ...initial, outputLinks: [
        { template: "reports/<slug>/notes.md", label: "reports/demo/notes.md" },
    ] });
    assert.match(root.innerHTML, /data-action="output"\s+data-output="reports\/&lt;slug&gt;\/notes.md"/);
    assert.match(root.innerHTML, /reports\/demo\/notes.md/);
    listeners.get("click")({ target: { closest: () => ({
        disabled: false, dataset: { action: "output", output: "reports/<slug>/notes.md" },
        hasAttribute: () => false,
    }) } });
    assert.deepEqual(calls.at(-1), ["viewAt", 0, "reports/<slug>/notes.md"]);
    calls.length = 0;

    const click = (attributes, dataset = {}) => listeners.get("click")({
        target: { closest: () => ({
            disabled: false, dataset, hasAttribute: (name) => attributes.includes(name),
        }) },
    });
    click(["data-phase-index"], { phaseIndex: "1" });
    click([], { action: "start", index: "0" });
    click([], { action: "autopilot" });
    click([], { action: "reveal" });
    listeners.get("input")({ target: {
        matches: () => true, value: "New direction",
    } });
    assert.deepEqual(calls, [
        ["select", 1], ["runAt", 0], ["startManagedRun"], ["reveal"], ["draft", "New direction"],
    ]);
    control.update({ ...initial, current: 1, output: phases[1].output,
        status: { status: "Complete", output: phases[1].output, artifactAvailability: "available" },
        draft: "Done", outputLinks: [] });
    assert.match(root.innerHTML, /Plan &lt;script&gt;/);
    assert.match(root.innerHTML, /class="phase-notice">Complete/);
    assert.match(root.innerHTML, /data-action="view-row"/);
    control.update({ ...initial, output: null, status: null, outputLinks: [] });
    assert.match(root.innerHTML, /No declared output/);
    assert.match(root.innerHTML, /No artifact is available for this phase yet/);
    control.update({ ...initial, sending: true, status: { status: "Running" }, runLabel: "Sending..." });
    assert.match(root.innerHTML, /data-action="start" data-index="0"[^>]*>Start Step 0/);
    click([], { action: "start", index: "0" });
    assert.deepEqual(calls.at(-1), ["runAt", 0]);
    control.update({ ...initial, status: { status: "Request sent" },
        statuses: { specify: { status: "Request sent" } }, runLabel: "Request sent..." });
    assert.match(root.innerHTML, /Request sent/);
    assert.match(root.innerHTML, /data-status="Request sent">request sent/);
    assert.match(root.innerHTML, /data-action="start" data-index="0"[^>]*>Start Step 0/);
    click([], { action: "start", index: "0" });
    assert.deepEqual(calls.at(-1), ["runAt", 0]);
    control.update({ ...initial, status: { status: "Running" },
        statuses: { specify: { status: "Running" } }, runLabel: "Running..." });
    assert.match(root.innerHTML, /data-action="start" data-index="0"[^>]*>Start Step 0/);
    click([], { action: "start", index: "0" });
    assert.deepEqual(calls.at(-1), ["runAt", 0]);
    control.update({ ...initial, status: { status: "Completed" }, runLabel: null });
    assert.match(root.innerHTML, /Start Step 0/);
    control.dispose();
    assert.equal(root.innerHTML, "");
    assert.equal(listeners.size, 0);
});

test("vertical phase adapter handles empty workflows without host phase markup", () => {
    const { root } = rootFixture();
    const actions = Object.fromEntries(["select", "draft", "runAt", "viewAt",
        "startManagedRun", "stopManagedRun", "reveal", "error"]
        .map((name) => [name, () => {}]));
    mount({ root, definition, state: {
        phases: [], current: -1, workflow: "__new__", status: null, draft: "",
        output: null, outputLinks: [], sending: false, runLabel: null,
    }, actions });
    assert.match(root.innerHTML, /No workflow phases are configured/);
});

test("vertical phase adapter renders phase/output badge pairs without cross-phase leakage", () => {
    assert.ok(capabilities.includes("workflow.badges.targets.v1"));
    const { root } = rootFixture();
    const actions = Object.fromEntries(["select", "draft", "runAt", "viewAt",
        "startManagedRun", "stopManagedRun", "reveal", "error"]
        .map((name) => [name, () => {}]));
    const state = { ...initial,
        badgeModels: [
            { text: "Specify only", color: "blue", targets: [
                { phase: "specify", output: "specs/demo/spec.md" }] },
            { text: "Plan only", color: "green", targets: [
                { phase: "plan", output: "specs/demo/plan.md" }] },
            { text: "Plan card only", color: "amber", targets: [
                { phase: "plan", output: null }] },
        ] };
    const control = mount({ root, definition, state, actions });
    const detail = () => root.innerHTML.split('<section class="phase-card vertical-phase-detail"')[1];
    assert.match(detail(), /Specify only/);
    assert.doesNotMatch(detail(), /Plan only|Plan card only/);
    control.update({ ...state, current: 1, output: "specs/demo/plan.md", outputLinks: [] });
    assert.match(detail(), /Plan only/);
    assert.match(detail(), /Plan card only/);
    assert.doesNotMatch(detail(), /Specify only/);
    control.dispose();
});

test("the adapter confirms only Autopilot transitions, never pending manual retries", async () => {
    const { root, listeners, confirmations } = rootFixture();
    const calls = [];
    const actions = Object.fromEntries(["select", "draft", "runAt", "viewAt",
        "startManagedRun", "stopManagedRun", "reveal", "error"]
        .map((name) => [name, (...args) => { calls.push([name, ...args]); }]));
    const control = mount({ root, definition, state: { ...initial, status: { status: "Request sent" } }, actions });
    const click = (action, index) => listeners.get("click")({
        target: { closest: () => ({
            disabled: false, dataset: { action, ...(index === undefined ? {} : { index: String(index) }) },
            hasAttribute: () => false,
        }) },
    });
    click("start", 1);
    assert.deepEqual(calls, [["runAt", 1]]);
    assert.equal(confirmations.length, 0);

    control.update({ ...initial, autopilot: { status: "Running", current: 0 } });
    root.ownerDocument.defaultView.confirm = (text) => { confirmations.push(text); return false; };
    click("start", 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [["runAt", 1]]);
    root.ownerDocument.defaultView.confirm = (text) => { confirmations.push(text); return true; };
    click("start", 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls.slice(1), [["stopManagedRun"], ["runAt", 1]]);
    assert.match(confirmations[0], /Stop it before starting this step manually/);

    control.update({ ...initial, autopilot: { item: "demo", status: "Blocked", current: 1 } });
    root.ownerDocument.defaultView.confirm = (text) => { confirmations.push(text); return false; };
    click("autopilot");
    assert.equal(calls.at(-1)[0], "runAt");
    root.ownerDocument.defaultView.confirm = (text) => { confirmations.push(text); return true; };
    click("autopilot");
    assert.deepEqual(calls.at(-1), ["startManagedRun"]);
    assert.match(confirmations.at(-1), /Check chat and artifacts before resuming/);
    control.dispose();
});

test("vertical control keeps the other workflow's Stop action without borrowing its phase progress", () => {
    const { root } = rootFixture();
    const actions = Object.fromEntries(["select", "draft", "runAt", "viewAt",
        "startManagedRun", "stopManagedRun", "reveal", "error"].map((name) => [name, () => {}]));
    mount({ root, definition, state: { ...initial, statuses: {}, autopilot: {
        item: "specs/alpha", status: "Running", current: 0, message: "Running: step 1 of 2",
    } }, actions });
    assert.match(root.innerHTML, /data-action="stop">Stop/);
    assert.match(root.innerHTML, /Autopilot for specs\/alpha: Running: step 1 of 2/);
    assert.match(root.innerHTML, /data-status="Not run">pending/);
    assert.doesNotMatch(root.innerHTML, /data-status="Running">running/);
});
