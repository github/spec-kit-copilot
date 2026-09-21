import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const MAX_BYTES = 5_242_880;
const revisionOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function artifactTest(name, run) {
    test(name, async (testContext) => {
        const reader = await import("../server/artifact-read.mjs").catch((error) => {
            if (error.code === "ERR_MODULE_NOT_FOUND") {
                assert.fail("T017: the bounded artifact-read primitive is not implemented");
            }
            throw error;
        });
        const root = await fs.mkdtemp(join(tmpdir(), "canvas-artifact-read-"));
        try {
            await fs.mkdir(join(root, "specs", "001-fixture"), { recursive: true });
            await run({ root, testContext, ...reader });
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
}

function interceptReads(intercept) {
    return {
        ...fs,
        async open(...args) {
            const handle = await fs.open(...args);
            return {
                stat: (...statArgs) => handle.stat(...statArgs),
                async read(...readArgs) {
                    const result = await handle.read(...readArgs);
                    await intercept({ handle, args: readArgs, result });
                    return result;
                },
                close: () => handle.close(),
            };
        },
    };
}

artifactTest("returns complete working-tree bytes and an exact SHA-256 revision", async ({ root, readArtifact, MAX_ARTIFACT_BYTES }) => {
    const bytes = Buffer.from("# Specification\r\n\r\nUntracked working-tree text.\r\n");
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), bytes);
    const document = await readArtifact(root, "specs/001-fixture/spec.md");
    assert.equal(MAX_ARTIFACT_BYTES, MAX_BYTES);
    assert.equal(document.content, bytes.toString("utf8"));
    assert.equal(document.revision, revisionOf(bytes));
    assert.equal(document.byteSize, bytes.length);
    assert.equal(document.sourceKind, "working-tree");
    assert.equal(new Date(document.modifiedAt).toISOString(), document.modifiedAt);
});

artifactTest("strips a UTF-8 BOM only from presentation, not revision or byte size", async ({ root, readArtifact }) => {
    const plain = Buffer.from("# Same content\n");
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), plain]);
    await fs.writeFile(join(root, "plain.md"), plain);
    await fs.writeFile(join(root, "bom.MARKDOWN"), withBom);
    const first = await readArtifact(root, "plain.md");
    const second = await readArtifact(root, "bom.MARKDOWN");
    assert.equal(first.content, second.content);
    assert.notEqual(first.revision, second.revision);
    assert.equal(second.revision, revisionOf(withBom));
    assert.equal(second.byteSize, plain.length + 3);
});

artifactTest("allows empty, BOM-only, and whitespace documents without inventing content", async ({ root, readArtifact }) => {
    for (const bytes of [Buffer.alloc(0), Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(" \r\n\t")]) {
        await fs.writeFile(join(root, "empty.md"), bytes);
        const document = await readArtifact(root, "empty.md");
        assert.equal(document.content.trim(), "");
        assert.equal(document.byteSize, bytes.length);
        assert.equal(document.revision, revisionOf(bytes));
    }
});

artifactTest("accepts the exact cap and rejects one additional byte without partial content", async ({ root, readArtifact }) => {
    const bytes = Buffer.alloc(MAX_BYTES, 0x61);
    await fs.writeFile(join(root, "limit.md"), bytes);
    const document = await readArtifact(root, "limit.md");
    assert.equal(document.byteSize, MAX_BYTES);
    assert.equal(document.content.length, MAX_BYTES);
    assert.equal(document.revision, revisionOf(bytes));
    await fs.appendFile(join(root, "limit.md"), "b");
    await assert.rejects(readArtifact(root, "limit.md"), { code: "artifact_too_large", status: 413 });
});

artifactTest("enforces the byte limit while reading a file that grows after the initial stat", async ({ root, readArtifact }) => {
    const target = join(root, "growing.md");
    await fs.writeFile(target, Buffer.alloc(MAX_BYTES, 0x61));
    let changed = false;
    let returnedBytes = 0;
    const injected = interceptReads(async ({ args, result }) => {
        assert.ok(args[2] <= 65_536, "read requests must stay bounded");
        returnedBytes += result.bytesRead;
        if (!changed) {
            changed = true;
            await fs.appendFile(target, "b");
        }
    });
    await assert.rejects(readArtifact(root, "growing.md", { fs: injected }), { code: "artifact_too_large" });
    assert.ok(returnedBytes <= MAX_BYTES + 1, "only a single overflow sentinel byte may be read");
});

artifactTest("rejects malformed UTF-8 and NUL bytes with redacted encoding errors", async ({ root, readArtifact }) => {
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xff]), Buffer.from("# Hidden\0data")]) {
        await fs.writeFile(join(root, "invalid.md"), bytes);
        await assert.rejects(readArtifact(root, "invalid.md"), (error) => {
            assert.equal(error.code, "invalid_encoding");
            assert.equal(error.status, 422);
            assert.ok(!error.message.includes(root));
            assert.ok(!error.message.includes("Hidden"));
            assert.equal(error.content, undefined);
            return true;
        });
    }
});

