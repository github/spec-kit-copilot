import assert from "node:assert/strict";
import { test } from "node:test";
import { phaseResponse, RESPONSE_LIMIT } from "../generation/generated-canvas-template/phase-response.mjs";

const event = (type, data, extra = {}) => ({ type, data, ...extra });
const user = (messageId, interactionId = messageId) => event("user.message", { messageId, interactionId, turnId: "0" });
const start = (interactionId, turnId = "0") => event("assistant.turn_start", { interactionId, turnId });
const reply = (interactionId, content, extra = {}) => event("assistant.message", { interactionId, turnId: "0", content, ...extra });
const end = (turnId = "0") => event("assistant.turn_end", { turnId });

test("captures the ordinary final reply using the dispatched message identity", () => {
    const text = "Implemented the utility. All 12 tests pass.";
    const events = [user("phase"), start("phase"), reply("phase", text), end(),
        user("classifier"), start("classifier"), reply("classifier", "A different result."), end()];
    assert.deepEqual(phaseResponse(events, "phase"), { response: text, error: null });
    assert.equal(phaseResponse(events, "queued"), null);
});

test("captures the App's actual task_complete reply, not intermediate tool-turn commentary", () => {
    const events = [user("phase"), start("phase"),
        reply("phase", "Starting implementation", { phase: "commentary" }),
        reply("phase", "", { toolRequests: [{ name: "powershell" }] }), end(),
        start("phase", "1"), event("tool.execution_start", { turnId: "1", toolName: "task_complete" }),
        event("session.task_complete", { summary: "Implemented the requested feature.", success: true }), end("1")];
    assert.equal(phaseResponse(events.slice(0, 5), "phase"), null);
    assert.deepEqual(phaseResponse(events, "phase"), { response: "Implemented the requested feature.", error: null });
});

test("turn IDs reused by other interactions and sub-agent replies cannot supply a result", () => {
    const events = [user("phase"), start("phase"),
        event("session.task_complete", { summary: "A subtask passed", success: true }, { agentId: "child" }),
        reply("phase", "Still working", { phase: "commentary" }), end(),
        user("unrelated"), start("unrelated"), event("session.task_complete", { summary: "Unrelated done", success: true }), end()];
    assert.equal(phaseResponse(events, "phase"), null);
});

test("idle, rejected completion, and reasoning are not a final phase response", () => {
    const events = [user("phase"), start("phase"),
        reply("phase", "Private reasoning", { phase: "analysis" }),
        event("session.task_complete", { summary: "Not accepted", success: false }),
        end(), event("session.idle", {})];
    assert.equal(phaseResponse(events, "phase"), null);
});

test("missing correlation, merged requests and oversized replies fail explicitly", () => {
    assert.match(phaseResponse([event("user.message", { messageId: "phase" })], "phase").error, /associated/);
    assert.match(phaseResponse([user("phase"), user("another", "phase")], "phase").error, /Multiple requests/);
    const result = phaseResponse([user("phase"), start("phase"), reply("phase", "x".repeat(RESPONSE_LIMIT + 1)), end()], "phase");
    assert.equal(result.response, null);
    assert.match(result.error, /64 KiB/);
});
