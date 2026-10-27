import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSuiteConfig } from './config';

/**
 * `l2-stack.ts` (Story 14.3): the stack helpers of the opt-in weekly L2 workflow
 * (`.github/workflows/conversation-suite-l2.yml`), which builds a disposable local stack in the
 * job. `tenant-from-seed <log>` prints the one tenant id the seed logged (`Tenant ID: <uuid>`);
 * `worker-env --output <file>` writes `suite.config.json` `l2.workerEnv` as `KEY=VALUE` lines,
 * the env the stack's worker is started with (proactive scheduling off), so the workflow and
 * `run-live.ts` share one source. Reads files only: no database, network or executor, and it
 * never prints environment or secret values.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_LINE = /^\s*Tenant ID:\s*(.*?)\s*$/;

const USAGE = 'usage: l2-stack.ts tenant-from-seed <seed-log> | worker-env --output <file>';

export interface L2StackDeps {
  cwd: string;
  /** The `conversation-sim` package directory (holds `suite.config.json`). */
  packageDir: string;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** The single tenant id in a seed log; throws naming the problem (never the line's value). */
export function tenantFromSeedLog(text: string): string {
  const values = text
    .split(/\r?\n/)
    .map((line) => TENANT_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]!);
  if (values.length === 0) throw new Error('no "Tenant ID:" line in the seed log');
  if (values.length > 1) {
    throw new Error(`${values.length} "Tenant ID:" lines in the seed log, expected one (the seed is not idempotent; seed a fresh database once)`);
  }
  if (!UUID.test(values[0]!)) throw new Error('the "Tenant ID:" line does not hold a UUID');
  return values[0]!.toLowerCase();
}

/** `KEY=VALUE` lines for `l2.workerEnv`, in config order; the values are validated plain tokens. */
export function workerEnvLines(workerEnv: Readonly<Record<string, string>>): string {
  return Object.entries(workerEnv)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
}

export function runL2Stack(argv: readonly string[], deps: L2StackDeps): number {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const [command, ...rest] = args;
  try {
    if (command === 'tenant-from-seed') return tenantFromSeedCommand(rest, deps);
    if (command === 'worker-env') return workerEnvCommand(rest, deps);
  } catch (error) {
    deps.error(`[suite] l2-stack: ${oneLine((error as Error).message)}`);
    return 1;
  }
  deps.error(`[suite] l2-stack: ${USAGE}`);
  return 1;
}

function tenantFromSeedCommand(argv: readonly string[], deps: L2StackDeps): number {
  const { positionals } = parseArgs({ args: [...argv], strict: true, allowPositionals: true, options: {} });
  if (positionals.length !== 1) throw new Error(`tenant-from-seed takes exactly one seed log path; ${USAGE}`);
  let text: string;
  try {
    text = readFileSync(resolve(deps.cwd, positionals[0]!), 'utf8');
  } catch (error) {
    throw new Error(`cannot read the seed log ${positionals[0]} (${(error as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  deps.log(tenantFromSeedLog(text));
  return 0;
}

function workerEnvCommand(argv: readonly string[], deps: L2StackDeps): number {
  const { values } = parseArgs({ args: [...argv], strict: true, allowPositionals: false, options: { output: { type: 'string' } } });
  if (values.output === undefined || values.output.trim() === '') throw new Error(`worker-env: --output <file> is required; ${USAGE}`);
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  if (config.l2 === undefined) {
    throw new Error('worker-env: suite.config.json l2.workerEnv is absent; the L2 stack worker cannot be started with proactive scheduling off');
  }
  const path = resolve(deps.cwd, values.output);
  writeFileSync(path, workerEnvLines(config.l2.workerEnv));
  deps.log(`[suite] l2-stack: wrote the worker env (${Object.keys(config.l2.workerEnv).join(', ')}) to ${values.output}`);
  return 0;
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
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
  process.exitCode = runL2Stack(process.argv.slice(2), {
    cwd: process.cwd(),
    packageDir: resolve(__dirname, '..', '..'),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
