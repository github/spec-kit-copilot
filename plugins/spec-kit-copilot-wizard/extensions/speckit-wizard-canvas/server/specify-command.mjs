import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { specifySpawnOptions } from "../env/specify-invocation.mjs";

const exec = promisify(execFile);
const CLI = process.platform === "win32" ? "specify.exe" : "specify";
const WARNING = /(?:^|\n)[^\n]*(?:no base command layer|composition[^\n]*\b(?:warning|incomplete|failed)\b)[^\n]*/i;

export async function runSpecify(project, args, run = exec, { confirmApprovedSource = false } = {}) {
    const options = await specifySpawnOptions(project, {
        timeout: 120000, maxBuffer: 2 * 1024 * 1024,
        shell: process.platform === "win32" ? false : undefined,
    });
    let output;
    try {
        const execution = run(CLI, args, options);
        if (args.includes("--from") || confirmApprovedSource) execution.child?.stdin?.end("y\n");
        output = await execution;
    } catch (error) {
        const diagnostics = [error.stdout, error.stderr].filter(Boolean).join("\n") || error.message;
        throw new Error(`Specify ${args.slice(0, 3).join(" ")} failed: ${diagnostics}`, { cause: error });
    }
    const { stdout = "", stderr = "" } = output;
    if (WARNING.test(`${stdout}\n${stderr}`)) {
        throw new Error(`Specify ${args.slice(0, 3).join(" ")} reported a composition warning: ${stdout} ${stderr}`);
    }
    return stdout;
}

export async function downloadBundle(url, path) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`Bundle download failed (${response.status})`);
    let bytes = 0;
    const limit = new Transform({
        transform(chunk, encoding, callback) {
            bytes += chunk.length;
            callback(bytes > 50 * 1024 * 1024 ? new Error("Bundle download exceeds 50 MB") : null, chunk);
        },
    });
    await pipeline(response.body, limit, createWriteStream(path));
}
