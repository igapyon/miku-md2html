import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { c as createTar } from 'tar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(root, 'bundle');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const indexSource = await readFile(path.join(root, 'src/ts/index.ts'), 'utf8');
const sourceVersion = /export const version = '([^']+)'/.exec(indexSource)?.[1];
if (sourceVersion !== packageJson.version || packageLock.version !== packageJson.version || packageLock.packages?.['']?.version !== packageJson.version) {
  throw new Error('package.json, package-lock.json, and runtime version are out of sync.');
}
await mkdir(bundleDir, { recursive: true });
const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  legalComments: 'inline',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  loader: { '.css': 'text', '.viewer': 'text' },
  plugins: [{
    name: 'bundle-css-tree-distribution',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^css-tree$/ }, () => ({ path: path.join(root, 'node_modules/css-tree/dist/csstree.esm.js') }));
    },
  }],
};

await build({
  ...shared,
  entryPoints: [path.join(root, 'src/ts/cli/main.ts')],
  outfile: path.join(bundleDir, 'miku-md2html.mjs'),
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await build({
  ...shared,
  entryPoints: [path.join(root, 'src/ts/index.ts')],
  outfile: path.join(bundleDir, 'miku-md2html-runtime.mjs'),
});

const candidates = [
  '.gitignore', 'CONTRIBUTING.md', 'CONTRIBUTORS.md', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'TODO.md',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'src', 'scripts', 'tests', 'docs',
];
const existing = new Set(await readdir(root));
const entries = candidates.filter((entry) => existing.has(entry));
await createTar({ gzip: true, file: path.join(bundleDir, 'miku-md2html-sources.tgz'), cwd: root, portable: true }, entries);
process.stdout.write(`Built bundles for miku-md2html ${packageJson.version}.\n`);
