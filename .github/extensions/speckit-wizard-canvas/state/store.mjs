// speckit-wizard — state-store entry point
//
// Public I/O boundary + patch dispatcher for `.speckit-wizard/state.json`.
// The pure normalizers live under `state/`; this file wires them into the
// on-disk lifecycle:
//
//   readState   — atomic-safe read + normalizeState fallback on missing /
//                 malformed input. Returns { present, state, warnings }.
//   applyPatch  — merge a partial patch onto a current state using the
//                 correct sub-normalizer per field (setup / phases /
//                 pipeline / composition / executionReports / builtFrom),
//                 then re-derive phases.setup.status.
//   writeState  — atomic write via temp-file + rename; enforces a serial
//                 write queue per workspace so concurrent flush requests
//                 can't tear the file.
//
// All public normalizer/validator exports (deriveSetupPhaseStatus,
// normalizeState, EXECUTION_STATES, normalizeExecutionReports,
// mergeExecutionReportEntry, computeItemStatuses, validateInferredPipeline,
// overlayCachedComposition, activeFingerprint, normalizePipeline,
// coerceStringArray) live as sibling modules in `state/` and are re-exported
// from here so external importers only need `state/store.mjs`.
//
// State lives OUTSIDE `.specify/` so the wizard never contaminates the
// spec-kit CLI's own directory. That preserves the invariant "`.specify/`
// exists ⇒ `specify init` ran," which the scanner relies on for
// `projectInitialized` detection.

import { PHASE_BY_ID } from "../canvas-runtime/wizard-phases.mjs";
import { join } from "node:path";
import { rename as _fsRename, unlink as _fsUnlink } from "node:fs/promises";
import { coerceBool } from "./normalize.mjs";
import { normalizeExecutionReports } from "./execution-reports.mjs";
import { normalizePipeline } from "../pipeline/validate.mjs";
import { deriveSetupPhaseStatus, normalizePhaseSlice, normalizeState } from "./normalize.mjs";

// Re-exports — keep the historical public surface addressable from
// state/store.mjs so external importers only touch a single entry point.
export { coerceStringArray } from "./normalize.mjs";
export {
    EXECUTION_STATES,
    normalizeExecutionReports,
    mergeExecutionReportEntry,
    computeItemStatuses,
} from "./execution-reports.mjs";
export {
    validateInferredPipeline,
    overlayCachedComposition,
    activeFingerprint,
    normalizePipeline,
} from "../pipeline/validate.mjs";
export { deriveSetupPhaseStatus, normalizeState } from "./normalize.mjs";

export const STATE_DIR = ".speckit-wizard";
export const STATE_FILE = ".speckit-wizard/state.json";


// Read + normalize. `deps.readFile(path) → Promise<string>` and
// `deps.pathExists(path) → Promise<boolean>` are injected.
// Returns { present, state, warnings }.
export async function readState(workspacePath, deps) {
    const path = join(workspacePath, STATE_FILE);
    const dirPath = join(workspacePath, STATE_DIR);
    const warnings = [];

    const dirExists = await deps.pathExists(dirPath);
    if (!dirExists) {
        // Provenance signal absent; do not trust anything.
        return { present: false, state: normalizeState(null), warnings };
    }
    const fileExists = await deps.pathExists(path);
    if (!fileExists) return { present: false, state: normalizeState(null), warnings };

    let text = "";
    try {
        text = await deps.readFile(path, "utf8");
    } catch (err) {
        warnings.push(`readState: readFile failed: ${err?.message ?? err}`);
        return { present: false, state: normalizeState(null), warnings };
    }
    if (typeof text === "string" && text.length > 512 * 1024) {
        warnings.push(`readState: file exceeds 512KB, truncating parse attempt`);
        text = text.slice(0, 512 * 1024);
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        warnings.push(`readState: JSON parse failed: ${err?.message ?? err}`);
        return { present: true, state: normalizeState(null), warnings };
    }
    return { present: true, state: normalizeState(parsed), warnings };
}

