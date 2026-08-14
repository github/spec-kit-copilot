// Integration tests for composition-assembler.mjs.
//
// Each case builds a synthetic workspace tree under an OS tmpdir with
// `.specify/presets/<id>/preset.yml`, `.specify/extensions/<id>/extension.yml`,
// and (optionally) `.specify/extensions.yml`, then calls
// `assembleComposition({ workspaceRoot, presetItems, extensionItems })` and
// asserts against small snapshot objects (not full JSON dumps) — verify only
// the fields that matter for the case, so unrelated churn doesn't cascade
// into test edits. `computeStage2Necessity` is exercised at the same time.
//
// Delete alongside composition-assembler.mjs when the speckit CLI exposes
// the composition model natively.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assembleComposition,
    computeStage2Necessity,
} from "../composition/assembler.mjs";

// ---- tmpdir workspace builder ----------------------------------------------

function makeWorkspace() {
    const root = mkdtempSync(join(tmpdir(), "speckit-assembler-"));
    mkdirSync(join(root, ".specify"), { recursive: true });
    return root;
}

function writeYaml(path, obj) {
    // js-yaml is available (see collect.mjs), but here we just
    // handwrite YAML — the shapes are simple and this avoids adding an
    // extra import purely for the test scaffolding.
    writeFileSync(path, toYaml(obj));
}

function toYaml(obj, indent = 0) {
    const pad = "  ".repeat(indent);
    if (obj == null) return "null";
    if (typeof obj === "string") {
        // Quote if it contains special chars.
        if (/[:#\-\n]/.test(obj)) return JSON.stringify(obj);
        return obj;
    }
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
    if (Array.isArray(obj)) {
        if (obj.length === 0) return "[]";
        return obj.map((v) => `${pad}- ${toYamlInline(v, indent + 1)}`).join("\n");
    }
    // object
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";
    return keys
        .map((k) => {
            const v = obj[k];
            if (v && typeof v === "object" && !Array.isArray(v)) {
                return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
            }
            if (Array.isArray(v)) {
                if (v.length === 0) return `${pad}${k}: []`;
                return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
            }
            return `${pad}${k}: ${toYamlScalar(v)}`;
        })
        .join("\n");
}

function toYamlInline(v, indent) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        // Emit as block mapping starting on the next line, aligned with array item.
        const pad = "  ".repeat(indent);
        const keys = Object.keys(v);
        if (keys.length === 0) return "{}";
        const first = keys[0];
        const rest = keys.slice(1);
        const firstLine = renderInlinePair(first, v[first], indent);
        if (rest.length === 0) return firstLine;
        const others = rest
            .map((k) => `${pad}${renderInlinePair(k, v[k], indent)}`)
            .join("\n");
        return `${firstLine}\n${others}`;
    }
    return toYamlScalar(v);
}

