import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { evaluate as checklist } from
    "../extension-canvas-design/generated-host/badges/adapters/content.mjs";
import { evaluate as valueMatch } from
    "../extension-canvas-design/generated-host/badges/adapters/content.mjs";
import { badgesForTarget } from
    "../extension-canvas-design/generated-host/phase-control/generated-phase-adapter.mjs";

const generated = await mkdtemp(join(process.cwd(), ".generated-badge-package-"));
await cp(new URL("../extension-canvas-design/generated-scaffold/", import.meta.url),
    generated, { recursive: true });
await mkdir(join(generated, "badges"), { recursive: true });
for (const name of ["content", "artifact-state", "ordered-stale", "run"]) {
    await cp(new URL(`../extension-canvas-design/generated-host/badges/adapters/${name}.mjs`,
        import.meta.url), join(generated, "badges", `badge-rule-${name}-adapter.mjs`));
}
await cp(new URL("../extension-canvas-design/generated-host/badges/adapters/phase-artifact-complete.mjs",
    import.meta.url), join(generated, "badges", "badge-rule-phase-artifact-complete-adapter.mjs"));
const presetEvaluator = new URL("../../tests/fixtures/test-presets/copilot-badge-input-test/generated/evaluator.mjs",
    import.meta.url);
await cp(presetEvaluator, join(generated, "badges", "badge-rule-test-phase-adapter.mjs"));
const { evaluateBadges, validateBadges, verifyBadgeModules, summaryBadgeText } =
    await import(pathToFileURL(join(generated, "badge-runtime.mjs")).href);
const { validateWorkflowPageState } =
    await import(pathToFileURL(join(generated, "contracts", "external-host-adapter.mjs")).href);
const { createRuntime } = await import(pathToFileURL(join(generated, "runtime.mjs")).href);
const { countMarkdownDirectory } = await import(pathToFileURL(join(generated, "files.mjs")).href);
const { readBoundedWithMetadata } = await import(pathToFileURL(join(generated, "files.mjs")).href);
const { badgePlacements, badgeTextFields } =
    await import(pathToFileURL(join(generated, "contracts", "badge-selection.mjs")).href);

// Fixtures carry text for every placement; keep only the keys required by this badge's
// placements, moving Value match text onto its choices.
function placed(badge) {
    const placements = badgePlacements(badge);
    const keep = (value) => Object.fromEntries(Object.entries(value).filter(([key]) =>
        !Object.entries(badgeTextFields).some(([place, field]) => field === key && !placements[place])));
    const choices = badge.inputs?.choices;
    if (!Array.isArray(choices)) return keep(badge);
    const { text: _text, phaseText: _phaseText, summaryText: _summaryText, ...rest } = badge;
    return { ...rest, inputs: { ...badge.inputs, choices: choices.map(keep) } };
}

test("summary labels always append the workflow count", () => {
    assert.equal(summaryBadgeText("Needs review", 2), "Needs review: 2");
    assert.equal(summaryBadgeText("Critical", 3), "Critical: 3");
    assert.equal(summaryBadgeText("Needs review", 0), "Needs review: 0");
});

test("shared Value interpolates per workflow but summaries count workflows, not token totals", async () => {
    const source = `export const contractVersion = 1;
        export function evaluate({ workflowId }) {
            return { match: workflowId !== "gamma", summaryCount: 37,
                values: { count: workflowId === "alpha" ? 2 : 7, status: "ready" } };
        }`;
    const adapter = "shared-value-test";
    await writeFile(join(generated, "badges", `${adapter}.mjs`), source);
    const config = {
        instances: [{ id: "shared", type: "shared", category: "Quality", inputs: { phase: "review" },
            text: "Checks ({count}) - {status}", phaseText: "Phase checks ({count})",
            summaryText: "Checks", color: "blue",
            showIn: ["workflow-list", "workflow-summary"], phase: null,
            targets: [{ phase: "review", output: null }] }],
        types: [{ id: "shared", rule: "shared", title: "Checks", description: "Checks",
            defaultText: "Checks", defaultColor: "blue", enabled: true }],
        rules: [{ id: "shared", label: "Checks", description: "Checks", adapter,
            hash: createHash("sha256").update(source).digest("hex"),
            inputs: [{ id: "phase", type: "phase" }], textPlaceholders: ["count", "status"] }],
    };
    const phases = [{ id: "review", outputs: [] }];
    validateBadges(config, phases);
    const evaluate = (workflows) => evaluateBadges(config, { cwd: generated, phases,
        workflows, outputPath: async () => null, runFor: () => null });
    assert.equal((await evaluate([])).summary[0].text, "Checks: 0");
    const result = await evaluate(["alpha", "beta", "gamma"]);
    assert.equal(result.items.alpha[0].text, "Checks (2) - ready");
    assert.equal(result.items.beta[0].text, "Checks (7) - ready");
    assert.equal(result.items.alpha[0].phaseText, "Phase checks (2)");
    assert.equal(result.items.beta[0].phaseText, "Phase checks (7)");
    assert.equal(result.items.alpha[0].category, "Quality");
    assert.deepEqual(result.items.gamma, []);
    assert.deepEqual(result.summary, [{ id: "shared", category: "Quality", color: "blue", count: 2,
        text: "Checks: 2" }]);
    assert.deepEqual(result.diagnostics, []);
});

test("badge text and freshness metadata come from the same validated artifact", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".badge-artifact-version-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await writeFile(join(cwd, "artifact.md"), "old");
    const replacement = join(cwd, "replacement.md");
    await writeFile(replacement, "new");
    await utimes(replacement, new Date("2024-01-01"), new Date("2024-01-01"));
    await rename(replacement, join(cwd, "artifact.md"));
    const evidence = await readBoundedWithMetadata(cwd, "artifact.md", 128 * 1024);
    assert.deepEqual(evidence, { text: "new", mtimeMs: (await stat(join(cwd, "artifact.md"))).mtimeMs });
});

const moduleFile = new URL("../extension-canvas-design/generated-host/badges/adapters/content.mjs",
    import.meta.url);
const hash = createHash("sha256").update(await readFile(moduleFile)).digest("hex");
const rule = { id: "checklist-progress", label: "Progress", description: "Progress",
    inputs: [{ id: "artifact", type: "artifact" },
        { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
            before: "artifact", minItems: 1 },
        { id: "targetphase", type: "phase" }],
    textPlaceholders: ["completed", "total", "percent"],
    adapter: "badge-rule-content-adapter", hash };
const type = { id: "progress", title: "Progress", description: "Progress",
    rule: rule.id, defaultText: "{completed}/{total} complete", defaultColor: "blue", enabled: true };
const instance = { id: "work", type: type.id, category: "Checklist", inputs: { artifact: {
    phase: "tasks", output: "specs/<slug>/tasks.md",
}, prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" }],
targetphase: "tasks" }, text: "{completed}/{total} complete",
phaseText: "{completed}/{total} complete", summaryText: "Checklist progress", color: "blue",
    showIn: ["workflow-list", "workflow-summary", "phase-card"], phase: "tasks" };
const badges = { instances: [instance], types: [type], rules: [rule] };
async function writeSpec(cwd, workflow = "specs/alpha") {
    await mkdir(join(cwd, workflow), { recursive: true });
    await writeFile(join(cwd, workflow, "spec.md"), "# Specification");
    await utimes(join(cwd, workflow, "spec.md"),
        new Date(1_600_000_000_000), new Date(1_600_000_000_000));
}
const projectRule = { ...rule, id: "value-match",
    inputs: [{ id: "artifact", type: "artifact" }, { id: "choices", type: "badge-selection" }],
    textPlaceholders: [] };
const projectType = { ...type, id: "value-match", rule: projectRule.id };
const projectInputs = (artifact) => ({ artifact, choices: [{ id: "adopted", value: "adopted",
    text: "Progress", phaseText: "Project ready", summaryText: "Progress", color: "blue" }] });

test("generated runtime requires a category and token-free per-placement text", () => {
    const phases = [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
        { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }];
    assert.doesNotThrow(() => validateBadges(badges, phases));
    const { category: _category, ...uncategorized } = instance;
    for (const badge of [uncategorized, ...["", " ", "x".repeat(81), "<b>", "Tab\t"]
        .map((category) => ({ ...instance, category }))]) {
        assert.throws(() => validateBadges({ ...badges, instances: [badge] }, phases),
            /Invalid generated badge instance/);
    }
    for (const summaryText of ["Progress ({workflows})", "{count}", "{completed} done"]) {
        assert.throws(() => validateBadges({ ...badges, instances: [{ ...instance, summaryText }] },
            phases), /Invalid generated badge text/);
    }
    const { phaseText: _phaseText, ...withoutPhase } = instance;
    assert.throws(() => validateBadges({ ...badges, instances: [withoutPhase] }, phases),
        /Invalid generated badge text/);
    assert.throws(() => validateBadges({ ...badges, instances: [{ ...instance,
        showIn: ["workflow-list"], phase: null }] }, phases), /Invalid generated badge text/);
    const valueMatch = placed({ ...instance, type: projectType.id, showIn: ["workflow-list"],
        phase: null, inputs: projectInputs(instance.inputs.artifact) });
    const both = { instances: [valueMatch], types: [projectType], rules: [projectRule] };
    assert.doesNotThrow(() => validateBadges(both, phases));
    assert.throws(() => validateBadges({ ...both, instances: [{ ...valueMatch, text: "Progress" }] },
        phases), /Invalid generated badge text/);
    assert.throws(() => validateBadges({ ...both, instances: [{ ...valueMatch, inputs: {
        ...valueMatch.inputs, choices: valueMatch.inputs.choices.map((choice) =>
            ({ ...choice, summaryText: "Progress" })) } }] }, phases), /Invalid generated badge input/);
});

