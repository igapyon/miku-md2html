export type RasterMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export type RasterDimensions = { width: number; height: number };

function dimensions(width: number, height: number): RasterDimensions | undefined {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0) return undefined;
  return { width, height };
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function uint16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function uint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function uint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function uint32Be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function uint32Le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function pngDimensions(bytes: Uint8Array): RasterDimensions | undefined {
  let ihdrOffset = 8;
  if (matchesAscii(bytes, 12, 'CgBI')) {
    if (uint32Be(bytes, 8) !== 4) return undefined;
    ihdrOffset = 24;
  }
  if (bytes.length < ihdrOffset + 16 || uint32Be(bytes, ihdrOffset) !== 13 || !matchesAscii(bytes, ihdrOffset + 4, 'IHDR')) return undefined;
  const width = uint32Be(bytes, ihdrOffset + 8);
  const height = uint32Be(bytes, ihdrOffset + 12);
  return dimensions(width, height);
}

function gifDimensions(bytes: Uint8Array): RasterDimensions | undefined {
  if (bytes.length < 10 || (!matchesAscii(bytes, 0, 'GIF87a') && !matchesAscii(bytes, 0, 'GIF89a'))) return undefined;
  return dimensions(uint16Le(bytes, 6), uint16Le(bytes, 8));
}

const jpegFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function isRestartMarker(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

function jpegDimensions(bytes: Uint8Array): RasterDimensions | undefined {
  let offset = 2;
  let inEntropyCodedData = false;
  let zeroHeightWidth: number | undefined;

  while (offset < bytes.length) {
    if (inEntropyCodedData) {
      let markerFound = false;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerOffset = offset;
        offset += 1;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) return undefined;
        const marker = bytes[offset]!;
        if (marker === 0x00 || isRestartMarker(marker)) {
          offset += 1;
          continue;
        }
        offset = markerOffset;
        inEntropyCodedData = false;
        markerFound = true;
        break;
      }
      if (!markerFound) return undefined;
    }

    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0x00) return undefined;
    if (marker === 0xd9) return zeroHeightWidth === undefined ? undefined : dimensions(zeroHeightWidth, 0);
    if (marker === 0xd8) return undefined;
    if (marker === 0x01 || isRestartMarker(marker)) continue;

    if (offset + 2 > bytes.length) return undefined;
    const segmentLength = uint16Be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;
    const payloadOffset = offset + 2;

    if (jpegFrameMarkers.has(marker)) {
      if (segmentLength < 8 || payloadOffset + 6 > bytes.length) return undefined;
      const componentCount = bytes[payloadOffset + 5]!;
      if (componentCount < 1 || segmentLength !== 8 + 3 * componentCount) return undefined;
      const width = uint16Be(bytes, payloadOffset + 3);
      const height = uint16Be(bytes, payloadOffset + 1);
      if (height > 0) return dimensions(width, height);
      zeroHeightWidth = width;
    } else if (marker === 0xdc && zeroHeightWidth !== undefined) {
      if (segmentLength !== 4) return undefined;
      return dimensions(zeroHeightWidth, uint16Be(bytes, payloadOffset));
    }

    offset += segmentLength;
    if (marker === 0xda) inEntropyCodedData = true;
  }
  return zeroHeightWidth === undefined ? undefined : dimensions(zeroHeightWidth, 0);
}

function webpDimensions(bytes: Uint8Array): RasterDimensions | undefined {
  if (bytes.length < 20 || !matchesAscii(bytes, 0, 'RIFF') || !matchesAscii(bytes, 8, 'WEBP')) return undefined;
  const riffEnd = uint32Le(bytes, 4) + 8;
  if (riffEnd > bytes.length || riffEnd < 12) return undefined;

  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const chunkSize = uint32Le(bytes, offset + 4);
    const payloadOffset = offset + 8;
    const payloadEnd = payloadOffset + chunkSize;
    const paddedEnd = payloadEnd + (chunkSize & 1);
    if (payloadEnd > riffEnd || paddedEnd > riffEnd) return undefined;

    if (matchesAscii(bytes, offset, 'VP8X')) {
      if (chunkSize !== 10) return undefined;
      return dimensions(1 + uint24Le(bytes, payloadOffset + 4), 1 + uint24Le(bytes, payloadOffset + 7));
    }
    if (matchesAscii(bytes, offset, 'VP8L')) {
      if (chunkSize < 5 || bytes[payloadOffset] !== 0x2f) return undefined;
      const packed = uint32Le(bytes, payloadOffset + 1);
      const version = packed >>> 29;
      if (version !== 0) return undefined;
      return dimensions(1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff));
    }
    if (matchesAscii(bytes, offset, 'VP8 ')) {
      if (chunkSize < 10 || (bytes[payloadOffset]! & 1) !== 0) return undefined;
      if (bytes[payloadOffset + 3] !== 0x9d || bytes[payloadOffset + 4] !== 0x01 || bytes[payloadOffset + 5] !== 0x2a) return undefined;
      const width = uint16Le(bytes, payloadOffset + 6) & 0x3fff;
      const height = uint16Le(bytes, payloadOffset + 8) & 0x3fff;
      return dimensions(width, height);
    }

    offset = paddedEnd;
  }
  return undefined;
}

export function readRasterDimensions(bytes: Uint8Array, mime: RasterMime): RasterDimensions | undefined {
  if (mime === 'image/png') return pngDimensions(bytes);
  if (mime === 'image/jpeg') return jpegDimensions(bytes);
  if (mime === 'image/gif') return gifDimensions(bytes);
  return webpDimensions(bytes);
}
