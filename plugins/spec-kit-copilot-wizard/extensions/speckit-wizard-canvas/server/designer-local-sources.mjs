// Validation for Designer "Local development" sources: user-typed absolute
// directory paths pointing at an uninstalled preset/extension on disk
// (`preset.yml` / `extension.yml`), used instead of a hosted catalog entry.
//
// This is NOT the workspace-sandboxed path helper in http-utils.mjs —
// local-dev paths are expected to be absolute and can point anywhere on the
// user's machine, so there is no "escapes the workspace" concept here.
// Validation is limited to: path well-formedness, directory existence, a
// parseable manifest, and a well-formed id/name/version extracted from it.

import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

// js-yaml (deferred import, mirrors composition/preset-loader.mjs and
// composition/collect.mjs): the wizard auto-runs `npm install` on first
// open of a fresh worktree, so a static top-level import would crash the
// extension process before that install can run. The safe schema rejects
// custom YAML tags (`!!js/function`, `!!js/regexp`, ...) that would
// otherwise let an untrusted local preset.yml/extension.yml execute code
// when parsed — local-dev paths point anywhere on disk, so this manifest
// content is never more trusted than a hosted catalog download.
let _yamlPromise = null;
function getYaml() {
    if (!_yamlPromise) {
        _yamlPromise = import("js-yaml").then(
            (m) => {
                const mod = m.default ?? m;
                const schema = mod.JSON_SCHEMA ?? mod.FAILSAFE_SCHEMA;
                return { load: (raw, opts = {}) => mod.load(raw, { schema, ...opts }) };
            },
            (err) => {
                _yamlPromise = null;
                throw err;
            },
        );
    }
    return _yamlPromise;
}

const PATH_LIMIT = 4096;
// Manifests are small, hand-authored YAML files; cap the read so an
// unbounded/adversarial file (e.g. a symlink to /dev/zero, or a huge
// generated file) cannot be read into memory wholesale before parsing.
const MANIFEST_SIZE_LIMIT = 65536;
// Same id pattern the Designer handoff schema already uses for catalog ids
// (handoff.mjs's PACKAGE regex), so local ids round-trip through the same
// schema without needing a second pattern downstream.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

const MANIFEST = {
    presets: { file: "preset.yml", key: "preset", label: "preset" },
    extensions: { file: "extension.yml", key: "extension", label: "extension" },
};

export function isSupportedLocalKind(kind) {
    return Object.prototype.hasOwnProperty.call(MANIFEST, kind);
}

// Windows Explorer's "Copy as path" (and many shells' drag-and-drop) wraps
// the whole path in a single balanced pair of double quotes, e.g.
// `"C:\Users\name\dir"`, which users often paste verbatim. Strip exactly one
// such surrounding pair (double, or less commonly single) before validating
// the path. Quote characters are otherwise left untouched: apostrophes are
// valid in real paths (e.g. `/home/O'Brien/preset`), and even a raw quote is
// a legal POSIX filename character, so anything other than that one
// wrapping pair is left for `realpath()` to accept or reject on its own
// merits rather than rejected here on sight.
export function stripSurroundingQuotes(value) {
    const first = value[0];
    const last = value[value.length - 1];
    const wrapped = value.length >= 2 && first === last && (first === "\"" || first === "'");
    return wrapped ? value.slice(1, -1) : value;
}

/**
 * Resolve a user-typed path to a canonical, realpath'd absolute directory.
 * Kind-independent: shared by both the explicit-kind and auto-detect paths
 * through `validateLocalSource`.
 */
async function resolveCanonicalPath(rawPath) {
    if (typeof rawPath !== "string" || !rawPath.trim()) {
        throw new Error("Enter a local directory path.");
    }
    const trimmed = rawPath.trim();
    if (trimmed.length > PATH_LIMIT || /[\x00-\x1f]/.test(trimmed)) {
        throw new Error("That path looks invalid.");
    }
    const unquoted = stripSurroundingQuotes(trimmed).trim();
    if (!isAbsolute(unquoted)) {
        throw new Error("Local development paths must be absolute (e.g. C:\\path\\to\\dir or /path/to/dir).");
    }
    let canonical;
    try {
        canonical = await realpath(unquoted);
    } catch {
        throw new Error(`Directory not found: ${unquoted}`);
    }
    if (canonical.length > PATH_LIMIT || /[\x00-\x1f]/.test(canonical)) {
        throw new Error("That path looks invalid.");
    }
    return canonical;
}

/**
 * Does `canonical` contain a given kind's manifest file (as a regular
 * file, not a directory of the same name)? Used both to auto-detect kind
 * and to report a clear "missing manifest" error for an explicit kind.
 */
async function hasManifestFile(canonical, manifest) {
    try {
        const fileStat = await stat(join(canonical, manifest.file));
        return fileStat.isFile();
    } catch {
        return false;
    }
}

