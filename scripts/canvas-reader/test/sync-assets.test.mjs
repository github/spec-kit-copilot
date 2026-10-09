import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ASSET_FILES, READER_DESTINATIONS, READER_PACKAGE, syncReaderAssets, verifyReaderAssets } from "../sync-assets.mjs";
import * as staging from "../stage-app-fixture.mjs";
import { createOwnedWorkspace } from "../fixtures/workspace.mjs";
import { startFixture } from "../serve-fixture.mjs";

function sha256(content) {
    return createHash("sha256").update(content).digest("hex");
}

async function fixture(run) {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "speckit-reader-assets-"));
    const reader = join(repositoryRoot, READER_PACKAGE);
    const dist = join(reader, "dist");
    const sourceFiles = {
        "package.json": JSON.stringify({ private: true, devDependencies: { "fixture-library": "1.0.0" } }),
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
        "tsconfig.json": "{}",
        "vite.config.ts": "export default {};",
        "vite.parser.config.ts": "export default {};",
        "eslint.config.mjs": "export default [];",
        "src/mount.tsx": "export function mountMarkdownReader() {}",
        "src/reader.css": ".md-reader { color: inherit; }",
    };
    try {
        await mkdir(join(reader, "src"), { recursive: true });
        await mkdir(dist, { recursive: true });
        for (const [name, content] of Object.entries(sourceFiles)) await writeFile(join(reader, name), content);
        const fingerprints = Object.keys(sourceFiles).sort().map((name) => `${name}\0${sha256(sourceFiles[name])}`).join("\n");
        await writeFile(join(dist, "markdown-reader.js"), "export function mountMarkdownReader() { return {update() {}, unmount() {}}; }\n");
        await writeFile(join(dist, "markdown-reader.css"), ".md-reader { color: inherit; }\n");
        const provenance = {
            schemaVersion: 1,
            sourceHash: `sha256:${sha256(fingerprints)}`,
            builtWith: { node: "24.19.0", packageManager: "11.17.0", typescript: "5.9.3", bundler: "vite 8.0.16" },
            dependencies: [{ name: "fixture-library", version: "1.0.0", license: "MIT", notice: "Synthetic license notice for the owned test fixture." }],
        };
        await writeFile(join(dist, "build-metadata.json"), JSON.stringify(provenance));
        await run({ repositoryRoot, reader, dist, provenance });
    } finally {
        await rm(repositoryRoot, { recursive: true, force: true });
    }
}

test("sync copies exactly the named assets and matching provenance to both existing plugins", async () => {
    await fixture(async ({ repositoryRoot }) => {
        await syncReaderAssets({ repositoryRoot });
        await verifyReaderAssets({ repositoryRoot });
        const manifests = [];
        for (const destination of READER_DESTINATIONS) {
            const directory = join(repositoryRoot, destination);
            assert.deepEqual((await readdir(directory)).sort(), [...ASSET_FILES].sort());
            const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
            assert.match(manifest.sourceHash, /^sha256:[0-9a-f]{64}$/);
            assert.match(manifest.buildHash, /^sha256:[0-9a-f]{64}$/);
            assert.equal(manifest.dependencies[0].name, "fixture-library");
            assert.match(await readFile(join(directory, "THIRD_PARTY_NOTICES.txt"), "utf8"), /Synthetic license/);
            manifests.push(manifest);
        }
        assert.deepEqual(manifests[0], manifests[1]);
    });
});

test("verify rejects a stale copy without repairing it", async () => {
    await fixture(async ({ repositoryRoot }) => {
        await syncReaderAssets({ repositoryRoot });
        const stale = join(repositoryRoot, READER_DESTINATIONS[1], "markdown-reader.js");
        await writeFile(stale, "stale output");
        await assert.rejects(verifyReaderAssets({ repositoryRoot }), /stale|mismatch/i);
        assert.equal(await readFile(stale, "utf8"), "stale output");
    });
});

test("sync rejects source changed since the build was produced", async () => {
    await fixture(async ({ repositoryRoot, reader }) => {
        await writeFile(join(reader, "src/mount.tsx"), "export function changed() {}");
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /source.*changed|source.*mismatch|stale build/i);
    });
});

test("sync rejects unresolved imports and source maps before copying", async () => {
    await fixture(async ({ repositoryRoot, dist }) => {
        await writeFile(join(dist, "markdown-reader.js"), "import React from 'react'; export { React };");
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /import|dependency/i);
        await writeFile(join(dist, "markdown-reader.js"), "export function mountMarkdownReader() {}\n//# sourceMappingURL=reader.js.map");
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /source.?map/i);
    });
});

test("sync rejects unexpected build files, absolute paths and remote CSS assets", async () => {
    await fixture(async ({ repositoryRoot, dist }) => {
        await writeFile(join(dist, "private.txt"), "fixture-only unexpected output");
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /unexpected|allowlist/i);
        await rm(join(dist, "private.txt"));
        await writeFile(join(dist, "markdown-reader.js"), "export const source = 'C:/Users/fixture/private/file.tsx';");
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /path/i);
        await writeFile(join(dist, "markdown-reader.js"), "export function mountMarkdownReader() {}");
        await writeFile(join(dist, "markdown-reader.css"), "@import 'https://example.invalid/style.css';");
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /css|remote|asset/i);
    });
});

