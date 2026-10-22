import type { Diagnostic, SourcePosition } from '../types.js';

export function stableDiagnostics(items: Diagnostic[]): Diagnostic[] {
  return [...items].sort((a, b) => {
    const left = a.source?.start;
    const right = b.source?.start;
    if (left && right) {
      if (left.line !== right.line) return left.line - right.line;
      if (left.column !== right.column) return left.column - right.column;
    } else if (left || right) {
      return left ? -1 : 1;
    }
    return compareUtf16(a.code, b.code);
  });
}

export function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sourcePosition(position: SourcePosition | undefined, lineOffset: number): SourcePosition | undefined {
  if (!position) return undefined;
  return { line: position.line + lineOffset, column: position.column };
}

export function addDiagnostic(
  diagnostics: Diagnostic[],
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  source?: Diagnostic['source'],
  details?: Diagnostic['details'],
): void {
  diagnostics.push({
    severity,
    code,
    message,
    ...(source ? { source } : {}),
    ...(details ? { details } : {}),
  });
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error');
}
