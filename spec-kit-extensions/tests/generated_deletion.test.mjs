import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deleteConfinedDirectory } from "../extension-canvas-design/generated-scaffold/files.mjs";

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), "generated-deletion-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "specs", "feature", "nested"), { recursive: true });
    await writeFile(join(root, "specs", "feature", "nested", "spec.md"), "Original workflow");
    return root;
}

test("deletion removes only the inspected workflow and cleans its staging directory", async (t) => {
    const root = await fixture(t);
    await mkdir(join(root, "specs", "neighbor"));
    await writeFile(join(root, "specs", "neighbor", "spec.md"), "Keep");
    await deleteConfinedDirectory(root, "specs/feature");
    await assert.rejects(readdir(join(root, "specs", "feature")), { code: "ENOENT" });
    assert.equal(await readFile(join(root, "specs", "neighbor", "spec.md"), "utf8"), "Keep");
    assert.deepEqual(await readdir(root), ["specs"]);
});

test("replacing the inspected parent during rename does not delete the replacement", async (t) => {
    const root = await fixture(t);
    await assert.rejects(deleteConfinedDirectory(root, "specs/feature", async (source, destination) => {
        await rename(join(root, "specs"), join(root, "original-specs"));
        await mkdir(join(root, "specs", "feature"), { recursive: true });
        await writeFile(join(root, "specs", "feature", "marker"), "Do not delete");
        await rename(source, destination);
    }), /Deletion stopped; the moved directory is retained/);
    await assert.rejects(readdir(join(root, "specs", "feature")), { code: "ENOENT" });
    assert.equal(await readFile(join(root, "original-specs", "feature", "nested", "spec.md"), "utf8"),
        "Original workflow");
    const staging = (await readdir(root)).find((name) => name.startsWith(".speckit-delete-"));
    assert.ok(staging);
    assert.equal(await readFile(join(root, staging, "workflow", "marker"), "utf8"), "Do not delete");
});

test("replacing the inspected workflow during rename does not delete the replacement", async (t) => {
    const root = await fixture(t);
    await assert.rejects(deleteConfinedDirectory(root, "specs/feature", async (source, destination) => {
        await rename(source, join(root, "specs", "original-feature"));
        await mkdir(source);
        await writeFile(join(source, "marker"), "Do not delete");
        await rename(source, destination);
    }), /Deletion stopped; the moved directory is retained/);
    assert.equal(await readFile(join(root, "specs", "original-feature", "nested", "spec.md"), "utf8"),
        "Original workflow");
    const staging = (await readdir(root)).find((name) => name.startsWith(".speckit-delete-"));
    assert.ok(staging);
    assert.equal(await readFile(join(root, staging, "workflow", "marker"), "utf8"), "Do not delete");
});

test("a substituted parent link cannot delete an outside workflow", async (t) => {
    const root = await fixture(t);
    const outside = await mkdtemp(join(tmpdir(), "generated-deletion-outside-"));
    t.after(() => rm(outside, { recursive: true, force: true }));
    const linkType = process.platform === "win32" ? "junction" : "dir";
    try {
        await symlink(outside, join(root, "probe"), linkType);
        await unlink(join(root, "probe"));
    } catch (error) {
        if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
        t.diagnostic(`Directory link unavailable: ${error.code}`);
        return;
    }
    await mkdir(join(outside, "feature"));
    await writeFile(join(outside, "feature", "marker"), "Outside workflow");
    await assert.rejects(deleteConfinedDirectory(root, "specs/feature", async (source, destination) => {
        await rename(join(root, "specs"), join(root, "original-specs"));
        await symlink(outside, join(root, "specs"), linkType);
        await rename(source, destination);
    }), /Deletion stopped|Workflow parent changed|contains a link/);
    const staging = (await readdir(root)).find((name) => name.startsWith(".speckit-delete-"));
    const retained = staging ? join(root, staging, "workflow", "marker") : join(outside, "feature", "marker");
    assert.equal(await readFile(retained, "utf8"), "Outside workflow");
    assert.equal(await readFile(join(root, "original-specs", "feature", "nested", "spec.md"), "utf8"),
        "Original workflow");
});
