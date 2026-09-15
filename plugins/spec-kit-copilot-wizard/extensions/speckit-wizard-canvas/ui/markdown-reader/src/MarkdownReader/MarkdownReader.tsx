import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, CSSProperties, RefObject } from "react";
import Markdown from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Emphasis, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { ChevronLeft, ChevronRight, Files, RefreshCw } from "lucide-react";
import { createMarkdownOutline, namespaceMarkdownTargets } from "./markdownOutline.ts";
import { MarkdownTableOfContents } from "./MarkdownTableOfContents/MarkdownTableOfContents.tsx";
import { scrollToMarkdownHeading, useActiveMarkdownHeading } from "./useActiveMarkdownHeading.ts";
import type { ClarificationDescriptor, ReaderOptions } from "../types.ts";

const STATE_MESSAGES = {
    idle: "Select an artifact to review.",
    loading: "Loading artifact...",
    ready: "",
    changed: "Source changed. Displayed content is stale.",
    missing: "This artifact has not been generated yet.",
    deleted: "This artifact was deleted. Choose another artifact.",
    unsupported: "This artifact cannot be reviewed.",
    empty: "This artifact is empty.",
    "no-heading": "This document has no sections.",
    error: "The artifact could not be read. Try refreshing it.",
};

const ReaderContext = createContext<{ options: ReaderOptions; root: RefObject<HTMLElement | null> } | null>(null);

function clarificationTransform(bindings: readonly ClarificationDescriptor[]): Plugin<[], Root> {
    return () => (tree) => {
        visit(tree, "text", (node, index, parent) => {
            if (index === undefined || !parent || ["link", "linkReference"].includes(parent.type)) return;
            const replacements: Array<Text | Emphasis> = [];
            let offset = 0;
            for (const match of node.value.matchAll(/\[NEEDS CLARIFICATION:\s*([^\]]+)\]/gi)) {
                const question = match[1]!.trim();
                const binding = bindings.find((entry) => entry.question === question &&
                    (entry.sourceStart === undefined || entry.sourceStart === (node.position?.start.offset ?? 0) + match.index));
                if (!binding) continue;
                if (match.index > offset) replacements.push({ type: "text", value: node.value.slice(offset, match.index) });
                replacements.push({ type: "emphasis", children: [{ type: "text", value: match[0] }], data: {
                    hName: "span", hProperties: { "data-clarification-id": binding.id },
                } });
                offset = match.index + match[0].length;
            }
            if (!replacements.length) return;
            if (offset < node.value.length) replacements.push({ type: "text", value: node.value.slice(offset) });
            parent.children.splice(index, 1, ...replacements);
            return index + replacements.length;
        });
    };
}

function MarkdownClarification({ children, node }: ComponentPropsWithoutRef<"span"> & ExtraProps) {
    const reader = useContext(ReaderContext);
    const id = node?.properties["data-clarification-id"];
    const descriptor = reader?.options.clarifications?.find((binding) => binding.id === id &&
        binding.artifactId === reader.options.document?.artifact.id && binding.revision === reader.options.document?.revision);
    if (!descriptor || !reader?.options.onClarification) return <span>{children}</span>;
    return <span className="md-reader__clarification">
        <mark>{children}</mark>{" "}
        <button type="button" data-clarification-id={descriptor.id} className="md-reader__clarify-button"
            disabled={["submitting", "stale"].includes(descriptor.status ?? "") || reader.options.state === "changed"}
            aria-label={`Clarify: ${descriptor.question}`} title={descriptor.question}
            onClick={() => reader.options.onClarification?.(descriptor.id)}>{descriptor.answer ? "Answer queued" : "Clarify"}</button>
    </span>;
}

export function supportedMarkdownHref(href: string | undefined) {
    if (!href || /^[\s\\/]|[\x00-\x1f\x7f]/.test(href)) return false;
    if (/^https?:\/\//i.test(href)) {
        try {
            const target = new URL(href);
            return !target.username && !target.password;
        } catch { return false; }
    }
    return !href.includes(":");
}

