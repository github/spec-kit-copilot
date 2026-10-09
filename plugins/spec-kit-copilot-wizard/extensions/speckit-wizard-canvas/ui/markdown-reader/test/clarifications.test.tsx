import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { MarkdownReader } from "../src/MarkdownReader/MarkdownReader.tsx";
import type { ClarificationDescriptor } from "../src/types.ts";
import { readerOptions } from "./reader-fixture.ts";

const markdown = "# Questions\n\n[NEEDS CLARIFICATION: Which scope?]\n\n`[NEEDS CLARIFICATION: Code question?]`\n\n<!-- [NEEDS CLARIFICATION: Comment?] -->\n\n[NEEDS CLARIFICATION: Unbound question?]\n";

function optionsWithBindings() {
    const options = readerOptions(markdown);
    const descriptors: ClarificationDescriptor[] = [
        { id: "binding_scope", questionId: "question_scope", question: "Which scope?", artifactId: options.document!.artifact.id, revision: options.document!.revision, commandName: "speckit.specify", mode: "wizard-batched" },
        { id: "binding_code", questionId: "question_code", question: "Code question?", artifactId: options.document!.artifact.id, revision: options.document!.revision, commandName: "speckit.specify", mode: "wizard-batched" },
        { id: "binding_comment", questionId: "question_comment", question: "Comment?", artifactId: options.document!.artifact.id, revision: options.document!.revision, commandName: "speckit.specify", mode: "wizard-batched" },
    ];
    return { ...options, clarifications: descriptors, onClarification() {} };
}

test("reader creates controls only for bound prose markers, never code, comments, or unbound text", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(MarkdownReader, { options: optionsWithBindings() })));
    try {
        const controls = dom.window.document.querySelectorAll(".md-reader__article [data-clarification-id]");
        assert.equal(controls.length, 1);
        assert.equal(controls[0]?.getAttribute("data-clarification-id"), "binding_scope");
        assert.ok(dom.window.document.querySelector("code")?.textContent.includes("Code question?"));
    } finally { dom.window.close(); }
});

test("reader rejects stale or foreign clarification bindings and source-controlled callback markup", () => {
    const options = optionsWithBindings();
    options.clarifications = options.clarifications.map((descriptor, index) => index === 0
        ? { ...descriptor, revision: `sha256:${"0".repeat(64)}` }
        : { ...descriptor, artifactId: "foreign_artifact" });
    const dom = new JSDOM(renderToStaticMarkup(createElement(MarkdownReader, { options })));
    try { assert.equal(dom.window.document.querySelectorAll(".md-reader__article button").length, 0); }
    finally { dom.window.close(); }
});

test("trusted clarification button calls only the host callback with its descriptor id", async () => {
    const dom = new JSDOM('<div id="reader"></div>', { pretendToBeVisual: true });
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const root = createRoot(dom.window.document.getElementById("reader")!);
    const received: string[] = [];
    const options = { ...optionsWithBindings(), scrollElement: dom.window.document.body, onClarification: (id: string) => received.push(id) };
    try {
        await act(async () => root.render(createElement(MarkdownReader, { options })));
        const button = dom.window.document.querySelector<HTMLButtonElement>('[data-clarification-id="binding_scope"]');
        assert.ok(button, "T069: trusted clarification control is missing");
        await act(async () => button.click());
        assert.deepEqual(received, ["binding_scope"]);
    } finally {
        await act(async () => root.unmount());
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        dom.window.close();
    }
});
