// Validate generated-canvas names and workspace-relative destination paths.
import { relative, resolve, sep } from "node:path";
import { validateResultLabels } from "./generated-canvas-template/workflow-adapter.mjs";

const EXTENSION_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PROTECTED_EXTENSION_IDS = new Set(["speckit-wizard", "speckit-wizard-canvas"]);

export function validateGenerationMetadata(input) {
    const extensionId = typeof input?.extensionId === "string" ? input.extensionId.trim().toLowerCase() : "";
    const displayName = typeof input?.displayName === "string" ? input.displayName.trim() : "";
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    const workflowListName = input?.workflowListName === undefined ? "Workflows"
        : typeof input.workflowListName === "string" ? input.workflowListName.trim() : "";
    const errors = [];
    const warnings = [];
    const clarificationTag = input?.clarificationTag === undefined ? true : input.clarificationTag;
    if (typeof clarificationTag !== "boolean") {
        errors.push({ code: "clarification_tag_invalid", field: "clarificationTag", message: "Needs clarification tag must be enabled or disabled." });
    }
    let resultLabels = [];
    try {
        const raw = input?.resultLabels;
        if (raw != null) {
            const normalized = Array.isArray(raw)
                ? raw.map((value) => typeof value === "string" ? value.trim() : value).filter((value) => value !== "")
                : raw;
            resultLabels = validateResultLabels(normalized);
        }
    } catch (error) {
        errors.push({ code: "result_labels_invalid", field: "resultLabels", message: error.message });
    }

    if (!EXTENSION_ID_RE.test(extensionId)) {
        errors.push({ code: "extension_id_invalid", field: "extensionId", message: "Extension ID must be 1-63 lowercase letters, numbers, or hyphens, and cannot start or end with a hyphen." });
    } else if (PROTECTED_EXTENSION_IDS.has(extensionId)) {
        errors.push({ code: "extension_id_protected", field: "extensionId", message: "Choose a different extension ID; the Spec Kit Wizard extension is protected." });
    }
    if (!displayName || displayName.length > 80) {
        errors.push({ code: "display_name_invalid", field: "displayName", message: "Name must be between 1 and 80 characters." });
    } else if (/\bgenerated\b/i.test(displayName)) {
        errors.push({ code: "display_name_generated", field: "displayName", message: "Name must describe the workflow and must not include “Generated”." });
    }
    if (!description || description.length > 240) {
        errors.push({ code: "description_invalid", field: "description", message: "Description must be between 1 and 240 characters." });
    }
    if (!workflowListName || workflowListName.length > 80 || /[\x00-\x1f\x7f\u2028\u2029]/.test(workflowListName)) {
        errors.push({ code: "workflow_list_name_invalid", field: "workflowListName", message: "Workflow header must be between 1 and 80 characters on a single line." });
    }
    if (description && !/[.!?]$/.test(description)) {
        warnings.push({ code: "description_sentence", field: "description", message: "Consider ending the description with punctuation." });
    }
    return { metadata: { extensionId, displayName, description, workflowListName, resultLabels, clarificationTag }, errors, warnings };
}

export function generationTarget(workspacePath, extensionId) {
    const extensionsRoot = resolve(workspacePath, ".github", "extensions");
    const directory = resolve(extensionsRoot, extensionId);
    const rel = relative(extensionsRoot, directory);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(sep)) {
        throw new Error("Generated extension target is outside the project extensions directory.");
    }
    return {
        directory,
        relativeDirectory: `.github/extensions/${extensionId}/`,
    };
}
