import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../api', import.meta.url));
const functions = [];

async function walk(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(`${directory}/${entry.name}`, path);
    } else if (entry.name.endsWith('.js')) {
      functions.push(path);
    }
  }
}

await walk(apiRoot);
functions.sort();
const limit = 12;
console.log(JSON.stringify({ count: functions.length, limit, functions }, null, 2));
if (functions.length > limit) {
  throw new Error(`Vercel public function count ${functions.length} exceeds the project limit ${limit}`);
}
