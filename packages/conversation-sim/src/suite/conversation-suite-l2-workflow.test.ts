import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural checks of the opt-in weekly L2 workflow `.github/workflows/conversation-suite-l2.yml`
 * (Story 14.3). The package has no YAML dependency, so blocks are cut by indentation like
 * `conversation-sim-workflow.test.ts`; the story's verification command also parses the file as YAML.
 */
const WORKFLOW = resolve(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'conversation-suite-l2.yml');
/** Pinned literally, so a later addition to `CREDENTIAL_NAMES` cannot widen the no-new-secret check. */
const ALLOWED_SECRETS: readonly string[] = [
  'OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_TESTING_DEPLOYMENT',
];
const STACK_LOGS = 'packages/conversation-sim/runs/l2-stack';

/**
 * sha256 of the opt-in and trigger surface: the `on:` block, the `permissions:` block and the
 * `suite-l2` job's `if:` line, joined with '\n' (trailing blank lines dropped). A deliberate edit
 * to the triggers, permissions or the variable gate must update this pin: recompute it as the
 * sha256 hex of `optInSurface()` below, for example by temporarily logging it from this test.
 */
const OPT_IN_SURFACE_SHA256 = '167032141a24890c5d36f39dc15379a4545c36cc0bbf731f709c5bedb930f28f';

const text = readFileSync(WORKFLOW, 'utf8');
const lines = text.split('\n');

const indentOf = (line: string) => line.length - line.trimStart().length;
const meaningful = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');

/**
 * The lines of the mapping entry `key:` at `indent` inside `within` (key line included, trailing
 * blank lines dropped). Any non-blank line at or above `indent`, a comment included, ends it.
 */
function block(within: readonly string[], key: string, indent: number): string[] {
  const start = within.findIndex((line) => indentOf(line) === indent && line.trimStart().startsWith(`${key}:`) && meaningful(line));
  if (start < 0) throw new Error(`no ${key}: at indent ${indent}`);
  const result = [within[start]!];
  for (const line of within.slice(start + 1)) {
    if (line.trim() !== '' && indentOf(line) <= indent) break;
    result.push(line);
  }
  while (result.length > 1 && result.at(-1)!.trim() === '') result.pop();
  return result;
}

/** Sequence items (`- ...`) at `indent` inside `within`, comments dropped. */
function items(within: readonly string[], indent: number): string[][] {
  const result: string[][] = [];
  for (const line of within) {
    if (meaningful(line) && indentOf(line) === indent && line.trimStart().startsWith('- ')) result.push([line]);
    else if (result.length > 0 && meaningful(line) && indentOf(line) > indent) result.at(-1)!.push(line);
  }
  return result;
}

const keysAt = (within: readonly string[], indent: number) =>
  within.filter((line) => indentOf(line) === indent && meaningful(line) && /^[A-Za-z0-9_-]+:/.test(line.trim())).map((line) => line.trim().replace(/:.*$/, ''));

const jobs = block(lines, 'jobs', 0);
const job = block(jobs, 'suite-l2', 2);
const steps = items(block(job, 'steps', 4), 6).map((step) => step.join('\n'));
const stepNamed = (name: string) => {
  const step = steps.find((entry) => entry.split('\n').some((line) => line.trim() === `name: ${name}` || line.trim() === `- name: ${name}`));
  if (!step) throw new Error(`no step ${name}`);
  return step;
};
const credentialsStep = stepNamed('Check L2 credentials');
const migrateStep = stepNamed('Migrate and seed the stack database');
const adminKeyStep = stepNamed('Generate the stack admin key');
const apiStep = stepNamed('Start the api');
const workerStep = stepNamed('Start the worker');
const waitStep = stepNamed('Wait for the stack');
const runStep = stepNamed('Suite L2 weekly run and merge-base diff');
const uploadStep = stepNamed('Upload suite runs and stack logs');
const linkStep = stepNamed('Link suite runs');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const optInSurface = () =>
  [...block(lines, 'on', 0), ...block(lines, 'permissions', 0), job.find((line) => line.startsWith('    if: '))!].join('\n');
