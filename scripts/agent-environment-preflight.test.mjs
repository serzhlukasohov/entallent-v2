import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPreflightReport,
  classifyCommandResult,
  formatReport,
  parseEnvFile,
  resolvePreflightOptions,
} from './agent-environment-preflight.mjs';

test('parses environment presence without exposing secret values', () => {
  const env = parseEnvFile(`
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/entalent
REDIS_URL=redis://localhost:6380
FIELD_ENCRYPTION_KEY=0123456789abcdef
AZURE_OPENAI_API_KEY=super-secret
`);

  assert.equal(env.DATABASE_URL.present, true);
  assert.equal(env.AZURE_OPENAI_API_KEY.present, true);
  assert.equal(Object.hasOwn(env.AZURE_OPENAI_API_KEY, 'value'), false);
});

test('classifies sandbox socket restrictions as blocked instead of product failures', () => {
  const result = classifyCommandResult({
    command: 'pnpm exec tsx -e "console.log(1)"',
    status: 1,
    stdout: '',
    stderr: 'Error: listen EPERM: operation not permitted /var/folders/tmp/tsx.pipe',
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.detail, /sandbox/i);
});

test('builds a report with split MAF and non-MAF script gates', async () => {
  const report = await buildPreflightReport({
    rootDir: '/repo',
    nodeVersion: '25.2.1',
    readTextFile: async (path) => {
      if (path.endsWith('package.json')) {
        return JSON.stringify({
          packageManager: 'pnpm@9.12.0',
          scripts: {
            prepush: 'pnpm typecheck && pnpm lint && pnpm test',
            'prepush:non-maf': 'pnpm typecheck && pnpm lint && turbo run test && pnpm run test:scripts:non-maf',
            'test:scripts:non-maf': 'pnpm exec tsx scripts/a.test.ts',
            'test:scripts:maf': 'pnpm exec tsx scripts/live-maf-primary-app-smoke.test.ts',
            'test:scripts': 'pnpm run test:scripts:non-maf && pnpm run test:scripts:maf',
          },
        });
      }
      if (path.endsWith('.env')) {
        return [
          'DATABASE_URL=postgresql://postgres:postgres@localhost:5434/entalent',
          'REDIS_URL=redis://localhost:6380',
          'FIELD_ENCRYPTION_KEY=0123456789abcdef',
          'AZURE_OPENAI_ENDPOINT=https://example.openai.azure.com',
          'AZURE_OPENAI_API_KEY=secret',
          'AZURE_OPENAI_API_VERSION=2024-02-01',
        ].join('\n');
      }
      if (path.endsWith('ci.yml')) return "NODE_VERSION: '24'\n";
      throw Object.assign(new Error(`unexpected read ${path}`), { code: 'ENOENT' });
    },
    exists: async (path) => path.endsWith('node_modules') || path.endsWith('pnpm-lock.yaml'),
    runCommand: async (command) => {
      if (command === 'pnpm -v') return { command, status: 0, stdout: '9.12.0\n', stderr: '' };
      return { command, status: 0, stdout: '', stderr: '' };
    },
    checkTcp: async () => ({ status: 'pass', detail: 'reachable' }),
  });

  assert.equal(report.exitCode, 0);
  assert.equal(report.checks.find((check) => check.id === 'node-version')?.status, 'warn');
  assert.equal(report.checks.find((check) => check.id === 'gate-prepush-non-maf')?.status, 'pass');
  assert.equal(
    report.checks.find((check) => check.id === 'gate-test-scripts-non-maf')?.status,
    'pass',
  );
  assert.equal(report.checks.find((check) => check.id === 'gate-test-scripts-maf')?.status, 'pass');
  assert.doesNotMatch(formatReport(report), /secret|postgres:postgres|012345/);
});

test('keeps production smoke secrets out of the default local profile', async () => {
  const report = await buildPreflightReport(makeFixtureOptions());

  assert.equal(
    report.checks.some((check) => check.id === 'env-ADMIN_API_KEY'),
    false,
  );
  assert.equal(
    report.checks.some((check) => check.id === 'env-SLACK_SIGNING_SECRET'),
    false,
  );
  assert.equal(
    report.checks.some((check) => check.id === 'env-INTERNAL_SERVICE_AUTH_SECRET'),
    false,
  );
});

test('requires production smoke secrets only in the prod-smoke profile', async () => {
  const report = await buildPreflightReport(makeFixtureOptions({ profile: 'prod-smoke' }));

  assert.equal(report.exitCode, 1);
  assert.equal(report.checks.find((check) => check.id === 'env-ADMIN_API_KEY')?.status, 'fail');
  assert.equal(
    report.checks.find((check) => check.id === 'env-SLACK_SIGNING_SECRET')?.status,
    'fail',
  );
  assert.equal(
    report.checks.find((check) => check.id === 'env-INTERNAL_SERVICE_AUTH_SECRET')?.status,
    'fail',
  );
});

test('can allow blocked sandbox checks without returning a failing exit code', async () => {
  const report = await buildPreflightReport({
    ...makeFixtureOptions({ allowBlocked: true }),
    checkTcp: async () => ({ status: 'blocked', detail: 'blocked by sandbox networking' }),
    runCommand: async (command) => {
      if (command === 'pnpm -v') return { command, status: 0, stdout: '9.12.0\n', stderr: '' };
      return { command, status: 1, stdout: '', stderr: 'operation not permitted' };
    },
  });

  assert.equal(report.exitCode, 0);
  assert.equal(
    report.checks.some((check) => check.status === 'blocked'),
    true,
  );
});

test('parses explicit preflight profiles from CLI args', () => {
  assert.deepEqual(resolvePreflightOptions(['--profile=prod-smoke']), {
    profile: 'prod-smoke',
    allowBlocked: false,
  });
  assert.deepEqual(resolvePreflightOptions(['--allow-blocked']), {
    profile: 'local',
    allowBlocked: true,
  });
});

function makeFixtureOptions(overrides = {}) {
  return {
    rootDir: '/repo',
    nodeVersion: '24.1.0',
    profile: 'local',
    allowBlocked: false,
    readTextFile: async (path) => {
      if (path.endsWith('package.json')) {
        return JSON.stringify({
          packageManager: 'pnpm@9.12.0',
          scripts: {
            prepush: 'pnpm typecheck && pnpm lint && pnpm test',
            'prepush:non-maf': 'pnpm typecheck && pnpm lint && turbo run test && pnpm run test:scripts:non-maf',
            'test:scripts:non-maf': 'pnpm exec tsx scripts/a.test.ts',
            'test:scripts:maf': 'pnpm exec tsx scripts/live-maf-primary-app-smoke.test.ts',
            'test:scripts': 'pnpm run test:scripts:non-maf && pnpm run test:scripts:maf',
          },
        });
      }
      if (path.endsWith('.env')) {
        return [
          'DATABASE_URL=postgresql://postgres:postgres@localhost:5434/entalent',
          'REDIS_URL=redis://localhost:6380',
          'FIELD_ENCRYPTION_KEY=0123456789abcdef',
          'AZURE_OPENAI_ENDPOINT=https://example.openai.azure.com',
          'AZURE_OPENAI_API_KEY=secret',
          'AZURE_OPENAI_API_VERSION=2024-02-01',
        ].join('\n');
      }
      if (path.endsWith('.node-version')) return '24\n';
      if (path.endsWith('ci.yml')) return "NODE_VERSION: '24'\n";
      throw Object.assign(new Error(`unexpected read ${path}`), { code: 'ENOENT' });
    },
    exists: async (path) => path.endsWith('node_modules') || path.endsWith('pnpm-lock.yaml'),
    runCommand: async (command) => {
      if (command === 'pnpm -v') return { command, status: 0, stdout: '9.12.0\n', stderr: '' };
      return { command, status: 0, stdout: '', stderr: '' };
    },
    checkTcp: async () => ({ status: 'pass', detail: 'reachable' }),
    ...overrides,
  };
}
