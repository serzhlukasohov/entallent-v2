import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

export type HarnessScope = 'docs-only' | 'dashboard' | 'active-typescript' | 'full';

export type HarnessCheckName =
  | 'diff-check'
  | 'dashboard-typecheck'
  | 'dashboard-build'
  | 'connector-preflight'
  | 'typecheck'
  | 'lint'
  | 'test';

export interface HarnessSelection {
  scope: HarnessScope;
  checks: HarnessCheckName[];
}

export interface HarnessReceipt {
  schemaVersion: 1;
  runAt: string;
  status: 'passed' | 'failed' | 'blocked';
  base: string | null;
  head: string | null;
  scope: HarnessScope;
  changedFileCount: number;
  changedPaths: string[];
  checks: Array<{
    name: HarnessCheckName;
    status: 'passed' | 'failed' | 'skipped';
    durationMs: number;
  }>;
  skipped: string[];
  residualRisk: string | null;
  retiredOverride: string | null;
}

export interface BuildReceiptInput {
  status: HarnessReceipt['status'];
  base: string | null;
  head: string | null;
  selection: HarnessSelection;
  changedPaths: string[];
  checks: HarnessReceipt['checks'];
  skipped?: string[];
  residualRisk?: string | null;
  retiredOverride?: string | null;
}

export interface PreflightTarget {
  name: 'postgres' | 'redis';
  host: string;
  port: number;
}

export interface PreflightResult {
  name: PreflightTarget['name'];
  target: string;
  status: 'reachable' | 'blocked';
}

export interface ValidationResult {
  eligible: boolean;
  reasons: string[];
}

export interface ReflectionContext {
  eligible: boolean;
  markdown: string;
}

export interface ChangedFiles {
  base: string | null;
  head: string | null;
  baseMissing: boolean;
  paths: string[];
}

export type HarnessCheckResult = HarnessReceipt['checks'][number];

const FULL_CHECKS: HarnessCheckName[] = ['diff-check', 'typecheck', 'lint', 'test'];

const RETIRED_PATHS = [
  /^\.github\/workflows\/maf-/,
  /^agent-service\//,
  /^apps\/api\/src\/internal-maf-context\//,
  /^apps\/worker\/src\/conversation\/maf-/,
  /^apps\/worker\/src\/conversation\/runtime-ledger\./,
  /^apps\/worker\/src\/feature-flags\/runtime-control-flag\./,
  /^packages\/application\/src\/ports\/agent-runtime\.port\.ts$/,
  /^packages\/application\/src\/use-cases\/(?:maf-|agent-runtime-(?:router|mode-resolver))/,
  /^packages\/contracts\/runtime\//,
  /^packages\/database\/migrations\/[^/]*maf/i,
  /^packages\/database\/src\/(?:__tests__\/runtime-ledger\.integration\.test|schema\/runtime-attempts)\.ts$/,
  /^scripts\/(?:live-maf|maf-)/,
  /^scripts\/verify-agent-service-readiness\.sh$/,
];

const CHECK_COMMANDS: Record<
  Exclude<HarnessCheckName, 'connector-preflight' | 'test'>,
  [string, string[]]
> = {
  'diff-check': ['git', ['diff', '--check']],
  'dashboard-typecheck': ['pnpm', ['--filter', '@entalent/dashboard', 'typecheck']],
  'dashboard-build': ['pnpm', ['--filter', '@entalent/dashboard', 'build']],
  typecheck: ['pnpm', ['typecheck']],
  lint: ['pnpm', ['lint']],
};

