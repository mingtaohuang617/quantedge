// 综合 import audit — 扫 src/pages/*.jsx 找出三类漏 import：
//  1) lucide-react 图标
//  2) React hooks (useState/useEffect/useRef/useMemo/useCallback/useContext)
//  3) recharts 组件 (XAxis/YAxis/Tooltip/ResponsiveContainer/...)
// 这些都是"用了没 import"在 prod minify 后会爆 ReferenceError，且 ErrorBoundary
// 会兜住 React 渲染期错误使 pageerror 也抓不到的盲区
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src');
const PAGES_DIR = join(ROOT, 'pages');
const MAIN_FILE = join(ROOT, 'quant-platform.jsx');

// React 所有可能的 hook（运行时引用即触发）
const REACT_HOOKS = new Set([
  'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext',
  'useReducer', 'useLayoutEffect', 'useImperativeHandle', 'useTransition', 'useDeferredValue',
  'useId', 'useSyncExternalStore', 'useInsertionEffect',
  'memo', 'forwardRef', 'lazy', 'Suspense', 'Fragment',
]);

// Recharts 顶层导出（与 quant-platform.jsx 原 import 一致）
const RECHARTS_EXPORTS = new Set([
  'LineChart', 'Line', 'AreaChart', 'Area', 'BarChart', 'Bar', 'XAxis', 'YAxis',
  'CartesianGrid', 'Tooltip', 'ResponsiveContainer', 'RadarChart', 'Radar',
  'PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis', 'PieChart', 'Pie', 'Cell',
  'Legend', 'ComposedChart', 'ReferenceLine', 'ReferenceArea',
]);

function extractMaster(src, fromMatch) {
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${fromMatch}"`, 'm');
  const m = src.match(re);
  if (!m) return new Set();
  return new Set(m[1].split(',').map(s => s.replace(/\s+as\s+\w+/, '').trim()).filter(Boolean));
}

function extractReactImports(src) {
  // import React, { ... } from "react"
  const re = /import\s+React(?:\s*,\s*)?\{?([^}]*)\}?\s*from\s*"react"/m;
  const m = src.match(re);
  if (!m) return new Set(['React']);
  const named = (m[1] || '').split(',').map(s => s.trim()).filter(Boolean);
  return new Set(['React', ...named]);
}

function findIdentifiers(src, names) {
  // 识别名字作为 JSX 标签 (<Foo) 或函数调用 (Foo() / Foo<...>)
  const found = new Set();
  for (const n of names) {
    // 必须是单词边界
    const re = new RegExp(`(<${n}[\\s/>]|\\b${n}\\s*\\()`, 'g');
    if (re.test(src)) found.add(n);
  }
  return found;
}

const mainSrc = readFileSync(MAIN_FILE, 'utf8');
const lucideMaster = extractMaster(mainSrc, 'lucide-react');
console.log(`[Master] lucide: ${lucideMaster.size} icons in quant-platform.jsx`);
console.log(`[Master] React hooks: ${REACT_HOOKS.size}, recharts: ${RECHARTS_EXPORTS.size}`);

const pages = readdirSync(PAGES_DIR).filter(f => f.endsWith('.jsx'));
let totalMissing = 0;

for (const page of pages) {
  const src = readFileSync(join(PAGES_DIR, page), 'utf8');
  const lucideImported = extractMaster(src, 'lucide-react');
  const rechartsImported = extractMaster(src, 'recharts');
  const reactImported = extractReactImports(src);

  const lucideUsed = findIdentifiers(src, [...lucideMaster]);
  const reactUsed = findIdentifiers(src, [...REACT_HOOKS]);
  const rechartsUsed = findIdentifiers(src, [...RECHARTS_EXPORTS]);

  const lucideMissing = [...lucideUsed].filter(n => !lucideImported.has(n));
  const reactMissing = [...reactUsed].filter(n => !reactImported.has(n));
  const rechartsMissing = [...rechartsUsed].filter(n => !rechartsImported.has(n));

  const issues = lucideMissing.length + reactMissing.length + rechartsMissing.length;
  if (issues === 0) {
    console.log(`✓ ${page}`);
    continue;
  }
  console.log(`\n❌ ${page} — ${issues} 处漏 import:`);
  if (lucideMissing.length) console.log(`     lucide: ${lucideMissing.join(', ')}`);
  if (reactMissing.length) console.log(`     react:  ${reactMissing.join(', ')}`);
  if (rechartsMissing.length) console.log(`     recharts: ${rechartsMissing.join(', ')}`);
  totalMissing += issues;
}

if (totalMissing > 0) {
  console.log(`\n❌ 总计 ${totalMissing} 处漏 import — 修复后再上线`);
  process.exit(1);
}
console.log(`\n✅ 所有 page 的 lucide / react / recharts import 全齐`);
