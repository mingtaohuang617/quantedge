// csvExport — escapeCsvField + serializeWatchlistCsv 单测
import { describe, it, expect } from 'vitest';
import {
  escapeCsvField,
  serializeWatchlistCsv,
  WATCHLIST_CSV_HEADERS,
} from './csvExport.js';

describe('escapeCsvField', () => {
  it('null / undefined → 空字符串', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('普通字符串原样返回', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField('AAPL')).toBe('AAPL');
  });

  it('数字 / boolean 转字符串', () => {
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(0)).toBe('0');
    expect(escapeCsvField(true)).toBe('true');
    expect(escapeCsvField(false)).toBe('false');
  });

  it('含逗号 → 包双引号', () => {
    expect(escapeCsvField('hello, world')).toBe('"hello, world"');
  });

  it('含双引号 → 包双引号 + 内部 doubled', () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('含换行 → 替换为 " | " 单行', () => {
    expect(escapeCsvField('line1\nline2')).toBe('line1 | line2');
    expect(escapeCsvField('line1\r\nline2')).toBe('line1 | line2');
  });

  it('换行 + 逗号 → 单行后再判断转义', () => {
    // \n 替换为 " | "，所以含逗号 → 包双引号
    expect(escapeCsvField('a,b\nc')).toBe('"a,b | c"');
  });

  it('中文不需转义', () => {
    expect(escapeCsvField('英伟达')).toBe('英伟达');
  });

  it('中文含逗号 → 包双引号', () => {
    expect(escapeCsvField('英伟达, AI 算力')).toBe('"英伟达, AI 算力"');
  });
});

describe('serializeWatchlistCsv', () => {
  it('空数组 → 仅 header 行 + BOM', () => {
    const csv = serializeWatchlistCsv([]);
    expect(csv.startsWith('﻿')).toBe(true);  // BOM
    expect(csv.slice(1)).toBe(WATCHLIST_CSV_HEADERS.join(','));
  });

  it('null / 非数组 → fallback 仅 header', () => {
    expect(serializeWatchlistCsv(null).slice(1)).toBe(WATCHLIST_CSV_HEADERS.join(','));
    expect(serializeWatchlistCsv({}).slice(1)).toBe(WATCHLIST_CSV_HEADERS.join(','));
  });

  it('单 item → header + 1 数据行（CRLF 分隔）', () => {
    const csv = serializeWatchlistCsv([{
      ticker: 'NVDA', name: 'NVIDIA',
    }]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe(WATCHLIST_CSV_HEADERS.join(','));
    expect(lines[1].startsWith('NVDA,NVIDIA,')).toBe(true);
  });

  it('缺字段 → 空字符串占位', () => {
    const csv = serializeWatchlistCsv([{ ticker: 'AAPL' }]);
    const row = csv.slice(1).split('\r\n')[1];
    const cells = row.split(',');
    expect(cells[0]).toBe('AAPL');         // ticker
    expect(cells[1]).toBe('');             // name 缺
    expect(cells.length).toBe(WATCHLIST_CSV_HEADERS.length);
  });

  it('多 item 顺序保留', () => {
    const csv = serializeWatchlistCsv([
      { ticker: 'NVDA' }, { ticker: 'AAPL' }, { ticker: '700.HK' },
    ]);
    const lines = csv.slice(1).split('\r\n').slice(1);
    expect(lines[0].split(',')[0]).toBe('NVDA');
    expect(lines[1].split(',')[0]).toBe('AAPL');
    expect(lines[2].split(',')[0]).toBe('700.HK');
  });

  it('thesis 含换行 + 逗号 → 包双引号 + 单行化', () => {
    const csv = serializeWatchlistCsv([{
      ticker: 'AAPL',
      thesis: '看好 AI 推理芯片\n第一段\n包含, 逗号',
    }]);
    expect(csv).toContain('"看好 AI 推理芯片 | 第一段 | 包含, 逗号"');
  });

  it('双引号字段 → 内部 doubled', () => {
    const csv = serializeWatchlistCsv([{ ticker: 'X', name: 'he said "hi"' }]);
    expect(csv).toContain('"he said ""hi"""');
  });

  it('null 字段不破坏 row（解析后仍是正确数量的字段）', () => {
    const csv = serializeWatchlistCsv([{
      ticker: 'GOOG', name: null, thesis: null, archived: false,
    }]);
    const row = csv.slice(1).split('\r\n')[1];
    expect(row.split(',').length).toBe(WATCHLIST_CSV_HEADERS.length);
  });

  it('BOM 是 UTF-8 FEFF（Excel 识别用）', () => {
    const csv = serializeWatchlistCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('可自定义 headers', () => {
    const csv = serializeWatchlistCsv([{ a: 1, b: 2 }], ['a', 'b']);
    expect(csv).toBe('﻿a,b\r\n1,2');
  });
});
