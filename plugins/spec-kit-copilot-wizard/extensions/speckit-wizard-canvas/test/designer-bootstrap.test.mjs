import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildDesignerHandoff, buildScriptedDesignerLaunchPrompt } from "../server/handlers-designer.mjs";
import { getSession, sessionAdapter, setSession } from "../canvas-runtime/instances.mjs";
import { createDesignerBootstrap } from "../../speckit-canvas-designer/bootstrap.mjs";
import { bootstrapDiagnosticPath, readBootstrapRecord, readResolvedHandoff, stageDesignerHandoff,
    transferDesignerHandoff, writeBootstrapRecord } from "../../speckit-canvas-designer/bootstrap-artifacts.mjs";
import { assertBootstrapCapabilities, assertDiagnosticSize, bootstrapSessionContext, DESIGNER_CANVAS,
    DESIGNER_PROVIDER, DIAGNOSTIC_ERROR_RESERVE, DIAGNOSTIC_LIMIT, nativeOpenSnapshot, validateBootstrapInput,
    validateBootstrapOutput, validateBootstrapRecord } from "../../speckit-canvas-designer/contracts/bootstrap.mjs";
import { HANDOFF_LIMIT, readHandoff, validateHandoff } from "../../speckit-canvas-designer/handoff.mjs";
import { INFERENCE_INPUT_LIMIT, INFERENCE_RESULT_LIMIT } from "../../speckit-canvas-designer/contracts/output-inference.mjs";
import { freshDesignerSettings, initialOutputs, loadDesignerSettings,
    saveDesignerSettings } from "../../speckit-canvas-designer/settings.mjs";
import { effectiveSource } from "../artifact-evidence.mjs";
import { checkSchema } from "../../speckit-canvas-designer/contracts/external-design-contributions.mjs";
import { launchReferenceSchema } from "../../speckit-canvas-designer/contracts/bootstrap.mjs";

const empty = { presets: [], extensions: [], bundles: [] };
const catalog = { ...empty, extensions: [{ id: "extension-canvas-design", source: "copilot",
    version: "1.0.0", downloadUrl: "https://example.org/canvas.zip", tags: ["canvas-design"] }] };

async function fixture(t, options = {}) {
    const folder = await realpath(await mkdtemp(join(tmpdir(), "designer-bootstrap-")));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const sourceId = randomUUID();
    const childId = randomUUID();
    const sourceRoot = join(folder, sourceId);
    const context = { sessionId: childId, root: join(folder, childId), project: join(folder, "checkout") };
    const sourceProject = options.separateSource ? join(folder, "wizard-checkout") : context.project;
    await Promise.all([...new Set([sourceRoot, context.root, context.project, sourceProject])]
        .map((path) => mkdir(path)));
    const session = { sessionId: sourceId, workspacePath: sourceRoot,
        rpc: { metadata: { snapshot: async () => ({ sessionId: sourceId,
            workspacePath: sourceRoot, workingDirectory: sourceProject }) } } };
    let inferenceInput;
    let handoff = options.handoff;
    if (options.pending) {
        const skillPath = join(sourceProject, ".github", "skills", "speckit-plan", "SKILL.md");
        await mkdir(dirname(skillPath), { recursive: true });
        await writeFile(skillPath, "# Plan\nWrite plan.md in the feature directory.\n"
            + (options.helper ? "Inspect .specify/scripts/bash/prepare.sh.\n" : ""));
        if (options.helper) {
            const helper = join(sourceProject, ".specify", "scripts", "bash", "prepare.sh");
            await mkdir(dirname(helper), { recursive: true });
            await writeFile(helper, "FEATURE_DIR=specs/example\n");
        }
        const source = await effectiveSource(sourceProject, "speckit.plan");
        inferenceInput = { schemaVersion: 1, workspacePath: sourceProject, commands: [{
            phase: "plan", commandId: "speckit.plan", skillPath: source.skillPath,
            fingerprint: source.fingerprint, sources: source.sources, text: source.skillText,
        }] };
        const pendingOutputs = { inputHash: createHash("sha256").update(JSON.stringify(inferenceInput)).digest("hex"),
            commands: [{ phase: "plan", commandId: "speckit.plan", fingerprint: source.fingerprint }] };
        handoff = buildDesignerHandoff({ pipeline: [{ id: "plan" }], catalog },
            empty, options.local, empty, randomUUID(), empty,
            { outputEvidence: { plan: { outputs: [], view: null } }, pendingOutputs });
    }
    handoff ??= buildDesignerHandoff({ pipeline: [{ id: "plan" }], catalog },
        empty, options.local, empty, randomUUID(), empty);
    const reference = await stageDesignerHandoff(session, handoff, inferenceInput);
    const calls = [];
    const errors = [];
    const input = { handoffId: handoff.handoffId, pages: [{
        name: "designer-essentials", path: join(context.project, "page.json"),
        kind: "designer.tab-definition", strategy: "replace",
    }], templates: [] };
    let current = [];
    const deps = {
        getContext: async () => context,
        checkNative: () => {},
        log: async (message) => errors.push(message),
        install: async (project, root, id, hash) => {
            calls.push("install");
            assert.equal(project, context.project);
            assert.equal(root, context.root);
            assert.equal(hash, reference.sha256);
            await readHandoff(root, id, undefined, hash);
            await writeFile(join(root, "speckit-canvas-designer", "handoffs", id, "setup-record.json"),
                JSON.stringify({ schemaVersion: 1, handoffId: id, handoffHash: hash, selections: empty }));
            return { stage: "installed", timings: { base: 1 }, warnings: ["version drift"] };
        },
        reloadSkills: async () => {
            calls.push("reload");
            return { errors: [], warnings: [] };
        },
        finalize: async () => {
            calls.push("finalize");
            return { stage: "ready", openInput: input, timings: { finalize: 2 }, warnings: [] };
        },
        listOpenCanvases: async () => ({ openCanvases: current }),
        openCanvas: async (request) => {
            calls.push("open");
            assert.strictEqual(request.input, input);
            assert.deepEqual(Object.keys(request.input), ["handoffId", "pages", "templates"]);
            current = [request];
            return { resultType: "success", textResultForLlm: JSON.stringify(request) };
        },
        ...options.deps,
    };
    const run = createDesignerBootstrap(deps);
    const request = (stage) => ({ schemaVersion: 1, stage, launchRef: reference });
    return { folder, session, context, handoff, reference, inferenceInput, calls, errors, input, deps, run, request,
        setOpen: (value) => { current = value; } };
}

