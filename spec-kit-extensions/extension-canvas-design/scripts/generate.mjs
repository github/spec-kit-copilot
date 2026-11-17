import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validControlContract, validControlValue } from "../generated-scaffold/external-control-contract.mjs";
import { validateRuntimeSetup } from "../generated-scaffold/setup.mjs";
import { validWorkflowItemName } from "../generated-scaffold/contracts/external-host-adapter.mjs";
import { isWindowsDeviceName } from "../generated-scaffold/files.mjs";
import { phaseContract } from "../generated-scaffold/contract.mjs";
import { badgePlacements, validBadgeCategory, validBadgeSelections,
    validPlacementTexts } from "../generated-scaffold/contracts/badge-selection.mjs";
import { validateDialogAdapterSource, validateButtonAdapterSource } from
    "../generated-scaffold/contracts/external-dialog-button.mjs";
import { REQUEST_LIMIT, validateGenerationRequestIntegrity } from "./contracts/generation-request.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const featureRoot = join(packageRoot, "generated-scaffold");
const featureFiles = ["server.mjs", "runtime.mjs", "setup.mjs", "contract.mjs", "external-control-contract.mjs", "files.mjs",
    "phase-response.mjs", "contracts/agent-actions.mjs", "contracts/workflow-state.mjs",
    "contracts/external-host-adapter.mjs", "contracts/packaged-contributions.mjs",
    "contracts/external-generated-controls.mjs", "contracts/external-dialog-button.mjs",
    "contracts/external-badge-evaluator.mjs", "contracts/external-value-provider.mjs",
    "contracts/badge-selection.mjs",
    "badge-runtime.mjs",
    "ui/app.js", "ui/markdown.mjs", "ui/page-assets.mjs", "ui/runtime.css", "ui/workflow-theme.css"];
const idPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;
const reserved = new Set(["speckit-canvas-designer", "speckit-wizard", "speckit-canvas-generator"]);
const RESERVED_GENERATED_PAGE_ID = "workflow";
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const fieldPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const essentialFields = new Set(["canvas.id", "canvas.displayName", "canvas.description",
    "canvas.workflowListName", "canvas.workflowItemName", "workflowSlug.userProvided", "setup.show"]);

export async function renameDirectoryWithoutReplacement(source, destination) {
    if (process.platform === "win32") {
        const staged = await lstat(source);
        for (let attempt = 0; ; attempt++) {
            try { await rename(source, destination); break; }
            catch (error) {
                if (error.code !== "EPERM" || attempt >= 5) throw error;
                // Windows can briefly deny a directory rename after generated files are read.
                await new Promise((done) => setTimeout(done, 100 * (attempt + 1)));
                const current = await lstat(source);
                if (!current.isDirectory() || current.isSymbolicLink()
                    || current.dev !== staged.dev || current.ino !== staged.ino) {
                    throw new Error("Canvas staging directory changed before publication");
                }
                try {
                    await lstat(destination);
                    throw new Error("Canvas destination changed before publication");
                } catch (lookupError) {
                    if (lookupError.code !== "ENOENT") throw lookupError;
                }
            }
        }
        return;
    }
    // POSIX rename replaces an existing empty directory; reserve the destination first.
    await mkdir(destination);
    const claim = await lstat(destination);
    try {
        const current = await lstat(destination);
        if (current.dev !== claim.dev || current.ino !== claim.ino
            || !current.isDirectory() || current.isSymbolicLink()) {
            throw new Error("Canvas destination changed before publication");
        }
        await rename(source, destination);
    } catch (error) {
        const current = await lstat(destination).catch((readError) => {
            if (readError.code === "ENOENT") return null;
            throw readError;
        });
        if (current?.dev === claim.dev && current.ino === claim.ino) {
            try { await rmdir(destination); }
            catch (cleanup) {
                throw new AggregateError([error, cleanup], "Canvas destination could not be released");
            }
        }
        throw error;
    }
}

function withoutSchema(document) {
    if (!document || typeof document !== "object" || Array.isArray(document)) return document;
    const { $schema, ...definition } = document;
    if ($schema !== undefined && typeof $schema !== "string") {
        throw new Error("Invalid frozen definition $schema reference");
    }
    return definition;
}

function validateFrozenValues(values, constraints) {
    if (!values || typeof values !== "object" || Array.isArray(values)
        || !constraints || typeof constraints !== "object" || Array.isArray(constraints)
        || Object.keys(constraints).length > 10000
        || Object.keys(values).length !== Object.keys(constraints).length
        || Object.keys(values).some((id) => !Object.hasOwn(constraints, id))) {
        throw new Error("Invalid frozen Designer fields");
    }
    for (const [id, rule] of Object.entries(constraints)) {
        if (!fieldPattern.test(id) || !rule || typeof rule !== "object"
            || Array.isArray(rule)) throw new Error(`Invalid frozen Designer field: ${id}`);
        const value = values[id];
        if (rule.type === "string") {
            if (Object.keys(rule).some((key) =>
                !["type", "maxLength", "minLength", "pattern", "required"].includes(key))
                || !Number.isInteger(rule.maxLength) || rule.maxLength < 1
                || rule.maxLength > 1000
                || (rule.minLength !== undefined && (!Number.isInteger(rule.minLength)
                    || rule.minLength < 0 || rule.minLength > rule.maxLength))
                || (rule.pattern !== undefined && (typeof rule.pattern !== "string"
                    || rule.pattern.length > 120))
                || (rule.required !== undefined && rule.required !== true)
                || (id === "canvas.id"
                    ? !["^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]*$",
                        "^[a-z0-9][a-z0-9-]*$"].includes(rule.pattern)
                    : false)
                || typeof value !== "string" || value.length > rule.maxLength
                || value.length < (rule.minLength ?? 0)
                || (rule.required && !value.trim())
                || (id === "canvas.id" && (!idPattern.test(value) || isWindowsDeviceName(value)))
                || (rule.pattern && !new RegExp(rule.pattern).test(value))) {
                throw new Error(`Invalid frozen Designer field: ${id}`);
            }
        } else if (rule.type === "boolean") {
            if (Object.keys(rule).sort().join() !== "type" || typeof value !== "boolean") {
                throw new Error(`Invalid frozen Designer field: ${id}`);
            }
        } else if (rule.type === "image") {
            if (Object.keys(rule).sort().join() !== "maxBytes,mimeTypes,type"
                || rule.maxBytes !== 32 * 1024
                || !isDeepStrictEqual(rule.mimeTypes,
                    ["image/png", "image/jpeg", "image/gif", "image/webp"])
                || typeof value !== "string"
                || value.length > 44 * 1024) {
                throw new Error(`Invalid frozen Designer image: ${id}`);
            }
        } else if (rule.type === "object") {
            const properties = rule.properties;
            if (Object.keys(rule).sort().join() !== "properties,type"
                || !properties || typeof properties !== "object" || Array.isArray(properties)
                || !Object.keys(properties).length || Object.keys(properties).length > 10
                || Object.entries(properties).some(([key, allowed]) =>
                    !/^[a-z][A-Za-z0-9]{0,39}$/.test(key)
                    || !Array.isArray(allowed) || !allowed.length || allowed.length > 20
                    || new Set(allowed).size !== allowed.length
                    || allowed.some((option) => typeof option !== "string"
                        || !option || option.length > 80))
                || !value || typeof value !== "object" || Array.isArray(value)
                || Object.keys(value).sort().join() !== Object.keys(properties).sort().join()
                || Object.entries(properties).some(([key, allowed]) =>
                    !allowed.includes(value[key]))) {
                throw new Error(`Invalid frozen Designer field: ${id}`);
            }
        } else throw new Error(`Invalid frozen Designer field: ${id}`);
    }
}

