import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const assetsDir = new URL("../dist/assets/", import.meta.url);
const files = readdirSync(assetsDir);

const budgets = [
  { label: "application shell", prefix: "quant-platform-", limitKb: 120 },
  { label: "mobile scoring", prefix: "ScoringDashboard-", limitKb: 45 },
  { label: "static market data", prefix: "data-", limitKb: 130 },
  { label: "charting vendor", prefix: "recharts-", limitKb: 165 },
];

let failed = false;

for (const budget of budgets) {
  const file = files.find((name) => name.startsWith(budget.prefix) && name.endsWith(".js"));
  if (!file) {
    console.error(`Missing bundle: ${budget.label} (${budget.prefix}*.js)`);
    failed = true;
    continue;
  }

  const gzipKb = gzipSync(readFileSync(new URL(file, assetsDir))).byteLength / 1024;
  const ok = gzipKb <= budget.limitKb;
  console.log(`${ok ? "PASS" : "FAIL"} ${budget.label}: ${gzipKb.toFixed(2)} KB gzip / ${budget.limitKb} KB`);
  failed ||= !ok;
}

if (failed) process.exit(1);
