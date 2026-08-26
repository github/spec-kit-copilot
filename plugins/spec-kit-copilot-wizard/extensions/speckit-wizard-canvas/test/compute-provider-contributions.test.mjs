import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeProviderContributions } from "../ui/composition.js";

// computeProviderContributions buckets stack layers by provider id, tallying
// "customized" (core-inventory overrides) vs "added" (new) contributions.
// Bucket key resolution: prefer parseLookupId(layer.lookupId)?.providerId,
// falling back to layer.presetId ?? layer.extensionId for wizard-synthesized
// hook layers (which carry lookupId: null).

describe("computeProviderContributions", () => {
    test("buckets a preset winner by lookupId providerId", () => {
        const artifacts = [
            {
                id: "commands/speckit.plan",
                kind: "command",
                stack: [
                    { layer: "preset", presetId: "compliance", lookupId: "preset:compliance:command:speckit.plan" },
                ],
            },
        ];
        const contributions = computeProviderContributions(artifacts);
        assert.ok(contributions.has("compliance"));
    });

    test("buckets an extension layer by lookupId providerId", () => {
        const artifacts = [
            {
                id: "templates/spec.md",
                kind: "template",
                stack: [
                    { layer: "extension", extensionId: "foo", lookupId: "extension:foo:template:spec.md" },
                ],
            },
        ];
        const contributions = computeProviderContributions(artifacts);
        assert.ok(contributions.has("foo"));
    });

    test("falls back to extensionId for hook-synthetic layers with lookupId: null", () => {
        const artifacts = [
            {
                id: "commands/some-hook-command",
                kind: "hook",
                hookBindings: [{ phase: "after_specify" }],
                stack: [
                    { layer: "extension", extensionId: "hooks-ext", lookupId: null },
                ],
            },
        ];
        const contributions = computeProviderContributions(artifacts);
        assert.ok(contributions.has("hooks-ext"));
    });

    test("lookupId wins when both lookupId and legacy presetId/extensionId are present", () => {
        const artifacts = [
            {
                id: "commands/speckit.plan",
                kind: "command",
                stack: [
                    {
                        layer: "preset",
                        presetId: "legacy-id",
                        extensionId: "legacy-ext-id",
                        lookupId: "preset:compliance:command:speckit.plan",
                    },
                ],
            },
        ];
        const contributions = computeProviderContributions(artifacts);
        assert.ok(contributions.has("compliance"));
        assert.ok(!contributions.has("legacy-id"));
        assert.ok(!contributions.has("legacy-ext-id"));
    });
});
