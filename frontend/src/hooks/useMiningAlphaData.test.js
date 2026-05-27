// @vitest-environment jsdom
// useMiningAlphaData hook 单测 — 把数据层从 MiningAlpha 整页拆出来后，
// 用 mock apiFetch 直接测 hook 的行为契约，不需要拉整页面渲染。
//
// 覆盖：
//   1. mount 自动 fetchAll
//   2. status.files 为空时 → 跳过对应 GET
//   3. status.files 完整时 → 7 个 GET + alerts 全发，且都带 run_id
//   4. status 返回 null → 不发后续 GET，loading 也能正确收尾
//   5. fetch-seq 防竞态：rapid refetch 时，老回包不会覆盖新状态
//   6. unmount 后 → in-flight 的回包不会 setState（不抛错）
//   7. switchRun → POST /switch-run/{id} → 然后 fetchAll
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

vi.mock('../quant-platform.jsx', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from '../quant-platform.jsx';
import { useMiningAlphaData } from './useMiningAlphaData.js';

afterEach(() => cleanup());

// 帮手：构造 status 响应
const makeStatus = (overrides = {}) => ({
  current_run_id: 'run_2025_11_01',
  factor_count: 191,
  model_count: 5,
  files: {
    ic_report: true,
    feature_importance: true,
    predictions: true,
    backtest_report: true,
    regime: true,
    fold_ic: true,
    selected_alphas: true,
    factor_correlation: true,
    optuna_best: true,
    equity_curve: true,
    multi_topn: true,
  },
  history_runs: [],
  ...overrides,
});

// 帮手：让 apiFetch 按 path 返回不同 mock，简化各 test setup
const setupApiMock = (handlers) => {
  apiFetch.mockImplementation((path, opts) => {
    for (const [pattern, value] of handlers) {
      if (typeof pattern === 'string' && path === pattern) return Promise.resolve(value);
      if (pattern instanceof RegExp && pattern.test(path)) return Promise.resolve(value);
    }
    return Promise.resolve(null);
  });
};

describe('useMiningAlphaData — mount 与 status 分流', () => {
  beforeEach(() => apiFetch.mockReset());

  it('mount 时立刻调一次 /mining-alpha/status', async () => {
    setupApiMock([
      ['/mining-alpha/status', makeStatus({ files: {} })],
      [/.*/, []],  // 兜底
    ]);
    renderHook(() => useMiningAlphaData());
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/mining-alpha/status');
    });
  });

  it('status.files 完全为空 → 只发 status + alerts（其他 6 个 GET 都跳过）', async () => {
    setupApiMock([
      ['/mining-alpha/status', makeStatus({ files: {}, current_run_id: null })],
      ['/mining-alpha/alerts', { alerts: [] }],
    ]);
    const { result } = renderHook(() => useMiningAlphaData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const paths = apiFetch.mock.calls.map(c => c[0]);
    expect(paths).toContain('/mining-alpha/status');
    expect(paths).toContain('/mining-alpha/alerts');
    expect(paths.some(p => p.startsWith('/mining-alpha/ic-report'))).toBe(false);
    expect(paths.some(p => p.startsWith('/mining-alpha/backtest'))).toBe(false);
    expect(paths.some(p => p.startsWith('/mining-alpha/top-holdings'))).toBe(false);
  });

  it('status 返回 null → 触发 demo fallback，isDemoMode=true，error 不被设', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/mining-alpha/status') return Promise.reject(new Error('boom'));
      if (path === '/mining-alpha/alerts') return Promise.resolve({ alerts: [] });
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useMiningAlphaData());
    // demo chunk 动态 import 完成后 isDemoMode 翻 true
    await waitFor(() => expect(result.current.isDemoMode).toBe(true));
    expect(result.current.error).toBeNull();
    // status 已被 demo 数据替换（非 null）
    expect(result.current.status).not.toBeNull();
    expect(result.current.status.current_run_id).toBe('demo-2024-12');
  });
});