// Merge caller updates into current state, defensively normalized.
export function applyPatch(current, patch) {
    if (!patch || typeof patch !== "object") return normalizeState(current);
    const merged = { ...normalizeState(current) };
    if (typeof patch.currentPhase === "string" && PHASE_BY_ID[patch.currentPhase]) {
        merged.currentPhase = patch.currentPhase;
    }
    if (typeof patch.preset === "string" && patch.preset.length) merged.preset = patch.preset;
    if (patch.setup && typeof patch.setup === "object") {
        // Only merge fields explicitly present in the patch. normalizeState()
        // would fill in defaults for missing fields and clobber real values,
        // so we coerce per-key instead.
        const setupPatch = {};
        for (const key of ["pluginInstalled", "cliInstalled", "projectInitialized", "skillsReloaded", "catalogsLoaded"]) {
            if (Object.prototype.hasOwnProperty.call(patch.setup, key)) {
                setupPatch[key] = coerceBool(patch.setup[key], merged.setup[key]);
            }
        }
        merged.setup = { ...merged.setup, ...setupPatch };
    }
    if (patch.phases && typeof patch.phases === "object") {
        merged.phases = { ...merged.phases };
        for (const id of Object.keys(patch.phases)) {
            if (!PHASE_BY_ID[id]) continue;
            merged.phases[id] = normalizePhaseSlice(id, {
                ...merged.phases[id],
                ...patch.phases[id],
            });
        }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "pipeline")) {
        // Explicit null → back to inferred-spine mode (sentinel).
        // Array → user-authored list (possibly empty from "Clear").
        // Anything else → ignore.
        if (patch.pipeline === null) merged.pipeline = null;
        else if (Array.isArray(patch.pipeline)) merged.pipeline = normalizePipeline(patch.pipeline);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "composition")) {
        // null / undefined / non-object → drop the cached composition.
        if (patch.composition && typeof patch.composition === "object") {
            // Per-key partial merge — matches applyComposition's `has()`
            // contract in extension.mjs. A patch that only mentions
            // `executionReports` (e.g. applyExecutionReport) must NOT wipe
            // presets/extensions/artifacts on disk. Only overwrite
            // keys the patch explicitly sets; preserve the rest from the
            // normalized on-disk value.
            const patchC = patch.composition;
            const prev = merged.composition ?? {};
            const has = (k) => Object.prototype.hasOwnProperty.call(patchC, k);
            const next = { ...prev };
            if (has("presets")) next.presets = Array.isArray(patchC.presets) ? patchC.presets : [];
            if (has("extensions")) next.extensions = Array.isArray(patchC.extensions) ? patchC.extensions : [];
            if (has("artifacts")) next.artifacts = Array.isArray(patchC.artifacts) ? patchC.artifacts : [];
            if (has("refreshedAt")) {
                next.refreshedAt = typeof patchC.refreshedAt === "string" ? patchC.refreshedAt : null;
            }
            // Fill required-shape defaults only for fields still missing after
            // the merge (fresh install, first write). Preserves the
            // normalizeState-on-read contract without clobbering existing data.
            next.presets ??= [];
            next.extensions ??= [];
            next.artifacts ??= [];
            if (!("refreshedAt" in next)) next.refreshedAt = null;
            if (has("inferredPipeline")) {
                const ip = patchC.inferredPipeline;
                if (ip && typeof ip === "object") {
                    const shape = ip.shape === "standalone" || ip.shape === "augmented-canonical" ? ip.shape : null;
                    if (shape) {
                        next.inferredPipeline = {
                            shape,
                            pipeline: Array.isArray(ip.pipeline) ? ip.pipeline.filter((x) => typeof x === "string") : [],
                            unplaced: Array.isArray(ip.unplaced) ? ip.unplaced.filter((x) => typeof x === "string") : [],
                            rationale: typeof ip.rationale === "string" ? ip.rationale : "",
                        };
                    } else {
                        delete next.inferredPipeline;
                    }
                } else {
                    // Explicit null / non-object clears the field.
                    delete next.inferredPipeline;
                }
            }
            if (has("executionReports")) {
                // Per-phase execution reports. Round-trip via the shared
                // normalizer so patch-time and read-time apply the same rules.
                // Explicit null clears; a non-null value replaces (per-key merging
                // of individual reports is the writer's job — applyExecutionReport
                // pre-merges with the cached slice before calling applyPatch).
                if (patchC.executionReports === null) {
                    delete next.executionReports;
                } else {
                    const execRep = normalizeExecutionReports(patchC.executionReports);
                    if (execRep) next.executionReports = execRep;
                }
            }
            // Catalog-fingerprint stamp. Only server-owned writers set
            // this (applyComposition), and it drives execution-report
            // staleness (server-side). Preserving it across patches is
            // what keeps that check honest: a skill trying to mutate
            // composition.presets can no longer defeat the check.
            //
            // Backward compat: patches carrying a single legacy
            // `fingerprint` field are read as `compositionFingerprint`.
            if (has("builtFrom")) {
                const bf = patchC.builtFrom;
                if (bf && typeof bf === "object") {
                    const composition = typeof bf.compositionFingerprint === "string"
                        ? bf.compositionFingerprint
                        : (typeof bf.fingerprint === "string" ? bf.fingerprint : null);
                    if (composition) {
                        next.builtFrom = {
                            compositionFingerprint: composition,
                            catalogChangedAt: typeof bf.catalogChangedAt === "string" ? bf.catalogChangedAt : null,
                        };
                    } else {
                        delete next.builtFrom;
                    }
                } else {
                    delete next.builtFrom;
                }
            }
            merged.composition = next;
        } else {
            delete merged.composition;
        }
    }
    // Re-derive phases.setup.status from setup.* sub-flags after every
    // patch. Callers may not write phases.setup.status directly — the four
    // sub-flags are the single source of truth (see deriveSetupPhaseStatus).
    merged.phases = {
        ...merged.phases,
        setup: {
            ...merged.phases.setup,
            status: deriveSetupPhaseStatus(merged.setup),
        },
    };
    return merged;
}

