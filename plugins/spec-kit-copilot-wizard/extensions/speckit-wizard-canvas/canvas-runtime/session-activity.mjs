// Centralized SDK session activity subscription.
//
// This is the only module that knows the SDK event names used to tell whether
// the Copilot agent is actively processing a turn. Other modules subscribe to
// this module's normalized events instead of touching getSession().on directly.

import { getSession } from "./instances.mjs";

const TURN_START_EVENTS = ["turn.start", "turn-start"];
const TURN_END_EVENTS = ["turn.end", "turn-end"];
const SESSION_IDLE_EVENT = "session.idle";

const listeners = new Set();
let subscribedSession = null;
let agentWorking = false;

export function isAgentWorking() {
    return agentWorking;
}

export function onSessionActivity(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function ensureSessionActivity() {
    const session = getSession();
    if (!session || subscribedSession === session || typeof session.on !== "function") return;
    subscribedSession = session;

    const subscribe = (eventName, handler) => {
        try { session.on(eventName, handler); } catch { /* older SDK/event unavailable */ }
    };

    for (const eventName of TURN_START_EVENTS) {
        subscribe(eventName, () => emitActivity({ kind: "turn-start", working: true }));
    }
    for (const eventName of TURN_END_EVENTS) {
        subscribe(eventName, () => emitActivity({ kind: "turn-end", working: false }));
    }
    subscribe(SESSION_IDLE_EVENT, () => emitActivity({ kind: "session-idle", working: false }));
}

export function __emitSessionActivityForTests(event) {
    emitActivity(event);
}

function emitActivity(event = {}) {
    const at = Number.isFinite(event.at) ? event.at : Date.now();
    agentWorking = !!event.working;
    const normalized = {
        kind: event.kind || (agentWorking ? "turn-start" : "turn-end"),
        working: agentWorking,
        at,
    };
    for (const listener of Array.from(listeners)) {
        try { listener(normalized); } catch { /* isolate listeners */ }
    }
}
