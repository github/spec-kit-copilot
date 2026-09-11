// speckit-wizard — CLI-backed composition source.
//
// Uses `specify artifact list --json` as the sole source of truth for all
// artifact kinds (commands, templates, scripts, and hooks).
//
// Shape mapping (CLI → wizard):
//   • CLI id `command:<name>`   → wizard id `commands/<name>`
//   • CLI id `template:<name>`  → wizard id `<name>` (bare)
//   • CLI id `script:<name>`    → wizard id `<name>` (bare)
//   • CLI id `hook:<name>`      → wizard id `hooks/<name>`
//   • CLI `layer: null` (built-in) → wizard `layer: "core"`
//   • CLI `active` (index-0 winner) → passed through verbatim
//   • Everything else — presetId, presetName, strategy, hidden, sourceId,
//     manifestPath, lookupId — passed through unchanged.
//
// Native CLI hook artifacts are consumed directly without manual extension
// manifest parsing.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildAugmentedPath } from "../env/resolve-path.mjs";

const execFileP = promisify(execFile);
const defaultAsyncRunner = async (cmd, args, opts) => {
    const augmentedPath = await buildAugmentedPath();
    const { stdout } = await execFileP(cmd, args, { ...opts, env: { ...process.env, PATH: augmentedPath } });
    return stdout;
};

const CLI_COMMAND_TIMEOUT_MS = 15_000;

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

// ---------------------------------------------------------------------------
// Shape mapping helpers
// ---------------------------------------------------------------------------

const VALID_STRATEGIES = new Set(["replace", "wrap", "prepend", "append", "additive"]);

function cliIdToWizardId(cliId, kind) {
    if (typeof cliId !== "string") return null;
    const sep = cliId.indexOf(":");
    const name = sep >= 0 ? cliId.slice(sep + 1) : cliId;
    if (!name) return null;
    if (kind === "command") return `commands/${name}`;
    if (kind === "hook") return `hooks/${name}`;
    return name;
}

function normalizeCliStackLayer(layer) {
    if (!layer || typeof layer !== "object") return null;
    const strategy = typeof layer.strategy === "string" && VALID_STRATEGIES.has(layer.strategy)
        ? layer.strategy
        : "replace";
    return {
        layer: layer.layer == null ? "core" : layer.layer,
        presetId: layer.presetId ?? null,
        presetName: layer.presetName ?? null,
        sourceId: layer.sourceId ?? null,
        strategy,
        active: !!layer.active,
        hidden: !!layer.hidden,
        manifestPath: layer.manifestPath ?? null,
        lookupId: layer.lookupId ?? null,
        sourcePath: layer.sourcePath ?? null,
        priority: typeof layer.priority === "number" ? layer.priority : null,
        optional: !!layer.optional,
    };
}

