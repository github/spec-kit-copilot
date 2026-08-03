// Scan library for the sdd-canvas extension.
//
// Resolves the Spec Kit project root, enumerates features under
// `specs/<feature>/`, and reports per-stage completion so the canvas can render
// the core Spec-Driven Development workflow:
//
//   constitution → specify → clarify → plan → tasks → analyze → checklist → implement
//
// This module is pure filesystem inspection — it never writes and never drives
// the agent. All mutation happens by invoking the generated core `speckit-*`
// skills from extension.mjs.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// The primary artifact spine, in pipeline order. Each stage owns exactly one
// Markdown artifact under the feature directory and one generated skill. These
// three drive the done/stale chain; implement is derived from tasks.md progress.
export const STAGES = [
    { key: "specify", file: "spec.md", command: "speckit-specify", label: "Specify", blurb: "Define what to build" },
    { key: "plan", file: "plan.md", command: "speckit-plan", label: "Plan", blurb: "Design the implementation" },
    { key: "tasks", file: "tasks.md", command: "speckit-tasks", label: "Tasks", blurb: "Break the plan into tasks" },
];

// implement has no artifact of its own — it checks off tasks.md and edits
// source. It is surfaced as a fourth funnel column derived from task progress.
export const IMPLEMENT = { key: "implement", command: "speckit-implement", label: "Implement", blurb: "Build the feature" };

// Optional quality gates. clarify/checklist leave a detectable trace; analyze is
// read-only (chat report only) so it can be run but never shows a persistent
// "done" badge.
export const GATES = [
    { key: "clarify", command: "speckit-clarify", label: "Clarify", after: "specify", trackable: true },
    { key: "analyze", command: "speckit-analyze", label: "Analyze", after: "tasks", trackable: false },
    { key: "checklist", command: "speckit-checklist", label: "Checklist", after: "specify", trackable: true },
];

// Project-level governance. Lives outside any feature directory.
export const CONSTITUTION = {
    key: "constitution",
    command: "speckit-constitution",
    label: "Constitution",
    rel: [".specify", "memory", "constitution.md"],
};

// Every core skill the canvas is allowed to trigger.
const COMMAND_ALLOWLIST = new Set([
    CONSTITUTION.command,
    ...STAGES.map((s) => s.command),
    IMPLEMENT.command,
    ...GATES.map((g) => g.command),
]);

