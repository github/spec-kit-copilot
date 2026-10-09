import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type { Root } from "mdast";

export interface SourceClarification {
    index: number;
    question: string;
    section: string;
    startIdx: number;
    endIdx: number;
}

export function parseClarificationSource(markdown: string): SourceClarification[] {
    if (!/\[NEEDS CLARIFICATION:/i.test(markdown)) return [];
    const processor = unified().use(remarkParse).use(remarkGfm);
    const tree = processor.runSync(processor.parse(markdown)) as Root;
    const questions: SourceClarification[] = [];
    let section = "";
    visit(tree, (node, _index, parent) => {
        if (node.type === "heading") { section = toString(node); return; }
        if (node.type !== "text" || !parent || ["heading", "link", "linkReference"].includes(parent.type)) return;
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
    });
    return questions;
}
