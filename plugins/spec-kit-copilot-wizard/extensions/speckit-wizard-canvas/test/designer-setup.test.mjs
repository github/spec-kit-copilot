import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildDesignerHandoff } from "../server/handlers-designer.mjs";
import { finalizeDesignerSetup, installDesignerSetup, runSpecify,
    verifyComposedLoadPage } from "../server/designer-setup.mjs";
import { designerOpenInputSchema, validateDesignerOpenInput } from
    "../../speckit-canvas-designer/contracts/host-open.mjs";
import { checkSchema } from "../../speckit-canvas-designer/contracts/external-design-contributions.mjs";
import { runtimeSettings } from "../env/runtime-settings.mjs";

const baseUrl = "https://example.org/canvas.zip?x=1&y=2";
const baseCatalog = {
    presets: [], bundles: [],
    extensions: [{ id: "extension-canvas-design", source: "copilot",
        version: "1.0.0", downloadUrl: baseUrl, tags: ["canvas-design"] }],
};
const empty = { presets: [], extensions: [], bundles: [] };

async function fixture(t, { installed = empty, selections = empty,
    localSelections, locators = empty, verifier = true } = {}) {
    const project = await mkdtemp(join(tmpdir(), "designer-setup-child-"));
    const root = await mkdtemp(join(tmpdir(), "designer-setup-session-"));
    t.after(() => Promise.all([rm(project, { recursive: true, force: true }),
        rm(root, { recursive: true, force: true })]));
    await mkdir(join(project, ".specify"));
    const id = randomUUID();
    const handoff = buildDesignerHandoff({ catalog: baseCatalog, pipeline: [{ id: "plan" }] },
        selections, localSelections, installed, id, locators);
    const json = JSON.stringify(handoff);
    const hash = createHash("sha256").update(json).digest("hex");
    const handoffDir = join(root, "speckit-canvas-designer", "handoffs", id);
    await mkdir(handoffDir, { recursive: true });
    await writeFile(join(handoffDir, "handoff.json"), json);
    const packages = { extensions: [], presets: [], bundles: [] };
    const calls = [];
    const skill = join(project, ".github", "skills", "speckit-extension-canvas-design-load-page", "SKILL.md");
    async function run(binary, args, options) {
        calls.push(args);
        if (binary === "node") {
            return { stdout: JSON.stringify({
                pages: [{ name: "designer-essentials", path: join(project, "page.json"),
                    kind: "designer.tab-definition", strategy: "replace" }],
                templates: [],
            }), stderr: "" };
        }
        const [group, verb] = args;
        if (group === "artifact") return { stdout: JSON.stringify([{
            id: "command:speckit.extension-canvas-design.load-page",
            name: "speckit.extension-canvas-design.load-page", kind: "command",
            stack: [{ active: true, layer: "extension", sourceId: "extension-canvas-design" }],
        }]) };
        if (verb === "list") return { stdout: JSON.stringify(group === "bundle"
            ? packages.bundles : packages[group === "extension" ? "extensions" : "presets"]) };
        if (verb === "catalog") return { stdout: "" };
        if (group === "bundle" && verb === "install") {
            packages.bundles.push({ bundle_id: "kit", version: "2.0.0" });
            return { stdout: "" };
        }
        if (["extension", "preset"].includes(group) && verb === "remove") {
            const items = packages[group === "extension" ? "extensions" : "presets"];
            items.splice(items.findIndex((item) => item.id === args[2]), 1);
            return { stdout: "" };
        }
        if (["extension", "preset"].includes(group) && ["enable", "disable", "set-priority"].includes(verb)) {
            const item = packages[group === "extension" ? "extensions" : "presets"]
                .find((entry) => entry.id === args[2]);
            if (verb === "set-priority") item.priority = Number(args[3]);
            else item.enabled = verb === "enable";
            return { stdout: "" };
        }
        if (["extension", "preset"].includes(group) && verb === "add") {
            const kind = group === "extension" ? "extensions" : "presets";
            const local = args.includes("--dev");
            const name = group === "preset" && args.includes("--dev") ? "pirate-full"
                : args[2] === "pirate" ? "pirate-full" : "extension-canvas-design";
            const version = name === "pirate-full" ? "1.1.0" : "1.0.0";
            const item = { id: name, version, priority: 10, enabled: true,
                source: local ? { kind: "local" }
                    : { kind: "catalog", catalog: name === "pirate-full" ? "community" : "copilot" } };
            const old = packages[kind].findIndex((entry) => entry.id === name);
            if (old !== -1) {
                if (group === "preset") throw new Error(`Preset '${name}' is already installed`);
                packages[kind].splice(old, 1);
            }
            packages[kind].push(item);
            const folder = join(project, ".specify", kind, name);
            await mkdir(folder, { recursive: true });
            await writeFile(join(folder, `${group}.yml`),
                `${group}:\n  id: ${name}\n  name: Test\n  version: ${version}\n`);
            if (name === "extension-canvas-design") {
                await mkdir(join(project, ".github", "skills", "speckit-extension-canvas-design-load-page"),
                    { recursive: true });
                await writeFile(skill, "## Pages\n- `designer-essentials`\n");
                if (verifier) {
                    await mkdir(join(folder, "scripts"), { recursive: true });
                    await writeFile(join(folder, "scripts", "verify-launch.mjs"), "");
                }
            }
            return { stdout: "" };
        }
        throw new Error(`Unexpected ${args.join(" ")}`);
    }
    return { project, root, id, hash, handoff, calls, packages, skill, run,
        deps: { run, check: async () => ({ initialized: true, checkout: project }),
            verifyBase: async () => ({ warnings: [] }),
            verifyLocal: async () => ({ id: "extension-canvas-design" }) } };
}

