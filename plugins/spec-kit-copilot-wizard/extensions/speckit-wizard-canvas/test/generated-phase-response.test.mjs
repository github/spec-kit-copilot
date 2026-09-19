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

test("missing correlation and oversized replies are diagnostics, not invented response text", () => {
    assert.match(phaseResponse([event("user.message", { messageId: "phase" })], "phase").error, /associated/);
    assert.equal(phaseResponse([user("phase"), user("another", "phase")], "phase"), null);
    const result = phaseResponse([user("phase"), start("phase"), reply("phase", "x".repeat(RESPONSE_LIMIT + 1)), end()], "phase");
    assert.equal(result.response, null);
    assert.match(result.error, /64 KiB/);
});

test("steering and background continuations select the latest reply, not the first final answer", () => {
    const events = [user("phase"), start("phase"),
        reply("phase", "Starting the specification", { phase: "commentary", toolRequests: [{ name: "task" }] }), end(),
        start("phase", "5"), event("user.message", {
            messageId: "navigation", interactionId: "phase", turnId: "5", delivery: "steering",
            content: "Open the canvas",
        }), end("5"),
        start("phase", "6"), reply("phase", "Canvas open; validation is still running.", { turnId: "6", phase: "final_answer" }), end("6")];
    assert.equal(phaseResponse(events, "phase").response, "Canvas open; validation is still running.");
    events.push(start("phase", "1"), reply("phase", "Created and validated the specification. 17/17 checks passed.",
        { turnId: "1", phase: "final_answer" }), end("1"));
    assert.equal(phaseResponse(events, "phase").response, "Created and validated the specification. 17/17 checks passed.");
    assert.equal(phaseResponse(events.slice(0, -1), "phase").response, "Canvas open; validation is still running.",
        "a reply without its turn end does not replace the last complete reply");
});

test("a later App completion replaces an earlier reply without admitting unrelated or child replies", () => {
    const events = [user("phase"), start("phase"), reply("phase", "Waiting for validation."), end(),
        start("phase", "1"), event("session.task_complete", { summary: "Validation passed.", success: true }), end("1"),
        event("session.task_complete", { summary: "Child result", success: true }, { agentId: "child" }),
        user("other"), start("other"), reply("other", "Unrelated reply"), end()];
    assert.deepEqual(phaseResponse(events, "phase"), { response: "Validation passed.", error: null });
});
