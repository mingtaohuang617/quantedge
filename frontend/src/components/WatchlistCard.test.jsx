// @vitest-environment jsdom
// WatchlistCard 组件渲染测试 — strategy badge / L1·L2 tooltip / 卡位↔护城河 /
// 价格预警 / 复盘 badge / 可证伪条件 / 归档 / 回调
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WatchlistCard from './WatchlistCard.jsx';

afterEach(() => cleanup());

const baseItem = {
  ticker: 'TEST',
  strategy: 'growth',
  supertrend_id: 'ai_compute',
  bottleneck_layer: 2,
  moat_score: 3,
  thesis: '',
  tags: [],
};

const trendName = (id) => ({ ai_compute: 'AI 算力', value_div: '高股息蓝筹' }[id] || id);

function renderCard(itemOverrides = {}, propOverrides = {}) {
  const props = {
    item: { ...baseItem, ...itemOverrides },
    trendName,
    currentPrice: null,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onToggleArchive: vi.fn(),
    onMarkReviewed: vi.fn(),
    ...propOverrides,
  };
  return { ...render(<WatchlistCard {...props} />), props };
}

describe('WatchlistCard — strategy badge', () => {
  it('growth item 显示「成」badge（indigo）', () => {
    renderCard({ strategy: 'growth' });
    const badge = screen.getByText('成');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/indigo/);
    expect(badge.getAttribute('title')).toMatch(/成长型/);
  });

  it('value item 显示「值」badge（emerald）', () => {
    renderCard({ strategy: 'value' });
    const badge = screen.getByText('值');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/emerald/);
    expect(badge.getAttribute('title')).toMatch(/Graham/);
  });

  it('缺 strategy 字段默认 growth（向后兼容老数据）', () => {
    renderCard({ strategy: undefined });
    expect(screen.getByText('成')).toBeInTheDocument();
    expect(screen.queryByText('值')).not.toBeInTheDocument();
  });
});

describe('WatchlistCard — 卡位 / 护城河 label', () => {
  it('growth strategy 底部 label = 卡位', () => {
    renderCard({ strategy: 'growth' });
    expect(screen.getByText('卡位')).toBeInTheDocument();
    expect(screen.queryByText('护城河')).not.toBeInTheDocument();
  });

  it('value strategy 底部 label = 护城河', () => {
    renderCard({ strategy: 'value' });
    expect(screen.getByText('护城河')).toBeInTheDocument();
    expect(screen.queryByText('卡位')).not.toBeInTheDocument();
  });
});

describe('WatchlistCard — L1/L2 strategy-aware', () => {
  it('growth L2 显示紫色（稀有突出）+ 深度认知 tooltip', () => {
    renderCard({ strategy: 'growth', bottleneck_layer: 2 });
    const badge = screen.getByText('L2');
    expect(badge.className).toMatch(/violet/);
    expect(badge.getAttribute('title')).toMatch(/深度认知/);
  });

  it('growth L1 显示蓝色（普通）+ 共识层 tooltip', () => {
    renderCard({ strategy: 'growth', bottleneck_layer: 1 });
    const badge = screen.getByText('L1');
    expect(badge.className).toMatch(/blue/);
    expect(badge.getAttribute('title')).toMatch(/共识层/);
  });

  it('value L1 显示紫色（深度低估稀有突出）', () => {
    renderCard({ strategy: 'value', bottleneck_layer: 1 });
    const badge = screen.getByText('L1');
    expect(badge.className).toMatch(/violet/);
    expect(badge.getAttribute('title')).toMatch(/深度低估/);
  });

  it('value L2 显示蓝色（合理估值普通）', () => {
    renderCard({ strategy: 'value', bottleneck_layer: 2 });
    const badge = screen.getByText('L2');
    expect(badge.className).toMatch(/blue/);
    expect(badge.getAttribute('title')).toMatch(/合理估值/);
  });
});

