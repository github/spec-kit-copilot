// resolve-path.mjs — build an augmented PATH that includes known install
// locations for `copilot` and `specify` on Windows/macOS/Linux, so the env
// probe can find them even when the user's shell PATH doesn't include the
// SDK / uv / pipx dirs.
//
// Split into pure `pickFallbackDirs(env, platform, listDir)` and impure
// `buildAugmentedPath(...)` so the directory-selection logic is unit-testable
// without touching disk.

import { promises as fsp } from "node:fs";
import path from "node:path";

// Pure. Given process.env, process.platform, and an async `listDir(dir)` that
// returns child entries (or [] when the dir doesn't exist), decide which
// extra directories to prepend to PATH. Returns a Promise<string[]>.
export async function pickFallbackDirs(env, platform, listDir) {
    const out = [];
    const push = (p) => { if (p && !out.includes(p)) out.push(p); };
    // Use platform-specific path.join so this module is testable on either
    // host: at runtime `platform === process.platform` and the joined paths
    // land in the right layout; in unit tests we can drive both platforms
    // regardless of what host Node is running on.
    const P = platform === "win32" ? path.win32 : path.posix;

    if (platform === "win32") {
        // github-copilot-sdk installs the `copilot` CLI at
        // %LOCALAPPDATA%\github-copilot-sdk\cli\<version>\copilot.exe.
        // Pick the newest version dir so the shim is always current.
        const local = env.LOCALAPPDATA;
        if (local) {
            const cliRoot = P.join(local, "github-copilot-sdk", "cli");
            const versions = await listDir(cliRoot);
            const newest = pickNewestVersion(versions);
            if (newest) push(P.join(cliRoot, newest));
        }
        // uv default install location for user-scoped tools (specify-cli).
        const userProfile = env.USERPROFILE;
        if (userProfile) {
            push(P.join(userProfile, ".local", "bin"));
            push(P.join(userProfile, ".cargo", "bin"));
        }
        // pipx / Python user site scripts.
        const appData = env.APPDATA;
        if (appData) {
            const pyRoot = P.join(appData, "Python");
            for (const entry of await listDir(pyRoot)) {
                if (/^Python\d/i.test(entry)) push(P.join(pyRoot, entry, "Scripts"));
            }
        }
        if (local) {
            const programsPy = P.join(local, "Programs", "Python");
            for (const entry of await listDir(programsPy)) {
                if (/^Python\d/i.test(entry)) push(P.join(programsPy, entry, "Scripts"));
            }
        }
    } else {
        const home = env.HOME;
        if (home) {
            push(P.join(home, ".local", "bin"));
            push(P.join(home, ".cargo", "bin"));
        }
        push("/usr/local/bin");
        push("/opt/homebrew/bin");
    }
    return out;
}

// From a list of version-looking directory names (e.g. `1.0.79-5`, `1.0.80`),
// pick the newest by rough semver-ish comparison. Falls back to lexicographic.
export function pickNewestVersion(entries) {
    const versions = (entries ?? []).filter((n) => /^\d/.test(n));
    if (!versions.length) return null;
    versions.sort((a, b) => cmpVersion(b, a));
    return versions[0];
}

function cmpVersion(a, b) {
    const pa = String(a).split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    const pb = String(b).split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const av = pa[i];
        const bv = pb[i];
        if (av === bv) continue;
        if (av === undefined) return -1;
        if (bv === undefined) return 1;
        if (typeof av === "number" && typeof bv === "number") return av - bv;
        return String(av).localeCompare(String(bv));
    }
    return 0;
}

// Impure. Read fallback dirs from disk once and return an augmented PATH
// string with the discovered dirs prepended to the caller's PATH.
export async function buildAugmentedPath(env = process.env, platform = process.platform) {
    const listDir = async (dir) => {
        try { return await fsp.readdir(dir); } catch { return []; }
    };
    const extras = await pickFallbackDirs(env, platform, listDir);
    const sep = platform === "win32" ? ";" : ":";
    const current = env.PATH ?? env.Path ?? "";
    if (!extras.length) return current;
    // Filter to dirs the caller doesn't already have on PATH so we don't
    // rewrite ordering for users whose PATH is already correct.
    const currentSet = new Set(
        current.split(sep).map((p) => p.trim().toLowerCase()).filter(Boolean),
    );
    const missing = extras.filter((p) => !currentSet.has(p.toLowerCase()));
    if (!missing.length) return current;
    return missing.join(sep) + sep + current;
}
