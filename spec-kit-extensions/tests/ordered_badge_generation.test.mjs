import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { frozenBadges } from "../extension-canvas-design/scripts/generate.mjs";
import { validateBadgeRule } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/pages.mjs";
import { validBadgeEvidence } from "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/generation.mjs";

const asset = (name, kind, value) => {
    const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    return { name, kind, sourceId: "test-preset", content: bytes.toString("base64"),
        hash: createHash("sha256").update(bytes).digest("hex") };
};
const target = { phase: "plan", output: "specs/<slug>/plan.md" };
const earlier = { phase: "specify", output: "specs/<slug>/spec.md" };
const rule = {
    schemaVersion: 1, id: "phase-artifact-complete", label: "Phase artifact complete",
    description: "Ordered metadata evidence", placementPhaseInput: "target",
    inputs: [{ id: "target", type: "artifact", scope: "metadata" },
        { id: "prerequisites", type: "ordered-artifacts", scope: "metadata", before: "target" }],
    textPlaceholders: [], adapter: "badge-rule-phase-artifact-complete-adapter",
};
const type = { id: "phase-artifact-complete", title: "Phase artifact complete",
    description: "Ordered output freshness", rule: rule.id,
    defaultText: "Phase complete", defaultColor: "green", enabled: true };
const workflow = { selectedPhases: ["specify", "plan"], phaseArtifacts: {
    specify: { outputs: [earlier.output] }, plan: { outputs: [target.output] },
} };
const instance = { id: "plan-complete", type: type.id, category: "Progress", inputs: {
    target, prerequisites: [earlier],
}, text: "Ready", phaseText: "Phase ready", summaryText: "Ready",
color: "green", showIn: ["workflow-list", "workflow-summary", "phase-card"],
phase: "plan" };
const inventory = (badge = instance, definition = rule) => ({
    instances: [badge],
    settings: asset("badges-settings", "designer.badges-settings-definition",
        { schemaVersion: 1, types: [type] }),
    types: [{ name: "badges-settings", sourceId: "test-preset", schemaVersion: 1, ...type }],
    rules: [{ name: "phase-artifact-definition", sourceId: "test-preset", ...definition,
        assets: [asset("phase-artifact-definition", "generated.badge-rule-definition", definition)] }],
    adapters: [asset(definition.adapter, "generated.badge-rule-adapter",
        "export const contractVersion = 1; export function evaluate() {}")],
});
const declared = (entry) => Boolean(entry && workflow.phaseArtifacts[entry.phase]
    ?.outputs?.includes(entry.output));

test("ordered metadata evidence and target placement survive Designer and generator validation", () => {
    assert.doesNotThrow(() => validateBadgeRule(rule, "phase-artifact-definition"));
    assert.equal(validBadgeEvidence(instance, rule, workflow.selectedPhases, declared), true);
    const frozen = frozenBadges(inventory(), workflow);
    assert.equal(frozen.rules[0].placementPhaseInput, "target");
    assert.equal(frozen.rules[0].adapter, rule.adapter);
    assert.equal(Object.hasOwn(frozen.rules[0], "module"), false);
    assert.deepEqual(frozen.rules[0].inputs, rule.inputs);
    assert.deepEqual(frozen.instances[0].inputs.prerequisites, [earlier]);
    const targetOnly = { ...instance, inputs: { target: earlier, prerequisites: [] }, phase: "specify" };
    assert.equal(validBadgeEvidence(targetOnly, rule, workflow.selectedPhases, declared), true);
    assert.deepEqual(frozenBadges(inventory(targetOnly), workflow).instances[0].inputs.prerequisites, []);
});

test("malformed metadata rule references and ordered evidence are rejected", () => {
    const { adapter, ...legacyRule } = rule;
    assert.throws(() => validateBadgeRule({ ...legacyRule, module: adapter },
        "phase-artifact-definition"), /invalid badge rule definition/);
    assert.throws(() => frozenBadges(inventory(instance, { ...rule, module: adapter }), workflow),
        /Frozen generated.badge-rule-definition differs/);
    for (const malformed of [
        { ...rule, placementPhaseInput: "prerequisites" },
        { ...rule, inputs: [{ ...rule.inputs[0], scope: "directory" }, rule.inputs[1]] },
        { ...rule, inputs: [rule.inputs[0], { ...rule.inputs[1], before: "missing" }] },
        { ...rule, inputs: [rule.inputs[0], { ...rule.inputs[1], scope: "directory" }] },
    ]) {
        assert.throws(() => validateBadgeRule(malformed, "phase-artifact-definition"),
            /invalid badge rule definition/);
        assert.throws(() => frozenBadges(inventory(instance, malformed), workflow),
            /Invalid frozen badge rule/);
    }
    for (const badge of [
        { ...instance, inputs: { target, prerequisites: [target] } },
        { ...instance, inputs: { target, prerequisites: [earlier, earlier] } },
        { ...instance, inputs: { target, prerequisites: [{ ...earlier, unexpected: 1 }] } },
        { ...instance, phase: "specify" },
    ]) {
        assert.equal(validBadgeEvidence(badge, rule, workflow.selectedPhases, declared), false);
        assert.throws(() => frozenBadges(inventory(badge), workflow), /Invalid configured badge/);
    }
});