test("generated rules require the adapter key rather than the former module key", () => {
    const { adapter, ...withoutAdapter } = rule;
    assert.doesNotThrow(() => validateBadges(badges, ["specify", "tasks"]));
    assert.throws(() => validateBadges({ ...badges, rules: [{
        ...withoutAdapter, module: adapter,
    }] }, ["specify", "tasks"]), /Invalid generated badge rule/);
    assert.throws(() => validateBadges({ ...badges, rules: [{
        ...rule, module: adapter,
    }] }, ["specify", "tasks"]), /Invalid generated badge rule/);
});

test("generated runtime validates Constitution card and declared output placements", () => {
    const constitution = { id: "speckit.constitution", project: true,
        outputs: [".specify/memory/constitution.md"] };
    const phases = [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
        { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }, constitution];
    const global = placed({ ...instance, type: projectType.id, inputs: projectInputs({
        phase: constitution.id, output: constitution.outputs[0],
    }), showIn: ["workflow-list"], phase: null });
    const globalBase = { ...instance, type: projectType.id, inputs: projectInputs({
        phase: constitution.id, output: constitution.outputs[0],
    }), showIn: ["workflow-list"], phase: null };
    const both = { instances: [global], types: [type, projectType], rules: [rule, projectRule] };
    assert.doesNotThrow(() => validateBadges(both, phases));
    assert.throws(() => validateBadges({ ...badges, instances: [{
        ...instance, phase: constitution.id,
    }] }, phases), /Project badge placement requires project-level rule inputs/);
    assert.doesNotThrow(() => validateBadges({ ...both, instances: [instance] }, phases));
    for (const output of [null, constitution.outputs[0]]) {
        assert.doesNotThrow(() => validateBadges({ ...both, instances: [placed({
            ...globalBase, targets: [{ phase: constitution.id, output }],
        })] }, phases));
        assert.throws(() => validateBadges({ ...both, instances: [placed({
            ...instance, showIn: ["workflow-list"], phase: null,
            targets: [{ phase: constitution.id, output }],
        })] }, phases), /Project badge placement requires project-level rule inputs/);
    }
    assert.throws(() => validateBadges({ ...both, instances: [placed({
        ...globalBase, targets: [{ phase: constitution.id, output: "undeclared.md" }],
    })] }, phases), /Invalid generated badge instance/);
    assert.throws(() => validateBadges({ ...both, instances: [placed({
        ...instance, showIn: [], phase: null, targets: [
            { phase: constitution.id, output: null }, { phase: "tasks", output: null },
        ],
    })] }, phases), /Project badge placement requires project-level rule inputs/);
    const phaseRule = { ...rule, id: "phase-run-complete",
        inputs: [{ id: "phase", type: "phase" }] };
    const phaseType = { ...type, id: "phase-run-complete", rule: phaseRule.id };
    const phaseBadge = placed({ ...instance, type: phaseType.id, inputs: { phase: "tasks" },
        showIn: ["workflow-list"], phase: null, targets: [{ phase: constitution.id, output: null }] });
    const phaseConfig = { instances: [phaseBadge], types: [phaseType], rules: [phaseRule] };
    assert.throws(() => validateBadges(phaseConfig, phases),
        /Project badge placement requires project-level rule inputs/);
    assert.doesNotThrow(() => validateBadges({ ...phaseConfig, instances: [{
        ...phaseBadge, inputs: { phase: constitution.id },
    }] }, phases));
});

test("project Constitution badges evaluate without workflows and do not count as workflow summary", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-constitution-badge-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, ".specify", "memory"), { recursive: true });
    await writeFile(join(cwd, ".specify", "memory", "constitution.md"), "- [x] adopted\n");
    const phase = { id: "speckit.constitution", project: true,
        outputs: [".specify/memory/constitution.md"] };
    const projectBadge = placed({ ...instance, type: projectType.id, inputs: projectInputs({
        phase: phase.id, output: phase.outputs[0],
    }), targets: [{ phase: phase.id, output: null }],
    showIn: ["workflow-list", "workflow-summary"], phase: null });
    const config = { instances: [projectBadge], types: [projectType], rules: [projectRule] };
    const evaluate = (workflows) => evaluateBadges(config, { cwd, workflows,
        phases: [phase], outputPath: async ({ output }) => output,
        runFor: () => null });
    const empty = await evaluate([]);
    assert.equal(validateWorkflowPageState({ model: { userProvidesSlug: false, badges: empty },
        phaseState: { slugEditable: false } }).model.badges.project.length, 1);
    assert.deepEqual(empty.project.map(({ text }) => text), ["Progress"],
        JSON.stringify(empty.diagnostics));
    assert.deepEqual(empty.items, {});
    assert.equal(empty.summary[0].count, 0);
    const existing = await evaluate(["specs/alpha"]);
    assert.equal(existing.project.length, 1);
    assert.equal(existing.summary[0].count, 1);
    await rm(join(cwd, ".specify", "memory", "constitution.md"));
    assert.deepEqual((await evaluate([])).project, []);
});

test("project-only badges do not consume workflow evaluation, while mixed placements do", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-project-only-badge-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, ".specify", "memory"), { recursive: true });
    await writeFile(join(cwd, ".specify", "memory", "constitution.md"), "- [x] adopted\n");
    await writeFile(join(cwd, ".specify", "memory", "other.md"), "- [x] adopted\n");
    for (const workflow of ["alpha", "beta"]) {
        await mkdir(join(cwd, "specs", workflow), { recursive: true });
        await writeSpec(cwd, `specs/${workflow}`);
        await writeFile(join(cwd, "specs", workflow, "tasks.md"), "- [x] done\n");
    }
    const projectPhase = { id: "speckit.constitution", project: true,
        outputs: [".specify/memory/constitution.md", ".specify/memory/other.md"] };
    const projectBase = { ...instance, id: "project-only", type: projectType.id,
        inputs: projectInputs({ phase: projectPhase.id, output: projectPhase.outputs[0] }),
        showIn: [], phase: null, targets: [{ phase: projectPhase.id, output: null }] };
    const projectOnly = placed(projectBase);
    const workflowBase = { ...instance, id: "workflow-only", showIn: ["workflow-list"], phase: null };
    const workflowOnly = placed(workflowBase);
    const mixed = placed({ ...projectBase, id: "mixed", showIn: ["workflow-summary"],
        inputs: projectInputs({ phase: projectPhase.id, output: projectPhase.outputs[1] }) });
    const mixedTarget = placed({ ...workflowBase, id: "mixed-target", showIn: [],
        targets: [{ phase: projectPhase.id, output: null }, { phase: "tasks", output: null }] });
    const configured = { instances: [projectOnly, workflowOnly, mixed],
        types: [type, projectType], rules: [rule, projectRule] };
    const phases = [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
        projectPhase, { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }];
    assert.throws(() => validateBadges({ ...configured, instances: [mixedTarget] }, phases),
        /Project badge placement requires project-level rule inputs/);
    validateBadges(configured, phases);
    const calls = [];
    const result = await evaluateBadges(configured, { cwd, workflows: ["alpha", "beta"], phases,
        outputPath: async ({ phase, output }, workflow) => {
            calls.push([output, workflow]);
            return phase === projectPhase.id ? output
                : `specs/${workflow}/${phase === "specify" ? "spec" : "tasks"}.md`;
        }, runFor: () => null });
    assert.deepEqual(result.project.map(({ id }) => id), ["project-only", "mixed"]);
    for (const workflow of ["alpha", "beta"]) {
        assert.deepEqual(result.items[workflow].map(({ id }) => id),
            ["workflow-only", "mixed"]);
    }
    assert.deepEqual(calls.filter(([output]) => output === projectPhase.outputs[0]),
        [[projectPhase.outputs[0], "project"]]);
    assert.deepEqual(calls.filter(([output]) => output === projectPhase.outputs[1]),
        ["project", "alpha", "beta"].map((workflow) => [projectPhase.outputs[1], workflow]));
    assert.equal(result.summary[0].count, 2);
    assert.deepEqual(result.diagnostics, []);
});

