// @vitest-environment jsdom
// ValueDCFCalculator 组件渲染测试 — 默认折叠 / 展开输入 / 计算结果 /
// 安全边际 / 应用到目标价回调
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ValueDCFCalculator from './ValueDCFCalculator.jsx';

afterEach(() => cleanup());

function renderCalc(propOverrides = {}) {
  const props = {
    currentPrice: null,
    onApplyTarget: vi.fn(),
    ...propOverrides,
  };
  return { ...render(<ValueDCFCalculator {...props} />), props };
}

describe('ValueDCFCalculator — 折叠 / 展开', () => {
  it('默认 collapsed：header 显示但输入区不渲染', () => {
    renderCalc();
    expect(screen.getByText(/DCF 估算/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('如 3.5')).not.toBeInTheDocument();
  });

  it('点击 header 展开输入区', () => {
    renderCalc();
    fireEvent.click(screen.getByText(/DCF 估算/));
    expect(screen.getByPlaceholderText('如 3.5')).toBeInTheDocument();
    expect(screen.getByText('每股 FCF')).toBeInTheDocument();
  });

  it('再点 header 折回去', () => {
    renderCalc();
    const header = screen.getByText(/DCF 估算/);
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.queryByPlaceholderText('如 3.5')).not.toBeInTheDocument();
  });
});

describe('ValueDCFCalculator — 输入 + 实时计算', () => {
  it('FCF 空时不显示结果', () => {
    renderCalc();
    fireEvent.click(screen.getByText(/DCF 估算/));
    // 默认 fcfPerShare='' → result=null → 内在价值不显示
    expect(screen.queryByText(/内在价值/)).not.toBeInTheDocument();
  });

  it('输入合法 FCF 后显示内在价值', () => {
    renderCalc();
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });
    expect(screen.getByText('内在价值（每股）')).toBeInTheDocument();
    // 经典案例 FCF=3, g1=0.08, N=5, g2=0.025, r=0.10 → ~50
    const card = screen.getByText('内在价值（每股）').closest('div').parentElement;
    expect(card.textContent).toMatch(/5\d\.\d{2}/);
  });

  it('FCF=0 不显示结果（边界）', () => {
    renderCalc();
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '0' } });
    expect(screen.queryByText(/内在价值/)).not.toBeInTheDocument();
  });

  it('折现率 < 永续增速 显示 error', () => {
    renderCalc();
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });
    // 改折现率到 0.02（低于默认永续 0.025）
    const inputs = screen.getAllByRole('spinbutton');
    // inputs: [fcf, shortTermGrowth, shortTermYears, terminalGrowth, discountRate]
    const discountRateInput = inputs[inputs.length - 1];
    fireEvent.change(discountRateInput, { target: { value: '0.02' } });
    expect(screen.getByText(/Gordon 公式发散/)).toBeInTheDocument();
  });
});

describe('ValueDCFCalculator — 安全边际', () => {
  it('currentPrice 提供时显示安全边际', () => {
    renderCalc({ currentPrice: 30 });
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });
    expect(screen.getByText('安全边际')).toBeInTheDocument();
  });

  it('currentPrice 高于内在价值 → "高估幅度"标签 + red 配色', () => {
    renderCalc({ currentPrice: 200 });   // 远高于内在价值 ~50
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });
    expect(screen.getByText('高估幅度')).toBeInTheDocument();
    const badge = screen.getByText('高估幅度').closest('div');
    expect(badge.className).toMatch(/red/);
  });

  it('currentPrice null 时不显示安全边际', () => {
    renderCalc({ currentPrice: null });
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });
    expect(screen.queryByText(/安全边际/)).not.toBeInTheDocument();
    expect(screen.queryByText(/高估幅度/)).not.toBeInTheDocument();
  });
});

describe('ValueDCFCalculator — 应用到目标价', () => {
  it('点击「应用到目标价」按钮触发 onApplyTarget(intrinsicValue)', () => {
    const onApply = vi.fn();
    renderCalc({ onApplyTarget: onApply });
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });

    const applyBtn = screen.getByRole('button', { name: /应用到目标价/ });
    fireEvent.click(applyBtn);

    expect(onApply).toHaveBeenCalledTimes(1);
    // 内在价值经四舍五入到 2 位
    const arg = onApply.mock.calls[0][0];
    expect(arg).toBeGreaterThan(45);
    expect(arg).toBeLessThan(60);
  });

  it('不传 onApplyTarget 时不渲染按钮', () => {
    renderCalc({ onApplyTarget: undefined });
    fireEvent.click(screen.getByText(/DCF 估算/));
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });
    expect(screen.queryByRole('button', { name: /应用到目标价/ })).not.toBeInTheDocument();
  });
});

describe('ValueDCFCalculator — header 摘要', () => {
  it('折叠状态下，结果存在时 header 显示内在价值摘要', () => {
    renderCalc();
    fireEvent.click(screen.getByText(/DCF 估算/));   // expand
    fireEvent.change(screen.getByPlaceholderText('如 3.5'), { target: { value: '3' } });
    fireEvent.click(screen.getByText(/DCF 估算/));   // collapse again
    expect(screen.getByText(/· 内在/)).toBeInTheDocument();
  });
});
