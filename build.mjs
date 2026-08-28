/**
 * TubeSift — build script
 *
 * Produces a loadable, store-ready package for each browser:
 *
 *   dist/chrome/   + dist/tubesift-chrome-<version>.zip
 *   dist/firefox/  + dist/tubesift-firefox-<version>.xpi
 *
 * Chrome and Firefox need genuinely different manifests — Chrome wants
 * `background.service_worker`, Firefox wants `background.scripts`, and the
 * declarativeNetRequest permission is spelled differently — so each build
 * copies the shared sources and drops in the right manifest.
 *
 * No dependencies: the ZIP writer below uses only Node's built-in zlib.
 *
 *   node build.mjs            build both
 *   node build.mjs chrome     build one
 *   node build.mjs --no-zip   directories only
 */

import { deflateRawSync } from 'node:zlib';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');

/** Files shipped to every browser, in every package. */
const SHARED_FILES = [
  'common.js',
  'background.js',
  'content.js',
  'content.css',
  'theme.css',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
  'blocked.html',
  'blocked.css',
  'blocked.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'LICENSE',
];

/** Which manifest source belongs to which target. */
const TARGETS = {
  chrome: 'manifest.json',
  firefox: 'manifest.firefox.json',
};

// ══ Minimal ZIP writer ════════════════════════════════════════
//
// Store-ready archives are just deflate-compressed entries plus a central
// directory. Writing it by hand keeps the toolchain at zero dependencies.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Builds a ZIP archive from `[{ name, data }]`.
 * Entry names always use forward slashes, as the spec requires.
 */
function createZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name.split(sep).join('/'), 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // method: deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date (1 Jan 1980)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    locals.push(localHeader, nameBytes, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

// ══ Build ═════════════════════════════════════════════════════

/** Copies one file into the target directory, creating parents as needed. */
async function copyInto(targetDir, relPath, data) {
  const destination = join(targetDir, relPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

/** Fails loudly and early rather than shipping a broken package. */
async function assertSourcesExist() {
  const missing = [];
  for (const file of [...SHARED_FILES, ...Object.values(TARGETS)]) {
    try {
      await stat(join(ROOT, file));
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing source files:\n  ${missing.join('\n  ')}`);
  }
}

/** Verifies the two manifests agree on the version they claim to ship. */
async function readVersion() {
  const versions = new Map();
  for (const [target, manifestFile] of Object.entries(TARGETS)) {
    const manifest = JSON.parse(await readFile(join(ROOT, manifestFile), 'utf8'));
    versions.set(target, manifest.version);
  }
  const unique = new Set(versions.values());
  if (unique.size !== 1) {
    const detail = [...versions].map(([t, v]) => `${t}=${v}`).join(', ');
    throw new Error(`Manifest versions disagree (${detail}). Bump them together.`);
  }
  return [...unique][0];
}

async function buildTarget(target, version, { zip }) {
  const outDir = join(DIST, target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const entries = [];

  for (const file of SHARED_FILES) {
    const data = await readFile(join(ROOT, file));
    await copyInto(outDir, file, data);
    entries.push({ name: file, data });
  }

  // Every package gets its manifest named `manifest.json`, whichever source
  // file it came from.
  const manifest = await readFile(join(ROOT, TARGETS[target]));
  await copyInto(outDir, 'manifest.json', manifest);
  entries.push({ name: 'manifest.json', data: manifest });

  let zipNote = '';
  if (zip) {
    const ext = target === 'firefox' ? 'xpi' : 'zip';
    const zipPath = join(DIST, `tubesift-${target}-${version}.${ext}`);
    await writeFile(zipPath, createZip(entries));
    const { size } = await stat(zipPath);
    zipNote = `  →  ${relative(ROOT, zipPath)} (${(size / 1024).toFixed(1)} KB)`;
  }

  console.log(`  ${target.padEnd(8)} ${entries.length} files${zipNote}`);
}

async function main() {
  const args = process.argv.slice(2);
  const zip = !args.includes('--no-zip');
  const requested = args.filter((a) => !a.startsWith('--'));
  const targets = requested.length > 0 ? requested : Object.keys(TARGETS);

  for (const target of targets) {
    if (!(target in TARGETS)) {
      throw new Error(`Unknown target "${target}". Use: ${Object.keys(TARGETS).join(', ')}`);
    }
  }

  await assertSourcesExist();
  const version = await readVersion();

  console.log(`\nTubeSift v${version}\n`);
  await mkdir(DIST, { recursive: true });

  for (const target of targets) {
    await buildTarget(target, version, { zip });
  }

  console.log('\nLoad unpacked from dist/<browser>/ to test.\n');
}

main().catch((error) => {
  console.error(`\nBuild failed: ${error.message}\n`);
  process.exitCode = 1;
});
