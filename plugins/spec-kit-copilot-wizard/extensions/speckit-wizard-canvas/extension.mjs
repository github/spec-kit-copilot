// speckit-wizard — extension entry point (sdk-adapter role).
//
// The ONLY module that imports `@github/copilot-sdk/extension`. All SDK-backed
// capabilities (session.send, session.log) are injected as `deps` into the
// server and other modules.
//
// Responsibilities:
//   • joinSession + createCanvas wiring (single canvas: speckit-wizard)
//   • lifecycle: onOpen wires per-instance state + server, hydrateOnce
//     bootstraps catalogs, onClose tears down server and drops the record
//   • fallback workspace resolver
//
// Snapshot pipeline, composition apply, and canvas action handlers live in
// sibling modules under ./extension/.
// No domain logic. No prompt strings. No skill names.

import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

import { readState } from "./state/store.mjs";
import { startServer } from "./server.mjs";
import { checkDeps, getDependencyDir, installDeps } from "./env/deps-check.mjs";
import { createBootTracker } from "./canvas-runtime/boot-progress.mjs";
// Composition retrieval is entirely LLM-driven via the `speckit-preset` +
// `speckit-extension` skills — see the `composition.refresh` case in
// prompts.mjs and the `applyComposition` helper in canvas-runtime/composition-apply.mjs.
// There is deliberately no native import that parses `preset.yml` /
// `extension.yml` / `.registry` here; catalog interpretation belongs to the
// skills and scanner.
import { fetchSessionRepoPath, resolveWorkspace, resolveGenerateCanvas } from "./env/workspace.mjs";
import { runtimeSettings } from "./env/runtime-settings.mjs";
import { generateCanvasInputSchema } from "./contracts/generate-feature.mjs";
import { fsDeps, sessionState, getInstance, allInstances, sessionAdapter, setSession, getSession } from "./canvas-runtime/instances.mjs";
import { ensureEnvProbe } from "./env/probe-cache.mjs";
import { startStateWatcher, stopStateWatcher, startArtifactWatcher, stopArtifactWatcher } from "./canvas-runtime/watchers.mjs";
import { hydratePresetsForSources } from "./catalog/presets.mjs";
import { hydrateExtensionsForSources } from "./catalog/extensions.mjs";
import { hydrateBundlesForSources } from "./catalog/bundles.mjs";
import { PRESET_CATALOG_URL, EXTENSION_CATALOG_URL, BUNDLE_CATALOG_URL } from "./catalog/sources.mjs";
import { hydrateCatalogGroups } from "./catalog/shared.mjs";
import { snapshot } from "./canvas-runtime/snapshot.mjs";
import { cancelBackgroundInference } from "./canvas-runtime/background-inference.mjs";
import { runFastComposition, normalizeHookArtifactsInComposition } from "./canvas-runtime/composition-apply.mjs";
import { phaseActions } from "./canvas-runtime/actions/phase.mjs";
import { clearCommandRunsForInstance } from "./canvas-runtime/command-run-tracker.mjs";
import { catalogActions } from "./canvas-runtime/actions/catalog.mjs";
import { compositionActions } from "./canvas-runtime/actions/composition.mjs";
import { pipelineActions } from "./canvas-runtime/actions/pipeline.mjs";
import { wizardShellActions } from "./canvas-runtime/actions/wizard-shell.mjs";
import { depsRecoveryActions } from "./canvas-runtime/actions/deps-recovery.mjs";

const ACTIONS = [...phaseActions, ...catalogActions, ...compositionActions, ...pipelineActions, ...wizardShellActions, ...depsRecoveryActions];

// --------------------------- per-instance registry --------------------------
// (record shape + `instances` Map now live in instances.mjs)
const instances = allInstances();

// --------------------------- workspace path resolver ------------------------
// Resolution order:
//   1. explicit ctx.input.cwd (canvas caller passed a path)
//   2. sessionState.repoPath — cached from session.rpc.metadata.snapshot() at
//      startup (workingDirectory / workspace.cwd / workspace.git_root). This
//      is the SDK-authoritative user repo checkout, e.g.
//      C:\...\copilot-worktrees\<project>\<branch>. Note: session.workspacePath
//      is the *session-state* dir (~/.copilot/session-state/<id>), NOT the
//      repo — do not use it here.
//   3. last-known inst.workspacePath (rehydrate on reconnect)
//   4. null — the UI shows an explicit unavailable state
//
// We deliberately do NOT fall back to process.cwd() or process.env: for a
// forked extension process, cwd is inherited from the CLI parent and is
// typically the Copilot home (COPILOT_HOME), not the user's project.
// (sessionState is a mutable holder exported from instances.mjs)


