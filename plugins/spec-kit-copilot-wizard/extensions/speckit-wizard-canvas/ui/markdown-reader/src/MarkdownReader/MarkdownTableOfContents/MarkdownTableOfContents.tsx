import { useLayoutEffect, useRef, useState } from "react";
import { ListTree, X } from "lucide-react";
import type { HeadingTarget } from "../markdownOutline.ts";

export interface TableOfContentsProps {
    readerId: string;
    headings: readonly HeadingTarget[];
    activeSlug: string | null;
    compact: boolean;
    background?: readonly HTMLElement[];
    getBackground?: () => readonly HTMLElement[];
    onNavigate: (slug: string, activation: "pointer" | "keyboard") => void;
}

interface OutlineBranch {
    heading: HeadingTarget;
    children: OutlineBranch[];
}

function outlineTree(headings: readonly HeadingTarget[]) {
    const roots: OutlineBranch[] = [];
    const ancestors: OutlineBranch[] = [];
    for (const heading of headings) {
        while (ancestors.length && ancestors.at(-1)!.heading.depth >= heading.depth) ancestors.pop();
        const branch = { heading, children: [] };
        if (ancestors.length) ancestors.at(-1)!.children.push(branch);
        else roots.push(branch);
        ancestors.push(branch);
    }
    return roots;
}

export function MarkdownTableOfContents({ readerId, headings, activeSlug, compact, background = [], getBackground, onNavigate }: TableOfContentsProps) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const drawer = useRef<HTMLDivElement>(null);
    const pending = useRef<{ slug?: string; activation?: "pointer" | "keyboard"; dismiss?: boolean } | null>(null);
    const dismiss = () => { pending.current = { dismiss: true }; setOpen(false); };

    useLayoutEffect(() => {
        if (!open || !compact || !drawer.current) {
            if (!compact && open) setOpen(false);
            const action = pending.current;
            pending.current = null;
            if (action?.slug) onNavigate(action.slug, action.activation ?? "keyboard");
            else if (action?.dismiss && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
            return;
        }
        const dialog = drawer.current;
        const document = dialog.ownerDocument;
        const previous = new Map((getBackground?.() ?? background).map((element) => [element, element.inert]));
        for (const element of previous.keys()) element.inert = true;
        const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled),[tabindex="0"]')];
        focusable()[0]?.focus({ preventScroll: true });
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                dismiss();
            } else if (event.key === "Tab") {
                const controls = focusable();
                if (!controls.length) return;
                event.preventDefault();
                event.stopPropagation();
                const current = controls.indexOf(document.activeElement as HTMLElement);
                const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
                controls[next]?.focus();
            }
        };
        const focusin = (event: FocusEvent) => {
            if (!dialog.contains(event.target as Node)) focusable()[0]?.focus({ preventScroll: true });
        };
        document.addEventListener("keydown", keydown, true);
        document.addEventListener("focusin", focusin, true);
        return () => {
            document.removeEventListener("keydown", keydown, true);
            document.removeEventListener("focusin", focusin, true);
            for (const [element, inert] of previous) element.inert = inert;
        };
    }, [open, compact]);

    const navigate = (slug: string, activation: "pointer" | "keyboard") => {
        if (compact) { pending.current = { slug, activation }; setOpen(false); }
        else onNavigate(slug, activation);
    };
    const renderBranches = (branches: OutlineBranch[]) => <ol className="md-reader__toc-list">
        {branches.map(({ heading, children }) => <li key={heading.domId}>
            <button type="button" data-toc-slug={heading.logicalSlug} aria-current={activeSlug === heading.logicalSlug ? "location" : undefined}
                title={heading.label} onClick={(event) => navigate(heading.logicalSlug, event.detail === 0 ? "keyboard" : "pointer")}>{heading.label}</button>
            {children.length > 0 && renderBranches(children)}
        </li>)}
    </ol>;
    const outline = renderBranches(outlineTree(headings));
    const heading = <div className="md-reader__toc-title" id={`${readerId}-toc-title`}><ListTree size={16} aria-hidden="true" /><span>Table of contents</span></div>;
    if (!headings.length) return null;
    if (!compact) return <nav className="md-reader__toc" aria-label="Table of contents">{heading}{outline}</nav>;
    return <div className="md-reader__toc-compact">
        <button ref={trigger} className="md-reader__toc-trigger" type="button" aria-label="Table of contents" aria-expanded={open}
            aria-controls={`${readerId}-toc-drawer`} onClick={() => setOpen(true)}><ListTree size={16} aria-hidden="true" /><span>Table of contents</span></button>
        {open && <>
            <div className="md-reader__toc-backdrop" aria-hidden="true" onClick={dismiss} />
            <div ref={drawer} className="md-reader__toc-drawer" id={`${readerId}-toc-drawer`} role="dialog" aria-modal="true" aria-labelledby={`${readerId}-toc-title`}>
                <div className="md-reader__toc-drawer-header">{heading}<button type="button" className="md-reader__toc-close" aria-label="Close table of contents" title="Close table of contents" onClick={dismiss}><X size={16} aria-hidden="true" /></button></div>
                <nav aria-label="Table of contents">{outline}</nav>
            </div>
        </>}
    </div>;
}
