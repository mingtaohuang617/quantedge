// 显示属性裸中文审计：扫 JSX 里 placeholder / title / aria-label / alt 四个「会被用户看到/读屏」
// 的属性，断言其值不是 hardcoded 简体——必须经 t() 包裹。
//
// 防的是一类 audit-i18n（只扫 JSX 文本节点）和 audit-i18n-keys（只验 key 在不在字典）都盖不到的泄漏：
//   placeholder="例: 半导体龙头"   ← 字面量属性，双引号内不可能有 t()，en 模式必显简体
//   title={`按 ${x} 排序`}          ← 表达式属性里的裸模板，无 t()
// 这俩都能过现有两个 audit，却在 en 模式直接显示中文（曾漏 BacktestEngine NL 占位符 / Screener 列头 title）。
//
// 判定（高精度，宁可漏报不误报，供 CI 用）：
//   - 字面量形式 attr="…中文…" / attr='…中文…'：双引号/单引号内是纯字符串，含中文表意字即裸渲染 → 报。
//   - 表达式形式 attr={…}：取平衡花括号子串，含中文表意字「字符串/模板字面量」且整段无 t( → 报。
//     （表达式里只要出现 t( 就放行——保守，避免 `cond ? t('a') : '残留'` 这类误判 CI。残留另由人工/lint 抓。）
//   - 跳过注释 / import / 测试文件；中文判定只认表意字 一-鿿㐀-䶿（不含 — · α 等符号，避免误报）。
//
// 退出码：有裸属性 → 1（CI 用 --strict）；默认 0（lint 提醒）。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src');
const IDEOGRAPH = /[一-鿿㐀-䶿]/;          // 中文表意字（不含标点/希腊字母/破折号）
const SKIP_FILES = new Set(['i18n.jsx', 'standalone.js', 'data.js']);
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

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

// 从 openIdx（指向 attr={ 的 `{`）起取平衡花括号子串，返回 {expr, end} 或 null
function balancedBraces(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return { expr: s.slice(openIdx + 1, i), end: i }; }
  }
  return null; // 跨行表达式，本审计不追（够用即可）
}

const attrAlt = ATTRS.map((a) => a.replace(/[-]/g, '\\$&')).join('|');
// 字面量形式要求 `attr="`（= 紧贴，无空格）——这是 JSX 属性写法；
// 默认参数惯例写 `attr = "中文"`（带空格，且由渲染处 t() 决定是否泄漏），不在本审计范围，故排除。
const litRe = new RegExp(`\\b(${attrAlt})=(['"])((?:\\\\.|(?!\\2).)*?)\\2`, 'g');
const exprAttrRe = new RegExp(`\\b(${attrAlt})=\\{`, 'g');

function scan(path) {
  const offenders = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  let inBlock = false;
  lines.forEach((line, i) => {
    const tr = line.trim();
    if (inBlock) { if (tr.includes('*/')) inBlock = false; return; }
    if (tr.startsWith('/*')) { if (!tr.includes('*/')) inBlock = true; return; }
    if (tr.startsWith('//') || tr.startsWith('*') || tr.startsWith('import ')) return;
    if (!IDEOGRAPH.test(line)) return;

    // 字面量形式 attr="…中文…"（双/单引号内必是裸串）
    let m; litRe.lastIndex = 0;
    while ((m = litRe.exec(line))) {
      if (IDEOGRAPH.test(m[3])) offenders.push({ line: i + 1, attr: m[1], text: m[3].slice(0, 40), kind: 'literal' });
    }
    // 表达式形式 attr={…}：取平衡子串，含中文字面量且无 t( → 报
    let e; exprAttrRe.lastIndex = 0;
    while ((e = exprAttrRe.exec(line))) {
      const bal = balancedBraces(line, exprAttrRe.lastIndex - 1);
      if (!bal) continue;                              // 跨行，跳过
      if (!IDEOGRAPH.test(bal.expr)) continue;
      if (/\bt\(/.test(bal.expr)) continue;            // 含 t( 放行（保守）
      offenders.push({ line: i + 1, attr: e[1], text: bal.expr.trim().slice(0, 40), kind: 'expr' });
    }
  });
  return offenders;
}

// 供测试导入：返回 { report, fileCount }（report 空 = 无裸属性）
export function findRawAttrs() {
  const files = collectFiles();
  const report = [];
  for (const f of files) {
    const offs = scan(f);
    if (offs.length) report.push({ file: f.replace(ROOT, 'src'), offs });
  }
  return { report, fileCount: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { report, fileCount } = findRawAttrs();
  const total = report.reduce((n, r) => n + r.offs.length, 0);
  if (total === 0) {
    console.log(`✅ audit:i18n-attrs — 扫了 ${fileCount} 个文件，placeholder/title/aria-label/alt 无裸中文`);
    process.exit(0);
  }
  console.log(`⚠ audit:i18n-attrs — ${total} 处显示属性是 hardcoded 中文（en 模式会显简体）：\n`);
  for (const { file, offs } of report) {
    console.log(`  ${file}`);
    for (const o of offs.slice(0, 12)) console.log(`     L${o.line}: ${o.attr}=${o.kind === 'literal' ? `"${o.text}"` : `{${o.text}…}`}`);
    if (offs.length > 12) console.log(`     … 还有 ${offs.length - 12} 处`);
  }
  console.log(`\n提醒：把这些属性值包 t()（如 placeholder={t('…')} / title={t('…{x}…', { x })}）。`);
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}
