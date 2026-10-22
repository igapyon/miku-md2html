import { createHash } from 'node:crypto';
import { toHtml } from 'hast-util-to-html';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeOptions } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { AssetAccessError, type AssetRecord, type AssetResolver, type ConvertOptions, type ConvertRequest, type ConvertResult, type Diagnostic, type FrontMatter } from '../types.js';
import { inspectImage, base64Length, imageWarningDimensions, type ImageInfo } from '../assets/image.js';
import { classifyImageSource, type ImageSource } from '../assets/uri.js';
import { serializeInlineSvg } from '../assets/svg.js';
import { addDiagnostic, hasErrors, sourcePosition, stableDiagnostics } from './diagnostics.js';
import { parseFrontMatter, isValidLanguageTag } from './front-matter.js';
import { slugify, uniqueHeadingIds } from './slug.js';
import { applySyntaxHighlighting, collectCodeBlockSources } from './syntax-highlight.js';
import { themeCss, viewerScript } from '../generated/viewer-assets.js';

const MiB = 1_048_576;
const defaultMaxOutputBytes = 100 * MiB;
const warningOutputBytes = 20 * MiB;
const warningImageBytes = 5 * MiB;
const allowedTags = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'em', 'strong', 'del', 's', 'ins', 'u',
  'sub', 'sup', 'code', 'pre', 'kbd', 'samp', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'caption', 'details', 'summary', 'dl', 'dt', 'dd', 'input',
]);
const droppedTags = new Set(['script', 'style', 'link', 'base', 'meta', 'iframe', 'object', 'embed', 'form', 'button', 'audio', 'video', 'source', 'select', 'textarea', 'option']);
const acceptedMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const articleSanitizeSchema: SanitizeOptions = {
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

type PendingLocal = { node: Element; id: string; label: string; byteLength: number; placeholder: string };
type Heading = { node: Element; level: number; text: string; slug: string; id: string };
type InternalOptions = Required<Pick<ConvertOptions, 'toc' | 'maxOutputBytes'>> & Pick<ConvertOptions, 'title' | 'lang'>;

function baseStats() {
  return { headingCount: 0, imageOccurrences: 0, uniqueAssets: 0, uniqueSourceAssetBytes: 0, embeddedPayloadBytes: 0 };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizeSource(markdown: string): string {
  const withoutBom = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  return withoutBom.replace(/\r\n?/g, '\n');
}

function plainText(node: RootContent | Element): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' && node.tagName === 'img') return String(node.properties.alt ?? '');
  if ('children' in node) return node.children.map((child) => plainText(child as RootContent)).join('');
  return '';
}

function sourceIsRawHtml(node: Element, body: string): boolean {
  const offset = node.position?.start.offset;
  if (offset === undefined || offset < 0 || offset >= body.length) return false;
  return body[offset] === '<';
}

function getSource(node: Element, label: string, lineOffset: number) {
  const start = sourcePosition(node.position?.start, lineOffset);
  const end = sourcePosition(node.position?.end, lineOffset);
  return {
    label,
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}

function resultFailure(
  metadata: { title: string; lang: string; description?: string },
  diagnostics: Diagnostic[],
  stats: ReturnType<typeof baseStats>,
): ConvertResult {
  return { success: false, metadata, diagnostics: stableDiagnostics(diagnostics), stats };
}

function validateRequest(request: ConvertRequest, diagnostics: Diagnostic[]): InternalOptions | undefined {
  if (!request || typeof request !== 'object' || typeof request.markdown !== 'string' || typeof request.inputName !== 'string' || !request.inputName.trim() || /[\\/\0]/.test(request.inputName)) {
    addDiagnostic(diagnostics, 'error', 'E_OPTIONS', 'Request must include Markdown text and a plain input filename.');
    return undefined;
  }
  const options = request.options === undefined ? {} : request.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    addDiagnostic(diagnostics, 'error', 'E_OPTIONS', 'Options must be an object.');
    return undefined;
  }
  if (options.title !== undefined && (typeof options.title !== 'string' || !options.title.trim())) {
    addDiagnostic(diagnostics, 'error', 'E_OPTIONS', 'Title must be a non-empty string when provided.');
    return undefined;
  }
  if (options.lang !== undefined && (typeof options.lang !== 'string' || !isValidLanguageTag(options.lang.trim()))) {
    addDiagnostic(diagnostics, 'error', 'E_OPTIONS', 'Language must be a supported ASCII language tag.');
    return undefined;
  }
  if (options.toc !== undefined && typeof options.toc !== 'boolean') {
    addDiagnostic(diagnostics, 'error', 'E_OPTIONS', 'toc must be a boolean.');
    return undefined;
  }
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1_073_741_824) {
    addDiagnostic(diagnostics, 'error', 'E_OPTIONS', 'maxOutputBytes must be an integer from 1 through 1073741824.');
    return undefined;
  }
  return {
    ...(options.title !== undefined ? { title: options.title.trim() } : {}),
    ...(options.lang !== undefined ? { lang: options.lang.trim() } : {}),
    toc: options.toc ?? true,
    maxOutputBytes,
  };
}