function MarkdownLink({ href, children, node, id, ...properties }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
    const reader = useContext(ReaderContext);
    if (!reader?.options.navigationEnabled || !supportedMarkdownHref(href)) return <span>{children}</span>;
    const footnote = Object.hasOwn(node?.properties ?? {}, "dataFootnoteRef");
    const backref = Object.hasOwn(node?.properties ?? {}, "dataFootnoteBackref");
    return <a href={footnote || backref ? href : "#"} id={id} referrerPolicy="no-referrer" rel="noopener noreferrer"
        data-footnote-ref={footnote || undefined} data-footnote-backref={backref || undefined}
        aria-describedby={properties["aria-describedby"]} aria-label={properties["aria-label"]}
        onAuxClick={(event) => event.preventDefault()}
        onClick={(event) => {
            event.preventDefault();
            if ((footnote || backref) && href?.startsWith("#")) {
                const target = [...reader.root.current?.querySelectorAll<HTMLElement>("[id]") ?? []].find((element) => element.id === href.slice(1));
                if (target) {
                    const scroll = reader.options.scrollElement;
                    scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
                    target.tabIndex = -1;
                    target.focus({ preventScroll: true });
                }
                return;
            }
            reader.options.onNavigateReference(href!);
        }}>{children}</a>;
}

const markdownComponents: Components = {
    a: MarkdownLink,
    span: MarkdownClarification,
    img: ({ alt }) => <span className="md-reader__image-placeholder" role="img" aria-label={alt || "Image unavailable"}>[Image: {alt || "unavailable"}]</span>,
    input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label={checked ? "Completed task" : "Incomplete task"} />,
    table: ({ children }) => <div className="md-reader__table-scroll" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
};

