// anomalyScan serverless lib 测试 —— mock KV，零网络
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _kvStore = new Map();
vi.mock('./kv.js', () => ({
  KV_ENABLED: true,
  kvGetJson: async (key, fallback) => (_kvStore.has(key) ? _kvStore.get(key) : fallback),
  kvSetJson: async (key, obj) => { _kvStore.set(key, JSON.parse(JSON.stringify(obj))); },
  kvGet: async () => null, kvSet: async () => {}, kvDel: async () => {},
}));

import { loadScan, saveScan } from './anomalyScan.js';

beforeEach(() => _kvStore.clear());

describe('loadScan', () => {
  it('空 KV 返回空快照', async () => {
    const d = await loadScan();
    expect(d.items).toEqual([]);
    expect(d.scanned_at).toBeNull();
    expect(d.time_range).toBe(7);
  });
});

describe('saveScan', () => {
  it('save → load 往返一致 + 自动盖时间戳', async () => {
    const s = await saveScan({ items: [{ ticker: 'EWY', anomaly_count: 3 }], time_range: 7 });
    expect(s.scanned_at).toBeTruthy();
    expect((await loadScan()).items[0].ticker).toBe('EWY');
  });

  it('整快照替换', async () => {
    await saveScan({ items: [{ ticker: 'A' }] });
    await saveScan({ items: [{ ticker: 'B' }] });
    expect((await loadScan()).items.map(i => i.ticker)).toEqual(['B']);
  });

  it('非数组字段被强制为 []', async () => {
    const s = await saveScan({ items: 'bad', skipped: null, errors: undefined });
    expect(s.items).toEqual([]);
    expect(s.skipped).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it('保留传入的 scanned_at', async () => {
    const s = await saveScan({ scanned_at: '2026-06-16T01:00:00Z', items: [] });
    expect(s.scanned_at).toBe('2026-06-16T01:00:00Z');
  });
});
