import assert from "node:assert/strict";
import { test } from "node:test";

import { canvasDesignSections } from "../ui/modals.js";

test("Generate design area separates eligible packages and errors from runtime catalog", () => {
    const snapshot = { catalog: {
        presets: [
            { id: "canvas-theme", name: "Canvas Theme", design: true, active: true },
            { id: "runtime", name: "Runtime", design: false, designError: "Unreadable runtime manifest" },
        ],
        extensions: [
            { id: "design-support", name: "Design Support", design: true },
            { id: "bad-tag", name: "Bad Tag", design: false, tags: ["canvas-design"],
                designError: "Tags disagree" },
            { id: "pipeline-canvas-generator", name: "Generator", design: true },
        ],
        bundles: [{ id: "mixed", name: "Mixed Bundle", design: false,
            tags: ["canvas-design"], designError: "Bundle member is not design-only" }],
    } };
    const sections = canvasDesignSections(snapshot, "CANVAS");
    assert.deepEqual(sections.map(([, kind, entries]) => [kind, entries.map((item) => item.id)]), [
        ["preset", ["canvas-theme"]], ["extension", []], ["bundle", []],
    ]);
    const all = canvasDesignSections(snapshot);
    assert.deepEqual(all.map(([, , entries]) => entries.map((entry) => entry.id)), [
        ["canvas-theme"], ["design-support", "bad-tag"], ["mixed"],
    ]);
    assert.equal(snapshot.catalog.extensions[1].design, false);
});