test("custom phase-run evaluator matches project Constitution without a workflow", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-project-run-badge-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const phase = { id: "speckit.constitution", project: true,
        outputs: [".specify/memory/constitution.md"] };
    const preset = { types: [{ id: "test-phase", rule: "test-phase", title: "Phase confirmed",
        description: "Test control", defaultText: "Phase confirmed", defaultColor: "purple",
        enabled: true }],
    rules: [{ id: "test-phase", label: "Phase confirmed", description: "Run completed",
        inputs: [{ id: "phase", type: "phase" }], textPlaceholders: [],
        adapter: "badge-rule-test-phase-adapter",
        hash: createHash("sha256").update(await readFile(presetEvaluator)).digest("hex") }],
    instances: [{ id: "confirmed", type: "test-phase", category: "Runs", inputs: { phase: phase.id },
        phaseText: "Phase confirmed", color: "purple", showIn: ["phase-card"], phase: phase.id }] };
    validateBadges(preset, [phase]);
    await verifyBadgeModules(preset);
    const evaluate = (status) => evaluateBadges(preset, { cwd, workflows: [],
        phases: [phase], outputPath: async () => { throw new Error("No output input"); },
        runFor: () => status && { status } });
    assert.deepEqual((await evaluate("Completed")).project.map(({ phaseText }) => phaseText),
        ["Phase confirmed"]);
    assert.deepEqual((await evaluate("Failed")).project, []);
});
const fileRule = { ...rule, id: "markdown-file-count",
    inputs: [{ id: "artifact", type: "artifact", scope: "directory" }],
    textPlaceholders: ["count"] };
const fileType = { ...type, id: "markdown-file-count", title: "Markdown files",
    rule: fileRule.id, defaultText: "Files ({count})" };
const fileInstance = { id: "files", type: fileType.id, category: "Files",
    inputs: { artifact: { phase: "review", output: "work/<slug>/review/<name>.md" } },
    text: "Files ({count})", summaryText: "Files", color: "blue",
    showIn: ["workflow-list", "workflow-summary"], phase: null };
const fileBadges = { instances: [fileInstance], types: [fileType], rules: [fileRule] };
const completeRule = { ...rule, id: "checklist-complete",
    inputs: [{ id: "artifact", type: "artifact", label: "Checklist output" },
        { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
            before: "artifact", minItems: 1, label: "Earlier outputs" },
        { id: "targetphase", type: "phase" }],
    textPlaceholders: [] };
const completeType = { ...type, id: "checklist-complete", title: "Checklist complete",
    rule: completeRule.id, defaultText: "Checklist complete" };
const completeInstance = { ...instance, id: "completed", type: completeType.id,
    inputs: { artifact: { phase: "tasks", output: "specs/<slug>/tasks.md" },
        prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" },
            { phase: "plan", output: "specs/<slug>/plan.md" }], targetphase: "tasks" },
    text: "Checklist complete", phaseText: "Checklist complete", summaryText: "Checklists complete" };
const completeBadges = { instances: [completeInstance], types: [completeType],
    rules: [completeRule] };
const phaseArtifactAdapter = new URL(
    "../extension-canvas-design/generated-host/badges/adapters/phase-artifact-complete.mjs",
    import.meta.url);
const phaseArtifactRule = { id: "phase-artifact-complete", label: "Phase artifact complete",
    description: "Ordered phase outputs", placementPhaseInput: "target",
    inputs: [{ id: "target", type: "artifact", scope: "metadata" },
        { id: "prerequisites", type: "ordered-artifacts", scope: "metadata", before: "target" }],
    textPlaceholders: [], adapter: "badge-rule-phase-artifact-complete-adapter",
    hash: createHash("sha256").update(await readFile(phaseArtifactAdapter)).digest("hex") };
const phaseArtifactType = { ...type, id: "phase-artifact-complete",
    title: "Phase artifact complete", rule: phaseArtifactRule.id,
    defaultText: "Phase complete" };
const phaseArtifactInstance = { ...instance, id: "phase-artifact",
    type: phaseArtifactType.id, text: "List ready", phase: null,
    showIn: ["workflow-list", "workflow-summary"],
    phaseText: "Card ready", summaryText: "Workflows ready",
    targets: [{ phase: "tasks", output: null }],
    inputs: { target: { phase: "tasks", output: "specs/<slug>/tasks.md" },
        prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" },
            { phase: "plan", output: "specs/<slug>/plan.md" }] } };
const phaseArtifactBadges = { instances: [phaseArtifactInstance],
    types: [phaseArtifactType], rules: [phaseArtifactRule] };

test("replacement groups require a valid target-phase rule and remain optional", () => {
    const phases = ["specify", "plan", "tasks"].map((id) =>
        ({ id, outputs: [`specs/<slug>/${id === "specify" ? "spec" : id}.md`] }));
    assert.doesNotThrow(() => validateBadges(phaseArtifactBadges, phases));
    assert.doesNotThrow(() => validateBadges({
        ...phaseArtifactBadges, types: [{ ...phaseArtifactType,
            replacementGroup: "phase-completion" }],
    }, phases));
    for (const replacementGroup of ["", "Phase Completion", 42]) {
        assert.throws(() => validateBadges({
            ...phaseArtifactBadges, types: [{ ...phaseArtifactType, replacementGroup }],
        }, phases), /Invalid generated badge type/);
    }
    assert.throws(() => validateBadges({
        ...phaseArtifactBadges, rules: [{ ...phaseArtifactRule,
            placementPhaseInput: undefined }],
        types: [{ ...phaseArtifactType, replacementGroup: "phase-completion" }],
    }, phases), /Invalid generated badge type/);
});

test("replacement shows the latest matching phase per location without changing cumulative summaries", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-replacement-badge-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const phases = ["specify", "plan", "tasks"].map((id) => ({
        id, outputs: [`specs/<slug>/${id === "specify" ? "spec" : id}.md`,
            ...(id === "plan" ? ["specs/<slug>/research.md"] : [])],
    }));
    const artifact = (phase, filename) => ({
        phase, output: `specs/<slug>/${filename}.md`,
    });
    const badge = (id, target, prerequisites, placement = ["workflow-list", "workflow-summary"]) =>
        ({ ...phaseArtifactInstance, id, inputs: { target, prerequisites },
            text: `${id} ready`, summaryText: id,
            showIn: placement.filter((place) => place !== "phase-card"),
            targets: placement.includes("phase-card") ? [{ phase: target.phase, output: null }] : [] });
    const specify = badge("specify", artifact("specify", "spec"), [],
        ["workflow-list", "workflow-summary", "phase-card"]);
    const plan = badge("plan", artifact("plan", "plan"), [specify.inputs.target],
        ["workflow-list", "workflow-summary", "phase-card"]);
    const tasks = badge("tasks", artifact("tasks", "tasks"),
        [specify.inputs.target, plan.inputs.target],
        ["workflow-list", "workflow-summary", "phase-card"]);
    const { summaryText: _summaryText, ...ordinaryBase } = specify;
    const ordinary = { ...ordinaryBase, id: "ordinary", type: "ordinary",
        showIn: ["workflow-list"] };
    const group = { ...phaseArtifactType, replacementGroup: "phase-completion" };
    const config = { instances: [specify, plan, tasks, ordinary],
        types: [group, { ...phaseArtifactType, id: "ordinary", title: "Ordinary" }],
        rules: [phaseArtifactRule] };
    const file = (workflow, name) => join(cwd, workflow, `${name}.md`);
    const add = async (workflow, name, time) => {
        await mkdir(join(cwd, workflow), { recursive: true });
        await writeFile(file(workflow, name), "content");
        const date = new Date(1_600_000_000_000 + time);
        await utimes(file(workflow, name), date, date);
    };
    await add("specs/alpha", "spec", 1000);
    await add("specs/alpha", "plan", 2000);
    await add("specs/beta", "spec", 1000);
    const evaluate = async (selected = config) => {
        validateBadges(selected, phases);
        return evaluateBadges(selected, { cwd, workflows: ["specs/alpha", "specs/beta"],
            phases, outputPath: async ({ output }, workflow) =>
                output.replace("specs/<slug>", workflow),
            runFor: () => { throw new Error("Metadata badges must not inspect phase runs"); } });
    };
    const row = (result, workflow) => result.items[workflow]
        .filter((item) => item.showIn.includes("workflow-list")).map((item) => item.id);
    const card = (result, workflow, phase) =>
        badgesForTarget(result.items[workflow], phase).map((item) => item.id);
    const counts = (result) => result.summary.map(({ id, count }) => [id, count]);
    let result = await evaluate();
    assert.deepEqual(row(result, "specs/alpha"), ["plan", "ordinary"]);
    assert.deepEqual(card(result, "specs/alpha", "specify"), ["ordinary"]);
    assert.deepEqual(card(result, "specs/alpha", "plan"), ["plan"]);
    assert.deepEqual(row(result, "specs/beta"), ["specify", "ordinary"]);
    assert.deepEqual(counts(result), [["specify", 2], ["plan", 1], ["tasks", 0]]);
    const { summaryText: _planSummary, ...ordinaryPlan } = plan;
    result = await evaluate({ ...config, instances: [
        specify, plan, ordinary, { ...ordinaryPlan, id: "ordinary-plan", type: "ordinary",
            showIn: ["workflow-list"] },
    ] });
    assert.deepEqual(row(result, "specs/alpha"), ["plan", "ordinary", "ordinary-plan"]);
    result = await evaluate({ ...config, instances: [tasks, plan, ordinary, specify] });
    assert.deepEqual(row(result, "specs/alpha"), ["plan", "ordinary"]);
    await add("specs/alpha", "tasks", 3000);
    result = await evaluate();
    assert.deepEqual(row(result, "specs/alpha"), ["tasks", "ordinary"]);
    assert.deepEqual(card(result, "specs/alpha", "plan"), []);
    assert.deepEqual(counts(result), [["specify", 2], ["plan", 1], ["tasks", 1]]);
    await utimes(file("specs/alpha", "plan"), new Date(1_600_000_000_000),
        new Date(1_600_000_000_000));
    result = await evaluate();
    assert.deepEqual(row(result, "specs/alpha"), ["specify", "ordinary"]);
    assert.deepEqual(counts(result), [["specify", 2], ["plan", 0], ["tasks", 0]]);
    await rm(file("specs/alpha", "plan"));
    result = await evaluate();
    assert.deepEqual(card(result, "specs/alpha", "specify"), ["specify", "ordinary"]);
    assert.deepEqual(counts(result), [["specify", 2], ["plan", 0], ["tasks", 0]]);
    await add("specs/alpha", "plan", 2000);
    const { phaseText: _phaseText, ...listOnlySpecify } = specify;
    const independent = { ...config, instances: [
        { ...listOnlySpecify, targets: [] },
        placed({ ...plan, showIn: ["workflow-summary"], targets: plan.targets }),
    ] };
    result = await evaluate(independent);
    assert.deepEqual(row(result, "specs/alpha"), ["specify"]);
    assert.deepEqual(card(result, "specs/alpha", "specify"), []);
    assert.deepEqual(card(result, "specs/alpha", "plan"), ["plan"]);
    assert.deepEqual(counts(result), [["specify", 2], ["plan", 1]]);
    await add("specs/alpha", "research", 2000);
    const research = badge("research", artifact("plan", "research"),
        [specify.inputs.target], ["workflow-list", "workflow-summary", "phase-card"]);
    result = await evaluate({ ...config, instances: [specify, plan, research, ordinary] });
    assert.deepEqual(row(result, "specs/alpha"), ["plan", "research", "ordinary"]);
    assert.deepEqual(card(result, "specs/alpha", "plan"), ["plan", "research"]);
    assert.deepEqual(counts(result), [["specify", 2], ["plan", 1], ["research", 1]]);
});

