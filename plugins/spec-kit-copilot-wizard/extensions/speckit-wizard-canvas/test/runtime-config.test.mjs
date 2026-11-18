import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveRuntimeConfig, runtimeDefaults, validateRuntimeSettings, DEFAULT_SETTINGS_PATH } from "../env/runtime-config.mjs";
import { resolveGenerateCanvas } from "../env/workspace.mjs";
import { createHandler } from "../server.mjs";
import { createFeatureFlags, readGenerateCanvas, generateCanvasInputSchema, featureFlagsSchema } from "../contracts/generate-feature.mjs";

test("optional absence uses defaults; explicit missing and invalid selectors fail", async () => {
    const read = async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
    assert.deepEqual(await resolveRuntimeConfig({ env: {}, read }), { settings: runtimeDefaults, path: null });
    await assert.rejects(resolveRuntimeConfig({ env: { SPECKIT_CONFIG_FILE: join(tmpdir(), "missing.json") }, read }), /Unable to load/);
    for (const value of ["", "relative.json"]) {
        await assert.rejects(resolveRuntimeConfig({ env: { SPECKIT_CONFIG_FILE: value }, read }), /absolute/);
    }
});

test("explicit file overrides defaults without reading the user-level file; all eight sources are configurable", async (t) => {
    const home = await mkdtemp(join(tmpdir(), "runtime-config-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const selected = join(home, "selected.json");
    const overrides = { catalogs: {}, copilotCatalogName: "fork", generateCanvasEnabled: true };
    for (const [source, values] of Object.entries(runtimeDefaults.catalogs)) {
        overrides.catalogs[source] = Object.fromEntries(Object.keys(values).map((kind) => [kind, `https://example.org/${source}/${kind}.json`]));
    }
    await writeFile(selected, JSON.stringify(overrides));
    const reads = [];
    const result = await resolveRuntimeConfig({ home, env: { SPECKIT_CONFIG_FILE: selected }, read: async (path, encoding) => {
        reads.push(path);
        const { readFile } = await import("node:fs/promises");
        return readFile(path, encoding);
    } });
    assert.deepEqual(reads, [selected]);
    assert.deepEqual(result, { path: selected, settings: overrides });
    const user = await resolveRuntimeConfig({ home, env: {}, read: async (path) => {
        assert.equal(path, DEFAULT_SETTINGS_PATH(home));
        return '{"catalogs":{"copilot":{"presets":"https://example.org/presets.json"}}}';
    } });
    assert.equal(user.settings.catalogs.copilot.presets, "https://example.org/presets.json");
    assert.equal(user.settings.catalogs.copilot.extensions, runtimeDefaults.catalogs.copilot.extensions);
});

test("invalid configuration is rejected rather than falling back", async () => {
    for (const value of [null, [], { unknown: true }, { generateCanvasEnabled: "true" },
        { copilotCatalogName: "bad name" }, { catalogs: { copilot: { bundles: "https://example.org" } } },
        { catalogs: { default: { presets: "http://example.org" } } },
        { catalogs: { community: { bundles: "https://user:password@example.org" } } }]) {
        assert.throws(() => validateRuntimeSettings(value));
    }
    await assert.rejects(resolveRuntimeConfig({ env: {}, read: async () => "{" }), /Unable to load/);
});

test("provider startup consumes selected catalog settings in a fresh process", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "runtime-provider-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "override.json");
    await writeFile(path, JSON.stringify({ catalogs: { copilot: {
        presets: "https://example.org/fork-presets.json", extensions: "https://example.org/fork-extensions.json",
    } }, copilotCatalogName: "test-fork" }));
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    const code = `const s = await import('./catalog/sources.mjs');
        const r = await import('./env/runtime-settings.mjs');
        console.log(JSON.stringify([s.PRESET_CATALOG_URL.copilot, s.EXTENSION_CATALOG_URL.copilot,
            s.BUNDLE_CATALOG_URL.default, r.runtimeSettings.copilotCatalogName]));`;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], {
        cwd, env: { ...process.env, SPECKIT_CONFIG_FILE: path }, timeout: 10000,
    });
    assert.deepEqual(JSON.parse(stdout), ["https://example.org/fork-presets.json",
        "https://example.org/fork-extensions.json", runtimeDefaults.catalogs.default.bundles, "test-fork"]);
});

test("Generate has configured default, explicit overrides and focus preservation; incompatible values fail", () => {
    assert.equal(resolveGenerateCanvas({}, {}, false), false);
    assert.equal(resolveGenerateCanvas({}, {}, true), true);
    assert.equal(resolveGenerateCanvas({ generateCanvas: false }, {}, true), false);
    assert.equal(resolveGenerateCanvas({ generateCanvas: true }, {}, false), true);
    assert.equal(resolveGenerateCanvas({ generateCanvas: true }, { input: { generateCanvas: false } }, true), false);
    assert.equal(resolveGenerateCanvas({}, { input: { generateCanvas: true } }), true);
    for (const generateCanvas of ["true", 1, null, undefined]) {
        assert.throws(() => resolveGenerateCanvas({}, { input: { generateCanvas } }), /boolean/);
    }
});

test("shared Generate contract validates host/UI exchanges and older snapshots", () => {
    assert.equal(generateCanvasInputSchema.type, "boolean");
    assert.equal(featureFlagsSchema.properties.generateCanvas.type, "boolean");
    for (const value of [true, false]) {
        assert.equal(readGenerateCanvas({ featureFlags: createFeatureFlags(value) }), value);
    }
    assert.equal(readGenerateCanvas({}), false);
    for (const featureFlags of [null, [], {}, { generateCanvas: "true" },
        { generateCanvas: true, unexpected: true }]) {
        assert.throws(() => readGenerateCanvas({ featureFlags }));
    }
    assert.throws(() => createFeatureFlags("true"), /boolean/);
});

test("authenticated disabled launch is forbidden; enabled launch reaches normal input validation", async () => {
    for (const enabled of [false, true]) {
        const req = Readable.from([Buffer.from("{}")]);
        req.method = "POST";
        req.url = "/api/designer/launch?token=test-token";
        req.headers = {};
        const res = {
            status: null, payload: "",
            writeHead(status) { this.status = status; },
            end(payload) { this.payload = payload; },
        };
        const handler = createHandler({
            token: "test-token", getInstance: () => ({ generateCanvas: enabled }),
            getState: async () => ({}), log: async () => {},
        });
        await handler(req, res);
        assert.equal(res.status, enabled ? 400 : 403);
        if (!enabled) assert.match(res.payload, /Generate canvas is disabled/);
    }
});
