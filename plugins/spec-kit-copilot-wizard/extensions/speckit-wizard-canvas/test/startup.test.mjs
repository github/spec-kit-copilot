import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

for (const fails of [false, true]) {
    test(`restored Wizard waits for a ${fails ? "rejected" : "successful"} session join`,
        { timeout: 10_000 }, async (t) => {
        const root = await mkdtemp(join(tmpdir(), "wizard-startup-"));
        t.after(() => rm(root, { recursive: true, force: true }));
        const target = join(root, "wizard");
        await cp(new URL("../", import.meta.url), target, {
            recursive: true, filter: (path) => !["node_modules", "test"].includes(basename(path)),
        });
        await writeFile(join(target, "env", "deps-check.mjs"), `
            export async function checkDeps() { throw new Error("Stop at the dependency probe"); }
            export function getDependencyDir() { throw new Error("Unexpected dependency lookup"); }
            export function getExtensionDir() { throw new Error("Unexpected dependency lookup"); }
            export function installDeps() { throw new Error("Unexpected dependency install"); }
        `);
        await writeFile(join(target, "canvas-runtime", "watchers.mjs"), `
            export const starts = [];
            export async function startStateWatcher(inst) { starts.push(inst.workspacePath); }
            export async function startArtifactWatcher(inst) { starts.push(inst.workspacePath); }
            export function stopStateWatcher() {}
            export function stopArtifactWatcher() {}
        `);
        const sdkDir = join(target, "node_modules", "@github", "copilot-sdk");
        await mkdir(sdkDir, { recursive: true });
        await writeFile(join(sdkDir, "package.json"), JSON.stringify({
            type: "module", exports: { "./extension": "./extension.mjs" },
        }));
        await writeFile(join(sdkDir, "extension.mjs"), `
            export const registered = Promise.withResolvers();
            export const joined = Promise.withResolvers();
            export const createCanvas = (canvas) => canvas;
            export function joinSession({ canvases }) {
                const canvas = canvases[0];
                registered.resolve({ canvas,
                    opening: canvas.open({ instanceId: "restored", input: {} }) });
                return joined.promise;
            }
        `);
        const sdk = await import(pathToFileURL(join(sdkDir, "extension.mjs")).href);
        const { allInstances } = await import(pathToFileURL(
            join(target, "canvas-runtime", "instances.mjs")).href);
        const { starts } = await import(pathToFileURL(
            join(target, "canvas-runtime", "watchers.mjs")).href);
        const project = join(root, "checkout");
        const session = {
            workspacePath: root,
            rpc: { metadata: { snapshot: async () => ({ workingDirectory: project }) } },
            log: async () => {},
        };
        const importing = import(pathToFileURL(join(target, "extension.mjs")).href);
        const imported = importing.then(() => null, (error) => error);
        const { canvas, opening } = await sdk.registered.promise;
        let settled = false;
        const opened = opening.then((value) => {
            settled = true;
            return value;
        }, (error) => {
            settled = true;
            return error;
        });
        const closed = canvas.open({ instanceId: "closed", input: {} })
            .then((value) => value, (error) => error);
        try {
            const closingInstance = allInstances().get("closed");
            await canvas.onClose({ instanceId: "closed" });
            assert.equal(closingInstance.closed, true);
            await nextTurn();
            assert.equal(settled, false);
            assert.equal(allInstances().get("restored")?.server ?? null, null);
            assert.deepEqual(starts, []);
            if (fails) {
                const failure = new Error("Session join failed");
                sdk.joined.reject(failure);
                assert.equal(await imported, failure);
                assert.equal(await opened, failure);
                assert.equal(await closed, failure);
                assert.equal(allInstances().get("restored")?.server ?? null, null);
                assert.deepEqual(starts, []);
            } else {
                sdk.joined.resolve(session);
                assert.equal(await imported, null);
                const result = await opening;
                assert.match((await closed).message, /panel closed while opening/);
                assert.equal((await fetch(result.url)).status, 200);
                const inst = allInstances().get("restored");
                assert.equal(inst._session, session);
                assert.equal(inst.workspacePath, project);
                await inst.bootPromise;
                assert.deepEqual(starts, [project, project]);
                await canvas.onClose({ instanceId: "restored" });
                const explicit = await canvas.open({ instanceId: "normal", input: { cwd: root } });
                assert.equal((await fetch(explicit.url)).status, 200);
                assert.equal(allInstances().get("normal").workspacePath, root);
                await allInstances().get("normal").bootPromise;
            }
        } finally {
            sdk.joined.resolve(session);
            await imported;
            await opened;
            await closed;
            for (const instanceId of [...allInstances().keys()]) {
                await canvas.onClose({ instanceId });
            }
        }
    });
}
