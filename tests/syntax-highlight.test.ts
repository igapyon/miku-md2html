import { readFile } from 'node:fs/promises';
import type { Element, Root, RootContent } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { describe, expect, it } from 'vitest';
import { resolveCodeLanguage } from '../src/ts/core/code-languages.js';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import { applySyntaxHighlighting, type CodeBlockSource, type SyntaxTokenizer } from '../src/ts/core/syntax-highlight.js';
import type { GrammarId, LanguageId } from '../src/ts/core/code-languages.js';
import type { Diagnostic } from '../src/ts/types.js';

function collectElements(root: Root | Element, predicate: (element: Element) => boolean): Element[] {
  const found: Element[] = [];
  function walk(nodes: RootContent[]): void {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (predicate(node)) found.push(node);
      walk(node.children as RootContent[]);
    }
  }
  walk(root.children);
  return found;
}

function codeBlocks(html: string): Element[] {
  const tree = fromHtml(html, { fragment: true });
  const blocks: Element[] = [];
  for (const pre of collectElements(tree, (element) => element.tagName === 'pre')) {
    blocks.push(...pre.children.filter((child): child is Element => child.type === 'element' && child.tagName === 'code'));
  }
  return blocks;
}

function textContent(node: Root | Element | RootContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' || node.type === 'root') return node.children.map((child) => textContent(child)).join('');
  return '';
}

function classes(element: Element): string[] {
  const value = element.properties.className;
  return Array.isArray(value) ? value.filter((token): token is string => typeof token === 'string') : [];
}

function hasClass(element: Element, name: string): boolean {
  return classes(element).includes(name);
}

function fenced(language: string, code: string, meta = ''): string {
  return `\`\`\`${language}${meta ? ` ${meta}` : ''}\n${code}\n\`\`\``;
}

function repeatedCode(length: number): string {
  return `${'x;'.repeat(Math.floor(length / 2))}${length % 2 ? 'x' : ''}`;
}

describe('code language registry', () => {
  it.each([
    ['markdown', 'markdown', 'markdown'], ['md', 'markdown', 'markdown'],
    ['java', 'java', 'java'],
    ['javascript', 'javascript', 'javascript'], ['js', 'javascript', 'javascript'],
    ['ecmascript', 'javascript', 'javascript'], ['node', 'javascript', 'javascript'], ['nodejs', 'javascript', 'javascript'],
    ['typescript', 'typescript', 'typescript'], ['ts', 'typescript', 'typescript'],
    ['python', 'python', 'python'], ['py', 'python', 'python'], ['python3', 'python', 'python'],
    ['css', 'css', 'css'],
    ['html', 'html', 'xml'], ['htm', 'html', 'xml'], ['xml', 'xml', 'xml'], ['svg', 'xml', 'xml'],
    ['json', 'json', 'json'],
    ['shell', 'bash', 'bash'], ['sh', 'bash', 'bash'], ['bash', 'bash', 'bash'],
    ['yaml', 'yaml', 'yaml'], ['yml', 'yaml', 'yaml'],
    ['diff', 'diff', 'diff'], ['patch', 'diff', 'diff'],
    ['powershell', 'powershell', 'powershell'], ['pwsh', 'powershell', 'powershell'], ['ps1', 'powershell', 'powershell'],
  ] as const)('resolves %s to %s/%s', (alias, language, grammar) => {
    expect(resolveCodeLanguage(`  ${alias.toUpperCase()} title=example`)).toEqual({ language, grammar });
  });

  it.each(['', 'text', 'txt', 'plaintext', 'none', 'nohighlight', 'sql', 'dockerfile', 'toml', 'jsonc', 'jsx', 'language-js', '__proto__', 'constructor', 'toString'])('does not resolve unsupported language %s', (name) => {
    expect(resolveCodeLanguage(name)).toBeUndefined();
  });
});

