import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'miku-md2html-runtime-smoke-'));
try {
  const copiedRuntime = path.join(temporary, 'miku-md2html-runtime.mjs');
  await copyFile(path.join(root, 'bundle', 'miku-md2html-runtime.mjs'), copiedRuntime);
  const runtime = await import(pathToFileURL(copiedRuntime).href);
  assert.equal(runtime.productName, 'miku-md2html');
  assert.equal(runtime.version, packageVersion);
  assert.equal(typeof runtime.convertMarkdownToHtml, 'function');
  const result = await runtime.convertMarkdownToHtml({ markdown: '# Smoke\n\nOffline.', inputName: 'smoke.md' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.match(result.html, /<h1 id="miku-h-smoke">Smoke<\/h1>/);
    assert.match(result.html, /Content-Security-Policy/);
    assert.equal(result.stats.headingCount, 1);
  }
  process.stdout.write('Runtime bundle smoke passed.\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
