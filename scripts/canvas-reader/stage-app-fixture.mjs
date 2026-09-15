import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { assertOwnedWorkspace, isInside } from "./fixtures/workspace.mjs";
import { ASSET_FILES, READER_PACKAGE, REPOSITORY_ROOT, inspectScriptStrings } from "./sync-assets.mjs";

const PLUGINS = ["spec-kit-copilot-wizard", "spec-kit-copilot-sdd"];
const EXCLUDED = new Set(["node_modules", "dist", "build", "coverage", "test-results", "playwright-report", ".git", ".vscode", "test", "tests"]);
const require = createRequire(new URL(`../../${READER_PACKAGE}/package.json`, import.meta.url));
const builtinImports = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifyStagedPlugin({ pluginRoot: input } = {}) {
    if (typeof input !== "string" || !isAbsolute(input)) throw new Error("An absolute staged plugin root is required.");
    const pluginRoot = resolve(input);
    const manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8"));
    if (!PLUGINS.includes(manifest.name)) throw new Error("Only the two existing canvas plugin identities are allowed.");
    const wizard = manifest.name.endsWith("wizard");
    const extensionPath = `extensions/${wizard ? "speckit-wizard-canvas" : "sdd-canvas"}`;
    const extensionRoot = join(pluginRoot, extensionPath);
    const files = [];
    async function visit(directory) {
        if ((await lstat(directory)).isSymbolicLink()) throw new Error("Payload path redirects outside its boundary.");
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const target = join(directory, entry.name);
            const filename = relative(pluginRoot, target).split(sep).join("/");
            const dependency = filename.includes("/node_modules/");
            if ((!dependency && EXCLUDED.has(entry.name) && entry.name !== "node_modules") || /^\.env|\.(?:map|log|tmp|pem|key)$/i.test(entry.name) ||
                filename.includes("ui/markdown-reader/") || /(?:^|\/)\.canvas-reader/.test(filename)) throw new Error("Payload contains forbidden private or development files.");
            if (entry.isSymbolicLink()) throw new Error("Payload contains a redirecting path.");
            if (entry.isDirectory()) await visit(target);
            else if (entry.isFile()) {
                const content = await readFile(target);
                if (content.length > 10 * 1024 * 1024) throw new Error("Payload file exceeds the bounded verifier limit.");
                files.push({ path: filename, bytes: content.length, sha256: digest(content), content });
            } else throw new Error("Payload contains a non-regular file.");
        }
    }
    await visit(pluginRoot);
    files.sort((left, right) => left.path.localeCompare(right.path, "en"));
    const byPath = new Map(files.map((file) => [file.path, file]));
    const required = (filename) => {
        const file = byPath.get(filename);
        if (!file) throw new Error("Payload is missing a required asset or notice.");
        return file;
    };
    for (const filename of ["plugin.json", "UPSTREAM_LICENSE", `${extensionPath}/extension.mjs`, `${extensionPath}/copilot-extension.json`,
        `${extensionPath}/ui/artifact-review.js`, `${extensionPath}/${wizard ? "server" : "vendor"}/artifact-clarifications.NOTICES.txt`]) required(filename);
    const assetPath = `${extensionPath}/${wizard ? "ui/vendor" : "vendor"}/markdown-reader`;
    const assetManifest = required(`${assetPath}/manifest.json`);
    const assets = JSON.parse(assetManifest.content.toString("utf8"));
    if (JSON.stringify(files.filter((file) => file.path.startsWith(`${assetPath}/`)).map((file) => file.path.slice(assetPath.length + 1)).sort()) !== JSON.stringify([...ASSET_FILES].sort())) {
        throw new Error("Reader asset allowlist is incomplete or contains unexpected files.");
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(assets.sourceHash) || !/^sha256:[a-f0-9]{64}$/.test(assets.buildHash) ||
        !Array.isArray(assets.dependencies) || !assets.dependencies.length || !Array.isArray(assets.files) || assets.files.length !== 3) throw new Error("Reader asset metadata is invalid.");
    for (const expected of assets.files) {
        if (!["markdown-reader.js", "markdown-reader.css", "THIRD_PARTY_NOTICES.txt"].includes(expected.path)) throw new Error("Unexpected reader manifest asset.");
        const file = required(`${assetPath}/${expected.path}`);
        if (file.bytes !== expected.bytes || file.sha256 !== expected.sha256) throw new Error("Reader asset hash mismatch.");
    }
    if (`sha256:${digest(assets.files.map((file) => `${file.path}\0${file.sha256}`).join("\n"))}` !== assets.buildHash) throw new Error("Reader build hash mismatch.");
    const notices = required(`${assetPath}/THIRD_PARTY_NOTICES.txt`).content.toString("utf8");
    if (assets.dependencies.some((dependency) => !dependency.license || !notices.includes(`${dependency.name}@${dependency.version}`))) throw new Error("Reader dependency notices are incomplete.");
    const typescript = require("typescript");
    const { JSDOM } = require("jsdom");
    const { init, parse } = require("es-module-lexer");
    await init;
    const readerScript = required(`${assetPath}/markdown-reader.js`).content.toString("utf8");
    inspectScriptStrings(readerScript);
    if (parse(readerScript)[0].length) throw new Error("Reader imports are not dependency-closed.");

    function resolveImport(specifier, owner) {
        if (typeof specifier !== "string" || !specifier) throw new Error("Unresolved dynamic import in payload.");
        if (builtinImports.has(specifier)) {
            if (owner.includes("/ui/")) throw new Error("Browser import cannot depend on Node built-ins.");
            return;
        }
        if (specifier === "@github/copilot-sdk/extension" && !owner.includes("/ui/")) return;
        if (/^[A-Za-z][A-Za-z0-9+.-]*:|^[\\/]/.test(specifier)) throw new Error("Payload import is absolute, remote, or outside its boundary.");
        let target;
        try { target = createRequire(pathToFileURL(join(pluginRoot, owner))).resolve(specifier); }
        catch { throw new Error("Payload import has an uninstalled or missing dependency."); }
        if (!isInside(pluginRoot, target) || !byPath.has(relative(pluginRoot, target).split(sep).join("/"))) throw new Error("Payload import reaches outside its independent boundary.");
    }

    function browserAsset(route) {
        if (route === "/ui/artifact-review.js") return `${extensionPath}/ui/artifact-review.js`;
        if (route === "/ui/vendor/markdown-reader/markdown-reader.js") return `${assetPath}/markdown-reader.js`;
        throw new Error("Dynamic browser import is not an allowlisted reader asset.");
    }

    function coreInventoryImport(argument, owner) {
        if (owner !== `${extensionPath}/composition/collect.mjs` || !typescript.isIdentifier(argument) || argument.text !== "url") return false;
        let scope = argument.parent;
        while (scope && !typescript.isFunctionDeclaration(scope)) scope = scope.parent;
        if (scope?.name?.text !== "loadCoreInventory") return false;
        const declarations = new Map();
        const pending = [scope];
        while (pending.length) {
            const node = pending.pop();
            if (typescript.isVariableDeclaration(node) && typescript.isIdentifier(node.name)) declarations.set(node.name.text, node.initializer);
            typescript.forEachChild(node, (child) => { pending.push(child); });
        }
        const file = declarations.get("thisFile");
        const inventory = declarations.get("inventoryPath");
        const url = declarations.get("url");
        if (!file || !inventory || !url || !typescript.isCallExpression(file) || file.expression.getText() !== "fileURLToPath" || file.arguments[0]?.getText() !== "import.meta.url" ||
            !typescript.isCallExpression(inventory) || inventory.expression.getText() !== "pathResolve" || inventory.arguments.length !== 4 || inventory.arguments[0]?.getText() !== "dirname(thisFile)" ||
            inventory.arguments.slice(1).some((node, index) => !typescript.isStringLiteralLike(node) || node.text !== ["..", "pipeline", "canonical.mjs"][index]) ||
            !typescript.isPropertyAccessExpression(url) || url.name.text !== "href" || !typescript.isCallExpression(url.expression) ||
            url.expression.expression.getText() !== "pathToFileURL" || url.expression.arguments[0]?.getText() !== "inventoryPath") return false;
        required(`${extensionPath}/pipeline/canonical.mjs`);
        return true;
    }

    function inspectImports(text, owner) {
        const source = typescript.createSourceFile(owner, text, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
        if (source.parseDiagnostics.length) throw new Error("Payload JavaScript cannot be parsed for import closure.");
        const pending = [source];
        while (pending.length) {
            const node = pending.pop();
            if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) && node.moduleSpecifier) resolveImport(node.moduleSpecifier.text, owner);
            if (typescript.isCallExpression(node) && (node.expression.kind === typescript.SyntaxKind.ImportKeyword ||
                (typescript.isIdentifier(node.expression) && node.expression.text === "require"))) {
                const argument = node.arguments[0];
                if (argument && typescript.isStringLiteralLike(argument)) resolveImport(argument.text, owner);
                else if (argument && typescript.isCallExpression(argument) && typescript.isIdentifier(argument.expression) &&
                    ["urlFor", "endpoint"].includes(argument.expression.text) && typescript.isStringLiteralLike(argument.arguments[0]) &&
                    ["ui/artifact-review.js", "index.html"].some((suffix) => owner === `${extensionPath}/${suffix}`)) {
                    required(browserAsset(argument.arguments[0].text));
                } else if (argument && coreInventoryImport(argument, owner)) {
                    continue;
                } else throw new Error("Payload has an unresolved dynamic import.");
            }
            typescript.forEachChild(node, (child) => { pending.push(child); });
        }
    }

    for (const file of files) {
        if (/\.(?:mjs|cjs|js)$/.test(file.path)) inspectImports(file.content.toString("utf8"), file.path);
        if (file.path.endsWith(".html")) {
            const dom = new JSDOM(file.content.toString("utf8"));
            try {
                for (const script of dom.window.document.querySelectorAll("script")) {
                    const src = script.getAttribute("src");
                    if (src?.startsWith("/ui/") && !src.includes("..") && !src.includes("\\")) required(`${extensionPath}${src}`);
                    else if (src) resolveImport(src, file.path);
                    else if (!script.type || ["module", "text/javascript"].includes(script.type)) inspectImports(script.textContent, file.path);
                }
            } finally { dom.window.close(); }
        }
    }
    const records = files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    return { id: manifest.name, version: manifest.version, payloadSha256: digest(records.map((file) => `${file.path}\0${file.sha256}`).join("\n")),
        assetManifestSha256: assetManifest.sha256, readerBuildHash: assets.buildHash, files: records };
}

