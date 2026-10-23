import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, type CliOptions } from '../src/ts/cli/args.js';
import { runFileConversion } from '../src/ts/cli/convert-file.js';
import { defaultOutputFileOperations, type OutputFileOperations } from '../src/ts/cli/output-files.js';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import { AssetAccessError } from '../src/ts/types.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'miku-md2html-failure-'));
  roots.push(root);
  return root;
}

function capture(): { stream: Writable; text: () => string } {
  let value = '';
  const stream = new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } });
  return { stream, text: () => value };
}

function options(input: string, output: string, report?: string, force = false): CliOptions {
  const args = [input, '--out', output, ...(report ? ['--report-json', report] : []), ...(force ? ['--force'] : [])];
  const parsed = parseArgs(args);
  if (parsed.mode !== 'convert') throw new Error('Expected convert options.');
  return parsed.options;
}

function systemError(code: string): NodeJS.ErrnoException {
  const errno = ({ EACCES: -13, EEXIST: -17, ENOSPC: -28 } as Record<string, number>)[code] ?? -5;
  return Object.assign(new Error(`private ${code} detail`), { code, errno, syscall: 'open' });
}

async function run(
  opts: CliOptions,
  dependencies: { convert?: NonNullable<Parameters<typeof runFileConversion>[3]>['convert']; outputFiles?: OutputFileOperations } = {},
) {
  const stdout = capture();
  const stderr = capture();
  const exitCode = await runFileConversion(opts, stdout.stream, stderr.stream, {
    ...(dependencies.convert ? { convert: dependencies.convert } : {}),
    ...(dependencies.outputFiles ? { outputFiles: dependencies.outputFiles } : {}),
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

async function prepareInput(root: string): Promise<string> {
  const input = path.join(root, 'guide.md');
  await writeFile(input, '# Guide\n');
  return input;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CLI failure classification and partial output state', () => {
  it.each([
    ['uncoded internal error', new Error('private token=abc')],
    ['coded internal error', Object.assign(new Error('private token=abc'), { code: 'SECRET_CODE' })],
  ])('reports %s as a generic internal error', async (_name, failure) => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');
    const result = await run(options(input, output, report), {
      convert: async (request) => {
        await convertMarkdownToHtml(request);
        throw failure;
      },
    });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('E_INTERNAL');
    expect(result.stderr).not.toContain('SECRET_CODE');
    expect(result.stderr).not.toContain('token=abc');
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    const reportValue = JSON.parse(await readFile(report, 'utf8'));
    expect(reportValue.exitCode).toBe(3);
    expect(reportValue.success).toBe(false);
    expect(reportValue.diagnostics).toEqual([expect.objectContaining({ code: 'E_INTERNAL', message: 'Unexpected internal error.' })]);
  });

  it('maps HTML stage and commit failures to E_OUTPUT_WRITE and preserves existing bytes', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');
    await writeFile(output, 'preserve this');
    const stageFailure: OutputFileOperations = {
      ...defaultOutputFileOperations,
      async stage(target, content) {
        if (target === output) throw systemError('EACCES');
        return defaultOutputFileOperations.stage(target, content);
      },
    };
    const staged = await run(options(input, output, report, true), { outputFiles: stageFailure });
    expect(staged.exitCode).toBe(1);
    expect(staged.stderr).toContain('E_OUTPUT_WRITE');
    expect(await readFile(output, 'utf8')).toBe('preserve this');
    expect(JSON.parse(await readFile(report, 'utf8')).output.written).toBe(false);

    const commitFailure: OutputFileOperations = {
      ...defaultOutputFileOperations,
      async commit(temporary, target, force) {
        if (target === output) throw systemError('EACCES');
        return defaultOutputFileOperations.commit(temporary, target, force);
      },
    };
    const committed = await run(options(input, output, undefined, true), { outputFiles: commitFailure });
    expect(committed.exitCode).toBe(1);
    expect(committed.stderr).toContain('E_OUTPUT_WRITE');
    expect(await readFile(output, 'utf8')).toBe('preserve this');
    expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('keeps a coded TypeError from an I/O seam classified as an internal error', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');
    const operations: OutputFileOperations = {
      ...defaultOutputFileOperations,
      async commit(temporary, target, force) {
        if (target === output) throw Object.assign(new TypeError('secret filesystem contract failure'), { code: 'EACCES' });
        return defaultOutputFileOperations.commit(temporary, target, force);
      },
    };
    const result = await run(options(input, output, report), { outputFiles: operations });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('E_INTERNAL');
    expect(result.stderr).not.toContain('EACCES');
    expect(result.stderr).not.toContain('secret filesystem');
    expect(JSON.parse(await readFile(report, 'utf8')).exitCode).toBe(3);
  });

  it('preserves a destination created immediately before a no-force commit', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const output = path.join(root, 'out.html');
    let raced = false;
    const operations: OutputFileOperations = {
      ...defaultOutputFileOperations,
      async commit(temporary, target, force) {
        if (target === output && !raced) {
          raced = true;
          await writeFile(output, 'created by another process');
        }
        return defaultOutputFileOperations.commit(temporary, target, force);
      },
    };
    const result = await run(options(input, output), { outputFiles: operations });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_OUTPUT_EXISTS');
    expect(await readFile(output, 'utf8')).toBe('created by another process');
    expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('does not commit HTML when report staging fails', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');
    await writeFile(output, 'existing HTML');
    await writeFile(report, 'existing report');
    let commits = 0;
    const operations: OutputFileOperations = {
      ...defaultOutputFileOperations,
      async stage(target, content) {
        if (target === report) throw systemError('ENOSPC');
        return defaultOutputFileOperations.stage(target, content);
      },
      async commit(temporary, target, force) {
        commits += 1;
        return defaultOutputFileOperations.commit(temporary, target, force);
      },
    };
    const result = await run(options(input, output, report, true), { outputFiles: operations });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_REPORT_WRITE');
    expect(commits).toBe(0);
    expect(await readFile(output, 'utf8')).toBe('existing HTML');
    expect(await readFile(report, 'utf8')).toBe('existing report');
    expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('keeps HTML after report commit failure and emits no success summary', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');
    await writeFile(output, 'old HTML');
    await writeFile(report, 'old report');
    let commits = 0;
    const operations: OutputFileOperations = {
      ...defaultOutputFileOperations,
      async commit(temporary, target, force) {
        commits += 1;
        if (target === report) throw systemError('EACCES');
        return defaultOutputFileOperations.commit(temporary, target, force);
      },
    };
    const result = await run(options(input, output, report, true), { outputFiles: operations });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('E_REPORT_WRITE');
    expect(result.stderr).toContain(`HTML was saved to ${output}`);
    expect(await readFile(output, 'utf8')).toContain('<!doctype html>');
    expect(await readFile(report, 'utf8')).toBe('old report');
    expect(commits).toBe(2);
    expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('preserves the original exit code when a failure report cannot be written', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');
    const stage = vi.fn(async () => { throw systemError('EACCES'); });
    const operations: OutputFileOperations = { ...defaultOutputFileOperations, stage };
    const result = await run(options(input, output, report), {
      convert: async (request) => {
        await convertMarkdownToHtml(request);
        throw new AssetAccessError('E_IMAGE_INVALID', 'Invalid image.');
      },
      outputFiles: operations,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_IMAGE_INVALID');
    expect(result.stderr).toContain('E_REPORT_WRITE');
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it('does not replace a later referenced image when an earlier image disappears during preflight', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const firstImage = path.join(root, 'first.png');
    const reportImage = path.join(root, 'second.png');
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64');
    await writeFile(firstImage, imageBytes);
    await writeFile(reportImage, imageBytes);
    await writeFile(input, '![first](first.png)\n\n![second](second.png)\n');

    const result = await run(options(input, path.join(root, 'out.html'), reportImage, true), {
      convert: async (request) => {
        const converted = await convertMarkdownToHtml(request);
        await unlink(firstImage);
        return converted;
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_ASSET_CHANGED');
    expect(await readFile(reportImage)).toEqual(imageBytes);
  });

  it('does not replace an image when conversion throws after describing it', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const image = path.join(root, 'image.png');
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64');
    await writeFile(image, imageBytes);
    await writeFile(input, '![image](image.png)\n');

    const result = await run(options(input, path.join(root, 'out.html'), image, true), {
      convert: async (request) => {
        if (!request.assets) throw new Error('Expected Node asset resolver.');
        await request.assets.describe('image.png');
        throw new Error('private converter detail');
      },
    });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('E_INTERNAL');
    expect(await readFile(image)).toEqual(imageBytes);
  });

  it('does not create a failure report at a referenced but missing image path', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const missingImage = path.join(root, 'missing.png');
    await writeFile(input, '![missing](missing.png)\n');

    const result = await run(options(input, path.join(root, 'out.html'), missingImage, true));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_IMAGE_NOT_FOUND');
    await expect(readFile(missingImage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes a failure report for invalid UTF-8 after checking input collisions', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'invalid.md');
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');
    await writeFile(input, new Uint8Array([0xff]));

    const result = await run(options(input, output, report));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_INPUT_ENCODING');
    const reportValue = JSON.parse(await readFile(report, 'utf8'));
    expect(reportValue.success).toBe(false);
    expect(reportValue.output.written).toBe(false);
    expect(reportValue.diagnostics).toEqual([expect.objectContaining({ code: 'E_INPUT_ENCODING' })]);
  });

  it('writes a failure report for a missing input when its path does not collide', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'missing.md');
    const output = path.join(root, 'out.html');
    const report = path.join(root, 'report.json');

    const result = await run(options(input, output, report));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_INPUT_READ');
    const reportValue = JSON.parse(await readFile(report, 'utf8'));
    expect(reportValue.success).toBe(false);
    expect(reportValue.output.written).toBe(false);
    expect(reportValue.diagnostics).toEqual([expect.objectContaining({ code: 'E_INPUT_READ' })]);
  });

  it('maps native symlink-loop destination errors to output write errors', async () => {
    const root = await tempRoot();
    const input = await prepareInput(root);
    const loop = path.join(root, 'loop');
    await symlink('loop', loop);

    const result = await run(options(input, path.join(loop, 'out.html')));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E_OUTPUT_WRITE');
    expect(result.stderr).not.toContain('E_INTERNAL');
  });
});
