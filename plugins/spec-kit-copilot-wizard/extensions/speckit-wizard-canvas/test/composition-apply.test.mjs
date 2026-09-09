import assert from "node:assert/strict";
import { test } from "node:test";
import {
    normalizeHookArtifactsInComposition,
} from "../canvas-runtime/composition-apply.mjs";

test("preserves command and template artifacts with the same name", () => {
    const composition = {
        artifacts: [
            {
                id: "commands/speckit.shared",
                kind: "command",
                stack: [],
            },
            {
                id: "speckit.shared",
                kind: "template",
                stack: [],
            },
        ],
    };

    const normalized = normalizeHookArtifactsInComposition(composition);

    assert.deepEqual(
        normalized.artifacts.map((artifact) => [artifact.kind, artifact.id]),
        [
            ["command", "commands/speckit.shared"],
            ["template", "speckit.shared"],
        ],
    );
});

test("preserves a hook whose binding already identifies its command", () => {
    const hook = {
        id: "commands/speckit.audit.capture",
        kind: "hook",
        stack: [
            {
                layer: "extension",
                sourceId: "audit",
                presetId: null,
                active: true,
            },
        ],
        hookBindings: [
            {
                phase: "after_plan",
                extensionId: "audit",
                targetCommand: "speckit.audit.capture",
            },
        ],
        hookBinding: {
            phase: "after_plan",
            extensionId: "audit",
            targetCommand: "speckit.audit.capture",
        },
    };
    const composition = {
        artifacts: [
            {
                id: "commands/speckit.audit.scan",
                kind: "command",
                stack: [
                    {
                        layer: "extension",
                        sourceId: "audit",
                        presetId: null,
                        active: true,
                    },
                ],
            },
            hook,
        ],
    };

    const normalized = normalizeHookArtifactsInComposition(composition);
    const normalizedHook = normalized.artifacts.find(
        (artifact) => artifact.kind === "hook",
    );

    assert.equal(normalizedHook, hook);
    assert.equal(normalizedHook.id, "commands/speckit.audit.capture");
    assert.equal(
        normalizedHook.hookBindings[0].targetCommand,
        "speckit.audit.capture",
    );
});
