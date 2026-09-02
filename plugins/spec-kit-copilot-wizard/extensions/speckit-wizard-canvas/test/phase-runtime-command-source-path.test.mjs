import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";
import { commandSourcePath } from "../ui/phase-runtime.js";
import { state } from "../ui/state.js";

// commandSourcePath resolves the on-disk markdown path for a command tile.
// Priority: (1) composition activeLayer.sourcePath, (2) derived preset path
// from the winning layer's `lookupId` provider id + `p.commandName`,
// (3) legacy `p.source: "preset:<id>"` string fallback — this is the ONLY
// provenance the real snapshot-builder.mjs::buildCommands producer attaches
// to preset-only command objects today (no `lookupId` yet), so this
// fallback must stay reachable until that producer is migrated.

describe("commandSourcePath", () => {
    beforeEach(() => {
        state.snapshot = null;
    });

    test("returns null for falsy input", () => {
        assert.equal(commandSourcePath(null), null);
    });

    test("prefers composition activeLayer.sourcePath when present", () => {
        state.snapshot = {
            composition: {
                artifacts: [
                    {
                        id: "commands/speckit.plan",
                        stack: [
                            {
                                active: true,
                                sourcePath: ".specify/presets/compliance/commands/speckit.plan.md",
                                lookupId: "preset:compliance:command:speckit.plan",
                            },
                        ],
                    },
                ],
            },
        };
        const p = { id: "plan", commandName: "speckit.plan", lookupId: "preset:compliance:command:speckit.plan" };
        assert.equal(commandSourcePath(p), ".specify/presets/compliance/commands/speckit.plan.md");
    });

    test("falls back to deriving path from active composition layer's lookupId when sourcePath is absent", () => {
        state.snapshot = {
            composition: {
                artifacts: [
                    {
                        id: "commands/speckit.plan",
                        stack: [
                            {
                                active: true,
                                sourcePath: null,
                                lookupId: "preset:compliance:command:speckit.plan",
                            },
                        ],
                    },
                ],
            },
        };
        const p = { id: "plan", commandName: "speckit.plan", lookupId: null };
        assert.equal(commandSourcePath(p), ".specify/presets/compliance/commands/speckit.plan.md");
    });

    test("falls back to the phase's own lookupId when there is no composition entry", () => {
        state.snapshot = { composition: { artifacts: [] } };
        const p = { id: "plan", commandName: "speckit.plan", lookupId: "preset:game-narrative:command:speckit.plan" };
        assert.equal(commandSourcePath(p), ".specify/presets/game-narrative/commands/speckit.plan.md");
    });

    test("returns null for an extension-provided lookupId (not a preset path)", () => {
        state.snapshot = { composition: { artifacts: [] } };
        const p = { id: "foo", commandName: "speckit.foo.bar", lookupId: "extension:foo:command:speckit.foo.bar" };
        assert.equal(commandSourcePath(p), null);
    });

    test("falls back to legacy p.source string when there is no lookupId at all (real preset-only command shape)", () => {
        // Mirrors what snapshot-builder.mjs::buildCommands actually emits for
        // a preset-only command: `source: "preset:<presetId>"`, no
        // `lookupId`, and no composition artifact entry.
        state.snapshot = { composition: { artifacts: [] } };
        const p = { id: "plan", commandName: "speckit.plan", source: "preset:compliance" };
        assert.equal(commandSourcePath(p), ".specify/presets/compliance/commands/speckit.plan.md");
    });

    test("returns null when there is no lookupId, no legacy source, and no composition entry", () => {
        state.snapshot = { composition: { artifacts: [] } };
        const p = { id: "specify", commandName: "speckit.specify", lookupId: null };
        assert.equal(commandSourcePath(p), null);
    });
});
