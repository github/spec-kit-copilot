// Scan library for the assess-canvas extension.
//
// Resolves the Spec Kit project root, enumerates idea assessments under
// `.specify/assessments/<slug>/`, and reports per-stage completion so the
// canvas can render the five-stage discovery funnel.
//
// This module is pure filesystem inspection — it never writes and never
// drives the agent. All mutation happens by invoking the generated
// `speckit-assess-*` skills from extension.mjs.

import { closeSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// The five discovery stages, in funnel order. Each stage owns exactly one
// artifact file (see the assess extension README) and one generated skill.
export const STAGES = [
    { key: "intake", file: "intake.md", command: "speckit-assess-intake", label: "Intake", blurb: "Capture the raw idea" },
    { key: "research", file: "research.md", command: "speckit-assess-research", label: "Research", blurb: "Gather + challenge evidence" },
    { key: "define", file: "problem.md", command: "speckit-assess-define", label: "Define", blurb: "Problem, goals, metrics" },
    { key: "shape", file: "concept.md", command: "speckit-assess-shape", label: "Shape", blurb: "Options + appetite" },
    { key: "decide", file: "decision.md", command: "speckit-assess-decide", label: "Decide", blurb: "go / clarify / kill" },
];

const COMMAND_ALLOWLIST = new Set(STAGES.map((s) => s.command));
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const SCAN_PREFIX_BYTES = 64 * 1024;

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
        if (gitRoot === null && isGitMarker(join(dir, ".git"))) gitRoot = dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return gitRoot ?? resolve(startDir);
}

function isGitMarker(p) {
    try {
        const stat = lstatSync(p);
        return !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile());
    } catch {
        return false;
    }
}

function isRealDir(p) {
    try {
        const stat = lstatSync(p);
        return !stat.isSymbolicLink() && stat.isDirectory();
    } catch {
        return false;
    }
}

