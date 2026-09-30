import { lstat, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint, handoffDirectory, readHandoff, validateHandoffId } from "./handoff.mjs";
import { readDesignSource, DESIGN_EXTENSION } from "./source.mjs";
import { assertSkillsMode, installedInventory, matchingInstalled, runPageLoader,
    runSpecify } from "./specify.mjs";

const providerPath = resolve(fileURLToPath(new URL(".", import.meta.url)));

export async function validateDesignerSetup({ handoffId, checkoutPath, workspacePath,
    sourcePath = providerPath, run = runSpecify, loadPages = runPageLoader, mode = "verify" }) {
    if (!["preflight", "verify"].includes(mode)) throw new Error("Invalid Designer validation mode");
    const id = validateHandoffId(handoffId);
    const [checkout, workspace, source] = await Promise.all(
        [checkoutPath, workspacePath, sourcePath].map((path) => realpath(path)));
    const parentRoot = resolve(source, "../../../..");
    if (source !== providerPath || resolve(sourcePath) !== providerPath
        || checkout === parentRoot || workspace === parentRoot || workspace === checkout
        || !(await lstat(join(checkout, ".git"))).isFile()
        || basename(dirname(workspace)) !== "session-state") {
        throw new Error("Designer validation requires a separate child worktree and session artifacts");
    }
    const handoff = await readHandoff(workspace, id);
    const expectedSource = join(parentRoot, "spec-kit-extensions", DESIGN_EXTENSION);
    if (handoff.requiredExtension.path !== expectedSource
        || fingerprint(await readDesignSource(expectedSource)) !== fingerprint(handoff.requiredExtension)) {
        throw new Error("Canvas Design source changed or does not match the trusted package root");
    }
    const folder = handoffDirectory(workspace, id);
    let installed = { presets: [], extensions: [], bundles: [] };
    try {
        await writeFile(join(folder, "setup.json"), JSON.stringify({ status: "pending" }));
        for (const name of [".github", ".specify"]) {
            const path = join(checkout, name);
            try {
                if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) {
                    throw new Error(`Child ${name} directory is unsafe`);
                }
            } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        const version = (await run(["--version"], checkout)).match(/(\d+)\.(\d+)\.(\d+)/);
        if (!version || Number(version[1]) < 1
            || (Number(version[1]) === 1 && Number(version[2]) === 0 && Number(version[3]) < 7)) {
            throw new Error("Canvas Designer requires Specify CLI >=1.0.7");
        }
        let initialized = false;
        try {
            const path = join(checkout, ".specify");
            if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) {
                throw new Error("Child .specify directory is unsafe");
            }
            initialized = true;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (initialized) {
            await assertSkillsMode(checkout);
            installed = await installedInventory(checkout, run);
        }
        if (mode === "preflight") {
            for (const kind of ["presets", "extensions", "bundles"]) {
                for (const item of handoff.selections[kind]) matchingInstalled(item, installed[kind]);
            }
            return { status: "pending", handoffId: id, initialized, installed };
        }
        if (!initialized) {
            throw new Error("Child project is not initialized; use the speckit-init skill first");
        }
        for (const kind of ["presets", "extensions", "bundles"]) {
            for (const item of handoff.selections[kind]) {
                if (!matchingInstalled(item, installed[kind])) {
                    throw new Error(`Selected ${kind} ${item.id} is missing; install it with the corresponding Spec Kit skill`);
                }
            }
        }
        await assertSkillsMode(checkout);
        const packagePath = join(checkout, ".specify", "extensions", DESIGN_EXTENSION);
        const packageRoot = await realpath(packagePath);
        if (packageRoot !== packagePath && packageRoot !== expectedSource) {
            throw new Error("Installed Canvas Design source escapes the validated root");
        }
        const packageSource = await readDesignSource(packageRoot);
        if (packageSource.fingerprint !== handoff.requiredExtension.fingerprint
            || fingerprint(await readDesignSource(expectedSource)) !== fingerprint(handoff.requiredExtension)) {
            throw new Error("Installed Canvas Design files do not match the handoff");
        }
        await loadPages(join(packageRoot, "scripts", "python", "pages.py"), checkout, expectedSource);
        await writeFile(join(folder, "setup.json"), JSON.stringify({
            schemaVersion: 1, status: "ready", handoffId: id, checkout,
            sourceFingerprint: handoff.sourceFingerprint, installed,
        }));
        return { status: "ready", handoffId: id };
    } catch (error) {
        await writeFile(join(folder, "setup.json"), JSON.stringify({
            schemaVersion: 1, status: "failed", error: error.message, installed,
        }));
        throw error;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 6) {
        console.error("Usage: node validate-setup.mjs <preflight|verify> <handoff-id> <child-checkout> <child-session-workspace>");
        process.exitCode = 1;
    } else {
        const [, , mode, id, checkout, workspace] = process.argv;
        try {
            if (resolve(checkout) !== process.cwd()) {
                throw new Error("Run Designer validation from the child checkout");
            }
            console.log(JSON.stringify(await validateDesignerSetup({
                mode, handoffId: id, checkoutPath: checkout, workspacePath: workspace,
            })));
        } catch (error) {
            console.error(`Designer validation failed: ${error.message}`);
            process.exitCode = 1;
        }
    }
}