async function collectFiles(root, directory = root, includeRuntime = false) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const relativePath = relative(root, path).split(sep).join("/");
        if (!includeRuntime && EXCLUDED.has(entry.name)) continue;
        if (relativePath.endsWith("ui/markdown-reader")) continue;
        if (/^\.env|\.(?:map|log|tmp)$/i.test(entry.name)) continue;
        if (entry.isSymbolicLink()) throw new Error("Plugin source contains a redirecting path.");
        if (entry.isDirectory()) files.push(...await collectFiles(root, path, includeRuntime));
        else if (entry.isFile()) files.push({ path: relativePath, content: await readFile(path) });
        else throw new Error("Plugin source contains a non-regular file.");
    }
    return files;
}

async function collectRuntime(pluginRoot, extensionPath) {
    const extension = join(pluginRoot, extensionPath);
    const manifest = JSON.parse(await readFile(join(extension, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(join(extension, "package-lock.json"), "utf8"));
    const pending = Object.keys(manifest.dependencies || {});
    const visited = new Set();
    const files = [];
    while (pending.length) {
        const name = pending.pop();
        if (visited.has(name)) continue;
        visited.add(name);
        if (!/^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(name)) throw new Error("Invalid runtime package name.");
        const root = join(extension, "node_modules", name);
        if ((await lstat(root)).isSymbolicLink()) throw new Error("Runtime dependency redirects through a link.");
        const installed = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        if (installed.version !== lock.packages[`node_modules/${name}`]?.version) throw new Error("Existing runtime dependency does not match its lockfile.");
        pending.push(...Object.keys(installed.dependencies || {}));
        for (const file of await collectFiles(root, root, true)) files.push({ path: `${extensionPath}/node_modules/${name}/${file.path}`, content: file.content });
    }
    return files;
}

export function parseArguments(args) {
    if (args.length === 1 && args[0] === "--help") return { help: true };
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        if (!["--workspace", "--target", "--plugin"].includes(flag) || !value || value.startsWith("--")) {
            throw new Error("Use --workspace <verified-fixture> --target <new-owned-directory> [--plugin <existing-plugin-id>].");
        }
        const key = flag.slice(2);
        if (options[key]) throw new Error("Duplicate fixture argument.");
        options[key] = value;
    }
    if (!options.workspace || !options.target) throw new Error("Explicit workspace and target are required.");
    if (options.plugin) {
        if (!PLUGINS.includes(options.plugin)) throw new Error("Only an existing Wizard or SDD plugin may be staged.");
        options.pluginIds = [options.plugin];
        delete options.plugin;
    }
    return options;
}

export async function stageAppFixture({ workspace: input, target: targetInput, pluginIds = PLUGINS } = {}) {
    const { workspace, owner } = await assertOwnedWorkspace(input);
    if (!Array.isArray(pluginIds) || !pluginIds.length || pluginIds.length > 2 || new Set(pluginIds).size !== pluginIds.length || pluginIds.some((id) => !PLUGINS.includes(id))) {
        throw new Error("Choose one or both existing canvas plugin identities.");
    }
    if (typeof targetInput !== "string") throw new Error("A new owned target directory is required.");
    const target = resolve(targetInput);
    if (!isInside(workspace, target) || target === workspace || relative(workspace, target).split(sep).includes(".git")) throw new Error("Stage target must be inside the verified fixture, outside Git metadata.");
    let current = workspace;
    for (const component of relative(workspace, target).split(sep)) {
        current = join(current, component);
        try {
            const stat = await lstat(current);
            if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Stage path redirects or is not a directory.");
            if (current === target) throw new Error("Stage target exists; overwriting is forbidden.");
        } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const payloads = [];
    for (const id of pluginIds) {
        const root = join(REPOSITORY_ROOT, "plugins", id);
        const extensionPath = id.endsWith("wizard") ? "extensions/speckit-wizard-canvas" : "extensions/sdd-canvas";
        const files = await collectFiles(root);
        if (id.endsWith("wizard")) files.push(...await collectRuntime(root, extensionPath));
        files.push({ path: "UPSTREAM_LICENSE", content: await readFile(join(REPOSITORY_ROOT, "LICENSE")) });
        payloads.push({ id, extensionPath, files });
    }
    await mkdir(dirname(target), { recursive: true });
    await mkdir(target);
    const plugins = [];
    for (const payload of payloads) {
        const records = [];
        for (const file of payload.files) {
            const destination = join(target, payload.id, file.path);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, file.content, { flag: "wx" });
            records.push({ path: file.path, bytes: file.content.length, sha256: createHash("sha256").update(file.content).digest("hex") });
        }
        plugins.push({ id: payload.id, extensionPath: payload.extensionPath, files: records.sort((left, right) => left.path.localeCompare(right.path, "en")) });
    }
    for (const plugin of plugins) await verifyStagedPlugin({ pluginRoot: join(target, plugin.id) });
    const record = { schemaVersion: 1, fixtureId: owner.id, sourceKind: "local-development-payload", plugins };
    await writeFile(join(target, "staging-manifest.json"), JSON.stringify(record, null, 2), { flag: "wx" });
    return record;
}

export async function runCommand(args) {
    const options = parseArguments(args);
    if (options.help) {
        console.log("Usage: node scripts/canvas-reader/stage-app-fixture.mjs --workspace <verified-fixture> --target <new-owned-directory> [--plugin <existing-plugin-id>]");
        console.log("Requires scoped fixture approval. Never overwrites an existing target or official plugin.");
        return;
    }
    const result = await stageAppFixture(options);
    console.log(JSON.stringify({ status: "staged", fixtureId: result.fixtureId, plugins: result.plugins.map((plugin) => plugin.id) }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    runCommand(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
