import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    resolveGeneratedTarget, validateGeneratedProvider, validateGeneratedCanvas, validateGeneratedOpen,
} from "../extension-canvas-design/scripts/validate-generated-open.mjs";

const checkout = resolve("generated-registration-fixture");
const canvasId = "my-workflow";
const requestId = "abc123";
const extensionId = `project:${canvasId}`;
const entry = join(checkout, ".github", "extensions", canvasId, "extension.mjs");
const listEntry = (id = extensionId, source = "project", path = entry) =>
    `• **my-workflow** — running\n  ID: ${id}\n  Source: ${source}\n  Path: ${path}\n  PID: 123\n`;
const list = `Discovered extensions (2):\n\n${listEntry()}\n${listEntry("user:other", "user", entry)}`;
const inspect = (id = extensionId, source = "project", path = entry, status = "running") =>
    `Extension: **my-workflow**\nID: ${id}\nSource: ${source}\nPath: ${path}\nStatus: ${status}\n`;
const args = [checkout, canvasId, requestId];
const capabilities = { canvasId, extensionId, actions: [] };
const opened = { canvasId, extensionId, instanceId: `generated-${requestId}`, url: "http://127.0.0.1/" };
const script = fileURLToPath(new URL("../extension-canvas-design/scripts/validate-generated-open.mjs",
    import.meta.url));

function invoke(stage, input) {
    return spawnSync(process.execPath, [script, stage, ...args], {
        encoding: "utf8", input: JSON.stringify(input),
    });
}

test("open-generated command validates existing provenance before reload and exact identity before open", async () => {
    const command = await readFile(new URL("../extension-canvas-design/commands/open-generated.md",
        import.meta.url), "utf8");
    for (const required of [
        "$ARGUMENTS", "handoffId", "requestId", "request.json", "settings-provenance.json",
        "sourceFingerprint", "canvas-config.json", "extensions_reload", "extensions_manage",
        "validate-generated-open.mjs", "list_canvas_capabilities", "open_canvas",
        "generated-<requestId>", "after reset/clear", "exact error",
    ]) assert.ok(command.includes(required), required);
    assert.match(command, /Require one\s+unique matching directory/);
    assert.match(command, /A present but invalid request is\s+an error/);
    assert.match(command, /in `target` mode/);
    assert.match(command, /Do not read or scan the\s+metadata yourself/);
    assert.match(command, /Do not fill in a\s+missing result ID/);
    assert.match(command, /do not\s+regenerate/i);
    assert.ok(command.includes("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"));
    assert.ok(command.indexOf("settings-provenance.json") < command.indexOf("Call `extensions_reload`"));
    assert.ok(command.indexOf("Call `extensions_reload`") < command.indexOf("Call `extensions_manage`"));
    assert.ok(command.indexOf("provider` mode") < command.indexOf("list_canvas_capabilities"));
    assert.ok(command.indexOf("canvas` mode") < command.indexOf("Call `open_canvas`"));
    assert.ok(command.indexOf("Call `open_canvas`") < command.indexOf("open` mode"));
});

