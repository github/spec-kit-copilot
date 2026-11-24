import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { validBadgeSelections as designerSelections } from
    "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/ui/badge-selection-contract.js";
import { validBadgeSelections as generatedSelections } from
    "../extension-canvas-design/generated-scaffold/contracts/badge-selection.mjs";
import { findDuplicateBadge } from
    "../../plugins/spec-kit-copilot-wizard/extensions/speckit-canvas-designer/ui/badge-duplicates.js";

const entry = (id, value, color) => ({ id, value, color, text: id });
const listOnly = { workflow: true, phase: false, summary: false };
const everywhere = { workflow: true, phase: true, summary: true };

test("Designer and generated contracts accept only valid ordered selections", () => {
    const valid = [entry("critical", "Critical", "red"), entry("low", "Low", "blue")];
    const placed = { ...valid[0], phaseText: "Critical phase", summaryText: "Critical" };
    for (const validate of [designerSelections, generatedSelections]) {
        assert.equal(validate(valid, listOnly), true);
        assert.equal(validate(valid), false);
        assert.equal(validate([placed], everywhere), true);
        assert.equal(validate([placed], listOnly), false);
        assert.equal(validate(valid, everywhere), false);
        assert.equal(validate([{ ...placed, summaryText: "Critical: {workflows}" }], everywhere), false);
        assert.equal(validate([{ ...placed, summaryText: "Critical ({count})" }], everywhere), false);
        assert.equal(validate([{ ...placed, phaseText: "{count}" }], everywhere), false);
        assert.equal(validate([{ ...placed, summaryText: undefined }], everywhere), false);
        assert.equal(validate([], listOnly), false);
        assert.equal(validate([valid[0], valid[0]], listOnly), false);
        assert.equal(validate([{ ...valid[0], value: "" }], listOnly), false);
        assert.equal(validate([{ ...valid[0], value: "" }], listOnly, true), true);
        assert.equal(validate([{ ...valid[0], color: "invalid" }], listOnly), false);
        assert.equal(validate([{ ...placed, summaryText: "{other}" }], everywhere), false);
        assert.equal(validate([{ ...valid[0], extra: true }], listOnly), false);
        assert.equal(validate(Array.from({ length: 101 }, (_, index) =>
            entry(`item-${index}`, "value", "red")), listOnly), false);
    }
});

test("duplicate detection preserves the priority of ordered selections", () => {
    const choices = [entry("critical", "Critical", "red"), entry("low", "Low", "blue")]
        .map((choice) => ({ ...choice, phaseText: `${choice.text} phase`,
            summaryText: `${choice.text} summary` }));
    const badge = { id: "first", type: "match", category: "Severity", inputs: { choices },
        showIn: ["workflow-list", "workflow-summary", "phase-card"], phase: "plan" };
    const rule = { inputs: [{ id: "choices", type: "badge-selection" }] };
    assert.ok(findDuplicateBadge({ ...badge, id: "same", category: "Other" }, [badge], rule));
    const differentIds = choices.map((choice, index) => ({ ...choice, id: `other-${index}` }));
    assert.equal(findDuplicateBadge({ ...badge, id: "different-ids",
        inputs: { choices: differentIds } }, [badge], rule), badge);
    for (const [key, value] of [["value", "Different"], ["text", "Different"],
        ["phaseText", "Different phase"], ["summaryText", "Different summary"], ["color", "purple"]]) {
        assert.equal(findDuplicateBadge({ ...badge, id: `different-${key.toLowerCase()}`, inputs: {
            choices: [{ ...differentIds[0], [key]: value }, differentIds[1]],
        } }, [badge], rule), undefined);
    }
    assert.equal(findDuplicateBadge({ ...badge, id: "renamed",
        inputs: { choices: choices.map((choice) => ({ ...choice, text: `${choice.id}!` })) } },
    [badge], rule), undefined);
    assert.equal(findDuplicateBadge({ ...badge, id: "reordered",
        inputs: { choices: [...differentIds].reverse() } }, [badge], rule), undefined);
});

test("Designer duplicate detection compares the text of shared placements", () => {
    const badge = { id: "first", type: "done", category: "Progress", inputs: { phase: "plan" },
        summaryText: "Planned", showIn: ["workflow-summary"] };
    assert.equal(findDuplicateBadge({ ...badge, id: "other", summaryText: "Plan ready" }, [badge]),
        undefined);
    assert.ok(findDuplicateBadge({ ...badge, id: "same", category: "Other" }, [badge]));
    assert.equal(findDuplicateBadge({ ...badge, id: "input", inputs: { phase: "tasks" } }, [badge]),
        undefined);
});

