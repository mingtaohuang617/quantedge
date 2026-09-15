// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TradingViewPanel from './TradingViewPanel.jsx';
afterEach(cleanup);
it('queries private endpoint and displays delayed source with aligned values', async () => {
  const request=vi.fn().mockResolvedValue({resolved_symbol:'HKEX_DLY:700',currency:'HKD',delay_seconds:900,received_at:'2026-09-15T09:00:00Z',bars:[{time:1789455600,close:500}],indicators:{rsi:55,macd:2,signal:1,histogram:1}});
  render(<TradingViewPanel request={request}/>); fireEvent.change(screen.getByLabelText('TradingView 标的'),{target:{value:'HKEX:700'}}); fireEvent.click(screen.getByText('查询快照'));
  expect(await screen.findByText('延迟 15 分钟')).toBeTruthy(); expect(screen.getByText('HKEX_DLY:700 · HKD')).toBeTruthy();
  expect(request).toHaveBeenCalledWith('/private/market-data/tradingview?symbol=HKEX%3A700&timeframe=1D',{noRetry:true});
  expect(screen.getByLabelText('K 线周期').readOnly).toBe(true);
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.change(screen.getByLabelText('TradingView 标的'),{target:{value:'NASDAQ:AAPL'}}); expect(screen.queryByText('HKEX_DLY:700 · HKD')).toBeNull();
});
it('shows configuration failures without false success', async () => {
  render(<TradingViewPanel request={vi.fn().mockRejectedValue(new Error('尚未启用'))}/>); fireEvent.click(screen.getByText('查询快照')); expect((await screen.findByRole('alert')).textContent).toBe('尚未启用');
});
