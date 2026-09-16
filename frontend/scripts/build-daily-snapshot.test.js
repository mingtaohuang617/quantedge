import { expect, it } from 'vitest';
import { buildDailySnapshot } from './build-daily-snapshot.mjs';
const fixture=()=>{
  const bar={time:1789516800,open:10,high:12,low:9,close:11};
  return {total:1,completed_at:'2026-09-16T12:00:00Z',before_favorites:{tickers:['PRIVATE']},results:[{
    ticker:'SPY',status:'success',token:'do-not-copy',bars:[bar,{...bar,time:bar.time-86400}],
    snapshot:{timeframe:'1D',resolved_symbol:'BATS:SPY',received_at:'2026-09-16T11:00:00Z',bar,indicators:{time:bar.time,rsi:50,macd:2,signal:1,histogram:1}},
  }]};
};
const build=report=>buildDailySnapshot(report,[{ticker:'SPY'}]);
it('whitelists a reviewed daily snapshot without credentials, favorite membership or raw history',()=>{
  const out=build(fixture());
  expect(out.success).toBe(1);expect(out.rows[0].bar_count).toBe(2);
  expect(out.rows[0].stale).toBe(false);
  expect(JSON.stringify(out)).not.toMatch(/PRIVATE|do-not-copy|before_favorites|"bars"/);
});
it('rejects incomplete, duplicate, missing-universe and misresolved rows',()=>{
  const incomplete=fixture();delete incomplete.completed_at;
  expect(()=>build(incomplete)).toThrow('not completed');
  const duplicate=fixture();duplicate.total=2;duplicate.results.push(duplicate.results[0]);
  expect(()=>build(duplicate)).toThrow('duplicate');
  expect(()=>buildDailySnapshot(fixture(),[{ticker:'QQQ'}])).toThrow('omits');
  const wrong=fixture();wrong.results[0].snapshot.resolved_symbol='BATS:QQQ';
  expect(()=>build(wrong)).toThrow('mismatch');
});
it('rejects invalid OHLC, history order and inconsistent indicators instead of imputing data',()=>{
  for(const mutate of [
    r=>{r.bars[0].low=15;},
    r=>{r.bars[1].time=r.bars[0].time;},
    r=>{r.snapshot.indicators.rsi=101;},
    r=>{r.snapshot.indicators.histogram=3;},
    r=>{r.snapshot.indicators.time--;},
  ]){const input=fixture();mutate(input.results[0]);expect(()=>build(input)).toThrow();}
});
it('retains explicitly failed rows and flags stale candles without inventing replacement prices',()=>{
  const failed=fixture();failed.results[0]={ticker:'SPY',status:'failed',error:'HTTP_502'};
  expect(build(failed).rows[0]).toEqual({ticker:'SPY',status:'failed',error:'HTTP_502'});
  const stale=fixture();stale.results[0].snapshot.received_at='2026-09-30T11:00:00Z';
  expect(build(stale).rows[0].stale).toBe(true);
});
