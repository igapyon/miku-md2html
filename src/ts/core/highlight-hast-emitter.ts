import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Emitter } from 'highlight.js';

/** Build a HAST token tree directly from Highlight.js scope events. */
export class HighlightHastEmitter implements Emitter {
  readonly root: Root = { type: 'root', children: [] };
  private readonly stack: Array<Root | Element> = [this.root];

  addText(value: string): void {
    if (!value) return;
    const current = this.stack[this.stack.length - 1]!;
    const children = current.children as Array<RootContent | ElementContent>;
    const tail = children[children.length - 1];
    if (tail?.type === 'text') {
      tail.value += value;
    } else {
      children.push({ type: 'text', value });
    }
  }

  startScope(scope: string): void {
    this.openNode(scope);
  }

  openNode(scope: string): void {
    const className = scope.split('.').map((part, index) => index === 0 ? `hljs-${part}` : `${part}${'_'.repeat(index)}`);
    const node: Element = {
      type: 'element',
      tagName: 'span',
      properties: { className },
      children: [],
    };
    const current = this.stack[this.stack.length - 1]!;
    (current.children as Array<RootContent | ElementContent>).push(node);
    this.stack.push(node);
  }

  endScope(): void {
    this.closeNode();
  }

  closeNode(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  __addSublanguage(other: Emitter & { root: Root }, name: string): void {
    const current = this.stack[this.stack.length - 1]!;
    const children = other.root.children as ElementContent[];
    if (name) {
      (current.children as Array<RootContent | ElementContent>).push({
        type: 'element',
        tagName: 'span',
        properties: { className: [name] },
        children,
      });
    } else {
      (current.children as Array<RootContent | ElementContent>).push(...children);
    }
  }

  finalize(): void {
    while (this.stack.length > 1) this.stack.pop();
  }

  toHTML(): string {
    return '';
  }
}
