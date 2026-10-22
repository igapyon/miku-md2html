import { mkdtemp, readFile, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/ts/cli/main.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'miku-md2html-cli-'));
  roots.push(root);
  return root;
}

function capture(): { stream: Writable; text: () => string } {
  let value = '';
  const stream = new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } });
  return { stream, text: () => value };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CLI', () => {
  it('writes the HTML and success report, then protects existing outputs by default', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'guide.md');
    const output = path.join(root, 'out', 'guide.html');
    const report = path.join(root, 'out', 'report.json');
    await writeFile(input, '# Guide\n\nOffline.\n');
    const stdout = capture();
    const stderr = capture();
    const exitCode = await runCli([input, '--out', output, '--report-json', report], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('Converted');
    expect(stderr.text()).toBe('');
    expect(await readFile(output, 'utf8')).toContain('id="miku-h-guide"');
    const reportValue = JSON.parse(await readFile(report, 'utf8'));
    expect(reportValue.schemaVersion).toBe('1');
    expect(reportValue.success).toBe(true);
    expect(reportValue.output.written).toBe(true);
    const original = await readFile(output);
    const second = await runCli([input, '--out', output], { stdout: capture().stream, stderr: capture().stream });
    expect(second).toBe(1);
    expect(await readFile(output)).toEqual(original);
  });

  it('writes a failure report without committing HTML for remote images', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'bad.md');
    const output = path.join(root, 'bad.html');
    const report = path.join(root, 'report.json');
    await writeFile(input, '![remote](https://example.invalid/a.png)');
    const stdout = capture();
    const stderr = capture();
    const code = await runCli([input, '--out', output, '--report-json', report], { stdout: stdout.stream, stderr: stderr.stream });
    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('E_REMOTE_IMAGE');
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    const reportValue = JSON.parse(await readFile(report, 'utf8'));
    expect(reportValue.success).toBe(false);
    expect(reportValue.output.written).toBe(false);
  });

  it('handles usage errors and refuses symlink destinations and input/report collisions', async () => {
    const noArgsOut = capture();
    const noArgsErr = capture();
    expect(await runCli([], { stdout: noArgsOut.stream, stderr: noArgsErr.stream })).toBe(2);
    expect(noArgsOut.text()).toBe('');
    expect(noArgsErr.text()).toContain('E_USAGE');
    const root = await tempRoot();
    const input = path.join(root, 'guide.md');
    const real = path.join(root, 'real.html');
    const outputLink = path.join(root, 'link.html');
    await writeFile(input, '# Guide');
    await writeFile(real, 'keep');
    await symlink(real, outputLink);
    const symlinkErr = capture();
    expect(await runCli([input, '--out', outputLink, '--force'], { stdout: capture().stream, stderr: symlinkErr.stream })).toBe(1);
    expect(symlinkErr.text()).toContain('E_OUTPUT_COLLISION');
    expect((await lstat(outputLink)).isSymbolicLink()).toBe(true);
    const collisionErr = capture();
    expect(await runCli([input, '--out', path.join(root, 'guide.html'), '--report-json', input, '--force'], { stdout: capture().stream, stderr: collisionErr.stream })).toBe(1);
    expect(collisionErr.text()).toContain('E_OUTPUT_COLLISION');
    expect(await readFile(input, 'utf8')).toBe('# Guide');
  });

  it('does not write a failure report over a referenced asset when another image fails', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'guide.md');
    const image = path.join(root, 'image.png');
    const output = path.join(root, 'guide.html');
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64');
    await writeFile(image, imageBytes);
    await writeFile(input, '![local](image.png)\n\n![remote](https://example.invalid/a.png)');
    const stderr = capture();
    const code = await runCli([input, '--out', output, '--report-json', image, '--force'], { stdout: capture().stream, stderr: stderr.stream });
    expect(code).toBe(1);
    expect(stderr.text()).toContain('E_OUTPUT_COLLISION');
    expect(await readFile(image)).toEqual(imageBytes);
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects invalid UTF-8 and an input over the configured byte cap before conversion', async () => {
    const root = await tempRoot();
    const invalid = path.join(root, 'invalid.md');
    const tooLarge = path.join(root, 'large.md');
    await writeFile(invalid, new Uint8Array([0xff, 0xfe]));
    await writeFile(tooLarge, Buffer.alloc(1_048_577, 0x61));
    const invalidErr = capture();
    expect(await runCli([invalid, '--out', path.join(root, 'invalid.html')], { stdout: capture().stream, stderr: invalidErr.stream })).toBe(1);
    expect(invalidErr.text()).toContain('E_INPUT_ENCODING');
    const largeErr = capture();
    expect(await runCli([tooLarge, '--out', path.join(root, 'large.html'), '--max-output-mib', '1'], { stdout: capture().stream, stderr: largeErr.stream })).toBe(1);
    expect(largeErr.text()).toContain('E_INPUT_TOO_LARGE');
  });

  it('writes successful HTML and a report when an oversized highlighted block is skipped', async () => {
    const root = await tempRoot();
    const input = path.join(root, 'large-code.md');
    const output = path.join(root, 'large-code.html');
    const report = path.join(root, 'report.json');
    const code = 'x;'.repeat(131_072);
    await writeFile(input, `\`\`\`javascript\n${code}\n\`\`\`\n`);
    const stdout = capture();
    const stderr = capture();
    const exitCode = await runCli([input, '--out', output, '--report-json', report], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('Converted');
    expect(stderr.text()).toContain('W_CODE_HIGHLIGHT_SKIPPED');
    const html = await readFile(output, 'utf8');
    expect(html).toContain(`<code>${'x;'.repeat(512)}`);
    expect(html).toContain(`${'x;'.repeat(512)}\n</code>`);
    expect(/<pre><code([^>]*)>/.exec(html)?.[1] ?? '').toBe('');
    const reportValue = JSON.parse(await readFile(report, 'utf8'));
    expect(reportValue.success).toBe(true);
    expect(reportValue.diagnostics).toEqual([expect.objectContaining({ code: 'W_CODE_HIGHLIGHT_SKIPPED', severity: 'warning' })]);
  });
});
