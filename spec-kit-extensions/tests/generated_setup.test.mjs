import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createSetup, validateRuntimeSetup } from "../extension-canvas-design/generated-scaffold/setup.mjs";
import { createRuntime } from "../extension-canvas-design/generated-scaffold/runtime.mjs";
import { createWorkflowRoutes } from "../extension-canvas-design/generated-scaffold/server.mjs";
import { createServer } from "node:http";
import { validatePhaseState } from "../extension-canvas-design/generated-scaffold/contracts/external-host-adapter.mjs";

const phase = { skill: "speckit-specify" };
const preset = { id: "real-preset", version: "1.0.0", enabled: true, priority: 12,
    locator: { installedId: "real-preset", catalogId: "catalog-preset",
        source: "copilot", downloadUrl: "https://example.org/preset.zip" } };
const extension = { id: "extension-one", version: "3.0.0", enabled: true, priority: 0,
    locator: { installedId: "extension-one", catalogId: "extension-one",
        source: "default", downloadUrl: null } };
const recipe = { presets: [preset], bundles: [], extensions: [extension] };

function harness(t, { init = false, installed = false, skill = false, configured = true,
    empty = false, urlLocal = false, clock = () => Date.now(), runtimeRecipe = recipe,
    inventory = {}, phases = [phase] } = {}) {
    const root = mkdtemp(join(process.cwd(), ".generated-setup-test-"));
    t.after(async () => rm(await root, { recursive: true, force: true }));
    const calls = [], sent = [], events = [], approved = [];
    let installedNow = installed, cliNow = init, reloads = 0;
    let beforeCommand = async () => {};
    const session = { send: async ({ prompt }) => { sent.push(prompt); return `message-${sent.length}`; },
        getEvents: async () => events, rpc: { skills: { reload: async () => { reloads++; return { errors: [] }; } } } };
    const command = async (exe, args, options) => {
        calls.push({ exe, args, options });
        await beforeCommand(args);
        if (args[0] === "--version") {
            if (!cliNow) throw Object.assign(new Error("Missing"), { code: "ENOENT" });
            return { stdout: "specify 1.0.7\n" };
        }
        const entries = {
            extension: inventory.extension ?? [{ id: "extension-one", version: "3.0.0", priority: 0,
                enabled: true, source: { kind: "catalog", catalog: "default" } }],
            preset: inventory.preset ?? [{ id: "real-preset", version: "1.0.0", priority: 12,
                enabled: true, source: urlLocal ? { kind: "local" }
                    : { kind: "catalog", catalog: "copilot" } }],
        };
        return { stdout: JSON.stringify(installedNow ? entries[args[0]] : []) };
    };
    const ready = async () => {
        const cwd = await root;
        await mkdir(join(cwd, ".specify"), { recursive: true });
        await mkdir(join(cwd, ".github", "skills", phase.skill), { recursive: true });
        await writeFile(join(cwd, ".github", "skills", phase.skill, "SKILL.md"), `---\nname: ${phase.skill}\n---\n`);
        cliNow = true;
    };
    const complete = (index) => {
        const interactionId = `interaction-${index}`;
        events.push({ type: "user.message", data: { messageId: `message-${index}`, interactionId } },
            { type: "assistant.turn_start", data: { interactionId, turnId: `turn-${index}` } },
            { type: "assistant.message", data: { interactionId, turnId: `turn-${index}`,
                content: "Done.", phase: "final" } },
            { type: "assistant.turn_end", data: { interactionId, turnId: `turn-${index}` } });
    };
    const setup = async () => {
        const cwd = await root;
        if (init) await ready();
        if (skill && !init) await ready();
        return createSetup({ config: { runtimeSetup: configured
            ? empty ? { bundles: [], extensions: [], presets: [] } : runtimeRecipe
            : undefined }, cwd,
            session, phases, command, now: clock, approvedSources: () => approved,
            saveApprovedSources: async (receipts) => { approved.push(...receipts); } });
    };
    return { setup, ready, complete, calls, sent, events, session, approved,
        setInstalled: (value) => { installedNow = value; }, reloads: () => reloads,
        beforeCommand: (callback) => { beforeCommand = callback; } };
}

