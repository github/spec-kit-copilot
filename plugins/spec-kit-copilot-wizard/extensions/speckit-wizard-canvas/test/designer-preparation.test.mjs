import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateDesignerSetup } from "../../speckit-canvas-designer/validate-setup.mjs";
import { readDesignSource } from "../../speckit-canvas-designer/source.mjs";
import { buildDesignerHandoff } from "../server/handlers-designer.mjs";
import { fingerprint, validateHandoff } from "../../speckit-canvas-designer/handoff.mjs";
import { loadPreparedPages } from "../../speckit-canvas-designer/pages.mjs";
import { matchingInstalled, runSpecify } from "../../speckit-canvas-designer/specify.mjs";

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
        if (args[1] === "list" && args[2] === "--json") return JSON.stringify(inventory[`${args[0]}s`]);
        assert.fail(`Validation must not initialize or install: ${JSON.stringify(args)}`);
    };
    const initialize = async () => {
        await mkdir(join(checkout, ".specify"), { recursive: true });
        await writeFile(join(checkout, ".specify", "init-options.json"),
            JSON.stringify({ integration: "copilot", ai_skills: true }));
    };
    const installRequired = async () => {
        await cp(source.path, join(checkout, ".specify", "extensions", "canvas-design"), { recursive: true });
        inventory.extensions.push({ id: source.id, version: source.version, enabled: true });
    };
    const options = { handoffId: handoff.handoffId, checkoutPath: checkout,
        workspacePath: workspace, run, loadPages: async () => ({ pages: [{ page: "setup" }] }) };
    return { options, checkout, workspace, folder, handoff, inventory, commands, text,
        initialize, installRequired };
}

