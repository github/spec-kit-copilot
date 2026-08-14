// instances.mjs — per-instance record registry + shared filesystem deps bag
// + late-bound SDK session handle used by session-adjacent helpers.
//
// Every canvas connection gets one record tracked in `instances`; helpers
// and actions look it up via `getInstance`. `sessionState` is a mutable
// holder for `sessionRepoPath` (captured once at `onOpen` from the SDK
// session metadata) so downstream modules can resolve workspaces without
// pulling the value through every call.
//
// This file also owns the module-level SDK session slot (`_session`,
// `setSession`, `getSession`) and the two session-adjacent helpers that
// build on it: `sessionAdapter()` and `reloadSkillsIfInstalledSetChanged`.
// They live here (rather than in extension.mjs) so downstream modules
// can read the session without importing extension.mjs — which would form
// an import cycle with the boot module.

import { readFile, writeFile, stat, readdir, mkdir, rename } from "node:fs/promises";
import { pathExists, resolveWorkspace } from "../env/workspace.mjs";
import { runSkillsReload } from "../server/handlers-ops.mjs";

export const fsDeps = {
    readFile,
    writeFile,
    mkdir,
    stat,
    readdir,
    rename,
    pathExists,
};

export const sessionState = {
    // Set by extension.mjs onOpen after fetchSessionRepoPath resolves.
    repoPath: null,
};

const instances = new Map();

export function newInstance(instanceId) {
    return {
        instanceId,
        server: null,
        url: null,
        token: null,
        sseClients: null,
        broadcast: (msg) => { /* replaced by startServer */ void msg; },
        workspacePath: null,
        cwdBoundState: null,     // last scanner snapshot
        state: null,             // normalized state.json contents
        cachedProbes: null,      // { at: number, results: [], summary }
        currentPhase: null,
        _session: null,          // late-bound
        stateWatcher: null,      // fs.watch handle on .speckit-wizard dir
        _stateWatchDebounce: null, // pending debounce timer id
        _stateWatchLastMtimeMs: 0, // last processed mtime to suppress echoes
        artifactWatchers: [],    // fs.watch handles on .specify / specs dirs
        _artifactWatchDebounce: null, // pending debounce timer for artifact rescans
    };
}

export function getInstance(instanceId) {
    let inst = instances.get(instanceId);
    if (!inst) {
        inst = newInstance(instanceId);
        instances.set(instanceId, inst);
    }
    return inst;
}

// Exposed for lifecycle teardown in extension.mjs onClose.
export function allInstances() {
    return instances;
}

// Thin helper: look up (or lazily create) the per-instance record, bind
// its workspacePath if missing, then hand control to the action body.
// Called by every ACTIONS handler in canvas-runtime/actions/*.mjs.
export async function withInstance(ctx, fn) {
    const inst = getInstance(ctx.instanceId);
    if (!inst.workspacePath) inst.workspacePath = resolveWorkspace(inst, ctx, sessionState.repoPath);
    return fn(inst);
}

// -------- Section: SDK session slot (late-bound) --------
// The wizard doesn't have a session at module-load time (module graph
// loads before the SDK finishes `joinSession()`), so `extension.mjs` calls
// `setSession(sess)` after `joinSession` resolves. Anything that needs
// the session reads it lazily from here — never imports from extension.mjs.

let _session = null;

export function setSession(sess) { _session = sess; }
export function getSession() { return _session; }

// -------- Section: session adapter --------
// Façade over the late-bound SDK session whose primary job is to let
// downstream code trigger a new agent turn — i.e. dispatch a prompt to
// the Copilot conversation via `send({ prompt })`. This is how the wizard
// kicks off phase runs (`dispatchWorkflowCommand` in
// `server/handlers-phase.mjs` calls `session.send({ prompt })` with the
// composed slash-command + tracking preamble), how it drives auto-init,
// etc. Callers own what they send — the adapter itself has no
// phase/prompt knowledge.
//
// Also exposes `log` (ephemeral session log for status messages) and a
// `rpc` getter (so consumers like `runSkillsReload` in
// `server/handlers-ops.mjs` can invoke `session.rpc.skills.reload()`).
// The `rpc` getter is late-bound because `_session` is null when the
// adapter is constructed at boot; consumers dereference on demand.
//
// Why a façade instead of passing `_session` directly: keeps downstream
// modules from touching the SDK surface, and lets consumers construct
// the adapter at boot before `setSession` has fired without crashing.
export function sessionAdapter() {
    return {
        send: async ({ prompt }) => {
            if (!_session) throw new Error("session not ready");
            return _session.send({ prompt });
        },
        log: async (msg, level) => {
            if (!_session) return;
            try {
                await _session.log(String(msg ?? ""), { level, ephemeral: true });
            } catch { /* logging is best-effort */ }
        },
        // Expose the live SDK `rpc` surface so downstream consumers (notably
        // `runSkillsReload` in server/handlers-ops.mjs) can invoke `session.rpc.skills.reload()`.
        get rpc() { return _session?.rpc ?? undefined; },
    };
}

// -------- Section: session skills reload --------
// The Copilot session caches skill definitions in memory. Installing or
// removing a preset/extension mutates `.github/skills/` on disk (or the
// preset's own commands under `.specify/presets/<id>/commands/`), but the
// session cache doesn't rescan on its own — so freshly added commands like
// `/speckit-foreshadow` return "not recognized" in the composer until the
// user manually runs `/skills reload`.
//
// The SDK's `session.rpc.skills.reload()` RPC is the same mechanism the
// interactive `/skills reload` slash command invokes; unlike the slash
// command it IS callable from the canvas runtime, so we can trigger it
// automatically whenever we detect the installed set has changed.
//
// This helper is idempotent-ish: it compares a `Set<string>` snapshot of
// currently installed ids against the cached snapshot on `inst`, and only
// reloads when they differ. First observation is a no-op (there was
// nothing to change from), so opening the wizard on a stable project
// doesn't trigger a reload.
export async function reloadSkillsIfInstalledSetChanged(inst, kind, currentIds) {
    if (!_session?.rpc?.skills?.reload) return; // SDK too old — silently skip.
    const cacheKey = kind === "extension"
        ? "_lastInstalledExtensionIds"
        : "_lastInstalledPresetIds";
    const previous = inst[cacheKey];
    const nextSet = new Set(currentIds);
    // First observation seeds the cache without reloading — nothing has
    // changed from an unknown baseline. Subsequent calls compare against
    // the cached snapshot.
    if (previous == null) {
        inst[cacheKey] = nextSet;
        return;
    }
    let changed = previous.size !== nextSet.size;
    if (!changed) {
        for (const id of nextSet) {
            if (!previous.has(id)) { changed = true; break; }
        }
    }
    inst[cacheKey] = nextSet;
    if (!changed) return;
    // Funnel through the shared reload core — same one-way-sticky
    // persistence rules as the UI-triggered path. A failure here logs but
    // never disables the wizard: `runSkillsReload` only ever writes
    // `setup.skillsReloaded: true` on success, never false.
    const result = await runSkillsReload({
        session: _session,
        broadcast: (msg) => inst.broadcast?.(msg),
        getInstance: () => inst,
    });
    try {
        await _session.log(
            `speckit-wizard: reloaded session skills after ${kind} change (ok=${result.ok}, errors=${result.errors}, warnings=${result.warnings})`,
            { level: result.ok ? "info" : "warn", ephemeral: true },
        );
    } catch { /* ignore */ }
}
