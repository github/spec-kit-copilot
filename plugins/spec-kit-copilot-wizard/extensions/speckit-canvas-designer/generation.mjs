import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isWindowsDeviceName, readFrozenAsset } from "./pages.mjs";
import { initialOutputs, validateValues } from "./settings.mjs";
import { decodeImage } from "./image.mjs";
import { validateConfirmedOutputs } from "./handoff.mjs";
import { specifySpawnOptions } from "../speckit-wizard-canvas/env/specify-invocation.mjs";
import { serializeGenerationRequest } from "./contracts/generation-request.mjs";
import { normalizeObservedVersions } from "./contracts/specify-inventory.mjs";
import { validateDesignerAdapterExports } from "./contracts/external-control-adapter.mjs";
import { findDuplicateBadge } from "./ui/badge-duplicates.js";
import { badgePlacements, validBadgeCategory, validBadgeSelections, validPlacementTexts }
    from "./ui/badge-selection-contract.js";

const required = ["canvas.id", "canvas.displayName"];
const reserved = new Set(["speckit-canvas-designer", "speckit-wizard", "speckit-canvas-generator"]);
const canvasIdPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;
const execFileAsync = promisify(execFile);

export async function canvasOutputExists(project, id, entryPoint = false) {
    if (!project || typeof id !== "string" || !canvasIdPattern.test(id)
        || reserved.has(id) || isWindowsDeviceName(id)) return false;
    try {
        const output = await stat(join(project, ".github", "extensions", id,
            ...(entryPoint ? ["extension.mjs"] : [])));
        return entryPoint ? output.isFile() : true;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

export function generationBlockers(model) {
    const pages = model.pages ?? [];
    const essentials = pages.find((page) => page.page === "designer-essentials");
    const blockers = [...(model.compositionErrors ?? [])];
    if (!essentials || essentials.error || essentials.enabled === false
        || !required.every((id) => essentials.fields?.some((field) => field.id === id))) {
        blockers.unshift("Essentials must contain Canvas ID and Title");
    }
    if (!model.workflowPage || !model.templates?.some((entry) =>
        entry.kind === "generated.workflow-page-definition")) {
        blockers.push("Generated Workflow page definition is required");
    }
    if (!model.templates?.some((entry) => entry.name === "generated-phase-control"
        && entry.kind === "generated.phase-control-definition")
        || !model.templates?.some((entry) => entry.kind === "generated.phase-control-adapter")) {
        blockers.push("Generated phase control and adapter are required");
    }
    const invalid = pages.find((page) => page.error);
    if (invalid) blockers.push(`${invalid.page}: ${invalid.error.reason}`);
    return blockers;
}

export function validateEssentials(model, values) {
    const setup = model.pages.find((page) => page.page === "designer-essentials");
    if (!setup || setup.error || !Array.isArray(setup.fields)
        || required.some((id) => !setup.fields.some((field) => field.id === id))) {
        throw new Error("Essentials must load with Canvas ID and Title before generation");
    }
    const failed = model.pages.find((page) => page.error);
    if (failed) {
        throw new Error(`Cannot generate while ${failed.page} is invalid: ${failed.error.reason}`);
    }
    if (typeof values?.["canvas.id"] === "string"
        && (reserved.has(values["canvas.id"]) || isWindowsDeviceName(values["canvas.id"]))) {
        throw new Error("Canvas ID (canvas.id) must be non-reserved");
    }
    validateValues(values, model.constraints);
    const result = { ...values };
    for (const id of required) {
        result[id] = values[id].trim();
    }
    for (const id of ["canvas.description", "canvas.workflowListName", "canvas.workflowItemName"]) {
        if (Object.hasOwn(result, id)) result[id] = result[id].trim();
    }
    if (!result["canvas.id"] || !result["canvas.displayName"]
        || !canvasIdPattern.test(result["canvas.id"])
        || result["canvas.displayName"].length > 120
        || reserved.has(result["canvas.id"]) || isWindowsDeviceName(result["canvas.id"])) {
        throw new Error("Canvas ID and Title must be valid and non-reserved");
    }
    return result;
}

async function validateAdapterValues(model, values, project) {
    const specify = join(await realpath(project), ".specify");
    const modules = new Map();
    for (const page of model.pages) {
        for (const field of page.fields ?? []) {
            if (page.fixedControl === "designer.identity"
                && ["canvas.id", "canvas.displayName"].includes(field.id)) continue;
            const name = model.adapters[field.control];
            const asset = model.templates.find((item) =>
                item.name === name && item.kind === "designer.control-adapter");
            const control = model.controls.find((item) => item.id === field.control);
            if (!asset || !control) throw new Error(`Missing Designer adapter for ${field.label} (${field.id})`);
            if (!modules.has(name)) {
                const bytes = await readFrozenAsset(asset, specify);
                const module = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
                try { validateDesignerAdapterExports(module, control); }
                catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
                modules.set(name, module);
            }
            let valid;
            try {
                valid = modules.get(name).validate(values[field.id], field);
            } catch (error) {
                throw new Error(`${field.label} (${field.id}) validator failed: ${error.message}`, { cause: error });
            }
            if (typeof valid !== "boolean") {
                throw new Error(`${field.label} (${field.id}) validator must return a boolean`);
            }
            if (!valid) throw new Error(`Invalid ${field.label} (${field.id})`);
        }
    }
}

export async function readCurrentInstalledVersions(project, frozen, run = execFileAsync) {
    const inventory = { presets: [], extensions: [], bundles: [] };
    const warnings = [];
    for (const [kind, command] of [["presets", "preset"], ["extensions", "extension"], ["bundles", "bundle"]]) {
        const relevantIds = new Set(frozen[kind].map((entry) => entry.id));
        if (!relevantIds.size) continue;
        try {
            const { stdout } = await run(process.platform === "win32" ? "specify.exe" : "specify",
                [command, "list", "--json"],
                await specifySpawnOptions(project, { timeout: 10000, maxBuffer: 128 * 1024, shell: false }));
            inventory[kind] = normalizeObservedVersions(stdout, kind, relevantIds);
        } catch (error) {
            inventory[kind] = [];
            warnings.push(`Could not read ${kind} inventory from Specify: ${error.message}.`);
        }
    }
    return { inventory, warnings };
}

export function reconcileInstalledVersions(frozen, inventory) {
    const installed = { presets: [], extensions: [], bundles: [] };
    const warnings = [];
    for (const kind of ["presets", "extensions", "bundles"]) {
        for (const entry of frozen[kind]) {
            const current = inventory[kind].find((item) => item.id === entry.id);
            const version = current?.version ?? "unverified";
            installed[kind].push(kind === "bundles" ? { id: entry.id, version }
                : { id: entry.id, version,
                    ...(Number.isSafeInteger(current?.priority) ? { priority: current.priority } : {}) });
            if (version !== entry.version) {
                warnings.push(`${kind} ${entry.id}: Wizard version ${entry.version}, installed version ${version}.`);
            }
        }
    }
    return { installed, warnings };
}

export function validBadgeEvidence(instance, rule, phaseIds, declared) {
    if (!Array.isArray(rule?.inputs) || !instance?.inputs
        || typeof instance.inputs !== "object" || Array.isArray(instance.inputs)) return false;
    if (rule.placementPhaseInput !== undefined
        && !rule.inputs.some((input) => input.id === rule.placementPhaseInput
            && input.type === "artifact")) return false;
    if (rule.placementPhaseInput
        && (instance.targets?.length
            ? instance.targets.length !== 1 || instance.targets[0].output !== null
                || instance.targets[0].phase !== instance.inputs[rule.placementPhaseInput]?.phase
            : instance.showIn?.includes("phase-card")
                && instance.phase !== instance.inputs[rule.placementPhaseInput]?.phase)) return false;
    for (const input of rule.inputs) {
        if (input.type !== "ordered-artifacts") {
            if (input.before !== undefined || input.minItems !== undefined
                || input.scope !== undefined
                && !(input.type === "artifact" && ["directory", "metadata"].includes(input.scope))) return false;
            continue;
        }
        if (input.scope !== "metadata"
            || !rule.inputs.some((entry) => entry.id === input.before
                && entry.type === "artifact" && entry.scope !== "directory")
            || input.minItems !== undefined && (!Number.isInteger(input.minItems)
                || input.minItems < 1 || input.minItems > 100)) return false;
        const prior = instance.inputs[input.id];
        const target = instance.inputs[input.before];
        if (!Array.isArray(prior) || prior.length > 100
            || prior.length < (input.minItems ?? 0) || !declared(target)
            || prior.some((entry) => !entry || typeof entry !== "object"
                || Object.keys(entry).sort().join() !== "output,phase" || !declared(entry))) return false;
        const chain = [...prior, target];
        if (chain.some((entry, index) => index
                && phaseIds.indexOf(chain[index - 1].phase) >= phaseIds.indexOf(entry.phase))
            || new Set(chain.map((entry) => entry.output.toLowerCase())).size !== chain.length) return false;
    }
    return true;
}

export async function freezeGeneration({ model, values, outputs = model.outputs, badges = model.badges,
    handoff, project, workspace,
    runtimeInventory, inventoryWarning, replaceExisting = false }) {
    const blockers = generationBlockers(model);
    if (blockers.length) throw new Error(`Cannot generate: ${blockers.join("; ")}`);
    const essentials = validateEssentials(model, values);
    if (outputs !== undefined) validateConfirmedOutputs(outputs, handoff.workflow.selectedPhases,
        initialOutputs(handoff));
    for (const kind of ["presets", "extensions"]) {
        for (const item of handoff?.workflow?.installed?.[kind] ?? []) {
            if (item.source === "local" && item.id !== "extension-canvas-design"
                && !item.path && !handoff.localSelections?.[kind]?.some((selection) =>
                    selection.id === item.id && selection.path)) {
                throw new Error(`Cannot generate portable runtime setup: local ${kind} ${item.id} has no verified path`);
            }
        }
    }
    await validateAdapterValues(model, essentials, project);
    if (!canvasIdPattern.test(essentials["canvas.id"])
        || reserved.has(essentials["canvas.id"]) || isWindowsDeviceName(essentials["canvas.id"])) {
        throw new Error("Invalid frozen Canvas ID for generated extension path");
    }
    const textContributions = (model.contributions ?? []).filter((item) =>
        item.field.control === "stock.text"
        && (item.generatedBinding?.presentation === "text"
            || item.generatedBinding?.presentation === "stock.readonly"
                && !["canvas.description", "canvas.workflowListName"].includes(item.field.id)));
    const imageContributions = (model.contributions ?? [])
        .filter((item) => item.field.type === "image"
            && item.generatedBinding?.presentation === "asset");
    if (new Set(imageContributions.map((item) =>
            `${item.generatedBinding.page ?? "workflow"}:${item.generatedBinding.slot}`)).size
            !== imageContributions.length) {
        throw new Error("Generated asset slots must be unique");
    }
    const checkout = await realpath(project);
    const specify = join(checkout, ".specify");
    const asset = async (item) => {
        if (!item || item.strategy !== "replace") throw new Error("Missing validated replace-only generated asset");
        const bytes = await readFrozenAsset(item, specify);
        return { name: item.name, kind: item.kind, sourceId: item.sourceId,
            hash: item.hash, content: bytes.toString("base64") };
    };
    const selectedBadges = Array.isArray(badges) ? badges : badges?.instances ?? [];
    const selectedRules = new Set();
    for (const badge of selectedBadges) {
        const type = model.badgeTypes?.find((entry) => entry.id === badge.type);
        if (!type) throw new Error(`Badge ${badge.id} references missing badge type ${badge.type}`);
        selectedRules.add(type.rule);
    }
    for (const ruleId of selectedRules) {
        const binding = model.badgeInputControls?.find((item) => item.rule === ruleId);
        if (!binding) throw new Error(`Missing Designer badge input control for rule ${ruleId}`);
        for (const [name, kind] of [[binding.binding, "designer.badge-input-binding"],
            [binding.definition, "designer.badge-input-control"],
            [binding.adapter, "designer.badge-input-adapter"]]) {
            const item = model.templates?.find((entry) => entry.name === name && entry.kind === kind);
            if (!item) throw new Error(`${name}: missing Designer badge input dependency`);
            await readFrozenAsset(item, specify);
        }
    }
    let definitions;
    const generatedControl = async (id) => {
        const controls = model.controls?.filter((entry) => entry.id === id) ?? [];
        definitions ??= Promise.all((model.templates ?? [])
            .filter((entry) => entry.kind === "shared.control-definition").map(async (entry) => {
                const bytes = await readFrozenAsset(entry, specify);
                let document;
                try { document = JSON.parse(bytes.toString("utf8")); }
                catch { throw new Error(`${entry.name}: invalid frozen control definition`); }
                return { entry, document };
            }));
        const matches = (await definitions).filter(({ document }) => document?.id === id);
        const control = controls[0];
        const adapter = model.templates?.find((entry) => entry.kind === "generated.control-adapter"
            && entry.name === control?.adapters?.generated);
        if (controls.length !== 1 || matches.length !== 1 || !adapter
            || matches[0].document.adapters?.generated !== adapter.name) {
            throw new Error(`Missing paired ${id} definition or generated adapter`);
        }
        return { control, definition: matches[0].entry, adapter };
    };
    let generatedImageControl;
    if (imageContributions.length) {
        const { control, definition, adapter } = await generatedControl("stock.image");
        if (imageContributions.some((item) => item.field.control !== control.id)) {
            throw new Error("Image contribution uses an incompatible shared control");
        }
        generatedImageControl = { control: control.id,
            assets: await Promise.all([definition, adapter].map(asset)) };
    }
    const generatedAssets = imageContributions.flatMap((item) => {
        const image = decodeImage(values[item.field.id]);
        return image ? [{ id: item.field.id, label: item.field.label,
            slot: item.generatedBinding.slot,
            ...(item.generatedBinding.page ? { page: item.generatedBinding.page } : {}),
            mime: image.mime, hash: createHash("sha256").update(image.bytes).digest("hex"),
            content: image.bytes.toString("base64") }] : [];
    });
    if (generatedAssets.length > 10) {
        throw new Error("Generated images exceed the 10-image limit");
    }
    const controlContributions = (model.contributions ?? [])
        .filter((item) => item.generatedBinding?.presentation === "control");
    if (controlContributions.length > 30) {
        throw new Error("Generated controls exceed the 30-control limit");
    }
    const generatedPages = [];
    let generatedTextControl;
    let generatedTextPlacements;
    if (textContributions.length) {
        generatedTextPlacements = textContributions.map((item) => ({
            id: item.field.id, label: item.field.label,
            presentation: item.generatedBinding.presentation,
            slot: item.generatedBinding.slot ?? "details.content",
        }));
        const visual = generatedTextPlacements.filter((item) => item.presentation === "text");
        if (generatedTextPlacements.length > 100
            || new Set(generatedTextPlacements.map((item) => item.id)).size
                !== generatedTextPlacements.length
            || new Set(visual.map((item) => item.slot)).size !== visual.length
            || generatedTextPlacements.some((item) => item.presentation === "text"
                ? !((item.id === "canvas.description" && item.slot === "workflow.description")
                    || (item.id === "canvas.workflowListName" && item.slot === "workflow.heading"))
                : item.slot !== "details.content")) {
            throw new Error("Invalid or duplicate generated stock.text placement");
        }
        const { control, definition, adapter } = await generatedControl("stock.text");
        generatedTextControl = { control: control.id,
            assets: await Promise.all([definition, adapter].map(asset)) };
    }
    for (const page of model.generatedPages ?? []) {
        const definition = model.templates.find((item) => item.name === page.name
            && item.kind === "generated.added-page-definition");
        const renderer = model.templates.find((item) => item.name === page.renderer
            && item.kind === "generated.added-page-renderer");
        if (!definition || !renderer) throw new Error(`${page.name}: missing validated generated page assets`);
        const assets = await Promise.all([definition, renderer].map(asset));
        generatedPages.push({ id: page.id, title: page.title,
            ...(page.order !== undefined ? { order: page.order } : {}),
            renderer: page.renderer,
            ...(page.values ? { values: page.values } : {}),
            ...(page.slots ? { slots: page.slots } : {}), assets });
    }
    const defaultPageOrder = new Map(generatedPages.map((page, index) => [page.id, index + 1]));
    generatedPages.sort((a, b) => (a.order ?? defaultPageOrder.get(a.id))
        - (b.order ?? defaultPageOrder.get(b.id)) || a.id.localeCompare(b.id));
    const workflowDefinition = model.templates?.find((item) =>
        item.name === model.workflowPage?.name && item.kind === "generated.workflow-page-definition");
    const workflowAdapter = model.workflowPage?.adapter && model.templates?.find((item) =>
        item.name === model.workflowPage.adapter && item.kind === "generated.workflow-page-adapter");
    const controlDefinition = model.templates?.find((item) =>
        item.name === "generated-phase-control" && item.kind === "generated.phase-control-definition");
    const controlBytes = controlDefinition && await readFrozenAsset(controlDefinition, specify);
    let phaseControl;
    try { phaseControl = controlBytes && JSON.parse(controlBytes.toString("utf8")); }
    catch { throw new Error("Invalid frozen phase control definition"); }
    const adapter = model.templates?.find((item) =>
        item.name === phaseControl?.adapter && item.kind === "generated.phase-control-adapter");
    if (!workflowDefinition || (model.workflowPage?.adapter && !workflowAdapter)
        || !controlDefinition || !adapter
        || phaseControl?.id !== "workflow-phases"
        || phaseControl?.placement?.page !== "workflow"
        || phaseControl?.placement?.slot !== "workflow.phases"
        || Object.keys(phaseControl.viewLabels ?? {}).some((id) =>
            !handoff.workflow.selectedPhases.includes(id)
            || id.replace(/^speckit\./, "") === "constitution")) {
        throw new Error("Missing validated Workflow page, phase control, or adapter");
    }
    const workflowPage = { id: "workflow", title: model.workflowPage.title,
        order: model.workflowPage.order, slots: model.workflowPage.slots,
        managedRun: model.workflowPage.managedRun,
        assets: await Promise.all([workflowDefinition, controlDefinition, adapter,
            ...(workflowAdapter ? [workflowAdapter] : [])].map(asset)) };
    const namedTemplate = (name, kind) => {
        const match = model.templates?.find((item) => item.name === name && item.kind === kind);
        if (!match) throw new Error(`${name}: missing validated ${kind} asset`);
        return match;
    };
    const dialogDefinitions = await Promise.all((model.dialogDefinitions ?? []).map(async ({
        sourceId, $schema, ...dialog
    }) => ({ ...dialog, assets: await Promise.all([
        namedTemplate(dialog.name, "generated.dialog-definition"),
        namedTemplate(dialog.adapter, "generated.dialog-adapter"),
    ].map(asset)) })));
    const phaseDialogBindings = await Promise.all((model.phaseDialogBindings ?? []).map(async ({
        sourceId, $schema, ...binding
    }) => ({ ...binding, assets: [await asset(
        namedTemplate(binding.name, "generated.phase-dialog-binding"))] })));
    const buttonPlacements = await Promise.all((model.buttonPlacements ?? []).map(async ({
        sourceId, $schema, ...placement
    }) => ({ ...placement, assets: [await asset(
        namedTemplate(placement.name, "generated.button-placement"))] })));
    const buttonControls = await Promise.all((model.buttonControls ?? []).map(async ({
        $schema, ...definition
    }) => ({ ...definition, assets: await Promise.all([
        namedTemplate(definition.name, "generated.button-control-definition"),
        namedTemplate(definition.adapter, "generated.button-adapter"),
    ].map(asset)) })));
    const instances = badges === undefined ? [] : Array.isArray(badges)
        ? badges : badges?.instances;
    if (!Array.isArray(instances) || instances.length > 100) {
        throw new Error("Badges must be a list of at most 100 configured instances");
    }
    let frozenBadges;
    if (instances.length) {
        const workflowSlots = new Set(model.workflowPage.slots.map((slot) => slot.id));
        const destinations = new Set(model.workflowPage.badgeDestinations
            ?? ["workflow.list", "workflow.summary", "phase.card", "phase.output"]);
        const locations = { "workflow-list": "workflow.list",
            "workflow-summary": "workflow.summary", "phase-card": "phase.card",
            "phase-output": "phase.output" };
        const projectPhase = (phase) => typeof phase === "string"
            && phase.replace(/^speckit\./, "") === "constitution";
        const requestedDestinations = new Set();
        const phaseSlots = new Set();
        let hasWorkflowTargets = false;
        let hasProjectTargets = false;
        for (const badge of instances) {
            for (const place of badge.showIn ?? []) requestedDestinations.add(locations[place]);
            if (badge.showIn?.includes("phase-card") && !projectPhase(badge.phase))
                phaseSlots.add("phase.card");
            else if (badge.showIn?.includes("phase-card") && projectPhase(badge.phase))
                hasProjectTargets = true;
            for (const target of badge.targets ?? []) {
                const slot = target.output === null ? "phase.card" : "phase.output";
                requestedDestinations.add(slot);
                if (projectPhase(target.phase)) {
                    hasProjectTargets = true;
                    continue;
                }
                phaseSlots.add(slot);
                hasWorkflowTargets = true;
            }
        }
        if ([...requestedDestinations].some((id) => !destinations.has(id))) {
            throw new Error("Selected badge placement is unsupported by the Workflow page adapter");
        }
        if ([...requestedDestinations].some((id) => id.startsWith("workflow.")
            && !workflowSlots.has(id))
            || [...phaseSlots].some((id) => !phaseControl.slots?.some((slot) => slot.id === id))) {
            throw new Error("Selected badge placement has no declared Workflow or phase control slot");
        }
        if (hasProjectTargets && workflowAdapter) {
            const pageSource = Buffer.from(workflowPage.assets[3].content, "base64").toString("utf8");
            if (!/^export const capabilities = \["workflow\.badges\.project\.v1"\];(?:\r?\n|$)/
                .test(pageSource)) {
                throw new Error(`${workflowAdapter.name} does not support project badges; use a project-badge-capable Workflow page adapter or remove the project placement`);
            }
        }
        const types = [...new Set(instances.map((instance) => instance.type))].map((id) => {
            const type = model.badgeTypes?.find((item) => item.id === id && item.enabled);
            if (!type) throw new Error(`Badge type ${id} is unavailable or disabled`);
            return type;
        });
        const rules = [...new Set(types.map((type) => type.rule))].map((id) => {
            const rule = model.badgeRules?.find((item) => item.id === id);
            if (!rule) throw new Error(`Badge rule ${id} is unavailable`);
            return rule;
        });
        const phaseIds = handoff.workflow.selectedPhases;
        const projectPhaseId = phaseIds.find((phase) => projectPhase(phase));
        const source = (artifact) => artifact && phaseIds.includes(artifact.phase)
            && typeof artifact.output === "string"
            && outputs?.[artifact.phase]?.outputs?.includes(artifact.output);
        const ids = new Set();
        const checked = [];
        for (const instance of instances) {
            const type = types.find((item) => item.id === instance.type);
            const rule = rules.find((item) => item.id === type.rule);
            if (typeof instance.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(instance.id)
                || ids.has(instance.id) || !validBadgeEvidence(instance, rule, phaseIds, source)
                || !instance.inputs || typeof instance.inputs !== "object"
                || Object.keys(instance.inputs).length !== rule.inputs.length
                || rule.inputs.some(({ id, type: inputType }) => {
                    const value = instance.inputs[id];
                    if (inputType === "artifact") return !source(value);
                    if (inputType === "phase") return !phaseIds.includes(value);
                    if (inputType === "text") return typeof value !== "string" || !value.trim()
                        || value.length > 256 || /[\x00-\x1f\x7f]/.test(value);
                    if (inputType === "badge-selection") return !Array.isArray(instance.showIn)
                        || !validBadgeSelections(value, badgePlacements(instance));
                    if (inputType === "ordered-artifacts") return !Array.isArray(value)
                        || value.length > 100 || value.length < (rule.inputs.find((input) =>
                            input.id === id)?.minItems ?? 0)
                        || value.some((entry) => !source(entry));
                    return inputType !== "artifact-set" || !Array.isArray(value)
                        || !value.length || value.length > 100
                        || value.some((item) => !phaseIds.includes(item?.phase)
                            || !Array.isArray(item.outputs) || !item.outputs.length
                            || item.outputs.length > 100
                            || item.outputs.some((output) =>
                                !source({ phase: item.phase, output })));
                })
                || !validBadgeCategory(instance.category)
                || (rule.inputs.some((input) => input.type === "badge-selection")
                    ? ["text", "phaseText", "summaryText"].some((key) => Object.hasOwn(instance, key))
                    : !validPlacementTexts(instance, badgePlacements(instance),
                        (rule.textPlaceholders ?? []).map((token) =>
                            typeof token === "string" ? token : token.id)))
                || typeof instance.color !== "string"
                || !/^(?:theme|red|green|amber|blue|purple|pink|orange|#[0-9a-fA-F]{6})$/.test(instance.color)
                || !Array.isArray(instance.showIn)
                || new Set(instance.showIn).size !== instance.showIn.length
                || instance.showIn.some((place) =>
                    !["workflow-list", "workflow-summary", "phase-card"].includes(place))
                || (instance.targets === undefined
                    ? (instance.showIn.includes("phase-card")
                        && !phaseIds.includes(instance.phase))
                        || (!instance.showIn.includes("phase-card") && instance.phase != null)
                    : instance.phase != null || instance.showIn.includes("phase-card")
                        || !Array.isArray(instance.targets) || instance.targets.length > 100
                        || new Set(instance.targets.map((target) =>
                            JSON.stringify([target?.phase, target?.output]))).size !== instance.targets.length
                        || instance.targets.some((target) => !target
                            || !phaseIds.includes(target.phase)
                            || (target.output !== null
                                && (!rule.inputs.some((input) =>
                                    ["artifact", "artifact-set"].includes(input.type))
                                    || !source(target)))))) {
                throw new Error(`Badge ${instance?.id ?? "unknown"} has an invalid or removed output, phase, text, or placement; edit it on the Badges page before Generate`);
            }
            if (projectPhaseId && (instance.targets?.some((target) => target.phase === projectPhaseId)
                || instance.showIn.includes("phase-card") && instance.phase === projectPhaseId)
                && rule.inputs.some(({ id, type: inputType }) => {
                    const value = instance.inputs[id];
                    return !["text", "badge-selection"].includes(inputType) && (inputType === "phase"
                        ? value !== projectPhaseId
                        : Array.isArray(value) ? value.some((entry) => entry.phase !== projectPhaseId)
                            : value.phase !== projectPhaseId);
                })) {
                throw new Error(`Badge ${instance.id} has a project placement with workflow rule inputs; choose project evidence or a workflow placement`);
            }
            ids.add(instance.id);
            const duplicate = findDuplicateBadge(instance, checked, rule);
            if (duplicate) {
                throw new Error(`Badge ${instance.id} duplicates phase/output target of ${duplicate.id}; edit the existing badge before Generate`);
            }
            checked.push(instance);
        }
        const adapters = [...new Set(rules.map((rule) => rule.adapter))];
        const adapterAssets = await Promise.all(adapters.map(async (name) => {
            const entry = model.templates?.find((item) =>
                item.kind === "generated.badge-rule-adapter" && item.name === name);
            if (!entry) throw new Error(`Missing badge evaluator ${name}`);
            return asset(entry);
        }));
        if (phaseSlots.size) {
            const module = await import(`data:text/javascript;base64,${workflowPage.assets[2].content}`);
            if (!Array.isArray(module.capabilities)
                || !module.capabilities.includes("workflow.badges.v1")) {
                throw new Error(`${adapter.name} does not support phase-card badges; use a badge-capable phase adapter or deselect Phase card`);
            }
            if (hasWorkflowTargets
                && !module.capabilities.includes("workflow.badges.targets.v1")) {
                throw new Error(`${adapter.name} does not support phase/output badge targets; use a target-capable phase adapter or deselect phase/output placements`);
            }
        }
        frozenBadges = {
            instances: structuredClone(instances),
            settings: await (async () => {
                const entry = model.templates?.find((item) =>
                    item.kind === "designer.badges-settings-definition" && item.name === "badges-settings");
                if (!entry) throw new Error("Missing badges-settings definition");
                return asset(entry);
            })(),
            types,
            rules: await Promise.all(rules.map(async (rule) => {
                const entry = model.templates?.find((item) =>
                    item.kind === "generated.badge-rule-definition" && item.name === rule.name);
                if (!entry) throw new Error(`Missing badge rule definition ${rule.id}`);
                return { ...rule, assets: [await asset(entry)] };
            })),
            adapters: adapterAssets,
        };
    }
    const designerFields = new Map();
    const fieldPlacements = await Promise.all((model.fieldPlacements ?? []).map(async (placement) => {
        const definition = model.templates.find((item) => item.name === placement.name
            && item.kind === "generated.field-placement");
        if (!definition) throw new Error(`${placement.name}: missing validated field placement`);
        const field = model.pages.flatMap((page) => page.fields ?? [])
            .find((candidate) => candidate.id === placement.field);
        const value = model.valueSources?.find((candidate) => candidate.id === placement.field);
        if (!field && !value) throw new Error(`${placement.name}: missing resolved field`);
        if (field) {
            designerFields.set(field.id, { id: field.id, label: field.label,
                control: field.control });
        }
        return { id: placement.id, page: placement.page, slot: placement.slot,
            field: placement.field, label: (field ?? value).label,
            order: placement.order, control: placement.control,
            assets: [await asset(definition)] };
    }));
    const valueSources = [];
    for (const value of model.valueSources ?? []) {
        const definition = model.templates.find((entry) => entry.name === value.name
            && entry.kind === "generated.value-definition");
        if (!definition) throw new Error(`${value.name}: missing validated value definition`);
        const provider = value.source.kind === "computed"
            ? model.templates.find((entry) => entry.name === value.source.module
                && entry.kind === "generated.computed-value-provider") : null;
        if (value.source.kind === "computed" && !provider) {
            throw new Error(`${value.name}: missing validated value provider`);
        }
        valueSources.push({ id: value.id, label: value.label, schema: value.schema,
            source: value.source, presentation: value.presentation,
            ...(value.section ? { section: value.section } : {}),
            assets: await Promise.all([definition, ...(provider ? [provider] : [])].map(asset)) });
    }
    const generatedFields = [];
    const generatedControls = [];
    const controlAssets = new Map();
    for (const contribution of model.contributions ?? []) {
        const binding = contribution.generatedBinding;
        if (!binding) continue;
        const { id, label } = contribution.field;
        const rule = model.constraints[id];
        if (binding.presentation === "stock.readonly") {
            if (["canvas.description", "canvas.workflowListName"].includes(id)) continue;
            if (rule?.type !== "string") {
                throw new Error(`${id}: generated stock field requires a string constraint`);
            }
            generatedFields.push({ id, label, maxLength: rule.maxLength,
                ...(binding.section ? { section: binding.section } : {}) });
            continue;
        }
        if (binding.presentation === "text" || binding.presentation === "asset") continue;
        if (binding.presentation !== "control" || rule?.type !== "object") {
            throw new Error(`${id}: incompatible generated binding`);
        }
        if (generatedControls.length >= 30) {
            throw new Error("Generated controls exceed the 30-control limit");
        }
        const control = model.controls.find((entry) => entry.id === contribution.field.control);
        if (!control) throw new Error(`${contribution.name}: missing shared control`);
        const definition = model.templates.find((entry) => entry.name === control.template
            && entry.kind === "shared.control-definition");
        if (!definition || (contribution.requires !== undefined
            && (contribution.requires.length !== 1
                || contribution.requires[0] !== definition.name))) {
            throw new Error(`${contribution.name}: missing matching shared control definition`);
        }
        if (!controlAssets.has(control.id)) {
            const paired = await generatedControl(control.id);
            if (paired.definition.name !== definition.name) {
                throw new Error(`${contribution.name}: mismatched shared control definition`);
            }
            controlAssets.set(control.id, { control: control.id,
                assets: await Promise.all([paired.definition, paired.adapter].map(asset)) });
        }
        generatedControls.push({ id, label, control: control.id, slot: binding.slot,
            value: essentials[id] });
    }
    for (const placement of model.fieldPlacements ?? []) {
        if (model.controls.find((control) => control.id === placement.control)?.value.type !== "object"
            || controlAssets.has(placement.control)) continue;
        const paired = await generatedControl(placement.control);
        controlAssets.set(placement.control, { control: placement.control,
            assets: await Promise.all([paired.definition, paired.adapter].map(asset)) });
    }
    if (!handoff?.workflow?.installed) throw new Error("Workflow runtime inventory is not available in this handoff");
    const target = join(checkout, ".github", "extensions", essentials["canvas.id"]);
    if (!replaceExisting && await canvasOutputExists(checkout, essentials["canvas.id"])) {
        throw new Error(`Canvas already exists: ${target}`);
    }
    const actual = runtimeInventory === undefined ? undefined
        : reconcileInstalledVersions(handoff.workflow.installed, runtimeInventory);
    const requestId = randomUUID();
    const request = {
        schemaVersion: 1, requestId, handoffId: handoff.handoffId,
        project: checkout, target: `.github/extensions/${essentials["canvas.id"]}/`,
        sourceFingerprint: handoff.sourceFingerprint, settingsRevision: model.settingsRevision,
        canvas: { id: essentials["canvas.id"], displayName: essentials["canvas.displayName"],
            description: essentials["canvas.description"] || "Spec Kit workflow canvas.",
            workflowListName: essentials["canvas.workflowListName"] || "Workflows",
            workflowItemName: essentials["canvas.workflowItemName"] || "Workflow" },
        workflow: { selectedPhases: handoff.workflow.selectedPhases,
            ...(handoff.workflow.phaseDescriptions !== undefined
                ? { phaseDescriptions: handoff.workflow.phaseDescriptions } : {}),
            ...(outputs !== undefined ? { phaseArtifacts: outputs } : {}) },
        installed: handoff.workflow.installed,
        ...(handoff.workflow.runtimeSetup ? { runtimeSetup: handoff.workflow.runtimeSetup } : {}),
        ...(actual ? { actualInstalled: actual.installed } : {}),
        values: essentials,
        fieldConstraints: model.constraints,
        ...(generatedFields.length ? { generatedFields } : {}),
        ...(generatedPages.length ? { generatedPages } : {}),
        workflowPage,
        ...(dialogDefinitions.length ? { dialogDefinitions } : {}),
        ...(phaseDialogBindings.length ? { phaseDialogBindings } : {}),
        ...(buttonControls.length ? { buttonControls } : {}),
        ...(buttonPlacements.length ? { buttonPlacements } : {}),
        ...(fieldPlacements.length ? { fieldPlacements } : {}),
        ...(designerFields.size ? { designerFields: [...designerFields.values()] } : {}),
        ...(generatedControls.length ? { generatedControls } : {}),
        ...(generatedAssets.length ? { generatedAssets } : {}),
        ...(generatedImageControl ? { generatedImageControl } : {}),
        ...(generatedTextControl ? { generatedTextControl, generatedTextPlacements } : {}),
        ...(valueSources.length ? { valueSources } : {}),
        ...(controlAssets.size ? { controlAssets: [...controlAssets.values()] } : {}),
        ...(frozenBadges ? { badges: frozenBadges } : {}),
    };
    const serialized = serializeGenerationRequest(request);
    const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId,
        "generations", requestId);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "request.json"), serialized, { flag: "wx" });
    return { requestId, target: request.target,
        ...((inventoryWarning || actual?.warnings.length)
            ? { warnings: [inventoryWarning, ...(actual?.warnings ?? [])].filter(Boolean) } : {}) };
}
