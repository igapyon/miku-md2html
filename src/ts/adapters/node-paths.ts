import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { AssetAccessError } from '../types.js';

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export async function canonicalPotentialPath(filePath: string): Promise<string> {
  let current = path.resolve(filePath);
  const suffix: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(current), ...suffix);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function relativeImageHref(outputFile: string, imageFile: string): string {
  const outputDirectory = path.dirname(path.resolve(outputFile));
  const target = path.resolve(imageFile);
  const relative = path.relative(outputDirectory, target);
  if (!relative || path.isAbsolute(relative)) {
    throw new AssetAccessError('E_IMAGE_REFERENCE', 'The local image cannot be expressed as a relative URL from the HTML output.');
  }
  try {
    const segments = relative.split(path.sep).map((segment) => segment === '..' ? '..' : encodeURIComponent(segment));
    const joined = segments.join('/');
    return joined.startsWith('../') || joined === '..' ? joined : `./${joined}`;
  } catch (error) {
    throw new AssetAccessError('E_IMAGE_REFERENCE', 'The local image path cannot be encoded as a relative URL.', { cause: error });
  }
}
