import type { ReportingPermissionRepositoryPort, WithdrawReportingPermissionInput } from '../ports/reporting-permission.repository.port';
export function validateReportingWithdrawal(input: WithdrawReportingPermissionInput): void {
  const proof = input.provenance;
  if (!input.tenantId || !input.userId || !input.personId || !input.requestId?.trim()
    || !proof || !['verified_subject', 'authorized_internal_rights_request'].includes(proof.kind)
    || proof.tenantId !== input.tenantId || proof.userId !== input.userId || proof.personId !== input.personId
    || !proof.verificationId?.trim() || !(proof.receivedAt instanceof Date) || !Number.isFinite(proof.receivedAt.getTime())) {
    throw new Error('reporting_rights_verification_required');
  }
  if (input.target?.kind !== 'full_reporting' && (input.target?.kind !== 'partial_reporting'
    || !input.target.lineageIds.length || input.target.lineageIds.some((id) => !id?.trim())
    || new Set(input.target.lineageIds).size !== input.target.lineageIds.length)) {
    throw new Error('reporting_withdrawal_target_invalid');
  }
}
export class WithdrawReportingPermissionUseCase {
  constructor(private readonly repository: ReportingPermissionRepositoryPort) {}
  execute(input: WithdrawReportingPermissionInput) {
    validateReportingWithdrawal(input);
    return this.repository.withdraw(input);
  }
}
