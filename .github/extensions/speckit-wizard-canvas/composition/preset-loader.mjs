// speckit-wizard — preset loader (disk → phase graph).
//
// Production code path — called from `scanner.mjs::scanWorkspace()` on
// every workspace scan (which fires on canvas open + on refresh + after
// any preset install/remove). It walks `.specify/presets/` on disk and
// hands `graph.mjs` and `renderer.mjs` the resolved phase graph.
//
// It takes an injected `deps` filesystem facade (same shape used by
// `scanner.mjs`) rather than importing `node:fs` directly. That's a
// dependency-injection pattern used across the wizard — production
// callers pass the real fs (see `scanner.mjs` → `deps` object built at
// call site), tests pass an in-memory stub. Being "trivially testable"
// is a side benefit; the reason `deps` exists is so this module has one
// consistent fs interface with the scanner and doesn't fight it.
//
// Reads (in order):
//   1. .specify/presets/.registry              (JSON) — installed presets (enumeration)
//   2. .specify/presets/<id>/preset.yml        (YAML) — preset metadata + provides.{templates,commands,scripts}
//   3. .specify/presets/<id>/commands/<file>.md (YAML frontmatter + markdown body)
//      — per-command description, handoffs, user-input hints
//
// Precedence order comes from the CLI, not the registry — see
// preset-order.mjs. `deps.presetOrder` (populated by extension.mjs from
// the last accepted `speckit-preset` skill refresh) hands us the ID list
// in the CLI's declared order. The loader itself performs zero tie-break
// math and never shells the CLI directly.
//
// Two `preset.yml` layouts are accepted (both are valid to the `specify` CLI):
//   A) Mixed bucket: everything under `provides.templates:` with each entry
//      tagged `type: "command" | "template" | "script"`.
//   B) Split lists:  `provides.templates:`, `provides.commands:`, `provides.scripts:`
//      each as its own list.
// `collectProvidesEntries` normalizes both into a flat, deduped list per kind so
// the rest of the loader (and any future consumer) doesn't have to know or care.
//
// Falls back to an empty `coreOnly()` graph on any read/parse failure —
// downstream code (snapshot-builder, phase-card, phase-runtime) already
// synthesizes canonical phases from `pipeline/canonical.mjs`, so returning
// an empty command list here is equivalent to the old CORE_WORKFLOW
// fallback without the drift risk of a hand-maintained duplicate.
// The returned shape is what graph.mjs and renderer.mjs consume.

import { join } from "node:path";

import { orderPresetsByCliList } from "./preset-order.mjs";

// ---------------------------------------------------------------------------
// Why the wizard depends on `js-yaml` at all
// ---------------------------------------------------------------------------
// The wizard needs the full contents of every catalog entry to build a
// composition preview — preset.yml + extension.yml manifests carry the
// artifact layers, hooks, dependencies, and slot definitions the UI stacks
// into tiles. Today the `specify` CLI (`specify preset list` / `specify
// extension list` / `specify bundle list`) only returns a shallow summary
// (id, name, version, description) and does NOT surface those manifest
// fields. Until the CLI grows a "gimme the raw parsed manifest" verb, the
// wizard fetches the raw .yml files itself (from the plugin-owned catalog
// download_urls) and parses them locally — which requires a YAML parser,
// hence `js-yaml`.
//
// This is a workaround, not the desired end state. Ideally the CLI would
// return the composition-relevant fields directly, and this dependency
// (plus env/deps-check.mjs auto-installer) could be removed entirely.
//
// ---------------------------------------------------------------------------
// Why the import is deferred (not top-of-file)
// ---------------------------------------------------------------------------
// js-yaml is only needed at scan time. The wizard is designed to auto-run
// `npm install` on first open of a fresh worktree (see env/deps-check.mjs
// and the checkDeps/installDeps calls in extension.mjs). Importing it
// statically at module load would crash the entire extension process on a
// fresh clone BEFORE the auto-install could run. So we defer the import to
// the first call site and, if the module is genuinely missing, throw a
// distinguishable error the caller can recognise.
export class YamlUnavailableError extends Error {
    constructor(cause) {
        super("js-yaml is not installed in the extension folder");
        this.name = "YamlUnavailableError";
        this.code = "YAML_UNAVAILABLE";
        this.cause = cause;
    }
}

