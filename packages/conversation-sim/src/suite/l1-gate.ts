import { spawnSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSuiteConfig } from './config';

/**
 * `l1-gate.ts` (architecture AD-15): the only decision logic of the opt-in L1 pull-request
 * gate (`.github/workflows/conversation-suite-l1-pr.yml`). `changes` lists the paths a pull
 * request changed and reports whether any of them is gated; `decide` turns that, the fork
 * flag, the opt-in variable and credential presence booleans into `run`, `skip` or `error`.
 * Imports Node builtins and `loadSuiteConfig` only, so the `changes` job needs no package
 * build. Never reads or prints a credential value: credentials arrive as `HAS_*` booleans.
 */

/** Repo-relative gated paths; `**` matches any depth, `*` one path segment. */
export const L1_GATE_PATHS = [
  'packages/ai-openai/src/prompts/**',
  'packages/ai-openai/src/openai-provider.ts',
  'packages/application/src/use-cases/conversation-orchestrator.ts',
  'packages/application/src/use-cases/proactive-*.ts',
  'packages/application/src/policies/**',
  'packages/application/src/utils/quiet-hours.ts',
  'packages/conversation-sim/**',
] as const;

/** The repository variable that opts the gate in to live L1 runs. */
export const L1_GATE_VARIABLE = 'CONVERSATION_SUITE_L1_PR_GATE_ENABLED';

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === '*' && glob[index + 1] === '*') {
      source += '.+';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const GATED = L1_GATE_PATHS.map(globToRegExp);

/** Whether a repo-relative path is gated; pure. */
export function isL1GatePath(path: string): boolean {
  return GATED.some((pattern) => pattern.test(path));
}

/** The gated subset of changed paths, in input order; pure. */
export function l1GateChangedPaths(paths: readonly string[]): string[] {
  return paths.filter(isL1GatePath);
}

export type CredentialName =
  | 'OPENAI_API_KEY'
  | 'AZURE_OPENAI_ENDPOINT'
  | 'AZURE_OPENAI_API_KEY'
  | 'AZURE_OPENAI_API_VERSION'
  | 'AZURE_OPENAI_TESTING_DEPLOYMENT';

export const CREDENTIAL_NAMES: readonly CredentialName[] = [
  'OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_TESTING_DEPLOYMENT',
];

export interface L1GateInput {
  /** Any gated path changed. */
  changed: boolean;
  /** The pull request comes from a fork. */
  fork: boolean;
  /** The raw value of `CONVERSATION_SUITE_L1_PR_GATE_ENABLED`; only exactly `true` opts in. */
  enabled: string | undefined;
  /** `suite.config.json` `judge.provider`. */
  judgeProvider: 'openai' | 'azure_openai';
  /** Credential presence (never values). */
  credentials: Readonly<Record<CredentialName, boolean>>;
}

export interface L1GateDecision {
  decision: 'run' | 'skip' | 'error';
  /** One line, no credential values. */
  message: string;
}

/** The credential names the judge and the coach need but are absent, in a stable order; pure. */
export function missingL1Credentials(input: Pick<L1GateInput, 'judgeProvider' | 'credentials'>): CredentialName[] {
  const needed = new Set<CredentialName>();
  if (input.judgeProvider === 'openai') needed.add('OPENAI_API_KEY');
  else for (const name of ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_API_VERSION'] as const) needed.add(name);
  // The coach provider (`createLiveProvider`) goes to Azure whenever the endpoint is set.
  if (input.credentials.AZURE_OPENAI_ENDPOINT) {
    for (const name of ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_TESTING_DEPLOYMENT'] as const) {
      needed.add(name);
    }
  } else {
    needed.add('OPENAI_API_KEY');
  }
  return CREDENTIAL_NAMES.filter((name) => needed.has(name) && !input.credentials[name]);
}

/**
 * Not changed -> skip; fork -> skip; not opted in -> skip naming the variable; opted in with
 * missing credentials -> error (a misconfigured opt-in fails closed); else run. Pure.
 */
export function decideL1Gate(input: L1GateInput): L1GateDecision {
  if (!input.changed) {
    return {
      decision: 'skip',
      message: 'L1 gate skipped: no gated path changed (prompts, provider, orchestrator, proactive, policies, quiet hours, conversation-sim).',
    };
  }
  if (input.fork) {
    return {
      decision: 'skip',
      message: 'L1 gate skipped: pull requests from forks never run live models or receive secrets.',
    };
  }
  if (input.enabled !== 'true') {
    return {
      decision: 'skip',
      message: `L1 gate skipped: live L1 runs are disabled; set the repository variable ${L1_GATE_VARIABLE} to true to opt in.`,
    };
  }
  const missing = missingL1Credentials(input);
  if (missing.length > 0) {
    return {
      decision: 'error',
      message: `L1 gate is enabled (${L1_GATE_VARIABLE}=true) but model credentials are missing: ${missing.join(', ')}. Configure the secrets or unset the variable.`,
    };
  }
  return { decision: 'run', message: 'L1 gate runs: a gated path changed and live L1 runs are enabled.' };
}

export interface L1GateDeps {
  cwd: string;
  /** The `conversation-sim` package directory (holds `suite.config.json`). */
  packageDir: string;
  env: Readonly<Record<string, string | undefined>>;
  log: (line: string) => void;
  error: (line: string) => void;
  /** Appends to the `--output` file; defaults to `appendFileSync`. */
  append?: (path: string, text: string) => void;
}

const USAGE = 'usage: l1-gate.ts changes --base <sha> --head <sha> [--output <file>] | decide --changed <true|false> [--output <file>]';

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

export function runL1Gate(argv: readonly string[], deps: L1GateDeps): number {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const [command, ...rest] = args;
  const append = deps.append ?? ((path: string, text: string) => appendFileSync(path, text));
  try {
    if (command === 'changes') return changesCommand(rest, deps, append);
    if (command === 'decide') return decideCommand(rest, deps, append);
  } catch (error) {
    deps.error(`[suite] l1-gate: ${oneLine((error as Error).message)}`);
    return 1;
  }
  deps.error(`[suite] l1-gate: ${USAGE}`);
  return 1;
}

function changesCommand(argv: readonly string[], deps: L1GateDeps, append: (path: string, text: string) => void): number {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: { base: { type: 'string' }, head: { type: 'string' }, output: { type: 'string' } },
  });
  if (!values.base || !values.head) throw new Error(`changes: --base <sha> and --head <sha> are required; ${USAGE}`);
  // -z and core.quotePath=false keep special paths unquoted; --no-renames lists a moved file
  // under both its old and new path, so moving a gated file out is still a gated change.
  const diff = spawnSync(
    'git',
    ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--no-renames', `${values.base}...${values.head}`],
    { cwd: deps.cwd, encoding: 'utf8' },
  );
  if (diff.error || diff.status !== 0) {
    const detail = (diff.stderr ?? '').trim().split('\n')[0] || diff.error?.message || 'no output';
    deps.error(`[suite] l1-gate: git diff ${values.base}...${values.head} failed (${detail})`);
    return 1;
  }
  const changed = diff.stdout.split('\0').filter((path) => path !== '');
  const gated = l1GateChangedPaths(changed);
  deps.log(`[suite] l1-gate: ${changed.length} changed path(s), ${gated.length} gated`);
  for (const path of gated.slice(0, 20)) deps.log(`[suite]   - ${path}`);
  if (gated.length > 20) deps.log(`[suite]   ... and ${gated.length - 20} more`);
  const line = `changed=${gated.length > 0 ? 'true' : 'false'}`;
  deps.log(`[suite] l1-gate: ${line}`);
  if (values.output !== undefined) append(values.output, `${line}\n`);
  return 0;
}