function shapeArtifact(cliArtifact) {
    if (!cliArtifact || typeof cliArtifact !== "object") return null;
    const kind = cliArtifact.kind;
    if (kind !== "command" && kind !== "template" && kind !== "script" && kind !== "hook") return null;
    const wizardId = cliIdToWizardId(cliArtifact.id, kind);
    if (!wizardId) return null;
    const stack = Array.isArray(cliArtifact.stack)
        ? cliArtifact.stack.map(normalizeCliStackLayer).filter(Boolean)
        : [];
    const shaped = {
        id: wizardId,
        kind,
        description: cliArtifact.description ?? "",
        stack,
    };
    if (kind === "hook") {
        const event = cliArtifact.event ?? cliArtifact.eventName ?? (
            typeof cliArtifact.id === "string" && cliArtifact.id.startsWith("hook:")
                ? cliArtifact.id.split(":")[1]
                : null
        );
        const targetCommand = cliArtifact.targetCommand ?? (
            typeof cliArtifact.id === "string" && cliArtifact.id.startsWith("hook:")
                ? cliArtifact.id.split(":").slice(2).join(":")
                : null
        );
        shaped.event = event;
        shaped.targetCommand = targetCommand;
        shaped.registered = cliArtifact.registered ?? true;
        const hookBindings = [];
        for (const layer of stack) {
            const extId = layer.sourceId ?? layer.presetId;
            hookBindings.push({
                phase: event,
                targetCommand: targetCommand ?? (typeof wizardId === "string" ? wizardId.replace(/^hooks\//, "") : null),
                optional: !!layer.optional,
                priority: layer.priority ?? null,
                extensionId: extId,
                manifestPath: layer.manifestPath ?? null,
            });
        }
        shaped.hookBindings = hookBindings;
        shaped.hookBinding = hookBindings[0] ?? null;
    }
    return shaped;
}

// ---------------------------------------------------------------------------
// Preset/extension summary derivation
// ---------------------------------------------------------------------------

function providerIdForLayer(layer) {
    if (layer.layer === "preset") return layer.presetId;
    if (layer.layer === "extension") return layer.sourceId;
    return null;
}

function accumulateProvidesCounts(artifacts) {
    const counts = new Map();
    for (const artifact of artifacts) {
        for (const layer of artifact.stack) {
            if (layer.layer !== "preset" && layer.layer !== "extension") continue;
            const providerId = providerIdForLayer(layer);
            if (!providerId) continue;
            const key = `${layer.layer}:${providerId}`;
            let entry = counts.get(key);
            if (!entry) {
                entry = {
                    layerKind: layer.layer,
                    providerId,
                    providerName: layer.presetName ?? providerId,
                    commands: 0,
                    templates: 0,
                    scripts: 0,
                    hooks: 0,
                };
                counts.set(key, entry);
            }
            if (artifact.kind === "command") entry.commands++;
            else if (artifact.kind === "template") entry.templates++;
            else if (artifact.kind === "script") entry.scripts++;
            else if (artifact.kind === "hook") entry.hooks++;
        }
    }
    return counts;
}

function summarizeInstalled(kind, artifacts, cachedItems) {
    const counts = accumulateProvidesCounts(artifacts);
    const cachedById = new Map(
        (cachedItems ?? [])
            .filter((it) => it && it.active)
            .map((it) => [it.installedId || it.id, it]),
    );
    const ids = new Set();
    for (const [, item] of cachedById) ids.add(item.installedId || item.id);
    for (const [key, entry] of counts) {
        if (entry.layerKind !== kind) continue;
        ids.add(entry.providerId);
    }
    const out = [];
    for (const id of ids) {
        const key = `${kind}:${id}`;
        const c = counts.get(key);
        const cached = cachedById.get(id);
        if (!c && !cached) continue;
        const item = {
            id,
            name: cached?.name ?? c?.providerName ?? id,
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
            if (cached?.category !== undefined || cached?.effect !== undefined) {
                if (cached.category) item.category = cached.category;
                if (cached.effect) item.effect = cached.effect;
            }
            item.provides.hooks = c?.hooks ?? 0;
        }
        out.push(item);
    }
    return out;
}

function applyNativeHookAttributions(artifacts) {
    const byId = new Map(artifacts.map((a) => [a.id, a]));
    for (const artifact of artifacts) {
        if (artifact.kind !== "hook") continue;
        const event = artifact.event;
        const targetCommand = artifact.targetCommand;
        if (!event) continue;
        const activeLayer = artifact.stack.find((l) => l.active) ?? artifact.stack[0];
        const providerId = activeLayer?.sourceId ?? activeLayer?.presetId;
        const providerName = activeLayer?.presetName ?? providerId;

        const match = event.match(/^(?:before|after)_(.+)$/);
        const phaseName = match ? match[1] : null;
        if (phaseName) {
            const parentCommandId = `commands/speckit.${phaseName}`;
            const parent = byId.get(parentCommandId);
            if (parent) {
                (parent.hooks ??= []).push({
                    phase: event,
                    extensionId: providerId,
                    extensionName: providerName,
                    targetCommand,
                    // Mirror the active layer's optionality — omitting this
                    // makes resolveHooksForCommand()'s de-duped inline entry
                    // (which wins over the standalone hook artifact's
                    // hookBindings[].optional) render as Required even when
                    // the hook is declared optional.
                    optional: !!activeLayer?.optional,
                    declared: true,
                    registered: artifact.registered ?? true,
                });
            }
        }
    }
    return artifacts;
}

// ---------------------------------------------------------------------------
// Public: build the wizard composition payload from the CLI
// ---------------------------------------------------------------------------

export async function buildCompositionFromCli({
    workspaceRoot,
    presetItems,
    extensionItems,
    runner = defaultAsyncRunner,
} = {}) {
    const list = await specifyArtifactList(workspaceRoot, { runner });

    const artifactsRaw = [];
    for (const row of list) {
        const shaped = shapeArtifact(row);
        if (shaped) artifactsRaw.push(shaped);
    }

    const artifacts = applyNativeHookAttributions(artifactsRaw);
    const presetsOut = summarizeInstalled("preset", artifacts, presetItems);
    const extensionsOut = summarizeInstalled("extension", artifacts, extensionItems);

    return {
        presets: presetsOut,
        extensions: extensionsOut,
        artifacts,
    };
}
