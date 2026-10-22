import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import { AssetAccessError, type AssetResolver } from '../src/ts/types.js';

const tinyPng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));

describe('convertMarkdownToHtml', () => {
  it('builds a deterministic standalone HTML document and derives heading ids and metadata', async () => {
    const markdown = `---
title: Front title
description: Guide description
lang: ja-JP
---
# 設計 メモ
## Same
## Same
# Foo
# Foo
# Foo-2
[jump](#設計%20メモ)
`;
    const request = { markdown, inputName: 'sample.md' };
    const first = await convertMarkdownToHtml(request);
    const second = await convertMarkdownToHtml(request);
    expect(first.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(first.html).toBe(second.html);
    expect(first.html).toContain('<!doctype html>');
    expect(first.html).toContain('<html lang="ja-JP">');
    expect(first.html).toContain('<title>Front title</title>');
    expect(first.html).toContain('<meta name="description" content="Guide description">');
    expect(first.html).toContain('id="miku-h-設計-メモ"');
    expect(first.html).toContain('id="miku-h-same-2"');
    expect(first.html).toContain('id="miku-h-foo-2-2"');
    expect(first.html).toContain('href="#miku-h-設計-メモ"');
    expect(first.html).toContain('miku-md2html-toc');
    expect(first.html).not.toContain('<script src=');
    expect(first.html).not.toContain('<link rel=');
    const script = /<script>([\s\S]*?)<\/script>/.exec(first.html)?.[1];
    expect(script).toBeTruthy();
    const hash = createHash('sha256').update(script!, 'utf8').digest('base64');
    expect(first.html).toContain(`sha256-${hash}`);
    expect(first.stats.headingCount).toBe(6);
  });

  it('renders GFM footnotes and sanitizes active raw HTML', async () => {
    const markdown = `# Safe

- [x] done

| left | center |
| :--- | :---: |
| a | b |

Note[^n].

[^n]: Footnote body.

<div id="clobber" class="author" onclick="evil()">kept</div>
<script>evil()</script>
<a href="javascript:alert(1)">unsafe link</a>
`;
    const result = await convertMarkdownToHtml({ markdown, inputName: 'safe.md' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).toContain('disabled');
    expect(result.html).toContain('<table>');
    expect(result.html).toContain('id="miku-fn-n"');
    expect(result.html).toContain('href="#miku-fn-n"');
    expect(result.html).toContain('href="#miku-fnref-n"');
    expect(result.diagnostics.some((item) => item.code === 'W_ANCHOR_UNRESOLVED')).toBe(false);
    expect(result.html).toContain('>kept</div>');
    expect(result.html).not.toContain('id="clobber"');
    expect(result.html).not.toContain('onclick=');
    expect(result.html).not.toContain('class="author"');
    expect(result.html).not.toContain('evil()');
    expect(result.html).toContain('unsafe link');
    expect(result.diagnostics.some((item) => item.code === 'W_HTML_SANITIZED')).toBe(true);
    expect(result.diagnostics.some((item) => item.code === 'W_LINK_REMOVED')).toBe(true);
  });

  it('embeds images with original bytes and counts repeated payloads by occurrence', async () => {
    const describe = vi.fn(async (decodedRelativePath: string) => ({ id: `asset:${decodedRelativePath}`, label: decodedRelativePath, byteLength: tinyPng.byteLength }));
    const read = vi.fn(async () => tinyPng);
    const assets: AssetResolver = { describe, read };
    const result = await convertMarkdownToHtml({
      markdown: '![one](images/tiny.png)\n\n![two](images/tiny.png)',
      inputName: 'images.md',
      assets,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.html.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(result.html).toContain(Buffer.from(tinyPng).toString('base64'));
    expect(describe).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.stats.imageOccurrences).toBe(2);
    expect(result.stats.uniqueAssets).toBe(1);
    expect(result.stats.uniqueSourceAssetBytes).toBe(tinyPng.byteLength);
    expect(result.stats.embeddedPayloadBytes).toBe(2 * Buffer.from(tinyPng).toString('base64').length);
  });

  it('rejects remote images and requires a resolver for local images', async () => {
    const remote = await convertMarkdownToHtml({ markdown: '![remote](https://example.invalid/a.png)', inputName: 'a.md' });
    expect(remote.success).toBe(false);
    if (!remote.success) expect(remote.diagnostics[0]?.code).toBe('E_REMOTE_IMAGE');
    const local = await convertMarkdownToHtml({ markdown: '![local](a.png)', inputName: 'a.md' });
    expect(local.success).toBe(false);
    if (!local.success) expect(local.diagnostics[0]?.code).toBe('E_ASSET_RESOLVER_REQUIRED');
  });

  it('accepts a safe SVG style element and rejects escaped external CSS URLs', async () => {
    const safe = await convertMarkdownToHtml({
      markdown: '<svg xmlns="http://www.w3.org/2000/svg"><style>circle { fill: #147; }</style><circle cx="4" cy="4" r="3"/></svg>',
      inputName: 'styled.md',
    });
    expect(safe.success).toBe(true);
    const unsafe = await convertMarkdownToHtml({
      markdown: '<svg xmlns="http://www.w3.org/2000/svg"><style>rect { fill: u\\72l(https://example.invalid/a.svg#x); }</style><rect/></svg>',
      inputName: 'unsafe.md',
    });
    expect(unsafe.success).toBe(false);
    if (!unsafe.success) expect(unsafe.diagnostics.some((item) => ['E_SVG_EXTERNAL_RESOURCE', 'E_SVG_UNSUPPORTED'].includes(item.code))).toBe(true);
  });

  it('honors no-TOC, title escaping, front matter errors, and the exact output byte boundary', async () => {
    const base = await convertMarkdownToHtml({ markdown: '# Heading', inputName: 'boundary.md', options: { toc: false } });
    expect(base.success).toBe(true);
    if (!base.success) return;
    expect(base.html).not.toContain('class="miku-md2html-toc"');
    expect(base.html).toContain('id="miku-h-heading"');
    const exact = await convertMarkdownToHtml({ markdown: '# Heading', inputName: 'boundary.md', options: { toc: false, maxOutputBytes: base.stats.htmlBytes } });
    expect(exact.success).toBe(true);
    const under = await convertMarkdownToHtml({ markdown: '# Heading', inputName: 'boundary.md', options: { toc: false, maxOutputBytes: base.stats.htmlBytes - 1 } });
    expect(under.success).toBe(false);
    if (!under.success) expect(under.diagnostics.some((item) => item.code === 'E_OUTPUT_TOO_LARGE')).toBe(true);
    const escaped = await convertMarkdownToHtml({ markdown: '# Content', inputName: 'x.md', options: { title: '</title><script>bad()</script>' } });
    expect(escaped.success).toBe(true);
    if (escaped.success) expect(escaped.html).toContain('&lt;/title&gt;&lt;script&gt;bad()&lt;/script&gt;');
    const malformed = await convertMarkdownToHtml({ markdown: '---\ntitle: [oops\n---\n# no', inputName: 'x.md' });
    expect(malformed.success).toBe(false);
    if (!malformed.success) expect(malformed.diagnostics.some((item) => item.code === 'E_FRONT_MATTER')).toBe(true);
  });

  it('rejects output-limit estimates before reading a clearly oversized asset', async () => {
    const read = vi.fn(async () => tinyPng);
    const assets: AssetResolver = {
      async describe(path) { return { id: path, label: path, byteLength: 10_000_000 }; },
      read,
    };
    const result = await convertMarkdownToHtml({
      markdown: '![large](large.png)',
      inputName: 'large.md',
      assets,
      options: { maxOutputBytes: 4096 },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.diagnostics.some((item) => item.code === 'E_OUTPUT_TOO_LARGE')).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('embeds safe inline SVG and rejects active or external SVG content', async () => {
    const safe = await convertMarkdownToHtml({
      markdown: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><title>Dot</title><circle cx="12" cy="12" r="8" fill="url(#paint)"/><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs></svg>',
      inputName: 'svg.md',
    });
    expect(safe.success).toBe(true);
    if (safe.success) {
      expect(safe.html).toContain('data:image/svg+xml;base64,');
      expect(safe.html).toContain('alt="Dot"');
    }
    const script = await convertMarkdownToHtml({ markdown: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', inputName: 'bad.md' });
    expect(script.success).toBe(false);
    if (!script.success) expect(script.diagnostics.some((item) => item.code === 'E_SVG_UNSAFE')).toBe(true);
    const external = await convertMarkdownToHtml({ markdown: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.invalid/a.svg#x)"/></svg>', inputName: 'bad.md' });
    expect(external.success).toBe(false);
    if (!external.success) expect(external.diagnostics.some((item) => item.code === 'E_SVG_EXTERNAL_RESOURCE')).toBe(true);
  });

  it('returns contract failures for invalid core options and changed assets', async () => {
    const invalid = await convertMarkdownToHtml({ markdown: '', inputName: 'x.md', options: { maxOutputBytes: 0 } });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.diagnostics[0]?.code).toBe('E_OPTIONS');
    const assets: AssetResolver = {
      async describe(path) { return { id: path, label: path, byteLength: tinyPng.byteLength }; },
      async read() { throw new AssetAccessError('E_ASSET_CHANGED', 'changed'); },
    };
    const changed = await convertMarkdownToHtml({ markdown: '![x](x.png)', inputName: 'x.md', assets });
    expect(changed.success).toBe(false);
    if (!changed.success) expect(changed.diagnostics[0]?.code).toBe('E_ASSET_CHANGED');
  });
});
