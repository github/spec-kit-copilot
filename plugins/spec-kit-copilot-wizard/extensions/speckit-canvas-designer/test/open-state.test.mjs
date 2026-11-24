import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadLastOpen, replaceLastOpen, saveLastOpen } from "../open-state.mjs";

async function fixture(t) {
    const workspace = await mkdtemp(join(tmpdir(), "designer-open-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    return workspace;
}

const record = { handoffId: "handoff-1", pages: [], templates: [] };
const inventory = (workspace) => join(workspace, "speckit-canvas-designer", "last-open.json");

test("failed replacement restores the exact prior inventory, including invalid or missing records", async (t) => {
    const workspace = await fixture(t);
    const fail = async () => { throw new Error("Previous server could not close"); };
    await assert.rejects(replaceLastOpen(workspace, record, fail, () => {}),
        /Previous server could not close/);
    assert.equal(await loadLastOpen(workspace), null);
    await writeFile(inventory(workspace), "{invalid");
    await assert.rejects(replaceLastOpen(workspace, record, fail, () => {}),
        /Previous server could not close/);
    assert.equal(await readFile(inventory(workspace), "utf8"), "{invalid");
    await assert.rejects(replaceLastOpen(workspace, record, async () => {},
        () => { throw new Error("Panel closed while opening"); }),
    /Panel closed while opening/);
    assert.equal(await readFile(inventory(workspace), "utf8"), "{invalid");
});

test("saved open inventory round-trips and rejects a file exceeding 1 MiB", async (t) => {
    const workspace = await fixture(t);
    assert.equal(await loadLastOpen(workspace), null);
    await saveLastOpen(workspace, record);
    assert.deepEqual(await loadLastOpen(workspace), record);
    await writeFile(inventory(workspace), " ".repeat(1024 * 1024 + 1));
    await assert.rejects(loadLastOpen(workspace), /Invalid saved Designer open inventory file/);
    await assert.rejects(saveLastOpen(workspace, {
        ...record, pages: Array.from({ length: 100 }, (_, index) => ({
            name: `page-${index}`, path: "界".repeat(4096),
            kind: "designer.tab-definition", strategy: "replace",
        })),
    }), /Designer open inventory exceeds the size limit/);
});

test("saved open inventory rejects a symlinked file", async (t) => {
    const workspace = await fixture(t);
    await saveLastOpen(workspace, record);
    const path = inventory(workspace);
    const outside = join(workspace, "outside.json");
    await writeFile(outside, await readFile(path));
    await rm(path);
    try {
        await symlink(outside, path, "file");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; file assertion skipped");
        return;
    }
    await assert.rejects(loadLastOpen(workspace));
});

test("saved open inventory rejects a different opened file even when its path is valid", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    await saveLastOpen(workspace, record);
    await saveLastOpen(outside, record);
    await assert.rejects(
        loadLastOpen(workspace, (_path, flags) => open(inventory(outside), flags)),
        /Invalid saved Designer open inventory file/,
    );
});

test("saved open inventory rejects a temporary file replaced after writing", async (t) => {
    const workspace = await fixture(t);
    await saveLastOpen(workspace, record);
    const original = await readFile(inventory(workspace), "utf8");
    await assert.rejects(saveLastOpen(workspace, record, async (path, flags, mode) => {
        const file = await open(path, flags, mode);
        return {
            stat: () => file.stat(),
            close: () => file.close(),
            async writeFile(bytes) {
                await file.writeFile(bytes);
                await rename(path, `${path}.displaced`);
                await writeFile(path, '{"replaced":true}');
            },
        };
    }), /Designer open inventory changed while saving/);
    assert.equal(await readFile(inventory(workspace), "utf8"), original);
});

test("saved open inventory rejects a parent replaced during open, including a missing file", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    await saveLastOpen(workspace, record);
    await saveLastOpen(outside, record);
    const path = inventory(workspace);
    const folder = dirname(path);
    const backup = `${folder}-original`;
    for (const missing of [false, true]) {
        if (missing) await rm(inventory(outside));
        let replaced = false;
        try {
            await assert.rejects(loadLastOpen(workspace, async (file, flags) => {
                await rename(folder, backup);
                try {
                    await symlink(dirname(inventory(outside)), folder,
                        process.platform === "win32" ? "junction" : "dir");
                } catch (error) {
                    await rename(backup, folder);
                    throw error;
                }
                replaced = true;
                return open(file, flags);
            }), missing ? /Designer open inventory escapes session artifacts/
                : /Designer open inventory escapes session artifacts|Invalid saved Designer open inventory file/);
        } catch (error) {
            if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
            t.diagnostic("Windows symlink creation is not permitted; directory assertion skipped");
            return;
        } finally {
            if (replaced) {
                await rm(folder, { recursive: true });
                await rename(backup, folder);
            }
        }
    }
});