let _yamlPromise = null;
async function getYaml() {
    if (!_yamlPromise) {
        _yamlPromise = import("js-yaml").then(
            (m) => {
                const mod = m.default ?? m;
                // Wrap load() with a safe schema that rejects custom tags
                // (`!!js/function`, `!!js/regexp`, ...) which enable RCE via
                // untrusted preset.yml / extension.yml content.
                const schema = mod.JSON_SCHEMA ?? mod.FAILSAFE_SCHEMA;
                return {
                    ...mod,
                    load: (raw, opts = {}) => mod.load(raw, { schema, ...opts }),
                };
            },
            (err) => {
                _yamlPromise = null; // allow retry after user installs deps
                if (err?.code === "ERR_MODULE_NOT_FOUND") {
                    throw new YamlUnavailableError(err);
                }
                throw err;
            },
        );
    }
    return _yamlPromise;
}

const MAX_YAML_BYTES = 512 * 1024;
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

/**
 * Load the full phase graph for `workspacePath`.
 *
 * @param {string} workspacePath
 * @param {object} deps  { readFile, pathExists, readdir, stat }
 * @returns {Promise<{
 *   presets: Array<object>,
 *   activePreset: object,
 *   commands: Array<object>,
 *   registryMtimeMs: number|null,
 *   warnings: string[],
 * }>}
 */
export async function loadPresetGraph(workspacePath, deps) {
    const warnings = [];
    if (!workspacePath || typeof workspacePath !== "string") {
        return coreOnly(["loadPresetGraph: missing workspacePath"]);
    }

    const presetsDir = join(workspacePath, ".specify", "presets");
    if (!(await safe(deps.pathExists(presetsDir), false))) {
        return coreOnly([]);
    }

    // 1. Read .registry (if present) to enumerate installed presets.
    //    Registry format is flexible; we defensively accept a few common
    //    shapes. Registry ORDER is not authoritative for precedence — that
    //    comes from the CLI (see step 3 below).
    const registryPath = join(presetsDir, ".registry");
    let registryMtimeMs = null;
    let installed = [];
    if (await safe(deps.pathExists(registryPath), false)) {
        try {
            const st = await deps.stat(registryPath);
            registryMtimeMs = st?.mtimeMs ?? null;
            const raw = await deps.readFile(registryPath, "utf8");
            installed = normalizeRegistry(raw, warnings);
        } catch (err) {
            warnings.push(`registry read failed: ${err?.message ?? err}`);
        }
    }

    // If registry is missing/unparseable, fall back to enumerating the
    // presets directory. Each subdirectory containing a preset.yml is
    // treated as an installed preset with default priority.
    if (!installed.length) {
        try {
            const entries = await deps.readdir(presetsDir, { withFileTypes: true });
            for (const e of entries) {
                if (!e?.isDirectory?.()) continue;
                if (e.name.startsWith(".")) continue;
                installed.push({ id: e.name, priority: 0, enabled: true });
            }
        } catch (err) {
            warnings.push(`presets dir scan failed: ${err?.message ?? err}`);
        }
    }

    if (!installed.length) return coreOnly(warnings, registryMtimeMs);

    // 2. Read each preset.yml and its command files.
    const presets = [];
    for (const inst of installed) {
        try {
            const preset = await loadOnePreset(presetsDir, inst, deps, warnings);
            if (preset) presets.push(preset);
        } catch (err) {
            warnings.push(`preset ${inst.id} load failed: ${err?.message ?? err}`);
        }
    }

    if (!presets.length) return coreOnly(warnings, registryMtimeMs);

    // 3. Order enabled presets by skill-published precedence.
    //
    //    Precedence is owned by the `specify` CLI and surfaced to the
    //    wizard via the `speckit-preset` skill (which populates
    //    `composition.presets` in state.json). extension.mjs hands the
    //    ordered id list to us in `deps.presetOrder` — the loader itself
    //    performs zero tie-break math and never shells the CLI. See
    //    preset-order.mjs for the full rationale.
    //
    //    When `presetOrder` is empty (skill hasn't run yet, e.g. first
    //    launch), we fall through to registry order — still deterministic,
    //    just not CLI-authoritative until the next composition refresh.
    const enabled = presets.filter((p) => p.enabled !== false);
    const orderedIds = Array.isArray(deps.presetOrder) ? deps.presetOrder : null;
    const ordered = orderPresetsByCliList(enabled, orderedIds);
    const active = ordered[0] ?? presets[0];

    // Merge command lists: walk presets in CLI order and take the first
    // occurrence of each command name — same rule the CLI's own resolver
    // applies internally.
    const seen = new Map();
    for (const p of ordered) {
        for (const cmd of p.commands ?? []) {
            if (!cmd?.name || seen.has(cmd.name)) continue;
            seen.set(cmd.name, cmd);
        }
    }
    const mergedCommands = [...seen.values()];

    return {
        presets,
        activePreset: active,
        commands: mergedCommands,
        registryMtimeMs,
        warnings,
    };
}

