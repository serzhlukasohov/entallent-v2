import { describe, it, expect } from 'vitest';
import { PulseLifecycleJobSchema, PulseReconciliationSchema } from './pulse-report-delivery';
describe('native publication operational contracts', () => {
  it('rejects content and transport grants in queue arguments', () =>
    expect(
      PulseLifecycleJobSchema.safeParse({
        tenantId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        obligationId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        action: 'deliver',
        grant: 'secret',
      }).success,
    ).toBe(false));
  it('cannot reconcile absence of evidence or wrong scope as no-send', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const input = {
      tenantId: id,
      snapshotId: id,
      attemptId: id,
      token: 1,
      operator: {
        actorId: 'operator',
        tenantId: id,
        snapshotId: id,
        authorizationRef: 'approved-local-fixture',
      },
      reason: 'investigated',
      evidenceRef: 'offline-case',
      decision: 'confirmed_not_sent',
      evidence: { kind: 'inconclusive', bodyHash: 'a'.repeat(64), ownerTerminated: false },
    };
    expect(PulseReconciliationSchema.safeParse(input).success).toBe(false);
    expect(
      PulseReconciliationSchema.safeParse({
        ...input,
        evidence: { ...input.evidence, kind: 'definitive_nonpublication', ownerTerminated: true },
      }).success,
    ).toBe(true);
  });
});
