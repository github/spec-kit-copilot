// speckit-wizard — CLI-backed composition source.
//
// Uses `specify artifact list --json` + `specify artifact info <id> --json`
// as the sole source of truth for the composition slice.
//
// Shape mapping (CLI → wizard):
//   • CLI id `command:<name>`   → wizard id `commands/<name>`
//   • CLI id `template:<name>`  → wizard id `<name>` (bare)
//   • CLI id `script:<name>`    → wizard id `<name>` (bare)
//   • CLI `layer: null` (built-in) → wizard `layer: "core"`
//   • CLI `active` (index-0 winner) → passed through verbatim
//   • Everything else — presetId, presetName, strategy, hidden, sourceId,
//     manifestPath, lookupId — passed through unchanged.
//
// Hook enrichment (`kind: "hook"`, `hookBindings`) is layered on top by
// reading extension manifests — the CLI doesn't distinguish hook artifacts
// from ordinary command artifacts.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readExtensionManifest, readHooksMap } from "./hooks.mjs";

const execFileP = promisify(execFile);
// Default runner. Async so it doesn't block the Node event loop while a
// shell-out is in flight. Returns a string (stdout). Tests inject a
// synchronous runner that returns a Buffer/string — we `await` its
// return, which unwraps both sync and Promise values transparently.
const defaultAsyncRunner = async (cmd, args, opts) => {
    const { stdout } = await execFileP(cmd, args, opts);
    return stdout;
};

const CLI_COMMAND_TIMEOUT_MS = 15_000;

// Windows may ship `specify` as `.cmd`/`.bat` (uv tool / pipx layouts).
// Node ≥ 20.12.2 refuses to spawn those without a shell (CVE-2024-27980),
// so route through cmd.exe on Windows only. POSIX stays direct-exec.
function specifyExecOpts(cwd) {
    return {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        timeout: CLI_COMMAND_TIMEOUT_MS,
    };
}

// ---------------------------------------------------------------------------
// Public: raw CLI wrappers. `runner` can be injected for tests.
// ---------------------------------------------------------------------------

export async function specifyArtifactList(root, { runner = defaultAsyncRunner } = {}) {
    const stdout = await runner(
        "specify",
        ["artifact", "list", "--json"],
        specifyExecOpts(root),
    );
    return JSON.parse(String(stdout));
}

export async function specifyArtifactInfo(root, id, { runner = defaultAsyncRunner } = {}) {
    const stdout = await runner(
        "specify",
        ["artifact", "info", id, "--json"],
        specifyExecOpts(root),
    );
    return JSON.parse(String(stdout));
}

// ---------------------------------------------------------------------------
// Shape mapping helpers
// ---------------------------------------------------------------------------
//
// Guardrails — keep the CLI's contract intact when translating stack layers:
//
//   1. `layer: null` on the CLI means the built-in tier. We display it as
//      "core" for the UI, but that's cosmetic ONLY. `sourceId`, `presetId`,
//      `presetName`, `manifestPath`, and `lookupId` stay null on that layer.
//      Never synthesize provenance fields to match the display label. When
//      code needs to ask "does this layer have provenance?", check
//      `sourceId != null` / `presetId != null` — not `layer !== "core"`.
//
//   2. The round-trip key back to the CLI is the top-level `id`
//      (`command:X`, `template:X`, `script:X`) — never `lookupId`, which is
//      null for built-in layers. `buildCompositionFromCli` below passes
//      `row.id` from `artifact list` straight into `artifact info`.
//
//   3. Prefer exclusion filters over positive `layer === "core"` predicates.
//      "User customized this" is `stack.some(l => l.layer === "project")`;
//      "not project-owned" is `l.layer !== "project"`. Treat the null-layer
//      state as the semantic truth, `"core"` as its display alias.

const VALID_STRATEGIES = new Set(["replace", "wrap", "prepend", "append"]);

function cliIdToWizardId(cliId, kind) {
    if (typeof cliId !== "string") return null;
    // CLI ids are `<kind>:<name>`; strip prefix (defensive: also accept
    // already-bare names in case the CLI ever grows a --bare mode).
    const sep = cliId.indexOf(":");
    const name = sep >= 0 ? cliId.slice(sep + 1) : cliId;
    if (!name) return null;
    return kind === "command" ? `commands/${name}` : name;
}

