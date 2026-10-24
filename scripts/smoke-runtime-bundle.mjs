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

  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));
  const assets = {
    async describe(path) { return { id: path, label: path, byteLength: png.byteLength }; },
    async read() { return png; },
    async reference() { return '../assets/pixel.png'; },
  };
  const referenced = await runtime.convertMarkdownToHtml({ markdown: '![pixel](assets/pixel.png)', inputName: 'image.md', assets });
  assert.equal(referenced.success, true);
  if (referenced.success) {
    assert.match(referenced.html, /src="\.\.\/assets\/pixel\.png"/);
    assert.doesNotMatch(referenced.html, /data:image\/png;base64,/);
    assert.equal(referenced.stats.referencedImageOccurrences, 1);
  }
  const embedded = await runtime.convertMarkdownToHtml({ markdown: '![pixel](assets/pixel.png)', inputName: 'image.md', assets, options: { imageMode: 'embed' } });
  assert.equal(embedded.success, true);
  if (embedded.success) {
    assert.match(embedded.html, /data:image\/png;base64,/);
    assert.equal(embedded.stats.embeddedImageOccurrences, 1);
  }
  process.stdout.write('Runtime bundle smoke passed.\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
