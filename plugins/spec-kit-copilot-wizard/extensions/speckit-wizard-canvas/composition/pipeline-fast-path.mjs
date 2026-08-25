// speckit-wizard — deterministic pipeline fast path.
//
// After the CLI (`specify artifact`) hands us the winning artifacts, we
// still need a **pipeline order** for the wizard's Composition tab. Two
// ways to produce one:
//
//   • **Fast path (this file, deterministic, no LLM).** When the active
//     command set is the canonical spine with only `replace` overrides and
//     no new commands, we synthesize the pipeline from the canonical spine
//     directly.
//   • **LLM Stage 2** (`prompts/composition.mjs::inferPipeline`). Needed
//     when an extension adds a non-canonical command or uses `wrap` /
//     `prepend` / `append`, because ordering then depends on prose in the
//     extension's README that only an LLM can interpret.
//
// This module decides which of the two applies.

import {
    CORE_COMMANDS,
    canonicalPipelineIds,
    requiredCanonicalPipelineIds,
} from "../pipeline/canonical.mjs";

const CANONICAL_PIPELINE_IDS = Object.freeze(canonicalPipelineIds());
const CANONICAL_COMMAND_ID_SET = new Set(
    CORE_COMMANDS.map((name) => `commands/${name}`),
);
const REQUIRED_CANONICAL_PIPELINE_IDS = Object.freeze(requiredCanonicalPipelineIds());

/**
 * @param {{ artifacts: Array }} composition
 * @returns {{ canSynthesize: boolean, newCommands: string[], hasStackDirectives: boolean, syntheticPipeline: object | null }}
 */
export function computePipelineFastPath(composition) {
    const artifacts = Array.isArray(composition?.artifacts) ? composition.artifacts : [];
    const activeCommands = new Set(
        artifacts
            .filter((a) => a && a.kind === "command" && typeof a.id === "string")
            .map((a) => a.id),
    );
    const hookTargets = new Set();
    for (const a of artifacts) {
        if (!a || a.kind !== "hook") continue;
        const bindings = Array.isArray(a.hookBindings) && a.hookBindings.length
            ? a.hookBindings
            : (a.hookBinding ? [a.hookBinding] : []);
        for (const b of bindings) {
            const t = b?.targetCommand;
            if (typeof t !== "string" || !t) continue;
            hookTargets.add(t.startsWith("commands/") ? t : `commands/${t}`);
        }
    }
    const newCommands = [...activeCommands]
        .filter((id) => !CANONICAL_COMMAND_ID_SET.has(id))
        .sort();

    // Stack directives — any non-`replace` strategy on a stack layer of a
    // canonical command. Iterates the artifacts array that the CLI path
    // produces.
    let hasStackDirectives = false;
    outer: for (const a of artifacts) {
        if (!a || a.kind === "hook") continue;
        if (a.kind === "command" && !CANONICAL_COMMAND_ID_SET.has(a.id)) continue;
        for (const layer of a.stack ?? []) {
            const s = layer?.strategy;
            if (s === "wrap" || s === "prepend" || s === "append") {
                hasStackDirectives = true;
                break outer;
            }
        }
    }

    const missingRequiredCanonicals = REQUIRED_CANONICAL_PIPELINE_IDS.filter(
        (id) => !activeCommands.has(id),
    );
    const canSynthesize =
        newCommands.length === 0 &&
        !hasStackDirectives &&
        missingRequiredCanonicals.length === 0;

    let syntheticPipeline = null;
    if (canSynthesize) {
        const pipelineIds = CANONICAL_PIPELINE_IDS.filter(
            (id) => activeCommands.has(id) && !hookTargets.has(id),
        );
        syntheticPipeline = {
            shape: "augmented-canonical",
            pipeline: pipelineIds,
            unplaced: [],
            rationale: "Synthesized from canonical spine — no new commands and no stack directives detected.",
            synthetic: true,
        };
    }

    return {
        canSynthesize,
        newCommands,
        hasStackDirectives,
        syntheticPipeline,
    };
}

export { CANONICAL_PIPELINE_IDS, CANONICAL_COMMAND_ID_SET, REQUIRED_CANONICAL_PIPELINE_IDS };