// Which upstream primary stages must be current before a stage is "done".
const REQUIRED = {
    specify: [],
    plan: ["specify"],
    tasks: ["plan"],
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const SCAN_PREFIX_BYTES = 64 * 1024;

export function isAllowedCommand(command) {
    return COMMAND_ALLOWLIST.has(command);
}

export function stageByKey(key) {
    return STAGES.find((s) => s.key === key) || null;
}

export function commandForKey(key) {
    if (key === CONSTITUTION.key) return CONSTITUTION.command;
    if (key === IMPLEMENT.key) return IMPLEMENT.command;
    const stage = stageByKey(key);
    if (stage) return stage.command;
    const gate = GATES.find((g) => g.key === key);
    return gate ? gate.command : null;
}

// Feature directory names ("003-user-auth", "20260319-143022-user-auth", …)
// are already kebab-case slugs. Normalize/validate like a slug.
export function normalizeSlug(raw) {
    if (typeof raw !== "string") return "";
    const slug = raw
        .trim()
        .replace(/^specs[/\\]/i, "")
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
    for (let i = 0; i < 50; i++) {
        if (isRealDir(join(dir, ".specify"))) return dir;
        if (isGitMarker(join(dir, ".git"))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return resolve(startDir);
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

function isContained(realRoot, realPath) {
    const containedPath = relative(realRoot, realPath);
    return Boolean(containedPath)
        && containedPath !== ".."
        && !containedPath.startsWith(`..${sep}`)
        && !isAbsolute(containedPath);
}

function realDirectoryWithin(p, realRoot) {
    try {
        const stat = lstatSync(p);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
        const realPath = realpathSync(p);
        return !realRoot || realPath === realRoot || isContained(realRoot, realPath) ? realPath : null;
    } catch {
        return null;
    }
}

function openVerifiedFile(p, realRoot) {
    let fd;
    try {
        const before = lstatSync(p);
        if (before.isSymbolicLink() || !before.isFile()) return null;
        const beforeRealPath = realpathSync(p);
        if (!isContained(realRoot, beforeRealPath)) return null;
        fd = openSync(p, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const opened = fstatSync(fd);
        const after = lstatSync(p);
        const afterRealPath = realpathSync(p);
        if (
            !opened.isFile()
            || after.isSymbolicLink()
            || !after.isFile()
            || opened.dev !== after.dev
            || opened.ino !== after.ino
            || beforeRealPath !== afterRealPath
            || !isContained(realRoot, afterRealPath)
        ) {
            closeSync(fd);
            fd = undefined;
            return null;
        }
        return { fd, stat: opened };
    } catch {
        if (fd !== undefined) closeSync(fd);
        return null;
    }
}

function readPrefixIfFile(p, realRoot, maxBytes = SCAN_PREFIX_BYTES) {
    const opened = openVerifiedFile(p, realRoot);
    if (!opened) return null;
    try {
        const buffer = Buffer.allocUnsafe(maxBytes);
        const bytesRead = readSync(opened.fd, buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead).toString("utf8");
    } catch {
        return null;
    } finally {
        closeSync(opened.fd);
    }
}

function readArtifactFile(p, realRoot) {
    const opened = openVerifiedFile(p, realRoot);
    if (!opened) return { ok: false, error: "not found" };
    try {
        if (opened.stat.size > MAX_ARTIFACT_BYTES) {
            return { ok: false, error: "artifact too large", maxBytes: MAX_ARTIFACT_BYTES };
        }
        const buffer = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1);
        const bytesRead = readSync(opened.fd, buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_ARTIFACT_BYTES) {
            return { ok: false, error: "artifact too large", maxBytes: MAX_ARTIFACT_BYTES };
        }
        return { ok: true, content: buffer.subarray(0, bytesRead).toString("utf8") };
    } catch {
        return { ok: false, error: "not found" };
    } finally {
        closeSync(opened.fd);
    }
}

function readJsonIfFile(p, realRoot) {
    const text = readPrefixIfFile(p, realRoot);
    if (text === null) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function isVerifiedFile(p, realRoot) {
    const opened = openVerifiedFile(p, realRoot);
    if (!opened) return false;
    closeSync(opened.fd);
    return true;
}

function firstHeadingTitle(text, fallback) {
    const m = text.match(/^#\s+(.+?)\s*$/m);
    if (!m) return fallback;
    return m[1].replace(/^[A-Za-z ]+:\s*/, "").trim() || fallback;
}

// Detect whether the constitution has been filled in (ratified) versus still
// carrying the raw `[PLACEHOLDER]` template tokens.
function constitutionStatus(text) {
    if (typeof text !== "string" || !text.trim()) return "missing";
    const placeholders = (text.match(/\[[A-Z0-9_]+\]/g) || []).length;
    return placeholders > 0 ? "template" : "ratified";
}

// Count task checkboxes in tasks.md to derive implementation progress.
function taskProgress(text) {
    if (typeof text !== "string") return { total: 0, completed: 0 };
    let total = 0;
    let completed = 0;
    let inFence = false;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("```")) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        const m = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
        if (!m) continue;
        total++;
        if (m[1] !== " ") completed++;
    }
    return { total, completed };
}

// Whether the spec has an answered `## Clarifications` session (clarify ran).
function hasClarifications(text) {
    if (typeof text !== "string") return false;
    return /^##\s+Clarifications\b/m.test(text) && /^###\s+Session\b/m.test(text);
}

// The core commands register as skills in Copilot skills mode. Confirm every
// command the canvas can drive is present on disk under `.github/skills/`.
function areSkillsReady(projectRoot, realProjectRoot, initialized) {
    if (!initialized) return false;
    return [...COMMAND_ALLOWLIST].every((command) => (
        hasRealDirectoryChain(projectRoot, ".github", "skills", command)
        && isVerifiedFile(join(projectRoot, ".github", "skills", command, "SKILL.md"), realProjectRoot)
    ));
}

// Read `.specify/feature.json` to learn the currently active feature directory.
function activeFeatureSlug(projectRoot, realProjectRoot) {
    const data = readJsonIfFile(join(projectRoot, ".specify", "feature.json"), realProjectRoot);
    const dir = data && typeof data.feature_directory === "string" ? data.feature_directory : "";
    return normalizeSlug(dir);
}

// Count `.md` checklist files under a feature's checklists/ directory.
function countChecklists(dir) {
    if (!isRealDir(dir)) return 0;
    try {
        return readdirSync(dir, { withFileTypes: true }).filter((e) => {
            if (e.isSymbolicLink() || !e.isFile()) return false;
            return e.name.toLowerCase().endsWith(".md");
        }).length;
    } catch {
        return 0;
    }
}

// Build the full dashboard state for a project root.
export function scanFeatures(projectRoot) {
    const realProjectRoot = realDirectoryWithin(projectRoot);
    const specsDir = join(projectRoot, "specs");
    const initialized = Boolean(realProjectRoot) && hasRealDirectoryChain(projectRoot, ".specify");
    const realSpecsDir = hasRealDirectoryChain(projectRoot, "specs")
        ? realDirectoryWithin(specsDir, realProjectRoot)
        : null;
    const skillsInstalled = areSkillsReady(projectRoot, realProjectRoot, initialized);

    const constitutionText = readPrefixIfFile(
        join(projectRoot, ...CONSTITUTION.rel),
        realProjectRoot,
    );
    const constitution = {
        status: constitutionStatus(constitutionText),
        command: CONSTITUTION.command,
    };

    const result = {
        projectRoot,
        specsDir,
        prerequisites: {
            initialized,
            skillsInstalled,
            setupRequired: !initialized || !skillsInstalled,
        },
        exists: Boolean(realSpecsDir),
        stages: STAGES.map(({ key, label, blurb, command }) => ({ key, label, blurb, command })),
        gates: GATES.map(({ key, label, command, trackable }) => ({ key, label, command, trackable })),
        implement: { key: IMPLEMENT.key, label: IMPLEMENT.label, blurb: IMPLEMENT.blurb, command: IMPLEMENT.command },
        constitution,
        activeFeature: activeFeatureSlug(projectRoot, realProjectRoot),
        features: [],
        funnel: { specify: 0, plan: 0, tasks: 0, implement: 0 },
        gateCounts: { clarify: 0, checklist: 0 },
        scannedAt: new Date().toISOString(),
    };

    if (!result.exists) return result;

    let entries = [];
    try {
        entries = readdirSync(specsDir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const slug = entry.name;
        if (!SLUG_RE.test(slug)) continue;
        const dir = join(specsDir, slug);
        if (!isRealDir(dir)) continue;

        const stages = {};
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

        let completed = 0;
        for (let index = 0; index < STAGES.length; index++) {
            const stage = STAGES[index];
            const state = stages[stage.key];
            const requiredCurrent = REQUIRED[stage.key].every((key) => stages[key].done);
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
                if (result.funnel[stage.key] !== undefined) result.funnel[stage.key]++;
            }
        }

        let title = slug;
        let clarified = false;
        const specText = readPrefixIfFile(join(dir, "spec.md"), realSpecsDir);
        if (specText) {
            title = firstHeadingTitle(specText, slug);
            clarified = hasClarifications(specText);
        }
        if (clarified) result.gateCounts.clarify++;

        const checklistCount = countChecklists(join(dir, "checklists"));
        if (checklistCount > 0) result.gateCounts.checklist++;

        let progress = { total: 0, completed: 0 };
        if (stages.tasks.done) {
            const tasksText = readPrefixIfFile(join(dir, "tasks.md"), realSpecsDir);
            if (tasksText) progress = taskProgress(tasksText);
        }
        const implementStarted = progress.completed > 0;
        const implementDone = stages.tasks.done && progress.total > 0 && progress.completed === progress.total;
        if (implementDone) result.funnel.implement++;

        // The next recommended primary milestone along the spine.
        let nextStage = null;
        if (!stages.specify.done) nextStage = "specify";
        else if (!stages.plan.done) nextStage = "plan";
        else if (!stages.tasks.done) nextStage = "tasks";
        else if (!implementDone) nextStage = "implement";

        const lastActivity = Object.values(stages)
            .map((s) => s.mtime)
            .filter((m) => typeof m === "number")
            .reduce((a, b) => Math.max(a, b), 0);

        result.features.push({
            slug,
            title,
            stages,
            completed,
            total: STAGES.length,
            nextStage,
            clarified,
            checklistCount,
            implement: {
                started: implementStarted,
                done: implementDone,
                total: progress.total,
                completed: progress.completed,
            },
            active: slug === result.activeFeature,
            lastActivity: lastActivity || null,
        });
    }

    result.features.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (b.lastActivity || 0) - (a.lastActivity || 0);
    });
    return result;
}

const PREVIEWABLE = new Set([...STAGES.map((s) => s.key), CONSTITUTION.key]);

// Safely read one artifact's markdown for preview. Rejects bad feature/stage
// and verifies the resolved path stays inside the project root.
export function readArtifact(projectRoot, featureInput, stageKey) {
    if (!PREVIEWABLE.has(stageKey)) return { ok: false, error: "invalid stage" };

    const realProjectRoot = realDirectoryWithin(projectRoot);
    if (!realProjectRoot) return { ok: false, error: "not found" };

    let filePath;
    let chain;
    let cleanSlug = null;
    if (stageKey === CONSTITUTION.key) {
        filePath = join(projectRoot, ...CONSTITUTION.rel);
        chain = [
            [join(projectRoot, ".specify"), "directory"],
            [join(projectRoot, ".specify", "memory"), "directory"],
            [filePath, "file"],
        ];
    } else {
        cleanSlug = normalizeSlug(featureInput);
        if (!cleanSlug) return { ok: false, error: "invalid feature" };
        const stage = stageByKey(stageKey);
        if (!stage) return { ok: false, error: "invalid stage" };
        const specsDir = join(projectRoot, "specs");
        const featureDir = join(specsDir, cleanSlug);
        filePath = join(featureDir, stage.file);
        chain = [
            [specsDir, "directory"],
            [featureDir, "directory"],
            [filePath, "file"],
        ];
    }

    try {
        for (const [path, type] of chain) {
            const stat = lstatSync(path);
            if (stat.isSymbolicLink()) return { ok: false, error: "symlink not allowed" };
            if (type === "directory" ? !stat.isDirectory() : !stat.isFile()) {
                return { ok: false, error: type === "file" ? "not a file" : "not a directory" };
            }
        }
        const realFilePath = realpathSync(filePath);
        if (!isContained(realProjectRoot, realFilePath)) return { ok: false, error: "path escape" };
    } catch {
        return { ok: false, error: "not found" };
    }

    const artifact = readArtifactFile(filePath, realProjectRoot);
    if (!artifact.ok) return artifact;
    const file = stageKey === CONSTITUTION.key ? "constitution.md" : stageByKey(stageKey).file;
    return { ok: true, feature: cleanSlug, stage: stageKey, file, content: artifact.content };
}

// Pull `[NEEDS CLARIFICATION: …]` markers out of a spec so the canvas can offer
// a targeted clarify action. Contents are treated strictly as data.
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
        const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
        if (heading) {
            section = heading[1].trim();
            continue;
        }
        for (const match of line.matchAll(/\[NEEDS CLARIFICATION:\s*([^\]]+)\]/gi)) {
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
        state.prerequisites.skillsInstalled ? "s" : "-",
        `c:${state.constitution.status}`,
        `a:${state.activeFeature || "-"}`,
    ];
    for (const feature of state.features) {
        parts.push(feature.slug);
        for (const stage of STAGES) {
            const s = feature.stages[stage.key];
            parts.push(s.mtime ? `${Math.round(s.mtime)}:${s.stale ? "s" : "d"}` : "-");
        }
        parts.push(`cl:${feature.clarified ? 1 : 0}`);
        parts.push(`ck:${feature.checklistCount}`);
        parts.push(`im:${feature.implement.completed}/${feature.implement.total}`);
    }
    return parts.join("|");
}
