import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const descriptor = (name, overrides = {}) => ({
    relativePath: `specs/001-fixture/${name}`,
    label: name,
    role: "supporting",
    availability: "available",
    ...overrides,
});

function contextTest(name, run) {
    test(name, async () => {
        const domain = await import("../server/artifact-review.mjs").catch((error) => {
            if (error.code === "ERR_MODULE_NOT_FOUND") {
                assert.fail("T018: the review-context domain is not implemented");
            }
            throw error;
        });
        await run(domain);
    });
}

function fixture(createReviewStore, entries = [descriptor("spec.md", { role: "primary" })], overrides = {}) {
    const members = new Map(entries.filter(Boolean).map((entry) => [entry.relativePath, entry]));
    const discoveryCalls = [];
    let scopeValid = true;
    let clock = 1000;
    const store = createReviewStore({
        canvasId: "speckit-wizard",
        instanceId: "fixture-instance",
        workspacePath: join(tmpdir(), "review-context-fixture"),
        validateScope: async () => scopeValid,
        resolveMember: async (_context, relativePath) => members.get(relativePath) ?? null,
        discover: async (_context, { resumeKey, limit, inspectedCount }) => {
            discoveryCalls.push({ resumeKey, limit, inspectedCount });
            const offset = resumeKey ?? 0;
            const inspected = Math.min(limit, entries.length - offset);
            return {
                entries: entries.slice(offset, offset + inspected).filter(Boolean),
                inspectedCount: inspected,
                resumeKey: offset + inspected,
                complete: offset + inspected >= entries.length,
            };
        },
        now: () => clock,
        ttlMs: 100,
        ...overrides,
    });
    const context = store.createContext({ scopeType: "feature", scopeKey: "001-fixture", generation: 1 });
    return {
        store, context, members, discoveryCalls,
        invalidateScope() { scopeValid = false; },
        advanceClock() { clock += 101; },
    };
}

contextTest("issues opaque contexts and stable descriptors without serializing the workspace", async ({ createReviewStore }) => {
    const { store, context } = fixture(createReviewStore);
    assert.match(context.id, /^ctx_[a-zA-Z0-9_-]+$/);
    const first = await store.list(context.id);
    const second = await store.list(context.id);
    assert.equal(first.contextId, context.id);
    assert.equal(first.generation, 1);
    assert.match(first.items[0].id, /^artifact_[a-zA-Z0-9_-]+$/);
    assert.equal(first.items[0].id, second.items[0].id);
    assert.equal(first.items[0].suffix, ".md");
    assert.equal(first.nextCursor, null);
    assert.equal(first.limitReached, false);
    assert.ok(!JSON.stringify(first).includes(tmpdir()));
});

contextTest("rejects cross-instance and cross-context identities", async ({ createReviewStore }) => {
    const first = fixture(createReviewStore);
    const second = fixture(createReviewStore, undefined, { instanceId: "second-instance" });
    const page = await first.store.list(first.context.id);
    await assert.rejects(second.store.list(first.context.id), { code: "invalid_context", status: 404 });
    const other = first.store.createContext({ scopeType: "feature", scopeKey: "002-other", generation: 1 });
    await assert.rejects(first.store.resolve(other.id, page.items[0].id), { code: "artifact_unavailable" });
    await assert.rejects(first.store.resolve(first.context.id, "specs/001-fixture/spec.md"), { code: "artifact_unavailable" });
});

contextTest("revalidates current scope and membership before every content resolution", async ({ createReviewStore }) => {
    const setup = fixture(createReviewStore);
    const page = await setup.store.list(setup.context.id);
    const artifact = page.items[0];
    assert.equal((await setup.store.resolve(setup.context.id, artifact.id)).relativePath, artifact.relativePath);
    setup.members.delete(artifact.relativePath);
    await assert.rejects(setup.store.resolve(setup.context.id, artifact.id), { code: "artifact_unavailable" });
    setup.invalidateScope();
    await assert.rejects(setup.store.list(setup.context.id), { code: "invalid_context" });
});

