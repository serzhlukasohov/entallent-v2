#!/usr/bin/env node
// Fills the universal test-report template with one JSON report: node render-report.mjs [data.json] [out.html]
// Without data.json it takes the newest report/runs/sim-*.json; without out.html it writes next to the JSON.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const latest = () => {
  const runsDir = join(here, 'runs');
  const reports = readdirSync(runsDir).filter((file) => /^sim-.*(?<!\.vitest)\.json$/.test(file)).sort();
  return reports.length ? join(runsDir, reports.at(-1)) : null;
};
// pnpm passes a literal `--` through to the script.
const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const dataPath = argv[0] ?? latest();
if (!dataPath) {
  console.error('usage: node render-report.mjs [data.json] [out.html] (no report/runs/sim-*.json found)');
  process.exit(1);
}
const outPath = argv[1] ?? dataPath.replace(/\.json$/, '') + '.html';
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!data.meta?.title) {
  console.error('report data needs meta.title');
  process.exit(1);
}
const template = readFileSync(join(here, 'test-report.template.html'), 'utf8');
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// `<` is escaped so no string in the data can close the JSON script block.
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const html = template
  .replace('<title>Test Report</title>', () => `<title>${escapeHtml(data.meta.title)}</title>`)
  .replace('__REPORT_DATA__', () => json);
writeFileSync(outPath, html);
console.log(`report written: ${outPath}`);
