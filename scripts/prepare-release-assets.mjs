import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_VERSION ?? packageJson.version;
assert.equal(version, packageJson.version, 'RELEASE_VERSION must exactly match package.json version.');

const bundleDir = path.join(root, 'bundle');
const releaseDir = path.join(root, 'release-assets');
const files = [
  { source: 'miku-md2html.mjs', target: `miku-md2html-${version}.mjs` },
  { source: 'miku-md2html-runtime.mjs', target: `miku-md2html-runtime-${version}.mjs` },
  { source: 'miku-md2html-sources.tgz', target: `miku-md2html-sources-${version}.tgz` },
];

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
for (const file of files) {
  const sourcePath = path.join(bundleDir, file.source);
  assert.ok((await stat(sourcePath)).isFile(), `Bundle artifact is missing: ${file.source}`);
  assert.ok((await stat(sourcePath)).size > 0, `Bundle artifact is empty: ${file.source}`);
  await copyFile(sourcePath, path.join(releaseDir, file.target));
}

const entries = await readdir(releaseDir, { withFileTypes: true });
assert.deepEqual(entries.map((entry) => entry.name).sort(), files.map((file) => file.target).sort());
for (const entry of entries) {
  assert.ok(entry.isFile(), `Release asset must be a regular file: ${entry.name}`);
  assert.ok((await stat(path.join(releaseDir, entry.name))).size > 0, `Release asset must not be empty: ${entry.name}`);
}

process.stdout.write(`Prepared exactly ${files.length} release assets for miku-md2html ${version}.\n`);