function within(root, path) {
    const part = relative(root, path);
    return part && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

export function frozenBadges(badges, workflow) {
    if (badges === undefined) return null;
    const name = /^[a-z][a-z0-9-]{0,79}$/;
    const sha = /^[a-f0-9]{64}$/;
    const { instances, settings, types, rules, adapters } = badges ?? {};
    if (!Array.isArray(instances) || !instances.length || instances.length > 100
        || !Array.isArray(types) || !types.length || types.length > 100
        || !Array.isArray(rules) || !rules.length || rules.length > 100
        || !Array.isArray(adapters) || !adapters.length || adapters.length > 100) {
        throw new Error("Invalid frozen badges inventory");
    }
    const validateAsset = (asset, kind) => {
        if (asset?.kind !== kind || asset.name === undefined || !name.test(asset.name)
            || typeof asset.sourceId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
            || !sha.test(asset.hash)
            || typeof asset.content !== "string"
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)) {
            throw new Error(`Invalid frozen ${kind} asset`);
        }
        const bytes = Buffer.from(asset.content, "base64");
        if (bytes.length > 32 * 1024
            || createHash("sha256").update(bytes).digest("hex") !== asset.hash) {
            throw new Error(`Modified or oversized frozen ${kind} asset`);
        }
        return bytes;
    };
    const definition = (item, kind, keys) => {
        if (!item || !Array.isArray(item.assets) || item.assets.length !== 1) {
            throw new Error(`Missing frozen ${kind} definition`);
        }
        const bytes = validateAsset(item.assets[0], kind);
        let parsed;
        try { parsed = withoutSchema(JSON.parse(bytes.toString("utf8"))); }
        catch { throw new Error(`Invalid frozen ${kind} JSON`); }
        if (!name.test(item.id) || item.name !== item.assets[0].name
            || !isDeepStrictEqual(parsed, Object.fromEntries(keys.map((key) => [key, item[key]])))) {
            throw new Error(`Frozen ${kind} differs from resolved registration`);
        }
        return { parsed, hash: item.assets[0].hash };
    };
    const typeMap = new Map(types.map((item) => [item.id, item]));
    const ruleMap = new Map(rules.map((item) => [item.id, item]));
    const adapterMap = new Map(adapters.map((item) => [item.name, item]));
    if ([typeMap, ruleMap, adapterMap].some((map, index) =>
        map.size !== [types, rules, adapters][index].length)) {
        throw new Error("Duplicate frozen badge definition or evaluator");
    }
    const bytes = validateAsset(settings, "designer.badges-settings-definition");
    let badgeSettings;
    try { badgeSettings = withoutSchema(JSON.parse(bytes.toString("utf8"))); }
    catch { throw new Error("Invalid frozen badges settings JSON"); }
    if (settings.name !== "badges-settings" || badgeSettings?.schemaVersion !== 1
        || !Array.isArray(badgeSettings.types) || !badgeSettings.types.length
        || badgeSettings.types.length > 30
        || new Set(badgeSettings.types.map((type) => type.id)).size !== badgeSettings.types.length) {
        throw new Error("Invalid frozen badges settings");
    }
    const typeKeys = ["id", "title", "description", "rule", "defaultText", "defaultColor", "enabled"];
    const resolvedTypes = types.map((type) => {
        const parsed = badgeSettings.types.find((item) => item.id === type.id);
        if (!parsed || type.name !== settings.name || type.sourceId !== settings.sourceId
            || type.schemaVersion !== 1
            || !isDeepStrictEqual(parsed, Object.fromEntries([
                ...typeKeys, ...(parsed.replacementGroup === undefined ? [] : ["replacementGroup"]),
            ].map((key) => [key, type[key]])))
            || !parsed.enabled || !name.test(parsed.rule)
            || (parsed.replacementGroup !== undefined
                && (!name.test(parsed.replacementGroup)
                    || !ruleMap.get(parsed.rule)?.placementPhaseInput))
            || !ruleMap.has(parsed.rule) || typeof parsed.title !== "string"
            || !parsed.title.trim() || typeof parsed.description !== "string"
            || typeof parsed.defaultText !== "string"
            || !/^(?:theme|red|green|amber|blue|purple|pink|orange|#[0-9a-fA-F]{6})$/.test(parsed.defaultColor)) {
            throw new Error(`Frozen badge type differs from badges settings: ${type.id}`);
        }
        return { schemaVersion: 1, ...parsed, hash: settings.hash };
    });
    const resolvedRules = rules.map((rule) => {
        const { parsed } = definition(rule, "generated.badge-rule-definition",
            ["schemaVersion", "id", "label", "description", "inputs", "textPlaceholders", "adapter",
                ...(rule.placementPhaseInput === undefined ? [] : ["placementPhaseInput"])]);
        if (parsed.schemaVersion !== 1 || !name.test(parsed.adapter) || !adapterMap.has(parsed.adapter)
            || !Array.isArray(parsed.inputs) || parsed.inputs.length > 10
            || new Set(parsed.inputs.map((input) => input.id)).size !== parsed.inputs.length
            || (parsed.placementPhaseInput !== undefined
                && !parsed.inputs.some((input) => input.id === parsed.placementPhaseInput
                    && input.type === "artifact"))
            || parsed.inputs.some((input) => !input || typeof input !== "object"
                || Object.keys(input).some((key) =>
                    !["id", "type", "scope", "before", "minItems", "label"].includes(key))
                || !name.test(input.id)
                || !["artifact", "artifact-set", "ordered-artifacts", "phase", "text", "badge-selection"].includes(input.type)
                || (input.label !== undefined
                    && (typeof input.label !== "string" || !input.label.trim() || input.label.length > 80))
                || (input.scope !== undefined
                    && !(input.type === "artifact" && ["directory", "metadata"].includes(input.scope)
                        || input.type === "ordered-artifacts" && input.scope === "metadata"))
                || input.type === "ordered-artifacts"
                    && (input.scope !== "metadata" || typeof input.before !== "string")
                || input.minItems !== undefined && (input.type !== "ordered-artifacts"
                    || !Number.isInteger(input.minItems) || input.minItems < 1 || input.minItems > 100)
                || input.before !== undefined && (input.type !== "ordered-artifacts"
                    || !parsed.inputs.some((target) => target.id === input.before
                        && target.type === "artifact" && target.scope !== "directory")))
            || parsed.inputs.filter((input) => input.type === "badge-selection").length > 1
            || !Array.isArray(parsed.textPlaceholders)
            || new Set(parsed.textPlaceholders).size !== parsed.textPlaceholders.length
            || parsed.textPlaceholders.some((placeholder) => !name.test(placeholder))) {
            throw new Error(`Invalid frozen badge rule: ${rule.id}`);
        }
        return { ...parsed, hash: adapterMap.get(parsed.adapter).hash };
    });
    const textPlaceholdersValid = (text, placeholders) => typeof text === "string"
        && text.trim() && text.length <= 120
        && !/[{}]/.test(text.replace(/\{[a-z][a-z0-9-]{0,39}\}/g, ""))
        && [...text.matchAll(/\{([a-z][a-z0-9-]{0,39})\}/g)]
            .every((match) => placeholders.includes(match[1]));
    for (const type of resolvedTypes) {
        const rule = resolvedRules.find((item) => item.id === type.rule);
        if (!textPlaceholdersValid(type.defaultText, rule.textPlaceholders)) {
            throw new Error(`Badge ${type.id} uses an undeclared text placeholder`);
        }
    }
    for (const adapter of adapters) {
        validateAsset(adapter, "generated.badge-rule-adapter");
        if (!resolvedRules.some((rule) => rule.adapter === adapter.name)) {
            throw new Error(`Unused frozen badge evaluator: ${adapter.name}`);
        }
    }
    const phaseOutputs = workflow.phaseArtifacts ?? {};
    const projectPhase = workflow.selectedPhases.find((phase) =>
        phase.replace(/^speckit\./, "") === "constitution");
    const declared = (source) => source && workflow.selectedPhases.includes(source.phase)
        && typeof source.output === "string"
        && phaseOutputs[source.phase]?.outputs?.includes(source.output);
    const validInputs = (instance, rule) => instance.inputs
        && typeof instance.inputs === "object" && !Array.isArray(instance.inputs)
        && Object.keys(instance.inputs).length === rule.inputs.length
        && rule.inputs.every((input) => {
            const value = instance.inputs[input.id];
            if (input.type === "artifact") return declared(value);
            if (input.type === "phase") return workflow.selectedPhases.includes(value);
            if (input.type === "text") return typeof value === "string" && !!value.trim()
                && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
            if (input.type === "badge-selection") return Array.isArray(instance.showIn)
                && validBadgeSelections(value, badgePlacements(instance));
            if (input.type === "ordered-artifacts") {
                const target = instance.inputs[input.before];
                const chain = [...(Array.isArray(value) ? value : []), target];
                return Array.isArray(value) && value.length <= 100
                    && value.length >= (input.minItems ?? 0) && declared(target)
                    && value.every((entry) => entry && typeof entry === "object"
                        && Object.keys(entry).sort().join() === "output,phase" && declared(entry))
                    && chain.every((entry, index) => index === 0
                        || workflow.selectedPhases.indexOf(chain[index - 1].phase)
                            < workflow.selectedPhases.indexOf(entry.phase))
                    && new Set(chain.map((entry) => entry.output.toLowerCase())).size === chain.length;
            }
            return Array.isArray(value) && value.length > 0 && value.length <= 100
                && value.every((item) => workflow.selectedPhases.includes(item?.phase)
                    && Array.isArray(item.outputs) && item.outputs.length
                    && item.outputs.length <= 100
                    && item.outputs.every((output) => declared({ phase: item.phase, output })));
        });
    const ids = new Set();
    const checked = [];
    const canonical = (value, ordered, key = "") => Array.isArray(value)
        ? ordered.has(key) ? value.map((item) => canonical(item, ordered))
            : value.map((item) => canonical(item, ordered)).sort((a, b) =>
                JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : value !== null && typeof value === "object"
            ? Object.fromEntries(Object.keys(value).sort().map((key) =>
                [key, canonical(value[key], ordered, key)]))
            : value;
    const canonicalInputs = (inputs, ordered) => canonical(Object.fromEntries(
        Object.entries(inputs).map(([key, value]) => [
            key, ordered.has(key) ? value.map(({ id: _id, ...entry }) => entry) : value,
        ])), ordered);
    const targets = (instance) => instance.targets?.length ? instance.targets
        : instance.showIn?.includes("phase-card") && instance.phase
            ? [{ phase: instance.phase, output: null }]
            : [{ phase: null, output: null }];
    // Badges collide when they show the same text in a placement they share; badges without
    // top-level text (Value match) are distinguished by their entries in inputs.
    const sharesText = (a, b) => {
        const shown = ["text", "phaseText", "summaryText"]
            .filter((key) => Object.hasOwn(a, key) || Object.hasOwn(b, key));
        return !shown.length || shown.some((key) => a[key] === b[key]);
    };
    for (const instance of instances) {
        const type = typeMap.get(instance?.type);
        const rule = ruleMap.get(type?.rule);
        if (!type || !rule || typeof instance.id !== "string"
            || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(instance.id)
            || ids.has(instance.id) || !validInputs(instance, rule)
            || (rule.placementPhaseInput
                && (instance.targets?.length
                    ? instance.targets.length !== 1 || instance.targets[0].output !== null
                        || instance.targets[0].phase !== instance.inputs[rule.placementPhaseInput]?.phase
                    : instance.showIn?.includes("phase-card")
                        && instance.phase !== instance.inputs[rule.placementPhaseInput]?.phase))
            || !validBadgeCategory(instance.category)
            || (rule.inputs.some((input) => input.type === "badge-selection")
                ? ["text", "phaseText", "summaryText"].some((key) => Object.hasOwn(instance, key))
                : !validPlacementTexts(instance, badgePlacements(instance),
                    rule.textPlaceholders.map((token) => typeof token === "string" ? token : token.id)))
            || typeof instance.color !== "string"
            || !/^(?:theme|red|green|amber|blue|purple|pink|orange|#[0-9a-fA-F]{6})$/.test(instance.color)
            || !Array.isArray(instance.showIn) || instance.showIn.length > 3
            || new Set(instance.showIn).size !== instance.showIn.length
            || instance.showIn.some((place) =>
                !["workflow-list", "workflow-summary", "phase-card"].includes(place))
            || (instance.targets === undefined
                ? (instance.showIn.includes("phase-card")
                    && !workflow.selectedPhases.includes(instance.phase))
                    || (!instance.showIn.includes("phase-card") && instance.phase != null)
                : instance.phase != null || instance.showIn.includes("phase-card")
                    || !Array.isArray(instance.targets) || instance.targets.length > 100
                    || new Set(instance.targets.map((target) =>
                        JSON.stringify([target?.phase, target?.output]))).size !== instance.targets.length
                    || instance.targets.some((target) => !target
                        || !workflow.selectedPhases.includes(target.phase)
                        || (target.output !== null
                            && (!rule.inputs.some((input) =>
                                ["artifact", "artifact-set"].includes(input.type))
                                || !declared(target)))))) {
            throw new Error(`Invalid configured badge: ${instance?.id ?? "unknown"}`);
        }
        if (projectPhase && (instance.targets?.some((target) => target.phase === projectPhase)
            || instance.showIn.includes("phase-card") && instance.phase === projectPhase)
            && rule.inputs.some(({ id, type: inputType }) => {
                const value = instance.inputs[id];
                return !["text", "badge-selection"].includes(inputType) && (inputType === "phase" ? value !== projectPhase
                    : Array.isArray(value) ? value.some((entry) => entry.phase !== projectPhase)
                        : value.phase !== projectPhase);
            })) {
            throw new Error(`Badge ${instance.id} has a project placement with workflow rule inputs`);
        }
        ids.add(instance.id);
        const destinations = new Set(targets(instance).map(({ phase, output }) =>
            JSON.stringify([phase, output])));
        const ordered = new Set(rule.inputs.filter(({ type }) => type === "badge-selection")
            .map(({ id }) => id));
        const duplicate = checked.find((other) => other.type === instance.type
            && sharesText(other, instance)
            && isDeepStrictEqual(canonicalInputs(other.inputs, ordered),
                canonicalInputs(instance.inputs, ordered))
            && targets(other).some(({ phase, output }) =>
                destinations.has(JSON.stringify([phase, output]))));
        if (duplicate) {
            throw new Error(`Duplicate frozen badge target: ${instance.id} overlaps ${duplicate.id}`);
        }
        checked.push(instance);
    }
    return { instances: checked, types: resolvedTypes, rules: resolvedRules,
        adapters: adapters.map(({ name: adapter, hash }) => ({ adapter, hash })) };
}

function frozenImage(item, values, constraints) {
    if (!item || Object.keys(item).sort().join() !== (item.page === undefined
        ? "content,hash,id,label,mime,slot" : "content,hash,id,label,mime,page,slot")
        || !fieldPattern.test(item.id)
        || typeof item.label !== "string" || !item.label.trim() || item.label.length > 120
        || (item.page === undefined ? !["header.brand", "workflow.intro"].includes(item.slot)
            : typeof item.page !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(item.page)
                || typeof item.slot !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(item.slot))
        || constraints[item.id]?.type !== "image" || constraints[item.id]?.maxBytes !== 32 * 1024
        || !isDeepStrictEqual(constraints[item.id]?.mimeTypes,
            ["image/png", "image/jpeg", "image/gif", "image/webp"])
        || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(item.mime)
        || typeof item.content !== "string" || item.content.length > 44 * 1024
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.content)
        || values[item.id] !== `data:${item.mime};base64,${item.content}`) {
        throw new Error("Invalid frozen image asset registration");
    }
    const bytes = Buffer.from(item.content, "base64");
    const signatures = {
        "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
        "image/jpeg": [255, 216, 255],
        "image/gif": [71, 73, 70, 56],
        "image/webp": [82, 73, 70, 70],
    };
    if (!bytes.length || bytes.length > 32 * 1024
        || bytes.toString("base64") !== item.content
        || !signatures[item.mime].every((part, index) => bytes[index] === part)
        || (item.mime === "image/png" && (bytes.length < 24
            || bytes.toString("ascii", 12, 16) !== "IHDR"))
        || (item.mime === "image/jpeg" && (bytes.length < 5
            || bytes.at(-2) !== 255 || bytes.at(-1) !== 217))
        || (item.mime === "image/gif" && (bytes.length < 14
            || !["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))))
        || (item.mime === "image/webp" && (bytes.length < 16
            || bytes.toString("ascii", 8, 12) !== "WEBP"
            || bytes.readUInt32LE(4) + 8 !== bytes.length))
        || createHash("sha256").update(bytes).digest("hex") !== item.hash) {
        throw new Error("Invalid frozen image bytes or hash");
    }
    return bytes;
}

const imageContract = { type: "image", maxBytes: 32768,
    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };

function frozenImageControl(item) {
    if (!item || Object.keys(item).sort().join() !== "assets,control"
        || item.control !== "stock.image" || !Array.isArray(item.assets) || item.assets.length !== 2
        || item.assets[0]?.kind !== "shared.control-definition"
        || item.assets[1]?.kind !== "generated.control-adapter") {
        throw new Error("Invalid frozen stock.image control registration");
    }
    for (const asset of item.assets) {
        if (!asset || Object.keys(asset).sort().join() !== "content,hash,kind,name,sourceId"
            || !/^[a-z][a-z0-9-]{0,79}$/.test(asset.name)
            || isWindowsDeviceName(asset.name)
            || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
            || typeof asset.content !== "string" || asset.content.length > 44 * 1024
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)
            || Buffer.from(asset.content, "base64").length > 32 * 1024
            || Buffer.from(asset.content, "base64").toString("base64") !== asset.content
            || createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex") !== asset.hash) {
            throw new Error("Invalid frozen stock.image control asset or hash");
        }
    }
    let definition;
    try { definition = withoutSchema(JSON.parse(Buffer.from(item.assets[0].content, "base64").toString("utf8"))); }
    catch { throw new Error("Invalid stock.image control definition"); }
    if (!definition || Object.keys(definition).sort().join() !== "adapters,id,schemaVersion,value"
        || definition.schemaVersion !== 1 || definition.id !== item.control
        || Object.keys(definition.adapters ?? {}).sort().join() !== "designer,generated"
        || !/^[a-z][a-z0-9-]{0,79}$/.test(definition.adapters.designer)
        || definition.adapters.generated !== item.assets[1].name
        || item.assets[0].name === item.assets[1].name
        || !isDeepStrictEqual(definition.value, imageContract)) {
        throw new Error("Incompatible frozen stock.image value contract or adapters");
    }
    const module = Buffer.from(item.assets[1].content, "base64").toString("utf8");
    if (/\bimport\b|\bexport\s+(?:\*|\{[^}]*\})\s+from\b/.test(module)) {
        throw new Error("Frozen stock.image adapter must be self-contained");
    }
    return { adapter: item.assets[1].name, definition: item.assets[0].name,
        hash: item.assets[1].hash,
        definitionHash: item.assets[0].hash };
}

function frozenTextControl(item) {
    if (!item || Object.keys(item).sort().join() !== "assets,control"
        || item.control !== "stock.text" || !Array.isArray(item.assets) || item.assets.length !== 2
        || item.assets[0]?.kind !== "shared.control-definition"
        || item.assets[1]?.kind !== "generated.control-adapter") {
        throw new Error("Invalid frozen stock.text control registration");
    }
    for (const asset of item.assets) {
        if (!asset || Object.keys(asset).sort().join() !== "content,hash,kind,name,sourceId"
            || !/^[a-z][a-z0-9-]{0,79}$/.test(asset.name)
            || isWindowsDeviceName(asset.name)
            || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
            || typeof asset.content !== "string" || asset.content.length > 44 * 1024
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)
            || Buffer.from(asset.content, "base64").length > 32 * 1024
            || Buffer.from(asset.content, "base64").toString("base64") !== asset.content
            || createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex") !== asset.hash) {
            throw new Error("Invalid frozen stock.text control asset or hash");
        }
    }
    let definition;
    try { definition = withoutSchema(JSON.parse(Buffer.from(item.assets[0].content, "base64").toString("utf8"))); }
    catch { throw new Error("Invalid stock.text control definition"); }
    if (!definition || Object.keys(definition).sort().join() !== "adapters,id,schemaVersion,value"
        || definition.schemaVersion !== 1 || definition.id !== "stock.text"
        || Object.keys(definition.adapters ?? {}).sort().join() !== "designer,generated"
        || !/^[a-z][a-z0-9-]{0,79}$/.test(definition.adapters.designer)
        || definition.adapters.generated !== item.assets[1].name
        || item.assets[0].name === item.assets[1].name
        || !isDeepStrictEqual(definition.value, { type: "string" })) {
        throw new Error("Incompatible frozen stock.text value contract or adapters");
    }
    const module = Buffer.from(item.assets[1].content, "base64").toString("utf8");
    if (/\bimport\b|\bexport\s+(?:\*|\{[^}]*\})\s+from\b/.test(module)) {
        throw new Error("Frozen stock.text adapter must be self-contained");
    }
    return { adapter: item.assets[1].name, definition: item.assets[0].name,
        hash: item.assets[1].hash, definitionHash: item.assets[0].hash };
}

const imageFile = (item) => `${item.page
    ? `asset-${createHash("sha256").update(item.id).digest("hex").slice(0,24)}`
    : item.slot === "header.brand" ? "logo" : "main-page-logo"}.${{
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
    "image/webp": "webp",
}[item.mime]}`;

function frozenWorkflowPage(page, selectedPhases) {
    if (!Array.isArray(selectedPhases)
        || !page || Object.keys(page).sort().join() !== "assets,id,managedRun,order,slots,title"
        || page.id !== "workflow" || page.order !== 0
        || typeof page.managedRun !== "boolean"
        || typeof page.title !== "string" || !page.title.trim() || page.title.length > 120
        || !Array.isArray(page.slots) || !page.slots.some((slot) => slot?.id === "workflow.phases")
        || page.slots.length > 30
        || new Set(page.slots.map((slot) => slot?.id)).size !== page.slots.length
        || page.slots.some((slot) => !slot || Object.keys(slot).join() !== "id"
            || typeof slot.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(slot.id))
        || !Array.isArray(page.assets) || ![3, 4].includes(page.assets.length)
        || page.assets[0]?.name !== "generated-workflow"
        || page.assets[0]?.kind !== "generated.workflow-page-definition"
        || page.assets[1]?.name !== "generated-phase-control"
        || page.assets[1]?.kind !== "generated.phase-control-definition"
        || typeof page.assets[2]?.name !== "string"
        || !/^[a-z][a-z0-9-]{0,79}$/.test(page.assets[2].name)
        || isWindowsDeviceName(page.assets[2].name)
        || page.assets[2]?.kind !== "generated.phase-control-adapter"
        || (page.assets.length === 4 && (page.assets[3]?.kind !== "generated.workflow-page-adapter"
            || typeof page.assets[3]?.name !== "string"
            || !/^[a-z][a-z0-9-]{0,79}$/.test(page.assets[3].name)
            || isWindowsDeviceName(page.assets[3].name)))
        || page.assets.some((asset) => !asset || typeof asset !== "object"
            || Object.keys(asset).sort().join() !== "content,hash,kind,name,sourceId"
            || typeof asset.sourceId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
            || typeof asset.content !== "string"
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)
            || Buffer.from(asset.content, "base64").length > 32 * 1024
            || createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex") !== asset.hash)) {
        throw new Error("Invalid frozen Workflow page assets");
    }
    let definition;
    try { definition = withoutSchema(JSON.parse(Buffer.from(page.assets[0].content, "base64").toString("utf8"))); }
    catch { throw new Error("Invalid frozen Workflow page definition"); }
    const destinations = ["workflow.list", "workflow.summary", "phase.card", "phase.output"];
    if (!definition || !["id,order,schemaVersion,slots,title",
        "adapter,badgeDestinations,id,order,schemaVersion,slots,title"].includes(
        Object.keys(definition).sort().join())
        || definition.schemaVersion !== (page.assets.length === 4 ? 2 : 1)
        || (page.assets.length === 4 && (definition.adapter !== page.assets[3].name
            || !Array.isArray(definition.badgeDestinations)
            || definition.badgeDestinations.length > 4
            || new Set(definition.badgeDestinations).size !== definition.badgeDestinations.length
            || definition.badgeDestinations.some((id) => !destinations.includes(id))
            || definition.badgeDestinations.includes("workflow.list")
                && !page.slots.some((slot) => slot.id === "workflow.list")
            || definition.badgeDestinations.includes("workflow.summary")
                && !page.slots.some((slot) => slot.id === "workflow.summary")))
        || definition.id !== page.id
        || definition.title !== page.title || definition.order !== page.order
        || JSON.stringify(definition.slots) !== JSON.stringify(page.slots)) {
        throw new Error("Frozen Workflow page definition differs from registration");
    }
    let control;
    try { control = withoutSchema(JSON.parse(Buffer.from(page.assets[1].content, "base64").toString("utf8"))); }
    catch { throw new Error("Invalid frozen phase control definition"); }
    if (!control || Object.keys(control).some((key) =>
        !["adapter", "id", "managedRun", "placement", "schemaVersion", "slots", "viewLabels"].includes(key))
        || (control.managedRun !== undefined && typeof control.managedRun !== "boolean")
        || control.schemaVersion !== 1 || control.id !== "workflow-phases"
        || control.adapter !== page.assets[2].name
        || !control.placement || Object.keys(control.placement).sort().join() !== "page,slot"
        || control.placement.page !== "workflow" || control.placement.slot !== "workflow.phases"
        || (control.viewLabels !== undefined && (
            !control.viewLabels || typeof control.viewLabels !== "object" || Array.isArray(control.viewLabels)
            || Object.keys(control.viewLabels).length > 40
            || Object.entries(control.viewLabels).some(([id, label]) =>
                !selectedPhases.includes(id) || id.replace(/^speckit\./, "") === "constitution"
                || typeof label !== "string" || !label.trim() || label.length > 80
                || /[\x00-\x1f\x7f]/.test(label))))
        || (control.slots !== undefined
            && (!Array.isArray(control.slots) || control.slots.length !== 2
                || new Set(control.slots.map((slot) => slot?.id)).size !== 2
                || control.slots.some((slot) => !slot || Object.keys(slot).join() !== "id"
                    || !["phase.card", "phase.output"].includes(slot.id))))) {
        throw new Error("Invalid frozen phase control definition");
    }
    const module = Buffer.from(page.assets[2].content, "base64").toString("utf8");
    const check = spawnSync("node", ["--check", "--input-type=module"],
        { input: module, encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024 });
    if (check.error || check.status !== 0) {
        throw new Error(`Invalid frozen phase control adapter: ${check.stderr || check.error || "module validation failed"}`);
    }
    if (page.managedRun !== (control.managedRun === true)) {
        throw new Error("Frozen phase control capabilities differ from its definition");
    }
    if (page.assets[3]) {
        if (page.assets[3].name === control.adapter) {
            throw new Error("Workflow page adapter collides with phase control adapter");
        }
        const pageModule = Buffer.from(page.assets[3].content, "base64").toString("utf8");
        const checkPage = spawnSync("node", ["--check", "--input-type=module"],
            { input: pageModule, encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024 });
        if (checkPage.error || checkPage.status !== 0
            || /\bimport\b|\bexport\s+(?:\*|\{[^}]*\})\s+from\b/.test(pageModule)) {
            throw new Error(`Invalid frozen Workflow page adapter: ${checkPage.stderr || checkPage.error || "module must be self-contained"}`);
        }
    }
    return { title: page.title, order: page.order, slots: page.slots, phaseSlots: control.slots ?? [],
        phaseControl: page.assets[1].name,
        adapter: control.adapter, placement: control.placement,
        viewLabels: control.viewLabels ?? {}, definitionHash: page.assets[0].hash,
        controlHash: page.assets[1].hash, hash: page.assets[2].hash,
        managedRun: page.managedRun,
        ...(page.assets[3] ? { pageAdapter: page.assets[3].name,
            pageAdapterHash: page.assets[3].hash,
            badgeDestinations: definition.badgeDestinations } : {}) };
}

