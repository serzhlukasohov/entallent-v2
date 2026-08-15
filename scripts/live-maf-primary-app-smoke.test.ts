import assert from 'node:assert/strict';
import {
  MAF_PRIMARY_APP_SMOKE_REGRESSION,
  parseRedisConnection,
  safeDiagnosticText,
} from './live-maf-primary-app-smoke';

assert.equal(MAF_PRIMARY_APP_SMOKE_REGRESSION.feature, 'Slack AI mentor');
assert.equal(MAF_PRIMARY_APP_SMOKE_REGRESSION.runtimeMode, 'maf_primary');
assert.match(MAF_PRIMARY_APP_SMOKE_REGRESSION.path, /Slack\/API event -> queue -> worker -> MAF runtime/);
assert.equal(MAF_PRIMARY_APP_SMOKE_REGRESSION.command, 'pnpm maf:primary:app:smoke');
assert.deepEqual(parseRedisConnection('redis://:pass@localhost:6380/15'), {
  host: 'localhost',
  port: 6380,
  db: 15,
  password: 'pass',
});
assert.throws(() => parseRedisConnection('redis://localhost:6380/-1'), /invalid_redis_database/);
assert.throws(() => parseRedisConnection('redis://localhost:6380/not-a-number'), /invalid_redis_database/);
assert.equal(
  safeDiagnosticText('ADMIN_API_KEY=abc AGENT_SERVICE_OPENAI_API_KEY=sk-test bearer secret-token'),
  'ADMIN_API_KEY=[redacted] AGENT_SERVICE_OPENAI_API_KEY=[redacted] [redacted]',
);

console.log('live-maf-primary-app-smoke regression metadata tests passed');
