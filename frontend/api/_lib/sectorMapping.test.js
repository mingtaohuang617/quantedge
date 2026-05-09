// sectorMapping JS 移植版测试 — 与 backend/tests/test_sector_mapping.py 行为对齐
import { describe, it, expect } from 'vitest';
import {
  classifySector,
  nameMatchesStrict,
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
  it('返回 4 个内置赛道并保持稳定顺序', () => {
    const meta = listSupertrendsMeta();
    expect(meta).toHaveLength(4);
    expect(meta.map(m => m.id)).toEqual(['ai_compute', 'semi', 'optical', 'datacenter']);
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