function hasRealDirectoryChain(root, ...segments) {
    let current = resolve(root);
    if (!isRealDir(current)) return false;
    for (const segment of segments) {
        current = join(current, segment);
        if (!isRealDir(current)) return false;
    }
    return true;
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

function readPrefixIfFile(p, maxBytes = SCAN_PREFIX_BYTES) {
    let fd;
    try {
        const stat = lstatSync(p);
        if (stat.isSymbolicLink() || !stat.isFile()) return null;
        fd = openSync(p, "r");
        const buffer = Buffer.allocUnsafe(maxBytes);
        const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead).toString("utf8");
    } catch {
        return null;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

function readArtifactFile(p) {
    let fd;
    try {
        const stat = lstatSync(p);
        if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, error: "not a file" };
        if (stat.size > MAX_ARTIFACT_BYTES) {
            return { ok: false, error: "artifact too large", maxBytes: MAX_ARTIFACT_BYTES };
        }
        fd = openSync(p, "r");
        const buffer = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1);
        const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_ARTIFACT_BYTES) {
            return { ok: false, error: "artifact too large", maxBytes: MAX_ARTIFACT_BYTES };
        }
        return { ok: true, content: buffer.subarray(0, bytesRead).toString("utf8") };
    } catch {
        return { ok: false, error: "not found" };
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

// Build the full dashboard state for a project root.
export function scanAssessments(projectRoot) {
    const assessDir = join(projectRoot, ".specify", "assessments");
    const initialized = hasRealDirectoryChain(projectRoot, ".specify");
    const assessmentsExist = initialized && hasRealDirectoryChain(projectRoot, ".specify", "assessments");
    const assessInstalled = initialized && hasRealDirectoryChain(projectRoot, ".specify", "extensions", "assess");
    const result = {
        projectRoot,
        assessDir,
        prerequisites: {
            initialized,
            assessInstalled,
            setupRequired: !initialized || !assessInstalled,
        },
        exists: assessmentsExist,
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
        if (!isRealDir(dir)) continue;

        const stages = {};
        let completed = 0;
        for (const stage of STAGES) {
            const filePath = join(dir, stage.file);
            let exists = false;
            let mtime = null;
            try {
                const st = lstatSync(filePath);
                if (!st.isSymbolicLink() && st.isFile()) {
                    exists = true;
                    mtime = st.mtimeMs;
                }
            } catch {
                // absent
            }
            stages[stage.key] = { exists, done: false, stale: false, file: stage.file, mtime };
        }

        const required = {
            intake: [],
            research: [],
            define: [],
            shape: ["define"],
            decide: ["define"],
        };
        for (let index = 0; index < STAGES.length; index++) {
            const stage = STAGES[index];
            const state = stages[stage.key];
            const requiredCurrent = required[stage.key].every((key) => stages[key].done);
            const newerInput = STAGES.slice(0, index).some((input) => {
                const inputState = stages[input.key];
                return inputState.exists && (inputState.stale || inputState.mtime > state.mtime);
            });
            const stale = state.exists && (!requiredCurrent || newerInput);
            const done = state.exists && !stale;
            state.done = done;
            state.stale = stale;
            if (done) {
                completed++;
                result.funnel[stage.key]++;
            }
        }
        const furthestDone = STAGES.reduce((latest, stage, index) => stages[stage.key].done ? index : latest, -1);
        const nextStage = furthestDone >= STAGES.length - 1 ? null : STAGES[furthestDone + 1].key;

        let verdict = null;
        let title = slug;
        const intakeText = readPrefixIfFile(join(dir, "intake.md"));
        if (intakeText) title = firstHeadingTitle(intakeText, slug);
        if (stages.decide.done) {
            const decisionText = readPrefixIfFile(join(dir, "decision.md"));
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

    const specifyDir = resolve(join(projectRoot, ".specify"));
    const assessDir = join(specifyDir, "assessments");
    const slugDir = join(assessDir, cleanSlug);
    const filePath = join(slugDir, stage.file);
    try {
        const components = [
            [specifyDir, "directory"],
            [assessDir, "directory"],
            [slugDir, "directory"],
            [filePath, "file"],
        ];
        for (const [path, type] of components) {
            const stat = lstatSync(path);
            if (stat.isSymbolicLink()) return { ok: false, error: "symlink not allowed" };
            if (type === "directory" ? !stat.isDirectory() : !stat.isFile()) {
                return { ok: false, error: type === "file" ? "not a file" : "not a directory" };
            }
        }
        const realAssessDir = realpathSync(assessDir);
        const realFilePath = realpathSync(filePath);
        const containedPath = relative(realAssessDir, realFilePath);
        if (!containedPath || containedPath.startsWith(`..${sep}`) || containedPath === ".." || isAbsolute(containedPath)) {
            return { ok: false, error: "path escape" };
        }
    } catch {
        return { ok: false, error: "not found" };
    }
    const artifact = readArtifactFile(filePath);
    if (!artifact.ok) return artifact;
    return { ok: true, slug: cleanSlug, stage: stage.key, file: stage.file, content: artifact.content };
}

const CLARIFICATION_SECTIONS = new Set([
    "first-glance unknowns",
    "gaps & open questions",
    "open questions",
    "if needs-clarification",
]);

export function extractClarifications(text) {
    const clarifications = [];
    let section = "";
    let inCodeFence = false;
    for (const line of String(text || "").split(/\r?\n/)) {
        if (line.startsWith("```")) {
            inCodeFence = !inCodeFence;
            continue;
        }
        if (inCodeFence) continue;
        const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
        if (heading) {
            section = heading[1].trim().toLowerCase();
            continue;
        }
        if (!CLARIFICATION_SECTIONS.has(section)) continue;
        const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
        if (!item) continue;
        for (const match of item[1].matchAll(/\[NEEDS CLARIFICATION:\s*([^\]]+)\]/gi)) {
            clarifications.push({
                index: clarifications.length,
                section,
                question: match[1].trim(),
            });
        }
    }
    return clarifications;
}

// Build a signature string for change detection (used by the SSE poller).
export function stateSignature(state) {
    const parts = [
        state.exists ? "1" : "0",
        state.prerequisites.initialized ? "i" : "-",
        state.prerequisites.assessInstalled ? "a" : "-",
    ];
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