/**
 * Detect which kind `canonical` is by checking for `preset.yml` /
 * `extension.yml`. The two manifests are mutually exclusive and
 * self-identifying, so a directory with neither or both is rejected
 * explicitly rather than guessed at.
 */
async function detectLocalKind(canonical) {
    const present = [];
    for (const [kind, manifest] of Object.entries(MANIFEST)) {
        if (await hasManifestFile(canonical, manifest)) present.push(kind);
    }
    if (present.length === 0) {
        throw new Error(`No preset.yml or extension.yml found in ${canonical}`);
    }
    if (present.length > 1) {
        throw new Error(`Found both preset.yml and extension.yml in ${canonical}; a local source must be exactly one.`);
    }
    return present[0];
}

/**
 * Read a manifest file through a single open file descriptor, bounded to
 * at most `MANIFEST_SIZE_LIMIT + 1` bytes regardless of what `stat()`
 * reported or what the file grows/changes to afterward. Opening once and
 * reading from that same descriptor (rather than `stat()` then a separate
 * `readFile()`) closes the TOCTOU window where a file could be replaced or
 * appended to between the size check and the read, which would otherwise
 * let the loopback server allocate an arbitrarily large buffer despite the
 * nominal size limit.
 *
 * This is reachable from explicit-kind launch revalidation after a
 * previously added manifest is replaced on disk, so the open itself must
 * not be able to block or follow a symlink: `O_NOFOLLOW` rejects a manifest
 * path that was swapped for a symlink (matching the handoff reader in
 * speckit-canvas-designer/handoff.mjs), and `O_NONBLOCK` prevents `open()`
 * from hanging indefinitely if the path now names a FIFO — a plain `"r"`
 * open blocks until a writer attaches, which would hang the launch request
 * and tie up a libuv worker.
 *
 * `openFile` defaults to the real `open` and is only overridden by tests,
 * which use it to swap the parent directory in the gap between resolving
 * `canonical` and this function's open — mirroring the `openFile` hook in
 * speckit-canvas-designer/handoff.mjs's `readHandoff`.
 */
async function readBoundedManifest(manifestPath, manifest, canonical, openFile = open) {
    let handle;
    try {
        handle = await openFile(manifestPath, constants.O_RDONLY
            | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
        if (error.code === "ELOOP") throw new Error(`${manifest.file} in ${canonical} must not be a symlink`);
        throw new Error(`Missing ${manifest.file} in ${canonical}`);
    }
    try {
        // `O_NOFOLLOW` protects only the final path component
        // (`manifestPath` itself). `canonical`, its parent directory, was
        // resolved earlier by `resolveCanonicalPath`/`detectLocalKind`, so a
        // TOCTOU race remains: the parent can be renamed and replaced by a
        // symlink to a different location between that earlier resolution
        // and this `open`, which would silently accept a different manifest
        // under the original canonical path. Re-check the parent directory's
        // realpath and the opened file's on-disk identity (dev/ino) against
        // a path-based `lstat`, mirroring the handoff reader's pre/post-read
        // identity check (speckit-canvas-designer/handoff.mjs:129-134), so a
        // swap anywhere along the path is rejected rather than followed.
        const [fileStat, pathStat, currentFolder] = await Promise.all([
            handle.stat(), lstat(manifestPath), realpath(canonical),
        ]);
        if (currentFolder !== canonical) {
            throw new Error(`${manifest.file} in ${canonical} escaped the expected directory`);
        }
        if (!fileStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
            || fileStat.dev !== pathStat.dev || fileStat.ino !== pathStat.ino) {
            throw new Error(`Missing ${manifest.file} in ${canonical}`);
        }
        if (fileStat.size > MANIFEST_SIZE_LIMIT) {
            throw new Error(`${manifest.file} is too large (max ${MANIFEST_SIZE_LIMIT} bytes)`);
        }
        const buffer = Buffer.alloc(MANIFEST_SIZE_LIMIT + 1);
        let totalRead = 0;
        while (totalRead < buffer.length) {
            const { bytesRead } = await handle.read(buffer, totalRead, buffer.length - totalRead, null);
            if (bytesRead === 0) break;
            totalRead += bytesRead;
        }
        if (totalRead > MANIFEST_SIZE_LIMIT) {
            throw new Error(`${manifest.file} is too large (max ${MANIFEST_SIZE_LIMIT} bytes)`);
        }
        return buffer.subarray(0, totalRead).toString("utf8");
    } finally {
        await handle.close();
    }
}

/**
 * Parse and validate the manifest for an already-known `kind` at
 * `canonical`. Resolves with `{ kind, id, name, version, description, path }`.
 */
async function validateManifest(kind, canonical, openFile = open) {
    const manifest = MANIFEST[kind];
    const manifestPath = join(canonical, manifest.file);
    const text = await readBoundedManifest(manifestPath, manifest, canonical, openFile);
    let data;
    try {
        const yaml = await getYaml();
        data = yaml.load(text);
    } catch (err) {
        throw new Error(`Could not parse ${manifest.file}: ${err.message}`);
    }
    const section = data?.[manifest.key];
    const id = section?.id;
    const name = section?.name;
    const version = section?.version;
    if (typeof id !== "string" || !ID.test(id)) {
        throw new Error(`${manifest.file} is missing a valid ${manifest.key}.id`);
    }
    if (typeof name !== "string" || !name.trim()) {
        throw new Error(`${manifest.file} is missing a ${manifest.key}.name`);
    }
    if (version !== undefined && version !== null
        && (typeof version !== "string" || !VERSION.test(version))) {
        throw new Error(`${manifest.file} has an invalid ${manifest.key}.version`);
    }
    return {
        kind,
        id,
        name: name.trim(),
        version: typeof version === "string" ? version : null,
        description: typeof section.description === "string" ? section.description.trim() : "",
        path: canonical,
    };
}

/**
 * Validate a user-typed absolute directory as a local preset/extension
 * source. Resolves with `{ kind, id, name, version, description, path }` (the canonical,
 * realpath'd directory) or throws an `Error` with an explicit, user-facing
 * message describing exactly what failed.
 *
 * `kind` may be an explicit `"presets"` / `"extensions"` (checks only that
 * manifest, preserving every existing error message verbatim), or omitted /
 * `null` / `""` / `"auto"` to auto-detect the kind from whichever manifest
 * file (`preset.yml` or `extension.yml`) is present in the directory.
 *
 * `openFile` is test-only: it defaults to the real `open` and lets tests
 * inject a parent-directory swap in the gap between resolving `canonical`
 * and opening the manifest, to exercise the TOCTOU re-check in
 * `readBoundedManifest`.
 */
export async function validateLocalSource(kind, rawPath, openFile = open) {
    const auto = kind === undefined || kind === null || kind === "" || kind === "auto";
    if (!auto && !MANIFEST[kind]) {
        throw new Error("Local development only supports presets and extensions.");
    }
    const canonical = await resolveCanonicalPath(rawPath);
    const resolvedKind = auto ? await detectLocalKind(canonical) : kind;
    return validateManifest(resolvedKind, canonical, openFile);
}

export async function readDesignerContract(path) {
    const canonical = await realpath(path);
    const schemas = join(canonical, "schemas");
    const directory = await lstat(schemas);
    if (!directory.isDirectory() || directory.isSymbolicLink()
        || await realpath(schemas) !== schemas) {
        throw new Error("Canvas Design schemas must be a real directory in the local package");
    }
    const file = "external-designer.tab-definition.schema.json";
    const text = await readBoundedManifest(join(schemas, file),
        { file }, schemas);
    let contract;
    try { contract = JSON.parse(text); }
    catch { throw new Error("Invalid Canvas Design Designer tab schema"); }
    const version = contract?.properties?.schemaVersion?.const;
    if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error("Invalid Canvas Design Designer tab schema version");
    }
    return version;
}