// Fallback graph when no preset registry is loadable. Returns an empty
// preset list and empty command list. The wizard's phase-card and
// phase-runtime already synthesize every canonical phase from
// `pipeline/canonical.mjs` (canonicalSpine + CANONICAL_UNSEEDED) when the
// snapshot's `commands` array is empty, so nothing goes missing in the
// UI on a bare workspace. The old shim used to wrap `CORE_WORKFLOW` in
// preset-shaped metadata here; that wrapper was filtered out downstream
// (source === "builtin") and its per-phase fields (description, optional,
// artifact) were pure duplicates of CANONICAL / CORE_CAPABILITIES.
function coreOnly(warnings, registryMtimeMs = null) {
    return {
        presets: [],
        activePreset: null,
        commands: [],
        registryMtimeMs,
        warnings,
    };
}

async function safe(promise, fallback) {
    try {
        return await promise;
    } catch {
        return fallback;
    }
}

/**
 * Accept several registry shapes:
 *   • { presets: [{ id, priority, enabled }, ...] }
 *   • [{ id, priority, enabled }, ...]
 *   • { "preset-id": { priority, enabled } }
 */
function normalizeRegistry(raw, warnings) {
    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        warnings.push(`registry JSON parse failed: ${err?.message ?? err}`);
        return [];
    }
    const out = [];
    if (Array.isArray(data)) {
        for (const entry of data) {
            if (!entry || typeof entry !== "object") continue;
            if (typeof entry.id !== "string") continue;
            out.push({
                id: entry.id,
                priority: Number.isFinite(entry.priority) ? entry.priority : 0,
                enabled: entry.enabled !== false,
            });
        }
        return out;
    }
    if (data && typeof data === "object") {
        // Real CLI shape (as of speckit >=0.11):
        //   { "schema_version": "1.0", "presets": { "lean": { priority, enabled, source, ... } } }
        // We accept both this object-map form and the older array form
        // that early tests were written against.
        if (Array.isArray(data.presets)) return normalizeRegistry(JSON.stringify(data.presets), warnings);
        if (data.presets && typeof data.presets === "object") {
            for (const [id, val] of Object.entries(data.presets)) {
                if (typeof id !== "string" || !id) continue;
                const v = val && typeof val === "object" ? val : {};
                out.push({
                    id,
                    priority: Number.isFinite(v.priority) ? v.priority : 0,
                    enabled: v.enabled !== false,
                });
            }
            return out;
        }
        // Flat map: { "preset-id": { priority, enabled } }. Skip reserved
        // top-level keys the CLI emits alongside `presets`.
        const RESERVED = new Set(["schema_version", "presets"]);
        for (const [id, val] of Object.entries(data)) {
            if (typeof id !== "string" || !id) continue;
            if (RESERVED.has(id)) continue;
            const v = val && typeof val === "object" ? val : {};
            out.push({
                id,
                priority: Number.isFinite(v.priority) ? v.priority : 0,
                enabled: v.enabled !== false,
            });
        }
        return out;
    }
    return out;
}