// --------------------------- canvas open / close ---------------------------
async function onOpen(ctx) {
    const inst = getInstance(ctx.instanceId);
    await sessionReady;
    if (instances.get(ctx.instanceId) !== inst) throw new Error("Wizard panel closed while opening");
    inst.generateCanvas = resolveGenerateCanvas(inst, ctx, runtimeSettings.generateCanvasEnabled);
    inst._session = getSession();
    // Retry metadata lookup if it was unavailable at startup.
    if (!sessionState.repoPath) {
        sessionState.repoPath = await fetchSessionRepoPath(getSession());
    }
    inst.workspacePath = resolveWorkspace(inst, ctx, sessionState.repoPath);

    // Start the HTTP server FIRST so we can return the URL immediately.
    // The iframe loads the boot overlay (ui/boot.js) which subscribes to
    // SSE and animates step-by-step progress while npm install and
    // hydration run in the background. This is what turns the historical
    // 10-45s "blank iframe" first-open into a live experience.
    if (!inst.server) {
        const adapter = sessionAdapter();
        await startServer(inst.instanceId, {
            session: adapter,
            log: adapter.log,
            getState: () => snapshot(inst),
            getInstance: () => inst,
        });
    }

    // Kick off boot work asynchronously — the promise is retained on the
    // instance so a UI-initiated retry can await/replace it, but we do
    // NOT await it here so the URL can return within ~1s.
    inst.bootPromise = bootAsync(inst).catch((err) => {
        try { sessionAdapter().log?.(`boot failed: ${err?.message ?? err}`, "error"); } catch {}
    });

    // Start watching .speckit-wizard/state.json so external edits push
    // fresh state to the UI immediately.
    startStateWatcher(inst, {
        snapshot,
        normalizeHookArtifactsInComposition,
        onProjectInitialized: async () => {
            try {
                await inst.bootPromise;
                let snap;
                const failures = await hydrateCatalogs(inst, async () => {
                    await runFastComposition(inst, { reason: "project initialized" });
                    snap = await snapshot(inst);
                });
                if (failures.length) {
                    await sessionAdapter().log?.(
                        `catalog refresh had failures: ${formatCatalogFailures(failures)}`,
                        "warning",
                    );
                }
                if (snap) inst.broadcast({ type: "state", data: snap });
            } catch (err) {
                await sessionAdapter().log?.(
                    `catalog refresh after project initialization failed: ${err?.message ?? err}`,
                    "error",
                );
            }
        },
    }).catch(() => { /* best-effort */ });
    startArtifactWatcher(inst, { snapshot }).catch(() => { /* best-effort */ });
    return {
        title: "Spec Kit Wizard",
        url: inst.url,
    };
}

