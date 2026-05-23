// @vitest-environment jsdom
// MiningAlpha 3 个子组件的单测：AlertsBanner / TopHoldingsTable / RunPipelinePanel
//
// 这些子组件原本只通过整页 E2E 覆盖（成本高、不稳）。补单测让边界 case
// 跑在 jsdom 里，回归更快。
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// quant-platform.jsx 是巨石入口（300 kB），Mock 掉它的 apiFetch
// 以免拉整个 React 树到测试里。RunPipelinePanel 是唯一消费方。
vi.mock('../quant-platform.jsx', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from '../quant-platform.jsx';

import MiningAlpha, { AlertsBanner, TopHoldingsTable, RunPipelinePanel, mergeRegimeSegments, BackendUnreachableNotice } from './MiningAlpha.jsx';

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────
// MiningAlpha 整页 demo 模式 smoke 测 — backend 不可达时整条链路
//   apiFetch /status → null
//   → hook dynamic import miningAlphaDemo
//   → setState 灌入 9 个 demo 数据
//   → 整页用 demo 数据渲染（无 React 错误、可见 DEMO badge + 关键面板）
// ─────────────────────────────────────────────────────────────
describe('MiningAlpha — Vercel demo 模式 smoke', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    // backend 全部不可达：所有 apiFetch 都返回 null（模拟 catch → null 的 fetch 失败）
    apiFetch.mockResolvedValue(null);
  });

  it('backend 不可达 → 整页用 demo 数据渲染，无 React 错误', async () => {
    // ErrorBoundary 触发或 React render error 会进 console.error
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MiningAlpha />);

    // 等 demo 数据加载完成 → DEMO badge 出现
    await waitFor(() => {
      expect(screen.getByText(/DEMO 模式/)).toBeInTheDocument();
    }, { timeout: 3000 });

    // 关键面板都用 demo 数据渲染了（不再是"未生成"占位文案）
    // demo 数据里有 NVDA / AAPL / RKLB 这些 ticker
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText(/示例数据/)).toBeInTheDocument();
    expect(screen.getByText(/重试真实后端/)).toBeInTheDocument();

    // 不应当有"未生成"这种本地 dev 才需要的 CLI 提示文案
    expect(screen.queryByText(/IC 报告未生成/)).not.toBeInTheDocument();
    expect(screen.queryByText(/回测净值未生成/)).not.toBeInTheDocument();

    // 全程没有 React render error
    const reactErrors = errSpy.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && (a.includes('Warning:') || a.includes('Error:')))
    );
    expect(reactErrors).toEqual([]);
    errSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────
