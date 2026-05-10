// sectorMapping — 行业字符串 → 超级赛道（supertrend）归一化
// 移植自 backend/sector_mapping.py，逻辑保持 1:1 对齐。
// 修改本文件时同步修改 backend 版本，反之亦然。

export const SUPERTRENDS = {
  ai_compute: {
    name: 'AI 算力',
    strategy: 'growth',
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
    strategy: 'growth',
    note: '设计、制造、设备、材料、存储',
    keywords_strict_zh: ['半导体', '存储', 'MCU', '元器件', 'NAND', 'DRAM', '晶圆', '集成电路', '电子元件'],
    keywords_strict_en: ['Semiconductor', 'Semiconductors', 'Memory'],
    keywords_broad_zh: [],
    keywords_broad_en: [],
  },
  optical: {
    name: '光通信',
    strategy: 'growth',
    note: '光模块、硅光、CPO、激光器、光纤',
    keywords_strict_zh: ['光通信', '光模块', '硅光', '光纤', '激光'],
    keywords_strict_en: ['Optical', 'Photonic', 'Laser'],
    keywords_broad_zh: ['通讯设备', '通信设备'],
    keywords_broad_en: ['Communication Equipment'],
  },
  datacenter: {
    name: '算力中心',
    strategy: 'growth',
    note: '数据中心 / 电力 / 公共事业',
    keywords_strict_zh: ['数据中心', '新型电力', '火力发电', '水力发电'],
    keywords_strict_en: ['Data Center', 'Power Producers'],
    keywords_broad_zh: ['公共事业'],
    keywords_broad_en: ['Utilities - Regulated', 'Utilities - Independent'],
  },
  // ── 价值型 SUPERTRENDS ────────────────────────
  value_div: {
    name: '高股息蓝筹',
    strategy: 'value',
    note: '公用事业 / 银行龙头 / 能源 / 电信（股息率 > 4%）',
    keywords_strict_zh: ['电信运营', '石油', '天然气', '煤炭'],
    keywords_strict_en: [
      'Banks—Diversified', 'Oil & Gas Integrated',
      'Telecom Services', 'Utilities—Regulated Electric',
      'Utilities - Regulated Gas',
    ],
    keywords_broad_zh: ['公共事业'],
    keywords_broad_en: ['Utilities - Diversified'],
  },
  value_cyclical: {
    name: '周期价值',
    strategy: 'value',
    note: '银行 / 保险 / 化工 / 钢铁（低 PB 入场）',
    keywords_strict_zh: ['银行', '保险', '化工', '钢铁', '有色金属', '建材'],
    keywords_strict_en: [
      'Banks - Regional', 'Banks—Regional',
      'Insurance—Property & Casualty', 'Insurance—Life',
      'Chemicals', 'Specialty Chemicals',
      'Steel', 'Aluminum',
      'Building Materials',
    ],
    keywords_broad_zh: [],
    keywords_broad_en: [],
  },
  value_consumer: {
    name: '消费稳健',
    strategy: 'value',
    note: '食品饮料 / 必需消费（穿越周期 ROE）',
    keywords_strict_zh: ['食品', '饮料', '白酒', '乳制品', '调味品'],
    keywords_strict_en: [
      'Beverages—Non-Alcoholic', 'Beverages - Non-Alcoholic',
      'Beverages—Wineries & Distilleries',
      'Packaged Foods', 'Confectioners',
      'Tobacco',
      'Household & Personal Products',
    ],
    keywords_broad_zh: [],
    keywords_broad_en: [],
  },
};

/** 返回前端用的赛道元数据列表。
 * @param {string|null} strategy "growth" | "value" | null（全部）
 */
