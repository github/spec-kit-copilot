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

function reviewText(value, max) {
    if (typeof value !== "string" || !value.trim() || value !== value.trim()
        || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid artifactReview text");
}

export function validateWorkflowConfig(config, pipeline, { example } = {}) {
    const { all } = commandViews(pipeline);
    record(config, "workflow config", ["version", "itemLabels", "phaseArguments", "phaseInputs", "artifactReview"]);
    if (config.artifactReview != null) {
        const review = config.artifactReview;
        record(review, "artifactReview", ["phase", "sampleFingerprint", "goal", "statuses"]);
        const final = commandViews(pipeline).workflow.at(-1);
        if (!final?.artifact?.persistent || review.phase !== final.instanceKey) throw new Error("artifactReview must describe the final artifact-producing workflow phase");
        if (!/^[a-f0-9]{64}$/.test(review.sampleFingerprint ?? "")) throw new Error("artifactReview requires an example fingerprint");
        if (example !== undefined && (!example?.available || review.sampleFingerprint !== example.sample?.fingerprint
            || review.phase !== example.sample?.phase)) throw new Error("artifactReview does not match the captured final example");
        reviewText(review.goal, 1000);
        if (!Array.isArray(review.statuses) || review.statuses.length < 2 || review.statuses.length > 6) throw new Error("artifactReview needs 2-6 statuses");
        const ids = new Set(["needs-review"]);
        const labels = new Set(["needs review", "clarification needed", "reviewing", "review unavailable", "artifact unavailable"]);
        for (const status of review.statuses) {
            record(status, "artifactReview status", ["id", "label", "criterion"]);
            if (typeof status.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(status.id) || ids.has(status.id)) throw new Error("artifactReview IDs must be unique and nonreserved");
            reviewText(status.label, 60);
            reviewText(status.criterion, 1000);
            const normalized = status.label.toLowerCase().replace(/\s+/g, " ");
            if (normalized.split(" ").length > 3 || labels.has(normalized)) throw new Error("artifactReview labels must be unique nonreserved 1-3 word phrases");
            ids.add(status.id);
            labels.add(normalized);
        }
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
    const { constitution } = commandViews(pipeline);
    return Object.freeze({
        artifactReview() { return structuredClone(settings.artifactReview ?? null); },
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
