import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { repositoryRoot } from './fixture-files.mjs';

test('project development skill frontmatter matches its directory', async () => {
  const names = [
    'dev-tools-speckit-wizard-installed-refresh',
    'dev-tools-speckit-wizard-installed-open',
    'dev-tools-speckit-wizard-local-generate-launch',
    'dev-tools-speckit-wizard-project-reset',
    'dev-tools-speckit-distribution',
  ];
  for (const name of names) {
    const text = await readFile(resolve(repositoryRoot, '.github', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`));
    assert.match(text, /description:.*USE FOR:.*DO NOT USE FOR:/);
    assert.match(text, /argument-hint:/);
  }
});

test('installed Wizard open skill explicitly enables Generate on initial opens and reopens', async () => {
  const text = await readFile(resolve(repositoryRoot, '.github', 'skills',
    'dev-tools-speckit-wizard-installed-open', 'SKILL.md'), 'utf8');
  assert.match(text, /enable Generate on both initial opens and reopens/);
  assert.match(text, /\{ "cwd": "<absolute worktree>", "generateCanvas": true \}/);
  assert.match(text, /explicitly requests Generate disabled/);
  assert.match(text, /"generateCanvas": false/);
  assert.match(text, /featureFlags.generateCanvas` is `true` by default/);
  assert.doesNotMatch(text, /omit `generateCanvas`|Focus-only reopening omits/);
});
