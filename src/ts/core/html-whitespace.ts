import type { Element, Root, RootContent, Text } from 'hast';

const structuralContainers = new Set([
  'div', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'caption', 'dl', 'dt', 'dd', 'details',
]);
const blockElements = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'dl', 'dt', 'dd', 'details', 'summary',
]);

export function isFormattingWhitespace(node: RootContent): node is Text {
  return node.type === 'text' && /^[ \t\n]*$/.test(node.value);
}

function isBlockBoundary(node: RootContent | undefined): boolean {
  return node === undefined || (node.type === 'element' && blockElements.has(node.tagName));
}

function normalizeRuns(children: RootContent[], root: boolean): RootContent[] {
  const output: RootContent[] = [];
  for (let index = 0; index < children.length;) {
    const first = children[index]!;
    if (!isFormattingWhitespace(first)) {
      output.push(first);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < children.length && isFormattingWhitespace(children[end]!)) end += 1;
    const before = children[index - 1];
    const after = children[end];
    if (isBlockBoundary(before) && isBlockBoundary(after) && (root || before !== undefined || after !== undefined)) {
      const value = children.slice(index, end).map((node) => (node as Text).value).join('');
      const normalized = value.replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');
      if (normalized !== value) {
        output.push({ ...first, value: normalized });
        index = end;
        continue;
      }
    }
    for (; index < end; index += 1) output.push(children[index]!);
  }
  return output;
}

/** Copy for serialization, limiting only whitespace between structural elements. */
export function normalizeStructuralWhitespace(root: Root): Root {
  const output: Root = { ...root, children: [] };
  const pending: Array<{ input: Root | Element; output: Root | Element }> = [{ input: root, output }];
  while (pending.length > 0) {
    const frame = pending.pop()!;
    const children = frame.input.type === 'root' || structuralContainers.has(frame.input.tagName)
      ? normalizeRuns(frame.input.children, frame.input.type === 'root')
      : frame.input.children;
    for (const child of children) {
      if (child.type === 'element' && child.tagName !== 'pre' && child.tagName !== 'code') {
        const copy: Element = { ...child, children: [] };
        (frame.output.children as RootContent[]).push(copy);
        pending.push({ input: child, output: copy });
      } else {
        (frame.output.children as RootContent[]).push(child);
      }
    }
  }
  return output;
}
