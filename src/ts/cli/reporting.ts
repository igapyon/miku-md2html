import type { Writable } from 'node:stream';
import { productName, version } from '../index.js';
import { AssetAccessError, type ConvertResult, type Diagnostic } from '../types.js';
import { stableDiagnostics } from '../core/diagnostics.js';
import type { CliOptions } from './args.js';

export function formatDiagnostic(item: Diagnostic): string {
  const where = item.source?.start
    ? `${item.source.label}:${item.source.start.line}:${item.source.start.column}: `
    : item.source?.label ? `${item.source.label}: ` : '';
  return `${item.severity} ${item.code} ${where}${item.message}`;
}

export function printDiagnostics(diagnostics: Diagnostic[], stderr: Writable): void {
  for (const diagnostic of stableDiagnostics(diagnostics)) stderr.write(`${formatDiagnostic(diagnostic)}\n`);
}

export function errorDiagnostic(error: unknown): Diagnostic {
  if (error instanceof AssetAccessError) return { severity: 'error', code: error.code, message: error.message };
  return { severity: 'error', code: 'E_INTERNAL', message: 'Unexpected internal error.' };
}

export function reportObject(
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
