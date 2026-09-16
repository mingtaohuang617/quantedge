// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DailyWatchlistPanel from './DailyWatchlistPanel.jsx';
beforeEach(()=>localStorage.clear()); afterEach(cleanup);
it('loads actual stars and refreshes only daily data, preserving favorites',async()=>{
  const request=vi.fn(async path => path === '/watchlist/favorites' ? {tickers:['00700.HK'],kv:true,updated_at:'2026-09-15'} : {timeframe:'1D',resolved_symbol:'HKEX_DLY:700',received_at:'2026-09-15T09:00:00Z',bars:[{time:1789435800,close:438.8}],indicators:{time:1789435800,rsi:47,macd:1,signal:2,histogram:-1}});
  render(<DailyWatchlistPanel request={request} stocks={[{ticker:'SPY'}]} />);
  const button=screen.getByText('更新全部星标日线'); await waitFor(()=>expect(button.disabled).toBe(false)); fireEvent.click(button);
  expect(await screen.findByText('438.8')).toBeTruthy();
  expect(request).toHaveBeenCalledWith('/private/market-data/tradingview?symbol=HKEX%3A700&timeframe=1D',expect.objectContaining({noRetry:true}));
  expect(localStorage.getItem('quantedge_favorites')).toBeNull();
  expect(JSON.parse(localStorage.getItem('quantedge_daily_snapshots_v1'))['00700.HK'].timeframe).toBe('1D');
});
it('never expands an unknown empty favorites list into a guessed watchlist',async()=>{
  const request=vi.fn().mockResolvedValue({tickers:[],kv:false});
  render(<DailyWatchlistPanel request={request} stocks={[{ticker:'SPY'}]}/>);
  const button=screen.getByText('先星标，再扩展当前股票池');await waitFor(()=>expect(button.disabled).toBe(false));fireEvent.click(button);
  expect(await screen.findByText('未读取到星标名单，未开始更新')).toBeTruthy();expect(request.mock.calls.every(([path])=>!path.includes('tradingview?'))).toBe(true);
});
it('loads published universe rows without triggering per-stock refresh',async()=>{
  const snapshot={timeframe:'1D',resolved_symbol:'BATS:SPY',received_at:'2026-09-16T09:00:00Z',bar:{time:1789435800,close:600},indicators:{time:1789435800,rsi:47,macd:1,signal:2,histogram:-1}};
  const request=vi.fn(async path=>path==='/watchlist/favorites'?{tickers:['MU'],kv:true,updated_at:'2026-09-16'}:{timeframe:'1D',generated_at:'2026-09-16T09:00:00Z',rows:[{ticker:'SPY',status:'success',snapshot}]});
  render(<DailyWatchlistPanel request={request}/>);
  expect(await screen.findByText('600')).toBeTruthy();expect(screen.getByText('SPY')).toBeTruthy();
  expect(request.mock.calls.some(([path])=>path.includes('tradingview?'))).toBe(false);expect(localStorage.getItem('quantedge_favorites')).toBeNull();
});
