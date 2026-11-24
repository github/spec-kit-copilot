import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { configureRuntime } from '../../dev-tools/configure-runtime.mjs';
import { DEFAULT_SETTINGS_PATH, runtimeDefaults } from '../../plugins/spec-kit-copilot-wizard/extensions/speckit-wizard-canvas/env/runtime-config.mjs';
import { readJson, repositoryRoot, workspace, write } from './fixture-files.mjs';

test('show is read-only; defaults, exclusive explicit selection, and effective merge agree with resolver', async t => {
  const home = await workspace(t);
  const context = { env: {}, home };
  const shown = await configureRuntime('show', {}, context);
  assert.equal(shown.path, null);
  assert.deepEqual(shown.settings, runtimeDefaults);
  assert.deepEqual(await readdir(home), []);
  await write(DEFAULT_SETTINGS_PATH(home), { generateCanvasEnabled: true });
  const selected = resolve(home, 'selected.json');
  await write(selected, { copilotCatalogName: 'fork-catalog' });
  const explicit = await configureRuntime('show', {}, { home, env: { SPECKIT_CONFIG_FILE: selected } });
  assert.equal(explicit.path, selected);
  assert.equal(explicit.settings.copilotCatalogName, 'fork-catalog');
  assert.equal(explicit.settings.generateCanvasEnabled, runtimeDefaults.generateCanvasEnabled);
  assert.equal((await configureRuntime('show', {}, context)).settings.generateCanvasEnabled, true);
});

test('fork preview does not write; apply backs up exact bytes and preserves unrelated declared overrides', async t => {
  const home = await workspace(t);
  const context = { home, env: {} };
  const path = DEFAULT_SETTINGS_PATH(home);
  const existing = {
    generateCanvasEnabled: true,
    catalogs: { community: { bundles: 'https://example.test/community.json' } },
  };
  await write(path, existing);
  const before = await readFile(path, 'utf8');
  const source = resolve(home, 'fork.json');
  await write(source, {
    catalogs: { copilot: { extensions: 'https://example.test/fork.json' } },
    copilotCatalogName: 'fork-catalog',
  });
  const options = { source };
  const preview = await configureRuntime('use-fork', options, context);
  assert.equal(preview.applied, false);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.match(preview.preview, /before/);
  assert.equal(preview.settings.catalogs.community.bundles, existing.catalogs.community.bundles);
  const applied = await configureRuntime('use-fork', { ...options, apply: true, expect: preview.expect }, context);
  assert.equal(applied.backups.length, 1);
  assert.equal(await readFile(applied.backups[0], 'utf8'), before);
  assert.deepEqual(await readJson(path), {
    ...existing,
    catalogs: { ...existing.catalogs, copilot: { extensions: 'https://example.test/fork.json' } },
    copilotCatalogName: 'fork-catalog',
  });
  assert.match(applied.notice, /NOT reloaded/);
});

test('writes require a matching preview; target and source edits are conflicts with no overwrite', async t => {
  const home = await workspace(t);
  const path = resolve(home, 'settings.json');
  const source = resolve(home, 'source.json');
  const context = { env: {}, home };
  await write(path, {});
  await write(source, { copilotCatalogName: 'fork-catalog' });
  const options = { file: path, source };
  const preview = await configureRuntime('use-fork', options, context);
  await assert.rejects(configureRuntime('use-fork', { ...options, apply: true }, context), /Conflict/);
  await write(path, { generateCanvasEnabled: true });
  await assert.rejects(configureRuntime('use-fork', { ...options, apply: true, expect: preview.expect }, context), /Conflict/);
  assert.deepEqual(await readJson(path), { generateCanvasEnabled: true });
  const fresh = await configureRuntime('use-fork', options, context);
  await write(source, { copilotCatalogName: 'changed-source' });
  await assert.rejects(configureRuntime('use-fork', { ...options, apply: true, expect: fresh.expect }, context), /Conflict/);
  assert.deepEqual((await readdir(home)).sort(), ['settings.json', 'source.json']);
});

