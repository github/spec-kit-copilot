import assert from "node:assert/strict";
import test from "node:test";
import { validateBadges } from "../contracts/external-badges.mjs";
import { validateBadgeSettings } from "../contracts/external-badge-definitions.mjs";

const model = {
    phases: ["specify", "plan"],
    outputs: {
        specify: { outputs: ["specs/<slug>/spec.md", "specs/<slug>/notes.md"],
            view: "specs/<slug>/spec.md" },
        plan: { outputs: ["specs/<slug>/plan.md"], view: "specs/<slug>/plan.md" },
    },
    badgeTypes: [{ id: "artifact", rule: "artifact-rule", enabled: true },
        { id: "distinct", rule: "distinct-rule", enabled: true },
        { id: "disabled", rule: "artifact-rule", enabled: false }],
    badgeRules: [
        { id: "artifact-rule", inputs: [{ id: "item", type: "artifact" }],
            textPlaceholders: ["status"] },
        { id: "distinct-rule", inputs: [{ id: "items", type: "artifact-set" },
            { id: "completion", type: "phase" }], textPlaceholders: [] },
    ],
};
const artifact = { id: "badge-1", type: "artifact", category: "Readiness",
    inputs: { item: { phase: "specify", output: "specs/<slug>/spec.md" } },
    text: "Ready {status}", phaseText: "Phase ready {status}", color: "green",
    showIn: ["workflow-list", "phase-card"], phase: "plan" };
const distinct = { id: "badge-2", type: "distinct", category: "Clarity",
    inputs: { items: [{ phase: "specify",
        outputs: ["specs/<slug>/spec.md", "specs/<slug>/notes.md"] }],
        completion: "plan" },
    color: "#abcdef", showIn: [], phase: null };
// Keeps fixture variants valid when only their placements change: text exists exactly for
// selected placements, as the contract requires.
function fit(badge) {
    const result = { ...badge };
    const phase = Boolean(result.targets?.length || result.showIn.includes("phase-card"));
    for (const [selected, key, value] of [[result.showIn.includes("workflow-list"), "text", "Ready"],
        [phase, "phaseText", "Phase ready"], [result.showIn.includes("workflow-summary"), "summaryText", "Ready"]]) {
        if (!selected) delete result[key];
        else result[key] ??= value;
    }
    return result;
}

test("badge validation accepts zero, configured, and Off instances", () => {
    assert.deepEqual(validateBadges([], model), []);
    assert.deepEqual(validateBadges([artifact, distinct], model), [artifact, distinct]);
    const { phase, ...withoutDestination } = distinct;
    assert.deepEqual(validateBadges([withoutDestination], model), [withoutDestination]);
    assert.deepEqual(validateBadges([{ ...distinct, inputs: { ...distinct.inputs,
        items: [{ phase: "specify", outputs: ["specs/<slug>/spec.md"] }] } }], model).length, 1);
});

test("badge category is required, bounded, and plain text", () => {
    const { category: _category, ...missing } = artifact;
    assert.throws(() => validateBadges([missing], model), /unexpected or missing fields/);
    assert.equal(validateBadges([{ ...artifact, category: "x".repeat(80) }], model).length, 1);
    for (const category of ["", "   ", "x".repeat(81), "<b>Severity</b>", "Sev\nerity", 42]) {
        assert.throws(() => validateBadges([{ ...artifact, category }], model), /invalid category/);
    }
});

test("badge validation checks membership and distinct artifact sets", () => {
    const bad = (entry, reason) => assert.throws(() => validateBadges([entry], model), reason);
    bad({ ...artifact, inputs: { item: { phase: "plan", output: "specs/<slug>/spec.md" } } },
        /invalid artifact input/);
    bad({ ...distinct, inputs: { ...distinct.inputs, items: [] } },
        /invalid artifact-set input/);
    bad({ ...distinct, inputs: { ...distinct.inputs, items: [
        { phase: "specify", outputs: ["specs/<slug>/spec.md", "specs/<slug>/spec.md"] }] } },
    /duplicate artifact/);
    bad({ ...distinct, inputs: { ...distinct.inputs, completion: "other" } },
        /invalid phase input/);
    bad({ ...artifact, inputs: { wrong: artifact.inputs.item } }, /rule inputs/);
});

