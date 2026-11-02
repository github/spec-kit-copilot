import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { MarkdownReader } from "../src/MarkdownReader/MarkdownReader.tsx";
import { mountMarkdownReader } from "../src/mount.tsx";
import type { MountedReader } from "../src/types.ts";
import { readerOptions } from "./reader-fixture.ts";

test("successful whitespace reads present empty rather than ready", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(MarkdownReader, { options: readerOptions(" \r\n\t") })));
    try {
        assert.equal(dom.window.document.querySelector("[data-reader-state]")?.getAttribute("data-reader-state"), "empty");
        assert.match(dom.window.document.querySelector('[role="status"]')?.textContent ?? "", /empty/i);
        assert.equal(dom.window.document.querySelector(".md-reader__article"), null);
        assert.ok(dom.window.document.querySelector('select[aria-label="Artifacts"]'));
    } finally { dom.window.close(); }
});

test("successful headingless reads present no-heading with full content and no empty TOC", () => {
    const content = "A complete document without headings.\n\n- A list\n";
    const dom = new JSDOM(renderToStaticMarkup(createElement(MarkdownReader, { options: readerOptions(content) })));
    try {
        assert.equal(dom.window.document.querySelector("[data-reader-state]")?.getAttribute("data-reader-state"), "no-heading");
        assert.ok(dom.window.document.querySelector(".md-reader__article")?.textContent.includes("A complete document without headings."));
        assert.equal(dom.window.document.querySelector('[aria-label="Table of contents"]'), null);
    } finally { dom.window.close(); }
});

test("changed and disconnected notices keep the last validated content visibly stale", () => {
    const options = { ...readerOptions("# Last validated\n"), state: "changed" as const, connectionState: "disconnected" as const };
    const dom = new JSDOM(renderToStaticMarkup(createElement(MarkdownReader, { options })));
    try {
        assert.equal(dom.window.document.querySelector("[data-reader-state]")?.getAttribute("data-reader-state"), "changed");
        assert.match(dom.window.document.body.textContent ?? "", /Disconnected/);
        assert.match(dom.window.document.body.textContent ?? "", /stale/);
        assert.ok(dom.window.document.querySelector(".md-reader__article")?.textContent.includes("Last validated"));
    } finally { dom.window.close(); }
});

test("mount rejects contradictory base-state and document combinations", async () => {
    const dom = new JSDOM('<div id="scroll"><div id="mount"></div></div>');
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const element = dom.window.document.getElementById("mount") as HTMLElement;
    const options = { ...readerOptions("# Current\n"), scrollElement: element.parentElement! };
    let handle: MountedReader | undefined;
    try {
        for (const state of ["idle", "loading", "missing", "deleted", "unsupported", "error", "empty"] as const) {
            await act(async () => {
                assert.throws(() => { handle = mountMarkdownReader(element, { ...options, state }); }, /state|empty/i, `${state} must reject incompatible content`);
            });
        }
    } finally {
        await act(async () => handle?.unmount());
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        dom.window.close();
    }
});
