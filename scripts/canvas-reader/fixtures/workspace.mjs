import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const FIXTURE_SLUG = "999-canvas-preview-fixture";
export const OWNER_FILE = ".canvas-reader-fixture.json";
const OWNER_KIND = "spec-kit-canvas-reader-owned-fixture";
const SKILLS = ["constitution", "specify", "clarify", "plan", "tasks", "analyze", "checklist", "implement"];

function hash(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

export function isInside(root, target) {
    const path = relative(root, target);
    return path !== ".." && !isAbsolute(path) && !path.startsWith(`..${sep}`);
}

export function workspaceSnapshot(workspace) {
    const entries = [];
    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            const relativePath = relative(workspace, path).split(sep).join("/");
            if (entry.isSymbolicLink()) entries.push(`${relativePath}:link`);
            else if (entry.isDirectory()) { entries.push(`${relativePath}/`); visit(path); }
            else if (entry.isFile()) entries.push(`${relativePath}:${hash(readFileSync(path))}`);
            else entries.push(`${relativePath}:special`);
        }
    }
    if (lstatSync(workspace).isSymbolicLink()) throw new Error("Fixture root redirects through a link.");
    visit(workspace);
    return hash(entries.sort().join("\n"));
}

export async function assertOwnedWorkspace(input) {
    if (typeof input !== "string" || !isAbsolute(input)) throw new Error("An absolute owned fixture workspace is required.");
    const workspace = resolve(input);
    const stat = await lstat(workspace);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Fixture must be an ordinary owned directory.");
    let owner;
    try {
        const marker = join(workspace, OWNER_FILE);
        const markerStat = await lstat(marker);
        if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error("Invalid fixture marker.");
        owner = JSON.parse(await readFile(marker, "utf8"));
    } catch { throw new Error("Workspace is not an owned reader fixture."); }
    if (owner.kind !== OWNER_KIND || owner.schemaVersion !== 1 || !owner.id || !Array.isArray(owner.files)) throw new Error("Invalid owned fixture record.");
    for (const file of owner.files) {
        if (typeof file.path !== "string" || !isInside(workspace, resolve(workspace, file.path))) throw new Error("Invalid fixture file path.");
        let current = workspace;
        for (const segment of file.path.split("/")) {
            current = join(current, segment);
            if ((await lstat(current)).isSymbolicLink()) throw new Error("Fixture path redirects through a link.");
        }
        if (hash(await readFile(current)) !== file.sha256) throw new Error("Owned fixture contents changed; staging requires review.");
    }
    return { workspace: await realpath(workspace), owner };
}

export async function createOwnedWorkspace({ markdown, allowMutations = false } = {}) {
    if (markdown !== undefined && (typeof markdown !== "string" || Buffer.byteLength(markdown) > 5_242_880)) {
        throw new Error("Synthetic Markdown must stay within the reader byte limit.");
    }
    const workspace = await realpath(await mkdtemp(join(tmpdir(), "speckit-reader-fixture-")));
    const files = new Map([
        [`.specify/memory/constitution.md`, "# Fixture constitution\n\nOnly synthetic reader checks are allowed.\n"],
        [`.specify/feature.json`, JSON.stringify({ feature_directory: `specs/${FIXTURE_SLUG}` })],
        [`.speckit-wizard/state.json`, JSON.stringify({ $schema: "speckit-wizard/v1", currentPhase: "specify", preset: "core", setup: { pluginInstalled: true, cliInstalled: true, projectInitialized: true, skillsReloaded: true, catalogsLoaded: true }, phases: {} })],
        [`specs/${FIXTURE_SLUG}/spec.md`, markdown ?? "# Canvas review fixture\n\n## Purpose\n\nReview an owned workflow document.\n\n## Details\n\n[Research](research.md)\n\n- [ ] A synthetic task\n\n```text\nThis is a non-executing example.\n```\n\n![Image placeholder](https://example.invalid/fixture.png)\n"],
        [`specs/${FIXTURE_SLUG}/plan.md`, "# Fixture plan\n\n## Decisions\n\nPreserve the selected feature.\n"],
        [`specs/${FIXTURE_SLUG}/tasks.md`, "# Fixture tasks\n\n- [ ] T001 Review the fixture.\n"],
        [`specs/${FIXTURE_SLUG}/research.md`, "# Fixture research\n\n## Findings\n\nUse the existing canvas.\n"],
        [`specs/${FIXTURE_SLUG}/checklists/requirements.md`, "# Fixture checklist\n\n- [ ] Return to the originating stage.\n"],
    ]);
    for (const skill of SKILLS) files.set(`.github/skills/speckit-${skill}/SKILL.md`, `---\nname: speckit-${skill}\ndescription: Owned test fixture only; never execute.\n---\n\n# Fixture\n\nNo workflow execution is authorized by this synthetic skill.\n`);
    const owner = { schemaVersion: 1, kind: OWNER_KIND, id: randomUUID(), files: [] };
    for (const [path, content] of files) {
        const segments = path.split("/");
        await mkdir(join(workspace, ...segments.slice(0, -1)), { recursive: true });
        await writeFile(join(workspace, path), content, { flag: "wx" });
        owner.files.push({ path, sha256: hash(content) });
    }
    await writeFile(join(workspace, OWNER_FILE), JSON.stringify(owner, null, 2), { flag: "wx" });
    const baseline = workspaceSnapshot(workspace);
    const mutations = new Map();
    const currentBytes = async (path) => {
        try {
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink()) throw new Error("Fixture mutation target is not an ordinary file.");
            return await readFile(path);
        } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    };
    let cleaned = false;
    return {
        workspace,
        id: owner.id,
        changed: () => !cleaned && workspaceSnapshot(workspace) !== baseline,
        async mutateArtifact(name, content) {
            if (!allowMutations || cleaned || !/^[a-z0-9][a-z0-9._-]*\.(?:md|markdown)$/i.test(name) ||
                (content !== null && (typeof content !== "string" || Buffer.byteLength(content) > 5_242_880))) {
                throw new Error("Only explicitly enabled bounded synthetic artifact mutations are allowed.");
            }
            const target = join(workspace, "specs", FIXTURE_SLUG, name);
            const current = await currentBytes(target);
            const previous = mutations.get(target);
            if (previous && (current === null ? null : hash(current)) !== previous.lastHash) throw new Error("Fixture changed outside the test; preserve it.");
            const record = previous ?? { original: current, lastHash: null };
            if (content === null) { if (current !== null) await unlink(target); }
            else await writeFile(target, content);
            record.lastHash = content === null ? null : hash(content);
            mutations.set(target, record);
        },
        async cleanup() {
            if (cleaned) return { cleaned: true };
            for (const [target, record] of mutations) {
                const current = await currentBytes(target);
                if ((current === null ? null : hash(current)) !== record.lastHash) return { cleaned: false };
            }
            for (const [target, record] of mutations) {
                if (record.original !== null) await writeFile(target, record.original);
                else if (record.lastHash !== null) await unlink(target);
            }
            mutations.clear();
            if (workspaceSnapshot(workspace) !== baseline) return { cleaned: false };
            await rm(workspace, { recursive: true });
            cleaned = true;
            return { cleaned: true };
        },
    };
}
