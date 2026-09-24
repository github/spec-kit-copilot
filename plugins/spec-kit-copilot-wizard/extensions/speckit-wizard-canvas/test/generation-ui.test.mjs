import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { defaultGenerationMetadata } from "../ui/generation.js";

const canonical = {
    pipeline: [
        "constitution", "specify", "clarify", "plan",
        "tasks", "analyze", "checklist", "implement",
    ].map((id) => ({ id })),
    commands: [],
};

test("canonical SDD defaults match the compact Generate form", () => {
    const metadata = defaultGenerationMetadata(canonical);
    assert.equal(metadata.extensionId, "spec-kit-workflow");
    assert.equal(metadata.displayName, "Spec-Driven Development");
    assert.equal(metadata.workflowListName, "Features");
    assert.equal(metadata.userProvidedSlug, false);
    assert.equal(metadata.requireInstallationApproval, true);
    assert.match(metadata.description, /Constitution.*Specify.*Implement/);
});

test("compact Generate form keeps exact common fields before Canvas Design", async () => {
    const source = await readFile(new URL("../ui/generation.js", import.meta.url), "utf8");
    const ordered = [
        'id="generation-target"',
        'id="generation-extension-id"',
        'id="generation-display-name"',
        'id="generation-workflow-list-name"',
        'id="generation-description"',
        'id="generation-user-provided-slug"',
        'id="generation-require-installation-approval"',
        'class="generation-design"',
    ];
    let previous = -1;
    for (const marker of ordered) {
        const index = source.indexOf(marker);
        assert.ok(index > previous, `${marker} must appear in approved order`);
        previous = index;
    }
    for (const help of [
        "Folder where the canvas app is created. Set by Extension ID.",
        "Technical ID and folder name, not a display label. Use lowercase letters, numbers, and hyphens.",
        "Text displayed as the canvas title.",
        "Text displayed as the workflow collection heading, such as Assessments or Bugs.",
        "Text displayed beneath the workflow collection heading, before the folder link.",
        "Lets users specify the slug used as the directory name for generated artifacts. Otherwise, Spec Kit chooses a default or Copilot may ask the user in the chat session.",
        "Ask users to approve all included presets and extensions before installation. Otherwise, the app automatically installs missing components without asking for installation approval.",
    ]) {
        assert.match(source, new RegExp(help.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(source, /Phase result tags|general help|theme control|layout control/i);
    assert.match(source, /workflowListName: metadata\.workflowListName/);
    assert.match(source, /workflowSlug: \{ userProvided: metadata\.userProvidedSlug \}/);
    assert.match(source, /installationMode: metadata\.requireInstallationApproval \? "prompt" : "automatic"/);
});