function normalizeCliStackLayer(layer) {
    if (!layer || typeof layer !== "object") return null;
    const strategy = typeof layer.strategy === "string" && VALID_STRATEGIES.has(layer.strategy)
        ? layer.strategy
        : "replace";
    return {
        // CLI `null` layer = built-in; wizard code expects "core".
        layer: layer.layer == null ? "core" : layer.layer,
        presetId: layer.presetId ?? null,
        presetName: layer.presetName ?? null,
        sourceId: layer.sourceId ?? null,
        strategy,
        active: !!layer.active,
        hidden: !!layer.hidden,
        manifestPath: layer.manifestPath ?? null,
        lookupId: layer.lookupId ?? null,
    };
}

function shapeArtifact(cliArtifact) {
    if (!cliArtifact || typeof cliArtifact !== "object") return null;
    const kind = cliArtifact.kind;
    if (kind !== "command" && kind !== "template" && kind !== "script") return null;
    const wizardId = cliIdToWizardId(cliArtifact.id, kind);
    if (!wizardId) return null;
    const stack = Array.isArray(cliArtifact.stack)
        ? cliArtifact.stack.map(normalizeCliStackLayer).filter(Boolean)
        : [];
    return {
        id: wizardId,
        kind,
        description: cliArtifact.description ?? "",
        stack,
    };
}

// ---------------------------------------------------------------------------
// Preset/extension summary derivation
// ---------------------------------------------------------------------------

function accumulateProvidesCounts(artifacts) {
    // Map<sourceKey, { commands, templates, scripts, layerKind }>
    // sourceKey = `${layer}:${presetId}` — distinguishes preset "foo" from
    // extension "foo" if names ever collide.
    const counts = new Map();
    for (const artifact of artifacts) {
        for (const layer of artifact.stack) {
            if (layer.layer !== "preset" && layer.layer !== "extension") continue;
            if (!layer.presetId) continue;
            const key = `${layer.layer}:${layer.presetId}`;
            let entry = counts.get(key);
            if (!entry) {
                entry = {
                    layerKind: layer.layer,
                    presetId: layer.presetId,
                    presetName: layer.presetName ?? layer.presetId,
                    commands: 0,
                    templates: 0,
                    scripts: 0,
                };
                counts.set(key, entry);
            }
            if (artifact.kind === "command") entry.commands++;
            else if (artifact.kind === "template") entry.templates++;
            else if (artifact.kind === "script") entry.scripts++;
        }
    }
    return counts;
}

