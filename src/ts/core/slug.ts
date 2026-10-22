export function headingText(node: { type?: string; value?: string; children?: unknown[] }): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'image') return (node as { alt?: string }).alt ?? '';
  return (node.children ?? []).map((child) => headingText(child as { type?: string; value?: string; children?: unknown[] })).join('');
}

export function slugify(text: string): string {
  return text.normalize('NFC')
    .toLowerCase()
    .replace(/\p{White_Space}+/gu, '-')
    .replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

export function uniqueHeadingIds(slugs: string[]): string[] {
  const used = new Set<string>();
  return slugs.map((slug) => {
    let candidate = `miku-h-${slug}`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `miku-h-${slug}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}