contextTest("expected descriptors remain visible but never authorize content", async ({ createReviewStore }) => {
    const setup = fixture(createReviewStore, [descriptor("plan.md", { availability: "expected" })]);
    const page = await setup.store.list(setup.context.id);
    assert.equal(page.items[0].availability, "expected");
    await assert.rejects(setup.store.resolve(setup.context.id, page.items[0].id), { code: "artifact_unavailable" });
});

contextTest("binds opaque cursors to context and generation with 200-item pages", async ({ createReviewStore }) => {
    const entries = Array.from({ length: 405 }, (_, index) => descriptor(`${String(index).padStart(4, "0")}.md`));
    const setup = fixture(createReviewStore, entries);
    const first = await setup.store.list(setup.context.id);
    assert.equal(first.items.length, 200);
    assert.match(first.nextCursor, /^cursor_[a-zA-Z0-9_-]+$/);
    const second = await setup.store.list(setup.context.id, { cursor: first.nextCursor });
    assert.equal(second.items.length, 200);
    assert.notEqual(second.items[0].id, first.items[0].id);
    assert.equal(setup.discoveryCalls[1].inspectedCount, 200);
    const third = await setup.store.list(setup.context.id, { cursor: second.nextCursor });
    assert.equal(third.items.length, 5);
    assert.equal(third.nextCursor, null);
    const other = setup.store.createContext({ scopeType: "feature", scopeKey: "002-other", generation: 2 });
    await assert.rejects(setup.store.list(other.id, { cursor: first.nextCursor }), { code: "invalid_context" });
    setup.store.invalidate(setup.context.id);
    await assert.rejects(setup.store.list(setup.context.id, { cursor: second.nextCursor }), { code: "invalid_context" });
});

contextTest("counts non-artifact entries and terminates successfully at the cumulative 10,000 cap", async ({ createReviewStore }) => {
    const entries = Array.from({ length: 10_001 }, (_, index) => index % 2 ? null : descriptor(`${String(index).padStart(5, "0")}.md`));
    const setup = fixture(createReviewStore, entries);
    let cursor = null;
    let page;
    let count = 0;
    do {
        page = await setup.store.list(setup.context.id, { cursor });
        assert.ok(page.items.length <= 200);
        count += page.items.length;
        cursor = page.nextCursor;
    } while (cursor);
    assert.equal(count, 5000);
    assert.equal(page.limitReached, true);
    assert.equal(page.nextCursor, null);
    assert.equal(setup.discoveryCalls.reduce((total, call) => total + call.limit, 0), 10_000);
});

contextTest("expires contexts and cursors and bounds retained context state", async ({ createReviewStore }) => {
    const setup = fixture(createReviewStore, undefined, { maxContexts: 2 });
    setup.advanceClock();
    await assert.rejects(setup.store.list(setup.context.id), { code: "invalid_context" });
    const oldest = setup.store.createContext({ scopeType: "feature", scopeKey: "old", generation: 1 });
    setup.store.createContext({ scopeType: "feature", scopeKey: "middle", generation: 1 });
    setup.store.createContext({ scopeType: "feature", scopeKey: "new", generation: 1 });
    await assert.rejects(setup.store.list(oldest.id), { code: "invalid_context" });
    setup.store.clear();
    await assert.rejects(setup.store.list(setup.context.id), { code: "invalid_context" });
});

contextTest("rejects unsafe descriptors and malformed input with bounded typed errors", async ({ createReviewStore }) => {
    const unsafe = fixture(createReviewStore, [descriptor("../outside.md")]);
    await assert.rejects(unsafe.store.list(unsafe.context.id), { code: "unsupported_artifact" });
    const setup = fixture(createReviewStore);
    await assert.rejects(setup.store.list("x".repeat(257)), { code: "invalid_request", status: 400 });
    await assert.rejects(setup.store.list(setup.context.id, { cursor: "x".repeat(1025) }), { code: "invalid_request" });
    const unavailable = fixture(createReviewStore, undefined, {
        validateScope: async () => { throw new Error("private path or credential"); },
    });
    await assert.rejects(unavailable.store.list(unavailable.context.id), (error) => {
        assert.equal(error.code, "workspace_unavailable");
        assert.equal(error.status, 503);
        assert.ok(!error.message.includes("private"));
        return true;
    });
});
