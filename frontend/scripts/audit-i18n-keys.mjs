// 字典完整性审计：扫 src 里「会显示的中文字符串字面量」，断言它们都在 EN 字典里。
// 防的是本仓最常见的 i18n 回归：render 处已包 t(x)（或 config 数组 label 经 t() 渲染），
// 但 EN 字典缺该 key → en 模式直接穿透显示简体。audit-i18n.mjs（只扫 JSX 文本节点）抓不到这类。
//
// 启发式（够用即可）：
//   - 只看字符串/模板字面量里的中文；排除注释 / import / console / 纯逻辑串（.includes 等）
//   - 含 ${} 的模板字面量跳过（占位符键需人工，且本审计无法静态求值）
//   - 命中 ALLOWLIST 的非显示串（CSS 选择器 / LLM prompt 片段等）豁免
// EN 字典通过 eval `const EN = {…}` 块取真实键（正确处理转义引号）。
//
// 退出码：缺键 → 1（CI 可用 --strict）；默认 0（lint 提醒）。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src');
const CJK = /[㐀-䶿一-鿿]/;
const SKIP_FILES = new Set(['i18n.jsx', 'standalone.js', 'data.js']);

// 已知非显示中文串：不应进 EN 字典，豁免。新增请写明原因。
const ALLOW = [
  (s) => /\[placeholder\*?=/.test(s),          // querySelector CSS 选择器（按占位符匹配——本身另有 data-* 替代）
  (s) => /^\s*#{1,6}\s/.test(s),               // markdown 标题（LLM prompt 模板片段，如 "## 当前宏观背景"）
  (s) => /export_macro_snapshot|backend\//.test(s), // 含后端路径的运维说明片段
];
const isAllowed = (s) => ALLOW.some((f) => f(s));

// 统一反转义：源码字面量 → 真实字符串值（两侧用同一套，保证可比）
function unescape(raw) {
  return raw
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
    .replace(/\\(['"`\\])/g, '$1');
}

// ── 取 EN 字典真实键（逐行解析，键含 {n}/换行/转义引号都不受影响）──
function loadEnKeys() {
  const src = readFileSync(join(ROOT, 'i18n.jsx'), 'utf8');
  const start = src.indexOf('const EN = {');
  if (start < 0) throw new Error('找不到 const EN = {');
  const keys = new Set();
  const keyRe = /^\s*(['"])((?:\\.|(?!\1).)*?)\1\s*:/;
  for (const line of src.slice(start).split('\n')) {
    if (line.trim() === '};') break;
    const m = line.match(keyRe);
    if (m) keys.add(unescape(m[2]));
  }
  return keys;
}

function collectFiles() {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) && !SKIP_FILES.has(basename(e.name))) files.push(p);
    }
  };
  walk(ROOT);
  return files;
}

const strRe = /(['"`])((?:\\.|(?!\1).)*?)\1/g;
function scan(path, enKeys) {
  const offenders = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  let inBlock = false;
  lines.forEach((line, i) => {
    const tr = line.trim();
    if (inBlock) { if (tr.includes('*/')) inBlock = false; return; }
    if (tr.startsWith('/*')) { if (!tr.includes('*/')) inBlock = true; return; }
    if (tr.startsWith('//') || tr.startsWith('*') || tr.startsWith('import ') || tr.startsWith('console.')) return;
    if (!CJK.test(line)) return;
    let m; strRe.lastIndex = 0;
    while ((m = strRe.exec(line))) {
      const raw = m[2];
      if (!CJK.test(raw)) continue;
      if (m[1] === '`' && raw.includes('${')) continue;            // 含插值模板，跳过
      const before = line.slice(Math.max(0, m.index - 14), m.index);
      if (/\.(includes|startsWith|endsWith|indexOf|split|replace|match)\(\s*$/.test(before)) continue; // 逻辑串
      const s = unescape(raw); // 与 EN 键同一套反转义后比较
      if (enKeys.has(s)) continue;
      if (isAllowed(s)) continue;
      offenders.push({ line: i + 1, text: s.slice(0, 50) });
    }
  });
  return offenders;
}

// 供测试导入：返回 [{file, offs:[{line,text}]}]（空数组 = 字典完整）
export function findMissingKeys() {
  const enKeys = loadEnKeys();
  const files = collectFiles();
  const report = [];
  for (const f of files) {
    const offs = scan(f, enKeys);
    if (offs.length) report.push({ file: f.replace(ROOT, 'src'), offs });
  }
  return { report, fileCount: files.length, keyCount: enKeys.size };
}

// 仅在直接 `node scripts/audit-i18n-keys.mjs` 运行时执行 CLI（被 import 时不触发）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { report, fileCount, keyCount } = findMissingKeys();
  const total = report.reduce((n, r) => n + r.offs.length, 0);
  if (total === 0) {
    console.log(`✅ audit:i18n-keys — 扫了 ${fileCount} 个文件，EN 字典 ${keyCount} 键，未发现缺 key 的显示中文串`);
    process.exit(0);
  }
  console.log(`⚠ audit:i18n-keys — ${total} 处显示中文串不在 EN 字典（en 模式会穿透显示简体）：\n`);
  for (const { file, offs } of report) {
    console.log(`  ${file}`);
    for (const o of offs.slice(0, 12)) console.log(`     L${o.line}: ${o.text}`);
    if (offs.length > 12) console.log(`     … 还有 ${offs.length - 12} 处`);
  }
  console.log(`\n提醒：给 EN 字典补这些 key；确属非显示串（选择器 / prompt 片段）请加进脚本 ALLOW。`);
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}
