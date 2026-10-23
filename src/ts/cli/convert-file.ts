import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { convertMarkdownToHtml } from '../core/converter.js';
import { NodeAssetResolver } from '../adapters/node-assets.js';
import { AssetAccessError, type ConvertResult, type Diagnostic } from '../types.js';
import type { CliOptions } from './args.js';
import { inspectMarkdown, readMarkdown } from './markdown-input.js';
import { canonicalPotentialPath } from './path-identity.js';
import {
  commitOutputFile,
  defaultOutputFileOperations,
  type OutputFileOperations,
  rejectInputCollision,
  sameFile,
  stageOutputFile,
  type TargetInfo,
  targetInfo,
} from './output-files.js';
import { errorDiagnostic, printDiagnostics, reportObject } from './reporting.js';

const MiB = 1_048_576;

export type SuccessfulPublication = { state: 'complete' };
export type FailedPublication =
  | { state: 'not-committed'; error: unknown }
  | { state: 'html-committed'; error: unknown };

async function writeFailureReport(
  options: CliOptions,
  target: TargetInfo | undefined,
  result: ConvertResult | undefined,
  diagnostics: Diagnostic[],
  inputBytes: number | undefined,
  exitCode: number,
  stderr: Writable,
  operations: OutputFileOperations,
): Promise<void> {
  if (!options.reportJson || !target) return;
  let temporary: string | undefined;
  try {
    const data = JSON.stringify(reportObject(options, false, exitCode, inputBytes, result, diagnostics, false), null, 2) + '\n';
    temporary = await stageOutputFile(target.path, data, 'JSON report', operations);
    await commitOutputFile(temporary, target.path, options.force, 'JSON report', operations);
    temporary = undefined;
  } catch (error) {
    const diagnostic = errorDiagnostic(error);
    stderr.write(`error E_REPORT_WRITE ${diagnostic.message}\n`);
  } finally {
    await operations.cleanup([temporary]).catch(() => undefined);
  }
}

async function failureReportDoesNotOverwriteAsset(
  resolver: NodeAssetResolver | undefined,
  target: TargetInfo,
): Promise<boolean> {
  if (!resolver) return true;
  if (!resolver.isReferenceScanComplete()) return false;
  if (target.exists && resolver.getAssetIdentities().some((asset) => asset.dev === target.dev && asset.ino === target.ino)) return false;

  for (const assetPath of resolver.getReferencedPaths()) {
    const absolute = path.resolve(assetPath);
    if (absolute === target.canonicalPath) return false;

    let canonical: string;
    try {
      canonical = await canonicalPotentialPath(absolute);
    } catch {
      return false;
    }
    if (canonical === target.canonicalPath) return false;

    try {
      const assetStats = await stat(canonical);
      if (target.exists && assetStats.dev === target.dev && assetStats.ino === target.ino) return false;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return false;
    }
  }
  return true;
}

async function publishSuccessfulOutput(
  options: CliOptions,
  outputTarget: TargetInfo,
  reportTarget: TargetInfo | undefined,
  result: Extract<ConvertResult, { success: true }>,
  diagnostics: Diagnostic[],
  inputBytes: number,
  operations: OutputFileOperations,
): Promise<SuccessfulPublication | FailedPublication> {
  let htmlTemp: string | undefined;
  let reportTemp: string | undefined;
  let state: 'not-committed' | 'html-committed' = 'not-committed';
  try {
    htmlTemp = await stageOutputFile(outputTarget.path, result.html, 'HTML', operations);
    if (reportTarget) {
      const report = JSON.stringify(reportObject(options, true, 0, inputBytes, result, diagnostics, true, result.stats.htmlBytes), null, 2) + '\n';
      reportTemp = await stageOutputFile(reportTarget.path, report, 'JSON report', operations);
    }
    await commitOutputFile(htmlTemp, outputTarget.path, options.force, 'HTML', operations);
    htmlTemp = undefined;
    state = 'html-committed';
    if (reportTarget && reportTemp) {
      await commitOutputFile(reportTemp, reportTarget.path, options.force, 'JSON report', operations);
      reportTemp = undefined;
    }
    return { state: 'complete' };
  } catch (error) {
    if (state === 'html-committed') return { state: 'html-committed', error };
    return { state: 'not-committed', error };
  } finally {
    await operations.cleanup([htmlTemp, reportTemp]).catch(() => undefined);
  }
}

