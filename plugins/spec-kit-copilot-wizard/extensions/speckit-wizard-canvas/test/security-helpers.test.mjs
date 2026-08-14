// Tests for http-utils security helpers: isInside path-boundary check,
// resolveWorkspacePath sandbox, and safeExternalHref URL-scheme allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbsolute, sep, join as pathJoin } from "node:path";
import { EventEmitter } from "node:events";
import { isInside, resolveWorkspacePath } from "../server/http-utils.mjs";
import { safeExternalHref } from "../ui/client.js";

// --- isInside -------------------------------------------------------------

test("isInside returns true for the same path", () => {
    const p = pathJoin("a", "b", "c");
    assert.equal(isInside(p, p), true);
});

test("isInside returns true for a descendant", () => {
    const parent = pathJoin("root", "proj");
    const child = pathJoin("root", "proj", "sub", "file.txt");
    assert.equal(isInside(parent, child), true);
});

test("isInside rejects ancestors", () => {
    const parent = pathJoin("root", "proj");
    const child = pathJoin("root");
    assert.equal(isInside(parent, child), false);
});

test("isInside rejects prefix-collision siblings (the core bug)", () => {
    // The bug: startsWith("root/proj") matches "root/proj-secrets/…".
    // path.relative gives "..\proj-secrets\..." or "../proj-secrets/...",
    // which we reject.
    const parent = pathJoin("root", "proj");
    const sibling = pathJoin("root", "proj-secrets", "creds.env");
    assert.equal(isInside(parent, sibling), false);
});

test("isInside rejects ../ traversal", () => {
    const parent = pathJoin("root", "proj");
    const escape = pathJoin("root", "other", "file");
    assert.equal(isInside(parent, escape), false);
});

test("isInside rejects empty / falsy inputs", () => {
    assert.equal(isInside("", "/x"), false);
    assert.equal(isInside("/x", ""), false);
    assert.equal(isInside(null, "/x"), false);
});

// --- resolveWorkspacePath -------------------------------------------------

function mockRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.body = null;
    res.headersSent = false;
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.writeHead = (code, hdrs) => {
        res.statusCode = code;
        Object.assign(res.headers, hdrs ?? {});
        res.headersSent = true;
    };
    res.end = (b) => { res.body = b; res.headersSent = true; };
    return res;
}

test("resolveWorkspacePath: 400 when cwd missing", () => {
    const res = mockRes();
    const out = resolveWorkspacePath(res, "", "any/thing");
    assert.equal(out, null);
    assert.equal(res.statusCode, 400);
});

test("resolveWorkspacePath: accepts inside-workspace relative", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, "sub/file.txt");
    assert.notEqual(out, null);
    assert.equal(res.statusCode, 200); // untouched
    assert.equal(out, pathJoin(cwd, "sub", "file.txt"));
});

test("resolveWorkspacePath: rejects ../ escape", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, `..${sep}other${sep}file`);
    assert.equal(out, null);
    assert.equal(res.statusCode, 403);
});

test("resolveWorkspacePath: rejects prefix-collision sibling", () => {
    // This is the exact regression the fix targets.
    const cwd = pathJoin(process.cwd(), "worktrees", "myproj");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, `..${sep}myproj-secrets${sep}creds.env`);
    assert.equal(out, null);
    assert.equal(res.statusCode, 403);
});

test("resolveWorkspacePath: rejects absolute relPath", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    // OS-appropriate absolute path
    const abs = process.platform === "win32" ? "C:\\Windows\\System32\\config" : "/etc/passwd";
    // On the wrong drive/root, path.resolve returns abs as-is, so this must be caught.
    if (isAbsolute(abs)) {
        const out = resolveWorkspacePath(res, cwd, abs);
        assert.equal(out, null);
        assert.equal(res.statusCode, 403);
    }
});

test("resolveWorkspacePath: rejects non-string relPath", () => {
    const cwd = pathJoin(process.cwd(), "workspace-fixture");
    const res = mockRes();
    const out = resolveWorkspacePath(res, cwd, null);
    assert.equal(out, null);
    assert.equal(res.statusCode, 403);
});

// --- safeExternalHref -----------------------------------------------------

test("safeExternalHref: allows https", () => {
    const out = safeExternalHref("https://github.com/o/r");
    assert.equal(out, "https://github.com/o/r");
});

test("safeExternalHref: allows http", () => {
    const out = safeExternalHref("http://example.com/");
    assert.equal(out, "http://example.com/");
});

test("safeExternalHref: allows mailto", () => {
    const out = safeExternalHref("mailto:a@b.example");
    assert.equal(out, "mailto:a@b.example");
});

test("safeExternalHref: blocks javascript:", () => {
    assert.equal(safeExternalHref("javascript:alert(1)"), "");
    assert.equal(safeExternalHref("JavaScript:alert(1)"), "");
    // Leading whitespace shouldn't bypass — trim() then re-check
    assert.equal(safeExternalHref("  javascript:alert(1)"), "");
});

test("safeExternalHref: blocks data:", () => {
    assert.equal(safeExternalHref("data:text/html,<script>alert(1)</script>"), "");
});

test("safeExternalHref: blocks vbscript:", () => {
    assert.equal(safeExternalHref("vbscript:msgbox"), "");
});

test("safeExternalHref: blocks bare protocol-relative", () => {
    // // scheme is interpreted as protocol-relative; not on our allowlist,
    // so reject.
    assert.equal(safeExternalHref("//evil.example/x"), "");
});

test("safeExternalHref: blocks empty / falsy", () => {
    assert.equal(safeExternalHref(""), "");
    assert.equal(safeExternalHref(null), "");
    assert.equal(safeExternalHref(undefined), "");
});

test("safeExternalHref: HTML-escapes the returned URL", () => {
    // Even valid schemes must be HTML-escaped for attribute context.
    const out = safeExternalHref('https://example.com/"><img>');
    assert.match(out, /&quot;/);
    assert.doesNotMatch(out, /"/);
});
