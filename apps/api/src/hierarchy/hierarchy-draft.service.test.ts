import { describe, expect, it } from 'vitest';
import { auditLogs, channelAccounts, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes, orgTeams, orgUnits, people, users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { HierarchyAuthorizationError, HierarchyDraftService } from './hierarchy-draft.service';

describe('HierarchyDraftService', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const personId = '00000000-0000-0000-0000-000000000002';
  const input = {
    customerEmployeeId: ' E-1 ', workEmail: ' Person@Example.com ', displayName: ' Person ', primaryRole: 'employee' as const,
  };

  function setup(authorized = true, validUnit = true) {
    const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
    const tx = {
      insert: (table: unknown) => ({
        values: (value: Record<string, unknown>) => {
          writes.push({ table, value });
          if (table === auditLogs) return Promise.resolve();
          return { returning: async () => [table === users ? { id: personId } : { id: personId, ...value, lifecycleStatus: 'draft' }] };
        },
      }),
      select: () => ({ from: (table: unknown) => ({
        innerJoin: () => ({ where: () => ({ limit: async () => authorized ? [{ id: personId }] : [] }) }),
        where: () => ({ limit: async () => table === orgUnits && !validUnit ? [] : [{ id: personId }] }),
      }) }),
    };
    const db = {
      client: {
        transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
        insert: tx.insert,
      },
    } as unknown as DatabaseService;
    return { service: new HierarchyDraftService(db), writes };
  }

  it('creates an inactive runtime user and an audited draft Person atomically', async () => {
    const { service, writes } = setup();
    const result = await service.createPerson(tenantId, input, { type: 'internal_operator', operatorId: 'operator-1' });

    expect(result.lifecycleStatus).toBe('draft');
    expect(writes.find((write) => write.table === users)?.value).toMatchObject({
      tenantId, status: 'inactive', proactiveMessagingEnabled: false,
    });
    expect(writes.find((write) => write.table === people)?.value).toMatchObject({
      id: personId, tenantId, customerEmployeeId: 'E-1', workEmail: 'person@example.com', pulseParticipant: true,
    });
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({
      action: 'org.person.create_draft', actorType: 'internal_operator', actorId: 'operator-1', resourceId: personId,
    });
  });

  it('rejects a Company Admin outside the active capability boundary and audits the rejection', async () => {
    const { service, writes } = setup(false);
    await expect(service.createPerson(tenantId, input, { type: 'company_admin', personId })).rejects.toThrow(HierarchyAuthorizationError);
    expect(writes.some((write) => write.table === users)).toBe(false);
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({
      action: 'org.person.create_draft.rejected', reason: 'unauthorized', actorType: 'company_admin', actorId: personId,
    });
  });

  it('creates draft Unit and Team records with audited stable keys', async () => {
    const { service, writes } = setup();
    await service.createUnit(tenantId, {
      customerUnitKey: ' U-1 ', name: ' Sales ', managerPersonId: personId,
    }, { type: 'internal_operator', operatorId: 'operator-1' });
    await service.createTeam(tenantId, {
      customerTeamKey: ' T-1 ', name: ' North ', unitId: personId, teamLeadPersonId: personId,
    }, { type: 'internal_operator', operatorId: 'operator-1' });

    expect(writes.find((write) => write.table === orgUnits)?.value).toMatchObject({
      tenantId, customerUnitKey: 'U-1', name: 'Sales', managerPersonId: personId,
    });
    expect(writes.find((write) => write.table === orgTeams)?.value).toMatchObject({
      tenantId, customerTeamKey: 'T-1', name: 'North', unitId: personId, teamLeadPersonId: personId,
    });
    expect(writes.filter((write) => write.table === auditLogs).map((write) => write.value['action'])).toEqual([
      'org.unit.create_draft', 'org.team.create_draft',
    ]);
  });

  it('rejects Team creation when the parent Unit is outside the tenant', async () => {
    const { service, writes } = setup(true, false);
    await expect(service.createTeam(tenantId, {
      customerTeamKey: 'T-1', name: 'North', unitId: personId,
    }, { type: 'internal_operator', operatorId: 'operator-1' })).rejects.toThrow('unitId: invalid_unit');
    expect(writes.some((write) => write.table === orgTeams)).toBe(false);
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({
      action: 'org.team.create_draft.rejected', reason: 'unitId:invalid_unit',
    });
  });

  function setupUpdate(overrides: Map<unknown, Record<string, unknown>[]> = new Map()) {
    const rows = new Map<unknown, Record<string, unknown>[]>([
      [people, [{ id: personId, tenantId, customerEmployeeId: 'E-1', workEmail: 'old@example.com',
        displayName: 'Old', jobTitle: null, primaryRole: 'employee', lifecycleStatus: 'draft' }]],
      [orgUnits, [{ id: 'unit-1', tenantId, customerUnitKey: 'U-1', name: 'Old unit',
        managerPersonId: null, lifecycleStatus: 'draft' }]],
      [orgTeams, [{ id: 'team-1', tenantId, customerTeamKey: 'T-1', name: 'Old team',
        unitId: 'unit-1', teamLeadPersonId: null, lifecycleStatus: 'draft' }]],
      [orgEmployeePlacements, []], [orgAdvisorAssignments, []], [orgHrbpScopes, []], [channelAccounts, []],
    ]);
    for (const [table, values] of overrides) rows.set(table, values);
    const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
    const tx = {
      select: () => ({ from: (table: unknown) => ({ where: () => {
        const result = Promise.resolve(rows.get(table) ?? []);
        return { then: result.then.bind(result), limit: async () => (rows.get(table) ?? []).slice(0, 1),
          for: () => ({ limit: async () => (rows.get(table) ?? []).slice(0, 1),
            then: result.then.bind(result) }) };
      } }) }),
      update: (table: unknown) => ({ set: (value: Record<string, unknown>) => ({ where: () => {
        writes.push({ table, value });
        return { then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
          returning: async () => [{ ...(rows.get(table)?.[0] ?? {}), ...value }] };
      } }) }),
      insert: (table: unknown) => ({ values: (value: Record<string, unknown>) => {
        writes.push({ table, value });
        if (table === auditLogs) return Promise.resolve();
        return { returning: async () => [{ id: 'new-placement', ...value }] };
      } }),
    };
    const client = { transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
      insert: tx.insert };
    return { service: new HierarchyDraftService({ client } as unknown as DatabaseService), writes };
  }

  it('updates only a draft Person and audits the previous and resulting values', async () => {
    const { service, writes } = setupUpdate();
    await service.updatePerson(tenantId, personId, input, { type: 'internal_operator', operatorId: 'operator-1' });
    expect(writes.find((write) => write.table === people)?.value).toMatchObject({
      workEmail: 'person@example.com', displayName: 'Person', primaryRole: 'employee', pulseParticipant: true,
    });
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({
      action: 'org.person.update_draft', metadata: { before: { workEmail: 'old@example.com' },
        after: { workEmail: 'person@example.com' } },
    });
  });

  it('requires unlinking Slack before changing a draft Person email', async () => {
    const { service, writes } = setupUpdate(new Map([[channelAccounts, [{ id: 'link-1' }]]]));
    await expect(service.updatePerson(tenantId, personId, input,
      { type: 'internal_operator', operatorId: 'operator-1' }))
      .rejects.toMatchObject({ field: 'workEmail', code: 'unlink_slack_first' });
    expect(writes.some((write) => write.table === people)).toBe(false);
  });

  it('rejects a draft Person role change while an incompatible placement exists', async () => {
    const { service, writes } = setupUpdate(new Map<unknown, Record<string, unknown>[]>([
      [orgUnits, []], [orgTeams, []], [orgEmployeePlacements, [{ id: 'placement-1' }]],
    ]));
    await expect(service.updatePerson(tenantId, personId, { ...input, workEmail: 'old@example.com', primaryRole: 'manager' },
      { type: 'internal_operator', operatorId: 'operator-1' }))
      .rejects.toMatchObject({ field: 'primaryRole', code: 'employee_placement_reference' });
    expect(writes.some((write) => write.table === people)).toBe(false);
  });

  it('rejects edits to an active Unit', async () => {
    const { service, writes } = setupUpdate(new Map([[orgUnits, [{ id: 'unit-1', tenantId, lifecycleStatus: 'active' }]]]));
    await expect(service.updateUnit(tenantId, 'unit-1', { customerUnitKey: 'U-1', name: 'New unit' },
      { type: 'internal_operator', operatorId: 'operator-1' }))
      .rejects.toMatchObject({ field: 'unitId', code: 'draft_unit_required' });
    expect(writes.some((write) => write.table === orgUnits)).toBe(false);
  });

  it('updates an audited draft Unit after validating its Manager reference', async () => {
    const { service, writes } = setupUpdate();
    await service.updateUnit(tenantId, 'unit-1', { customerUnitKey: 'U-2', name: 'New unit' },
      { type: 'internal_operator', operatorId: 'operator-1' });
    expect(writes.find((write) => write.table === orgUnits)?.value)
      .toMatchObject({ customerUnitKey: 'U-2', name: 'New unit', managerPersonId: null });
    expect(writes.find((write) => write.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.unit.update_draft' });
  });

  it('detaches and reattaches draft Team placements when its Unit changes', async () => {
    const { service, writes } = setupUpdate(new Map<unknown, Record<string, unknown>[]>([
      [orgUnits, [{ id: 'unit-2', tenantId, lifecycleStatus: 'draft' }]],
      [orgEmployeePlacements, [{ id: 'placement-1', lifecycleStatus: 'draft' }]],
    ]));
    await service.updateTeam(tenantId, 'team-1', { customerTeamKey: 'T-1', name: 'New team', unitId: 'unit-2' },
      { type: 'internal_operator', operatorId: 'operator-1' });
    expect(writes.filter((write) => [orgEmployeePlacements, orgTeams].includes(write.table as never))
      .map((write) => write.value)).toEqual([
      expect.objectContaining({ teamId: null, unitId: 'unit-2' }),
      expect.objectContaining({ unitId: 'unit-2', name: 'New team' }),
      expect.objectContaining({ teamId: 'team-1' }),
    ]);
  });

  it('rejects moving a draft Team if an active placement still references it', async () => {
    const { service, writes } = setupUpdate(new Map<unknown, Record<string, unknown>[]>([
      [orgUnits, [{ id: 'unit-2', tenantId, lifecycleStatus: 'draft' }]],
      [orgEmployeePlacements, [{ id: 'placement-1', lifecycleStatus: 'active' }]],
    ]));
    await expect(service.updateTeam(tenantId, 'team-1', {
      customerTeamKey: 'T-1', name: 'New team', unitId: 'unit-2',
    }, { type: 'internal_operator', operatorId: 'operator-1' }))
      .rejects.toMatchObject({ field: 'unitId', code: 'active_placement_reference' });
    expect(writes.some((write) => write.table === orgTeams)).toBe(false);
  });

  it('moves historical inactive placement references with a draft Team', async () => {
    const { service, writes } = setupUpdate(new Map<unknown, Record<string, unknown>[]>([
      [orgUnits, [{ id: 'unit-2', tenantId, lifecycleStatus: 'draft' }]],
      [orgEmployeePlacements, [{ id: 'placement-1', lifecycleStatus: 'inactive' }]],
    ]));
    await service.updateTeam(tenantId, 'team-1', { customerTeamKey: 'T-1', name: 'New team', unitId: 'unit-2' },
      { type: 'internal_operator', operatorId: 'operator-1' });
    expect(writes.filter((write) => write.table === orgEmployeePlacements)
      .map((write) => write.value)).toEqual([
      expect.objectContaining({ teamId: null, unitId: 'unit-2' }),
      expect.objectContaining({ teamId: 'team-1' }),
    ]);
  });

  it('creates a draft Employee placement in a selected Unit and Team', async () => {
    const { service, writes } = setupUpdate();
    const result = await service.replaceDraftPlacement(tenantId, personId, 'unit-1', 'team-1',
      { type: 'internal_operator', operatorId: 'operator-1' });
    expect(result).toMatchObject({ employeePersonId: personId, unitId: 'unit-1',
      teamId: 'team-1', lifecycleStatus: 'draft' });
    expect(writes.find((write) => write.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.employee_placement.replace_draft' });
  });

  it('removes a draft placement before a role correction', async () => {
    const { service, writes } = setupUpdate(new Map<unknown, Record<string, unknown>[]>([
      [orgEmployeePlacements, [{ id: 'placement-1', tenantId, employeePersonId: personId,
        unitId: 'unit-1', teamId: null, lifecycleStatus: 'draft' }]],
    ]));
    await expect(service.replaceDraftPlacement(tenantId, personId, null, null,
      { type: 'internal_operator', operatorId: 'operator-1' })).resolves.toBeNull();
    expect(writes.find((write) => write.table === orgEmployeePlacements)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });
  });

  it('rejects a target Team outside the selected Unit', async () => {
    const { service, writes } = setupUpdate(new Map<unknown, Record<string, unknown>[]>([[orgTeams, []]]));
    await expect(service.replaceDraftPlacement(tenantId, personId, 'unit-1', 'team-other',
      { type: 'internal_operator', operatorId: 'operator-1' }))
      .rejects.toMatchObject({ field: 'targetTeamId', code: 'invalid_team_for_unit' });
    expect(writes.some((write) => write.table === orgEmployeePlacements)).toBe(false);
  });

  function setupImport() {
    const writes: Array<{ table: unknown; value: unknown }> = [];
    const tx = {
      insert: (table: unknown) => ({ values: (value: unknown) => {
        writes.push({ table, value });
        return Promise.resolve();
      } }),
      select: () => ({ from: () => ({
        where: async () => [],
        innerJoin: () => ({ where: async () => [] }),
      }) }),
    };
    const client = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
      insert: tx.insert,
    };
    return { service: new HierarchyDraftService({ client } as unknown as DatabaseService), writes };
  }

  it('rejects a mixed-invalid CSV before any hierarchy insert', async () => {
    const { service, writes } = setupImport();
    await expect(service.importCsv(tenantId,
      'customerEmployeeId,workEmail,displayName,primaryRole,customerUnitKey,unitName\n' +
      'E-1,bad,Employee,employee,U-1,Unit One',
      { type: 'internal_operator', operatorId: 'operator-1' },
    )).rejects.toMatchObject({ errors: [expect.objectContaining({ field: 'workEmail', code: 'invalid' })] });
    expect(writes.map((write) => write.table)).toEqual([auditLogs]);
    expect(writes[0]?.value).toMatchObject({ action: 'org.csv.import.rejected', reason: 'csv_validation' });
  });

  it('writes a valid CSV as draft Person, Unit and placement batches in one transaction', async () => {
    const { service, writes } = setupImport();
    const result = await service.importCsv(tenantId,
      'customerEmployeeId,workEmail,displayName,primaryRole,customerUnitKey,unitName\n' +
      'M-1,m@example.com,Manager,manager,U-1,Unit One\n' +
      'E-1,e@example.com,Employee,employee,U-1,',
      { type: 'internal_operator', operatorId: 'operator-1' },
    );
    expect(result.personIds).toHaveLength(2);
    expect(result.unitIds).toHaveLength(1);
    expect(writes.find((write) => write.table === users)?.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId, status: 'inactive', proactiveMessagingEnabled: false }),
    ]));
    expect(writes.find((write) => write.table === people)?.value).toHaveLength(2);
    expect(writes.find((write) => write.table === orgUnits)?.value).toEqual([
      expect.objectContaining({ tenantId, customerUnitKey: 'U-1', name: 'Unit One', managerPersonId: result.personIds[0] }),
    ]);
    expect(writes.find((write) => write.table === orgEmployeePlacements)?.value).toEqual([
      expect.objectContaining({ employeePersonId: result.personIds[1], unitId: result.unitIds[0] }),
    ]);
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({ action: 'org.csv.import' });
  });
});
