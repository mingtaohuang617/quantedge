import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'data.js');
const outputDir = path.join(root, 'src', 'data-markets');
const { STOCKS = [], ALERTS = [] } = await import(`${pathToFileURL(source).href}?split=${Date.now()}`);

const groups = {
  us: new Set(['US', 'JP', 'KR']),
  hk: new Set(['HK']),
  cn: new Set(['SH', 'SZ']),
};

mkdirSync(outputDir, { recursive: true });
for (const [name, markets] of Object.entries(groups)) {
  const stocks = STOCKS.filter(stock => markets.has(stock.market));
  const body = `// 自动生成，请运行 npm run data:split 更新。\nexport const STOCKS = ${JSON.stringify(stocks)};\n`;
  writeFileSync(path.join(outputDir, `${name}.js`), body, 'utf8');
  console.log(`${name}: ${stocks.length} stocks`);
}

writeFileSync(
  path.join(outputDir, 'alerts.js'),
  `// 自动生成，请运行 npm run data:split 更新。\nexport const ALERTS = ${JSON.stringify(ALERTS)};\n`,
  'utf8',
);
console.log(`alerts: ${ALERTS.length}`);