function mapAssetError(error: unknown, diagnostics: Diagnostic[], source: Diagnostic['source']): void {
  if (error instanceof AssetAccessError) {
    addDiagnostic(diagnostics, 'error', error.code, error.message, source);
    return;
  }
  throw error;
}

function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function warningForImage(
  record: AssetRecord,
  seenWarnings: Set<string>,
  diagnostics: Diagnostic[],
  source: Diagnostic['source'],
): void {
  if (record.bytes.byteLength > warningImageBytes && !seenWarnings.has(`${record.id}:bytes`)) {
    seenWarnings.add(`${record.id}:bytes`);
    addDiagnostic(diagnostics, 'warning', 'W_LARGE_IMAGE', 'Image exceeds 5 MiB and is embedded at its original size.', source, { bytes: record.bytes.byteLength });
  }
  if (imageWarningDimensions(record.width, record.height) && !seenWarnings.has(`${record.id}:pixels`)) {
    seenWarnings.add(`${record.id}:pixels`);
    addDiagnostic(diagnostics, 'warning', 'W_LARGE_IMAGE_DIMENSIONS', 'Image exceeds 40 million pixels.', source, { width: record.width!, height: record.height! });
  }
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

function renderToc(headings: Heading[], title: string): string {
  if (!headings.length) return '';
  const items = headings.map((heading) => `<li data-level="${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`).join('\n');
  return `<details class="miku-md2html-toc" open><summary>${escapeHtml(title)}</summary><ol>\n${items}\n</ol></details>`;
}

function renderDocument(
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

function setImageRecord(record: AssetRecord, ids: Set<string>, uniqueBytes: { value: number }, payloadBytes: { value: number }): void {
  if (!ids.has(record.id)) {
    ids.add(record.id);
    uniqueBytes.value += record.bytes.byteLength;
  }
  payloadBytes.value += base64Length(record.bytes.byteLength);
}

async function prepareImage(
  sourceValue: string,
  node: Element,
  body: string,
  request: ConvertRequest,
  diagnostics: Diagnostic[],
  lineOffset: number,
  localCache: Map<string, Promise<{ id: string; label: string; byteLength: number }>>,
  pendingLocal: PendingLocal[],
  records: Map<string, AssetRecord>,
  uniqueIds: Set<string>,
  uniqueBytes: { value: number },
  payloadBytes: { value: number },
  seenWarnings: Set<string>,
  occurrence: { value: number },
): Promise<void> {
  occurrence.value += 1;
  const source = getSource(node, 'markdown', lineOffset);
  let imageSource: ImageSource;
  try {
    imageSource = classifyImageSource(sourceValue);
  } catch (error) {
    mapAssetError(error, diagnostics, source);
    return;
  }
  if (imageSource.kind === 'local') {
    if (!request.assets) {
      addDiagnostic(diagnostics, 'error', 'E_ASSET_RESOLVER_REQUIRED', 'A local image requires an asset resolver.', source);
      return;
    }
    let described = localCache.get(imageSource.path);
    if (!described) {
      described = request.assets.describe(imageSource.path);
      localCache.set(imageSource.path, described);
    }
    let info: { id: string; label: string; byteLength: number };
    try {
      info = await described;
    } catch (error) {
      mapAssetError(error, diagnostics, source);
      return;
    }
    if (!info || typeof info.id !== 'string' || typeof info.label !== 'string' || !Number.isSafeInteger(info.byteLength) || info.byteLength < 0) {
      throw new TypeError('AssetResolver.describe returned invalid metadata.');
    }
    const placeholder = `MIKUASSET${String(pendingLocal.length).padStart(8, '0')}END`;
    node.properties.src = `data:image/svg+xml;base64,${placeholder}`;
    pendingLocal.push({ node, id: info.id, label: info.label, byteLength: info.byteLength, placeholder });
    return;
  }

  let info: ImageInfo;
  try {
    info = inspectImage(imageSource.bytes, imageSource.mime);
  } catch (error) {
    mapAssetError(error, diagnostics, source);
    return;
  }
  if (!acceptedMimes.has(info.mime)) {
    addDiagnostic(diagnostics, 'error', 'E_IMAGE_FORMAT', 'The image format is not supported.', source);
    return;
  }
  const id = `embedded:${info.mime}:${digest(imageSource.bytes)}`;
  const record: AssetRecord = {
    id,
    label: id,
    byteLength: imageSource.bytes.byteLength,
    bytes: imageSource.bytes,
    mime: info.mime,
    ...(info.width ? { width: info.width } : {}),
    ...(info.height ? { height: info.height } : {}),
  };
  records.set(id, record);
  warningForImage(record, seenWarnings, diagnostics, source);
  setImageRecord(record, uniqueIds, uniqueBytes, payloadBytes);
  node.properties.src = dataUri(record.mime, record.bytes);
}

async function sanitizeTree(
  root: Root,
  body: string,
  request: ConvertRequest,
  diagnostics: Diagnostic[],
  lineOffset: number,
  localCache: Map<string, Promise<{ id: string; label: string; byteLength: number }>>,
  pendingLocal: PendingLocal[],
  records: Map<string, AssetRecord>,
  uniqueIds: Set<string>,
  uniqueBytes: { value: number },
  payloadBytes: { value: number },
  seenWarnings: Set<string>,
  occurrence: { value: number },
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
        let svgText = start !== undefined && end !== undefined ? body.slice(start, end) : toHtml(child, { allowDangerousHtml: true });
        try {
          const inline = serializeInlineSvg(svgText);
          const alt = typeof child.properties.ariaLabel === 'string'
            ? child.properties.ariaLabel
            : child.children.find((item) => item.type === 'element' && item.tagName === 'title')
              ? plainText(child.children.find((item) => item.type === 'element' && item.tagName === 'title') as Element)
              : '';
          const image: Element = {
            type: 'element', tagName: 'img', properties: { alt }, children: [],
            ...(child.position ? { position: child.position } : {}),
          };
          await prepareImage(dataUri('image/svg+xml', inline.bytes), image, body, request, diagnostics, lineOffset, localCache, pendingLocal, records, uniqueIds, uniqueBytes, payloadBytes, seenWarnings, occurrence);
          if (inline.info.width && inline.info.height) {
            const record = [...records.values()].find((candidate) => candidate.id === `embedded:image/svg+xml:${digest(inline.bytes)}`);
            if (record) {
              record.width = inline.info.width;
              record.height = inline.info.height;
            }
          }
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
        else await prepareImage(src, copy, body, request, diagnostics, lineOffset, localCache, pendingLocal, records, uniqueIds, uniqueBytes, payloadBytes, seenWarnings, occurrence);
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

function collectAndAssignHeadings(root: Root, diagnostics: Diagnostic[], lineOffset: number): Heading[] {
  const nodes: Element[] = [];
  visit(root, 'element', (node: Element) => {
    if (/^h[1-6]$/.test(node.tagName)) nodes.push(node);
  });
  const slugs = nodes.map((node) => slugify(plainText(node)));
  const ids = uniqueHeadingIds(slugs);
  return nodes.map((node, index) => {
    const id = ids[index]!;
    node.properties.id = id;
    return { node, level: Number(node.tagName.slice(1)), text: plainText(node), slug: slugs[index]!, id };
  });
}

function rewriteFragments(root: Root, headings: Heading[], diagnostics: Diagnostic[], lineOffset: number): void {
  const bySlug = new Map<string, string>();
  const ids = new Set<string>(headings.map((heading) => heading.id));
  visit(root, 'element', (node: Element) => {
    if (typeof node.properties.id === 'string' && /^miku-(?:fn|fnref)-/.test(node.properties.id)) ids.add(node.properties.id);
  });
  for (const heading of headings) if (!bySlug.has(heading.slug)) bySlug.set(heading.slug, heading.id);
  visit(root, 'element', (node: Element) => {
    if (node.tagName !== 'a' || typeof node.properties.href !== 'string') return;
    const href = node.properties.href;
    if (!href.startsWith('#')) return;
    let fragment: string;
    try {
      fragment = decodeURIComponent(href.slice(1));
    } catch {
      addDiagnostic(diagnostics, 'warning', 'W_ANCHOR_UNRESOLVED', 'A fragment link has invalid percent encoding.', getSource(node, 'markdown', lineOffset));
      return;
    }
    if (ids.has(fragment) || fragment === 'miku-footnote-label') return;
    const slug = slugify(fragment);
    const target = bySlug.get(slug);
    if (target) node.properties.href = `#${target}`;
    else addDiagnostic(diagnostics, 'warning', 'W_ANCHOR_UNRESOLVED', 'A fragment link does not match a heading or footnote.', getSource(node, 'markdown', lineOffset));
  });
}

export async function convertMarkdownToHtml(request: ConvertRequest): Promise<ConvertResult> {
  const diagnostics: Diagnostic[] = [];
  const stats = baseStats();
  const options = validateRequest(request, diagnostics);
  if (!options) return resultFailure({ title: 'Untitled', lang: 'ja' }, diagnostics, stats);

  const markdown = normalizeSource(request.markdown);
  const inputBytes = Buffer.byteLength(markdown, 'utf8');
  if (inputBytes > options.maxOutputBytes) {
    addDiagnostic(diagnostics, 'error', 'E_INPUT_TOO_LARGE', 'Markdown input exceeds the configured output limit.');
    return resultFailure({ title: 'Untitled', lang: options.lang ?? 'ja' }, diagnostics, stats);
  }
  const frontMatter = parseFrontMatter(markdown, diagnostics);
  const metadata: { title: string; lang: string; description?: string } = {
    title: 'Untitled',
    lang: options.lang ?? frontMatter.lang ?? 'ja',
    ...(frontMatter.description ? { description: frontMatter.description } : {}),
  };
  if (hasErrors(diagnostics)) return resultFailure(metadata, diagnostics, stats);

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: 'miku-md2html-generated-' })
    .use(rehypeRaw);
  const markdownTree = processor.parse(frontMatter.body) as import('mdast').Root;
  const codeBlockSources = collectCodeBlockSources(markdownTree);
  const tree = await processor.run(markdownTree) as Root;
  const localCache = new Map<string, Promise<{ id: string; label: string; byteLength: number }>>();
  const pendingLocal: PendingLocal[] = [];
  const records = new Map<string, AssetRecord>();
  const uniqueIds = new Set<string>();
  const uniqueBytes = { value: 0 };
  const payloadBytes = { value: 0 };
  const seenWarnings = new Set<string>();
  const occurrence = { value: 0 };
  await sanitizeTree(tree, frontMatter.body, request, diagnostics, frontMatter.lineOffset, localCache, pendingLocal, records, uniqueIds, uniqueBytes, payloadBytes, seenWarnings, occurrence);
  stats.imageOccurrences = occurrence.value;

  const headings = collectAndAssignHeadings(tree, diagnostics, frontMatter.lineOffset);
  stats.headingCount = headings.length;
  rewriteFragments(tree, headings, diagnostics, frontMatter.lineOffset);
  const firstH1 = headings.find((heading) => heading.level === 1)?.text.trim();
  const fileTitle = request.inputName.replace(/\.(?:md|markdown)$/i, '').trim();
  metadata.title = options.title ?? frontMatter.title ?? (firstH1 || fileTitle || 'Untitled');
  if (!metadata.title.trim()) metadata.title = 'Untitled';
  const tocTitle = metadata.lang.toLowerCase().startsWith('ja') ? '目次' : 'Contents';
  const toc = options.toc ? renderToc(headings, tocTitle) : '';

  const safeTree = await unified().use(rehypeSanitize, articleSanitizeSchema).run(tree) as Root;
  tree.children = safeTree.children;
  const pendingByPlaceholder = new Map(pendingLocal.map((pending) => [pending.placeholder, pending]));
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'img' || typeof node.properties.src !== 'string') return;
    const prefix = 'data:image/svg+xml;base64,';
    if (!node.properties.src.startsWith(prefix)) return;
    const pending = pendingByPlaceholder.get(node.properties.src.slice(prefix.length));
    if (pending) pending.node = node;
  });

  if (hasErrors(diagnostics)) {
    stats.uniqueAssets = uniqueIds.size;
    stats.uniqueSourceAssetBytes = uniqueBytes.value;
    stats.embeddedPayloadBytes = payloadBytes.value;
    return resultFailure(metadata, diagnostics, stats);
  }

  applySyntaxHighlighting(tree, codeBlockSources, diagnostics, frontMatter.lineOffset);

  const skeleton = renderDocument(tree, metadata, toc);
  let estimatedBytes = Buffer.byteLength(skeleton, 'utf8');
  for (const pending of pendingLocal) {
    const actualPayload = base64Length(pending.byteLength);
    estimatedBytes += actualPayload - pending.placeholder.length;
  }
  if (estimatedBytes > options.maxOutputBytes) {
    addDiagnostic(diagnostics, 'error', 'E_OUTPUT_TOO_LARGE', 'Estimated HTML exceeds the configured output limit.', undefined, { estimatedBytes, maxOutputBytes: options.maxOutputBytes });
    return resultFailure(metadata, diagnostics, { ...stats, imageOccurrences: occurrence.value, uniqueAssets: uniqueIds.size, uniqueSourceAssetBytes: uniqueBytes.value, embeddedPayloadBytes: payloadBytes.value });
  }

  const readAssets = new Map<string, AssetRecord>();
  for (const pending of pendingLocal) {
    let record = readAssets.get(pending.id);
    if (!record) {
      let bytes: Uint8Array;
      try {
        bytes = await request.assets!.read(pending.id, options.maxOutputBytes);
      } catch (error) {
        mapAssetError(error, diagnostics, { label: pending.label });
        continue;
      }
      if (!(bytes instanceof Uint8Array)) throw new TypeError('AssetResolver.read must return Uint8Array.');
      if (bytes.byteLength !== pending.byteLength) {
        addDiagnostic(diagnostics, 'error', 'E_ASSET_CHANGED', 'Image asset size changed after inspection.', { label: pending.label });
        continue;
      }
      let info: ImageInfo;
      try {
        info = inspectImage(bytes);
      } catch (error) {
        mapAssetError(error, diagnostics, { label: pending.label });
        continue;
      }
      record = {
        id: pending.id,
        label: pending.label,
        byteLength: bytes.byteLength,
        bytes,
        mime: info.mime,
        ...(info.width ? { width: info.width } : {}),
        ...(info.height ? { height: info.height } : {}),
      };
      readAssets.set(pending.id, record);
      records.set(pending.id, record);
      warningForImage(record, seenWarnings, diagnostics, { label: pending.label });
    }
    pending.node.properties.src = dataUri(record.mime, record.bytes);
    setImageRecord(record, uniqueIds, uniqueBytes, payloadBytes);
  }
  if (hasErrors(diagnostics)) {
    stats.uniqueAssets = uniqueIds.size;
    stats.uniqueSourceAssetBytes = uniqueBytes.value;
    stats.embeddedPayloadBytes = payloadBytes.value;
    return resultFailure(metadata, diagnostics, stats);
  }

  const html = renderDocument(tree, metadata, toc);
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > options.maxOutputBytes) {
    addDiagnostic(diagnostics, 'error', 'E_OUTPUT_TOO_LARGE', 'Generated HTML exceeds the configured output limit.', undefined, { htmlBytes, maxOutputBytes: options.maxOutputBytes });
    return resultFailure(metadata, diagnostics, { ...stats, imageOccurrences: occurrence.value, uniqueAssets: uniqueIds.size, uniqueSourceAssetBytes: uniqueBytes.value, embeddedPayloadBytes: payloadBytes.value });
  }
  if (htmlBytes > warningOutputBytes) addDiagnostic(diagnostics, 'warning', 'W_LARGE_OUTPUT', 'Generated HTML exceeds 20 MiB.', undefined, { bytes: htmlBytes });

  stats.uniqueAssets = uniqueIds.size;
  stats.uniqueSourceAssetBytes = uniqueBytes.value;
  stats.embeddedPayloadBytes = payloadBytes.value;
  const ordered = stableDiagnostics(diagnostics);
  return { success: true, html, metadata, diagnostics: ordered, stats: { ...stats, htmlBytes } };
}
