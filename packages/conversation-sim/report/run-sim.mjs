#!/usr/bin/env node
// Runs the sims and always writes the suite report as JSON; the HTML page is built only on request.
// usage: node report/run-sim.mjs [--html] [vitest args...]
//   --html                    also render report/runs/sim-<time>.html from the JSON
//   SIM_REPORT_LIVE_ONLY=1    keep only tests that called a real model
// Run from packages/conversation-sim (the package scripts do this).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'runs');
// pnpm passes a literal `--` through to the script.
const forwarded = process.argv.slice(2).filter((arg) => arg !== '--');
const wantHtml = forwarded.includes('--html') || process.env.SIM_REPORT_HTML === '1';
const vitestArgs = forwarded.filter((arg) => arg !== '--html');

const startedAt = new Date();
const stamp = startedAt.toISOString().slice(0, 19).replace(/:/g, '-');
mkdirSync(outDir, { recursive: true });
const vitestJson = join(outDir, `sim-${stamp}.vitest.json`);
const reportJson = join(outDir, `sim-${stamp}.json`);

const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1;

const vitestBin = join(here, '..', 'node_modules', 'vitest', 'vitest.mjs');
const vitestStatus = run([vitestBin, 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${vitestJson}`, ...vitestArgs]);

// The report never changes the run's exit code: a failed report is a warning, the sims' result stands.
if (!existsSync(vitestJson)) {
  console.warn(`sim report skipped: Vitest wrote no JSON results (${vitestJson}).`);
} else {
  const reportArgs = [join(here, 'from-sim-run.mjs'), '--vitest', vitestJson, '--runs', 'runs', '--since', startedAt.toISOString(), '--out', reportJson];
  if (process.env.SIM_REPORT_LIVE_ONLY === '1') reportArgs.push('--live-only');
  if (run(reportArgs) !== 0) console.warn('sim report: building the JSON report failed.');
  else if (wantHtml && run([join(here, 'render-report.mjs'), reportJson]) !== 0) console.warn('sim report: rendering the HTML report failed.');
}
process.exit(vitestStatus);
