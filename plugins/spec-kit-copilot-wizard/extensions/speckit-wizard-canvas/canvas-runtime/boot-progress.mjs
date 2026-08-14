// Boot-progress tracker for the wizard canvas.
//
// Why this exists
// ---------------
// First open of a fresh worktree is slow: workspace probe, npm install
// (10-45s on cold cache), env probe, catalog hydrate. The canvas SDK
// blocks the iframe on the URL returned from `onOpen`, so users
// historically saw a blank frame for the entire boot. This tracker
// gives the UI a live, streamable picture of what step we're on,
// how long it's been running, and what (if anything) failed.
//
// Contract
// --------
// createBootTracker({ broadcast, inst }) returns an object with:
//   start(stepId)              — mark step as running (records startedAt)
//   ok(stepId, meta?)          — mark step as ok  (records endedAt/durationMs)
//   fail(stepId, err)          — mark step as failed (records error + endedAt)
//   skip(stepId, reason?)      — mark step as skipped (records endedAt)
//   tick(stepId, line)         — attach a rolling "last output line" for
//                                the running step (throttled broadcast)
//   ready()                    — mark tracker as phase=ready
//   snapshot()                 — return a serializable clone
//
// Every mutation writes back to inst.boot AND fires a broadcast(
// { type: "boot.update", boot }) so subscribers (SSE clients) see it
// immediately. tick() is throttled to ~5Hz to avoid flooding the SSE
// stream with npm log spam.

// Ordered list of steps the wizard walks on first open. Changing this
// list requires updating ui/boot.js.
export const BOOT_STEPS = [
    { id: "workspace", label: "Resolving workspace" },
    { id: "deps-check", label: "Checking npm dependencies" },
    { id: "deps-install", label: "Installing js-yaml" },
    { id: "env-probe", label: "Probing environment" },
    { id: "catalog", label: "Loading catalogs" },
    { id: "ready", label: "Ready" },
];

const TICK_THROTTLE_MS = 200;

function nowIso() {
    return new Date().toISOString();
}

function initialBoot() {
    const startedAt = nowIso();
    return {
        phase: "booting",
        startedAt,
        steps: BOOT_STEPS.map((s) => ({
            id: s.id,
            label: s.label,
            status: "pending",
            startedAt: null,
            endedAt: null,
            durationMs: null,
            output: null,
            error: null,
            meta: null,
        })),
    };
}

export function createBootTracker({ broadcast, inst } = {}) {
    if (!inst) throw new Error("createBootTracker requires inst");
    // Preserve an existing boot record if we're re-running after a
    // retry — the UI still animates the retried step.
    if (!inst.boot || !Array.isArray(inst.boot.steps)) {
        inst.boot = initialBoot();
    }

    const lastTickAt = new Map();
    const pendingTickTimer = new Map();

    function step(stepId) {
        const s = inst.boot.steps.find((x) => x.id === stepId);
        if (!s) throw new Error(`unknown boot step: ${stepId}`);
        return s;
    }

    function emit() {
        try {
            broadcast?.({ type: "boot.update", boot: snapshot() });
        } catch { /* best-effort */ }
    }

    function start(stepId) {
        const s = step(stepId);
        s.status = "running";
        s.startedAt = nowIso();
        s.endedAt = null;
        s.durationMs = null;
        s.error = null;
        s.output = null;
        emit();
    }

    function finalize(s, status) {
        s.status = status;
        s.endedAt = nowIso();
        if (s.startedAt) {
            s.durationMs = Math.max(0, Date.parse(s.endedAt) - Date.parse(s.startedAt));
        }
        // Cancel any pending throttled tick emission for this step so a
        // late line doesn't overwrite the finalized status.
        const pending = pendingTickTimer.get(s.id);
        if (pending) {
            clearTimeout(pending);
            pendingTickTimer.delete(s.id);
        }
        lastTickAt.delete(s.id);
    }

    function ok(stepId, meta = null) {
        const s = step(stepId);
        finalize(s, "ok");
        if (meta) s.meta = meta;
        emit();
    }

    function fail(stepId, err = null) {
        const s = step(stepId);
        finalize(s, "failed");
        if (err) {
            s.error = typeof err === "string"
                ? { title: err }
                : {
                    title: err.title ?? err.message ?? "failed",
                    hint: err.hint ?? null,
                    code: err.code ?? null,
                    canRetry: err.canRetry ?? true,
                    stderrTail: typeof err.stderrTail === "string" ? err.stderrTail.slice(0, 400) : null,
                };
        }
        inst.boot.phase = "failed";
        emit();
    }

    function skip(stepId, reason = null) {
        const s = step(stepId);
        s.startedAt = s.startedAt ?? nowIso();
        finalize(s, "skipped");
        if (reason) s.meta = { reason };
        emit();
    }

    function tick(stepId, line) {
        const s = step(stepId);
        if (s.status !== "running") return;
        const trimmed = typeof line === "string" ? line.trim() : "";
        if (!trimmed) return;
        s.output = trimmed.slice(0, 200);
        const now = Date.now();
        const last = lastTickAt.get(stepId) ?? 0;
        const wait = TICK_THROTTLE_MS - (now - last);
        if (wait <= 0) {
            lastTickAt.set(stepId, now);
            emit();
        } else if (!pendingTickTimer.get(stepId)) {
            const timer = setTimeout(() => {
                pendingTickTimer.delete(stepId);
                lastTickAt.set(stepId, Date.now());
                emit();
            }, wait);
            // Don't hold the process open on this timer.
            if (typeof timer.unref === "function") timer.unref();
            pendingTickTimer.set(stepId, timer);
        }
    }

    function ready() {
        const s = step("ready");
        finalize(s, "ok");
        inst.boot.phase = "ready";
        emit();
    }

    function snapshot() {
        // Deep clone via JSON so subscribers can't mutate the live record.
        return JSON.parse(JSON.stringify(inst.boot));
    }

    return { start, ok, fail, skip, tick, ready, snapshot };
}
