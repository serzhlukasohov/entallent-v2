import { describe, expect, it } from 'vitest';
import { legacySourceFingerprint, type LegacyReconciliationInput } from './legacy-reconciliation';
import { LegacyBackfillValidationError, parseLegacyBackfillManifest,
  planLegacyDraftBackfill, type LegacyBackfillManifest } from './legacy-backfill-plan';

function source(): LegacyReconciliationInput {
  return {
    tenantId: 'tenant-a',
    legacyTeams: [{ id: 'old-team', name: 'Engineering', managerSlackUserId: 'U-MANAGER' }],
    memberships: [{ teamId: 'old-team', userId: 'employee-a', role: 'member',
      leftAt: null, userTenantId: 'tenant-a' }],
    people: [
      { id: 'manager-a', primaryRole: 'manager', lifecycleStatus: 'draft' },
      { id: 'lead-a', primaryRole: 'team_lead', lifecycleStatus: 'draft' },
      { id: 'employee-a', primaryRole: 'employee', lifecycleStatus: 'draft' },
    ],
    slackAccounts: [], orgTeams: [], orgUnits: [], placements: [],
  };
}

function manifest(input = source()): LegacyBackfillManifest {
  return { schemaVersion: 1, tenantId: input.tenantId,
    sourceFingerprint: legacySourceFingerprint(input),
    teams: [{ legacyTeamId: 'old-team', customerTeamKey: 'ENG-TEAM', teamName: 'Engineering',
      customerUnitKey: 'ENG', unitName: 'Engineering Unit', managerPersonId: 'manager-a',
      teamLeadPersonId: 'lead-a', memberPersonIds: ['employee-a'] }] };
}

