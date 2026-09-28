import { describe, expect, it } from 'vitest';
import { planEmployeeDeactivation, planEmployeeMove, planManagerPromotion, planTeamDeactivation, planTeamLeadPromotion, planUnitTransferDeactivation, validateActiveHierarchy, type ActiveHierarchyGraph } from './active-graph';

const tenantId = 'tenant-1';
const active = 'active';

function graph(): ActiveHierarchyGraph {
  return {
    tenantId,
    people: [
      { id: 'manager-a', tenantId, primaryRole: 'manager', lifecycleStatus: active },
      { id: 'manager-b', tenantId, primaryRole: 'manager', lifecycleStatus: active },
      { id: 'lead-a', tenantId, primaryRole: 'team_lead', lifecycleStatus: active },
      { id: 'employee-a', tenantId, primaryRole: 'employee', lifecycleStatus: active },
      { id: 'employee-b', tenantId, primaryRole: 'employee', lifecycleStatus: active },
      { id: 'employee-c', tenantId, primaryRole: 'employee', lifecycleStatus: active },
    ],
    units: [
      { id: 'unit-a', tenantId, managerPersonId: 'manager-a', lifecycleStatus: active },
      { id: 'unit-b', tenantId, managerPersonId: 'manager-b', lifecycleStatus: active },
    ],
    teams: [{ id: 'team-a', tenantId, unitId: 'unit-a', teamLeadPersonId: 'lead-a', lifecycleStatus: active }],
    placements: [
      { id: 'placement-a', tenantId, employeePersonId: 'employee-a', unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: active },
      { id: 'placement-b', tenantId, employeePersonId: 'employee-b', unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: active },
      { id: 'placement-c', tenantId, employeePersonId: 'employee-c', unitId: 'unit-b', teamId: null, lifecycleStatus: active },
    ],
  };
}

describe('active hierarchy move planner', () => {
  it('moves an Employee from a Team to direct membership in another Unit', () => {
    const plan = planEmployeeMove(graph(), 'employee-a', 'unit-b', null);
    expect(plan).toEqual({ ok: true, placementId: 'placement-a',
      before: { unitId: 'unit-a', teamId: 'team-a' },
      after: { unitId: 'unit-b', teamId: null } });
  });

  it('preserves an active Team minimum after the move', () => {
    const before = graph();
    before.placements = before.placements.filter((p) => p.employeePersonId !== 'employee-b');
    before.people = before.people.filter((p) => p.id !== 'employee-b');
    expect(planEmployeeMove(before, 'employee-a', 'unit-b', null))
      .toMatchObject({ ok: false, issues: [{ code: 'active_team_without_employee', entityId: 'team-a' }] });
  });

  it('preserves a Unit subordinate when its only direct Employee leaves', () => {
    const before = graph();
    const result = planEmployeeMove(before, 'employee-c', 'unit-a', 'team-a');
    expect(result).toMatchObject({ ok: false, issues: [{ code: 'active_unit_without_subordinate', entityId: 'unit-b' }] });
  });

  it('rejects cross-tenant and inconsistent target Team references', () => {
    const before = graph();
    before.units.push({ id: 'foreign-unit', tenantId: 'tenant-2', managerPersonId: null, lifecycleStatus: active });
    expect(planEmployeeMove(before, 'employee-a', 'foreign-unit', null))
      .toEqual({ ok: false, issues: [{ code: 'active_target_unit_required', entityId: 'foreign-unit' }] });
    expect(planEmployeeMove(before, 'employee-a', 'unit-b', 'team-a'))
      .toEqual({ ok: false, issues: [{ code: 'active_target_team_required', entityId: 'team-a' }] });
  });

  it('detects duplicate homes and an unassigned active Team Lead', () => {
    const before = graph();
    before.placements.push({ ...before.placements[0]!, id: 'duplicate-placement' });
    before.people.push({ id: 'lead-unassigned', tenantId, primaryRole: 'team_lead', lifecycleStatus: active });
    expect(validateActiveHierarchy(before)).toEqual(expect.arrayContaining([
      { code: 'active_person_multiple_homes', entityId: 'employee-a' },
      { code: 'active_person_without_home', entityId: 'lead-unassigned' },
    ]));
  });
});

