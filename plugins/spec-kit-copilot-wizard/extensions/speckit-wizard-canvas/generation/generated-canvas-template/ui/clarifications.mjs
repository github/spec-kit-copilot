// Keep the standalone template's marker syntax identical to the Wizard canonical parser.
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

export const AMENDMENT_WAIT_MS = 120_000;
export const markerPresent = (content, marker) => content.replace(/\r\n?/g, "\n").includes(marker.replace(/\r\n?/g, "\n"));

export function createClarificationQueue(storage, { now = Date.now } = {}) {
    const cache = new Map();
    const pending = new Map();
    const keyFor = (context) => `speckit-clarifications.v1:${clarificationKey(context)}`;
    const read = (context) => {
        const key = keyFor(context);
        if (!cache.has(key)) {
            let value;
            try { value = JSON.parse(storage?.getItem(key)); } catch {}
            cache.set(key, {
                answers: Array.isArray(value?.answers) ? value.answers.filter((entry) => (
                    typeof entry?.question === "string" && typeof entry?.answer === "string"
                )) : [],
                submitted: Array.isArray(value?.submitted?.answers) && value.submitted.answers.every((entry) => (
                    typeof entry?.question === "string" && typeof entry?.answer === "string" && typeof entry?.marker === "string"
                )) && Number.isFinite(value.submitted.startedAt) && value.submitted.startedAt <= now()
                    ? value.submitted : null,
            });
        }
        return cache.get(key);
    };
    const save = (context) => {
        try { storage?.setItem(keyFor(context), JSON.stringify(read(context))); } catch {}
    };
    const list = (context) => read(context).answers.map((answer) => ({ ...answer }));
    const isPending = (context) => pending.has(clarificationKey(context))
        || Boolean(read(context).submitted && now() - read(context).submitted.startedAt < AMENDMENT_WAIT_MS);
    return {
        list,
        isPending,
        hasSubmission: (context) => Boolean(read(context).submitted),
        observationToken: (context) => read(context).submitted,
        queue(context, question, answer, marker = `[NEEDS CLARIFICATION: ${question}]`) {
            const value = read(context);
            const previous = value.answers.find((entry) => entry.question === question);
            const entry = { question, answer, marker, revision: (previous?.revision ?? 0) + 1 };
            value.answers = [...value.answers.filter((entry) => entry.question !== question), entry];
            save(context);
        },
        observe(context, content, token = read(context).submitted) {
            const value = read(context);
            const submission = value.submitted;
            if (!submission || token !== submission || pending.has(clarificationKey(context))) return null;
            const resolved = submission.answers.filter((entry) => !markerPresent(content, entry.marker));
            value.answers = value.answers.filter((entry) => !resolved.some((snapshot) => (
                snapshot.question === entry.question && snapshot.answer === entry.answer
                && snapshot.revision === entry.revision
            )));
            submission.answers = submission.answers.filter((entry) => markerPresent(content, entry.marker));
            const complete = !submission.answers.length;
            const timedOut = !complete && now() - submission.startedAt >= AMENDMENT_WAIT_MS;
            if (complete) value.submitted = null;
            save(context);
            return { resolved: resolved.length, remaining: submission.answers.length, complete, timedOut };
        },
        async flush(context, { dispatch }) {
            const key = clarificationKey(context);
            if (isPending(context)) return { accepted: false, pending: true };
            const submitted = list(context);
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
                value.submitted = { startedAt: now(), answers: submitted.map((entry) => ({
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
