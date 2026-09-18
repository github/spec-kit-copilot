// Exercise generated workflow UI rendering and interactions with mocked endpoints.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";
import { defaultPhaseInput } from "../generation/generated-canvas-template/workflow-adapter.mjs";

const savedGlobals = {
    document: globalThis.document,
    EventSource: globalThis.EventSource,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
};
const temporaryDirectories = [];
const tmpdir = () => dirname(fileURLToPath(import.meta.url));

afterEach(async () => {
    Object.assign(globalThis, savedGlobals);
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function fakeElement() {
    const listeners = new Map();
    const selectors = new Map();
    return {
        className: "",
        dataset: {},
        hidden: false,
        innerHTML: "",
        textContent: "",
        validationMessage: "",
        validityReports: 0,
        setCustomValidity(message) { this.validationMessage = message; },
        reportValidity() { this.validityReports++; return !this.validationMessage; },
        addEventListener(type, handler) { listeners.set(type, handler); },
        async emit(type, event = {}) { return listeners.get(type)?.(event); },
        querySelector(selector) {
            if (!selectors.has(selector)) selectors.set(selector, fakeElement());
            return selectors.get(selector);
        },
        querySelectorAll() { return []; },
        insertAdjacentHTML(_position, html) { this.innerHTML += html; },
    };
}

describe("generated workflow renderer", () => {
    for (const scenario of ["ready", "approval", "rerun", "blank"]) {
        test(`validates slugs before ${scenario} submission without losing drafts`, async () => {
            const elements = new Map();
            globalThis.document = {
                documentElement: { dataset: {} },
                getElementById(id) {
                    if (!elements.has(id)) elements.set(id, fakeElement());
                    return elements.get(id);
                },
            };
            globalThis.localStorage = { getItem() { return null; }, setItem() {} };
            globalThis.EventSource = class {};
            const blueprint = compileBlueprint({ pipeline: [{ id: "specify" }, { id: "plan" }] },
                { extensionId: "slug-ui", displayName: "Workflow", description: "Test." }, { userProvidesSlug: true });
            const phase = blueprint.pipeline.steps[0];
            const snapshot = {
                pipeline: blueprint, selectedItemId: "__new__",
                setup: { ready: scenario !== "approval", approval: { required: scenario === "approval", approved: false, components: [] } },
                items: [{
                    id: "__new__", isNew: true, slug: null, label: "New",
                    phases: { [phase.instanceKey]: { artifact: scenario === "rerun" ? "specs/example/spec.md" : null } },
                }],
            };
            const requests = [];
            globalThis.fetch = async (url, options) => {
                requests.push({ url, ...(options ? { input: JSON.parse(options.body) } : {}) });
                return { ok: true, json: async () => options ? { ok: true, setup: snapshot.setup } : structuredClone(snapshot) };
            };
            const directory = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
            temporaryDirectories.push(directory);
            await Promise.all(["app.js", "command-views.mjs", "markdown.mjs", "clarifications.mjs", "clarification-controls.mjs", "workflow-slug.mjs"].map((name) => (
                copyFile(new URL(["markdown.mjs", "clarifications.mjs", "clarification-controls.mjs"].includes(name) ? `../shared-workflow-ui/${name}` : `../generation/generated-canvas-template/ui/${name}`, import.meta.url), join(directory, name === "app.js" ? "app.mjs" : name))
            )));
            await import(pathToFileURL(join(directory, "app.mjs")).href);
            await new Promise((resolve) => setTimeout(resolve, 10));
            const slugControl = elements.get("workflow-slug");
            const argsControl = elements.get("phase-args");
            argsControl.value = "Keep my phase draft";
            await argsControl.emit("input", { target: argsControl });
            const before = requests.length;
            const modalBefore = elements.get("modal-root")?.innerHTML ?? "";
            for (const value of ["Two words", "a--b", "../outside", "con", "lpt9"]) {
                slugControl.value = value;
                await slugControl.emit("input", { target: slugControl });
                assert.equal(slugControl.validationMessage, "", "editing clears stale validation");
                const cardBefore = elements.get("phase-card").innerHTML;
                await elements.get("run-phase").emit("click");
                assert.equal(slugControl.validationMessage, ["con", "lpt9"].includes(value)
                    ? "This name is reserved on Windows. Choose another workflow slug."
                    : "Use lowercase letters, numbers, and single hyphens only.");
                assert.equal(elements.get("phase-card").innerHTML, cardBefore, "invalid submission never enters running state");
                assert.equal(requests.length, before, "invalid submission must make no network requests");
                assert.equal(elements.get("modal-root")?.innerHTML ?? "", modalBefore, "validation precedes approval and rerun dialogs");
                assert.equal(slugControl.value, value, "do not rewrite the slug draft");
                assert.equal(argsControl.value, "Keep my phase draft");
            }
            assert.equal(slugControl.validityReports, 5);
            slugControl.value = scenario === "blank" ? " \t " : "  fixed-slug  ";
            await slugControl.emit("input", { target: slugControl });
            assert.equal(slugControl.validationMessage, "");
            if (scenario !== "rerun") {
                await elements.get("next-phase").emit("click");
                await elements.get("previous-phase").emit("click");
                assert.match(elements.get("phase-card").innerHTML, scenario === "blank" ? /value=" \t "/ : /value="  fixed-slug  "/);
                assert.equal(argsControl.value, "Keep my phase draft");
            }
            const running = elements.get("run-phase").emit("click");
            if (scenario === "rerun") {
                assert.match(elements.get("modal-root").innerHTML, /Run again/);
                await elements.get("modal-root").querySelector('[data-answer="confirm"]').emit("click");
            }
            await running;
            if (scenario === "approval") {
                assert.ok(requests.some(({ url }) => url === "/api/installation-approval"));
                assert.ok(!requests.some(({ url }) => url === "/api/run"));
            } else {
                assert.deepEqual(requests.at(-1), {
                    url: "/api/run",
                    input: { phase: phase.instanceKey, itemId: "__new__", args: "Keep my phase draft", slug: scenario === "blank" ? "" : "fixed-slug" },
                });
            }
        });
    }

    test("Constitution LAST after Assess renders exactly five numbered phases and one top-level card", async () => {
        const fixture = JSON.parse(await readFile(new URL("./fixtures/generation/assess.json", import.meta.url), "utf8"));
        fixture.snapshot.pipeline.push({ id: "constitution" });
        const blueprint = compileBlueprint(fixture.snapshot, {
            extensionId: "assess-constitution", displayName: "Assess", description: "Test.",
        }, { userProvidesSlug: true });
        const elements = new Map();
        globalThis.document = {
            documentElement: { dataset: {} },
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, fakeElement());
                return elements.get(id);
            },
        };
        globalThis.localStorage = { getItem() { return null; }, setItem() {} };
        globalThis.EventSource = class {};
        const snapshot = {
            pipeline: blueprint,
            phaseInputs: Object.fromEntries(blueprint.pipeline.steps.map((step) => [step.instanceKey, defaultPhaseInput(step)])),
            projectArtifacts: { constitution: { state: "missing", ready: false, viewable: false } },
            setup: { ready: true }, selectedItemId: "__new__",
            items: [{ id: "__new__", isNew: true, label: "New", slug: null, phases: {} }],
        };
        globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(snapshot) });
        const directory = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
        temporaryDirectories.push(directory);
        await Promise.all([
            copyFile(new URL("../generation/generated-canvas-template/ui/app.js", import.meta.url), join(directory, "app.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/command-views.mjs", import.meta.url), join(directory, "command-views.mjs")),
            copyFile(new URL("../shared-workflow-ui/markdown.mjs", import.meta.url), join(directory, "markdown.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarifications.mjs", import.meta.url), join(directory, "clarifications.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarification-controls.mjs", import.meta.url), join(directory, "clarification-controls.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/workflow-slug.mjs", import.meta.url), join(directory, "workflow-slug.mjs")),
        ]);
        await import(pathToFileURL(join(directory, "app.mjs")).href);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const navigation = elements.get("phase-navigation").innerHTML;
        assert.equal((navigation.match(/data-phase-index=/g) ?? []).length, 5);
        assert.doesNotMatch(navigation, /Constitution|Phase 6|of 6/);
        for (const [index, label] of ["Intake", "Research", "Define", "Shape", "Decide"].entries()) {
            assert.match(navigation, new RegExp(`Phase ${index + 1} of 5: ${label}`));
            assert.match(elements.get("phase-card").innerHTML, new RegExp(`<h2>${label}</h2>`));
            assert.doesNotMatch(elements.get("phase-card").innerHTML, /<h2>Constitution|id="constitution-card"|Create \/ update/);
            if (index === 0) assert.match(elements.get("phase-card").innerHTML, /id="workflow-slug"/);
            if (index < 4) await elements.get("next-phase").emit("click");
        }
        assert.match(elements.get("phase-card").innerHTML, /id="next-phase"[^>]*disabled/);
        await elements.get("previous-phase").emit("click");
        assert.match(elements.get("phase-card").innerHTML, /<h2>Shape<\/h2>/);
        assert.equal((elements.get("constitution-card").innerHTML.match(/id="run-constitution"/g) ?? []).length, 1);
        const html = await readFile(new URL("../generation/generated-canvas-template/ui/index.html", import.meta.url), "utf8");
        assert.equal((html.match(/id="constitution-card"/g) ?? []).length, 1);
        assert.ok(html.indexOf('id="constitution-card"') < html.indexOf('id="instance-collection"'));
        assert.ok(html.indexOf('id="constitution-card"') < html.indexOf('id="phase-navigation"'));
        await elements.get("run-constitution").emit("click");
        assert.match(elements.get("modal-root").innerHTML, /Run Constitution/);
        assert.doesNotMatch(elements.get("phase-navigation").innerHTML, /Constitution/);
    });

    test("explicitly selected Constitution has one compact card, empty guidance dialog and preserved workflow drafts", async () => {
        for (const ids of [
            ["constitution", "specify", "plan"],
            ["specify", "constitution", "plan"],
            ["specify", "plan", "constitution"],
            ["constitution"],
        ]) {
            const elements = new Map();
            globalThis.document = {
                documentElement: { dataset: {} },
                getElementById(id) {
                    if (!elements.has(id)) elements.set(id, fakeElement());
                    return elements.get(id);
                },
            };
            globalThis.localStorage = { getItem() { return null; }, setItem() {} };
            let events;
            globalThis.EventSource = class { constructor() { events = this; } };
            const blueprint = compileBlueprint({ pipeline: ids.map((id) => ({ id })) },
                { extensionId: "constitution-ui", displayName: "Workflow", description: "Test." }, { userProvidesSlug: true });
            const constitution = blueprint.pipeline.steps.find((step) => step.commandName === "speckit.constitution");
            const phaseSteps = blueprint.pipeline.steps.filter((step) => step !== constitution);
            const snapshot = {
                pipeline: blueprint,
                phaseInputs: Object.fromEntries(blueprint.pipeline.steps.map((step) => [step.instanceKey, defaultPhaseInput(step)])),
                projectArtifacts: { constitution: { state: "missing", ready: false, viewable: false, path: constitution.artifact.pathTemplate } },
                setup: { ready: true },
                selectedItemId: phaseSteps.length ? "beta" : null,
                items: phaseSteps.length ? [
                    { id: "alpha", slug: "alpha", label: "Alpha", phases: {} },
                    { id: "beta", slug: "beta", label: "Beta", phases: {} },
                    { id: "__new__", slug: null, label: "New", isNew: true, phases: {} },
                ] : [],
            };
            const requests = [];
            globalThis.fetch = async (url, options) => {
                if (options) requests.push({ url, input: JSON.parse(options.body) });
                return {
                    ok: true,
                    json: async () => url.startsWith("/api/artifact")
                        ? { content: "# Project principles\nTest changes." }
                        : options ? { ok: true } : structuredClone(snapshot),
                };
            };
            const directory = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
            temporaryDirectories.push(directory);
            await Promise.all([
                copyFile(new URL("../generation/generated-canvas-template/ui/app.js", import.meta.url), join(directory, "app.mjs")),
                copyFile(new URL("../generation/generated-canvas-template/ui/command-views.mjs", import.meta.url), join(directory, "command-views.mjs")),
                copyFile(new URL("../shared-workflow-ui/markdown.mjs", import.meta.url), join(directory, "markdown.mjs")),
                copyFile(new URL("../shared-workflow-ui/clarifications.mjs", import.meta.url), join(directory, "clarifications.mjs")),
                copyFile(new URL("../shared-workflow-ui/clarification-controls.mjs", import.meta.url), join(directory, "clarification-controls.mjs")),
                copyFile(new URL("../generation/generated-canvas-template/ui/workflow-slug.mjs", import.meta.url), join(directory, "workflow-slug.mjs")),
            ]);
            await import(pathToFileURL(join(directory, "app.mjs")).href);
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.equal(elements.get("constitution-card").hidden, false);
            assert.match(elements.get("constitution-card").innerHTML, /Not created/);
            assert.match(elements.get("constitution-card").innerHTML, /id="view-constitution"[^>]*disabled/);
            assert.match(elements.get("constitution-card").innerHTML, /Define the project principles before running workflow phases/);
            assert.doesNotMatch(elements.get("constitution-card").innerHTML, /\.specify\/memory/);
            assert.doesNotMatch(elements.get("phase-navigation").innerHTML, /Constitution/);
            assert.doesNotMatch(elements.get("phase-card").innerHTML, /<h2>Constitution/);
            if (phaseSteps.length) {
                assert.match(elements.get("phase-navigation").innerHTML, /Phase 1 of 2: Specify/);
                assert.match(elements.get("phase-card").innerHTML, /id="workflow-slug"/);
                assert.match(elements.get("phase-card").innerHTML, /id="run-phase"[^>]*disabled[^>]*aria-describedby="constitution-prerequisite"/);
                await elements.get("next-phase").emit("click");
                elements.get("phase-args").value = "Keep my plan draft";
                await elements.get("phase-args").emit("input", { target: { value: "Keep my plan draft" } });
                assert.match(elements.get("phase-card").innerHTML, /<h2>Plan/);
            } else {
                assert.equal(elements.get("phase-navigation").innerHTML, "");
                assert.equal(elements.get("phase-card").innerHTML, "");
                assert.equal(elements.get("current-workflow").hidden, true);
                assert.equal(elements.get("instance-collection").hidden, true);
            }
            await elements.get("run-constitution").emit("click");
            assert.match(elements.get("modal-root").innerHTML, /Run Constitution/);
            assert.match(elements.get("modal-root").innerHTML, /<span class="field-label">Guidance/);
            assert.match(elements.get("modal-root").innerHTML, /placeholder="Optional: principles to emphasize \(e.g. testing, performance, UX\)"/);
            assert.doesNotMatch(elements.get("modal-root").innerHTML, /workflow-slug|item-picker|specs\/|\.specify/);
            assert.equal(elements.get("constitution-guidance").value, "");
            await elements.get("cancel-constitution").emit("click");
            assert.equal(requests.length, 0);
            assert.equal(elements.get("modal-root").innerHTML, "");
            await elements.get("run-constitution").emit("click");
            await elements.get("confirm-constitution").emit("click");
            assert.deepEqual(requests.at(-1), { url: "/api/run", input: { phase: constitution.instanceKey, args: "" } });
            assert.match(elements.get("constitution-card").innerHTML, /Not created/, "dispatch is not readiness");
            for (const [state, label] of [["template", "Template"], ["ready", "Ready"], ["error", "Unavailable"]]) {
                snapshot.projectArtifacts.constitution = {
                    state, ready: state === "ready", viewable: state !== "error", path: constitution.artifact.pathTemplate,
                    ...(state === "error" ? { error: "Cannot verify Constitution: repair the artifact." } : {}),
                };
                await events.onmessage();
                await new Promise((resolve) => setTimeout(resolve, 10));
                assert.match(elements.get("constitution-card").innerHTML, new RegExp(label));
                if (phaseSteps.length) {
                    assert.equal(elements.get("phase-args").value, "Keep my plan draft");
                    assert.match(elements.get("phase-card").innerHTML, /<h2>Plan/);
                    assert.match(elements.get("current-workflow").innerHTML, /Beta/);
                    if (state === "ready") assert.doesNotMatch(elements.get("phase-card").innerHTML, /id="run-phase"[^>]*disabled/);
                    else assert.match(elements.get("phase-card").innerHTML, /id="run-phase"[^>]*disabled/);
                }
            }
            snapshot.projectArtifacts.constitution = { state: "ready", ready: true, viewable: true, path: constitution.artifact.pathTemplate };
            await events.onmessage();
            await new Promise((resolve) => setTimeout(resolve, 10));
            await elements.get("view-constitution").emit("click");
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.equal(elements.get("artifact-viewer").hidden, false);
            assert.match(elements.get("artifact-viewer").querySelector(".artifact-viewer-body").innerHTML, /Project principles/);
            await elements.get("close-artifact").emit("click");
            assert.equal(elements.get("artifact-viewer").hidden, true);
            if (phaseSteps.length) assert.equal(elements.get("phase-args").value, "Keep my plan draft");
            snapshot.phaseInputs[constitution.instanceKey] = { label: "Principles", helper: "Describe the governance changes.", optional: false };
            await events.onmessage();
            await new Promise((resolve) => setTimeout(resolve, 10));
            await elements.get("run-constitution").emit("click");
            assert.match(elements.get("modal-root").innerHTML, /placeholder="Describe the governance changes."/);
            elements.get("constitution-guidance").value = "Keep tests mandatory";
            await elements.get("confirm-constitution").emit("click");
            assert.deepEqual(requests.at(-1).input, { phase: constitution.instanceKey, args: "Keep tests mandatory" });
            if (phaseSteps.length) assert.equal(elements.get("phase-args").value, "Keep my plan draft");
            // Removing the descriptor restores legacy behavior; disk status alone must not promote a card.
            delete snapshot.pipeline.projectArtifacts;
            await events.onmessage();
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.equal(elements.get("constitution-card").hidden, true);
            assert.equal(elements.get("constitution-card").innerHTML, "");
            assert.match(elements.get("phase-navigation").innerHTML, /Constitution/);
        }
    });

    test("approval panel uses exact scoped components and preserves all existing phase and collection UI", async () => {
        const elements = new Map();
        globalThis.document = {
            documentElement: { dataset: {} },
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, fakeElement());
                return elements.get(id);
            },
        };
        globalThis.localStorage = { getItem() { return null; }, setItem() {} };
        let events;
        globalThis.EventSource = class { constructor() { events = this; } };
        const approval = {
            required: true, approved: false, state: "pending", fingerprint: "contract", challenge: "review",
            components: [
                { kind: "preset", id: "questions", installed: true, enabled: true, priority: 27, precedence: 3, source: { name: "community", url: "https://example.test/questions.zip" } },
                { kind: "extension", id: "<assess>", source: { name: "unsafe", url: "javascript:alert(1)" } },
            ],
        };
        const snapshot = {
            setup: { ready: true }, selectedItemId: "__new__",
            pipeline: {
                metadata: { workflowListName: "Assessments" },
                runtime: { multiInstance: true, userProvidesSlug: true, itemRoot: ".specify/assessments/<slug>" },
                pipeline: { steps: [{ index: 0, instanceKey: "intake", label: "Intake", description: "Capture the idea.", artifact: { pathTemplate: ".specify/assessments/<slug>/intake.md" } }] },
            },
            phaseInputs: { intake: { label: "Idea to assess", helper: "Describe the idea.", optional: false } },
            items: [{ id: "__new__", isNew: true, slug: null, label: "New", phases: { intake: { artifact: null } } }],
        };
        const requests = [];
        globalThis.fetch = async (url, options) => {
            if (options?.method === "POST") {
                const input = JSON.parse(options.body);
                requests.push({ url, input });
                if (url === "/api/installation-approval") {
                    approval.state = input.action === "defer" ? "deferred" : "pending";
                    if (input.action === "accept") {
                        approval.approved = true;
                        snapshot.setup.state = "verifying";
                    }
                } else if (url === "/api/setup") {
                    snapshot.setup.state = "verifying";
                }
            }
            return { ok: true, json: async () => structuredClone(options ? { ok: true } : snapshot) };
        };
        const directory = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
        temporaryDirectories.push(directory);
        await Promise.all([
            copyFile(new URL("../generation/generated-canvas-template/ui/app.js", import.meta.url), join(directory, "app.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/command-views.mjs", import.meta.url), join(directory, "command-views.mjs")),
            copyFile(new URL("../shared-workflow-ui/markdown.mjs", import.meta.url), join(directory, "markdown.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarifications.mjs", import.meta.url), join(directory, "clarifications.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarification-controls.mjs", import.meta.url), join(directory, "clarification-controls.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/workflow-slug.mjs", import.meta.url), join(directory, "workflow-slug.mjs")),
        ]);
        await import(pathToFileURL(join(directory, "app.mjs")).href);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const preservedIds = ["phase-card", "phase-navigation", "current-workflow", "instance-collection", "item-picker"];
        const original = Object.fromEntries(preservedIds.map((id) => [id, elements.get(id).innerHTML]));
        assert.equal(elements.get("installation-approval").hidden, true);
        const sourceDetails = fakeElement();
        sourceDetails.dataset.sourceKey = "preset:questions";
        elements.get("installation-approval").querySelectorAll = (selector) => selector === "[data-source-key]" ? [sourceDetails] : [];
        snapshot.setup = { ready: false, state: "approval-required", approval };
        const refresh = async () => {
            await events.onmessage({ data: '{"type":"refresh"}' });
            await new Promise((resolve) => setTimeout(resolve, 10));
        };
        await refresh();
        const panel = elements.get("installation-approval");
        assert.equal(panel.hidden, false);
        assert.match(panel.innerHTML, /questions|&lt;assess&gt;/);
        assert.match(panel.innerHTML, /href="https:\/\/example.test\/questions.zip"/);
        assert.match(panel.innerHTML, /class="installation-component-name"/);
        assert.match(panel.innerHTML, /class="installation-tag">Preset<\/span>/);
        assert.match(panel.innerHTML, /class="installation-tag">Extension<\/span>/);
        assert.equal((panel.innerHTML.match(/class="installation-tag">Community<\/span>/g) ?? []).length, 1);
        assert.equal((panel.innerHTML.match(/<details class="installation-source"/g) ?? []).length, 1);
        assert.match(panel.innerHTML, /<summary>View source<span class="visually-hidden"> for questions/);
        assert.match(panel.innerHTML, /Reviewable source unavailable/);
        assert.doesNotMatch(panel.innerHTML, /priority|precedence|enabled|disabled|Installed in this project|Configured|no reinstall/i);
        sourceDetails.open = true;
        await sourceDetails.emit("toggle");
        await refresh();
        assert.match(panel.innerHTML, /data-source-key="preset:questions" open/);
        sourceDetails.open = false;
        await sourceDetails.emit("toggle");
        await refresh();
        assert.doesNotMatch(panel.innerHTML, /data-source-key="preset:questions" open/);
        assert.doesNotMatch(panel.innerHTML, /javascript:|Approve all or install nothing|Without these components|type="checkbox"/);
        for (const id of preservedIds) assert.equal(elements.get(id).innerHTML, original[id], id);
        elements.get("phase-args").value = "Preserve my draft";
        await elements.get("approval-defer").emit("click");
        assert.match(panel.innerHTML, /Required installation has not been approved/);
        assert.doesNotMatch(panel.innerHTML, /installation-components/);
        assert.equal(elements.get("phase-args").value, "Preserve my draft");
        await elements.get("run-phase").emit("click");
        assert.equal(requests.at(-1).input.action, "review");
        assert.equal(requests.some((entry) => entry.url === "/api/run"), false);
        assert.match(panel.innerHTML, /installation-components/);
        await elements.get("approval-accept").emit("click");
        assert.match(panel.innerHTML, /Installing required components/);
        assert.equal(panel.hidden, false);
        snapshot.setup.state = "failed";
        snapshot.setup.message = "Permission denied <details>";
        await refresh();
        assert.match(panel.innerHTML, /Permission denied &lt;details&gt;/);
        await elements.get("approval-retry").emit("click");
        assert.equal(requests.at(-1).url, "/api/setup");
        assert.match(panel.innerHTML, /Installing required components/);
        snapshot.setup.ready = true;
        await refresh();
        assert.equal(panel.hidden, true);
        assert.equal(panel.innerHTML, "");
        for (const id of preservedIds) assert.equal(elements.get(id).innerHTML, original[id], id);
        snapshot.setup = { ready: false, state: "failed", approval: { required: true, approved: false, error: "Cannot verify required components" } };
        await refresh();
        assert.match(panel.innerHTML, /Cannot verify required components/);
        assert.doesNotMatch(panel.innerHTML, /id="approval-accept"|Approve and install/);
    });

    test("renders the initial workflow snapshot and new-item affordance without runtime errors", async () => {
        const elements = new Map();
        globalThis.document = {
            documentElement: { dataset: {} },
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, fakeElement());
                return elements.get(id);
            },
        };
        globalThis.localStorage = { getItem() { return null; }, setItem() {} };
        globalThis.EventSource = class {
            constructor() {
                this.onopen = null;
                this.onerror = null;
                this.onmessage = null;
            }
        };
        globalThis.fetch = async () => ({
            ok: true,
            async json() {
                return {
                    setup: { ready: true },
                    selectedItemId: "project",
                    pipeline: {
                        pipeline: {
                            steps: [{
                                index: 0,
                                instanceKey: "constitution",
                                label: "Constitution",
                                description: "Define project principles.",
                                optional: true,
                                artifact: { pathTemplate: ".specify/memory/constitution.md" },
                                arguments: { hint: "Pass slug=example and the workspace path." },
                            }],
                        },
                    },
                    items: [{
                        id: "__new__",
                        label: "New workflow item",
                        isNew: true,
                        phases: {
                            constitution: { artifact: null },
                        },
                    }],
                };
            },
        });

        const renderedUi = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
        temporaryDirectories.push(renderedUi);
        await Promise.all([
            copyFile(new URL("../generation/generated-canvas-template/ui/app.js", import.meta.url), join(renderedUi, "app.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/command-views.mjs", import.meta.url), join(renderedUi, "command-views.mjs")),
            copyFile(new URL("../shared-workflow-ui/markdown.mjs", import.meta.url), join(renderedUi, "markdown.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarifications.mjs", import.meta.url), join(renderedUi, "clarifications.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarification-controls.mjs", import.meta.url), join(renderedUi, "clarification-controls.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/workflow-slug.mjs", import.meta.url), join(renderedUi, "workflow-slug.mjs")),
            copyFile(new URL("../shared-workflow-ui/stepper.mjs", import.meta.url), join(renderedUi, "stepper.mjs")),
        ]);
        await import(`${pathToFileURL(join(renderedUi, "app.mjs")).href}?test=${Date.now()}`);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.match(elements.get("phase-navigation").innerHTML, /class="stepper"/);
        assert.match(elements.get("phase-navigation").innerHTML, /Phase 1 of 1: Constitution/);
        assert.match(elements.get("current-workflow").innerHTML, /<h2>New<\/h2>/);
        assert.match(elements.get("phase-card").innerHTML, /Constitution/);
        assert.match(elements.get("phase-card").innerHTML, /id="phase-input-label">Phase input<\/span>/);
        assert.match(elements.get("phase-card").innerHTML, /class="visually-hidden" id="phase-input-help">Add details or direction for this phase\.<\/span>/);
        assert.match(elements.get("phase-card").innerHTML, /placeholder="Add details or direction for this phase\."><\/textarea>/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /Pass slug=|required|id="run-phase"[^>]*disabled/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /%|workflow-progress|step-index/);
    });

    test("keeps item-producing phases concise and always navigable", async () => {
        const elements = new Map();
        globalThis.document = {
            documentElement: { dataset: {} },
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, fakeElement());
                return elements.get(id);
            },
        };
        globalThis.localStorage = { getItem() { return null; }, setItem() {} };
        globalThis.EventSource = class {};
        globalThis.fetch = async () => ({
            ok: true,
            async json() {
                return {
                    setup: { ready: true },
                    selectedItemId: "__new__",
                    phaseInputs: {
                        constitution: {
                            label: "Principles & priorities",
                            helper: 'Focus on "clarity" & shared expectations.',
                            optional: true,
                        },
                        intake: { label: "Idea", helper: "Describe the idea you want to assess.", optional: false },
                    },
                    pipeline: {
                        runtime: {
                            userProvidesSlug: true,
                            itemRoot: ".specify/assessments/<slug>",
                        },
                        pipeline: {
                            steps: [
                                {
                                    index: 0,
                                    instanceKey: "constitution",
                                    label: "Constitution",
                                    description: "Define project principles.",
                                    optional: false,
                                    predecessors: [],
                                    artifact: { pathTemplate: ".specify/memory/constitution.md" },
                                    arguments: {},
                                },
                                {
                                    index: 1,
                                    instanceKey: "intake",
                                    label: "Intake",
                                    description: "Capture the idea.",
                                    optional: false,
                                    predecessors: [0],
                                    artifact: { pathTemplate: ".specify/assessments/<slug>/intake.md" },
                                    arguments: {
                                        hint: "Enter the idea to assess, such as pasted text, a URL, or a codebase pointer.",
                                        whenEmpty: "If left empty, ask the user for the idea.",
                                    },
                                },
                            ],
                        },
                    },
                    items: [{
                        id: "__new__",
                        label: "New workflow item",
                        isNew: true,
                        phases: {
                            constitution: { artifact: null },
                            intake: { artifact: null },
                        },
                    }],
                };
            },
        });

        const renderedUi = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
        temporaryDirectories.push(renderedUi);
        await Promise.all([
            copyFile(new URL("../generation/generated-canvas-template/ui/app.js", import.meta.url), join(renderedUi, "app.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/command-views.mjs", import.meta.url), join(renderedUi, "command-views.mjs")),
            copyFile(new URL("../shared-workflow-ui/markdown.mjs", import.meta.url), join(renderedUi, "markdown.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarifications.mjs", import.meta.url), join(renderedUi, "clarifications.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarification-controls.mjs", import.meta.url), join(renderedUi, "clarification-controls.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/workflow-slug.mjs", import.meta.url), join(renderedUi, "workflow-slug.mjs")),
            copyFile(new URL("../shared-workflow-ui/stepper.mjs", import.meta.url), join(renderedUi, "stepper.mjs")),
        ]);
        await import(`${pathToFileURL(join(renderedUi, "app.mjs")).href}?test=${Date.now()}-new`);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.match(elements.get("phase-card").innerHTML, /<h2>Constitution<\/h2>/);
        assert.match(elements.get("phase-card").innerHTML, /id="phase-input-label">Principles &amp; priorities <span class="muted">\(optional\)<\/span>/);
        assert.match(elements.get("phase-card").innerHTML, /Focus on &quot;clarity&quot; &amp; shared expectations\./);
        assert.match(elements.get("phase-card").innerHTML, /placeholder="Focus on &quot;clarity&quot; &amp; shared expectations\."><\/textarea>/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /Workflow slug|id="workflow-slug"/);
        await elements.get("next-phase").emit("click");
        assert.match(elements.get("phase-card").innerHTML, /id="phase-input-label">Idea<\/span>/);
        assert.match(elements.get("phase-card").innerHTML, /<h2>Intake<\/h2>/);
        assert.match(elements.get("phase-card").innerHTML, /class="tagline">Capture the idea\./);
        assert.match(elements.get("phase-card").innerHTML, /class="visually-hidden" id="phase-input-help">Describe the idea you want to assess\.<\/span>/);
        assert.match(elements.get("phase-card").innerHTML, /aria-labelledby="phase-input-label" aria-describedby="phase-input-help" placeholder="Describe the idea you want to assess\."><\/textarea>/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /class="muted" id="phase-input-help"|Enter the idea to assess|If left empty|required/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /slug=/i);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /phase-input-guidance/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /New workflow item/);
        assert.match(elements.get("phase-card").innerHTML, /Workflow slug <span class="muted">\(optional\)<\/span>/);
        assert.match(elements.get("phase-card").innerHTML, /id="workflow-slug"/);
        assert.match(elements.get("phase-card").innerHTML, /<label class="field" for="workflow-slug"><span class="field-label" id="workflow-slug-label">Workflow slug/);
        assert.match(elements.get("phase-card").innerHTML, /<input class="phase-input-control" id="workflow-slug" type="text"/);
        assert.match(elements.get("phase-card").innerHTML, /Names the folder where this workflow’s artifacts are saved\. Leave blank to let Spec Kit choose a name\./);
        assert.match(elements.get("phase-card").innerHTML, /aria-describedby="workflow-slug-help"/);
        assert.match(elements.get("phase-card").innerHTML, /<textarea class="phase-input-control" id="phase-args"/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /phase-slug|workflow-slug-value|readonly/);
        assert.ok(
            elements.get("phase-card").innerHTML.indexOf('id="phase-args"')
                < elements.get("phase-card").innerHTML.indexOf('id="workflow-slug"'),
        );
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /<dt>Status<\/dt>/);
        assert.match(elements.get("phase-navigation").innerHTML, /Phase 1 of 2: Constitution/);
        assert.match(elements.get("phase-navigation").innerHTML, /Phase 2 of 2: Intake/);
        assert.match(elements.get("phase-navigation").innerHTML, /data-phase-index="0"/);
        assert.match(elements.get("phase-navigation").innerHTML, /data-phase-index="1"/);
        assert.doesNotMatch(elements.get("phase-navigation").innerHTML, /step-status|step-index|<select/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /Create your first workflow item/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /id="run-phase"[^>]*disabled/);
        assert.match(elements.get("phase-card").innerHTML, /◀ Back/);
        assert.match(elements.get("phase-card").innerHTML, /Continue ▶/);
    });

    test("keeps automatic setup implicit and exposes retry only after failure", async () => {
        const elements = new Map();
        globalThis.document = {
            documentElement: { dataset: {} },
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, fakeElement());
                return elements.get(id);
            },
        };
        globalThis.localStorage = { getItem() { return null; }, setItem() {} };
        globalThis.EventSource = class {};
        let failed = false;
        globalThis.fetch = async () => ({
            ok: true,
            async json() {
                return {
                    setup: failed
                        ? { ready: false, state: "failed", message: "Extension assess is missing." }
                        : { ready: false, state: "dispatching", message: "Preparing." },
                    selectedItemId: "project",
                    pipeline: {
                        pipeline: {
                            steps: [{
                                index: 0,
                                instanceKey: "intake",
                                label: "Intake",
                                description: "Capture the idea.",
                                optional: false,
                                artifact: { pathTemplate: ".specify/assessments/<slug>/intake.md" },
                                arguments: {},
                            }],
                        },
                    },
                    items: [{
                        id: "project",
                        label: "Project",
                        phases: { intake: { artifact: null } },
                    }],
                };
            },
        });

        const renderedUi = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
        temporaryDirectories.push(renderedUi);
        await Promise.all([
            copyFile(new URL("../generation/generated-canvas-template/ui/app.js", import.meta.url), join(renderedUi, "app.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/command-views.mjs", import.meta.url), join(renderedUi, "command-views.mjs")),
            copyFile(new URL("../shared-workflow-ui/markdown.mjs", import.meta.url), join(renderedUi, "markdown.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarifications.mjs", import.meta.url), join(renderedUi, "clarifications.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarification-controls.mjs", import.meta.url), join(renderedUi, "clarification-controls.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/workflow-slug.mjs", import.meta.url), join(renderedUi, "workflow-slug.mjs")),
            copyFile(new URL("../shared-workflow-ui/stepper.mjs", import.meta.url), join(renderedUi, "stepper.mjs")),
        ]);
        await import(`${pathToFileURL(join(renderedUi, "app.mjs")).href}?test=${Date.now()}-setup`);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.equal(elements.get("setup-message").hidden, true);
        assert.equal(elements.get("setup-message").innerHTML, "");
        assert.doesNotMatch(elements.get("setup-message").innerHTML, /Retry setup/);
        assert.doesNotMatch(elements.get("phase-navigation").innerHTML, /disabled/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /id="run-phase"[^>]*disabled/);
        await elements.get("run-phase").emit("click");
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.match(elements.get("phase-card").innerHTML, /btn-spinner/);
        assert.match(elements.get("phase-card").innerHTML, /Running…/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /Preparing this workflow/);

        failed = true;
        elements.get("setup-message").innerHTML = "";
        globalThis.fetch = async () => ({
            ok: true,
            async json() {
                return {
                    setup: { ready: false, state: "failed", message: "Extension assess is missing." },
                    selectedItemId: "project",
                    pipeline: {
                        pipeline: {
                            steps: [{
                                index: 0,
                                instanceKey: "intake",
                                label: "Intake",
                                description: "Capture the idea.",
                                optional: false,
                                artifact: { pathTemplate: ".specify/assessments/<slug>/intake.md" },
                                arguments: {},
                            }],
                        },
                    },
                    items: [{
                        id: "project",
                        label: "Project",
                        phases: { intake: { artifact: null } },
                    }],
                };
            },
        });
        const events = new EventSource("/api/events");
        void events;
        // Import a fresh module instance to exercise the failed setup render.
        await import(`${pathToFileURL(join(renderedUi, "app.mjs")).href}?test=${Date.now()}-failed`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.match(elements.get("setup-message").innerHTML, /Extension assess is missing/);
        assert.match(elements.get("setup-message").innerHTML, /Retry setup/);
    });

    test("isolates new workflow runs, resolves output folders, and renders Markdown artifacts", async () => {
        const elements = new Map();
        const phaseCard = fakeElement();
        let phaseCardHtml = "";
        Object.defineProperty(phaseCard, "innerHTML", {
            get() { return phaseCardHtml; },
            set(value) {
                phaseCardHtml = value;
                elements.set("phase-args", fakeElement());
            },
        });
        elements.set("phase-card", phaseCard);
        globalThis.document = {
            documentElement: { dataset: {} },
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, fakeElement());
                return elements.get(id);
            },
        };
        globalThis.localStorage = { getItem() { return null; }, setItem() {} };
        let events;
        globalThis.EventSource = class {
            constructor() { events = this; }
        };
        const step = {
            index: 0,
            instanceKey: "intake",
            label: "Intake",
            description: "Capture the idea.",
            optional: false,
            artifact: { pathTemplate: ".specify/assessments/<slug>/intake.md" },
            arguments: {},
        };
        const newItem = {
            id: "__new__",
            slug: null,
            label: "New workflow",
            isNew: true,
            phases: { intake: { artifact: null } },
        };
        let snapshot = {
            setup: { ready: true },
            selectedItemId: "__new__",
            pipeline: {
                runtime: {
                    userProvidesSlug: true,
                    multiInstance: true,
                    itemRoot: ".specify/assessments/<slug>",
                },
                pipeline: { steps: [step] },
            },
            items: [{
                id: "alpha",
                slug: "alpha",
                label: "Alpha",
                phases: { intake: { artifact: ".specify/assessments/alpha/intake.md" } },
            }, newItem],
        };
        const requests = [];
        globalThis.fetch = async (url, options = {}) => {
            requests.push({ url, options });
            if (url === "/api/state") return { ok: true, async json() { return snapshot; } };
            if (url === "/api/run") return { ok: true, async json() { return { ok: true }; } };
            if (url === "/api/reveal") return { ok: true, async json() { return { ok: true }; } };
            if (url === "/api/workflow/delete") {
                snapshot = {
                    ...snapshot,
                    selectedItemId: "__new__",
                    items: snapshot.items.filter((item) => item.slug !== JSON.parse(options.body).slug),
                };
                return { ok: true, async json() { return { ok: true }; } };
            }
            if (String(url).startsWith("/api/artifact")) {
                return {
                    ok: true,
                    async json() {
                        return { content: "# Intake\n\n- First item\n- **Important** item\n\n[Reference](https://example.com)" };
                    },
                };
            }
            throw new Error(`unexpected request: ${url}`);
        };

        const renderedUi = await mkdtemp(join(tmpdir(), "generated-renderer-test-"));
        temporaryDirectories.push(renderedUi);
        await Promise.all([
            copyFile(new URL("../generation/generated-canvas-template/ui/app.js", import.meta.url), join(renderedUi, "app.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/command-views.mjs", import.meta.url), join(renderedUi, "command-views.mjs")),
            copyFile(new URL("../shared-workflow-ui/markdown.mjs", import.meta.url), join(renderedUi, "markdown.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarifications.mjs", import.meta.url), join(renderedUi, "clarifications.mjs")),
            copyFile(new URL("../shared-workflow-ui/clarification-controls.mjs", import.meta.url), join(renderedUi, "clarification-controls.mjs")),
            copyFile(new URL("../generation/generated-canvas-template/ui/workflow-slug.mjs", import.meta.url), join(renderedUi, "workflow-slug.mjs")),
            copyFile(new URL("../shared-workflow-ui/stepper.mjs", import.meta.url), join(renderedUi, "stepper.mjs")),
        ]);
        await import(`${pathToFileURL(join(renderedUi, "app.mjs")).href}?test=${Date.now()}-multi`);
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.equal(elements.get("instance-collection").hidden, false);
        assert.match(elements.get("instance-collection").innerHTML, /Workflows/);
        assert.match(elements.get("instance-collection").innerHTML, /\+ New<\/button>/);
        assert.match(elements.get("instance-collection").innerHTML, /Alpha/);
        assert.match(elements.get("instance-collection").innerHTML, /data-delete-workflow="alpha"/);
        assert.doesNotMatch(elements.get("instance-collection").innerHTML, /instance-phase-dot|complete|%/);
        assert.equal(elements.get("item-picker").hidden, true);

        for (const [name, escaped] of [["Assessments", "Assessments"], ["People", "People"], ["R&D <Reviews>", "R&amp;D &lt;Reviews&gt;"]]) {
            snapshot = { ...snapshot, pipeline: { ...snapshot.pipeline, metadata: { workflowListName: name } } };
            await events.onmessage?.();
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.ok(elements.get("instance-collection").innerHTML.includes(`<h2>${escaped} <span`));
            assert.doesNotMatch(elements.get("instance-collection").innerHTML, /<Reviews>|New workflow|Search workflows/);
        }
        const originalItems = snapshot.items;
        snapshot = {
            ...snapshot,
            items: [...originalItems, ...Array.from({ length: 8 }, (_, index) => ({
                id: `entry-${index}`, slug: `entry-${index}`, label: `Entry ${index}`, phases: {},
            }))],
        };
        await events.onmessage?.();
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.match(elements.get("instance-collection").innerHTML, /class="visually-hidden">Search<\/span>/);
        assert.match(elements.get("instance-collection").innerHTML, /placeholder="Search…"/);
        snapshot = { ...snapshot, items: originalItems };
        await events.onmessage?.();
        await new Promise((resolve) => setTimeout(resolve, 10));

        await elements.get("workflow-slug").emit("input", { target: { value: "beta" } });
        assert.match(elements.get("browse-output-folder").innerHTML, /\.specify\/assessments\/beta\/intake\.md/);
        assert.equal(elements.get("browse-output-folder").dataset.folderPath, ".specify/assessments/beta");
        await elements.get("browse-output-folder").emit("click");
        const reveal = requests.find((request) => request.url === "/api/reveal");
        assert.deepEqual(JSON.parse(reveal.options.body), { path: ".specify/assessments/beta" });

        elements.get("phase-args").value = "Assess the onboarding idea";
        await elements.get("run-phase").emit("click");
        const runRequest = requests.find((request) => request.url === "/api/run");
        assert.deepEqual(JSON.parse(runRequest.options.body), {
            phase: "intake",
            itemId: "__new__",
            args: "Assess the onboarding idea",
            slug: "beta",
        });
        assert.match(elements.get("phase-card").innerHTML, /Running…/);
        snapshot = {
            ...snapshot,
            items: [snapshot.items[0], {
                id: "beta",
                slug: "beta",
                label: "Beta",
                phases: { intake: { artifact: ".specify/assessments/beta/intake.md" } },
            }, newItem],
        };
        await events.onmessage?.();
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.match(elements.get("phase-card").innerHTML, /\.specify\/assessments\/beta\/intake\.md/);
        assert.match(elements.get("phase-card").innerHTML, /Run again/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /Running…/);
        assert.match(elements.get("current-workflow").innerHTML, /Current selection/);
        assert.match(elements.get("current-workflow").innerHTML, /Beta/);

        await elements.get("view-artifact").emit("click");
        const artifactHtml = elements.get("artifact-viewer").querySelector(".artifact-viewer-body").innerHTML;
        assert.match(artifactHtml, /<h1>Intake<\/h1>/);
        assert.match(artifactHtml, /<ul><li>First item<\/li><li><strong>Important<\/strong> item<\/li><\/ul>/);
        assert.match(artifactHtml, /href="https:\/\/example\.com"/);
        assert.doesNotMatch(artifactHtml, /<pre># Intake/);

        await elements.get("new-workflow").emit("click");
        assert.match(elements.get("phase-card").innerHTML, />Run phase<\/button>/);
        assert.doesNotMatch(elements.get("phase-card").innerHTML, /Run again|Running…/);
        assert.match(elements.get("phase-card").innerHTML, /&lt;slug&gt;/);

        const betaButton = { dataset: { instance: "beta" } };
        await elements.get("instance-collection").emit("click", {
            target: {
                closest(selector) {
                    return selector === "[data-instance]" ? betaButton : null;
                },
            },
        });
        assert.match(elements.get("current-workflow").innerHTML, /Beta/);
        assert.doesNotMatch(elements.get("current-workflow").innerHTML, /Delete workflow/);
        const betaDeleteButton = { dataset: { deleteWorkflow: "beta" } };
        const deletion = elements.get("instance-collection").emit("click", {
            target: {
                closest(selector) {
                    return selector === "[data-delete-workflow]" ? betaDeleteButton : null;
                },
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.match(elements.get("modal-root").innerHTML, /Delete “Beta”\?/);
        assert.match(elements.get("modal-root").innerHTML, /permanently deletes the selected item's directory and all of its artifacts/);
        assert.match(elements.get("modal-root").innerHTML, /id="confirm-delete-workflow" type="button">Delete<\/button>/);
        await elements.get("confirm-delete-workflow").emit("click");
        await deletion;
        assert.ok(requests.some((request) => request.url === "/api/workflow/delete"));
        assert.match(elements.get("current-workflow").innerHTML, /<h2>New<\/h2>/);

        const alphaButton = { dataset: { instance: "alpha" } };
        await elements.get("instance-collection").emit("click", {
            target: {
                closest(selector) {
                    return selector === "[data-instance]" ? alphaButton : null;
                },
            },
        });
        const alphaDeleteButton = { dataset: { deleteWorkflow: "alpha" } };
        const finalDeletion = elements.get("instance-collection").emit("click", {
            target: {
                closest(selector) {
                    return selector === "[data-delete-workflow]" ? alphaDeleteButton : null;
                },
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await elements.get("confirm-delete-workflow").emit("click");
        await finalDeletion;
        assert.match(elements.get("instance-collection").innerHTML, /<p class="workflow-empty">Start your first workflow below\.<\/p>/);
        assert.doesNotMatch(elements.get("instance-collection").innerHTML, /Nothing here yet|Select New to get started/);
        assert.match(elements.get("instance-collection").innerHTML, /\+ New<\/button>/);
        await elements.get("new-workflow").emit("click");
        assert.match(elements.get("current-workflow").innerHTML, /<h2>New<\/h2>/);
    });
});
