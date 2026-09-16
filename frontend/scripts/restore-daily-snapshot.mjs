// CI only: restore encrypted repository-secret chunks into the server bundle.
// Source repository is public; never print or commit the snapshot payload.
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function decodeDailySnapshot(encoded) {
  if(!encoded || encoded.length>192000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('Encrypted daily snapshot is missing or invalid');
  let content,data;
  try { content=gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:2*1024*1024}); data=JSON.parse(content.toString('utf8')); }
  catch { throw new Error('Encrypted daily snapshot could not be decoded'); }
  if(data?.timeframe!=='1D'||!Array.isArray(data.rows)||data.rows.length!==data.total||!Number.isFinite(Date.parse(data.generated_at)))throw new Error('Invalid restored daily snapshot');
  return {content,data};
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
const {content,data}=decodeDailySnapshot([1,2,3,4].map(index=>process.env[`QUANTEDGE_DAILY_SNAPSHOT_${index}`]||'').join(''));
await mkdir(new URL('../api/_lib/daily-data/',import.meta.url),{recursive:true});
await writeFile(new URL('../api/_lib/daily-data/snapshot.json',import.meta.url),content);
console.log(JSON.stringify({restored_daily_rows:data.total,generated_at:data.generated_at}));
}
