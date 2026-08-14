// HTTP → prompt → state-store, and HTTP → disk → scanner round-trips.
//
// These wire the real server, the real prompt builder, the real state
// store, and the real scanner together. A failure means the wire format
// truly drifted (S3×S2 or S5), not a copy change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHandler } from "../server.mjs";
import { scanWorkspace } from "../project-scanner.mjs";
import { normalizeState, applyPatch } from "../state/store.mjs";
import { setSession } from "../canvas-runtime/instances.mjs";

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