export async function runFileConversion(
  options: CliOptions,
  stdout: Writable,
  stderr: Writable,
  dependencies: { convert?: typeof convertMarkdownToHtml; outputFiles?: OutputFileOperations } = {},
): Promise<number> {
  const diagnostics: Diagnostic[] = [];
  const operations = dependencies.outputFiles ?? defaultOutputFileOperations;
  const convert = dependencies.convert ?? convertMarkdownToHtml;
  let inputBytes: number | undefined;
  let result: ConvertResult | undefined;
  let outputTarget: TargetInfo | undefined;
  let reportTarget: TargetInfo | undefined;
  let reportCanWrite = false;
  let resolver: NodeAssetResolver | undefined;

  try {
    const maxOutputBytes = options.maxOutputMib * MiB;
    outputTarget = await targetInfo(options.output, options.force, 'HTML');
    if (options.reportJson) reportTarget = await targetInfo(options.reportJson, options.force, 'JSON report');
    const inputInfo = await inspectMarkdown(options.input);
    await rejectInputCollision(inputInfo.realPath, outputTarget, inputInfo.exists);
    if (reportTarget) await rejectInputCollision(inputInfo.realPath, reportTarget, inputInfo.exists);
    if (reportTarget && sameFile(outputTarget, reportTarget)) throw new AssetAccessError('E_OUTPUT_COLLISION', 'HTML and report paths must be different files.');
    reportCanWrite = Boolean(reportTarget);
    const input = await readMarkdown(inputInfo, maxOutputBytes);
    inputBytes = input.bytes;

    try {
      resolver = await NodeAssetResolver.create(input.realPath, options.assetRoot);
    } catch (error) {
      throw error instanceof AssetAccessError ? error : new AssetAccessError('E_IMAGE_READ', 'Asset root could not be opened.', { cause: error });
    }
    result = await convert({
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
      let assetStats: Awaited<ReturnType<typeof stat>>;
      try {
        assetStats = await stat(canonical);
      } catch (error) {
        throw new AssetAccessError('E_ASSET_CHANGED', 'A referenced image changed after conversion.', { cause: error });
      }
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
      if (reportCanWrite && reportTarget && await failureReportDoesNotOverwriteAsset(resolver, reportTarget)) {
        await writeFailureReport(options, reportTarget, result, diagnostics, inputBytes, 1, stderr, operations);
      }
      return 1;
    }

    const publication = await publishSuccessfulOutput(options, outputTarget, reportTarget, result, diagnostics, inputBytes, operations);
    if (publication.state === 'html-committed') {
      const diagnostic = errorDiagnostic(publication.error);
      const code = diagnostic.code === 'E_INTERNAL' ? 'E_INTERNAL' : 'E_REPORT_WRITE';
      stderr.write(`error ${code} HTML was saved to ${options.output}; the JSON report could not be saved: ${diagnostic.message}\n`);
      printDiagnostics(diagnostics, stderr);
      return diagnostic.code === 'E_INTERNAL' ? 3 : 1;
    }
    if (publication.state === 'not-committed') {
      const diagnostic = errorDiagnostic(publication.error);
      diagnostics.push(diagnostic);
      printDiagnostics(diagnostics, stderr);
      if (reportCanWrite && reportTarget && diagnostic.code !== 'E_REPORT_WRITE' && await failureReportDoesNotOverwriteAsset(resolver, reportTarget)) {
        const exitCode = diagnostic.code === 'E_INTERNAL' ? 3 : 1;
        await writeFailureReport(options, reportTarget, result, diagnostics, inputBytes, exitCode, stderr, operations);
      }
      return diagnostic.code === 'E_INTERNAL' ? 3 : 1;
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
    printDiagnostics(diagnostics, stderr);
    const exitCode = diagnostic.code === 'E_INTERNAL' ? 3 : 1;
    if (reportCanWrite && reportTarget && diagnostic.code !== 'E_REPORT_WRITE' && await failureReportDoesNotOverwriteAsset(resolver, reportTarget)) {
      await writeFailureReport(options, reportTarget, result, diagnostics, inputBytes, exitCode, stderr, operations);
    }
    return exitCode;
  }
}
