function canonical(value, ordered, key = "") {
    if (Array.isArray(value)) {
        const entries = value.map((item) => canonical(item, ordered));
        return ordered.has(key) ? entries : entries.sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) =>
            [key, canonical(value[key], ordered, key)]));
    }
    return value;
}

// Badges collide when they show the same text in a placement they share; badges without
// top-level text (Value match) are distinguished by their entries in inputs.
function sharesText(a, b) {
    const shown = ["text", "phaseText", "summaryText"]
        .filter((key) => Object.hasOwn(a, key) || Object.hasOwn(b, key));
    return !shown.length || shown.some((key) => a[key] === b[key]);
}

function targets(badge) {
    if (badge.targets?.length) return badge.targets;
    if (badge.showIn?.includes("phase-card") && badge.phase) {
        return [{ phase: badge.phase, output: null }];
    }
    return [{ phase: null, output: null }];
}

export function findDuplicateBadge(candidate, existing, rule) {
    const ordered = new Set((rule?.inputs ?? [])
        .filter(({ type }) => type === "badge-selection").map(({ id }) => id));
    const inputs = JSON.stringify(canonical(candidate.inputs, ordered));
    const destinations = new Set(targets(candidate).map(({ phase, output }) =>
        JSON.stringify([phase, output])));
    return existing.find((badge) => badge.id !== candidate.id && badge.type === candidate.type
        && sharesText(badge, candidate)
        && JSON.stringify(canonical(badge.inputs, ordered)) === inputs
        && targets(badge).some(({ phase, output }) =>
            destinations.has(JSON.stringify([phase, output]))));
}