test("preflight validates an empty child without initializing, installing or loading pages", async (t) => {
    const f = await fixture(t);
    const result = await validateDesignerSetup({ ...f.options, mode: "preflight",
        loadPages: async () => assert.fail("preflight must not load pages") });
    assert.equal(result.status, "pending");
    assert.equal(result.initialized, false);
    assert.deepEqual(f.commands, [["--version"]]);
    assert.equal(JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8")).status, "pending");
    await assert.rejects(lstat(join(f.checkout, ".specify")), { code: "ENOENT" });
    await assert.rejects(lstat(join(f.checkout, ".github")), { code: "ENOENT" });
    await assert.rejects(validateDesignerSetup(f.options), /speckit-init skill/);
    await assert.rejects(lstat(join(f.checkout, ".specify")), { code: "ENOENT" });
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
});

test("preflight reports compatible existing setup and rejects conflicting inventory", async (t) => {
    const f = await fixture(t);
    await f.initialize();
    const result = await validateDesignerSetup({ ...f.options, mode: "preflight" });
    assert.equal(result.initialized, true);
    assert.deepEqual(result.installed, f.inventory);
    f.inventory.extensions.push({ id: "canvas-design", version: "9.0.0" });
    await assert.rejects(validateDesignerSetup({ ...f.options, mode: "preflight" }), /conflicts/);
});

test("verification accepts skill-installed packages and bundle-owned members without reinstalling", async (t) => {
    const theme = packageItem("theme"), extension = packageItem("extra"), bundle = packageItem("bundle");
    const f = await fixture(t, { presets: [theme], extensions: [required, extension], bundles: [bundle] });
    await f.initialize();
    await f.installRequired();
    f.inventory.bundles.push({ id: bundle.id, version: bundle.version });
    f.inventory.presets.push({ id: theme.id, version: theme.version, enabled: true });
    f.inventory.extensions.push({ id: extension.id, version: extension.version, enabled: true });
    const result = await validateDesignerSetup(f.options);
    assert.equal(result.status, "ready");
    assert.deepEqual(f.commands, [["--version"], ["preset", "list", "--json"],
        ["extension", "list", "--json"], ["bundle", "list", "--json"]]);
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
    assert.equal(JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8")).status, "ready");
    await assert.rejects(lstat(join(f.checkout, ".github", "extensions", "speckit-canvas-designer")),
        { code: "ENOENT" });
});

test("missing skill-installed selections preserve the handoff and record failure", async (t) => {
    const f = await fixture(t, { presets: [packageItem("broken")] });
    await f.initialize();
    await f.installRequired();
    await assert.rejects(validateDesignerSetup({ ...f.options,
        loadPages: async () => assert.fail("incomplete setup must not load pages") }), /presets broken is missing/);
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
    await assert.rejects(validateDesignerSetup({ ...f.options, mode: "preflight" }), /Copilot skills mode/);
    await assert.rejects(validateDesignerSetup(f.options), /Copilot skills mode/);
    assert.equal(f.commands.some((args) => args[0] === "init"), false);
    assert.equal(await readFile(optionsPath, "utf8"), '{"integration":"copilot","ai_skills":false}');
    await writeFile(optionsPath, '{"integration":"copilot","ai_skills":true}');
    await f.installRequired();
    await validateDesignerSetup(f.options);
    await assert.rejects(validateDesignerSetup({ ...f.options, loadPages: async () => {
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
    await assert.rejects(validateDesignerSetup({ ...f.options, mode: "preflight" }), /trusted package root/);
    await assert.rejects(validateDesignerSetup(f.options), /trusted package root/);
    assert.equal(f.commands.length, 0);
    assert.throws(() => matchingInstalled(required, [{ ...required, version: "9.0.0" }]), /conflicts/);
    assert.throws(() => matchingInstalled(required, [{ ...required, enabled: false }]), /disabled/);
    assert.throws(() => matchingInstalled(packageItem("theme"),
        [{ id: "theme", version: "1.0.0", source: { url: "https://example.org/different.zip" } }]), /source conflicts/);
});

test("missing bundles and extensions are never silently installed during verification", async (t) => {
    for (const kind of ["bundles", "extensions"]) {
        await t.test(kind, async (t) => {
            const item = packageItem("missing");
            const f = await fixture(t, { [kind]: kind === "extensions" ? [required, item] : [item] });
            await f.initialize();
            await f.installRequired();
            await assert.rejects(validateDesignerSetup(f.options), new RegExp(`${kind} missing is missing`));
            assert.equal(JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8")).status, "failed");
        });
    }
});

test("an unconfirmed required installation fails before page loading", async (t) => {
    const f = await fixture(t);
    await f.initialize();
    await assert.rejects(validateDesignerSetup({ ...f.options,
        loadPages: async () => assert.fail("page loading must not start") }), /extensions canvas-design is missing/);
    assert.equal(JSON.parse(await readFile(join(f.folder, "setup.json"), "utf8")).status, "failed");
});

test("preflight invalidates previous readiness and verification rejects changed required files", async (t) => {
    const f = await fixture(t);
    await f.initialize();
    await f.installRequired();
    await validateDesignerSetup(f.options);
    await validateDesignerSetup({ ...f.options, mode: "preflight" });
    await assert.rejects(loadPreparedPages(f.handoff, f.workspace, f.checkout), /preparation is incomplete/);
    await writeFile(join(f.checkout, ".specify", "extensions", "canvas-design", "pages", "setup.json"), "{}");
    await assert.rejects(validateDesignerSetup(f.options), /files do not match/);
});

test("real skill CLI commands initialize and install before validation and page resolution", {
    skip: !process.env.DESIGNER_CLI_TESTS,
}, async (t) => {
    const f = await fixture(t);
    const options = { handoffId: f.handoff.handoffId,
        checkoutPath: f.checkout, workspacePath: f.workspace };
    assert.equal((await validateDesignerSetup({ ...options, mode: "preflight" })).initialized, false);
    await runSpecify(["init", "--here", "--force", "--non-interactive", "--integration", "copilot",
        "--integration-options=--skills", "--script", process.platform === "win32" ? "ps" : "sh",
        "--ignore-agent-tools"], f.checkout);
    await runSpecify(["extension", "add", source.path, "--dev"], f.checkout);
    const result = await validateDesignerSetup(options);
    assert.equal(result.status, "ready");
    const model = await loadPreparedPages(f.handoff, f.workspace, f.checkout);
    assert.deepEqual(model.pages.map((page) => page.title),
        ["Essentials", "Artifacts", "Appearance", "Result Badges"]);
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
});