describe('useMiningAlphaData — run_id 快照锁定', () => {
  beforeEach(() => apiFetch.mockReset());

  it('status.files 完整 → 7 个 run-scoped GET 都带 run_id 参数', async () => {
    setupApiMock([
      ['/mining-alpha/status', makeStatus()],
      [/.*/, []],
    ]);
    const { result } = renderHook(() => useMiningAlphaData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const runScopedPaths = apiFetch.mock.calls
      .map(c => c[0])
      .filter(p => p !== '/mining-alpha/status' && p !== '/mining-alpha/alerts');
    expect(runScopedPaths.length).toBeGreaterThanOrEqual(7);
    // 每个 run-scoped GET 都必须带 run_id=run_2025_11_01
    for (const p of runScopedPaths) {
      expect(p).toContain('run_id=run_2025_11_01');
    }
  });

  it('alerts 路由不带 run_id（全局 log，不属于某个 run）', async () => {
    setupApiMock([
      ['/mining-alpha/status', makeStatus()],
      [/.*/, []],
    ]);
    const { result } = renderHook(() => useMiningAlphaData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const alertsCall = apiFetch.mock.calls.find(c => c[0].startsWith('/mining-alpha/alerts'));
    expect(alertsCall).toBeDefined();
    expect(alertsCall[0]).toBe('/mining-alpha/alerts');  // 不带 query
  });

  it('current_run_id=null → 后续 GET 不带 run_id 参数（兼容首次启动场景）', async () => {
    setupApiMock([
      ['/mining-alpha/status', makeStatus({ current_run_id: null })],
      [/.*/, []],
    ]);
    const { result } = renderHook(() => useMiningAlphaData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const subsequentPaths = apiFetch.mock.calls
      .map(c => c[0])
      .filter(p => p !== '/mining-alpha/status');
    for (const p of subsequentPaths) {
      expect(p).not.toContain('run_id=');
    }
  });
});

describe('useMiningAlphaData — fetch-seq 竞态守卫', () => {
  beforeEach(() => apiFetch.mockReset());

  it('rapid refetch：第一次回包慢于第二次时，旧 status 不覆盖新 status', async () => {
    // 第一次调 status → 慢 50ms 回 run A；第二次调 status → 快 5ms 回 run B
    let callCount = 0;
    apiFetch.mockImplementation((path) => {
      if (path === '/mining-alpha/status') {
        callCount++;
        const isFirst = callCount === 1;
        const status = makeStatus({
          current_run_id: isFirst ? 'run_A' : 'run_B',
          files: {},
        });
        return new Promise(resolve => setTimeout(() => resolve(status), isFirst ? 50 : 5));
      }
      return Promise.resolve({ alerts: [] });
    });

    const { result } = renderHook(() => useMiningAlphaData());
    // 在第一次 fetch 完成前立刻 trigger 第二次（competing refetch）
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/mining-alpha/status'));
    act(() => { result.current.refetch(); });

    // 等所有 in-flight 落地
    await new Promise(r => setTimeout(r, 100));

    // 第二次（run_B，快）写入；第一次（run_A，慢）回包时被 seq 守卫丢弃
    expect(result.current.status?.current_run_id).toBe('run_B');
  });

  it('unmount → in-flight 回包不会 setState（不抛 unmounted-state warning）', async () => {
    let resolveStatus;
    apiFetch.mockImplementation((path) => {
      if (path === '/mining-alpha/status') {
        return new Promise(resolve => { resolveStatus = () => resolve(makeStatus({ files: {} })); });
      }
      return Promise.resolve({ alerts: [] });
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useMiningAlphaData());
    // 在 status 回包前 unmount
    unmount();
    // 现在解析 status — 回包发生在 unmount 后
    resolveStatus();
    await new Promise(r => setTimeout(r, 30));
    // 不应该有 setState-on-unmounted 警告
    const setStateWarnings = errSpy.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && a.includes('unmounted'))
    );
    expect(setStateWarnings.length).toBe(0);
    errSpy.mockRestore();
  });
});

describe('useMiningAlphaData — switchRun 动作', () => {
  beforeEach(() => apiFetch.mockReset());

  it('调 switchRun(id) → 先 POST /switch-run/{id}，再触发新一轮 fetchAll', async () => {
    setupApiMock([
      ['/mining-alpha/status', makeStatus({ current_run_id: 'run_old', files: {} })],
      [/.*/, []],
    ]);
    const { result } = renderHook(() => useMiningAlphaData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiFetch.mockClear();
    // 切换到新 run
    apiFetch.mockImplementation((path) => {
      if (path === '/mining-alpha/switch-run/run_new') return Promise.resolve({ ok: true });
      if (path === '/mining-alpha/status') return Promise.resolve(makeStatus({ current_run_id: 'run_new', files: {} }));
      return Promise.resolve({ alerts: [] });
    });

    await act(async () => { await result.current.switchRun('run_new'); });

    const calls = apiFetch.mock.calls;
    const switchIdx = calls.findIndex(c => c[0] === '/mining-alpha/switch-run/run_new');
    const statusIdx = calls.findIndex(c => c[0] === '/mining-alpha/status');
    expect(switchIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeGreaterThan(switchIdx);  // status 必须在 switch-run 之后
    expect(calls[switchIdx][1]).toEqual({ method: 'POST' });
  });
});
