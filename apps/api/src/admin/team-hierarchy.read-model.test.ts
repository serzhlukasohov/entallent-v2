import { describe, expect, it, vi } from 'vitest';
import { buildLegacyHierarchy, buildOrgHierarchy, TeamHierarchyReadModel } from './team-hierarchy.read-model';

const TENANT = '7d1e0163-6d53-4713-bd24-254690cc5090';

function readModelWith(...results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  return { execute, readModel: new TeamHierarchyReadModel({ client: { execute } } as never) };
}

const ORG_UNITS = [
  { id: 'u-sales', name: 'Продажи', managerId: null, managerName: null, managerRole: null },
  { id: 'u-eng', name: 'Инженерия', managerId: 'p-mgr', managerName: 'Мария', managerRole: 'manager' },
];
const ORG_TEAMS = [
  { id: 't-web', unitId: 'u-eng', name: 'Веб', leadId: 'p-lead', leadName: 'Лев', leadRole: 'team_lead' },
  { id: 't-api', unitId: 'u-eng', name: 'API', leadId: null, leadName: null, leadRole: null },
];
const ORG_PLACEMENTS = [
  { personId: 'p-lead', unitId: 'u-eng', teamId: 't-web', displayName: 'Лев', role: 'team_lead' },
  { personId: 'p-vera', unitId: 'u-eng', teamId: 't-web', displayName: 'Вера', role: 'employee' },
  { personId: 'p-anna', unitId: 'u-eng', teamId: 't-web', displayName: 'Анна', role: 'employee' },
  { personId: 'p-ivan', unitId: 'u-eng', teamId: 't-api', displayName: 'Иван', role: 'employee' },
  { personId: 'p-dina', unitId: 'u-eng', teamId: null, displayName: 'Дина', role: 'employee' },
  { personId: 'p-mgr', unitId: 'u-eng', teamId: null, displayName: 'Мария', role: 'manager' },
  { personId: 'p-ghost', unitId: 'u-eng', teamId: 't-inactive', displayName: 'Призрак', role: 'employee' },
];

it('never lists a manager or lead a second time as a member', () => {
  const units = buildOrgHierarchy(ORG_UNITS, ORG_TEAMS, [
    { personId: 'p-mgr', unitId: 'u-eng', teamId: 't-web', displayName: 'Мария', role: 'manager' },
    { personId: 'p-lead', unitId: 'u-eng', teamId: null, displayName: 'Лев', role: 'team_lead' },
  ]);
  const eng = units.find((unit) => unit.id === 'u-eng');
  expect(eng?.teams.flatMap((team) => team.members)).toEqual([]);
  expect(eng?.directMembers).toEqual([]);
});

it('drops blank legacy names and duplicate memberships', () => {
  const [unit] = buildLegacyHierarchy(
    [{ id: 'lt', name: 'Команда', managerSlackUserId: 'U1', managerUserId: 'mgr', managerName: '  ' }],
    [
      { teamId: 'lt', userId: 'a', displayName: ' ' },
      { teamId: 'lt', userId: 'a', displayName: ' ' },
      { teamId: 'lt', userId: 'mgr', displayName: 'Олег' },
    ],
  );
  expect(unit?.manager).toEqual({ id: 'mgr', displayName: 'U1', role: 'manager' });
  expect(unit?.directMembers).toEqual([{ id: 'a', displayName: 'Участник 1', role: 'employee' }]);
});

