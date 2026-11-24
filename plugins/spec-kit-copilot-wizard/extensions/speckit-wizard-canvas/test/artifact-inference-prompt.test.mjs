import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { effectiveSource } from "../artifact-evidence.mjs";
import { buildArtifactInferencePrompt, captureArtifactInferenceSources } from "../canvas-runtime/artifact-inference-prompt.mjs";
import { validateInferenceInput } from "../../speckit-canvas-designer/contracts/output-inference.mjs";

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

test("Wizard capture and Designer validation enforce the same aggregate skill-text boundary", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "wizard-inference-boundary-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const ids = ["plan", "tasks"];
    for (const id of ids) {
        const path = join(root, ".github", "skills", `speckit-${id}`, "SKILL.md");
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, "x".repeat(256 * 1024));
    }

    async function inputs() {
        const sources = await Promise.all(ids.map((id) => effectiveSource(root, `speckit.${id}`)));
        const commands = sources.map((source, index) => ({
            phase: ids[index], commandId: `speckit.${ids[index]}`, skillPath: source.skillPath,
            fingerprint: source.fingerprint, sources: source.sources, text: source.skillText,
        }));
        const input = { schemaVersion: 1, workspacePath: root, commands };
        const pendingOutputs = {
            inputHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
            commands: commands.map(({ phase, commandId, fingerprint }) => ({ phase, commandId, fingerprint })),
        };
        const workflow = { selectedPhases: ids, pendingOutputs,
            outputEvidence: Object.fromEntries(ids.map((id) => [id, { outputs: [], view: null }])) };
        return { input, handoff: { workflow }, requests: commands };
    }

    const valid = await inputs();
    assert.equal((await captureArtifactInferenceSources({ workspacePath: root, commands: valid.requests })).length, 2);
    assert.equal(validateInferenceInput(valid.input, valid.handoff), valid.input);

    await writeFile(join(root, ".github", "skills", "speckit-tasks", "SKILL.md"), "x".repeat(256 * 1024 + 1));
    const oversized = await inputs();
    await assert.rejects(captureArtifactInferenceSources({ workspacePath: root, commands: oversized.requests }),
        /exceed the 524288-byte inference input limit/);
    assert.throws(() => validateInferenceInput(oversized.input, oversized.handoff), /exceeds 512 KiB/);
});