export async function verifyHostedWorkflowRegistrations(path) {
    const canonical = await realpath(path);
    const file = "extension.yml";
    const text = await readBoundedManifest(join(canonical, file), { file }, canonical);
    let manifest;
    try { manifest = (await getYaml()).load(text); }
    catch { throw new Error("Invalid installed Canvas Design extension manifest"); }
    const templates = manifest?.provides?.templates;
    const required = [
        "generated-workflow", "generated-phase-control", "generated-phase-adapter",
    ];
    const missing = [];
    for (const name of required) {
        const matches = Array.isArray(templates) ? templates.filter((entry) => entry?.name === name) : [];
        const registered = matches.length === 1 && typeof matches[0].file === "string"
            && !isAbsolute(matches[0].file);
        const target = registered ? join(canonical, matches[0].file) : null;
        const rel = target && relative(canonical, target);
        let valid = registered && rel && rel !== ".." && !rel.startsWith(`..${sep}`)
            && !isAbsolute(rel);
        if (valid) {
            try {
                valid = (await lstat(target)).isFile() && await realpath(target) === target;
            } catch { valid = false; }
        }
        if (!valid) missing.push(name);
    }
    if (missing.length) {
        throw new Error(`Installed hosted Canvas Design lacks required Workflow registrations/files: ${missing.join(", ")}. Use an approved local-source override containing the Workflow phase controls; do not open Designer.`);
    }
    const controlFile = templates.find((entry) => entry.name === "generated-phase-control").file;
    let control;
    try { control = JSON.parse(await readBoundedManifest(join(canonical, controlFile), { file: controlFile }, canonical)); }
    catch { throw new Error("Installed hosted Canvas Design has an invalid phase control definition; use an approved local-source override."); }
    if (control.id !== "workflow-phases" || control.adapter !== "generated-phase-adapter"
        || control.placement?.page !== "workflow" || control.placement?.slot !== "workflow.phases") {
        throw new Error("Installed hosted Canvas Design lacks the required Workflow phase placement; use an approved local-source override.");
    }
}
