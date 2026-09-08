import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReceipt,
  buildReflectionContext,
  findRetiredPaths,
  isAuditReference,
  isAllowedSpecPath,
  parsePreflightTargets,
  probeTcp,
  readChangedFiles,
  resolveDefaultBase,
  runNamedCheck,
  runCheckSequence,
  selectChecks,
  tryParsePreflightTargets,
  validateReadySpec,
  writeReceipt,
} from './agent-harness';

function testDiffSelection(): void {
  assert.deepEqual(selectChecks(['docs/runbook.md']), {
    scope: 'docs-only',
    checks: ['diff-check'],
  });
  assert.deepEqual(selectChecks(['apps/dashboard/app/page.tsx']), {
    scope: 'dashboard',
    checks: ['diff-check', 'dashboard-typecheck', 'dashboard-build'],
  });
  assert.deepEqual(selectChecks(['apps/worker/src/conversation/conversation.processor.ts']), {
    scope: 'active-typescript',
    checks: ['diff-check', 'typecheck', 'lint', 'test'],
  });
  assert.deepEqual(selectChecks(['docker-compose.yml']), {
    scope: 'full',
    checks: ['diff-check', 'typecheck', 'lint', 'test'],
  });
}

function testRetiredScopeGuard(): void {
  assert.deepEqual(
    findRetiredPaths([
      'apps/worker/src/conversation/conversation.processor.ts',
      'agent-service/src/agent_service/main.py',
      'scripts/maf-production-regression.sh',
      'packages/application/src/use-cases/maf-agent-runtime-client.ts',
      '.github/workflows/maf-production-regression.yml',
      'apps/worker/src/conversation/runtime-ledger.repository.ts',
      'apps/worker/src/feature-flags/runtime-control-flag.repository.ts',
      'packages/database/src/schema/runtime-attempts.ts',
      'scripts/verify-agent-service-readiness.sh',
    ]),
    [
      'agent-service/src/agent_service/main.py',
      'scripts/maf-production-regression.sh',
      'packages/application/src/use-cases/maf-agent-runtime-client.ts',
      '.github/workflows/maf-production-regression.yml',
      'apps/worker/src/conversation/runtime-ledger.repository.ts',
      'apps/worker/src/feature-flags/runtime-control-flag.repository.ts',
      'packages/database/src/schema/runtime-attempts.ts',
      'scripts/verify-agent-service-readiness.sh',
    ],
  );
  assert.deepEqual(findRetiredPaths(['docs/maf-retirement.md', 'AGENTS.md']), []);
  assert.equal(isAuditReference('approval:HARNESS-123'), true);
  assert.equal(isAuditReference('anything'), false);
}

function testReceiptIsStructuredAndRedacted(): void {
  const secret = 'sk-secret-from-environment';
  process.env.HARNESS_TEST_SECRET = secret;
  const receipt = buildReceipt({
    status: 'failed',
    base: 'HEAD',
    head: '60c3a7c',
    selection: selectChecks(['apps/api/src/main.ts']),
    changedPaths: ['apps/api/src/main.ts'],
    checks: [{ name: 'typecheck', status: 'failed', durationMs: 12 }],
    skipped: ['model-evals'],
    residualRisk: 'model-evals-not-run',
    retiredOverride: 'approval:HARNESS-123',
    environment: { OPENAI_API_KEY: secret },
    rawOutput: `Authorization: Bearer ${secret}`,
    hiddenReasoning: secret,
  } as Parameters<typeof buildReceipt>[0] & Record<string, unknown>);
  const serialized = JSON.stringify(receipt);

  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.changedPaths, ['apps/api/src/main.ts']);
  assert.equal(receipt.changedFileCount, 1);
  assert.equal(receipt.retiredOverride, 'approval:HARNESS-123');
  assert.doesNotMatch(serialized, /environment|rawOutput|hiddenReasoning/);
  assert.doesNotMatch(serialized, new RegExp(secret));

  const receiptDir = mkdtempSync(join(tmpdir(), 'agent-harness-receipts-'));
  for (const status of ['passed', 'failed', 'blocked'] as const) {
    const file = writeReceipt(receiptDir, { ...receipt, status });
    const stored = JSON.parse(readFileSync(file, 'utf8')) as {
      schemaVersion: number;
      status: string;
    };
    assert.deepEqual(stored, { ...receipt, status });
  }
}

