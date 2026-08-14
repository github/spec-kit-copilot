// Unit tests for env/deps-error-classifier.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyNpmError } from "../env/deps-error-classifier.mjs";

test("NPM_MISSING wins when missingBinary is true, regardless of stderr", () => {
    const c = classifyNpmError({ missingBinary: true, stderr: "anything" });
    assert.equal(c.code, "NPM_MISSING");
    assert.equal(c.canRetry, false);
    assert.match(c.title, /npm/);
});

test("classifies schannel handshake failures as TLS_HANDSHAKE", () => {
    const c = classifyNpmError({
        stderr: "npm ERR! request to https://registry.npmjs.org/js-yaml failed, reason: schannel: SEC_E_ILLEGAL_MESSAGE",
    });
    assert.equal(c.code, "TLS_HANDSHAKE");
    assert.equal(c.canRetry, true);
});

test("classifies OpenSSL handshake failures as TLS_HANDSHAKE", () => {
    const c = classifyNpmError({
        stderr: "SSL routines::ssl3_read_bytes:tlsv1 alert handshake failure",
    });
    assert.equal(c.code, "TLS_HANDSHAKE");
});

test("classifies self-signed cert chain errors as CERT_UNTRUSTED", () => {
    const c = classifyNpmError({
        stderr: "npm ERR! request to https://registry.npmjs.org failed, reason: self signed certificate in certificate chain SELF_SIGNED_CERT_IN_CHAIN",
    });
    assert.equal(c.code, "CERT_UNTRUSTED");
});

test("classifies HTTP 407 proxy-auth as HTTP_407_PROXY", () => {
    const c = classifyNpmError({
        stderr: "npm ERR! code E407\nnpm ERR! 407 Proxy Authentication Required",
    });
    assert.equal(c.code, "HTTP_407_PROXY");
});

test("classifies HTTP 403 as HTTP_403", () => {
    const c = classifyNpmError({
        stderr: "npm ERR! code E403\nnpm ERR! 403 Forbidden - GET https://registry.npmjs.org/js-yaml",
    });
    assert.equal(c.code, "HTTP_403");
});

test("classifies ECONNREFUSED as CONN_REFUSED", () => {
    const c = classifyNpmError({
        stderr: "npm ERR! network request to https://registry.npmjs.org failed, reason: connect ECONNREFUSED 127.0.0.1:443",
    });
    assert.equal(c.code, "CONN_REFUSED");
});

test("classifies ENOTFOUND as DNS_UNRESOLVED", () => {
    const c = classifyNpmError({
        stderr: "npm ERR! network request failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org",
    });
    assert.equal(c.code, "DNS_UNRESOLVED");
});

test("falls back to UNKNOWN for opaque failures", () => {
    const c = classifyNpmError({ stderr: "npm ERR! something odd", code: 1 });
    assert.equal(c.code, "UNKNOWN");
    assert.equal(c.canRetry, true);
    assert.ok(c.title);
    assert.ok(c.hint);
});

test("empty input still returns a well-formed record", () => {
    const c = classifyNpmError({});
    assert.equal(c.code, "UNKNOWN");
    assert.ok(typeof c.title === "string");
    assert.ok(typeof c.hint === "string");
    assert.equal(typeof c.canRetry, "boolean");
});
