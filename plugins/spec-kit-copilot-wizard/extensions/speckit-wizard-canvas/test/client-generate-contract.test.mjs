import assert from "node:assert/strict";
import test from "node:test";
import { createClient, handleServerMessage, setMessagesDeps } from "../ui/client.js";
import { isSetupComplete } from "../ui/setup.js";
import { state } from "../ui/state.js";

test("UI readiness uses the shared setup contract and respects a running setup step", t => {
    const previousSnapshot = state.snapshot;
    const previousRunning = state.setupRowRunning;
    t.after(() => {
        state.snapshot = previousSnapshot;
        state.setupRowRunning = previousRunning;
    });
    state.setupRowRunning = false;
    state.snapshot = {
        environment: { pluginInstalled: true, cliInstalled: true },
        projectInitialized: true,
        setup: { skillsReloaded: true },
    };
    assert.equal(isSetupComplete(), true);
    state.setupRowRunning = true;
    assert.equal(isSetupComplete(), false);
    state.setupRowRunning = false;
    state.snapshot.setup.skillsReloaded = false;
    assert.equal(isSetupComplete(), false);
});

test("live snapshots validate Generate flags before updating state and report incompatible exchanges", t => {
    const previousDocument = globalThis.document;
    const previousEventSource = globalThis.EventSource;
    const previousSnapshot = state.snapshot;
    const previousPhase = state.currentPhase;
    t.after(() => {
        globalThis.document = previousDocument;
        globalThis.EventSource = previousEventSource;
        state.snapshot = previousSnapshot;
        state.currentPhase = previousPhase;
        setMessagesDeps({ render: () => {} });
    });
    globalThis.document = { getElementById: () => null };
    let source;
    globalThis.EventSource = class {
        constructor() { source = this; }
        close() {}
    };
    let renders = 0;
    const errors = [];
    setMessagesDeps({ render: () => { renders++; } });
    const connection = createClient({
        onMessage: handleServerMessage,
        onError: (path, error) => errors.push({ path, error }),
    }).connectSse();
    t.after(() => connection.close());
    const send = (data, review) => source.onmessage({ data: JSON.stringify({ type: "state", data, review }) });
    for (const snapshot of [
        { featureFlags: { generateCanvas: true } },
        { featureFlags: { generateCanvas: false } },
        {},
    ]) {
        send(snapshot);
        assert.deepEqual(state.snapshot, snapshot);
    }
    assert.equal(renders, 3);
    assert.equal(errors.length, 0);
    const accepted = state.snapshot;
    for (const featureFlags of [null, [], {}, { generateCanvas: "true" }, { generateCanvas: true, extra: false }]) {
        send({ featureFlags });
        assert.equal(state.snapshot, accepted);
    }
    assert.equal(renders, 3);
    assert.equal(errors.length, 5);
    for (const { path, error } of errors) {
        assert.equal(path, "/api/events");
        assert.match(error.message, /featureFlags|generateCanvas/);
    }
    send({ featureFlags: { generateCanvas: true } });
    assert.equal(state.snapshot.featureFlags.generateCanvas, true);
    assert.equal(renders, 4);
    send({ featureFlags: { generateCanvas: false } }, { kind: "artifact-set" });
    assert.equal(state.snapshot.featureFlags.generateCanvas, false);
    const acceptedNotice = state.snapshot;
    for (const notice of [null, {}, { kind: "other" }, { kind: "artifact-set", path: "spec.md" }]) {
        send({ featureFlags: { generateCanvas: true } }, notice);
        assert.equal(state.snapshot, acceptedNotice);
    }
    assert.equal(errors.length, 9);
    assert.match(errors.at(-1).error.message, /artifact review notice/);
});
