// Deterministic build artifact containing only the worker's installed dependencies.
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'api/_lib/tradingview-runtime');
const visited = new Set();
async function copyDependency(name, base) {
  let dir;
  for (let cursor = base; ; cursor = path.dirname(cursor)) {
    const candidate = path.join(cursor, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) { dir = candidate; break; }
    if (cursor === path.dirname(cursor)) throw new Error('Missing runtime dependency: ' + name);
  }
  if (visited.has(dir)) return;
  visited.add(dir);
  const relative = path.relative(root, dir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dependency outside frontend');
  await cp(dir, path.join(output, relative), { recursive: true });
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  for (const child of Object.keys(pkg.dependencies || {})) await copyDependency(child, dir);
}
await mkdir(output, { recursive: true });
for (const name of ['@mathieuc/tradingview', 'https-proxy-agent']) await copyDependency(name, root);
await cp(path.join(root, 'api/_lib/tradingview-worker.cjs'), path.join(output, 'worker.cjs'));
await writeFile(path.join(output, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
console.log('Prepared isolated TradingView runtime: ' + visited.size + ' packages');
