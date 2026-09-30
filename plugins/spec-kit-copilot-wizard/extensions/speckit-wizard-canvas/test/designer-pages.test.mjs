import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { buildDesignerHandoff } from "../server/handlers-designer.mjs";
import { assertPageCommand, loadDesignerPages, storeDesignerPages } from "../../speckit-canvas-designer/pages.mjs";
import { readDesignSource } from "../../speckit-canvas-designer/source.mjs";

const runFile = promisify(execFile);
const source = await readDesignSource();
const defaults = ["setup", "artifacts", "appearance", "results"];
async function fixture(t, install = true) {
    const root = await mkdtemp(join(tmpdir(), "designer-pages-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const checkout = join(root, "child with spaces");
    const workspace = join(root, "session-state", randomUUID());
    const handoff = buildDesignerHandoff({
        pipeline: [{ id: "plan" }],
        catalog: { designerSource: { available: true, extension: source } },
    }, { presets: [], extensions: [{ id: "canvas-design", source: "copilot", approved: true,
        version: source.version, downloadUrl: null }], bundles: [] });
    const folder = join(workspace, "speckit-canvas-designer", "handoffs", handoff.handoffId);
    await mkdir(checkout, { recursive: true });
    await mkdir(folder, { recursive: true });
    const text = JSON.stringify(handoff);
    await writeFile(join(folder, "handoff.json"), text);
    const packageRoot = join(checkout, ".specify", "extensions", "canvas-design");
    if (install) await cp(source.path, packageRoot, { recursive: true });
    const paths = defaults.map((page) => ({
        name: `canvas-settings-${page}`, path: join(packageRoot, "pages", `${page}.json`),
    }));
    return { root, checkout, workspace, handoff, folder, text, paths,
        store: (entries = paths, current) => storeDesignerPages(handoff, workspace, checkout, entries, current),
        load: () => loadDesignerPages(handoff, workspace, checkout) };
}

test("agent-resolved pages persist before opening, without setup receipts or CLI resolution", async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.load(), /run speckit-canvas-design-load-page first/);
    const model = await f.store();
    assert.deepEqual(model.pages.map((page) => page.title),
        ["Essentials", "Artifacts", "Appearance", "Result Badges"]);
    assert.deepEqual(model.pages.map((page) => page.id), f.paths.map((p) => p.name));
    assert.equal(model.constraints["canvas.id"].maxLength, 100);
    assert.equal(model.values["workflowSlug.userProvided"], false);
    assert.deepEqual(JSON.parse(JSON.stringify(await f.load())), JSON.parse(JSON.stringify(model)));
    const reloaded = await f.store();
    assert.notEqual(reloaded.revision, model.revision, "each successful reload replaces transient drafts");
    await assert.rejects(lstat(join(f.folder, "setup.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
    await writeFile(f.paths[0].path, "{broken");
    assert.equal((await f.load()).revision, reloaded.revision, "reopen uses validated state, not source resolution");
    await assert.rejects(f.store(), /Invalid Designer JSON/);
    assert.equal((await f.load()).revision, reloaded.revision, "failed reload preserves the last model");
});

test("safe additional page names, disabled pages and deterministic order work without a fixed whitelist", async (t) => {
    const f = await fixture(t);
    const extra = { name: "custom-accessibility", path: join(f.checkout, ".specify", "extra.json") };
    const doc = { schemaVersion: 1, id: extra.name, title: "Accessibility", order: 5, fields: [
        { id: "constructor", label: "Safe object key", type: "boolean", default: true },
    ] };
    await writeFile(extra.path, JSON.stringify(doc));
    const model = await f.store([...f.paths, extra]);
    assert.equal(model.pages[0].id, extra.name);
    assert.equal(model.values.constructor, true);
    await writeFile(extra.path, JSON.stringify({ ...doc, enabled: false }));
    assert.equal((await f.store([...f.paths, extra])).pages.length, 4);
    await assert.rejects(f.store([f.paths[1]]), /Canvas ID and Title/);
});

test("invalid batches are rejected atomically", async (t) => {
    const f = await fixture(t);
    const original = await f.store();
    const page = JSON.parse(await readFile(f.paths[1].path, "utf8"));
    for (const [patch, message] of [
        [{ id: "wrong-id" }, /does not match/],
        [{ schemaVersion: 2 }, /schema version/],
        [{ order: 1.5 }, /expected integer/],
        [{ unknown: true }, /unsupported property/],
        [{ fields: [{ id: "canvas.id", label: "Duplicate" }] }, /Duplicate enabled field/],
        [{ fields: [{ id: "extra", label: "Invalid", type: "boolean", default: "true" }] }, /expected boolean/],
        [{ fields: [{ id: "extra", label: "Wrong default", default: true }] }, /invalid field/],
        [{ fields: [{ id: "canvas.id", label: "Wrong type", type: "boolean" }] }, /invalid field/],
    ]) {
        await writeFile(f.paths[1].path, JSON.stringify({ ...page, ...patch }));
        await assert.rejects(f.store(), message);
        assert.equal((await f.load()).revision, original.revision);
    }
    await writeFile(f.paths[1].path, JSON.stringify(page));
    await assert.rejects(f.store([...f.paths, f.paths[1]]), /duplicate Designer page/);
    await assert.rejects(f.store([]), /between 1 and 100/);
    await assert.rejects(f.store(Array(101).fill(f.paths[0])), /between 1 and 100/);
    await assert.rejects(f.store([{ name: "../escape", path: f.paths[0].path }]), /Invalid Designer page/);
    await assert.rejects(f.store(f.paths, () => false), /superseded/);
    assert.equal((await f.load()).revision, original.revision);
});

test("loader rejects non-JSON, unsafe, oversized and malformed files", async (t) => {
    const f = await fixture(t);
    const outside = join(f.root, "outside.json");
    const json = await readFile(f.paths[0].path);
    await writeFile(outside, json);
    await assert.rejects(f.store([{ ...f.paths[0], path: outside }]), /escapes/);
    const markdown = join(f.checkout, ".specify", "override.md");
    await writeFile(markdown, json);
    await assert.rejects(f.store([{ ...f.paths[0], path: markdown }]), /must be .json/);
    await writeFile(f.paths[0].path, Buffer.from([0xff, 0xfe]));
    await assert.rejects(f.store(), /Invalid Designer JSON/);
    await writeFile(f.paths[0].path, " ".repeat(256 * 1024 + 1));
    await assert.rejects(f.store(), /oversized/);
    await rm(f.paths[0].path);
    await mkdir(f.paths[0].path);
    await assert.rejects(f.store());
    await rm(f.paths[0].path, { recursive: true });
    await assert.rejects(f.store(), { code: "ENOENT" });
    const target = join(f.checkout, ".specify", "linked");
    await symlink(f.root, target, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(f.store([{ ...f.paths[0], path: join(target, "outside.json") }]), /escapes/);
    await rm(target);
});

test("saved models remain bound to their handoff, project and schema", async (t) => {
    const f = await fixture(t);
    await f.store();
    const path = join(f.folder, "pages.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    for (const changed of [
        { ...saved, handoffId: "other" }, { ...saved, checkout: f.root },
        { ...saved, sourceFingerprint: "0".repeat(64) }, { ...saved, schemaVersion: 2 },
    ]) {
        await writeFile(path, JSON.stringify(changed));
        await assert.rejects(f.load(), /another handoff or project/);
    }
    saved.entries[0].document.unknown = true;
    await writeFile(path, JSON.stringify(saved));
    await assert.rejects(f.load(), /unsupported property/);
    await assert.rejects(storeDesignerPages({ ...f.handoff,
        requiredExtension: { ...source, fingerprint: "0".repeat(64) } },
    f.workspace, f.checkout, f.paths), /source changed/);
});

test("real CLI resolves defaults, replacements and appended additional pages", {
    skip: !process.env.DESIGNER_CLI_TESTS, timeout: 120000,
}, async (t) => {
    const f = await fixture(t, false);
    const run = (args) => runFile("specify", args, {
        cwd: f.checkout, env: { ...process.env, PYTHONUTF8: "1", COLUMNS: "500", NO_COLOR: "1" },
        timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    const resolvePage = async (name) => {
        const { stdout } = await run(["preset", "resolve", name]);
        const line = stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s.startsWith(`${name}:`));
        assert.ok(line, stdout);
        const path = line.slice(name.length + 1).trim();
        assert.notEqual(path, "not found", stdout);
        return { name, path };
    };
    await run(["init", "--here", "--force", "--non-interactive", "--integration", "copilot",
        "--integration-options=--skills", "--script", process.platform === "win32" ? "ps" : "sh",
        "--ignore-agent-tools"]);
    await assert.rejects(assertPageCommand(f.checkout));
    await run(["extension", "add", source.path, "--dev"]);
    await assertPageCommand(f.checkout);
    const skillPath = join(f.checkout, ".github", "skills", "speckit-canvas-design-load-page", "SKILL.md");
    assert.match(await readFile(skillPath, "utf8"), /speckit_designer_load_pages/);
    const paths = [];
    for (const page of f.paths) paths.push(await resolvePage(page.name));
    assert.equal(await realpath(paths[0].path), await realpath(f.paths[0].path));
    await f.store(paths);
    const preset = join(f.root, "copilot-canvas-probe");
    await mkdir(join(preset, "pages"), { recursive: true });
    await mkdir(join(preset, "commands"), { recursive: true });
    await writeFile(join(preset, "preset.yml"), `schema_version: "1.0"
preset:
  id: copilot-canvas-probe
  name: Copilot Canvas Probe
  version: "1.0.0"
  description: Test command composition and page resolution.
requires:
  speckit_version: ">=1.0.7"
  extensions: [canvas-design]
provides:
  templates:
    - type: template
      name: canvas-settings-appearance
      file: pages/appearance.json
    - type: template
      name: canvas-settings-accessibility
      file: pages/accessibility.json
    - type: command
      name: speckit.canvas-design.load-page
      file: commands/load-page.md
      strategy: append
`);
    const appearance = { schemaVersion: 1, id: "canvas-settings-appearance",
        title: "Preset appearance", order: 30, fields: [] };
    await writeFile(join(preset, "pages", "appearance.json"), JSON.stringify(appearance));
    await writeFile(join(preset, "pages", "accessibility.json"), JSON.stringify({
        ...appearance, id: "canvas-settings-accessibility", title: "Accessibility", order: 50,
    }));
    await writeFile(join(preset, "commands", "load-page.md"),
        "## Additional Designer pages\n\n- `canvas-settings-accessibility`\n");
    await run(["preset", "add", "--dev", preset]);
    assert.match(await readFile(skillPath, "utf8"), /^## Additional Designer pages/m);
    const replacement = await resolvePage("canvas-settings-appearance");
    assert.match(replacement.path, /presets[\\/]copilot-canvas-probe[\\/]pages[\\/]appearance\.json/);
    paths[2] = replacement;
    paths.push(await resolvePage("canvas-settings-accessibility"));
    const model = await f.store(paths);
    assert.equal(model.pages[2].title, "Preset appearance");
    assert.equal(model.pages[4].title, "Accessibility");
    await writeFile(replacement.path, "{broken");
    await assert.rejects(f.store(paths), /Invalid Designer JSON/);
    assert.equal((await f.load()).revision, model.revision);
    const missing = await run(["preset", "resolve", "canvas-settings-missing"]);
    assert.match(missing.stdout, /not found/);
    await run(["preset", "remove", "copilot-canvas-probe"]);
    assert.doesNotMatch(await readFile(skillPath, "utf8"), /^## Additional Designer pages/m);
    const restored = await resolvePage("canvas-settings-appearance");
    assert.match(restored.path, /extensions[\\/]canvas-design[\\/]pages[\\/]appearance\.json/);
    await assert.rejects(lstat(join(f.folder, "setup.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(f.folder, "handoff.json"), "utf8"), f.text);
});
