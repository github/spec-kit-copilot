import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS_PATH, resolveRuntimeConfig, validateRuntimeSettings } from '../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/env/runtime-config.mjs';
import { applyChanges, fingerprint, jsonText, parseArgs, preview, readOptional } from './configuration-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function mergeOverrides(existing, selected) {
  const merged = { ...existing, ...selected };
  if (existing.catalogs || selected.catalogs) {
    merged.catalogs = { ...existing.catalogs };
    for (const [group, values] of Object.entries(selected.catalogs ?? {})) {
      merged.catalogs[group] = { ...merged.catalogs[group], ...values };
    }
  }
  return validateRuntimeSettings(merged);
}

export async function configureRuntime(command, options = {}, { env = process.env, home = homedir() } = {}) {
  if (!['show', 'use-fork', 'use-defaults'].includes(command)) throw new Error('Expected show, use-fork, or use-defaults.');
  if (options.source && command !== 'use-fork') throw new Error('--source is only valid with use-fork.');
  if (command === 'show' && (options.apply || options.expect)) throw new Error('show is read-only.');
  if (!options.file && Object.hasOwn(env, 'SPECKIT_CONFIG_FILE') &&
      (typeof env.SPECKIT_CONFIG_FILE !== 'string' || !isAbsolute(env.SPECKIT_CONFIG_FILE))) {
    throw new Error('SPECKIT_CONFIG_FILE must be an absolute file path.');
  }
  const path = resolve(options.file ?? env.SPECKIT_CONFIG_FILE ?? DEFAULT_SETTINGS_PATH(home));
  const selectedEnv = { ...env, SPECKIT_CONFIG_FILE: path };
  if (command === 'show') {
    // Without an explicit selection, an absent user file still means packaged defaults.
    return { ...(await resolveRuntimeConfig({ env: options.file ? selectedEnv : env, home })), changed: false };
  }
  const before = await readOptional(path);
  const existing = before === null ? {} : validateRuntimeSettings(JSON.parse(before));
  let next = {};
  if (command === 'use-fork') {
    const source = resolve(options.source ?? resolve(root, 'config', 'runtime-settings.fork.example.json'));
    const text = await readOptional(source);
    if (text === null) throw new Error(`Settings source is unavailable: ${source}`);
    next = mergeOverrides(existing, validateRuntimeSettings(JSON.parse(text)));
  }
  // Keep a valid empty override, including for an explicit SPECKIT_CONFIG_FILE.
  // Deleting it would leave explicit selectors broken at provider startup.
  const after = command === 'use-defaults' && before === null && !options.file && !env.SPECKIT_CONFIG_FILE
    ? null : jsonText(next, before ?? '');
  const changes = after === null ? [] : [{ path, before, after }];
  const result = {
    path, preview: preview(changes), expect: fingerprint(changes),
    changed: changes.some(change => change.before !== change.after), applied: Boolean(options.apply),
  };
  const virtualRead = async (selectedPath, ...args) => {
    if (resolve(selectedPath) === path && after !== null) return after;
    const { readFile } = await import('node:fs/promises');
    return readFile(selectedPath, ...args);
  };
  const prospective = await resolveRuntimeConfig({
    env: after === null ? env : selectedEnv, home, read: virtualRead,
  });
  if (options.apply) result.backups = await applyChanges(changes, options.expect);
  const effective = options.apply
    ? await resolveRuntimeConfig({ env: after === null ? env : selectedEnv, home })
    : prospective;
  result.settings = effective.settings;
  result.effectivePath = effective.path;
  result.notice = options.apply
    ? `${result.changed ? 'Settings written' : 'No settings changes needed'}; running providers have NOT reloaded. Reload/restart and verify both providers. Settings do not restore published provider code.`
    : 'Preview only; no settings, environment, or providers changed.';
  return result;
}

async function main() {
  const [command = 'show', ...args] = process.argv.slice(2);
  const options = parseArgs(args, ['file', 'source', 'expect']);
  if (options.help || command === '--help') {
    console.log('node dev-tools/configure-runtime.mjs show|use-fork|use-defaults [--file PATH] [--source JSON] [--apply --expect DIGEST]\nPreview is the default. use-fork merges selected overrides; use-defaults backs up and writes {}.');
    return;
  }
  console.log(JSON.stringify(await configureRuntime(command, options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
