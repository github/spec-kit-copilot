// Cross-module vocabulary contracts.
//
// These tests wire real modules together (no mocks in place of the other
// side) and assert the shape/vocabulary each module hands off matches what
// the receiver accepts. A failure here indicates a real seam drift, NOT
// an implementation detail moving.
//
// Seams covered:
//   S1×S2  - Every action kind in `ACTION_KINDS` must dispatch through
//            `buildPrompt` without throwing (closed enum is truly closed).
//   S1×cat - Every canonical wizard phase in `PHASE_ORDER` maps to a
//            skill named `speckit-<phase>` via `SKILL_BY_KIND`.
//   S2     - Every command name that `phaseIdForCommandName` classifies
//            as canonical must be a phase that `applyPatch` will accept
//            a status update for. (Prompt → agent → state-store contract.)
//   S2     - The CLOSED execution-state vocabulary embedded in the
//            tracking preamble must equal what `normalizeExecutionReports`
//            accepts. Extracted from the prompt body by parsing, not
//            substring-matching.
//   full-state JSON round-trip - Every top-level slice survives
//            JSON.stringify → JSON.parse → normalizeState unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ACTION_KINDS, SKILL_BY_KIND, PHASE_ORDER, PHASE_BY_ID } from "../canvas-runtime/wizard-phases.mjs";
import { buildPrompt, buildWorkflowTrackingPreamble, phaseIdForCommandName } from "../prompts.mjs";
import { normalizeState, applyPatch, normalizeExecutionReports, EXECUTION_STATES } from "../state/store.mjs";

// ---------- S1×S2: every action kind dispatches ----------

test("S1×S2: every ACTION_KIND builds a non-empty prompt without throwing", () => {
    // If a kind ever slips into the enum without a renderBody branch,
    // buildPrompt would throw or return empty. Guards the closed-enum
    // contract from both sides simultaneously.
    for (const kind of ACTION_KINDS) {
        const out = buildPrompt(kind, {}, { workspacePath: "/ws" });
        assert.equal(typeof out, "string", `kind ${kind} must produce a string`);
        assert.ok(out.length > 0, `kind ${kind} produced an empty prompt`);
    }
});

// ---------- S1×catalog: wizard-phase → skill naming contract ----------

test("S1×catalog: every canonical phase in PHASE_ORDER maps to skill 'speckit-<phase>'", () => {
    // The wizard promises "one skill per phase, named after the phase".
    // `setup` and `preset` are meta phases with no single-skill mapping
    // (setup dispatches sub-steps; preset dispatches via composition
    // kinds), so exclude them.
    for (const phaseId of PHASE_ORDER) {
        if (phaseId === "setup" || phaseId === "preset") continue;
        assert.ok(
            Object.prototype.hasOwnProperty.call(SKILL_BY_KIND, phaseId),
            `phase '${phaseId}' has no entry in SKILL_BY_KIND`,
        );
        assert.equal(
            SKILL_BY_KIND[phaseId],
            `speckit-${phaseId}`,
            `phase '${phaseId}' skill must be 'speckit-${phaseId}'`,
        );
    }
});

// ---------- S2: prompt → state-store phase-id contract ----------

test("S2: every canonical command name maps to a phase applyPatch will accept", () => {
    // The tracking preamble (and Run-phase button) tells the agent to
    // call `setPhaseStatus({ phase: <derived-id>, status: "done" })`.
    // If phaseIdForCommandName returns an id state-store rejects, the
    // agent's state write silently no-ops. This is the wire contract
    // that binds prompt-side and store-side together.
    const canonicalNames = [
        "speckit.constitution",
        "speckit-constitution",
        "speckit.specify",
        "speckit.clarify",
        "speckit.checklist",
        "speckit.plan",
        "speckit.tasks",
        "speckit.analyze",
        "speckit.taskstoissues",
        "speckit.implement",
    ];
    for (const cmd of canonicalNames) {
        const phaseId = phaseIdForCommandName(cmd);
        assert.ok(phaseId, `${cmd} must classify as canonical`);
        const before = normalizeState({});
        const after = applyPatch(before, { phases: { [phaseId]: { status: "done" } } });
        assert.equal(
            after.phases?.[phaseId]?.status,
            "done",
            `applyPatch dropped status write for phase '${phaseId}' (command '${cmd}')`,
        );
        // Sanity: the phase must exist in PHASE_BY_ID too, or applyPatch's
        // guard at line 745 would have silently dropped the write.
        assert.ok(PHASE_BY_ID[phaseId], `phase '${phaseId}' missing from PHASE_BY_ID`);
    }
});

// ---------- S2: executionReports vocabulary alignment ----------

test("S2: tracking preamble embeds the same execution-state vocabulary state-store accepts", () => {
    // Both sides must agree on the CLOSED list of allowed state values.
    // Parse the "Allowed state values (CLOSED vocabulary): [...]" line
    // out of the preamble and diff it against EXECUTION_STATES.
    const preamble = buildWorkflowTrackingPreamble({
        commandName: "speckit.plan",
        expectedArtifacts: { templates: ["plan-template"], scripts: [], hooks: [] },
    });
    assert.ok(preamble, "canonical command must produce a preamble");

    const m = preamble.match(/Allowed state values \(CLOSED vocabulary\): (\[[^\]]+\])/);
    assert.ok(m, "preamble must declare its closed-list vocabulary block");
    const embedded = JSON.parse(m[1]);
    assert.deepEqual(
        embedded,
        [...EXECUTION_STATES],
        "preamble's embedded vocabulary must equal EXECUTION_STATES",
    );

    // The receiver side of the contract: normalizeExecutionReports must
    // preserve every state in the shared vocabulary.
    const artifacts = {
        template: Object.fromEntries(EXECUTION_STATES.map((s, i) => [`t${i}`, { state: s }])),
    };
    const normalized = normalizeExecutionReports({
        "commands/speckit.plan": {
            expected: { templates: [], scripts: [], hooks: [] },
            artifacts,
        },
    });
    const kept = Object.keys(normalized["commands/speckit.plan"].artifacts.template);
    assert.equal(kept.length, EXECUTION_STATES.length, "every canonical state must round-trip");
});

// ---------- Full-state JSON round-trip ----------

test("JSON round-trip: state exercising every slice survives stringify/parse/normalize", () => {
    // Non-serializable values sneaking into state (functions, Symbols,
    // class instances, undefined) would silently drop on stringify.
    // Build a state that touches every top-level slice via applyPatch,
    // then round-trip and assert deep equality after normalization.
    let s = normalizeState({});
    s = applyPatch(s, { currentPhase: "plan", preset: "core" });
    s = applyPatch(s, {
        setup: {
            pluginInstalled: true,
            cliInstalled: true,
            projectInitialized: true,
            skillsReloaded: true,
        },
    });
    s = applyPatch(s, {
        phases: {
            constitution: { status: "done", artifactPath: ".specify/memory/constitution.md" },
            specify: { status: "in_progress", formValues: { title: "T" } },
            plan: { status: "empty" },
        },
    });
    s = applyPatch(s, {
        composition: {
            presets: [],
            extensions: [],
            artifacts: [],
            refreshedAt: "2024-01-01T00:00:00Z",
            executionReports: {
                "commands/speckit.plan": {
                    expected: { templates: ["plan-template"], scripts: [], hooks: [] },
                    artifacts: { template: { "plan-template": { state: "executed" } } },
                },
            },
        },
    });
    const roundTripped = normalizeState(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(roundTripped, s, "state must survive JSON round-trip through normalizeState");
});
