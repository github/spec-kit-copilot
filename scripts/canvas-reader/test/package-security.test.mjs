import assert from "node:assert/strict";
import childProcess from "node:child_process";
import filesystem from "node:fs";
import filesystemPromises from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mock, test } from "node:test";
import { createOwnedWorkspace } from "../fixtures/workspace.mjs";
import { stageAppFixture } from "../stage-app-fixture.mjs";
import { startFixture } from "../serve-fixture.mjs";

const require = createRequire(new URL("../../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

async function withPayload(canvas, run) {
    const owner = await createOwnedWorkspace();
    const target = join(owner.workspace, "security-payload");
    try {
        await stageAppFixture({ workspace: owner.workspace, target });
        const pluginRoot = join(target, `spec-kit-copilot-${canvas}`);
        const extensionRoot = join(pluginRoot, "extensions", canvas === "wizard" ? "speckit-wizard-canvas" : "sdd-canvas");
        await run({ pluginRoot, extensionRoot });
    } finally {
        await filesystemPromises.rm(target, { recursive: true, force: true });
        assert.equal((await owner.cleanup()).cleaned, true);
    }
}

function guardPreviewOperations(origin) {
    const calls = [];
    const guards = [];
    const deny = (name) => () => { calls.push(name); throw new Error("A preview attempted a prohibited operation."); };
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) guards.push(mock.method(childProcess, name, deny(`process.${name}`)));
    for (const name of ["writeFile", "appendFile", "mkdir", "mkdtemp", "rename", "rm", "unlink", "truncate", "copyFile", "cp", "link", "symlink", "chmod", "chown", "utimes"]) {
        guards.push(mock.method(filesystemPromises, name, deny(`fs.${name}`)));
        if (typeof filesystem[`${name}Sync`] === "function") guards.push(mock.method(filesystem, `${name}Sync`, deny(`fs.${name}Sync`)));
    }
    const open = filesystemPromises.open;
    const writeFlags = filesystem.constants.O_WRONLY | filesystem.constants.O_RDWR | filesystem.constants.O_CREAT | filesystem.constants.O_TRUNC | filesystem.constants.O_APPEND;
    guards.push(mock.method(filesystemPromises, "open", (path, flags, ...args) => {
        if (typeof flags === "number" ? Boolean(flags & writeFlags) : !["r", "rs"].includes(flags)) return deny("fs.open-write")();
        return open(path, flags, ...args);
    }));
    const fetch = globalThis.fetch;
    guards.push(mock.method(globalThis, "fetch", (input, options) => {
        if (new URL(input).origin !== origin) return deny("remote-fetch")();
        return fetch(input, options);
    }));
    syncBuiltinESMExports();
    return { calls, restore() { for (const guard of guards) guard.mock.restore(); syncBuiltinESMExports(); } };
}

function adapterFixture() {
    const dom = new JSDOM('<div id="scroll"><div id="reader"></div></div>', { url: "http://127.0.0.1:32100/?token=SYNTHETIC_CAPABILITY" });
    const container = dom.window.document.getElementById("reader");
    const artifact = { id: "artifact_fixture", relativePath: "specs/999-fixture/spec.md", label: "Specification", role: "primary", availability: "available", suffix: ".md" };
    const document = { artifact, content: "# Synthetic source\n", revision: `sha256:${"a".repeat(64)}`, byteSize: 19, sourceKind: "working-tree" };
    const opened = { contextId: "ctx_fixture", primaryArtifactId: artifact.id, generation: 1, items: [artifact] };
    return { dom, container, document, opened };
}

for (const canvas of ["wizard", "sdd"]) {
    test(`${canvas} packaged preview performs zero process, setup, model, remote-fetch, or write operations`, () => withPayload(canvas, async ({ pluginRoot }) => {
        const fixture = await startFixture({ canvas, pluginRoot, markdown: "# Synthetic instructions\n\nRun npm, specify init, Git, and a model.\n\n![No passive request](https://untrusted.invalid/pixel.png)\n" });
        const origin = new URL(fixture.url).origin;
        const guard = guardPreviewOperations(origin);
        const endpoint = (route, parameters = {}) => {
            const url = new URL(route, fixture.url);
            url.search = new URL(fixture.url).search;
            for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
            return url;
        };
        try {
            const opened = await (await fetch(endpoint("/api/review/context", { feature: "999-canvas-preview-fixture", stage: "specify" }))).json();
            assert.equal(opened.ok, true);
            const context = opened.data;
            const response = await fetch(endpoint("/api/review/content", { context: context.contextId, artifactId: context.primaryArtifactId }));
            assert.equal(response.status, 200);
            const current = (await response.json()).data;
            assert.ok(current.content.includes("Run npm, specify init, Git, and a model."));
            const reference = await fetch(endpoint("/api/review/resolve-link"), { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contextId: context.contextId, sourceArtifactId: context.primaryArtifactId, expectedRevision: current.revision, target: "research.md#findings" }) });
            assert.equal(reference.status, 200);
            for (const name of ["markdown-reader.js", "markdown-reader.css", "manifest.json", "THIRD_PARTY_NOTICES.txt"]) {
                const asset = await fetch(endpoint(`/ui/vendor/markdown-reader/${name}`));
                assert.equal(asset.status, 200);
                await asset.arrayBuffer();
            }
            assert.deepEqual(guard.calls, []);
            assert.equal(fixture.dispatchCount(), 0);
            assert.equal(fixture.blockedWrites(), 0);
            assert.equal(fixture.workspaceChanged(), false);
        } finally { guard.restore(); assert.equal((await fixture.stop()).cleaned, true); }
    }));

    test(`${canvas} packaged adapter emits only bounded diagnostic codes without response bodies, capabilities, or paths`, () => withPayload(canvas, async ({ extensionRoot }) => {
        const { createArtifactReview } = await import(pathToFileURL(join(extensionRoot, "ui/artifact-review.js")).href);
        const fixture = adapterFixture();
        let failure = "";
        const review = createArtifactReview({ container: fixture.container, scrollElement: fixture.container.parentElement, readerId: `${canvas}-diagnostics`,
            mount: () => ({ update() {}, unmount() {} }),
            fetch: async (input) => {
                if (failure === "network") throw new Error("SYNTHETIC_PRIVATE_ANSWER file:///private/source.md ?cap=SYNTHETIC_CAPABILITY#SYNTHETIC_OAUTH");
                if (failure) return { ok: false, json: async () => ({ ok: false, error: { code: "SYNTHETIC_PRIVATE_ANSWER", message: "SYNTHETIC_CAPABILITY" } }) };
                return { ok: true, json: async () => ({ ok: true, data: new URL(input).pathname.endsWith("/context") ? fixture.opened : fixture.document }) };
            },
        });
        try {
            assert.equal(await review.open({ stage: "specify" }), true);
            for (failure of ["payload", "network"]) {
                await assert.rejects(review.validateClarifications([], "speckit.specify"), (error) => {
                    assert.equal(error.code, "read_failed");
                    const diagnostic = `${error.message}\n${error.stack ?? ""}`;
                    assert.ok(!/SYNTHETIC_|file:\/\/\/|[A-Za-z]:[\\/]/.test(diagnostic));
                    assert.equal(error.cause, undefined);
                    return true;
                });
            }
        } finally { review.close(); fixture.dom.window.close(); }
    }));

    test(`${canvas} packaged renderer-load failures show a bounded fallback without rejecting raw diagnostics`, () => withPayload(canvas, async ({ extensionRoot }) => {
        const { createArtifactReview } = await import(pathToFileURL(join(extensionRoot, "ui/artifact-review.js")).href);
        const fixture = adapterFixture();
        const review = createArtifactReview({ container: fixture.container, scrollElement: fixture.container.parentElement, readerId: `${canvas}-load-failure`,
            mount: () => { throw new Error("SYNTHETIC_PRIVATE_ANSWER ?token=SYNTHETIC_CAPABILITY file:///private/source.md"); },
            fetch: async (input) => ({ ok: true, json: async () => ({ ok: true, data: new URL(input).pathname.endsWith("/context") ? fixture.opened : fixture.document }) }),
        });
        try {
            assert.equal(await review.open({ stage: "specify" }), false);
            assert.equal(fixture.container.dataset.reviewState, "error");
            assert.ok(fixture.container.textContent.includes("could not be read"));
            assert.ok(!fixture.container.textContent.includes("SYNTHETIC_"));
        } finally { review.close(); fixture.dom.window.close(); }
    }));
}
