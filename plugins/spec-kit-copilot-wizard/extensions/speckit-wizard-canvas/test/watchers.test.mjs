import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
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

test("Windows short-path workspaces retain state and artifact watchers", {
    skip: process.platform !== "win32",
}, async (t) => {
    const workspacePath = await realpath(await mkdtemp(join(tmpdir(), "wizard-watch-short-")));
    const inst = newInstance("short-path-watchers");
    t.after(async () => {
        stopStateWatcher(inst);
        stopArtifactWatcher(inst);
        await rm(workspacePath, { recursive: true, force: true });
    });
    const shortPath = execFileSync(process.env.ComSpec || "cmd.exe",
        ["/d", "/c", 'for %I in ("%WIZARD_TEST_ROOT%") do @echo %~sI'], {
            encoding: "utf8", windowsVerbatimArguments: true,
            env: { ...process.env, WIZARD_TEST_ROOT: workspacePath },
        }).trim();
    assert.equal((await realpath(shortPath)).toLowerCase(), workspacePath.toLowerCase());
    if (shortPath.toLowerCase() === workspacePath.toLowerCase()) {
        t.skip("Windows short paths are unavailable on this volume");
        return;
    }
    const stateDir = join(shortPath, ".speckit-wizard");
    const githubDir = join(shortPath, ".github");
    await mkdir(stateDir);
    await mkdir(githubDir);
    const statePath = join(stateDir, "state.json");
    await writeFile(statePath, JSON.stringify({ setup: { projectInitialized: false } }));
    inst.workspacePath = shortPath;
    inst.state = (await readState(shortPath, fsDeps)).state;
    const initialized = Promise.withResolvers();
    const artifactChanged = Promise.withResolvers();
    inst.broadcast = (message) => {
        if (message.review?.kind === "artifact-set") artifactChanged.resolve();
    };
    await startStateWatcher(inst, {
        snapshot: async () => ({}),
        normalizeHookArtifactsInComposition: (composition) => composition,
        onProjectInitialized: () => initialized.resolve(),
    });
    await startArtifactWatcher(inst, { snapshot: async () => ({}) });
    await writeFile(statePath, JSON.stringify({ setup: { projectInitialized: true } }));
    await writeFile(join(githubDir, "new.md"), "# Change");
    const timeoutController = new AbortController();
    try {
        await Promise.race([
            Promise.all([initialized.promise, artifactChanged.promise]),
            delay(5000, undefined, { signal: timeoutController.signal })
                .then(() => { throw new Error("short-path watcher changes were not observed"); }),
        ]);
    } finally {
        timeoutController.abort();
    }
});
