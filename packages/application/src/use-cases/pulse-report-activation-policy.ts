import {
  PULSE_REPORT_ACTIVATION_MODES,
  type PulseReportActivationChange,
  type PulseReportActivationControl,
  type PulseReportActivationDecision,
  type PulseReportActivationHoldReason,
  type PulseReportActivationScope,
} from '../ports/pulse-report-activation.port';

export interface PulseReportActivationDecisionInput {
  control: Pick<PulseReportActivationControl, 'mode' | 'expiresAt'> | null;
  /** The allowlisted durable scope matching the obligation's scope, or null when unlisted. */
  scope: Pick<PulseReportActivationScope, 'approvedRecipientPersonId'> | null;
  /** The snapshot's frozen route; null before formation. Never retargeted. */
  frozenRoute: { personId: string; scopeId: string } | null;
  obligationScopeId: string;
  /** Parts of the current snapshot that already have receipts. */
  deliveredParts?: number;
  /** Database clock. */
  now: Date;
}

const held = (holdReason: PulseReportActivationHoldReason, observe = false): PulseReportActivationDecision => ({
  observe,
  deliver: false,
  holdReason,
});

/** Pure fail-closed decision: anything not positively allowed is held, never cancelled or consumed. */
export function decidePulseReportActivation(input: PulseReportActivationDecisionInput): PulseReportActivationDecision {
  const decision = decideActivation(input);
  // A truncated report is never a silent ordinary hold.
  return !decision.deliver && (input.deliveredParts ?? 0) > 0 ? { ...decision, holdReason: 'partial_delivery_held' } : decision;
}
function decideActivation(input: PulseReportActivationDecisionInput): PulseReportActivationDecision {
  const { control, scope, frozenRoute } = input;
  if (!control) return held('no_control');
  if (control.mode === 'off') return held('control_off');
  if (control.mode !== 'observe' && control.mode !== 'deliver') return held('control_off');
  if (control.expiresAt && control.expiresAt.getTime() <= input.now.getTime()) return held('control_expired');
  if (!scope) return held('scope_not_allowlisted');
  if (control.mode === 'observe') return held('observe_only', true);
  if (!control.expiresAt) return held('deliver_expiry_missing', true);
  if (!scope.approvedRecipientPersonId) return held('recipient_not_approved', true);
  if (!frozenRoute) return held('snapshot_missing', true);
  if (frozenRoute.scopeId !== input.obligationScopeId || frozenRoute.personId !== scope.approvedRecipientPersonId)
    return held('recipient_mismatch', true);
  return { observe: true, deliver: true, holdReason: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PULSE_REPORT_DELIVER_MAX_EXPIRY_MS = 30 * 86_400_000;

/** Lowercases identifiers and trims text so duplicate detection and storage compare canonical values. */
export function normalizePulseReportActivationChange(change: PulseReportActivationChange): PulseReportActivationChange {
  const id = (v: string) => v.trim().toLowerCase();
  return {
    ...change,
    tenantId: id(change.tenantId),
    approvalReference: change.approvalReference.trim(),
    operator: change.operator.trim(),
    scopes: change.scopes.map((s) => ({
      kind: s.kind,
      orgUnitId: id(s.orgUnitId),
      orgTeamId: s.orgTeamId === null ? null : id(s.orgTeamId),
      approvedRecipientPersonId: s.approvedRecipientPersonId === null ? null : id(s.approvedRecipientPersonId),
    })),
  };
}

/** Validation shared by the operator script (dry-run) and the repository (inside the CAS transaction, DB clock). */
export function validatePulseReportActivationChange(input: PulseReportActivationChange, now: Date): string[] {
  const change = normalizePulseReportActivationChange(input);
  const errors: string[] = [];
  if (!UUID.test(change.tenantId)) errors.push('tenant_id_invalid');
  if (!Number.isInteger(change.expectedRevision) || change.expectedRevision < 0) errors.push('expected_revision_invalid');
  if (!(PULSE_REPORT_ACTIVATION_MODES as readonly string[]).includes(change.mode)) errors.push('mode_invalid');
  const approval = change.approvalReference.trim(), operator = change.operator.trim();
  if (!approval || approval.length > 200) errors.push('approval_reference_required');
  if (!operator || operator.length > 200) errors.push('operator_required');
  if (change.expiresAt && !(change.expiresAt.getTime() > now.getTime())) errors.push('expiry_not_in_future');
  if (change.mode !== 'off' && change.scopes.length === 0) errors.push('scopes_required');
  const keys = new Set<string>();
  for (const scope of change.scopes) {
    if (!UUID.test(scope.orgUnitId)) errors.push('scope_org_unit_invalid');
    if (scope.kind === 'team' ? !scope.orgTeamId || !UUID.test(scope.orgTeamId) : scope.kind !== 'manager_overall' || scope.orgTeamId !== null)
      errors.push('scope_kind_invalid');
    if (scope.approvedRecipientPersonId !== null && !UUID.test(scope.approvedRecipientPersonId))
      errors.push('scope_recipient_invalid');
    const key = [scope.kind, scope.orgUnitId, scope.orgTeamId ?? ''].join(':');
    if (keys.has(key)) errors.push('scope_duplicate');
    keys.add(key);
  }
  if (change.mode === 'deliver') {
    if (!change.expiresAt) errors.push('deliver_requires_expiry');
    if (!change.scopes.some((s) => s.approvedRecipientPersonId)) errors.push('deliver_requires_approved_recipient');
    if (change.expiresAt && change.expiresAt.getTime() > now.getTime() + PULSE_REPORT_DELIVER_MAX_EXPIRY_MS)
      errors.push('deliver_expiry_too_far');
  }
  return [...new Set(errors)];
}
