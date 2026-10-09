import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { JSDOM } from "jsdom";
import type { MountedReader, ReaderOptions, RenderedEvent } from "../src/types.ts";

const source = new URL("../src/mount.tsx", import.meta.url);

function createOptions(scrollElement: HTMLElement): ReaderOptions {
    const artifact = {
        id: "fixture-spec",
        relativePath: "specs/999-canvas-preview-fixture/spec.md",
        label: "Specification",
        role: "primary" as const,
        availability: "available" as const,
    };
    return {
        readerId: "fixture-reader",
        state: "ready",
        connectionState: "connected",
        document: {
            artifact,
            revision: `sha256:${"1".repeat(64)}`,
            content: "# Fixture specification\n\nFirst document.",
            byteSize: 42,
            modifiedAt: "2026-09-09T12:00:00Z",
            sourceKind: "working-tree",
        },
        artifacts: [artifact],
        selectedArtifactId: artifact.id,
        scrollElement,
        onSelectArtifact: () => assert.fail("Probe must not switch artifacts automatically."),
        onNavigateReference: () => assert.fail("Probe must not follow references automatically."),
        onNavigateHistory: () => assert.fail("Probe must not navigate history automatically."),
        onReturnToWorkflow: () => assert.fail("Probe must not return to workflow automatically."),
        onClarification: () => assert.fail("Probe must not dispatch a clarification."),
    };
}

async function withPreview(run: (preview: {
    element: HTMLElement;
    scrollElement: HTMLElement;
    options: ReaderOptions;
    mount: (options?: ReaderOptions) => MountedReader;
}) => Promise<void>) {
    assert.ok(existsSync(fileURLToPath(source)), "T011 minimal reader source has not been implemented.");
    const dom = new JSDOM("<!doctype html><div id='scroll'><div id='mount'></div></div>");
    const previous = new Map<string, PropertyDescriptor | undefined>();
    const globals = {
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        Element: dom.window.Element,
        Node: dom.window.Node,
        IS_REACT_ACT_ENVIRONMENT: true,
        fetch: () => assert.fail("Rendering must not fetch content."),
    };
    for (const [key, value] of Object.entries(globals)) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const handles: MountedReader[] = [];
    try {
        const { mountMarkdownReader } = await import("../src/mount.tsx");
        const element = dom.window.document.getElementById("mount") as HTMLElement;
        const scrollElement = dom.window.document.getElementById("scroll") as HTMLElement;
        const options = createOptions(scrollElement);
        await run({
            element,
            scrollElement,
            options,
            mount(next = options) {
                const handle = mountMarkdownReader(element, next);
                handles.push(handle);
                return handle;
            },
        });
    } finally {
        await act(async () => { for (const handle of handles) handle.unmount(); });
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        dom.window.close();
    }
}

test("probe mounts in an existing preview and reports only document metadata", async () => {
    await withPreview(async ({ element, options, mount }) => {
        const events: RenderedEvent[] = [];
        await act(async () => { mount({ ...options, onRendered: (event) => events.push(event) }); });
        assert.match(element.textContent ?? "", /Fixture specification/);
        assert.equal(element.querySelector("[data-reader-id]")?.getAttribute("data-reader-id"), options.readerId);
        assert.equal(events.length, 1);
        assert.equal(events[0]?.artifactId, options.selectedArtifactId);
        assert.equal(events[0]?.revision, options.document?.revision);
        assert.equal("content" in (events[0] ?? {}), false);
    });
});

test("probe updates one root and disposes idempotently before container replacement", async () => {
    await withPreview(async ({ element, options, mount }) => {
        let handle!: MountedReader;
        await act(async () => { handle = mount(); });
        const root = element.firstElementChild;
        await act(async () => {
            handle.update({ ...options, document: { ...options.document!, content: "# Updated fixture", revision: `sha256:${"2".repeat(64)}` } });
        });
        assert.equal(element.firstElementChild, root);
        assert.match(element.textContent ?? "", /Updated fixture/);
        assert.equal(element.querySelectorAll("[data-reader-id]").length, 1);
        await act(async () => { handle.unmount(); handle.unmount(); });
        assert.equal(element.childNodes.length, 0);
        assert.throws(() => handle.update(options), /unmounted/i);
        await act(async () => { mount(); });
        assert.match(element.textContent ?? "", /Fixture specification/);
    });
});

test("probe rejects duplicate mounts and changed reader identity", async () => {
    await withPreview(async ({ options, mount }) => {
        let handle!: MountedReader;
        await act(async () => { handle = mount(); });
        assert.throws(() => mount(), /already mounted/i);
        assert.throws(() => handle.update({ ...options, readerId: "different-reader" }), /readerId/i);
        assert.deepEqual(Object.keys(handle).sort(), ["unmount", "update"]);
    });
});

test("probe rejects detached containers, invalid revisions and mismatched artifacts", async () => {
    await withPreview(async ({ element, options, mount }) => {
        assert.throws(() => mount({ ...options, document: { ...options.document!, revision: "sha256:invalid" } }), /revision/i);
        assert.throws(() => mount({ ...options, selectedArtifactId: "another-artifact" }), /artifact/i);
        assert.throws(() => mount({ ...options, readerId: "invalid id" }), /readerId/i);
        element.remove();
        assert.throws(() => mount(), /connected|container/i);
    });
});

test("probe can show loading without inventing an available document", async () => {
    await withPreview(async ({ element, options, mount }) => {
        await act(async () => { mount({ ...options, state: "loading", document: undefined }); });
        assert.equal(element.querySelector("[data-reader-state]")?.getAttribute("data-reader-state"), "loading");
        assert.doesNotMatch(element.textContent ?? "", /First document/);
    });
});

test("probe treats HTML, images, links and clarification-looking text as non-executing content", async () => {
    await withPreview(async ({ element, options, mount }) => {
        const content = "# Harmless fixture\n\n<script>throw Error('unsafe')</script>\n\n![blocked image](https://example.invalid/image.png)\n\n[unsafe](javascript:alert(1))\n\n[reference](research.md)\n\n[NEEDS CLARIFICATION: fixture question]";
        await act(async () => { mount({ ...options, document: { ...options.document!, content } }); });
        assert.equal(element.querySelectorAll("script,img,iframe,object,form").length, 0);
        assert.equal(element.querySelectorAll("[onclick],[onerror],a[href^='javascript:']").length, 0);
        assert.match(element.textContent ?? "", /blocked image/);
        assert.match(element.textContent ?? "", /fixture question/);
        assert.equal(element.querySelectorAll(".md-reader__article button").length, 0);
    });
});
