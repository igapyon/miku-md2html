import { parseDocument } from 'yaml';
import { addDiagnostic } from './diagnostics.js';
import type { Diagnostic, FrontMatter } from '../types.js';

const langPattern = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

function normalizedText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function parseFrontMatter(markdown: string, diagnostics: Diagnostic[]): FrontMatter {
  const firstBreak = markdown.indexOf('\n');
  const firstLine = firstBreak === -1 ? markdown : markdown.slice(0, firstBreak);
  if (firstLine !== '---') {
    return { body: markdown, lineOffset: 0, bodyStartOffset: 0 };
  }

  const lines = markdown.split('\n');
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---' || lines[i] === '...') {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex < 0) {
    addDiagnostic(diagnostics, 'error', 'E_FRONT_MATTER', 'Front matter is not closed.', {
      label: 'markdown', start: { line: 1, column: 1 },
    });
    return { body: '', lineOffset: 0, bodyStartOffset: markdown.length };
  }

  const yamlText = lines.slice(1, closingIndex).join('\n');
  const body = lines.slice(closingIndex + 1).join('\n');
  const bodyStartOffset = lines.slice(0, closingIndex + 1).reduce((sum, line, index) =>
    sum + line.length + (index < closingIndex ? 1 : 0), 0) + (closingIndex < lines.length - 1 ? 1 : 0);
  const result: FrontMatter = {
    body,
    lineOffset: closingIndex + 1,
    bodyStartOffset,
  };

  try {
    const document = parseDocument(yamlText, {
      version: '1.2',
      uniqueKeys: true,
      prettyErrors: false,
    });
    if (document.errors.length) {
      throw new Error(document.errors.map((error) => error.message).join('; '));
    }
    const value = document.toJS({ maxAliasCount: 50 }) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The front matter root must be a mapping.');
    }
    const record = value as Record<string, unknown>;
    for (const field of ['title', 'description'] as const) {
      const candidate = record[field];
      if (candidate === undefined) continue;
      if (typeof candidate !== 'string') {
        addDiagnostic(diagnostics, 'warning', 'W_METADATA_TYPE', `Front matter ${field} must be a string; ignoring it.`, {
          label: 'markdown', start: { line: 2, column: 1 },
        }, { field });
      } else {
        const normalized = normalizedText(candidate);
        if (normalized) result[field] = normalized;
      }
    }
    if (record.lang !== undefined) {
      if (typeof record.lang !== 'string' || (record.lang.trim() !== '' && !langPattern.test(record.lang.trim()))) {
        addDiagnostic(diagnostics, 'warning', 'W_METADATA_TYPE', 'Front matter lang is invalid; using the default language.', {
          label: 'markdown', start: { line: 2, column: 1 },
        }, { field: 'lang' });
      } else if (record.lang.trim()) {
        result.lang = record.lang.trim();
      }
    }
  } catch {
    addDiagnostic(diagnostics, 'error', 'E_FRONT_MATTER', 'Invalid YAML front matter, mapping shape, duplicate key, or alias limit.', {
      label: 'markdown', start: { line: 1, column: 1 },
    });
  }
  return result;
}

export function isValidLanguageTag(value: string): boolean {
  return langPattern.test(value);
}
