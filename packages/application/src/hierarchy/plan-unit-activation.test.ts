import { describe, expect, it } from 'vitest';
import { planUnitActivation, type UnitActivationGraph } from './plan-unit-activation';

const tenantId = 'tenant-1';
const base: UnitActivationGraph = {
  unit: { id: 'unit-1', tenantId, lifecycleStatus: 'draft', managerPersonId: 'manager-1' },
  people: [
    { id: 'manager-1', tenantId, primaryRole: 'manager', lifecycleStatus: 'draft', slackLinked: true },
    { id: 'employee-1', tenantId, primaryRole: 'employee', lifecycleStatus: 'draft', slackLinked: true },
  ],
  teams: [],
  placements: [
    { id: 'placement-1', tenantId, unitId: 'unit-1', teamId: null, employeePersonId: 'employee-1', lifecycleStatus: 'draft' },
  ],
};

describe('planUnitActivation', () => {
  it('accepts a Unit with direct Employees and no Teams', () => {
    expect(planUnitActivation(base)).toMatchObject({
      ready: true, activatePersonIds: ['employee-1', 'manager-1'], activateTeamIds: [], pendingPersonIds: [], issues: [],
    });
  });

  it('leaves unmatched colleagues in draft while activating ready direct Employees', () => {
    const graph: UnitActivationGraph = {
      ...base,
      people: [...base.people, { id: 'employee-2', tenantId, primaryRole: 'employee', lifecycleStatus: 'draft', slackLinked: false }],
      placements: [...base.placements, {
        id: 'placement-2', tenantId, unitId: 'unit-1', teamId: null, employeePersonId: 'employee-2', lifecycleStatus: 'draft',
      }],
    };
    expect(planUnitActivation(graph)).toMatchObject({
      ready: true, activatePersonIds: ['employee-1', 'manager-1'], pendingPersonIds: ['employee-2'],
    });
  });

  it('includes ready scoped advisors and Leadership while preserving unlinked advisors as drafts', () => {
    const graph: UnitActivationGraph = {
      ...base,
      people: [...base.people,
        { id: 'hr-1', tenantId, primaryRole: 'hr', lifecycleStatus: 'draft', slackLinked: true },
        { id: 'hrbp-1', tenantId, primaryRole: 'hrbp', lifecycleStatus: 'draft', slackLinked: false },
        { id: 'leadership-1', tenantId, primaryRole: 'leadership', lifecycleStatus: 'draft', slackLinked: true },
      ],
      scopedPeople: [
        { id: 'hr-1', role: 'hr', assignmentId: 'assignment-1' },
        { id: 'hrbp-1', role: 'hrbp' },
        { id: 'leadership-1', role: 'leadership' },
      ],
    };
    expect(planUnitActivation(graph)).toMatchObject({
      ready: true,
      activatePersonIds: ['employee-1', 'hr-1', 'leadership-1', 'manager-1'],
      pendingPersonIds: ['hrbp-1'],
    });
  });

  it('keeps an incomplete Team draft while activating a valid direct Unit population', () => {
    const graph: UnitActivationGraph = {
      ...base,
      people: [...base.people, { id: 'lead-1', tenantId, primaryRole: 'team_lead', lifecycleStatus: 'draft', slackLinked: true }],
      teams: [{ id: 'team-1', tenantId, unitId: 'unit-1', lifecycleStatus: 'draft', teamLeadPersonId: 'lead-1' }],
    };
    expect(planUnitActivation(graph)).toMatchObject({
      ready: true, activatePersonIds: ['employee-1', 'manager-1'], activateTeamIds: [], pendingPersonIds: ['lead-1'],
    });
  });

  it('fails closed on cross-tenant or duplicate placements', () => {
    const crossTenant: UnitActivationGraph = {
      ...base,
      placements: [{ ...base.placements[0]!, tenantId: 'tenant-2' }],
    };
    expect(planUnitActivation(crossTenant)).toMatchObject({
      ready: false, activatePersonIds: [], issues: expect.arrayContaining([{ code: 'invalid_placement_scope', entityId: 'placement-1' }]),
    });

    const duplicate: UnitActivationGraph = {
      ...base,
      placements: [...base.placements, { ...base.placements[0]!, id: 'placement-2' }],
    };
    expect(planUnitActivation(duplicate)).toMatchObject({
      ready: false, activatePersonIds: [], issues: expect.arrayContaining([{ code: 'duplicate_employee_placement', entityId: 'employee-1' }]),
    });

    const crossTenantPerson: UnitActivationGraph = {
      ...base,
      people: base.people.map((person) => person.id === 'employee-1' ? { ...person, tenantId: 'tenant-2' } : person),
    };
    expect(planUnitActivation(crossTenantPerson)).toMatchObject({
      ready: false, activatePersonIds: [], issues: expect.arrayContaining([{ code: 'invalid_employee', entityId: 'placement-1' }]),
    });
  });
});
