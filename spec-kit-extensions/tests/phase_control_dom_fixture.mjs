export function phaseControlDom() {
    const document = { activeElement: null };
    const listeners = new Map();
    let html = "", nodes = [];
    const makeNode = (tag, attributes) => {
        const id = attributes.match(/\bid="([^"]+)"/)?.[1] ?? "";
        const classes = new Set(attributes.match(/\bclass="([^"]+)"/)?.[1]?.split(" ") ?? []);
        const index = attributes.match(/\bdata-phase-index="([^"]+)"/)?.[1];
        const action = attributes.match(/\bdata-action="([^"]+)"/)?.[1];
        const rowIndex = attributes.match(/\bdata-index="([^"]+)"/)?.[1];
        const node = {
            id, tag, attributes: new Map(), dataset: {
                ...(index === undefined ? {} : { phaseIndex: index }),
                ...(action === undefined ? {} : { action }),
                ...(rowIndex === undefined ? {} : { index: rowIndex }),
                ...(attributes.includes("data-phase-draft") ? { phaseDraft: "" } : {}),
            },
            classList: {
                contains: (name) => classes.has(name),
                toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            },
            disabled: /\bdisabled(?:\s|>|$)/.test(attributes), hidden: /\bhidden(?:\s|>|$)/.test(attributes),
            value: "", textContent: "", selectionStart: 0, selectionEnd: 0,
            hasAttribute(name) {
                return name === "data-phase-index" ? index !== undefined
                    : name === "data-output" ? "output" in this.dataset
                    : this.attributes.has(name) || attributes.includes(name);
            },
            setAttribute(name, value) { this.attributes.set(name, value); },
            removeAttribute(name) { this.attributes.delete(name); },
            focus() { document.activeElement = this; },
            setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
            replaceChildren(...children) { this.children = children; },
            append(...children) { this.children = [...(this.children ?? []), ...children]; },
            closest(selector) { return selector === "button" && tag === "button" ? this : null; },
            matches(selector) { return selector === "[data-phase-draft]" && "phaseDraft" in this.dataset; },
            querySelector(selector) { return selector === "code" ? this.code : null; },
        };
        if (id === "browse-output-folder") node.code = { textContent: "" };
        return node;
    };
    document.createElement = (tag) => makeNode(tag, "");
    const root = {
        ownerDocument: document,
        get innerHTML() { return html; },
        set innerHTML(value) {
            html = value;
            nodes = [...value.matchAll(/<(button|textarea|select|span|p|div|section|nav)\b([^>]*)>/g)]
                .map((match) => {
                    const [opening, tag, attributes] = match;
                    const node = makeNode(tag, attributes);
                    node.textContent = value.slice(match.index + opening.length).match(/^[^<]*/)?.[0] ?? "";
                    if (tag === "textarea") node.value = node.textContent;
                    return node;
                });
            document.activeElement = null;
        },
        replaceChildren() { this.innerHTML = ""; },
        querySelector(selector) {
            if (selector.startsWith("#")) return nodes.find((node) => node.id === selector.slice(1)) ?? null;
            const action = selector.match(/^\[data-action="([^"]+)"\](?:\[data-index="([^"]+)"\])?$/);
            if (action) return nodes.find((node) =>
                node.dataset.action === action[1]
                    && (action[2] === undefined || node.dataset.index === action[2])) ?? null;
            if (selector.startsWith('[data-phase-index="')) return nodes.find((node) =>
                node.dataset.phaseIndex === selector.slice(19, -2)) ?? null;
            if (selector === ".phase-notice") return nodes.find((node) => node.classList.contains("phase-notice")) ?? null;
            if (selector === "[data-phase-draft]") return nodes.find((node) => "phaseDraft" in node.dataset) ?? null;
            return null;
        },
        querySelectorAll(selector) {
            return selector === "[data-phase-index]" ? nodes.filter((node) =>
                "phaseIndex" in node.dataset) : [];
        },
        contains(node) {
            const includes = (item) => item === node || item.children?.some(includes);
            return nodes.some(includes);
        },
        addEventListener(type, callback, options) {
            listeners.set(type, callback);
            options?.signal?.addEventListener("abort", () => listeners.delete(type), { once: true });
        },
        removeEventListener(type, callback) {
            if (listeners.get(type) === callback) listeners.delete(type);
        },
        dispatch(type, target) { listeners.get(type)?.({ target }); },
    };
    return { root, document, listeners };
}
