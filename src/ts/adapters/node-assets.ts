import { createReadStream } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AssetAccessError, type AssetInfo, type AssetResolver } from '../types.js';
import { canonicalPotentialPath, isWithin, relativeImageHref } from './node-paths.js';

type RecordedFile = {
  id: string;
  relativePath: string;
  byteLength: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
};

export class NodeAssetResolver implements AssetResolver {
  readonly root: string;
  readonly base: string;
  readonly outputFile: string | undefined;
  private readonly records = new Map<string, RecordedFile>();
  private readonly referencedPaths = new Set<string>();
  private readonly safeReferencedPaths = new Set<string>();
  private referenceScanComplete = false;

  private constructor(root: string, base: string, outputFile?: string) {
    this.root = root;
    this.base = base;
    this.outputFile = outputFile ? path.resolve(outputFile) : undefined;
  }

  static async create(markdownFile: string, assetRoot?: string, outputFile?: string): Promise<NodeAssetResolver> {
    const rootPath = assetRoot ? path.resolve(assetRoot) : path.dirname(path.resolve(markdownFile));
    let root: string;
    let base: string;
    try {
      const details = await stat(rootPath);
      if (!details.isDirectory()) throw new Error('asset root is not a directory');
      root = await realpath(rootPath);
      base = await realpath(path.dirname(path.resolve(markdownFile)));
    } catch (error) {
      throw new AssetAccessError('E_IMAGE_READ', `Asset root is not a readable directory: ${rootPath}`, { cause: error });
    }
    let resolvedOutput: string | undefined;
    if (outputFile) {
      try {
        resolvedOutput = await canonicalPotentialPath(outputFile);
      } catch (error) {
        throw new AssetAccessError('E_IMAGE_REFERENCE', 'HTML output path could not be resolved for local image URLs.', { cause: error });
      }
    }
    return new NodeAssetResolver(root, base, resolvedOutput);
  }

  async reference(decodedRelativePath: string): Promise<string> {
    const candidate = path.resolve(this.base, decodedRelativePath);
    this.recordReference(decodedRelativePath);
    let canonical: string;
    try {
      canonical = await canonicalPotentialPath(candidate);
    } catch (error) {
      throw new AssetAccessError('E_IMAGE_READ', `Image asset path could not be resolved: ${decodedRelativePath}`, { cause: error });
    }
    if (!isWithin(this.root, canonical)) {
      throw new AssetAccessError('E_ASSET_OUTSIDE_ROOT', `Image asset resolves outside the configured asset root: ${decodedRelativePath}`);
    }
    this.safeReferencedPaths.add(candidate);
    if (!this.outputFile) {
      throw new AssetAccessError('E_IMAGE_REFERENCE', 'A local image reference requires an HTML output path.');
    }
    return relativeImageHref(this.outputFile, candidate);
  }

