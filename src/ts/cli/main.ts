import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { productName, version } from '../index.js';
import { CliUsageError, helpText, parseArgs } from './args.js';
import { runFileConversion } from './convert-file.js';

export async function runCli(argv: string[], io: { stdout?: Writable; stderr?: Writable } = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof CliUsageError)) {
      stderr.write('error E_INTERNAL Unexpected internal error.\n');
      return 3;
    }
    stderr.write(`error E_USAGE ${error.message}\n${helpText.split('\n').slice(0, 7).join('\n')}\n`);
    return 2;
  }
  if (parsed.mode === 'help') {
    stdout.write(helpText);
    return 0;
  }
  if (parsed.mode === 'version') {
    stdout.write(`${productName} ${version}\n`);
    return 0;
  }
  return runFileConversion(parsed.options, stdout, stderr);
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) return false;
  try {
    const [entryPath, modulePath] = await Promise.all([
      realpath(process.argv[1]),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return entryPath === modulePath;
  } catch {
    return false;
  }
}

if (await isMainModule()) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.stderr.write('error E_INTERNAL Unexpected internal error.\n');
    process.exitCode = 3;
  });
}
