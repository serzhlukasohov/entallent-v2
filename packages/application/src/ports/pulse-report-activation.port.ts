/** RPT-10 native report activation. A missing control means off; only the operator script changes it. */
export const PULSE_REPORT_ACTIVATION_MODES = ['off', 'observe', 'deliver'] as const;
export type PulseReportActivationMode = (typeof PULSE_REPORT_ACTIVATION_MODES)[number];
export type PulseReportActivationScopeKind = 'manager_overall' | 'team';

export interface PulseReportActivationControl {
  tenantId: string;
  mode: PulseReportActivationMode;
  revision: number;
  approvalReference: string;
  expiresAt: Date | null;
  updatedBy: string;
}
/** Durable scope identity (org unit, optional team, kind); per-cycle scope rows map onto it. */
export interface PulseReportActivationScope {
  kind: PulseReportActivationScopeKind;
  orgUnitId: string;
  orgTeamId: string | null;
  /** Null keeps the scope observe-only even under `deliver`. */
  approvedRecipientPersonId: string | null;
}
export interface PulseReportActivationState {
  control: PulseReportActivationControl | null;
  scopes: PulseReportActivationScope[];
}

export type PulseReportActivationHoldReason =
  | 'obligation_missing'
  | 'no_control'
  | 'control_off'
  | 'control_expired'
  | 'scope_not_allowlisted'
  | 'observe_only'
  | 'deliver_expiry_missing'
  | 'recipient_not_approved'
  | 'snapshot_missing'
  | 'recipient_mismatch'
  /** Some parts already have receipts; the remainder waits and resumes strictly after them on re-enable. */
  | 'partial_delivery_held';
export interface PulseReportActivationDecision {
  observe: boolean;
  deliver: boolean;
  /** Why delivery (and, when observe=false, formation) is held. Null only when deliver=true. */
  holdReason: PulseReportActivationHoldReason | null;
}

export interface PulseReportActivationChange {
  tenantId: string;
  expectedRevision: number;
  mode: PulseReportActivationMode;
  expiresAt: Date | null;
  approvalReference: string;
  operator: string;
  scopes: PulseReportActivationScope[];
}
export type PulseReportActivationChangeResult =
  | { status: 'applied'; revision: number; warnings: string[] }
  | { status: 'revision_conflict'; currentRevision: number }
  | { status: 'invalid'; errors: string[] };

export interface PulseReportActivationPort {
  read(tenantId: string): Promise<PulseReportActivationState>;
  /** Revision CAS; the audit event commits in the same transaction or nothing does. */
  change(change: PulseReportActivationChange): Promise<PulseReportActivationChangeResult>;
}
