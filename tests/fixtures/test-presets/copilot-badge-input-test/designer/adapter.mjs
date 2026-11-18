export const controlId = "test.phase-choice";
export const contractVersion = 1;

export function mount({ root, rule, inputs, phases, onChange }) {
    if (rule.id !== "test-phase" || !root || typeof onChange !== "function"
        || !Array.isArray(phases) || !inputs || typeof inputs !== "object") {
        throw new Error("Invalid test badge input control");
    }
    const label = document.createElement("label");
    label.textContent = "Phase to confirm";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Phase to confirm");
    for (const phase of phases) {
        const option = document.createElement("option");
        option.value = phase;
        option.textContent = phase.replace(/^speckit\./, "");
        select.append(option);
    }
    select.value = inputs.phase ?? phases[0] ?? "";
    select.addEventListener("change", () => onChange({ phase: select.value }));
    label.append(select);
    const explanation = document.createElement("p");
    explanation.textContent = "This badge appears only after the selected phase's latest run completes.";
    root.replaceChildren(label, explanation);
    onChange({ phase: select.value });
    return { isReady: () => phases.includes(select.value) };
}
