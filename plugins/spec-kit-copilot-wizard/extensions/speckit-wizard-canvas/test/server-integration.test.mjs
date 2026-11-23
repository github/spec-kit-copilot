import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { reviewHttpSecurityTests } from "./review-http-security-fixture.mjs";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, test } from "node:test";
import { allInstances, fsDeps, getInstance, setSession } from "../canvas-runtime/instances.mjs";
import { phaseActions } from "../canvas-runtime/actions/phase.mjs";
import { cancelBackgroundInference } from "../canvas-runtime/background-inference.mjs";
import {
    beginOutputInference,
    createOutputInferenceWorker,
    failOutputInference,
} from "../canvas-runtime/output-inference.mjs";
import { buildStateSnapshot } from "../canvas-runtime/snapshot-builder.mjs";
import {
    ACTION_KINDS,
    PHASE_BY_ID,
    PHASE_ORDER,
    SKILL_BY_KIND,
} from "../canvas-runtime/wizard-phases.mjs";
import { summarizeResults } from "../env/probe.mjs";
import { scanWorkspace } from "../project-scanner.mjs";
import { buildPrompt, buildWorkflowTrackingPreamble, phaseIdForCommandName } from "../prompts.mjs";
import { createHandler } from "../server.mjs";
import { formatReviewAnswers } from "../contracts/review-submission.mjs";
import { activeRunMatches, __resetRunTrackerForTests } from "../canvas-runtime/run-tracker.mjs";
import {
    commandRunMatches,
    __resetCommandRunsForTests,
} from "../canvas-runtime/command-run-tracker.mjs";
import {
    applyPatch,
    EXECUTION_STATES,
    normalizeExecutionReports,
    normalizeState,
    writeState,
} from "../state/store.mjs";

afterEach(() => {
    __resetRunTrackerForTests();
    __resetCommandRunsForTests();
    setSession(null);
    for (const timer of outputTimers.splice(0)) clearTimeout(timer);
});
const outputTimers = [];

reviewHttpSecurityTests("wizard");

describe("server", () => {
// Tests for server.mjs — createHandler with mock req/res + injected deps.
// No real socket, no real disk.

// --- Mock req/res factories -----------------------------------------------

function mockReq({ method = "GET", url = "/", headers = {}, body = null } = {}) {
    // We need an async iterable that yields Buffers.
    let iterable;
    if (typeof body === "string") {
        iterable = Readable.from([Buffer.from(body)]);
    } else if (Buffer.isBuffer(body)) {
        iterable = Readable.from([body]);
    } else if (body && Symbol.asyncIterator in body) {
        iterable = body;
    } else {
        iterable = Readable.from([]);
    }
    iterable.method = method;
    iterable.url = url;
    iterable.headers = headers;
    return iterable;
}

function mockRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.headersSent = false;
    res.body = "";
    res.chunks = [];
    res.writeHead = (code, headers) => {
        res.statusCode = code;
        res.headers = { ...res.headers, ...headers };
        res.headersSent = true;
    };
    res.setHeader = (name, value) => {
        res.headers[name] = value;
    };
    res.getHeader = (name) => res.headers[name];
    res.write = (chunk) => {
        res.chunks.push(chunk);
    };
    res.end = (chunk) => {
        if (chunk) res.body = String(chunk);
        else if (res.chunks.length) res.body = res.chunks.join("");
        res.ended = true;
        res.emit("close");
    };
    return res;
}

// --- Baseline deps --------------------------------------------------------

function baseDeps(overrides = {}) {
    const sessionCalls = [];
    const session = {
        send: async (msg) => { sessionCalls.push(msg); return { ok: true }; },
        log: async () => {},
    };
    // Wire the mock session into the module-scoped late-bound slot that
    // `dispatchPromptToSession` (canvas-runtime/dispatch.mjs) reads via
    // `sessionAdapter()`. In production this is set by extension.mjs once
    // `joinSession()` resolves; tests set it before invoking a handler.
    setSession(session);
    return {
        _sessionCalls: sessionCalls,
        session,
        log: async () => {},
        getState: async () => ({
            workspacePath: "/proj",
            currentPhase: "setup",
            setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
            preset: "core",
            phases: {},
            slug: null,
        }),
        getInstance: () => ({ workspacePath: "/proj", state: {} }),
        broadcast: () => {},
        registerSse: () => {},
        fs: {
            readFile: async () => "content",
            stat: async () => ({ isFile: () => true, size: 10 }),
        },
        uiDir: "/tmp/does-not-matter",
        token: "secret-token",
        ...overrides,
    };
}

// --- Tests ----------------------------------------------------------------

test("createHandler throws without token", () => {
    assert.throws(() => createHandler({}), /token/);
});

test("designer bundle inspection validates catalog identity and returns members without dispatch", async () => {
    const calls = [];
    const deps = baseDeps({
        getState: async () => ({ catalog: { bundles: [{ id: "design-kit", source: "community" }] } }),
        inspectBundle: async (id, cwd) => {
            calls.push({ id, cwd });
            return { source: "community", members: [{ kind: "presets", id: "design-style" }] };
        },
    });
    const handler = createHandler(deps);
    for (const query of ["id=bad%26command&source=community", "id=design-kit&source=copilot"]) {
        const res = mockRes();
        await handler(mockReq({ url: `/api/designer/bundle-members?token=secret-token&${query}` }), res);
        assert.ok(res.statusCode >= 400);
    }
    const res = mockRes();
    await handler(mockReq({
        url: "/api/designer/bundle-members?token=secret-token&id=design-kit&source=community",
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { members: [{ kind: "presets", id: "design-style" }] });
    assert.deepEqual(calls, [{ id: "design-kit", cwd: "/proj" }]);
    assert.deepEqual(deps._sessionCalls, []);
});

test("designer bundle inspection rejects mismatched CLI source explicitly", async () => {
    const handler = createHandler(baseDeps({
        getState: async () => ({ catalog: { bundles: [{ id: "design-kit", source: "copilot" }] } }),
        inspectBundle: async () => ({ source: "community", members: [] }),
    }));
    const res = mockRes();
    await handler(mockReq({
        url: "/api/designer/bundle-members?token=secret-token&id=design-kit&source=copilot",
    }), res);
    assert.equal(res.statusCode, 502);
    assert.match(JSON.parse(res.body).error, /different catalog/);
});

test("designer bundle inspection accepts a Default catalog bundle", async () => {
    const handler = createHandler(baseDeps({
        getState: async () => ({ catalog: { bundles: [{ id: "default-kit", source: "default" }] } }),
        inspectBundle: async () => ({ source: "default", members: [{ kind: "presets", id: "core-style" }] }),
    }));
    const res = mockRes();
    await handler(mockReq({
        url: "/api/designer/bundle-members?token=secret-token&id=default-kit&source=default",
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { members: [{ kind: "presets", id: "core-style" }] });
});

test("returns 401 when token is missing", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({ method: "GET", url: "/api/state" });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 401);
});

test("returns 401 when token is wrong", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({ method: "GET", url: "/api/state?token=nope" });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 401);
});

test("returns 200 + state JSON when token matches (via query)", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({ method: "GET", url: "/api/state?token=secret-token" });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.currentPhase, "setup");
});

test("returns 200 + state when token comes via X-Canvas-Token header", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({
        method: "GET",
        url: "/api/state",
        headers: { "x-canvas-token": "secret-token" },
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 200);
});

