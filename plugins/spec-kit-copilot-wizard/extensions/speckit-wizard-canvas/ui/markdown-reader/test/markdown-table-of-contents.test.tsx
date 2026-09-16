import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

const headings = [
    { domId: "toc-fixture-heading-title", logicalSlug: "title", label: "Title", depth: 1, order: 0 },
    { domId: "toc-fixture-heading-purpose", logicalSlug: "purpose", label: "Purpose", depth: 2, order: 1 },
];

async function headingTools() {
    return import("../src/MarkdownReader/useActiveMarkdownHeading.ts").catch((error: { code?: string }) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T046: scoped active-heading observation is missing");
        throw error;
    });
}

test("active heading uses the explicit scroller's 25-percent reading line", async () => {
    const { activeHeadingAt } = await headingTools();
    const positions = [{ logicalSlug: "first", top: 0 }, { logicalSlug: "second", top: 150 }, { logicalSlug: "third", top: 500 }];
    assert.equal(activeHeadingAt(positions, 0, 400), "first");
    assert.equal(activeHeadingAt(positions, 60, 400), "second");
    assert.equal(activeHeadingAt(positions, 405, 400), "third");
    assert.equal(activeHeadingAt([], 0, 400), null);
});

test("heading observer scopes lookup and cleans scroll, resize, and animation-frame work", async () => {
    const { observeMarkdownHeadings } = await headingTools();
    const dom = new JSDOM('<h1 id="outside">Outside</h1><div id="scroll"><div id="reader"><h1 id="toc-fixture-heading-title" data-reader-heading>Title</h1><h2 id="toc-fixture-heading-purpose" data-reader-heading>Purpose</h2></div></div>');
    const scroll = dom.window.document.getElementById("scroll") as HTMLElement;
    const reader = dom.window.document.getElementById("reader") as HTMLElement;
    Object.defineProperty(scroll, "clientHeight", { value: 400 });
    scroll.getBoundingClientRect = () => ({ top: 0, height: 400, width: 900 } as DOMRect);
    for (const [index, element] of [...reader.querySelectorAll<HTMLElement>("[data-reader-heading]")].entries()) {
        element.getBoundingClientRect = () => ({ top: index * 150 - scroll.scrollTop, height: 30 } as DOMRect);
    }
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    let disconnected = 0;
    let cancelled = 0;
    class ResizeObserverMock {
        observe() {}
        disconnect() { disconnected++; }
    }
    const active: Array<string | null> = [];
    const stop = observeMarkdownHeadings(reader, scroll, headings, (slug) => active.push(slug), {
        requestFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
        cancelFrame: (identifier) => { frames.delete(identifier); cancelled++; },
        ResizeObserver: ResizeObserverMock,
    });
    try {
        for (const [identifier, callback] of frames) { frames.delete(identifier); callback(0); }
        assert.equal(active.at(-1), "title");
        scroll.scrollTop = 100;
        scroll.dispatchEvent(new dom.window.Event("scroll"));
        for (const [identifier, callback] of frames) { frames.delete(identifier); callback(0); }
        assert.equal(active.at(-1), "purpose");
        scroll.dispatchEvent(new dom.window.Event("scroll"));
        stop();
        assert.equal(frames.size, 0);
        assert.equal(disconnected, 1);
        assert.equal(cancelled, 1);
        scroll.dispatchEvent(new dom.window.Event("scroll"));
        assert.equal(frames.size, 0);
    } finally { stop(); dom.window.close(); }
});

async function tocFixture(run: (fixture: {
    document: Document; window: JSDOM["window"]; content: HTMLElement; toolbar: HTMLElement;
    render: (compact?: boolean) => Promise<void>; navigated: string[];
}) => Promise<void>) {
    const module = await import("../src/MarkdownReader/MarkdownTableOfContents/MarkdownTableOfContents.tsx").catch((error: { code?: string }) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") assert.fail("T046: responsive table-of-contents component is missing");
        throw error;
    });
    const dom = new JSDOM('<div id="toolbar" inert></div><div id="content"><h2 id="toc-fixture-heading-purpose" tabindex="-1">Purpose</h2></div><div id="toc"></div>', { pretendToBeVisual: true });
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    if (!("inert" in dom.window.HTMLElement.prototype)) Object.defineProperty(dom.window.HTMLElement.prototype, "inert", {
        get(this: HTMLElement) { return this.hasAttribute("inert"); },
        set(this: HTMLElement, value: boolean) { this.toggleAttribute("inert", value); },
    });
    const content = dom.window.document.getElementById("content") as HTMLElement;
    const toolbar = dom.window.document.getElementById("toolbar") as HTMLElement;
    const root = createRoot(dom.window.document.getElementById("toc")!);
    const navigated: string[] = [];
    const render = async (compact = true) => {
        await act(async () => root.render(createElement(module.MarkdownTableOfContents, {
            readerId: "toc-fixture", headings, activeSlug: "title", compact, background: [content, toolbar],
            onNavigate: (slug: string) => {
                assert.equal(content.inert, false, "inert must be removed before destination focus");
                navigated.push(slug);
                dom.window.document.getElementById(`toc-fixture-heading-${slug}`)?.focus();
            },
        })));
    };
    try { await run({ document: dom.window.document, window: dom.window, content, toolbar, render, navigated }); }
    finally {
        await act(async () => root.unmount());
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        dom.window.close();
    }
}

test("compact TOC traps focus and Escape restores the trigger and prior inert state", () => tocFixture(async ({ document, window, content, toolbar, render }) => {
    await render();
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Table of contents"]')!;
    await act(async () => trigger.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    assert.ok(dialog);
    assert.equal(content.inert, true);
    assert.equal(toolbar.inert, true);
    assert.ok(dialog.contains(document.activeElement));
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    buttons.at(-1)!.focus();
    const tab = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => document.activeElement!.dispatchEvent(tab));
    assert.equal(document.activeElement, buttons[0]);
    const escape = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => document.activeElement!.dispatchEvent(escape));
    assert.equal(escape.defaultPrevented, true);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, trigger);
    assert.equal(content.inert, false);
    assert.equal(toolbar.inert, true);
}));

test("compact TOC selection focuses its destination and container expansion cleans modal state", () => tocFixture(async ({ document, content, toolbar, render, navigated }) => {
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Table of contents"]')!.click());
    const destination = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Purpose")!;
    await act(async () => destination.click());
    assert.deepEqual(navigated, ["purpose"]);
    assert.equal(document.activeElement?.id, "toc-fixture-heading-purpose");
    assert.equal(content.inert, false);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Table of contents"]')!.click());
    await render(false);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(content.inert, false);
    assert.equal(toolbar.inert, true);
}));