test("ordered phase badge uses metadata only, compares neighbors and counts matching workflows", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-phase-artifact-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const phases = ["specify", "plan", "tasks"].map((id) =>
        ({ id, outputs: [`specs/<slug>/${id === "specify" ? "spec" : id}.md`] }));
    for (const name of ["alpha", "beta"]) {
        await mkdir(join(cwd, "specs", name), { recursive: true });
        for (const file of ["spec.md", "plan.md", "tasks.md"]) {
            await writeFile(join(cwd, "specs", name, file), Buffer.alloc(128 * 1024 + 1, 0xff));
        }
    }
    const path = (name, file) => join(cwd, "specs", name, file);
    for (const name of ["alpha", "beta"]) {
        for (const [offset, file] of ["spec.md", "plan.md", "tasks.md"].entries()) {
            await utimes(path(name, file), new Date(1_600_000_000_000 + 2000 * offset),
                new Date(1_600_000_000_000 + 2000 * offset));
        }
    }
    validateBadges(phaseArtifactBadges, phases);
    await verifyBadgeModules(phaseArtifactBadges);
    const evaluate = (config = phaseArtifactBadges) => evaluateBadges(config, { cwd,
        workflows: ["specs/alpha", "specs/beta"], phases,
        outputPath: async ({ output }, workflow) => output.replace("specs/<slug>", workflow),
        runFor: () => { throw new Error("Metadata rule must not consult phase runs"); } });
    const result = await evaluate();
    assert.deepEqual(result.summary, [{ id: "phase-artifact", category: "Checklist", color: "blue",
        count: 2, text: "Workflows ready: 2" }]);
    assert.deepEqual(result.items["specs/alpha"][0], {
        id: "phase-artifact", category: "Checklist", text: "List ready", phaseText: "Card ready", color: "blue",
        showIn: phaseArtifactInstance.showIn, targets: [{ phase: "tasks", output: null }],
    });
    for (const file of ["spec.md", "plan.md", "tasks.md"]) {
        await utimes(path("alpha", file), new Date(1_600_000_000_000),
            new Date(1_600_000_000_000));
    }
    assert.equal((await evaluate()).summary[0].count, 2);
    await utimes(path("beta", "plan.md"), new Date(1_600_000_000_000 - 2000),
        new Date(1_600_000_000_000 - 2000));
    assert.equal((await evaluate()).summary[0].count, 1);
    await rm(path("alpha", "plan.md"));
    assert.equal((await evaluate()).summary[0].count, 0);
    await mkdir(path("alpha", "plan.md"));
    const unsafe = await evaluate();
    assert.equal(unsafe.summary[0].count, 0);
    assert.ok(unsafe.diagnostics.some((message) => /could not be read safely/.test(message)));
    await rm(path("alpha", "plan.md"), { recursive: true });
    let hasLink = false;
    try {
        await symlink(path("alpha", "spec.md"), path("alpha", "plan.md"), "file");
        hasLink = true;
    } catch (error) {
        if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
        t.diagnostic("Symlink creation is unavailable in this environment");
    }
    if (hasLink) {
        const linked = await evaluate();
        assert.equal(linked.summary[0].count, 0);
        assert.ok(linked.diagnostics.some((message) => /could not be read safely/.test(message)));
        await rm(path("alpha", "plan.md"));
    }
    const targetOnly = { ...phaseArtifactBadges, instances: [{ ...phaseArtifactInstance,
        inputs: { target: { phase: "specify", output: "specs/<slug>/spec.md" },
            prerequisites: [] }, targets: [{ phase: "specify", output: null }] }] };
    assert.equal((await evaluate(targetOnly)).summary[0].count, 2);
    const skipPlan = { ...phaseArtifactBadges, instances: [{ ...phaseArtifactInstance,
        inputs: { ...phaseArtifactInstance.inputs,
            prerequisites: [phaseArtifactInstance.inputs.prerequisites[0]] } }] };
    assert.equal((await evaluate(skipPlan)).summary[0].count, 2);
    for (const invalid of [
        { ...phaseArtifactInstance.inputs, prerequisites: [phaseArtifactInstance.inputs.target] },
        { ...phaseArtifactInstance.inputs, prerequisites: [
            phaseArtifactInstance.inputs.prerequisites[1],
            phaseArtifactInstance.inputs.prerequisites[0]] },
    ]) {
        assert.throws(() => validateBadges({ ...phaseArtifactBadges,
            instances: [{ ...phaseArtifactInstance, inputs: invalid }] }, phases),
        /Invalid generated badge/);
    }
    assert.throws(() => validateBadges({ ...phaseArtifactBadges,
        instances: [{ ...phaseArtifactInstance, targets: [{ phase: "plan", output: null }] }] },
    phases), /phase-card destination/);
});

test("badge evaluator counts checkboxes outside fences and ignores empty checklists", async () => {
    const inputs = { artifact: { phase: "tasks", output: "tasks.md" },
        prerequisites: [{ phase: "specify", output: "spec.md" }], targetphase: "tasks" };
    const evidence = (text) => ({ readArtifact: async ({ phase }) => ({
        state: "ok", mtimeMs: phase === "specify" ? 1 : 2, text,
    }) });
    assert.deepEqual(await checklist({ ruleId: "checklist-progress", inputs,
        evidence: evidence("- [x] done\n- [ ] later\n```\n- [x] fake\n```") }),
    { match: true, values: { completed: 1, total: 2, percent: 50 } });
    assert.equal((await checklist({ ruleId: "checklist-complete",
        inputs, evidence: evidence("No work") })).match, false);
    assert.deepEqual(await valueMatch({ ruleId: "value-match", inputs: {
        artifact: { phase: "tasks", output: "tasks.md" },
        choices: [{ id: "review", value: "VERDICT: NEEDS-CLARIFICATION" }],
    }, evidence: { readArtifact: async () => ({
        state: "ok", text: "Verdict: needs-clarification",
    }) } }), { match: true, selection: "review" });
});

