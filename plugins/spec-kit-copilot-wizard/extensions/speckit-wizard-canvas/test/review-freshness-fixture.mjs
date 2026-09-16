import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../ui/markdown-reader/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

async function withReview(adapterUrl, run) {
    const { createArtifactReview } = await import(adapterUrl);
    const dom = new JSDOM('<button id="trigger">Review</button><div id="scroll"><div id="reader"></div></div>', { url: "http://127.0.0.1:32199/?token=fixture&cap=fixture" });
    const container = dom.window.document.getElementById("reader");
    const documents = new Map([["primary", "# Initial specification\n"], ["related", "# Related document\n"]]);
    const descriptors = new Map([
        ["primary", { id: "primary", relativePath: "specs/001-fixture/spec.md", label: "Specification", role: "primary", suffix: ".md" }],
        ["related", { id: "related", relativePath: "specs/001-fixture/research.md", label: "research.md", role: "supporting", suffix: ".md" }],
    ]);
    const calls = [];
    const renders = [];
    let deferred;
    let failure;
    let contextGeneration = 0;
    let expired = false;
    const remote = {
        expireContext() { expired = true; },
        deferNextRead() {
            let started;
            let release;
            const entered = new Promise((resolve) => { started = resolve; });
            const waiting = new Promise((resolve) => { release = resolve; });
            deferred = { started, waiting };
            return { entered, release };
        },
        failNextRead(code) { failure = code; },
    };
    const items = () => [...descriptors.values()].map((artifact) => ({ ...artifact, availability: documents.has(artifact.id) ? "available" : "expected" }));
    const request = async (input, options) => {
        const url = new URL(input);
        calls.push({ route: url.pathname, expectedRevision: url.searchParams.get("expectedRevision"), method: options?.method ?? "GET" });
        let data;
        if (url.pathname.endsWith("/context")) {
            expired = false;
            contextGeneration++;
            data = { contextId: `ctx_fixture_${contextGeneration}`, generation: 1, items: items(), primaryArtifactId: "primary", nextCursor: null };
        } else if (expired) return { ok: false, json: async () => ({ ok: false, error: { code: "invalid_context" } }) };
        else if (url.pathname.endsWith("/artifacts")) data = { contextId: `ctx_fixture_${contextGeneration}`, generation: 1, items: items(), nextCursor: null };
        else {
            const id = url.searchParams.get("artifactId");
            let code = failure;
            failure = null;
            const content = documents.get(id);
            const revision = content !== undefined ? `sha256:${createHash("sha256").update(content).digest("hex")}` : null;
            if (content === undefined) code = "artifact_unavailable";
            if (!code && url.searchParams.has("expectedRevision") && url.searchParams.get("expectedRevision") !== revision) code = "changed_source";
            if (code) return { ok: false, json: async () => ({ ok: false, error: { code } }) };
            data = { artifact: items().find((artifact) => artifact.id === id), content, revision, byteSize: Buffer.byteLength(content), sourceKind: "working-tree" };
            if (deferred) {
                const pending = deferred;
                deferred = null;
                pending.started();
                await pending.waiting;
            }
        }
        return { ok: true, json: async () => ({ ok: true, data }) };
    };
    const rememberRender = (options) => {
        renders.push(options);
        options.onRendered?.({ readerId: options.readerId, state: options.state, artifactId: options.selectedArtifactId, revision: options.document?.revision });
    };
    const review = createArtifactReview({
        container, scrollElement: container.parentElement, readerId: "freshness-fixture", fetch: request,
        mount: (_element, options) => { rememberRender(options); return { update: rememberRender, unmount() {} }; },
    });
    try { await run({ review, documents, descriptors, renders, remote, calls, container }); }
    finally { review.close(); dom.window.close(); }
}

