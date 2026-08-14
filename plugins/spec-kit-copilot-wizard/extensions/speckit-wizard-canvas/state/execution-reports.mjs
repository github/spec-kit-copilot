// speckit-wizard — execution-report normalization
//
// Per-phase execution reports (produced by the wizard-tracking preamble in
// prompts.mjs, consumed by phase-card renderers) live in
// `composition.executionReports`. This module owns the CLOSED vocabulary
// of allowed per-artifact states plus the three pure normalizers /
// mergers / status-projectors that keep the store's view of reports
// stable across LLM drift.
//
// Extracted verbatim from state/store.mjs. No behavior changes.

/**
 * The CLOSED vocabulary of per-artifact execution states shared by:
 *   - the wizard-tracking preamble (prompts.mjs) that instructs the agent
 *     which two literal string values to emit for each expected id, and
 *   - normalizeExecutionReports below, which drops any state not in this
 *     set on the way into the store.
 *
 * Keeping these on one const kills the drift risk between the prompt's
 * instructions and the store's acceptance predicate: adding a third state
 * (e.g. "skipped") requires updating exactly one source-of-truth location.
 */
export const EXECUTION_STATES = Object.freeze(["executed", "omitted"]);

/**
 * Normalize an LLM-emitted `executionReports` map (see the
 * `phase.viewExecution` action). Returns null when there is nothing useful
 * to keep — an empty object confuses staleness reasoning downstream.
 *
 * Shape:
 *   executionReports: {
 *     "commands/speckit.<phase>": {
 *       expected: {                     // from the winning SKILL.md body
 *         templates: [id, ...],
 *         scripts:   [id, ...],
 *         hooks:     [id, ...]
 *       },
 *       observed: {                     // from Copilot session events; null when no run detected
 *         templates: [id, ...],
 *         scripts:   [id, ...],
 *         hooks:     [id, ...]
 *       } | null,
 *       sourcePath: "<path to winning SKILL.md>",
 *       sourceHash: "<sha256:… | mtime string>" | null,
 *       sessionId:  "<copilot session id>" | null,
 *       sessionWindow: { startedAt, endedAt } | null,
 *       analyzedAt: "<ISO-8601>",
 *       stale: boolean
 *     }
 *   }
 *
 * Discards:
 *   - Keys not starting with `commands/`.
 *   - Malformed entries (non-object; missing `expected`).
 *   - Unsupported capability-report-shaped entries (retains/drops fields) —
 *     silently ignored so malformed state cannot reach the UI.
 */
