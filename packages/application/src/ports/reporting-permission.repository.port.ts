export type ReportingWithdrawalTarget = { kind: 'full_reporting' } | { kind: 'partial_reporting'; lineageIds: string[] };
export interface VerifiedReportingRightsContext {
  kind: 'verified_subject' | 'authorized_internal_rights_request';
  tenantId: string;
  userId: string;
  personId: string;
  verificationId: string;
  /** Trusted adapter admission time, never employee/model supplied. */
  receivedAt: Date;
}
export interface WithdrawReportingPermissionInput {
  tenantId: string;
  userId: string;
  personId: string;
  requestId: string;
  provenance: VerifiedReportingRightsContext;
  target: ReportingWithdrawalTarget;
}
export interface ReportingWithdrawalReceipt { requestId: string; permissionRevision: number; replayed: boolean }
export interface ReportingPermissionRepositoryPort {
  withdraw(input: WithdrawReportingPermissionInput): Promise<ReportingWithdrawalReceipt>;
}
