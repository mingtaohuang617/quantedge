// sectorMapping — 行业字符串 → 超级赛道（supertrend）归一化
// 移植自 backend/sector_mapping.py，逻辑保持 1:1 对齐。
// 修改本文件时同步修改 backend 版本，反之亦然。

export const SUPERTRENDS = {
  ai_compute: {
    name: 'AI 算力',
    note: 'AI 软硬件 / 加速器 / HBM / AI 应用',
    keywords_strict_zh: ['AI', 'HBM', '算力', '智能计算', '人工智能'],
    keywords_strict_en: ['Artificial Intelligence'],
    keywords_broad_zh: [
      '应用软件', '软件基础设施', '软件服务',
      '数码解决方案服务', '信息技术服务', '互联网内容与信息',
    ],
    keywords_broad_en: [
      'Software - Application', 'Software - Infrastructure',
      'Information Technology Services', 'Internet Content',
    ],
  },
  semi: {
    name: '半导体',
    note: '设计、制造、设备、材料、存储',
    keywords_strict_zh: ['半导体', '存储', 'MCU', '元器件', 'NAND', 'DRAM', '晶圆', '集成电路', '电子元件'],
    keywords_strict_en: ['Semiconductor', 'Semiconductors', 'Memory'],
    keywords_broad_zh: [],
    keywords_broad_en: [],
  },
  optical: {
    name: '光通信',
    note: '光模块、硅光、CPO、激光器、光纤',
    keywords_strict_zh: ['光通信', '光模块', '硅光', '光纤', '激光'],
    keywords_strict_en: ['Optical', 'Photonic', 'Laser'],
    keywords_broad_zh: ['通讯设备', '通信设备'],
    keywords_broad_en: ['Communication Equipment'],
  },
  datacenter: {
    name: '算力中心',
    note: '数据中心 / 电力 / 公共事业',
    keywords_strict_zh: ['数据中心', '新型电力', '火力发电', '水力发电'],
    keywords_strict_en: ['Data Center', 'Power Producers'],
    keywords_broad_zh: ['公共事业'],
    keywords_broad_en: ['Utilities - Regulated', 'Utilities - Independent'],
  },
};

/** 返回前端用的赛道元数据列表。 */
export function listSupertrendsMeta() {
  return Object.entries(SUPERTRENDS).map(([id, spec]) => ({
    id,
    name: spec.name,
    note: spec.note ?? '',
  }));
}

function _kwForMode(spec, mode) {
  let zh = [...(spec.keywords_strict_zh || [])];
  let en = [...(spec.keywords_strict_en || [])];
  if (mode === 'broad') {
    zh = zh.concat(spec.keywords_broad_zh || []);
    en = en.concat(spec.keywords_broad_en || []);
  }
  return { zh, en };
}

/**
 * 把任意 sector/industry 字符串归类到 supertrend ID 集合。
 *
 * @param {string|null|undefined} rawSector
 * @param {'strict'|'broad'} mode 默认 broad
 * @param {Array<{id, keywords_zh?, keywords_en?}>|null} extraUserTrends
 * @returns {Set<string>}
 */
export function classifySector(rawSector, mode = 'broad', extraUserTrends = null) {
  if (mode !== 'strict' && mode !== 'broad') {
    throw new Error(`mode must be 'strict' or 'broad', got ${mode}`);
  }
  if (!rawSector) return new Set();
  const s = String(rawSector).trim();
  if (!s) return new Set();
  const sLower = s.toLowerCase();
  const matched = new Set();

  for (const [tid, spec] of Object.entries(SUPERTRENDS)) {
    const { zh, en } = _kwForMode(spec, mode);
    if (zh.some(kw => kw && s.includes(kw))) {
      matched.add(tid);
      continue;
    }
    if (en.some(kw => kw && sLower.includes(kw.toLowerCase()))) {
      matched.add(tid);
    }
  }

  // 用户自定义赛道 — 关键词无 strict/broad 之分
  for (const ut of extraUserTrends || []) {
    const tid = ut?.id;
    if (!tid) continue;
    const kwZh = ut.keywords_zh || [];
    const kwEn = ut.keywords_en || [];
    if (kwZh.some(kw => kw && s.includes(kw))) {
      matched.add(tid);
      continue;
    }
    if (kwEn.some(kw => kw && sLower.includes(kw.toLowerCase()))) {
      matched.add(tid);
    }
  }

  return matched;
}

function _hasCJK(s) {
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) return true;
  }
  return false;
}

function _isAllUpperAscii(s) {
  return /^[A-Z]+$/.test(s);
}

/** 给定 supertrend 集合的所有 strict 关键词（builtin only）。 */
export function getStrictKeywords(supertrendIds) {
  const out = [];
  for (const tid of supertrendIds) {
    const spec = SUPERTRENDS[tid];
    if (!spec) continue;
    out.push(...(spec.keywords_strict_zh || []));
    out.push(...(spec.keywords_strict_en || []));
  }
  return out;
}

/** 公司名是否含任意 strict 关键词（含用户赛道）。 */
export function nameMatchesStrict(name, supertrendIds, extraUserTrends = null) {
  if (!name) return false;
  const n = String(name);
  const nLower = n.toLowerCase();
  const wanted = new Set(supertrendIds);

  const builtinKws = getStrictKeywords(supertrendIds);
  const userKws = [];
  for (const ut of extraUserTrends || []) {
    if (wanted.has(ut?.id)) {
      userKws.push(...(ut.keywords_zh || []));
      userKws.push(...(ut.keywords_en || []));
    }
  }

  for (const kw of [...builtinKws, ...userKws]) {
    if (!kw) continue;
    // 中文（含 ASCII 全大写如 "AI"、"HBM" 也走原样匹配分支）
    if (_hasCJK(kw) || _isAllUpperAscii(kw)) {
      if (n.includes(kw)) return true;
    } else {
      if (nLower.includes(kw.toLowerCase())) return true;
    }
  }
  return false;
}
