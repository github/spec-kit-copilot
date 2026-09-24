import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addPipelinePhases, pipelineActions } from "../canvas-runtime/actions/pipeline.mjs";
import { getInstance } from "../canvas-runtime/instances.mjs";

const artifacts = [
    { id: "commands/speckit.cosmosdb.recommend", kind: "command" },
    { id: "commands/speckit.cosmosdb.model", kind: "command" },
    { id: "commands/speckit.cosmosdb.container", kind: "command" },
    { id: "commands/speckit.cosmosdb.repository", kind: "command" },
    { id: "commands/speckit.cosmosdb.query", kind: "command" },
    { id: "commands/speckit.cosmosdb.partition-key", kind: "command" },
    { id: "commands/speckit.cosmosdb.point-read", kind: "command" },
    {
        id: "commands/speckit.cosmosdb.advise",
        kind: "hook",
        hookBinding: { targetCommand: "speckit.cosmosdb.advise" },
    },
];

test("adds README commands at their anchors without changing existing phases", () => {
    const state = {
        pipeline: null,
        composition: {
            artifacts,
            inferredPipeline: {
                pipeline: [
                    "commands/speckit.constitution",
                    "commands/speckit.specify",
                    "commands/speckit.plan",
                    "commands/speckit.tasks",
                    "commands/speckit.implement",
                ],
            },
        },
    };
    const additions = [
        { id: "commands/speckit.cosmosdb.recommend", after: "specify" },
        { id: "commands/speckit.cosmosdb.model", after: "plan" },
        { id: "commands/speckit.cosmosdb.container", after: "plan" },
    ];
    const result = addPipelinePhases(state, additions);
    assert.deepEqual(result.pipeline.map((entry) => entry.id), [
        "constitution", "specify", "speckit.cosmosdb.recommend", "plan",
        "speckit.cosmosdb.model", "speckit.cosmosdb.container", "tasks", "implement",
    ]);
    assert.equal(state.pipeline, null);
    assert.deepEqual(addPipelinePhases({ ...state, pipeline: result.pipeline }, additions).alreadyPresent, result.added);
    const partial = { ...state, pipeline: result.pipeline.filter((entry) => entry.id !== "speckit.cosmosdb.container") };
    assert.deepEqual(addPipelinePhases(partial, additions).pipeline, result.pipeline);
});

test("keeps transitive anchor chains in the supplied order", () => {
    const state = {
        pipeline: [{ id: "plan" }, { id: "tasks" }],
        composition: { artifacts },
    };
    const additions = [
        { id: "speckit.cosmosdb.model", after: "plan" },
        { id: "speckit.cosmosdb.container", after: "speckit.cosmosdb.model" },
        { id: "speckit.cosmosdb.repository", after: "plan" },
        { id: "speckit.cosmosdb.query", after: "speckit.cosmosdb.container" },
    ];
    const result = addPipelinePhases(state, additions);
    assert.deepEqual(result.pipeline.map((entry) => entry.id), [
        "plan", "speckit.cosmosdb.model", "speckit.cosmosdb.container",
        "speckit.cosmosdb.repository", "speckit.cosmosdb.query", "tasks",
    ]);
    assert.deepEqual(state.pipeline, [{ id: "plan" }, { id: "tasks" }]);
});

test("partial retries preserve the order of an existing anchor chain", () => {
    const state = { pipeline: [{ id: "plan" }, { id: "tasks" }], composition: { artifacts } };
    const additions = [
        { id: "speckit.cosmosdb.model", after: "plan" },
        { id: "speckit.cosmosdb.container", after: "speckit.cosmosdb.model" },
        { id: "speckit.cosmosdb.repository", after: "plan" },
    ];
    const full = addPipelinePhases(state, additions).pipeline;
    const partial = {
        ...state,
        pipeline: full.filter((entry) => entry.id !== "speckit.cosmosdb.repository"),
    };
    const retried = addPipelinePhases(partial, additions);
    assert.deepEqual(retried.pipeline, full);
    assert.deepEqual(retried.alreadyPresent, [
        "speckit.cosmosdb.model", "speckit.cosmosdb.container",
    ]);
    assert.deepEqual(retried.added, ["speckit.cosmosdb.repository"]);
    assert.deepEqual(addPipelinePhases({ ...state, pipeline: full }, additions).pipeline, full);
});

test("preserves order when later additions reuse ancestor anchors", () => {
    const state = { pipeline: [{ id: "plan" }, { id: "tasks" }], composition: { artifacts } };
    const additions = [
        { id: "speckit.cosmosdb.model", after: "plan" },
        { id: "speckit.cosmosdb.container", after: "speckit.cosmosdb.model" },
        { id: "speckit.cosmosdb.repository", after: "speckit.cosmosdb.container" },
        { id: "speckit.cosmosdb.query", after: "plan" },
        { id: "speckit.cosmosdb.partition-key", after: "speckit.cosmosdb.model" },
        { id: "speckit.cosmosdb.point-read", after: "speckit.cosmosdb.container" },
    ];
    assert.deepEqual(addPipelinePhases(state, additions).pipeline.map((entry) => entry.id), [
        "plan", "speckit.cosmosdb.model", "speckit.cosmosdb.container",
        "speckit.cosmosdb.repository", "speckit.cosmosdb.query",
        "speckit.cosmosdb.partition-key", "speckit.cosmosdb.point-read", "tasks",
    ]);
});

test("rejects unknown commands, hook targets, and missing anchors without partial results", () => {
    const state = { pipeline: [{ id: "specify" }], composition: { artifacts } };
    for (const invalid of [
        { id: "speckit.cosmosdb.unknown", after: "specify" },
        { id: "speckit.cosmosdb.advise", after: "specify" },
        { id: "speckit.cosmosdb.model", after: "missing" },
    ]) {
        assert.throws(() => addPipelinePhases(state, [
            { id: "speckit.cosmosdb.recommend", after: "specify" }, invalid,
        ]));
    }
    assert.deepEqual(state.pipeline, [{ id: "specify" }]);
});

test("canvas action persists additions and broadcasts a refreshed pipeline", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "speckit-pipeline-action-"));
    const stateDir = join(workspace, ".speckit-wizard");
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, "state.json"), JSON.stringify({
        pipeline: [{ id: "specify" }, { id: "plan" }],
        composition: { artifacts },
    }));
    const instanceId = `pipeline-test-${Date.now()}`;
    const inst = getInstance(instanceId);
    inst.workspacePath = workspace;
    const events = [];
    inst.broadcast = (event) => events.push(event);
    try {
        const action = pipelineActions.find((entry) => entry.name === "addPipelinePhases");
        const result = await action.handler({
            instanceId,
            input: { phases: [{ id: "commands/speckit.cosmosdb.recommend", after: "specify" }] },
        });
        assert.deepEqual(result.added, ["speckit.cosmosdb.recommend"]);
        assert.deepEqual(JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8")).pipeline, [
            { id: "specify" }, { id: "speckit.cosmosdb.recommend" }, { id: "plan" },
        ]);
        assert.deepEqual(events.at(-1).data.pipeline, result.pipeline);
        await assert.rejects(action.handler({
            instanceId,
            input: { phases: [{ id: "speckit.cosmosdb.advise", after: "plan" }] },
        }), /not an available, manually runnable command/);
        assert.equal(events.length, 1);
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
});
