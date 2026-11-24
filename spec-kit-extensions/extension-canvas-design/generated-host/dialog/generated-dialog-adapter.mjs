export const dialogId = "stock.dialog";
export const contractVersion = 1;

export function mount({ root, definition, context = {}, onDecision }) {
    if (!root || typeof root.replaceChildren !== "function"
        || !definition || !Array.isArray(definition.blocks)
        || !definition.buttons || typeof definition.buttons.cancel !== "string"
        || typeof definition.buttons.confirm !== "string"
        || typeof onDecision !== "function") {
        throw new Error("Invalid generated dialog context");
    }
    const doc = root.ownerDocument;
    const overlay = doc.createElement("div");
    overlay.className = "generated-dialog-backdrop";
    const dialog = doc.createElement("div");
    dialog.className = "generated-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = doc.createElement("h2");
    title.textContent = definition.title;
    title.id = "generated-dialog-title";
    dialog.setAttribute("aria-labelledby", title.id);
    dialog.append(title);
    let packageSlot = false;
    for (const block of definition.blocks) {
        let element;
        if (block.type === "slot" && block.name === "pending-packages") {
            if (packageSlot || !Array.isArray(context.pendingPackages) || !context.pendingPackages.length) {
                throw new Error("Pending package dialog requires a nonempty package inventory");
            }
            packageSlot = true;
            element = doc.createElement("div");
            const heading = doc.createElement("h3");
            heading.textContent = "Packages to install";
            const list = doc.createElement("ul");
            for (const item of context.pendingPackages) {
                if (!item || typeof item.name !== "string" || typeof item.source !== "string") {
                    throw new Error("Invalid pending package");
                }
                const row = doc.createElement("li");
                row.textContent = `${item.name}${item.version ? ` v${item.version}` : ""} — ${item.source}${item.community ? " (community source)" : ""}`;
                list.append(row);
            }
            element.append(heading, list);
        } else if (block.type === "slot" && block.name === "phase") {
            if (typeof context.phase?.id !== "string" || typeof context.phase?.label !== "string") {
                throw new Error("Phase dialog requires a selected phase");
            }
            element = doc.createElement("p");
            element.textContent = `${context.phase.label} (${context.phase.id})`;
        } else if (block.type === "list") {
            element = doc.createElement("ul");
            for (const item of block.items) {
                const row = doc.createElement("li");
                row.textContent = item;
                element.append(row);
            }
        } else if (block.type === "link") {
            if (typeof block.href !== "string" || !/^https:\/\/[^\s]+$/.test(block.href)) {
                throw new Error("Dialog links must use HTTPS");
            }
            element = doc.createElement("a");
            element.href = block.href;
            element.rel = "noopener noreferrer";
            element.target = "_blank";
            element.textContent = block.text;
        } else if (["heading", "paragraph", "warning"].includes(block.type)) {
            element = doc.createElement(block.type === "heading" ? "h3" : "p");
            element.textContent = block.text;
            if (block.type === "warning") element.className = "workflow-error";
        } else throw new Error("Unknown dialog block");
        dialog.append(element);
    }
    const footer = doc.createElement("footer");
    footer.className = "phase-actions";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = definition.buttons.cancel;
    const confirm = doc.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn-primary";
    confirm.textContent = definition.buttons.confirm;
    footer.append(cancel, confirm);
    dialog.append(footer);
    overlay.append(dialog);
    const previousFocus = doc.activeElement;
    root.replaceChildren(overlay);
    let settle;
    const result = new Promise((resolve) => { settle = resolve; });
    const finish = (outcome) => {
        if (!settle) return;
        const resolve = settle;
        settle = null;
        overlay.remove();
        previousFocus?.focus?.();
        resolve(outcome);
        onDecision(outcome);
    };
    cancel.addEventListener("click", () => finish("cancelled"));
    confirm.addEventListener("click", () => finish("confirmed"));
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish("cancelled");
    });
    const onKey = (event) => {
        if (event.key === "Escape") { event.preventDefault(); finish("cancelled"); }
        if (event.key !== "Tab") return;
        const focusable = [...dialog.querySelectorAll("a[href], button:not([disabled])")];
        if (!event.shiftKey && doc.activeElement === focusable.at(-1)) {
            event.preventDefault();
            focusable[0].focus();
        } else if (event.shiftKey && doc.activeElement === focusable[0]) {
            event.preventDefault();
            focusable.at(-1).focus();
        }
    };
    dialog.addEventListener("keydown", onKey);
    cancel.focus();
    return { result, dispose: () => finish("cancelled") };
}
