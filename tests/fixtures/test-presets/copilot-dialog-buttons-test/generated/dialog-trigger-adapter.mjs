export const controlId = "dialog.trigger";
export const contractVersion = 1;

export function mount({ root, definition, onTrigger }) {
    if (!root || typeof root.replaceChildren !== "function"
        || !definition || definition.control !== controlId
        || definition.action?.type !== "dialog.result"
        || typeof onTrigger !== "function") {
        throw new Error("Invalid dialog trigger context");
    }
    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `btn btn-${definition.presentation === "secondary" ? "secondary" : "primary"}`;
    button.textContent = definition.label;
    const listener = new AbortController();
    button.addEventListener("click", () => onTrigger(), { signal: listener.signal });
    root.replaceChildren(button);
    return { dispose: () => listener.abort() };
}
