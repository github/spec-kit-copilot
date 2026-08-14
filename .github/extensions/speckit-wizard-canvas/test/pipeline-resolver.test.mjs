import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePipelineEntry } from "../ui/phase-runtime.js";

const snapshotWith = (arts, exts) => ({
    composition: { artifacts: arts, extensions: exts },
});

test("resolvePipelineEntry: canonical id → core", () => {
    const r = resolvePipelineEntry("specify", snapshotWith([], []));
    assert.equal(r.kind, "core");
    assert.equal(r.phase.id, "specify");
    assert.equal(r.phase.name, "Specify");
    assert.equal(r.phase.locked, false);
});

test("resolvePipelineEntry: extension command → extension with prefix-stripped label", () => {
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.intake",
            kind: "command",
            stack: [{ layer: "extension", active: true, presetId: "assess", sourcePath: ".specify/extensions/assess/commands/intake.md" }],
        }],
        [{ id: "assess", name: "Idea Assessment Pipeline", version: "1.0.0" }],
    );
    const r = resolvePipelineEntry("commands/speckit.assess.intake", snap);
    assert.equal(r.kind, "extension");
    assert.equal(r.phase.name, "intake");
    assert.equal(r.phase.commandName, "speckit.assess.intake");
    assert.equal(r.phase.source, "extension:assess");
    assert.equal(r.ext.id, "assess");
    assert.equal(r.ext.name, "Idea Assessment Pipeline");
    assert.equal(r.sourcePath, ".specify/extensions/assess/commands/intake.md");
});

// Regression: pipelineItems() strips the `commands/` prefix from
// inferredPipeline ids (so `isCanonical()` recognizes core phases). That
// caused extension entries to arrive here as bare `speckit.<ext>.<cmd>`,
// which then failed the resolver's startsWith("commands/") gate and
// rendered "Pipeline references unknown commands" — a blank phases page.
test("resolvePipelineEntry: bare extension id (prefix already stripped) → extension", () => {
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.intake",
            kind: "command",
            stack: [{ layer: "extension", active: true, presetId: "assess", sourcePath: ".specify/extensions/assess/commands/intake.md" }],
        }],
        [{ id: "assess", name: "Idea Assessment Pipeline", version: "1.0.0" }],
    );
    const r = resolvePipelineEntry("speckit.assess.intake", snap);
    assert.equal(r.kind, "extension");
    assert.equal(r.phase.name, "intake");
    assert.equal(r.phase.commandName, "speckit.assess.intake");
    assert.equal(r.ext.id, "assess");
});

test("resolvePipelineEntry: hook-bound artifact still resolves as extension", () => {
    // Kind changed from command → hook (e.g. re-classified after user bound it).
    // Stepper + phase card should still render the id sensibly.
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.research",
            kind: "hook",
            stack: [{ layer: "extension", active: true, presetId: "assess" }],
        }],
        [{ id: "assess", name: "Assess", version: "1.0.0" }],
    );
    const r = resolvePipelineEntry("commands/speckit.assess.research", snap);
    assert.equal(r.kind, "extension");
    assert.equal(r.phase.name, "research");
});

test("resolvePipelineEntry: unknown extension command id → orphan", () => {
    const snap = snapshotWith([], []);
    const r = resolvePipelineEntry("commands/speckit.nonexistent.foo", snap);
    assert.equal(r.kind, "orphan");
    assert.equal(r.id, "commands/speckit.nonexistent.foo");
});

test("resolvePipelineEntry: bare bogus id → orphan", () => {
    const r = resolvePipelineEntry("random-bogus", snapshotWith([], []));
    assert.equal(r.kind, "orphan");
});

test("resolvePipelineEntry: non-string id → orphan (defensive)", () => {
    assert.equal(resolvePipelineEntry(null, snapshotWith([], [])).kind, "orphan");
    assert.equal(resolvePipelineEntry(undefined, snapshotWith([], [])).kind, "orphan");
    assert.equal(resolvePipelineEntry(42, snapshotWith([], [])).kind, "orphan");
});

test("resolvePipelineEntry: missing snapshot fields → orphan for extension ids, still works for canonical", () => {
    // Extension branch needs composition, canonical branch is snapshot-free.
    assert.equal(resolvePipelineEntry("commands/speckit.x.y", {}).kind, "orphan");
    assert.equal(resolvePipelineEntry("specify", {}).kind, "core");
});

test("resolvePipelineEntry: extension artifact whose active layer isn't extension is not treated as extension", () => {
    // Defensive: a preset shadowing an extension command would resolve as preset, not extension.
    const snap = snapshotWith(
        [{
            id: "commands/speckit.assess.intake",
            kind: "command",
            stack: [{ layer: "preset", active: true, presetId: "my-preset" }],
        }],
        [{ id: "assess", name: "Assess" }],
    );
    // Not extension-layered → falls through to orphan (phase card / stepper
    // will use the flat command list for it via commands()).
    const r = resolvePipelineEntry("commands/speckit.assess.intake", snap);
    assert.equal(r.kind, "orphan");
});
