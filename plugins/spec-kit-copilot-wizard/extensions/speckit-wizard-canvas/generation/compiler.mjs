// Compile Wizard pipeline composition into a standalone workflow blueprint.
import {
    CORE_CAPABILITIES,
    canonicalArgumentGuidance,
    canonicalDescription,
    canonicalLabel,
    isCanonical,
} from "../pipeline/canonical.mjs";
import {
    effectivePipelinePhases,
    stripCommandsPrefix,
} from "../pipeline/effective-phases.mjs";
import { assessVisualizationApplicability } from "./applicability.mjs";
import { validateWorkflowPaths } from "./generated-canvas-template/workspace-files.mjs";
import { commandViews } from "./generated-canvas-template/ui/command-views.mjs";

export class BlueprintValidationError extends Error {
    constructor(errors) {
        super(errors.map((entry) => entry.message).join("; "));
        this.name = "BlueprintValidationError";
        this.code = "BLUEPRINT_INVALID";
        this.errors = errors;
    }
}

function commandLookup(snapshot) {
    const lookup = new Map();
    for (const command of snapshot?.commands ?? []) {
        for (const candidate of [command?.id, command?.commandName]) {
            const id = stripCommandsPrefix(candidate);
            if (typeof id !== "string" || !id) continue;
            lookup.set(id, command);
            if (id.startsWith("speckit.") && isCanonical(id.slice("speckit.".length))) {
                lookup.set(id.slice("speckit.".length), command);
            }
        }
    }
    return lookup;
}

function compositionCommand(snapshot, normalizedId) {
    return (snapshot?.composition?.artifacts ?? []).find((entry) => (
        entry?.kind === "command"
        && stripCommandsPrefix(entry.id) === normalizedId
    )) ?? null;
}

function normalizedCommandName(id, command) {
    const explicit = stripCommandsPrefix(command?.commandName);
    if (typeof explicit === "string" && explicit) {
        if (explicit.startsWith("speckit.")) return explicit;
        if (isCanonical(explicit)) return `speckit.${explicit}`;
        return explicit;
    }
    const normalized = stripCommandsPrefix(id);
    if (isCanonical(normalized)) return `speckit.${normalized}`;
    return normalized;
}

export function skillNameForCommand(commandName) {
    if (typeof commandName !== "string") return null;
    const normalized = commandName.trim().toLowerCase();
    if (!/^speckit(?:\.[a-z0-9][a-z0-9_-]*)+$/.test(normalized)) return null;
    return normalized.replace(/\./g, "-").replace(/_/g, "-");
}

function artifactFor(snapshot, originalId, normalizedId, command, allowCoreFallback = true) {
    return command?.artifactTemplatePath
        ?? snapshot?.phases?.[originalId]?.artifactTemplatePath
        ?? snapshot?.phases?.[`commands/${normalizedId}`]?.artifactTemplatePath
        ?? command?.artifact
        ?? command?.artifactPath
        ?? snapshot?.phases?.[originalId]?.artifactPath
        ?? snapshot?.phases?.[`commands/${normalizedId}`]?.artifactPath
        ?? (allowCoreFallback ? CORE_CAPABILITIES[`speckit.${normalizedId}`]?.writesTo : null)
        ?? null;
}

function sourceFor(snapshot, normalizedId, command, canonical) {
    const artifact = (snapshot?.composition?.artifacts ?? []).find((entry) => (
        entry?.id === `commands/${normalizedId}` || entry?.id === normalizedId
    ));
    const active = (artifact?.stack ?? []).find((layer) => layer?.active) ?? artifact?.stack?.[0] ?? null;
    if (active?.layer === "preset" || active?.layer === "extension") {
        return {
            kind: active.layer,
            id: active.extensionId ?? active.presetId ?? null,
            version: active.version ?? null,
            skillPath: active.sourcePath ?? null,
        };
    }
    const sourceText = String(command?.source ?? (canonical ? "core" : "extension"));
    const [kind, id] = sourceText.includes(":") ? sourceText.split(":", 2) : [sourceText, null];
    return {
        kind: kind || (canonical ? "core" : "extension"),
        id: id || null,
        version: null,
        skillPath: null,
    };
}

