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
// these fields, the `js-yaml` dependency can be removed.
// See preset-loader.mjs and composition/collect.mjs for the call sites.
//
// -----------------------------------------------------------------------
// Why we auto-install instead of relying on Copilot CLI
// -----------------------------------------------------------------------
// Copilot CLI does not install canvas dependencies. Both parsers are
// imported only when needed, so the providers can register before the
// Wizard's first-open setup checks and installs missing dependencies.
//
// -----------------------------------------------------------------------
// How the check relies on package.json
// -----------------------------------------------------------------------
// The Wizard checks its YAML parser and the sibling Designer's renderer
// parser. Each package.json pins its own dependency; the matching
// node_modules/<name>/package.json marks a completed install.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyNpmError } from "./deps-error-classifier.mjs";

const EXT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const DESIGNER_DIR = join(EXT_DIR, "..", "speckit-canvas-designer");

const DEP_MARKERS = [
    { name: "js-yaml", dir: EXT_DIR },
    { name: "es-module-lexer", dir: DESIGNER_DIR },
];

export function getExtensionDir() {
    return EXT_DIR;
}

export function getDependencyDir(name) {
    const dependency = DEP_MARKERS.find((entry) => entry.name === name);
    if (!dependency) throw new Error(`Unknown Wizard dependency: ${name}`);
    return dependency.dir;
}

/**
 * @returns {Promise<{ ready: boolean, missing: string[] }>}
 *   ready is true iff every declared dep marker exists on disk.
 */
export async function checkDeps() {
    const missing = [];
    for (const { name, dir } of DEP_MARKERS) {
        try {
            if (!(await stat(join(dir, "node_modules", name, "package.json"))).isFile()) missing.push(name);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            missing.push(name);
        }
    }
    return { ready: missing.length === 0, missing };
}

/**
 * Run `npm ci --omit=dev` in each dependency's extension directory to install any
 * missing runtime deps. Rejects unknown dependency names; npm failures
 * resolve with { ok: false, stdout, stderr, code, classified, packageName, extDir }.
 *
 * `onProgress(line)` is invoked with each stdout/stderr line as it arrives
 * so the boot UI can show a live "npm is doing something" status. The
 * caller is expected to throttle broadcasts of these lines.
 *
 * @param {string[]} packages
 * @param {{ onProgress?: (line: string) => void }} [opts]
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code: number | null, classified?: object, packageName?: string, extDir?: string }>}
 */
export async function installDeps(packages, opts = {}) {
    let result = { ok: true, stdout: "", stderr: "", code: 0 };
    for (const name of packages ?? []) {
        const extDir = getDependencyDir(name);
        result = await installDependency(extDir, opts);
        if (!result.ok) return { ...result, packageName: name, extDir };
    }
    return result;
}

function installDependency(extDir, opts) {
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    return new Promise((resolve) => {
        const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
        // Drop --silent when streaming progress so the UI sees fetch/reify
        // lines. --loglevel=info gives useful progress without dumping the
        // full trace.
        const args = onProgress
            ? ["ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=info"]
            : ["ci", "--omit=dev", "--no-audit", "--no-fund", "--silent"];
        let child;
        try {
            child = spawn(npmCmd, args, {
                cwd: extDir,
                // Use a shell on every platform. On Windows this is required
                // because npm ships as npm.cmd and Node 20+ refuses to spawn
                // .cmd/.bat without a shell (EINVAL). On POSIX it's a no-op
                // for correctness but keeps behavior uniform. Args are fixed
                // flags, not user input.
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