test("scripted setup keeps Specify installation order and uses frozen catalog keys", async (t) => {
    const installed = { extensions: [], presets: [{ id: "pirate-full", version: "1.0.0",
        priority: 4, enabled: false, source: "community" }],
    bundles: [{ id: "kit", version: "2.0.0" }] };
    const locators = { extensions: [], presets: [{
        installedId: "pirate-full", source: "community", catalogId: "pirate",
        downloadUrl: "https://example.org/pirate.zip",
    }], bundles: [{ installedId: "kit", source: "community", catalogId: "kit",
        downloadUrl: "https://example.org/kit.zip" }] };
    const f = await fixture(t, { installed, locators });
    const result = await installDesignerSetup(f.project, f.root, f.id, f.hash, {
        ...f.deps, download: async (_url, path) => writeFile(path, "zip"),
    });
    assert.equal(result.stage, "installed");
    assert.ok(result.warnings.some((warning) => /pirate-full version drift/.test(warning)));
    const actions = f.calls.filter((args) => ["install", "add"].includes(args[1]));
    assert.deepEqual(actions.map((args) => args.slice(0, 3)), [
        ["extension", "add", "extension-canvas-design"],
        ["bundle", "install", actions[1][2]],
        ["extension", "add", "extension-canvas-design"],
        ["preset", "add", "pirate"],
    ]);
    assert.match(actions[1][2], /bundle\.zip$/);
    assert.equal(f.packages.presets[0].enabled, false);
    assert.equal(f.packages.presets[0].priority, 4);
    assert.equal(f.calls.filter((args) => args[0] === "artifact").length, 1);
    const finalized = await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    assert.equal(finalized.stage, "ready");
    assert.deepEqual(Object.keys(finalized.openInput),
        ["handoffId", "pages", "templates"]);
    assert.equal(finalized.openInput.handoffId, f.id);
    assert.equal(finalized.openInput.pages[0].name, "designer-essentials");
    assert.equal(finalized.openInput.templates.length, 0);
    assert.deepEqual(validateDesignerOpenInput(finalized.openInput),
        { preview: undefined, ...finalized.openInput });
    assert.doesNotThrow(() => checkSchema(finalized.openInput,
        designerOpenInputSchema, "Designer open input"));
    assert.throws(() => checkSchema({ ...finalized.openInput, timings: finalized.timings },
        designerOpenInputSchema, "Designer open input"), /unsupported property timings/);
    assert.throws(() => checkSchema({ ...finalized.openInput, warnings: finalized.warnings },
        designerOpenInputSchema, "Designer open input"), /unsupported property warnings/);
    assert.ok(!Object.hasOwn(finalized.openInput, "timings"));
    assert.ok(!Object.hasOwn(finalized.openInput, "warnings"));
    assert.ok(Object.hasOwn(finalized, "timings"));
    assert.ok(Object.hasOwn(finalized, "warnings"));
    assert.equal(f.calls.filter((args) => args[0] === process.execPath).length, 0);
    assert.equal(f.calls.filter((args) => args[0]?.endsWith("verify-launch.mjs")).length, 1);
});

