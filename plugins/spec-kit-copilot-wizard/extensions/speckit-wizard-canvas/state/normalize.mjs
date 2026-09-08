// speckit-wizard — full-state & phase-slice normalization
//
// The core normalize-on-read layer. Owns:
//   * ALLOWED_STATUSES / SETUP_STATUS_KEYS       — closed vocabularies for
//                                                   phase-slice status and
//                                                   the setup phase's sub-flags.
//   * coerceBool / coerceIsoString / coerceStringArray — defensive value-
//                                                   normalizers on top of raw
//                                                   JSON-decoded values.
//   * deriveSetupPhaseStatus                     — single source of truth for
//                                                   phases.setup.status; the
//                                                   four setup.* sub-flags win.
//   * normalizePhaseSlice                        — one PHASE_ORDER slice at a
//                                                   time; status alias
//                                                   collapsing + optional
//                                                   scanner-hydrated metadata.
//   * normalizeState                             — full `.speckit-wizard/
//                                                   state.json` shape guard;
//                                                   composes the other three
//                                                   with pipeline + execution-
//                                                   report normalization.
//
// Extracted verbatim from state/store.mjs. No behavior changes.

import { PHASE_ORDER, PHASE_BY_ID, DEFAULT_STATE, emptyPhaseSlice } from "../canvas-runtime/wizard-phases.mjs";
import { normalizePipeline } from "../pipeline/validate.mjs";
import { normalizeExecutionReports } from "./execution-reports.mjs";

// -------- Section: primitive coercers --------
// Defensive value-normalizers used across the state-store. Each is a pure
// function on top of a raw JSON-decoded value; none of them touch disk or
// state.

export function coerceBool(v, fallback = false) {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
        if (/^(true|1|yes|on)$/i.test(v)) return true;
        if (/^(false|0|no|off)$/i.test(v)) return false;
    }
    if (typeof v === "number") return v !== 0;
    return fallback;
}

export function coerceIsoString(v) {
    if (typeof v !== "string") return null;
    const t = Date.parse(v);
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString();
}

// Accept string as one-element array; drop entries that aren't strings.
export function coerceStringArray(v) {
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    if (typeof v === "string" && v.length) return [v];
    return [];
}

// -------- Section: normalization --------

const ALLOWED_STATUSES = new Set(["empty", "in_progress", "done", "skipped", "error"]);

// The four sub-flags that together define the setup phase's progress. Kept
// in sync with SETUP_KEYS in ui/app.js. `catalogsLoaded` is intentionally
// excluded: it's a lazy background hydrate, not a required setup step.
// `skillsReloaded` reflects a *transient*, session-scoped fact — whether
// this Copilot process's in-memory skill registry has been refreshed via
// `session.rpc.skills.reload()` since the skills were scaffolded on disk.
// It is persisted so the UI can render green without waiting for a
// re-verification round-trip, but the wizard resets it to `false` on
// boot (see `hydrateOnce` in extension.mjs) whenever the current process
// has not yet performed a reload. That way a prior session's success
// never falsely satisfies the current session's requirement.
const SETUP_STATUS_KEYS = ["pluginInstalled", "cliInstalled", "projectInitialized", "skillsReloaded"];

// Single source of truth for the setup phase status. Callers must never
// write `phases.setup.status` directly — it's always derived from the four
// `setup.*` sub-flags in `.speckit-wizard/state.json`. Any inbound
// `setPhaseStatus({ phase: "setup", ... })` write is overridden by this
// derivation on the next normalize/apply pass, so the stepper chip and the
// setup card body can never disagree about "am I done?".
// Compute phases.setup.status from the four sub-flags in
// `.speckit-wizard/state.json`. Callers may not write
// `phases.setup.status` directly — the four `setup.*` sub-flags are the
// single source of truth. Any inbound `setPhaseStatus({ phase: "setup",
// ... })` write is overridden by this derivation on the next
// normalize/apply pass, so the stepper chip and the setup card body can
// never disagree about "am I done?".
//
// `env` (optional): live probe results from the scanner. If present,
// `env.pluginInstalled` / `env.cliInstalled` are OR'd with the persisted
// sub-flags before counting. This mirrors the gate check in renderer.mjs
// (`pluginOk = !!scan.setup?.pluginInstalled || !!env.pluginInstalled`),
// so the overall setup status flips green as soon as the env probe sees
// the tool on disk — no manual persistence step required. Pure
// state.json-level callers (applyPatch, normalizeState) pass no env and
// get the pure persisted view.
export function deriveSetupPhaseStatus(setup, env = null) {
    if (!setup || typeof setup !== "object") return "empty";
    const isDone = (k) => {
        if (!!setup[k]) return true;
        if (env && (k === "pluginInstalled" || k === "cliInstalled")) {
            return !!env[k];
        }
        return false;
    };
    const done = SETUP_STATUS_KEYS.filter(isDone).length;
    if (done === SETUP_STATUS_KEYS.length) return "done";
    if (done > 0) return "in_progress";
    return "empty";
}


