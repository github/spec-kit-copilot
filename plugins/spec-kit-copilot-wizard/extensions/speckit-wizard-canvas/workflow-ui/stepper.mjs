export function workflowStepClasses({
    active = false,
    locked = false,
    optional = false,
    orphan = false,
    synthesized = false,
    extension = false,
    status = "",
} = {}) {
    return [
        "step",
        active && "active",
        locked && "locked",
        optional && "is-optional",
        orphan && "orphan",
        synthesized && "is-canonical-fallback",
        extension && "is-extension",
        status === "done" && "done",
        status === "failed" && "failed",
        status === "stale" && "stale",
    ].filter(Boolean);
}
