import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import type { HeadingTarget } from "./markdownOutline.ts";

interface HeadingPosition { logicalSlug: string; top: number }
interface ResizeObserverLike { observe(target: Element): void; disconnect(): void }
interface ObserverOptions {
    requestFrame?: (callback: FrameRequestCallback) => number;
    cancelFrame?: (identifier: number) => void;
    ResizeObserver?: new (callback: () => void) => ResizeObserverLike;
}

export function activeHeadingAt(positions: readonly HeadingPosition[], scrollTop: number, height: number) {
    if (!positions.length) return null;
    const readingLine = scrollTop + height * 0.25;
    let active = positions[0]!.logicalSlug;
    for (const position of positions) {
        if (position.top > readingLine) break;
        active = position.logicalSlug;
    }
    return active;
}

export function observeMarkdownHeadings(reader: HTMLElement, scrollElement: HTMLElement, headings: readonly HeadingTarget[], onActive: (slug: string | null) => void, options: ObserverOptions = {}) {
    const window = reader.ownerDocument.defaultView;
    if (!window) return () => {};
    const requestFrame = options.requestFrame ?? window.requestAnimationFrame?.bind(window) ?? ((callback) => window.setTimeout(() => callback(window.performance.now()), 0));
    const cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout.bind(window);
    const Observer = options.ResizeObserver ?? window.ResizeObserver;
    const elements = new Map([...reader.querySelectorAll<HTMLElement>("[data-reader-heading]")].map((element) => [element.id, element]));
    let positions: HeadingPosition[] = [];
    let frame: number | null = null;
    let dirty = true;
    let disposed = false;
    const update = () => {
        frame = null;
        if (disposed) return;
        if (dirty) {
            const top = scrollElement.getBoundingClientRect().top;
            positions = headings.flatMap((heading) => {
                const element = elements.get(heading.domId);
                return element ? [{ logicalSlug: heading.logicalSlug, top: element.getBoundingClientRect().top - top + scrollElement.scrollTop }] : [];
            }).sort((first, second) => first.top - second.top);
            dirty = false;
        }
        onActive(activeHeadingAt(positions, scrollElement.scrollTop, scrollElement.clientHeight));
    };
    const schedule = (measure = false) => {
        if (disposed) return;
        dirty ||= measure;
        if (frame === null) frame = requestFrame(update);
    };
    const scroll = () => schedule();
    const resize = () => schedule(true);
    const observer = Observer ? new Observer(resize) : null;
    observer?.observe(reader);
    observer?.observe(scrollElement);
    scrollElement.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize);
    reader.ownerDocument.fonts?.ready.then(resize).catch(() => {});
    schedule(true);
    return () => {
        if (disposed) return;
        disposed = true;
        if (frame !== null) cancelFrame(frame);
        frame = null;
        observer?.disconnect();
        scrollElement.removeEventListener("scroll", scroll);
        window.removeEventListener("resize", resize);
        elements.clear();
        positions = [];
    };
}

export function scrollToMarkdownHeading(reader: HTMLElement, scrollElement: HTMLElement, headings: readonly HeadingTarget[], slug: string, focus = true) {
    const heading = headings.find((entry) => entry.logicalSlug === slug);
    if (!heading) return false;
    const target = [...reader.querySelectorAll<HTMLElement>("[data-reader-heading]")].find((element) => element.id === heading.domId);
    if (!target) return false;
    const top = Math.max(0, scrollElement.scrollTop + target.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top - scrollElement.clientHeight * 0.25);
    const reduceMotion = reader.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (typeof scrollElement.scrollTo === "function") scrollElement.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
    else scrollElement.scrollTop = top;
    if (focus) target.focus({ preventScroll: true });
    return true;
}

export function useActiveMarkdownHeading(reader: RefObject<HTMLElement | null>, scrollElement: HTMLElement, headings: readonly HeadingTarget[]) {
    const [activeSlug, setActiveSlug] = useState<string | null>(headings[0]?.logicalSlug ?? null);
    useLayoutEffect(() => {
        if (!reader.current || !scrollElement) return;
        return observeMarkdownHeadings(reader.current, scrollElement, headings, setActiveSlug);
    }, [reader, scrollElement, headings]);
    return {
        activeSlug: headings.some((heading) => heading.logicalSlug === activeSlug) ? activeSlug : headings[0]?.logicalSlug ?? null,
        navigate(slug: string, focus = true) {
            if (reader.current && scrollToMarkdownHeading(reader.current, scrollElement, headings, slug, focus)) setActiveSlug(slug);
        },
    };
}
