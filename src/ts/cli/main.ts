import { randomUUID } from 'node:crypto';
import { open, lstat, mkdir, realpath, rename, link, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { convertMarkdownToHtml, productName, version } from '../index.js';
import { NodeAssetResolver } from '../adapters/node-assets.js';
import { addDiagnostic, stableDiagnostics } from '../core/diagnostics.js';
import { AssetAccessError, type ConvertResult, type Diagnostic } from '../types.js';
import { CliUsageError, helpText, parseArgs, type CliOptions } from './args.js';

const MiB = 1_048_576;

type TargetInfo = { path: string; canonicalPath: string; exists: boolean; dev?: number; ino?: number };

function formatDiagnostic(item: Diagnostic): string {
  const where = item.source?.start
    ? `${item.source.label}:${item.source.start.line}:${item.source.start.column}: `
    : item.source?.label ? `${item.source.label}: ` : '';
  return `${item.severity} ${item.code} ${where}${item.message}`;
}

function printDiagnostics(diagnostics: Diagnostic[], stderr: Writable): void {
  for (const diagnostic of stableDiagnostics(diagnostics)) stderr.write(`${formatDiagnostic(diagnostic)}\n`);
}

async function readMarkdown(filePath: string, maxBytes: number): Promise<{ text: string; bytes: number; realPath: string }> {
  let realPath: string;
  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    realPath = await realpath(filePath);
    fileStats = await stat(realPath);
  } catch (error) {
    throw new AssetAccessError('E_INPUT_READ', 'Input Markdown file could not be opened.', { cause: error });
  }
  if (!fileStats.isFile()) throw new AssetAccessError('E_INPUT_READ', 'Input must be a regular file.');
  if (fileStats.size > maxBytes) throw new AssetAccessError('E_INPUT_TOO_LARGE', 'Markdown input exceeds the configured HTML cap.');
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of createReadStream(realPath, { highWaterMark: 64 * 1024 })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.byteLength;
      if (length > maxBytes) throw new AssetAccessError('E_INPUT_TOO_LARGE', 'Markdown input exceeds the configured HTML cap.');
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof AssetAccessError) throw error;
    throw new AssetAccessError('E_INPUT_READ', 'Input Markdown file could not be read.', { cause: error });
  }
  const bytes = Buffer.concat(chunks, length);
  if (bytes.byteLength > maxBytes) throw new AssetAccessError('E_INPUT_TOO_LARGE', 'Markdown input exceeds the configured HTML cap.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AssetAccessError('E_INPUT_ENCODING', 'Input is not valid UTF-8.');
  }
  return { text, bytes: bytes.byteLength, realPath };
}

async function targetInfo(target: string, force: boolean, kind: 'HTML' | 'JSON report'): Promise<TargetInfo> {
  const absolute = path.resolve(target);
  try {
    const details = await lstat(absolute);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new AssetAccessError('E_OUTPUT_COLLISION', `${kind} destination must be a regular file and must not be a symlink.`);
    }
    if (!force) throw new AssetAccessError('E_OUTPUT_EXISTS', `${kind} destination already exists; use --force to replace it.`);
    const parent = await realpath(path.dirname(absolute));
    return { path: absolute, canonicalPath: path.join(parent, path.basename(absolute)), exists: true, dev: details.dev, ino: details.ino };
  } catch (error) {
    if (error instanceof AssetAccessError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AssetAccessError('E_OUTPUT_WRITE', `${kind} destination could not be inspected.`, { cause: error });
    await mkdir(path.dirname(absolute), { recursive: true });
    const parent = await realpath(path.dirname(absolute));
    return { path: absolute, canonicalPath: path.join(parent, path.basename(absolute)), exists: false };
  }
}

function sameFile(left: TargetInfo, right: TargetInfo): boolean {
  if (left.canonicalPath === right.canonicalPath) return true;
  return left.exists && right.exists && left.dev === right.dev && left.ino === right.ino;
}

async function rejectInputCollision(inputRealPath: string, target: TargetInfo): Promise<void> {
  if (path.resolve(inputRealPath) === target.canonicalPath) throw new AssetAccessError('E_OUTPUT_COLLISION', 'Input, HTML, and report paths must be different.');
  if (target.exists) {
    const inputStats = await stat(inputRealPath);
    if (inputStats.dev === target.dev && inputStats.ino === target.ino) throw new AssetAccessError('E_OUTPUT_COLLISION', 'Input, HTML, and report files must not refer to the same inode.');
  }
}

