// Verify project-scoped Constitution prerequisites in generated workflow canvases.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";
import { commandViews } from "../generation/generated-canvas-template/ui/command-views.mjs";
import { constitutionGate, inspectConstitution } from "../generation/generated-canvas-template/project-artifacts.mjs";
import { ARTIFACT_CAP, validateWorkflowPaths } from "../generation/generated-canvas-template/workspace-files.mjs";
import { defaultPhaseInput, validateWorkflowConfig } from "../generation/generated-canvas-template/workflow-adapter.mjs";

const metadata = { extensionId: "constitution-test", displayName: "Constitution test", description: "Test." };
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
const compile = (ids, extras = {}) => compileBlueprint({ pipeline: ids.map((id) => ({ id })), ...extras }, metadata);

test("five Assess phases plus Constitution LAST retain six source commands and exactly five workflow phases", async () => {
    const { snapshot } = JSON.parse(await readFile(new URL("./fixtures/generation/assess.json", import.meta.url), "utf8"));
    const original = compileBlueprint(snapshot, metadata);
    snapshot.pipeline.push({ id: "constitution" });
    const blueprint = compileBlueprint(snapshot, metadata);
    const { all, constitution, workflow } = commandViews(blueprint);
    assert.equal(all.length, 6);
    assert.equal(blueprint.setup.requiredSkills.length, 6);
    assert.equal(constitution.instanceKey, "5:constitution");
    assert.deepEqual(workflow, original.pipeline.steps);
    assert.equal(workflow.length, 5);
    assert.deepEqual(workflow.map((step) => step.label), ["Intake", "Research", "Define", "Shape", "Decide"]);
    assert.equal(blueprint.runtime.itemRoot, ".specify/assessments/<slug>");
    assert.equal(snapshot.pipeline.at(-1).id, "constitution", "The Wizard's selected source pipeline must not be filtered.");
});

test("explicit first/middle/last/only selections retain source identities and exact skill/input keys", () => {
    for (const ids of [
        ["constitution", "specify", "plan"],
        ["specify", "constitution", "plan"],
        ["specify", "plan", "commands/speckit.constitution"],
        ["speckit.constitution"],
    ]) {
        const blueprint = compile(ids);
        const { all, constitution, workflow } = commandViews(blueprint);
        assert.equal(all.length, ids.length);
        assert.equal(constitution.commandName, "speckit.constitution");
        assert.deepEqual(workflow.map((step) => step.commandName), ids.length === 1 ? [] : ["speckit.specify", "speckit.plan"]);
        assert.deepEqual(all.map((step) => step.index), ids.map((_, index) => index));
        assert.deepEqual(workflow.map((step) => [step.instanceKey, step.index]),
            ids.flatMap((id, index) => id === "specify" || id === "plan" ? [[`${index}:${id}`, index]] : []));
        assert.deepEqual(all.map((step) => step.predecessors), ids.map((_, index) => index ? [index - 1] : []));
        assert.ok(blueprint.setup.requiredSkills.some((skill) => skill.name === "speckit-constitution"));
        assert.equal(blueprint.projectArtifacts.constitution.instanceKey, constitution.instanceKey);
        assert.equal(blueprint.runtime.itemRoot, workflow.length ? "specs/<slug>" : null);
        assert.equal(blueprint.runtime.multiInstance, Boolean(workflow.length));
        const config = { version: 1, itemLabels: {}, phaseArguments: {}, phaseInputs: Object.fromEntries(all.map((step) => [step.instanceKey, defaultPhaseInput(step)])) };
        assert.doesNotThrow(() => validateWorkflowConfig(config, blueprint));
        assert.deepEqual(config.phaseInputs[constitution.instanceKey], {
            label: "Guidance", helper: "Optional: principles to emphasize (e.g. testing, performance, UX)", optional: true,
        });
        delete config.phaseInputs[constitution.instanceKey];
        assert.throws(() => validateWorkflowConfig(config, blueprint), /missing phase/);
    }
});

test("absent descriptor preserves old commands including a legacy numbered Constitution", async () => {
    const absent = compile(["specify"]);
    assert.equal(absent.projectArtifacts, undefined);
    assert.equal(commandViews(absent).workflow, absent.pipeline.steps);
    assert.equal(await inspectConstitution("not-a-workspace", absent), null);
    assert.equal(await constitutionGate("not-a-workspace", absent, absent.pipeline.steps[0]), null);
    const legacy = compile(["constitution", "specify"]);
    delete legacy.projectArtifacts;
    assert.equal(commandViews(legacy).workflow.length, 2);
    assert.equal(commandViews(legacy).constitution, null);
    const extension = compile(["speckit.other.constitution"], {
        commands: [{ id: "speckit.other.constitution", title: "Constitution", source: "extension:other", artifactTemplatePath: "notes/principles.md" }],
    });
    assert.equal(extension.projectArtifacts, undefined);
});

