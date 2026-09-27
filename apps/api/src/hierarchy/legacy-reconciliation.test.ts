import { describe, expect, it } from 'vitest';
import { reconcileLegacyHierarchy, type LegacyReconciliationInput } from './legacy-reconciliation';

const tenantId = 'tenant-a';
const teamId = 'legacy-team-a';

function input(): LegacyReconciliationInput {
  return {
    tenantId,
    legacyTeams: [{ id: teamId, name: 'Engineering', managerSlackUserId: 'U-MANAGER' }],
    memberships: [{ teamId, userId: 'employee-a', role: 'member', leftAt: null, userTenantId: tenantId }],
    people: [
      { id: 'employee-a', primaryRole: 'employee', lifecycleStatus: 'active' },
      { id: 'manager-a', primaryRole: 'manager', lifecycleStatus: 'active' },
    ],
    slackAccounts: [{ userId: 'manager-a', externalWorkspaceId: 'T-1',
      externalUserId: 'U-MANAGER', linkStatus: 'linked' }],
    orgTeams: [], orgUnits: [], placements: [],
  };
}

describe('legacy hierarchy reconciliation', () => {
  it('reports exact evidence while requiring explicit Unit and Lead confirmation', () => {
    const report = reconcileLegacyHierarchy(input(), '2026-09-26T00:00:00.000Z');
    expect(report.readOnly).toBe(true);
    expect(report.counts).toEqual({ legacyTeams: 1, activeMemberships: 1,
      orgTeams: 0, orgUnits: 0, teamsWithLegacyMarker: 0, teamsRequiringReview: 1 });
    expect(report.teams[0]).toMatchObject({
      activeMemberUserIds: ['employee-a'],
      managerCandidates: [{ personId: 'manager-a', workspaceId: 'T-1', role: 'manager' }],
      mappedOrgTeamId: null,
    });
    expect(report.teams[0]?.issues).toEqual(expect.arrayContaining([
      'team_mapping_marker_missing', 'unit_manager_and_team_lead_confirmation_required',
    ]));
  });

  it('quarantines ambiguous Slack owner and unprovisioned or cross-tenant members', () => {
    const source = input();
    source.slackAccounts.push({ userId: 'manager-b', externalWorkspaceId: 'T-2',
      externalUserId: 'U-MANAGER', linkStatus: 'linked' });
    source.memberships.push({ teamId, userId: 'missing-person', role: 'member',
      leftAt: null, userTenantId: 'tenant-b' });
    const issues = reconcileLegacyHierarchy(source).teams[0]?.issues;
    expect(issues).toEqual(expect.arrayContaining([
      'manager_slack_id_ambiguous', 'member_person_not_provisioned',
      'membership_cross_tenant_or_missing_user',
    ]));
  });

  it('finds an existing deterministic Team marker but detects membership drift', () => {
    const source = input();
    source.orgTeams.push({ id: 'org-team-a', customerTeamKey: `legacy:${teamId}`,
      unitId: 'unit-a', lifecycleStatus: 'draft' });
    source.orgUnits.push({ id: 'unit-a', customerUnitKey: 'ENG', lifecycleStatus: 'draft' });
    const report = reconcileLegacyHierarchy(source);
    expect(report.counts.teamsWithLegacyMarker).toBe(1);
    expect(report.teams[0]).toMatchObject({ mappedOrgTeamId: 'org-team-a', mappedOrgUnitKey: 'ENG',
      issues: expect.arrayContaining(['mapped_membership_count_or_identity_mismatch']) });
  });

  it('ignores ended legacy memberships in active counts', () => {
    const source = input();
    source.memberships.push({ teamId, userId: 'former', role: 'member',
      leftAt: new Date(), userTenantId: tenantId });
    const report = reconcileLegacyHierarchy(source);
    expect(report.counts.activeMemberships).toBe(1);
    expect(report.teams[0]?.activeMemberUserIds).toEqual(['employee-a']);
  });
});
