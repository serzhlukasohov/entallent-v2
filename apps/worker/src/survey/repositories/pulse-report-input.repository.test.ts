import { describe, expect, it } from 'vitest';
import type { PulseInputContext } from '@entalent/contracts';
import { PulseReportInputRepository } from './pulse-report-input.repository';
const context = {
  tenantId: 't',
  cycleId: 'c',
  scopeId: 's',
  purpose: 'final',
  frontier: '2026-10-26T00:00:00.000001Z',
} as PulseInputContext;
const row = {
  user_id: 'u',
  lineage_id: 'l',
  insight_id: 'i',
  state: 'retained',
  outcome: 'scored',
  score: '70',
  deidentified_summary: 'Safe permanent analytical statement',
  privacy_policy_version: 'question-deidentification-v2',
  proof_status: 'receipt_backed',
  has_proof: true,
  trusted_proof: true,
  binding_valid: true,
  accepted_source_receipts: [{ messageId: 'source', receivedAt: '2026-10-20T00:00:00.000001Z' }],
  sources_timely: true,
  live: true,
  retained_id: 'i',
  stable_key: 'a',
  question_group: 'autonomy',
};
async function select(
  open: unknown[],
  numeric: unknown[] = [],
  keys = [
    { metric_key: 'engagement', stable_key: 'x' },
    { metric_key: 'engagement', stable_key: 'y' },
    { metric_key: 'engagement', stable_key: 'z' },
  ],
) {
  let calls = 0;
  const responses = [[{ user_id: 'u' }], keys, open, numeric];
  const tx = { execute: async () => responses[calls++] };
  const repo = new PulseReportInputRepository({} as never);
  return (
    repo as unknown as { select(tx: unknown, c: PulseInputContext): Promise<unknown> }
  ).select(tx, context);
}
describe('RPT05 permanent adapter missing-proof and terminal matrix', () => {
  it.each([
    { retained_id: null, live: null },
    { has_proof: false },
    { binding_valid: false },
    { privacy_policy_version: null },
    { privacy_policy_version: 'unapproved-policy' },
    { privacy_policy_version: 'question-deidentification-v1' },
    { trusted_proof: false },
  ])('unexpected retained proof loss blocks rather than excluding: %j', async (patch) => {
    expect(await select([{ ...row, ...patch }])).toBe('missing_proof');
  });
  it('missing accepted numeric permanent row cannot disappear through NULL live expiry', async () => {
    expect(await select([], [{ status: 'accepted', live: null, revision_id: null }])).toBe(
      'missing_proof',
    );
  });
  it('missing native literal catalog is an operational block', async () => {
    expect(await select([], [], [])).toBe('missing_proof');
  });
  it.each(['expired', 'deleted', 'withdrawn'])(
    'latest %s watermark excludes content without reviving any older score',
    async (state) => {
      expect(await select([{ ...row, state, retained_id: null, live: null }])).toMatchObject({
        topics: [],
      });
    },
  );
  it('latest insufficient-evidence text remains qualitative and contributes no scalar', async () => {
    expect(await select([{ ...row, outcome: 'insufficient_evidence', score: null }])).toMatchObject(
      { topics: [{ kind: 'index', value: null, safeSummary: row.deidentified_summary }] },
    );
  });
  it('conflicting same-lineage receipt states block; demonstrably identical states deduplicate', async () => {
    expect(await select([row, { ...row, score: '80' }])).toBe('integrity_conflict');
    expect(await select([row, { ...row }])).toMatchObject({ topics: [{ value: 70 }] });
  });
});
