// Shared pre-edit pipeline materialization.
//
// The user-visible pipeline is either (a) the user-authored `snapshot.pipeline`
// array once they've made an edit, or (b) a derived list from the
// composition's inferred pipeline, or (c) the canonical five-phase spine.
//
// The wizard mutates the pipeline from two places — the browser (visual
// rendering) and the server (state persistence). Historically each side
// materialized the pre-edit list from a different source, so click indexes
// on the "unedited" strip did not point at the same phases on the server.
// This module is the single derivation both sides use.

import { CANONICAL_PHASES, CANONICAL_UNSEEDED, canonicalSpine } from "./canonical.mjs";

export const CANONICAL_BY_FULL = Object.fromEntries(
    [...canonicalSpine(), ...CANONICAL_UNSEEDED].map((bare) => [`speckit.${bare}`, bare]),
);

/**
 * Strip a `commands/` prefix and normalize canonical short names.
 * Non-canonical namespaced ids pass through in their bare (post-prefix)
 * form, e.g. `speckit.assess.intake` stays `speckit.assess.intake`.
 */
export function stripCommandsPrefix(id) {
    if (typeof id !== "string") return id;
    const bare = id.startsWith("commands/") ? id.slice("commands/".length) : id;
    return CANONICAL_BY_FULL[bare] ?? bare;
}

/**
 * Collect bare ids of every command that appears as a hook target in the
 * composition. Hook targets are auto-dispatched by the runtime and must not
 * clutter the manually-authored pipeline.
 */
function hookTargetIds(composition) {
    const arts = Array.isArray(composition?.artifacts) ? composition.artifacts : [];
    const out = new Set();
    for (const a of arts) {
        if (a?.kind !== "hook") continue;
        const bindings = Array.isArray(a.hookBindings) && a.hookBindings.length
            ? a.hookBindings
            : (a.hookBinding ? [a.hookBinding] : []);
        for (const b of bindings) {
            const target = b?.targetCommand;
            if (typeof target === "string" && target.length) {
                out.add(stripCommandsPrefix(target));
            }
        }
    }
    return out;
}

/**
 * Derive the effective pipeline phases shown to the user when the pipeline
 * has NOT yet been edited. Both the wizard UI and the server pipeline
 * mutation handler must materialize the same list so click-index math
 * stays consistent.
 *
 * Precedence:
 *   1. User-authored `pipeline` array (any array, even empty).
 *   2. LLM-inferred `composition.inferredPipeline.pipeline` when present.
 *   3. Canonical five-phase spine.
 *
 * Hook target commands are filtered out of (2) and (3).
 */
export function effectivePipelinePhases(snapshot) {
    if (Array.isArray(snapshot?.pipeline)) return snapshot.pipeline.slice();
    const composition = snapshot?.composition ?? null;
    const hooks = hookTargetIds(composition);
    const inferred = composition?.inferredPipeline?.pipeline;
    if (Array.isArray(inferred) && inferred.length) {
        return inferred
            .map((id) => stripCommandsPrefix(id))
            .filter((id) => !hooks.has(id))
            .map((id) => ({ id }));
    }
    return canonicalSpine()
        .filter((id) => !hooks.has(id))
        .map((id) => ({ id }));
}