async function testTcpPreflightUsesSafeTargets(): Promise<void> {
  const targets = parsePreflightTargets({
    DATABASE_URL: 'postgresql://db-user:db-password@db.internal:5544/app',
    REDIS_URL: 'redis://:redis-password@cache.internal:6399/0',
  });
  assert.deepEqual(targets, [
    { name: 'postgres', host: 'db.internal', port: 5544 },
    { name: 'redis', host: 'cache.internal', port: 6399 },
  ]);
  assert.doesNotMatch(JSON.stringify(targets), /password|db-user|\/app/);

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const target = { name: 'postgres' as const, host: '127.0.0.1', port: address.port };
  assert.deepEqual(await probeTcp(target, 250), {
    name: 'postgres',
    target: `127.0.0.1:${address.port}`,
    status: 'reachable',
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert.deepEqual(await probeTcp(target, 250), {
    name: 'postgres',
    target: `127.0.0.1:${address.port}`,
    status: 'blocked',
  });

  const invalid = tryParsePreflightTargets({ DATABASE_URL: 'not-a-url' });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.reason, /postgres URL is invalid/i);
}

function testReadySpecValidation(): void {
  const valid = validateReadySpec(`---
status: 'ready-for-dev'
---
<frozen-after-approval>
## Intent
Ship one bounded change.
</frozen-after-approval>
## Tasks & Acceptance
- [ ] Implement the change.
**Acceptance Criteria:**
- Given an input, when it runs, then it returns a result.
`);
  assert.deepEqual(valid, { eligible: true, reasons: [] });

  const emptyFrozen = validateReadySpec(`---
status: 'ready-for-dev'
---
<frozen-after-approval>
</frozen-after-approval>
## Tasks & Acceptance
- [ ] Implement the change.
- Given an input, when it runs, then it returns a result.
`);
  assert.equal(emptyFrozen.eligible, false);
  assert.match(emptyFrozen.reasons.join('\n'), /frozen intent/i);

  const invalid = validateReadySpec(`---
status: 'in-progress'
---
## Tasks & Acceptance
- [ ] Implement later.
`);
  assert.equal(invalid.eligible, false);
  assert.match(invalid.reasons.join('\n'), /frontmatter|frozen|acceptance/i);
}

function testReflectionRetrievesRelevantOpenFailure(): void {
  const log = `# Agent Failure Log
## Open Failures
## 2026-08-20: Connector database preflight
- Symptom: Redis unavailable.
- Status: open
## 2026-08-21: Conversation sim classifier timeout
- Symptom: An assertion was retried.
- Status: open
## Fixed Failures
## 2026-08-19: Old issue
- Status: fixed
`;
  const context = buildReflectionContext(log, [
    'packages/conversation-sim/src/gate/failure-classifier.ts',
  ]);
  assert.equal(context.eligible, true);
  assert.match(context.markdown, /Conversation sim classifier timeout/);
  assert.doesNotMatch(context.markdown, /Connector database preflight/);
  assert.doesNotMatch(context.markdown, /Old issue/);
  assert.deepEqual(
    buildReflectionContext('# Agent Failure Log\n## Open Failures\n\n## Fixed Failures').eligible,
    false,
  );
}

function testChangedFilesIncludeWorkingTreeAndMissingBaseFallsBack(): void {
  const repo = mkdtempSync(join(tmpdir(), 'agent-harness-git-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'harness@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'before\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'after\n');
  mkdirSync(join(repo, 'apps/worker/src'), { recursive: true });
  writeFileSync(join(repo, 'apps/worker/src/new.ts'), 'export {};\n');

  assert.deepEqual(readChangedFiles(repo, 'HEAD').paths, ['README.md', 'apps/worker/src/new.ts']);
  const missing = readChangedFiles(repo, 'does-not-exist');
  assert.equal(missing.baseMissing, true);
  assert.equal(missing.base, null);
}

function testDefaultBaseCoversAllUnpushedCommits(): void {
  const repo = mkdtempSync(join(tmpdir(), 'agent-harness-base-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'harness@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'baseline\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', baseline], { cwd: repo });
  writeFileSync(join(repo, 'first.ts'), 'export const first = true;\n');
  execFileSync('git', ['add', 'first.ts'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'first'], { cwd: repo });
  writeFileSync(join(repo, 'second.ts'), 'export const second = true;\n');
  execFileSync('git', ['add', 'second.ts'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'second'], { cwd: repo });

  assert.equal(resolveDefaultBase(repo), baseline);
  assert.deepEqual(readChangedFiles(repo, resolveDefaultBase(repo)).paths, [
    'first.ts',
    'second.ts',
  ]);
}

function testRetiredRenameKeepsDeletedSourcePath(): void {
  const repo = mkdtempSync(join(tmpdir(), 'agent-harness-rename-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'harness@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: repo });
  mkdirSync(join(repo, 'agent-service'), { recursive: true });
  writeFileSync(join(repo, 'agent-service/archive.py'), 'retired = True\n');
  execFileSync('git', ['add', 'agent-service/archive.py'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  mkdirSync(join(repo, 'apps/api/src'), { recursive: true });
  execFileSync('git', ['mv', 'agent-service/archive.py', 'apps/api/src/archive.py'], { cwd: repo });

  assert.deepEqual(
    readChangedFiles(repo, baseline).paths,
    ['agent-service/archive.py', 'apps/api/src/archive.py'].sort(),
  );
}

function testDiffCheckUsesCommittedBase(): void {
  const repo = mkdtempSync(join(tmpdir(), 'agent-harness-diff-check-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'harness@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'clean\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  writeFileSync(join(repo, 'README.md'), 'trailing whitespace \n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'bad whitespace'], { cwd: repo });

  assert.notEqual(runNamedCheck(repo, 'diff-check', baseline), 0);
}

function testCheckRunsOnlyChangedActiveTests(): void {
  const repo = mkdtempSync(join(tmpdir(), 'agent-harness-active-tests-'));
  const packageRoot = join(repo, 'packages/application');
  mkdirSync(join(packageRoot, 'src'), { recursive: true });
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({
      name: 'fixture-root',
      private: true,
      scripts: {
        typecheck: 'node -e "process.exit(0)"',
        lint: 'node -e "process.exit(0)"',
        test: 'node broad-runner.cjs',
      },
    }),
  );
  writeFileSync(join(repo, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  writeFileSync(
    join(repo, 'broad-runner.cjs'),
    "require('node:fs').writeFileSync('broad-test-ran', 'yes'); process.exit(1);\n",
  );
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@fixture/application',
      private: true,
      scripts: { test: 'node active-runner.cjs' },
    }),
  );
  writeFileSync(
    join(packageRoot, 'active-runner.cjs'),
    "require('node:fs').writeFileSync('../../active-tests.json', JSON.stringify(process.argv.slice(2)));\n",
  );
  writeFileSync(join(packageRoot, 'src/example.ts'), 'export const value = 1;\n');
  writeFileSync(join(packageRoot, 'src/example.test.ts'), 'export {};\n');
  writeFileSync(join(packageRoot, 'src/maf-archive.test.ts'), 'export {};\n');

  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'harness@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: repo });
  writeFileSync(join(packageRoot, 'src/example.ts'), 'export const value = 2;\n');

  const run = spawnSync(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    [join(process.cwd(), 'scripts/agent-harness.ts'), 'check', '--base', 'HEAD'],
    { cwd: repo, encoding: 'utf8' },
  );

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(existsSync(join(repo, 'broad-test-ran')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'active-tests.json'), 'utf8')), [
    'src/example.test.ts',
  ]);
}

function testCheckSequenceStopsAfterFirstFailure(): void {
  const called: string[] = [];
  assert.deepEqual(
    runCheckSequence(['diff-check', 'typecheck', 'lint'], (name) => {
      called.push(name);
      return name === 'typecheck' ? 1 : 0;
    }).map(({ name, status }) => ({ name, status })),
    [
      { name: 'diff-check', status: 'passed' },
      { name: 'typecheck', status: 'failed' },
      { name: 'lint', status: 'skipped' },
    ],
  );
  assert.deepEqual(called, ['diff-check', 'typecheck']);
}

function testSpecPathCannotEscapeApprovedArtifacts(): void {
  const repo = mkdtempSync(join(tmpdir(), 'agent-harness-spec-'));
  const allowed = join(repo, '_bmad-output/implementation-artifacts');
  mkdirSync(allowed, { recursive: true });
  writeFileSync(join(allowed, 'spec-ready.md'), '# Ready\n');
  const external = join(repo, 'outside.md');
  writeFileSync(external, '# Outside\n');
  symlinkSync(external, join(allowed, 'linked.md'));

  assert.equal(
    isAllowedSpecPath(repo, '_bmad-output/implementation-artifacts/spec-ready.md'),
    true,
  );
  assert.equal(isAllowedSpecPath(repo, '_bmad-output/implementation-artifacts/linked.md'), false);
  assert.equal(isAllowedSpecPath(repo, '../secrets.txt'), false);
  assert.equal(isAllowedSpecPath(repo, '/tmp/spec-ready.md'), false);
  assert.equal(isAllowedSpecPath(repo, '_bmad-output/planning-artifacts/spec-ready.md'), false);
}

async function main(): Promise<void> {
  testDiffSelection();
  testRetiredScopeGuard();
  testReceiptIsStructuredAndRedacted();
  await testTcpPreflightUsesSafeTargets();
  testReadySpecValidation();
  testReflectionRetrievesRelevantOpenFailure();
  testChangedFilesIncludeWorkingTreeAndMissingBaseFallsBack();
  testDefaultBaseCoversAllUnpushedCommits();
  testRetiredRenameKeepsDeletedSourcePath();
  testDiffCheckUsesCommittedBase();
  testCheckRunsOnlyChangedActiveTests();
  testCheckSequenceStopsAfterFirstFailure();
  testSpecPathCannotEscapeApprovedArtifacts();

  console.log('agent harness tests passed');
}

void main();