const rawSecretRefs = (value: string) => value.split(/\$\{\{ secrets\.[A-Z_]+ \}\}/).length - 1;

describe('conversation-suite-l2.yml', () => {
  it('is named Conversation suite L2 and triggers only on the weekly schedule and a bare workflow_dispatch', () => {
    expect(lines[0]).toBe('name: Conversation suite L2');
    const on = block(lines, 'on', 0);
    expect(keysAt(on, 2)).toEqual(['schedule', 'workflow_dispatch']);
    expect(on.filter(meaningful).map((line) => line.trim())).toEqual(['on:', 'schedule:', "- cron: '41 4 * * 1'", 'workflow_dispatch:']);
    const code = lines.filter(meaningful).join('\n');
    expect(code).not.toMatch(/pull_request|pull_request_target|^\s*push:/m);
  });

  it('pins the opt-in surface (triggers, permissions, variable gate) by sha256', () => {
    expect(sha256(optInSurface())).toBe(OPT_IN_SURFACE_SHA256);
  });

  it('reads contents only and never cancels a running weekly run', () => {
    expect(block(lines, 'permissions', 0).map((line) => line.trim())).toEqual(['permissions:', 'contents: read']);
    expect(block(lines, 'concurrency', 0).map((line) => line.trim())).toEqual([
      'concurrency:',
      'group: conversation-suite-l2',
      'cancel-in-progress: false',
    ]);
    expect(keysAt(lines, 0)).toEqual(['name', 'on', 'permissions', 'concurrency', 'jobs']);
  });

  it('has exactly the suite-l2 job, gated on its own repository variable', () => {
    expect(keysAt(jobs, 2)).toEqual(['suite-l2']);
    expect(job).toContain('    name: Suite L2 weekly run');
    expect(job).toContain("    if: vars.CONVERSATION_SUITE_L2_ENABLED == 'true'");
    expect(job).toContain('    runs-on: ubuntu-latest');
    expect(job).toContain('    timeout-minutes: 240');
    expect(text.match(/vars\.[A-Z0-9_]+/g)).toEqual(['vars.CONVERSATION_SUITE_L2_ENABLED']);
    expect(text).not.toMatch(/CONVERSATION_SUITE_L1_PR_GATE_ENABLED|CONVERSATION_SIM_SCHEDULED_ENABLED/);
  });

  it('copies the Postgres and Redis service blocks of ci.yml', () => {
    const ci = readFileSync(resolve(WORKFLOW, '..', 'ci.yml'), 'utf8').split('\n');
    const ciServices = block(block(block(ci, 'jobs', 0), 'integration', 2), 'services', 4);
    expect(block(job, 'services', 4)).toEqual(ciServices);
    const services = block(job, 'services', 4).join('\n');
    expect(services).toContain('image: pgvector/pgvector:pg16');
    expect(services).toContain('image: redis:7-alpine');
  });

  it('sets the literal job env: local Postgres and Redis, the all-zero key, NODE_ENV test and both ports, no secrets', () => {
    expect(block(job, 'env', 4).map((line) => line.trim())).toEqual([
      'env:',
      'DATABASE_URL: postgresql://postgres:postgres@localhost:5432/entalent_test',
      'REDIS_URL: redis://localhost:6379',
      'FIELD_ENCRYPTION_KEY: 0000000000000000000000000000000000000000000000000000000000000000',
      'NODE_ENV: test',
      "API_PORT: '3000'",
      "WORKER_PORT: '3001'",
    ]);
    expect(text).not.toMatch(/NODE_ENV:\s*production/);
  });

  it('runs its steps in order', () => {
    const index = (needle: string) => steps.findIndex((step) => step.includes(needle));
    const order = [
      index('actions/checkout@'),
      index('pnpm/action-setup@'),
      index('actions/setup-node@'),
      index('pnpm install --frozen-lockfile'),
      index('pnpm turbo run build --filter=@entalent/api... --filter=@entalent/worker... --filter=@entalent/conversation-sim^...'),
      steps.indexOf(credentialsStep),
      index(`mkdir -p ${STACK_LOGS}`),
      steps.indexOf(migrateStep),
      steps.indexOf(adminKeyStep),
      steps.indexOf(apiStep),
      steps.indexOf(workerStep),
      steps.indexOf(waitStep),
      steps.indexOf(runStep),
      steps.indexOf(uploadStep),
      steps.indexOf(linkStep),
    ];
    expect(order).toEqual([...Array(15).keys()]);
    expect(steps).toHaveLength(15);
    expect(steps[0]).toContain('fetch-depth: 0');
    expect(steps[0]).toContain('persist-credentials: false');
    expect(steps[2]).toContain("node-version: '24'");
    expect(steps[2]).toContain('cache: pnpm');
  });

  it('checks credentials with the l1-gate presence booleans and fails closed', () => {
    expect(credentialsStep).toContain('working-directory: packages/conversation-sim');
    expect(credentialsStep).toContain('node --import tsx src/suite/l1-gate.ts credentials');
    expect(credentialsStep).toContain("echo '::error::");
    expect(credentialsStep).toContain('exit 1');
    for (const name of ALLOWED_SECRETS) expect(credentialsStep).toContain(`HAS_${name}: \${{ secrets.${name} != '' }}`);
    expect(rawSecretRefs(credentialsStep)).toBe(0);
  });

  it('migrates with the ci.yml root command, seeds into the log and outputs the tenant id from l2-stack.ts', () => {
    expect(readFileSync(resolve(WORKFLOW, '..', 'ci.yml'), 'utf8')).toContain('run: pnpm db:migrate');
    expect(migrateStep).toContain('id: tenant');
    expect(migrateStep).toContain('          pnpm db:migrate');
    expect(migrateStep).toContain(`pnpm db:seed > ${STACK_LOGS}/seed.log 2>&1`);
    expect(migrateStep).toContain('node --import tsx src/suite/l2-stack.ts tenant-from-seed runs/l2-stack/seed.log');
    expect(migrateStep).toContain('echo "tenant_id=$tenant_id" >> "$GITHUB_OUTPUT"');
  });

  it('generates a masked admin key into GITHUB_ENV', () => {
    expect(adminKeyStep).toContain('admin_key="$(openssl rand -hex 32)"');
    expect(adminKeyStep).toContain('echo "::add-mask::$admin_key"');
    expect(adminKeyStep).toContain('echo "ADMIN_API_KEY=$admin_key" >> "$GITHUB_ENV"');
  });

  it('starts the api in the background with a placeholder model key and no secrets', () => {
    expect(apiStep).toContain('OPENAI_API_KEY: sk-test-placeholder');
    expect(apiStep).toContain(`nohup pnpm --filter @entalent/api start > ${STACK_LOGS}/api.log 2>&1 &`);
    expect(apiStep).not.toContain('secrets.');
  });

  it('starts the worker with the env written by l2-stack.ts worker-env, sourced with set -a', () => {
    const run = workerStep.slice(workerStep.indexOf('run: |'));
    const worker = [
      'node --import tsx src/suite/l2-stack.ts worker-env --output "$RUNNER_TEMP/l2-worker.env"',
      'set -a',
      '. "$RUNNER_TEMP/l2-worker.env"',
      'set +a',
      `nohup pnpm --filter @entalent/worker start > ${STACK_LOGS}/worker.log 2>&1 &`,
    ].map((needle) => run.indexOf(needle));
    expect(worker.every((position) => position >= 0)).toBe(true);
    expect([...worker].sort((a, b) => a - b)).toEqual(worker);
    for (const name of ALLOWED_SECRETS) expect(workerStep).toContain(`${name}: \${{ secrets.${name} }}`);
    expect(workerStep).toContain('OPENAI_MODEL_BALANCED: ${{ secrets.AZURE_OPENAI_TESTING_DEPLOYMENT }}');
    // The worker env is never spelled out here: suite.config.json l2.workerEnv is the single source.
    expect(text).not.toContain('PROACTIVE_SCAN_ENABLED');
  });

  it('waits for the api and worker ready routes', () => {
    expect(waitStep).toContain('curl -fsS --retry 90 --retry-delay 2 --retry-all-errors http://127.0.0.1:3000/api/v1/health/ready');
    expect(waitStep).toContain('curl -fsS --retry 90 --retry-delay 2 --retry-all-errors http://127.0.0.1:3001/health/ready');
  });

  it('runs run-live ci --level L2 --runs 3 --include-unbaselined --live-model --live-app as a single command', () => {
    expect(runStep).toContain('working-directory: packages/conversation-sim');
    expect(runStep).toContain(
      'run: node --import tsx src/suite/run-live.ts ci --level L2 --runs 3 --include-unbaselined --live-model --live-app --summary "$GITHUB_STEP_SUMMARY"',
    );
    expect(runStep).toContain('SUITE_L2_API_BASE: http://127.0.0.1:3000');
    expect(runStep).toContain('SUITE_L2_TENANT_ID: ${{ steps.tenant.outputs.tenant_id }}');
    expect(runStep).toContain("LANGWATCH_API_KEY: ''");
    for (const name of ALLOWED_SECRETS) expect(runStep).toContain(`${name}: \${{ secrets.${name} }}`);
    expect(runStep).not.toMatch(/set \+e|\|\| true|exit 0|run: \|/);
  });

  it('only the worker and run steps carry secret values; --live-model and --live-app appear only in the run step', () => {
    expect(rawSecretRefs(workerStep)).toBe(ALLOWED_SECRETS.length + 1);
    expect(rawSecretRefs(runStep)).toBe(ALLOWED_SECRETS.length);
    expect(rawSecretRefs(text)).toBe(rawSecretRefs(workerStep) + rawSecretRefs(runStep));
    const code = lines.filter(meaningful).join('\n');
    for (const flag of ['--live-model', '--live-app']) {
      expect(code.split(flag).length - 1).toBe(1);
      expect(runStep).toContain(flag);
    }
  });

  it('every secrets.<NAME> is one of the allowed five; secrets are never inherited or dumped', () => {
    const names = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(ALLOWED_SECRETS).toContain(name);
    expect(text).not.toMatch(/secrets\s*:\s*inherit|toJSON\(secrets\)/);
  });

  it('uploads the suite runs and stack logs always, for 14 days, and links the artifact', () => {
    expect(uploadStep).toContain('actions/upload-artifact@');
    expect(uploadStep).toContain('id: upload');
    expect(uploadStep).toMatch(/if: always\(\)$/m);
    expect(uploadStep).toContain('name: suite-l2-weekly-${{ github.run_id }}-${{ github.run_attempt }}');
    const paths = block(uploadStep.split('\n'), 'path', 10).slice(1).map((line) => line.trim());
    expect(paths).toEqual(['packages/conversation-sim/runs/suites/**', `${STACK_LOGS}/*.log`]);
    expect(uploadStep).toContain('if-no-files-found: ignore');
    expect(uploadStep).toContain('retention-days: 14');
    expect(linkStep).toContain("if: always() && steps.upload.outputs.artifact-url != ''");
    expect(linkStep).toContain('ARTIFACT_URL: ${{ steps.upload.outputs.artifact-url }}');
    expect(linkStep).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  it('targets only localhost: every URL host is 127.0.0.1 or localhost', () => {
    const urls = [...text.matchAll(/[a-z]+:\/\/[^\s'"]+/g)].map((match) => match[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  });
});
