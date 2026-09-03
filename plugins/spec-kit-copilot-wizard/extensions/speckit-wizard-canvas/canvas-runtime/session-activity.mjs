// Centralized SDK session activity subscription.
//
// This is the only module that knows the SDK event names used to tell whether
// the Copilot agent is actively processing a turn. Other modules subscribe to
// this module's normalized events instead of touching getSession().on directly.

import { getSession } from "./instances.mjs";

const TURN_START_EVENTS = ["assistant.turn_start", "turn.start", "turn-start"];
const TURN_END_EVENTS = ["assistant.turn_end", "turn.end", "turn-end"];
const SESSION_IDLE_EVENT = "session.idle";
const USER_INPUT_REQUESTED_EVENT = "user_input.requested";
const USER_INPUT_COMPLETED_EVENT = "user_input.completed";

const listeners = new Set();
let subscribedSession = null;
let agentWorking = false;
const pendingUserInputs = new Set();
let sessionUnsubscribers = [];

export function isAgentWorking() {
    return agentWorking;
}

export function isAwaitingUserInput() {
    return pendingUserInputs.size > 0;
}

export function onSessionActivity(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function ensureSessionActivity() {
    const session = getSession();
    if (!session || subscribedSession === session || typeof session.on !== "function") return;
    for (const unsubscribe of sessionUnsubscribers) {
        try { unsubscribe(); } catch { /* ignore stale SDK listener cleanup */ }
    }
    sessionUnsubscribers = [];
    pendingUserInputs.clear();
    agentWorking = false;
    subscribedSession = session;

    const subscribe = (eventName, handler) => {
        try {
            const unsubscribe = session.on(eventName, handler);
            if (typeof unsubscribe === "function") sessionUnsubscribers.push(unsubscribe);
        } catch { /* older SDK/event unavailable */ }
    };

    for (const eventName of TURN_START_EVENTS) {
        subscribe(eventName, (event) => emitActivity({ kind: "turn-start", working: true, at: eventAt(event) }));
    }
    for (const eventName of TURN_END_EVENTS) {
        subscribe(eventName, (event) => emitActivity({ kind: "turn-end", working: false, at: eventAt(event) }));
    }
    subscribe(USER_INPUT_REQUESTED_EVENT, (event) => {
        const requestId = event?.data?.requestId;
        if (typeof requestId === "string" && requestId) pendingUserInputs.add(requestId);
        emitActivity({ kind: "user-input-requested", working: false, awaitingUserInput: true, at: eventAt(event) });
    });
    subscribe(USER_INPUT_COMPLETED_EVENT, (event) => {
        const requestId = event?.data?.requestId;
        if (typeof requestId === "string" && requestId) pendingUserInputs.delete(requestId);
        else pendingUserInputs.clear();
        emitActivity({ kind: "user-input-completed", working: false, awaitingUserInput: isAwaitingUserInput(), at: eventAt(event) });
    });
    subscribe(SESSION_IDLE_EVENT, (event) => emitActivity({ kind: "session-idle", working: false, at: eventAt(event) }));
}

function eventAt(event) {
    const parsed = Date.parse(event?.timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function emitActivity(event = {}) {
    const at = Number.isFinite(event.at) ? event.at : Date.now();
    agentWorking = !!event.working;
    const normalized = {
        kind: event.kind || (agentWorking ? "turn-start" : "turn-end"),
        working: agentWorking,
        awaitingUserInput: event.awaitingUserInput ?? isAwaitingUserInput(),
        at,
    };
    for (const listener of Array.from(listeners)) {
        try { listener(normalized); } catch { /* isolate listeners */ }
    }
}
