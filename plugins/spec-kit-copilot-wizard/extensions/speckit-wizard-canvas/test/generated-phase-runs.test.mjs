import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { createPhaseRunStore, milestoneTags } from "../generation/generated-canvas-template/phase-runs.mjs";

const roots = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const pipeline = {
    runtime: { itemRoot: "specs/<slug>", multiInstance: true },
    pipeline: { steps: ["tasks", "implement", "analyze"].map((id) => ({ instanceKey: id, invocation: `/skill:speckit-${id}` })) },
};
async function fixture(options = {}) {
    const cwd = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), ".phase-runs-"));
    roots.push(cwd);
    const config = { extensionId: "workflow", pipeline, ...options };
    return { cwd, inst: { cwd }, config, store: createPhaseRunStore(config) };
}

test("dispatch flags persist by workspace, canvas contract, workflow and phase without a run history", async () => {
    const f = await fixture();
    const alpha = { id: "alpha", slug: "alpha" }, beta = { id: "beta", slug: "beta" };
    assert.deepEqual((await f.store.read(f.inst)).items, []);
    await Promise.all([
        f.store.mark(f.inst, alpha, "tasks"),
        f.store.mark(f.inst, alpha, "implement"),
        f.store.mark(f.inst, beta, "analyze"),
    ]);
    await f.store.mark(f.inst, alpha, "tasks");
    const reopened = createPhaseRunStore(f.config);
    assert.deepEqual((await reopened.read({ cwd: f.cwd, instanceId: "new-panel" })).items, [
        { id: "alpha", phases: ["tasks", "implement"] }, { id: "beta", phases: ["analyze"] },
    ]);
    assert.deepEqual((await createPhaseRunStore({ ...f.config, extensionId: "other" }).read(f.inst)).items, []);
    const changed = structuredClone(f.config);
    changed.pipeline.pipeline.steps[0].invocation = "/skill:changed";
    assert.deepEqual((await createPhaseRunStore(changed).read(f.inst)).items, []);
    const other = join(f.cwd, "other");
    await mkdir(other);
    assert.deepEqual((await reopened.read({ cwd: other })).items, []);
    await reopened.forget(f.inst, "alpha");
    assert.deepEqual((await reopened.read(f.inst)).items, [{ id: "beta", phases: ["analyze"] }]);
    const files = await readdir(join(f.cwd, ".speckit-wizard", "phase-runs"));
    assert.equal(files.length, 1, "reruns update one record instead of appending history");
});

test("named and automatic new workflows transfer flags separately without marking fresh New", async () => {
    const f = await fixture();
    const draft = { id: "__new__", isNew: true };
    await f.store.mark(f.inst, draft, "tasks", { slug: "alpha" });
    await f.store.mark(f.inst, draft, "implement", { slug: "beta" });
    await f.store.mark(f.inst, draft, "analyze", { baseline: { existing: 1 } });
    const reopened = createPhaseRunStore(f.config);
    const { record, error } = await reopened.reconcile(f.inst, [
        { id: "existing", slug: "existing", lastActivity: 2 },
        ...["alpha", "beta", "automatic"].map((id) => ({ id, slug: id, lastActivity: 2 })),
    ]);
    assert.equal(error, null);
    assert.deepEqual(record.pending, []);
    assert.deepEqual(record.items, [
        { id: "alpha", phases: ["tasks"] },
        { id: "beta", phases: ["implement"] },
        { id: "automatic", phases: ["analyze"] },
    ]);
    assert.equal(record.binding, null);
    await reopened.mark(f.inst, draft, "tasks", { baseline: { existing: 2, alpha: 2, beta: 2, automatic: 2 } });
    const ambiguous = await reopened.reconcile(f.inst, ["unexpected", "also-new"].map((id) => ({ id, slug: id, lastActivity: 3 })));
    assert.match(ambiguous.error, /Multiple workflow folders/);
    assert.equal(ambiguous.record.pending.length, 1, "do not guess which workflow ran");
    assert.deepEqual(ambiguous.record.items, record.items);
});

test("single-workflow bindings survive reopening for explicit and automatically assigned slugs", async () => {
    for (const explicit of [true, false]) {
        const single = structuredClone(pipeline);
        single.runtime.multiInstance = false;
        const f = await fixture({ pipeline: single });
        await f.store.mark(f.inst, explicit ? { id: "alpha", slug: "alpha" } : { id: "__new__", isNew: true }, "tasks");
        const reopened = createPhaseRunStore(f.config);
        const { record } = await reopened.reconcile(f.inst, [{ id: "alpha", slug: "alpha", lastActivity: 1 }]);
        assert.equal(record.binding, "alpha");
        assert.deepEqual(record.items, [{ id: "alpha", phases: ["tasks"] }]);
    }
});

