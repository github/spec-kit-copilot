import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { artifactPath, collectArtifactEvidence, commandId, effectiveSource, readEvidenceCache, writeEvidenceCache, validateCandidates,
    validatePrimaryIndex } from "../artifact-evidence.mjs";
import { handleArtifactTargets } from "../server/handlers-ops.mjs";
import { attachOutputEvidence, outputAvailability } from "../canvas-runtime/output-availability.mjs";
import { fsDeps } from "../canvas-runtime/instances.mjs";
import { beginOutputInference as beginInferenceGroup, createOutputInferenceWorker,
    findOutputInferenceWorker, unassignedOutputRequests } from "../canvas-runtime/output-inference.mjs";
import { startRefresh } from "../canvas-runtime/refresh-status.mjs";
import { hydrateExtensionArtifactsFromCache } from "../project-scanner/extension-artifacts.mjs";
import { CORE_OUTPUTS } from "../pipeline/canonical.mjs";

const coreArtifact = (id) => ({ id: `commands/speckit.${id}`, kind: "command",
    stack: [{ layer: "core", active: true, strategy: "replace" }] });

function startWorker(inst, requests) {
    const endpoint = beginOutputInference(inst, requests);
    const { inference, worker } = findOutputInferenceWorker(inst, endpoint.searchParams.get("runId"));
    return { inference, worker, endpoint };
}

function beginOutputInference(inst, requests) {
    const inference = beginInferenceGroup(inst, requests);
    const unassigned = unassignedOutputRequests(inference);
    if (unassigned.length) {
        const { worker, endpoint } = createOutputInferenceWorker(inst, inference, unassigned);
        if (inference.workers.size === 1) inference.id = worker.id;
        return endpoint;
    }
    const worker = [...inference.workers.values()].find((candidate) =>
        requests.every((request) => candidate.requests.get(commandId(request.commandId))?.fingerprint
            === request.fingerprint));
    if (!worker) throw new Error("No worker was assigned to the requested artifact inference");
    const endpoint = new URL("/api/artifact-targets", inst.url);
    endpoint.searchParams.set("token", inst.token);
    endpoint.searchParams.set("runId", worker.id);
    return endpoint;
}

