import { toHtml } from 'hast-util-to-html';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeOptions } from 'rehype-sanitize';
import type { Diagnostic } from '../types.js';
import { serializeInlineSvg } from '../assets/svg.js';
import { addDiagnostic, mapAssetError, sourcePosition } from './diagnostics.js';
import { getSource, plainText } from './hast-utils.js';
import type { ImageEmbeddingSession } from './image-embedding.js';

const allowedTags = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'em', 'strong', 'del', 's', 'ins', 'u',
  'sub', 'sup', 'code', 'pre', 'kbd', 'samp', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'caption', 'details', 'summary', 'dl', 'dt', 'dd', 'input',
]);
const droppedTags = new Set(['script', 'style', 'link', 'base', 'meta', 'iframe', 'object', 'embed', 'form', 'button', 'audio', 'video', 'source', 'select', 'textarea', 'option']);

export const articleSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [...allowedTags],
  strip: [...(defaultSchema.strip ?? []), ...droppedTags],
  clobber: [],
  clobberPrefix: '',
  required: {},
  attributes: {
    '*': ['title'],
    a: ['href', 'id', 'ariaDescribedBy', 'ariaLabel'],
    h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
    img: ['src', 'alt', 'width', 'height'],
    li: ['id'],
    td: ['colSpan', 'rowSpan', ['dataMikuAlign', 'left', 'center', 'right']],
    th: ['colSpan', 'rowSpan', ['dataMikuAlign', 'left', 'center', 'right']],
    details: ['open'],
    ol: ['start'],
    input: [['type', 'checkbox'], 'disabled', 'checked'],
    section: ['dataFootnotes'],
  },
  protocols: { href: ['http', 'https', 'mailto'], src: ['data'], cite: ['http', 'https'] },
};

function sourceIsRawHtml(node: Element, body: string): boolean {
  const offset = node.position?.start.offset;
  if (offset === undefined || offset < 0 || offset >= body.length) return false;
  return body[offset] === '<';
}

function safeLink(value: string): boolean {
  const link = value.trim();
  if (!link || /[\u0000-\u001f\u007f]/.test(link) || link.startsWith('//') || link.startsWith('\\')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link)?.[1]?.toLowerCase();
  return scheme === undefined || ['http', 'https', 'mailto'].includes(scheme);
}

