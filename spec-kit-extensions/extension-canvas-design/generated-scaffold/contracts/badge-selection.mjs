const idPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const colorPattern = /^(?:theme|red|green|amber|blue|purple|pink|orange|#[0-9a-fA-F]{6})$/;
export const badgeTextFields = Object.freeze({ workflow: "text", phase: "phaseText", summary: "summaryText" });

export function badgePlacements(badge) {
    const showIn = Array.isArray(badge?.showIn) ? badge.showIn : [];
    return { workflow: showIn.includes("workflow-list"),
        phase: Boolean(badge?.targets?.length || showIn.includes("phase-card")),
        summary: showIn.includes("workflow-summary") };
}

export function validBadgeCategory(value, draft = false) {
    return typeof value === "string" && (draft || !!value.trim()) && value.length <= 80
        && !/[\x00-\x1f\x7f<>]/.test(value);
}

export function validBadgeText(value, placeholders = [], draft = false) {
    return typeof value === "string" && (draft || !!value.trim()) && value.length <= 120
        && !/[\x00-\x1f\x7f<>]/.test(value)
        && [...value.matchAll(/\{([^{}]+)\}/g)].every(([, token]) => placeholders.includes(token))
        && !/[{}]/.test(value.replace(/\{[^{}]+\}/g, ""));
}

// Each placement's text is present exactly when that placement is selected.
export function validPlacementTexts(value, placements, placeholders = [], draft = false) {
    return Object.entries(badgeTextFields).every(([place, key]) => placements[place]
        ? validBadgeText(value[key], place === "summary" ? [] : placeholders, draft)
        : !Object.hasOwn(value, key));
}

export function validBadgeSelections(entries, placements, draft = false) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 100 || !placements) return false;
    const ids = new Set();
    return entries.every((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)
            || Object.keys(entry).some((key) =>
                !["id", "value", "color", ...Object.values(badgeTextFields)].includes(key))
            || typeof entry.id !== "string" || !idPattern.test(entry.id) || ids.has(entry.id)
            || typeof entry.value !== "string" || (!draft && !entry.value.trim())
            || entry.value.length > 256 || /[\x00-\x1f\x7f]/.test(entry.value)
            || !validPlacementTexts(entry, placements, [], draft)
            || typeof entry.color !== "string" || !colorPattern.test(entry.color)) return false;
        ids.add(entry.id);
        return true;
    });
}
