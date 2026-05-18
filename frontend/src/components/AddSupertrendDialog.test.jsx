// @vitest-environment jsdom
// AddSupertrendDialog 组件渲染测试 — 自定义赛道添加对话框基础行为
// 仅测 main 上已有的逻辑（form / 校验 / save / AI 生成）；PR #80 加的
// defaultStrategy chip 由 PR #80 合并后另起测试
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../quant-platform.jsx', () => ({
  apiFetch: (...args) => apiFetchMock(...args),
}));

import AddSupertrendDialog from './AddSupertrendDialog.jsx';

afterEach(() => cleanup());

function renderDialog(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  return render(<AddSupertrendDialog {...props} />);
}

describe('AddSupertrendDialog', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('open=true 渲染头部「添加自定义赛道」+ 关闭按钮', () => {
    renderDialog();
    expect(screen.getByText('添加自定义赛道')).toBeInTheDocument();
  });

  it('open=false 不渲染', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('添加自定义赛道')).not.toBeInTheDocument();
  });

  it('赛道名为空时「AI 生成」按钮 disabled', () => {
    renderDialog();
    const aiBtn = screen.getByRole('button', { name: /AI 生成/ });
    expect(aiBtn).toBeDisabled();
  });

  it('赛道名为空时「添加赛道」按钮 disabled', () => {
    renderDialog();
    const saveBtn = screen.getByRole('button', { name: /添加赛道/ });
    expect(saveBtn).toBeDisabled();
  });

  it('填了名称但关键词全空 → 保存触发校验错误', async () => {
    renderDialog();
    // 填名称
    const nameInputs = screen.getAllByRole('textbox');
    // 找名称 input — 通过 placeholder 区分
    const nameInput = screen.getByPlaceholderText(/如 新能源/);
    fireEvent.change(nameInput, { target: { value: '测试赛道' } });
    // 点保存
    const saveBtn = screen.getByRole('button', { name: /添加赛道/ });
    fireEvent.click(saveBtn);
    // 校验错误显示
    await waitFor(() => {
      expect(screen.getByText(/至少填一个中文或英文关键词/)).toBeInTheDocument();
    });
    // 不调 apiFetch
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('填了名称 + 关键词，save 调 apiFetch with correct body', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true, item: { id: 'test', name: '测试赛道' } });
    const onSaved = vi.fn();
    renderDialog({ onSaved });

    fireEvent.change(screen.getByPlaceholderText(/如 新能源/), { target: { value: '测试赛道' } });
    fireEvent.change(screen.getByPlaceholderText(/光伏, 储能/), { target: { value: '光伏, 储能' } });

    fireEvent.click(screen.getByRole('button', { name: /添加赛道/ }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/watchlist/10x/supertrends',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"name":"测试赛道"'),
        })
      );
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('AI 生成 keywords 后 textarea 填充返回的 zh/en 关键词', async () => {
    apiFetchMock.mockResolvedValueOnce({
      ok: true,
      keywords_zh: ['光伏', '储能'],
      keywords_en: ['Solar', 'Battery'],
    });
    renderDialog();

    fireEvent.change(screen.getByPlaceholderText(/如 新能源/), { target: { value: '新能源' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成/ }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/光伏, 储能/).value).toContain('光伏');
    });
    expect(screen.getByPlaceholderText(/Solar, Battery/).value).toContain('Solar');
  });

  it('AI 生成失败时显示 error 信息', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: false, error: 'LLM 不可用' });
    renderDialog();

    fireEvent.change(screen.getByPlaceholderText(/如 新能源/), { target: { value: '新能源' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成/ }));

    await waitFor(() => {
      expect(screen.getByText('LLM 不可用')).toBeInTheDocument();
    });
  });
});

describe('AddSupertrendDialog — strategy radio（PR #77 + #80）', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('defaultStrategy="growth" 默认选中成长型 radio', () => {
    const { container } = renderDialog({ defaultStrategy: 'growth' });
    const growthRadio = container.querySelector('input[type="radio"][value="growth"]');
    const valueRadio = container.querySelector('input[type="radio"][value="value"]');
    expect(growthRadio.checked).toBe(true);
    expect(valueRadio.checked).toBe(false);
  });

  it('defaultStrategy="value" 默认选中价值型 radio', () => {
    const { container } = renderDialog({ defaultStrategy: 'value' });
    const growthRadio = container.querySelector('input[type="radio"][value="growth"]');
    const valueRadio = container.querySelector('input[type="radio"][value="value"]');
    expect(growthRadio.checked).toBe(false);
    expect(valueRadio.checked).toBe(true);
  });

  it('defaultStrategy 缺省时默认 growth', () => {
    const { container } = renderDialog();  // 不传 defaultStrategy
    const growthRadio = container.querySelector('input[type="radio"][value="growth"]');
    expect(growthRadio.checked).toBe(true);
  });

  it('点击 value radio 切换到 value', () => {
    const { container } = renderDialog({ defaultStrategy: 'growth' });
    const valueRadio = container.querySelector('input[type="radio"][value="value"]');
    fireEvent.click(valueRadio);
    expect(valueRadio.checked).toBe(true);
  });

  it('strategy radio 提示文本明示两种策略含义', () => {
    renderDialog();
    expect(screen.getByText(/AI 算力/)).toBeInTheDocument();
    expect(screen.getByText(/高股息/)).toBeInTheDocument();
  });

  it('保存时 strategy 字段透传到 POST body（defaultStrategy=value）', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true, item: { id: 'test' } });
    renderDialog({ defaultStrategy: 'value' });

    fireEvent.change(screen.getByPlaceholderText(/如 新能源/), { target: { value: '高股息测试' } });
    fireEvent.change(screen.getByPlaceholderText(/光伏, 储能/), { target: { value: '银行, 公用事业' } });
    fireEvent.click(screen.getByRole('button', { name: /添加赛道/ }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    const callBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(callBody.strategy).toBe('value');
  });

  it('AI 生成 keywords 时透传 strategy 到 LLM endpoint', async () => {
    apiFetchMock.mockResolvedValueOnce({
      ok: true, keywords_zh: ['银行'], keywords_en: ['Banks'],
    });
    renderDialog({ defaultStrategy: 'value' });

    fireEvent.change(screen.getByPlaceholderText(/如 新能源/), { target: { value: '高股息' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成/ }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    const callBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(callBody.strategy).toBe('value');
  });
});