test("malformed or oversized run state is reported instead of reset or overwritten", async () => {
    const f = await fixture();
    await f.store.mark(f.inst, { id: "alpha", slug: "alpha" }, "tasks");
    const directory = join(f.cwd, ".speckit-wizard", "phase-runs");
    const file = join(directory, (await readdir(directory))[0]);
    for (const content of ["not json", JSON.stringify({ version: 1, items: [], pending: [], binding: 42 }), "x".repeat(512 * 1024 + 1)]) {
        await writeFile(file, content);
        await assert.rejects(f.store.read(f.inst), /Cannot read phase run state/);
        await assert.rejects(f.store.mark(f.inst, { id: "alpha", slug: "alpha" }, "implement"), /Cannot read phase run state/);
        assert.equal(await readFile(file, "utf8"), content);
    }
});

test("latest runs and verbatim responses persist per phase and reject stale completion", async () => {
    const f = await fixture();
    const alpha = { id: "alpha", slug: "alpha" };
    const run = (runId) => ({ runId, messageId: `message-${runId}`, sessionId: "session" });
    await f.store.mark(f.inst, alpha, "tasks", { run: run("first") });
    await f.store.complete(f.inst, "first", { response: "Tasks written.", error: null });
    await f.store.mark(f.inst, alpha, "implement", { run: run("second") });
    await f.store.complete(f.inst, "second", { response: "Code implemented.", error: null });
    await f.store.mark(f.inst, alpha, "tasks", { run: run("rerun") });
    assert.equal(await f.store.complete(f.inst, "first", { response: "Stale", error: null }), false);
    const reopened = createPhaseRunStore(f.config);
    const runs = reopened.forItem(await reopened.read(f.inst), alpha);
    assert.equal(runs.find((entry) => entry.phase === "implement").response, "Code implemented.");
    assert.equal(runs.find((entry) => entry.phase === "tasks").completed, false);
    assert.equal(runs.find((entry) => entry.phase === "tasks").response, null);
    assert.equal(runs.reduce((latest, next) => next.sequence > latest.sequence ? next : latest).runId, "rerun");
});

test("first-run capture follows a new workflow when its folder is identified", async () => {
    const f = await fixture();
    await f.store.mark(f.inst, { isNew: true, id: "__new__" }, "tasks", {
        run: { runId: "new-run", messageId: "request", sessionId: "session" },
    });

    await f.store.reconcile(f.inst, [{ id: "alpha", slug: "alpha", lastActivity: 1 }]);
    assert.equal(await f.store.complete(f.inst, "new-run", { response: "Created tasks for alpha.", error: null }), true);
    const runs = f.store.forItem(await f.store.read(f.inst), { id: "alpha", slug: "alpha" });
    assert.equal(runs[0].response, "Created tasks for alpha.");
    assert.equal(runs[0].completed, true);
});

test("current runs recover capture errors and replace earlier replies without rewriting unchanged evidence", async () => {
    const f = await fixture();
    const alpha = { id: "alpha", slug: "alpha" };
    await f.store.mark(f.inst, alpha, "tasks", {
        run: { runId: "current", messageId: "request", sessionId: "session" },
    });
    await f.store.complete(f.inst, "current", { response: null, error: "Multiple requests shared this interaction" });
    assert.equal(await f.store.complete(f.inst, "current", { response: "Still validating.", error: null }), true);
    assert.equal(await f.store.complete(f.inst, "current", { response: "Validation passed.", error: null }), true);
    assert.equal(await f.store.complete(f.inst, "current", { response: "Validation passed.", error: null }), false);
    const saved = f.store.forItem(await f.store.read(f.inst), alpha)[0];
    assert.equal(saved.sequence, 1);
    assert.equal(saved.response, "Validation passed.");
    assert.equal(saved.error, null);
    assert.deepEqual((await f.store.read(f.inst)).items[0].phases, ["tasks"]);
});

test("accepted tags survive pending reruns and reloads, replace once, and reject stale results", async () => {
    const f = await fixture();
    const item = { id: "alpha", slug: "alpha" };
    const mark = async (phase, runId) => f.store.mark(f.inst, item, phase, {
        run: { runId, messageId: runId, sessionId: "session" },
    });
    const accept = async (runId, label) => {
        await f.store.complete(f.inst, runId, { response: label, error: null });
        await f.store.rememberResults(f.inst, item.id, [{ runId, label, artifact: null }]);
    };
    const tags = async () => milestoneTags(pipeline.pipeline.steps, {},
        f.store.forItem(await f.store.read(f.inst), item), ["Tasks", "Implement"]);
    await mark("tasks", "tasks-1");
    await accept("tasks-1", "Tasks");
    await mark("implement", "implement-1");
    assert.deepEqual(await tags(), ["Tasks"]);
    await accept("implement-1", "Implement");
    assert.deepEqual(await tags(), ["Tasks", "Implement"]);
    await mark("tasks", "tasks-2");
    f.store = createPhaseRunStore(f.config);
    assert.deepEqual(await tags(), ["Tasks", "Implement"], "starting an upstream rerun keeps previous milestones");
    await accept("tasks-2", "Tasks");
    assert.deepEqual(await tags(), ["Tasks"], "a completed artifact-free upstream rerun invalidates downstream results");
    await f.store.rememberResults(f.inst, item.id, [{ runId: "tasks-1", label: "Implement", artifact: null }]);
    assert.deepEqual(await tags(), ["Tasks"], "stale callbacks cannot restore a different tag");
    await mark("implement", "implement-2");
    await accept("implement-2", "Implement");
    assert.deepEqual(await tags(), ["Tasks", "Implement"]);
    await mark("implement", "implement-3");
    await accept("implement-3", "Tasks");
    assert.deepEqual(await tags(), ["Tasks"], "a changed rerun replaces its old tag without duplicating a tag from another phase");
    await mark("implement", "implement-4");
    await accept("implement-4", null);
    assert.deepEqual(await tags(), ["Tasks"], "an accepted no-match replaces only its own previous tag");
    await f.store.forget(f.inst, item.id);
    assert.deepEqual(await tags(), []);
});