test("Value match requires a confirmed output and bounded ordered entries", () => {
    const config = { ...model, badgeRules: [...model.badgeRules,
        { id: "value-match", inputs: [{ id: "artifact", type: "artifact" },
            { id: "choices", type: "badge-selection" }], textPlaceholders: [] }],
    badgeTypes: [...model.badgeTypes,
        { id: "value-match", rule: "value-match", enabled: true }] };
    const choice = { id: "review", value: "Verdict: needs-clarification", text: "Review",
        phaseText: "Review phase", color: "amber" };
    const { text: _text, phaseText: _phaseText, ...base } = artifact;
    const matching = { ...base, type: "value-match",
        inputs: { artifact: artifact.inputs.item, choices: [choice] } };
    const saved = validateBadges([matching], config)[0];
    assert.deepEqual(saved.inputs.choices, [choice]);
    assert.notEqual(saved.inputs.choices[0], choice);
    assert.doesNotThrow(() => validateBadges([{ ...matching,
        inputs: { ...matching.inputs, choices: [{ ...choice, value: "x".repeat(256) }] } }], config));
    for (const value of ["", "  ", "x".repeat(257), "line\nbreak"]) {
        assert.throws(() => validateBadges([{ ...matching,
            inputs: { ...matching.inputs, choices: [{ ...choice, value }] } }], config),
        /invalid badge selection/);
    }
    assert.throws(() => validateBadges([{ ...matching,
        inputs: { ...matching.inputs, artifact: { phase: "plan", output: "missing.md" } } }],
    config), /invalid artifact input/);
    assert.throws(() => validateBadges([{ ...matching, text: "Needs review" }], config),
        /text must be present exactly/, "Value match text lives on its entries");
    const { phaseText: _entryPhase, ...noPhase } = choice;
    for (const entry of [{ ...choice, summaryText: "Review" }, noPhase]) {
        assert.throws(() => validateBadges([{ ...matching,
            inputs: { ...matching.inputs, choices: [entry] } }], config),
        /invalid badge selection/, "entry text follows the badge placements");
    }
    const other = { ...matching, id: "badge-3", color: "blue", inputs: { ...matching.inputs,
        choices: [{ ...choice, id: "other-review" }] } };
    assert.throws(() => validateBadges([matching, other], config), /duplicate phase\/output target/);
    assert.equal(validateBadges([matching, { ...other, inputs: { ...matching.inputs,
        choices: [{ ...choice, phaseText: "Other phase" }] } }], config).length, 2,
    "entries that differ only in phase text are distinct badges");
    const distinctChoices = [{ ...choice, id: "other-review", value: "Verdict: approved" }];
    const distinct = validateBadges([matching, { ...other, inputs: { ...matching.inputs,
        choices: distinctChoices } }], config);
    assert.deepEqual(distinct[1].inputs.choices, distinctChoices);
});

test("Checklist complete requires a declared, ordered currentness chain and independent target", () => {
    const config = { ...model, badgeRules: [...model.badgeRules,
        { id: "checklist-complete", inputs: [{ id: "artifact", type: "artifact" },
            { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
                before: "artifact", minItems: 1 },
            { id: "targetphase", type: "phase" }], textPlaceholders: [] }],
    badgeTypes: [...model.badgeTypes,
        { id: "checklist-complete", rule: "checklist-complete", enabled: true }] };
    const complete = { ...artifact, type: "checklist-complete", text: "Complete", phaseText: "Complete",
        inputs: { artifact: { phase: "plan", output: "specs/<slug>/plan.md" },
            prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" }],
            targetphase: "plan" } };
    assert.deepEqual(validateBadges([complete], config), [complete]);
    assert.throws(() => validateBadges([{ ...complete,
        inputs: { artifact: complete.inputs.artifact } }], config), /rule inputs/);
    assert.throws(() => validateBadges([{ ...complete, inputs: { ...complete.inputs,
        prerequisites: [] } }], config), /ordered outputs/);
    assert.throws(() => validateBadges([{ ...complete, inputs: { ...complete.inputs,
        prerequisites: [complete.inputs.artifact] } }], config), /workflow order/);
    assert.throws(() => validateBadges([{ ...complete, inputs: { ...complete.inputs,
        targetphase: "missing" } }], config), /invalid phase input/);
    assert.throws(() => validateBadges([{ ...complete, inputs: {
        artifact: complete.inputs.artifact,
        prerequisite: complete.inputs.prerequisites[0],
    } }], config), /rule inputs/);
});

