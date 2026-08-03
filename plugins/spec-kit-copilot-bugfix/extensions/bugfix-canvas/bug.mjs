// Scan library for the bugfix-canvas extension.
//
// Resolves the Spec Kit project root, enumerates bugs under
// `.specify/bugs/<slug>/`, and reports per-stage completion so the canvas can
// render the three-stage bug triage pipeline (assess -> fix -> test).
//
// This module is pure filesystem inspection — it never writes and never drives
// the agent. All mutation happens by invoking the generated `speckit-bug-*`
// skills from extension.mjs.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// The three triage stages, in pipeline order. Each stage owns exactly one
// artifact file (see the bug extension README) and one generated skill.
export const STAGES = [
    { key: "assess", file: "assessment.md", command: "speckit-bug-assess", label: "Assess", blurb: "Triage the bug report" },
    { key: "fix", file: "fix.md", command: "speckit-bug-fix", label: "Fix", blurb: "Apply the remediation" },
    { key: "test", file: "test.md", command: "speckit-bug-test", label: "Test", blurb: "Validate the fix" },
];

// Which upstream stages must be current before a stage can be considered done.
const REQUIRED = {
    assess: [],
    fix: ["assess"],
    test: ["assess", "fix"],
};

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

// Extract the recorded assessment verdict, treating contents strictly as data.
function parseVerdict(text) {
    const m = text.match(/verdict\s*[:*]*\s*\**\s*(valid|likely valid[^\n|]*|invalid)\b/i);
    if (!m) return "unknown";
    const value = m[1].toLowerCase();
    if (value.startsWith("likely valid")) return "likely-valid";
    return value;
}

// Extract the recorded assessment severity.
function parseSeverity(text) {
    const m = text.match(/severity\s*[:*]*\s*\**\s*(critical|high|medium|low)\b/i);
    return m ? m[1].toLowerCase() : null;
}

// Extract the recorded fix status.
function parseStatus(text) {
    const m = text.match(/status\s*[:*]*\s*\**\s*(applied|partial|not-applied)\b/i);
    return m ? m[1].toLowerCase() : null;
}

// Extract the recorded verification result.
function parseResult(text) {
    const m = text.match(/result\s*[:*]*\s*\**\s*(verified|partial|failed)\b/i);
    return m ? m[1].toLowerCase() : null;
}

