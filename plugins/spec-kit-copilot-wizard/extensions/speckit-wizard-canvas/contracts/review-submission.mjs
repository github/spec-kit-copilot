// The review service validates the context, artifact, revision, answers and
// owning command together against the current source before dispatch.
export async function validateReviewSubmission(service, review, commandName) {
    if (typeof service?.validateClarifications !== "function") {
        const error = new Error("Review context is not available.");
        error.code = "review_unavailable";
        throw error;
    }
    return service.validateClarifications(
        review.contextId, review.artifactId, review.expectedRevision, review.answers, commandName,
    );
}
