// HTTP handlers for pipeline/artifact/skip-defaults endpoints plus the
// shared runSkillsReload core used by both /api/skills/reload and the
// extension's canvas action.

import { join } from "node:path";

import { applyPatch, writeState } from "../state/store.mjs";
import { effectivePipelinePhases, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";
import { jsonError, jsonRes } from "./http-utils.mjs";
// Pipeline mutation — user-authored spine override.
//
// Contract:
//   • body.action ∈ {"add", "remove", "clear", "reset"}
//   • add:    body.id — command id to append. If pipeline is currently null
//             (untouched sentinel), materialize the inferred pipeline
//             first, then append. Duplicates allowed.
//   • remove: body.id — command id to drop from the pipeline.
//   • clear:  pipeline := []  (still "user-owned" — array, not null).
//   • reset:  pipeline := null (re-follow inferred spine on next render).
export async function handlePipelineMutation(res, body, { getState, broadcast, getInstance }) {
    const action = body?.action;
    if (!["add", "remove", "clear", "reset"].includes(action)) {
        return jsonError(res, 400, "invalid action");
    }
    const inst = getInstance();
    if (!inst?.workspacePath) return jsonError(res, 400, "workspace path unavailable");

    const snapshot = await getState();
    const current = Array.isArray(snapshot.pipeline) ? snapshot.pipeline.slice() : null;

    let next;
    if (action === "reset") {
        next = null;
    } else if (action === "clear") {
        next = [];
    } else if (action === "add") {
        const rawId = body?.id;
        if (typeof rawId !== "string" || !rawId.length) return jsonError(res, 400, "missing id");
        // Normalize to bare canonical/namespaced form so we match the seed —
        // the UI's "+ Add" chips send `commands/speckit.<name>` for artifact
        // ids, but effectivePipelinePhases already strips that prefix. Storing
        // the raw prefixed id resulted in the pipeline holding both `plan` and
        // `commands/speckit.plan`, which rendered as two "Plan" chips.
        const id = stripCommandsPrefix(rawId);
        // Materialize from the SAME seed the UI renders pre-edit — the
        // shared derivation in ui/pipeline-items.mjs. Historically the
        // server used CANONICAL_PHASES (9 items) while the UI showed the
        // inferred 5-item pipeline, so the first add silently expanded
        // the list back to nine.
        const seed = current ?? effectivePipelinePhases(snapshot);
        next = [...seed, { id }];
    } else {
        // remove — prefer the explicit render-time index when provided by the
        // UI (accurate when the pipeline contains duplicate ids, e.g. two Plan
        // phases). Fall back to first-match-by-id for older clients or when
        // the index doesn't line up with the seed (stale UI).
        const rawId = body?.id;
        if (typeof rawId !== "string" || !rawId.length) return jsonError(res, 400, "missing id");
        const id = stripCommandsPrefix(rawId);
        const seed = current ?? effectivePipelinePhases(snapshot);
        const explicitIndex = Number.isInteger(body?.index) ? body.index : -1;
        let idx = -1;
        if (
            explicitIndex >= 0 &&
            explicitIndex < seed.length &&
            stripCommandsPrefix(seed[explicitIndex]?.id) === id
        ) {
            idx = explicitIndex;
        } else {
            idx = seed.findIndex((entry) => stripCommandsPrefix(entry?.id) === id);
        }
        if (idx < 0) return jsonError(res, 400, "id not in pipeline");
        next = seed.filter((_, i) => i !== idx);
    }

    inst.state = applyPatch(snapshot, { pipeline: next });
    try {
        await writeState(inst.workspacePath, inst.state, {
            mkdir: (await import("node:fs/promises")).mkdir,
            writeFile: (await import("node:fs/promises")).writeFile,
        });
    } catch {
        // best-effort persist; the in-memory state below still reflects the change
    }
    // Broadcast a fully-rendered snapshot (includes commands /
    // phaseGraph / composition), not the raw persisted state — otherwise the
    // client would briefly see every pipeline entry as MISSING while the graph
    // fields are absent from state.snapshot.
    try {
        const fresh = await getState();
        broadcast({ type: "state", data: fresh });
    } catch {
        broadcast({ type: "state", data: inst.state });
    }
    return jsonRes(res, 200, { ok: true, pipeline: next });
}

// Merge an incoming `{ entries: { "commands/<id>": { writesTo, source, skillPath?, skillHash? } } }`
// map into `.speckit-wizard/artifact-targets.json`. The wizard scanner
// consumes this file to render each extension command's "Writes to" link
// (see scanner.mjs :: hydrateExtensionArtifactsFromCache).
//
// This endpoint is the write side of the LLM-inference loop:
//   UI dispatches `extension.inferArtifactTargets` →
//   agent reads the extension's skill files, extracts writesTo path
//   templates from the opening paragraph →
//   agent POSTs { entries: {...} } here →
//   scanner picks up the new cache on the next scan tick.
export async function handleArtifactTargets(res, body, { broadcast, getInstance }) {
    const inst = getInstance();
    if (!inst?.workspacePath) return jsonError(res, 400, "workspace path unavailable");

    const incoming = body?.entries;
    if (!incoming || typeof incoming !== "object") {
        return jsonError(res, 400, "missing entries object");
    }

    // Normalize + validate. Silently drop anything that isn't a
    // "commands/<id>" key OR carries none of writesTo/description/argsHint/
    // argsWhenEmpty (nothing to hydrate). All four are individually
    // optional but at least one must be present and non-empty.
    const cleaned = {};
    for (const [key, entry] of Object.entries(incoming)) {
        if (typeof key !== "string" || !key.startsWith("commands/")) continue;
        const writesTo = typeof entry?.writesTo === "string" ? entry.writesTo.trim() : "";
        const description = typeof entry?.description === "string" ? entry.description.trim() : "";
        const argsHint = typeof entry?.argsHint === "string" ? entry.argsHint.trim() : "";
        const argsWhenEmpty = typeof entry?.argsWhenEmpty === "string" ? entry.argsWhenEmpty.trim() : "";
        if (!writesTo && !description && !argsHint && !argsWhenEmpty) continue;
        cleaned[key] = {
            ...(writesTo ? { writesTo } : {}),
            ...(description ? { description } : {}),
            ...(argsHint ? { argsHint } : {}),
            ...(argsWhenEmpty ? { argsWhenEmpty } : {}),
            source: typeof entry?.source === "string" ? entry.source : "llm",
            ...(typeof entry?.skillPath === "string" ? { skillPath: entry.skillPath } : {}),
            ...(typeof entry?.skillHash === "string" ? { skillHash: entry.skillHash } : {}),
        };
    }
    if (!Object.keys(cleaned).length) {
        return jsonError(res, 400, "no valid entries");
    }

    const fsp = await import("node:fs/promises");
    const cacheDir = join(inst.workspacePath, ".speckit-wizard");
    const cachePath = join(cacheDir, "artifact-targets.json");

    // Read existing cache (if any) so we merge instead of clobber.
    let existing = { version: 1, entries: {} };
    try {
        const raw = await fsp.readFile(cachePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
            existing = { version: parsed.version ?? 1, entries: parsed.entries, ...(parsed.notes ? { notes: parsed.notes } : {}) };
        }
    } catch { /* absent or malformed → start fresh */ }

    const merged = {
        ...existing,
        version: 1,
        entries: { ...existing.entries, ...cleaned },
        updatedAt: new Date().toISOString(),
    };

    try {
        await fsp.mkdir(cacheDir, { recursive: true });
        await fsp.writeFile(cachePath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    } catch (err) {
        return jsonError(res, 500, `write failed: ${err?.message ?? err}`);
    }

    const added = Object.keys(cleaned).length;
    // Nudge the client to re-fetch state so the phase cards pick up the
    // new artifact paths without waiting for the next tick.
    broadcast({ type: "invalidate", reason: "artifact-targets updated" });
    return jsonRes(res, 200, { ok: true, merged: added, path: ".speckit-wizard/artifact-targets.json" });
}

// Persist the user's decision to skip installing the default preset(s).
// One-way sticky: flips `setup.defaultPresetsSkipped` to true. The Setup
// row 5 derives its "done" state from EITHER the preset being installed
// OR this flag; the auto-chain in runInit() also respects it.
export async function handleSkipDefaults(res, body, { broadcast, getInstance }) {
    const inst = getInstance();
    if (!inst?.workspacePath) return jsonError(res, 400, "workspace path unavailable");
    const skipped = body?.skipped !== false; // default true
    const fsp = await import("node:fs/promises");
    inst.state = applyPatch(inst.state ?? {}, {
        setup: { defaultPresetsSkipped: !!skipped },
    });
    try {
        await writeState(inst.workspacePath, inst.state, {
            mkdir: fsp.mkdir,
            writeFile: fsp.writeFile,
        });
    } catch (err) {
        return jsonError(res, 500, `state.json write failed: ${err?.message ?? err}`);
    }
    broadcast({ type: "invalidate", reason: "default presets skip flag updated" });
    return jsonRes(res, 200, { ok: true, skipped: !!skipped });
}

// Direct SDK-driven skill-registry reload core. Extracted from
// handleSkillsReload so callers that don't have an HTTP `res` (canvas
// actions, background install-set watcher) can use the SAME code path,
// including the one-way-sticky `setup.skillsReloaded` persistence.
//
// Contract (identical for every caller):
//   • Always runs a fresh `session.rpc.skills.reload()` — no caching, no
//     skipping.
//   • On success, writes `setup.skillsReloaded: true` if not already true.
//     Never writes false. So auto-triggered reloads (install-set watcher,
//     agent canvas action) can only ever HELP by flipping the flag on;
//     they can never disable the UI.
//   • Stashes the transient diagnostic on `inst.skillsReload`.
export async function runSkillsReload({ session, broadcast, getInstance }) {
    const inst = getInstance?.();
    if (!inst) return { ok: false, errors: 1, warnings: 0, at: new Date().toISOString(), error: "instance unavailable" };
    if (!session?.rpc?.skills?.reload) {
        const at = new Date().toISOString();
        const error = "session.rpc.skills.reload not available in this SDK version";
        // Stash the unavailable signal on the instance and broadcast so the
        // UI can render a helpful fallback ("run /skills reload in chat")
        // instead of a stuck spinner. Never persisted to state.json — the
        // SDK gap is a live capability check, not a project fact.
        inst.skillsReload = { ok: false, errors: 1, warnings: 0, at, error, unavailable: true };
        broadcast?.({ type: "invalidate", reason: "skills reload unavailable" });
        return { ok: false, errors: 1, warnings: 0, at, error, unavailable: true };
    }

    const fsp = await import("node:fs/promises");
    const persistOnSuccess = async () => {
        if (!inst.workspacePath) return;
        if (inst.state?.setup?.skillsReloaded === true) return;
        inst.state = applyPatch(inst.state ?? {}, { setup: { skillsReloaded: true } });
        try {
            await writeState(inst.workspacePath, inst.state, {
                mkdir: fsp.mkdir,
                writeFile: fsp.writeFile,
            });
        } catch {
            // best-effort persist; skillsReload diagnostic still stashed
        }
        // Intentionally NOT broadcasting a `state` event here with raw
        // `inst.state` (state.json contents): that payload is missing the
        // `environment` field the snapshot pipeline attaches from
        // `inst.cachedProbes.summary`. Stomping it onto the client would
        // briefly flip `env.pluginInstalled` / `env.cliInstalled` to
        // undefined, which makes the "Install spec-kit plugin" and
        // "Install Specify CLI" setup rows flash from ✓ (green) back to
        // ▶ (pending/yellow) until the follow-up `invalidate` message
        // triggers `refreshState()` on the client. The `invalidate`
        // broadcast emitted by the caller immediately after this function
        // returns (see `broadcast?.({ type: "invalidate", ... })` below)
        // pulls a proper snapshot via `/api/state`, so the UI stays
        // consistent without the flash.
    };

    try {
        const diag = await session.rpc.skills.reload();
        const errors = Array.isArray(diag?.errors) ? diag.errors.length : 0;
        const warnings = Array.isArray(diag?.warnings) ? diag.warnings.length : 0;
        const ok = errors === 0;
        const at = new Date().toISOString();
        inst.skillsReload = { ok, errors, warnings, at };
        if (ok) await persistOnSuccess();
        broadcast?.({ type: "invalidate", reason: ok ? "skills reloaded" : "skills reload failed" });
        return { ok, errors, warnings, at };
    } catch (err) {
        const at = new Date().toISOString();
        inst.skillsReload = {
            ok: false,
            errors: 1,
            warnings: 0,
            at,
            error: err?.message ?? String(err),
        };
        broadcast?.({ type: "invalidate", reason: "skills reload failed" });
        return { ok: false, errors: 1, warnings: 0, at, error: err?.message ?? String(err) };
    }
}

// HTTP wrapper — used by the setup flow's `POST /api/skills/reload` and by
// the Composition "Refresh Now" button. All the persistence and one-way-
// sticky logic lives in `runSkillsReload`.
export async function handleSkillsReload(res, deps) {
    const result = await runSkillsReload(deps);
    if (result.ok || (typeof result.errors === "number" && !result.error)) {
        // Reload ran; may have had non-fatal errors (result.ok === false with
        // errors > 0). Either way, return the diagnostic body so the client
        // can display the counts.
        return jsonRes(res, result.ok ? 200 : 200, result);
    }
    return jsonError(res, 500, `skills reload failed: ${result.error ?? "unknown"}`);
}

// Force-refresh the env probe (plugin / CLI presence, versions). Used by the
// Setup rows 1 & 2 "↻ Recheck" links so a user who has just installed the
// missing tool doesn't have to reload the extension to see the new status.
//
// `ensureEnvProbe` already handles cache invalidation via the `force` flag
// and writes `setup.pluginInstalled` / `setup.cliInstalled` into state.json;
// we just need to broadcast a fresh snapshot afterwards so every listening
// canvas UI re-renders with the new values.
export async function handleProbeEnv(res, { getState, broadcast, getInstance, ensureEnvProbe }) {
    const inst = getInstance?.();
    if (!inst) return jsonError(res, 400, "instance unavailable");
    try {
        await ensureEnvProbe(inst, { force: true });
    } catch (err) {
        return jsonError(res, 500, `env probe failed: ${err?.message ?? err}`);
    }
    try {
        const fresh = await getState();
        broadcast({ type: "state", data: fresh });
    } catch {
        broadcast({ type: "state", data: inst.state });
    }
    const summary = inst.cachedProbes?.summary ?? {};
    return jsonRes(res, 200, {
        ok: true,
        pluginInstalled: !!summary.pluginInstalled,
        pluginVersion: summary.pluginVersion ?? null,
        cliInstalled: !!summary.cliInstalled,
        cliVersion: summary.cliVersion ?? null,
    });
}
