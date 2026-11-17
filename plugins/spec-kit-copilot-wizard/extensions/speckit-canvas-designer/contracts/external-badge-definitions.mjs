const BADGE_ID = /^[a-z][a-z0-9-]{0,79}$/;
const BADGE_COLOR = /^(?:theme|red|green|amber|blue|purple|pink|orange|#[0-9a-fA-F]{6})$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) => Object.keys(value)
    .filter((key) => key !== "$schema").sort().join() === [...expected].sort().join();

function schemaMetadata(value, name) {
    if (Object.hasOwn(value, "$schema") && typeof value.$schema !== "string") {
        throw new Error(`${name}: invalid $schema reference`);
    }
}

export function validateBadgeText(text, placeholders, name) {
    if (typeof text !== "string" || !text.trim() || text.length > 120
        || /[\x00-\x1f\x7f<>]/.test(text)
        || [...text.matchAll(/\{([^{}]+)\}/g)].some(([, placeholder]) =>
            !placeholders.includes(placeholder))
        || /[{}]/.test(text.replace(/\{[^{}]+\}/g, ""))) {
        throw new Error(`${name}: invalid badge text or undeclared placeholder`);
    }
}

function validateBadgeType(value, name) {
    if (!record(value) || Object.hasOwn(value, "$schema")
        || !keys(value, ["id", "title", "description",
            "rule", "defaultText", "defaultColor", "enabled",
            ...(Object.hasOwn(value, "replacementGroup") ? ["replacementGroup"] : [])])
        || typeof value.id !== "string" || !BADGE_ID.test(value.id)
        || typeof value.rule !== "string" || !BADGE_ID.test(value.rule)
        || (value.replacementGroup !== undefined
            && (typeof value.replacementGroup !== "string"
                || !BADGE_ID.test(value.replacementGroup)))
        || typeof value.title !== "string" || !value.title.trim() || value.title.length > 120
        || typeof value.description !== "string" || !value.description.trim()
        || value.description.length > 1000 || typeof value.enabled !== "boolean"
        || typeof value.defaultColor !== "string" || !BADGE_COLOR.test(value.defaultColor)) {
        throw new Error(`${name}: invalid badge type definition`);
    }
}

export function validateBadgeSettings(value, name) {
    if (!record(value) || !keys(value, ["schemaVersion", "types"])
        || value.schemaVersion !== 1 || !Array.isArray(value.types)
        || !value.types.length || value.types.length > 30) {
        throw new Error(`${name}: invalid badges settings`);
    }
    schemaMetadata(value, name);
    for (const type of value.types) validateBadgeType(type, name);
    if (new Set(value.types.map((type) => type.id)).size !== value.types.length) {
        throw new Error(`${name}: duplicate badge type ID`);
    }
}

export function validateBadgeRule(value, name) {
    if (!record(value) || !keys(value, ["schemaVersion", "id", "label", "description",
        "inputs", "textPlaceholders", "adapter",
        ...(Object.hasOwn(value, "placementPhaseInput") ? ["placementPhaseInput"] : [])])
        || value.schemaVersion !== 1 || typeof value.id !== "string" || !BADGE_ID.test(value.id)
        || typeof value.adapter !== "string" || !BADGE_ID.test(value.adapter)
        || typeof value.label !== "string" || !value.label.trim() || value.label.length > 120
        || typeof value.description !== "string" || !value.description.trim()
        || value.description.length > 1000
        || !Array.isArray(value.inputs) || value.inputs.length > 10
        || value.inputs.some((input) => !record(input) || !keys(input, ["id", "type",
            ...(Object.hasOwn(input, "scope") ? ["scope"] : []),
            ...(Object.hasOwn(input, "before") ? ["before"] : []),
            ...(Object.hasOwn(input, "minItems") ? ["minItems"] : []),
            ...(Object.hasOwn(input, "label") ? ["label"] : [])])
            || typeof input.id !== "string" || !BADGE_ID.test(input.id)
            || !["artifact", "artifact-set", "ordered-artifacts", "phase", "text", "badge-selection"].includes(input.type)
            || (input.label !== undefined
                && (typeof input.label !== "string" || !input.label.trim() || input.label.length > 80))
            || (input.scope !== undefined
                && !(input.type === "artifact" && ["directory", "metadata"].includes(input.scope)
                    || input.type === "ordered-artifacts" && input.scope === "metadata"))
            || (input.type === "ordered-artifacts"
                && (input.scope !== "metadata" || typeof input.before !== "string"))
            || (input.minItems !== undefined && (input.type !== "ordered-artifacts"
                || !Number.isInteger(input.minItems) || input.minItems < 1 || input.minItems > 100))
            || (input.before !== undefined && (input.type !== "ordered-artifacts"
                || !value.inputs.some((candidate) => candidate.id === input.before
                    && candidate.type === "artifact" && candidate.scope !== "directory"))))
        || new Set(value.inputs.map((input) => input.id)).size !== value.inputs.length
        || value.inputs.filter((input) => input.type === "badge-selection").length > 1
        || (value.placementPhaseInput !== undefined
            && !value.inputs.some((input) =>
                input.id === value.placementPhaseInput && input.type === "artifact"))
        || !Array.isArray(value.textPlaceholders) || value.textPlaceholders.length > 10
        || value.textPlaceholders.some((placeholder) => typeof placeholder !== "string"
            || !/^[a-z][a-z0-9-]{0,39}$/.test(placeholder))
        || new Set(value.textPlaceholders).size !== value.textPlaceholders.length) {
        throw new Error(`${name}: invalid badge rule definition`);
    }
    schemaMetadata(value, name);
}
