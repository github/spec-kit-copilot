import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { effectivePipelinePhases } from "../pipeline/effective-phases.mjs";
import { resolvePipelineEntry } from "../ui/phase-runtime.js";

describe("pipeline", () => {
    test("materializes authored and inferred pipelines for the wizard", () => {
        const authored = [{ id: "constitution" }, { id: "specify" }];
        assert.deepEqual(
            effectivePipelinePhases({
                pipeline: authored,
                composition: {
                    inferredPipeline: {
                        pipeline: ["commands/speckit.plan"],
                    },
                },
            }),
            authored,
        );

        assert.deepEqual(
            effectivePipelinePhases({
                composition: {
                    artifacts: [
                        {
                            kind: "hook",
                            hookBinding: {
                                targetCommand: "commands/speckit.audit.capture",
                            },
                        },
                    ],
                    inferredPipeline: {
                        pipeline: [
                            "commands/speckit.constitution",
                            "commands/speckit.audit.capture",
                            "commands/speckit.assess.intake",
                        ],
                    },
                },
            }),
            [
                { id: "constitution" },
                { id: "speckit.assess.intake" },
            ],
        );
    });

    test("resolves a canonical entry to its runnable phase state", () => {
        const resolved = resolvePipelineEntry("specify", {
            phases: {
                specify: {
                    status: "done",
                    artifactPath: "specs/001-feature/spec.md",
                },
            },
        });

        assert.equal(resolved.kind, "core");
        assert.equal(resolved.phase.name, "Specify");
        assert.equal(resolved.phase.commandName, "speckit.specify");
        assert.equal(resolved.phase.status, "done");
        assert.equal(resolved.phase.artifactPath, "specs/001-feature/spec.md");
    });

    test("resolves both stored extension command ID forms", () => {
        const snapshot = {
            composition: {
                artifacts: [
                    {
                        id: "commands/speckit.assess.intake",
                        kind: "command",
                        stack: [
                            {
                                layer: "extension",
                                sourceId: "assess",
                                presetId: null,
                                active: true,
                                sourcePath: ".specify/extensions/assess/commands/intake.md",
                            },
                        ],
                    },
                ],
                extensions: [
                    {
                        id: "assess",
                        name: "Idea Assessment",
                        version: "1.0.0",
                    },
                ],
            },
        };

        for (const id of [
            "commands/speckit.assess.intake",
            "speckit.assess.intake",
        ]) {
            const resolved = resolvePipelineEntry(id, snapshot);
            assert.equal(resolved.kind, "extension");
            assert.equal(resolved.ext.id, "assess");
            assert.equal(resolved.phase.name, "intake");
            assert.equal(resolved.phase.commandName, "speckit.assess.intake");
            assert.equal(
                resolved.sourcePath,
                ".specify/extensions/assess/commands/intake.md",
            );
        }
    });
});
