// Tests for prompts.mjs — only the pure structural checks that are NOT
// covered by the module-seam integration tests.
//
// Everything phrase/regex/substring on the emitted prompt body has been
// dropped; the integration tests (S1×S2 dispatchable, S2 phase-id
// contract, S2 executionReports vocabulary, S3×S2 http-roundtrip) exercise
// the real data contract between prompt builder → agent → state-store,
// and would fail on the same regressions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildPrompt,
    UnknownActionKindError,
    buildWorkflowSlashCommand,
    phaseIdForCommandName,
    _internal,
} from "../prompts.mjs";

const CTX = { workspacePath: "C:/Users/me/proj" };

test("buildPrompt throws UnknownActionKindError for unknown kind", () => {
    // The prompt builder is the dispatch table's endpoint — any unknown
    // kind must throw a typed error so the server can 400 on it rather
    // than silently emit an empty prompt to the agent.
    assert.throws(
        () => buildPrompt("bogus.kind", {}, CTX),
        (e) => e instanceof UnknownActionKindError && e.code === "UNKNOWN_KIND",
    );
});

test("buildPrompt embeds the form payload as parseable JSON", () => {
    // The prompt is the wire between the UI form and the agent — the agent
    // must be able to JSON.parse the payload block. We assert only the
    // structural round-trip, not the surrounding copy.
    const payload = { principles: "Testing first", flag: true, nested: { count: 3 } };
    const p = buildPrompt("constitution", payload, CTX);
    // Find any JSON object in the prompt whose structure matches our
    // payload. This test would fail if the prompt builder ever stopped
    // JSON-encoding the payload, without needing to know the exact
    // wrapping copy.
    const roundTrip = _internal.fmtPayload(payload);
    const parsed = JSON.parse(roundTrip);
    assert.deepEqual(parsed, payload);
    assert.ok(p.includes(roundTrip), "prompt body must embed the JSON payload verbatim");
});

test("buildWorkflowSlashCommand normalizes command names to hyphen form", () => {
    // Pure string-transform contract: dot ↔ hyphen, leading slash tolerated,
    // multi-segment extension commands preserved, non-speckit rejected.
    assert.equal(
        buildWorkflowSlashCommand({ commandName: "speckit.constitution" }),
        "/speckit-constitution",
    );
    assert.equal(
        buildWorkflowSlashCommand({ commandName: "/speckit-plan", args: "extra" }),
        "/speckit-plan extra",
    );
    assert.equal(
        buildWorkflowSlashCommand({ commandName: "speckit.foo.bar" }),
        "/speckit-foo-bar",
    );
    // Non-speckit commands are rejected — the wizard only speaks
    // speckit-* slash commands.
    assert.throws(() => buildWorkflowSlashCommand({ commandName: "other.command" }));
    assert.throws(() => buildWorkflowSlashCommand({ commandName: "" }));
});

test("phaseIdForCommandName distinguishes canonical, extension, and junk", () => {
    // Positive canonical mapping is covered end-to-end by the S2 phase-id
    // contract integration test (which iterates every canonical command);
    // this test guards the two branches integration doesn't reach:
    // extension commands (multi-segment slug) return null, and junk input
    // returns null.
    assert.equal(phaseIdForCommandName("speckit.extension.custom-thing"), null);
    assert.equal(phaseIdForCommandName("speckit-extension-custom-thing"), null);
    assert.equal(phaseIdForCommandName(""), null);
    assert.equal(phaseIdForCommandName(null), null);
    assert.equal(phaseIdForCommandName("nothing-speckit-here"), null);
});
