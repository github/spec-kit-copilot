import { createHash, timingSafeEqual } from "node:crypto";

export const HANDOFF_LIMIT = 64 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const KINDS = ["presets", "extensions", "bundles"];
// Local development sources: no bundles (plan explicitly excludes local
// bundles), and the path is a user-typed absolute directory rather than a
// catalog download URL.
const LOCAL_KINDS = ["presets", "extensions"];
const LOCAL_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)[^\x00-\x1f]{0,4094}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const CONSTITUTION_OUTPUT = ".specify/memory/constitution.md";

export function fixedConstitutionOutputs(outputs, phases) {
    const id = phases.find((phase) => phase.replace(/^speckit\./, "") === "constitution");
    return id ? { ...outputs, [id]: { outputs: [CONSTITUTION_OUTPUT], view: CONSTITUTION_OUTPUT } }
        : outputs;
}

export function validateConfirmedOutputs(outputs, phases, pipelineOutputs) {
    validatePhaseOutputs(outputs, phases, true);
    const id = phases.find((phase) => phase.replace(/^speckit\./, "") === "constitution");
    if (id && (outputs[id].outputs.length !== 1
        || outputs[id].outputs[0] !== CONSTITUTION_OUTPUT
        || outputs[id].view !== CONSTITUTION_OUTPUT)) {
        throw new Error("Constitution output is fixed");
    }
    if (pipelineOutputs && phases.some((phase) => pipelineOutputs[phase]?.outputs.some(
        (path, index) => outputs[phase].outputs[index] !== path))) {
        throw new Error("Pipeline artifacts cannot be changed");
    }
    if (pipelineOutputs && phases.some((phase) =>
        pipelineOutputs[phase]?.view !== null && outputs[phase].view === null)) {
        throw new Error("Pipeline viewer defaults cannot be removed");
    }
    return outputs;
}