test("confirmed unchanged built-ins have immediate outputs without inference, including no-file commands", async () => {
    await fixture(async ({ root, write }) => {
        for (const id of Object.keys(CORE_OUTPUTS)) {
            await write(`.github/skills/speckit-${id}/SKILL.md`,
                `---\nname: speckit-${id}\nmetadata:\n  source: templates/commands/${id}.md\n---\nBuilt-in command.`);
        }
        const files = {};
        for (const id of Object.keys(CORE_OUTPUTS)) {
            const path = `.github/skills/speckit-${id}/SKILL.md`;
            files[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
        }
        await write(".specify/integrations/copilot.manifest.json", JSON.stringify({ integration: "copilot", files }));
        const snap = { composition: { artifacts: Object.keys(CORE_OUTPUTS).map(coreArtifact) },
            phases: { plan: { status: "empty" } }, warnings: [], specsDir: "features/current" };
        const result = await collectArtifactEvidence(root, snap);
        assert.deepEqual(result.requests, []);
        assert.equal(result.evidence.plan.candidates.length, 5);
        assert.equal(result.evidence.plan.primaryIndex, 0);
        assert.equal(result.evidence.constitution.candidates[0].path, ".specify/memory/constitution.md");
        assert.equal(result.evidence.checklist.primaryIndex, null);
        assert.equal(result.evidence.checklist.candidates[0].kind, "folder");
        for (const id of ["analyze"]) {
            assert.deepEqual(result.evidence[id].candidates, [{ kind: "none", source: "core", effect: "unknown" }]);
            assert.equal(result.evidence[id].primaryIndex, null);
        }
        await attachOutputEvidence({ workspacePath: root }, { reportedPhasePaths: {} }, snap, result);
        assert.equal(snap.phases.plan.artifactPath, "features/current/plan.md");
        assert.equal(snap.artifactInferenceRequests.length, 0);
    });
});

test("modified core skill or helper cannot use canonical output shortcut", async () => {
    await fixture(async ({ root, write }) => {
        const skill = ".github/skills/speckit-plan/SKILL.md";
        const helper = ".specify/scripts/powershell/setup-plan.ps1";
        const common = ".specify/scripts/powershell/common.ps1";
        await write(common, "common helper");
        const hash = async (path) => createHash("sha256").update(await readFile(join(root, path))).digest("hex");
        await write(".specify/integrations/copilot.manifest.json",
            JSON.stringify({ integration: "copilot", files: { [skill]: await hash(skill) } }));
        await write(".specify/integrations/speckit.manifest.json",
            JSON.stringify({ integration: "speckit", files: {
                [helper]: await hash(helper), [common]: await hash(common),
            } }));
        const snap = { pipeline: [{ id: "plan" }], composition: { artifacts: [coreArtifact("plan")] } };
        assert.equal((await collectArtifactEvidence(root, snap)).requests.length, 0);
        await write(helper, "FEATURE_DIR is reports/changed");
        assert.equal((await collectArtifactEvidence(root, snap)).requests[0].commandId, "speckit.plan");
        await write(helper, "FEATURE_DIR is specs/current");
        await write(skill, "---\nname: speckit-plan\nmetadata:\n  source: templates/commands/plan.md\n---\nWrite reports/changed.md.");
        assert.equal((await collectArtifactEvidence(root, snap)).requests[0].commandId, "speckit.plan");
    });
});

for (const change of ["replace", "wrap", "prepend", "append", "metadata", "helper", "unknown provenance"]) {
    test(`${change} retains inference instead of trusting built-in output defaults`, async () => {
        await fixture(async ({ root, write }) => {
            const artifact = coreArtifact("plan");
            const artifacts = [artifact];
            if (["replace", "wrap", "prepend", "append"].includes(change)) {
                artifact.stack.unshift({ layer: "preset", presetId: "custom", active: true, strategy: change });
            } else if (change === "metadata") {
                await write(".github/skills/speckit-plan/SKILL.md",
                    "---\nname: speckit-plan\nmetadata:\n  source: extension:custom\n---\nWrite reports/changed.md.");
            } else if (change === "helper") {
                artifacts.push({ id: "setup-plan", kind: "script",
                    stack: [{ layer: "preset", active: true, strategy: "replace" }] });
            } else artifacts.length = 0;
            const result = await collectArtifactEvidence(root, { composition: { artifacts } });
            assert.equal(result.requests.some(({ commandId }) => commandId === "speckit.plan"), true);
        });
    });
}

async function fixture(run) {
    const root = join(import.meta.dirname, `.evidence-fixture-${randomUUID()}`);
    const write = async (name, text) => {
        const path = join(root, ...name.split("/"));
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, text);
    };
    try {
        await mkdir(root, { recursive: true });
        await write(".github/skills/speckit-plan/SKILL.md",
            "---\nname: speckit-plan\n---\nWrite FEATURE_DIR/plan.md. See .specify/scripts/powershell/setup-plan.ps1");
        await write(".specify/scripts/powershell/setup-plan.ps1", "FEATURE_DIR is specs/current");
        await run({ root, write });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

function response() {
    return { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
}

test("artifact replies require a current worker ID before reading or writing cache", async () => {
    await fixture(async ({ root, write }) => {
        const baseline = '{"version":1,"entries":{"commands/kept":{"description":"Keep me"}}}';
        await write(".speckit-wizard/artifact-targets.json", baseline);
        const fingerprint = (await effectiveSource(root, "plan")).fingerprint;
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const { inference } = startWorker(inst, [{ commandId: "speckit.plan", fingerprint }]);
        let reads = 0, writes = 0;
        for (const runId of [undefined, "bad", randomUUID()]) {
            const res = response();
            await handleArtifactTargets(res, { entries: {
                "commands/speckit.plan": { writesTo: "specs/<slug>/plan.md" },
            } }, {
                getInstance: () => inst, runId,
                readSource: async () => { reads++; return { fingerprint }; },
                readCache: async () => { reads++; return { entries: {} }; },
                writeCache: async () => { writes++; },
            });
            assert.equal(res.status, runId === undefined || runId === "bad" ? 400 : 409);
            assert.match(res.body.error, /runId/);
        }
        assert.equal(reads, 0);
        assert.equal(writes, 0);
        assert.equal(await readFile(join(root, ".speckit-wizard", "artifact-targets.json"), "utf8"), baseline);
        assert.equal(inference.status, "updating");
        clearTimeout(inference.timer);
    });
});

test("a worker validates its assigned commands and rejects stale fingerprints", async () => {
    await fixture(async ({ root }) => {
        const fingerprint = (await effectiveSource(root, "plan")).fingerprint;
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const { inference, worker } = startWorker(inst, [{ commandId: "speckit.plan", fingerprint }]);
        let reads = 0;
        const res = response();
        await handleArtifactTargets(res, { entries: {
            "commands/speckit.tasks": { writesTo: "specs/<slug>/tasks.md" },
        } }, {
            getInstance: () => inst, runId: worker.id,
            readSource: async () => { reads++; return { fingerprint }; },
        });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /not assigned/);
        assert.equal(reads, 0);
        assert.equal(inference.status, "incomplete");
        assert.equal(inference.pending.size, 0);
        clearTimeout(inference.timer);
    });
});

test("a valid worker reply survives composition refresh and merges its cache entry", async () => {
    await fixture(async ({ root, write }) => {
        const baseline = '{"version":1,"entries":{"commands/kept":{"description":"Keep me"}}}';
        await write(".speckit-wizard/artifact-targets.json", baseline);
        const fingerprint = (await effectiveSource(root, "plan")).fingerprint;
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const refresh = startRefresh(inst);
        const { inference, worker } = startWorker(inst, [{ commandId: "speckit.plan", fingerprint }]);
        startRefresh(inst);
        const res = response();
        await handleArtifactTargets(res, { entries: {
            "commands/speckit.plan": { outputEvidence: {
                fingerprint, primaryIndex: null,
                candidates: [{ kind: "unknown", source: "inference",
                    effect: "unknown", evidence: "No known portable output" }],
            } },
        } }, { getInstance: () => inst, runId: worker.id });
        assert.equal(res.status, 200);
        assert.equal((await readEvidenceCache(root)).entries["commands/kept"].description, "Keep me");
        assert.equal((await readEvidenceCache(root)).entries["commands/speckit.plan"]
            .outputEvidence.fingerprint, fingerprint);
        assert.equal(inference.status, "complete");
        assert.equal(inst.outputInference, null);
        assert.notEqual(inst.refreshStatus, refresh);
        assert.equal(inst.refreshStatus.status, "refreshing");
        clearTimeout(inst.refreshStatus.timer);
    });
});

test("metadata-only reply cannot complete inference from stale cached evidence", async () => {
    await fixture(async ({ root, write }) => {
        const current = await effectiveSource(root, "plan");
        const staleEvidence = {
            fingerprint: "a".repeat(64),
            primaryIndex: null,
            candidates: [{ kind: "unknown", source: "inference", effect: "unknown",
                evidence: "Evidence from the previous skill version" }],
        };
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({
            version: 1,
            entries: { "commands/speckit.plan": { outputEvidence: staleEvidence } },
        }));
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const { inference, worker } = startWorker(inst, [
            { commandId: "speckit.plan", fingerprint: current.fingerprint },
        ]);
        const res = response();
        try {
            await handleArtifactTargets(res, { entries: {
                "commands/speckit.plan": { description: "Plan generation" },
            } }, {
                getInstance: () => inst,
                runId: worker.id,
                readSource: async () => current,
            });
            assert.equal(res.status, 200);
            assert.equal(inference.status, "incomplete");
            assert.equal(inference.failures.get("plan")?.fingerprint, current.fingerprint);
            const saved = await readEvidenceCache(root);
            assert.deepEqual(saved.entries["commands/speckit.plan"].outputEvidence, staleEvidence);
        } finally {
            clearTimeout(inference.timer);
        }
    });
});

test("a superseded worker cannot overwrite newer fingerprint evidence", async () => {
    await fixture(async ({ root }) => {
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const oldFingerprint = "a".repeat(64), newFingerprint = "b".repeat(64);
        const { worker: oldWorker, inference } = startWorker(inst,
            [{ commandId: "speckit.plan", fingerprint: oldFingerprint }]);
        let resume, entered;
        const paused = new Promise((resolve) => { entered = resolve; });
        const wait = new Promise((resolve) => { resume = resolve; });
        const evidence = (fingerprint, path) => ({ fingerprint, primaryIndex: 0,
            candidates: [{ kind: "file", path, source: "inference", effect: "creates", evidence: "Writes output" }] });
        const oldResponse = response();
        const old = handleArtifactTargets(oldResponse, { entries: {
            "commands/speckit.plan": { outputEvidence: evidence(oldFingerprint, "old.md") },
        } }, { getInstance: () => inst, runId: oldWorker.id, readSource: async () => {
            entered(); await wait; return { fingerprint: oldFingerprint };
        } });
        await paused;
        const { worker: newWorker } = startWorker(inst,
            [{ commandId: "speckit.plan", fingerprint: newFingerprint }]);
        const newResponse = response();
        await handleArtifactTargets(newResponse, { entries: {
            "commands/speckit.plan": { outputEvidence: evidence(newFingerprint, "new.md") },
        } }, { getInstance: () => inst, runId: newWorker.id,
            readSource: async () => ({ fingerprint: newFingerprint }) });
        assert.equal(newResponse.status, 200);
        resume();
        await old;
        assert.equal(oldResponse.status, 409);
        assert.equal((await readEvidenceCache(root)).entries["commands/speckit.plan"]
            .outputEvidence.candidates[0].path, "new.md");
        clearTimeout(inference.timer);
    });
});

test("superseding one command keeps the worker's other requests available", async () => {
    await fixture(async ({ root }) => {
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const old = "a".repeat(64), newer = "b".repeat(64), other = "c".repeat(64);
        const { worker, inference } = startWorker(inst, [
            { commandId: "speckit.plan", fingerprint: old },
            { commandId: "speckit.tasks", fingerprint: other },
        ]);
        beginInferenceGroup(inst, [{ commandId: "speckit.plan", fingerprint: newer }]);
        let scheduled = 0;
        inference.schedule = () => { scheduled++; };
        const res = response();
        await handleArtifactTargets(res, { entries: {
            "commands/speckit.plan": { outputEvidence: { fingerprint: old, primaryIndex: null,
                candidates: [{ kind: "unknown", source: "inference", effect: "unknown", evidence: "Unknown" }] } },
        } }, { getInstance: () => inst, runId: worker.id, readSource: async () => ({ fingerprint: newer }) });
        assert.equal(res.status, 409);
        assert.equal(inference.pending.get("tasks").fingerprint, other);
        assert.equal(inference.failures.has("tasks"), false);
        assert.equal(scheduled, 1);
        assert.deepEqual(unassignedOutputRequests(inference).map((item) => item.fingerprint).sort(), [newer, other]);
        clearTimeout(inference.timer);
    });
});

test("rejects traversal, symlink-like and invalid primary output evidence", () => {
    for (const path of ["../secret.md", "C:\\secret.md", "/secret.md",
        "specs/<slug>/<slug>/a.md", ".github/skills/a.md", "docs/con.md"]) {
        assert.equal(artifactPath(path), null);
    }
    assert.throws(() => validateCandidates([{ kind: "file", path: "x.md",
        source: "inference", effect: "creates" }], { inference: true }));
    assert.throws(() => validateCandidates([{ kind: "file", path: "x.md",
        root: { name: "FEATURE_DIR", path: "../outside" },
        source: "inference", effect: "creates", evidence: "Writes x.md" }], { inference: true }));
    assert.throws(() => validatePrimaryIndex(0, [{ kind: "folder" }]));
});

test("fingerprints effective skill and script, not composition layers", async () => {
    await fixture(async ({ root, write }) => {
        const first = await effectiveSource(root, "plan");
        const snapshot = { pipeline: [{ id: "plan" }], commands: [],
            composition: { artifacts: [{ id: "commands/speckit.plan", stack: [{ layer: "preset" }] }] } };
        const before = await collectArtifactEvidence(root, snapshot);
        assert.equal(before.requests.find(({ commandId }) => commandId === "speckit.plan").fingerprint, first.fingerprint);
        snapshot.composition.artifacts[0].stack = [{ layer: "extension" }];
        assert.equal((await collectArtifactEvidence(root, snapshot)).requests
            .find(({ commandId }) => commandId === "speckit.plan").fingerprint, first.fingerprint);
        await write(".specify/scripts/powershell/setup-plan.ps1", "FEATURE_DIR is specs/new");
        assert.notEqual((await effectiveSource(root, "plan")).fingerprint, first.fingerprint);
    });
});

test("output declaration uses the skill read for its fingerprint, without reopening it", async () => {
    await fixture(async ({ root, write }) => {
        await write(".github/skills/speckit-plan/SKILL.md",
            "---\nname: speckit-plan\nartifact: specs/<slug>/plan.md\n---\nWrite specs/<slug>/plan.md.");
        const snapshot = { pipeline: [{ id: "plan" }], commands: [],
            composition: { artifacts: [] } };
        let skillReads = 0;
        const result = await collectArtifactEvidence(root, snapshot, async (path, flags) => {
            if (path.endsWith("SKILL.md")) skillReads++;
            return open(path, flags);
        });
        assert.equal(skillReads, 1);
        assert.equal(result.evidence.plan.candidates[0].path, "specs/<slug>/plan.md");
        assert.equal(result.requests.find(({ commandId }) => commandId === "speckit.plan").fingerprint,
            (await effectiveSource(root, "plan")).fingerprint);
    });
});

test("a null inferred primary retains an explicit file declaration", async () => {
    await fixture(async ({ root, write }) => {
        await write(".github/skills/speckit-plan/SKILL.md",
            "---\nname: speckit-plan\nartifact: specs/<slug>/plan.md\n---\nWrite the plan.");
        const fingerprint = (await effectiveSource(root, "plan")).fingerprint;
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({
            entries: { "commands/speckit.plan": { outputEvidence: {
                fingerprint, primaryIndex: null,
                candidates: [{ kind: "unknown", source: "inference", effect: "unknown",
                    evidence: "No primary output identified" }],
            } } },
        }));
        const snap = { pipeline: [{ id: "plan" }], commands: [],
            composition: { artifacts: [] }, phases: { plan: { status: "empty" } },
            specsDir: "specs/current", warnings: [] };
        const outputs = await collectArtifactEvidence(root, snap);
        assert.equal(outputs.evidence.plan.primaryIndex, 0);
        assert.equal(outputs.evidence.plan.candidates[0].source, "declaration");
        await attachOutputEvidence({ workspacePath: root }, { reportedPhasePaths: {} }, snap, outputs);
        assert.equal(snap.phases.plan.artifactPath, "specs/current/plan.md");
    });
});

