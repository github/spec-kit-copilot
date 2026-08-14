// Single source of truth for "which templates / scripts / hooks are active
// for a given command in the current composition".
//
// Callers:
//   1. The phase card renderer in `ui/app.js` (`renderCustomizationsBlock`)
//      uses this to know which pill rows to draw.
//   2. The server-side witness (`expectedArtifactsFor` in `server.mjs`)
//      hands the same list to the agent via the tracking preamble so it
//      can self-report `executed` / `omitted` for exactly the same IDs
//      the pills show.
//
// Deriving the list from ONE place guarantees the witness ask and the pill
// display never diverge. If a preset/extension changes what a phase runs,
// both surfaces update in lockstep.
//
// Data sources:
//   • `canonicalTemplateIds(phase)`   — command→template linkage (canonical).
//   • `coreScriptsForCommand(id)`     — command→script linkage (canonical).
//   • `composition.artifacts[]`       — hooks: dispatchers on the command
//                                       artifact + standalone hook artifacts
//                                       targeting this command.
//
// Templates/scripts fall back to the canonical linkage because composition
// today has no `usedByCommands` field on those artifact kinds — the same
// reason the phase card uses `canonicalTemplateIds`. When composition
// evolves to carry that link natively, this is the one place to teach it.

import { canonicalTemplateIds } from "./canonical.mjs";
import { coreScriptsForCommand } from "./canonical.mjs";

/**
 * Normalize a command reference to its bare + qualified forms.
 *
 * Accepts any of:
 *   • bare        — "constitution"
 *   • dotted      — "speckit.constitution"
 *   • hyphen slug — "speckit-constitution"
 *   • artifact id — "commands/speckit.constitution"
 *
 * Returns `{ bare, qualified }` or `null` for junk. Kept internal — callers
 * should pass whichever form they have and let this function normalize.
 */