const CONTRIBUTION_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function catalogSource(item) {
    const sourceName = typeof item?.source === "string" ? item.source : null;
    const downloadUrl = typeof item?.downloadUrl === "string" && /^https:\/\//i.test(item.downloadUrl)
        ? item.downloadUrl
        : null;
    if (downloadUrl) {
        try {
            const parsed = new URL(downloadUrl);
            if (!parsed.hostname || parsed.username || parsed.password || /[\r\n]/.test(downloadUrl)) return null;
        } catch {
            return null;
        }
        return { name: sourceName ?? "default", url: downloadUrl, direct: true };
    }
    return null;
}

function contributionRecords(snapshot, kind, steps, errors, requireInstallationApproval) {
    const catalogItems = kind === "preset"
        ? snapshot?.catalog?.presets
        : snapshot?.catalog?.extensions;
    const compositionItems = kind === "preset"
        ? snapshot?.composition?.presets
        : snapshot?.composition?.extensions;
    const activeProviders = new Set(
        steps
            .filter((step) => step.source.kind === kind && step.source.id)
            .map((step) => step.source.id),
    );
    const compositionById = new Map(
        (Array.isArray(compositionItems) ? compositionItems : [])
            .filter((item) => item?.id)
            .map((item) => [String(item.id), item]),
    );
    const compositionOrder = new Map(
        (Array.isArray(compositionItems) ? compositionItems : [])
            .filter((item) => item?.id)
            .map((item, index) => [String(item.id), index]),
    );
    const records = new Map();
    for (const item of Array.isArray(catalogItems) ? catalogItems : []) {
        if (item?.active !== true) continue;
        const id = String(item.installedId ?? item.id ?? "");
        if (!CONTRIBUTION_ID_RE.test(id)) {
            errors.push({
                code: "setup_contribution_invalid",
                path: `catalog.${kind}s`,
                message: `Installed ${kind} "${id || "(missing id)"}" has no portable id.`,
            });
            continue;
        }
        const composed = compositionById.get(id) ?? compositionById.get(String(item.id ?? ""));
        const source = catalogSource(item);
        const priority = Number.isInteger(item.priority)
            ? item.priority
            : (Number.isInteger(composed?.priority) ? composed.priority : null);
        const precedence = Number.isInteger(item.cliOrder)
            ? item.cliOrder
            : (compositionOrder.get(id) ?? null);
        const sourceName = typeof item?.source === "string" ? item.source : null;
        const builtInSource = sourceName == null || sourceName === "default" || sourceName === "community";
        const invalidDownload = item.downloadUrl != null && item.downloadUrl !== "" && !source;
        if (invalidDownload || ((!builtInSource || (requireInstallationApproval && sourceName === "community")) && !source)) {
            errors.push({
                code: "setup_contribution_source_missing",
                path: `catalog.${kind}s`,
                message: `Installed ${kind} "${id}" from source "${sourceName ?? "default"}" has no portable HTTPS install URL.`,
            });
            continue;
        }
        records.set(id, {
            kind,
            id,
            enabled: typeof item.enabled === "boolean"
                ? item.enabled
                : (composed ? composed.enabled !== false : (activeProviders.has(id) ? true : null)),
            ...(priority !== null ? { priority } : {}),
            ...(precedence !== null ? { precedence } : {}),
            ...(source ? { source } : {}),
        });
    }
    for (const item of compositionById.values()) {
        const id = String(item.id ?? "");
        if (!CONTRIBUTION_ID_RE.test(id)) continue;
        if (!records.has(id)) {
            records.set(id, {
                kind,
                id,
                enabled: item.enabled !== false,
                ...(Number.isInteger(item.priority) ? { priority: item.priority } : {}),
                ...(compositionOrder.has(id) ? { precedence: compositionOrder.get(id) } : {}),
            });
        }
    }
    for (const id of activeProviders) {
        if (!CONTRIBUTION_ID_RE.test(id)) {
            errors.push({
                code: "setup_provider_invalid",
                message: `Selected ${kind} provider "${id}" has no portable id.`,
            });
            continue;
        }
        records.set(id, { ...(records.get(id) ?? { kind, id }), enabled: true });
    }
    return [...records.values()].sort((left, right) => {
        const leftOrder = Number.isInteger(left.precedence) ? left.precedence : Number.MAX_SAFE_INTEGER;
        const rightOrder = Number.isInteger(right.precedence) ? right.precedence : Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.id.localeCompare(right.id);
    });
}

