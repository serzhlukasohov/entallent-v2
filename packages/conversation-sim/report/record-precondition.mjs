#!/usr/bin/env node
// Records a candidate precondition from a recording file and builds the suite report QA reviews.
// usage: pnpm sim:record <recording.json> (--live | --scripted) [--html] [--candidates <dir>]
//   --live      the bot answers through the real model (calls OpenAI/Azure; run only when asked to)
//   --scripted  the bot answers through the scripted provider (framework check, no model calls)
// Output: <candidates>/<name>/precondition.json, plus runs/ with the run report, vitest.json,
// report.json (and report.html with --html). Approve the reviewed candidate with pnpm sim:approve.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: pnpm sim:record <recording.json> (--live | --scripted) [--html] [--candidates <dir>]';
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
// Paths resolve against the folder pnpm was started from, so the same command works from the repo root.
const base = process.env.INIT_CWD ?? process.cwd();

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const positional = [];
let mode = null;
let wantHtml = false;
let candidatesDir = join(packageRoot, 'precondition-candidates');
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--live' || arg === '--scripted') {
    if (mode && mode !== arg.slice(2)) fail(`choose one of --live and --scripted\n${USAGE}`);
    mode = arg.slice(2);
  } else if (arg === '--html') wantHtml = true;
  else if (arg === '--candidates') candidatesDir = resolve(base, argv[++index] ?? fail(USAGE));
  else if (arg.startsWith('--')) fail(`unknown option ${arg}\n${USAGE}`);
  else positional.push(arg);
}
if (positional.length !== 1 || !mode) fail(`${USAGE}\nThe provider is never implied: a live recording calls the real model.`);

const recordingFile = resolve(base, positional[0]);
let name;
try {
  name = JSON.parse(readFileSync(recordingFile, 'utf8')).name;
} catch (error) {
  fail(`${recordingFile}: cannot read recording JSON: ${error.message}`);
}
// Full validation happens in the runner; the name only has to be a safe folder name here.
if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
  fail(`${recordingFile}: name: use lowercase letters, digits and single dashes (kebab-case)`);
}

const candidateDir = join(candidatesDir, name);
const runsDir = join(candidateDir, 'runs');
mkdirSync(runsDir, { recursive: true });
const startedAt = new Date();
const vitestJson = join(runsDir, 'vitest.json');
const reportJson = join(runsDir, 'report.json');
const reportHtml = join(runsDir, 'report.html');
// Outputs of an earlier recording must not pass for this one's.
for (const stale of [vitestJson, reportJson, reportHtml]) rmSync(stale, { force: true });

const run = (args, env = {}) => spawnSync(process.execPath, args, { stdio: 'inherit', cwd: packageRoot, env: { ...process.env, ...env } }).status ?? 1;
const vitestBin = join(packageRoot, 'node_modules', 'vitest', 'vitest.mjs');
const status = run([
  vitestBin, 'run', 'src/recording/record.run.test.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${vitestJson}`,
], {
  SIM_RECORD_RUNNER: '1',
  SIM_RECORD_FILE: recordingFile,
  SIM_RECORD_PROVIDER: mode,
  SIM_RECORD_CANDIDATES_DIR: candidatesDir,
  SIM_GATE_REPORT_DIR: runsDir,
});

// The report never changes the exit code: a failed report is a warning, the recording's result stands.
if (!existsSync(vitestJson)) {
  console.warn(`recording report skipped: Vitest wrote no JSON results (${vitestJson}).`);
} else if (run([join(here, 'from-sim-run.mjs'), '--vitest', vitestJson, '--runs', runsDir, '--since', startedAt.toISOString(),
  '--out', reportJson, '--title', `Recording ${name} (${mode})`]) !== 0) {
  console.warn('recording report: building the JSON report failed.');
} else if (wantHtml && run([join(here, 'render-report.mjs'), reportJson, reportHtml]) !== 0) {
  console.warn('recording report: rendering the HTML report failed.');
}

const candidate = join(candidateDir, 'precondition.json');
const fresh = existsSync(candidate) && statSync(candidate).mtimeMs >= startedAt.getTime() - 2_000; // slack for coarse file times
if (status === 0 && fresh) {
  console.log(`\ncandidate: ${candidate}\nreport:    ${reportJson}${wantHtml ? ` (+ report.html)` : ''}`
    + `\nreview both, then: pnpm sim:approve ${candidateDir}`);
} else {
  console.error('\nrecording failed: no candidate was written; see the report above.');
  if (existsSync(candidate)) console.error(`${candidate} is from an earlier recording, not this one.`);
}
process.exit(status);

function fail(message) {
  console.error(message);
  process.exit(1);
}