export function listSupertrendsMeta(strategy = null) {
  const out = [];
  for (const [id, spec] of Object.entries(SUPERTRENDS)) {
    const sp = spec.strategy ?? 'growth';
    if (strategy != null && sp !== strategy) continue;
    out.push({ id, name: spec.name, note: spec.note ?? '', strategy: sp });
  }
  return out;
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
 * 同 classifySector，但额外返回每个命中赛道触发的关键词列表。
 *
 * @param {string|null|undefined} rawSector
 * @param {'strict'|'broad'} mode
 * @param {Array<{id, keywords_zh?, keywords_en?}>|null} extraUserTrends
 * @returns {{ matched: Set<string>, reasons: Record<string, string[]> }}
 *   reasons[trend_id] = [kw1, kw2, ...]（按 zh 后 en 顺序去重）
 */
export function classifySectorWithReasons(rawSector, mode = 'broad', extraUserTrends = null) {
  if (mode !== 'strict' && mode !== 'broad') {
    throw new Error(`mode must be 'strict' or 'broad', got ${mode}`);
  }
  const matched = new Set();
  const reasons = {};
  if (!rawSector) return { matched, reasons };
  const s = String(rawSector).trim();
  if (!s) return { matched, reasons };
  const sLower = s.toLowerCase();

  const collect = (tid, zh, en) => {
    const hits = [];
    for (const kw of zh) {
      if (kw && s.includes(kw) && !hits.includes(kw)) hits.push(kw);
    }
    for (const kw of en) {
      if (kw && sLower.includes(kw.toLowerCase()) && !hits.includes(kw)) hits.push(kw);
    }
    if (hits.length) {
      matched.add(tid);
      if (!reasons[tid]) reasons[tid] = [];
      for (const kw of hits) {
        if (!reasons[tid].includes(kw)) reasons[tid].push(kw);
      }
    }
  };

  for (const [tid, spec] of Object.entries(SUPERTRENDS)) {
    const { zh, en } = _kwForMode(spec, mode);
    collect(tid, zh, en);
  }

  // 用户自定义赛道
  for (const ut of extraUserTrends || []) {
    const tid = ut?.id;
    if (!tid) continue;
    collect(tid, ut.keywords_zh || [], ut.keywords_en || []);
  }

  return { matched, reasons };
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
  return classifySectorWithReasons(rawSector, mode, extraUserTrends).matched;
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

/**
 * 同 nameMatchesStrict，但返回 (是否命中, 各赛道命中的关键词)。
 * @returns {{ ok: boolean, reasons: Record<string, string[]> }}
 */
export function nameMatchesStrictWithReasons(name, supertrendIds, extraUserTrends = null) {
  const reasons = {};
  if (!name) return { ok: false, reasons };
  const n = String(name);
  const nLower = n.toLowerCase();
  const wanted = new Set(supertrendIds);

  const kwHits = (kws) => {
    const hits = [];
    for (const kw of kws) {
      if (!kw) continue;
      if (_hasCJK(kw) || _isAllUpperAscii(kw)) {
        if (n.includes(kw) && !hits.includes(kw)) hits.push(kw);
      } else {
        if (nLower.includes(kw.toLowerCase()) && !hits.includes(kw)) hits.push(kw);
      }
    }
    return hits;
  };

  // builtin 按 trend 分组
  for (const tid of wanted) {
    const spec = SUPERTRENDS[tid];
    if (!spec) continue;
    const kws = [...(spec.keywords_strict_zh || []), ...(spec.keywords_strict_en || [])];
    const hits = kwHits(kws);
    if (hits.length) reasons[tid] = hits;
  }

  // user trend
  for (const ut of extraUserTrends || []) {
    const tid = ut?.id;
    if (!wanted.has(tid)) continue;
    const kws = [...(ut.keywords_zh || []), ...(ut.keywords_en || [])];
    const hits = kwHits(kws);
    if (hits.length) {
      if (!reasons[tid]) reasons[tid] = [];
      for (const kw of hits) {
        if (!reasons[tid].includes(kw)) reasons[tid].push(kw);
      }
    }
  }

  return { ok: Object.keys(reasons).length > 0, reasons };
}

/** 公司名是否含任意 strict 关键词（含用户赛道）。 */
export function nameMatchesStrict(name, supertrendIds, extraUserTrends = null) {
  return nameMatchesStrictWithReasons(name, supertrendIds, extraUserTrends).ok;
}
