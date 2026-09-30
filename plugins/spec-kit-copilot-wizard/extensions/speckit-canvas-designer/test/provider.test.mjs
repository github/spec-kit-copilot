import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdtemp, mkdir, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    fingerprint, handoffDirectory, HANDOFF_LIMIT, readHandoff, validateHandoff,
    validateHandoffId,
} from "../handoff.mjs";
import { shellHtml, startShell } from "../server.mjs";
import { readDesignSource } from "../source.mjs";

const ID = "designer_1";
const requiredExtension = await readDesignSource();
const model = { pages: [{ id: "canvas-settings-setup", page: "setup", title: "Essentials", fields: [] }],
    constraints: {}, values: {}, revision: "initial" };

function validHandoff(id = ID) {
    const workflow = { selectedPhases: ["specify", "plan"] };
    const selections = {
        presets: [{ id: "theme", source: "copilot", approved: true,
            version: "1.2.3", downloadUrl: "https://example.com/theme" }],
        extensions: [{ id: "canvas-design", source: "copilot", approved: true,
            version: requiredExtension.version, downloadUrl: null }],
        bundles: [{ id: "starter", source: "default", approved: true,
            version: null, downloadUrl: null }],
    };
    return { schemaVersion: 2, handoffId: id, workflow, selections, requiredExtension,
        sourceFingerprint: fingerprint({ workflow, selections, requiredExtension }) };
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
        copy.sourceFingerprint = fingerprint({ workflow: copy.workflow, selections: copy.selections,
            requiredExtension: copy.requiredExtension });
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

test("prepared Designer serves pages without echoing handoff content and restricts HTTP access", async (t) => {
    const handoff = validHandoff();
    await assert.rejects(startShell(handoff), /pages must be resolved/);
    let reloads = 0;
    const shell = await startShell(handoff, model, {
        reload: async () => { reloads++; return { queued: true }; },
    });
    t.after(() => shell.close());
    const url = new URL(shell.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.match(url.searchParams.get("token"), /^[a-f0-9]{48}$/);
    const good = await fetch(shell.url);
    assert.equal(good.status, 200);
    assert.match(good.headers.get("content-type"), /text\/html/);
    assert.equal(good.headers.get("cache-control"), "no-store");
    assert.equal(good.headers.get("x-content-type-options"), "nosniff");
    const html = await good.text();
    assert.match(html, /Canvas Designer/);
    assert.doesNotMatch(html, /example\.com|starter/);
    const stateUrl = new URL(shell.url);
    stateUrl.pathname = "/api/state";
    assert.equal((await (await fetch(stateUrl)).json()).pages[0].title, "Essentials");
    for (const [address, options] of [
        [url.origin, undefined],
        [`${url.origin}/?token=wrong`, undefined],
        [`${url.origin}/other?token=${url.searchParams.get("token")}`, undefined],
        [shell.url, { method: "POST" }],
    ]) {
        assert.equal((await fetch(address, options)).status, 404);
    }
    stateUrl.pathname = "/api/reload";
    for (const headers of [{ origin: "https://example.com" }, { "sec-fetch-site": "cross-site" }]) {
        assert.equal((await fetch(stateUrl, { method: "POST", headers })).status, 403);
    }
    assert.equal(reloads, 0);
    assert.equal((await fetch(stateUrl, { method: "POST", headers: { origin: url.origin } })).status, 202);
    assert.equal(reloads, 1);
});

test("malformed raw request targets return 404 without stopping the shell", async (t) => {
    const shell = await startShell();
    t.after(() => shell.close());
    const url = new URL(shell.url);
    const status = await new Promise((resolve, reject) => {
        const req = request({ hostname: url.hostname, port: url.port, path: "//[" }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end();
    });
    assert.equal(status, 404);
    assert.equal((await fetch(shell.url)).status, 200);
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

test("canvas reloads session skills before opening valid pages and exposes an init reload tool", async (t) => {
    const workspace = await fixture(t);
    const checkout = await fixture(t);
    assert.notEqual(checkout, process.cwd());
    assert.notEqual(checkout, workspace);
    const source = fileURLToPath(new URL("../", import.meta.url));
    const extension = join(workspace, "provider");
    const sdk = join(extension, "node_modules", "@github", "copilot-sdk");
    await mkdir(sdk, { recursive: true });
    for (const file of ["extension.mjs", "handoff.mjs", "server.mjs", "source.mjs"]) {
        await copyFile(join(source, file), join(extension, file));
    }
    const sharedEnv = join(workspace, "speckit-wizard-canvas", "env");
    await mkdir(sharedEnv, { recursive: true });
    await copyFile(join(source, "..", "speckit-wizard-canvas", "env", "workspace.mjs"),
        join(sharedEnv, "workspace.mjs"));
    await cp(join(source, "ui"), join(extension, "ui"), { recursive: true });
    await writeFile(join(extension, "pages.mjs"), `
        export const PAGE_NAME = "^[a-z][a-z0-9-]{0,79}$";
        function checkProject(project) {
            if (project !== ${JSON.stringify(checkout)}) throw new Error("Wrong Designer checkout");
        }
        export async function assertPageCommand(project) {
            checkProject(project);
            if (globalThis.__designerTestCommandMissing) throw new Error("skill missing");
        }
        export async function storeDesignerPages(_handoff, _workspace, project, pages, isCurrent) {
            checkProject(project);
            if (!pages?.length) throw new Error("No resolved paths");
            if (!isCurrent()) throw new Error("Superseded");
            globalThis.__designerTestPagesValid = true;
            globalThis.__designerTestStores = (globalThis.__designerTestStores ?? 0) + 1;
            return ${JSON.stringify(model)};
        }
        export async function loadDesignerPages(_handoff, _workspace, project) {
            checkProject(project);
            if (!globalThis.__designerTestPagesValid) throw new Error("Registered pages are invalid");
            return ${JSON.stringify(model)};
        }
    `);
    await writeFile(join(sdk, "package.json"), JSON.stringify({
        name: "@github/copilot-sdk", type: "module", exports: { "./extension": "./extension.mjs" },
    }));
    await writeFile(join(sdk, "extension.mjs"), `
        export const createCanvas = (canvas) => canvas;
        export class CanvasError extends Error {
            constructor(code, message) { super(message); this.code = code; }
        }
        export const joinSession = async ({ canvases, tools }) => {
            globalThis.__designerTestCanvas = canvases[0];
            globalThis.__designerTestTools = tools;
            globalThis.__designerTestSession = {
                workspacePath: ${JSON.stringify(workspace)},
                send: async (message) => {
                    if (globalThis.__designerTestSendError) throw new Error("send failed");
                    globalThis.__designerTestSent.push(message);
                },
                log: async (message, options) => {
                    globalThis.__designerTestWarnings.push({ message, options });
                },
                rpc: { metadata: { snapshot: async () => {
                    if (globalThis.__designerTestMetadataError) throw new Error("metadata unavailable");
                    return globalThis.__designerTestMetadata;
                } }, skills: { reload: async () => {
                    globalThis.__designerTestReloads++;
                    if (globalThis.__designerTestReloadError) throw new Error("reload unavailable");
                    return globalThis.__designerTestDiagnostics;
                } } },
            };
            return globalThis.__designerTestSession;
        };
    `);
    await import(pathToFileURL(join(extension, "extension.mjs")).href);
    const canvas = globalThis.__designerTestCanvas;
    delete globalThis.__designerTestCanvas;
    assert.deepEqual(canvas.inputSchema.required, undefined);
    assert.deepEqual(canvas.inputSchema.properties.handoffId.type, "string");

    const [reloadTool, loadTool] = globalThis.__designerTestTools;
    assert.equal(reloadTool.name, "speckit_designer_reload_skills");
    assert.equal(reloadTool.parameters.additionalProperties, false);
    globalThis.__designerTestReloads = 0;
    globalThis.__designerTestWarnings = [];
    globalThis.__designerTestDiagnostics = { errors: [], warnings: [] };
    globalThis.__designerTestSent = [];
    try {
        const empty = await canvas.open({ instanceId: "same", input: {} });
        assert.match(await (await fetch(empty.url)).text(), /No Wizard handoff is attached yet/);
        assert.equal((await canvas.open({ instanceId: "same" })).url, empty.url);
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
            (error) => error.code === "designer_handoff_invalid");
        await saveHandoff(workspace);
        for (const metadata of [undefined, {}, { workingDirectory: "relative-checkout" }]) {
            globalThis.__designerTestMetadata = metadata;
            const failure = await loadTool.handler({ handoffId: ID,
                pages: [{ name: "canvas-settings-setup", path: "resolved.json" }] });
            assert.equal(failure.resultType, "failure");
            assert.match(failure.textResultForLlm, /checkout is unavailable in session metadata/);
            await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
                (error) => error.code === "designer_open_failed"
                    && /checkout is unavailable in session metadata/.test(error.message));
        }
        globalThis.__designerTestMetadataError = true;
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
            /checkout is unavailable in session metadata/);
        delete globalThis.__designerTestMetadataError;
        globalThis.__designerTestMetadata = { workingDirectory: checkout };
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
            (error) => error.code === "designer_open_failed");
        assert.equal(globalThis.__designerTestReloads, 0);
        assert.deepEqual(JSON.parse(await reloadTool.handler()), { errors: [], warnings: [] });
        assert.equal(globalThis.__designerTestReloads, 1);
        const loaded = await loadTool.handler({ handoffId: ID,
            pages: [{ name: "canvas-settings-setup", path: "resolved.json" }] });
        assert.equal(JSON.parse(loaded).loaded, true, "tool loads before a handoff-backed panel opens");
        globalThis.__designerTestDiagnostics = { errors: ["bad SKILL.md"], warnings: [] };
        await assert.rejects(reloadTool.handler(), /bad SKILL.md/);
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
            (error) => error.code === "designer_open_failed" && /bad SKILL.md/.test(error.message));
        assert.match(await (await fetch(empty.url)).text(), /No Wizard handoff is attached yet/);
        globalThis.__designerTestDiagnostics = undefined;
        await assert.rejects(reloadTool.handler(), /Invalid session skill reload diagnostics/);
        globalThis.__designerTestReloadError = true;
        await assert.rejects(reloadTool.handler(), /reload unavailable/);
        await assert.rejects(canvas.open({ instanceId: "same", input: { handoffId: ID } }),
            (error) => error.code === "designer_open_failed" && /reload unavailable/.test(error.message));
        delete globalThis.__designerTestReloadError;
        const rpc = globalThis.__designerTestSession.rpc;
        globalThis.__designerTestSession.rpc = {};
        await assert.rejects(reloadTool.handler(), /skill reload is unavailable/);
        globalThis.__designerTestSession.rpc = rpc;
        globalThis.__designerTestDiagnostics = { errors: [], warnings: ["skill warning"] };
        const reloads = globalThis.__designerTestReloads;
        const filled = await canvas.open({ instanceId: "same", input: { handoffId: ID } });
        assert.equal(globalThis.__designerTestReloads, reloads + 1);
        assert.deepEqual(globalThis.__designerTestWarnings,
            [{ message: "skill warning", options: { level: "warning" } }]);
        assert.notEqual(filled.url, empty.url);
        assert.match(await (await fetch(filled.url)).text(), /id="settings-page"/);
        assert.equal((await canvas.open({ instanceId: "same", input: { handoffId: ID } })).url, filled.url);
        const endpoint = new URL(filled.url);
        endpoint.pathname = "/api/reload";
        assert.equal((await fetch(endpoint, { method: "POST" })).status, 202);
        assert.equal((await fetch(endpoint, { method: "POST" })).status, 409);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(globalThis.__designerTestSent.length, 1);
        const prompt = globalThis.__designerTestSent[0].prompt;
        assert.match(prompt, /^\/speckit-canvas-design-load-page/);
        assert.match(prompt, /Invoke the skill tool/);
        const context = JSON.parse(prompt.match(/Context: (\{[^\n]+\})\./)[1]);
        assert.equal(context.handoffId, ID);
        const stale = await loadTool.handler({ handoffId: ID, requestId: randomUUID(),
            pages: [{ name: "canvas-settings-setup", path: "stale.json" }] });
        assert.equal(stale.resultType, "failure");
        const failure = await loadTool.handler({ ...context, error: "canvas-settings-extra: not found" });
        assert.equal(failure.resultType, "failure");
        assert.equal(failure.textResultForLlm, "canvas-settings-extra: not found");
        const state = new URL(filled.url);
        state.pathname = "/api/state";
        assert.equal((await (await fetch(state)).json()).load.pending, false);
        assert.equal((await (await fetch(state)).json()).pages[0].title, "Essentials");
        assert.equal((await fetch(endpoint, { method: "POST" })).status, 202);
        endpoint.searchParams.set("retry", "1");
        assert.equal((await fetch(endpoint, { method: "POST" })).status, 202);
        await new Promise((resolve) => setImmediate(resolve));
        const retryContext = JSON.parse(globalThis.__designerTestSent.at(-1).prompt.match(/Context: (\{[^\n]+\})\./)[1]);
        assert.equal(JSON.parse(await loadTool.handler({ ...retryContext,
            pages: [{ name: "canvas-settings-setup", path: "resolved.json" }] })).loaded, true);
        assert.equal((await (await fetch(state)).json()).load.pending, false);
        assert.equal((await loadTool.handler({ ...context, error: "late failure" })).resultType, "failure");
        assert.equal((await (await fetch(state)).json()).load.error, "");
        globalThis.__designerTestCommandMissing = true;
        assert.equal((await fetch(endpoint, { method: "POST" })).status, 409);
        delete globalThis.__designerTestCommandMissing;
        globalThis.__designerTestSendError = true;
        assert.equal((await fetch(endpoint, { method: "POST" })).status, 202);
        await new Promise((resolve) => setImmediate(resolve));
        assert.match((await (await fetch(state)).json()).load.error, /send failed/);
        await canvas.onClose({ instanceId: "same" });
        globalThis.__designerTestMetadata = { workspace: { cwd: checkout } };
        await import(`${pathToFileURL(join(extension, "extension.mjs")).href}?recovery`);
        const recovered = globalThis.__designerTestCanvas;
        try {
            const reopened = await recovered.open({ instanceId: "recovered", input: { handoffId: ID } });
            const recoveredState = new URL(reopened.url);
            recoveredState.pathname = "/api/state";
            assert.equal((await (await fetch(recoveredState)).json()).pages[0].title, "Essentials");
        } finally {
            await recovered.onClose({ instanceId: "recovered" });
        }
    } finally {
        await canvas.onClose({ instanceId: "same" });
        delete globalThis.__designerTestPagesValid;
        delete globalThis.__designerTestTools;
        delete globalThis.__designerTestSession;
        delete globalThis.__designerTestReloads;
        delete globalThis.__designerTestWarnings;
        delete globalThis.__designerTestDiagnostics;
        delete globalThis.__designerTestReloadError;
        delete globalThis.__designerTestSent;
        delete globalThis.__designerTestStores;
        delete globalThis.__designerTestSendError;
        delete globalThis.__designerTestCommandMissing;
        delete globalThis.__designerTestMetadata;
        delete globalThis.__designerTestMetadataError;
        delete globalThis.__designerTestCanvas;
    }
});
