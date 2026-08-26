import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    buildCompositionFromCli,
} from "../composition/artifact-cli.mjs";
import { computePipelineFastPath } from "../composition/pipeline-fast-path.mjs";
import { findLayerByLookupId } from "../ui/lookup-id.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Fake runner — mimics the specify CLI for `artifact list --json`.
//
// The list payload IS the composition data: each row carries its own
// `stack`. Fixtures are a flat array of rows.
// ---------------------------------------------------------------------------

function fakeRunner(rows) {
    return function (cmd, args) {
        assert.equal(cmd, "specify");
        assert.equal(args[0], "artifact");
        if (args[1] === "list" && args.includes("--json")) {
            return Buffer.from(JSON.stringify(rows));
        }
        throw new Error(`unexpected CLI invocation: ${args.join(" ")}`);
    };
}

// Minimal fixture: one core command, one preset override with two layers.
const CORE_ONLY_FIXTURE = [
    {
        id: "command:speckit.specify",
        name: "speckit.specify",
        kind: "command",
        description: "Baseline spec.",
        stack: [
            {
                id: "command:speckit.specify",
                layer: null,
                sourceId: null,
                presetId: null,
                presetName: null,
                strategy: "replace",
                active: true,
                hidden: false,
                manifestPath: null,
                lookupId: null,
            },
        ],
    },
    {
        id: "template:spec-template",
        name: "spec-template",
        kind: "template",
        description: "",
        stack: [
            {
                id: "template:spec-template",
                layer: null,
                sourceId: null,
                presetId: null,
                presetName: null,
                strategy: "replace",
                active: true,
                hidden: false,
                manifestPath: null,
                lookupId: null,
            },
        ],
    },
    {
        id: "script:common",
        name: "common",
        kind: "script",
        description: "Common helpers.",
        stack: [
            {
                id: "script:common",
                layer: null,
                sourceId: null,
                presetId: null,
                presetName: null,
                strategy: "replace",
                active: true,
                hidden: false,
                manifestPath: null,
                lookupId: null,
            },
        ],
    },
];

