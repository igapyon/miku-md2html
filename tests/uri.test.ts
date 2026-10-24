import { describe, expect, it } from 'vitest';
import { classifyImageSource } from '../src/ts/assets/uri.js';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';

describe('classifyImageSource', () => {
  it('decodes encoded filename characters exactly once', () => {
    expect(classifyImageSource('images/a%23b.png')).toEqual({ kind: 'local', path: 'images/a#b.png' });
    expect(classifyImageSource('images/a%3Fb.png')).toEqual({ kind: 'local', path: 'images/a?b.png' });
    expect(classifyImageSource('images/a%2523b.png')).toEqual({ kind: 'local', path: 'images/a%23b.png' });
  });

  it('continues to reject raw delimiters and unsafe paths', () => {
    for (const value of [
      'images/a#b.png', 'images/a?b.png', 'images/%00.png', 'images/a%5Cb.png',
      '%2Fetc/passwd', 'C%3A/image.png', '//host/image.png', 'https://example.invalid/image.png', 'images/%GG.png',
    ]) {
      expect(() => classifyImageSource(value), value).toThrow();
    }
  });

  it('passes a decoded question mark to the asset resolver', async () => {
    const bytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));
    const seen: string[] = [];
    const result = await convertMarkdownToHtml({
      markdown: '![question](images/a%3Fb.png)',
      inputName: 'uri.md',
      assets: {
        async describe(decodedRelativePath) {
          seen.push(decodedRelativePath);
          return { id: decodedRelativePath, label: decodedRelativePath, byteLength: bytes.byteLength };
        },
        async read() { return bytes; },
        async reference(path) { return `./${encodeURIComponent(path)}`; },
      },
    });
    expect(result.success).toBe(true);
    expect(seen).toEqual(['images/a?b.png']);
  });
});
