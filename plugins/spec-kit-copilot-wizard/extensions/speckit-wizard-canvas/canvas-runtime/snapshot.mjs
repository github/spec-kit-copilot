// speckit-wizard-canvas — the "snapshot" module.
//
// This is the *read-side* of the wizard's server-to-client flow. Every time
// the wizard canvas needs to hand the UI a fresh picture of the world, it calls
// `snapshot(inst)` from here. This module doesn't own any state on its own —
// it composes state that lives elsewhere into ONE object the UI can render.
//
// What `snapshot()` actually does, step by step:
//   1. Reads the live workspace off disk via `scanWorkspace()` — finds the
//      installed presets/extensions/bundles, the current phase, phase form
//      values, and the .specify/ init state.
//   2. Overlays `inst.cachedProbes.summary` onto `scan.environment` so
//      Setup shows detected CLI / plugin versions from the last background
//      env probe (`ensureEnvProbe`), which runs asynchronously.
//   3. Runs it through the renderer (`buildStateSnapshot`) so the shape
//      matches what the UI expects (`phases[]`, `catalog`, `composition`, …).
//   4. Overlays cached data that isn't derivable from a disk scan alone:
//        - `cachedPresetItems` / `cachedExtensionItems` / `cachedBundleItems`
//          come from the last `showPresetCatalog` / `showExtensionCatalog` /
//          `showBundleCatalog` skill push (they carry catalog metadata like
//          summaries/tags that aren't in `.specify/`). Preset items get
//          their `active` flag refreshed against the scanner's ground-truth
//          install set so installs performed outside the wizard aren't
//          left showing stale `active: false`.
//        - `cachedCatalogSources` / `cachedExtensionCatalogSources` /
//          `cachedBundleCatalogSources` — the catalog-source registries the
//          skills pushed on the last refresh.
//        - `cachedComposition` comes from the fast-assembler's last
//          `applyComposition` call — full artifact stacks + inferredPipeline.
//   5. Stamps a `catalog.fingerprint` so the server can detect when the
//      composition changed and mark execution reports stale.
//   6. Attaches the transient `skillsReload` diagnostic (populated by
//      `/api/skills/reload`) so the UI can gate setup completion on the
//      live SDK result rather than a persisted flag or a folder probe.
//   7. Also *writes* a slim slice of the snapshot back into `inst.state`
//      (`currentPhase`, `preset`, `setup`, `phases[]`) so that
//      `persistAndBroadcast` has a valid base to merge patches into on the
//      next canvas action.
//   8. Returns the snapshot object. Callers broadcast it verbatim to the
//      UI over the SSE `state` frame.
//
// Callers:
//   - `persistAndBroadcast` in canvas-runtime/composition-apply.mjs — runs
//     after every canvas action.
//   - `canvas-runtime/watchers.mjs` — the state.json watcher and the
//     .specify/specs artifact watcher, on file change.
//   - `extension.mjs` — bound as `getState` for the server layer (fans
//     out to SSE / `/api/state` in server.mjs, plus `runSkillsReload` in
//     server/handlers-ops.mjs), post-env-probe rebroadcast, and the
//     boot-time first snapshot after `runFastComposition`.


import { PHASE_ORDER } from "./wizard-phases.mjs";
import { scanWorkspace } from "../project-scanner.mjs";
import { buildStateSnapshot } from "./snapshot-builder.mjs";
import { applyPatch, overlayCachedComposition, activeFingerprint } from "../state/store.mjs";
import { fsDeps } from "./instances.mjs";
import { activeRunsSnapshot, reconcileRunsWithPhases } from "./run-tracker.mjs";

