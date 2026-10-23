import { AssetAccessError } from '../types.js';

const acceptedMime = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

export type ImageSource =
  | { kind: 'local'; path: string }
  | { kind: 'data'; bytes: Uint8Array; mime: string };

export function classifyImageSource(value: string): ImageSource {
  const source = value.trim();
  if (/^https?:\/\//i.test(source) || source.startsWith('//')) {
    throw new AssetAccessError('E_REMOTE_IMAGE', 'Remote images are not supported.');
  }
  if (/^data:/i.test(source)) return decodeImageDataUrl(source);
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    throw new AssetAccessError('E_IMAGE_URI', 'The image URL scheme is not supported.');
  }
  if (!source || source.includes('?') || source.includes('#') || source.includes('\\') || source.includes('\0') || source.startsWith('/')) {
    throw new AssetAccessError('E_IMAGE_URI', 'The image path is not a supported relative URL path.');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    throw new AssetAccessError('E_IMAGE_URI', 'The image path has invalid percent encoding.');
  }
  if (!decoded || decoded.includes('\\') || decoded.includes('\0') || decoded.startsWith('/') || /^[A-Za-z]:/.test(decoded)) {
    throw new AssetAccessError('E_IMAGE_URI', 'The decoded image path is not a supported relative path.');
  }
  return { kind: 'local', path: decoded };
}

export function decodeImageDataUrl(value: string): { kind: 'data'; bytes: Uint8Array; mime: string } {
  const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match) throw new AssetAccessError('E_IMAGE_URI', 'Only Base64 data URLs for supported image types are accepted.');
  const mime = match[1]!.toLowerCase();
  if (!acceptedMime.has(mime)) throw new AssetAccessError('E_IMAGE_FORMAT', 'The data URL image type is not supported.');
  const payload = match[2]!;
  if (!payload || payload.length % 4 === 1) throw new AssetAccessError('E_IMAGE_INVALID', 'The image data URL is empty or has invalid Base64.');
  const decoded = Buffer.from(payload, 'base64');
  if (decoded.toString('base64') !== payload) throw new AssetAccessError('E_IMAGE_INVALID', 'The image data URL has invalid Base64.');
  return { kind: 'data', bytes: new Uint8Array(decoded), mime };
}

export function mimeToExtension(mime: string): string | undefined {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' } as Record<string, string>)[mime];
}
