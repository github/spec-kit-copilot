import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs, readOptional } from './configuration-files.mjs';

const execFileAsync = promisify(execFile);
const skillName = /^speckit-[a-z0-9][a-z0-9-]*$/;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function optionalStat(path) {
  try { return await lstat(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertDirectories(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing symlink, junction, or non-directory: ${current}`);
    }
    if (dirname(current) === current) break;
  }
}

async function existingDirectory(path) {
  const stat = await optionalStat(path);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Expected a real directory: ${path}`);
  }
  await assertDirectories(path);
  return true;
}

async function readJson(path) {
  const text = await readOptional(path);
  if (text === null) return null;
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`Invalid JSON in ${path}: ${error.message}`); }
}

function addSkill(names, name, source) {
  if (typeof name !== 'string' || !skillName.test(name)) {
    throw new Error(`Invalid registered Spec Kit skill in ${source}: ${String(name)}`);
  }
  names.add(name);
}

async function registeredSkills(project) {
  const names = new Set();
  const manifestPath = join(project, '.specify', 'integrations', 'copilot.manifest.json');
  const manifest = await readJson(manifestPath);
  if (manifest !== null) {
    if (!isRecord(manifest) || !isRecord(manifest.files)) {
      throw new Error(`Invalid Copilot integration manifest: ${manifestPath}`);
    }
    for (const file of Object.keys(manifest.files)) {
      const normalized = file.replaceAll('\\', '/');
      const match = /^\.github\/skills\/([^/]+)\/(.+)$/.exec(normalized);
      if (!match || !match[1].startsWith('speckit-')) continue;
      if (match[2].split('/').some(part => part === '.' || part === '..' || part === '')) {
        throw new Error(`Invalid skill path in ${manifestPath}: ${file}`);
      }
      addSkill(names, match[1], manifestPath);
    }
  }
  for (const group of ['extensions', 'presets']) {
    const registryPath = join(project, '.specify', group, '.registry');
    const registry = await readJson(registryPath);
    if (registry === null) continue;
    if (!isRecord(registry) || !isRecord(registry[group])) {
      throw new Error(`Invalid ${group} registry: ${registryPath}`);
    }
    for (const entry of Object.values(registry[group])) {
      if (!isRecord(entry)) throw new Error(`Invalid ${group} registry entry: ${registryPath}`);
      const registered = entry.registered_skills ?? [];
      const copilot = Array.isArray(registered) ? registered
        : isRecord(registered) ? registered.copilot ?? [] : null;
      if (!Array.isArray(copilot)) throw new Error(`Invalid registered skills: ${registryPath}`);
      for (const name of copilot) addSkill(names, name, registryPath);
    }
  }
  return { names, hasManifest: manifest !== null };
}

