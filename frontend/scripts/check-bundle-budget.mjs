import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'dist', '.vite', 'manifest.json');
const baselinePath = path.join(root, 'bundle-budget.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

function gzipBytes(file) {
  return gzipSync(readFileSync(path.join(root, 'dist', file)), { level: 9 }).byteLength;
}

function collectGraph(key, visited = new Set()) {
  if (!key || visited.has(key) || !manifest[key]) return visited;
  visited.add(key);
  for (const imported of manifest[key].imports || []) collectGraph(imported, visited);
  return visited;
}

function graphBytes(keys) {
  const files = new Set([...keys].map(key => manifest[key]?.file).filter(file => file?.endsWith('.js')));
  return [...files].reduce((total, file) => total + gzipBytes(file), 0);
}

const entryKey = Object.keys(manifest).find(key => manifest[key].isEntry);
if (!entryKey) throw new Error('Vite manifest has no entry chunk');
const initialGraph = collectGraph(entryKey);
const initialGzipBytes = graphBytes(initialGraph);
const initialLimit = Math.ceil(baseline.initialGzipBytes * (1 + baseline.maxInitialGrowthPercent / 100));

const lazyRoutes = Object.entries(manifest)
  .filter(([key, value]) => key.startsWith('src/pages/') && value.isDynamicEntry)
  .map(([key, value]) => {
    const routeGraph = collectGraph(key);
    const incremental = new Set([...routeGraph].filter(item => !initialGraph.has(item)));
    return { route: value.name || key, gzipBytes: graphBytes(incremental) };
  })
  .sort((a, b) => b.gzipBytes - a.gzipBytes);

const failures = [];
if (initialGzipBytes > initialLimit) {
  failures.push(`initial JS ${initialGzipBytes} B exceeds ${initialLimit} B`);
}
for (const route of lazyRoutes) {
  const routeBaseline = baseline.routeBaselines?.[route.route];
  if (routeBaseline && route.gzipBytes > Math.ceil(routeBaseline * 1.05)) {
    failures.push(`${route.route} grew more than 5%: ${route.gzipBytes} B > ${Math.ceil(routeBaseline * 1.05)} B`);
  }
  if (baseline.enforceLazyAbsolute && route.gzipBytes > baseline.lazyRouteGzipLimitBytes) {
    failures.push(`${route.route} exceeds lazy-route limit: ${route.gzipBytes} B > ${baseline.lazyRouteGzipLimitBytes} B`);
  }
}

console.log(JSON.stringify({
  initialGzipBytes,
  initialLimit,
  target30PercentReductionBytes: Math.floor(baseline.initialGzipBytes * 0.7),
  lazyRouteLimitBytes: baseline.lazyRouteGzipLimitBytes,
  lazyRoutes,
}, null, 2));

if (failures.length) {
  console.error(`Bundle budget failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
