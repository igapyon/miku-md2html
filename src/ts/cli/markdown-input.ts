import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AssetAccessError } from '../types.js';
import { canonicalPotentialPath } from './path-identity.js';

export type MarkdownInput =
  | { realPath: string; exists: false }
  | { realPath: string; exists: true; size: number };

export async function inspectMarkdown(filePath: string): Promise<MarkdownInput> {
  const absolutePath = path.resolve(filePath);
  let realPath: string;
  try {
    realPath = await realpath(absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      try {
        realPath = await canonicalPotentialPath(absolutePath);
        return { realPath, exists: false };
      } catch {
        // Without a canonical input path, output collision checks cannot be trusted.
      }
    }
    throw new AssetAccessError('E_INPUT_READ', 'Input Markdown file could not be opened.', { cause: error });
  }
  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    fileStats = await stat(realPath);
  } catch (error) {
    throw new AssetAccessError('E_INPUT_READ', 'Input Markdown file could not be opened.', { cause: error });
  }
  if (!fileStats.isFile()) throw new AssetAccessError('E_INPUT_READ', 'Input must be a regular file.');
  return { realPath, size: fileStats.size, exists: true };
}

export async function readMarkdown(input: MarkdownInput, maxBytes: number): Promise<{ text: string; bytes: number; realPath: string }> {
  if (!input.exists) throw new AssetAccessError('E_INPUT_READ', 'Input Markdown file could not be opened.');
  const { realPath } = input;
  if (input.size > maxBytes) throw new AssetAccessError('E_INPUT_TOO_LARGE', 'Markdown input exceeds the configured HTML cap.');
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of createReadStream(realPath, { highWaterMark: 64 * 1024 })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.byteLength;
      if (length > maxBytes) throw new AssetAccessError('E_INPUT_TOO_LARGE', 'Markdown input exceeds the configured HTML cap.');
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof AssetAccessError) throw error;
    throw new AssetAccessError('E_INPUT_READ', 'Input Markdown file could not be read.', { cause: error });
  }
  const bytes = Buffer.concat(chunks, length);
  if (bytes.byteLength > maxBytes) throw new AssetAccessError('E_INPUT_TOO_LARGE', 'Markdown input exceeds the configured HTML cap.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AssetAccessError('E_INPUT_ENCODING', 'Input is not valid UTF-8.');
  }
  return { text, bytes: bytes.byteLength, realPath };
}
