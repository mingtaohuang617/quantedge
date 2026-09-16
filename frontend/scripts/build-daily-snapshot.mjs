// Convert an explicit full-universe probe report into a private release snapshot.
// Never copy credentials, favorite membership, or arbitrary upstream fields.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dailySummary, dailySymbol } from '../src/lib/dailyWatchlist.js';
import { STOCKS } from '../src/data.js';
import { pathToFileURL } from 'node:url';
export function buildDailySnapshot(report, universe = STOCKS) {
if(!Number.isFinite(Date.parse(report?.completed_at)) || !Array.isArray(report.results) || report.results.length!==report.total)throw new Error('Full universe probe has not completed');
const seen=new Set();
const rows=report.results.map(row=>{
  if(typeof row.ticker!=='string'||seen.has(row.ticker))throw new Error('Invalid or duplicate ticker');
  seen.add(row.ticker);
  if(row.status!=='success')return {ticker:row.ticker,status:row.status==='unsupported'?'unsupported':'failed',error:row.error||'unsupported_symbol'};
  const snapshot=dailySummary({...row.snapshot,bars:[row.snapshot?.bar]});
  if(snapshot.resolved_symbol.replace('_DLY:',':')!==dailySymbol(row.ticker))throw new Error(`Resolved symbol mismatch: ${row.ticker}`);
  const bars=row.bars;
  if(!Array.isArray(bars)||bars.length<2||bars.length>100)throw new Error(`Invalid history: ${row.ticker}`);
  if(bars[0].time!==snapshot.bar.time)throw new Error(`Snapshot/history mismatch: ${row.ticker}`);
  for(let i=0;i<bars.length;i++) {
    const b=bars[i];
    if(!['time','open','high','low','close'].every(k=>Number.isFinite(b[k]))||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.low<=0||b.high<b.low||(i>0&&b.time>=bars[i-1].time))throw new Error(`Invalid OHLC sequence: ${row.ticker}`);
  }
  const {rsi,macd,signal,histogram}=snapshot.indicators;
  if(rsi<0||rsi>100||Math.abs(macd-signal-histogram)>1e-8*Math.max(1,Math.abs(macd)))throw new Error(`Invalid indicators: ${row.ticker}`);
  const ageDays=(Date.parse(snapshot.received_at)/1000-snapshot.bar.time)/86400;
  if(ageDays< -1)throw new Error(`Future candle: ${row.ticker}`);
  return {ticker:row.ticker,status:'success',snapshot,bar_count:bars.length,stale:ageDays>7};
});
const output={schema_version:'1.0',timeframe:'1D',generated_at:report.completed_at,started_at:report.started_at,total:rows.length,success:rows.filter(row=>row.status==='success').length,rows};
if(universe.some(stock=>!seen.has(stock.ticker)))throw new Error('Report omits a published universe ticker');
return output;
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
const source=process.argv[2];
if(!source)throw new Error('Usage: node scripts/build-daily-snapshot.mjs <report.json>');
const output=buildDailySnapshot(JSON.parse(await readFile(source,'utf8')));
const rows=output.rows;
const destination=new URL('../api/_lib/daily-data/snapshot.json',import.meta.url);
await mkdir(new URL('.',destination),{recursive:true});
await writeFile(destination,JSON.stringify(output));
console.log(JSON.stringify({total:output.total,success:output.success,unavailable:rows.filter(row=>row.status!=='success').map(row=>row.ticker),stale:rows.filter(row=>row.stale).map(row=>row.ticker)}));
}
