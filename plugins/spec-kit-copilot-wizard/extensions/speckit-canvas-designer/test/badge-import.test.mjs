import assert from "node:assert/strict";
import { test } from "node:test";
import { generatedBadgeEnvelope, validateBadgeImport } from "../contracts/badge-import.mjs";
import { validateBadgeImportRequest, validateBadgeImportResponse, validateBadgeImportError }
    from "../ui/badge-import-contract.js";

const type = { schemaVersion: 1, id: "run", title: "Run", description: "A completed run",
    rule: "run", defaultText: "Done", defaultColor: "blue", enabled: true };
const rule = { schemaVersion: 1, id: "run", label: "Run", description: "A completed run",
    inputs: [{ id: "phase", type: "phase" }], textPlaceholders: [], adapter: "run-evaluator" };
const fingerprint = "a".repeat(64);
const model = {
    revision: "resolved-model", phases: ["specify", "plan"],
    outputs: { specify: { outputs: ["spec.md"], view: "spec.md" },
        plan: { outputs: ["plan.md"], view: null } },
    badgeTypes: [type], badgeRules: [rule],
    badgeInputControls: [{ rule: "run" }],
    templates: [{ kind: "generated.badge-rule-adapter", name: rule.adapter, hash: fingerprint }],
};
const badge = (id = "done") => ({ id, type: type.id, category: "Progress",
    inputs: { phase: "plan" }, text: `Done ${id}`, color: "blue", showIn: ["workflow-list"] });

function config(instances = [badge()]) {
    return structuredClone({ schemaVersion: 1,
        canvas: { id: "source", displayName: "Source", description: "", workflowListName: "Workflows" },
        userProvidesSlug: false, showSetup: false, phases: model.phases,
        phaseArtifacts: model.outputs, phaseOutputs: {}, workflowPage: {},
        installed: { presets: [], extensions: [], bundles: [] },
        badges: { instances, types: [{ ...type, hash: "b".repeat(64) }],
            rules: [{ ...rule, hash: fingerprint }] } });
}

test("import appends every instance without normalization or mutating either input", () => {
    const source = config([{ ...badge(), phase: null, targets: [] }, badge("second")]);
    const draft = [badge("existing")];
    const before = structuredClone({ source, draft });
    const combined = validateBadgeImport(source, draft, model);
    assert.deepEqual(combined, [...draft, ...source.badges.instances]);
    assert.deepEqual({ source, draft }, before);
    assert.equal(Object.hasOwn(combined[2], "phase"), false, "optional fields remain absent");
    combined[1].category = "Edited";
    assert.equal(source.badges.instances[0].category, "Progress", "no aliases into the selected file");
});

test("import requires a generated config envelope, not settings, snippets, or old badge formats", () => {
    for (const invalid of [null, [], [badge()], { badges: config().badges },
        { schemaVersion: 1, values: {}, badges: [badge()] },
        { ...config(), schemaVersion: 2 }]) {
        assert.throws(() => generatedBadgeEnvelope(invalid), /complete generated canvas-config/);
    }
    for (const missing of ["canvas", "phases", "phaseArtifacts", "phaseOutputs", "workflowPage",
        "installed", "userProvidesSlug", "showSetup"]) {
        const source = config();
        delete source[missing];
        assert.throws(() => generatedBadgeEnvelope(source), /complete generated canvas-config/);
    }
    for (const missing of ["badges", "instances", "types", "rules"]) {
        const source = config();
        if (missing === "badges") delete source.badges;
        else delete source.badges[missing];
        assert.throws(() => validateBadgeImport(source, [], model), /must contain badges/);
    }
    assert.throws(() => validateBadgeImport(config([]), [], model), /at least one badge/);
});

test("missing required fields and unavailable evidence reject the whole import with the existing reason", () => {
    for (const missing of ["id", "type", "category", "inputs", "color", "showIn", "text"]) {
        const source = config([badge("first"), badge("broken")]);
        delete source.badges.instances[1][missing];
        assert.throws(() => validateBadgeImport(source, [], model),
            /Invalid Designer badge 2.*(unexpected or missing fields|text must be present)/);
    }
    const source = config([badge(), { ...badge("unavailable"), inputs: { phase: "unknown" } }]);
    assert.throws(() => validateBadgeImport(source, [], model),
        /badge 2 \(unavailable\): invalid phase input phase/);
    source.badges.instances[1] = { ...badge("unavailable"), category: "" };
    assert.throws(() => validateBadgeImport(source, [], model), /badge 2.*invalid category/);
    source.badges.instances[1] = { ...badge("unavailable"), targets: [{ phase: "plan", output: "lost.md" }] };
    assert.throws(() => validateBadgeImport(source, [], model), /badge 2.*invalid phase\/output placement/);
    const draft = [badge("existing")];
    const before = structuredClone(draft);
    assert.throws(() => validateBadgeImport(source, draft, model));
    assert.deepEqual(draft, before);
});

