// speckit-generated-workflow-adapter v2: protected runtime, never generated code.
import { commandViews } from "./ui/command-views.mjs";
function record(value, label, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    for (const key of Object.keys(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key) || (keys && !keys.includes(key))) {
            throw new Error(`${label} contains unsupported field: ${key}`);
        }
    }
}

export function defaultPhaseInput(phase) {
    if (phase?.commandName === "speckit.constitution" && phase.source?.kind === "core") {
        return { label: "Guidance", helper: "Optional: principles to emphasize (e.g. testing, performance, UX)", optional: true };
    }
    return { label: "Phase input", helper: "Add details or direction for this phase.", optional: false };
}

function validatePhaseInput(input, phase) {
    record(input, `phaseInputs.${phase}`, ["label", "helper", "optional"]);
    for (const [field, limit] of [["label", 80], ["helper", 240]]) {
        const text = input[field];
        if (typeof text !== "string" || !text.trim() || text !== text.trim()
            || text.length > limit || /[\r\n\x00-\x1f]/.test(text)) {
            throw new Error(`phaseInputs.${phase}.${field} must be nonempty single-line text of at most ${limit} characters`);
        }
        if (/\b(?:slugs?|paths?|folders?|director(?:y|ies)|locations?|workspaces?|cwd)\b|<[^>]+>|\b(?:workflow|assessment|feature|project)\s+(?:id|identifier)\b|(?:^|\s)(?:[a-z]:[\\/]|[.~]?[\\/])/i.test(text)) {
            throw new Error(`phaseInputs.${phase}.${field} must describe content only, without slug, identifier, or location instructions`);
        }
    }
    if (typeof input.optional !== "boolean") throw new Error(`phaseInputs.${phase}.optional must be a boolean`);
}

export function validateResultLabels(value) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 5) throw new Error("Workflow results must be a list of up to 5 labels.");
    const reserved = new Set(["not determined", "clarification needed", "needs clarification",
        "reviewing", "review unavailable", "artifact unavailable", "artifact ready", "artifact not ready"]);
    const labels = new Set();
    for (const text of value) {
        if (typeof text !== "string" || !text.trim()) {
            throw new Error("Each result label must be nonempty text.");
        }
        if (text !== text.trim() || text.length > 60 || /[\x00-\x1f\x7f\u2028\u2029]/.test(text)
            || text.split(/\s+/).length > 3) {
            throw new Error("Result labels must be trimmed single-line text of 1-3 words and at most 60 characters.");
        }
        const normalized = text.toLowerCase().replace(/\s+/g, " ");
        if (reserved.has(normalized)) throw new Error(`"${text}" is built in. Remove it from the custom result labels.`);
        if (labels.has(normalized)) throw new Error("Result labels must be different.");
        labels.add(normalized);
    }
    return [...value];
}

export function validateWorkflowConfig(config, pipeline, { resultLabels } = {}) {
    const { all } = commandViews(pipeline);
    record(config, "workflow config", ["version", "itemLabels", "phaseArguments", "phaseInputs", "resultLabels"]);
    const configuredLabels = validateResultLabels(config.resultLabels);
    if (resultLabels !== undefined && JSON.stringify(configuredLabels) !== JSON.stringify(validateResultLabels(resultLabels))) {
        throw new Error("Result labels must match the generation settings exactly.");
    }
    if (config.version !== 1) throw new Error("unsupported workflow config version");
    record(config.itemLabels, "itemLabels");
    for (const [id, label] of Object.entries(config.itemLabels)) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || typeof label !== "string" || !label.trim() || label.length > 200) {
            throw new Error("itemLabels must map workflow IDs to nonempty labels of at most 200 characters");
        }
    }
    record(config.phaseArguments, "phaseArguments");
    const phases = new Set(all.map((phase) => phase.instanceKey));
    for (const [phase, args] of Object.entries(config.phaseArguments)) {
        if (!phases.has(phase)) throw new Error(`phaseArguments references unknown phase: ${phase}`);
        record(args, `phaseArguments.${phase}`, ["prefix", "suffix"]);
        for (const value of Object.values(args)) {
            if (typeof value !== "string" || value.length > 2000 || /[\r\n\x00]/.test(value)
                || /(?:^|\s)(?:--)?slug(?:=|\s|$)/i.test(value)) {
                throw new Error("phase arguments must be single-line text without runtime-owned slug arguments");
            }
        }
    }
    if (Object.hasOwn(config, "phaseInputs")) {
        record(config.phaseInputs, "phaseInputs");
        for (const [phase, input] of Object.entries(config.phaseInputs)) {
            if (!phases.has(phase)) throw new Error(`phaseInputs references unknown phase: ${phase}`);
            validatePhaseInput(input, phase);
        }
        for (const phase of phases) {
            if (!Object.hasOwn(config.phaseInputs, phase)) throw new Error(`phaseInputs is missing phase: ${phase}`);
        }
    }
    return config;
}

export function createWorkflowAdapter(config, pipeline) {
    // Copy validated JSON so callers cannot change the adapter after validation.
    const settings = JSON.parse(JSON.stringify(validateWorkflowConfig(config, pipeline)));
    const { constitution, workflow } = commandViews(pipeline);
    return Object.freeze({
        artifactReview() {
            return settings.resultLabels?.length && workflow.length ? { labels: [...settings.resultLabels] } : null;
        },
        phaseInput(phase) {
            return { ...(settings.phaseInputs?.[phase.instanceKey] ?? defaultPhaseInput(
                constitution?.instanceKey === phase.instanceKey ? phase : undefined,
            )) };
        },
        async listItems({ defaults }) {
            return (await defaults()).map((item) => item.isNew ? item : {
                ...item,
                label: Object.hasOwn(settings.itemLabels, item.id) ? settings.itemLabels[item.id] : item.label,
            });
        },
        buildPhaseArguments({ phase, userInput }) {
            const args = settings.phaseArguments[phase.instanceKey];
            return [args?.prefix, userInput, args?.suffix].filter((part) => part != null && part !== "").join(" ");
        },
    });
}