// Full boot sequence, broadcast step-by-step via the boot tracker so the
// UI overlay can animate progress. Called fire-and-forget from onOpen
// (with the promise retained on inst.bootPromise for retries).
export async function bootAsync(inst) {
    const adapter = sessionAdapter();
    const tracker = createBootTracker({ broadcast: inst.broadcast, inst });

    // Step 1: workspace resolution — this actually happened in onOpen
    // before startServer, so just record it as ok/failed.
    tracker.start("workspace");
    if (inst.workspacePath) {
        tracker.ok("workspace", { path: inst.workspacePath });
    } else {
        tracker.fail("workspace", {
            title: "Could not resolve a workspace path",
            hint: "The canvas will still open, but phase pages need a workspace to save artifacts.",
            canRetry: false,
        });
    }

    // Step 2: deps-check
    tracker.start("deps-check");
    let deps;
    try {
        deps = await checkDeps();
    } catch (err) {
        tracker.fail("deps-check", { title: `checkDeps error: ${err?.message ?? err}` });
        return;
    }
    if (deps.ready) {
        tracker.ok("deps-check", { alreadyInstalled: true });
        tracker.skip("deps-install", "already-installed");
    } else {
        tracker.ok("deps-check", { missing: deps.missing });

        // Step 3: deps-install with live progress ticks.
        tracker.start("deps-install");
        const installResult = await installDeps(deps.missing, {
            onProgress: (line) => tracker.tick("deps-install", line),
        });
        const recheck = await checkDeps();
        if (recheck.ready) {
            tracker.ok("deps-install", { installed: deps.missing });
            inst.depsError = null;
        } else {
            const classified = installResult.classified ?? {
                code: "UNKNOWN",
                title: "npm install failed",
                hint: "The Copilot agent can help diagnose the failure.",
                canRetry: true,
            };
            const stderrTail = String(installResult.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
            inst.depsError = {
                ...classified,
                extDir: installResult.extDir ?? getDependencyDir(recheck.missing[0]),
                packageName: installResult.packageName ?? recheck.missing[0],
                packages: deps.missing,
                stderrTail,
                timestamp: new Date().toISOString(),
            };
            try {
                adapter.log?.(
                    `npm install failed [${classified.code}]: ${classified.title}. See wizard boot overlay for retry.`,
                    "warn",
                );
            } catch { /* best-effort */ }
            tracker.fail("deps-install", { ...classified, stderrTail });
            // Don't return — the canvas still opens; catalog/composition
            // pages that need js-yaml will surface their own error state.
        }
    }

    // Step 4: env-probe — split out of the old hydrateOnce so users see it.
    tracker.start("env-probe");
    try {
        await hydrateReadState(inst);
        // Fire the env probe and await it here (unlike the old code) so the
        // step transitions ok when versions land.
        await ensureEnvProbe(inst);
        tracker.ok("env-probe");
        try {
            const snap = await snapshot(inst);
            inst.broadcast?.({ type: "state", data: snap });
        } catch { /* best-effort */ }
    } catch (err) {
        tracker.fail("env-probe", { title: `env probe failed: ${err?.message ?? err}` });
    }

    // Step 5: catalog bootstrap + fast composition.
    tracker.start("catalog");
    const failures = await hydrateCatalogs(inst, async () => {
        await runFastComposition(inst, { reason: "boot" });
        await snapshot(inst);
    });
    if (failures.length) {
        tracker.fail("catalog", { title: `catalog bootstrap incomplete: ${formatCatalogFailures(failures)}` });
    } else {
        tracker.ok("catalog");
    }

    // Step 6: ready
    tracker.ready();
    try {
        const snap = await snapshot(inst);
        inst.broadcast?.({ type: "state", data: snap });
    } catch { /* best-effort */ }
}

// Load state.json into inst.state (was the top of the old hydrateOnce).
async function hydrateReadState(inst) {
    if (!inst.workspacePath) return;
    const r = await readState(inst.workspacePath, fsDeps).catch(() => null);
    if (r?.state) {
        inst.state = r.state;
        // Hydrate the in-memory composition cache from disk so the
        // Composition tab renders instantly after an extension reload
        // without re-running ~20 CLI calls.
        if (r.state.composition) {
            inst.cachedComposition = normalizeHookArtifactsInComposition(r.state.composition);
        }
    }
}

function formatCatalogFailures(failures) {
    return failures.map(({ kind, message }) => `${kind}: ${message}`).join("; ");
}

// Catalog bootstrap: presets → extensions → bundles. Each catalog is
// independent, so a failed installed-inventory read must not block the rest.
async function hydrateCatalogs(inst, afterHydration) {
    // On a fresh instance (extension reload etc.) we auto-hydrate from the
    // hardcoded plugin catalog URLs so the Catalogs tab is populated without
    // requiring the user to re-run the skill.
    //
    // See catalog/sources.mjs for why the wizard hardcodes these
    // catalogs (and does NOT register them via `specify preset catalog add`).
    // Third-party catalogs a user has added via the CLI will NOT appear here
    // — that is intentional in the current scope.
    if (!inst.cachedCatalogSources?.length) {
        const bootstrap = [
            {
                name: "default",
                url: PRESET_CATALOG_URL.default,
                description: "Built-in catalog of installable presets",
                installAllowed: true,
                builtin: true,
                priority: 1,
            },
            {
                name: "copilot",
                url: PRESET_CATALOG_URL.copilot,
                description: "Copilot-specific presets from spec-kit-copilot",
                installAllowed: true,
                builtin: true,
                priority: 2,
            },
            {
                name: "community",
                url: PRESET_CATALOG_URL.community,
                description: "Community-contributed presets",
                installAllowed: false,
                builtin: true,
                priority: 3,
            },
        ];
        inst.cachedCatalogSources = bootstrap;
    }
    if (!inst.cachedExtensionCatalogSources?.length) {
        const extBootstrap = [
            {
                name: "default",
                url: EXTENSION_CATALOG_URL.default,
                description: "Built-in catalog of installable extensions",
                installAllowed: true,
                builtin: true,
                priority: 1,
            },
            {
                name: "copilot",
                url: EXTENSION_CATALOG_URL.copilot,
                description: "Copilot-specific Spec Kit extensions",
                installAllowed: true,
                builtin: true,
                priority: 2,
            },
            {
                name: "community",
                url: EXTENSION_CATALOG_URL.community,
                description: "Community-contributed extensions",
                installAllowed: false,
                builtin: true,
                priority: 3,
            },
        ];
        inst.cachedExtensionCatalogSources = extBootstrap;
    }
    if (!inst.cachedBundleCatalogSources?.length) {
        const bundleBootstrap = [
            {
                name: "default",
                url: BUNDLE_CATALOG_URL.default,
                description: "Built-in catalog of installable bundles",
                installAllowed: true,
                builtin: true,
                priority: 1,
            },
            {
                name: "community",
                url: BUNDLE_CATALOG_URL.community,
                description: "Community-contributed bundles",
                installAllowed: false,
                builtin: true,
                priority: 2,
            },
        ];
        inst.cachedBundleCatalogSources = bundleBootstrap;
    }
    return hydrateCatalogGroups([
        { kind: "presets", hydrate: () => hydratePresetsForSources(inst, inst.cachedCatalogSources) },
        { kind: "extensions", hydrate: () => hydrateExtensionsForSources(inst, inst.cachedExtensionCatalogSources) },
        { kind: "bundles", hydrate: () => hydrateBundlesForSources(inst, inst.cachedBundleCatalogSources) },
    ], afterHydration);
}

// Legacy hydrateOnce removed — bootAsync in this file supersedes it.

async function onClose(ctx) {
    const inst = instances.get(ctx.instanceId);
    if (!inst) return;
    inst.closed = true;
    clearCommandRunsForInstance(ctx.instanceId);
    cancelBackgroundInference(inst);
    clearTimeout(inst.outputInference?.timer);
    clearTimeout(inst.refreshStatus?.timer);
    inst.outputInference = null;
    inst.outputInferenceOwner = null;
    inst.refreshStatus = null;
    stopStateWatcher(inst);
    stopArtifactWatcher(inst);
    if (inst.sseClients) {
        for (const c of inst.sseClients) {
            try { c.end(); } catch { /* ignore */ }
        }
        inst.sseClients.clear();
    }
    if (inst.server) {
        await new Promise((resolve) => inst.server.close(() => resolve()));
    }
    instances.delete(ctx.instanceId);
}

// --------------------------- joinSession + register ------------------------
// Defer registration until the readiness promise exists, even for synchronous restores.
const sessionReady = Promise.resolve().then(() => joinSession({
    canvases: [
        createCanvas({
            id: "speckit-wizard",
            displayName: "Spec Kit Wizard",
            description:
                "Wizard UX driving the Spec-Driven Development lifecycle (setup → constitution → specify → clarify → plan → tasks → implement) via the spec-kit-copilot skills plugin.",
            inputSchema: {
                type: "object",
                properties: {
                    cwd: { type: "string", description: "Workspace directory. Defaults to the session's cwd." },
                    generateCanvas: generateCanvasInputSchema,
                },
            },
            actions: ACTIONS,
            open: onOpen,
            onClose,
        }),
    ],
})).then(setSession);

await sessionReady;

// Fetch the user's repo cwd via RPC metadata. This is the CLI-launched
// working directory (e.g. C:\...\copilot-worktrees\<project>\<branch>) — the
// actual workspace where .specify/ should live. Ignore session.workspacePath,
// which is the session-state scratch dir.
sessionState.repoPath = await fetchSessionRepoPath(getSession());

await getSession().log(
    `speckit-wizard canvas ready (repo=${sessionState.repoPath ?? "unknown"})`,
    { level: "info", ephemeral: true },
);