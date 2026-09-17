import { expect,it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { decodeDailySnapshot } from './restore-daily-snapshot.mjs';
const encode=value=>gzipSync(JSON.stringify(value)).toString('base64');
it('round trips the exact private snapshot without writing on import',()=>{
  const value={timeframe:'1D',total:0,rows:[],generated_at:'2026-09-16T11:00:00Z'};
  expect(decodeDailySnapshot(encode(value)).data).toEqual(value);
});
it('fails closed on missing, corrupt, oversized or intraday input without echoing content',()=>{
  for(const value of ['', 'secret-value', 'A'.repeat(192001), Buffer.from('private payload').toString('base64'), encode({timeframe:'60',total:0,rows:[],generated_at:'2026-09-16'})])expect(()=>decodeDailySnapshot(value)).toThrow();
  expect(()=>decodeDailySnapshot(Buffer.from('private payload').toString('base64'))).toThrow('could not be decoded');
});
