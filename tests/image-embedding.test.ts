import { describe, expect, it, vi } from 'vitest';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import { AssetAccessError, type AssetResolver } from '../src/ts/types.js';

const tinyPng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));

function pngPaddedTo(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set(tinyPng);
  return bytes;
}

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
      options: { imageMode: 'embed' as const },
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

  it('references local raster images by default and uses the matching CSP policy', async () => {
    const read = vi.fn(async () => tinyPng);
    const result = await convertMarkdownToHtml({
      markdown: '![pixel](images/pixel.png)',
      inputName: 'guide.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: tinyPng.byteLength }; },
        read,
        async reference(path) { return `../docs/${path.split('/').map(encodeURIComponent).join('/')}`; },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.html).toContain('src="../docs/images/pixel.png"');
    expect(result.html).not.toContain('data:image/png;base64,');
    expect(result.html).toContain("img-src data: file: &#39;self&#39;");
    expect(result.stats).toMatchObject({ imageOccurrences: 1, referencedImageOccurrences: 1, embeddedImageOccurrences: 0, omittedImageOccurrences: 0, embeddedPayloadBytes: 0 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps a safe reference to a missing raster with a warning and omits missing SVG', async () => {
    const reference = vi.fn(async (path: string) => `./${path}`);
    const missingRaster = await convertMarkdownToHtml({
      markdown: '![missing](missing.png)',
      inputName: 'missing.md',
      assets: {
        async describe() { throw new AssetAccessError('E_IMAGE_NOT_FOUND', 'missing'); },
        async read() { throw new Error('unexpected read'); },
        reference,
      },
    });
    expect(missingRaster.success).toBe(true);
    if (missingRaster.success) {
      expect(missingRaster.html).toContain('src="./missing.png"');
      expect(missingRaster.diagnostics.map((item) => item.code)).toContain('W_IMAGE_NOT_FOUND');
      expect(missingRaster.stats).toMatchObject({ referencedImageOccurrences: 1, omittedImageOccurrences: 0 });
    }

    reference.mockClear();
    const missingSvg = await convertMarkdownToHtml({
      markdown: '![missing](missing.svg)',
      inputName: 'missing.md',
      assets: {
        async describe() { throw new AssetAccessError('E_IMAGE_NOT_FOUND', 'missing'); },
        async read() { throw new Error('unexpected read'); },
        reference,
      },
    });
    expect(missingSvg.success).toBe(true);
    if (missingSvg.success) {
      expect(missingSvg.html).toContain('<img alt="missing">');
      expect(missingSvg.diagnostics.map((item) => item.code)).toContain('W_IMAGE_NOT_FOUND');
      expect(missingSvg.stats).toMatchObject({ referencedImageOccurrences: 0, omittedImageOccurrences: 1 });
    }
    expect(reference).not.toHaveBeenCalled();
  });

  it('warns on an invalid local raster and retains its safe relative URL', async () => {
    const bytes = new Uint8Array(Buffer.from('not an image'));
    const result = await convertMarkdownToHtml({
      markdown: '![invalid](invalid.png)',
      inputName: 'invalid.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: bytes.byteLength }; },
        async read() { return bytes; },
        async reference() { return './invalid.png'; },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.html).toContain('src="./invalid.png"');
      expect(result.diagnostics.map((item) => item.code)).toContain('W_IMAGE_FORMAT');
      expect(result.stats).toMatchObject({ referencedImageOccurrences: 1, omittedImageOccurrences: 0 });
    }
  });

  it('embeds validated SVG files in reference mode, even with a raster filename', async () => {
    const bytes = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><circle cx="1" cy="1" r="1"/></svg>'));
    const reference = vi.fn(async () => './not-used.svg');
    const result = await convertMarkdownToHtml({
      markdown: '![vector](drawing.png)',
      inputName: 'drawing.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: bytes.byteLength }; },
        async read() { return bytes; },
        reference,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.html).toContain('data:image/svg+xml;base64,');
      expect(result.html).not.toContain('src="./not-used.svg"');
      expect(result.stats).toMatchObject({ embeddedImageOccurrences: 1, referencedImageOccurrences: 0 });
    }
    expect(reference).not.toHaveBeenCalled();
  });

  it('warns and omits an out-of-root reference without reading its contents', async () => {
    const read = vi.fn(async () => tinyPng);
    const reference = vi.fn(async () => './outside.png');
    const result = await convertMarkdownToHtml({
      markdown: '![outside](outside.png)',
      inputName: 'outside.md',
      assets: {
        async describe() { throw new AssetAccessError('E_ASSET_OUTSIDE_ROOT', 'outside'); },
        read,
        reference,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.html).toContain('<img alt="outside">');
      expect(result.diagnostics.map((item) => item.code)).toContain('W_ASSET_OUTSIDE_ROOT');
      expect(result.stats.omittedImageOccurrences).toBe(1);
    }
    expect(read).not.toHaveBeenCalled();
    expect(reference).not.toHaveBeenCalled();
  });

  it('requires a reference callback only after identifying a local raster', async () => {
    const raster = await convertMarkdownToHtml({
      markdown: '![pixel](pixel.png)',
      inputName: 'pixel.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: tinyPng.byteLength }; },
        async read() { return tinyPng; },
      },
    });
    expect(raster.success).toBe(false);
    if (!raster.success) expect(raster.diagnostics.map((item) => item.code)).toContain('E_ASSET_REFERENCE_REQUIRED');

    const svgBytes = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>'));
    const svg = await convertMarkdownToHtml({
      markdown: '![vector](vector.svg)',
      inputName: 'vector.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: svgBytes.byteLength }; },
        async read() { return svgBytes; },
      },
    });
    expect(svg.success).toBe(true);
    if (svg.success) expect(svg.html).toContain('data:image/svg+xml;base64,');
  });

  it('keeps distinct relative URLs when different paths share one resolver asset id', async () => {
    const reference = vi.fn(async (path: string) => `./${path}`);
    const read = vi.fn(async () => tinyPng);
    const result = await convertMarkdownToHtml({
      markdown: '![one](images/one.png)\n\n![two](images/two.png)',
      inputName: 'paths.md',
      assets: {
        async describe(path) { return { id: 'same-file-id', label: path, byteLength: tinyPng.byteLength }; },
        read,
        reference,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.html).toContain('src="./images/one.png"');
      expect(result.html).toContain('src="./images/two.png"');
      expect(result.stats).toMatchObject({ uniqueAssets: 1, referencedImageOccurrences: 2 });
    }
    expect(reference).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('uses bounded header inspection for referenced images over the inspection cap', async () => {
    const prefix = new Uint8Array(256);
    prefix.set(tinyPng.subarray(0, 8));
    const read = vi.fn(async () => { throw new Error('full read must be skipped'); });
    const result = await convertMarkdownToHtml({
      markdown: '![large](large.png)',
      inputName: 'large.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: 100 * 1_048_576 + 1 }; },
        read,
        async readPrefix(_id, maxBytes) { expect(maxBytes).toBe(256); return prefix; },
        async reference() { return './large.png'; },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.html).toContain('src="./large.png"');
      expect(result.diagnostics.map((item) => item.code)).toContain('W_IMAGE_INSPECTION_SKIPPED');
      expect(result.diagnostics.map((item) => item.code)).toContain('W_LARGE_IMAGE');
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('performs full inspection at the 100 MiB boundary and skips it above the boundary', async () => {
    const cap = 100 * 1_048_576;
    const prefix = new Uint8Array(256);
    prefix.set(tinyPng.subarray(0, 8));
    const read = vi.fn(async () => tinyPng);
    const exact = await convertMarkdownToHtml({
      markdown: '![exact](exact.png)',
      inputName: 'cap.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: cap }; },
        read,
        async readPrefix() { return prefix; },
        async reference() { return './exact.png'; },
      },
    });
    expect(exact.success).toBe(true);
    expect(read).toHaveBeenCalledWith('exact.png', cap);
    if (exact.success) expect(exact.diagnostics.map((item) => item.code)).toContain('W_ASSET_CHANGED');
  });

  it('lets a large SVG hint use the HTML read cap when the resolver has no prefix reader', async () => {
    const outputCap = 200 * 1_048_576;
    const svgBytes = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const read = vi.fn(async () => svgBytes);
    const result = await convertMarkdownToHtml({
      markdown: '![diagram](diagram.svg)',
      inputName: 'large-svg.md',
      assets: {
        async describe(path) { return { id: path, label: path, byteLength: 100 * 1_048_576 + 1 }; },
        read,
      },
      options: { maxOutputBytes: outputCap },
    });
    expect(read).toHaveBeenCalledWith('diagram.svg', outputCap);
    expect(result.success).toBe(true);
    if (result.success) expect(result.diagnostics.map((item) => item.code)).toContain('W_ASSET_CHANGED');
  });

  it('warns only above the 5 MiB source image threshold in reference mode', async () => {
    async function convert(byteLength: number) {
      const bytes = pngPaddedTo(byteLength);
      return convertMarkdownToHtml({
        markdown: '![image](large.png)',
        inputName: 'large.md',
        assets: {
          async describe(path) { return { id: path, label: path, byteLength }; },
          async read() { return bytes; },
          async readPrefix(_id, maxBytes) { return bytes.subarray(0, maxBytes); },
          async reference() { return './large.png'; },
        },
      });
    }
    const exact = await convert(5 * 1_048_576);
    const over = await convert(5 * 1_048_576 + 1);
    expect(exact.success).toBe(true);
    expect(exact.diagnostics.some((item) => item.code === 'W_LARGE_IMAGE')).toBe(false);
    expect(over.success).toBe(true);
    expect(over.diagnostics.some((item) => item.code === 'W_LARGE_IMAGE')).toBe(true);
  });

  it('deduplicates distinct paths that resolve to one asset id and emits one asset warning', async () => {
    const bytes = pngWithDimensions(5_001, 8_000);
    const describe = vi.fn(async (decodedRelativePath: string) => ({ id: 'same-asset', label: decodedRelativePath, byteLength: bytes.byteLength }));
    const read = vi.fn(async () => bytes);
    const result = await convertMarkdownToHtml({
      markdown: '![one](images/one.png)\n\n![two](images/two.png)',
      inputName: 'dedup.md',
      assets: { describe, read },
      options: { imageMode: 'embed' },
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
      return convertMarkdownToHtml({ markdown, inputName: 'cap.md', assets, options: { imageMode: 'embed' } });
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
        options: { maxOutputBytes: baseline.stats.htmlBytes, imageMode: 'embed' },
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
        options: { maxOutputBytes: baseline.stats.htmlBytes - 1, imageMode: 'embed' },
      });
      expect(under.success).toBe(false);
      if (!under.success) expect(under.diagnostics.some((item) => item.code === 'E_OUTPUT_TOO_LARGE')).toBe(true);
    }
  });
});
