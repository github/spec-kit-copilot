import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWorkflowSlug } from "../generation/generated-canvas-template/ui/workflow-slug.mjs";
import { workflowPath } from "../generation/generated-canvas-template/workspace-files.mjs";

test("workflow slugs allow automatic naming and trim without changing case", () => {
    for (const value of [undefined, null, "", " \t\n", "a", "1", "a-1", "my-workflow", "  my-workflow \n", "con-project", "com10", "lpt0"]) {
        assert.deepEqual(validateWorkflowSlug(value), { slug: String(value ?? "").trim(), error: "" });
    }
});

test("workflow slugs reject invalid formats with fixed, non-reflective guidance", () => {
    for (const value of ["My-workflow", "two words", "a_b", "-a", "a-", "a--b", "é", "🎉", "../a", "a/b", "a\\b", "con.txt", "<script>", "a\nb"]) {
        assert.deepEqual(validateWorkflowSlug(value), {
            slug: value,
            error: "Use lowercase letters, numbers, and single hyphens only.",
        });
    }
});

test("Windows reserved slugs are rejected on every host consistently with workspace paths", () => {
    const reserved = ["con", "prn", "aux", "nul", ...Array.from({ length: 9 }, (_, i) => [`com${i + 1}`, `lpt${i + 1}`]).flat()];
    for (const slug of reserved) {
        assert.deepEqual(validateWorkflowSlug(` ${slug} `), {
            slug,
            error: "This name is reserved on Windows. Choose another workflow slug.",
        });
        assert.throws(() => workflowPath(`items/${slug}/spec.md`), /invalid workflow path/);
    }
});
