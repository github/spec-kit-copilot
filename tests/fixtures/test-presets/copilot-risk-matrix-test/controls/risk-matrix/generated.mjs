export const controlId = "risk-matrix";
export const valueContract = {
    type: "object",
    properties: {
        impact: ["low", "medium", "high"],
        likelihood: ["low", "medium", "high"],
    },
};

const LEVELS = ["low", "medium", "high"];

export function mount({ root, field, value }) {
    if (!root || typeof root.replaceChildren !== "function"
        || !field || typeof field.id !== "string" || !field.id
        || value === null || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).sort().join(",") !== "impact,likelihood"
        || !LEVELS.includes(value.impact) || !LEVELS.includes(value.likelihood)) {
        throw new Error("Invalid generated risk-matrix control or value");
    }

    const style = document.createElement("style");
    style.textContent = `
        .risk-matrix-generated table { border-collapse: collapse; }
        .risk-matrix-generated th, .risk-matrix-generated td {
            padding: .5rem;
            border: 1px solid currentColor;
            text-align: center;
        }
        .risk-matrix-generated td[aria-current="true"] {
            outline: 2px solid currentColor;
            outline-offset: -3px;
        }
    `;
    const container = document.createElement("div");
    container.className = "risk-matrix-generated";
    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = `${field.label || "Risk rating"}: impact ${value.impact}, likelihood ${value.likelihood}`;
    table.append(caption);
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.scope = "col";
    corner.textContent = "Likelihood / Impact";
    headRow.append(corner);
    for (const impact of LEVELS) {
        const heading = document.createElement("th");
        heading.scope = "col";
        heading.textContent = impact;
        headRow.append(heading);
    }
    head.append(headRow);
    table.append(head);
    const body = document.createElement("tbody");
    for (const likelihood of LEVELS) {
        const row = document.createElement("tr");
        const heading = document.createElement("th");
        heading.scope = "row";
        heading.textContent = likelihood;
        row.append(heading);
        for (const impact of LEVELS) {
            const cell = document.createElement("td");
            if (impact === value.impact && likelihood === value.likelihood) {
                cell.setAttribute("aria-current", "true");
                const selected = document.createElement("strong");
                selected.textContent = "Selected";
                cell.append(selected);
            } else {
                cell.textContent = "—";
            }
            row.append(cell);
        }
        body.append(row);
    }
    table.append(body);
    container.append(table);
    root.replaceChildren(style, container);
}
