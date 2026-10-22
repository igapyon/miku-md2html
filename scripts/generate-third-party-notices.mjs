import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const packages = new Map();
for (const [lockPath, details] of Object.entries(lock.packages ?? {})) {
  if (!lockPath.includes('node_modules/')) continue;
  const name = lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (!details.version) continue;
  packages.set(`${name}@${details.version}`, { name, version: details.version, license: details.license ?? 'UNDECLARED' });
}
const rows = [...packages.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
const licenseTexts = new Map();
const missingTexts = [];
for (const item of rows) {
  const packagePath = Object.entries(lock.packages).find(([lockPath, details]) =>
    lockPath.includes('node_modules/') &&
    lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length) === item.name &&
    details.version === item.version,
  )?.[0];
  if (!packagePath) continue;
  const directory = path.join(root, packagePath);
  const names = await readdir(directory).catch(() => []);
  const licenseName = names.find((name) => /^(license|licence|copying)(\.|$)/i.test(name));
  if (!licenseName) {
    missingTexts.push(item);
    continue;
  }
  const text = (await readFile(path.join(directory, licenseName), 'utf8'))
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+$/gm, '')
    .trimEnd();
  const hash = createHash('sha256').update(text).digest('hex');
  const entry = licenseTexts.get(hash) ?? { text, sources: [], licenseIds: new Set() };
  entry.sources.push(`${item.name}@${item.version} (${licenseName})`);
  entry.licenseIds.add(item.license);
  licenseTexts.set(hash, entry);
}
const availableLicenseIds = new Set([...licenseTexts.values()].flatMap((entry) => [...entry.licenseIds]));
const missingLicenseIds = [...new Set(missingTexts.map((item) => item.license).filter((license) => !availableLicenseIds.has(license)))].sort();
const body = [
  '# Third-party notices',
  '',
  `This inventory is generated from package-lock.json (${rows.length} locked package/version entries). It covers runtime, build, and test dependencies. License texts found in installed package distributions are included below, deduplicated by SHA-256. ${missingTexts.length} optional platform package entries have no installed license file in this build environment; their declared identifiers are in the inventory. Matching license texts are included from installed packages with the same declared identifier.`,
  '',
  '| Package | Version | License identifier |',
  '| --- | --- | --- |',
  ...rows.map((item) => `| ${item.name} | ${item.version} | ${item.license} |`),
  '',
  ...(missingLicenseIds.length ? [`No installed license text was found for these identifiers: ${missingLicenseIds.join(', ')}.`, ''] : []),
  '## Included license texts',
  '',
  ...[...licenseTexts.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).flatMap(([hash, entry]) => [
    `### SHA-256 ${hash}`,
    '',
    `Source package files: ${entry.sources.join(', ')}`,
    '',
    '```text',
    entry.text,
    '```',
    '',
  ]),
  'The converter source and project documentation are distributed under Apache-2.0 as stated in [LICENSE](LICENSE).',
  '',
].join('\n');
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), body, 'utf8');
process.stdout.write(`Wrote notices for ${rows.length} locked package/version entries.\n`);
