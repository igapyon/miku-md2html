import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  const images = path.join(temporary, 'assets');
  const results = path.join(temporary, 'results');
  await mkdir(images);
  await mkdir(results);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64');
  await writeFile(path.join(images, 'pixel.png'), png);
  const imageInput = path.join(temporary, 'image.md');
  await writeFile(imageInput, '![pixel](assets/pixel.png)\n', 'utf8');

  const referenceHtml = path.join(results, 'reference.html');
  const referenceReport = path.join(results, 'reference.json');
  const referenceRun = await exec(process.execPath, [copiedBinary, imageInput, '--out', referenceHtml, '--asset-root', temporary, '--report-json', referenceReport], { cwd: os.tmpdir(), maxBuffer: 1_000_000 });
  if (referenceRun.stderr || !referenceRun.stdout.includes('Converted')) throw new Error(`Reference-mode CLI smoke failed: ${referenceRun.stderr || referenceRun.stdout}`);
  const referenceText = await readFile(referenceHtml, 'utf8');
  const referenceReportValue = JSON.parse(await readFile(referenceReport, 'utf8'));
  if (!referenceText.includes('src="../assets/pixel.png"') || referenceText.includes('data:image/png;base64,')) throw new Error('CLI reference mode did not keep the original raster path.');
  if (referenceReportValue.schemaVersion !== '2' || referenceReportValue.output.imageMode !== 'reference' || referenceReportValue.stats.referencedImageOccurrences !== 1) throw new Error('CLI reference report is inconsistent.');

  const embeddedHtml = path.join(results, 'embedded.html');
  const embeddedReport = path.join(results, 'embedded.json');
  const embeddedRun = await exec(process.execPath, [copiedBinary, imageInput, '--out', embeddedHtml, '--asset-root', temporary, '--image-mode=embed', '--report-json', embeddedReport], { cwd: os.tmpdir(), maxBuffer: 1_000_000 });
  if (embeddedRun.stderr || !embeddedRun.stdout.includes('Converted')) throw new Error(`Embed-mode CLI smoke failed: ${embeddedRun.stderr || embeddedRun.stdout}`);
  const embeddedText = await readFile(embeddedHtml, 'utf8');
  const embeddedReportValue = JSON.parse(await readFile(embeddedReport, 'utf8'));
  if (!embeddedText.includes(`data:image/png;base64,${png.toString('base64')}`)) throw new Error('CLI embed mode did not include the source image bytes.');
  if (embeddedReportValue.output.imageMode !== 'embed' || embeddedReportValue.stats.embeddedImageOccurrences !== 1) throw new Error('CLI embed report is inconsistent.');

  const missingInput = path.join(temporary, 'missing.md');
  const missingHtml = path.join(results, 'missing.html');
  await writeFile(missingInput, '![later](assets/later.png)\n', 'utf8');
  const missingRun = await exec(process.execPath, [copiedBinary, missingInput, '--out', missingHtml, '--asset-root', temporary], { cwd: os.tmpdir(), maxBuffer: 1_000_000 });
  if (!missingRun.stderr.includes('W_IMAGE_NOT_FOUND') || !missingRun.stdout.includes('Converted')) throw new Error(`Missing-image warning smoke failed: ${missingRun.stderr || missingRun.stdout}`);
  if (!(await readFile(missingHtml, 'utf8')).includes('src="../assets/later.png"')) throw new Error('CLI did not retain a safe missing raster reference.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
process.stdout.write('CLI bundle smoke passed, including reference, embed, and warning-only image handling from a temporary directory.\n');