test("a rerun moves a workflow between result tags rather than accumulating history", async () => {
    const f = await fixture();
    const item = { id: "alpha", slug: "alpha" };
    for (const [index, label] of ["Go", "Go", "Kill"].entries()) {
        const runId = `decision-${index}`;
        await f.store.mark(f.inst, item, "tasks", { run: { runId, messageId: runId, sessionId: "session" } });
        await f.store.complete(f.inst, runId, { response: label, error: null });
        await f.store.rememberResults(f.inst, item.id, [{ runId, label, artifact: null }]);
        const tags = milestoneTags(pipeline.pipeline.steps, {}, f.store.forItem(await f.store.read(f.inst), item), ["Go", "Kill"]);
        assert.deepEqual(tags, [label]);
        assert.deepEqual(["Go", "Kill"].map((tag) => Number(tags.includes(tag))), label === "Go" ? [1, 0] : [0, 1]);
    }
});

function milestones() {
    const labels = ["Specify", "Plan", "Tasks", "Implement"];
    const steps = labels.map((label) => ({ instanceKey: label.toLowerCase(), commandName: `speckit.${label.toLowerCase()}` }));
    const evidence = Object.fromEntries(steps.map((step, index) => [step.instanceKey, {
        artifact: `${index === 0 ? "spec" : index === 3 ? "tasks" : step.instanceKey}.md`,
        mtimeMs: Math.min(index + 1, 3), content: "- [x] T001 Done\n- [X] T002 Done", clarificationCount: 0,
    }]));
    const runs = steps.map((step, index) => ({ phase: step.instanceKey, sequence: index + 1, completed: true,
        result: { label: labels[index], sequence: index + 1, artifact: evidence[step.instanceKey].artifact } }));
    return { labels, steps, evidence, runs, tags: () => milestoneTags(steps, evidence, runs, labels) };
}

test("milestone counts deduplicate workflows and shared tags across all phases", () => {
    const f = milestones();
    assert.deepEqual(f.tags(), f.labels);
    const count = (workflows) => f.labels.map((label) => workflows.filter((tags) => tags.includes(label)).length);
    assert.deepEqual(count([f.tags()]), [1, 1, 1, 1]);
    assert.deepEqual(count([f.tags(), f.tags(), f.tags()]), [3, 3, 3, 3]);
    f.runs[3].result.label = "Tasks";
    assert.deepEqual(f.tags(), ["Specify", "Plan", "Tasks"], "two matching phases still count once");
    assert.deepEqual(milestoneTags(f.steps, f.evidence, f.runs, [...f.labels].reverse()), f.tags(), "reordering tags cannot reinterpret saved results");
});

test("artifact times invalidate downstream milestones and regeneration restores them", () => {
    const f = milestones();
    f.evidence.specify.mtimeMs = 4;
    assert.deepEqual(f.tags(), ["Specify"]);
    f.evidence.plan.mtimeMs = 5;
    assert.deepEqual(f.tags(), ["Specify", "Plan"]);
    f.evidence.tasks.mtimeMs = f.evidence.implement.mtimeMs = 6;
    assert.deepEqual(f.tags(), f.labels);
    f.runs[0].sequence = 10;
    assert.deepEqual(f.tags(), f.labels, "an unchanged upstream artifact wins over rerun order");
    delete f.evidence.plan.mtimeMs;
    assert.deepEqual(f.tags(), ["Specify"], "a previously known missing artifact invalidates dependents");
});

test("Implement requires nonempty completed task evidence when available, ignoring fenced examples", () => {
    const f = milestones();
    for (const content of ["", "# Tasks", "- [ ] T001 Pending", "- [x] T001 Done\n- [ ] T002 Pending",
        "```md\n- [x] Example only\n```"]) {
        f.evidence.implement.content = content;
        assert.deepEqual(f.tags(), ["Specify", "Plan", "Tasks"]);
    }
    f.evidence.implement.content = "- [x] T001 Done\n```\n- [ ] Example only\n```";
    assert.deepEqual(f.tags(), f.labels);
    f.evidence.implement = {};
    f.runs[3].result.artifact = null;
    f.evidence.tasks.content = "- [ ] T001 Pending";
    assert.deepEqual(f.tags(), ["Specify", "Plan", "Tasks"], "artifact-free Implement can use the known Tasks artifact");
    f.evidence.tasks = {};
    f.runs[2].result.artifact = null;
    assert.deepEqual(f.tags(), f.labels, "unavailable artifact metadata does not disqualify response-backed matches");
});
