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

const EXCLUDED_CONTAINERS = new Set(["heading", "link", "linkReference"]);

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
            const source = markdown.slice(start, end);
            if (source !== node.value) return;
            for (const match of source.matchAll(/\[NEEDS CLARIFICATION:\s*([^\]]+)\]/gi)) {
                const question = match[1]!.trim();
                if (!question || question.length > 4000) continue;
                questions.push({ index: questions.length, question, section, startIdx: start + match.index, endIdx: start + match.index + match[0].length });
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