for (const [source, kind, path] of [
    ["declaration", "file", "specs/<slug>/plan.md"],
    ["declaration", "folder", "specs/<slug>/outputs/"],
    ["manual", "file", "specs/<slug>/plan.md"],
    ["manual", "folder", "specs/<slug>/outputs/"],
]) {
    test(`${source} ${kind} output discards contradictory inferred no-file evidence`, async () => {
        await fixture(async ({ root, write }) => {
            if (source === "declaration") {
                await write(".github/skills/speckit-plan/SKILL.md",
                    `---\nname: speckit-plan\nartifact: ${path}\n---\nWrite the plan.`);
            }
            const fingerprint = (await effectiveSource(root, "plan")).fingerprint;
            await write(".speckit-wizard/artifact-targets.json", JSON.stringify({
                entries: { "commands/speckit.plan": {
                    ...(source === "manual" ? { source, writesTo: path } : {}),
                    outputEvidence: { fingerprint, primaryIndex: null,
                        candidates: [
                            { kind: "none", source: "inference", effect: "unknown",
                                evidence: "No file output was inferred" },
                            { kind: "unknown", source: "inference", effect: "unknown",
                                evidence: "Another output remains uncertain" },
                        ] },
                } },
            }));
            const outputs = await collectArtifactEvidence(root,
                { pipeline: [{ id: "plan" }], commands: [], composition: { artifacts: [] } });
            assert.deepEqual(outputs.evidence.plan.candidates.map(({ kind: outputKind }) => outputKind),
                [kind, "unknown"]);
            assert.equal(outputs.evidence.plan.candidates[0].source, source);
            assert.equal(outputs.evidence.plan.candidates[0].path, path);
            assert.equal(outputs.evidence.plan.primaryIndex, kind === "file" ? 0 : null);
        });
    });
}

