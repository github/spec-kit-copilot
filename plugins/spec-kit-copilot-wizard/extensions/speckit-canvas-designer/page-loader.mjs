import { execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

async function commandEnvironment() {
    const extra = [join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".local", "bin")];
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        const root = join(process.env.LOCALAPPDATA, "Programs", "Python");
        let versions;
        try { versions = await readdir(root); }
        catch (error) {
            if (error.code !== "ENOENT") throw error;
            versions = [];
        }
        for (const version of versions.filter((name) => /^Python\d+$/.test(name))) {
            extra.push(join(root, version, "Scripts"), join(root, version));
        }
    }
    const env = { ...process.env, PYTHONUTF8: "1" };
    for (const key of Object.keys(env)) {
        if (key.toLowerCase() === "path") delete env[key];
    }
    env.PATH = [process.env.PATH ?? process.env.Path ?? "", ...extra].join(delimiter);
    return env;
}

async function executable(name, env) {
    for (const directory of env.PATH.split(delimiter).filter(Boolean)) {
        const candidate = join(directory.replace(/^"|"$/g, ""), name);
        try { if ((await stat(candidate)).isFile()) return await realpath(candidate); }
        catch (error) { if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error; }
    }
    throw new Error(`${name} is unavailable; install Specify CLI >=1.0.7 to load Designer pages`);
}

export async function runPageLoader(script, project, source) {
    const env = await commandEnvironment();
    const specify = await executable(process.platform === "win32" ? "specify.exe" : "specify", env);
    const candidates = process.platform === "win32"
        ? [join(dirname(specify), "python.exe"), join(dirname(dirname(specify)), "python.exe"), "python"]
        : [join(dirname(specify), "python"), "python3", "python"];
    const diagnostics = [];
    for (const command of [...new Set(candidates)]) {
        try {
            await runFile(command, ["-X", "utf8", "-c",
                "from specify_cli.presets import PresetResolver; from importlib.metadata import version; assert tuple(map(int, version('specify-cli').split('.')[:3])) >= (1,0,7)"],
            { env, cwd: project, timeout: 10_000, windowsHide: true });
        } catch (error) {
            diagnostics.push(`${command}: ${error.code ?? "Specify import failed"}`);
            continue;
        }
        try {
            const { stdout } = await runFile(command, ["-X", "utf8", script, project, source], {
                env, cwd: project, timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
            });
            const model = JSON.parse(stdout);
            if (!Array.isArray(model.pages) || !model.pages.length || !model.constraints || !model.values) {
                throw new Error("Invalid Designer page model");
            }
            return model;
        } catch (error) {
            throw new Error(`Designer page loading failed: ${
                (error.stderr || error.message).trim().slice(-2000)}`);
        }
    }
    throw new Error(`Python with Specify CLI >=1.0.7 is unavailable. ${diagnostics.join("; ")}`);
}