function frozenPlacement(item, kind) {
    if (!item || !Array.isArray(item.assets) || item.assets.length !== 1
        || !item.assets[0] || item.assets[0].kind !== kind
        || item.assets[0].name !== item.id
        || typeof item.assets[0].sourceId !== "string"
        || !/^[A-Za-z0-9_.:-]{1,160}$/.test(item.assets[0].sourceId)
        || typeof item.assets[0].content !== "string"
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.assets[0].content)
        || Buffer.from(item.assets[0].content, "base64").length > 32 * 1024
        || createHash("sha256").update(Buffer.from(item.assets[0].content, "base64")).digest("hex")
            !== item.assets[0].hash) throw new Error(`Invalid frozen ${kind} asset`);
    let definition;
    try { definition = withoutSchema(JSON.parse(Buffer.from(item.assets[0].content, "base64").toString("utf8"))); }
    catch { throw new Error(`Invalid frozen ${kind} definition`); }
    const { assets, label, control, ...registration } = item;
    if (!isDeepStrictEqual(definition, { schemaVersion: 1, ...registration,
        ...(definition.control === undefined ? {} : { control }) })) {
        throw new Error(`Frozen ${kind} differs from registration`);
    }
    return { ...registration, ...(control === undefined ? {} : { control }), hash: assets[0].hash };
}

