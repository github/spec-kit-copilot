export function phaseResult(results, commandName) {
    const category = results?.categories?.["canvas-results"];
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
        + "Report only a result supported by this phase's actual outcome; do not launch another classification turn.";
}
