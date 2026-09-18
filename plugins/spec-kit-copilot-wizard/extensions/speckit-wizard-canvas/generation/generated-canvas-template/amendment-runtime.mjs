import { commandViews } from "./ui/command-views.mjs";
import { buildAmendmentPrompt, validateAmendmentAnswers } from "./ui/amendment.mjs";
import { AMENDMENT_WAIT_MS, markerPresent } from "./ui/clarifications.mjs";
import { readWorkflowArtifact, resolveDeclaredArtifact } from "./workspace-files.mjs";

export { buildAmendmentPrompt };

export function createAmendmentRuntime({ pipeline, items, gate, dispatch, now = Date.now }) {
    const active = new Map();
    const commands = commandViews(pipeline);
    const failure = (code, error) => ({ ok: false, code, error });
    return async (inst, input) => {
        if (!input || Object.keys(input).some((key) => !["phase", "itemId", "artifact", "answers"].includes(key))) {
            return failure("invalid_amendment", "Invalid amendment request.");
        }
        const step = pipeline.pipeline.steps.find((entry) => entry.instanceKey === input.phase);
        if (!step || typeof input.artifact !== "string") return failure("invalid_amendment", "Choose an existing phase artifact.");
        const project = step === commands.constitution;
        if (project && input.itemId != null) return failure("invalid_amendment", "Constitution amendments are project-scoped; omit the item.");
        const item = project ? null : (await items(inst)).find((entry) => entry.id === input.itemId && !entry.isNew);
        if (!project && !item) return failure("invalid_amendment", "Choose an existing workflow item.");
        if (input.artifact !== await resolveDeclaredArtifact(inst.cwd, step.artifact?.pathTemplate, item?.slug, pipeline)) {
            return failure("invalid_artifact", "The artifact does not belong to this phase and workflow item. Refresh and try again.");
        }
        const content = await readWorkflowArtifact(inst.cwd, input.artifact, pipeline);
        const answers = input.answers;
        const invalid = validateAmendmentAnswers(content, answers);
        if (invalid) return invalid;
        const key = JSON.stringify([inst.cwd, inst.identity, input.artifact]);
        const previous = active.get(key);
        if (previous && (previous.sending || (now() - previous.startedAt < AMENDMENT_WAIT_MS
            && previous.markers.some((marker) => markerPresent(content, marker))))) {
            return failure("amendment_pending", "An amendment for this artifact is still awaiting observation. Refresh before retrying.");
        }
        // Reserve before awaiting gates/dispatch, including requests from another panel.
        const reservation = { sending: true, startedAt: now(), markers: answers.map((entry) => entry.marker) };
        active.set(key, reservation);
        try {
            const blocked = await gate(inst);
            if (blocked) { active.delete(key); return blocked; }
            await dispatch({ prompt: buildAmendmentPrompt(input.artifact, content, answers, inst.cwd) });
            reservation.sending = false;
            reservation.startedAt = now();
            const timer = setTimeout(() => {
                if (active.get(key) === reservation) active.delete(key);
            }, AMENDMENT_WAIT_MS);
            timer.unref?.();
            return { ok: true, phase: step.instanceKey, artifact: input.artifact };
        } catch {
            active.delete(key);
            return failure("amendment_failed", "Could not dispatch the amendment. Your answers are retained; retry when ready.");
        }
    };
}