function frozenNamedAsset(item, kinds, name, assetName = name) {
    if (!item || !Array.isArray(item.assets) || item.assets.length !== kinds.length
        || item.assets.some((asset, index) => !asset
            || Object.keys(asset).sort().join() !== "content,hash,kind,name,sourceId"
            || asset.kind !== kinds[index]
            || (index === 0 && asset.name !== assetName)
            || !/^[a-z][a-z0-9-]{0,79}$/.test(asset.name)
            || typeof asset.sourceId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
            || typeof asset.content !== "string"
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)
            || Buffer.from(asset.content, "base64").length > 32 * 1024
            || createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex") !== asset.hash)) {
        throw new Error(`Invalid frozen ${name} assets`);
    }
    let definition;
    try { definition = withoutSchema(JSON.parse(Buffer.from(item.assets[0].content, "base64").toString("utf8"))); }
    catch { throw new Error(`Invalid frozen ${name} definition`); }
    const { assets, name: registrationName, schemaVersion, ...registration } = item;
    if (schemaVersion !== 1) throw new Error(`Invalid frozen schema version: ${name}`);
    if (registrationName !== undefined && registrationName !== assetName) {
        throw new Error(`Invalid frozen template name: ${registrationName}`);
    }
    if (!isDeepStrictEqual(definition, { schemaVersion: 1, ...registration })) {
        throw new Error(`Frozen ${name} definition differs from registration`);
    }
    return { ...registration, hash: assets[0].hash, ...(assets[1]
        ? { adapterHash: assets[1].hash } : {}) };
}

function frozenDialogs(request, workflowLayout, phases) {
    const identifier = /^[a-z][a-z0-9-]{0,79}$/;
    const labels = (text, limit = 500) => typeof text === "string"
        && !!text.trim() && text.length <= limit;
    const { dialogDefinitions = [], phaseDialogBindings = [], buttonPlacements = [],
        buttonControls = [] } = request;
    if (![dialogDefinitions, phaseDialogBindings, buttonPlacements, buttonControls].every(Array.isArray)
        || dialogDefinitions.length > 30 || phaseDialogBindings.length > 30
        || buttonPlacements.length > 30 || buttonControls.length > 2
        || (!!buttonControls.length !== !!buttonPlacements.length)) {
        throw new Error("Invalid frozen dialog and button registrations");
    }
    const unique = (items, key) => new Set(items.map(key)).size === items.length;
    const dialogs = dialogDefinitions.map((item) => {
        const doc = frozenNamedAsset(item, ["generated.dialog-definition", "generated.dialog-adapter"], item.id);
        if (!identifier.test(doc.id) || !identifier.test(doc.adapter)
            || doc.adapter !== item.assets[1].name || !labels(doc.title)
            || !Array.isArray(doc.blocks) || !doc.blocks.length || doc.blocks.length > 20
            || !doc.buttons || Object.keys(doc.buttons).sort().join() !== "cancel,confirm"
            || !labels(doc.buttons.cancel) || !labels(doc.buttons.confirm)
            || doc.blocks.some((block) => !block || typeof block !== "object"
                || !(block.type === "slot" && Object.keys(block).sort().join() === "name,type"
                    && ["pending-packages", "phase"].includes(block.name)
                    || ["heading", "paragraph", "warning"].includes(block.type)
                        && Object.keys(block).sort().join() === "text,type" && labels(block.text)
                    || block.type === "list" && Object.keys(block).sort().join() === "items,type"
                        && Array.isArray(block.items) && block.items.length > 0 && block.items.length <= 20
                        && block.items.every((text) => labels(text))
                    || block.type === "link" && Object.keys(block).sort().join() === "href,text,type"
                        && labels(block.text) && typeof block.href === "string"
                        && block.href.length <= 2048 && /^https:\/\/[^\s]+$/.test(block.href)))) {
            throw new Error(`Invalid frozen dialog ${doc.id}`);
        }
        const slots = doc.blocks.filter((block) => block.type === "slot").map((block) => block.name);
        if (!unique(slots, (slot) => slot) || doc.id === "generated-setup-dialog"
            && !slots.includes("pending-packages")) throw new Error(`Invalid dialog slots: ${doc.id}`);
        const code = Buffer.from(item.assets[1].content, "base64").toString("utf8");
        const syntax = spawnSync("node", ["--check", "--input-type=module"],
            { input: code, encoding: "utf8", timeout: 5000 });
        validateDialogAdapterSource(code, syntax, doc.adapter);
        return { id: doc.id, adapter: doc.adapter, hash: doc.hash, adapterHash: doc.adapterHash,
            sourceId: item.assets[0].sourceId };
    });
    if (!unique(dialogs, (item) => item.id) || dialogs.some((item) => dialogs.some((other) =>
        other !== item && other.adapter === item.adapter && other.adapterHash !== item.adapterHash))) {
        throw new Error("Conflicting frozen dialogs");
    }
    const bindings = phaseDialogBindings.map((item) => {
        const doc = frozenNamedAsset(item, ["generated.phase-dialog-binding"], item.id);
        const dialog = dialogDefinitions.find((entry) => entry.id === doc.dialog);
        if (Object.keys(doc).sort().join() !== "dialog,hash,id,phase"
            || !/^speckit\.[a-z][a-z0-9.-]{0,79}$/.test(doc.phase)
            || doc.phase === "speckit.constitution"
            || !phases.some((phase) => `speckit.${phase.replace(/^speckit\./, "")}` === doc.phase)
            || !dialog || dialog.blocks.some((block) =>
                block.type === "slot" && block.name !== "phase")) {
            throw new Error(`Invalid phase dialog binding ${doc.id}`);
        }
        return doc;
    });
    if (!unique(bindings, (item) => item.id) || !unique(bindings, (item) => item.phase)) {
        throw new Error("Conflicting phase dialog bindings");
    }
    const buttons = buttonPlacements.map((item) => {
        const doc = frozenNamedAsset(item, ["generated.button-placement"], item.id);
        const dialog = dialogDefinitions.find((entry) => entry.id === doc.dialog);
        const slots = dialog?.blocks.filter((block) => block.type === "slot").map((block) => block.name);
        if (Object.keys(doc).sort().join() !== "action,control,dialog,hash,id,label,order,page,presentation,slot"
            || !identifier.test(doc.id) || !["setup", "workflow"].includes(doc.page)
            || doc.slot !== `${doc.page}.actions`
            || doc.control !== (doc.page === "setup" ? "project.setup-button" : "dialog.trigger")
            || !Number.isInteger(doc.order) || doc.order < -100000 || doc.order > 100000
            || !labels(doc.label, 120) || !["primary", "secondary"].includes(doc.presentation)
            || !doc.action || Object.keys(doc.action).join() !== "type"
            || doc.action.type !== (doc.id === "generated-setup-button" ? "project.setup" : "dialog.result")
            || (doc.id === "generated-setup-button") !== (doc.page === "setup")
            || doc.page === "workflow" && !workflowLayout.slots.some((slot) => slot.id === doc.slot)
            || !dialog || doc.page === "setup" && (slots.length !== 1 || slots[0] !== "pending-packages")
            || doc.page === "workflow" && slots.length !== 0) {
            throw new Error(`Invalid frozen button placement ${doc.id}`);
        }
        return doc;
    });
    if (!unique(buttons, (item) => item.id)
        || !unique(buttons, (item) => `${item.page}:${item.slot}:${item.order}`)
        || buttons.length && !buttons.some((item) => item.id === "generated-setup-button")
        || request.values?.["setup.show"] && !buttons.some((item) => item.id === "generated-setup-button")) {
        throw new Error("Missing or conflicting setup button");
    }
    const controls = buttonControls.map((item) => {
        const control = frozenNamedAsset(item, ["generated.button-control-definition",
            "generated.button-adapter"], item.id, item.name);
        if (!["project.setup-button", "dialog.trigger"].includes(control.id)
            || (control.id === "project.setup-button" && item.name !== "generated-setup-button-control")
            || control.adapter !== item.assets[1].name || !identifier.test(control.adapter)
            || Object.keys(control).sort().join() !== "adapter,adapterHash,hash,id") {
            throw new Error("Invalid frozen button control");
        }
        const code = Buffer.from(item.assets[1].content, "base64").toString("utf8");
        const syntax = spawnSync("node", ["--check", "--input-type=module"],
            { input: code, encoding: "utf8", timeout: 5000 });
        validateButtonAdapterSource(code, syntax, control.id);
        return { ...control, name: item.name };
    });
    if (!unique(controls, (item) => item.id) || !unique(controls, (item) => item.adapter)
        || buttons.some((button) => !controls.some((control) => control.id === button.control))
        || buttons.length && !controls.some((control) => control.id === "project.setup-button")
        || controls.some((control) => !buttons.some((button) => button.control === control.id))) {
        throw new Error("Missing or conflicting button controls");
    }
    return { dialogs, bindings, buttons, controls };
}

