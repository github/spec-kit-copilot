export const controlId = "stock.text";
export const valueContract = { type: "string" };

export function mount({ root, field, value, context }) {
    if (!root || typeof root.replaceChildren !== "function" || !field?.id
        || typeof value !== "string" || !context || typeof context.className !== "string") {
        throw new Error("Invalid packaged text presentation");
    }
    const text = document.createElement("span");
    text.className = context.className;
    text.textContent = value;
    root.replaceChildren(text);
}
