import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
import { describe, test } from "node:test";
import { setSession } from "../canvas-runtime/instances.mjs";
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
import {
    applyPatch,
    EXECUTION_STATES,
    normalizeExecutionReports,
    normalizeState,
} from "../state/store.mjs";

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
        getState: async () => ({ workspacePath, currentPhase: "setup", setup: {}, preset: "core", phases: {}, slug: null }),
        getInstance: () => ({ workspacePath, state: {} }),
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

        // Extract the setPhaseStatus({...}) invocation and parse fields
        // by name — resilient to reordering / whitespace / new fields.
        const setCallMatch = prompt.match(/setPhaseStatus\(\{([^}]+)\}\)/);
        assert.ok(setCallMatch, "prompt must ask the agent to call setPhaseStatus");
        const argBody = setCallMatch[1];
        const phaseM = argBody.match(/phase:\s*"([^"]+)"/);
        const statusM = argBody.match(/status:\s*"([^"]+)"/);
        assert.ok(phaseM, "setPhaseStatus arg must include phase field");
        assert.ok(statusM, "setPhaseStatus arg must include status field");

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

test("S3×S2: extension-namespaced commands dispatch WITHOUT a setPhaseStatus call", async () => {
    // Extension commands aren't tracked by the wizard's canonical stepper;
    // wrapping them with a tracking preamble would ask the agent to write
    // to a phase id that doesn't exist. This test ensures no `setPhaseStatus`
    // instruction leaks into the extension-command dispatch.
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
        await new Promise((r) => setImmediate(r));
        const prompt = deps._sessionCalls[0].prompt;
        assert.ok(prompt.startsWith("/speckit-assess-intake"), "dispatch must slash-normalize");
        assert.equal(
            /setPhaseStatus/.test(prompt),
            false,
            "extension commands must not embed setPhaseStatus (would target a non-existent phase id)",
        );
    } finally {
        rmSync(ws, { recursive: true, force: true });
    }
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
            url: "/api/artifact-targets?token=secret-token",
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

// -------- S6b: scanner → buildStateSnapshot → commandSourcePath -----------

test("S6b: a real scanned preset command's snapshot object resolves via commandSourcePath's legacy source fallback", async () => {
    // Regression test: buildCommands forwards `cmd.source` ("preset:<id>")
    // onto snapshot.commands but does not attach a `lookupId` — that field
    // only exists on composition-artifact stack layers, a separate producer.
    // commandSourcePath must still resolve a path for these real command
    // objects, not silently return null.
    const ws = tmpWs();
    try {
        mkdirSync(join(ws, ".specify", "presets", "alpha", "commands"), { recursive: true });
        writeFileSync(
            join(ws, ".specify", "presets", ".registry"),
            JSON.stringify([{ id: "alpha", priority: 100, enabled: true }]),
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

        const scan = await scanWorkspace(ws, await realFsDeps());
        const snap = buildStateSnapshot(scan);
        const cmd = (snap.commands ?? []).find((c) => c.commandName === "speckit.a1" || c.name === "speckit.a1");
        assert.ok(cmd, `snapshot.commands missing speckit.a1: ${JSON.stringify(snap.commands)}`);
        assert.equal(cmd.source, "preset:alpha");
        assert.equal(cmd.lookupId, undefined, "buildCommands does not attach lookupId today");

        const { commandSourcePath } = await import("../ui/phase-runtime.js");
        const { state } = await import("../ui/state.js");
        state.snapshot = { composition: { artifacts: [] } };
        assert.equal(commandSourcePath(cmd), ".specify/presets/alpha/commands/speckit.a1.md");
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
    // Case C: taskstoissues stays gated until a provider is in composition.
    assert.equal(snapB.phases.taskstoissues?.gated, true, "no taskstoissues provider → gated=true");
    // Add a matching layer, re-snapshot: gated flips.
    const scanWithProvider = {
        ...scanComplete,
        composition: { presets: [], extensions: [{ name: "speckit-taskstoissues", source: "catalog" }] },
    };
    const snapC = buildStateSnapshot(scanWithProvider);
    assert.equal(snapC.phases.taskstoissues?.gated, false, "taskstoissues provider in composition → gated=false");
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
        const out = buildPrompt(kind, {}, { workspacePath: "/ws" });
        assert.equal(typeof out, "string", `kind ${kind} must produce a string`);
        assert.ok(out.length > 0, `kind ${kind} produced an empty prompt`);
    }
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
    const canonicalNames = [
        "speckit.constitution",
        "speckit-constitution",
        "speckit.specify",
        "speckit.clarify",
        "speckit.checklist",
        "speckit.plan",
        "speckit.tasks",
        "speckit.analyze",
        "speckit.taskstoissues",
        "speckit.implement",
    ];
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
