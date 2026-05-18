// stock_gene Vercel 端业务逻辑（移植自 backend/stock_gene.py）
//
// 持久化：Vercel KV (Upstash)，key = "qe:sg:v2"
//   value: { version: 2, lists: [], items: [] }
//
// 不实现 4 引擎评分 — engines 依赖 pandas/numpy，Vercel 函数环境跑不动。
// 评分仍需 self-hosted backend (FastAPI)；Vercel 仅提供 CRUD + 分组 + 备份。

import { KV_ENABLED, kvGetJson, kvSetJson } from './kv.js';

const KEY = 'qe:sg:v2';

const DEFAULT_LIST = { id: 'default', name: '默认', color: 'indigo' };

function emptyData() {
  return { version: 2, lists: [{ ...DEFAULT_LIST }], items: [] };
}

/** 自动迁移 v1 → v2：补 lists、给 items 加 list_id */
function migrateToV2(data) {
  if (!data) return emptyData();
  data.items ??= [];
  data.version ??= 1;
  if (data.version >= 2 && Array.isArray(data.lists) && data.lists.length) {
    // 容错
    const listIds = new Set(data.lists.map(l => l.id));
    if (!listIds.has('default')) {
      data.lists.unshift({ ...DEFAULT_LIST });
      listIds.add('default');
    }
    for (const it of data.items) {
      if (!listIds.has(it.list_id)) it.list_id = 'default';
    }
    return data;
  }
  data.lists = [{ ...DEFAULT_LIST }];
  for (const it of data.items) it.list_id ??= 'default';
  data.version = 2;
  return data;
}

export async function loadData() {
  if (!KV_ENABLED) return emptyData();
  const data = await kvGetJson(KEY, null);
  return migrateToV2(data);
}

