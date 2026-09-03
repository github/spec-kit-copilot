// speckit-wizard — pure renderer
//
// The renderer is pure — no I/O, no fetch, no side effects. It exposes a
// single function:
//
//   • buildStateSnapshot(state): folds scanner state + normalized state.json
//     into the compact JSON payload the client-side UI consumes. This is what
//     GET /api/state and SSE messages ship over the wire.
//
// The interactive UI lives entirely in ui/app.js and its render modules; the
// server does not emit HTML fragments.

import { PHASE_ORDER, PHASE_BY_ID } from "./wizard-phases.mjs";
import { deriveSetupPhaseStatus } from "../state/store.mjs";

// -------- Compact state snapshot ------------------------------------------
export function buildStateSnapshot(scan) {
    // scan is the output of scanner.scanWorkspace, plus optional env probe
    // report + skillsReloaded flag. All values must be plain-serializable.
    if (!scan) {
        return {
            workspacePath: null,
            projectInitialized: false,
            setup: { pluginInstalled: false, cliInstalled: false, projectInitialized: false, skillsReloaded: false, catalogsLoaded: false },
            preset: "core",
            currentPhase: "setup",
            slug: null,
            specsDir: null,
            phases: emptyPhases(),
            pipeline: null,
            composition: { presets: [], extensions: [] },
            catalog: { presets: [{ id: "core", name: "core", source: "builtin", active: true }] },
            environment: null,
            boot: null,
            depsError: null,
            activeRuns: [],
            warnings: [],
        };
    }
    const phases = {};
    for (const id of PHASE_ORDER) {
        const scanned = scan.phases?.[id] ?? {};
        const meta = PHASE_BY_ID[id];
        phases[id] = {
            id,
            name: meta.name,
            tagline: meta.tagline,
            optional: !!meta.optional,
            conversation: !!meta.conversation,
            special: meta.special ?? null,
            gated: !!meta.gated,
            artifact: meta.artifact,
            status: scanned.status ?? "empty",
            lastRunAt: scanned.lastRunAt ?? null,
            formValues: scanned.formValues ?? {},
            artifactPath: scanned.artifactPath ?? null,
        };
    }
    // Forward any extension-command status slices set by the scanner (keyed
    // `commands/<full-cmd-id>`). PHASE_ORDER only enumerates core phases, so
    // without this pass the extension entries hydrated by
    // `hydrateExtensionArtifacts` would be dropped before reaching the graph
    // renderer at L229 where `statusPhases[cmd.id]` is looked up.
    if (scan.phases && typeof scan.phases === "object") {
        for (const [id, slice] of Object.entries(scan.phases)) {
            if (!id.startsWith("commands/")) continue;
            if (phases[id]) continue;
            phases[id] = {
                id,
                status: slice?.status ?? "empty",
                artifactPath: slice?.artifactPath ?? null,
                lastRunAt: slice?.lastRunAt ?? null,
                formValues: slice?.formValues ?? {},
                // LLM-inferred metadata from artifact-targets.json cache (via
                // hydrateExtensionArtifactsFromCache). The UI reads these to
                // render the phase tagline and args-input overlay for
                // extension commands. Omit-if-missing so the UI fallback
                // chain (PHASE_TAGLINE_OVERRIDES → helpText) still works.
                ...(slice?.description ? { description: slice.description } : {}),
                ...(slice?.argsHint ? { argsHint: slice.argsHint } : {}),
                ...(slice?.argsWhenEmpty ? { argsWhenEmpty: slice.argsWhenEmpty } : {}),
                // "Browse folder" fallback — set only when the inferred
                // artifact filename is wrong (file missing, folder present).
                ...(slice?.folderPath ? { folderPath: slice.folderPath } : {}),
            };
        }
    }
    // Keep every downstream surface behind the same durable setup milestone
    // used by the client. Project files alone are not enough: the prerequisite
    // checks and skill reload must also have completed.
    //
    // Plugin / CLI presence: accept EITHER the live env probe (source of
    // truth for the Setup checklist rows via `isStepDone` in the client) OR
    // the persisted `setup.*` flag. Nothing in the current flow writes
    // `setup.pluginInstalled` or `setup.cliInstalled` to state.json — the
    // probe result is cached in-memory only — so without this OR every
    // phase card stays locked forever even when the checklist shows both
    // rows ✓ and the client's `isSetupComplete()` returns true.
    const env = scan.environment ?? {};
    const pluginOk = !!scan.setup?.pluginInstalled || !!env.pluginInstalled;
    const cliOk = !!scan.setup?.cliInstalled || !!env.cliInstalled;
    const gateOpen = pluginOk &&
        cliOk &&
        !!scan.setup?.projectInitialized &&
        !!scan.setup?.skillsReloaded;
    for (const id of PHASE_ORDER) {
        if (id === "setup") continue;
        phases[id].locked = !gateOpen;
    }
    // Skills reload results remain available in state.json for diagnostics.
    // taskstoissues is gated on a preset that contributes it. Ungate if a
    // provider is discovered in the composition; otherwise leave the metadata
    // default (gated).
    if (phases.taskstoissues) {
        const hasProvider = (scan.composition?.extensions ?? []).some(
            (e) => e.name === "speckit-taskstoissues" || (e.description ?? "").includes("taskstoissues"),
        );
        phases.taskstoissues.gated = !hasProvider;
    }

    // Re-derive phases.setup.status with the live env probe. state-store's
    // applyPatch/normalizeState derive it from persisted setup.* only —
    // which stays yellow ("in_progress") until pluginInstalled/cliInstalled
    // are written to state.json. Nothing writes those flags (they're
    // in-memory env probe results), so without this override the overall
    // setup stepper would never flip green even when both tools are on
    // disk. Same OR-with-env pattern as the gate check above.
    if (phases.setup) {
        phases.setup.status = deriveSetupPhaseStatus(scan.setup, env);
    }

    return {
        workspacePath: scan.workspacePath ?? null,
        projectInitialized: !!scan.projectInitialized,
        setup: scan.setup ?? { pluginInstalled: false, cliInstalled: false, projectInitialized: false, skillsReloaded: false, catalogsLoaded: false },
        preset: scan.preset ?? "core",
        currentPhase: scan.currentPhase ?? "setup",
        slug: scan.slug ?? null,
        specsDir: scan.specsDir ?? null,
        phases,
        commands: buildCommands(scan, phases),
        pipeline: Array.isArray(scan.pipeline) ? scan.pipeline.slice() : null,
        activePresetId: scan.phaseGraph?.activePresetId ?? "core",
        presets: scan.phaseGraph?.presets ?? [],
        composition: scan.composition ?? { presets: [], extensions: [] },
        catalog: scan.catalog ?? { presets: [] },
        environment: scan.environment ?? null,
        boot: scan.boot ?? null,
        depsError: scan.depsError ?? null,
        activeRuns: Array.isArray(scan.activeRuns) ? scan.activeRuns : [],
        scaffoldedSkills: Array.isArray(scan.scaffoldedSkills) ? scan.scaffoldedSkills : [],
        warnings: Array.isArray(scan.warnings) ? scan.warnings.slice(0, 20) : [],
    };
}

