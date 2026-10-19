import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import type { Nodes, Parent, Root } from "mdast";

export interface SourceClarification {
    index: number;
    question: string;
    section: string;
    startIdx: number;
    endIdx: number;
}

export interface ScannedClarification {
    question: string;
    rawText: string;
    startIdx: number;
    endIdx: number;
    valueStart: number;
    valueEnd: number;
}

const EXCLUDED_CONTAINERS = new Set(["heading", "link", "linkReference"]);

export function scanTextClarifications(raw: string, decoded: string, baseOffset = 0): ScannedClarification[] {
    const results: ScannedClarification[] = [];
    let s = 0;
    let v = 0;
    while (s < raw.length && v < decoded.length) {
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
        if (raw[s] === "\r" || raw[s] === "\n" || raw[s] === " " || raw[s] === "\t") {
            const nl = raw.slice(s).match(/^[ \t]*\r?\n[ \t]*/);
            if (nl && decoded[v] === "\n") {
                s += nl[0].length;
                v += 1;
                continue;
            }
        }
        if (raw[s] === "[") {
            const marker = raw.slice(s).match(/^\[NEEDS CLARIFICATION:\s*([^\]]+)\]/i);
            if (marker) {
                let backslashes = 0;
                for (let i = marker[1]!.length - 1; i >= 0 && marker[1]![i] === "\\"; i--) backslashes++;
                const question = marker[1]!.trim();
                if (backslashes % 2 === 0 && question && question.length <= 4000 && decoded.startsWith(marker[0], v)) {
                    results.push({
                        question,
                        rawText: marker[0],
                        startIdx: baseOffset + s,
                        endIdx: baseOffset + s + marker[0].length,
                        valueStart: v,
                        valueEnd: v + marker[0].length,
                    });
                    s += marker[0].length;
                    v += marker[0].length;
                    continue;
                }
            }
        }
        s += 1;
        v += 1;
    }
    return results;
}

export function parseClarificationSource(markdown: string): SourceClarification[] {
    if (!/\[NEEDS CLARIFICATION:/i.test(markdown)) return [];
    const processor = unified().use(remarkParse).use(remarkGfm);
    const tree = processor.runSync(processor.parse(markdown)) as Root;
    const questions: SourceClarification[] = [];
    let section = "";
    function walk(node: Nodes, ancestors: Parent[]) {
        if (node.type === "heading") { section = toString(node); return; }
        if (node.type === "text") {
            if (!ancestors.length || ancestors.some((ancestor) => EXCLUDED_CONTAINERS.has(ancestor.type))) return;
            const start = node.position?.start.offset;
            const end = node.position?.end.offset;
            if (start === undefined || end === undefined) return;
            for (const match of scanTextClarifications(markdown.slice(start, end), node.value, start)) {
                questions.push({ index: questions.length, question: match.question, section, startIdx: match.startIdx, endIdx: match.endIdx });
            }
            return;
        }
        if ("children" in node && Array.isArray(node.children)) {
            const nextAncestors = [...ancestors, node];
            for (const child of node.children as Nodes[]) walk(child, nextAncestors);
        }
    }
    walk(tree, []);
    return questions;
}