test("resolved badge instances evaluate per workflow using confined artifact reads", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-test-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "specs", "alpha"), { recursive: true });
    await writeSpec(cwd);
    await writeFile(join(cwd, "specs", "alpha", "tasks.md"),
        "- [x] first\n- [ ] second\n");
    validateBadges(badges, ["specify", "tasks"]);
    assert.throws(() => validateBadges({ ...badges, instances: [{
        ...instance, showIn: ["list", "summary", "phase"],
    }] }, ["specify", "tasks"]), /Invalid generated badge instance/);
    await verifyBadgeModules(badges);
    const phases = [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
        { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }];
    const result = await evaluateBadges(badges, { cwd,
        workflows: ["specs/alpha", "specs/beta"], phases,
        outputPath: async ({ phase }, workflow) =>
            `${workflow}/${phase === "specify" ? "spec" : "tasks"}.md`,
        runFor: () => null });
    assert.deepEqual(result.items["specs/alpha"], [{
        id: "work", category: "Checklist", text: "1/2 complete", phaseText: "1/2 complete", color: "blue",
        showIn: ["workflow-list", "workflow-summary", "phase-card"], phase: "tasks",
    }]);
    assert.deepEqual(result.items["specs/beta"], []);
    assert.deepEqual(result.summary, [{ id: "work", category: "Checklist", color: "blue", count: 1,
        text: "Checklist progress: 1" }]);
    const differentlyLabeled = { ...badges, instances: [instance, {
        ...instance, id: "other", text: "Checklist: {completed} of {total}",
    }] };
    validateBadges(differentlyLabeled, phases);
    const repeated = await evaluateBadges(differentlyLabeled, { cwd,
        workflows: ["specs/alpha"], phases,
        outputPath: async ({ phase }, workflow) =>
            `${workflow}/${phase === "specify" ? "spec" : "tasks"}.md`,
        runFor: () => null });
    assert.deepEqual(repeated.items["specs/alpha"].map(({ id, text }) => ({ id, text })), [
        { id: "work", text: "1/2 complete" },
        { id: "other", text: "Checklist: 1 of 2" },
    ]);
    assert.throws(() => validateBadges({ ...badges,
        instances: [{ ...instance, inputs: { ...instance.inputs,
            artifact: { phase: "not-declared" } } }] },
    ["specify", "tasks"]), /Invalid generated badge input/);
    await assert.rejects(() => verifyBadgeModules({ rules: [{ ...rule,
        hash: "0".repeat(64) }] }), /frozen hash/);
});

test("generated Checklist complete badges require ordered current evidence and a nonempty checklist", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-checklist-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const directory = join(cwd, "specs", "alpha");
    await mkdir(directory, { recursive: true });
    const spec = join(directory, "spec.md");
    const plan = join(directory, "plan.md");
    const tasks = join(directory, "tasks.md");
    await writeFile(spec, "# Specification");
    await writeFile(plan, "# Plan");
    await writeFile(tasks, "- [x] first\n- [x] second");
    const phases = [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
        { id: "plan", outputs: ["specs/<slug>/plan.md"] },
        { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }];
    validateBadges(completeBadges, phases);
    for (const input of [
        { ...completeInstance.inputs, prerequisites: [] },
        { ...completeInstance.inputs, prerequisites: [completeInstance.inputs.artifact] },
        { ...completeInstance.inputs, prerequisites:
            [...completeInstance.inputs.prerequisites].reverse() },
        { ...completeInstance.inputs, prerequisites: [
            completeInstance.inputs.prerequisites[0], completeInstance.inputs.artifact] },
        { ...completeInstance.inputs, artifact: completeInstance.inputs.prerequisites[0] },
        { ...completeInstance.inputs, targetphase: "undeclared" },
    ]) {
        assert.throws(() => validateBadges({ ...completeBadges,
            instances: [{ ...completeInstance, inputs: input }] }, phases),
        /Invalid generated badge/);
    }
    const evaluate = async () => evaluateBadges(completeBadges, { cwd,
        workflows: ["specs/alpha"], phases,
        outputPath: async ({ output }, workflow) => output.replace("specs/<slug>", workflow),
        runFor: () => null });
    await utimes(spec, new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    await utimes(plan, new Date(1_600_000_002_000), new Date(1_600_000_002_000));
    await utimes(tasks, new Date(1_600_000_004_000), new Date(1_600_000_004_000));
    assert.equal((await evaluate()).summary[0].count, 1);
    await utimes(plan, new Date(1_600_000_006_000), new Date(1_600_000_006_000));
    assert.equal((await evaluate()).summary[0].count, 0);
    await utimes(plan, new Date(1_600_000_002_000), new Date(1_600_000_002_000));
    await utimes(spec, new Date(1_600_000_003_000), new Date(1_600_000_003_000));
    assert.equal((await evaluate()).summary[0].count, 0);
    await utimes(spec, new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    await rm(plan);
    assert.equal((await evaluate()).summary[0].count, 0);
    await writeFile(plan, "# Plan");
    await utimes(plan, new Date(1_600_000_002_000), new Date(1_600_000_002_000));
    await writeFile(tasks, "No checklist items");
    assert.equal((await evaluate()).summary[0].count, 0);
    await writeFile(tasks, "- [x] first\n- [ ] second");
    assert.equal((await evaluate()).summary[0].count, 0);
    await mkdir(join(directory, "unsafe.md"));
    const unsafe = { ...completeBadges, instances: [{
        ...completeInstance, inputs: { ...completeInstance.inputs,
            artifact: { phase: "tasks", output: "specs/<slug>/unsafe.md" } },
    }] };
    const unsafePhases = phases.map((phase) => phase.id === "tasks"
        ? { ...phase, outputs: [...phase.outputs, "specs/<slug>/unsafe.md"] } : phase);
    const rejected = await evaluateBadges(unsafe, { cwd, workflows: ["specs/alpha"],
        phases: unsafePhases,
        outputPath: async ({ output }, workflow) => output.replace("specs/<slug>", workflow),
        runFor: () => null });
    assert.equal(rejected.summary[0].count, 0);
    assert.match(rejected.diagnostics.join(" "), /could not be read safely/);
});

test("Tasks and Implement checklists independently show both badges at 5/5", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-checklist-targets-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const phases = ["specify", "plan", "tasks", "implement"].map((id) => ({
        id, outputs: [`specs/<slug>/${id === "specify" ? "spec" : id}.md`],
    }));
    const tasksInputs = { artifact: { phase: "tasks", output: "specs/<slug>/tasks.md" },
        prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" },
            { phase: "plan", output: "specs/<slug>/plan.md" }], targetphase: "tasks" };
    const implementInputs = { artifact: { phase: "implement", output: "specs/<slug>/implement.md" },
        prerequisites: [...tasksInputs.prerequisites, tasksInputs.artifact],
        targetphase: "implement" };
    const config = { rules: [rule, completeRule], types: [type, completeType],
        instances: [tasksInputs, implementInputs].flatMap((inputs) => [
            { ...instance, id: `${inputs.targetphase}-progress`, inputs,
                phase: null, showIn: ["workflow-list", "workflow-summary"],
                targets: [{ phase: inputs.targetphase, output: null }] },
            { ...completeInstance, id: `${inputs.targetphase}-complete`, inputs,
                phase: null, showIn: ["workflow-list", "workflow-summary"],
                targets: [{ phase: inputs.targetphase, output: null }] },
        ]) };
    validateBadges(config, phases);
    await verifyBadgeModules(config);
    const checklistText = Array.from({ length: 5 }, (_, index) => `- [x] item ${index}`).join("\n");
    for (const name of ["alpha", "beta"]) {
        const folder = join(cwd, "specs", name);
        await mkdir(folder, { recursive: true });
        for (const [index, file] of ["spec.md", "plan.md", "tasks.md", "implement.md"].entries()) {
            await writeFile(join(folder, file), index < 2 ? `# ${file}`
                : name === "beta" && file === "tasks.md"
                    ? "- [x] one\n- [ ] two" : checklistText);
            await utimes(join(folder, file), new Date(1_600_000_000_000 + 2000 * index),
                new Date(1_600_000_000_000 + 2000 * index));
        }
    }
    const evaluate = () => evaluateBadges(config, { cwd,
        workflows: ["specs/alpha", "specs/beta"], phases,
        outputPath: async ({ output }, workflow) => output.replace("specs/<slug>", workflow),
        runFor: () => null });
    const result = await evaluate();
    assert.deepEqual(result.items["specs/alpha"].map(({ id, text }) => ({ id, text })), [
        { id: "tasks-progress", text: "5/5 complete" },
        { id: "tasks-complete", text: "Checklist complete" },
        { id: "implement-progress", text: "5/5 complete" },
        { id: "implement-complete", text: "Checklist complete" },
    ]);
    assert.deepEqual(result.items["specs/beta"].map(({ id }) => id),
        ["tasks-progress", "implement-progress", "implement-complete"]);
    assert.deepEqual(result.summary.map(({ id, count }) => ({ id, count })), [
        { id: "tasks-progress", count: 2 }, { id: "tasks-complete", count: 1 },
        { id: "implement-progress", count: 2 }, { id: "implement-complete", count: 2 },
    ]);
    assert.deepEqual(result.diagnostics, []);
    await rm(join(cwd, "specs", "beta", "plan.md"));
    assert.deepEqual((await evaluate()).items["specs/beta"], []);
});

