import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function serveSpecifyPackages(workspace, packages) {
    const archives = new Map();
    for (const [name, source] of Object.entries(packages)) {
        const entries = (await readdir(source)).filter((entry) => entry !== "node_modules");
        const archive = join(workspace, `${name}.zip`);
        await run(process.platform === "win32" ? "python" : "python3",
            ["-m", "zipfile", "-c", archive, ...entries],
            { cwd: source, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
        archives.set(`/${name}.zip`, await readFile(archive));
    }

    const server = createServer((request, response) => {
        const archive = archives.get(request.url);
        if (!archive) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { "Content-Type": "application/zip" }).end(archive);
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        url: (name) => `http://127.0.0.1:${server.address().port}/${name}.zip`,
        close: () => new Promise((resolve, reject) =>
            server.close((error) => error ? reject(error) : resolve())),
    };
}

export function addLoopbackSpecifyExtension(project, name, url) {
    if (new URL(url).hostname !== "127.0.0.1") {
        throw new Error("Test extension archive must be served from loopback");
    }
    return new Promise((resolve, reject) => {
        const child = execFile("specify", ["extension", "add", name, "--from", url],
            { cwd: project, timeout: 90_000, maxBuffer: 2 * 1024 * 1024 },
            (error, stdout, stderr) => error
                ? reject(new Error(`${error.message}\n${stdout}\n${stderr}`, { cause: error }))
                : resolve(stdout));
        child.stdin.end("y\n");
    });
}
