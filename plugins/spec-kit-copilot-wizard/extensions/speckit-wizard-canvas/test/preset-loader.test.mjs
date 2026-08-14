// Tests for preset-loader.mjs — disk read + YAML parse + fallback.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadPresetGraph, parseCommandFile } from "../composition/preset-loader.mjs";

// A tiny in-memory `deps` factory that mimics scanner.mjs's fs facade.
// Keys in `files` may use forward slashes; the mock normalizes any lookup
// path (which node's path.join produces with platform separators) back to
// forward slashes so tests are cross-platform.
const norm = (p) => String(p).replace(/\\/g, "/");
function makeDeps(files) {
    const store = {};
    for (const [k, v] of Object.entries(files)) store[norm(k)] = v;
    return {
        async pathExists(p) { return store[norm(p)] !== undefined && store[norm(p)] !== null; },
        async readFile(p) {
            const v = store[norm(p)];
            if (v === undefined || v === null) throw new Error(`ENOENT ${p}`);
            return typeof v === "string" ? v : v.toString("utf8");
        },
        async readdir(p, opts) {
            const key = norm(p);
            const prefix = key.endsWith("/") ? key : key + "/";
            const seen = new Set();
            const out = [];
            for (const k of Object.keys(store)) {
                if (!k.startsWith(prefix)) continue;
                const tail = k.slice(prefix.length);
                const first = tail.split("/")[0];
                if (!first || seen.has(first)) continue;
                seen.add(first);
                const isDir = tail.includes("/");
                out.push(opts?.withFileTypes ? {
                    name: first,
                    isDirectory: () => isDir,
                    isFile: () => !isDir,
                } : first);
            }
            return out;
        },
        async stat(p) {
            if (store[norm(p)] === undefined || store[norm(p)] === null) throw new Error(`ENOENT ${p}`);
            return { isFile: () => true, isDirectory: () => false, mtimeMs: 1000, size: 10 };
        },
    };
}

test("loadPresetGraph returns empty core-only fallback when workspace has no .specify/presets/", async () => {
    // The canonical phase list is synthesized in the UI layer from
    // pipeline/canonical.mjs (canonicalSpine + CANONICAL_UNSEEDED), so the
    // preset-loader fallback returns empty preset + command arrays instead
    // of duplicating the canonical data in a hand-maintained CORE_WORKFLOW
    // shim (deleted 2025 with core/workflow.mjs).
    const deps = makeDeps({});
    const result = await loadPresetGraph("/ws", deps);
    assert.equal(result.activePreset, null);
    assert.deepEqual(result.commands, []);
    assert.deepEqual(result.presets, []);
});

test("loadPresetGraph loads a preset from disk via .registry + preset.yml + command file", async () => {
    const files = {
        "/ws/.specify/presets": "DIR",
        "/ws/.specify/presets/.registry": JSON.stringify([
            { id: "narrative", priority: 100, enabled: true },
        ]),
        "/ws/.specify/presets/narrative": "DIR",
        "/ws/.specify/presets/narrative/preset.yml": `
preset:
  name: Game Narrative
  description: Story-first Spec Kit workflow
  version: 1.0.0
provides:
  templates:
    - type: command
      name: speckit.outline
      file: commands/outline.md
      description: Outline the story beats.
    - type: command
      name: speckit.draft
      file: commands/draft.md
`,
        "/ws/.specify/presets/narrative/commands/outline.md": `---
description: Outline the story beats
handoffs:
  - label: Draft the scene
    agent: speckit.draft
    prompt: ""
  - label: Skip to review
    agent: speckit.review
---
# Outline

Write the beat-by-beat story outline.

## User Input

- Story concept in one paragraph
- Genre and tone
- Target audience
`,
        "/ws/.specify/presets/narrative/commands/draft.md": `---
description: Draft a scene
handoffs: []
---
# Draft

Fills in prose based on the outline.

## User Input

- Nothing — draft the next beat
`,
    };
    const deps = makeDeps(files);
    const result = await loadPresetGraph("/ws", deps);
    assert.equal(result.activePreset.id, "narrative");
    assert.equal(result.commands.length, 2);
    const outline = result.commands.find((c) => c.name === "speckit.outline");
    assert.ok(outline);
    assert.equal(outline.description, "Outline the story beats");
    assert.equal(outline.handoffs.length, 2);
    assert.equal(outline.handoffs[0].agent, "speckit.draft");
    assert.deepEqual(outline.userInput, [
        "Story concept in one paragraph",
        "Genre and tone",
        "Target audience",
    ]);
    assert.equal(outline.placeholder, "Story concept in one paragraph");
});

