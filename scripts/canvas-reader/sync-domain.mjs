import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPOSITORY_ROOT, inspectScriptStrings, sourceFingerprint } from "./sync-assets.mjs";

const WIZARD = "plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas";
const SDD = "plugins/spec-kit-copilot-sdd/extensions/sdd-canvas";
const require = createRequire(new URL(`../../${WIZARD}/ui/markdown-reader/package.json`, import.meta.url));

export async function syncDomain({ verify = false } = {}) {
    const parserRoot = join(REPOSITORY_ROOT, WIZARD, "ui/markdown-reader/build/parser");
    const metadata = JSON.parse(await readFile(join(parserRoot, "build-metadata.json"), "utf8"));
    if (metadata.sourceHash !== await sourceFingerprint()) throw new Error("Parser build is stale.");
    const parser = await readFile(join(parserRoot, "artifact-clarifications.mjs"));
    if (parser.length > 10 * 1024 * 1024 || /sourceMappingURL/.test(parser.toString("utf8"))) throw new Error("Invalid parser output.");
    inspectScriptStrings(parser.toString("utf8"));
    if (!Array.isArray(metadata.dependencies) || !metadata.dependencies.length) throw new Error("Parser dependency notices are missing.");
    const notices = ["Third-party licenses for the bundled server Markdown parser."];
    for (const dependency of metadata.dependencies) {
        if (!dependency.name || !dependency.version || !dependency.license || !dependency.notice?.trim()) throw new Error("Parser dependency notice is incomplete.");
        notices.push(`${dependency.name}@${dependency.version} (${dependency.license})\n${dependency.notice.trimEnd()}`);
    }
    const noticeBytes = Buffer.from(`${notices.join("\n\n")}\n`);
    const lexer = await import(pathToFileURL(require.resolve("es-module-lexer")).href);
    await lexer.init;
    const builtins = new Set(["node:process", "node:path", "node:url"]);
    if (lexer.parse(parser.toString("utf8"))[0].some((entry) => entry.d !== -2 && !builtins.has(entry.n))) throw new Error("Parser has unresolved imports.");
    const mappings = [
        [`${WIZARD}/ui/markdown-reader/build/parser/artifact-clarifications.mjs`, `${WIZARD}/server/artifact-clarifications.mjs`],
        [`${WIZARD}/ui/markdown-reader/build/parser/artifact-clarifications.mjs`, `${SDD}/vendor/artifact-clarifications.mjs`],
        [null, `${WIZARD}/server/artifact-clarifications.NOTICES.txt`, noticeBytes],
        [null, `${SDD}/vendor/artifact-clarifications.NOTICES.txt`, noticeBytes],
        ...["artifact-read.mjs", "artifact-review.mjs", "artifact-discovery.mjs"].map((name) => [`${WIZARD}/server/${name}`, `${SDD}/vendor/${name}`]),
        [`${WIZARD}/ui/artifact-review.js`, `${SDD}/ui/artifact-review.js`],
    ];
    const records = [];
    for (const [source, destination, generated] of mappings) {
        const target = join(REPOSITORY_ROOT, destination);
        let current = dirname(target);
        while (current !== resolve(REPOSITORY_ROOT)) {
            try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Domain target redirects through a link."); }
            catch (error) { if (error.code !== "ENOENT") throw error; }
            const parent = dirname(current);
            if (parent === current) throw new Error("Domain target is outside the repository.");
            current = parent;
        }
        const content = generated ?? await readFile(join(REPOSITORY_ROOT, source));
        let existing;
        try {
            if (!(await lstat(target)).isFile() || (await lstat(target)).isSymbolicLink()) throw new Error("Domain target is not an ordinary file.");
            existing = await readFile(target);
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (verify) {
            if (!existing?.equals(content)) throw new Error("Generated domain copy is stale or missing.");
        } else if (!existing?.equals(content)) {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, content);
        }
        records.push({ path: destination, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
    }
    return { status: verify ? "verified" : "synced", files: records };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    syncDomain({ verify: process.argv.includes("--verify") }).then((result) => console.log(JSON.stringify(result))).catch(() => {
        console.error("Domain package validation failed; rebuild the reader and parser.");
        process.exitCode = 1;
    });
}
