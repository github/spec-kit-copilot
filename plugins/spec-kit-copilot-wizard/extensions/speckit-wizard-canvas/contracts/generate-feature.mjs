export const generateCanvasInputSchema = {
    type: "boolean",
    description: "Enable experimental Generate canvas. On initial open, omission uses the runtime setting (default false). On reopen of the same instance, omission preserves its current value and does not reset it to the runtime setting. Explicit true or false sets the value on either open.",
};
export const featureFlagsSchema = {
    type: "object",
    required: ["generateCanvas"],
    additionalProperties: false,
    properties: { generateCanvas: { type: "boolean" } },
};

export function validateGenerateCanvas(value) {
    if (typeof value !== "boolean") throw new Error("generateCanvas must be a boolean");
    return value;
}

export function createFeatureFlags(value) {
    return { generateCanvas: validateGenerateCanvas(value) };
}

export function readGenerateCanvas(snapshot) {
    if (!snapshot || !Object.hasOwn(snapshot, "featureFlags")) return false;
    const flags = snapshot.featureFlags;
    if (!flags || typeof flags !== "object" || Array.isArray(flags)
        || Object.keys(flags).length !== 1 || !Object.hasOwn(flags, "generateCanvas")) {
        throw new Error("Incompatible featureFlags: expected { generateCanvas: boolean }");
    }
    return validateGenerateCanvas(flags.generateCanvas);
}
