// watchlist10x business lib 测试 —— mock KV + universe，不发任何网络请求
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock KV：用内存 Map 模拟 kvGetJson / kvSetJson ──
const _kvStore = new Map();
vi.mock('./kv.js', () => ({
  KV_ENABLED: true,
  kvGetJson: async (key, fallback) => (_kvStore.has(key) ? _kvStore.get(key) : fallback),
  kvSetJson: async (key, obj) => { _kvStore.set(key, JSON.parse(JSON.stringify(obj))); },
  kvGet: async () => null,
  kvSet: async () => {},
  kvDel: async () => {},
}));

// ── mock universeLoader：固定 fixture，对齐 backend test_watchlist_10x.py ──
const _fakeUniverse = [
  { ticker: 'NVDA', name: 'NVIDIA', market: 'US', exchange: 'NASDAQ',
    is_etf: false, sector: 'Semiconductors', industry: 'Semiconductors', marketCap: 3.5e12 },
  { ticker: 'AAOI', name: 'Applied Optoelectronics', market: 'US', exchange: 'NASDAQ',
    is_etf: false, sector: 'Communication Equipment', industry: 'Optical Networks', marketCap: 1.2e9 },
  { ticker: 'LITE', name: 'Lumentum', market: 'US', exchange: 'NASDAQ',
    is_etf: false, sector: '光通信/激光', industry: null, marketCap: 5e9 },
  { ticker: 'AAPL', name: 'Apple', market: 'US', exchange: 'NASDAQ',
    is_etf: false, sector: 'Consumer Electronics', industry: null, marketCap: 3e12 },
  { ticker: 'SOXL', name: 'Direxion Semi 3X', market: 'US', exchange: 'NYSEArca',
    is_etf: true, sector: 'Semiconductors', industry: null, marketCap: 1e10 },
  { ticker: '600171.SH', name: '上海贝岭', market: 'CN', exchange: 'SH',
    is_etf: false, sector: '半导体', industry: '半导体', marketCap: null },
];
vi.mock('./universeLoader.js', () => ({
  loadUniverse: async () => _fakeUniverse.map(it => ({ ...it })),
  universeStats: async () => ({}),
}));

import {
  loadData, addItem, updateItem, removeItem,
  addSupertrend, listAllSupertrends, listItems, screenCandidates,
} from './watchlist10x.js';

beforeEach(() => {
  _kvStore.clear();
});

