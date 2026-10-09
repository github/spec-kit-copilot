import GithubSlugger, { slug } from "github-slugger";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import type { Root as MarkdownRoot } from "mdast";
import type { Root as HtmlRoot } from "hast";
import type { Plugin } from "unified";

export interface HeadingTarget {
    logicalSlug: string;
    domId: string;
    label: string;
    depth: number;
    order: number;
    sourceOffset?: number;
}

export function createMarkdownOutline(readerId: string) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(readerId)) throw new Error("Invalid reader identity.");
    const headings: HeadingTarget[] = [];
    const plugin: Plugin<[], MarkdownRoot> = () => (tree) => {
        const slugger = new GithubSlugger();
        headings.length = 0;
        visit(tree, "heading", (heading) => {
            const label = toString(heading);
            const logicalSlug = slugger.slug(slug(label) ? label : "section");
            const domId = `${readerId}-heading-${logicalSlug}`;
            headings.push({ logicalSlug, domId, label: label || "Section", depth: heading.depth,
                order: headings.length, sourceOffset: heading.position?.start.offset });
            heading.data ??= {};
            heading.data.hProperties = { ...heading.data.hProperties,
                id: domId, "data-reader-heading": true, "data-logical-slug": logicalSlug, tabIndex: -1 };
        });
    };
    return { headings, plugin };
}

export const namespaceMarkdownTargets: Plugin<[string], HtmlRoot> = (readerId) => (tree) => {
    const targets = new Map<string, string>();
    visit(tree, "element", (element) => {
        const id = element.properties.id;
        if (typeof id !== "string") return;
        const target = id.startsWith(`${readerId}-`) ? id : `${readerId}-node-${id}`;
        targets.set(id, target);
        element.properties.id = target;
    });
    visit(tree, "element", (element) => {
        const href = element.properties.href;
        if (typeof href === "string" && href.startsWith("#") && targets.has(href.slice(1))) {
            element.properties.href = `#${targets.get(href.slice(1))}`;
        }
        for (const property of ["ariaDescribedBy", "ariaLabelledBy"]) {
            const value = element.properties[property];
            if (Array.isArray(value)) element.properties[property] = value.map((id) => targets.get(String(id)) ?? id);
            else if (typeof value === "string") element.properties[property] = value.split(/\s+/).map((id) => targets.get(id) ?? id).join(" ");
        }
    });
};