function locallyReported(item, overrides = {}) {
    return { id: item.id, version: item.version, enabled: item.enabled, priority: item.priority,
        source: { kind: "local" }, ...overrides };
}

test("init precedes full pending dialog; cancel cannot dispatch installation", async (t) => {
    const h = harness(t);
    const setup = await h.setup();
    const initial = await setup.status();
    assert.equal(initial.ready, false);
    assert.deepEqual(initial.checks, {
        cli: "Not installed", project: "Needs setup", packages: "Waiting for project",
    });
    assert.equal((await setup.start({})).stage, "initializing");
    assert.match(h.sent[0], /--integration-options="--skills"/);
    assert.doesNotMatch(h.sent[0], /Install ONLY the following confirmed/);
    await h.ready();
    h.complete(1);
    const review = await setup.status();
    assert.equal(review.stage, "awaiting-confirmation");
    assert.deepEqual(review.pending.map((item) => item.kind), ["extensions", "presets"]);
    assert.deepEqual(review.pending.map((item) => item.installedId),
        ["extension-one", "real-preset"]);
    assert.equal(review.pending.at(-1).downloadUrl, preset.locator.downloadUrl);
    assert.equal(review.pending.at(-1).source, "copilot");
    assert.deepEqual(review.pending.at(-1).locator, preset.locator);
    assert.equal((await setup.confirm({ planId: review.planId, confirmed: false })).stage, "cancelled");
    assert.equal(h.sent.length, 1);
    await assert.rejects(setup.confirm({ planId: review.planId, confirmed: true }), /changed/);
});

test("confirmed batch verifies inventory, supports partial retry and reloads only on readiness", async (t) => {
    const h = harness(t, { init: true });
    const setup = await h.setup();
    const review = await setup.start({});
    assert.equal(review.stage, "awaiting-confirmation");
    assert.deepEqual(review.checks, { cli: "Ready", project: "Ready", packages: "2 to install" });
    await assert.rejects(setup.confirm({ planId: "wrong", confirmed: true }), /changed/);
    assert.equal((await setup.confirm({ planId: review.planId, confirmed: true })).stage, "installing");
    assert.match(h.sent[0], /extension-one/);
    assert.match(h.sent[0], /catalog-preset/);
    h.complete(1);
    assert.equal((await setup.status()).stage, "failed");
    assert.equal(h.reloads(), 0);
    h.setInstalled(true);
    assert.equal((await setup.start({})).stage, "ready");
    assert.equal(h.reloads(), 1);
    assert.equal((await setup.status()).ready, true);
    assert.ok(h.calls.some(({ args }) => args.join(" ") === "preset list --json"));
    assert.ok(h.calls.every(({ options }) => options.timeout === 10000 && options.maxBuffer === 128 * 1024));
    assert.ok(h.calls.every(({ exe, options }) =>
        exe === (process.platform === "win32" ? "specify.exe" : "specify") && options.shell !== true));
});

test("concurrent completion checks share one stable confirmation plan", async (t) => {
    const h = harness(t);
    const setup = await h.setup();
    await setup.start({});
    await h.ready();
    h.complete(1);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let reads = 0;
    h.session.getEvents = async () => { reads++; await gate; return h.events; };
    const first = setup.status(), second = setup.status();
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(reads, 1);
    assert.equal(a.stage, "awaiting-confirmation");
    assert.equal(a.planId, b.planId);
});

test("background status probes coalesce and expire while explicit readiness checks stay fresh", async (t) => {
    let time = 1000;
    const h = harness(t, { init: true, installed: true, clock: () => time });
    const setup = await h.setup();
    let entered, release;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    h.beforeCommand(async (args) => {
        if (args[0] === "--version") { entered(); await gate; }
    });
    const first = setup.status(), second = setup.status();
    await started;
    assert.equal(h.calls.filter(({ args }) => args[0] === "--version").length, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.ready, true);
    assert.equal(b.ready, true);
    assert.equal(h.calls.length, 3);
    await setup.status();
    assert.equal(h.calls.length, 3);

    h.setInstalled(false);
    assert.equal((await setup.status()).ready, true);
    assert.equal((await setup.status({ fresh: true })).ready, false);
    assert.equal(h.calls.length, 6);
    h.setInstalled(true);
    assert.equal((await setup.start({})).ready, true);
    assert.equal(h.calls.length, 9);
    time += 3001;
    assert.equal((await setup.status()).ready, true);
    assert.equal(h.calls.length, 12);
});

