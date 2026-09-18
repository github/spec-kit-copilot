// Verify Wizard amendment scope checks, stale-answer rejection, and dispatch behavior.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWizardAmendment } from "../server/handlers-amendment.mjs";
import { wizardClarificationScope } from "../shared-workflow-ui/clarifications.mjs";
import { createAmendmentRuntime } from "../generation/generated-canvas-template/amendment-runtime.mjs";
import { compileBlueprint } from "../generation/compiler.mjs";

const marker = (index) => `[NEEDS CLARIFICATION: Question ${index}?]`;
const source = `<!-- provenance -->\n# Existing\nUnrelated prose.\n${[1, 2, 3, 4, 5].map(marker).join("\n")}`;
const answers = [1, 2].map((index) => ({ marker: marker(index), question: `Question ${index}?`, answer: `Answer ${index}` }));

async function fixture(t) {
    const cwd = join(dirname(fileURLToPath(import.meta.url)), `.wizard-amendment-${randomUUID()}`);
    t.after(() => rm(cwd, { force: true, recursive: true }));
    const paths = ["specs/alpha/spec.md", "specs/alpha/plan.md", "specs/beta/spec.md", ".specify/memory/constitution.md", ".specify/assessments/alpha/intake.md"];
    for (const path of paths) {
        await mkdir(dirname(join(cwd, path)), { recursive: true });
        await writeFile(join(cwd, path), source);
    }
    const snapshot = {
        phases: Object.fromEntries(["specify", "plan", "other", "constitution", "commands/speckit.assess.intake"].map((key, index) => [key, { artifactPath: paths[index] }])),
        composition: { artifacts: [{ kind: "command", id: "commands/speckit.assess.intake", stack: [{ layer: "extension", active: true }] }] },
    };
    const inst = { workspacePath: cwd };
    const sends = [];
    let dispatch = async () => {};
    const deps = { getInstance: () => inst, getState: async () => snapshot,
        dispatch: async (input) => { sends.push(input); return dispatch(input); } };
    return { cwd, snapshot, inst, sends, deps, amend: createWizardAmendment(deps),
        input: { scope: wizardClarificationScope(cwd), phase: "speckit.specify", artifact: paths[0], answers },
        dispatch: (callback) => { dispatch = callback; } };
}

test("Wizard amends two of five markers without invoking a skill, touching phase state or rewriting files", async (t) => {
    const f = await fixture(t);
    const before = structuredClone(f.snapshot);
    assert.equal((await f.amend(f.input)).ok, true);
    const { prompt, waitForAcceptance } = f.sends[0];
    assert.equal(waitForAcceptance, true);
    assert.doesNotMatch(prompt, /\/skill:|\/speckit[.:]/);
    assert.match(prompt, /Read the current file before editing/);
    assert.match(prompt, /retain its exact marker and add or update a concise nearby explanation/);
    assert.match(prompt, /rather than adding duplicate notes/);
    const payload = JSON.parse(prompt.split("BEGIN UNTRUSTED JSON DATA\n\n")[1].split("\n\nEND UNTRUSTED JSON DATA")[0]);
    assert.deepEqual(payload.answers, answers);
    assert.equal(payload.workspace, f.cwd);
    assert.deepEqual(f.snapshot, before);
    assert.equal(await readFile(join(f.cwd, f.input.artifact), "utf8"), source);
});

test("Wizard scope, phase, artifact and path authorization reject whole batches without dispatch", async (t) => {
    const f = await fixture(t);
    for (const change of [
        { phase: "unknown" }, { scope: "other-workspace" }, { phase: "speckit.plan" },
        { artifact: "specs/beta/spec.md" }, { artifact: "../outside.md" }, { artifact: ".specify/memory/constitution.md" },
        { answers: [...answers, { ...answers[0], marker: marker(8) }] }, { index: 0 },
    ]) assert.equal((await f.amend({ ...f.input, ...change })).ok, false);
    assert.equal(f.sends.length, 0);
    f.snapshot.phases.specify.artifactPath = "../outside.md";
    assert.equal((await f.amend({ ...f.input, artifact: "../outside.md" })).code, "invalid_artifact");
    await symlink(join(f.cwd, "specs", "beta"), join(f.cwd, "linked"), "junction");
    f.snapshot.phases.specify.artifactPath = "linked/spec.md";
    assert.equal((await f.amend({ ...f.input, artifact: "linked/spec.md" })).code, "invalid_artifact");
    assert.equal(f.sends.length, 0);
});

test("Wizard canonical and extension targets including project Constitution use their effective artifact", async (t) => {
    const f = await fixture(t);
    for (const phase of ["constitution", "commands/speckit.assess.intake"]) {
        const input = { ...f.input, phase, artifact: f.snapshot.phases[phase].artifactPath, answers: [answers[0]] };
        assert.equal((await f.amend(input)).ok, true);
    }
    assert.equal(f.sends.length, 2);
    f.snapshot.composition.artifacts[0].stack[0].active = false;
    assert.equal((await f.amend({ ...f.input, phase: "commands/speckit.assess.intake",
        artifact: f.snapshot.phases["commands/speckit.assess.intake"].artifactPath })).code, "invalid_artifact");
});

test("Wizard failed transport remains retryable and simultaneous panels share only a transient artifact lock", async (t) => {
    const f = await fixture(t);
    f.dispatch(async () => { throw new Error("offline"); });
    assert.equal((await f.amend(f.input)).code, "amendment_failed");
    let release;
    f.dispatch(() => new Promise((resolve) => { release = resolve; }));
    const first = f.amend(f.input);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await createWizardAmendment(f.deps)(f.input)).code, "amendment_pending");
    release();
    assert.equal((await first).ok, true);
    f.dispatch(async () => {});
    const updated = { ...f.input, answers: [{ ...answers[0], answer: "More specific details" }] };
    assert.equal((await f.amend(updated)).ok, true, "remaining markers must not lock out follow-up answers");
    assert.match(f.sends.at(-1).prompt, /More specific details/);
});

for (const host of ["Wizard", "generated"]) {
    test(`${host} rejects stale/ambiguous or noninteractive marker batches atomically`, async (t) => {
        const f = await fixture(t);
        const pipeline = compileBlueprint({ pipeline: [{ id: "specify" }] },
            { extensionId: "validation-test", displayName: "Test", description: "Fixture" }, { multiInstance: true });
        const generated = createAmendmentRuntime({ pipeline, items: async () => [{ id: "alpha", slug: "alpha" }],
            gate: async () => null, dispatch: async () => assert.fail("invalid batch dispatched") });
        const submit = () => host === "Wizard" ? f.amend(f.input) : generated({ cwd: f.cwd, identity: "test" },
            { phase: pipeline.pipeline.steps[0].instanceKey, itemId: "alpha", artifact: f.input.artifact, answers });
        for (const content of [
            `${source}\n${marker(1)}`, `${marker(1)}\n${marker(2)}\n${marker(2)}`,
            `${marker(1)}\n\`${marker(2)}\``, `${marker(1)}\n<!-- ${marker(2)} -->`,
            `${marker(1)}\n~~~\n${marker(2)}\n~~~`,
            `${marker(1)}\n[Read ${marker(2)}](https://example.test)`, marker(1),
        ]) {
            await writeFile(join(f.cwd, f.input.artifact), content);
            assert.equal((await submit()).code, "stale_markers");
        }
        assert.equal(f.sends.length, 0);
    });
}
