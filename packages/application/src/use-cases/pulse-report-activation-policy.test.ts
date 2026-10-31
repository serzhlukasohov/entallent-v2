import { describe, expect, it } from 'vitest';
import { decidePulseReportActivation, normalizePulseReportActivationChange, validatePulseReportActivationChange } from './pulse-report-activation-policy';

const now = new Date('2026-11-01T00:00:00Z'), later = new Date('2026-11-02T00:00:00Z');
const P = '00000000-0000-4000-8000-0000000000a1', Q = '00000000-0000-4000-8000-0000000000a2';
const S = '00000000-0000-4000-8000-0000000000b1';
const base = { obligationScopeId: S, now, frozenRoute: { personId: P, scopeId: S } };

describe('RPT-10 activation decision', () => {
  it('inert default: no control or off control holds formation and delivery', () => {
    expect(decidePulseReportActivation({ ...base, control: null, scope: null })).toEqual({ observe: false, deliver: false, holdReason: 'no_control' });
    expect(decidePulseReportActivation({ ...base, control: { mode: 'off', expiresAt: later }, scope: { approvedRecipientPersonId: P } }))
      .toEqual({ observe: false, deliver: false, holdReason: 'control_off' });
  });
  it('unlisted scope is not observed, formed or sent', () => {
    expect(decidePulseReportActivation({ ...base, control: { mode: 'deliver', expiresAt: later }, scope: null }))
      .toEqual({ observe: false, deliver: false, holdReason: 'scope_not_allowlisted' });
  });
  it('observe forms but never sends', () => {
    expect(decidePulseReportActivation({ ...base, control: { mode: 'observe', expiresAt: null }, scope: { approvedRecipientPersonId: P } }))
      .toEqual({ observe: true, deliver: false, holdReason: 'observe_only' });
  });
  it('deliver sends only for the approved frozen recipient before expiry', () => {
    const control = { mode: 'deliver' as const, expiresAt: later };
    expect(decidePulseReportActivation({ ...base, control, scope: { approvedRecipientPersonId: P } })).toEqual({ observe: true, deliver: true, holdReason: null });
    expect(decidePulseReportActivation({ ...base, control, scope: { approvedRecipientPersonId: Q } })).toMatchObject({ deliver: false, holdReason: 'recipient_mismatch' });
    expect(decidePulseReportActivation({ ...base, frozenRoute: { personId: P, scopeId: Q }, control, scope: { approvedRecipientPersonId: P } }))
      .toMatchObject({ deliver: false, holdReason: 'recipient_mismatch' });
    expect(decidePulseReportActivation({ ...base, control, scope: { approvedRecipientPersonId: null } })).toEqual({ observe: true, deliver: false, holdReason: 'recipient_not_approved' });
    expect(decidePulseReportActivation({ ...base, frozenRoute: null, control, scope: { approvedRecipientPersonId: P } })).toMatchObject({ observe: true, deliver: false, holdReason: 'snapshot_missing' });
    expect(decidePulseReportActivation({ ...base, control: { mode: 'deliver', expiresAt: null }, scope: { approvedRecipientPersonId: P } })).toMatchObject({ deliver: false, holdReason: 'deliver_expiry_missing' });
  });
  it('expired control holds everything at DB time, including the boundary instant', () => {
    for (const expiresAt of [now, new Date(now.getTime() - 1)])
      expect(decidePulseReportActivation({ ...base, control: { mode: 'deliver', expiresAt }, scope: { approvedRecipientPersonId: P } }))
        .toEqual({ observe: false, deliver: false, holdReason: 'control_expired' });
  });
  it('Q1: a hold after some parts have receipts is reported as partial_delivery_held, never an ordinary hold', () => {
    expect(decidePulseReportActivation({ ...base, deliveredParts: 1, control: { mode: 'off', expiresAt: null }, scope: null }))
      .toEqual({ observe: false, deliver: false, holdReason: 'partial_delivery_held' });
    expect(decidePulseReportActivation({ ...base, deliveredParts: 1, control: { mode: 'deliver', expiresAt: later }, scope: { approvedRecipientPersonId: P } }))
      .toEqual({ observe: true, deliver: true, holdReason: null });
  });
  it('unknown mode fails closed', () => {
    expect(decidePulseReportActivation({ ...base, control: { mode: 'send' as never, expiresAt: later }, scope: { approvedRecipientPersonId: P } }).deliver).toBe(false);
  });
});

describe('RPT-10 activation change validation', () => {
  const change = {
    tenantId: '00000000-0000-4000-8000-000000000001', expectedRevision: 0, mode: 'deliver' as const, expiresAt: later,
    approvalReference: 'CHG-1', operator: 'ops', scopes: [{ kind: 'team' as const, orgUnitId: S, orgTeamId: Q, approvedRecipientPersonId: P }],
  };
  it('accepts a complete deliver change', () => expect(validatePulseReportActivationChange(change, now)).toEqual([]));
  it('refuses deliver without expiry or approved recipients', () => {
    expect(validatePulseReportActivationChange({ ...change, expiresAt: null }, now)).toContain('deliver_requires_expiry');
    expect(validatePulseReportActivationChange({ ...change, scopes: [{ ...change.scopes[0]!, approvedRecipientPersonId: null }] }, now)).toContain('deliver_requires_approved_recipient');
  });
  it('Q10: deliver expiry is bounded to 30 days from DB now', () => {
    expect(validatePulseReportActivationChange({ ...change, expiresAt: new Date(now.getTime() + 30 * 86_400_000) }, now)).toEqual([]);
    expect(validatePulseReportActivationChange({ ...change, expiresAt: new Date(now.getTime() + 30 * 86_400_000 + 1) }, now)).toContain('deliver_expiry_too_far');
  });
  it('Q14: duplicate scopes are detected across UUID case', () => {
    const upper = { ...change.scopes[0]!, orgUnitId: S.toUpperCase(), orgTeamId: Q.toUpperCase() };
    expect(validatePulseReportActivationChange({ ...change, scopes: [change.scopes[0]!, upper] }, now)).toContain('scope_duplicate');
    expect(normalizePulseReportActivationChange({ ...change, tenantId: change.tenantId.toUpperCase(), scopes: [upper] }).scopes[0]).toMatchObject({ orgUnitId: S, orgTeamId: Q });
  });
  it('requires approval reference, operator, a past-proof expiry and well-formed unique scopes', () => {
    const errors = validatePulseReportActivationChange({
      ...change, approvalReference: ' ', operator: '', expiresAt: now, expectedRevision: -1,
      scopes: [change.scopes[0]!, change.scopes[0]!, { kind: 'manager_overall', orgUnitId: S, orgTeamId: Q, approvedRecipientPersonId: null }],
    }, now);
    expect(errors).toEqual(expect.arrayContaining(['approval_reference_required', 'operator_required', 'expiry_not_in_future', 'expected_revision_invalid', 'scope_duplicate', 'scope_kind_invalid']));
    expect(validatePulseReportActivationChange({ ...change, mode: 'observe', scopes: [] }, now)).toContain('scopes_required');
    expect(validatePulseReportActivationChange({ ...change, mode: 'off', expiresAt: null, scopes: [] }, now)).toEqual([]);
  });
});
