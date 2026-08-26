// Composition persistence + apply pipeline. Owns
// persistAndBroadcast, catalog/hook normalizers, applyComposition (composition-slice push),
// and runFastComposition (deterministic assembler).
//
// Per-phase execution-report merging lives in the sibling
// execution-report-apply.mjs module.
//
// Lives under `canvas-runtime/` — the wizard's canvas server-side runtime.
// Code in here operates equally on presets, extensions, and bundles.

import { PHASE_BY_ID } from "./wizard-phases.mjs";
import { applyPatch, writeState, readState, validateInferredPipeline, activeFingerprint, normalizeExecutionReports } from "../state/store.mjs";
import { assembleComposition, computePipelineFastPath } from "../composition/assembler.mjs";
import { fsDeps } from "./instances.mjs";
import { snapshot } from "./snapshot.mjs";

export async function persistAndBroadcast(inst, patch) {
    if (inst.workspacePath) {
        try {
            // Re-hydrate from disk before writing so external edits and
            // concurrent canvas writes aren't clobbered by a stale
            // in-memory copy. The caller passes only the delta for this
            // handler; the rest of the state comes from disk.
            const onDisk = await readState(inst.workspacePath, fsDeps).catch(() => null);
            const base = onDisk?.state ?? inst.state ?? {};
            const merged = patch ? applyPatch(base, patch) : applyPatch(base, {});
            inst.state = merged;
            await writeState(inst.workspacePath, merged, fsDeps);
        } catch {
            // state.json write failed — best-effort; the in-memory snapshot
            // below still reflects the requested patch.
        }
    }
    // Re-scan to reflect on-disk truth.
    const snap = await snapshot(inst);
    inst.broadcast({ type: "state", data: snap });
    return snap;
}

