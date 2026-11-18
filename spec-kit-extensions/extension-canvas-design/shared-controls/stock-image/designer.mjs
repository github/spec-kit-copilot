/**
 * Designer adapter: stock.image
 * Required exports: controlId and valueContract must match the shared control;
 * mount and validate must be functions.
 * Value: an empty string or an image data URI bounded by field.validation.maxBytes
 * and field.validation.mimeTypes.
 * field: The Designer supplies canonical id, label, optional description,
 * control, and validation rules; request values cannot redefine these rules.
 * mount: The Designer creates an empty <div> for each control and passes it
 * as root, with context.setBusy(busy) to block actions during an upload.
 * Render and style only inside that div. onChange(nextValue) updates
 * the unsaved draft without remounting; return { isReady(): boolean }.
 * The Designer requires isReady() === true before Save or Generate, not tab navigation.
 * isReady is false during an upload or after failure until retry or cancellation.
 * validate: Return a pure, synchronous boolean using the canonical field.
 * Generate calls it in Node on the value being frozen; false, a throw, or
 * a non-boolean result blocks generation. Do not depend on browser APIs.
 */
export const controlId = "stock.image";
export const valueContract = {
    type: "image",
    maxBytes: 32768,
    mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
};

export function validate(value, field) {
    const rules = field?.validation;
    if (rules?.type !== "image" || !Number.isInteger(rules.maxBytes)
        || !Array.isArray(rules.mimeTypes) || typeof value !== "string") return false;
    if (value === "") return true;
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(value);
    if (!match || !rules.mimeTypes.includes(match[1])
        || match[2].length > Math.ceil(rules.maxBytes / 3) * 4) return false;
    const bytes = atob(match[2]);
    const signature = {
        "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
        "image/jpeg": [255, 216, 255],
        "image/gif": [71, 73, 70, 56],
        "image/webp": [82, 73, 70, 70],
    }[match[1]];
    return bytes.length > 0 && bytes.length <= rules.maxBytes
        && signature.every((byte, index) => bytes.charCodeAt(index) === byte)
        && (match[1] !== "image/png" || bytes.length >= 24 && bytes.slice(12, 16) === "IHDR")
        && (match[1] !== "image/jpeg" || bytes.length >= 5
            && bytes.charCodeAt(bytes.length - 2) === 255 && bytes.charCodeAt(bytes.length - 1) === 217)
        && (match[1] !== "image/gif" || bytes.length >= 14
            && ["GIF87a", "GIF89a"].includes(bytes.slice(0, 6)))
        && (match[1] !== "image/webp" || bytes.length >= 16
            && bytes.slice(8, 12) === "WEBP"
            && new DataView(new Uint8Array([...bytes.slice(4, 8)]
                .map((character) => character.charCodeAt(0))).buffer).getUint32(0, true) + 8 === bytes.length);
}

export function mount({ root, field, value, onChange, context }) {
    const rules = field?.validation;
    const setBusy = context?.setBusy;
    if (!root || typeof root.replaceChildren !== "function"
        || !field || typeof field.label !== "string"
        || typeof value !== "string" || rules?.type !== "image"
        || rules.maxBytes !== valueContract.maxBytes
        || JSON.stringify(rules.mimeTypes) !== JSON.stringify(valueContract.mimeTypes)
        || typeof onChange !== "function" || typeof setBusy !== "function") {
        throw new Error("Invalid Designer image control or value");
    }
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const label = element("label", field.label);
    const input = element("input");
    input.type = "file";
    input.accept = rules.mimeTypes.join(",");
    input.id = `setting-field-${field.id}`;
    label.htmlFor = input.id;
    const uploadError = element("p", undefined, "settings-image-error");
    uploadError.id = `${input.id}-error`;
    uploadError.setAttribute("role", "alert");
    uploadError.hidden = true;
    const hint = field.description ? element("p", field.description, "settings-hint") : null;
    if (hint) hint.id = `${input.id}-hint`;
    input.setAttribute("aria-describedby", [hint?.id, uploadError.id].filter(Boolean).join(" "));
    const setUploadError = (message) => {
        uploadError.textContent = message;
        uploadError.hidden = !message;
        if (message) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
    };
    const preview = element("img");
    preview.alt = `${field.label} preview`;
    const controls = element("div", undefined, "image-controls");
    const remove = element("button", "Remove", "image-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${field.label} image`);
    const cancel = element("button", "Cancel upload", "image-remove");
    cancel.type = "button";
    cancel.hidden = true;
    let pending = false;
    let failed = false;
    let request = 0;
    const fail = (message) => {
        failed = true;
        setUploadError(message);
        cancel.hidden = false;
    };
    const refresh = () => {
        const selected = !!value;
        preview.hidden = !selected;
        if (selected && validate(value, field)) preview.src = value;
        else preview.removeAttribute("src");
        remove.hidden = !selected;
    };
    input.addEventListener("change", async () => {
        if (pending) return;
        const file = input.files?.[0];
        if (!file) return;
        if (!rules.mimeTypes.includes(file.type)
            || !file.size || file.size > rules.maxBytes) {
            input.value = "";
            fail(file.size > rules.maxBytes
                ? `${field.label} is too large (${file.size.toLocaleString()} bytes). Maximum: ${rules.maxBytes.toLocaleString()} bytes (32 KiB).`
                : `${field.label} must be a nonempty PNG, JPEG, GIF, or WebP image.`);
            return;
        }
        const current = ++request;
        pending = true;
        failed = false;
        input.disabled = true;
        remove.disabled = true;
        cancel.hidden = true;
        setBusy(true);
        setUploadError("");
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const content = `data:${file.type};base64,${btoa(
                Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
            if (!validate(content, field)) throw new Error("Image bytes do not match the selected format.");
            await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = resolve;
                image.onerror = () => reject(new Error("Image cannot be displayed."));
                image.src = content;
            });
            if (current !== request || !root.isConnected) return;
            onChange(content);
            value = content;
            refresh();
        } catch (error) {
            if (current === request && root.isConnected) {
                fail(`Could not load ${field.label}: ${error.message}`);
            }
        } finally {
            if (current === request) {
                pending = false;
                input.value = "";
                input.disabled = false;
                remove.disabled = false;
                setBusy(false);
            }
        }
    });
    remove.addEventListener("click", () => {
        onChange("");
        value = "";
        refresh();
        setUploadError("");
    });
    cancel.addEventListener("click", () => {
        if (pending) return;
        failed = false;
        cancel.hidden = true;
        setUploadError("");
    });
    controls.append(input, remove, cancel);
    root.classList.add("settings-image-content");
    root.replaceChildren(label, preview, controls, uploadError);
    if (hint) root.append(hint);
    refresh();
    return { isReady: () => !pending && !failed };
}