test("Artifact stale requires an ordered declared upstream chain", () => {
    const config = { ...model, badgeRules: [...model.badgeRules,
        { id: "artifact-stale", inputs: [{ id: "artifact", type: "artifact", scope: "metadata" },
            { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
                before: "artifact", minItems: 1 }], textPlaceholders: [] }],
    badgeTypes: [...model.badgeTypes,
        { id: "artifact-stale", rule: "artifact-stale", enabled: true }] };
    const stale = { ...artifact, type: "artifact-stale", text: "Stale", phaseText: "Stale",
        inputs: { artifact: { phase: "plan", output: "specs/<slug>/plan.md" },
            prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" }] } };
    assert.deepEqual(validateBadges([stale], config), [stale]);
    assert.throws(() => validateBadges([{ ...stale,
        inputs: { artifact: stale.inputs.artifact } }], config), /rule inputs/);
    for (const prerequisites of [[], [stale.inputs.artifact],
        [{ phase: "specify", output: "missing.md" }],
        [stale.inputs.prerequisites[0], stale.inputs.prerequisites[0]]]) {
        assert.throws(() => validateBadges([{ ...stale,
            inputs: { ...stale.inputs, prerequisites } }], config),
        /Invalid Designer badge/);
    }
});

test("Phase artifact complete accepts one declared earlier output per phase in order", () => {
    const config = { ...model, phases: [...model.phases, "tasks"],
        outputs: { ...model.outputs, tasks: { outputs: ["specs/<slug>/tasks.md"] } },
        badgeRules: [...model.badgeRules, { id: "phase-artifact-complete",
            placementPhaseInput: "target", textPlaceholders: [],
            inputs: [{ id: "target", type: "artifact", scope: "metadata" },
                { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
                    before: "target" }] }],
        badgeTypes: [...model.badgeTypes,
            { id: "phase-artifact-complete", rule: "phase-artifact-complete", enabled: true }] };
    const target = { phase: "tasks", output: "specs/<slug>/tasks.md" };
    const previous = { phase: "specify", output: "specs/<slug>/spec.md" };
    const plan = { phase: "plan", output: "specs/<slug>/plan.md" };
    const badge = { ...artifact, type: "phase-artifact-complete", text: "Complete",
        showIn: ["workflow-list", "workflow-summary"], phase: null,
        phaseText: "Phase complete", summaryText: "Complete",
        targets: [{ phase: "tasks", output: null }],
        inputs: { target, prerequisites: [previous, plan] } };
    assert.deepEqual(validateBadges([badge], config), [badge]);
    assert.deepEqual(validateBadges([{ ...badge, inputs: {
        target: previous, prerequisites: [] }, targets: [{ phase: "specify", output: null }] }],
    config).length, 1);
    for (const prerequisites of [
        [plan, previous], [previous, previous], [plan, plan],
        [{ phase: "plan", output: "missing.md" }], [target],
    ]) {
        assert.throws(() => validateBadges([{ ...badge,
            inputs: { target, prerequisites } }], config), /Invalid Designer badge/);
    }
    assert.throws(() => validateBadges([{ ...badge,
        targets: [{ phase: "plan", output: null }] }], config),
    /target phase/);
});

test("replacement group is optional type metadata and requires a target-phase rule", () => {
    const type = { id: "phase-artifact-complete", title: "Phase artifact complete",
        description: "Complete", rule: "phase-artifact-complete",
        defaultText: "Complete", defaultColor: "green", enabled: true };
    assert.doesNotThrow(() => validateBadgeSettings({
        schemaVersion: 1, types: [type],
    }, "badge settings"));
    assert.doesNotThrow(() => validateBadgeSettings({
        schemaVersion: 1, types: [{ ...type, replacementGroup: "phase-completion" }],
    }, "badge settings"));
    for (const replacementGroup of ["", "Phase Completion", 42, null]) {
        assert.throws(() => validateBadgeSettings({
            schemaVersion: 1, types: [{ ...type, replacementGroup }],
        }, "badge settings"), /invalid badge type definition/);
    }
    const grouped = { ...model,
        badgeTypes: model.badgeTypes.map((entry) => entry.id === "artifact"
            ? { ...entry, replacementGroup: "phase-completion" } : entry) };
    assert.throws(() => validateBadges([artifact], grouped),
        /replacement group requires a target phase artifact/);
});

test("badge validation checks identity, placeholders, color, placements, and cap", () => {
    const bad = (entry, reason) => assert.throws(() => validateBadges([entry], model), reason);
    bad({ ...artifact, id: "Badge-1" }, /invalid or duplicate id/);
    bad({ ...artifact, id: "badge_1" }, /invalid or duplicate id/);
    bad({ ...artifact, id: "-badge" }, /invalid or duplicate id/);
    bad({ ...artifact, type: "disabled" }, /disabled badge type/);
    bad({ ...artifact, text: "Unknown {other}" }, /unknown text token/);
    bad({ ...artifact, color: "chartreuse" }, /invalid color/);
    bad({ ...artifact, showIn: ["workflow-list", "workflow-list"] }, /invalid placement/);
    bad({ ...artifact, showIn: [], phase: "plan" }, /phase-card destination/);
    bad({ ...artifact, phase: "other" }, /phase-card destination/);
    assert.throws(() => validateBadges([artifact, artifact], model), /duplicate id/);
    const many = Array.from({ length: 100 },
        (_, index) => ({ ...artifact, id: `badge-${index}`, type: `type-${index}` }));
    assert.equal(validateBadges(many, { ...model, badgeTypes: [...model.badgeTypes,
        ...many.map(({ type }) => ({ id: type, rule: "artifact-rule", enabled: true }))] }).length, 100);
    assert.throws(() => validateBadges(Array.from({ length: 101 }, () => artifact), model),
        /at most 100/);
});

test("Constitution evidence can target its project card or declared output", () => {
    const constitution = { phase: "speckit.constitution", output: ".specify/memory/constitution.md" };
    const withConstitution = { ...model, phases: [constitution.phase, ...model.phases],
        outputs: { ...model.outputs, [constitution.phase]: {
            outputs: [constitution.output], view: constitution.output,
        } } };
    const global = fit({ ...artifact, inputs: { item: constitution },
        showIn: ["workflow-list"], phase: null });
    assert.deepEqual(validateBadges([global], withConstitution), [global]);
    assert.deepEqual(validateBadges([fit({ ...global, showIn: ["phase-card"],
        phase: constitution.phase })], withConstitution).length, 1);
    for (const output of [null, constitution.output]) {
        assert.deepEqual(validateBadges([fit({ ...global, targets: [{
            phase: constitution.phase, output,
        }] })], withConstitution).length, 1);
        assert.throws(() => validateBadges([{ ...artifact, showIn: ["workflow-list"],
            phase: null, targets: [{ phase: constitution.phase, output }] }],
        withConstitution), /project placement requires project-level rule inputs/);
    }
    assert.throws(() => validateBadges([{ ...artifact, showIn: ["phase-card"],
        phase: constitution.phase }], withConstitution),
    /project placement requires project-level rule inputs/);
    assert.deepEqual(validateBadges([artifact], withConstitution), [artifact]);
    assert.throws(() => validateBadges([{ ...distinct, targets: [{
        phase: constitution.phase, output: null,
    }] }], withConstitution), /project placement requires project-level rule inputs/);
    const phaseModel = { ...withConstitution,
        badgeRules: [...withConstitution.badgeRules,
            { id: "run", inputs: [{ id: "phase", type: "phase" }], textPlaceholders: [] }],
        badgeTypes: [...withConstitution.badgeTypes,
            { id: "run", rule: "run", enabled: true }] };
    const phaseBadge = fit({ ...global, type: "run", text: "Phase complete",
        inputs: { phase: "specify" }, targets: [{ phase: constitution.phase, output: null }] });
    assert.throws(() => validateBadges([phaseBadge], phaseModel),
        /project placement requires project-level rule inputs/);
    assert.deepEqual(validateBadges([{ ...phaseBadge, inputs: {
        phase: constitution.phase,
    } }], phaseModel).length, 1);
    assert.deepEqual(validateBadges([{ ...phaseBadge, targets: [{
        phase: "specify", output: null,
    }] }], phaseModel).length, 1);
    assert.throws(() => validateBadges([{ ...global, targets: [{
        phase: constitution.phase, output: "undeclared.md",
    }] }], withConstitution), /phase\/output placement/);
});

test("duplicate badges require shared placement text, inputs, and overlapping targets", () => {
    const first = { ...artifact, showIn: ["workflow-list"], phase: null,
        targets: [{ phase: "specify", output: null },
            { phase: "plan", output: "specs/<slug>/plan.md" }] };
    const duplicate = fit({ ...first, id: "another",
        color: "pink", showIn: ["workflow-summary"],
        targets: [{ phase: "plan", output: "specs/<slug>/plan.md" }] });
    assert.equal(duplicate.phaseText, first.phaseText);
    assert.throws(() => validateBadges([first, duplicate], model),
        /duplicate phase\/output target already covered by badge badge-1/,
        "the same phase text on the same phase card is a duplicate");
    assert.throws(() => validateBadges([artifact, fit({ ...artifact, id: "another",
        color: "blue", showIn: ["workflow-summary"], phase: null,
        targets: [{ phase: "plan", output: null }] })], model),
    /duplicate phase\/output target/);
    assert.doesNotThrow(() => validateBadges([first, { ...duplicate,
        phaseText: "Different {status}" }], model));
    assert.doesNotThrow(() => validateBadges([artifact, { ...artifact, id: "another",
        inputs: { item: { phase: "plan", output: "specs/<slug>/plan.md" } },
        text: "Plan ready" }], model));
    assert.doesNotThrow(() => validateBadges([first, { ...duplicate,
        targets: [{ phase: "plan", output: null }] }], model));
    assert.doesNotThrow(() => validateBadges([first, { ...duplicate,
        targets: [{ phase: "specify", output: "specs/<slug>/spec.md" }] }], model));
    assert.doesNotThrow(() => validateBadges([first, { ...duplicate,
        inputs: { item: { phase: "plan", output: "specs/<slug>/plan.md" } } }], model));
    const summary = fit({ ...artifact, showIn: ["workflow-summary"], phase: null, summaryText: "Critical" });
    assert.doesNotThrow(() => validateBadges([summary, { ...summary, id: "another",
        summaryText: "High" }], model), "different summary-only text is not a duplicate");
    assert.throws(() => validateBadges([summary, { ...summary, id: "another", color: "red" }], model),
        /duplicate phase\/output target/);
    assert.throws(() => validateBadges([distinct, { ...distinct, id: "another",
        inputs: { completion: "plan", items: [{ phase: "specify",
            outputs: ["specs/<slug>/notes.md", "specs/<slug>/spec.md"] }] },
        color: "orange" }], model), /duplicate phase\/output target/);
});

test("badge placement pairs remain specific to their own phase and output", () => {
    const badge = { ...artifact, showIn: ["workflow-list"], phase: null,
        targets: [{ phase: "specify", output: "specs/<slug>/spec.md" },
            { phase: "plan", output: "specs/<slug>/plan.md" },
            { phase: "plan", output: null }] };
    assert.deepEqual(validateBadges([badge], model), [badge]);
    assert.throws(() => validateBadges([{ ...badge, targets: [
        { phase: "plan", output: "specs/<slug>/spec.md" }] }], model),
    /invalid phase\/output placement/);
    assert.throws(() => validateBadges([{ ...badge, targets: [
        badge.targets[0], badge.targets[0]] }], model), /duplicate phase\/output placement/);
    assert.throws(() => validateBadges([{ ...badge, showIn: ["phase-card"] }], model),
        /invalid phase\/output placements/);
    assert.throws(() => validateBadges([{ ...badge, type: "phase-only", text: "Done",
        inputs: { completion: "plan" }, targets: [
            { phase: "plan", output: "specs/<slug>/plan.md" }] }], {
        ...model, badgeRules: [...model.badgeRules,
            { id: "phase-only", inputs: [{ id: "completion", type: "phase" }] }],
        badgeTypes: [...model.badgeTypes,
            { id: "phase-only", rule: "phase-only", enabled: true }],
    }), /invalid phase\/output placement/);
});

test("placement text is required exactly for selected placements, without summary tokens", () => {
    const configured = { ...artifact, showIn: ["workflow-list", "workflow-summary"],
        phase: null, targets: [{ phase: "specify", output: null }],
        text: "List {status}", phaseText: "Phase {status}", summaryText: "Workflows in review" };
    assert.deepEqual(validateBadges([configured], model), [configured]);
    const invalid = /text must be present exactly for each selected placement/;
    for (const change of [{ summaryText: "Files ({status})" }, { summaryText: "Review: {count}" },
        { summaryText: "x".repeat(121) },
        { showIn: ["workflow-list"] }, { targets: [] }]) {
        assert.throws(() => validateBadges([{ ...configured, ...change }], model), invalid);
    }
    assert.throws(() => validateBadges([{ ...configured, phaseText: "Phase {workflows}" }], model),
        /unknown text token workflows/);
    for (const key of ["text", "phaseText", "summaryText"]) {
        const { [key]: _removed, ...missing } = configured;
        assert.throws(() => validateBadges([missing], model), invalid,
            `${key} has no fallback when its placement is selected`);
    }
});
