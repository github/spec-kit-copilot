import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as runtime from "../ui/phase-runtime.js";
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

function draftStore() {
    assert.equal(typeof runtime.createClarificationDraftStore, "function", "T067: revision-bound clarification drafts are missing");
    return runtime.createClarificationDraftStore();
}

const binding = (overrides = {}) => ({
    contextId: "ctx_fixture", artifactId: "artifact_spec", commandName: "speckit.specify",
    revision: `sha256:${"a".repeat(64)}`, questionId: "question_scope", question: "Which scope?", ...overrides,
});

test("review drafts isolate context, artifact, command, revision, and question identity", () => {
    const store = draftStore();
    const first = binding();
    const others = [binding({ contextId: "ctx_other" }), binding({ artifactId: "artifact_plan" }),
        binding({ commandName: "speckit.plan" }), binding({ revision: `sha256:${"b".repeat(64)}` }), binding({ questionId: "question_duplicate" })];
    store.save(first, "Primary answer");
    for (const [index, item] of others.entries()) store.save(item, `Separate ${index}`);
    assert.equal(store.get(first).answer, "Primary answer");
    for (const [index, item] of others.entries()) assert.equal(store.get(item).answer, `Separate ${index}`);
    assert.equal(store.get(first).commandName, "speckit.specify");
});

test("review draft acknowledgements preserve edits made during submission even if text returns to its prior value", () => {
    const store = draftStore();
    const first = binding();
    store.save(first, "Original");
    const submitted = store.begin([first]);
    store.save(first, "Edited");
    store.save(first, "Original");
    store.complete(submitted, { ok: true, untracked: true });
    assert.equal(store.get(first).answer, "Original");
    assert.equal(store.get(first).status, "queued");
    const final = store.begin([first]);
    store.complete(final, { ok: true });
    assert.equal(store.get(first), null);
});

test("review draft failures retain answers and pending submissions block discard and stale reruns", () => {
    const store = draftStore();
    const first = binding();
    store.save(first, "Keep this answer");
    const submitted = store.begin([first]);
    assert.equal(store.isPending(first.contextId), true);
    assert.equal(store.discard(first.contextId), false);
    store.complete(submitted, { ok: false });
    assert.equal(store.get(first).status, "failed");
    assert.equal(store.get(first).answer, "Keep this answer");
    assert.equal(store.isPending(first.contextId), false);
    store.invalidate(first.contextId, first.artifactId, `sha256:${"b".repeat(64)}`);
    assert.equal(store.get(first).status, "stale");
    assert.throws(() => store.begin([first]), /stale/i);
    assert.equal(store.discard(first.contextId), true);
    assert.equal(store.get(first), null);
});

test("review draft discard removes only its own context and never dispatches", () => {
    const store = draftStore();
    const first = binding();
    const other = binding({ contextId: "ctx_other" });
    store.save(first, "First");
    store.save(other, "Other");
    assert.equal(store.discard(first.contextId), true);
    assert.equal(store.get(first), null);
    assert.equal(store.get(other).answer, "Other");
});

test("stale draft recovery requires explicit matching ownership and a new revision", () => {
    const store = draftStore();
    const previous = binding();
    const current = binding({ revision: `sha256:${"b".repeat(64)}` });
    store.save(previous, "Retained answer");
    store.invalidate(previous.contextId, previous.artifactId, current.revision);
    assert.equal(typeof store.recover, "function");
    for (const invalid of [previous, { ...current, contextId: "ctx_other" }, { ...current, artifactId: "artifact_other" },
        { ...current, commandName: "speckit.plan" }, { ...current, question: "Another question?" }]) {
        assert.throws(() => store.recover(previous, invalid, "Confirmed answer"));
        assert.equal(store.get(previous).answer, "Retained answer");
    }
    store.recover(previous, current, "Confirmed answer");
    assert.equal(store.get(previous), null);
    assert.equal(store.get(current).answer, "Confirmed answer");
    assert.equal(store.get(current).status, "queued");
});