describe('team hierarchy read model', () => {
  it('rejects a non-UUID tenant before querying', async () => {
    const { execute, readModel } = readModelWith();
    await expect(readModel.getHierarchy('bad-tenant')).rejects.toThrow('tenantId');
    await expect(readModel.getHierarchy(undefined)).rejects.toThrow('tenantId');
    expect(execute).not.toHaveBeenCalled();
  });

  it('assembles the org tree with team and direct members, showing each person once and sorted', () => {
    const units = buildOrgHierarchy(ORG_UNITS, ORG_TEAMS, ORG_PLACEMENTS);
    expect(units.map((unit) => unit.name)).toEqual(['Инженерия', 'Продажи']);
    const [eng, sales] = units;
    expect(eng?.manager).toEqual({ id: 'p-mgr', displayName: 'Мария', role: 'manager' });
    expect(eng?.teams.map((team) => team.name)).toEqual(['Веб', 'API']);
    const web = eng?.teams.find((team) => team.id === 't-web');
    expect(web?.lead).toEqual({ id: 'p-lead', displayName: 'Лев', role: 'team_lead' });
    expect(web?.members.map((m) => m.displayName)).toEqual(['Анна', 'Вера']);
    expect(eng?.teams.find((team) => team.id === 't-api')?.lead).toBeNull();
    // A person placed in an inactive team still belongs to the unit.
    expect(eng?.directMembers.map((m) => m.displayName)).toEqual(['Дина', 'Призрак']);
    expect(sales).toEqual({ id: 'u-sales', name: 'Продажи', manager: null, teams: [], directMembers: [] });
  });

  it('reads the org model, tenant-scoped, and exposes no email or employee id', async () => {
    const { execute, readModel } = readModelWith(
      ORG_UNITS,
      ORG_TEAMS,
      ORG_PLACEMENTS.map((row) => ({ ...row, workEmail: 'secret@example.com', customerEmployeeId: 'EMP-42' })),
    );
    const result = await readModel.getHierarchy(TENANT);
    expect(result.source).toBe('org');
    expect(result.tenantId).toBe(TENANT);
    expect(execute).toHaveBeenCalledTimes(3);
    for (const call of execute.mock.calls) {
      const query = JSON.stringify(call[0]);
      expect(query).toContain(TENANT);
      expect(query).toContain("lifecycle_status = 'active'");
      expect(query).not.toContain('work_email');
      expect(query).not.toContain('customer_employee_id');
    }
    const json = JSON.stringify(result);
    expect(json).not.toContain('secret@example.com');
    expect(json).not.toContain('EMP-42');
    expect(json).not.toMatch(/workEmail|customerEmployeeId|externalUserId/);
  });

  it('falls back to legacy teams with resolved and unresolved managers', async () => {
    const { execute, readModel } = readModelWith(
      [],
      [
        { id: 'lt-b', name: 'Бэкенд', managerSlackUserId: 'U0RAW', managerUserId: null, managerName: null },
        { id: 'lt-a', name: 'Аналитика', managerSlackUserId: 'U0MGR', managerUserId: 'user-mgr', managerName: 'Олег' },
      ],
      [
        { teamId: 'lt-a', userId: 'user-mgr', displayName: 'Олег' },
        { teamId: 'lt-a', userId: 'user-2', displayName: null },
        { teamId: 'lt-a', userId: 'user-1', displayName: 'Яна' },
        { teamId: 'lt-b', userId: 'user-3', displayName: null },
      ],
    );
    const result = await readModel.getHierarchy(TENANT);
    expect(result.source).toBe('legacy');
    expect(execute).toHaveBeenCalledTimes(3);
    for (const call of execute.mock.calls) expect(JSON.stringify(call[0])).toContain(TENANT);
    const [analytics, backend] = result.units;
    expect(analytics?.manager).toEqual({ id: 'user-mgr', displayName: 'Олег', role: 'manager' });
    expect(analytics?.directMembers).toEqual([
      { id: 'user-2', displayName: 'Участник 1', role: 'employee' },
      { id: 'user-1', displayName: 'Яна', role: 'employee' },
    ]);
    expect(analytics?.teams).toEqual([]);
    expect(backend?.manager).toEqual({ id: null, displayName: 'U0RAW', role: 'manager' });
    expect(backend?.directMembers).toEqual([{ id: 'user-3', displayName: 'Участник 1', role: 'employee' }]);
  });

  it('reports none when there are no org units and no legacy teams', async () => {
    const { readModel } = readModelWith([], []);
    const result = await readModel.getHierarchy(TENANT);
    expect(result).toMatchObject({ tenantId: TENANT, source: 'none', units: [] });
  });

  it('labels legacy members without a Slack name deterministically by user id', () => {
    const units = buildLegacyHierarchy(
      [{ id: 'lt', name: 'Команда', managerSlackUserId: null, managerUserId: null, managerName: null }],
      [{ teamId: 'lt', userId: 'b', displayName: null }, { teamId: 'lt', userId: 'a', displayName: null }],
    );
    expect(units[0]?.manager).toBeNull();
    expect(units[0]?.directMembers.map((m) => [m.id, m.displayName])).toEqual([['a', 'Участник 1'], ['b', 'Участник 2']]);
  });
});
