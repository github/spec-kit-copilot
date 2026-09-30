import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { newInstance } from "../canvas-runtime/instances.mjs";
import { snapshot } from "../canvas-runtime/snapshot.mjs";

test("loaded empty preset, extension and bundle catalogs make Designer launch-ready", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "designer-snapshot-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const inst = newInstance("empty-designer-catalog");
    inst.workspacePath = root;

    const before = await snapshot(inst);
    assert.equal(before.catalog.extensions, undefined);
    assert.equal(before.catalog.bundles, undefined);
    assert.equal(before.catalog.designerFingerprint, undefined);

    inst.cachedExtensionItems = [];
    const partial = await snapshot(inst);
    assert.deepEqual(partial.catalog.extensions, []);
    assert.equal(partial.catalog.designerFingerprint, undefined);

    inst.cachedBundleItems = [];
    const withoutPresets = await snapshot(inst);
    assert.ok(Array.isArray(withoutPresets.catalog.presets));
    assert.equal(withoutPresets.catalog.designerFingerprint, undefined);

    inst.cachedPresetItems = [];
    const ready = await snapshot(inst);
    assert.ok(Array.isArray(ready.catalog.presets));
    assert.deepEqual(ready.catalog.extensions, []);
    assert.deepEqual(ready.catalog.bundles, []);
    assert.equal(typeof ready.catalog.designerFingerprint, "string");

    inst.cachedExtensionItems.push({
        id: "design-extension", source: "copilot", tags: ["canvas-design"],
    });
    const updated = await snapshot(inst);
    assert.notEqual(updated.catalog.designerFingerprint, ready.catalog.designerFingerprint);
    assert.deepEqual(ready.catalog.extensions, []);
});
