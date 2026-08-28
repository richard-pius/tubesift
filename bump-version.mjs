/**
 * TubeSift — Version Bump Script
 *
 * Increments patch/minor/major version synchronously across:
 * - package.json
 * - manifest.json
 * - manifest.firefox.json
 * - README.md (version badge)
 *
 * Usage:
 *   node bump-version.mjs [patch|minor|major]
 *   node bump-version.mjs 2.1.0
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const FILES = {
  packageJson: join(ROOT, 'package.json'),
  manifestJson: join(ROOT, 'manifest.json'),
  manifestFirefoxJson: join(ROOT, 'manifest.firefox.json'),
  readmeMd: join(ROOT, 'README.md'),
};

function bumpSemver(currentVersion, type = 'patch') {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver: ${currentVersion}`);
  }

  let [major, minor, patch] = parts;
  if (type === 'major') {
    major++;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor++;
    patch = 0;
  } else if (type === 'patch') {
    patch++;
  } else if (/^\d+\.\d+\.\d+$/.test(type)) {
    return type;
  } else {
    throw new Error(`Unknown bump type or target version "${type}"`);
  }

  return `${major}.${minor}.${patch}`;
}

async function main() {
  const arg = process.argv[2] || 'patch';
  const pkgRaw = await readFile(FILES.packageJson, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const oldVersion = pkg.version;
  const newVersion = bumpSemver(oldVersion, arg);

  console.log(`Bumping version: ${oldVersion} → ${newVersion}`);

  // 1. package.json
  pkg.version = newVersion;
  await writeFile(FILES.packageJson, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // 2. manifest.json
  const manifest = JSON.parse(await readFile(FILES.manifestJson, 'utf8'));
  manifest.version = newVersion;
  await writeFile(FILES.manifestJson, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // 3. manifest.firefox.json
  const manifestFirefox = JSON.parse(await readFile(FILES.manifestFirefoxJson, 'utf8'));
  manifestFirefox.version = newVersion;
  await writeFile(FILES.manifestFirefoxJson, JSON.stringify(manifestFirefox, null, 2) + '\n', 'utf8');

  // 4. README.md badge
  let readme = await readFile(FILES.readmeMd, 'utf8');
  readme = readme.replace(
    /Version-\d+\.\d+\.\d+-blue/g,
    `Version-${newVersion}-blue`
  ).replace(
    /alt="Version \d+\.\d+\.\d+"/g,
    `alt="Version ${newVersion}"`
  );
  await writeFile(FILES.readmeMd, readme, 'utf8');

  console.log(`Successfully updated all version files to ${newVersion}`);
  // Print version string on stdout so shell/CI scripts can catch it
  process.stdout.write(newVersion);
}

main().catch((err) => {
  console.error(`Version bump failed: ${err.message}`);
  process.exitCode = 1;
});
