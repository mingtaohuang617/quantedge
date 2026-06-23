// 扫 src/pages/*.jsx + src/quant-platform.jsx — 找 JSX 里 hardcoded 的简体中文文本
// （即没包 t()、不在注释/字符串字面量的可见文案），防 i18n 回归。
//
// 启发式（够用即可，不追求 AST 精确）：
//   1) 只看 JSX 文本节点：>中文< 形态（> 和 < 之间出现 CJK）
//   2) 排除：包了 t(...) 的、{...} 表达式内的、注释行、import 行
//   3) 已知"豁免"页：i18n.jsx 自身（含 EN/TW 字典）
//
// 退出码：发现疑似漏翻 → 1（CI 失败）；干净 → 0。
// 注：这是 lint 性质的"提醒"，新增豁免项请在 ALLOWLIST 登记并写原因。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src');
const PAGES_DIR = join(ROOT, 'pages');
const COMPONENTS_DIR = join(ROOT, 'components');

const CJK = /[㐀-䶿一-鿿]/;

// 文件级豁免：这些文件的中文不参与翻译扫描
const FILE_ALLOWLIST = new Set([
  'i18n.jsx',          // 字典本体
]);

// 行级豁免：命中这些子串的整行跳过（数据常量 / 注释密集 / 已知 demo 文案）
const LINE_ALLOW_SUBSTR = [
  '// ', '/*', '* ', '*/',      // 注释
  'import ',                     // import
  'console.',                   // 日志
  'aria-label', 'title=',       // a11y 属性单独宽容（可后续收紧）
];

// 找一行里 JSX 文本节点形态的中文：>...中文...<
// 排除已包 t( 的：若该中文紧贴在 t(' 或 t(" 之后则视为已翻译
function findHardcodedCJK(line) {
  // 已经在 t('...') / t("...") 里 → 跳过整行的这些片段
  // 简化：如果整行包含 t('<含CJK>') 或 t("<含CJK>")，认为该行的中文已翻译
  const tWrapped = /\bt\(\s*['"][^'"]*[㐀-䶿一-鿿]/.test(line);
  // JSX 文本节点：> 后面（非 <）直到下一个 < 之间有 CJK。
  // 用 (?!=) 排除 >= / <= 比较运算符造成的 JS 字符串误报（如三元 `beta >= 1.3 ? "放大波动" : x <= 0.8`）。
  const jsxText = />(?!=)[^<>{}]*[㐀-䶿一-鿿][^<>{}]*<(?!=)/.test(line);
  if (jsxText && !tWrapped) {
    const m = line.match(/>(?!=)([^<>{}]*[㐀-䶿一-鿿][^<>{}]*)<(?!=)/);
    return m ? m[1].trim() : null;
  }
  return null;
}

// 「整行纯中文文本节点」检测（补单行 >中文< 的盲区：多行 JSX text 时
// 中文常独占一行，既无 > 也无 <，旧启发式扫不到，如：
//   <div>
//     未找到该标的        ← 这一行
//   </div>
// ）。判据：剔除块注释后，该行不含任何 JS/JSX 语法符号（<>{}=`;"'）却含 CJK。
// 这类行作为合法 JS 几乎不可能（裸中文标识符/无引号字符串），基本必是文本节点。
const SYNTAX = /[<>{}=`;"']/;
function isBareTextLine(codeLine) {
  return codeLine.length > 0 && CJK.test(codeLine) && !SYNTAX.test(codeLine);
}

function scanFile(path) {
  const src = readFileSync(path, 'utf8');
  const offenders = [];
  let inBlock = false;    // 跨行 /* … */ 状态
  let inTemplate = false; // 跨行 `…` 模板字符串状态（排除多行 prompt / markdown 模板）
  src.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    // ── 维护块注释状态，得到「剔除注释后的代码部分」codeLine ──
    let codeLine = trimmed;
    if (inBlock) {
      const end = trimmed.indexOf('*/');
      if (end === -1) return;            // 整行仍在块注释里
      inBlock = false;
      codeLine = trimmed.slice(end + 2).trim();
    }
    const open = codeLine.indexOf('/*');
    if (open !== -1 && codeLine.indexOf('*/', open) === -1) {
      inBlock = true;
      codeLine = codeLine.slice(0, open).trim();
    }
    // ── 维护模板字符串状态：整行落在多行 `…` 内 → 跳过（模板属字符串内容，非 JSX 文本）──
    const wasInTemplate = inTemplate;
    const ticks = (codeLine.match(/`/g) || []).length;
    if (ticks % 2 === 1) inTemplate = !inTemplate;
    if (wasInTemplate) return;
    if (!CJK.test(codeLine)) return;
    if (LINE_ALLOW_SUBSTR.some(s => codeLine.startsWith(s) || (s.endsWith(' ') && codeLine.includes(s)))) return;
    // 1) 单行 >中文<
    const hit = findHardcodedCJK(line);
    if (hit) { offenders.push({ line: i + 1, text: hit }); return; }
    // 2) 整行纯中文文本节点
    if (isBareTextLine(codeLine)) offenders.push({ line: i + 1, text: codeLine.slice(0, 60) });
  });
  return offenders;
}

function collectFiles() {
  const files = [join(ROOT, 'quant-platform.jsx')];
  for (const dir of [PAGES_DIR, COMPONENTS_DIR]) {
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.jsx') && !e.name.endsWith('.test.jsx')) files.push(p);
      }
    };
    walk(dir);
  }
  return files.filter(f => !FILE_ALLOWLIST.has(basename(f)));
}

const files = collectFiles();
let total = 0;
const report = [];

for (const f of files) {
  const offenders = scanFile(f);
  if (offenders.length) {
    total += offenders.length;
    report.push({ file: f.replace(ROOT, 'src'), offenders });
  }
}

if (total === 0) {
  console.log(`✅ audit:i18n — 扫了 ${files.length} 个文件，未发现 JSX 文本节点里的 hardcoded 简体`);
  process.exit(0);
}

console.log(`⚠ audit:i18n — ${total} 处疑似漏翻（JSX 文本节点里的中文没包 t()）：\n`);
for (const { file, offenders } of report) {
  console.log(`  ${file}`);
  for (const o of offenders.slice(0, 12)) {
    console.log(`     L${o.line}: ${o.text.slice(0, 50)}`);
  }
  if (offenders.length > 12) console.log(`     … 还有 ${offenders.length - 12} 处`);
}
console.log(`\n提醒：每处应包成 t('...')；确属豁免（demo 文案 / 数据常量）请登记到脚本 ALLOWLIST。`);
// 默认非阻塞退出 0（lint 提醒），加 --strict 时阻塞
process.exit(process.argv.includes('--strict') ? 1 : 0);
