export const PAGE_NAME = "^[a-z][a-z0-9-]{0,79}$";
export const isWindowsDeviceName = (name) =>
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
export const handoffIdSchema = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" };

export const designerOpenInputSchema = {
    type: "object", additionalProperties: false,
    properties: {
        preview: { type: "boolean" },
        handoffId: handoffIdSchema,
        pages: { type: "array", maxItems: 100, items: {
            type: "object", additionalProperties: false, required: ["name", "path", "kind", "strategy"],
            properties: { name: { type: "string", pattern: PAGE_NAME },
                path: { type: "string", minLength: 1, maxLength: 4096 },
                kind: { const: "designer.tab-definition" }, strategy: { const: "replace" } },
        } },
        templates: { type: "array", maxItems: 100, items: {
            type: "object", additionalProperties: false,
            required: ["name", "path", "sourceId", "kind", "strategy"],
            properties: { name: { type: "string", pattern: PAGE_NAME },
                path: { type: "string", minLength: 1, maxLength: 4096 },
                sourceId: { type: "string", minLength: 1, maxLength: 160 },
                kind: { type: "string", enum: ["designer.setting-definition",
                    "generated.workflow-page-definition", "generated.workflow-page-adapter",
                    "generated.phase-control-definition", "generated.phase-control-adapter",
                    "designer.badges-settings-definition", "generated.badge-rule-definition",
                    "generated.badge-rule-adapter", "designer.badge-input-control",
                    "designer.badge-input-binding", "designer.badge-input-adapter",
                    "generated.field-placement",
                    "generated.added-page-definition", "generated.added-page-renderer",
                    "shared.control-definition", "designer.control-adapter", "generated.control-adapter",
                    "generated.value-definition", "generated.computed-value-provider",
                    "generated.dialog-definition", "generated.dialog-adapter",
                    "generated.phase-dialog-binding", "generated.button-control-definition",
                    "generated.button-adapter", "generated.button-placement"] },
                strategy: { const: "replace" } },
        } },
    },
};

export function validateDesignerOpenInput(input) {
    const { preview, handoffId, pages, templates } = input ?? {};
    if (preview && (handoffId !== undefined || pages !== undefined || templates !== undefined)) {
        throw new Error("Designer preview cannot include a Wizard handoff, pages, or templates");
    }
    if ((handoffId === undefined) !== (pages === undefined)
        || (handoffId === undefined) !== (templates === undefined)) {
        throw new Error("Designer handoff and complete resolved inventory are required together");
    }
    return { preview, handoffId, pages, templates };
}

export function validateLastOpen(record) {
    const validKeys = (value, required) => value && typeof value === "object"
        && !Array.isArray(value)
        && Object.keys(value).length === required.length
        && required.every((key) => Object.hasOwn(value, key));
    const validString = (value, limit) => typeof value === "string"
        && value.length > 0 && value.length <= limit;
    const validEntry = (entry, schema) => {
        const properties = schema.properties;
        if (!validKeys(entry, Object.keys(properties))) return false;
        return Object.entries(properties).every(([key, spec]) => {
            const value = entry[key];
            if (spec.const !== undefined) return value === spec.const;
            if (spec.enum) return spec.enum.includes(value);
            if (!validString(value, spec.maxLength ?? 4096)) return false;
            return !spec.pattern || new RegExp(spec.pattern).test(value);
        });
    };
    const input = record && typeof record === "object" && !Array.isArray(record)
        ? { handoffId: record.handoffId, pages: record.pages, templates: record.templates }
        : null;
    if (!validKeys(record, ["schemaVersion", "handoffId", "pages", "templates"])
        || record.schemaVersion !== 1
        || !validString(record.handoffId, 128)
        || !new RegExp(handoffIdSchema.pattern).test(record.handoffId)
        || !Array.isArray(record.pages) || record.pages.length > 100
        || !record.pages.every((entry) =>
            validEntry(entry, designerOpenInputSchema.properties.pages.items))
        || !Array.isArray(record.templates) || record.templates.length > 100
        || !record.templates.every((entry) =>
            validEntry(entry, designerOpenInputSchema.properties.templates.items))) {
        throw new Error("Invalid saved Designer open inventory");
    }
    return input;
}
