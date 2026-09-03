// state.js — consolidated UI plumbing: mutable state, URL-derived constants,
// snapshot selectors, DOM filter readers, and pure string/path/URL helpers.
//
// This module is the single source of truth for what the client "knows" about
// the wizard:
//   • `state` — mutable client-side bag (tab selection, snapshot cache,
//     pending actions, in-flight tracking)
//   • constants (TOKEN, PHASE_ORDER, SETUP_STEPS, SETUP_TAB_PHASE_KEYS)
//   • snapshot readers (commands, orderedCompositionPresets, …)
//   • DOM filter readers (currentFilter, currentExtensionFilter, …)
//   • pure helpers (displayCommand, bareCommandId, capitalize, portableDirname,
//     parentDirOf, toRawUrl)
//
// Modules import `state` and mutate its fields directly; there is no reducer
// boundary. The wizard re-renders in response to SSE broadcasts, not on every
// mutation.

// -------- Mutable state bag --------

export const state = {
    activeTab: "setup",
    activeSetupStep: "environment",
    snapshot: null,
    currentPhase: "constitution",
    // In-flight preset actions keyed by preset id: "install" | "remove".
    // Cleared when a new `preset-catalog` broadcast arrives (server has
    // re-hydrated) or by a safety timeout.
    pendingPresetActions: {},
    // Same shape for extensions.
    pendingExtensionActions: {},
    // Same shape for bundles.
    pendingBundleActions: {},
    // Per-row in-flight tracking for the Setup card. One row runs at a time:
    //   null              — idle
    //   "init"            — row 3 (Initialize project) is running
    //   "reload"          — row 4 (Reload skills) is running
    //   "installDefaults" — row 5 (Install default presets) is running
    // Cleared by the runInit()/runReload()/runInstallDefaults() finally blocks.
    setupRowRunning: null,
    // One-time gate: fires the auto-chain (init → install defaults → reload)
    // the first time the Setup tab renders in a session where plugin+CLI are
    // present but init hasn't happened yet. Set to true after the first
    // attempt regardless of outcome so we never re-trigger silently.
    autoChainAttempted: false,
    // Registered predicates awaiting a state broadcast that satisfies them.
    // Each entry is { predicate, resolve, reject, timer }. Consumed by
    // handleServerMessage's "state" case; see waitForSnapshot().
    snapshotWaiters: [],
    // Per-phase in-flight tracking. Populated when the user clicks Run phase
    // or Rerun phase; consulted in the render pass so the "Running…" label
    // survives SSE-driven re-renders. Cleared when the phase status changes,
    // the dispatch handler finishes, or a safety timeout fires.
    phaseRunning: new Set(),
    // Currently-visible artifact-kind subtab on the Composition page.
    // Persists across renders so switching tabs isn't reset by an SSE update.
    compositionActiveKind: "command",
    // Per-artifact expand state for the phase card's active-artifact
    // chain disclosure. Keys are `${phaseCommand}|${kind}|${bareId}` so
    // multiple phase cards don't collide. Presence in the set = expanded.
    expandedArtifactChains: new Set(),
};

// -------- URL/DOM-derived constants --------

// TOKEN: extension auth token pulled from the URL query string. Used by
// client.js when forming Authorization headers. Empty string when the wizard
// is opened outside the normal canvas host (dev-time only).
export const TOKEN = (typeof location !== "undefined")
    ? (new URLSearchParams(location.search).get("token") || "")
    : "";

// PHASE_ORDER: fallback ordering for the setup/preset tabs when the snapshot
// hasn't hydrated commands yet. The Phases tab uses the scanner-driven order
// (state.snapshot.commands) instead.
export const PHASE_ORDER = [
    "constitution",
    "specify",
    "clarify",
    "checklist",
    "plan",
    "tasks",
    "analyze",
    "taskstoissues",
    "implement",
];

// SETUP_STEPS: sub-step keys within the Setup tab.
export const SETUP_STEPS = ["environment", "catalogs", "composition"];

// SETUP_TAB_PHASE_KEYS: incoming phase keys that route to the Setup tab rather
// than the Phases tab. Used to disambiguate when state.json or an SSE message
// carries a `setup` or `preset` phase key.
export const SETUP_TAB_PHASE_KEYS = new Set(["setup", "preset"]);