export async function snapshot(inst) {
    // Preset precedence: consume the order the `speckit-preset` skill
    // published on its last refresh (cached in inst.cachedComposition
    // and mirrored to state.json). That order came from the CLI via the
    // skill, so the wizard's scanner and its Composition tab agree by
    // construction — no direct CLI shelling here, no local sort.
    // Uses registry order until the skill publishes a resolved order.
    const presetOrder = Array.isArray(inst.cachedComposition?.presets)
        ? inst.cachedComposition.presets.map((p) => p?.id).filter(Boolean)
        : null;
    const scanDeps = presetOrder && presetOrder.length
        ? { ...fsDeps, presetOrder }
        : fsDeps;
    const scan = await scanWorkspace(inst.workspacePath, scanDeps);
    inst.cwdBoundState = scan;
    // Merge cached env probe results into the snapshot.
    if (inst.cachedProbes?.summary) {
        scan.environment = inst.cachedProbes.summary;
    }
    // Overlay boot progress + deps error so the UI's initial fetch
    // reflects live state without waiting for the next SSE event.
    if (inst.boot) scan.boot = inst.boot;
    if (inst.depsError) scan.depsError = inst.depsError;
    reconcileRunsWithPhases(scan.phases);
    scan.activeRuns = activeRunsSnapshot();
    // Setup step "done" state is derived live from `scan.environment` (plugin
    // and CLI probes) and `scan.projectInitialized` (fs check on .specify/),
    // NOT from persisted setup.* flags — those drift when things are
    // installed/uninstalled outside the wizard.
    const snap = buildStateSnapshot(scan);
    if (inst.cachedPresetItems?.length) {
        // Overlay fresh install truth from the disk-based scan onto cached
        // catalog items — cachedPresetItems is only re-hydrated when a skill
        // pushes showPresetCatalog (or on bootstrap), so an install performed
        // outside the wizard (or after the last skill push) would otherwise
        // leave `active: false` on presets that are actually installed. The
        // scanner reads `.specify/presets/.registry` on every snapshot, so
        // scan.phaseGraph.presets is always ground truth.
        const installedIds = new Set(
            (scan.phaseGraph?.presets ?? [])
                .filter((p) => p.source !== "builtin")
                .map((p) => p.id),
        );
        const installedNames = new Set(
            (scan.phaseGraph?.presets ?? [])
                .filter((p) => p.source !== "builtin")
                .map((p) => String(p.name ?? "").toLowerCase()),
        );
        const refreshed = inst.cachedPresetItems.map((item) => {
            const idMatch = installedIds.has(item.installedId ?? item.id);
            const nameMatch = installedNames.has(String(item.name ?? "").toLowerCase());
            const isActive = idMatch || nameMatch;
            return item.active === isActive ? item : { ...item, active: isActive };
        });
        snap.catalog = {
            ...(snap.catalog ?? {}),
            presets: refreshed,
        };
    }
    if (inst.cachedCatalogSources) {
        snap.catalog = {
            ...(snap.catalog ?? {}),
            sources: [...inst.cachedCatalogSources],
        };
    }
    if (inst.cachedExtensionItems?.length) {
        snap.catalog = {
            ...(snap.catalog ?? {}),
            extensions: [...inst.cachedExtensionItems],
        };
    }
    if (inst.cachedExtensionCatalogSources) {
        snap.catalog = {
            ...(snap.catalog ?? {}),
            extensionSources: [...inst.cachedExtensionCatalogSources],
        };
    }
    if (inst.cachedBundleItems?.length) {
        snap.catalog = {
            ...(snap.catalog ?? {}),
            bundles: [...inst.cachedBundleItems],
        };
    }
    if (inst.cachedBundleCatalogSources) {
        snap.catalog = {
            ...(snap.catalog ?? {}),
            bundleSources: [...inst.cachedBundleCatalogSources],
        };
    }
    // Stamp the current-catalog fingerprint. Used server-side to detect
    // execution-report staleness when the composition changes (see
    // `applyComposition`). Recomputed on every snapshot so an
    // install/remove/version-bump anywhere is immediately reflected without
    // a side-array to keep in sync.
    if (snap.catalog) {
        snap.catalog.fingerprint = activeFingerprint(snap.catalog);
    }
    if (inst.cachedComposition) {
        const overlay = overlayCachedComposition(inst.cachedComposition);
        if (overlay) snap.composition = overlay;
    }
    // Expose the transient skills-reload diagnostic (populated by
    // /api/skills/reload) so the UI can gate setup completion on the
    // live SDK result rather than a persisted flag or a folder probe.
    snap.skillsReload = inst.skillsReload ?? null;
    inst.state = applyPatch(inst.state ?? {}, {
        currentPhase: scan.currentPhase,
        preset: scan.preset,
        setup: scan.setup,
        phases: Object.fromEntries(
            PHASE_ORDER.map((id) => [id, scan.phases[id] ?? {}]),
        ),
    });
    return snap;
}
