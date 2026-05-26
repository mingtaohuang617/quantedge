// @vitest-environment jsdom
// ValueFilters 组件渲染测试 — 5 个 input 显示 / 输入回调 / 空值清除 / step 配置 / preset chips
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ValueFilters, { VALUE_PRESETS, matchesPreset } from './ValueFilters.jsx';

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

describe('ValueFilters — preset chips', () => {
  it('渲染 3 个 preset + 1 个清空按钮', () => {
    renderFilters();
    expect(screen.getByText('深度低估')).toBeInTheDocument();
    expect(screen.getByText('高股息')).toBeInTheDocument();
    expect(screen.getByText('质量价值')).toBeInTheDocument();
    expect(screen.getByText('清空')).toBeInTheDocument();
  });

  it('点击「深度低估」→ onChange 收到 max_pe=15, max_pb=2', () => {
    const { onChange } = renderFilters({ ...EMPTY, max_pe: 25 });
    fireEvent.click(screen.getByText('深度低估'));
    expect(onChange).toHaveBeenCalledWith({
      max_pe: 15, max_pb: 2,
      min_roe: null, min_dividend_yield: null, max_debt_to_equity: null,
    });
  });

  it('点击「高股息」→ onChange 收到 min_dividend_yield=0.04', () => {
    const { onChange } = renderFilters();
    fireEvent.click(screen.getByText('高股息'));
    expect(onChange).toHaveBeenCalledWith({
      max_pe: 30, max_pb: null,
      min_roe: null, min_dividend_yield: 0.04, max_debt_to_equity: null,
    });
  });

  it('点击「质量价值」→ onChange 收到 max_pe=20, min_roe=0.15', () => {
    const { onChange } = renderFilters();
    fireEvent.click(screen.getByText('质量价值'));
    expect(onChange).toHaveBeenCalledWith({
      max_pe: 20, max_pb: null,
      min_roe: 0.15, min_dividend_yield: null, max_debt_to_equity: null,
    });
  });

  it('点击「清空」→ 全 null（覆盖旧值）', () => {
    const { onChange } = renderFilters({ max_pe: 15, max_pb: 2, min_roe: 0.15, min_dividend_yield: null, max_debt_to_equity: null });
    fireEvent.click(screen.getByText('清空'));
    expect(onChange).toHaveBeenCalledWith(EMPTY);
  });

  it('value 匹配某 preset 时该 chip active（含 emerald 类）', () => {
    renderFilters({ max_pe: 15, max_pb: 2, min_roe: null, min_dividend_yield: null, max_debt_to_equity: null });
    const chip = screen.getByText('深度低估');
    expect(chip.className).toMatch(/emerald/);
  });

  it('value 不匹配任何 preset 时所有 chip 都 inactive（无 emerald）', () => {
    renderFilters({ ...EMPTY, max_pe: 18 });   // 18 ≠ 15/20/30
    for (const label of ['深度低估', '高股息', '质量价值']) {
      expect(screen.getByText(label).className).not.toMatch(/emerald/);
    }
  });
});

describe('VALUE_PRESETS / matchesPreset 导出', () => {
  it('VALUE_PRESETS 是数组且每条有 id/label/title/filters', () => {
    expect(Array.isArray(VALUE_PRESETS)).toBe(true);
    expect(VALUE_PRESETS.length).toBeGreaterThan(0);
    for (const p of VALUE_PRESETS) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.title).toBe('string');
      expect(typeof p.filters).toBe('object');
    }
  });

  it('matchesPreset 双 null 字段判等', () => {
    const preset = { max_pe: null, max_pb: null, min_roe: null, min_dividend_yield: null, max_debt_to_equity: null };
    expect(matchesPreset(EMPTY, preset)).toBe(true);
  });

  it('matchesPreset 数字字段需相等', () => {
    expect(matchesPreset({ ...EMPTY, max_pe: 15 }, { max_pe: 15 })).toBe(true);
    expect(matchesPreset({ ...EMPTY, max_pe: 16 }, { max_pe: 15 })).toBe(false);
  });

  it('matchesPreset 一边 null 一边数字 → 不等', () => {
    expect(matchesPreset({ ...EMPTY, max_pe: null }, { max_pe: 15 })).toBe(false);
    expect(matchesPreset({ ...EMPTY, max_pe: 15 }, { max_pe: null })).toBe(false);
  });
});
