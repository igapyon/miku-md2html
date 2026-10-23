import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { classifyImageSource, type ImageSource } from '../assets/uri.js';
import type { AssetResolver } from '../types.js';

type ReferenceTrackingResolver = AssetResolver & {
  recordReference?: (decodedRelativePath: string) => void;
  completeReferenceScan?: () => void;
};

export function recordLocalImageReferences(tree: Root, assets: AssetResolver | undefined): void {
  if (!assets) return;
  const tracker = assets as ReferenceTrackingResolver;
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'img' || typeof node.properties.src !== 'string') return;
    if (/^data:/i.test(node.properties.src.trim())) return;
    let source: ImageSource;
    try {
      source = classifyImageSource(node.properties.src);
    } catch {
      // Image validation reports malformed and unsupported sources later.
      return;
    }
    if (source.kind === 'local') tracker.recordReference?.(source.path);
  });
  tracker.completeReferenceScan?.();
}

export function completeImageReferenceScan(assets: AssetResolver | undefined): void {
  if (!assets) return;
  (assets as ReferenceTrackingResolver).completeReferenceScan?.();
}