test("generated target discovery validates the frozen request and unique reset fallback", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "generated-open-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, "checkout");
    const workspace = join(root, "session");
    const parent = join(project, ".github", "extensions");
    const canvas = join(parent, canvasId);
    const fingerprint = "a".repeat(64);
    const provenance = { handoffId: "handoff-1", requestId, sourceFingerprint: fingerprint };
    await mkdir(canvas, { recursive: true });
    await mkdir(workspace);
    await writeFile(join(canvas, "settings-provenance.json"), JSON.stringify(provenance));
    await writeFile(join(canvas, "canvas-config.json"), JSON.stringify({ canvas: { id: canvasId } }));
    await writeFile(join(canvas, "extension.mjs"), "export {};");
    const expectedTarget = { canvasId, target: `.github/extensions/${canvasId}/`, requestId };
    assert.deepEqual(await resolveGeneratedTarget(project, workspace, "handoff-1", requestId), expectedTarget);
    const cli = spawnSync(process.execPath, [script, "target", project, workspace, "handoff-1", requestId],
        { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), expectedTarget);

    const requestDir = join(workspace, "speckit-canvas-designer", "handoffs",
        "handoff-1", "generations", requestId);
    await mkdir(requestDir, { recursive: true });
    const payload = { handoffId: "handoff-1", requestId, project,
        target: expectedTarget.target, values: { "canvas.id": canvasId },
        sourceFingerprint: fingerprint };
    const request = { ...payload,
        integrity: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
    await writeFile(join(requestDir, "request.json"), JSON.stringify(request));
    assert.deepEqual(await resolveGeneratedTarget(project, workspace, "handoff-1", requestId), expectedTarget);
    const changedFingerprint = { ...payload, sourceFingerprint: "c".repeat(64) };
    await writeFile(join(requestDir, "request.json"), JSON.stringify({
        ...changedFingerprint,
        integrity: createHash("sha256").update(JSON.stringify(changedFingerprint)).digest("hex"),
    }));
    await assert.rejects(resolveGeneratedTarget(project, workspace, "handoff-1", requestId),
        /provenance does not match/);
    await writeFile(join(requestDir, "request.json"), JSON.stringify({ ...request, target: "other" }));
    await assert.rejects(resolveGeneratedTarget(project, workspace, "handoff-1", requestId),
        /integrity mismatch/);
    await writeFile(join(requestDir, "request.json"), JSON.stringify({ ...request, integrity: "0".repeat(64) }));
    await assert.rejects(resolveGeneratedTarget(project, workspace, "handoff-1", requestId),
        /integrity mismatch/);
    await rm(join(requestDir, "request.json"));
    try {
        await symlink(join(workspace, "missing-request.json"), join(requestDir, "request.json"), "file");
        await assert.rejects(resolveGeneratedTarget(project, workspace, "handoff-1", requestId));
        await rm(join(requestDir, "request.json"));
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; request assertion skipped");
    }
    const other = join(parent, "other-canvas");
    await mkdir(other);
    await writeFile(join(other, "settings-provenance.json"), JSON.stringify(provenance));
    await writeFile(join(other, "canvas-config.json"), JSON.stringify({ canvas: { id: "other-canvas" } }));
    await writeFile(join(other, "extension.mjs"), "export {};");
    await assert.rejects(resolveGeneratedTarget(project, workspace, "handoff-1", requestId),
        /expected one matching generated canvas, found 2/);
});

test("generated target discovery rejects unsafe provenance, malformed metadata and foreign targets", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "generated-open-unsafe-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, "checkout");
    const workspace = join(root, "session");
    const canvas = join(project, ".github", "extensions", canvasId);
    const provenanceFile = join(canvas, "settings-provenance.json");
    const provenance = { handoffId: "handoff-1", requestId, sourceFingerprint: "b".repeat(64) };
    await mkdir(canvas, { recursive: true });
    await mkdir(workspace);
    await writeFile(join(canvas, "canvas-config.json"), JSON.stringify({ canvas: { id: canvasId } }));
    await writeFile(join(canvas, "extension.mjs"), "export {};");
    const resolveTarget = () => resolveGeneratedTarget(project, workspace, "handoff-1", requestId);
    await writeFile(provenanceFile, JSON.stringify({ handoffId: "handoff-1", requestId }));
    await assert.rejects(resolveTarget(), /invalid generated provenance/);
    await writeFile(provenanceFile, JSON.stringify({ ...provenance, requestId: 123 }));
    await assert.rejects(resolveTarget(), /invalid generated provenance/);
    await writeFile(provenanceFile, "x".repeat(1024 * 1024 + 1));
    await assert.rejects(resolveTarget(), /too large/);
    await writeFile(provenanceFile, JSON.stringify(provenance));
    await writeFile(join(canvas, "canvas-config.json"), JSON.stringify({ canvas: { id: "other-canvas" } }));
    await assert.rejects(resolveTarget(), /canvas configuration does not match/);
    await writeFile(join(canvas, "canvas-config.json"), JSON.stringify({ canvas: { id: canvasId } }));
    assert.deepEqual((await resolveTarget()).canvasId, canvasId);
    await rm(provenanceFile);
    try {
        await symlink(join(canvas, "canvas-config.json"), provenanceFile, "file");
        await assert.rejects(resolveTarget(), /bounded regular session file/);
        await rm(provenanceFile);
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; metadata assertion skipped");
    }
    const parent = join(project, ".github", "extensions");
    const backup = join(project, ".github", "original-extensions");
    await rename(parent, backup);
    try {
        await symlink(backup, parent, process.platform === "win32" ? "junction" : "dir");
        await assert.rejects(resolveTarget(), /unsafe directory/);
        await rm(parent);
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; parent assertion skipped");
    } finally {
        await rename(backup, parent);
    }
});