// Persist + broadcast a composition payload received via the
// `showInferredPipeline` action (or the fast assembler's direct call).
// Normalizes the `provides` counters (arrays →
// integers), stamps `refreshedAt`, caches the result under
// `state.snapshot.composition`, and broadcasts a `composition` SSE frame so
// the UI can re-render immediately.
//
// **Who calls this today.** The composition slice
// (`{ presets, extensions, artifacts }`) is owned entirely by the
// deterministic fast assembler (`composition-assembler.mjs::runFastComposition`),
// which runs on install, remove, refresh, and boot, and calls
// `applyComposition` directly from Node with the full slice. There is **no
// LLM-driven composition builder** anymore — the only remaining LLM
// writer path is `composition.inferPipeline` (see
// `prompts/composition.mjs`) invoking the `showInferredPipeline` canvas
// action, and it emits ONLY `inferredPipeline` so pipeline inference can
// update phase ordering without re-echoing the composition slice.
//
// **Partial-merge semantics.** Callers may emit any subset of
// `{ presets, extensions, artifacts, inferredPipeline }`; keys NOT
// present in the input are preserved from the cached composition.
// This is what lets `inferPipeline` push only `inferredPipeline` and
// what lets the fast assembler push the composition slice without
// wiping a previously-computed pipeline inference.
function normalizeCompositionCatalogItems(items, knownItems) {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    return items.filter((item) => {
        const id = item?.id ?? item?.name;
        if (typeof id !== "string" || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

export function normalizeHookArtifactsInComposition(composition) {
    if (!composition || !Array.isArray(composition.artifacts)) return composition;
    const commandIds = new Set(
        composition.artifacts
            .filter((artifact) => artifact?.kind === "command")
            .map((artifact) => artifact.id),
    );
    const commandByProvider = new Map();
    for (const artifact of composition.artifacts) {
        if (artifact?.kind !== "command") continue;
        const active = artifact.stack?.find((layer) => layer?.active);
        const provider = active?.extensionId ?? active?.presetId;
        if (!provider || !String(artifact.id).startsWith("commands/speckit.")) continue;
        if (!commandByProvider.has(provider)) commandByProvider.set(provider, artifact);
    }
    const artifacts = composition.artifacts
        .filter((artifact) => {
            // Mixed preset manifests may be incorrectly echoed by the
            // composition extractor as both a command and a template. The
            // command artifact is authoritative when the IDs correspond.
            if (artifact?.kind !== "template") {
                return true;
            }
            const templateId = String(artifact.id).replace(/^templates\//, "");
            return !commandIds.has(`commands/${templateId}`);
        })
        .map((artifact) => {
            if (artifact?.kind !== "hook") return artifact;
            const active = artifact.stack?.find((layer) => layer?.active);
            const provider = active?.extensionId ?? active?.presetId;
            const target = provider ? commandByProvider.get(provider) : null;
            if (!target) return artifact;
            const targetCommand = target.id.replace(/^commands\//, "");
            const bindings = Array.isArray(artifact.hookBindings) && artifact.hookBindings.length
                ? artifact.hookBindings.map((b) => ({ ...b, targetCommand }))
                : [{ ...(artifact.hookBinding ?? {}), targetCommand }];
            return {
                ...artifact,
                id: target.id,
                hookBindings: bindings,
                hookBinding: bindings[0],
            };
        });
    return { ...composition, artifacts };
}

export async function applyComposition(inst, input) {
    const normalizeProvides = (p) => {
        if (!p || typeof p !== "object") return p;
        const provides = p.provides;
        if (!provides || typeof provides !== "object") return p;
        const normProvides = { ...provides };
        for (const k of ["commands", "templates", "scripts", "hooks"]) {
            if (Array.isArray(normProvides[k])) normProvides[k] = normProvides[k].length;
        }
        return { ...p, provides: normProvides };
    };
    // Defensive normalization of per-artifact fields:
    //   • `strategy`: default missing/invalid to "replace" to match the CLI's
    //     resolver behavior when a preset entry has no strategy key.
    //   • `effectiveBaseIdx`: index of the topmost `replace` layer in the
    //     stack (highest priority scan-down). Contributing layers live at
    //     index <= effectiveBaseIdx; the rest are shadowed by the base.
    //     Compute it here if the LLM omitted it so the UI can trust the
    //     field is always present.
    //   • Scrub extension-layer templates/scripts silently — they were a
    //     historical prompt fabrication; in practice extensions only
    //     provide commands. If an extension truly declares templates or
    //     scripts (rare), the prompt still emits them and this scrub
    //     leaves them alone.
    const VALID_STRATEGIES = new Set(["replace", "wrap", "prepend", "append"]);
    const normalizeArtifact = (a) => {
        if (!a || typeof a !== "object") return a;
        const stack = Array.isArray(a.stack) ? a.stack : [];
        const normStack = stack.map((layer) => {
            if (!layer || typeof layer !== "object") return layer;
            const s = typeof layer.strategy === "string" && VALID_STRATEGIES.has(layer.strategy)
                ? layer.strategy
                : "replace";
            return { ...layer, strategy: s };
        });
        let effBase = a.effectiveBaseIdx;
        if (!Number.isInteger(effBase) || effBase < 0 || effBase >= normStack.length) {
            // Find topmost `replace` layer.
            effBase = normStack.findIndex((l) => l && l.strategy === "replace");
            if (effBase === -1) {
                effBase = Math.max(0, normStack.length - 1);
            }
        }
        return { ...a, stack: normStack, effectiveBaseIdx: effBase };
    };
    // Partial-merge semantics — the fast assembler owns the composition
    // slice (`{ presets, extensions, artifacts }`) and LLM
    // `composition.inferPipeline` writes only `{ inferredPipeline }`. When a
    // write omits any of these keys, we MUST preserve the previous value
    // from the cached composition instead of clobbering with empty arrays.
    // A key is "provided" iff the input explicitly set it (own-property check);
    // otherwise we fall back to the cached previous composition.
    const has = (k) => input != null && Object.prototype.hasOwnProperty.call(input, k);
    const prev = inst.cachedComposition ?? {};
    const nextArtifactsRaw = has("artifacts") ? (input.artifacts ?? []) : (prev.artifacts ?? []);
    const artifactsNorm = normalizeHookArtifactsInComposition({ artifacts: nextArtifactsRaw.map(normalizeArtifact) }).artifacts;
    const inferredPipelineProvided = has("inferredPipeline");
    // Validate against the artifacts we're about to persist (fresh or preserved).
    const ipResult = inferredPipelineProvided
        ? validateInferredPipeline(input.inferredPipeline, artifactsNorm)
        : { ok: false, reason: "not provided", value: undefined };
    // Compute the catalog fingerprint from server-owned cached catalog
    // items (the same source `getState()` exposes as
    // `state.snapshot.catalog.*`). Used below to mark previously-cached
    // execution reports as stale when the catalog fingerprint moves.
    const catalogForFingerprint = {
        presets: inst.cachedPresetItems ?? [],
        extensions: inst.cachedExtensionItems ?? [],
    };
    const fingerprint = activeFingerprint(catalogForFingerprint);
    const composition = {
        presets: has("presets")
            ? normalizeCompositionCatalogItems(input.presets, inst.cachedPresetItems).map(normalizeProvides)
            : (prev.presets ?? []),
        extensions: has("extensions")
            ? normalizeCompositionCatalogItems(input.extensions, inst.cachedExtensionItems).map(normalizeProvides)
            : (prev.extensions ?? []),
        artifacts: artifactsNorm,
        refreshedAt: new Date().toISOString(),
        builtFrom: {
            // Composition slice: always restamped on every write. The fast
            // path runs on install/boot, so this fingerprint effectively
            // stays in sync with the catalog at all times. Used by the
            // execution-report staleness check below.
            compositionFingerprint: fingerprint,
            catalogChangedAt: new Date().toISOString(),
        },
    };
    if (ipResult.ok) {
        composition.inferredPipeline = ipResult.value;
    } else if (!inferredPipelineProvided && prev.inferredPipeline) {
        // Preserve prior pipeline when this write didn't touch it.
        composition.inferredPipeline = prev.inferredPipeline;
    }
    // Per-phase execution reports are NOT emitted by composition.refresh
    // anymore — they come from phase.viewExecution. But we preserve
    // previously-cached reports across refreshes and mark them stale when
    // their winning SKILL.md path changed (a preset/extension flip may
    // have shifted the source of truth), so users see a warning and can
    // re-analyze rather than staring at silently-outdated data.
    //
    // Fallback to `inst.state.composition.executionReports` covers the
    // boot-sequence race where `runFastComposition` fires before
    // `inst.cachedComposition` has been hydrated from disk (or when a
    // sibling code path clears the in-memory cache but hasn't yet touched
    // disk). Without this fallback, that first post-boot apply would emit
    // a composition object with no `executionReports` key, causing the
    // state-store normalizer to drop the persisted slice on next write.
    const prevReports = inst.cachedComposition?.executionReports
        ?? inst.state?.composition?.executionReports;
    if (prevReports && typeof prevReports === "object") {
        const nextReports = {};
        for (const [key, report] of Object.entries(prevReports)) {
            if (!report || typeof report !== "object") continue;
            // The winning SKILL.md for a canonical is always at
            // .github/skills/<phase-slug>/SKILL.md — the composition
            // refresh doesn't move that path even when the preset winner
            // changes. So the primary staleness signal here is that the
            // catalog fingerprint changed (any preset/extension flip
            // marks all prior reports as possibly-stale).
            const prevFingerprint = inst.cachedComposition?.builtFrom?.compositionFingerprint
                ?? inst.cachedComposition?.builtFrom?.fingerprint;
            const staleNow = prevFingerprint && prevFingerprint !== fingerprint;
            nextReports[key] = staleNow ? { ...report, stale: true } : report;
        }
        const norm = normalizeExecutionReports(nextReports);
        if (norm) composition.executionReports = norm;
    }
    inst.cachedComposition = composition;
    inst.broadcast({ type: "composition", ...composition });
    await persistAndBroadcast(inst, { composition });
    // Surface inferredPipeline drop as a warning log so the wizard sidebar
    // shows the failure — otherwise the UI silently falls back to canonical
    // spine and users can't tell whether the LLM omitted the field or the
    // server rejected it. Rejection is reported back to the LLM via the
    // `inferredPipelineStatus` return value below so it can retry in-turn.
    // Return acceptance status so the calling LLM sees the drop in the same
    // turn and can retry with a fixed payload, instead of getting a green
    // ack and moving on. `provided` distinguishes "you forgot to emit it"
    // from "you emitted something invalid — here's why".
    return {
        ...composition,
        inferredPipelineStatus: ipResult.ok
            ? { accepted: true, provided: true }
            : { accepted: false, provided: inferredPipelineProvided, reason: ipResult.reason },
    };
}

// Deterministic composition refresh from local filesystem — no LLM.
//
// TEMPORARY. Delete this helper + every call site once `specify composition
// list --json` returns fully-resolved artifact stacks with per-layer
// `active: true` markers. At that point the LLM `composition.refresh`
// collapses to a single-line CLI call and the "slow LLM path" this helper
// works around ceases to exist.
//
// Purpose: after any catalog change (preset/extension install, remove,
// swap, priority change) the composition needs to be rebuilt. This
// helper rebuilds `{ presets, extensions, artifacts }` locally in
// milliseconds by reading manifests directly — LLM composition extraction
// is retired entirely.
//
// Pipeline fast path: `computePipelineFastPath` inspects the freshly
// assembled composition and decides whether it can synthesize
// `inferredPipeline` from the canonical spine. When it cannot (new commands
// or wraps/prepends/appends directives), we skip pipeline
// synthesis and the prior `inferredPipeline` carries forward until the
// user clicks Refresh Now on the Composition tab to invoke LLM inference.
//
// Runs silently on catalog changes — failures degrade to a warn log and
// leave the composition slice alone.
export async function runFastComposition(inst, { reason } = {}) {
    if (!inst?.workspacePath) return { ok: false, reason: "no-workspace" };
    try {
        const payload = await assembleComposition({
            workspaceRoot: inst.workspacePath,
            presetItems: inst.cachedPresetItems ?? [],
            extensionItems: inst.cachedExtensionItems ?? [],
        });
        // `_presetManifests` is a side channel used only for the pipeline
        // fast-path decision — never persisted.
        const presetManifests = payload._presetManifests ?? [];
        delete payload._presetManifests;

        const fastPath = computePipelineFastPath(payload, presetManifests);
        if (fastPath.pipelineFastPath && fastPath.syntheticPipeline) {
            payload.inferredPipeline = fastPath.syntheticPipeline;
        }

        await applyComposition(inst, payload);
        return { ok: true, reason, pipelineFastPath: fastPath.pipelineFastPath };
    } catch (err) {
        return { ok: false, reason: String(err?.message ?? err) };
    }
}

// --------------------------- execution-report helper -----------------------
// Moved to sibling execution-report-apply.mjs (per-phase pipeline reporting).
