// Build the agent prompt used by the "Diagnose and fix with the agent"
// button on the wizard canvas.
//
// The prompt is a self-contained, numbered checklist the Copilot agent
// walks in the parent chat session. It carries the extension folder path
// so the agent doesn't have to guess where to install, the classified
// error code so it knows what to attempt first, and a short stderr tail
// as evidence. When the fix succeeds it must call the wizard's
// `refreshEnvironment` canvas action so the diagnostic card clears.

const CODE_HINTS = {
    TLS_HANDSHAKE:
        "Focus on TLS: a corporate TLS-inspecting proxy is almost certainly rewriting the handshake. Check whether the user's org has an approved npm mirror and whether npm needs to trust a corporate CA bundle.",
    CERT_UNTRUSTED:
        "Focus on certificates: an intercepting proxy is presenting a certificate npm doesn't trust. The user's org likely publishes a CA bundle — configure npm to use it via `npm config set cafile`.",
    HTTP_407_PROXY:
        "Focus on proxy authentication: the user is behind an authenticated corporate proxy. Configure `HTTPS_PROXY` / `HTTP_PROXY` and npm's `https-proxy` / `http-proxy` with credentials the proxy accepts.",
    HTTP_403:
        "Focus on registry authorization: either the user's account lacks permission or the wrong registry is configured. Check whether the org uses a private feed and switch npm to it if so.",
    CONN_REFUSED:
        "Focus on connectivity: something is refusing the TCP connection to the registry. Confirm the user is online and no local proxy is intercepting HTTPS.",
    DNS_UNRESOLVED:
        "Focus on DNS: the registry hostname isn't resolving. Confirm the user is online (VPN state?) and check DNS configuration.",
    NPM_MISSING:
        "npm is not installed or not on PATH. Ask the user to install Node.js (which includes npm) from https://nodejs.org, then reopen the canvas.",
    UNKNOWN:
        "The failure did not match a known pattern. Walk the diagnostic checklist below and report back what you find before attempting any fix.",
};

function truncateStderr(s) {
    const raw = String(s ?? "").trim();
    if (!raw) return "(no stderr captured)";
    // Zero-width space between backticks so a stderr line containing "```"
    // can't break out of the markdown code fence in the dispatched prompt
    // (a compromised registry/proxy could otherwise inject instructions).
    const safe = raw.replace(/`{3,}/g, (m) => m.split("").join("\u200B"));
    if (safe.length <= 1200) return safe;
    return safe.slice(0, 1200) + "\n… (truncated)";
}

/**
 * @param {object} opts
 * @param {string} opts.extDir         Absolute path to the extension folder.
 * @param {string} opts.errorCode      Classified npm error code (see classifier).
 * @param {string} [opts.stderr]       Raw stderr from the failed install.
 * @param {string} [opts.workspacePath] User workspace path (for context).
 * @returns {string}
 */
export function buildNpmDiagnosticPrompt({ extDir, errorCode, stderr = "", workspacePath = null } = {}) {
    if (!extDir || typeof extDir !== "string") {
        throw new Error("buildNpmDiagnosticPrompt requires extDir");
    }
    const codeHint = CODE_HINTS[errorCode] ?? CODE_HINTS.UNKNOWN;
    const wsLine = workspacePath ? `\nUser workspace: ${workspacePath}` : "";
    return [
        "The Spec Kit Wizard canvas failed to install its js-yaml dependency and is asking you to diagnose the underlying npm/network problem.",
        "",
        `Classified error code: **${errorCode}**`,
        `Extension folder (run every npm command inside this folder): ${extDir}${wsLine}`,
        "",
        `Guidance for this error code: ${codeHint}`,
        "",
        "Captured stderr:",
        "```",
        truncateStderr(stderr),
        "```",
        "",
        "Walk this checklist step by step. Report what you find between steps so the user can follow along. Do NOT make edits without explaining what you're changing and why.",
        "",
        "1. Read the user's current npm config: `npm config list -l` (and `npm config get registry`, `cafile`, `https-proxy`).",
        "2. Read `~/.npmrc` if present (create the file if it doesn't exist and edits are needed). Do not touch project-level `.npmrc` unless the user asks.",
        "3. Ask the user which of the following applies (offer as a short numbered choice):",
        "   a. They have an approved corporate npm mirror URL (paste it).",
        "   b. Their org publishes a corporate CA bundle (path to .pem/.crt).",
        "   c. They're behind an authenticated proxy (share HTTPS_PROXY value).",
        "   d. None of the above / they don't know — recommend they check with IT.",
        "4. Based on the answer, propose the minimal `~/.npmrc` change (registry=, cafile=, https-proxy=, or a strict-ssl override as a last resort). Show the exact diff before applying.",
        "5. Apply the change with the user's confirmation.",
        `6. Retry the install with: \`cd "${extDir}" && npm install --no-audit --no-fund\``,
        "7. If it succeeds, invoke the wizard's `refreshEnvironment` canvas action (canvasId `speckit-wizard`) so the diagnostic banner clears. If it fails again, capture the new stderr, re-classify, and continue the loop.",
        "",
        "Constraints:",
        "- Never disable TLS certificate validation project-wide without the user's explicit consent.",
        "- Never commit secrets (proxy credentials, tokens) to any file that could be checked in.",
        "- Prefer the least-invasive fix — a user-level `~/.npmrc` change over a system-wide one.",
    ].join("\n");
}