test("finalize rejects a verifier payload incompatible with the Designer open schema", async (t) => {
    const f = await fixture(t);
    await installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, {
        ...f.deps,
        run: async (binary, args, options) => {
            const result = await f.run(binary, args, options);
            if (binary !== "node") return result;
            const payload = JSON.parse(result.stdout);
            payload.pages[0].timings = { finalize: 1 };
            return { ...result, stdout: JSON.stringify(payload) };
        },
    }), /Designer open input.pages\[0\]: unsupported property timings/);
});

test("finalize runs the verifier with Node rather than the embedded Copilot executable", async (t) => {
    const f = await fixture(t);
    await installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    const executable = process.execPath;
    const binaries = [];
    try {
        process.execPath = join(f.project, "copilot.exe");
        const result = await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, {
            ...f.deps,
            run: async (binary, args, options) => {
                binaries.push(binary);
                if (binary === "node") {
                    assert.equal(options.shell, false);
                    assert.equal(options.cwd, f.project);
                    assert.ok(options.env.PATH || options.env.Path);
                    assert.equal(args[1], f.project);
                }
                return f.run(binary, args, options);
            },
        });
        assert.equal(result.stage, "ready");
        assert.equal(binaries.filter((binary) => binary === "node").length, 1);
        assert.ok(!binaries.includes(process.execPath));
    } finally {
        process.execPath = executable;
    }
});

test("older package requires manual Specify resolution, never an empty open input", async (t) => {
    const f = await fixture(t, { verifier: false });
    await installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    const result = await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    assert.equal(result.stage, "manual-resolution");
    assert.equal(Object.hasOwn(result, "pages"), false);
    assert.equal(Object.hasOwn(result, "openInput"), false);
});

test("failed Specify commands preserve stdout and stderr diagnostics and their cause", async () => {
    const cause = Object.assign(new Error("Command failed"), {
        stdout: "Preset 'test' is already installed", stderr: "Additional diagnostic",
    });
    await assert.rejects(runSpecify(process.cwd(), ["preset", "add", "--dev"], async () => {
        throw cause;
    }), (error) => {
        assert.match(error.message, /Preset 'test' is already installed/);
        assert.match(error.message, /Additional diagnostic/);
        assert.strictEqual(error.cause, cause);
        return true;
    });
});

test("setup rejects a changed handoff before any installation", async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.root, "speckit-canvas-designer", "handoffs", f.id, "handoff.json"),
        `${JSON.stringify(f.handoff)}changed`);
    await assert.rejects(installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /handoff bytes changed/);
    assert.deepEqual(f.calls, []);
});

test("Specify command composition must resolve through its active artifact stack", async (t) => {
    const f = await fixture(t);
    await mkdir(join(f.project, ".github", "skills", "speckit-extension-canvas-design-load-page"),
        { recursive: true });
    await writeFile(f.skill, "## Pages\n- `designer-essentials`\n");
    await assert.rejects(verifyComposedLoadPage(f.project, async () =>
        JSON.stringify([{ id: "command:speckit.extension-canvas-design.load-page",
            name: "speckit.extension-canvas-design.load-page", kind: "command",
            stack: [{ active: false }] }])), /did not resolve/);
    await writeFile(f.skill, "x".repeat(256 * 1024 + 1));
    await assert.rejects(verifyComposedLoadPage(f.project, async () => {
        throw new Error("Should reject oversized skill before querying Specify");
    }), /Oversized generated Canvas Design load-page skill/);
});