test("a failed background probe is visible and retried", async (t) => {
    const h = harness(t, { init: true, installed: true });
    const setup = await h.setup();
    let fail = true;
    h.beforeCommand(async (args) => {
        if (args[0] === "--version" && fail) {
            fail = false;
            throw new Error("temporary probe failure");
        }
    });
    const first = await setup.status();
    assert.equal(first.stage, "failed");
    assert.match(first.error, /temporary probe failure/);
    assert.equal((await setup.status()).ready, true);
    assert.equal(h.calls.filter(({ args }) => args[0] === "--version").length, 2);
});

test("cancelling during the confirmation probe prevents installation", async (t) => {
    const h = harness(t, { init: true });
    const setup = await h.setup();
    const review = await setup.start({});
    let entered, release;
    const probing = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    h.beforeCommand(async (args) => {
        if (args[0] === "--version") { entered(); await gate; }
    });
    const confirming = setup.confirm({ planId: review.planId, confirmed: true });
    await probing;
    assert.equal((await setup.confirm({ planId: review.planId, confirmed: false })).stage, "cancelled");
    release();
    await assert.rejects(confirming, /Setup plan changed/);
    assert.equal(h.sent.length, 0);
});

test("approved URL install reported as local needs a confirmed install receipt", async (t) => {
    const h = harness(t, { init: true, installed: true, urlLocal: true });
    const setup = await h.setup();
    assert.equal((await setup.status()).ready, false);
    const review = await setup.start({});
    assert.deepEqual(review.pending.map((item) => item.installedId), ["real-preset"]);
    await setup.confirm({ planId: review.planId, confirmed: true });
    h.complete(1);
    assert.equal((await setup.status()).ready, true);
    assert.equal(h.approved.length, 1);
    assert.equal((await (await h.setup()).status()).ready, true);
    const unrelated = harness(t, { init: true, installed: true, urlLocal: true });
    assert.equal((await (await unrelated.setup()).status()).ready, false);
});

test("exact local inventory satisfies default catalog extensions and presets", async (t) => {
    const defaultPreset = { ...preset, locator: { installedId: preset.id, catalogId: preset.id,
        source: "default", downloadUrl: null } };
    const runtimeRecipe = { bundles: [], extensions: [extension], presets: [defaultPreset] };
    const inventory = { extension: [locallyReported(extension)], preset: [locallyReported(defaultPreset)] };
    const h = harness(t, { init: true, installed: true, runtimeRecipe, inventory });
    const setup = await h.setup();
    const state = await setup.status();
    assert.equal(state.ready, true);
    assert.equal(state.checks.packages, "Ready");
    assert.deepEqual(state.pending, []);
    assert.equal(h.reloads(), 1);
    assert.equal(h.sent.length, 0);
});

test("confirmed default catalog installs reported as local complete setup", async (t) => {
    const defaultPreset = { ...preset, locator: { installedId: preset.id, catalogId: preset.id,
        source: "default", downloadUrl: null } };
    const runtimeRecipe = { bundles: [], extensions: [extension], presets: [defaultPreset] };
    const inventory = { extension: [locallyReported(extension)], preset: [locallyReported(defaultPreset)] };
    const h = harness(t, { init: true, runtimeRecipe, inventory });
    const setup = await h.setup();
    const review = await setup.start({});
    assert.deepEqual(review.pending.map((item) => item.id), [extension.id, defaultPreset.id]);
    await setup.confirm({ planId: review.planId, confirmed: true });
    h.setInstalled(true);
    h.complete(1);
    const state = await setup.status();
    assert.equal(state.ready, true);
    assert.equal(state.stage, "ready");
    assert.equal(h.reloads(), 1);
    assert.equal(h.sent.length, 1);
});

