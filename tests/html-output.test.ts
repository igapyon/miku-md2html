import { createHash } from 'node:crypto';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { describe, expect, it } from 'vitest';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import { renderDocument } from '../src/ts/core/html-document.js';

function elements(parent: Root | Element): Element[] {
  return (parent.children as RootContent[]).filter((node): node is Element => node.type === 'element');
}

function findElements(root: Root | Element, tag: string): Element[] {
  const output: Element[] = [];
  const pending: Array<Root | Element> = [root];
  while (pending.length) {
    const parent = pending.pop()!;
    for (const child of elements(parent)) {
      if (child.tagName === tag) output.push(child);
      pending.push(child);
    }
  }
  return output;
}

function textContent(node: RootContent | Root): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' || node.type === 'root') return node.children.map(textContent).join('');
  return '';
}

function layout(html: string) {
  const document = fromHtml(html);
  const main = findElements(document, 'main')[0]!;
  const articles = findElements(main, 'article');
  expect(articles).toHaveLength(1);
  const article = articles[0]!;
  const tocs = findElements(main, 'details').filter((node) => (node.properties.className as string[] | undefined)?.includes('miku-md2html-toc'));
  return { main, article, tocs };
}

async function convert(markdown: string, options = {}) {
  const result = await convertMarkdownToHtml({ markdown, inputName: 'layout.md', options });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

const text = (value: string): RootContent => ({ type: 'text', value });
const element = (tagName: string, children: RootContent[] = []): Element => ({ type: 'element', tagName, properties: {}, children: children as ElementContent[] });
const toc = '<details class="miku-md2html-toc" open><summary>Contents</summary><ol></ol></details>';

function render(children: RootContent[], contents = ''): string {
  return renderDocument({ type: 'root', children }, { title: 'Test', lang: 'en' }, contents, 'reference');
}

function articleSource(html: string): string {
  return /<article>([\s\S]*?)<\/article>/.exec(html)![1]!;
}

describe('table of contents placement', () => {
  it('places the TOC immediately after the leading H1 and keeps headings and links in source order', async () => {
    const result = await convert('# 設計\n\nIntro\n\n## Same\n\n## Same\n\n[Jump](#設計)');
    const { main, article, tocs } = layout(result.html);
    expect(elements(main).map((node) => node.tagName)).toEqual(['article']);
    expect(elements(article).map((node) => node.tagName)).toEqual(['h1', 'details', 'p', 'h2', 'h2', 'p']);
    expect(tocs).toHaveLength(1);
    expect(elements(tocs[0]!).map((node) => node.tagName)).toEqual(['summary', 'ol']);
    const entries = elements(elements(tocs[0]!)[1]!);
    expect(entries.map(textContent)).toEqual(['設計', 'Same', 'Same']);
    expect(entries.map((li) => elements(li)[0]!.properties.href)).toEqual(['#miku-h-設計', '#miku-h-same', '#miku-h-same-2']);
    expect(findElements(article, 'p').at(-1)?.children[0]).toMatchObject({ properties: { href: '#miku-h-設計' } });
    expect(result.stats.headingCount).toBe(3);
  });

  it.each([
    ['paragraph', 'Intro\n\n# Title'],
    ['H2', '## Section\n\n# Title'],
    ['blockquote', '> # Quoted\n\nParagraph'],
    ['div', '<div><h1>Nested</h1></div>'],
    ['list', '- # Nested\n\nParagraph'],
  ])('keeps the TOC before an article starting with %s', async (_name, markdown) => {
    const { main, article, tocs } = layout((await convert(markdown)).html);
    expect(elements(main).map((node) => node.tagName)).toEqual(['details', 'article']);
    expect(tocs).toHaveLength(1);
    expect(findElements(article, 'details')).toHaveLength(0);
    expect(findElements(article, 'h1')).toHaveLength(1);
  });

  it.each([
    ['H1 only', '# Title'],
    ['Setext', 'Title\n=====\n\nParagraph'],
    ['raw H1', '<h1>Title</h1>\n\nParagraph'],
    ['removed leading elements', '<!-- comment -->\n\n<script>bad()</script>\n\n# Title\n\nParagraph'],
  ])('recognizes a leading H1 from %s', async (_name, markdown) => {
    const { article, tocs } = layout((await convert(markdown)).html);
    expect(elements(article).slice(0, 2).map((node) => node.tagName)).toEqual(['h1', 'details']);
    expect(tocs).toHaveLength(1);
  });

  it('uses the first node for layout independently of metadata title', async () => {
    const first = await convert('---\ntitle: Front\n---\n# Body\n\nIntro', { title: 'Override' });
    expect(first.metadata.title).toBe('Override');
    expect(elements(layout(first.html).article).slice(0, 3).map((node) => node.tagName)).toEqual(['h1', 'details', 'p']);
    const later = await convert('---\ntitle: Front\n---\nIntro\n\n# Body');
    expect(later.metadata.title).toBe('Front');
    expect(elements(layout(later.html).main).map((node) => node.tagName)).toEqual(['details', 'article']);
  });

  it('omits the TOC for disabled, heading-free, and empty documents', async () => {
    const disabled = await convert('# Title\n\nParagraph', { toc: false });
    expect(layout(disabled.html).tocs).toHaveLength(0);
    expect(findElements(layout(disabled.html).article, 'h1')[0]?.properties.id).toBe('miku-h-title');
    for (const markdown of ['', 'Paragraph']) expect(layout((await convert(markdown)).html).tocs).toHaveLength(0);
  });

  it('ignores only formatting whitespace before H1, and preserves other leading text', () => {
    const h1 = element('h1', [text('Title')]);
    expect(elements(layout(render([text('\n\t '), h1], toc)).article).map((node) => node.tagName)).toEqual(['h1', 'details']);
    for (const prefix of ['Intro', '\u00a0', '\u3000']) {
      const html = render([text(prefix), h1], toc);
      expect(elements(layout(html).main).map((node) => node.tagName)).toEqual(['details', 'article']);
      expect(articleSource(html)).toContain(prefix);
    }
  });
});

describe('structural blank lines', () => {
  it.each([
    ['comments', '# Title\n\n<!-- first -->\n\n<!-- second -->\n\nParagraph'],
    ['scripts', '# Title\n\n<script>first()</script>\n\n<script>second()</script>\n\nParagraph'],
  ])('limits blank lines left by removed %s', async (_name, markdown) => {
    const result = await convert(markdown, { toc: false });
    expect(articleSource(result.html)).toBe('\n<h1 id="miku-h-title">Title</h1>\n\n<p>Paragraph</p>\n');
    expect(result.diagnostics.filter((item) => item.code === 'W_HTML_SANITIZED')).toHaveLength(2);
  });

  it('limits blank lines inside a structural container', async () => {
    const result = await convert('<div>\n<p>First</p>\n<script>first()</script>\n<script>second()</script>\n<p>Second</p>\n</div>');
    expect(articleSource(result.html)).toBe('\n<div>\n<p>First</p>\n\n<p>Second</p>\n</div>\n');
  });

  it.each([
    ['comments', '<!-- first -->\n<!-- second -->'],
    ['scripts', '<script>first()</script>\n<script>second()</script>'],
  ])('limits caption blank lines left by removed %s', async (_name, removed) => {
    const result = await convert(`<table><caption><p>First</p>\n${removed}\n<p>Second</p></caption><tr><td>cell</td></tr></table>`);
    expect(articleSource(result.html)).toContain('<caption><p>First</p>\n\n<p>Second</p></caption>');
    expect(result.diagnostics.filter((item) => item.code === 'W_HTML_SANITIZED')).toHaveLength(2);
  });

  it('preserves inline whitespace and code content inside captions', async () => {
    const result = await convert('<table><caption><span>First</span>&#10;&#10;&#10;<span>Second</span><pre><code>first&#10;&#10;&#10;second</code></pre><code>inline&#10;&#10;&#10;code</code></caption><tr><td>cell</td></tr></table>');
    const caption = findElements(layout(result.html).article, 'caption')[0]!;
    expect(articleSource(result.html)).toContain('<span>First</span>\n\n\n<span>Second</span>');
    const codeBlocks = findElements(caption, 'code');
    expect(codeBlocks).toHaveLength(2);
    expect(codeBlocks.map(textContent)).toEqual(expect.arrayContaining(['first\n\n\nsecond', 'inline\n\n\ncode']));
  });

  it('groups adjacent whitespace nodes and preserves trailing indentation', () => {
    const html = render([element('div', [element('p', [text('First')]), text('\n '), text('\t\n'), text('\t\n  '), element('p', [text('Second')])])]);
    expect(articleSource(html)).toBe('\n<div><p>First</p>\n\n  <p>Second</p></div>\n');
  });

  it.each(['', '\t ', '\n', '\n \t\n  '])('retains an existing short whitespace run %j', (value) => {
    const html = render([element('div', [element('p', [text('First')]), text(value), element('p', [text('Second')])])]);
    expect(articleSource(html)).toBe(`\n<div><p>First</p>${value}<p>Second</p></div>\n`);
  });

  it('preserves whitespace beside inline or text content, within paragraphs, and in attributes', () => {
    const whitespace = '\n\n\n';
    const content = [
      element('div', [element('span', [text('First')]), text(whitespace), element('a', [text('Second')])]),
      element('div', [text('First'), text(whitespace), element('p', [text('Second')])]),
      element('p', [text(`First${whitespace}Second`)]),
      element('div', [text(whitespace)]),
      { ...element('div'), properties: { title: `First${whitespace}Second` } },
    ];
    const html = render(content);
    expect(articleSource(html)).toContain(`<span>First</span>${whitespace}<a>Second</a>`);
    expect(articleSource(html)).toContain(`First${whitespace}<p>Second</p>`);
    expect(articleSource(html)).toContain(`<p>First${whitespace}Second</p>`);
    expect(articleSource(html)).toContain(`<div>${whitespace}</div>`);
    expect(layout(html).article.children.at(-2)).toMatchObject({ properties: { title: `First${whitespace}Second` } });
  });

  it.each(['\u00a0', '\u3000', '\r', '\f'])('preserves a run containing non-formatting character %j', (character) => {
    const whitespace = `\n${character}\n\n`;
    const html = render([element('div', [element('p'), text(whitespace), element('p')])]);
    expect(articleSource(html)).toBe(`\n<div><p></p>${whitespace}<p></p></div>\n`);
  });

  it.each([
    ['highlighted fence', '```js\nconst first = 1;\n\n\n\tconst second = 2;\n```', 'const first = 1;\n\n\n\tconst second = 2;\n'],
    ['plain fence', '```text\n first\n\n\nsecond \n```', ' first\n\n\nsecond \n'],
    ['raw pre/code', '<pre><code>first\n\n\nsecond</code></pre>', 'first\n\n\nsecond'],
    ['raw inline code', '<p><code>first&#10;&#10;&#10;second</code></p>', 'first\n\n\nsecond'],
  ])('preserves all code text in %s', async (_name, markdown, expected) => {
    const { article } = layout((await convert(markdown)).html);
    const code = findElements(article, 'code')[0]!;
    expect(textContent(code)).toBe(expected);
  });

  it('preserves paragraph soft and hard breaks', async () => {
    const { article } = layout((await convert('First\nsecond  \nthird')).html);
    const paragraph = elements(article)[0]!;
    expect(textContent(paragraph)).toBe('First\nsecond\nthird');
    expect(findElements(paragraph, 'br')).toHaveLength(1);
  });

  it('accounts for generated newlines at article and inserted TOC boundaries', () => {
    const children = [text('\n\n\n'), element('h1', [text('Title')]), text('\n\n\n')];
    for (const contents of ['', toc]) {
      const source = articleSource(render(children, contents));
      expect(source.startsWith('\n\n<h1>')).toBe(true);
      expect(source.endsWith('\n\n')).toBe(true);
      expect(source).not.toContain('\n\n\n');
    }
  });

  it('does not mutate the source tree, preserves protected descendants, and produces deterministic CSP', () => {
    const root: Root = {
      type: 'root',
      children: [element('h1', [text('Title')]), text('\n\n\n'), element('pre', [element('code', [element('span', [text('\n\n\n日本語\t')])])])],
    };
    const before = structuredClone(root);
    const first = renderDocument(root, { title: 'Test', lang: 'en' }, toc, 'reference');
    expect(renderDocument(root, { title: 'Test', lang: 'en' }, toc, 'reference')).toBe(first);
    expect(root).toEqual(before);
    expect(textContent(findElements(layout(first).article, 'code')[0]!)).toBe('\n\n\n日本語\t');
    const script = /<script>([\s\S]*?)<\/script>/.exec(first)![1]!;
    expect(first).toContain(`sha256-${createHash('sha256').update(script).digest('base64')}`);
  });

  it('counts the final layout and embedded image bytes at the exact output cap', async () => {
    const bytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));
    const request = {
      markdown: '# Title\n\n<!-- first -->\n\n<!-- second -->\n\n![pixel](pixel.png)',
      inputName: 'image.md',
      assets: { async describe() { return { id: 'pixel', label: 'pixel.png', byteLength: bytes.length }; }, async read() { return bytes; } },
    };
    const full = await convertMarkdownToHtml({ ...request, options: { imageMode: 'embed' } });
    expect(full.success).toBe(true);
    if (!full.success) return;
    expect(full.html).toContain(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
    expect(full.stats.htmlBytes).toBe(Buffer.byteLength(full.html));
    expect(layout(full.html).tocs).toHaveLength(1);
    const exact = await convertMarkdownToHtml({ ...request, options: { imageMode: 'embed', maxOutputBytes: full.stats.htmlBytes } });
    expect(exact.success).toBe(true);
    if (exact.success) expect(exact.html).toBe(full.html);
    const under = await convertMarkdownToHtml({ ...request, options: { imageMode: 'embed', maxOutputBytes: full.stats.htmlBytes - 1 } });
    expect(under.success).toBe(false);
    expect(under.diagnostics.some((item) => item.code === 'E_OUTPUT_TOO_LARGE')).toBe(true);
  });
});