function normalizeCommandRef(commandRef) {
    if (typeof commandRef !== "string" || commandRef.length === 0) return null;
    const stripped = commandRef
        .replace(/^commands\//, "")
        .replace(/^speckit[.-]/, "");
    if (!stripped) return null;
    return { bare: stripped, qualified: `speckit.${stripped}` };
}

/**
 * Return the closed list of active artifact IDs for a command, as
 * `{templates, scripts, hooks}` — each a string[] of bare ids.
 *
 * @param {object|null|undefined} composition — `state.composition` snapshot.
 * @param {string} commandRef — command reference in any accepted form.
 * @returns {{templates: string[], scripts: string[], hooks: string[]}}
 */
export function activeArtifactsForCommand(composition, commandRef) {
    const empty = { templates: [], scripts: [], hooks: [] };
    const ref = normalizeCommandRef(commandRef);
    if (!ref) return empty;
    const { bare, qualified } = ref;
    const commandArtifactId = `commands/${qualified}`;
    const arts = Array.isArray(composition?.artifacts) ? composition.artifacts : [];

    // Templates: canonical linkage. Fine to emit even when composition is
    // empty — canonical templates ship with core, so the pill row is
    // rendered as "CORE · unchanged" and the witness asks about them.
    const templates = canonicalTemplateIds(bare).slice();

    // Scripts: canonical core linkage + every non-core (preset/extension)
    // script surfaced by the current composition. Non-core scripts aren't
    // phase-scoped in spec-kit's model — the phase card in `ui/app.js`
    // renders them as rows on EVERY phase card (see the "Non-core scripts"
    // comment near `renderPhaseCustomizations`). To keep the witness ask
    // in lockstep with what the card actually shows, we include those
    // scripts here so the agent is asked to report `executed` / `omitted`
    // for the same ids that get pill rows.
    const scripts = coreScriptsForCommand(qualified).slice();
    const scriptSeen = new Set(scripts);
    for (const a of arts) {
        if (a?.kind !== "script") continue;
        const active = Array.isArray(a.stack) ? a.stack.find((l) => l?.active) : null;
        if (!active || active.layer === "core") continue;
        const bare = typeof a.id === "string" ? a.id.replace(/^scripts\//, "") : null;
        if (!bare || scriptSeen.has(bare)) continue;
        scriptSeen.add(bare);
        scripts.push(bare);
    }

    // Hooks: mirrors `resolveHooksForCommand` (below) — bare phase names
    // only. If nothing has registered a hook for this command, the list
    // stays empty and the witness won't ask about phantom hook slots.
    const hookSet = new Set();
    for (const h of resolveHooksForCommand(composition, commandRef)) {
        if (typeof h?.phase === "string" && h.phase) hookSet.add(h.phase);
    }

    return { templates, scripts, hooks: [...hookSet] };
}

/**
 * Return the ordered list of layers that actually contribute to the
 * resolved output for an artifact — i.e. `stack[0..effectiveBaseIdx]`
 * inclusive (highest precedence first, base last).
 *
 * Semantics mirror `composition-assembler.mjs`:
 *   • `effectiveBaseIdx` is the index of the topmost `replace` layer.
 *     Layers at idx ≤ effectiveBaseIdx contribute; below is shadowed.
 *   • When `effectiveBaseIdx` is missing (legacy payload or single-layer
 *     stack), we fall back to finding the topmost `replace` OR `core`
 *     layer in stack order and use that index. If none is found, we
 *     use the whole stack.
 *   • When the stack is empty or missing, returns `[]`.
 *
 * @param {object|null|undefined} artifact — artifact record with `stack[]`.
 * @returns {Array<object>} contributing layers in precedence order.
 */
export function activeChainForArtifact(artifact) {
    const stack = Array.isArray(artifact?.stack) ? artifact.stack : [];
    if (stack.length === 0) return [];
    let baseIdx = Number.isInteger(artifact?.effectiveBaseIdx)
        ? artifact.effectiveBaseIdx
        : null;
    if (baseIdx === null) {
        // Fallback: first layer (scanning top-down) whose strategy is
        // "replace" OR whose layer is "core" — either terminates the
        // chain because everything below it is shadowed.
        for (let i = 0; i < stack.length; i++) {
            const l = stack[i];
            if (l?.strategy === "replace" || l?.layer === "core") {
                baseIdx = i;
                break;
            }
        }
        if (baseIdx === null) baseIdx = stack.length - 1;
    }
    return stack.slice(0, Math.max(0, baseIdx) + 1);
}

/**
 * Return the rich hook attribution objects that belong to a command's
 * pill row on the phase card. Same predicate `activeArtifactsForCommand`
 * uses for its `hooks` list; this variant preserves the full object shape
 * (`{ phase, extensionId, targetCommand, declared, registered, ... }`)
 * that the UI needs for rendering (extension name links, dispatched-after
 * subline, etc.).
 *
 * Union rule:
 *   • Outgoing — this command's own inline `hooks[]` entries.
 *   • Incoming — other command artifacts' inline `hooks[]` entries whose
 *                `targetCommand` equals this command's qualified id.
 *   • Standalone — kind:"hook" artifacts whose `hookBinding.targetCommand`
 *                  equals this command's qualified id. Emitted with a
 *                  minimal shape derived from `hookBinding`.
 *
 * De-duplicated on `${phase}|${extensionId}|${targetCommand}`.
 *
 * @param {object|null|undefined} composition — `state.composition` snapshot.
 * @param {string} commandRef — command reference in any accepted form.
 * @returns {Array<object>} hook attribution objects.
 */
export function resolveHooksForCommand(composition, commandRef) {
    const ref = normalizeCommandRef(commandRef);
    if (!ref) return [];
    const { qualified } = ref;
    const commandArtifactId = `commands/${qualified}`;
    const arts = Array.isArray(composition?.artifacts) ? composition.artifacts : [];
    const seen = new Set();
    const out = [];
    const lifecycleCommand = (phase) => {
        if (typeof phase !== "string") return null;
        const match = phase.match(/^(?:before|after)_(.+)$/);
        return match ? normalizeCommandRef(match[1])?.qualified : null;
    };
    const providerCommand = (providerId) => {
        if (!providerId) return null;
        const command = arts.find((a) => {
            if (a?.kind !== "command") return false;
            const active = Array.isArray(a.stack) ? a.stack.find((l) => l?.active) : null;
            return (active?.extensionId ?? active?.presetId) === providerId;
        });
        return normalizeCommandRef(command?.id)?.qualified ?? null;
    };
    const pushUnique = (h) => {
        const target = normalizeCommandRef(h.targetCommand)?.qualified ?? h.targetCommand ?? "";
        const key = `${h.phase}|${h.extensionId ?? ""}|${target}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(h);
    };
    for (const a of arts) {
        if (a?.kind === "command" && Array.isArray(a.hooks)) {
            const isSelf = a.id === commandArtifactId;
            for (const h of a.hooks) {
                if (typeof h?.phase !== "string" || !h.phase) continue;
                const target = normalizeCommandRef(h.targetCommand)?.qualified;
                if (isSelf) {
                    const resolvedTarget = target === qualified
                        ? providerCommand(h.extensionId) ?? target
                        : target;
                    pushUnique({ ...h, targetCommand: resolvedTarget ?? h.targetCommand });
                } else if (target === qualified) {
                    pushUnique(h);
                }
            }
        } else if (a?.kind === "hook") {
            // Every binding on this hook artifact contributes independently —
            // iterate the plural `hookBindings` (falling back to the legacy
            // `hookBinding` singular for stale payloads). Without this loop
            // a hook artifact with both after_specify and after_plan would
            // only surface one binding.
            const bindings = Array.isArray(a.hookBindings) && a.hookBindings.length
                ? a.hookBindings
                : (a.hookBinding ? [a.hookBinding] : []);
            // Prefer explicit targetCommand fields; fall back to the artifact's
            // own id (stripped of `commands/`) since that IS the command the
            // hook dispatches. Falling back to `qualified` — the phase we're
            // looking up — would silently duplicate the inline attribution
            // that already fired for this phase, because the two entries
            // would differ only in the (spurious) targetCommand key.
            const idFallback = typeof a.id === "string" && a.id.startsWith("commands/")
                ? a.id.slice("commands/".length)
                : null;
            for (const b of bindings) {
                if (!b || typeof b.phase !== "string" || !b.phase) continue;
                const target = a.targetCommand ?? b.targetCommand ?? idFallback ?? null;
                const lifecycleTarget = lifecycleCommand(b.phase);
                if (normalizeCommandRef(target)?.qualified !== qualified && lifecycleTarget !== qualified) continue;
                pushUnique({
                    phase: b.phase,
                    extensionId: b.extensionId ?? null,
                    targetCommand: normalizeCommandRef(target)?.qualified ?? target ?? qualified,
                });
            }
        }
    }
    return out;
}