async function treeEntries(root) {
  const entries = [];
  async function visit(path, name) {
    const before = await lstat(path);
    if (before.isSymbolicLink()) throw new Error(`Refusing symlink or junction: ${path}`);
    if (before.isDirectory()) {
      entries.push({ name, kind: 'directory' });
      for (const child of (await readdir(path)).sort()) await visit(join(path, child), join(name, child));
      return;
    }
    if (!before.isFile()) throw new Error(`Refusing non-regular file: ${path}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const after = await lstat(path);
    if (!after.isFile() || after.isSymbolicLink() || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error(`File changed during reset preview: ${path}`);
    }
    entries.push({ name, kind: 'file', size: after.size, hash: hash.digest('hex') });
  }
  await visit(root, '.');
  return entries;
}

async function git(project, args) {
  try {
    return (await execFileAsync('git', ['-C', project, ...args], { encoding: 'utf8' })).stdout;
  } catch (error) {
    throw new Error(`Git could not inspect the worktree: ${error.message}`, { cause: error });
  }
}

async function rejectTracked(project, paths) {
  if (!paths.length) return;
  const tracked = await git(project, ['--literal-pathspecs', 'ls-files', '--cached', '-z', '--',
    ...paths.map(path => path.split(sep).join('/'))]);
  if (tracked) throw new Error(`Refusing to reset tracked files: ${tracked.split('\0').filter(Boolean).join(', ')}`);
}

function isWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function planReset(options) {
  if (!isAbsolute(options.project ?? '') || !isAbsolute(options.backup ?? '')) {
    throw new Error('--project and --backup must be absolute paths.');
  }
  const project = resolve(options.project);
  await assertDirectories(project);
  const gitRoot = await realpath((await git(project, ['rev-parse', '--show-toplevel'])).trim());
  const projectReal = await realpath(project);
  const same = process.platform === 'win32'
    ? gitRoot.toLowerCase() === projectReal.toLowerCase() : gitRoot === projectReal;
  if (!same) throw new Error('--project must be the current Git worktree root.');
  const backupInput = resolve(options.backup);
  await assertDirectories(dirname(backupInput));
  const backup = join(await realpath(dirname(backupInput)), basename(backupInput));
  if (isWithin(projectReal, backup)) throw new Error('Backup must be outside the worktree.');
  if (await optionalStat(backup)) throw new Error(`Backup already exists: ${backup}`);

  const { names, hasManifest } = await registeredSkills(projectReal);
  const skillsRoot = join(projectReal, '.github', 'skills');
  const skillsExist = await existingDirectory(skillsRoot);
  const unregisteredSkills = skillsExist
    ? (await readdir(skillsRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && skillName.test(entry.name) && !names.has(entry.name))
      .map(entry => entry.name).sort()
    : [];
  const candidates = ['.specify', '.speckit-wizard', 'specs',
    ...[...names].sort().map(name => join('.github', 'skills', name))];
  const paths = [];
  for (const path of candidates) {
    if (await existingDirectory(join(projectReal, path))) paths.push(path);
  }
  await rejectTracked(projectReal, paths);
  const targets = [];
  for (const path of paths) {
    const entries = await treeEntries(join(projectReal, path));
    targets.push({ path, entries });
  }
  const digest = createHash('sha256').update(JSON.stringify({ project: projectReal, backup, targets })).digest('hex');
  const warnings = [];
  if (paths.includes('.specify') && !hasManifest) {
    warnings.push('Copilot integration manifest is absent; unregistered skills are preserved.');
  }
  return { project: projectReal, backup, targets, unregisteredSkills, warnings, expect: digest };
}

export async function resetWizardProject(options, { move = rename } = {}) {
  const plan = await planReset(options);
  const summary = {
    project: plan.project,
    backup: plan.backup,
    targets: plan.targets.map(({ path, entries }) => ({
      path, files: entries.filter(entry => entry.kind === 'file').length,
    })),
    unregisteredSkills: plan.unregisteredSkills,
    warnings: plan.warnings,
    expect: plan.expect,
    applied: false,
  };
  if (!options.apply) return summary;
  if (options.expect !== plan.expect) {
    throw new Error('Conflict: preview changed or --expect is missing; preview again.');
  }
  if (!plan.targets.length) return { ...summary, applied: true, backup: null };
  await rejectTracked(plan.project, plan.targets.map(target => target.path));
  await mkdir(plan.backup);
  const moved = [];
  try {
    for (const target of plan.targets) {
      const source = join(plan.project, target.path);
      const destination = join(plan.backup, target.path);
      if (JSON.stringify(await treeEntries(source)) !== JSON.stringify(target.entries)) {
        throw new Error(`Conflict: target changed before backup: ${target.path}`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await move(source, destination);
      moved.push(target);
      if (JSON.stringify(await treeEntries(destination)) !== JSON.stringify(target.entries)) {
        throw new Error(`Backup verification failed: ${target.path}`);
      }
    }
    await writeFile(join(plan.backup, 'reset-manifest.json'), `${JSON.stringify({
      project: plan.project, targets: plan.targets, createdAt: new Date().toISOString(),
    }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    const failures = [];
    for (const target of moved.reverse()) {
      const source = join(plan.project, target.path);
      try {
        if (await optionalStat(source)) throw new Error(`Restore destination already exists: ${source}`);
        await move(join(plan.backup, target.path), source);
      } catch (restoreError) { failures.push(restoreError); }
    }
    throw new AggregateError([error, ...failures],
      `${error.message}; ${failures.length ? 'rollback incomplete' : 'moved paths restored'}. Backup: ${plan.backup}`);
  }
  return { ...summary, applied: true };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), ['project', 'backup', 'expect']);
  if (options.help) {
    console.log('node dev-tools\\reset-wizard-project.mjs --project PATH --backup PATH [--apply --expect DIGEST]\nPreview is read-only. Apply moves only identified, untracked project data into the backup.');
    return;
  }
  console.log(JSON.stringify(await resetWizardProject(options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
