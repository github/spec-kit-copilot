// Verify generated workflow execution policy and protected adapter behavior.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorkflowAdapter, defaultPhaseInput, validateWorkflowConfig } from "../generation/generated-canvas-template/workflow-adapter.mjs";
import {
    authorizeWorkflowPath, deleteWorkspaceDirectory, resolveWorkflowPath,
    revealWorkspaceDirectory, resolveDeclaredArtifact, validateWorkflowPaths,
} from "../generation/generated-canvas-template/workspace-files.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pipeline = {
    runtime: { itemRoot: ".specify/items/<slug>", multiInstance: true },
    pipeline: { steps: [
        { instanceKey: "intake", artifact: { pathTemplate: ".specify/items/<slug>/intake.md" } },
        { instanceKey: "research", artifact: { pathTemplate: ".specify/items/<slug>/notes/research.md" } },
        { instanceKey: "constitution", artifact: { pathTemplate: ".specify/memory/constitution.md" } },
    ] },
};
const config = () => ({ version: 1, itemLabels: {}, phaseArguments: {} });

test("phase input presentation is per-instance declarative data, not argument or dispatch behavior", () => {
    const phases = { pipeline: { steps: [{ instanceKey: "review-audience#2" }, { instanceKey: "review-audience#3" }] } };
    const settings = {
        ...config(),
        phaseInputs: {
            "review-audience#2": { label: "Audience & concerns", helper: "Add questions to investigate.", optional: true },
            "review-audience#3": { label: "Revision", helper: "Describe the changes to review.", optional: false },
        },
    };
    const adapter = createWorkflowAdapter(settings, phases);
    const phase = phases.pipeline.steps[0];
    assert.deepEqual(adapter.phaseInput(phase), settings.phaseInputs[phase.instanceKey]);
    settings.phaseInputs[phase.instanceKey].helper = "Changed after validation.";
    const copy = adapter.phaseInput(phase);
    copy.optional = false;
    assert.equal(adapter.phaseInput(phase).optional, true);
    assert.equal(adapter.phaseInput(phase).helper, "Add questions to investigate.");
    assert.equal(adapter.phaseInput(phases.pipeline.steps[1]).label, "Revision");
    assert.equal(adapter.buildPhaseArguments({ phase, userInput: "" }), "");
    assert.deepEqual(createWorkflowAdapter(config(), phases).phaseInput(phase), defaultPhaseInput());
});

test("phase guidance rejects location instructions and malformed/incomplete presentation data", () => {
    const settings = {
        ...config(),
        phaseInputs: Object.fromEntries(pipeline.pipeline.steps.map((phase) => [phase.instanceKey, defaultPhaseInput()])),
    };
    const withInput = (input) => ({ ...settings, phaseInputs: { ...settings.phaseInputs, intake: input } });
    assert.equal(validateWorkflowConfig(settings, pipeline), settings);
    for (const text of [
        "Enter a slug.", "Pass slug=alpha", "Supply the workflow ID.", "Choose a folder.",
        "Pass the artifact path.", "Use the current working directory.", "Enter the output location.",
        "Select a workspace.", "Use <slug>.", "Pass C:\\repo", "Run /skill:speckit-intake",
    ]) {
        for (const field of ["label", "helper"]) {
            assert.throws(() => validateWorkflowConfig(withInput({ ...defaultPhaseInput(), [field]: text }), pipeline), /content only/, `${field}: ${text}`);
        }
    }
    for (const input of [
        { ...defaultPhaseInput(), label: "" }, { ...defaultPhaseInput(), helper: " " },
        { ...defaultPhaseInput(), helper: "One\nTwo" }, { ...defaultPhaseInput(), optional: "true" },
        { ...defaultPhaseInput(), label: "x".repeat(81) }, { ...defaultPhaseInput(), helper: "x".repeat(241) },
        { ...defaultPhaseInput(), required: true },
    ]) {
        assert.throws(() => validateWorkflowConfig(withInput(input), pipeline), /phaseInputs/);
    }
    validateWorkflowConfig(withInput({ label: "x".repeat(80), helper: "x".repeat(240), optional: false }), pipeline);
    assert.throws(() => validateWorkflowConfig({ ...settings, phaseInputs: {} }, pipeline), /missing phase/);
    assert.throws(() => validateWorkflowConfig({ ...settings, phaseInputs: { ...settings.phaseInputs, unknown: defaultPhaseInput() } }, pipeline), /unknown phase/);
});

