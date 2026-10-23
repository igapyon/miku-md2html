import type { Element, Root } from 'hast';
import type { Diagnostic } from '../types.js';
import { addDiagnostic, sourcePosition } from './diagnostics.js';
import { getSource, plainText } from './hast-utils.js';
import { slugify, uniqueHeadingIds } from './slug.js';
import { visitTree } from './tree.js';

export type Heading = { node: Element; level: number; text: string; slug: string; id: string };

export function collectAndAssignHeadings(root: Root): Heading[] {
  const nodes: Element[] = [];
  visitTree<Element>(root, 'element', (node) => {
    if (/^h[1-6]$/.test(node.tagName)) nodes.push(node);
  });
  const slugs = nodes.map((node) => slugify(plainText(node)));
  const ids = uniqueHeadingIds(slugs);
  return nodes.map((node, index) => {
    const id = ids[index]!;
    node.properties.id = id;
    return { node, level: Number(node.tagName.slice(1)), text: plainText(node), slug: slugs[index]!, id };
  });
}

export function rewriteFragments(root: Root, headings: Heading[], diagnostics: Diagnostic[], lineOffset: number): void {
  const bySlug = new Map<string, string>();
  const ids = new Set<string>(headings.map((heading) => heading.id));
  visitTree<Element>(root, 'element', (node) => {
    if (typeof node.properties.id === 'string' && /^miku-(?:fn|fnref)-/.test(node.properties.id)) ids.add(node.properties.id);
  });
  for (const heading of headings) if (!bySlug.has(heading.slug)) bySlug.set(heading.slug, heading.id);
  visitTree<Element>(root, 'element', (node) => {
    if (node.tagName !== 'a' || typeof node.properties.href !== 'string') return;
    const href = node.properties.href;
    if (!href.startsWith('#')) return;
    let fragment: string;
    try {
      fragment = decodeURIComponent(href.slice(1));
    } catch {
      addDiagnostic(diagnostics, 'warning', 'W_ANCHOR_UNRESOLVED', 'A fragment link has invalid percent encoding.', getSource(node, 'markdown', lineOffset));
      return;
    }
    if (ids.has(fragment) || fragment === 'miku-footnote-label') return;
    const slug = slugify(fragment);
    const target = bySlug.get(slug);
    if (target) node.properties.href = `#${target}`;
    else addDiagnostic(diagnostics, 'warning', 'W_ANCHOR_UNRESOLVED', 'A fragment link does not match a heading or footnote.', getSource(node, 'markdown', lineOffset));
  });
}