test("an ordered chain can require earlier files before a full-content target", () => {
    const contentRule = { ...rule, placementPhaseInput: undefined,
        inputs: [{ id: "target", type: "artifact" },
            { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
                before: "target", minItems: 1 }] };
    delete contentRule.placementPhaseInput;
    assert.doesNotThrow(() => validateBadgeRule(contentRule, "phase-artifact-definition"));
    assert.equal(validBadgeEvidence(instance, contentRule, workflow.selectedPhases, declared), true);
    assert.deepEqual(frozenBadges(inventory(instance, contentRule), workflow).rules[0].inputs,
        contentRule.inputs);
    const empty = { ...instance, inputs: { target, prerequisites: [] } };
    assert.equal(validBadgeEvidence(empty, contentRule, workflow.selectedPhases, declared), false);
    assert.throws(() => frozenBadges(inventory(empty, contentRule), workflow),
        /Invalid configured badge/);
    for (const input of [
        { ...contentRule.inputs[1], minItems: 0 },
        { ...contentRule.inputs[1], minItems: 101 },
        { ...contentRule.inputs[1], minItems: 1.5 },
        { ...contentRule.inputs[1], before: "missing" },
    ]) {
        const malformed = { ...contentRule, inputs: [contentRule.inputs[0], input] };
        assert.throws(() => validateBadgeRule(malformed, "phase-artifact-definition"),
            /invalid badge rule definition/);
        assert.throws(() => frozenBadges(inventory(instance, malformed), workflow),
            /Invalid frozen badge rule/);
    }
});

test("Artifact stale freezes its required metadata chain without accepting old saved inputs", () => {
    const staleRule = { ...rule, id: "artifact-stale",
        adapter: "badge-rule-ordered-stale-adapter",
        inputs: [{ id: "artifact", type: "artifact", scope: "metadata" },
            { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
                before: "artifact", minItems: 1 }] };
    delete staleRule.placementPhaseInput;
    const staleType = { ...type, id: "artifact-stale", rule: staleRule.id,
        defaultText: "Artifact stale" };
    const badge = { ...instance, id: "plan-stale", type: staleType.id,
        inputs: { artifact: target, prerequisites: [earlier] }, text: "Artifact stale" };
    const selected = (entry) => ({
        instances: [entry],
        settings: asset("badges-settings", "designer.badges-settings-definition",
            { schemaVersion: 1, types: [staleType] }),
        types: [{ name: "badges-settings", sourceId: "test-preset", schemaVersion: 1,
            ...staleType }],
        rules: [{ name: "stale-definition", sourceId: "test-preset", ...staleRule,
            assets: [asset("stale-definition", "generated.badge-rule-definition", staleRule)] }],
        adapters: [asset(staleRule.adapter, "generated.badge-rule-adapter",
            "export const contractVersion = 1; export function evaluate() {}")],
    });
    assert.doesNotThrow(() => validateBadgeRule(staleRule, "stale-definition"));
    assert.equal(validBadgeEvidence(badge, staleRule, workflow.selectedPhases, declared), true);
    assert.deepEqual(frozenBadges(selected(badge), workflow).rules[0].inputs, staleRule.inputs);
    for (const inputs of [
        { artifact: target },
        { artifact: target, prerequisites: [] },
        { artifact: target, prerequisites: [target] },
    ]) {
        const invalid = { ...badge, inputs };
        assert.equal(validBadgeEvidence(invalid, staleRule, workflow.selectedPhases, declared),
            false);
        assert.throws(() => frozenBadges(selected(invalid), workflow), /Invalid configured badge/);
    }
});

test("generator permits Constitution card placement while honoring rule target constraints", () => {
    const constitution = { phase: "speckit.constitution", output: ".specify/memory/constitution.md" };
    const phases = { selectedPhases: [constitution.phase, ...workflow.selectedPhases],
        phaseArtifacts: { ...workflow.phaseArtifacts, [constitution.phase]: {
            outputs: [constitution.output],
        } } };
    const global = { id: "constitution-evidence", type: type.id, category: "Constitution",
        inputs: { target: constitution, prerequisites: [] }, text: "Ready", color: "green",
        showIn: ["workflow-list"], phase: null };
    assert.equal(frozenBadges(inventory(global), phases).instances[0].inputs.target.phase,
        constitution.phase);
    const { text: _listText, ...cardOnly } = global;
    assert.equal(frozenBadges(inventory({ ...cardOnly, showIn: ["phase-card"],
        phase: constitution.phase, phaseText: "Ready" }), phases).instances[0].phase,
        constitution.phase);
    assert.equal(frozenBadges(inventory({ ...global, targets: [{
        phase: constitution.phase, output: null,
    }], phaseText: "Ready" }), phases).instances[0].targets[0].output, null);
    assert.throws(() => frozenBadges(inventory({ ...global, targets: [{
        phase: constitution.phase, output: constitution.output,
    }], phaseText: "Ready" }), phases), /Invalid configured badge/);
    assert.throws(() => frozenBadges(inventory({ ...global, targets: [{
        phase: constitution.phase, output: "undeclared.md",
    }], phaseText: "Ready" }), phases), /Invalid configured badge/);
});