test("bootstrap stages require separate LLM calls and carry complete payloads internally", async (t) => {
    const f = await fixture(t);
    assert.deepEqual(f.calls, []);
    const installed = await f.run(f.request("install"));
    assert.equal(installed.status, "installed");
    assert.deepEqual(f.calls, ["install"]);
    const target = join(f.context.root, "speckit-canvas-designer", "handoffs", f.handoff.handoffId, "handoff.json");
    assert.equal(await readFile(target, "utf8"), JSON.stringify(f.handoff));
    const opened = await f.run(f.request("finalize-open"));
    assert.equal(opened.status, "shell-opened");
    assert.deepEqual(f.calls, ["install", "reload", "finalize", "open"]);
    assert.equal(opened.warningCount, 1);
    assert.deepEqual(opened.timings, { base: 1, finalize: 2 });
    assert.ok(Buffer.byteLength(JSON.stringify(opened)) < 4096);
    assert.doesNotMatch(JSON.stringify(opened), /pages|templates|openInput/);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.deepEqual(record.finalize.openInput, f.input);
    assert.deepEqual(nativeOpenSnapshot(record.nativeResult).input, f.input);
    assert.doesNotThrow(() => validateBootstrapOutput(opened));
    assert.equal(opened.diagnosticsPath, bootstrapDiagnosticPath(f.context.root, f.handoff.handoffId));
});

function outputSubmission(f, candidates = [{
    kind: "file", source: "inference", effect: "creates", evidence: "The skill writes the plan.",
    path: "plan.md", relativeTo: "feature",
}], primaryIndex = 0) {
    return { entries: [{ commandId: "speckit.plan",
        fingerprint: f.inferenceInput.commands[0].fingerprint, candidates, primaryIndex }] };
}

test("pending outputs require install and a validated result before open, Save, and reopen", async (t) => {
    const f = await fixture(t, { pending: true });
    assert.equal((await f.run(f.request("outputs"))).error.code, "designer_install_required");
    assert.equal((await f.run(f.request("install"))).status, "installed");
    const before = await f.run(f.request("finalize-open"));
    assert.equal(before.status, "failure");
    assert.match(before.error.message, /output inference is pending/);
    await assert.rejects(readResolvedHandoff(f.context.root, f.handoff.handoffId), /output inference is pending/);
    assert.deepEqual(f.calls, ["install"]);
    const prepared = await f.run(f.request("outputs"));
    assert.equal(prepared.status, "outputs-required");
    assert.equal(prepared.outputs.pending, 1);
    assert.equal(Object.hasOwn(prepared.outputs, "known"), false);
    assert.match(prepared.outputs.prompt, /Write plan\.md in the feature directory/);
    assert.match(prepared.outputs.prompt, /speckit\.plan/);
    assert.doesNotMatch(prepared.outputs.prompt, /api\/artifact-targets|speckit\.outside/);
    const submitted = await f.run({ ...f.request("outputs"), result: outputSubmission(f) });
    assert.equal(submitted.status, "outputs-complete");
    const skill = join(f.context.project, ...f.inferenceInput.commands[0].skillPath.split("/"));
    await writeFile(skill, "Changed after the result was accepted.");
    assert.equal((await f.run(f.request("outputs"))).status, "outputs-complete");
    assert.equal((await readBootstrapRecord(f.context.root, f.handoff.handoffId)).error, undefined);
    const handoff = await readResolvedHandoff(f.context.root, f.handoff.handoffId);
    const baseline = { plan: { outputs: ["specs/<slug>/plan.md"], view: "specs/<slug>/plan.md" } };
    assert.deepEqual(initialOutputs(handoff), baseline);
    const model = { revision: "outputs", constraints: {}, values: {}, badges: [] };
    const fresh = await freshDesignerSettings(f.context.root, handoff, model);
    const outputs = { plan: { outputs: [...baseline.plan.outputs, "specs/<slug>/notes.md"],
        view: baseline.plan.view } };
    await saveDesignerSettings(f.context.root, handoff, fresh,
        { modelRevision: model.revision, revision: 0, values: {}, outputs, badges: [] });
    assert.deepEqual((await loadDesignerSettings(f.context.root, handoff, model)).outputs, outputs);
    const reopened = await freshDesignerSettings(f.context.root, handoff, model);
    assert.equal(reopened.settingsRevision, 1);
    assert.deepEqual(reopened.outputs, baseline);
    assert.equal((await f.run(f.request("finalize-open"))).status, "shell-opened");
    assert.deepEqual(f.calls, ["install", "reload", "finalize", "open"]);
});

test("outputs rejects incompatible results without persisting an empty or unsafe answer", async (t) => {
    const f = await fixture(t, { pending: true });
    assert.equal((await f.run(f.request("install"))).status, "installed");
    const valid = outputSubmission(f);
    const wrongFingerprint = structuredClone(valid);
    wrongFingerprint.entries[0].fingerprint = "0".repeat(64);
    const outside = structuredClone(valid);
    outside.entries.push({ ...outside.entries[0], commandId: "speckit.outside" });
    const replaced = structuredClone(valid);
    replaced.entries[0].commandId = "speckit.outside";
    const empty = { entries: [] };
    const unsafe = outputSubmission(f, [{
        kind: "file", source: "inference", effect: "creates", evidence: "Bad path",
        path: "../outside.md",
    }]);
    const reserved = outputSubmission(f, [{
        kind: "file", source: "inference", effect: "creates", evidence: "Bad path",
        path: ".speckit-canvas/private.md",
    }]);
    const badPrimary = outputSubmission(f, [{ kind: "unknown", source: "inference",
        effect: "unknown", evidence: "Not established" }], 0);
    const tooLarge = outputSubmission(f, [{ kind: "unknown", source: "inference",
        effect: "unknown", evidence: "x".repeat(1024 * 1024) }], null);
    for (const result of [wrongFingerprint, outside, replaced, empty, unsafe, reserved, badPrimary, tooLarge]) {
        const rejected = await f.run({ ...f.request("outputs"), result });
        assert.equal(rejected.status, "failure");
        assert.ok(rejected.error.message);
        await assert.rejects(readFile(join(f.context.root, "speckit-canvas-designer", "handoffs",
            f.handoff.handoffId, "inference-result.json")), { code: "ENOENT" });
    }
    const unknown = outputSubmission(f, [{ kind: "unknown", source: "inference",
        effect: "unknown", evidence: "The skill does not establish an output." }], null);
    assert.equal((await f.run({ ...f.request("outputs"), result: unknown })).status, "outputs-complete");
    assert.deepEqual(initialOutputs(await readResolvedHandoff(f.context.root, f.handoff.handoffId)),
        { plan: { outputs: [], view: null } });
    assert.equal((await f.run({ ...f.request("outputs"), result: valid })).status, "failure");
});

