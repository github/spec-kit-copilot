import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractClarifications, scanFeatures } from "../sdd.mjs";

function write(path, content, mtimeSeconds) {
    writeFileSync(path, content);
    utimesSync(path, mtimeSeconds, mtimeSeconds);
}

test("implementation progress scans the complete bounded tasks artifact", (t) => {
    const root = mkdtempSync(join(tmpdir(), "sdd-canvas-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));

    mkdirSync(join(root, ".specify"), { recursive: true });
    const featureDir = join(root, "specs", "001-progress");
    mkdirSync(featureDir, { recursive: true });

    write(join(featureDir, "spec.md"), "# Feature\n", 1);
    write(join(featureDir, "plan.md"), "# Plan\n", 2);
    const tasks = [
        "# Tasks",
        "- [x] T001 Complete near the start",
        "padding".repeat(10_000),
        "- [ ] T002 Incomplete after the 64 KiB scan prefix",
    ].join("\n");
    write(join(featureDir, "tasks.md"), tasks, 3);

    const feature = scanFeatures(root).features[0];
    assert.deepEqual(feature.implement, {
        started: true,
        done: false,
        total: 2,
        completed: 1,
    });
    assert.equal(feature.nextStage, "implement");
});

test("clarifications retain stable indices across supported markdown blocks", () => {
    const markdown = [
        "## Requirements",
        "| Field | Requirement |",
        "| --- | --- |",
        "| catalog | [NEEDS CLARIFICATION: Which catalog?] |",
        "> [NEEDS CLARIFICATION: What fallback?]",
        "- [NEEDS CLARIFICATION: Which preset?]",
        "Use [NEEDS CLARIFICATION: What priority?] for resolution.",
        "```text",
        "[NEEDS CLARIFICATION: Ignore code?]",
        "```",
    ].join("\n");

    assert.deepEqual(extractClarifications(markdown), [
        { index: 0, section: "Requirements", question: "Which catalog?" },
        { index: 1, section: "Requirements", question: "What fallback?" },
        { index: 2, section: "Requirements", question: "Which preset?" },
        { index: 3, section: "Requirements", question: "What priority?" },
    ]);
});

test("dashboard gates setup controls and exposes stage status names", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    assert.match(html, /if \(!setupRequired\) state\.features\.forEach/);
    assert.match(html, /if \(STATE\?\.prerequisites\?\.setupRequired\) return false/);
    assert.match(html, /p\.setAttribute\("aria-label", text \+ ": " \+ kind\)/);
    assert.match(html, /button\.disabled = Boolean\(STATE\?\.prerequisites\?\.setupRequired\)/);
    assert.match(html, /STATE = \{ prerequisites: \{ setupRequired: true \} \}/);
    assert.match(html, /initializeArtifactView\(feature, artifactStage/);
});

test("dashboard matches clarification actions by question instead of render position", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    assert.doesNotMatch(html, /clarificationIndex/);
    assert.match(html, /buildClarificationQueues\(context\)/);
    assert.match(html, /queues\.get\(match\[1\]\.trim\(\)\.toLowerCase\(\)\)/);
    assert.match(html, /appendClarificationActions\(td, cell, context, clarificationQueues\)/);
    assert.match(html, /appendClarificationActions\(node, text, context, clarificationQueues\)/);
});
