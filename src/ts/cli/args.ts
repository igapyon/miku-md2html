import { isValidLanguageTag } from '../core/front-matter.js';
import { productName, version } from '../index.js';

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export type CliOptions = {
  input: string;
  output: string;
  title?: string;
  lang?: string;
  assetRoot?: string;
  imageMode: 'reference' | 'embed';
  noToc: boolean;
  maxOutputMib: number;
  reportJson?: string;
  force: boolean;
};

export type ParsedCli = { mode: 'convert'; options: CliOptions } | { mode: 'help' } | { mode: 'version' };

const valueOptions = new Set(['--out', '--title', '--lang', '--asset-root', '--image-mode', '--max-output-mib', '--report-json']);
const booleanOptions = new Set(['--no-toc', '--force']);

export const helpText = `${productName} ${version}

Convert one local Markdown file into an HTML file. Local raster images are referenced by default.

Usage:
  node miku-md2html-${version}.mjs <input.md> --out <output.html> [options]
  node miku-md2html-${version}.mjs --help
  node miku-md2html-${version}.mjs --version

Options:
  --out <file>             Required .html destination.
  --title <text>           Override the document title.
  --lang <tag>             Set the document language (default: ja).
  --asset-root <directory> Allow local image files under this directory.
  --image-mode <mode>      reference (default) or embed local raster images.
  --no-toc                 Omit the generated table of contents.
  --max-output-mib <n>     HTML size limit from 1 through 1024 MiB (default: 100).
  --report-json <file>     Write a versioned JSON result report.
  --force                  Replace existing regular output/report files.
  --help                   Show this help.
  --version                Show the full package version.

The output embeds CSS, viewer JavaScript, SVG, and data URL images. Local raster images stay at their original paths unless --image-mode embed is used. Remote images are rejected.
Local image file problems produce warnings. Images larger than 5 MiB and HTML larger than 20 MiB produce warnings. The default HTML cap is 100 MiB.
The Markdown input itself must not exceed the configured HTML cap.
Success writes a one-line summary to stdout; diagnostics go to stderr. Exit codes: 0 success, 1 conversion/I/O failure, 2 usage error, 3 internal error.

Example:
  node miku-md2html-${version}.mjs ./guide.md --out ./out/guide.html
`;

export function parseArgs(argv: string[]): ParsedCli {
  if (argv.length === 1 && argv[0] === '--help') return { mode: 'help' };
  if (argv.length === 1 && argv[0] === '--version') return { mode: 'version' };
  if (argv.length === 0) throw new CliUsageError('No input file was provided.');

  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  let parseOptions = true;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (parseOptions && token === '--') {
      parseOptions = false;
      continue;
    }
    if (!parseOptions || !token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const key = equals < 0 ? token : token.slice(0, equals);
    const inlineValue = equals < 0 ? undefined : token.slice(equals + 1);
    if (!valueOptions.has(key) && !booleanOptions.has(key)) throw new CliUsageError(`Unknown option: ${key}`);
    if (values.has(key) || flags.has(key)) throw new CliUsageError(`Option may only be specified once: ${key}`);
    if (booleanOptions.has(key)) {
      if (inlineValue !== undefined) throw new CliUsageError(`Boolean option does not accept a value: ${key}`);
      flags.add(key);
      continue;
    }
    let value = inlineValue;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) throw new CliUsageError(`Missing value for ${key}`);
      value = next;
      i += 1;
    }
    if (!value.trim()) throw new CliUsageError(`Value for ${key} must not be empty.`);
    values.set(key, value);
  }

  if (positional.length !== 1) throw new CliUsageError(positional.length ? 'Provide exactly one input file.' : 'No input file was provided.');
  const input = positional[0]!;
  const output = values.get('--out');
  if (!output) throw new CliUsageError('Required option --out is missing.');
  if (!/\.(?:md|markdown)$/i.test(input)) throw new CliUsageError('Input must end in .md or .markdown.');
  if (!/\.html$/i.test(output)) throw new CliUsageError('Output path must end in .html.');
  const title = values.get('--title');
  if (title !== undefined && !title.trim()) throw new CliUsageError('--title must not be blank.');
  const lang = values.get('--lang');
  if (lang !== undefined && !isValidLanguageTag(lang.trim())) throw new CliUsageError('--lang must be an ASCII language tag such as ja or en-US.');
  const imageMode = values.get('--image-mode') ?? 'reference';
  if (imageMode !== 'reference' && imageMode !== 'embed') throw new CliUsageError('--image-mode must be reference or embed.');
  const maxText = values.get('--max-output-mib') ?? '100';
  if (!/^\d+$/.test(maxText)) throw new CliUsageError('--max-output-mib must be an integer from 1 through 1024.');
  const maxOutputMib = Number(maxText);
  if (!Number.isSafeInteger(maxOutputMib) || maxOutputMib < 1 || maxOutputMib > 1024) throw new CliUsageError('--max-output-mib must be an integer from 1 through 1024.');
  return {
    mode: 'convert',
    options: {
      input,
      output,
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(lang !== undefined ? { lang: lang.trim() } : {}),
      ...(values.has('--asset-root') ? { assetRoot: values.get('--asset-root')! } : {}),
      imageMode,
      noToc: flags.has('--no-toc'),
      maxOutputMib,
      ...(values.has('--report-json') ? { reportJson: values.get('--report-json')! } : {}),
      force: flags.has('--force'),
    },
  };
}