test("a failed command source read marks output collection incomplete without changing refresh status", async () => {
    await fixture(async ({ root, write }) => {
        await write(".github/skills/speckit-specify/SKILL.md", "Writes specs/<slug>/spec.md");
        const result = await collectArtifactEvidence(root,
            { pipeline: [{ id: "plan" }, { id: "specify" }], commands: [] }, async (path, flags) => {
                if (path.endsWith("speckit-plan\\SKILL.md")
                    || path.endsWith("speckit-plan/SKILL.md")) throw new Error("source read failed");
                return open(path, flags);
            });
        assert.equal(result.incomplete, true);
        assert.ok(result.warnings.some((warning) => warning.includes("plan: source read failed")));
        assert.ok(!result.requests.some(({ commandId }) => commandId === "speckit.plan"));
        assert.ok(result.requests.some(({ commandId }) => commandId === "speckit.specify"));
        const inst = { workspacePath: root, broadcast() {} };
        const refresh = startRefresh(inst);
        const snap = { warnings: [], phases: {}, commands: [], specsDir: null };
        await attachOutputEvidence(inst, {}, snap, result);
        assert.equal(snap.artifactEvidenceIncomplete, true);
        assert.equal(snap.refreshStatus, "refreshing");
        assert.equal(inst.refreshStatus.status, refresh.status);
        clearTimeout(refresh.timer);
    });
});

test("unreadable commands outside the selected pipeline do not block preparation", async () => {
    await fixture(async ({ root, write }) => {
        await write(".github/skills/speckit-specify/SKILL.md", "Writes specs/<slug>/spec.md");
        const result = await collectArtifactEvidence(root,
            { pipeline: [{ id: "specify" }], commands: [{ id: "plan" }] }, async (path, flags) => {
                if (path.endsWith("speckit-plan\\SKILL.md") || path.endsWith("speckit-plan/SKILL.md")) {
                    throw new Error("source read failed");
                }
                return open(path, flags);
            });
        assert.equal(result.incomplete, false);
        assert.ok(result.warnings.some((warning) => warning.includes("plan: source read failed")));
    });
});

test("output evidence collection does not alter composition refresh status", async () => {
    await fixture(async ({ root, write }) => {
        const snap = { pipeline: [{ id: "plan" }], commands: [], composition: { artifacts: [] },
            phases: {}, warnings: [], specsDir: null };
        const pending = await collectArtifactEvidence(root, snap);
        const request = pending.requests.find(({ commandId }) => commandId === "speckit.plan");
        assert.ok(request);
        const refresh = { status: "up-to-date", id: "refresh" };
        const inst = { workspacePath: root, refreshStatus: refresh, broadcast() {} };
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({ entries: {
            "commands/speckit.plan": { outputEvidence: { fingerprint: request.fingerprint,
                primaryIndex: 0, candidates: [{ kind: "file", path: "specs/<slug>/plan.md",
                    source: "inference", effect: "creates", evidence: "Plan writes a Markdown file" }] } },
        } }));
        const oldSnapshot = { ...snap, phases: {}, warnings: [] };
        await attachOutputEvidence(inst, {}, oldSnapshot, pending);
        assert.equal(oldSnapshot.refreshStatus, "up-to-date");
        assert.equal(inst.refreshStatus, refresh);
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({ entries: {} }));
        const nextSnapshot = { ...snap, phases: {}, warnings: [] };
        await attachOutputEvidence(inst, {}, nextSnapshot, pending);
        assert.equal(nextSnapshot.refreshStatus, "up-to-date");
        assert.equal(inst.refreshStatus, refresh);
    });
});

test("output evidence snapshots do not change composition refresh status", async () => {
    await fixture(async ({ root }) => {
        const snap = { pipeline: [{ id: "plan" }], commands: [], composition: { artifacts: [] },
            phases: {}, warnings: [], specsDir: null };
        const pending = await collectArtifactEvidence(root, snap);
        const inst = { workspacePath: root, refreshStatus: { status: "up-to-date", id: "old" },
            broadcast() {} };
        await attachOutputEvidence(inst, {}, snap, pending);
        assert.equal(snap.refreshStatus, "up-to-date");
        const newer = startRefresh(inst);
        assert.equal(inst.refreshStatus, newer);
        assert.equal(inst.refreshStatus.status, "refreshing");
        clearTimeout(newer.timer);
    });
});

test("a malformed cache reread reports a warning without aborting the snapshot", async () => {
    await fixture(async ({ root, write }) => {
        const snap = { pipeline: [{ id: "plan" }], commands: [], composition: { artifacts: [] },
            phases: {}, warnings: [], specsDir: null };
        const pending = await collectArtifactEvidence(root, snap);
        const inst = { workspacePath: root, refreshStatus: { status: "up-to-date", id: "refresh" },
            broadcast() {} };
        await write(".speckit-wizard/artifact-targets.json", "{");
        const malformed = await collectArtifactEvidence(root, snap);
        await attachOutputEvidence(inst, {}, snap, malformed);
        assert.ok(snap.warnings.some((warning) => warning.includes("Unexpected end")
            || warning.includes("JSON")));
        assert.equal(snap.refreshStatus, "up-to-date");
        assert.equal(inst.refreshStatus.status, "up-to-date");
    });
});

test("inferred outputs with the same named root and filename retain distinct root paths", async () => {
    await fixture(async ({ root, write }) => {
        const fingerprint = (await effectiveSource(root, "plan")).fingerprint;
        const candidates = ["specs/first", "specs/second"].map((path) => ({
            kind: "file", path: "plan.md", root: { name: "FEATURE_DIR", path },
            source: "inference", effect: "creates", evidence: `Writes ${path}/plan.md`,
        }));
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({
            entries: { "commands/speckit.plan": { outputEvidence: {
                fingerprint, candidates, primaryIndex: 1,
            } } },
        }));
        const snapshot = { pipeline: [{ id: "plan" }], commands: [],
            composition: { artifacts: [] } };
        const result = await collectArtifactEvidence(root, snapshot);
        assert.deepEqual(result.evidence.plan.candidates.map(({ root: outputRoot }) => outputRoot?.path),
            ["specs/first", "specs/second"]);
        assert.equal(result.evidence.plan.primaryIndex, 1);
    });
});