artifactTest("requires a contained ordinary Markdown file", async ({ root, readArtifact }) => {
    await fs.mkdir(join(root, "directory.md"));
    await fs.writeFile(join(root, "not-markdown.txt"), "text");
    await fs.mkdir(join(root, ".git"));
    await fs.writeFile(join(root, ".git", "private.md"), "metadata");
    for (const relativePath of ["directory.md", "not-markdown.txt", "../outside.md", ".git/private.md"]) {
        await assert.rejects(readArtifact(root, relativePath), { code: "unsupported_artifact", status: 415 });
    }
    await assert.rejects(readArtifact(root, "missing.md"), { code: "artifact_unavailable", status: 404 });
});

artifactTest("rejects a replaced path even when the old open handle remains readable", async ({ root, readArtifact }) => {
    const target = join(root, "replaced.md");
    await fs.writeFile(target, "# Original\n");
    let replaced = false;
    const injected = interceptReads(async () => {
        if (!replaced) {
            replaced = true;
            await fs.rename(target, join(root, "old.md"));
            await fs.writeFile(target, "# Different\n");
        }
    });
    await assert.rejects(readArtifact(root, "replaced.md", { fs: injected }), { code: "changed_source", status: 409 });
});

artifactTest("rejects truncation during a read instead of returning a partial document", async ({ root, readArtifact }) => {
    const target = join(root, "truncated.md");
    await fs.writeFile(target, Buffer.alloc(100_000, 0x61));
    let truncated = false;
    const injected = interceptReads(async () => {
        if (!truncated) {
            truncated = true;
            await fs.truncate(target, 0);
        }
    });
    await assert.rejects(readArtifact(root, "truncated.md", { fs: injected }), { code: "changed_source" });
});

artifactTest("honors expected revisions and closes handles on changed-source outcomes", async ({ root, readArtifact }) => {
    const bytes = Buffer.from("# Current\n");
    await fs.writeFile(join(root, "current.md"), bytes);
    const unchanged = await readArtifact(root, "current.md", { expectedRevision: revisionOf(bytes) });
    assert.equal(unchanged.revision, revisionOf(bytes));
    let closed = false;
    const injected = {
        ...fs,
        async open(...args) {
            const handle = await fs.open(...args);
            return {
                stat: (...statArgs) => handle.stat(...statArgs),
                read: (...readArgs) => handle.read(...readArgs),
                async close() { closed = true; await handle.close(); },
            };
        },
    };
    await assert.rejects(readArtifact(root, "current.md", {
        expectedRevision: revisionOf("old content"), fs: injected,
    }), { code: "changed_source", status: 409 });
    assert.equal(closed, true);
});

artifactTest("maps filesystem failures to bounded errors without leaking absolute paths", async ({ root, readArtifact, ArtifactReadError }) => {
    await fs.writeFile(join(root, "denied.md"), "# Safe\n");
    const injected = {
        ...fs,
        async open() { throw Object.assign(new Error(`private filesystem detail: ${root}`), { code: "EACCES" }); },
    };
    await assert.rejects(readArtifact(root, "denied.md", { fs: injected }), (error) => {
        assert.ok(error instanceof ArtifactReadError);
        assert.equal(error.code, "read_failed");
        assert.equal(error.status, 500);
        assert.equal(error.retryable, true);
        assert.ok(!error.message.includes(root));
        assert.ok(!error.message.includes("private filesystem detail"));
        return true;
    });
});

artifactTest("Windows path corpus rejects aliases, encoded traversal, devices, ADS, and metadata before filesystem access", async ({ validateArtifactPath }) => {
    const denied = ["../outside.md", "folder/../../outside.md", "./spec.md", "folder//spec.md", "/spec.md", "C:/spec.md", "C:spec.md",
        "\\\\host\\share\\spec.md", "//host/share/spec.md", "\\\\?\\C:\\spec.md", "\\\\.\\pipe\\spec.md", "spec.md:private", "spec.md::$DATA",
        "spec\0.md", "spec\n.md", "spec\x1f.md", "spec\x7f.md", ".git/private.md", "folder/.GIT/private.md", "folder./spec.md", "folder /spec.md",
        "%2e%2e/spec.md", "%252e%252e/spec.md", "folder%2fspec.md", "folder%5cspec.md", "folder%255cspec.md", "spec%00.md", "spec%0a.md", "C%3aspec.md",
        "CON.md", "nul.markdown", "conin$.md", "conout$.md", "LPT1/spec.md", "COM9.md", "COM\u00b9.md", "LPT\u00b2.md", "COM\u00b3.md", "con .md",
        "spec?.md", "spec*.md", 'spec".md', "spec<.md", "spec>.md", "spec|.md", "spec.txt", ""];
    for (const relativePath of denied) {
        assert.throws(() => validateArtifactPath(relativePath), { code: "unsupported_artifact" }, JSON.stringify(relativePath));
    }
    for (const relativePath of ["specs/001-feature/spec.md", "design notes.MARKDOWN", "Unicode-\u65e5\u672c\u8a9e.md", "contribution.md"]) {
        assert.equal(validateArtifactPath(relativePath).relativePath, relativePath);
    }
});

