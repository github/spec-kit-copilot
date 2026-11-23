export function createClarificationDraftStore() {
    const drafts = new Map();
    const pending = new Set();
    let editVersion = 0;
    const keyFor = (binding) => {
        const values = [binding?.contextId, binding?.artifactId, binding?.commandName, binding?.revision, binding?.questionId];
        if (values.some((value) => typeof value !== "string" || !value || value.length > 256) ||
            !/^sha256:[a-f0-9]{64}$/.test(binding.revision) || !/^speckit[.-][a-z0-9.-]+$/i.test(binding.commandName) ||
            typeof binding.question !== "string" || !binding.question.trim() || binding.question.length > 4000) {
            throw new Error("Invalid clarification binding.");
        }
        return JSON.stringify(values);
    };
    const isPending = (contextId) => [...pending].some((submission) => submission.contextId === contextId);
    return {
        get(binding) {
            const draft = drafts.get(keyFor(binding));
            return draft ? { ...draft } : null;
        },
        save(binding, answer) {
            const key = keyFor(binding);
            if (typeof answer !== "string" || !answer.trim() || answer.length > 4000) throw new Error("A bounded answer is required.");
            if (!drafts.has(key) && drafts.size >= 1000) throw new Error("Too many clarification drafts.");
            if (drafts.get(key)?.status === "stale") throw new Error("The clarification source is stale.");
            const draft = {
                contextId: binding.contextId, artifactId: binding.artifactId, commandName: binding.commandName,
                revision: binding.revision, questionId: binding.questionId, question: binding.question,
                answer: answer.trim(), editVersion: ++editVersion, status: "queued",
            };
            drafts.set(key, draft);
            return { ...draft };
        },
        recover(previous, binding, answer) {
            const previousKey = keyFor(previous);
            keyFor(binding);
            const draft = drafts.get(previousKey);
            if (!draft || draft.status !== "stale" || isPending(binding.contextId) || draft.revision === binding.revision ||
                ["contextId", "artifactId", "commandName", "question"].some((field) => draft[field] !== binding[field])) {
                throw new Error("The saved answer does not match the current clarification.");
            }
            const recovered = this.save(binding, answer);
            drafts.delete(previousKey);
            return recovered;
        },
        list(contextId, artifactId, revision) {
            return [...drafts.values()].filter((draft) => draft.contextId === contextId &&
                (!artifactId || draft.artifactId === artifactId) && (!revision || draft.revision === revision)).map((draft) => ({ ...draft }));
        },
        begin(bindings) {
            if (!Array.isArray(bindings) || !bindings.length || bindings.length > 100) throw new Error("No valid clarification drafts selected.");
            const entries = bindings.map((binding) => {
                const key = keyFor(binding);
                const draft = drafts.get(key);
                if (!draft) throw new Error("Clarification draft is unavailable.");
                if (draft.status === "stale") throw new Error("The clarification source is stale.");
                return { ...draft, key };
            });
            const first = entries[0];
            if (new Set(entries.map((entry) => entry.key)).size !== entries.length || entries.some((entry) =>
                entry.contextId !== first.contextId || entry.artifactId !== first.artifactId || entry.revision !== first.revision || entry.commandName !== first.commandName)) {
                throw new Error("A submission must belong to one artifact and command.");
            }
            if (isPending(first.contextId)) throw new Error("A clarification submission is already pending.");
            const submission = Object.freeze({ contextId: first.contextId, entries: Object.freeze(entries.map((entry) => Object.freeze(entry))) });
            pending.add(submission);
            for (const entry of entries) drafts.get(entry.key).status = "submitting";
            return submission;
        },
        complete(submission, { ok }) {
            if (!pending.delete(submission)) return false;
            for (const sent of submission.entries) {
                const current = drafts.get(sent.key);
                if (!current || current.status === "stale") continue;
                if (current.editVersion !== sent.editVersion) { current.status = "queued"; continue; }
                if (ok) drafts.delete(sent.key);
                else current.status = "failed";
            }
            return true;
        },
        invalidate(contextId, artifactId, revision) {
            for (const draft of drafts.values()) {
                if (draft.contextId === contextId && draft.artifactId === artifactId && draft.revision !== revision) draft.status = "stale";
            }
        },
        isPending,
        discard(contextId) {
            if (isPending(contextId)) return false;
            for (const [key, draft] of drafts) if (draft.contextId === contextId) drafts.delete(key);
            return true;
        },
    };
}
