import { describe, expect, it } from 'vitest';
import { inspectRaster } from '../src/ts/assets/image.js';
import { AssetAccessError } from '../src/ts/types.js';

function ascii(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

function uint16Be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function uint16Le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function uint24Le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function uint32Le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function uint32Be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(name: string, payload: number[]): number[] {
  return [...uint32Be(payload.length), ...ascii(name), ...payload, 0, 0, 0, 0];
}

function cgbiPng(width: number, height: number): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = [...uint32Be(width), ...uint32Be(height), 8, 6, 0, 0, 0];
  return Uint8Array.from([
    ...signature,
    ...pngChunk('CgBI', [0, 0, 0, 0]),
    ...pngChunk('IHDR', ihdr),
    ...pngChunk('IDAT', []),
    ...pngChunk('IEND', []),
  ]);
}

function gif(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    ...ascii('GIF89a'), ...uint16Le(width), ...uint16Le(height), 0, 0, 0, 0x3b,
  ]);
}

function jpegFrame(width: number, height: number, marker = 0xc0): number[] {
  return [
    0xff, 0xd8,
    0xff, marker, 0, 11,
    8, ...uint16Be(height), ...uint16Be(width), 1, 1, 0x11, 0,
  ];
}

function webpChunk(name: string, payload: number[]): number[] {
  return [...ascii(name), ...uint32Le(payload.length), ...payload, ...(payload.length % 2 ? [0] : [])];
}

function webp(...chunks: number[][]): Uint8Array {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return Uint8Array.from([...ascii('RIFF'), ...uint32Le(body.length), ...body]);
}

function expectInvalid(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'): void {
  try {
    inspectRaster(bytes, mime);
    throw new Error('Expected image dimensions to be rejected.');
  } catch (error) {
    expect(error).toBeInstanceOf(AssetAccessError);
    expect((error as AssetAccessError).code).toBe('E_IMAGE_INVALID');
  }
}

describe('raster image dimensions', () => {
  it('reads dimensions from PNG and GIF headers', () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));
    expect(inspectRaster(png, 'image/png')).toMatchObject({ width: 1, height: 1 });
    expect(inspectRaster(gif(320, 240), 'image/gif')).toMatchObject({ width: 320, height: 240 });
  });

  it('reads PNG dimensions after an Apple CgBI chunk', () => {
    expect(inspectRaster(cgbiPng(128, 68), 'image/png')).toMatchObject({ width: 128, height: 68 });
  });

  it('reads baseline and progressive JPEG frame dimensions', () => {
    for (const marker of [0xc0, 0xc2]) {
      const jpeg = Uint8Array.from([...jpegFrame(640, 360, marker), 0xff, 0xd9]);
      expect(inspectRaster(jpeg, 'image/jpeg')).toMatchObject({ width: 640, height: 360 });
    }
  });

  it('reads a JPEG height supplied by the DNL marker after a scan', () => {
    const jpeg = Uint8Array.from([
      ...jpegFrame(32, 0),
      0xff, 0xda, 0, 2,
      0x12, 0x34, 0xff, 0x00, 0x56,
      0xff, 0xdc, 0, 4, ...uint16Be(24),
      0xff, 0xd9,
    ]);
    expect(inspectRaster(jpeg, 'image/jpeg')).toMatchObject({ width: 32, height: 24 });
  });

  it('reads simple lossy, lossless, and extended WebP dimensions', () => {
    const lossy = webp(webpChunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...uint16Le(640), ...uint16Le(360)]));
    const packed = (320 - 1) | ((200 - 1) << 14);
    const lossless = webp(webpChunk('VP8L', [0x2f, ...uint32Le(packed)]));
    const extended = webp(webpChunk('VP8X', [0, 0, 0, 0, ...uint24Le(1023), ...uint24Le(767)]));

    expect(inspectRaster(lossy, 'image/webp')).toMatchObject({ width: 640, height: 360 });
    expect(inspectRaster(lossless, 'image/webp')).toMatchObject({ width: 320, height: 200 });
    expect(inspectRaster(extended, 'image/webp')).toMatchObject({ width: 1024, height: 768 });
  });

  it('rejects recognized formats with missing or zero dimensions', () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));
    png.fill(0, 16, 20);
    expectInvalid(png, 'image/png');
    expectInvalid(gif(0, 10), 'image/gif');
    expectInvalid(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');
    expectInvalid(webp(webpChunk('JUNK', [1, 2, 3, 4])), 'image/webp');
  });

  it('rejects truncated JPEG segments and malformed WebP chunks', () => {
    expectInvalid(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0]), 'image/jpeg');
    const malformedWebp = webp(webpChunk('VP8X', [0, 0, 0, 0, 1, 2]));
    expectInvalid(malformedWebp, 'image/webp');
  });
});