export function selectChecks(paths: string[]): HarnessSelection {
  if (paths.length > 0 && paths.every(isDocsPath)) {
    return { scope: 'docs-only', checks: ['diff-check'] };
  }

  const codePaths = paths.filter((path) => !isDocsPath(path));
  if (codePaths.length > 0 && codePaths.every((path) => path.startsWith('apps/dashboard/'))) {
    return {
      scope: 'dashboard',
      checks: ['diff-check', 'dashboard-typecheck', 'dashboard-build'],
    };
  }

  if (
    codePaths.length > 0 &&
    codePaths.every((path) => /^(?:apps\/(?:api|worker)|packages)\//.test(path))
  ) {
    return { scope: 'active-typescript', checks: [...FULL_CHECKS] };
  }

  return { scope: 'full', checks: [...FULL_CHECKS] };
}

export function findRetiredPaths(paths: string[]): string[] {
  return paths.filter((path) => RETIRED_PATHS.some((pattern) => pattern.test(path)));
}

export function isAuditReference(value: string): boolean {
  return /^(?:approval|audit|issue|spec|ticket):[A-Za-z0-9][A-Za-z0-9._/#-]{2,127}$/.test(value);
}

export function buildReceipt(input: BuildReceiptInput): HarnessReceipt {
  return {
    schemaVersion: 1,
    runAt: new Date().toISOString(),
    status: input.status,
    base: input.base,
    head: input.head,
    scope: input.selection.scope,
    changedFileCount: input.changedPaths.length,
    changedPaths: [...input.changedPaths],
    checks: input.checks.map((check) => ({ ...check })),
    skipped: [...(input.skipped ?? [])],
    residualRisk: input.residualRisk ?? null,
    retiredOverride: input.retiredOverride ?? null,
  };
}

export function writeReceipt(directory: string, receipt: HarnessReceipt): string {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `receipt-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return file;
}

export function parsePreflightTargets(env: NodeJS.ProcessEnv): PreflightTarget[] {
  return [
    parseTarget('postgres', env.DATABASE_URL ?? 'postgresql://localhost:5434/entalent', 5432),
    parseTarget('redis', env.REDIS_URL ?? 'redis://localhost:6380', 6379),
  ];
}

export function tryParsePreflightTargets(
  env: NodeJS.ProcessEnv,
): { ok: true; targets: PreflightTarget[] } | { ok: false; reason: string } {
  try {
    return { ok: true, targets: parsePreflightTargets(env) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Preflight URL is invalid.',
    };
  }
}

export function probeTcp(target: PreflightTarget, timeoutMs = 1_500): Promise<PreflightResult> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: target.host, port: target.port });
    const finish = (status: PreflightResult['status']) => {
      socket.destroy();
      resolve({ name: target.name, target: `${target.host}:${target.port}`, status });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('reachable'));
    socket.once('error', () => finish('blocked'));
    socket.once('timeout', () => finish('blocked'));
  });
}

export function validateReadySpec(source: string): ValidationResult {
  const reasons: string[] = [];
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) reasons.push('Spec frontmatter is missing.');
  if (!frontmatter?.[1].match(/^status:\s*['"]?ready-for-dev['"]?\s*$/m)) {
    reasons.push('Spec status must be ready-for-dev.');
  }
  if (!/<frozen-after-approval[^>]*>[\s\S]*\S[\s\S]*<\/frozen-after-approval>/.test(source)) {
    reasons.push('Approved frozen intent is missing.');
  }
  if (!/## Tasks & Acceptance[\s\S]*- \[ \]/.test(source)) {
    reasons.push('Executable task checklist is missing.');
  }
  if (!/\bGiven\b[^\n]*\bwhen\b[^\n]*\bthen\b/i.test(source)) {
    reasons.push('Given/When/Then acceptance criterion is missing.');
  }
  if (/\b(?:TBD|TODO|PLACEHOLDER)\b/.test(source)) {
    reasons.push('Spec contains an unresolved placeholder.');
  }
  return { eligible: reasons.length === 0, reasons };
}

export function buildReflectionContext(
  failureLog: string,
  changedPaths: string[] = [],
): ReflectionContext {
  const openSection = failureLog
    .split('## Open Failures')[1]
    ?.split(/\n## (?:Obsolete \/ Retired Failures|Fixed Failures)\b/)[0]
    ?.trim();
  const entries = openSection
    ? openSection
        .split(/\n(?=## \d{4}-\d{2}-\d{2}:)/)
        .filter((entry) => /- Status: open\b/.test(entry))
    : [];
  if (entries.length === 0) {
    return {
      eligible: false,
      markdown: '# Harness reflection context\n\nNo open harness failures.\n',
    };
  }

  const tokens = new Set(
    changedPaths
      .flatMap((path) => path.toLowerCase().split(/[^a-z0-9]+/))
      .filter(
        (token) => token.length > 3 && !['packages', 'apps', 'scripts', 'source'].includes(token),
      ),
  );
  const relevant = tokens.size
    ? entries.filter((entry) => [...tokens].some((token) => entry.toLowerCase().includes(token)))
    : entries;
  const selected = relevant.length > 0 ? relevant : entries;
  return {
    eligible: true,
    markdown: `# Harness reflection context\n\n${selected.join('\n\n')}\n`,
  };
}

export function resolveDefaultBase(repoRoot: string): string | null {
  const upstream = spawnSync(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const candidates = [upstream.status === 0 ? upstream.stdout.trim() : '', 'origin/main'].filter(
    Boolean,
  );
  for (const candidate of [...new Set(candidates)]) {
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', candidate], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (mergeBase.status === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
  }
  return null;
}

export function readChangedFiles(repoRoot: string, requestedBase: string | null): ChangedFiles {
  const headResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const safeBase = Boolean(requestedBase && /^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/.test(requestedBase));
  const baseResult = safeBase
    ? spawnSync(
        'git',
        ['rev-parse', '--verify', '--quiet', '--end-of-options', `${requestedBase!}^{commit}`],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      )
    : null;
  const baseMissing = baseResult?.status !== 0;
  const tracked = spawnSync(
    'git',
    [
      'diff',
      '--name-only',
      '--no-renames',
      '--diff-filter=ACMRD',
      baseMissing ? 'HEAD' : requestedBase!,
      '--',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const paths = `${tracked.stdout ?? ''}\n${untracked.stdout ?? ''}`
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
  return {
    base: baseMissing ? null : requestedBase,
    head: headResult.status === 0 ? headResult.stdout.trim() : null,
    baseMissing,
    paths: [...new Set(paths)].sort(),
  };
}

export function runCheckSequence(
  checks: HarnessCheckName[],
  execute: (name: HarnessCheckName) => number,
): HarnessCheckResult[] {
  const results: HarnessCheckResult[] = [];
  let failed = false;
  for (const name of checks) {
    if (failed) {
      results.push({ name, status: 'skipped', durationMs: 0 });
      continue;
    }
    const startedAt = Date.now();
    const exitCode = execute(name);
    const status = exitCode === 0 ? 'passed' : 'failed';
    results.push({ name, status, durationMs: Date.now() - startedAt });
    failed = status === 'failed';
  }
  return results;
}

export function isAllowedSpecPath(repoRoot: string, candidate: string): boolean {
  if (isAbsolute(candidate) || !candidate.endsWith('.md')) return false;
  try {
    const allowedRoot = realpathSync(resolve(repoRoot, '_bmad-output/implementation-artifacts'));
    const actualPath = realpathSync(resolve(repoRoot, candidate));
    return actualPath.startsWith(`${allowedRoot}${sep}`);
  } catch {
    return false;
  }
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const repoRoot = process.cwd();
  const receiptDir = join(repoRoot, 'runs/harness');
  const command = argv[0] ?? 'check';

  if (command === 'check') {
    const requestedBase =
      readOption(argv, '--base') ?? process.env.HARNESS_BASE_SHA ?? resolveDefaultBase(repoRoot);
    const changed = readChangedFiles(repoRoot, requestedBase);
    const selection = changed.baseMissing
      ? { scope: 'full' as const, checks: [...FULL_CHECKS] }
      : selectChecks(changed.paths);
    const retiredPaths = findRetiredPaths(changed.paths);
    const auditOverride = readOption(argv, '--allow-retired');

    if (auditOverride && !isAuditReference(auditOverride)) {
      const receipt = buildReceipt({
        status: 'blocked',
        base: changed.base,
        head: changed.head,
        selection,
        changedPaths: changed.paths,
        checks: [],
        skipped: ['deterministic-checks', 'model-evals'],
        residualRisk: 'invalid-retired-override',
      });
      const file = writeReceipt(receiptDir, receipt);
      console.error(
        '[harness] blocked invalid retired override; use approval:<reference> or audit:<reference>.',
      );
      console.error(`[harness] receipt=${relativeToRoot(repoRoot, file)}`);
      process.exitCode = 2;
      return;
    }

    if (retiredPaths.length > 0 && !auditOverride) {
      const receipt = buildReceipt({
        status: 'blocked',
        base: changed.base,
        head: changed.head,
        selection,
        changedPaths: changed.paths,
        checks: [],
        skipped: ['deterministic-checks', 'model-evals'],
        residualRisk: 'retired-surface-changed',
      });
      const file = writeReceipt(receiptDir, receipt);
      console.error(`[harness] blocked retired surface: ${retiredPaths.join(', ')}`);
      console.error(`[harness] receipt=${relativeToRoot(repoRoot, file)}`);
      process.exitCode = 2;
      return;
    }

    if (retiredPaths.length > 0) {
      console.warn(
        '[harness] retired-surface override supplied; ensure its audit reference is reviewed.',
      );
    }
    if (changed.baseMissing) {
      console.warn(`[harness] base unavailable; running full deterministic gate.`);
    }
    console.log(`[harness] scope=${selection.scope} files=${changed.paths.length}`);
    const results = runCheckSequence(selection.checks, (name) =>
      runNamedCheck(repoRoot, name, changed.base, changed.paths),
    );
    const failed = results.some((result) => result.status === 'failed');
    const receipt = buildReceipt({
      status: failed ? 'failed' : 'passed',
      base: changed.base,
      head: changed.head,
      selection,
      changedPaths: changed.paths,
      checks: results,
      skipped: selection.scope === 'docs-only' ? [] : ['model-evals'],
      residualRisk: selection.scope === 'docs-only' ? null : 'model-evals-not-run',
      retiredOverride: auditOverride,
    });
    const file = writeReceipt(receiptDir, receipt);
    console.log(`[harness] status=${receipt.status} receipt=${relativeToRoot(repoRoot, file)}`);
    if (failed) process.exitCode = 1;
    return;
  }

  if (command === 'preflight') {
    const parsedTargets = tryParsePreflightTargets(process.env);
    if (!parsedTargets.ok) {
      const receipt = buildReceipt({
        status: 'blocked',
        base: null,
        head: readChangedFiles(repoRoot, 'HEAD').head,
        selection: { scope: 'full', checks: [] },
        changedPaths: [],
        checks: [{ name: 'connector-preflight', status: 'failed', durationMs: 0 }],
        skipped: ['connector-payload'],
        residualRisk: 'connector-config-invalid',
      });
      const file = writeReceipt(receiptDir, receipt);
      console.error(`[harness] connector preflight blocked: ${parsedTargets.reason}`);
      console.error(`[harness] receipt=${relativeToRoot(repoRoot, file)}`);
      process.exitCode = 2;
      return;
    }
    const results = await Promise.all(parsedTargets.targets.map((target) => probeTcp(target)));
    for (const result of results) {
      console.log(`[harness] ${result.name} ${result.target} ${result.status}`);
    }
    const blocked = results.some((result) => result.status === 'blocked');
    const selection: HarnessSelection = { scope: 'full', checks: [] };
    const receipt = buildReceipt({
      status: blocked ? 'blocked' : 'passed',
      base: null,
      head: readChangedFiles(repoRoot, 'HEAD').head,
      selection,
      changedPaths: [],
      checks: [
        {
          name: 'connector-preflight',
          status: blocked ? 'failed' : 'passed',
          durationMs: 0,
        },
      ],
      skipped: blocked ? ['connector-payload'] : [],
      residualRisk: blocked ? 'connector-dependency-unreachable' : null,
    });
    const file = writeReceipt(receiptDir, receipt);
    console.log(`[harness] receipt=${relativeToRoot(repoRoot, file)}`);
    if (blocked) {
      console.error(
        '[harness] connector preflight blocked; start the named dependency and retry before sending a payload.',
      );
      process.exitCode = 2;
    }
    return;
  }

  if (command === 'validate-spec') {
    const candidate = readOption(argv, '--spec');
    if (!candidate || !isAllowedSpecPath(repoRoot, candidate)) {
      console.log('[harness] no eligible ready spec.');
      process.exitCode = 2;
      return;
    }
    const validation = validateReadySpec(readFileSync(resolve(repoRoot, candidate), 'utf8'));
    if (!validation.eligible) {
      console.log(`[harness] no eligible ready spec: ${validation.reasons.join(' ')}`);
      process.exitCode = 2;
      return;
    }
    console.log(`[harness] ready spec=${candidate}`);
    return;
  }

  if (command === 'reflection') {
    const changedPaths = readOptions(argv, '--changed-path');
    const context = buildReflectionContext(
      readFileSync(join(repoRoot, 'docs/agent-failures.md'), 'utf8'),
      changedPaths,
    );
    const output = join(receiptDir, 'reflection.md');
    mkdirSync(receiptDir, { recursive: true });
    writeFileSync(output, context.markdown, 'utf8');
    console.log(
      `[harness] reflection=${relativeToRoot(repoRoot, output)} eligible=${context.eligible}`,
    );
    if (!context.eligible) process.exitCode = 2;
    return;
  }

  throw new Error(`Unknown harness command: ${command}`);
}

export function runNamedCheck(
  repoRoot: string,
  name: HarnessCheckName,
  base: string | null = null,
  changedPaths: string[] = [],
): number {
  if (name === 'connector-preflight') return 1;
  if (name === 'diff-check') {
    const args = ['diff', '--check', ...(base ? [base] : []), '--'];
    return (
      spawnSync('git', args, { cwd: repoRoot, stdio: 'inherit', env: process.env }).status ?? 1
    );
  }
  if (name === 'test') {
    console.log('[harness] check=test');
    let commands: Array<[string, string[]]>;
    try {
      commands = buildActiveTestCommands(repoRoot, changedPaths);
    } catch (error) {
      console.error(
        `[harness] ${error instanceof Error ? error.message : 'test selection failed'}`,
      );
      return 1;
    }
    if (commands.length === 0) {
      console.log('[harness] no active tests matched changed paths');
      return 0;
    }
    for (const [executable, args] of commands) {
      const status =
        spawnSync(executable, args, {
          cwd: repoRoot,
          stdio: 'inherit',
          env: process.env,
        }).status ?? 1;
      if (status !== 0) return status;
    }
    return 0;
  }
  const [executable, args] = CHECK_COMMANDS[name];
  console.log(`[harness] check=${name}`);
  return (
    spawnSync(executable, args, { cwd: repoRoot, stdio: 'inherit', env: process.env }).status ?? 1
  );
}

function buildActiveTestCommands(
  repoRoot: string,
  changedPaths: string[],
): Array<[string, string[]]> {
  const testPaths = new Set<string>();
  for (const path of changedPaths) {
    const candidates = path.match(/\.(?:test|spec)\.tsx?$/)
      ? [path]
      : path.match(/\.tsx?$/)
        ? [path.replace(/\.tsx?$/, '.test.ts'), path.replace(/\.tsx?$/, '.spec.ts')]
        : [];
    for (const candidate of candidates) {
      if (existsSync(join(repoRoot, candidate))) testPaths.add(candidate);
    }
  }

  const retiredTargets = findRetiredPaths([...testPaths]);
  if (retiredTargets.length > 0) {
    throw new Error(`retired test target blocked: ${retiredTargets.join(', ')}`);
  }

  const commands: Array<[string, string[]]> = [...testPaths]
    .filter((path) => path.startsWith('scripts/'))
    .sort()
    .map((path) => ['pnpm', ['exec', 'tsx', path]]);
  const packageTests = new Map<string, string[]>();
  for (const path of [...testPaths].sort()) {
    const packageRoot = path.match(/^(?:apps|packages)\/[^/]+/)?.[0];
    if (!packageRoot) continue;
    const targets = packageTests.get(packageRoot) ?? [];
    targets.push(path.slice(packageRoot.length + 1));
    packageTests.set(packageRoot, targets);
  }

  for (const [packageRoot, targets] of [...packageTests].sort(([a], [b]) => a.localeCompare(b))) {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, packageRoot, 'package.json'), 'utf8'),
    ) as {
      name?: unknown;
    };
    if (typeof manifest.name !== 'string' || !manifest.name) {
      throw new Error(`package name missing: ${packageRoot}/package.json`);
    }
    commands.push(['pnpm', ['--filter', manifest.name, 'test', ...targets]]);
  }
  return commands;
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function readOptions(argv: string[], name: string): string[] {
  return argv.flatMap((value, index) =>
    value === name && argv[index + 1] ? [argv[index + 1]!] : [],
  );
}

function relativeToRoot(repoRoot: string, path: string): string {
  return path.startsWith(`${repoRoot}${sep}`) ? path.slice(repoRoot.length + 1) : path;
}

function parseTarget(
  name: PreflightTarget['name'],
  rawUrl: string,
  defaultPort: number,
): PreflightTarget {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${name} URL is invalid.`);
  }
  if (!parsed.hostname) throw new Error(`${name} URL is missing a host.`);
  return {
    name,
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : defaultPort,
  };
}

if (basename(process.argv[1] ?? '') === 'agent-harness.ts') {
  void main().catch((error: unknown) => {
    console.error(`[harness] ${error instanceof Error ? error.message : 'unexpected failure'}`);
    process.exitCode = 1;
  });
}

function isDocsPath(path: string): boolean {
  return path === 'AGENTS.md' || path.endsWith('.md') || path.startsWith('docs/');
}
