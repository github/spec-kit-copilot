import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../workflow-ui/markdown.mjs";
import { renderMarkdown as wizardMarkdown } from "../ui/modals.js";

test("Wizard and generated artifacts use the same renderer", () => {
    assert.equal(wizardMarkdown, renderMarkdown);
});

test("hides complete comments without joining surrounding fragments", () => {
    assert.equal(renderMarkdown("<!-- hidden\nmetadata -->\r\n# Title"), "<h1>Title</h1>");
    assert.equal(renderMarkdown("before<!-- hidden -->after"), "<p>before after</p>");
    assert.equal(renderMarkdown("<!-- first --><!-- second -->"), "");
    assert.equal(renderMarkdown("<!<!-- hidden -->--text-->"), "<p>&lt;! --text--&gt;</p>");
    assert.equal(renderMarkdown("<scr<!-- hidden -->ipt>alert(1)</script>"),
        "<p>&lt;scr ipt&gt;alert(1)&lt;/script&gt;</p>");
});

test("escapes malformed and nested comment remnants", () => {
    for (const source of [
        "<!-- unfinished <img src=x onerror=alert(1)>",
        "<!-- outer <!-- inner --> <img src=x onerror=alert(1)> -->",
        "<!--> <img src=x onerror=alert(1)>",
    ]) {
        const html = renderMarkdown(source);
        assert.doesNotMatch(html, /<!--|<img/);
        assert.match(html, /&lt;img/);
    }
});

test("preserves Markdown rendering and escapes HTML in text, links and fenced code", () => {
    assert.equal(renderMarkdown("# Title\r\n\r\n**bold** and *italic* and `code`"),
        "<h1>Title</h1>\n<p><strong>bold</strong> and <em>italic</em> and <code>code</code></p>");
    assert.equal(renderMarkdown('<img src=x onerror="alert(1)">'),
        "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
    assert.equal(renderMarkdown('[<img>](https://example.com)'),
        '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">&lt;img&gt;</a></p>');
    assert.equal(renderMarkdown("```html\n<script>alert(1)</script>\n```"),
        '<pre><code class="language-html">&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
});
