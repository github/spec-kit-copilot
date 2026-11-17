import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { effectiveSource } from "../artifact-evidence.mjs";
import { buildArtifactInferencePrompt } from "../canvas-runtime/artifact-inference-prompt.mjs";

test("inference prompt bundles all requested installed skills and verifies their fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "wizard-inference-prompt-"));
    try {
        const commands = [];
        for (const [commandId, text] of [
            ["speckit.plan", "Writes FEATURE_DIR/plan.md."],
            ["speckit.tasks", "Writes FEATURE_DIR/tasks.md."],
        ]) {
            const path = `.github/skills/${commandId.replaceAll(".", "-")}/SKILL.md`;
            const target = join(root, ...path.split("/"));
            await mkdir(join(target, ".."), { recursive: true });
            await writeFile(target, text);
            const installed = await effectiveSource(root, commandId);
            commands.push({ commandId, skillPath: installed.skillPath, fingerprint: installed.fingerprint });
        }

        const prompt = await buildArtifactInferencePrompt({
            workspacePath: root,
            commands,
            endpoint: "http://127.0.0.1:1234/api/artifact-targets?token=test&runId=00000000-0000-4000-8000-000000000001",
        });
        assert.match(prompt, /Use the supplied bundled SKILL\.md text/);
        assert.match(prompt, /Writes FEATURE_DIR\/plan\.md/);
        assert.match(prompt, /Writes FEATURE_DIR\/tasks\.md/);
        assert.match(prompt, /speckit\.plan/);
        assert.match(prompt, /speckit\.tasks/);
        assert.doesNotMatch(prompt, /Read each entire listed SKILL\.md/);

        await assert.rejects(buildArtifactInferencePrompt({
            workspacePath: root,
            commands: [{ ...commands[0], fingerprint: "0".repeat(64) }],
            endpoint: "http://127.0.0.1:1234/api/artifact-targets?token=test&runId=00000000-0000-4000-8000-000000000001",
        }), /changed or is unavailable/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("inference prompt rejects a batch that exceeds its bounded skill-text size", async () => {
    const root = await mkdtemp(join(tmpdir(), "wizard-inference-prompt-"));
    try {
        const commands = [];
        for (const commandId of ["speckit.plan", "speckit.tasks"]) {
            const path = join(root, ".github", "skills", commandId.replaceAll(".", "-"), "SKILL.md");
            await mkdir(join(path, ".."), { recursive: true });
            await writeFile(path, "x".repeat(300 * 1024));
            const source = await effectiveSource(root, commandId);
            commands.push({ commandId, skillPath: source.skillPath, fingerprint: source.fingerprint });
        }
        await assert.rejects(buildArtifactInferencePrompt({
            workspacePath: root,
            commands,
            endpoint: "http://127.0.0.1:1234/api/artifact-targets?token=test&runId=00000000-0000-4000-8000-000000000001",
        }), /exceed the 524288-byte inference input limit/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
