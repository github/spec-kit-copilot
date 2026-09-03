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
// This scanner is the read side. Writing / re-inference is the agent's
// job, exposed via the wizard's HTTP surface (see server /api/inference/*).

import { join } from "node:path";
import { emptyPhaseSlice } from "../canvas-runtime/wizard-phases.mjs";
import { toPortable } from "./fs-helpers.mjs";
import {
    safeReaddir,
    readBoundedJson,
    pickNewestSubdir,
    looksLikeUnfilledTemplate,
} from "./fs-helpers.mjs";

export async function hydrateExtensionArtifactsFromCache({ cwd, phases, slug, deps }) {
    const cachePath = join(cwd, ".speckit-wizard", "artifact-targets.json");
    if (!(await deps.pathExists(cachePath))) return;

    const cache = await readBoundedJson(cachePath, deps);
    const entries = cache?.entries;
    if (!entries || typeof entries !== "object") return;

    // Discover the currently-installed extension command set so we can
    // prune orphaned cache entries (extensions the user has since
    // uninstalled). Without this, a `commands/foo.bar` entry would linger
    // in the cache forever after `foo` was removed, and the LLM
    // dispatcher would think the world is in sync when it isn't.
    //
    // Source of truth: `.specify/extensions/<ext>/commands/*.md`. If the
    // directory is missing we can't distinguish "no extensions installed"
    // from "not scannable" — skip pruning in that case rather than
    // wiping the cache accidentally.
    const installedCommandKeys = await discoverInstalledCommandKeys(cwd, deps);

    let prunedAny = false;
    const kept = {};
    for (const [key, entry] of Object.entries(entries)) {
        if (typeof key !== "string" || !key.startsWith("commands/")) {
            prunedAny = true;
            continue;
        }
        // Only prune when we successfully enumerated installed commands
        // (installedCommandKeys is a Set). If it's null we couldn't scan,
        // so leave the entry alone.
        if (installedCommandKeys && !installedCommandKeys.has(key)) {
            prunedAny = true;
            continue;
        }
        kept[key] = entry;
    }

    if (prunedAny) {
        // Persist the pruned cache back to disk so subsequent scans
        // (and any consumer that reads the file directly) see a clean
        // picture. Best-effort — a write failure just means we'll try
        // again next scan.
        try {
            const fsp = await import("node:fs/promises");
            const nextCache = {
                ...cache,
                version: 1,
                entries: kept,
                updatedAt: new Date().toISOString(),
            };
            await fsp.writeFile(cachePath, JSON.stringify(nextCache, null, 2) + "\n", "utf8");
        } catch { /* leave stale — next scan retries */ }
    }

    for (const [key, entry] of Object.entries(kept)) {
        const writesTo = typeof entry?.writesTo === "string" ? entry.writesTo : null;
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
                if (direct && (await deps.pathExists(join(cwd, direct)))) {
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
            const artifactRel = toPortable(resolvedPath);
            next.artifactPath = artifactRel;

            // Compute status from file existence (same rule core phases use).
            const abs = join(cwd, resolvedPath);
            const fileExists = await deps.pathExists(abs);
            if (fileExists) {
                const unfilled = await looksLikeUnfilledTemplate(abs, deps);
                next.status = unfilled ? "empty" : "done";
                const mtimeIso = await artifactMtimeIso(abs, deps);
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
            if (!fileExists) {
                const parentRel = resolvedPath.includes("/")
                    ? resolvedPath.slice(0, resolvedPath.lastIndexOf("/"))
                    : "";
                if (parentRel) {
                    const parentAbs = join(cwd, parentRel);
                    if (await deps.pathExists(parentAbs)) {
                        next.folderPath = toPortable(parentRel);
                        const mtimeIso = await artifactMtimeIso(parentAbs, deps);
                        if (mtimeIso) next.lastRunAt = mtimeIso;
                    }
                }
            }
        }

        phases[key] = next;
    }
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

// Enumerate `.specify/extensions/*/commands/*.md` and return the set of
// `commands/<basename>` keys that map to actually-installed command
// files. Returns an empty Set (NOT null) when the extensions root
// doesn't exist, so an uninstall-all scenario correctly prunes every
// `commands/*` entry from the cache. Returns `null` only when the
// directory exists but can't be enumerated (permissions, race with a
// concurrent write) — in that case callers should skip pruning rather
// than risk wiping valid entries on a transient read failure.
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