describe('WatchlistCard — 归档 / 复盘 badge', () => {
  it('archived=true 显示「归档」badge + opacity-60', () => {
    const { container } = renderCard({ archived: true });
    expect(screen.getByText('归档')).toBeInTheDocument();
    const card = container.querySelector('.glass-card');
    expect(card.className).toMatch(/opacity-60/);
  });

  it('archived 不显示复盘 badge（即便 added_at 很久前）', () => {
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
    renderCard({ archived: true, added_at: oldDate });
    expect(screen.queryByText(/\d+d$/)).not.toBeInTheDocument();
  });

  it('added_at 60 天前 → warn tone（amber）', () => {
    const date60 = new Date(Date.now() - 60 * 86400000).toISOString();
    const { container } = renderCard({ added_at: date60 });
    const badge = container.querySelector('[title*="未复盘"]');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/amber/);
    expect(badge.textContent).toMatch(/60d/);
  });

  it('added_at 100 天前 → urgent tone（red + animate-pulse）', () => {
    const date100 = new Date(Date.now() - 100 * 86400000).toISOString();
    const { container } = renderCard({ added_at: date100 });
    const badge = container.querySelector('[title*="强烈建议"]');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/red/);
    expect(badge.className).toMatch(/animate-pulse/);
  });

  it('added_at 3 天前 → 不显示 badge（<7 天阈值）', () => {
    const date3 = new Date(Date.now() - 3 * 86400000).toISOString();
    const { container } = renderCard({ added_at: date3 });
    // badge 是 span，与 mark-reviewed button 区分（后者 title 也含「未复盘」）
    expect(container.querySelector('span[title*="未复盘"], span[title*="天前观察"]')).not.toBeInTheDocument();
  });
});

describe('WatchlistCard — 价格预警', () => {
  it('current > target → above tone（emerald font-semibold）+ tooltip 显示 已达 +%', () => {
    const { container } = renderCard(
      { target_price: 50 },
      { currentPrice: 55 },
    );
    const targetEl = container.querySelector('[title*="已达"]');
    expect(targetEl).toBeInTheDocument();
    expect(targetEl.className).toMatch(/emerald-300 font-semibold/);
    expect(targetEl.getAttribute('title')).toMatch(/已达 \+10\.0%/);
  });

  it('current < stop_loss → below tone（red + animate-pulse）+ tooltip 显示 已破', () => {
    const { container } = renderCard(
      { stop_loss: 25 },
      { currentPrice: 22 },
    );
    const stopEl = container.querySelector('[title*="已破"]');
    expect(stopEl).toBeInTheDocument();
    expect(stopEl.className).toMatch(/red-400/);
    expect(stopEl.className).toMatch(/animate-pulse/);
  });

  it('currentPrice=null 时不渲染价格预警 tooltip', () => {
    const { container } = renderCard({ target_price: 50 });
    expect(container.querySelector('[title*="当前价"]')).not.toBeInTheDocument();
  });
});

describe('WatchlistCard — falsification_condition', () => {
  it('填了 falsification_condition 显示 ⚠ 警示框', () => {
    renderCard({ falsification_condition: '光模块需求 Q4 同比 < +20%' });
    expect(screen.getByText(/光模块需求/)).toBeInTheDocument();
    expect(screen.getByText('⚠')).toBeInTheDocument();
  });

  it('空 falsification_condition 不渲染警示框', () => {
    renderCard({ falsification_condition: '' });
    expect(screen.queryByText('⚠')).not.toBeInTheDocument();
  });
});

describe('WatchlistCard — 回调', () => {
  it('点 onEdit 按钮 → 调用 onEdit', () => {
    const { props, container } = renderCard();
    const editBtn = container.querySelector('button[title="编辑"]');
    fireEvent.click(editBtn);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
  });

  it('点 onMarkReviewed 按钮 → 调用 onMarkReviewed（仅非归档项）', () => {
    const { props, container } = renderCard({ archived: false });
    const markBtn = container.querySelector('button[title*="标记已复盘"]');
    expect(markBtn).toBeInTheDocument();
    fireEvent.click(markBtn);
    expect(props.onMarkReviewed).toHaveBeenCalledTimes(1);
  });

  it('archived 项不渲染 mark-reviewed 按钮', () => {
    const { container } = renderCard({ archived: true });
    expect(container.querySelector('button[title*="标记已复盘"]')).not.toBeInTheDocument();
  });
});

describe('WatchlistCard — moat 星标', () => {
  it('moat_score=3 渲染 3 填充 + 2 空星', () => {
    const { container } = renderCard({ moat_score: 3 });
    const stars = container.querySelectorAll('.lucide-star, [class*="lucide-star"]');
    // 5 个 star icon
    expect(stars.length).toBeGreaterThanOrEqual(5);
    // 检查填充 vs 未填充：fill-amber-400 出现 3 次
    const filled = container.querySelectorAll('[class*="fill-amber-400"]');
    expect(filled.length).toBe(3);
  });
});
