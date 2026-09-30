import { cp, lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readHandoff, validateHandoffId } from "./handoff.mjs";

const providerPath = resolve(fileURLToPath(new URL(".", import.meta.url)));

export async function bootstrapDesigner({ handoffId, checkoutPath, workspacePath,
    sourcePath = providerPath, copy = cp }) {
    const id = validateHandoffId(handoffId);
    const [checkout, workspace, source] = await Promise.all(
        [checkoutPath, workspacePath, sourcePath].map((path) => realpath(path)));
    const parentRoot = resolve(source, "../../../..");
    if (source !== providerPath || resolve(sourcePath) !== providerPath
        || checkout === parentRoot || workspace === parentRoot || workspace === checkout
        || !(await lstat(join(checkout, ".git"))).isFile()
        || basename(dirname(workspace)) !== "session-state") {
        throw new Error("Designer bootstrap requires a separate child worktree and session artifacts");
    }
    await readHandoff(workspace, id);
    const target = join(workspace, "extensions", "speckit-canvas-designer");
    await mkdir(dirname(target), { recursive: true });
    await copy(source, target, { recursive: true, errorOnExist: true, force: false });
    return { status: "ready", handoffId: id };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 5) {
        console.error("Usage: node bootstrap.mjs <handoff-id> <child-checkout> <child-session-workspace>");
        process.exitCode = 1;
    } else {
        const [, , id, checkout, workspace] = process.argv;
        try {
            if (resolve(checkout) !== process.cwd()) {
                throw new Error("Run Designer bootstrap from the child checkout");
            }
            console.log(JSON.stringify(await bootstrapDesigner({
                handoffId: id, checkoutPath: checkout, workspacePath: workspace,
            })));
        } catch (error) {
            console.error(`Designer bootstrap failed: ${error.message}`);
            process.exitCode = 1;
        }
    }
}
