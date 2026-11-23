import { ArtifactReadError, REVISION_PATTERN } from "./artifact-read.mjs";

// The server derives the workflow and phase from the review context, not the request.
export const REVIEW_SUBMIT_PATH = "/api/review/submit";
export function validateGeneratedReviewSubmission(input) {
    const text = (value, limit) => typeof value === "string" && value.trim() && value.length <= limit;
    if (!input || Object.keys(input).sort().join() !== "answers,artifactId,commandName,contextId,expectedRevision"
        || !text(input.contextId, 256) || !text(input.artifactId, 256)
        || typeof input.expectedRevision !== "string" || !REVISION_PATTERN.test(input.expectedRevision)
        || typeof input.commandName !== "string" || !/^speckit\.[a-z0-9.-]{1,240}$/.test(input.commandName)
        || !Array.isArray(input.answers) || !input.answers.length || input.answers.length > 100
        || input.answers.some((answer) => !answer || Object.keys(answer).sort().join() !== "answer,question,questionId"
            || !text(answer.questionId, 256) || !text(answer.question, 4000) || !text(answer.answer, 4000))) {
        throw new ArtifactReadError("invalid_request");
    }
}
