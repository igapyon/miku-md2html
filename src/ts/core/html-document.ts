import { createHash } from 'node:crypto';
import { toHtml } from 'hast-util-to-html';
import type { Root } from 'hast';
import type { Heading } from './document-structure.js';
import { themeCss, viewerScript } from '../generated/viewer-assets.js';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderToc(headings: Heading[], title: string): string {
  if (!headings.length) return '';
  const items = headings.map((heading) => `<li data-level="${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`).join('\n');
  return `<details class="miku-md2html-toc" open><summary>${escapeHtml(title)}</summary><ol>\n${items}\n</ol></details>`;
}

export function renderDocument(
  article: Root,
  metadata: { title: string; lang: string; description?: string },
  toc: string,
): string {
  const articleHtml = toHtml(article, { allowDangerousHtml: false });
  const css = themeCss.trimEnd().replace(/<\/style/gi, '<\\/style');
  const script = `\n${viewerScript.trim()}\n`.replace(/<\/script/gi, '<\\/script');
  const scriptHash = createHash('sha256').update(script, 'utf8').digest('base64');
  const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const description = metadata.description ? `\n<meta name="description" content="${escapeHtml(metadata.description)}">` : '';
  const html = `<!doctype html>\n<html lang="${escapeHtml(metadata.lang)}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">${description}\n<title>${escapeHtml(metadata.title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n<main>\n${toc ? `${toc}\n` : ''}<article>\n${articleHtml}\n</article>\n</main>\n<script>${script}</script>\n</body>\n</html>\n`;
  return html;
}
