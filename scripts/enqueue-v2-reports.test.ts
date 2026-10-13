import assert from 'node:assert/strict';
import { parseV2ReportEnqueueConfig } from './enqueue-v2-reports';

const env = {
  TENANT_ID: '11111111-1111-4111-8111-111111111111',
  DATABASE_URL: 'postgresql://example',
  REDIS_URL: 'redis://example',
  V2_REPORT_KIND: 'intermediate',
};
const dryRun = parseV2ReportEnqueueConfig(env);
assert.equal(dryRun.reportKind, 'intermediate');
assert.equal(dryRun.enqueue, false);
assert.equal(parseV2ReportEnqueueConfig({
  ...env, V2_REPORT_KIND: 'final', CONFIRM_V2_REPORT_ENQUEUE: env.TENANT_ID,
}).enqueue, true);
assert.throws(() => parseV2ReportEnqueueConfig({ ...env, V2_REPORT_KIND: 'unknown' }),
  /V2_REPORT_KIND/);
assert.throws(() => parseV2ReportEnqueueConfig({ ...env, TENANT_ID: 'wrong' }),
  /TENANT_ID UUID/);
console.log('V2 report enqueue config tests passed');