export function reviewFreshnessTests(canvas, adapterUrl) {
    test(`${canvas} refresh labels changed content before replacing its revision`, () => withReview(adapterUrl, async ({ review, documents, renders, calls }) => {
        await review.open({ stage: "specify" });
        const first = review.document.revision;
        assert.equal(typeof review.refresh, "function", "Scoped reader refresh is missing");
        documents.set("primary", "# Updated specification\n");
        await review.refresh();
        assert.notEqual(review.document.revision, first);
        const changed = renders.findIndex((options) => options.state === "changed");
        const updated = renders.findIndex((options) => options.document?.revision === review.document.revision && options.state === "ready");
        assert.ok(changed >= 0 && updated > changed);
        assert.ok(calls.some((call) => call.expectedRevision === first));
        assert.equal(review.document.artifact.id, "primary");
    }));

    test(`${canvas} refresh discovers new artifacts without stealing selection`, () => withReview(adapterUrl, async ({ review, descriptors, documents, renders }) => {
        await review.open({ stage: "specify" });
        await review.selectArtifact("related");
        assert.equal(typeof review.refresh, "function", "Scoped reader refresh is missing");
        descriptors.set("new", { id: "new", relativePath: "specs/001-fixture/new.markdown", label: "new.markdown", role: "supporting", suffix: ".markdown" });
        documents.set("new", "# New document\n");
        await review.refresh();
        assert.equal(review.document.artifact.id, "related");
        assert.ok(renders.at(-1).artifacts.some((artifact) => artifact.id === "new"));
    }));

    test(`${canvas} refresh reports deletion and retains other artifact navigation`, () => withReview(adapterUrl, async ({ review, documents, container }) => {
        await review.open({ stage: "specify" });
        assert.equal(typeof review.refresh, "function", "Scoped reader refresh is missing");
        documents.delete("primary");
        await review.refresh();
        assert.equal(container.dataset.reviewState, "deleted");
        assert.equal(review.document, null);
        await review.selectArtifact("related");
        assert.equal(review.document.artifact.id, "related");
    }));

    test(`${canvas} late responses cannot replace a newer selection or a closed reader`, () => withReview(adapterUrl, async ({ review, remote, container }) => {
        await review.open({ stage: "specify" });
        const delayed = remote.deferNextRead();
        const older = review.selectArtifact("related");
        await delayed.entered;
        await review.selectArtifact("primary");
        delayed.release();
        await older;
        assert.equal(review.document.artifact.id, "primary");
        const pending = remote.deferNextRead();
        const closing = review.selectArtifact("related");
        await pending.entered;
        review.close();
        pending.release();
        await closing;
        assert.equal(review.document, null);
        assert.equal(container.children.length, 0);
    }));

    test(`${canvas} refresh keeps disconnection orthogonal and exposes typed read failures`, () => withReview(adapterUrl, async ({ review, renders, remote, container }) => {
        await review.open({ stage: "specify" });
        const revision = review.document.revision;
        assert.equal(typeof review.setConnected, "function", "Connection-state updates are missing");
        review.setConnected(false);
        assert.equal(renders.at(-1).connectionState, "disconnected");
        assert.equal(review.document.revision, revision);
        review.setConnected(true);
        assert.equal(renders.at(-1).connectionState, "connected");
        remote.failNextRead("unsupported_artifact");
        await review.selectArtifact("related");
        assert.equal(container.dataset.reviewState, "unsupported");
        assert.equal(review.document, null);
    }));

    test(`${canvas} explicit refresh renews an expired context without reusing its history`, () => withReview(adapterUrl, async ({ review, renders, remote, calls, container }) => {
        const trigger = container.ownerDocument.getElementById("trigger");
        trigger.focus();
        await review.open({ stage: "specify" });
        await review.selectArtifact("related");
        const expiredContext = review.context.contextId;
        remote.expireContext();
        await review.refresh();
        assert.equal(container.dataset.reviewState, "error");
        assert.equal(calls.filter((call) => call.route.endsWith("/context")).length, 1);
        await renders.at(-1).onRefresh();
        assert.notEqual(review.context.contextId, expiredContext);
        assert.equal(review.document.artifact.relativePath, "specs/001-fixture/research.md");
        assert.equal(review.history.length, 1);
        assert.equal(review.navigateHistory("back"), false);
        review.close();
        assert.equal(container.ownerDocument.activeElement, trigger);
    }));

    test(`${canvas} expired-context recovery refuses a document outside refreshed membership`, () => withReview(adapterUrl, async ({ review, renders, remote, descriptors, container }) => {
        await review.open({ stage: "specify" });
        await review.selectArtifact("related");
        remote.expireContext();
        descriptors.delete("related");
        await renders.at(-1).onRefresh();
        assert.equal(container.dataset.reviewState, "missing");
        assert.equal(review.document, null);
        assert.deepEqual(review.history, []);
        assert.equal(review.context.contextId, "ctx_fixture_2");
    }));
}
