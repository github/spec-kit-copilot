import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClarificationSource } from "../src/clarificationParser.ts";

test("source parser recognizes only eligible prose with exact source offsets", () => {
    const source = "# Scope\n\n[NEEDS CLARIFICATION: Real?]\n\n`[NEEDS CLARIFICATION: Inline?]`\n\n    [NEEDS CLARIFICATION: Indent?]\n\n~~~md\n[NEEDS CLARIFICATION: Fence?]\n~~~\n\n<!--\n[NEEDS CLARIFICATION: Comment?]\n-->\n";
    const questions = parseClarificationSource(source);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]?.question, "Real?");
    assert.equal(questions[0]?.section, "Scope");
    assert.equal(source.slice(questions[0]!.startIdx, questions[0]!.endIdx), "[NEEDS CLARIFICATION: Real?]");
});

test("source parser preserves stable duplicate question indices across tables and prose", () => {
    const source = "# Questions\n\n[NEEDS CLARIFICATION: Same?]\n\n| Item | Question |\n| --- | --- |\n| One | [NEEDS CLARIFICATION: Same?] |\n";
    const questions = parseClarificationSource(source);
    assert.deepEqual(questions.map((question) => question.index), [0, 1]);
    assert.notEqual(questions[0]?.startIdx, questions[1]?.startIdx);
});