/**
 * Emit the flat command list for the UI.
 *
 * Every entry is a projection of a preset command descriptor (from
 * preset-loader) enriched with runtime status (from state.phases) and
 * lock/gate flags. Ordering follows the scanner's registry order — the
 * effective pipeline (user pin → LLM-inferred → canonical fallback) is
 * computed downstream in `pipeline/effective-phases.mjs`.
 *
 * Handoffs are passed through as raw metadata for the "Suggested next"
 * chip on each command tile; this builder does NOT walk the handoff
 * graph or compute any spine.
 *
 * @param {object} scan          The workspace scan output.
 * @param {object} statusPhases  Per-phase runtime status keyed by id.
 */
function buildCommands(scan, statusPhases) {
    const g = scan?.phaseGraph;
    if (!g || !Array.isArray(g.commands) || !g.commands.length) return [];
    const setupGateOpen = !!scan.setup?.projectInitialized;

    const out = [];
    for (const cmd of g.commands) {
        // Reuse the on-disk status when the command id matches a canonical
        // phase (constitution, specify, plan, tasks, analyze, checklist).
        // Otherwise default to "empty" — the runtime interaction loop will
        // mark it done via /api/phase/status when Copilot writes the artifact.
        const status = statusPhases?.[cmd.id]?.status ?? "empty";
        let artifactPath = statusPhases?.[cmd.id]?.artifactPath ?? cmd.artifact ?? null;
        if (typeof artifactPath === "string" && artifactPath.includes("<slug>") && scan.slug) {
            artifactPath = artifactPath.replace(/<slug>/g, scan.slug);
        }
        // Pass handoffs through as raw metadata for the "Suggested next"
        // chip on command tiles (see ui/render/phase-card.js:computeSuggestedNext).
        const handoffs = Array.isArray(cmd.handoffs)
            ? cmd.handoffs.map((h) => ({
                  label: h.label,
                  agent: h.agent,
                  prompt: h.prompt ?? "",
                  send: h.send === true,
              }))
            : [];
        out.push({
            id: cmd.id,
            commandName: cmd.name,
            shortLabel: deriveShortLabel(cmd.name, cmd.id),
            title: cmd.description || cmd.name,
            helpText: cmd.description || "",
            handoffs,
            optional: !!cmd.optional,
            artifact: cmd.artifact ?? null,
            artifactPath,
            status,
            locked: !setupGateOpen,
            source: cmd.source ?? "core",
        });
    }
    return out;
}

/**
 * Derive a short, human-friendly stepper label from a command name / id.
 * Examples: "speckit.constitution" -> "Constitution",
 *           "speckit.task-to-issues" -> "Task to issues",
 *           "custom-phase" (id fallback) -> "Custom phase".
 * The tail after the last dot is preferred (dot-form is the workflow slash
 * command). Hyphens/underscores are turned into spaces, first letter is
 * capitalized. Kept in the renderer so tests can exercise the shape.
 */
function deriveShortLabel(name, id) {
    let raw = String(name ?? id ?? "").trim();
    if (raw.includes(".")) raw = raw.split(".").pop() ?? "";
    if (!raw) raw = String(id ?? "").trim();
    raw = raw.replace(/[-_]+/g, " ").trim();
    if (!raw) return "Phase";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function emptyPhases() {
    const out = {};
    for (const id of PHASE_ORDER) {
        const meta = PHASE_BY_ID[id];
        out[id] = {
            id,
            name: meta.name,
            tagline: meta.tagline,
            optional: !!meta.optional,
            conversation: !!meta.conversation,
            special: meta.special ?? null,
            gated: !!meta.gated,
            artifact: meta.artifact,
            status: "empty",
            lastRunAt: null,
            formValues: {},
            artifactPath: null,
            locked: id !== "setup",
        };
    }
    return out;
}