test("declarative adapter only relabels items and adds fixed arguments around intact user input", async () => {
    const settings = config();
    settings.itemLabels.alpha = "Mars game";
    settings.phaseArguments.intake = { prefix: "--guided", suffix: "--brief" };
    const adapter = createWorkflowAdapter(settings, pipeline);
    settings.phaseArguments.intake.prefix = "mutated";
    const items = [{ id: "alpha", slug: "alpha", label: "alpha" }, { id: "__new__", slug: null, isNew: true, label: "New workflow" }];
    assert.deepEqual(await adapter.listItems({ defaults: async () => items }), [{ ...items[0], label: "Mars game" }, items[1]]);
    const userInput = "create Oregon trail on Mars\nkeep this exact guidance";
    assert.equal(adapter.buildPhaseArguments({ phase: { instanceKey: "intake" }, item: items[0], userInput }), `--guided ${userInput} --brief`);
    assert.equal(adapter.buildPhaseArguments({ phase: { instanceKey: "research" }, item: items[0], userInput }), userInput);
});

test("configuration rejects unsupported code hooks, phase references, slug ownership, and malformed shapes", () => {
    for (const unsupported of ["setupWorkflow", "listItems", "resolveArtifact", "pipeline", "runtime"]) {
        assert.throws(() => validateWorkflowConfig({ ...config(), [unsupported]: "code" }, pipeline), /unsupported field/);
    }
    assert.throws(() => validateWorkflowConfig({ ...config(), phaseArguments: { unknown: {} } }, pipeline), /unknown phase/);
    for (const prefix of ["slug=alpha", "--slug alpha", "one\ntwo", 42]) {
        assert.throws(() => validateWorkflowConfig({ ...config(), phaseArguments: { intake: { prefix } } }, pipeline), /phase arguments/);
    }
    assert.throws(() => validateWorkflowConfig({ ...config(), itemLabels: { __new__: "Removed sentinel" } }, pipeline), /itemLabels/);
    assert.throws(() => validateWorkflowConfig({ ...config(), phaseArguments: [] }, pipeline), /must be an object/);
    assert.throws(() => validateWorkflowConfig(JSON.parse('{"version":1,"itemLabels":{"__proto__":"x"},"phaseArguments":{}}'), pipeline), /unsupported field/);
});

test("artifact, reveal, and delete permissions are distinct and blueprint-bound", () => {
    assert.equal(authorizeWorkflowPath(pipeline, ".specify\\items\\alpha\\intake.md", "artifact"), ".specify/items/alpha/intake.md");
    assert.equal(authorizeWorkflowPath(pipeline, ".specify/items/alpha/notes", "reveal"), ".specify/items/alpha/notes");
    assert.equal(authorizeWorkflowPath(pipeline, ".specify/items", "reveal"), ".specify/items");
    assert.throws(() => authorizeWorkflowPath(pipeline, ".specify", "reveal"), /outside.*scope/);
    assert.throws(() => authorizeWorkflowPath(pipeline, ".specify/other-items", "reveal"), /outside.*scope/);
    assert.throws(() => authorizeWorkflowPath({ ...pipeline, runtime: { ...pipeline.runtime, multiInstance: false } }, ".specify/items", "reveal"), /outside.*scope/);
    assert.equal(authorizeWorkflowPath(pipeline, ".specify/items/alpha", "delete"), ".specify/items/alpha");
    for (const path of ["README.md", ".specify/items/alpha/secret.md", ".specify/items/alpha/notes"]) {
        assert.throws(() => authorizeWorkflowPath(pipeline, path, "artifact"), /outside.*scope/);
    }
    for (const path of [".", "..", ".specify/items", ".specify/items/alpha/notes", ".git"]) {
        assert.throws(() => authorizeWorkflowPath(pipeline, path, "delete"), /invalid|outside.*scope/);
    }
    for (const path of ["../secret.md", "/secret.md", "C:\\secret.md", "\\\\host\\share", ".specify/items/alpha/../beta/intake.md", ".specify/items/alpha/intake.md:stream"]) {
        assert.throws(() => authorizeWorkflowPath(pipeline, path, "artifact"), /invalid/);
    }
    assert.throws(() => authorizeWorkflowPath({ ...pipeline, runtime: { ...pipeline.runtime, multiInstance: false } }, ".specify/items/alpha", "delete"), /outside.*scope/);
    assert.throws(() => authorizeWorkflowPath(pipeline, ".", "reveal"), /invalid/);
    assert.equal(authorizeWorkflowPath({ runtime: {}, pipeline: { steps: [{ artifact: { pathTemplate: "README.md" } }] } }, ".", "reveal"), ".");
});

