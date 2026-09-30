import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    fingerprint, handoffDirectory, HANDOFF_LIMIT, readHandoff, validateHandoff,
    validateHandoffId,
} from "../handoff.mjs";
import { shellHtml, startShell } from "../server.mjs";

const ID = "designer_1";

function validHandoff(id = ID) {
    const workflow = { selectedPhases: ["specify", "plan"] };
    const selections = {
        presets: [{ id: "theme", source: "copilot", approved: true,
            version: "1.2.3", downloadUrl: "https://example.com/theme" }],
        extensions: [],
        bundles: [{ id: "starter", source: "default", approved: true,
            version: null, downloadUrl: null }],
    };
    return { schemaVersion: 1, handoffId: id, workflow, selections,
        sourceFingerprint: fingerprint({ workflow, selections }) };
}

async function fixture(t) {
    const workspace = await mkdtemp(join(tmpdir(), "speckit-designer-test-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    return workspace;
}

async function saveHandoff(workspace, handoff = validHandoff()) {
    const directory = handoffDirectory(workspace, handoff.handoffId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "handoff.json"), JSON.stringify(handoff));
    return directory;
}

test("handoff validates bounded IDs, shape, URLs and fingerprint", () => {
    const good = validHandoff();
    assert.equal(validateHandoff(good, ID), good);
    for (const id of ["", "../escape", "space here", "x".repeat(129), null]) {
        assert.throws(() => validateHandoffId(id), /Invalid Designer handoff ID/);
    }
    assert.throws(() => validateHandoff(good, "different"), /Invalid Designer handoff/);
    const mutate = (change) => {
        const copy = structuredClone(good);
        change(copy);
        copy.sourceFingerprint = fingerprint({ workflow: copy.workflow, selections: copy.selections });
        return copy;
    };
    const invalid = [
        mutate((copy) => { copy.extra = "unexpected"; }),
        mutate((copy) => { copy.workflow.selectedPhases = Array(31).fill("plan"); }),
        mutate((copy) => { copy.selections.presets.push({ ...copy.selections.presets[0] }); }),
        mutate((copy) => { copy.selections.presets[0].downloadUrl = "http://example.com"; }),
        mutate((copy) => { copy.selections.presets[0].downloadUrl = "https://user:pass@example.com"; }),
        mutate((copy) => { copy.selections.bundles[0].approved = false; }),
        mutate((copy) => { delete copy.selections.extensions; }),
        mutate((copy) => { copy.selections.presets[0].id = "../escape"; }),
    ];
    for (const handoff of invalid) {
        assert.throws(() => validateHandoff(handoff, ID), /Invalid Designer handoff/);
    }
    const changed = structuredClone(good);
    changed.workflow.selectedPhases.push("tasks");
    assert.throws(() => validateHandoff(changed, ID), /fingerprint mismatch/);
});

test("handoff reads only validated artifacts from its session workspace", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    const directory = await saveHandoff(workspace, handoff);
    assert.deepEqual(await readHandoff(workspace, ID), handoff);
    await assert.rejects(readHandoff(workspace, "../escape"), /Invalid Designer handoff ID/);
    await assert.rejects(readHandoff("", ID), /Designer session workspace is unavailable/);
    await assert.rejects(readHandoff(workspace, "other"), { code: "ENOENT" });

    const path = join(directory, "handoff.json");
    await writeFile(path, "{broken");
    await assert.rejects(readHandoff(workspace, ID), /Malformed Designer handoff/);
    await writeFile(path, JSON.stringify({ ...handoff, sourceFingerprint: "0".repeat(64) }));
    await assert.rejects(readHandoff(workspace, ID), /fingerprint mismatch/);
    await writeFile(path, "x".repeat(HANDOFF_LIMIT + 1));
    await assert.rejects(readHandoff(workspace, ID), /Invalid Designer handoff file/);

    const outside = await fixture(t);
    await saveHandoff(outside);
    await rm(directory, { recursive: true });
    try {
        await symlink(handoffDirectory(outside, ID), directory,
            process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; traversal assertion skipped");
        return;
    }
    await assert.rejects(readHandoff(workspace, ID), /Designer handoff escapes session artifacts/);
});

test("handoff rejects symlinked file without following it", async (t) => {
    const workspace = await fixture(t);
    const directory = await saveHandoff(workspace);
    const path = join(directory, "handoff.json");
    const target = join(workspace, "outside.json");
    await writeFile(target, JSON.stringify(validHandoff()));
    await rm(path);
    try {
        await symlink(target, path, "file");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; file assertion skipped");
        return;
    }
    await assert.rejects(readHandoff(workspace, ID), /Invalid Designer handoff file/);
});

test("handoff rejects a parent directory replaced during file open", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    const directory = await saveHandoff(workspace);
    await saveHandoff(outside);
    const backup = `${directory}-original`;
    let replaced = false;
    try {
        await assert.rejects(readHandoff(workspace, ID, async (path, flags) => {
            await rename(directory, backup);
            try {
                await symlink(handoffDirectory(outside, ID), directory,
                    process.platform === "win32" ? "junction" : "dir");
            } catch (error) {
                await rename(backup, directory);
                throw error;
            }
            replaced = true;
            return open(path, flags);
        }), /Designer handoff escapes session artifacts/);
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; race assertion skipped");
    } finally {
        if (replaced) {
            await rm(directory, { recursive: true });
            await rename(backup, directory);
        }
    }
});