describe('syntax highlighting', () => {
  it('highlights every planned language in the representative fixture', async () => {
    const markdown = await readFile(new URL('./fixtures/syntax-highlighting.md', import.meta.url), 'utf8');
    const result = await convertMarkdownToHtml({ markdown, inputName: 'syntax-highlighting.md' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const blocks = codeBlocks(result.html);
    expect(blocks).toHaveLength(13);
    expect(blocks.every((block) => hasClass(block, 'miku-md2html-highlight'))).toBe(true);
    expect(blocks.every((block) => block.children.some((child) => child.type === 'element' && child.tagName === 'span'))).toBe(true);
    expect(blocks.map((block) => classes(block).find((token) => token.startsWith('language-')))).toEqual([
      'language-markdown', 'language-java', 'language-javascript', 'language-typescript', 'language-python', 'language-css',
      'language-html', 'language-xml', 'language-json', 'language-bash', 'language-yaml', 'language-diff', 'language-powershell',
    ]);
    expect(result.html).toContain('--syntax-keyword: #5263a6');
    expect(result.html).toContain('--syntax-keyword: #b4c2ff');
  });

  it('accepts every alias, normalizes case, and ignores the fence meta string', async () => {
    const cases: Array<[string, LanguageId]> = [
      ['md', 'markdown'], ['js', 'javascript'], ['ecmascript', 'javascript'], ['node', 'javascript'], ['nodejs', 'javascript'],
      ['ts', 'typescript'], ['py', 'python'], ['python3', 'python'], ['htm', 'html'], ['svg', 'xml'], ['sh', 'bash'],
      ['shell', 'bash'], ['yml', 'yaml'], ['patch', 'diff'], ['pwsh', 'powershell'], ['ps1', 'powershell'],
    ];
    for (const [alias, language] of cases) {
      const result = await convertMarkdownToHtml({ markdown: fenced(alias.toUpperCase(), 'const answer = 42;', 'title=sample'), inputName: 'alias.md' });
      expect(result.success, alias).toBe(true);
      if (!result.success) continue;
      const [block] = codeBlocks(result.html);
      expect(block && hasClass(block, `language-${language}`), alias).toBe(true);
      expect(textContent(block!)).toBe('const answer = 42;\n');
    }
  });

  it('leaves unknown, plain, empty, inline, indented, and raw HTML code unhighlighted', async () => {
    const markdown = [
      fenced('sql', 'select 1;'),
      fenced('plaintext', '<img src=x onerror=alert(1)>'),
      fenced('__proto__', 'const prototype = false;'),
      fenced('constructor', 'const constructorValue = false;'),
      fenced('language-js', 'const prefixed = false;'),
      fenced('', 'const plain = true;'),
      fenced('js', ''),
      'Inline `const inline = true;` code.',
      '    const indented = true;',
      '<pre><code class="language-javascript" onclick="alert(1)">const raw = true;</code></pre>',
    ].join('\n\n');
    const result = await convertMarkdownToHtml({ markdown, inputName: 'plain.md' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const blocks = codeBlocks(result.html);
    expect(blocks).toHaveLength(9);
    expect(blocks.every((block) => !hasClass(block, 'miku-md2html-highlight'))).toBe(true);
    expect(blocks.every((block) => block.children.every((child) => child.type === 'text'))).toBe(true);
    expect(result.diagnostics.some((item) => item.code.startsWith('W_CODE_HIGHLIGHT_'))).toBe(false);
    expect(result.html).not.toContain('onclick=');
  });

  it('highlights list and blockquote fences and reports source lines after front matter', async () => {
    const markdown = `---\ntitle: Front matter\n---\n\n> \`\`\`js title=quoted\n> const quoted = 1;\n> \`\`\`\n\n- item\n\n  \`\`\`python\n  print("listed")\n  \`\`\`\n`;
    const result = await convertMarkdownToHtml({ markdown, inputName: 'nested.md' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const blocks = codeBlocks(result.html);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => hasClass(block, 'miku-md2html-highlight'))).toBe(true);

    const oversized = `---\ntitle: Front matter\n---\n${fenced('js', repeatedCode(262_144))}`;
    const skipped = await convertMarkdownToHtml({ markdown: oversized, inputName: 'offset.md' });
    expect(skipped.success).toBe(true);
    expect(skipped.diagnostics.find((item) => item.code === 'W_CODE_HIGHLIGHT_SKIPPED')?.source?.start?.line).toBe(4);
  });

  it('preserves Unicode, tabs, newlines, and HTML-looking source text exactly', async () => {
    const code = 'const 名 = "日本語 <img onerror=alert(1)>";\n\treturn 名;';
    const result = await convertMarkdownToHtml({ markdown: fenced('javascript', code), inputName: 'unicode.md' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const [block] = codeBlocks(result.html);
    expect(textContent(block!)).toBe(`${code}\n`);
    expect(result.html).not.toContain('<img onerror=');
    expect(result.html).toContain('&#x3C;img onerror=');
  });

  it('highlights the exact block byte limit and skips one byte above it', async () => {
    const exact = await convertMarkdownToHtml({ markdown: fenced('js', repeatedCode(262_143)), inputName: 'exact.md' });
    expect(exact.success).toBe(true);
    if (!exact.success) return;
    expect(hasClass(codeBlocks(exact.html)[0]!, 'miku-md2html-highlight')).toBe(true);
    expect(exact.diagnostics.some((item) => item.code === 'W_CODE_HIGHLIGHT_SKIPPED')).toBe(false);

    const above = await convertMarkdownToHtml({ markdown: fenced('js', repeatedCode(262_144)), inputName: 'above.md' });
    expect(above.success).toBe(true);
    if (!above.success) return;
    expect(hasClass(codeBlocks(above.html)[0]!, 'miku-md2html-highlight')).toBe(false);
    expect(above.diagnostics.find((item) => item.code === 'W_CODE_HIGHLIGHT_SKIPPED')?.details).toEqual({ reason: 'block-size', bytes: 262_145, limit: 262_144 });
  });

  it('applies the document budget in source order and highlights later blocks that fit', async () => {
    const blocks = [
      ...Array.from({ length: 4 }, () => fenced('js', repeatedCode(239_999))),
      fenced('js', repeatedCode(99_999)),
      fenced('js', repeatedCode(79_999)),
    ];
    const result = await convertMarkdownToHtml({ markdown: blocks.join('\n\n'), inputName: 'budget.md' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const rendered = codeBlocks(result.html);
    expect(rendered).toHaveLength(6);
    expect(rendered.slice(0, 4).every((block) => hasClass(block, 'miku-md2html-highlight'))).toBe(true);
    expect(hasClass(rendered[4]!, 'miku-md2html-highlight')).toBe(false);
    expect(hasClass(rendered[5]!, 'miku-md2html-highlight')).toBe(true);
    expect(result.diagnostics.find((item) => item.code === 'W_CODE_HIGHLIGHT_SKIPPED')?.details).toEqual({ reason: 'document-budget', bytes: 100_000, limit: 1_048_576 });
  });

  it('includes generated token markup in the final output byte limit', async () => {
    const markdown = fenced('js', 'const value = 42;');
    const full = await convertMarkdownToHtml({ markdown, inputName: 'size.md' });
    expect(full.success).toBe(true);
    if (!full.success) return;
    const limited = await convertMarkdownToHtml({ markdown, inputName: 'size.md', options: { maxOutputBytes: full.stats.htmlBytes - 1 } });
    expect(limited.success).toBe(false);
    if (limited.success) return;
    expect(limited.diagnostics.some((item) => item.code === 'E_OUTPUT_TOO_LARGE')).toBe(true);
  });

  it('counts highlight markup in image preflight before reading local image bytes', async () => {
    const imageBytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));
    const markdownFor = (language: string) => `![pixel](pixel.png)\n\n${fenced(language, 'const answer = 42;')}`;
    const resolverFor = (counter: { reads: number }) => ({
      describe: async () => ({ id: 'pixel', label: 'pixel.png', byteLength: imageBytes.byteLength }),
      read: async () => { counter.reads += 1; return imageBytes; },
    });
    const highlighted = await convertMarkdownToHtml({ markdown: markdownFor('javascript'), inputName: 'with-image.md', assets: resolverFor({ reads: 0 }) });
    const plain = await convertMarkdownToHtml({ markdown: markdownFor('text'), inputName: 'with-image.md', assets: resolverFor({ reads: 0 }) });
    expect(highlighted.success && plain.success).toBe(true);
    if (!highlighted.success || !plain.success) return;
    expect(highlighted.stats.htmlBytes).toBeGreaterThan(plain.stats.htmlBytes);
    const counter = { reads: 0 };
    const limited = await convertMarkdownToHtml({
      markdown: markdownFor('javascript'), inputName: 'with-image.md',
      options: { maxOutputBytes: Math.floor((highlighted.stats.htmlBytes + plain.stats.htmlBytes) / 2) },
      assets: resolverFor(counter),
    });
    expect(limited.success).toBe(false);
    expect(limited.diagnostics.some((item) => item.code === 'E_OUTPUT_TOO_LARGE')).toBe(true);
    expect(counter.reads).toBe(0);
  });

  it('remains deterministic across conversions', async () => {
    const request = { markdown: fenced('javascript', 'const answer = 42;'), inputName: 'repeat.md' };
    const first = await convertMarkdownToHtml(request);
    const second = await convertMarkdownToHtml(request);
    expect(first.success && second.success ? first.html : undefined).toBe(first.success && second.success ? second.html : undefined);
  });
});

describe('syntax-highlighter failure fallback', () => {
  function treeAndSource(): { tree: Root; sources: Map<string, CodeBlockSource> } {
    const position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 15, offset: 14 },
    };
    const code: Element = {
      type: 'element', tagName: 'code', properties: {}, position,
      children: [{ type: 'text', value: 'const x = 1;\n' }],
    };
    const tree: Root = {
      type: 'root', children: [{ type: 'element', tagName: 'pre', properties: {}, children: [code] }],
    };
    const source: CodeBlockSource = {
      language: 'javascript' as LanguageId,
      grammar: 'javascript' as GrammarId,
      startOffset: 0,
      endOffset: 14,
      text: 'const x = 1;\n',
      position,
    };
    return { tree, sources: new Map([['0:14', source]]) };
  }

  it('keeps plain source and omits exception details if the engine throws', () => {
    const { tree, sources } = treeAndSource();
    const code = (tree.children[0] as Element).children[0] as Element;
    const originalChildren = code.children;
    const diagnostics: Diagnostic[] = [];
    const failingTokenizer: SyntaxTokenizer = () => { throw new Error('secret code body'); };
    applySyntaxHighlighting(tree, sources, diagnostics, 0, failingTokenizer);
    expect(code.children).toBe(originalChildren);
    expect(classes(code)).toEqual([]);
    expect(diagnostics).toEqual([expect.objectContaining({
      severity: 'warning', code: 'W_CODE_HIGHLIGHT_FAILED', message: 'Syntax highlighting failed; plain code is shown.', details: { language: 'javascript' },
    })]);
    expect(JSON.stringify(diagnostics)).not.toContain('secret code body');
  });

  it('rejects token trees with active tags or attributes and keeps plain source', () => {
    const { tree, sources } = treeAndSource();
    const code = (tree.children[0] as Element).children[0] as Element;
    const originalChildren = code.children;
    const diagnostics: Diagnostic[] = [];
    const unsafeTokenizer: SyntaxTokenizer = () => ({
      type: 'root', children: [{ type: 'element', tagName: 'img', properties: { src: 'javascript:alert(1)' }, children: [] }],
    });
    applySyntaxHighlighting(tree, sources, diagnostics, 0, unsafeTokenizer);
    expect(code.children).toBe(originalChildren);
    expect(classes(code)).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ code: 'W_CODE_HIGHLIGHT_FAILED', details: { language: 'javascript' } });
  });

  it('charges failed highlighter calls to the document budget and still handles later blocks', () => {
    const codeTexts = [repeatedCode(262_143) + '\n', repeatedCode(262_143) + '\n', repeatedCode(262_143) + '\n', repeatedCode(262_143) + '\n', 'ok\n'];
    const codeElements: Element[] = [];
    const sources = new Map<string, CodeBlockSource>();
    let offset = 0;
    for (const [index, text] of codeTexts.entries()) {
      const position = {
        start: { line: index + 1, column: 1, offset },
        end: { line: index + 1, column: text.length + 1, offset: offset + text.length },
      };
      codeElements.push({
        type: 'element', tagName: 'code', properties: {}, position,
        children: [{ type: 'text', value: text }],
      });
      sources.set(`${offset}:${offset + text.length}`, {
        language: 'javascript', grammar: 'javascript', startOffset: offset, endOffset: offset + text.length,
        text, position,
      });
      offset += text.length;
    }
    const tree: Root = {
      type: 'root',
      children: codeElements.map((code) => ({ type: 'element', tagName: 'pre', properties: {}, children: [code] })),
    };
    const diagnostics: Diagnostic[] = [];
    let calls = 0;
    const tokenizer: SyntaxTokenizer = (_grammar, text) => {
      calls += 1;
      if (calls === 1) throw new Error('first block failed');
      return { type: 'root', children: [{ type: 'text', value: text }] };
    };
    applySyntaxHighlighting(tree, sources, diagnostics, 0, tokenizer);
    expect(calls).toBe(4);
    expect(hasClass(codeElements[0]!, 'miku-md2html-highlight')).toBe(false);
    expect(codeElements.slice(1, 4).every((code) => hasClass(code, 'miku-md2html-highlight'))).toBe(true);
    expect(hasClass(codeElements[4]!, 'miku-md2html-highlight')).toBe(false);
    expect(diagnostics.map((item) => item.code)).toEqual(['W_CODE_HIGHLIGHT_FAILED', 'W_CODE_HIGHLIGHT_SKIPPED']);
    expect(diagnostics[1]?.details).toEqual({ reason: 'document-budget', bytes: 3, limit: 1_048_576 });
  });
});