function configuration(request) {
    const { canvas, workflow, values, fieldConstraints, installed, generatedFields,
        generatedPages, generatedControls, generatedAssets, generatedImageControl,
        generatedTextControl, generatedTextPlacements, controlAssets, valueSources, workflowPage,
        fieldPlacements, designerFields, badges } = request;
    validateFrozenValues(values, fieldConstraints);
    const appearance = {};
    for (const [mode, suffix] of [["light", "Light"], ["dark", "Dark"]]) {
        const colors = {};
        for (const key of ["accent", "background", "surface", "secondary", "text"]) {
            const id = `canvas.${key}${suffix}`;
            if (!Object.hasOwn(values, id)) continue;
            if (fieldConstraints[id]?.type !== "string"
                || typeof values[id] !== "string"
                || !/^(?:#?[0-9a-fA-F]{6})?$/.test(values[id])) {
                throw new Error(`Invalid frozen appearance color: ${id}`);
            }
            if (values[id]) colors[key] = `#${values[id].replace(/^#/, "")}`;
        }
        if (Object.keys(colors).length) appearance[mode] = colors;
    }
    if (!validateRuntimeSetup(request.runtimeSetup)) throw new Error("Invalid frozen runtime setup recipe");
    const workflowLayout = frozenWorkflowPage(workflowPage, workflow?.selectedPhases ?? []);
    const dialogContracts = frozenDialogs(request, workflowLayout, workflow?.selectedPhases ?? []);
    if (!canvas || !idPattern.test(canvas.id) || reserved.has(canvas.id)
        || isWindowsDeviceName(canvas.id)
        || !["displayName", "description", "workflowListName"]
        .every((key) => typeof canvas[key] === "string" && canvas[key].trim())
        || canvas.id !== values?.["canvas.id"] || canvas.displayName !== values?.["canvas.displayName"]
        || fieldConstraints["canvas.id"]?.type !== "string"
        || fieldConstraints["canvas.displayName"]?.type !== "string"
        || !values["canvas.displayName"].trim()
        || (Object.hasOwn(values, "canvas.description")
            && fieldConstraints["canvas.description"]?.type !== "string")
        || (Object.hasOwn(values, "canvas.workflowListName")
            && fieldConstraints["canvas.workflowListName"]?.type !== "string")
        || (Object.hasOwn(values, "canvas.workflowItemName")
            && (fieldConstraints["canvas.workflowItemName"]?.type !== "string"
                || !Object.hasOwn(canvas, "workflowItemName")))
        || !validWorkflowItemName(canvas.workflowItemName)
        || (Object.hasOwn(values, "workflowSlug.userProvided")
            && fieldConstraints["workflowSlug.userProvided"]?.type !== "boolean")
        || (Object.hasOwn(values, "setup.show")
            && fieldConstraints["setup.show"]?.type !== "boolean")
        || canvas.description !== (values["canvas.description"] || "Spec Kit workflow canvas.")
        || canvas.workflowListName !== (values["canvas.workflowListName"] || "Workflows")
        || (canvas.workflowItemName !== undefined
            && canvas.workflowItemName !== (values["canvas.workflowItemName"] || "Workflow"))
        || (values["workflowSlug.userProvided"] !== undefined
            && typeof values["workflowSlug.userProvided"] !== "boolean")
        || (values["setup.show"] !== undefined && typeof values["setup.show"] !== "boolean")
        || !workflow || !Array.isArray(workflow.selectedPhases) || !workflow.selectedPhases.length
        || workflow.selectedPhases.length > 30 || new Set(workflow.selectedPhases).size !== workflow.selectedPhases.length
        || workflow.selectedPhases.some((phase) => typeof phase !== "string"
            || !/^(?:speckit\.)?[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(phase))
        || (workflow.phaseDescriptions !== undefined
            && (!workflow.phaseDescriptions || typeof workflow.phaseDescriptions !== "object"
                || Array.isArray(workflow.phaseDescriptions)
                || Object.entries(workflow.phaseDescriptions).some(([phase, description]) =>
                    !workflow.selectedPhases.includes(phase)
                    || typeof description !== "string" || !description.trim()
                    || description.length > 240)))
        || (workflow.phaseArtifacts !== undefined
            && (!workflow.phaseArtifacts || typeof workflow.phaseArtifacts !== "object"
                || Array.isArray(workflow.phaseArtifacts)
                || Object.keys(workflow.phaseArtifacts).length !== workflow.selectedPhases.length))
        || !installed || ["presets", "extensions", "bundles"].some((kind) =>
            !Array.isArray(installed[kind]) || installed[kind].some((item) =>
                typeof item.id !== "string" || typeof item.version !== "string"))) {
        throw new Error("Invalid frozen canvas identity, workflow or runtime inventory");
    }
    const badgeConfig = frozenBadges(badges, workflow);
    const destinations = workflowLayout.badgeDestinations
        ?? ["workflow.list", "workflow.summary", "phase.card", "phase.output"];
    const badgeLocations = { "workflow-list": "workflow.list",
        "workflow-summary": "workflow.summary", "phase-card": "phase.card",
        "phase-output": "phase.output" };
    if (badgeConfig?.instances.some((badge) => badge.showIn.some((placement) =>
        !destinations.includes(badgeLocations[placement]))
        || badge.targets?.some((target) => !destinations.includes(
            target.output === null ? "phase.card" : "phase.output"))
        || badge.showIn.includes("workflow-list")
            && !workflowLayout.slots.some((slot) => slot.id === "workflow.list")
        || badge.showIn.includes("workflow-summary")
            && !workflowLayout.slots.some((slot) => slot.id === "workflow.summary"))) {
        throw new Error("Frozen badge placement is unsupported by the Workflow page adapter");
    }
    if (generatedAssets !== undefined && (!Array.isArray(generatedAssets)
        || generatedAssets.length > 10
        || new Set(generatedAssets.map((item) => item?.id)).size !== generatedAssets.length
        || new Set(generatedAssets.map((item) =>
            `${item?.page ?? "workflow"}:${item?.slot}`)).size !== generatedAssets.length)) {
        throw new Error("Invalid frozen image assets");
    }
    for (const [id, rule] of Object.entries(fieldConstraints)) {
        if (rule.type !== "image") continue;
        if (Object.keys(rule).sort().join() !== "maxBytes,mimeTypes,type" || rule.maxBytes !== 32 * 1024
            || !isDeepStrictEqual(rule.mimeTypes, imageContract.mimeTypes)
            || typeof values[id] !== "string"
            || values[id] !== "" && !generatedAssets?.some((item) => item.id === id)) {
            throw new Error(`Invalid frozen image field: ${id}`);
        }
    }
    for (const item of generatedAssets ?? []) frozenImage(item, values, fieldConstraints);
    const imageControl = generatedImageControl && frozenImageControl(generatedImageControl);
    if (!!imageControl !== Object.values(fieldConstraints).some((rule) => rule.type === "image")) {
        throw new Error("Image fields require a frozen stock.image control");
    }
    if (imageControl && controlAssets?.some((entry) =>
        entry?.assets?.some((asset) =>
            [imageControl.adapter, imageControl.definition].includes(asset?.name)))) {
        throw new Error("Stock image assets conflict with another generated control");
    }
    const textControl = generatedTextControl && frozenTextControl(generatedTextControl);
    if (!!textControl !== !!generatedTextPlacements?.length
        || generatedTextPlacements !== undefined && (!Array.isArray(generatedTextPlacements)
            || generatedTextPlacements.length > 100
            || new Set(generatedTextPlacements.map((item) => item?.id)).size
                !== generatedTextPlacements.length
            || generatedTextPlacements.filter((item) => item?.presentation === "text")
                .length !== new Set(generatedTextPlacements.filter((item) =>
                    item?.presentation === "text").map((item) => item.slot)).size
            || generatedTextPlacements.some((item) => !item
                || Object.keys(item).sort().join() !== "id,label,presentation,slot"
                || !fieldPattern.test(item.id)
                || typeof item.label !== "string" || !item.label.trim() || item.label.length > 120
                || fieldConstraints[item.id]?.type !== "string"
                || (item.presentation === "text"
                    ? !((item.id === "canvas.description" && item.slot === "workflow.description")
                        || (item.id === "canvas.workflowListName" && item.slot === "workflow.heading"))
                    : item.presentation !== "stock.readonly" || item.slot !== "details.content"
                        || !generatedFields?.some((field) => field.id === item.id
                            && field.label === item.label))))) {
        throw new Error("Invalid frozen stock.text placements");
    }
    if (textControl && (controlAssets?.some((entry) =>
        entry?.assets?.some((asset) =>
            [textControl.adapter, textControl.definition].includes(asset?.name)))
        || imageControl && [imageControl.adapter, imageControl.definition]
            .some((name) => [textControl.adapter, textControl.definition].includes(name)))) {
        throw new Error("Stock text assets conflict with another generated control");
    }
    if (generatedFields !== undefined
        && (!Array.isArray(generatedFields) || generatedFields.length > 100
            || new Set(generatedFields.map((field) => field?.id)).size !== generatedFields.length
            || generatedFields.some((field) => !field || typeof field !== "object"
                || Array.isArray(field)
                || Object.keys(field).some((key) => !["id", "label", "maxLength", "section"].includes(key))
                || typeof field.id !== "string"
                || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(field.id)
                || typeof field.label !== "string" || !field.label || field.label.length > 120
                || !Number.isInteger(field.maxLength) || field.maxLength < 1
                || field.maxLength > 1000
                || fieldConstraints[field.id]?.type !== "string"
                || fieldConstraints[field.id].maxLength !== field.maxLength
                || typeof values[field.id] !== "string"
                || values[field.id].length > field.maxLength
                || (field.section !== undefined
                    && (!field.section || typeof field.section !== "object"
                        || Array.isArray(field.section)
                        || Object.keys(field.section).sort().join() !== "id,title"
                        || typeof field.section.id !== "string"
                        || !/^[a-z][a-z0-9.-]{0,79}$/.test(field.section.id)
                        || typeof field.section.title !== "string"
                        || !field.section.title.trim() || field.section.title.length > 120))))) {
        throw new Error("Invalid frozen generated fields");
    }
    if (generatedControls !== undefined
        && (!Array.isArray(generatedControls) || generatedControls.length > 30
            || generatedControls.some((item) => !item || typeof item !== "object" || Array.isArray(item))
            || new Set(generatedControls.map(({ id }) => id)).size !== generatedControls.length)) {
        throw new Error("Invalid frozen generated controls");
    }
    const generatedFieldControlIds = [
        ...(generatedFields ?? []).map(({ id }) => id),
        ...(generatedControls ?? []).map(({ id }) => id),
    ];
    if (generatedFields?.some(({ id }) => essentialFields.has(id))
        || generatedFieldControlIds.length !== new Set(generatedFieldControlIds).size
        || generatedFieldControlIds.some((id) => essentialFields.has(id))) {
        throw new Error("Invalid frozen generated values");
    }
    const sections = new Map();
    for (const { section } of generatedFields ?? []) {
        if (!section) continue;
        if (sections.has(section.id) && sections.get(section.id) !== section.title) {
            throw new Error(`Conflicting frozen generated section: ${section.id}`);
        }
        sections.set(section.id, section.title);
    }
    if (valueSources !== undefined && (!Array.isArray(valueSources) || valueSources.length > 100
        || new Set(valueSources.map((item) => item?.id)).size !== valueSources.length)) {
        throw new Error("Invalid frozen value sources");
    }
    const frozenIds = new Set([...Object.keys(fieldConstraints), ...(valueSources ?? []).map((item) => item?.id)]);
    if (frozenIds.size !== Object.keys(fieldConstraints).length + (valueSources?.length ?? 0)) {
        throw new Error("Frozen value source collides with a Designer field");
    }
    if (designerFields !== undefined && (!Array.isArray(designerFields)
        || designerFields.length > 100 || new Set(designerFields.map((item) => item?.id)).size !== designerFields.length
        || designerFields.some((item) => !item || !fieldPattern.test(item.id)
            || typeof item.label !== "string" || !item.label.trim() || item.label.length > 120
            || typeof item.control !== "string"
            || !/^(?:stock\.(?:text|checkbox|image)|[a-z][a-z0-9-]{0,79})$/.test(item.control)
            || !Object.hasOwn(fieldConstraints, item.id)))) {
        throw new Error("Invalid frozen Designer field registry");
    }
    const generatedIds = new Set([
        ...(generatedFields ?? []).map((item) => item.id),
        ...(valueSources ?? []).map((item) => item?.id),
    ]);
    const valueModules = new Map();
    for (const item of valueSources ?? []) {
        if (!item || typeof item !== "object" || Array.isArray(item)
            || Object.keys(item).some((key) => !["id", "label", "schema", "source",
                "presentation", "section", "assets"].includes(key))
            || !fieldPattern.test(item.id)
            || typeof item.label !== "string" || !item.label.trim() || item.label.length > 120
            || !["stock.readonly", "stock.editable", "processing-only"].includes(item.presentation)
            || !item.source || typeof item.source !== "object" || Array.isArray(item.source)
            || !(item.source.kind === "constant" && Object.keys(item.source).sort().join() === "kind,value"
                || item.source.kind === "computed" && Object.keys(item.source).sort().join() === "kind,module"
                    && typeof item.source.module === "string"
                    && /^[a-z][a-z0-9-]{0,79}$/.test(item.source.module)
                    && !isWindowsDeviceName(item.source.module))
            || (item.section !== undefined && (!item.section || typeof item.section !== "object"
                || Object.keys(item.section).sort().join() !== "id,title"
                || typeof item.section.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(item.section.id)
                || typeof item.section.title !== "string" || !item.section.title.trim()
                || item.section.title.length > 120))
            || !Array.isArray(item.assets) || item.assets.length !== (item.source?.kind === "computed" ? 2 : 1)
            || item.assets[0]?.kind !== "generated.value-definition"
            || item.assets[1] && (item.assets[1].kind !== "generated.computed-value-provider"
                || item.assets[1].name !== item.source.module)
            || item.source?.kind === "computed" && item.presentation === "stock.editable") {
            throw new Error("Invalid frozen value source registration");
        }
        for (const asset of item.assets) {
            if (!asset || Object.keys(asset).sort().join() !== "content,hash,kind,name,sourceId"
                || typeof asset.name !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(asset.name)
                || typeof asset.sourceId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
                || typeof asset.content !== "string"
                || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)
                || asset.content.length > 44 * 1024
                || Buffer.from(asset.content, "base64").length > 32 * 1024
                || createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex") !== asset.hash) {
                throw new Error(`Invalid frozen value source asset: ${item.id}`);
            }
        }
        let definition;
        try { definition = withoutSchema(JSON.parse(Buffer.from(item.assets[0].content, "base64").toString("utf8"))); }
        catch { throw new Error(`${item.id}: invalid frozen value definition`); }
        if (!isDeepStrictEqual(definition, {
            schemaVersion: 1, id: item.id, label: item.label, schema: item.schema,
            source: item.source, presentation: item.presentation,
            ...(item.section ? { section: item.section } : {}),
        })) throw new Error(`${item.id}: frozen value definition differs from registration`);
        validateFrozenValues({ [item.id]: item.source.kind === "constant"
            ? item.source.value : item.schema.type === "string" ? ""
                : item.schema.type === "boolean" ? false
                    : Object.fromEntries(Object.entries(item.schema.properties ?? {})
                        .map(([key, allowed]) => [key, allowed[0]])) },
        { [item.id]: item.schema });
        if (item.source.kind === "computed") {
            const prior = valueModules.get(item.source.module);
            if (prior && prior !== item.assets[1].hash) {
                throw new Error(`Conflicting frozen value provider: ${item.source.module}`);
            }
            valueModules.set(item.source.module, item.assets[1].hash);
        }
        if (item.section) {
            if (sections.has(item.section.id) && sections.get(item.section.id) !== item.section.title) {
                throw new Error(`Conflicting frozen generated section: ${item.section.id}`);
            }
            sections.set(item.section.id, item.section.title);
        }
    }
    if (generatedPages !== undefined
        && (!Array.isArray(generatedPages) || generatedPages.length > 30
            || new Set(generatedPages.map((page) => page?.id)).size !== generatedPages.length
            || new Set(generatedPages.map((page) => page?.renderer)).size !== generatedPages.length)) {
        throw new Error("Invalid frozen generated pages");
    }
    for (const page of generatedPages ?? []) {
        if (!page || typeof page !== "object" || Array.isArray(page)
            || Object.keys(page).some((key) => !["assets", "id", "renderer", "title", "order", "values", "slots"].includes(key))
            || typeof page.id !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(page.id)
            || page.id === RESERVED_GENERATED_PAGE_ID || isWindowsDeviceName(page.id)
            || typeof page.renderer !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(page.renderer)
            || page.renderer === workflowLayout.adapter
            || isWindowsDeviceName(page.renderer)
            || typeof page.title !== "string" || !page.title.trim() || page.title.length > 120
            || (page.order !== undefined && (!Number.isInteger(page.order)
                || page.order < -100000 || page.order > 100000))
            || (page.values !== undefined && (!Array.isArray(page.values)
                || page.values.length > 100 || new Set(page.values).size !== page.values.length
                || page.values.some((id) => !generatedIds.has(id))))
            || (page.slots !== undefined && (!Array.isArray(page.slots)
                || page.slots.length > 30
                || new Set(page.slots.map((slot) => slot?.id)).size !== page.slots.length
                || page.slots.some((slot) => !slot || typeof slot !== "object"
                    || Object.keys(slot).join() !== "id"
                    || typeof slot.id !== "string" || !/^[a-z][a-z0-9.-]{0,79}$/.test(slot.id))))
            || !Array.isArray(page.assets) || page.assets.length !== 2
            || page.assets[0]?.name !== page.id || page.assets[0]?.kind !== "generated.added-page-definition"
            || page.assets[1]?.name !== page.renderer || page.assets[1]?.kind !== "generated.added-page-renderer"
            || page.assets.some((asset) => !asset || typeof asset !== "object"
                || Object.keys(asset).sort().join() !== "content,hash,kind,name,sourceId"
                || typeof asset.sourceId !== "string"
                || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
                || typeof asset.content !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)
                || asset.content.length > 44 * 1024
                || Buffer.from(asset.content, "base64").length > 32 * 1024
                || typeof asset.hash !== "string"
                || createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex") !== asset.hash)) {
            throw new Error("Invalid frozen generated page assets");
        }
        let definition;
        try { definition = withoutSchema(JSON.parse(Buffer.from(page.assets[0].content, "base64").toString("utf8"))); }
        catch { throw new Error(`${page.id}: invalid frozen generated page definition`); }
        if (!definition || Object.keys(definition).some((key) =>
            !["id", "renderer", "schemaVersion", "title", "order", "values", "slots"].includes(key))
            || definition.schemaVersion !== 1 || definition.id !== page.id
            || definition.renderer !== page.renderer || definition.title !== page.title
            || definition.order !== page.order
            || JSON.stringify(definition.values) !== JSON.stringify(page.values)
            || JSON.stringify(definition.slots) !== JSON.stringify(page.slots)) {
            throw new Error(`${page.id}: frozen generated page definition differs from registration`);
        }
    }
    for (const image of generatedAssets ?? []) {
        if (image.page && !generatedPages?.some((page) => page.id === image.page
            && page.slots?.some((slot) => slot.id === image.slot))) {
            throw new Error(`${image.id}: unknown generated page asset slot`);
        }
    }
    if (controlAssets !== undefined
        && (!Array.isArray(controlAssets) || !(generatedControls?.length || fieldPlacements?.length)
            || !controlAssets.length || controlAssets.length > 30
            || new Set(controlAssets.map((item) => item?.control)).size !== controlAssets.length)) {
        throw new Error("Invalid frozen generated control assets");
    }
    if (generatedControls?.length && !controlAssets) {
        throw new Error("Missing frozen generated control assets");
    }
    const assetsByControl = new Map();
    const adapterOwners = new Map();
    for (const entry of controlAssets ?? []) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)
            || Object.keys(entry).sort().join() !== "assets,control"
            || typeof entry.control !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(entry.control)
            || !Array.isArray(entry.assets) || entry.assets.length !== 2
            || entry.assets[0]?.kind !== "shared.control-definition"
            || entry.assets[1]?.kind !== "generated.control-adapter") {
            throw new Error("Invalid frozen generated control assets");
        }
        for (const asset of entry.assets) {
            if (!asset || Object.keys(asset).sort().join() !== "content,hash,kind,name,sourceId"
                || !/^[a-z][a-z0-9-]{0,79}$/.test(asset.name)
                || isWindowsDeviceName(asset.name)
                || typeof asset.sourceId !== "string"
                || !/^[A-Za-z0-9_.:-]{1,160}$/.test(asset.sourceId)
                || typeof asset.content !== "string"
                || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)
                || asset.content.length > 44 * 1024
                || Buffer.from(asset.content, "base64").length > 32 * 1024
                || createHash("sha256").update(Buffer.from(asset.content, "base64")).digest("hex") !== asset.hash) {
                throw new Error("Invalid frozen generated control asset");
            }
        }
        let definition;
        try { definition = withoutSchema(JSON.parse(Buffer.from(entry.assets[0].content, "base64").toString("utf8"))); }
        catch { throw new Error(`${entry.control}: invalid control definition`); }
        if (definition?.schemaVersion !== 1 || definition.id !== entry.control
            || definition.adapters?.generated !== entry.assets[1].name
            || !definition.adapters?.designer
            || entry.assets[0].name === entry.assets[1].name
            || !validControlContract(definition.value)) {
            throw new Error(`${entry.control}: incompatible frozen control assets`);
        }
        const adapter = entry.assets[1].name;
        if (adapterOwners.has(adapter)) {
            throw new Error(`${adapter}: generated adapter belongs to both ${adapterOwners.get(adapter)} and ${entry.control}`);
        }
        adapterOwners.set(adapter, entry.control);
        assetsByControl.set(entry.control, { assets: entry.assets, properties: definition.value.properties,
            contract: definition.value });
    }
    for (const item of generatedControls ?? []) {
        if (!item || Object.keys(item).sort().join() !== "control,id,label,slot,value"
            || !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(item.id)
            || !/^[a-z][a-z0-9-]{0,79}$/.test(item.control)
            || !item.label || typeof item.label !== "string" || item.label.length > 120
            || item.slot !== "details.content" || !assetsByControl.has(item.control)) {
            throw new Error("Invalid frozen generated control registration");
        }
        const { contract } = assetsByControl.get(item.control);
        if (fieldConstraints[item.id]?.type !== "object"
            || JSON.stringify(fieldConstraints[item.id].properties) !== JSON.stringify(contract.properties)
            || !validControlValue(item.value, contract)
            || JSON.stringify(values[item.id]) !== JSON.stringify(item.value)) {
            throw new Error(`${item.id}: incompatible frozen control value or adapters`);
        }
    }
    const placements = [];
    const placementIds = new Set();
    const placementTargets = new Set();
    if (fieldPlacements !== undefined && (!Array.isArray(fieldPlacements) || fieldPlacements.length > 100)) {
        throw new Error("Invalid frozen generated field placements");
    }
    for (const item of fieldPlacements ?? []) {
        const placement = frozenPlacement(item, "generated.field-placement");
        const page = placement.page === "workflow" ? workflowPage
            : generatedPages?.find((entry) => entry.id === placement.page);
        const source = valueSources?.find((entry) => entry.id === placement.field);
        const constraint = source?.schema ?? fieldConstraints[placement.field];
        const control = placement.control ?? (constraint?.type === "string" ? "stock.text"
            : constraint?.type === "boolean" ? "stock.checkbox"
                : constraint?.type === "image" ? "stock.image" : null);
        const target = `${placement.page}:${placement.slot}:${placement.field}`;
        if (!/^[a-z][a-z0-9-]{0,79}$/.test(placement.id)
            || placementIds.has(placement.id) || placementTargets.has(target)
            || ["workflow", "phase-control", workflowLayout.adapter, workflowLayout.pageAdapter,
                ...((generatedPages ?? []).flatMap((entry) => [entry.id, entry.renderer]))].includes(placement.id)
            || !page?.slots?.some(({ id }) => id === placement.slot)
            || placement.slot === "workflow.phases"
            || placement.page === "workflow"
                && ["workflow.list", "workflow.summary"].includes(placement.slot)
            || !fieldPattern.test(placement.field) || !constraint
            || source?.presentation === "processing-only"
            || !Number.isInteger(placement.order)
            || placement.order < -100000 || placement.order > 100000
            || typeof item.label !== "string" || !item.label.trim() || item.label.length > 120
            || (source && item.label !== source.label)
            || (!source && designerFields?.find((entry) => entry.id === placement.field)?.label !== item.label)
            || (!source && designerFields?.find((entry) => entry.id === placement.field)?.control !== control)
            || !control
            || constraint.type === "object" && (!assetsByControl.has(control)
                || !isDeepStrictEqual(assetsByControl.get(control).contract, constraint))
            || constraint.type !== "object" && control !== ({
                string: "stock.text", boolean: "stock.checkbox", image: "stock.image",
            })[constraint.type]) {
            throw new Error(`Invalid generated field placement: ${placement.id}`);
        }
        placementIds.add(placement.id);
        placementTargets.add(target);
        const image = constraint.type === "image"
            ? generatedAssets?.find((entry) => entry.id === placement.field) : null;
        if (constraint.type === "image" && !image && values[placement.field] !== "") {
            throw new Error(`${placement.id}: image placement has no packaged asset for its value`);
        }
        placements.push({ ...placement, label: item.label, control,
            schema: constraint, editable: source?.presentation === "stock.editable",
            ...(!source && constraint.type !== "image" ? { value: values[placement.field] } : {}),
            ...(image ? { asset: { file: imageFile(image), mime: image.mime, hash: image.hash } } : {}),
            ...(assetsByControl.has(control) ? {
                adapter: assetsByControl.get(control).assets[1].name,
                definition: assetsByControl.get(control).assets[0].name,
                adapterHash: assetsByControl.get(control).assets[1].hash,
                definitionHash: assetsByControl.get(control).assets[0].hash,
            } : {}) });
    }
    if (assetsByControl.size !== new Set([
        ...(generatedControls ?? []).map((item) => item.control),
        ...placements.map((item) => item.control).filter((id) => assetsByControl.has(id)),
    ]).size) {
        throw new Error("Unused frozen generated control assets");
    }
    const outputs = {
        constitution: ".specify/memory/constitution.md", specify: "specs/<slug>/spec.md",
        clarify: "specs/<slug>/spec.md", plan: "specs/<slug>/plan.md",
        tasks: "specs/<slug>/tasks.md", analyze: "specs/<slug>/analysis.md",
        checklist: "specs/<slug>/checklists/<name>.md",
    };
    const headerImage = generatedAssets?.find((item) => !item.page && item.slot === "header.brand");
    const mainImage = generatedAssets?.find((item) => !item.page && item.slot === "workflow.intro");
    const imageConfig = (item) => ({ file: imageFile(item), mime: item.mime, hash: item.hash });
    const pageImages = generatedAssets?.filter((item) => item.page) ?? [];
    const config = { schemaVersion: 1, canvas, userProvidesSlug: values["workflowSlug.userProvided"] ?? false,
        ...(Object.keys(appearance).length ? { appearance } : {}),
        showSetup: values["setup.show"] ?? false,
        ...(request.runtimeSetup ? { runtimeSetup: request.runtimeSetup } : {}),
        ...(dialogContracts.dialogs.length ? { dialogs: dialogContracts.dialogs } : {}),
        ...(dialogContracts.bindings.length ? { phaseDialogs: dialogContracts.bindings } : {}),
        ...(dialogContracts.buttons.length ? { buttons: dialogContracts.buttons,
            buttonControls: dialogContracts.controls } : {}),
        workflowPage: workflowLayout,
        ...(badgeConfig ? { badges: { instances: badgeConfig.instances,
            types: badgeConfig.types, rules: badgeConfig.rules } } : {}),
        ...(placements.length ? { fieldPlacements: placements } : {}),
        ...(headerImage ? { brandAsset: imageConfig(headerImage) } : {}),
        ...(mainImage ? { mainPageAsset: imageConfig(mainImage) } : {}),
        ...(pageImages.length ? { generatedPageAssets: pageImages.map((item) =>
            ({ id: item.id, label: item.label, page: item.page, slot: item.slot,
                ...imageConfig(item) })) } : {}),
        ...(imageControl ? { imageControl } : {}),
        ...(textControl ? { textControl, textPlacements: generatedTextPlacements } : {}),
        ...(generatedPages?.length ? { generatedPages: generatedPages.map(({ id, title, renderer,
            order, values: declared, slots }) => ({ id, title, renderer,
            ...(order !== undefined ? { order } : {}),
            ...(declared ? { values: declared } : {}), ...(slots ? { slots } : {}) })) } : {}),
        ...(valueSources?.length ? { valueSources: valueSources.map(
            ({ id, label, schema, source, presentation, section, assets }) => ({
                id, label, schema, source: source.kind === "computed"
                    ? { ...source, hash: assets[1].hash } : source,
                presentation, provenance: assets[0].sourceId,
                ...(section ? { section } : {}),
            })) } : {}),
        ...(generatedFields?.length ? { readOnlyFields: generatedFields.map(({ id, label, section }) =>
            ({ id, label, value: values[id], ...(section ? { section } : {}) })) } : {}),
        ...(generatedControls?.length ? { generatedControls: generatedControls.map(
            ({ id, label, control, slot, value }) => {
                const { assets, properties } = assetsByControl.get(control);
                return { id, label, control, slot, value, adapter: assets[1].name, properties };
            }) } : {}),
        phases: workflow.selectedPhases,
        ...(workflow.phaseDescriptions !== undefined ? { phaseDescriptions: workflow.phaseDescriptions } : {}),
        phaseOutputs: Object.fromEntries(workflow.selectedPhases.map((phase) => {
            const path = outputs[phase.replace(/^speckit\./, "")] ?? null;
            return [phase, { expectsArtifact: !!path, outputPath: path }];
        })), phaseArtifacts: workflow.phaseArtifacts ?? {},
        installed: {
            presets: installed.presets.map(({ id, version, priority }) => ({ id, version, priority })),
            extensions: installed.extensions.map(({ id, version, priority }) => ({ id, version, priority })),
            bundles: installed.bundles.map(({ id, version }) => ({ id, version })),
        } };
    phaseContract(config);
    return config;
}

