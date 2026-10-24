import { createHash } from 'node:crypto';
import type { Element, Root } from 'hast';
import { AssetAccessError, type AssetRecord, type AssetResolver, type ConversionStats, type Diagnostic, type ImageMode } from '../types.js';
import { base64Length, imageWarningDimensions, inspectImage, sniffImageKind, type ImageInfo } from '../assets/image.js';
import { classifyImageSource, type ImageSource } from '../assets/uri.js';
import type { SvgInfo } from '../assets/svg.js';
import { addDiagnostic, mapAssetError } from './diagnostics.js';
import { getSource } from './hast-utils.js';
import { visitTree } from './tree.js';

const warningImageBytes = 5 * 1_048_576;
const referenceInspectionLimit = 100 * 1_048_576;
const imagePrefixBytes = 256;
const acceptedMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const localWarningCodes: Record<string, { code: string; message: string }> = {
  E_IMAGE_NOT_FOUND: { code: 'W_IMAGE_NOT_FOUND', message: 'A referenced local image file was not found.' },
  E_IMAGE_READ: { code: 'W_IMAGE_READ', message: 'A referenced local image file could not be read.' },
  E_IMAGE_FORMAT: { code: 'W_IMAGE_FORMAT', message: 'A local image has an unsupported or unrecognized format.' },
  E_IMAGE_INVALID: { code: 'W_IMAGE_INVALID', message: 'A local image appears to be invalid or truncated.' },
  E_ASSET_OUTSIDE_ROOT: { code: 'W_ASSET_OUTSIDE_ROOT', message: 'A local image resolves outside the configured asset root and was omitted.' },
  E_ASSET_CHANGED: { code: 'W_ASSET_CHANGED', message: 'A local image changed during inspection.' },
  E_IMAGE_REFERENCE: { code: 'W_IMAGE_REFERENCE', message: 'A safe relative URL could not be created for a local image.' },
};

type PendingLocal = { node: Element; id: string; label: string; byteLength: number; placeholder: string; source: Diagnostic['source'] };
export type AssetStats = Pick<ConversionStats,
  'imageOccurrences' | 'uniqueAssets' | 'uniqueSourceAssetBytes' | 'embeddedPayloadBytes'
  | 'embeddedImageOccurrences' | 'referencedImageOccurrences' | 'omittedImageOccurrences'>;

export interface ImageEmbeddingSession {
  prepare(sourceValue: string, node: Element): Promise<void>;
  prepareInlineSvg(bytes: Uint8Array, info: SvgInfo, node: Element): Promise<void>;
  rebindPendingNodes(tree: Root): void;
  pendingSizeDelta(): number;
  embedPending(): Promise<void>;
  snapshotStats(): AssetStats;
}

function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function addPayload(record: AssetRecord, payloadBytes: { value: number }): void {
  payloadBytes.value += base64Length(record.bytes.byteLength);
}

function validResolverMetadata(value: unknown): asserts value is { id: string; label: string; byteLength: number } {
  const info = value as { id?: unknown; label?: unknown; byteLength?: unknown };
  if (!info || typeof info.id !== 'string' || !info.id || typeof info.label !== 'string'
    || !Number.isSafeInteger(info.byteLength) || (info.byteLength as number) < 0) {
    throw new TypeError('AssetResolver.describe returned invalid metadata.');
  }
}

function validateReferenceHref(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || !/^(?:\.\/|\.\.\/)/.test(value)) {
    throw new TypeError('AssetResolver.reference must return an encoded relative URL beginning with ./ or ../.');
  }
  let source: ImageSource;
  try {
    source = classifyImageSource(value);
  } catch {
    throw new TypeError('AssetResolver.reference returned an invalid relative image URL.');
  }
  if (source.kind !== 'local') throw new TypeError('AssetResolver.reference returned a non-local image URL.');
  return value;
}

