import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_VERSION ?? packageJson.version;
assert.equal(version, packageJson.version, 'RELEASE_VERSION must exactly match package.json version.');

const releaseDir = path.join(root, 'release-assets');
const cliAsset = `miku-md2html-${version}.mjs`;
const runtimeAsset = `miku-md2html-runtime-${version}.mjs`;
const sourceAsset = `miku-md2html-sources-${version}.tgz`;
const expectedFiles = [cliAsset, runtimeAsset, sourceAsset].sort();
const entries = await readdir(releaseDir, { withFileTypes: true });
assert.deepEqual(entries.map((entry) => entry.name).sort(), expectedFiles, 'Release staging must contain exactly the declared assets.');
for (const entry of entries) {
  assert.ok(entry.isFile(), `Release asset must be a regular file: ${entry.name}`);
  assert.ok((await stat(path.join(releaseDir, entry.name))).size > 0, `Release asset must not be empty: ${entry.name}`);
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'miku-md2html-release-smoke-'));
try {
  const copiedCli = path.join(temporary, cliAsset);
  const input = path.join(temporary, 'input.md');
  const output = path.join(temporary, 'output.html');
  await copyFile(path.join(releaseDir, cliAsset), copiedCli);

  for (const args of [['--version'], ['--help']]) {
    const { stdout, stderr } = await exec(process.execPath, [copiedCli, ...args], { cwd: temporary, maxBuffer: 1_000_000 });
    assert.equal(stderr, '', `Staged CLI wrote to stderr for ${args[0]}.`);
    if (args[0] === '--version') assert.equal(stdout.trim(), `miku-md2html ${version}`);
    if (args[0] === '--help') assert.ok(stdout.includes(`miku-md2html-${version}.mjs`));
  }

  await writeFile(input, '# Staged release smoke\n\nStandalone CLI.\n', 'utf8');
  const cliResult = await exec(process.execPath, [copiedCli, input, '--out', output], { cwd: temporary, maxBuffer: 1_000_000 });
  assert.equal(cliResult.stderr, '');
  assert.ok(cliResult.stdout.includes('Converted'));
  assert.match(await readFile(output, 'utf8'), /<h1 id="miku-h-staged-release-smoke">Staged release smoke<\/h1>/);

  const copiedRuntime = path.join(temporary, runtimeAsset);
  await copyFile(path.join(releaseDir, runtimeAsset), copiedRuntime);
  const runtime = await import(pathToFileURL(copiedRuntime).href);
  assert.equal(runtime.productName, 'miku-md2html');
  assert.equal(runtime.version, version);
  assert.equal(typeof runtime.convertMarkdownToHtml, 'function');
  const conversion = await runtime.convertMarkdownToHtml({ markdown: '# Runtime smoke', inputName: 'smoke.md' });
  assert.equal(conversion.success, true);
  if (conversion.success) assert.match(conversion.html, /<h1 id="miku-h-runtime-smoke">Runtime smoke<\/h1>/);

  const { stdout: sourceEntries } = await exec('tar', ['-tzf', path.join(releaseDir, sourceAsset)], { maxBuffer: 1_000_000 });
  const sourceFiles = new Set(sourceEntries.split(/\r?\n/).filter(Boolean));
  for (const required of [
    'README.md', 'package.json', 'src/ts/index.ts',
    'src/ts/core/article-sanitizer.ts', 'src/ts/core/document-structure.ts', 'src/ts/core/hast-utils.ts',
    'src/ts/core/html-document.ts', 'src/ts/core/image-embedding.ts',
    'src/ts/cli/convert-file.ts', 'src/ts/cli/markdown-input.ts', 'src/ts/cli/output-files.ts', 'src/ts/cli/reporting.ts',
  ]) {
    assert.ok(sourceFiles.has(required), `Source archive is missing ${required}.`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(`Release asset smoke passed for miku-md2html ${version}.\n`);
