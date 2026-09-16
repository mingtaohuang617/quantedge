// Upload the generated, validated market snapshot only; no favorites or sessions.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const content=await readFile(new URL('../api/_lib/daily-data/snapshot.json',import.meta.url));
const data=JSON.parse(content.toString('utf8'));
if(data?.timeframe!=='1D'||!Array.isArray(data.rows)||data.rows.length!==data.total)throw new Error('Generate a reviewed snapshot first');
const encoded=gzipSync(content).toString('base64');
const size=Math.ceil(encoded.length/4);
if(size>48000)throw new Error('Snapshot exceeds encrypted chunk budget');
for(let i=0;i<4;i++) {
  try {
    execFileSync('gh',['secret','set',`QUANTEDGE_DAILY_SNAPSHOT_${i+1}`,'--repo','mingtaohuang617/quantedge'],{input:encoded.slice(i*size,(i+1)*size),stdio:['pipe','pipe','pipe']});
  } catch { throw new Error(`Encrypted snapshot chunk ${i+1} upload failed`); }
}
console.log(JSON.stringify({encrypted_chunks:4,total:data.total,generated_at:data.generated_at}));
