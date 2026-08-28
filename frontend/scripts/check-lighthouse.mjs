import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] || '.lighthouse/report.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const audits = report.audits || {};
const values = {
  performance: report.categories?.performance?.score ?? 0,
  lcpMs: audits['largest-contentful-paint']?.numericValue ?? Infinity,
  cls: audits['cumulative-layout-shift']?.numericValue ?? Infinity,
  tbtMs: audits['total-blocking-time']?.numericValue ?? Infinity,
};
// Stage-two fixed lab baseline. Stage three tightens performance/LCP to the
// product acceptance targets after the shell and route split lands.
const limits = { performance: 0.8, lcpMs: 4000, cls: 0.1, tbtMs: 200 };
const failures = [];
if (values.performance < limits.performance) failures.push(`performance ${values.performance} < ${limits.performance}`);
if (values.lcpMs > limits.lcpMs) failures.push(`LCP ${values.lcpMs}ms > ${limits.lcpMs}ms`);
if (values.cls > limits.cls) failures.push(`CLS ${values.cls} > ${limits.cls}`);
if (values.tbtMs > limits.tbtMs) failures.push(`TBT ${values.tbtMs}ms > ${limits.tbtMs}ms`);

console.log(JSON.stringify({ values, limits, note: 'TBT is the fixed lab proxy used when real-user INP telemetry is unavailable.' }, null, 2));
if (failures.length) {
  console.error(`Lighthouse budget failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
