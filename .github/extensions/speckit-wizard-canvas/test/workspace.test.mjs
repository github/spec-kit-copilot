import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchSessionRepoPath, joinIfPossible, pathExists, resolveWorkspace } from "../env/workspace.mjs";

test("workspace helpers preserve explicit path precedence and separators", async () => {
    assert.equal(resolveWorkspace({ workspacePath: "/cached" }, { input: { cwd: "/explicit" } }, "/session"), "/explicit");
    assert.equal(resolveWorkspace({ workspacePath: "/cached" }, {}, "/session"), "/session");
    assert.equal(resolveWorkspace({ workspacePath: "/cached" }, {}, null), "/cached");
    assert.equal(joinIfPossible("C:\\repo\\", ".specify"), "C:\\repo\\.specify");
    assert.equal(joinIfPossible("/repo", ".specify"), "/repo/.specify");
});

test("pathExists reports stat success and failure without leaking errors", async () => {
    assert.equal(await pathExists("/present", async () => {}), true);
    assert.equal(await pathExists("/missing", async () => { throw new Error("ENOENT"); }), false);
});

test("fetchSessionRepoPath follows metadata fallback order", async () => {
    assert.equal(
        await fetchSessionRepoPath({ rpc: { metadata: { snapshot: async () => ({ workingDirectory: "/working" }) } } }),
        "/working",
    );
    assert.equal(
        await fetchSessionRepoPath({ rpc: { metadata: { snapshot: async () => ({ workspace: { cwd: "/cwd" } }) } } }),
        "/cwd",
    );
    assert.equal(
        await fetchSessionRepoPath({ rpc: { metadata: { snapshot: async () => ({ workspace: { git_root: "/root" } }) } } }),
        "/root",
    );
});
