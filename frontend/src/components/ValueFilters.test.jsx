// @vitest-environment jsdom
// ValueFilters 组件渲染测试 — 5 个 input 显示 / 输入回调 / 空值清除 / step 配置
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ValueFilters from './ValueFilters.jsx';

afterEach(() => cleanup());

const EMPTY = {
  max_pe: null,
  max_pb: null,
  min_roe: null,
  min_dividend_yield: null,
  max_debt_to_equity: null,
};

function renderFilters(value = EMPTY) {
  const onChange = vi.fn();
  const result = render(<ValueFilters value={value} onChange={onChange} />);
  return { ...result, onChange };
}

describe('ValueFilters — 5 个 input 渲染', () => {
  it('显示 5 个 numeric input', () => {
    const { container } = renderFilters();
    const inputs = container.querySelectorAll('input[type=number]');
    expect(inputs.length).toBe(5);
  });

  it('显示 5 个 label：PE≤ / PB≤ / ROE≥ / 息≥ / D/E≤', () => {
    renderFilters();
    expect(screen.getByText('PE≤')).toBeInTheDocument();
    expect(screen.getByText('PB≤')).toBeInTheDocument();
    expect(screen.getByText('ROE≥')).toBeInTheDocument();
    expect(screen.getByText('息≥')).toBeInTheDocument();
    expect(screen.getByText('D/E≤')).toBeInTheDocument();
  });

  it('PE input 有 placeholder=25（默认推荐值）', () => {
    renderFilters();
    const peInput = screen.getByPlaceholderText('25');
    expect(peInput).toBeInTheDocument();
  });
});

describe('ValueFilters — value 回显', () => {
  it('value.max_pe=15 时 PE input 值为 15', () => {
    const { container } = renderFilters({ ...EMPTY, max_pe: 15 });
    const peInput = container.querySelector('input[placeholder="25"]');
    expect(peInput.value).toBe('15');
  });

  it('value.min_roe=0.15 时 ROE input 值为 0.15', () => {
    const { container } = renderFilters({ ...EMPTY, min_roe: 0.15 });
    const inputs = container.querySelectorAll('input[type=number]');
    // 顺序：[pe, pb, roe, div, d/e]
    expect(inputs[2].value).toBe('0.15');
  });

  it('value.max_pe=null 时 PE input 为空', () => {
    const { container } = renderFilters({ ...EMPTY, max_pe: null });
    const peInput = container.querySelector('input[placeholder="25"]');
    expect(peInput.value).toBe('');
  });
});

describe('ValueFilters — onChange 行为', () => {
  it('输入数字 → onChange 收到 Number 类型', () => {
    const { container, onChange } = renderFilters();
    const peInput = container.querySelector('input[placeholder="25"]');
    fireEvent.change(peInput, { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, max_pe: 15 });
  });

  it('清空 input → onChange 收到 null（不是 NaN 或 0）', () => {
    const { container, onChange } = renderFilters({ ...EMPTY, max_pe: 15 });
    const peInput = container.querySelector('input[placeholder="25"]');
    fireEvent.change(peInput, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, max_pe: null });
  });

  it('改 ROE 时其它字段不受影响（partial merge）', () => {
    const { container, onChange } = renderFilters({ ...EMPTY, max_pe: 20, max_pb: 3 });
    const inputs = container.querySelectorAll('input[type=number]');
    fireEvent.change(inputs[2], { target: { value: '0.10' } });
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY,
      max_pe: 20,
      max_pb: 3,
      min_roe: 0.10,
    });
  });

  it('小数 step：ROE / 股息率 / D/E 用不同 step', () => {
    const { container } = renderFilters();
    const inputs = container.querySelectorAll('input[type=number]');
    expect(inputs[0].step).toBe('0.1');   // PE
    expect(inputs[1].step).toBe('0.1');   // PB
    expect(inputs[2].step).toBe('0.01');  // ROE 更细
    expect(inputs[3].step).toBe('0.005'); // 股息率最细
    expect(inputs[4].step).toBe('0.1');   // D/E
  });
});

describe('ValueFilters — tooltip 说明', () => {
  it('PE 标签 tooltip 说明亏损股一律剔除', () => {
    renderFilters();
    const pe = screen.getByText('PE≤');
    expect(pe.getAttribute('title')).toMatch(/亏损/);
  });

  it('ROE 标签 tooltip 说明小数格式', () => {
    renderFilters();
    const roe = screen.getByText('ROE≥');
    expect(roe.getAttribute('title')).toMatch(/小数/);
  });
});
