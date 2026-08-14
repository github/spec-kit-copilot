// Tests for server.mjs — createHandler with mock req/res + injected deps.
// No real socket, no real disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHandler } from "../server.mjs";
import { setSession } from "../canvas-runtime/instances.mjs";

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
            setup: { cliInstalled: true, projectInitialized: true, skillsReloaded: true },
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
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmpWorkspace() {
    const dir = mkdtempSync(join(tmpdir(), "wiz-at-"));
    return dir;
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
        const deps = baseDeps({ getInstance: () => ({ workspacePath: ws, state: {} }) });
        const h = createHandler(deps);
        const body = JSON.stringify({
            entries: {
                "commands/new.one": { writesTo: ".specify/new.md", source: "llm" },
            },
        });
        const req = mockReq({
            method: "POST",
            url: "/api/artifact-targets?token=secret-token",
            headers: { "content-type": "application/json" },
            body,
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 200, res.body);
        const parsed = JSON.parse(readFileSync(join(ws, ".speckit-wizard", "artifact-targets.json"), "utf8"));
        assert.equal(parsed.entries["commands/old.one"].writesTo, ".specify/old.md");
        assert.equal(parsed.entries["commands/new.one"].writesTo, ".specify/new.md");
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/artifact-targets: drops non-commands/ keys and missing writesTo", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = baseDeps({ getInstance: () => ({ workspacePath: ws, state: {} }) });
        const h = createHandler(deps);
        const body = JSON.stringify({
            entries: {
                "templates/foo": { writesTo: ".specify/skip.md" }, // wrong prefix
                "commands/good": { writesTo: ".specify/keep.md" },
                "commands/bad": { source: "llm" }, // no writesTo
                "commands/blank": { writesTo: "   " }, // blank writesTo
            },
        });
        const req = mockReq({
            method: "POST",
            url: "/api/artifact-targets?token=secret-token",
            headers: { "content-type": "application/json" },
            body,
        });
        const res = mockRes();
        await h(req, res);
        assert.equal(res.statusCode, 200);
        const parsed = JSON.parse(readFileSync(join(ws, ".speckit-wizard", "artifact-targets.json"), "utf8"));
        assert.deepEqual(Object.keys(parsed.entries), ["commands/good"]);
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
});

test("POST /api/artifact-targets: rejects when no valid entries remain", async () => {
    const ws = tmpWorkspace();
    try {
        const deps = baseDeps({ getInstance: () => ({ workspacePath: ws, state: {} }) });
        const h = createHandler(deps);
        const body = JSON.stringify({ entries: { "templates/x": { writesTo: "y" } } });
        const req = mockReq({
            method: "POST",
            url: "/api/artifact-targets?token=secret-token",
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
        const deps = baseDeps({ getInstance: () => ({ workspacePath: ws, state: {} }) });
        const h = createHandler(deps);
        const req = mockReq({
            method: "POST",
            url: "/api/artifact-targets?token=secret-token",
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
