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
    looksLikeUnfilledTemplate,
    pickNewestSubdir,
} from "./project-scanner/fs-helpers.mjs";
import {
    scanScaffoldedSkills,
    hydrateSpecPhases,
} from "./project-scanner/spec-phases.mjs";
import { hydrateExtensionArtifactsFromCache } from "./project-scanner/extension-artifacts.mjs";
import { scanPresetCatalog, normalizePresetList } from "./project-scanner/preset-catalog.mjs";
import { readMarkdownArtifact, extractMarker } from "./project-scanner/markdown.mjs";

export { readMarkdownArtifact };

// Composition is read exclusively from `specify artifact list --json` (see
// composition/artifact-cli.mjs) and overlaid via `overlayCachedComposition`.
// No direct fs read here for presets or extensions — see AGENTS.md:
// "CLI is the source of truth for composition. No direct fs reads. Ever."

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
        phases.constitution = { ...phases.constitution, artifactPath: constitutionPath };
        // File presence alone is not enough: `specify init` scaffolds the
        // template with placeholder tokens like [PROJECT_NAME]. Only mark
        // the phase done once those placeholders have been filled in. If
        // state.json remembers a stale `done` but the file is back to
        // template-shaped, downgrade to empty — grounding rules trump
        // stored state.
        const unfilled = await looksLikeUnfilledTemplate(constPath, deps);
        if (unfilled) {
            if (phases.constitution.status === "done") phases.constitution.status = "empty";
        } else if (phases.constitution.status === "empty") {
            phases.constitution.status = "done";
        }
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

    // Composition — no direct fs read. `scanComposition` used to look at
    // `.specify/{presets,extensions}.json` which no `specify` CLI version
    // ever wrote (dead code). The wizard's real composition data comes from
    // `runFastComposition` (CLI-driven, see composition/artifact-cli.mjs)
    // and is applied via `overlayCachedComposition` after this scan runs.
    // Start empty so the overlay step has a clean base.
    const composition = { presets: [], extensions: [] };

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
