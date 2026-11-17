const FILE_LIMIT = 256 * 1024;
const OPTIONAL_COLOR = { type: "string", maxLength: 7,
    pattern: "^(?:#?[0-9A-Fa-f]{6})?$" };
export const RULES = {
    "canvas.id": { type: "string", minLength: 1, maxLength: 100,
        pattern: "^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9][a-z0-9-]*$",
        required: true },
    "canvas.displayName": { type: "string", minLength: 1, maxLength: 120, required: true },
    "canvas.description": { type: "string", maxLength: 240 },
    "canvas.workflowListName": { type: "string", maxLength: 80 },
    "canvas.workflowItemName": { type: "string", maxLength: 80,
        pattern: "^[^\\x00-\\x1f\\x7f]*$" },
    "canvas.accentLight": OPTIONAL_COLOR,
    "canvas.backgroundLight": OPTIONAL_COLOR,
    "canvas.surfaceLight": OPTIONAL_COLOR,
    "canvas.secondaryLight": OPTIONAL_COLOR,
    "canvas.textLight": OPTIONAL_COLOR,
    "canvas.accentDark": OPTIONAL_COLOR,
    "canvas.backgroundDark": OPTIONAL_COLOR,
    "canvas.surfaceDark": OPTIONAL_COLOR,
    "canvas.secondaryDark": OPTIONAL_COLOR,
    "canvas.textDark": OPTIONAL_COLOR,
    "workflowSlug.userProvided": { type: "boolean" },
};
const RESERVED_CANVAS_IDS = ["speckit-canvas-designer", "speckit-wizard", "speckit-canvas-generator"];
export function resolvedField(field, rule) {
    return { ...field, validation: { ...rule,
        ...(field.id === "canvas.id" ? { forbiddenValues: RESERVED_CANVAS_IDS } : {}) } };
}

export function checkSchema(value, schema, location) {
    if (Object.hasOwn(schema, "const") && value !== schema.const) {
        throw new Error(`${location}: unsupported schema version`);
    }
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${location}: unsupported value`);
    const type = schema.type;
    const valid = type === undefined || (type === "array" ? Array.isArray(value)
        : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "integer" ? Number.isInteger(value) : typeof value === type);
    if (!valid) throw new Error(`${location}: expected ${type}`);
    if (type === "object") {
        for (const key of schema.required ?? []) {
            if (!Object.hasOwn(value, key)) throw new Error(`${location}: missing ${key}`);
        }
        for (const [key, entry] of Object.entries(value)) {
            if (!Object.hasOwn(schema.properties, key)) throw new Error(`${location}: unsupported property ${key}`);
            checkSchema(entry, schema.properties[key], `${location}.${key}`);
        }
    } else if (type === "array") {
        if (value.length > schema.maxItems) throw new Error(`${location}: too many items`);
        value.forEach((item, i) => checkSchema(item, schema.items, `${location}[${i}]`));
    } else if (type === "string") {
        if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? FILE_LIMIT)
            || (schema.pattern && !new RegExp(schema.pattern).test(value))) {
            throw new Error(`${location}: invalid text length or identifier`);
        }
    } else if (type === "integer" && (value < schema.minimum || value > schema.maximum)) {
        throw new Error(`${location}: out of range`);
    }
}

export function validateTemplateRegistration(inventory, item, executable = false) {
    const info = inventory.get(`template:${item.name}`);
    const layers = info?.stack;
    const winner = layers?.find((layer) => layer?.active === true);
    const sourceLayer = item.sourceId === undefined ? undefined
        : item.sourceId === "project" ? "project"
            : item.sourceId.startsWith("extension:") ? "extension" : "preset";
    const sourceId = sourceLayer === "project" ? "_"
        : sourceLayer === "extension" ? item.sourceId.slice("extension:".length) : item.sourceId;
    if (info?.id !== `template:${item.name}` || info.kind !== "template"
        || info.name !== item.name || !Array.isArray(layers) || !layers.length
        || layers.some((layer) => !layer || layer.strategy !== "replace")
        || layers.filter((layer) => layer.active === true).length !== 1
        || !winner || (sourceLayer !== undefined
            && (winner.sourceId !== sourceId || winner.layer !== sourceLayer))
        || typeof winner.sourcePath !== "string" || !winner.sourcePath) {
        throw new Error(`${item.name}: registration must be a replace-only Specify template from ${item.sourceId}`);
    }
    if (typeof winner.sourceId !== "string"
        || !(winner.layer === "project" && winner.sourceId === "_"
            || winner.layer === "extension" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(winner.sourceId)
            || winner.layer === "preset" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(winner.sourceId))) {
        throw new Error(`${item.name}: invalid active Specify template layer`);
    }
    if (executable && inventory.has(`script:${item.name}`)) {
        throw new Error(`${item.name}: native Specify script registrations are not supported for executable adapters/renderers`);
    }
    return winner;
}
