import assert from 'node:assert/strict';
import {
  buildBackfillAuditMetadata,
  buildBackfillSummary,
  buildExactAccountScope,
  parseBackfillOptions,
  type BackfillAction,
} from './backfill-slack-display-names';

function testMissingExplicitTenant(): void {
  assert.throws(
    () => parseBackfillOptions({
      DATABASE_URL: 'postgresql://example',
      FIELD_ENCRYPTION_KEY: 'key',
      DEFAULT_TENANT_ID: 'tenant-from-default',
    }),
    /TENANT_ID is required/,
  );
}

function testDryRunDefaultAndApplyFlag(): void {
  const dryRun = parseBackfillOptions({
    DATABASE_URL: 'postgresql://example',
    FIELD_ENCRYPTION_KEY: 'key',
    TENANT_ID: 'tenant-1',
    BACKFILL_LIMIT: '10',
    BACKFILL_USER_ID: 'user-1',
    BACKFILL_WORKSPACE_ID: 'workspace-1',
  });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.limit, 10);
  assert.equal(dryRun.userId, 'user-1');
  assert.equal(dryRun.externalWorkspaceId, 'workspace-1');

  const apply = parseBackfillOptions({
    DATABASE_URL: 'postgresql://example',
    FIELD_ENCRYPTION_KEY: 'key',
    TENANT_ID: 'tenant-1',
    BACKFILL_SLACK_DISPLAY_NAMES_APPLY: '1',
    BACKFILL_OUTPUT: 'json',
  });
  assert.equal(apply.dryRun, false);
  assert.equal(apply.output, 'json');
}

function testSummaryCounts(): void {
  const actions: BackfillAction[] = [
    {
      userId: 'user-1',
      externalWorkspaceId: 'workspace-1',
      externalUserId: 'slack-1',
      status: 'planned',
      displayName: 'Ana',
    },
    {
      userId: 'user-2',
      externalWorkspaceId: 'workspace-1',
      externalUserId: 'slack-2',
      status: 'skipped',
      reason: 'missing_active_workspace_bot_token',
    },
    {
      userId: 'user-3',
      externalWorkspaceId: 'workspace-2',
      externalUserId: 'slack-3',
      status: 'failed',
      reason: 'Slack failed with xoxb-secret-token',
    },
  ];

  const summary = buildBackfillSummary(
    {
      tenantId: 'tenant-1',
      dryRun: true,
      externalWorkspaceId: 'workspace-1',
    },
    3,
    actions,
  );
  assert.equal(summary.scanned, 3);
  assert.equal(summary.planned, 1);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.filters, { externalWorkspaceId: 'workspace-1' });
}

function testAuditMetadataRedaction(): void {
  const summary = buildBackfillSummary(
    {
      tenantId: 'tenant-1',
      dryRun: false,
    },
    1,
    [
      {
        userId: 'user-1',
        externalWorkspaceId: 'workspace-1',
        externalUserId: 'slack-1',
        status: 'failed',
        displayName: 'Ana',
        reason: 'Bearer raw-secret and xoxb-slack-secret-token for ana@example.com\nsecond line',
      },
    ],
  );

  const metadataText = JSON.stringify(buildBackfillAuditMetadata(summary));
  assert.match(metadataText, /Bearer \[redacted\]/);
  assert.match(metadataText, /\[redacted-slack-token\]/);
  assert.match(metadataText, /\[redacted-email\]/);
  assert.doesNotMatch(metadataText, /raw-secret/);
  assert.doesNotMatch(metadataText, /xoxb-slack-secret-token/);
  assert.doesNotMatch(metadataText, /ana@example\.com/);
  assert.doesNotMatch(metadataText, /second line/);
  assert.doesNotMatch(metadataText, /avatarUrl/);
  assert.doesNotMatch(metadataText, /actions/);
  assert.doesNotMatch(metadataText, /Ana/);
  assert.doesNotMatch(metadataText, /slack-1/);
  assert.doesNotMatch(metadataText, /workspace-1/);
  assert.doesNotMatch(metadataText, /user-1/);
}

function testExactAccountScope(): void {
  assert.deepEqual(
    buildExactAccountScope('tenant-1', {
      userId: 'user-1',
      externalWorkspaceId: 'workspace-1',
      externalUserId: 'slack-1',
      userPreferredName: null,
    }),
    {
      tenantId: 'tenant-1',
      userId: 'user-1',
      channelType: 'slack',
      externalWorkspaceId: 'workspace-1',
      externalUserId: 'slack-1',
    },
  );
}

function testAuditMetadataIsCountsAndFailureSamplesOnly(): void {
  const summary = buildBackfillSummary(
    {
      tenantId: 'tenant-1',
      dryRun: false,
    },
    1,
    [
      {
        userId: 'user-1',
        externalWorkspaceId: 'workspace-1',
        externalUserId: 'slack-1',
        status: 'updated',
        displayName: 'Ana',
      },
    ],
  );

  assert.deepEqual(buildBackfillAuditMetadata(summary), {
    dryRun: false,
    scanned: 1,
    planned: 0,
    updated: 1,
    skipped: 0,
    failed: 0,
    filters: {},
    failureSamples: [],
  });
}

testMissingExplicitTenant();
testDryRunDefaultAndApplyFlag();
testSummaryCounts();
testAuditMetadataRedaction();
testExactAccountScope();
testAuditMetadataIsCountsAndFailureSamplesOnly();

console.log('backfill-slack-display-names safety tests passed');