function firstHeadingTitle(text, fallback) {
    const m = text.match(/^#\s+(.+?)\s*$/m);
    if (!m) return fallback;
    return m[1].replace(/^[A-Za-z ]+:\s*/, "").trim() || fallback;
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

// The bug extension registers its three commands as skills in Copilot skills
// mode. Confirm every stage skill is registered and present on disk.
function isBugReady(projectRoot, realProjectRoot, initialized) {
    if (!initialized || !hasRealDirectoryChain(projectRoot, ".specify", "extensions", "bug")) return false;
    const registry = readJsonIfFile(join(projectRoot, ".specify", "extensions", ".registry"), realProjectRoot);
    const registration = registry?.extensions?.bug;
    if (!registration?.enabled || !Array.isArray(registration.registered_skills)) return false;
    const registered = new Set(registration.registered_skills);
    return STAGES.every((stage) => (
        registered.has(stage.command)
        && hasRealDirectoryChain(projectRoot, ".github", "skills", stage.command)
        && isVerifiedFile(join(projectRoot, ".github", "skills", stage.command, "SKILL.md"), realProjectRoot)
    ));
}

// Build the full dashboard state for a project root.
export function scanBugs(projectRoot) {
    const realProjectRoot = realDirectoryWithin(projectRoot);
    const bugsDir = join(projectRoot, ".specify", "bugs");
    const initialized = Boolean(realProjectRoot) && hasRealDirectoryChain(projectRoot, ".specify");
    const realBugsDir = initialized && hasRealDirectoryChain(projectRoot, ".specify", "bugs")
        ? realDirectoryWithin(bugsDir, realProjectRoot)
        : null;
    const bugInstalled = isBugReady(projectRoot, realProjectRoot, initialized);
    const result = {
        projectRoot,
        bugsDir,
        prerequisites: {
            initialized,
            bugInstalled,
            setupRequired: !initialized || !bugInstalled,
        },
        exists: Boolean(realBugsDir),
        stages: STAGES.map(({ key, label, blurb, command }) => ({ key, label, blurb, command })),
        bugs: [],
        funnel: Object.fromEntries(STAGES.map((s) => [s.key, 0])),
        results: { verified: 0, partial: 0, failed: 0 },
        scannedAt: new Date().toISOString(),
    };

    if (!result.exists) return result;

    let entries = [];
    try {
        entries = readdirSync(bugsDir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const slug = entry.name;
        if (!SLUG_RE.test(slug)) continue;
        const dir = join(bugsDir, slug);
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
                result.funnel[stage.key]++;
            }
        }

        let verdict = null;
        let severity = null;
        let fixStatus = null;
        let testResult = null;
        let title = slug;
        const assessText = readPrefixIfFile(join(dir, "assessment.md"), realBugsDir);
        if (assessText) {
            title = firstHeadingTitle(assessText, slug);
            verdict = parseVerdict(assessText);
            severity = parseSeverity(assessText);
        }
        if (stages.fix.exists) {
            const fixText = readPrefixIfFile(join(dir, "fix.md"), realBugsDir);
            if (fixText) fixStatus = parseStatus(fixText);
        }
        if (stages.test.done) {
            const testText = readPrefixIfFile(join(dir, "test.md"), realBugsDir);
            if (testText) {
                testResult = parseResult(testText);
                if (testResult && result.results[testResult] !== undefined) result.results[testResult]++;
            }
        }

        // An invalid assessment ends the pipeline — there is nothing to fix.
        const invalid = stages.assess.done && verdict === "invalid";
        const furthestDone = STAGES.reduce((latest, stage, index) => stages[stage.key].done ? index : latest, -1);
        const nextStage = invalid || furthestDone >= STAGES.length - 1
            ? null
            : STAGES[furthestDone + 1].key;

        const lastActivity = Object.values(stages)
            .map((s) => s.mtime)
            .filter((m) => typeof m === "number")
            .reduce((a, b) => Math.max(a, b), 0);

        result.bugs.push({
            slug,
            title,
            stages,
            completed,
            total: STAGES.length,
            nextStage,
            verdict,
            severity,
            fixStatus,
            result: testResult,
            invalid,
            lastActivity: lastActivity || null,
        });
    }

    result.bugs.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    return result;
}

// Safely read one artifact's markdown for preview. Rejects bad slugs/stages
// and verifies the resolved path stays inside the bugs directory.
export function readArtifact(projectRoot, slug, stageKey) {
    const cleanSlug = normalizeSlug(slug);
    if (!cleanSlug) return { ok: false, error: "invalid slug" };
    const stage = stageByKey(stageKey);
    if (!stage) return { ok: false, error: "invalid stage" };

    const specifyDir = resolve(join(projectRoot, ".specify"));
    const bugsDir = join(specifyDir, "bugs");
    const slugDir = join(bugsDir, cleanSlug);
    const filePath = join(slugDir, stage.file);
    let realBugsDir;
    try {
        const components = [
            [specifyDir, "directory"],
            [bugsDir, "directory"],
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
        const realProjectRoot = realDirectoryWithin(projectRoot);
        realBugsDir = realProjectRoot ? realDirectoryWithin(bugsDir, realProjectRoot) : null;
        if (!realBugsDir) return { ok: false, error: "path escape" };
        const realFilePath = realpathSync(filePath);
        if (!isContained(realBugsDir, realFilePath)) return { ok: false, error: "path escape" };
    } catch {
        return { ok: false, error: "not found" };
    }
    const artifact = readArtifactFile(filePath, realBugsDir);
    if (!artifact.ok) return artifact;
    return { ok: true, slug: cleanSlug, stage: stage.key, file: stage.file, content: artifact.content };
}

const CLARIFICATION_SECTIONS = new Set([
    "reproduction",
    "open questions",
    "gaps & open questions",
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
        state.prerequisites.bugInstalled ? "b" : "-",
    ];
    for (const bug of state.bugs) {
        parts.push(bug.slug);
        for (const stage of STAGES) {
            const s = bug.stages[stage.key];
            parts.push(s.mtime ? `${Math.round(s.mtime)}:${s.stale ? "s" : "d"}` : "-");
        }
        parts.push(bug.result || bug.verdict || "-");
    }
    return parts.join("|");
}
