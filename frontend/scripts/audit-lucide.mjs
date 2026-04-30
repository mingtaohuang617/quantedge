// 扫描 src/pages/*.jsx — 找出 JSX 用到但没 import 的 lucide-react 图标
// 思路：lucide 图标在 quant-platform.jsx 中有完整 import，作为"已知图标"清单
//      然后扫每个 page 的 import lucide-react + JSX 用法，对比
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src');
const PAGES_DIR = join(ROOT, 'pages');
const MAIN_FILE = join(ROOT, 'quant-platform.jsx');

// 从 quant-platform.jsx 的 lucide-react import 提取所有可能的图标名（master list）
function extractLucideMaster() {
  const src = readFileSync(MAIN_FILE, 'utf8');
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/);
  if (!m) return new Set();
  return new Set(m[1].split(',').map(s => s.trim()).filter(Boolean));
}

// 从某个文件的 import block 提取 lucide-react 已 import 的图标
function extractFileLucideImports(src) {
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/);
  if (!m) return new Set();
  return new Set(m[1].split(',').map(s => s.trim()).filter(Boolean));
}

// 找文件中 JSX 形式 <IconName ...> 或 <IconName/> 的使用
function findJsxUsages(src) {
  const re = /<([A-Z][a-zA-Z0-9]+)(\s|\/|>)/g;
  const used = new Set();
  let m;
  while ((m = re.exec(src)) !== null) used.add(m[1]);
  return used;
}

const master = extractLucideMaster();
console.log(`[Master] lucide imports in quant-platform.jsx: ${master.size}`);

const pages = readdirSync(PAGES_DIR).filter(f => f.endsWith('.jsx'));
let totalMissing = 0;

for (const page of pages) {
  const src = readFileSync(join(PAGES_DIR, page), 'utf8');
  const imported = extractFileLucideImports(src);
  const used = findJsxUsages(src);
  // 漏的 = 用了 + 是 lucide master list 里的 + 没在本文件 import
  const missing = [...used].filter(n => master.has(n) && !imported.has(n));
  if (missing.length > 0) {
    console.log(`\n❌ ${page} — 缺 ${missing.length} 个 lucide import:`);
    for (const n of missing) console.log(`     ${n}`);
    totalMissing += missing.length;
  } else {
    console.log(`✓ ${page} — 全部 ${imported.size} 个 lucide import 已 covered`);
  }
}

if (totalMissing > 0) {
  console.log(`\n❌ 总计 ${totalMissing} 个漏 import — 需修复`);
  process.exit(1);
} else {
  console.log(`\n✅ 所有 page 的 lucide import 都齐全`);
}