async function loadOnePreset(presetsDir, inst, deps, warnings) {
    const presetDir = join(presetsDir, inst.id);
    const presetYmlPath = join(presetDir, "preset.yml");
    if (!(await safe(deps.pathExists(presetYmlPath), false))) {
        warnings.push(`preset ${inst.id}: preset.yml missing`);
        return null;
    }

    let manifest;
    try {
        const raw = await deps.readFile(presetYmlPath, "utf8");
        if (raw.length > MAX_YAML_BYTES) throw new Error("preset.yml too large");
        const yaml = await getYaml();
        manifest = yaml.load(raw);
    } catch (err) {
        warnings.push(`preset ${inst.id}: preset.yml parse failed: ${err?.message ?? err}`);
        return null;
    }

    if (!manifest || typeof manifest !== "object") {
        warnings.push(`preset ${inst.id}: preset.yml not an object`);
        return null;
    }

    const meta = manifest.preset ?? {};
    const commandEntries = collectProvidesEntries(manifest, "command");
    const templateEntries = collectProvidesEntries(manifest, "template");
    const scriptEntries = collectProvidesEntries(manifest, "script");

    const commands = [];
    for (const entry of commandEntries) {
        try {
            const cmd = await loadOneCommand(presetDir, entry, deps, warnings, inst.id);
            if (cmd) commands.push(cmd);
        } catch (err) {
            warnings.push(`preset ${inst.id}: command ${entry?.name} failed: ${err?.message ?? err}`);
        }
    }

    return {
        id: inst.id,
        name: typeof meta.name === "string" ? meta.name : inst.id,
        description: typeof meta.description === "string" ? meta.description : "",
        version: typeof meta.version === "string" ? meta.version : "",
        priority: inst.priority,
        enabled: inst.enabled,
        source: "disk",
        commands,
        templates: templateEntries.map((e) => normalizeManifestEntry(e, inst.id, "template")),
        scripts: scriptEntries.map((e) => normalizeManifestEntry(e, inst.id, "script")),
    };
}

/**
 * Normalize a `provides.*` entry into a flat metadata record. Templates and
 * scripts aren't loaded from disk here (the wizard's phase graph only needs
 * commands), but callers that build the composition payload use these records
 * to enumerate what a preset contributes without re-parsing preset.yml.
 */
function normalizeManifestEntry(entry, presetId, kind) {
    return {
        id: idFromName(entry.name),
        name: typeof entry.name === "string" ? entry.name : "",
        file: typeof entry.file === "string" ? entry.file
            : (typeof entry.path === "string" ? entry.path : null),
        description: typeof entry.description === "string" ? entry.description : "",
        replaces: typeof entry.replaces === "string" ? entry.replaces : null,
        wraps: typeof entry.wraps === "string" ? entry.wraps : null,
        prepends: typeof entry.prepends === "string" ? entry.prepends : null,
        appends: typeof entry.appends === "string" ? entry.appends : null,
        kind,
        source: `preset:${presetId}`,
    };
}

/**
 * Collect all entries of a given kind ("command" | "template" | "script") from
 * a preset manifest, tolerating both accepted layouts:
 *
 *   A) Mixed bucket under `provides.templates:` where each entry carries
 *      `type: "command" | "template" | "script"` (older pattern).
 *   B) Split lists `provides.commands:`, `provides.templates:`, `provides.scripts:`
 *      where the top-level key IS the kind and per-entry `type:` is optional
 *      but usually still present.
 *
 * Order: split-list entries first (authoritative when both shapes coexist),
 * then any mixed-bucket entries not already covered by name. This dedup lets a
 * preset use either shape — or migrate incrementally — without producing
 * duplicate commands in the phase graph.
 */
