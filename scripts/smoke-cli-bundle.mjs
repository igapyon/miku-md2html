import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const binary = path.join(root, 'bundle', 'miku-md2html.mjs');
for (const args of [['--version'], ['--help']]) {
  const { stdout, stderr } = await exec(process.execPath, [binary, ...args], { cwd: root, maxBuffer: 1_000_000 });
  if (stderr) throw new Error(`CLI smoke wrote to stderr for ${args[0]}.`);
  if (args[0] === '--version' && stdout.trim() !== `miku-md2html ${version}`) throw new Error(`Unexpected version output: ${stdout.trim()}`);
  if (args[0] === '--help' && (!stdout.includes(`miku-md2html-${version}.mjs`) || !stdout.includes('--max-output-mib'))) throw new Error('CLI help is missing required contract details.');
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'miku-md2html-cli-smoke-'));
try {
  const copiedBinary = path.join(temporary, 'miku-md2html.mjs');
  const input = path.join(temporary, 'input.md');
  const output = path.join(temporary, 'output.html');
  await copyFile(binary, copiedBinary);
  await writeFile(input, '# Portable smoke\n\nNo project tree or adjacent package install.\n', 'utf8');
  const { stdout, stderr } = await exec(process.execPath, [copiedBinary, input, '--out', output], { cwd: os.tmpdir(), maxBuffer: 1_000_000 });
  if (stderr || !stdout.includes('Converted')) throw new Error(`CLI conversion smoke failed: ${stderr || stdout}`);
  const html = await readFile(output, 'utf8');
  if (!html.includes('<h1 id="miku-h-portable-smoke">Portable smoke</h1>')) throw new Error('Copied CLI output is incomplete.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
process.stdout.write('CLI bundle smoke passed, including conversion from a temporary directory.\n');
