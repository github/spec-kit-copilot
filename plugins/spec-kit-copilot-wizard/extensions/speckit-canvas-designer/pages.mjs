import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { handoffDirectory } from "./handoff.mjs";
import { readDesignSource } from "./source.mjs";
import { installedInventory, matchingInstalled, runPageLoader } from "./specify.mjs";

export async function loadPreparedPages(handoff, workspace, project, load = runPageLoader) {
    const checkout = await realpath(project);
    const folder = handoffDirectory(workspace, handoff.handoffId);
    const path = join(folder, "setup.json");
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
        throw new Error("Invalid Designer preparation record");
    }
    const setup = JSON.parse(await readFile(path, "utf8"));
    if (setup.status !== "ready" || setup.checkout !== checkout
        || setup.handoffId !== handoff.handoffId || setup.sourceFingerprint !== handoff.sourceFingerprint) {
        throw new Error("Designer preparation is incomplete or belongs to another handoff");
    }
    const installed = await installedInventory(checkout);
    for (const kind of ["presets", "extensions", "bundles"]) {
        for (const item of handoff.selections[kind]) {
            if (!matchingInstalled(item, installed[kind])) throw new Error(`Missing selected package ${item.id}`);
        }
    }
    const packagePath = join(checkout, ".specify", "extensions", "canvas-design");
    const root = await realpath(packagePath);
    if (root !== packagePath && root !== handoff.requiredExtension.path) {
        throw new Error("Installed Canvas Design source escapes the validated root");
    }
    const source = await readDesignSource(root);
    if (source.fingerprint !== handoff.requiredExtension.fingerprint) {
        throw new Error("Canvas Design source changed; launch a new Designer session");
    }
    return load(join(root, "scripts", "python", "pages.py"), checkout, handoff.requiredExtension.path);
}