test("source reads reject a replaced handle and an oversized file swapped after path checks", async () => {
    await fixture(async ({ root }) => {
        const other = join(root, ".specify", "scripts", "powershell", "setup-plan.ps1");
        await assert.rejects(effectiveSource(root, "plan", (path, flags) =>
            open(path.endsWith("SKILL.md") ? other : path, flags)), /Invalid artifact evidence source/);
        await assert.rejects(effectiveSource(root, "plan", async (path, flags) => {
            if (path.endsWith("SKILL.md")) await writeFile(path, "x".repeat(512 * 1024 + 1));
            return open(path, flags);
        }), /Invalid artifact evidence source/);
    });
});

test("source reads stay bounded when the opened file grows after stat", async () => {
    await fixture(async ({ root }) => {
        await assert.rejects(effectiveSource(root, "plan", async (path, flags) => {
            const file = await open(path, flags);
            let expanded = false;
            return {
                stat: () => file.stat(),
                read: async (...args) => {
                    if (!expanded) {
                        expanded = true;
                        await appendFile(path, "x".repeat(512 * 1024 + 1));
                    }
                    return file.read(...args);
                },
                close: () => file.close(),
            };
        }), /Oversized artifact evidence source/);
    });
});

test("source reads reject a parent replaced by a link after path checks", async () => {
    await fixture(async ({ root }) => {
        const parent = join(root, ".github", "skills", "speckit-plan");
        const backup = `${parent}-original`;
        const outside = await mkdtemp(join(tmpdir(), "evidence-source-"));
        let swapped = false;
        try {
            await writeFile(join(outside, "SKILL.md"), "Unexpected outside content");
            await assert.rejects(effectiveSource(root, "plan", async (path, flags) => {
                if (path.endsWith("SKILL.md")) {
                    await rename(parent, backup);
                    await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
                    swapped = true;
                }
                return open(path, flags);
            }), /Invalid artifact evidence source/);
        } finally {
            if (swapped) await rm(parent);
            if (swapped) await rename(backup, parent);
            await rm(outside, { recursive: true, force: true });
        }
    });
});

test("cache reads reject a replaced handle and remain bounded if the file grows", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", '{"version":1,"entries":{}}');
        const other = join(root, ".specify", "scripts", "powershell", "setup-plan.ps1");
        await assert.rejects(readEvidenceCache(root, (_path, flags) =>
            open(other, flags)), /Unsafe artifact cache/);
        await assert.rejects(readEvidenceCache(root, async (path, flags) => {
            const file = await open(path, flags);
            let expanded = false;
            return {
                stat: () => file.stat(),
                read: async (...args) => {
                    if (!expanded) {
                        expanded = true;
                        await appendFile(path, "x".repeat(512 * 1024 + 1));
                    }
                    return file.read(...args);
                },
                close: () => file.close(),
            };
        }), /Unsafe artifact cache/);
    });
});

test("cache reads reject a parent replaced by a link after validation", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", '{"version":1,"entries":{}}');
        const parent = join(root, ".speckit-wizard");
        const backup = `${parent}-original`;
        const outside = await mkdtemp(join(tmpdir(), "evidence-cache-"));
        let swapped = false;
        try {
            await writeFile(join(outside, "artifact-targets.json"), '{"version":1,"entries":{}}');
            await assert.rejects(readEvidenceCache(root, async (path, flags) => {
                await rename(parent, backup);
                await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
                swapped = true;
                return open(path, flags);
            }), /Unsafe artifact cache/);
        } finally {
            if (swapped) await rm(parent);
            if (swapped) await rename(backup, parent);
            await rm(outside, { recursive: true, force: true });
        }
    });
});

test("cache writes replace a swapped destination link without changing its target", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", '{"version":1,"entries":{}}');
        const outside = await mkdtemp(join(dirname(root), ".evidence-write-"));
        const external = join(outside, "unrelated.json");
        const payload = '{"version":1,"entries":{"commands/speckit.plan":{}}}\n';
        try {
            await writeFile(external, "leave untouched");
            await writeEvidenceCache(root, payload, async (temp, target) => {
                await rm(target);
                if (process.platform === "win32") await link(external, target);
                else await symlink(external, target, "file");
                await rename(temp, target);
            });
            assert.equal(await readFile(external, "utf8"), "leave untouched");
            assert.equal(await readFile(join(root, ".speckit-wizard", "artifact-targets.json"), "utf8"), payload);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });
});

test("cache writes refuse a linked cache directory and clean up failed temp files", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", '{"version":1,"entries":{}}');
        const directory = join(root, ".speckit-wizard");
        await assert.rejects(writeEvidenceCache(root, "{}", async () => {
            throw new Error("rename failed");
        }), /rename failed/);
        assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);

        const backup = `${directory}-original`;
        const outside = await mkdtemp(join(tmpdir(), "evidence-linked-cache-"));
        let swapped = false;
        try {
            await rename(directory, backup);
            await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
            swapped = true;
            await assert.rejects(writeEvidenceCache(root, "{}"), /Unsafe artifact cache directory/);
            assert.deepEqual(await readdir(outside), []);
        } finally {
            if (swapped) await rm(directory);
            if (swapped) await rename(backup, directory);
            await rm(outside, { recursive: true, force: true });
        }
    });
});

test("scanner rejects a linked cache directory", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", '{"version":1,"entries":{}}');
        const directory = join(root, ".speckit-wizard");
        const backup = `${directory}-original`;
        const outside = await mkdtemp(join(tmpdir(), "evidence-scanner-read-"));
        let swapped = false;
        try {
            await writeFile(join(outside, "artifact-targets.json"), '{"version":1,"entries":{}}');
            await rename(directory, backup);
            await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
            swapped = true;
            await assert.rejects(hydrateExtensionArtifactsFromCache({
                cwd: root, phases: {}, slug: null, deps: fsDeps,
            }), /Linked artifact cache directory/);
        } finally {
            if (swapped) await rm(directory);
            if (swapped) await rename(backup, directory);
            await rm(outside, { recursive: true, force: true });
        }
    });
});

test("scanner hydration never writes through a swapped cache link", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({
            version: 1, entries: {
                "commands/speckit.orphan": { writesTo: "specs/<slug>/orphan.md" },
            },
        }));
        const cachePath = join(root, ".speckit-wizard", "artifact-targets.json");
        const outside = await mkdtemp(join(dirname(root), ".evidence-scanner-write-"));
        const external = join(outside, "unrelated.json");
        try {
            await writeFile(external, "leave untouched");
            const warnings = [];
            await hydrateExtensionArtifactsFromCache({
                cwd: root, phases: {}, slug: null, warnings,
                deps: { ...fsDeps, readEvidenceCache: async (cwd) => {
                    const cache = await readEvidenceCache(cwd);
                    await rm(cachePath);
                    await link(external, cachePath);
                    return cache;
                } },
            });
            assert.deepEqual(warnings, []);
            assert.equal(await readFile(external, "utf8"), "leave untouched");
            assert.equal(await readFile(cachePath, "utf8"), "leave untouched");
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });
});

