// Shared artifact-authoritative clarification drafts and transient batch observations.
import { renderMarkdown } from "./markdown.mjs";

export function parseClarifications(markdown) {
    return Array.from(String(markdown ?? "").matchAll(/\[NEEDS CLARIFICATION:\s*([\s\S]*?)\]/gi), (match) => ({
        question: match[1].trim(),
        startIdx: match.index,
        endIdx: match.index + match[0].length,
    }));
}

export function clarificationKey(context) {
    return JSON.stringify([context.scope, context.itemId ?? null, context.phase, context.artifact]);
}
export const wizardClarificationScope = (workspace) => JSON.stringify(["speckit-wizard", workspace]);

export const AMENDMENT_WAIT_MS = 120_000;
const normalize = (text) => text.replace(/\r\n?/g, "\n");
export function visibleMarkers(content) {
    const markers = [];
    renderMarkdown(content, { clarifications: markers });
    return markers;
}
export const markerPresent = (content, marker) => visibleMarkers(content).some((entry) => entry.marker === normalize(marker));
export const applicableDrafts = (answers, marks) => answers.filter((answer) => (
    marks.filter((mark) => mark.marker === answer.marker && mark.question === answer.question).length === 1
));

export function createClarificationQueue(storage, { now = Date.now } = {}) {
    const cache = new Map();
    const pending = new Map();
    let revision = 0;
    const keyFor = (context) => `speckit-clarifications.v1:${clarificationKey(context)}`;
    const read = (context) => {
        const key = keyFor(context);
        if (!cache.has(key)) {
            let value;
            try { value = JSON.parse(storage?.getItem(key)); } catch {}
            cache.set(key, {
                answers: Array.isArray(value?.answers) ? value.answers.filter((entry) => (
                    typeof entry?.question === "string" && typeof entry?.answer === "string"
                    && (entry.marker == null || typeof entry.marker === "string")
                )).map((entry) => ({
                    question: entry.question, answer: entry.answer,
                    marker: normalize(entry.marker ?? `[NEEDS CLARIFICATION: ${entry.question}]`),
                    revision: Number.isFinite(entry.revision) ? entry.revision : 0,
                })) : [],
                submitted: null,
            });
            revision = cache.get(key).answers.reduce((max, entry) => Math.max(max, entry.revision), revision);
        }
        return cache.get(key);
    };
    const save = (context) => {
        try { storage?.setItem(keyFor(context), JSON.stringify({ answers: read(context).answers })); } catch {}
    };
    const list = (context) => read(context).answers.map((answer) => ({ ...answer }));
    const isPending = (context) => pending.has(clarificationKey(context))
        || Boolean(read(context).submitted && now() - read(context).submitted.startedAt < AMENDMENT_WAIT_MS);
    return {
        list,
        isPending,
        isSending: (context) => pending.has(clarificationKey(context)),
        hasSubmission: (context) => Boolean(read(context).submitted),
        observationToken: (context) => read(context).submitted,
        queue(context, question, answer, marker = `[NEEDS CLARIFICATION: ${question}]`) {
            const value = read(context);
            marker = normalize(marker);
            const entry = { question, answer, marker, revision: ++revision };
            value.answers = [...value.answers.filter((entry) => entry.marker !== marker), entry];
            save(context);
        },
        discard(context, marker) {
            read(context).answers = read(context).answers.filter((entry) => entry.marker !== marker);
            save(context);
        },
        observe(context, content, token = read(context).submitted) {
            const value = read(context);
            const submission = value.submitted;
            if (!submission || token !== submission || pending.has(clarificationKey(context))) return null;
            const timedOut = now() - submission.startedAt >= AMENDMENT_WAIT_MS;
            const marks = visibleMarkers(content).map((entry) => entry.marker);
            // A stable, nonempty repeat observation is required. In particular, a
            // truncated write that also loses unanswered markers cannot retire drafts.
            const usable = content.trim() && submission.preserved.every((marker) => marks.includes(marker));
            const stable = usable && submission.observed === content && now() - submission.observedAt >= 1000;
            if (!usable || submission.observed !== content) {
                submission.observed = usable ? content : null;
                submission.observedAt = now();
            }
            const resolved = stable ? submission.answers.filter((entry) => !marks.includes(entry.marker)) : [];
            value.answers = value.answers.filter((entry) => !resolved.some((snapshot) => (
                snapshot.marker === entry.marker && snapshot.answer === entry.answer
                && snapshot.revision === entry.revision
            )));
            submission.answers = submission.answers.filter((entry) => !resolved.includes(entry));
            const complete = !submission.answers.length;
            if (complete || timedOut) value.submitted = null;
            save(context);
            return { resolved: resolved.length, remaining: submission.answers.length, complete, timedOut };
        },
        async flush(context, { dispatch, markers, content = "" }) {
            const key = clarificationKey(context);
            if (pending.has(key)) return { accepted: false, pending: true };
            const submitted = list(context).filter((entry) => !markers || markers.includes(entry.marker));
            if (!submitted.length) return { accepted: false };
            pending.set(key, true);
            try {
                const result = await dispatch({
                    phase: context.phase,
                    ...(context.itemId != null ? { itemId: context.itemId } : {}),
                    artifact: context.artifact,
                    answers: submitted.map(({ question, answer, marker }) => ({
                        question, answer, marker: marker ?? `[NEEDS CLARIFICATION: ${question}]`,
                    })),
                });
                if (result?.ok !== true || result.phase !== context.phase || result.artifact !== context.artifact
                    || result.queued || result.approvalRequired) {
                    return { accepted: false, result };
                }
                const value = read(context);
                value.submitted = { startedAt: now(),
                    preserved: visibleMarkers(content).map((entry) => entry.marker).filter((marker) => !submitted.some((entry) => entry.marker === marker)),
                    answers: submitted.map((entry) => ({
                    ...entry, marker: entry.marker ?? `[NEEDS CLARIFICATION: ${entry.question}]`,
                })) };
                save(context);
                return { accepted: true, result };
            } finally {
                pending.delete(key);
            }
        },
    };
}
