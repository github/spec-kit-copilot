import { effectiveSource } from "../artifact-evidence.mjs";
import { buildPrompt } from "../prompts.mjs";

const MAX_SKILL_BYTES = 512 * 1024;

export async function buildArtifactInferencePrompt({ workspacePath, commands, endpoint }) {
    const skills = await Promise.all(commands.map(async (request) => {
        const source = await effectiveSource(workspacePath, request.commandId);
        if (!source || source.skillPath !== request.skillPath
            || source.fingerprint !== request.fingerprint) {
            throw new Error(`Installed skill changed or is unavailable for ${request.commandId}`);
        }
        return { commandId: request.commandId, skillPath: source.skillPath, text: source.skillText };
    }));
    const size = skills.reduce((total, skill) => total + Buffer.byteLength(skill.text), 0);
    if (size > MAX_SKILL_BYTES) {
        throw new Error(`Installed command skills exceed the ${MAX_SKILL_BYTES}-byte inference input limit`);
    }
    return buildPrompt("extension.inferArtifactTargets", {
        commands, endpoint, skillSources: skills,
    }, { workspacePath });
}
