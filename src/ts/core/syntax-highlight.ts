import type { Code, Root as MdastRoot } from 'mdast';
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { Element, ElementContent, Root as HastRoot, RootContent } from 'hast';
import type { Position } from 'unist';
import { visit } from 'unist-util-visit';
import { addDiagnostic, sourcePosition } from './diagnostics.js';
import { resolveCodeLanguage, type GrammarId, type LanguageId } from './code-languages.js';
import type { Diagnostic } from '../types.js';

const maxBlockBytes = 256 * 1024;
const maxDocumentBytes = 1024 * 1024;
const lowlight = createLowlight({ bash, css, diff, java, javascript, json, markdown, powershell, python, typescript, xml, yaml });

export type CodeBlockSource = {
  language: LanguageId;
  grammar: GrammarId;
  startOffset: number;
  endOffset: number;
  text: string;
  position: Position | undefined;
};

export type SyntaxTokenizer = (grammar: GrammarId, text: string) => HastRoot;

const tokenize: SyntaxTokenizer = (grammar, text) => lowlight.highlight(grammar, text);

function positionKey(position: Position | undefined): string | undefined {
  const start = position?.start.offset;
  const end = position?.end.offset;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return undefined;
  return `${start}:${end}`;
}

function renderedCodeText(value: string): string {
  return value.length === 0 ? '' : `${value}\n`;
}

export function collectCodeBlockSources(tree: MdastRoot): ReadonlyMap<string, CodeBlockSource> {
  const sources = new Map<string, CodeBlockSource>();
  visit(tree, 'code', (node: Code) => {
    const resolved = resolveCodeLanguage(node.lang);
    const key = positionKey(node.position);
    if (resolved && key && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      sources.set(key, {
        language: resolved.language,
        grammar: resolved.grammar,
        startOffset: node.position.start.offset,
        endOffset: node.position.end.offset,
        text: renderedCodeText(node.value),
        position: node.position,
      });
    }
  });
  return sources;
}

function sourceFor(position: Position | undefined, lineOffset: number): Diagnostic['source'] | undefined {
  if (!position) return undefined;
  const start = sourcePosition(position.start, lineOffset);
  const end = sourcePosition(position.end, lineOffset);
  return {
    label: 'markdown',
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}

function readPlainCode(code: Element): string | undefined {
  let text = '';
  for (const child of code.children) {
    if (child.type !== 'text') return undefined;
    text += child.value;
  }
  return text;
}

const safeClass = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

function rebuildTokenChildren(nodes: RootContent[]): ElementContent[] | undefined {
  const output: ElementContent[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (typeof node.value !== 'string') return undefined;
      output.push({ type: 'text', value: node.value });
      continue;
    }
    if (node.type !== 'element' || node.tagName !== 'span') return undefined;
    const propertyNames = Object.keys(node.properties);
    if (propertyNames.some((key) => key !== 'className')) return undefined;
    const classes = node.properties.className;
    if (!Array.isArray(classes) || classes.length === 0 || classes.some((token) => typeof token !== 'string' || !safeClass.test(token))) return undefined;
    const children = rebuildTokenChildren(node.children as RootContent[]);
    if (!children) return undefined;
    output.push({
      type: 'element',
      tagName: 'span',
      properties: { className: [...classes] },
      children,
    });
  }
  return output;
}

function tokenText(nodes: ElementContent[]): string {
  return nodes.map((node) => {
    if (node.type === 'text') return node.value;
    if (node.type === 'element') return tokenText(node.children);
    return '';
  }).join('');
}

function highlightMatchedCode(
  code: Element,
  source: CodeBlockSource,
  diagnostics: Diagnostic[],
  lineOffset: number,
  state: { consumedBytes: number },
  tokenizer: SyntaxTokenizer,
): void {
  const text = readPlainCode(code);
  const sourcePositionInfo = sourceFor(source.position, lineOffset);
  if (text === undefined || text !== source.text) {
    addDiagnostic(diagnostics, 'warning', 'W_CODE_HIGHLIGHT_FAILED', 'Syntax highlighting was skipped because the code block could not be verified.', sourcePositionInfo, { language: source.language });
    return;
  }
  if (text.length === 0) return;

  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBlockBytes) {
    addDiagnostic(diagnostics, 'warning', 'W_CODE_HIGHLIGHT_SKIPPED', 'Syntax highlighting was skipped because the code block exceeds the block size limit.', sourcePositionInfo, { reason: 'block-size', bytes, limit: maxBlockBytes });
    return;
  }
  if (state.consumedBytes + bytes > maxDocumentBytes) {
    addDiagnostic(diagnostics, 'warning', 'W_CODE_HIGHLIGHT_SKIPPED', 'Syntax highlighting was skipped because the document highlighting budget is exhausted.', sourcePositionInfo, { reason: 'document-budget', bytes, limit: maxDocumentBytes });
    return;
  }
  state.consumedBytes += bytes;

  try {
    const result = tokenizer(source.grammar, text);
    const children = rebuildTokenChildren(result.children);
    if (!children || tokenText(children) !== text) {
      addDiagnostic(diagnostics, 'warning', 'W_CODE_HIGHLIGHT_FAILED', 'Syntax highlighting was skipped because the token output could not be verified.', sourcePositionInfo, { language: source.language });
      return;
    }
    code.children = children;
    code.properties = {
      ...code.properties,
      className: ['miku-md2html-highlight', `language-${source.language}`],
    };
  } catch {
    addDiagnostic(diagnostics, 'warning', 'W_CODE_HIGHLIGHT_FAILED', 'Syntax highlighting failed; plain code is shown.', sourcePositionInfo, { language: source.language });
  }
}

export function applySyntaxHighlighting(
  tree: HastRoot,
  sources: ReadonlyMap<string, CodeBlockSource>,
  diagnostics: Diagnostic[],
  lineOffset: number,
  tokenizer: SyntaxTokenizer = tokenize,
): void {
  const state = { consumedBytes: 0 };
  function walk(nodes: RootContent[]): void {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (node.tagName === 'pre') {
        for (const child of node.children) {
          if (child.type !== 'element' || child.tagName !== 'code') continue;
          const key = positionKey(child.position);
          const source = key ? sources.get(key) : undefined;
          if (source) highlightMatchedCode(child, source, diagnostics, lineOffset, state, tokenizer);
        }
      } else {
        walk(node.children as RootContent[]);
      }
    }
  }
  walk(tree.children);
}
