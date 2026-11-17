// speckit-wizard — extension-command artifact discovery (cache-driven).
//
// Extracted from scanner.mjs. The wizard doesn't try to guess where an
// extension writes its artifact from filename conventions (that's already
// been proven wrong: the assess extension's `speckit.assess.define` command
// writes `problem.md`, not `define.md`). Instead we read a small cache that
// either the extension author or the Copilot agent (via LLM inference over
// the skill body) populated:
//
//   .speckit-wizard/artifact-targets.json
//   {
//     "version": 1,
//     "entries": {
//       "commands/speckit.assess.define": {
//         "writesTo": ".specify/assessments/<slug>/problem.md",
//         "source": "llm" | "manual" | "author",
//         "skillHash": "sha1..."   // optional; agent invalidates on drift
//       },
//       ...
//     }
//   }
//
// Inference writes through the wizard's HTTP surface. Cache entries outlive
// their source packages so a later reinstall can reuse prior inference.

import { dirname, isAbsolute, join, relative } from "node:path";
import { artifactPath, readEvidenceCache } from "../artifact-evidence.mjs";
import { CORE_COMMANDS } from "../pipeline/canonical.mjs";
import { emptyPhaseSlice } from "../canvas-runtime/wizard-phases.mjs";
import { toPortable } from "./fs-helpers.mjs";
import {
    safeReaddir,
    pickNewestSubdir,
    securePathWithin,
    canonicalizePath,
    isPathContained,
} from "./fs-helpers.mjs";

export async function hydrateExtensionArtifactsFromCache({ cwd, phases, slug, deps, warnings = [] }) {
    const cachePath = join(cwd, ".speckit-wizard", "artifact-targets.json");
    if (!(await deps.pathExists(cachePath))) return;

    const cache = await (deps.readEvidenceCache ?? readEvidenceCache)(cwd);
    const entries = cache?.entries;
    if (!entries || typeof entries !== "object") return;

    // Keep stale cache entries on disk, but only hydrate currently available
    // commands. This preserves inference if a removed package is restored.
    const installedCommandKeys = await discoverInstalledCommandKeys(cwd, deps);
    for (const [key, entry] of Object.entries(entries)) {
        if (typeof key !== "string" || !key.startsWith("commands/")) continue;
        const command = key.slice("commands/".length);
        const skill = `.github/skills/${command.replaceAll(".", "-")}/SKILL.md`;
        if (installedCommandKeys && !installedCommandKeys.has(key)
            && !CORE_COMMANDS.includes(command) && !await deps.pathExists(join(cwd, skill))) continue;
        const writesTo = typeof entry?.writesTo === "string"
            && (artifactPath(entry.writesTo) || isAbsolute(entry.writesTo)) ? entry.writesTo : null;
        const description = typeof entry?.description === "string" ? entry.description.trim() : "";
        const argsHint = typeof entry?.argsHint === "string" ? entry.argsHint.trim() : "";
        const argsWhenEmpty = typeof entry?.argsWhenEmpty === "string" ? entry.argsWhenEmpty.trim() : "";
        if (!writesTo && !description && !argsHint && !argsWhenEmpty) continue;

        const prior = phases[key] ?? emptyPhaseSlice(key);
        const next = { ...prior };

        if (description) next.description = description;
        if (argsHint) next.argsHint = argsHint;
        if (argsWhenEmpty) next.argsWhenEmpty = argsWhenEmpty;

        if (writesTo) {
            // Cache uses `<slug>` as a placeholder for the current assessment /
            // feature / run slug. Resolution strategy:
            //   1) If the spec-kit slug substitutes to an existing file, use it.
            //   2) Otherwise, for `.specify/<domain>/<slug>/<file>` templates,
            //      pick the newest subdir under `.specify/<domain>/` — the
            //      same "most recently modified" rule core phases use to
            //      auto-select the active feature slug. This handles
            //      extension-specific slugs (assessment slugs, per-run
            //      slugs, …) the scanner has no other visibility into.
            //   3) Fall back to the literal template so the renderer still
            //      shows "where would this write".
            let resolvedPath = writesTo;
            if (writesTo.includes("<slug>")) {
                const direct = slug ? writesTo.replace(/<slug>/g, slug) : null;
                if (direct && (await secureExistingPath(join(cwd, direct), cwd, deps))) {
                    resolvedPath = direct;
                } else {
                    const match = writesTo.match(/^\.specify\/([^/]+)\/<slug>\/(.+)$/);
                    if (match) {
                        const [, domain, tail] = match;
                        const newest = await pickNewestSubdir(
                            join(cwd, ".specify", domain),
                            deps,
                        );
                        if (newest) {
                            resolvedPath = `.specify/${domain}/${newest.name}/${tail}`;
                        } else if (direct) {
                            resolvedPath = direct;
                        }
                    } else if (direct) {
                        resolvedPath = direct;
                    }
                }
            }
            // Compute status from file existence (same rule core phases use).
            const abs = isAbsolute(resolvedPath) ? resolvedPath : join(cwd, resolvedPath);
            const lexicallyInsideWorkspace = isPathContained(canonicalizePath(cwd), canonicalizePath(abs));
            if (!lexicallyInsideWorkspace) {
                phases[key] = next;
                continue;
            }

            const artifactRelPath = isAbsolute(resolvedPath) ? relative(cwd, abs) : resolvedPath;
            next.artifactPath = toPortable(artifactRelPath);
            const safeArtifactPath = await secureExistingPath(abs, cwd, deps);
            if (safeArtifactPath) {
                next.status = "done";
                const mtimeIso = await artifactMtimeIso(safeArtifactPath, deps);
                if (mtimeIso) next.lastRunAt = mtimeIso;
            } else if (next.status === "done") {
                next.status = "empty";
            }

            // "Browse folder" fallback signal: when the file doesn't exist
            // but its parent folder does, the inferred filename is probably
            // wrong (skill wrote to a different filename in the same slug
            // dir). Emit `folderPath` so the UI can offer a folder-listing
            // link. Silent when the folder is also missing — the phase
            // simply hasn't been run yet.
            if (!safeArtifactPath) {
                const parentRel = dirname(artifactRelPath);
                if (parentRel && parentRel !== ".") {
                    const parentAbs = join(cwd, parentRel);
                    const safeParentPath = await secureExistingPath(parentAbs, cwd, deps);
                    if (safeParentPath) {
                        const mtimeIso = await newestMarkdownMtimeIso(safeParentPath, cwd, deps);
                        if (mtimeIso) next.lastRunAt = mtimeIso;
                        next.folderPath = toPortable(parentRel);
                    }
                }
            }
        }

        phases[key] = next;
    }
}

