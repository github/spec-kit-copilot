import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, rename, stat, symlink, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { prepareDistribution, validateDistribution, manifestIdentity } from '../../dev-tools/prepare-distribution.mjs';
import { applyChanges, fingerprint, patchJson } from '../../dev-tools/configuration-files.mjs';
import { validatePresetCatalog } from '../../dev-tools/validate-preset-catalog.mjs';
import { distributionFixture, readJson, repositoryRoot, workspace, write } from './fixture-files.mjs';

const config = {
  repository: 'example/spec-kit-fork', catalogRef: 'feature/catalogs',
  copilotCatalogName: 'test-copilot-catalog',
  marketplace: { name: 'fork-marketplace', ownerName: 'Fork Maintainer', description: 'Fork description' },
};

test('distribution preview/apply updates only owned metadata, preserves formatting, versions and unrelated entries', async t => {
  const root = await distributionFixture(t);
  const marketplacePath = resolve(root, '.github', 'plugin', 'marketplace.json');
  const presetsPath = resolve(root, 'spec-kit-presets', 'catalog.json');
  const extensionsPath = resolve(root, 'spec-kit-extensions', 'catalog.json');
  const original = await Promise.all([marketplacePath, presetsPath, extensionsPath].map(path => readFile(path, 'utf8')));
  const preview = await prepareDistribution(config, {}, { repositoryRoot: root });
  assert.equal(preview.applied, false);
  assert.deepEqual(await Promise.all([marketplacePath, presetsPath, extensionsPath].map(path => readFile(path, 'utf8'))), original);
  assert.match(preview.commands[0], /\.git#feature\/catalogs/);
  for (const [index, kind] of [[4, 'extensions'], [5, 'presets']]) {
    assert.ok(preview.commands[index].includes(`catalog add ${preview.locators.catalogs[kind]} --name ${config.copilotCatalogName} --install-allowed`));
  }
  const applied = await prepareDistribution(config, { apply: true, expect: preview.expect }, { repositoryRoot: root });
  assert.equal(applied.backups.length, 3);
  for (let i = 0; i < original.length; i++) assert.equal(await readFile(applied.backups[i], 'utf8'), [original[0], original[2], original[1]][i]);
  const marketplace = await readJson(marketplacePath);
  assert.deepEqual(marketplace.plugins, JSON.parse(original[0]).plugins);
  assert.equal(marketplace.metadata.version, JSON.parse(original[0]).metadata.version);
  assert.equal(marketplace.name, config.marketplace.name);
  const presets = await readJson(presetsPath);
  const beforePresets = JSON.parse(original[1]);
  for (const id of ['copilot-sub-agents', 'copilot-assess-ask-questions']) assert.deepEqual(presets.presets[id], beforePresets.presets[id]);
  // Unrelated inline arrays, newlines and indentation remain byte-for-byte intact.
  const afterPresets = await readFile(presetsPath, 'utf8');
  const unrelated = original[1].slice(original[1].indexOf('"copilot-sub-agents"'), original[1].indexOf('"copilot-vertical-phase-control"'));
  assert.ok(afterPresets.includes(unrelated));
  for (const [after, before, group, id] of [
    [presets, beforePresets, 'presets', 'copilot-vertical-phase-control'],
    [await readJson(extensionsPath), JSON.parse(original[2]), 'extensions', 'extension-canvas-design'],
  ]) {
    const entry = after[group][id];
    assert.equal(entry.repository, `https://github.com/${config.repository}`);
    assert.equal(entry.download_url, `https://github.com/${config.repository}/releases/download/${id}-v${entry.version}/${id}.zip`);
    assert.match(entry.documentation, /blob\/feature\/catalogs/);
    for (const key of Object.keys(before[group][id]).filter(key => !['repository', 'homepage', 'documentation', 'download_url'].includes(key))) {
      assert.deepEqual(entry[key], before[group][id][key]);
    }
    assert.equal(after.updated_at, before.updated_at);
  }
  assert.equal((await prepareDistribution(config, {}, { repositoryRoot: root })).changed, false);
});

test('custom fields and changed inputs are preserved; stale apply and incompatible manifests are refused', async t => {
  const root = await distributionFixture(t);
  const context = { repositoryRoot: root };
  const preview = await prepareDistribution(config, {}, context);
  await assert.rejects(prepareDistribution(config, { apply: true }, context), /Conflict/);
  const path = resolve(root, '.github', 'plugin', 'marketplace.json');
  const edited = await readJson(path);
  edited.owner.contact = 'maintainer@example.test';
  edited.metadata.custom = { keep: true };
  await write(path, edited);
  await assert.rejects(prepareDistribution(config, { apply: true, expect: preview.expect }, context), /Conflict/);
  assert.deepEqual(await readJson(path), edited);
  const fresh = await prepareDistribution(config, {}, context);
  await prepareDistribution(config, { apply: true, expect: fresh.expect }, context);
  assert.deepEqual((await readJson(path)).metadata.custom, edited.metadata.custom);
  assert.equal((await readJson(path)).owner.contact, edited.owner.contact);
  const catalogPath = resolve(root, 'spec-kit-presets', 'catalog.json');
  const catalog = await readJson(catalogPath);
  catalog.presets['copilot-vertical-phase-control'].version = '99.0.0';
  await write(catalogPath, catalog);
  await assert.rejects(prepareDistribution(config, {}, context), /version conflict/);
});

test('distribution settings reject unsupported fields, unsafe locators and invalid metadata', () => {
  for (const value of [
    { ...config, automaticPublish: true },
    { ...config, copilotCatalogName: undefined },
    { ...config, copilotCatalogName: '' },
    { ...config, copilotCatalogName: 'Invalid Name' },
    { ...config, copilotCatalogName: 'catalog;publish' },
    { ...config, repository: '../invalid' },
    { ...config, repository: 'https://github.com/example/repo' },
    { ...config, catalogRef: 'main; publish' },
    { ...config, catalogRef: 'branch/../main' },
    { ...config, catalogRef: 'feature/.hidden' },
    { ...config, catalogRef: 'release.lock' },
    { ...config, catalogRef: 'release.lock/catalogs' },
    { ...config, marketplace: { ...config.marketplace, name: 'Invalid Name' } },
    { ...config, marketplace: { ...config.marketplace, description: '\nunsafe' } },
  ]) assert.throws(() => validateDistribution(value));
  assert.deepEqual(validateDistribution(config), config);
  for (const catalogRef of ['main', 'release/v1.2.3', 'feature/catalog-lock']) {
    assert.equal(validateDistribution({ ...config, catalogRef }).catalogRef, catalogRef);
  }
});

test('JSON patching preserves unrelated exact bytes and rejects missing/duplicate owned fields', () => {
  const text = '{ "outer": {"owned": "old"}, "untouched": [1,  2] }\r\n';
  assert.equal(patchJson(text, [[['outer', 'owned'], 'new']]), text.replace('"old"', '"new"'));
  assert.throws(() => patchJson(text, [[['absent'], 1]]), /missing/);
  assert.throws(() => patchJson('{"name":"first","name":"second"}', [[['name'], 'new']]), /Duplicate/);
});

test('file write preflight rejects edits and symlink targets without overwriting', async t => {
  const root = await workspace(t);
  const path = resolve(root, 'owned.json');
  await write(path, 'original');
  const changes = [{ path, before: 'original', after: 'next' }];
  await write(path, 'user edit');
  await assert.rejects(applyChanges(changes, fingerprint(changes)), /Conflict/);
  assert.equal(await readFile(path, 'utf8'), 'user edit');
  const alias = resolve(root, 'alias.json');
  try { await symlink(path, alias); }
  catch (error) {
    if (error.code === 'EPERM') { t.diagnostic('Windows symlink permission unavailable; remaining preflight assertions passed.'); return; }
    throw error;
  }
  const aliasChanges = [{ path: alias, before: 'user edit', after: 'next' }];
  await assert.rejects(applyChanges(aliasChanges, fingerprint(aliasChanges)), /symlink/);
  assert.equal(await readFile(path, 'utf8'), 'user edit');
});

test('file write preflight rejects directory junction ancestors without changing linked files', async t => {
  const root = await workspace(t);
  const target = resolve(root, 'target');
  const link = resolve(root, 'linked');
  await mkdir(target);
  await write(resolve(target, 'settings.json'), 'original');
  await symlink(target, link, 'junction');
  const changes = [{ path: resolve(link, 'settings.json'), before: 'original', after: 'next' }];
  await assert.rejects(applyChanges(changes, fingerprint(changes)), /symlink or junction/);
  assert.equal(await readFile(resolve(target, 'settings.json'), 'utf8'), 'original');
});

test('failed multi-file commit restores prior writes and reports retained backups', async t => {
  const root = await workspace(t);
  const paths = ['first.json', 'second.json'].map(name => resolve(root, name));
  for (const path of paths) await write(path, 'original');
  const changes = paths.map(path => ({ path, before: 'original', after: 'updated' }));
  let calls = 0;
  await assert.rejects(applyChanges(changes, fingerprint(changes), {
    move: async (source, destination) => {
      if (++calls === 2) throw new Error('injected commit failure');
      await rename(source, destination);
    },
  }), /injected commit failure; applied changes restored.*Backups:/);
  for (const path of paths) assert.equal(await readFile(path, 'utf8'), 'original');
  assert.equal((await readdir(root)).some(name => name.includes('.stage-')), false);
});

test('apply preserves POSIX permissions on replacements and backups despite umask', {
  skip: process.platform === 'win32' ? 'POSIX permission bits do not represent Windows ACLs' : false,
}, async t => {
  const root = await workspace(t);
  const changes = [];
  for (const mode of [0o600, 0o640]) {
    const path = resolve(root, `settings-${mode}.json`);
    await write(path, 'original');
    await chmod(path, mode);
    changes.push({ path, before: 'original', after: 'updated' });
  }
  const previousUmask = process.umask(0o077);
  let backups;
  try {
    backups = await applyChanges(changes, fingerprint(changes));
  } finally {
    process.umask(previousUmask);
  }
  for (const [index, mode] of [0o600, 0o640].entries()) {
    assert.equal((await stat(changes[index].path)).mode & 0o777, mode);
    assert.equal((await stat(backups[index])).mode & 0o777, mode);
    assert.equal(await readFile(changes[index].path, 'utf8'), 'updated');
    assert.equal(await readFile(backups[index], 'utf8'), 'original');
  }
});

test('rollback removes newly created targets when a later commit fails', async t => {
  const root = await workspace(t);
  const created = resolve(root, 'new.json');
  const existing = resolve(root, 'existing.json');
  await write(existing, 'original');
  const changes = [
    { path: created, before: null, after: 'new' },
    { path: existing, before: 'original', after: 'updated' },
  ];
  await assert.rejects(applyChanges(changes, fingerprint(changes), {
    move: async (source, destination) => {
      if (destination === existing) throw new Error('injected failure');
      await rename(source, destination);
    },
  }), /applied changes restored/);
  assert.equal(await readFile(existing, 'utf8'), 'original');
  await assert.rejects(readFile(created), { code: 'ENOENT' });
  assert.equal((await readdir(root)).some(name => name.includes('.stage-')), false);
});

test('cleanup attempts every staged file and retains commit and rollback failures', async t => {
  const root = await workspace(t);
  const paths = ['first.json', 'second.json', 'third.json'].map(name => resolve(root, name));
  for (const path of paths) await write(path, 'original');
  const changes = paths.map(path => ({ path, before: 'original', after: 'updated' }));
  const attempted = [];
  const commitError = new Error('injected commit failure');
  await assert.rejects(applyChanges(changes, fingerprint(changes), {
    move: async (source, destination) => {
      if (destination === paths[1]) {
        await write(paths[0], 'concurrent edit');
        throw commitError;
      }
      await rename(source, destination);
    },
    removeStaged: async path => {
      attempted.push(path);
      if (path.startsWith(`${paths[1]}.stage-`)) throw new Error('injected cleanup failure');
      await unlink(path);
    },
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /rollback incomplete.*staged-file cleanup incomplete/);
    assert.equal(error.errors[0].errors[0], commitError);
    assert.match(error.errors[0].errors[1].message, /Rollback conflict/);
    assert.match(error.errors[1].message, /injected cleanup failure/);
    return true;
  });
  assert.equal(attempted.length, 3);
  assert.equal(await readFile(paths[0], 'utf8'), 'concurrent edit');
  assert.deepEqual((await readdir(root)).filter(name => name.includes('.stage-')),
    [attempted[1].slice(root.length + 1)]);
});

test('cleanup failures after a successful commit are reported without undoing writes', async t => {
  const root = await workspace(t);
  const path = resolve(root, 'owned.json');
  await write(path, 'original');
  const changes = [{ path, before: 'original', after: 'updated' }];
  await assert.rejects(applyChanges(changes, fingerprint(changes), {
    removeStaged: async () => { throw new Error('injected cleanup failure'); },
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 1);
    assert.match(error.message, /staged-file cleanup incomplete/);
    return true;
  });
  assert.equal(await readFile(path, 'utf8'), 'updated');
});

test('checked-in distribution examples preview without writes and become idempotent when applied', async t => {
  const root = await distributionFixture(t);
  for (const variant of ['upstream', 'fork']) {
    const selected = await readJson(resolve(repositoryRoot, 'config', `distribution.${variant}.example.json`));
    const result = await prepareDistribution(selected, {}, { repositoryRoot: root });
    assert.equal(result.applied, false);
    await prepareDistribution(selected, { apply: true, expect: result.expect }, { repositoryRoot: root });
    assert.equal((await prepareDistribution(selected, {}, { repositoryRoot: root })).changed, false);
  }
});

test('preset publisher validates exact target asset, manifest identity/version and catalog version', () => {
  const id = 'copilot-vertical-phase-control';
  const repository = 'example/package-releases';
  const version = '1.2.3';
  const catalog = { presets: { [id]: { id, version,
    download_url: `https://github.com/${repository}/releases/download/${id}-v${version}/${id}.zip` } } };
  const manifest = `preset:\n  id: ${id}\n  version: ${version}\n`;
  const input = { id, version, repository, manifest, catalog };
  assert.equal(validatePresetCatalog(input), catalog.presets[id].download_url);
  assert.throws(() => validatePresetCatalog({ ...input, repository: 'example/fork' }), /download URL/);
  assert.throws(() => validatePresetCatalog({ ...input, version: '99.0.0' }), /ID and version/);
  assert.throws(() => validatePresetCatalog({ ...input, manifest: manifest.replace(id, 'copilot-other') }), /ID and version/);
  assert.throws(() => validatePresetCatalog({ ...input, manifest: `${manifest}\n${manifest}` }), /one top-level preset/);
  const changed = structuredClone(catalog);
  changed.presets[id].id = 'copilot-other';
  assert.throws(() => validatePresetCatalog({ ...input, catalog: changed }), /ID and version/);
});

test('manifest identity rejects duplicate top-level sections for both package kinds', () => {
  for (const section of ['preset', 'extension']) {
    const manifest = `${section}:\n  id: sample-package\n  version: 1.2.3\n`;
    assert.deepEqual(manifestIdentity(manifest, section), { id: 'sample-package', version: '1.2.3' });
    assert.throws(() => manifestIdentity(`${manifest}${manifest}`, section), /one top-level/);
  }
});