test("ordered selections choose and count the first matching entry per workflow", async (t) => {
    const root = await mkdtemp(join(process.cwd(), ".badge-selection-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sdk = join(root, "sdk");
    await cp(new URL("../extension-canvas-design/generated-scaffold/", import.meta.url),
        sdk, { recursive: true });
    await mkdir(join(sdk, "badges"), { recursive: true });
    const adapter = await readFile(new URL(
        "../extension-canvas-design/generated-host/badges/adapters/content.mjs", import.meta.url));
    await writeFile(join(sdk, "badges", "content.mjs"), adapter);
    const runAdapter = await readFile(new URL(
        "../extension-canvas-design/generated-host/badges/adapters/run.mjs", import.meta.url));
    await writeFile(join(sdk, "badges", "run.mjs"), runAdapter);
    const { evaluateBadges, validateBadges } = await import(
        pathToFileURL(join(sdk, "badge-runtime.mjs")).href);
    for (const [workflow, content] of [["alpha", "Low and CRITICAL"], ["beta", "low"], ["gamma", "none"]]) {
        await mkdir(join(root, workflow));
        await writeFile(join(root, workflow, "bug.md"), content);
    }
    const placedEntry = (id, color) => ({ ...entry(id, id, color),
        phaseText: `${id} phase`, summaryText: id });
    const choices = [placedEntry("critical", "red"), placedEntry("high", "orange"),
        placedEntry("low", "blue")];
    const phase = { id: "assess", outputs: ["bugs/<slug>/bug.md"] };
    const rule = { id: "value-match", label: "Value match", description: "Match",
        adapter: "content", hash: createHash("sha256").update(adapter).digest("hex"),
        inputs: [{ id: "artifact", type: "artifact" }, { id: "choices", type: "badge-selection" }],
        textPlaceholders: [] };
    const type = { id: "value-match", title: "Value match", description: "Match",
        rule: rule.id, defaultText: "Match", defaultColor: "amber", enabled: true };
    const badge = { id: "severity", type: type.id, category: "Severity",
        inputs: { artifact: { phase: phase.id, output: phase.outputs[0] }, choices },
        color: "amber", showIn: ["workflow-list", "workflow-summary"], phase: null,
        targets: [{ phase: phase.id, output: null }] };
    const independentRule = { id: "phase-run-complete", label: "Done", description: "Done",
        adapter: "run", hash: createHash("sha256").update(runAdapter).digest("hex"),
        inputs: [{ id: "phase", type: "phase" }], textPlaceholders: [] };
    const independentType = { id: "done", title: "Done", description: "Done",
        rule: independentRule.id, defaultText: "Done", defaultColor: "green", enabled: true };
    const independent = { id: "done", type: "done", category: "Progress", inputs: { phase: phase.id },
        text: "Done", color: "green", showIn: ["workflow-list"], phase: null };
    const config = { instances: [badge, independent], types: [type, independentType],
        rules: [rule, independentRule] };
    validateBadges(config, [phase]);
    const invalid = (instance) => assert.throws(() => validateBadges(
        { ...config, instances: [instance, independent] }, [phase]));
    invalid({ ...badge, text: "Match" });
    invalid({ ...badge, inputs: { ...badge.inputs, choices: choices.map((choice) =>
        ({ ...choice, summaryText: `${choice.id} ({workflows})` })) } });
    invalid({ ...badge, inputs: { ...badge.inputs, choices: choices.map(
        ({ phaseText, ...choice }) => choice) } });
    const evaluate = () => evaluateBadges(config, { cwd: root, phases: [phase],
        workflows: ["alpha", "beta", "gamma"],
        outputPath: async (_, workflow) => `${workflow}/bug.md`,
        runFor: () => ({ status: "completed" }) });
    const result = await evaluate();
    assert.deepEqual(result.items.alpha.map(({ text, color }) => [text, color]),
        [["critical", "red"], ["Done", "green"]]);
    assert.deepEqual(result.items.beta.map(({ text, color }) => [text, color]),
        [["low", "blue"], ["Done", "green"]]);
    assert.deepEqual(result.items.gamma.map(({ text }) => text), ["Done"]);
    assert.deepEqual(result.summary.map(({ text, count }) => [text, count]),
        [["critical: 1", 1], ["high: 0", 0], ["low: 1", 1]]);
    assert.deepEqual(result.summary.map(({ category }) => category),
        ["Severity", "Severity", "Severity"]);
    assert.deepEqual(result.items.alpha.map(({ category }) => category), ["Severity", "Progress"]);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.items.alpha[0].phaseText, "critical phase");
    assert.equal(result.items.beta[0].phaseText, "low phase");
    choices[0].phaseText = "Critical severity phase";
    choices[0].summaryText = "Critical severity";
    const renamed = await evaluate();
    assert.equal(renamed.items.alpha[0].phaseText, "Critical severity phase");
    assert.equal(renamed.items.alpha[0].text, "critical");
    assert.equal(renamed.summary[0].text, "Critical severity: 1");
    assert.equal(renamed.summary[2].text, "low: 1");
    choices[0].phaseText = "critical phase";
    choices[0].summaryText = "critical";
    choices.reverse();
    const reordered = await evaluate();
    assert.equal(reordered.items.alpha[0].text, "low");
    assert.deepEqual(reordered.summary.map(({ text }) => text), ["low: 2", "high: 0", "critical: 0"]);
    assert.equal(reordered.summary[0].id, result.summary[2].id);
    const incompatible = "export const contractVersion = 1; export function evaluate() {"
        + " return { match: true, selection: 'forged' }; }";
    await writeFile(join(sdk, "badges", "invalid.mjs"), incompatible);
    rule.adapter = "invalid";
    rule.hash = createHash("sha256").update(incompatible).digest("hex");
    const rejected = await evaluate();
    assert.ok(rejected.diagnostics.some((message) => message.includes("incompatible selection")));
    assert.deepEqual(rejected.summary.map(({ count }) => count), [0, 0, 0]);
    assert.deepEqual(rejected.items.alpha.map(({ text }) => text), ["Done"]);
});