test("GET / sets a Set-Cookie header carrying the token", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({ method: "GET", url: "/?token=secret-token" });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 200);
    const setCookie = res.headers["Set-Cookie"];
    assert.ok(setCookie, "expected Set-Cookie header");
    assert.match(setCookie, /canvas_token=secret-token/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
});

test("POST /api/prompt with missing kind returns 400", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({
        method: "POST",
        url: "/api/prompt?token=secret-token",
        headers: {},
        body: JSON.stringify({ payload: {} }),
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 400);
});

test("POST /api/prompt with unknown kind returns 400", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({
        method: "POST",
        url: "/api/prompt?token=secret-token",
        body: JSON.stringify({ kind: "bogus.kind" }),
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 400);
});

test("POST /api/prompt with valid kind returns 202 and dispatches session.send", async () => {
    // Only assert the HTTP contract (202 accepted) and that session.send was
    // invoked. The specific prompt body content is exercised by the S3×S2
    // integration test which round-trips server → prompts → state-store.
    const deps = baseDeps();
    const h = createHandler(deps);
    const req = mockReq({
        method: "POST",
        url: "/api/prompt?token=secret-token",
        body: JSON.stringify({ kind: "constitution", payload: { principles: "x" } }),
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 202);
    await new Promise((r) => setImmediate(r));
    assert.equal(deps._sessionCalls.length, 1);
});

test("POST /api/prompt with malformed JSON returns 400", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({
        method: "POST",
        url: "/api/prompt?token=secret-token",
        body: "{ not json",
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 400);
});

test("POST /api/prompt over 256KB returns 413", async () => {
    const h = createHandler(baseDeps());
    // 300KB payload — over cap.
    const bigStr = "x".repeat(300 * 1024);
    const req = mockReq({
        method: "POST",
        url: "/api/prompt?token=secret-token",
        body: JSON.stringify({ kind: "constitution", payload: { big: bigStr } }),
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 413);
});

test("POST /api/phase/submit with unknown phase returns 400", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({
        method: "POST",
        url: "/api/phase/submit?token=secret-token",
        body: JSON.stringify({ phase: "bogus" }),
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 400);
});

test("POST /api/phase/submit rejects incomplete setup for both dispatch paths", async () => {
    const ready = { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true };
    for (const missing of Object.keys(ready)) {
        for (const body of [{ commandName: "speckit.constitution" }, { phase: "constitution" }]) {
            const deps = baseDeps({ getState: async () => ({ setup: { ...ready, [missing]: false } }) });
            const res = mockRes();
            await createHandler(deps)(mockReq({
                method: "POST",
                url: "/api/phase/submit?token=secret-token",
                body: JSON.stringify(body),
            }), res);
            assert.equal(res.statusCode, 409, `${missing}: ${JSON.stringify(body)}`);
            assert.match(JSON.parse(res.body).error, /Complete setup/);
            assert.deepEqual(deps._sessionCalls, []);
        }
    }
});

test("POST /api/phase/submit accepts live environment readiness and rejects unavailable review data", async () => {
    const deps = baseDeps({
        getState: async () => ({
            environment: { pluginInstalled: true, cliInstalled: true },
            projectInitialized: true,
            setup: { skillsReloaded: true },
        }),
    });
    const handler = createHandler(deps);
    for (const [body, expected] of [
        [{ phase: "constitution" }, 202],
        [{ commandName: "speckit.constitution", review: { contextId: "unavailable" } }, 409],
    ]) {
        const res = mockRes();
        await handler(mockReq({
            method: "POST",
            url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify(body),
        }), res);
        assert.equal(res.statusCode, expected, res.body);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deps._sessionCalls.length, 1);
});

test("review-bound submissions validate the source again after setup is checked", async () => {
    const calls = [];
    let failure;
    const reviewService = {
        async validateClarifications(...args) {
            calls.push(args);
            if (failure && calls.length === failure.call) {
                throw Object.assign(new Error("Review rejected"), { code: failure.code });
            }
        },
    };
    const deps = baseDeps({
        getInstance: () => ({ workspacePath: "/proj", state: {}, reviewService }),
    });
    const handler = createHandler(deps);
    const review = {
        contextId: "context", artifactId: "artifact", expectedRevision: "revision",
        answers: [{ questionId: "question", question: "Why?", answer: "Because" }],
    };
    async function submit() {
        const res = mockRes();
        await handler(mockReq({
            method: "POST",
            url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.constitution", args: formatReviewAnswers(review.answers), review }),
        }), res);
        return res;
    }

    assert.equal((await submit()).statusCode, 202);
    assert.deepEqual(calls, Array(2).fill([
        review.contextId, review.artifactId, review.expectedRevision, review.answers, "speckit.constitution",
    ]));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deps._sessionCalls.length, 1);

    for (const [code, call, expected] of [
        ["invalid_request", 1, 400], ["changed_source", 2, 409], ["read_failed", 1, 500],
    ]) {
        calls.length = 0;
        failure = { code, call };
        assert.equal((await submit()).statusCode, expected);
        assert.equal(calls.length, call);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(deps._sessionCalls.length, 1);
    }
});

test("review-bound submissions dispatch the validated answers and reject mismatched arguments", async () => {
    const review = {
        contextId: "context", artifactId: "artifact", expectedRevision: "revision",
        answers: [{ questionId: "question", question: "Why?", answer: "Because" }],
    };
    const service = { validateClarifications: async () => review.answers };
    const deps = baseDeps({ getInstance: () => ({ workspacePath: "/proj", state: {}, reviewService: service }) });
    const handler = createHandler(deps);
    for (const args of ["", "Clarification - Why?\nAnswer: Something else"]) {
        const res = mockRes();
        await handler(mockReq({ method: "POST", url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.constitution", args, review }) }), res);
        assert.equal(res.statusCode, 400, res.body);
        assert.match(JSON.parse(res.body).error, /validated clarification answers/);
    }
    const res = mockRes();
    const args = `Original guidance\n\n${formatReviewAnswers(review.answers)}`;
    await handler(mockReq({ method: "POST", url: "/api/phase/submit?token=secret-token",
        body: JSON.stringify({ commandName: "speckit.constitution", args, review }) }), res);
    assert.equal(res.statusCode, 202, res.body);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(deps._sessionCalls.length, 1);
    assert.ok(deps._sessionCalls[0].prompt.includes(args));
});

test("review-bound submissions reject a replaced review service", async () => {
    const inst = {
        workspacePath: "/proj", state: {},
        reviewService: { validateClarifications: async () => {} },
    };
    const deps = baseDeps({
        getInstance: () => inst,
        getState: async () => {
            inst.reviewService = { validateClarifications: async () => {} };
            return { setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true } };
        },
    });
    const res = mockRes();
    await createHandler(deps)(mockReq({
        method: "POST",
        url: "/api/phase/submit?token=secret-token",
        body: JSON.stringify({ commandName: "speckit.constitution", review: { contextId: "old" } }),
    }), res);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(deps._sessionCalls, []);
});

test("GET /api/artifact requires ?p=", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({ method: "GET", url: "/api/artifact?token=secret-token" });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 400);
});

test("GET /api/artifact rejects paths outside workspace", async () => {
    const h = createHandler(baseDeps());
    // Try to escape.
    const req = mockReq({ method: "GET", url: "/api/artifact?token=secret-token&p=..%2F..%2Fetc" });
    const res = mockRes();
    await h(req, res);
    // 403 (outside workspace) or 404 (not found).
    assert.ok([403, 404].includes(res.statusCode));
});

test("Unknown API path returns 404", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({ method: "GET", url: "/api/bogus?token=secret-token" });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 404);
});

