// speckit-wizard — workspace scanner
//
// scanWorkspace(workspacePath, deps) → normalized state object.
// The single normalization boundary for all LLM-produced artifacts we read.
// Zero SDK, zero network, size-bounded, subprocess-optional (deps.runProbe).

import { join, relative } from "node:path";
import { DEFAULT_STATE } from "./canvas-runtime/wizard-phases.mjs";
import { readState } from "./state/store.mjs";
import { loadPresetGraph } from "./composition/preset-loader.mjs";
import {
    toPortable,
    SKIP_DIRS,
    emptyPhases,
    pickNewestSubdir,
    readBoundedJson,
} from "./project-scanner/fs-helpers.mjs";
import {
    scanScaffoldedSkills,
    hydrateSpecPhases,
} from "./project-scanner/spec-phases.mjs";
import { hydrateExtensionArtifactsFromCache } from "./project-scanner/extension-artifacts.mjs";
import { scanPresetCatalog, normalizePresetList } from "./project-scanner/preset-catalog.mjs";
import { readMarkdownArtifact, extractMarker } from "./project-scanner/markdown.mjs";

export { readMarkdownArtifact };

// -------- Section: shallow composition inventory (was composition/scan.mjs) --------
// Reads the two summary manifests the `specify` CLI writes when presets or
// extensions are installed:
//   • `.specify/presets.json`    — one line per installed preset
//   • `.specify/extensions.json` — one line per installed extension
// and folds them into the `{ presets, extensions }` shape the composition
// state slice stores. Each entry is just `{ id, name, source, version,
// description }` — no commands, no templates, no phase graph.
//
// This is the **fast-path inventory** — "what's installed and by what
// name" — used to populate the composition slice's tiles (Composition tab,
// stepper badges, Ops panel dropdowns). It touches only the two summary
// JSONs, so it's cheap enough to run on every boot / refresh.
//
// `composition/preset-loader.mjs` is the **deep-detail loader** — it walks
// `.specify/presets/.registry`, every `<id>/preset.yml`, and every
// `<id>/commands/<file>.md` to produce a resolved phase graph with
// hooks, user-input hints, and per-command bodies. That output drives the
// phase card and the pipeline graph — not just the inventory listing.
async function scanComposition(workspacePath, deps) {
    const specifyDir = join(workspacePath, ".specify");
    if (!(await deps.pathExists(specifyDir))) return { presets: [], extensions: [] };

    const tryJson = async (relPath) => {
        const p = join(workspacePath, relPath);
        if (!(await deps.pathExists(p))) return [];
        const raw = await readBoundedJson(p, deps);
        if (!raw) return [];
        const items = Array.isArray(raw) ? raw : [raw];
        const out = [];
        for (const item of items) {
            if (!item || typeof item !== "object") continue;
            const name = typeof item.name === "string" ? item.name : null;
            if (!name) continue;
            out.push({
                id: typeof item.id === "string" ? item.id : name,
                name,
                source: typeof item.source === "string" ? item.source : "catalog",
                version: typeof item.version === "string" ? item.version : null,
                description: typeof item.description === "string" ? item.description : "",
            });
        }
        return out;
    };
    const presets = await tryJson(".specify/presets.json");
    const extensions = await tryJson(".specify/extensions.json");
    return { presets, extensions };
}

