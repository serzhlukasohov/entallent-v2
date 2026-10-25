import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * `suite:baseline:guard` (architecture AD-13): a pull request that changes committed suite
 * baselines must carry the `baseline-change` label. Imports Node builtins only, so the
 * governance workflow needs no package build. Exit 0 when no baseline changed or the label
 * is present; exit 1 when a baseline changed without the label, and on missing flags,
 * unparseable labels or a git failure (fail closed).
 */

/** Repo-relative prefix of the committed baselines. */
export const BASELINES_PREFIX = 'packages/conversation-sim/baselines/';
export const BASELINE_CHANGE_LABEL = 'baseline-change';

/** Changed baseline paths that are not covered by the `baseline-change` label; pure. */
export function baselineGuardViolations(changedPaths: readonly string[], labels: readonly string[]): string[] {
  if (labels.includes(BASELINE_CHANGE_LABEL)) return [];
  return changedPaths.filter((path) => path.startsWith(BASELINES_PREFIX));
}

/** Parses `--labels` as a JSON array of strings; throws otherwise. */
export function parseLabels(text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('--labels is not valid JSON');
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('--labels must be a JSON array of strings');
  }
  return value;
}

export interface GuardDeps {
  cwd: string;
  log: (line: string) => void;
  error: (line: string) => void;
}

export function runBaselineGuard(argv: readonly string[], deps: GuardDeps): number {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let base: string;
  let head: string;
  let labels: string[];
  try {
    const { values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: { base: { type: 'string' }, head: { type: 'string' }, labels: { type: 'string' } },
    });
    if (!values.base || !values.head || values.labels === undefined) {
      throw new Error('--base <rev>, --head <rev> and --labels <json-array> are required');
    }
    base = values.base;
    head = values.head;
    labels = parseLabels(values.labels);
  } catch (error) {
    deps.error(`[suite] baseline:guard: ${(error as Error).message}`);
    return 1;
  }

  // --no-renames lists a baseline moved out of baselines/ as a deletion under the prefix;
  // -z and core.quotePath=false keep non-ASCII or special paths unquoted.
  const diff = spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--no-renames', `${base}...${head}`], {
    cwd: deps.cwd,
    encoding: 'utf8',
  });
  if (diff.error || diff.status !== 0) {
    const detail = (diff.stderr ?? '').trim().split('\n')[0] || diff.error?.message || 'no output';
    deps.error(`[suite] baseline:guard: git diff ${base}...${head} failed (${detail})`);
    return 1;
  }
  const changed = diff.stdout.split('\0').filter((path) => path !== '');
  const baselineChanges = changed.filter((path) => path.startsWith(BASELINES_PREFIX));
  const violations = baselineGuardViolations(changed, labels);
  if (violations.length > 0) {
    deps.error(`[suite] baseline:guard: baselines changed without the ${BASELINE_CHANGE_LABEL} label:`);
    for (const path of violations) deps.error(`[suite]   - ${path}`);
    return 1;
  }
  if (baselineChanges.length === 0) deps.log('[suite] baseline:guard: no baseline changed');
  else deps.log(`[suite] baseline:guard: ${baselineChanges.length} baseline file(s) changed with the ${BASELINE_CHANGE_LABEL} label`);
  return 0;
}

function isEntryPoint(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = runBaselineGuard(process.argv.slice(2), {
    cwd: process.cwd(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
