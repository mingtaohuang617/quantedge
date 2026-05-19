// @vitest-environment jsdom
// StockDetailPanel — 候选股详情面板测试
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import StockDetailPanel from './StockDetailPanel.jsx';

afterEach(() => cleanup());

const SUPERTRENDS = [
  { id: 'semi', name: '半导体' },
  { id: 'ai_compute', name: 'AI 算力' },
];

const FULL_ITEM = {
  ticker: 'NVDA',
  name: 'NVIDIA Corporation',
  market: 'US',
  exchange: 'NASDAQ',
  sector: '半导体',
  industry: '半导体',
  marketCap: 4800e9,
  pe: 65,
  pb: 45,
  dividend_yield: 0.0003,
  roe: 1.15,
  debt_to_equity: 0.18,
  matched_supertrends: ['semi', 'ai_compute'],
  match_reasons: {
    semi: [{ field: 'sector', value: '半导体', keywords: ['半导体'] }],
  },
};

function renderPanel(overrides = {}) {
  const props = {
    open: true,
    item: FULL_ITEM,
    supertrends: SUPERTRENDS,
    onClose: vi.fn(),
    onAddObservation: vi.fn(),
    ...overrides,
  };
  return { ...render(<StockDetailPanel {...props} />), props };
}

describe('StockDetailPanel — 渲染', () => {
  it('open=false 不渲染', () => {
    renderPanel({ open: false });
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument();
  });

  it('item=null 不渲染', () => {
    renderPanel({ item: null });
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument();
  });

  it('open=true 显示 ticker + name', () => {
    renderPanel();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('NVIDIA Corporation')).toBeInTheDocument();
  });

  it('显示市场 + 交易所组合', () => {
    renderPanel();
    expect(screen.getByText('US · NASDAQ')).toBeInTheDocument();
  });

  it('显示 sector / industry / marketCap', () => {
    renderPanel();
    // sector 和 industry 都是 "半导体"，会出现 2 次
    expect(screen.getAllByText('半导体').length).toBeGreaterThan(0);
    // marketCap 4800B
    expect(screen.getByText('4.80T')).toBeInTheDocument();
  });
});

describe('StockDetailPanel — 5 维财务', () => {
  it('5 维财务字段全显示', () => {
    renderPanel();
    expect(screen.getByText('PE')).toBeInTheDocument();
    expect(screen.getByText('PB')).toBeInTheDocument();
    expect(screen.getByText('股息率')).toBeInTheDocument();
    expect(screen.getByText('ROE')).toBeInTheDocument();
    expect(screen.getByText('D/E')).toBeInTheDocument();
    // 具体值
    expect(screen.getByText('65.0')).toBeInTheDocument();   // PE
    expect(screen.getByText('45.00')).toBeInTheDocument();  // PB
    expect(screen.getByText('115.0%')).toBeInTheDocument(); // ROE
    expect(screen.getByText('0.18')).toBeInTheDocument();   // D/E
  });

  it('财务全空时不显示「财务指标」section', () => {
    renderPanel({
      item: {
        ...FULL_ITEM,
        pe: null, pb: null, dividend_yield: null, roe: null, debt_to_equity: null,
      },
    });
    expect(screen.queryByText('财务指标')).not.toBeInTheDocument();
  });

  it('部分字段缺失时显示 "—"', () => {
    renderPanel({
      item: { ...FULL_ITEM, pe: null, pb: 2.0, dividend_yield: null, roe: 0.2, debt_to_equity: null },
    });
    // pe / div / d/e 显示 —；pb / roe 显示具体值
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('2.00')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
  });
});

describe('StockDetailPanel — 命中赛道', () => {
  it('显示命中赛道 chips', () => {
    renderPanel();
    // matched_supertrends = [semi, ai_compute] → 名字 半导体 / AI 算力
    // sector + 命中赛道 都有"半导体"，至少 2 次
    expect(screen.getAllByText('半导体').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('AI 算力')).toBeInTheDocument();
  });

  it('无命中赛道时不渲染', () => {
    renderPanel({
      item: { ...FULL_ITEM, matched_supertrends: [], match_reasons: {} },
    });
    expect(screen.queryByText('命中赛道')).not.toBeInTheDocument();
  });
});

describe('StockDetailPanel — 回调', () => {
  it('点关闭按钮调用 onClose', () => {
    const { props, container } = renderPanel();
    const closeBtn = container.querySelector('button[aria-label="关闭"]');
    fireEvent.click(closeBtn);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('点「加入观察」调用 onAddObservation(item) + onClose', () => {
    const { props } = renderPanel();
    const addBtn = screen.getByRole('button', { name: /加入观察/ });
    fireEvent.click(addBtn);
    expect(props.onAddObservation).toHaveBeenCalledWith(FULL_ITEM);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('未传 onAddObservation 时不渲染「加入观察」按钮', () => {
    renderPanel({ onAddObservation: undefined });
    expect(screen.queryByRole('button', { name: /加入观察/ })).not.toBeInTheDocument();
  });

  it('点背景蒙层调用 onClose', () => {
    const { props, container } = renderPanel();
    const backdrop = container.querySelector('.fixed.inset-0');
    fireEvent.click(backdrop);
    expect(props.onClose).toHaveBeenCalled();
  });
});
