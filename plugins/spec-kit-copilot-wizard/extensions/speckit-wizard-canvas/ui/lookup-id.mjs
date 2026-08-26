// Pure helpers for the deterministic `lookupId` field carried on composition
// stack layers (spec-kit CLI issue #4210 / PR #4305).
//
// Format: `preset:<presetId>:<kind>:<name>` or `extension:<extId>:<kind>:<name>`,
// `null` for core (built-in) layers. Stable across reinstalls; NOT a CLI
// round-trip key (do not send it back to `specify` commands).

const KNOWN_PROVIDER_KINDS = new Set(["preset", "extension"]);

// Parse a `lookupId` string into its constituent parts. Returns `null` for
// anything that isn't a recognized `preset:`/`extension:` lookupId (including
// `null`, empty string, garbage, or an unknown provider kind like `core:...`).
//
// Colons inside `<name>` are legal — everything after the third colon is
// treated as the opaque `name` tail (locked decision: do not split further).
export function parseLookupId(lookupId) {
    if (typeof lookupId !== "string" || lookupId.length === 0) return null;
    const parts = lookupId.split(":");
    if (parts.length < 4) return null;
    const [providerKind, providerId, kind, ...nameParts] = parts;
    if (!KNOWN_PROVIDER_KINDS.has(providerKind)) return null;
    if (!providerId || !kind) return null;
    const name = nameParts.join(":");
    if (!name) return null;
    return { providerKind, providerId, kind, name };
}

// Find the stack layer within a composition artifact whose `lookupId`
// matches. Returns `null` when `lookupId` is falsy or no layer matches.
export function findLayerByLookupId(compArtifact, lookupId) {
    if (!lookupId || !compArtifact) return null;
    const stack = compArtifact.stack ?? [];
    return stack.find((layer) => layer?.lookupId === lookupId) ?? null;
}
