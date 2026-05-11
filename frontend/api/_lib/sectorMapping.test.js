// sectorMapping JS 移植版测试 — 与 backend/tests/test_sector_mapping.py 行为对齐
import { describe, it, expect } from 'vitest';
import {
  classifySector,
  classifySectorWithReasons,
  nameMatchesStrict,
  nameMatchesStrictWithReasons,
  listSupertrendsMeta,
  getStrictKeywords,
  SUPERTRENDS,
} from './sectorMapping.js';

describe('classifySector — builtin', () => {
  it('中文"半导体" → semi', () => {
    expect(classifySector('半导体')).toEqual(new Set(['semi']));
  });

  it('英文 Semiconductors → semi', () => {
    expect(classifySector('Semiconductors')).toEqual(new Set(['semi']));
  });

  it('broad 模式光通信扩展词命中', () => {
    expect(classifySector('通讯设备', 'broad')).toEqual(new Set(['optical']));
    expect(classifySector('Communication Equipment', 'broad')).toEqual(new Set(['optical']));
  });

  it('strict 模式光通信扩展词不命中', () => {
    expect(classifySector('通讯设备', 'strict')).toEqual(new Set());
  });

  it('多赛道 OR：HBM 命中 semi + ai_compute', () => {
    const result = classifySector('半导体/HBM');
    expect(result.has('semi')).toBe(true);
    expect(result.has('ai_compute')).toBe(true);
  });

  it('null / 空字符串返回空 set', () => {
    expect(classifySector(null).size).toBe(0);
    expect(classifySector('').size).toBe(0);
    expect(classifySector('  ').size).toBe(0);
  });

  it('未知 sector 返回空 set', () => {
    expect(classifySector('Consumer Electronics')).toEqual(new Set());
  });
});

describe('classifySector — user-defined trends', () => {
  const userTrends = [
    { id: 'renewable', keywords_zh: ['光伏'], keywords_en: ['Solar'] },
  ];

  it('中文关键词命中', () => {
    expect(classifySector('光伏发电', 'broad', userTrends)).toEqual(new Set(['renewable']));
  });

  it('英文关键词命中', () => {
    expect(classifySector('Solar', 'strict', userTrends)).toEqual(new Set(['renewable']));
  });

  it('用户赛道与 builtin 并行（不冲突时多命中）', () => {
    const trends = [{ id: 'renewable', keywords_zh: ['光伏'] }];
    const result = classifySector('半导体/光伏', 'broad', trends);
    expect(result.has('semi')).toBe(true);
    expect(result.has('renewable')).toBe(true);
  });

  it('用户赛道无关键词 → 不命中', () => {
    const trends = [{ id: 'empty' }];
    expect(classifySector('Solar', 'broad', trends).has('empty')).toBe(false);
  });
});

describe('nameMatchesStrict', () => {
  it('英文名含 Optical', () => {
    expect(nameMatchesStrict('Lumentum Optical', ['optical'])).toBe(true);
  });

  it('中文名含 光纤', () => {
    expect(nameMatchesStrict('长飞光纤', ['optical'])).toBe(true);
  });

  it('全大写缩写 HBM 原样匹配', () => {
    expect(nameMatchesStrict('SK Hynix HBM Memory', ['ai_compute'])).toBe(true);
  });

  it('用户赛道名称匹配', () => {
    const userTrends = [{ id: 'renewable', keywords_zh: ['光伏'], keywords_en: ['Solar'] }];
    expect(nameMatchesStrict('First Solar', ['renewable'], userTrends)).toBe(true);
    expect(nameMatchesStrict('晶科光伏', ['renewable'], userTrends)).toBe(true);
  });

  it('不在 wanted 内的用户赛道不参与匹配', () => {
    const userTrends = [{ id: 'renewable', keywords_en: ['Solar'] }];
    expect(nameMatchesStrict('First Solar', ['semi'], userTrends)).toBe(false);
  });

  it('null name 返回 false', () => {
    expect(nameMatchesStrict(null, ['semi'])).toBe(false);
  });
});