test("unreadable cache immediately marks active output inference incomplete", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", "{invalid json");
        const events = [];
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test",
            broadcast: (event) => events.push(event) };
        const refresh = startRefresh(inst);
        const { inference, worker } = startWorker(inst, [
            { commandId: "speckit.plan", fingerprint: "a".repeat(64) },
        ]);
        const res = response();
        await handleArtifactTargets(res, { entries: {
            "commands/speckit.plan": { writesTo: "specs/<slug>/plan.md" },
        } }, { getInstance: () => inst, runId: worker.id, broadcast: (event) => events.push(event) });
        assert.equal(res.status, 500);
        assert.match(res.body.error, /Artifact cache was not overwritten/);
        assert.equal(inference.status, "incomplete");
        assert.equal(inference.pending.size, 0);
        assert.equal(inference.failures.has("plan"), true);
        assert.equal(inst.refreshStatus, refresh);
        assert.equal(inst.refreshStatus.status, "refreshing");
        assert.ok(events.length > 0);
    });
});

test("oversized and unwritable artifact caches fail an active inference immediately", async () => {
    await fixture(async ({ root }) => {
        for (const [entry, options, status, message] of [
            [{ writesTo: "specs/<slug>/plan.md", description: "x".repeat(512 * 1024) },
                {}, 400, /exceeds its size limit/],
            [{ writesTo: "specs/<slug>/plan.md" },
                { writeCache: async () => { throw new Error("disk unavailable"); } },
                500, /Artifact cache was not overwritten: disk unavailable/],
        ]) {
            const events = [];
            const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test",
                broadcast: (event) => events.push(event) };
            const refresh = startRefresh(inst);
            const { inference, worker } = startWorker(inst, [
                { commandId: "speckit.plan", fingerprint: "a".repeat(64) },
            ]);
            const res = response();
            await handleArtifactTargets(res, { entries: { "commands/speckit.plan": entry } },
                { getInstance: () => inst, runId: worker.id,
                    broadcast: (event) => events.push(event), ...options });
            assert.equal(res.status, status);
            assert.match(res.body.error, message);
            assert.equal(inference.status, "incomplete");
            assert.equal(inst.refreshStatus, refresh);
            assert.equal(inst.refreshStatus.status, "refreshing");
            assert.ok(events.length > 0);
        }
    });
});

test("an empty filtered inference response fails only its worker", async () => {
    await fixture(async ({ root }) => {
        const events = [];
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test",
            broadcast: (event) => events.push(event) };
        const refresh = startRefresh(inst);
        const { inference, worker } = startWorker(inst, [
            { commandId: "speckit.plan", fingerprint: "a".repeat(64) },
        ]);
        const res = response();
        await handleArtifactTargets(res, { entries: {
            "commands/speckit.plan": {},
        } }, { getInstance: () => inst, runId: worker.id, broadcast: (event) => events.push(event) });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /no valid entries/);
        assert.equal(inference.status, "incomplete");
        assert.equal(inst.refreshStatus, refresh);
        assert.equal(inst.refreshStatus.status, "refreshing");
        assert.ok(events.length > 0);
    });
});

test("changed sources require a new worker while preserving the newer request", async () => {
    for (const path of [".github/skills/speckit-plan/SKILL.md",
        ".specify/scripts/powershell/setup-plan.ps1"]) {
        await fixture(async ({ root }) => {
            const initial = await effectiveSource(root, "plan");
            const inst = { workspacePath: root, url: "http://127.0.0.1:1234",
                token: "test", broadcast() {} };
            const old = startWorker(inst, [{ commandId: "speckit.plan", fingerprint: initial.fingerprint }]);
            await appendFile(join(root, ...path.split("/")), "\n# changed");
            const current = await effectiveSource(root, "plan");
            assert.notEqual(current.fingerprint, initial.fingerprint);
            const next = startWorker(inst, [{ commandId: "speckit.plan", fingerprint: current.fingerprint }]);
            const res = response();
            try {
                await handleArtifactTargets(res, { entries: {
                    "commands/speckit.plan": { outputEvidence: {
                        fingerprint: initial.fingerprint, primaryIndex: null,
                        candidates: [{ kind: "unknown", source: "inference", effect: "unknown",
                            evidence: "The old source is no longer current." }],
                    } },
                } }, { getInstance: () => inst, runId: old.worker.id, broadcast() {} });
                assert.equal(res.status, 409);
                assert.equal(next.inference.pending.get("plan").fingerprint, current.fingerprint);
                assert.equal(next.inference.workers.has(next.worker.id), true);

                const currentReply = response();
                await handleArtifactTargets(currentReply, { entries: {
                    "commands/speckit.plan": { outputEvidence: {
                        fingerprint: current.fingerprint, primaryIndex: 0,
                        candidates: [{ kind: "file", path: "plan.md", relativeTo: "feature",
                            source: "inference", effect: "creates", evidence: "Writes FEATURE_DIR/plan.md." }],
                    } },
                } }, { getInstance: () => inst, runId: next.worker.id, broadcast() {} });
                assert.equal(currentReply.status, 200);
                assert.equal((await readEvidenceCache(root)).entries["commands/speckit.plan"]
                    .outputEvidence.fingerprint, current.fingerprint);
                assert.equal(inst.outputInference, null);
                const collected = await collectArtifactEvidence(root, { commands: [], pipeline: [{ id: "plan" }] });
                assert.ok(!collected.requests.some(({ commandId }) => commandId === "speckit.plan"));
            } finally {
                clearTimeout(old.inference.timer);
            }
        });
    }
});

test("partial evidence completes submitted outputs and marks remaining commands incomplete", async () => {
    await fixture(async ({ root, write }) => {
        await write(".github/skills/speckit-tasks/SKILL.md", "Write FEATURE_DIR/tasks.md.");
        const plan = await effectiveSource(root, "plan");
        const tasks = await effectiveSource(root, "tasks");
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const refresh = startRefresh(inst);
        const { inference, worker } = startWorker(inst, [
            { commandId: "speckit.plan", fingerprint: plan.fingerprint },
            { commandId: "speckit.tasks", fingerprint: tasks.fingerprint },
        ]);
        const res = response();
        try {
            await handleArtifactTargets(res, { entries: {
                "commands/speckit.plan": { outputEvidence: {
                    fingerprint: plan.fingerprint, primaryIndex: 0,
                    candidates: [{ kind: "file", path: "plan.md", relativeTo: "feature",
                        source: "inference", effect: "creates", evidence: "Writes FEATURE_DIR/plan.md." }],
                } },
                "commands/speckit.tasks": { description: "Task generation" },
            } }, { getInstance: () => inst, runId: worker.id, broadcast() {} });
            assert.equal(res.status, 200);
            assert.deepEqual([...inference.pending.keys()], []);
            assert.equal(inference.status, "incomplete");
            assert.equal(inference.failures.has("tasks"), true);
            assert.equal(inst.outputInference, inference);
            assert.equal(inst.refreshStatus, refresh);
            assert.equal(inst.refreshStatus.status, "refreshing");
        } finally {
            clearTimeout(inference.timer);
            clearTimeout(inst.refreshStatus.timer);
        }
    });
});

