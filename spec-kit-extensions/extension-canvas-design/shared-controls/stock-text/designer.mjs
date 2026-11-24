/**
 * Designer adapter: stock.text
 * Required exports: controlId and valueContract must match the shared control;
 * mount and validate must be functions.
 * Value: string; field.validation defines maxLength and optional minLength,
 * required, pattern, and forbiddenValues rules.
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
export const controlId = "stock.text";
export const valueContract = { type: "string" };

export function validate(value, field) {
    const rules = field?.validation;
    return rules?.type === "string" && typeof value === "string"
        && value.length >= (rules.minLength ?? 0)
        && value.length <= rules.maxLength
        && (!rules.required || !!value.trim())
        && (!rules.pattern || new RegExp(rules.pattern).test(value))
        && !(rules.forbiddenValues ?? []).includes(value);
}

export function mount({ root, field, value, onChange }) {
    const rules = field?.validation;
    if (!root || typeof root.replaceChildren !== "function"
        || !field?.id || typeof field.label !== "string"
        || rules?.type !== "string" || !Number.isInteger(rules.maxLength)
        || typeof value !== "string" || typeof onChange !== "function") {
        throw new Error("Invalid Designer text control or value");
    }
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement("input");
    input.type = "text";
    input.id = `setting-field-${field.id}`;
    label.htmlFor = input.id;
    input.name = field.id;
    input.value = value;
    input.required = rules.required === true || (rules.minLength ?? 0) > 0;
    input.maxLength = rules.maxLength;
    if (rules.pattern) input.pattern = rules.pattern;
    if (input.required) {
        const required = document.createElement("span");
        required.className = "muted";
        required.textContent = " (required)";
        label.append(required);
    }
    root.replaceChildren(label, input);
    if (field.description) {
        label.title = field.description;
        const hint = document.createElement("p");
        hint.className = "settings-hint";
        hint.id = `${input.id}-hint`;
        hint.textContent = field.description;
        input.setAttribute("aria-describedby", hint.id);
        root.append(hint);
    }
    input.addEventListener("input", () => onChange(input.value));
    return { isReady: () => true };
}
