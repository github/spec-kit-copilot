export const RESPONSE_LIMIT = 64 * 1024;

// Interactions owned by the dispatched message: its own interaction, plus any interaction
// (e.g. a replayed commit) first seen after dispatch whose top-level assistant messages all
// explicitly name the dispatched message as their origin. Interactions owned by another user
// message, seen before dispatch, or carrying missing or conflicting origins are not admitted.
export function phaseInteractions(events, messageId) {
    let dispatched, dispatchSeen = false;
    const userOwned = new Set(), beforeDispatch = new Set(), origins = new Map();
    for (const event of events) {
        const data = event.data ?? {};
        if (event.agentId || data.parentToolCallId) continue;
        const interaction = typeof data.interactionId === "string" ? data.interactionId : undefined;
        if (event.type === "user.message") {
            if (interaction) userOwned.add(interaction);
            if (data.messageId === messageId) { dispatchSeen = true; dispatched = interaction; }
            continue;
        }
        if (!interaction || !["assistant.turn_start", "assistant.message"].includes(event.type)) continue;
        if (!dispatchSeen) beforeDispatch.add(interaction);
        if (event.type !== "assistant.message") continue;
        if (!origins.has(interaction)) origins.set(interaction, new Set());
        origins.get(interaction).add(typeof data.originatingMessageId === "string"
            ? data.originatingMessageId : null);
    }
    const owned = new Set();
    if (!dispatched) return owned;
    owned.add(dispatched);
    for (const [interaction, named] of origins) {
        if (interaction !== dispatched && !userOwned.has(interaction) && !beforeDispatch.has(interaction)
            && named.size === 1 && named.has(messageId)) owned.add(interaction);
    }
    return owned;
}

export function phaseTurnState(events, messageId) {
    const owned = phaseInteractions(events, messageId);
    let interaction, turn, active = false, ended = false;
    for (const event of events) {
        const data = event.data ?? {};
        if (event.agentId || data.parentToolCallId) continue;
        if (event.type === "user.message" && data.messageId === messageId) interaction = data.interactionId;
        if (!interaction) continue;
        if (event.type === "assistant.turn_start" && owned.has(data.interactionId)) {
            turn = data.turnId; active = true; ended = false;
        }
        if (event.type === "assistant.turn_end" && data.turnId === turn) { active = false; ended = true; }
    }
    return { active, ended };
}

export const agentActionSchemas = Object.freeze({
    run_phase: { type: "object", additionalProperties: false, required: ["phase", "args"],
        properties: { phase: { type: "string" }, itemId: { type: "string" },
            args: { type: "string", maxLength: 32000 },
            slug: { type: "string", maxLength: 100 },
            name: { type: "string", maxLength: 120 } } },
    report_workflow_slug: { type: "object", additionalProperties: false, required: ["phaseRunId", "slug"],
        properties: { phaseRunId: { type: "string" },
            slug: { type: "string", minLength: 1, maxLength: 100 } } },
    report_phase_artifact: { type: "object", additionalProperties: false, required: ["phaseRunId", "path"],
        properties: { phaseRunId: { type: "string" }, path: { type: "string" } } },
    report_autopilot_step: { type: "object", additionalProperties: false,
        required: ["autopilotId", "phase", "action"],
        properties: { autopilotId: { type: "string" }, phase: { type: "string" },
            action: { type: "string", enum: ["start", "complete"] } } },
});

export function phaseResponse(events, messageId) {
    const owned = phaseInteractions(events, messageId);
    let interaction = null;
    let active = null;
    let turn = null;
    let text = "";
    let hasTools = false;
    let endedInteraction = null;
    let endedTurn = null;
    let latest = null;
    const complete = (response) => Buffer.byteLength(response, "utf8") > RESPONSE_LIMIT
        ? { response: null, error: "The phase response exceeds the 64 KiB capture limit.", success: true }
        : { response, error: null, success: true };

    for (const event of events) {
        const data = event.data ?? {};
        if (event.agentId || data.parentToolCallId) continue;
        if (event.type === "user.message" && data.messageId === messageId) {
            if (!data.interactionId) return { response: null,
                error: "The phase response could not be associated with its dispatched message.", success: false };
            interaction = data.interactionId;
        }
        if (event.type === "assistant.turn_start") {
            active = data.interactionId;
            endedInteraction = null;
            endedTurn = null;
            turn = data.turnId;
            text = "";
            hasTools = false;
        }
        if (!interaction || (!owned.has(active)
            && !(event.type === "session.task_complete" && owned.has(endedInteraction)))) continue;
        if (event.type === "assistant.message" && data.interactionId === active && data.turnId === turn) {
            if (data.toolRequests?.length) hasTools = true;
            if (!data.toolRequests?.length && !["analysis", "commentary", "thinking"].includes(data.phase)
                && typeof data.content === "string" && data.content.trim()) text = data.content;
        }
        if (event.type === "tool.execution_start" && data.turnId === turn) hasTools = true;
        if (event.type === "session.task_complete"
            && (data.interactionId && data.interactionId !== (active ?? endedInteraction)
                || data.turnId && data.turnId !== (active ? turn : endedTurn))) continue;
        // Copilot App presents task_complete's summary as the agent's final reply.
        if (event.type === "session.task_complete" && data.success === true) latest = complete(data.summary ?? "");
        if (event.type === "session.task_complete" && data.success === false) {
            latest = { response: null, error: "The phase did not complete successfully.", success: false };
        }
        if (event.type === "assistant.turn_end" && data.turnId === turn) {
            if (text && !hasTools) latest = complete(text);
            endedInteraction = active;
            endedTurn = turn;
            active = null;
        }
    }
    return latest;
}