test("default local compatibility preserves source and package checks", async (t) => {
    const cases = [
        { name: "local path", found: { source: { kind: "local", path: "another-source" } } },
        { name: "extra source field", found: { source: { kind: "local", other: true } } },
        { name: "missing source", found: { source: null } },
        { name: "different catalog", found: { source: { kind: "catalog", catalog: "other" } } },
        { name: "catalog alias", locator: { catalogId: "another-id" } },
        { name: "non-default URL without receipt",
            locator: { source: "copilot", downloadUrl: "https://example.org/extension.zip" } },
        { name: "default URL without receipt",
            locator: { downloadUrl: "https://example.org/extension.zip" } },
        { name: "different installed ID", found: { id: "another-id" } },
        { name: "different version", found: { version: "4.0.0" } },
        { name: "different enabled state", found: { enabled: false } },
        { name: "different priority", found: { priority: 1 } },
    ];
    for (const { name, found, locator } of cases) {
        await t.test(name, async (t) => {
            const item = { ...extension, locator: { ...extension.locator, ...locator } };
            const h = harness(t, { init: true, installed: true,
                runtimeRecipe: { bundles: [], extensions: [item], presets: [] },
                inventory: { extension: [locallyReported(extension, found)] } });
            const setup = await h.setup();
            assert.equal((await setup.status()).ready, false);
            const review = await setup.start({});
            assert.equal(review.stage, "awaiting-confirmation");
            assert.deepEqual(review.pending.map((entry) => entry.id), [extension.id]);
            assert.equal(h.sent.length, 0);
        });
    }
});

test("default local compatibility still requires phase skills", async (t) => {
    const h = harness(t, { init: true, installed: true,
        runtimeRecipe: { bundles: [], extensions: [extension], presets: [] },
        inventory: { extension: [locallyReported(extension)] },
        phases: [phase, { skill: "speckit-plan" }] });
    const setup = await h.setup();
    const state = await setup.status();
    assert.equal(state.ready, false);
    assert.equal(state.checks.packages, "Ready");
    const failed = await setup.start({});
    assert.equal(failed.stage, "failed");
    assert.match(failed.error, /Required phase skills are missing/);
    assert.equal(h.sent.length, 0);
});