describe('Team Lead promotion planner', () => {
  it('requires an explicit action for the previous Lead', () => {
    expect(planTeamLeadPromotion(graph(), 'team-a', 'employee-a', '' as never))
      .toEqual({ ok: false, issues: [{ code: 'previous_lead_action_required', entityId: 'team-a' }] });
  });

  it.each(['become_employee', 'deactivate'] as const)('promotes with previous Lead action %s', (action) => {
    expect(planTeamLeadPromotion(graph(), 'team-a', 'employee-a', action)).toMatchObject({
      ok: true, teamId: 'team-a', newLeadPersonId: 'employee-a',
      previousLeadPersonId: 'lead-a', previousLeadAction: action,
    });
  });

  it('rejects promotion if it leaves the active Team without an Employee', () => {
    const before = graph();
    before.placements = before.placements.filter((p) => p.employeePersonId !== 'employee-b');
    before.people = before.people.filter((p) => p.id !== 'employee-b');
    expect(planTeamLeadPromotion(before, 'team-a', 'employee-a', 'deactivate'))
      .toMatchObject({ ok: false, issues: [{ code: 'active_team_without_employee', entityId: 'team-a' }] });
  });

  it('requires an Employee in the same active Team', () => {
    expect(planTeamLeadPromotion(graph(), 'team-a', 'employee-c', 'become_employee'))
      .toEqual({ ok: false, issues: [{ code: 'same_team_active_employee_required', entityId: 'employee-c' }] });
  });
});

describe('Manager promotion planner', () => {
  it('requires an explicit action for the previous Manager', () => {
    expect(planManagerPromotion(graph(), 'unit-b', 'employee-c', '' as never))
      .toEqual({ ok: false, issues: [{ code: 'previous_manager_action_required', entityId: 'unit-b' }] });
  });

  it('lets the previous Manager become a direct Employee', () => {
    expect(planManagerPromotion(graph(), 'unit-b', 'employee-c', 'become_employee'))
      .toMatchObject({ ok: true, previousManagerPersonId: 'manager-b',
        promotedPlacementId: 'placement-c', previousManagerAction: 'become_employee' });
  });

  it('rejects deactivation when the Unit would have no subordinate', () => {
    expect(planManagerPromotion(graph(), 'unit-b', 'employee-c', 'deactivate'))
      .toMatchObject({ ok: false, issues: [{ code: 'active_unit_without_subordinate', entityId: 'unit-b' }] });
  });

  it('permits explicit deactivation if another subordinate remains', () => {
    const before = graph();
    before.people.push({ id: 'employee-d', tenantId, primaryRole: 'employee', lifecycleStatus: active });
    before.placements.push({ id: 'placement-d', tenantId, employeePersonId: 'employee-d',
      unitId: 'unit-b', teamId: null, lifecycleStatus: active });
    expect(planManagerPromotion(before, 'unit-b', 'employee-c', 'deactivate'))
      .toMatchObject({ ok: true, previousManagerAction: 'deactivate' });
  });

  it('requires a same-Unit active Employee', () => {
    expect(planManagerPromotion(graph(), 'unit-b', 'employee-a', 'become_employee'))
      .toEqual({ ok: false, issues: [{ code: 'same_unit_active_employee_required', entityId: 'employee-a' }] });
  });
});

