import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as stock from "../extension-canvas-design/generated-host/phase-control/generated-phase-adapter.mjs";
import * as vertical from "../../spec-kit-presets/copilot-vertical-phase-control/generated/phase-adapter.mjs";
import { validatePhaseState } from "../extension-canvas-design/generated-scaffold/contracts/external-host-adapter.mjs";
import { phaseControlDom } from "./phase_control_dom_fixture.mjs";

const phases = [
    { id: "specify", label: "Specify", output: "specs/demo/spec.md" },
    { id: "plan", label: "Plan", output: "specs/demo/plan.md" },
];
const state = {
    phases, current: 0, workflow: "demo", status: null, draft: "initial",
    output: phases[0].output, outputLinks: [], slugEditable: false, sending: false, runLabel: null,
    badgeSlots: [{ id: "phase.card" }, { id: "phase.output" }],
};
const definition = { id: "workflow-phases", viewLabels: { plan: "Inspect Plan" } };

test("phase state requires boolean slugEditable for optional path previews", () => {
    assert.equal(validatePhaseState({ ...state, slugEditable: true }).slugEditable, true);
    assert.equal(validatePhaseState(state).slugEditable, false);
    for (const invalid of [undefined, null, "false", 0]) {
        assert.throws(() => validatePhaseState({ ...state, slugEditable: invalid }),
            /slugEditable must be a boolean/);
    }
});