  async describe(decodedRelativePath: string): Promise<AssetInfo> {
    const candidate = path.resolve(this.base, decodedRelativePath);
    this.recordReference(decodedRelativePath);
    let resolved: string;
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      resolved = await realpath(candidate);
      this.referencedPaths.add(resolved);
      fileStats = await stat(resolved);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        let canonical: string;
        try {
          canonical = await canonicalPotentialPath(candidate);
        } catch (canonicalError) {
          throw new AssetAccessError('E_IMAGE_READ', `Image asset path could not be resolved: ${decodedRelativePath}`, { cause: canonicalError });
        }
        if (!isWithin(this.root, canonical)) {
          throw new AssetAccessError('E_ASSET_OUTSIDE_ROOT', `Image asset resolves outside the configured asset root: ${decodedRelativePath}`, { cause: error });
        }
        this.safeReferencedPaths.add(candidate);
        throw new AssetAccessError('E_IMAGE_NOT_FOUND', `Image asset was not found: ${decodedRelativePath}`, { cause: error });
      }
      throw new AssetAccessError('E_IMAGE_READ', `Image asset could not be inspected: ${decodedRelativePath}`, { cause: error });
    }
    if (!isWithin(this.root, resolved)) {
      throw new AssetAccessError('E_ASSET_OUTSIDE_ROOT', `Image asset resolves outside the configured asset root: ${decodedRelativePath}`);
    }
    this.safeReferencedPaths.add(candidate);
    this.safeReferencedPaths.add(resolved);
    if (!fileStats.isFile() || !Number.isSafeInteger(fileStats.size) || fileStats.size < 0) {
      throw new AssetAccessError('E_IMAGE_READ', `Image asset is not a regular file: ${decodedRelativePath}`);
    }
    const linkStats = await lstat(candidate).catch(() => undefined);
    if (!linkStats) throw new AssetAccessError('E_IMAGE_NOT_FOUND', `Image asset disappeared: ${decodedRelativePath}`);
    const id = resolved;
    const record: RecordedFile = {
      id,
      relativePath: path.relative(this.root, resolved).split(path.sep).join('/'),
      byteLength: fileStats.size,
      dev: fileStats.dev,
      ino: fileStats.ino,
      mtimeMs: fileStats.mtimeMs,
      ctimeMs: fileStats.ctimeMs,
    };
    this.records.set(id, record);
    return { id, label: record.relativePath, byteLength: record.byteLength };
  }

  async read(id: string, maxBytes: number): Promise<Uint8Array> {
    const record = this.records.get(id);
    if (!record) throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset was not described before reading.');
    let currentRealpath: string;
    let currentStats: Awaited<ReturnType<typeof stat>>;
    try {
      currentRealpath = await realpath(id);
      currentStats = await stat(currentRealpath);
    } catch (error) {
      throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed or disappeared after inspection.', { cause: error });
    }
    if (!isWithin(this.root, currentRealpath) || currentRealpath !== id || !currentStats.isFile() || currentStats.size !== record.byteLength || currentStats.dev !== record.dev || currentStats.ino !== record.ino || currentStats.mtimeMs !== record.mtimeMs || currentStats.ctimeMs !== record.ctimeMs) {
      throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed after inspection.');
    }
    if (record.byteLength > maxBytes) throw new AssetAccessError('E_OUTPUT_TOO_LARGE', 'Image asset exceeds the remaining output read budget.');
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of createReadStream(currentRealpath, { highWaterMark: 64 * 1024 })) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > maxBytes || length > record.byteLength) {
          throw new AssetAccessError('E_OUTPUT_TOO_LARGE', 'Image asset exceeded the bounded read limit.');
        }
        chunks.push(buffer);
      }
    } catch (error) {
      if (error instanceof AssetAccessError) throw error;
      throw new AssetAccessError('E_IMAGE_READ', 'Image asset could not be read.', { cause: error });
    }
    const after = await stat(currentRealpath).catch((error) => {
      throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed while it was being read.', { cause: error });
    });
    if (length !== record.byteLength || after.size !== record.byteLength || after.mtimeMs !== record.mtimeMs || after.ctimeMs !== record.ctimeMs) {
      throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed while it was being read.');
    }
    return new Uint8Array(Buffer.concat(chunks, length));
  }

  async readPrefix(id: string, maxBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('readPrefix maxBytes must be a positive safe integer.');
    const record = this.records.get(id);
    if (!record) throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset was not described before reading.');
    let currentRealpath: string;
    let currentStats: Awaited<ReturnType<typeof stat>>;
    try {
      currentRealpath = await realpath(id);
      currentStats = await stat(currentRealpath);
    } catch (error) {
      throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed or disappeared after inspection.', { cause: error });
    }
    if (!isWithin(this.root, currentRealpath) || currentRealpath !== id || !currentStats.isFile() || currentStats.size !== record.byteLength || currentStats.dev !== record.dev || currentStats.ino !== record.ino || currentStats.mtimeMs !== record.mtimeMs || currentStats.ctimeMs !== record.ctimeMs) {
      throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed after inspection.');
    }
    const length = Math.min(maxBytes, record.byteLength);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(currentRealpath, 'r');
      const bytes = Buffer.allocUnsafe(length);
      let offset = 0;
      while (offset < length) {
        const result = await handle.read(bytes, offset, length - offset, offset);
        if (result.bytesRead === 0) throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed while its header was being read.');
        offset += result.bytesRead;
      }
      const after = await stat(currentRealpath);
      if (after.size !== record.byteLength || after.dev !== record.dev || after.ino !== record.ino || after.mtimeMs !== record.mtimeMs || after.ctimeMs !== record.ctimeMs) {
        throw new AssetAccessError('E_ASSET_CHANGED', 'Image asset changed while its header was being read.');
      }
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } catch (error) {
      if (error instanceof AssetAccessError) throw error;
      throw new AssetAccessError('E_IMAGE_READ', 'Image asset prefix could not be read.', { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  canonicalPath(id: string): string | undefined {
    return this.records.get(id)?.id;
  }

  getAssetPaths(): string[] {
    return [...new Set([...this.records.values()].map((record) => record.id))];
  }

  getReferencedPaths(): string[] {
    return [...this.referencedPaths];
  }

  getSafeReferencedPaths(): string[] {
    return [...this.safeReferencedPaths];
  }

  recordReference(decodedRelativePath: string): void {
    this.referencedPaths.add(path.resolve(this.base, decodedRelativePath));
  }

  completeReferenceScan(): void {
    this.referenceScanComplete = true;
  }

  isReferenceScanComplete(): boolean {
    return this.referenceScanComplete;
  }

  getAssetIdentities(): Array<{ dev: number; ino: number }> {
    return [...this.records.values()].map(({ dev, ino }) => ({ dev, ino }));
  }

  getAssetSnapshot(id: string): RecordedFile | undefined {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }
}