describe('Employee deactivation planner', () => {
  it('ends the Employee placement when active minimums remain satisfied', () => {
    expect(planEmployeeDeactivation(graph(), 'employee-a'))
      .toEqual({ ok: true, placementIds: ['placement-a'] });
  });

  it('rejects deactivation of the final Team Employee', () => {
    const before = graph();
    before.people = before.people.filter((person) => person.id !== 'employee-b');
    before.placements = before.placements.filter((placement) => placement.employeePersonId !== 'employee-b');
    expect(planEmployeeDeactivation(before, 'employee-a')).toMatchObject({
      ok: false, issues: [{ code: 'active_team_without_employee', entityId: 'team-a' }],
    });
  });

  it('rejects deactivation of the final Unit subordinate', () => {
    expect(planEmployeeDeactivation(graph(), 'employee-c')).toMatchObject({
      ok: false, issues: [{ code: 'active_unit_without_subordinate', entityId: 'unit-b' }],
    });
  });
});

describe('Team deactivation planner', () => {
  it.each(['become_employee', 'deactivate'] as const)(
    'moves Team Employees to direct Unit membership with explicit Lead action %s', (action) => {
      expect(planTeamDeactivation(graph(), 'team-a', action)).toMatchObject({
        ok: true, unitId: 'unit-a', leadPersonId: 'lead-a',
        placementIds: ['placement-a', 'placement-b'], leadAction: action,
      });
    },
  );

  it('requires an explicit action for the previous Lead', () => {
    expect(planTeamDeactivation(graph(), 'team-a', '' as never)).toEqual({
      ok: false, issues: [{ code: 'previous_lead_action_required', entityId: 'team-a' }],
    });
  });

  it('rejects an inactive or foreign Team', () => {
    const before = graph();
    before.teams[0]!.lifecycleStatus = 'inactive';
    expect(planTeamDeactivation(before, 'team-a', 'deactivate')).toEqual({
      ok: false, issues: [{ code: 'active_team_lead_required', entityId: 'team-a' }],
    });
  });
});

describe('Unit transfer deactivation planner', () => {
  it.each(['become_employee', 'deactivate'] as const)(
    'moves active Teams and placements into another Unit with Manager action %s', (action) => {
      expect(planUnitTransferDeactivation(graph(), 'unit-a', 'unit-b', action)).toMatchObject({
        ok: true, sourceUnitId: 'unit-a', targetUnitId: 'unit-b',
        managerPersonId: 'manager-a', managerAction: action,
        teamIds: ['team-a'], placements: [
          { id: 'placement-a', teamId: 'team-a' },
          { id: 'placement-b', teamId: 'team-a' },
        ],
      });
    },
  );

  it('rejects a missing or same target Unit', () => {
    expect(planUnitTransferDeactivation(graph(), 'unit-a', 'unit-a', 'deactivate'))
      .toEqual({ ok: false, issues: [{ code: 'distinct_target_unit_required', entityId: 'unit-a' }] });
    expect(planUnitTransferDeactivation(graph(), 'unit-a', 'missing', 'deactivate'))
      .toEqual({ ok: false, issues: [{ code: 'active_target_unit_required', entityId: 'missing' }] });
  });

  it('requires explicit disposition of the old Manager', () => {
    expect(planUnitTransferDeactivation(graph(), 'unit-a', 'unit-b', '' as never))
      .toEqual({ ok: false, issues: [{ code: 'previous_manager_action_required', entityId: 'unit-a' }] });
  });

  it('includes inactive placements linked to a moved Team for composite key integrity', () => {
    const before = graph();
    before.placements.push({ id: 'historical-team', tenantId, employeePersonId: 'employee-c',
      unitId: 'unit-a', teamId: 'team-a', lifecycleStatus: 'inactive' });
    before.placements.push({ id: 'historical-direct', tenantId, employeePersonId: 'employee-c',
      unitId: 'unit-a', teamId: null, lifecycleStatus: 'inactive' });
    const plan = planUnitTransferDeactivation(before, 'unit-a', 'unit-b', 'deactivate');
    expect(plan).toMatchObject({ ok: true, placements: expect.arrayContaining([
      { id: 'historical-team', teamId: 'team-a' },
    ]) });
    if (plan.ok) expect(plan.placements.some((row) => row.id === 'historical-direct')).toBe(false);
  });
});
