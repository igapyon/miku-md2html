import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitOutputFile, defaultOutputFileOperations, rejectInputCollision, sameFile, stageOutputFile, targetInfo } from '../src/ts/cli/output-files.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'miku-md2html-output-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('output file publication helpers', () => {
  it('identifies same destinations and input collisions', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'guide.md');
    const output = path.join(root, 'nested', 'guide.html');
    await writeFile(input, '# Guide');
    const first = await targetInfo(output, false, 'HTML');
    const same = await targetInfo(output, false, 'JSON report');
    expect(sameFile(first, same)).toBe(true);
    await expect(rejectInputCollision(input, await targetInfo(input, true, 'HTML'))).rejects.toMatchObject({ code: 'E_OUTPUT_COLLISION' });
  });

  it('atomically refuses a no-force destination created after staging', async () => {
    const root = await tempRoot();
    const output = path.join(root, 'out.html');
    const temporary = await stageOutputFile(output, '<p>ours</p>', 'HTML');
    await writeFile(output, '<p>theirs</p>');
    await expect(commitOutputFile(temporary, output, false, 'HTML')).rejects.toMatchObject({ code: 'E_OUTPUT_EXISTS' });
    await defaultOutputFileOperations.cleanup([temporary]);
    expect(await readFile(output, 'utf8')).toBe('<p>theirs</p>');
  });
});
