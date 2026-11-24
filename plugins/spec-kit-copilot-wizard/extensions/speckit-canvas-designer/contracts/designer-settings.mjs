import { isWindowsDeviceName } from "./host-open.mjs";

export const SETTINGS_LIMIT = 1024 * 1024;
export const SAVE_REQUEST_LIMIT = SETTINGS_LIMIT - 8 * 1024;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function matchesRuleInputShape(value, type) {
    if (type === "phase" || type === "text") return typeof value === "string";
    if (type === "artifact") return record(value)
        && typeof value.phase === "string" && typeof value.output === "string";
    if (type === "artifact-set") return Array.isArray(value) && value.length > 0
        && value.every((entry) => record(entry) && typeof entry.phase === "string"
            && Array.isArray(entry.outputs));
    if (type === "ordered-artifacts") return Array.isArray(value)
        && value.every((entry) => record(entry) && typeof entry.phase === "string"
            && typeof entry.output === "string");
    return true;
}

export function validateValues(values, constraints) {
    if (!values || typeof values !== "object" || Array.isArray(values)
        || Object.keys(values).length !== Object.keys(constraints).length
        || Object.keys(values).some((key) => !Object.hasOwn(constraints, key))) {
        throw new Error("Designer settings contain unexpected or missing fields");
    }
    for (const [key, rule] of Object.entries(constraints)) {
        const value = values[key];
        const invalidType = rule.type === "boolean" ? typeof value !== "boolean"
            : rule.type === "string" ? typeof value !== "string"
                : rule.type === "image" ? typeof value !== "string"
                    || value.length > Math.ceil(rule.maxBytes / 3) * 4 + 64
                    : rule.type === "object" ? value !== null
                        && (typeof value !== "object" || Array.isArray(value))
                        : true;
        if (invalidType || key === "canvas.id" && typeof value === "string"
            && (/[/\\]/.test(value) || isWindowsDeviceName(value))) {
            throw new Error(`Invalid Designer setting: ${key}`);
        }
    }
}

export function validateSavedSettingsMetadata(record, handoff) {
    if (!record || typeof record !== "object" || Array.isArray(record)
        || record.schemaVersion !== 1 || record.handoffId !== handoff.handoffId
        || !Number.isSafeInteger(record.revision) || record.revision < 1) {
        throw new Error("Saved Designer settings do not match the current handoff or pages");
    }
}

export function validateSavedSettings(record, handoff, model) {
    validateSavedSettingsMetadata(record, handoff);
    if (record?.modelRevision !== undefined && record.modelRevision !== model.revision
        && record?.handoffId === handoff.handoffId) {
        const affected = Array.isArray(record.badges)
            ? record.badges.filter((badge) => typeof badge?.id === "string"
                && /^[a-z0-9-]{1,80}$/.test(badge.id))
                .slice(0, 100).map((badge) => {
                    const type = model.badgeTypes?.find((item) => item.id === badge.type);
                    const rule = model.badgeRules?.find((item) => item.id === type?.rule);
                    const binding = model.badgeInputControls?.find((item) => item.rule === rule?.id);
                    const problem = !type ? `missing type ${badge.type}`
                        : !type.enabled ? `disabled type ${type.id}`
                            : !rule ? `missing rule ${type.rule}`
                                : !binding ? `missing control for rule ${rule.id}`
                                    : model.templates && !model.templates.some((item) =>
                                        item.kind === "generated.badge-rule-adapter"
                                            && item.name === rule.adapter)
                                        ? `missing evaluator ${rule.adapter}`
                                        : !badge.inputs || typeof badge.inputs !== "object"
                                            || Array.isArray(badge.inputs)
                                            || Object.keys(badge.inputs).sort().join()
                                                !== (rule.inputs ?? []).map((input) => input.id).sort().join()
                                            ? `changed inputs for rule ${rule.id}`
                                            : rule.inputs?.some(({ id, type: inputType }) =>
                                                !matchesRuleInputShape(badge.inputs[id], inputType))
                                                ? `inputs incompatible with current rule ${rule.id}` : null;
                    return problem ? `${badge.id} (${problem})` : null;
                }).filter(Boolean) : [];
        throw new Error("Saved Designer settings do not match the current handoff or pages"
            + (affected.length ? `; saved badges: ${affected.join(", ")}` : "")
            + ". Restore the previous preset composition or recreate incompatible settings explicitly.");
    }
    if (!record || typeof record !== "object" || Array.isArray(record)
        || Object.keys(record).sort().join() !== [
            "handoffId", "modelRevision", "revision", "schemaVersion", "values",
            ...(Object.hasOwn(record, "outputs") ? ["outputs"] : []),
            ...(Object.hasOwn(record, "badges") ? ["badges"] : []),
        ].sort().join()
        || record.schemaVersion !== 1 || record.handoffId !== handoff.handoffId
        || !Number.isSafeInteger(record.revision) || record.revision < 1
        || record.modelRevision !== model.revision) {
        throw new Error("Saved Designer settings do not match the current handoff or pages");
    }
    validateValues(record.values, model.constraints);
}

export function validateSaveRequest(request, model) {
    if (!request || typeof request !== "object" || Array.isArray(request)
        || Object.keys(request).sort().join() !== [
            "modelRevision", "revision", "values",
            ...(Object.hasOwn(request, "outputs") ? ["outputs"] : []),
            ...(Object.hasOwn(request, "badges") ? ["badges"] : []),
        ].sort().join()
        || request.modelRevision !== model.revision
        || !Number.isSafeInteger(request.revision) || request.revision < 0) {
        throw new Error("Invalid Designer save request");
    }
    validateValues(request.values, model.constraints);
}
