import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from './reconcile-pulse-report-delivery';
test('offline reconciliation import is inert and CLI rejects missing enable/evidence before environment or provider access', async () => {
  await assert.rejects(main([]), /explicit_local_reconciliation_and_evidence_file_required/);
});
test('offline operator refuses nonlocal database before opening evidence or constructing database/provider clients', async () => {
  const before = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://synthetic@nonlocal.invalid/fixture';
    await assert.rejects(
      main(['--enable-offline-reconciliation', '/nonexistent/no-evidence.json']),
      /local_operator_only_nonlocal_database_requires_separate_approval/,
    );
  } finally {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  }
});