describe('listSupertrendsMeta', () => {
  it('返回 7 个内置赛道（4 成长 + 3 价值）并保持稳定顺序', () => {
    const meta = listSupertrendsMeta();
    expect(meta).toHaveLength(7);
    expect(meta.map(m => m.id)).toEqual([
      'ai_compute', 'semi', 'optical', 'datacenter',
      'value_div', 'value_cyclical', 'value_consumer',
    ]);
    for (const m of meta) {
      expect(m.name).toBeTruthy();
      expect(typeof m.note).toBe('string');
    }
  });
});

describe('getStrictKeywords', () => {
  it('返回内置赛道的 strict 关键词（zh + en）', () => {
    const kws = getStrictKeywords(['semi']);
    expect(kws).toContain('半导体');
    expect(kws).toContain('Semiconductor');
  });

  it('未知 id 不抛错', () => {
    expect(getStrictKeywords(['unknown_id'])).toEqual([]);
  });
});

describe('SUPERTRENDS 结构对齐', () => {
  it('每个赛道都有 4 个 keywords 数组（即使空）', () => {
    for (const [tid, spec] of Object.entries(SUPERTRENDS)) {
      expect(Array.isArray(spec.keywords_strict_zh), `${tid}.keywords_strict_zh`).toBe(true);
      expect(Array.isArray(spec.keywords_strict_en), `${tid}.keywords_strict_en`).toBe(true);
      expect(Array.isArray(spec.keywords_broad_zh), `${tid}.keywords_broad_zh`).toBe(true);
      expect(Array.isArray(spec.keywords_broad_en), `${tid}.keywords_broad_en`).toBe(true);
    }
  });
});

// ── 价值型 SUPERTRENDS (v2.0 PR-A) ────────────────────────
describe('classifySector — value supertrends', () => {
  it('value_div 命中能源 / 公用事业关键词', () => {
    expect(classifySector('Oil & Gas Integrated').has('value_div')).toBe(true);
    expect(classifySector('Utilities—Regulated Electric').has('value_div')).toBe(true);
    expect(classifySector('石油').has('value_div')).toBe(true);
    expect(classifySector('公共事业', 'broad').has('value_div')).toBe(true);
  });

  it('value_cyclical 命中银行 / 化工 / 钢铁', () => {
    expect(classifySector('银行业').has('value_cyclical')).toBe(true);
    expect(classifySector('Banks - Regional').has('value_cyclical')).toBe(true);
    expect(classifySector('化工原料').has('value_cyclical')).toBe(true);
    expect(classifySector('Specialty Chemicals').has('value_cyclical')).toBe(true);
  });

  it('value_consumer 命中食品饮料', () => {
    expect(classifySector('食品饮料').has('value_consumer')).toBe(true);
    expect(classifySector('白酒').has('value_consumer')).toBe(true);
    expect(classifySector('Beverages—Non-Alcoholic').has('value_consumer')).toBe(true);
    expect(classifySector('Packaged Foods').has('value_consumer')).toBe(true);
  });
});

describe('listSupertrendsMeta — strategy filter', () => {
  it('strategy="growth" 仅返回 4 个成长赛道', () => {
    const meta = listSupertrendsMeta('growth');
    const ids = meta.map(m => m.id).sort();
    expect(ids).toEqual(['ai_compute', 'datacenter', 'optical', 'semi']);
    for (const m of meta) expect(m.strategy).toBe('growth');
  });

  it('strategy="value" 仅返回 3 个价值赛道', () => {
    const meta = listSupertrendsMeta('value');
    const ids = meta.map(m => m.id).sort();
    expect(ids).toEqual(['value_consumer', 'value_cyclical', 'value_div']);
    for (const m of meta) expect(m.strategy).toBe('value');
  });

  it('strategy=null（默认）返回全部 7 个', () => {
    expect(listSupertrendsMeta()).toHaveLength(7);
    expect(listSupertrendsMeta(null)).toHaveLength(7);
  });

  it('strategy="speculative"（无效）返回空数组', () => {
    expect(listSupertrendsMeta('speculative')).toEqual([]);
  });
});