test("a validated no-output result is complete without inventing a viewer", async (t) => {
    const f = await fixture(t, { pending: true });
    assert.equal((await f.run(f.request("install"))).status, "installed");
    const result = outputSubmission(f, [{ kind: "none", source: "inference",
        effect: "unknown", evidence: "This command does not produce an artifact." }], null);
    assert.equal((await f.run({ ...f.request("outputs"), result })).status, "outputs-complete");
    assert.deepEqual(initialOutputs(await readResolvedHandoff(f.context.root, f.handoff.handoffId)),
        { plan: { outputs: [], view: null } });
    assert.equal((await f.run(f.request("finalize-open"))).status, "shell-opened");
});

test("pending handoffs reject changed source and altered input artifacts", async (t) => {
    const f = await fixture(t, { pending: true });
    assert.equal((await f.run(f.request("install"))).status, "installed");
    assert.equal((await f.run(f.request("outputs"))).status, "outputs-required");
    const skill = join(f.context.project, ...f.inferenceInput.commands[0].skillPath.split("/"));
    await writeFile(skill, "changed skill");
    const changed = await f.run({ ...f.request("outputs"), result: outputSubmission(f) });
    assert.equal(changed.status, "failure");
    assert.match(changed.error.message, /changed or is unavailable/);
    await writeFile(skill, f.inferenceInput.commands[0].text);
    const inputPath = join(f.context.root, "speckit-canvas-designer", "handoffs",
        f.handoff.handoffId, "inference-input.json");
    await writeFile(inputPath, "{}");
    assert.match((await f.run(f.request("outputs"))).error.message, /inputs changed/);
    await assert.rejects(readResolvedHandoff(f.context.root, f.handoff.handoffId), /inputs changed/);
    assert.match((await f.run(f.request("finalize-open"))).error.message, /inputs changed/);
});

test("pending inference rejects helper drift before providing its prompt", async (t) => {
    const f = await fixture(t, { pending: true, helper: true });
    assert.equal((await f.run(f.request("install"))).status, "installed");
    const helper = join(f.context.project, ".specify", "scripts", "bash", "prepare.sh");
    await writeFile(helper, "FEATURE_DIR=specs/changed\n");
    const result = await f.run(f.request("outputs"));
    assert.equal(result.status, "failure");
    assert.match(result.error.message, /changed or is unavailable/);
});

test("oversized inference artifacts stop transfer and native open", async (t) => {
    const source = await fixture(t, { pending: true });
    const sourceInput = join(source.session.workspacePath, "speckit-canvas-designer", "handoffs",
        source.handoff.handoffId, "inference-input.json");
    await writeFile(sourceInput, Buffer.alloc(INFERENCE_INPUT_LIMIT + 1));
    const install = await source.run(source.request("install"));
    assert.equal(install.status, "failure");
    assert.match(install.error.message, /oversized/i);
    assert.deepEqual(source.calls, []);

    const child = await fixture(t, { pending: true });
    assert.equal((await child.run(child.request("install"))).status, "installed");
    assert.equal((await child.run({ ...child.request("outputs"), result: outputSubmission(child) })).status,
        "outputs-complete");
    const resultPath = join(child.context.root, "speckit-canvas-designer", "handoffs",
        child.handoff.handoffId, "inference-result.json");
    await writeFile(resultPath, Buffer.alloc(INFERENCE_RESULT_LIMIT + 1));
    const finalize = await child.run(child.request("finalize-open"));
    assert.equal(finalize.status, "failure");
    assert.match(finalize.error.message, /oversized/i);
    assert.deepEqual(child.calls, ["install"]);
});

test("v1 contract boundaries reject pending handoffs and the new outputs stage", async (t) => {
    const f = await fixture(t, { pending: true });
    const validateV1Handoff = (handoff) => {
        if (handoff.schemaVersion !== 1 || Object.keys(handoff.workflow).some((key) =>
            !["selectedPhases", "phaseDescriptions", "outputEvidence", "installed", "installLocators",
                "runtimeSetup"].includes(key))) throw new Error("Invalid Designer handoff");
        return validateHandoff(handoff, handoff.handoffId);
    };
    const v1BootstrapInput = { type: "object", additionalProperties: false,
        required: ["schemaVersion", "stage", "launchRef"], properties: {
            schemaVersion: { const: 1 },
            stage: { type: "string", enum: ["install", "finalize-open"] },
            launchRef: launchReferenceSchema,
        } };
    assert.throws(() => validateV1Handoff(f.handoff), /Invalid Designer handoff/);
    assert.throws(() => checkSchema(f.request("outputs"), v1BootstrapInput, "legacy bootstrap"), /unsupported value/);
    const complete = await fixture(t);
    assert.equal(complete.handoff.schemaVersion, 1);
    assert.deepEqual(validateV1Handoff(complete.handoff), complete.handoff);
    assert.doesNotThrow(() => checkSchema(complete.request("install"), v1BootstrapInput, "legacy bootstrap"));
    assert.equal((await complete.run(complete.request("install"))).status, "installed");
    assert.equal((await complete.run(complete.request("finalize-open"))).status, "shell-opened");
});

test("large inventories stay complete in native input, not model output", async (t) => {
    const f = await fixture(t);
    f.input.pages = Array.from({ length: 100 }, (_, i) => ({
        name: `page-${i}`, path: `C:\\${"\u4e00".repeat(4000)}-${i}.json`,
        kind: "designer.tab-definition", strategy: "replace",
    }));
    f.input.templates = Array.from({ length: 100 }, (_, i) => ({
        name: `template-${i}`, path: `C:\\${"\u4e8c".repeat(4000)}-${i}.mjs`,
        sourceId: "project", kind: "generated.control-adapter", strategy: "replace",
    }));
    const run = createDesignerBootstrap({ ...f.deps, openCanvas: async (request) => {
        await f.deps.openCanvas(request);
        return { resultType: "success", textResultForLlm: "Output too large: truncated display text" };
    } });
    assert.equal((await run(f.request("install"))).status, "installed");
    const result = await run(f.request("finalize-open"));
    assert.equal(result.status, "shell-opened");
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 4096);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.equal(record.finalize.openInput.pages.length, 100);
    assert.equal(record.openSnapshot.input.templates.length, 100);
    assert.deepEqual(record.openSnapshot.input, f.input);
    assert.equal(record.nativeResult.textResultForLlm, "Output too large: truncated display text");
});