test("loadPresetGraph falls back to empty graph when preset.yml is malformed", async () => {
    const files = {
        "/ws/.specify/presets": "DIR",
        "/ws/.specify/presets/.registry": JSON.stringify([{ id: "broken", priority: 1, enabled: true }]),
        "/ws/.specify/presets/broken": "DIR",
        "/ws/.specify/presets/broken/preset.yml": "not: valid: yaml: [oops",
    };
    const deps = makeDeps(files);
    const result = await loadPresetGraph("/ws", deps);
    assert.equal(result.activePreset, null);
    assert.deepEqual(result.presets, []);
    assert.ok(result.warnings.some((w) => w.includes("broken")));
});

test("loadPresetGraph handles agent-materialized files with stripped handoffs", async () => {
    // preset.yml is fine, but the command file has no `handoffs:` key.
    const files = {
        "/ws/.specify/presets": "DIR",
        "/ws/.specify/presets/.registry": JSON.stringify([{ id: "stripped", priority: 1, enabled: true }]),
        "/ws/.specify/presets/stripped": "DIR",
        "/ws/.specify/presets/stripped/preset.yml": `
preset:
  name: Stripped
  version: 1.0.0
provides:
  templates:
    - type: command
      name: speckit.lonely
      file: commands/lonely.md
`,
        "/ws/.specify/presets/stripped/commands/lonely.md": `---
description: A lonely command
---
# Lonely

Runs alone.
`,
    };
    const deps = makeDeps(files);
    const result = await loadPresetGraph("/ws", deps);
    const cmd = result.commands.find((c) => c.name === "speckit.lonely");
    assert.ok(cmd);
    assert.deepEqual(cmd.handoffs, []);
    assert.equal(cmd.description, "A lonely command");
});

test("parseCommandFile smoke: returns userInput array (structural, not phrase)", async () => {
    // Full phrase/description snapshots are dropped — the parseCommandFile
    // description slice is exercised end-to-end by loadPresetGraph tests
    // below. Keep one structural test that guards the userInput extraction
    // (which the wizard uses to render form placeholders).
    const raw = `---\nhandoffs: []\n---\n# Cmd\n\nProse.\n\n## User Input\n\n- One\n- Two\n`;
    const parsed = await parseCommandFile(raw);
    assert.deepEqual(parsed.userInput, ["One", "Two"]);
    assert.equal(typeof parsed.description, "string");
    assert.ok(parsed.description.length > 0);
});

// Real CLI on-disk shape (specify >= 0.11): { schema_version, presets: { <id>: {...} } }
test("loadPresetGraph parses the real CLI .registry shape (schema_version + presets object-map)", async () => {
    const files = {
        "/ws/.specify/presets": "DIR",
        "/ws/.specify/presets/.registry": JSON.stringify({
            schema_version: "1.0",
            presets: {
                lean: { version: "1.0.0", source: "local", enabled: true, priority: 10, registered_skills: {} },
            },
        }),
        "/ws/.specify/presets/lean": "DIR",
        "/ws/.specify/presets/lean/preset.yml": `preset:\n  name: Lean\n  version: 1.0.0\nprovides:\n  templates: []`,
    };
    const deps = makeDeps(files);
    const result = await loadPresetGraph("/ws", deps);
    assert.equal(result.presets.length, 1);
    assert.equal(result.presets[0].id, "lean");
    assert.equal(result.activePreset.id, "lean");
});

