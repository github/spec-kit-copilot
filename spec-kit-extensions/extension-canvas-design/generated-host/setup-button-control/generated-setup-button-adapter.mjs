export const controlId = "project.setup-button";
export const contractVersion = 1;

export function mount({ root, definition, onSetup }) {
    if (!root || typeof root.replaceChildren !== "function"
        || !definition || definition.control !== controlId
        || definition.action?.type !== "project.setup"
        || typeof onSetup !== "function") {
        throw new Error("Invalid project setup button context");
    }
    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `btn btn-${definition.presentation === "secondary" ? "secondary" : "primary"}`;
    button.textContent = definition.label;
    const listener = new AbortController();
    button.addEventListener("click", () => onSetup(), { signal: listener.signal });
    root.replaceChildren(button);
    return { dispose: () => listener.abort() };
}
