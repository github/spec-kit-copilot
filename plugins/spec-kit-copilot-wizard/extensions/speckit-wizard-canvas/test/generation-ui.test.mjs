// Verify Wizard generation controls capture the intended pipeline and destination.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
    defaultGenerationMetadata,
    generationAvailability,
    openGenerationDialog,
    closeGenerationDialog,
    setGenerationDeps,
} from "../ui/generation.js";
import { state } from "../ui/state.js";
import { validateGenerationMetadata } from "../generation/naming.mjs";
import { renderPipelineBanner } from "../ui/phase-runtime.js";

function readySnapshot(overrides = {}) {
    return {
        setup: {
            pluginInstalled: true,
            cliInstalled: true,
            projectInitialized: true,
            skillsReloaded: true,
        },
        pipeline: [{ id: "speckit.assess.intake" }, { id: "speckit.assess.research" }],
        commands: [
            {
                id: "speckit.assess.intake",
                commandName: "speckit.assess.intake",
                shortLabel: "Intake",
                source: "extension:assess",
            },
            {
                id: "speckit.assess.research",
                commandName: "speckit.assess.research",
                shortLabel: "Research",
                source: "extension:assess",
            },
        ],
        ...overrides,
    };
}

describe("generation UI helpers", () => {
    test("defaults naming from a single extension source", () => {
        const metadata = defaultGenerationMetadata(readySnapshot());
        assert.equal(metadata.extensionId, "assess-workflow");
        assert.equal(metadata.displayName, "Assess Workflow");
        assert.equal(metadata.workflowListName, "Workflows");
        assert.equal(metadata.userProvidesSlug, false);
        assert.equal(metadata.requireInstallationApproval, false);
        assert.deepEqual(metadata.resultLabels, []);
        assert.equal(Object.hasOwn(metadata, "multiInstance"), false);
        assert.match(metadata.description, /Intake.*Research/);
    });

    test("uses the highest active provider for mixed-source pipelines", () => {
        const snapshot = readySnapshot({
            commands: [
                ...readySnapshot().commands,
                {
                    id: "plan",
                    commandName: "speckit.plan",
                    shortLabel: "Plan",
                    source: "core",
                },
            ],
            pipeline: [{ id: "speckit.assess.intake" }, { id: "plan" }],
        });
        const metadata = defaultGenerationMetadata(snapshot);
        assert.equal(metadata.extensionId, "assess-workflow");
        assert.equal(metadata.displayName, "Assess Workflow");
        assert.match(metadata.description, /Intake.*Plan/);
    });

    test("prefers the highest-priority active contribution name", () => {
        const snapshot = readySnapshot({
            pipeline: [{ id: "speckit.assess.intake" }, { id: "speckit.plan" }],
            commands: [
                ...readySnapshot().commands,
                { id: "speckit.plan", commandName: "speckit.plan", shortLabel: "Plan", source: "preset:lean" },
            ],
            composition: {
                presets: [{ id: "lean", name: "Lean Delivery", priority: 100 }],
                extensions: [{ id: "assess", name: "Idea Assessment", priority: 10 }],
                artifacts: [
                    {
                        id: "commands/speckit.assess.intake",
                        stack: [{ layer: "extension", active: true, extensionId: "assess", extensionName: "Idea Assessment" }],
                    },
                    {
                        id: "commands/speckit.plan",
                        stack: [{ layer: "preset", active: true, presetId: "lean", presetName: "Lean Delivery" }],
                    },
                ],
            },
        });
        const metadata = defaultGenerationMetadata(snapshot);
        assert.equal(metadata.extensionId, "lean-workflow");
        assert.equal(metadata.displayName, "Lean Delivery Workflow");
        assert.doesNotMatch(metadata.displayName, /generated/i);
    });

    test("disables generation for an empty pipeline", () => {
        const result = generationAvailability(readySnapshot({ pipeline: [] }));
        assert.equal(result.enabled, false);
        assert.match(result.reason, /at least one/i);
    });

    test("requires completed setup", () => {
        const snapshot = readySnapshot({
            setup: {
                pluginInstalled: true,
                cliInstalled: true,
                projectInitialized: true,
                skillsReloaded: false,
            },
        });
        const result = generationAvailability(snapshot);
        assert.equal(result.enabled, false);
        assert.match(result.reason, /reload skills/i);
    });

    test("keeps the generation popup focused on generation options", async () => {
        const source = await readFile(new URL("../ui/generation.js", import.meta.url), "utf8");
        assert.doesNotMatch(source, /Installed setup/);
        assert.doesNotMatch(source, /generation-pipeline/);
        assert.doesNotMatch(source, /No known persistent artifact/);
        assert.doesNotMatch(source, /command\\?\\.artifactPath/);
        assert.doesNotMatch(source, /generation-multi-instance|multiInstance|Show multiple workflows/);
        assert.match(source, /generation-user-provides-slug/);
        assert.match(source, />Lets users specify the slug used as the directory name for generated artifacts\. Otherwise, Spec Kit chooses a default or Copilot may ask the user in the chat session\.<\/small>/);
        assert.match(source, /<input id="generation-require-installation-approval" type="checkbox" aria-labelledby="generation-approval-label" aria-describedby="generation-approval-help" \/>/);
        assert.match(source, />Require installation approval<\/strong>/);
        assert.match(source, />Ask users to approve all included presets and extensions before installation\. Otherwise, the app automatically installs missing components without asking for installation approval\.<\/small>/);
        assert.match(source, /<div class="wizard-modal-body">\s*<label class="wizard-modal-field" for="generation-target">/);
        assert.doesNotMatch(source, /generation-example|Run once|run the full pipeline|Example artifacts available/);
        assert.match(source, /Examples: Go \/ Kill, or Implemented \/ Partially implemented \/ Not implemented/);
        assert.match(source, /Clarification needed is built in/);
        assert.doesNotMatch(source, /submit\.disabled\s*=/, "preflight checks and submissions do not disable Generate");
        assert.equal((source.match(/id="generation-target"/g) ?? []).length, 1);
        assert.match(source, />Canvas workflow header<\/span>/);
        assert.match(source, />Text displayed as the workflow collection heading, such as Assessments or Bugs\.<\/span>/);
        assert.match(source, />Text displayed as the canvas title\.<\/span>/);
        assert.match(source, />The canvas displays result counts for the workflow based on these labels\.<\/p>/);
        assert.doesNotMatch(source, /Copilot checks|Leave both blank to use standard artifact and clarification indicators/);
        assert.match(source, /Result label \$\{index \+ 1\}/);
        assert.match(source, /aria-describedby="generation-results-help generation-results-examples/);
        assert.doesNotMatch(source, /Workflow list name|What should this canvas|Singular name|Plural name|generation-target-row/);
        for (const id of ["target", "extension-id", "display-name", "workflow-list-name", "description"]) {
            const field = source.match(new RegExp(`<label class="wizard-modal-field" for="generation-${id}">([\\s\\S]*?)</label>`))?.[1];
            assert.ok(field, `Missing field: ${id}`);
            const label = field.indexOf(`id="generation-${id}-label"`);
            const help = field.indexOf(`id="generation-${id}-help"`);
            const control = field.search(/<(?:input|textarea)\b/);
            assert.ok(label >= 0 && help > label && control > help, `Expected label, description, control: ${id}`);
            assert.ok(field.slice(control).includes(`aria-labelledby="generation-${id}-label"`));
            assert.ok(field.slice(control).includes(`aria-describedby="generation-${id}-help"`));
        }
        const target = source.match(/<input id="generation-target"[^>]*>/)?.[0];
        assert.match(target, /class="wizard-modal-input"/);
        assert.match(target, /\breadonly\b/);
        assert.doesNotMatch(target, /\bdisabled\b/);
    });

    test("keeps generation status on the button without adjacent result text", () => {
        const savedDocument = globalThis.document;
        const savedSnapshot = state.snapshot;
        const savedTab = state.activeTab;
        const banner = { innerHTML: "", querySelector: () => null };
        try {
            globalThis.document = { getElementById: (id) => id === "pipeline-banner" ? banner : null };
            state.activeTab = "phases";
            for (const status of ["queued", "generating", "succeeded", "failed"]) {
                state.snapshot = readySnapshot({
                    generation: { state: status, target: "output-marker", error: "error-marker", message: "message-marker" },
                });
                renderPipelineBanner();
                assert.doesNotMatch(banner.innerHTML, /generation-status|output-marker|error-marker|message-marker/);
                const button = banner.innerHTML.match(/class="btn btn-secondary pipeline-generate"([\s\S]*?)<\/button>/)?.[1];
                assert.ok(button);
                const busy = status === "queued" || status === "generating";
                assert.equal(button.includes("disabled"), busy);
                assert.equal(button.includes('aria-busy="true"'), busy);
                assert.equal((banner.innerHTML.match(/Generating…/g) ?? []).length, busy ? 1 : 0);
                assert.ok(button.includes(busy ? "Generating…" : "Generate canvas"));
            }
        } finally {
            globalThis.document = savedDocument;
            state.snapshot = savedSnapshot;
            state.activeTab = savedTab;
        }
    });

    test("pipeline utilities stay visible, neutral and ordered with Generate last", () => {
        const savedDocument = globalThis.document;
        const savedSnapshot = state.snapshot;
        const savedTab = state.activeTab;
        const banner = { innerHTML: "", querySelector: () => null };
        try {
            globalThis.document = { getElementById: (id) => id === "pipeline-banner" ? banner : null };
            state.activeTab = "phases";
            for (const pipeline of [readySnapshot().pipeline, [], undefined]) {
                state.snapshot = readySnapshot({ pipeline });
                renderPipelineBanner();
                const buttons = [...banner.innerHTML.matchAll(/<button type="button" class="btn btn-secondary pipeline-(clear|reset|generate)"([^>]*)>([\s\S]*?)<\/button>/g)];
                assert.deepEqual(buttons.map((entry) => entry[1]), ["clear", "reset", "generate"]);
                assert.deepEqual(buttons.map((entry) => entry[3].trim()), ["Clear", "Reset to default", "Generate canvas"]);
                assert.equal(buttons[0][2].includes("disabled"), false);
                assert.equal(buttons[1][2].includes("disabled"), false);
                assert.doesNotMatch(banner.innerHTML, /btn-primary|btn-ghost|project canvas/i);
            }
        } finally {
            globalThis.document = savedDocument;
            state.snapshot = savedSnapshot;
            state.activeTab = savedTab;
        }
    });

    test("validates list names without inflection or capitalization changes", () => {
        const metadata = defaultGenerationMetadata(readySnapshot());
        for (const name of ["Assessments", "People", "eBay APIs", "R&D <Reviews>", "x".repeat(80)]) {
            const result = validateGenerationMetadata({ ...metadata, workflowListName: name });
            assert.deepEqual(result.errors, []);
            assert.equal(result.metadata.workflowListName, name);
        }
        assert.equal(validateGenerationMetadata({ ...metadata, workflowListName: undefined }).metadata.workflowListName, "Workflows");
        for (const name of ["", " ", "x".repeat(81), "First\nSecond", "a\u0000b", "a\u2028b", 42, null, [], {}]) {
            const result = validateGenerationMetadata({ ...metadata, workflowListName: name });
            assert.ok(result.errors.some((error) => error.field === "workflowListName"));
        }
    });

    test("validates a bounded result list without changing its wording", () => {
        const metadata = defaultGenerationMetadata(readySnapshot());
        for (const resultLabels of [undefined, null, [], [" ", " "]]) {
            const result = validateGenerationMetadata({ ...metadata, resultLabels });
            assert.deepEqual(result.errors, []);
            assert.deepEqual(result.metadata.resultLabels, []);
        }
        const labels = ["  Ready to implement  ", "Not implemented"];
        const normalized = validateGenerationMetadata({ ...metadata, resultLabels: labels });
        assert.deepEqual(normalized.errors, []);
        assert.deepEqual(normalized.metadata.resultLabels, ["Ready to implement", "Not implemented"]);
        for (const values of [["Go"], ["One", "Two", "Three", "Four", "Five"]]) {
            assert.deepEqual(validateGenerationMetadata({ ...metadata, resultLabels: values }).errors, []);
        }
        for (const resultLabels of [
            {}, "Go", ["One", "Two", "Three", "Four", "Five", "Six"], ["Go", "go"], ["Go", 42],
            ["Not determined"], ["Needs clarification"], [" CLARIFICATION   NEEDED "],
            ["a".repeat(61)], ["One two three four"], ["Go\nNow"],
        ]) {
            const result = validateGenerationMetadata({ ...metadata, resultLabels });
            assert.ok(result.errors.some((error) => error.field === "resultLabels"), JSON.stringify(resultLabels));
        }
    });

    test("sends list name and result settings through preflight and confirmed overwrite", async () => {
        const savedDocument = globalThis.document;
        const savedSnapshot = state.snapshot;
        const elements = new Map();
        const element = (selector) => {
            if (!elements.has(selector)) {
                const listeners = new Map();
                elements.set(selector, {
                    value: "", checked: false, dataset: {}, innerHTML: "",
                    classList: { add() {}, remove() {} },
                    setAttribute() {},
                    addEventListener: (type, handler) => listeners.set(type, handler),
                    emit: (type) => listeners.get(type)?.(),
                });
            }
            return elements.get(selector);
        };
        const root = {
            innerHTML: "",
            querySelector: element,
            querySelectorAll: (selector) => selector === "[data-result-label]"
                ? inputs.filter((input) => Object.hasOwn(input.dataset, "resultLabel"))
                : selector === "[data-remove-result]" ? [] : inputs.filter((input) => !Object.hasOwn(input.dataset, "resultLabel")),
        };
        const metadata = defaultGenerationMetadata(readySnapshot());
        const fields = {
            "extension-id": metadata.extensionId,
            "display-name": metadata.displayName,
            description: metadata.description,
            "workflow-list-name": metadata.workflowListName,
            "result-0": "",
            "result-1": "",
        };
        const inputs = Object.entries(fields).map(([id, value]) => Object.assign(element(`#generation-${id}`), {
            value, ...(id.startsWith("result-") ? { dataset: { resultLabel: "" } } : {}),
        }));
        inputs.push(element("#generation-require-installation-approval"));
        const posts = [];
        try {
            state.snapshot = readySnapshot();
            globalThis.document = { getElementById: () => root };
            setGenerationDeps({
                postJson: async (url, body) => {
                    posts.push({ url, body });
                    return url.endsWith("/preflight")
                        ? { ok: true, targetExists: true, target: { relativeDirectory: `.github/extensions/${body.extensionId}/` } }
                        : { requestId: "example", generation: { state: "queued" } };
                },
            });
            openGenerationDialog();
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(posts[0].body.workflowListName, "Workflows");
            assert.equal(posts[0].body.requireInstallationApproval, false);
            const approval = element("#generation-require-installation-approval");
            approval.checked = true;
            approval.emit("input");
            const target = element("#generation-target");
            assert.equal(target.value, ".github/extensions/assess-workflow/");
            target.value = ".github/extensions/not-an-input/";
            const extensionId = element("#generation-extension-id");
            extensionId.value = "revised-assess-workflow";
            extensionId.emit("input");
            const field = element("#generation-workflow-list-name");
            field.value = "R&D Cases";
            field.emit("input");
            element("#generation-result-0").value = "Implemented";
            element("#generation-result-0").emit("input");
            element("#generation-result-1").value = "Not implemented";
            element("#generation-result-1").emit("input");
            await element("#generation-submit").emit("click");
            assert.equal(posts.at(-1).body.workflowListName, "R&D Cases");
            assert.equal(posts.at(-1).body.requireInstallationApproval, true);
            assert.equal(target.value, ".github/extensions/revised-assess-workflow/");
            assert.equal(Object.hasOwn(posts.at(-1).body, "target"), false);
            assert.equal(element("#generation-submit").dataset.overwrite, "true");
            await element("#generation-submit").emit("click");
            const start = posts.find((post) => post.url.endsWith("/start"));
            assert.equal(start.body.workflowListName, "R&D Cases");
            assert.equal(start.body.overwrite, true);
            assert.equal(start.body.requireInstallationApproval, true);
            assert.equal(start.body.extensionId, "revised-assess-workflow");
            assert.deepEqual(start.body.resultLabels, ["Implemented", "Not implemented"]);
            assert.equal(Object.hasOwn(start.body, "target"), false);
        } finally {
            closeGenerationDialog();
            setGenerationDeps({ postJson: async () => undefined, render: () => {} });
            globalThis.document = savedDocument;
            state.snapshot = savedSnapshot;
        }
    });
});
