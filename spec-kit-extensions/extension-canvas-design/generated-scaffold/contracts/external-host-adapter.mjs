export const phaseControlInterface = Object.freeze({
    controlId: "workflow-phases",
    contractVersion: 1,
    capabilities: Object.freeze(["workflow.rows.v1", "workflow.managed-run.v1"]),
});

export function validWorkflowItemName(value) {
    return value === undefined || typeof value === "string" && value.length > 0
        && value.length <= 80 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}

export function workflowItemName(value) {
    if (!validWorkflowItemName(value)) throw new Error("Invalid workflow item name");
    return value ?? "Workflow";
}

export function validateWorkflowPageDefinition(definition) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)
        || (definition.canvas !== undefined && (!definition.canvas
            || typeof definition.canvas !== "object" || Array.isArray(definition.canvas)
            || !validWorkflowItemName(definition.canvas.workflowItemName)))) {
        throw new Error("Incompatible Workflow page definition: invalid item name");
    }
    return definition;
}

export function validatePhaseState(state) {
    // false leaves a pending <slug> path unresolved; true allows a user-entered preview.
    if (!state || typeof state.slugEditable !== "boolean") {
        throw new Error("Incompatible phase control state: slugEditable must be a boolean");
    }
    return state;
}

export function validateWorkflowPageState(state) {
    if (!state || typeof state !== "object") throw new Error("Incompatible Workflow page state");
    validatePhaseState(state.phaseState);
    // false hides the slug field; true shows it, but a blank value remains valid.
    if (state.model !== null && (!state.model
        || typeof state.model.userProvidesSlug !== "boolean")) {
        throw new Error("Incompatible Workflow page state: userProvidesSlug must be a boolean");
    }
    if (state.model && state.model.userProvidesSlug !== state.phaseState.slugEditable) {
        throw new Error("Incompatible Workflow page state: slug settings disagree");
    }
    if (state.model?.items !== undefined) {
        if (!Array.isArray(state.model.items)) {
            throw new Error("Incompatible Workflow page state: items must be an array");
        }
        for (const item of state.model.items) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error("Incompatible Workflow page state: invalid workflow row");
            }
            if (!item.pending) continue;
            if (typeof item.hasWorkflowRunHistory !== "boolean"
                || item.workflowRecoveryMessage !== null
                    && typeof item.workflowRecoveryMessage !== "string"
                || !["Not started", "Request sent", "Running", "Unconfirmed",
                    "Run output unconfirmed", "Completed", "Failed"].includes(item.status)) {
                throw new Error("Incompatible Workflow page state: invalid pending workflow recovery");
            }
        }
    }
    const projectBadges = state.model?.badges?.project;
    if (projectBadges !== undefined && (!Array.isArray(projectBadges)
        || projectBadges.some((badge) => !badge || typeof badge !== "object"
            || Array.isArray(badge) || typeof badge.id !== "string" || !badge.id
            || typeof badge.text !== "string" || typeof badge.color !== "string"
            || (badge.phaseText !== undefined && typeof badge.phaseText !== "string")
            || (badge.category !== undefined && typeof badge.category !== "string")
            || !Array.isArray(badge.showIn) || badge.showIn.some((place) =>
                !["workflow-list", "workflow-summary", "phase-card"].includes(place))
            || (badge.targets === undefined
                ? !badge.showIn.includes("phase-card") || typeof badge.phase !== "string"
                    || !badge.phase
                : !Array.isArray(badge.targets) || !badge.targets.length
                    || badge.targets.some((target) => !target || typeof target !== "object"
                        || Array.isArray(target) || typeof target.phase !== "string"
                        || !target.phase || target.output !== null
                            && (typeof target.output !== "string" || !target.output)))))) {
        throw new Error("Incompatible Workflow page state: invalid project badge results");
    }
    return state;
}

export function validatePhaseAdapter(adapter) {
    if (adapter.controlId !== phaseControlInterface.controlId
        || adapter.contractVersion !== phaseControlInterface.contractVersion
        || typeof adapter.mount !== "function") {
        throw new Error("Incompatible phase control adapter");
    }
    const required = adapter.requiredCapabilities ?? [];
    if (!Array.isArray(required)
        || required.some((name) => !phaseControlInterface.capabilities.includes(name))
        || new Set(required).size !== required.length) {
        throw new Error("Phase control adapter requires unavailable host capabilities");
    }
    return adapter.mount;
}

export function validatePhaseMount(instance) {
    if (!instance || typeof instance.update !== "function" || typeof instance.dispose !== "function") {
        throw new Error("Phase control adapter must return update and dispose");
    }
    return instance;
}

export function requiresManagedRun(adapter) {
    return Array.isArray(adapter.requiredCapabilities)
        && adapter.requiredCapabilities.includes("workflow.managed-run.v1");
}

export function validateWorkflowAdapter(pageModule) {
    if (pageModule.pageId !== "workflow" || pageModule.contractVersion !== 1
        || typeof pageModule.mount !== "function") {
        throw new Error("Incompatible Workflow page adapter");
    }
}

export function validateWorkflowMount(workflowPage) {
    if (typeof workflowPage?.update !== "function" || typeof workflowPage.dispose !== "function") {
        throw new Error("Workflow page adapter must return update and dispose");
    }
}
