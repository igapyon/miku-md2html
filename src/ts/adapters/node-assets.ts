import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AssetAccessError, type AssetInfo, type AssetResolver } from '../types.js';

type RecordedFile = {
  id: string;
  relativePath: string;
  byteLength: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
};

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export class NodeAssetResolver implements AssetResolver {
  readonly root: string;
  readonly base: string;
  private readonly records = new Map<string, RecordedFile>();

  private constructor(root: string, base: string) {
    this.root = root;
    this.base = base;
  }

  static async create(markdownFile: string, assetRoot?: string): Promise<NodeAssetResolver> {
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
    return new NodeAssetResolver(root, base);
  }

  async describe(decodedRelativePath: string): Promise<AssetInfo> {
    const candidate = path.resolve(this.base, decodedRelativePath);
    if (!isWithin(this.root, candidate)) {
      throw new AssetAccessError('E_ASSET_OUTSIDE_ROOT', `Image asset resolves outside the configured asset root: ${decodedRelativePath}`);
    }
    let resolved: string;
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      resolved = await realpath(candidate);
      fileStats = await stat(resolved);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new AssetAccessError('E_IMAGE_NOT_FOUND', `Image asset was not found: ${decodedRelativePath}`, { cause: error });
      }
      throw new AssetAccessError('E_IMAGE_READ', `Image asset could not be inspected: ${decodedRelativePath}`, { cause: error });
    }
    if (!isWithin(this.root, resolved)) {
      throw new AssetAccessError('E_ASSET_OUTSIDE_ROOT', `Image asset resolves outside the configured asset root: ${decodedRelativePath}`);
    }
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

  canonicalPath(id: string): string | undefined {
    return this.records.get(id)?.id;
  }

  getAssetPaths(): string[] {
    return [...new Set([...this.records.values()].map((record) => record.id))];
  }
}