test("directory-scoped output counts regular Markdown files across workflows and seeds zero", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-folders-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const first = join(cwd, "work", "alpha", "review");
    const second = join(cwd, "work", "beta", "review");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(first, "a.md"), "a");
    await writeFile(join(first, "B.MD"), "b");
    await writeFile(join(first, "notes.txt"), "not counted");
    await mkdir(join(first, "nested.md"));
    await writeFile(join(second, "c.md"), "c");
    const phases = [{ id: "review", outputs: ["work/<slug>/review/<name>.md"] }];
    validateBadges(fileBadges, phases);
    assert.throws(() => validateBadges({ ...fileBadges, rules: [{
        ...fileRule, inputs: [{ id: "artifact", type: "phase", scope: "directory" }],
    }] }, phases), /Invalid generated badge rule/);
    const evaluate = (workflows) => evaluateBadges(fileBadges, { cwd, workflows, phases,
        outputPath: async (_, workflow, { directory }) => {
            assert.equal(directory, true);
            return `${workflow}/review`;
        }, runFor: () => null });
    assert.deepEqual((await evaluate([])).summary, [{ id: "files", category: "Files", color: "blue",
        count: 0, text: "Files: 0" }]);
    const result = await evaluate(["work/alpha", "work/beta", "work/gamma"]);
    assert.deepEqual(result.summary, [{ id: "files", category: "Files", color: "blue",
        count: 2, text: "Files: 2" }]);
    assert.equal(result.items["work/alpha"][0].text, "Files (2)");
    assert.equal(result.items["work/beta"][0].text, "Files (1)");
    assert.deepEqual(result.items["work/gamma"], []);
    const scoped = { ...fileBadges, instances: [{ ...fileInstance,
        text: "{count} checklists", phaseText: "Phase: {count} checklists",
        summaryText: "Workflows with checklists",
        targets: [{ phase: "review", output: null }] }] };
    validateBadges(scoped, phases);
    const scopedResult = await evaluateBadges(scoped, { cwd,
        workflows: ["work/alpha", "work/beta", "work/gamma"], phases,
        outputPath: async (_, workflow) => `${workflow}/review`,
        runFor: () => null });
    assert.deepEqual(scopedResult.summary, [{ id: "files", category: "Files", color: "blue",
        count: 2, text: "Workflows with checklists: 2" }]);
    assert.equal(scopedResult.items["work/alpha"][0].text, "2 checklists");
    assert.equal(scopedResult.items["work/alpha"][0].phaseText, "Phase: 2 checklists");
    assert.equal(scopedResult.items["work/beta"][0].text, "1 checklists");
    assert.deepEqual(scopedResult.items["work/gamma"], []);
    try {
        await symlink(join(second, "c.md"), join(first, "linked.md"), "file");
    } catch (error) {
        if (error.code !== "EPERM") throw error;
    }
    assert.equal((await evaluate(["work/alpha"])).summary[0].count, 1);
});

test("directory badge reads a template output folder before any named file exists", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-template-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "work", "alpha", "review"), { recursive: true });
    const config = { canvas: { id: "directory-badge" }, phases: ["review"],
        phaseOutputs: { review: { expectsArtifact: true,
            outputPath: "work/<slug>/review/<name>.md" } },
        userProvidesSlug: false, badges: fileBadges };
    const runtime = await createRuntime({ config, cwd, workspace: cwd,
        session: { sessionId: "directory-badge", log: async () => {} } });
    try {
        const [snapshot, concurrent] = await Promise.all([runtime.snapshot(), runtime.snapshot()]);
        assert.notStrictEqual(snapshot.badges, concurrent.badges);
        assert.notStrictEqual(snapshot.badges.items, concurrent.badges.items);
        assert.deepEqual(snapshot.badges.summary, [{ id: "files", category: "Files", color: "blue",
            count: 0, text: "Files: 0" }]);
        assert.deepEqual(snapshot.badges.items["work/alpha"], []);
        assert.deepEqual(snapshot.badges.diagnostics, []);
        await writeFile(join(cwd, "work", "alpha", "review", "first.md"), "first");
        assert.deepEqual((await runtime.snapshot()).badges.items["work/alpha"], []);
        const updated = await runtime.refresh();
        assert.equal(updated.badges.items["work/alpha"][0].text, "Files (1)");
        assert.equal(updated.badges.summary[0].count, 1);
        updated.badges.items["work/alpha"][0].text = "Changed in another snapshot";
        assert.equal((await runtime.snapshot()).badges.items["work/alpha"][0].text, "Files (1)");
        await runtime.deleteWorkflow({ itemId: "work/alpha", confirmation: "alpha",
            revision: updated.revision });
        assert.deepEqual((await runtime.snapshot()).badges.items, {});
    } finally { runtime.close(); }
});

test("directory count errors surface diagnostics rather than claiming zero", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-directory-errors-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "work", "alpha"), { recursive: true });
    await writeFile(join(cwd, "work", "alpha", "review"), "not a directory");
    const result = await evaluateBadges(fileBadges, { cwd, workflows: ["work/alpha"],
        phases: [{ id: "review", outputs: ["work/<slug>/review/<name>.md"] }],
        outputPath: async () => "work/alpha/review", runFor: () => null });
    assert.deepEqual(result.items["work/alpha"], []);
    assert.match(result.diagnostics.join(" "), /could not be counted safely/);
});

test("overlapping snapshots evaluate badges once per revision", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-coalescing-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "work", "alpha"), { recursive: true });
    await writeFile(join(cwd, "work", "alpha", "review"), "not a directory");
    const logs = [];
    const config = { canvas: { id: "badge-coalescing" }, phases: ["review"],
        phaseOutputs: { review: { expectsArtifact: true,
            outputPath: "work/<slug>/review/<name>.md" } },
        userProvidesSlug: false, badges: fileBadges };
    const runtime = await createRuntime({ config, cwd, workspace: cwd,
        session: { sessionId: "badge-coalescing", log: async (message) => { logs.push(message); } } });
    const evaluations = () => logs.filter((message) => message.startsWith("Badge directory")).length;
    try {
        const [first, second] = await Promise.all([runtime.snapshot(), runtime.snapshot()]);
        assert.deepEqual(first.badges.items, second.badges.items);
        assert.equal(evaluations(), 1);
        await runtime.snapshot();
        assert.equal(evaluations(), 1);
        await runtime.refresh();
        assert.equal(evaluations(), 2);
    } finally { runtime.close(); }
});

test("Markdown directory count refuses unbounded enumeration", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-directory-limit-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "any-folder"));
    await Promise.all(Array.from({ length: 1001 }, (_, index) =>
        writeFile(join(cwd, "any-folder", `file-${index}.md`), "")));
    await assert.rejects(countMarkdownDirectory(cwd, "any-folder"), /1000-entry badge limit/);
});

test("generated badge runtime preserves distinct phase/output targets", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-targets-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "specs", "alpha"), { recursive: true });
    await writeSpec(cwd);
    await writeFile(join(cwd, "specs", "alpha", "tasks.md"), "- [x] done\n");
    const targeted = placed({ ...instance, showIn: [], phase: null,
        targets: [{ phase: "specify", output: "specs/<slug>/spec.md" },
            { phase: "plan", output: "specs/<slug>/plan.md" },
            { phase: "plan", output: null }] });
    const phases = [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
        { id: "plan", outputs: ["specs/<slug>/plan.md"] },
        { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }];
    validateBadges({ ...badges, instances: [targeted] }, phases);
    assert.throws(() => validateBadges({ ...badges, instances: [{
        ...targeted, targets: [{ phase: "plan", output: "specs/<slug>/spec.md" }],
    }] }, phases), /Invalid generated badge instance/);
    const result = await evaluateBadges({ ...badges, instances: [targeted] }, {
        cwd, workflows: ["specs/alpha"], phases,
        outputPath: async ({ phase }, workflow) =>
            `${workflow}/${phase === "specify" ? "spec" : "tasks"}.md`,
        runFor: () => null });
    assert.deepEqual(result.items["specs/alpha"][0].targets, targeted.targets);
});