test("Specify subprocess treats zero-exit composition warnings as errors", async () => {
    await assert.rejects(runSpecify(process.cwd(), ["preset", "add", "test"],
        async () => ({ stdout: "Warning: no base command layer", stderr: "" })),
    /composition warning/);
    await assert.rejects(runSpecify(process.cwd(), ["preset", "add", "test"],
        async () => ({ stdout: "\u26a0 Command composition incomplete", stderr: "" })),
    /composition warning/);
    assert.match(await runSpecify(process.cwd(), ["init", "--here", "--force"],
        async () => ({ stdout: "Warning: Current directory is not empty (18 items)\nProject ready.",
            stderr: "" })), /Project ready/);
});

test("only frozen URL installs receive the Specify untrusted-source confirmation", async () => {
    const inputs = [];
    const run = (_binary, _args, options) => {
        assert.equal(options.shell, process.platform === "win32" ? false : undefined);
        const execution = Promise.resolve({ stdout: "" });
        execution.child = { stdin: { end: (value) => inputs.push(value) } };
        return execution;
    };
    await runSpecify(process.cwd(), ["extension", "add", "approved",
        "--from", "https://example.org/approved.zip"], run);
    await runSpecify(process.cwd(), ["extension", "list", "--json"], run);
    await runSpecify(process.cwd(), ["bundle", "install", "approved.zip"], run,
        { confirmApprovedSource: true });
    assert.deepEqual(inputs, ["y\n", "y\n"]);
});

test("approved local override supersedes the frozen runtime source and retains state", async (t) => {
    const source = await mkdtemp(join(tmpdir(), "designer-local-preset-"));
    t.after(() => rm(source, { recursive: true, force: true }));
    await writeFile(join(source, "preset.yml"),
        "preset:\n  id: pirate-full\n  name: Local override\n  version: 1.1.0\n");
    const installed = { extensions: [], presets: [{ id: "pirate-full", version: "0.9.0",
        source: "community", priority: 4, enabled: false }], bundles: [] };
    const locators = { extensions: [], presets: [{ installedId: "pirate-full",
        source: "local", path: source }], bundles: [] };
    const localSelections = { presets: [{ id: "pirate-full", approved: true, source: "local",
        path: source, version: "1.1.0" }] };
    const f = await fixture(t, { installed, locators, localSelections });
    const result = await installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    assert.equal(result.stage, "installed");
    assert.ok(f.calls.some((args) => args[0] === "preset" && args.includes("--dev")
        && args.includes(source)));
    assert.ok(!f.calls.some((args) => args.includes("community")));
    assert.equal(f.packages.presets[0].priority, 4);
    assert.equal(f.packages.presets[0].enabled, false);
});

test("selected catalog key may install a different manifest ID", async (t) => {
    const selections = { extensions: [], bundles: [], presets: [{
        id: "pirate", source: "community", approved: true,
        version: "1.0.0", downloadUrl: "https://example.org/pirate.zip",
    }] };
    const f = await fixture(t, { selections });
    const installed = await installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    assert.equal(installed.stage, "installed");
    assert.ok(f.calls.some((args) => args[0] === "preset" && args[1] === "add"
        && args[2] === "pirate"));
    assert.equal(f.packages.presets[0].id, "pirate-full");
    assert.ok(installed.warnings.some((warning) => /pirate-full version drift/.test(warning)));
    assert.equal((await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, f.deps)).stage, "ready");
    const record = JSON.parse(await readFile(join(f.root, "speckit-canvas-designer",
        "handoffs", f.id, "setup-record.json"), "utf8"));
    assert.deepEqual(record.selections.presets, [{
        catalogId: "pirate", source: "community", id: "pirate-full", version: "1.1.0",
        installedSource: "community",
    }]);
    f.packages.presets[0].source = { kind: "catalog", catalog: "other" };
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /differs from the approved catalog source/);
    f.packages.presets[0].source = { kind: "catalog", catalog: "community" };
    f.packages.presets[0].version = "1.2.0";
    await writeFile(join(f.project, ".specify", "presets", "pirate-full", "preset.yml"),
        "preset:\n  id: pirate-full\n  name: Test\n  version: 1.2.0\n");
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /changed after installation/);
});

