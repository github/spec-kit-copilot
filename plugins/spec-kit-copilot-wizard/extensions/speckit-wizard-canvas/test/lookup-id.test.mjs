import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseLookupId } from "../ui/lookup-id.mjs";

describe("parseLookupId", () => {
    test("parses a preset command lookupId", () => {
        assert.deepEqual(
            parseLookupId("preset:compliance:command:speckit.plan"),
            { providerKind: "preset", providerId: "compliance", kind: "command", name: "speckit.plan" },
        );
    });

    test("parses an extension template lookupId", () => {
        assert.deepEqual(
            parseLookupId("extension:foo:template:spec.md"),
            { providerKind: "extension", providerId: "foo", kind: "template", name: "spec.md" },
        );
    });

    test("treats colons in <name> as opaque tail", () => {
        const parsed = parseLookupId("preset:x:command:has:colons:in:name");
        assert.equal(parsed.name, "has:colons:in:name");
        assert.equal(parsed.providerId, "x");
        assert.equal(parsed.kind, "command");
    });

    test("returns null for null/empty/garbage/unknown-provider-kind input", () => {
        assert.equal(parseLookupId(null), null);
        assert.equal(parseLookupId(""), null);
        assert.equal(parseLookupId("garbage"), null);
        assert.equal(parseLookupId("core:x:y:z"), null);
        assert.equal(parseLookupId(undefined), null);
        assert.equal(parseLookupId("preset:x:y"), null);
    });
});
