import { isDeepStrictEqual } from "node:util";
import { validateBadgeRule, validateBadgeSettings, validateBadgeText }
    from "./external-badge-definitions.mjs";
import { validateBadges } from "./external-badges.mjs";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const keys = (value, required, optional = []) => record(value)
    && required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => [...required, ...optional].includes(key));

// Inspect the generated envelope, not unrelated page settings or executable code.
export function generatedBadgeEnvelope(config) {
    if (!record(config) || config.schemaVersion !== 1 || !record(config.canvas)
        || ["id", "displayName", "description", "workflowListName"].some((key) =>
            typeof config.canvas[key] !== "string")
        || !config.canvas.id || !config.canvas.displayName
        || typeof config.userProvidesSlug !== "boolean" || typeof config.showSetup !== "boolean"
        || !Array.isArray(config.phases) || !config.phases.length
        || config.phases.some((phase) => typeof phase !== "string" || !phase)
        || new Set(config.phases).size !== config.phases.length
        || !record(config.phaseArtifacts) || !record(config.phaseOutputs)
        || !record(config.workflowPage) || !record(config.installed)
        || ["presets", "extensions", "bundles"].some((key) => !Array.isArray(config.installed[key]))) {
        throw new Error("Choose a complete generated canvas-config.json (schema version 1), not a badge list or Designer settings file.");
    }
    if (!keys(config.badges, ["instances", "types", "rules"])
        || ["instances", "types", "rules"].some((key) =>
            !Array.isArray(config.badges[key]) || config.badges[key].length > 100)
        || !config.badges.instances.length) {
        throw new Error("The generated canvas-config.json must contain badges.instances, badges.types, and badges.rules, with at least one badge.");
    }
    return config.badges;
}

const typeBehavior = ({ id, rule, enabled, defaultText, defaultColor, replacementGroup }) =>
    ({ id, rule, enabled, defaultText, defaultColor, replacementGroup });
const ruleBehavior = ({ id, adapter, inputs, textPlaceholders, placementPhaseInput }) =>
    ({ id, adapter, placementPhaseInput, textPlaceholders,
        inputs: inputs.map(({ label: _label, ...input }) => input) });

export function validateBadgeImport(config, draft, model) {
    const source = generatedBadgeEnvelope(config);
    // Reuse Save's complete validator, including conflicts with the existing draft.
    const combined = validateBadges([...draft, ...source.instances], model);
    const types = new Map(), rules = new Map();
    for (const type of source.types) {
        if (!keys(type, ["schemaVersion", "id", "title", "description", "rule",
            "defaultText", "defaultColor", "enabled", "hash"], ["replacementGroup"])
            || type.schemaVersion !== 1 || !hash(type.hash) || types.has(type.id)) {
            throw new Error("Invalid or duplicate imported badge type definition");
        }
        const { schemaVersion: _version, hash: _hash, ...definition } = type;
        validateBadgeSettings({ schemaVersion: 1, types: [definition] }, `Imported badge type ${type.id}`);
        types.set(type.id, type);
    }
    for (const rule of source.rules) {
        if (!keys(rule, ["schemaVersion", "id", "label", "description", "inputs",
            "textPlaceholders", "adapter", "hash"], ["placementPhaseInput"])
            || !hash(rule.hash) || rules.has(rule.id)) {
            throw new Error("Invalid or duplicate imported badge rule definition");
        }
        const { hash: _hash, ...definition } = rule;
        validateBadgeRule(definition, `Imported badge rule ${rule.id}`);
        rules.set(rule.id, rule);
    }
    const usedTypes = new Set(), usedRules = new Set();
    for (const [index, badge] of source.instances.entries()) {
        const fail = (reason) => {
            throw new Error(`Cannot import badge ${index + 1} (${badge.id}): ${reason}`);
        };
        const type = types.get(badge.type);
        const currentType = model.badgeTypes.find((entry) => entry.id === badge.type);
        if (!type) fail(`missing generated badge type ${badge.type}`);
        const rule = rules.get(type.rule);
        const currentRule = model.badgeRules.find((entry) => entry.id === currentType.rule);
        if (!rule) fail(`missing generated badge rule ${type.rule}`);
        if (!isDeepStrictEqual(typeBehavior(type), typeBehavior(currentType))) {
            fail(`badge type ${type.id} behaves differently in this Designer`);
        }
        validateBadgeText(type.defaultText, rule.textPlaceholders, `Imported badge type ${type.id}`);
        if (!isDeepStrictEqual(ruleBehavior(rule), ruleBehavior(currentRule))) {
            fail(`badge rule ${rule.id} behaves differently in this Designer`);
        }
        const evaluator = model.templates?.find((item) =>
            item.kind === "generated.badge-rule-adapter" && item.name === currentRule.adapter);
        if (!hash(evaluator?.hash) || rule.hash !== evaluator.hash) {
            fail(`evaluator ${rule.adapter} is incompatible or cannot be verified`);
        }
        usedTypes.add(type.id);
        usedRules.add(rule.id);
    }
    if (usedTypes.size !== types.size || usedRules.size !== rules.size) {
        throw new Error("Imported badge definitions contain unused types or rules");
    }
    return combined;
}
