import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBadgeInputControls, validateBadgeInputBinding,
    validateBadgeInputControl } from "../contracts/external-badge-input-control.mjs";
import { validateBadges } from "../contracts/external-badges.mjs";
import { mountBadgeInputAdapter } from "../ui/external-control-adapter-contract.js";

const entry = (kind, name, document) => ({ kind, name, sourceId: "fixture", document });
const rule = entry("generated.badge-rule-definition", "fixture-rule", {
    id: "fixture", inputs: [{ id: "phase", type: "phase" }],
});
const type = entry("designer.badges-settings-definition", "fixture-settings", {
    id: "fixture", rule: "fixture", enabled: true,
});
const control = entry("designer.badge-input-control", "fixture-control", {
    schemaVersion: 1, id: "fixture.input", adapter: "fixture-adapter", inputTypes: ["phase"],
});
const binding = entry("designer.badge-input-binding", "fixture-binding", {
    schemaVersion: 1, id: "fixture", rule: "fixture", control: "fixture.input",
});
const adapter = entry("designer.badge-input-adapter", "fixture-adapter");

test("Designer control registry binds a rule to its declared input types", () => {
    validateBadgeInputControl(control.document, control.name);
    validateBadgeInputBinding(binding.document, binding.name);
    assert.deepEqual(resolveBadgeInputControls([control, binding, adapter], [type], [rule]), [{
        rule: "fixture", control: "fixture.input", adapter: "fixture-adapter",
        binding: "fixture-binding", definition: "fixture-control", sourceId: "fixture",
    }]);
});

test("output declaration capability is explicit and bounded at resolution", () => {
    const declared = { ...control, document: {
        ...control.document, capabilities: ["declare-markdown-output"],
    } };
    validateBadgeInputControl(declared.document, declared.name);
    assert.deepEqual(resolveBadgeInputControls([declared, binding, adapter], [type], [rule]), [{
        rule: "fixture", control: "fixture.input", adapter: "fixture-adapter",
        binding: "fixture-binding", definition: "fixture-control", sourceId: "fixture",
        capabilities: ["declare-markdown-output"],
    }]);
    for (const capabilities of [[], ["unknown"], ["declare-markdown-output", "unknown"]]) {
        assert.throws(() => validateBadgeInputControl({
            ...control.document, capabilities,
        }, control.name), /invalid Designer badge input control/);
    }
});

test("badge adapter mount requires declaration opt-in on both sides before exposing the host action", () => {
    const bindingWithDeclaration = { control: "fixture.input", adapter: "fixture-adapter",
        capabilities: ["declare-markdown-output"] };
    let action;
    let cleared = 0;
    const root = { replaceChildren() { cleared++; } };
    const context = { root, onDeclareFile: (phase, path) => [phase, path] };
    const capable = { controlId: bindingWithDeclaration.control, contractVersion: 1,
        declaresMarkdownOutput: true,
        mount({ onDeclareFile }) {
            action = onDeclareFile;
            assert.throws(() => action("specify", "notes.md"), /before control mount/);
            return { isReady: () => true, handlesOutputDeclaration: true };
        } };
    const handle = mountBadgeInputAdapter(capable, bindingWithDeclaration, context);
    assert.equal(handle.isReady(), true);
    assert.deepEqual(action("specify", "notes.md"), ["specify", "notes.md"]);
    assert.throws(() => mountBadgeInputAdapter(capable, {
        ...bindingWithDeclaration, capabilities: undefined,
    }, context), /Incompatible Designer badge input adapter/);
    assert.throws(() => mountBadgeInputAdapter(capable, {
        ...bindingWithDeclaration, capabilities: ["unknown"],
    }, context), /Incompatible Designer badge input capabilities/);
    assert.throws(() => mountBadgeInputAdapter(capable, bindingWithDeclaration,
        { root }), /output declaration is unavailable/);
    assert.throws(() => mountBadgeInputAdapter({
        ...capable, mount({ onDeclareFile }) {
            action = onDeclareFile;
            return { isReady: () => true };
        },
    }, bindingWithDeclaration, context), /Incompatible Designer badge input declaration handle/);
    assert.equal(cleared, 1);
    assert.throws(() => action("specify", "notes.md"), /before control mount/);
    const legacy = { controlId: "fixture.input", contractVersion: 1,
        mount(options) {
            assert.equal(Object.hasOwn(options, "onDeclareFile"), false);
            return { isReady: () => true };
        } };
    mountBadgeInputAdapter(legacy, { control: "fixture.input", adapter: "fixture-adapter" },
        context);
    assert.throws(() => mountBadgeInputAdapter({
        ...legacy, mount() { return { handlesOutputDeclaration: true }; },
    }, { control: "fixture.input", adapter: "fixture-adapter" }, context),
    /Incompatible Designer badge input declaration handle/);
});