test("prompt size depends only on the launch reference, not a near-limit handoff", async (t) => {
    const f = await fixture(t);
    const installed = { ...empty, presets: Array.from({ length: 10 }, (_, i) => ({
        id: `runtime-${i}`, version: "1.0.0", enabled: true, priority: 10, source: "copilot",
    })) };
    const locators = { ...empty, presets: installed.presets.map((entry, i) => ({
        installedId: entry.id, source: "local", path: `C:\\${"p".repeat(2800)}\\${i}`,
    })) };
    const large = buildDesignerHandoff({ pipeline: [{ id: "plan" }], catalog },
        empty, undefined, installed, randomUUID(), locators);
    const bytes = Buffer.byteLength(JSON.stringify(large));
    assert.ok(bytes > 56 * 1024 && bytes < HANDOFF_LIMIT);
    const reference = await stageDesignerHandoff(f.session, large);
    const smallPrompt = buildScriptedDesignerLaunchPrompt(f.reference);
    const largePrompt = buildScriptedDesignerLaunchPrompt(reference);
    assert.equal(Buffer.byteLength(smallPrompt), Buffer.byteLength(largePrompt));
    assert.ok(Buffer.byteLength(largePrompt) < 4096);
    assert.doesNotMatch(largePrompt, /runtime-9|HANDOFF_JSON|runtimeSetup/);
});

test("diagnostic byte limit is enforced without overwriting the previous artifact", async (t) => {
    const f = await fixture(t);
    await f.run(f.request("install"));
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    record.error = { code: "test_diagnostic", message: "" };
    record.error.message = "x".repeat(DIAGNOSTIC_LIMIT - Buffer.byteLength(JSON.stringify(record)));
    assert.equal(Buffer.byteLength(JSON.stringify(record)), DIAGNOSTIC_LIMIT);
    await writeBootstrapRecord(f.context.root, f.handoff.handoffId, record);
    record.error.message += "x";
    await assert.rejects(writeBootstrapRecord(f.context.root, f.handoff.handoffId, record), /exceed 16 MiB/);
    const saved = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.equal(Buffer.byteLength(JSON.stringify(saved)), DIAGNOSTIC_LIMIT);
});

test("diagnostic preflight measures exact JSON bytes without serializing rejected data", (t) => {
    const shared = { text: "\u4e00\u{1f600}\ud800x\udfff\"\\\b\t\n\f\r\u0000\u001f" };
    const value = { "quoted\"\u0000key": [shared, shared, true, false, null, -0, 1.25] };
    const bytes = Buffer.byteLength(JSON.stringify(value));
    t.mock.method(JSON, "stringify", () => { throw new Error("Unexpected serialization"); });
    assert.equal(assertDiagnosticSize(value, bytes), bytes);
    assert.throws(() => assertDiagnosticSize(value, bytes - 1), { code: "designer_diagnostic_limit" });
    for (const malformed of [
        new Array(1), { toJSON() { throw new Error("Unexpected toJSON"); } },
        { get text() { throw new Error("Unexpected getter"); } },
    ]) {
        assert.throws(() => assertDiagnosticSize(malformed), { code: "designer_diagnostic_invalid" });
    }
});

test("bootstrap validates additive request/result contracts and native capabilities", async (t) => {
    const f = await fixture(t);
    assert.doesNotThrow(() => validateBootstrapInput(f.request("install")));
    for (const request of [
        { ...f.request("install"), schemaVersion: 2 },
        { ...f.request("install"), stage: "auto" },
        { ...f.request("install"), pages: [] },
        { ...f.request("install"), launchRef: { ...f.reference, sourceRoot: join(f.reference.sourceRoot, "files") } },
        { ...f.request("install"), launchRef: { ...f.reference, sha256: "bad" } },
    ]) {
        const result = await f.run(request);
        assert.equal(result.status, "failure");
        assert.ok(result.error.message);
    }
    assert.deepEqual(f.calls, []);
    assert.throws(() => validateBootstrapOutput({ schemaVersion: 1, status: "shell-opened" }), /Incomplete/);
    assert.throws(() => validateBootstrapOutput({ schemaVersion: 1, status: "failure",
        error: { code: "failed", message: "failure" }, openInput: f.input }), /unsupported property/);
    assert.throws(() => assertBootstrapCapabilities({}), /requires native/);
    assert.doesNotThrow(() => assertBootstrapCapabilities({
        tools: { execute() {} }, canvas: { listOpen() {} }, metadata: { snapshot() {} }, skills: { reload() {} },
    }));
});

test("authoritative checkout/root metadata rejects mismatches and parent execution", async (t) => {
    const f = await fixture(t);
    const original = await f.session.rpc.metadata.snapshot();
    assert.deepEqual(await bootstrapSessionContext(f.session), {
        sessionId: f.session.sessionId, root: f.session.workspacePath, project: f.context.project,
    });
    await assert.rejects(bootstrapSessionContext(f.session, { sessionId: "another-session" }), /conflicting/);
    f.session.rpc.metadata.snapshot = async () => ({ ...original, workspacePath: f.context.project });
    await assert.rejects(bootstrapSessionContext(f.session), /conflicting/);
    const run = createDesignerBootstrap({ ...f.deps, getContext: async () => ({
        ...f.context, sessionId: f.reference.sourceSessionId,
    }) });
    assert.equal((await run(f.request("install"))).error.code, "designer_child_required");
    assert.deepEqual(f.calls, []);
});

test("source metadata rejects an identical checkout and artifact root before staging", async (t) => {
    const f = await fixture(t);
    const original = await f.session.rpc.metadata.snapshot();
    f.session.rpc.metadata.snapshot = async () => ({
        ...original, workingDirectory: f.session.workspacePath,
    });
    const handoff = { ...f.handoff, handoffId: randomUUID() };
    await assert.rejects(bootstrapSessionContext(f.session), { code: "designer_session_metadata_invalid" });
    await assert.rejects(stageDesignerHandoff(f.session, handoff), { code: "designer_session_metadata_invalid" });
    await assert.rejects(lstat(join(f.session.workspacePath, "speckit-canvas-designer",
        "handoffs", handoff.handoffId)), { code: "ENOENT" });
});

