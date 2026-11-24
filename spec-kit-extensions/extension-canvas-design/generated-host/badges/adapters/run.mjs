export const contractVersion = 1;

export async function evaluate({ ruleId, inputs, evidence }) {
    if (ruleId !== "phase-run-complete") {
        throw new Error(`Unsupported run badge rule: ${ruleId}`);
    }
    const match = (await evidence.getRun(inputs.phase))?.status === "completed";
    return { match, summaryCount: Number(match) };
}
