export const controlId = "stock.badge-inputs";
export const contractVersion = 1;
export const declaresMarkdownOutput = true;

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function select(options, value, label) {
    const node = element("select");
    node.setAttribute("aria-label", label);
    for (const [id, name] of options) {
        const option = element("option", name);
        option.value = id;
        node.append(option);
    }
    node.value = value;
    return node;
}

function field(title, control, hint) {
    const wrapper = element("label", undefined, "badge-field");
    wrapper.append(element("span", title), control);
    if (hint) wrapper.append(element("small", hint, "muted"));
    return wrapper;
}

function phaseOptions(phases) {
    return phases.map((phase) => [phase, phase.replace(/^speckit\./, "")
        .replace(/[.-]/g, " ").replace(/^./, (first) => first.toUpperCase())]);
}

function artifactOptions(outputs, phase) {
    return (outputs[phase]?.outputs ?? []).map((path) => [path, path]);
}

function initializeInputs(rule, inputs, phases, outputs) {
    const fresh = Object.keys(inputs).length === 0;
    const defaultPhase = phases.find((phase) =>
        phase?.replace(/^speckit\./, "") !== "constitution") ?? "";
    const first = Object.keys(outputs).find((phase) =>
        phase?.replace(/^speckit\./, "") !== "constitution" && outputs[phase]?.outputs?.length);
    const initial = first
        ? { phase: first, output: outputs[first].view ?? outputs[first].outputs[0] }
        : { phase: "", output: "" };
    for (const descriptor of rule.inputs ?? []) {
        const value = inputs[descriptor.id];
        if (descriptor.type === "phase" && (fresh || value === undefined)) {
            inputs[descriptor.id] = defaultPhase;
        } else if (descriptor.type === "text" && (fresh || typeof value !== "string")) {
            inputs[descriptor.id] = "";
        } else if (descriptor.type === "artifact" && (fresh || !value)) {
            inputs[descriptor.id] = fresh ? { ...initial } : { phase: "", output: "" };
        } else if (descriptor.type === "ordered-artifacts" && !Array.isArray(value)) {
            inputs[descriptor.id] = [];
        } else if (descriptor.type === "artifact-set" && !Array.isArray(value)) {
            inputs[descriptor.id] = initial.phase
                ? [{ phase: initial.phase, outputs: [initial.output] }] : [];
        }
    }
    if (fresh && rule.id === "checklist-complete") {
        const prior = phases.find((phase) => outputs[phase]?.outputs?.length);
        const firstOutput = outputs[prior]?.view ?? outputs[prior]?.outputs?.[0];
        const checklist = prior && phases.find((phase) => phases.indexOf(phase) > phases.indexOf(prior)
            && outputs[phase]?.outputs?.some((path) =>
                path.toLowerCase() !== firstOutput.toLowerCase()));
        inputs.prerequisite = prior
            ? { phase: prior, output: firstOutput } : { phase: "", output: "" };
        inputs.artifact = checklist
            ? { phase: checklist, output: outputs[checklist].outputs.find((path) =>
                path.toLowerCase() !== inputs.prerequisite.output.toLowerCase()) }
            : { phase: "", output: "" };
    }
}

