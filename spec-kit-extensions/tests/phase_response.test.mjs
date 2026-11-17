import assert from "node:assert/strict";
import { test } from "node:test";
import { phaseInteractions, phaseResponse, phaseTurnState } from "../extension-canvas-design/generated-scaffold/phase-response.mjs";
import { freshState, validateWorkflowState, validatePendingRemoval } from
    "../extension-canvas-design/generated-scaffold/contracts/workflow-state.mjs";

test("saved recovery status accepts existing state and rejects incompatible values", () => {
    const phases = [{ id: "specify" }];
    const state = freshState();
    state.runs.push({ runId: "run", phase: "specify", item: "__new__:1", sessionId: "session",
        instanceId: "canvas", args: "", before: [], status: "Completed", artifact: null, messageId: "msg" });
    assert.equal(validateWorkflowState(state, phases, []), state);
    state.runs[0].status = "Run output unconfirmed";
    assert.equal(validateWorkflowState(state, phases, []), state);
    state.runs[0].status = "Needs deletion";
    assert.throws(() => validateWorkflowState(state, phases, []), /Saved canvas state is invalid/);
});

test("saved stop evidence is optional and accepts only an Autopilot run's ISO timestamp", () => {
    const phases = [{ id: "specify" }];
    const state = freshState();
    const run = { runId: "run", autopilotId: "automation", phase: "specify", item: "specs/demo",
        sessionId: "session", instanceId: "canvas", args: "", before: [],
        status: "Unconfirmed", artifact: null, messageId: "msg" };
    state.runs.push(run);
    assert.equal(validateWorkflowState(state, phases, []), state);
    run.stoppedAt = "2026-11-13T01:00:00.000Z";
    assert.equal(validateWorkflowState(JSON.parse(JSON.stringify(state)), phases, []).runs[0].stoppedAt,
        run.stoppedAt);
    for (const invalid of [null, true, 123, "", "not-a-date", "2026-02-30T01:00:00.000Z"]) {
        run.stoppedAt = invalid;
        assert.throws(() => validateWorkflowState(state, phases, []), /Saved canvas state is invalid/);
    }
    run.stoppedAt = "2026-11-13T01:00:00.000Z";
    delete run.autopilotId;
    assert.throws(() => validateWorkflowState(state, phases, []), /Saved canvas state is invalid/);
});

test("pending removal contract permits explicit discard but rejects incompatible confirmations", () => {
    assert.deepEqual(validatePendingRemoval({ itemId: "__new__:1", revision: 3 }),
        { itemId: "__new__:1", revision: 3 });
    assert.deepEqual(validatePendingRemoval({ itemId: "__new__:1", revision: 3, confirmation: "discard" }),
        { itemId: "__new__:1", revision: 3, confirmation: "discard" });
    for (const input of [{ itemId: "__new__:1", revision: 3, confirmation: true },
        { itemId: "__new__:1", revision: 3, confirmation: "delete" },
        { itemId: "__new__:1", revision: 3, extra: true }]) {
        assert.throws(() => validatePendingRemoval(input), /Invalid unstarted workflow removal/);
    }
});

test("a live turn is distinguished from a completed or missing turn", () => {
    const events = [
        { type: "user.message", data: { messageId: "sent", interactionId: "run" } },
        { type: "assistant.turn_start", data: { interactionId: "run", turnId: "turn" } },
    ];
    assert.deepEqual(phaseTurnState(events, "sent"), { active: true, ended: false });
    assert.deepEqual(phaseTurnState(events, "other"), { active: false, ended: false });
    events.push({ type: "assistant.turn_end", data: { turnId: "turn" } });
    assert.deepEqual(phaseTurnState(events, "sent"), { active: false, ended: true });
    events.push({ type: "assistant.turn_start",
        data: { interactionId: "run", turnId: "next-turn" } });
    assert.deepEqual(phaseTurnState(events, "sent"), { active: true, ended: false });
});

test("task completion after a tool-using turn records success", () => {
    const events = [
        { type: "user.message", data: { messageId: "sent", interactionId: "run" } },
        { type: "assistant.turn_start", data: { interactionId: "run", turnId: "turn" } },
        { type: "tool.execution_start", data: { turnId: "turn" } },
        { type: "assistant.turn_end", data: { turnId: "turn" } },
        { type: "session.task_complete", data: { success: true, summary: "Finished" } },
    ];
    assert.deepEqual(phaseResponse(events, "sent"), {
        response: "Finished", error: null, success: true,
    });
});

test("task completion rejects explicit IDs belonging to another interaction or turn", () => {
    for (const replay of [false, true]) {
        for (const ended of [false, true]) {
            for (const success of [true, false]) {
                for (const mismatch of [{ interactionId: "unrelated" }, { turnId: "unrelated" }]) {
                    const interactionId = replay ? "replay" : "run";
                    const events = [
                        { type: "user.message", data: { messageId: "sent", interactionId: "run" } },
                        { type: "assistant.turn_start", data: { interactionId, turnId: "turn" } },
                        { type: "assistant.message", data: { interactionId, turnId: "turn",
                            originatingMessageId: "sent", toolRequests: [{ name: "example" }] } },
                        ...(ended ? [{ type: "assistant.turn_end", data: { turnId: "turn" } }] : []),
                        { type: "session.task_complete",
                            data: { interactionId, turnId: "turn", success, summary: "Unrelated", ...mismatch } },
                    ];
                    assert.equal(phaseResponse(events, "sent"), null,
                        JSON.stringify({ replay, ended, success, mismatch }));
                }
            }
        }
    }
});