test("generated registration validator accepts the project provider, its canvas and opened instance", () => {
    const wanted = { canvasId, extensionId, instanceId: `generated-${requestId}`, entry: resolve(entry) };
    assert.deepEqual(validateGeneratedProvider(list, inspect(), ...args), wanted);
    assert.deepEqual(validateGeneratedCanvas(capabilities, ...args), wanted);
    assert.deepEqual(validateGeneratedOpen(opened, ...args), wanted);
    for (const [stage, input] of [
        ["provider", { list, inspect: inspect() }],
        ["canvas", { capabilities }],
        ["open", { opened }],
    ]) {
        const response = invoke(stage, input);
        assert.equal(response.status, 0, response.stderr);
        assert.deepEqual(JSON.parse(response.stdout), wanted);
    }
    assert.equal(validateGeneratedOpen({ ...opened, instanceId: "generated-request_2" },
        checkout, canvasId, "request_2").instanceId, "generated-request_2");
    assert.equal(validateGeneratedProvider(list, inspect(), checkout, canvasId, "request_2").instanceId,
        "generated-request_2");
});

test("generated registration rejects missing, duplicate, user-owned, wrong-path and failed providers", () => {
    for (const [registered, details] of [
        [listEntry("user:my-workflow", "user"), inspect()],
        [list + listEntry(), inspect()],
        [listEntry(extensionId, "user"), inspect()],
        [listEntry(extensionId, "project", join(checkout, "other", "extension.mjs")), inspect()],
        [list, inspect("user:my-workflow")],
        [list, inspect(extensionId, "user")],
        [list, inspect(extensionId, "project", join(checkout, "other", "extension.mjs"))],
        [list, inspect(extensionId, "project", entry, "failed")],
    ]) {
        assert.throws(() => validateGeneratedProvider(registered, details, ...args),
            /Generated canvas registration:/);
        const response = invoke("provider", { list: registered, inspect: details });
        assert.notEqual(response.status, 0);
        assert.match(response.stderr, /Generated canvas registration:/);
    }
});

test("generated registration rejects incompatible or unidentifiable canvas and open results", () => {
    for (const result of [
        { ...capabilities, extensionId: "user:my-workflow" },
        { ...capabilities, canvasId: "another-canvas" },
        { canvasId, actions: [] },
        { extensionId, actions: [] },
        null,
    ]) {
        assert.throws(() => validateGeneratedCanvas(result, ...args), /Generated canvas registration:/);
        assert.notEqual(invoke("canvas", { capabilities: result }).status, 0);
    }
    for (const result of [
        { ...opened, instanceId: "generated-other" },
        { ...opened, extensionId: "plugin:other:my-workflow" },
        { ...opened, canvasId: "another-canvas" },
        { canvasId, extensionId },
    ]) {
        assert.throws(() => validateGeneratedOpen(result, ...args), /Generated canvas registration:/);
        assert.notEqual(invoke("open", { opened: result }).status, 0);
    }
});

test("generated registration fails closed on malformed tool input and invalid expectations", () => {
    assert.notEqual(spawnSync(process.execPath, [script, "provider", ...args], {
        encoding: "utf8", input: "{not-json",
    }).status, 0);
    assert.notEqual(invoke("unrecognized", { list, inspect: inspect() }).status, 0);
    assert.throws(() => validateGeneratedProvider(list, inspect(), checkout, "../other", requestId),
        /invalid checkout, canvas ID or request ID/);
    for (const invalid of ["con", "lpt1", "speckit-wizard", "a".repeat(101)]) {
        assert.throws(() => validateGeneratedProvider(list, inspect(), checkout, invalid, requestId),
            /invalid checkout, canvas ID or request ID/);
    }
    const maxId = "a".repeat(100);
    assert.equal(validateGeneratedCanvas({ canvasId: maxId, extensionId: `project:${maxId}` },
        checkout, maxId, requestId).canvasId, maxId);
    assert.notEqual(spawnSync(process.execPath, [script, "canvas", checkout, "con", requestId], {
        encoding: "utf8", input: JSON.stringify({ capabilities }),
    }).status, 0);
    assert.throws(() => validateGeneratedProvider(list, inspect(), checkout, canvasId, "../other"),
        /invalid checkout, canvas ID or request ID/);
    assert.throws(() => validateGeneratedProvider(list, inspect(), checkout, canvasId, "a".repeat(129)),
        /invalid checkout, canvas ID or request ID/);
});
