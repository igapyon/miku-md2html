import { createHash } from 'node:crypto';
import type { Element, Root } from 'hast';
import type { AssetRecord, AssetResolver, ConversionStats, Diagnostic } from '../types.js';
import { base64Length, imageWarningDimensions, inspectImage, type ImageInfo } from '../assets/image.js';
import { classifyImageSource, type ImageSource } from '../assets/uri.js';
import type { SvgInfo } from '../assets/svg.js';
import { addDiagnostic, mapAssetError } from './diagnostics.js';
import { getSource } from './hast-utils.js';
import { visitTree } from './tree.js';

const warningImageBytes = 5 * 1_048_576;
const acceptedMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

type PendingLocal = { node: Element; id: string; label: string; byteLength: number; placeholder: string };
export type AssetStats = Pick<ConversionStats, 'imageOccurrences' | 'uniqueAssets' | 'uniqueSourceAssetBytes' | 'embeddedPayloadBytes'>;

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

function setImageRecord(record: AssetRecord, ids: Set<string>, uniqueBytes: { value: number }, payloadBytes: { value: number }): void {
  if (!ids.has(record.id)) {
    ids.add(record.id);
    uniqueBytes.value += record.bytes.byteLength;
  }
  payloadBytes.value += base64Length(record.bytes.byteLength);
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

export function createImageEmbeddingSession(
  dependencies: {
    assets?: AssetResolver;
    diagnostics: Diagnostic[];
    lineOffset: number;
    maxOutputBytes: number;
  },
): ImageEmbeddingSession {
  const { assets, diagnostics, lineOffset, maxOutputBytes } = dependencies;
  const localCache = new Map<string, Promise<{ id: string; label: string; byteLength: number }>>();
  const assetLengths = new Map<string, number>();
  const pendingLocal: PendingLocal[] = [];
  const records = new Map<string, AssetRecord>();
  const uniqueIds = new Set<string>();
  const uniqueBytes = { value: 0 };
  const payloadBytes = { value: 0 };
  const seenWarnings = new Set<string>();
  let occurrence = 0;

  async function prepare(sourceValue: string, node: Element): Promise<void> {
    occurrence += 1;
    const source = getSource(node, 'markdown', lineOffset);
    let imageSource: ImageSource;
    try {
      imageSource = classifyImageSource(sourceValue);
    } catch (error) {
      mapAssetError(error, diagnostics, source);
      return;
    }
    if (imageSource.kind === 'local') {
      if (!assets) {
        addDiagnostic(diagnostics, 'error', 'E_ASSET_RESOLVER_REQUIRED', 'A local image requires an asset resolver.', source);
        return;
      }
      let described = localCache.get(imageSource.path);
      let info: { id: string; label: string; byteLength: number };
      try {
        if (!described) {
          described = Promise.resolve().then(() => assets.describe(imageSource.path));
          localCache.set(imageSource.path, described);
        }
        info = await described;
      } catch (error) {
        mapAssetError(error, diagnostics, source);
        return;
      }
      if (!info || typeof info.id !== 'string' || typeof info.label !== 'string' || !Number.isSafeInteger(info.byteLength) || info.byteLength < 0) {
        throw new TypeError('AssetResolver.describe returned invalid metadata.');
      }
      const knownLength = assetLengths.get(info.id);
      if (knownLength !== undefined && knownLength !== info.byteLength) {
        addDiagnostic(diagnostics, 'error', 'E_ASSET_CHANGED', 'The same image asset was described with inconsistent sizes.', source);
        return;
      }
      assetLengths.set(info.id, info.byteLength);
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

  return {
    prepare,
    async prepareInlineSvg(bytes, info, node) {
      await prepare(dataUri('image/svg+xml', bytes), node);
      if (!info.width || !info.height) return;
      const record = records.get(`embedded:image/svg+xml:${digest(bytes)}`);
      if (record) {
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
      const readAssets = new Map<string, AssetRecord>();
      for (const pending of pendingLocal) {
        let record = readAssets.get(pending.id);
        if (!record) {
          let bytes: Uint8Array;
          try {
            bytes = await assets!.read(pending.id, maxOutputBytes);
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
    },
    snapshotStats() {
      return {
        imageOccurrences: occurrence,
        uniqueAssets: uniqueIds.size,
        uniqueSourceAssetBytes: uniqueBytes.value,
        embeddedPayloadBytes: payloadBytes.value,
      };
    },
  };
}
