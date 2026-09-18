// Verify shared clarification drafts remain subordinate to visible artifact markers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClarifications as wizardParse } from "../pipeline/canonical.mjs";
import { applicableDrafts, clarificationKey, createClarificationQueue, parseClarifications } from "../generation/generated-canvas-template/ui/clarifications.mjs";
import { renderMarkdown } from "../shared-workflow-ui/markdown.mjs";

const context = Object.freeze({ scope: "workspace-and-canvas", itemId: "alpha", phase: "2:custom-plan", artifact: "specs/alpha/plan.md" });
const accepted = { ok: true, phase: context.phase, artifact: context.artifact };
const memoryStorage = () => {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test("generated marker parsing matches the actual Wizard syntax and offsets", () => {
    for (const source of [
        "[NEEDS CLARIFICATION: Which scope?]",
        "before [needs clarification:\n multi-line\n question ] after [NEEDS CLARIFICATION: second]",
        "[NEEDS CLARIFICATION: <img onerror=x> & \"quoted\" `code` **text**?]",
        "[NEEDS CLARIFICATION: unfinished", "[TODO: not a clarification]", null,
    ]) assert.deepEqual(parseClarifications(source), wizardParse(source));
});

test("markers are escaped controls in prose, headings, lists and tables, never HTML injection", () => {
    const marks = [];
    const html = renderMarkdown('# [NEEDS CLARIFICATION: Which `scope`?]\n\n- [needs clarification: <img src=x> & "text"?]\n\n| Question | Status |\n| --- | ---|\n| [NEEDS CLARIFICATION: table?] | Open |\n\n[NEEDS CLARIFICATION:\nmultiline question]', { clarifications: marks });
    assert.equal(marks.length, 4);
    assert.equal((html.match(/data-clarify-idx=/g) ?? []).length, 4);
    assert.match(html, /&lt;img src=x&gt; &amp; &quot;text&quot;/);
    assert.match(html, /<table>/);
    assert.doesNotMatch(html, /<img|<code>scope/);
    assert.deepEqual(marks.map((entry) => entry.question), ["Which `scope`?", '<img src=x> & "text"?', "table?", "multiline question"]);
});

test("fenced code, inline code, links and comments do not expose clarification controls", () => {
    const marks = [];
    const html = renderMarkdown([
        "```md", "[NEEDS CLARIFICATION: backtick]", "```",
        "  ~~~~md", "[NEEDS CLARIFICATION: tilde]", "  ~~~~",
        "`[NEEDS CLARIFICATION: inline]`",
        "``[NEEDS CLARIFICATION: `nested` code]``",
        "[NEEDS CLARIFICATION: link](https://example.test)",
        "[Read [NEEDS CLARIFICATION: nested link]](https://example.test)",
        "<!-- [NEEDS CLARIFICATION: hidden] -->",
        "<scr<!-- hidden -->ipt>alert(1)</script>",
        "\uE0000\uE001",
    ].join("\n\n"), { clarifications: marks });
    assert.deepEqual(marks, []);
    assert.doesNotMatch(html, /data-clarify-idx|<script/);
    assert.match(html, /href="https:\/\/example.test"/);
    assert.match(html, /&lt;scr ipt&gt;/);
});

test("unsafe link targets stay inert and marker text cannot escape link attributes", () => {
    const marks = [];
    const html = renderMarkdown('[link](javascript:alert) [safe](https://example.test/"onmouseover="x)\n[NEEDS CLARIFICATION: "><script>bad</script>]', { clarifications: marks });
    assert.match(html, /href="#"/);
    assert.match(html, /&quot;onmouseover=&quot;x/);
    assert.doesNotMatch(html, /<script|href="javascript:|href="[^"]*"onmouseover=/);
    assert.equal(marks.length, 1);
});

test("queue isolates workspace/canvas, item, exact phase, artifact and project scopes and persists locally", () => {
    const storage = memoryStorage();
    const queue = createClarificationQueue(storage);
    queue.queue(context, "Scope?", "Alpha");
    for (const changed of [
        { scope: "another-workspace-or-canvas" }, { itemId: "beta" },
        { phase: "3:custom-plan" }, { artifact: "specs/alpha/research.md" }, { itemId: undefined },
    ]) assert.deepEqual(queue.list({ ...context, ...changed }), []);
    assert.equal(createClarificationQueue(storage).list(context)[0].answer, "Alpha");
    const copy = queue.list(context);
    copy[0].answer = "not a mutation";
    assert.equal(queue.list(context)[0].answer, "Alpha");
});

test("two of five answers dispatch a dedicated amendment payload and remain until observed", async () => {
    let time = 0;
    const queue = createClarificationQueue(memoryStorage(), { now: () => time });
    queue.queue(context, "Which scope?", "Core only");
    queue.queue(context, "Tests?", "Focused");
    let input;
    const outcome = await queue.flush(context, {
        dispatch: async (value) => { input = value; return accepted; },
    });
    assert.deepEqual(input, {
        phase: "2:custom-plan", itemId: "alpha",
        artifact: context.artifact,
        answers: [
            { question: "Which scope?", answer: "Core only", marker: "[NEEDS CLARIFICATION: Which scope?]" },
            { question: "Tests?", answer: "Focused", marker: "[NEEDS CLARIFICATION: Tests?]" },
        ],
    });
    assert.equal(outcome.accepted, true);
    assert.equal(queue.list(context).length, 2);
    assert.equal(queue.isPending(context), true);
    const unchanged = "[NEEDS CLARIFICATION: Which scope?]\n[NEEDS CLARIFICATION: Tests?]\n[NEEDS CLARIFICATION: Third?]\n[NEEDS CLARIFICATION: Fourth?]\n[NEEDS CLARIFICATION: Fifth?]";
    assert.equal(queue.observe(context, unchanged).resolved, 0);
    const partial = unchanged.replace("[NEEDS CLARIFICATION: Which scope?]", "Core only");
    assert.equal(queue.observe(context, partial).resolved, 0);
    time += 1001;
    assert.equal(queue.observe(context, partial).resolved, 1);
    assert.equal(queue.list(context)[0].question, "Tests?");
    assert.equal(queue.isPending(context), true);
    queue.observe(context, "[NEEDS CLARIFICATION: Third?]");
    time += 1001;
    assert.equal(queue.observe(context, "[NEEDS CLARIFICATION: Third?]").complete, true);
    assert.equal(queue.isPending(context), false);
    assert.deepEqual(queue.list(context), []);
});

test("CRLF multiline markers remain pending until their actual disappearance", async () => {
    const queue = createClarificationQueue();
    queue.queue(context, "Scope?", "Core", "[NEEDS CLARIFICATION:\nScope?]");
    await queue.flush(context, { dispatch: async () => accepted });
    assert.equal(queue.observe(context, "[NEEDS CLARIFICATION:\r\nScope?]").resolved, 0);
    assert.equal(queue.list(context).length, 1);
});

test("Constitution clarification uses its exact captured project phase without item or slug", async () => {
    let time = 0;
    const queue = createClarificationQueue(undefined, { now: () => time });
    const project = { scope: "project-canvas", phase: "7:constitution-override", artifact: ".specify/memory/constitution.md" };
    queue.queue(project, "Testing?", "Required");
    await queue.flush(project, { dispatch: async (input) => {
        assert.deepEqual(Object.keys(input), ["phase", "artifact", "answers"]);
        assert.equal(input.phase, "7:constitution-override");
        return { ok: true, phase: input.phase, artifact: input.artifact };
    } });
    assert.equal(queue.list(project).length, 1);
    queue.observe(project, "Testing is required");
    time += 1001;
    queue.observe(project, "Testing is required");
    assert.deepEqual(queue.list(project), []);
});

test("failed dispatch, gates, stale markers and unexpected setup queues retain answers", async () => {
    const queue = createClarificationQueue();
    queue.queue(context, "Scope?", "Retain me");
    await assert.rejects(queue.flush(context, { dispatch: async () => { throw new Error("offline"); } }), /offline/);
    for (const result of [
        undefined, {}, { ok: false }, { ok: true, phase: "wrong-phase" },
        { ok: false, approvalRequired: true }, { ok: false, code: "setup_required" }, { ok: false, code: "stale_markers" },
        { ...accepted, queued: true },
    ]) {
        const outcome = await queue.flush(context, { dispatch: async () => result });
        assert.equal(outcome.accepted, false);
        assert.equal(queue.list(context)[0].answer, "Retain me");
        assert.equal(queue.isPending(context), false);
    }
});

test("in-flight additions and changed revisions survive, including edit away and back", async () => {
    let time = 0;
    const queue = createClarificationQueue(undefined, { now: () => time });
    queue.queue(context, "Scope?", "Initial");
    queue.queue(context, "Unchanged?", "Remove on success");
    let release;
    const sending = queue.flush(context, { dispatch: () => new Promise((resolve) => { release = resolve; }) });
    await Promise.resolve();
    assert.equal(queue.isPending(context), true);
    assert.deepEqual(await queue.flush(context, { dispatch: () => assert.fail("duplicate artifact dispatch") }), { accepted: false, pending: true });
    queue.queue(context, "Scope?", "Updated");
    queue.queue(context, "Scope?", "Initial");
    queue.queue(context, "Added?", "Keep");
    release(accepted);
    await sending;
    assert.equal(queue.list(context).length, 3, "dispatch acknowledgement must not clear answers");
    queue.observe(context, "All submitted markers were incorporated.");
    time += 1001;
    queue.observe(context, "All submitted markers were incorporated.");
    assert.deepEqual(queue.list(context).map(({ question, answer }) => ({ question, answer })), [
        { question: "Scope?", answer: "Initial" }, { question: "Added?", answer: "Keep" },
    ]);
    assert.equal(queue.isPending(context), false);
});

test("only drafts survive reload; timeout is retryable and stale reads cannot complete a new submission", async () => {
    const storage = memoryStorage();
    let time = 100;
    let queue = createClarificationQueue(storage, { now: () => time });
    queue.queue(context, "Scope?", "Core");
    const beforeDispatch = queue.observationToken(context);
    await queue.flush(context, { dispatch: async () => accepted });
    assert.equal(queue.observe(context, "old read without markers", beforeDispatch), null);
    const restored = createClarificationQueue(storage, { now: () => time });
    assert.equal(restored.isPending(context), false);
    assert.equal(restored.hasSubmission(context), false);
    assert.equal(restored.list(context)[0].answer, "Core");
    time += 120_001;
    assert.equal(queue.observe(context, "[NEEDS CLARIFICATION: Scope?]").timedOut, true);
    assert.equal(queue.list(context).length, 1);
    assert.equal(queue.isPending(context), false);
    const oldToken = queue.observationToken(context);
    await queue.flush(context, { dispatch: async () => accepted });
    assert.equal(queue.observe(context, "stale content", oldToken), null);
    assert.equal(queue.list(context).length, 1);
});

test("an unresolved marker permits immediate updated submissions without stale observations consuming drafts", async () => {
    let time = 0;
    const queue = createClarificationQueue(memoryStorage(), { now: () => time });
    const marker = "[NEEDS CLARIFICATION: Scope?]";
    queue.queue(context, "Scope?", "Core");
    await queue.flush(context, { content: marker, dispatch: async () => accepted });
    const firstToken = queue.observationToken(context);
    queue.observe(context, `${marker}\nPlease name the included features.`);
    time += 1001;
    queue.observe(context, `${marker}\nPlease name the included features.`);
    queue.queue(context, "Scope?", "Intake and research only");
    let sent;
    assert.equal((await queue.flush(context, { content: marker,
        dispatch: async (input) => { sent = input; return accepted; } })).accepted, true);
    assert.equal(sent.answers[0].answer, "Intake and research only");
    assert.equal(queue.observe(context, "Old request resolved", firstToken), null);
    assert.equal(queue.list(context)[0].answer, "Intake and research only");
    queue.observe(context, "Scope: intake and research only.");
    time += 1001;
    assert.equal(queue.observe(context, "Scope: intake and research only.").complete, true);
    assert.deepEqual(queue.list(context), []);
});

test("subset selection and empty/truncated/unstable writes never erase drafts", async () => {
    let time = 0;
    const storage = memoryStorage();
    const queue = createClarificationQueue(storage, { now: () => time });
    queue.queue(context, "First?", "First");
    queue.queue(context, "Second?", "Second");
    const source = "[NEEDS CLARIFICATION: First?]\n[NEEDS CLARIFICATION: Second?]";
    let sent;
    await queue.flush(context, { content: source, markers: ["[NEEDS CLARIFICATION: First?]"],
        dispatch: async (input) => { sent = input; return accepted; } });
    assert.equal(sent.answers.length, 1);
    for (const text of ["", "", "# Truncated", "# Truncated", "First.\n[NEEDS CLARIFICATION: Second?]", ""]) {
        time += 1001;
        assert.equal(queue.observe(context, text).resolved, 0);
        assert.equal(queue.list(context).length, 2);
    }
    const final = "First.\n[NEEDS CLARIFICATION: Second?]";
    queue.observe(context, final);
    time += 1001;
    assert.equal(queue.observe(context, final).resolved, 1);
    assert.equal(queue.list(context)[0].answer, "Second");
});

test("unavailable or malformed browser storage never prevents staging or preserves corrupt entries", () => {
    for (const storage of [
        { getItem: () => "{", setItem: () => { throw new Error("quota"); } },
        { getItem: () => '{"answers":[null,{"question":3,"answer":"x"}]}' },
        { getItem: () => { throw new Error("blocked"); } },
    ]) {
        const queue = createClarificationQueue(storage);
        assert.deepEqual(queue.list(context), []);
        queue.queue(context, "Q", "A");
        assert.equal(queue.list(context)[0].answer, "A");
    }
});

test("legacy submission metadata is ignored, only drafts persist and changed markers cannot inherit them", () => {
    const storage = memoryStorage();
    const key = `speckit-clarifications.v1:${clarificationKey(context)}`;
    const entry = { question: "Scope?", marker: "[NEEDS CLARIFICATION: Scope?]", answer: "Keep", revision: 1 };
    storage.setItem(key, JSON.stringify({ answers: [entry], submitted: { startedAt: Date.now(), answers: [entry] } }));
    const queue = createClarificationQueue(storage);
    assert.equal(queue.isPending(context), false);
    assert.equal(queue.hasSubmission(context), false);
    assert.equal(queue.observe(context, "No markers."), null);
    assert.equal(queue.list(context)[0].answer, "Keep");
    assert.deepEqual(applicableDrafts(queue.list(context), [{ question: "Scope?", marker: "[needs clarification: Scope?]" }]), []);
    queue.queue(context, "Scope?", "Edited");
    assert.deepEqual(Object.keys(JSON.parse(storage.getItem(key))), ["answers"]);
});
