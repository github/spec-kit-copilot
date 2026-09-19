// Read the normal user-visible reply; never request a custom report from the phase.
export const RESPONSE_LIMIT = 64 * 1024;

export function phaseResponse(events, messageId) {
    let interaction = null;
    let active = null;
    let turn = null;
    let text = "";
    let hasTools = false;
    let latest = null;
    const complete = (response) => Buffer.byteLength(response, "utf8") > RESPONSE_LIMIT
        ? { response: null, error: "The phase response exceeds the 64 KiB capture limit." }
        : { response, error: null };

    for (const event of events) {
        const data = event.data ?? {};
        if (event.agentId || data.parentToolCallId) continue;
        if (event.type === "user.message" && data.messageId === messageId) {
            if (!data.interactionId) return { response: null, error: "The phase response could not be associated with its dispatched message." };
            interaction = data.interactionId;
        }
        if (event.type === "assistant.turn_start") {
            active = data.interactionId;
            turn = data.turnId;
            text = "";
            hasTools = false;
        }
        if (!interaction || active !== interaction) continue;
        if (event.type === "assistant.message" && data.interactionId === interaction && data.turnId === turn) {
            if (data.toolRequests?.length) hasTools = true;
            if (!data.toolRequests?.length && !["analysis", "commentary", "thinking"].includes(data.phase)
                && typeof data.content === "string" && data.content.trim()) text = data.content;
        }
        if (event.type === "tool.execution_start" && data.turnId === turn) hasTools = true;
        // Copilot App presents task_complete's summary as the agent's final reply.
        if (event.type === "session.task_complete" && data.success === true) latest = complete(data.summary ?? "");
        if (event.type === "assistant.turn_end" && data.turnId === turn) {
            if (text && !hasTools) latest = complete(text);
            active = null;
        }
    }
    return latest;
}
