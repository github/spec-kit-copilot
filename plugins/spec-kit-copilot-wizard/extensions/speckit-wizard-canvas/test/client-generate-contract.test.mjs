import assert from "node:assert/strict";
import test from "node:test";
import { createClient, handleServerMessage, setMessagesDeps } from "../ui/client.js";
import { state } from "../ui/state.js";

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
    const send = data => source.onmessage({ data: JSON.stringify({ type: "state", data }) });
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
});