function checkSyntax(path, bytes) {
    const check = bytes === undefined
        ? spawnSync("node", ["--check", path], { encoding: "utf8" })
        : spawnSync("node", ["--input-type=module", "--check"], { input: bytes, encoding: "utf8" });
    if (check.error || check.status !== 0) throw new Error(`Generated JavaScript failed validation: ${check.stderr || check.error}`);
}

export async function readBoundedSessionFile(parent, name, limit, label, openFile = open) {
    const invalid = `${label} must be a bounded regular session file`;
    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || await realpath(parent) !== parent) {
        throw new Error(invalid);
    }
    const path = join(parent, name);
    let file;
    try {
        file = await openFile(path, constants.O_RDONLY
            | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
        if (error.code === "ELOOP") throw new Error(invalid, { cause: error });
        throw error;
    }
    try {
        const [stat, pathStat, currentParent, currentParentStat] = await Promise.all([
            file.stat(), lstat(path), realpath(parent), lstat(parent),
        ]);
        if (currentParent !== parent || !currentParentStat.isDirectory()
            || parentStat.dev !== currentParentStat.dev || parentStat.ino !== currentParentStat.ino
            || !stat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
            || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
            throw new Error(invalid);
        }
        if (stat.size > limit) throw new Error(`${label} is too large`);
        const bytes = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < bytes.length) {
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        if (length > limit) throw new Error(`${label} is too large`);
        return bytes.toString("utf8", 0, length);
    } finally {
        await file.close();
    }
}