test("selected alias already installed by a bundle is removed by manifest ID", async (t) => {
    const selections = { extensions: [], presets: [{
        id: "pirate", source: "community", approved: true,
        version: "1.0.0", downloadUrl: "https://example.org/pirate.zip",
    }], bundles: [{
        id: "kit", source: "community", approved: true,
        version: "2.0.0", downloadUrl: "https://example.org/kit.zip",
    }] };
    const f = await fixture(t, { selections });
    const run = async (binary, args, options) => {
        if (args[0] === "preset" && args[1] === "remove" && args[2] !== "pirate-full") {
            throw new Error("Attempted to remove a catalog alias instead of its manifest ID");
        }
        const result = await f.run(binary, args, options);
        if (args[0] === "bundle" && args[1] === "install") {
            f.packages.presets.push({ id: "pirate-full", version: "1.0.0",
                priority: 10, enabled: true, source: { kind: "local" } });
            const folder = join(f.project, ".specify", "presets", "pirate-full");
            await mkdir(folder, { recursive: true });
            await writeFile(join(folder, "preset.yml"),
                "preset:\n  id: pirate-full\n  name: Test\n  version: 1.0.0\n");
        }
        return result;
    };
    const deps = { ...f.deps, run, download: async (_url, path) => writeFile(path, "zip") };
    const installed = await installDesignerSetup(f.project, f.root, f.id, f.hash, deps);
    assert.equal(installed.stage, "installed");
    assert.ok(f.calls.some((args) => args[0] === "preset" && args[1] === "remove"
        && args[2] === "pirate-full"));
    assert.equal((await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, deps)).stage, "ready");
});

test("a URL-approved selection retains its local CLI provenance across stages", async (t) => {
    const selections = { extensions: [], bundles: [], presets: [{
        id: "pirate", source: "community", approved: true,
        version: "1.1.0", downloadUrl: "https://example.org/pirate.zip",
    }] };
    const f = await fixture(t, { selections });
    const run = async (binary, args, options) => {
        const result = await f.run(binary, args, options);
        if (args[0] === "preset" && args[1] === "add") {
            f.packages.presets[0].source = { kind: "local" };
        }
        return result;
    };
    const deps = { ...f.deps, run };
    assert.equal((await installDesignerSetup(f.project, f.root, f.id, f.hash, deps)).stage, "installed");
    assert.equal((await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, deps)).stage, "ready");
    f.packages.presets[0].source = { kind: "catalog", catalog: "community" };
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, deps),
        /changed after installation/);
});

test("a selected extension alias overwritten in place resolves to its manifest ID", async (t) => {
    const selections = { presets: [], bundles: [{
        id: "kit", source: "community", approved: true,
        version: "2.0.0", downloadUrl: "https://example.org/kit.zip",
    }], extensions: [{
        id: "pirate", source: "community", approved: true,
        version: "1.1.0", downloadUrl: "https://example.org/pirate.zip",
    }] };
    const f = await fixture(t, { selections });
    const run = async (binary, args, options) => {
        const result = await f.run(binary, args, options);
        if (args[0] === "bundle" && args[1] === "install") {
            f.packages.extensions.push({ id: "pirate-full", version: "1.1.0",
                priority: 10, enabled: true, source: { kind: "local" } });
        }
        if (args[0] === "extension" && args[1] === "add" && args[2] === "pirate") {
            f.packages.extensions.find((entry) => entry.id === "pirate-full").source = { kind: "local" };
        }
        return result;
    };
    const deps = { ...f.deps, run, download: async (_url, path) => writeFile(path, "zip") };
    assert.equal((await installDesignerSetup(f.project, f.root, f.id, f.hash, deps)).stage, "installed");
    const record = JSON.parse(await readFile(join(f.root, "speckit-canvas-designer",
        "handoffs", f.id, "setup-record.json"), "utf8"));
    assert.equal(record.selections.extensions[0].id, "pirate-full");
    assert.equal(record.selections.extensions[0].installedSource, "local");
    assert.equal((await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, deps)).stage, "ready");
});