test("stale evidence is rejected without completing pending inference", async () => {
    await fixture(async ({ root }) => {
        const initial = await effectiveSource(root, "plan");
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const refresh = startRefresh(inst);
        const { inference, worker } = startWorker(inst, [
            { commandId: "speckit.plan", fingerprint: initial.fingerprint },
        ]);
        await appendFile(join(root, ".github", "skills", "speckit-plan", "SKILL.md"), "\n# changed");
        const res = response();
        try {
            await handleArtifactTargets(res, { entries: {
                "commands/speckit.plan": { outputEvidence: {
                    fingerprint: initial.fingerprint, primaryIndex: null,
                    candidates: [{ kind: "unknown", source: "inference", effect: "unknown",
                        evidence: "No fixed output established." }],
                } },
            } }, { getInstance: () => inst, runId: worker.id, broadcast() {} });
            assert.equal(res.status, 409);
            assert.equal(inference.pending.size, 0);
            assert.equal(inference.status, "incomplete");
            assert.equal(inst.refreshStatus, refresh);
            assert.equal(inst.refreshStatus.status, "refreshing");
            assert.deepEqual((await readEvidenceCache(root)).entries, {});
        } finally {
            clearTimeout(inference.timer);
            clearTimeout(inst.refreshStatus.timer);
        }
    });
});

for (const replacement of ["refresh", "pipeline request", "both"]) {
    test(`an assigned artifact worker remains valid across ${replacement} changes`, async () => {
        await fixture(async ({ root }) => {
            const current = await effectiveSource(root, "plan");
            const request = { commandId: "speckit.plan", fingerprint: current.fingerprint };
            const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
            startRefresh(inst);
            beginOutputInference(inst, [request], inst.refreshStatus);
            const previous = inst.outputInference;
            const res = response();
            try {
                await handleArtifactTargets(res, { entries: {
                    "commands/speckit.plan": { outputEvidence: {
                        fingerprint: current.fingerprint, primaryIndex: 0,
                        candidates: [{ kind: "file", path: "plan.md", relativeTo: "feature",
                            source: "inference", effect: "creates", evidence: "Writes FEATURE_DIR/plan.md." }],
                    } },
                } }, {
                    getInstance: () => inst, runId: previous.id, broadcast() {},
                    writeCache: async (cwd, payload, renameFile, beforeCommit) => {
                        if (replacement !== "pipeline request") startRefresh(inst);
                        if (replacement !== "refresh") beginOutputInference(inst, [request]);
                        await writeEvidenceCache(cwd, payload, renameFile, beforeCommit);
                    },
                });
                assert.equal(res.status, 200);
                assert.equal((await readEvidenceCache(root)).entries["commands/speckit.plan"]
                    .outputEvidence.fingerprint, current.fingerprint);
                assert.ok(!(await readdir(join(root, ".speckit-wizard")))
                    .some((name) => name.endsWith(".tmp")));
                assert.equal(previous.pending.size, 0);
                assert.equal(inst.outputInference, null);
                if (replacement !== "pipeline request") assert.equal(inst.refreshStatus.status, "refreshing");
            } finally {
                clearTimeout(previous.timer);
                clearTimeout(inst.refreshStatus.timer);
            }
        });
    });
}

test("an artifact cache failure leaves composition refresh independent", async () => {
    await fixture(async ({ root }) => {
        const current = await effectiveSource(root, "plan");
        const request = { commandId: "speckit.plan", fingerprint: current.fingerprint };
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const refresh = startRefresh(inst);
        beginOutputInference(inst, [request]);
        const previous = inst.outputInference;
        const res = response();
        try {
            await handleArtifactTargets(res, { entries: {
                "commands/speckit.plan": { writesTo: "specs/<slug>/plan.md" },
            } }, {
                getInstance: () => inst, runId: previous.id, broadcast() {},
                readCache: async () => {
                    startRefresh(inst);
                    throw new Error("old cache read failed");
                },
            });
            assert.equal(res.status, 500);
            assert.match(res.body.error, /old cache read failed/);
            assert.equal(previous.status, "incomplete");
            assert.equal(previous.pending.size, 0);
            assert.equal(inst.outputInference, previous);
            assert.notEqual(inst.refreshStatus, refresh);
            assert.equal(inst.refreshStatus.status, "refreshing");
        } finally {
            clearTimeout(inst.outputInference?.timer);
            clearTimeout(inst.refreshStatus.timer);
        }
    });
});

for (const failure of ["fingerprint rejection", "invalid evidence", "source read", "cache read",
    "cache size", "cache write"]) {
    test(`artifact ${failure} failure is isolated from composition refresh`, async () => {
        await fixture(async ({ root }) => {
            const current = await effectiveSource(root, "plan");
            const request = { commandId: "speckit.plan", fingerprint: current.fingerprint };
            const events = [];
            const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test",
                broadcast: (event) => events.push(event) };
            const restart = () => {
                startRefresh(inst);
                beginOutputInference(inst, [request]);
            };
            restart();
            const previous = inst.outputInference;
            const entry = { outputEvidence: {
                fingerprint: failure === "fingerprint rejection" ? "0".repeat(64) : current.fingerprint,
                primaryIndex: 0,
                candidates: failure === "invalid evidence" ? [] : [
                    { kind: "file", path: "plan.md", relativeTo: "feature",
                        source: "inference", effect: "creates", evidence: "Writes FEATURE_DIR/plan.md." },
                ],
            } };
            const deps = { getInstance: () => inst, runId: previous.id,
                broadcast: (event) => events.push(event) };
            let status, message;
            if (["fingerprint rejection", "invalid evidence", "source read"].includes(failure)) {
                deps.readSource = async () => {
                    restart();
                    if (failure === "source read") throw new Error("source unavailable");
                    return current;
                };
                status = failure === "fingerprint rejection" ? 409 : 400;
                message = failure === "fingerprint rejection" ? /fingerprint mismatch/
                    : failure === "invalid evidence" ? /Inference must report a result/ : /source unavailable/;
            } else if (failure === "cache write") {
                deps.writeCache = async () => {
                    restart();
                    throw new Error("disk unavailable");
                };
                status = 500;
                message = /Artifact cache was not overwritten: disk unavailable/;
            } else {
                deps.readCache = async () => {
                    restart();
                    if (failure === "cache read") throw new Error("cache unavailable");
                    return { entries: {
                        "commands/speckit.large": { description: "x".repeat(512 * 1024) },
                    } };
                };
                status = failure === "cache read" ? 500 : 400;
                message = failure === "cache read" ? /Artifact cache was not overwritten: cache unavailable/
                    : /exceeds its size limit/;
            }
            const res = response();
            try {
                await handleArtifactTargets(res, { entries: { "commands/speckit.plan": entry } }, deps);
                assert.equal(res.status, status);
                assert.match(res.body.error, message);
                assert.equal(inst.outputInference, previous);
                assert.equal(previous.status, "incomplete");
                assert.equal(previous.pending.size, 0);
                assert.equal(previous.workers.size, 0);
                assert.equal(previous.timer, null);
                assert.equal(inst.refreshStatus.status, "refreshing");
                assert.ok(events.length > 0);
            } finally {
                clearTimeout(previous.timer);
                clearTimeout(inst.refreshStatus.timer);
            }
        });
    });
}