test("handoff rejects a different opened file even if the path still passes validation", async (t) => {
    const workspace = await fixture(t);
    const outside = await fixture(t);
    await saveHandoff(workspace);
    const outsideDirectory = await saveHandoff(outside);
    await assert.rejects(
        readHandoff(workspace, ID, (_path, flags) => open(join(outsideDirectory, "handoff.json"), flags)),
        /Invalid Designer handoff file/,
    );
});

test("handoff rejects a FIFO promptly instead of waiting for a writer", {
    skip: process.platform === "win32",
}, async (t) => {
    const workspace = await fixture(t);
    const directory = handoffDirectory(workspace, ID);
    await mkdir(directory, { recursive: true });
    const fifo = join(directory, "handoff.json");
    const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr || created.error?.message);

    const script = `
        import { readHandoff } from ${JSON.stringify(new URL("../handoff.mjs", import.meta.url).href)};
        try {
            await readHandoff(process.argv[1], ${JSON.stringify(ID)});
            process.exitCode = 1;
        } catch (error) {
            if (!/Invalid Designer handoff file/.test(error.message)) {
                console.error(error);
                process.exitCode = 2;
            }
        }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, workspace],
        { timeout: 3000, encoding: "utf8" });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
});

test("shell renders counts without echoing handoff content and restricts HTTP access", async (t) => {
    const handoff = validHandoff();
    assert.match(shellHtml(handoff), /2 phases · 2 design customizations queued/);
    assert.doesNotMatch(shellHtml(handoff), /example\.com|starter|theme/);
    const shell = await startShell(handoff);
    t.after(() => shell.close());
    const url = new URL(shell.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.match(url.searchParams.get("token"), /^[a-f0-9]{48}$/);
    const good = await fetch(shell.url);
    assert.equal(good.status, 200);
    assert.match(good.headers.get("content-type"), /text\/html/);
    assert.equal(good.headers.get("cache-control"), "no-store");
    assert.equal(good.headers.get("x-content-type-options"), "nosniff");
    assert.match(await good.text(), /Canvas Designer/);
    for (const [address, options] of [
        [url.origin, undefined],
        [`${url.origin}/?token=wrong`, undefined],
        [`${url.origin}/other?token=${url.searchParams.get("token")}`, undefined],
        [shell.url, { method: "POST" }],
    ]) {
        assert.equal((await fetch(address, options)).status, 404);
    }
});

test("empty shell renders without a handoff and keeps the token gate", async (t) => {
    const html = shellHtml();
    assert.match(html, /No Wizard handoff is attached yet/);
    assert.doesNotMatch(html, /Wizard handoff received|customizations queued/);
    const shell = await startShell();
    t.after(() => shell.close());
    assert.match(await (await fetch(shell.url)).text(), /No Wizard handoff is attached yet/);
    const url = new URL(shell.url);
    assert.equal((await fetch(url.origin)).status, 404);
});

test("canvas opens empty without an ID, then opens a validated handoff", async (t) => {
    const workspace = await fixture(t);
    const source = fileURLToPath(new URL("../", import.meta.url));
    const extension = join(workspace, "provider");
    const sdk = join(extension, "node_modules", "@github", "copilot-sdk");
    await mkdir(sdk, { recursive: true });
    for (const file of ["extension.mjs", "handoff.mjs", "server.mjs"]) {
        await copyFile(join(source, file), join(extension, file));
    }
    await writeFile(join(sdk, "package.json"), JSON.stringify({
        name: "@github/copilot-sdk", type: "module", exports: { "./extension": "./extension.mjs" },
    }));
    await writeFile(join(sdk, "extension.mjs"), `
        export const createCanvas = (canvas) => canvas;
        export class CanvasError extends Error {
            constructor(code, message) { super(message); this.code = code; }
        }
        export const joinSession = async ({ canvases }) => {
            globalThis.__designerTestCanvas = canvases[0];
            return { workspacePath: ${JSON.stringify(workspace)} };
        };
    `);
    await import(pathToFileURL(join(extension, "extension.mjs")).href);
    const canvas = globalThis.__designerTestCanvas;
    delete globalThis.__designerTestCanvas;
    assert.deepEqual(canvas.inputSchema.required, undefined);
    assert.deepEqual(canvas.inputSchema.properties.handoffId.type, "string");

    try {
        const empty = await canvas.open({ instanceId: "same", input: {} });
        assert.match(await (await fetch(empty.url)).text(), /No Wizard handoff is attached yet/);
        assert.equal((await canvas.open({ instanceId: "same" })).url, empty.url);
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
            (error) => error.code === "designer_handoff_invalid");
        await saveHandoff(workspace);
        const filled = await canvas.open({ instanceId: "same", input: { handoffId: ID } });
        assert.notEqual(filled.url, empty.url);
        assert.match(await (await fetch(filled.url)).text(), /Wizard handoff received/);
        assert.equal((await canvas.open({ instanceId: "same", input: { handoffId: ID } })).url, filled.url);
    } finally {
        await canvas.onClose({ instanceId: "same" });
    }
});