test("sync rejects missing notices and never removes unexpected destination files", async () => {
    await fixture(async ({ repositoryRoot, dist, provenance }) => {
        provenance.dependencies[0].notice = "";
        await writeFile(join(dist, "build-metadata.json"), JSON.stringify(provenance));
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /notice|license/i);
        provenance.dependencies[0].notice = "Synthetic license notice.";
        await writeFile(join(dist, "build-metadata.json"), JSON.stringify(provenance));
        const destination = join(repositoryRoot, READER_DESTINATIONS[0]);
        await mkdir(destination, { recursive: true });
        await writeFile(join(destination, "user-notes.txt"), "preserve this fixture-owned extra file");
        await assert.rejects(syncReaderAssets({ repositoryRoot }), /unexpected|allowlist/i);
        assert.equal(await readFile(join(destination, "user-notes.txt"), "utf8"), "preserve this fixture-owned extra file");
    });
});

async function independentPayload(canvas, run) {
    const owner = await createOwnedWorkspace();
    const target = join(owner.workspace, "independent-payload");
    try {
        const id = `spec-kit-copilot-${canvas}`;
        const inventory = await staging.stageAppFixture({ workspace: owner.workspace, target, pluginIds: [id] });
        assert.equal(inventory.plugins.length, 1, "only the requested existing plugin may be staged");
        assert.deepEqual((await readdir(target)).sort(), [id, "staging-manifest.json"].sort());
        const pluginRoot = join(target, id);
        const extensionRoot = join(pluginRoot, "extensions", canvas === "wizard" ? "speckit-wizard-canvas" : "sdd-canvas");
        assert.equal(typeof staging.verifyStagedPlugin, "function", "independent import-closure verification is missing");
        await run({ owner, target, pluginRoot, extensionRoot, inventory });
    } finally {
        await rm(target, { recursive: true, force: true });
        assert.equal((await owner.cleanup()).cleaned, true);
    }
}

for (const canvas of ["wizard", "sdd"]) {
    test(`${canvas} stages alone with closed imports, full notices, and deterministic payload hashes`, () => independentPayload(canvas, async ({ pluginRoot, inventory }) => {
        const result = await staging.verifyStagedPlugin({ pluginRoot });
        assert.equal(result.id, `spec-kit-copilot-${canvas}`);
        assert.match(result.payloadSha256, /^[a-f0-9]{64}$/);
        assert.match(result.assetManifestSha256, /^[a-f0-9]{64}$/);
        assert.match(result.readerBuildHash, /^sha256:[a-f0-9]{64}$/);
        assert.ok(result.files.length >= 10);
        assert.equal(result.files.length, inventory.plugins[0].files.length);
        assert.deepEqual(await staging.verifyStagedPlugin({ pluginRoot }), result);
    }));

    test(`${canvas} independent payload rejects missing assets, notices, foreign imports, and private files`, () => independentPayload(canvas, async ({ pluginRoot, extensionRoot }) => {
        const assetRoot = join(extensionRoot, canvas === "wizard" ? "ui/vendor/markdown-reader" : "vendor/markdown-reader");
        for (const relativePath of ["markdown-reader.css", "THIRD_PARTY_NOTICES.txt"]) {
            const file = join(assetRoot, relativePath);
            const content = await readFile(file);
            await rm(file);
            await assert.rejects(staging.verifyStagedPlugin({ pluginRoot }), /missing|asset|notice/i);
            await writeFile(file, content);
        }
        const source = join(extensionRoot, "extension.mjs");
        const content = await readFile(source);
        for (const specifier of ["../../../sibling-plugin/private.mjs", "C:/Users/synthetic/private.mjs", "https://untrusted.invalid/code.js", "uninstalled-package"]) {
            await appendFile(source, `\nimport ${JSON.stringify(specifier)};\n`);
            await assert.rejects(staging.verifyStagedPlugin({ pluginRoot }), /import|outside|dependency|closed/i);
            await writeFile(source, content);
        }
        const privateFile = join(pluginRoot, ".env.private");
        await writeFile(privateFile, "SYNTHETIC_PRIVATE_DATA");
        await assert.rejects(staging.verifyStagedPlugin({ pluginRoot }), /forbidden|unexpected|private/i);
        assert.equal(await readFile(privateFile, "utf8"), "SYNTHETIC_PRIVATE_DATA");
        await rm(privateFile);
    }));

    test(`${canvas} independent payload runs concurrent isolated contexts without sibling checkout access`, () => independentPayload(canvas, async ({ pluginRoot }) => {
        const first = await startFixture({ canvas, pluginRoot });
        let second;
        const endpoint = (fixture, route, parameters = {}) => {
            const url = new URL(fixture.url);
            url.pathname = route;
            for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
            return url;
        };
        try {
            second = await startFixture({ canvas, pluginRoot });
            const selections = { feature: "999-canvas-preview-fixture", stage: "specify" };
            const opened = (await (await fetch(endpoint(first, "/api/review/context", selections))).json()).data;
            const other = (await (await fetch(endpoint(second, "/api/review/context", selections))).json()).data;
            assert.notEqual(opened.contextId, other.contextId);
            assert.equal((await fetch(endpoint(second, "/api/review/content", { context: opened.contextId, artifactId: opened.primaryArtifactId }))).status, 404);
            for (const [fixture, context] of [[first, opened], [second, other]]) {
                const result = await fetch(endpoint(fixture, "/api/review/content", { context: context.contextId, artifactId: context.primaryArtifactId }));
                assert.equal(result.status, 200);
                assert.equal(fixture.dispatchCount(), 0);
                assert.equal(fixture.workspaceChanged(), false);
            }
        } finally {
            if (second) assert.equal((await second.stop()).cleaned, true);
            assert.equal((await first.stop()).cleaned, true);
        }
    }));
}
