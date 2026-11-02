import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClarificationSource } from "../src/clarificationParser.ts";

test("source parser recognizes only eligible prose with exact source offsets", () => {
    const source = "# Scope\n\n## *[NEEDS CLARIFICATION: Nested heading?]*\n\nA &#38; B &amp; C \\* D [NEEDS CLARIFICATION: Real?] and \\[NEEDS CLARIFICATION: Escaped?] and &#91;NEEDS CLARIFICATION: Entity?]\n\n[**[NEEDS CLARIFICATION: Nested link?]**](research.md)\n\n`[NEEDS CLARIFICATION: Inline?]`\n\n    [NEEDS CLARIFICATION: Indent?]\n\n~~~md\n[NEEDS CLARIFICATION: Fence?]\n~~~\n\n<!--\n[NEEDS CLARIFICATION: Comment?]\n-->\n";
    const questions = parseClarificationSource(source);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]?.question, "Real?");
    assert.equal(questions[0]?.section, "[NEEDS CLARIFICATION: Nested heading?]");
    assert.equal(source.slice(questions[0]!.startIdx, questions[0]!.endIdx), "[NEEDS CLARIFICATION: Real?]");
});

test("source parser preserves stable duplicate question indices across tables and prose", () => {
    const source = "# Questions\n\n[NEEDS CLARIFICATION: Same?]\n\n| Item | Question |\n| --- | --- |\n| One | [NEEDS CLARIFICATION: Same?] |\n";
    const questions = parseClarificationSource(source);
    assert.deepEqual(questions.map((question) => question.index), [0, 1]);
    assert.notEqual(questions[0]?.startIdx, questions[1]?.startIdx);
});

test("source parser retains inline formatting and autolinks inside eligible questions", () => {
    const expected = [
        "Should `retry` default to true?",
        "Is *required* mandatory?",
        "Use https://example.invalid/docs?",
        "Contact owner@example.invalid?",
        "Should **timeout** be configurable?",
        "Can `quoted` questions be answered?",
        "Should `items[0]` remain available?",
    ];
    const source = [
        "# Formatted questions",
        ...expected.slice(0, 4).map((question) => `[NEEDS CLARIFICATION: ${question}]`),
        "| Item | Question |\n| --- | --- |\n| Config | [NEEDS CLARIFICATION: Should **timeout** be configurable?] |",
        "> Context before the question.\n> [NEEDS CLARIFICATION: Can `quoted` questions be answered?]",
        "[NEEDS CLARIFICATION: Should `items[0]` remain available?]",
        "`[NEEDS CLARIFICATION: Inert inline example?]`",
        "[[NEEDS CLARIFICATION: Inert link label?]](https://example.invalid/)",
        "![NEEDS CLARIFICATION: Inert image label?](image.png)",
        "\\[NEEDS CLARIFICATION: Escaped example?]",
        "&#91;NEEDS CLARIFICATION: Encoded example?]",
        "https://example.invalid/[NEEDS CLARIFICATION: Inert URL fragment?]",
    ].join("\n\n");
    const questions = parseClarificationSource(source);
    assert.deepEqual(questions.map((question) => question.question), expected);
    assert.deepEqual(questions.map((question) => question.index), [0, 1, 2, 3, 4, 5, 6]);
    for (const question of questions) {
        assert.equal(source.slice(question.startIdx, question.endIdx), `[NEEDS CLARIFICATION: ${question.question}]`);
    }
});