test('defaults switch preserves a backup and keeps explicit selectors valid, without merging a user override', async t => {
  const home = await workspace(t);
  const path = resolve(home, 'selected.json');
  const context = { home, env: { SPECKIT_CONFIG_FILE: path } };
  await write(DEFAULT_SETTINGS_PATH(home), { generateCanvasEnabled: true });
  await write(path, { copilotCatalogName: 'fork-catalog' });
  const before = await readFile(path, 'utf8');
  const preview = await configureRuntime('use-defaults', {}, context);
  assert.deepEqual(preview.settings, runtimeDefaults);
  assert.equal(await readFile(path, 'utf8'), before);
  const applied = await configureRuntime('use-defaults', { apply: true, expect: preview.expect }, context);
  assert.equal(await readFile(applied.backups[0], 'utf8'), before);
  assert.deepEqual(await readJson(path), {});
  assert.deepEqual((await configureRuntime('show', {}, context)).settings, runtimeDefaults);
  assert.deepEqual(await readJson(DEFAULT_SETTINGS_PATH(home)), { generateCanvasEnabled: true });
});

test('missing optional defaults remain absent; explicitly missing defaults can be created only after preview', async t => {
  const home = await workspace(t);
  const context = { home, env: {} };
  const preview = await configureRuntime('use-defaults', {}, context);
  assert.equal(preview.changed, false);
  assert.equal(preview.effectivePath, null);
  const applied = await configureRuntime('use-defaults', { apply: true, expect: preview.expect }, context);
  assert.equal(applied.effectivePath, null);
  assert.match(applied.notice, /No settings changes needed/);
  assert.deepEqual(await readdir(home), []);
  const file = resolve(home, 'explicit.json');
  await assert.rejects(configureRuntime('show', { file }, context), /Unable to load/);
  const explicit = await configureRuntime('use-defaults', { file }, context);
  await configureRuntime('use-defaults', { file, apply: true, expect: explicit.expect }, context);
  assert.deepEqual(await readJson(file), {});
});

test('invalid settings and relative environment selectors fail before any write; show cannot apply', async t => {
  const home = await workspace(t);
  const file = resolve(home, 'settings.json');
  const context = { env: {}, home };
  for (const invalid of ['{', '{"unknown":true}', '{"generateCanvasEnabled":"true"}', '{"catalogs":{"copilot":{"presets":"http://invalid.test"}}}']) {
    await write(file, invalid);
    await assert.rejects(configureRuntime('use-defaults', { file, apply: true }, context));
    assert.equal(await readFile(file, 'utf8'), invalid);
  }
  await assert.rejects(configureRuntime('use-fork', {}, { home, env: { SPECKIT_CONFIG_FILE: 'relative.json' } }), /absolute/);
  await assert.rejects(configureRuntime('show', { apply: true }, context), /read-only/);
  await assert.rejects(configureRuntime('use-defaults', { source: file }, context), /only valid/);
});

test('fork repository example is usable and does not change settings without apply', async t => {
  const home = await workspace(t);
  const preview = await configureRuntime('use-fork', {}, { home, env: {} });
  assert.equal(preview.applied, false);
  const example = await readJson(resolve(repositoryRoot, 'config', 'runtime-settings.fork.example.json'));
  assert.equal(preview.settings.catalogs.copilot.extensions, example.catalogs.copilot.extensions);
  assert.deepEqual(await readdir(home), []);
});

test('helper imports and help do not read a broken configured file at startup', () => {
  const result = spawnSync(process.execPath, [
    resolve(repositoryRoot, 'dev-tools', 'configure-runtime.mjs'), '--help',
  ], { env: { ...process.env, SPECKIT_CONFIG_FILE: 'invalid-relative-selector' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Preview is the default/);
});
