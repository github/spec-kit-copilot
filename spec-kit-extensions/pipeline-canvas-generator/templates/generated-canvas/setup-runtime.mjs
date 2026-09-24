// speckit-generated-setup-runtime v1
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const INIT_OPTIONS_CAP = 64 * 1024;
const EVIDENCE_CAP = 1024 * 1024;
const LIST_CACHE_MS = 30_000;
const listCaches = new WeakMap();
const foundationCaches = new WeakMap();
const execFileAsync = promisify(execFile);
const PORTABLE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const SKILL_NAME_RE = /^speckit-[a-z0-9][a-z0-9-]*$/;

function inside(root, child) {
    const rel = relative(root, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function hash(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function safeEntry(cwd, relativePath, kind) {
    if (!relativePath || isAbsolute(relativePath)) return null;
    const full = resolve(cwd, relativePath);
    if (!inside(cwd, full)) return null;
    try {
        const entry = await lstat(full);
        if (entry.isSymbolicLink()) return null;
        if (kind === "file" && !entry.isFile()) return null;
        if (kind === "directory" && !entry.isDirectory()) return null;
        const [realWorkspace, realTarget] = await Promise.all([realpath(cwd), realpath(full)]);
        if (!inside(realWorkspace, realTarget)) return null;
        return { full: realTarget, stamp: `${entry.size}:${Math.trunc(entry.mtimeMs)}` };
    } catch {
        return null;
    }
}

function hasCopilotSkillsMode(options) {
    if (!options || typeof options !== "object") return false;
    const integration = String(options.integration ?? options.ai ?? "").toLowerCase();
    if (integration !== "copilot") return false;
    if (options.ai_skills === true || options.skills === true) return true;
    const integrationOptions = options.integrationOptions
        ?? options.integration_options
        ?? options["integration-options"];
    if (typeof integrationOptions === "string") {
        return /(?:^|\s)--skills(?:\s|$)/.test(integrationOptions);
    }
    if (Array.isArray(integrationOptions)) {
        return integrationOptions.includes("--skills") || integrationOptions.includes("skills");
    }
    return integrationOptions?.skills === true;
}

function check(id, ready, message, stamp = null) {
    return { id, ready, message, stamp };
}

async function evidenceIsMissing(cwd, path) {
    const full = resolve(cwd, path);
    if (!inside(cwd, full)) return false;
    let current = resolve(cwd);
    const segments = relative(current, full).split(/[\\/]/);
    for (const [index, segment] of segments.entries()) {
        current = resolve(current, segment);
        try {
            const entry = await lstat(current);
            if (entry.isSymbolicLink() || (index < segments.length - 1 && !entry.isDirectory())) return false;
        } catch (error) {
            return error.code === "ENOENT";
        }
    }
    return false;
}

async function readEvidence(cwd, path, cap = EVIDENCE_CAP) {
    const entry = await safeEntry(cwd, path, "file");
    if (!entry) return { error: `${path} is missing, unreadable, or unsafe.`, stamp: null, missing: await evidenceIsMissing(cwd, path) };
    try {
        if ((await lstat(entry.full)).size > cap) throw new Error("file exceeds evidence size limit");
        const bytes = await readFile(entry.full);
        if (bytes.length > cap) throw new Error("file exceeds evidence size limit");
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { content, stamp: hash(content) };
    } catch (error) {
        return { error: `${path}: ${error.message}`, stamp: entry.stamp };
    }
}

async function runLocalSpecify(args, cwd) {
    const { stdout } = await execFileAsync("specify", args, {
        cwd,
        // Only fixed, internal command arguments reach the Windows shim.
        shell: process.platform === "win32",
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: EVIDENCE_CAP,
        env: { ...process.env, NO_COLOR: "1", COLUMNS: "240", PYTHONIOENCODING: "utf-8" },
    });
    return stdout;
}

async function runLocalCopilot(args, cwd) {
    const { stdout } = await execFileAsync("copilot", args, {
        cwd,
        shell: process.platform === "win32",
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: EVIDENCE_CAP,
        env: { ...process.env, NO_COLOR: "1", COLUMNS: "240" },
    });
    return stdout;
}

function versionAtLeast(value, minimum) {
    const match = typeof value === "string"
        ? value.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
    if (!match) return false;
    const numbers = match.slice(1).map(Number);
    if (!numbers.every(Number.isSafeInteger)) return false;
    for (let index = 0; index < minimum.length; index++) {
        if (numbers[index] > minimum[index]) return true;
        if (numbers[index] < minimum[index]) return false;
    }
    return true;
}

async function foundationProbe(run, key, args, cwd, now, refresh) {
    let cache = foundationCaches.get(run);
    if (!cache) foundationCaches.set(run, cache = new Map());
    const scope = `${resolve(cwd)}:${key}`;
    let entry = cache.get(scope);
    if (refresh || !entry || entry.expires <= now()) {
        const promise = run(args, cwd).then((output) => ({ output }),
            (error) => ({ error: error instanceof Error ? error.message : String(error) }));
        entry = { expires: now() + LIST_CACHE_MS, promise };
        cache.set(scope, entry);
        if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    const result = await entry.promise;
    if (result.error) entry.expires = Math.min(entry.expires, now() + 2_000);
    return result;
}

async function foundationChecks(cwd, runSpecify, runCopilot, now, refresh, reloadAvailable) {
    const [specify, copilot] = await Promise.all([
        foundationProbe(runSpecify, "version", ["--version"], cwd, now, refresh),
        foundationProbe(runCopilot, "plugins", ["plugin", "list", "--json"], cwd, now, refresh),
    ]);
    const version = specify.output?.trim().match(/^specify\s+(\S+)$/)?.[1] ?? null;
    const specifyReady = !specify.error && versionAtLeast(version, [1, 0, 7]);
    let plugin, pluginError = copilot.error;
    if (!pluginError) {
        try {
            const rows = JSON.parse(copilot.output);
            if (!Array.isArray(rows)) throw new Error("expected a JSON plugin list");
            const matches = rows.filter((entry) => entry?.name === "spec-kit-copilot");
            if (!matches.length) throw new Error("spec-kit-copilot is not installed");
            if (matches.some((entry) => typeof entry.enabled !== "boolean"
                || typeof entry.version !== "string")) {
                throw new Error("plugin version or enabled state is unavailable");
            }
            const enabled = matches.filter((entry) => entry.enabled);
            if (new Set(enabled.map((entry) => entry.version)).size > 1) {
                throw new Error("multiple enabled spec-kit-copilot versions are ambiguous");
            }
            plugin = enabled[0] ?? matches[0];
        } catch (error) { pluginError = error.message; }
    }
    const pluginReady = !pluginError && plugin.enabled
        && versionAtLeast(plugin.version, [0, 15, 0]);
    return [
        check("specify-cli", specifyReady,
            specifyReady ? `Specify ${version} is compatible.`
                : `Specify >=1.0.7 is required: ${specify.error ?? version ?? "version unavailable"}.`,
            hash(specify)),
        check("copilot-plugin", pluginReady,
            pluginReady ? `spec-kit-copilot ${plugin.version} is enabled and compatible.`
                : `Enabled spec-kit-copilot >=0.15.0 is required: ${pluginError ?? `observed ${plugin.version}, enabled=${plugin.enabled}`}.`,
            hash(copilot)),
        check("skills-reload", reloadAvailable === true,
            reloadAvailable === true ? "Current host supports session skill reload."
                : "Current host cannot reload skills in this session."),
    ];
}

// The JSON inventory preserves Specify's CLI order and source metadata.
function parseInstalledList(kind, stdout) {
    let records;
    try { records = JSON.parse(stdout); }
    catch (error) { throw new Error(`invalid ${kind} JSON inventory: ${error.message}`); }
    if (!Array.isArray(records)) throw new Error(`invalid ${kind} JSON inventory`);
    const identities = new Set();
    for (const record of records) {
        if (!PORTABLE_ID_RE.test(record?.id ?? "") || identities.has(record.id)
            || typeof record.version !== "string" || !record.version
            || typeof record.enabled !== "boolean" || !Number.isSafeInteger(record.priority)
            || !record.source || typeof record.source !== "object" || Array.isArray(record.source)
            || typeof record.source.kind !== "string" || !record.source.kind) {
            throw new Error(`invalid or duplicate ${kind} in JSON inventory`);
        }
        identities.add(record.id);
    }
    return records;
}

async function contributionEvidence(cwd, kind, contributions) {
    // Specify's PresetRegistry/ExtensionRegistry use this schema. It is a
    // membership/corruption check and cache input, never an ordering authority.
    const path = `.specify/${kind}s/.registry`;
    const registry = await readEvidence(cwd, path);
    const errors = [];
    let installed = {};
    if (registry.error) errors.push(registry.error);
    else {
        try {
            const data = JSON.parse(registry.content);
            installed = data?.[`${kind}s`];
            if (data?.schema_version !== "1.0" || !installed || typeof installed !== "object" || Array.isArray(installed)
                || Object.values(installed).some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
                throw new Error("unsupported registry schema");
            }
            for (const { id } of contributions) {
                const entry = installed[id];
                if (entry && ((entry.enabled !== undefined && typeof entry.enabled !== "boolean")
                    || (entry.priority !== undefined && !Number.isSafeInteger(entry.priority)))) {
                    throw new Error(`${id} has an invalid registry enabled state or priority`);
                }
            }
        } catch (error) {
            errors.push(`${path}: ${error.message}`);
            installed = {};
        }
    }
    const manifests = await Promise.all(contributions.map(async ({ id, manifestSha256 }) => {
        if (!PORTABLE_ID_RE.test(id ?? "")) return { id, error: "invalid contribution id", stamp: null };
        const manifest = await readEvidence(cwd, `.specify/${kind}s/${id}/${kind}.yml`);
        const error = !Object.hasOwn(installed, id) ? `${id} is not registered as installed.`
            : manifest.error ?? (!manifest.content?.trim() ? `${id} has an empty manifest.`
                : manifestSha256 && createHash("sha256").update(manifest.content).digest("hex") !== manifestSha256
                    ? `${id} manifest differs from captured provenance.` : null);
        const missing = manifest.missing && !Object.hasOwn(installed, id) && (registry.missing || errors.length === 0);
        return { id, error, stamp: manifest.stamp, installationState: missing ? "missing" : "unverified" };
    }));
    return { errors, manifests, stamp: hash({ registry: registry.stamp, errors, manifests }) };
}

async function inspectContributions({ cwd, kind, contributions, runSpecify, now, refresh }) {
    if (!contributions.length) return [];
    const evidence = await contributionEvidence(cwd, kind, contributions);
    let records = [];
    let error = evidence.errors.join(" ");
    let cliStamp = null;
    if (!error && evidence.manifests.some((entry) => !entry.error)) {
        let cache = listCaches.get(runSpecify);
        if (!cache) listCaches.set(runSpecify, cache = new Map());
        const key = `${resolve(cwd)}:${kind}`;
        let cached = cache.get(key);
        if (refresh || !cached || cached.stamp !== evidence.stamp || cached.expires <= now()) {
            const promise = (async () => {
                try {
                    const output = await runSpecify([kind, "list", "--json"], cwd);
                    return { records: parseInstalledList(kind, output), stamp: hash(output) };
                } catch (failure) {
                    return { error: `Cannot verify specify ${kind} list: ${failure.message}`, stamp: hash(String(failure)) };
                }
            })();
            cached = { stamp: evidence.stamp, expires: now() + LIST_CACHE_MS, promise };
            cache.set(key, cached);
            if (cache.size > 64) cache.delete(cache.keys().next().value);
        }
        const result = await cached.promise;
        records = result.records ?? [];
        error = result.error ?? "";
        cliStamp = result.stamp;
        if (error) cached.expires = Math.min(cached.expires, now() + 2_000);
        // Do not certify a list sampled across a concurrent registry/manifest edit.
        const after = await contributionEvidence(cwd, kind, contributions);
        if (after.stamp !== evidence.stamp) {
            error = "Contribution evidence changed while verifying; retry setup verification.";
            cache.delete(key);
        }
    }
    const checks = contributions.map((expected, index) => {
        const actual = records.find((record) => record.id === expected.id);
        const identityFailures = [error, evidence.manifests[index].error].filter(Boolean);
        if (!identityFailures.length) {
            if (!actual) identityFailures.push("not reported as installed by the CLI");
            else {
                if (actual.version !== expected.version) {
                    identityFailures.push(`version must be ${expected.version}, observed ${actual.version}`);
                }
                if (expected.installedSource && (
                    Object.keys(expected.installedSource).sort().join() !== Object.keys(actual.source).sort().join()
                    || Object.entries(expected.installedSource).some(([key, value]) => actual.source[key] !== value)
                )) identityFailures.push("installed source differs from captured provenance");
            }
        }
        const failures = [...identityFailures];
        if (!failures.length) {
            if (!actual) failures.push("not reported as installed by the CLI");
            else {
                if (typeof actual.enabled !== "boolean") failures.push("CLI enabled state is unknown");
                if (!Number.isSafeInteger(actual.priority)) failures.push("CLI priority is unknown");
                if (expected.enabled !== undefined && typeof expected.enabled !== "boolean") failures.push("captured enabled state is invalid");
                if (typeof expected.enabled === "boolean" && actual.enabled !== expected.enabled) {
                    failures.push(`enabled state must be ${expected.enabled}, observed ${actual.enabled}`);
                }
                if (expected.priority !== undefined && (!Number.isSafeInteger(expected.priority) || actual.priority !== expected.priority)) {
                    failures.push(`priority must be ${expected.priority}, observed ${actual.priority}`);
                }
            }
        }
        const installed = !error && !evidence.manifests[index].error && Boolean(actual);
        const installationState = installed ? "installed"
            : evidence.manifests[index].installationState ?? "unverified";
        return { ...check(`${kind}:${expected.id}`, !failures.length,
            failures.length ? `${kind} ${expected.id}: ${failures.join("; ")}.`
                : `${kind} ${expected.id} is installed with the required identity, enabled state and priority (CLI verified).`,
            hash({ disk: evidence.stamp, cli: cliStamp, actual, failures })),
        installed, installationState, identityReady: !identityFailures.length };
    });
    const ordered = contributions.filter((entry) => entry.precedence !== undefined);
    if (ordered.length) {
        const positions = ordered.map((entry) => entry.precedence);
        const valid = positions.every((value) => Number.isSafeInteger(value) && value >= 0)
            && new Set(positions).size === positions.length;
        const expected = [...ordered].sort((left, right) => left.precedence - right.precedence).map((entry) => entry.id);
        const actual = records.filter((entry) => expected.includes(entry.id)).map((entry) => entry.id);
        const ready = !error && valid && JSON.stringify(actual) === JSON.stringify(expected);
        checks.push(check(`${kind}:precedence`, ready,
            ready ? `Required ${kind} relative precedence matches CLI list order; unrelated installations are retained.`
                : `Required ${kind} relative precedence is unverified or mismatched: expected ${expected.join(", ")}, observed ${actual.join(", ") || "unknown"}.`,
            hash({ disk: evidence.stamp, cli: cliStamp, expected, actual, error })));
    }
    return checks;
}

export function setupContractFingerprint(setup) {
    return hash(setup ?? {});
}

// Setup boundaries and unresolved-setup polls read bounded local evidence. List results expire
// after 30s (or immediately on registry/required-manifest content changes).
// refresh bypasses that cache after setup; this is disk/list evidence, not proof
// that the current Copilot session has reloaded its skills.
export async function inspectSetup({
    cwd, setup, runSpecify = runLocalSpecify, runCopilot = runLocalCopilot,
    now = Date.now, refresh = false, reloadAvailable = false,
}) {
    const checks = await foundationChecks(cwd, runSpecify, runCopilot, now, refresh, reloadAvailable);
    const init = await readEvidence(cwd, ".specify/init-options.json", INIT_OPTIONS_CAP);
    let initReady = false;
    let initError = init.error;
    if (!init.error) {
        try {
            initReady = hasCopilotSkillsMode(JSON.parse(init.content));
        } catch (error) { initError = `Invalid .specify/init-options.json JSON: ${error.message}`; }
    }
    checks.push(check(
        "spec-kit-init",
        initReady,
        initReady ? "Spec Kit is initialized in Copilot skills mode."
            : (initError ?? "Spec Kit must be initialized in Copilot skills mode."),
        init?.stamp ?? null,
    ));

    const contributionChecks = await Promise.all(["preset", "extension"].map((kind) =>
        inspectContributions({ cwd, kind, contributions: setup?.[`${kind}s`] ?? [], runSpecify, now, refresh })));
    checks.push(...contributionChecks.flat());
    for (const skill of setup?.requiredSkills ?? []) {
        const valid = SKILL_NAME_RE.test(skill?.name ?? "");
        const entry = valid
            ? await readEvidence(cwd, `.github/skills/${skill.name}/SKILL.md`)
            : null;
        const fingerprintValid = skill.sha256 === undefined
            || (typeof skill.sha256 === "string" && /^[0-9a-f]{64}$/.test(skill.sha256));
        const matchesFingerprint = fingerprintValid && (skill.sha256 === undefined
            || (entry && !entry.error
                && createHash("sha256").update(entry.content).digest("hex") === skill.sha256));
        const ready = Boolean(entry && !entry.error && entry.content.trim() && matchesFingerprint);
        checks.push(check(
            `skill:${skill?.name ?? "invalid"}`,
            ready,
            ready ? `Skill ${skill.name} is scaffolded${skill.sha256 ? " with the captured fingerprint" : ""}.`
                : `Skill ${skill?.name ?? "(invalid)"} is missing, empty, unreadable, or differs from its captured fingerprint.`,
            entry?.stamp ?? null,
        ));
    }
    const diskReady = checks.every((entry) => entry.ready);
    const diskFingerprint = hash({
        contract: setup,
        evidence: checks.map(({ id, ready, stamp }) => ({ id, ready, stamp })),
    });
    const contributions = ["preset", "extension"].flatMap((kind) =>
        (setup?.[`${kind}s`] ?? []).map((entry) => {
            const observed = checks.find((candidate) => candidate.id === `${kind}:${entry.id}`);
            return { kind, id: entry.id, installed: observed?.installed === true,
                installationState: observed?.installationState ?? "unverified",
                identityReady: observed?.identityReady === true,
                ready: observed?.ready === true, message: observed?.message };
        }));
    return {
        diskReady, diskFingerprint, checks, contributions,
        contributionsInstalled: contributions.every((entry) => entry.installed),
    };
}

function contributionInstructions(kind, contributions) {
    if (!contributions?.length) return [`- No ${kind}s are required.`];
    return contributions.map((entry, index) => {
        const origin = entry.installedSource ?? entry.source;
        const source = origin?.url ? ` Source: ${origin.url}` : ` Source kind: ${origin?.kind ?? "unavailable"} (no portable URL).`;
        const fingerprint = entry.manifestSha256 ? ` Manifest SHA-256: ${entry.manifestSha256}.` : "";
        const priority = Number.isInteger(entry.priority)
            ? ` Set its resolution priority to ${entry.priority}.`
            : "";
        const enabled = entry.enabled === true
            ? " Ensure it is enabled."
            : (entry.enabled === false ? " Preserve it as disabled." : " Preserve its observed enabled state.");
        return `- ${index + 1}. ${entry.id} v${entry.version}.${source}${fingerprint}${priority}${enabled}`;
    });
}

export function buildSetupPrompt({
    setup, instanceId, guidance = "", installationApproved = false,
    initializationApproved = false,
}) {
    const requiredNames = (setup?.requiredSkills ?? []).map((entry) => entry.name);
    const mode = setup?.installationMode ?? (setup?.requireInstallationApproval === true ? "prompt" : "external");
    if (!["external", "prompt", "automatic"].includes(mode)) throw new Error("Unsupported installation mode");
    const mayInstall = mode === "automatic" || (mode === "prompt" && installationApproved);
    return [
        "Set up the destination project for this generated Spec Kit workflow.",
        "This instruction comes from the generated canvas, not from the Spec Kit Wizard.",
        "",
        "Use only the setup contract below. Do not add unrelated presets, extensions, or skills.",
        "Preserve unrelated installed contributions: do not remove, disable, reprioritize, or reinstall them to make this contract match.",
        mode === "prompt"
            ? (installationApproved
                ? "The user approved this complete installation contract through the generated canvas installation review. This is consent to setup, not evidence of installation or package safety. Do not grant or infer consent through an agent action, retry guidance, or a caller-provided flag. Honor every tool and host permission request and report a denial."
                : "All required contributions were verified as already installed in this project. No installation consent was requested or granted. Do not install, reinstall, remove, or upgrade any preset or extension. Recheck their current installation state before setup; if a required contribution is now missing, report it and stop so the canvas can request installation approval. Only reconcile recorded configuration and existing skill availability. Honor every tool and host permission request.")
            : (mode === "automatic"
                ? "The canvas administrator selected automatic installation for this captured dependency set. This does not bypass host permissions or allow substitutes: honor every permission request and stop on denial, unavailable credentials, version mismatch, or source drift."
                : "No runtime package installation was authorized by this setup contract. Do not install or reinstall any missing preset or extension; report missing components and stop. Honor any tool or host permission request and report a denial."),
        JSON.stringify(setup, null, 2),
        "",
        "Required workflow:",
        "1. Read the destination workspace before changing it.",
        "Retain matching installed components without reinstalling them. Reconcile only missing or mismatched configured components.",
        "2. If Specify or the Copilot plugin is missing or incompatible, stop and report the failed foundation check. Never install the CLI or plugin from this canvas.",
        initializationApproved
            ? "3. The destination user already reviewed and explicitly approved initialization with `--force` in the protected canvas confirmation. If `.specify/init-options.json` still does not describe Copilot skills mode, invoke `/skill:speckit-init` with `--here --force --integration copilot --integration-options=\"--skills\" --script py --ignore-agent-tools`. Do not infer approval for any other workspace or change. Reload current-session skills and reprobe readiness."
            : "3. If `.specify/init-options.json` is missing or does not describe Copilot skills mode, warn that initialization with `--force` can replace existing files and require explicit destination-user confirmation before invoking `/skill:speckit-init` with `--here --force --integration copilot --integration-options=\"--skills\" --script py --ignore-agent-tools`. If confirmation is denied, stop without initializing. Reload the current session's skills after initialization, then reprobe readiness.",
        `4. Reconcile every required preset with \`/skill:speckit-preset\` in the listed precedence order (highest precedence first). ${mayInstall ? "Install a missing preset only from its captured HTTPS source (no credentials in the URL) and verify its exact version, installed source and manifest SHA-256 before continuing. Do not install a missing local-only or unavailable source by id; stop and report that a matching package must be supplied externally. Apply the exact numeric `priority` from the contract with `--priority` during install or `set-priority` afterward." : "Do not install or reinstall a preset. If one is missing, stop and report it. For installed presets, use `set-priority` only when the recorded numeric priority differs."} Enable or disable only when the contract explicitly says so. Do not infer precedence from installation order or registry key order.`,
        ...contributionInstructions("preset", setup?.presets),
        `5. Reconcile every required extension with \`/skill:speckit-extension\` in the listed precedence order (highest precedence first). ${mayInstall ? "Install a missing extension only from its captured HTTPS source (no credentials in the URL) and verify its exact version, installed source and manifest SHA-256 before continuing. Do not install a missing local-only or unavailable source by id; stop and report that a matching package must be supplied externally. Apply the exact numeric `priority` from the contract with `--priority` during install or `set-priority` afterward." : "Do not install or reinstall an extension. If one is missing, stop and report it. For installed extensions, use `set-priority` only when the recorded numeric priority differs."} Enable or disable it to match an explicitly captured enabled state.`,
        ...contributionInstructions("extension", setup?.extensions),
        "Run `specify preset list` and `specify extension list` for the required contribution kinds. Verify installation, exact captured enabled state and numeric priority, and the relative order of entries with captured `precedence` (lower precedence index first), ignoring unrelated entries. The CLI's list order is the authority, not a locally guessed priority or tie-break sort. Do not silently change captured priorities to force an order. If exact priority and relative order cannot both be reproduced, report the mismatch and stop; never edit registries directly.",
        "Directory presence alone is not verification. Missing, unreadable, unsupported, or ambiguous registry/CLI evidence must be reported as a blocking error. Canvas list evidence is cached for at most 30 seconds and invalidated by registry/required-manifest content changes; it does not establish loaded-session skill readiness.",
        `6. Verify these dynamically selected skill files exist under \`.github/skills/<name>/SKILL.md\`: ${requiredNames.join(", ") || "none"}. When a source SHA-256 is captured in the setup contract, the installed skill's exact bytes must match; do not accept a changed skill merely because its filename exists.`,
        `7. Invoke the generated canvas action \`reloadSessionSkills\` on instance \`${instanceId}\` with \`invoke_canvas_action\`. Do not emit \`/skills reload\` as plain text.`,
        "8. Treat the current session's reloadSessionSkills result as the loaded-registry authority. An external CLI process cannot verify this session's loaded skills.",
        "9. Report explicit errors for failed initialization, contribution reconciliation, missing skill files, or reload diagnostics.",
        guidance ? `Additional retry guidance: ${guidance}` : "",
    ].filter(Boolean).join("\n");
}
