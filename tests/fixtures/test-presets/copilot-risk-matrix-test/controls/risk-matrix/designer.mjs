/**
 * Designer adapter: risk-matrix
 * Required exports: controlId and valueContract must match the shared control;
 * mount and validate must be functions.
 * Value: a draft may be null or an incomplete object; a valid value has exactly
 * impact and likelihood selected from field.validation.properties.
 * field: The Designer supplies canonical id, label, optional description,
 * control, and validation rules; request values cannot redefine these rules.
 * mount: The Designer creates an empty <div> for each control and passes it
 * as root. Render and style only inside that div. onChange(nextValue) updates
 * the unsaved draft without remounting; return { isReady(): boolean }.
 * The Designer requires isReady() === true before Save, Generate, or tab exit.
 * validate: Return a pure, synchronous boolean using the canonical field.
 * Generate calls it in Node on the value being frozen; false, a throw, or
 * a non-boolean result blocks generation. Do not depend on browser APIs.
 */
export const controlId = "risk-matrix";
export const valueContract = {
    type: "object",
    properties: {
        impact: ["low", "medium", "high"],
        likelihood: ["low", "medium", "high"],
    },
};

const LEVELS = ["low", "medium", "high"];
let nextScope = 0;

function validValue(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).sort().join(",") === "impact,likelihood"
        && LEVELS.includes(value.impact) && LEVELS.includes(value.likelihood);
}

export function validate(value, field) {
    const properties = field?.validation?.properties;
    return field?.validation?.type === "object" && !!properties
        && value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).sort().join() === Object.keys(properties).sort().join()
        && Object.entries(properties).every(([key, allowed]) => allowed.includes(value[key]));
}

export function mount({ root, field, value, onChange }) {
    if (!root || typeof root.replaceChildren !== "function"
        || !field || typeof field.id !== "string" || !field.id
        || typeof onChange !== "function"
        || (value !== null && (typeof value !== "object" || Array.isArray(value)))) {
        throw new Error("Invalid Designer risk-matrix control or value");
    }

    const scope = String(++nextScope);
    root.dataset.riskMatrixScope = scope;
    const style = document.createElement("style");
    style.textContent = `
        [data-risk-matrix-scope="${scope}"] .risk-matrix-designer .risk-matrix-grid {
            display: grid;
            grid-template-columns: minmax(6rem, auto) repeat(3, minmax(3rem, 1fr));
            gap: .35rem;
            max-width: 30rem;
        }
        [data-risk-matrix-scope="${scope}"] .risk-matrix-designer .risk-matrix-grid > span { align-self: center; }
        [data-risk-matrix-scope="${scope}"] .risk-matrix-designer button {
            border: 1px solid currentColor;
            border-radius: .35rem;
            background: transparent;
            color: inherit;
            min-height: 2.75rem;
            cursor: pointer;
        }
        [data-risk-matrix-scope="${scope}"] .risk-matrix-designer button[aria-checked="true"] {
            background: CanvasText;
            color: Canvas;
        }
        [data-risk-matrix-scope="${scope}"] .risk-matrix-designer button:focus-visible {
            outline: 3px solid Highlight;
            outline-offset: 3px;
        }
    `;
    const container = document.createElement("div");
    container.className = "risk-matrix-designer";
    const title = document.createElement("p");
    title.textContent = field.label || "Risk rating";
    const hint = document.createElement("p");
    hint.textContent = "Columns: impact. Rows: likelihood. Use arrow keys to select a rating.";
    const grid = document.createElement("div");
    grid.className = "risk-matrix-grid";
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", `${title.textContent}: impact by likelihood`);
    const corner = document.createElement("span");
    corner.textContent = "Likelihood / Impact";
    grid.append(corner);
    for (const impact of LEVELS) {
        const label = document.createElement("span");
        label.textContent = `Impact ${impact}`;
        grid.append(label);
    }

    const cells = [];
    let selected = validValue(value) ? { impact: value.impact, likelihood: value.likelihood } : null;
    function refresh() {
        for (const { button, impact, likelihood } of cells) {
            const active = selected?.impact === impact && selected?.likelihood === likelihood;
            button.setAttribute("aria-checked", String(active));
            button.tabIndex = active || (selected === null
                && impact === LEVELS[0] && likelihood === LEVELS[0]) ? 0 : -1;
            button.textContent = active ? "Selected" : "Select";
        }
    }
    function choose(impact, likelihood, focus = false) {
        if (selected?.impact !== impact || selected?.likelihood !== likelihood) {
            const next = { impact, likelihood };
            onChange(next);
            selected = next;
            refresh();
        }
        if (focus) cells.find((cell) =>
            cell.impact === impact && cell.likelihood === likelihood).button.focus();
    }

    for (const likelihood of LEVELS) {
        const row = document.createElement("span");
        row.textContent = `Likelihood ${likelihood}`;
        grid.append(row);
        for (const impact of LEVELS) {
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "radio");
            button.setAttribute("aria-label", `Impact ${impact}, likelihood ${likelihood}`);
            button.addEventListener("click", () => choose(impact, likelihood));
            button.addEventListener("keydown", (event) => {
                const column = LEVELS.indexOf(impact);
                const rowIndex = LEVELS.indexOf(likelihood);
                let nextColumn = column;
                let nextRow = rowIndex;
                switch (event.key) {
                    case "ArrowRight": nextColumn = (column + 1) % 3; break;
                    case "ArrowLeft": nextColumn = (column + 2) % 3; break;
                    case "ArrowDown": nextRow = (rowIndex + 1) % 3; break;
                    case "ArrowUp": nextRow = (rowIndex + 2) % 3; break;
                    case "Home": nextColumn = 0; nextRow = 0; break;
                    case "End": nextColumn = 2; nextRow = 2; break;
                    case " ": case "Enter": break;
                    default: return;
                }
                event.preventDefault();
                choose(LEVELS[nextColumn], LEVELS[nextRow], true);
            });
            cells.push({ button, impact, likelihood });
            grid.append(button);
        }
    }
    refresh();
    container.append(title, hint, grid);
    root.replaceChildren(style, container);
    return { isReady: () => true };
}
