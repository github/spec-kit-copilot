import assert from "node:assert/strict";
import { test } from "node:test";
import {
    normalizeHookArtifactsInComposition,
    applyComposition,
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

test("does not misattribute a native hook to another command from the same provider", () => {
    // Native hook ids are shaped as `hooks/<event>:<target>` (never
    // `commands/<target>`), and the artifact's own `targetCommand` field
    // is the authoritative source of truth set at shape time. A provider
    // contributing multiple commands (e.g. an extension with several
    // command artifacts) must not cause the hook to be rewritten to
    // whichever of those commands happens to be indexed first.
    const hook = {
        id: "hooks/after_plan:speckit.audit.capture",
        kind: "hook",
        targetCommand: "speckit.audit.capture",
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
            {
                id: "commands/speckit.audit.capture",
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
        ],
    };

    const normalized = normalizeHookArtifactsInComposition(composition);
    const normalizedHook = normalized.artifacts.find(
        (artifact) => artifact.kind === "hook",
    );

    assert.equal(normalizedHook.id, "hooks/after_plan:speckit.audit.capture");
    assert.equal(
        normalizedHook.hookBindings[0].targetCommand,
        "speckit.audit.capture",
    );
    assert.equal(
        normalizedHook.hookBinding.targetCommand,
        "speckit.audit.capture",
    );
});

test("applyComposition preserves the additive strategy on native hook layers", async () => {
    // artifact-cli.mjs shapes native hook layers with strategy "additive"
    // (hooks stack alongside a command rather than replace/wrap/prepend/
    // append it). applyComposition's own strategy allowlist must accept
    // it too, or every hook layer gets silently coerced to "replace" on
    // the way into the cached/UI composition.
    const inst = {
        cachedComposition: undefined,
        cachedPresetItems: [],
        cachedExtensionItems: [],
        broadcast: () => {},
    };
    const input = {
        artifacts: [
            {
                id: "hooks/after_plan:speckit.audit.capture",
                kind: "hook",
                targetCommand: "speckit.audit.capture",
                stack: [
                    {
                        layer: "extension",
                        sourceId: "audit",
                        presetId: null,
                        strategy: "additive",
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
            },
        ],
    };

    const result = await applyComposition(inst, input);
    const hook = result.artifacts.find((artifact) => artifact.kind === "hook");

    assert.equal(hook.stack[0].strategy, "additive");
});