export function createImageEmbeddingSession(
  dependencies: {
    assets?: AssetResolver;
    diagnostics: Diagnostic[];
    lineOffset: number;
    maxOutputBytes: number;
    imageMode: ImageMode;
  },
): ImageEmbeddingSession {
  const { assets, diagnostics, lineOffset, maxOutputBytes, imageMode } = dependencies;
  const localCache = new Map<string, Promise<{ id: string; label: string; byteLength: number }>>();
  const referenceCache = new Map<string, Promise<string>>();
  const fullReadCache = new Map<string, Promise<Uint8Array>>();
  const assetLengths = new Map<string, number>();
  const assetWarnings = new Set<string>();
  const pendingLocal: PendingLocal[] = [];
  const records = new Map<string, AssetRecord>();
  const uniqueSizes = new Map<string, number>();
  const payloadBytes = { value: 0 };
  let occurrence = 0;
  let embeddedImageOccurrences = 0;
  let referencedImageOccurrences = 0;
  let omittedImageOccurrences = 0;

  function trackUnique(id: string, byteLength: number): void {
    const known = uniqueSizes.get(id);
    if (known !== undefined && known !== byteLength) throw new TypeError('An asset id was associated with inconsistent byte lengths.');
    if (known === undefined) uniqueSizes.set(id, byteLength);
  }

  function warnForImage(id: string, byteLength: number, width: number | undefined, height: number | undefined, source: Diagnostic['source'], isEmbedded: boolean): void {
    if (byteLength > warningImageBytes && !assetWarnings.has(`${id}:bytes`)) {
      assetWarnings.add(`${id}:bytes`);
      const message = isEmbedded
        ? 'Image exceeds 5 MiB and is embedded at its original size.'
        : 'Image exceeds 5 MiB and is referenced from its original file.';
      addDiagnostic(diagnostics, 'warning', 'W_LARGE_IMAGE', message, source, { bytes: byteLength });
    }
    if (imageWarningDimensions(width, height) && !assetWarnings.has(`${id}:pixels`)) {
      assetWarnings.add(`${id}:pixels`);
      addDiagnostic(diagnostics, 'warning', 'W_LARGE_IMAGE_DIMENSIONS', 'Image exceeds 40 million pixels.', source, { width: width!, height: height! });
    }
  }

  function warnLocal(error: unknown, key: string, source: Diagnostic['source']): string | undefined {
    const code = (error as { code?: unknown })?.code;
    const mapped = typeof code === 'string' ? localWarningCodes[code] : undefined;
    if (!mapped) return undefined;
    const warningKey = `${key}:${mapped.code}`;
    if (!assetWarnings.has(warningKey)) {
      assetWarnings.add(warningKey);
      addDiagnostic(diagnostics, 'warning', mapped.code, mapped.message, source);
    }
    return mapped.code;
  }

  function omit(node: Element): void {
    delete node.properties.src;
    omittedImageOccurrences += 1;
  }

  function embedded(node: Element, record: AssetRecord): void {
    records.set(record.id, record);
    node.properties.src = dataUri(record.mime, record.bytes);
    addPayload(record, payloadBytes);
    embeddedImageOccurrences += 1;
  }

  async function reference(path: string, node: Element, source: Diagnostic['source']): Promise<boolean> {
    if (!assets?.reference) {
      addDiagnostic(diagnostics, 'error', 'E_ASSET_REFERENCE_REQUIRED', 'A local raster image requires an AssetResolver.reference implementation in reference mode.', source);
      omit(node);
      return false;
    }
    let result = referenceCache.get(path);
    try {
      if (!result) {
        result = Promise.resolve().then(() => assets.reference!(path)).then(validateReferenceHref);
        referenceCache.set(path, result);
      }
      node.properties.src = await result;
      referencedImageOccurrences += 1;
      return true;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (warnLocal(error, path, source)) {
        omit(node);
        return false;
      }
      mapAssetError(error, diagnostics, source);
      omit(node);
      return false;
    }
  }

  async function readAsset(id: string, maxBytes: number): Promise<Uint8Array> {
    let promise = fullReadCache.get(id);
    if (!promise) {
      promise = Promise.resolve().then(async () => {
        const bytes = await assets!.read(id, maxBytes);
        if (!(bytes instanceof Uint8Array)) throw new TypeError('AssetResolver.read must return Uint8Array.');
        if (bytes.byteLength > maxBytes) throw new AssetAccessError('E_OUTPUT_TOO_LARGE', 'Image asset exceeded the bounded read limit.');
        return bytes;
      });
      fullReadCache.set(id, promise);
    }
    const bytes = await promise;
    if (bytes.byteLength > maxBytes) throw new AssetAccessError('E_OUTPUT_TOO_LARGE', 'Image asset exceeds the requested read limit.');
    return bytes;
  }

  async function readPrefix(id: string, byteLength: number): Promise<Uint8Array> {
    const expectedLength = Math.min(imagePrefixBytes, byteLength);
    let bytes: Uint8Array;
    if (assets!.readPrefix) {
      bytes = await assets!.readPrefix(id, imagePrefixBytes);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expectedLength) {
        throw new TypeError('AssetResolver.readPrefix must return exactly the requested prefix length.');
      }
    } else {
      if (byteLength > referenceInspectionLimit) throw new AssetAccessError('E_OUTPUT_TOO_LARGE', 'Resolver cannot inspect a prefix of an oversized image.');
      bytes = await readAsset(id, referenceInspectionLimit);
      if (bytes.byteLength !== byteLength) throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset size changed after inspection.');
      return bytes.subarray(0, expectedLength);
    }
    return bytes;
  }

  function recordFromBytes(id: string, label: string, bytes: Uint8Array, info: ImageInfo): AssetRecord {
    return {
      id,
      label,
      byteLength: bytes.byteLength,
      bytes,
      mime: info.mime,
      ...(info.width ? { width: info.width } : {}),
      ...(info.height ? { height: info.height } : {}),
    };
  }

  async function describe(path: string): Promise<{ id: string; label: string; byteLength: number }> {
    let promise = localCache.get(path);
    if (!promise) {
      promise = Promise.resolve().then(() => assets!.describe(path)).then((value) => {
        validResolverMetadata(value);
        const known = assetLengths.get(value.id);
        if (known !== undefined && known !== value.byteLength) throw new TypeError('AssetResolver.describe returned inconsistent sizes for one asset id.');
        assetLengths.set(value.id, value.byteLength);
        trackUnique(value.id, value.byteLength);
        return value;
      });
      localCache.set(path, promise);
    }
    return promise;
  }

  async function prepareLocalReference(path: string, node: Element, source: Diagnostic['source']): Promise<void> {
    const svgHint = path.toLowerCase().endsWith('.svg');
    let metadata: { id: string; label: string; byteLength: number };
    try {
      metadata = await describe(path);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      const warning = warnLocal(error, path, source);
      if (!warning) {
        mapAssetError(error, diagnostics, source);
        omit(node);
        return;
      }
      if (warning === 'W_ASSET_OUTSIDE_ROOT' || svgHint) {
        omit(node);
        return;
      }
      await reference(path, node, source);
      return;
    }

    let prefix: Uint8Array;
    try {
      if (!assets!.readPrefix && metadata.byteLength > referenceInspectionLimit) {
        if (svgHint) {
          // SVG remains an embedded format, so let its complete read use the HTML output cap.
          prefix = new Uint8Array(0);
        } else {
          if (!assetWarnings.has(`${metadata.id}:inspection`)) {
            assetWarnings.add(`${metadata.id}:inspection`);
            addDiagnostic(diagnostics, 'warning', 'W_IMAGE_INSPECTION_SKIPPED', 'Image exceeds the 100 MiB inspection limit and the resolver cannot read a bounded prefix.', source, { bytes: metadata.byteLength });
          }
          omit(node);
          return;
        }
      } else {
        prefix = await readPrefix(metadata.id, metadata.byteLength);
      }
    } catch (error) {
      if (error instanceof TypeError) throw error;
      const warning = warnLocal(error, metadata.id, source);
      if (!warning) {
        mapAssetError(error, diagnostics, source);
        omit(node);
        return;
      }
      if (warning === 'W_ASSET_OUTSIDE_ROOT' || svgHint) {
        omit(node);
        return;
      }
      await reference(path, node, source);
      return;
    }

    const kind = sniffImageKind(prefix);
    if (kind.kind === 'raster' && metadata.byteLength > referenceInspectionLimit) {
      warnForImage(metadata.id, metadata.byteLength, undefined, undefined, source, false);
      if (!assetWarnings.has(`${metadata.id}:inspection`)) {
        assetWarnings.add(`${metadata.id}:inspection`);
        addDiagnostic(diagnostics, 'warning', 'W_IMAGE_INSPECTION_SKIPPED', 'Image exceeds the 100 MiB inspection limit; only its format header was checked.', source, { bytes: metadata.byteLength });
      }
      await reference(path, node, source);
      return;
    }
    if (kind.kind === 'unknown' && metadata.byteLength > referenceInspectionLimit && !svgHint) {
      if (!assetWarnings.has(`${metadata.id}:inspection`)) {
        assetWarnings.add(`${metadata.id}:inspection`);
        addDiagnostic(diagnostics, 'warning', 'W_IMAGE_INSPECTION_SKIPPED', 'Image exceeds the 100 MiB inspection limit and its format could not be identified.', source, { bytes: metadata.byteLength });
      }
      omit(node);
      return;
    }

    let bytes: Uint8Array;
    const isSvgCandidate = kind.kind === 'svg' || svgHint;
    const readLimit = isSvgCandidate ? maxOutputBytes : referenceInspectionLimit;
    try {
      bytes = await readAsset(metadata.id, readLimit);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if ((error as { code?: unknown })?.code === 'E_OUTPUT_TOO_LARGE' && !isSvgCandidate) {
        if (!assetWarnings.has(`${metadata.id}:inspection`)) {
          assetWarnings.add(`${metadata.id}:inspection`);
          addDiagnostic(diagnostics, 'warning', 'W_IMAGE_INSPECTION_SKIPPED', 'Image exceeds the 100 MiB inspection limit; its complete contents were not read.', source, { bytes: metadata.byteLength });
        }
        if (kind.kind === 'raster') await reference(path, node, source);
        else omit(node);
        return;
      }
      const warning = warnLocal(error, metadata.id, source);
      if (!warning) {
        mapAssetError(error, diagnostics, source);
        omit(node);
        return;
      }
      if (warning === 'W_ASSET_OUTSIDE_ROOT' || svgHint || kind.kind === 'svg') {
        omit(node);
        return;
      }
      await reference(path, node, source);
      return;
    }
    if (bytes.byteLength !== metadata.byteLength) {
      warnLocal(new AssetAccessError('E_ASSET_CHANGED', 'changed'), metadata.id, source);
      if (!svgHint && kind.kind === 'raster') await reference(path, node, source);
      else omit(node);
      return;
    }

    let info: ImageInfo;
    try {
      info = inspectImage(bytes);
    } catch (error) {
      if (error instanceof AssetAccessError && error.code.startsWith('E_SVG_')) {
        mapAssetError(error, diagnostics, source);
        omit(node);
        return;
      }
      const warning = warnLocal(error, metadata.id, source);
      if (!warning) {
        mapAssetError(error, diagnostics, source);
        omit(node);
        return;
      }
      if (kind.kind === 'raster' || (!svgHint && kind.kind === 'unknown')) await reference(path, node, source);
      else omit(node);
      return;
    }
    if (!acceptedMimes.has(info.mime)) {
      warnLocal(new AssetAccessError('E_IMAGE_FORMAT', 'unsupported'), metadata.id, source);
      if (!info.isSvg) await reference(path, node, source);
      else omit(node);
      return;
    }
    const record = recordFromBytes(metadata.id, metadata.label, bytes, info);
    records.set(record.id, record);
    warnForImage(record.id, record.byteLength, record.width, record.height, source, info.isSvg);
    if (info.isSvg) {
      embedded(node, record);
      return;
    }
    await reference(path, node, source);
  }

  async function prepare(sourceValue: string, node: Element): Promise<void> {
    occurrence += 1;
    const source = getSource(node, 'markdown', lineOffset);
    let imageSource: ImageSource;
    try {
      imageSource = classifyImageSource(sourceValue);
    } catch (error) {
      mapAssetError(error, diagnostics, source);
      omit(node);
      return;
    }

    if (imageSource.kind === 'local') {
      if (!assets) {
        addDiagnostic(diagnostics, 'error', 'E_ASSET_RESOLVER_REQUIRED', 'A local image requires an asset resolver.', source);
        omit(node);
        return;
      }
      if (imageMode === 'reference') {
        await prepareLocalReference(imageSource.path, node, source);
        return;
      }
      let metadata: { id: string; label: string; byteLength: number };
      try {
        metadata = await describe(imageSource.path);
      } catch (error) {
        if (error instanceof TypeError) throw error;
        if (!warnLocal(error, imageSource.path, source)) mapAssetError(error, diagnostics, source);
        omit(node);
        return;
      }
      const placeholder = `MIKUASSET${String(pendingLocal.length).padStart(8, '0')}END`;
      node.properties.src = `data:image/svg+xml;base64,${placeholder}`;
      pendingLocal.push({ node, ...metadata, placeholder, source });
      return;
    }

    let info: ImageInfo;
    try {
      info = inspectImage(imageSource.bytes, imageSource.mime);
    } catch (error) {
      mapAssetError(error, diagnostics, source);
      omit(node);
      return;
    }
    if (!acceptedMimes.has(info.mime)) {
      addDiagnostic(diagnostics, 'error', 'E_IMAGE_FORMAT', 'The image format is not supported.', source);
      omit(node);
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
    trackUnique(id, record.byteLength);
    records.set(id, record);
    warnForImage(id, record.byteLength, record.width, record.height, source, true);
    embedded(node, record);
  }

  return {
    prepare,
    async prepareInlineSvg(bytes, info, node) {
      await prepare(dataUri('image/svg+xml', bytes), node);
      const record = records.get(`embedded:image/svg+xml:${digest(bytes)}`);
      if (record && info.width && info.height) {
        record.width = info.width;
        record.height = info.height;
      }
    },
    rebindPendingNodes(tree) {
      const pendingByPlaceholder = new Map(pendingLocal.map((pending) => [pending.placeholder, pending]));
      visitTree<Element>(tree, 'element', (node) => {
        if (node.tagName !== 'img' || typeof node.properties.src !== 'string') return;
        const prefix = 'data:image/svg+xml;base64,';
        if (!node.properties.src.startsWith(prefix)) return;
        const pending = pendingByPlaceholder.get(node.properties.src.slice(prefix.length));
        if (pending) pending.node = node;
      });
    },
    pendingSizeDelta() {
      const shortestPrefixBytes = Math.min(...[...acceptedMimes].map((mime) => Buffer.byteLength(`data:${mime};base64,`, 'utf8')));
      const placeholderPrefix = 'data:image/svg+xml;base64,';
      return pendingLocal.reduce((total, pending) => {
        const placeholderBytes = Buffer.byteLength(`${placeholderPrefix}${pending.placeholder}`, 'utf8');
        const lowerBoundBytes = shortestPrefixBytes + base64Length(pending.byteLength);
        return total + lowerBoundBytes - placeholderBytes;
      }, 0);
    },
    async embedPending() {
      const readAssets = new Map<string, AssetRecord | Error>();
      for (const pending of pendingLocal) {
        let cached = readAssets.get(pending.id);
        if (!cached) {
          try {
            const bytes = await readAsset(pending.id, maxOutputBytes);
            if (bytes.byteLength !== pending.byteLength) throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset size changed after inspection.');
            const info = inspectImage(bytes);
            if (!acceptedMimes.has(info.mime)) throw new AssetAccessError('E_IMAGE_FORMAT', 'The image format is not supported.');
            cached = recordFromBytes(pending.id, pending.label, bytes, info);
            readAssets.set(pending.id, cached);
            records.set(pending.id, cached);
            warnForImage(cached.id, cached.byteLength, cached.width, cached.height, pending.source, true);
          } catch (error) {
            if (error instanceof TypeError) throw error;
            if (!(error instanceof Error)) throw error;
            cached = error;
            readAssets.set(pending.id, cached);
          }
        }
        if (cached instanceof Error) {
          if (!warnLocal(cached, pending.id, pending.source)) mapAssetError(cached, diagnostics, pending.source);
          omit(pending.node);
          continue;
        }
        embedded(pending.node, cached);
      }
    },
    snapshotStats() {
      let uniqueSourceAssetBytes = 0;
      for (const size of uniqueSizes.values()) uniqueSourceAssetBytes += size;
      return {
        imageOccurrences: occurrence,
        uniqueAssets: uniqueSizes.size,
        uniqueSourceAssetBytes,
        embeddedPayloadBytes: payloadBytes.value,
        embeddedImageOccurrences,
        referencedImageOccurrences,
        omittedImageOccurrences,
      };
    },
  };
}
