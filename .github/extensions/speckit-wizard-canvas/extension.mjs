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
import { checkDeps, getExtensionDir, installDeps } from "./env/deps-check.mjs";
// Composition retrieval is entirely LLM-driven via the `speckit-preset` +
// `speckit-extension` skills — see the `composition.refresh` case in
// prompts.mjs and the `applyComposition` helper in canvas-runtime/composition-apply.mjs.
// There is deliberately no native import that parses `preset.yml` /
// `extension.yml` / `.registry` here; catalog interpretation belongs to the
// skills and scanner.
import { fetchSessionRepoPath, resolveWorkspace } from "./env/workspace.mjs";
import { fsDeps, sessionState, getInstance, allInstances, sessionAdapter, setSession, getSession } from "./canvas-runtime/instances.mjs";
import { ensureEnvProbe } from "./env/probe-cache.mjs";
import { startStateWatcher, stopStateWatcher, startArtifactWatcher, stopArtifactWatcher } from "./canvas-runtime/watchers.mjs";
import { hydratePresetsForSources } from "./catalog/presets.mjs";
import { hydrateExtensionsForSources } from "./catalog/extensions.mjs";
import { hydrateBundlesForSources } from "./catalog/bundles.mjs";
import { PRESET_CATALOG_URL, EXTENSION_CATALOG_URL, BUNDLE_CATALOG_URL } from "./catalog/sources.mjs";
import { snapshot } from "./canvas-runtime/snapshot.mjs";
import { runFastComposition, normalizeHookArtifactsInComposition } from "./canvas-runtime/composition-apply.mjs";
import { phaseActions } from "./canvas-runtime/actions/phase.mjs";
import { catalogActions } from "./canvas-runtime/actions/catalog.mjs";
import { compositionActions } from "./canvas-runtime/actions/composition.mjs";
import { wizardShellActions } from "./canvas-runtime/actions/wizard-shell.mjs";

const ACTIONS = [...phaseActions, ...catalogActions, ...compositionActions, ...wizardShellActions];

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
    inst._session = getSession();
    // If the session repo path wasn't captured at startup (race), try once more.
    if (!sessionState.repoPath && getSession()) {
        sessionState.repoPath = await fetchSessionRepoPath(getSession());
    }
    inst.workspacePath = resolveWorkspace(inst, ctx, sessionState.repoPath);

    // First-boot / new-worktree bootstrap: the wizard canvas has a small npm
    // dependency (js-yaml) that isn't checked in. If it's missing, run
    // `npm install` in the canvas folder automatically before starting
    // the server. This adds a one-time ~10-30s delay on first open of a
    // fresh worktree but avoids surfacing a raw error that the user then
    // has to resolve manually.
    let deps = await checkDeps();
    if (!deps.ready) {
        const installResult = await installDeps(deps.missing);
        deps = await checkDeps();
        if (!deps.ready) {
            const extDir = getExtensionDir();
            const pkgs = deps.missing.join(" ");
            const detail = installResult.stderr?.trim() || installResult.stdout?.trim() || "npm install failed";
            throw new Error(
                `Spec Kit Wizard cannot start: automatic install of npm dependencies (${pkgs}) failed. ` +
                `Run: npm install ${pkgs}  (in ${extDir}), then reopen the canvas.\n\n${detail}`,
            );
        }
    }

    await hydrateOnce(inst);

    if (!inst.server) {
        const adapter = sessionAdapter();
        await startServer(inst.instanceId, {
            session: adapter,
            log: adapter.log,
            getState: () => snapshot(inst),
            getInstance: () => inst,
        });
    }
    // Start watching .speckit-wizard/state.json so external edits push
    // fresh state to the UI immediately.
    startStateWatcher(inst, { snapshot, normalizeHookArtifactsInComposition }).catch(() => { /* best-effort */ });
    startArtifactWatcher(inst, { snapshot }).catch(() => { /* best-effort */ });
    return {
        title: "Spec Kit Wizard",
        url: inst.url,
    };
}