function decideCommand(argv: readonly string[], deps: L1GateDeps, append: (path: string, text: string) => void): number {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: { changed: { type: 'string' }, output: { type: 'string' } },
  });
  if (values.changed !== 'true' && values.changed !== 'false') {
    throw new Error(`decide: --changed must be true or false, got ${JSON.stringify(values.changed ?? null)}; ${USAGE}`);
  }
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  const has = (name: CredentialName) => deps.env[`HAS_${name}`] === 'true';
  const credentials = Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, has(name)])) as Record<CredentialName, boolean>;
  const result = decideL1Gate({
    changed: values.changed === 'true',
    // Fail safe: only an explicit `false` counts as a same-repository pull request.
    fork: deps.env.L1_GATE_FORK !== 'false',
    enabled: deps.env.L1_GATE_ENABLED,
    judgeProvider: config.judge.provider,
    credentials,
  });
  const message = oneLine(result.message);
  (result.decision === 'error' ? deps.error : deps.log)(`[suite] l1-gate: decision=${result.decision}: ${message}`);
  if (values.output !== undefined) append(values.output, `decision=${result.decision}\nmessage=${message}\n`);
  return result.decision === 'error' ? 1 : 0;
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
  process.exitCode = runL1Gate(process.argv.slice(2), {
    cwd: process.cwd(),
    packageDir: resolve(__dirname, '..', '..'),
    env: process.env,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
