// speckit-wizard — SINGLE SOURCE OF TRUTH for preset precedence.
//
// The wizard MUST NOT compute preset precedence anywhere else. No priority
// sort, no installed_at tie-break, no "later install wins" rule. Those
// heuristics belong to the `specify` CLI, and they change independently of
// the wizard.
//
// The CLI's `specify preset list` command prints installed presets in
// precedence order (first line = winner). That IS the precedence.
//
// Rather than shelling the CLI directly from the wizard's server code
// (which would create a second, duplicate data path outside the skill
// architecture), we let the `speckit-preset` copilot skill talk to the
// CLI. The skill parses `specify preset list` (see prompts.mjs) and
// publishes the ordered list back to the wizard via the fast composition
// assembler (`applyComposition`), which caches it in `state.json` under
// `composition.presets`.
//
// extension.mjs::snapshot() reads that cached order and hands it to the
// preset loader as `deps.presetOrder`. The loader walks in that order
// and picks the first provider of each command name — same rule the CLI's
// own resolver applies internally, but computed from a single, authoritative
// source (the skill).
//
// This module provides:
//   • parsePresetListOutput(stdout) — the shared parser (also used by
//     extension.mjs::listInstalledPresets for a DIFFERENT purpose: matching
//     remote catalog entries to what's installed locally in the Catalogs
//     tab, which is NOT a precedence question).
//   • orderPresetsByCliList(presets, orderedIds) — pure reorder helper the
//     loader uses to align its enabled-preset list with the skill's order.
//
// -----------------------------------------------------------------------
//
// `specify preset list` output shape (v0.15.0):
//
//     Installed Presets:
//
//       Preset Display Name (preset-id) v1.0.0 — enabled — priority 10
//         Short description of the preset.
//         Tags: tag1, tag2, ...
//         Templates: 15
//
//       Another Preset (another-id) v1.0.0 — enabled — priority 10
//         Short description of another preset.
//         Tags: tag1, tag2, ...
//         Templates: 25
//
// The regex only matches the header line (name, id, version) and preserves
// the CLI's declared order. Enabled/disabled flag is captured so callers
// can filter — but the ORDER of the list is authoritative for precedence
// regardless of enabled state; disabled presets simply don't participate.

/**
 * Parse `specify preset list` stdout into an ordered list of installed
 * presets. Pure function; no I/O.
 *
 * @param {string} stdout
 * @returns {{
 *   orderedIds: string[],
 *   byId: Map<string, { id: string, name: string, version: string|null, enabled: boolean }>,
 *   byName: Map<string, string>,
 * }}
 */
export function parsePresetListOutput(stdout) {
    const orderedIds = [];
    const byId = new Map();
    const byName = new Map();
    if (typeof stdout !== "string" || !stdout.length) {
        return { orderedIds, byId, byName };
    }
    // Header line examples:
    //   "  Preset Display Name (preset-id) v1.0.0 — enabled — priority 10"
    //   "  Some Preset (some-id) v1.2.3"
    // The name may itself contain parentheses (e.g. "Some Preset (Full)"),
    // so we match the LAST "(<id>) v<version>" pair on the line, then treat
    // everything before it as the display name.
    for (const raw of stdout.split(/\r?\n/)) {
        const m = raw.match(/^\s+(.+?)\s+\(([^()]+)\)\s+v([\d.]+)(?:\s+[—-]\s+(enabled|disabled))?/i);
        if (!m) continue;
        const name = m[1].trim();
        const id = m[2].trim();
        const version = m[3] ?? null;
        const enabledToken = (m[4] ?? "").toLowerCase();
        // Header lines omit the enabled/disabled marker in some CLI
        // versions — treat "missing" as enabled to match `specify preset list`
        // (which only lists installed presets and prints "disabled" only
        // when explicitly disabled).
        const enabled = enabledToken === "" || enabledToken === "enabled";
        if (byId.has(id)) continue; // defensive against duplicate parses
        orderedIds.push(id);
        byId.set(id, { id, name, version, enabled });
        byName.set(name.toLowerCase(), id);
    }
    return { orderedIds, byId, byName };
}

/**
 * Reorder an array of loaded presets to match the skill-declared order.
 * Any preset not present in `orderedIds` is appended at the end in the
 * caller's original order — this preserves determinism for presets the
 * skill didn't enumerate (e.g. disabled ones filtered out upstream).
 *
 * @param {Array<{ id: string }>} presets
 * @param {string[]} orderedIds
 * @returns {Array<object>}
 */
export function orderPresetsByCliList(presets, orderedIds) {
    if (!Array.isArray(presets) || !presets.length) return [];
    if (!Array.isArray(orderedIds) || !orderedIds.length) return [...presets];
    const idToPreset = new Map(presets.map((p) => [p.id, p]));
    const seen = new Set();
    const result = [];
    for (const id of orderedIds) {
        const p = idToPreset.get(id);
        if (p && !seen.has(id)) {
            result.push(p);
            seen.add(id);
        }
    }
    for (const p of presets) {
        if (!seen.has(p.id)) {
            result.push(p);
            seen.add(p.id);
        }
    }
    return result;
}