function requiredSkills(steps, errors) {
    const records = new Map();
    for (const step of steps) {
        const provider = {
            kind: step.source.kind,
            id: step.source.id ?? null,
        };
        if (provider.kind !== "core" && !provider.id) {
            errors.push({
                code: "skill_provider_unknown",
                path: `pipeline[${step.index}]`,
                message: `Selected skill "${step.skillName}" has no identifiable ${provider.kind} provider.`,
            });
            continue;
        }
        if (!records.has(step.skillName)) {
            records.set(step.skillName, {
                name: step.skillName,
                invocation: step.invocation,
                commandName: step.commandName,
                provider,
            });
        }
    }
    return [...records.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function phaseHints(snapshot, originalId, normalizedId) {
    return snapshot?.phases?.[originalId]
        ?? snapshot?.phases?.[`commands/${normalizedId}`]
        ?? snapshot?.phases?.[normalizedId]
        ?? {};
}

function phaseLabel(value) {
    const label = String(value ?? "").trim();
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

const TRANSIENT_COMPLETION = new Set([
    "speckit.analyze",
    "speckit.implement",
    "speckit.taskstoissues",
]);

export function compileBlueprint(snapshot, metadata, options = {}) {
    const errors = [];
    const warnings = [];
    if (options.requireInstallationApproval !== undefined && typeof options.requireInstallationApproval !== "boolean") {
        errors.push({
            code: "installation_approval_invalid",
            path: "requireInstallationApproval",
            message: "Require installation approval must be a boolean.",
        });
    }
    const requireInstallationApproval = options.requireInstallationApproval === true;
    const phases = effectivePipelinePhases(snapshot);
    const lookup = commandLookup(snapshot);
    const steps = [];

    if (!phases.length) {
        errors.push({ code: "pipeline_empty", message: "The effective pipeline must contain at least one command." });
    }

    for (let index = 0; index < phases.length; index += 1) {
        const entry = phases[index];
        const originalId = entry?.id;
        const normalizedId = stripCommandsPrefix(originalId);
        if (typeof normalizedId !== "string" || !normalizedId) {
            errors.push({ code: "phase_id_invalid", path: `pipeline[${index}].id`, message: `Pipeline step ${index + 1} has no valid command id.` });
            continue;
        }
        const canonical = isCanonical(normalizedId);
        const command = lookup.get(normalizedId) ?? null;
        const composedCommand = compositionCommand(snapshot, normalizedId);
        if (!canonical && !command && !composedCommand) {
            errors.push({ code: "command_unknown", path: `pipeline[${index}].id`, message: `Pipeline command "${normalizedId}" is not present in the snapshot command registry.` });
            continue;
        }
        const commandName = normalizedCommandName(normalizedId, command);
        const skillName = skillNameForCommand(commandName);
        if (!skillName) {
            errors.push({ code: "skill_mapping_invalid", path: `pipeline[${index}].id`, message: `Command "${commandName}" cannot be mapped to a Copilot skill.` });
            continue;
        }
        const label = phaseLabel(command?.shortLabel
            ?? command?.title
            ?? (canonical ? canonicalLabel(normalizedId) : commandName.split(".").at(-1)));
        const source = sourceFor(snapshot, normalizedId, command, canonical);
        const artifactPath = artifactFor(snapshot, originalId, normalizedId, command,
            commandName !== "speckit.constitution" || source.kind === "core");
        const hints = phaseHints(snapshot, originalId, normalizedId);
        const canonicalGuidance = canonicalArgumentGuidance(normalizedId);
        const argumentGuidance = {
            hint: typeof hints?.argsHint === "string" && hints.argsHint.trim()
                ? hints.argsHint
                : (canonical ? canonicalGuidance.hint : ""),
            whenEmpty: typeof hints?.argsWhenEmpty === "string" && hints.argsWhenEmpty.trim()
                ? hints.argsWhenEmpty
                : (canonical ? canonicalGuidance.whenEmpty : ""),
        };
        const persistent = Boolean(artifactPath) && !TRANSIENT_COMPLETION.has(commandName);
        if (!artifactPath) {
            warnings.push({
                code: "artifact_unknown",
                path: `pipeline[${index}]`,
                message: `No artifact target is known for "${commandName}"; the generated canvas must show it as a transient phase.`,
            });
        }
        steps.push({
            index,
            instanceKey: `${index}:${normalizedId}`,
            id: normalizedId,
            commandName,
            skillName,
            invocation: `/skill:${skillName}`,
            label: String(label ?? commandName),
            description: String(command?.helpText ?? command?.description ?? composedCommand?.description ?? hints?.description ?? (canonical ? canonicalDescription(normalizedId) : "")),
            source,
            artifact: {
                pathTemplate: artifactPath,
                persistent,
                completionSignal: persistent ? "artifact" : "transient",
            },
            arguments: {
                hint: argumentGuidance.hint,
                whenEmpty: argumentGuidance.whenEmpty,
            },
            optional: command?.optional === true,
            predecessors: index === 0 ? [] : [index - 1],
        });
    }

    if (errors.length) throw new BlueprintValidationError(errors);
    const constitutions = steps.filter((step) => step.commandName === "speckit.constitution");
    const projectArtifacts = constitutions.length
        ? { constitution: { instanceKey: constitutions[0].instanceKey, required: true } }
        : undefined;
    let views;
    try {
        views = commandViews({ pipeline: { steps }, projectArtifacts });
    } catch (error) {
        throw new BlueprintValidationError([{ code: "constitution_contract_unsupported", message: error.message }]);
    }
    const applicability = assessVisualizationApplicability(steps, views.workflow);
    if (!applicability.ok) throw new BlueprintValidationError(applicability.errors);
    try {
        validateWorkflowPaths({ pipeline: { steps }, projectArtifacts, runtime: { itemRoot: applicability.itemRoot } });
    } catch (error) {
        throw new BlueprintValidationError([{ code: "workflow_path_invalid", path: "pipeline", message: error.message }]);
    }
    const skills = requiredSkills(steps, errors);
    const presets = contributionRecords(snapshot, "preset", steps, errors, requireInstallationApproval);
    const extensions = contributionRecords(snapshot, "extension", steps, errors, requireInstallationApproval);
    if (errors.length) throw new BlueprintValidationError(errors);
    return {
        schemaVersion: 2,
        kind: "speckit-wizard-linear-canvas",
        metadata: {
            extensionId: metadata.extensionId,
            displayName: metadata.displayName,
            description: metadata.description,
            workflowListName: metadata.workflowListName ?? "Workflows",
        },
        pipeline: {
            topology: "linear",
            steps,
        },
        ...(projectArtifacts ? { projectArtifacts } : {}),
        setup: {
            requiresSpecKit: true,
            requireInstallationApproval,
            integration: {
                id: "copilot",
                skillsMode: true,
            },
            requiredSkills: skills,
            presets,
            extensions,
        },
        runtime: {
            visualStyle: "spec-kit-wizard",
            workflowMode: applicability.workflowMode,
            itemRoot: applicability.itemRoot,
            userProvidesSlug: options.userProvidesSlug === true,
            multiInstance: applicability.workflowMode === "item",
            supportsArtifactPreview: true,
            supportsRerun: true,
            supportsSse: true,
            requiredActions: ["list_items", "setup_workflow", "run_phase"],
        },
        warnings,
    };
}
