import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestIdentity } from './prepare-distribution.mjs';

export function validatePresetCatalog({ id, version, repository, manifest, catalog }) {
  if (typeof id !== 'string' || !/^copilot-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid preset ID.');
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid preset version.');
  if (typeof repository !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is required.');
  const identity = manifestIdentity(manifest, 'preset');
  const entry = catalog.presets?.[id];
  if (identity.id !== id || identity.version !== version || entry?.id !== id || entry?.version !== version) {
    throw new Error('Preset manifest/catalog ID and version must match the selected release.');
  }
  const expected = `https://github.com/${repository}/releases/download/${id}-v${version}/${id}.zip`;
  if (entry.download_url !== expected) throw new Error(`Catalog download URL must match the release asset: ${expected}`);
  return expected;
}

async function main() {
  const [id, version, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Expected preset ID and version only.');
  if (!/^copilot-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? '')) throw new Error('Invalid preset ID.');
  validatePresetCatalog({
    id, version, repository: process.env.GITHUB_REPOSITORY,
    manifest: await readFile(resolve('spec-kit-presets', id, 'preset.yml'), 'utf8'),
    catalog: JSON.parse(await readFile(resolve('spec-kit-presets', 'catalog.json'), 'utf8')),
  });
  console.log(`Validated preset catalog release target: ${id} v${version}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
