// speckit-wizard — pipeline & composition validation
//
// Validators and normalizers for the composition/pipeline sub-tree of
// `.speckit-wizard/state.json`. Everything here is pure:
//   * validateInferredPipeline    — checks an LLM-emitted inferredPipeline
//                                    against the payload's own artifacts.
//   * overlayCachedComposition    — overlays the last-accepted composition
//                                    payload onto a fresh snapshot.
//   * activeFingerprint           — sha1 of the "installed active set", the
//                                    scalar that drives pipeline-staleness.
//   * normalizePipelineItem
//   * normalizePipeline           — accepts a raw pipeline field into either
//                                    null (inferred-spine sentinel) or an
//                                    array of `{id}` records.
//
// Extracted verbatim from state/store.mjs. No behavior changes.

import { createHash } from "node:crypto";
import { requiredCanonicalPipelineIds } from "./canonical.mjs";

// Canonical spine anchors that MUST appear in an augmented-canonical
// inferredPipeline. Standalone pipelines are exempt.
// Sourced from `ui/canonical.mjs` (single source of truth) — do NOT
// hand-list here.
const REQUIRED_CANONICALS = Object.freeze(requiredCanonicalPipelineIds());

/**
 * Validate an LLM-emitted inferredPipeline against the payload's own
 * artifacts (closed vocabulary). Returns `{ ok: true, value }` on success or
 * `{ ok: false, reason }` on any failure. The caller drops the field
 * entirely on failure — partial acceptance would silently ship an incoherent
 * pipeline — but surfaces `reason` to the LLM so it can self-correct in the
 * same turn instead of silently degrading to canonical spine.
 */
export function validateInferredPipeline(inferred, artifacts) {
    if (!inferred || typeof inferred !== "object") {
        return { ok: false, reason: "inferredPipeline field missing or not an object" };
    }
    const shape = inferred.shape;
    if (shape !== "augmented-canonical" && shape !== "standalone") {
        return {
            ok: false,
            reason: `shape must be "augmented-canonical" or "standalone" (got ${JSON.stringify(shape)})`,
        };
    }
    const pipeline = Array.isArray(inferred.pipeline) ? inferred.pipeline : [];
    const unplaced = Array.isArray(inferred.unplaced) ? inferred.unplaced : [];
    if (!pipeline.every((x) => typeof x === "string" && x.length)) {
        return { ok: false, reason: "pipeline must be an array of non-empty strings" };
    }
    if (!unplaced.every((x) => typeof x === "string" && x.length)) {
        return { ok: false, reason: "unplaced must be an array of non-empty strings" };
    }
    if (pipeline.length + unplaced.length > 30) {
        return {
            ok: false,
            reason: `pipeline + unplaced exceeds 30 entries (got ${pipeline.length + unplaced.length})`,
        };
    }
    const seen = new Set();
    for (const id of pipeline) {
        if (seen.has(id)) return { ok: false, reason: `duplicate id in pipeline: ${id}` };
        seen.add(id);
    }
    for (const id of unplaced) {
        if (seen.has(id)) return { ok: false, reason: `id appears in both pipeline and unplaced (or duplicated): ${id}` };
        seen.add(id);
    }
    const commandIds = new Set(
        (artifacts || [])
            .filter((a) => a && typeof a === "object" && a.kind === "command" && typeof a.id === "string")
            .map((a) => a.id),
    );
    // Hook-target commands are auto-dispatched by the runtime after their
    // parent phase completes. They are NOT user-runnable, so they must
    // never appear in either `pipeline` (double-run) or `unplaced`
    // (they're not "commands the user could add" — the runtime owns them).
    // Sanitize both lists so the wizard's pipeline model is guaranteed
    // hook-free regardless of what the LLM emits.
    const hookHasTarget = (a) => {
        if (Array.isArray(a?.hookBindings) && a.hookBindings.length) {
            return a.hookBindings.some((b) => typeof b?.targetCommand === "string");
        }
        return typeof a?.hookBinding?.targetCommand === "string";
    };
    const hookTargetIds = new Set(
        (artifacts || [])
            .filter((a) => a && typeof a === "object"
                && a.kind === "hook"
                && typeof a.id === "string"
                && hookHasTarget(a))
            .map((a) => a.id),
    );
    const strippedFromPipeline = [];
    const sanitizedPipeline = [];
    for (const id of pipeline) {
        if (hookTargetIds.has(id)) {
            strippedFromPipeline.push(id);
        } else {
            sanitizedPipeline.push(id);
        }
    }
    const strippedFromUnplaced = [];
    const sanitizedUnplaced = [];
    for (const id of unplaced) {
        if (hookTargetIds.has(id)) {
            strippedFromUnplaced.push(id);
        } else {
            sanitizedUnplaced.push(id);
        }
    }
    for (const id of sanitizedPipeline) {
        if (!commandIds.has(id)) {
            return {
                ok: false,
                reason: `pipeline references unknown command id "${id}" — must appear in artifacts[] with kind:"command"`,
            };
        }
    }
    for (const id of sanitizedUnplaced) {
        if (!commandIds.has(id)) {
            return {
                ok: false,
                reason: `unplaced references unknown command id "${id}" — must appear in artifacts[] with kind:"command"`,
            };
        }
    }
    if (shape === "augmented-canonical") {
        const inPipeline = new Set(sanitizedPipeline);
        for (const req of REQUIRED_CANONICALS) {
            if (!inPipeline.has(req)) {
                return {
                    ok: false,
                    reason: `augmented-canonical shape requires all canonical anchors; missing "${req}"`,
                };
            }
        }
    } else if (sanitizedPipeline.length < 3) {
        return {
            ok: false,
            reason: `standalone shape requires pipeline.length >= 3 (got ${sanitizedPipeline.length})`,
        };
    }
    return {
        ok: true,
        value: {
            shape,
            pipeline: sanitizedPipeline,
            unplaced: sanitizedUnplaced,
            rationale: typeof inferred.rationale === "string" ? inferred.rationale : "",
        },
    };
}

