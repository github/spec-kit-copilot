import { buildAugmentedPath } from "./resolve-path.mjs";

let augmentedPathPromise;

export async function specifySpawnOptions(cwd, options = {}) {
    augmentedPathPromise ??= buildAugmentedPath();
    return {
        cwd,
        shell: process.platform === "win32",
        windowsHide: true,
        env: { ...process.env, PATH: await augmentedPathPromise },
        ...options,
    };
}
