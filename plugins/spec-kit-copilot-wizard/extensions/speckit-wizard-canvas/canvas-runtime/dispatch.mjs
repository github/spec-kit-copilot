// Shared prompt-dispatch helpers used by BOTH the UI HTTP handlers and the
// agent-facing canvas actions, so the two entry points can't drift.
//
// Two entry points hit the same underlying "build a prompt + hand it to
// `sessionAdapter().send`" recipe:
//
//   • UI click  → HTTP POST /api/prompt or /api/phase/submit
//                → `server/handlers-phase.mjs::handlePrompt` /
//                  `::dispatchWorkflowCommand`
//   • Agent NL  → canvas action invocation
//                → `canvas-runtime/actions/phase.mjs::runPhase` /
//                  `canvas-runtime/actions/catalog.mjs::addPreset` /
//                  `::addExtension`
//
// Both sides call the helpers below. The UI can't invoke a canvas action
// directly (canvas actions are one-way agent → wizard via MCP), so the HTTP
// handlers stay — they just become thin wrappers around these helpers.
//
// Mirrors the `runSkillsReload` / `handleSkillsReload` split already in
// `server/handlers-ops.mjs`.

import { resolve as pathResolve } from "node:path";
import { readdir } from "node:fs/promises";

import { sessionAdapter } from "./instances.mjs";
import { PHASE_BY_ID } from "./wizard-phases.mjs";
import { activeArtifactsForCommand } from "../pipeline/active-artifacts.mjs";
import { runFastComposition } from "./composition-apply.mjs";
import {
    buildPrompt,
    buildWorkflowSlashCommand,
    buildWorkflowTrackingPreamble,
    phaseIdForCommandName,
} from "../prompts.mjs";
import { beginRun } from "./run-tracker.mjs";

// -------- Section: fire-and-forget send --------
// Fire-and-forget so the caller (HTTP handler or canvas action) can
// acknowledge immediately without blocking on the agent's turn. Errors are
// swallowed — agent-side errors surface in chat, network errors are best
// effort. This matches the semantics both existing paths already used.
export function dispatchPromptToSession({ prompt }) {
    setImmediate(() => {
        try {
            sessionAdapter().send({ prompt }).catch?.(() => {
                // best-effort dispatch; agent-side errors surface in chat
            });
        } catch {
            // best-effort dispatch; agent-side errors surface in chat
        }
    });
}

// -------- Section: disk probe for installed layers --------
// Cheap disk probe so `preset.install` / `extension.install` prompts can
// take a fast path when the project has no installed presets or extensions
// (core-only). Both directories are created by `specify init`; each
// installed layer lives in its own subdirectory. Errors (dir missing,
// permission) → treat as zero. The prompt will just take the full-scan
// path, which is safe.
async function probeInstalledCounts(workspacePath) {
    let installedPresetCount = 0;
    let installedExtensionCount = 0;
    if (!workspacePath) return { installedPresetCount, installedExtensionCount };
    for (const [dir, setter] of [
        [".specify/presets", (n) => (installedPresetCount = n)],
        [".specify/extensions", (n) => (installedExtensionCount = n)],
    ]) {
        try {
            const entries = await readdir(pathResolve(workspacePath, dir), { withFileTypes: true });
            setter(entries.filter((e) => e.isDirectory()).length);
        } catch {
            setter(0);
        }
    }
    return { installedPresetCount, installedExtensionCount };
}

// -------- Section: dispatchKindPrompt --------
// Build a plugin-skill prompt for `kind` and dispatch it to the session.
// Throws `UnknownActionKindError` (from prompts.mjs) if kind is unknown —
// callers convert that into their surface-appropriate error shape (HTTP
// 400 vs. `{ ok: false, error }` action result).
export async function dispatchKindPrompt(inst, kind, payload) {
    const workspacePath = inst?.workspacePath ?? null;

    // Special path for the "Refresh Now" button on the Composition tab.
    // Historically this dispatched an LLM prompt that only completed on the
    // next agent turn — if the agent was busy (or Stage 2 wasn't actually
    // needed), the button's aria-busy spinner never cleared because the
    // "composition" SSE broadcast that clears it never arrived.
    //
    // The fast composition assembler broadcasts `type: "composition"`
    // synchronously via applyComposition, which is exactly what the UI
    // listens for. So we run it eagerly here — the button clears within
    // milliseconds regardless of agent state — and only fall through to
    // the LLM Stage 2 prompt when the assembler reports Stage 2 is needed
    // (novel commands, wraps/prepends/appends directives, etc.).
    if (kind === "composition.refresh") {
        const fast = await runFastComposition(inst, { reason: "refresh-button" });
        if (fast?.ok && !fast.stage2Needed) {
            return { kind, fastComposition: true };
        }
        // Stage 2 needed — fall through and dispatch the LLM prompt below.
        // The fast path still broadcast the presets/extensions/artifacts
        // slice, so the button already cleared; the LLM turn will restamp
        // `inferredPipeline` when it responds.
    }

    const { installedPresetCount, installedExtensionCount } = await probeInstalledCounts(workspacePath);
    const prompt = buildPrompt(kind, payload, {
        workspacePath,
        preset: inst?.state?.preset,
        composition: inst?.state?.composition,
        installedPresetCount,
        installedExtensionCount,
    });
    dispatchPromptToSession({ prompt });
    return { prompt, kind };
}

// -------- Section: dispatchPhaseCommand --------
// Build a raw `/speckit-<phase>` slash command (optionally wrapped with the
// tracking preamble that instructs the agent to call `setPhaseStatus` +
// `reportExecution` on completion) and dispatch it. Used for Run phase /
// Rerun phase clicks in the UI AND the agent's `runPhase` canvas action.
//
// When `track: true`, the wizard prepends a small tracking preamble that
// opens a witness capture window and lists the expected artifacts. When
// false (handoff-style calls), neither the preamble nor the witness are
// engaged. `buildWorkflowTrackingPreamble` returns null for
// extension-namespaced commands (e.g. `speckit.assess.intake`), leaving
// those dispatches unwrapped so extension skills stay preset-agnostic.
export function dispatchPhaseCommand(inst, { commandName, args = "", allowEmpty = true, track = false }) {
    let prompt = buildWorkflowSlashCommand({ commandName, args, allowEmpty });
    if (track) {
        const phaseId = phaseIdForCommandName(commandName);
        const artifactPath = phaseId ? PHASE_BY_ID[phaseId]?.artifact ?? null : null;
        // Derive the closed list of expected artifact IDs from
        // `activeArtifactsForCommand` — the SAME derivation the phase card
        // uses to draw pill rows, so the witness ask and the pill display
        // can never diverge.
        let expectedArtifacts = null;
        try {
            expectedArtifacts = activeArtifactsForCommand(inst?.cachedComposition, commandName);
        } catch { /* best-effort */ }
        const preamble = buildWorkflowTrackingPreamble({ commandName, artifactPath, expectedArtifacts });
        if (preamble) prompt = `${prompt}\n${preamble}`;
    }
    const run = beginRun(commandName);
    dispatchPromptToSession({ prompt });
    return { prompt, commandName, runId: run?.runId, startedAt: run?.startedAt };
}
