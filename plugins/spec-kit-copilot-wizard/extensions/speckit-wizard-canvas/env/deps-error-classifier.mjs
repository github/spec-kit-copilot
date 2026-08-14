// Classify an npm install failure into a small, actionable set of codes.
//
// The wizard canvas runs `npm install js-yaml` on first open. When that
// fails, the raw stderr is unhelpful to end-users (schannel error codes,
// EPROXY, SELF_SIGNED_CERT_IN_CHAIN, etc). This module reduces the noise
// to a fixed set of codes + a plain-English title/hint so the UI can:
//
//   1. render an actionable error card, and
//   2. hand the code off to the agent-diagnostic prompt so the agent
//      knows what to attempt first.
//
// The classifier is deliberately narrow, string-matches on real stderr
// fragments captured in the wild, and prefers the most specific match.
// Unknown failures fall through to UNKNOWN — the UI still shows a card,
// just with a generic title/hint.

/**
 * @typedef {"TLS_HANDSHAKE" | "CERT_UNTRUSTED" | "CONN_REFUSED"
 *   | "DNS_UNRESOLVED" | "HTTP_403" | "HTTP_407_PROXY"
 *   | "NPM_MISSING" | "UNKNOWN"} NpmErrorCode
 */

/**
 * @param {{ stderr?: string, stdout?: string, code?: number|null, missingBinary?: boolean }} input
 * @returns {{ code: NpmErrorCode, title: string, hint: string, canRetry: boolean }}
 */
export function classifyNpmError(input = {}) {
    const stderr = String(input.stderr ?? "");
    const stdout = String(input.stdout ?? "");
    const text = `${stderr}\n${stdout}`;
    const missingBinary = !!input.missingBinary;

    if (missingBinary) {
        return {
            code: "NPM_MISSING",
            title: "npm is not on PATH",
            hint: "Install Node.js (which includes npm) and reopen the canvas.",
            canRetry: false,
        };
    }

    // Order matters: check specific/high-signal fragments before generic ones.
    if (/HANDSHAKE_FAILURE|SEC_E_ILLEGAL_MESSAGE|schannel: SEC_E|alert handshake failure|EPROTO/.test(text)) {
        return {
            code: "TLS_HANDSHAKE",
            title: "npm can't complete a TLS handshake with the registry",
            hint: "A corporate TLS-inspecting proxy or firewall is likely blocking registry.npmjs.org. Configure npm to use your organization's approved mirror.",
            canRetry: true,
        };
    }

    if (/SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|unable to verify the first certificate|CERT_UNTRUSTED/i.test(text)) {
        return {
            code: "CERT_UNTRUSTED",
            title: "npm can't verify the registry's TLS certificate",
            hint: "A corporate certificate is intercepting HTTPS. Point npm at your organization's CA bundle (`npm config set cafile`).",
            canRetry: true,
        };
    }

    if (/HTTP\s?407|407 Proxy Authentication Required|Proxy Authentication Required/i.test(text)) {
        return {
            code: "HTTP_407_PROXY",
            title: "npm needs to authenticate with a proxy",
            hint: "Set `HTTPS_PROXY` (or npm's `https-proxy` config) with credentials your proxy accepts.",
            canRetry: true,
        };
    }

    if (/HTTP\s?403|E403|Forbidden|Registry returned 403/i.test(text)) {
        return {
            code: "HTTP_403",
            title: "The npm registry rejected the request (HTTP 403)",
            hint: "Check that your account/token has permission for js-yaml, or switch to your organization's approved feed.",
            canRetry: true,
        };
    }

    if (/ECONNREFUSED|connect ECONNREFUSED/i.test(text)) {
        return {
            code: "CONN_REFUSED",
            title: "npm couldn't connect to the registry",
            hint: "The registry host refused the TCP connection. Check that you're online and that no local proxy is blocking outbound HTTPS.",
            canRetry: true,
        };
    }

    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
        return {
            code: "DNS_UNRESOLVED",
            title: "npm couldn't resolve the registry hostname",
            hint: "DNS lookup failed for the npm registry. Confirm you're online, and check your DNS or VPN configuration.",
            canRetry: true,
        };
    }

    return {
        code: "UNKNOWN",
        title: "npm install failed",
        hint: "The Copilot agent can walk you through diagnosing the cause and repairing your npm configuration.",
        canRetry: true,
    };
}