test("generator requires a badge category and compares text only in shared placements", () => {
    const { category: _category, ...uncategorized } = instance;
    for (const badge of [uncategorized, ...["", "   ", "x".repeat(81), "Bad <b>", "Line\nbreak", 7]
        .map((category) => ({ ...instance, category }))]) {
        assert.throws(() => frozenBadges(inventory(badge), workflow), /Invalid configured badge/);
    }
    assert.equal(frozenBadges(inventory({ ...instance, category: "x".repeat(80) }), workflow)
        .instances[0].category, "x".repeat(80));
    const { text: _text, phaseText: _phaseText, ...rest } = instance;
    const summaryOnly = { ...rest, id: "summary-a", showIn: ["workflow-summary"], phase: null };
    const pair = (other) => ({ ...inventory(summaryOnly), instances: [summaryOnly, other] });
    assert.deepEqual(frozenBadges(pair({ ...summaryOnly, id: "summary-b", summaryText: "Plan ready" }),
        workflow).instances.map(({ id }) => id), ["summary-a", "summary-b"]);
    assert.throws(() => frozenBadges(pair({ ...summaryOnly, id: "summary-b", category: "Other" }),
        workflow), /Duplicate frozen badge target: summary-b overlaps summary-a/);
    assert.throws(() => frozenBadges(pair({ ...summaryOnly, id: "summary-b",
        showIn: ["workflow-list", "workflow-summary"], text: "Listed" }), workflow),
    /Duplicate frozen badge target: summary-b overlaps summary-a/);
});

test("generator compares ordered Value match entries without their stable IDs", () => {
    const matchRule = { schemaVersion: 1, id: "value-match", label: "Value match",
        description: "Match content", adapter: "badge-rule-content-adapter",
        inputs: [{ id: "artifact", type: "artifact" }, { id: "choices", type: "badge-selection" }],
        textPlaceholders: [] };
    const matchType = { id: "value-match", title: "Value match", description: "Match content",
        rule: matchRule.id, defaultText: "Match", defaultColor: "amber", enabled: true };
    const choices = [
        { id: "critical", value: "Critical", text: "Critical", phaseText: "Critical phase",
            summaryText: "Critical", color: "red" },
        { id: "low", value: "Low", text: "Low", phaseText: "Low phase",
            summaryText: "Low", color: "blue" },
    ];
    const first = { id: "first", type: matchType.id, category: "Severity",
        inputs: { artifact: target, choices }, color: "amber",
        showIn: ["workflow-list", "workflow-summary", "phase-card"], phase: "plan" };
    const differentIds = choices.map((choice, index) => ({ ...choice, id: `other-${index}` }));
    const second = { ...first, id: "second", inputs: { ...first.inputs, choices: differentIds } };
    const pair = (other) => ({
        instances: [first, other],
        settings: asset("badges-settings", "designer.badges-settings-definition",
            { schemaVersion: 1, types: [matchType] }),
        types: [{ name: "badges-settings", sourceId: "test-preset", schemaVersion: 1, ...matchType }],
        rules: [{ name: "value-match-definition", sourceId: "test-preset", ...matchRule,
            assets: [asset("value-match-definition", "generated.badge-rule-definition", matchRule)] }],
        adapters: [asset(matchRule.adapter, "generated.badge-rule-adapter",
            "export const contractVersion = 1; export function evaluate() {}")],
    });
    const duplicate = pair(second);
    const before = structuredClone(duplicate);
    assert.throws(() => frozenBadges(duplicate, workflow),
        /Duplicate frozen badge target: second overlaps first/);
    assert.deepEqual(duplicate, before);
    const variants = [
        [...differentIds].reverse(),
        ...[["value", "Different"], ["text", "Different"], ["phaseText", "Different phase"],
            ["summaryText", "Different summary"], ["color", "purple"]]
            .map(([key, value]) => [{ ...differentIds[0], [key]: value }, differentIds[1]]),
    ];
    for (const variant of variants) {
        const distinct = { ...second, inputs: { ...second.inputs, choices: variant } };
        const frozen = frozenBadges(pair(distinct), workflow);
        assert.deepEqual(frozen.instances[0].inputs.choices, choices);
        assert.deepEqual(frozen.instances[1].inputs.choices, variant);
    }
    const differentEvidence = { ...second, inputs: { ...second.inputs, artifact: earlier } };
    assert.deepEqual(frozenBadges(pair(differentEvidence), workflow).instances[1],
        differentEvidence);
});
