// sectorMapping — 行业字符串 → 超级赛道（supertrend）归一化
// 移植自 backend/sector_mapping.py，逻辑保持 1:1 对齐。
// 修改本文件时同步修改 backend 版本，反之亦然。

export const SUPERTRENDS = {
  ai_compute: {
    name: 'AI 算力',
    strategy: 'growth',
    note: 'AI 软硬件 / 加速器 / HBM / AI 应用',
    keywords_strict_zh: ['AI', 'HBM', '算力', '智能计算', '人工智能', '消费电子'],
    keywords_strict_en: ['Artificial Intelligence', 'Consumer Electronics'],
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
    keywords_strict_zh: ['数据中心', '新型电力', '火力发电', '水力发电', '独立电力'],
    keywords_strict_en: ['Data Center', 'Power Producers', 'Independent Power'],
    keywords_broad_zh: ['公共事业'],
    keywords_broad_en: ['Utilities - Regulated', 'Utilities - Independent'],
  },
  // ── 成长型 SUPERTRENDS 新增（v3.0）─────────────
  consumer_internet: {
    name: '消费互联网',
    strategy: 'growth',
    note: '电商 / 流媒体 / 社交 / 旅游 / 出行（AMZN/META/BABA/NFLX/UBER 等）',
    keywords_strict_zh: [
      '互联网零售', '互联网内容', '互联网服务',
      '流媒体', '社交媒体', '媒体娱乐',
      '在线广告', '线上零售',
      // Yahoo 中文翻译变体
      '旅游服务', '电子游戏与多媒体', '互动媒体及服务',
      '消费性电讯设备',
      '餐厅', '度假村与赌场', '住宿', '休闲',
    ],
    keywords_strict_en: [
      'Internet Retail', 'Internet Content',
      'Entertainment', 'Travel Services',
      'Restaurants',
      'Specialty Retail',
    ],
    keywords_broad_zh: ['数字广告', '娱乐', '酒店'],
    keywords_broad_en: ['Leisure', 'Lodging', 'Advertising Agencies'],
  },
  ev_auto: {
    name: '电动车与新能源汽车',
    strategy: 'growth',
    note: '整车 / 动力电池 / 充电桩 / 自动驾驶（TSLA/NIO/比亚迪/宁德 等）',
    keywords_strict_zh: [
      '电动车', '新能源汽车', '汽车制造', '动力电池',
      '整车', '自动驾驶',
      // Yahoo 中文翻译
      '汽车', '电气设备',
    ],
    keywords_strict_en: ['Auto Manufacturers', 'Auto - Manufacturers', 'Auto Parts'],
    keywords_broad_zh: ['汽车零部件'],
    keywords_broad_en: ['Auto & Truck Dealerships'],
  },
  biotech: {
    name: '生物科技与创新药',
    strategy: 'growth',
    note: '创新药 / GLP-1 / 基因疗法 / 医疗器械（LLY/NVO/REGN/MRNA 等；区别于大盘药企）',
    keywords_strict_zh: [
      '生物科技', '创新药', '医疗器械', '基因', '诊断试剂', '诊断与研究',
      // Yahoo 中文翻译变体
      '生物技术', '医疗设备', '医疗设备和用品', '化学制药',
      '专业与通用药品制造商',
    ],
    keywords_strict_en: [
      'Biotechnology', 'Medical Devices', 'Diagnostics & Research',
      'Drug Manufacturers—Specialty & Generic',
      'Drug Manufacturers - Specialty',
    ],
    keywords_broad_zh: ['医疗保健'],
    keywords_broad_en: ['Healthcare Plans', 'Medical Care Facilities'],
  },
  defense_aerospace: {
    name: '国防航天',
    strategy: 'growth',
    note: '国防 / 航天 / 武器 / 军工电子（BA/RTX/LMT/NOC/GD/AXON/GE 等）',
    keywords_strict_zh: ['国防', '航天', '军工', '武器', '航空航天与国防'],
    keywords_strict_en: ['Aerospace & Defense', 'Aerospace', 'Defense'],
    keywords_broad_zh: [],
    keywords_broad_en: [],
  },
  // ── 价值型 SUPERTRENDS ────────────────────────
  value_div: {
    name: '高股息蓝筹',
    strategy: 'value',
    note: '公用事业 / 银行龙头 / 能源 / 电信（股息率 > 4%）',
    keywords_strict_zh: [
      '电信运营', '石油', '天然气', '煤炭',
      '电信服务', '受监管电力', '受监管燃气',
      '油气勘探与开发', '油气设备', '油气精炼营销',
    ],
    keywords_strict_en: [
      'Banks—Diversified', 'Oil & Gas Integrated',
      'Telecom Services', 'Utilities—Regulated Electric',
      'Utilities - Regulated Gas',
      'Oil & Gas E&P', 'Oil & Gas Refining', 'Oil & Gas Equipment',
    ],
    keywords_broad_zh: ['公共事业'],
    keywords_broad_en: ['Utilities - Diversified'],
  },
  value_cyclical: {
    name: '周期价值',
    strategy: 'value',
    note: '银行 / 保险 / 化工 / 钢铁 / 券商 / 金融服务（低 PB 入场）',
    keywords_strict_zh: [
      '银行', '保险', '化工', '钢铁', '有色金属', '建材', '证券', '券商',
      '金融服务', '支付', '资本市场', '资产管理',
      '工业机械', '综合货运与物流', '铁路',
    ],
    keywords_strict_en: [
      'Banks - Regional', 'Banks—Regional',
      'Insurance—Property & Casualty', 'Insurance—Life',
      'Insurance—Diversified', 'Insurance Brokers',
      'Capital Markets', 'Asset Management', 'Credit Services',
      'Chemicals', 'Specialty Chemicals',
      'Steel', 'Aluminum', 'Building Materials',
      'Farm & Heavy Construction Machinery',
      'Specialty Industrial Machinery',
      'Railroads',
    ],
    keywords_broad_zh: [],
    keywords_broad_en: [],
  },
  value_consumer: {
    name: '消费稳健',
    strategy: 'value',
    note: '食品饮料 / 必需消费 / 大盘药企 / 大型零售',
    keywords_strict_zh: [
      '食品', '饮料', '白酒', '乳制品', '调味品',
      '大型制药', '制药企业',
      '一般药品制造商', '糖果',
      '折扣零售', '家居装饰零售', '服装鞋类',
    ],
    keywords_strict_en: [
      'Beverages—Non-Alcoholic', 'Beverages - Non-Alcoholic',
      'Beverages—Wineries & Distilleries',
      'Packaged Foods', 'Confectioners',
      'Tobacco',
      'Household & Personal Products',
      'Drug Manufacturers—General', 'Drug Manufacturers - General',
      'Discount Stores', 'Home Improvement Retail',
      'Footwear & Accessories',
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
