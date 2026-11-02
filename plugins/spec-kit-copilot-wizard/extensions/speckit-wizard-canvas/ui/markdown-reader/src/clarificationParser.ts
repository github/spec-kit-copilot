import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import type { Nodes, Root } from "mdast";
import type { Point, Position } from "unist";
import type { Plugin } from "unified";

export interface SourceClarification {
    index: number;
    question: string;
    section: string;
    startIdx: number;
    endIdx: number;
}

const EXCLUDED_CONTAINERS = new Set(["link", "linkReference", "inlineCode", "html", "image", "imageReference"]);

function mappedTextOffset(raw: string, decoded: string, target: number, blockquote: boolean, direction: "source" | "text"): number | undefined {
    let s = 0;
    let v = 0;
    while (s < raw.length && v < decoded.length) {
        const current = direction === "source" ? s : v;
        if (current === target) return direction === "source" ? v : s;
        if (current > target) return undefined;
        if (blockquote && raw[s] === ">" && /^[ \t>]*$/.test(raw.slice(raw.lastIndexOf("\n", s - 1) + 1, s))) {
            s++;
            if (raw[s] === " " || raw[s] === "\t") s++;
            continue;
        }
        if (raw[s] === "\\" && s + 1 < raw.length && /^[!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~]$/.test(raw[s + 1]!)) {
            s += 2;
            v += 1;
            continue;
        }
        if (raw[s] === "&") {
            const entity = raw.slice(s).match(/^&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/);
            const isDecoded = Boolean(entity && (entity[1] || entity[2] || /^amp$/i.test(entity[3] ?? "") || !decoded.startsWith(entity[0], v)));
            if (entity && isDecoded) {
                let decLen = 1;
                if (entity[1] || entity[2]) {
                    const cp = entity[1] ? parseInt(entity[1], 16) : parseInt(entity[2]!, 10);
                    if (cp > 0xffff && cp <= 0x10ffff) decLen = 2;
                } else if (v + 2 <= decoded.length && s + entity[0].length < raw.length && decoded[v + 1] !== raw[s + entity[0].length] && decoded[v + 2] === raw[s + entity[0].length]) {
                    decLen = 2;
                }
                s += entity[0].length;
                v += decLen;
                continue;
            }
        }
        if (decoded[v] === "\n" && (raw[s] === "\r" || raw[s] === "\n" || raw[s] === " " || raw[s] === "\t")) {
            const nl = raw.slice(s).match(/^[ \t]*\r?\n[ \t]*/);
            if (nl) {
                s += nl[0].length;
                v += 1;
                continue;
            }
        }
        s += 1;
        v += 1;
    }
    return (direction === "source" ? s : v) === target ? direction === "source" ? v : s : undefined;
}

export function sourceTextOffset(raw: string, decoded: string, target: number, blockquote = false): number | undefined {
    return mappedTextOffset(raw, decoded, target, blockquote, "source");
}

export function sourcePointAt(markdown: string, offset: number, origin: Point, originOffset: number): Point {
    const prefix = markdown.slice(originOffset, offset);
    const lines = prefix.split("\n");
    return { offset, line: origin.line + lines.length - 1,
        column: lines.length > 1 ? lines[lines.length - 1]!.length + 1 : origin.column + prefix.length };
}