const PRESET_OVERRIDE_FIXTURE = [
    {
        id: "command:speckit.plan",
        name: "speckit.plan",
        kind: "command",
        description: "Compliance plan.",
        stack: [
            {
                id: "command:speckit.plan",
                layer: "preset",
                sourceId: "compliance",
                presetId: "compliance",
                presetName: "Compliance Preset",
                strategy: "replace",
                active: true,
                hidden: false,
                manifestPath: ".specify/presets/compliance/preset.yml",
                lookupId: "preset:compliance:command:speckit.plan",
            },
            {
                id: "command:speckit.plan",
                layer: null,
                sourceId: null,
                presetId: null,
                presetName: null,
                strategy: "replace",
                active: false,
                hidden: true,
                manifestPath: null,
                lookupId: null,
            },
        ],
    },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCompositionFromCli", () => {
    test("shape-maps core-only inventory: ids stripped of kind prefix, null layer → 'core'", async () => {
        const root = mkdtempSync(join(tmpdir(), "speckit-cli-test-"));
        try {
            const comp = await buildCompositionFromCli({
                workspaceRoot: root,
                presetItems: [],
                extensionItems: [],
                runner: fakeRunner(CORE_ONLY_FIXTURE),
            });

            // Commands use `commands/<name>`; templates/scripts use bare names.
            const cmd = comp.artifacts.find((a) => a.kind === "command");
            assert.equal(cmd.id, "commands/speckit.specify");
            const tmpl = comp.artifacts.find((a) => a.kind === "template");
            assert.equal(tmpl.id, "spec-template");
            const script = comp.artifacts.find((a) => a.kind === "script");
            assert.equal(script.id, "common");

            // CLI's `null` layer becomes wizard's "core" for display.
            for (const a of comp.artifacts) {
                assert.equal(a.stack[0].layer, "core");
                assert.equal(a.stack[0].active, true, "CLI active passed through");
                // Guardrail: no synthesized provenance for built-in layers.
                assert.equal(a.stack[0].sourceId, null);
                assert.equal(a.stack[0].presetId, null);
                assert.equal(a.stack[0].lookupId, null);
                assert.equal(a.stack[0].manifestPath, null);
            }

            // No installed presets/extensions.
            assert.deepEqual(comp.presets, []);
            assert.deepEqual(comp.extensions, []);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("preserves preset provenance, hidden flag, active-on-winner", async () => {
        const root = mkdtempSync(join(tmpdir(), "speckit-cli-test-"));
        try {
            const comp = await buildCompositionFromCli({
                workspaceRoot: root,
                presetItems: [
                    { id: "compliance", installedId: "compliance", active: true, name: "Compliance Preset", version: "1.2.3", priority: 20 },
                ],
                extensionItems: [],
                runner: fakeRunner(PRESET_OVERRIDE_FIXTURE),
            });

            const cmd = comp.artifacts.find((a) => a.id === "commands/speckit.plan");
            assert.ok(cmd);
            assert.equal(cmd.stack.length, 2);

            // Winning preset layer.
            const winner = cmd.stack[0];
            assert.equal(winner.layer, "preset");
            assert.equal(winner.presetId, "compliance");
            assert.equal(winner.presetName, "Compliance Preset");
            assert.equal(winner.sourceId, "compliance");
            assert.equal(winner.active, true);
            assert.equal(winner.hidden, false);
            assert.equal(winner.manifestPath, ".specify/presets/compliance/preset.yml");
            assert.equal(winner.lookupId, "preset:compliance:command:speckit.plan");
            // Behavioral coverage: the CLI-shaped composition artifact
            // round-trips through findLayerByLookupId back to this winner
            // (parseLookupId's own shape/edge-case behavior is covered by
            // test/lookup-id.test.mjs — no need to re-assert it here).
            assert.equal(findLayerByLookupId(cmd, winner.lookupId), winner);

            // Hidden built-in layer.
            const built = cmd.stack[1];
            assert.equal(built.layer, "core");
            assert.equal(built.active, false);
            assert.equal(built.hidden, true);

            // Preset summary was derived, with catalog metadata attached.
            assert.equal(comp.presets.length, 1);
            const [presetSummary] = comp.presets;
            assert.equal(presetSummary.id, "compliance");
            assert.equal(presetSummary.name, "Compliance Preset");
            assert.equal(presetSummary.version, "1.2.3");
            assert.equal(presetSummary.priority, 20);
            assert.equal(presetSummary.provides.commands, 1);
            assert.equal(presetSummary.provides.templates, 0);
            assert.equal(presetSummary.provides.scripts, 0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("stage2 synthesizes canonical pipeline when no directives/new commands", async () => {
        const root = mkdtempSync(join(tmpdir(), "speckit-cli-test-"));
        try {
            // Build a fixture containing every REQUIRED canonical command.
            const requiredNames = ["speckit.constitution", "speckit.specify", "speckit.plan", "speckit.tasks", "speckit.implement"];
            const rows = [];
            for (const name of requiredNames) {
                const id = `command:${name}`;
                rows.push({
                    id, name, kind: "command", description: "",
                    stack: [
                        {
                            id, layer: null, sourceId: null, presetId: null, presetName: null,
                            strategy: "replace", active: true, hidden: false, manifestPath: null, lookupId: null,
                        },
                    ],
                });
            }
            const comp = await buildCompositionFromCli({
                workspaceRoot: root,
                presetItems: [],
                extensionItems: [],
                runner: fakeRunner(rows),
            });
            const fp = computePipelineFastPath(comp);
            assert.equal(fp.canSynthesize, true);
            assert.equal(fp.hasStackDirectives, false);
            assert.deepEqual(fp.newCommands, []);
            assert.ok(fp.syntheticPipeline);
            assert.equal(fp.syntheticPipeline.synthetic, true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("stage2 detects wrap/prepend/append directives on canonical commands", async () => {
        const root = mkdtempSync(join(tmpdir(), "speckit-cli-test-"));
        try {
            const rows = [
                {
                    id: "command:speckit.plan", name: "speckit.plan", kind: "command", description: "",
                    stack: [
                        {
                            id: "command:speckit.plan", layer: "preset",
                            sourceId: "wrapper", presetId: "wrapper", presetName: "Wrapper",
                            strategy: "wrap", active: true, hidden: false,
                            manifestPath: ".specify/presets/wrapper/preset.yml",
                            lookupId: "preset:wrapper:command:speckit.plan",
                        },
                        {
                            id: "command:speckit.plan", layer: null, sourceId: null, presetId: null,
                            presetName: null, strategy: "replace", active: false, hidden: false,
                            manifestPath: null, lookupId: null,
                        },
                    ],
                },
            ];
            const comp = await buildCompositionFromCli({
                workspaceRoot: root,
                presetItems: [{ id: "wrapper", installedId: "wrapper", active: true, name: "Wrapper" }],
                extensionItems: [],
                runner: fakeRunner(rows),
            });
            const fp = computePipelineFastPath(comp);
            assert.equal(fp.hasStackDirectives, true);
            assert.equal(fp.canSynthesize, false);
            assert.equal(fp.syntheticPipeline, null);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