test("ambiguous preinstalled aliases stop instead of guessing a manifest ID", async (t) => {
    const selections = { presets: [], bundles: [{
        id: "kit", source: "community", approved: true,
        version: "2.0.0", downloadUrl: "https://example.org/kit.zip",
    }], extensions: [{
        id: "pirate", source: "community", approved: true,
        version: "1.1.0", downloadUrl: "https://example.org/pirate.zip",
    }] };
    const f = await fixture(t, { selections });
    const run = async (binary, args, options) => {
        const result = await f.run(binary, args, options);
        if (args[0] === "bundle" && args[1] === "install") {
            for (const id of ["pirate-full", "other-full"]) {
                f.packages.extensions.push({ id, version: "1.1.0",
                    priority: 10, enabled: true, source: { kind: "catalog", catalog: "community" } });
            }
        }
        return result;
    };
    await assert.rejects(installDesignerSetup(f.project, f.root, f.id, f.hash, {
        ...f.deps, run, download: async (_url, path) => writeFile(path, "zip"),
    }), /Cannot identify installed extensions manifest for selected catalog pirate/);
    await assert.rejects(access(join(f.root, "speckit-canvas-designer", "handoffs",
        f.id, "setup-record.json")), { code: "ENOENT" });
});

test("finalize rejects missing or incompatible setup records", async (t) => {
    const f = await fixture(t);
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /setup record is missing/);
    await installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps);
    const path = join(f.root, "speckit-canvas-designer", "handoffs", f.id, "setup-record.json");
    const record = JSON.parse(await readFile(path, "utf8"));
    record.handoffHash = "0".repeat(64);
    await writeFile(path, JSON.stringify(record));
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /does not match the frozen handoff/);
});

test("incompatible catalog configuration and absent CLI stop before installation", async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.project, ".specify", "extension-catalogs.yml"),
        `catalogs:\n- name: ${runtimeSettings.copilotCatalogName}\n  url: https://example.org/other.json\n  install_allowed: true\n`);
    await assert.rejects(installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /differs from the approved source/);
    assert.ok(!f.calls.some((args) => args[1] === "add"));
    const missing = await fixture(t);
    await assert.rejects(installDesignerSetup(missing.project, missing.root, missing.id,
        missing.hash, { ...missing.deps, check: async () => {
            const error = new Error("not found");
            error.code = "ENOENT";
            throw error;
        } }), /invoke speckit-cli-setup and retry/);
    assert.deepEqual(missing.calls, []);
});

test("catalog configuration is bounded and cannot be a symlink", async (t) => {
    const f = await fixture(t);
    const config = join(f.project, ".specify", "extension-catalogs.yml");
    await writeFile(config, "x".repeat(65537));
    await assert.rejects(installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /Oversized extension catalog configuration/);
    await rm(config);
    const target = join(f.root, "catalog.yml");
    await writeFile(target, "catalogs: []\n");
    try { await symlink(target, config); }
    catch (error) {
        if (error.code !== "EPERM") throw error;
        t.diagnostic("File symlinks require developer mode on this Windows host");
        return;
    }
    await assert.rejects(installDesignerSetup(f.project, f.root, f.id, f.hash, f.deps),
        /ELOOP|changed while reading|symlink|EINVAL/);
    assert.ok(!f.calls.some((args) => args[1] === "add"));
});