test("duplicate IDs and semantic conflicts within the file or with the current draft reject atomically", () => {
    assert.throws(() => validateBadgeImport(config([badge(), badge()]), [], model), /duplicate id/);
    assert.throws(() => validateBadgeImport(config(), [badge()], model), /duplicate id/);
    const duplicate = { ...badge("different-id"), text: badge().text };
    assert.throws(() => validateBadgeImport(config([badge(), duplicate]), [], model),
        /duplicate phase\/output target already covered by badge done/);
    assert.throws(() => validateBadgeImport(config([duplicate]), [badge()], model),
        /duplicate phase\/output target already covered by badge done/);
});

test("the existing 100-badge limit applies to the combined draft", () => {
    const draft = Array.from({ length: 99 }, (_, index) => badge(`existing-${index}`));
    assert.equal(validateBadgeImport(config(), draft, model).length, 100);
    assert.throws(() => validateBadgeImport(config([badge(), badge("extra")]), draft, model),
        /at most 100 instances/);
    assert.equal(draft.length, 99);
});

test("compatibility uses behavior and evaluator hashes, not the whole settings hash or display copy", () => {
    const source = config();
    source.badges.types[0].hash = "c".repeat(64);
    source.badges.types[0].title = "Renamed";
    source.badges.rules[0].label = "Updated label";
    source.badges.rules[0].inputs[0] = { id: "phase", type: "phase", label: "A label" };
    assert.deepEqual(validateBadgeImport(source, [], model), [badge()]);
    for (const change of [
        (source) => { source.badges.types[0].enabled = false; },
        (source) => { source.badges.types[0].replacementGroup = "progress"; },
        (source) => { source.badges.types[0].defaultColor = "red"; },
        (source) => { source.badges.rules[0].hash = "d".repeat(64); },
        (source) => { source.badges.rules[0].adapter = "different-evaluator"; },
        (source) => { source.badges.rules[0].textPlaceholders = ["count"]; },
        (source) => { source.badges.rules[0].inputs[0].type = "text"; },
    ]) {
        const changed = structuredClone(config());
        change(changed);
        assert.throws(() => validateBadgeImport(changed, [], model),
            /Cannot import badge 1 \(done\).*different|Cannot import badge 1 \(done\).*incompatible/);
    }
    const unverifiable = { ...model, templates: model.templates.map(({ hash: _hash, ...item }) => item) };
    assert.throws(() => validateBadgeImport(config(), [], unverifiable), /cannot be verified/);
});

test("missing, duplicated, unknown, and malformed imported definitions fail closed", () => {
    for (const change of [
        (source) => { source.badges.types = []; },
        (source) => { source.badges.rules = []; },
        (source) => { delete source.badges.rules[0].hash; },
        (source) => { delete source.badges.types[0].enabled; },
        (source) => { source.badges.rules.push(source.badges.rules[0]); },
        (source) => { source.badges.types.push(source.badges.types[0]); },
        (source) => { source.badges.rules[0].module = "data:text/javascript,throw new Error()"; },
        (source) => { source.badges.types[0].code = "throw new Error()"; },
        (source) => { source.badges.types.push({ ...source.badges.types[0], id: "unused" }); },
    ]) {
        const source = structuredClone(config());
        change(source);
        assert.throws(() => validateBadgeImport(source, [], model),
            /missing generated|Invalid or duplicate|unused types or rules/);
    }
    assert.throws(() => validateBadgeImport(config(), [], { ...model, badgeTypes: [] }), /missing badge type/);
    assert.throws(() => validateBadgeImport(config(), [], {
        ...model, badgeTypes: [{ ...type, enabled: false }],
    }), /disabled badge type/);
});

test("nonpersisting request and response contracts reject incompatible exchanges", () => {
    const request = { schemaVersion: 1, modelRevision: model.revision,
        config: config(), badges: [], outputs: model.outputs };
    assert.equal(validateBadgeImportRequest(request), request);
    for (const invalid of [null, { ...request, schemaVersion: 2 }, { ...request, badges: {} },
        { ...request, outputs: [] }, { ...request, modelRevision: "" },
        { ...request, save: true }]) {
        assert.throws(() => validateBadgeImportRequest(invalid), /Invalid Designer badge import request/);
    }
    const response = { schemaVersion: 1, badges: [badge()] };
    assert.equal(validateBadgeImportResponse(response, [badge()]), response);
    for (const invalid of [{ ...response, schemaVersion: 2 }, { ...response, badges: [] },
        { ...response, saved: true }, { schemaVersion: 1, badges: [{ ...badge(), category: "Changed" }] }]) {
        assert.throws(() => validateBadgeImportResponse(invalid, [badge()]), /incompatible badge import result/);
    }
    assert.equal(validateBadgeImportError({ error: "Bad badge" }).error, "Bad badge");
    assert.throws(() => validateBadgeImportError({ error: "" }), /incompatible badge import error/);
});