// Persist state.json. `deps.mkdir(path, opts)` and `deps.writeFile(path, data, enc)` are injected.
// Writes to the same workspacePath are serialized to prevent lost updates from
// concurrent canvas actions (multiple SSE clients + file watchers all mutate
// this file), and the payload is written via a tmp file + rename so a crash
// mid-write can't leave a truncated state.json on disk.
const _writeQueues = new Map();

function _enqueueWrite(workspacePath, task) {
    const prev = _writeQueues.get(workspacePath) ?? Promise.resolve();
    // Chain via `.then` so a rejected previous write doesn't reject ours.
    const next = prev.then(task, task);
    _writeQueues.set(workspacePath, next.then(() => {}, () => {}));
    return next;
}

export async function writeState(workspacePath, state, deps) {
    const dirPath = join(workspacePath, STATE_DIR);
    const filePath = join(workspacePath, STATE_FILE);
    const normalized = normalizeState(state);
    const payload = JSON.stringify(normalized, null, 2) + "\n";
    // Defensive: refuse to persist a payload we can't parse back. Guards
    // against a caller mutating `state` mid-serialize.
    try { JSON.parse(payload); } catch (err) {
        throw new Error(`writeState refused to persist unparseable payload: ${err?.message ?? err}`);
    }

    // Atomic swap via tmp file + rename is REQUIRED — no direct-write fallback.
    // Callers can inject `deps.rename` (test doubles) but production code
    // always gets real fs.promises.rename via _fsRename, so races between
    // ad-hoc deps bags (e.g. server.mjs handlers) and richer ones can't
    // produce a torn state.json. deps.writeFile / deps.mkdir remain injected
    // so tests keep their in-memory fs stubs.
    const rename = typeof deps.rename === "function" ? deps.rename : _fsRename;
    const unlink = typeof deps.unlink === "function" ? deps.unlink : _fsUnlink;

    await _enqueueWrite(workspacePath, async () => {
        await deps.mkdir(dirPath, { recursive: true });
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
        await deps.writeFile(tmpPath, payload, "utf8");
        try {
            await rename(tmpPath, filePath);
        } catch (err) {
            // Rename failed (e.g. Windows AV holds the target). Best-effort
            // cleanup of the tmp file so it doesn't linger, then rethrow.
            try { await unlink(tmpPath); } catch { /* ignore */ }
            throw err;
        }
    });
    return normalized;
}