function renderInlinePair(k, v, indent) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        return `${k}:\n${toYaml(v, indent + 1)}`;
    }
    if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`;
        return `${k}:\n${toYaml(v, indent + 1)}`;
    }
    return `${k}: ${toYamlScalar(v)}`;
}

function toYamlScalar(v) {
    if (v == null) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "string") {
        if (v === "") return '""';
        if (/[:#\n"]/.test(v)) return JSON.stringify(v);
        return v;
    }
    return JSON.stringify(v);
}

function writePreset(root, id, doc) {
    const dir = join(root, ".specify", "presets", id);
    mkdirSync(dir, { recursive: true });
    writeYaml(join(dir, "preset.yml"), { name: id, ...doc });
}

function writeExtension(root, id, doc) {
    const dir = join(root, ".specify", "extensions", id);
    mkdirSync(dir, { recursive: true });
    writeYaml(join(dir, "extension.yml"), { name: id, ...doc });
}

function writeHooksRegistry(root, hooks) {
    writeYaml(join(root, ".specify", "extensions.yml"), { hooks });
}

function presetItem(id, extra = {}) {
    return { id, installedId: id, active: true, enabled: true, priority: 10, ...extra };
}

function extensionItem(id, extra = {}) {
    return { id, installedId: id, active: true, enabled: true, priority: 10, ...extra };
}

function findArtifact(comp, id) {
    return comp.artifacts.find((a) => a.id === id);
}

function activeLayer(artifact) {
    return artifact?.stack.find((l) => l.active);
}

// ---- Cases -----------------------------------------------------------------

test("core-only workspace: no presets/extensions, synthesized canonical pipeline", async () => {
    const root = makeWorkspace();
    try {
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [],
            extensionItems: [],
        });
        assert.equal(comp.presets.length, 0);
        assert.equal(comp.extensions.length, 0);
        // Every artifact should have exactly one `core` layer, active.
        for (const a of comp.artifacts) {
            const active = activeLayer(a);
            assert.equal(active?.layer, "core", `artifact ${a.id} should be core-active`);
        }
        // Canonical commands present.
        assert.ok(findArtifact(comp, "commands/speckit.constitution"));
        assert.ok(findArtifact(comp, "commands/speckit.specify"));

        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.needed, false, "core-only should not need Stage 2");
        assert.deepEqual(s2.newCommands, []);
        assert.equal(s2.hasStackDirectives, false);
        assert.ok(s2.syntheticPipeline, "synthesized pipeline should be produced");
        assert.equal(s2.syntheticPipeline.shape, "augmented-canonical");
        assert.equal(s2.syntheticPipeline.synthetic, true);
        // Canonical anchors present in synthesized order.
        assert.ok(s2.syntheticPipeline.pipeline.includes("commands/speckit.constitution"));
        assert.ok(s2.syntheticPipeline.pipeline.includes("commands/speckit.implement"));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset that replaces a template: stack has preset (active, replace) above core", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "custom-plan", {
            description: "Custom plan template",
            version: "1.0.0",
            provides: {
                templates: [
                    { name: "plan-template", replaces: "plan-template", description: "custom plan" },
                ],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("custom-plan", { priority: 5 })],
            extensionItems: [],
        });
        assert.equal(comp.presets.length, 1);
        assert.equal(comp.presets[0].id, "custom-plan");
        assert.equal(comp.presets[0].provides.templates, 1);

        const plan = findArtifact(comp, "plan-template");
        assert.ok(plan, "plan-template artifact exists");
        assert.equal(plan.stack.length, 2);
        assert.equal(plan.stack[0].layer, "preset");
        assert.equal(plan.stack[0].presetId, "custom-plan");
        assert.equal(plan.stack[0].active, true);
        assert.equal(plan.stack[0].strategy, "replace");
        assert.equal(plan.stack[1].layer, "core");
        assert.equal(plan.stack[1].active, false);

        // Other core artifacts untouched (single core layer, active).
        const spec = findArtifact(comp, "spec-template");
        assert.equal(spec.stack.length, 1);
        assert.equal(spec.stack[0].layer, "core");

        // No new commands, no stack directives → no Stage 2 needed.
        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.needed, false);
        assert.ok(s2.syntheticPipeline);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset adding a novel command: Stage 2 becomes required", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "with-review", {
            provides: {
                commands: [{ name: "speckit.review", description: "Review step" }],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("with-review")],
            extensionItems: [],
        });
        const review = findArtifact(comp, "commands/speckit.review");
        assert.ok(review, "novel command artifact exists");
        assert.equal(review.stack.length, 1);
        assert.equal(review.stack[0].layer, "preset");
        assert.equal(review.stack[0].presetId, "with-review");
        assert.equal(review.stack[0].active, true);

        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.needed, true, "novel command requires Stage 2");
        assert.deepEqual(s2.newCommands, ["commands/speckit.review"]);
        assert.equal(s2.syntheticPipeline, null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("extension adds command + hook binding: standalone hook artifact + inline attribution", async () => {
    const root = makeWorkspace();
    try {
        writeExtension(root, "guardrails", {
            description: "Adds a plan guardrail hook",
            version: "0.2.0",
            category: "process",
            effect: "read-only",
            provides: {
                commands: [{ name: "guardrails.check", description: "Check guardrails" }],
            },
            hooks: [
                { phase: "after_plan", command: "guardrails.check", optional: false },
            ],
        });
        writeHooksRegistry(root, {
            after_plan: [{ extension: "guardrails", command: "guardrails.check" }],
        });

        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [],
            extensionItems: [extensionItem("guardrails")],
        });

        assert.equal(comp.extensions.length, 1);
        assert.equal(comp.extensions[0].provides.hooks, 1);

        // Standalone hook artifact
        const hook = findArtifact(comp, "commands/guardrails.check");
        assert.ok(hook, "hook artifact exists");
        assert.equal(hook.kind, "hook");
        assert.equal(hook.hookBinding.phase, "after_plan");
        assert.equal(hook.hookBinding.extensionId, "guardrails");

        // Inline hook attribution on target phase command.
        const plan = findArtifact(comp, "commands/speckit.plan");
        assert.ok(plan.hooks?.length, "plan command has inline hook attribution");
        const attr = plan.hooks[0];
        assert.equal(attr.phase, "after_plan");
        assert.equal(attr.extensionId, "guardrails");
        assert.equal(attr.declared, true);
        assert.equal(attr.registered, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset with a wraps: directive on a canonical command forces Stage 2", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "wrapper", {
            provides: {
                commands: [
                    { name: "speckit.plan-wrap", wraps: "speckit.plan", description: "wraps plan" },
                ],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("wrapper")],
            extensionItems: [],
        });
        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.hasStackDirectives, true, "wraps: directive detected");
        assert.equal(s2.needed, true);
        assert.equal(s2.syntheticPipeline, null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preset using `replaces: X` + explicit `strategy: prepend` — Stage 2 sees the prepend", async () => {
    // Regression test for the `copilot-sub-agents` shape: shorthand
    // `replaces:` combined with an explicit `strategy: prepend` field means
    // "prepend before X", NOT "replace X". `computeStage2Necessity` must
    // honor the explicit strategy so `hasStackDirectives` is true.
    const root = makeWorkspace();
    try {
        writePreset(root, "sub-agents", {
            provides: {
                templates: [
                    {
                        type: "command",
                        name: "speckit.specify",
                        file: "commands/speckit.specify.md",
                        replaces: "speckit.specify",
                        strategy: "prepend",
                    },
                ],
            },
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [presetItem("sub-agents")],
            extensionItems: [],
        });
        // Layer strategy on the artifact should reflect prepend.
        const spec = findArtifact(comp, "commands/speckit.specify");
        const presetLayer = spec.stack.find((l) => l.layer === "preset");
        assert.equal(presetLayer.strategy, "prepend");

        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        assert.equal(s2.hasStackDirectives, true, "explicit strategy: prepend detected");
        assert.equal(s2.needed, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("hook artifact IDs are excluded from synthesized pipeline", async () => {
    const root = makeWorkspace();
    try {
        writeExtension(root, "audit", {
            provides: { commands: [{ name: "audit.check" }] },
            hooks: [{ phase: "after_tasks", command: "audit.check" }],
        });
        writeHooksRegistry(root, {
            after_tasks: [{ extension: "audit", command: "audit.check" }],
        });
        const comp = await assembleComposition({
            workspaceRoot: root,
            presetItems: [],
            extensionItems: [extensionItem("audit")],
        });
        const s2 = computeStage2Necessity(comp, comp._presetManifests);
        // audit.check is a hook target — should be excluded from newCommands
        // for pipeline placement purposes. But because it appears as an
        // extension-provided command entry, it also lives in `artifacts` as a
        // command kind. The important thing is the synthesized pipeline (if
        // any) doesn't include it.
        if (s2.syntheticPipeline) {
            assert.ok(
                !s2.syntheticPipeline.pipeline.includes("commands/audit.check"),
                "hook target excluded from synthesized pipeline",
            );
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("fingerprint-like stability: running twice on same fixture produces identical artifacts", async () => {
    const root = makeWorkspace();
    try {
        writePreset(root, "stable", {
            provides: { templates: [{ name: "plan-template", replaces: "plan-template" }] },
        });
        const items = [presetItem("stable", { priority: 5 })];
        const a = await assembleComposition({
            workspaceRoot: root,
            presetItems: items,
            extensionItems: [],
        });
        const b = await assembleComposition({
            workspaceRoot: root,
            presetItems: items,
            extensionItems: [],
        });
        // Strip side channel before comparing.
        const stripA = { presets: a.presets, extensions: a.extensions, artifacts: a.artifacts };
        const stripB = { presets: b.presets, extensions: b.extensions, artifacts: b.artifacts };
        assert.deepEqual(stripA, stripB);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

