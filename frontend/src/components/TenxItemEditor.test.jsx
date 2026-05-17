// @vitest-environment jsdom
// TenxItemEditor 组件渲染测试 — strategy 切换字段标签的核心 UX
// 仅验证 main 上已有的 strategy 切换逻辑，不依赖 PR #80
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// vitest 4 + RTL 16 不再自动 cleanup — 显式 afterEach
afterEach(() => cleanup());

// quant-platform.jsx 巨大且含 side effects — 全部 mock 掉 apiFetch
vi.mock('../quant-platform.jsx', () => ({
  apiFetch: vi.fn(() => Promise.resolve(null)),
}));

import TenxItemEditor from './TenxItemEditor.jsx';

const SUPERTRENDS = [
  { id: 'ai_compute', name: 'AI 算力', strategy: 'growth' },
  { id: 'value_div', name: '高股息蓝筹', strategy: 'value' },
];

function renderEditor(overrides = {}) {
  const props = {
    open: true,
    item: null,
    candidate: { ticker: 'TEST', name: 'Test Co' },
    supertrends: SUPERTRENDS,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  return render(<TenxItemEditor {...props} />);
}

describe('TenxItemEditor — strategy 字段标签切换', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('默认 growth strategy 显示「瓶颈层级」/「卡位等级」标签', () => {
    renderEditor();
    expect(screen.getByText('瓶颈层级')).toBeInTheDocument();
    expect(screen.getByText(/卡位等级 \d \/ 5/)).toBeInTheDocument();
    expect(screen.getByText('卡位 thesis')).toBeInTheDocument();
  });

  it('编辑 value strategy item 显示「估值点位」/「护城河等级」', () => {
    renderEditor({
      item: {
        ticker: 'VZ',
        name: 'Verizon',
        strategy: 'value',
        supertrend_id: 'value_div',
        bottleneck_layer: 1,
        moat_score: 4,
        thesis: '',
        tags: [],
      },
    });
    expect(screen.getByText('估值点位')).toBeInTheDocument();
    expect(screen.getByText(/护城河等级 \d \/ 5/)).toBeInTheDocument();
    expect(screen.getByText('价值 thesis')).toBeInTheDocument();
  });

  it('strategy select 从 growth → value 切换时字段标签同步切换', () => {
    renderEditor();
    expect(screen.getByText('瓶颈层级')).toBeInTheDocument();
    expect(screen.queryByText('估值点位')).not.toBeInTheDocument();

    const strategySelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(strategySelect, { target: { value: 'value' } });

    expect(screen.queryByText('瓶颈层级')).not.toBeInTheDocument();
    expect(screen.getByText('估值点位')).toBeInTheDocument();
  });

  it('growth bottleneck options 是「L1 共识层 / L2 深度认知」', () => {
    renderEditor();
    expect(screen.getByText('L1 共识层')).toBeInTheDocument();
    expect(screen.getByText('L2 深度认知')).toBeInTheDocument();
  });

  it('value bottleneck options 是「L1 深度低估 / L2 合理估值」', () => {
    renderEditor({
      item: {
        ticker: 'KO',
        strategy: 'value',
        supertrend_id: 'value_div',
        bottleneck_layer: 1,
        moat_score: 3,
        thesis: '',
        tags: [],
      },
    });
    expect(screen.getByText('L1 深度低估')).toBeInTheDocument();
    expect(screen.getByText('L2 合理估值')).toBeInTheDocument();
  });

  it('thesis placeholder 按 strategy 切换（growth = 卡位逻辑；value = 估值点位）', () => {
    const { rerender } = renderEditor();
    const thesisInput = screen.getByPlaceholderText(/超级趋势.*卡位逻辑.*推演结论/);
    expect(thesisInput).toBeInTheDocument();

    rerender(
      <TenxItemEditor
        open={true}
        item={{
          ticker: 'KO',
          strategy: 'value',
          supertrend_id: 'value_div',
          bottleneck_layer: 1,
          moat_score: 3,
          thesis: '',
          tags: [],
        }}
        candidate={null}
        supertrends={SUPERTRENDS}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/价值赛道.*估值点位.*推演结论/)).toBeInTheDocument();
  });

  it('open=false 时不渲染（早返回 null）', () => {
    renderEditor({ open: false });
    expect(screen.queryByText('瓶颈层级')).not.toBeInTheDocument();
    expect(screen.queryByText('估值点位')).not.toBeInTheDocument();
  });
});
