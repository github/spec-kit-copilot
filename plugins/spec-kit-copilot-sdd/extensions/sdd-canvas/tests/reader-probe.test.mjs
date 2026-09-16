import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("SDD preserves its canvas actions and serves only guarded reader assets", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sdd-reader-probe-"));
    await mkdir(join(workspace, ".specify"));
    await mkdir(join(workspace, "specs/999-canvas-preview-fixture"), { recursive: true });
    await writeFile(join(workspace, "specs/999-canvas-preview-fixture/spec.md"), "# Owned SDD fixture\n");
    const holder = {
        canvases: [],
        session: {
            rpc: { metadata: { snapshot: async () => ({ workingDirectory: workspace }) } },
            send: async () => assert.fail("Reader probe must not dispatch a workflow."),
            log: async () => {},
        },
    };
    globalThis.__sddReaderProbeTest = holder;
    const mock = "export const createCanvas = definition => definition; export class CanvasError extends Error {} export async function joinSession(options) { const state = globalThis.__sddReaderProbeTest; state.canvases = options.canvases; return state.session; }";
    const sdkUrl = `data:text/javascript,${encodeURIComponent(mock)}`;
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === "@github/copilot-sdk/extension") return { url: sdkUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    } });
    let canvas;
    try {
        await import("../extension.mjs?reader-probe-test");
        canvas = holder.canvases[0];
        assert.equal(canvas.id, "sdd-canvas");
        assert.deepEqual(canvas.actions.map((action) => action.name), ["list_features", "setup_sdd", "clarify_item", "run_stage"]);
        const first = new URL((await canvas.open({ instanceId: "probe-first" })).url);
        const second = new URL((await canvas.open({ instanceId: "probe-second" })).url);
        assert.deepEqual(canvas.inputSchema.properties, {});
        const reopened = new URL((await canvas.open({ instanceId: "probe-second" })).url);
        assert.equal(reopened.href, second.href);
        async function request(path, cap = first.searchParams.get("cap"), headers = {}) {
            const url = new URL(path, first.origin);
            if (cap) url.searchParams.set("cap", cap);
            if (headers.Host) {
                return new Promise((resolve, reject) => {
                    const outgoing = httpGet(url, { headers }, (response) => {
                        response.resume();
                        resolve({ status: response.statusCode });
                    });
                    outgoing.on("error", () => reject(new Error("Owned SDD probe HTTP request failed.")));
                });
            }
            try { return await fetch(url, { headers }); }
            catch { throw new Error("Owned SDD probe HTTP request failed."); }
        }
        const assetPath = "/ui/vendor/markdown-reader/markdown-reader.js";
        const script = await request(assetPath);
        assert.equal(script.status, 200, "T014 has not exposed the guarded reader asset.");
        assert.match(script.headers.get("content-type"), /javascript/);
        assert.equal(script.headers.get("cache-control"), "no-store");
        assert.equal(script.headers.get("referrer-policy"), "no-referrer");
        assert.equal(script.headers.get("x-content-type-options"), "nosniff");
        assert.match(await script.text(), /mountMarkdownReader/);
        assert.equal((await request("/ui/vendor/markdown-reader/markdown-reader.css")).status, 200);
        assert.equal((await request(assetPath, null)).status, 403);
        assert.equal((await request(assetPath, second.searchParams.get("cap"))).status, 403);
        assert.equal((await request(assetPath, undefined, { Origin: "https://example.invalid" })).status, 403);
        assert.equal((await request(assetPath, undefined, { Host: "example.invalid" })).status, 403);
        assert.equal((await request("/ui/vendor/markdown-reader/private.txt")).status, 404);
        const legacy = await request("/api/artifact?feature=999-canvas-preview-fixture&stage=specify");
        const artifact = await legacy.json();
        assert.equal(artifact.ok, true);
        assert.equal(artifact.content, "# Owned SDD fixture\n");
    } finally {
        if (canvas) {
            await canvas.onClose({ instanceId: "probe-first" });
            await canvas.onClose({ instanceId: "probe-second" });
        }
        hooks.deregister();
        delete globalThis.__sddReaderProbeTest;
        await rm(workspace, { recursive: true, force: true });
    }
});