async function existingGeneratedCanvas(target, projectRoot, workspaceRoot, handoff, canvasId, files) {
    const handoffId = handoff.handoffId;
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Existing canvas is not a generated directory");
    const readJson = async (name) => {
        const bytes = await readBoundedSessionFile(target, name, REQUEST_LIMIT,
            `Existing generated ${name}`);
        return JSON.parse(bytes);
    };
    let provenance, config, previous, priorConfig;
    try {
        provenance = await readJson("settings-provenance.json");
        config = await readJson("canvas-config.json");
        await readJson("canvas-setup.json");
        if (!provenance || Object.keys(provenance).sort().join() !== "handoffId,requestId,sourceFingerprint"
            || provenance.handoffId !== handoffId || !requestPattern.test(provenance.requestId)
            || !/^[a-f0-9]{64}$/.test(provenance.sourceFingerprint)
            || config?.canvas?.id !== canvasId) throw new Error("Provenance does not match the canvas");
        const oldGeneration = join(workspaceRoot, "speckit-canvas-designer", "handoffs",
            handoffId, "generations", provenance.requestId);
        if (await realpath(oldGeneration) !== oldGeneration) throw new Error("Prior request escapes its session");
        previous = JSON.parse(await readBoundedSessionFile(oldGeneration, "request.json",
            REQUEST_LIMIT, "Prior generation request"));
        validateGenerationRequestIntegrity(previous, handoffId, provenance.requestId);
        priorConfig = configuration({ ...previous,
            installed: previous.actualInstalled ?? previous.installed });
        if (previous.project !== projectRoot || previous.target !== `.github/extensions/${canvasId}/`
            || previous.values?.["canvas.id"] !== canvasId
            || previous.sourceFingerprint !== provenance.sourceFingerprint
            || priorConfig.canvas.id !== canvasId
            || !isDeepStrictEqual(previous.workflow.selectedPhases, handoff.workflow.selectedPhases)
            || !isDeepStrictEqual(previous.installed, handoff.workflow.installed)
            || !isDeepStrictEqual(previous.runtimeSetup, handoff.workflow.runtimeSetup)) {
            throw new Error("Existing canvas differs from its frozen generation request");
        }
    } catch (error) {
        throw new Error(`Existing canvas cannot be safely replaced: ${error.message}`);
    }
    const required = new Set(files.map(([name]) => name.replaceAll("/", sep)));
    for (const name of ["canvas-config.json", "canvas-setup.json", "settings-provenance.json"]) required.add(name);
    const add = (folder, filename) => required.add(`${folder}${sep}${filename}`);
    for (const page of previous.generatedPages ?? []) {
        add("pages", `${page.id}.json`);
        add("pages", `${page.renderer}.mjs`);
    }
    for (const [name, asset] of [["workflow.json", previous.workflowPage.assets[0]],
        ["phase-control.json", previous.workflowPage.assets[1]],
        [`${priorConfig.workflowPage.adapter}.mjs`, previous.workflowPage.assets[2]],
        [`${priorConfig.workflowPage.pageAdapter}.mjs`, previous.workflowPage.assets[3]]]) {
        if (asset) add("pages", name);
    }
    for (const item of previous.fieldPlacements ?? []) add("pages", `${item.id}.json`);
    for (const item of previous.controlAssets ?? []) for (const [index, asset] of item.assets.entries()) {
        add("controls", `${asset.name}.${index === 0 ? "json" : "mjs"}`);
    }
    for (const item of [previous.generatedImageControl, previous.generatedTextControl].filter(Boolean)) {
        for (const asset of item.assets) add("controls",
            `${asset.name}.${asset.kind === "shared.control-definition" ? "json" : "mjs"}`);
    }
    for (const item of previous.valueSources ?? []) if (item.source.kind === "computed") {
        add("providers", `${item.source.module}.mjs`);
    }
    for (const item of previous.generatedAssets ?? []) {
        add("assets", imageFile(item));
    }
    for (const item of [...(previous.dialogDefinitions ?? []), ...(previous.phaseDialogBindings ?? [])]) {
        for (const [index, asset] of item.assets.entries()) add("dialogs",
            `${asset.name}.${index === 0 ? "json" : "mjs"}`);
    }
    for (const item of previous.buttonPlacements ?? []) {
        add("buttons", `${item.assets[0].name}.json`);
    }
    for (const item of previous.buttonControls ?? []) {
        for (const asset of item.assets) add("buttons",
            `${asset.name}.${asset.kind === "generated.button-adapter" ? "mjs" : "json"}`);
    }
    for (const item of previous.badges?.adapters ?? []) add("badges", `${item.name}.mjs`);
    const verify = async (directory) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name), key = relative(target, path);
            if (entry.isSymbolicLink()) throw new Error(`Existing canvas contains a link: ${key}`);
            if (entry.isDirectory()) await verify(path);
            else if (!entry.isFile()) throw new Error(`Existing canvas contains a special file: ${key}`);
            else required.delete(key);
        }
    };
    await verify(target);
    if (required.size) throw new Error(`Incomplete generated canvas: ${[...required][0]}`);
    return { stat, requestId: provenance.requestId };
}

