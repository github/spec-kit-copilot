// Verify pipeline compilation, generation applicability, naming, and prompt contracts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
    BlueprintValidationError,
    compileBlueprint,
    skillNameForCommand,
} from "../generation/compiler.mjs";
import { assessVisualizationApplicability } from "../generation/applicability.mjs";
import { buildStateSnapshot } from "../canvas-runtime/snapshot-builder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const metadata = {
    extensionId: "fixture-workflow",
    displayName: "Fixture Workflow",
    description: "Fixture canvas.",
};

async function fixture(name) {
    return JSON.parse(await readFile(join(here, "fixtures", "generation", `${name}.json`), "utf8"));
}

describe("generation compiler", () => {
    test("phases without an artifact target compile without warnings and retain their metadata", () => {
        const blueprint = compileBlueprint({ pipeline: [{ id: "taskstoissues" }] }, metadata);
        assert.deepEqual(blueprint.warnings, []);
        assert.equal(blueprint.pipeline.steps[0].commandName, "speckit.taskstoissues");
        assert.deepEqual(blueprint.pipeline.steps[0].artifact, {
            pathTemplate: null, persistent: false, completionSignal: "transient",
        });
    });

    test("Checklist generation uses the declared Markdown template before and after execution", () => {
        for (const artifactPath of ["specs/<slug>/checklists/", "specs/alpha/checklists/security.md", "specs/alpha/checklists/accessibility.md"]) {
            const snapshot = buildStateSnapshot({
                slug: "alpha", pipeline: [{ id: "checklist" }],
                phases: { checklist: { artifactPath } },
                phaseGraph: { commands: [{ id: "checklist", name: "speckit.checklist", source: "preset:copilot-sub-agents" }] },
            });
            const phase = snapshot.phases.checklist;
            assert.equal(phase.artifactTemplatePath, "specs/<slug>/checklists/<name>.md");
            assert.equal(phase.artifactPath, artifactPath.endsWith("/") ? null : artifactPath);
            assert.equal(snapshot.commands[0].artifactPath, phase.artifactPath);
            if (artifactPath.endsWith("/")) {
                assert.equal(phase.folderPath, "specs/alpha/checklists");
                assert.equal(snapshot.commands[0].folderPath, phase.folderPath);
            }
            assert.equal(compileBlueprint(snapshot, metadata).pipeline.steps[0].artifact.pathTemplate,
                "specs/<slug>/checklists/<name>.md");
        }
    });

    test("Checklist output overrides remain authoritative, including unsupported non-Markdown outputs", () => {
        for (const artifact of ["specs/<slug>/reviews/<name>.md", "specs/<slug>/checklist.json"]) {
            const snapshot = buildStateSnapshot({
                pipeline: [{ id: "checklist" }],
                phases: { checklist: { artifactPath: "specs/<slug>/checklists/" } },
                phaseGraph: { commands: [{ id: "checklist", name: "speckit.checklist", source: "preset:custom", artifact }] },
            });
            if (artifact.endsWith(".md")) {
                assert.equal(compileBlueprint(snapshot, metadata).pipeline.steps[0].artifact.pathTemplate, artifact);
            } else {
                assert.throws(() => compileBlueprint(snapshot, metadata), /non-Markdown artifact viewer/);
            }
        }
    });

    test("installation approval is opt-in and preserves the captured workflow contract", async () => {
        for (const name of ["assess", "bugfix", "sdd"]) {
            const { snapshot } = await fixture(name);
            const automatic = compileBlueprint(snapshot, metadata);
            assert.equal(automatic.setup.requireInstallationApproval, false);
            const approved = compileBlueprint(snapshot, metadata, { requireInstallationApproval: true });
            assert.deepEqual(approved, {
                ...automatic,
                setup: { ...automatic.setup, requireInstallationApproval: true },
            });
        }
    });

    test("rejects non-boolean installation approval rather than treating it as automatic", () => {
        for (const value of ["false", "true", 0, 1, null, [], {}]) {
            assert.throws(() => compileBlueprint({ pipeline: [{ id: "constitution" }] }, metadata, {
                requireInstallationApproval: value,
            }), (error) => error instanceof BlueprintValidationError
                && error.errors.some((entry) => entry.code === "installation_approval_invalid"));
        }
    });

    test("approval list captures configured contributions, not uninstalled catalog entries", () => {
        const selected = {
            id: "recorded-component", installedId: "recorded-component", active: true,
            source: "community", downloadUrl: "https://example.test/recorded.zip", enabled: false, priority: 7, cliOrder: 0,
        };
        const uninstalled = { id: "catalog-only", active: false, source: "community" };
        const snapshot = {
            pipeline: [{ id: "constitution" }],
            catalog: { presets: [selected, uninstalled], extensions: [selected, uninstalled] },
        };
        const blueprint = compileBlueprint(snapshot, metadata, { requireInstallationApproval: true });
        for (const kind of ["preset", "extension"]) {
            assert.deepEqual(blueprint.setup[`${kind}s`], [{
                kind, id: selected.id, enabled: false, priority: 7, precedence: 0,
                source: { name: "community", url: selected.downloadUrl, direct: true },
            }]);
        }
    });

    test("requires reviewable community provenance only when approval is enabled", () => {
        for (const kind of ["presets", "extensions"]) {
            for (const downloadUrl of [undefined, "https://", "http://example.test/file.zip", "https://user:secret@example.test/file.zip", "https://example.test/file.zip\nnext"]) {
                const snapshot = {
                    pipeline: [{ id: "constitution" }],
                    catalog: { [kind]: [{ id: "community-tool", active: true, source: "community", downloadUrl }] },
                };
                if (downloadUrl === undefined) assert.doesNotThrow(() => compileBlueprint(snapshot, metadata));
                else assert.throws(() => compileBlueprint(snapshot, metadata), /portable HTTPS install URL/);
                assert.throws(() => compileBlueprint(snapshot, metadata, { requireInstallationApproval: true }),
                    (error) => error instanceof BlueprintValidationError
                        && error.errors.some((entry) => entry.code === "setup_contribution_source_missing"));
            }
        }
    });

    test("list naming changes only display metadata, not pipeline behavior", async () => {
        const input = await fixture("assess");
        const original = compileBlueprint(input.snapshot, metadata);
        assert.equal(original.metadata.workflowListName, "Workflows");
        const named = compileBlueprint(input.snapshot, { ...metadata, workflowListName: "R&D Cases" });
        assert.equal(named.metadata.workflowListName, "R&D Cases");
        assert.deepEqual(named, { ...original, metadata: { ...original.metadata, workflowListName: "R&D Cases" } });
    });
    test("preserves the admin-selected community download source for presets and extensions", () => {
        const contribution = { id: "community-tool", installedId: "community-tool", active: true, enabled: true, source: "community", downloadUrl: "https://example.test/community.zip", priority: 7, cliOrder: 0 };
        const blueprint = compileBlueprint({
            pipeline: [{ id: "constitution" }],
            catalog: { presets: [contribution], extensions: [contribution] },
        }, metadata);
        for (const kind of ["presets", "extensions"]) {
            assert.deepEqual(blueprint.setup[kind][0].source, { name: "community", url: contribution.downloadUrl, direct: true });
            assert.equal(blueprint.setup[kind][0].enabled, true);
            assert.equal(blueprint.setup[kind][0].priority, 7);
        }
    });

    test("rejects unsafe artifact and deletion roots before dispatching generation", () => {
        for (const artifactTemplatePath of ["../secret.md", ".specify/<slug>/spec.md", ".github/extensions/<slug>/spec.md"]) {
            assert.throws(() => compileBlueprint({
                pipeline: [{ id: "specify" }],
                commands: [{ id: "specify", artifactTemplatePath }],
            }, metadata), (error) => error instanceof BlueprintValidationError && error.errors.some((entry) => entry.code === "workflow_path_invalid"));
        }
    });

    test("classifies supported item and project workflow visualizations", () => {
        const item = assessVisualizationApplicability([
            { index: 0, label: "Intake", predecessors: [], artifact: { pathTemplate: ".specify/assessments/<slug>/intake.md" } },
            { index: 1, label: "Research", predecessors: [0], artifact: { pathTemplate: ".specify/assessments/<slug>/research.md" } },
        ]);
        assert.equal(item.ok, true);
        assert.equal(item.workflowMode, "item");
        assert.equal(item.itemRoot, ".specify/assessments/<slug>");

        const project = assessVisualizationApplicability([
            { index: 0, label: "Constitution", predecessors: [], artifact: { pathTemplate: ".specify/memory/constitution.md" } },
        ]);
        assert.equal(project.ok, true);
        assert.equal(project.workflowMode, "project");
    });

    test("rejects unsupported visualization shapes", () => {
        const result = assessVisualizationApplicability([
            { index: 0, label: "One", predecessors: [], artifact: { pathTemplate: ".specify/a/<slug>/one.md" } },
            { index: 1, label: "Two", predecessors: [], artifact: { pathTemplate: ".specify/b/<slug>/two.png" } },
        ]);
        assert.equal(result.ok, false);
        assert.ok(result.errors.every((entry) => entry.code === "visualization_unsupported"));
        assert.match(result.errors.map((entry) => entry.message).join(" "), /linear|non-Markdown|multiple independent/i);
    });

    for (const name of ["assess", "bugfix", "sdd"]) {
        test(`compiles ${name} into a deterministic linear blueprint`, async () => {
            const input = await fixture(name);
            const first = compileBlueprint(input.snapshot, metadata);
            const second = compileBlueprint(input.snapshot, metadata);
            assert.deepEqual(first, second);
            assert.equal(first.pipeline.topology, "linear");
            assert.deepEqual(first.pipeline.steps.map((step) => step.skillName), input.expectedSkills);
            assert.deepEqual(first.pipeline.steps.map((step) => step.artifact.pathTemplate), input.expectedArtifacts);
            assert.deepEqual(first.pipeline.steps.map((step) => step.index), input.expectedSkills.map((_, index) => index));
            assert.deepEqual(first.pipeline.steps.map((step) => step.invocation), input.expectedSkills.map((skill) => `/skill:${skill}`));
            assert.deepEqual(first.pipeline.steps.map((step) => step.predecessors), input.expectedSkills.map((_, index) => index ? [index - 1] : []));
            assert.equal(first.runtime.userProvidesSlug, false);
            assert.equal(first.runtime.multiInstance, true);
        });
    }

    test("records whether the generated canvas exposes optional slug input", async () => {
        const input = await fixture("assess");
        const blueprint = compileBlueprint(input.snapshot, metadata, { userProvidesSlug: true });
        assert.equal(blueprint.runtime.userProvidesSlug, true);
    });

    test("automatically supports multiple workflows only for slug-scoped pipelines", async () => {
        const assess = await fixture("assess");
        const blueprint = compileBlueprint(assess.snapshot, metadata);
        assert.equal(blueprint.runtime.multiInstance, true);
        assert.equal(compileBlueprint(assess.snapshot, metadata, { multiInstance: false }).runtime.multiInstance, true);

        const project = compileBlueprint({
            pipeline: [{ id: "constitution" }],
            commands: [{
                id: "constitution",
                commandName: "speckit.constitution",
                artifact: ".specify/memory/constitution.md",
            }],
        }, metadata);
        assert.equal(project.runtime.multiInstance, false);
        assert.equal(project.runtime.itemRoot, null);
    });

    test("maps canonical and extension commands to Copilot skills", () => {
        assert.equal(skillNameForCommand("speckit.specify"), "speckit-specify");
        assert.equal(skillNameForCommand("speckit.assess.intake"), "speckit-assess-intake");
        assert.equal(skillNameForCommand("../escape"), null);
    });

    test("preserves canonical command names and reusable artifact templates from real snapshots", () => {
        const blueprint = compileBlueprint({
            pipeline: [{ id: "specify" }],
            commands: [{
                id: "commands/speckit.specify",
                commandName: "speckit.specify",
                shortLabel: "specify",
                artifact: ".specify/specs/<slug>/spec.md",
                artifactPath: ".specify/specs/current-feature/spec.md",
            }],
        }, metadata);
        assert.equal(blueprint.pipeline.steps[0].skillName, "speckit-specify");
        assert.equal(blueprint.pipeline.steps[0].label, "Specify");
        assert.equal(blueprint.pipeline.steps[0].artifact.pathTemplate, ".specify/specs/<slug>/spec.md");
    });

    test("compiles extension commands represented only in the composition graph", () => {
        const blueprint = compileBlueprint({
            pipeline: [{ id: "speckit.assess.intake" }],
            commands: [],
            composition: {
                artifacts: [{
                    id: "commands/speckit.assess.intake",
                    kind: "command",
                    description: "Capture and normalize a raw idea.",
                    stack: [{
                        layer: "extension",
                        presetId: "assess",
                        active: true,
                        sourcePath: ".specify/extensions/assess/commands/speckit.assess.intake.md",
                    }],
                }],
            },
            phases: {
                "commands/speckit.assess.intake": {
                    artifactPath: ".specify/assessments/<slug>/intake.md",
                    argsHint: "Enter the idea.",
                },
            },
        }, metadata);
        const step = blueprint.pipeline.steps[0];
        assert.equal(step.skillName, "speckit-assess-intake");
        assert.equal(step.source.id, "assess");
        assert.equal(step.artifact.pathTemplate, ".specify/assessments/<slug>/intake.md");
        assert.equal(step.description, "Capture and normalize a raw idea.");
        assert.deepEqual(blueprint.setup.requiredSkills, [{
            name: "speckit-assess-intake",
            invocation: "/skill:speckit-assess-intake",
            commandName: "speckit.assess.intake",
            provider: { kind: "extension", id: "assess" },
        }]);
        assert.deepEqual(blueprint.setup.extensions, [{ kind: "extension", id: "assess", enabled: true }]);
    });

    test("captures all installed contributions and normalizes selected skill providers", () => {
        const blueprint = compileBlueprint({
            pipeline: [{ id: "speckit.assess.intake" }, { id: "speckit.review.write" }],
            commands: [],
            catalog: {
                presets: [
                    { id: "review-style", installedId: "review-style", active: true, source: "copilot", downloadUrl: "https://example.test/review-style.zip", priority: 20, cliOrder: 1 },
                    { id: "unused-preset", installedId: "unused-preset", active: true, source: "default", priority: 5, cliOrder: 0 },
                ],
                extensions: [
                    { id: "assess", installedId: "assess", active: true, source: "default", priority: 10, cliOrder: 1 },
                    { id: "hooks", installedId: "hooks", active: true, enabled: false, source: "community", priority: 2, cliOrder: 0 },
                ],
            },
            composition: {
                presets: [
                    { id: "review-style", enabled: true },
                    { id: "unused-preset", enabled: true },
                ],
                extensions: [
                    { id: "assess", enabled: true },
                    { id: "hooks", enabled: true },
                ],
                artifacts: [
                    {
                        id: "commands/speckit.assess.intake",
                        kind: "command",
                        stack: [{ layer: "extension", presetId: "assess", active: true }],
                    },
                    {
                        id: "commands/speckit.review.write",
                        kind: "command",
                        stack: [{ layer: "preset", presetId: "review-style", active: true }],
                    },
                ],
            },
            phases: {
                "commands/speckit.assess.intake": { artifactPath: ".specify/assessments/<slug>/intake.md" },
                "commands/speckit.review.write": { artifactPath: ".specify/assessments/<slug>/review.md" },
            },
        }, metadata);

        assert.deepEqual(blueprint.setup.presets.map((entry) => entry.id), ["unused-preset", "review-style"]);
        assert.deepEqual(blueprint.setup.presets.map((entry) => entry.priority), [5, 20]);
        assert.deepEqual(blueprint.setup.presets[1].source, {
            name: "copilot",
            url: "https://example.test/review-style.zip",
            direct: true,
        });
        assert.deepEqual(blueprint.setup.extensions.map((entry) => entry.id), ["hooks", "assess"]);
        assert.deepEqual(blueprint.setup.extensions.map((entry) => entry.priority), [2, 10]);
        assert.equal(blueprint.setup.extensions.find((entry) => entry.id === "hooks").enabled, false);
        assert.deepEqual(
            blueprint.setup.requiredSkills.map((entry) => [entry.name, entry.provider]),
            [
                ["speckit-assess-intake", { kind: "extension", id: "assess" }],
                ["speckit-review-write", { kind: "preset", id: "review-style" }],
            ],
        );
    });

    test("rejects selected non-core skills with ambiguous provider attribution", () => {
        assert.throws(
            () => compileBlueprint({
                pipeline: [{ id: "speckit.custom.run" }],
                commands: [],
                composition: {
                    artifacts: [{
                        id: "commands/speckit.custom.run",
                        kind: "command",
                        stack: [{ layer: "extension", active: true }],
                    }],
                },
                phases: {
                    "commands/speckit.custom.run": { artifactPath: ".specify/custom/<slug>/run.md" },
                },
            }, metadata),
            (err) => err instanceof BlueprintValidationError
                && err.errors.some((entry) => entry.code === "skill_provider_unknown"),
        );
    });

    test("rejects installed custom-catalog contributions without a portable install URL", () => {
        assert.throws(
            () => compileBlueprint({
                pipeline: [{ id: "specify" }],
                commands: [],
                catalog: {
                    presets: [{
                        id: "private-style",
                        installedId: "private-style",
                        active: true,
                        source: "private",
                    }],
                },
                composition: {
                    presets: [{ id: "private-style", enabled: true }],
                    artifacts: [],
                },
            }, metadata),
            (err) => err instanceof BlueprintValidationError
                && err.errors.some((entry) => entry.code === "setup_contribution_source_missing"),
        );
    });

    test("preserves duplicate commands by pipeline index and rejects unknown commands", () => {
        const duplicate = compileBlueprint({
            pipeline: [{ id: "specify" }, { id: "specify" }],
            commands: [],
        }, metadata);
        assert.deepEqual(duplicate.pipeline.steps.map((step) => step.instanceKey), ["0:specify", "1:specify"]);
        assert.throws(
            () => compileBlueprint({
                pipeline: [{ id: "speckit.unknown" }],
                commands: [],
            }, metadata),
            (err) => err instanceof BlueprintValidationError
                && err.errors.some((entry) => entry.code === "command_unknown"),
        );
    });
});