test("source metadata rejects directory aliases of the same root before staging", async (t) => {
    const f = await fixture(t);
    const alias = join(f.folder, "session-alias");
    await symlink(f.session.workspacePath, alias, process.platform === "win32" ? "junction" : "dir");
    for (const [root, project] of [
        [f.session.workspacePath, alias],
        [alias, f.session.workspacePath],
    ]) {
        const session = { sessionId: f.session.sessionId, workspacePath: root,
            rpc: { metadata: { snapshot: async () => ({
                sessionId: f.session.sessionId, workspacePath: root, workingDirectory: project,
            }) } } };
        const handoff = { ...f.handoff, handoffId: randomUUID() };
        await assert.rejects(bootstrapSessionContext(session), { code: "designer_session_metadata_invalid" });
        await assert.rejects(stageDesignerHandoff(session, handoff), { code: "designer_session_metadata_invalid" });
        await assert.rejects(lstat(join(f.session.workspacePath, "speckit-canvas-designer",
            "handoffs", handoff.handoffId)), { code: "ENOENT" });
    }
});

test("distinct aliased metadata roots return canonical paths for staging and child setup", async (t) => {
    const f = await fixture(t);
    const sourceAlias = join(f.folder, "source-alias");
    const childAlias = join(f.folder, "child-alias");
    const projectAlias = join(f.folder, "checkout-alias");
    for (const [target, alias] of [
        [f.session.workspacePath, sourceAlias],
        [f.context.root, childAlias],
        [f.context.project, projectAlias],
    ]) {
        await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    }
    const source = { sessionId: f.session.sessionId, workspacePath: sourceAlias,
        rpc: { metadata: { snapshot: async () => ({
            sessionId: f.session.sessionId, workspacePath: sourceAlias, workingDirectory: projectAlias,
        }) } } };
    assert.deepEqual(await bootstrapSessionContext(source), {
        sessionId: f.session.sessionId, root: f.session.workspacePath, project: f.context.project,
    });
    assert.deepEqual(await stageDesignerHandoff(source, f.handoff), f.reference);
    const child = { sessionId: f.context.sessionId, workspacePath: childAlias,
        rpc: { metadata: { snapshot: async () => ({
            sessionId: f.context.sessionId, workspacePath: childAlias, workingDirectory: projectAlias,
        }) } } };
    const context = await bootstrapSessionContext(child, { sessionId: f.context.sessionId });
    assert.deepEqual(context, f.context);
    const run = createDesignerBootstrap({ ...f.deps, getContext: async () => context });
    assert.equal((await run(f.request("install"))).status, "installed");
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
});

test("unresolvable metadata roots fail explicitly before staging", async (t) => {
    const f = await fixture(t);
    const original = await f.session.rpc.metadata.snapshot();
    f.session.rpc.metadata.snapshot = async () => ({
        ...original, workingDirectory: join(f.folder, "missing-checkout"),
    });
    await assert.rejects(bootstrapSessionContext(f.session), (error) =>
        error.code === "designer_session_metadata_invalid" && error.cause?.code === "ENOENT");
    await assert.rejects(stageDesignerHandoff(f.session, f.handoff),
        { code: "designer_session_metadata_invalid" });
});

test("Wizard staging uses the late-bound native session adapter", async (t) => {
    const f = await fixture(t);
    const previous = getSession();
    try {
        setSession(null);
        const adapter = sessionAdapter();
        await assert.rejects(stageDesignerHandoff(adapter, f.handoff), /metadata/);
        setSession(f.session);
        assert.deepEqual(await stageDesignerHandoff(adapter, f.handoff), f.reference);
        assert.equal(adapter.workspacePath, f.reference.sourceRoot);
    } finally {
        setSession(previous);
    }
});

test("changed/oversized source bytes and conflicting child bytes fail before installation", async (t) => {
    const f = await fixture(t);
    const source = join(f.reference.sourceRoot, "speckit-canvas-designer", "handoffs", f.handoff.handoffId, "handoff.json");
    await writeFile(source, `${JSON.stringify(f.handoff)}\n`);
    assert.match((await f.run(f.request("install"))).error.message, /bytes changed/);
    await writeFile(source, "x".repeat(HANDOFF_LIMIT + 1));
    assert.match((await f.run(f.request("install"))).error.message, /oversized/i);
    await writeFile(source, JSON.stringify(f.handoff));
    await transferDesignerHandoff(f.reference, f.context);
    const child = join(f.context.root, "speckit-canvas-designer", "handoffs", f.handoff.handoffId, "handoff.json");
    await writeFile(child, "{}");
    assert.match((await f.run(f.request("install"))).error.message, /different bytes/);
    assert.equal(await readFile(child, "utf8"), "{}");
    assert.deepEqual(f.calls, []);
});

