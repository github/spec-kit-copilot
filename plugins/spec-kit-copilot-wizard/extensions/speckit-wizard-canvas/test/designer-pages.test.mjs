import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { buildDesignerHandoff } from "../server/handlers-designer.mjs";
import { loadDesignerPages } from "../../speckit-canvas-designer/pages.mjs";
import { readDesignSource } from "../../speckit-canvas-designer/source.mjs";

const runFile = promisify(execFile);
const source = await readDesignSource();
const required = { id: "canvas-design", source: "copilot", approved: true,
    version: source.version, downloadUrl: null };

async function fixture(t, extra = {}) {
    const root = await mkdtemp(join(tmpdir(), "designer-pages-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const checkout = join(root, "child");
    const workspace = join(root, "session-state", randomUUID());
    const handoff = buildDesignerHandoff({
        pipeline: [{ id: "plan" }],
        catalog: { designerSource: { available: true, extension: source } },
    }, { presets: [], extensions: [required], bundles: [], ...extra });
    const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
    await mkdir(checkout, { recursive: true });
    await mkdir(folder, { recursive: true });
    const text = JSON.stringify(handoff);
    await writeFile(join(folder, "handoff.json"), text);
    return { checkout, folder, handoff, text };
}

test("page loading needs no setup receipt and leaves package verification to the agent", async (t) => {
    const f = await fixture(t, { presets: [{
        id: "theme", source: "copilot", approved: true, version: "1.0.0",
        downloadUrl: "https://example.org/theme.zip",
    }] });
    const model = { pages: [{ title: "Essentials" }], constraints: {}, values: {} };
    const calls = [];
    const load = async (...args) => { calls.push(args); return model; };
    assert.equal(await loadDesignerPages(f.handoff, f.checkout, load), model);
    assert.deepEqual(calls, [[join(source.path, "scripts", "python", "pages.py"), f.checkout, source.path]]);
    await assert.rejects(lstat(join(f.folder, "setup.json")), { code: "ENOENT" });
    await assert.rejects(lstat(join(f.checkout, ".specify")), { code: "ENOENT" });
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);

    // An old setup receipt is no longer a readiness gate.
    const stale = '{"status":"failed","error":"old setup checker"}';
    await writeFile(join(f.folder, "setup.json"), stale);
    assert.equal(await loadDesignerPages(f.handoff, f.checkout, load), model);
    assert.equal(await readFile(join(f.folder, "setup.json"), "utf8"), stale);
});

test("handoff source changes are rejected before executing a page loader", async (t) => {
    const f = await fixture(t);
    for (const change of [{ path: f.checkout }, { fingerprint: "0".repeat(64) }]) {
        const handoff = { ...f.handoff, requiredExtension: { ...source, ...change } };
        await assert.rejects(loadDesignerPages(handoff, f.checkout,
            async () => assert.fail("must not execute an untrusted page loader")), /Canvas Design source changed/);
    }
});

test("page resolution errors propagate without writing setup status", async (t) => {
    const f = await fixture(t);
    await assert.rejects(loadDesignerPages(f.handoff, f.checkout, async () => {
        throw new Error("winning template is invalid");
    }), /winning template is invalid/);
    await assert.rejects(lstat(join(f.folder, "setup.json")), { code: "ENOENT" });
});

test("real skill CLI commands install pages that resolve directly without a readiness receipt", {
    skip: !process.env.DESIGNER_CLI_TESTS,
}, async (t) => {
    const f = await fixture(t);
    const run = (args) => runFile("specify", args, {
        cwd: f.checkout, env: { ...process.env, PYTHONUTF8: "1" },
        timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    await run(["init", "--here", "--force", "--non-interactive", "--integration", "copilot",
        "--integration-options=--skills", "--script", process.platform === "win32" ? "ps" : "sh",
        "--ignore-agent-tools"]);
    await assert.rejects(loadDesignerPages(f.handoff, f.checkout), /Missing or excessive registered Designer pages/);
    await run(["extension", "add", source.path, "--dev"]);
    const model = await loadDesignerPages(f.handoff, f.checkout);
    assert.deepEqual(model.pages.map((page) => page.title),
        ["Essentials", "Artifacts", "Appearance", "Result Badges"]);
    await assert.rejects(lstat(join(f.folder, "setup.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);

    const overrides = join(f.checkout, ".specify", "templates", "overrides");
    await mkdir(overrides, { recursive: true });
    const page = JSON.parse(await readFile(join(source.path, "pages", "setup.json"), "utf8"));
    page.title = "Project essentials";
    const override = join(overrides, "canvas-settings-setup.md");
    await writeFile(override, JSON.stringify(page));
    assert.equal((await loadDesignerPages(f.handoff, f.checkout)).pages[0].title, page.title);
    await writeFile(override, "{invalid");
    await assert.rejects(loadDesignerPages(f.handoff, f.checkout), /Designer page loading failed/);
});
