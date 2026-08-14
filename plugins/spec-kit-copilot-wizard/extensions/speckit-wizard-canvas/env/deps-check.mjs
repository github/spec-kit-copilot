// speckit-wizard — canvas dependency probe.
//
// -----------------------------------------------------------------------
// Why the wizard canvas has an npm dependency at all
// -----------------------------------------------------------------------
// The wizard needs the full parsed contents of `preset.yml` /
// `extension.yml` / `bundle.yml` manifests to build composition previews
// (artifact layers, hooks, dependencies, slots). Today the `specify` CLI
// list commands only return shallow summary metadata (id/name/version/
// description) and do NOT expose those manifest fields. Until the CLI
// adds a "return the raw parsed manifest" verb, the wizard fetches the
// raw .yml files itself and parses them locally, which requires a YAML
// parser — hence the `js-yaml` runtime dependency declared in
// package.json. This is intentionally a workaround: once the CLI covers
// these fields, this file and the `js-yaml` dep can both be deleted.
// See preset-loader.mjs and composition/collect.mjs for the call sites.
//
// -----------------------------------------------------------------------
// Why we auto-install instead of relying on Copilot CLI
// -----------------------------------------------------------------------
// Copilot CLI does NOT run `npm install` for canvas extensions on launch
// — it just dynamic-imports the canvas entry (extension.mjs) into a
// forked node process. If `node_modules/js-yaml/` isn't there, module
// resolution throws before our code ever runs and the canvas is
// reported as `failed` in `/plugin list`. Fresh clones and fresh
// worktrees both start without a `node_modules/`, so to keep first-open
// friction low, the canvas open flow calls checkDeps() and — if anything
// is missing — runs installDeps() (npm install) automatically before
// starting the server. The user sees a brief "opening…" delay instead of
// a hard error.
//
// -----------------------------------------------------------------------
// How the check relies on package.json
// -----------------------------------------------------------------------
// This module hard-codes the SET of expected deps in DEP_MARKERS below
// (currently just `js-yaml`), but package.json is what actually pins the
// version range (`js-yaml: ^5.2.3`). When installDeps() runs
// `npm install <name>` inside the canvas folder, npm reads
// package.json to decide which version to fetch, honours the caret
// range, and (if present) obeys package-lock.json for reproducible
// resolution. Without package.json we'd get unpinned "latest" every
// time. The completion marker we probe is
// `<extDir>/node_modules/<name>/package.json` — the presence of that
// nested package.json is our "npm install finished successfully"
// signal (see checkDeps() below). So package.json is doing double duty:
// version pin for OUR install, and marker artifact for the completion
// check.
//
// This file centralises the "which deps do we need and where do they
// live?" policy plus the install helper so it stays in one place. Add
// another entry to DEP_MARKERS if we ever grow a second runtime dep.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyNpmError } from "./deps-error-classifier.mjs";

const EXT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// A single package.json under node_modules is a cheap-and-reliable
// "is npm install done?" marker: `npm install js-yaml` writes
// node_modules/js-yaml/package.json as one of its final steps, so the
// existence of that file means the install succeeded for this dep. The
// name comes from the wizard's own package.json `dependencies` block —
// keep the list here in sync with that. Add another entry here if we
// ever grow a second runtime dep.
const DEP_MARKERS = [
    { name: "js-yaml", markerPath: join(EXT_DIR, "node_modules", "js-yaml", "package.json") },
];

export function getExtensionDir() {
    return EXT_DIR;
}

/**
 * @returns {Promise<{ ready: boolean, missing: string[] }>}
 *   ready is true iff every declared dep marker exists on disk.
 */
export async function checkDeps() {
    const missing = [];
    for (const { name, markerPath } of DEP_MARKERS) {
        try { await stat(markerPath); }
        catch { missing.push(name); }
    }
    return { ready: missing.length === 0, missing };
}

/**
 * Run `npm install <packages>` inside the extension directory to install any
 * missing runtime deps. Resolves with { ok, stdout, stderr, code, classified? }.
 * Never throws — callers inspect `ok` and surface a friendly message if false.
 *
 * `onProgress(line)` is invoked with each stdout/stderr line as it arrives
 * so the boot UI can show a live "npm is doing something" status. The
 * caller is expected to throttle broadcasts of these lines.
 *
 * @param {string[]} packages
 * @param {{ onProgress?: (line: string) => void }} [opts]
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code: number | null, classified?: object }>}
 */
export function installDeps(packages, opts = {}) {
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    return new Promise((resolve) => {
        if (!packages || packages.length === 0) {
            resolve({ ok: true, stdout: "", stderr: "", code: 0 });
            return;
        }
        const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
        // Drop --silent when streaming progress so the UI sees fetch/reify
        // lines. --loglevel=info gives useful progress without dumping the
        // full trace.
        const args = onProgress
            ? ["install", "--no-audit", "--no-fund", "--loglevel=info", ...packages]
            : ["install", "--no-audit", "--no-fund", "--silent", ...packages];
        let child;
        try {
            child = spawn(npmCmd, args, {
                cwd: EXT_DIR,
                // Use a shell on every platform. On Windows this is required
                // because npm ships as npm.cmd and Node 20+ refuses to spawn
                // .cmd/.bat without a shell (EINVAL). On POSIX it's a no-op
                // for correctness but keeps behavior uniform. Args come from
                // our own DEP_MARKERS constant, so shell injection isn't a
                // concern here.
                shell: true,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (err) {
            const missingBinary = err?.code === "ENOENT";
            const stderr = String(err?.message || err);
            resolve({
                ok: false,
                stdout: "",
                stderr,
                code: null,
                classified: classifyNpmError({ stderr, missingBinary }),
            });
            return;
        }
        let stdout = "";
        let stderr = "";
        // Line-buffer so onProgress sees meaningful units. npm prints
        // progress bar frames a lot; we keep the last non-blank line.
        const feed = (buf, sinkKey) => {
            const s = buf.toString();
            if (sinkKey === "stdout") stdout += s; else stderr += s;
            if (!onProgress) return;
            for (const raw of s.split(/\r?\n/)) {
                const line = raw.trim();
                if (line) {
                    try { onProgress(line); } catch { /* best-effort */ }
                }
            }
        };
        child.stdout?.on("data", (d) => feed(d, "stdout"));
        child.stderr?.on("data", (d) => feed(d, "stderr"));
        child.on("error", (err) => {
            const missingBinary = err?.code === "ENOENT";
            const merged = stderr + String(err?.message || err);
            resolve({
                ok: false,
                stdout,
                stderr: merged,
                code: null,
                classified: classifyNpmError({ stderr: merged, stdout, missingBinary }),
            });
        });
        child.on("close", (code) => {
            const ok = code === 0;
            const result = { ok, stdout, stderr, code };
            if (!ok) result.classified = classifyNpmError({ stderr, stdout, code });
            resolve(result);
        });
    });
}
