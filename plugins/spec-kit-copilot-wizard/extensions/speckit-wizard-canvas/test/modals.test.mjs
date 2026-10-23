import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as runtime from "../ui/phase-runtime.js";
import { clarificationBatchWithinBudget, flushClarifications, openCommunityInstallModal, setViewersDeps } from "../ui/modals.js";
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

describe("wizard modals", () => {
    beforeEach(() => {
        installLocalStorage();
        clearClarifications("speckit.plan");
        clearPhaseRunning("speckit.plan");
    });

    test("community warning preserves Catalogs install copy and supports designer selection", () => {
        const previousDocument = globalThis.document;
        const previousWindow = globalThis.window;
        const backdrop = { inert: false, ariaHidden: false };
        const trigger = { isConnected: true, focus() {
            assert.equal(backdrop.inert, false);
            assert.equal(backdrop.ariaHidden, false);
            document.activeElement = this;
        } };
        const nodes = new Map();
        const listeners = new Map();
        const element = () => {
            const handlers = new Map();
            return {
                hidden: false,
                cloneNode() { return element(); },
                replaceWith(replacement) {
                    for (const [id, node] of nodes) if (node === this) nodes.set(id, replacement);
                },
                addEventListener(type, handler) { handlers.set(type, handler); },
                click() { handlers.get("click")?.(); },
                focus() { document.activeElement = this; },
            };
        };
        for (const id of ["#cim-title-text", "#cim-preset-name", "#cim-kind-word",
            "#cim-learn-link", "#cim-action", "#cim-destination", "#cim-confirm"]) {
            nodes.set(id, element());
        }
        const cancel = element();
        const close = element();
        const modal = {
            hidden: true,
            querySelector: (selector) => nodes.get(selector),
            querySelectorAll: (selector) => selector === "[data-modal-close]"
                ? [cancel, close] : [nodes.get("#cim-confirm"), cancel, close, nodes.get("#cim-learn-link")],
        };
        const document = {
            activeElement: trigger,
            getElementById: (id) => id === "community-install-modal" ? modal : null,
            addEventListener(type, handler) { listeners.set(type, handler); },
            removeEventListener(type) { listeners.delete(type); },
        };
        globalThis.document = document;
        globalThis.window = { confirm: () => false };
        let confirmed = 0;
        let cancelled = 0;
        try {
            openCommunityInstallModal({
                displayName: "Design extension", kind: "extension", designerSession: true,
                afterFocus: () => {
                    assert.equal(document.activeElement, nodes.get("#cim-confirm"));
                    backdrop.inert = true;
                    backdrop.ariaHidden = true;
                },
                beforeRestoreFocus: () => { backdrop.inert = false; backdrop.ariaHidden = false; },
                onConfirm: () => confirmed++, onCancel: () => cancelled++,
            });
            assert.equal(modal.hidden, false);
            assert.equal(backdrop.inert, true);
            assert.equal(backdrop.ariaHidden, true);
            assert.equal(nodes.get("#cim-title-text").textContent, "Select community extension?");
            assert.equal(nodes.get("#cim-action").textContent, "You are about to select");
            assert.equal(nodes.get("#cim-destination").textContent,
                "This selection will be installed in the launched Canvas designer session.");
            assert.equal(nodes.get("#cim-confirm").textContent, "Select anyway");
            assert.equal(nodes.get("#cim-learn-link").href,
                "https://github.com/github/spec-kit/blob/main/extensions/README.md");
            listeners.get("keydown")({ key: "Escape", preventDefault() {} });
            assert.equal(cancelled, 1);
            assert.equal(modal.hidden, true);
            assert.equal(document.activeElement, trigger);
            assert.equal(listeners.size, 0);

            openCommunityInstallModal({
                displayName: "Design extension", kind: "extension", designerSession: true,
                afterFocus: () => { backdrop.inert = true; backdrop.ariaHidden = true; },
                beforeRestoreFocus: () => { backdrop.inert = false; backdrop.ariaHidden = false; },
                onConfirm: () => confirmed++, onCancel: () => cancelled++,
            });
            nodes.get("#cim-confirm").click();
            assert.equal(confirmed, 1);
            assert.equal(document.activeElement, trigger);
            assert.equal(backdrop.inert, false);
            assert.equal(backdrop.ariaHidden, false);

            openCommunityInstallModal({
                displayName: "Catalog bundle", kind: "bundle", onConfirm: () => confirmed++,
            });
            assert.equal(nodes.get("#cim-title-text").textContent, "Install community bundle?");
            assert.equal(nodes.get("#cim-destination").hidden, true);
            assert.equal(nodes.get("#cim-action").textContent, "You are about to install");
            assert.equal(nodes.get("#cim-confirm").textContent, "Install anyway");
            nodes.get("#cim-confirm").click();
            assert.equal(confirmed, 2);
            assert.equal(modal.hidden, true);
            assert.equal(listeners.size, 0);
        } finally {
            globalThis.document = previousDocument;
            globalThis.window = previousWindow;
        }
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

test("review clarification preflight uses the advertised UTF-8 byte budget", () => {
    const answers = [{ questionId: "question_scope", question: "Which scope?", answer: "Unicode: ✓" }];
    const bytes = Buffer.byteLength(JSON.stringify(answers), "utf8");
    assert.equal(clarificationBatchWithinBudget(answers, bytes), true);
    assert.equal(clarificationBatchWithinBudget(answers, bytes - 1), false);
    assert.equal(clarificationBatchWithinBudget(answers, undefined), false);
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