test("rejects unsafe item roots even when artifact templates authorize their descendants", () => {
    for (const itemRoot of ["<slug>", ".specify/<slug>", ".git/<slug>", ".github/extensions/<slug>", ".specify/presets/<slug>", ".specify/items/alpha", "../items/<slug>"]) {
        assert.throws(() => validateWorkflowPaths({
            runtime: { itemRoot, multiInstance: true },
            pipeline: { steps: [{ artifact: { pathTemplate: `${itemRoot}/intake.md` } }] },
        }), /invalid|dedicated/);
    }
});

test("named Markdown artifacts stay within their declared folder and select the newest file deterministically", async () => {
    const root = await mkdtemp(join(here, ".workflow-policy-"));
    try {
        const template = "specs/<slug>/checklists/<name>.md";
        const contract = { runtime: { itemRoot: "specs/<slug>" }, pipeline: { steps: [{ artifact: { pathTemplate: template } }] } };
        const directory = join(root, "specs", "alpha", "checklists");
        await mkdir(directory, { recursive: true });
        assert.equal(await resolveDeclaredArtifact(root, template, null, contract), null);
        assert.equal(await resolveDeclaredArtifact(root, template, "alpha", contract), null);
        await writeFile(join(directory, "old.md"), "old");
        await writeFile(join(directory, "new.md"), "new");
        await writeFile(join(directory, "secret.txt"), "not an artifact");
        await utimes(join(directory, "old.md"), 1000, 1000);
        await utimes(join(directory, "new.md"), 2000, 2000);
        assert.equal(await resolveDeclaredArtifact(root, template, "alpha", contract), "specs/alpha/checklists/new.md");
        assert.throws(() => authorizeWorkflowPath(contract, "specs/alpha/checklists/secret.txt", "artifact"), /outside.*scope/);
        assert.throws(() => authorizeWorkflowPath(contract, "specs/alpha/other.md", "artifact"), /outside.*scope/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("filesystem operations reject internal/external junctions and delete only the authorized item", async () => {
    const root = await mkdtemp(join(here, ".workflow-policy-"));
    try {
        const workspace = join(root, "workspace");
        const items = join(workspace, ".specify", "items");
        await mkdir(join(items, "alpha"), { recursive: true });
        await mkdir(join(items, "beta"), { recursive: true });
        await mkdir(join(root, "outside"), { recursive: true });
        await writeFile(join(items, "alpha", "intake.md"), "alpha");
        await writeFile(join(items, "beta", "intake.md"), "beta");
        await writeFile(join(root, "outside", "intake.md"), "outside");
        await symlink(join(items, "beta"), join(items, "internal-link"), "junction");
        await symlink(join(root, "outside"), join(items, "external-link"), "junction");
        await symlink(items, join(workspace, ".specify", "linked-items"), "junction");
        const linkedPipeline = JSON.parse(JSON.stringify(pipeline).replaceAll(".specify/items", ".specify/linked-items"));
        await assert.rejects(resolveWorkflowPath(workspace, ".specify/linked-items", linkedPipeline, "reveal"), /symbolic link/);
        assert.equal(await revealWorkspaceDirectory(workspace, ".specify/items", {
            pipeline, platform: "win32",
            spawnImpl(command, args) {
                assert.equal(command, "explorer.exe");
                assert.deepEqual(args, [items]);
                const child = new EventEmitter();
                child.unref = () => {};
                queueMicrotask(() => child.emit("spawn"));
                return child;
            },
        }), items);
        for (const slug of ["internal-link", "external-link"]) {
            await assert.rejects(resolveWorkflowPath(workspace, `.specify/items/${slug}/intake.md`, pipeline, "artifact"), /symbolic link/);
            await assert.rejects(deleteWorkspaceDirectory(workspace, `.specify/items/${slug}`, pipeline), /symbolic link/);
        }
        assert.equal(await readFile(await resolveWorkflowPath(workspace, ".specify/items/alpha/intake.md", pipeline, "artifact"), "utf8"), "alpha");
        await assert.rejects(deleteWorkspaceDirectory(workspace, ".", pipeline), /invalid/);
        await deleteWorkspaceDirectory(workspace, ".specify/items/alpha", pipeline);
        await assert.rejects(lstat(join(items, "alpha")), /ENOENT/);
        assert.equal(await readFile(join(items, "beta", "intake.md"), "utf8"), "beta");
        assert.equal(await readFile(join(root, "outside", "intake.md"), "utf8"), "outside");
        await assert.rejects(revealWorkspaceDirectory(workspace, ".specify/items/beta", {
            pipeline,
            spawnImpl() {
                const child = new EventEmitter();
                queueMicrotask(() => child.emit("error", new Error("explorer failed")));
                return child;
            },
        }), /explorer failed/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