function reportObject(
  options: CliOptions,
  success: boolean,
  exitCode: number,
  inputBytes: number | undefined,
  result: ConvertResult | undefined,
  diagnostics: Diagnostic[],
  outputWritten: boolean,
  outputBytes?: number,
) {
  return {
    schemaVersion: '1',
    tool: { name: productName, version },
    success,
    exitCode,
    input: { path: options.input, ...(inputBytes !== undefined ? { bytes: inputBytes } : {}) },
    output: { path: options.output, written: outputWritten, ...(outputBytes !== undefined ? { bytes: outputBytes } : {}) },
    metadata: result?.metadata ?? { title: options.title ?? 'Untitled', lang: options.lang ?? 'ja' },
    stats: result?.stats ?? { headingCount: 0, imageOccurrences: 0, uniqueAssets: 0, uniqueSourceAssetBytes: 0, embeddedPayloadBytes: 0 },
    diagnostics: stableDiagnostics(diagnostics),
  };
}

async function stageFile(target: string, content: string): Promise<string> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return temporary;
}

async function commitFile(temporary: string, target: string, force: boolean): Promise<void> {
  if (force) {
    await rename(temporary, target);
  } else {
    await link(temporary, target);
    await unlink(temporary).catch(() => undefined);
  }
}

async function cleanup(paths: Array<string | undefined>): Promise<void> {
  await Promise.all(paths.filter((item): item is string => Boolean(item)).map((item) => unlink(item).catch(() => undefined)));
}

