import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { startFixture } from "../../../../../scripts/canvas-reader/serve-fixture.mjs";

function endpoint(fixture, route, parameters = {}) {
    const url = new URL(fixture.url);
    url.pathname = route;
    url.searchParams.delete("readerProbe");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url;
}

function exchange(url, { method = "GET", headers = {}, body } = {}) {
    return new Promise((resolveResponse, reject) => {
        const outgoing = request(url, { method, headers, signal: AbortSignal.timeout(5000) }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolveResponse({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
            response.on("error", reject);
        });
        outgoing.on("error", reject);
        outgoing.end(body);
    });
}

async function openedContext(fixture) {
    const response = await exchange(endpoint(fixture, "/api/review/context", { feature: "999-canvas-preview-fixture", stage: "specify" }));
    assert.equal(response.status, 200);
    return JSON.parse(response.body).data;
}

export function reviewHttpSecurityTests(canvas) {
    const assetBase = "/ui/vendor/markdown-reader/";
    const credential = canvas === "wizard" ? "token" : "cap";

    test(`${canvas} review HTTP gate rejects missing/wrong capability, Host, and Origin for routes and assets`, async () => {
        const fixture = await startFixture({ canvas });
        try {
            const opened = await openedContext(fixture);
            for (const route of ["/api/review/content", `${assetBase}markdown-reader.js`, `${assetBase}markdown-reader.css`, "/ui/artifact-review.js"]) {
                const authorized = endpoint(fixture, route, { context: opened.contextId, artifactId: opened.primaryArtifactId });
                const missing = new URL(authorized);
                missing.searchParams.delete(credential);
                const wrong = new URL(authorized);
                wrong.searchParams.set(credential, "synthetic-wrong-capability");
                for (const [label, url, headers] of [["missing", missing, {}], ["wrong", wrong, {}],
                    ["host", authorized, { Host: `localhost:${authorized.port}` }], ["origin", authorized, { Origin: "https://untrusted.invalid" }],
                    ["opaque-origin", authorized, { Origin: "null" }]]) {
                    const result = await exchange(url, { headers });
                    assert.ok([401, 403].includes(result.status), `${canvas} ${route} must reject ${label}`);
                    assert.ok(!result.body.includes("# Canvas reader fixture"));
                }
            }
            assert.equal(fixture.dispatchCount(), 0);
            assert.equal(fixture.workspaceChanged(), false);
        } finally { assert.equal((await fixture.stop()).cleaned, true); }
    });

    test(`${canvas} review responses and assets retain security headers on success and denial`, async () => {
        const fixture = await startFixture({ canvas });
        try {
            const opened = await openedContext(fixture);
            const urls = [endpoint(fixture, "/api/review/content", { context: opened.contextId, artifactId: opened.primaryArtifactId }),
                endpoint(fixture, "/api/review/content", { context: "ctx_wrong", artifactId: opened.primaryArtifactId }),
                ...["markdown-reader.js", "markdown-reader.css", "manifest.json", "THIRD_PARTY_NOTICES.txt", "unexpected.map"].map((name) => endpoint(fixture, `${assetBase}${name}`))];
            const denied = endpoint(fixture, "/api/review/context");
            denied.searchParams.delete(credential);
            urls.push(denied);
            for (const url of urls) {
                const response = await exchange(url);
                assert.equal(response.headers["cache-control"], "no-store", "review cache policy");
                assert.equal(response.headers["referrer-policy"], "no-referrer", "review referrer policy");
                assert.equal(response.headers["x-content-type-options"], "nosniff", "review MIME policy");
            }
        } finally { assert.equal((await fixture.stop()).cleaned, true); }
    });

    test(`${canvas} review HTTP rejects ambiguous and excessive query parameters`, async () => {
        const fixture = await startFixture({ canvas });
        try {
            const opened = await openedContext(fixture);
            const content = endpoint(fixture, "/api/review/content", { context: opened.contextId, artifactId: opened.primaryArtifactId });
            for (const [key, value] of [["context", "ctx_other"], ["artifactId", "artifact_other"], [credential, "synthetic-extra"],
                ["workspacePath", "SYNTHETIC_PATH_OVERRIDE"], ["unexpected", "a".repeat(3000)]]) {
                const url = new URL(content);
                url.searchParams.append(key, value);
                const result = await exchange(url);
                assert.ok([400, 401, 403].includes(result.status), `ambiguous or unknown ${key} must be denied`);
            }
        } finally { assert.equal((await fixture.stop()).cleaned, true); }
    });

    test(`${canvas} review HTTP bounds and strictly decodes structured request bodies`, async () => {
        const fixture = await startFixture({ canvas });
        try {
            const opened = await openedContext(fixture);
            const current = JSON.parse((await exchange(endpoint(fixture, "/api/review/content", { context: opened.contextId, artifactId: opened.primaryArtifactId }))).body).data;
            const valid = { contextId: opened.contextId, sourceArtifactId: opened.primaryArtifactId, expectedRevision: current.revision, target: "#details" };
            const malformedUtf8 = Buffer.concat([Buffer.from(JSON.stringify({ ...valid, target: "#" }).slice(0, -2)), Buffer.from([0xff]), Buffer.from('"}')]);
            for (const body of ["{", "null", "[]", JSON.stringify({ ...valid, extra: true }),
                JSON.stringify({ ...valid, target: "a".repeat(17_000) }), malformedUtf8]) {
                const response = await exchange(endpoint(fixture, "/api/review/resolve-link"), { method: "POST", headers: { "Content-Type": "application/json" }, body });
                assert.equal(response.status, 400, "malformed review body must produce a typed invalid_request");
                assert.equal(JSON.parse(response.body).error.code, "invalid_request");
            }
            const wrongType = await exchange(endpoint(fixture, "/api/review/resolve-link"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(valid) });
            assert.equal(wrongType.status, 400);
            assert.equal(JSON.parse(wrongType.body).error.code, "invalid_request");
            assert.equal(fixture.dispatchCount(), 0);
            assert.equal(fixture.blockedWrites(), 0);
        } finally { assert.equal((await fixture.stop()).cleaned, true); }
    });

    test(`${canvas} contexts and cursor generations cannot cross active HTTP instances`, async () => {
        const first = await startFixture({ canvas, allowMutations: true });
        let second;
        try {
            second = await startFixture({ canvas });
            for (let index = 0; index < 202; index++) await first.mutateArtifact(`page-${index}.md`, "# Synthetic page\n");
            const opened = await openedContext(first);
            const other = await openedContext(second);
            assert.ok(opened.nextCursor);
            const foreignContent = await exchange(endpoint(second, "/api/review/content", { context: opened.contextId, artifactId: opened.primaryArtifactId }));
            assert.equal(foreignContent.status, 404);
            assert.equal(JSON.parse(foreignContent.body).error.code, "invalid_context");
            const foreignCursor = await exchange(endpoint(second, "/api/review/artifacts", { context: other.contextId, cursor: opened.nextCursor }));
            assert.ok([400, 404].includes(foreignCursor.status));
            assert.equal((await exchange(endpoint(first, "/api/review/artifacts", { context: opened.contextId }))).status, 200);
            const staleCursor = await exchange(endpoint(first, "/api/review/artifacts", { context: opened.contextId, cursor: opened.nextCursor }));
            assert.ok([400, 404].includes(staleCursor.status));
            assert.equal(first.dispatchCount() + second.dispatchCount(), 0);
        } finally {
            if (second) assert.equal((await second.stop()).cleaned, true);
            assert.equal((await first.stop()).cleaned, true);
        }
    });
}