test("local dev-linked skills are detached before presets regenerate them", async (t) => {
    const source = await mkdtemp(join(tmpdir(), "designer-linked-base-"));
    t.after(() => rm(source, { recursive: true, force: true }));
    await writeFile(join(source, "extension.yml"),
        "extension:\n  id: extension-canvas-design\n  name: Local\n  version: 1.0.0\n");
    const original = "## Pages\n- `designer-essentials`\n";
    const target = join(source, "SKILL.md");
    await writeFile(target, original);
    const f = await fixture(t, { selections: { extensions: [], bundles: [], presets: [{
        id: "pirate", source: "community", approved: true, version: "1.1.0",
        downloadUrl: "https://example.org/pirate.zip",
    }] }, localSelections: { extensions: [{
        id: "extension-canvas-design", source: "local", path: source, approved: true,
        version: "1.0.0",
    }] } });
    const probe = join(f.project, "skill-symlink-probe");
    try { await symlink(target, probe); }
    catch (error) {
        if (error.code !== "EPERM") throw error;
        t.skip("File symlinks require developer mode on this Windows host");
        return;
    }
    await rm(probe);
    const run = async (binary, args, options) => {
        const result = await f.run(binary, args, options);
        if (args[0] === "extension" && args[1] === "add") {
            await rm(f.skill);
            await symlink(target, f.skill);
        }
        if (args[0] === "preset" && args[1] === "add") {
            assert.equal((await lstat(f.skill)).isSymbolicLink(), false);
            await writeFile(f.skill, `${original}- \`preset-page\`\n`);
        }
        return result;
    };
    const installed = { ...f.deps, run };
    await installDesignerSetup(f.project, f.root, f.id, f.hash, installed);
    assert.equal((await lstat(f.skill)).isSymbolicLink(), false);
    assert.match(await readFile(f.skill, "utf8"), /preset-page/);
    assert.equal(await readFile(target, "utf8"), original);
});

test("append registration accepts an approved dev-linked preset but not another target", async (t) => {
    const source = await mkdtemp(join(tmpdir(), "designer-linked-preset-"));
    const other = await mkdtemp(join(tmpdir(), "designer-unapproved-preset-"));
    t.after(() => Promise.all([source, other].map((path) =>
        rm(path, { recursive: true, force: true }))));
    const manifest = "preset:\n  id: pirate-full\n  name: Test\n  version: 1.1.0\n"
        + "provides:\n  templates:\n    - type: command\n"
        + "      name: speckit.extension-canvas-design.load-page\n"
        + "      strategy: append\n      file: commands/load-page.md\n";
    for (const root of [source, other]) {
        await mkdir(join(root, "commands"));
        await writeFile(join(root, "preset.yml"), manifest);
        await writeFile(join(root, "commands", "load-page.md"), "## Pages\n- `preset-page`\n");
    }
    const f = await fixture(t, { localSelections: { presets: [{
        id: "pirate-full", source: "local", path: source, approved: true,
    }] } });
    const run = async (binary, args, options) => {
        const result = await f.run(binary, args, options);
        if (args[0] !== "artifact") return result;
        const artifacts = JSON.parse(result.stdout);
        artifacts[0].stack.unshift({ active: true, layer: "preset",
            sourceId: "pirate-full", strategy: "append" });
        return { stdout: JSON.stringify(artifacts) };
    };
    const deps = { ...f.deps, run };
    await installDesignerSetup(f.project, f.root, f.id, f.hash, deps);
    await writeFile(join(f.project, ".specify", "extensions", "extension-canvas-design",
        "scripts", "verify-launch.mjs"),
    "export function declarations(text) { return [...text.matchAll(/`([^`]+)`/g)]"
        + ".map((match) => ({ name: match[1], kind: 'designer.tab-definition' })); }\n");
    await writeFile(f.skill, "## Pages\n- `preset-page`\n");
    const installed = join(f.project, ".specify", "presets", "pirate-full");
    await rm(installed, { recursive: true });
    await symlink(source, installed, process.platform === "win32" ? "junction" : "dir");
    assert.equal((await finalizeDesignerSetup(f.project, f.root, f.id, f.hash, deps)).stage, "ready");
    await writeFile(join(source, "preset.yml"), "x".repeat(65537));
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, deps),
        /Oversized preset manifest: pirate-full/);
    await writeFile(join(source, "preset.yml"), manifest);
    await rm(installed);
    await symlink(other, installed, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(finalizeDesignerSetup(f.project, f.root, f.id, f.hash, deps),
        /differs from its approved source/);
});

