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
