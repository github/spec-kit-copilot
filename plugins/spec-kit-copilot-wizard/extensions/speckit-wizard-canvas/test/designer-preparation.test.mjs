import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bootstrapDesigner } from "../../speckit-canvas-designer/bootstrap.mjs";
import { readDesignSource } from "../../speckit-canvas-designer/source.mjs";
import { buildDesignerHandoff } from "../server/handlers-designer.mjs";
import { fingerprint, validateHandoff } from "../../speckit-canvas-designer/handoff.mjs";
import { loadPreparedPages } from "../../speckit-canvas-designer/pages.mjs";
import { installPackage, matchingInstalled } from "../../speckit-canvas-designer/install.mjs";

const source = await readDesignSource();
const required = { id: "canvas-design", source: "copilot", approved: true,
    version: source.version, downloadUrl: null };
const packageItem = (id) => ({ id, source: "copilot", approved: true,
    version: "1.0.0", downloadUrl: `https://example.org/${id}.zip` });

async function fixture(t, extra = {}) {
    const root = await mkdtemp(join(tmpdir(), "designer-preparation-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const checkout = join(root, "child");
    const workspace = join(root, "session-state", randomUUID());
    const selections = { presets: [], extensions: [required], bundles: [], ...extra };
    const handoff = buildDesignerHandoff({
        pipeline: [{ id: "plan" }],
        catalog: { designerSource: { available: true, extension: source } },
    }, selections);
    const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, ".git"), "gitdir: test");
    await mkdir(folder, { recursive: true });
    const text = JSON.stringify(handoff);
    await writeFile(join(folder, "handoff.json"), text);
    const inventory = { presets: [], extensions: [], bundles: [] };
    const commands = [];
    const run = async (args) => {
        commands.push(args);
        if (args[0] === "--version") return "specify 1.0.7";
        if (args[0] === "init") {
            await mkdir(join(checkout, ".specify"), { recursive: true });
            await writeFile(join(checkout, ".specify", "init-options.json"),
                JSON.stringify({ integration: "copilot", ai_skills: true }));
        }
        if (args[0] === "extension" && args[1] === "add") {
            await cp(source.path, join(checkout, ".specify", "extensions", "canvas-design"), { recursive: true });
            inventory.extensions.push({ id: source.id, version: source.version, enabled: true });
        }
        if (args[1] === "list") return JSON.stringify(inventory[`${args[0]}s`]);
        return "";
    };
    const options = { handoffId: handoff.handoffId, checkoutPath: checkout,
        workspacePath: workspace, run, loadPages: async () => ({ pages: [{ page: "setup" }] }) };
    return { options, checkout, workspace, folder, handoff, inventory, commands, text };
}