// -------- v2: workflow-command submit --------
//
// The prompt-body contents for /api/phase/submit (slash-command form,
// setPhaseStatus tracking preamble, extension-vs-canonical branching) are
// exercised end-to-end by the S3×S2 integration test. Here we keep only
// the HTTP boundary contract: reject invalid inputs, return 202 on valid.

test("POST /api/phase/submit rejects invalid commandName", async () => {
    const h = createHandler(baseDeps());
    const req = mockReq({
        method: "POST",
        url: "/api/phase/submit?token=secret-token",
        body: JSON.stringify({ commandName: "rogue.thing", args: "" }),
    });
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 400);
});

// --- /api/artifact-targets tests ------------------------------------------

function tmpWorkspace() {
    const dir = mkdtempSync(join(tmpdir(), "wiz-at-"));
    return dir;
}

function artifactDeps(workspacePath) {
    const inst = { workspacePath, state: {}, url: "http://127.0.0.1:1234",
        token: "secret-token", broadcast() {} };
    const requests = [{ commandId: "speckit.plan", fingerprint: "a".repeat(64) }];
    const inference = beginOutputInference(inst, requests);
    const { worker, endpoint } = createOutputInferenceWorker(inst, inference, requests);
    outputTimers.push(inst.outputInference.timer);
    return { ...baseDeps({ getInstance: () => inst }),
        artifactEndpoint: endpoint.pathname + endpoint.search,
        artifactWorker: worker.id };
}

// NOTE: The "writes a fresh cache with valid entries" happy path is
// exercised end-to-end by the S5 artifact-targets round-trip integration
// test (server-write → scanner-read). Below we keep only the negative and
// merge branches (paths integration doesn't cover).

