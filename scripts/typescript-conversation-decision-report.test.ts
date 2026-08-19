import assert from 'node:assert/strict';
import {
  DECISION_REPORT_SQL,
  parseDecisionReportEnv,
} from './typescript-conversation-decision-report';

assert.throws(
  () => parseDecisionReportEnv({ DATABASE_URL: 'postgresql://example' }),
  /TENANT_ID is required/,
);
assert.throws(
  () => parseDecisionReportEnv({ TENANT_ID: 'not-a-uuid', DATABASE_URL: 'postgresql://example' }),
  /TENANT_ID must be a UUID/,
);
assert.deepEqual(
  parseDecisionReportEnv({
    TENANT_ID: '11111111-1111-4111-8111-111111111111',
    DATABASE_URL: 'postgresql://example',
  }),
  {
    tenantId: '11111111-1111-4111-8111-111111111111',
    databaseUrl: 'postgresql://example',
  },
);

assert.match(DECISION_REPORT_SQL, /\$1::uuid AS tenant_id/);
assert.match(DECISION_REPORT_SQL, /m\.deleted_at IS NULL/);
assert.match(DECISION_REPORT_SQL, /u\.deleted_at IS NULL/);
assert.match(DECISION_REPORT_SQL, /m\.text <> '__init__'/);
assert.match(DECISION_REPORT_SQL, /m\.sender_type = 'user'/);
assert.match(DECISION_REPORT_SQL, /m\.message_type = 'text'/);
assert.match(DECISION_REPORT_SQL, /c\.channel_type NOT IN \('dev', 'sim'\)/);
assert.match(DECISION_REPORT_SQL, /measurementVersion/);
assert.match(DECISION_REPORT_SQL, /FROM outbound_base candidate/);
assert.doesNotMatch(
  DECISION_REPORT_SQL,
  /outbound_base AS \([\s\S]*?measurementVersion[\s\S]*?\),\s*paired_turns AS/,
);
assert.equal(DECISION_REPORT_SQL.match(/ANY\([^)]*source_message_ids\)/g)?.length, 6);
assert.match(DECISION_REPORT_SQL, /'reliability'/);
assert.match(DECISION_REPORT_SQL, /'continuity'/);
assert.match(DECISION_REPORT_SQL, /'decisionCohorts'/);
assert.match(DECISION_REPORT_SQL, /'usefulState'/);
assert.doesNotMatch(DECISION_REPORT_SQL, /estimated_cost|input_token_count|output_token_count|prompt_version/);
assert.doesNotMatch(DECISION_REPORT_SQL, /evidence_summary|memory_items\.content/);

console.log('TypeScript conversation decision report safety tests passed');