test("generated runtime snapshots include badges for each workflow and the selected one", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-snapshot-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "specs", "alpha"), { recursive: true });
    await mkdir(join(cwd, "specs", "beta"), { recursive: true });
    await writeSpec(cwd);
    await writeFile(join(cwd, "specs", "alpha", "tasks.md"), "- [x] done\n");
    const config = { canvas: { id: "badge-snapshot" }, phases: ["specify", "tasks"],
        phaseOutputs: {
            specify: { expectsArtifact: true, outputPath: "specs/<slug>/spec.md" },
            tasks: { expectsArtifact: true, outputPath: "specs/<slug>/tasks.md" },
        },
        userProvidesSlug: false, badges };
    let notifications = 0;
    const runtime = await createRuntime({ config, cwd, workspace: cwd,
        session: { sessionId: "badge-snapshot", log: async () => {} },
        notify: () => { notifications++; } });
    try {
        let snapshot = await runtime.snapshot();
        assert.equal(snapshot.badges.items["specs/alpha"][0].text, "1/1 complete");
        assert.deepEqual(snapshot.badges.items["specs/beta"], []);
        assert.deepEqual(snapshot.badges.selected, []);
        await runtime.save({ revision: snapshot.revision, selected: "specs/alpha" });
        snapshot = await runtime.snapshot();
        assert.deepEqual(snapshot.badges.selected, snapshot.badges.items["specs/alpha"]);
        assert.equal(notifications, 0);
        await runtime.save({ revision: snapshot.revision, selected: "specs/beta" });
        snapshot = await runtime.snapshot();
        assert.deepEqual(snapshot.badges.selected, []);
        assert.equal(notifications, 0);
        await runtime.save({ revision: snapshot.revision, draft: {
            item: "specs/beta", phase: "tasks", value: "draft",
        } });
        assert.equal(notifications, 1);
        assert.equal((await runtime.snapshot()).revision, snapshot.revision + 1);
        const statePath = join(cwd, "generated-canvases",
            createHash("sha256").update(JSON.stringify([cwd, config.canvas.id])).digest("hex"),
            "state.json");
        const saved = JSON.parse(await readFile(statePath, "utf8"));
        assert.equal(saved.selected, "specs/beta");
        assert.equal(saved.drafts[JSON.stringify(["specs/beta", "tasks"])], "draft");
        assert.equal(await readFile(join(cwd, "specs", "alpha", "tasks.md"), "utf8"),
            "- [x] done\n");
    } finally { runtime.close(); }
});

test("accepted artifact and slug reports invalidate badges even when repeated", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-reports-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "work", "alpha", "review"), { recursive: true });
    await writeFile(join(cwd, "work", "alpha", "review", "first.md"), "first");
    const skill = join(cwd, ".github", "skills", "speckit-review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: speckit-review\n---\n");
    const config = { canvas: { id: "badge-reports" }, phases: ["review"],
        phaseOutputs: { review: { expectsArtifact: true,
            outputPath: "work/<slug>/review/<name>.md" } },
        userProvidesSlug: false, badges: fileBadges };
    const runtime = await createRuntime({ config, cwd, workspace: cwd,
        session: { sessionId: "badge-reports", send: async () => "message-1",
            rpc: { skills: { reload: async () => ({ errors: [] }) } },
            log: async () => {} } });
    try {
        assert.equal((await runtime.snapshot()).badges.items["work/alpha"][0].text, "Files (1)");
        const run = await runtime.run({ phase: "review", itemId: "work/alpha", args: "" }, "panel");
        await writeFile(join(cwd, "work", "alpha", "review", "second.md"), "second");
        assert.equal((await runtime.snapshot()).badges.items["work/alpha"][0].text, "Files (2)");
        await writeFile(join(cwd, "work", "alpha", "review", "third.md"), "third");
        await assert.rejects(runtime.report({ phaseRunId: run.runId,
            path: "work/alpha/review/invalid.txt" }, "panel"), /Markdown/);
        assert.equal((await runtime.snapshot()).badges.items["work/alpha"][0].text, "Files (2)");
        const report = { phaseRunId: run.runId, path: "work/alpha/review/first.md" };
        assert.equal((await runtime.report(report, "panel")).accepted, true);
        assert.equal((await runtime.snapshot()).badges.items["work/alpha"][0].text, "Files (3)");
        await writeFile(join(cwd, "work", "alpha", "review", "fourth.md"), "fourth");
        assert.equal((await runtime.report(report, "panel")).accepted, true);
        assert.equal((await runtime.snapshot()).badges.items["work/alpha"][0].text, "Files (4)");
        const newRun = await runtime.run({ phase: "review", itemId: "__new__", args: "" }, "panel");
        await mkdir(join(cwd, "work", "beta", "review"), { recursive: true });
        await writeFile(join(cwd, "work", "beta", "review", "first.md"), "first");
        const slug = { phaseRunId: newRun.runId, slug: "beta" };
        assert.equal((await runtime.reportSlug(slug, "panel")).accepted, true);
        assert.equal((await runtime.snapshot()).badges.items["work/beta"][0].text, "Files (1)");
        await writeFile(join(cwd, "work", "beta", "review", "second.md"), "second");
        await assert.rejects(runtime.reportSlug({ ...slug, slug: "gamma" }, "panel"),
            /already reported a different/);
        assert.equal((await runtime.snapshot()).badges.items["work/beta"][0].text, "Files (1)");
        assert.equal((await runtime.reportSlug(slug, "panel")).accepted, true);
        assert.equal((await runtime.snapshot()).badges.items["work/beta"][0].text, "Files (2)");
    } finally { runtime.close(); }
});

test("diagnostic logging uses warning and survives synchronous and rejected failures", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-diagnostics-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await writeSpec(cwd);
    await mkdir(join(cwd, "specs", "alpha", "tasks.md"));
    const diagnostics = [], fallback = [];
    const session = { sessionId: "badge-diagnostics",
        log: async (message, options) => diagnostics.push({ message, ...options }) };
    const config = { canvas: { id: "badge-diagnostics" }, phases: ["specify", "tasks"],
        phaseOutputs: {
            specify: { expectsArtifact: true, outputPath: "specs/<slug>/spec.md" },
            tasks: { expectsArtifact: true, outputPath: "specs/<slug>/tasks.md" },
        },
        userProvidesSlug: false, badges };
    const runtime = await createRuntime({ config, cwd, workspace: cwd, session });
    t.after(() => runtime.close());
    t.mock.method(console, "warn", (message) => fallback.push(message));
    const snapshot = await runtime.snapshot();
    await new Promise(setImmediate);
    assert.ok(snapshot.badges.diagnostics.length > 0);
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(({ level }) => level === "warning"));
    assert.deepEqual(fallback, []);
    for (const [message, log] of [
        ["synchronous logging failure", () => { throw new Error("synchronous logging failure"); }],
        ["rejected logging failure", async () => { throw new Error("rejected logging failure"); }],
    ]) {
        session.log = log;
        const updated = await runtime.refresh();
        await new Promise(setImmediate);
        assert.ok(updated.badges.diagnostics.length > 0);
        for (const diagnostic of updated.badges.diagnostics) {
            assert.ok(fallback.some((entry) => entry.includes(message) && entry.includes(diagnostic)));
        }
        assert.deepEqual((await runtime.snapshot()).badges, updated.badges);
        await new Promise(setImmediate);
    }
});

test("artifact staleness uses ordered upstream metadata without phase-run status", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-stale-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    for (const name of ["alpha", "beta"]) {
        await mkdir(join(cwd, "specs", name), { recursive: true });
        for (const file of ["spec.md", "plan.md", "tasks.md"]) {
            await writeFile(join(cwd, "specs", name, file), "Work");
        }
    }
    const stamp = async (name, file, seconds) =>
        utimes(join(cwd, "specs", name, file), new Date(seconds * 1000), new Date(seconds * 1000));
    for (const [name, times] of [["alpha", [30, 10, 20]], ["beta", [10, 20, 30]]]) {
        for (const [index, file] of ["spec.md", "plan.md", "tasks.md"].entries()) {
            await stamp(name, file, times[index]);
        }
    }
    const adapter = "badge-rule-ordered-stale-adapter";
    const hash = createHash("sha256").update(await readFile(new URL(
        "../extension-canvas-design/generated-host/badges/adapters/ordered-stale.mjs",
        import.meta.url))).digest("hex");
    const config = { instances: [placed({ ...instance, id: "stale", type: "stale",
        inputs: { artifact: { phase: "tasks", output: "specs/<slug>/tasks.md" },
            prerequisites: [{ phase: "specify", output: "specs/<slug>/spec.md" },
                { phase: "plan", output: "specs/<slug>/plan.md" }] },
        text: "Stale", summaryText: "Stale", color: "amber",
        showIn: ["workflow-list", "workflow-summary"] })],
    types: [{ ...type, id: "stale", rule: "artifact-stale" }],
    rules: [{ ...rule, id: "artifact-stale", adapter, hash,
        inputs: [{ id: "artifact", type: "artifact", scope: "metadata" },
            { id: "prerequisites", type: "ordered-artifacts", scope: "metadata",
                before: "artifact", minItems: 1 }], textPlaceholders: [] }] };
    assert.equal(createHash("sha256").update(await readFile(
        join(generated, "badges", `${adapter}.mjs`))).digest("hex"), hash);
    await verifyBadgeModules(config);
    const phases = ["specify", "plan", "tasks"].map((id) => ({
        id, outputs: [`specs/<slug>/${id === "specify" ? "spec" : id}.md`] }));
    assert.throws(() => validateBadges({ ...config, instances: [{
        ...config.instances[0], inputs: { artifact: config.instances[0].inputs.artifact },
    }] }, phases), /Invalid generated badge/);
    assert.throws(() => validateBadges({ ...config, instances: [{
        ...config.instances[0], inputs: { ...config.instances[0].inputs, prerequisites: [] },
    }] }, phases), /Invalid generated badge/);
    const evaluate = () => evaluateBadges(config, { cwd,
        workflows: ["specs/alpha", "specs/beta"], phases,
        outputPath: async ({ output }, workflow) =>
            `${workflow}/${output.split("/").at(-1)}`,
        runFor: () => ({ status: "Completed", startedAt: new Date(0).toISOString(),
            completedAt: new Date(Date.now() + 30_000).toISOString() }) });
    let result = await evaluate();
    assert.equal(result.items["specs/alpha"][0].text, "Stale");
    assert.deepEqual(result.items["specs/beta"], []);
    assert.equal(result.summary[0].count, 1);
    await stamp("alpha", "plan.md", 30);
    await stamp("alpha", "tasks.md", 30);
    result = await evaluate();
    assert.deepEqual(result.items["specs/alpha"], []);
    assert.equal(result.summary[0].count, 0);
    await rm(join(cwd, "specs", "beta", "plan.md"));
    result = await evaluate();
    assert.equal(result.items["specs/beta"][0].text, "Stale");
    assert.equal(result.summary[0].count, 1);
    await rm(join(cwd, "specs", "beta", "tasks.md"));
    result = await evaluate();
    assert.deepEqual(result.items["specs/beta"], []);
    assert.equal(result.summary[0].count, 0);
});

