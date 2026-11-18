import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export async function workspace(t) {
  const path = resolve(repositoryRoot, 'tests', 'dev-tools', `.scratch-${randomUUID()}`);
  await mkdir(path);
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

export async function write(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export async function distributionFixture(t) {
  const root = await workspace(t);
  for (const path of [
    ['.github', 'plugin', 'marketplace.json'],
    ['spec-kit-extensions', 'catalog.json'],
    ['spec-kit-presets', 'catalog.json'],
    ['spec-kit-extensions', 'extension-canvas-design', 'extension.yml'],
    ['spec-kit-presets', 'copilot-vertical-phase-control', 'preset.yml'],
  ]) {
    await write(resolve(root, ...path), await readFile(resolve(repositoryRoot, ...path), 'utf8'));
  }
  return root;
}