function summarizeInstalled(kind, artifacts, cachedItems, extraExtensionData) {
    const counts = accumulateProvidesCounts(artifacts);
    const cachedById = new Map(
        (cachedItems ?? [])
            .filter((it) => it && it.active)
            .map((it) => [it.installedId || it.id, it]),
    );
    // Iterate the union: cached catalog items (so we get version/priority
    // even when an installed preset provides nothing yet) + any presetIds
    // observed in stacks (so we don't miss anything).
    const ids = new Set();
    for (const [, item] of cachedById) ids.add(item.installedId || item.id);
    for (const [key, entry] of counts) {
        if (entry.layerKind !== kind) continue;
        ids.add(entry.presetId);
    }
    const out = [];
    for (const id of ids) {
        const key = `${kind}:${id}`;
        const c = counts.get(key);
        const cached = cachedById.get(id);
        if (!c && !cached) continue;
        const item = {
            id,
            name: c?.presetName ?? cached?.name ?? id,
            version: cached?.version ?? undefined,
            priority: typeof cached?.priority === "number" ? cached.priority : 10,
            enabled: true,
            description: cached?.description ?? "",
            provides: {
                commands: c?.commands ?? 0,
                templates: c?.templates ?? 0,
                scripts: c?.scripts ?? 0,
            },
        };
        if (kind === "extension") {
            const extra = extraExtensionData?.get(id);
            if (extra) {
                if (extra.category) item.category = extra.category;
                if (extra.effect) item.effect = extra.effect;
                item.provides.hooks = extra.hookCount ?? 0;
            } else if (cached?.category !== undefined || cached?.effect !== undefined) {
                if (cached.category) item.category = cached.category;
                if (cached.effect) item.effect = cached.effect;
                item.provides.hooks = 0;
            } else {
                item.provides.hooks = 0;
            }
        }
        out.push(item);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Hook attribution — layered on top of CLI-derived artifacts
// ---------------------------------------------------------------------------

/**
 * Walk installed extensions on disk. Returns:
 *   • extensionHookInfo: Map<extensionId, { hooks: [], category, effect, hookCount }>
 *   • hooksMap:          .specify/extensions.yml hook bindings, or null
 *
 * Walks installed extensions on disk to collect hook metadata — the CLI's
 * artifact command doesn't emit hook bindings, so we still parse extension.yml.
 */
async function collectHookMetadata(workspaceRoot, activeExtensionIds) {
    const extensionHookInfo = new Map();
    for (const id of activeExtensionIds) {
        const manifest = await readExtensionManifest(workspaceRoot, id);
        if (!manifest || manifest.error) continue;
        extensionHookInfo.set(id, {
            hooks: manifest.hooks ?? [],
            category: manifest.category ?? null,
            effect: manifest.effect ?? null,
            hookCount: (manifest.hooks ?? []).length,
            manifestPath: manifest.manifestPath ?? null,
            name: manifest.name ?? id,
            version: manifest.version ?? null,
        });
    }
    const hooksMap = await readHooksMap(workspaceRoot);
    return { extensionHookInfo, hooksMap };
}

/**
 * Layer hook attributions onto the CLI-derived artifacts array in place:
 *   (a) inline `hooks[]` on the parent phase command artifact
 *   (b) standalone `kind: "hook"` artifact with `hookBindings`.
 *
 * Extension-provided commands whose name matches a declared hook command are
 * removed as `kind: "command"` artifacts (they only exist as hook artifacts).
 */
function applyHookAttributions(artifacts, extensionHookInfo, hooksMap) {
    // Fast id → artifact lookup.
    const byId = new Map(artifacts.map((a) => [a.id, a]));

    // Track hook artifacts as we build them.
    const hookArtifactsById = new Map();

    // Collect the set of hook command names per extension so we can remove
    // the corresponding "command" artifact rows.
    const extensionHookCommandNames = new Map(); // extensionId -> Set<string>

    for (const [extensionId, info] of extensionHookInfo) {
        for (const hook of info.hooks) {
            const phase = hook.phase;
            const hookCommand = hook.command;
            if (!phase || !hookCommand) continue;

            // Track for command-artifact suppression.
            let set = extensionHookCommandNames.get(extensionId);
            if (!set) {
                set = new Set();
                extensionHookCommandNames.set(extensionId, set);
            }
            set.add(hookCommand);

            const registeredBindings = hooksMap?.[phase] ?? [];
            const registered = registeredBindings.some(
                (b) => b?.extension === extensionId && (b?.command == null || b.command === hookCommand),
            );

            // (a) Inline attribution on the parent phase command artifact.
            const targetPhaseName = phase.replace(/^(before_|after_)/, "");
            const parentCommandId = `commands/speckit.${targetPhaseName}`;
            const parent = byId.get(parentCommandId);
            if (parent) {
                (parent.hooks ??= []).push({
                    phase,
                    extensionId,
                    extensionName: info.name,
                    targetCommand: hookCommand,
                    declared: true,
                    registered,
                });
            }

            // (b) Standalone hook artifact.
            const hookArtifactId = `commands/${hookCommand}`;
            let hookArtifact = hookArtifactsById.get(hookArtifactId);
            if (!hookArtifact) {
                hookArtifact = {
                    id: hookArtifactId,
                    kind: "hook",
                    description: "",
                    stack: [],
                    hookBindings: [],
                };
                hookArtifactsById.set(hookArtifactId, hookArtifact);
            }
            const binding = {
                phase,
                targetCommand: hookCommand,
                optional: !!hook.optional,
                extensionId,
                manifestPath: info.manifestPath,
            };
            const bindingKey = `${binding.phase}|${binding.extensionId}`;
            if (!hookArtifact.hookBindings.some((b) => `${b.phase}|${b.extensionId}` === bindingKey)) {
                hookArtifact.hookBindings.push(binding);
            }
            hookArtifact.hookBinding = hookArtifact.hookBindings[0];
            if (!hookArtifact.stack.some((l) => l.presetId === extensionId)) {
                hookArtifact.stack.push({
                    layer: "extension",
                    presetId: extensionId,
                    presetName: info.name,
                    sourceId: extensionId,
                    strategy: "replace",
                    active: hookArtifact.stack.length === 0,
                    hidden: false,
                    manifestPath: info.manifestPath,
                    lookupId: null,
                });
            }
        }
    }

    // Strip extension-provided command artifacts whose name matches a
    // declared hook command from the same extension. The hook artifact
    // above replaces them.
    const filtered = artifacts.filter((artifact) => {
        if (artifact.kind !== "command") return true;
        const name = artifact.id.replace(/^commands\//, "");
        // If any extension declares this name as a hook command AND that
        // extension appears in the artifact's stack, drop the command row.
        for (const [extensionId, names] of extensionHookCommandNames) {
            if (!names.has(name)) continue;
            const owns = artifact.stack.some(
                (l) => l.layer === "extension" && l.presetId === extensionId,
            );
            if (owns) return false;
        }
        return true;
    });

    // Append hook artifacts.
    filtered.push(...hookArtifactsById.values());
    return filtered;
}

// ---------------------------------------------------------------------------
// Public: build the wizard composition payload from the CLI
// ---------------------------------------------------------------------------

/**
 * Build the wizard's `{ presets, extensions, artifacts }` composition payload
 * from the CLI. Layers hook enrichment on top of the CLI-derived artifacts.
 *
 * @param {object} opts
 * @param {string} opts.workspaceRoot   Absolute path to the workspace root.
 * @param {Array}  opts.presetItems     Cached preset catalog (inst.cachedPresetItems).
 * @param {Array}  opts.extensionItems  Cached extension catalog (inst.cachedExtensionItems).
 * @param {Function} [opts.runner]      Injectable runner — for tests. Returns
 *                                      stdout as a string/Buffer, sync or async.
 */
export async function buildCompositionFromCli({
    workspaceRoot,
    presetItems,
    extensionItems,
    runner = defaultAsyncRunner,
} = {}) {
    // 1. List every artifact.
    const list = await specifyArtifactList(workspaceRoot, { runner });

    // 2. Fan out info-per-id in parallel. When we still used the sync
    //    `execFileSync` runner this had to be a serial loop — parallel
    //    sync spawn would starve the event loop and hang HTTP requests
    //    for the whole boot. With the async runner each `execFile` is
    //    non-blocking, so `Promise.all` finishes in the time of the
    //    slowest single call rather than N × per-call latency (was the
    //    dominant cost on stacks with many artifacts).
    const infoResults = await Promise.all(
        list.map(async (row) => {
            if (!row?.id) return null;
            try {
                return await specifyArtifactInfo(workspaceRoot, row.id, { runner });
            } catch {
                // If info fails for one artifact, skip it — the list already
                // told us it exists; a broken info call means composition
                // is partially degraded but not fatally so.
                return null;
            }
        }),
    );
    const artifactsRaw = [];
    for (const info of infoResults) {
        if (!info) continue;
        const shaped = shapeArtifact(info);
        if (shaped) artifactsRaw.push(shaped);
    }

    // 3. Enrich with hook metadata (extension.yml manifests).
    const activeExtensionIds = [
        ...new Set(
            artifactsRaw
                .flatMap((a) => a.stack)
                .filter((l) => l.layer === "extension" && l.presetId)
                .map((l) => l.presetId),
        ),
    ];
    // Also include any active extensions from the cached catalog that
    // didn't contribute an artifact (pure hook-only extensions).
    for (const ext of extensionItems ?? []) {
        if (ext?.active) {
            const id = ext.installedId || ext.id;
            if (id && !activeExtensionIds.includes(id)) activeExtensionIds.push(id);
        }
    }
    const { extensionHookInfo, hooksMap } = await collectHookMetadata(
        workspaceRoot,
        activeExtensionIds,
    );
    const artifacts = applyHookAttributions(artifactsRaw, extensionHookInfo, hooksMap);

    // 4. Summarize installed presets / extensions.
    const presetsOut = summarizeInstalled("preset", artifacts, presetItems);
    const extensionsOut = summarizeInstalled(
        "extension",
        artifacts,
        extensionItems,
        extensionHookInfo,
    );

    return {
        presets: presetsOut,
        extensions: extensionsOut,
        artifacts,
    };
}
