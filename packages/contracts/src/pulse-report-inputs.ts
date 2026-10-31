/** Restricted backend computation contracts. Never serialize subject/provenance keys to recipients. */
export const PULSE_INPUT_CONTRACT = 'pulse-inputs-v1';
export const PULSE_REPORT_CALCULATION_CONTRACT = 'pulse-calculation-v1';
export const PULSE_REPORT_PRIVACY_POLICY_VERSION = 'question-deidentification-v2';
export type PulseInputPurpose = 'intermediate' | 'final';
export type PulseInputStage = 'capture' | 'native_verdict' | 'evidence' | 'finalization';
export type PulseInputDisposition =
  | 'pending'
  | 'claimed'
  | 'applied'
  | 'not_applicable'
  | 'invalid'
  | 'excluded'
  | 'expired'
  | 'deleted'
  | 'delegated'
  | 'blocked';
export type PulseInputBlock =
  | 'missing_native_scope'
  | 'formation_not_started'
  | 'final_already_started'
  | 'unverified_receipt'
  | 'missing_binding'
  | 'unresolved_stage'
  | 'missing_proof'
  | 'integrity_conflict'
  | 'invalidated'
  | 'manual_reconciliation';
export type PulseInputProjection = 'team_lead_overall' | 'manager_overall' | 'manager_team';
export interface PulseInputRequest {
  tenantId: string;
  cycleId: string;
  scopeId: string;
  purpose: PulseInputPurpose;
  projection?: PulseInputProjection;
}
/** Final team projection is canonical computation identity; it never authorizes an audience. */
export interface PulseInputContext extends PulseInputRequest {
  frontier: string;
  formationStartedAt: string | null;
  generation: number;
  periodStart: string;
  periodEnd: string;
  historyKey: string;
  boundaryFingerprint: string;
  compositionFingerprint: string;
  compatibilitySignature: string;
  scopeKind: 'team' | 'manager_overall';
}
export interface PulseAllowedTopic {
  subjectId: string;
  lineageId: string;
  revisionId: string;
  questionKey: string;
  questionGroup: string;
  kind: 'index' | 'engagement';
  value: number | null;
  summarySupport?:
    'unverified_historical' | 'deidentified_employee_statement' | 'generalized_signal';
  safeSummary?: string;
  signalDirection?: string;
  signalSeverity?: string;
  rootCauseCategory?: string;
  support: 'safe_permanent_summary' | 'literal_answer';
}
export interface PulseAllowedDataset {
  context: PulseInputContext;
  roster: string[];
  questionKeys: Record<string, string[]>;
  topics: PulseAllowedTopic[];
}
export type PulseSettlementResult =
  | { status: 'settled' | 'observed'; context: PulseInputContext }
  | { status: 'pending' | 'blocked'; reason: PulseInputBlock };
export interface PulseMetricCandidate {
  metricKey: string;
  kind: 'index' | 'engagement';
  rawMean: number | null;
  completeCount: number;
  status: 'eligible' | 'insufficient_data';
  requiredCount: number;
}
export type PulsePreparationResult =
  | { status: 'pending' | 'blocked'; reason: PulseInputBlock }
  | {
      status: 'prepared';
      candidateId: string;
      candidateAuthorizationToken?: string;
      context: PulseInputContext;
      metrics: PulseMetricCandidate[];
      qualitative: PulseAllowedTopic[];
      questionKeys?: Record<string,string[]>;
      baselineInventory?: PulseCompletedFinal[];
      finalGate: 'eligible' | 'insufficient_data' | null;
      baselines?: Record<string, PulseBaseline>;
    };
export interface PulseCompletedFinal {
  candidateId?: string;
  authorizationToken?: string;
  cycleId: string;
  periodStart: string;
  periodEnd: string;
  historyKey: string;
  boundaryFingerprint: string;
  compositionFingerprint: string;
  compatibilitySignature: string;
  authorized: boolean;
  metrics: PulseMetricCandidate[];
}
export type PulseBaseline =
  | { status: 'baseline_established' }
  | {
      status: 'comparable';
      priorCycleId: string;
      previousRawMean: number;
      rawDelta: number;
      direction: 'improving' | 'stable' | 'declining';
      compositionChanged: boolean;
    };
