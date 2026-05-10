// watchlist_10x — 业务逻辑（移植自 backend/watchlist_10x.py）
//
// 持久化：Vercel KV (Upstash Redis REST)，key = "qe:wl:10x"
//   value: { version, user_supertrends: [], items: [] }
//
// KV 未配置时 loadData 返回空结构，写操作 throw —— 调用方需 try/catch 给 503。

import { KV_ENABLED, kvGetJson, kvSetJson } from './kv.js';
import {
  listSupertrendsMeta,
  classifySectorWithReasons,
  nameMatchesStrictWithReasons,
} from './sectorMapping.js';
import { loadUniverse } from './universeLoader.js';

const KEY = 'qe:wl:10x';
const ALLOWED_STRATEGIES = new Set(['growth', 'value']);
const VALID_FIELDS = new Set([
  'strategy', 'supertrend_id', 'bottleneck_layer', 'bottleneck_tag',
  'moat_score', 'thesis', 'target_price', 'stop_loss', 'tags',
  'llm_thesis_cached_at',
]);

function emptyData() {
  return { version: 1, user_supertrends: [], items: [] };
}

export async function loadData() {
  if (!KV_ENABLED) return emptyData();
  const data = await kvGetJson(KEY, emptyData());
  data.version ??= 1;
  data.user_supertrends ??= [];
  data.items ??= [];
  return data;
}

async function saveData(data) {
  if (!KV_ENABLED) {
    const e = new Error('KV not configured');
    e.code = 'KV_DISABLED';
    throw e;
  }
  await kvSetJson(KEY, data);
}

/** 合并 builtin + user 自定义，user 与 builtin id 冲突时跳过用户版。
 *  每项含 strategy: "growth" | "value"（user 老数据缺失则默认 "growth"）
 */
export function mergeSupertrends(data) {
  const builtin = listSupertrendsMeta().map(m => ({ ...m, source: 'builtin' }));
  const builtinIds = new Set(builtin.map(b => b.id));
  const user = (data.user_supertrends || [])
    .filter(u => !builtinIds.has(u.id))
    .map(u => ({ ...u, source: 'user', strategy: u.strategy ?? 'growth' }));
  return [...builtin, ...user];
}

export async function listAllSupertrends() {
  return mergeSupertrends(await loadData());
}

export async function listItems() {
  return (await loadData()).items;
}

export async function addItem(ticker, fields = {}) {
  const tk = String(ticker || '').trim().toUpperCase();
  if (!tk) throw new Error('ticker 不能为空');

  const strategy = fields.strategy ?? 'growth';
  if (!ALLOWED_STRATEGIES.has(strategy)) {
    throw new Error(`strategy must be one of growth/value, got '${strategy}'`);
  }

  const data = await loadData();
  const validIds = new Set(mergeSupertrends(data).map(s => s.id));
  if (fields.supertrend_id != null && !validIds.has(fields.supertrend_id)) {
    throw new Error(`unknown supertrend_id: ${fields.supertrend_id}`);
  }
  if (data.items.some(it => it.ticker === tk)) {
    throw new Error(`${tk} 已在观察列表`);
  }

  const item = {
    ticker: tk,
    added_at: new Date().toISOString().slice(0, 10),
    strategy,
    supertrend_id: fields.supertrend_id ?? null,
    bottleneck_layer: fields.bottleneck_layer ?? null,
    bottleneck_tag: fields.bottleneck_tag ?? '',
    moat_score: fields.moat_score ?? null,
    thesis: fields.thesis ?? '',
    target_price: fields.target_price ?? null,
    stop_loss: fields.stop_loss ?? null,
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    llm_thesis_cached_at: null,
  };
  data.items.push(item);
  await saveData(data);
  return item;
}

export async function updateItem(ticker, fields = {}) {
  const tk = String(ticker || '').trim().toUpperCase();

  if (fields.strategy != null && !ALLOWED_STRATEGIES.has(fields.strategy)) {
    throw new Error('strategy must be one of growth/value');
  }

  const data = await loadData();
  const validIds = new Set(mergeSupertrends(data).map(s => s.id));
  if (fields.supertrend_id != null && !validIds.has(fields.supertrend_id)) {
    throw new Error(`unknown supertrend_id: ${fields.supertrend_id}`);
  }

  const it = data.items.find(x => x.ticker === tk);
  if (!it) {
    const e = new Error(`${tk} not found`);
    e.code = 'NOT_FOUND';
    throw e;
  }

  for (const [k, v] of Object.entries(fields)) {
    if (VALID_FIELDS.has(k)) it[k] = v;
  }
  await saveData(data);
  return it;
}

export async function removeItem(ticker) {
  const tk = String(ticker || '').trim().toUpperCase();
  const data = await loadData();
  const n0 = data.items.length;
  data.items = data.items.filter(it => it.ticker !== tk);
  if (data.items.length < n0) {
    await saveData(data);
    return true;
  }
  return false;
}

export async function addSupertrend(
  id, name, note = '',
  keywords_zh = [], keywords_en = [],
  strategy = 'growth',
) {
  const sid = String(id || '').trim();
  if (!sid) throw new Error('supertrend_id 不能为空');
  if (strategy !== 'growth' && strategy !== 'value') {
    throw new Error(`strategy must be 'growth' or 'value', got '${strategy}'`);
  }

  const builtinIds = new Set(listSupertrendsMeta().map(m => m.id));
  if (builtinIds.has(sid)) throw new Error(`赛道 id '${sid}' 与内置冲突`);

  const data = await loadData();
  if (data.user_supertrends.some(s => s.id === sid)) {
    throw new Error(`赛道 id '${sid}' 已存在`);
  }

  const newItem = {
    id: sid,
    name: String(name || '').trim() || sid,
    note: String(note || ''),
    strategy,
    keywords_zh: (keywords_zh || []).map(k => String(k).trim()).filter(Boolean),
    keywords_en: (keywords_en || []).map(k => String(k).trim()).filter(Boolean),
  };
  data.user_supertrends.push(newItem);
  await saveData(data);
  return newItem;
}

