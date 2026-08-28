import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fromHere = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));
const readText = async (relativePath) => (await readFile(fromHere(relativePath), 'utf8')).trim();
const readJson = async (relativePath) => JSON.parse(await readText(relativePath));

const canonical = await readText('../../VERSION');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(canonical)) {
  throw new Error(`VERSION is not valid semver: ${canonical}`);
}

const rootPackage = await readJson('../../package.json');
const frontendPackage = await readJson('../package.json');
const pyproject = await readText('../../pyproject.toml');
const pythonVersion = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const declared = {
  'package.json': rootPackage.version,
  'frontend/package.json': frontendPackage.version,
  'pyproject.toml': pythonVersion,
};
const mismatches = Object.entries(declared).filter(([, version]) => version !== canonical);
if (mismatches.length > 0) {
  throw new Error(
    `Version mismatch; VERSION=${canonical}; ${mismatches.map(([file, version]) => `${file}=${version}`).join(', ')}`,
  );
}

console.log(`QuantEdge version ${canonical} is consistent across project manifests.`);
