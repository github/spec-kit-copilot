import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { flushClarifications, setViewersDeps } from "../ui/modals.js";
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
});