export function normalizeExecutionReports(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const VALID_KINDS = ["templates", "scripts", "hooks"];
    const VALID_STATES = new Set(EXECUTION_STATES);
    // Canonical bare-id lists per plural kind — used for `expected` only,
    // which is ground-truth from CORE_CAPABILITIES rather than a witness
    // report.
    const normBucket = (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const out = {};
        for (const k of VALID_KINDS) {
            out[k] = Array.isArray(raw[k])
                ? raw[k].filter((x) => typeof x === "string" && x.length > 0)
                : [];
        }
        return out;
    };
    // Per-artifact witness reports keyed by bare id, with singular kind
    // keys (`template` / `script` / `hook`). Absence of an id means the
    // agent did not report on it → UI renders "Unknown".
    const KIND_ALIAS = {
        template: "template", templates: "template",
        script: "script",     scripts: "script",
        hook: "hook",         hooks: "hook",
    };
    const normArtifactsMap = (raw) => {
        if (raw === null) return null;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const out = { template: {}, script: {}, hook: {} };
        for (const [rawKind, entries] of Object.entries(raw)) {
            const kind = KIND_ALIAS[rawKind];
            if (!kind) continue;
            if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
            for (const [id, val] of Object.entries(entries)) {
                if (typeof id !== "string" || !id.length) continue;
                if (!val || typeof val !== "object") continue;
                const state = typeof val.state === "string" ? val.state : null;
                if (!state || !VALID_STATES.has(state)) continue;
                const detail = typeof val.detail === "string" && val.detail.length
                    ? val.detail
                    : null;
                out[kind][id] = { state, detail };
            }
        }
        return out;
    };
    const normWindow = (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : null;
        const endedAt = typeof raw.endedAt === "string" ? raw.endedAt : null;
        if (!startedAt && !endedAt) return null;
        return { startedAt, endedAt };
    };
    const out = {};
    for (const [key, rawReport] of Object.entries(v)) {
        if (typeof key !== "string" || !key.startsWith("commands/")) continue;
        if (!rawReport || typeof rawReport !== "object") continue;
        const expected = normBucket(rawReport.expected);
        if (!expected) continue;
        // artifacts is the witness map. `null` means the agent explicitly
        // declined to report ("no run observed"). An empty-per-kind map
        // ({template:{},script:{},hook:{}}) means "the phase ran but the
        // agent didn't report on any declared artifact" — every row
        // renders as "Unknown".
        const artifacts = rawReport.artifacts === null
            ? null
            : normArtifactsMap(rawReport.artifacts);
        out[key] = {
            expected,
            artifacts,
            sourcePath: typeof rawReport.sourcePath === "string" && rawReport.sourcePath.length
                ? rawReport.sourcePath
                : null,
            sourceHash: typeof rawReport.sourceHash === "string" && rawReport.sourceHash.length
                ? rawReport.sourceHash
                : null,
            sessionId: typeof rawReport.sessionId === "string" && rawReport.sessionId.length
                ? rawReport.sessionId
                : null,
            sessionWindow: normWindow(rawReport.sessionWindow),
            analyzedAt: typeof rawReport.analyzedAt === "string" && rawReport.analyzedAt.length
                ? rawReport.analyzedAt
                : null,
            stale: rawReport.stale === true,
        };
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Sticky-executed merge for a single command's execution report entry.
 * Once an artifact has been reported `executed`, that verdict survives
 * subsequent runs even if a later run reports it as `omitted` or drops
 * the id entirely. This matches the user's mental model — "did this
 * phase produce its declared artifacts" — better than a bare replace,
 * which was showing "Omitted" pills after amendment runs (e.g. resolving
 * a [NEEDS CLARIFICATION]) that legitimately did not reload the template.
 *
 * Rules per (kind, bareId):
 *   - Prior state === "executed":
 *       kept as-is (the detail comes from the run that actually reached
 *       the artifact; the amendment run's detail wouldn't add info).
 *   - Prior state !== "executed" (omitted or absent):
 *       new value wins if present; otherwise prior stays.
 *   - Prior artifacts === null (agent had previously declined):
 *       new artifacts win outright.
 *   - New artifacts === null (this run declined):
 *       prior artifacts kept — a decline is not a wipe.
 *
 * Other fields (sourcePath, sessionId, analyzedAt, stale, expected) are
 * overwritten from the new entry — they describe the most recent run.
 */
export function mergeExecutionReportEntry(prev, next) {
    if (!next || typeof next !== "object") return prev ?? null;
    if (!prev || typeof prev !== "object") return next;
    const merged = { ...next };
    // artifacts merge with sticky-executed rule.
    if (next.artifacts === null) {
        merged.artifacts = prev.artifacts ?? null;
    } else if (prev.artifacts && typeof prev.artifacts === "object") {
        const out = { template: {}, script: {}, hook: {} };
        for (const kind of ["template", "script", "hook"]) {
            const priorMap = prev.artifacts[kind] ?? {};
            const nextMap = next.artifacts[kind] ?? {};
            const ids = new Set([...Object.keys(priorMap), ...Object.keys(nextMap)]);
            for (const id of ids) {
                const p = priorMap[id];
                const n = nextMap[id];
                if (p?.state === "executed") {
                    out[kind][id] = p;
                } else if (n) {
                    out[kind][id] = n;
                } else if (p) {
                    out[kind][id] = p;
                }
            }
        }
        merged.artifacts = out;
    }
    return merged;
}

/**
 * Given `expected` (canonical declared ids per kind) and `artifacts`
 * (per-artifact witness map, keyed by singular kind), produce a
 * stable-ordered per-item status list for rendering pills on the phase
 * card.
 *
 * Status values (three visible pills + `unexpected` bonus):
 *   - `executed`   — agent reported state:"executed".
 *   - `omitted`    — agent reported state:"omitted".
 *   - `unknown`    — agent did not report on this id (either the id is
 *                    absent from the witness map, or the whole map is
 *                    null because the agent declined). Silence is not
 *                    a claim.
 *   - `unexpected` — reported an id that isn't in `expected`.
 *
 * Kind order is fixed: templates → scripts → hooks (matches the row order
 * in the phase card).
 */
export function computeItemStatuses(expected, artifacts) {
    const KINDS = ["templates", "scripts", "hooks"];
    const kindToSingular = { templates: "template", scripts: "script", hooks: "hook" };
    const out = [];
    const exp = expected && typeof expected === "object" ? expected : {};
    const arts = artifacts && typeof artifacts === "object" ? artifacts : null;
    for (const kind of KINDS) {
        const singular = kindToSingular[kind];
        const expList = Array.isArray(exp[kind]) ? exp[kind] : [];
        const artsForKind = arts ? (arts[singular] ?? {}) : null;
        const expSet = new Set(expList);
        for (const name of expList) {
            let status;
            if (arts === null || !artsForKind[name]) status = "unknown";
            else status = artsForKind[name].state;
            out.push({ kind: singular, name, status });
        }
        if (arts !== null && artsForKind) {
            for (const [name, val] of Object.entries(artsForKind)) {
                if (expSet.has(name)) continue;
                out.push({ kind: singular, name, status: "unexpected", reportedState: val.state });
            }
        }
    }
    return out;
}
