export const controlId = "stock.image";
export const valueContract = { type: "image", maxBytes: 32768,
    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] };

export function mount({ root, field, value, context }) {
    if (!root || typeof root.replaceChildren !== "function"
        || !field?.id || typeof value !== "string" || !value
        || typeof context?.alt !== "string" || typeof context.className !== "string") {
        throw new Error("Invalid packaged image presentation");
    }
    const image = document.createElement("img");
    image.src = value;
    image.alt = context.alt;
    image.className = context.className;
    root.replaceChildren(image);
}
