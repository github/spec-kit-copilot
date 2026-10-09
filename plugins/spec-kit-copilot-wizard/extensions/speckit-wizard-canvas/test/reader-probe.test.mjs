import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { closeArtifactViewer, openArtifactViewer, openCatalogViewer, openCommandViewer, openFolderBrowser, setViewersDeps } from "../ui/modals.js";
import { state } from "../ui/state.js";

const require = createRequire(new URL("../ui/markdown-reader/package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const phase = { id: "specify", shortLabel: "Specify", commandName: "speckit.specify", artifactPath: "specs/999-canvas-preview-fixture/spec.md" };

async function withDom(run) {
    const dom = new JSDOM("<!doctype html><div id='workflow'><button id='trigger'>View artifact</button></div><div id='phase-artifact-viewer' hidden></div>", { url: "http://127.0.0.1/" });
    const previous = new Map();
    const content = "# Fixture spec\n\n[NEEDS CLARIFICATION: fixture question]";
    const artifact = { id: "artifact_fixture", relativePath: phase.artifactPath, label: "Specify", role: "primary", availability: "available", owningCommand: phase.commandName };
    const values = { window: dom.window, location: dom.window.location, document: dom.window.document, localStorage: dom.window.localStorage, fetch: async (input) => ({
        ok: true, text: async () => content,
        json: async () => ({ ok: true, data: String(input).includes("/api/review/context")
            ? { contextId: "ctx_fixture", generation: 1, primaryArtifactId: artifact.id, items: [artifact] }
            : { artifact, content, revision: `sha256:${"a".repeat(64)}`, byteSize: content.length, sourceKind: "working-tree",
                clarifications: [{ id: "binding_fixture", questionId: "question_fixture", question: "fixture question", artifactId: artifact.id,
                    commandName: phase.commandName, revision: `sha256:${"a".repeat(64)}`, mode: "wizard-batched" }] } }),
    }) };
    for (const [key, value] of Object.entries(values)) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    try { await run(dom.window.document); }
    finally {
        await closeArtifactViewer();
        setViewersDeps({ readerMount: null });
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        dom.window.close();
    }
}

test("Wizard previews pass trusted clarification controls to the reader", async () => {
    await withDom(async (document) => {
        setViewersDeps({ postJson: () => assert.fail("No workflow dispatch."),
            readerMount(element, options) {
                assert.equal(options.clarifications[0].question, "fixture question");
                element.textContent = options.document.content;
                const button = document.createElement("button");
                button.dataset.clarificationId = options.clarifications[0].id;
                element.append(button);
                return { update() {}, unmount() { element.replaceChildren(); } };
            },
        });
        await openArtifactViewer(phase);
        assert.equal(document.querySelectorAll("[data-clarification-id]").length, 1);
        assert.match(document.querySelector(".artifact-viewer-body").textContent, /Fixture spec/);
    });
});

test("Wizard reader uses the existing preview body and returns focus without dispatch", async () => {
    await withDom(async (document) => {
        const trigger = document.getElementById("trigger");
        trigger.focus();
        document.getElementById("workflow").scrollTop = 120;
        state.currentPhase = "specify";
        let mounted;
        let disposed = 0;
        setViewersDeps({
            readerMount(element, options) {
                mounted = { element, options };
                element.textContent = options.document.content;
                return { update() {}, unmount() { disposed++; element.replaceChildren(); } };
            },
            postJson: () => assert.fail("Reading must not dispatch."),
        });
        await openArtifactViewer(phase);
        assert.ok(mounted, "The reader must mount in the existing preview.");
        assert.ok(document.querySelector(".artifact-viewer-body").contains(mounted.element));
        assert.match(mounted.options.document.revision, /^sha256:[0-9a-f]{64}$/);
        assert.equal(mounted.options.document.artifact.relativePath, phase.artifactPath);
        assert.equal(document.querySelectorAll(".clarify-pill").length, 0);
        await closeArtifactViewer();
        assert.equal(disposed, 1);
        assert.equal(document.activeElement, trigger);
        assert.equal(document.getElementById("workflow").scrollTop, 120);
        assert.equal(state.currentPhase, "specify");
    });
});

test("a closed Wizard reader ignores late artifact responses", async () => {
    await withDom(async (document) => {
        let finish;
        globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
        setViewersDeps({ readerMount: () => assert.fail("Closed reader must not mount.") });
        const pending = openArtifactViewer(phase);
        await closeArtifactViewer();
        finish({ ok: true, json: async () => ({ ok: true, data: {} }) });
        await pending;
        assert.equal(document.getElementById("phase-artifact-viewer").hidden, true);
        assert.equal(document.getElementById("phase-artifact-viewer").childNodes.length, 0);
    });
});

test("Wizard keeps script-source and catalog viewers without requiring the Markdown reader", async () => {
    await withDom(async (document) => {
        setViewersDeps({ readerMount: () => assert.fail("Legacy non-Markdown viewers must remain independent."), postJson: () => assert.fail("No workflow dispatch.") });
        globalThis.fetch = async () => ({ ok: true, text: async () => 'Write-Output "Existing script"' });
        await openCommandViewer(".specify/scripts/powershell/setup.ps1", "Setup source");
        assert.ok(document.querySelector(".artifact-viewer-body").textContent.includes("Existing script"));
        await closeArtifactViewer();
        globalThis.fetch = async () => ({ ok: true, text: async () => '{"presets":["existing-preset"]}' });
        await openCatalogViewer("https://example.invalid/catalog.json", "Existing catalog");
        assert.ok(document.querySelector(".artifact-viewer-json").textContent.includes("existing-preset"));
    });
});

test("Wizard folder browser retains its file-selection entry point and workflow return", async () => {
    await withDom(async (document) => {
        const trigger = document.getElementById("trigger");
        trigger.focus();
        const defaultFetch = globalThis.fetch;
        globalThis.fetch = async (input) => String(input).includes("/api/artifact-list")
            ? { ok: true, json: async () => ({ files: [{ name: "spec.md" }] }) } : defaultFetch(input);
        setViewersDeps({ readerMount(element, options) {
            element.textContent = options.document.content;
            return { update() {}, unmount() { element.replaceChildren(); } };
        } });
        await openFolderBrowser(phase, "specs/999-canvas-preview-fixture");
        document.querySelector(".folder-file").click();
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(document.querySelector(".artifact-viewer-body").textContent.includes("Fixture spec"));
        await closeArtifactViewer();
        assert.equal(document.activeElement, trigger);
    });
});