test("POST /api/artifact-targets: merges into an existing cache without clobbering unrelated keys", async () => {
    const ws = tmpWorkspace();
    try {
        // Pre-seed a cache with one entry.
        mkdirSync(join(ws, ".speckit-wizard"), { recursive: true });
        writeFileSync(
            join(ws, ".speckit-wizard", "artifact-targets.json"),
            JSON.stringify({
                version: 1,
                entries: {
                    "commands/old.one": { writesTo: ".specify/old.md", source: "manual" },
                },
            }),
        );
        const deps = artifactDeps(ws);
        const h = createHandler(deps);
        const body = JSON.stringify({
            entries: {
                "commands/plan": { writesTo: ".specify/new.md", source: "llm" },
            },
        });
        const req = mockReq({
            method: "POST",
            url: deps.artifactEndpoint,
            headers: { "content-type": "application/json" },
            body,
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 200, res.body);
        const parsed = JSON.parse(readFileSync(join(ws, ".speckit-wizard", "artifact-targets.json"), "utf8"));
        assert.equal(parsed.entries["commands/old.one"].writesTo, ".specify/old.md");
        assert.equal(parsed.entries["commands/plan"].writesTo, ".specify/new.md");
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/artifact-targets: drops non-command keys and keeps the assigned command", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = artifactDeps(ws);
        const h = createHandler(deps);
        const body = JSON.stringify({
            entries: {
                "templates/foo": { writesTo: ".specify/skip.md" }, // wrong prefix
                "commands/plan": { writesTo: ".specify/keep.md" },
            },
        });
        const req = mockReq({
            method: "POST",
            url: deps.artifactEndpoint,
            headers: { "content-type": "application/json" },
            body,
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 200);
        const parsed = JSON.parse(readFileSync(join(ws, ".speckit-wizard", "artifact-targets.json"), "utf8"));
        assert.deepEqual(Object.keys(parsed.entries), ["commands/plan"]);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/artifact-targets: rejects when no valid entries remain", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = artifactDeps(ws);
        const h = createHandler(deps);
        const body = JSON.stringify({ entries: { "templates/x": { writesTo: "y" } } });
        const req = mockReq({
            method: "POST",
            url: deps.artifactEndpoint,
            headers: { "content-type": "application/json" },
            body,
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 400);
        assert.ok(!existsSync(join(ws, ".speckit-wizard", "artifact-targets.json")));
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/artifact-targets: rejects missing entries object", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = artifactDeps(ws);
        const h = createHandler(deps);
        const req = mockReq({
            method: "POST",
            url: deps.artifactEndpoint,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 400);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("HTTP artifact replies require the originating endpoint runId before any cache mutation", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = artifactDeps(ws);
        const inst = deps.getInstance();
        const oldUrl = deps.artifactEndpoint;
        beginOutputInference(inst, [{ commandId: "speckit.plan", fingerprint: "a".repeat(64) }],
            inst.refreshStatus);
        const previousWorker = deps.artifactWorker;
        failOutputInference(inst, inst.outputInference, previousWorker);
        const requests = [{ commandId: "speckit.plan", fingerprint: "a".repeat(64) }];
        const current = beginOutputInference(inst, requests);
        const { worker, endpoint } = createOutputInferenceWorker(inst, current, requests);
        const currentUrl = endpoint.pathname + endpoint.search;
        outputTimers.push(current.timer);
        const handler = createHandler(deps);
        for (const [url, status] of [
            ["/api/artifact-targets?token=secret-token", 400],
            ["/api/artifact-targets?token=secret-token&runId=bad", 400],
            [oldUrl, 409],
        ]) {
            const res = mockRes();
            await handler(mockReq({ method: "POST", url,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ entries: { "commands/speckit.plan": { writesTo: "specs/<slug>/plan.md" } } }),
            }), res);
            assert.equal(res.statusCode, status);
            assert.match(JSON.parse(res.body).error, /runId/);
            assert.equal(inst.outputInference, current);
            assert.equal(current.status, "updating");
            assert.equal(current.pending.size, 1);
            assert.equal(current.timer._destroyed, false);
            assert.ok(!existsSync(join(ws, ".speckit-wizard", "artifact-targets.json")));
        }
        assert.notEqual(currentUrl, oldUrl);
        assert.equal(worker.id, new URL(currentUrl, "http://localhost").searchParams.get("runId"));
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});
});

describe("integration-http", () => {
// HTTP → prompt → state-store, and HTTP → disk → scanner round-trips.
//
// These wire the real server, the real prompt builder, the real state
// store, and the real scanner together. A failure means the wire format
// truly drifted (S3×S2 or S5), not a copy change.



// --- Mock req/res (same shape as server.test.mjs) --------------------------

function mockReq({ method = "GET", url = "/", headers = {}, body = null } = {}) {
    let iterable;
    if (typeof body === "string") iterable = Readable.from([Buffer.from(body)]);
    else if (Buffer.isBuffer(body)) iterable = Readable.from([body]);
    else iterable = Readable.from([]);
    iterable.method = method;
    iterable.url = url;
    iterable.headers = headers;
    return iterable;
}
function mockRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.headersSent = false;
    res.body = "";
    res.chunks = [];
    res.writeHead = (code, headers) => {
        res.statusCode = code;
        res.headers = { ...res.headers, ...headers };
        res.headersSent = true;
    };
    res.setHeader = (n, v) => { res.headers[n] = v; };
    res.getHeader = (n) => res.headers[n];
    res.write = (chunk) => { res.chunks.push(chunk); };
    res.end = (chunk) => {
        if (chunk) res.body = String(chunk);
        else if (res.chunks.length) res.body = res.chunks.join("");
        res.ended = true;
        res.emit("close");
    };
    return res;
}

function tmpWorkspace() {
    return mkdtempSync(join(tmpdir(), "speckit-integ-"));
}

function baseDeps({ workspacePath, extras = {} } = {}) {
    const sessionCalls = [];
    const session = {
        send: async (msg) => { sessionCalls.push(msg); return { ok: true }; },
        log: async () => {},
    };
    // Wire the mock session into the module-scoped late-bound slot that
    // `dispatchPromptToSession` reads via `sessionAdapter()`.
    setSession(session);
    return {
        _sessionCalls: sessionCalls,
        session,
        log: async () => {},
        getState: async () => ({
            workspacePath, currentPhase: "setup",
            setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
            preset: "core", phases: {}, slug: null,
        }),
        getInstance: () => ({ instanceId: "test-instance", workspacePath, state: {} }),
        broadcast: () => {},
        registerSse: () => {},
        fs: { readFile: async () => "", stat: async () => ({ isFile: () => true, size: 0 }) },
        uiDir: "/tmp/does-not-matter",
        token: "secret-token",
        ...extras,
    };
}

// -------- S3×S2: HTTP submit → prompt → setPhaseStatus JSON → state -------

test("S3×S2: canonical phase submit yields a prompt whose setPhaseStatus write survives applyPatch", async () => {
    // Wire contract: server → prompt builder → agent → state-store.
    // The agent's job is to `setPhaseStatus({ phase: X, status: "done",
    // artifactPath: Y })`. If we can't extract that call from the prompt
    // and feed it through applyPatch, the wizard's whole tracking loop is
    // broken.
    const ws = tmpWorkspace();
    try {
        const deps = baseDeps({ workspacePath: ws });
        const h = createHandler(deps);
        const req = mockReq({
            method: "POST",
            url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.constitution", args: "principles..." }),
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 202, res.body);
        // setImmediate deferred dispatch — flush.
        await new Promise((r) => setImmediate(r));
        assert.equal(deps._sessionCalls.length, 1, "one session.send expected");
        const prompt = deps._sessionCalls[0].prompt;

        // Every canonical dispatch must begin with the slash command.
        assert.ok(prompt.startsWith("/speckit-constitution"), `prompt must lead with slash: ${prompt.slice(0, 60)}`);
        assert.match(prompt, /reportCommandComplete\(/,
            "Run prompt must request output inference only after command completion");

        // Extract the setPhaseStatus({...}) invocation and parse fields
        // by name — resilient to reordering / whitespace / new fields.
        const setCallMatch = prompt.match(/setPhaseStatus\(\{([^}]+)\}\)/);
        assert.ok(setCallMatch, "prompt must ask the agent to call setPhaseStatus");
        const argBody = setCallMatch[1];
        const phaseM = argBody.match(/phase:\s*"([^"]+)"/);
        const statusM = argBody.match(/status:\s*"([^"]+)"/);
        const runIdM = argBody.match(/runId:\s*"([^"]+)"/);
        assert.ok(phaseM, "setPhaseStatus arg must include phase field");
        assert.ok(statusM, "setPhaseStatus arg must include status field");
        assert.ok(runIdM, "setPhaseStatus arg must include runId field");

        // Feed the extracted arg through applyPatch — the agent will call
        // setPhaseStatus which the wizard's canvas action wires to
        // applyPatch. This test proves the extracted values reach state.
        const before = normalizeState({});
        const after = applyPatch(before, { phases: { [phaseM[1]]: { status: statusM[1] } } });
        assert.equal(after.phases[phaseM[1]].status, statusM[1]);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/phase/submit acknowledges before session.send completion and clears failed tracked runs", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = baseDeps({
            workspacePath: ws,
            extras: {
                session: {
                    send: async () => { throw new Error("session disconnected"); },
                    log: async () => {},
                },
                getInstance: () => ({ instanceId: "inst-fail", workspacePath: ws, state: {} }),
            },
        });
        setSession(deps.session);
        const h = createHandler(deps);
        const req = mockReq({
            method: "POST",
            url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.constitution", args: "principles..." }),
        });
        const res = mockRes();
        await h(req, res);

        assert.equal(res.statusCode, 202, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.queued, true);
        assert.equal(activeRunMatches("inst-fail", "speckit.constitution", body.runId), true);
        assert.equal(commandRunMatches("inst-fail", "speckit.constitution", body.runId), true);

        await new Promise((r) => setImmediate(r));
        assert.equal(activeRunMatches("inst-fail", "speckit.constitution", body.runId), false);
        assert.equal(commandRunMatches("inst-fail", "speckit.constitution", body.runId), false);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/phase/submit rejects invalid clarification batches before dispatch", async () => {
    const ws = tmpWorkspace();
    try {
        const invalid = Object.assign(new Error("batch too large"), { code: "invalid_request" });
        const deps = baseDeps({
            workspacePath: ws,
            extras: { getInstance: () => ({ instanceId: "inst-review", workspacePath: ws, state: {},
                reviewService: { validateClarifications: async () => { throw invalid; } } }) },
        });
        const h = createHandler(deps);
        const res = mockRes();
        await h(mockReq({
            method: "POST", url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.specify", args: "answer",
                review: { contextId: "ctx_fixture", artifactId: "artifact_fixture",
                    expectedRevision: `sha256:${"a".repeat(64)}`, answers: [] } }),
        }), res);
        assert.equal(res.statusCode, 400);
        assert.match(JSON.parse(res.body).error, /invalid|limit/i);
        assert.equal(deps._sessionCalls.length, 0);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/phase/submit rejects reviewed clarification rerun when setup is incomplete", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = baseDeps({
            workspacePath: ws,
            extras: { getState: async () => ({
                workspacePath: ws,
                currentPhase: "specify",
                setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: false },
                preset: "core",
                phases: {},
                slug: "001-fixture",
            }),
            getInstance: () => ({ instanceId: "inst-review-gated", workspacePath: ws, state: {},
                reviewService: { validateClarifications: async () => [{ questionId: "question_scope" }] } }) },
        });
        const h = createHandler(deps);
        const res = mockRes();
        await h(mockReq({
            method: "POST", url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.specify", args: "answer",
                review: { contextId: "ctx_fixture", artifactId: "artifact_fixture",
                    expectedRevision: `sha256:${"a".repeat(64)}`, answers: [{ questionId: "question_scope", question: "Which scope?", answer: "Scoped" }] } }),
        }), res);
        assert.equal(res.statusCode, 409);
        assert.match(JSON.parse(res.body).error, /setup/i);
        assert.equal(deps._sessionCalls.length, 0);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/phase/submit gates legacy clarification and phase submissions on setup", async () => {
    const ws = tmpWorkspace();
    let setupReady = false;
    try {
        const deps = baseDeps({ workspacePath: ws, extras: {
            getState: async () => ({ workspacePath: ws, setup: {
                pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: setupReady,
            } }),
        } });
        const handler = createHandler(deps);
        const submissions = [
            { commandName: "speckit.plan", args: "Clarification - Which scope?\nAnswer: Only this feature." },
            { phase: "plan", values: { answer: "Only this feature." } },
        ];
        for (const body of submissions) {
            const res = mockRes();
            await handler(mockReq({ method: "POST", url: "/api/phase/submit?token=secret-token", body: JSON.stringify(body) }), res);
            assert.equal(res.statusCode, 409, res.body);
            assert.match(JSON.parse(res.body).error, /setup/i);
        }
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(deps._sessionCalls.length, 0);
        setupReady = true;
        for (const body of submissions) {
            const res = mockRes();
            await handler(mockReq({ method: "POST", url: "/api/phase/submit?token=secret-token", body: JSON.stringify(body) }), res);
            assert.equal(res.statusCode, 202, res.body);
        }
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(deps._sessionCalls.length, submissions.length);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/phase/submit rechecks setup after asynchronous clarification validation", async () => {
    const ws = tmpWorkspace();
    let setupReady = true;
    try {
        const deps = baseDeps({ workspacePath: ws, extras: {
            getState: async () => ({ workspacePath: ws, setup: {
                pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: setupReady,
            } }),
            getInstance: () => ({ instanceId: "inst-review-setup-changed", workspacePath: ws, state: {},
                reviewService: { validateClarifications: async () => {
                    await Promise.resolve();
                    setupReady = false;
                    return [{ questionId: "question_scope" }];
                } } }),
        } });
        const handler = createHandler(deps);
        const res = mockRes();
        await handler(mockReq({
            method: "POST", url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.specify", args: "answer", review: {
                contextId: "ctx_fixture", artifactId: "artifact_fixture", expectedRevision: `sha256:${"a".repeat(64)}`,
                answers: [{ questionId: "question_scope", question: "Which scope?", answer: "Only this feature." }],
            } }),
        }), res);
        assert.equal(res.statusCode, 409, res.body);
        assert.match(JSON.parse(res.body).error, /setup/i);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(deps._sessionCalls.length, 0);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/phase/submit revalidates the artifact after the awaited state scan", async () => {
    const { createWizardReviewService } = await import("../server/artifact-review.mjs");
    const ws = tmpWorkspace();
    const artifactPath = "specs/001-review-race/spec.md";
    mkdirSync(join(ws, "specs", "001-review-race"), { recursive: true });
    writeFileSync(join(ws, artifactPath), "# Scope\n\n[NEEDS CLARIFICATION: Which scope?]\n");
    const snapshot = {
        workspacePath: ws, slug: "001-review-race", currentPhase: "specify",
        phases: { specify: { artifactPath } }, commands: [], composition: { artifacts: [] },
        setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
    };
    const service = createWizardReviewService({ workspacePath: ws, instanceId: "inst-review-race", getState: async () => snapshot });
    try {
        const opened = await service.open({ stage: "specify" });
        const document = await service.content(opened.contextId, opened.primaryArtifactId);
        const question = document.clarifications[0];
        const deps = baseDeps({ workspacePath: ws, extras: {
            getState: async () => {
                await Promise.resolve();
                writeFileSync(join(ws, artifactPath), "# Changed scope\n\n[NEEDS CLARIFICATION: New question?]\n");
                return snapshot;
            },
            getInstance: () => ({ instanceId: "inst-review-race", workspacePath: ws, state: snapshot, reviewService: service }),
        } });
        const handler = createHandler(deps);
        const res = mockRes();
        await handler(mockReq({
            method: "POST", url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.specify", args: "answer", review: {
                contextId: opened.contextId, artifactId: opened.primaryArtifactId, expectedRevision: document.revision,
                answers: [{ questionId: question.questionId, question: question.question, answer: "Only this feature." }],
            } }),
        }), res);
        assert.equal(res.statusCode, 409, res.body);
        assert.match(JSON.parse(res.body).error, /source changed/i);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(deps._sessionCalls.length, 0);
    } finally {
        service.dispose();
        rmSync(ws, { recursive: true, force: true });
    }
});

