import test from "node:test";
import assert from "node:assert/strict";
import { resolveHooksForCommand } from "../pipeline/active-artifacts.mjs";

const extensionCommand = {
    id: "commands/speckit.agent-context.update",
    kind: "command",
    stack: [{ layer: "extension", extensionId: "agent-context", active: true }],
};

function compositionWithHooks() {
    return {
        artifacts: [
            {
                id: "commands/speckit.specify",
                kind: "command",
                hooks: [{
                    phase: "after_specify",
                    targetCommand: "speckit.specify",
                    extensionId: "agent-context",
                }],
            },
            extensionCommand,
            {
                id: "commands/speckit.agent-context.update",
                kind: "hook",
                hookBinding: {
                    phase: "after_specify",
                    targetCommand: "speckit.agent-context.update",
                    extensionId: "agent-context",
                },
                stack: [{ layer: "extension", extensionId: "agent-context", active: true }],
            },
        ],
    };
}

test("resolves hook attribution to the hook command, not the parent phase", () => {
    const hooks = resolveHooksForCommand(compositionWithHooks(), "specify");
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].targetCommand, "speckit.agent-context.update");
});

test("associates standalone hooks with their lifecycle phase", () => {
    const hooks = resolveHooksForCommand(compositionWithHooks(), "specify");
    assert.equal(hooks[0].phase, "after_specify");
});
