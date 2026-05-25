// ScoringDashboard.getMarketsStatus 单测 — 四市场（US/HK/CN/KR）的盘前/盘中/盘后判定。
//
// 这个函数喂给 UI 顶部那 4 个绿灯（"US Open / HK Open ..."），出错会
// 直接误导用户判断盘口状态。涉及时区计算（Intl.DateTimeFormat），是
// 标准的「写起来对、改起来容易错」的代码。
//
// 注意：jsdom 用 Node 的 ICU tz 数据库（major timezones 都靠谱）。
import { describe, it, expect } from 'vitest';
import { getMarketsStatus } from './ScoringDashboard.jsx';

// 帮手：构造一个 UTC 时间点（Date 对象在 JS 里始终是 UTC 内部表示）
const utc = (year, month, day, h = 0, m = 0) =>
  new Date(Date.UTC(year, month - 1, day, h, m));

describe('getMarketsStatus — US Open/Pre/Post', () => {
  // EST = UTC-5（11 月 = 已切回标准时间，跟 UTC 偏 5 小时）
  // 2024-11-04 周一 09:30 EST = 14:30 UTC
  it('周一 EST 09:30 → 美股盘中 (usOpen=true)', () => {
    const s = getMarketsStatus(utc(2024, 11, 4, 14, 30));
    expect(s.usOpen).toBe(true);
    expect(s.usPre).toBe(false);
    expect(s.usPost).toBe(false);
  });

  it('周一 EST 09:29 → 美股盘前 (usPre=true，usOpen=false)', () => {
    // 09:29 EST = 14:29 UTC
    const s = getMarketsStatus(utc(2024, 11, 4, 14, 29));
    expect(s.usPre).toBe(true);
    expect(s.usOpen).toBe(false);
  });

  it('周一 EST 16:00 整 → 进盘后 (usPost=true，usOpen=false)', () => {
    // inRange 是 [a, b) 半开，16:00 不算 usOpen
    const s = getMarketsStatus(utc(2024, 11, 4, 21, 0));
    expect(s.usOpen).toBe(false);
    expect(s.usPost).toBe(true);
  });

  it('周一 EST 15:59 → 还在盘中', () => {
    // 15:59 EST = 20:59 UTC
    const s = getMarketsStatus(utc(2024, 11, 4, 20, 59));
    expect(s.usOpen).toBe(true);
    expect(s.usPost).toBe(false);
  });

  it('周六 → 美股全部 false（即使时间在交易时段）', () => {
    // 2024-11-09 周六 14:30 UTC
    const s = getMarketsStatus(utc(2024, 11, 9, 14, 30));
    expect(s.usOpen).toBe(false);
    expect(s.usPre).toBe(false);
    expect(s.usPost).toBe(false);
  });

  it('周日 → 美股全部 false', () => {
    const s = getMarketsStatus(utc(2024, 11, 10, 14, 30));
    expect(s.usOpen).toBe(false);
  });
});

describe('getMarketsStatus — HK / CN 早午盘', () => {
  // HKT = UTC+8（无 DST）
  // 2024-11-04 周一 10:00 HKT = 02:00 UTC
  it('周一 HKT 10:00 → 港股早盘 (hkOpen=true)', () => {
    const s = getMarketsStatus(utc(2024, 11, 4, 2, 0));
    expect(s.hkOpen).toBe(true);
  });

  it('周一 HKT 12:30 → 港股午休 (hkOpen=false)', () => {
    // HKT 12:30 = 04:30 UTC
    const s = getMarketsStatus(utc(2024, 11, 4, 4, 30));
    expect(s.hkOpen).toBe(false);
  });

  it('周一 HKT 14:00 → 港股下午盘 (hkOpen=true)', () => {
    // HKT 14:00 = 06:00 UTC
    const s = getMarketsStatus(utc(2024, 11, 4, 6, 0));
    expect(s.hkOpen).toBe(true);
  });

  it('周一 CST 11:30 整 → 沪深进入午休 (cnOpen=false)', () => {
    // 11:30 CST = 03:30 UTC；inRange 半开，11:30 已退出
    const s = getMarketsStatus(utc(2024, 11, 4, 3, 30));
    expect(s.cnOpen).toBe(false);
  });

  it('周一 CST 11:29 → 沪深还在早盘', () => {
    const s = getMarketsStatus(utc(2024, 11, 4, 3, 29));
    expect(s.cnOpen).toBe(true);
  });

  it('周一 CST 13:30 → 沪深下午盘 (cnOpen=true)', () => {
    // CST 13:30 = 05:30 UTC
    const s = getMarketsStatus(utc(2024, 11, 4, 5, 30));
    expect(s.cnOpen).toBe(true);
  });
});

describe('getMarketsStatus — 韩股', () => {
  // KST = UTC+9（全年固定，不用 DST，注释也提到）
  // 周一 KST 09:00 = 00:00 UTC
  it('周一 KST 10:00 → 韩股盘中 (krOpen=true)', () => {
    const s = getMarketsStatus(utc(2024, 11, 4, 1, 0));
    expect(s.krOpen).toBe(true);
  });

  it('周一 KST 15:30 整 → 已收盘 (krOpen=false，半开区间)', () => {
    // KST 15:30 = 06:30 UTC
    const s = getMarketsStatus(utc(2024, 11, 4, 6, 30));
    expect(s.krOpen).toBe(false);
  });

  it('周末 → 韩股 false', () => {
    const s = getMarketsStatus(utc(2024, 11, 9, 1, 0));
    expect(s.krOpen).toBe(false);
  });
});

describe('getMarketsStatus — 返回结构', () => {
  it('总是返回完整的 6 字段对象（即使全部 false）', () => {
    // 选个周日深夜，应当全部 false
    const s = getMarketsStatus(utc(2024, 11, 10, 0, 0));
    expect(Object.keys(s).sort()).toEqual([
      'cnOpen', 'hkOpen', 'krOpen', 'usOpen', 'usPost', 'usPre',
    ].sort());
    expect(Object.values(s).every(v => typeof v === 'boolean')).toBe(true);
  });
});
