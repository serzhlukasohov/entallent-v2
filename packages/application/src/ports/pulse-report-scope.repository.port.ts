export type PulseReportScopeMode = 'legacy' | 'org_native';
export interface PulseReportScopeRecord {
  id: string;
  kind: 'team' | 'manager_overall';
  orgTeamId: string | null;
  orgUnitId: string;
  parentScopeId: string | null;
  label: string;
  openingOwnerPersonId: string | null;
  historyKey: string;
  boundaryFingerprint: string;
  participantUserIds: string[];
}
export interface PulseReportCycleSnapshot {
  tenantId: string;
  cycleScoringPolicyId: string;
  openedAt: Date;
  scopeContractVersion: string;
  scopes: PulseReportScopeRecord[];
}
export interface OpenOrgNativeReportCycleInput {
  tenantId: string;
  surveyDefinitionId: string;
  periodStart: Date;
  periodEnd: Date;
}
export interface PulseReportScopeRepositoryPort {
  openOrgNativeCycle(input: OpenOrgNativeReportCycleInput): Promise<PulseReportCycleSnapshot>;
  scopeDenominator(tenantId: string, scopeId: string): Promise<{ denominator: number; threshold: number }>;
}
export type PulseReportCollectionUnavailableReason = 'nonparticipant' | 'stopped' | 'full_withdrawal' | 'lineage_excluded' | 'missing_proof';
export interface PulseReportCollectionUnavailable {
  kind: 'collection_unavailable';
  reason: PulseReportCollectionUnavailableReason;
}
export function isPulseReportCollectionUnavailable(value: unknown): value is PulseReportCollectionUnavailable {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'collection_unavailable';
}
