// Inspect one coherent pipeline example; only capture the final artifact for generation.
import { createHash } from "node:crypto";
import { commandViews } from "./generated-canvas-template/ui/command-views.mjs";
import { readWorkflowArtifact, resolveDeclaredArtifact } from "./generated-canvas-template/workspace-files.mjs";

export async function inspectGenerationExample(workspace, snapshot, blueprint, { capture = false } = {}) {
    const workflow = commandViews(blueprint).workflow;
    const final = workflow.at(-1);
    const phases = workflow.filter((step) => step.artifact?.persistent && step.artifact.pathTemplate);
    const standard = (reason, missing = []) => ({ available: false, reason, missing });
    if (!final?.artifact?.persistent || !final.artifact.pathTemplate) {
        return standard("The final phase has no persistent artifact. Standard indicators will be used.");
    }
    try {
        const slugs = new Set();
        for (const step of phases) {
            const template = step.artifact.pathTemplate.replaceAll("\\", "/").split("/");
            const index = template.indexOf("<slug>");
            if (index < 0) continue;
            const observed = snapshot.phases?.[step.id]?.artifactPath
                ?? snapshot.phases?.[`commands/${step.commandName}`]?.artifactPath
                ?? snapshot.phases?.[step.commandName.replace(/^speckit\./, "")]?.artifactPath;
            if (!observed || observed.includes("<")) continue;
            const parts = observed.replaceAll("\\", "/").split("/");
            if (parts.length !== template.length || template.some((part, i) =>
                i !== index && part !== "<name>.md" && part !== parts[i])) {
                return standard("The current artifacts do not match this pipeline. Standard indicators will be used.");
            }
            slugs.add(parts[index]);
        }
        if (slugs.size > 1) return standard("The current artifacts belong to different workflows. Standard indicators will be used.");
        const slug = slugs.values().next().value ?? snapshot.slug ?? null;
        if (blueprint.runtime?.itemRoot && !slug) {
            return standard("Run this pipeline once to create example artifacts. Standard indicators are available now.");
        }
        const missing = [];
        let sample = null;
        for (const step of phases) {
            try {
                const path = await resolveDeclaredArtifact(workspace, step.artifact.pathTemplate, slug, blueprint);
                const content = path ? await readWorkflowArtifact(workspace, path, blueprint) : "";
                if (!content.trim()) missing.push(step.label);
                else if (step === final) sample = { phase: step.instanceKey, artifact: path, content };
            } catch {
                missing.push(step.label);
            }
        }
        if (missing.length) return standard("Some example artifacts are missing, empty, or unreadable. Standard indicators will be used.", missing);
        const summary = { available: true, source: slug ?? "Project", finalArtifact: sample.artifact };
        return capture ? { ...summary, sample: { ...sample,
            fingerprint: createHash("sha256").update(JSON.stringify([blueprint.pipeline, sample.artifact, sample.content])).digest("hex") } } : summary;
    } catch {
        return standard("Example artifacts could not be checked. Standard indicators will be used.");
    }
}