export function mount({ root, rule, inputs, phases, outputs, onChange, onDeclareFile }) {
    initializeInputs(rule, inputs, phases, outputs);
    const pending = { inputs, id: globalThis.crypto?.randomUUID?.() ?? `badge-${Date.now()}` };
    const emitChange = () => onChange(structuredClone(pending.inputs));
    emitChange();
    const editor = root;
    const phaseChoices = phaseOptions(phases);
    const fileDeclaration = (phase, onAdded) => {
        const disclosure = element("details", undefined, "badge-custom-file-disclosure");
        disclosure.append(element("summary", "Use a Markdown file not listed"),
            element("h4", "Add a Markdown file to the list"));
        const form = element("div", undefined, "badge-custom-file");
        const path = element("input");
        path.type = "text";
        path.maxLength = 1000;
        path.placeholder = "specs/<slug>/notes.md";
        form.append(field("Markdown file path", path));
        const add = element("button", "Add file");
        add.type = "button";
        const error = element("p", undefined, "badge-declaration-error");
        error.setAttribute("role", "alert");
        const declare = () => {
            try {
                if (typeof onDeclareFile !== "function") {
                    throw new Error("File declaration is unavailable in this Designer host.");
                }
                const id = phase();
                const selected = path.value.trim();
                const next = onDeclareFile(id, selected);
                if (!next?.[id]?.outputs?.includes(selected)) {
                    throw new Error("File declaration returned incompatible outputs.");
                }
                outputs = next;
                onAdded(id, selected);
                disclosure.open = false;
                path.value = "";
                error.textContent = "";
            } catch (cause) {
                error.textContent = cause instanceof Error ? cause.message : "File declaration failed.";
            }
        };
        add.addEventListener("click", declare);
        path.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                declare();
            }
        });
        form.append(add);
        disclosure.append(form, element("p",
            "Adds an expected phase output for badges and additional output links, without changing the default View target.",
            "settings-note"), error);
        return disclosure;
    };
    const ordered = (rule.inputs ?? []).find(({ type }) => type === "ordered-artifacts");
    if (ordered) {
        const target = pending.inputs[ordered.before];
        const targetPhase = select(phaseChoices, target.phase, "Target phase");
        const targetOutput = select(artifactOptions(outputs, target.phase),
            target.output, "Target output");
        const targetWarning = element("p",
            "This phase has no confirmed matching output. Declare a Markdown file or select a different phase.",
            "settings-field-error");
        const earlierGroup = element("div", undefined, "badge-artifact-set");
        const explanation = element("div", undefined, "settings-note");
        const refresh = () => {
            targetOutput.replaceChildren(...artifactOptions(outputs, target.phase).map(([path]) => {
                const option = element("option", path);
                option.value = path;
                return option;
            }));
            targetOutput.value = target.output;
            targetWarning.hidden = !!outputs[target.phase]?.outputs?.includes(target.output);
            earlierGroup.replaceChildren();
            const prerequisites = pending.inputs[ordered.id];
            const earlier = phases.slice(0, phases.indexOf(target.phase));
            const invalid = prerequisites.filter((entry) => !earlier.includes(entry.phase)
                || !outputs[entry.phase]?.outputs?.includes(entry.output));
            if (invalid.length) {
                earlierGroup.append(element("p",
                    "Some saved choices are no longer earlier confirmed outputs. Remove or correct them before saving.",
                    "settings-field-error"));
                const remove = element("button", "Remove unavailable selections");
                remove.type = "button";
                remove.addEventListener("click", () => {
                    pending.inputs[ordered.id] = prerequisites.filter((entry) => !invalid.includes(entry));
                    refresh();
                    emitChange();
                });
                earlierGroup.append(remove);
            }
            const setChoice = (id, output) => {
                const remaining = pending.inputs[ordered.id]
                    .filter((entry) => entry.phase !== id);
                if (output) remaining.push({ phase: id, output });
                pending.inputs[ordered.id] = remaining.sort((a, b) =>
                    phases.indexOf(a.phase) - phases.indexOf(b.phase));
                refresh();
                emitChange();
            };
            for (const id of earlier) {
                const title = phaseOptions([id])[0][1];
                const selected = prerequisites.find((entry) => entry.phase === id);
                const label = element("label", undefined, "badge-check");
                const checkbox = element("input");
                checkbox.type = "checkbox";
                checkbox.checked = !!selected;
                checkbox.disabled = !outputs[id]?.outputs?.length;
                checkbox.addEventListener("change", () =>
                    setChoice(id, checkbox.checked
                        ? outputs[id]?.view ?? outputs[id].outputs[0] : null));
                label.append(checkbox, element("span", title));
                earlierGroup.append(label);
                if (checkbox.disabled) {
                    earlierGroup.append(element("p",
                        `No confirmed outputs for ${title}. Declare a Markdown file in a badge editor for this phase.`,
                        "settings-note"));
                }
                if (!selected) continue;
                const outputList = element("div", undefined, "badge-output-list");
                outputList.setAttribute("role", "radiogroup");
                outputList.setAttribute("aria-label", `${title} outputs`);
                for (const [path] of artifactOptions(outputs, id)) {
                    const option = element("label", undefined, "badge-check");
                    const radio = element("input");
                    radio.type = "radio";
                    radio.name = `badge-${pending.id}-${id}`;
                    radio.checked = selected.output === path;
                    radio.addEventListener("change", () => { if (radio.checked) setChoice(id, path); });
                    option.append(radio, element("span", path));
                    outputList.append(option);
                }
                earlierGroup.append(outputList);
            }
            explanation.replaceChildren();
            const chain = [...pending.inputs[ordered.id]
                .filter((entry) => earlier.includes(entry.phase)
                    && outputs[entry.phase]?.outputs?.includes(entry.output))
                .sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase)), target];
            for (const [index, entry] of chain.entries()) {
                const title = phaseOptions([entry.phase])[0][1];
                explanation.append(element("p", index
                    ? `${title}: ${entry.output} must exist and be at least as recent as ${chain[index - 1].output}.`
                    : `${title}: ${entry.output} must exist.`));
            }
            if (chain.length > 1) {
                explanation.append(element("p",
                    "All of these conditions must pass for a workflow."));
            }
        };
        targetPhase.addEventListener("change", () => {
            target.phase = targetPhase.value;
            target.output = outputs[target.phase]?.view ?? outputs[target.phase]?.outputs?.[0] ?? "";
            refresh();
            emitChange();
        });
        targetOutput.addEventListener("change", () => {
            target.output = targetOutput.value;
            refresh();
            emitChange();
        });
        editor.append(field("Target phase", targetPhase), field("Required output", targetOutput),
            targetWarning, fileDeclaration(() => target.phase, (_id, path) => {
                target.output = path;
                refresh();
                emitChange();
            }),
            element("h3", "Which earlier outputs must be current?"), earlierGroup,
            element("h3", "When this badge appears"), explanation);
        refresh();
    }
    if (!ordered) {
        for (const descriptor of rule.inputs ?? []) {
            if (rule.inputs.length > 1 && descriptor.type !== "text") {
                editor.append(element("h4", descriptor.label ?? (descriptor.type === "phase"
                    ? "Completion phase" : descriptor.type === "text"
                        ? "Text to match" : "Output to check")));
            }
            if (descriptor.type === "text") {
                const value = element("input");
                value.type = "text";
                value.maxLength = 256;
                value.value = pending.inputs[descriptor.id];
                value.addEventListener("input", () => {
                    pending.inputs[descriptor.id] = value.value;
                    emitChange();
                });
                editor.append(field(descriptor.label ?? "Text to match", value,
                    "Match this literal text anywhere in the output, ignoring capitalization."));
            } else if (descriptor.type === "phase") {
                const value = pending.inputs[descriptor.id];
                const group = element("div", undefined, "badge-phase-list");
                const choices = [];
                for (const [id, title] of phaseChoices) {
                    const label = element("label", undefined, "badge-check");
                    const checkbox = element("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = value === id;
                    checkbox.addEventListener("change", () => {
                        pending.inputs[descriptor.id] = checkbox.checked ? id : "";
                        for (const [otherId, other] of choices) other.checked = otherId === pending.inputs[descriptor.id];
                        emitChange();
                    });
                    choices.push([id, checkbox]);
                    label.append(checkbox, element("span", title));
                    group.append(label);
                }
                editor.append(group);
            } else if (descriptor.type === "artifact") {
                const value = pending.inputs[descriptor.id];
                const group = element("div", undefined, "badge-phase-list");
                const choices = [];
                for (const [id, title] of phaseChoices) {
                    const label = element("label", undefined, "badge-check");
                    const checkbox = element("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = value.phase === id;
                    const outputList = element("div", undefined, "badge-output-list");
                    outputList.setAttribute("role", "group");
                    outputList.setAttribute("aria-label", `${title} outputs`);
                    outputList.hidden = !checkbox.checked;
                    const outputChoices = [];
                    const addChoice = (path) => {
                        const item = element("label", undefined, "badge-check");
                        const output = element("input");
                        output.type = "checkbox";
                        output.checked = value.phase === id && value.output === path;
                        output.addEventListener("change", () => {
                            value.phase = id;
                            value.output = output.checked ? path : "";
                            for (const [otherId, other, list, options] of choices) {
                                other.checked = otherId === value.phase;
                                list.hidden = !other.checked;
                                for (const [otherPath, input] of options) {
                                    input.checked = otherId === value.phase && otherPath === value.output;
                                }
                            }
                            emitChange();
                        });
                        outputChoices.push([path, output]);
                        item.append(output, element("span", path));
                        outputList.append(item);
                    };
                    for (const [path] of artifactOptions(outputs, id)) addChoice(path);
                    if (!outputChoices.length) outputList.append(element("p",
                        "No confirmed outputs. Declare a Markdown file below.", "settings-note"));
                    checkbox.addEventListener("change", () => {
                        value.phase = checkbox.checked ? id : "";
                        value.output = checkbox.checked ? outputs[id]?.view ?? outputs[id]?.outputs?.[0] ?? "" : "";
                        for (const [otherId, other, list, options] of choices) {
                            other.checked = otherId === value.phase;
                            list.hidden = !other.checked;
                            for (const [path, input] of options) {
                                input.checked = otherId === value.phase && path === value.output;
                            }
                        }
                        emitChange();
                    });
                    choices.push([id, checkbox, outputList, outputChoices, addChoice]);
                    label.append(checkbox, element("span", title));
                    group.append(label, outputList);
                }
                editor.append(group, fileDeclaration(() => value.phase, (id, path) => {
                    const choice = choices.find(([phase]) => phase === id);
                    if (!choice) throw new Error("Choose an evidence phase before declaring a file.");
                    const [, checkbox, list, options, addChoice] = choice;
                    if (!options.length) list.replaceChildren();
                    addChoice(path);
                    value.output = path;
                    checkbox.checked = true;
                    list.hidden = false;
                    for (const [otherId, other, otherList, otherOptions] of choices) {
                        other.checked = otherId === id;
                        otherList.hidden = !other.checked;
                        for (const [otherPath, input] of otherOptions) {
                            input.checked = otherId === id && otherPath === path;
                        }
                    }
                    emitChange();
                }));
            } else if (descriptor.type === "artifact-set") {
                const group = element("div", undefined, "badge-artifact-set");
                const chosen = new Set((pending.inputs[descriptor.id] ?? [])
                    .flatMap(({ phase, outputs: paths }) => paths.map((path) => JSON.stringify([phase, path]))));
                const available = phases.filter((id) => outputs[id]?.outputs?.length);
                const confirmed = new Set(available.flatMap((id) =>
                    outputs[id].outputs.map((path) => JSON.stringify([id, path]))));
                const stale = [...chosen].filter((key) => !confirmed.has(key));
                const updateInputs = () => {
                    pending.inputs[descriptor.id] = phases.map((id) => ({
                        phase: id, outputs: (outputs[id]?.outputs ?? [])
                            .filter((path) => chosen.has(JSON.stringify([id, path]))),
                    })).filter((entry) => entry.outputs.length);
                    emitChange();
                };
                const warning = element("p", stale.length
                    ? "Some selected evidence outputs are no longer confirmed. Choose a current output to replace them."
                    : "", "settings-field-error");
                warning.hidden = !stale.length;
                const choices = [];
                for (const [id, title] of phaseChoices) {
                    const label = element("label", undefined, "badge-check");
                    const phase = element("input");
                    phase.type = "checkbox";
                    phase.checked = outputs[id]?.outputs?.some((path) =>
                        chosen.has(JSON.stringify([id, path]))) ?? false;
                    const outputList = element("div", undefined, "badge-output-list");
                    outputList.setAttribute("role", "group");
                    outputList.setAttribute("aria-label", `${title} outputs`);
                    outputList.hidden = !phase.checked;
                    const outputChecks = [];
                    const addCheck = (path) => {
                        const item = element("label", undefined, "badge-check");
                        const checkbox = element("input");
                        checkbox.type = "checkbox";
                        const key = JSON.stringify([id, path]);
                        checkbox.checked = chosen.has(key);
                        checkbox.addEventListener("change", () => {
                            for (const oldKey of stale) chosen.delete(oldKey);
                            warning.hidden = true;
                            if (checkbox.checked) chosen.add(key);
                            else chosen.delete(key);
                            phase.checked = outputChecks.some(([key]) => chosen.has(key));
                            outputList.hidden = !phase.checked;
                            updateInputs();
                        });
                        outputChecks.push([key, checkbox]);
                        item.append(checkbox, element("span", path));
                        outputList.append(item);
                    };
                    for (const [path] of artifactOptions(outputs, id)) addCheck(path);
                    if (!outputChecks.length) outputList.append(element("p",
                        "No confirmed outputs. Declare a Markdown file below.", "settings-note"));
                    phase.addEventListener("change", () => {
                        for (const oldKey of stale) chosen.delete(oldKey);
                        warning.hidden = true;
                        for (const [key, checkbox] of outputChecks) {
                            if (!phase.checked) chosen.delete(key);
                            checkbox.checked = chosen.has(key);
                        }
                        if (phase.checked && !outputChecks.some(([key]) => chosen.has(key))) {
                            const preferred = outputs[id]?.view ?? outputs[id]?.outputs?.[0];
                            if (preferred) chosen.add(JSON.stringify([id, preferred]));
                            for (const [key, checkbox] of outputChecks) checkbox.checked = chosen.has(key);
                        }
                        outputList.hidden = !phase.checked;
                        updateInputs();
                    });
                    label.append(phase, element("span", title));
                    group.append(label, outputList);
                    choices.push([id, phase, outputList, outputChecks, addCheck]);
                }
                const addPhase = select(phaseOptions(phases.filter((id) =>
                    id.replace(/^speckit\./, "") !== "constitution")), "", "File evidence phase");
                group.append(field("Evidence phase for new file", addPhase),
                    fileDeclaration(() => addPhase.value, (id, path) => {
                        const choice = choices.find(([phase]) => phase === id);
                        if (!choice) throw new Error("Choose an evidence phase before declaring a file.");
                        const [, phase, list, checks, addCheck] = choice;
                        if (!checks.length) list.replaceChildren();
                        addCheck(path);
                        for (const oldKey of stale) chosen.delete(oldKey);
                        warning.hidden = true;
                        chosen.add(JSON.stringify([id, path]));
                        phase.checked = true;
                        list.hidden = false;
                        updateInputs();
                    }));
                group.append(warning);
                editor.append(group);
            }
        }
    }
    const selectedPhases = () => {
        if (rule.placementPhaseInput) {
            return [inputs[rule.placementPhaseInput]?.phase].filter(Boolean);
        }
        const selected = new Set();
        for (const descriptor of rule.inputs ?? []) {
            const value = inputs[descriptor.id];
            if (descriptor.type === "phase" && value) selected.add(value);
            else if (descriptor.type === "artifact" && value?.phase
                && !(rule.id === "checklist-complete" && descriptor.id === "prerequisite")) {
                selected.add(value.phase);
            } else if (descriptor.type === "artifact-set") {
                for (const entry of value ?? []) if (entry.outputs?.length) selected.add(entry.phase);
            }
        }
        return [...selected];
    };
    const validationError = () => {
        for (const descriptor of rule.inputs ?? []) {
            const value = inputs[descriptor.id];
            if (descriptor.type === "text"
                && (typeof value !== "string" || !value.trim()
                    || value.length > 256 || /[\x00-\x1f\x7f]/.test(value))) {
                return "Enter text to match (1-256 characters).";
            }
            if (descriptor.type === "phase" && !phases.includes(value)) {
                return "Choose a phase for this badge to check.";
            }
            if (descriptor.type === "artifact"
                && !outputs[value?.phase]?.outputs?.includes(value.output)) {
                return "Choose a confirmed output for this badge to check.";
            }
            if (descriptor.type === "artifact-set"
                && (!Array.isArray(value) || !value.some((entry) => entry.outputs?.length)
                    || value.some((entry) => !phases.includes(entry.phase)
                        || !Array.isArray(entry.outputs)
                        || entry.outputs.some((path) =>
                            !outputs[entry.phase]?.outputs?.includes(path))))) {
                return "Choose at least one confirmed output for this badge to check.";
            }
            if (descriptor.type === "ordered-artifacts") {
                if (!Array.isArray(value) || value.length > 100) {
                    return "Choose one distinct confirmed output per selected earlier phase.";
                }
                const chain = [...value, inputs[descriptor.before]];
                if (chain.some((entry) => !phases.includes(entry?.phase)
                        || !outputs[entry.phase]?.outputs?.includes(entry.output))
                    || chain.some((entry, index) => index > 0
                        && phases.indexOf(chain[index - 1].phase) >= phases.indexOf(entry.phase))
                    || new Set(chain.map((entry) => entry.output.toLowerCase())).size !== chain.length) {
                    return "Choose one distinct confirmed output per selected earlier phase.";
                }
            }
        }
        if (rule.id === "checklist-complete") {
            const { artifact, prerequisite } = inputs;
            if (phases.indexOf(prerequisite.phase) >= phases.indexOf(artifact.phase)
                || prerequisite.output.toLowerCase() === artifact.output.toLowerCase()) {
                return "Choose a different confirmed earlier output for Checklist complete.";
            }
        }
        return "";
    };
    return { isReady: () => !validationError(), validationError, selectedPhases,
        handlesOutputDeclaration: true,
        dispose() { root.replaceChildren(); } };
}
