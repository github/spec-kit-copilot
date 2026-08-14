// watchers.mjs — filesystem watchers for state.json and artifact roots.
//
// `startStateWatcher` observes `.speckit-wizard/state.json` so external
// edits (agent tools, human editors) reflect in the UI immediately.
// `startArtifactWatcher` observes `.specify/` and `specs/` (recursively
// where supported) so artifact changes trigger a re-scan without waiting
// for the next canvas action.
//
// Both take `deps = { snapshot, normalizeHookArtifactsInComposition }` so
// they can rebuild the wire snapshot and re-hydrate composition cache
// without direct extension.mjs imports. This keeps the module free of the
// circular-import risk that a static import of `snapshot` would create.

import { mkdir, stat } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { joinIfPossible } from "../env/workspace.mjs";
import { readState } from "../state/store.mjs";
import { fsDeps } from "./instances.mjs";

// --------------------------- state.json file watcher ------------------------
// Watches `.speckit-wizard/state.json` for external edits (agent tools,
// human editors, other processes) so any change to the file contract is
// reflected in the UI immediately — not only when the next canvas action
// happens to call persistAndBroadcast. This makes the file the true source
// of truth for wizard phase status.
//
// Loop-safety: our own writes via persistAndBroadcast fire the watcher too.
// The handler only reads + broadcasts (never writes back), so at worst each
// canvas-driven write produces one extra idempotent broadcast — no cascade.
// We also suppress duplicate events by comparing mtimeMs to the last one we
// processed (fs.watch can fire twice for a single write on Windows).
export async function startStateWatcher(inst, { snapshot, normalizeHookArtifactsInComposition }) {
    if (!inst?.workspacePath || inst.stateWatcher) return;
    const dir = joinIfPossible(inst.workspacePath, ".speckit-wizard");
    if (!dir) return;
    try { await mkdir(dir, { recursive: true }); } catch { /* best-effort */ }
    try {
        const w = fsWatch(dir, { persistent: false }, (event, filename) => {
            // Node normalizes to "state.json" on Windows when the file changes;
            // some rename/replace patterns emit null — accept both.
            if (filename && filename !== "state.json") return;
            if (inst._stateWatchDebounce) clearTimeout(inst._stateWatchDebounce);
            inst._stateWatchDebounce = setTimeout(async () => {
                inst._stateWatchDebounce = null;
                try {
                    const statePath = joinIfPossible(dir, "/state.json");
                    let mtimeMs = 0;
                    try {
                        const s = await stat(statePath);
                        mtimeMs = s.mtimeMs;
                    } catch { /* file may not exist yet */ }
                    if (mtimeMs && mtimeMs === inst._stateWatchLastMtimeMs) return;
                    inst._stateWatchLastMtimeMs = mtimeMs;
                    const r = await readState(inst.workspacePath, fsDeps).catch(() => null);
                    if (r?.state) {
                        inst.state = r.state;
                        // Re-hydrate the composition cache from the freshly
                        // loaded state so external writes (agent tools,
                        // manual edits, workflows) surface in the
                        // Composition tab. Without this, the snapshot
                        // pipeline keeps emitting the stale cached
                        // composition and the file watcher only refreshes
                        // phases/setup/etc.
                        if (r.state.composition) {
                            inst.cachedComposition = normalizeHookArtifactsInComposition(r.state.composition);
                        }
                    }
                    const snap = await snapshot(inst);
                    inst.broadcast({ type: "state", data: snap });
                } catch {
                    // best-effort watcher; UI will pick up state on next event
                }
            }, 80);
        });
        w.on?.("error", () => {
            // best-effort watcher; ignore transient fs.watch errors
        });
        inst.stateWatcher = w;
    } catch {
        // fs.watch may fail on some filesystems (e.g. network mounts); the
        // wizard still works, it just won't auto-refresh on external edits.
    }
}

export function stopStateWatcher(inst) {
    if (!inst) return;
    if (inst._stateWatchDebounce) {
        clearTimeout(inst._stateWatchDebounce);
        inst._stateWatchDebounce = null;
    }
    if (inst.stateWatcher) {
        try { inst.stateWatcher.close(); } catch { /* ignore */ }
        inst.stateWatcher = null;
    }
}

// --------------------------- artifact file watcher --------------------------
// Watches `.specify/` and `specs/` (recursive where the OS supports it) so
// that when a skill writes constitution.md, spec.md, plan.md, tasks.md, etc.
// — or the user edits them by hand — the wizard rescans and re-broadcasts
// without waiting for the next canvas action. Complements the state.json
// watcher: state.json is the control-plane cache, but the artifacts on disk
// are the grounding truth for phase status.
export async function startArtifactWatcher(inst, { snapshot }) {
    if (!inst?.workspacePath || inst.artifactWatchers.length) return;
    const roots = [
        joinIfPossible(inst.workspacePath, ".specify"),
        joinIfPossible(inst.workspacePath, "specs"),
    ].filter(Boolean);

    const scheduleRescan = () => {
        if (inst._artifactWatchDebounce) clearTimeout(inst._artifactWatchDebounce);
        inst._artifactWatchDebounce = setTimeout(async () => {
            inst._artifactWatchDebounce = null;
            try {
                const snap = await snapshot(inst);
                inst.broadcast({ type: "state", data: snap });
            } catch {
                // best-effort watcher; UI will pick up state on next event
            }
        }, 150);
    };

    const attachRootWatcher = (root) => {
        try {
            const w = fsWatch(root, { persistent: false, recursive: true }, (_event, filename) => {
                if (typeof filename === "string" && filename.startsWith(".git")) return;
                scheduleRescan();
            });
            w.on?.("error", () => {
                // best-effort watcher; ignore transient fs.watch errors
            });
            inst.artifactWatchers.push(w);
            return true;
        } catch {
            return false;
        }
    };

    // Attempt to attach recursive watchers on any roots that already exist.
    // Track which ones are still missing so we can re-attach them lazily
    // when they're created (e.g. `specs/` after the first /speckit-specify).
    const missing = new Set();
    for (const root of roots) {
        if (!attachRootWatcher(root)) missing.add(root);
    }

    // Watch the workspace root (non-recursive) so we notice when a top-level
    // directory (`.specify` or `specs`) is created, then attach a recursive
    // watcher to it.
    if (missing.size) {
        try {
            const rootWatcher = fsWatch(inst.workspacePath, { persistent: false }, (_event, filename) => {
                if (typeof filename !== "string" || !filename) return;
                for (const target of Array.from(missing)) {
                    if (target.endsWith(filename) || target === joinIfPossible(inst.workspacePath, filename)) {
                        if (attachRootWatcher(target)) {
                            missing.delete(target);
                            scheduleRescan();
                        }
                    }
                }
            });
            rootWatcher.on?.("error", () => { /* ignore */ });
            inst.artifactWatchers.push(rootWatcher);
        } catch { /* best-effort */ }
    }
}

export function stopArtifactWatcher(inst) {
    if (!inst) return;
    if (inst._artifactWatchDebounce) {
        clearTimeout(inst._artifactWatchDebounce);
        inst._artifactWatchDebounce = null;
    }
    for (const w of inst.artifactWatchers) {
        try { w.close(); } catch { /* ignore */ }
    }
    inst.artifactWatchers = [];
}