async function saveData(data) {
  if (!KV_ENABLED) {
    const e = new Error('KV not configured');
    e.code = 'KV_DISABLED';
    throw e;
  }
  await kvSetJson(KEY, data);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Watchlist CRUD ────────────────────────────────────────
export async function addItem(ticker, fields = {}) {
  const tk = String(ticker || '').trim().toUpperCase();
  if (!tk) throw new Error('ticker 不能为空');
  const data = await loadData();
  const listIds = new Set(data.lists.map(l => l.id));
  let listId = fields.list_id || 'default';
  if (!listIds.has(listId)) listId = 'default';

  const existing = data.items.find(it => it.ticker === tk);
  if (existing) {
    if (fields.name) existing.name = fields.name;
    if (fields.market) existing.market = fields.market;
    if (fields.sector) existing.sector = fields.sector;
    if (fields.notes) existing.notes = fields.notes;
    if (Array.isArray(fields.tags)) existing.tags = fields.tags;
    await saveData(data);
    return existing;
  }

  const item = {
    ticker: tk,
    name: fields.name || '',
    market: fields.market || 'US',
    sector: fields.sector || '',
    notes: fields.notes || '',
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    list_id: listId,
    added_at: todayIso(),
    last_result: null,
    last_checked_at: null,
  };
  data.items.push(item);
  await saveData(data);
  return item;
}

export async function updateItem(ticker, fields = {}) {
  const tk = String(ticker || '').trim().toUpperCase();
  const data = await loadData();
  const it = data.items.find(x => x.ticker === tk);
  if (!it) return null;
  for (const k of ['name', 'market', 'sector', 'notes', 'tags']) {
    if (fields[k] !== undefined) it[k] = fields[k];
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

export async function moveItem(ticker, targetListId) {
  const tk = String(ticker || '').trim().toUpperCase();
  const data = await loadData();
  const listIds = new Set(data.lists.map(l => l.id));
  if (!listIds.has(targetListId)) {
    throw new Error(`未知 list_id: ${targetListId}`);
  }
  const it = data.items.find(x => x.ticker === tk);
  if (!it) return null;
  it.list_id = targetListId;
  await saveData(data);
  return it;
}

// ─── List CRUD ────────────────────────────────────────────
function slugify(name) {
  const s = (name || '').trim().replace(/[^a-zA-Z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return s || `list-${Date.now()}`;
}

export async function addList(name, color = 'slate') {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('list 名称不能为空');
  const data = await loadData();
  const existing = new Set(data.lists.map(l => l.id));
  const base = slugify(trimmed);
  let id = base;
  let n = 1;
  while (existing.has(id)) {
    n += 1;
    id = `${base}-${n}`;
  }
  const newList = { id, name: trimmed, color, created_at: todayIso() };
  data.lists.push(newList);
  await saveData(data);
  return newList;
}

export async function updateList(id, fields = {}) {
  const data = await loadData();
  const l = data.lists.find(x => x.id === id);
  if (!l) return null;
  if (fields.name !== undefined) l.name = fields.name;
  if (fields.color !== undefined) l.color = fields.color;
  await saveData(data);
  return l;
}

export async function deleteList(id) {
  if (id === 'default') throw new Error('默认 list 不能删除');
  const data = await loadData();
  const before = data.lists.length;
  data.lists = data.lists.filter(l => l.id !== id);
  if (data.lists.length === before) return 0;
  let moved = 0;
  for (const it of data.items) {
    if (it.list_id === id) {
      it.list_id = 'default';
      moved += 1;
    }
  }
  await saveData(data);
  return moved;
}

// ─── Export / Import ─────────────────────────────────────
export async function exportData() {
  const data = await loadData();
  return {
    version: 2,
    exported_at: new Date().toISOString(),
    lists: data.lists,
    items: data.items,
  };
}

export async function importData(payload, mode = 'merge') {
  if (mode !== 'merge' && mode !== 'replace') {
    throw new Error("mode must be 'merge' or 'replace'");
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload 必须是 object');
  }
  const incomingItems = Array.isArray(payload.items) ? payload.items : [];
  const incomingLists = Array.isArray(payload.lists) ? payload.lists : [];

  const data = await loadData();
  let added = 0, skipped = 0;

  if (mode === 'replace') {
    data.items = [];
    // 重建 lists（保留 default）
    const seen = new Set(['default']);
    data.lists = [{ ...DEFAULT_LIST }];
    for (const raw of incomingLists) {
      if (!raw.id || seen.has(raw.id)) continue;
      data.lists.push({
        id: raw.id,
        name: raw.name || raw.id,
        color: raw.color || 'slate',
        created_at: raw.created_at || todayIso(),
      });
      seen.add(raw.id);
    }
  } else {
    const existingListIds = new Set(data.lists.map(l => l.id));
    for (const raw of incomingLists) {
      if (!raw.id || existingListIds.has(raw.id)) continue;
      data.lists.push({
        id: raw.id,
        name: raw.name || raw.id,
        color: raw.color || 'slate',
        created_at: raw.created_at || todayIso(),
      });
      existingListIds.add(raw.id);
    }
  }

  const existingTickers = new Set(data.items.map(it => it.ticker));
  const validListIds = new Set(data.lists.map(l => l.id));
  for (const raw of incomingItems) {
    const tk = String(raw.ticker || '').trim().toUpperCase();
    if (!tk) continue;
    if (existingTickers.has(tk)) {
      skipped += 1;
      continue;
    }
    const listId = validListIds.has(raw.list_id) ? raw.list_id : 'default';
    data.items.push({
      ticker: tk,
      name: raw.name || '',
      market: raw.market || 'US',
      sector: raw.sector || '',
      notes: raw.notes || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      list_id: listId,
      added_at: raw.added_at || todayIso(),
      last_result: raw.last_result || null,
      last_value_result: raw.last_value_result || null,
      last_signal_result: raw.last_signal_result || null,
      last_risk_result: raw.last_risk_result || null,
      last_checked_at: raw.last_checked_at || null,
      last_value_checked_at: raw.last_value_checked_at || null,
      last_signal_checked_at: raw.last_signal_checked_at || null,
      last_risk_checked_at: raw.last_risk_checked_at || null,
      score_history: Array.isArray(raw.score_history) ? raw.score_history : [],
    });
    existingTickers.add(tk);
    added += 1;
  }

  await saveData(data);
  return { ok: true, mode, items_added: added, items_skipped: skipped };
}

// ─── Alerts（从 score_history 计算）─────────────────────────
export async function getAlerts({ days = 30, min_delta = 1 } = {}) {
  const data = await loadData();
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const out = [];
  for (const item of data.items) {
    const history = item.score_history || [];
    if (history.length < 2) continue;
    const byEngine = {};
    for (const h of history) {
      const eng = h.engine;
      if (!eng) continue;
      (byEngine[eng] ??= []).push(h);
    }
    for (const [engId, hs] of Object.entries(byEngine)) {
      if (hs.length < 2) continue;
      const sorted = [...hs].sort((a, b) => (a.checked_at || '').localeCompare(b.checked_at || ''));
      const latest = sorted[sorted.length - 1];
      const prev = sorted[sorted.length - 2];
      if (!latest.checked_at || latest.checked_at < cutoff) continue;
      const cur = latest.score, p = prev.score;
      if (cur == null || p == null) continue;
      const delta = cur - p;
      if (Math.abs(delta) < min_delta) continue;
      out.push({
        ticker: item.ticker,
        name: item.name || '',
        engine: engId,
        from_score: p,
        to_score: cur,
        delta,
        max_score: latest.max_score,
        from_verdict: prev.verdict_level,
        to_verdict: latest.verdict_level,
        checked_at: latest.checked_at,
        prev_checked_at: prev.checked_at,
        list_id: item.list_id || 'default',
      });
    }
  }
  out.sort((a, b) => (b.checked_at || '').localeCompare(a.checked_at || ''));
  return out;
}
