import { describe, expect, it, vi } from 'vitest';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import type { AssetResolver } from '../src/ts/types.js';

const tinyPng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));

function pngWithDimensions(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from(tinyPng);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

describe('per-conversion image embedding state', () => {
  it('does not share caches or counters between sequential and concurrent conversions', async () => {
    const describe = vi.fn(async (decodedRelativePath: string) => ({ id: `same:${decodedRelativePath}`, label: decodedRelativePath, byteLength: tinyPng.byteLength }));
    const read = vi.fn(async () => tinyPng);
    const assets: AssetResolver = { describe, read };
    const request = {
      markdown: '![one](images/a.png)\n\n![two](images/a.png)',
      inputName: 'same.md',
      assets,
    };

    const first = await convertMarkdownToHtml(request);
    const [second, third] = await Promise.all([
      convertMarkdownToHtml(request),
      convertMarkdownToHtml(request),
    ]);

    for (const result of [first, second, third]) {
      expect(result.success).toBe(true);
      expect(result.stats.imageOccurrences).toBe(2);
      expect(result.stats.uniqueAssets).toBe(1);
      expect(result.stats.uniqueSourceAssetBytes).toBe(tinyPng.byteLength);
      expect(result.stats.embeddedPayloadBytes).toBe(2 * Buffer.from(tinyPng).toString('base64').length);
    }
    expect(describe).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('counts an inline data image and inline SVG independently without a resolver', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(tinyPng).toString('base64')}`;
    const result = await convertMarkdownToHtml({
      markdown: `![data](${dataUrl})\n\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><title>dot</title><circle cx="5" cy="5" r="4"/></svg>`,
      inputName: 'inline.md',
    });
    expect(result.success).toBe(true);
    expect(result.stats.imageOccurrences).toBe(2);
    expect(result.stats.uniqueAssets).toBe(2);
    expect(result.stats.embeddedPayloadBytes).toBeGreaterThan(0);
    if (result.success) expect(result.html).toContain('alt="dot"');
  });

  it('deduplicates distinct paths that resolve to one asset id and emits one asset warning', async () => {
    const bytes = pngWithDimensions(5_001, 8_000);
    const describe = vi.fn(async (decodedRelativePath: string) => ({ id: 'same-asset', label: decodedRelativePath, byteLength: bytes.byteLength }));
    const read = vi.fn(async () => bytes);
    const result = await convertMarkdownToHtml({
      markdown: '![one](images/one.png)\n\n![two](images/two.png)',
      inputName: 'dedup.md',
      assets: { describe, read },
    });
    expect(result.success).toBe(true);
    expect(describe).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.stats.uniqueAssets).toBe(1);
    expect(result.stats.embeddedPayloadBytes).toBe(2 * Buffer.from(bytes).toString('base64').length);
    expect(result.diagnostics.filter((item) => item.code === 'W_LARGE_IMAGE_DIMENSIONS')).toHaveLength(1);
  });

  it('accepts exact output caps for local PNG, SVG, and repeated PNG payloads', async () => {
    const svg = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><circle cx="0.5" cy="0.5" r="0.5"/></svg>'));
    async function convert(bytes: Uint8Array, markdown: string) {
      const assets: AssetResolver = {
        async describe(decodedRelativePath) { return { id: decodedRelativePath, label: decodedRelativePath, byteLength: bytes.byteLength }; },
        async read() { return bytes; },
      };
      return convertMarkdownToHtml({ markdown, inputName: 'cap.md', assets });
    }

    for (const [bytes, markdown] of [
      [tinyPng, '![one](one.png)'],
      [svg, '![one](one.svg)'],
      [tinyPng, '![one](one.png)\n\n![two](one.png)'],
    ] as const) {
      const baseline = await convert(bytes, markdown);
      expect(baseline.success).toBe(true);
      if (!baseline.success) continue;
      const exact = await convertMarkdownToHtml({
        markdown,
        inputName: 'cap.md',
        assets: {
          async describe(decodedRelativePath) { return { id: decodedRelativePath, label: decodedRelativePath, byteLength: bytes.byteLength }; },
          async read() { return bytes; },
        },
        options: { maxOutputBytes: baseline.stats.htmlBytes },
      });
      expect(exact.success).toBe(true);
      if (!exact.success) continue;
      expect(exact.stats.htmlBytes).toBe(baseline.stats.htmlBytes);
      const under = await convertMarkdownToHtml({
        markdown,
        inputName: 'cap.md',
        assets: {
          async describe(decodedRelativePath) { return { id: decodedRelativePath, label: decodedRelativePath, byteLength: bytes.byteLength }; },
          async read() { return bytes; },
        },
        options: { maxOutputBytes: baseline.stats.htmlBytes - 1 },
      });
      expect(under.success).toBe(false);
      if (!under.success) expect(under.diagnostics.some((item) => item.code === 'E_OUTPUT_TOO_LARGE')).toBe(true);
    }
  });
});
