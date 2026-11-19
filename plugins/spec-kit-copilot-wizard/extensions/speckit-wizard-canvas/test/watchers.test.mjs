import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
    startArtifactWatcher, startStateWatcher, stopArtifactWatcher, stopStateWatcher,
} from "../canvas-runtime/watchers.mjs";
import { fsDeps, newInstance } from "../canvas-runtime/instances.mjs";
import { readState } from "../state/store.mjs";

test("state watcher refreshes catalogs when project initialization completes", async (t) => {
    const workspacePath = await mkdtemp(join(tmpdir(), "wizard-catalog-init-"));
    t.after(() => rm(workspacePath, { recursive: true, force: true }));
    const stateDir = join(workspacePath, ".speckit-wizard");
    await mkdir(stateDir);
    const statePath = join(stateDir, "state.json");
    await writeFile(statePath, JSON.stringify({
        setup: { projectInitialized: false },
    }));

    const inst = newInstance("catalog-init");
    inst.workspacePath = workspacePath;
    inst.state = (await readState(workspacePath, fsDeps)).state;
    const initialized = Promise.withResolvers();
    let refreshes = 0;
    await startStateWatcher(inst, {
        snapshot: async () => ({}),
        normalizeHookArtifactsInComposition: (composition) => composition,
        onProjectInitialized: () => {
            refreshes += 1;
            initialized.resolve();
        },
    });
    t.after(() => stopStateWatcher(inst));

    await writeFile(statePath, JSON.stringify({
        setup: { projectInitialized: true },
    }));
    const timeoutController = new AbortController();
    try {
        await Promise.race([
            initialized.promise,
            delay(3000, undefined, { signal: timeoutController.signal })
                .then(() => { throw new Error("project initialization refresh did not run"); }),
        ]);
    } finally {
        timeoutController.abort();
    }

    assert.equal(refreshes, 1);
    assert.equal(inst.state.setup.projectInitialized, true);
});

test("a live project reset still broadcasts initialization from the replacement state directory", async (t) => {
    const workspacePath = await mkdtemp(join(tmpdir(), "wizard-state-reopen-"));
    const stateDir = join(workspacePath, ".speckit-wizard");
    const statePath = join(stateDir, "state.json");
    await mkdir(stateDir);
    await writeFile(statePath, JSON.stringify({ setup: { projectInitialized: false } }));
    const inst = newInstance("state-reopen");
    inst.workspacePath = workspacePath;
    inst.state = (await readState(workspacePath, fsDeps)).state;
    t.after(async () => {
        stopStateWatcher(inst);
        await rm(workspacePath, { recursive: true, force: true });
    });
    const initialized = Promise.withResolvers();
    let refreshes = 0;
    inst.broadcast = (message) => {
        if (message.data?.setup?.projectInitialized) initialized.resolve(message);
    };
    const deps = {
        snapshot: async () => ({ setup: inst.state.setup }),
        normalizeHookArtifactsInComposition: (composition) => composition,
        onProjectInitialized: () => { refreshes++; },
    };
    await startStateWatcher(inst, deps);
    await rename(stateDir, join(workspacePath, "state-backup"));
    await mkdir(stateDir);
    await writeFile(statePath, JSON.stringify({ setup: { projectInitialized: false } }));
    await delay(300);
    await writeFile(statePath, JSON.stringify({ setup: { projectInitialized: true } }));

    const timeoutController = new AbortController();
    try {
        const message = await Promise.race([
            initialized.promise,
            delay(3000, undefined, { signal: timeoutController.signal })
                .then(() => { throw new Error("replacement state directory was not observed"); }),
        ]);
        assert.equal(message.type, "state");
        assert.equal(message.data.setup.projectInitialized, true);
        assert.equal(refreshes, 1);
    } finally {
        timeoutController.abort();
    }
});

test("a live project reset still observes replacement artifact directories", async (t) => {
    const workspacePath = await mkdtemp(join(tmpdir(), "wizard-artifact-reopen-"));
    const specifyDir = join(workspacePath, ".specify");
    const specsDir = join(workspacePath, "specs");
    await mkdir(specifyDir);
    await mkdir(specsDir);
    const inst = newInstance("artifact-reopen");
    inst.workspacePath = workspacePath;
    t.after(async () => {
        stopArtifactWatcher(inst);
        await rm(workspacePath, { recursive: true, force: true });
    });
    const updated = Promise.withResolvers();
    inst.broadcast = (message) => updated.resolve(message);
    const artifactPath = join(specifyDir, "constitution.md");
    const deps = {
        snapshot: async () => ({ artifact: await readFile(artifactPath, "utf8") }),
    };
    await startArtifactWatcher(inst, deps);
    await rename(specifyDir, join(workspacePath, "specify-backup"));
    await rename(specsDir, join(workspacePath, "specs-backup"));
    await mkdir(specifyDir);
    await mkdir(specsDir);
    await delay(300);
    await writeFile(artifactPath, "# Initialized project");

    const timeoutController = new AbortController();
    try {
        const message = await Promise.race([
            updated.promise,
            delay(3000, undefined, { signal: timeoutController.signal })
                .then(() => { throw new Error("replacement artifact directory was not observed"); }),
        ]);
        assert.deepEqual(message, {
            type: "state", data: { artifact: "# Initialized project" }, review: { kind: "artifact-set" },
        });
    } finally {
        timeoutController.abort();
    }
});

test("artifact watcher reports changes in the .github tree", async (t) => {
    const workspacePath = await mkdtemp(join(tmpdir(), "wizard-artifact-github-"));
    const githubDir = join(workspacePath, ".github");
    await mkdir(githubDir);
    const inst = newInstance("artifact-github");
    inst.workspacePath = workspacePath;
    t.after(async () => {
        stopArtifactWatcher(inst);
        await rm(workspacePath, { recursive: true, force: true });
    });
    const updated = Promise.withResolvers();
    inst.broadcast = (message) => updated.resolve(message);
    await startArtifactWatcher(inst, { snapshot: async () => ({}) });
    await writeFile(join(githubDir, "new.md"), "# Change");
    const timeoutController = new AbortController();
    try {
        const message = await Promise.race([
            updated.promise,
            delay(3000, undefined, { signal: timeoutController.signal })
                .then(() => { throw new Error(".github change was not observed"); }),
        ]);
        assert.deepEqual(message, { type: "state", data: {}, review: { kind: "artifact-set" } });
    } finally {
        timeoutController.abort();
    }
});