// deps shape:
//   readFile(path, enc)     → Promise<string>
//   stat(path)              → Promise<{ isFile, isDirectory, mtimeMs, size }>
//   readdir(path, opts)     → Promise<Dirent[]>
//   pathExists(path)        → Promise<boolean>
//   log(msg, level?)        → Promise<void>
export async function scanWorkspace(workspacePath, deps) {
    const warnings = [];
    if (!workspacePath || typeof workspacePath !== "string") {
        return {
            workspacePath: null,
            projectInitialized: false,
            setup: { ...DEFAULT_STATE.setup },
            preset: DEFAULT_STATE.preset,
            currentPhase: DEFAULT_STATE.currentPhase,
            phases: emptyPhases(),
            slug: null,
            specsDir: null,
            constitutionPath: null,
            composition: { presets: [], extensions: [] },
            catalog: { presets: [], sources: [] },
            warnings: ["scanWorkspace: no workspace path"],
        };
    }

    const specifyDir = join(workspacePath, ".specify");
    const specifyExists = await deps.pathExists(specifyDir);

    // Scan .github/skills/speckit-* directories — FS truth for scaffolded
    // skills, independent of the cached env probe (which is wiped on
    // extension reload). The UI's "Initialize the project" chip uses this
    // to render the .github/skills pill vs "skills not scaffolded".
    const scaffoldedSkills = await scanScaffoldedSkills(workspacePath, deps);

    // Control-plane state.json (defensive read).
    const stateResult = await readState(workspacePath, deps);
    warnings.push(...stateResult.warnings);
    const stateFromDisk = stateResult.state;

    // Merge in filesystem-derived phase status. Scanner-visible truth trumps
    // whatever state.json claims — grounding rule.
    const phases = { ...stateFromDisk.phases };

    let slug = null;
    let specsDir = null;
    let constitutionPath = null;

    // Constitution.
    const constPath = join(workspacePath, ".specify", "memory", "constitution.md");
    if (await deps.pathExists(constPath)) {
        constitutionPath = toPortable(relative(workspacePath, constPath));
        phases.constitution = {
            ...phases.constitution,
            artifactPath: constitutionPath,
            status: phases.constitution.status === "empty" ? "done" : phases.constitution.status,
        };
    }

    // Specs — pick the most recently modified dir under specs/.
    const specsRoot = join(workspacePath, "specs");
    if (await deps.pathExists(specsRoot)) {
        const chosen = await pickNewestSubdir(specsRoot, deps);
        if (chosen) {
            slug = chosen.name;
            specsDir = toPortable(relative(workspacePath, chosen.path));
            await hydrateSpecPhases({
                cwd: workspacePath,
                specDir: chosen.path,
                phases,
                deps,
            });
        }
    }

    // Extension-command artifacts: read author-declared (or LLM-inferred)
    // targets from `.speckit-wizard/artifact-targets.json` and hydrate
    // `phases['commands/<cmd-id>']` with the artifact path so the phase
    // card can render a live "Writes to" link. See
    // hydrateExtensionArtifactsFromCache. A missing / stale cache is
    // silent; the phase card just shows "no artifact declared".
    await hydrateExtensionArtifactsFromCache({
        cwd: workspacePath,
        phases,
        slug: slug ?? null,
        deps,
    }).catch((err) => {
        warnings.push(`hydrateExtensionArtifactsFromCache failed: ${err?.message ?? err}`);
    });

    // Composition — read layered manifests. LLM-produced JSON here is
    // defensively normalized: accept alias values, coerce string → array,
    // drop invalid entries.
    const composition = await scanComposition(workspacePath, deps).catch((err) => {
        warnings.push(`scanComposition failed: ${err?.message ?? err}`);
        return { presets: [], extensions: [] };
    });

    // Preset catalog — from CLI-authored catalog.json inside .specify/.
    const catalog = await scanPresetCatalog(workspacePath, deps).catch((err) => {
        warnings.push(`scanPresetCatalog failed: ${err?.message ?? err}`);
        return { presets: [{ id: "core", name: "core", source: "builtin", version: null }], sources: [] };
    });

    const setup = {
        ...stateFromDisk.setup,
        projectInitialized: specifyExists || stateFromDisk.setup.projectInitialized,
        // If .specify/ is gone from disk, the project needs to be re-inited
        // and skills re-loaded — clear the sticky success flag so the
        // "first successful reload after init" gate applies again. Once
        // specifyExists is true and the user has done a successful reload
        // in this session, this line never clobbers the true value.
        skillsReloaded: specifyExists ? stateFromDisk.setup.skillsReloaded : false,
    };

    // Phase graph — resolves preset(s) on disk into the runtime command list.
    // Falls back to an empty core-only graph when nothing is installed; the
    // wizard's Phases tab synthesizes canonical cards from
    // `pipeline/canonical.mjs` on top of whatever this returns.
    let phaseGraph;
    try {
        const g = await loadPresetGraph(workspacePath, deps);
        phaseGraph = {
            presets: g.presets.map((p) => ({
                id: p.id,
                name: p.name,
                version: p.version,
                priority: p.priority,
                enabled: p.enabled !== false,
                source: p.source,
            })),
            activePresetId: g.activePreset?.id ?? null,
            commands: g.commands,
            registryMtimeMs: g.registryMtimeMs,
        };
        for (const w of g.warnings) warnings.push(w);
    } catch (err) {
        warnings.push(`loadPresetGraph failed: ${err?.message ?? err}`);
        phaseGraph = { presets: [], activePresetId: null, commands: [], registryMtimeMs: null };
    }

    return {
        workspacePath,
        projectInitialized: specifyExists,
        setup,
        preset: stateFromDisk.preset,
        currentPhase: stateFromDisk.currentPhase,
        phases,
        pipeline: stateFromDisk.pipeline ?? null,
        slug,
        specsDir,
        constitutionPath,
        composition,
        catalog,
        phaseGraph,
        scaffoldedSkills,
        warnings,
    };
}

// Exposed for tests only.
export const _internal = { normalizePresetList, extractMarker, SKIP_DIRS };