test("endpoint rejects stale evidence and merges current candidates without erasing manual hints", async () => {
    await fixture(async ({ root, write }) => {
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({
            entries: { "commands/speckit.plan": {
                writesTo: "specs/<slug>/old.md", source: "manual", argsHint: "Keep this hint",
            } },
        }));
        const inst = { workspacePath: root, url: "http://127.0.0.1:1234", token: "test", broadcast() {} };
        const fingerprint = (await effectiveSource(root, "plan")).fingerprint;
        const initialEndpoint = beginOutputInference(inst, [{ commandId: "speckit.plan", fingerprint }]);
        const inference = inst.outputInference;
        const deps = { getInstance: () => inst,
            runId: initialEndpoint.searchParams.get("runId"), broadcast() {} };
        const candidate = { kind: "file", path: "plan.md", relativeTo: "feature",
            source: "inference", effect: "creates", evidence: "The skill writes FEATURE_DIR/plan.md." };
        const entry = { outputEvidence: { fingerprint: "0".repeat(64),
            candidates: [candidate], primaryIndex: 0 } };
        const stale = response();
        await handleArtifactTargets(stale, { entries: { "commands/speckit.plan": entry } }, deps);
        assert.equal(stale.status, 409);
        const unsafeEndpoint = beginOutputInference(inst, [{ commandId: "speckit.plan", fingerprint }]);
        deps.runId = unsafeEndpoint.searchParams.get("runId");
        entry.outputEvidence.fingerprint = fingerprint;
        const unsafe = response();
        entry.outputEvidence.candidates = [{ ...candidate, path: "../secrets.md" }];
        await handleArtifactTargets(unsafe, { entries: { "commands/speckit.plan": entry } }, deps);
        assert.equal(unsafe.status, 400);
        const validEndpoint = beginOutputInference(inst, [{ commandId: "speckit.plan", fingerprint }]);
        deps.runId = validEndpoint.searchParams.get("runId");
        entry.outputEvidence.candidates = [candidate];
        const valid = response();
        await handleArtifactTargets(valid, { entries: { "commands/speckit.plan": entry } }, deps);
        assert.equal(valid.status, 200);
        const saved = JSON.parse(await readFile(join(root, ".speckit-wizard", "artifact-targets.json"), "utf8"))
            .entries["commands/speckit.plan"];
        assert.equal(saved.source, "manual");
        assert.equal(saved.argsHint, "Keep this hint");
        assert.equal(saved.outputEvidence.candidates[0].path, "plan.md");
        assert.equal(saved.outputEvidence.primaryIndex, 0);
    });
});

test("output availability resolves only existing safe files and folders", async () => {
    await fixture(async ({ root, write }) => {
        await write("specs/current/plan.md", "# plan");
        const candidate = { kind: "file", path: "plan.md", relativeTo: "feature" };
        assert.equal((await outputAvailability(root, candidate, "specs/current")).filePath,
            "specs/current/plan.md");
        assert.equal((await outputAvailability(root, candidate, null)).filePath, undefined);
        assert.deepEqual(await outputAvailability(root, { kind: "file", path: "missing.md" }, null),
            { browsePath: "", resolvedPath: "missing.md" });
        const named = await outputAvailability(root, { kind: "file", path: "next.md",
            root: { name: "FEATURE_DIR", path: "specs/<slug>" } }, null);
        assert.equal(named.resolvedPath, "specs/current/next.md");
        assert.equal(named.folderPath, "specs/current");
        assert.equal(named.filePath, undefined);
    });
});

test("snapshot projects multiple core outputs and installed extension no-file evidence", async () => {
    await fixture(async ({ root, write }) => {
        await write(".github/skills/speckit-assess-intake/SKILL.md",
            "---\nname: speckit-assess-intake\n---\nInspect the idea without writing files.");
        await write(".specify/extensions/assess/commands/speckit.assess.intake.md", "# Intake");
        await write("specs/current/plan.md", "# Plan");
        await write("specs/current/research.md", "# Research");
        const plan = await effectiveSource(root, "plan");
        const extension = await effectiveSource(root, "speckit.assess.intake");
        await write(".speckit-wizard/artifact-targets.json", JSON.stringify({
            entries: {
                "commands/speckit.plan": {
                    outputEvidence: { fingerprint: plan.fingerprint, primaryIndex: 0,
                        candidates: [
                            { kind: "file", path: "plan.md", relativeTo: "feature",
                                source: "inference", effect: "creates", evidence: "Writes FEATURE_DIR/plan.md" },
                            { kind: "file", path: "research.md", relativeTo: "feature",
                                source: "inference", effect: "creates", evidence: "Writes FEATURE_DIR/research.md" },
                        ] },
                },
                "commands/speckit.assess.intake": {
                    outputEvidence: { fingerprint: extension.fingerprint, primaryIndex: null,
                        candidates: [{ kind: "none", source: "inference", effect: "unknown",
                            evidence: "Skill explicitly forbids file writes" }] },
                },
            },
        }));
        const snap = { pipeline: [{ id: "plan" }], commands: [], composition: { artifacts: [] },
            phases: { plan: { status: "empty" },
                "commands/speckit.assess.intake": { status: "empty" } },
            specsDir: "specs/current", warnings: [] };
        const outputs = await collectArtifactEvidence(root, snap);
        assert.deepEqual(outputs.requests.filter(({ commandId }) =>
            ["speckit.plan", "speckit.assess.intake"].includes(commandId)), []);
        const inst = { workspacePath: root };
        await attachOutputEvidence(inst, { reportedPhasePaths: {} }, snap, outputs);
        assert.equal(snap.phases.plan.artifactPath, "specs/current/plan.md");
        assert.equal(snap.outputAvailability.plan.candidates
            .filter(({ filePath }) => filePath).length, 2);
        assert.equal(snap.phases["commands/speckit.assess.intake"].artifactPath, null);
        assert.equal(snap.artifactEvidence["speckit.assess.intake"].primaryIndex, null);
    });
});