// -------- Snapshot selectors --------
//
// These are used all over render/composition/catalog code to fetch the active
// command list, current selected phase card, and precedence-ordered
// composition presets/extensions. They read `state.snapshot` verbatim — no
// local sort, no tiebreak. The CLI (`specify preset resolve`) owns precedence;
// the UI just trusts what the payload delivers.

/** Returns the flat command list emitted by snapshot-builder. */
export function commands() {
    return Array.isArray(state.snapshot?.commands) ? state.snapshot.commands : [];
}

/**
 * Precedence-ordered presets from the composition payload.
 * The Spec Kit CLI (`specify preset resolve`) owns precedence. The
 * speckit-preset skill passes the resolved order through in
 * composition.presets[]. The UI must render in that order verbatim —
 * no local sort, no tiebreak. This helper is the single source of
 * that ordering so no call site can silently re-sort.
 */
export function orderedCompositionPresets() {
    return state.snapshot?.composition?.presets ?? [];
}

/**
 * Precedence-ordered extensions from the composition payload. Same
 * contract as orderedCompositionPresets — trust the payload.
 */
export function orderedCompositionExtensions() {
    return state.snapshot?.composition?.extensions ?? [];
}

export function currentGraphPhase() {
    const list = commands();
    if (!list.length) return null;
    return list.find((p) => p.id === state.currentPhase) ?? list[0];
}

// -------- DOM filter readers --------
//
// Tiny readers for the catalog / extension / bundle search inputs and
// "only added" checkboxes. They touch the DOM directly (not the state bag)
// because these controls are their own source of truth.

export function currentFilter() {
    const el = document.getElementById("catalog-search");
    return (el?.value ?? "").toLowerCase();
}

export function currentAddedOnly() {
    return !!document.getElementById("catalog-only-added")?.checked;
}

export function currentExtensionFilter() {
    const el = document.getElementById("extension-search");
    return (el?.value ?? "").toLowerCase();
}

export function currentExtensionAddedOnly() {
    return !!document.getElementById("extension-only-added")?.checked;
}

export function currentBundleFilter() {
    const el = document.getElementById("bundle-search");
    return (el?.value ?? "").toLowerCase();
}

export function currentBundleAddedOnly() {
    return !!document.getElementById("bundle-only-added")?.checked;
}

// -------- Pure string helpers --------

// Slash-command display form. Skills are registered with hyphens
// (`speckit-constitution`), even though the preset command files use dots
// (`speckit.constitution.md`). The wire/submit form still passes the raw
// commandName; this helper is display-only.
// NOTE: mirrored by `buildWorkflowSlashCommand` in prompts.mjs (Node side).
// Keep the two in sync if the skill naming convention changes.
export function displayCommand(name) {
    return String(name ?? "").replace(/\./g, "-");
}

// Strip artifact-id prefixes to get the bare command id.
// Accepts both fully-qualified (`commands/speckit.<name>`) and partially-
// qualified (`speckit.<name>`) ids; returns `<name>` (which may itself be
// multi-segment, e.g. `assess.intake`).
export function bareCommandId(id) {
    return String(id ?? "").replace(/^commands\//, "").replace(/^speckit\./, "");
}

export function capitalize(s) {
    const str = String(s ?? "");
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

// -------- Pure path helpers --------

// portableDirname takes a forward-slash path and returns the parent segment,
// or "" for anything at the root/no-slash. Only used by folder browser UI, so
// it doesn't need to handle Windows backslashes.
export function portableDirname(p) {
    if (typeof p !== "string") return "";
    const i = p.lastIndexOf("/");
    return i <= 0 ? "" : p.slice(0, i);
}

// parentDirOf normalizes backslashes and returns the parent directory, or "."
// when the input has no parent. Used by artifact viewer breadcrumbs.
export function parentDirOf(p) {
    const normalized = String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) return ".";
    const idx = normalized.lastIndexOf("/");
    if (idx < 0) return ".";
    return normalized.slice(0, idx) || ".";
}

// -------- Pure URL helpers --------

// toRawUrl converts a `github.com/.../blob/...` URL to its raw content form on
// `raw.githubusercontent.com`. Any other input is returned unchanged so
// callers can pass URLs through freely.
export function toRawUrl(url) {
    if (typeof url !== "string") return "";
    const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    return url;
}
