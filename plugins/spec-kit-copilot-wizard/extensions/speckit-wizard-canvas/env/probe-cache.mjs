// probe-cache.mjs — cached environment probe runner.
//
// Runs the shared `runChecks` env probe with a per-instance cache and
// persists `setup.pluginInstalled` / `setup.cliInstalled` into state.json
// so extension reloads and SSE reconnects don't relock the wizard while a
// fresh probe is in flight.

import { spawn } from "node:child_process";
import { pathExists, joinIfPossible } from "./workspace.mjs";
import { runChecks, summarizeResults } from "./probe.mjs";
import { applyPatch, writeState } from "../state/store.mjs";
import { fsDeps } from "../canvas-runtime/instances.mjs";

export async function ensureEnvProbe(inst, { force = false } = {}) {
    const projectInitialized = !!(await pathExists(joinIfPossible(inst.workspacePath, ".specify")));
    const { results, skipped } = await runChecks(
        {
            spawn: (cmd, args, opts) =>
                new Promise((resolve) => {
                    const child = spawn(cmd, args, {
                        cwd: inst.workspacePath || process.cwd(),
                        // On Windows `specify` is a `.cmd` shim that Node's spawn
                        // can only launch through cmd.exe; on macOS/Linux it's a
                        // real binary that spawn runs directly. `shell: true` on
                        // Windows only.
                        shell: process.platform === "win32",
                    });
                    let stdout = ""; let stderr = "";
                    const timer = setTimeout(() => {
                        try { child.kill(); } catch { /* ignore */ }
                    }, opts?.timeoutMs ?? 5000);
                    child.stdout?.on("data", (d) => { stdout += String(d); });
                    child.stderr?.on("data", (d) => { stderr += String(d); });
                    child.on("error", (err) => {
                        clearTimeout(timer);
                        resolve({ exitCode: -1, stdout, stderr, error: err?.message ?? String(err) });
                    });
                    child.on("close", (code) => {
                        clearTimeout(timer);
                        resolve({ exitCode: code ?? -1, stdout, stderr });
                    });
                }),
        },
        {
            force,
            cachedAt: inst.cachedProbes?.at ?? null,
            projectInitialized,
        },
    );
    if (skipped) return inst.cachedProbes?.summary ?? null;
    const summary = summarizeResults(results);
    inst.cachedProbes = { at: Date.now(), results, summary };
    // Persist the env-probe result into `setup.pluginInstalled` /
    // `setup.cliInstalled` so extension reloads and SSE reconnects don't
    // relock the wizard while the fresh probe is in flight. `isSetupComplete`
    // ORs the persisted flag with the live probe — so persisting a `true`
    // here means "on next boot, stay unlocked until a live probe can prove
    // otherwise". We only persist when the probe returns a definite boolean
    // (positive or negative) — skipped/unknown results leave the flag alone.
    try {
        const patch = {};
        if (typeof summary.pluginInstalled === "boolean") {
            patch.pluginInstalled = summary.pluginInstalled;
        }
        if (typeof summary.cliInstalled === "boolean") {
            patch.cliInstalled = summary.cliInstalled;
        }
        if (Object.keys(patch).length && inst.state) {
            const prev = inst.state.setup ?? {};
            const changed = Object.entries(patch).some(([k, v]) => prev[k] !== v);
            if (changed) {
                inst.state = applyPatch(inst.state, { setup: patch });
                await writeState(inst.workspacePath, inst.state, fsDeps);
            }
        }
    } catch { /* best-effort; probe result still returned */ }
    return summary;
}
