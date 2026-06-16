// anomalyScan — 关注股异动扫描结果持久化（serverless / KV 侧）
//
// 本地定时扫描脚本（backend/futu_anomaly_scan.py）跑完把结果 PUT 上来，
// 「实时监控」页 GET 展示。整快照替换。
// 持久化：Vercel KV key = "qe:anomaly_scan"
//   value: { version, scanned_at, time_range, items:[], skipped:[], errors:[] }
// KV 未配置时 load 返回空快照，save throw。

import { KV_ENABLED, kvGetJson, kvSetJson } from './kv.js';

const KEY = 'qe:anomaly_scan';

function empty() {
  return { version: 1, scanned_at: null, time_range: 7, items: [], skipped: [], errors: [] };
}

export async function loadScan() {
  if (!KV_ENABLED) return empty();
  const d = await kvGetJson(KEY, empty());
  return {
    version: d.version ?? 1,
    scanned_at: d.scanned_at ?? null,
    time_range: d.time_range ?? 7,
    items: Array.isArray(d.items) ? d.items : [],
    skipped: Array.isArray(d.skipped) ? d.skipped : [],
    errors: Array.isArray(d.errors) ? d.errors : [],
  };
}

export async function saveScan(payload) {
  if (!KV_ENABLED) {
    const e = new Error('KV not configured');
    e.code = 'KV_DISABLED';
    throw e;
  }
  const data = {
    version: 1,
    scanned_at: (payload && payload.scanned_at) || new Date().toISOString().slice(0, 19) + 'Z',
    time_range: Number(payload && payload.time_range) || 7,
    items: Array.isArray(payload && payload.items) ? payload.items : [],
    skipped: Array.isArray(payload && payload.skipped) ? payload.skipped : [],
    errors: Array.isArray(payload && payload.errors) ? payload.errors : [],
  };
  await kvSetJson(KEY, data);
  return data;
}
