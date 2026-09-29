import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { flushClarifications, openCommunityInstallModal, setViewersDeps } from "../ui/modals.js";
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
