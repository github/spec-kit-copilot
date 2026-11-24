export const controlId = "stock.phase-artifact-inputs";
export const contractVersion = 1;
export const declaresMarkdownOutput = true;

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function title(phase) {
    return phase.replace(/^speckit\./, "").replace(/[.-]/g, " ")
        .replace(/^./, (first) => first.toUpperCase());
}

function chooser(label, choices, selected, onSelect, hint) {
    const field = node("label", undefined, "badge-field");
    field.append(node("span", label));
    const select = node("select");
    select.setAttribute("aria-label", label);
    for (const [value, caption] of choices) {
        const option = node("option", caption);
        option.value = value;
        select.append(option);
    }
    select.value = selected;
    select.addEventListener("change", () => onSelect(select.value));
    field.append(select);
    if (hint) field.append(node("small", hint, "settings-note"));
    return field;
}

export function mount({ root, rule, inputs, phases, outputs, onChange, onDeclareFile }) {
    const targetInput = rule.inputs.find((input) => input.type === "artifact");
    const chainInput = rule.inputs.find((input) => input.type === "ordered-artifacts");
    if (!targetInput || targetInput.scope !== "metadata" || !chainInput
        || chainInput.scope !== "metadata" || chainInput.before !== targetInput.id
        || chainInput.minItems) {
        throw new Error("Phase artifact control requires a metadata target and optional ordered upstream artifacts.");
    }
    const initial = Object.keys(inputs).length === 0;
    const choices = (phase) => (outputs[phase]?.outputs ?? []).map((path) => [path, path]);
    if (initial) {
        const phase = phases.find((id) => !/^speckit\.constitution$/.test(id)
            && choices(id).length) ?? phases.find((id) => choices(id).length) ?? phases[0] ?? "";
        inputs[targetInput.id] = { phase, output: outputs[phase]?.view
            ?? choices(phase)[0]?.[0] ?? "" };
        inputs[chainInput.id] = [];
    }
    const target = inputs[targetInput.id];
    const prior = inputs[chainInput.id];
    const emit = () => onChange(structuredClone(inputs));
    if (initial) emit();
    let fileOpen = false;
    const render = () => {
        root.replaceChildren();
        if (!target || !Array.isArray(prior)) {
            root.append(node("p",
                "This saved badge uses older inputs. Remove it and create a new badge.",
                "settings-field-error"));
            return;
        }
        root.append(chooser("Target phase", phases.map((phase) => [phase, title(phase)]),
            target.phase, (phase) => {
                target.phase = phase;
                target.output = outputs[phase]?.view ?? choices(phase)[0]?.[0] ?? "";
                prior.splice(0, prior.length);
                render();
                emit();
            }, "Choose the phase whose output this badge checks."),
        chooser("Required output", choices(target.phase), target.output, (output) => {
            target.output = output;
            render();
            emit();
        }, "This file must exist for the badge to appear."));

        const disclosure = node("details", undefined, "badge-custom-file-disclosure");
        disclosure.open = fileOpen;
        disclosure.addEventListener("toggle", () => { fileOpen = disclosure.open; });
        disclosure.append(node("summary", "Use an output file not listed"),
            node("h4", "Add a Markdown file to the list"));
        const form = node("div", undefined, "badge-custom-file");
        const pathField = node("label", undefined, "badge-field");
        const path = node("input");
        path.type = "text";
        path.maxLength = 1000;
        path.placeholder = "specs/<slug>/plan.md";
        pathField.append(node("span", "Markdown file path"), path);
        const add = node("button", "Add file");
        add.type = "button";
        const fileError = node("p", undefined, "settings-field-error");
        fileError.setAttribute("role", "alert");
        const declare = () => {
            try {
                if (typeof onDeclareFile !== "function") {
                    throw new Error("File declaration is unavailable in this Designer host.");
                }
                const selected = path.value.trim();
                const next = onDeclareFile(target.phase, selected);
                if (!next?.[target.phase]?.outputs?.includes(selected)) {
                    throw new Error("File declaration returned incompatible outputs.");
                }
                outputs = next;
                target.output = selected;
                fileOpen = false;
                render();
                emit();
            } catch (error) {
                fileError.textContent = error instanceof Error ? error.message
                    : "File declaration failed.";
            }
        };
        add.addEventListener("click", declare);
        path.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                declare();
            }
        });
        form.append(pathField, add);
        disclosure.append(form, node("p", "Adds the selected Markdown file to the target phase.",
            "settings-note"), fileError);
        root.append(disclosure, node("h3", "Upstream artifacts to check"));
        const earlier = node("div", undefined, "badge-artifact-set");
        const available = phases.slice(0, phases.indexOf(target.phase));
        const invalid = prior.filter((entry) => !available.includes(entry.phase)
            || !choices(entry.phase).some(([value]) => value === entry.output));
        if (invalid.length) {
            earlier.append(node("p", "Some saved upstream outputs are unavailable.",
                "settings-field-error"));
            const remove = node("button", "Remove unavailable selections");
            remove.type = "button";
            remove.addEventListener("click", () => {
                for (const entry of invalid) prior.splice(prior.indexOf(entry), 1);
                render();
                emit();
            });
            earlier.append(remove);
        }
        for (const phase of available) {
            const entry = prior.find((item) => item.phase === phase);
            const line = node("div", undefined, "badge-output-list");
            const label = node("label", undefined, "badge-check");
            const check = node("input");
            check.type = "checkbox";
            check.checked = !!entry;
            check.disabled = !choices(phase).length;
            check.addEventListener("change", () => {
                const index = prior.findIndex((item) => item.phase === phase);
                if (index >= 0) prior.splice(index, 1);
                if (check.checked) {
                    prior.push({ phase, output: outputs[phase]?.view ?? choices(phase)[0][0] });
                    prior.sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase));
                }
                render();
                emit();
            });
            label.append(check, node("span", title(phase)));
            line.append(label);
            if (entry) line.append(chooser(`${title(phase)} output`, choices(phase),
                entry.output, (value) => {
                    entry.output = value;
                    render();
                    emit();
                }));
            earlier.append(line);
        }
        root.append(earlier, node("h4", "Selected sequence"),
            node("p", prior.length
                ? [...prior, target].map((entry) =>
                    `${title(entry.phase)} (${entry.output.split("/").at(-1)})`).join(" → ")
                : `${title(target.phase)} (${target.output.split("/").at(-1)}) — target output only`,
            "settings-note"));
        const error = node("p", validationError(), "settings-field-error");
        error.setAttribute("role", "alert");
        error.hidden = !error.textContent;
        root.append(error);
    };
    const validationError = () => {
        if (!target || !Array.isArray(prior)
            || !outputs[target.phase]?.outputs?.includes(target.output)) {
            return "Choose a declared target output.";
        }
        const chain = [...prior, target];
        if (chain.some((entry) => !outputs[entry.phase]?.outputs?.includes(entry.output))
            || chain.some((entry, index) => index > 0
                && phases.indexOf(chain[index - 1].phase) >= phases.indexOf(entry.phase))
            || new Set(chain.map((entry) => entry.output.toLowerCase())).size !== chain.length) {
            return "Choose distinct declared outputs in workflow order.";
        }
        return "";
    };
    render();
    return { isReady: () => !validationError(), validationError,
        handlesOutputDeclaration: true,
        selectedPhases: () => [target?.phase].filter((phase) => phases.includes(phase)),
        dispose() { root.replaceChildren(); } };
}
