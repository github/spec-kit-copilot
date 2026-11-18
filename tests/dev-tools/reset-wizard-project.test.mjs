import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { resetWizardProject } from '../../dev-tools/reset-wizard-project.mjs';
import { workspace, write } from './fixture-files.mjs';

async function fixture(t) {
  const root = await workspace(t);
  const project = join(root, 'project');
  const backupParent = join(root, 'backups');
  await mkdir(project);
  await mkdir(backupParent);
  const initialized = spawnSync('git', ['init', '--quiet', project], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  return { root, project, backup: join(backupParent, 'reset') };
}

async function absent(path) {
  try { await lstat(path); return false; }
  catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

test('preview and reset back up project data and only manifest-owned skills', async t => {
  const { project, backup } = await fixture(t);
  await write(join(project, '.specify', 'integrations', 'copilot.manifest.json'), {
    files: { '.github/skills/speckit-plan/SKILL.md': 'hash' },
  });
  await write(join(project, '.specify', 'extensions', '.registry'), {
    extensions: { example: { registered_skills: ['speckit-example'] } },
  });
  await write(join(project, '.specify', 'presets', '.registry'), {
    presets: { sample: { registered_skills: { copilot: ['speckit-preset'] } } },
  });
  await write(join(project, '.specify', 'memory', 'constitution.md'), 'constitution');
  await write(join(project, '.speckit-wizard', 'state.json'), 'wizard state');
  await write(join(project, 'specs', '001-example', 'spec.md'), 'feature spec');
  for (const name of ['speckit-plan', 'speckit-example', 'speckit-preset',
    'speckit-user-custom', 'speckit-designer-preview']) {
    await write(join(project, '.github', 'skills', name, 'SKILL.md'), name);
  }
  await write(join(project, 'source.txt'), 'repository source');
  const added = spawnSync('git', ['-C', project, 'add', '-f', '--',
    'source.txt', '.github/skills/speckit-designer-preview/SKILL.md'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);

  const options = { project, backup };
  const preview = await resetWizardProject(options);
  assert.equal(preview.applied, false);
  assert.equal(await absent(backup), true);
  assert.deepEqual(preview.unregisteredSkills, ['speckit-designer-preview', 'speckit-user-custom']);
  assert.deepEqual(preview.targets.map(target => target.path), [
    '.specify', '.speckit-wizard', 'specs',
    ...['speckit-example', 'speckit-plan', 'speckit-preset'].map(name => join('.github', 'skills', name)),
  ]);
  assert.equal(await readFile(join(project, 'specs', '001-example', 'spec.md'), 'utf8'), 'feature spec');

  const applied = await resetWizardProject({ ...options, apply: true, expect: preview.expect });
  assert.equal(applied.applied, true);
  for (const target of preview.targets) {
    assert.equal(await absent(join(project, target.path)), true);
    assert.equal(await absent(join(backup, target.path)), false);
  }
  assert.equal(await readFile(join(backup, '.specify', 'memory', 'constitution.md'), 'utf8'), 'constitution');
  assert.equal(await readFile(join(backup, '.speckit-wizard', 'state.json'), 'utf8'), 'wizard state');
  assert.equal(await readFile(join(backup, 'specs', '001-example', 'spec.md'), 'utf8'), 'feature spec');
  assert.equal(await readFile(join(project, 'source.txt'), 'utf8'), 'repository source');
  assert.equal(await readFile(join(project, '.github', 'skills', 'speckit-user-custom', 'SKILL.md'), 'utf8'), 'speckit-user-custom');
  assert.equal(await readFile(join(project, '.github', 'skills', 'speckit-designer-preview', 'SKILL.md'), 'utf8'), 'speckit-designer-preview');
  const manifest = JSON.parse(await readFile(join(backup, 'reset-manifest.json'), 'utf8'));
  assert.equal(manifest.project, project);
  assert.equal(manifest.targets.length, preview.targets.length);
});

test('missing or stale preview refuses to move anything', async t => {
  const { project, backup } = await fixture(t);
  await write(join(project, '.speckit-wizard', 'state.json'), 'before');
  const preview = await resetWizardProject({ project, backup });
  await assert.rejects(resetWizardProject({ project, backup, apply: true }), /preview changed or --expect is missing/);
  await write(join(project, '.speckit-wizard', 'state.json'), 'after');
  await assert.rejects(resetWizardProject({ project, backup, apply: true, expect: preview.expect }), /preview changed/);
  assert.equal(await readFile(join(project, '.speckit-wizard', 'state.json'), 'utf8'), 'after');
  assert.equal(await absent(backup), true);
});

test('tracked target files and unsafe registered skill names stop the reset', async t => {
  const first = await fixture(t);
  await write(join(first.project, 'specs', 'tracked.md'), 'tracked');
  const added = spawnSync('git', ['-C', first.project, 'add', '-f', '--', 'specs/tracked.md'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  await assert.rejects(resetWizardProject(first), /Refusing to reset tracked files/);
  assert.equal(await readFile(join(first.project, 'specs', 'tracked.md'), 'utf8'), 'tracked');

  const second = await fixture(t);
  await write(join(second.project, '.specify', 'integrations', 'copilot.manifest.json'), {
    files: { '.github/skills/speckit-tracked/SKILL.md': 'hash' },
  });
  await write(join(second.project, '.github', 'skills', 'speckit-tracked', 'SKILL.md'), 'tracked skill');
  const skillAdded = spawnSync('git', ['-C', second.project, 'add', '-f', '--',
    '.github/skills/speckit-tracked/SKILL.md'], { encoding: 'utf8' });
  assert.equal(skillAdded.status, 0, skillAdded.stderr);
  await assert.rejects(resetWizardProject(second), /Refusing to reset tracked files/);
  assert.equal(await readFile(join(second.project, '.github', 'skills', 'speckit-tracked', 'SKILL.md'), 'utf8'), 'tracked skill');

  const third = await fixture(t);
  await write(join(third.project, '.specify', 'extensions', '.registry'), {
    extensions: { bad: { registered_skills: ['../outside'] } },
  });
  await assert.rejects(resetWizardProject(third), /Invalid registered Spec Kit skill/);
  assert.equal(await absent(third.backup), true);
});

test('a failed move restores earlier paths without deleting the backup', async t => {
  const { project, backup } = await fixture(t);
  await write(join(project, '.specify', 'init-options.json'), 'setup');
  await write(join(project, '.speckit-wizard', 'state.json'), 'state');
  const preview = await resetWizardProject({ project, backup });
  let calls = 0;
  const move = async (from, to) => {
    if (++calls === 2) throw new Error('injected move failure');
    await rename(from, to);
  };
  await assert.rejects(resetWizardProject({ project, backup, apply: true, expect: preview.expect }, { move }),
    /injected move failure; moved paths restored/);
  assert.equal(await readFile(join(project, '.specify', 'init-options.json'), 'utf8'), 'setup');
  assert.equal(await readFile(join(project, '.speckit-wizard', 'state.json'), 'utf8'), 'state');
  assert.equal(await absent(backup), false);
});

test('a linked target is rejected without following it', async t => {
  const { root, project, backup } = await fixture(t);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await write(join(outside, 'keep.txt'), 'untouched');
  try {
    await symlink(outside, join(project, '.specify'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('directory links unavailable');
    throw error;
  }
  await assert.rejects(resetWizardProject({ project, backup }), /symlink|junction/i);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'untouched');
  assert.equal(await absent(backup), true);
});