test("transfer rejects symlinked source folders and parent-directory replacement", async (t) => {
    const f = await fixture(t);
    const folder = join(f.reference.sourceRoot, "speckit-canvas-designer", "handoffs", f.handoff.handoffId);
    const replaced = `${folder}-saved`;
    await rename(folder, replaced);
    await symlink(replaced, folder, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(transferDesignerHandoff(f.reference, f.context), /escape/);
    await rm(folder);
    await rename(replaced, folder);
    await assert.rejects(transferDesignerHandoff(f.reference, f.context, async (...args) => {
        await rename(folder, replaced);
        await mkdir(folder);
        await writeFile(join(folder, "handoff.json"), JSON.stringify(f.handoff));
        return open(...args);
    }), /directory changed|artifact changed/);
});

test("finalize requires install, successful reload, and a scripted verifier", async (t) => {
    const f = await fixture(t);
    assert.equal((await f.run(f.request("finalize-open"))).status, "failure");
    assert.deepEqual(f.calls, []);
    assert.equal((await f.run(f.request("install"))).status, "installed");
    const missing = createDesignerBootstrap({ ...f.deps, finalize: async () => ({
        stage: "manual-resolution", timings: { finalize: 1 }, warnings: [],
    }) });
    const result = await missing(f.request("finalize-open"));
    assert.equal(result.error.code, "designer_scripted_verifier_required");
    assert.doesNotMatch(JSON.stringify(result), /openInput/);
    assert.equal(f.calls.includes("open"), false);
    const invalid = createDesignerBootstrap({ ...f.deps, finalize: async () => ({
        stage: "ready", timings: {}, warnings: [], openInput: { ...f.input, timings: {} },
    }) });
    assert.match((await invalid(f.request("finalize-open"))).error.message, /unsupported property timings/);
    assert.equal(f.calls.includes("open"), false);
});

test("failed reload remains explicit and retryable without running finalize", async (t) => {
    const f = await fixture(t, { deps: { reloadSkills: async () => ({ errors: ["reload failed"], warnings: [] }) } });
    await f.run(f.request("install"));
    assert.equal((await f.run(f.request("finalize-open"))).error.code, "designer_skill_reload_failed");
    assert.deepEqual(f.calls, ["install"]);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.equal(record.skillsReloaded, false);
    assert.deepEqual(record.reload.errors, ["reload failed"]);
    assert.ok(f.errors.length);
});

test("reload timeout retries reuse the pending RPC and preserve its late result", async (t) => {
    const f = await fixture(t);
    let complete, reloads = 0;
    const run = createDesignerBootstrap({ ...f.deps, nativeTimeoutMs: 50,
        reloadSkills: () => {
            reloads++;
            return new Promise((resolve) => { complete = resolve; });
        },
    });
    await run(f.request("install"));
    assert.equal((await run(f.request("finalize-open"))).error.code, "designer_skill_reload_timeout");
    const pending = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.equal(pending.reloadPending, true);
    assert.equal(pending.skillsReloaded, false);
    assert.equal((await run(f.request("finalize-open"))).error.code, "designer_skill_reload_timeout");
    assert.equal((await run(f.request("install"))).error.code, "designer_skill_reload_pending");
    assert.equal(reloads, 1);
    assert.deepEqual(f.calls, ["install"]);
    complete({ errors: [], warnings: ["Late reload warning"] });
    const opened = await run(f.request("finalize-open"));
    assert.equal(opened.status, "shell-opened");
    assert.equal(opened.warningCount, 2);
    assert.equal(reloads, 1);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.equal(record.skillsReloaded, true);
    assert.equal(Object.hasOwn(record, "reloadPending"), false);
    assert.deepEqual(record.reload, { errors: [], warnings: ["Late reload warning"] });
});

test("a restarted provider cannot repeat or reset an unknown reload", async (t) => {
    const f = await fixture(t);
    let complete, reloads = 0;
    const run = createDesignerBootstrap({ ...f.deps, nativeTimeoutMs: 50,
        reloadSkills: () => {
            reloads++;
            return new Promise((resolve) => { complete = resolve; });
        },
    });
    await run(f.request("install"));
    assert.equal((await run(f.request("finalize-open"))).error.code, "designer_skill_reload_timeout");
    const restarted = createDesignerBootstrap({ ...f.deps, reloadSkills: async () => {
        reloads++;
        return { errors: [], warnings: [] };
    } });
    assert.equal((await restarted(f.request("finalize-open"))).error.code, "designer_skill_reload_unknown");
    assert.equal((await restarted(f.request("install"))).error.code, "designer_skill_reload_pending");
    assert.equal(reloads, 1);
    assert.deepEqual(f.calls, ["install"]);
    assert.equal((await readBootstrapRecord(f.context.root, f.handoff.handoffId)).reloadPending, true);
    complete({ errors: [], warnings: [] });
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
    assert.equal(reloads, 1);
});

test("late reload rejection is surfaced and permits a fresh explicit retry", async (t) => {
    const f = await fixture(t);
    let rejectReload, reloads = 0;
    const run = createDesignerBootstrap({ ...f.deps, nativeTimeoutMs: 50,
        reloadSkills: () => ++reloads === 1
            ? new Promise((_, reject) => { rejectReload = reject; })
            : Promise.resolve({ errors: [], warnings: [] }),
    });
    await run(f.request("install"));
    assert.equal((await run(f.request("finalize-open"))).error.code, "designer_skill_reload_timeout");
    rejectReload(new Error("Late host RPC failure"));
    const failure = await run(f.request("finalize-open"));
    assert.equal(failure.status, "failure");
    assert.match(failure.error.message, /Late host RPC failure/);
    assert.deepEqual(f.calls, ["install"]);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.equal(record.skillsReloaded, false);
    assert.equal(Object.hasOwn(record, "reloadPending"), false);
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
    assert.equal(reloads, 2);
});

test("pending reload records require an installed, not-yet-reloaded stage", async (t) => {
    const f = await fixture(t);
    await f.run(f.request("install"));
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.doesNotThrow(() => validateBootstrapRecord(record, f.reference));
    assert.doesNotThrow(() => validateBootstrapRecord({ ...record, reloadPending: true }, f.reference));
    for (const invalid of [
        { ...record, reloadPending: "true" },
        { ...record, reloadPending: false },
        { ...record, reloadPending: true, install: undefined },
        { ...record, reloadPending: true, skillsReloaded: true,
            reload: { errors: [], warnings: [] } },
    ]) {
        assert.throws(() => validateBootstrapRecord(invalid, f.reference),
            { code: "designer_bootstrap_record_invalid" });
    }
});

test("secondary logging failures cannot mask bootstrap failures or block retries", async (t) => {
    const logged = [];
    t.mock.method(console, "error", (...args) => logged.push(args));
    const f = await fixture(t);
    const logError = new Error("Session closed while logging");
    const run = createDesignerBootstrap({ ...f.deps,
        reloadSkills: async () => ({ errors: ["Host skill reload failed"], warnings: [] }),
        log: async () => { throw logError; },
    });
    const invalid = await run({ schemaVersion: 2 });
    assert.equal(invalid.status, "failure");
    assert.equal(invalid.error.code, "designer_bootstrap_request_failed");
    assert.doesNotThrow(() => validateBootstrapOutput(invalid));
    assert.equal((await run(f.request("install"))).status, "installed");
    const failure = await run(f.request("finalize-open"));
    assert.equal(failure.status, "failure");
    assert.equal(failure.error.code, "designer_skill_reload_failed");
    assert.match(failure.error.message, /Host skill reload failed/);
    assert.doesNotThrow(() => validateBootstrapOutput(failure));
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.deepEqual(record.reload.errors, ["Host skill reload failed"]);
    assert.deepEqual(record.error, failure.error);
    assert.equal(logged.length, 2);
    assert.match(logged[1][0], /Host skill reload failed/);
    assert.equal(logged[1][1], logError);
    assert.equal((await f.run(f.request("finalize-open"))).status, "shell-opened");
});

test("known native denials allow explicit retry without a second skills reload", async (t) => {
    const f = await fixture(t);
    let opens = 0;
    const run = createDesignerBootstrap({ ...f.deps, openCanvas: async (request) => {
        if (++opens === 1) return { resultType: "denied", error: "Permission denied", textResultForLlm: "" };
        return f.deps.openCanvas(request);
    } });
    await run(f.request("install"));
    assert.equal((await run(f.request("finalize-open"))).error.code, "designer_native_open_denied");
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
    assert.equal(f.calls.filter((call) => call === "reload").length, 1);
    assert.equal(opens, 2);
});

test("unknown native outcomes never automatically open twice and reconcile stable snapshots", async (t) => {
    const f = await fixture(t);
    let opens = 0;
    const run = createDesignerBootstrap({ ...f.deps, nativeTimeoutMs: 10,
        openCanvas: async () => { opens++; return new Promise(() => {}); } });
    await run(f.request("install"));
    assert.equal((await run(f.request("finalize-open"))).error.code, "designer_native_open_unknown");
    assert.equal((await run(f.request("finalize-open"))).error.code, "designer_native_open_unknown");
    assert.equal(opens, 1);
    f.setOpen([{ canvasId: DESIGNER_CANVAS, extensionId: DESIGNER_PROVIDER,
        instanceId: `designer-${f.handoff.handoffId}`, input: f.input }]);
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
    assert.equal(opens, 1);
});

test("success-shaped native replies require a complete matching host snapshot", async (t) => {
    const f = await fixture(t);
    await f.run(f.request("install"));
    for (const reply of [
        { resultType: "success", textResultForLlm: "truncated {" },
        { resultType: "success", textResultForLlm: JSON.stringify({
            canvasId: DESIGNER_CANVAS, extensionId: "another-provider",
            instanceId: `designer-${f.handoff.handoffId}`, input: f.input,
        }) },
    ]) {
        const run = createDesignerBootstrap({ ...f.deps, openCanvas: async () => reply });
        f.setOpen([]);
        const result = await run(f.request("finalize-open"));
        assert.equal(result.status, "failure");
        const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
        assert.deepEqual(record.nativeResult, reply);
        record.opening = false;
        await writeBootstrapRecord(f.context.root, f.handoff.handoffId, record);
    }
});

test("oversized native payloads are rejected before serialization and preserve failure diagnostics", async (t) => {
    const large = "x".repeat(DIAGNOSTIC_LIMIT + 1);
    for (const [name, reply] of [
        ["success text", { resultType: "success", textResultForLlm: large }],
        ["failure text", { resultType: "failure", textResultForLlm: large }],
        ["denial error", { resultType: "denied", textResultForLlm: "", error: large }],
        ["timeout metadata", { resultType: "timeout", textResultForLlm: "", sessionLog: large }],
        ["binary content", { resultType: "rejected", textResultForLlm: "",
            binaryResultsForLlm: [{ data: large, mimeType: "image/png" }] }],
        ["escaped text", { resultType: "success",
            textResultForLlm: "\u0000".repeat(Math.floor(DIAGNOSTIC_LIMIT / 6)) }],
    ]) {
        await t.test(name, async (t) => {
            const f = await fixture(t);
            const run = createDesignerBootstrap({ ...f.deps, openCanvas: async () => reply });
            await run(f.request("install"));
            const stringify = JSON.stringify;
            let serializedReply = false;
            t.mock.method(JSON, "stringify", (...args) => {
                if (args[0] === reply || args[0]?.nativeResult === reply) serializedReply = true;
                return stringify(...args);
            });
            const failure = await run(f.request("finalize-open"));
            assert.equal(failure.error.code, "designer_native_result_invalid");
            assert.doesNotMatch(failure.error.message, /diagnostics could not be saved/);
            assert.equal(serializedReply, false);
            const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
            assert.deepEqual(record.error, failure.error);
            assert.equal(Object.hasOwn(record, "nativeResult"), false);
            assert.equal(record.opening, true);
            assert.ok(Buffer.byteLength(stringify(record)) <= DIAGNOSTIC_LIMIT);
        });
    }
});

test("malformed native payloads cannot poison the persisted record", async (t) => {
    const circular = { resultType: "success", textResultForLlm: "{}" };
    circular.self = circular;
    for (const [name, reply] of [
        ["circular data", circular],
        ["non-JSON data", { resultType: "success", textResultForLlm: "{}", toolTelemetry: 1n }],
        ["invalid error", { resultType: "denied", textResultForLlm: "", error: {} }],
    ]) {
        await t.test(name, async (t) => {
            const f = await fixture(t);
            const run = createDesignerBootstrap({ ...f.deps, openCanvas: async () => reply });
            await run(f.request("install"));
            const failure = await run(f.request("finalize-open"));
            assert.equal(failure.error.code, "designer_native_result_invalid");
            assert.doesNotMatch(failure.error.message, /diagnostics could not be saved/);
            const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
            assert.deepEqual(record.error, failure.error);
            assert.equal(Object.hasOwn(record, "nativeResult"), false);
            assert.equal(record.opening, true);
        });
    }
});

test("a native result must fit the full record budget and leave room for failure details", async (t) => {
    const f = await fixture(t);
    const reply = { resultType: "success", textResultForLlm: "x".repeat(DIAGNOSTIC_LIMIT - 128) };
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) < DIAGNOSTIC_LIMIT);
    const run = createDesignerBootstrap({ ...f.deps, openCanvas: async () => reply });
    await run(f.request("install"));
    const failure = await run(f.request("finalize-open"));
    assert.equal(failure.error.code, "designer_diagnostic_limit");
    assert.doesNotMatch(failure.error.message, /diagnostics could not be saved/);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.deepEqual(record.error, failure.error);
    assert.equal(Object.hasOwn(record, "nativeResult"), false);
    assert.equal(record.opening, true);
    assert.ok(Buffer.byteLength(JSON.stringify(record)) <= DIAGNOSTIC_LIMIT);
    f.setOpen([{ canvasId: DESIGNER_CANVAS, extensionId: DESIGNER_PROVIDER,
        instanceId: `designer-${f.handoff.handoffId}`, input: f.input }]);
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
});

