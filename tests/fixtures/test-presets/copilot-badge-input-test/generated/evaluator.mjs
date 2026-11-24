export const contractVersion = 1;

export async function evaluate({ inputs, evidence }) {
    const run = await evidence.getRun(inputs.phase);
    return { match: run?.status === "completed" };
}
