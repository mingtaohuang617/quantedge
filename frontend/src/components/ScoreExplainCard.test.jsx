// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ScoreExplainCard from './ScoreExplainCard.jsx';
import { apiFetch } from '../quant-platform.jsx';

vi.mock('../quant-platform.jsx', () => ({ apiFetch: vi.fn() }));
vi.mock('../i18n.jsx', () => ({ useLang: () => ({ t: key => key }) }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const weights = { quality: 60, timing: 40 };
const stock = { ticker: 'AAA', assetType: 'stock', score: 74, qualityScore: 70,
  timingScore: 80, subScores: {}, scoring: { version: '3.2.0' } };

it('sends the explicit asset type and current scoring contract', async () => {
  apiFetch.mockResolvedValue({ ok: true, explanation: '本次解读' });
  render(<ScoreExplainCard stock={stock} weights={weights} />);
  fireEvent.click(screen.getByText('AI 解读'));
  expect(await screen.findByText('本次解读')).toBeInTheDocument();
  expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({
    assetType: 'stock', modelVersion: '3.2.0', score: 74, weights,
  });
});

it.each(['crypto', 'index_etf', 'leveraged_stock_etf', undefined])('does not offer a stock composite narrative for %s', assetType => {
  const { container } = render(<ScoreExplainCard stock={{ ...stock, assetType }} weights={weights} />);
  expect(container).toBeEmptyDOMElement();
});

it.each(['success', 'failure'])('ignores a late %s after weights change', async outcome => {
  let resolve, reject;
  apiFetch.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const { rerender } = render(<ScoreExplainCard stock={stock} weights={weights} />);
  fireEvent.click(screen.getByText('AI 解读'));
  rerender(<ScoreExplainCard stock={{ ...stock, score: 75 }} weights={{ quality: 50, timing: 50 }} />);
  apiFetch.mockResolvedValueOnce({ ok: true, explanation: '新权重解读' });
  fireEvent.click(screen.getByText('AI 解读'));
  await screen.findByText('新权重解读');
  await act(async () => outcome === 'success' ? resolve({ ok: true, explanation: '旧权重解读' }) : reject(new Error('旧请求失败')));
  expect(screen.getByText('新权重解读')).toBeInTheDocument();
  expect(screen.queryByText('旧权重解读')).not.toBeInTheDocument();
  expect(screen.queryByText('旧请求失败')).not.toBeInTheDocument();
});
