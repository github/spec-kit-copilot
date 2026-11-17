import { findDuplicateBadge } from "../ui/badge-duplicates.js";
import { badgePlacements, validBadgeCategory, validBadgeSelections, validPlacementTexts }
    from "../ui/badge-selection-contract.js";

const PLACEMENTS = new Set(["workflow-list", "workflow-summary", "phase-card"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => Object.keys(value).sort().join() === [...keys].sort().join();

// Kept independent of the Designer server so the generation boundary can use the same checks.
export function validateBadges(badges, model) {
    if (!Array.isArray(badges) || badges.length > 100) {
        throw new Error("Invalid Designer badges: expected at most 100 instances");
    }
    const types = new Map((model.badgeTypes ?? []).map((type) => [type.id, type]));
    const rules = new Map((model.badgeRules ?? []).map((rule) => [rule.id, rule]));
    const phases = new Set(model.phases ?? []);
    const projectPhase = [...phases].find((phase) =>
        phase.replace(/^speckit\./, "") === "constitution");
    const outputs = model.outputs ?? {};
    const ids = new Set();
    const checked = [];
    for (const [index, badge] of badges.entries()) {
        const fail = (reason) => { throw new Error(`Invalid Designer badge ${index + 1}`
            + `${typeof badge?.id === "string" && /^[a-z0-9-]{1,80}$/.test(badge.id)
                ? ` (${badge.id})` : ""}: ${reason}`); };
        if (!record(badge) || !exactKeys(badge,
            ["id", "type", "inputs", "category", "color", "showIn",
                ...(Object.hasOwn(badge, "text") ? ["text"] : []),
                ...(Object.hasOwn(badge, "phaseText") ? ["phaseText"] : []),
                ...(Object.hasOwn(badge, "summaryText") ? ["summaryText"] : []),
                ...(Object.hasOwn(badge, "phase") ? ["phase"] : []),
                ...(Object.hasOwn(badge, "targets") ? ["targets"] : [])])) {
            fail("unexpected or missing fields");
        }
        if (typeof badge.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(badge.id)
            || ids.has(badge.id)) fail("invalid or duplicate id");
        ids.add(badge.id);
        if (!validBadgeCategory(badge.category)) fail("invalid category");
        const type = types.get(badge.type);
        const rule = rules.get(type?.rule);
        if (!type) fail(`missing badge type ${badge.type}`);
        if (!type.enabled) fail(`disabled badge type ${badge.type}`);
        if (!rule) fail(`missing badge rule ${type.rule} required by type ${badge.type}`);
        if (type.replacementGroup && !rule.placementPhaseInput) {
            fail("replacement group requires a target phase artifact");
        }
        if (model.templates && !model.templates.some((item) =>
            item.kind === "generated.badge-rule-adapter"
                && item.name === rule.adapter)) {
            fail(`missing generated evaluator ${rule.adapter} required by rule ${rule.id}`);
        }
        if (model.badgeInputControls
            && !model.badgeInputControls.some((item) => item.rule === rule.id)) {
            fail(`missing Designer input control for rule ${rule.id}`);
        }
        if (!record(badge.inputs) || !exactKeys(badge.inputs, (rule.inputs ?? []).map(({ id }) => id))) {
            fail("unexpected or missing rule inputs");
        }
        for (const input of rule.inputs ?? []) {
            const value = badge.inputs[input.id];
            if (input.type === "phase") {
                if (!phases.has(value)) fail(`invalid phase input ${input.id}`);
            } else if (input.type === "text") {
                if (typeof value !== "string" || !value.trim() || value.length > 256
                    || /[\x00-\x1f\x7f]/.test(value)) fail(`invalid text input ${input.id}`);
            } else if (input.type === "badge-selection") {
                if (!Array.isArray(badge.showIn)
                    || !validBadgeSelections(value, badgePlacements(badge))) fail(`invalid badge selection input ${input.id}`);
            } else if (input.type === "artifact") {
                if (!record(value) || !exactKeys(value, ["phase", "output"])
                    || !phases.has(value.phase)
                    || !outputs[value.phase]?.outputs?.includes(value.output)) {
                    fail(`invalid artifact input ${input.id}`);
                }
            } else if (input.type === "artifact-set") {
                if (!Array.isArray(value) || !value.length || value.length > 100) {
                    fail(`invalid artifact-set input ${input.id}`);
                }
                const seen = new Set();
                for (const entry of value) {
                    if (!record(entry) || !exactKeys(entry, ["phase", "outputs"])
                        || !phases.has(entry.phase) || !Array.isArray(entry.outputs)
                        || !entry.outputs.length || entry.outputs.length > 100) {
                        fail(`invalid artifact-set input ${input.id}`);
                    }
                    for (const path of entry.outputs) {
                        const key = JSON.stringify([entry.phase, path]);
                        if (!outputs[entry.phase]?.outputs?.includes(path) || seen.has(key)) {
                            fail(`invalid or duplicate artifact in ${input.id}`);
                        }
                        seen.add(key);
                    }
                }
            } else if (input.type === "ordered-artifacts") {
                const target = badge.inputs[input.before];
                if (!Array.isArray(value) || value.length > 100
                    || value.length < (input.minItems ?? 0) || !record(target)
                    || !outputs[target.phase]?.outputs?.includes(target.output)) {
                    fail(`invalid ordered outputs in ${input.id}`);
                }
                const chain = [...value, target];
                if (chain.some((entry) => !record(entry) || !exactKeys(entry, ["phase", "output"])
                    || !phases.has(entry.phase)
                    || !outputs[entry.phase]?.outputs?.includes(entry.output))
                    || chain.some((entry, index) => index > 0
                        && model.phases.indexOf(chain[index - 1].phase)
                            >= model.phases.indexOf(entry.phase))
                    || new Set(chain.map((entry) => entry.output.toLowerCase())).size !== chain.length) {
                    fail("choose one distinct confirmed output per earlier phase in workflow order");
                }
            } else {
                fail(`unsupported rule input type ${input.type}`);
            }
        }
        if (typeof badge.color !== "string"
            || !/^(?:theme|red|green|amber|blue|purple|pink|orange|#[0-9a-fA-F]{6})$/.test(badge.color)) {
            fail("invalid color");
        }
        if (!Array.isArray(badge.showIn) || badge.showIn.length > PLACEMENTS.size
            || new Set(badge.showIn).size !== badge.showIn.length
            || badge.showIn.some((place) => !PLACEMENTS.has(place))) fail("invalid placement");
        if (Object.hasOwn(badge, "targets")) {
            if (badge.phase != null || badge.showIn.includes("phase-card")
                || !Array.isArray(badge.targets) || badge.targets.length > 100) {
                fail("invalid phase/output placements");
            }
            const seen = new Set();
            for (const target of badge.targets) {
                if (!record(target) || !exactKeys(target, ["phase", "output"])
                    || !phases.has(target.phase)
                    || (target.output !== null
                        && (!(rule.inputs ?? []).some((input) =>
                            input.type === "artifact" || input.type === "artifact-set")
                            || !outputs[target.phase]?.outputs?.includes(target.output)))) {
                    fail("invalid phase/output placement");
                }
                const key = JSON.stringify([target.phase, target.output]);
                if (seen.has(key)) fail("duplicate phase/output placement");
                seen.add(key);
            }
        } else if (badge.showIn.includes("phase-card")
            ? !phases.has(badge.phase)
            : badge.phase != null) fail("invalid phase-card destination");
        if (rule.placementPhaseInput
            && (badge.targets?.length
                ? badge.targets.length !== 1 || badge.targets[0].output !== null
                    || badge.targets[0].phase !== badge.inputs[rule.placementPhaseInput]?.phase
                : badge.showIn.includes("phase-card")
                    && badge.phase !== badge.inputs[rule.placementPhaseInput]?.phase)) {
            fail("Phase card must be on the output's target phase");
        }
        if (projectPhase && (badge.targets?.some((target) => target.phase === projectPhase)
            || badge.showIn.includes("phase-card") && badge.phase === projectPhase)
            && rule.inputs.some(({ id, type }) => {
                const value = badge.inputs[id];
                return !["text", "badge-selection"].includes(type) && (type === "phase" ? value !== projectPhase
                    : Array.isArray(value) ? value.some((entry) => entry.phase !== projectPhase)
                        : value.phase !== projectPhase);
            })) {
            fail("project placement requires project-level rule inputs");
        }
        const selection = (rule.inputs ?? []).some(({ type }) => type === "badge-selection");
        const placeholders = (rule.textPlaceholders ?? []).map((token) =>
            typeof token === "string" ? token : token.id);
        for (const key of selection ? [] : ["text", "phaseText"]) {
            if (typeof badge[key] !== "string") continue;
            for (const [, token] of badge[key].matchAll(/\{([^{}]+)\}/g)) {
                if (!placeholders.includes(token)) fail(`unknown text token ${token}`);
            }
        }
        if (selection ? ["text", "phaseText", "summaryText"].some((key) => Object.hasOwn(badge, key))
            : !validPlacementTexts(badge, badgePlacements(badge), placeholders)) {
            fail("text must be present exactly for each selected placement, with known tokens"
                + " and no Workflow summary tokens");
        }
        const duplicate = findDuplicateBadge(badge, checked, rule);
        if (duplicate) fail(`duplicate phase/output target already covered by badge ${duplicate.id}`);
        checked.push(structuredClone(badge));
    }
    return checked;
}
