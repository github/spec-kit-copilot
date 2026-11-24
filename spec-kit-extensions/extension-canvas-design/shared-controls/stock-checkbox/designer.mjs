/**
 * Designer adapter: stock.checkbox
 * Required exports: controlId and valueContract must match the shared control;
 * mount and validate must be functions.
 * Value: boolean; field.validation.type is "boolean".
 * field: The Designer supplies canonical id, label, optional description,
 * control, and validation rules; request values cannot redefine these rules.
 * mount: The Designer creates an empty <div> for each control and passes it
 * as root. Render and style only inside that div. onChange(nextValue) updates
 * the unsaved draft without remounting; return { isReady(): boolean }.
 * The Designer requires isReady() === true before Save or Generate, not tab navigation.
 * validate: Return a pure, synchronous boolean using the canonical field.
 * Generate calls it in Node on the value being frozen; false, a throw, or
 * a non-boolean result blocks generation. Do not depend on browser APIs.
 */
export const controlId = "stock.checkbox";
export const valueContract = { type: "boolean" };

export function validate(value, field) {
    return field?.validation?.type === "boolean" && typeof value === "boolean";
}

export function mount({ root, field, value, onChange }) {
    if (!root || typeof root.replaceChildren !== "function"
        || !field?.id || typeof field.label !== "string"
        || field.validation?.type !== "boolean"
        || typeof value !== "boolean" || typeof onChange !== "function") {
        throw new Error("Invalid Designer checkbox control or value");
    }
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `setting-field-${field.id}`;
    label.htmlFor = input.id;
    input.name = field.id;
    input.checked = value;
    let hint;
    if (field.description) {
        label.title = field.description;
        hint = document.createElement("p");
        hint.className = "settings-hint";
        hint.id = `${input.id}-hint`;
        hint.textContent = field.description;
        input.setAttribute("aria-describedby", hint.id);
    }
    input.addEventListener("input", () => onChange(input.checked));
    root.replaceChildren(input, label, ...(hint ? [hint] : []));
    return { isReady: () => true };
}
