import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DESIGN_EXTENSION = "canvas-design";
export const designSourcePath = resolve(fileURLToPath(new URL(".", import.meta.url)),
    "../../../..", "spec-kit-extensions", DESIGN_EXTENSION);
const FILES = ["extension.yml", "pages/setup.json", "pages/artifacts.json",
    "pages/appearance.json", "pages/results.json", "schemas/page.schema.json",
    "commands/load-page.md"];

export function validDesignSource(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).sort().join(",") === "fingerprint,id,path,source,version"
        && value.id === DESIGN_EXTENSION && value.source === "local-dev"
        && typeof value.path === "string" && isAbsolute(value.path)
        && !/[\x00-\x1f\x7f]/.test(value.path) && value.path.length <= 2048
        && typeof value.version === "string" && /^\d+\.\d+\.\d+$/.test(value.version)
        && typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fingerprint);
}

export async function readDesignSource(path = designSourcePath) {
    const root = resolve(path);
    if (await realpath(root) !== root) throw new Error("Canvas Design source must not be a symlink");
    const hash = createHash("sha256");
    let manifest;
    for (const name of FILES) {
        const file = join(root, name);
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024
            || await realpath(file) !== file) throw new Error(`Unsafe Canvas Design file: ${name}`);
        const bytes = await readFile(file);
        if (bytes.length > 256 * 1024) throw new Error(`Oversized Canvas Design file: ${name}`);
        hash.update(name).update("\0").update(bytes).update("\0");
        if (name === "extension.yml") manifest = bytes.toString("utf8");
    }
    if (!/^\s{2}id:\s*canvas-design\s*$/m.test(manifest)) {
        throw new Error("Canvas Design extension manifest has an invalid ID");
    }
    const version = manifest.match(/^\s{2}version:\s*"(\d+\.\d+\.\d+)"\s*$/m)?.[1];
    if (!version) throw new Error("Canvas Design extension manifest has an invalid version");
    return { id: DESIGN_EXTENSION, source: "local-dev", version, path: root,
        fingerprint: hash.digest("hex") };
}

export async function probeDesignSource() {
    try { return { available: true, extension: await readDesignSource() }; }
    catch (error) {
        return { available: false, error: `Canvas Design source is unavailable: ${error.message}` };
    }
}
