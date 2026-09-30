import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fingerprint } from "./handoff.mjs";
import { readDesignSource } from "./source.mjs";
import { runPageLoader } from "./page-loader.mjs";

export async function loadDesignerPages(handoff, project, load = runPageLoader) {
    const checkout = await realpath(project);
    const source = await readDesignSource();
    if (fingerprint(source) !== fingerprint(handoff.requiredExtension)) {
        throw new Error("Canvas Design source changed; launch a new Designer session");
    }
    return load(join(source.path, "scripts", "python", "pages.py"), checkout, source.path);
}