export function MarkdownReader({ options }: { options: ReaderOptions }) {
    const root = useRef<HTMLElement>(null);
    const article = useRef<HTMLElement>(null);
    const toolbar = useRef<HTMLElement>(null);
    const identity = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState({ compact: true, height: 600 });
    const document = options.document;
    const mayShowDocument = Boolean(document && ["ready", "no-heading", "changed"].includes(options.state));
    const content = mayShowDocument ? document!.content : "";
    const bindingKey = JSON.stringify((options.clarifications ?? []).filter((binding) =>
        binding.artifactId === document?.artifact.id && binding.revision === document?.revision &&
        /^[A-Za-z0-9_-]{1,256}$/.test(binding.id) && binding.question.length <= 4000 && /^speckit[.-][a-z0-9.-]+$/i.test(binding.commandName)
    ).map(({ id, question, sourceStart }) => ({ id, question, sourceStart })));
    const parsed = useMemo(() => {
        const outline = createMarkdownOutline(options.readerId);
        const bindings = JSON.parse(bindingKey) as ClarificationDescriptor[];
        const body = Markdown({
            children: content, skipHtml: true, remarkPlugins: [remarkGfm, outline.plugin, clarificationTransform(bindings)],
            rehypePlugins: [[namespaceMarkdownTargets, options.readerId]], components: markdownComponents,
        });
        return { body, headings: outline.headings };
    }, [content, options.readerId, bindingKey]);
    const presentationState = document && ["ready", "no-heading"].includes(options.state)
        ? !content.trim() ? "empty" : parsed.headings.length ? "ready" : "no-heading"
        : options.state;
    const showDocument = mayShowDocument && presentationState !== "empty";
    const active = useActiveMarkdownHeading(root, options.scrollElement, parsed.headings);

    useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;
        const window = element.ownerDocument.defaultView;
        const measure = () => {
            const compact = element.clientWidth < 820;
            const height = Math.max(200, (options.scrollElement.clientHeight || 624) - 24);
            setLayout((previous) => previous.compact === compact && previous.height === height ? previous : { compact, height });
        };
        const observer = window?.ResizeObserver ? new window.ResizeObserver(measure) : null;
        observer?.observe(element);
        observer?.observe(options.scrollElement);
        window?.addEventListener("resize", measure);
        measure();
        return () => { observer?.disconnect(); window?.removeEventListener("resize", measure); };
    }, [options.scrollElement]);

    useLayoutEffect(() => {
        if (root.current && options.fragment) scrollToMarkdownHeading(root.current, options.scrollElement, parsed.headings, options.fragment);
    }, [options.fragment, options.scrollElement, parsed.headings, layout.compact]);

    useEffect(() => {
        options.onRendered?.({ readerId: options.readerId, artifactId: options.selectedArtifactId,
            revision: document?.revision, state: presentationState, activeFragment: active.activeSlug ?? undefined });
    }, [options.readerId, options.selectedArtifactId, options.onRendered, presentationState, document?.revision, active.activeSlug]);

    return <ReaderContext.Provider value={{ options, root }}>
        <section ref={root} className="md-reader" data-reader-id={options.readerId} data-reader-state={presentationState} data-reader-connection={options.connectionState}
            data-reader-layout={layout.compact ? "compact" : "wide"} style={{ "--md-toc-height": `${layout.height}px` } as CSSProperties}
            data-artifact-id={options.selectedArtifactId} data-revision={document?.revision}
            aria-busy={options.state === "loading"} onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); options.onReturnToWorkflow(); }
            }}>
            {options.navigationEnabled && <nav ref={toolbar} className="md-reader__toolbar" aria-label="Artifact navigation">
                <button type="button" aria-label="Previous artifact" title="Previous artifact" disabled={!options.canNavigateBack} onClick={() => options.onNavigateHistory("back")}><ChevronLeft size={16} aria-hidden="true" /></button>
                <button type="button" aria-label="Next artifact" title="Next artifact" disabled={!options.canNavigateForward} onClick={() => options.onNavigateHistory("forward")}><ChevronRight size={16} aria-hidden="true" /></button>
                <Files size={16} aria-hidden="true" />
                <select aria-label="Artifacts" value={options.selectedArtifactId ?? ""} onChange={(event) => options.onSelectArtifact(event.target.value)}>
                    {options.artifacts.map((artifact) => <option key={artifact.id} value={artifact.id} disabled={artifact.availability !== "available"}>{artifact.label}</option>)}
                </select>
                {options.onRefresh && <button type="button" aria-label="Refresh artifact" title="Refresh artifact" disabled={options.state === "loading"} onClick={options.onRefresh}><RefreshCw size={16} aria-hidden="true" /></button>}
            </nav>}
            {document && <div ref={identity} className="md-reader__identity" role="group" aria-label="Artifact source"><span>{document.artifact.relativePath}</span><small>Working-tree revision {document.revision.slice(7, 19)}</small></div>}
            {options.connectionState === "disconnected" && <p className="md-reader__notice" role="status">Disconnected. Displayed content may be out of date.</p>}
            {showDocument && ["changed", "no-heading"].includes(presentationState) && <p className="md-reader__notice" role="status">{STATE_MESSAGES[presentationState]}</p>}
            {showDocument ? <div className={`md-reader__layout${parsed.headings.length ? " md-reader__layout--outlined" : ""}`}>
                {parsed.headings.length > 0 && <MarkdownTableOfContents readerId={options.readerId} headings={parsed.headings}
                    activeSlug={active.activeSlug} compact={layout.compact}
                    getBackground={() => [article.current, toolbar.current, identity.current].filter((element): element is HTMLElement => element !== null)}
                    onNavigate={(slug, activation) => active.navigate(slug, layout.compact || activation === "keyboard")} />}
                <article ref={article} className="md-reader__article">{parsed.body}</article>
            </div>
                : <p className="md-reader__notice" role="status">{options.statusMessage || STATE_MESSAGES[presentationState]}</p>}
        </section>
    </ReaderContext.Provider>;
}