test("a catalog source mismatch blocks even a URL-based package install", async (t) => {
    const f = await fixture(t);
    await assert.rejects(installDesignerSetup(f.project, f.root, f.id, f.hash, {
        ...f.deps, run: async (binary, args, options) => {
            const result = await f.run(binary, args, options);
            if (args[0] === "extension" && args[1] === "list") {
                const list = JSON.parse(result.stdout);
                return { stdout: JSON.stringify(list.map((item) => ({
                    ...item, source: { kind: "catalog", catalog: "wrong-source" },
                }))) };
            }
            return result;
        },
    }), /differs from the frozen catalog source/);
});

test("bundle install failure cleans up its temporary download", async (t) => {
    const installed = { extensions: [], presets: [], bundles: [{ id: "kit", version: "2.0.0" }] };
    const locators = { extensions: [], presets: [], bundles: [{
        installedId: "kit", catalogId: "kit", source: "community",
        downloadUrl: "https://example.org/kit.zip",
    }] };
    const f = await fixture(t, { installed, locators });
    let path;
    await assert.rejects(installDesignerSetup(f.project, f.root, f.id, f.hash, {
        ...f.deps,
        download: async (_url, target) => {
            path = target;
            await writeFile(target, "zip");
        },
        run: async (binary, args, options) => {
            if (args[0] === "bundle" && args[1] === "install") throw new Error("bundle rejected");
            return f.run(binary, args, options);
        },
    }), /bundle rejected/);
    await assert.rejects(access(path), { code: "ENOENT" });
});

test("real Specify composes commands and resolves templates in a fresh child", {
    skip: process.env.SPECIFY_E2E !== "1",
}, async (t) => {
    const project = await mkdtemp(join(tmpdir(), "designer-real-child-"));
    const root = await mkdtemp(join(tmpdir(), "designer-real-session-"));
    t.after(() => Promise.all([rm(project, { recursive: true, force: true }),
        rm(root, { recursive: true, force: true })]));
    const source = fileURLToPath(new URL("../../../../../spec-kit-extensions/extension-canvas-design/", import.meta.url))
        .replace(/[\\/]$/, "");
    const preset = fileURLToPath(new URL("../../../../../tests/fixtures/test-presets/copilot-canvas-design-test/", import.meta.url))
        .replace(/[\\/]$/, "");
    const id = randomUUID();
    const handoff = buildDesignerHandoff({
        catalog: baseCatalog, pipeline: [{ id: "plan" }],
    }, empty, { extensions: [{ id: "extension-canvas-design", source: "local",
        path: source, approved: true }],
    presets: [{ id: "copilot-canvas-design-test", source: "local",
        path: preset, approved: true }] }, empty, id, empty);
    const json = JSON.stringify(handoff);
    const hash = createHash("sha256").update(json).digest("hex");
    const directory = join(root, "speckit-canvas-designer", "handoffs", id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "handoff.json"), json);
    const installed = await installDesignerSetup(project, root, id, hash);
    assert.equal(installed.stage, "installed");
    assert.ok(installed.timings.init >= 0);
    const ready = await finalizeDesignerSetup(project, root, id, hash);
    assert.equal(ready.stage, "ready");
    assert.ok(ready.openInput.pages.some((entry) => entry.name === "designer-essentials"));
    assert.ok(ready.openInput.pages.some((entry) => entry.name === "canvas-settings-pr1-test"));
    assert.ok(ready.openInput.templates.some((entry) => entry.name === "canvas-contribution-pr1-test"));
    assert.ok(ready.openInput.templates.some((entry) => entry.name === "generated-workflow"));
    t.diagnostic(`Specify child stages (ms): ${JSON.stringify({
        ...installed.timings, ...ready.timings,
    })}`);
    const skill = join(project, ".github", "skills", "speckit-extension-canvas-design-load-page", "SKILL.md");
    await writeFile(skill, (await readFile(skill, "utf8"))
        .replace("`canvas-settings-pr1-test`", "`missing-page`"));
    await assert.rejects(finalizeDesignerSetup(project, root, id, hash),
        /registration canvas-settings-pr1-test is missing from Specify's composed command/);
});