describe('reviewed legacy draft backfill', () => {
  it('plans only draft inserts from an exact tenant, source, role and membership mapping', () => {
    const input = source();
    const plan = planLegacyDraftBackfill(input, manifest(input));
    expect(plan.counts).toEqual({ newUnits: 1, newTeams: 1, newPlacements: 1 });
    expect(plan.teams[0]).toMatchObject({ memberPersonIds: ['employee-a'],
      newPlacementPersonIds: ['employee-a'], existingId: null });
  });

  it('keeps the source fingerprint stable under row order but invalidates changed membership', () => {
    const input = source();
    const original = legacySourceFingerprint(input);
    input.memberships.push({ teamId: 'old-team', userId: 'employee-b', role: 'member',
      leftAt: null, userTenantId: 'tenant-a' });
    expect(legacySourceFingerprint(input)).not.toBe(original);
    expect(() => planLegacyDraftBackfill(input, { ...manifest(source()), sourceFingerprint: original }))
      .toThrow(LegacyBackfillValidationError);
  });

  it('rejects a partial or contradictory mapping without guessing an owner', () => {
    const input = source();
    const mapping = manifest(input);
    mapping.teams[0]!.teamLeadPersonId = 'manager-a';
    mapping.teams[0]!.memberPersonIds = [];
    try {
      planLegacyDraftBackfill(input, mapping);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(LegacyBackfillValidationError);
      expect((error as LegacyBackfillValidationError).issues).toEqual(expect.arrayContaining([
        'owner_roles_not_distinct:old-team', 'invalid_team_lead:old-team',
        'membership_mismatch:old-team', 'empty_team:old-team',
      ]));
    }
  });

  it('accepts an exact draft rerun without scheduling duplicate inserts', () => {
    const input = source();
    input.orgUnits.push({ id: 'unit-a', customerUnitKey: 'ENG', name: 'Engineering Unit',
      managerPersonId: 'manager-a', lifecycleStatus: 'draft' });
    input.orgTeams.push({ id: 'team-a', customerTeamKey: 'ENG-TEAM', name: 'Engineering',
      teamLeadPersonId: 'lead-a', unitId: 'unit-a', lifecycleStatus: 'draft' });
    input.placements.push({ employeePersonId: 'employee-a', unitId: 'unit-a', teamId: 'team-a',
      lifecycleStatus: 'draft' });
    const plan = planLegacyDraftBackfill(input, manifest(input));
    expect(plan.counts).toEqual({ newUnits: 0, newTeams: 0, newPlacements: 0 });
  });

  it('rejects existing placement drift and old marker conflicts', () => {
    const input = source();
    input.orgTeams.push({ id: 'marker', customerTeamKey: 'legacy:old-team', unitId: 'unit-other',
      lifecycleStatus: 'draft' });
    input.placements.push({ employeePersonId: 'employee-a', teamId: 'other-team',
      lifecycleStatus: 'draft' });
    expect(() => planLegacyDraftBackfill(input, manifest(input))).toThrow(LegacyBackfillValidationError);
  });

  it('rejects a Manager or Team Lead already owning another non-inactive structure', () => {
    const input = source();
    input.orgUnits.push({ id: 'other-unit', customerUnitKey: 'OTHER', name: 'Other',
      managerPersonId: 'manager-a', lifecycleStatus: 'draft' });
    input.orgTeams.push({ id: 'other-team', customerTeamKey: 'OTHER-TEAM', unitId: 'other-unit',
      name: 'Other', teamLeadPersonId: 'lead-a', lifecycleStatus: 'draft' });
    try {
      planLegacyDraftBackfill(input, manifest(input));
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(LegacyBackfillValidationError);
      expect((error as LegacyBackfillValidationError).issues).toEqual(expect.arrayContaining([
        'manager_already_owns_other_unit:manager-a',
        'lead_already_owns_other_team:lead-a',
      ]));
    }
  });

  it('parses only a complete versioned mapping document', () => {
    const parsed = parseLegacyBackfillManifest(manifest());
    expect(parsed.teams[0]?.customerUnitKey).toBe('ENG');
    expect(() => parseLegacyBackfillManifest({ schemaVersion: 1, tenantId: 'tenant-a', teams: [] }))
      .toThrow(LegacyBackfillValidationError);
  });

  it('keeps an explicitly quarantined test Team out of the new hierarchy', () => {
    const input = source();
    const approved = { ...manifest(input), teams: [],
      quarantinedTeams: [{ legacyTeamId: 'old-team', reason: 'test_fixture' as const }] };
    const plan = planLegacyDraftBackfill(input, parseLegacyBackfillManifest(approved));
    expect(plan.counts).toEqual({ newUnits: 0, newTeams: 0, newPlacements: 0 });
    expect(plan.quarantinedTeams).toEqual(approved.quarantinedTeams);
    expect(plan.teams).toEqual([]);
    input.memberships.push({ teamId: 'old-team', userId: 'new-member', role: 'member',
      leftAt: null, userTenantId: 'tenant-a' });
    expect(() => planLegacyDraftBackfill(input, approved)).toThrow(LegacyBackfillValidationError);
  });

  it('rejects missing, duplicate, and unknown quarantine classifications', () => {
    const input = source();
    const approved = { ...manifest(input), teams: [],
      quarantinedTeams: [{ legacyTeamId: 'old-team', reason: 'test_fixture' as const }] };
    expect(() => planLegacyDraftBackfill(input, { ...approved, quarantinedTeams: [] }))
      .toThrow(LegacyBackfillValidationError);
    expect(() => planLegacyDraftBackfill(input, { ...manifest(input),
      quarantinedTeams: approved.quarantinedTeams })).toThrow(LegacyBackfillValidationError);
    expect(() => planLegacyDraftBackfill(input, { ...approved,
      quarantinedTeams: [...approved.quarantinedTeams, approved.quarantinedTeams[0]!] }))
      .toThrow(LegacyBackfillValidationError);
    expect(() => planLegacyDraftBackfill(input, { ...approved,
      quarantinedTeams: [{ legacyTeamId: 'other-team', reason: 'test_fixture' }] }))
      .toThrow(LegacyBackfillValidationError);
    expect(() => parseLegacyBackfillManifest({ ...approved,
      quarantinedTeams: [{ legacyTeamId: 'old-team', reason: 'unreviewed' }] }))
      .toThrow(LegacyBackfillValidationError);
  });
});