for (const [name, adapter] of [["stock", stock], ["vertical", vertical]]) {
    if (name === "stock") {
        test("stock leaves unresolved paths hidden when slugs are disabled and previews when enabled", (t) => {
            const dom = phaseControlDom();
            const previousDocument = globalThis.document;
            globalThis.document = dom.document;
            t.after(() => { globalThis.document = previousDocument; });
            const actions = Object.fromEntries(["select", "draft", "run", "view",
                "reveal", "error"].map((action) => [action, () => {}]));
            const pending = { ...state, workflow: "__new__", output: "specs/<slug>/spec.md" };
            const control = adapter.mount({ root: dom.root, definition, actions,
                state: validatePhaseState(pending) });
            assert.equal(dom.root.querySelector("#browse-output-folder").hidden, true);
            assert.equal(dom.root.querySelector("#phase-output-prompt").textContent,
                "Run the phase to resolve the output path.");
            control.update(validatePhaseState({ ...pending, slugEditable: true }));
            assert.equal(dom.root.querySelector("#phase-output-prompt").textContent,
                "Choose an artifact folder name to preview the output path.");
            control.update(validatePhaseState({
                ...pending, slugEditable: true, output: "specs/demo/spec.md",
            }));
            assert.equal(dom.root.querySelector("#browse-output-folder").hidden, false);
            control.dispose();
        });
        test("stock shows a supplied phase description instead of its command ID", (t) => {
            const dom = phaseControlDom();
            const previousDocument = globalThis.document;
            globalThis.document = dom.document;
            t.after(() => { globalThis.document = previousDocument; });
            const actions = Object.fromEntries(["select", "draft", "run", "view",
                "reveal", "error"].map((action) => [action, () => {}]));
            const control = adapter.mount({ root: dom.root, definition, actions,
                state: { ...state, phases: [{ ...phases[0],
                    description: "Describe what to build & why." }] } });
            assert.match(dom.root.innerHTML, /<p class="tagline">Describe what to build &amp; why\.<\/p>/);
            assert.doesNotMatch(dom.root.innerHTML, /speckit\.specify/);
            control.dispose();
            const legacy = adapter.mount({ root: dom.root, definition, actions,
                state: { ...state, phases: [phases[0]] } });
            assert.match(dom.root.innerHTML, /Describe what to build and why\./);
            legacy.dispose();
        });
        test("stock nests expanded outputs inside the shaded Output(s) section", async (t) => {
            const dom = phaseControlDom();
            const previousDocument = globalThis.document;
            globalThis.document = dom.document;
            t.after(() => { globalThis.document = previousDocument; });
            const actions = Object.fromEntries(["select", "draft", "run", "view",
                "reveal", "error"].map((action) => [action, () => {}]));
            const control = adapter.mount({ root: dom.root, definition, actions,
                state: { ...state, outputLinks: [{
                    template: "specs/<slug>/checklists/requirements.md",
                    label: "specs/demo/checklists/requirements.md",
                }] } });
            assert.match(dom.root.innerHTML,
                /<dl class="phase-facts">[\s\S]*?<dd>[\s\S]*?id="phase-output-toggle"[\s\S]*?id="phase-other-outputs"[\s\S]*?<\/dd><\/dl>/);
            const toggle = dom.root.querySelector("#phase-output-toggle");
            assert.equal(toggle.hidden, false);
            dom.root.dispatch("click", toggle);
            assert.equal(dom.root.querySelector("#phase-other-outputs").hidden, false);
            const css = await readFile(new URL(
                "../extension-canvas-design/generated-scaffold/ui/workflow-theme.css", import.meta.url), "utf8");
            assert.match(css, /\.phase-output-list\s*\{[^}]*margin:\s*0\.5rem 0 0 0\.4rem/s);
            control.dispose();
        });
        test("stock labels the first pending phase Run phase", (t) => {
            const dom = phaseControlDom();
            const previousDocument = globalThis.document;
            globalThis.document = dom.document;
            t.after(() => { globalThis.document = previousDocument; });
            const actions = Object.fromEntries(["select", "draft", "run", "view",
                "reveal", "error"].map((action) => [action, () => {}]));
            const control = adapter.mount({ root: dom.root, definition, actions,
                state: { ...state, workflow: "__new__" } });
            assert.equal(dom.root.querySelector("#run-phase").textContent,
                "Run phase");
            control.dispose();
        });
        test("stock rebuilds its phase card when badge slots change after mount", (t) => {
            const dom = phaseControlDom();
            const previousDocument = globalThis.document;
            globalThis.document = dom.document;
            t.after(() => { globalThis.document = previousDocument; });
            const actions = Object.fromEntries(["select", "draft", "run", "view",
                "reveal", "error"].map((action) => [action, () => {}]));
            const control = adapter.mount({ root: dom.root, definition, actions,
                state: { ...state, badgeSlots: undefined } });
            assert.equal(dom.root.querySelector("#phase-badges"), null);
            control.update({ ...state, badgeModels: [
                { text: "Ready", color: "green", phase: "specify" },
            ] });
            assert.match(dom.root.querySelector("#phase-badges").innerHTML, /Ready/);
            assert.ok(dom.root.querySelector("#phase-view-badges"));
            control.dispose();
        });
    }
    test(`${name} renders a targeted output badge in the phase control's output slot`, (t) => {
        const dom = phaseControlDom();
        const previousDocument = globalThis.document;
        globalThis.document = dom.document;
        t.after(() => { globalThis.document = previousDocument; });
        const actions = Object.fromEntries(["select", "draft", "run", "view", "runAt",
            "viewAt", "startManagedRun", "stopManagedRun", "reveal", "error"]
            .map((action) => [action, () => {}]));
        const control = adapter.mount({ root: dom.root, definition, actions, state: {
            ...state, outputLinks: [{
                template: "specs/<slug>/extra.md", label: "specs/demo/extra.md",
            }], badgeModels: [{
                text: "Extra output", color: "blue", targets: [{
                    phase: "specify", output: "specs/<slug>/extra.md",
                }],
            }],
        } });
        if (name === "stock") {
            const rows = dom.root.querySelector("#phase-other-outputs").children;
            const marks = rows.flatMap((row) => row.children ?? [])
                .find((node) => node.dataset.phaseBadgeSlot === "phase.output");
            assert.match(marks.innerHTML, /Extra output/);
        } else {
            assert.match(dom.root.innerHTML,
                /data-phase-badge-slot="phase.output">[^<]*<span[^>]*>Extra output/);
        }
        control.dispose();
    });
    test(`${name} renders readable text over custom hex badge backgrounds`, (t) => {
        const dom = phaseControlDom();
        const previousDocument = globalThis.document;
        globalThis.document = dom.document;
        t.after(() => { globalThis.document = previousDocument; });
        const actions = Object.fromEntries(["select", "draft", "run", "view", "runAt",
            "viewAt", "startManagedRun", "stopManagedRun", "reveal", "error"]
            .map((action) => [action, () => {}]));
        const control = adapter.mount({ root: dom.root, definition, actions, state: {
            ...state, badgeModels: [
                { text: "Light", color: "#ffffff", phase: "specify" },
                { text: "Dark", color: "#000000", phase: "specify" },
            ],
        } });
        const markup = name === "stock"
            ? dom.root.querySelector("#phase-badges").innerHTML : dom.root.innerHTML;
        if (name === "stock") assert.match(dom.root.innerHTML,
            /id="phase-badges" data-phase-badge-slot="phase.card"/);
        assert.match(markup, /style="background-color:#ffffff;color:#111"/);
        assert.match(markup, /style="background-color:#000000;color:#fff"/);
        control.dispose();
    });
    test(`${name} owns phase badge markup without disabling pending retries`, (t) => {
        const dom = phaseControlDom();
        const previousDocument = globalThis.document;
        globalThis.document = dom.document;
        t.after(() => { globalThis.document = previousDocument; });
        assert.ok(adapter.capabilities.includes("workflow.badges.v1"));
        const actions = Object.fromEntries(["select", "draft", "run", "view", "runAt",
            "viewAt", "startManagedRun", "stopManagedRun", "reveal", "error"]
            .map((action) => [action, () => {}]));
        const control = adapter.mount({ root: dom.root, definition, actions, state: {
            ...state, statuses: { specify: { status: "Running" } }, status: { status: "Running" },
            badgeModels: [
                { text: "Workflow review", phaseText: "Phase <review>",
                    color: "amber", phase: "specify" },
                { text: "Other phase", color: "blue", phase: "plan" },
            ],
        } });
        const rendered = name === "stock"
            ? dom.root.querySelector("#phase-badges").innerHTML : dom.root.innerHTML;
        assert.match(rendered, /Phase &lt;review&gt;/);
        assert.doesNotMatch(rendered, /Workflow review/);
        assert.doesNotMatch(rendered, /<review>/);
        if (name === "stock") {
            assert.doesNotMatch(dom.root.querySelector("#phase-badges").innerHTML, /Other phase/);
            assert.equal(dom.root.querySelector("#run-phase").disabled, false);
        } else {
            assert.match(dom.root.innerHTML, /Other phase/);
            assert.match(dom.root.innerHTML, /data-action="start" data-index="0"[^>]*>/);
        }
        control.dispose();
    });
    test(`${name} does not dispatch a confirmed selection after navigation`, async (t) => {
        const dom = phaseControlDom();
        const previousDocument = globalThis.document;
        globalThis.document = dom.document;
        t.after(() => { globalThis.document = previousDocument; });
        const calls = [];
        let confirm;
        const decision = new Promise((resolve) => { confirm = resolve; });
        const actions = Object.fromEntries(["select", "draft", "run", "view", "runAt", "viewAt",
            "startManagedRun", "stopManagedRun", "reveal", "error"]
            .map((action) => [action, (...args) => { calls.push([action, ...args]); }]));
        actions.confirmRun = () => decision;
        const control = adapter.mount({ root: dom.root, definition, state, actions });
        dom.root.dispatch("click", dom.root.querySelector(name === "stock" ? "#run-phase"
            : '[data-action="start"]'));
        control.update(name === "stock" ? { ...state, current: 1, output: phases[1].output }
            : { ...state, workflow: "another-workflow" });
        confirm(true);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(calls.map(([action]) => action), ["error"]);
        assert.match(calls[0][1].message, /workflow or phase changed/);
        control.dispose();
    });

    test(`${name} preview disables phase execution and restores pending-turn retries after setup`, (t) => {
        const dom = phaseControlDom();
        const previousDocument = globalThis.document;
        globalThis.document = dom.document;
        t.after(() => { globalThis.document = previousDocument; });
        const actions = Object.fromEntries(["select", "draft", "run", "view", "runAt", "viewAt",
            "startManagedRun", "stopManagedRun", "reveal", "error"].map((action) => [action, () => {}]));
        const control = adapter.mount({ root: dom.root, definition,
            state: { ...state, setupPending: true,
                ...(name === "stock" ? { blocked: "Available after setup" } : {}) }, actions });
        const selector = name === "stock" ? "#run-phase" : '[data-action="start"]';
        const input = dom.root.querySelector(name === "stock" ? "#phase-args" : "[data-phase-draft]");
        assert.equal(dom.root.querySelector(selector).disabled, true);
        assert.equal(name === "stock" ? input.readOnly : input.hasAttribute("readonly"), true);
        if (name === "vertical") assert.equal(dom.root.querySelector('[data-action="autopilot"]').disabled, true);
        assert.match(name === "stock" ? dom.root.querySelector("#phase-message").textContent
            : dom.root.innerHTML, /Available after setup/);
        control.update({ ...state, setupPending: false, blocked: null, status: { status: "Running" } });
        assert.equal(dom.root.querySelector(selector).disabled, false);
        if (name === "vertical") assert.equal(dom.root.querySelector('[data-action="autopilot"]').disabled, false);
        control.dispose();
    });
    test(`${name} phase control mounts, updates a focused draft, dispatches actions and disposes`, async (t) => {
        const dom = phaseControlDom();
        const previousDocument = globalThis.document;
        globalThis.document = dom.document;
        t.after(() => { globalThis.document = previousDocument; });
        const calls = [];
        const actions = Object.fromEntries(["select", "draft", "run", "view", "runAt", "viewAt",
            "startManagedRun", "stopManagedRun", "reveal", "error"]
            .map((action) => [action, (...args) => { calls.push([action, ...args]); }]));
        const initial = name === "stock" ? {
            ...state, phases: [], current: -1, output: null,
        } : state;
        const control = adapter.mount({ root: dom.root, definition, state: initial, actions });
        assert.equal(adapter.controlId, "workflow-phases");
        assert.equal(adapter.contractVersion, 1);
        if (name === "stock") {
            assert.match(dom.root.innerHTML, /No workflow phases are configured/);
            assert.equal(dom.root.querySelectorAll("[data-phase-index]").length, 0);
            control.update(state);
        }

        assert.match(dom.root.innerHTML, /aria-label="Workflow phases"/);
        assert.match(dom.root.innerHTML, /aria-label="Selected phase"/);
        assert.equal(dom.root.querySelectorAll("[data-phase-index]").length, 2);

        const draft = dom.root.querySelector(name === "stock" ? "#phase-args" : "[data-phase-draft]");
        draft.value = "typed but not yet saved";
        draft.focus();
        draft.setSelectionRange(5, 5);
        control.update({ ...state, status: {
            status: "Completed", output: phases[0].output, artifactAvailability: "available",
        }, draft: "typed but not yet saved" });
        const updatedDraft = dom.root.querySelector(name === "stock" ? "#phase-args" : "[data-phase-draft]");
        assert.equal(dom.document.activeElement, updatedDraft);
        if (name === "stock") assert.equal(updatedDraft, draft);
        assert.equal(updatedDraft.value, "typed but not yet saved");
        assert.equal(updatedDraft.selectionStart, 5);
        const view = dom.root.querySelector(name === "stock" ? "#view-artifact" : '[data-action="view-row"]');
        if (name === "stock") assert.equal(view.hidden, false);
        else assert.match(dom.root.innerHTML, /data-action="view-row"/);
        dom.root.querySelectorAll("[data-phase-index]")[0].focus();
        control.update({ ...state, status: { status: "Completed" } });
        assert.equal(dom.document.activeElement,
            dom.root.querySelectorAll("[data-phase-index]")[0]);
        if (name === "vertical") {
            const secondStart = dom.root.querySelector('[data-action="start"][data-index="1"]');
            secondStart.focus();
            control.update(state);
            assert.equal(dom.document.activeElement,
                dom.root.querySelector('[data-action="start"][data-index="1"]'));
        }

        dom.root.dispatch("click", dom.root.querySelectorAll("[data-phase-index]")[1]);
        const input = dom.root.querySelector(name === "stock" ? "#phase-args" : "[data-phase-draft]");
        input.value = "run this";
        dom.root.dispatch("input", input);
        dom.root.dispatch("click", dom.root.querySelector(name === "stock" ? "#run-phase" : '[data-action="start"]'));
        if (name === "stock") {
            dom.root.dispatch("click", dom.root.querySelector("#view-artifact"));
            dom.root.dispatch("click", dom.root.querySelector("#browse-output-folder"));
        } else {
            for (const action of ["view-row", "reveal"])
                dom.root.dispatch("click", dom.root.querySelector(`[data-action="${action}"]`));
        }
        assert.deepEqual(calls.map(([action]) => action), name === "stock"
            ? ["select", "draft", "run", "view", "reveal"]
            : ["select", "draft", "runAt", "reveal"]);
        assert.deepEqual(calls[0], ["select", 1]);
        assert.deepEqual(calls[2], name === "stock" ? ["run", "run this"] : ["runAt", 0]);
        if (name === "stock") {
            assert.match(dom.root.innerHTML, />View output<\/button>/);
            control.update({ ...state, outputLinks: [
                { template: "specs/<slug>/spec.md", label: "specs/demo/spec.md" },
                { template: "specs/<slug>/research.md", label: "specs/demo/research.md" },
                { template: "specs/<slug>/data-model.md", label: "specs/demo/data-model.md" },
            ] });
            assert.match(dom.root.innerHTML, /<dt>Output\(s\)<\/dt>.*DEFAULT:/);
            const toggle = dom.root.querySelector("#phase-output-toggle");
            const others = dom.root.querySelector("#phase-other-outputs");
            assert.equal(toggle.textContent, "▸ +2 more");
            assert.equal(toggle.attributes.get("aria-expanded"), "false");
            assert.equal(others.hidden, true);
            dom.root.dispatch("click", toggle);
            assert.equal(toggle.textContent, "− hide outputs");
            assert.equal(toggle.attributes.get("aria-expanded"), "true");
            assert.equal(others.hidden, false);
            assert.equal(others.children.length, 2);
            const link = others.children[0].children[0];
            assert.equal(link.children[0].textContent, "specs/demo/research.md");
            dom.root.dispatch("click", link);
            assert.deepEqual(calls.at(-1), ["view", "specs/<slug>/research.md"]);
            control.update({ ...state, outputLinks: [
                { template: "specs/<slug>/spec.md", label: "specs/demo/spec.md" },
                { template: "specs/<slug>/research.md", label: "specs/demo/research.md" },
            ] });
            assert.equal(dom.root.querySelector("#phase-other-outputs").hidden, false);
            control.update({ ...state, workflow: "__new__", output: "specs/<slug>/spec.md",
                slugEditable: true, blocked: "Enter an artifact folder name (slug)" });
            assert.equal(dom.root.querySelector("#phase-output-prompt").hidden, false);
            assert.equal(dom.root.querySelector("#browse-output-folder").hidden, true);
            assert.equal(dom.root.querySelector("#phase-artifact-status").hidden, true);
            assert.equal(dom.root.querySelector("#run-phase").disabled, true);
        }
        actions[name === "stock" ? "run" : "runAt"] = () => Promise.reject(new Error("run failed"));
        dom.root.dispatch("click", dom.root.querySelector(name === "stock" ? "#run-phase" : '[data-action="start"]'));
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(calls.at(-1).slice(0, 1), ["error"]);
        assert.match(calls.at(-1)[1].message, /run failed/);
        control.update({ ...state, current: 1, draft: "plan details", output: phases[1].output,
            status: { status: "Running" } });
        assert.match(dom.root.innerHTML, /<h2>Plan<\/h2>/);
        assert.equal(dom.root.querySelector(name === "stock" ? "#view-artifact"
            : '[data-action="view-row"][data-index="1"]').textContent, "Inspect Plan");
        if (name === "stock") {
            assert.equal(dom.root.querySelector("#phase-output-toggle").hidden, true);
            assert.equal(dom.root.querySelector("#phase-other-outputs").hidden, true);
        }
        assert.equal(dom.root.querySelectorAll("[data-phase-index]")[1].hasAttribute("aria-current"), true);
        assert.equal(dom.root.querySelector(name === "stock" ? "#phase-args" : "[data-phase-draft]").value,
            "plan details");
        control.update({ ...state, current: 0 });
        assert.equal(dom.root.querySelector(name === "stock" ? "#view-artifact"
            : '[data-action="view-row"][data-index="0"]').textContent,
        name === "stock" ? "View output" : "View artifact");
        control.update({ ...state, phases: [{ ...phases[0], id: "constructor" }, phases[1]] });
        assert.equal(dom.root.querySelector(name === "stock" ? "#view-artifact"
            : '[data-action="view-row"][data-index="0"]').textContent,
        name === "stock" ? "View output" : "View artifact");
        control.dispose();
        const count = calls.length;
        dom.root.dispatch("input", input);
        assert.equal(calls.length, count);
        assert.equal(dom.listeners.size, 0);
    });
}

test("stock phase Run confirms only when an optional callback is supplied", async (t) => {
    const dom = phaseControlDom();
    const previousDocument = globalThis.document;
    globalThis.document = dom.document;
    t.after(() => { globalThis.document = previousDocument; });
    const calls = [];
    let decision = false;
    const actions = Object.fromEntries(["select", "draft", "view", "reveal", "error"]
        .map((name) => [name, () => {}]));
    actions.run = (input) => calls.push(["run", input]);
    actions.confirmRun = (phase) => { calls.push(["confirm", phase.id]); return decision; };
    const control = stock.mount({ root: dom.root, definition, state, actions });
    const run = dom.root.querySelector("#run-phase");
    dom.root.querySelector("#phase-args").value = "details";
    dom.root.dispatch("click", run);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [["confirm", "specify"]]);
    decision = true;
    dom.root.dispatch("click", run);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [["confirm", "specify"], ["confirm", "specify"], ["run", "details"]]);
    control.dispose();
});
