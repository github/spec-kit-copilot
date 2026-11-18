import { inferenceTaskApi, inferenceTaskId } from "../contracts/background-inference.mjs";

function tasksFor(inst) {
    return inst.backgroundInferences ?? (inst.backgroundInferences = new Map());
}

export function releaseBackgroundInference(inst, key) {
    tasksFor(inst).delete(key);
}

export function cancelBackgroundInference(inst, key) {
    const tasks = tasksFor(inst);
    if (key !== undefined) {
        const task = tasks.get(key);
        tasks.delete(key);
        task?.cancel();
        return;
    }
    for (const task of tasks.values()) task.cancel();
    tasks.clear();
}

export async function startBackgroundInference(inst, { prompt }, session, isCurrent, key) {
    if (!isCurrent()) throw new Error("Background inference superseded by newer refresh work");
    const tasks = inferenceTaskApi(session);
    let id, cancelled = false;
    const cancel = () => {
        cancelled = true;
        if (id) {
            void Promise.resolve().then(() => tasks.cancel({ id })).catch((error) => {
                console.error(`Background inference cancellation failed: ${error.message}`);
            });
        }
    };
    const task = { cancel };
    const taskKey = key ?? Symbol("background inference");
    tasksFor(inst).set(taskKey, task);
    try {
        const result = await tasks.startAgent({
            agentType: "general-purpose",
            name: "Wizard inference",
            description: "Infer metadata for the active Wizard pipeline",
            prompt: [
                `Work only in this Wizard checkout: ${JSON.stringify(inst.workspacePath)}.`,
                "This is a background metadata task, not a phase run. Do not install packages, edit project files, or delegate further work.",
                "After the Wizard callback accepts your result, stop and return only `Done.` as your final response. Do not repeat results or provide progress in the conversation.",
                prompt,
            ].join("\n\n"),
        });
        id = inferenceTaskId(result);
        if (cancelled || !isCurrent()) {
            cancel();
            throw new Error("Background inference superseded by newer refresh work");
        }
        task.agentId = id;
        return result;
    } catch (error) {
        if (tasksFor(inst).get(taskKey) === task) tasksFor(inst).delete(taskKey);
        throw error;
    }
}