async function secureExistingPath(absPath, cwd, deps) {
    const safePath = await securePathWithin(absPath, cwd, cwd, deps);
    if (!safePath) return null;
    return await deps.pathExists(safePath) ? safePath : null;
}

async function artifactMtimeIso(absPath, deps) {
    try {
        const st = await deps.stat(absPath);
        const mtimeMs = Number(st?.mtimeMs ?? 0);
        if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return null;
        return new Date(mtimeMs).toISOString();
    } catch {
        return null;
    }
}

async function newestMarkdownMtimeIso(dirAbs, cwd, deps) {
    try {
        const entries = await safeReaddir(dirAbs, deps);
        let newestMs = 0;
        for (const entry of entries) {
            const name = typeof entry?.name === "string" ? entry.name : "";
            if (!name.endsWith(".md") || entry?.isDirectory?.()) continue;
            const securedPath = await securePathWithin(join(dirAbs, name), dirAbs, cwd, deps);
            if (!securedPath) continue;
            const st = await deps.stat(securedPath).catch(() => null);
            const mtimeMs = Number(st?.mtimeMs ?? 0);
            if (Number.isFinite(mtimeMs) && mtimeMs > newestMs) newestMs = mtimeMs;
        }
        return newestMs > 0 ? new Date(newestMs).toISOString() : null;
    } catch {
        return null;
    }
}

// Enumerate `.specify/extensions/*/commands/*.md` and return the set of
// `commands/<basename>` keys available for hydration. Returns an empty Set
// when no extensions are installed and `null` only when an existing
// directory can't be enumerated; neither case changes the on-disk cache.
async function discoverInstalledCommandKeys(cwd, deps) {
    const extRoot = join(cwd, ".specify", "extensions");
    if (!(await deps.pathExists(extRoot))) return new Set();
    const extEntries = await safeReaddir(extRoot, deps).catch(() => null);
    if (!extEntries) return null;

    const keys = new Set();
    for (const ext of extEntries) {
        if (!ext?.isDirectory?.()) continue;
        const cmdDir = join(extRoot, ext.name, "commands");
        if (!(await deps.pathExists(cmdDir))) continue;
        const files = await safeReaddir(cmdDir, deps).catch(() => []);
        for (const f of files) {
            const name = typeof f?.name === "string" ? f.name : null;
            if (!name || !name.endsWith(".md")) continue;
            const stem = name.slice(0, -3);
            keys.add(`commands/${stem}`);
        }
    }
    return keys;
}