artifactTest("real Windows junction reparse points cannot escape the review workspace", async ({ root, readArtifact, testContext }) => {
    if (process.platform !== "win32") { testContext.skip("Windows junction acceptance runs in the required Windows job."); return; }
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await fs.mkdir(workspace);
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, "private.md"), "SYNTHETIC_OUTSIDE_JUNCTION_BODY");
    await fs.symlink(outside, join(workspace, "linked"), "junction");
    assert.equal((await fs.lstat(join(workspace, "linked"))).isSymbolicLink(), true);
    await assert.rejects(readArtifact(workspace, "linked/private.md"), { code: "unsupported_artifact" });
});

artifactTest("real file and directory symbolic links remain unreadable even when their targets are inside the workspace", async ({ root, readArtifact, testContext }) => {
    await fs.writeFile(join(root, "specs/001-fixture/spec.md"), "SYNTHETIC_SYMLINK_BODY");
    try {
        await fs.symlink(join(root, "specs/001-fixture/spec.md"), join(root, "alias.md"), "file");
        await fs.symlink(join(root, "specs/001-fixture"), join(root, "alias-dir"), "dir");
    } catch (error) {
        if (process.platform === "win32" && error.code === "EPERM") {
            if (process.env.CANVAS_READER_REQUIRE_WINDOWS === "1") assert.fail("Required Windows symlink coverage is unavailable; this security gate cannot be skipped.");
            testContext.skip("RELEASE-BLOCKING PLATFORM GAP: file/directory symlink creation needs Windows developer-mode privilege.");
            return;
        }
        throw error;
    }
    await assert.rejects(readArtifact(root, "alias.md"), { code: "unsupported_artifact" });
    await assert.rejects(readArtifact(root, "alias-dir/spec.md"), { code: "unsupported_artifact" });
});

artifactTest("non-regular targets and canonical reparse escapes are denied without opening a handle", async ({ root, readArtifact }) => {
    const target = join(await fs.realpath(root), "special.md");
    await fs.writeFile(target, "SYNTHETIC_SPECIAL_BODY");
    let opens = 0;
    for (const kind of ["fifo", "socket", "device", "canonical-escape"]) {
        const injected = {
            ...fs,
            async lstat(location, options) {
                const stat = await fs.lstat(location, options);
                return location === target && kind !== "canonical-escape"
                    ? { ...stat, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false } : stat;
            },
            realpath: (location) => location === target && kind === "canonical-escape" ? join(root, "..", "outside.md") : fs.realpath(location),
            async open() { opens++; throw new Error("A denied target must never be opened."); },
        };
        await assert.rejects(readArtifact(root, "special.md", { fs: injected }), { code: "unsupported_artifact" });
    }
    assert.equal(opens, 0);
});

artifactTest("strict decoding rejects overlong, surrogate, UTF-16 and incomplete multibyte sequences", async ({ root, readArtifact }) => {
    for (const bytes of [[0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff, 0xfe, 0x41, 0], [0xe2, 0x82]]) {
        await fs.writeFile(join(root, "encoding.md"), Buffer.from(bytes));
        await assert.rejects(readArtifact(root, "encoding.md"), { code: "invalid_encoding" });
    }
});

artifactTest("handle-close failures remain typed and never expose filesystem details", async ({ root, readArtifact, ArtifactReadError }) => {
    await fs.writeFile(join(root, "close.md"), "SYNTHETIC_CLOSE_BODY");
    const injected = {
        ...fs,
        async open(...args) {
            const handle = await fs.open(...args);
            return {
                stat: (...statArgs) => handle.stat(...statArgs),
                read: (...readArgs) => handle.read(...readArgs),
                async close() { await handle.close(); throw new Error(`SENSITIVE_CLOSE_DETAIL ${root}`); },
            };
        },
    };
    await assert.rejects(readArtifact(root, "close.md", { fs: injected }), (error) => {
        assert.ok(error instanceof ArtifactReadError);
        assert.equal(error.code, "read_failed");
        assert.ok(!error.message.includes(root));
        assert.ok(!error.message.includes("SENSITIVE_CLOSE_DETAIL"));
        return true;
    });
});
