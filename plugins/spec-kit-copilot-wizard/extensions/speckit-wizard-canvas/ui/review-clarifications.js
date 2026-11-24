import { createClarificationDraftStore } from "./clarification-drafts.js";
import { openWizardModal } from "./answer-dialog.js";

export function clarificationBatchWithinBudget(answers, maximum) {
    return Number.isSafeInteger(maximum) && maximum > 0 &&
        new TextEncoder().encode(JSON.stringify(answers)).byteLength <= maximum;
}

export function createReviewClarifications({ getRoot, getReview, isReady, closeViewer, submit }) {
    const reviewDrafts = createClarificationDraftStore();

    function reviewSubmissionPending() {
        const contextId = getReview()?.context?.contextId;
        return Boolean(contextId && reviewDrafts.isPending(contextId));
    }

    function discardReviewDrafts() {
        const contextId = getReview()?.context?.contextId;
        if (contextId) reviewDrafts.discard(contextId);
    }

    function reviewBinding(descriptor, contextId) {
        return { ...descriptor, contextId };
    }

    function boundReviewClarifications(document, context) {
        if (!context) return [];
        reviewDrafts.invalidate(context.contextId, document.artifact.id, document.revision);
        return (document.clarifications ?? []).filter((descriptor) => descriptor.mode === "wizard-batched").map((descriptor) => {
            const draft = reviewDrafts.get(reviewBinding(descriptor, context.contextId));
            return { ...descriptor, answer: draft?.answer, status: draft?.status };
        });
    }

    function renderReviewDraftBanner(message = "") {
        const root = getRoot();
        const banner = root?.querySelector(".artifact-viewer-clarify-banner");
        const context = getReview()?.context;
        const current = getReview()?.document;
        if (!banner || !context || !current) return;
        reviewDrafts.invalidate(context.contextId, current.artifact.id, current.revision);
        const drafts = reviewDrafts.list(context.contextId, current.artifact.id, current.revision);
        const staleDrafts = reviewDrafts.list(context.contextId, current.artifact.id).filter((draft) => draft.revision !== current.revision);
        const pending = reviewDrafts.isPending(context.contextId);
        const setupReady = isReady();
        banner.hidden = !drafts.length && !staleDrafts.length && !message;
        banner.replaceChildren();
        if (!banner.hidden) {
            const text = document.createElement("span");
            text.textContent = message || (staleDrafts.length ? "Saved answers from an earlier revision need confirmation."
                : !setupReady ? `${drafts.length} clarification${drafts.length === 1 ? "" : "s"} queued. Complete setup before applying.`
                : `${drafts.length} clarification${drafts.length === 1 ? "" : "s"} queued${pending ? "; applying..." : "."}`);
            banner.append(text);
            if (drafts.length) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn btn-primary btn-sm";
                button.textContent = pending ? "Applying..." : "Apply and Rerun";
                button.disabled = pending || !setupReady || drafts.some((draft) => draft.status === "stale");
                button.addEventListener("click", () => void flushReviewedClarifications());
                banner.append(button);
            }
            for (const previous of staleDrafts) {
                const saved = document.createElement("div");
                saved.className = "artifact-viewer-saved-answer";
                const answer = document.createElement("p");
                answer.textContent = `${previous.question}\n${previous.answer}`;
                saved.append(answer);
                const matches = (current.clarifications ?? []).filter((descriptor) => descriptor.mode === "wizard-batched" &&
                    descriptor.commandName === previous.commandName && descriptor.question === previous.question);
                if (matches.length === 1) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "btn btn-secondary btn-sm";
                    button.textContent = "Review saved answer";
                    button.setAttribute("aria-label", `Review saved answer: ${previous.question}`);
                    button.disabled = pending;
                    button.addEventListener("click", () => openReviewedClarification(matches[0].id, previous));
                    saved.append(button);
                }
                banner.append(saved);
            }
        }
        getReview()?.updateControls();
    }

    async function flushReviewedClarifications() {
        const review = getReview();
        const context = review?.context;
        const current = review?.document;
        if (!context || !current || reviewDrafts.isPending(context.contextId)) return false;
        const bindings = boundReviewClarifications(current, context).filter((binding) => binding.answer).map((binding) => reviewBinding(binding, context.contextId));
        if (!bindings.length || bindings.some((binding) => binding.status === "stale")) return false;
        if (!isReady()) {
            renderReviewDraftBanner("Complete setup before applying clarifications and rerunning.");
            return false;
        }
        const commandName = bindings[0].commandName;
        const answers = bindings.map(({ questionId, question, answer }) => ({ questionId, question, answer }));
        if (!clarificationBatchWithinBudget(answers, context.clarificationBatchMaxBytes)) {
            renderReviewDraftBanner("Queued answers exceed the review submission limit. Shorten one or more answers.");
            return false;
        }
        let submission;
        try { submission = reviewDrafts.begin(bindings); }
        catch { renderReviewDraftBanner("The clarification source is stale or unavailable."); return false; }
        renderReviewDraftBanner();
        let ok = false;
        let stale = false;
        try {
            await review.validateClarifications(answers, commandName);
            if (getReview() !== review || review.document?.revision !== current.revision) throw Object.assign(new Error("Source changed"), { code: "changed_source" });
            await submit({ commandName, contextId: context.contextId, artifactId: current.artifact.id, expectedRevision: current.revision, answers });
            ok = true;
        } catch (error) {
            stale = error.code === "changed_source";
            if (stale) reviewDrafts.invalidate(context.contextId, current.artifact.id, "changed");
        } finally { reviewDrafts.complete(submission, { ok }); }
        if (getReview() === review) {
            if (ok && !reviewDrafts.list(context.contextId).length) await closeViewer();
            else renderReviewDraftBanner(ok ? "" : stale ? "Source changed. Refresh before submitting; your answers are preserved." : "Submission failed. Your queued answers are preserved.");
        }
        return ok;
    }

    function openReviewedClarification(descriptorId, previous) {
        const review = getReview();
        const context = review?.context;
        const current = review?.document;
        if (!context || !current || reviewDrafts.isPending(context.contextId)) return;
        const descriptor = boundReviewClarifications(current, context).find((binding) => binding.id === descriptorId);
        if (!descriptor || descriptor.status === "stale") return;
        const binding = reviewBinding(descriptor, context.contextId);
        openWizardModal({
            title: "Resolve clarification", questionBox: descriptor.question, textareaLabel: "Your answer",
            description: previous ? "Source changed. Confirm this answer against the current revision." : "",
            required: true, confirmLabel: "Save answer", initialValue: previous?.answer ?? descriptor.answer ?? "",
            onConfirm: async (value, close) => {
                if (getReview() !== review || review.document?.revision !== current.revision || review.context?.contextId !== context.contextId) {
                    close(); renderReviewDraftBanner("Source changed. Refresh before answering."); return;
                }
                try {
                    if (previous) reviewDrafts.recover(previous, binding, String(value ?? ""));
                    else reviewDrafts.save(binding, String(value ?? ""));
                }
                catch { renderReviewDraftBanner("The answer could not be queued for this source."); return; }
                close();
                renderReviewDraftBanner();
                const all = boundReviewClarifications(current, context);
                if (isReady() && all.length && all.every((item) => item.answer && item.status !== "stale")) await flushReviewedClarifications();
            },
        });
    }

    return { reviewSubmissionPending, discardReviewDrafts, boundReviewClarifications, renderReviewDraftBanner, openReviewedClarification };
}
