import { randomUUID } from 'node:crypto';
import { open, lstat, mkdir, rename, link, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { getSystemErrorMap } from 'node:util';
import { AssetAccessError } from '../types.js';
import { canonicalPotentialPath } from './path-identity.js';

export type TargetInfo = { path: string; canonicalPath: string; exists: boolean; dev?: number; ino?: number };
export type OutputKind = 'HTML' | 'JSON report';

export interface OutputFileOperations {
  stage(target: string, content: string): Promise<string>;
  commit(temporary: string, target: string, force: boolean): Promise<void>;
  cleanup(paths: Array<string | undefined>): Promise<void>;
}

const fileSystemErrorCodes = new Set([...getSystemErrorMap().values()].map(([code]) => code));

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error) || error instanceof TypeError) return false;
  const systemError = error as NodeJS.ErrnoException;
  return typeof systemError.code === 'string'
    && fileSystemErrorCodes.has(systemError.code)
    && typeof systemError.errno === 'number'
    && typeof systemError.syscall === 'string';
}

function ioError(kind: OutputKind, error: unknown): unknown {
  if (error instanceof AssetAccessError) return error;
  if (!isFileSystemError(error)) return error;
  const code = kind === 'HTML' ? 'E_OUTPUT_WRITE' : 'E_REPORT_WRITE';
  const subject = kind === 'HTML' ? 'HTML' : 'JSON report';
  return new AssetAccessError(code, `${subject} could not be saved.`, { cause: error });
}

export async function targetInfo(target: string, force: boolean, kind: OutputKind): Promise<TargetInfo> {
  const absolute = path.resolve(target);
  try {
    const details = await lstat(absolute);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new AssetAccessError('E_OUTPUT_COLLISION', `${kind} destination must be a regular file and must not be a symlink.`);
    }
    if (!force) throw new AssetAccessError('E_OUTPUT_EXISTS', `${kind} destination already exists; use --force to replace it.`);
    const canonicalPath = await canonicalPotentialPath(absolute);
    return { path: absolute, canonicalPath, exists: true, dev: details.dev, ino: details.ino };
  } catch (error) {
    if (error instanceof AssetAccessError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw ioError(kind, error);
    try {
      await mkdir(path.dirname(absolute), { recursive: true });
      const canonicalPath = await canonicalPotentialPath(absolute);
      return { path: absolute, canonicalPath, exists: false };
    } catch (mkdirError) {
      throw ioError(kind, mkdirError);
    }
  }
}

export function sameFile(left: TargetInfo, right: TargetInfo): boolean {
  if (left.canonicalPath === right.canonicalPath) return true;
  return left.exists && right.exists && left.dev === right.dev && left.ino === right.ino;
}

export async function rejectInputCollision(inputRealPath: string, target: TargetInfo, inputExists = true): Promise<void> {
  if (path.resolve(inputRealPath) === target.canonicalPath) throw new AssetAccessError('E_OUTPUT_COLLISION', 'Input, HTML, and report paths must be different.');
  if (target.exists && inputExists) {
    let inputStats: Awaited<ReturnType<typeof stat>>;
    try {
      inputStats = await stat(inputRealPath);
    } catch (error) {
      const mapped = ioError('HTML', error);
      if (!(mapped instanceof AssetAccessError)) throw mapped;
      throw new AssetAccessError('E_OUTPUT_WRITE', 'Input and output paths could not be compared.', { cause: error });
    }
    if (inputStats.dev === target.dev && inputStats.ino === target.ino) throw new AssetAccessError('E_OUTPUT_COLLISION', 'Input, HTML, and report files must not refer to the same inode.');
  }
}

async function stageFile(target: string, content: string): Promise<string> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return temporary;
}

async function commitFile(temporary: string, target: string, force: boolean): Promise<void> {
  if (force) {
    await rename(temporary, target);
  } else {
    await link(temporary, target);
    await unlink(temporary).catch(() => undefined);
  }
}

async function cleanup(paths: Array<string | undefined>): Promise<void> {
  await Promise.all(paths.filter((item): item is string => Boolean(item)).map((item) => unlink(item).catch(() => undefined)));
}

export const defaultOutputFileOperations: OutputFileOperations = { stage: stageFile, commit: commitFile, cleanup };

export async function stageOutputFile(target: string, content: string, kind: OutputKind, operations = defaultOutputFileOperations): Promise<string> {
  try {
    return await operations.stage(target, content);
  } catch (error) {
    throw ioError(kind, error);
  }
}

export async function commitOutputFile(temporary: string, target: string, force: boolean, kind: OutputKind, operations = defaultOutputFileOperations): Promise<void> {
  try {
    await operations.commit(temporary, target, force);
  } catch (error) {
    if (error instanceof AssetAccessError) throw error;
    if (isFileSystemError(error) && error.code === 'EEXIST' && !force) {
      throw new AssetAccessError('E_OUTPUT_EXISTS', `${kind} destination was created while the conversion was running.`, { cause: error });
    }
    throw ioError(kind, error);
  }
}
