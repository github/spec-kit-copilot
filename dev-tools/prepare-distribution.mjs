import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChanges, fingerprint, parseArgs, patchJson, preview, readOptional } from './configuration-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const targets = [
  { directory: 'spec-kit-extensions', group: 'extensions', id: 'extension-canvas-design', manifest: 'extension.yml', section: 'extension' },
  { directory: 'spec-kit-presets', group: 'presets', id: 'copilot-vertical-phase-control', manifest: 'preset.yml', section: 'preset' },
];

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) {
    throw new Error(`Invalid ${label}; expected only ${keys.join(', ')}.`);
  }
}

export function validateDistribution(value) {
  exactObject(value, ['repository', 'catalogRef', 'copilotCatalogName', 'marketplace'], 'distribution settings');
  if (typeof value.copilotCatalogName !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.copilotCatalogName)) {
    throw new Error('Invalid Copilot catalog name.');
  }
  if (typeof value.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.repository) ||
      value.repository.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid GitHub repository.');
  if (typeof value.catalogRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.catalogRef) ||
      value.catalogRef.includes('..') || value.catalogRef.includes('//') || /[/.]$/.test(value.catalogRef) ||
      value.catalogRef.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) throw new Error('Invalid catalog ref.');
  exactObject(value.marketplace, ['name', 'ownerName', 'description'], 'marketplace settings');
  if (typeof value.marketplace.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.marketplace.name)) throw new Error('Invalid marketplace name.');
  for (const field of ['ownerName', 'description']) {
    if (typeof value.marketplace[field] !== 'string' || !value.marketplace[field].trim() || /[\r\n\x00-\x1f]/.test(value.marketplace[field])) throw new Error(`Invalid marketplace ${field}.`);
  }
  return value;
}

async function required(path) {
  const text = await readOptional(path);
  if (text === null) throw new Error(`Required file is unavailable: ${path}`);
  return text;
}

// Only read identity/version from canonical manifests; never rewrite YAML.
export function manifestIdentity(text, section) {
  if ([...text.matchAll(new RegExp(`^${section}:`, 'gm'))].length !== 1) {
    throw new Error(`Manifest must declare one top-level ${section} section.`);
  }
  const block = text.match(new RegExp(`^${section}:\\s*\\r?\\n((?:[ \\t]+[^\\n]*\\n|\\r?\\n)*)`, 'm'))?.[1];
  const scalar = name => {
    const matches = [...(block ?? '').matchAll(new RegExp(`^  ${name}:\\s*(?:"([^"]+)"|'([^']+)'|([^\\s#]+))\\s*(?:#.*)?$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Manifest must declare one ${section}.${name}.`);
    return matches[0][1] ?? matches[0][2] ?? matches[0][3];
  };
  const id = scalar('id');
  const version = scalar('version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Manifest version must be a release semver.');
  return { id, version };
}

export async function prepareDistribution(config, options = {}, { repositoryRoot = root } = {}) {
  validateDistribution(config);
  const changes = [];
  const marketplacePath = resolve(repositoryRoot, '.github', 'plugin', 'marketplace.json');
  const original = await required(marketplacePath);
  const marketplace = JSON.parse(original);
  if (!Array.isArray(marketplace.plugins) || !marketplace.owner || !marketplace.metadata) throw new Error('Invalid existing marketplace.');
  changes.push({ path: marketplacePath, before: original, after: patchJson(original, [
    [['name'], config.marketplace.name],
    [['owner', 'name'], config.marketplace.ownerName],
    [['metadata', 'description'], config.marketplace.description],
  ]) });
  const repository = `https://github.com/${config.repository}`;
  const raw = `https://raw.githubusercontent.com/${config.repository}/${config.catalogRef}`;
  const locators = { repository, marketplace: `${repository}.git#${config.catalogRef}`, documentation: `${repository}/blob/${config.catalogRef}/README.md`, catalogs: {} };
  for (const target of targets) {
    const path = resolve(repositoryRoot, target.directory, 'catalog.json');
    const before = await required(path);
    const catalog = JSON.parse(before);
    const entry = catalog[target.group]?.[target.id];
    if (!entry || entry.id !== target.id) throw new Error(`Missing or incompatible catalog entry: ${target.id}`);
    const identity = manifestIdentity(await required(resolve(repositoryRoot, target.directory, target.id, target.manifest)), target.section);
    if (identity.id !== target.id || identity.version !== entry.version) throw new Error(`Manifest/catalog identity or version conflict: ${target.id}`);
    const catalogUrl = `${raw}/${target.directory}/catalog.json`;
    const metadata = {
      repository,
      homepage: repository,
      documentation: `${repository}/blob/${config.catalogRef}/${target.directory}/${target.id}/README.md`,
      download_url: `${repository}/releases/download/${target.id}-v${identity.version}/${target.id}.zip`,
    };
    changes.push({ path, before, after: patchJson(before, [
      [['catalog_url'], catalogUrl],
      ...Object.entries(metadata).map(([field, next]) => [[target.group, target.id, field], next]),
    ]) });
    locators.catalogs[target.group] = catalogUrl;
  }
  const result = {
    preview: preview(changes), expect: fingerprint(changes),
    changed: changes.some(change => change.before !== change.after), applied: Boolean(options.apply),
    locators,
    commands: [
      `copilot plugin marketplace add "${locators.marketplace}"`,
      `copilot plugin marketplace update ${config.marketplace.name}`,
      `copilot plugin install spec-kit-copilot-wizard@${config.marketplace.name}`,
      `copilot plugin install spec-kit-copilot@${config.marketplace.name}`,
      `specify extension catalog add ${locators.catalogs.extensions} --name ${config.copilotCatalogName} --install-allowed`,
      `specify preset catalog add ${locators.catalogs.presets} --name ${config.copilotCatalogName} --install-allowed`,
    ],
    notice: 'Only local marketplace and two catalog entries are prepared. Versions, requirements, unrelated packages and workflows are unchanged. Commands are NOT executed; commit, push, tags, releases and documentation updates are separate authorized operations.',
  };
  if (options.apply) result.backups = await applyChanges(changes, options.expect);
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2), ['config', 'expect']);
  if (options.help) {
    console.log('node dev-tools/prepare-distribution.mjs --config JSON [--apply --expect DIGEST]\nPreview is the default; apply requires the matching preview digest. No publish or version side effects.');
    return;
  }
  if (!options.config) throw new Error('--config is required; select an upstream, fork, or custom JSON file explicitly.');
  const config = JSON.parse(await required(resolve(options.config)));
  console.log(JSON.stringify(await prepareDistribution(config, options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
