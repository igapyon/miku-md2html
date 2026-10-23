import { realpath } from 'node:fs/promises';
import path from 'node:path';

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