test("S3×S2: extension-namespaced commands get completion tracking without phase-status calls", async () => {
    // Extension commands aren't tracked by the wizard's canonical stepper;
    // Phase-status and witness reporting target canonical phases only. The
    // completion callback is generic and lets extension outputs be inferred.
    const ws = tmpWorkspace();
    try {
        const deps = baseDeps({ workspacePath: ws });
        const h = createHandler(deps);
        const req = mockReq({
            method: "POST",
            url: "/api/phase/submit?token=secret-token",
            body: JSON.stringify({ commandName: "speckit.assess.intake", args: "" }),
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 202);
        assert.equal(JSON.parse(res.body).untracked, true);
        await new Promise((r) => setImmediate(r));
        const prompt = deps._sessionCalls[0].prompt;
        assert.ok(prompt.startsWith("/speckit-assess-intake"), "dispatch must slash-normalize");
        assert.match(prompt, /Invoke the `skill` tool with name `speckit-assess-intake`/,
            "extension prompt must explicitly invoke its mapped skill");
        assert.match(prompt, /reportCommandComplete\(/,
            "extension prompt must request command completion");
        assert.equal(
            /setPhaseStatus/.test(prompt),
            false,
            "extension commands must not embed setPhaseStatus (would target a non-existent phase id)",
        );
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

async function withAliasRun(callback) {
    const ws = tmpWorkspace();
    const instanceId = `alias-${randomUUID()}`;
    const inst = getInstance(instanceId);
    const prompts = [];
    const background = [];
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const extensionCommand = "speckit.extension-wizard-flow-test.review";
    try {
        mkdirSync(join(ws, ".specify"), { recursive: true });
        for (const skill of ["speckit-plan", "speckit-tasks", "speckit-extension-wizard-flow-test-review"]) {
            const dir = join(ws, ".github", "skills", skill);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, "SKILL.md"), `---\nname: ${skill}\n---\nWrite an output.\n`);
        }
        inst.workspacePath = ws;
        inst.url = "http://127.0.0.1:1234";
        inst.token = "alias-token";
        inst.state = {
            currentPhase: "plan",
            setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true },
            pipeline: [{ id: "plan" }, { id: "tasks" }, { id: extensionCommand }],
            phases: {},
        };
        inst.cachedComposition = { presets: [], extensions: [], artifacts: [] };
        await writeState(ws, inst.state, fsDeps);
        const session = {
            send: async ({ prompt }) => { prompts.push(prompt); },
            log: async () => {},
            rpc: { tasks: {
                startAgent: async ({ prompt }) => {
                    background.push(prompt);
                    markStarted();
                    return { agentId: "alias-inference" };
                },
                cancel: async () => ({ cancelled: true }),
            } },
        };
        const deps = baseDeps({ workspacePath: ws, extras: { getInstance: () => inst, session } });
        setSession(session);
        const handler = createHandler(deps);
        const submit = async (commandName) => {
            const res = mockRes();
            await handler(mockReq({
                method: "POST",
                url: "/api/phase/submit?token=secret-token",
                body: JSON.stringify({ commandName }),
            }), res);
            assert.equal(res.statusCode, 202, res.body);
            await new Promise((resolve) => setImmediate(resolve));
            const prompt = prompts.at(-1);
            const completion = prompt.match(/reportCommandComplete\(\{ commandId: "([^"]+)", runId: "([^"]+)", status/);
            assert.ok(completion, prompt);
            return { response: JSON.parse(res.body), prompt, completion: {
                commandId: completion[1], runId: completion[2], status: "done",
            } };
        };
        await callback({ inst, instanceId, submit, background, started, extensionCommand });
    } finally {
        cancelBackgroundInference(inst);
        if (inst.outputInference?.timer) clearTimeout(inst.outputInference.timer);
        allInstances().delete(instanceId);
        rmSync(ws, { recursive: true, force: true });
    }
}

for (const [alias, expectedCommand, expectedCallback] of [
    ["speckit.plan", "plan", "speckit-plan"],
    ["speckit-plan", "plan", "speckit-plan"],
    ["/speckit-plan", "plan", "speckit-plan"],
    ["speckit-extension-wizard-flow-test-review",
        "speckit.extension-wizard-flow-test.review", "speckit-extension-wizard-flow-test-review"],
]) {
    test(`tracked dispatch completes and infers only ${alias}`, { timeout: 15000 }, async () => {
        await withAliasRun(async ({ inst, instanceId, submit, background, started }) => {
            const { response, prompt, completion } = await submit(alias);
            assert.equal(completion.commandId, expectedCallback);
            assert.equal(background.length, 0);
            if (response.tracked) {
                assert.match(prompt, /- templates: \["plan-template"\]/);
                const status = await phaseActions.find((action) => action.name === "setPhaseStatus")
                    .handler({ instanceId, input: { phase: "plan", status: "done", runId: response.runId } });
                assert.deepEqual(status, { ok: true });
                const report = await phaseActions.find((action) => action.name === "reportExecution")
                    .handler({ instanceId, input: {
                        phase: "plan", runId: response.runId,
                        artifacts: { templates: {}, scripts: {}, hooks: {} },
                    } });
                assert.deepEqual(report, { ok: true, merged: 1 });
                assert.equal(background.length, 0);
            }
            const result = await phaseActions.find((action) => action.name === "reportCommandComplete")
                .handler({ instanceId, input: completion });
            assert.deepEqual(result, { ok: true, queued: true });
            await started;
            const [worker] = inst.outputInference.workers.values();
            assert.deepEqual([...worker.requests.keys()], [expectedCommand]);
            assert.equal(background.length, 1);
        });
    });
}

test("tracked rerun under another alias rejects the earlier completion", { timeout: 15000 }, async () => {
    await withAliasRun(async ({ inst, instanceId, submit, background, started }) => {
        const first = await submit("speckit.plan");
        const latest = await submit("/speckit-plan");
        const complete = phaseActions.find((action) => action.name === "reportCommandComplete");
        assert.deepEqual(await complete.handler({ instanceId, input: first.completion }),
            { ok: false, error: "stale command run" });
        assert.equal(background.length, 0);
        assert.deepEqual(await complete.handler({ instanceId, input: latest.completion }),
            { ok: true, queued: true });
        await started;
        const [worker] = inst.outputInference.workers.values();
        assert.deepEqual([...worker.requests.keys()], ["plan"]);
    });
});

// -------- S5: server writes artifact-targets → scanner reads it -----------

test("S5: artifact-targets round-trip — POST writes cache, scanner surfaces artifactPath on phase slice", async () => {
    // The wire between server (writer) and scanner (reader) is one JSON
    // file on disk. Any drift in shape breaks the "Writes to" pill on
    // extension phase cards. This test proves that whatever the server
    // writes, the scanner reads.
    const ws = tmpWorkspace();
    try {
        // Install a matching extension command file so the scanner's
        // orphan-prune pass keeps the entry.
        mkdirSync(join(ws, ".specify", "extensions", "assess", "commands"), { recursive: true });
        writeFileSync(
            join(ws, ".specify", "extensions", "assess", "commands", "speckit.assess.intake.md"),
            "# intake skill\n",
        );

        // POST via real server handler.
        const deps = baseDeps({ workspacePath: ws });
        const inst = { workspacePath: ws, state: {}, url: "http://127.0.0.1:1234",
            token: "secret-token", broadcast() {} };
        const requests = [{ commandId: "speckit.assess.intake", fingerprint: "a".repeat(64) }];
        const inference = beginOutputInference(inst, requests);
        const { endpoint } = createOutputInferenceWorker(inst, inference, requests);
        outputTimers.push(inst.outputInference.timer);
        deps.getInstance = () => inst;
        const h = createHandler(deps);
        const body = JSON.stringify({
            entries: {
                "commands/speckit.assess.intake": {
                    writesTo: ".specify/assessments/<slug>/intake.md",
                    description: "Draft an intake note",
                    source: "llm",
                },
            },
        });
        const req = mockReq({
            method: "POST",
            url: endpoint.pathname + endpoint.search,
            headers: { "content-type": "application/json" },
            body,
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 200, res.body);

        // Read via real scanner (real fs facade to keep this a genuine
        // round-trip; we use node:fs/promises).
        const fsp = await import("node:fs/promises");
        const scannerDeps = {
            pathExists: async (p) => { try { await fsp.access(p); return true; } catch { return false; } },
            readFile: (p) => fsp.readFile(p, "utf8"),
            stat: (p) => fsp.stat(p),
            readdir: (p, opts) => fsp.readdir(p, opts),
        };
        const scan = await scanWorkspace(ws, scannerDeps);
        const slice = scan.phases["commands/speckit.assess.intake"];
        assert.ok(slice, "scanner must surface a phase slice for the posted entry");
        // No specs/<slug>/ folder present, so the template stays literal.
        assert.equal(
            slice.artifactPath,
            ".specify/assessments/<slug>/intake.md",
            "writesTo written by server must be visible as artifactPath on the scanned phase",
        );
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});
});

describe("integration-scan-snapshot", () => {
// Scanner ⇄ preset-loader ⇄ renderer.buildStateSnapshot integration.
// Also: env-probe → state-store setup slice.



// --- helpers --------------------------------------------------------------

async function realFsDeps() {
    const fsp = await import("node:fs/promises");
    return {
        pathExists: async (p) => { try { await fsp.access(p); return true; } catch { return false; } },
        readFile: (p) => fsp.readFile(p, "utf8"),
        stat: (p) => fsp.stat(p),
        readdir: (p, opts) => fsp.readdir(p, opts),
    };
}

function tmpWs() { return mkdtempSync(join(tmpdir(), "speckit-scan-")); }

// -------- S6: preset-loader → scanner.phaseGraph ordering -----------------

test("S6: .specify/presets/.registry order flows through preset-loader into scanner.phaseGraph", async () => {
    // The registry declares which presets are installed. loadPresetGraph
    // parses the registry, resolves each preset's commands, and hands the
    // result to the scanner as scan.phaseGraph. If installed presets don't
    // survive that pipeline, the phase list is rendered from the wrong
    // command set. Precedence/winner selection is the CLI's job, not the
    // loader's — so we only assert reachability + merge here.
    const ws = tmpWs();
    try {
        mkdirSync(join(ws, ".specify", "presets", "alpha", "commands"), { recursive: true });
        mkdirSync(join(ws, ".specify", "presets", "beta", "commands"), { recursive: true });
        writeFileSync(
            join(ws, ".specify", "presets", ".registry"),
            JSON.stringify([
                { id: "alpha", priority: 100, enabled: true },
                { id: "beta", priority: 50, enabled: true },
            ]),
        );
        writeFileSync(
            join(ws, ".specify", "presets", "alpha", "preset.yml"),
            [
                "preset:",
                "  name: Alpha",
                "  version: 1.0.0",
                "provides:",
                "  templates:",
                "    - type: command",
                "      name: speckit.a1",
                "      file: commands/a1.md",
                "",
            ].join("\n"),
        );
        writeFileSync(
            join(ws, ".specify", "presets", "alpha", "commands", "a1.md"),
            "---\nhandoffs: []\n---\n# A1\n",
        );
        writeFileSync(
            join(ws, ".specify", "presets", "beta", "preset.yml"),
            [
                "preset:",
                "  name: Beta",
                "  version: 1.0.0",
                "provides:",
                "  templates:",
                "    - type: command",
                "      name: speckit.b1",
                "      file: commands/b1.md",
                "",
            ].join("\n"),
        );
        writeFileSync(
            join(ws, ".specify", "presets", "beta", "commands", "b1.md"),
            "---\nhandoffs: []\n---\n# B1\n",
        );

        const scan = await scanWorkspace(ws, await realFsDeps());
        // No scan failure warnings from the loader — otherwise loader failed
        // and we're testing the fallback path, not the real integration.
        assert.equal(
            scan.warnings.filter((w) => w.includes("loadPresetGraph failed")).length,
            0,
            `preset loader failed: ${scan.warnings.join(" | ")}`,
        );
        // The registry-declared presets must reach scan.phaseGraph.presets.
        const presetIds = scan.phaseGraph.presets.map((p) => p.id);
        assert.ok(presetIds.includes("alpha"), `phaseGraph.presets missing 'alpha': ${presetIds.join(",")}`);
        assert.ok(presetIds.includes("beta"), `phaseGraph.presets missing 'beta': ${presetIds.join(",")}`);
        // The commands sourced from each preset must appear in the merged
        // command graph.
        const commandNames = scan.phaseGraph.commands.map((c) => c.name);
        assert.ok(commandNames.includes("speckit.a1"), `command 'speckit.a1' missing: ${commandNames.join(",")}`);
        assert.ok(commandNames.includes("speckit.b1"), `command 'speckit.b1' missing: ${commandNames.join(",")}`);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

// -------- S7: scanner → buildStateSnapshot lock/gate ----------------------

test("S7: buildStateSnapshot derives per-phase locked from durable setup completion", async () => {
    // The snapshot's lock/gate flags drive the UI's greyed-out state.
    // We assert only the JS-visible fields, never HTML — that keeps this
    // test resilient to renderer refactors while catching the actual
    // derivation regression (setup-gate rule).
    // Case A: setup incomplete → all downstream phases are locked.
    const scanIncomplete = {
        workspacePath: "/ws",
        projectInitialized: false,
        setup: { pluginInstalled: false, cliInstalled: false, projectInitialized: false, skillsReloaded: false, catalogsLoaded: false },
        preset: "core",
        currentPhase: "setup",
        phases: {},
        composition: { presets: [], extensions: [] },
        catalog: { presets: [] },
        warnings: [],
    };
    const snapA = buildStateSnapshot(scanIncomplete);
    assert.equal("activeRuns" in snapA, false);
    // Setup itself is never locked.
    assert.notEqual(snapA.phases.setup?.locked, true);
    // Everything else is.
    for (const [id, phase] of Object.entries(snapA.phases)) {
        if (id === "setup") continue;
        assert.equal(phase.locked, true, `phase ${id} must be locked when setup incomplete`);
    }
    // Case B: setup complete → downstream phases unlock.
    const scanComplete = {
        ...scanIncomplete,
        projectInitialized: true,
        setup: {
            ...scanIncomplete.setup,
            pluginInstalled: true,
            cliInstalled: true,
            projectInitialized: true,
            skillsReloaded: true,
        },
    };
    const snapB = buildStateSnapshot(scanComplete);
    for (const [id, phase] of Object.entries(snapB.phases)) {
        if (id === "setup") continue;
        assert.equal(phase.locked, false, `phase ${id} must be unlocked when setup complete`);
    }
});

// -------- S8: env-probe → state-store setup slice → derived phase ---------

test("S8: env-probe output composes with applyPatch → phases.setup.status flips as sub-flags flip", async () => {
    // The summarizer produces { cliInstalled, pluginInstalled, ... }; the
    // state store consumes those into state.setup and derives
    // phases.setup.status. Neither test proves the composition in
    // isolation. Here we walk from mock probe stdout to derived status.
    // Initial: neither CLI nor plugin present.
    const s0 = summarizeResults([]);
    let state = applyPatch(normalizeState({}), { setup: s0 });
    assert.equal(state.phases.setup.status, "empty");

    // CLI installed alone → still in_progress (not all four sub-flags true).
    const s1 = summarizeResults([{ name: "specify", exitCode: 0, stdout: "specify 0.1.0" }]);
    assert.equal(s1.cliInstalled, true);
    state = applyPatch(state, { setup: s1 });
    assert.equal(state.phases.setup.status, "in_progress");

    // CLI + plugin present → still in_progress until projectInitialized +
    // skillsReloaded flip.
    const s2 = summarizeResults([
        { name: "specify", exitCode: 0, stdout: "specify 0.1.0" },
        {
            name: "spec-kit-plugin",
            exitCode: 0,
            stdout: "  • spec-kit-copilot@spec-kit-marketplace (v0.11.8)",
        },
    ]);
    assert.equal(s2.cliInstalled, true);
    assert.equal(s2.pluginInstalled, true);
    state = applyPatch(state, { setup: s2 });
    assert.equal(state.phases.setup.status, "in_progress");

    // Manually flip the two remaining sub-flags — projectInitialized and
    // skillsReloaded aren't probe outputs, they're written by the setup
    // sub-step handlers. Verify the derived phase status flips to "done"
    // when all four are true (catalogsLoaded doesn't count).
    state = applyPatch(state, { setup: { projectInitialized: true, skillsReloaded: true } });
    assert.equal(state.phases.setup.status, "done");
});
});

describe("integration-vocab", () => {
// Cross-module vocabulary contracts.
//
// These tests wire real modules together (no mocks in place of the other
// side) and assert the shape/vocabulary each module hands off matches what
// the receiver accepts. A failure here indicates a real seam drift, NOT
// an implementation detail moving.
//
// Seams covered:
//   S1×S2  - Every action kind in `ACTION_KINDS` must dispatch through
//            `buildPrompt` without throwing (closed enum is truly closed).
//   S1×cat - Every canonical wizard phase in `PHASE_ORDER` maps to a
//            skill named `speckit-<phase>` via `SKILL_BY_KIND`.
//   S2     - Every command name that `phaseIdForCommandName` classifies
//            as canonical must be a phase that `applyPatch` will accept
//            a status update for. (Prompt → agent → state-store contract.)
//   S2     - The CLOSED execution-state vocabulary embedded in the
//            tracking preamble must equal what `normalizeExecutionReports`
//            accepts. Extracted from the prompt body by parsing, not
//            substring-matching.
//   full-state JSON round-trip - Every top-level slice survives
//            JSON.stringify → JSON.parse → normalizeState unchanged.



// ---------- S1×S2: every action kind dispatches ----------

test("S1×S2: every ACTION_KIND builds a non-empty prompt without throwing", () => {
    // If a kind ever slips into the enum without a renderBody branch,
    // buildPrompt would throw or return empty. Guards the closed-enum
    // contract from both sides simultaneously.
    for (const kind of ACTION_KINDS) {
        const runId = "00000000-0000-4000-8000-000000000001";
        const out = buildPrompt(kind, { runId,
            endpoint: `http://127.0.0.1:1234/api/artifact-targets?token=test&runId=${runId}` },
            { workspacePath: "/ws" });
        assert.equal(typeof out, "string", `kind ${kind} must produce a string`);
        assert.ok(out.length > 0, `kind ${kind} produced an empty prompt`);
    }
});

test("S1×S2: artifact-owner prompts distinguish creator, updater, and no-artifact phases", () => {
    const specify = buildPrompt("specify", {}, { workspacePath: "/ws" });
    assert.match(specify, /Artifact: `specs\/<slug>\/spec\.md` \(first line must be `<!-- speckit:specify v1 -->`\)\./);

    const clarify = buildPrompt("clarify", {}, { workspacePath: "/ws" });
    assert.match(clarify, /preserve its `<!-- speckit:specify v1 -->` first-line provenance marker/);
    assert.doesNotMatch(clarify, /speckit:clarify v1/);

    const converge = buildPrompt("converge", {}, { workspacePath: "/ws" });
    assert.match(converge, /preserve its `<!-- speckit:tasks v1 -->` first-line provenance marker/);
    assert.doesNotMatch(converge, /speckit:converge v1/);

    const implement = buildPrompt("implement", {}, { workspacePath: "/ws" });
    assert.match(implement, /does not create a markdown artifact/);
    assert.doesNotMatch(implement, /speckit:implement v1/);
});

// ---------- S1×catalog: wizard-phase → skill naming contract ----------

test("S1×catalog: every canonical phase in PHASE_ORDER maps to skill 'speckit-<phase>'", () => {
    // The wizard promises "one skill per phase, named after the phase".
    // `setup` and `preset` are meta phases with no single-skill mapping
    // (setup dispatches sub-steps; preset dispatches via composition
    // kinds), so exclude them.
    for (const phaseId of PHASE_ORDER) {
        if (phaseId === "setup" || phaseId === "preset") continue;
        assert.ok(
            Object.prototype.hasOwnProperty.call(SKILL_BY_KIND, phaseId),
            `phase '${phaseId}' has no entry in SKILL_BY_KIND`,
        );
        assert.equal(
            SKILL_BY_KIND[phaseId],
            `speckit-${phaseId}`,
            `phase '${phaseId}' skill must be 'speckit-${phaseId}'`,
        );
    }
});

// ---------- S2: prompt → state-store phase-id contract ----------

test("S2: every canonical command name maps to a phase applyPatch will accept", () => {
    // The tracking preamble (and Run-phase button) tells the agent to
    // call `setPhaseStatus({ phase: <derived-id>, status: "done" })`.
    // If phaseIdForCommandName returns an id state-store rejects, the
    // agent's state write silently no-ops. This is the wire contract
    // that binds prompt-side and store-side together.
    const canonicalNames = PHASE_ORDER
        .filter((phaseId) => phaseId !== "setup" && phaseId !== "preset")
        .flatMap((phaseId, index) => index === 0
            ? [`speckit.${phaseId}`, `speckit-${phaseId}`]
            : [`speckit.${phaseId}`]);
    for (const cmd of canonicalNames) {
        const phaseId = phaseIdForCommandName(cmd);
        assert.ok(phaseId, `${cmd} must classify as canonical`);
        const before = normalizeState({});
        const after = applyPatch(before, { phases: { [phaseId]: { status: "done" } } });
        assert.equal(
            after.phases?.[phaseId]?.status,
            "done",
            `applyPatch dropped status write for phase '${phaseId}' (command '${cmd}')`,
        );
        // Sanity: the phase must exist in PHASE_BY_ID too, or applyPatch's
        // guard at line 745 would have silently dropped the write.
        assert.ok(PHASE_BY_ID[phaseId], `phase '${phaseId}' missing from PHASE_BY_ID`);
    }
});

// ---------- S2: executionReports vocabulary alignment ----------

test("S2: tracking preamble embeds the same execution-state vocabulary state-store accepts", () => {
    // Both sides must agree on the CLOSED list of allowed state values.
    // Parse the "Allowed state values (CLOSED vocabulary): [...]" line
    // out of the preamble and diff it against EXECUTION_STATES.
    const preamble = buildWorkflowTrackingPreamble({
        commandName: "speckit.plan",
        expectedArtifacts: { templates: ["plan-template"], scripts: [], hooks: [] },
        runId: "run-test",
    });
    assert.ok(preamble, "canonical command must produce a preamble");

    const m = preamble.match(/Allowed state values \(CLOSED vocabulary\): (\[[^\]]+\])/);
    assert.ok(m, "preamble must declare its closed-list vocabulary block");
    const embedded = JSON.parse(m[1]);
    assert.deepEqual(
        embedded,
        [...EXECUTION_STATES],
        "preamble's embedded vocabulary must equal EXECUTION_STATES",
    );

    // The receiver side of the contract: normalizeExecutionReports must
    // preserve every state in the shared vocabulary.
    const artifacts = {
        template: Object.fromEntries(EXECUTION_STATES.map((s, i) => [`t${i}`, { state: s }])),
    };
    const normalized = normalizeExecutionReports({
        "commands/speckit.plan": {
            expected: { templates: [], scripts: [], hooks: [] },
            artifacts,
        },
    });
    const kept = Object.keys(normalized["commands/speckit.plan"].artifacts.template);
    assert.equal(kept.length, EXECUTION_STATES.length, "every canonical state must round-trip");
});

test("S2: tracking preamble requires terminal status for success, skips, and blockers", () => {
    const preamble = buildWorkflowTrackingPreamble({
        commandName: "speckit.implement",
        artifactPath: null,
        expectedArtifacts: { templates: ["tasks-template"], scripts: [], hooks: [] },
        runId: "run-test",
    });

    assert.ok(preamble.includes('status: "done"'), "success must report done");
    assert.ok(preamble.includes('status: "skipped"'), "intentional bypass must report skipped");
    assert.ok(preamble.includes('status: "error"'), "blockers must report error");
    assert.match(preamble, /Declined checklist gate/);
    assert.match(preamble, /cancellation/);
    assert.match(preamble, /skill\/tool failure/);
    assert.match(preamble, /Before you return, call `setPhaseStatus` exactly once/);
    assert.ok(
        preamble.indexOf("reportCommandComplete(") > preamble.indexOf("reportExecution({"),
        "command completion must follow phase status and witness reporting",
    );
    assert.match(preamble, /commandId: "speckit\.implement".*run-test/);
});

// ---------- Full-state JSON round-trip ----------

test("JSON round-trip: state exercising every slice survives stringify/parse/normalize", () => {
    // Non-serializable values sneaking into state (functions, Symbols,
    // class instances, undefined) would silently drop on stringify.
    // Build a state that touches every top-level slice via applyPatch,
    // then round-trip and assert deep equality after normalization.
    let s = normalizeState({});
    s = applyPatch(s, { currentPhase: "plan", preset: "core" });
    s = applyPatch(s, {
        setup: {
            pluginInstalled: true,
            cliInstalled: true,
            projectInitialized: true,
            skillsReloaded: true,
        },
    });
    s = applyPatch(s, {
        phases: {
            constitution: { status: "done", artifactPath: ".specify/memory/constitution.md" },
            specify: { status: "in_progress", formValues: { title: "T" } },
            plan: { status: "empty" },
        },
    });
    s = applyPatch(s, {
        composition: {
            presets: [],
            extensions: [],
            artifacts: [],
            refreshedAt: "2024-01-01T00:00:00Z",
            executionReports: {
                "commands/speckit.plan": {
                    expected: { templates: ["plan-template"], scripts: [], hooks: [] },
                    artifacts: { template: { "plan-template": { state: "executed" } } },
                },
            },
        },
    });
    const roundTripped = normalizeState(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(roundTripped, s, "state must survive JSON round-trip through normalizeState");
});
});