// First-boot hydration: state.json → env probe → catalog bootstrap →
// initial snapshot. Extracted so onOpen stays a thin orchestrator.
async function hydrateOnce(inst) {
    // Load initial state.json (if present) and merge with a fresh scan.
    if (inst.workspacePath) {
        const r = await readState(inst.workspacePath, fsDeps).catch(() => null);
        if (r?.state) {
            inst.state = r.state;
            // Hydrate the in-memory composition cache from disk so the
            // Composition tab renders instantly after an extension reload
            // without re-running ~20 CLI calls.
            if (r.state.composition) {
                inst.cachedComposition = normalizeHookArtifactsInComposition(r.state.composition);
            }
            // `setup.skillsReloaded` is a durable, one-way-sticky milestone:
            // once the project has ever completed a skills reload we keep the
            // persisted flag `true` across process restarts, so the wizard
            // doesn't relock the Phases tab every new Copilot session. If a
            // consumer needs to know whether *this* process has reloaded, it
            // should read `inst.skillsReload` (in-memory) — not the persisted
            // flag. Do not reset the persisted value here.
        }
    }
    // Kick off an env probe in the background — non-blocking.
    // When it finishes, push a fresh snapshot so the Setup page shows the
    // detected CLI / plugin versions without requiring a page refresh.
    ensureEnvProbe(inst)
        .then(async () => {
            try {
                const snap = await snapshot(inst);
                inst.broadcast({ type: "state", data: snap });
            } catch { /* best-effort */ }
        })
        .catch(() => {});
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
        await hydratePresetsForSources(inst, bootstrap).catch(() => {});
    }
    // Extension catalog bootstrap — same pattern as presets, using the
    // extensions/ URLs. See catalog/sources.mjs.
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
                name: "community",
                url: EXTENSION_CATALOG_URL.community,
                description: "Community-contributed extensions",
                installAllowed: false,
                builtin: true,
                priority: 2,
            },
        ];
        inst.cachedExtensionCatalogSources = extBootstrap;
        await hydrateExtensionsForSources(inst, extBootstrap).catch(() => {});
    }
    // Bundle catalog bootstrap — same pattern as extensions. The built-in
    // `bundles/catalog.json` may 404 upstream; hydrateBundlesForSources
    // logs the failure and continues so the community bundle catalog
    // still populates the grid.
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
            {
                // TODO: temp only — remove once an upstream default bundle
                // catalog exists. Sourced from a wizard-shipped
                // catalog.test.json. Marked install-allowed because each
                // entry embeds an inline `bundle_yml` payload that the
                // install prompt materializes locally before installing.
                name: "test",
                url: BUNDLE_CATALOG_URL.test,
                description: "TODO (temp): wizard test bundles (install-allowed via inline bundle.yml)",
                installAllowed: true,
                builtin: true,
                priority: 3,
            },
        ];
        inst.cachedBundleCatalogSources = bundleBootstrap;
        await hydrateBundlesForSources(inst, bundleBootstrap).catch(() => {});
    }
    // Boot-time fast composition refresh so an existing worktree with
    // presets/extensions already installed opens straight into the
    // Composition tab with a hydrated composition slice. Silent on failure.
    // TEMPORARY — remove with runFastComposition.
    await runFastComposition(inst, { reason: "boot" });
    await snapshot(inst);
}

async function onClose(ctx) {
    const inst = instances.get(ctx.instanceId);
    if (!inst) return;
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
setSession(await joinSession({
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
                },
            },
            actions: ACTIONS,
            open: onOpen,
            onClose,
        }),
    ],
}));

// Late-bind session on any instance opened during startup races.
for (const inst of instances.values()) inst._session = getSession();

// Fetch the user's repo cwd via RPC metadata. This is the CLI-launched
// working directory (e.g. C:\...\copilot-worktrees\<project>\<branch>) — the
// actual workspace where .specify/ should live. Ignore session.workspacePath,
// which is the session-state scratch dir.
sessionState.repoPath = await fetchSessionRepoPath(getSession());

await getSession().log(
    `speckit-wizard canvas ready (repo=${sessionState.repoPath ?? "unknown"})`,
    { level: "info", ephemeral: true },
);