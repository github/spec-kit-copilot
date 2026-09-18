// Check complete-example availability without interpreting earlier phase contents.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { compileBlueprint } from "../generation/compiler.mjs";
import { inspectGenerationExample } from "../generation/examples.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(ids = ["specify", "plan", "constitution"]) {
    const root = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), ".example-inspection-"));
    roots.push(root);
    const snapshot = { slug: "alpha", pipeline: ids.map((id) => ({ id })) };
    const blueprint = compileBlueprint(snapshot, { extensionId: "example", displayName: "Example", description: "Test." });
    await mkdir(join(root, "specs", "alpha"), { recursive: true });
    const inspect = (capture = false) => inspectGenerationExample(root, snapshot, blueprint, { capture });
    return { root, snapshot, blueprint, inspect };
}

test("requires full artifact availability but captures only final contents, excluding Constitution", async () => {
    const f = await fixture();
    assert.equal((await f.inspect()).available, false);
    await writeFile(join(f.root, "specs", "alpha", "plan.md"), "Final example");
    assert.deepEqual((await f.inspect()).missing, ["Specify"]);
    await writeFile(join(f.root, "specs", "alpha", "spec.md"), "Earlier PRIVATE content");
    const advisory = await f.inspect();
    assert.equal(advisory.available, true);
    assert.equal(advisory.sample, undefined);
    const captured = await f.inspect(true);
    assert.equal(captured.sample.content, "Final example");
    assert.equal(captured.sample.phase, "1:plan");
    assert.doesNotMatch(JSON.stringify(captured), /PRIVATE/);
    assert.match(captured.sample.fingerprint, /^[a-f0-9]{64}$/);
    await writeFile(join(f.root, "specs", "alpha", "plan.md"), "Changed final");
    assert.notEqual((await f.inspect(true)).sample.fingerprint, captured.sample.fingerprint);
});

test("transient final phases use standard behavior, earlier transient phases do not block examples", async () => {
    for (const ids of [["specify", "analyze"], ["analyze", "specify"], ["specify", "specify"]]) {
        const f = await fixture(ids);
        await writeFile(join(f.root, "specs", "alpha", "spec.md"), "# Example");
        assert.equal((await f.inspect()).available, ids.at(-1) === "specify");
    }
});

test("mixed workflows and unsafe, empty or oversized artifacts fall back without throwing", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "specs", "alpha", "spec.md"), "# Spec");
    await writeFile(join(f.root, "specs", "alpha", "plan.md"), "# Plan");
    f.snapshot.phases = { specify: { artifactPath: "specs/alpha/spec.md" }, plan: { artifactPath: "specs/beta/plan.md" } };
    assert.equal((await f.inspect()).available, false);
    f.snapshot.phases = {};
    for (const content of ["", "x".repeat(512 * 1024 + 1), Buffer.from([0xff])]) {
        await writeFile(join(f.root, "specs", "alpha", "plan.md"), content);
        assert.equal((await f.inspect()).available, false);
    }
    f.snapshot.slug = "../outside";
    assert.equal((await f.inspect()).available, false);
});

test("project artifacts can inform generation and links cannot become examples", async (t) => {
    const f = await fixture(["specify"]);
    f.blueprint.runtime.itemRoot = null;
    f.blueprint.pipeline.steps[0].artifact.pathTemplate = "result.md";
    await writeFile(join(f.root, "result.md"), "# Project output");
    assert.equal((await f.inspect()).available, true);
    await rm(join(f.root, "result.md"));
    await writeFile(join(f.root, "target.md"), "# Not authorized");
    try { await symlink(join(f.root, "target.md"), join(f.root, "result.md")); }
    catch (error) { if (error.code === "EPERM") { t.diagnostic("File symlinks require privileges on this Windows host."); return; } throw error; }
    assert.equal((await f.inspect()).available, false);
});