// ── addItem ─────────────────────────────────────────────
describe('addItem', () => {
  it('basic add 填默认字段', async () => {
    const item = await addItem('AAOI', { strategy: 'growth', supertrend_id: 'optical', moat_score: 4, thesis: '800G' });
    expect(item.ticker).toBe('AAOI');
    expect(item.strategy).toBe('growth');
    expect(item.added_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(item.llm_thesis_cached_at).toBeNull();
  });

  it('uppercases ticker', async () => {
    const item = await addItem('aaoi', { supertrend_id: 'optical' });
    expect(item.ticker).toBe('AAOI');
  });

  it('duplicate raises', async () => {
    await addItem('NVDA', { supertrend_id: 'semi' });
    await expect(addItem('NVDA', { supertrend_id: 'semi' })).rejects.toThrow('已在观察列表');
  });

  it('invalid strategy raises', async () => {
    await expect(addItem('NVDA', { strategy: 'speculative', supertrend_id: 'semi' })).rejects.toThrow(/strategy/);
  });

  it('invalid supertrend_id raises', async () => {
    await expect(addItem('NVDA', { supertrend_id: 'not_real' })).rejects.toThrow(/unknown supertrend_id/);
  });

  it('empty ticker raises', async () => {
    await expect(addItem('   ', { supertrend_id: 'semi' })).rejects.toThrow(/ticker/);
  });
});

// ── addSupertrend ────────────────────────────────────────
describe('addSupertrend with keywords', () => {
  it('persists keywords (trimmed, drops blanks)', async () => {
    const item = await addSupertrend('renewable', '新能源', '光伏/储能', ['光伏', '  储能 ', ''], ['Solar']);
    expect(item.keywords_zh).toEqual(['光伏', '储能']);
    expect(item.keywords_en).toEqual(['Solar']);
  });

  it('conflicts with builtin raises', async () => {
    await expect(addSupertrend('semi', '重复', '')).rejects.toThrow(/与内置冲突/);
  });

  it('user duplicate raises', async () => {
    await addSupertrend('renewable', '新能源', '');
    await expect(addSupertrend('renewable', '新能源2', '')).rejects.toThrow(/已存在/);
  });
});

// ── screenCandidates ────────────────────────────────────
describe('screenCandidates', () => {
  it('semi 命中 NVDA + 600171.SH，不含 AAPL', async () => {
    const out = await screenCandidates({ supertrend_ids: ['semi'] });
    const tickers = out.map(it => it.ticker);
    expect(tickers).toContain('NVDA');
    expect(tickers).toContain('600171.SH');
    expect(tickers).not.toContain('AAPL');
  });

  it('etf excluded by default', async () => {
    const out = await screenCandidates({ supertrend_ids: ['semi'] });
    expect(out.map(it => it.ticker)).not.toContain('SOXL');
  });

  it('include_etf=true keeps SOXL', async () => {
    const out = await screenCandidates({ supertrend_ids: ['semi'], include_etf: true });
    expect(out.map(it => it.ticker)).toContain('SOXL');
  });

  it('include_no_mcap=true (default) keeps 600171.SH 即使设了 max_mcap', async () => {
    const out = await screenCandidates({ supertrend_ids: ['semi'], max_market_cap_b: 100 });
    const tickers = out.map(it => it.ticker);
    expect(tickers).toContain('600171.SH');
    expect(tickers).not.toContain('NVDA');
  });

  it('include_no_mcap=false drops 600171.SH 当设了 max_mcap', async () => {
    const out = await screenCandidates({
      supertrend_ids: ['semi'], max_market_cap_b: 100, include_no_mcap: false,
    });
    expect(out.map(it => it.ticker)).not.toContain('600171.SH');
  });

  it('user supertrend with sector keyword matches', async () => {
    await addSupertrend('hw', '消费电子', '', [], ['Consumer Electronics']);
    const out = await screenCandidates({ supertrend_ids: ['hw'] });
    expect(out.map(it => it.ticker)).toContain('AAPL');
  });

  it('user supertrend keywords apply in precise mode', async () => {
    await addSupertrend('hw', '消费电子', '', [], ['Consumer Electronics']);
    const out = await screenCandidates({ supertrend_ids: ['hw'], precise: true });
    expect(out.map(it => it.ticker)).toContain('AAPL');
  });

  it('exclude_in_watchlist removes already-added ticker', async () => {
    await addItem('NVDA', { supertrend_id: 'semi' });
    const out = await screenCandidates({ supertrend_ids: ['semi'] });
    expect(out.map(it => it.ticker)).not.toContain('NVDA');
  });

  it('sorts by market cap asc with no-mcap last', async () => {
    const out = await screenCandidates({ supertrend_ids: ['semi', 'optical'] });
    const mcs = out.filter(it => it.marketCap != null).map(it => it.marketCap);
    expect(mcs).toEqual([...mcs].sort((a, b) => a - b));
    if (out.some(it => it.marketCap == null)) {
      expect(out[out.length - 1].marketCap).toBeNull();
    }
  });

  it('matched_supertrends 包含命中赛道', async () => {
    const out = await screenCandidates({ supertrend_ids: ['optical'] });
    for (const it of out) {
      expect(it.matched_supertrends).toContain('optical');
    }
  });
});

// ── update / remove / list ───────────────────────────────
describe('updateItem / removeItem', () => {
  it('partial update keeps other fields', async () => {
    await addItem('NVDA', { supertrend_id: 'semi', thesis: 'orig' });
    const updated = await updateItem('NVDA', { thesis: 'new', moat_score: 5 });
    expect(updated.thesis).toBe('new');
    expect(updated.moat_score).toBe(5);
    expect(updated.supertrend_id).toBe('semi');
  });

  it('update unknown ticker raises NOT_FOUND', async () => {
    await expect(updateItem('UNKNOWN', { thesis: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update ignores unknown fields', async () => {
    await addItem('NVDA', { supertrend_id: 'semi' });
    const u = await updateItem('NVDA', { thesis: 'ok', random_garbage: 'ignored' });
    expect(u.random_garbage).toBeUndefined();
  });

  it('remove returns true / false', async () => {
    await addItem('NVDA', { supertrend_id: 'semi' });
    expect(await removeItem('NVDA')).toBe(true);
    expect(await removeItem('NVDA')).toBe(false);
  });
});

// ── listAllSupertrends ───────────────────────────────────
describe('listAllSupertrends', () => {
  it('内置 4 个 + 用户自定义合并', async () => {
    await addSupertrend('renewable', '新能源', '', ['光伏']);
    const sts = await listAllSupertrends();
    const ids = sts.map(s => s.id);
    expect(ids).toContain('ai_compute');
    expect(ids).toContain('semi');
    expect(ids).toContain('optical');
    expect(ids).toContain('datacenter');
    expect(ids).toContain('renewable');
    expect(sts.find(s => s.id === 'renewable').source).toBe('user');
    expect(sts.find(s => s.id === 'semi').source).toBe('builtin');
  });
});