test("oversized host snapshots are not retained or allowed to clear the opening guard", async (t) => {
    const f = await fixture(t);
    const reply = { resultType: "success", textResultForLlm: "truncated display" };
    const run = createDesignerBootstrap({ ...f.deps, openCanvas: async (request) => {
        f.setOpen([{ ...request, title: "x".repeat(DIAGNOSTIC_LIMIT) }]);
        return reply;
    } });
    await run(f.request("install"));
    const failure = await run(f.request("finalize-open"));
    assert.equal(failure.error.code, "designer_diagnostic_limit");
    assert.doesNotMatch(failure.error.message, /diagnostics could not be saved/);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.deepEqual(record.error, failure.error);
    assert.deepEqual(record.nativeResult, reply);
    assert.equal(Object.hasOwn(record, "openSnapshot"), false);
    assert.equal(record.opening, true);
});

test("near-budget native denials retain full results and compact errors without blocking retry", async (t) => {
    const f = await fixture(t);
    let opens = 0;
    const run = createDesignerBootstrap({ ...f.deps, openCanvas: async (request) => {
        if (++opens !== 1) return f.deps.openCanvas(request);
        const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
        const reply = { resultType: "denied", textResultForLlm: "", error: "" };
        const overhead = Buffer.byteLength(JSON.stringify({ ...record, opening: false, nativeResult: reply }));
        reply.error = "x".repeat(DIAGNOSTIC_LIMIT - DIAGNOSTIC_ERROR_RESERVE - overhead);
        return reply;
    } });
    await run(f.request("install"));
    const failure = await run(f.request("finalize-open"));
    assert.equal(failure.error.code, "designer_native_open_denied");
    assert.equal(failure.error.message.length, 2048);
    assert.doesNotMatch(failure.error.message, /diagnostics could not be saved/);
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.deepEqual(record.error, failure.error);
    assert.ok(record.nativeResult.error.length > 15 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(record)) <= DIAGNOSTIC_LIMIT);
    assert.equal(record.opening, false);
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
    assert.equal(opens, 2);
});