test("frozen local locators still verify their source path", async (t) => {
    const root = await mkdtemp(join(process.cwd(), ".generated-local-source-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const local = join(root, "approved-extension");
    await mkdir(local);
    await writeFile(join(local, "extension.yml"),
        `extension:\n    id: ${extension.id}\n    version: ${extension.version}\n`);
    const item = { ...extension, locator: { installedId: extension.id, source: "local", path: local } };
    const found = locallyReported(extension, { source: { kind: "local", path: local } });
    const h = harness(t, { init: true, installed: true,
        runtimeRecipe: { bundles: [], extensions: [item], presets: [] },
        inventory: { extension: [found] } });
    const setup = await h.setup();
    assert.equal((await setup.status()).ready, true);
    found.source.path = join(root, "another-extension");
    assert.equal((await setup.status({ fresh: true })).ready, false);
    const review = await setup.start({});
    assert.equal(review.stage, "awaiting-confirmation");
    assert.deepEqual(review.pending.map((entry) => entry.id), [extension.id]);
});

test("failed init cannot expose a confirmation plan", async (t) => {
    const h = harness(t);
    const setup = await h.setup();
    await setup.start({});
    h.complete(1);
    const state = await setup.status();
    assert.equal(state.stage, "failed");
    assert.deepEqual(state.pending, []);
    assert.equal(state.planId, null);
    assert.equal(h.sent.length, 1);
});

test("setup event transport failures remain visible and retryable", async (t) => {
    const h = harness(t);
    const setup = await h.setup();
    assert.equal((await setup.start({})).stage, "initializing");
    h.session.getEvents = async () => { throw new Error("transport unavailable"); };
    const failed = await setup.status();
    assert.equal(failed.stage, "failed");
    assert.match(failed.error, /transport unavailable.*retry setup/);
    h.session.getEvents = async () => h.events;
    assert.equal((await setup.start({})).stage, "initializing");
    assert.equal(h.sent.length, 2);
});

test("init without pending runtime packages verifies and reloads directly", async (t) => {
    const h = harness(t, { empty: true });
    const setup = await h.setup();
    await setup.start({});
    await h.ready();
    h.complete(1);
    const state = await setup.status();
    assert.equal(state.stage, "ready");
    assert.equal(state.planId, null);
    assert.equal(h.reloads(), 1);
    assert.equal(h.sent.length, 1);
});

test("ready projects skip dialog and invalid runtime recipes are rejected", async (t) => {
    const h = harness(t, { init: true, installed: true });
    const setup = await h.setup();
    assert.equal((await setup.status()).ready, true);
    assert.equal((await setup.start({})).stage, "ready");
    assert.equal(h.sent.length, 0);
    assert.equal(validateRuntimeSetup({ ...recipe, presets: [{ ...preset,
        locator: { installedId: preset.id, source: "local", path: "relative" } }] }), false);
    assert.equal(validateRuntimeSetup({ ...recipe, presets: [preset, preset] }), false);
    assert.equal(validateRuntimeSetup({ ...recipe, schemaVersion: 1 }), false);
    assert.equal(validateRuntimeSetup(undefined), true);
});

test("nested frozen recipe preserves catalog aliases and rejects changed local manifests", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-local-setup-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const local = join(cwd, "approved-preset");
    const nested = { presets: [
        { id: preset.id, version: preset.version, enabled: preset.enabled,
            priority: preset.priority, locator: { installedId: preset.id,
                source: "local", path: local } },
        { id: "second-preset", version: "1.0.0", enabled: true, priority: 0,
            locator: { installedId: "second-preset", source: "copilot",
                catalogId: "second-preset", downloadUrl: "https://example.org/second.zip" } },
    ], extensions: [], bundles: [] };
    assert.equal(validateRuntimeSetup(nested), true);
    assert.equal(validateRuntimeSetup({ ...nested, presets: [
        { ...nested.presets[0], locator: { ...nested.presets[0].locator, path: "relative" } }] }), false);
    await mkdir(local);
    await writeFile(join(local, "preset.yml"),
        "schema_version: \"1.0\"\npreset: # approved source\n    id: real-preset\n"
        + "    version: \"1.0.0\" # unchanged\n    requires:\n        id: unrelated\n");
    await mkdir(join(cwd, ".specify"));
    await mkdir(join(cwd, ".github", "skills", phase.skill), { recursive: true });
    await writeFile(join(cwd, ".github", "skills", phase.skill, "SKILL.md"),
        `---\nname: ${phase.skill}\n---\n`);
    const sent = [];
    const setup = createSetup({ cwd, phases: [phase], config: { runtimeSetup: nested },
        session: { send: async ({ prompt }) => { sent.push(prompt); return "message"; },
            rpc: { skills: { reload: async () => ({ errors: [] }) } } },
        command: async (_exe, args) => ({ stdout: args[0] === "--version" ? "specify 1.0.7" : "[]" }) });
    const review = await setup.start({});
    assert.equal(review.stage, "awaiting-confirmation");
    assert.equal(review.pending.at(-1).source, "copilot");
    await writeFile(join(local, "preset.yml"),
        "schema_version: \"1.0\"\npreset:\n    id: other-preset\n"
        + "    version: \"1.0.0\" # unchanged\n");
    await assert.rejects(setup.confirm({ planId: review.planId, confirmed: true }),
        /Frozen local presets real-preset is unavailable or changed/);
    assert.deepEqual(sent, []);
});

test("frozen local extension reads its nested manifest identity", async (t) => {
    const cwd = await mkdtemp(join(process.cwd(), ".generated-local-extension-test-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const local = join(cwd, "approved-extension");
    await mkdir(local);
    await writeFile(join(local, "extension.yml"),
        "schema_version: \"1.0\"\nextension:\n    id: extension-one # installed ID\n"
        + "    version: '3.0.0' # unchanged\nrequires:\n  id: unrelated\n  version: \"9.9.9\"\n");
    await mkdir(join(cwd, ".specify"));
    await mkdir(join(cwd, ".github", "skills", phase.skill), { recursive: true });
    await writeFile(join(cwd, ".github", "skills", phase.skill, "SKILL.md"),
        `---\nname: ${phase.skill}\n---\n`);
    const setup = createSetup({ cwd, phases: [phase], config: { runtimeSetup: {
        bundles: [], presets: [], extensions: [{ ...extension,
            locator: { installedId: extension.id, source: "local", path: local } }],
    } }, session: { send: async () => "message" }, command: async (_exe, args) => ({
        stdout: args[0] === "--version" ? "specify 1.0.7" : "[]",
    }) });
    const review = await setup.start({});
    assert.equal(review.stage, "awaiting-confirmation");
    await writeFile(join(local, "extension.yml"),
        "schema_version: \"1.0\"\nextension:\n    id: extension-one\n"
        + "    version: '4.0.0' # changed\nrequires:\n  version: \"3.0.0\"\n");
    await assert.rejects(setup.confirm({ planId: review.planId, confirmed: true }),
        /Frozen local extensions extension-one is unavailable or changed/);
});

test("setup card keeps the workflow visible while gating phase runs until ready", async () => {
    const source = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/app.js",
        import.meta.url), "utf8");
    const setupCode = source.slice(source.indexOf("function renderSetup()"), source.indexOf("let phaseControl;"));
    const statusCode = source.slice(source.indexOf("function renderStatus()"), source.indexOf("function renderPhase()"));
    const nodes = new Map(["setup-surface", "workflow-surface", "workflow-pipeline", "setup-status", "setup-actions", "run-phase", "phase-args",
        "phase-message"].map((id) => [id, { hidden: false, disabled: false, readOnly: false,
        textContent: "", title: "", classList: { toggle() {} }, querySelector: () => null,
        querySelectorAll: () => [] }]));
    let phasePending;
    const context = { model: { showSetup: true, setup: { stage: "needs-setup", ready: false,
        checks: { cli: "Ready", project: "Ready", packages: "1 to install" } } },
    setupBusy: false, activeSetupPlan: null, buttons: [], workflowPage: null, phaseControl: { update: (state) => {
        phasePending = state.setupPending;
    } }, pendingLabel: () => null, phaseState: () => ({
        slugEditable: false, setupPending: Boolean(context.model.showSetup && !context.model.setup?.ready) }),
    validatePhaseState,
    constitution: () => null, hasSelectedWorkflow: () => false, renderName() {}, renderSlug() {},
    $: (id) => nodes.get(id), Map, Object, Boolean };
    runInNewContext(`${setupCode}\n${statusCode}\nthis.render = () => { renderSetup(); renderStatus(); };`, context);
    context.render();
    assert.equal(nodes.get("setup-surface").hidden, false);
    assert.equal(nodes.get("workflow-surface").hidden, false);
    assert.equal(nodes.get("setup-status").hidden, true);
    assert.equal(phasePending, true);
    context.model.setup = { stage: "failed", ready: false, error: "Install failed; retry." };
    context.render();
    assert.equal(nodes.get("setup-status").hidden, false);
    assert.equal(nodes.get("setup-status").textContent, "Install failed; retry.");
    context.model.setup = { stage: "installing", ready: false };
    context.render();
    assert.match(nodes.get("setup-status").textContent, /Installing confirmed packages/);
    context.model.setup = { stage: "ready", ready: true };
    context.render();
    assert.equal(nodes.get("setup-surface").hidden, true);
    assert.equal(nodes.get("workflow-surface").hidden, false);
    assert.equal(phasePending, false);
    context.model = { showSetup: false, setup: { stage: "needs-setup", ready: false } };
    context.render();
    assert.equal(nodes.get("setup-surface").hidden, true);
    assert.equal(phasePending, false);
});

test("setup activation errors unhide the status even after an idle render", async () => {
    const source = await readFile(new URL("../extension-canvas-design/generated-scaffold/ui/app.js",
        import.meta.url), "utf8");
    const messageCode = source.slice(source.indexOf("function message("), source.indexOf("function displayValue("));
    const status = { hidden: true, textContent: "", classList: { toggle() {} }, setAttribute() {} };
    const context = { $: () => status };
    runInNewContext(`${messageCode}\nmessage("Specify probe failed", "setup-status", true);`, context);
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, "Specify probe failed");
});

