import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { flushClarifications, setViewersDeps } from "../ui/modals.js";
import {
    clearClarifications,
    clearPhaseRunning,
    getPendingClarifications,
    isPhaseRunning,
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

describe("modal clarification flushing", () => {
    beforeEach(() => {
        installLocalStorage();
        clearClarifications("speckit.plan");
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

    test("keeps local running acknowledgement after successful untracked clarification submit", async () => {
        setViewersDeps({
            postJson: async () => ({ queued: true, untracked: true }),
        });

        queueClarification("speckit.plan", "Which scope?", "Only the CLI plugin.");

        const dispatched = await flushClarifications({ commandName: "speckit.plan" });

        assert.equal(dispatched, true);
        assert.equal(isPhaseRunning("speckit.plan"), true);
        clearPhaseRunning("speckit.plan");
    });
});
