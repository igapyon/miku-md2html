import type { Node } from 'unist';

/** Visit matching syntax-tree nodes in source order without recursive call depth. */
export function visitTree<TNode extends Node>(
  root: Node,
  type: TNode['type'],
  visitor: (node: TNode) => void,
): void {
  const pending: Node[] = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === type) visitor(node as TNode);

    if ('children' in node && Array.isArray(node.children)) {
      const children = node.children as Node[];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) pending.push(child);
      }
    }
  }
}
