// Scan library for the assess-canvas extension.
//
// Resolves the Spec Kit project root, enumerates idea assessments under
// `.specify/assessments/<slug>/`, and reports per-stage completion so the
// canvas can render the five-stage discovery funnel.
//
// This module is pure filesystem inspection — it never writes and never
// drives the agent. All mutation happens by sending `/speckit.assess.*`
// commands back to the agent from extension.mjs.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The five discovery stages, in funnel order. Each stage owns exactly one
// artifact file (see the assess extension README) and one slash command.
export const STAGES = [
    { key: "intake", file: "intake.md", command: "speckit.assess.intake", label: "Intake", blurb: "Capture the raw idea" },
    { key: "research", file: "research.md", command: "speckit.assess.research", label: "Research", blurb: "Gather + challenge evidence" },
    { key: "define", file: "problem.md", command: "speckit.assess.define", label: "Define", blurb: "Problem, goals, metrics" },
    { key: "shape", file: "concept.md", command: "speckit.assess.shape", label: "Shape", blurb: "Options + appetite" },
    { key: "decide", file: "decision.md", command: "speckit.assess.decide", label: "Decide", blurb: "go / clarify / kill" },
];

const COMMAND_ALLOWLIST = new Set(STAGES.map((s) => s.command));
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isAllowedCommand(command) {
    return COMMAND_ALLOWLIST.has(command);
}

export function stageByKey(key) {
    return STAGES.find((s) => s.key === key) || null;
}

export function normalizeSlug(raw) {
    if (typeof raw !== "string") return "";
    const slug = raw
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return SLUG_RE.test(slug) ? slug : "";
}

// Walk up from a starting directory looking for a Spec Kit project root.
// Prefer a directory that already has `.specify/`; fall back to the git root;
// finally fall back to the starting directory itself.
export function findProjectRoot(startDir = process.cwd()) {
    let dir = resolve(startDir);
    let gitRoot = null;
    for (let i = 0; i < 50; i++) {
        if (isRealDir(join(dir, ".specify"))) return dir;
        if (gitRoot === null && isRealDir(join(dir, ".git"))) gitRoot = dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return gitRoot ?? resolve(startDir);
}

function isRealDir(p) {
    try {
        return statSync(p).isDirectory();
    } catch {
        return false;
    }
}

// Extract the recorded verdict (go / needs-clarification / kill) from a
// decision.md, treating its contents strictly as data.
function parseVerdict(text) {
    const m = text.match(/verdict\s*[:*]*\s*\**\s*(go|needs-clarification|kill)\b/i);
    return m ? m[1].toLowerCase() : "unknown";
}

function firstHeadingTitle(text, fallback) {
    const m = text.match(/^#\s+(.+?)\s*$/m);
    if (!m) return fallback;
    return m[1].replace(/^[A-Za-z ]+:\s*/, "").trim() || fallback;
}

function readIfFile(p) {
    try {
        if (!statSync(p).isFile()) return null;
        return readFileSync(p, "utf8");
    } catch {
        return null;
    }
}

// Build the full dashboard state for a project root.
export function scanAssessments(projectRoot) {
    const assessDir = join(projectRoot, ".specify", "assessments");
    const initialized = isRealDir(join(projectRoot, ".specify"));
    const assessInstalled = isRealDir(join(projectRoot, ".specify", "extensions", "assess"));
    const result = {
        projectRoot,
        assessDir,
        prerequisites: {
            initialized,
            assessInstalled,
            setupRequired: !initialized || !assessInstalled,
        },
        exists: isRealDir(assessDir),
        stages: STAGES.map(({ key, label, blurb, command }) => ({ key, label, blurb, command })),
        assessments: [],
        funnel: Object.fromEntries(STAGES.map((s) => [s.key, 0])),
        verdicts: { go: 0, "needs-clarification": 0, kill: 0 },
        scannedAt: new Date().toISOString(),
    };

    if (!result.exists) return result;

    let entries = [];
    try {
        entries = readdirSync(assessDir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const slug = entry.name;
        if (!SLUG_RE.test(slug)) continue;
        const dir = join(assessDir, slug);

        const stages = {};
        let completed = 0;
        let nextStage = null;
        let chainCurrent = true;
        let latestMtime = 0;
        for (const stage of STAGES) {
            const filePath = join(dir, stage.file);
            let exists = false;
            let mtime = null;
            try {
                const st = statSync(filePath);
                if (st.isFile()) {
                    exists = true;
                    mtime = st.mtimeMs;
                }
            } catch {
                // absent
            }
            const stale = exists && (!chainCurrent || (latestMtime > 0 && mtime < latestMtime));
            const done = exists && !stale;
            stages[stage.key] = { exists, done, stale, file: stage.file, mtime };
            if (done) {
                completed++;
                result.funnel[stage.key]++;
                latestMtime = Math.max(latestMtime, mtime);
            } else if (!nextStage) {
                nextStage = stage.key;
            }
            if (!done) chainCurrent = false;
        }

        let verdict = null;
        let title = slug;
        const intakeText = readIfFile(join(dir, "intake.md"));
        if (intakeText) title = firstHeadingTitle(intakeText, slug);
        if (stages.decide.done) {
            const decisionText = readIfFile(join(dir, "decision.md"));
            if (decisionText) {
                verdict = parseVerdict(decisionText);
                if (result.verdicts[verdict] !== undefined) result.verdicts[verdict]++;
                if (title === slug) title = firstHeadingTitle(decisionText, slug);
            }
        }

        const lastActivity = Object.values(stages)
            .map((s) => s.mtime)
            .filter((m) => typeof m === "number")
            .reduce((a, b) => Math.max(a, b), 0);

        result.assessments.push({
            slug,
            title,
            stages,
            completed,
            total: STAGES.length,
            nextStage,
            verdict,
            lastActivity: lastActivity || null,
        });
    }

    result.assessments.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    return result;
}

// Safely read one artifact's markdown for preview. Rejects bad slugs/stages
// and verifies the resolved path stays inside the assessments directory.
export function readArtifact(projectRoot, slug, stageKey) {
    const cleanSlug = normalizeSlug(slug);
    if (!cleanSlug) return { ok: false, error: "invalid slug" };
    const stage = stageByKey(stageKey);
    if (!stage) return { ok: false, error: "invalid stage" };

    const assessDir = resolve(join(projectRoot, ".specify", "assessments"));
    const filePath = resolve(join(assessDir, cleanSlug, stage.file));
    const expected = join(assessDir, cleanSlug, stage.file);
    if (filePath !== expected) return { ok: false, error: "path escape" };
    if (!filePath.startsWith(assessDir + "/")) return { ok: false, error: "path escape" };
    if (!existsSync(filePath)) return { ok: false, error: "not found" };
    const content = readIfFile(filePath);
    if (content === null) return { ok: false, error: "not a file" };
    return { ok: true, slug: cleanSlug, stage: stage.key, file: stage.file, content };
}

// Build a signature string for change detection (used by the SSE poller).
export function stateSignature(state) {
    const parts = [state.exists ? "1" : "0"];
    for (const a of state.assessments) {
        parts.push(a.slug);
        for (const stage of STAGES) {
            const s = a.stages[stage.key];
            parts.push(s.mtime ? `${Math.round(s.mtime)}:${s.stale ? "s" : "d"}` : "-");
        }
        parts.push(a.verdict || "-");
    }
    return parts.join("|");
}