// BackendUnreachableNotice — Vercel 这类纯前端部署的友好兜底
// ─────────────────────────────────────────────────────────────
describe('BackendUnreachableNotice', () => {
  it('渲染标题 + 启动命令 + 重试按钮', () => {
    render(<BackendUnreachableNotice onRetry={() => {}} loading={false} />);
    expect(screen.getByText(/Mining Alpha 需要 self-hosted backend/)).toBeInTheDocument();
    expect(screen.getByText(/cd backend && python server\.py/)).toBeInTheDocument();
    expect(screen.getByText(/重试连接/)).toBeInTheDocument();
  });

  it('提示其他不依赖 backend 的页面在 Vercel 上仍可用', () => {
    render(<BackendUnreachableNotice onRetry={() => {}} loading={false} />);
    expect(screen.getByText(/量化评分.*投资日志.*宏观/)).toBeInTheDocument();
  });

  it('点重试按钮 → 调 onRetry', () => {
    const onRetry = vi.fn();
    render(<BackendUnreachableNotice onRetry={onRetry} loading={false} />);
    fireEvent.click(screen.getByText(/重试连接/));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('loading=true → 按钮 disabled 且不响应点击', () => {
    const onRetry = vi.fn();
    render(<BackendUnreachableNotice onRetry={onRetry} loading={true} />);
    const btn = screen.getByText(/重试连接/).closest('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// mergeRegimeSegments — 把连续同 label 合并成区段（用于 ReferenceArea）
// ─────────────────────────────────────────────────────────────
describe('mergeRegimeSegments', () => {
  it('空数组 → []', () => {
    expect(mergeRegimeSegments([])).toEqual([]);
  });

  it('undefined → []（前端 fetchAll catch 失败时会传 undefined）', () => {
    expect(mergeRegimeSegments(undefined)).toEqual([]);
    expect(mergeRegimeSegments(null)).toEqual([]);
  });

  it('单点 → 一个 start==end 的 seg', () => {
    expect(mergeRegimeSegments([{ date: '2024-01-02', label: 'bull' }])).toEqual([
      { label: 'bull', start: '2024-01-02', end: '2024-01-02' },
    ]);
  });

  it('连续同 label → 合并成一个区段，end 延到最后一点', () => {
    const segs = mergeRegimeSegments([
      { date: '2024-01-02', label: 'bull' },
      { date: '2024-01-03', label: 'bull' },
      { date: '2024-01-04', label: 'bull' },
    ]);
    expect(segs).toEqual([{ label: 'bull', start: '2024-01-02', end: '2024-01-04' }]);
  });

  it('label 切换 → 切成两段，边界点归属新段的 start', () => {
    const segs = mergeRegimeSegments([
      { date: '2024-01-02', label: 'bull' },
      { date: '2024-01-03', label: 'bull' },
      { date: '2024-01-04', label: 'bear' },
      { date: '2024-01-05', label: 'bear' },
    ]);
    expect(segs).toEqual([
      { label: 'bull', start: '2024-01-02', end: '2024-01-03' },
      { label: 'bear', start: '2024-01-04', end: '2024-01-05' },
    ]);
  });

  it('bull → neutral → bear → bull：4 段都被记下，顺序保留', () => {
    const segs = mergeRegimeSegments([
      { date: '01', label: 'bull' },
      { date: '02', label: 'neutral' },
      { date: '03', label: 'bear' },
      { date: '04', label: 'bear' },
      { date: '05', label: 'bull' },
    ]);
    expect(segs.map(s => s.label)).toEqual(['bull', 'neutral', 'bear', 'bull']);
    expect(segs[2]).toEqual({ label: 'bear', start: '03', end: '04' });
  });

  it('单点切换（每点 label 都不同）→ 每点一个 seg', () => {
    const segs = mergeRegimeSegments([
      { date: '01', label: 'a' },
      { date: '02', label: 'b' },
      { date: '03', label: 'c' },
    ]);
    expect(segs).toHaveLength(3);
    for (const s of segs) {
      expect(s.start).toBe(s.end);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// AlertsBanner
// ─────────────────────────────────────────────────────────────
describe('AlertsBanner', () => {
  it('alerts 为空 → 渲染 null（容器无内容）', () => {
    const { container } = render(<AlertsBanner alerts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('alerts 为 undefined → 渲染 null', () => {
    const { container } = render(<AlertsBanner alerts={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('全是 low/medium 严重度 → 渲染 null（只显示 high/critical）', () => {
    const { container } = render(
      <AlertsBanner alerts={[
        { severity: 'low', message: 'low msg' },
        { severity: 'medium', message: 'med msg' },
      ]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('有 high/critical → 渲染计数 + 消息列表', () => {
    render(<AlertsBanner alerts={[
      { severity: 'critical', message: 'IC 跌穿阈值' },
      { severity: 'high', message: '回撤超 30%' },
      { severity: 'low', message: 'low — 不显示' },
    ]} />);
    expect(screen.getByText('2 条高严重度告警')).toBeInTheDocument();
    expect(screen.getByText('IC 跌穿阈值')).toBeInTheDocument();
    expect(screen.getByText('回撤超 30%')).toBeInTheDocument();
    expect(screen.queryByText('low — 不显示')).not.toBeInTheDocument();
  });

  it('超过 5 条 high → 只显示前 5 条但计数完整', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ severity: 'high', message: `msg ${i}` }));
    render(<AlertsBanner alerts={many} />);
    expect(screen.getByText('8 条高严重度告警')).toBeInTheDocument();
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`msg ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText('msg 5')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────
// TopHoldingsTable
// ─────────────────────────────────────────────────────────────
describe('TopHoldingsTable', () => {
  it('holdings 空 → fallback 文案"最新预测不可用"', () => {
    render(<TopHoldingsTable holdings={[]} asOf="" summary={{}} />);
    expect(screen.getByText(/最新预测不可用/)).toBeInTheDocument();
  });

  it('holdings 空 + 后端给了 errorDetail → 显示 errorDetail 而非默认文案', () => {
    render(<TopHoldingsTable holdings={[]} asOf="" summary={{}}
      errorDetail="predictions.parquet 存在但读取失败（缺 pyarrow）" />);
    expect(screen.getByText(/predictions\.parquet 存在但读取失败/)).toBeInTheDocument();
    expect(screen.queryByText(/最新预测不可用/)).not.toBeInTheDocument();
  });

  it('渲染 As of + 增/持/减 三个 summary 数字', () => {
    render(<TopHoldingsTable
      holdings={[{ ticker: 'AAPL', score: 0.521, status: 'held' }]}
      asOf="2025-11-01"
      summary={{ n_new: 3, n_held: 17, n_dropped: 2 }}
    />);
    expect(screen.getByText(/As of 2025-11-01/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();   // n_new
    expect(screen.getByText('↻ 17')).toBeInTheDocument(); // held 前缀
    expect(screen.getByText('2')).toBeInTheDocument();   // n_dropped
  });

  it('three statuses 的 ticker 显示符合视觉规范（new=绿+，dropped=红-）', () => {
    const { container } = render(<TopHoldingsTable
      holdings={[
        { ticker: 'NEW1', score: 0.7, status: 'new' },
        { ticker: 'HELD1', score: 0.5, status: 'held' },
        { ticker: 'OUT1', score: null, status: 'dropped' },
      ]}
      asOf="2025-11-01"
      summary={{ n_new: 1, n_held: 1, n_dropped: 1 }}
    />);
    // dropped score 为 null → 显示 "—"
    expect(screen.getByText('—')).toBeInTheDocument();
    // new 显示分数（保留 3 位小数）
    expect(screen.getByText('0.700')).toBeInTheDocument();
    // 三个 ticker 都出现
    expect(screen.getByText('NEW1')).toBeInTheDocument();
    expect(screen.getByText('HELD1')).toBeInTheDocument();
    expect(screen.getByText('OUT1')).toBeInTheDocument();
    // dropped 的 ticker 应当带 line-through 样式
    expect(container.querySelector('.line-through')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// RunPipelinePanel
// ─────────────────────────────────────────────────────────────
describe('RunPipelinePanel', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    // 默认 mount 拉一次 /run/status → 返回 idle
    apiFetch.mockImplementation((path) => {
      if (path === '/mining-alpha/run/status') {
        return Promise.resolve({ running: false, step: null, log_tail: [], exit_code: null });
      }
      return Promise.resolve(null);
    });
  });

  it('渲染 7 个 step 按钮（来自 STEPS 数组）', async () => {
    render(<RunPipelinePanel runId="demo" onJobDone={() => {}} />);
    // 等 mount apiFetch 解析完
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/mining-alpha/run/status'));
    // STEPS 7 项 label 都在
    expect(screen.getByText(/合成 demo 数据/)).toBeInTheDocument();
    expect(screen.getByText(/同步行情/)).toBeInTheDocument();
    expect(screen.getByText(/算因子/)).toBeInTheDocument();
    expect(screen.getByText(/IC 报告/)).toBeInTheDocument();
    expect(screen.getByText(/Optuna/)).toBeInTheDocument();
    expect(screen.getByText(/^4\. 训练/)).toBeInTheDocument();
    expect(screen.getByText(/^5\. 回测/)).toBeInTheDocument();
  });

  it('mount 时只拉一次 /run/status（idle 状态不应当 poll）', async () => {
    render(<RunPipelinePanel runId="demo" onJobDone={() => {}} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/mining-alpha/run/status'));
    // 给 polling effect 一个时间窗口；idle 时它不应当起来
    await new Promise((r) => setTimeout(r, 100));
    const statusCalls = apiFetch.mock.calls.filter(c => c[0] === '/mining-alpha/run/status');
    expect(statusCalls.length).toBe(1);
  });

  it('点击 step 按钮 → POST /mining-alpha/run/{step}?run_id=…&extra_args=…', async () => {
    render(<RunPipelinePanel runId="my-run" onJobDone={() => {}} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/mining-alpha/run/status'));

    fireEvent.click(screen.getByText(/IC 报告/));

    // 调用 path 形如 "/mining-alpha/run/ic-report?run_id=my-run&extra_args=..."
    await waitFor(() => {
      const postCall = apiFetch.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].startsWith('/mining-alpha/run/ic-report?')
      );
      expect(postCall).toBeDefined();
      expect(postCall[0]).toContain('run_id=my-run');
      expect(postCall[0]).toContain('extra_args=');
      expect(postCall[1]).toEqual({ method: 'POST' });
    });
  });

  it('后端 running=true → step 按钮禁用 + 显示运行中标记', async () => {
    apiFetch.mockImplementation((path) => {
      if (path === '/mining-alpha/run/status') {
        return Promise.resolve({
          running: true, step: 'train', log_tail: ['[INFO] fold 1...'], elapsed_sec: 12,
        });
      }
      return Promise.resolve(null);
    });
    render(<RunPipelinePanel runId="demo" onJobDone={() => {}} />);
    await waitFor(() => expect(screen.getByText(/train 运行中/)).toBeInTheDocument());
    // 至少一个 step 按钮的 disabled 属性
    const ic = screen.getByText(/IC 报告/).closest('button');
    expect(ic).toBeDisabled();
  });
});