/**
 * Overlay the in-memory `cachedComposition` (last-accepted composition
 * payload) onto a fresh snapshot's `composition` field. Pure — no I/O, no
 * side effects; safe to unit test.
 *
 * The overlay preserves all supported composition fields and guards optional
 * inferred-pipeline data before it reaches the API response.
 *
 * Returns a NEW object so callers can assign directly to `snap.composition`
 * without worrying about aliasing the cached record.
 */
export function overlayCachedComposition(cached) {
    if (!cached || typeof cached !== "object") return null;
    const overlay = {
        presets: Array.isArray(cached.presets) ? [...cached.presets] : [],
        extensions: Array.isArray(cached.extensions) ? [...cached.extensions] : [],
        artifacts: Array.isArray(cached.artifacts) ? [...cached.artifacts] : [],
        refreshedAt: typeof cached.refreshedAt === "string" ? cached.refreshedAt : null,
    };
    // Round-trip the LLM-inferred pipeline. Guarded because a malformed
    // cache entry (shouldn't happen — applyComposition validates on write)
    // must not leak into the API response.
    if (cached.inferredPipeline && typeof cached.inferredPipeline === "object") {
        overlay.inferredPipeline = cached.inferredPipeline;
    }
    // Per-phase execution reports (produced by the phase.viewExecution
    // action). Same round-trip guard as inferredPipeline — the writer
    // (applyComposition / applyExecutionReport) normalizes on input, so
    // we just spread the cached value through when present.
    if (cached.executionReports && typeof cached.executionReports === "object") {
        overlay.executionReports = cached.executionReports;
    }
    // Round-trip the catalog-fingerprint stamp. Execution-report staleness
    // (in `applyComposition`) compares against `compositionFingerprint`;
    // losing it would falsely flag every cached execution report as stale
    // on server restart.
    //
    // Backward compat: legacy state files with a single `fingerprint`
    // field are read as `compositionFingerprint`.
    if (cached.builtFrom && typeof cached.builtFrom === "object") {
        const bf = cached.builtFrom;
        const composition = typeof bf.compositionFingerprint === "string"
            ? bf.compositionFingerprint
            : (typeof bf.fingerprint === "string" ? bf.fingerprint : null);
        if (composition) {
            overlay.builtFrom = {
                compositionFingerprint: composition,
                catalogChangedAt: typeof bf.catalogChangedAt === "string"
                    ? bf.catalogChangedAt : null,
            };
        }
    }
    return overlay;
}

/**
 * Deterministic fingerprint of the "installed active set" (catalog presets +
 * catalog extensions) — the scalar that drives pipeline-staleness detection.
 *
 * Rules:
 * - Sha1 of the sorted `id@version` tokens of every catalog entry whose
 *   `active` flag is truthy across BOTH presets and extensions.
 * - Presets and extensions are prefixed (`preset:` / `ext:`) so a preset id
 *   colliding with an extension id can't fake equality.
 * - Missing `catalog` (or empty active set) returns a stable "empty"
 *   fingerprint, so a fresh project + no-op composition record match.
 *
 * `applyComposition` computes this from the current catalog at write time
 * and stamps it into `builtFrom.compositionFingerprint`. Execution-report
 * staleness (in `applyComposition`) compares the freshly-computed value
 * against the previously-cached one; when they diverge, prior reports
 * are marked `stale: true` so users see a warning and can re-analyze.
 */
export function activeFingerprint(catalog) {
    const c = catalog && typeof catalog === "object" ? catalog : {};
    const parts = [];
    for (const p of Array.isArray(c.presets) ? c.presets : []) {
        if (!p?.active) continue;
        const id = String(p.id ?? p.installedId ?? p.name ?? "").toLowerCase();
        if (!id) continue;
        parts.push(`preset:${id}@${p.version ?? ""}`);
    }
    for (const e of Array.isArray(c.extensions) ? c.extensions : []) {
        if (!e?.active) continue;
        const id = String(e.id ?? e.installedId ?? e.name ?? "").toLowerCase();
        if (!id) continue;
        parts.push(`ext:${id}@${e.version ?? ""}`);
    }
    parts.sort();
    return createHash("sha1").update(parts.join("\n")).digest("hex");
}

function normalizePipelineItem(raw) {
    if (typeof raw === "string") return { id: raw };
    if (raw && typeof raw === "object" && typeof raw.id === "string" && raw.id.length) {
        return { id: raw.id };
    }
    return null;
}

// Normalize a pipeline field. `null` means "untouched — use inferred spine".
// Any array (including empty) means the user has taken control.
export function normalizePipeline(raw) {
    if (raw === null || raw === undefined) return null;
    if (!Array.isArray(raw)) return null;
    return raw.map(normalizePipelineItem).filter(Boolean);
}