test("effective preset keeps its canonical invocation, provenance and safe project artifact", () => {
    const blueprint = compile(["constitution", "specify"], {
        commands: [{ id: "constitution", artifactTemplatePath: "policies/principles.md", source: "preset:policy" }],
    });
    const { constitution } = commandViews(blueprint);
    assert.equal(constitution.source.id, "policy");
    assert.equal(constitution.invocation, "/skill:speckit-constitution");
    assert.equal(constitution.artifact.pathTemplate, "policies/principles.md");
    assert.equal(blueprint.runtime.itemRoot, "specs/<slug>");
    assert.equal(defaultPhaseInput(constitution).optional, false);
    assert.ok(blueprint.setup.presets.some((entry) => entry.id === "policy"));
});

test("duplicate and incompatible Constitution contracts fail explicitly rather than guessing", () => {
    assert.throws(() => compile(["constitution", "commands/speckit.constitution"]), /exactly one project Constitution/);
    for (const artifactTemplatePath of [undefined, null, "", "specs/<slug>/principles.md", "policies/<name>.md", "policy.txt"]) {
        assert.throws(() => compile(["constitution"], {
            commands: [{ id: "constitution", source: "preset:policy", artifactTemplatePath }],
        }), /Unsupported Constitution contract/);
    }
    for (const artifactTemplatePath of ["../principles.md", "C:\\policy.md", "/policy.md", "notes/../policy.md"]) {
        assert.throws(() => compile(["constitution"], {
            commands: [{ id: "constitution", artifactTemplatePath }],
        }), /workflow path/);
    }
    const valid = compile(["constitution", "specify"]);
    for (const mutate of [
        (blueprint) => { blueprint.projectArtifacts.constitution.instanceKey = blueprint.pipeline.steps[1].instanceKey; },
        (blueprint) => { blueprint.projectArtifacts.constitution.required = false; },
        (blueprint) => { blueprint.projectArtifacts.constitution.path = "secret.md"; },
        (blueprint) => { blueprint.pipeline.steps[0].artifact.persistent = false; },
        (blueprint) => { blueprint.pipeline.steps[0].artifact.completionSignal = "transient"; },
    ]) {
        const blueprint = structuredClone(valid);
        mutate(blueprint);
        assert.throws(() => validateWorkflowPaths(blueprint), /Constitution/);
    }
});

test("bounded observed status gates missing, empty, template, ready, oversized and unsafe paths", async () => {
    const root = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), ".constitution-"));
    roots.push(root);
    const blueprint = compile(["constitution", "specify"], {
        commands: [{ id: "constitution", source: "preset:policy", artifactTemplatePath: "policies/principles.md" }],
    });
    const { constitution, workflow } = commandViews(blueprint);
    assert.equal((await inspectConstitution(root, blueprint)).state, "missing");
    await mkdir(join(root, "policies"));
    const file = join(root, "policies", "principles.md");
    for (const [content, state] of [
        ["", "empty"], [" \n", "empty"], ["# [PROJECT_NAME]\n[PRINCIPLE_1]", "template"],
        ["# Principles\nTest changes. [Documentation](guide.md)", "ready"],
        ["x".repeat(ARTIFACT_CAP), "ready"], ["x".repeat(ARTIFACT_CAP + 1), "error"],
    ]) {
        await writeFile(file, content);
        const status = await inspectConstitution(root, blueprint);
        assert.equal(status.state, state);
        assert.equal(status.ready, state === "ready");
        const gate = await constitutionGate(root, blueprint, workflow[0]);
        if (state === "ready") assert.equal(gate, null);
        else assert.deepEqual([gate.code, gate.ok, gate.queued], ["constitution_required", false, false]);
        assert.equal(await constitutionGate(root, blueprint, constitution), null);
    }
    await rm(file);
    await writeFile(file, Buffer.from([0xff, 0xfe, 0xff]));
    assert.equal((await inspectConstitution(root, blueprint)).state, "error");
    await rm(file);
    await mkdir(file);
    assert.equal((await inspectConstitution(root, blueprint)).state, "error");
    await rm(join(root, "policies"), { recursive: true });
    await mkdir(join(root, "other"));
    await writeFile(join(root, "other", "principles.md"), "# Ready");
    await symlink(join(root, "other"), join(root, "policies"), process.platform === "win32" ? "junction" : "dir");
    const unsafe = await inspectConstitution(root, blueprint);
    assert.equal(unsafe.state, "error");
    assert.match(unsafe.error, /symbolic link/);
    const absent = compile(["specify"]);
    assert.equal(await inspectConstitution(root, absent), null);
});