export function validatePhaseOutputs(value, phases, allowUnviewed = false) {
    if (!record(value) || Object.keys(value).length !== phases.length
        || Object.keys(value).some((id) => !phases.includes(id))) {
        throw new Error("Invalid Designer phase outputs");
    }
    for (const [id, entry] of Object.entries(value)) {
        if (!record(entry) || Object.keys(entry).sort().join() !== "outputs,view"
            || !Array.isArray(entry.outputs) || entry.outputs.length > 100
            || entry.outputs.some((path) => typeof path !== "string"
                || path.length > 1000 || !path.endsWith(".md")
                || !/^(?!\.git(?:\/|$)|\.github(?:\/|$)|node_modules(?:\/|$)|\.speckit-canvas(?:\/|$)|\.speckit-wizard(?:\/|$)|\.specify\/(?:extensions|presets|templates)\/)[^\\\x00-\x1f\x7f]+$/i.test(path)
                || path.split("/").some((part) => !part || part === "." || part === ".."
                    || /[. ]$/.test(part) || (part !== "<slug>" && /[<>:"|?*]/.test(part))
                    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
                || path.split("/").filter((part) => part === "<slug>").length > 1
                || path.startsWith("<slug>/"))
            || new Set(entry.outputs.map((path) => path.toLowerCase())).size !== entry.outputs.length
            || (entry.view !== null && !entry.outputs.includes(entry.view))
            || (entry.view === null && entry.outputs.length > 0 && !allowUnviewed)) {
            throw new Error(`Invalid outputs for phase ${id}`);
        }
    }
    return value;
}

// `localSelections` is an optional, additive top-level handoff key. Absent
// entirely (the hosted-catalog-only path) is valid and leaves the handoff
// byte-identical to the pre-local-dev schema.
function validLocalSelections(value) {
    if (value === undefined) return true;
    if (!record(value) || Object.keys(value).some((kind) => !LOCAL_KINDS.includes(kind))) return false;
    // A kind with no local selections is omitted entirely (not sent as an
    // empty array) to keep the handoff minimal; treat an absent kind as an
    // empty list rather than requiring every kind key to be present.
    return LOCAL_KINDS.every((kind) => {
        const list = kind in value ? value[kind] : [];
        if (!Array.isArray(list) || list.length > 20) return false;
        const seen = new Set();
        return list.every((item) => {
            if (!record(item) || Object.keys(item).some((key) =>
                !["id", "source", "approved", "path", "version"].includes(key))) return false;
            if (typeof item.id !== "string" || !PACKAGE.test(item.id)) return false;
            if (item.source !== "local" || item.approved !== true) return false;
            if (typeof item.path !== "string" || !LOCAL_PATH.test(item.path)) return false;
            if (item.version !== undefined && item.version !== null
                && (typeof item.version !== "string" || !item.version || item.version.length > 64)) return false;
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });
    });
}

function safeUrl(value) {
    if (value === null) return true;
    if (typeof value !== "string" || value.length > 2048 || /[\s\x00-\x1f\x7f<>]/.test(value)) {
        return false;
    }
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
    } catch { return false; }
}

function validInstallLocators(workflow) {
    if (workflow.installLocators === undefined) return true;
    if (!record(workflow.installLocators)
        || KINDS.some((kind) => !Array.isArray(workflow.installLocators[kind])
            || workflow.installLocators[kind].length !== workflow.installed[kind].length)) return false;
    return KINDS.every((kind) => {
        const expected = new Set(workflow.installed[kind].map((item) => item.id));
        return workflow.installLocators[kind].every((item) => {
            if (!record(item) || !expected.delete(item.installedId)
                || typeof item.installedId !== "string" || !PACKAGE.test(item.installedId)) return false;
            if (item.source === "local") {
                return kind !== "bundles"
                    && Object.keys(item).sort().join() === "installedId,path,source"
                    && typeof item.path === "string" && LOCAL_PATH.test(item.path);
            }
            if (item.source === "bundle") {
                return kind !== "bundles"
                    && Object.keys(item).sort().join() === "bundleId,installedId,source"
                    && typeof item.bundleId === "string" && PACKAGE.test(item.bundleId)
                    && workflow.installed.bundles.some((bundle) => bundle.id === item.bundleId);
            }
            return typeof item.source === "string" && PACKAGE.test(item.source)
                && typeof item.catalogId === "string" && PACKAGE.test(item.catalogId)
                && Object.keys(item).every((key) =>
                    ["installedId", "source", "catalogId", "downloadUrl", "bundleYml"].includes(key))
                && (item.downloadUrl === null || safeUrl(item.downloadUrl))
                && item.downloadUrl !== undefined
                && (item.bundleYml === undefined || (kind === "bundles"
                    && typeof item.bundleYml === "string" && item.bundleYml.length > 0
                    && item.bundleYml.length <= 16384));
        }) && !expected.size;
    });
}

function validRuntimeSetup(workflow) {
    const setup = workflow.runtimeSetup;
    if (setup === undefined) return true;
    if (!workflow.installLocators || !record(setup)
        || Object.keys(setup).sort().join() !== "bundles,extensions,presets"
        || !Array.isArray(setup.bundles)
        || setup.bundles.length !== 0) return false;
    return LOCAL_KINDS.every((kind) => {
        if (!Array.isArray(setup[kind]) || setup[kind].length > workflow.installed[kind].length) {
            return false;
        }
        const seen = new Set();
        return setup[kind].every((entry) => {
            if (!record(entry) || seen.has(entry.id)
                || entry.id === "extension-canvas-design"
                || Object.keys(entry).sort().join() !== "enabled,id,locator,priority,version"
                || !record(entry.locator)) return false;
            seen.add(entry.id);
            const installed = workflow.installed[kind].find((item) => item.id === entry.id);
            const locator = workflow.installLocators[kind].find((item) =>
                item.installedId === entry.id);
            if (!installed || !locator || installed.version !== entry.version
                || installed.enabled !== entry.enabled || installed.priority !== entry.priority
                || (entry.locator.source === "local" && installed.source === "local"
                    && installed.path !== entry.locator.path)) {
                return false;
            }
            return JSON.stringify(entry.locator) === JSON.stringify(locator);
        });
    });
}

export function validateHandoffId(id) {
    if (typeof id !== "string" || !ID.test(id)) throw new Error("Invalid Designer handoff ID");
    return id;
}

export function fingerprint(data) {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function validateHandoff(handoff, id) {
    validateHandoffId(id);
    if (!record(handoff)
        || Object.keys(handoff).some((key) =>
            !["schemaVersion", "handoffId", "workflow", "selections", "sourceFingerprint", "localSelections", "canvasDesign"]
                .includes(key))
        || handoff.schemaVersion !== 1 || handoff.handoffId !== id
        || !record(handoff.workflow)
        || Object.keys(handoff.workflow).some((key) =>
            !["selectedPhases", "phaseDescriptions", "outputEvidence", "installed", "installLocators", "runtimeSetup"].includes(key))
        || !Array.isArray(handoff.workflow.selectedPhases)
        || handoff.workflow.selectedPhases.length > 30
        || !handoff.workflow.selectedPhases.every((phase) => typeof phase === "string" && PACKAGE.test(phase))
        || (handoff.workflow.phaseDescriptions !== undefined
            && (!record(handoff.workflow.phaseDescriptions)
                || Object.entries(handoff.workflow.phaseDescriptions).some(([phase, description]) =>
                    !handoff.workflow.selectedPhases.includes(phase)
                    || typeof description !== "string" || !description.trim()
                    || description.length > 240)))
        || (handoff.workflow.installed !== undefined
            && (!record(handoff.workflow.installed)
                || KINDS.some((kind) => !Array.isArray(handoff.workflow.installed[kind])
                    || handoff.workflow.installed[kind].length > 40
                    || handoff.workflow.installed[kind].some((item) => !record(item)
                        || Object.keys(item).some((key) =>
                            !["id", "version", "source", "priority", "enabled",
                                "path", "downloadUrl", "catalogId"].includes(key))
                        || typeof item.id !== "string" || !PACKAGE.test(item.id)
                        || (kind !== "bundles"
                            && (!Number.isSafeInteger(item.priority)
                                || (handoff.workflow.installLocators !== undefined
                                    && typeof item.enabled !== "boolean")
                                || (item.enabled !== undefined
                                    && typeof item.enabled !== "boolean")))
                        || (kind === "bundles"
                            && (item.priority !== undefined || item.enabled !== undefined))
                        || (item.catalogId !== undefined
                            && (kind !== "bundles" || item.source !== "default"
                                || typeof item.catalogId !== "string" || !PACKAGE.test(item.catalogId)))
                        || (item.source !== undefined
                            && (typeof item.source !== "string" || !PACKAGE.test(item.source)))
                        || (item.path !== undefined
                            && (kind === "bundles" || item.source === undefined || !LOCAL_PATH.test(item.path)
                                || item.downloadUrl !== undefined))
                        || (item.downloadUrl !== undefined
                            && (item.source === "local" || item.path !== undefined
                                || (item.downloadUrl === null
                                    ? kind !== "bundles" || item.source !== "default"
                                    : typeof item.downloadUrl !== "string" || !safeUrl(item.downloadUrl))))
                        || typeof item.version !== "string" || !item.version || item.version.length > 64))))
        || (handoff.workflow.installLocators !== undefined
            && (!handoff.workflow.installed || !validInstallLocators(handoff.workflow)))
        || !record(handoff.selections)
        || Object.keys(handoff.selections).some((kind) => !KINDS.includes(kind))
        || KINDS.some((kind) => !Array.isArray(handoff.selections[kind])
            || handoff.selections[kind].length > 40
            || new Set(handoff.selections[kind].map((item) =>
                `${item?.source}:${item?.id}`)).size !== handoff.selections[kind].length
            || !handoff.selections[kind].every((item) => record(item)
                && Object.keys(item).every((key) =>
                    ["id", "source", "approved", "version", "downloadUrl"].includes(key))
                && typeof item.id === "string" && PACKAGE.test(item.id)
                && typeof item.source === "string" && PACKAGE.test(item.source)
                && item.approved === true
                && (item.version === null || (typeof item.version === "string"
                    && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(item.version)))
                && safeUrl(item.downloadUrl)))
        || !validLocalSelections(handoff.localSelections)
        || (handoff.canvasDesign !== undefined
            && (!record(handoff.canvasDesign)
                || Object.keys(handoff.canvasDesign).sort().join() !== "downloadUrl,version"
                || typeof handoff.canvasDesign.version !== "string"
                || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(handoff.canvasDesign.version)
                || !safeUrl(handoff.canvasDesign.downloadUrl)
                || handoff.canvasDesign.downloadUrl === null))
        || typeof handoff.sourceFingerprint !== "string"
        || !/^[a-f0-9]{64}$/.test(handoff.sourceFingerprint)
        || Buffer.byteLength(JSON.stringify(handoff)) > HANDOFF_LIMIT) {
        throw new Error("Invalid Designer handoff");
    }
    const expected = Buffer.from(fingerprint({
        workflow: handoff.workflow, selections: handoff.selections, localSelections: handoff.localSelections,
        ...(handoff.canvasDesign !== undefined ? { canvasDesign: handoff.canvasDesign } : {}),
    }), "hex");
    if (!timingSafeEqual(expected, Buffer.from(handoff.sourceFingerprint, "hex"))) {
        throw new Error("Designer handoff fingerprint mismatch");
    }
    if (handoff.workflow.outputEvidence !== undefined) {
        validatePhaseOutputs(handoff.workflow.outputEvidence, handoff.workflow.selectedPhases);
    }
    if (!validRuntimeSetup(handoff.workflow)) throw new Error("Invalid Designer handoff");
    return handoff;
}
