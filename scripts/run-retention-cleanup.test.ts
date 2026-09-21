import assert from 'node:assert/strict';
import { parseRetentionCleanupConfig } from './run-retention-cleanup';

const valid = {
  DATABASE_URL: 'postgresql://example',
  TENANT_ID: '11111111-1111-4111-8111-111111111111',
  RETENTION_CLEANUP_AT: '2026-10-31T00:00:00.000Z',
};

assert.deepEqual(parseRetentionCleanupConfig(valid), {
  databaseUrl: valid.DATABASE_URL,
  tenantId: valid.TENANT_ID,
  now: new Date(valid.RETENTION_CLEANUP_AT),
});
assert.equal(parseRetentionCleanupConfig({
  DATABASE_URL: valid.DATABASE_URL,
  RETENTION_CLEANUP_AT: valid.RETENTION_CLEANUP_AT,
}).tenantId, undefined);
assert.throws(
  () => parseRetentionCleanupConfig({ ...valid, RETENTION_CLEANUP_AT: '2026-10-31' }),
  /explicit offset/,
);
assert.throws(
  () => parseRetentionCleanupConfig({ ...valid, TENANT_ID: 'tenant-1' }),
  /must be a UUID/,
);

console.log('Retention cleanup config tests passed');