test("bundles install first and their already-satisfied standalone members are not reinstalled", async (t) => {
    const theme = packageItem("theme"), extension = packageItem("extra"), bundle = packageItem("bundle");
    const f = await fixture(t, { presets: [theme], extensions: [required, extension], bundles: [bundle] });
    const calls = [];
    await bootstrapDesigner({ ...f.options, addPackage: async (kind, item) => {
        calls.push([kind, item.id]);
        assert.equal(kind, "bundles");
        f.inventory.bundles.push({ id: bundle.id, version: bundle.version });
        f.inventory.presets.push({ id: theme.id, version: theme.version, enabled: true });
        f.inventory.extensions.push({ id: extension.id, version: extension.version, enabled: true });
    } });
    assert.deepEqual(calls, [["bundles", "bundle"]]);
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
    assert.equal(JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8")).status, "ready");
    await assert.rejects(lstat(join(f.checkout, ".github", "extensions", "speckit-canvas-designer")),
        { code: "ENOENT" });
});

test("install failure preserves the handoff and records failure without copying a provider", async (t) => {
    const f = await fixture(t, { presets: [packageItem("broken")] });
    await assert.rejects(bootstrapDesigner({ ...f.options, addPackage: async () => {
        throw new Error("download failed");
    } }), /download failed/);
    const setup = JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8"));
    assert.equal(setup.status, "failed");
    assert.equal(setup.installed.extensions[0].id, "canvas-design");
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
    await assert.rejects(lstat(join(f.checkout, ".github", "extensions", "speckit-canvas-designer")), { code: "ENOENT" });
});

test("existing incompatible setup is not force-initialized and broken page loading never reports ready", async (t) => {
    const f = await fixture(t);
    await mkdir(join(f.checkout, ".specify"));
    const optionsPath = join(f.checkout, ".specify", "init-options.json");
    await writeFile(optionsPath, '{"integration":"copilot","ai_skills":false}');
    await assert.rejects(bootstrapDesigner(f.options), /Copilot skills mode/);
    assert.equal(f.commands.some((args) => args[0] === "init"), false);
    assert.equal(await readFile(optionsPath, "utf8"), '{"integration":"copilot","ai_skills":false}');
    await writeFile(optionsPath, '{"integration":"copilot","ai_skills":true}');
    await assert.rejects(bootstrapDesigner({ ...f.options, loadPages: async () => {
        throw new Error("winning template is invalid");
    } }), /winning template is invalid/);
    assert.equal(JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8")).status, "failed");
});

test("handoff tampering and conflicting required versions or sources are rejected", async (t) => {
    const f = await fixture(t);
    const tampered = structuredClone(f.handoff);
    tampered.requiredExtension.path = join(f.checkout, "untrusted");
    assert.throws(() => validateHandoff(tampered, tampered.handoffId), /fingerprint mismatch/);
    tampered.sourceFingerprint = fingerprint({
        workflow: tampered.workflow, selections: tampered.selections, requiredExtension: tampered.requiredExtension,
    });
    await writeFile(join(f.folder, "handoff.json"), JSON.stringify(tampered));
    await assert.rejects(bootstrapDesigner(f.options), /trusted package root/);
    assert.equal(f.commands.length, 0);
    assert.throws(() => matchingInstalled(required, [{ ...required, version: "9.0.0" }]), /conflicts/);
    assert.throws(() => matchingInstalled(required, [{ ...required, enabled: false }]), /disabled/);
});

test("installer forwards exact URL arguments and rejects failed bundle downloads", async (t) => {
    const f = await fixture(t);
    await mkdir(join(f.checkout, ".specify"));
    const calls = [];
    await installPackage("presets", packageItem("theme"), f.checkout, async (args) => { calls.push(args); });
    assert.deepEqual(calls, [["preset", "add", "theme", "--from", "https://example.org/theme.zip"]]);
    await assert.rejects(installPackage("bundles", packageItem("bundle"), f.checkout,
        async () => { assert.fail("must not install after download failure"); },
        async () => ({ ok: false, status: 503 })), /download failed/);
});

test("an unconfirmed required installation fails before optional packages or page loading", async (t) => {
    const f = await fixture(t, { presets: [packageItem("theme")] });
    await assert.rejects(bootstrapDesigner({ ...f.options, run: async (args, cwd) => {
        if (args[0] === "extension" && args[1] === "add") return "";
        return f.options.run(args, cwd);
    }, addPackage: async () => assert.fail("optional installation must not start"),
    loadPages: async () => assert.fail("page loading must not start") }), /did not confirm the required/);
    assert.equal(JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8")).status, "failed");
});

test("real Specify prepares a child and the provider re-resolves its registered pages", {
    skip: !process.env.DESIGNER_CLI_TESTS,
}, async (t) => {
    const f = await fixture(t);
    const result = await bootstrapDesigner({ handoffId: f.handoff.handoffId,
        checkoutPath: f.checkout, workspacePath: f.workspace });
    assert.equal(result.status, "ready");
    const model = await loadPreparedPages(f.handoff, f.workspace, f.checkout);
    assert.deepEqual(model.pages.map((page) => page.title),
        ["Essentials", "Artifacts", "Appearance", "Result Badges"]);
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
});
