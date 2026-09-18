import { buildAmendmentPrompt, validateAmendmentAnswers } from "../workflow-ui/amendment.mjs";
import { AMENDMENT_WAIT_MS, markerPresent, wizardClarificationScope } from "../workflow-ui/clarifications.mjs";
import { CANONICAL_BY_FULL, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";
import { readWorkflowArtifact } from "../generation/generated-canvas-template/workspace-files.mjs";
import { dispatchPromptToSession } from "../canvas-runtime/dispatch.mjs";

const active = new Map();

export function createWizardAmendment({ getState, getInstance, dispatch = dispatchPromptToSession, now = Date.now }) {
    const failure = (code, error) => ({ ok: false, code, error });
    return async (input) => {
        const workspace = getInstance()?.workspacePath;
        if (!workspace || !input || Object.keys(input).some((key) => !["scope", "phase", "artifact", "answers"].includes(key))
            || input.scope !== wizardClarificationScope(workspace) || typeof input.phase !== "string" || typeof input.artifact !== "string") {
            return failure("invalid_amendment", "The workspace or amendment target changed. Reopen the artifact.");
        }
        const snapshot = await getState();
        const id = stripCommandsPrefix(input.phase);
        const canonical = Object.values(CANONICAL_BY_FULL).includes(id);
        const declared = canonical || snapshot.composition?.artifacts?.some((entry) => (
            ["command", "hook"].includes(entry.kind) && stripCommandsPrefix(entry.id) === id
            && entry.stack?.some((layer) => layer.active)
        ));
        const phase = snapshot.phases?.[canonical ? id : `commands/${id}`] ?? snapshot.phases?.[id];
        if (!declared || !phase?.artifactPath || phase.artifactPath !== input.artifact) {
            return failure("invalid_artifact", "The artifact does not belong to this effective phase. Refresh and review.");
        }
        // Reuse the bounded regular-file reader with only this effective artifact
        // authorized. No generated workflow item model is involved.
        let content;
        try {
            content = await readWorkflowArtifact(workspace, input.artifact, {
                pipeline: { steps: [{ artifact: { pathTemplate: phase.artifactPath } }] },
            });
        } catch {
            return failure("invalid_artifact", "Artifact unavailable, unsafe, or changing during the read. Refresh and retry.");
        }
        const invalid = validateAmendmentAnswers(content, input.answers);
        if (invalid) return invalid;
        const key = JSON.stringify([workspace, input.artifact]);
        const previous = active.get(key);
        if (previous && (previous.sending || now() - previous.startedAt < AMENDMENT_WAIT_MS
            && previous.markers.some((marker) => markerPresent(content, marker)))) {
            return failure("amendment_pending", "An amendment is awaiting an artifact update. Review before retrying.");
        }
        const reservation = { sending: true, startedAt: now(), markers: input.answers.map((entry) => entry.marker) };
        active.set(key, reservation);
        try {
            if (getInstance()?.workspacePath !== workspace) throw new Error("Workspace changed");
            await dispatch({ prompt: buildAmendmentPrompt(input.artifact, content, input.answers, workspace), waitForAcceptance: true });
            reservation.sending = false;
            reservation.startedAt = now();
            const timer = setTimeout(() => {
                if (active.get(key) === reservation) active.delete(key);
            }, AMENDMENT_WAIT_MS);
            timer.unref?.();
            return { ok: true, phase: input.phase, artifact: input.artifact };
        } catch {
            active.delete(key);
            return failure("amendment_failed", "Could not dispatch the amendment. Drafts retained; retry when ready.");
        }
    };
}
