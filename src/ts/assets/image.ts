import { AssetAccessError } from '../types.js';
import { inspectSvg, type SvgInfo } from './svg.js';
import { readRasterDimensions, type RasterMime } from './raster-dimensions.js';

export type { RasterMime } from './raster-dimensions.js';
export type ImageInfo = { mime: RasterMime | 'image/svg+xml'; width?: number; height?: number; isSvg: boolean };

function invalid(message: string): never {
  throw new AssetAccessError('E_IMAGE_INVALID', message);
}

function detectRasterMime(bytes: Uint8Array): RasterMime {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(Buffer.from(bytes.subarray(0, 6)).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  throw new AssetAccessError('E_IMAGE_FORMAT', 'The image format is unsupported or its header is invalid.');
}

function inspectContainer(bytes: Uint8Array, mime: RasterMime): void {
  if (mime === 'image/png') {
    let offset = 8;
    let hasEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
      const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii');
      if (length > bytes.length - offset - 12) invalid('PNG contains a truncated chunk.');
      offset += 12 + length;
      if (type === 'IEND') {
        if (length !== 0) invalid('PNG has an invalid IEND chunk.');
        hasEnd = true;
        break;
      }
    }
    if (!hasEnd) invalid('PNG is truncated.');
  } else if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid('JPEG is truncated.');
  } else if (mime === 'image/gif') {
    if (bytes.length < 14 || bytes[bytes.length - 1] !== 0x3b) invalid('GIF is truncated.');
  } else if (mime === 'image/webp') {
    if (bytes.length < 20) invalid('WebP is truncated.');
    const declaredLength = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true) + 8;
    if (declaredLength > bytes.length) invalid('WebP is truncated.');
  }
}

export function inspectRaster(bytes: Uint8Array, declaredMime?: string): { mime: RasterMime; width: number; height: number } {
  if (bytes.length === 0) invalid('Image data is empty.');
  const mime = detectRasterMime(bytes);
  if (declaredMime && declaredMime !== mime) invalid('Image data MIME does not match its file format.');
  inspectContainer(bytes, mime);
  const dimensions = readRasterDimensions(bytes, mime);
  if (!dimensions) invalid('Image dimensions could not be read.');
  if (!dimensions.width || !dimensions.height) invalid('Image dimensions are invalid.');
  return { mime, ...dimensions };
}

export function inspectImage(bytes: Uint8Array, expectedMime?: string): ImageInfo {
  const prefix = Buffer.from(bytes.subarray(0, 256)).toString('utf8').trimStart();
  const isSvg = prefix.startsWith('<svg') || prefix.startsWith('<?xml') || prefix.startsWith('<!--') || /^<!\s*(?:doctype|entity)/i.test(prefix);
  if (isSvg) {
    if (expectedMime && expectedMime !== 'image/svg+xml') invalid('Image data MIME does not match SVG content.');
    const dimensions: SvgInfo = inspectSvg(bytes);
    return { mime: 'image/svg+xml', isSvg: true, ...dimensions };
  }
  const raster = inspectRaster(bytes, expectedMime);
  return { ...raster, isSvg: false };
}

export function base64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

export function imageWarningDimensions(width: number | undefined, height: number | undefined): boolean {
  return Boolean(width && height && width * height > 40_000_000);
}
