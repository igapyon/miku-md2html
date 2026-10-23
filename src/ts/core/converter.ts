import type { Root } from 'hast';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import type { ConvertOptions, ConvertRequest, ConvertResult, Diagnostic, FrontMatter } from '../types.js';
import { addDiagnostic, hasErrors, stableDiagnostics } from './diagnostics.js';
import { parseFrontMatter, isValidLanguageTag } from './front-matter.js';
import { applySyntaxHighlighting, collectCodeBlockSources } from './syntax-highlight.js';
import { plainText } from './hast-utils.js';
import { collectAndAssignHeadings, rewriteFragments } from './document-structure.js';
import { renderDocument, renderToc } from './html-document.js';
import { createImageEmbeddingSession } from './image-embedding.js';
import { completeImageReferenceScan, recordLocalImageReferences } from './image-references.js';
import { articleSanitizeSchema, rehypeSanitize, sanitizeArticleTree } from './article-sanitizer.js';

const MiB = 1_048_576;
const defaultMaxOutputBytes = 100 * MiB;
const warningOutputBytes = 20 * MiB;
type InternalOptions = Required<Pick<ConvertOptions, 'toc' | 'maxOutputBytes'>> & Pick<ConvertOptions, 'title' | 'lang'>;

function baseStats() {
  return { headingCount: 0, imageOccurrences: 0, uniqueAssets: 0, uniqueSourceAssetBytes: 0, embeddedPayloadBytes: 0 };
}

function normalizeSource(markdown: string): string {
  const withoutBom = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  return withoutBom.replace(/\r\n?/g, '\n');
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
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: 'miku-md2html-generated-' })
    .use(rehypeRaw);
  const markdownTree = processor.parse(frontMatter.body) as import('mdast').Root;
  const codeBlockSources = collectCodeBlockSources(markdownTree);
  const tree = await processor.run(markdownTree) as Root;
  if (hasErrors(diagnostics)) {
    recordLocalImageReferences(tree, request.assets);
    return resultFailure(metadata, diagnostics, stats);
  }

  const images = createImageEmbeddingSession({ ...(request.assets ? { assets: request.assets } : {}), diagnostics, lineOffset: frontMatter.lineOffset, maxOutputBytes: options.maxOutputBytes });
  await sanitizeArticleTree(tree, frontMatter.body, diagnostics, frontMatter.lineOffset, images);
  completeImageReferenceScan(request.assets);
  Object.assign(stats, images.snapshotStats());

  const headings = collectAndAssignHeadings(tree);
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
  images.rebindPendingNodes(tree);

  if (hasErrors(diagnostics)) {
    return resultFailure(metadata, diagnostics, { ...stats, ...images.snapshotStats() });
  }

  applySyntaxHighlighting(tree, codeBlockSources, diagnostics, frontMatter.lineOffset);

  const skeleton = renderDocument(tree, metadata, toc);
  const estimatedBytes = Buffer.byteLength(skeleton, 'utf8') + images.pendingSizeDelta();
  if (estimatedBytes > options.maxOutputBytes) {
    addDiagnostic(diagnostics, 'error', 'E_OUTPUT_TOO_LARGE', 'Estimated HTML exceeds the configured output limit.', undefined, { estimatedBytes, maxOutputBytes: options.maxOutputBytes });
    return resultFailure(metadata, diagnostics, { ...stats, ...images.snapshotStats() });
  }

  await images.embedPending();
  if (hasErrors(diagnostics)) {
    return resultFailure(metadata, diagnostics, { ...stats, ...images.snapshotStats() });
  }

  const html = renderDocument(tree, metadata, toc);
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > options.maxOutputBytes) {
    addDiagnostic(diagnostics, 'error', 'E_OUTPUT_TOO_LARGE', 'Generated HTML exceeds the configured output limit.', undefined, { htmlBytes, maxOutputBytes: options.maxOutputBytes });
    return resultFailure(metadata, diagnostics, { ...stats, ...images.snapshotStats() });
  }
  if (htmlBytes > warningOutputBytes) addDiagnostic(diagnostics, 'warning', 'W_LARGE_OUTPUT', 'Generated HTML exceeds 20 MiB.', undefined, { bytes: htmlBytes });

  Object.assign(stats, images.snapshotStats());
  const ordered = stableDiagnostics(diagnostics);
  return { success: true, html, metadata, diagnostics: ordered, stats: { ...stats, htmlBytes } };
}
