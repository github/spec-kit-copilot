// speckit-wizard — environment probe
//
// Split into a pure `decideChecks(inputs)` and an impure `runChecks(deps)` so
// the decision logic is testable without shelling out.

// Pure. Given a set of known conditions (specifyDir exists, etc.), decide
// which probes need to run this cycle. Returns an ordered list of probe
// descriptors.
export function decideChecks(inputs = {}) {
    const {
        force = false,
        cachedAt = null,
        maxAgeMs = 60_000,
        projectInitialized = false,
        now = Date.now(),
    } = inputs;

    const stale = force || cachedAt === null || now - cachedAt > maxAgeMs;
    if (!stale) return [];

    const checks = [
        { name: "specify", cmd: "specify", args: ["--version"], timeoutMs: 5000, essential: true },
        { name: "spec-kit-plugin", cmd: "copilot", args: ["plugin", "list"], timeoutMs: 20_000, essential: true },
        { name: "git", cmd: "git", args: ["--version"], timeoutMs: 5000, essential: false },
        { name: "python", cmd: "python", args: ["--version"], timeoutMs: 5000, essential: false },
        { name: "uv", cmd: "uv", args: ["--version"], timeoutMs: 5000, essential: false },
        { name: "gh", cmd: "gh", args: ["--version"], timeoutMs: 5000, essential: false },
    ];

    if (projectInitialized) {
        checks.push({
            name: "specify-check",
            cmd: "specify",
            args: ["check"],
            timeoutMs: 10_000,
            essential: false,
        });
    }
    return checks;
}

// Pure. Fold probe results into a report shape suitable for the UI.
export function summarizeResults(results = []) {
    const byName = new Map();
    for (const r of results) byName.set(r.name, r);
    const specify = byName.get("specify");
    const cliInstalled = Boolean(specify && specify.exitCode === 0);
    const cliVersion = cliInstalled ? extractVersion(specify.stdout) : null;

    const plugin = byName.get("spec-kit-plugin");
    const pluginLine =
        plugin && plugin.exitCode === 0
            ? extractPluginLine(plugin.stdout)
            : null;
    const pluginInstalled = Boolean(pluginLine);
    const pluginVersion = pluginLine ? extractPluginVersion(pluginLine) : null;

    const checks = results.map((r) => ({
        name: r.name,
        status: r.error ? "error" : r.exitCode === 0 ? "ok" : "warn",
        level: r.error ? "error" : r.exitCode === 0 ? "ok" : "warn",
        detail: (r.stdout || r.stderr || r.error || "").trim().split("\n")[0] || "",
    }));
    return { cliInstalled, cliVersion, pluginInstalled, pluginVersion, checks };
}

function extractVersion(text) {
    if (!text) return null;
    const m = String(text).match(/(\d+\.\d+(?:\.\d+)?[\w.-]*)/);
    return m ? m[1] : null;
}

// Find the `spec-kit-copilot@…` line in `copilot plugin list` output.
function extractPluginLine(text) {
    if (!text) return null;
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (/(^|\W)spec-kit-copilot(@|\W|$)/.test(line)) return line;
    }
    return null;
}

// From e.g. `• spec-kit-copilot@spec-kit-marketplace (v0.11.8)` pull out `0.11.8`.
function extractPluginVersion(line) {
    if (!line) return null;
    const paren = line.match(/\(v?(\d+\.\d+(?:\.\d+)?[\w.-]*)\)/);
    if (paren) return paren[1];
    const bare = line.match(/(\d+\.\d+(?:\.\d+)?[\w.-]*)/);
    return bare ? bare[1] : null;
}

// Impure runner. deps.spawn(cmd, args, opts) returns
// { exitCode, stdout, stderr, error }. Callers own timeout enforcement so
// this stays testable — but we implement a safety timeout via deps.timers.
export async function runChecks(deps, inputs = {}) {
    const checks = decideChecks(inputs);
    if (!checks.length) return { results: [], skipped: true };
    const results = [];
    for (const c of checks) {
        try {
            const r = await deps.spawn(c.cmd, c.args, { timeoutMs: c.timeoutMs });
            results.push({ name: c.name, ...r });
        } catch (err) {
            results.push({
                name: c.name,
                exitCode: -1,
                stdout: "",
                stderr: "",
                error: err?.message ?? String(err),
            });
        }
    }
    return { results, skipped: false };
}
