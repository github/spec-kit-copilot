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

export function createClarificationQueue(storage) {
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
                lastSubmitted: typeof value?.lastSubmitted === "string" ? value.lastSubmitted : null,
            });
        }
        return cache.get(key);
    };
    const save = (context) => {
        try { storage?.setItem(keyFor(context), JSON.stringify(read(context))); } catch {}
    };
    const list = (context) => read(context).answers.map((answer) => ({ ...answer }));
    const phaseKey = (context) => JSON.stringify([context.scope, context.itemId ?? null, context.phase]);
    return {
        list,
        isPending: (context) => pending.has(phaseKey(context)),
        queue(context, question, answer) {
            const value = read(context);
            const previous = value.answers.find((entry) => entry.question === question);
            const entry = { question, answer, revision: (previous?.revision ?? 0) + 1 };
            value.answers = [...value.answers.filter((entry) => entry.question !== question), entry];
            save(context);
        },
        async flush(context, { confirm, dispatch, baseArgs }) {
            const key = phaseKey(context);
            if (pending.has(key)) return { accepted: false, pending: true };
            const submitted = list(context);
            if (!submitted.length) return { accepted: false };
            pending.set(key, true);
            try {
                if (!await confirm()) return { accepted: false, cancelled: true };
                const suffix = submitted.map(({ question, answer }) => `Clarification — ${question}\nAnswer: ${answer}`).join("\n\n");
                const args = [baseArgs ?? read(context).lastSubmitted ?? "",
                    `Clarifications for artifact: ${context.artifact}\n\n${suffix}`].filter(Boolean).join("\n\n");
                const result = await dispatch({
                    phase: context.phase,
                    ...(context.itemId != null ? { itemId: context.itemId } : {}),
                    args,
                });
                if (result?.ok !== true || result.phase !== context.phase || result.approvalRequired) {
                    return { accepted: false, result };
                }
                // Setup can still fail or hit a prerequisite when it drains the queue.
                if (result.queued) return { accepted: true, result, args };
                const value = read(context);
                value.lastSubmitted = args;
                value.answers = value.answers.filter((entry) => !submitted.some((snapshot) => (
                    snapshot.question === entry.question && snapshot.answer === entry.answer
                    && snapshot.revision === entry.revision
                )));
                save(context);
                return { accepted: true, result, args };
            } finally {
                pending.delete(key);
            }
        },
    };
}
