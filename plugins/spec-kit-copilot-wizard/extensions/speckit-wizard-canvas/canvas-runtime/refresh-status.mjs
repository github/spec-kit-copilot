import { randomUUID } from "node:crypto";

export function isCurrentRefresh(inst, refresh) {
    return inst.refreshStatus === refresh;
}

export function startRefresh(inst) {
    if (inst.refreshStatus?.timer) clearTimeout(inst.refreshStatus.timer);
    const refresh = { id: randomUUID(), status: "refreshing", pipelinePending: true,
        outputsPending: false };
    refresh.timer = setTimeout(() => {
        failRefresh(inst, refresh);
    }, 10 * 60 * 1000);
    refresh.timer.unref?.();
    inst.refreshStatus = refresh;
    inst.broadcast({ type: "invalidate", reason: "composition refresh started" });
    return refresh;
}

export function setRefreshWork(inst, { pipeline, outputs }, refresh) {
    if (!isCurrentRefresh(inst, refresh) || refresh?.status !== "refreshing") return;
    refresh.pipelinePending = !!pipeline;
    refresh.outputsPending = !!outputs;
    finishRefreshPart(inst, undefined, refresh);
}

export function finishRefreshPart(inst, part, refresh) {
    if (!isCurrentRefresh(inst, refresh) || refresh?.status !== "refreshing") return;
    if (part === "pipeline") refresh.pipelinePending = false;
    if (part === "outputs") refresh.outputsPending = false;
    if (!refresh.pipelinePending && !refresh.outputsPending) {
        clearTimeout(refresh.timer);
        refresh.status = "up-to-date";
    }
    inst.broadcast({ type: "invalidate", reason: "composition refresh status changed" });
}

export function failRefresh(inst, refresh) {
    if (!isCurrentRefresh(inst, refresh) || refresh?.status !== "refreshing") return;
    clearTimeout(refresh.timer);
    refresh.status = "incomplete";
    inst.broadcast({ type: "invalidate", reason: "composition refresh failed" });
}