test("valid native structured metadata remains complete in diagnostics", async (t) => {
    const f = await fixture(t);
    let reply;
    const run = createDesignerBootstrap({ ...f.deps, openCanvas: async (request) => {
        reply = { ...await f.deps.openCanvas(request), sessionLog: "Full native log",
            toolTelemetry: { timings: [1, 2], complete: true },
            contents: [{ type: "text", text: "Native content" }],
            binaryResultsForLlm: [{ data: "aGVsbG8=", mimeType: "text/plain" }] };
        return reply;
    } });
    await run(f.request("install"));
    assert.equal((await run(f.request("finalize-open"))).status, "shell-opened");
    const record = await readBootstrapRecord(f.context.root, f.handoff.handoffId);
    assert.deepEqual(record.nativeResult, reply);
});

test("incompatible native outcomes and mounted inputs cannot report shell-opened", async (t) => {
    for (const outcome of ["unknown", "mismatched"]) {
        const f = await fixture(t);
        const run = createDesignerBootstrap({ ...f.deps, openCanvas: async (request) => {
            await f.deps.openCanvas(request);
            if (outcome === "unknown") return { resultType: "unsupported", textResultForLlm: "{}" };
            f.setOpen([{ ...request, input: { ...f.input, templates: [{
                name: "unexpected", path: "C:\\other.mjs", sourceId: "project",
                kind: "generated.control-adapter", strategy: "replace",
            }] } }]);
            return { resultType: "success", textResultForLlm: JSON.stringify(request) };
        } });
        await run(f.request("install"));
        assert.equal((await run(f.request("finalize-open"))).status, "failure");
    }
});

test("concurrent stage invocations cannot duplicate active installs", async (t) => {
    let release;
    const f = await fixture(t, { deps: { install: async () => {
        await new Promise((resolve) => { release = resolve; });
        return { stage: "installed", timings: {}, warnings: [] };
    } } });
    const pending = f.run(f.request("install"));
    while (!release) await new Promise(setImmediate);
    assert.equal((await f.run(f.request("install"))).error.code, "designer_bootstrap_busy");
    release();
    assert.equal((await pending).status, "installed");
});

test("real Specify setup composes complete inventories through the staged bootstrap", {
    skip: process.env.SPECIFY_E2E !== "1",
}, async (t) => {
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url)).replace(/[\\/]$/, "");
    const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-canvas-design-test/", import.meta.url)).replace(/[\\/]$/, "");
    const f = await fixture(t, { local: {
        extensions: [{ id: "extension-canvas-design", path: source, source: "local", approved: true }],
        presets: [{ id: "copilot-canvas-design-test", path: preset, source: "local", approved: true }],
    } });
    let opened;
    const { installDesignerSetup, finalizeDesignerSetup } = await import("../server/designer-setup.mjs");
    const run = createDesignerBootstrap({ ...f.deps, install: installDesignerSetup, finalize: finalizeDesignerSetup,
        openCanvas: async (request) => {
            opened = request;
            f.setOpen([request]);
            return { resultType: "success", textResultForLlm: JSON.stringify(request) };
        } });
    const installed = await run(f.request("install"));
    assert.equal(installed.status, "installed", installed.error?.message);
    const reinstalled = await run(f.request("install"));
    assert.equal(reinstalled.status, "installed", reinstalled.error?.message);
    const result = await run(f.request("finalize-open"));
    assert.equal(result.status, "shell-opened", result.error?.message);
    assert.ok(opened.input.pages.some((page) => page.name === "canvas-settings-pr1-test"));
    assert.ok(opened.input.templates.some((entry) => entry.name === "generated-workflow"));
});

test("real Specify setup preserves pending outputs from the Wizard checkout", {
    skip: process.env.SPECIFY_E2E !== "1",
}, async (t) => {
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url)).replace(/[\\/]$/, "");
    const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-canvas-design-test/", import.meta.url)).replace(/[\\/]$/, "");
    const f = await fixture(t, { pending: true, separateSource: true, local: {
        extensions: [{ id: "extension-canvas-design", path: source, source: "local", approved: true }],
        presets: [{ id: "copilot-canvas-design-test", path: preset, source: "local", approved: true }],
    } });
    let opened;
    const { installDesignerSetup, finalizeDesignerSetup } = await import("../server/designer-setup.mjs");
    const run = createDesignerBootstrap({ ...f.deps, install: installDesignerSetup, finalize: finalizeDesignerSetup,
        openCanvas: async (request) => {
            opened = request;
            f.setOpen([request]);
            return { resultType: "success", textResultForLlm: JSON.stringify(request) };
        } });
    const installed = await run(f.request("install"));
    assert.equal(installed.status, "installed", installed.error?.message);
    const prepared = await run(f.request("outputs"));
    assert.equal(prepared.status, "outputs-required", prepared.error?.message);
    assert.match(prepared.outputs.prompt, /Write plan\.md in the feature directory/);
    const completed = await run({ ...f.request("outputs"), result: outputSubmission(f) });
    assert.equal(completed.status, "outputs-complete", completed.error?.message);
    const result = await run(f.request("finalize-open"));
    assert.equal(result.status, "shell-opened", result.error?.message);
    assert.ok(opened.input.pages.some((page) => page.name === "canvas-settings-pr1-test"));
    assert.deepEqual(initialOutputs(await readResolvedHandoff(f.context.root, f.handoff.handoffId)),
        { plan: { outputs: ["specs/<slug>/plan.md"], view: "specs/<slug>/plan.md" } });
});
