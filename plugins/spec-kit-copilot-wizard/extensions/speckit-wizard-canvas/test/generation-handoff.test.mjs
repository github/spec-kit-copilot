import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { handleGenerate, prepareWizardGeneration } from "../server/handlers-ops.mjs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { createHandler } from "../server.mjs";
import { createClient } from "../ui/client.js";

function response() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.body = "";
    res.setHeader = () => {};
    res.writeHead = (status) => { res.statusCode = status; };
    res.end = (body) => { res.body = String(body ?? ""); };
    return res;
}

const snapshot = {
    pipeline: [{ id: "plan" }, { id: "speckit.assess.intake" }],
};
const body = {
    phases: ["speckit.plan", "speckit.assess.intake"],
    canvasId: "my-canvas",
    displayName: "My Canvas",
};

test("Generate request surfaces preparation errors instead of reporting a queue", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: false, status: 422,
        text: async () => '{"error":"generation preparation failed: undeclared preset command"}',
    });
    try {
        const errors = [];
        const client = createClient({ token: "test", onError: (_path, error) => errors.push(error) });
        await assert.rejects(
            client.postJson("/api/generation", body, { throwOnError: true }),
            /422.*undeclared preset command/,
        );
        assert.equal(errors.length, 1);
        assert.equal(await client.postJson("/api/other", body), undefined);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("Wizard hands confirmed phase order to shared preparation, then dispatches the generated skill", async () => {
    const res = response();
    const calls = [];
    const instance = { workspacePath: "C:\\work" };
    await handleGenerate(res, body, {
        getState: async () => snapshot,
        getInstance: () => instance,
        prepare: async (...args) => {
            calls.push(args);
            return "C:\\work\\.specify\\.cache\\canvas-generation\\run\\request.json";
        },
        dispatch: ({ prompt }) => { calls.push(prompt); },
        broadcast: () => {},
    });
    assert.equal(res.statusCode, 202);
    assert.deepEqual(calls[0].slice(1, 5), [
        body.phases, body.canvasId, body.displayName, false,
    ]);
    assert.match(calls[1], /speckit-pipeline-canvas-generator-generate/);
    assert.match(calls[1], /request\.json/);
    assert.equal(instance.generation.requestPath, calls[0][0] + "\\.specify\\.cache\\canvas-generation\\run\\request.json");
});

test("Wizard passes dialog settings to the generator request without changing phase order", async () => {
    const res = response();
    const settings = { requireInstallationApproval: true };
    let prepared;
    await handleGenerate(res, { ...body, settings }, {
        getState: async () => snapshot,
        getInstance: () => ({ workspacePath: "C:\\work" }),
        prepare: async (...args) => {
            prepared = args;
            return "C:\\work\\.specify\\.cache\\canvas-generation\\run\\request.json";
        },
        dispatch: () => {},
    });
    assert.equal(res.statusCode, 202);
    assert.deepEqual(prepared[1], body.phases);
    assert.deepEqual(prepared[6], settings);
});

test("Wizard rejects stale or unconfirmed phases without writing a request", async () => {
    const res = response();
    let prepared = false;
    await handleGenerate(res, { ...body, phases: [...body.phases].reverse() }, {
        getState: async () => snapshot,
        getInstance: () => ({ workspacePath: "C:\\work" }),
        prepare: async () => { prepared = true; },
        dispatch: () => { throw Error("must not dispatch"); },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(prepared, false);
});

test("Wizard requires exact-target confirmation for existing and partial canvases", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wizard-regenerate-"));
    const target = join(workspace, ".github", "extensions", "my-canvas");
    await mkdir(target, { recursive: true });
    try {
        const calls = [];
        const instance = { workspacePath: workspace };
        const deps = {
            getState: async () => snapshot,
            getInstance: () => instance,
            prepare: async (...args) => {
                calls.push(args);
                return join(workspace, ".specify", ".cache", "run", "request.json");
            },
            dispatch: ({ prompt }) => { calls.push(prompt); },
        };
        for (const provided of [body, { ...body, overwrite: true, confirmedTarget: target + "-other" }]) {
            const res = response();
            await handleGenerate(res, provided, deps);
            assert.equal(res.statusCode, 409);
        }
        assert.equal(calls.length, 0);
        const res = response();
        await handleGenerate(res, { ...body, overwrite: true, confirmedTarget: target }, deps);
        assert.equal(res.statusCode, 202);
        assert.equal(calls[0][4], true);
        assert.match(calls[1], /including manual edits/);
    } finally {
        await rm(workspace, { recursive: true, force: true });
    }
});

test("Wizard captures Specify JSON and prepares the same request with installed generator", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wizard-generate-"));
    try {
        const initialized = spawnSync("specify", [
            "init", "--here", "--force", "--integration", "copilot",
            "--integration-options=--skills", "--script", "py", "--ignore-agent-tools",
        ], { cwd: workspace, encoding: "utf8", shell: process.platform === "win32" });
        assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
        const packagePath = resolve(fileURLToPath(new URL("../../../../..", import.meta.url)),
            "spec-kit-extensions", "pipeline-canvas-generator");
        const installed = spawnSync("specify", ["extension", "add", packagePath, "--dev", "--priority", "100"], {
            cwd: workspace, encoding: "utf8", shell: process.platform === "win32",
        });
        assert.equal(installed.status, 0, installed.stderr || installed.stdout);
        const path = await prepareWizardGeneration(workspace, ["speckit.plan"], "wizard-test", "Wizard Test");
        const request = JSON.parse(await readFile(path, "utf8"));
        assert.deepEqual(request.workflow.selectedPhases, ["speckit.plan"]);
        assert.equal(request.canvas.id, "wizard-test");
        assert.equal(request.overwrite, false);
        const script = join(workspace, ".specify", "extensions", "pipeline-canvas-generator",
            "scripts", "python", "canvas_generate.py");
        const cli = spawnSync("python", [script, "prepare-request", "--workspace", workspace,
            "--canvas-id", "wizard-test", "--display-name", "Wizard Test", "--phase", "speckit.plan",
        ], { cwd: workspace, encoding: "utf8" });
        assert.equal(cli.status, 0, cli.stderr || cli.stdout);
        const cliRequest = JSON.parse(await readFile(JSON.parse(cli.stdout).requestPath, "utf8"));
        assert.deepEqual(cliRequest, request, "Wizard and standalone entries must capture identical authority");
        const settings = { requireInstallationApproval: true };
        const configured = await prepareWizardGeneration(
            workspace, ["speckit.plan"], "wizard-settings-test", "Wizard Settings Test",
            false, null, settings,
        );
        const configuredRequest = JSON.parse(await readFile(configured, "utf8"));
        assert.deepEqual(configuredRequest.settings, settings);
    } finally {
        await rm(workspace, { recursive: true, force: true });
    }
});

test("Wizard reports a pending request until the authoritative result exists", async () => {
    const generation = {
        status: "queued",
        requestPath: "C:\\work\\.specify\\.cache\\canvas-generation\\run\\request.json",
        target: ".github/extensions/my-canvas",
    };
    const inst = { generation, workspacePath: "C:\\work" };
    let result = null;
    const handler = createHandler({
        token: "secret",
        getInstance: () => inst,
        getState: async () => snapshot,
        fs: {
            readFile: async () => {
                if (!result) throw Object.assign(new Error("not yet"), { code: "ENOENT" });
                return JSON.stringify(result);
            },
        },
    });
    const fetchResult = async () => {
        const req = Readable.from([]);
        req.method = "GET";
        req.url = "/api/generation/result?token=secret";
        req.headers = {};
        const res = response();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        return JSON.parse(res.body);
    };
    assert.equal((await fetchResult()).status, "queued");
    result = {
        schemaVersion: 1, status: "succeeded",
        target: resolve(inst.workspacePath, generation.target),
    };
    assert.equal((await fetchResult()).status, "succeeded");
});
