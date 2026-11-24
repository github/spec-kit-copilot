export const controlId = "stock.ordered-stale-inputs";
export const contractVersion = 1;

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

function chooser(label, choices, selected, onSelect) {
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
    return field;
}

export function mount({ root, rule, inputs, phases, outputs, onChange }) {
    const targetInput = rule.inputs.find((input) => input.type === "artifact");
    const chainInput = rule.inputs.find((input) => input.type === "ordered-artifacts");
    if (!targetInput || targetInput.scope !== "metadata" || !chainInput
        || chainInput.before !== targetInput.id || chainInput.minItems !== 1) {
        throw new Error("Stale control requires a metadata target and a nonempty ordered metadata chain.");
    }
    const initial = Object.keys(inputs).length === 0;
    if (initial) {
        const phase = [...phases].reverse().find((id) => outputs[id]?.outputs?.length)
            ?? phases[0] ?? "";
        inputs[targetInput.id] = { phase, output: outputs[phase]?.view
            ?? outputs[phase]?.outputs?.[0] ?? "" };
        inputs[chainInput.id] = [];
    }
    const emit = () => onChange(structuredClone(inputs));
    if (initial) emit();
    const target = inputs[targetInput.id];
    const prior = inputs[chainInput.id];
    const earlier = node("div", undefined, "badge-artifact-set");
    const error = node("p", undefined, "settings-field-error");
    error.setAttribute("role", "alert");
    const choices = (phase) => (outputs[phase]?.outputs ?? []).map((path) => [path, path]);
    const render = () => {
        root.replaceChildren();
        if (!target || !Array.isArray(prior)) {
            root.append(node("p",
                "This saved Artifact stale badge uses older inputs. Remove it and create a new badge.",
                "settings-field-error"));
            return;
        }
        root.append(chooser("Target phase", phases.map((phase) => [phase, title(phase)]),
            target.phase, (phase) => {
                target.phase = phase;
                target.output = outputs[phase]?.view ?? outputs[phase]?.outputs?.[0] ?? "";
                prior.splice(0, prior.length);
                render();
                emit();
            }), chooser("Output to check", choices(target.phase), target.output, (output) => {
                target.output = output;
                render();
                emit();
            }), node("h3", "Which earlier outputs must be checked?"), earlier);
        earlier.replaceChildren();
        for (const phase of phases.slice(0, phases.indexOf(target.phase))) {
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
                    prior.push({ phase, output: outputs[phase]?.view ?? outputs[phase].outputs[0] });
                    prior.sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase));
                }
                render();
                emit();
            });
            label.append(check, node("span", title(phase)));
            line.append(label);
            if (entry) line.append(chooser(`${title(phase)} output`, choices(phase),
                entry.output, (output) => {
                    entry.output = output;
                    render();
                    emit();
                }));
            earlier.append(line);
        }
        root.append(node("h3", "When this badge appears"),
            node("p", "The target file must exist. A missing selected earlier file or an earlier file newer than a later one makes the target stale. Equal timestamps are current. Missing target files show no badge; unreadable evidence produces a diagnostic. These are rules, not current file status.",
                "settings-note"), error);
        error.textContent = validationError();
        error.hidden = !error.textContent;
    };
    const validationError = () => {
        if (!target || !Array.isArray(prior)
            || !outputs[target.phase]?.outputs?.includes(target.output)) {
            return "Choose a declared output to check.";
        }
        if (!prior.length) return "Select at least one earlier output.";
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
        dispose() { root.replaceChildren(); } };
}
