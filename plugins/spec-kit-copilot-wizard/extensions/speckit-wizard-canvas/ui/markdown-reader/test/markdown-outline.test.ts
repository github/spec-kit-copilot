import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { test } from "node:test";

async function outline(markdown: string, readerId = "outline-fixture") {
    const module = await import("../src/MarkdownReader/markdownOutline.ts").catch((error: { code?: string }) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T044: one-pass outline transform is missing");
        throw error;
    });
    const result = module.createMarkdownOutline(readerId);
    let passes = 0;
    const count = () => () => { passes++; };
    const html = renderToStaticMarkup(Markdown({ children: markdown, skipHtml: true, remarkPlugins: [count, result.plugin] }));
    return { headings: result.headings, html, passes };
}

test("outline derives ATX and Setext headings from the rendering parse", async () => {
    const result = await outline("# Title\n\nSection\n-------\n\n### *Rich* `code` [label](page.md)\n");
    assert.equal(result.passes, 1);
    assert.deepEqual(result.headings.map((heading) => [heading.label, heading.depth, heading.logicalSlug]), [
        ["Title", 1, "title"], ["Section", 2, "section"], ["Rich code label", 3, "rich-code-label"],
    ]);
    for (const heading of result.headings) assert.ok(result.html.includes(`id="${heading.domId}"`));
});

test("outline uses stateful collision handling for duplicate and pre-suffixed headings", async () => {
    const result = await outline("# A\n\n# A\n\n# A-1\n\n# A\n");
    assert.deepEqual(result.headings.map((heading) => heading.logicalSlug), ["a", "a-1", "a-1-1", "a-2"]);
    assert.equal(new Set(result.headings.map((heading) => heading.domId)).size, 4);
});

test("outline excludes code and comments and gives empty bases a collision-safe section fallback", async () => {
    const result = await outline("#\n\n# !!!\n\n# section\n\n```md\n# Hidden fence\n```\n\n    # Hidden indent\n\n<!--\n# Hidden comment\n-->\n");
    assert.deepEqual(result.headings.map((heading) => heading.logicalSlug), ["section", "section-1", "section-2"]);
    assert.ok(result.headings.every((heading) => !heading.label.includes("Hidden")));
});

test("outline preserves Unicode and namespaces targets independently for each reader", async () => {
    const content = "# Caf\u00e9\n\n## \u65e5\u672c\u8a9e\n";
    const first = await outline(content, "reader-one");
    const second = await outline(content, "reader-two");
    assert.deepEqual(first.headings.map((heading) => heading.logicalSlug), ["caf\u00e9", "\u65e5\u672c\u8a9e"]);
    assert.deepEqual(first.headings.map((heading) => heading.logicalSlug), second.headings.map((heading) => heading.logicalSlug));
    assert.ok(first.headings.every((heading, index) => heading.domId !== second.headings[index]?.domId));
});