function rewriteFootnoteId(value: string): string | undefined {
  const prefix = 'miku-md2html-generated-';
  if (!value.startsWith(prefix)) return undefined;
  const suffix = value.slice(prefix.length);
  if (suffix.length > 256 || !/^(?:fn|fnref)-[^\u0000-\u0020"'<>]+$/u.test(suffix)) return undefined;
  return `miku-${suffix}`;
}

function sanitizeProperties(
  node: Element,
  body: string,
  diagnostics: Diagnostic[],
  lineOffset: number,
): Record<string, unknown> {
  const properties = node.properties as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const removed: string[] = [];
  const raw = sourceIsRawHtml(node, body);
  const tag = node.tagName.toLowerCase();
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    if (key === 'title' && typeof value === 'string') output.title = value;
    else if (key === 'alt' && tag === 'img' && typeof value === 'string') output.alt = value;
    else if ((key === 'width' || key === 'height') && tag === 'img' && (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0) output[key] = Number(value);
    else if ((key === 'colSpan' || key === 'rowSpan') && ['td', 'th'].includes(tag) && /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 1000) output[key] = Number(value);
    else if (key === 'open' && tag === 'details' && value === true) output.open = true;
    else if (key === 'start' && tag === 'ol' && Number.isSafeInteger(Number(value))) output.start = Number(value);
    else if (key === 'align' && ['th', 'td'].includes(tag) && ['left', 'center', 'right'].includes(String(value).toLowerCase())) output.dataMikuAlign = String(value).toLowerCase();
    else if (key === 'type' && tag === 'input' && String(value).toLowerCase() === 'checkbox') output.type = 'checkbox';
    else if (key === 'disabled' && tag === 'input' && Boolean(value)) output.disabled = true;
    else if (key === 'checked' && tag === 'input' && Boolean(value)) output.checked = true;
    else if (key === 'href' && tag === 'a' && typeof value === 'string') {
      const footnoteHref = value.startsWith('#') ? rewriteFootnoteId(value.slice(1)) : undefined;
      const href = footnoteHref ? `#${footnoteHref}` : value;
      if (safeLink(href)) output.href = href;
      else addDiagnostic(diagnostics, 'warning', 'W_LINK_REMOVED', 'A link with an unsafe or unsupported URL was removed.', getSource(node, 'markdown', lineOffset));
    } else if (key === 'src' && tag === 'img' && typeof value === 'string') output.src = value;
    else if (key === 'id' && typeof value === 'string' && !raw) {
      const footnoteId = rewriteFootnoteId(value);
      if (footnoteId) output.id = footnoteId;
      else if (value === 'footnote-label' && node.position === undefined) output.id = 'miku-footnote-label';
      else removed.push(key);
    } else if (key === 'ariaDescribedBy' && !raw && Array.isArray(value)) {
      const mapped = value.map((entry) => entry === 'footnote-label' ? 'miku-footnote-label' : String(entry));
      output.ariaDescribedBy = mapped;
    } else if (key === 'ariaLabel' && !raw && typeof value === 'string') output.ariaLabel = value;
    else if (key === 'className' && Array.isArray(value)) {
      if (raw) removed.push('class');
    } else if (key === 'dataFootnoteRef' || key === 'dataFootnoteBackref') continue;
    else if (key === 'dataFootnotes' && tag === 'section' && node.position === undefined) {
      output.dataFootnotes = '';
    } else if (key === 'ariaHidden' && !raw && value === 'true') continue;
    else if (key === 'srcSet' || key === 'style' || key.toLowerCase().startsWith('on') || key === 'name' || key === 'target' || key.startsWith('form')) removed.push(key);
    else removed.push(key);
  }
  if (tag === 'input' && (raw || output.type !== 'checkbox' || output.disabled !== true)) {
    addDiagnostic(diagnostics, 'warning', 'W_HTML_SANITIZED', 'An interactive or unsupported input element was removed.', getSource(node, 'markdown', lineOffset));
    return {};
  }
  if (removed.length) {
    addDiagnostic(diagnostics, 'warning', 'W_HTML_SANITIZED', `Unsupported HTML attributes were removed: ${[...new Set(removed)].sort().join(', ')}.`, getSource(node, 'markdown', lineOffset), { count: removed.length });
  }
  return output;
}

export async function sanitizeArticleTree(
  root: Root,
  body: string,
  diagnostics: Diagnostic[],
  lineOffset: number,
  images: ImageEmbeddingSession,
): Promise<void> {
  async function cleanChildren(input: RootContent[]): Promise<ElementContent[]> {
    const children: ElementContent[] = [];
    for (const child of input) {
      if (child.type !== 'element') {
        if (child.type === 'text') children.push(child);
        else if (child.type === 'comment') {
          const start = sourcePosition(child.position?.start, lineOffset);
          addDiagnostic(diagnostics, 'warning', 'W_HTML_SANITIZED', 'An HTML comment was removed.', start ? { label: 'markdown', start } : undefined);
        }
        continue;
      }
      const tag = child.tagName.toLowerCase();
      const source = getSource(child, 'markdown', lineOffset);
      if (tag === 'svg') {
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        const svgText = start !== undefined && end !== undefined ? body.slice(start, end) : toHtml(child, { allowDangerousHtml: true });
        try {
          const inline = serializeInlineSvg(svgText);
          const title = child.children.find((item) => item.type === 'element' && item.tagName === 'title');
          const alt = typeof child.properties.ariaLabel === 'string'
            ? child.properties.ariaLabel
            : title ? plainText(title as Element) : '';
          const image: Element = {
            type: 'element', tagName: 'img', properties: { alt }, children: [],
            ...(child.position ? { position: child.position } : {}),
          };
          await images.prepareInlineSvg(inline.bytes, inline.info, image);
          children.push(image);
        } catch (error) {
          mapAssetError(error, diagnostics, source);
        }
        continue;
      }
      if (droppedTags.has(tag)) {
        addDiagnostic(diagnostics, 'warning', 'W_HTML_SANITIZED', `An active HTML element and its contents were removed: ${tag}.`, source);
        continue;
      }
      if (!allowedTags.has(tag)) {
        addDiagnostic(diagnostics, 'warning', 'W_HTML_SANITIZED', `An unsupported HTML tag was unwrapped: ${tag}.`, source);
        children.push(...await cleanChildren(child.children));
        continue;
      }
      const copy: Element = {
        ...child,
        properties: sanitizeProperties(child, body, diagnostics, lineOffset) as Element['properties'],
        children: [],
      };
      if (tag === 'img') {
        const src = typeof copy.properties.src === 'string' ? copy.properties.src : '';
        if (!src) addDiagnostic(diagnostics, 'error', 'E_IMAGE_URI', 'Image source is missing.', source);
        else await images.prepare(src, copy);
        children.push(copy);
      } else {
        copy.children = await cleanChildren(child.children);
        children.push(copy);
      }
    }
    return children;
  }
  root.children = await cleanChildren(root.children);
}

export { rehypeSanitize };