function collectProvidesEntries(manifest, kind) {
    const provides = manifest?.provides;
    if (!provides || typeof provides !== "object") return [];
    const pluralKey = `${kind}s`; // "command" -> "commands", etc.
    const split = Array.isArray(provides[pluralKey]) ? provides[pluralKey] : [];
    // Templates section doubles as the mixed bucket in layout A. Skip it when
    // the requested kind IS template to avoid pulling entries in twice.
    const mixedSource = kind === "template" ? [] :
        (Array.isArray(provides.templates) ? provides.templates : []);
    const mixed = mixedSource.filter((e) => e && typeof e === "object" && e.type === kind);

    const seen = new Set();
    const out = [];
    for (const entry of [...split, ...mixed]) {
        if (!entry || typeof entry !== "object") continue;
        // For the split-lists case, templates don't need a type tag — infer it.
        // For the mixed-bucket case, entries in `provides.templates` with no
        // `type:` are conventionally templates.
        const inferredType = typeof entry.type === "string" ? entry.type : "template";
        if (inferredType !== kind) continue;
        const key = typeof entry.name === "string" ? entry.name : JSON.stringify(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

async function loadOneCommand(presetDir, entry, deps, warnings, presetId) {
    // Accepted entry shapes (both layouts A and B):
    //   { type: command, name: "speckit.constitution", file: "commands/constitution.md",
    //     description?, replaces? }
    //   { name: "speckit.brainstorm", file: "commands/brainstorm.md", description? }
    //     (type is implicit when the entry lives under `provides.commands:`)
    const commandFileRel = typeof entry.file === "string" ? entry.file
        : (typeof entry.path === "string" ? entry.path : null);
    if (!commandFileRel) {
        warnings.push(`preset ${presetId}: command ${entry.name} has no file`);
        return null;
    }
    const commandPath = join(presetDir, commandFileRel);
    if (!(await safe(deps.pathExists(commandPath), false))) {
        // Fall back to entry-provided metadata only — no handoffs, no user
        // input hints, but the wizard can still render the phase with a
        // "Run" button.
        return synthCommand(entry, presetId);
    }

    let raw;
    try {
        raw = await deps.readFile(commandPath, "utf8");
    } catch (err) {
        warnings.push(`preset ${presetId}: command file read failed: ${err?.message ?? err}`);
        return synthCommand(entry, presetId);
    }

    const parsed = await parseCommandFile(raw, warnings, presetId, entry.name);
    return {
        id: idFromName(entry.name),
        name: typeof entry.name === "string" ? entry.name : idFromName(commandFileRel),
        description: parsed.description ?? entry.description ?? "",
        artifact: parsed.artifact ?? null,
        optional: !!parsed.optional,
        placeholder: parsed.placeholder ?? "",
        userInput: parsed.userInput ?? [],
        handoffs: parsed.handoffs ?? [],
        replaces: typeof entry.replaces === "string" ? entry.replaces : null,
        source: `preset:${presetId}`,
    };
}

function synthCommand(entry, presetId) {
    return {
        id: idFromName(entry.name),
        name: typeof entry.name === "string" ? entry.name : "unknown",
        description: typeof entry.description === "string" ? entry.description : "",
        artifact: null,
        optional: false,
        placeholder: "",
        userInput: [],
        handoffs: [],
        replaces: typeof entry.replaces === "string" ? entry.replaces : null,
        source: `preset:${presetId}:synthetic`,
    };
}

/**
 * Parse a preset command markdown file: YAML frontmatter + body-section
 * slicing.
 * @param {string} raw
 */
export async function parseCommandFile(raw, warnings = [], presetId = "?", commandName = "?") {
    const out = {
        description: null,
        optional: false,
        artifact: null,
        placeholder: "",
        userInput: [],
        handoffs: [],
    };
    if (typeof raw !== "string") return out;
    // Strip UTF-8 BOM (some presets are authored on Windows and shipped with
    // \uFEFF as the first byte, which breaks the anchored ^--- match).
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const match = raw.match(FRONTMATTER_RE);
    let frontmatter = {};
    let body = raw;
    if (match) {
        try {
            const yaml = await getYaml();
            const fm = yaml.load(match[1]);
            if (fm && typeof fm === "object") frontmatter = fm;
        } catch (err) {
            warnings.push(`preset ${presetId} command ${commandName}: frontmatter parse failed: ${err?.message ?? err}`);
        }
        body = match[2];
    }

    if (typeof frontmatter.description === "string") out.description = frontmatter.description.trim();
    if (typeof frontmatter.artifact === "string") out.artifact = frontmatter.artifact.trim();
    if (typeof frontmatter.optional === "boolean") out.optional = frontmatter.optional;
    if (Array.isArray(frontmatter.handoffs)) out.handoffs = normalizeHandoffs(frontmatter.handoffs);

    // Slice first paragraph of body (after any `# heading`) for fallback
    // description.
    const firstPara = sliceFirstParagraph(body);
    if (!out.description && firstPara) out.description = firstPara;

    // Slice `## User Input` bullet list.
    const bullets = sliceUserInput(body);
    if (bullets.length) {
        out.userInput = bullets;
        out.placeholder = bullets[0];
    }

    return out;
}

function normalizeHandoffs(raw) {
    const out = [];
    for (const h of raw) {
        if (!h || typeof h !== "object") continue;
        let agent = typeof h.agent === "string" ? h.agent : null;
        let label = typeof h.label === "string" ? h.label : null;
        let prompt = typeof h.prompt === "string" ? h.prompt : "";
        // Preserve the tri-state (true / false / undefined) so downstream
        // consumers of the raw handoff metadata can distinguish "opted-out"
        // (false) from "unspecified" (undefined).
        let send = h.send === true ? true : (h.send === false ? false : undefined);
        // Shorthand shape: `- <agent>: <description>` (single-key map).
        // Some presets author handoffs as `{ "speckit.clarify": "when X" }`
        // instead of the full `{ agent, label, prompt, send }` object.
        // Detect a single string-valued key that looks like a slash command
        // and lift it to the canonical shape. `send` stays undefined so the
        // happy path can follow the edge by default.
        if (!agent) {
            const keys = Object.keys(h);
            if (keys.length === 1) {
                const k = keys[0];
                const v = h[k];
                if (typeof k === "string" && k.startsWith("speckit.") && typeof v === "string") {
                    agent = k;
                    // Shorthand description belongs in `prompt` (it's a
                    // condition/trigger), not `label`. Derive a short verb-y
                    // label from the agent id so incoming-label lookups
                    // produce concise button text like "Run plan" rather
                    // than the whole condition sentence.
                    if (!prompt) prompt = v;
                    if (!label) {
                        const short = k.replace(/^speckit\./, "").replace(/[-_]/g, " ");
                        label = short.charAt(0).toUpperCase() + short.slice(1);
                    }
                    if (send === undefined) send = true;
                }
            }
        }
        if (!agent) continue;
        const entry = {
            label: label ?? `Run ${agent}`,
            agent,
            prompt,
        };
        if (send !== undefined) entry.send = send;
        out.push(entry);
    }
    return out;
}

function sliceFirstParagraph(body) {
    if (typeof body !== "string") return "";
    // Strip a leading `# heading` if present.
    const stripped = body.replace(/^\s*#[^\n]*\n+/, "");
    // First non-empty paragraph = up to the first blank line.
    const para = stripped.split(/\n\s*\n/)[0] ?? "";
    return para.trim();
}

function sliceUserInput(body) {
    if (typeof body !== "string") return [];
    const m = body.match(/##\s+User Input\s*\n([\s\S]*?)(?=\n##\s+|\n#\s+|$)/i);
    if (!m) return [];
    const section = m[1];
    const bullets = [];
    for (const line of section.split(/\r?\n/)) {
        const b = line.match(/^\s*[-*]\s+(.*)$/);
        if (b) bullets.push(b[1].trim());
    }
    return bullets;
}

function idFromName(name) {
    if (typeof name !== "string") return "";
    return name.replace(/^speckit\./, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
}
