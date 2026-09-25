export function phaseResult(results, commandName) {
    const category = results?.results;
    if (!category) throw new Error("Missing canvas-results experience category");
    const configured = Object.hasOwn(category.phases, commandName)
        ? category.phases[commandName] : category.defaultResult;
    return configured?.disabled ? null : configured ?? null;
}

export function reportInstructions(instanceId, phaseRunId, result) {
    if (result?.source.kind !== "phase-report") return "";
    const allowed = result.values.map((value) => value.id);
    return `\n\nFor this phase only, report its result in this original turn before completing it. `
        + `Use invoke_canvas_action with instanceId ${JSON.stringify(instanceId)}, `
        + `actionName "report_phase_result", and input `
        + `{"phaseRunId":${JSON.stringify(phaseRunId)},"resultId":"<one allowed ID>"}. `
        + `Allowed result IDs: ${allowed.map((id) => JSON.stringify(id)).join(", ")}. `
        + "Report exactly once, only while this phase turn is active, using a result supported by its actual outcome; do not launch another classification turn.";
}

export function artifactReportInstructions(instanceId, phaseRunId) {
    return `\n\nIf this phase produces a Markdown artifact, report its existing workspace-relative path in this original turn before completing. `
        + `Use invoke_canvas_action with instanceId ${JSON.stringify(instanceId)}, `
        + `actionName "report_phase_artifact", and input `
        + `{"phaseRunId":${JSON.stringify(phaseRunId)},"path":"<workspace-relative .md path>"}. `
        + "Report at most once, only after the file exists in this workflow item's directory. Do not invent an artifact.";
}
