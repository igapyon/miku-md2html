import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeAssetResolver } from '../src/ts/adapters/node-assets.js';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import { AssetAccessError } from '../src/ts/types.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'miku-md2html-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('NodeAssetResolver', () => {
  it('resolves from the Markdown directory while allowing an explicitly wider root', async () => {
    const root = await tempRoot();
    const docs = path.join(root, 'docs');
    await mkdir(path.join(docs, 'images'), { recursive: true });
    await writeFile(path.join(docs, 'guide.md'), '# guide');
    await writeFile(path.join(docs, 'images', 'x.txt'), 'asset');
    const resolver = await NodeAssetResolver.create(path.join(docs, 'guide.md'), root);
    const info = await resolver.describe('images/x.txt');
    expect(info.label).toBe('docs/images/x.txt');
    expect(Buffer.from(await resolver.read(info.id, 20)).toString()).toBe('asset');
  });

  it('rejects traversal and symlinks that resolve outside the allowed root', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(path.join(outside, 'private.txt'), 'private');
    await writeFile(path.join(root, 'guide.md'), '# guide');
    await symlink(path.join(outside, 'private.txt'), path.join(root, 'link.txt'));
    const resolver = await NodeAssetResolver.create(path.join(root, 'guide.md'));
    await expect(resolver.describe('../private.txt')).rejects.toMatchObject({ code: 'E_ASSET_OUTSIDE_ROOT' });
    await expect(resolver.describe('link.txt')).rejects.toMatchObject({ code: 'E_ASSET_OUTSIDE_ROOT' });
  });

  it('loads a local image whose filename contains an encoded hash', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'guide.md');
    const image = path.join(root, 'a#b.png');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64');
    await writeFile(input, '# Guide');
    await writeFile(image, bytes);
    const resolver = await NodeAssetResolver.create(input);
    const result = await convertMarkdownToHtml({ markdown: '![hash](a%23b.png)', inputName: 'guide.md', assets: resolver });
    expect(result.success).toBe(true);
    expect(resolver.getAssetPaths()).toEqual([await realpath(image)]);
  });
});