/**
 * 候选筛选 — 1:1 移植自 backend/watchlist_10x.py:screen_candidates
 *
 * @returns {Promise<Array>} candidates with matched_supertrends
 */
export async function screenCandidates(opts = {}) {
  const {
    supertrend_ids = [],
    markets = ['US', 'HK', 'CN'],
    max_market_cap_b = null,
    min_market_cap_b = null,
    include_etf = false,
    exclude_in_watchlist = true,
    limit = 200,
    precise = false,
    include_no_mcap = true,
    // 价值型 5 维（v2.0 新增）
    max_pe = null,
    max_pb = null,
    min_roe = null,
    min_dividend_yield = null,
    max_debt_to_equity = null,
    include_no_fundamentals = true,
  } = opts;

  const wanted = new Set(supertrend_ids || []);
  const universe = await loadUniverse(markets);
  const data = await loadData();
  const userTrends = (data.user_supertrends || []).filter(
    ut => (ut.keywords_zh && ut.keywords_zh.length) || (ut.keywords_en && ut.keywords_en.length)
  );

  let filtered;
  if (wanted.size > 0) {
    filtered = [];
    const mode = precise ? 'strict' : 'broad';
    for (const it of universe) {
      const { matched: secAll, reasons: secKw } =
        classifySectorWithReasons(it.sector, mode, userTrends);
      const { matched: indAll, reasons: indKw } =
        classifySectorWithReasons(it.industry, mode, userTrends);
      const secMatched = new Set([...secAll].filter(t => wanted.has(t)));
      const indMatched = new Set([...indAll].filter(t => wanted.has(t)));

      // precise 模式 fallback：sec/ind 都不命中时再查名称
      let nameReasons = {};
      if (precise && secMatched.size === 0 && indMatched.size === 0) {
        const r = nameMatchesStrictWithReasons(it.name, [...wanted], userTrends);
        nameReasons = r.reasons;
      }

      const matchedSet = new Set([
        ...secMatched, ...indMatched, ...Object.keys(nameReasons),
      ]);
      if (matchedSet.size === 0) continue;

      // 构建 match_reasons：trend_id → list of {field, value, keywords}
      const reasons = {};
      const push = (tid, field, value, keywords) => {
        if (!reasons[tid]) reasons[tid] = [];
        reasons[tid].push({ field, value, keywords });
      };

      for (const tid of secMatched) {
        push(tid, 'sector', it.sector, secKw[tid] || []);
      }
      for (const tid of indMatched) {
        // A 股池 sector==industry 常见，去重避免重复展示
        const exists = (reasons[tid] || []).some(
          r => r.field === 'sector' && r.value === it.industry
        );
        if (exists) continue;
        push(tid, 'industry', it.industry, indKw[tid] || []);
      }
      for (const [tid, kws] of Object.entries(nameReasons)) {
        push(tid, 'name', it.name, kws);
      }

      filtered.push({
        ...it,
        matched_supertrends: [...matchedSet].sort(),
        match_reasons: reasons,
      });
    }
  } else {
    filtered = universe.map(it => ({
      ...it,
      matched_supertrends: [],
      match_reasons: {},
    }));
  }

  if (!include_etf) {
    filtered = filtered.filter(it => !it.is_etf);
  }

  filtered = filtered.filter(it => {
    const mc = it.marketCap;
    if (mc == null) return include_no_mcap;
    const b = mc / 1e9;
    if (max_market_cap_b != null && b > max_market_cap_b) return false;
    if (min_market_cap_b != null && b < min_market_cap_b) return false;
    return true;
  });

  // 价值型 5 维过滤（任一非 null 即启用）
  const fundActive = (
    max_pe != null || max_pb != null || min_roe != null ||
    min_dividend_yield != null || max_debt_to_equity != null
  );
  if (fundActive) {
    filtered = filtered.filter(it => {
      // 上限类（pe / pb / d_to_e）
      if (max_pe != null) {
        const v = it.pe;
        if (v == null) {
          if (!include_no_fundamentals) return false;
        } else if (v > max_pe || v <= 0) return false;
      }
      if (max_pb != null) {
        const v = it.pb;
        if (v == null) {
          if (!include_no_fundamentals) return false;
        } else if (v > max_pb || v <= 0) return false;
      }
      if (max_debt_to_equity != null) {
        const v = it.debt_to_equity;
        if (v == null) {
          if (!include_no_fundamentals) return false;
        } else if (v > max_debt_to_equity) return false;
      }
      // 下限类（roe / dividend_yield）
      if (min_roe != null) {
        const v = it.roe;
        if (v == null) {
          if (!include_no_fundamentals) return false;
        } else if (v < min_roe) return false;
      }
      if (min_dividend_yield != null) {
        const v = it.dividend_yield;
        if (v == null) {
          if (!include_no_fundamentals) return false;
        } else if (v < min_dividend_yield) return false;
      }
      return true;
    });
  }

  if (exclude_in_watchlist) {
    const inWl = new Set(data.items.map(it => it.ticker));
    filtered = filtered.filter(it => !inWl.has(it.ticker));
  }

  filtered.sort((a, b) => {
    const aN = a.marketCap == null ? 1 : 0;
    const bN = b.marketCap == null ? 1 : 0;
    if (aN !== bN) return aN - bN;
    return (a.marketCap || 0) - (b.marketCap || 0);
  });

  return filtered.slice(0, limit);
}