function errorDiagnostic(error: unknown): Diagnostic {
  const code = error instanceof AssetAccessError ? error.code : (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : 'Unexpected processing error.';
  return { severity: 'error', code: code ?? 'E_INTERNAL', message };
}

async function writeFailureReport(
  options: CliOptions,
  target: TargetInfo | undefined,
  result: ConvertResult | undefined,
  diagnostics: Diagnostic[],
  inputBytes: number | undefined,
  stderr: Writable,
): Promise<void> {
  if (!options.reportJson || !target) return;
  let temporary: string | undefined;
  try {
    const data = JSON.stringify(reportObject(options, false, 1, inputBytes, result, diagnostics, false), null, 2) + '\n';
    temporary = await stageFile(target.path, data);
    await commitFile(temporary, target.path, options.force);
    temporary = undefined;
  } catch (error) {
    const diagnostic = errorDiagnostic(error);
    stderr.write(`error E_REPORT_WRITE ${diagnostic.message}\n`);
  } finally {
    await cleanup([temporary]);
  }
}

async function runConversion(options: CliOptions, stdout: Writable, stderr: Writable): Promise<number> {
  const diagnostics: Diagnostic[] = [];
  let inputBytes: number | undefined;
  let result: ConvertResult | undefined;
  let outputTarget: TargetInfo | undefined;
  let reportTarget: TargetInfo | undefined;
  let reportCanWrite = false;
  try {
    const maxOutputBytes = options.maxOutputMib * MiB;
    outputTarget = await targetInfo(options.output, options.force, 'HTML');
    if (options.reportJson) reportTarget = await targetInfo(options.reportJson, options.force, 'JSON report');
    const input = await readMarkdown(options.input, maxOutputBytes);
    inputBytes = input.bytes;
    await rejectInputCollision(input.realPath, outputTarget);
    if (reportTarget) await rejectInputCollision(input.realPath, reportTarget);
    if (reportTarget && sameFile(outputTarget, reportTarget)) throw new AssetAccessError('E_OUTPUT_COLLISION', 'HTML and report paths must be different files.');
    reportCanWrite = Boolean(reportTarget);

    let resolver: NodeAssetResolver;
    try {
      resolver = await NodeAssetResolver.create(input.realPath, options.assetRoot);
    } catch (error) {
      throw error instanceof AssetAccessError ? error : new AssetAccessError('E_IMAGE_READ', 'Asset root could not be opened.', { cause: error });
    }
    result = await convertMarkdownToHtml({
      markdown: input.text,
      inputName: path.basename(options.input),
      assets: resolver,
      options: {
        ...(options.title ? { title: options.title } : {}),
        ...(options.lang ? { lang: options.lang } : {}),
        toc: !options.noToc,
        maxOutputBytes,
      },
    });
    diagnostics.push(...result.diagnostics);
    for (const assetPath of resolver.getAssetPaths()) {
      const canonical = await realpath(assetPath).catch((error) => {
        throw new AssetAccessError('E_ASSET_CHANGED', 'A referenced image changed after conversion.', { cause: error });
      });
      if (reportTarget && canonical === reportTarget.canonicalPath) reportCanWrite = false;
      if (canonical === outputTarget.canonicalPath || (reportTarget && canonical === reportTarget.canonicalPath)) {
        throw new AssetAccessError('E_OUTPUT_COLLISION', 'An output path refers to a referenced image asset.');
      }
      const assetStats = await stat(canonical);
      if (outputTarget.exists && assetStats.dev === outputTarget.dev && assetStats.ino === outputTarget.ino) {
        throw new AssetAccessError('E_OUTPUT_COLLISION', 'HTML output refers to a referenced image asset.');
      }
      if (reportTarget?.exists && assetStats.dev === reportTarget.dev && assetStats.ino === reportTarget.ino) {
        reportCanWrite = false;
        throw new AssetAccessError('E_OUTPUT_COLLISION', 'JSON report refers to a referenced image asset.');
      }
    }
    if (!result.success) {
      printDiagnostics(diagnostics, stderr);
      if (reportCanWrite && reportTarget) await writeFailureReport(options, reportTarget, result, diagnostics, inputBytes, stderr);
      return 1;
    }

    let htmlTemp: string | undefined;
    let reportTemp: string | undefined;
    try {
      htmlTemp = await stageFile(outputTarget.path, result.html);
      if (reportTarget) {
        const report = JSON.stringify(reportObject(options, true, 0, inputBytes, result, diagnostics, true, result.stats.htmlBytes), null, 2) + '\n';
        reportTemp = await stageFile(reportTarget.path, report);
      }
      await commitFile(htmlTemp, outputTarget.path, options.force);
      htmlTemp = undefined;
      if (reportTarget && reportTemp) {
        try {
          await commitFile(reportTemp, reportTarget.path, options.force);
          reportTemp = undefined;
        } catch (error) {
          const diagnostic = errorDiagnostic(error);
          stderr.write(`error E_REPORT_WRITE HTML was saved to ${options.output}; the JSON report could not be saved: ${diagnostic.message}\n`);
          printDiagnostics(diagnostics, stderr);
          return 1;
        }
      }
    } finally {
      await cleanup([htmlTemp, reportTemp]);
    }
    printDiagnostics(diagnostics, stderr);
    stdout.write(`Converted ${options.input} -> ${options.output} (${result.stats.htmlBytes} bytes, ${result.stats.headingCount} headings, ${result.stats.imageOccurrences} images).\n`);
    return 0;
  } catch (error) {
    const diagnostic = errorDiagnostic(error);
    diagnostics.push(diagnostic);
    if (['E_INPUT_ENCODING', 'E_INPUT_TOO_LARGE', 'E_INPUT_READ'].includes(diagnostic.code)) {
      diagnostics[diagnostics.length - 1] = { severity: 'error', code: diagnostic.code, message: diagnostic.message, source: { label: options.input } };
    }
    if (diagnostic.code === 'E_INTERNAL') diagnostics[diagnostics.length - 1] = { severity: 'error', code: 'E_INTERNAL', message: 'Unexpected internal error.' };
    printDiagnostics(diagnostics, stderr);
    if (reportCanWrite && reportTarget) await writeFailureReport(options, reportTarget, result, diagnostics, inputBytes, stderr);
    return diagnostic.code === 'E_INTERNAL' ? 3 : 1;
  }
}

export async function runCli(argv: string[], io: { stdout?: Writable; stderr?: Writable } = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof CliUsageError)) {
      stderr.write('error E_INTERNAL Unexpected internal error.\n');
      return 3;
    }
    stderr.write(`error E_USAGE ${error.message}\n${helpText.split('\n').slice(0, 7).join('\n')}\n`);
    return 2;
  }
  if (parsed.mode === 'help') {
    stdout.write(helpText);
    return 0;
  }
  if (parsed.mode === 'version') {
    stdout.write(`${productName} ${version}\n`);
    return 0;
  }
  return runConversion(parsed.options, stdout, stderr);
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) return false;
  try {
    const [entryPath, modulePath] = await Promise.all([
      realpath(process.argv[1]),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return entryPath === modulePath;
  } catch {
    return false;
  }
}

if (await isMainModule()) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.stderr.write('error E_INTERNAL Unexpected internal error.\n');
    process.exitCode = 3;
  });
}