test("badge config rejects undeclared outputs and normalizes completed run statuses", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-run-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const adapter = "badge-rule-run-adapter";
    const hash = createHash("sha256").update(await readFile(new URL(
        "../extension-canvas-design/generated-host/badges/adapters/run.mjs",
        import.meta.url))).digest("hex");
    const config = { instances: [{ id: "done", type: "done", category: "Runs", inputs: { phase: "tasks" },
        phaseText: "Done", summaryText: "Done", color: "green",
        showIn: ["workflow-summary", "phase-card"], phase: "tasks" }],
    types: [{ ...type, id: "done", rule: "phase-run-complete" }],
    rules: [{ ...rule, id: "phase-run-complete", inputs: [{ id: "phase", type: "phase" }],
        textPlaceholders: [], adapter, hash }] };
    const phases = [{ id: "tasks", outputs: ["specs/<slug>/tasks.md"] }];
    validateBadges(config, phases);
    assert.throws(() => validateBadges(badges, [
        { id: "specify", outputs: ["specs/<slug>/spec.md"] },
        { id: "tasks", outputs: [] },
    ]),
        /Invalid generated badge input/);
    await verifyBadgeModules(config);
    for (const status of ["Completed", "complete", "success"]) {
        const result = await evaluateBadges(config, { cwd, workflows: ["specs/alpha"], phases,
            outputPath: async () => null, runFor: () => ({ status }) });
        assert.equal(result.items["specs/alpha"][0].phaseText, "Done", status);
        assert.deepEqual(result.summary, [{ id: "done", category: "Runs", color: "green", count: 1,
            text: "Done: 1" }]);
    }
    const missing = await evaluateBadges(config, { cwd, workflows: ["specs/alpha"], phases,
        outputPath: async () => null, runFor: () => null });
    assert.deepEqual(missing.items["specs/alpha"], []);
    assert.equal(missing.summary[0].count, 0);
});

test("Value match searches a single declared output and counts one match per workflow", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-shared-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "specs", "alpha"), { recursive: true });
    await writeFile(join(cwd, "specs", "alpha", "spec.md"), "Verdict: needs-clarification");
    const output = "specs/<slug>/spec.md";
    const config = { instances: [{ id: "verdict", type: "value-match", category: "Verdict",
        inputs: { artifact: { phase: "specify", output },
            choices: [{ id: "review", value: "VERDICT: NEEDS-CLARIFICATION",
                text: "Review needed", summaryText: "Review", color: "amber" }] },
        color: "amber", showIn: ["workflow-list", "workflow-summary"], phase: null }],
    types: [{ ...type, id: "value-match", rule: "value-match" }],
    rules: [{ ...rule, id: "value-match",
        inputs: [{ id: "artifact", type: "artifact" },
            { id: "choices", type: "badge-selection" }], textPlaceholders: [] }] };
    const phases = [{ id: "specify", outputs: [output] }];
    validateBadges(config, phases);
    assert.throws(() => validateBadges({ ...config, instances: [{
        ...config.instances[0], inputs: { ...config.instances[0].inputs,
            choices: [{ ...config.instances[0].inputs.choices[0], value: " " }] },
    }] }, phases), /Invalid generated badge input/);
    assert.throws(() => validateBadges({ ...config, instances: [{
        ...config.instances[0], inputs: { ...config.instances[0].inputs,
            choices: [{ ...config.instances[0].inputs.choices[0], value: "x".repeat(257) }] },
    }] }, phases), /Invalid generated badge input/);
    const result = await evaluateBadges(config, { cwd, phases, workflows: ["specs/alpha"],
        outputPath: async () => "specs/alpha/spec.md", runFor: () => null });
    assert.equal(result.items["specs/alpha"][0].text, "Review needed");
    assert.equal(result.items["specs/alpha"][0].category, "Verdict");
    assert.equal(result.summary[0].count, 1);
    assert.equal(result.summary[0].text, "Review: 1");
    assert.equal(result.summary[0].category, "Verdict");
});

test("missing artifacts do not match; oversized reads emit unknown diagnostics", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-errors-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "specs", "alpha"), { recursive: true });
    await writeSpec(cwd);
    const diagnostics = [];
    const evaluate = () => evaluateBadges(badges, { cwd, workflows: ["specs/alpha"],
        phases: [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
            { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }],
        outputPath: async ({ phase }) => `specs/alpha/${phase === "specify" ? "spec" : "tasks"}.md`,
        runFor: () => null,
        log: (message) => diagnostics.push(message) });
    assert.deepEqual((await evaluate()).items["specs/alpha"], []);
    assert.deepEqual(diagnostics, []);
    await writeFile(join(cwd, "specs", "alpha", "tasks.md"), "- [x] ".repeat(30_000));
    assert.deepEqual((await evaluate()).items["specs/alpha"], []);
    assert.ok(diagnostics.some((message) => message.includes("could not be read")));
    assert.ok(diagnostics.some((message) => message.includes("could not be read safely")));
});

test("workflow artifact evidence is read once across badge instances", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-badge-cache-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, "specs", "alpha"), { recursive: true });
    await writeSpec(cwd);
    await writeFile(join(cwd, "specs", "alpha", "tasks.md"), "- [x] done");
    let resolved = 0;
    const config = { ...badges, instances: [instance, { ...instance, id: "other" }] };
    const result = await evaluateBadges(config, { cwd, workflows: ["specs/alpha"],
        phases: [{ id: "specify", outputs: ["specs/<slug>/spec.md"] },
            { id: "tasks", outputs: ["specs/<slug>/tasks.md"] }],
        outputPath: async ({ phase }) => {
            resolved++; return `specs/alpha/${phase === "specify" ? "spec" : "tasks"}.md`;
        },
        runFor: () => null });
    assert.equal(resolved, 2);
    assert.deepEqual(result.items["specs/alpha"].map(({ id }) => id), ["work", "other"]);
});

test("exhausted badge evaluation budget is reported instead of silently skipping", async () => {
    const diagnostics = [];
    const result = await evaluateBadges(badges, { cwd: process.cwd(),
        workflows: ["specs/alpha", "specs/beta"],
        phases: [{ id: "tasks", outputs: ["specs/<slug>/tasks.md"] }],
        outputPath: async () => { throw new Error("Must not read after deadline"); },
        runFor: () => null, budgetMs: 0, log: (message) => diagnostics.push(message) });
    assert.deepEqual(result.items, { "specs/alpha": [], "specs/beta": [] });
    assert.match(result.diagnostics[0], /some badges were not evaluated/);
    assert.deepEqual(diagnostics, result.diagnostics);
});

test("badge validator permits 100 unique types and rules", () => {
    const config = { instances: [], types: [], rules: [] };
    for (let index = 0; index < 100; index++) {
        const id = `rule-${index}`;
        config.rules.push({ ...rule, id });
        config.types.push({ ...type, id: `type-${index}`, rule: id });
    }
    assert.doesNotThrow(() => validateBadges(config, ["tasks"]));
    assert.throws(() => validateBadges({ ...config, types: [...config.types, type] },
        ["tasks"]), /Invalid generated badge configuration/);
});

after(() => rm(generated, { recursive: true, force: true }));
