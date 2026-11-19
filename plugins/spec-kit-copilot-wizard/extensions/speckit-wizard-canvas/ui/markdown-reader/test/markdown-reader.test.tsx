import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { readerOptions } from "./reader-fixture.ts";

async function component() {
    const module = await import("../src/MarkdownReader/MarkdownReader.tsx").catch((error: { code?: string }) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T045: safe Markdown reader component is missing");
        throw error;
    });
    return module.MarkdownReader;
}

test("reader renders Markdown and GFM with disabled task controls and contained tables/code", async () => {
    const Reader = await component();
    const markdown = "# Title\n\n## Section\n\n**Bold** and *emphasis* and ~~removed~~.\n\n- [x] Done\n- [ ] Pending\n\n1. First\n2. Second\n\n> Quoted text\n\n| Name | Value |\n| --- | --- |\n| One | `code` |\n\n```js\nconst example = 1;\n```\n";
    const dom = new JSDOM(renderToStaticMarkup(createElement(Reader, { options: readerOptions(markdown) })));
    try {
        const article = dom.window.document.querySelector(".md-reader__article")!;
        for (const selector of ["h1", "h2", "strong", "em", "del", "ul", "ol", "blockquote", "table", "pre code"]) assert.ok(article.querySelector(selector), selector);
        const inputs = [...article.querySelectorAll("input")];
        assert.equal(inputs.length, 2);
        assert.ok(inputs.every((input) => input.disabled));
        assert.equal(inputs[0]?.checked, true);
        assert.equal(inputs[1]?.checked, false);
        assert.ok(article.querySelector(".md-reader__table-scroll table"));
    } finally { dom.window.close(); }
});

test("reader excludes raw HTML and replaces every image with non-requesting accessible text", async () => {
    const Reader = await component();
    const markdown = '# Safe\n\n<script>window.intrusion=true</script>\n\n<img src="https://example.invalid/hidden.png">\n\n![Remote description](https://example.invalid/photo.png)\n\n![Local description](../photo.png)\n\n<button onclick="alert(1)">Run</button>\n';
    const dom = new JSDOM(renderToStaticMarkup(createElement(Reader, { options: readerOptions(markdown) })));
    try {
        const article = dom.window.document.querySelector(".md-reader__article")!;
        assert.equal(article.querySelectorAll("img,script,iframe,button,[src]").length, 0);
        assert.equal(article.querySelectorAll('[role="img"]').length, 2);
        assert.ok(article.textContent.includes("Remote description"));
        assert.ok(article.textContent.includes("Local description"));
        assert.ok(!article.innerHTML.includes("onclick"));
    } finally { dom.window.close(); }
});

test("reader exposes only trusted supported links while unsafe schemes remain inert", async () => {
    const Reader = await component();
    const markdown = '# Links\n\n[Local](research.md#findings) [Web](https://example.invalid/) [Script](javascript:alert%281%29) [Data](data:text/html,unsafe) [File](file:///private.md) [Protocol relative](//example.invalid/)\n';
    const dom = new JSDOM(renderToStaticMarkup(createElement(Reader, { options: readerOptions(markdown) })));
    try {
        const links = [...dom.window.document.querySelectorAll(".md-reader__article a")];
        assert.equal(links.length, 2);
        assert.deepEqual(links.map((link) => link.textContent), ["Local", "Web"]);
        assert.ok(links.every((link) => !/^(javascript:|data:|file:|\/\/)/.test(link.getAttribute("href") ?? "")));
    } finally { dom.window.close(); }
});

test("two readers namespace every heading and footnote target and reference", async () => {
    const Reader = await component();
    const markdown = "# Duplicate\n\nA note[^same].\n\n## Duplicate\n\n[^same]: Footnote text.\n";
    const html = renderToStaticMarkup(createElement(Fragment, null,
        createElement(Reader, { options: readerOptions(markdown, "reader-one") }),
        createElement(Reader, { options: readerOptions(markdown, "reader-two") })));
    const dom = new JSDOM(html);
    try {
        const document = dom.window.document;
        const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
        assert.equal(new Set(ids).size, ids.length);
        for (const root of document.querySelectorAll("[data-reader-id]")) {
            const prefix = `${root.getAttribute("data-reader-id")}-`;
            for (const element of root.querySelectorAll("[id]")) assert.ok(element.id.startsWith(prefix));
            for (const anchor of root.querySelectorAll('a[data-footnote-ref],a[data-footnote-backref]')) {
                const id = anchor.getAttribute("href")?.slice(1);
                assert.ok(id?.startsWith(prefix));
                assert.ok([...root.querySelectorAll("[id]")].some((element) => element.id === id));
            }
        }
    } finally { dom.window.close(); }
});

test("reader keeps artifact controls available across every non-document state", async () => {
    const Reader = await component();
    for (const state of ["idle", "loading", "missing", "deleted", "unsupported", "empty", "error"] as const) {
        const options = { ...readerOptions("# Source"), state, document: undefined };
        const dom = new JSDOM(renderToStaticMarkup(createElement(Reader, { options })));
        try {
            assert.ok(dom.window.document.querySelector('select[aria-label="Artifacts"]'));
            assert.ok(dom.window.document.querySelector('[role="status"]')?.textContent);
            assert.equal(dom.window.document.querySelector(".md-reader__article"), null);
            assert.equal(dom.window.document.querySelector("[data-reader-state]")?.getAttribute("data-reader-state"), state);
        } finally { dom.window.close(); }
    }
});
