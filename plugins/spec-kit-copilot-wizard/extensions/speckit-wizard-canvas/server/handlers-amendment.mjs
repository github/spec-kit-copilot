// Authorize Wizard artifact clarification batches and dispatch surgical amendments.
import { buildAmendmentPrompt, validateAmendmentAnswers } from "../shared-workflow-ui/amendment.mjs";
import { wizardClarificationScope } from "../shared-workflow-ui/clarifications.mjs";
import { CANONICAL_BY_FULL, stripCommandsPrefix } from "../pipeline/effective-phases.mjs";
import { readWorkflowArtifact } from "../generation/generated-canvas-template/workspace-files.mjs";
import { dispatchPromptToSession } from "../canvas-runtime/dispatch.mjs";

const active = new Set();

export function createWizardAmendment({ getState, getInstance, dispatch = dispatchPromptToSession }) {
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
        if (active.has(key)) {
            return failure("amendment_pending", "An amendment request is being sent. Try again once submission finishes.");
        }
        active.add(key);
        try {
            if (getInstance()?.workspacePath !== workspace) throw new Error("Workspace changed");
            await dispatch({ prompt: buildAmendmentPrompt(input.artifact, content, input.answers, workspace), waitForAcceptance: true });
            return { ok: true, phase: input.phase, artifact: input.artifact };
        } catch {
            return failure("amendment_failed", "Could not dispatch the amendment. Drafts retained; retry when ready.");
        } finally {
            active.delete(key);
        }
    };
}
