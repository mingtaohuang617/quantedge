import { expect, it, vi } from 'vitest';
import { dailySymbol, buildDailyQueue, loadDailyFavorites, dailySummary, runDailyQueue } from './dailyWatchlist.js';
const data = { timeframe:'1D', resolved_symbol:'BATS:AAPL', received_at:'2026-09-15T09:00:00Z',bars:[{time:1789344000,close:200}],indicators:{time:1789344000,rsi:50,macd:1,signal:2,histogram:-1} };
it('maps supported markets without inventing primary US exchanges',()=>{
  expect(dailySymbol('000660.KS')).toBe('KRX:000660'); expect(dailySymbol('005930.KS')).toBe('KRX:005930');
  expect(dailySymbol('07747.HK')).toBe('HKEX:7747'); expect(dailySymbol('07709.HK')).toBe('HKEX:7709'); expect(dailySymbol('07552.HK')).toBe('HKEX:7552');
  expect(dailySymbol('00700.HK')).toBe('HKEX:700'); expect(dailySymbol('600519.SS')).toBe('SSE:600519');
  expect(dailySymbol('300750.SZ')).toBe('SZSE:300750'); expect(dailySymbol('BRK-B')).toBe('BATS:BRK.B');
  expect(dailySymbol('SPY')).toBe('BATS:SPY'); expect(dailySymbol('BTC-USD')).toBeNull(); expect(dailySymbol('7203.T')).toBeNull();
});
it('includes every star first, including stars outside the pool, then deduplicates expansion',()=>{
  expect(buildDailyQueue(['MSFT','AAPL','MSFT'],[{ticker:'AAPL'},{ticker:'SPY'}],true).map(x=>[x.ticker,x.favorite])).toEqual([['MSFT',true],['AAPL',true],['SPY',false]]);
});
it('respects authoritative empty favorites, labels fallback and never writes stars',async()=>{
  const storage={getItem:()=> '["AAPL"]',setItem:vi.fn()};
  expect((await loadDailyFavorites(async()=>({tickers:[],updated_at:'2026-09-15',kv:true}),storage)).tickers).toEqual([]);
  expect((await loadDailyFavorites(async()=>{throw Error();},storage)).source).toBe('local'); expect(storage.setItem).not.toHaveBeenCalled();
});
it('rejects intraday and mismatched indicator bars',()=>{
  expect(()=>dailySummary({...data,timeframe:'60'})).toThrow(); expect(()=>dailySummary({...data,indicators:{time:1}})).toThrow();
});
it('paces requests, continues partial failures and records unsupported separately',async()=>{
  const request=vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('network'));const wait=vi.fn();const onResult=vi.fn();
  const result=await runDailyQueue(buildDailyQueue(['AAPL','SPY','7203.T']),{request,wait,onResult});
  expect(result).toEqual({success:1,failed:1,skipped:1,stopped:false}); expect(wait).toHaveBeenCalledWith(6000);
  expect(request.mock.calls.every(([url])=>url.endsWith('timeframe=1D'))).toBe(true);
});
it('halts auth failures and cancellation before expanding',async()=>{
  const request=vi.fn().mockRejectedValue(Object.assign(new Error(),{status:503}));const onResult=vi.fn();
  const result=await runDailyQueue(buildDailyQueue(['AAPL','SPY']),{request,onResult}); expect(result.stopped).toBe(true);expect(request).toHaveBeenCalledTimes(1);
  const abort=new AbortController(); abort.abort(); expect((await runDailyQueue(buildDailyQueue(['AAPL']),{request,onResult,signal:abort.signal})).stopped).toBe(true);
});