test("task completion accepts matching and legacy IDs in owned active or ended turns", () => {
    for (const ended of [false, true]) {
        for (const success of [true, false]) {
            for (const ids of [{}, { interactionId: "replay" }, { turnId: "turn" },
                { interactionId: "replay", turnId: "turn" }]) {
                const events = [
                    { type: "user.message", data: { messageId: "sent", interactionId: "run" } },
                    { type: "assistant.turn_start", data: { interactionId: "replay", turnId: "turn" } },
                    { type: "assistant.message", data: { interactionId: "replay", turnId: "turn",
                        originatingMessageId: "sent", toolRequests: [{ name: "example" }] } },
                    ...(ended ? [{ type: "assistant.turn_end", data: { turnId: "turn" } }] : []),
                    { type: "session.task_complete", data: { ...ids, success, summary: "Finished" } },
                ];
                assert.deepEqual(phaseResponse(events, "sent"), success
                    ? { response: "Finished", error: null, success: true }
                    : { response: null, error: "The phase did not complete successfully.", success: false },
                JSON.stringify({ ended, success, ids }));
            }
        }
    }
});

test("task failure after a tool-using turn records failure", () => {
    const events = [
        { type: "user.message", data: { messageId: "sent", interactionId: "run" } },
        { type: "assistant.turn_start", data: { interactionId: "run", turnId: "turn" } },
        { type: "assistant.message", data: { interactionId: "run", turnId: "turn",
            toolRequests: [{ name: "example" }] } },
        { type: "assistant.turn_end", data: { turnId: "turn" } },
        { type: "session.task_complete", data: { success: false } },
    ];
    assert.deepEqual(phaseResponse(events, "sent"), {
        response: null, error: "The phase did not complete successfully.", success: false,
    });

    test("matching message without an interaction ID is a terminal association failure", () => {
        assert.deepEqual(phaseResponse([
            { type: "user.message", data: { messageId: "other" } },
            { type: "user.message", data: { messageId: "sent" } },
        ], "sent"), {
            response: null, error: "The phase response could not be associated with its dispatched message.",
            success: false,
        });
    });
    assert.equal(phaseResponse(events, "another"), null);
});

const sentId = "11b0afe8-41bc-4d54-96b1-831fd894afdd";
const replayEvents = (origin = sentId, replay = "f158f29a-bc39-4d0b-992f-420097364450") => [
    { type: "user.message", data: { messageId: sentId, interactionId: "3e233028-aa56-45fc-95f0-fa732ff411e0" } },
    { type: "system.message", data: { interactionId: replay } },
    { type: "assistant.turn_start", data: { interactionId: replay, turnId: "0" } },
    { type: "assistant.message", data: { interactionId: replay, turnId: "0", originatingMessageId: sentId,
        toolRequests: [{ name: "view" }] } },
    { type: "tool.execution_start", data: { turnId: "0" } },
    { type: "assistant.turn_end", data: { turnId: "0" } },
    { type: "assistant.turn_start", data: { interactionId: replay, turnId: "1" } },
    { type: "assistant.message", data: { interactionId: replay, turnId: "1", originatingMessageId: origin,
        content: "Replayed final reply" } },
    { type: "assistant.turn_end", data: { turnId: "1" } },
];

test("a replayed commit explicitly originating from the dispatched message completes the phase", () => {
    assert.deepEqual(phaseResponse(replayEvents(), sentId),
        { response: "Replayed final reply", error: null, success: true });
    assert.deepEqual(phaseTurnState(replayEvents(), sentId), { active: false, ended: true });
    assert.deepEqual([...phaseInteractions(replayEvents(), sentId)],
        ["3e233028-aa56-45fc-95f0-fa732ff411e0", "f158f29a-bc39-4d0b-992f-420097364450"]);
    const running = replayEvents().slice(0, 5);
    assert.deepEqual(phaseTurnState(running, sentId), { active: true, ended: false });
    assert.equal(phaseResponse(running, sentId), null);
});

test("unrelated, conflicting, missing, or pre-dispatch origins never complete the phase", () => {
    const strip = (events) => events.map((event) => event.type === "assistant.message"
        ? { ...event, data: { ...event.data, originatingMessageId: undefined } } : event);
    const owner = [{ type: "user.message", data: { messageId: "other", interactionId: "f158" } }];
    const early = [{ type: "assistant.turn_start", data: { interactionId: "f158", turnId: "early" } }];
    for (const [name, events] of [
        ["unrelated", replayEvents("other").map((event) => event.type === "assistant.message"
            ? { ...event, data: { ...event.data, originatingMessageId: "other" } } : event)],
        ["conflicting", replayEvents("other")],
        ["missing", strip(replayEvents())],
        ["owned by another user message", [...replayEvents(sentId, "f158"), ...owner]],
        ["seen before dispatch", [...early, ...replayEvents(sentId, "f158")]],
    ]) {
        assert.equal(phaseResponse(events, sentId), null, name);
        assert.deepEqual(phaseTurnState(events, sentId), { active: false, ended: false }, name);
        assert.deepEqual([...phaseInteractions(events, sentId)], ["3e233028-aa56-45fc-95f0-fa732ff411e0"], name);
    }
    assert.deepEqual([...phaseInteractions(replayEvents(), "unknown")], []);
});
