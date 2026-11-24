import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

for (const fails of [false, true]) {
    test(`restored Designer waits for a ${fails ? "rejected" : "successful"} session join`,
        { timeout: 10_000 }, async (t) => {
        const root = await mkdtemp(join(tmpdir(), "designer-startup-"));
        t.after(() => rm(root, { recursive: true, force: true }));
        const target = join(root, "designer");
        await cp(new URL("../", import.meta.url), target, {
            recursive: true, filter: (path) => !["node_modules", "test"].includes(basename(path)),
        });
        for (const folder of ["env", "contracts"]) {
            await cp(new URL(`../../speckit-wizard-canvas/${folder}/`, import.meta.url),
                join(root, "speckit-wizard-canvas", folder), { recursive: true });
        }
        const marker = join(target, "node_modules", "es-module-lexer");
        await mkdir(marker, { recursive: true });
        await writeFile(join(marker, "package.json"), "{}");
        const sdkDir = join(target, "node_modules", "@github", "copilot-sdk");
        await mkdir(sdkDir, { recursive: true });
        await writeFile(join(sdkDir, "package.json"), JSON.stringify({
            type: "module", exports: { "./extension": "./extension.mjs" },
        }));
        await writeFile(join(sdkDir, "extension.mjs"), `
            export const registered = Promise.withResolvers();
            export const joined = Promise.withResolvers();
            export const createCanvas = (canvas) => canvas;
            export class CanvasError extends Error {
                constructor(code, message) { super(message); this.code = code; }
            }
            export function joinSession(options) {
                registered.resolve({ ...options,
                    opening: options.canvases[0].open({ instanceId: "restored", input: {} }),
                    reloading: options.tools.find((tool) =>
                        tool.name === "speckit_designer_reload_skills").handler() });
                return joined.promise;
            }
        `);
        const sdk = await import(pathToFileURL(join(sdkDir, "extension.mjs")).href);
        let reloads = 0;
        const session = {
            workspacePath: root,
            rpc: { skills: { reload: async () => {
                reloads++;
                return { errors: [], warnings: [] };
            } } },
            log: async () => {},
        };
        const importing = import(pathToFileURL(join(target, "extension.mjs")).href);
        const imported = importing.then(() => null, (error) => error);
        const { canvases: [canvas], opening, reloading } = await sdk.registered.promise;
        let settled = false;
        const opened = opening.then((value) => {
            settled = true;
            return value;
        }, (error) => {
            settled = true;
            return error;
        });
        const reloaded = reloading.then((value) => value, (error) => error);
        try {
            await nextTurn();
            assert.equal(settled, false);
            assert.equal(reloads, 0);
            await assert.rejects(access(join(root, "speckit-canvas-designer")), { code: "ENOENT" });
            if (fails) {
                const failure = new Error("Session join failed");
                sdk.joined.reject(failure);
                assert.equal(await imported, failure);
                const error = await opened;
                assert.equal(error.code, "designer_open_failed");
                assert.equal(error.message, failure.message);
                assert.equal(await reloaded, failure);
                await assert.rejects(access(join(root, "speckit-canvas-designer")), { code: "ENOENT" });
            } else {
                sdk.joined.resolve(session);
                assert.equal(await imported, null);
                const result = await opening;
                assert.match(await (await fetch(result.url)).text(), /No Wizard handoff/);
                await access(join(root, "speckit-canvas-designer"));
                assert.deepEqual(JSON.parse(await reloading), { errors: [], warnings: [] });
                assert.equal(reloads, 1);
                await canvas.onClose({ instanceId: "restored" });
                const preview = await canvas.open({ instanceId: "normal", input: { preview: true } });
                assert.equal((await fetch(preview.url)).status, 200);
            }
        } finally {
            sdk.joined.resolve(session);
            await imported;
            await opened;
            await reloaded;
            await canvas.onClose({ instanceId: "restored" });
            await canvas.onClose({ instanceId: "normal" });
        }
    });
}