export function preserveSourcePositions(markdown: string): Plugin<[], Root> {
    return function () {
        const snapshots = new WeakMap<Nodes, Array<{ node: Nodes; value?: string; position?: Position }>>();
        function capture(node: Nodes) {
            if (!("children" in node)) return;
            snapshots.set(node, node.children.map((child) => ({
                node: child, value: child.type === "text" ? child.value : undefined,
                position: child.position ? { start: { ...child.position.start }, end: { ...child.position.end } } : undefined,
            })));
            for (const child of node.children) capture(child);
        }
        function restoreChildren(node: Nodes, blockquote: boolean) {
            if (!("children" in node)) return;
            let cursor = 0;
            for (const original of snapshots.get(node) ?? []) {
                const current = node.children[cursor];
                if (current === original.node && (current.type !== "text" || current.value === original.value)) {
                    cursor++;
                    continue;
                }
                const start = original.position?.start.offset;
                const end = original.position?.end.offset;
                if (original.value === undefined || !original.position || start === undefined || end === undefined) return;
                const pieces: Array<{ node: Nodes; start: number; end: number }> = [];
                let offset = 0;
                while (offset < original.value.length) {
                    const child = node.children[cursor++];
                    if (!child || (child.type !== "text" && child.type !== "link")) return;
                    const value = toString(child);
                    if (!value || original.value.slice(offset, offset + value.length) !== value) return;
                    pieces.push({ node: child, start: offset, end: offset + value.length });
                    offset += value.length;
                }
                if (offset !== original.value.length) return;
                const raw = markdown.slice(start, end);
                const positioned = pieces.map((piece) => {
                    const lower = mappedTextOffset(raw, original.value!, piece.start, blockquote, "text");
                    const upper = mappedTextOffset(raw, original.value!, piece.end, blockquote, "text");
                    return lower === undefined || upper === undefined ? null : { node: piece.node, position: {
                        start: sourcePointAt(markdown, start + lower, original.position!.start, start),
                        end: sourcePointAt(markdown, start + upper, original.position!.start, start),
                    } };
                });
                if (positioned.some((piece) => piece === null)) return;
                for (const piece of positioned) {
                    if (!piece) continue;
                    piece.node.position = piece.position;
                    if (piece.node.type === "link" && piece.node.children.length === 1 && piece.node.children[0]?.type === "text") {
                        piece.node.children[0].position = piece.position;
                    }
                }
            }
        }
        function restore(node: Nodes, blockquote = false) {
            if (node.type === "blockquote") blockquote = true;
            restoreChildren(node, blockquote);
            if ("children" in node) for (const child of node.children) restore(child, blockquote);
        }
        // GFM literal autolinks replace text nodes and discard their positions.
        const data = this.data();
        data.fromMarkdownExtensions = [
            { transforms: [(tree) => { capture(tree); }] },
            ...(data.fromMarkdownExtensions ?? []),
            { transforms: [(tree) => { restore(tree); }] },
        ];
    };
}

export function sourceClarifications(markdown: string, tree: Root): SourceClarification[] {
    if (!/\[NEEDS CLARIFICATION:/i.test(markdown)) return [];
    const questions: SourceClarification[] = [];
    let section = "";
    function excludedSpans(node: Nodes, spans: Array<{ start: number; end: number; type: Nodes["type"] }>) {
        if (EXCLUDED_CONTAINERS.has(node.type)) {
            const start = node.position?.start.offset;
            const end = node.position?.end.offset;
            if (start !== undefined && end !== undefined) spans.push({ start, end, type: node.type });
            return;
        }
        if ("children" in node) for (const child of node.children) excludedSpans(child, spans);
    }
    function walk(node: Nodes) {
        if (node.type === "heading") { section = toString(node); return; }
        if (node.type === "paragraph" || node.type === "tableCell") {
            const start = node.position?.start.offset;
            const end = node.position?.end.offset;
            if (start === undefined || end === undefined) return;
            const excluded: Array<{ start: number; end: number; type: Nodes["type"] }> = [];
            excludedSpans(node, excluded);
            const prefixes = /\[NEEDS CLARIFICATION:/gi;
            let nextStart = start;
            for (const match of markdown.slice(start, end).matchAll(prefixes)) {
                const startIdx = start + match.index;
                if (startIdx < nextStart) continue;
                let openingEscapes = 0;
                for (let index = startIdx - 1; index >= 0 && markdown[index] === "\\"; index--) openingEscapes++;
                if (openingEscapes % 2 || excluded.some((span) => startIdx >= span.start && startIdx < span.end)) continue;
                const bodyStart = startIdx + match[0].length;
                const contentStart = end - markdown.slice(bodyStart, end).trimStart().length;
                let close = markdown.indexOf("]", contentStart);
                while (close >= 0 && close < end) {
                    if (markdown.slice(contentStart, close).trimEnd().length > 4000) { close = -1; break; }
                    const span = excluded.find((entry) => close >= entry.start && close < entry.end);
                    let escapes = 0;
                    for (let index = close - 1; index >= bodyStart && markdown[index] === "\\"; index--) escapes++;
                    if (!span && escapes % 2 === 0) break;
                    close = markdown.indexOf("]", span ? span.end : close + 1);
                }
                if (close < 0 || close >= end) continue;
                const endIdx = close + 1;
                const question = markdown.slice(bodyStart, close).trim();
                if (!question || question.length > 4000 || excluded.some((span) =>
                    ["html", "image", "imageReference"].includes(span.type) && span.start < endIdx && span.end > startIdx)) continue;
                questions.push({ index: questions.length, question, section, startIdx, endIdx });
                nextStart = endIdx;
            }
            return;
        }
        if ("children" in node) for (const child of node.children) walk(child);
    }
    walk(tree);
    return questions;
}

export function parseClarificationSource(markdown: string): SourceClarification[] {
    if (!/\[NEEDS CLARIFICATION:/i.test(markdown)) return [];
    const processor = unified().use(remarkParse).use(remarkGfm).use(preserveSourcePositions(markdown));
    const tree = processor.runSync(processor.parse(markdown)) as Root;
    return sourceClarifications(markdown, tree);
}
