import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClarifications as wizardParse } from "../pipeline/canonical.mjs";
import { createClarificationQueue, parseClarifications } from "../generation/generated-canvas-template/ui/clarifications.mjs";
import { renderMarkdown } from "../generation/generated-canvas-template/ui/markdown.mjs";

const context = Object.freeze({ scope: "workspace-and-canvas", itemId: "alpha", phase: "2:custom-plan", artifact: "specs/alpha/plan.md" });
const accepted = { ok: true, phase: context.phase };
const confirm = async () => true;
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

test("flush sends only the captured phase/item with artifact, prior input and question/answer payload", async () => {
    const queue = createClarificationQueue(memoryStorage());
    queue.queue(context, "Which scope?", "Core only");
    let input;
    const outcome = await queue.flush(context, {
        confirm, baseArgs: "Original input",
        dispatch: async (value) => { input = value; return accepted; },
    });
    assert.deepEqual(input, {
        phase: "2:custom-plan", itemId: "alpha",
        args: "Original input\n\nClarifications for artifact: specs/alpha/plan.md\n\nClarification — Which scope?\nAnswer: Core only",
    });
    assert.equal(outcome.accepted, true);
    assert.deepEqual(queue.list(context), []);
    queue.queue(context, "Tests?", "Focused");
    await queue.flush(context, { confirm, dispatch: async (next) => {
        assert.match(next.args, /^Original input/);
        assert.match(next.args, /Answer: Core only/);
        return accepted;
    } });
});

test("Constitution clarification uses its exact captured project phase without item or slug", async () => {
    const queue = createClarificationQueue();
    const project = { scope: "project-canvas", phase: "7:constitution-override", artifact: ".specify/memory/constitution.md" };
    queue.queue(project, "Testing?", "Required");
    await queue.flush(project, { confirm, dispatch: async (input) => {
        assert.deepEqual(Object.keys(input), ["phase", "args"]);
        assert.equal(input.phase, "7:constitution-override");
        return { ok: true, phase: input.phase };
    } });
    assert.deepEqual(queue.list(project), []);
});

test("cancel, thrown dispatch, failed or gated responses and setup queues retain answers", async () => {
    const queue = createClarificationQueue();
    queue.queue(context, "Scope?", "Retain me");
    const cancelled = await queue.flush(context, { confirm: async () => false, dispatch: () => assert.fail("cancel dispatched") });
    assert.equal(cancelled.cancelled, true);
    await assert.rejects(queue.flush(context, { confirm, dispatch: async () => { throw new Error("offline"); } }), /offline/);
    for (const result of [
        undefined, {}, { ok: false }, { ok: true, phase: "wrong-phase" },
        { ok: false, approvalRequired: true }, { ok: false, code: "constitution_required" },
        { ok: true, phase: context.phase, queued: true },
    ]) {
        const outcome = await queue.flush(context, { confirm, dispatch: async () => result });
        assert.equal(outcome.accepted, Boolean(result?.queued));
        assert.equal(queue.list(context)[0].answer, "Retain me");
        assert.equal(queue.isPending(context), false);
    }
});

test("in-flight additions and changed revisions survive, including edit away and back", async () => {
    const queue = createClarificationQueue();
    queue.queue(context, "Scope?", "Initial");
    queue.queue(context, "Unchanged?", "Remove on success");
    let release;
    const sending = queue.flush(context, { confirm, dispatch: () => new Promise((resolve) => { release = resolve; }) });
    await Promise.resolve();
    assert.equal(queue.isPending(context), true);
    assert.deepEqual(await queue.flush({ ...context, artifact: "other.md" }, { confirm, dispatch: () => assert.fail("duplicate phase dispatch") }), { accepted: false, pending: true });
    queue.queue(context, "Scope?", "Updated");
    queue.queue(context, "Scope?", "Initial");
    queue.queue(context, "Added?", "Keep");
    release(accepted);
    await sending;
    assert.deepEqual(queue.list(context).map(({ question, answer }) => ({ question, answer })), [
        { question: "Scope?", answer: "Initial" }, { question: "Added?", answer: "Keep" },
    ]);
    assert.equal(queue.isPending(context), false);
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
