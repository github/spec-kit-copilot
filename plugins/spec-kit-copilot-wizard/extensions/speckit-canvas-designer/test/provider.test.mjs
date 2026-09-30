import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    fingerprint, handoffDirectory, HANDOFF_LIMIT, readHandoff, validateHandoff,
    validateHandoffId,
} from "../handoff.mjs";
import { shellHtml, startShell } from "../server.mjs";

const ID = "designer_1";

function validHandoff(id = ID) {
    const workflow = { selectedPhases: ["specify", "plan"] };
    const selections = {
        presets: [{ id: "theme", source: "copilot", approved: true,
            version: "1.2.3", downloadUrl: "https://example.com/theme" }],
        extensions: [],
        bundles: [{ id: "starter", source: "default", approved: true,
            version: null, downloadUrl: null }],
    };
    return { schemaVersion: 1, handoffId: id, workflow, selections,
        sourceFingerprint: fingerprint({ workflow, selections }) };
}

async function fixture(t) {
    const workspace = await mkdtemp(join(tmpdir(), "speckit-designer-test-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    return workspace;
}

async function saveHandoff(workspace, handoff = validHandoff()) {
    const directory = handoffDirectory(workspace, handoff.handoffId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "handoff.json"), JSON.stringify(handoff));
    return directory;
}

test("handoff validates bounded IDs, shape, URLs and fingerprint", () => {
    const good = validHandoff();
    assert.equal(validateHandoff(good, ID), good);
    for (const id of ["", "../escape", "space here", "x".repeat(129), null]) {
        assert.throws(() => validateHandoffId(id), /Invalid Designer handoff ID/);
    }
    assert.throws(() => validateHandoff(good, "different"), /Invalid Designer handoff/);
    const mutate = (change) => {
        const copy = structuredClone(good);
        change(copy);
        copy.sourceFingerprint = fingerprint({ workflow: copy.workflow, selections: copy.selections });
        return copy;
    };
    const invalid = [
        mutate((copy) => { copy.extra = "unexpected"; }),
        mutate((copy) => { copy.workflow.selectedPhases = Array(31).fill("plan"); }),
        mutate((copy) => { copy.selections.presets.push({ ...copy.selections.presets[0] }); }),
        mutate((copy) => { copy.selections.presets[0].downloadUrl = "http://example.com"; }),
        mutate((copy) => { copy.selections.presets[0].downloadUrl = "https://user:pass@example.com"; }),
        mutate((copy) => { copy.selections.bundles[0].approved = false; }),
        mutate((copy) => { delete copy.selections.extensions; }),
        mutate((copy) => { copy.selections.presets[0].id = "../escape"; }),
    ];
    for (const handoff of invalid) {
        assert.throws(() => validateHandoff(handoff, ID), /Invalid Designer handoff/);
    }
    const changed = structuredClone(good);
    changed.workflow.selectedPhases.push("tasks");
    assert.throws(() => validateHandoff(changed, ID), /fingerprint mismatch/);
});

test("handoff reads only validated artifacts from its session workspace", async (t) => {
    const workspace = await fixture(t);
    const handoff = validHandoff();
    const directory = await saveHandoff(workspace, handoff);
    assert.deepEqual(await readHandoff(workspace, ID), handoff);
    await assert.rejects(readHandoff(workspace, "../escape"), /Invalid Designer handoff ID/);
    await assert.rejects(readHandoff("", ID), /Designer session workspace is unavailable/);
    await assert.rejects(readHandoff(workspace, "other"), { code: "ENOENT" });

    const path = join(directory, "handoff.json");
    await writeFile(path, "{broken");
    await assert.rejects(readHandoff(workspace, ID), /Malformed Designer handoff/);
    await writeFile(path, JSON.stringify({ ...handoff, sourceFingerprint: "0".repeat(64) }));
    await assert.rejects(readHandoff(workspace, ID), /fingerprint mismatch/);
    await writeFile(path, "x".repeat(HANDOFF_LIMIT + 1));
    await assert.rejects(readHandoff(workspace, ID), /Invalid Designer handoff file/);

    const outside = await fixture(t);
    await saveHandoff(outside);
    await rm(directory, { recursive: true });
    try {
        await symlink(handoffDirectory(outside, ID), directory,
            process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; traversal assertion skipped");
        return;
    }
    await assert.rejects(readHandoff(workspace, ID), /Designer handoff escapes session artifacts/);
});

test("handoff rejects symlinked file without following it", async (t) => {
    const workspace = await fixture(t);
    const directory = await saveHandoff(workspace);
    const path = join(directory, "handoff.json");
    const target = join(workspace, "outside.json");
    await writeFile(target, JSON.stringify(validHandoff()));
    await rm(path);
    try {
        await symlink(target, path, "file");
    } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
        t.diagnostic("Windows symlink creation is not permitted; file assertion skipped");
        return;
    }
    await assert.rejects(readHandoff(workspace, ID), /Invalid Designer handoff file/);
});

test("shell renders counts without echoing handoff content and restricts HTTP access", async (t) => {
    const handoff = validHandoff();
    assert.match(shellHtml(handoff), /2 phases · 2 design customizations queued/);
    assert.doesNotMatch(shellHtml(handoff), /example\.com|starter|theme/);
    const shell = await startShell(handoff);
    t.after(() => shell.close());
    const url = new URL(shell.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.match(url.searchParams.get("token"), /^[a-f0-9]{48}$/);
    const good = await fetch(shell.url);
    assert.equal(good.status, 200);
    assert.match(good.headers.get("content-type"), /text\/html/);
    assert.equal(good.headers.get("cache-control"), "no-store");
    assert.equal(good.headers.get("x-content-type-options"), "nosniff");
    assert.match(await good.text(), /Canvas Designer/);
    for (const [address, options] of [
        [url.origin, undefined],
        [`${url.origin}/?token=wrong`, undefined],
        [`${url.origin}/other?token=${url.searchParams.get("token")}`, undefined],
        [shell.url, { method: "POST" }],
    ]) {
        assert.equal((await fetch(address, options)).status, 404);
    }
});