test("selection adapters require a compatible placement context and update handle", () => {
    const root = { replaceChildren() {} };
    const selectionRoot = { replaceChildren() {} };
    const context = { root, selectionRoot, rule: { inputs: [{ id: "choices", type: "badge-selection" }] },
        placements: { summary: true, workflow: false, phase: false } };
    const selectionAdapter = { controlId: "fixture.input", contractVersion: 1,
        mount({ placements }) {
            assert.deepEqual(placements, context.placements);
            return { isReady: () => true, updatePlacements() {} };
        } };
    const match = { control: "fixture.input", adapter: "fixture-adapter" };
    assert.equal(typeof mountBadgeInputAdapter(selectionAdapter, match, context).updatePlacements, "function");
    assert.throws(() => mountBadgeInputAdapter(selectionAdapter, match, {
        ...context, placements: { summary: true, workflow: false, phase: "yes" },
    }), /Invalid Designer badge selection context/);
    assert.throws(() => mountBadgeInputAdapter({ ...selectionAdapter, mount: () => ({}) }, match, context),
        /Incompatible Designer badge selection handle/);
});

test("Designer badge controls fail explicitly on missing, duplicate, and incompatible links", () => {
    assert.throws(() => resolveBadgeInputControls([binding, adapter], [type], [rule]),
        /missing Designer badge input control fixture.input/);
    assert.throws(() => resolveBadgeInputControls([control, binding], [type], [rule]),
        /missing Designer badge input adapter fixture-adapter/);
    assert.throws(() => resolveBadgeInputControls([control, adapter], [type], [rule]),
        /missing Designer badge input binding for fixture/);
    assert.throws(() => resolveBadgeInputControls([control, binding, adapter,
        { ...binding, name: "duplicate-binding" }], [type], [rule]),
    /duplicate badge rule\/control binding fixture/);
    assert.throws(() => resolveBadgeInputControls([{ ...control,
        document: { ...control.document, inputTypes: ["artifact"] } }, binding, adapter],
    [type], [rule]), /does not support fixture.phase/);
    assert.throws(() => validateBadgeInputBinding({ ...binding.document, id: "other" },
        "fixture-binding"), /invalid Designer badge rule\/control binding/);
});

test("unused rules need no editor, but enabled and saved badges retain dependency checks", () => {
    const unused = entry("generated.badge-rule-definition", "unused-rule", {
        id: "unused", inputs: [{ id: "phase", type: "phase" }],
    });
    const disabled = entry("designer.badges-settings-definition", "disabled-type", {
        id: "disabled", rule: "unused", enabled: false,
    });
    assert.deepEqual(resolveBadgeInputControls([control, binding, adapter],
        [type, disabled], [rule, unused]), [{
        rule: "fixture", control: "fixture.input", adapter: "fixture-adapter",
        binding: "fixture-binding", definition: "fixture-control", sourceId: "fixture",
    }]);
    assert.deepEqual(resolveBadgeInputControls([], [disabled], [unused]), []);
    assert.throws(() => resolveBadgeInputControls([], [
        { ...disabled, document: { ...disabled.document, enabled: true } },
    ], [unused]), /missing Designer badge input binding for unused/);
    assert.throws(() => resolveBadgeInputControls([binding], [disabled], [rule]),
        /missing Designer badge input control fixture.input/);
    const saved = { id: "saved", type: "disabled", category: "Status", inputs: { phase: "specify" },
        text: "Ready", color: "green", showIn: ["workflow-list"], targets: [] };
    assert.throws(() => validateBadges([saved], {
        badgeTypes: [disabled.document], badgeRules: [unused.document],
        badgeInputControls: [], phases: ["specify"],
    }), /disabled badge type disabled/);
});
