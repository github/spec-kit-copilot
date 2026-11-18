export const controlId = "stock.checklist-inputs";
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
    const initial = Object.keys(inputs).length === 0;
    const checklistInput = rule.inputs.find((input) => input.type === "artifact");
    const chainInput = rule.inputs.find((input) => input.type === "ordered-artifacts");
    const targetInput = rule.inputs.find((input) => input.type === "phase");
    if (!checklistInput || !chainInput || !targetInput
        || chainInput.before !== checklistInput.id || chainInput.minItems !== 1) {
        throw new Error("Checklist control requires a file, an ordered currentness chain, and a target phase.");
    }
    const checklistPath = (phase) =>
        outputs[phase]?.outputs?.find((path) => /\.md$/i.test(path)) ?? "";
    const evidencePhase = [...phases].reverse().find((phase) => checklistPath(phase))
        ?? phases[0] ?? "";
    const targetPhases = phases.filter((phase) =>
        phase.replace(/^speckit\./, "") !== "constitution");
    if (initial) {
        inputs[checklistInput.id] = {
            phase: evidencePhase,
            output: checklistPath(evidencePhase),
        };
        inputs[chainInput.id] = [];
        inputs[targetInput.id] = targetPhases.includes(evidencePhase)
            ? evidencePhase : targetPhases[0] ?? "";
    }
    const emit = () => onChange(structuredClone(inputs));
    if (initial) emit();
    const file = inputs[checklistInput.id];
    const prior = inputs[chainInput.id];
    const error = node("p", undefined, "settings-field-error");
    error.setAttribute("role", "alert");
    const earlier = node("div", undefined, "badge-artifact-set");
    const isProgress = rule.id === "checklist-progress";
    let customOpen = false;
    const phaseChoices = targetPhases.map((phase) => [phase, title(phase)]);
    const evidenceChoices = phases.map((phase) => [phase, title(phase)]);
    const outputChoices = (phase) =>
        (outputs[phase]?.outputs ?? []).map((path) => [path, path]);
    const render = () => {
        root.replaceChildren();
        if (!file || !Array.isArray(prior) || !Object.hasOwn(inputs, targetInput.id)) {
            root.append(node("p",
                "This saved checklist badge uses older inputs. Remove it and create a new badge.",
                "settings-field-error"));
            return;
        }
        root.append(chooser("Applies to phase", phaseChoices, inputs[targetInput.id], (value) => {
            inputs[targetInput.id] = value;
            render();
            emit();
        }, `This badge describes ${isProgress ? "progress" : "completion"} for the selected phase.`),
        chooser("Evidence phase", evidenceChoices, file.phase, (value) => {
            file.phase = value;
            file.output = checklistPath(value);
            prior.splice(0, prior.length);
            render();
            emit();
        }, `${title(file.phase)} supplies the checklist used as evidence for ${title(inputs[targetInput.id])}.`),
        chooser("Checklist file", outputChoices(file.phase), file.output, (value) => {
            file.output = value;
            render();
            emit();
        }, "Only this file's checkboxes are counted. The file does not need to exist yet."));
        const disclosure = node("details", undefined, "badge-custom-file-disclosure");
        disclosure.open = customOpen;
        disclosure.addEventListener("toggle", () => { customOpen = disclosure.open; });
        disclosure.append(node("summary", "Use a checklist file not listed"));
        disclosure.append(node("h4", "Add a Markdown file to the list"));
        const form = node("div", undefined, "badge-custom-file");
        const input = node("input");
        input.type = "text";
        input.maxLength = 1000;
        input.placeholder = "specs/<slug>/tasks.md";
        const pathField = node("label", undefined, "badge-field");
        pathField.append(node("span", "Markdown file path"), input);
        const add = node("button", "Add file");
        add.type = "button";
        const fileError = node("p", undefined, "settings-field-error");
        fileError.setAttribute("role", "alert");
        const declare = () => {
            try {
                if (typeof onDeclareFile !== "function") {
                    throw new Error("File declaration is unavailable in this Designer host.");
                }
                const path = input.value.trim();
                outputs = onDeclareFile(file.phase, path);
                if (!outputs?.[file.phase]?.outputs?.includes(path)) {
                    throw new Error("File declaration returned incompatible outputs.");
                }
                file.output = path;
                customOpen = false;
                render();
                emit();
            } catch (cause) {
                fileError.textContent = cause instanceof Error ? cause.message
                    : "File declaration failed.";
            }
        };
        add.addEventListener("click", declare);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                declare();
            }
        });
        form.append(pathField, add);
        disclosure.append(form, node("p", "Adds the selected Markdown file to the evidence phase.",
            "settings-note"), fileError);
        root.append(disclosure, node("h3", "Upstream artifacts to check"),
            node("p", "Select the earlier artifacts that must be current before this badge appears.",
                "settings-note"), earlier);
        earlier.replaceChildren();
        for (const phase of phases.slice(0, phases.indexOf(file.phase))) {
            const entry = prior.find((item) => item.phase === phase);
            const line = node("div", undefined, "badge-output-list");
            const label = node("label", undefined, "badge-check");
            const check = node("input");
            check.type = "checkbox";
            check.checked = !!entry;
            check.disabled = !outputChoices(phase).length;
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
            if (entry) line.append(chooser(`${title(phase)} output`,
                outputChoices(phase), entry.output, (value) => {
                    entry.output = value;
                    render();
                    emit();
                }));
            earlier.append(line);
        }
        root.append(node("h4", "Selected sequence"),
            node("p", prior.length
                ? [...prior, file].map((entry) => `${title(entry.phase)} (${entry.output.split("/").at(-1)})`)
                    .join(" → ")
                : "Select at least one upstream artifact.", "settings-note"),
            node("p", "Each upstream artifact must exist. Each later file—including the checklist—"
                + "must be at least as recent as the one before it.", "settings-note"), error);
        error.textContent = validationError();
        error.hidden = !error.textContent;
    };
    const validationError = () => {
        if (!file || !Array.isArray(prior) || !targetPhases.includes(inputs[targetInput.id]))
            return "Choose a workflow target phase and checklist.";
        if (!outputs[file.phase]?.outputs?.includes(file.output)) {
            return "Choose a declared checklist file on the evidence phase.";
        }
        if (!prior.length) return "Configure currentness by selecting an earlier output.";
        const chain = [...prior, file];
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
        selectedPhases: () => [inputs[targetInput.id]]
            .filter((phase) => targetPhases.includes(phase)),
        dispose() { root.replaceChildren(); } };
}
