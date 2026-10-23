import type { Element, RootContent } from 'hast';
import type { Diagnostic } from '../types.js';
import { sourcePosition } from './diagnostics.js';

export function plainText(node: RootContent | Element): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' && node.tagName === 'img') return String(node.properties.alt ?? '');
  if ('children' in node) return node.children.map((child) => plainText(child as RootContent)).join('');
  return '';
}

export function getSource(node: Element, label: string, lineOffset: number): Diagnostic['source'] {
  const start = sourcePosition(node.position?.start, lineOffset);
  const end = sourcePosition(node.position?.end, lineOffset);
  return {
    label,
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}