export function normalizePhaseSlice(phaseId, raw) {
    const base = emptyPhaseSlice(phaseId);
    if (!raw || typeof raw !== "object") return base;

    let status = String(raw.status ?? "empty").toLowerCase();
    // Alias values.
    if (status === "inprogress" || status === "in-progress" || status === "running") {
        status = "in_progress";
    }
    if (status === "complete" || status === "completed") status = "done";
    if (status === "skip") status = "skipped";
    if (!ALLOWED_STATUSES.has(status)) status = base.status;

    const formValues =
        raw.formValues && typeof raw.formValues === "object" && !Array.isArray(raw.formValues)
            ? raw.formValues
            : base.formValues;

    const artifactPath =
        typeof raw.artifactPath === "string" && raw.artifactPath.length
            ? raw.artifactPath
            : base.artifactPath;

    // Optional scanner-hydrated metadata (from artifact-targets.json cache
    // via the extension inference pass). Preserve when present so extension
    // phase cards can render taglines + input hints. Missing / empty →
    // omit the key entirely so the UI's fallback chain kicks in.
    const description =
        typeof raw.description === "string" && raw.description.length
            ? raw.description
            : null;
    const argsHint =
        typeof raw.argsHint === "string" && raw.argsHint.length
            ? raw.argsHint
            : null;
    const argsWhenEmpty =
        typeof raw.argsWhenEmpty === "string" && raw.argsWhenEmpty.length
            ? raw.argsWhenEmpty
            : null;

    return {
        status,
        optionalSkipped: coerceBool(raw.optionalSkipped, base.optionalSkipped),
        lastRunAt: coerceIsoString(raw.lastRunAt),
        formValues,
        artifactPath,
        ...(description ? { description } : {}),
        ...(argsHint ? { argsHint } : {}),
        ...(argsWhenEmpty ? { argsWhenEmpty } : {}),
    };
}

export function normalizeState(raw) {
    const base = {
        $schema: "speckit-wizard/v1",
        currentPhase: DEFAULT_STATE.currentPhase,
        preset: DEFAULT_STATE.preset,
        setup: { ...DEFAULT_STATE.setup },
        phases: {},
        pipeline: null,
    };
    for (const id of PHASE_ORDER) base.phases[id] = emptyPhaseSlice(id);

    if (!raw || typeof raw !== "object") return base;

    const cp = typeof raw.currentPhase === "string" ? raw.currentPhase : null;
    if (cp && PHASE_BY_ID[cp]) base.currentPhase = cp;

    if (typeof raw.preset === "string" && raw.preset.length) base.preset = raw.preset;

    if (raw.setup && typeof raw.setup === "object") {
        base.setup = {
            pluginInstalled: coerceBool(raw.setup.pluginInstalled, false),
            cliInstalled: coerceBool(raw.setup.cliInstalled, false),
            projectInitialized: coerceBool(raw.setup.projectInitialized, false),
            skillsReloaded: coerceBool(raw.setup.skillsReloaded, false),
            catalogsLoaded: coerceBool(raw.setup.catalogsLoaded, false),
        };
    }

    if (raw.phases && typeof raw.phases === "object") {
        for (const id of PHASE_ORDER) {
            const slice = raw.phases[id];
            base.phases[id] = normalizePhaseSlice(id, slice);
        }
    }

    if (Object.prototype.hasOwnProperty.call(raw, "pipeline")) {
        base.pipeline = normalizePipeline(raw.pipeline);
    }

    // Derive phases.setup.status from setup.* sub-flags. This is the single
    // source of truth for the setup phase's progress — see the note on
    // deriveSetupPhaseStatus.
    base.phases.setup = {
        ...base.phases.setup,
        status: deriveSetupPhaseStatus(base.setup),
    };

    // Composition is a derived cache written by the fast assembler
    // (`applyComposition`) plus the LLM `showInferredPipeline` action.
    // We shallow-preserve it so the UI can render instantly after a
    // restart without re-running ~20 CLI calls. `showPresetCatalog` clears
    // this field on any wizard-driven preset install/remove.
    if (raw.composition && typeof raw.composition === "object") {
        const c = raw.composition;
        base.composition = {
            presets: Array.isArray(c.presets) ? c.presets : [],
            extensions: Array.isArray(c.extensions) ? c.extensions : [],
            artifacts: Array.isArray(c.artifacts) ? c.artifacts : [],
            refreshedAt: typeof c.refreshedAt === "string" ? c.refreshedAt : null,
        };
        // LLM-inferred pipeline (validated on write by applyComposition — we
        // just round-trip the shape here). Drop silently if malformed.
        if (c.inferredPipeline && typeof c.inferredPipeline === "object") {
            const ip = c.inferredPipeline;
            const shape = ip.shape === "standalone" || ip.shape === "augmented-canonical" ? ip.shape : null;
            if (shape) {
                base.composition.inferredPipeline = {
                    shape,
                    pipeline: Array.isArray(ip.pipeline) ? ip.pipeline.filter((x) => typeof x === "string") : [],
                    unplaced: Array.isArray(ip.unplaced) ? ip.unplaced.filter((x) => typeof x === "string") : [],
                    rationale: typeof ip.rationale === "string" ? ip.rationale : "",
                };
            }
        }
        // Per-phase execution reports (produced by phase.viewExecution).
        // Same normalize-on-read guard so a hand-edited state.json can't
        // smuggle a malformed shape into the UI.
        const execRep = normalizeExecutionReports(c.executionReports);
        if (execRep) base.composition.executionReports = execRep;
        // Catalog-fingerprint stamp — the scalar that execution-report
        // staleness (applyComposition) compares against. Only server-owned
        // writers (applyComposition) set this; a legacy state.json without
        // it is treated as fingerprint-less on the next load.
        //
        // Backward compat: legacy state files with a single `fingerprint`
        // field are read as `compositionFingerprint`.
        if (c.builtFrom && typeof c.builtFrom === "object") {
            const bf = c.builtFrom;
            const composition = typeof bf.compositionFingerprint === "string"
                ? bf.compositionFingerprint
                : (typeof bf.fingerprint === "string" ? bf.fingerprint : null);
            if (composition) {
                base.composition.builtFrom = {
                    compositionFingerprint: composition,
                    catalogChangedAt: typeof bf.catalogChangedAt === "string"
                        ? bf.catalogChangedAt : null,
                };
            }
        }
    }
    return base;
}