// ── classify_sector_with_reasons：诊断命中关键词 ─────────────
describe('classifySectorWithReasons', () => {
  it('命中赛道时同时返回触发关键词列表', () => {
    const { matched, reasons } = classifySectorWithReasons('半导体/HBM');
    expect(matched).toEqual(new Set(['semi', 'ai_compute']));
    expect(reasons.semi).toContain('半导体');
    expect(reasons.ai_compute).toContain('HBM');
  });

  it('英文关键词原大小写保留', () => {
    const { matched, reasons } = classifySectorWithReasons('Semiconductors');
    expect(matched).toEqual(new Set(['semi']));
    expect(
      reasons.semi.some(kw => kw.toLowerCase().startsWith('semicon'))
    ).toBe(true);
  });

  it('未命中返回空 set + 空 reasons', () => {
    const { matched, reasons } = classifySectorWithReasons('零售');
    expect(matched.size).toBe(0);
    expect(Object.keys(reasons)).toHaveLength(0);
  });

  it('null / 空字符串行为同 classifySector', () => {
    for (const input of [null, '', '   ']) {
      const { matched, reasons } = classifySectorWithReasons(input);
      expect(matched.size).toBe(0);
      expect(Object.keys(reasons)).toHaveLength(0);
    }
  });

  it('用户赛道关键词命中也带 reasons', () => {
    const userTrends = [{ id: 'renewable', keywords_zh: ['光伏'], keywords_en: ['Solar'] }];
    const { matched, reasons } = classifySectorWithReasons(
      '光伏发电', 'broad', userTrends
    );
    expect(matched.has('renewable')).toBe(true);
    expect(reasons.renewable).toContain('光伏');
  });

  it('reasons 关键词去重', () => {
    const { reasons } = classifySectorWithReasons('Semiconductor Equipment & Materials');
    const semiKws = reasons.semi || [];
    expect(semiKws.length).toBe(new Set(semiKws).size);
  });

  it('与 classifySector 行为完全一致（matched set）', () => {
    const cases = [
      ['半导体/HBM', 'broad'],
      ['半导体/HBM', 'strict'],
      ['通讯设备', 'broad'],
      ['通讯设备', 'strict'],
      ['公共事业', 'broad'],
      ['Semiconductors', 'broad'],
      ['零售', 'broad'],
      [null, 'broad'],
      ['', 'strict'],
    ];
    for (const [s, m] of cases) {
      const a = classifySector(s, m);
      const { matched: b } = classifySectorWithReasons(s, m);
      expect(a, `mismatch (${s}, ${m})`).toEqual(b);
    }
  });

  it('无效 mode 抛错', () => {
    expect(() => classifySectorWithReasons('Semiconductors', 'loose')).toThrow();
  });
});

// ── nameMatchesStrictWithReasons ────────────────────────────
describe('nameMatchesStrictWithReasons', () => {
  it('光纤公司名命中，reasons 含触发关键词', () => {
    const { ok, reasons } = nameMatchesStrictWithReasons('长飞光纤', ['optical']);
    expect(ok).toBe(true);
    expect(reasons.optical).toContain('光纤');
  });

  it('英文关键词大小写不敏感，reasons 保留原大小写', () => {
    const { ok, reasons } = nameMatchesStrictWithReasons(
      'Lumentum Optical Networks Inc', ['optical']
    );
    expect(ok).toBe(true);
    expect(reasons.optical).toContain('Optical');
  });

  it('未命中返回 ok=false + 空 reasons', () => {
    const { ok, reasons } = nameMatchesStrictWithReasons('Apple Inc', ['optical', 'semi']);
    expect(ok).toBe(false);
    expect(Object.keys(reasons)).toHaveLength(0);
  });

  it('用户赛道参与名称匹配', () => {
    const userTrends = [{ id: 'robotics', keywords_zh: ['机器人'], keywords_en: ['Robotics'] }];
    const { ok, reasons } = nameMatchesStrictWithReasons(
      '优必选机器人', ['robotics'], userTrends
    );
    expect(ok).toBe(true);
    expect(reasons.robotics).toContain('机器人');
  });

  it('与 nameMatchesStrict 行为一致', () => {
    const cases = [
      ['长飞光纤', ['optical']],
      ['Apple Inc', ['semi', 'optical']],
      [null, ['semi']],
      ['', ['semi']],
      ['某半导体公司', ['semi']],
    ];
    for (const [n, ids] of cases) {
      const a = nameMatchesStrict(n, ids);
      const { ok: b } = nameMatchesStrictWithReasons(n, ids);
      expect(a, `mismatch (${n}, ${ids})`).toBe(b);
    }
  });
});
