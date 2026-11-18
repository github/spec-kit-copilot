export function mountIdentity({ root, fields, values, invalidFieldId, onChange }) {
    const handles = new Map();
    for (const field of fields) {
        const wrapper = document.createElement("div");
        wrapper.className = "settings-field";
        wrapper.tabIndex = -1;
        wrapper.setAttribute("role", "group");
        wrapper.setAttribute("aria-label", field.label);
        const mount = document.createElement("div");
        mount.dataset.fieldId = field.id;
        const label = document.createElement("label");
        label.textContent = field.label;
        const input = document.createElement("input");
        input.type = "text";
        input.id = `setting-field-${field.id}`;
        input.name = field.id;
        input.value = values[field.id];
        input.required = true;
        input.maxLength = field.validation.maxLength;
        if (field.validation.pattern) input.pattern = field.validation.pattern;
        label.htmlFor = input.id;
        const required = document.createElement("span");
        required.className = "muted";
        required.textContent = " (required)";
        label.append(required);
        mount.append(label, input);
        if (field.description) {
            label.title = field.description;
            const hint = document.createElement("p");
            hint.className = "settings-hint";
            hint.id = `${input.id}-hint`;
            hint.textContent = field.description;
            input.setAttribute("aria-describedby", hint.id);
            mount.append(hint);
        }
        const error = document.createElement("p");
        error.className = "settings-field-error";
        error.id = `setting-error-${field.id}`;
        error.textContent = `Invalid ${field.label} (${field.id}).`;
        error.setAttribute("role", "alert");
        error.hidden = field.id !== invalidFieldId;
        wrapper.setAttribute("aria-describedby", error.id);
        wrapper.append(mount, error);
        root.append(wrapper);
        if (!error.hidden) wrapper.focus();
        input.addEventListener("input", () => {
            error.hidden = true;
            onChange(field.id, input.value);
        });
        handles.set(field.id, { isReady: () => true });
    }
    return handles;
}
