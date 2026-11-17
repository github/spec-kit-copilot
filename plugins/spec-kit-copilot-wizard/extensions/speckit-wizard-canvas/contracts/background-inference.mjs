// Runtime-only boundary: no changes to canvas actions, HTTP replies or saved state.
// The host starts one isolated task with inherited model/permissions and retains
// its opaque ID for cancellation. Missing capabilities fail; never enqueue a
// foreground turn as a fallback.
export function inferenceTaskApi(session) {
    const tasks = session?.rpc?.tasks;
    if (typeof tasks?.startAgent !== "function" || typeof tasks?.cancel !== "function") {
        throw new Error("Background inference is unavailable in this Copilot runtime; update Copilot and retry Refresh");
    }
    return tasks;
}

export function inferenceTaskId(result) {
    if (typeof result?.agentId !== "string" || !result.agentId.trim() || result.agentId.length > 200) {
        throw new Error("Background inference returned an invalid agent ID");
    }
    return result.agentId;
}
