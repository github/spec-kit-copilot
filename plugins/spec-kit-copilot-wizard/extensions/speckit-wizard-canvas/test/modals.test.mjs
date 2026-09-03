import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { closeArtifactViewer, flushClarifications, openArtifactViewer, setViewersDeps } from "../ui/modals.js";
import {
    clearClarifications,
    clearPhaseRunning,
    getPendingClarifications,
    getPhaseLastSubmitted,
    queueClarification,
} from "../ui/phase-runtime.js";

function installLocalStorage() {
    const values = new Map();
    globalThis.localStorage = {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
    };
}

function installArtifactViewerDocument() {
    const backButton = { addEventListener() {} };
    const body = {
        innerHTML: "",
        querySelectorAll: () => [],
    };
    const banner = {
        hidden: true,
        innerHTML: "",
        querySelector: () => null,
    };
    const root = {
        hidden: true,
        innerHTML: "",
        querySelector(selector) {
            if (selector === ".artifact-viewer-back") return backButton;
            if (selector === ".artifact-viewer-body") return body;
            if (selector === ".artifact-viewer-clarify-banner") return banner;
            return null;
        },
    };
    globalThis.document = {
        getElementById: (id) => id === "phase-artifact-viewer" ? root : null,
    };
    globalThis.fetch = async () => ({
        ok: true,
        text: async () => "artifact with no clarification markers",
    });
    return { root, banner };
}

describe("modal clarification flushing", () => {
    beforeEach(() => {
        installLocalStorage();
        clearClarifications("speckit.plan");
        clearPhaseRunning("speckit.plan");
    });

    test("deduplicates concurrent flushes for the same command", async () => {
        let resolvePost;
        let postCalls = 0;
        const postedBodies = [];
        setViewersDeps({
            postJson: async (_url, body) => {
                postCalls += 1;
                postedBodies.push(body);
                await new Promise((resolve) => { resolvePost = resolve; });
                return { queued: true };
            },
        });

        queueClarification("speckit.plan", "Which scope?", "Only the CLI plugin.");

        const first = flushClarifications({ commandName: "speckit.plan" });
        const second = flushClarifications({ commandName: "speckit.plan" });

        assert.equal(postCalls, 1);
        resolvePost();
        assert.deepEqual(await Promise.all([first, second]), [true, true]);

        assert.equal(postCalls, 1);
        assert.equal(postedBodies[0].commandName, "speckit.plan");
        assert.match(postedBodies[0].args, /Clarification — Which scope\?\nAnswer: Only the CLI plugin\./);
        assert.equal(getPendingClarifications("speckit.plan").length, 0);
        assert.equal(getPhaseLastSubmitted("speckit.plan"), postedBodies[0].args);

        clearPhaseRunning("speckit.plan");
    });

    test("preserves answers added or edited while flush is in flight", async () => {
        const postedBodies = [];
        setViewersDeps({
            postJson: async (_url, body) => {
                postedBodies.push(body);
                queueClarification("speckit.plan", "Which scope?", "Core and wizard plugins.");
                queueClarification("speckit.plan", "Which tests?", "Focused modal tests.");
                return { queued: true };
            },
        });

        queueClarification("speckit.plan", "Which scope?", "Only the CLI plugin.");

        const dispatched = await flushClarifications({ commandName: "speckit.plan" });

        assert.equal(dispatched, true);
        assert.equal(postedBodies.length, 1);
        assert.match(postedBodies[0].args, /Clarification — Which scope\?\nAnswer: Only the CLI plugin\./);
        assert.deepEqual(getPendingClarifications("speckit.plan"), [
            { question: "Which scope?", answer: "Core and wizard plugins." },
            { question: "Which tests?", answer: "Focused modal tests." },
        ]);

        clearPhaseRunning("speckit.plan");
    });

    test("rejects another flush while the queued rerun is still running", async () => {
        const postedBodies = [];
        setViewersDeps({
            postJson: async (_url, body) => {
                postedBodies.push(body);
                queueClarification("speckit.plan", "Which scope?", "Core and wizard plugins.");
                return { queued: true };
            },
        });

        queueClarification("speckit.plan", "Which scope?", "Only the CLI plugin.");

        const firstDispatched = await flushClarifications({ commandName: "speckit.plan" });
        const secondDispatched = await flushClarifications({ commandName: "speckit.plan" });

        assert.equal(firstDispatched, true);
        assert.equal(secondDispatched, false);
        assert.equal(postedBodies.length, 1);
        assert.deepEqual(getPendingClarifications("speckit.plan"), [
            { question: "Which scope?", answer: "Core and wizard plugins." },
        ]);

        clearPhaseRunning("speckit.plan");
    });

    test("prevents closing from discarding queued answers while flush is in flight", async () => {
        let resolvePost;
        const { root, banner } = installArtifactViewerDocument();
        setViewersDeps({
            postJson: async () => {
                await new Promise((resolve) => { resolvePost = resolve; });
                return undefined;
            },
        });

        await openArtifactViewer({
            commandName: "speckit.plan",
            artifactPath: "specs/example/plan.md",
            id: "plan",
        });
        queueClarification("speckit.plan", "Which scope?", "Only the CLI plugin.");

        const pendingFlush = flushClarifications({ commandName: "speckit.plan" });
        queueClarification("speckit.plan", "Which tests?", "Focused modal tests.");

        const closed = await closeArtifactViewer();

        assert.equal(closed, false);
        assert.equal(root.hidden, false);
        assert.equal(banner.hidden, false);
        assert.match(banner.innerHTML, /Wait for it to finish before closing/);
        assert.deepEqual(getPendingClarifications("speckit.plan"), [
            { question: "Which scope?", answer: "Only the CLI plugin." },
            { question: "Which tests?", answer: "Focused modal tests." },
        ]);

        resolvePost();
        assert.equal(await pendingFlush, false);
        assert.deepEqual(getPendingClarifications("speckit.plan"), [
            { question: "Which scope?", answer: "Only the CLI plugin." },
            { question: "Which tests?", answer: "Focused modal tests." },
        ]);

        clearPhaseRunning("speckit.plan");
    });
});