export async function materialize(project, workspace, handoffId, requestId, replaceExisting = false) {
    const priorRequestId = typeof replaceExisting === "string"
        ? /^--replace-existing=([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(replaceExisting)?.[1]
        : null;
    if (replaceExisting !== false && !priorRequestId) throw new Error("Invalid replaceExisting confirmation");
    if (!requestPattern.test(handoffId) || !requestPattern.test(requestId)) throw new Error("Invalid generation identifiers");
    const projectRoot = await realpath(project), workspaceRoot = await realpath(workspace);
    const generation = join(workspaceRoot, "speckit-canvas-designer", "handoffs", handoffId, "generations", requestId);
    if (await realpath(generation) !== generation) {
        throw new Error("Generation request escapes its session directory");
    }
    const request = JSON.parse(await readBoundedSessionFile(
        generation, "request.json", REQUEST_LIMIT, "Generation request"));
    validateGenerationRequestIntegrity(request, handoffId, requestId);
    if (request.project !== projectRoot) throw new Error("Generation request is bound to another checkout");
    const handoffFolder = join(workspaceRoot, "speckit-canvas-designer", "handoffs", handoffId);
    const handoff = JSON.parse(await readBoundedSessionFile(
        handoffFolder, "handoff.json", 64 * 1024, "Wizard handoff"));
    if (handoff.handoffId !== handoffId
        || JSON.stringify(handoff.workflow.selectedPhases) !== JSON.stringify(request.workflow.selectedPhases)
        || JSON.stringify(handoff.workflow.phaseDescriptions ?? {})
            !== JSON.stringify(request.workflow.phaseDescriptions ?? {})
        || JSON.stringify(handoff.workflow.installed) !== JSON.stringify(request.installed)) {
        throw new Error("Frozen generation request differs from the Wizard handoff");
    }
    if (request.actualInstalled !== undefined
        && (!request.actualInstalled || typeof request.actualInstalled !== "object"
            || Array.isArray(request.actualInstalled)
            || Object.keys(request.actualInstalled).sort().join() !== "bundles,extensions,presets"
            || ["presets", "extensions", "bundles"].some((kind) =>
                !Array.isArray(request.actualInstalled[kind])
                || request.actualInstalled[kind].length !== request.installed[kind].length
                || request.actualInstalled[kind].some((item, index) =>
                    item?.id !== request.installed[kind][index].id
                    || typeof item.version !== "string" || !item.version
                    || (kind !== "bundles" && item.priority !== undefined
                        && !Number.isSafeInteger(item.priority)))))) {
        throw new Error("Invalid verified generation inventory");
    }
    if (!/^[a-f0-9]{64}$/.test(handoff.sourceFingerprint)
        || !/^[a-f0-9]{64}$/.test(request.sourceFingerprint)) {
        throw new Error("Invalid generation source fingerprint");
    }
    const expectedFingerprint = createHash("sha256").update(JSON.stringify({
        workflow: handoff.workflow, selections: handoff.selections,
        localSelections: handoff.localSelections,
        ...(handoff.canvasDesign === undefined ? {} : { canvasDesign: handoff.canvasDesign }),
    })).digest("hex");
    const warnings = handoff.sourceFingerprint === request.sourceFingerprint
        && handoff.sourceFingerprint === expectedFingerprint ? [] :
        ["Generation source fingerprint differs from the Wizard handoff; using the intact frozen request with matching checkout, workflow, and installed inventory."];
    for (const kind of ["presets", "extensions", "bundles"]) {
        for (const [index, item] of (request.actualInstalled?.[kind] ?? []).entries()) {
            const frozen = request.installed[kind][index];
            if (item.version !== frozen.version) {
                warnings.push(`${kind} ${item.id}: Wizard version ${frozen.version}, installed version ${item.version}.`);
            }
        }
    }
    const config = configuration({ ...request, installed: request.actualInstalled ?? request.installed });
    if (config.workflowPage.pageAdapter && config.badges?.instances.some((badge) =>
        badge.showIn.includes("phase-card")
            && badge.phase?.replace(/^speckit\./, "") === "constitution"
        || badge.targets?.some((target) =>
            target.phase.replace(/^speckit\./, "") === "constitution"))) {
        const pageSource = Buffer.from(request.workflowPage.assets[3].content, "base64").toString("utf8");
        if (!/^export const capabilities = \["workflow\.badges\.project\.v1"\];(?:\r?\n|$)/
            .test(pageSource)) {
            throw new Error("Frozen Workflow page adapter does not support project badges");
        }
    }
    if (!isDeepStrictEqual(request.runtimeSetup, handoff.workflow.runtimeSetup)) {
        throw new Error("Runtime setup recipe differs from the Wizard handoff");
    }
    if (config.showSetup && !request.runtimeSetup) {
        throw new Error("Show setup requires a verified runtime setup recipe");
    }
    const badgeFiles = (request.badges?.adapters ?? []).map((asset) => ({
        filename: `${asset.name}.mjs`, bytes: Buffer.from(asset.content, "base64"),
    }));
    const pageFiles = (request.generatedPages ?? []).flatMap((page) => [
        { filename: `${page.id}.json`, bytes: Buffer.from(page.assets[0].content, "base64") },
        { filename: `${page.renderer}.mjs`, bytes: Buffer.from(page.assets[1].content, "base64") },
    ]);
    pageFiles.push(
        { filename: "workflow.json", bytes: Buffer.from(request.workflowPage.assets[0].content, "base64") },
        { filename: "phase-control.json",
            bytes: Buffer.from(request.workflowPage.assets[1].content, "base64") },
        { filename: `${config.workflowPage.adapter}.mjs`,
            bytes: Buffer.from(request.workflowPage.assets[2].content, "base64") });
    if (request.workflowPage.assets[3]) {
        pageFiles.push({ filename: `${config.workflowPage.pageAdapter}.mjs`,
            bytes: Buffer.from(request.workflowPage.assets[3].content, "base64") });
    }
    for (const item of request.fieldPlacements ?? []) {
        pageFiles.push({ filename: `${item.id}.json`, bytes: Buffer.from(item.assets[0].content, "base64") });
    }
    const pageFilenames = new Set();
    for (const { filename } of pageFiles) {
        if (pageFilenames.has(filename)) throw new Error(`Conflicting generated page asset: ${filename}`);
        pageFilenames.add(filename);
    }
    const controlFiles = (request.controlAssets ?? []).flatMap(({ assets }) => [
        { filename: `${assets[0].name}.json`, bytes: Buffer.from(assets[0].content, "base64") },
        { filename: `${assets[1].name}.mjs`, bytes: Buffer.from(assets[1].content, "base64") },
    ]);
    if (request.generatedImageControl) {
        controlFiles.push(...request.generatedImageControl.assets.map((asset) => ({
            filename: `${asset.name}.${asset.kind === "shared.control-definition" ? "json" : "mjs"}`,
            bytes: Buffer.from(asset.content, "base64"),
        })));
    }
    if (request.generatedTextControl) {
        controlFiles.push(...request.generatedTextControl.assets.map((asset) => ({
            filename: `${asset.name}.${asset.kind === "shared.control-definition" ? "json" : "mjs"}`,
            bytes: Buffer.from(asset.content, "base64"),
        })));
    }
    const providerFiles = [...new Map((request.valueSources ?? []).filter(
        (item) => item.source.kind === "computed").map((item) => [
        item.source.module, { filename: `${item.source.module}.mjs`,
            bytes: Buffer.from(item.assets[1].content, "base64") },
    ])).values()];
    const imageFiles = (request.generatedAssets ?? []).map((item) => ({
        filename: imageFile(item), bytes: frozenImage(item, request.values, request.fieldConstraints),
    }));
    const dialogFiles = [
        ...(request.dialogDefinitions ?? []).flatMap(({ assets }) => [
            { filename: `${assets[0].name}.json`, bytes: Buffer.from(assets[0].content, "base64") },
            { filename: `${assets[1].name}.mjs`, bytes: Buffer.from(assets[1].content, "base64") },
        ]),
        ...(request.phaseDialogBindings ?? []).map(({ assets }) =>
            ({ filename: `${assets[0].name}.json`, bytes: Buffer.from(assets[0].content, "base64") })),
    ];
    const buttonFiles = [
        ...(request.buttonPlacements ?? []).map(({ assets }) =>
            ({ filename: `${assets[0].name}.json`, bytes: Buffer.from(assets[0].content, "base64") })),
        ...(request.buttonControls ?? []).flatMap(({ assets }) => assets.map((asset) =>
            ({ filename: `${asset.name}.${asset.kind === "generated.button-adapter" ? "mjs" : "json"}`,
                bytes: Buffer.from(asset.content, "base64") }))),
    ];
    for (const [kind, entries] of [["dialog", dialogFiles], ["button", buttonFiles]]) {
        const names = new Map();
        for (const file of entries) {
            if (names.has(file.filename) && !names.get(file.filename).equals(file.bytes)) {
                throw new Error(`Conflicting generated ${kind} asset filenames`);
            }
            names.set(file.filename, file.bytes);
        }
    }
    const distinctControlFiles = new Map();
    for (const file of controlFiles) {
        if (distinctControlFiles.has(file.filename)
            && !distinctControlFiles.get(file.filename).equals(file.bytes)) {
            throw new Error(`Conflicting generated control asset: ${file.filename}`);
        }
        distinctControlFiles.set(file.filename, file.bytes);
    }
    const output = join(projectRoot, ".github", "extensions", config.canvas.id);
    if (!within(projectRoot, output) || request.target !== `.github/extensions/${config.canvas.id}/`) {
        throw new Error("Generation target is invalid");
    }
    const files = await Promise.all([...featureFiles, "extension.mjs"].map(async (file) =>
        [file, await readFile(join(featureRoot, file))]));
    const github = join(projectRoot, ".github");
    await mkdir(github, { recursive: true });
    if (await realpath(github) !== github) {
        throw new Error("Canvas extension directory escapes the checkout");
    }
    const parent = join(projectRoot, ".github", "extensions");
    await mkdir(parent, { recursive: true });
    if (await realpath(parent) !== parent) {
        throw new Error("Canvas extension directory escapes the checkout");
    }
    let original;
    try {
        original = await lstat(output);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    if (original && !priorRequestId) throw new Error(`Canvas extension already exists: ${output}`);
    if (original) {
        const previous = await existingGeneratedCanvas(output, projectRoot, workspaceRoot,
            handoff, config.canvas.id, files);
        if (priorRequestId !== previous.requestId) {
            throw new Error("Canvas changed since replacement was confirmed");
        }
    } else if (priorRequestId) {
        throw new Error("Canvas no longer exists for confirmed replacement");
    }
    const target = await mkdtemp(join(parent, `.${config.canvas.id}-stage-`));
    const owned = await lstat(target);
    const verifyTarget = async () => {
        const current = await lstat(target);
        if (!current.isDirectory() || current.isSymbolicLink()
            || current.dev !== owned.dev || current.ino !== owned.ino
            || await realpath(target) !== target || await realpath(parent) !== parent) {
            throw new Error("Canvas directory changed during generation");
        }
    };
    try {
    await verifyTarget();
    await mkdir(join(target, "ui"));
    await mkdir(join(target, "contracts"));
    if (pageFiles.length) await mkdir(join(target, "pages"));
    if (controlFiles.length) await mkdir(join(target, "controls"));
    if (providerFiles.length) await mkdir(join(target, "providers"));
    if (badgeFiles.length) await mkdir(join(target, "badges"));
    if (imageFiles.length) await mkdir(join(target, "assets"));
    if (dialogFiles.length) await mkdir(join(target, "dialogs"));
    if (buttonFiles.length) await mkdir(join(target, "buttons"));
    for (const { filename, bytes } of imageFiles) {
        await writeFile(join(target, "assets", filename), bytes, { flag: "wx" });
    }
    for (const { filename, bytes } of pageFiles) {
        const path = join(target, "pages", filename);
        await writeFile(path, bytes, { flag: "wx" });
        if (filename.endsWith(".mjs")) checkSyntax(path);
    }
    for (const [filename, bytes] of distinctControlFiles) {
        const path = join(target, "controls", filename);
        await writeFile(path, bytes, { flag: "wx" });
        if (filename.endsWith(".mjs")) checkSyntax(path);
    }
    for (const { filename, bytes } of providerFiles) {
        const path = join(target, "providers", filename);
        await writeFile(path, bytes, { flag: "wx" });
        checkSyntax(path);
    }
    for (const [folder, entries] of [["dialogs", dialogFiles], ["buttons", buttonFiles]]) {
        for (const { filename, bytes } of new Map(entries.map((file) => [file.filename, file])).values()) {
            const path = join(target, folder, filename);
            await writeFile(path, bytes, { flag: "wx" });
            if (filename.endsWith(".mjs")) checkSyntax(path);
        }
    }
    for (const { filename, bytes } of badgeFiles) {
        const path = join(target, "badges", filename);
        await writeFile(path, bytes, { flag: "wx" });
        checkSyntax(path);
    }
    for (const [file, content] of files) {
        if (file !== "extension.mjs") {
            await writeFile(join(target, file), content, { flag: "wx" });
        }
    }
    await writeFile(join(target, "canvas-config.json"), JSON.stringify(config), { flag: "wx" });
    await writeFile(join(target, "canvas-setup.json"), JSON.stringify({ values: request.values }), { flag: "wx" });
    await writeFile(join(target, "settings-provenance.json"),
        JSON.stringify({ requestId, handoffId, sourceFingerprint: request.sourceFingerprint }), { flag: "wx" });
    for (const file of featureFiles) {
        if (file.endsWith(".mjs") || file.endsWith(".js")) checkSyntax(join(target, file));
    }
    checkSyntax(join(target, "extension.mjs"), files.at(-1)[1]);
    const renderer = spawnSync("node", ["--input-type=module", "-e",
        "const m=await import(process.argv[1]);m.renderHtml(m.readConfig());",
        pathToFileURL(join(target, "server.mjs")).href],
    { encoding: "utf8" });
    if (renderer.error || renderer.status !== 0) throw new Error(`Workflow renderer failed: ${renderer.stderr || renderer.error}`);
    await verifyTarget();
    await writeFile(join(target, "extension.mjs"), files.at(-1)[1], { flag: "wx" });
    let current;
    try { current = await lstat(output); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (original) {
        if (!current || current.dev !== original.dev || current.ino !== original.ino
            || !current.isDirectory() || current.isSymbolicLink()) {
            throw new Error("Existing canvas changed during generation");
        }
        const previous = await existingGeneratedCanvas(output, projectRoot, workspaceRoot,
            handoff, config.canvas.id, files);
        if (priorRequestId !== previous.requestId) {
            throw new Error("Canvas changed since replacement was confirmed");
        }
        const backupDir = await mkdtemp(join(parent, `.${config.canvas.id}-backup-`));
        const backup = join(backupDir, "previous");
        let moved = false;
        let published = false;
        try {
            await rename(output, backup);
            moved = true;
            const displaced = await lstat(backup);
            if (displaced.dev !== original.dev || displaced.ino !== original.ino) {
                throw new Error("Existing canvas changed during replacement");
            }
            await renameDirectoryWithoutReplacement(target, output);
            published = true;
        } catch (error) {
            if (moved) {
                try {
                    await renameDirectoryWithoutReplacement(backup, output);
                }
                catch (rollback) {
                    throw new AggregateError([error, rollback],
                        `Canvas replacement failed; prior output remains at ${backup}`);
                }
            }
            throw error;
        } finally {
            // Retain the backup if a rollback failed.
            if (!published && await lstat(backup).then(() => false, (error) => error.code === "ENOENT")) {
                await rm(backupDir, { recursive: true, force: true });
            }
        }
        try { await rm(backupDir, { recursive: true, force: true }); }
        catch (error) {
            warnings.push(`Canvas replacement was published, but the prior backup could not be removed at ${backupDir}: ${error.message}. Inspect and remove any remaining files manually.`);
        }
    } else {
        try { await lstat(output); throw new Error(`Canvas extension already exists: ${output}`); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await renameDirectoryWithoutReplacement(target, output);
    }
    return { target: request.target, canvasId: config.canvas.id, warnings };
    } catch (error) {
        try {
            const current = await lstat(target).catch((readError) => {
                if (readError.code === "ENOENT") return null;
                throw readError;
            });
            if (current) {
                await verifyTarget();
                await rm(target, { recursive: true, force: true });
            }
        } catch (cleanup) {
            throw new AggregateError([error, cleanup],
                `${error.message}; failed canvas cleanup requires inspection at ${target}: ${cleanup.message}`);
        }
        throw error;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    materialize(...process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