test("phase dispatch is gated on readiness even when showSetup is false; legacy runs retain skill checks", async (t) => {
    const h = harness(t);
    const cwd = await mkdtemp(join(process.cwd(), ".generated-setup-runtime-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const config = { canvas: { id: "test" }, phases: ["specify"],
        phaseOutputs: { specify: { outputPath: "specs/<slug>/spec.md", expectsArtifact: true } },
        userProvidesSlug: false, showSetup: false, runtimeSetup: recipe };
    const runtime = await createRuntime({ config, cwd, workspace: cwd, session: {
        ...h.session, sessionId: "test", log: async () => {}, on: () => () => {} } });
    try {
        await assert.rejects(runtime.run({ phase: "specify", args: "" }, "panel"), /setup is not ready/);
        await assert.rejects(runtime.startAutopilot({ itemId: "__new__" }, "panel"),
            /setup is not ready/);
        assert.equal(h.sent.length, 0);
        const snapshot = await runtime.snapshot();
        assert.equal(snapshot.setup.ready, false);
        assert.equal(snapshot.setup.stage, "needs-setup");
        assert.equal(snapshot.showSetup, false);
    } finally { runtime.close(); }
    const oldRuntime = await createRuntime({ config: { ...config, showSetup: undefined, runtimeSetup: undefined },
        cwd, workspace: cwd, session: { ...h.session, sessionId: "test", log: async () => {},
            on: () => () => {}, rpc: { skills: { reload: async () => ({ errors: [] }) } } } });
    try {
        await assert.rejects(oldRuntime.run({ phase: "specify", args: "" }, "panel"), /Installed skill/);
    } finally { oldRuntime.close(); }
});

test("setup routes require canvas token, origin and the current plan", async (t) => {
    const h = harness(t, { init: true });
    const setup = await h.setup();
    const config = { canvas: { id: "route", displayName: "Route",
        workflowListName: "Workflows", description: "Setup route" }, phases: ["specify"],
    phaseOutputs: { specify: { outputPath: "specs/<slug>/spec.md", expectsArtifact: true } },
    installed: { presets: [], extensions: [], bundles: [] },
    userProvidesSlug: false, workflowPage: { adapter: "generated-phase-adapter",
        viewLabels: {}, slots: [{ id: "workflow.phases" }] } };
    const runtime = { setupStart: setup.start, setupConfirm: setup.confirm };
    let server;
    const routes = createWorkflowRoutes(config, { runtime, instanceId: "panel", token: "test-token",
        port: () => server.address().port });
    server = createServer((request, response) => { void routes.handle(request, response); });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { routes.close(); await new Promise((resolve) => server.close(resolve)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, body, headers = {}) => fetch(`${base}${route}`, { method: "POST",
        headers: { "content-type": "application/json", "x-canvas-token": "test-token", ...headers },
        body: JSON.stringify(body) });
    assert.equal((await fetch(`${base}/api/setup/start`)).status, 401);
    const html = await (await fetch(`${base}/?token=test-token`)).text();
    assert.match(html, /<main id="workflow-surface" class="app-body workflow-surface" data-workflow-item-name="Workflow">/);
    assert.match(html, /<main id="workflow-surface"[^>]*>[\s\S]*?<section id="setup-surface"[^>]*hidden>/);
    assert.match(html, /Set up this project[\s\S]*?Set up Spec Kit and install the selected presets, extensions, and bundles\.[\s\S]*?id="setup-actions"/);
    assert.doesNotMatch(html, /id="setup-(?:cli|project|packages)"/);
    assert.equal((await post("/api/setup/start", {}, { origin: "https://elsewhere.example" })).status, 403);
    const response = await post("/api/setup/start", {});
    assert.equal(response.status, 200);
    const review = await response.json();
    assert.equal(review.stage, "awaiting-confirmation");
    assert.equal((await post("/api/setup/confirm", { planId: "stale", confirmed: true })).status, 409);
    assert.equal((await post("/api/setup/confirm", { planId: review.planId, confirmed: false })).status, 200);
    assert.equal(h.sent.length, 0);
});
