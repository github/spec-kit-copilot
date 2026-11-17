export const controlId = "preview.badge-inputs";
export const contractVersion = 1;

export function mount({ root, selectionRoot, rule, inputs, phases, outputs, onChange }) {
    const value = { ...inputs };
    let ready = true;
    for (const input of rule.inputs) {
        if (input.type === "badge-selection") {
            const hint = document.createElement("p");
            hint.textContent = "Open the installed Designer to edit match entries.";
            selectionRoot.append(hint);
            ready = false;
            continue;
        }
        const label = document.createElement(input.type === "ordered-artifacts"
            ? "fieldset" : "label");
        if (input.type === "ordered-artifacts") {
            const legend = document.createElement("legend");
            legend.textContent = input.label ?? input.id;
            label.append(legend);
            value[input.id] ??= [];
            const candidates = phases.flatMap((phase) =>
                (outputs[phase]?.outputs ?? []).map((output) => ({ phase, output })));
            const boxes = [];
            for (const candidate of candidates) {
                const row = document.createElement("label");
                const check = document.createElement("input");
                check.type = "checkbox";
                check.checked = value[input.id].some((entry) =>
                    entry.phase === candidate.phase && entry.output === candidate.output);
                check.addEventListener("change", () => {
                    value[input.id] = candidates.filter((_, index) => boxes[index].checked);
                    onChange(structuredClone(value));
                });
                boxes.push(check);
                row.append(check, `${candidate.phase}: ${candidate.output}`);
                label.append(row);
            }
            root.append(label);
            continue;
        }
        label.textContent = input.label ?? input.id;
        const field = document.createElement(input.type === "text" ? "input" : "select");
        if (input.type === "text") {
            field.value = value[input.id] ?? "";
            value[input.id] = field.value;
            field.addEventListener("input", () => {
                value[input.id] = field.value;
                onChange({ ...value });
            });
        } else {
            const choices = input.type === "phase"
                ? phases.map((phase) => ({ label: phase, value: phase }))
                : phases.flatMap((phase) => (outputs[phase]?.outputs ?? []).map((output) =>
                    ({ label: `${phase}: ${output}`, value: JSON.stringify({ phase, output }) })));
            for (const choice of choices) {
                const option = document.createElement("option");
                option.value = choice.value;
                option.textContent = choice.label;
                field.append(option);
            }
            if (input.type === "phase") {
                value[input.id] ??= choices[0]?.value ?? "";
                field.value = value[input.id];
                if (!choices.length) ready = false;
            } else if (input.type === "artifact") {
                value[input.id] ??= choices.length
                    ? JSON.parse(choices[0].value) : { phase: "", output: "" };
                field.value = JSON.stringify(value[input.id]);
                if (!choices.length) ready = false;
            } else {
                ready = false;
                const hint = document.createElement("span");
                hint.textContent = "Open the installed Designer to edit this input.";
                label.append(hint);
                field.disabled = true;
            }
            field.addEventListener("change", () => {
                value[input.id] = input.type === "phase" ? field.value : JSON.parse(field.value);
                onChange({ ...value });
            });
        }
        label.append(field);
        root.append(label);
    }
    if (ready) onChange(structuredClone(value));
    return { isReady: () => ready && rule.inputs.every((input) =>
        input.type === "text" ? !!value[input.id]?.trim()
            : input.type === "phase" ? phases.includes(value[input.id])
                : input.type === "artifact" ? outputs[value[input.id]?.phase]?.outputs
                    ?.includes(value[input.id]?.output)
                    : input.type === "ordered-artifacts" ? Array.isArray(value[input.id])
                        : false)
        && (!rule.inputs.some((input) => input.type === "ordered-artifacts")
            || rule.inputs.filter((input) => input.type === "ordered-artifacts").every((input) => {
                const chain = [...(value[input.id] ?? []), value[input.before]];
                return chain.length > (input.minItems ?? 0)
                    && chain.every((entry, index) => index === 0
                        || phases.indexOf(chain[index - 1].phase) < phases.indexOf(entry.phase))
                    && new Set(chain.map((entry) => entry.output.toLowerCase())).size
                        === chain.length;
            })),
        selectedPhases: () => value.targetphase ? [value.targetphase] : [],
        ...(rule.inputs.some((input) => input.type === "badge-selection")
            ? { updatePlacements() {} } : {}) };
}
