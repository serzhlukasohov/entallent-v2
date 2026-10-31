import { describe, expect, it, vi } from 'vitest';
import { WithdrawReportingPermissionUseCase } from './withdraw-reporting-permission.use-case';
import type { WithdrawReportingPermissionInput } from '../ports/reporting-permission.repository.port';

describe('verified reporting rights commands', () => {
  const input: WithdrawReportingPermissionInput = { tenantId: 'tenant', userId: 'subject', personId: 'subject', requestId: 'request', provenance: { kind: 'verified_subject', tenantId: 'tenant', userId: 'subject', personId: 'subject', verificationId: 'verified-session', receivedAt: new Date() }, target: { kind: 'full_reporting' } };
  it('passes an explicit verified full denial to its transactional port', async () => {
    const withdraw = vi.fn().mockResolvedValue({ requestId: 'request', permissionRevision: 1, replayed: false });
    await new WithdrawReportingPermissionUseCase({ withdraw }).execute(input);
    expect(withdraw).toHaveBeenCalledWith(input);
  });
  it('rejects admin-only, foreign-tenant and wrong-subject provenance before persistence', () => {
    const withdraw = vi.fn(); const useCase = new WithdrawReportingPermissionUseCase({ withdraw });
    for (const provenance of [{ ...input.provenance, kind: 'company_admin' as never }, { ...input.provenance, tenantId: 'foreign' }, { ...input.provenance, userId: 'other' }]) {
      expect(() => useCase.execute({ ...input, provenance })).toThrow('reporting_rights_verification_required');
    }
    expect(withdraw).not.toHaveBeenCalled();
  });
  it('requires explicit nonduplicated lineage IDs for partial requests', () => {
    const useCase = new WithdrawReportingPermissionUseCase({ withdraw: vi.fn() });
    for (const lineageIds of [[], ['same', 'same']]) expect(() => useCase.execute({ ...input, target: { kind: 'partial_reporting', lineageIds } })).toThrow('reporting_withdrawal_target_invalid');
  });
});