// Regression: the split-list layout (provides.commands / provides.templates /
// provides.scripts as separate top-level lists) must load the same as the
// mixed-bucket layout. This is a shape used by some real presets —
// before the fix, its 32 commands were silently dropped and never appeared in
// the wizard's Phases tab.
test("loadPresetGraph accepts the split-list provides layout (commands / templates / scripts)", async () => {
    const files = {
        "/ws/.specify/presets": "DIR",
        "/ws/.specify/presets/.registry": JSON.stringify([{ id: "split", priority: 1, enabled: true }]),
        "/ws/.specify/presets/split": "DIR",
        "/ws/.specify/presets/split/preset.yml": `
preset:
  name: Split
  version: 1.0.0
provides:
  templates:
    - type: template
      name: spec-template
      file: templates/spec-template.md
      replaces: spec-template
  commands:
    - type: command
      name: speckit.brainstorm
      file: commands/brainstorm.md
      description: Interactive brainstorming.
    - type: command
      name: speckit.specify
      file: commands/specify.md
      replaces: speckit.specify
  scripts:
    - type: script
      name: export
      file: scripts/export.ps1
      description: Export the current draft.
`,
        "/ws/.specify/presets/split/commands/brainstorm.md": `---\ndescription: Brainstorm\nhandoffs: []\n---\n# Brainstorm\n\nAsk questions in a loop.\n`,
        "/ws/.specify/presets/split/commands/specify.md": `---\ndescription: Specify (split-flavor)\nhandoffs: []\n---\n# Specify\n\nWrite the spec.\n`,
    };
    const deps = makeDeps(files);
    const result = await loadPresetGraph("/ws", deps);
    assert.equal(result.presets.length, 1);
    const preset = result.presets[0];

    // Commands from provides.commands[] flow into the phase graph.
    const cmdNames = preset.commands.map((c) => c.name).sort();
    assert.deepEqual(cmdNames, ["speckit.brainstorm", "speckit.specify"]);
    const brainstorm = preset.commands.find((c) => c.name === "speckit.brainstorm");
    assert.equal(brainstorm.description, "Brainstorm");
    const specifyCmd = preset.commands.find((c) => c.name === "speckit.specify");
    assert.equal(specifyCmd.replaces, "speckit.specify");

    // Templates and scripts surface as metadata for composition consumers.
    assert.equal(preset.templates.length, 1);
    assert.equal(preset.templates[0].name, "spec-template");
    assert.equal(preset.templates[0].replaces, "spec-template");
    assert.equal(preset.scripts.length, 1);
    assert.equal(preset.scripts[0].name, "export");
    assert.equal(preset.scripts[0].file, "scripts/export.ps1");
});

// Regression: when the same command is declared in BOTH the mixed bucket and
// the split list, we take the split-list entry once. No duplicates in the
// merged command set.
test("loadPresetGraph dedupes when a preset declares an entry under both provides.templates and provides.commands", async () => {
    const files = {
        "/ws/.specify/presets": "DIR",
        "/ws/.specify/presets/.registry": JSON.stringify([{ id: "dup", priority: 1, enabled: true }]),
        "/ws/.specify/presets/dup": "DIR",
        "/ws/.specify/presets/dup/preset.yml": `
preset:
  name: Dup
  version: 1.0.0
provides:
  templates:
    - type: command
      name: speckit.only
      file: commands/only.md
  commands:
    - type: command
      name: speckit.only
      file: commands/only.md
`,
        "/ws/.specify/presets/dup/commands/only.md": `---\ndescription: Only once\nhandoffs: []\n---\n# Only\n`,
    };
    const deps = makeDeps(files);
    const result = await loadPresetGraph("/ws", deps);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].name, "speckit.only");
});
