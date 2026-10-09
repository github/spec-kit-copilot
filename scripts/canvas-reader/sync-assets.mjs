import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const READER_PACKAGE = "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/markdown-reader";
export const READER_DESTINATIONS = Object.freeze([
    "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/ui/vendor/markdown-reader",
    "plugins/spec-kit-copilot-sdd/extensions/sdd-canvas/vendor/markdown-reader",
]);
export const ASSET_FILES = Object.freeze([
    "markdown-reader.js",
    "markdown-reader.css",
    "THIRD_PARTY_NOTICES.txt",
    "manifest.json",
]);

const require = createRequire(new URL(`../../${READER_PACKAGE}/package.json`, import.meta.url));
const BUILD_FILES = ["markdown-reader.js", "markdown-reader.css", "build-metadata.json"];
const SOURCE_CONFIGS = ["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "vite.parser.config.ts", "eslint.config.mjs"];
const MAX_BUILD_FILE_BYTES = 10 * 1024 * 1024;

function sha256(content) {
    return createHash("sha256").update(content).digest("hex");
}

function isInside(root, target) {
    const path = relative(root, target);
    return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

async function assertOrdinaryPath(root, target, allowMissing = false) {
    if (!isInside(root, target)) throw new Error("Asset path is outside its owning root.");
    let current = root;
    for (const component of ["", ...relative(root, target).split(sep).filter(Boolean)]) {
        current = join(current, component);
        let stat;
        try { stat = await lstat(current); }
        catch (error) {
            if (allowMissing && error.code === "ENOENT") return;
            throw new Error("Required asset path is missing or unreadable.");
        }
        if (stat.isSymbolicLink()) throw new Error("Asset path redirects through a link or junction.");
        if (!stat.isDirectory() && !stat.isFile()) throw new Error("Asset path is not an ordinary file or directory.");
    }
}

async function readBounded(root, target) {
    await assertOrdinaryPath(root, target);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.size > MAX_BUILD_FILE_BYTES) throw new Error("Build asset is not a bounded ordinary file.");
    const bytes = await readFile(target);
    if (bytes.length > MAX_BUILD_FILE_BYTES) throw new Error("Build asset exceeds the byte limit.");
    return bytes;
}

async function sourceInputs(reader, directory = "src") {
    await assertOrdinaryPath(reader, join(reader, directory));
    const files = [];
    for (const entry of await readdir(join(reader, directory), { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error("Reader source contains a redirecting path.");
        if (entry.isDirectory()) files.push(...await sourceInputs(reader, path));
        else if (entry.isFile()) files.push(path);
        else throw new Error("Reader source contains a non-regular file.");
    }
    return files;
}

export async function sourceFingerprint(repositoryRoot = REPOSITORY_ROOT) {
    const reader = join(repositoryRoot, READER_PACKAGE);
    const paths = [...SOURCE_CONFIGS, ...await sourceInputs(reader)].sort();
    const fingerprints = [];
    for (const path of paths) {
        const text = (await readBounded(repositoryRoot, join(reader, path))).toString("utf8").replace(/\r\n?/g, "\n");
        fingerprints.push(`${path}\0${sha256(text)}`);
    }
    return `sha256:${sha256(fingerprints.join("\n"))}`;
}

async function collectDependencies(moduleIds) {
    const nodeModules = join(REPOSITORY_ROOT, READER_PACKAGE, "node_modules");
    const packages = new Map();
    for (const moduleId of moduleIds) {
        const cleanId = moduleId.replace(/^\0/, "").split("?")[0];
        if (!isAbsolute(cleanId) || !isInside(nodeModules, cleanId)) continue;
        let directory = dirname(cleanId);
        while (isInside(nodeModules, directory) && directory !== nodeModules) {
            const packagePath = join(directory, "package.json");
            let metadata;
            try { metadata = JSON.parse((await readFile(packagePath)).toString("utf8")); }
            catch (error) {
                if (error.code !== "ENOENT") throw new Error("Bundled dependency metadata cannot be read.");
                directory = dirname(directory);
                continue;
            }
            if (!metadata.name || !metadata.version) { directory = dirname(directory); continue; }
            const key = `${metadata.name}@${metadata.version}`;
            if (!packages.has(key)) {
                const candidates = (await readdir(directory)).filter((name) => /^(licen[sc]e|copying)([.-].*)?$/i.test(name)).sort();
                if (candidates.length === 0) throw new Error(`Bundled dependency lacks a license notice: ${key}`);
                const notices = [];
                for (const name of candidates) notices.push((await readBounded(nodeModules, join(directory, name))).toString("utf8"));
                packages.set(key, { name: metadata.name, version: metadata.version, license: metadata.license, notice: notices.join("\n\n") });
            }
            break;
        }
    }
    return [...packages.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en"));
}

export async function createBuildMetadata(moduleIds) {
    const manifest = require("./package.json");
    const npmVersion = /npm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent || "")?.[1];
    if (!npmVersion) throw new Error("Build through the reader npm script to record the actual package manager.");
    return {
        schemaVersion: 1,
        sourceHash: await sourceFingerprint(),
        dependencies: await collectDependencies(moduleIds),
        builtWith: {
            node: process.versions.node,
            packageManager: npmVersion,
            typescript: require("typescript/package.json").version,
            bundler: `vite ${manifest.devDependencies.vite}`,
        },
    };
}

function rejectPrivatePaths(text) {
    if (/(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\/Users\/|\/home\/|\\\\[^\\\s]+\\/u.test(text)) throw new Error("Generated output contains an absolute path.");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/u.test(text)) throw new Error("Generated output contains credential-like material.");
}

export function inspectScriptStrings(text) {
    const typescript = require("typescript");
    const source = typescript.createSourceFile("markdown-reader.js", text, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
    if (source.parseDiagnostics.length > 0) throw new Error("Generated JavaScript cannot be parsed.");
    const pending = [source];
    while (pending.length > 0) {
        const node = pending.pop();
        if (typescript.isStringLiteralLike(node) || typescript.isTemplateHead(node) || typescript.isTemplateMiddle(node) || typescript.isTemplateTail(node)) {
            rejectPrivatePaths(node.text);
        }
        typescript.forEachChild(node, (child) => { pending.push(child); });
    }
}

async function validatedPayload(repositoryRoot) {
    const reader = join(repositoryRoot, READER_PACKAGE);
    const dist = join(reader, "dist");
    await assertOrdinaryPath(repositoryRoot, dist);
    const names = (await readdir(dist)).sort();
    if (JSON.stringify(names) !== JSON.stringify([...BUILD_FILES].sort())) throw new Error("Unexpected or missing build file violates the allowlist.");
    const javascript = await readBounded(repositoryRoot, join(dist, "markdown-reader.js"));
    const css = await readBounded(repositoryRoot, join(dist, "markdown-reader.css"));
    const metadata = JSON.parse((await readBounded(repositoryRoot, join(dist, "build-metadata.json"))).toString("utf8"));
    if (metadata.schemaVersion !== 1 || metadata.sourceHash !== await sourceFingerprint(repositoryRoot)) throw new Error("Source changed since the build; stale build rejected.");
    const scriptText = javascript.toString("utf8");
    const cssText = css.toString("utf8");
    inspectScriptStrings(scriptText);
    rejectPrivatePaths(cssText);
    if (/sourceMappingURL/i.test(scriptText + cssText)) throw new Error("Source maps are not allowed in packaged assets.");
    if (/@import\b|url\s*\(/i.test(cssText)) throw new Error("CSS assets must not import or fetch remote or local resources.");
    const { init, parse } = require("es-module-lexer");
    await init;
    const [imports, exports] = parse(scriptText);
    if (imports.length > 0) throw new Error("Browser bundle contains unresolved imports or dynamic dependencies.");
    if (!exports.some((entry) => entry.n === "mountMarkdownReader")) throw new Error("Browser bundle is missing the mount export.");
    if (!Array.isArray(metadata.dependencies) || metadata.dependencies.length === 0) throw new Error("Bundled dependency license notices are missing.");
    const notices = ["Third-party licenses for the bundled Markdown reader."];
    for (const dependency of metadata.dependencies) {
        if (typeof dependency.name !== "string" || typeof dependency.version !== "string" || typeof dependency.license !== "string" || typeof dependency.notice !== "string" || !dependency.notice.trim()) {
            throw new Error("Bundled dependency has incomplete license notices.");
        }
        if (/@github\/copilot-sdk|msal|azure|handoff/i.test(dependency.name)) throw new Error("Forbidden runtime dependency in reader bundle.");
        notices.push(`${dependency.name}@${dependency.version} (${dependency.license})\n${dependency.notice.trimEnd()}`);
    }
    const noticeBytes = Buffer.from(`${notices.join("\n\n")}\n`);
    const payload = new Map([["markdown-reader.js", javascript], ["markdown-reader.css", css], ["THIRD_PARTY_NOTICES.txt", noticeBytes]]);
    const files = [...payload].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }));
    const manifest = {
        schemaVersion: 1,
        sourceHash: metadata.sourceHash,
        buildHash: `sha256:${sha256(files.map((file) => `${file.path}\0${file.sha256}`).join("\n"))}`,
        files,
        dependencies: metadata.dependencies.map(({ name, version, license }) => ({ name, version, license, noticeSource: "THIRD_PARTY_NOTICES.txt" })),
        builtWith: metadata.builtWith,
    };
    const serializedManifest = JSON.stringify(manifest, null, 2);
    rejectPrivatePaths(serializedManifest);
    payload.set("manifest.json", Buffer.from(`${serializedManifest}\n`));
    return { payload, manifest };
}

async function validateDestination(repositoryRoot, destination, mustExist) {
    await assertOrdinaryPath(repositoryRoot, destination, !mustExist);
    let entries;
    try { entries = await readdir(destination, { withFileTypes: true }); }
    catch (error) { if (!mustExist && error.code === "ENOENT") return; throw new Error("Packaged assets are missing."); }
    for (const entry of entries) {
        if (!ASSET_FILES.includes(entry.name) || !entry.isFile() || entry.isSymbolicLink()) throw new Error("Unexpected destination file violates the allowlist; nothing was removed.");
    }
    if (mustExist && entries.length !== ASSET_FILES.length) throw new Error("Packaged asset inventory is incomplete.");
}

export function parseArguments(args) {
    if (args.length === 0) return "sync";
    if (args.length === 1 && args[0] === "--verify") return "verify";
    if (args.length === 1 && args[0] === "--help") return "help";
    throw new Error("Use no arguments, --verify, or --help. Output destinations are fixed.");
}

export async function syncReaderAssets({ repositoryRoot = REPOSITORY_ROOT } = {}) {
    repositoryRoot = resolve(repositoryRoot);
    const { payload, manifest } = await validatedPayload(repositoryRoot);
    for (const target of READER_DESTINATIONS) await validateDestination(repositoryRoot, join(repositoryRoot, target), false);
    for (const target of READER_DESTINATIONS) {
        const destination = join(repositoryRoot, target);
        await mkdir(destination, { recursive: true });
        for (const [name, bytes] of payload) await writeFile(join(destination, name), bytes);
    }
    return { status: "synced", plugins: 2, sourceHash: manifest.sourceHash, buildHash: manifest.buildHash };
}

export async function verifyReaderAssets({ repositoryRoot = REPOSITORY_ROOT } = {}) {
    repositoryRoot = resolve(repositoryRoot);
    const { payload, manifest } = await validatedPayload(repositoryRoot);
    for (const target of READER_DESTINATIONS) {
        const destination = join(repositoryRoot, target);
        await validateDestination(repositoryRoot, destination, true);
        for (const [name, expected] of payload) {
            const actual = await readBounded(repositoryRoot, join(destination, name));
            if (!actual.equals(expected)) throw new Error("Packaged asset mismatch; stale copy rejected without repair.");
        }
    }
    return { status: "verified", plugins: 2, sourceHash: manifest.sourceHash, buildHash: manifest.buildHash };
}

export async function runCommand(args) {
    const command = parseArguments(args);
    if (command === "help") {
        console.log("Usage: node scripts/canvas-reader/sync-assets.mjs [--verify|--help]");
        console.log("Sync or verify named reader assets in the existing Wizard and SDD payloads.");
        return;
    }
    const result = command === "verify" ? await verifyReaderAssets() : await syncReaderAssets();
    console.log(JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    runCommand(process.argv.slice(2)).catch((error) => {
        console.error(error.code ? `Asset operation failed (${error.code}).` : error.message);
        process.exitCode = 1;
    });
}
