export const controlId = "stock.value-match-inputs";
export const contractVersion = 1;
export const declaresMarkdownOutput = true;

const textFields = [
    ["summary", "summaryText", "Text shown in workflow summary"],
    ["workflow", "text", "Text shown in workflow list"],
    ["phase", "phaseText", "Text shown on phase card"],
];
const colors = ["theme", "red", "green", "amber", "blue", "purple", "pink", "orange"];
const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
};
const field = (label, input) => {
    const wrapper = node("label", undefined, "badge-field");
    wrapper.append(node("span", label), input);
    return wrapper;
};
const choice = (values, selected, label) => {
    const select = node("select");
    select.setAttribute("aria-label", label);
    for (const [value, title] of values) {
        const option = node("option", title);
        option.value = value;
        select.append(option);
    }
    select.value = selected;
    return select;
};
const foreground = (hex) => {
    const rgb = [1, 3, 5].map((index) => {
        const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    return (luminance + 0.05) / (0.005605 + 0.05) >= 1.05 / (luminance + 0.05)
        ? "#111" : "#fff";
};

export function mount({ root, selectionRoot, rule, inputs, phases, outputs,
    placements, onChange, onDeclareFile }) {
    const artifact = rule.inputs.find((input) => input.type === "artifact");
    const selection = rule.inputs.find((input) => input.type === "badge-selection");
    if (!artifact || !selection || !selectionRoot || !placements) {
        throw new Error("Value match requires an output and a selection editor.");
    }
    let counter = 0;
    let places = { ...placements };
    // Text for an unselected placement is kept here so re-selecting it restores the value.
    const stash = new Map();
    const conform = (entry) => {
        const saved = stash.get(entry.id) ?? {};
        for (const [place, key] of textFields) {
            if (places[place]) entry[key] ??= saved[key] ?? "";
            else if (Object.hasOwn(entry, key)) {
                saved[key] = entry[key];
                delete entry[key];
            }
        }
        stash.set(entry.id, saved);
        return entry;
    };
    const displayText = (entry) => entry.summaryText || entry.text || entry.phaseText || "";
    const matchDescription = (entry) => entry.value.trim()
        ? `If "${entry.value}" is found`
        : "Enter text to find";
    const headingText = (index, entry) => `${index + 1}. ${matchDescription(entry)}`;
    const headingAriaLabel = (index, entry) => `Match ${index + 1}: ${matchDescription(entry)}`;
    const newEntry = () => conform({
        id: globalThis.crypto?.randomUUID?.() ?? `match-${Date.now()}-${counter++}`,
        value: "", color: "amber",
    });
    if (!Object.keys(inputs).length) {
        const phase = phases.find((id) => !id.endsWith("constitution")
            && outputs[id]?.outputs?.length) ?? phases.find((id) => outputs[id]?.outputs?.length) ?? "";
        inputs[artifact.id] = { phase, output: outputs[phase]?.view ?? outputs[phase]?.outputs?.[0] ?? "" };
        inputs[selection.id] = [newEntry()];
    }
    const target = inputs[artifact.id];
    const entries = inputs[selection.id];
    if (!target || !Array.isArray(entries)) throw new Error("Invalid badge selection inputs.");
    entries.forEach(conform);
    const opened = new Set(entries.length ? [entries[0].id] : []);
    // Rows keep their on-screen position; the saved entries array stays in priority order.
    const shown = [...entries];
    const emit = () => onChange(structuredClone(inputs));
    const phaseName = (id) => id.replace(/^speckit\./, "").replace(/[.-]/g, " ")
        .replace(/^./, (first) => first.toUpperCase());
    const phaseSelect = choice(phases.map((id) => [id, phaseName(id)]), target.phase, "Output phase");
    const outputSelect = node("select");
    outputSelect.setAttribute("aria-label", "Output to search");
    const refreshOutputs = () => {
        outputSelect.replaceChildren(...(outputs[target.phase]?.outputs ?? []).map((path) => {
            const option = node("option", path);
            option.value = path;
            return option;
        }));
        outputSelect.value = target.output;
    };
    phaseSelect.addEventListener("change", () => {
        target.phase = phaseSelect.value;
        target.output = outputs[target.phase]?.view ?? outputs[target.phase]?.outputs?.[0] ?? "";
        refreshOutputs();
        emit();
    });
    outputSelect.addEventListener("change", () => { target.output = outputSelect.value; emit(); });
    refreshOutputs();
    root.append(field("Phase", phaseSelect), field("Output to search", outputSelect));
    const declaration = node("details");
    declaration.append(node("summary", "Use an output file not listed"));
    const path = node("input");
    path.type = "text";
    path.maxLength = 1000;
    const addFile = node("button", "Add file");
    addFile.type = "button";
    const declarationError = node("p", undefined, "settings-field-error");
    declarationError.setAttribute("role", "alert");
    addFile.addEventListener("click", () => {
        try {
            const selected = path.value.trim();
            const next = onDeclareFile(target.phase, selected);
            if (!next?.[target.phase]?.outputs?.includes(selected)) {
                throw new Error("File declaration returned incompatible outputs.");
            }
            outputs = next;
            target.output = selected;
            refreshOutputs();
            declaration.open = false;
            declarationError.textContent = "";
            emit();
        } catch (error) {
            declarationError.textContent = error instanceof Error ? error.message : "File declaration failed.";
        }
    });
    declaration.append(field("Markdown file path", path), addFile, declarationError);
    root.append(declaration);
    const render = () => {
        selectionRoot.replaceChildren(node("h3", "Matches (checked in order)"));
        shown.forEach((entry, row) => {
            const index = entries.indexOf(entry);
            const details = node("details", undefined, "badge-selection-entry");
            details.open = opened.has(entry.id);
            details.addEventListener("toggle", () => {
                if (details.open) opened.add(entry.id);
                else opened.delete(entry.id);
            });
            const heading = node("summary", headingText(index, entry));
            heading.setAttribute("aria-label", headingAriaLabel(index, entry));
            details.append(heading);
            const order = choice(entries.map((_, position) =>
                [String(position + 1), String(position + 1)]), String(index + 1), "Order");
            order.disabled = entries.length === 1;
            order.addEventListener("change", () => {
                const to = Number(order.value) - 1;
                if (!Number.isInteger(to) || to < 0 || to >= entries.length || to === index) return;
                entries.splice(to, 0, entries.splice(index, 1)[0]);
                emit();
                render();
                selectionRoot.querySelectorAll("details")[row]?.querySelector("select")?.focus();
            });
            details.append(field("Order", order));
            const preview = node("span", undefined, "badge-preview");
            const updatePreview = () => {
                const text = displayText(entry);
                const hasText = !!text.trim();
                preview.textContent = hasText ? text : "Preview";
                preview.className = hasText ? "badge-preview" : "badge-preview badge-preview-empty";
                preview.dataset.color = entry.color;
                preview.style.backgroundColor = hasText && entry.color.startsWith("#") ? entry.color : "";
                preview.style.color = hasText && entry.color.startsWith("#") ? foreground(entry.color) : "";
            };
            const input = (title, property, maxLength) => {
                const element = node("input");
                element.type = "text";
                element.maxLength = maxLength;
                element.value = entry[property];
                element.placeholder = property === "value" ? "Enter text to find" : "Enter display text";
                element.addEventListener("input", () => {
                    entry[property] = element.value;
                    if (property === "value") {
                        heading.textContent = headingText(index, entry);
                        heading.setAttribute("aria-label", headingAriaLabel(index, entry));
                    } else updatePreview();
                    emit();
                });
                return field(title, element);
            };
            details.append(input("Text to find", "value", 256));
            for (const [place, key, title] of textFields) {
                if (!places[place]) continue;
                details.append(input(title, key, 120));
            }
            const select = choice([...colors.map((color) => [color, color]), ["custom", "Custom color"]],
                colors.includes(entry.color) ? entry.color : "custom", "Color");
            const custom = node("input");
            custom.type = "color";
            custom.value = /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : "#0b6e99";
            const customField = field("Custom color", custom);
            customField.hidden = select.value !== "custom";
            const setColor = () => {
                customField.hidden = select.value !== "custom";
                entry.color = customField.hidden ? select.value : custom.value;
                updatePreview();
                emit();
            };
            select.addEventListener("change", setColor);
            custom.addEventListener("input", setColor);
            const colorPreview = node("div", undefined, "badge-color-preview-row");
            colorPreview.append(field("Color", select), preview);
            updatePreview();
            details.append(colorPreview, customField);
            const remove = node("button", "Remove match");
            remove.type = "button";
            remove.disabled = entries.length === 1;
            remove.addEventListener("click", () => {
                entries.splice(index, 1);
                shown.splice(row, 1);
                opened.delete(entry.id);
                emit();
                render();
            });
            details.append(remove);
            selectionRoot.append(details);
        });
        const add = node("button", "+ Add match");
        add.type = "button";
        add.disabled = entries.length >= 100;
        add.addEventListener("click", () => {
            const entry = newEntry();
            entries.push(entry);
            shown.push(entry);
            opened.add(entry.id);
            emit();
            render();
        });
        selectionRoot.append(add);
    };
    render();
    emit();
    return {
        handlesOutputDeclaration: true,
        selectedPhases: () => target.phase ? [target.phase] : [],
        updatePlacements(next) {
            places = { ...next };
            entries.forEach(conform);
            render();
            emit();
        },
        isReady: () => !!target.phase && !!target.output && entries.length > 0
            && entries.every((entry) => entry.value.trim() && textFields.every(([place, key]) =>
                !places[place] || entry[key]?.trim() && !/[{}]/.test(entry[key]))),
        validationError: () => "Complete every match, including text for each selected placement, and choose an output before saving.",
    };
}
